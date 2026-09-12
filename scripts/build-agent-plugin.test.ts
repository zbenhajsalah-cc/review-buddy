/**
 * Packaging tests for the portable Agent Plugin (integrations/agent-plugin/ +
 * scripts/build-agent-plugin.ts). Two layers:
 *  - unit: schema/skill/mcp/package validators accept the real authoring files
 *    and reject targeted invalid fixtures (the vendored schemas deliberately
 *    leave semantic checks to us);
 *  - smoke: build the package, relocate it to a path with spaces, then drive
 *    the bundled server over real stdio — initialize, list submit_review, and
 *    submit a review against a separate temp repo — proving the artifact
 *    works without the dev checkout, its node_modules, or a browser.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTempRepo, sampleReview } from "../src/test-helpers.ts";
import type { AgentReview } from "../src/types/review.ts";
import {
  validateAgainstSchema,
  validateMcpConfig,
  validatePackage,
  validateSkill,
} from "./build-agent-plugin.ts";

const repoRoot = join(import.meta.dir, "..");
const authoringDir = join(repoRoot, "integrations", "agent-plugin");
const pkgName = "review-buddy";

// ------------------------------------------------------------------- unit

describe("authoring inputs (drift protection)", () => {
  test("plugin.json passes the pinned manifest schema", () => {
    const manifest = JSON.parse(
      execFileSync("cat", [join(authoringDir, "plugin.json")], { encoding: "utf8" }),
    );
    expect(() =>
      validateAgainstSchema(
        join(repoRoot, "schemas/agent-plugins/plugin.schema.json"),
        manifest,
        "plugin.json",
      ),
    ).not.toThrow();
  });

  test("mcp.json passes the pinned schema and stays inside the plugin root", () => {
    const mcp = JSON.parse(
      execFileSync("cat", [join(authoringDir, "mcp.json")], { encoding: "utf8" }),
    );
    expect(() =>
      validateAgainstSchema(
        join(repoRoot, "schemas/agent-plugins/mcp.schema.json"),
        mcp,
        "mcp.json",
      ),
    ).not.toThrow();
    expect(() => validateMcpConfig(mcp)).not.toThrow();
  });

  test("the portable skill has conformant frontmatter", () => {
    expect(() => validateSkill(join(authoringDir, "skills", pkgName))).not.toThrow();
  });
});

describe("validators reject invalid input", () => {
  test("manifest with a non-canonical $schema fails", () => {
    const manifest = JSON.parse(
      execFileSync("cat", [join(authoringDir, "plugin.json")], { encoding: "utf8" }),
    ) as Record<string, unknown>;
    manifest.$schema = "https://example.com/not-the-schema.json";
    expect(() =>
      validateAgainstSchema(
        join(repoRoot, "schemas/agent-plugins/plugin.schema.json"),
        manifest,
        "plugin.json",
      ),
    ).toThrow("schema validation");
  });

  test("skill name must equal its directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "rb-skill-"));
    try {
      mkdirSync(join(dir, "wrong-name"));
      writeFileSync(
        join(dir, "wrong-name", "SKILL.md"),
        "---\nname: other\ndescription: x\n---\nbody\n",
      );
      expect(() => validateSkill(join(dir, "wrong-name"))).toThrow("must equal");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("skill frontmatter is a closed field set (Claude-only keys rejected)", () => {
    const dir = mkdtempSync(join(tmpdir(), "rb-skill-"));
    try {
      mkdirSync(join(dir, pkgName));
      writeFileSync(
        join(dir, pkgName, "SKILL.md"),
        `---\nname: ${pkgName}\ndescription: x\ndisable-model-invocation: true\n---\nbody\n`,
      );
      expect(() => validateSkill(join(dir, pkgName))).toThrow("not in the Agent Skills spec");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("mcp args that escape the plugin root are rejected", () => {
    expect(() =>
      validateMcpConfig({
        mcpServers: {
          // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder, not a template
          s: { type: "stdio", command: "bun", args: ["run", "${PLUGIN_ROOT}/../escape.ts"] },
        },
      }),
    ).toThrow("escapes the plugin root");
    expect(() =>
      validateMcpConfig({
        mcpServers: { s: { type: "http", command: "bun", args: [] } },
      }),
    ).toThrow("only stdio");
    expect(() =>
      validateMcpConfig({
        mcpServers: { s: { type: "stdio", command: "/usr/bin/bun", args: [] } },
      }),
    ).toThrow("bare executable");
  });

  test("a package missing required files fails validation", () => {
    const dir = mkdtempSync(join(tmpdir(), "rb-pkg-"));
    try {
      writeFileSync(join(dir, "plugin.json"), "{}");
      expect(() => validatePackage(dir)).toThrow("missing required file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ------------------------------------------------------------------- smoke

describe("packaged plugin end-to-end", () => {
  const scratch = mkdtempSync(join(tmpdir(), "rb-plugin-test-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  test("built + relocated package serves a review over real stdio", async () => {
    // Build into a clean staging area (no archive — the smoke test doesn't ship one).
    execFileSync(
      process.execPath,
      ["run", join(repoRoot, "scripts/build-agent-plugin.ts"), "--no-archive"],
      {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "inherit"],
      },
    );

    // Relocate: a path with spaces, outside the source checkout, no dev deps.
    const pkgDir = join(scratch, "installed plugin", pkgName);
    mkdirSync(join(scratch, "installed plugin"), { recursive: true });
    cpSync(join(repoRoot, "dist/agent-plugin", pkgName), pkgDir, { recursive: true });
    validatePackage(pkgDir);

    const repo = makeTempRepo("rb-plugin-target-");
    try {
      const review = sampleReview({ cwd: repo }) as AgentReview;
      const proc = spawn(
        process.execPath,
        ["run", join(pkgDir, "src/mcp/server.js"), "--standalone"],
        {
          cwd: pkgDir, // conformant clients spawn with cwd = the plugin root
          env: { ...process.env, REVIEW_BUDDY_NO_OPEN: "1" },
          stdio: ["pipe", "pipe", "inherit"],
        },
      );

      // Line-delimited JSON-RPC over stdio.
      let buf = "";
      const pending: Array<(line: Record<string, unknown>) => void> = [];
      const lines: Record<string, unknown>[] = [];
      proc.stdout!.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          const msg = JSON.parse(line) as Record<string, unknown>;
          const waiter = pending.shift();
          if (waiter) waiter(msg);
          else lines.push(msg);
        }
      });
      const next = () =>
        new Promise<Record<string, unknown>>((res) => {
          const l = lines.shift();
          if (l) res(l);
          else pending.push(res);
        });
      const send = (msg: object) => proc.stdin!.write(`${JSON.stringify(msg)}\n`);

      try {
        send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test", version: "0" },
          },
        });
        const init = (await next()) as { result?: { serverInfo?: { name?: string } } };
        expect(init.result?.serverInfo?.name).toBe(pkgName);

        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        const tools = (await next()) as {
          result?: { tools?: Array<{ name: string }> };
        };
        expect(tools.result?.tools?.map((t) => t.name)).toContain("submit_review");

        send({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "submit_review", arguments: review },
        });
        const call = (await next()) as {
          result?: { content?: Array<{ text: string }>; isError?: boolean };
        };
        const text = call.result?.content?.[0]?.text ?? "";
        expect(call.result?.isError).toBeUndefined();
        const url = text.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/)?.[0];
        expect(url).toBeDefined();

        // The served review must contain the TARGET repo's changes — i.e.
        // `cwd` selected the repo, not the plugin dir or dev checkout.
        const token = url!.split("token=")[1]!;
        const api = url!.replace("/?", "/api/review?");
        const r = await fetch(api, { headers: { "x-review-buddy-token": token } });
        expect(r.status).toBe(200);
        const data = (await r.json()) as {
          chapters: Array<{ files: Array<{ path: string }> }>;
        };
        const paths = data.chapters.flatMap((c) => c.files.map((f) => f.path));
        expect(paths).toContain("app.ts");

        // The real viewer is served (not the placeholder fallback page).
        const html = await (
          await fetch(url!, { headers: { "x-review-buddy-token": token } })
        ).text();
        expect(html).toContain('id="root"');
      } finally {
        proc.kill();
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 30_000);
});

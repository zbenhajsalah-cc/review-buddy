#!/usr/bin/env bun
// Assembles the installable Agent Plugin package into dist/agent-plugin/.
//
//   dist/agent-plugin/review-buddy/            ← self-contained plugin dir
//   dist/agent-plugin/review-buddy-<ver>.tar.gz (+ .sha256)
//
// The authoring inputs live in integrations/agent-plugin/; this script adds the
// runtime (a Bun-targeted bundle of src/mcp/server.ts with `zod` vendored —
// bundling zod reorders its lazy init and breaks the MCP SDK at startup), the
// prebuilt viewer, the review schema, and dependency notices. See
// docs/PLAN-agent-plugins.md for the design.
//
// Usage: bun run scripts/build-agent-plugin.ts [--no-archive]

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const repoRoot = join(import.meta.dir, "..");
const authoringDir = join(repoRoot, "integrations", "agent-plugin");
const outRoot = join(repoRoot, "dist", "agent-plugin");
const pkgName = "review-buddy";

// ---------------------------------------------------------------- validation

const ajv = new Ajv2020({ strict: false, allErrors: true });

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

// ajv registers compiled schemas by their canonical $id — compiling the same
// file twice throws, so validators are memoized per path.
const compiled = new Map<string, ReturnType<typeof ajv.compile>>();

/** Throws with a readable message when `data` fails the vendored schema. */
export function validateAgainstSchema(schemaPath: string, data: unknown, label: string): void {
  let validate = compiled.get(schemaPath);
  if (!validate) {
    validate = ajv.compile(loadJson(schemaPath) as object);
    compiled.set(schemaPath, validate);
  }
  if (validate(data)) return;
  const errs = (validate.errors ?? [])
    .map((e) => `  ${e.instancePath || "/"} ${e.message}`)
    .join("\n");
  throw new Error(`${label} failed schema validation:\n${errs}`);
}

const SKILL_FRONTMATTER_KEYS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

/**
 * Agent Skills conformance checks the JSON schemas can't express: `name` must
 * equal the skill directory name, `description` is required, and the
 * frontmatter is a closed field set.
 */
export function validateSkill(skillDir: string): void {
  const file = join(skillDir, "SKILL.md");
  const text = readFileSync(file, "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`${file}: missing --- frontmatter block`);
  const keys = [...m[1]!.matchAll(/^([a-z][a-z-]*):/gm)].map((k) => k[1]!);
  for (const k of keys) {
    if (!SKILL_FRONTMATTER_KEYS.has(k))
      throw new Error(`${file}: frontmatter key "${k}" is not in the Agent Skills spec`);
  }
  const name = m[1]!.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const dir = skillDir.split(sep).pop()!;
  if (name !== dir)
    throw new Error(`${file}: name "${name}" must equal the skill directory "${dir}"`);
  if (!/^description:\s*\S/m.test(m[1]!))
    throw new Error(`${file}: frontmatter requires a non-empty description`);
}

/** Every path a portable mcp.json references must stay inside the plugin root. */
export function validateMcpConfig(mcp: {
  mcpServers?: Record<string, { type?: string; command?: string; args?: string[] }>;
}): void {
  const servers = mcp.mcpServers ?? {};
  for (const [name, s] of Object.entries(servers)) {
    if (s.type !== "stdio")
      throw new Error(`mcp.json server "${name}": only stdio transport is supported here`);
    if (!s.command || /[\\/]/.test(s.command))
      throw new Error(
        `mcp.json server "${name}": command must be a bare executable, got "${s.command}"`,
      );
    for (const arg of s.args ?? []) {
      const m = arg.match(/^\$\{PLUGIN_ROOT\}[\\/]+(.*)$/);
      if (!m) continue;
      const p = resolve(`/plugin-root/${m[1]!}`);
      if (!p.startsWith(`/plugin-root${sep}`) && p !== "/plugin-root")
        throw new Error(`mcp.json server "${name}": arg "${arg}" escapes the plugin root`);
    }
  }
}

// ------------------------------------------------------------- notices

/** Runtime dependency closure — the packages the bundle inlines or vendors. */
export function dependencyClosure(): Map<
  string,
  { version: string; license?: string; dir: string }
> {
  const found = new Map<string, { version: string; license?: string; dir: string }>();
  const queue = [
    ...Object.keys(
      (loadJson(join(repoRoot, "package.json")) as { dependencies?: object }).dependencies ?? {},
    ),
  ];
  while (queue.length) {
    const name = queue.shift()!;
    if (found.has(name)) continue;
    const dir = join(repoRoot, "node_modules", name);
    const pkgFile = join(dir, "package.json");
    if (!existsSync(pkgFile)) continue;
    const pkg = loadJson(pkgFile) as { version?: string; license?: string; dependencies?: object };
    found.set(name, { version: pkg.version ?? "?", license: pkg.license, dir });
    queue.push(...Object.keys(pkg.dependencies ?? {}));
  }
  return found;
}

function writeNotices(dest: string): number {
  const deps = dependencyClosure();
  const parts = [
    `Review Buddy bundles or vendors the npm packages below at build time.`,
    `Their license texts are reproduced as required.\n`,
  ];
  for (const [name, { version, license, dir }] of [...deps].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const licFile = readdirSync(dir).find((f) => /^(licen[sc]e|copying|notice)/i.test(f));
    const text = licFile
      ? readFileSync(join(dir, licFile), "utf8").trim()
      : `(no license file shipped; declared license: ${license ?? "unknown"})`;
    parts.push(`${"=".repeat(72)}\n${name}@${version}\n${"=".repeat(72)}\n${text}\n`);
  }
  writeFileSync(dest, parts.join("\n"));
  return deps.size;
}

// ------------------------------------------------------------------- build

const REQUIRED_PACKAGE_FILES = [
  "plugin.json",
  "mcp.json",
  "README.md",
  "package.json",
  "THIRD_PARTY_NOTICES",
  "schemas/review.schema.json",
  "src/mcp/server.js",
  "src/ui/dist/index.html",
  "node_modules/zod/package.json",
];

export function validatePackage(pkgDir: string): void {
  for (const rel of REQUIRED_PACKAGE_FILES) {
    if (!existsSync(join(pkgDir, rel)))
      throw new Error(`packaged plugin is missing required file: ${rel}`);
  }
  // Nothing inside the package may point outside it (e.g. an escaping symlink).
  const rootReal = realpathSync(pkgDir);
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) {
        const t = realpathSync(p);
        if (t !== rootReal && !t.startsWith(rootReal + sep))
          throw new Error(`package contains symlink escaping the plugin root: ${p}`);
      } else if (e.isDirectory()) walk(p);
    }
  };
  walk(pkgDir);
}

function dirSize(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    n += e.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return n;
}

export function build(): { pkgDir: string; version: string } {
  const version = (loadJson(join(repoRoot, "package.json")) as { version: string }).version;
  const manifest = loadJson(join(authoringDir, "plugin.json")) as {
    name?: string;
    version?: string;
  };
  const mcp = loadJson(join(authoringDir, "mcp.json")) as Parameters<typeof validateMcpConfig>[0];

  // 1. Authoring inputs must agree with the repo and pass the pinned schemas.
  if (manifest.name !== pkgName) throw new Error(`plugin.json name must be "${pkgName}"`);
  if (manifest.version !== version)
    throw new Error(
      `plugin.json version ${manifest.version} != package.json ${version} (run release.sh / sync versions)`,
    );
  validateAgainstSchema(
    join(repoRoot, "schemas/agent-plugins/plugin.schema.json"),
    manifest,
    "plugin.json",
  );
  validateAgainstSchema(join(repoRoot, "schemas/agent-plugins/mcp.schema.json"), mcp, "mcp.json");
  validateMcpConfig(mcp);
  validateSkill(join(authoringDir, "skills", pkgName));

  // 2. The committed viewer is required — never ship the placeholder fallback.
  if (!existsSync(join(repoRoot, "src/ui/dist/index.html")))
    throw new Error("src/ui/dist is missing — run `cd src/ui && bun run build` first");

  // 3. Stage the package; swap it in only after every step succeeds.
  const staging = join(outRoot, ".staging");
  rmSync(staging, { recursive: true, force: true });
  const pkgDir = join(staging, pkgName);
  mkdirSync(join(pkgDir, "schemas"), { recursive: true });
  mkdirSync(join(pkgDir, "src", "ui"), { recursive: true });
  mkdirSync(join(pkgDir, "node_modules"), { recursive: true });

  for (const f of ["plugin.json", "mcp.json", "README.md", "package.json"]) {
    cpSync(join(authoringDir, f === "package.json" ? `../..` : "", f), join(pkgDir, f));
  }
  cpSync(join(authoringDir, "skills"), join(pkgDir, "skills"), { recursive: true });
  cpSync(
    join(repoRoot, "schemas", "review.schema.json"),
    join(pkgDir, "schemas", "review.schema.json"),
  );
  cpSync(join(repoRoot, "src/ui/dist"), join(pkgDir, "src/ui/dist"), { recursive: true });
  cpSync(join(repoRoot, "node_modules", "zod"), join(pkgDir, "node_modules", "zod"), {
    recursive: true,
    verbatimSymlinks: false,
  });

  // 4. Bundle the MCP runtime for Bun. `--external=zod` is deliberate: bundling
  //    zod reorders its lazy `__esm` init so the MCP SDK calls z.custom() before
  //    ZodCustom exists (verified in the packaging spike).
  execFileSync(
    process.execPath,
    [
      "build",
      join(repoRoot, "src/mcp/server.ts"),
      "--target=bun",
      "--external=zod",
      "--outdir",
      join(pkgDir, "src", "mcp"),
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );

  const depCount = writeNotices(join(pkgDir, "THIRD_PARTY_NOTICES"));

  validatePackage(pkgDir);

  // 5. Publish atomically-ish: remove the old dir, rename staging over it.
  const finalDir = join(outRoot, pkgName);
  rmSync(finalDir, { recursive: true, force: true });
  renameSync(pkgDir, finalDir);
  rmSync(staging, { recursive: true, force: true });

  console.log(
    `[build-plugin] ${pkgName}@${version}: ${REQUIRED_PACKAGE_FILES.length} required files, ` +
      `${depCount} dependency notices, ${(dirSize(finalDir) / 1e6).toFixed(1)} MB → ${finalDir}`,
  );
  return { pkgDir: finalDir, version };
}

// ----------------------------------------------------------------- archive

export function archive(version: string): { tarPath: string; shaPath: string } {
  const base = `${pkgName}-${version}.tar.gz`;
  const tarPath = join(outRoot, base);
  rmSync(tarPath, { force: true });
  execFileSync("tar", ["-czf", tarPath, "-C", outRoot, pkgName]);
  const sha = createHash("sha256").update(readFileSync(tarPath)).digest("hex");
  const shaPath = `${tarPath}.sha256`;
  writeFileSync(shaPath, `${sha}  ${base}\n`);
  console.log(`[build-plugin] archive: ${tarPath} (sha256 ${sha.slice(0, 12)}…)`);
  return { tarPath, shaPath };
}

if (import.meta.main) {
  const { version } = build();
  if (!process.argv.includes("--no-archive")) archive(version);
}

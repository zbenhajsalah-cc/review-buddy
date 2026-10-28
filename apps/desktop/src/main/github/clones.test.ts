import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authHeader,
  findGits,
  type GitRun,
  gitCandidates,
  gitConfigEnv,
  PrClones,
  parseGitVersion,
  parseProgress,
  runGit,
} from "./clones.ts";

describe("gitCandidates", () => {
  test("the PATH (absolute folders only), then the usual folders", () => {
    expect(gitCandidates("darwin", { PATH: "/custom/bin:.:bin" })).toEqual([
      "/custom/bin/git",
      "/usr/bin/git",
      "/opt/homebrew/bin/git",
      "/usr/local/bin/git",
    ]);
  });

  test("Windows: git.exe, also Git for Windows' folders", () => {
    const list = gitCandidates("win32", {
      Path: "C:\\Tools",
      ProgramFiles: "C:\\Program Files",
      LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
    });
    expect(list[0]).toBe("C:\\Tools\\git.exe");
    expect(list).toContain("C:\\Program Files\\Git\\cmd\\git.exe");
    expect(list).toContain("C:\\Users\\me\\AppData\\Local\\Programs\\Git\\cmd\\git.exe");
  });

  test("findGits: every one that exists, in search order", () => {
    const exists = (p: string) => p === "/b/git" || p === "/usr/local/bin/git";
    expect(findGits("linux", { PATH: "/a:/b" }, exists)).toEqual(["/b/git", "/usr/local/bin/git"]);
    expect(findGits("linux", { PATH: "" }, () => false)).toEqual([]);
  });
});

test("parseGitVersion", () => {
  expect(parseGitVersion("git version 2.43.0\n")).toBe("2.43.0");
  expect(parseGitVersion("git version 2.45.1.windows.1")).toBe("2.45.1");
  expect(parseGitVersion("hub version 2.14.2")).toBeNull();
});

test("parseProgress reads git's progress lines", () => {
  expect(parseProgress("Receiving objects:  45% (12/27), 1.2 MiB | 2 MiB/s")).toEqual({
    what: "receiving objects",
    percent: 45,
  });
  expect(parseProgress("remote: Counting objects: 100% (5/5), done.")).toEqual({
    what: "counting objects",
    percent: 100,
  });
  expect(parseProgress("Resolving deltas:   3% (1/30)")).toEqual({
    what: "resolving deltas",
    percent: 3,
  });
  expect(parseProgress("From https://github.com/o/r")).toBeNull();
});

test("gitConfigEnv adds entries after the ones already there", () => {
  const env = gitConfigEnv(
    { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "a.b", GIT_CONFIG_VALUE_0: "1", HOME: "/h" },
    [["c.d", "2"]],
  );
  expect(env).toEqual({
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "a.b",
    GIT_CONFIG_VALUE_0: "1",
    GIT_CONFIG_KEY_1: "c.d",
    GIT_CONFIG_VALUE_1: "2",
    HOME: "/h",
  });
  expect(gitConfigEnv({}, [["x.y", "z"]]).GIT_CONFIG_COUNT).toBe("1");
});

test("authHeader is the basic header git sends to github.com", () => {
  expect(authHeader("tok")).toBe(
    `AUTHORIZATION: basic ${Buffer.from("x-access-token:tok").toString("base64")}`,
  );
});

const GIT = findGits()[0];

describe.skipIf(!GIT)("PrClones against a local remote", () => {
  const root = mkdtempSync(join(tmpdir(), "rb-clones-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: root };
  const sh = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();

  // The "GitHub" repository: a base commit, then a PR head commit.
  const origin = join(root, "origin");
  mkdirSync(origin);
  sh(origin, "init", "--quiet", "-b", "main");
  sh(origin, "config", "user.email", "t@example.com");
  sh(origin, "config", "user.name", "t");
  // Serving a partial, by-SHA fetch, as GitHub does.
  sh(origin, "config", "uploadpack.allowFilter", "true");
  sh(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
  writeFileSync(join(origin, "a.txt"), "one\ntwo\nthree\n");
  writeFileSync(join(origin, "old name.txt"), "keep\nthis\nfile\nas\nit\nis\n");
  sh(origin, "add", ".");
  sh(origin, "commit", "--quiet", "-m", "base");
  const base = sh(origin, "rev-parse", "HEAD");
  writeFileSync(join(origin, "a.txt"), "one\nTWO\nthree\nfour\n");
  sh(origin, "mv", "old name.txt", "new name.txt");
  sh(origin, "commit", "--quiet", "-am", "head");
  const head = sh(origin, "rev-parse", "HEAD");
  const expected = sh(origin, "-c", "core.quotePath=false", "diff", "--find-renames", base, head);

  const ref = { owner: "Octo", repo: "Widgets", number: 7 };
  const pr = { ref, headSha: head, baseSha: base, isPublic: true };
  const runs: string[][] = [];
  const clones = (
    dir = join(root, "clones"),
    more: Partial<ConstructorParameters<typeof PrClones>[0]> = {},
  ) =>
    new PrClones({
      dir,
      git: () => [GIT!],
      token: async () => "secret-token",
      remote: () => `file://${origin}`,
      env,
      run: (git, args, options) => {
        runs.push(args);
        return runGit(git, args, options);
      },
      ...more,
    });

  test("the first review makes the copy and fetches; the diff is git's", async () => {
    const steps: string[] = [];
    const c = clones();
    const diff = await c.diff(pr, (s) => steps.push(s));
    expect(diff.trim()).toBe(expected);
    expect(diff).toContain("rename to new name.txt");
    expect(steps[0]).toBe("Making a local copy of Octo/Widgets (without file contents)");
    expect(steps).toContain("Fetching the commits of Octo/Widgets#7");
    expect(steps.at(-1)).toBe("Reading the diff of Octo/Widgets#7 from the local copy");
    expect(existsSync(join(root, "clones", "octo", "widgets.git", "HEAD"))).toBe(true);
    // Only what was asked: the two commits, one deep, no tags.
    const copy = join(root, "clones", "octo", "widgets.git");
    expect(sh(copy, "for-each-ref", "--format=%(refname)").split("\n").sort()).toEqual(
      [`refs/review-buddy/${base}`, `refs/review-buddy/${head}`].sort(),
    );
    expect(sh(copy, "rev-list", "--all", "--count")).toBe("2");
  });

  test("the next review uses the copy: no fetch", async () => {
    const steps: string[] = [];
    runs.length = 0;
    expect((await clones().diff(pr, (s) => steps.push(s))).trim()).toBe(expected);
    expect(steps[0]).toBe("Using the local copy of Octo/Widgets");
    expect(runs.some((args) => args.includes("fetch"))).toBe(false);
  });

  test("git gets the token only for a repository not known to be public", async () => {
    const envs: Record<string, string | undefined>[] = [];
    const spy: GitRun = (git, args, options) => {
      envs.push(options.env);
      return runGit(git, args, options);
    };
    const c = clones(join(root, "clones-token"), { run: spy });
    await c.diff({ ...pr, isPublic: false }, () => {});
    const sent = (e: Record<string, string | undefined>) =>
      Object.values(e).some((v) => v?.includes(authHeader("secret-token")));
    expect(envs.filter((e) => e.GIT_CONFIG_COUNT).some(sent)).toBe(true);
    envs.length = 0;
    await c.diff(pr, () => {});
    expect(envs.some(sent)).toBe(false);
    // Never on the command line, never in the copy's config.
    expect(runs.flat().join(" ")).not.toContain("secret-token");
    expect(
      sh(join(root, "clones-token", "octo", "widgets.git"), "config", "--list", "--local"),
    ).not.toContain("extraheader");
  });

  test("list, delete, delete all; a copy in use cannot be deleted", async () => {
    const c = clones();
    const [info] = await c.list();
    expect(info).toMatchObject({ repo: "octo/widgets", inUse: false });
    expect(info!.bytes).toBeGreaterThan(1000);
    // Hold a review on it: the fetch waits on a slow git.
    let release = () => {};
    const slow: GitRun = async (git, args, options) => {
      if (args.includes("diff")) await new Promise<void>((r) => (release = r));
      return runGit(git, args, options);
    };
    const busy = clones(join(root, "clones"), { run: slow });
    const reading = busy.diff(pr, () => {});
    await Bun.sleep(50);
    expect((await busy.list())[0]!.inUse).toBe(true);
    await expect(busy.delete("octo/widgets")).rejects.toThrow("A review is using the copy");
    expect(await busy.deleteAll()).toHaveLength(1); // kept: in use
    release();
    await reading;
    expect(await busy.delete("Octo/Widgets")).toEqual([]);
    expect(existsSync(join(root, "clones", "octo"))).toBe(false);
    await expect(busy.delete("../x")).rejects.toThrow("unknown copy");
    await expect(busy.delete(42)).rejects.toThrow("unknown copy");
    expect(await clones(join(root, "none")).list()).toEqual([]);
  });

  test("a PR that is not on the remote: git's reason, in words", async () => {
    const c = clones(join(root, "clones-missing"));
    await expect(c.diff({ ...pr, headSha: "f".repeat(40) }, () => {})).rejects.toThrow(
      "git could not fetch Octo/Widgets#7",
    );
  });

  test("stopping kills git", async () => {
    const c = clones(join(root, "clones-stop"));
    const stop = new AbortController();
    stop.abort();
    await expect(c.diff(pr, () => {}, stop.signal)).rejects.toThrow("stopped");
  });

  test("no git, or a git too old: says what to do", async () => {
    await expect(clones(undefined, { git: () => [] }).diff(pr, () => {})).rejects.toThrow(
      "Install git, then try again.",
    );
    const old: GitRun = async () => "git version 2.20.1";
    await expect(clones(join(root, "clones-old"), { run: old }).diff(pr, () => {})).rejects.toThrow(
      "git 2.20.1 is too old",
    );
  });

  test("an old git first in the PATH does not hide a newer one", async () => {
    const asked: string[] = [];
    const twoGits: GitRun = (git, args, options) => {
      if (args[0] === "--version") asked.push(git);
      if (git === "/old/git") return Promise.resolve("git version 2.20.1");
      return runGit(GIT!, args, options);
    };
    const c = clones(join(root, "clones-two"), {
      git: () => ["/old/git", "/new/git"],
      run: twoGits,
    });
    expect((await c.diff(pr, () => {})).trim()).toBe(expected);
    await c.diff(pr, () => {});
    expect(asked).toEqual(["/old/git", "/new/git"]); // checked once
    const broken: GitRun = async () => {
      throw new Error("ENOENT");
    };
    await expect(
      clones(join(root, "clones-two"), { git: () => ["/a/git", "/b/git"], run: broken }).diff(
        pr,
        () => {},
      ),
    ).rejects.toThrow("git did not run (/a/git): ENOENT");
  });

  test("a submodule change is in the diff, whatever diff.ignoreSubmodules says", async () => {
    const sub = join(root, "sub-origin");
    mkdirSync(sub);
    sh(sub, "init", "--quiet", "-b", "main");
    sh(sub, "config", "uploadpack.allowFilter", "true");
    sh(sub, "config", "uploadpack.allowAnySHA1InWant", "true");
    writeFileSync(join(sub, "a.txt"), "a\n");
    sh(sub, "add", ".");
    sh(
      sub,
      "-c",
      "user.email=t@example.com",
      "-c",
      "user.name=t",
      "commit",
      "--quiet",
      "-m",
      "base",
    );
    const subBase = sh(sub, "rev-parse", "HEAD");
    // A submodule entry (a gitlink) pointing at some commit.
    sh(sub, "update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},vendor/lib`);
    sh(
      sub,
      "-c",
      "user.email=t@example.com",
      "-c",
      "user.name=t",
      "commit",
      "--quiet",
      "-m",
      "head",
    );
    const subHead = sh(sub, "rev-parse", "HEAD");
    const c = clones(join(root, "clones-sub"), {
      remote: () => `file://${sub}`,
      env: gitConfigEnv(env, [["diff.ignoreSubmodules", "all"]]),
    });
    const diff = await c.diff({ ...pr, headSha: subHead, baseSha: subBase }, () => {});
    expect(diff).toContain("diff --git a/vendor/lib b/vendor/lib");
  });

  test("bad names and SHAs are refused before git runs", async () => {
    runs.length = 0;
    await expect(
      clones().diff({ ...pr, ref: { ...ref, owner: "../etc" } }, () => {}),
    ).rejects.toThrow("Not a GitHub repository");
    await expect(clones().diff({ ...pr, headSha: "main" }, () => {})).rejects.toThrow(
      "Not commit SHAs",
    );
    expect(runs).toEqual([]);
  });
});

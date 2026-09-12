**Plan: portable Agent Plugins setup for non-Claude harnesses**

Status: implemented, with two deviations found during the packaging spike —
(1) the runtime is emitted by `bun build --external=zod` with `zod` vendored
into `node_modules/` (bundling zod reorders its lazy `__esm` init so the MCP
SDK crashes at startup), and (2) `resolveStandaloneCwd`'s ambient fallback now
refuses to resolve the repo that hosts the package, closing the "silently
review the plugin's host repo" risk named in §10. Researched September 11,
2026, against Agent Plugins 1.0.0.

**1. Intended result**

Keep the existing Claude Code installation, `/review` skill, MCP registration, and blocking `PreToolUse` flow intact. Replace the primary setup for Cursor, VS Code Copilot, and Codex with one portable Agent Plugin containing a standalone review skill and the existing MCP runtime.

The non-Claude user flow becomes: obtain the package, enable it through the client's plugin mechanism, invoke its review skill, and receive the browser review URL. Users should no longer assemble an MCP configuration and a separately copied prompt or edit an absolute server path.

This is a packaging and integration migration. Diff capture, review JSON, chapter resolution, viewer behavior, and the standalone lifecycle remain shared with the existing implementation.

**2. Specification findings that govern the design**

An Agent Plugin is a self-contained directory with root `plugin.json`. Its optional components occupy fixed locations: root `mcp.json` and immediate skill directories under `skills/`. Packaged files must stay within the package boundary; referencing the surrounding repository through `../../` or an escaping symlink would defeat portability. Installation and distribution are client-managed. [Authoring guide](https://agent-plugins.org/plugin-authors/build-an-agent-plugin)

The manifest requires the canonical versioned `$schema` and a valid name. Use ordinary metadata fields for version, author, description, and repository; do not put MCP definitions, skill path overrides, or hooks in the portable manifest. [Manifest reference](https://agent-plugins.org/plugin-authors/manifest)

Portable MCP uses `$schema` and `mcpServers`, with `type: "stdio"` for this project. Use bare `bun` as the command and `${PLUGIN_ROOT}` in its arguments. The process working directory defaults to the plugin root, so it cannot identify the repository under review. Portable timeout fields and `${workspaceFolder}` are not part of this configuration. [MCP reference](https://agent-plugins.org/plugin-authors/mcp-servers)

The skill needs valid Agent Skills frontmatter, including a name matching its directory and a description. Skill invocation syntax is client-owned; do not assume a universal slash command or `$ARGUMENTS` substitution. [Skill packaging](https://agent-plugins.org/plugin-authors/skills), [Agent Skills format](https://agentskills.io/specification)

**3. Package architecture**

Use two distinct package roots, built from one repository:

| Package | Root | Execution |
| --- | --- | --- |
| Existing Claude Code plugin | Repository root | Existing hook captures and serves; MCP acknowledges |
| Portable Agent Plugin | Generated `dist/agent-plugin/review-buddy/` | MCP launches with `--standalone` and returns the URL |

Commit the portable authoring inputs under `integrations/agent-plugin/`. A packaging script assembles the complete installable directory. That source directory alone is not the installable plugin because it does not contain the runtime or viewer.

```text
integrations/agent-plugin/                 # committed authoring inputs
  plugin.json
  mcp.json
  README.md
  skills/review-buddy/SKILL.md

dist/agent-plugin/review-buddy/            # generated installable package
  plugin.json
  mcp.json
  README.md
  package.json                            # runtime metadata, including version
  THIRD_PARTY_NOTICES                      # notices for bundled dependencies
  skills/review-buddy/SKILL.md
  schemas/review.schema.json
  src/mcp/server.js                       # bundled Bun-targeted runtime
  src/ui/dist/                            # existing prebuilt viewer and assets
```

This avoids exposing the Claude-specific `skills/review/SKILL.md` to portable clients or making Claude discover a second standalone skill. Simply adding manifests at repository root would leave both flows sharing a skill that assumes Claude's hook semantics. Moving the Claude skill or changing its component paths would conflict with the requested preservation.

The generated directory must be relocatable and usable without the source checkout or its `node_modules`. Build one JavaScript bundle targeting Bun rather than platform-specific executables. Bun and Git remain prerequisites; authenticated `gh` remains optional for PR reviews.

Keeping the bundle at `src/mcp/server.js` preserves the existing two-level path relationship to `package.json`, `schemas/`, and `src/ui/dist/`. Confirm this in the first implementation spike: bundling can affect `import.meta.dir` and lazy imports. If a path helper is necessary, preserve its current source-run default and keep it narrowly scoped.

**4. Preserve the Claude Code contract**

Record the starting revision and verify that these setup files remain unchanged throughout the migration:

- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
- `hooks/hooks.json` and `examples/hooks.json`.
- `skills/review/SKILL.md` and `bin/review-buddy.js`.
- Claude installation and usage instructions in README.

Keep the no-flag MCP mode, tool identifier, hook matcher, hook timeout, allow/deny responses, and resolution feedback behavior. Continue selecting standalone mode with an explicit CLI argument; never make plugin environment variables switch the shared runtime's mode automatically.

Ordinary future release version bumps still apply to the Claude manifest. The migration itself does not change its registration or behavior. No viewer changes are planned, and unrelated issues found during exploration are outside this work.

**5. Add the portable configuration**

Create `integrations/agent-plugin/plugin.json` with:

- Agent Plugins 1.0.0 schema identifier.
- `name: "review-buddy"` and the current package version.
- Harness-neutral description and the existing author's identity.
- The existing project repository URL.
- No invented license declaration; include one only when supported by the repository's licensing.

Create `integrations/agent-plugin/mcp.json` with this proposed complete configuration:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "review-buddy": {
      "type": "stdio",
      "command": "bun",
      "args": [
        "run",
        "${PLUGIN_ROOT}/src/mcp/server.js",
        "--standalone"
      ]
    }
  }
}
```

The default is detached mode in every portable client. Preserve `--standalone=blocking` in the runtime as an advanced option where the host supports sufficiently long tool calls. Document its configuration outside portable JSON; do not introduce a second default server or silently remove the existing capability. Add a client extension only if that client documents the namespace and exact supported fields. [Extension rules](https://agent-plugins.org/plugin-authors/client-extensions)

**6. Replace the harness prompts with one skill**

Create `integrations/agent-plugin/skills/review-buddy/SKILL.md`, using the existing standalone template as its behavioral starting point. Make it the maintained source for non-Claude review instructions.

The skill will:

1. Read the review target from the user's request: working tree, PR number/URL, or base ref.
2. Resolve the user's repository root with Git in the workspace and pass its absolute path as payload `cwd`. Explain that this differs from the plugin process directory.
3. Collect the same diff the server will capture. Correct the standalone template's existing `git diff` mismatch: use `git diff HEAD` for the normal working-tree case, with equivalent handling of a configured base and untracked files. Preserve branch and PR source references.
4. Retain the current thematic grouping, risk ratings, Prologue structure, hunk anchors, generated-file handling, and reference-not-reproduce rules.
5. Find `submit_review` on the Review Buddy server using the client's exposed tool identity, without hardcoding Claude's namespaced tool spelling.
6. Submit `{ cwd, source, prologue, chapters }`; relay the returned URL and finish in detached mode.
7. Handle validation errors and resolution notes. Retain the bounded feedback loop when an explicitly configured blocking server returns a verdict.

Use portable frontmatter and instructions, removing generated placeholders, Copilot `mode: agent`, and dependence on `$ARGUMENTS`. Do not add a new slash-command extension just to preserve the old spelling; document each client's actual skill invocation.

**7. Build and distribute a complete package**

Add `scripts/build-agent-plugin.ts` and `bun run build:plugin`. The script should:

1. Validate source metadata and agreement with root `package.json`.
2. Build into a clean staging directory within the designated output area.
3. Bundle the shared MCP runtime and runtime dependencies for Bun, including the standalone handler.
4. Copy the manifest, MCP configuration, skill, runtime metadata, review schema, viewer, and required dependency notices using an explicit inclusion list.
5. Fail if the viewer or a required asset is absent. Do not ship the fallback HTML page as a successful package.
6. Validate the assembled package and replace the prior output only after success.
7. Produce a versioned archive and checksum for release distribution.

Package startup must not install packages, fetch schemas, or write into the installation directory. Test without access to the development dependency tree or cache. Any unbundled dynamic dependency must be resolved before declaring the bundle complete. Do not include `.git`, tests, caches, source credentials, Claude hooks, or the old harness integrations.

Keep generated output ignored, using the existing root `dist/` convention. Preserve the committed viewer policy: CI builds the UI and verifies freshness before packaging it. Local packaging can consume the committed viewer; maintainers changing UI code still rebuild it first.

Extend `scripts/release.sh` to include the new manifest in version synchronization and build/validate the portable artifact after version updates, before committing, tagging, or pushing. Attach the archive and checksum to the GitHub release; preserve a local artifact when GitHub publication is disabled. Its dry run must describe these additional steps. Actual publication is not part of writing or implementing this plan.

For the initial delivery, use the extracted directory through each client's supported local plugin mechanism. This avoids inventing a universal marketplace format. A dedicated distribution branch or marketplace listing can be added later if needed for automatic Git-based updates; the existing Claude marketplace continues pointing at the existing root.

**8. Client setup and migration**

Rewrite `docs/HARNESSES.md` around obtaining and enabling the portable package. Provide verified setup instructions for each supported client and record the tested client version.

| Client | Installation path to document and verify |
| --- | --- |
| Cursor | Copy the complete package into its documented local plugin directory, reload, and confirm skill and MCP discovery. [Cursor documentation](https://cursor.com/docs/plugins) |
| VS Code Copilot | Register the complete directory through `chat.pluginLocations`, then confirm the skill and MCP server appear. [VS Code documentation](https://code.visualstudio.com/docs/agent-customization/agent-plugins) |
| Codex | Verify the current local import/install workflow and skill invocation before publishing exact steps. The compatibility directory lists support, but that does not establish every installed Codex version's loader behavior. [Compatibility directory](https://agent-plugins.org/compatible-clients) |

Do not tell users to install this repository root as the portable package: it remains the Claude distribution. Do not equate local stdio support with support in a hosted session that cannot access the user's Git repository or browser.

Migration instructions must identify the old Review Buddy MCP entry and copied prompt for each harness. Users disable/remove those specific registrations when enabling the plugin, avoiding duplicate tools and commands. Leave unrelated MCP servers and personal configuration untouched. Include a rollback path: disable the new plugin and restore the previous registration.

Once the package and installation paths are verified, delete the three old configuration examples, three generated prompts, `integrations/prompt-template.md`, and `scripts/gen-prompts.ts`. Remove `gen:prompts` and `verify:prompts-fresh`; replace their CI role with package validation and smoke testing. Document legacy instructions in a migration section or link to the previous release, rather than continuing to maintain three primary setup paths.

Update `integrations/README.md`, the non-Claude README sections, `docs/ARCHITECTURE.md`, `docs/architecture.html`, `docs/TROUBLESHOOTING.md`, `docs/build-plan.md`, and architecture notes in `CLAUDE.md` where they describe the old setup. Refresh outdated blanket claims about other clients lacking hooks; detached mode is our portable design choice. Do not change the Claude setup itself.

**9. Verification and acceptance criteria**

Add focused packaging tests and a dedicated verification command, for example `bun run verify:plugin`. Use locally pinned official schemas with a Draft 2020-12-capable development validator. Schema validation must be complemented by filesystem and runtime tests: the published schemas explicitly leave semantic checks to the implementation. [Plugin schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json), [MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json)

| Check | Required evidence |
| --- | --- |
| Schema and skill validity | Both manifests validate; skill name/description/layout validate; invalid field and escaping-path fixtures fail |
| Package completeness | Required runtime, schema, metadata, viewer, assets, and notices exist; package paths resolve inside the root |
| Relocation | Launch a copied artifact from a temporary path containing spaces, outside the source checkout |
| Independence | No development `node_modules`, network dependency resolution, or installation-directory writes are needed |
| MCP startup | Initialize over stdio and list `submit_review`; logs do not corrupt protocol stdout |
| Repository selection | Supply a separate temporary Git repository as payload `cwd`; returned review contains that repo's changes |
| Review behavior | Worktree including staged/untracked changes and branch review work; PR source selection has deterministic coverage, with a real PR smoke test when credentials are available |
| Browser/API | Returned URL serves the real viewer, its assets, authoritative review JSON, and file expansion; token checks still apply |
| Lifecycle | A second review supersedes the first; disconnect stops the viewer; blocking mode still returns feedback |
| Claude regression | Setup-file diff is empty; existing hook tests and default MCP mode still pass; one review opens one viewer |
| Client integration | The same package's skill and MCP server load in each claimed client; no old manual registration is required |

Use `REVIEW_BUDDY_NO_OPEN=1` during automated smoke tests, with bounded waits and subprocess cleanup in failure paths. Reuse existing runtime tests where they already cover behavior; the new coverage targets packaging, relocation, and real MCP transport.

Run the existing full CI gate plus the plugin checks. Ensure new script tests are actually included by a test command, since the current root test script explicitly names only `src/server`, `src/cli`, and `src/mcp`. Include build scripts in an appropriate typecheck. Keep Linux CI coverage and record macOS client checks; verify Windows path handling before making Windows-specific installation claims.

Do not retire a client's working legacy route or label its plugin setup verified until the install-and-discovery smoke check succeeds. If a required client version lacks the loader, document that minimum-version limitation and retain a clearly marked temporary fallback for that client.

**10. Implementation sequence**

1. **Package proof:** verify client installation entry points, create portable inputs, prove Bun bundling and relocated startup, and confirm Claude discovery is unaffected.
2. **Portable workflow:** finalize the shared standalone skill and MCP configuration; add package conformance and end-to-end smoke tests.
3. **Build and release integration:** add deterministic packaging, version synchronization, archive/checksum production, and CI checks.
4. **Migration:** verify each client, replace the old setup documentation, remove superseded generated files/scripts where verification permits, and add rollback instructions.
5. **Final regression pass:** run the complete gate, inspect Claude setup diffs, and record client versions and any unverified platform coverage.

The main risks are bundle path/dependency handling, accidentally reviewing the plugin directory, duplicate legacy registrations, and differences in client import support. The first two are resolved by isolated package tests; the latter two by explicit migration instructions and client smoke tests. No runtime rewrite or new client-specific hook system is needed for the proposed design.

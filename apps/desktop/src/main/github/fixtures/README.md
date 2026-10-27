# GitHub API fixtures (api-source.test.ts)

Recorded from the real GitHub API (`zbenhajsalah-cc/review-buddy`, commits
`dd0aba0` → `7e8e705`, the last commit of PR #28: a renamed file with changes,
an HTML change and two source files):

- `pr-28.diff`: `GET /compare/dd0aba0…7e8e705` with
  `Accept: application/vnd.github.diff`. Same format as the PR diff endpoint.
  GitHub's own counts for it are 4 files, +35 −5.
- `compare-page2.json`: `GET /compare/…?per_page=1&page=2` (the merge base),
  trimmed to the fields the source reads (no commit authors).
- `ReviewViewer.tsx@<sha>.txt`: `GET /contents/packages/viewer/src/ReviewViewer.tsx?ref=<sha>`
  with `Accept: application/vnd.github.raw+json` (byte-identical to `git show`).
- `contents-404.json`: the contents endpoint for a path that does not exist.

Not recorded (no PR in this repo the recording session could read):

- `pr-28.json`: written to GitHub's documented "Get a pull request" shape,
  with the real SHAs, branch names and counts of that commit.
- `pr-diff-too-large-406.json`: GitHub's documented `too_large` error for the
  PR diff endpoint.

# Contributing and releasing Pocket Code

Read [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md) before changing the interface.
The [manual](docs/manual/README.md) describes current behavior, one page per feature; the
[operations guide](docs/operations.md) covers the persistent-process lifecycle.

## Bugs, feature requests and security problems

Open bugs and feature requests in [GitHub Issues](https://github.com/bbesner/pocket-code/issues)
using the issue forms; the app's **Settings → Help & updates → Bugs & feature requests** section opens them
with the version filled in. Search existing issues first. For a change larger than a fix,
open an issue before the pull request so the scope can be agreed. Security problems go
through **Security → Report a vulnerability**, never a public issue ([SECURITY.md](SECURITY.md)).

## Work locally

Use a feature branch or worktree and open a pull request. Keep `.env`, transcripts,
queues, logs, uploads and private screenshots out of commits. Never point a test
installation at production data or run two daemons against one data directory.

Node.js 22.12+ is required for the browser-test tooling. Install Chrome/Chromium and
point `PUPPETEER_EXECUTABLE_PATH` to its binary if it is not `/opt/google/chrome/chrome`.

```bash
npm ci
npm run check:release
npm test
PUPPETEER_EXECUTABLE_PATH=/path/to/chrome npm run test:browser
python3 inbox-watch/tests/test_schedule.py
python3 inbox-watch/tests/test_connector.py
python3 inbox-watch/tests/test_label.py
python3 inbox-watch/tests/test_process.py
python3 inbox-watch/tests/test_delivery.py
python3 inbox-watch/tests/test_archive.py
python3 inbox-watch/tests/test_digest_items.py
```

Inbox Watch's watcher (`inbox-watch/`, Python 3.11+) is part of the repository. Its tests need no mailbox,
model or network. Keep its prompts and examples free of real people, customers and addresses: they are
public like everything else here.

The HTTP/provider tests use temporary data and fake CLIs. The browser suite serves
the actual frontend with synthetic responses, then tests recovery, responsive changes,
questions/approvals, saved state and accessibility. No production credentials or model
calls are required. Browser assertions include 360/390/768/1440px layouts and additional
split-view transitions up to 2560px. Screenshots default to a temporary directory;
set `POCKET_SCREENSHOTS` to retain them in a chosen location.

Voice tests use `test/fake-voice.mjs`, a stand-in engine with the same HTTP API as
`voice/voice_server.py`, so no models are needed; the browser suite uses Chrome's fake microphone.
To try the real engine, run `scripts/voice-setup.sh` and point `POCKET_VOICE_HOME` at the install.

For an isolated manual server, set `POCKET_ENV_FILE=''`, fresh test credentials,
`POCKET_DATA_DIR`, `POCKET_SESSION_ROOT`, `POCKET_DOCUMENTS_DIR`, an unused `PORT`, and
explicit provider binaries/settings. Also set `POCKET_SKILLS=0`: without it, a daemon with
Projects, Files, Tasks or the Vault switched on writes the Pocket agent skills into the real
`~/.claude/skills` and `$CODEX_HOME/skills`. `npm test` sets it for you. Merely changing
PORT does not isolate credentials or session data.

The daemon overwrites `cli-token` and `cli-url` in its data directory at every start, and
`pocket-board`, `pocket-docs`, `pocket-tasks`, `pocket-vault`, `pocket-coord` and the browser relay read them. So the rule of one
daemon per data directory covers the commands too: a second daemon on the same directory
replaces the first one's token and the commands stop working against it.

## Automated checks

The GitHub Actions workflow runs on pull requests and pushes to main using a Linux
runner, Node 22 and the runner's Chrome. It checks release metadata and local Markdown
links, runs the repository tests, and executes the browser suite including axe scans.
Browser evidence is retained as a short-lived CI artifact. Fixtures must remain synthetic.

The workflow follows GitHub's [Node.js CI guidance](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs);
Chrome availability comes from the [Ubuntu runner image](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md).
Action references are pinned to verified commit SHAs. Keep permissions read-only and
update those pins deliberately. CI success does not deploy an installation.

`npm run check:release` verifies:

- matching versions in package metadata, lockfile, release JSON, README and changelog;
- matching frontend asset references, service-worker cache and shell entries;
- matching in-app release notes in `server.mjs` and `public/release.json`;
- existing local destinations for Markdown links and images.

It does not validate external URLs, prove that a GitHub release exists, or replace
runtime tests. Pass `--released` to reject an unreleased top changelog entry when
preparing the final release commit.

## The manual

[docs/manual](docs/manual/README.md) is written for people and for the agents working beside them; Pocket points
every agent it starts, and every Pocket skill, at it. Each page opens with a block naming the release it was last checked
against and the source files it describes:

```
<!-- manual
checked: 1.79.2
sources: vault.mjs, public/vault.js, scripts/pocket-vault.mjs, skills/pocket-vault/SKILL.md
-->
```

When a change alters what a page says, update the page in the same pull request. `npm run check:manual -- --base
origin/main` lists the pages whose sources your branch touched without touching the page, and CI posts the same list
as warnings on the pull request. For each one, update the page, or confirm it is still right and raise `checked`;
either clears it. Without `--base` the command lists every page whose sources changed since the page last did.
`check:release` fails on a page without the block, a `checked` release that is not in the changelog, a source that
no longer exists, a page the index does not link, or a link to a heading that is gone. A new feature gets a page and
a line in the index; keep the public-repository rule (no real people, customers or servers) in examples.

## UI and screenshots

Preserve the warm ink identity and task-focused layout. Verify keyboard access,
contrast, focus restoration, narrow windows and browser interruption. Resize existing
views: do not recreate their inputs or frames and lose drafts or reading position.
Run screenshots and automated accessibility checks against the rendered UI.

Use demo projects and synthetic sessions for README images. Capture the current UI,
provide descriptive alt text, and update `docs/images/README.md` with the version and
capture method. Label historical screenshots and design records; do not present them
as the current interface. Physical keyboards/IME, real assistive technology and OS
notification delivery need separate device validation.

When the UI shown in the README screenshots changes, regenerate them from the repository
root with the docs-only mode, which captures the set and skips the rest of the browser suite:

```bash
POCKET_DOCS_SCREENSHOTS="$PWD/docs/images" POCKET_DOCS_ONLY=1 node test/browser.mjs
```

Inspect the images, then update the version in `docs/images/README.md`.

When updating Marked or DOMPurify, run `npm run vendor`, review the vendored code and
license changes, and rerun Markdown security and browser checks. Do not silently change
vendor files or runtime dependencies as part of a documentation edit.

## Release checklist

1. Finish the feature/fix PR and documentation, including the README, the manual pages
   `npm run check:manual -- --base origin/main` lists, screenshots, defaults and lifecycle
   changes. Keep historical plans labelled.
2. Set one semantic version in `package.json`, the lockfile root and root package entry,
   and `public/release.json`. Update the README's checkout version and first changelog
   entry. Do not imply publication while that entry says Unreleased.
3. For frontend changes, choose a new asset number and update all versioned assets in
   `public/index.html`, `public/sw.js` and `public/release.json`. Keep the server's
   release-note array identical to the release JSON notes. Note any runtime migration.
4. Run the release check, repository tests and browser suite. Inspect the screenshots,
   accessibility output, changed-files list and PR diff. Document device checks not run.
5. Immediately before merging, update the PR against its current target branch and
   wait for checks on that source. Obtain the repository's required review/release
   approval. Record the actual release date in the changelog and run
   `npm run check:release -- --released` on the final release commit.
6. Merge through the PR, then create the matching `vX.Y.Z` tag and GitHub release from
   the merged main commit, not the pre-merge branch. Release notes should describe
   changed behavior, migrations and known limitations. Verify the tag's target and
   release contents; do not overwrite an existing published tag.
7. Deploy separately under the installation's operating procedure and authorization.
   Check both daemon and frontend version after deployment, preserve state, and record
   verification and rollback details. Publishing a release does not update a running box.

The asset number invalidates browser caches; it is not the semantic version. Reverting
frontend behavior still requires a fresh asset number. A copied `.env` or restored old
queue is not part of an application rollback.

## Every feature on every agent

Pocket runs three agents: Claude Code, Codex and OpenRouter (through OpenCode). A feature is built for all
of them. Server code reaches the agent behind a conversation through `engineOf(id)` in `server.mjs`
(`ENGINE_OPS`: its turn, folder, transcript, how a queued message starts) rather than branching on the id.
When an agent genuinely cannot do something, list it `false` in that agent's `features` in `engines.mjs`;
the app reads them from `/api/engines` and hides the feature there instead of offering it and failing.
`test/engine-parity.test.mjs` runs one checklist against all three agents' test fakes; add your feature to
it, and give each fake the marker your check needs.

# Action approvals

Select **Review actions** or **Full access** in the composer or under Conversation options
→ Permissions for the next reply. A choice applies to the next new/resumed turn and
is captured with queued instructions. Steering a running turn does not change its
permissions. The instance default applies when an older client or queue item has no
explicit choice. Review is the default; `POCKET_APPROVAL_MODE=full` retains unattended
behavior. `POCKET_ALLOW_FULL_ACCESS=0` rejects Full access at the API as well as hiding
it in the picker. This setting does not retroactively alter running turns.

When a native request arrives, the session moves to Needs approval and shows a **Waiting
for your OK** banner with **Review**. Open it to inspect the command, file changes, or tool
arguments, then choose **Don't allow** or the card's allow button. The allow button names its
scope: **Allow** for a command, file change or tool call, which covers that one pending request;
**Allow network access** for a Codex network request, which can release several pending
requests to the displayed destination; and **Allow for this reply** for a Codex request for
additional permissions, which grants the listed access until the turn ends. For those two
broader grants the card states the scope above the details; for a single request it is under
**Show details**. Closing the sheet, sleeping the phone or losing
the browser connection does not approve anything. Refresh reloads the live pending requests.
Push notifications contain no command or argument details. A decision being sent is
not evidence of successful execution; check the conversation for the result.

## Provider behavior

- Claude uses `default` permission mode with ask rules for Bash, PowerShell, Edit,
  Write, NotebookEdit, Agent/Task, WebFetch/WebSearch and MCP tools. AskUserQuestion
  remains a separate native question. Deny rules and organization requirements still
  apply. Full access uses the previous bypassPermissions behavior. Actions the owner lists
  under [Actions that run without asking](#actions-that-run-without-asking) are answered Allow
  by Pocket instead of showing a card; the ask rules stay in place.
- Codex uses a read-only sandbox with the `untrusted` approval policy and the user
  reviewer. It can perform safe reads and actions allowed by existing provider tool
  rules without prompting. Command and file-change approvals use the native `accept`
  or `decline` response, never a persistent rule amendment. File previews are taken
  from the matching native item; missing/oversized previews cannot be approved here.
- A Codex network request may release multiple pending requests to the displayed
  destination. An explicit additional-permissions request can grant the displayed
  subset for the rest of the turn, with that broader scope stated on the card. No
  session-wide permission grant is offered. Unsupported elicitation requests are cancelled.
  Existing native user-input questions remain supported, including those the provider
  uses for its own connected-tool confirmations.

These are native execution controls, not semantic classification of email, payments,
or other business actions. An approved script, command, or delegation can perform
multiple operations. Existing tools and provider allow-rules are trusted. Account
isolation, service-account protection, employee roles, and mandatory per-resource
Google approvals belong in a separate connection service and restricted runtime.

Protocol references: [Claude permissions](https://code.claude.com/docs/en/permissions),
[Codex App Server](https://developers.openai.com/codex/app-server/). Wire schemas were
checked against the installed runtimes; no permissive fallback is used when a request
is malformed or unsupported.

## Actions that run without asking

Under Review actions every Bash command, MCP tool call and web lookup shows a card, including
harmless reads. **Settings → Agents & instance → Actions that run without asking** lists
read-only actions that Pocket approves itself in Review actions: when Claude asks to run a listed
action, Pocket answers Allow without a card and records it; everything else shows the card as
before. The list is empty by default, which is the behavior before 1.56.

This is a convenience, not a security boundary. A listed command runs with whatever arguments
the agent gives it, so list only commands that cannot change anything whatever they are given:
`Bash(git:*)` would also allow `git push`, and `Bash(curl:*)` can send data anywhere. It covers
Claude turns in Review actions only. Full access already runs everything without asking; Codex
turns are not covered and keep their own approvals.

Rules are a subset of [Claude Code's permission rules](https://code.claude.com/docs/en/permissions):

| Rule | Runs without asking |
|---|---|
| `Bash(acme-lookup:*)` | `acme-lookup` alone or followed by arguments. `Bash(acme-lookup *)` means the same. |
| `Bash(shop-site product:*)` | `shop-site product` and `shop-site product list`, not `shop-site productx` or `shop-site orders` |
| `Bash(status-report today)` | exactly `status-report today` |
| `mcp__notes__search` | that one MCP tool |
| `mcp__notes__*` | every tool from the `notes` MCP server (not `mcp__notesx__…`) |
| `WebSearch`, `WebFetch` | those tools, whatever they look up. WebFetch sends the URL, and anything in it, out. |

Edit, Write, MultiEdit, NotebookEdit, Agent/Task and PowerShell cannot be listed; a blanket `Bash`, `Bash(*)`
or `mcp__*` cannot either. Read, Glob, Grep and LS are refused because they do not need a rule. Settings explains why under the field when a rule is refused.

A Bash command runs without asking only when it is one plain command whose first words are the
listed ones, compared as written. Pocket shows the card instead when the command:

- contains any of `;` `&` `|` `` ` `` `$` `(` `)` `<` `>` `{` `}` `\`, a line break or another
  control character, so chained commands, pipes, substitution, redirection and here-documents
  always ask (inside quotes too);
- has an unquoted `*`, `?` or `[` (a glob could expand into an option) or an unclosed quote;
- has a word that starts with an unquoted `#` (Bash ignores the rest of the line as a comment; 1.73.8);
- starts with a `VAR=value` or `VAR+=value` setting (`+=` since 1.73.8), or names the command differently: `/usr/local/bin/acme-lookup`,
  `./acme-lookup`, `sudo acme-lookup` or `"acme-lookup"` do not match `Bash(acme-lookup:*)`.
  Paths and aliases are not resolved;
- carries a Bash option other than its description, timeout or background flag.

A rule written that way is refused the same way. `mcp__server__*` covers that server's tools whose
names contain no `__` (1.73.8), so it cannot reach a second server named `server__other`.

Quoted arguments are fine: `acme-lookup quote "Acme Corp"` matches. Agents that start a command
with `cd somewhere &&` get the card; the agent can run the command on its own instead.

Which list applies, highest first:

1. The list saved in Settings (`trustedActions` in `pocket-settings.json` in the data directory, which Git ignores).
   A saved empty list means every action asks, even when the server has a default.
2. `POCKET_TRUSTED_ACTIONS` in `.env`, for provisioning: one rule per line, or several separated
   by commas outside parentheses. A rule Pocket cannot use is logged at start, shown in Settings
   and skipped. Restart after changing it.
3. No list: every action asks.

Settings says where the list comes from. **Use the server's list** forgets the saved list. A change
applies to the next request, including one from a turn that is already running.

Each automatic approval is recorded in `approval-decisions.jsonl` before Pocket answers the CLI,
as `"event":"auto-allowed"`, `"decision":"allow"`, `"source":"auto-trusted"`, the tool name and
the rule that matched, with the same identifiers and hash as a card and no command or arguments.
If the record cannot be written, nothing is approved automatically: Pocket falls back to the card,
and denies the request if the card cannot be recorded either. A request that arrives while
its own card is already open stays on the card.

In Full access, a request the CLI still raises (its bypass-immune safety checks, or a plugin hook
that insists on asking) is answered the same way: `"source":"full-access"`, and the rule is the
CLI's reason type (`full-access:safetyCheck`). Full access is the owner's standing Allow, so no
card is shown; the trusted list plays no part in that mode.

## Recovery and audit

Each request belongs to one session, native request and live turn. Replies are
idempotent within that connection: repeated matching decisions do not send another
native response, conflicting decisions are rejected, and old-turn IDs cannot approve
new work. Decisions are recorded before being written to the provider. If the audit
cannot be written, nothing is approved. An uncertain pipe write cannot be retried;
stop the turn and inspect the result before starting again.

`approval-decisions.jsonl` in the instance data directory records request identifiers,
turn IDs, kinds, hashes, timestamps and decisions, including automatic approvals with the rule
that matched. It excludes commands, arguments,
file contents and credentials. Keep it with instance backups. Full request details
remain in the live inbox, private Claude turn logs and provider transcript, not
browser storage or notifications. Approval HTTP responses use `Cache-Control: no-store`.

Pending approvals do not survive a daemon restart as actionable requests. The
restarted daemon reattaches to the running Claude or Codex process and answers every
request that was sent before the restart with a deny (Codex: the fail-closed decline
for that request kind, skipping requests the log shows were already resolved), so the
turn carries on and the agent can ask again. A second answer to a request the old
daemon had already answered is ignored by the CLI (verified on Claude Code 2.1.281).
Only a process whose input pipe cannot be reopened is marked with an interrupted
approval (or question) connection. Stop an interrupted reply, review completed work, then
send a new instruction. Never reconnect an old approval to a new process. Deploy
while owned turns are idle, especially when questions or approvals are pending.

## Validation and rollback

Unit/API coverage checks session binding, malformed and oversized requests, audit
failure, duplicate and concurrent replies, uncertain transport, cancellation, denial,
browser reconnect and daemon restart. Browser fixtures check escaped action details,
keyboard controls, responsive cards, policy selection and disabled uncertain replies.
Real isolated Claude and Codex runs verified that file writes and shell writes stay
blocked before Allow, and file-write denials do not create the target.

Before rolling back below 1.4, stop owned turns, back up the current queue and convert
queued review-mode or unspecified-policy items to `uncertain` with an explanatory
error and incremented revision. Older code otherwise ignores the policy and runs with
full access. Back up and remove pending `.retry.json` auto-resume markers for review
turns before an older daemon starts. Preserve current transcripts, receipts, metadata
and audit records; do not overwrite them with an old state snapshot.

Run confirmation (build25): the always-visible status strip polls authenticated
server ownership/state every 5 seconds. Only a new server checkedAt confirms a run;
local age ticks, transcript activity and SSE keepalives cannot renew it. Failed
checks or 15 seconds without proof remove running lamps/counts and mark status
unconfirmed. Input requests and external/unconfirmed activity stay distinct.
The delivery receipt says Message delivered and clears on a confirmed outcome;
it does not claim work is still running. Phone/browser suspension may pause UI
polling; returning to the app fetches current state. Server turns continue
independently of that browser lifecycle.

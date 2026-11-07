# Security

## Reporting a vulnerability

Please report security problems privately via GitHub: **Security → Report a
vulnerability** on this repository. Don't open a public issue. You'll get an
acknowledgment, and a fix or an explanation, as soon as it can be looked at.

## Security model

Pocket Code runs AI coding agents on your server as the user the service runs as. New
turns default to **Review actions**: Claude asks before commands, edits, delegated tasks
and external tools (an `ask` rule, which wins over any `allow` rule in your CLI settings,
verified on Claude Code 2.1.281), and Codex runs in a read-only sandbox with an untrusted
approval policy. **Full access** (`--permission-mode bypassPermissions`, Codex
`danger-full-access`) is a per-turn choice the owner can make, or disallow for the
instance with `POCKET_ALLOW_FULL_ACCESS=0`. Either way, anyone who can sign in can run
commands on the box: an approved command has whatever effects it has, and the agent
has the OS user's credentials. Treat the password like an SSH key.

Built in:
- The server listens on `127.0.0.1` only. Expose it through an HTTPS tunnel or reverse proxy.
- Constant-time password comparison, and a limit of 20 wrong passwords per hour per address (a correct one does not count).
  Since 1.89 the address is the caller's `cf-connecting-ip` only when Pocket can trust it: the
  request carries a Cloudflare Access token that verifies for this application (One sign-in is
  set up), or `POCKET_TRUSTED_PROXY=1` says the port is reachable only through a proxy that sets
  the header itself. Otherwise it is the connection's own address, so a caller that types a new
  header on each try no longer gets a fresh count. The trade-off: through a tunnel with neither,
  every caller arrives from the tunnel's `127.0.0.1` and shares one count, so a stranger who
  uses up the 20 tries locks the owner's password page for the hour too (a signed-in browser
  is not affected). Set `POCKET_TRUSTED_PROXY=1` only when nothing but that proxy can reach the
  port: with it, anything that reaches the port directly can again choose its own address.
- An HMAC-signed, `HttpOnly`, `Secure`, `SameSite=Lax` session cookie with a 90-day expiry.
- A Content-Security-Policy on every response: same-origin scripts, styles and
  connections only, no remote images (so Markdown written by an agent cannot load an
  image from, and leak text to, an outside host), and `frame-ancestors 'self'` plus
  whatever `POCKET_FRAME_ANCESTORS` names, so no other page can frame the approval UI.
- Unknown or malformed native permission requests are denied; a request the daemon
  cannot preview in full is never approvable.
- The daemon's own secrets (`POCKET_PASSWORD`, `POCKET_SECRET`, `VAPID_PRIVATE`) are
  removed from the environment of every agent process. `POCKET_VAULT_KEY` (1.39) is
  removed from the daemon's own environment at start, so nothing it starts inherits it.
  That keeps them out of prompts and logs; it is not isolation, since the agent runs as
  the same user and can read `.env` if it goes looking.

Recommended:
- A long random `POCKET_PASSWORD` and `POCKET_SECRET`, and a `.env` with mode `600`.
- An identity layer in front (for example Cloudflare Access) for a second factor.
- Running as a user whose access you're comfortable handing to an agent.

Changing `POCKET_SECRET` signs everyone out.

## Projects, Files, Tasks and the Vault

These libraries are off until the owner switches them on in Settings. Turning one on adds
the following.

**File visibility.** Each file in Files is one of three kinds, and new files are private.
- *Private*: opened only behind Pocket's login.
- *Link*: opened at `/share/<token>` by anyone who has the address. The token is
  unguessable, only a hash of it is stored, and the link can carry an expiry.
- *Public*: opened at `/files/<name>` by anyone, with no token.

Link and public files are served **without a login**. Switch Files off and both stop
answering. Responses are `no-store`, `noindex`, and not framable by other sites. An HTML
file is served with a `sandbox` Content-Security-Policy and opens in a sandboxed frame, so
its own scripts can run but it cannot read Pocket's cookie, storage or API. The policy does not
restrict the page's own network requests, so treat a shared HTML file as published
content. Share only what you would be comfortable sending as an email attachment, and make
a file private again when you are done.

**Identity proxy in front.** If you put Cloudflare Access or a similar layer in front of
Pocket, check how it treats `/share/` and `/files/`. Pocket serves those paths without a
login, so an outside viewer can open a link or public file only if the proxy lets those
paths through to Pocket; otherwise the proxy will ask them to sign in first. Private files
and the rest of the app stay behind Pocket's own login whatever the proxy allows, since
Pocket checks its cookie itself. Test a link in a private window before you send it.
Since 1.76.3 a public, shared or signed-in file is sent only when the stored copy is a regular
file inside the library reached through no link; a stored copy replaced by a symlink answers 404.
Since 1.89 that check is made on the file as opened (no link followed at the last step, the
real path of the open file inside the library), and the send, and the Files grid's preview
picture, read that same open file; the check used to look at the name, and the send reopened
it, so a swap in between still served the link's target. A file card in a conversation works
the same way: the file must be a regular file whose real path is in the home directory outside
any hidden folder, it is opened once, and its download, inline view and picture all come from
that open file. A file card that is itself a symlink is refused.

**Preview pictures.** Thumbnails (the Files grid and a conversation's file cards) are made by
Chrome, `pdftoppm` or ImageMagick from a private copy of the checked file, never by its name.
Since 1.89 an image's format is read from the file's first bytes and must be PNG, JPEG, GIF or
WebP; ImageMagick is told that coder (`png:`, `jpeg:`, `gif:`, `webp:`), so a `.png` holding
PostScript or SVG gets no picture instead of reaching Ghostscript or the SVG reader (which can
read other local files into the picture). A JPEG or WebP saved as `.png` is pictured as what it is. You can also restrict ImageMagick's coders in its `policy.xml`.

**CLI token.** The `pocket-board`, `pocket-docs`, `pocket-tasks`, `pocket-coord` and `pocket-vault` commands
use a bearer token that the daemon writes to `cli-token` in the data directory (mode `0600`)
and replaces at every start. It is accepted only on the Projects, Files, Tasks and Vault
routes, and only on a direct loopback connection: a request carrying a `cf-connecting-ip` or
`x-forwarded-for` header, as one arriving through a tunnel or proxy does, is refused. It
never replaces the login cookie anywhere else. Anyone who can read that file as the
service's OS user can read and change those libraries, and so can the agents, which run
as that user. On the Vault routes the token can only do what an agent may (see below); it
never returns a value. Don't put the data directory on a shared path.

**Reminder hook.** `POCKET_REMINDER_HOOK`, if set, is run through a shell when a project
reminder or task comes due, with the item as JSON on standard input. It is a command from
the operator's own configuration, not from the browser or an agent, so keep `.env` and the
process environment writable only by the operator. Since 1.37.1 the hook gets the same
filtered environment as agent processes, without `POCKET_PASSWORD`, `POCKET_SECRET` or
`VAPID_PRIVATE` (before that it inherited them). Use a trusted command, and have it
treat the reminder text as untrusted data, because an agent or a person can write it.
Since 1.73.7 each run is ended, with everything it started, after
`POCKET_REMINDER_HOOK_TIMEOUT_MS` (default 60000) and when the daemon exits.

**Agent skills.** While a library is on, Pocket writes a skill into the Claude Code and
Codex skill folders of the service's user so agents know how to use it. It only changes
folders it created (marked `.pocket-managed`). Set `POCKET_SKILLS=0` to stop it.

### Vault

The Vault (1.39) keeps credentials so that agents can use them without the values reaching
the model provider, transcripts, turn logs, Pocket's search, MemStem or backups. It is off
until the owner switches it on. Since 1.44, switching it on with no key and no store creates
the key, saves it to the install's `.env` (mode `0600`) and shows a recovery key once.

**Secret guard (1.42).** Pasted or typed text that looks like a credential is held in the browser until the owner
stores it in the Vault, pastes it anyway or cancels, and the server refuses such a message unless it is sent anyway.
It reduces the chance of a secret reaching the model provider, the transcript or MemStem; it is pattern-based and
cannot catch every secret.

**Passphrase mode (1.40).** With a passphrase set, the store is encrypted under a key derived
from it (scrypt) that the daemon holds in memory only while unlocked; after a restart, a lock
or the idle time, nothing on the disk can open the store, including an agent that reads
`.env`. While unlocked the daemon serves agents as before, so the passphrase protects a
locked store, not a running one. Wrong passphrases (and recovery keys that do not open the
store) are limited to ten wrong tries an hour per signed-in session (since 1.89; it was per
address, and a caller could name a new address on each try). A new session can only be had
through the login and its own limit, or a Cloudflare Access sign-in. As a backstop for sessions
minted without the login's limit (a replayed Access token), the whole instance also allows only
50 wrong tries an hour across all sessions, unlocks and key restores together; past that every
unlock and restore answers "Too many tries. Wait an hour.", the owner's included, and the daemon
log says so.
Exports are encrypted under their own passphrase; a lost passphrase cannot be recovered.

**At rest.** The store is one file, `vault.enc`, encrypted with AES-256-GCM under
`POCKET_VAULT_KEY` (32 random bytes): items and their approved commands together, with
no plain-text names or other metadata. A file that has been altered, or a wrong key, fails
closed. The key lives in `.env`, which Pocket's backups leave out, never in the data
directory; keep the recovery key apart from your backups, since a restore without it yields
nothing. **Rotate key** writes the new key to `.env` before the store is rewritten, keeping
the old one as `POCKET_VAULT_KEY_PREVIOUS` only until the rewrite finishes, so a crash in
between still opens the store. **Restore key** accepts a recovery key only if it opens the
existing store, and Pocket never creates a new key over an existing store. Since 1.73.6 the
store takes a new key, salt or item only once the file holds it, so a failed write leaves memory
and disk agreeing (the recovery key is always the key the store is under), the file is synced
around its rename, and a key set in the process environment rather than `.env` is refused
rotation with 409 rather than left as a key the next start will not find. Since 1.76.3 a
rotation that stopped between its two `.env` saves is rolled back at the next start to the key
that opened the store, so a passphrase set and later removed never moves the store to a key the
owner was not shown. Keys are shown in the browser or downloaded by the owner; nothing prints
them to a terminal or a log.

**The key in memory.** The daemon reads `POCKET_VAULT_KEY` (and `POCKET_VAULT_KEY_PREVIOUS`,
when present) at start and deletes them from its own environment, so agent turns, helper models, hooks and every other process it starts
cannot inherit it. Since 1.73.3 the same is done for `POCKET_SMTP_URL` (its URL carries the mail password), `POCKET_SMTP_FROM`
and `POCKET_ROUTER_KEY`; the daemon's own login, cookie and push secrets were never passed on.

**What agents can do.** An agent has no way to read a value. It can list items (names,
kinds, URLs, tags, policy, expiry, last use; never values or the owner's notes), create a new
item (an existing name is refused, so an agent cannot replace a credential), read its own
session's history, and ask the daemon to run a command with values in that command's
environment. The daemon starts the command itself, passes values only in the environment,
never in arguments, and returns the output with each value and its base64 and URL-encoded
forms replaced by `{{vault:name}}`, including a value carried inside longer base64 such as an HTTP
Basic header (1.82.1; values of 6 characters or more). The command leads its own process group (1.73.7): when it
exits, times out, passes the output cap or is stopped, everything still in that group is ended, so a
run cannot leave a daemon behind with the values in its environment. A program that deliberately
leaves the group (`setsid`, a double fork into a new session) is not followed. Reading a value, changing or removing an item, changing its
policy or recipes, answering requests and rotating the key need the owner's login cookie.

**What runs.** **Agent access** in Settings (1.41) sets the default, and each item can
override it. *Ask once per command*, the default, runs a command only if it exactly matches a
recipe the owner saved with *Always allow*; otherwise the owner is asked and the request
expires after 15 minutes; an answer stays good for 15 minutes after it is given (1.82.1). *Ask every time* asks for every run and offers no *Always allow*.
*Free rein* runs any command without asking (every use is still recorded). *Only you* refuses
agents. The owner answers from the Vault view, from the push notification's **Allow** and
**Deny** buttons, or by replying in the conversation that raised the request; only the owner's
own messages in that session count. Under Review actions the owner also approves the agent's
`pocket-vault run` call itself; under Full access the Vault's request is the only check, which
is why asking is the default. Calls from a terminal or code-server session on the host follow
the same rules and are recorded as `terminal`.

**Requests are bound (1.73.4).** A pending request belongs to the kind of use it was raised for (a
command run, or a browser fill) and to the session that raised it: `pocket-vault wait` or the relay's
retry from another session is refused, a run cannot be continued as a fill or the reverse, one answer
serves one continuation, and the items' policies are checked again at that moment, so an item made
owner-only or removed after the approval no longer releases. Terminal and code-server calls carry the
CLI token and no runner token, so they share one identity, `terminal`: any such process on the host
can continue a request another terminal process raised. An agent that needs an identity of its own
runs inside a Pocket session.

**Browser fills (1.43).** `scripts/pocket-mcp-proxy.mjs` relays an agent's browser tool and
asks `/api/vault/release` for each `{{vault:name.field}}` it finds in a tool call, under the
same rules; a fill is recorded as such. The value goes only into the call to the browser tool
and is replaced by the placeholder in everything the tool sends back. Values are typed into
fill tools only (1.73.5: `browser_type`, `browser_fill_form`, `type`, `fill`, or the list in
`POCKET_VAULT_FILL_TOOLS`), never handed to `browser_evaluate` or put in an address; and once a
value has been typed, the relay withholds images, audio and blobs from that server for the rest
of its life, because a screenshot of the page cannot be scrubbed. A page the agent is
driving can still read what was typed into it, so allow fills only on sites you trust with
that login. The relay and the commands find the daemon through `<data dir>/cli-url` (1.43.1),
never an inherited `PORT`.

**Record of use.** Every run, request, answer, owner view of a value, addition, change,
removal, restore and rotation is written to `vault-audit.jsonl` (mode `0600`, append-only)
with the session and the command, never with a value. If the record cannot be written, the
action does not happen.

**In the browser.** Vault responses are `no-store` and kept out of the service worker's
cache, changes are refused unless the `Origin` header is Pocket's own, and a value is fetched
one field at a time when the owner taps it (on the item, or into the editor to correct it) and is never stored in the browser. Notes and
command text are shown as text, never as HTML.

**Limits.** These are real, and the same as for the password above:
- Agents run as the same OS user as the daemon. An agent that goes looking can read `.env`,
  and with it the key and the store. The Vault keeps secrets out of prompts, transcripts,
  memory, backups and the provider, and makes their use visible. It is not process isolation.
- A command the daemon runs for an agent runs with the daemon's permissions, outside any
  sandbox the agent's CLI applies, and can do whatever the credential allows. Approve
  commands as you would approve giving that credential to the command.
- Output scrubbing reduces accidental exposure. It cannot stop a command that writes the value
  to a file, encodes it some other way, or sends it off the box.
- A secret pasted into a conversation, or one an agent read in a file before storing it, has
  already reached the provider and the transcript. Storing it protects later turns, not that
  one; rotate it. The secret guard catches common shapes of key, token and password, not every
  secret; use **Store in the Vault** instead of pasting. Terminal and code-server sessions
  outside Pocket are guarded only by the `pocket-vault` skill.

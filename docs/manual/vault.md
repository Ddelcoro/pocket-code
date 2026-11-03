<!-- manual
checked: 1.79.2
sources: vault.mjs, public/vault.js, scripts/pocket-vault.mjs, skills/pocket-vault/SKILL.md, public/secret-detect.js, scripts/pocket-mcp-proxy.mjs
-->
# Vault

The Vault keeps API keys, tokens, logins and secure notes encrypted on the Pocket Code server, so agents can use them by name without ever seeing a value. An agent asks Pocket to run a command with a secret in its environment, and gets the output back with the value replaced by `{{vault:name}}`. The value never reaches the model, the transcript, Pocket's logs or the agent's memory. Use it whenever an agent needs a credential to do real work for you.

## Turn it on

1. Open **Settings → Projects, files, tasks & vault** and tap **Vault**.
2. The first time, Pocket creates the Vault's encryption key, saves it to the `.env` file in the Pocket Code directory (mode `0600`) and opens the **Save your recovery key** sheet. Use **Copy** or **Download** and keep the key in your password manager, then tap **Done**.

The recovery key is the only way to open a backup of `vault.enc` if the server or its `.env` is lost. **Download** saves a text file named `pocket-vault-recovery-key-<host>-<date>.txt` with one `POCKET_VAULT_KEY=…` line.

Turning the Vault on (or off) closes idle agent processes, so each conversation's next message starts a process with the new instructions. A conversation that is replying at that moment keeps its current instructions until its process is next started. The switch also installs (or removes) the `pocket-vault` skill. See [For agents](for-agents.md).

The **Vault** switch's description tells you its state:

| Description | What it means |
|---|---|
| Off. Turning it on creates this install's encryption key… | No key and no store yet. Tapping it sets everything up. |
| This Vault's key is missing on this server… | A `vault.enc` exists but no key is set. Use **Restore key…** (below the switch). |
| Off. The Vault cannot be opened: … | A key is set but does not open the store. The switch stays disabled until the right key is in place. |

In Assistant mode the **Vault** switch is under **Settings → Features**; the rest of the Vault's settings stay in Developer mode. When Assistant mode is locked, ask the person who runs the install.

## Use it

Open the Vault from the rail's **Vault** entry, the **Vault** chip on the home screen, or `#/vault`. It opens like Tasks: as a tab, beside a conversation, or in a window of its own.

### Find a secret

- **Order.** The list is **Newest first** by default; switch **Order** to **A–Z** to sort by name. The choice is kept on each device.
- **New.** A secret stored in the last 24 hours carries a **New** mark, and its line says when and in which conversation it was added.
- **Search.** **Search secrets** narrows the list as you type. It matches the name, the kind, tags, the website and the conversation that stored it; with several words, all must match.
- **Links.** `#/vault/item/<name>` opens the Vault with that secret's sheet open and its row marked. When an agent stores a secret from a conversation, the conversation shows a card for it under the next reply; tap it to open the secret. Agents link a secret the same way in their replies.

### Add a secret

1. Tap **Add secret** (in the Vault view or the rail list).
2. Fill in **Name** (lowercase letters, numbers and hyphens, up to 64 characters, such as `billing-api`). Agents use this name.
3. Choose a **Kind**. The kind is fixed once saved.
4. Enter the values. **Show** unmasks what you typed.
5. Optionally add **Website**, **Tags** (comma-separated), **Notes**, **Who can use it** and **Expires**. A secret whose expiry is less than 14 days away, or past, is marked in the list.
6. Tap **Save to the Vault**.

| Kind | Fixed fields | How an agent names it |
|---|---|---|
| **API key** | value | `name` |
| **Token** | value | `name` |
| **Login** | username, password | `name.username`, `name.password` |
| **Credentials** | none; only the fields you add | `name.client_id`, `name.client_secret`, … |
| **Secure note** | text | `name` or `name.text` |

Any item can carry up to 20 **custom fields** beside its fixed ones: tap **Add field**, give it a name (a lowercase letter, then up to 31 lowercase letters, digits or underscores, such as `client_id`) and a value. When an item has more than one field, an agent must always name the field (`name.field`).

### Store a secret from a conversation

Never paste a secret into a message. Use **Store in the Vault** instead, from the composer's attach button (**Attach a file or screenshot → Store in the Vault**) or from the conversation's options. It opens the same add sheet, and once saved puts `{{vault:name}}` into the message box. A `{{vault:name}}` in your message tells the agent which stored secret to use.

### See, copy or edit a value

Tap a secret to open its sheet. Each field shows as dots; **Show** fetches that one field from the server and **Copy** copies it. A shown value is hidden again when the sheet closes or the app goes to the background. Every Show is recorded in the item's history.

**Edit** changes the name, values, custom fields, website, tags, notes and expiry. Value boxes start empty ("Unchanged"), and a box left empty keeps its value. **Show** on a saved field loads its current value into the box (recorded as a view) so you can correct it. To drop a custom field, use **Remove** beside it; fixed fields cannot be removed.

### Remove and restore

**Remove** moves a secret to **Removed**, where it stays for 30 days and is then deleted for good. **Restore** brings it back. A removed name cannot be reused until it is deleted. Agents cannot use a removed secret.

### Choose how freely agents use secrets

**Settings → Projects, files, tasks & vault → Vault → Agent access** sets the default for every secret:

| Agent access | Behavior |
|---|---|
| **Free rein** | Agents use any secret by name without asking. Every use is still recorded. |
| **Ask once per command** (default) | A command you approved before with **Always allow** runs at once; a new command needs your approval. |
| **Ask every time** | Every use needs your approval. **Always allow** is not offered. |

Each secret can override the default with **Change who can use it** on its sheet (or **Who can use it** in the editor): **Vault default**, **Free rein**, **Ask once per command**, **Ask every time** or **Only you**. **Only you** means agents cannot use it at all.

### Answer a request

When a command needs your approval, Pocket files a **request** and tells you three ways. Any one of them answers it:

- **Push notification.** "Allow *name*?", with which conversation wants it and the command, and **Allow** and **Deny** buttons. **Allow** on the notification allows once; it never saves the command. Tapping the notification itself does not answer: it opens the Vault at that request. If an **Allow** or **Deny** from the notification cannot be recorded (the device was signed out, the Vault was locked, the device was offline, or the request had already ended), Pocket opens the request and says why, so you can answer it there. Turn these on per device in **Settings → Notifications & voice → Vault requests**.
- **The Vault view.** Each request is one sentence, such as *The agent in "Staging site" wants to use staging-wp for this command*, with the exact command, the folder and when it asked. **Allow once** is the orange button; **Deny** sits beside it, and **Always allow** between them when the secret allows it. A request that was already answered, expired or ended when the Vault locked says so when its notification is opened.
- **The conversation.** The agent ends its reply with suggested replies such as *Allow billing-api for this command* and *Deny billing-api*. Tap one or type it. Pocket also accepts *Always allow billing-api for this command*, *approve*, *don't allow*, and a bare *Allow* or *Deny* when that conversation has exactly one request waiting. Only your own messages in the conversation that raised the request count, and the message is still delivered to the agent.

**Always allow** saves the exact command (program, every argument and the folder) for that secret, under **Approved commands** on its sheet, where you can remove it. A changed argument is a new command and asks again. A request expires after 15 minutes.

### Protect the Vault with a passphrase

By default the key in `.env` opens the Vault whenever Pocket Code runs. To require a passphrase instead:

1. **Settings → Projects, files, tasks & vault → Vault → Protection → Set a passphrase**.
2. Enter a passphrase of at least 12 characters twice.

From then on Pocket holds the passphrase-derived key in memory only, and the Vault is **locked** after a restart, after **Lock now**, and after the idle time you pick in **Lock after** (**Never**, **15 minutes**, **1 hour**, **8 hours**, **24 hours**; counted from the last time you or an agent used it). While locked, agents cannot use secrets, the rail and home chip show a lock, and the Vault view shows **Unlock**. When an agent hits a locked Vault you get one "The Vault is locked" push (at most one every ten minutes).

**Change passphrase** and **Remove passphrase** (back to the server key) are in the same place. There is no reset: a forgotten passphrase means the Vault cannot be opened, so keep the passphrase in your password manager and keep an export. Unlocking is limited to ten wrong passphrases per hour in one signed-in session (one browser's sign-in); a right one clears the count.

### Export, import, rotate and restore the key

All of these are under **Settings → Projects, files, tasks & vault → Vault**:

- **Export…** downloads every secret, values included, as one `.pvault` file encrypted under a passphrase you type for it (at least 12 characters). Removed secrets and last-used details are left out.
- **Import…** reads a `.pvault` file into this or another Pocket Code. Secrets whose names are new are added; names already here are listed and left alone.
- **Download recovery key** shows the current key again (recorded in the history). Only in server-key mode.
- **Rotate key** re-encrypts the Vault under a new key, saves it to `.env` and shows the new recovery key. No restart is needed. Backups made before the rotation still need the old key. Only in server-key mode. While a rotation runs, `.env` briefly also holds the old key as `POCKET_VAULT_KEY_PREVIOUS`; if Pocket stops part-way, the next start puts `.env` back on the key the store is written under, so your recovery key still works.
- **Restore key…** appears when a `vault.enc` exists but its key is missing. Paste the recovery key or open the downloaded file; Pocket checks that it opens the Vault and saves it to `.env`.

### Catch secrets typed into messages

**Settings → Projects, files, tasks & vault → Catch secrets in messages** (on by default, for the whole install) holds a message that looks like it contains a secret:

- **On paste or drop** into a message box: Pocket holds the text and offers **Store in the Vault** (saves it under a suggested name and pastes `{{vault:name}}` instead), **Paste as is** or **Cancel**.
- **On send**: the same check runs, with **Store and send**, **Send as is** and **Edit**. The server runs the check too, for new conversations, messages, side chats and branches, and refuses an unchecked message that carries a secret.

It recognizes OpenAI, Anthropic, OpenRouter, GitHub, GitLab, AWS access key IDs, Stripe, Slack, Google API, Twilio and SendGrid key formats, signed JWTs, private keys, a password inside a URL, card numbers that pass the checksum and carry a card issuer's prefix, and text like `password: …` or `api_key = …` whose value has a digit or symbol. A paste of a single long random-looking token is also caught. The sheet names what it found and its length, never its characters. If the Vault is off or locked, the sheet says so and offers only the send-or-cancel choices. Detection is a backstop: storing a secret with **Store in the Vault** first is the reliable way.

## How it works

### Where data lives

| File | Contents |
|---|---|
| `POCKET_DATA_DIR/vault.enc` | Every secret, its policy and approved commands, encrypted as one AES-256-GCM blob. Nothing is readable without the key. Written with a sync before and after the rename. |
| `POCKET_DATA_DIR/vault-audit.jsonl` | The history: one line per event, mode `0600`, append-only. Never holds a value. |
| `.env` in the Pocket Code directory | `POCKET_VAULT_KEY` in server-key mode. |
| `POCKET_DATA_DIR/pocket-settings.json` | Vault on or off, Agent access, Lock after, Catch secrets in messages. |

`POCKET_DATA_DIR` defaults to the Pocket Code directory. Back up `vault.enc` and `vault-audit.jsonl` with the data directory and keep the recovery key somewhere else. Pending requests live in memory only: a restart drops them, and the agent is told the request no longer exists.

The daemon reads `POCKET_VAULT_KEY` at start and removes it from its own environment, so no agent, hook or command it starts can inherit it. A key set in the daemon's process environment (a PM2 ecosystem file or systemd unit) instead of `.env` cannot be rotated from Settings; move it into `.env` first.

### What a run does

When an agent runs `pocket-vault run --env TOKEN=billing-api -- node sync.mjs`:

1. Pocket resolves each binding to a secret and field, and checks the policy. If approval is needed it files a request and waits up to 90 seconds (`--wait`, at most 300).
2. Pocket starts the command itself, in the given folder, with the values set as environment variables. The command gets the daemon's environment (minus Pocket's own secrets) plus the bound variables, not the agent's shell environment. It has no terminal and no standard input.
3. Output streams back with every value replaced by `{{vault:name}}`, including its base64, base64url, URL-encoded and JSON-escaped forms, and the value inside longer base64 text such as an HTTP Basic login header (values of 6 characters or more). Values shorter than 4 characters are not scrubbed.
4. The run is recorded in the history before any value is released. If the record cannot be written, nothing is released.

| Limit | Value |
|---|---|
| Output per run | 1 MB, then the command is stopped |
| Run time | 600 seconds by default, `--timeout` up to 3600 |
| Runs at once | 8 |
| Variables per run | 32 (`POCKET_*`, `PATH`, `HOME`, `LD_*` and `NODE_OPTIONS` cannot be bound) |
| Secrets | 500 |
| Value size | 64 KB per field |
| Notes | 2,000 characters |
| Tags | 20 per secret |
| Approved commands | 50 per secret; the oldest is dropped |
| Request lifetime | 15 minutes to answer; an answer stays good for 15 minutes after it is given |

The command leads its own process group. When it exits, times out or exceeds the output cap, everything it started is stopped too, so a run cannot leave a background process behind.

### Browser logins

An agent driving a browser through the Playwright MCP tools can type a stored value into a page by writing `{{vault:name.field}}` as the text to type. Pocket's relay (`scripts/pocket-mcp-proxy.mjs`) asks the Vault for the value under the same Agent access rules and approval flow, types it into the tool call on its way to the browser, and replaces it with the placeholder in everything the browser tool sends back. The request shows in the Vault as "Fill into the playwright tool (browser_type)".

Set it up once by registering the browser tool through the relay, for example for Claude Code:

```bash
claude mcp add playwright -s user -- node <Pocket Code directory>/scripts/pocket-mcp-proxy.mjs \
  --name playwright -- npx -y @playwright/mcp --headless --no-sandbox
```

Rules the relay enforces:

- Values go only into the fill tools: `browser_type`, `browser_fill_form`, `type` and `fill`, or the comma-separated list in `POCKET_VAULT_FILL_TOOLS`. A call to any other tool that names a placeholder (`browser_evaluate`, `browser_navigate`) is refused.
- **Screenshot lockout.** Once a value has been typed, images, audio and other binary content from that browser are replaced with a note for the rest of the relay's life, because a value cannot be scrubbed out of a picture. Text snapshots still work.
- A fill waits `POCKET_VAULT_FILL_WAIT` seconds (default 90) for your approval, then tells the agent to call the tool again once you allow it.

The page the agent is driving can read what was typed into it. Allow fills only on sites you trust with that login.

### The history

Each secret's sheet shows its last 20 events under **History**. The file records: stored, changed (naming the fields, never values), removed, restored, every run and browser fill, every request and how you answered it, every Show, and key and passphrase events (key created, rotated, restored, recovery key viewed, passphrase set or removed, lock, unlock, failed unlock, export, import). Each row names the conversation and the command.

### Settings and environment variables

| Name | Where | Effect |
|---|---|---|
| **Vault** | Settings → Projects, files, tasks & vault | On or off for the install. Off by default. |
| **Agent access** | Same, under Vault | Free rein, Ask once per command (default), Ask every time. |
| **Lock after** | Same, under Protection (passphrase mode only) | Never (default), 15 minutes, 1 hour, 8 hours, 24 hours. |
| **Catch secrets in messages** | Same | On by default. |
| **Vault requests** | Settings → Notifications & voice | Whether this device gets request pushes. |
| `POCKET_VAULT_KEY` | `.env` | The server key. Pocket writes it; set it by hand only when there is no `.env` to write. |
| `POCKET_VAULT_FILL_TOOLS` | Relay's environment | Tools the relay may type a value into. |
| `POCKET_VAULT_FILL_WAIT` | Relay's environment | Seconds a fill waits for approval. Default 90. |

### Security model and limits

The Vault keeps secrets out of prompts, transcripts, memory, backups and the model provider, and makes every use visible. It is not process isolation:

- Agents run as the same operating-system user as Pocket. An agent that goes looking can read `.env` and the store.
- A command run with a secret runs with the daemon's permissions, outside any sandbox the agent's CLI applies, and can do whatever the credential allows. Scrubbing cannot stop a command that writes a value to a file or sends it somewhere.
- Under **Free rein**, any command can use a secret without your approval; only the record of use shows it. Under Full access the Vault's request is the only check on a run, which is why asking is the default. Under Review actions you also approve the agent's `pocket-vault run` call itself.
- Calls from a terminal or code-server on the server carry no session identity. They follow the same rules, are recorded as "from a terminal", and share one identity, so any such process can continue a request another terminal process raised.

In the browser, Vault responses are never cached, changes are refused unless they come from Pocket's own origin, and a value is fetched one field at a time and never stored. See [SECURITY.md](../../SECURITY.md#vault) for the full model.

## For agents

Use the [pocket-vault skill](../../skills/pocket-vault/SKILL.md); Pocket installs it while the Vault is on, and the instructions Pocket gives each conversation name the exact command path. Run the CLI as `node <Pocket Code directory>/scripts/pocket-vault.mjs` (or `npx pocket-vault` from the Pocket Code directory).

**The rule:** never see, print, echo, log, decode or write a value, never put one in a command's arguments, and never ask the user to paste a secret into the chat. Point them to **Store in the Vault** instead.

```text
pocket-vault list [--kind k] [--tag t] [--json]       names, kinds, fields, policy, url, tags, expiry; never values
pocket-vault show <name> [--json]                     one secret's fields, how to bind it, last use, approved commands
pocket-vault run --env VAR=<name>[.field] [--env …] [--cwd <dir>] [--timeout <s>] [--wait <s>] -- <command…>
pocket-vault wait <request-id> [--wait <s>]           continue a run the owner was asked to allow
pocket-vault put <name> --kind <api_key|token|login|credentials|note> (--stdin | --from-file <path> [--map field=key,…] | --from-env VAR) [--url u] [--tags a,b]
pocket-vault history [--name <name>] [--json]         this session's uses of the Vault
```

| Exit code | Meaning | What to do |
|---|---|---|
| child's code | The command ran | Read the scrubbed output. |
| 3 | The Vault is off, locked, or cannot be opened | Tell the user in one line. Off: it is turned on in Settings → Projects, files, tasks & vault → Vault. Locked: they unlock it in the Vault view (they were already notified). Never ask for the passphrase. |
| 4 | A request is waiting (`pending <id>`) | Say so in one line, end the reply offering `Allow <name> for this command` and `Deny <name>` as choices, then run `pocket-vault wait <id>`. If it prints `pending` again, do not loop. |
| 5 | Denied, expired, an **Only you** secret, or no such name | Say so and stop. Do not look for another way to the value. |
| 1 | Any other error (bad binding, unreachable server) | Read the message. |

Write commands so the child reads the variable itself. For a shell expansion, single-quote the script so your own shell does not expand it:

```bash
pocket-vault run --env TOKEN=billing-api -- sh -c 'curl -sS -H "Authorization: Bearer $TOKEN" https://api.example.com/v1/invoices'
pocket-vault run --env PORTAL_USER=vendor-portal.username --env PORTAL_PASS=vendor-portal.password -- python3 fetch.py
```

Keep commands stable: an approved command is an exact match on program, arguments and folder. `--cwd` defaults to your current directory.

**Storing a secret you meet.** When a secret appears in a message, file or tool result, store it at once with `put` (the value from `--stdin`, `--from-file` or `--from-env`, never the command line), use its name from then on, and tell the user in one or two sentences that it was seen in the conversation and may need rotating. Write the name as a Markdown link to `/#/vault/item/<name>` so it opens the secret; the conversation also shows a card for it. `put` is create-only: an existing name (including a removed one) is refused, and agents cannot change, rotate or remove a secret. A new secret follows the Vault default policy.

**Browser fills.** Put `{{vault:name.field}}` as the text in `browser_type` or `browser_fill_form`. If the reply says the Vault is asking the owner, tell them and call the same tool with the same arguments once they allow it. After a fill, use `browser_snapshot` instead of screenshots. If the placeholder appears literally on the page, the relay is not in place: stop and tell the owner.

**Codex in Review mode** runs in a read-only sandbox that cannot reach Pocket's server, so `pocket-vault` fails there; the reply needs Full access.

**When to act and when to ask:** use a secret whenever the task needs it; store one the moment you see it; ask the owner only to add a missing secret, change a policy, or answer a request. `list` answers "what credentials do we have".

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The **Vault** switch is greyed out with "This Vault's key is missing on this server" | `vault.enc` exists but `POCKET_VAULT_KEY` is gone (lost `.env`, rebuilt server) | **Restore key…** with the recovery key. Pocket never creates a new key over an existing store. |
| The Vault view says "The Vault cannot be opened" | The key in `.env` is not the one the store was saved with | Put the right key back (or use **Restore key…**) and restart Pocket Code. |
| Turning the Vault on fails with a message about `POCKET_VAULT_KEY` set in the daemon's environment | The key comes from the process environment and does not open the store | Fix or remove the key in the PM2 or systemd configuration and restart. |
| **Rotate key** answers that the key is set in the daemon's environment | Rotation can only write `.env` | Move the key into `.env`, remove it from the environment, restart, then rotate. |
| **Remove passphrase** fails: "POCKET_VAULT_KEY is not set" | Passphrase mode with no server key | Add `POCKET_VAULT_KEY` to `.env`, restart, unlock, then remove the passphrase. |
| Unlock says "Too many tries. Wait an hour." | Ten wrong passphrases or **Restore key** keys in this signed-in session within an hour of the first, or 50 across all sessions | Wait, then try again. A right passphrase or key clears the count. |
| Turning the Vault on fails: "This install has no .env file to keep the Vault key in" | `POCKET_ENV_FILE` is set to empty, so Pocket has nowhere to save a key | Set `POCKET_VAULT_KEY` yourself (`openssl rand -base64 32`) and restart. |
| Tapping **Allow** on a notification opens the Vault with "Your Allow from the notification didn't go through" | The answer could not be recorded; the line says why (signed out, locked, offline, or the request had ended) | Answer the request on that card. Sign in again on the device if it says signed out. |
| An agent's run answers `pending` and nothing arrives on the phone | Push is off on that device, or **Vault requests** is off for it | Answer in the Vault view or the conversation; turn on push in **Settings → Notifications & voice**. |
| `pocket-vault wait` says the request does not exist or has expired | More than 15 minutes passed, or Pocket restarted | Run the command again to file a new request. |
| "That request was raised by another session" or "already used" | A request belongs to one conversation and serves one continuation | Run the command again from the conversation that needs it. |
| "… changed since the owner was asked; ask again" | The secret, a field or a policy changed after the approval | Run the command again. |
| "Too many vault runs at once" | Eight runs are in progress | Try again in a moment. |
| Output ends with `[output truncated at 1 MB]` or `[the command was stopped at the timeout]` | The run hit a limit | Reduce output, or pass `--timeout`. |
| A background service a command started stops when the run ends | Runs stop everything they started | Start long-lived services another way. |
| `{{vault:name}}` appears literally in a web page | The browser tool is not registered through `pocket-mcp-proxy.mjs` | Re-register it through the relay. |
| Screenshots come back as "Removed by Pocket…" | A value was typed in that browser session | Use text snapshots, or restart the browser tool. |
| `pocket-vault history` from a terminal shows nothing | Terminal calls have no session, and history shows only the calling session's rows | Open the secret's **History** in the Vault view. |
| Codex conversations ignore the Vault's rules; Settings warns about `developer_instructions` | Codex's `config.toml` sets its own `developer_instructions`, which keep Pocket's lines out | Remove that setting, or rely on the installed `pocket-vault` skill. |

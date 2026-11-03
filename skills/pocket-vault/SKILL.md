---
name: pocket-vault
description: Use credentials from Pocket Code's Vault without ever seeing them. Use when a task needs an API key, token, password, login or other credential to run a command or call a service; when the user mentions a secret, asks you to "store this key", "save the password", "use the Zoho token" or asks "what credentials do we have"; and when you meet something that looks like a secret (a key, token, password or private key) in a message, a file or a tool result. The Vault runs your command with the value in its environment and hands back output with the value replaced.
---

# Pocket Code Vault

Pocket Code keeps a **Vault** on its own server: API keys, tokens, logins and secure notes,
encrypted, each under a short name such as `zoho-books` or `stripe-live`. You never see a
value. You name the secret, and Pocket runs your command with the value in the command's
environment, then gives you the output with every value replaced by `{{vault:name}}`. The
owner adds, views and copies values in the Vault view in Pocket Code, approves which commands
may use them, and sees every use. You work with the Vault through the `pocket-vault` command.

<!-- pocket:commands -->
Run `pocket-vault` from the Pocket Code directory (`node scripts/pocket-vault.mjs`, or
`npx pocket-vault`). The session instructions Pocket gives you name the exact command.
<!-- /pocket:commands -->
<!-- pocket:manual -->
How this feature works, how it is set up and its limits: `docs/manual/vault.md` in the Pocket Code directory.
<!-- /pocket:manual -->

## The one rule

**You never see a secret value, and you never put one anywhere.** Refer to a secret by its
name and use it with `pocket-vault run`. Never print, echo, `cat`, log or decode a value;
never write one to a file, a commit, a message, a task, a project note or a memory; never pass
one as a command-line argument. There is no command that gives you a value, and you should
not look for another way to get one (reading `.env`, the store file or another process).

**Never ask the user to paste a secret into the chat.** Anything typed into the conversation
goes to the model provider and into the transcript. Point them to the Vault instead: **Add
item** in the Vault view, or **Store in the Vault** in the composer's attach sheet or the
session's options, which keeps the value out of the message.

A `{{vault:name}}` placeholder in a message from the user is them handing you a stored secret
by name. Use that name with `run`.

## Kinds and fields

| Kind | Fields | In `--env` |
|---|---|---|
| `api_key` | `value` | `name` (means `name.value`) |
| `token` | `value` | `name` (means `name.value`) |
| `login` | `username`, `password` | `name.username`, `name.password`: always name the field |
| `credentials` | none fixed; custom fields only | `name.client_id`, `name.client_secret`: always name the field |
| `note` | `text` | `name.text` |

Any item can carry **custom fields** beside its kind's fixed ones (for example a login with a
`signature_key`). Field names are lowercase letters, digits and underscores. `show <name>` lists
every field; when an item has more than one, always write `name.field`.

## Running a command with a secret

```bash
pocket-vault run --env VAR=name[.field] [--env VAR2=name2.field] [--cwd dir] [--timeout s] -- <command…>
```

Pocket's server starts the command itself, with each `VAR` set in its environment, and
streams back its output with every value (and its base64 and URL-encoded forms) replaced by
`{{vault:name}}`. The exit status is the command's own. Output is capped at 1 MB; the command
is stopped after 10 minutes unless you pass `--timeout` (seconds).

The value is only ever in the **child's environment**. Write the command so it reads the
variable itself:

```bash
# Node or Python reading process.env / os.environ
pocket-vault run --env ZOHO_TOKEN=zoho-books -- node sync-invoices.mjs
pocket-vault run --env STRIPE_KEY=stripe-live -- python3 monthly_report.py

# A login: two fields, two variables
pocket-vault run --env PORTAL_USER=vendor-portal.username --env PORTAL_PASS=vendor-portal.password \
  -- python3 fetch_statements.py

# curl with a header: run it through a shell so the child expands the variable
pocket-vault run --env TOKEN=zoho-books -- sh -c 'curl -sS -H "Authorization: Bearer $TOKEN" https://www.zohoapis.com/books/v3/invoices'

# Tools that read a credential from an environment variable
pocket-vault run --env GH_TOKEN=github-ci -- gh api user
pocket-vault run --env GOOGLE_WORKSPACE_CLI_TOKEN=gws-token -- gws drive files list

# An SSH key: the child writes it to a private temp file, uses it, and removes it
pocket-vault run --env SSH_KEY=deploy-key.text -- sh -c 'umask 077; f=$(mktemp); printf "%s\n" "$SSH_KEY" > "$f"; ssh -i "$f" -o IdentitiesOnly=yes deploy@example.com uptime; s=$?; rm -f "$f"; exit $s'
```

- **Single-quote the `sh -c` script.** `$TOKEN` must reach the child as text and be expanded
  there. In double quotes your own shell would expand it first, to nothing, since the
  variable is not in your environment.
- **Never put a value in the arguments**, even one you think you know. Arguments show up in
  process lists, approvals and the record of use.
- **Keep commands stable.** An approved command is saved as an exact match (the program, its
  arguments and the working directory); a changed argument is a new command and asks the
  owner again. Put what varies in a script or a file the command reads.
- **The command runs with the server's permissions**, outside your own sandbox, and can do
  whatever the credential allows. Run only what the task needs.
- `{{vault:name}}` in the output means the command printed the value. Do not try to recover
  it; if the output was meant to contain it, tell the user.

## Typing a secret into a web page (1.43)

With the Playwright browser tools, never type a password yourself. Put the placeholder where
the text goes, and Pocket types the real value on its way to the browser:

```
browser_type      text: {{vault:ovrc-brad.password}}
browser_fill_form value: {{vault:ups-developer-account.username}}
```

Use `name.field` for a login (`.username`, `.password`) or any item with more than one field.
The tool's reply, page snapshots and logs come back with the value replaced by the placeholder.
If the reply says the Vault is asking the owner, tell them in one line and call the same tool
again with the same arguments once they allow it. Never read a filled value back out of the
page (no `browser_evaluate` on the field, no screenshot meant to show it). Placeholders work in
the typing and form-filling tools only (`browser_type`, `browser_fill_form`); a `browser_evaluate`
or `browser_navigate` that names one is refused. Once a value has been typed, screenshots and
other pictures from that browser are unavailable for the rest of the session: Pocket cannot
scrub a value out of a picture, so it returns a note in its place. Use `browser_snapshot` (text)
to see the page. This only works when the browser tool runs through Pocket's relay
(`pocket-mcp-proxy`); if the placeholder comes back literally typed into the page, the relay is
not in place: stop and tell the owner.

## Pending, refused and off

How freely you may use secrets is the owner's choice. **Agent access** in Settings applies
to every item, and an item can override it:

- **Free rein**: any command runs at once, and is recorded. Most developers who want their
  agents to work on their own choose this.
- **Ask once per command**: a command the owner approved before (with *Always allow*) runs at
  once; a new one waits for the owner.
- **Ask every time**: every run waits for the owner.
- **Only you** (an item setting): agents cannot use the item. `run` fails and says to ask the owner.

When a run must wait, the owner gets an "Allow <name>?" push naming your conversation and
the command, with **Allow** and **Deny** buttons; tapping the notification opens that request
in the Vault. `run` waits up to 90 seconds; with no answer yet it prints `pending <request id>` and
exits with code 4.

**On `pending`:** say in one line that the command is waiting for the owner's approval
(naming the item and the command), and end your reply offering two choices, written exactly
like this so the owner can tap one: `Allow <name> for this command` and `Deny <name>` (when
Pocket shows suggested replies, as a `choices` block). The owner may answer by that reply,
the notification or the Vault view; any of them settles the request. Then run
`pocket-vault wait <request id>`: it runs the command once allowed, or reports the denial. If
it prints `pending` again, the owner has not answered; do not loop on it. A request expires
after 15 minutes.

**On a refusal** (denied, an `owner` item, an expired request): say so plainly and stop. Do
not try another command, another item, a copy of the value from somewhere else, or any other
way around it. Ask the owner what they want.

**Codex in Review mode** runs in a read-only sandbox that cannot reach Pocket's server, so
`pocket-vault run` fails there. Tell the user the command needs Full access for that turn.

## Storing a secret you meet

When you come across a secret (the user pastes one, or you find one in a file, a config or a
tool result), store it **at once**, use its name from then on, and tell the user it was seen:

```bash
pocket-vault put stripe-live --kind api_key --from-env STRIPE_SECRET_KEY
pocket-vault put vendor-portal --kind login --from-file /tmp/creds.json --map username=user,password=pass
printf '%s' '{"client_id":"…","client_secret":"…"}' | pocket-vault put ups-api --kind credentials --stdin   # several named fields at once
printf '%s' "$TWILIO_AUTH" | pocket-vault put twilio-auth --kind token --stdin \
  --url https://console.twilio.com --tags twilio,sms
```

- **Name:** lowercase letters, digits and dashes, up to 64 characters, saying what it is:
  `zoho-books`, `stripe-live`, `vendor-portal`.
- **The value never goes on the command line.** Take it from an environment variable
  (`--from-env`), a file (`--from-file`, with `--map field=key,…` to pick fields out of a JSON
  file) or standard input (`--stdin`). A JSON object gives several fields at once: the kind's
  fixed ones plus any custom ones, each key becoming a field. `put` prints only the name.
- **Create only.** An existing name is refused. Pick another name or ask the owner to update
  the item in the Vault view. You cannot change, rotate or remove an item.
- New items follow the Vault default (the **Agent access** setting) and have no approved commands.
- **Tell the user**, in one or two sentences: what you stored and under which name, and that
  the value was seen in this conversation (so it has already reached the model provider and
  this transcript) and they may want to rotate it. Do not repeat the value, even partly.
  Write the name as a link that opens it in the Vault, `[name](/#/vault/item/name)`, for
  example `Stored as [stripe-live](/#/vault/item/stripe-live)`. The conversation also shows a
  card for it under your reply.
- Do not leave the secret behind: if you wrote it to a temporary file to store it, remove the
  file. Do not edit a user's own config files to remove a secret unless they ask.

## Finding what is stored

```bash
pocket-vault list                      # names, kinds, urls, tags, policy, expiry, last used
pocket-vault list --kind login --tag zoho
pocket-vault show zoho-books           # metadata, which fields exist, approved commands
pocket-vault history                   # this session's uses of the Vault
```

None of these show a value or the owner's notes. "What credentials do we have" means
`list`. If the item you need is not there, say so and ask the user to add it in the Vault view.

## If the Vault is locked

The owner can protect the Vault with a passphrase; after a restart, on demand or after a
period idle it is **locked**, and `pocket-vault` exits with code 3 saying so. The owner has
already been sent a push. Tell the user in one line that the Vault is locked and that the
work needs it unlocked in Pocket Code (the Vault view has an Unlock button), then wait or
move on; never ask for the passphrase and never look for the value elsewhere.

## If the Vault is off

`pocket-vault` exits with code 3 and says so. Tell the user that the Vault is turned off and
can be turned on in Pocket Code under **Settings → Projects, files, tasks & vault → Vault**
(it also needs `POCKET_VAULT_KEY` set on the server). Do not keep secrets anywhere else
instead, and still do not ask for one in the chat.

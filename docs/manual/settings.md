<!-- manual
checked: 1.103.0
sources: context-policy.mjs, cli-updates.mjs, public/cli-updates.js, public/app.js, public/workspace.js, public/theme.js, public/voice.js, server.mjs, router.mjs, access.mjs
-->
# Settings

Settings holds every preference Pocket Code offers, grouped into categories. Some apply to the
browser you are using and some to the whole install on every device; each category says which
under the headings **This device** and **This instance · all devices** (**This Pocket · all
devices** in Assistant mode). This page lists every category and control, what it does, its
default and where it is stored.

## Open Settings

- **Desktop:** the gear (**App settings**) at the top of the conversation rail.
- **Phone, Developer mode:** the gear (**Settings and version**) at the top of the conversation
  list.
- **Assistant mode:** the gear (**Settings**) beside **Pocket Assistant** on the home screen.
- **Conversation options → Version & updates** opens Settings at **Help & updates**.

Settings opens on an index of categories. Choose one to open it; **All settings** returns to the
index. Sub-pages such as **Accounts & instance**, **Connectors** and **Plan usage** have **Back to
Settings**, which returns to the same category and scroll position. Escape or Close leaves
Settings.

Both modes show six categories, and Assistant mode has fewer controls:

| Category | Developer mode | Assistant mode |
|---|---|---|
| [Appearance](#appearance) | Everything | Everything |
| [Conversation](#conversation) | Reading, titles and summaries | **Collapse steps** and **Show message times** |
| [Agents & instance](#agents--instance) | Everything | Replaced by **Accounts**: **Accounts & instance** and **Connectors** only |
| [Projects, files, tasks & vault](#projects-files-tasks--vault) | Everything | Replaced by [Features](#features-assistant-mode): the five switches and **Automatic model choice** |
| [Notifications & voice](#notifications--voice) | Everything | Everything |
| [Help & updates](#help--updates) | Shortcuts, version, what's new, feedback | Version and what's new |

A setting hidden in Assistant mode keeps its value and still applies. To change one that **Features**
does not offer, switch to Developer mode in **Appearance → Mode**, change it, and switch back.

Instance-wide settings load from the server when the category opens; their switches stay disabled
with a **Loading…** note until they arrive. If loading fails, the notes say **Could not load this
setting.** and **Retry name-sync setting** loads them again.

## Appearance

| Control | What it does | Default | Stored |
|---|---|---|---|
| **Colour mode** | **System** (follows the device), **Light** or **Dark**. Applies at once to every Pocket window and split pane of this browser | **System**; a browser that already had Pocket preferences before colour modes existed keeps **Dark** | This browser |
| **Chat text size** | **Smaller** and **Larger** step from 14 to 24 px; **Reset** returns to 17 px. Prose, headings and tables scale; controls and tool logs keep their size. Also in **Conversation options** | 17 px | This browser |
| **Highlight colour** | **Orange**, **Blue** or **Purple** for the send button, links, active markers and your own messages | **Orange** | This browser |
| **Mode** | **Developer mode** or **Assistant mode**, the current one pressed. See [Getting started](getting-started.md#developer-mode-or-assistant-mode) | **Developer mode**, unless `POCKET_ASSISTANT_MODE` is `on`, `1`, `true` or `locked` | Server |

With `POCKET_ASSISTANT_MODE=locked`, both **Mode** options are disabled and the note says
Assistant mode is kept on by the server.

## Conversation

| Control | What it does | Default | Stored |
|---|---|---|---|
| **Collapse steps** | Folds each run of tool calls behind a one-line summary | On | This browser |
| **Describe steps in plain words** | Shows each step as a sentence ("Saved Proposal.pdf") with the command or path beside it. Off shows the tool name and its raw detail | On | This browser |
| **Show message times** | A time on each message and a divider for each day | On | This browser |
| **Sync names with code-server** | Conversation names follow Claude Code's own titles, and a rename in Pocket is written to the transcript so code-server and `claude --resume` show it too | Off | Server |
| **Generate short titles** | Gives conversations named only by their first message a short generated title. A rename always wins | On, unless `POCKET_AUTO_TITLES=0` | Server |
| **Update titles as conversations progress** | After a reply, once a conversation has moved on, its title is checked and rewritten to say what it is about now. Renames are never touched. Needs **Generate short titles** | On | Server |
| **Summarize what you missed** | Coming back to a conversation opens it at the end with a **New since** card and a short summary of the new work. Off keeps the **New since** marker without the summary | On | Server |
| **Model for titles and summaries** | **Automatic: Claude first, then Codex**, **Claude · Haiku** or **Codex · GPT-6-Luna**. A choice that is not signed in on the server shows **(unavailable)** | **Automatic** | Server |

Titles and summaries run on the signed-in CLI's own account. When Codex is the helper, the note
under the model says what that costs: about 25k tokens of your plan for each Codex call, against
about 400 for a Claude title and a few thousand for a Claude summary. When this computer's Claude
Code policy blocks the title model, Pocket uses the cheapest offered model the policy allows.

## Agents & instance

Everything here applies to the whole install.

| Control | What it does |
|---|---|
| **Accounts & instance** | Opens a page with the Claude Code and Codex accounts, plan and sign-in method. Under Claude Code, **Switch account** (or **Sign in**) changes the server's Claude login through a sign-in link and a pasted code. Idle conversations move to the new login at once; one with a background job still running keeps the earlier login until the job ends. A message sent there waits and sends by itself on the new account when the job finishes; **Stop background jobs and send now** ends the job and sends it at once. **Stop all Claude replies** stops every running Claude reply after a second tap on **Stop replies**; the page shows how many are active. Codex sign-in is managed on the server |
| **Connectors** | Shows whether each agent can reach Gmail, Google Calendar and Google Drive through its own account (claude.ai connectors for Claude Code, ChatGPT apps for Codex), with **Connect**, **Reconnect**, **Manage on claude.ai** or **chatgpt.com**, and **Refresh status** |
| **Plan usage** | The 5-hour and weekly limits and extra-usage status, for Claude Code and for Codex when it is installed. Updates only when a reply runs |
| **Claude models in the picker** | Tap a model to offer it, or stop offering it, in the model menu on every device. At least one stays on. A model blocked by this computer's Claude Code managed settings is marked and cannot be turned on. **Use the server's list** forgets the choice |
| **Context and subagents** | 1.92. **Compact conversations:** *When the agent decides* (the agent's own behavior) or *Before 150K* to *600K tokens*, so the agent summarizes the older part of a conversation before it reaches that size. Each reply reads the whole conversation again, so long conversations use the most of a plan. **Offer a handoff:** *Off* or *After 150K* to *400K tokens* (200K unless you change it): past that size Pocket suggests [handing off](conversation.md#hand-off-to-a-fresh-conversation) under the latest finished reply and the context ring turns amber. When Compact conversations is set at or below that size, the offer comes at three quarters of the compaction size instead, so it shows before the summary. Applies to every agent at once and restarts nothing. **Subagent model:** *The agent's own choice*, or *One tier below the conversation's model* (Fable or Mythos conversations run Opus subagents, Opus runs Sonnet, GPT Astra runs the newest GPT Sol; other models keep the agent's choice, and a conversation can still name a model for one subagent). **Subagent effort:** the agent's own, or low, medium or high. Applies to Claude Code and Codex conversations from their next reply: idle ones restart when you save, and one running a background job keeps its earlier setting until it is replaced. OpenRouter conversations keep their own behavior for now. How each agent receives it: [the spec](../context-policy-spec.md). |
| **Actions that run without asking** | Read-only actions Claude Code, Codex and OpenRouter run without an approval card in **Review actions** (Codex and OpenRouter since 1.87, for commands). Type a rule (`Bash(command:*)`, `Bash(exact command)`, `mcp__server__tool`, `mcp__server__*`, `WebSearch`) and press **Add**; **Remove** takes one off. Edit and Write always ask; Codex is not covered. **Use the server's list** goes back to `POCKET_TRUSTED_ACTIONS` |
| **Automatic model choice** | In Assistant mode, sends a request typed from scratch to a small decision model that picks one of four levels; see below. Assistant mode shows only its switch, under **Features** |
| **One sign-in** | Lets a Cloudflare Access sign-in replace Pocket's password; see below |

**Defaults.** The picker offers every Claude model, or the list in `POCKET_CLAUDE_MODELS`. No
action runs without asking, unless `POCKET_TRUSTED_ACTIONS` lists some. A list saved in Settings
wins over the environment variable until you choose **Use the server's list**. Rule syntax and
matching: [action approvals](../action-approvals.md#actions-that-run-without-asking).

**Automatic model choice** controls:

- **Choose the model for me**: on or off. Off unless `POCKET_ROUTER` is `jev` or `openai`. It
  cannot be turned on without a key.
- **Decision model**: **TypeSafe Jev, through OpenRouter** (an OpenRouter key) or **OpenAI Decisions
  API (GPT-6 Luna)** (an OpenAI API key).
- **Key**: paste and **Save key**. The key is saved to `router-key` in the data directory (mode
  `0600`), never shown again, and replaces `POCKET_ROUTER_KEY` or `POCKET_ROUTER_KEY_FILE`.
  **Remove** deletes it.
- Four levels, **Quick**, **Standard**, **Careful** and **Deep**, each with a **Model** and an
  **Effort**. **Automatic** follows the newest offered model of the level's family; the line under
  each level says what it runs now.
- **Use the server's settings** clears everything saved here.

It acts only in Assistant mode and only on requests typed from scratch; saved prompts keep their
own model. If the decision model fails, is unsure or takes longer than `POCKET_ROUTER_TIMEOUT_MS`
(default 1500 ms), the default model runs, and the note says so. The decision model is told only that the
request was typed into an AI work assistant; to tell it what routine work looks like on this install, describe the
business in `POCKET_ROUTER_CONTEXT` (a sentence or two, up to 1,000 characters, read at start). In Assistant mode
the other model control is **Try harder** under a Claude reply (see [Working in a conversation](conversation.md#try-harder-assistant-mode)).

**One sign-in** controls: **Team** (the part before `.cloudflareaccess.com`), **Audience tag**
(from the Access application's Overview) and **Who may sign in this way** (comma-separated emails,
up to 50), then **Save**. **Turn off** goes back to Pocket's password; browsers already signed in
stay signed in for up to a day. **Use the server's values** appears when `POCKET_ACCESS_TEAM`,
`POCKET_ACCESS_AUD` or `POCKET_ACCESS_EMAILS` are set and a choice is saved here. The status line
shows who can sign in and the last Access sign-in.

## Projects, files, tasks & vault

Developer mode only; Assistant mode has the switches under [Features](#features-assistant-mode). The
switches apply to the whole install; the three **Open …** menus apply to this browser.

| Control | What it does | Default | Stored |
|---|---|---|---|
| **Projects** | Turns on [Projects](projects.md) | Off | Server |
| **Files** | Turns on [Files](files.md) | Off | Server |
| **Keep files from replies** | Keeps every file a reply hands over (a PDF, deck, sheet, page) in Files once, linked to its conversation. Needs Files; always on in Assistant mode | Off | Server |
| **Tasks** | Turns on [Tasks](tasks.md) | Off | Server |
| **Coordination** | Turns on [Coordination](coordination.md): which conversation holds staging or a deploy, and who is waiting. Not in Assistant mode | Off | Server |
| **Inbox Watch** | Turns on [Inbox Watch](inbox-watch.md) and its Inbox. While it is on, **Schedule, models and cost** opens its schedule sheet; **Schedule** beside the Inbox's search box opens the same sheet, also in Assistant mode | Off | Server |
| **Vault** | Turns on the [Vault](vault.md). The first time, it creates the encryption key, saves it to `.env` and shows a recovery key to save. **Restore key…** appears when the Vault exists but its key is missing | Off | Server |
| **Agent access** (Vault on) | **Free rein**, **Ask once per command** or **Ask every time** | **Ask once per command** | Server |
| **Protection** (Vault on) | **Set a passphrase**, **Lock now**, **Unlock…**, **Change passphrase**, **Remove passphrase**, **Download recovery key**, **Rotate key**, and **Lock after** (**Never**, 15 minutes, 1 hour, 8 hours, 24 hours) when a passphrase is set | Server key, **Lock after: Never** | Server |
| **Export and import** (Vault on) | **Export…** and **Import…** one file with every item, encrypted with a passphrase you choose | | |
| **Catch secrets in messages** | Holds a key or password pasted or typed into a message and offers to store it in the Vault first. Shown whether or not the Vault is on | On | Server |
| **Open projects** | **As a tab, like a conversation**, **Beside the conversation** or **In a new browser window** | As a tab | This browser |
| **Files button** | **Lists files in the sidebar**, **Opens the library in a tab** or **Opens the library in split view** | Lists files in the sidebar | This browser |
| **Open files and links** | The same three choices, for a file and for a link in a conversation to one of your files, projects or conversations. Links to outside websites open in the browser | As a tab | This browser |

Turning Projects, Files, Tasks, Coordination, Inbox Watch or the Vault on or off also installs or removes the
matching agent skill for Claude Code and Codex (unless `POCKET_SKILLS=0`). Turning the Vault on or
off restarts idle conversation processes so they get the Vault's rules.

## Features (Assistant mode)

Assistant mode has no **Projects, files, tasks & vault** or **Agents & instance** category, so
**Features** holds the controls from them that a person needs. They are the same switches and the
same settings, for the whole install, and a change made here shows in Developer mode and the other
way round.

| Control | What it does |
|---|---|
| **Projects**, **Files**, **Tasks**, **Inbox Watch**, **Vault** | The same switches as in Developer mode; see [Projects, files, tasks & vault](#projects-files-tasks--vault). While Inbox Watch is on, **Inbox Watch schedule** appears under its switch and opens the [schedule sheet](inbox-watch.md#change-the-schedule-rules-and-models) |
| **Automatic model choice** | The **Choose the model for me** switch only. The decision model, key and four levels stay in Developer mode's [Agents & instance](#agents--instance), so no model name is shown in Assistant mode |

Turning a feature on or off closes Settings, because the rail and the home screen redraw; open
**Features** again for the next one. The other Vault controls (**Agent access**, **Protection**,
**Export and import**) and **Keep files from replies** (always on in Assistant mode) stay in
Developer mode.

When Assistant mode is locked (`POCKET_ASSISTANT_MODE=locked`), **Features** shows one line and no
switches, for example *Projects and Tasks are on. Files, Inbox Watch and Vault are off. To change
them, ask the person who runs this install.* They change it by switching the install to
Developer mode, which means removing `locked` from `.env` and restarting. A library that is off
shows *Files is off. Ask the person who runs this install to turn it on.* in place of the pointer to
Settings, with no **Open Settings** button.

## Notifications & voice

| Control | What it does | Default | Stored |
|---|---|---|---|
| **Completion chime** | A two-note blip when a reply finishes on screen | On | This browser |
| **Push to this device** | Web push to this browser, even when Pocket is closed. The bell on the conversation list does the same | Off until you turn it on | Server, per device (`push-subs.json`) |
| **Finished replies** | Push when a conversation finishes a reply, unless the conversation is muted or open in a browser, or you stopped the reply | On when push is turned on | Server, per device |
| **Due tasks and reminders** | Push once when each comes due; **Tomorrow** and **Done** on the notification answer without opening Pocket | On when push is turned on | Server, per device |
| **Vault requests** | Push when an agent needs a secret you have to allow, with **Allow** and **Deny** | On when push is turned on | Server, per device |
| **Inbox alerts** | Push for an alert from Inbox Watch or another job on the server | On when push is turned on | Server, per device |
| **Count on the app icon** | How many tasks and reminders are due, on the installed app's icon. Disabled in browsers without app-badge support | On | This browser, and with its push subscription |
| **Voice (beta)** | Voice preferences for this device; see below | | This browser |
| **Notice a day before** | A second notice 24 hours before a dated task or reminder comes due, the same way as the due one | Off | Server |
| **Email due tasks and reminders to** | An address that gets each due task and reminder by email. **Save**, then **Send a test**. Needs `POCKET_SMTP_URL` on the server; without it the field is disabled and the note says what to set | Empty | Server |

The four push kinds are disabled until **Push to this device** is on. Push needs HTTPS, the
server's `VAPID_PUBLIC` and `VAPID_PRIVATE`, and the browser's permission. Due reminders, Vault
requests and Inbox alerts are sent as urgent, so a phone gets them while idle; finished replies
are sent at normal priority. Links in reminder emails use `POCKET_PUBLIC_URL`, or the address you
last signed in from.

`POCKET_SMTP_URL` is an SMTP address with its login, for example
`smtps://user:pass@smtp.example.com:465`, or `smtp://…` for a server that uses STARTTLS.
`POCKET_SMTP_FROM` is the sender; without it Pocket uses the URL's user name when that is an email
address. Pocket sends one short message per due item and nothing else.

**Voice (beta)** controls, active only when the voice engine is installed on the server: **Mute
voice on this device** (off), **Speak replies** (on), **Spoken reply length** (**Brief**,
**Normal** (default) or **Detailed**), **Review before sending** (off), **Announce conversations**
(**Off** (default), **Conversation name only**, **Name and a one-line summary**), **Hands-free:
wait for my reply** (30 seconds, 1 minute, 2 minutes (default) or 5 minutes), **Voice**, **Names
and terms to recognize** (up to 300 characters) and **Play a sample**. The status line says whether
voice is available on the server. Details: [Voice](voice.md).

## Help & updates

- **Keyboard & workspace** (Developer mode): the keyboard shortcuts.
- **About & updates**: the app version and build in this browser, the server's build and commit,
  the Claude and Codex CLI versions, and the host and its uptime. The status says **Up to date**,
  **An update is available.**, **This browser is newer than the server. Server update pending.**
  or **Could not check for updates. Try again.** **Check again** checks once more. When the
  server has a newer build, **Update available: refresh to build N** clears this browser's cached
  app and reloads.
- **What's new**: the release notes for this build.
- **Bugs & feature requests** (Developer mode): **Report a bug** and **Request a feature** open the
  project's GitHub issue forms with your version and build filled in. Security problems go through
  **Report it privately**, not a public issue.

After an update, the first load shows a toast pointing to **What's new**.

**CLI updates** inside **About & updates** manages Claude Code and Codex separately from Pocket.
Pocket checks once a day at 4 a.m. in the owner's time zone, including daylight saving changes.
A notice appears when a release is available. Open it to see installed and available versions and
links to the publisher's release notes. Choose either CLI or both, then **Upgrade selected**.
**Later** closes the review; the notice remains. **Check now** checks immediately.

Upgrades continue on the server when you close the browser. Pocket downloads the exact selected
release into a separate installation and tests its version and startup protocol before selecting it.
These checks send no model prompts and do not test every connector or conversation. Active work
keeps its current process. Existing conversations switch on their next turn once no work is pending;
Claude background jobs prevent the switch. The review and notice show how many conversations
still use an earlier installation, separately for Claude Code and Codex. The review names each
conversation and says whether it is idle or working. **Switch now** releases an idle old process;
its next turn starts on the selected CLI. **Stop work & switch** interrupts a working conversation,
so its current reply can be incomplete; Pocket asks before stopping it. The next turn opens the
selected CLI. A Pocket service restart keeps existing CLI processes and is not needed for this.
Side chats keep their process until closed; new side chats use the selected CLI.

The result shows success, failure, or interruption. If one CLI succeeds and the other fails, it lists
the completed upgrade. Failed candidates are not selected. **Restore [version]** tests and selects
the previous installation; it does not undo conversation history. A server restart during installation
stops the job and offers a retry instead of automatically continuing. If activation had already been
saved, the selected version stays selected and the interrupted result says to check it before retrying.

An explicit server binary override remains managed outside Pocket. The server can turn off this
feature with `POCKET_CLI_UPDATES=0`. No overnight push notification is sent.


## Where preferences live

**This browser** keeps its choices in the browser's local storage, shared by every Pocket tab,
window and split pane of that browser and not by other devices. Clearing the site's data resets
them.

| Preference | Local storage key |
|---|---|
| Colour mode, highlight colour | `pc-theme`, `pc-accent` |
| Chat text size | `pc-chat-text-size` |
| Collapse steps, plain-word steps, message times | `pc-tools-collapsed`, `pc-plain-steps`, `pc-times` |
| Completion chime, icon count | `pc-chime`, `pc-icon-badge` |
| Open projects, Files button, Open files and links | `pc-projects-open`, `pc-files-button`, `pc-documents-open` |
| Voice preferences and mute | `pc-voice` |

Drafts, open tabs, split layout, filters, hidden conversations and per-conversation composer
choices are also kept per browser.

**The server** keeps instance-wide settings in the data directory, `POCKET_DATA_DIR`, which
defaults to the Pocket Code directory:

| File | What it holds |
|---|---|
| `pocket-settings.json` | Every **Server** setting above, plus two values Pocket learns: your browser's time zone and the public address you sign in through |
| `push-subs.json` | One entry per device with push on, with its choice of kinds and icon count. A subscription the push service reports as gone is removed |
| `router-key` | The key saved under **Automatic model choice** (mode `0600`) |
| `mutes.json`, `session-meta.json` | Per-conversation mutes, and pins and names (not part of Settings, the same on every device) |

The Vault's key is saved in `.env` in the Pocket Code directory, not in the data directory.
Settings and its files survive an upgrade. The full state inventory and backup notes are in
[operations](../operations.md#state-and-backups).

## Settings and environment variables

Several settings have an environment variable in `.env` that provisions an install before anyone
opens Settings. The rule for each pair:

| Setting | Variable | Which wins |
|---|---|---|
| **Mode** | `POCKET_ASSISTANT_MODE` | `on` sets the starting value; Settings wins after. `locked` always wins |
| **Generate short titles** | `POCKET_AUTO_TITLES` | Starting value only |
| **Model for titles and summaries** | `POCKET_TITLE_CLAUDE_MODEL`, `POCKET_TITLE_CODEX_MODEL` | The variables choose which model each option runs |
| **Update titles as conversations progress** | `POCKET_LIVE_TITLE_GAP_MS` | The variable sets the minimum time between checks |
| **Claude models in the picker** | `POCKET_CLAUDE_MODELS` | Settings, once a list is saved |
| **Actions that run without asking** | `POCKET_TRUSTED_ACTIONS` | Settings, once a list is saved (even an empty one) |
| **Automatic model choice** | `POCKET_ROUTER`, `POCKET_ROUTER_KEY`, `POCKET_ROUTER_KEY_FILE`, `POCKET_ROUTER_TIMEOUT_MS`, `POCKET_ROUTER_CONTEXT` | Settings, for each part saved there; the timeout and the business description are set only by the variables |
| **One sign-in** | `POCKET_ACCESS_TEAM`, `POCKET_ACCESS_AUD`, `POCKET_ACCESS_EMAILS` | Settings, until **Use the server's values** |
| **Push to this device** | `VAPID_PUBLIC`, `VAPID_PRIVATE`, `VAPID_CONTACT` | Push is off without the keys |
| **Email due tasks and reminders to** | `POCKET_SMTP_URL`, `POCKET_SMTP_FROM`, `POCKET_PUBLIC_URL` | The field is disabled without `POCKET_SMTP_URL` |
| **Vault** | `POCKET_VAULT_KEY` | Created by the switch; set by hand only when there is no `.env` |
| **Voice (beta)** | `POCKET_VOICE=off` | Turns voice off on the server |

A change to `.env` takes effect after a restart from the Pocket Code directory
(`pm2 restart ecosystem.config.cjs`). The other variables are in the README's
[Configuration](../../README.md#configuration) table.

## For agents

- Settings are the owner's. `GET` and `POST /api/settings` need the owner's browser sign-in
  (password or one sign-in); the loopback token the agent commands use is not accepted there. Tell the user the exact path to
  change, for example **Settings → Notifications & voice → Notice a day before**, rather than
  trying to change it.
- Do not edit `pocket-settings.json` while Pocket runs. The daemon reads it at start and rewrites
  the whole file on the next save, so a hand edit is lost.
- When a feature command answers that the feature is off, pass on the message, which names
  **Settings → Projects, files, tasks & vault**. In Assistant mode the switches are under
  **Settings → Features**, and when the mode is locked the user has to ask the person who runs the
  install.
- To provision an install before first use (models, trusted actions, Assistant mode, one sign-in),
  add the variables above to `.env` only when the user asks, then restart.
- Per-browser preferences cannot be set from the server.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Server switches stay disabled with **Loading…**, or **Could not load this setting.** | The settings request failed or timed out | **Retry name-sync setting**, or reopen Settings; check the daemon is running |
| **Generate short titles** says it is on but no signed-in Claude Code or Codex can make titles | Neither CLI is installed and signed in on the server | Sign in under **Accounts & instance**, or choose the other model |
| **Push not configured on server** | `VAPID_PUBLIC` and `VAPID_PRIVATE` are not set | Add them (re-running `pocket-init` adds missing keys) and restart |
| **Notifications blocked. Allow notifications in this site's browser settings.** | The browser's permission is off | Allow notifications for the site, then turn **Push to this device** on |
| **Count on the app icon** is disabled | The browser has no app-badge support | Use the installed app on a platform that shows icon counts |
| The email field is disabled | `POCKET_SMTP_URL` is not set, or the note shows **Email cannot be set up:** with the reason | Set `POCKET_SMTP_URL` (and `POCKET_SMTP_FROM`) in `.env` and restart |
| **Add a key first: automatic model choice needs one.** | **Choose the model for me** was turned on with no key saved or in the environment | Save a key, then turn it on |
| **Keep at least one model on** | You tried to stop offering the last offered model | Offer another model first |
| A rule is refused under **Add an action** | The rule changes files, covers everything, or is not valid syntax; the reason shows under the field | Fix the rule; see [action approvals](../action-approvals.md#actions-that-run-without-asking) |
| The **Vault** switch is disabled with **This Vault's key is missing on this server** | `vault.enc` exists but its key is not in `.env` | **Restore key…** with your recovery key |
| **Mode** options are disabled | `POCKET_ASSISTANT_MODE=locked` | Change it in `.env` and restart |
| **Features** shows a line and no switches | `POCKET_ASSISTANT_MODE=locked` | Ask the person who runs the install, or remove `locked` in `.env` and restart |
| A setting changed on one device does not show on another | It is a **This device** setting | Set it on each device |

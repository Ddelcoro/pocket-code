<!-- manual
checked: 1.102.0
sources: docs/install.md, scripts/pocket-init.mjs, access.mjs, public/manifest.webmanifest, public/sw.js, public/workspace.js
-->
# Getting started

Pocket Code is a browser and phone front end for the Claude Code and Codex sessions on your own
server. It drives the `claude` and `codex` command-line tools you already have installed and
signed in, so a conversation keeps running when you close the browser, lock the phone or switch
devices. A conversation is one Claude Code or Codex session. This page takes you from install to a
finished first conversation and shows where to switch on the optional features.

## Install it

Pocket Code runs on a Linux or macOS machine (on Windows, inside WSL2) with Node.js 20.11 or
newer, git, and Claude Code installed and signed in. Codex is optional. The short path is one
command:

```bash
curl -fsSL https://raw.githubusercontent.com/bbesner/pocket-code/main/install.sh | bash -s -- --yes --contact you@example.com
```

It clones the newest release into `~/pocket-code` (the Pocket Code directory), installs
dependencies and runs `pocket-init`, which writes `.env` with a generated password, cookie secret
and push keys, starts the daemon under PM2 and checks `/api/health`. The server listens only on
`127.0.0.1` (port 3610 by default), so you also need an HTTPS address in front of it: Tailscale
Serve, a Cloudflare Tunnel or a reverse proxy such as Caddy.

The full procedure, every check `pocket-init` runs, the HTTPS options and what to do when a step
fails are in [Install Pocket Code](../install.md). It is written so a Claude Code or Codex agent
can follow it for you.

## Sign in

Open the HTTPS address. The sign-in screen asks for one thing, the **Password**, then **Unlock**.

- The password is `POCKET_PASSWORD` in the `.env` file in the Pocket Code directory. On a terminal
  `pocket-init` prints it once; run by an agent, it leaves it in `.env` for you to read with
  `grep '^POCKET_PASSWORD=' ~/pocket-code/.env`.
- A successful sign-in keeps that browser signed in for 90 days.
- After 20 sign-in attempts from one address within an hour, further attempts get **Too many
  attempts — wait an hour.**
- There is one login for the whole install. Pocket Code is built for one owner; anyone who can
  sign in can run commands on the server as the user Pocket runs as. Read the
  [security model](../../SECURITY.md#security-model) before you share access.

**One sign-in with Cloudflare Access.** If the address sits behind Cloudflare Access, Pocket can
accept the Access sign-in instead of asking for its own password as well. It checks Cloudflare's
signature, the team, the application's audience tag, the expiry and the email against your list,
and signs the browser in for at most a day. Set it up in **Settings → Agents & instance → One
sign-in** (Team, Audience tag, Who may sign in this way), or with `POCKET_ACCESS_TEAM`,
`POCKET_ACCESS_AUD` and `POCKET_ACCESS_EMAILS` in `.env`. Anything that does not pass the check
gets the normal password screen. See [Settings](settings.md#agents--instance).

The `cli-token` file Pocket writes to its data directory is for the agent commands
(`pocket-board`, `pocket-docs` and the rest) on the server itself. It is not a browser login.

## Put it on your phone

Pocket Code is an installable web app (a PWA).

1. Open the HTTPS address in the phone's browser and sign in.
2. Add it to the home screen: on iPhone or iPad, Safari's **Share → Add to Home Screen**; on
   Android, the browser menu's **Install app** or **Add to Home screen**.
3. Open it from the new icon. It runs full screen, like an app. In Assistant mode the installed
   app is named **Pocket Assistant**.
4. Tap the bell at the top of the conversation list to turn on notifications for this device, or
   use **Settings → Notifications & voice → Push to this device**. Then choose which kinds this
   device gets: **Finished replies**, **Due tasks and reminders**, **Vault requests** and **Inbox
   alerts**.

Push needs HTTPS, the VAPID keys `pocket-init` wrote to `.env`, and the browser's permission. On
iPhone and iPad, web push works only from the installed app. The app caches its own screens, never
your conversations or files, so with no connection it opens and says **You're offline.** with
**Try again**; your drafts are kept.

## Developer mode or Assistant mode

Pocket has two faces over the same conversations, files, tasks and vault. Switch in **Settings →
Appearance → Mode**: the mode you are in is shown pressed. The choice applies to this Pocket on
every device.

| | Developer mode | Assistant mode |
|---|---|---|
| Opens on | The conversation list (on a desktop, the conversation rail beside the open conversation) | A message box, **What would you like done?**, with **Waiting for you** cards and your five **Recent** conversations below |
| Model and reasoning | Chips above the message box for model, reasoning, permissions and (Codex, OpenRouter) Plan first | Hidden. **Automatic model choice** picks one when it is set up, otherwise the default model runs. **Try harder** under a Claude reply asks for a more careful pass on a stronger model |
| Workbench | Tabs, split view, **Results**, **Queue**, **Git**, changed files, filters, cost and timing | Hidden |
| Steps | Each step in plain words, with the command or path beside it | Plain words only |
| Files from replies | Kept in Files when **Keep files from replies** is on | Always kept (when Files is on) |
| Settings | Every category | Appearance, Conversation, Accounts, Notifications & voice, Help & updates |
| Name | Pocket Code | Pocket Assistant |

Use Developer mode if you write code or run coding agents. Use Assistant mode if Pocket is your
assistant for office work (email, quotes, documents) and you never want to see the machinery.
Nothing is deleted when you switch; the same conversations are underneath.

An administrator can set the starting mode for an install with `POCKET_ASSISTANT_MODE=on` in
`.env`, or keep Assistant mode on with `POCKET_ASSISTANT_MODE=locked`. When it is locked, both
Mode options show disabled with the reason, and Settings cannot switch back. The install's features
then cannot be changed from Settings either: **Settings → Features** says what is on and to ask the person who runs the install.

## Turn on the optional features

Projects, Files, Tasks, Inbox Watch and the Vault are off on a new install. Each is switched on
for the whole install in **Settings → Projects, files, tasks & vault**, and its view then appears
in the rail (desktop) or as a chip on the home screen (phone). In Assistant mode the same switches
are under **Settings → Features**, with **Automatic model choice**. While the mode is locked,
**Features** only says what is on, and the person who runs the install changes it.

| Feature | What it does | Page |
|---|---|---|
| **Projects** | A card per piece of work: where you left off, the next step, a checklist, reminders and the conversations that worked on it | [Projects](projects.md) |
| **Files** | A library for the reports, PDFs, spreadsheets and pages agents produce, private until you share one | [Files](files.md) |
| **Tasks** | To-dos with an optional date, linked to the conversation they came from | [Tasks](tasks.md) |
| **Inbox Watch** | Reads your Gmail on a schedule and lists only what needs you, through the Gmail connector of Claude Code or Codex | [Inbox Watch](inbox-watch.md) |
| **Vault** | API keys, tokens and logins, encrypted on the server, that agents use by name without seeing them. Turning it on creates the key and shows a recovery key to save once | [Vault](vault.md) |
| **Voice** (beta) | Speak to a conversation and hear a short reply. Not a switch: install the speech engine with `bash scripts/voice-setup.sh` from the Pocket Code directory, then restart Pocket; the mic appears beside Send | [Voice](voice.md) |

While a feature is on, Pocket installs its agent skill for Claude Code and Codex, so agents on the
server know how to use it. Conversations already running pick it up from their next reply.

## Your first ten minutes

### Start a conversation

1. Press **+** (**New conversation**): at the top of the rail on a desktop, at the bottom corner
   of the list on a phone. In Assistant mode the home screen is already a new conversation.
2. Type what you want done in the box under **What would you like done?**
3. Check the line above the box: **Workspace**, **Agent** and **Permissions**. Press **Edit setup**
   to choose **Claude Code** or **Codex**, a **Project** (a folder your recent conversations worked in),
   or type a full path under **Or a custom path**. On a new install the project list is empty, so
   type the path. The agent works in that folder.
4. In Developer mode, the chips above the box set the model, the reasoning effort and the
   permissions for this reply. Leave them on **Default** and **Review actions** for a first run.
5. Press the arrow (**Start conversation**). On a desktop, Enter sends and Shift+Enter adds a line.

The conversation opens and the reply streams in. You can leave: the work continues on the server,
and a push notification arrives when the reply finishes (if you turned push on).

### Answer it

The agent stops for you in three ways, each shown in the conversation:

- **Suggested replies.** When a reply ends with a choice, the options appear as buttons under it,
  the recommended one marked. Tap one to send it, or tap **X** to dismiss them and type your own.
- **A question.** A banner such as **Claude has a question for you** with **Answer** opens the
  question with its options and a box for your own answer. Typing in the message box instead
  skips the question.
- **An approval.** In **Review actions**, a banner **Waiting for your OK · Review** opens a card
  that says what the agent wants to run or change, with **Allow** and **Don't allow**. **Show
  details** shows the full request. See [Questions and approvals](approvals.md).

You can also type into the message box while the agent works, to steer the running reply or to
queue a follow-up for after it.

### Find the result

- The answer is in the conversation. A file the agent hands over (a PDF, a deck, a sheet, a page)
  appears as a card with **Open**, **Download** and, when Files is on, **Keep in Files**.
- In Developer mode, **Results** in the conversation header lists every report, file and link the
  conversation shared, with **Copy link** and **Keep in Files**.
- With Files on, kept files are in the **Files** view, linked back to the conversation.
- The conversation stays in the list. On a desktop the rail groups conversations as **Running**,
  **Working in background**, **Activity elsewhere**, **Needs attention**, **Waiting** and
  **Recent**; **Needs attention** collects questions, approvals and replies that did not finish.
  Coming back to a conversation with new work opens it at a **New since** line.

## For agents

When a user asks you to set up or explain Pocket Code:

- Install by following [Install Pocket Code](../install.md#running-it-as-an-agent): use
  `--yes --contact <email>`, verify with `curl -s http://127.0.0.1:3610/api/health`, and tell the
  user where the password is (`grep '^POCKET_PASSWORD=' <Pocket Code directory>/.env`). Never print
  or repeat the password.
- Settings are changed by the signed-in owner in the browser. The `/api/settings` route needs the
  owner's sign-in cookie and does not accept the agent commands' loopback token, so give the user
  the exact path to click, for example **Settings → Projects, files, tasks & vault → Tasks** (in
  Assistant mode, **Settings → Features → Tasks**).
- An agent command for a feature that is off fails with a message naming that path, for example
  `Tasks is off. Turn it on in Settings → Projects, files, tasks & vault.` Pass it on; do not try
  to switch the feature on yourself.
- Do not add settings to `.env` that the user did not ask for. Settings that exist only as
  environment variables need a restart from the Pocket Code directory:
  `pm2 restart ecosystem.config.cjs`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The password is accepted but you land back on the sign-in screen | The sign-in cookie is marked `Secure`; over plain HTTP on a network address the browser drops it | Open Pocket through its HTTPS address |
| **Too many attempts — wait an hour.** | More than 20 sign-in attempts from one address within an hour | Wait an hour, and check the password in `.env` |
| You changed `POCKET_PASSWORD` but other browsers are still signed in | Sign-in cookies are signed with `POCKET_SECRET`, not the password | Change `POCKET_SECRET` as well and restart; every browser has to sign in again |
| **Push not configured on server** when you tap the bell | `VAPID_PUBLIC` and `VAPID_PRIVATE` are not set | Run `node scripts/pocket-init.mjs` again (it adds missing keys) or set them by hand, then restart |
| **Notifications blocked** | The browser's notification permission for the site is off | Allow notifications in the browser's site settings, then turn push on again |
| No **Projects, files, tasks & vault** in Settings | You are in Assistant mode | Use **Settings → Features**, or switch to Developer mode in **Settings → Appearance → Mode** |
| **Features** shows a line and no switches | `POCKET_ASSISTANT_MODE=locked` on the server | Ask the person who runs the install |
| Mode options are disabled | `POCKET_ASSISTANT_MODE=locked` on the server | Change it in `.env` and restart to allow Developer mode |
| No mic beside Send | The voice engine is not installed, or `POCKET_VOICE=off` | See [Voice](voice.md) |
| **You're offline.** or **The server didn't answer** | The phone has no connection, or the daemon or tunnel is down | **Try again**; on the server check `pm2 status` and `curl -s http://127.0.0.1:3610/api/health` |

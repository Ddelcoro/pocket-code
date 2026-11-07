# Pocket Code manual

Pocket Code puts your Claude Code and Codex conversations in a browser and on your phone, running on
your own server. This manual explains each feature: what it does, how to turn it on, how to use it,
how it works underneath and what to do when it misbehaves. It is written for the person using Pocket
and for the AI agents working beside them, and both read the same pages.

New here? Start with [Getting started](getting-started.md).

A *conversation* is one Claude Code or Codex session that Pocket runs for you; the app and this manual
say conversation.

## Pages

| Page | What it covers |
|---|---|
| [Getting started](getting-started.md) | Install, sign in, add Pocket to a phone, Developer and Assistant mode, a first conversation |
| [Conversations](sessions.md) | Start, find, resume and close conversations; agent, workspace, model, effort and permissions; saved prompts; usage and limits |
| [Working in a conversation](conversation.md) | The message box, attachments, slash commands, reply buttons, results, changed files, Git, steering and the queue, side chat, Branch, subagents |
| [Questions and approvals](approvals.md) | Questions from the agent, Review actions and Full access, action approvals, trusted rules |
| [Desktop and phone](desktop-and-phone.md) | The desktop workspace, split view and dock, the phone layout, compact views, keyboard shortcuts |
| [Settings](settings.md) | Every section of Settings, notifications, appearance and where each preference is stored |
| [Projects](projects.md) | Project cards, checklists, reminders and the `pocket-board` command |
| [Files](files.md) | The Files library, sharing and publishing, and the `pocket-docs` command |
| [Tasks](tasks.md) | To-dos with due times, reminders and a Start button, and the `pocket-tasks` command |
| [Coordination](coordination.md) | Which conversation holds staging or a deploy, who is waiting, and the `pocket-coord` command |
| [Inbox Watch](inbox-watch.md) | Alerts, digests and look-aheads from your mailbox, setup, and the `pocket-inbox` command |
| [Gmail, Calendar and Drive](google.md) | Using Google through each agent's connectors, and the drafts-first rule |
| [Vault](vault.md) | Credentials agents use by name and never see, approvals, and the `pocket-vault` command |
| [Voice](voice.md) | Dictation and hands-free voice mode (beta) |
| [For agents](for-agents.md) | How Pocket runs agents, the instructions and skills it gives them, and the commands they can use |

Running a server rather than using one: [Install](../install.md) takes a machine to a running Pocket
Code, and [Operations](../operations.md) covers upgrades, restarts, backups and recovery.
[SECURITY.md](../../SECURITY.md) explains the security model and how to report a problem.

## Common questions

| Question | Answer |
|---|---|
| How do I turn on Projects, Files, Tasks, Inbox Watch or the Vault? | [Getting started](getting-started.md#turn-on-the-optional-features), then the feature's page |
| What do Review actions and Full access do? | [Questions and approvals](approvals.md#choose-review-actions-or-full-access) |
| How do I share a file by link? | [Files](files.md#share-a-file) |
| Why didn't a reminder or due task reach me? | [Tasks](tasks.md#troubleshooting) and [Projects](projects.md#troubleshooting) |
| How do I set up Inbox Watch? | [Inbox Watch](inbox-watch.md#set-it-up) |
| How do I connect Gmail, Calendar or Drive? | [Gmail, Calendar and Drive](google.md#connect-gmail-calendar-and-drive) |
| How do I give an agent an API key without pasting it? | [Vault](vault.md#store-a-secret-from-a-conversation) |
| Where is a setting, and is it per device? | [Settings](settings.md) |

## For agents reading this

Pocket tells every agent it starts where this index is. When the user asks how something in Pocket works or
how to set it up, open the page for that feature from the table above and answer from it; don't read
the source unless the page doesn't cover the question. Each page's **For agents** section lists the
commands you can run and the rules for when to act and when to ask. The comment at the top of each page
names the release it was last checked against (`checked:`). If the user's Pocket is much newer than that
and the page seems wrong, say so and check the code.

## Keeping it current

Each page opens with a comment naming the release it was checked against and the source files it
describes. `npm run check:manual` lists the pages whose sources changed after the page did; see
[CONTRIBUTING.md](../../CONTRIBUTING.md#the-manual) for how pages are kept in step with releases.

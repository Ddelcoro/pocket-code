---
name: pocket-inbox
description: Read and answer Inbox Watch in Pocket Code. Use when the user asks what Inbox Watch (their inbox watcher, the inbox monitor) sent, about today's alerts, digest or look-ahead, about an alert on a customer or a story, or asks to mark one resolved, not useful or dismissed, or to bring one back. Also use when a job on this server needs to post an alert, digest or look-ahead to the user's Inbox.
---

# Pocket Code Inbox Watch

Pocket Code keeps **Inbox** on its own server: what the user's inbox watcher sent them. There
are three kinds of entry: an **alert** (one email thread that needs the user, with a briefed
conversation to open), a **digest** (a summary of a stretch of mail, kept in Files) and a
**look-ahead** (what is coming up today). Each entry has a title, a short text whose
`[label](msg:<id>)` citations point at the emails it came from, the story it belongs to (for
example "Acme HOA service-call story"), a priority, and links to open it in Pocket, in Gmail or
in Files. The user sees the list under Inbox in Pocket Code on every device and answers each
entry there. You read and answer it with the `pocket-inbox` command.

<!-- pocket:commands -->
Run `pocket-inbox` from the Pocket Code directory (`node scripts/pocket-inbox.mjs`). The session
instructions Pocket gives you name the exact command.
<!-- /pocket:commands -->
<!-- pocket:manual -->
How this feature works, how it is set up and its limits: `docs/manual/inbox-watch.md` in the Pocket Code directory.
<!-- /pocket:manual -->

## Reading it

```bash
pocket-inbox list                     # the new (unread) entries, newest first
pocket-inbox list --state all         # everything except dismissed
pocket-inbox list --state dismissed   # dismissed entries (kept 30 days); Pocket's Done filter also shows resolved and not useful
pocket-inbox list --since 2026-10-19T00:00:00Z
pocket-inbox show <id>                # one entry in full: text, story, links, note
```

Use these when the user asks "what did Inbox Watch send today", "anything urgent from the
inbox", "what was the Acme HOA alert about". Answer from the entries: the title, what the text
says, the story and when it came in. Keep the citations' labels; the links are the user's to
open in Pocket or Gmail.

## Answering an entry

What the user decides about an entry goes back to the watcher, which changes what it sends
next time:

- **Resolved** (`resolve`): the situation is over. The watcher stops following that story.
- **Not useful** (`not_useful`): the user does not want alerts about this kind of thing. The
  watcher adds it to the user's preferences and lowers that story's priority.
- **Dismiss** (`dismiss`): hide it in Pocket. Nothing else changes.
- **Restore** (`restore`): undo any of those three.

```bash
pocket-inbox act <id> resolve
pocket-inbox act <id> not_useful --note "Vendor newsletters are never urgent"
pocket-inbox act <id> dismiss
pocket-inbox act <id> restore
```

A digest's lines are items with a `ref` each (`show` prints them, as `[a317]`). A decision can land on one item instead of
the whole digest: **Alert me** (`alert`) has the watcher send that story as an alert of its own now and learn to alert on
that kind of mail; `resolve` and `not_useful` act on that story alone; `restore` takes any of them back.

```bash
pocket-inbox act <id> alert --item a317
pocket-inbox act <id> not_useful --item a296 --note "Steve texts me anyway"
```

**Act only when the user asks**, in words that name the decision: "mark the Northside alert
resolved", "that one wasn't useful", "dismiss the look-ahead", "bring back the Acme HOA alert".
Never resolve, dismiss or mark anything not useful on your own judgment, even when the
situation looks finished; tell the user what you see and let them decide. A `--note` carries
the user's reason, in their words, when they gave one. If more than one entry could match what
the user said, list them and ask which.

After acting, confirm in one sentence: the entry's title and what you recorded.

## When it checks, which models judge, what it costs

```bash
pocket-inbox watch                    # the schedule in force, the next check, the models, the last 7 days' calls and cost
pocket-inbox watch set --every 10     # change one thing, only when the user asks ("check every 10 minutes")
pocket-inbox watch set --pause        # or --resume
pocket-inbox watch set --file -       # the whole settings object as JSON (periods, quiet hours, digest, look-ahead, models)
pocket-inbox watch reset              # back to the watcher's own config file
pocket-inbox check                    # check mail now, whatever the schedule (when the user asks: "check my email now")
```

**Your rules** (the **Schedule, models and cost** sheet, or **Schedule** in the Inbox → Your rules) are the owner's own words about what they always or never want
to hear about; the watcher follows them on every check and they win over its judgment. When the user asks you to
change them ("stop telling me about shipping notices"), read them with `pocket-inbox watch --json` (`profile.rules.text`),
add or edit a line, and save the whole settings object with `pocket-inbox watch set --file -` including `rules`. Confirm
the line you added.

Inbox Watch can also keep the list tidy on its own (the same sheet → Keep the Inbox tidy): every few
hours it takes off entries that have been resolved or handled, with the reason in the entry's note, and they show
under **Done**. An agent asked to "clean up my Inbox" now can still go through `list` and `act` by hand.

The same settings are in Pocket under **Settings → Projects, files, tasks & vault → Inbox Watch
→ Schedule, models and cost**; the watcher picks a change up within a minute. Dollar figures are
what the tokens would cost at API list prices; on a Claude or ChatGPT plan nothing is billed per
call, the plan's usage limits are what it draws on. Change settings only when the user asks.

## Posting to it (jobs on this server)

The inbox watcher and other jobs post entries; an agent in a conversation does not, unless the
user asks for that job to be set up.

```bash
pocket-inbox add --title "Acme HOA needs dispatch attention before 9 a.m." --file - \
  --kind alert --priority high --story "Acme HOA service-call story" \
  --url "/#/start/<id>" --gmail "https://mail.google.com/mail/u/0/#all/<thread>" --dedupe "vendor:<thread>"
pocket-inbox feedback          # the user's decisions the job has not applied yet
pocket-inbox ack <id…>         # after applying them
pocket-inbox seen              # a heartbeat when a run posts nothing
```

`add` sends a push to the user's devices (`--no-push` to skip it) and, with `--email`, an
email to the address saved in Settings. A `--dedupe` key already used in the last 24 hours
adds nothing and says `duplicate`.

## If Inbox Watch is off

`pocket-inbox` says so and exits with code 1. Tell the user that Inbox Watch is turned off and
can be turned on in Pocket Code under **Settings → Projects, files, tasks & vault → Inbox Watch**.
Exit code 2 means Pocket Code is not running on this server.

<!-- manual
checked: 1.95.0
sources: inbox.mjs, inbox-runner.mjs, public/inbox.js, scripts/pocket-inbox.mjs, skills/pocket-inbox/SKILL.md, inbox-watch/
-->
# Inbox Watch

Inbox Watch reads one Gmail mailbox on a schedule you set and tells you only what deserves your attention. It follows
each situation as a story across threads and senders, keeps a memory of recent mail, and sends an **alert** when an
email tells you something the email itself does not (a repeat failure after a repair, a bill that is now due, a reply
that never came). A **morning digest** covers the rest, and a **look-ahead** twice a day checks what is coming due.
Everything it sends lands in Pocket's **Inbox**, where you read it, start a conversation already briefed on the story,
and tell the watcher what you thought of it.

Inbox Watch has two parts. The **Inbox** is the list inside Pocket (`inbox.mjs`, `public/inbox.js`, the `pocket-inbox`
command). The **watcher** is a Python program shipped in the `inbox-watch/` folder of the Pocket Code directory; it
reads the mail, asks a model to judge it, and posts to the Inbox. Pocket runs the watcher for you unless you installed
one by hand.

## Requirements

- Python 3.11 or newer available as `python3` to the Pocket server. Reading through a connector needs nothing beyond
  the standard library.
- Claude Code signed in with a Claude subscription and the **Gmail** connector connected, or Codex signed in with
  ChatGPT and the **Gmail** app connected. Either is enough; with both on the same mailbox, each stands in for the other.
  See [Gmail, Calendar and Drive for agents](google.md#connect-for-claude-code).
- Optional: an OpenRouter key for the first pass (see [First pass](#first-pass)).
- Optional: [Files](files.md) turned on, so digests and look-aheads are also kept as documents, and push notifications on
  your devices for alerts.

## Set it up

1. Connect Gmail for Claude Code or Codex: **Settings → Agents & instance → Connectors** (in Assistant mode,
   **Settings → Accounts → Connectors**).
2. Turn on **Settings → Projects, files, tasks & vault → Inbox Watch** (in Assistant mode, **Settings → Features → Inbox Watch**). The toast says
   *Inbox Watch is on*, and **Inbox** appears in the sidebar switch and as a chip on the home screen.
3. Open Pocket once on your phone or computer, if you have not since turning it on. The watcher uses the time zone
   your browser reports for quiet hours, the digest and the look-ahead.

Nothing else is needed. Within a minute Pocket:

1. Finds your mailbox. It asks Claude Code's Gmail connector first, then Codex's Gmail app, whose account they read.
   Through Claude Code the address is taken from the newest message in your Sent mail; through Codex, from the app's
   profile.
2. Writes the watcher's config to `POCKET_DATA_DIR/inbox-watch-data/config.toml` and an empty rules file beside it.
3. Starts from now: mail already in the mailbox is not news, so nothing old is alerted on.
4. Loads the last 14 days of mail as the watcher's memory.
5. Runs the watcher's `tick` every minute. A tick checks mail only when your schedule says a check is due.

While this happens the Inbox shows a status line: *Setting up Inbox Watch for alex@example.com*, then
*Watching alex@example.com. Nothing needs you yet* until the first alert arrives.

### What Pocket's setup chooses

| Setting | Value written | Change it in |
|---|---|---|
| Mail source | Claude Code's Gmail connector (reads made by Haiku), else Codex's Gmail app (the newest GPT Luna this Codex lists, low reasoning); the other one as fallback when both reach the same mailbox | `config.toml`, `[mail]` |
| Judge | Claude Code with Sonnet, medium reasoning, when Claude Code runs on the server; otherwise Codex with the newest GPT Sol this Codex lists (GPT-6.1 Sol today), medium. Both are written when the watcher is set up; an existing `config.toml` keeps its models | Schedule sheet, **Models** |
| Schedule | every 5 minutes, quiet hours 10 PM to 8 AM, digest at 8 AM, look-aheads at 8 AM and 5 PM | Schedule sheet |
| First pass | on, Jev, skip at 80% sure (works only once a key is present) | Schedule sheet, **First pass** |
| Tidy | on, every 2 hours | Schedule sheet, **Keep the Inbox tidy** |
| Gmail label | on, named *Pocket Inbox* | Schedule sheet, **Your list in Gmail** |
| Briefed conversations | start in your home directory, with Claude Code (or Codex when only Codex is signed in) | `config.toml`, `[pocket]` |

Each time Pocket starts, it asks the connector whose mailbox it reads. If you have reconnected Gmail to a different
account, Pocket writes the new address into `[owner]` (the watcher tells your own mail from other mail by it), drops a
fallback agent that is still on the old account, and the Inbox says *Gmail is now connected as … (it was …)* for a few
days. The mail already kept from the old account stays in the watcher's memory. Sending from an alias of the same account
is not a change: the configured address only has to be among those that sent your latest sent mail. Only a config Pocket
wrote is changed.

The settings in Pocket win over the file. Edit `config.toml` only for what Pocket has no setting for, such as the
optional [memory integration](#memory-integration-optional) or emailing alerts (`email = true` under `[[delivery]]`).

### A watcher you install yourself

To watch another mailbox, read Gmail through Google's API (an OAuth client or a Workspace service account), use a
different judge (OpenClaw, the Claude API) or deliver to Telegram or email as well, install the watcher by hand. The
steps, every config key and the systemd timer are in [`inbox-watch/README.md`](../../inbox-watch/README.md) and
`inbox-watch/examples/config.example.toml`. The `inbox-watch/bin/inbox-monitor` command uses the first `python3` on `PATH` that is 3.11 or newer, or the one named
in `INBOX_MONITOR_PYTHON`. Turn on Inbox Watch in Pocket so its Inbox receives what that watcher sends.

Pocket never manages a mailbox someone else set up. If a watcher is already reporting to this Pocket (it sends its
profile with `pocket-inbox seen`, as every `inbox-monitor` does) and Pocket has no config of its own, Pocket leaves the
Inbox to it, does not start its own, and the Inbox says so. A job that only posts with `pocket-inbox add` is not a
watcher and does not stop Pocket. `POCKET_INBOX_RUNNER=0` in Pocket's environment turns Pocket's own watcher off entirely.

## Use it

### What it sends

| Kind | When | What it holds |
|---|---|---|
| **Alert** | at a check, when a thread passes the judge's bar | A title, a short text citing the emails it rests on, the story it belongs to, a priority, **Start a conversation** and **Open in Gmail** |
| **Digest** | once a day at the digest hour, outside quiet hours, when there is something to say | Alerts held overnight, ones that resolved overnight, *Worth knowing* lines, entries the tidy pass took off, and how many threads were ignored. Each line is an item of its own in Pocket, with its own choices (see [A digest's items](#a-digests-items)) |
| **Look-ahead** | once in each look-ahead window (from the hour you set, for 4 hours), outside quiet hours | What is due or at risk in the next few days, from open stories and dated mail. Sent only when something needs you |

Priorities are critical, high, normal and low. **Critical** is kept for live outages you are the escalation for,
security incidents and money leaving an account unexpectedly. During quiet hours only critical alerts go out; the
rest are held. At the digest hour up to five held high or critical alerts go out on their own, marked *Held
overnight.*, and the rest fold into the digest. A held alert whose story was resolved overnight is not sent.

Each alert also sends a push to devices that have **Settings → Notifications & voice → Inbox alerts** on. The push
shows the title and the first sentence; tapping it opens the briefed conversation, or the entry when there is none.
Digests and look-aheads are also saved to **Files** when Files is on.

### Read the Inbox

Open **Inbox** from the sidebar switch (the envelope, with a count of unread entries), the **Inbox** chip on the home
screen, or `#/inbox`. It opens like a conversation: as a tab, beside a conversation or in its own window. In Assistant
mode up to three open alerts also wait on the home screen as **Waiting for you** cards.

- The chips filter the list. **Open** (the default) is everything still on your list, read or not. **Unread** is
  only the new ones. **Done** holds what is resolved, not useful or dismissed, each row showing why.
- **Search titles and stories** narrows the list by title, story or text.
- Each row shows the title, the first sentence, the time, the story and the kind. The **dot** beside the title is
  filled while unread; tap it to mark the entry read or unread. A **speech bubble** under it opens the conversation
  you started from that entry.
- Tap the row, or **…**, to open the entry's sheet. Opening it marks it read.

The entry's sheet shows the whole text, with each citation a link to that email in Gmail, and these choices:

- **Open the conversation**: the conversation started from this entry (the latest, when there are several).
- **Start a conversation** (or **Start another conversation**): a new conversation already briefed with the story,
  the evidence and the Gmail links. Nothing starts until you press Start. The briefing link lasts 7 days.
- **Open in Files**: a digest's full text.
- **Open in Gmail**: the thread.
- **Resolved**, **Not useful**, **Dismiss**, or **Restore** on a finished entry (see below).

The **X** on a row dismisses it directly.

### A digest's items

A digest's sheet shows its lines as cards, under the headings the digest has (*Held overnight*, *Came up overnight and
already resolved*, *Worth knowing*, *Taken off your Inbox*), each with its title, its text (citations are Gmail links),
its story and these choices:

- **Start a conversation**: a new conversation already briefed with that one story and its evidence, as an alert's is.
  Nothing is sent and the watcher learns nothing from it; it is for dealing with this one line now.
- **Alert me**: this line should have been an alert. The watcher sends that story as an alert of its own at its next
  check (within a minute or two, whatever quiet hours say, since you are up and asking) and learns from it the way it
  learns from a Gmail label: a rule under *Learned from your choices* saying to alert on that kind of mail.
- **Resolved** and **Not useful**: the same as on an alert, but for that story alone rather than the whole digest.
- **Undo**: takes any of the three back.
- **Gmail**: the thread.

A line whose story already has an open alert on your list is not a new card: it sits under **Already on your list** as one
line that opens that entry, and your decision belongs on the entry. A line that resolved overnight or that the tidy pass took
off is history and has only the Gmail link. The card says
*Alert requested*, *Resolved* or *Not useful* once you have decided, and the digest itself stays open until you dismiss
it. A digest from before 1.95 has no items and shows its text alone.

### Tell the watcher what you decided

| Choice | In Pocket | What the watcher does at its next check |
|---|---|---|
| **Resolved** | moves to Done | Closes the story: it stops following it and no longer treats it as open |
| **Not useful** | moves to Done | Learns from it (see [Learning from your choices](#learning-from-your-choices)): a rule under *Learned from your choices* saying what kind of mail is a digest line at most, with your note taken into account, and lowers the story to low priority |
| **Dismiss** | moves to Done | Nothing; the story is unchanged |
| **Restore** | back to Open | Reopens a story that Resolved had closed |
| **Alert me** (a digest item) | the card says *Alert requested* | Sends that story as an alert now, lifts a low story to normal and learns a rule to alert on that kind of mail |
| **Resolved** / **Not useful** (a digest item) | the card says so | As above, for that story alone |

With the Gmail label on, finishing an entry in any of the three ways also takes the label off its thread and archives
it (see [Your list in Gmail](#your-list-in-gmail)).

Pocket records each decision with the entry; the watcher asks for the ones it has not applied
(`pocket-inbox feedback`), applies them and acknowledges them (`pocket-inbox ack`), so none is applied twice.

### Check now

**Check now** sits beside the search box in the Inbox and beside **All** in the sidebar list. It asks the watcher
to check at once, whatever the schedule, paused included. The chip shows *Checking…* until the watcher reports back,
then the list reloads and a note says how many new items it found. A check you ask for skips quiet hours: its alerts
go out at once, together with every alert quiet hours were holding.

### Change the schedule, rules and models

**Schedule** in the Inbox, or **Settings → Projects, files, tasks & vault → Schedule, models and cost** (shown under
the Inbox Watch switch while it is on; in Assistant mode **Settings → Features → Inbox Watch schedule**), opens the Inbox Watch sheet. Its first line says what is in force, for example
*Checking every 5 minutes now (Work hours). Last check 9:14 AM, next about 9:19 AM.* **Save** sends the whole sheet;
the watcher picks it up within a minute, and the line says *Your last change reaches the watcher within a minute*
until it has. **Use the config file's settings** hands control back to `config.toml`.

- **Pause Inbox Watch**: no checks, digests or look-aheads until you turn it off.
- **What it reads** (1.95): which mail the watcher looks at. **Everything** is every thread but spam, trash and drafts, so mail
  your Gmail filters archive or file away is judged too (the behaviour before 1.95). **Inbox only** reads what is in your Gmail
  inbox. **Inbox and these labels** adds the Gmail labels you pick from the chips (your labels appear once the watcher has read
  them; **Add** takes a name it has not listed). Mail outside the scope is never fetched or judged, for alerts or the digest; an
  email you label Pocket Inbox always joins the check, and the research the judge does on a story is not bounded.
- **Your rules**: your own words about what you always or never want to hear about ("Tell me when a customer asks for
  a quote", "Never alert me about newsletters"). The watcher follows them in every decision, the first pass, the
  look-ahead and the tidy pass, and they win over its own judgment, even for something it would call critical. The
  box shows the watcher's rules file, including the rules it learned (*Learned from your choices*, at the end). Saving
  replaces the file; the watcher keeps the previous version. Up to 8,000 characters.
- **Your list in Gmail**: the *Pocket Inbox* label (below).
- **Schedule**: an interval for *the rest of the time* (from *Every minute* to *Every 4 hours*, or *Don't check*),
  and up to 12 periods, each with a name, days, *From*, *Until* and its own interval. An *Until* earlier than *From*
  runs past midnight. When periods overlap, the first listed wins. With *Don't check* and no periods, the watcher
  checks only on demand and with the digest and look-aheads.
- **Quiet hours and summaries**: *Quiet from* and *Until*, the **Morning digest** hour, and the **Morning
  look-ahead** and **Evening look-ahead** hours (or *Off*). Times are the watcher's time zone; the sheet names it when
  your device is in another.
- **Keep the Inbox tidy**: *Take finished items off my list* and **How often** (every 1, 2, 4, 8, 12 or 24 hours).
- **Models** (Developer mode): model and reasoning for **Decisions** and for the **Look-ahead**. A Claude Code judge
  offers Haiku, Sonnet, Opus and Fable; a Codex judge offers the model its config names. *Model default* leaves the
  reasoning to the model.
- **First pass** (Developer mode): *Skip routine mail first*, the **Classifier** and **Skip when at least** (70, 80,
  90 or 95% sure).
- **Cost, last 7 days** (Developer mode): checks, skipped mail, model calls, tokens and dollars per day.

In Assistant mode the sheet opens only from **Schedule** in the Inbox and shows no models, first pass or costs.

### Keep the Inbox tidy

With tidy on, every few hours outside quiet hours the watcher reviews the open alerts at least 30 minutes old and
takes off what no longer needs you. An older entry on a story with a newer one, and an entry whose story is closed, go
without a model call. For the rest, one judge call reads each entry with its story, the timeline and the later mail in
its threads (your own replies marked) and answers:

- **Resolved**: over. The entry is marked resolved and the watcher stops following the story.
- **Handled**: someone acted and it now waits on someone else. The entry is dismissed; the watcher keeps following it
  and alerts again if it changes.
- **Open**: still needs you. It is not looked at again until its story or threads change.

Every change must cite the email that proves it; money, security and legal items need explicit proof, and a request
with several parts stays open until every part is done. The reason becomes the entry's note, shown in Done, and the
next morning digest lists what was taken off. **Restore** brings any of them back.

### Your list in Gmail

With **Keep a Pocket Inbox label in Gmail** on (the default), the open entries in your Inbox and one Gmail label stay
in step, both ways, at every check:

- An alert's thread gets the *Pocket Inbox* label (created when missing) and stays in your Gmail inbox.
- Give a thread that label in Gmail and the next check judges it and puts it on your list as an alert with a summary,
  even in quiet hours, and moves it back to your Gmail inbox if it had been moved out. The watcher also learns from it
  (below).
- A Gmail filter can add the label too (to put a kind of mail on your list as it arrives). The watcher tells the two
  apart: mail that arrives already carrying the label was labelled by a filter, so its alert says *Your Gmail filter put
  this on your list*, not *You added this*, and it teaches the watcher nothing. A label you add to mail already in your
  mailbox is yours. This needs the Gmail API (the service account or your own sign-in); through a connector the
  watcher cannot see when a label went on, so every label counts as yours.
- Take the label off in Gmail and the entry is dismissed in Pocket.
- Finish an entry in Pocket (resolved, not useful, dismissed, or tidied) and the label comes off and the thread is
  archived. A thread that got new mail after the label went on keeps its place in the inbox, so a reply you have not
  seen never disappears.
- Restore puts the label back; the thread stays where it is.
- Label two threads about the same thing (your copy of a reply and the copy sent to Ari only, say) and the check may
  put both on your list as one entry. The second thread keeps its label while that entry is open and loses it when you
  finish it, like the first.
- An entry the tidy pass took off and you restored stays on your list until you finish it; the tidy leaves it alone.

The first sync only adds labels; threads you labelled before it began are left alone. Only that label, and a thread's
place in the inbox, are ever changed. This needs Gmail write access. Through Claude Code's connector, the connector
must have been granted more than reading; through the Gmail API, the `gmail.modify` scope. When the watcher can only
read, the sheet says *Inbox Watch can only read this mailbox, so it can't add the label yet* with the reason, and it
asks again every 30 minutes. With both connectors, Codex's Gmail app makes the change when Claude's may only read.

Two config keys under `[gmail_label]` have no Pocket setting: `archive = false` keeps finished threads in the inbox
(only the label comes off), and `inbox = true` also puts a thread into the inbox, once, when it gets the label (for
filters that file whole kinds of mail past the inbox). `name` changes the label's name.

### Learning from your choices

Three things you do teach the watcher what you want:

- **You label an email Pocket Inbox in Gmail** that is not on your list. The watcher records what it had done with it:
  ignored it, kept it for the digest, filed it as a quiet update, skipped it as routine, or not looked at it yet.
- **You press Alert me on a line of the morning digest**: the watcher had kept it for the digest when you wanted an alert.
- **You mark an alert, or a digest line, Not useful**, with or without a note.

At the same check, one judge turn turns the new examples into rules, as narrow as they allow: one email teaches it
about that sender and topic ("Alert on website-content requests from Acme Paving"), several of a kind from different
senders teach it the kind. It merges a new example into a rule it sharpens, rewrites or drops a rule a newer example
contradicts, and notes in the log when an example conflicts with a rule you wrote (it then writes only the narrow
exception). The rules go at the end of your rules file under *Learned from your choices*, one line each with the
evidence in brackets (`(you added 2, Oct 31)`), at most 15 lines; the judge and the first pass read them with the rest.
You see and edit them in the rules box; a line you delete stays deleted unless a new example supports it again.
Labels a Gmail filter put on and alerts you resolved or dismissed teach it nothing.

## How it works

### A check

1. The watcher applies the decisions you made in Pocket (Resolved, Not useful, Restore) and learns from new examples.
2. The watcher finds threads with new messages since the last check (through a connector, by searching by date from
   the day before the last check and skipping the messages it has already seen) and syncs the Gmail label.
3. The [first pass](#first-pass), when on, sets aside clearly routine mail.
4. The judge reads the rest in batches. With each thread it gets related mail from the archive, the open stories with
   their timelines, the alerts already sent, the same order, invoice or account numbers seen before, your rules and,
   optionally, [memory](#memory-integration-optional). It may ask for up to three Gmail searches. It answers per
   thread: **notify**, **digest** (a line in the morning digest), **update** (the story changed, no message) or
   **ignore**.
5. Alerts go out together once every batch is judged, so a later batch can fold a new fact into an alert that has not
   left yet. The same fact is never alerted twice.
6. Due items run: the digest, a look-ahead, the tidy pass. Then the watcher reports to Pocket with its settings, status
   and costs (the heartbeat).

A check judges up to 20 threads; a burst waits in a backlog and is spread over the next checks. If a judge call
fails, the batch stays in the backlog and is judged afresh next time. Pocket stops a run of its own watcher that takes more
than 30 minutes.

### Where data lives

| Path | What |
|---|---|
| `POCKET_DATA_DIR/inbox.json` | The Inbox entries, the time each watcher last reported, its last report (profile), your settings and Check now requests |
| `POCKET_DATA_DIR/starts.json` | The briefings behind **Start a conversation** |
| `POCKET_DATA_DIR/inbox-watch-data/config.toml` | Pocket's watcher config |
| `POCKET_DATA_DIR/inbox-watch-data/preferences.md` | Your rules |
| `POCKET_DATA_DIR/inbox-watch-data/status.json` | What Pocket's runner is doing (shown in the Inbox) |
| `POCKET_DATA_DIR/inbox-watch-data/state/` | `mail.sqlite` (the mail archive), `monitor.sqlite` (stories, decisions, alerts, model calls, tidy log), `monitor.log`, earlier rules files in `preferences-backups/` |
| `POCKET_DATA_DIR/inbox-watch-data/files/` | Digests and look-aheads saved for Files (`~/inbox-watch-files` when the data directory is outside your home directory or in a hidden folder) |

`POCKET_DATA_DIR` defaults to the Pocket Code directory. `inbox.json` and `starts.json` quote your mail; keep them out
of anything you share.

Inbox entries are kept 60 days, dismissed ones 30 days after dismissal, and at most 500 (the oldest read ones go
first). The mail archive keeps messages for 120 days. A file named `STOP` in `inbox-watch-data/` stops every run
until you remove it.

### Costs and models

The cost table in the sheet counts every model call: decisions, look-aheads, tidy passes, and the connector's read
calls. On a Claude or ChatGPT plan nothing is billed per call; the calls draw on the plan's usage limits, and the
dollars shown are what the same tokens would cost at API list prices. The sheet says which applies. With `ANTHROPIC_API_KEY`
set in the server's environment, a Claude Code judge is shown as billed per token.

What moves the cost: the model, and the interval. A longer interval batches more threads into each call. Most of a
decision call is the same background each time (instructions, open stories, recent alerts), not the new email. A Codex
read call carries about 30,000 tokens of Codex's own instructions, so reading through Codex uses more of a ChatGPT
plan than reading through Claude Code uses of a Claude plan.

### First pass

Before the judge, a decision model can read each changed thread and say whether it is routine (receipts, shipping,
newsletters, marketing, verification codes). Mail at or above the confidence you set is skipped; its one-line headline
still reaches the judge, which may use it to close a story (a payment received, a system back up) but never to alert.
Code never lets it skip a thread you wrote in, one already judged worth more than ignore, one linked to a story, or one
sharing three distinctive words with a story touched this week. Any error means the judge reads the thread. It costs
fractions of a cent per email.

It runs through OpenRouter's decisions endpoint with **Jev (TypeSafe)**, the **OpenAI decision model**, or **Both
must agree**. It needs an OpenRouter key: a file at `~/.config/openrouter/keys/inbox-monitor.key`, or
`OPENROUTER_API_KEY` in the environment Pocket runs with. Without one the sheet says *The watcher has no classifier
key, so everything is read until one is set*.

### Memory integration (optional)

The watcher can use a long-term memory index of your past sessions and notes, configured in a `[memory]` table in
`config.toml` (the supported kind today is `memstem`; see the `[memory]` section of
`inbox-watch/examples/config.example.toml`). Pocket's setup does not add it.

- **Writing**: everything that reached you is remembered, one record per story you were told about (kept current),
  plus each digest and look-ahead. Mail that was ignored is not written.
- **Reading back** (`search = true`): before each decision the watcher searches memory for the thread (subject,
  sender's name and company, order or ticket numbers), and in the tidy pass for each open entry. Up to three items
  each, kept only when they share the email's names, numbers or subject words, and marked when written after the
  email. A later item that shows the work done (a fix released in a session, a call made) makes the judge record an
  update instead of an alert, and lets the tidy pass take an entry off. A failing search turns memory off for that
  check and never fails it.

### Privacy

- **Reading mail.** Through Claude Code's connector, each read is a short `claude -p` call that may use only the
  Gmail read tools (search, get thread, get message); every Gmail write tool and other connector is blocked and a hook
  refuses anything else. Through Codex, reads run in a Codex home of the watcher's own with every app but Gmail off,
  only the read tools on, no shell and a read-only sandbox. Label changes run separately, allowed only the label tools,
  and each call is checked against the label and threads the watcher asked for. The mail passes through Anthropic or OpenAI as part of
  those calls.
- **Judging.** The thread text, related mail, story history, your rules and any memory items go to the judge's
  provider (Anthropic for Claude Code, OpenAI for Codex). The judge runs isolated: no built-in tools, no shell, files or
  web, none of your Claude Code settings, hooks or CLAUDE.md, and no saved transcript. A Codex judge runs in its own
  Codex home with every app off.
- **First pass.** When on and keyed, the newest message of each eligible thread (sender, recipients, subject, labels
  and the first 3,000 characters of the body) and your rules go to OpenRouter and the chosen classifier.
- **On the server.** The archive, the stories and the log stay in `inbox-watch-data/`. Pushes carry the title and
  first sentence. With `email = true` under `[[delivery]]`, entries are also mailed to your notification
  address.
- Email content is treated as data, never as instructions to the judge.

## For agents

Use the **pocket-inbox** skill ([`skills/pocket-inbox/SKILL.md`](../../skills/pocket-inbox/SKILL.md)). While Inbox
Watch is on, Pocket installs it into Claude Code's and Codex's skill folders and adds a line naming the exact command
to the instructions of every conversation it runs. Run `pocket-inbox` from the Pocket Code directory as `node scripts/pocket-inbox.mjs`.

```bash
pocket-inbox list                          # unread entries, newest first
pocket-inbox list --state all              # everything but dismissed (also: dismissed)
pocket-inbox list --since 2026-10-19T00:00:00Z [--json]
pocket-inbox show <id> [--json]            # one entry in full: text, story, links, note
pocket-inbox act <id> resolve|not_useful|dismiss|restore [--note "…"]
pocket-inbox act <id> alert|resolve|not_useful|restore --item <ref>   # one item of a digest (show lists each item's ref)
pocket-inbox act <id> open|unread          # read state only; the watcher is not told
pocket-inbox watch [--json]                # schedule in force, next check, models, rules, 7 days of cost
pocket-inbox watch set --every 10          # or --pause, --resume, --file <path|-> (the whole settings object as JSON)
pocket-inbox watch reset                   # back to the watcher's config file
pocket-inbox check                         # Check now
```

- **Answer from the entries** when the user asks what Inbox Watch sent, about an alert, the digest or the look-ahead:
  title, what the text says, the story, when it came. Keep citation labels.
- **Record a decision only when the user names it** ("mark the Acme alert resolved", "that wasn't useful"). Never
  resolve, dismiss or mark not useful on your own judgment. Pass the user's reason as `--note`. If several entries
  could match, list them and ask. Confirm in one sentence afterwards.
- **Change settings only when asked.** To edit the rules ("stop telling me about shipping notices"), read
  `pocket-inbox watch --json` (`profile.rules.text`), add or edit the line, and save the whole settings object,
  `rules` included, with `pocket-inbox watch set --file -`. Confirm the line you added.
- **Posting** is for jobs on the server, not conversations, unless the user asks for such a job:
  `pocket-inbox add --title "…" --text "…" | --file <path|-> [--kind alert|digest|lookahead]
  [--priority critical|high|normal|low] [--story "…"] [--source "…"] [--url /#/start/<id>] [--gmail <https://mail.google.com/…>]
  [--doc <Files id>] [--dedupe <key>] [--email] [--no-push]`. It pushes to the user's devices unless `--no-push`;
  `--email` also mails the notification address. A `--dedupe` key used in the last 24 hours adds nothing and prints
  `duplicate`. A job posting regularly should send `pocket-inbox seen` when it has nothing to post.
- Exit code 1 with *Inbox Watch is off for this Pocket Code* means the feature is off: tell the user it is under
  **Settings → Projects, files, tasks & vault → Inbox Watch**. Exit code 2 means Pocket is not running here (or
  refused the token).

The CLI talks to the running server over loopback with the token in `POCKET_DATA_DIR/cli-token`. It reads
`POCKET_DATA_DIR` and `PORT` from the environment or Pocket's `.env`; `POCKET_URL` overrides the address. Times print
in the owner's time zone.

To look at Pocket's own watcher from a shell, point the watcher at its config:

```bash
inbox-watch/bin/inbox-monitor --config "$POCKET_DATA_DIR/inbox-watch-data/config.toml" settings   # what is in force, next check
inbox-watch/bin/inbox-monitor --config … usage          # calls, tokens and cost per day
inbox-watch/bin/inbox-monitor --config … check          # whose mailbox the connector reads; sends nothing
inbox-watch/bin/inbox-monitor --config … tidy --dry-run # what the tidy pass would take off
```

## Troubleshooting

**The Inbox says to open Pocket so it knows your time zone.** The watcher waits for the time zone your browser
reports. Open Pocket Code on your phone or computer once.

**"Inbox Watch can't read your mail yet. Connect Gmail in Settings → Connectors."** Neither Claude Code nor Codex has
Gmail connected on this server. Connect it in **Settings → Agents & instance → Connectors** with the account that agent
is signed in with. Inbox Watch starts by itself within a minute.

**Setup stops with "no sent mail found to tell whose mailbox this is."** Through Claude Code's connector the mailbox is
recognized from your Sent mail. Send one email from that account, or connect Codex's Gmail app as well.

**"Inbox Watch couldn't check your mail for … It tries again every minute."** The last run failed with the reason
shown. After three failures in a row one push says *Inbox Watch can't check your mail*; the next good run clears it.
A chatgpt.com bot check on a Codex read is temporary; with both agents connected the other one reads instead.

**"Inbox Watch couldn't check your mail for …: the mail search is blind: after:… found nothing in 3 checks while
newer_than:1d finds … thread(s)."** Through a connector, three checks in a row found no mail at all in a window of a day
or more while a search for the last day's mail found some, so the connector is answering the watcher's search with
nothing (as the claude.ai Gmail connector did for searches bounded in seconds from 2026-10-27 until 1.83.1). Update
Pocket Code; if it is current, report it with the line from `state/monitor.log`. The watcher keeps checking every
minute and catches up the missed mail once a search works again.

**"Inbox Watch hasn't reported since …"** The watcher has been silent for a day. For Pocket's own watcher, check
that `POCKET_INBOX_RUNNER` is not `0` and that there is no `STOP` file in `inbox-watch-data/`; `inbox-watch-data/status.json` and
`state/monitor.log` say what happened last. For a hand-installed watcher, check its timer.

**The Inbox says "A watcher installed separately is reporting here; Pocket is not running its own."** A hand-installed
watcher reported its profile to this Pocket while Pocket had no config of its own, so Pocket leaves the mail to it. If
that watcher is not meant to be there, stop its timer: once it has been silent for a week Pocket sets itself up. Two
watchers on one mailbox send everything twice, so Pocket does not start its own while another is reporting.

**Check now says "Inbox Watch hasn't reported yet, so nothing is reading your mail."** No watcher has ever reported
to this Pocket. See the two entries above.

**The sheet keeps saying "Your last change reaches the watcher within a minute."** The watcher has not run since you
saved. Check the entries above. *Inbox Watch hasn't reported its settings yet* means a watcher too old to read
settings from Pocket.

**The Gmail label is unavailable.** The connector was granted read-only access. Disconnect and reconnect Gmail on
claude.ai and allow everything it asks for; for the Gmail API, run `gmail-auth` again or add `gmail.modify` to the
service account's delegation. Through a connector, label changes are made at most every 10 minutes; **Check now**
forces one.

**First pass says there is no classifier key.** Add an OpenRouter key as described in [First pass](#first-pass). The
next tick picks it up.

**Alerts in Telegram or email have no "Open in Pocket Code" button.** Outside Pocket the link needs Pocket's public
address. Open Pocket once through the address you normally use, or set `POCKET_PUBLIC_URL`. Entries in the Inbox itself
always have **Start a conversation**: they use a path inside Pocket and need no address.

**Digests show no Open in Files.** Files is off. Turn it on in **Settings → Projects, files, tasks & vault → Files**;
the text is in the entry either way.

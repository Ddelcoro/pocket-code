# Inbox Watch: the watcher (`inbox-monitor`)

This folder is the program behind Pocket Code's **Inbox Watch**: it reads one Gmail mailbox on a schedule and posts
what deserves attention to Pocket's Inbox. It ships with Pocket Code and runs beside it on the same server, on its own
timer; Pocket is where the owner reads, answers and sets it up (Settings → Inbox Watch). See the Pocket
[README](../README.md#inbox-watch-your-mailbox-read-for-you) for what it looks like from the Pocket side.

An inbox watcher with a model as the judge. On the schedule you set (every five minutes by default) it syncs one Gmail mailbox, hands the changed threads to
a judge together with everything it already knows (a 90-day mail archive, the open stories with their timelines, the
alerts already sent, the same orders, invoices, devices and account numbers turning up again), and delivers only what
deserves attention, with a briefed Pocket Code session one tap away. Twice a day it looks ahead at what is due.

Built from the author's own inbox monitor (October 2026) and generalized so it runs for anyone: the owner, the
mailbox, the judge and the delivery are a TOML file. The engine is the same for everyone.

## The shape

```
Gmail history ──► backlog ──► bundles (+ related mail, stories, seen_before, memory) ──► judge ──► decisions
                                                                                          │
                            stories + timelines + alerts (sqlite) ◄───────────────────────┘
                                                                                          │
                            quiet hours · dedupe · morning digest · look-ahead ──► deliveries (Telegram, Pocket, email)
```

Code owns state and delivery; the judge owns judgment and wording. The judge never needs to remember an earlier call:
memory is the archive and the story ledger, so a fresh process per call works as well as a long-lived agent.

## Judges

| `judge.kind` | What runs | Notes |
|---|---|---|
| `openclaw` | `openclaw agent --agent … --model …` | The owner's own assistant, with its memory and tools. Sessions rotate every 6 calls. |
| `claude` | `claude -p --output-format stream-json` | Claude Code headless, one process per call; the Max plan covers it. Isolated by default: no built-in tools, no user settings, hooks or CLAUDE.md, no saved transcript. `mcp_config` + `allowed_tools` give it memory. |
| `codex` | `codex exec --json --ephemeral` | Codex CLI headless, one process per call. |
| `anthropic` | the Claude API (official SDK) | `claude-opus-5-5` by default, adaptive thinking, explicit effort, server-side refusal fallback. |

## Mail sources

| `mail.provider` | How it reads | Needs |
|---|---|---|
| `connector` (1.74) | The agent's own Gmail connector: `agent = "claude"` (claude.ai → Settings → Connectors, one short `claude -p` per batch of reads) or `agent = "codex"` (the Gmail app at chatgpt.com/apps, one short `codex exec`); `fallback_agent` + `[mail.fallback]` name the other for when a read fails | That agent signed in with Gmail connected. Nothing else: no Google client, token or Google libraries. |
| `gmail` | Gmail's API with the history cursor | `auth = "oauth"` (a Desktop-app OAuth client and `gmail-auth` once) or `auth = "service_account"` (Workspace domain-wide delegation), plus `requirements.txt` |

**The connector source** (`mail_connector.py`). The connector has no history API, so a check searches
`after:<last check - 15 min>` and counts a thread as changed when its newest message is one the watcher has not seen
(`connector_seen` in `mail.sqlite`). Time bounds reach the connector as Gmail dates (`after:YYYY/MM/DD`, a day early;
`before:`, two days late), because since 2026-10-27 the claude.ai connector answers the Unix-seconds form with nothing
and no error; pages are read newest first and stop at the first with nothing unseen. A check that finds no threads at
all while `newer_than:1d` does is a blind search: the third in a row fails the check so Pocket shows it (1.83.1).
Threads are read eight to a call; the fetch model (`mail.model`, Haiku by default)
only makes the calls, and the watcher takes each tool's JSON from the stream, so no message is retyped or summarized.
Fetch calls are kept in `judge_calls` as `fetch` / `search` and counted in the day's cost.
The call has to load the user's Claude Code settings (claude.ai connectors load with nothing less), and those may allow
every Gmail tool, send included, or bypass permissions. So it gets no built-in tools, `--disallowedTools` for every Gmail
write tool and the other connectors, and a PreToolUse hook that refuses anything outside `search_threads`, `get_thread`
and `get_message`. A judge's lookups are threads searched and read the same way. Through **Codex** (`agent = "codex"`, `gpt-6-luna` at low reasoning by default) the reads are `gmail_search_emails`
and `gmail_batch_read_email_threads` in a CODEX_HOME of the watcher's own (`state/connector/codex-home`: a link to the
owner's `auth.json` and a config with every app but Gmail off, every Gmail tool but the seven reads off, destructive
tools off, no shell, plugins or memories, read-only sandbox), with results taken from each call's `structured_content`.
chatgpt.com sometimes answers cloud servers with a bot check: that read fails as a 503 and, with a fallback agent, the
other agent reads instead. A Codex call carries ~30k tokens of Codex's own instructions (about half cached), so on a
ChatGPT plan it uses more of the allowance than a Claude fetch does. A **Codex judge** now runs isolated the same way
by default (`state/judge-codex-home`, every app off: the owner's Gmail app may allow sending, and the judge reads
untrusted mail); an explicit `codex_home` is used as is. `check` reports whose mailbox the
connector reads. `python3 -m inbox_monitor.mail_connector whoami` prints it as JSON (what Pocket runs before it writes a config).

## Deliveries

| `delivery.kind` | Alerts | Digest and look-ahead |
|---|---|---|
| `pocket` | a push whose tap opens the briefed session (Pocket Code 1.58.1+) | kept in Files, the push links there; with Pocket 1.95+ the digest's lines and the look-ahead's bullets are Inbox items too, each with Add to Inbox / Resolved / Not useful, whose decisions come back through `feedback()` as kind `digest-item` |
| `telegram` | a bot DM with Open in Pocket Code / Open in Gmail buttons | one message |
| `email` | HTML mail with the same links | HTML mail |

With an OpenClaw judge and its own Telegram bot, replying to an alert is talking to the assistant. With Pocket, the
briefed session is the reply.

## Memory

With a `[memory]` table (MemStem today), everything that reached the owner is also remembered: one record per story they
were told about (its state, every alert and digest line they got, the dated timeline with Gmail links), kept current as
the story changes or they mark it resolved, plus each look-ahead, each digest and each alert another job sent through
`notify`. Records have stable ids, so a story is one record however often it changes. Mail that was ignored is not
written. `remember --all` writes the backlog at once; every run does the rest.

**Reading it back (`search = true`).** The worker also searches the owner's memory itself, so the judge sees what
happened outside email: before each decision, per thread (subject, the sender's name and company, identifiers like order
or ticket numbers), and in the tidy pass, per open entry (title and alert text, work from six hours before the alert
on). Up to three items each, marked `after: true` when written after the email or alert: a session where the owner fixed
the bug a report is about, called the customer back, made the decision. The decision judge treats a later item as "already
handled" (an `update`, not an alert) and never as evidence; the tidy pass may cite one (`mem:<id>`) as proof that an entry
is resolved or handled. The watcher's own records are left out, and so are titles matching `search_exclude_titles`
(standing background files that match everything). Replays never see an item written after the simulated moment. A
failing search turns memory off for that check, never fails it.

**What the judge looked up.** With the `claude` judge, each call's turns and tool calls (the memory searches it chose to
make, with their queries) are kept in `judge_calls` (`turns`, `tool_calls`, `tools`), beside `memory_items`, the number of
items the worker gave it.

## Set up an instance

**With Pocket Code 1.74 or later you don't:** switching Inbox Watch on in Pocket sets up and runs a connector watcher
for the owner's mailbox (config under `<data dir>/inbox-watch-data/`). Set one up by hand for anything Pocket's does not
cover: another mailbox, the Gmail API, a different judge or delivery. Pocket leaves a watcher that reports under
its own config alone.

```bash
W=~/pocket-code/inbox-watch                                          # this folder, in your Pocket Code checkout
pip install -r $W/requirements.txt
mkdir ~/my-inbox && cp $W/examples/config.example.toml ~/my-inbox/config.toml   # edit it
touch ~/my-inbox/preferences.md                                      # standing preferences, read every turn
$W/bin/inbox-monitor --config ~/my-inbox/config.toml gmail-auth    # oauth only, once
$W/bin/inbox-monitor --config ~/my-inbox/config.toml check         # loads everything, sends nothing
$W/bin/inbox-monitor --config ~/my-inbox/config.toml backfill --days 90
$W/bin/inbox-monitor --config ~/my-inbox/config.toml --baseline-only   # start from now
```

Turn on **Settings → Projects, files, tasks & vault → Inbox Watch** in Pocket so its Inbox receives what the watcher
sends. Then a timer **every minute** that runs `tick` (systemd, with a failure email). `tick` checks mail only when a check is
due under the schedule, so the timer never sets the pace:

```
[Service]
ExecStart=/home/me/pocket-code/inbox-watch/bin/inbox-monitor --config /home/me/my-inbox/config.toml tick
```

Running it without `tick` checks now, whatever the schedule says (a manual run).

`bin/inbox-monitor` runs the first `python3` on `PATH` that is 3.11 or newer (then `python3.13`, `3.12`, `3.11`); set
`INBOX_MONITOR_PYTHON` to name the interpreter yourself, for example a Homebrew or pyenv one.

## Schedule, models and cost

When it checks and which models judge are settings: `[schedule]` and `[judge]` in the config are the defaults, and the
owner can change them in Pocket Code (**Settings → Inbox Watch → Schedule, models and cost**, Pocket 1.70+), which the
watcher reads every minute and caches for when Pocket does not answer. *Use the config file's settings* in Pocket hands
control back to the file.

- `every` minutes between checks, and any number of `[[schedule.period]]` tables (`name`, `days` = `"daily"`,
  `"weekdays"`, `"weekends"` or a list, `from`/`to` as `"HH:MM"`, `every`), each with its own interval; `every = 0`
  means no checks then. A period past midnight belongs to the day it starts. The first period that covers the moment wins.
- `paused = true` stops everything. The morning digest and the look-aheads still run at their hour even in a period
  with no checks (a check runs with them).
- The model and reasoning level for the decisions and for the look-ahead (`reasoning = "default"` leaves it to the model).
  For a Claude Code judge Pocket offers Haiku, Sonnet, Opus and Fable.

Every judge call is recorded in `judge_calls` (tokens in and out, cache, reasoning tokens, the list-price cost Claude
Code reports, milliseconds); `inbox-monitor usage` prints a daily summary, `settings` prints what is in force and the
next check, and the heartbeat sends both to Pocket. On a Claude or ChatGPT plan nothing is billed per call; the dollar
figure is what the same tokens would cost through the API.

**First pass (optional, `[firstpass]`).** Before the judge, a decision model (TypeSafe Jev, OpenAI's decision model, or
both agreeing, through OpenRouter's decisions endpoint, ~$0.00004 and ~0.15 s an email) reads each changed thread code
allows it to skip and says whether it is routine. Code never lets it skip a thread the owner wrote in, one already judged
worth more than ignore, one linked to a story, or one sharing three distinctive words with a story touched this week. A
skipped thread is recorded as an ignore decision (`issue_key = routine-first-pass`), and its headline rides in the next
decision turn as `skimmed_routine`, where the judge may only `update` a story from it (a payment received, a link back
up). Any error means the judge reads it. Settings: on/off, the classifier and the confidence threshold (Pocket or the
TOML). Every check is in `firstpass_log`; `usage` shows how many were skipped per day. Backtest (996 decisions): no alert
skipped at 0.8–0.9 with the rules; at 5-minute checks, ~18% (0.9) to ~22% (0.8) lower cost.

**Check now (Pocket 1.75).** Pocket's Inbox has a Check now chip (`pocket-inbox check`). The request reaches the watcher
with its settings (`checkRequestedAt`); `tick` runs a check for it at once, whatever the schedule says, paused included,
and the heartbeat reports it done (`status.checkRequestDone`). With `every = 0` and no periods, the watcher checks only
on demand (and with the digest and look-aheads).

**What it reads (`[mail] scope`, also a Pocket setting; 1.100).** By default the watcher fetches every thread but spam, trash
and drafts, so mail the owner's Gmail filters archive or file away is judged too. `scope = "inbox"` reads only threads in the
Gmail inbox; `scope = "inbox_labels"` with `scope_labels = ["Clients", "Ultra/Ask first"]` adds threads under those labels (as
`{in:inbox label:clients label:ultra-ask-first}` on a search; by label id on the Gmail API's history reads). The bound applies
to the per-check fetch, the first-run baseline, the rebaseline and the blind-mailbox probe; research and archive searches, and
a thread the owner labels Pocket Inbox, are not bounded. The owner's replies stay in: the per-check read adds `in:sent` and drops
a new email the owner started (on Codex's search, which does not give a thread's length, a sent email is read). The heartbeat carries the owner's label names (`options.labels`,
refreshed daily) for Pocket's picker.

**The Pocket Inbox label (`[gmail_label]`, on by default; also a Pocket setting).** The owner's open Inbox entries and
one Gmail label (`name`, default "Pocket Inbox", created when missing) are kept in step at every check, both ways. An entry
whose thread lacks the label gets it; a thread the owner labelled in Gmail that is not on the list is judged at that check
(marked `added_in_gmail`; code makes it an alert, not held for quiet hours, never skipped by the first pass) and put back in
INBOX if it was moved out; a label taken off in Gmail dismisses the entry; an entry finished in Pocket (resolved, not useful,
dismissed, tidied) loses the label. `label_sync` in monitor.sqlite remembers which threads were in step, so the two kinds of
change can be told apart; the first sync only adds labels. With `inbox = true` (1.77.2, off by default) a thread that gets the label is also put in INBOX, once, for an owner whose filters file whole kinds of mail out of the inbox; archiving it afterwards is left alone. Writes need `gmail.modify` (the service account's delegation, or
`gmail-auth` again for an OAuth sign-in); nothing but that label, and INBOX for a thread the owner labelled, is ever changed.
Through the connector (1.74) the label goes through Codex's Gmail app: a second locked Codex home whose only tool is
`apply_labels_to_emails`, called from a prompt that holds message ids and the label name, never email text; a call made with
other arguments than asked does not count. Through Claude Code's Gmail connector (1.75.1) a run of its own allows only `list_labels`, `create_label`, `label_thread` and `unlabel_thread`, and a PreToolUse hook passes only the label name, label ids and thread ids the program asked for; the label's id is remembered (`state/connector/label-ids.json`). A connector Google granted read-only answers "insufficient scope": Settings shows it with what to do, the sync tries again every 30 minutes, and with Codex as the other transport the change goes through Codex instead.

**Neutral instructions.** `prompts/` assume nothing about the owner's work or industry. Everything specific to a person
(what matters, what doesn't, their systems, their staff, their thresholds) belongs in their rules (the preferences file, or
Settings → Inbox Watch → Your rules).

**Tidy (optional, `[tidy]`).** Every few hours outside quiet hours (`every_hours`, default 2; also a Pocket setting) the
watcher takes off the owner's Inbox what no longer needs them. Code first: an older entry on a story with a newer one is
superseded, an entry whose story the judge already closed is resolved. Then one judge turn (`prompts/tidy.md`) gets each
remaining entry with its story, the story's recent timeline and the recent mail in its threads (the owner's own messages
marked) and answers `resolved` (over; the watcher stops following), `handled` (someone acted, it waits on someone else; off
the list, still followed) or `open`, citing the message that proves it; no proof, no change. Money, security and legal items
need explicit proof; a monitor that went silent after a failure is not a recovery. The entry's note says why, Restore in
Pocket undoes it, `tidy_log` keeps every verdict, the morning digest lists what was taken off, and an entry judged open is not
sent again until its story or threads change. `inbox-monitor tidy [--dry-run]` runs it now. Backtest on 46 entries
(2026-10-20): it cleared 24, never one a human review had left open, and caught a "recovered" outage whose last notice was
a failure; ~$0.20 for the first full pass, pennies after.

**What a call costs, and what moved it (measured 2026-10-20 on one owner's mailbox, Sonnet 5.5).** A decision call carried
~45–65k tokens, almost all of it the same background every time (instructions, the open stories, the alerts already
sent, related mail), not the new email. Claude Code also wrote every prompt to its one-hour cache at about twice the
input price and never read it back, since no two bundles are alike. With the cache off (`prompt_cache = false`, now the
default), the other-story and recent-alert lists clipped, alerts already shown in a story not repeated and the bundle
JSON compact, a call went from ~$0.20 to ~$0.10 with the same decisions (agreement with the old prompt inside the
model's own run-to-run variation). Reasoning level made no measurable difference: Sonnet reasoned 0–500 tokens at low,
medium and high alike. A longer interval batches more threads per call: replaying one day, 10 minutes needed 24% fewer
calls than 5, 15 minutes 31% fewer, 30 minutes 44% fewer, for the same mail.

Reusing a Google sign-in another app already holds (an assistant connected to the same Gmail) works too: write an
`authorized_user` token file (`client_id`, `client_secret`, `refresh_token`, `token_uri`, and the `scopes` it was granted)
and point `oauth_token_file` at it. The watcher renews it with those scopes and only ever reads.

`touch STOP` beside the config pauses everything. `--dry-run` evaluates without sending. `notify --subject … --text …`
sends one alert through the same channel from any other job.

## Replay before tuning

```bash
inbox-monitor --config … replay --start 2026-10-19T08:00 --end 2026-10-19T09:00 --tick 5 --fresh
python3 inbox_monitor/replay_report.py state/replay.sqlite
```

Simulated clock, separate ledger, nothing sent; the judge sees only mail that existed at each moment.

## Layout

- `inbox_monitor/engine.py` — sync, archive, stories, research, batching, decisions, dedupe, quiet hours, digest, look-ahead, replay.
- `inbox_monitor/schedule.py` — the settings shape, periods, the interval in force and the next check.
- `inbox_monitor/judges.py`, `delivery.py`, `memory_sink.py`, `memory_search.py`, `mail_gmail.py`, `config.py` — the adapters and the TOML loader.
- `tests/test_memory.py` — memory in decisions and in the tidy pass, and the judge's tool calls in the ledger (`python3 tests/test_memory.py`).
- `tests/test_schedule.py` — the schedule rules (`python3 tests/test_schedule.py`).
- `tests/test_connector.py` — the connector mail source against a fake `claude` (`python3 tests/test_connector.py`).
- `tests/test_archive.py` — the mail archive's column rename on an old archive (`python3 tests/test_archive.py`).
- `tests/test_delivery.py` — the Pocket start link in the Inbox, Telegram and email (`python3 tests/test_delivery.py`).
- `inbox_monitor/prompts/decide.md`, `lookahead.md` — the judge's instructions, with `{owner}`, `{assistant}`, `{owner_email}`, `{memory_note}` filled from the config.
- `examples/config.example.toml` — every key.

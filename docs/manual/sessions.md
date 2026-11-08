<!-- manual
checked: 1.96.0
sources: prompts.mjs, starts.mjs, scripts/pocket-start.mjs, search.mjs, titles.mjs, usage.mjs, models.mjs, claude-catalog.mjs, codex.mjs, session-state.mjs, acp.mjs, openrouter.mjs
-->
# Conversations (sessions)

A conversation is one Claude Code or Codex session that Pocket Code runs on your server. You start it
from **New conversation**, follow it from any device, and come back to it later from the conversation
list. Pocket drives the installed `claude` and `codex` command-line tools and reads their own session
stores, so a session started in a terminal or code-server is in the list too. Conversations are always
on; Codex appears when the `codex` CLI is installed. A third agent, **OpenRouter**, appears only when
the server turns it on (see [OpenRouter models](#openrouter-models)).

The app says *conversation* and *reply* where the code and the CLIs say *session* and *turn*. This page
uses the app's words.

## Use it

### Start a conversation

Open **New conversation**: the **+** button on the conversation list, the **+** at the top of the
desktop rail, or Ctrl/⌘ Shift L. The screen asks **What would you like done?** above the same message
box a conversation uses.

1. Check the setup card above the box. It names the **Workspace**, the **Agent** with its model and
   reasoning (for example *Claude Code · Opus 5.5 · High reasoning*) and the **Permissions**.
2. To change the agent or workspace, tap **Edit setup** (it becomes **Close setup**):
   - **Agent**: **Claude Code**, **Codex** or, when the server has it on, **OpenRouter**. The choice is
     remembered on this browser.
   - **Project**: the ten most recently used workspaces, with the configured default first.
   - **Or a custom path**: any folder on the server, as a full path (`/home/alex/projects/website`). It
     must already exist on the server; a path on your phone or laptop does not work.
3. Set the chips above the box for the first reply: model, reasoning effort, permissions and, for
   Codex, the mode (see [Choose model, effort, permissions and mode](#choose-model-effort-permissions-and-mode)).
4. Write the task and press the Send arrow (**Start conversation**). On a screen 900 px or wider, Enter
   starts and Shift+Enter adds a line; on a phone Enter adds a line.

The workspace preselected is, in order: the folder a start link or a project's **Start** names, the
server's default workspace (`POCKET_DEFAULT_CWD`), the workspace you last started in on this browser,
else the most recently used one. With
`POCKET_LOCK_CWD=1` (and a valid `POCKET_DEFAULT_CWD`) there is nothing to choose: every conversation
starts in that folder, and a start that names another folder is moved there.

Beside the box:

- The paperclip (**Attach files**) offers **Choose files**, **Paste screenshot** and, when the Vault is
  on, **Store in the Vault**. A reply carries up to 10 attachments.
- The spark (**Choose a skill**) lists the skills installed for the chosen agent and workspace. Picking
  one inserts an editable line (`Use the /name skill.` for Claude Code, a `$name` line for Codex); it
  does not start anything.
- The bookmark (**Save as prompt**) keeps the task as a saved prompt.
- The mic and hands-free voice work as they do in a conversation (see [Voice](voice.md)).

In Assistant mode, this message box is the home screen and the setup card is hidden once a workspace is
set.

If something is missing, the reason shows above the box: **Choose a workspace above, or enter its
path.** or **Write what you would like done first.** If the start request was sent but not confirmed
(a dropped connection), the screen says **Start request not yet confirmed. Retry checks the same
request.** **Retry start** sends the same request again without starting a second conversation;
**Discard retry** drops it.

A briefing put in the box for you (a start link, an Inbox alert, a task's or project's **Start**) stays
only for that visit. Leave without starting and the next **New conversation** opens empty, unless you
edited the briefing. A draft you typed yourself is kept.

### Choose model, effort, permissions and mode

The chips above the message box apply to the next reply, on New conversation and in a conversation:

| Chip | Choices |
|---|---|
| Model (**Model for this reply**) | **Default**, then the models the picker offers (see [Models in the picker](#models-in-the-picker)). Default's line names what it runs: the Pocket default, or your CLI's own setting. |
| Effort (**Reasoning effort**) | **Default**, **Max**, **X-High**, **High**, **Medium**, **Low**. For Claude, nothing above the ceiling in this computer's Claude Code policy (`maxEffortLevel`) is offered. For Codex, **Ultra** (maximum reasoning with automatic task delegation) is listed above **Max** only when the chosen model offers it; for **Default** that is the model in `POCKET_CODEX_MODEL`, if set. Changing to a model without it sets the effort back to **Default**. For OpenRouter, only the levels the chosen model has (DeepSeek V4.1 Flash: **Max**, **High**, **Low**, **None**; some models also have **Minimal**), and no chip for a model with no effort setting; changing to a model without the picked level sets it back to **Default**. |
| Permissions | **Review actions** (actions wait for your approval) or **Full access**. See [Questions and approvals](approvals.md#choose-review-actions-or-full-access). |
| Mode (Codex only, **Codex mode for the next reply**) | **Work normally** carries out the request; **Plan first** explores an approach and asks questions before implementing. Plan first is guidance for the agent, not a sandbox. |

Choices are saved per conversation on this browser. Switching agents, or opening a conversation whose
saved model belongs to the other agent, resets the model to Default. A Claude model the picker stopped
offering also goes back to Default. A Codex model the menu does not list is shown by its id and still
sent.

On a Claude conversation, changing the model, effort or permissions between replies closes its
process; the next reply starts a fresh one that resumes the saved conversation.

### Use saved prompts and Recent

**Save as prompt** stores the task with its workspace and agent. **Keep model, effort and permissions**
(on by default) also stores the model, effort, permissions and Codex mode; turn it off to save only
the wording, workspace and agent.

- Saved prompts show as chips above the box. A tap fills the task, workspace, agent and saved choices;
  you still press Start. Hover a chip to see what it will set.
- **Manage** (or a long-press or right-click on a chip) lists every saved prompt with up and down
  arrows to reorder, **Edit** (rename, or **Replace with what is on screen**) and **Delete**, which asks
  once more (**Delete for good**).
- **Recent** lists your last five starts from any device, each with its workspace and agent. A tap fills
  the form the same way. Starts from a project card are not added to Recent.

Saved prompts and Recent are kept on the server, so every device sees the same list. Limits: 50 saved
prompts, a name of up to 60 characters, a task of up to 8,000 characters.

### Find a conversation

The conversation list is the home screen on a phone and the rail on a desktop. Ctrl/⌘ K opens it as a
**Switch conversation** sheet from anywhere a conversation or the list is on screen.

- **Search recent conversations** filters by title and workspace path as you type. A title that is the opening
  request holds only its first 300 characters, so text further into a long request is found by **In conversations**
  below.
- With three or more characters, after a short pause, an **In conversations** section also searches
  inside conversations. Each result shows the matching passage and who wrote it; tapping one opens the
  conversation with Find on the match. See [How search works](#how-search-works).
- **All**, **Active** and **Attention** stay visible. **Filters** holds **Workspace**, **Agent** and
  **New**, **Pinned** and **Hidden**; the summary line names the filters applied, and **Clear filters**
  resets them. Filters are saved on this browser.
- **Attention** collects questions, approvals, failed replies and finished replies you have not opened.
  In **Attention** and **New**, **Mark all reviewed** clears them on every device, with **Undo** for ten
  seconds.
- A reply to a wrap-up request skips **Attention**. When the message you send is a short closing reply,
  such as **Mark resolved**, **Mark the alert resolved**, **Dismiss**, **Remind me Nov 7 to recheck the numbers**, **Add a task to test
  the fix**, **No thanks** or **That's all**, the agent's confirmation counts as read the moment it
  finishes, on every device, and sends no notification, even if you closed the conversation first. It
  still waits in **Attention** when the reply asks you something, ends with reply buttons or runs past
  about 1,500 characters, and when your message says more than the closing step (*Mark resolved and fix the
  test*).

**All** groups the list by state: **Running**, **Working in background**, **Activity elsewhere**, **Needs
attention**, **Waiting** and **Recent**, with pinned conversations first in each group. **Working in
background** is a Claude conversation whose reply has ended while a background shell job or subagent it
started is still running; its finished-reply notification waits until the agent reports back. When such a
subagent asks permission or a question, the conversation moves to **Needs approval** or **Needs your answer**
until you answer, then back (see [Questions and approvals](approvals.md#what-happens-if-you-dont-answer)). Scheduled runs
(a first message starting `[cron:<id> Job name]`) are titled by the job name and sit in a collapsed
**Automated** group at the end of All, unless they are pinned, running or need you.

Each row shows the title, the workspace (left out for the default or home folder), the agent, *Branch*
for a branch, and the state, such as **Response ready**, **Didn't finish**, **Needs your answer**,
**Needs approval**, **Queue paused** or **Waiting for usage reset**.

### Pin, rename, hide and mark reviewed

Open **Conversation options** with the **⋯** on a row, a long-press (phone) or right-click (desktop),
or the title or **⋯** in an open conversation.

- **Pin conversation** (the first choice) keeps it at the top. Every row also has a pin beside its **⋯**: faint
  gray on an unpinned conversation, orange on a pinned one; one click pins or unpins it without opening it. Pins keep an order of their own on the server: drag a pinned
  row's grip, focus the grip and press the up and down arrows, or use **Move pin up** and **Move pin
  down**. Unpinning forgets its place.
- **Rename** sets your title (up to 120 characters) on every device. Save an empty name to go back to
  the automatic title.
- **Hide from this device** removes it from the list on this browser only. History stays; new activity
  brings it back; the **Hidden** filter lists hidden conversations with **Restore to conversation
  list**. Active or waiting conversations stay visible and cannot be hidden.
- **Mark as reviewed** clears Response ready or a failed reply on every device without opening it.

There is no archive or delete. Nothing in Pocket deletes a conversation's transcript.

### Resume a conversation

Open it from the list (or **Resume: <title>** at the top of the conversation list page, the one you
opened last on this browser) and send a message. If its process is still running the reply starts at
once; otherwise Pocket starts a new process that resumes the saved session (`claude --resume` for Claude
Code, the thread for Codex).

Coming back to a conversation with work you have not seen opens it at a **New since** line. When
**Summarize what you missed** is on and the new part is more than a short exchange, a **While you were
away** summary of what was done and decided shows with it.

### Close a conversation's process

Closing a tab or a pane never stops work. To end the server process now instead of at the idle timeout,
use **Conversation options → Close conversation process** (main view only). If a reply or background
job is running, choose **Keep it running in the background** (closes the view only) or **Stop the
reply**. The view then switches to the first side pane, or to New conversation.

**Stop** in the message area interrupts the running reply and pauses the follow-up queue (see
[Manage the queue](conversation.md#manage-the-queue)). Neither
control deletes the conversation; the next message resumes it.

### Read usage and limits

- The ring beside the message box fills with the conversation's context use: amber at 70 %, red at
  90 %. Hover for the model and tokens used; the small label beside it counts down the prompt cache
  (minutes left, or *cold*).
- Click the ring for **Usage**: the context window (window, used, free), the **Prompt cache** block for
  Claude conversations (status, expiry, cached tokens, lifetime, how the last reply started) and plan
  usage for that agent.
- **Plan usage** (in Conversation options and **Settings → Agents & instance**) shows Claude Code's
  **5-hour**, **Weekly** and **Weekly + extra usage** windows with reset times and whether **Extra
  usage** is on, and Codex's windows when it reports them.
- After each Claude reply a line shows its cost, duration and either *N% cached* or *cold start*.
  Codex replies show the duration and cache start without a cost.
- On desktop tabs, a session with at least 100k cached tokens shows an hourglass when its cache is about
  to expire and a snowflake once it has.

All of these change only when a reply runs. Each says *As of* a time; none is live.

When a Claude reply fails on a usage or rate limit, Pocket schedules the conversation to continue after
the reset (plus `POCKET_RETRY_BUFFER_MS`, five minutes by default). The conversation shows **Waiting
for usage reset** and *Rate limited — auto-resume at …*; a push says when it picks the task back up.

### Models in the picker

**Only the newest version of each model is shown.** For Claude that is the newest Fable, Opus, Sonnet
and Haiku (today Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5); for Codex, the newest of each family
Codex lists (GPT-6.1 Sol, not GPT-6 Sol beside it). An older version is left out of the menus and of
Settings, and anything that still names it runs the newest version instead, without a notice: a
conversation started on GPT-6 Sol, a saved prompt on Sonnet 5, and the Pocket default in
`POCKET_CLAUDE_MODEL` or `POCKET_CODEX_MODEL` (**Default** names the version it really runs). The only
exception is a newer Claude version this computer's Claude Code policy blocks: then the older one stays.

**New models appear without a Pocket update.** Codex's menu is the list the installed Codex CLI
reports, read again whenever the menu opens. For Claude, Pocket reads Anthropic's model list a couple
of minutes after it starts and then once a day, with the sign-in Claude Code already has on this
computer (`~/.claude/.credentials.json`, or `ANTHROPIC_API_KEY`). A model newer than every model of
its family, such as an Opus 6, joins the menu and replaces the older one; the Pocket log says
*claude catalog: Opus 6 (claude-opus-6[1m]) is new*. What it found is kept in `claude-models.json` in
the data directory. Without a file-based sign-in (Claude Code on macOS keeps it in the keychain) the
check finds nothing and the catalog stays as released. `POCKET_CLAUDE_DISCOVERY=0` turns the check off.

**Settings → Agents & instance → Claude models in the picker** lists those models. Tap a row to offer
or stop offering it on every device; one must stay on (**Keep at least one model on**). **Use the
server's list** forgets the choice. A list that names an older version (saved before 1.91, or in
`POCKET_CLAUDE_MODELS`) offers the newest version of that family.

Which list applies, highest first:

1. The list saved in Settings.
2. `POCKET_CLAUDE_MODELS` in `.env`: comma-separated catalog ids such as
   `claude-sonnet-5-5,claude-opus-5-5[1m]`. An id without `[1m]` or a family alias (`sonnet`, `haiku`)
   works too; an unknown id is logged and ignored. Read when Pocket starts.
3. Every model.

This computer's Claude Code managed policy applies on top of whichever list is chosen. When
`managed-settings.json` or `managed-settings.d/*.json` (in `/etc/claude-code` on Linux,
`/Library/Application Support/ClaudeCode` on macOS, `C:\Program Files\ClaudeCode` on Windows) set
`availableModels` or `deniedModels`, a model the CLI would block is never offered. Its row in Settings
says *Blocked by this computer's Claude Code policy*. Pocket re-reads those files every few seconds.
Policy delivered any other way is not visible to Pocket; the CLI still enforces it.

The server enforces the list too. A reply sent with a model the picker does not offer (an old tab, a
saved prompt, a queued message) runs on Default, and the conversation and a toast say so, for example
*Opus 5.5 is not offered in Settings, so this reply uses the default model (Sonnet 5.5).*

Codex's model menu is what the installed Codex CLI reports, newest version of each family only.

### OpenRouter models

OpenRouter is a third agent for models you pay for by the token through your own OpenRouter key, such
as DeepSeek V4.1 Flash, instead of through a Claude or ChatGPT subscription. It is off until the person
who runs Pocket turns it on, and it needs three things on the server:

- [OpenCode](https://opencode.ai) installed (`npm i -g opencode-ai`). Pocket drives it with
  `opencode acp`; set `POCKET_ACP_CMD` (and `POCKET_ACP_ARGS`) if it is somewhere unusual.
- `POCKET_ACP_ENABLE=1` and `OPENROUTER_API_KEY` in Pocket's environment, then a restart.
- A working OpenRouter key. A revoked key fails every reply with `User not found`; check one with
  `curl -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/key` (401 = dead).

Nothing in OpenCode's own configuration is required. Since 1.86 Pocket starts each OpenCode process with
its own settings on top of yours (OpenCode merges them): ask-first permissions for edits, commands and
web fetches, Pocket's instructions, and Pocket's question tool. Your own MCP servers, instruction files
and providers stay as they are.

With it on, **OpenRouter** joins **Agent** in the setup card. Its model menu is OpenRouter's live
catalog of models that can use tools: **Default** (`POCKET_ACP_MODEL`, else DeepSeek V4.1 Flash), the
**Tested** models (the default list plus any in `POCKET_ACP_MODELS`), then everything else marked
**Experimental — unverified**. A model OpenRouter adds shows up without a Pocket update. Experimental
means it may not use tools reliably.

The menu has a search box at the top (1.88). Type any words of a model's name or maker, such as `kimi`
or `sonnet 5.5`: the list narrows as you type, keeps Default and Tested first and says how many match.
Enter picks the first match and the arrow keys move through the list; on a phone the keyboard opens only
when you tap the box. Escape clears the box, a second Escape closes the menu.

What works the same as Claude Code and Codex:

- Your message shows as soon as you send it, the reply streams with its thinking and each file it reads
  and command it runs as ledger lines, and all of it is there when you reopen the conversation.
- Pocket's instructions reach it like the others (suggested replies, Projects, Files, Tasks, Inbox Watch,
  the Vault, the manual), so a reply that asks you to choose ends with reply buttons.
- Questions arrive as question cards with the options as buttons, through Pocket's own question tool
  (`acp-ask-mcp.mjs`; OpenCode's own question tool cannot reach Pocket over ACP). A push says when one
  is waiting.
- Permissions: **Review actions** shows each command, edit and web fetch as an approval card, with the
  command or file under it; **Full access** answers OpenCode at once so nothing waits.
- **Plan first** (OpenCode's plan mode: no edits), attachments (images are sent as images), the effort
  chip with the chosen model's own levels (OpenCode reports them; Pocket asks at start-up and every six
  hours), Stop, After this reply, the context meter, Results, Search, the Git panel and changes, and
  the `/` list with OpenCode's own commands and skills.
- Each reply shows its cost under it (to four decimals below a cent), its time and how much was read from
  cache. OpenCode reports a running total for the conversation; Pocket shows the change and keeps the
  total, so the cost stays right after a restart.
- A reply quiet for 30 minutes that is not waiting on you is stopped (`POCKET_STALL_MS`); an OpenCode
  process with no reply for 20 minutes is closed and reopens with the next message (`POCKET_ACP_IDLE_MS`).

What OpenRouter does not have (Pocket hides these on its conversations):

- **Steer**: a message sent during a reply waits for After this reply.
- **Side chat** and **Branch**, **While you were away** (OpenCode's history has no message times),
  the **Subagents** panel, and the Gmail, Calendar and Drive connectors.
- A reply running when Pocket restarts is not picked up again; the conversation says so, and you send
  it again.

Other points:

- Every reply is billed to the OpenRouter key, per token. OpenCode sends about 23,000 tokens of its own
  instructions with each reply, so even a short one costs a fraction of a cent on DeepSeek.
- Pocket sets the model (and effort) on OpenCode before every reply and checks OpenCode confirmed it. If
  OpenCode does not offer the model or does not switch, the reply stops with that reason instead of
  running on OpenCode's own default model.

### Memory and skills with OpenRouter

OpenRouter conversations use OpenCode's MCP settings. To give them shared memory,
add the MemStem server to OpenCode's `mcp` configuration and a memory-first
instruction file to its `instructions` list. Preserve the existing provider and
permission settings. Use an absolute MemStem executable path and an explicit
vault path. New and reopened agent processes load these settings.

MemStem's search, get, list-skills and get-skill tools provide the shared memories
and skills. When listing skills, omit `scope` to list them all; `all` is a literal
filter. Retrieve a skill by its exact returned title, not its folder name.

Saving these conversations requires MemStem's **OpenCode adapter** (ADR 0055),
which is separate from MCP access and off by default. Enable it only in the
intended vault. It reads OpenCode's SQLite database, backfills existing sessions,
and records the actual provider and model for each assistant response. Changing
models updates the same captured conversation. Exclude Pocket's `data/acp-probe`
directory and other test directories from capture.

See [MemStem's OpenCode setup](https://github.com/Memstem/memstem/tree/main/clients/opencode)
for the configuration examples and verification steps. This requires a MemStem
build containing the adapter; enabling OpenRouter in Pocket alone does not enable
capture. After setup, verify both directions: ask an OpenRouter session to search
a known memory and load a skill, then find a substantive new conversation in
MemStem and check its model tags.

## Claude Code, Codex and OpenRouter in Pocket

Since 1.86 every feature is built for all three agents, and since 1.87 Codex has what it lacked against Claude Code.
What still differs is what an agent itself cannot do; Pocket hides those on its conversations.

| | Claude Code | Codex | OpenRouter |
|---|---|---|---|
| Where conversations live | Transcripts in `~/.claude/projects/<folder>/<id>.jsonl` | Codex's own store under `CODEX_HOME` (`~/.codex`), read through `codex app-server` | OpenCode's own store, read through `opencode acp` |
| Id in Pocket links | The session UUID (`#/chat/<uuid>`) | `cx:` plus the thread id | `acp:` plus OpenCode's session id |
| Process kept between replies | One `claude` process | One app-server, which holds the thread's writer lock | One `opencode acp`, closed after 20 minutes idle |
| Same conversation open elsewhere | Pocket refuses to send for 45 seconds after another app wrote to it | Pocket cannot send while code-server or a terminal holds the thread; release it there first | — |
| Models | Pocket's catalog, narrowed by Settings, `POCKET_CLAUDE_MODELS` and the managed policy | The CLI's own list | OpenRouter's live catalog of models that use tools |
| Plan first | Not offered | Offered | Offered (OpenCode's plan mode) |
| Automatic model choice (Assistant mode) | Yes | No | No |
| Auto-continue after a usage limit | Yes | Yes (1.87) | Yes, for OpenRouter's rate limits (1.87) |
| Under each reply | Its cost and time | Tokens used and time (Codex is billed by plan, not per token) | Its cost, time and cache share |
| Changed files | Before and after for each edit | Each edit's diff (1.87) | Before and after for each edit (1.87) |
| Plan checklist | From TodoWrite | From Codex's plan updates, when it sends them (Codex 0.156 does not) | From OpenCode's plan |
| `/` commands | Claude Code's (compact, context, recap, init, code review…) | compact, review, recap, context (1.87) | OpenCode's own commands and skills |
| Steer, Side chat, Branch, While you were away, Subagents | Yes | Yes | No |
| Skill line inserted by the spark | `Use the /name skill.` | `Use the $name skill at <path>.` | `/name` |
| Rename with name sync on | Written to the transcript as Claude Code's own rename record | Set as the thread's name | Pocket's name only |

Questions, approvals, trusted read-only actions (Review actions), attachments, the context meter, search,
titles, Results and file cards work for all three.

## How it works

### Sessions, transcripts and the list

Pocket keeps no chat database. The conversation record is the agent's own: Claude Code transcripts
(`POCKET_SESSION_ROOT` overrides the folder, for isolated tests) and Codex's thread store. That is why a
session started in a terminal or in code-server shows in the list, and why a conversation started in
Pocket can be continued there with `claude --resume`. When another app writes to a Claude transcript,
the conversation shows **Activity elsewhere** for 45 seconds and its replies stream into an open view.
Recent writes alone cannot prove that work is still running, so that state is marked unconfirmed. Only a
message counts: the bookkeeping the CLI adds when its process closes (its cost total, the last prompt) leaves
**Response ready** and the conversation's place in **Attention** as they were.

The list holds the 200 most recently updated conversations, plus every pinned, running, waiting or
queued one. It is checked every five seconds while the app is visible. If no fresh answer arrives for
15 seconds, the list says **Status unavailable. Showing the last saved list.**

Some transcripts are folded or left out:

- Older resume copies of a Claude session (same title, same workspace) fold into the newest one, unless
  pinned or running. Branches never fold.
- Transcripts with no message from you and no summary (hook runs, subagent scratch) are left out unless
  pinned or running.
- Conversations in `/tmp/` workspaces are left out unless pinned or running.
- Codex subagent threads are not listed.

### Titles

A row's title is, first to last: your rename; Pocket's updated title; the agent's own title (Claude
Code's generated title, or the Codex thread's name); Pocket's generated title; the opening request (its first 300
characters; the conversation itself keeps all of it).
With **Sync names with code-server** on, a rename recorded in the Claude transcript (made in Pocket,
Claude Code or code-server) comes before all of them. A branch is titled *Branch: <instruction>* until it
has a generated title.

These settings are in **Settings → Conversation** and apply to the whole install:

| Setting | Default | What it does |
|---|---|---|
| **Sync names with code-server** | Off | Shares names with Claude Code itself. A rename in Claude Code or code-server shows in Pocket; a rename in Pocket is appended to the transcript as Claude Code's own rename record (or set as a Codex thread's name). Clearing a rename in Pocket clears only Pocket's name. |
| **Generate short titles** | On (`POCKET_AUTO_TITLES=0` starts it off) | Asks a small model for a 3 to 7 word title for conversations named only by their opening request, active in the last 14 days, one at a time. |
| **Update titles as conversations progress** | On | After a reply run from Pocket ends, a conversation that grew by four of your messages or about 8,000 characters, at least ten minutes (`POCKET_LIVE_TITLE_GAP_MS`) after its last check, is shown to the same model, which keeps the title or writes a better one. A rename is never touched. |
| **Summarize what you missed** | On | The While you were away summary. |
| **Model for titles and summaries** | Automatic | **Automatic: Claude first, then Codex**, **Claude · Haiku** (`claude -p --model haiku`, no tools, nothing saved) or **Codex · GPT-6-Luna** (`codex exec --ephemeral`, read-only). |

Calls run on that CLI's own sign-in. A Claude title costs about 400 tokens; Codex sends about 25k tokens
of built-in instructions with every call. `POCKET_TITLE_CLAUDE_MODEL` (default `haiku`) and
`POCKET_TITLE_CODEX_MODEL` (default `gpt-6-luna`) change the models. When the managed policy blocks the
Claude title model, the cheapest model the policy allows is used. Generated titles live in
`session-meta.json`, never in a transcript. Turning titles off also hides those already made.

### How search works

With [MemStem](https://github.com/Memstem/memstem) running beside Pocket (`POCKET_MEMSTEM_URL`, default
`http://127.0.0.1:7821`), search uses its keyword and meaning index of every Claude Code and Codex
session and returns up to 15 conversations. Results that match only by meaning say **Related**. The
section notes *Searched every conversation by wording and meaning (MemStem).* `POCKET_MEMSTEM=0` turns
this off.

Without a healthy MemStem, Pocket searches the listed conversations itself for the exact phrase, newest
first, for up to six seconds and up to 15 results, and says how many it covered (*Exact phrase in 120 of
the 200 most recent conversations, newest first.*).

Find in conversation (Ctrl/⌘ F) searches the open conversation's whole transcript, not only what is
rendered.

### Start links

A start link is a briefing handed to Pocket by an agent or a job. Opening `#/start/<id>` while signed in
puts the briefing in New conversation's box and selects the agent the link names. The link's folder
wins over the default workspace: it is selected when it is one of the listed workspaces and filled in
as a custom path when it is not. Nothing starts until you press Start. A link that has
expired shows *That start link has expired.*

A [handoff](conversation.md#hand-off-to-a-fresh-conversation) is a start link an agent writes from a conversation. It shows as a card
in the reply, and it starts once.

Links last 7 days by default (1 to 30), hold up to 20,000 characters of text and a 160-character title,
and are kept in `starts.json`, at most 500, oldest dropped first.

### Processes and limits

Each Claude conversation keeps a `claude` process and each Codex conversation an app-server between
replies, so working context and background jobs continue. A process closes after
`POCKET_IDLE_CLOSE_MS` with no reply and no background job (default one hour). At most
`POCKET_MAX_PROCESSES` (default 8) are kept; starting another closes the longest-idle one. When a message
needs a new Claude process (you picked another model, effort or permission mode, for example), the old one
is closed first, so that reply can take a few seconds longer to start. A reply with
no output, nothing waiting on you and no CPU use by its programs for `POCKET_STALL_MS` (default 30
minutes) is stopped. See [operations](../operations.md) for restarts and recovery.

### Settings and environment

| Variable | Effect |
|---|---|
| `POCKET_DEFAULT_CWD` | Workspace New conversation preselects. |
| `POCKET_LOCK_CWD` | `1` starts every conversation in `POCKET_DEFAULT_CWD`. |
| `POCKET_CLAUDE_MODEL`, `POCKET_CLAUDE_EFFORT` | Pocket's Default for Claude replies (the model counts only while it is offered, and follows its family forward to the newest version). Unset: the CLI's own settings. |
| `POCKET_CODEX_MODEL`, `POCKET_CODEX_EFFORT` | Pocket's Default for Codex replies; the model follows its family forward (`gpt-6-sol` runs GPT-6.1 Sol once Codex lists it). `POCKET_CODEX_EFFORT` takes `low`, `medium`, `high`, `xhigh`, `max` or `ultra`; `ultra` works only with a model that offers it. |
| `POCKET_CLAUDE_MODELS` | Claude models offered until a list is saved in Settings. |
| `POCKET_CLAUDE_MANAGED_DIR` | Where to read Claude Code's managed settings, if not the system folder. |
| `POCKET_CODEX` | `0` hides Codex even when installed. |
| `CLAUDE_BIN`, `CODEX_BIN`, `CODEX_HOME` | The CLIs and Codex's home, if not found automatically. |
| `POCKET_RETRY_BUFFER_MS` | Wait after a usage-limit reset before auto-continuing. |
| `POCKET_APPROVAL_MODE`, `POCKET_ALLOW_FULL_ACCESS` | Default permissions, and whether Full access is allowed. |
| `POCKET_PUBLIC_URL` | Public address used for start-link URLs. Without it, the address you last signed in from. |

Files in `POCKET_DATA_DIR` (the Pocket Code directory unless set): `session-meta.json` (names, pins
and their order, reviewed markers, generated titles, last outcomes), `saved-prompts.json`,
`starts.json`, `mutes.json`, `pocket-settings.json` (title settings, the Claude model list),
`usage-state.json` and `codex-usage-state.json` (last observed usage). Tabs, split panes, filters,
hidden conversations, drafts and per-conversation chip choices stay in each browser.

## For agents

There is no command to start, pin, rename or hide a conversation for the user; those are done in the
app. What an agent can do:

**Hand the user a briefed New conversation.** When a job or alert should end in the user starting work,
create a start link. It never starts anything by itself.

```bash
node scripts/pocket-start.mjs add --text "Review the failed backup on the web server and propose a fix." \
  --dir ~/projects/website --provider claude --title "Backup failed" --ttl-days 3
# prints https://pocket.example.com/#/start/3f9a1c0b2d4e (or /#/start/<id> when Pocket knows no public address)
node scripts/pocket-start.mjs add --file - --json < briefing.md   # briefing from stdin; JSON with id, path, url, expiresAt
node scripts/pocket-start.mjs show 3f9a1c0b2d4e                   # the stored briefing; exit 2 if expired
```

Run it from the Pocket Code directory, on the same machine as the server. It reads `cli-url` and
`cli-token` from the data directory and gives up after 30 seconds without an answer. `--dir` must be a
full path; `--provider` is `claude` or `codex`. Pair it with `pocket-notify --url /#/start/<id>` so a push
opens the briefing. The same request is `POST /api/start` with `{text, directory, provider, title,
ttlDays}` over loopback with `Authorization: Bearer <cli-token>`.

**Explain where a conversation is.** A Claude conversation's transcript is
`~/.claude/projects/<folder>/<id>.jsonl`, where `<id>` is the id in the Pocket link; a Codex
conversation's id in Pocket is `cx:` plus the thread id. Link the user to `/#/chat/<id>`.

**Change models or titles only when asked.** The Claude model list, title settings and name sync apply
to every device. Point the user to **Settings → Agents & instance** or **Settings → Conversation**, or,
for a provisioned install, set `POCKET_CLAUDE_MODELS` and restart Pocket.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| *Held until a background job finishes* | You switched Claude accounts while a job the agent left running (a build, a watcher) was still going, so its process kept the earlier sign-in. | Nothing to do: the message sends by itself on the new account when the job finishes. **Stop background jobs and send now** ends the job and sends it at once; the Queue shows the same choice. |
| *This conversation is being used in another app right now (code-server or a terminal).* | Another app wrote a Claude reply to this transcript in the last 45 seconds. | Wait for that reply to finish, then send again. |
| *This thread is open in another surface (code-server or a terminal). Close it there to send from Pocket.* | Another app holds the Codex thread's writer lock. | Close the thread there. In the other direction, use **Close conversation process** in Pocket before continuing in code-server. |
| *invalid project directory* or **Choose a workspace above** | The custom path is not an existing folder on the server. | Pick a listed workspace or enter a full server path. |
| *codex not available on this box* | Codex is not installed or `POCKET_CODEX=0`. | Install the Codex CLI (or set `CODEX_BIN`) and restart Pocket. |
| *Codex conversations are temporarily unavailable.* above the list | Pocket could not list Codex threads; Claude conversations still show. | Wait for the next check; if it persists, check the Codex CLI on the server. |
| A reply says the model *is not offered in Settings* or *is blocked by this computer's Claude Code policy* | The chosen model is not offered. | Choose another model, or offer it in **Settings → Agents & instance**. |
| *Choose a Claude model from the model menu, then send again.* | An old tab sent a Codex model to Claude (or the reverse). | Pick a model from the menu. |
| **Start request not yet confirmed** | The start was sent but the answer was lost. | **Retry start** (it cannot start a duplicate) or **Discard retry**. |
| **Status unavailable** or **Status unconfirmed. Reconnecting…** | The list check failed or is older than 15 seconds. | Wait, or use **Refresh**; work on the server continues. |
| *Could not search inside conversations.* | The search request failed or timed out. | **Try again**. |
| No generated titles | Titles are off, or neither CLI is installed and signed in (Settings shows the reason). | Turn on **Generate short titles**, or sign the CLI in. |

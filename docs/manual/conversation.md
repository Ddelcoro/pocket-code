<!-- manual
checked: 1.102.0
sources: choices.mjs, starts.mjs, results.mjs, queue.mjs, sidechat.mjs, public/sidechat.js, subagents.mjs, workspace.mjs, worktrees.mjs, public/secret-detect.js
-->
# Working in a conversation

A conversation is one Claude Code, Codex or OpenRouter session opened in Pocket Code: the replies, the message box under them, and the
panels around them for results, changed files, Git, the follow-up queue, side chats and subagents. This page covers
everything you do inside one conversation, from sending a message to steering a reply that is still running. It is always
on. Starting, finding and organizing conversations is in [Conversations (sessions)](sessions.md); questions from the
agent and approval cards have their own page, [Questions and approvals](approvals.md).

## Use it

### Send a message

Type in the message box at the bottom and press the send button.

- On a window at least 900px wide, **Enter** sends and **Shift+Enter** starts a new line. On narrower screens and phones
  Enter adds a line and only the send button sends.
- Your draft is saved on this browser as you type, per conversation, so it survives a reload, a closed tab or a phone that
  killed the app in the background. Drafts are not shared with your other devices.
- The chips above the box set the next reply: model, reasoning effort, permissions (**Review actions** or **Full access**,
  see [Questions and approvals](approvals.md#choose-review-actions-or-full-access)) and, on Codex and OpenRouter, **Work normally**
  or **Plan first**. These choices are remembered per conversation on this browser.
- When delivery cannot be confirmed (the network dropped mid-send), the message stays on the device and the box shows
  **Retry same message**, **Review conversation** and **Discard retry**. Retry resends with the same request id, so the
  server does not start a second reply for a message it already received. A message the server refused shows **Edit
  message** instead of Review conversation.
- When the last reply failed, the end of the conversation says so and offers **Send again** (the same text as a new reply)
  and **Edit message** (puts it back in the box). This notice comes from the server, so every device shows it.

### Attach files and screenshots

- The paperclip opens **Attach a file or screenshot**: **Choose files** (from the device), **Paste screenshot** (an image on
  the clipboard) and, when the Vault is on, **Store in the Vault**.
- Pasting an image straight into the message box attaches it too. Reading the clipboard depends on the browser; when it is
  refused, Pocket says so and you can choose a file instead.
- Each file can be up to 30 MB. Up to 10 attachments go with one message.
- Wait for **Uploading … files** to finish before sending; Pocket will not send while an upload is in flight. An upload
  stays with the conversation it started in, even if you switch conversations meanwhile.
- Attachments go with a new message only. While the agent is working, attach after the reply finishes.

Uploaded files are saved on the server under `~/pocket-uploads/<year-month>/` (in the home directory of the user Pocket
runs as). The agent receives the message with a list of the attached file paths and reads them as needed. Attachment
references survive a reload on the same browser.

### Use slash commands and skills

Type `/` at the start of the message box to open the list of commands, on New conversation as well as in a conversation.
Keep typing to narrow it: names are matched first, and descriptions only when no name matches. The best match is
selected. On a computer, use the up and down arrows, then Enter or Tab to pick and Escape to close; on a phone, tap one.

The list has three groups:

- **Claude Code** (Claude conversations): the CLI's own commands that work through Pocket. Pocket offers only the
  ones your Claude Code lists, so one it does not have is left out.

  | Command | What it does |
  |---------|--------------|
  | `/compact [focus]` | Summarizes the conversation so far to free up context; add what to keep in focus, or send it as is |
  | `/context` | Shows what is filling the context window |
  | `/recap` | Sums up where the conversation stands |
  | `/init` | Writes a `CLAUDE.md` that describes the project |
  | `/code-review [level]` | Reviews the current changes for bugs |
  | `/security-review` | Checks the pending changes for security problems |
  | `/simplify` | Cleans up the code that was just changed |
  | `/mcp` | Shows which MCP servers are connected |

- **Codex** (Codex conversations, since 1.87): Codex's counterparts, run as Codex's own turns.

  | Command | What it does |
  |---------|--------------|
  | `/compact` | Compacts the conversation so far to free up context |
  | `/review [base branch]` | Reviews the uncommitted changes, or the branch against a base branch (`/review commit <sha>` for one commit); the findings are the reply |
  | `/recap` | Sums up where the conversation stands |
  | `/context` | Shows what is filling the context window |

- **OpenRouter** conversations list OpenCode's own commands and skills.

- **Pocket**: actions Pocket runs itself. Nothing is sent to the agent.

  | Command | What it does |
  |---------|--------------|
  | `/btw` | Opens the [side chat](#ask-a-side-question-side-chat); type your question after it |
  | `/branch` | Opens [Branch](#branch-into-a-new-conversation) |
  | `/handoff` | Asks the agent for a [handoff](#hand-off-to-a-fresh-conversation) |
  | `/new` | Starts a new conversation in this conversation's folder |
  | `/model`, `/effort` | Open the model and effort choices, the same as the chips |
  | `/usage` | Opens Plan usage |

- **Skills**: for Claude, the skills and commands in `~/.claude/skills` and `~/.claude/commands`, the conversation
  folder's own `.claude/skills` and `.claude/commands`, and plugin skills (`plugin:skill`). A skill whose `SKILL.md` says
  `user-invocable: false` is left out. For Codex, the skills Codex reports for the conversation's folder.

In a conversation, a command that needs nothing more (`/context`, `/recap`, `/init`, …) is sent as soon as you pick it.
The others are typed into the box with a space after them, ready for the rest of the message. A Codex skill is typed as
its skill line, such as `Use the $name skill at <path>.` While a reply is running, only `/btw`, `/branch`, `/new` and
`/usage` are offered. On New conversation, only what works without a conversation is offered, and picking one types it in.

Any `/command` you type in full is sent to the agent as typed, so every command and skill of the CLI works as it does in
a terminal, listed or not. A command's answer, such as the `/context` table, shows as the reply and stays after a reload.

On the **New conversation** screen, the spark button **Choose a skill** also opens a searchable list of the skills and
puts the chosen one at the top of your first message.

### Pick a suggested reply

When a reply ends by asking you to choose between specific next steps, Pocket shows the options as buttons under it.

- Tapping a button sends that text as your next message, exactly as if you had typed it.
- When the agent has a clear recommendation, that button is filled and tagged **Recommended**. The tag is not part of what
  is sent.
- The buttons show only under the latest reply, once it has finished, while the message box is empty. Typing hides
  them; the X dismisses them for that reply on this browser.
- Questions an agent asks while it is still working use the question form instead (see
  [Questions and approvals](approvals.md#answer-a-question)).

### Read a reply

Replies render as GitHub-flavoured Markdown: headings, lists, tables, quotes, code and task checklists.

- Raw HTML in a reply is shown as text, never run.
- Links to websites (`http`/`https`) open in a new browser tab. A link to one of this Pocket's own things (a
  conversation, a project, a file in Files, or a file Pocket serves) opens the way **Settings → Projects, files, tasks &
  vault → Open files and links** says: as a tab, beside the conversation, or in a new window. A served file shows in a
  link view with **Open in browser** and **Copy link**. Other links, and a website link with a user name or password in
  it, show as plain text.
- A local image path on its own line (under the home directory, `.png`, `.jpg`, `.gif` or `.webp`) shows the image.
- Each code block has a **Copy code** button, and each reply a **Copy message** button that copies the prose and code
  without the tool steps.
- Runs of tool calls fold behind one line with the count and the latest step. **Settings → Conversation → Collapse steps**
  keeps them folded; **Describe steps in plain words** shows "Saved Proposal.pdf" instead of the raw tool name. Both are
  per browser.
- **Settings → Conversation → Show message times** shows a time on each message and a divider for each day.

### See the cost of a reply

When a Claude reply finishes while the conversation is open, a small line under it shows that reply's cost, how long it
took, and either how much of the context came from the prompt cache ("97% cached") or "cold start". Codex replies show the
time and cache only, since Codex is paid by subscription. The line is not saved in the transcript, so it is gone after a
reload. The push notification for a finished reply says **Ready** followed by the same cost and time. Assistant mode hides
the line and leaves only **Ready** in the notification.

### Try harder (Assistant mode)

In Assistant mode, a **Try harder** button sits under the latest finished Claude reply. It sends "Please take another,
more careful pass at that. Check your work before you answer." on Opus when the picker offers it (otherwise the strongest
offered model) at high effort, and the conversation keeps that model and effort for later replies. Codex conversations
do not show it.

### Open results and files from a reply

**Results** in the conversation header lists the links and report files mentioned in this conversation's replies, newest
first. Search it with **Find a result**; **Copy link** copies the address.

- A file counts when a reply names it as a link, a code span or a path on its own line, or when a tool wrote or edited it.
  It must be under `/home/`, `/Users/` or `/root/`, have no hidden folder in its path, and be one of: PDF, CSV, TSV, XLSX,
  DOCX, PPTX, TXT, MD, HTML, JSON, ZIP, PNG, JPEG, GIF or WEBP.
- Downloading a file requires your Pocket sign-in, a mention of the file in this conversation, and a real path inside the
  server user's home directory. A file that was moved or deleted shows "This result is not available".
- Results scans the latest 4,000 messages and keeps the latest 200 references. Older ones may still be in the transcript;
  the panel says when it is showing recent references only.
- A mention does not prove the file was created. Open it to check.

Files a reply hands over (named in its text, not only written by a tool) also appear as **file cards** under that reply:
a picture, the name and type, and **Download**. A PDF's card shows its first page. Tapping the card opens PDFs, HTML, text,
Markdown, CSV and JSON in Pocket's viewer; Office files and ZIPs download. HTML opened this way is sandboxed and its scripts
do not run. Images get no card because they already show in the reply.

With the Files library on, cards and Results rows offer **Keep in Files**, and a kept file reads **In Files** (or **Kept ·
Open** in Results). **Settings → Projects, files, tasks & vault → Keep files from replies** keeps them automatically. See [Files](files.md).

### See what the agent changed

- **Changed files** (the diff button in the header, or **Conversation options → Changed files**) lists every file this
  conversation edited or wrote, read from its transcript, with the before and after of each edit. Failed edits are counted
  but not shown. Codex conversations show each edit's diff (since 1.87); OpenRouter's show before and after, as Claude's do.
- **Git** in the header shows the whole working tree of the repository the conversation is working in: branch, changed files
  and their diffs, including changes made by other conversations or by hand. It is read-only. Pick a file to see its
  **Working tree** or **Staged** diff. Untracked files are listed without content. The panel follows the work, not the folder
  the conversation began in: its title reads `Working in <folder> · <branch>`, and it opens on the repository of the last
  file the agent edited, then the last folder it worked in that is in a repository, then the starting folder. If the
  conversation touched more than one repository, **Repository** lists up to six, newest first. **Also working here** names
  other running conversations in the same repository, each with a link. The Git button is hidden until the conversation has
  worked in a repository inside the server user's home directory. Claude conversations are read from the folder on each
  transcript line and the files they edit, Codex conversations from each command's working folder and the paths in its
  patches. OpenRouter conversations stay on their starting folder.

Git limits: the first 250 changed files, 256 KB per diff. The repository must be inside the server user's home directory.
Files in hidden folders, symlinks that point outside the repository, and names that look like keys or credentials
(`id_rsa`, `credentials`, `secrets`, `*.pem`, `*.key` and similar) are listed but cannot be previewed.

### See and remove worktrees

A worktree is a second folder of the same repository, on its own branch, so two pieces of work don't get in each other's way.
Agents make them and rarely clean up. Under the changed files, the Git panel lists every worktree of the repository in three
groups, and only shows the section when there is more than the repository's main folder. Each row has the folder, the branch
and the date of its last commit. Assistant mode doesn't show it.

| Group | Means | Row says |
|---|---|---|
| **In use** | A conversation is running there, one was active in the last 24 hours, a process has it open, or it is your live Pocket folder. | Which one, with a link to the conversation |
| **Has work** | There are uncommitted changes, commits Pocket can't find anywhere else, the worktree is locked, or a conversation used it in the last 14 days. | What is keeping it: `2 uncommitted changes`, `Commits not safe elsewhere`, `Locked`, `Used 3 days ago` |
| **Ready to remove** | Nothing would be lost and it has been idle for 14 days. The commit is in the default branch or on a remote, or its pull request merged at exactly this commit. | Why it's safe: `Merged in PR #41`, `In origin/main`, `On a remote branch` |

The list opens first and the groups fill in as each folder is checked. On a phone the groups start closed with their counts
showing.

**Remove** only appears on a **Ready to remove** row. It opens a sheet that names what goes with the folder, then asks once:

1. Ignored files that would be deleted, such as `.env` or exported data. Rebuildable folders like `node_modules` are not
   listed.
2. Any conversation that started in that folder. It keeps its history and carries on from your home folder. Pocket says so,
   once, the next time you send it a message.

**Remove folder** deletes the folder and keeps the branch and its commits. Pocket checks again at the moment you confirm. If
anything changed since the sheet opened, it refuses and lists the worktree again. Pocket never forces a removal, never
removes the repository's main folder, a locked worktree, or the folder Pocket runs from, and never deletes a branch. Only the
signed-in person can remove one: agents and the command-line token can't, and each removal is written to
`worktrees-removed.jsonl`.

### Find in a conversation

The search button in the header, or **Ctrl/Cmd F**, opens **Find in conversation**. It highlights matches in the messages
on screen; Enter and Shift+Enter (or the arrows) step through them. When the conversation is longer than what is rendered,
Pocket also searches the whole transcript and offers **N matches in older messages — view**, which lists them with a
snippet. Older-message search needs at least two characters and returns up to 50 messages.

### Steer a running reply or queue a follow-up

While the agent works, the message box shows two buttons, **Steer now** and **After this reply**. OpenRouter
conversations cannot be steered, so there the buttons are hidden and a message sent during a reply waits for it to end.

- **Steer now** (the default in Developer mode) sends your message into the reply that is running. The agent sees it at
  its next step. It does not start a separate reply and does not change the running reply's model or permissions. If the
  agent is waiting on a question, a steered message skips the question; see
  [Questions and approvals](approvals.md#type-instead-of-answering). When the reply cannot take a message at that moment
  (it is finishing, or Pocket restarted and lost its input), the message is queued after it instead and the note reads
  **Queued after the current reply.** If the reply has already ended, the message starts the next one.
- **After this reply** (the default in Assistant mode, where the choice is hidden) saves the message in the conversation's
  queue. Each queued message runs as its own reply when the current one finishes successfully, one at a time, in order. It
  runs with the model, reasoning and permissions that were selected when you queued it.

Steered and queued messages are text only: attachments wait for a new message.

### Manage the queue

**Queue** in the header opens **Queued instructions**. Each row shows its position, its state, the text and its
permissions.

| State | Meaning |
|---|---|
| After the current reply | Waiting; runs when the running reply finishes successfully. |
| Paused | Waiting, with no reply running. Use **Run next instruction**. |
| Editing · paused | Someone opened it for editing. It will not run until saved or cancelled. |
| Starting… | Being handed to the agent. |
| Needs review | The start could not be confirmed, or the message could not start (the row says why). Everything behind it waits. |

- **Edit** reserves the row; **Save changes** or **Cancel edit** releases it. Closing the panel mid-edit leaves the row
  paused, and **Continue editing** brings back this browser's unsaved text. Other devices see the paused row but not your
  unsaved text.
- **Remove** deletes a row. A row that is starting cannot be removed.
- **Run next instruction** appears when the first row is waiting and nothing is running. It is disabled while activity is
  seen in another app (a terminal or code-server).
- Stopping a reply, or a reply that fails, pauses the queue. Use **Run next instruction** to continue.
- A **Needs review** row blocks the rows behind it. Check the conversation to see whether it ran, then remove it.

A conversation holds up to 10 queued messages. Every edit carries a revision number, so an edit made from a stale panel is
refused with "The queue changed. Refresh before editing."

### Stop a reply

**Stop** in the Working row stops the running reply. Pending questions and approval cards are withdrawn, the queue pauses,
and no finished-reply notification is sent. Work the agent already did stays done; review the conversation before sending
the next message.

### Ask a side question (side chat)

A side chat asks a quick question about this conversation without adding anything to it. Nothing is saved and nothing in
the conversation changes. Use it to ask why something was decided, what a file does, or where the work stands, even while
the main reply is still running.

Open it with:

- **Side chat** in the chip row above the message box on a computer (an icon in the Working row while the agent works);
- the speech-bubble button in the header on a phone;
- **Conversation options → Side chat** on any device;
- **Ctrl/Cmd ;** in the conversation (press again to close);
- a message that starts with `/btw`, for example `/btw what did we decide about the cache?`. The rest of the message is
  asked in the side chat at once.

On a window at least 1280px wide it opens in the right-hand panel beside Results, Queue and Git; elsewhere it opens as a
sheet.

How it behaves:

- It starts from the conversation as it is when you ask the first question, then remembers its own questions and answers.
  **New side chat** starts over from the conversation as it is now.
- Claude's side chat can read files and search them. It searches the web only when the conversation would do that
  without asking: in Full access, or when you trust `WebSearch`
  ([Let read-only actions run without asking](approvals.md#let-read-only-actions-run-without-asking)). In Review
  actions it does not search the web, because the side chat cannot ask you. It cannot run commands or edit anything. Codex's side chat runs in a read-only sandbox and can also run read-only
  commands. Neither uses MCP servers or app connectors, and Claude Code hooks do not run in it.
- A Codex side chat asks Codex which MCP servers it has and turns each one off. If Codex cannot list them (for example,
  its `config.toml` does not load), the side chat does not start and says why.
- It uses the conversation's model.
- The server holds it while it is open, so closing the panel, reloading, or opening the conversation on another device
  shows the same side chat. One side chat per conversation.
- It ends when you close it, after 30 quiet minutes, when Pocket restarts, when the Claude sign-in changes (Claude side
  chats), or when a newer one replaces it. Your next question starts a new one.
- Claude answers show their cost and the footer the running total. The first question reads the whole conversation, so it
  costs the most; follow-ups read it from the prompt cache. Codex answers show their time only.
- **Stop** (the Ask button while it answers) stops the answer. If a Codex side chat does not answer Stop within 20
  seconds, Pocket ends that side chat; your next question starts a new one.
- **Need work done? Branch instead** moves your typed text to [Branch](#branch-into-a-new-conversation) without sending it.

The side chat needs at least one message in the conversation first. Its messages go through the same
[secret check](#the-secret-check-on-sending) as the message box.

### Branch into a new conversation

Branch starts a new, saved conversation that carries on from this one with everything so far ([a handoff](#hand-off-to-a-fresh-conversation) carries a briefing instead). It can edit files and run
commands, with the permissions chosen for it. The original conversation stays as it is.

1. Choose **Branch** in the chip row above the message box on a computer (an icon in the Working row while the agent works), or
   **Conversation options → Branch** on any device.
2. Under **What should the branch do?**, write the first instruction.
3. Check the note under the box: it names the model and permissions the branch will use, which are this conversation's
   settings for its next reply. If this conversation is still working, the sheet warns that both will work in the same
   folder, so keep them off the same files.
4. Choose **Start branch**.

The branch starts in the folder the work is in, the same one the [Git panel](#see-what-the-agent-changed) opens on, and the sheet names it (`Starts in <folder>.`). A conversation that began in `~` and moved into a repository branches in that repository.

The branch opens at once. Its title is `Branch: …` with the start of your instruction until a proper title is ready. It
shows **Branch of …** under its header, linking back, and the original lists its branches the same way (the first three,
then "and N more"). The branch's first reply reads the whole conversation again. From then on it is an ordinary
conversation.

**Use side chat instead** moves your text to the side chat without sending it. A double tap on **Start branch** starts one
branch, not two.

### Hand off to a fresh conversation

A handoff starts a new conversation that knows only a briefing the agent wrote, not the whole history. Use it when a
conversation has grown long or the next step is a separate job. Use [Branch](#branch-into-a-new-conversation) when the new
conversation needs everything said so far: Branch keeps all of it, and each of its replies reads all of it again.

1. Choose **Handoff** in the chip row above the message box on a computer (an icon in the Working row while the agent
   works), **Conversation options → Handoff** on any device, or `/handoff` from the `/` list. You can also ask in your own
   words. The agent writes the briefing. If the agent is still working, the request waits in the queue and runs after
   the current reply.
2. The reply shows a card, **Continue in a new conversation**, with the title, folder, agent, permissions and the start of
   the briefing. Assistant mode shows the title and briefing only.
3. Choose **Start** to begin at once, or **Review first** to read and change the briefing on New conversation.

The new conversation opens with the briefing as its first message. It shows **Continued from …** under its header, and the
original shows **Continued in …**.

When a conversation grows past the size set in [Settings → Context and subagents](settings.md) (200K tokens unless you
change it), a line appears under the latest finished reply: **This conversation is at 435K tokens, and every reply reads
all of it.** with **Hand off** and **Not now**. Hand off asks for the briefing, the same as the button. The line shows
only while nothing is running, waiting for you or typed in the message box, and not in a conversation that has already
been continued in another. **Not now** hides it until the conversation reaches the next multiple of that size (400K, then 600K
with the default), on this browser. The context ring turns amber at the same point. Pocket never hands off by itself.

When the reply ends with [suggested replies](#pick-a-suggested-reply), the line is not shown. Instead the replies get one more
button, **Hand off first**, so you decide once. Pick a reply to carry on here (that also counts as Not now). Choose
**Hand off first** to start the handoff with your choice still open: the briefing lists the suggested replies as the
first decision, so the new conversation offers them to you. The Handoff button does the same while suggested replies
are showing.

- A handoff starts once. If it has started, the card reads **Started** and links the conversation; Start on another device
  opens that conversation instead of making a second one.
- A handoff never has more permission than the conversation that wrote it. It gets Full access only when that conversation
  and your default are both Full access, otherwise Review actions. Review first can change this, because that is you
  choosing.
- A handoff from OpenRouter, or from a terminal outside Pocket, has no conversation to link back to and gets Review actions.
- If the folder has gone, Start is off and the card says so. Review first lets you choose another folder.
- Handoff links last 7 days unless the agent sets another length. After that the card says the link has expired.

### Watch subagents

When the agent delegates work to subagents, or leaves work running in the background, a **Subagents** button appears
under the conversation's status controls, for example **2 subagents working · View**, **1 subagent working · 1 background
job · View**, **Working in background · 1 job · View** or **Subagents · 5 recorded · View**. **Conversation options →
Subagents** opens the same view at any time.

The sheet names the background jobs (commands the agent left running) first. Expand an agent to read its task, its
latest step or sentence, its kind and model, whether it runs in the background, and its counts of tool calls and
messages (or tokens when the provider reports them). States are Working, Starting, Completed, Failed, Interrupted,
Closed and **Status unconfirmed**.

**Show activity** (Claude agents with a transcript of their own) opens what the agent has done so far: its steps as
ledger lines and what it wrote, from its own transcript (`<project>/<session>/subagents/agent-<id>.jsonl`), the last
300 messages. While the agent works the box follows it every 5 seconds. **Hide activity** closes it.

A permission request or question from a subagent reaches you like any other, named after the agent; see
[Questions and approvals](approvals.md#review-an-action).

- The view refreshes every 5 seconds while the app is visible. Reading it never sends anything to an agent.
- "Working" is shown only while Pocket can confirm the conversation's reply is running (or the agent runs in the
  background). Otherwise an unfinished agent shows **Status unconfirmed**. If refreshing fails for 15 seconds the view
  says "Activity could not be confirmed", keeps the last details and offers **Retry**.
- Up to 100 agents are listed; the task and result text of each is cut at 12,000 characters. Background shell jobs are not
  agents and are not listed.
- Conversations run in a terminal or code-server show their history, but their running state cannot be confirmed.

### The secret check on sending

Before a message leaves, Pocket checks it for text that looks like a credential: private keys, API keys and tokens with a
known format (Anthropic, OpenAI, OpenRouter, GitHub, GitLab, AWS, Stripe, Slack, Google, Twilio, SendGrid), signed JWTs, a
password inside a URL, card numbers, and assignments such as `password: …` or `api key is …` whose value has a digit or
symbol. When you paste or drop text, a lone long random-looking token is caught too.

When something matches, the message is held and **That looks like a secret** opens:

- With the Vault on and unlocked, **Store and send** saves each secret in the Vault under the suggested name and sends the
  message with a `{{vault:name}}` placeholder that agents use instead.
- **Send as is** sends it unchanged. It goes to the model and stays in the transcript.
- **Edit** returns to the message. Nothing is sent.

On paste, the same sheet offers **Store in the Vault**, **Paste as is** and **Cancel**. The server runs the same check on
every message, branch and side chat question, so a held message is never recorded or delivered. Turn the check off with
**Settings → Projects, files, tasks & vault → Catch secrets in messages** (on by default, for the whole install). More in
[Vault](vault.md#catch-secrets-typed-into-messages).

## How it works

### Where data lives

| What | Where |
|---|---|
| Conversation history | The provider's own transcript (Claude Code's project files, Codex's session store). Pocket does not copy it. |
| Uploaded attachments | `~/pocket-uploads/<year-month>/` |
| Follow-up queue | `followup-queue.json` in `POCKET_DATA_DIR` |
| Worktree removals | `worktrees-removed.jsonl` in `POCKET_DATA_DIR`, one line each |
| Delivery receipts (for Retry same message) | `delivery-receipts.json` in `POCKET_DATA_DIR`, kept a week, at most 2,000 |
| Branch links (Branch of …) | `session-meta.json` in `POCKET_DATA_DIR` |
| File-card pictures | `artifact-thumbs/` in `POCKET_DATA_DIR` |
| Side chats | Server memory only; nothing is written |
| Drafts, unsent messages, attachment references, dismissed suggestions, queue edit drafts | This browser's storage |

`POCKET_DATA_DIR` defaults to the Pocket Code directory.

### Suggested replies

Pocket adds an instruction to every conversation it runs (Claude through `--append-system-prompt`, Codex through the
thread's developer instructions) asking the agent to end a closing question with a fenced block whose info string is `choices`,
with 2 to 4 short options, one per line, the recommended one first and marked `(Recommended)`. Pocket strips the block
from the reply and shows the options as buttons. Only a block at the very end of a reply counts. Pocket reads at most 5
options and cuts each at 120 characters. Conversations run from a terminal or code-server do not get the instruction. A Codex
`config.toml` that sets its own `developer_instructions` replaces Pocket's lines, so those conversations show no buttons.

### Side chat processes

A Claude side chat is a separate Claude Code process started as a fork of the conversation that is never saved
(`--fork-session --no-session-persistence`), with only the Read, Grep and Glob tools (plus WebSearch when the
conversation is in Full access or `WebSearch` is a trusted action), no MCP servers and hooks disabled. A Codex side chat
runs its own `codex app-server` with an ephemeral, read-only fork of the thread, approvals off, and app connectors and
every MCP server that `codex mcp list` reports for the conversation's folder switched off. Either process leads its own
process group, and closing the side chat ends the whole group, so nothing it started outlives it. At most 4 side chats
run at once across Pocket; when a fifth is needed, the one idle longest is closed.

### Settings

| Setting or variable | Effect |
|---|---|
| **Settings → Conversation → Collapse steps** | Fold runs of tool calls. This browser. |
| **Settings → Conversation → Describe steps in plain words** | Plain-language step lines. This browser. |
| **Settings → Conversation → Show message times** | Times and day dividers. This browser. |
| **Settings → Projects, files, tasks & vault → Catch secrets in messages** | The secret check. Whole install, on by default. |
| **Settings → Projects, files, tasks & vault → Keep files from replies** | Keep files named in replies in Files automatically. |
| `POCKET_CHOICES=0` | Stop asking agents for suggested-reply buttons. |
| `POCKET_SIDE_CHAT=0` | Turn side chat off. |
| `POCKET_SIDE_CHAT_BUDGET_USD` | Spending cap for one Claude side chat, in dollars. Default `5`; `0` removes the cap. |
| `POCKET_SIDE_CHAT_IDLE_MS` | Quiet time before a side chat ends, in milliseconds. Default 30 minutes; `0` never ends it for quiet. |
| `POCKET_SIDE_CHAT_MAX` | Side chats running at once. Default `4`. |
| `POCKET_CHROME`, `POCKET_PDFTOPPM`, `POCKET_CONVERT` | Paths to the tools that draw file-card pictures. An empty value turns that tool off. |

Variables go in the Pocket Code directory's `.env`; restart Pocket after changing them.

## For agents

- **Offer choices the Pocket way.** When you end a reply by asking the user to pick between specific next steps, finish
  with a fenced code block whose info string is `choices`, 2 to 4 options, one per line, each the short reply the user
  would send (under 60 characters). Put a clear recommendation first and end it with `(Recommended)`; mark at most one.
  The block must be the last thing in the reply. Do not add it for open-ended questions or questions that need a typed
  answer. Example:

  ````
  Should I merge now or wait for the test run?

  ```choices
  Merge and deploy (Recommended)
  Wait for the tests
  ```
  ````

- **Hand over files so they show.** Name a deliverable by its absolute path on its own line, in a code span or as a Markdown
  link. Files under the home directory with a supported extension then appear in Results and as a file card the user can
  open or download. Avoid hidden folders in the path.
- **Read attachments.** A message with attachments ends with `[Attached file — read as needed:` followed by absolute paths.
  Read them with your file tools.
- **A steered message is part of the same reply.** A user message that arrives while you work is a correction to the running work;
  take it into account at your next step.
- **Side chat agents** are told they cannot change anything. If the user wants work done, suggest asking in the main
  conversation or using Branch.
- Do not try to drive the queue, side chat or Branch for the user; they are user controls in the app. The HTTP API behind
  them requires the user's sign-in.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Wait for the attachment upload to finish." | An upload for this conversation is still in flight. | Wait for **Uploading … files** to clear, then send. |
| "Upload failed: … is over 30 MB" | The file is larger than the 30 MB upload limit. | Share a smaller file, or put it on the server and give the agent its path. |
| "Attach files after this reply finishes." | Attachments only go with a new message. | Wait for the reply to finish, or Stop it. |
| "This browser cannot read clipboard images." | The browser does not allow clipboard reads (common in embedded views). | Paste into the message box directly, or choose a file. |
| "This conversation is being used in another app right now" | A terminal or code-server wrote a reply to this conversation in the last 45 seconds. | Wait for that reply to finish, then send again. |
| "Queue is full (10 messages)." | The conversation already has 10 queued messages. | Run or remove some in **Queue**. |
| Queue shows **Needs review** | Pocket could not confirm the item started (a crash or failed start). | Check the conversation; remove the row once you know whether it ran, then send again if needed. |
| Queued messages do not run | The last reply was stopped or failed, or Pocket restarted. | **Queue → Run next instruction**. |
| No suggested-reply buttons | The reply is still running, the box has text, they were dismissed, the conversation was run outside Pocket, `POCKET_CHOICES=0`, or Codex's `config.toml` sets `developer_instructions`. | Clear the box, or check the configuration. |
| "This result is not available. It may have moved or been removed." | The file named in the reply no longer exists at that path. | Ask the agent where the file is now. |
| "This file is not a result referenced by the conversation." | The download link was opened from another conversation or the file is not in Results. | Open it from Results in the conversation that mentions it. |
| Git: "This workspace is not an available Git repository." | The conversation hasn't worked in a repository. | Nothing to fix; Git only shows repositories. |
| No Git button in a conversation that is in a repository | The conversation runs in a folder outside the server user's home, or its repository starts above home. Git only reads repositories inside home, so the button is not shown there. | Use Changed files for that conversation's edits. |
| Git: "This diff exceeds the 256 KB preview limit." | The diff is too large to preview. | Ask the agent for a summary or inspect it in an editor. |
| "This conversation's folder is gone, so it carries on from your home folder." | The folder it started in was removed. | Nothing to fix. History is kept. Tell the agent which folder to work in if it matters. |
| **Worktrees** section missing | The repository has only its main folder, or Pocket is in Assistant mode. | None needed. |
| A worktree you expected to remove is under **Has work** | It has changes, commits Pocket can't find elsewhere, or a conversation used it in the last 14 days. The row says which. | Commit and push, or merge the pull request, then open Git again. A recently used folder moves to Ready once 14 days pass. |
| Remove: "This worktree changed…" | Something changed after the sheet opened. | Look at the list again, and remove it from there if it's still ready. |
| Side chat: "Send a message in the conversation first…" | The conversation has no transcript yet. | Send a first message, then ask again. |
| Side chat: "This side chat reached its spending cap." | One Claude side chat spent `POCKET_SIDE_CHAT_BUDGET_USD`. | **New side chat**. |
| Side chat: "Too many side chats are answering right now." | `POCKET_SIDE_CHAT_MAX` side chats are all mid-answer. | Wait for one to finish. |
| Side chat: "Side chat is switched off on this Pocket." | `POCKET_SIDE_CHAT=0`. | Remove it from `.env` and restart. |
| Side chat or Branch: "Claude account sign-in is in progress." | A Claude sign-in is open in **Accounts & instance**. | Finish or cancel the sign-in. |
| Cost line missing under a reply | The reply finished while the conversation was closed, or the page was reloaded (the line is not saved), or the conversation's process was started by an older Pocket. | Use the **Ready** notification or the plan usage view. |
| Subagents show **Status unconfirmed** | Pocket cannot confirm the reply is running (it ran elsewhere, or the status check failed). | **Retry**; the last details stay readable. |
| An agent has no **Show activity** | It has not written a transcript yet, or it is a Codex agent (Codex keeps none Pocket can read). | Wait for its first step; read **Latest activity**. |

Delivery and queue recovery after a restart: [Operations](../operations.md#delivery-and-queue-recovery).

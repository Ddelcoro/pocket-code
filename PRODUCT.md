# PRODUCT.md — Pocket Code

Design context for contributors. For setup and usage, see the README.

**What it is:** A self-hosted desktop and mobile web workspace (PWA) for Claude Code
and Codex sessions. Desktop tabs, split conversations and workspace panels support
long work sessions; phone and tablet views support the same workflows on the move. It's a thin window onto sessions that live and run on
the server. The server owns every turn, so work continues when the phone screen goes dark.

**Who it's for:** One operator running many agents at once. Developers, and anyone
technical who already runs Claude Code or Codex on a Linux server and uses the agents for
more than code (reports, email, accounting, operations). They keep a terminal, VS Code or
code-server alongside Pocket. Every screen uses the same conversation stores; a process
holding a Codex thread must release it before another surface can write to it. Not a
hosted service and not a multi-user team product.

**Jobs:**
1. See recent sessions across all projects and open one.
2. Continue a session: send a message, watch progress, walk away, come back.
3. Start a new session in a chosen project directory.
4. Work across desktop conversations and inspect Results, Queue and Git without losing context.

Five optional features add jobs beside those. They are off until the owner switches them on
in Settings → Projects, files, tasks & vault, and a session works the same without them:

5. Projects: keep where a piece of work stands, its next step, a checklist, reminders and the
   sessions that worked on it, so it can be picked up later.
6. Files: keep the outputs worth finding again (reports, PDFs, images) and share one only when
   the owner decides to.
7. Tasks: keep a to-do, with a time if one is given, and start a session from it. With
   Projects on, the list is the one place for everything with a time, reminders included.
8. Vault: let agents use credentials by name, in commands and browser logins, without the
   values reaching the model, the transcript or memory, with the owner deciding how much
   they may do without asking.
9. Coordination: see which conversation holds staging or a deploy and who is waiting, so two
   conversations don't work the same shared thing at once. Holds are advice, not a lock.
9. Inbox: read what the owner's inbox watcher (Inbox Watch) sent, answer it (resolved, not
   useful, dismiss) so the watcher learns, and set when it checks, which models judge and
   what it may skip, with what each day cost.

**Two modes (1.60, 1.68.1):** the same server, sessions and libraries, two faces. Developer
mode is the workbench above. Assistant mode is for people who never write code: it opens on
"What would you like done?", shows what is waiting, picks the model and describes every step in
plain words. Coders stay in Developer mode; people who use Pocket as their work assistant use
Assistant mode.

**Principles:**
- Bare essentials: sessions, chat, new session. A clean screen, simple navigation, and as
  much room as possible for the conversation. Projects, Files, Tasks, Inbox, Coordination and the Vault are
  off by default and sit beside sessions rather than in front of them.
- Everything round-trips with the CLIs and editor extensions. No private history.
- Reading matters more than composing. Assistant text renders as a full-width document,
  not chat bubbles.
- Type is large and high-contrast, and comfortable to read outdoors or with tired eyes.
- Light, dark and system appearance for daytime, evening and on-the-go use. Preserve
  the familiar dark workbench for existing browsers; new browsers follow the device.

**Optional voice:** speak to a session and hear short spoken replies. Speech runs on the
Pocket server; voice is an input and output method, not a separate assistant.

**Out of scope:** general file browsing/editing, a terminal and multi-user accounts. Files is
a curated library of outputs someone chose to keep, not a browser for the server's file system. Native questions and action approvals are
supported; review/full-access choices govern subsequent Pocket-owned turns, while
server credentials and provider rules remain the authority. Read-only Git inspection belongs to the
session workspace. Codex Plan mode guides the task but is not a security sandbox.

**Platform:** Desktop/mobile web / installable PWA, served by `server.mjs` (default port 3610)
behind an HTTPS tunnel or reverse proxy.

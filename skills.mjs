// Agent skills that ship with Pocket Code (1.34). skills/pocket-projects, skills/pocket-files, (1.36) skills/pocket-tasks, (1.59) skills/pocket-google and (1.69) skills/pocket-inbox are written into the
// user-level folders Claude Code (~/.claude/skills) and Codex ($CODEX_HOME/skills) read, so every agent on this server
// (Pocket's, the terminal's, code-server's) knows how to create a project and what "save it to my files" means.
// A skill is installed while its feature is on and removed when it is turned off. Pocket only writes or removes a
// folder that carries its marker file, so a user's own skill of the same name is never touched. POCKET_SKILLS=0 turns
// installation off entirely (the test suite does).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MARKER = '.pocket-managed';
export const SKILLS = [
  { name: 'pocket-projects', feature: 'projects', cli: 'board', manual: 'projects.md' },
  { name: 'pocket-files', feature: 'documents', cli: 'docs', manual: 'files.md' },
  { name: 'pocket-tasks', feature: 'tasks', cli: 'tasks', manual: 'tasks.md' }, // 1.36
  { name: 'pocket-vault', feature: 'vault', cli: 'vault', manual: 'vault.md' }, // 1.39
  { name: 'pocket-inbox', feature: 'inbox', cli: 'inbox', manual: 'inbox-watch.md' }, // 1.69: Inbox Watch
  { name: 'pocket-coord', feature: 'coordination', cli: 'coord', manual: 'coordination.md' }, // 1.99
  // 1.59: Gmail, Calendar and Drive through each agent's own connectors (Settings → Connectors). Always on; one file per agent.
  { name: 'pocket-google', feature: null, files: { claude: 'SKILL.claude.md', codex: 'SKILL.codex.md' }, manual: 'google.md' },
];
const BIN = { board: 'pocket-board', docs: 'pocket-docs', tasks: 'pocket-tasks', vault: 'pocket-vault', inbox: 'pocket-inbox', coord: 'pocket-coord' };
const SRC = path.join(import.meta.dirname, 'skills');

// Claude Code's user skills folder always; Codex's only where Codex is installed for this user.
export const codexSkillRoot = (env = process.env) => path.join(env.CODEX_HOME || path.join(env.HOME || os.homedir(), '.codex'), 'skills');
export function skillRoots(env = process.env) {
  const home = env.HOME || os.homedir();
  const roots = [path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'skills')];
  const codex = codexSkillRoot(env);
  if (fs.existsSync(path.dirname(codex))) roots.push(codex);
  return roots;
}

// 1.73.8: a path as one shell word: as it is when it is plain, single-quoted otherwise (an install under a folder with a
// space, common on macOS, used to give agents a command that did not run).
export const shellArg = p => /^[A-Za-z0-9_./:@%+,=-]+$/.test(String(p)) ? String(p) : `'${String(p).replace(/'/g, `'\\''`)}'`;
// The repository copy names `pocket-board` / `pocket-docs`; the installed copy says how to run them on this server.
export function renderSkill(text, command, binName) {
  const block = `<!-- pocket:commands -->\nOn this server, run \`${binName}\` as \`node ${shellArg(command)}\`. Wherever this skill writes \`${binName}\`, use that command.\n<!-- /pocket:commands -->`;
  return text.replace(/<!-- pocket:commands -->[\s\S]*?<!-- \/pocket:commands -->/, block);
}

// 1.80: the repository copy names the manual page relative to the Pocket Code directory; the installed copy gives its path.
export function renderManual(text, file) {
  const block = `<!-- pocket:manual -->\nHow this feature works, how it is set up and its limits: the Pocket Code manual, \`${file}\`.\n<!-- /pocket:manual -->`;
  return text.replace(/<!-- pocket:manual -->[\s\S]*?<!-- \/pocket:manual -->/, block);
}

// 1.80: the instruction line that points every agent Pocket starts at the manual, so "how do I…" questions about Pocket are answered from it.
export function manualInstructions(src = SRC) {
  return `Pocket Code's manual is at \`${path.join(path.dirname(src), 'docs', 'manual', 'README.md')}\`: when the user asks how a Pocket feature works or how to set it up, read that index and the feature's page instead of the source.`;
}

// 1.68: the per-turn line that points each agent at its pocket-google file. Sent on every turn, so it reaches
// installs that keep Pocket's skills out of the agent folders (POCKET_SKILLS=0, e.g. a Codex home shared with a chat app).
export function googleInstructions(provider, src = SRC) {
  const file = path.join(src, 'pocket-google', provider === 'codex' ? 'SKILL.codex.md' : 'SKILL.claude.md');
  const via = provider === 'codex' ? 'the Codex apps (Gmail, Google Calendar, Google Drive)' : 'the Claude connectors (Gmail, Google Calendar, Google Drive)';
  return `For the user's email, calendar or Google Drive, use ${via} connected in Settings → Connectors; the pocket-google skill (\`${file}\`) has the full procedure. Check once whose Google account is connected. Write every email as a Gmail draft and show it first; send it when the user says so, and never refuse a send they ask for. Ask before sending calendar invitations to other people.`;
}

// codexRoots: which of `roots` are Codex's; a skill with `files` installs that agent's own SKILL file.
export function syncSkills({ settings, commands, env = process.env, roots = skillRoots(env), codexRoots = [codexSkillRoot(env)], src = SRC, log = () => {} }) {
  const result = { installed: [], removed: [], skipped: [] };
  if (env.POCKET_SKILLS === '0') return result;
  for (const root of roots) for (const s of SKILLS) {
    const dir = path.join(root, s.name), mark = path.join(dir, MARKER), ours = fs.existsSync(mark);
    const srcFile = s.files ? s.files[codexRoots.includes(root) ? 'codex' : 'claude'] : 'SKILL.md';
    try {
      if (srcFile && (s.feature === null || settings[s.feature])) {
        if (fs.existsSync(dir) && !ours) { result.skipped.push(dir); log(`skill ${dir} exists and is not Pocket's; left alone`); continue; }
        const text = fs.readFileSync(path.join(src, s.name, srcFile), 'utf8');
        const cmd = s.cli ? renderSkill(text, commands[s.cli], BIN[s.cli]) : text;
        const body = s.manual ? renderManual(cmd, path.join(path.dirname(src), 'docs', 'manual', s.manual)) : cmd;
        const file = path.join(dir, 'SKILL.md');
        if (ours && (() => { try { return fs.readFileSync(file, 'utf8') === body; } catch { return false; } })()) continue;
        fs.mkdirSync(dir, { recursive: true });
        // 1.73.8: the marker first, so a failure before the skill file is written leaves a folder Pocket still owns and repairs next time.
        fs.writeFileSync(mark, `Installed by Pocket Code from ${path.join(src, s.name)}.\nPocket rewrites this folder when it starts and removes it when the feature is turned off; edit the source instead.\n`);
        fs.writeFileSync(file + '.tmp', body); fs.renameSync(file + '.tmp', file);
        result.installed.push(dir);
      } else if (ours) {
        fs.rmSync(dir, { recursive: true, force: true });
        result.removed.push(dir);
      }
    } catch (e) { log(`skill ${dir}: ${e.message}`); }
  }
  if (result.installed.length || result.removed.length) log(`skills: installed ${result.installed.length}, removed ${result.removed.length}`);
  return result;
}

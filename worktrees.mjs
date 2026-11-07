// 1.98: the worktrees of a repository, and removing one. The only place Pocket changes a repository: workspace.mjs stays
// read-only. Removal runs `git worktree remove` with no --force and never touches the branch, and every check is made again
// at the moment of removal. When a check can't answer, the worktree stays.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const exec = promisify(execFile);
const DAY = 86_400_000, IN_USE_MS = DAY, IDLE_MS = 14 * DAY, STATUS_MS = 60_000, PROCESSES_MS = 5000, SHOWN_IGNORED = 40;
// Ignored files a rebuild brings back. Anything else ignored (.env, data folders) is named before it goes.
const REBUILDABLE = /(^|\/)(node_modules|dist|build|out|\.next|\.nuxt|\.svelte-kit|\.astro|\.cache|\.turbo|\.parcel-cache|\.vite|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.venv|venv|target|coverage|\.gradle|\.DS_Store)(\/|$)/;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

async function git(cwd, args, timeout = 8000) {
  return (await exec('git', ['--no-pager', ...args], { cwd, timeout, maxBuffer: 8 << 20, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } })).stdout;
}
const yes = async (cwd, args) => { try { await git(cwd, args); return true; } catch { return false; } };

export function parseWorktrees(text) {
  const rows = [];
  for (const block of text.split(/\n\n+/)) {
    const row = {};
    for (const line of block.split('\n')) {
      const [key, ...rest] = line.split(' '), value = rest.join(' ');
      if (key === 'worktree') row.path = value;
      else if (key === 'HEAD') row.head = value;
      else if (key === 'branch') row.branch = value.replace(/^refs\/heads\//, '');
      else if (key === 'locked') { row.locked = true; row.lockReason = value; }
      else if (key === 'prunable' || key === 'bare') row[key] = true;
    }
    if (row.path) rows.push(row);
  }
  rows.forEach((r, i) => { r.main = i === 0; });
  return rows;
}

export function parseStatus(raw) {
  const out = { changes: 0, ignored: [] };
  const fields = raw.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]; if (!f) continue;
    const code = f.slice(0, 2), name = f.slice(3);
    if (code === '!!') out.ignored.push(name); else out.changes++;
    if (code[0] === 'R' || code[0] === 'C') i++; // a rename carries its old name in the next field
  }
  return out;
}

// Which group a row belongs to. `usage` is what the server knows: running conversations, a process, recent activity.
export function classify({ row, status, usage = {}, now = Date.now() }) {
  const running = usage.running?.length, lastAt = usage.lastAt || 0;
  if (running) return { group: 'use', reason: 'A conversation is running here' };
  if (usage.self) return { group: 'use', reason: 'Pocket runs from here' };
  if (usage.processes) return { group: 'use', reason: 'A program is running here' };
  if (lastAt && now - lastAt < IN_USE_MS) return { group: 'use', reason: 'Used in the last 24 hours' };
  if (row.locked) return { group: 'work', reason: 'Locked' };
  if (status.changes) return { group: 'work', reason: `${status.changes} uncommitted ${status.changes === 1 ? 'change' : 'changes'}` };
  if (!status.safe) return { group: 'work', reason: 'Commits not safe elsewhere' };
  if (lastAt && now - lastAt < IDLE_MS) return { group: 'work', reason: `Used ${Math.max(1, Math.floor((now - lastAt) / DAY))} days ago` };
  return { group: 'ready', reason: status.safe };
}

export class Worktrees {
  constructor({ home, selfDirs = [], gh = 'gh', logFile = '', log = () => { }, usage = async () => ({}), processes }) {
    Object.assign(this, { home, gh, logFile, log, usage });
    const real = d => { try { return fs.realpathSync(d); } catch { return path.resolve(d); } };
    this.allowed = real(home); this.selfDirs = selfDirs.map(real);
    this.scan = processes || scanProcesses; this.statuses = new Map(); this.safeHeads = new Map(); this.seen = { at: 0, dirs: [] };
  }
  inside(p) { return p === this.allowed || p.startsWith(this.allowed + path.sep); }
  holds(dir, p) { return p === dir || p.startsWith(dir + path.sep); }

  async list(cwd) {
    const rows = parseWorktrees(await git(cwd, ['worktree', 'list', '--porcelain']));
    return rows.filter(r => !r.prunable && !r.bare && this.inside(r.path));
  }
  // A path from a client counts only if git lists it as a worktree of the repository it is in.
  async find(p) {
    let real; try { real = fs.realpathSync(String(p || '')); } catch { throw fail('That folder no longer exists.', 404); }
    if (!this.inside(real)) throw fail('That folder is outside this instance’s home directory.', 403);
    let rows; try { rows = await this.list(real); } catch { throw fail('That folder is not a Git worktree.', 404); }
    const row = rows.find(r => r.path === real);
    if (!row) throw fail('That folder is not a worktree of this repository.', 404);
    return { row, rows };
  }

  async defaultRef(cwd) {
    try { return (await git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim(); } catch { /* not set */ }
    for (const ref of ['origin/main', 'origin/master', 'main', 'master']) if (await yes(cwd, ['rev-parse', '--verify', '-q', ref])) return ref;
    return null;
  }
  // `git branch --merged` won't do: a squash merge never looks merged. Each answer that says "safe" is about one commit, so it keeps.
  async safeElsewhere(row, mainPath) {
    if (this.safeHeads.has(row.head)) return this.safeHeads.get(row.head);
    const ref = await this.defaultRef(mainPath);
    let how = null;
    if (ref && ref !== row.branch && await yes(mainPath, ['merge-base', '--is-ancestor', row.head, ref])) how = `In ${ref}`;
    if (!how) try { if ((await git(mainPath, ['branch', '-r', '--contains', row.head])).trim()) how = 'On a remote branch'; } catch { /* unknown is not safe */ }
    if (!how && row.branch) try {
      const { stdout } = await exec(this.gh, ['pr', 'list', '--head', row.branch, '--state', 'merged', '--json', 'number,headRefOid', '--limit', '20'], { cwd: row.path, timeout: 10_000, encoding: 'utf8' });
      const pr = JSON.parse(stdout).find(p => p.headRefOid === row.head);
      if (pr) how = `Merged in PR #${pr.number}`;
    } catch { /* gh missing or failing: it stays in Has work */ }
    if (how) { this.safeHeads.set(row.head, how); if (this.safeHeads.size > 2000) this.safeHeads.delete(this.safeHeads.keys().next().value); }
    return how;
  }

  async processesIn(dir) {
    if (Date.now() - this.seen.at > PROCESSES_MS) this.seen = { at: Date.now(), dirs: await this.scan() };
    return this.seen.dirs.filter(d => this.holds(dir, d)).length;
  }

  async inspect(row, rows) {
    const main = rows.find(r => r.main)?.path || row.path;
    const raw = await git(row.path, ['status', '--porcelain=v1', '-z', '--ignored=matching']);
    const at = Number((await git(row.path, ['log', '-1', '--format=%ct']).catch(() => '0')).trim()) * 1000;
    return { ...parseStatus(raw), lastCommitAt: at || null, safe: await this.safeElsewhere(row, main) };
  }
  async usageOf(row) {
    const u = await this.usage(row.path);
    return { ...u, processes: await this.processesIn(row.path), self: this.selfDirs.some(d => this.holds(row.path, d)) };
  }

  // One row for the panel, read when it comes into view, four at a time. Cached for a minute.
  async status(p) {
    const { row, rows } = await this.find(p);
    const hit = this.statuses.get(row.path);
    if (hit && hit.head === row.head && Date.now() - hit.at < STATUS_MS) return hit.value;
    const [status, usage] = await Promise.all([this.inspect(row, rows), this.usageOf(row)]);
    const value = { path: row.path, branch: row.branch || null, head: row.head, locked: Boolean(row.locked), lastCommitAt: status.lastCommitAt, conversations: usage.conversations || [], ...classify({ row, status, usage }) };
    this.statuses.set(row.path, { at: Date.now(), head: row.head, value });
    if (this.statuses.size > 500) this.statuses.delete(this.statuses.keys().next().value);
    return value;
  }

  // What removing it would mean, from nothing cached. The sheet shows this, and removal repeats it.
  async plan(p) {
    const { row, rows } = await this.find(p);
    this.seen.at = 0; this.safeHeads.delete(row.head);
    const [status, usage] = await Promise.all([this.inspect(row, rows), this.usageOf(row)]);
    const verdict = classify({ row, status, usage });
    const refused = row.main ? 'This is the repository’s main checkout.'
      : row.locked ? `This worktree is locked${row.lockReason ? `: ${row.lockReason}` : '.'}`
        : verdict.group === 'ready' ? null : `${verdict.reason}.`;
    const named = status.ignored.filter(f => !REBUILDABLE.test(f)).sort();
    const started = usage.started || [];
    const check = createHash('sha256').update(JSON.stringify([row.path, row.head, row.branch, named, started.map(c => c.id)])).digest('hex').slice(0, 24);
    return { path: row.path, branch: row.branch || null, head: row.head, main: rows.find(r => r.main)?.path, refused, ignored: named.slice(0, SHOWN_IGNORED), ignoredMore: Math.max(0, named.length - SHOWN_IGNORED), rebuildable: status.ignored.length - named.length, started, check };
  }

  async remove(p, check) {
    const plan = await this.plan(p);
    if (plan.refused) throw fail(plan.refused, 409);
    if (plan.check !== check) throw fail('This worktree changed since you opened this. Check it again.', 409);
    try { await git(plan.main, ['worktree', 'remove', plan.path], 60_000); }
    catch (e) { throw fail(String(e.stderr || e.message).trim().split('\n')[0].replace(/^fatal: /, '') || 'Git could not remove this worktree.', 409); }
    this.statuses.delete(plan.path);
    const entry = { at: new Date().toISOString(), path: plan.path, branch: plan.branch, commit: plan.head, repository: plan.main };
    this.log(`worktree removed path=${plan.path} branch=${plan.branch || '(detached)'} commit=${plan.head}`);
    if (this.logFile) fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
    return entry;
  }
}

// The working folder of every process we can see. Pocket's own git and gh children are its checks, not someone using the folder.
async function scanProcesses() {
  const dirs = [];
  for (const pid of fs.readdirSync('/proc').filter(n => /^\d+$/.test(n))) {
    try {
      if (Number(pid) === process.pid) continue;
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      if (Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]) === process.pid) continue;
      dirs.push(fs.readlinkSync(`/proc/${pid}/cwd`).replace(/ \(deleted\)$/, ''));
    } catch { /* gone, or not ours to read */ }
  }
  return dirs;
}

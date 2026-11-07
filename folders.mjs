// 1.97: which folders a conversation has worked in. Read-only. The transcript says it, in a different way per engine:
//   Claude: every line carries `cwd`, and Edit/Write/MultiEdit/NotebookEdit calls carry `file_path`.
//   Codex:  the session folder never changes; `workdir` in each exec call and the paths in patches say where it worked.
//   OpenRouter: not read. It stays on its starting folder.
// Reads are incremental: a file is read from where the last read stopped, so a conversation that is open costs a stat.
import fs from 'node:fs';
import path from 'node:path';

const MAX_LINE = 8 * 1024 * 1024, PARSE_LINE = 512 * 1024, MAX_DIRS = 300, MAX_FILES = 500, SHOWN = 6, FRESH_MS = 3000;
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const WORKDIR = /\bworkdir["']?\s*:\s*(["'`])(\/[^"'`\\\n]*)\1/g;
const PATCHED = /\*\*\* (?:Update|Add|Delete) File: ([^\n\\]+?)\s*(?:\\n|\n|$)/g;

const newAcc = () => ({ used: new Map(), edits: new Map(), at: 0, last: '' });
function mark(map, dir, at) {
  map.delete(dir); map.set(dir, at);
  if (map.size > MAX_DIRS) map.delete(map.keys().next().value);
}
// A line with no time still comes after the one before it.
const stamp = (acc, o) => { const t = Date.parse(o?.timestamp); acc.at = Number.isFinite(t) ? t : acc.at + 1; return acc.at; };
const absolute = (p, base) => {
  if (typeof p !== 'string' || !p) return null;
  if (path.isAbsolute(p)) return path.normalize(p);
  return base ? path.resolve(base, p) : null;
};
function used(acc, dir, at) { if (dir) { mark(acc.used, dir, at); acc.last = dir; } }
function edited(acc, file, at) { if (file) mark(acc.edits, path.dirname(file), at); }

export function scanClaudeLine(line, acc) {
  if (line.length > PARSE_LINE) { // a pasted image or a snapshot: only the folder is worth having
    const m = line.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
    if (m) try { used(acc, absolute(JSON.parse(`"${m[1]}"`)), acc.at); } catch { /* not a folder */ }
    return;
  }
  let o; try { o = JSON.parse(line); } catch { return; }
  const at = stamp(acc, o), cwd = absolute(o?.cwd);
  used(acc, cwd, at);
  if (o?.type !== 'assistant' || !Array.isArray(o.message?.content)) return;
  for (const b of o.message.content) if (b?.type === 'tool_use' && EDITS.has(b.name)) edited(acc, absolute(b.input?.file_path ?? b.input?.notebook_path, cwd), at);
}

function scanCodexText(text, acc, at) {
  for (const m of text.matchAll(WORKDIR)) used(acc, path.normalize(m[2]), at);
  for (const m of text.matchAll(PATCHED)) edited(acc, absolute(m[1], acc.last), at);
}
export function scanCodexLine(line, acc) {
  if (line.length > PARSE_LINE || !/workdir|File: |"cwd"/.test(line)) return;
  let o; try { o = JSON.parse(line); } catch { return; }
  const at = stamp(acc, o), p = o?.payload;
  if (!p) return;
  if ((o.type === 'session_meta' || o.type === 'turn_context') && !acc.last) acc.last = absolute(p.cwd) || p?.meta?.cwd || '';
  if (o.type !== 'response_item') return;
  if (p.type === 'custom_tool_call' && typeof p.input === 'string') scanCodexText(p.input, acc, at);
  if (p.type === 'function_call' && typeof p.arguments === 'string') {
    try { const a = JSON.parse(p.arguments); used(acc, absolute(a.workdir), at); if (typeof a.input === 'string') scanCodexText(a.input, acc, at); } catch { /* not ours */ }
  }
}

async function eachLine(file, start, end, onLine) {
  let parts = [], held = 0, done = start, pos = start;
  for await (const chunk of fs.createReadStream(file, { start, end: end - 1, highWaterMark: 1 << 20 })) {
    let from = 0, nl;
    while ((nl = chunk.indexOf(10, from)) !== -1) {
      const part = chunk.subarray(from, nl);
      if (held + part.length <= MAX_LINE) onLine(Buffer.concat([...parts, part]).toString('utf8'));
      parts = []; held = 0; from = nl + 1; done = pos + from;
    }
    const rest = chunk.subarray(from);
    if (held + rest.length <= MAX_LINE) parts.push(Buffer.from(rest));
    held += rest.length; pos += chunk.length;
  }
  return done; // a line still being written waits for the next read
}

export class FolderReader {
  constructor({ home }) { this.home = home; this.files = new Map(); this.reading = new Map(); this.described = new Map(); }

  inside(real) { const h = this.homeReal ??= fs.realpathSync(this.home); return real === h || real.startsWith(h + path.sep); }

  // The nearest folder at or above `dir` holding a .git, inside home. No git process: this runs for every folder listed.
  repoOf(dir) {
    let real = null;
    for (let d = dir; ; d = path.dirname(d)) {
      try { real = fs.realpathSync(d); break; } catch { if (d === path.dirname(d)) return null; }
    }
    if (!this.inside(real)) return null;
    for (let r = real; this.inside(r); r = path.dirname(r)) {
      const head = readHead(r);
      if (head) return { root: r, real, ...head };
      if (r === path.dirname(r)) break;
    }
    return null;
  }

  async read(file, kind) {
    if (this.reading.has(file)) return this.reading.get(file);
    const work = (async () => {
      const size = (await fs.promises.stat(file)).size;
      let c = this.files.get(file);
      if (!c || size < c.offset) c = { offset: 0, acc: newAcc() }; // a rewritten file starts over
      this.files.delete(file); this.files.set(file, c);
      if (this.files.size > MAX_FILES) this.files.delete(this.files.keys().next().value);
      if (size > c.offset) { const scan = kind === 'codex' ? scanCodexLine : scanClaudeLine; c.offset = await eachLine(file, c.offset, size, l => scan(l, c.acc)); }
      return c.acc;
    })().finally(() => this.reading.delete(file));
    this.reading.set(file, work);
    return work;
  }

  describe(acc, start) {
    const roots = new Map(), memo = new Map();
    const repo = dir => { if (!memo.has(dir)) memo.set(dir, this.repoOf(dir)); return memo.get(dir); };
    const add = (dir, at, isEdit) => {
      const r = repo(dir); if (!r) return;
      let e = roots.get(r.root);
      if (!e) roots.set(r.root, e = { path: null, root: r.root, branch: r.branch, isWorktree: r.isWorktree, lastUsedAt: 0, lastEditAt: 0, pathAt: -1 });
      if (isEdit) e.lastEditAt = Math.max(e.lastEditAt, at);
      else if (at >= e.pathAt) { e.path = r.real; e.pathAt = at; }
      e.lastUsedAt = Math.max(e.lastUsedAt, at);
    };
    if (start) add(start, 0, false);
    for (const [dir, at] of acc.used) add(dir, at, false);
    for (const [dir, at] of acc.edits) add(dir, at, true);
    const all = [...roots.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    const best = key => all.filter(e => e[key] > 0).sort((a, b) => b[key] - a[key])[0];
    const startRoot = start ? repo(start)?.root : null;
    const active = best('lastEditAt') || best('lastUsedAt') || all.find(e => e.root === startRoot) || null;
    const shown = all.slice(0, SHOWN);
    if (active && !shown.includes(active)) shown[shown.length - 1] = active;
    const folders = shown.map(({ pathAt, lastEditAt, ...e }) => ({ ...e, path: e.path || e.root, source: lastEditAt ? 'edit' : e.lastUsedAt ? 'cwd' : 'start' }));
    return { start: start || null, active: active?.root || null, activePath: active ? (active.path || active.root) : start || null, repo: Boolean(active), folders };
  }

  // Never throws for a transcript it can't read: the conversation falls back to its starting folder.
  async folders({ id, file, kind, start }) {
    const hit = this.described.get(id);
    if (hit && hit.start === start && Date.now() - hit.at < FRESH_MS) return hit.value;
    let acc = newAcc();
    if (file) try { acc = await this.read(file, kind); } catch { /* the starting folder stands */ }
    const value = this.describe(acc, start);
    this.described.delete(id); this.described.set(id, { at: Date.now(), start, value });
    if (this.described.size > MAX_FILES) this.described.delete(this.described.keys().next().value);
    return value;
  }
}

function readHead(root) {
  const dotgit = path.join(root, '.git');
  try {
    let gitdir = dotgit;
    if (fs.statSync(dotgit).isFile()) {
      const m = fs.readFileSync(dotgit, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m);
      if (!m) return null;
      gitdir = path.resolve(root, m[1]);
    }
    const head = fs.readFileSync(path.join(gitdir, 'HEAD'), 'utf8').trim();
    return { branch: head.match(/^ref: refs\/heads\/(.+)$/)?.[1] || 'Detached HEAD', isWorktree: /[\\/]worktrees[\\/][^\\/]+$/.test(gitdir) };
  } catch { return null; }
}

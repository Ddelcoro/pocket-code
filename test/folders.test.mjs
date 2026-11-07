// 1.97: which folders a conversation worked in. One fixture per engine stands guard over the transcript shapes, which
// belong to the CLIs and can change. Real git repositories, real worktrees, no git process in the reader.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FolderReader } from '../folders.mjs';

const git = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
function setup(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'folders-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const repo = name => { const d = path.join(home, name); fs.mkdirSync(path.join(d, 'src'), { recursive: true }); git(d, 'init', '-q', '-b', 'main'); git(d, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x'); return d; };
  const write = (name, lines) => { const f = path.join(home, name); fs.writeFileSync(f, lines.map(l => JSON.stringify(l)).join('\n') + '\n'); return f; };
  return { home, repo, write, reader: new FolderReader({ home }), scratch: fs.mkdirSync(path.join(home, 'scratch'), { recursive: true }) };
}
const at = n => new Date(Date.UTC(2026, 10, 7, 12, n)).toISOString();
const claudeEdit = (cwd, file, n) => ({ type: 'assistant', cwd, timestamp: at(n), message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }] } });
const codexExec = (dir, n) => ({ type: 'response_item', timestamp: at(n), payload: { type: 'custom_tool_call', name: 'exec', input: `await tools.exec_command({cmd:"ls", workdir:"${dir}"})` } });
const codexPatch = (file, n) => ({ type: 'response_item', timestamp: at(n), payload: { type: 'custom_tool_call', name: 'exec', input: `await tools.apply_patch("*** Begin Patch\\n*** Update File: ${file}\\n@@\\n-a\\n+b\\n*** End Patch")` } });

test('Claude: the last edit wins over the folder it finished reading in', async t => {
  const s = setup(t), a = s.repo('alpha'), b = s.repo('beta');
  const file = s.write('c.jsonl', [
    { type: 'user', cwd: s.home, timestamp: at(1) },
    claudeEdit(a, 'src/one.js', 2),
    { type: 'user', cwd: b, timestamp: at(3) },
  ]);
  const f = await s.reader.folders({ id: 'c', file, kind: 'claude', start: s.home });
  assert.equal(f.active, a, 'a relative path resolves against the line\'s folder');
  assert.deepEqual(f.folders.map(x => x.root), [b, a], 'newest first');
  assert.equal(f.folders[1].source, 'edit'); assert.equal(f.folders[1].branch, 'main'); assert.equal(f.repo, true);
});

test('Claude: with no edit, the newest folder in a repository; a folder outside any repository is skipped', async t => {
  const s = setup(t), a = s.repo('alpha');
  const file = s.write('c.jsonl', [{ type: 'user', cwd: a, timestamp: at(1) }, { type: 'user', cwd: path.join(s.home, 'scratch'), timestamp: at(2) }]);
  const f = await s.reader.folders({ id: 'c', file, kind: 'claude', start: s.home });
  assert.equal(f.active, a); assert.equal(f.folders.length, 1);
});

test('Codex: workdir and patch paths say where it worked; the session folder never moves', async t => {
  const s = setup(t), a = s.repo('alpha'), b = s.repo('beta');
  const file = s.write('x.jsonl', [
    { type: 'session_meta', timestamp: at(0), payload: { cwd: s.home } },
    codexExec(a, 1),
    codexPatch(path.join(a, 'src/one.js'), 2),
    codexExec(b, 3),
  ]);
  const f = await s.reader.folders({ id: 'cx:1', file, kind: 'codex', start: s.home });
  assert.equal(f.active, a); assert.deepEqual(f.folders.map(x => x.root).sort(), [a, b].sort());
});

test('Codex: the older function_call shape still reads, and a workdir that is an expression is skipped', async t => {
  const s = setup(t), a = s.repo('alpha');
  const file = s.write('x.jsonl', [
    { type: 'response_item', timestamp: at(1), payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['ls'], workdir: a }) } },
    { type: 'response_item', timestamp: at(2), payload: { type: 'custom_tool_call', name: 'exec', input: 'tools.exec_command({cmd:"ls", workdir: base + "/x"})' } },
  ]);
  const f = await s.reader.folders({ id: 'cx:2', file, kind: 'codex', start: s.home });
  assert.equal(f.active, a); assert.equal(f.folders.length, 1);
});

test('a worktree is recognised, with its own branch, and a missing folder walks up to the repository', async t => {
  const s = setup(t), a = s.repo('alpha'), w = path.join(s.home, 'trees/feature');
  git(a, 'worktree', 'add', '-q', '-b', 'feat/x', w);
  const file = s.write('c.jsonl', [{ type: 'user', cwd: path.join(w, 'gone/already'), timestamp: at(1) }]);
  const f = await s.reader.folders({ id: 'c', file, kind: 'claude', start: s.home });
  assert.equal(f.active, w); assert.equal(f.folders[0].branch, 'feat/x'); assert.equal(f.folders[0].isWorktree, true);
});

test('a detached HEAD reads as such, and a repository outside home is not listed', async t => {
  const s = setup(t), a = s.repo('alpha'), other = setup(t), out = other.repo('outside');
  git(a, 'checkout', '-q', '--detach');
  const file = s.write('c.jsonl', [{ type: 'user', cwd: out, timestamp: at(1) }, { type: 'user', cwd: a, timestamp: at(2) }]);
  const f = await s.reader.folders({ id: 'c', file, kind: 'claude', start: s.home });
  assert.deepEqual(f.folders.map(x => x.root), [a]); assert.equal(f.folders[0].branch, 'Detached HEAD');
});

test('a transcript that cannot be read falls back to the starting folder; so does a bad line', async t => {
  const s = setup(t), a = s.repo('alpha');
  let f = await s.reader.folders({ id: 'none', file: path.join(s.home, 'missing.jsonl'), kind: 'claude', start: a });
  assert.equal(f.active, a); assert.equal(f.folders[0].source, 'start');
  const bad = path.join(s.home, 'bad.jsonl'); fs.writeFileSync(bad, 'not json\n{"half":\n');
  f = await s.reader.folders({ id: 'bad', file: bad, kind: 'codex', start: a });
  assert.equal(f.active, a);
  f = await s.reader.folders({ id: 'plain', file: null, kind: 'acp', start: path.join(s.home, 'scratch') });
  assert.equal(f.active, null); assert.equal(f.repo, false); assert.equal(f.activePath, path.join(s.home, 'scratch'));
});

test('reads carry on from where they stopped, wait for a half-written line, and start over if the file shrinks', async t => {
  const s = setup(t), a = s.repo('alpha'), b = s.repo('beta'), file = s.write('c.jsonl', [{ type: 'user', cwd: a, timestamp: at(1) }]);
  const acc = await s.reader.read(file, 'claude'), first = s.reader.files.get(file).offset;
  assert.equal(first, fs.statSync(file).size); assert.deepEqual([...acc.used.keys()], [a]);
  const line = JSON.stringify({ type: 'user', cwd: b, timestamp: at(2) });
  fs.appendFileSync(file, line.slice(0, 10));
  await s.reader.read(file, 'claude');
  assert.equal(s.reader.files.get(file).offset, first, 'an unfinished line is left for the next read');
  fs.appendFileSync(file, line.slice(10) + '\n');
  assert.deepEqual([...(await s.reader.read(file, 'claude')).used.keys()], [a, b]);
  fs.writeFileSync(file, JSON.stringify({ type: 'user', cwd: b, timestamp: at(3) }) + '\n');
  assert.deepEqual([...(await s.reader.read(file, 'claude')).used.keys()], [b], 'a rewritten file is read fresh');
});

test('a very long line doesn\'t stop the read, and non-ASCII across a chunk boundary stays whole', async t => {
  const s = setup(t), a = s.repo('alpha'), ü = path.join(s.home, 'projekt-ü'); fs.renameSync(s.repo('tmp'), ü);
  const big = 'é'.repeat(700_000);
  const file = s.write('c.jsonl', [{ type: 'user', cwd: a, timestamp: at(1), blob: big }, { type: 'user', cwd: ü, timestamp: at(2) }]);
  const f = await s.reader.folders({ id: 'c', file, kind: 'claude', start: s.home });
  assert.deepEqual(f.folders.map(x => x.root).sort(), [a, ü].sort());
});

test('up to six repositories are listed, and the active one is always among them', async t => {
  const s = setup(t), r = Array.from({ length: 8 }, (_, i) => s.repo('r' + i));
  const file = s.write('c.jsonl', [claudeEdit(r[0], path.join(r[0], 'a.js'), 1), ...r.slice(1).map((d, i) => ({ type: 'user', cwd: d, timestamp: at(i + 2) }))]);
  const f = await s.reader.folders({ id: 'c', file, kind: 'claude', start: s.home });
  assert.equal(f.folders.length, 6); assert.equal(f.active, r[0]); assert.ok(f.folders.some(x => x.root === r[0]));
});

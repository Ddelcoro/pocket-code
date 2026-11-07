// 1.98: worktree grouping and removal, on real repositories with a real remote. `gh` is a small script so a merged PR, a
// failing gh and a missing gh can each be tried.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Worktrees, classify, parseWorktrees, parseStatus } from '../worktrees.mjs';

const git = (cwd, ...a) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const commit = (cwd, name) => { fs.writeFileSync(path.join(cwd, name), name); git(cwd, 'add', name); git(cwd, 'commit', '-q', '-m', name); return git(cwd, 'rev-parse', 'HEAD'); };
function setup(t, opts = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worktrees-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const remote = path.join(home, 'remote.git'), main = path.join(home, 'repo');
  git(home, 'init', '-q', '--bare', '-b', 'main', remote); git(home, 'init', '-q', '-b', 'main', main);
  fs.writeFileSync(path.join(main, '.gitignore'), '.env\nnode_modules/\ndata/\n'); git(main, 'add', '.gitignore'); commit(main, 'a.txt');
  git(main, 'remote', 'add', 'origin', remote); git(main, 'push', '-q', '-u', 'origin', 'main'); git(main, 'remote', 'set-head', 'origin', 'main');
  const add = (name, branch = 'feat/' + name) => { const d = path.join(home, 'trees', name); git(main, 'worktree', 'add', '-q', '-b', branch, d); return d; };
  const log = path.join(home, 'removed.jsonl');
  const usage = {}; // path -> what the server would say
  const w = new Worktrees({ home, logFile: log, gh: opts.gh || '/nonexistent/gh', processes: async () => opts.procs || [], usage: async p => usage[p] || {}, selfDirs: opts.self ? [opts.self(home)] : [] });
  return { home, main, add, w, usage, log };
}
const fakeGh = (home, body) => { const f = path.join(home, 'gh'); fs.writeFileSync(f, '#!/bin/sh\n' + body + '\n', { mode: 0o755 }); return f; };

test('porcelain and status parse, renames and a locked reason included', () => {
  const rows = parseWorktrees('worktree /a\nHEAD 1\nbranch refs/heads/main\n\nworktree /b\nHEAD 2\ndetached\nlocked moved to a USB drive\n\nworktree /c\nHEAD 3\nbranch refs/heads/x\nprunable gitdir file points to non-existent location\n');
  assert.deepEqual(rows.map(r => [r.path, r.main, r.branch]), [['/a', true, 'main'], ['/b', false, undefined], ['/c', false, 'x']]);
  assert.equal(rows[1].lockReason, 'moved to a USB drive'); assert.equal(rows[2].prunable, true);
  assert.deepEqual(parseStatus('R  new\0old\0 M a\0?? b\0!! .env\0'), { changes: 3, ignored: ['.env'] });
});

test('grouping follows the plan: in use beats has work beats ready', () => {
  const row = { path: '/w' }, now = Date.now(), clean = { changes: 0, safe: 'In origin/main' };
  assert.equal(classify({ row, status: clean, now }).group, 'ready');
  assert.equal(classify({ row, status: clean, usage: { lastAt: now - 3600_000 }, now }).group, 'use');
  assert.equal(classify({ row, status: { changes: 2, safe: 'x' }, usage: { processes: 1 }, now }).group, 'use');
  assert.match(classify({ row, status: clean, usage: { lastAt: now - 5 * 86_400_000 }, now }).reason, /Used 5 days ago/);
  assert.equal(classify({ row, status: { changes: 1, safe: 'x' }, now }).group, 'work');
  assert.equal(classify({ row, status: { changes: 0, safe: null }, now }).group, 'work');
  assert.equal(classify({ row: { path: '/w', locked: true }, status: clean, now }).group, 'work');
  assert.equal(classify({ row, status: clean, usage: { lastAt: now - 15 * 86_400_000 }, now }).group, 'ready');
});

test('safe elsewhere: on the default branch, on a remote branch, or a merged PR with this exact commit', async t => {
  const s = setup(t);
  const inMain = s.add('merged'); assert.match((await s.w.status(inMain)).reason, /In origin\/main/);
  const pushed = s.add('pushed'); commit(pushed, 'p.txt'); git(pushed, 'push', '-q', 'origin', 'HEAD');
  assert.equal((await s.w.status(pushed)).reason, 'On a remote branch');
  const local = s.add('local'); commit(local, 'l.txt');
  const r = await s.w.status(local); assert.equal(r.group, 'work'); assert.equal(r.reason, 'Commits not safe elsewhere', 'gh missing: it stays');
});

test('a squash-merged branch needs the PR head to be this exact commit, and a failing gh keeps the worktree', async t => {
  const s = setup(t), d = s.add('squashed'), head = commit(d, 's.txt');
  const ask = async body => { s.w.gh = fakeGh(s.home, body); s.w.statuses.clear(); s.w.safeHeads.clear(); return s.w.status(d); };
  assert.equal((await ask(`echo '[{"number":7,"headRefOid":"${head}"}]'`)).reason, 'Merged in PR #7');
  assert.equal((await ask(`echo '[{"number":7,"headRefOid":"0000"}]'`)).group, 'work', 'a later commit on the branch is not covered');
  assert.equal((await ask('exit 1')).group, 'work');
  assert.equal((await ask('echo not json')).group, 'work');
});

test('removal: the worktree goes, the branch stays, and the log can restore it', async t => {
  const s = setup(t), d = s.add('done');
  const plan = await s.w.plan(d); assert.equal(plan.refused, null);
  const out = await s.w.remove(d, plan.check);
  assert.equal(fs.existsSync(d), false); assert.equal(git(s.main, 'branch', '--list', 'feat/done').replace(/[* ]/g, ''), 'feat/done', 'the branch is kept');
  assert.deepEqual(JSON.parse(fs.readFileSync(s.log, 'utf8')), out); assert.equal(out.branch, 'feat/done'); assert.equal(out.commit, plan.head);
  git(s.main, 'worktree', 'add', '-q', d, out.branch); assert.ok(fs.existsSync(d), 'the log is enough to bring it back');
});

test('refused outright: the main checkout, locked, in use, a process inside, Pocket\'s own folder, outside home, not a worktree', async t => {
  const s = setup(t, { procs: [], self: h => { const d = path.join(h, 'self'); fs.mkdirSync(d); return d; } });
  const removes = async (p, re) => { const plan = await s.w.plan(p); assert.match(String(plan.refused), re); await assert.rejects(s.w.remove(p, plan.check), e => e.status === 409); assert.ok(fs.existsSync(p)); };
  await removes(s.main, /main checkout/);
  const locked = s.add('locked'); git(s.main, 'worktree', 'lock', '--reason', 'keep', locked); await removes(locked, /locked: keep/);
  const busy = s.add('busy'); s.usage[busy] = { running: [{ id: 'x', title: 'Build' }] }; await removes(busy, /conversation is running/);
  const recent = s.add('recent'); s.usage[recent] = { lastAt: Date.now() - 3600_000 }; await removes(recent, /last 24 hours/);
  const proc = s.add('proc'); s.w.scan = async () => [path.join(proc, 'sub')]; await removes(proc, /program is running/); s.w.scan = async () => [];
  const own = s.add('own'); s.w.selfDirs = [path.join(own, 'x')]; fs.mkdirSync(s.w.selfDirs[0]); await removes(own, /Pocket runs from here/); s.w.selfDirs = [];
  await assert.rejects(s.w.plan(os.tmpdir()), e => e.status === 403);
  await assert.rejects(s.w.plan(path.join(s.home, 'trees')), e => e.status === 404);
  await assert.rejects(s.w.plan(path.join(s.home, 'nowhere')), e => e.status === 404);
});

test('every check runs again at removal: a new file, a new commit, or a new ignored file stops it', async t => {
  const s = setup(t);
  const dirty = s.add('dirty'); let plan = await s.w.plan(dirty); fs.writeFileSync(path.join(dirty, 'new.txt'), 'x');
  await assert.rejects(s.w.remove(dirty, plan.check), /uncommitted/); assert.ok(fs.existsSync(path.join(dirty, 'new.txt')));
  const ahead = s.add('ahead'); plan = await s.w.plan(ahead); commit(ahead, 'more.txt');
  await assert.rejects(s.w.remove(ahead, plan.check), /not safe elsewhere/);
  const secret = s.add('secret'); plan = await s.w.plan(secret); fs.writeFileSync(path.join(secret, '.env'), 'x');
  await assert.rejects(s.w.remove(secret, plan.check), /changed since/); assert.ok(fs.existsSync(path.join(secret, '.env')), 'an ignored file the sheet never named is not deleted');
});

test('the sheet names ignored files, except rebuildable ones, and conversations that started here', async t => {
  const s = setup(t), d = s.add('ignored');
  fs.writeFileSync(path.join(d, '.env'), 'x'); fs.mkdirSync(path.join(d, 'data')); fs.writeFileSync(path.join(d, 'data/a.db'), 'x');
  fs.mkdirSync(path.join(d, 'node_modules')); fs.writeFileSync(path.join(d, 'node_modules/m.js'), 'x');
  s.usage[d] = { started: [{ id: 'abc', title: 'Old work' }] };
  const plan = await s.w.plan(d);
  assert.deepEqual(plan.ignored, ['.env', 'data/']); assert.equal(plan.rebuildable, 1); assert.deepEqual(plan.started, [{ id: 'abc', title: 'Old work' }]);
  assert.equal(plan.refused, null);
  await s.w.remove(d, plan.check); assert.equal(fs.existsSync(d), false);
});

test('status is cached for a minute, and a new commit is a new answer', async t => {
  const s = setup(t), d = s.add('cached');
  let asked = 0; s.w.usage = async () => { asked++; return {}; };
  await s.w.status(d); await s.w.status(d); assert.equal(asked, 1);
  commit(d, 'c.txt'); assert.equal((await s.w.status(d)).group, 'work'); assert.equal(asked, 2);
});

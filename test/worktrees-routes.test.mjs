// 1.98: the routes on the real server, with real repositories. The removal route takes the owner's cookie and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const repo = path.resolve(import.meta.dirname, '..'), PORT = 18847, sleep = ms => new Promise(r => setTimeout(r, ms));
const git = (cwd, ...a) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE)_/.test(k)));

test('worktree routes', { timeout: 60_000 }, async t => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-routes-'))), home = path.join(dir, 'home'), main = path.join(home, 'repo'), data = path.join(dir, 'data');
  for (const d of [main, path.join(dir, 'sessions')]) fs.mkdirSync(d, { recursive: true });
  git(main, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(main, 'a'), 'a'); git(main, 'add', 'a'); git(main, 'commit', '-q', '-m', 'a');
  const tree = path.join(home, 'trees/old'), other = path.join(home, 'trees/kept');
  git(main, 'worktree', 'add', '-q', '-b', 'feat/old', tree); git(main, 'worktree', 'add', '-q', '-b', 'feat/kept', other);
  const secret = 'wt-' + PORT, exp = Date.now() + 3600_000, cookie = 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex');
  const child = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: { ...cleanEnv(), HOME: home, PORT: String(PORT), POCKET_SKILLS: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret, POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: data, POCKET_TEST_CALLS: path.join(dir, 'calls'), CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'), CODEX_BIN: path.join(repo, 'test/fake-codex.mjs') } });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  t.after(() => { try { child.kill('SIGKILL'); } catch { } fs.rmSync(dir, { recursive: true, force: true }); });
  for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch { } if (i > 200) throw new Error('server did not start: ' + logs); await sleep(30); }
  const call = async (p, body, headers = { cookie }) => { const r = await fetch(`http://127.0.0.1:${PORT}/api${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };

  const started = await call('/new', { provider: 'claude', cwd: main, text: 'wt routes', approvalMode: 'full' });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  const id = started.body.id, e = encodeURIComponent(id);
  for (let i = 0; i < 200 && (await call(`/session/${e}`)).body?.active !== false; i++) await sleep(50);

  const list = await call(`/session/${e}/worktrees`);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.deepEqual(list.body.rows.map(r => [path.basename(r.path), r.main]), [['repo', true], ['kept', false], ['old', false]]);

  const row = await call(`/session/${e}/worktrees/status?path=${encodeURIComponent(tree)}`);
  assert.equal(row.body.group, 'ready', JSON.stringify(row.body)); assert.equal(row.body.branch, 'feat/old');
  assert.equal((await call(`/session/${e}/worktrees/status?path=${encodeURIComponent(home)}`)).status, 403, 'only this repository\'s worktrees');

  const plan = (await call(`/session/${e}/worktrees/removal?path=${encodeURIComponent(tree)}`)).body;
  assert.equal(plan.refused, null, JSON.stringify(plan));

  const token = fs.readFileSync(path.join(data, fs.readdirSync(data).find(f => /cli.*token|token/i.test(f))), 'utf8').trim();
  const bearer = await call('/worktrees/remove', { path: tree, check: plan.check }, { authorization: 'Bearer ' + token });
  assert.equal(bearer.status, 401, 'an agent holding the CLI token cannot remove a worktree'); assert.ok(fs.existsSync(tree));
  assert.equal((await call('/worktrees/remove', { path: tree, check: plan.check }, {})).status, 401);
  assert.equal((await call('/worktrees/remove', { path: tree, check: 'stale' })).status, 409); assert.ok(fs.existsSync(tree));

  const removed = await call('/worktrees/remove', { path: tree, check: plan.check });
  assert.equal(removed.status, 200, JSON.stringify(removed.body)); assert.equal(fs.existsSync(tree), false); assert.ok(fs.existsSync(other));
  assert.match(git(main, 'branch', '--list', 'feat/old'), /feat\/old/);
  const logged = JSON.parse(fs.readFileSync(path.join(data, 'worktrees-removed.jsonl'), 'utf8'));
  assert.equal(logged.branch, 'feat/old'); assert.equal(logged.path, tree); assert.equal(logged.commit, plan.head);
  assert.match(logs, /worktree removed/);
});

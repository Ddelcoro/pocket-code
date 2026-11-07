// 1.99: the routes on the real server with the real CLI. Off by default, the identity comes from the runner token, and the
// owner's release takes the cookie and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';

const repo = path.resolve(import.meta.dirname, '..'), PORT = 18851, sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE)_/.test(k)));

test('coordination routes and CLI', { timeout: 90_000 }, async t => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coord-routes-'))), home = path.join(dir, 'home'), work = path.join(home, 'work'), data = path.join(dir, 'data');
  for (const d of [work, data, path.join(dir, 'sessions')]) fs.mkdirSync(d, { recursive: true });
  // A hold from before a restart, already out of time, with someone waiting: the first sweep ends it.
  const past = Date.now() - 1000;
  fs.writeFileSync(path.join(data, 'coordination.json'), JSON.stringify({ version: 1, holds: [{ name: 'old-job', reason: 'Left behind', holder: { kind: 'terminal', session: null }, heldAt: past - 3600_000, ttlMs: 3600_000, expiresAt: past }], waits: {}, offers: {}, recent: [], names: [], notices: {} }));
  const secret = 'coord-' + PORT, exp = Date.now() + 3600_000, cookie = 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex');
  const child = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: { ...cleanEnv(), HOME: home, PORT: String(PORT), POCKET_SKILLS: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret,
    POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: data, POCKET_TEST_CALLS: path.join(dir, 'calls'), CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'), POCKET_CODEX: '0', POCKET_COORD_SWEEP_MS: '200' } });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  t.after(() => { try { child.kill('SIGKILL'); } catch { } fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); });
  for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch { } if (i > 200) throw new Error('server did not start: ' + logs); await sleep(30); }
  const call = async (p, body, headers = { cookie }) => { const r = await fetch(`http://127.0.0.1:${PORT}/api${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const bearer = { authorization: 'Bearer ' + fs.readFileSync(path.join(data, 'cli-token'), 'utf8').trim() };
  const cli = (args, runner) => new Promise(resolve => {
    const p = spawn(process.execPath, ['scripts/pocket-coord.mjs', ...args], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: { ...cleanEnv(), PORT: String(PORT), POCKET_ENV_FILE: '', POCKET_DATA_DIR: data, POCKET_COORD_POLL_MS: '100', ...(runner ? { POCKET_RUNNER_TOKEN: runner } : {}) } });
    let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d); p.on('close', code => resolve({ code, out, err }));
  });
  const calls = () => { try { return fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').map(l => JSON.parse(l)); } catch { return []; } };
  const running = async id => { for (let i = 0; i < 300; i++) { const c = calls().find(x => x.id === id); if (c) return c.runnerToken; await sleep(30); } throw new Error('no call: ' + logs); };
  const idle = async id => { for (let i = 0; i < 300 && (await call(`/session/${encodeURIComponent(id)}`)).body?.active !== false; i++) await sleep(30); };

  // Off by default, on every route, with the CLI saying how to turn it on.
  for (const [p, body, h] of [['/coordination'], ['/coordination/hold', { name: 'x' }, bearer], ['/coordination/owner-release', { name: 'x' }]]) {
    const r = await call(p, body, h); assert.equal(r.status, 404, p); assert.equal(r.body.code, 'coordination_off');
  }
  const off = await cli(['list']); assert.equal(off.code, 5); assert.match(off.err, /Settings → Projects, files, tasks & vault/);
  assert.equal((await call('/me')).body.features.coordination, false);
  assert.equal((await call('/sessions')).body.held, undefined);

  assert.equal((await call('/settings', { coordination: true })).status, 200);
  assert.equal((await call('/me')).body.features.coordination, true);

  // The sweep ended the hold left from before the restart.
  for (let i = 0; i < 100 && (await call('/coordination')).body.holds.length; i++) await sleep(50);
  const swept = (await call('/coordination')).body;
  assert.deepEqual(swept.holds, []); assert.equal(swept.recent[0].event, 'expired');

  const a = (await call('/new', { provider: 'claude', cwd: work, text: 'holder __HANG__', approvalMode: 'full' })).body.id, ta = await running(a);
  const b = (await call('/new', { provider: 'claude', cwd: work, text: 'waiter __HANG__', approvalMode: 'full' })).body.id, tb = await running(b);
  await call(`/session/${encodeURIComponent(a)}/rename`, { name: 'DAD 1.168 build' }).catch(() => { });

  // Who is holding comes from the runner token.
  const forged = await call('/coordination/hold', { name: 'tpv-deploy', reason: 'x', holder: { kind: 'conversation', session: a }, session: a }, { ...bearer, 'x-pocket-runner': 'not-a-token' });
  assert.equal(forged.status, 200); assert.deepEqual(forged.body.hold.holder, { kind: 'terminal', session: null }, 'a body and a bad token prove nothing');
  assert.equal((await call('/coordination/hold', { name: 'x', reason: 'y' })).status, 403, 'a cookie is not a holder');

  const held = await cli(['hold', 'dad-staging', '--reason', 'Building 1.168', '--ttl', '45m'], ta);
  assert.equal(held.code, 0, held.err); assert.match(held.out, /Holding dad-staging until/);
  const clash = await cli(['hold', 'dad-staging', '--reason', 'Mine'], tb);
  assert.equal(clash.code, 2); assert.match(clash.err, /dad-staging is held by ".+": Building 1\.168\. Held for under a minute\./);
  assert.match(clash.err, /pocket-coord wait dad-staging/);
  const close = await cli(['hold', 'staging', '--reason', 'x'], tb);
  assert.equal(close.code, 2); assert.match(close.err, /close to dad-staging/);
  assert.equal((await cli(['hold', 'dad-staging', '--reason', 'Still building'], ta)).code, 0, 'the same conversation renews');
  assert.equal((await cli(['hold', 'dad-staging', '--ttl', '99h'], ta)).code, 1);

  // The list line, and the view.
  const list = await call('/sessions');
  assert.equal(list.body.held.find(h => h.name === 'dad-staging').name, 'dad-staging');
  const shown = (await cli(['list', '--json'])).out;
  assert.equal(JSON.parse(shown).holds.find(h => h.name === 'dad-staging').holder.session, a);

  // A terminal cannot let go of a proven hold or be woken.
  const refused = await cli(['release', 'dad-staging']);
  assert.equal(refused.code, 1); assert.match(refused.err, /held by another conversation/);
  assert.match((await cli(['wait', 'dad-staging'])).err, /--block/);

  // Waiting: the conversation is told it will be woken, keeps its approval mode, and gets one labeled message.
  const wait = await cli(['wait', 'dad-staging'], tb);
  assert.equal(wait.code, 0, wait.err); assert.match(wait.out, /Number 1 in line.*wakes this conversation/s);
  assert.equal((await call('/coordination')).body.holds.find(h => h.name === 'dad-staging').waiters[0].session, b);
  await call(`/session/${encodeURIComponent(b)}/stop`, {}); await idle(b);
  const before = calls().length;
  const released = await cli(['release', 'dad-staging', '--note', 'Staging is clean'], ta);
  assert.equal(released.code, 0, released.err); assert.match(released.out, /Released dad-staging\. Woke/);
  for (let i = 0; i < 200 && calls().length === before; i++) await sleep(30);
  const woke = calls().at(-1);
  assert.equal(woke.id, b); assert.match(woke.text, /^\[Pocket coordination\] dad-staging is free\./); assert.match(woke.text, /Staging is clean/);
  assert.equal(woke.permissionMode, calls().find(c => c.id === b).permissionMode, 'same approval mode');
  await idle(b);
  assert.equal((await cli(['release', 'dad-staging'], ta)).code, 1, 'already released says so');

  // The owner's release takes the cookie: the real CLI token gets 401 and the hold stays.
  await cli(['hold', 'pocket-main', '--reason', 'Merging'], ta);
  assert.equal((await call('/coordination/owner-release', { name: 'pocket-main' }, bearer)).status, 401);
  assert.equal((await call('/coordination/owner-release', { name: 'pocket-main' }, { ...bearer, 'x-pocket-runner': ta })).status, 401);
  assert.equal((await call('/coordination/owner-release', { name: 'pocket-main' }, {})).status, 401);
  assert.equal((await call('/coordination/owner-release', { name: 'pocket-main' }, { cookie, origin: 'https://evil.example' })).status, 403);
  assert.ok((await call('/coordination')).body.holds.some(h => h.name === 'pocket-main'));
  assert.equal((await call('/coordination/owner-release', { name: 'pocket-main' })).status, 200);
  assert.equal((await call('/coordination')).body.recent[0].event, 'owner');

  // --block waits in the shell and ends when the holder lets go; a timeout exits 3 and leaves the line.
  await cli(['hold', 'tpv-cloud', '--reason', 'Deploy', '--new'], ta);
  const timedOut = await cli(['wait', 'tpv-cloud', '--block', '--timeout', '1s']);
  assert.equal(timedOut.code, 3); assert.match(timedOut.err, /Still held/);
  assert.deepEqual((await call('/coordination')).body.holds.find(h => h.name === 'tpv-cloud').waiters, [], 'it left the line');
  const blocked = cli(['wait', 'tpv-cloud', '--block', '--timeout', '30s']);
  for (let i = 0; i < 100 && !(await call('/coordination')).body.holds.find(h => h.name === 'tpv-cloud').waiters.length; i++) await sleep(30);
  assert.equal((await cli(['release', 'tpv-cloud'], ta)).code, 0);
  const free = await blocked;
  assert.equal(free.code, 0, free.err); assert.match(free.out, /tpv-cloud is free/);

  // A person's paused queue stays paused, and a wake waits behind it.
  await cli(['hold', 'tpv-cloud', '--reason', 'Again'], ta);
  const c = (await call('/new', { provider: 'claude', cwd: work, text: 'third __HANG__', approvalMode: 'full' })).body.id, tc = await running(c);
  await call(`/session/${encodeURIComponent(c)}/message`, { text: 'mine first', mode: 'queue', approvalMode: 'full' });
  await cli(['wait', 'tpv-cloud'], tc);
  await call(`/session/${encodeURIComponent(c)}/stop`, {}); await idle(c);
  const count = calls().length;
  await cli(['release', 'tpv-cloud'], ta);
  await sleep(600);
  assert.equal(calls().length, count, 'nothing started behind a stopped queue');
  assert.deepEqual((await call(`/session/${encodeURIComponent(c)}/queue`)).body.items?.map(i => i.text.slice(0, 20)), ['mine first', '[Pocket coordination']);

  // Assistant mode hides it and the routes answer as if off.
  await call('/settings', { assistantMode: true });
  assert.equal((await call('/coordination')).status, 404);
  assert.equal((await call('/me')).body.features.coordination, false);
});

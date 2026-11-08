// 1.86 Engine parity: one feature checklist, run against every engine. The real server.mjs, with Claude Code
// (test/fake-claude.mjs), Codex (test/fake-codex.mjs) and OpenRouter through OpenCode (test/fake-acp.mjs) all on,
// takes the same requests for each and must behave the same way. A feature added for one engine and not the others
// fails here; an engine that cannot do something lists it false in engines.mjs, and the app hides it there.
//
// Each fake takes the same prompt markers: __SLOW__ (the reply takes a while), __HANG__ (it runs until stopped),
// __CHOICES__ (it ends with a ```choices block), __QUESTION__ (it asks "Which color?" with Blue and Red);
// 1.87: __PLAN__ (a plan of two steps), __EDIT__ (edits parity.txt, "old line" to "new line"), __LIMIT__ (hits a usage or
// rate limit that lifts 2 s later), and a command it asks to run (Claude __TOOLREQ__ Bash, Codex __CMDAPPROVAL__,
// OpenRouter every reply), which the trusted list covers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const repo = path.resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ENGINES = ['claude', 'codex', 'acp'];
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(POCKET|VAPID|CODEX|CLAUDE|OPENCODE)_/.test(k)));

async function boot(t, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-')), home = path.join(dir, 'home'), cwd = path.join(home, 'work'); // inside home: Pocket refuses workspaces outside it
  for (const d of [home, cwd, path.join(home, 'pocket-uploads'), path.join(dir, 'sessions')]) fs.mkdirSync(d, { recursive: true });
  const secret = 'parity-' + port, exp = Date.now() + 3600_000;
  const headers = { 'content-type': 'application/json', cookie: 'pc_auth=' + exp + '.' + createHmac('sha256', secret).update(String(exp)).digest('hex') };
  const child = spawn(process.execPath, ['server.mjs'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...cleanEnv(), HOME: home, PORT: String(port), POCKET_SKILLS: '0', POCKET_ENV_FILE: '', POCKET_AUTO_TITLES: '0', POCKET_PASSWORD: 'test-only', POCKET_SECRET: secret,
    POCKET_SESSION_ROOT: path.join(dir, 'sessions'), POCKET_DATA_DIR: path.join(dir, 'data'), POCKET_TEST_CALLS: path.join(dir, 'calls'),
    CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'), CODEX_BIN: path.join(repo, 'test/fake-codex.mjs'),
    POCKET_ACP_ENABLE: '1', POCKET_ACP_CMD: process.execPath, POCKET_ACP_ARGS: path.join(repo, 'test/fake-acp.mjs'), POCKET_ACP_STORE: path.join(dir, 'acp-store'), POCKET_ASK_POLL_MS: '100',
    POCKET_RETRY_BUFFER_MS: '0', POCKET_TRUSTED_ACTIONS: 'Bash(echo PARITY_OK), Bash(echo CX_OK), Bash(echo ACP_OK)',
  } });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  t.after(() => { try { child.kill('SIGKILL'); } catch { } if (process.env.PARITY_LOG) fs.writeFileSync(process.env.PARITY_LOG, logs); fs.rmSync(dir, { recursive: true, force: true }); });
  for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } if (i > 200) throw new Error('server did not start: ' + logs); await sleep(30); }
  const call = async (p, body, method) => { const r = await fetch(`http://127.0.0.1:${port}/api${p}`, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { } return { status: r.status, body: j }; };
  const e = id => encodeURIComponent(id);
  const until = async (fn, ms = 12000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; log tail: ${logs.slice(-1200)}`); await sleep(60); } };
  const start = async (engine, text, extra = {}) => { const r = await call('/new', { provider: engine, cwd, text, approvalMode: 'full', ...extra }); assert.equal(r.status, 202, `${engine} start: ${JSON.stringify(r.body)}`); return r.body.id; };
  const session = id => call('/session/' + e(id)).then(r => r.body);
  const idle = id => until(async () => { const b = await session(id); return b && !b.active && !['running'].includes(b.state?.kind) ? b : null; }, 15000, 'the reply to end');
  // what the engine itself was given, from each fake's record
  const prompts = engine => {
    if (engine === 'claude') return fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    if (engine === 'codex') return fs.readFileSync(path.join(dir, 'calls.codex'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    return fs.readdirSync(path.join(dir, 'acp-store')).map(f => JSON.parse(fs.readFileSync(path.join(dir, 'acp-store', f), 'utf8'))).flatMap(s => (s.prompts || []).map(text => ({ text, seen: s.seen, runnerToken: s.runnerToken })));
  };
  const sse = (id, stopOn) => new Promise(resolve => {
    const ctrl = new AbortController(), evs = [], timer = setTimeout(() => { ctrl.abort(); resolve(evs); }, 15000);
    fetch(`http://127.0.0.1:${port}/api/session/${e(id)}/events`, { headers, signal: ctrl.signal }).then(async r => {
      let buf = '';
      for await (const c of r.body) { buf += Buffer.from(c).toString(); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, i).split('\n').find(l => l.startsWith('data:')); buf = buf.slice(i + 2); if (!line) continue; let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; } evs.push(ev); if (stopOn(ev)) { clearTimeout(timer); ctrl.abort(); return resolve(evs); } } }
    }).catch(() => { clearTimeout(timer); resolve(evs); });
  });
  return { port, dir, cwd, home, call, e, until, start, session, idle, prompts, sse, logs: () => logs };
}

test('engine parity: the same checklist on Claude Code, Codex and OpenRouter', { timeout: 240_000 }, async t => {
  const s = await boot(t, 18821);
  const features = (await s.call('/engines')).body.engines;
  assert.deepEqual(Object.keys(features).sort(), [...ENGINES].sort(), 'every engine is described');

  for (const engine of ENGINES) {
    await t.test(`${engine}: your message shows while its reply runs`, async () => {
      const id = await s.start(engine, `parity one ${engine} __SLOW__`);
      const live = await s.until(async () => { const b = await s.session(id); return b?.active ? b : null; }, 8000, 'the reply to start');
      assert.ok(live.messages.some(m => m.role === 'user' && m.text.startsWith(`parity one ${engine}`)), `${engine}: ${JSON.stringify(live.messages)}`);
      await s.idle(id);
    });

    await t.test(`${engine}: Pocket's instructions reach it`, async () => {
      if (engine === 'claude') assert.ok(s.prompts('claude').some(c => c.text.startsWith('parity one claude') && c.choices), 'Claude got the suggested-reply instructions');
      else if (engine === 'codex') assert.ok(fs.readFileSync(path.join(s.dir, 'calls.threads'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).some(c => c.choices), 'Codex got them');
      else { const p = s.prompts('acp').find(x => x.text.startsWith('parity one acp')); assert.match(p?.seen?.instructions || '', /choices/, 'OpenRouter got them in its instruction file'); }
    });

    await t.test(`${engine}: the Git panel reads only folders this conversation worked in`, async () => {
      const made = await s.start(engine, `parity folders ${engine}`); await s.idle(made);
      const id = encodeURIComponent(made);
      const folders = await s.call(`/session/${id}/folders`);
      assert.equal(folders.status, 200); assert.ok(Array.isArray(folders.body.folders)); assert.equal(folders.body.start, s.cwd);
      const refused = await s.call(`/session/${id}/workspace?folder=${encodeURIComponent('/etc')}`);
      assert.equal(refused.status, 403, 'a folder this conversation never used is refused');
    });
    if (engine === 'claude') await t.test('claude: a branch starts in the folder the work moved to', async () => {
      const work = path.join(s.home, 'moved-repo'); fs.mkdirSync(work); spawnSync('git', ['init', '-q'], { cwd: work });
      const id = await s.start('claude', 'parity branch folder'); await s.idle(id);
      const transcript = name => fs.readdirSync(path.join(s.dir, 'sessions'), { recursive: true }).map(f => path.join(s.dir, 'sessions', f)).find(f => f.endsWith(name + '.jsonl'));
      fs.appendFileSync(transcript(id), JSON.stringify({ type: 'user', sessionId: id, cwd: work, timestamp: new Date().toISOString() }) + '\n');
      await s.until(async () => (await s.call(`/session/${s.e(id)}/folders`)).body.active === fs.realpathSync(work), 6000, 'the move to show');
      const branch = await s.call(`/session/${s.e(id)}/branch`, { text: 'carry on', clientMessageId: 'parity-branch-folder' });
      assert.equal(branch.status, 202); await s.idle(branch.body.id);
      const last = fs.readFileSync(transcript(branch.body.id), 'utf8').trim().split('\n').map(l => JSON.parse(l)).at(-1);
      assert.equal(fs.realpathSync(last.cwd), fs.realpathSync(work));
    });
    await t.test(`${engine}: a handoff starts once, on the engine it names`, async () => {
      const made = await s.call('/start', { text: `parity handoff ${engine}`, directory: s.cwd, provider: engine, kind: 'handoff' });
      assert.equal(made.status, 200, JSON.stringify(made.body));
      const entry = (await s.call('/start/' + made.body.id)).body;
      assert.equal(entry.kind, 'handoff'); assert.equal(entry.provider, engine); assert.equal(entry.approvalMode, 'review', 'no proven parent: Review actions');
      const go = () => s.call('/new', { text: entry.text, cwd: s.cwd, provider: engine, start: made.body.id, approvalMode: 'full' });
      const first = await go(); assert.equal(first.status, 202, JSON.stringify(first.body));
      const again = await go(); assert.equal(again.status, 409); assert.equal(again.body.code, 'start_used'); assert.equal(again.body.id, first.body.id);
      await s.until(() => s.prompts(engine).some(c => c.text.startsWith(`parity handoff ${engine}`)), 15000, `${engine} to receive the handoff`);
      await s.idle(first.body.id);
    });

    await t.test(`${engine}: a choices block becomes reply buttons`, async () => {
      const id = await s.start(engine, `parity choices ${engine} __CHOICES__`);
      const evs = await s.sse(id, ev => ev.type === 'done' || ev.type === 'idle');
      let blocks = evs.filter(ev => ev.type === 'assistant').flatMap(ev => ev.msg?.blocks || []);
      // a fake can finish before the stream opens; the reply is then in the history, which is what the app reads
      if (!blocks.length) { await s.idle(id); blocks = (await s.session(id)).messages.filter(m => m.role === 'assistant').flatMap(m => m.blocks || []); }
      assert.ok(blocks.some(b => b.t === 'choices' && b.options.includes('Merge and deploy')), `${engine}: ${JSON.stringify(blocks)}`);
      assert.ok(!blocks.some(b => b.t === 'text' && /```choices/.test(b.text)), 'the raw block is not shown as text');
      await s.idle(id);
    });

    // 1.101: tapping Mark resolved (or Remind me …) under a reply starts one more turn; its confirmation is reviewed as
    // it ends, on every device, so it never lands in Attention. An ordinary request afterwards still does.
    await t.test(`${engine}: the reply to a wrap-up request is already reviewed`, async () => {
      const id = await s.start(engine, `parity wrap ${engine}`);
      await s.idle(id);
      // what every device's list reads: the reply's outcome time and the reviewed marker (the list itself leaves out /tmp folders)
      const meta = () => { try { return JSON.parse(fs.readFileSync(path.join(s.dir, 'data', 'session-meta.json'), 'utf8'))[id] || {}; } catch { return {}; } };
      const send = async text => {
        const before = meta().outcome?.at || 0, r = await s.call(`/session/${s.e(id)}/message`, { text, approvalMode: 'full' });
        assert.equal(r.status, 202, JSON.stringify(r.body));
        return s.until(() => { const m = meta(); return m.outcome?.kind === 'finished' && m.outcome.at > before ? m : null; }, 15000, `${engine} to finish "${text}"`);
      };
      const first = await s.until(() => meta().outcome?.kind === 'finished' && meta(), 5000, 'the first outcome');
      assert.ok(!(first.seen >= first.outcome.at), 'the first reply waits to be read');
      const wrapped = await send('Mark resolved');
      assert.ok(wrapped.seen >= wrapped.outcome.at, `${engine}: ${JSON.stringify(wrapped)}`);
      const later = await send(`parity ordinary ${engine}`);
      assert.ok(later.outcome.at > (later.seen || 0), 'an ordinary reply still waits to be read');
      await s.idle(id);
    });

    await t.test(`${engine}: a queued message runs on the same engine`, async () => {
      const id = await s.start(engine, `parity slow ${engine} __SLOW__`);
      await s.until(async () => (await s.session(id))?.active, 8000, 'the reply to start');
      const q = await s.call(`/session/${s.e(id)}/message`, { text: `parity queued ${engine}`, mode: 'queue', approvalMode: 'full' });
      assert.equal(q.status, 202, JSON.stringify(q.body)); assert.equal(q.body.queued, true);
      await s.until(() => s.prompts(engine).some(c => c.text.startsWith(`parity queued ${engine}`)), 15000, `${engine} to receive the queued message`);
      await s.idle(id);
    });

    await t.test(`${engine}: Stop is a stop, and the queue waits`, async () => {
      const id = await s.start(engine, `parity stop ${engine} __HANG__`);
      await s.until(async () => (await s.session(id))?.active, 8000, 'the reply to start');
      await s.until(() => s.prompts(engine).some(c => c.text.startsWith(`parity stop ${engine}`)), 8000, 'the engine to have the message'); // stopped before it even read it, there is no conversation to keep
      await s.call(`/session/${s.e(id)}/message`, { text: `parity after stop ${engine}`, mode: 'queue', approvalMode: 'full' });
      assert.equal((await s.call(`/session/${s.e(id)}/stop`, {})).status, 200);
      const b = await s.idle(id);
      // stopped, with the queued message held: every engine says "Queue paused" until you start it
      assert.equal(b.state?.kind, 'waiting', `${engine}: ${JSON.stringify(b)}`); assert.equal(b.state.label, 'Queue paused');
      await sleep(800);
      assert.ok(!s.prompts(engine).some(c => c.text.startsWith(`parity after stop ${engine}`)), 'the queued message did not run after Stop');
    });

    await t.test(`${engine}: a question shows as a card and the answer reaches it`, async () => {
      const id = await s.start(engine, `parity question ${engine} __QUESTION__`);
      const q = await s.until(async () => (await s.call(`/session/${s.e(id)}/questions`)).body?.requests?.[0], 10000, 'the question card');
      assert.equal(q.questions[0].question, 'Which color?'); assert.deepEqual(q.questions[0].options.map(o => o.label), ['Blue', 'Red']);
      assert.equal((await s.session(id)).state.kind, 'input', 'the conversation says it needs you');
      const a = await s.call(`/session/${s.e(id)}/questions/${q.id}/answer`, { answers: { [q.questions[0].id]: ['Blue'] } });
      assert.equal(a.status, 200, JSON.stringify(a.body));
      const b = await s.idle(id);
      assert.equal(b.state.kind, 'finished', `${engine}: ${JSON.stringify(b.state)}`);
    });

    await t.test(`${engine}: attachments reach it`, async () => {
      const file = path.join(s.home, 'pocket-uploads', `parity-${engine}.txt`); fs.writeFileSync(file, 'attached');
      const id = await s.start(engine, `parity attach ${engine}`, { attachments: [file] });
      await s.idle(id);
      assert.ok(s.prompts(engine).some(c => c.text.startsWith(`parity attach ${engine}`) && c.text.includes(file)), `${engine} was given the file`);
    });

    // ---------- 1.87 ----------
    await t.test(`${engine}: a plan shows as a checklist`, async () => {
      const id = await s.start(engine, `parity plan ${engine} __PLAN__`);
      const evs = await s.sse(id, ev => ev.type === 'done' || ev.type === 'idle');
      const todo = evs.filter(ev => ev.type === 'assistant').flatMap(ev => ev.msg?.blocks || []).find(b => b.t === 'todo');
      assert.deepEqual(todo?.todos?.map(x => [x.c, x.s]), [['Read the code', 'completed'], ['Fix the bug', 'in_progress']], `${engine}: ${JSON.stringify(todo)}`);
      await s.idle(id);
    });

    await t.test(`${engine}: edits show in Changes with what changed`, async () => {
      const id = await s.start(engine, `parity edit ${engine} __EDIT__`);
      await s.idle(id);
      const c = await s.until(async () => { const r = (await s.call(`/session/${s.e(id)}/changes`)).body; return r?.files?.some(f => f.path.endsWith('parity.txt')) ? r : null; }, 10000, 'the edit in Changes');
      const ops = c.files.find(f => f.path.endsWith('parity.txt')).ops;
      assert.ok(ops.length && ops.every(o => (typeof o.patch === 'string' && o.patch.includes('+new line')) || (o.old === 'old line' && o.new === 'new line')), `${engine}: ${JSON.stringify(ops)}`);
      const sent = JSON.stringify((await s.session(id)).messages);
      assert.ok(!sent.includes('"changes"'), 'the diff itself does not travel with the conversation');
    });

    await t.test(`${engine}: a usage limit waits for the reset, then picks the task up again`, async () => {
      const id = await s.start(engine, `parity limit ${engine} __LIMIT__`);
      const w = await s.until(async () => { const b = await s.session(id); return b?.state?.kind === 'waiting' ? b : null; }, 10000, 'the waiting state');
      assert.equal(w.state.label, 'Waiting for usage reset'); assert.ok(w.state.retryAt > Date.now() - 60_000);
      await s.until(() => s.prompts(engine).some(c => /interrupted by an API rate limit/.test(c.text)), 20000, `${engine} to be resumed`);
      await s.idle(id);
    });

    await t.test(`${engine}: a trusted read-only command runs without an approval card`, async () => {
      const text = engine === 'claude' ? `parity trusted claude __TOOLREQ__ {"tool":"Bash","input":{"command":"echo PARITY_OK"}}` : engine === 'codex' ? 'parity trusted codex __CMDAPPROVAL__' : 'parity trusted acp';
      const id = await s.start(engine, text, { approvalMode: 'review' });
      const b = await s.idle(id); // with no card to answer, the reply only ends because the command was allowed
      assert.notEqual(b.state.kind, 'input');
      if (engine === 'claude') assert.ok(fs.readFileSync(path.join(s.dir, 'calls.responses'), 'utf8').includes('"behavior":"allow"'));
      if (engine === 'codex') assert.match(fs.readFileSync(path.join(s.dir, 'calls.cxapprovals'), 'utf8'), /"decision":"accept"/);
      if (engine === 'acp') assert.ok(fs.readdirSync(path.join(s.dir, 'acp-store')).some(f => JSON.parse(fs.readFileSync(path.join(s.dir, 'acp-store', f), 'utf8')).lastPrompt === 'parity trusted acp' && JSON.parse(fs.readFileSync(path.join(s.dir, 'acp-store', f), 'utf8')).permissionOutcome === 'selected'));
    });

    await t.test(`${engine}: each reply reports what it cost or used, and /compact reaches the agent`, async () => {
      const id = await s.start(engine, `parity meter ${engine} __COST__`);
      const evs = await s.sse(id, ev => ev.type === 'done' || ev.type === 'idle');
      const r = evs.find(ev => ev.type === 'result');
      assert.ok(Number.isFinite(r?.cost) || r?.tokens > 0, `${engine}: ${JSON.stringify(r)}`);
      await s.idle(id);
      const before = s.prompts(engine).length;
      assert.equal((await s.call(`/session/${s.e(id)}/message`, { text: '/compact', approvalMode: 'full' })).status, 202);
      await s.until(() => s.prompts(engine).slice(engine === 'acp' ? 0 : before).some(c => c.text === '/compact' || c.text === '[compact]'), 10000, `${engine} to get /compact`);
      if (engine === 'codex') assert.ok(s.prompts('codex').some(c => c.text === '[compact]'), 'Codex compacts with its own method');
      await s.idle(id);
    });

    await t.test(`${engine}: a conversation whose folder is gone carries on from home, and says so once`, async () => {
      const gone = path.join(s.home, 'gone-' + engine); fs.mkdirSync(gone);
      const r0 = await s.call('/new', { provider: engine, cwd: gone, text: `parity gone ${engine}`, approvalMode: 'full' }); assert.equal(r0.status, 202, JSON.stringify(r0.body));
      const id = r0.body.id; await s.idle(id);
      fs.rmSync(gone, { recursive: true, force: true });
      const first = await s.call(`/session/${s.e(id)}/message`, { text: `parity gone again ${engine}`, approvalMode: 'full' });
      assert.equal(first.status, 202, JSON.stringify(first.body)); assert.equal(first.body.carriedOn, true, `${engine}: ${JSON.stringify(first.body)}`);
      await s.idle(id);
      assert.ok(s.prompts(engine).some(c => String(c.text).includes(`parity gone again ${engine}`)), `${engine} got the message`);
      if (engine === 'claude') assert.ok(fs.readdirSync(path.join(s.dir, 'sessions')).length, 'the transcript is still there');
      if (engine === 'codex') assert.ok(fs.readFileSync(path.join(s.dir, 'calls.resumes'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).some(c => c.threadId === id.slice(3) && c.cwd === s.home), 'Codex is told home: left alone it resumes in the deleted folder');
      const second = await s.call(`/session/${s.e(id)}/message`, { text: `parity gone third ${engine}`, approvalMode: 'full' });
      assert.equal(second.status, 202); assert.equal(second.body.carriedOn, undefined, 'it is said once');
      await s.idle(id);
    });

    await t.test(`${engine}: a hold names its conversation, the owner's release is told once, and a waiter is woken`, async () => {
      assert.equal((await s.call('/settings', { coordination: true })).status, 200);
      const name = 'parity-' + engine, bearer = { 'content-type': 'application/json', authorization: 'Bearer ' + fs.readFileSync(path.join(s.dir, 'data', 'cli-token'), 'utf8').trim() };
      const token = text => s.until(() => s.prompts(engine).find(c => c.text.startsWith(text))?.runnerToken, 8000, 'the runner token');
      const agent = async (p, tok, body) => { const r = await fetch(`http://127.0.0.1:${s.port}/api/coordination${p}`, { method: 'POST', headers: { ...bearer, 'x-pocket-runner': tok }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
      const a = await s.start(engine, `coord holder ${engine} __HANG__`), b = await s.start(engine, `coord waiter ${engine} __HANG__`);
      const ta = await token(`coord holder ${engine}`), tb = await token(`coord waiter ${engine}`);
      const held = await agent('/hold', ta, { name, reason: 'Parity', new: true });
      assert.equal(held.status, 200, JSON.stringify(held.body));
      assert.equal(held.body.hold.holder.session, a, `${engine}: the runner token proved the conversation`);
      const clash = await agent('/hold', tb, { name, reason: 'Mine' });
      assert.equal(clash.status, 409); assert.equal(clash.body.hold.holder.session, a);
      assert.equal((await agent('/wait', tb, { name })).body.free, false);
      for (const id of [a, b]) { assert.equal((await s.call(`/session/${s.e(id)}/stop`, {})).status, 200); await s.idle(id); }
      assert.equal((await s.call('/coordination/owner-release', { name })).status, 200);
      await s.until(() => s.prompts(engine).some(c => c.text.startsWith(`[Pocket coordination] ${name} is free`)), 10000, 'the waiter to be woken');
      await s.idle(b);
      await s.call(`/session/${s.e(a)}/message`, { text: `coord next ${engine}`, approvalMode: 'full' });
      await s.until(() => s.prompts(engine).find(c => c.text.startsWith(`coord next ${engine}`) && c.text.includes(`[Pocket: The owner released your hold on ${name}.`)), 10000, 'the holder to be told');
      await s.idle(a);
      await s.call(`/session/${s.e(a)}/message`, { text: `coord later ${engine}`, approvalMode: 'full' });
      await s.until(() => s.prompts(engine).some(c => c.text.startsWith(`coord later ${engine}`)), 10000, 'the next message');
      assert.ok(!s.prompts(engine).find(c => c.text.startsWith(`coord later ${engine}`)).text.includes('[Pocket:'), 'told once');
      await s.idle(a);
    });

    await t.test(`${engine}: the Git panel, Results and Search answer`, async () => {
      if (!fs.existsSync(path.join(s.cwd, '.git'))) spawnSync('git', ['init', '-q', s.cwd]);
      const id = await s.start(engine, `parity panels ${engine}`);
      await s.idle(id);
      for (const p of ['workspace', 'results', 'search?q=parity']) { const r = await s.call(`/session/${s.e(id)}/${p}`); assert.equal(r.status, 200, `${engine} ${p}: ${JSON.stringify(r.body)}`); }
    });
  }
});

#!/usr/bin/env node
// Integration-only ACP agent: JSON-RPC 2.0 over stdio, never calls a model. Mirrors the
// shape OpenCode's `opencode acp` speaks (verified live), so acp.mjs can be tested with no
// network or real runtime. Session state persists to POCKET_ACP_STORE so a fresh process can
// session/load it (the crash+resume case).
//
// Env flags: POCKET_ACP_STORE (required, dir) · FAKE_ACP_NO_LOADSESSION (advertise loadSession:false)
// · FAKE_ACP_ELICIT (ask an elicitation/create instead of permission) · FAKE_ACP_NO_ASK (skip permission)
// · FAKE_ACP_DELAY_MS (how long the tool "runs")
// Prompt markers, the same the Claude and Codex fakes take: __SLOW__ (the tool runs 1.5 s), __HANG__ (never answers until
// cancelled), __CHOICES__ (ends with a ```choices block), __QUESTION__ (asks through Pocket's ask tool, the MCP server
// Pocket names in OPENCODE_CONFIG_CONTENT, and answers with what you chose). Each prompt records what reached it: the
// prompt text, its image blocks, and the instruction files OpenCode would read (OPENCODE_CONFIG_CONTENT.instructions). · FAKE_ACP_IGNORE_MODEL (accept set_config_option for the model but stay on the default, like a runtime
// that drops the request).
//
// Model and effort are session config options, as in OpenCode 1.19 (probed live 2026-10-28): session/new and
// session/load return configOptions with a `model` select whose default is OpenCode's own model; setting a
// model adds an `effort` select with that model's own levels. Each prompt records the model and effort it ran on.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const STORE = process.env.POCKET_ACP_STORE;
if (!STORE) throw new Error('POCKET_ACP_STORE required');
fs.mkdirSync(STORE, { recursive: true });
const sessFile = id => path.join(STORE, encodeURIComponent(id) + '.json');
const loadSess = id => { try { return JSON.parse(fs.readFileSync(sessFile(id), 'utf8')); } catch { return null; } };
// Written beside the store and renamed in, so a test reading the store never sees half a file.
const saveSess = (id, s) => { const tmp = `${STORE}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(s)); fs.renameSync(tmp, sessFile(id)); };

// Exit cleanly when the client goes away, so a test never leaks this child.
process.stdin.on('end', () => process.exit(0));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
const send = o => process.stdout.write(JSON.stringify(o) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, message) => send({ jsonrpc: '2.0', id, error: { code: -32600, message } });
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });

// The fake's own outgoing requests (server->client), awaiting the client's response.
let seq = 1_000_000;
const clientPending = new Map();
const askClient = (method, params) => new Promise(res => { const id = ++seq; clientPending.set(id, res); send({ jsonrpc: '2.0', id, method, params }); });

const cancelled = new Set(); // sessionIds cancelled mid-turn
const FAKE_TURN_COST = 0.0021; // what each prompt adds to the session's running cost

// What each model offers for effort (null = no effort setting), and the level it starts on.
const MODELS = {
  'opencode/big-pickle': null,
  'openrouter/deepseek/deepseek-v4.1-flash-1017': { levels: ['none', 'low', 'high', 'max', 'default'], start: 'none' },
  'openrouter/anthropic/claude-sonnet-5.5': { levels: ['low', 'medium', 'high', 'xhigh', 'max', 'default'], start: 'low' },
  'openrouter/meta-llama/llama-4-scout': null,
};
// Like OpenCode, the model and effort live in this process's memory, per session, not in the store:
// another process that loads the session starts on the default without touching this one.
const conf = new Map(); // sessionId -> { model, effort }
const confOf = sid => { if (!conf.has(sid)) conf.set(sid, { model: 'opencode/big-pickle', effort: null }); return conf.get(sid); };
const configOptions = s => {
  const out = [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: s.model, options: Object.keys(MODELS).map(v => ({ value: v, name: v })) }];
  const m = MODELS[s.model];
  if (m) out.push({ id: 'effort', name: 'Effort', category: 'effort', type: 'select', currentValue: s.effort, options: m.levels.map(v => ({ value: v, name: v })) });
  out.push({ id: 'mode', name: 'Session Mode', category: 'mode', type: 'select', currentValue: 'build', options: [{ value: 'build', name: 'build' }, { value: 'plan', name: 'plan' }] });
  return out;
};

// Pocket's ask tool, started the way OpenCode starts an MCP server from its config.
async function askPocket(questions) {
  const cfg = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || '{}').mcp?.pocket;
  if (!cfg) return 'no ask tool';
  const child = spawn(cfg.command[0], cfg.command.slice(1), { env: { ...process.env, ...(cfg.environment || {}) }, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = readline.createInterface({ input: child.stdout }); const waiting = new Map(); let n = 0;
  lines.on('line', l => { const m = JSON.parse(l); waiting.get(m.id)?.(m); waiting.delete(m.id); });
  const ask = (method, params) => new Promise(r => { const i = ++n; waiting.set(i, r); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  await ask('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  const r = await ask('tools/call', { name: 'ask_user', arguments: { questions } });
  child.kill();
  return r.result?.content?.[0]?.text || JSON.stringify(r.error || r.result);
}

async function handlePrompt(id, params) {
  const sid = params.sessionId;
  const text = (params.prompt || []).map(p => p.text || '').join('');
  const seen = { text, images: (params.prompt || []).filter(p => p.type === 'image').length, instructions: (JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || '{}').instructions || []).map(f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n') };
  const s = loadSess(sid) || { updates: [] };
  const c = confOf(sid);
  s.lastPrompt = text; s.ranOn = { model: c.model, effort: MODELS[c.model] ? c.effort : null }; s.seen = seen;
  (s.prompts ||= []).push(text);
  // like OpenCode: the user's prompt is part of the replayed history, and the session gets a title from it
  s.updates.push({ sessionUpdate: 'user_message_chunk', messageId: 'u_' + randomUUID(), content: { type: 'text', text } });
  if (!s.titled) { s.title = text.slice(0, 40); s.titled = true; }
  // think, then stream a tool call titled with its command, as OpenCode does (both replayed on session/load)
  const toolId = randomUUID();
  const thought = { sessionUpdate: 'agent_thought_chunk', messageId: 'r_' + randomUUID(), content: { type: 'text', text: 'Checking with a quick command.' } };
  // live: first the call with only its folder, then the command in an in_progress update; the replay has it all
  const where = [{ path: s.cwd || '/tmp' }];
  notify('session/update', { sessionId: sid, update: thought });
  notify('session/update', { sessionId: sid, update: { sessionUpdate: 'tool_call', toolCallId: toolId, title: 'bash', kind: 'execute', status: 'pending', locations: where, rawInput: { cwd: s.cwd || '/tmp' } } });
  notify('session/update', { sessionId: sid, update: { sessionUpdate: 'tool_call_update', toolCallId: toolId, status: 'in_progress', kind: 'execute', title: 'echo ACP_OK', locations: where, rawInput: { command: 'echo ACP_OK', cwd: s.cwd || '/tmp' } } });
  s.updates.push(thought, { sessionUpdate: 'tool_call', toolCallId: toolId, title: 'echo ACP_OK', kind: 'execute', status: 'pending', locations: where, rawInput: { command: 'echo ACP_OK' } });
  // ask the client before "running" the tool (permission), or an elicitation question
  if (process.env.FAKE_ACP_ELICIT) {
    const ans = await askClient('elicitation/create', { sessionId: sid, message: 'Pick one', mode: 'form' });
    s.elicitOutcome = ans?.outcome;
  } else if (!process.env.FAKE_ACP_NO_ASK) {
    // like OpenCode: the request carries the tool call, titled with the command it will run
    const ans = await askClient('session/request_permission', { sessionId: sid, toolCallId: toolId,
      toolCall: { toolCallId: toolId, title: 'echo ACP_OK', kind: 'execute', status: 'pending', rawInput: { command: 'echo ACP_OK' } },
      options: [{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' }] });
    if (cancelled.has(sid) || ans?.cancelled) { cancelled.delete(sid); saveSess(sid, s); return reply(id, { stopReason: 'cancelled' }); }
    s.permissionOutcome = ans?.outcome?.outcome;
    if (ans?.outcome?.outcome !== 'selected' || /reject/.test(ans?.outcome?.optionId || '')) {
      saveSess(sid, s); return reply(id, { stopReason: 'refusal' });
    }
  }
  if (cancelled.has(sid)) { cancelled.delete(sid); saveSess(sid, s); return reply(id, { stopReason: 'cancelled' }); }
  if (process.env.FAKE_ACP_DELAY_MS) await new Promise(r => setTimeout(r, Number(process.env.FAKE_ACP_DELAY_MS))); // "running" the tool
  if (text.includes('__SLOW__')) await new Promise(r => setTimeout(r, 1500));
  if (text.includes('__HANG__')) { saveSess(sid, s); await new Promise(r => { const t = setInterval(() => { if (cancelled.has(sid)) { clearInterval(t); r(); } }, 50); }); cancelled.delete(sid); return reply(id, { stopReason: 'cancelled' }); }
  let heard = '';
  // 1.87 parity markers: __PLAN__ (an ACP plan), __EDIT__ (an edit tool call with its diff), __LIMIT__ (OpenRouter's 429)
  if (text.includes('__LIMIT__')) { saveSess(sid, s); return send({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Rate limit exceeded (429). Retry after 2 seconds.' } }); }
  if (text.includes('__PLAN__')) { const u = { sessionUpdate: 'plan', entries: [{ content: 'Read the code', status: 'completed', priority: 'medium' }, { content: 'Fix the bug', status: 'in_progress', priority: 'high' }] }; notify('session/update', { sessionId: sid, update: u }); s.updates.push(u); }
  if (text.includes('__EDIT__')) {
    const eid = randomUUID(), file = path.join(s.cwd || '/tmp', 'parity.txt');
    const call = { sessionUpdate: 'tool_call', toolCallId: eid, title: 'parity.txt', kind: 'edit', status: 'pending', locations: [{ path: file }], rawInput: { filePath: file } };
    const done = { sessionUpdate: 'tool_call_update', toolCallId: eid, status: 'completed', kind: 'edit', content: [{ type: 'diff', path: file, oldText: 'old line', newText: 'new line' }] };
    notify('session/update', { sessionId: sid, update: call }); notify('session/update', { sessionId: sid, update: done }); s.updates.push(call, done);
  }
  if (text.includes('__QUESTION__')) heard = ' ' + await askPocket([{ header: 'Color', question: 'Which color?', options: [{ label: 'Blue', description: 'Cool' }, { label: 'Red', description: 'Warm' }], multiSelect: false }]);
  notify('session/update', { sessionId: sid, update: { sessionUpdate: 'tool_call_update', toolCallId: toolId, status: 'completed', title: 'echo ACP_OK' } });
  s.updates.push({ sessionUpdate: 'tool_call_update', toolCallId: toolId, status: 'completed', title: 'echo ACP_OK' });
  // OpenCode reports the session's running cost (kept with the session, so it survives a new process; not sent on load)
  s.cost = Math.round(((s.cost || 0) + FAKE_TURN_COST) * 1e9) / 1e9;
  notify('session/update', { sessionId: sid, update: { sessionUpdate: 'usage_update', used: 24000, size: 1048576, cost: { amount: s.cost, currency: 'USD' } } });
  const answer = text.includes('__CHOICES__') ? 'Tests pass. Should I merge and deploy?\n\n```choices\nMerge and deploy\nNot yet\n```' : `ran it; echo of ${text.slice(0, 40)}${heard}`;
  notify('session/update', { sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: answer } } });
  s.updates.push({ sessionUpdate: 'agent_message_chunk', messageId: 'a_' + randomUUID(), content: { type: 'text', text: answer } });
  saveSess(sid, s);
  reply(id, { stopReason: 'end_turn', usage: { inputTokens: 1000, outputTokens: 10, totalTokens: 25010, cachedReadTokens: 24000 } });
}

readline.createInterface({ input: process.stdin }).on('line', line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  // a response to one of OUR outgoing client-requests
  if (m.id != null && (m.result !== undefined || m.error !== undefined) && clientPending.has(m.id)) {
    const res = clientPending.get(m.id); clientPending.delete(m.id); res(m.result); return;
  }
  if (!m.method) return;
  if (m.id == null) { // notification
    if (m.method === 'session/cancel' && m.params?.sessionId) {
      cancelled.add(m.params.sessionId);
      // abort any permission the turn is blocked on, as a real agent does on cancel
      for (const [id, res] of clientPending) { clientPending.delete(id); res({ cancelled: true }); }
    }
    return;
  }
  switch (m.method) {
    case 'initialize': return reply(m.id, {
      protocolVersion: 1,
      agentCapabilities: { loadSession: !process.env.FAKE_ACP_NO_LOADSESSION, sessionCapabilities: { list: {}, resume: {}, fork: {}, close: {} }, promptCapabilities: { embeddedContext: true, image: true }, mcpCapabilities: { http: true, sse: true } },
      agentInfo: { name: 'FakeACP', version: '0.0.1' },
    });
    case 'session/list': {
      let files = []; try { files = fs.readdirSync(STORE).filter(f => f.endsWith('.json')); } catch { }
      const sessions = files.map(f => { const sid = decodeURIComponent(f.replace(/\.json$/, '')); let st; try { st = fs.statSync(path.join(STORE, f)); } catch { } const d = loadSess(sid) || {}; return { sessionId: sid, cwd: d.cwd || '/tmp', title: d.title || 'New session - ' + new Date(d.createdAt || Date.now()).toISOString(), updatedAt: new Date(st?.mtimeMs || Date.now()).toISOString() }; });
      return reply(m.id, { sessions });
    }
    case 'session/new': { const sid = 'ses_' + randomUUID(); const s = { updates: [], cwd: m.params?.cwd, createdAt: Date.now() }; saveSess(sid, s); return reply(m.id, { sessionId: sid, configOptions: configOptions(confOf(sid)) }); }
    case 'session/set_config_option': {
      const { sessionId, configId, value } = m.params || {}; if (!loadSess(sessionId)) return fail(m.id, 'unknown session');
      const s = confOf(sessionId);
      if (configId === 'model') {
        if (!(value in MODELS)) return fail(m.id, 'unknown model ' + value);
        if (!process.env.FAKE_ACP_IGNORE_MODEL) { s.model = value; s.effort = MODELS[value]?.start ?? null; }
      } else if (configId === 'effort') {
        if (!MODELS[s.model]?.levels.includes(value)) return fail(m.id, 'unknown effort ' + value);
        s.effort = value;
      } else return fail(m.id, 'unknown config option ' + configId);
      return reply(m.id, { configOptions: configOptions(s) });
    }
    case 'session/load': {
      if (process.env.FAKE_ACP_NO_LOADSESSION) return fail(m.id, 'loadSession not supported');
      const s = loadSess(m.params?.sessionId); if (!s) return fail(m.id, 'unknown session');
      for (const u of s.updates) notify('session/update', { sessionId: m.params.sessionId, update: u });
      // like OpenCode, a session opened in this process starts on the runtime's default model again
      conf.set(m.params.sessionId, { model: 'opencode/big-pickle', effort: null });
      return reply(m.id, { configOptions: configOptions(confOf(m.params.sessionId)) });
    }
    case 'session/prompt': return void handlePrompt(m.id, m.params || {});
    default: return fail(m.id, 'method not found: ' + m.method);
  }
});

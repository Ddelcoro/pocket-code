// acp.mjs — the ACP (Agent Client Protocol) engine adapter.
//
// A third engine alongside Claude Code and Codex: Pocket drives a model-agnostic ACP agent
// (OpenCode today — `opencode acp`) pointed at OpenRouter, so a user can pick DeepSeek V4.1
// Flash or any OpenRouter model. ACP is JSON-RPC 2.0 over stdio — the same wire shape as
// Codex's app-server — so this reuses codex.mjs's LineBuffer framing and mirrors codex.mjs's
// turn-object pattern: each turn builds an ApprovalInbox (request_permission maps straight onto
// it), streams session/update events through turn.emit to SSE subscribers, and is tracked in
// acpTurns so server.mjs's watch/approve endpoints find it. See docs/openrouter-acp-engine-spec.md.
//
// Elicitation (model questions) is declined for v1: OpenCode delivers questions as plain text
// (verified live), so there is no structured question inbox to wire yet (spec §7). fs/terminal
// are NOT advertised, so the agent stays the executor under a client-gated permission policy and
// Pocket stays the orchestrator (spec §6).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { LineBuffer } from './codex.mjs';
import { ApprovalInbox } from './approvals.mjs';
import { QuestionInbox } from './questions.mjs';
import { textBlocks } from './choices.mjs';
import { DEFAULT_CURATED } from './openrouter.mjs';

const HOME = os.homedir();

// Session-id namespace: ACP sessions are prefixed so engineForSessionId() routes them, the
// same way Codex ids carry 'cx:'. (engines.mjs already registers 'acp' with this prefix.)
export const ACP = 'acp:';
export const isAcpId = id => typeof id === 'string' && id.startsWith(ACP);
export const bareAcpId = id => isAcpId(id) ? id.slice(ACP.length) : id;

const log = (...a) => console.log(new Date().toISOString(), '[acp]', ...a);

// What Pocket advertises to the agent at initialize. Deliberately NOT fs/terminal: Pocket stays
// the orchestrator and lets the agent execute tools under its own (client-gated) permission
// policy (spec §6). elicitation.form is advertised but model questions are declined in v1.
// No elicitation: OpenCode 1.19 never sends it, and its own question tool waits on an answer ACP cannot deliver,
// so questions reach Pocket through Pocket's ask tool (acp-ask-mcp.mjs) instead.
export const CLIENT_CAPABILITIES = {};
export const PROTOCOL_VERSION = 1;
// A prompt turn may sit on a pending approval for a long time; don't time it out from under the user.
export const PROMPT_TIMEOUT_MS = Number(process.env.POCKET_ACP_TURN_TIMEOUT_MS) || 3_600_000;

// ---------- JSON-RPC-2.0-over-stdio client for one ACP agent child ----------
// Newline-delimited both ways. Requests carry an id; `method` + no id is a notification; `method`
// + id is a server->client request Pocket must answer (deferred — the handler responds via
// respond(id, result) when ready, e.g. after the user decides an approval).
export class AcpClient {
  constructor({ cmd, args = [], cwd, env = process.env, onNotify, onRequest, name = 'acp' } = {}) {
    this.name = name;
    this.onNotify = onNotify;    // (method, params) => void
    this.onRequest = onRequest;  // (method, params, id) => void — MUST call respond(id, ...) eventually
    this.seq = 0;
    this.pending = new Map();    // our outgoing request id -> {resolve, reject, timer}
    this.closed = false;
    this.buf = new LineBuffer();
    this.stderr = '';
    this.proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd, env });
    this.pid = this.proc.pid;
    this.proc.stdin.on('error', () => { });
    this.proc.stderr.on('data', d => { this.stderr = (this.stderr + d).slice(-4000); });
    this.proc.stdout.on('data', d => { for (const line of this.buf.push(d.toString())) this._line(line); });
    this.proc.on('error', e => this._fail(new Error(`acp spawn failed: ${e.message}`)));
    this.proc.on('exit', () => this._fail(new Error('acp agent exited')));
  }
  writable() { return !this.closed; }
  _fail(err) {
    if (this.closed) return;
    this.closed = true;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }
  _write(obj, cb) { try { this.proc.stdin.write(JSON.stringify(obj) + '\n', cb); } catch (e) { cb?.(e); } }
  _line(line) {
    if (!line.trim()) return;
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.id != null && (m.result !== undefined || m.error !== undefined)) {
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer); this.pending.delete(m.id);
      if (m.error) p.reject(Object.assign(new Error(m.error.message || 'acp rpc error'), { rpc: m.error }));
      else p.resolve(m.result);
    } else if (m.method && m.id == null) {
      try { this.onNotify?.(m.method, m.params || {}); } catch (e) { log(`notify handler threw: ${e.message}`); }
    } else if (m.method && m.id != null) {
      if (this.onRequest) { try { this.onRequest(m.method, m.params || {}, m.id); } catch (e) { this.respond(m.id, declineFor(m.method)); log(`request handler threw: ${e.message}`); } }
      else this.respond(m.id, declineFor(m.method)); // no handler -> fail closed
    }
  }
  // Answer a server->client request (the deferred half of an approval/elicitation).
  respond(id, result) { this._write({ jsonrpc: '2.0', id, result }); }
  request(method, params = {}, timeoutMs = 120_000) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('acp client closed'));
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this._write({ jsonrpc: '2.0', id, method, params }, e => { if (e && this.pending.has(id)) { this.pending.delete(id); clearTimeout(timer); reject(e); } });
    });
  }
  notify(method, params = {}) { this._write({ jsonrpc: '2.0', method, params }); }
  initialize(clientCapabilities = CLIENT_CAPABILITIES) { return this.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities }); }
  newSession(params) { return this.request('session/new', params); }
  loadSession(params) { return this.request('session/load', params); }
  listSessions() { return this.request('session/list', {}); }
  prompt(params, timeoutMs) { return this.request('session/prompt', params, timeoutMs); }
  // OpenCode takes the model and its reasoning effort as session config options, not as prompt fields
  // (a `model` on session/prompt is ignored, and the turn runs on OpenCode's own default model).
  setConfigOption(sessionId, configId, value) { return this.request('session/set_config_option', { sessionId, configId, value }); }
  cancel(sessionId) { this.notify('session/cancel', { sessionId }); }
  close() { this.closed = true; try { this.proc.kill('SIGTERM'); } catch { } }
}

// Fail-closed default answer to a server->client request Pocket chose not to handle.
export function declineFor(method) {
  if (method === 'session/request_permission') return { outcome: { outcome: 'cancelled' } };
  if (method === 'elicitation/create') return { outcome: 'cancelled' };
  return null; // fs/* and terminal/* are not advertised; a well-behaved agent won't call them
}

// Pick the ACP outcome payload for an allow/deny decision from the request's options[].
export function permissionOutcomes(options) {
  const opts = Array.isArray(options) ? options : [];
  const byKind = k => opts.find(o => o && o.kind === k)?.optionId;
  const allowId = byKind('allow_once') || byKind('allow_always') || opts[0]?.optionId;
  const rejectId = byKind('reject_once') || byKind('reject_always');
  return {
    allow: allowId ? { outcome: { outcome: 'selected', optionId: allowId } } : { outcome: { outcome: 'cancelled' } },
    deny: rejectId ? { outcome: { outcome: 'selected', optionId: rejectId } } : { outcome: { outcome: 'cancelled' } },
    canAllow: Boolean(allowId),
  };
}

// Normalize a session/update notification into a Pocket SSE transcript event. Text streams as
// `delta` (the UI's incremental-text event); tool calls stream as `tool`; the rest is best-effort.
export function normalizeUpdate(update) {
  if (!update || typeof update !== 'object') return null;
  const u = update.sessionUpdate;
  // session/load replays the user's own messages too (verified against real OpenCode), grouped by messageId.
  if (u === 'user_message_chunk') return { type: 'user_chunk', text: update.content?.text ?? '', messageId: update.messageId };
  if (u === 'agent_message_chunk' || u === 'agent_message') return { type: 'delta', text: update.content?.text ?? '', messageId: update.messageId };
  if (u === 'agent_thought_chunk') return { type: 'reasoning', text: update.content?.text ?? '' };
  // 1.87: an edit's ACP `diff` content (path, oldText, newText) rides along for the Changes view
  const diffs = Array.isArray(update.content) ? update.content.filter(c => c?.type === 'diff' && c.path).map(c => ({ path: c.path, old: c.oldText ?? null, new: c.newText ?? '' })) : [];
  if (u === 'tool_call') return { type: 'tool', id: update.toolCallId, title: update.title, kind: update.kind, status: update.status || 'pending', input: update.rawInput || null, path: update.locations?.[0]?.path || null, ...(diffs.length ? { diffs } : {}) };
  // Live, OpenCode sends the call first with only its folder ({title:'bash', rawInput:{cwd}}) and the command a moment later
  // in an in_progress update (verified live, 1.19.4), so updates carry the same fields and are merged by id.
  if (u === 'tool_call_update') return { type: 'tool', id: update.toolCallId, title: update.title, kind: update.kind, status: update.status, input: update.rawInput || null, path: update.locations?.[0]?.path || null, ...(diffs.length ? { diffs } : {}), update: true };
  // OpenCode's running cost for the whole session, after each model step (verified live, 1.19.4)
  if (u === 'usage_update') return { type: 'acp_usage', cost: Number.isFinite(update.cost?.amount) ? update.cost.amount : null, used: update.used ?? null, size: update.size ?? null };
  if (u === 'plan') return { type: 'plan', entries: update.entries || [] };
  if (u === 'available_commands_update') return { type: 'acp_commands', commands: (update.availableCommands || []).map(c => ({ name: c?.name, description: c?.description || '' })).filter(c => typeof c.name === 'string') };
  return null;
}

// A tool call as one of the UI's ledger lines ({t:'tool', name, detail}), the same shape Codex's items take.
const clip = (v, n = 140) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));
const TOOL_NAMES = { execute: 'Bash', read: 'Read', edit: 'Edit', delete: 'Edit', move: 'Edit', search: 'Search', fetch: 'Web', think: 'Thinking' };
const toolDetail = e => { const i = e.input || {}; return i.command || i.filePath || i.path || i.pattern || i.url || i.query || ''; };
export function toolBlock(e) {
  // a command's folder is not what it did: an execute call without its command falls back to the title, never the folder
  const detail = toolDetail(e) || (e.kind === 'execute' ? (e.title !== 'bash' ? e.title : '') : e.path || e.title) || '';
  const b = { t: 'tool', name: TOOL_NAMES[e.kind] || clip(e.title, 40) || 'Tool', detail: clip(detail) };
  // 1.87: an edit carries its full path(s) and, when OpenCode sent them, the before/after text (the Changes view's, never the phone's)
  if (Array.isArray(e.diffs) && e.diffs.length) { b.paths = [...new Set(e.diffs.map(d => d.path))]; b.changes = e.diffs.slice(0, 40).map(d => ({ path: d.path, kind: d.old == null ? 'add' : 'update', old: d.old == null ? null : String(d.old).slice(0, 40_000), new: String(d.new ?? '').slice(0, 40_000) })); }
  else if (b.name === 'Edit' && (e.input?.filePath || e.path)) b.paths = [e.input?.filePath || e.path];
  return b;
}
// What a message carries to the phone: the before/after text stays on the server for the Changes view.
export const forClient = msg => msg?.blocks?.some(b => b.changes) ? { ...msg, blocks: msg.blocks.map(({ changes, ...b }) => b) } : msg;
// What an approval card shows under its title: the command, or the files an edit touches (the shapes the
// app's approval card reads for Codex requests).
export function approvalCard(params) {
  const call = params?.toolCall || {}, i = call.rawInput || {};
  const files = [i.filePath, i.path, ...(call.locations || []).map(l => l?.path)].filter(Boolean);
  if (call.kind === 'edit' || call.kind === 'delete' || call.kind === 'move') return { kind: 'fileChange', details: { changes: [...new Set(files)].map(p => ({ path: p })), tool: call.title || null } };
  return { kind: 'command', details: { command: i.command || call.title || null, tool: call.title || null } };
}
// Merge a tool call's events (by id): later fields win, an empty input never replaces a known one.
const mergeTool = (a, e) => ({ ...a, ...Object.fromEntries(Object.entries(e).filter(([k, v]) => v != null && k !== 'update' && !(k === 'input' && !toolDetail(e) && toolDetail(a)))) });
const thinkingBlock = text => ({ t: 'tool', name: 'Thinking', detail: clip(text) });
// An ACP plan (entries of {content, status}) as the UI's checklist block, the shape Claude's TodoWrite takes.
export const planBlock = entries => ({ t: 'todo', todos: (entries || []).map(e => ({ s: ['completed', 'in_progress'].includes(e?.status) ? e.status : 'pending', c: String(e?.content || '') })) });
// Text the way the other engines show it: a trailing ```choices block becomes reply buttons.
const shownText = text => textBlocks(text);

// Fold replayed events into Pocket transcript messages. A user message is {role, text}; everything the agent
// did until the next user message is one assistant message whose blocks keep the order: Thinking and tool
// lines, then text (consecutive text chunks of one messageId are one block). Shown the way the live turn was.
export function messagesFromEvents(events) {
  const out = []; let asst = null, thought = ''; const calls = new Map(); // tool id -> { info, block }
  const flushThought = () => { if (thought.trim()) asst.blocks.push(thinkingBlock(thought)); thought = ''; };
  for (const e of events || []) {
    if (!e) continue;
    if (e.type === 'user_chunk') {
      if (asst) { flushThought(); asst = null; }
      const last = out[out.length - 1];
      if (last && last.role === 'user' && last.mid === e.messageId) last.text += e.text || '';
      else out.push({ role: 'user', text: e.text || '', mid: e.messageId });
      continue;
    }
    if (e.type === 'tool' && calls.has(e.id)) { const c = calls.get(e.id); c.info = mergeTool(c.info, e); Object.assign(c.block, toolBlock(c.info)); continue; }
    if (!['delta', 'reasoning', 'tool', 'plan'].includes(e.type) || (e.type === 'tool' && e.update)) continue;
    if (!asst) { asst = { role: 'assistant', blocks: [] }; out.push(asst); }
    if (e.type === 'reasoning') { thought += e.text || ''; continue; }
    flushThought();
    if (e.type === 'plan') { const last = asst.blocks.findLastIndex(b => b.t === 'todo'); if (last >= 0) asst.blocks[last] = planBlock(e.entries); else asst.blocks.push(planBlock(e.entries)); continue; }
    if (e.type === 'tool') { const block = toolBlock(e); asst.blocks.push(block); calls.set(e.id, { info: e, block }); continue; }
    const last = asst.blocks[asst.blocks.length - 1];
    if (last?.t === 'text' && (e.messageId == null || last.mid === e.messageId)) last.text += e.text || '';
    else asst.blocks.push({ t: 'text', text: e.text || '', mid: e.messageId });
  }
  if (asst) flushThought();
  // assistant messages render from `blocks` in the UI (msgHTML), user messages from `text`.
  return out.map(m => {
    if (m.role === 'user') return { role: 'user', text: m.text };
    const blocks = m.blocks.flatMap(({ mid, ...b }) => b.t === 'text' ? (b.text.trim() ? shownText(b.text) : []) : [b]);
    return { role: 'assistant', text: blocks.filter(b => b.t === 'text').map(b => b.text).join('\n\n'), blocks };
  }).filter(m => m.role === 'user' ? m.text.trim() : m.blocks.length);
}

// ---------- sessions + turns ----------
// sessionId (bare) -> { client, cwd, model, turn, hooks }. One child per session, kept between
// turns, so concurrent sessions are independent processes (like Codex sessions today).
export const acpSessions = new Map();
let trustedMatch = null; // 1.87: (command, cwd) -> the trusted rule it matches, or null (server.mjs sets it)
export const setTrustedMatcher = fn => { trustedMatch = fn; };
// The commands (skills) OpenCode last listed for this machine, from any of its processes, for the / list.
let knownCommands = [];
export const acpCommands = () => knownCommands;
// sessionId (bare) -> active turn. server.mjs's watch/approve/stop endpoints find turns here.
export const acpTurns = new Map();

export function acpTurnActive(sessionId) { return acpTurns.has(bareAcpId(sessionId)); }
export function ownedAcpTurn(sessionId) { return acpTurns.get(bareAcpId(sessionId)); }

// Build the Pocket turn object for an ACP session: emit→SSE subscribers, an ApprovalInbox fed by
// request_permission, tracked in acpTurns. Mirrors codex.mjs makeTurn.
function makeAcpTurn(session, { text, model, approvalMode, executionMode, hooks }) {
  const { emit, onFinish, onApproval, onQuestion, auditApproval } = hooks;
  const client = session.client;
  const turn = {
    sessionId: session.sessionId, cwd: session.cwd, startedAt: Date.now(), userText: text,
    model, approvalMode: approvalMode === 'full' ? 'full' : 'review', events: [], subs: new Set(), done: false, turnId: randomUUID(),
    client, session, onFinish, text: '', thought: '', costStart: session.costTotal ?? null, costTotal: null, usage: null,
    executionMode: executionMode === 'plan' ? 'plan' : 'work', stopped: false, stopNote: null, lastActivityAt: Date.now(), context: null, asks: new Map(),
  };
  // The reply's text and thinking since the last tool line, shown as their own message when the next tool
  // line or the end of the turn arrives, so a turn reads in order: thinking, tools, text.
  turn.tools = new Map(); // tool id -> { info (merged events), shown }
  turn.showTool = info => { turn.flush(); turn.emit({ type: 'assistant', msg: forClient({ role: 'assistant', text: '', blocks: [toolBlock(info)], ts: new Date().toISOString() }) }); };
  turn.flush = () => {
    const blocks = [];
    if (turn.thought.trim()) blocks.push(thinkingBlock(turn.thought));
    if (turn.text.trim()) blocks.push(...shownText(turn.text));
    turn.thought = ''; turn.text = '';
    if (blocks.length) turn.emit({ type: 'assistant', msg: { role: 'assistant', text: blocks.filter(b => b.t === 'text').map(b => b.text).join(''), blocks, ts: new Date().toISOString() } });
  };
  turn.emit = ev => {
    turn.events.push(ev);
    const data = `id: ${turn.events.length - 1}\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const res of turn.subs) { try { res.write(data); } catch { } }
    emit?.(ev);
  };
  turn.approvals = new ApprovalInbox({
    sessionId: () => ACP + turn.sessionId, turnId: () => turn.turnId, audit: auditApproval || (() => { }),
    write: (nativeId, result) => new Promise((resolve, reject) => {
      if (!client.writable()) return reject(new Error('Approval connection closed'));
      try { client.respond(nativeId, result); resolve(); } catch (e) { reject(e); }
    }),
    onChange: () => { turn.emit({ type: 'approvals' }); if (turn.approvals?.list().length) onApproval?.(turn); },
  });
  // Questions from Pocket's ask tool: the same inbox Claude's and Codex's questions use. The native id is the ask's
  // id; answering resolves the ask the tool is polling, skipping or ending the turn resolves it with no answer.
  turn.questions = new QuestionInbox({
    threadId: () => turn.sessionId,
    write: (reply, opts) => { const a = turn.asks.get(reply.id); if (!a) throw new Error('Question expired'); turn.asks.delete(reply.id); a.done({ answers: reply.result?.answers || {}, skipped: opts?.skipped || null }); },
    onChange: () => { turn.emit({ type: 'questions' }); if (turn.questions?.list().length) onQuestion?.(turn); },
  });
  session.turn = turn;
  acpTurns.set(turn.sessionId, turn);
  return turn;
}

// A question from Pocket's ask tool, in Claude's AskUserQuestion shape ({question, header, options[{label,
// description}], multiSelect}). Returns the ask id; the answer arrives on askState(id). Throws when the turn
// cannot take it (finished, malformed).
const askStates = new Map(); // ask id -> { state: 'pending'|'answered'|'gone', answers, at }
export function askAcpQuestion(turn, questions) {
  if (!turn || turn.done) throw Object.assign(new Error('This reply has ended.'), { status: 409 });
  const qs = (Array.isArray(questions) ? questions : []).map((q, i) => ({ id: 'question-' + i, header: String(q?.header || '').slice(0, 60), question: String(q?.question || ''),
    options: Array.isArray(q?.options) ? q.options.map(o => ({ label: String(o?.label ?? o ?? ''), description: String(o?.description || '') })).filter(o => o.label) : undefined, multiple: Boolean(q?.multiSelect) }));
  const id = randomUUID();
  const ok = turn.questions.receive({ id, method: 'item/tool/requestUserInput', params: { threadId: turn.sessionId, turnId: turn.turnId, isBlocking: true, questions: qs } }, turn.turnId);
  if (!ok) throw Object.assign(new Error('The question could not be shown.'), { status: 400 });
  askStates.set(id, { state: 'pending', at: Date.now() });
  turn.asks.set(id, { done: r => askStates.set(id, { state: 'answered', at: Date.now(), answers: Object.fromEntries(qs.map(q => [q.question, (r.answers[q.id]?.answers || [])])), skipped: r.skipped }) });
  for (const [k, v] of askStates) if (Date.now() - v.at > 86_400_000) askStates.delete(k);
  return id;
}
export const askState = id => askStates.get(id) || { state: 'gone' };
const endAsks = turn => { for (const [id] of turn.asks) askStates.set(id, { state: 'gone', at: Date.now() }); turn.asks.clear(); turn.questions?.clear(); };

// Route a live session/update + server->client request onto the turn. Set as the client handlers
// for the duration of the turn.
function wireTurnHandlers(turn) {
  const client = turn.client;
  client.onNotify = (method, params) => {
    if (method === 'session/update' && params?.sessionId === turn.sessionId) {
      turn.lastActivityAt = Date.now();
      const ev = normalizeUpdate(params.update);
      if (!ev) return;
      if (ev.type === 'acp_commands') { turn.session.commands = knownCommands = ev.commands; return; }
      if (ev.type === 'plan') { turn.flush(); turn.emit({ type: 'assistant', msg: { role: 'assistant', text: '', blocks: [planBlock(ev.entries)], ts: new Date().toISOString() } }); return; }
      if (ev.type === 'delta') { turn.text += ev.text; turn.emit(ev); return; }
      if (ev.type === 'reasoning') { turn.thought += ev.text; return; }
      if (ev.type === 'acp_usage') {
        if (ev.cost != null) turn.costTotal = ev.cost;
        if (Number.isFinite(ev.used) && Number.isFinite(ev.size)) { turn.context = turn.session.context = { used: ev.used, size: ev.size }; turn.emit({ type: 'usage' }); }
        return;
      }
      if (ev.type === 'tool') {
        const t = turn.tools.get(ev.id) || { info: {}, shown: false };
        t.info = mergeTool(t.info, ev); turn.tools.set(ev.id, t);
        if (!t.shown && (toolDetail(t.info) || (t.info.status && t.info.status !== 'pending'))) { t.shown = true; turn.showTool(t.info); }
        return;
      }
      turn.emit(ev);
    }
  };
  client.onRequest = (method, params, id) => {
    turn.lastActivityAt = Date.now();
    if (method === 'session/request_permission') {
      const { allow, deny, canAllow } = permissionOutcomes(params.options);
      // Full access: allow at once, as Claude (bypassPermissions) and Codex (approval never) run without asking.
      // OpenCode itself is configured to ask, so Review actions still shows every request as an approval card.
      if (turn.approvalMode === 'full' && canAllow) return client.respond(id, allow);
      const card = approvalCard(params);
      // 1.87: in Review actions, a command matching one of the owner's trusted read-only rules runs without a card (audited)
      if (canAllow && card.kind === 'command' && trustedMatch && card.details.command) {
        const rule = trustedMatch(String(card.details.command), turn.cwd);
        if (rule && turn.approvals.autoAllow({ nativeId: id, turnId: turn.turnId, kind: 'command', title: params.toolCall?.title || 'Run this command?', details: card.details, allow, deny, rule, tool: 'Bash' })) return;
      }
      const ok = turn.approvals.receive({
        nativeId: id, turnId: turn.turnId, kind: card.kind,
        title: params.toolCall?.title || params.title || 'Allow this action?',
        details: card.details,
        allow, deny, canAllow,
      });
      if (!ok) client.respond(id, declineFor(method)); // couldn't register (closed/old turn) -> fail closed
      return; // the response is sent later by the inbox's write when the user decides
    }
    if (method === 'elicitation/create') return client.respond(id, { outcome: 'cancelled' }); // v1: questions arrive as text
    client.respond(id, declineFor(method)); // fs/* terminal/* not advertised
  };
}

// Open (or resume) an ACP session: spawn the child, initialize, new/load the session.
async function openAcpSession({ sessionId, cwd, model, cmd, args, env, resume, instructionsFile = null, askKey = null }) {
  const client = new AcpClient({ cmd, args, cwd, env, name: sessionId || 'new' });
  try {
    await client.initialize();
    let sid = sessionId;
    // session/load requires {sessionId, cwd, mcpServers} (cwd a string). On resume the caller may
    // not know the original cwd; recover it from session/list. (Verified against real OpenCode.)
    let opened;
    if (resume && sessionId) { const c = cwd || await sessionCwd(client, sessionId); opened = await client.loadSession({ sessionId, cwd: c && !fs.existsSync(c) ? HOME : c || '/', mcpServers: [] }); } // 1.98: its folder may be gone
    else { opened = await client.newSession({ cwd, mcpServers: [] }); sid = opened?.sessionId; }
    if (!sid) throw new Error('acp: no session id');
    const session = { sessionId: sid, client, cwd, config: opened?.configOptions || [], turn: null, instructionsFile, askKey, runnerToken: env?.POCKET_RUNNER_TOKEN || null, lastActivityAt: Date.now(), commands: [], context: null };
    acpSessions.set(sid, session);
    return session;
  } catch (e) { client.close(); throw e; }
}
// 1.99: which conversation a command came from, as with Claude and Codex.
const sameToken = (a, b) => Boolean(a && b) && timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
export function sessionForRunnerToken(token) {
  for (const s of acpSessions.values()) if (sameToken(s.runnerToken, token) && !s.client.closed) return s;
  return null;
}

// Point the session at the model (and effort) this turn asked for, through OpenCode's config options.
// Fail closed: a model OpenCode does not confirm stops the turn, rather than letting it run on OpenCode's
// own default model (before 1.84.1 every OpenRouter turn ran on that default, opencode/big-pickle).
// Effort: the model's own levels; 'default' or a level the model lacks resets to the model's default.
export async function applyAcpConfig(session, { model, effort, executionMode }) {
  const opt = id => session.config.find(o => o.id === id);
  if (!model) throw new Error('No OpenRouter model was chosen for this reply.');
  // Set and confirm it every turn (one local call): nothing that resets the session between turns can
  // leave a reply on another model.
  if (opt('model') && !(opt('model').options || []).some(o => o.value === model)) throw new Error(`OpenCode does not offer ${model}. Pick another model.`);
  const r = await session.client.setConfigOption(session.sessionId, 'model', model);
  if (Array.isArray(r?.configOptions)) session.config = r.configOptions;
  const now = opt('model')?.currentValue;
  if (now !== model) throw new Error(`OpenCode did not switch to ${model}${now ? ` (it is on ${now})` : ''}, so the reply was not sent.`);
  // Plan first: OpenCode's own plan mode (edits disallowed), set every turn since a reopened session starts in build.
  const mode = opt('mode'), wantMode = executionMode === 'plan' ? 'plan' : 'build';
  if (mode && (mode.options || []).some(o => o.value === wantMode) && mode.currentValue !== wantMode) {
    const r = await session.client.setConfigOption(session.sessionId, 'mode', wantMode);
    if (Array.isArray(r?.configOptions)) session.config = r.configOptions;
  }
  const eff = opt('effort');
  if (!eff) return { model, effort: null };
  const levels = (eff.options || []).map(o => o.value);
  const want = effort && effort !== 'default' && levels.includes(effort) ? effort : levels.includes('default') ? 'default' : null;
  if (want && eff.currentValue !== want) {
    const r = await session.client.setConfigOption(session.sessionId, 'effort', want);
    if (Array.isArray(r?.configOptions)) session.config = r.configOptions;
  }
  return { model, effort: want === 'default' ? null : want };
}

// The reasoning-effort levels OpenCode offers for each OpenRouter model, read by pointing one throwaway
// session at every model in turn (all ~360 take well under a second, all local). {slug: [levels]} without
// 'default'; a model with no effort setting maps to []. The probe session lives in `cwd`, which the
// conversation list hides.
export async function probeAcpEfforts({ cmd, args, env, cwd }) {
  const client = new AcpClient({ cmd, args, cwd, env, name: 'effort-probe' });
  client.onNotify = (method, params) => { const ev = method === 'session/update' ? normalizeUpdate(params?.update) : null; if (ev?.type === 'acp_commands' && ev.commands.length) knownCommands = ev.commands; };
  try {
    await client.initialize();
    const s = await client.newSession({ cwd, mcpServers: [] });
    const models = (s?.configOptions || []).find(o => o.id === 'model')?.options?.map(o => o.value).filter(v => v.startsWith('openrouter/')) || [];
    const out = {};
    for (const m of models) {
      const r = await client.setConfigOption(s.sessionId, 'model', m);
      const eff = (r?.configOptions || []).find(o => o.id === 'effort');
      out[m] = eff ? (eff.options || []).map(o => o.value).filter(v => v !== 'default') : [];
    }
    return out;
  } finally { client.close(); }
}

// Start (or continue/resume) a turn. hooks mirror startCodexTurn: {emit, onFinish, onApproval,
// auditApproval}. Returns the turn; the reply streams through turn.emit / turn.approvals.
export async function startAcpTurn({ sessionId, cwd, text, prompt = null, images = [], model, effort, approvalMode, executionMode, costBaseline = null, cmd, args = [], env, instructionsFile = null, askKey = null, resume = false, hooks = {} }) {
  const bare = sessionId ? bareAcpId(sessionId) : null;
  let session = bare && acpSessions.get(bare);
  if (session && acpTurns.has(session.sessionId)) throw Object.assign(new Error('busy'), { code: 409 });
  if (!session) { session = await openAcpSession({ sessionId: bare, cwd, model, cmd, args, env, resume, instructionsFile, askKey }); session.costTotal = resume ? costBaseline : 0; }
  const turn = makeAcpTurn(session, { text, model, approvalMode, executionMode, hooks });
  turn.effort = effort && effort !== 'default' ? effort : null;
  wireTurnHandlers(turn);
  turn.emit({ type: 'user', msg: { role: 'user', text, ts: new Date().toISOString() } });
  // Run the prompt in the background; the HTTP caller returns 202 immediately (like the codex path).
  turn.promptDone = (async () => {
    try {
      // A turn can wait on an approval for as long as the user takes; the per-turn watchdog, not this
      // timeout, bounds a genuinely stuck turn, so allow a generous ceiling (default 120 s killed turns
      // whose approval was not answered within two minutes).
      const used = await applyAcpConfig(session, { model: turn.model, effort: turn.effort, executionMode: turn.executionMode });
      turn.effort = used.effort;
      // Pocket's instructions for this conversation, written where this OpenCode process reads them (it reads its
      // instruction files when it builds each request, verified live), so they carry the session id and today's settings.
      if (session.instructionsFile && hooks.instructions) fs.writeFileSync(session.instructionsFile, hooks.instructions(ACP + session.sessionId) || '', { mode: 0o600 });
      const blocks = [{ type: 'text', text: prompt ?? text }, ...images.filter(i => i?.data && i?.mimeType).map(i => ({ type: 'image', mimeType: i.mimeType, data: i.data }))];
      const r = await session.client.prompt({ sessionId: session.sessionId, prompt: blocks }, PROMPT_TIMEOUT_MS);
      turn.usage = r?.usage || null;
      finishAcpTurn(turn, { stopReason: r?.stopReason || 'end_turn' });
    } catch (e) {
      finishAcpTurn(turn, { stopReason: 'error', error: e.message });
    }
  })();
  return turn;
}

function finishAcpTurn(turn, result) {
  if (turn.done) return;
  turn.done = true;
  // Stopped (by you, or by the watchdog): a stop, not a finished reply, the way the other engines report it.
  if (turn.stopped || result.stopReason === 'cancelled') { turn.stopped = true; result = { ...result, stopReason: 'cancelled', error: turn.stopNote || 'Stopped by you' }; }
  turn.session.lastActivityAt = Date.now();
  endAsks(turn);
  for (const t of turn.tools.values()) if (!t.shown) { t.shown = true; turn.showTool(t.info); }
  turn.flush();
  turn.approvals?.clear();
  // Cost: OpenCode reports the session's running total, so this reply's cost is the change across it. With no
  // known starting total (a conversation reopened before Pocket kept one) there is no cost line, never a wrong one.
  if (turn.costTotal != null) turn.session.costTotal = turn.costTotal;
  const cost = turn.costTotal != null && turn.costStart != null ? Math.round(Math.max(0, turn.costTotal - turn.costStart) * 1e9) / 1e9 : null; // OpenCode's precision
  const u = turn.usage, read = Number(u?.cachedReadTokens) || 0, fresh = Number(u?.inputTokens) || 0;
  const cache = read + fresh > 0 ? { hit: read / (read + fresh) } : null;
  turn.emit({ type: 'result', ok: !turn.stopped && result.stopReason !== 'error', stopReason: result.stopReason, ...(result.error ? { error: result.error } : {}),
    ...(cost != null ? { cost } : {}), duration_ms: Date.now() - turn.startedAt, ...(cache ? { cache } : {}) });
  turn.emit({ type: 'done' });
  acpTurns.delete(turn.sessionId);
  try { turn.onFinish?.(result, turn); } catch (e) { log(`onFinish threw: ${e.message}`); }
}

export function steerAcpTurn(sessionId, text) {
  const turn = acpTurns.get(bareAcpId(sessionId));
  if (!turn) return false;
  // ACP has no mid-turn steer; cancel so the user can send a fresh message (the UI treats a
  // failed steer as "queue / send after"). Returning false lets the caller fall back to queue.
  return false;
}

export function stopAcpTurn(sessionId, note = null) {
  const turn = acpTurns.get(bareAcpId(sessionId));
  if (!turn) return false;
  turn.stopped = true; if (note) turn.stopNote = note;
  turn.approvals?.clear();
  endAsks(turn);
  try { turn.client.cancel(turn.sessionId); } catch { }
  return true;
}

export function closeAcpSession(sessionId) {
  const bare = bareAcpId(sessionId);
  const s = acpSessions.get(bare);
  if (s) { try { s.client.close(); } catch { } acpSessions.delete(bare); acpTurns.delete(bare); if (s.instructionsFile) fs.rm(s.instructionsFile, { force: true }, () => { }); }
}
// The session whose OpenCode process was started with this ask key (Pocket's ask tool presents it).
export const acpSessionByAskKey = key => [...acpSessions.values()].find(s => s.askKey && s.askKey === key) || null;
// Idle OpenCode processes (no reply running) are closed after `idleMs`, as Codex's are; the next message reopens.
export function closeIdleAcpSessions(idleMs) {
  let n = 0;
  for (const s of [...acpSessions.values()]) if (!acpTurns.has(s.sessionId) && Date.now() - (s.lastActivityAt || 0) > idleMs) { closeAcpSession(s.sessionId); n++; }
  return n;
}
// Replies with no sign of life for `quietMs` that are not waiting on you (an approval or a question).
export const stalledAcpTurns = quietMs => [...acpTurns.values()].filter(t => !t.done && Date.now() - t.lastActivityAt > quietMs && !t.approvals?.list().length && !t.questions?.list().length);

// ---------- read-only listing + transcript (a short-lived reader client) ----------
// List ACP sessions for the session picker. Spawns a throwaway reader, enumerates via session/list.
export async function listAcpSessions({ cmd, args, env, limit = 60, hideCwd = null } = {}) {
  const client = new AcpClient({ cmd, args, env, name: 'reader' });
  try {
    await client.initialize();
    const r = await client.listSessions();
    // OpenCode names a session "New session - <iso time>" until it titles it; treat that as untitled.
    const rows = (r?.sessions || []).filter(s => !hideCwd || s.cwd !== hideCwd).slice(0, limit).map(s => { const t = /^New session - /.test(s.title || '') ? '' : (s.title || ''); return { id: ACP + s.sessionId, title: t || '(untitled conversation)', untitled: !t, cwd: s.cwd || null, mtimeMs: Date.parse(s.updatedAt) || 0, provider: 'acp' }; });
    return rows;
  } finally { client.close(); }
}

// The cwd a session was created in, from session/list — session/load requires it (real OpenCode).
async function sessionCwd(client, bareSessionId) {
  try { const r = await client.listSessions(); return (r?.sessions || []).find(s => s.sessionId === bareSessionId)?.cwd || null; }
  catch { return null; }
}

// Read a session's transcript by replaying session/load into normalized events. Resolves the
// session's original cwd (session/load requires it) via session/list when not supplied.
export async function readAcpTranscript({ sessionId, cwd, cmd, args, env } = {}) {
  const bare = bareAcpId(sessionId);
  const client = new AcpClient({ cmd, args, env, name: 'reader' });
  const events = [];
  client.onNotify = (method, params) => { if (method === 'session/update' && params?.sessionId === bare) { const e = normalizeUpdate(params.update); if (e) events.push(e); } };
  try {
    await client.initialize();
    const c = cwd || await sessionCwd(client, bare);
    await client.loadSession({ sessionId: bare, cwd: c || '/', mcpServers: [] });
    return events;
  } finally { client.close(); }
}

// ---------- runtime discovery + opt-in config ----------
// Resolve the ACP runtime (OpenCode) launch command. POCKET_ACP_CMD overrides it (with
// POCKET_ACP_ARGS, default "acp"); otherwise look for `opencode` in the usual spots and on PATH.
// Returns { cmd, args } or null when no runtime is installed — mirrors codex.mjs findCodex.
export function findAcpRuntime(env = process.env) {
  const explicit = (env.POCKET_ACP_CMD || '').trim();
  if (explicit) return { cmd: explicit, args: (env.POCKET_ACP_ARGS || 'acp').split(/\s+/).filter(Boolean) };
  const home = env.HOME || HOME;
  const fixed = [path.join(home, '.npm-global', 'bin', 'opencode'), '/usr/local/bin/opencode', '/usr/bin/opencode'];
  const onPath = (env.PATH || '').split(path.delimiter).filter(Boolean).map(d => path.join(d, 'opencode'));
  const bin = [...fixed, ...onPath].find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
  return bin ? { cmd: bin, args: ['acp'] } : null;
}

// Opt-in gate: the ACP engine is OFF unless POCKET_ACP_ENABLE is set AND a runtime is found, so
// default installs are unaffected until an operator turns it on. POCKET_ACP_MODELS adds curated
// slugs beyond the probed default. Returns { cmd, args, curated } or null.
export function acpConfig(env = process.env) {
  if (!/^(1|true|yes|on)$/i.test(String(env.POCKET_ACP_ENABLE || '').trim())) return null;
  const rt = findAcpRuntime(env);
  if (!rt) return null;
  const extra = (env.POCKET_ACP_MODELS || '').split(/[\s,]+/).filter(Boolean);
  return { cmd: rt.cmd, args: rt.args, curated: [...new Set([...DEFAULT_CURATED, ...extra])] };
}

// Whether server.mjs should offer/route the ACP engine (opt-in + runtime present).
export const acpAvailable = (env = process.env) => Boolean(acpConfig(env));

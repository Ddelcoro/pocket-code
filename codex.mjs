// codex.mjs — Codex provider for Pocket.
//
// Same shape as the Claude side (one shared session store, turns owned by this daemon
// so the phone can sleep), but Codex ships a first-party JSON-RPC API — `codex
// app-server` — so instead of parsing transcripts we speak the protocol the VS Code
// extension speaks. Threads created in code-server show up here and vice versa.
//
// Two facts drive the design, both verified against codex-cli 0.153.4 on 2026-09-06:
//   1. READS never take a lock. `thread/items/list` returns a thread the extension is
//      actively holding, without disturbing it. So the session list and every
//      transcript are always available, whatever else is running.
//   2. WRITES take a per-thread writer lock (~/.codex/thread-writer-locks/<id>.lock,
//      flock). While code-server has a thread open it owns that lock and `thread/resume`
//      fails with "already has an active writer". Since 1.7 Pocket keeps one app-server
//      per thread between turns, so it holds that lock until the session closes (idle,
//      Close session, a settings change) — code-server can't write to the thread meanwhile.

import {AgentActivity} from './subagents.mjs';
import {agentEnv} from './environment.mjs';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {QuestionInbox} from './questions.mjs';
import {ApprovalInbox,codexApproval,codexPermissionSettings} from './approvals.mjs';
import {estimateWindow} from './usage.mjs';
import {descendantCpu,signalGroup,BOOT_ID,startTime,commandLine,bootedAt,HAS_PROC} from './proctree.mjs';
import { pipeDirs, ensurePipeDir } from './pipes.mjs';
import {CHOICE_INSTRUCTIONS,textBlocks} from './choices.mjs';
import { rolloutState, contextUsed, cachedTokens, TTL_CODEX, TTL_CODEX_NOTE } from './codex-rollout.mjs';

const HOME = os.homedir();
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, '.codex');
const LOCK_DIR = path.join(CODEX_HOME, 'thread-writer-locks');
// Codex's own usage visibility store — kept in a file separate from the Claude side's
// usage-state.json so the two providers never race to overwrite one shared file.
const DATA_DIR = process.env.POCKET_DATA_DIR || import.meta.dirname;
const USAGE_FILE = path.join(DATA_DIR, 'codex-usage-state.json');
const plainObject = o => Boolean(o) && typeof o === 'object' && !Array.isArray(o);
// 1.73.8: a file whose root or `context` is not an object (hand-edited, truncated) reads as empty instead of stopping the daemon at start.
function loadCodexUsage() { try { const o = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); if (plainObject(o)) return o; } catch { } return { context: {}, rateLimits: null }; }
const codexUsage = loadCodexUsage();
if (!plainObject(codexUsage.context)) codexUsage.context = {};
function saveCodexUsage() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = USAGE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(codexUsage), { mode: 0o600 });
    fs.renameSync(tmp, USAGE_FILE);
  } catch { /* best effort — usage is a convenience view */ }
}
// Resolve the binary once: explicit env, the usual install spots, then PATH. A box with no
// Codex at all resolves to null — and the provider stays off. (2026-09-09: on a box with
// no codex, the old fallback to the bare name 'codex' reported "available", the boot-time
// poll spawned it, and the unhandled ENOENT crash-looped the whole server.)
function findCodex() {
  if (process.env.CODEX_BIN) return fs.existsSync(process.env.CODEX_BIN) ? process.env.CODEX_BIN : null;
  const fixed = [path.join(HOME, '.npm-global', 'bin', 'codex'), '/usr/local/bin/codex', '/usr/bin/codex'];
  const onPath = (process.env.PATH || '').split(path.delimiter).filter(Boolean).map(d => path.join(d, 'codex'));
  return [...fixed, ...onPath].find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || null;
}
export let CODEX_BIN = findCodex();
export function setCodexBinary(bin){CODEX_BIN=bin;}
export const CX = 'cx:'; // id namespace: Codex thread ids are UUID-shaped too, so the
                         // prefix — not a regex — is what tells the two providers apart
export const isCodexId = id => typeof id === 'string' && id.startsWith(CX);
export const bareId = id => isCodexId(id) ? id.slice(CX.length) : id;
export const codexAvailable = () => Boolean(CODEX_BIN);
// Identity of an installed binary through its symlinks: npm upgrades replace the package
// dir, so the resolved file's inode/mtime change even though the path doesn't.
export function binStamp(bin) {
  try { const s = fs.statSync(fs.realpathSync(bin)); return `${s.ino}:${s.mtimeMs}`; } catch { return null; }
}

const log = (...a) => console.log(new Date().toISOString(), '[codex]', ...a);

// The fail-closed answer to a server→client request Pocket cannot or will not relay.
function declineFor(method) {
  if(method==='item/tool/requestUserInput')return {answers:{}};
  if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(method))return {decision:'decline'};
  if(method==='item/permissions/requestApproval')return {permissions:{},scope:'turn'};
  if(method==='mcpServer/elicitation/request')return {action:'cancel',content:null};
  if (/[Aa]pproval/.test(method)) return { decision: 'denied' };
  return {};
}

// Line framing for an app-server's stdout. One reply can be a single JSON line of many
// megabytes (a page of a long thread's items came to 17 MB on 2026-10-16) arriving in
// 64 KB chunks. Rejoining and re-splitting the whole pending text on every chunk made
// the cost quadratic: 3.9 s of blocked event loop for that one reply, with every tab
// waiting behind it. Only the new chunk is scanned; partial text is kept as pieces and
// joined once, when its newline arrives.
export class LineBuffer {
  constructor() { this.parts = []; }
  push(chunk) {
    const lines = [];
    let start = 0, nl;
    while ((nl = chunk.indexOf('\n', start)) >= 0) {
      const piece = chunk.slice(start, nl);
      lines.push(this.parts.length ? this.parts.join('') + piece : piece);
      this.parts.length = 0;
      start = nl + 1;
    }
    if (start < chunk.length) this.parts.push(start ? chunk.slice(start) : chunk);
    return lines;
  }
}
// ---------- JSON-RPC over stdio ----------
// Newline-delimited JSON both ways. Requests carry an id; anything with a `method` and
// no `id` is a notification (the streaming channel).
export class AppServer { // 1.79: exported for side chats
  constructor({ name = 'pocket', detached = false, onNotify, onRequest, transport } = {}) {
    this.name = name;
    this.onNotify = onNotify;
    this.onRequest = onRequest;
    this.pending = new Map(); // id -> {resolve, reject, timer}
    // Ids stay unique across server restarts: a reattached app-server may still answer
    // the previous server's requests, and those replies must not match ours.
    this.nextId = Date.now();
    this.lines = new LineBuffer();
    this.closed = false;
    if (transport) { // session process: stdin is a named pipe, stdout a log file (see spawnTransport)
      this.transport = transport;
      this.pid = transport.pid;
      transport.onData = c => this._feed(c);
      transport.onExit = code => this._exited(code);
      return;
    }
    this.proc = spawn(CODEX_BIN, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'], detached, env: agentEnv(process.env),
    });
    if (detached) this.proc.unref();
    this.pid = this.proc.pid;
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', c => this._feed(c));
    this.proc.stderr.on('data', c => { const s = String(c).trim(); if (s) log(`${name} stderr: ${s.slice(0, 300)}`); });
    // A spawn failure (binary missing, not executable) surfaces as an 'error' event; without
    // a listener Node throws it as an uncaught exception and takes the server down.
    this.proc.on('error', e => {
      this.closed = true;
      log(`${name} spawn failed: ${e.message}`);
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error(`app-server unavailable: ${e.message}`)); }
      this.pending.clear();
      this.onExit?.(-1);
    });
    // 1.73.8: 'exit' can arrive before the last stdout chunk; wait for stdout to end (at most half a second) so a reply
    // written just before the process exited still settles its request.
    this.proc.on('exit', code => {
      if (this.proc.stdout.readableEnded) return this._exited(code);
      const t = setTimeout(() => this._exited(code), 500);
      this.proc.stdout.once('end', () => { clearTimeout(t); setImmediate(() => this._exited(code)); });
    });
    this.proc.stdin.on('error', () => { }); // EPIPE if it dies mid-write
  }

  _feed(chunk) {
    for (const line of this.lines.push(chunk)) {
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (!m || typeof m !== 'object' || Array.isArray(m)) continue; // 1.73.3: `null`, a number or a string parses but is not a frame
      if (m.id != null && (m.result !== undefined || m.error !== undefined)) {
        const p = this.pending.get(m.id);
        if (!p) continue;
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.error) p.reject(Object.assign(new Error(m.error.message || 'rpc error'), { rpc: m.error }));
        else p.resolve(m.result);
      } else if (m.method && m.id == null) {
        try { this.onNotify?.(m.method, m.params || {}); } catch { }
      } else if (m.method && m.id != null) {
        // Owned turns can relay native questions; other request kinds fail closed.
        if(this.onRequest?.(m))continue;
        this._write({ jsonrpc: '2.0', id: m.id, result: this._declineFor(m.method) });
      }
    }
  }

  // Unknown or malformed requests must never be auto-approved.
  _declineFor(method) { return declineFor(method); }

  _exited(code) {
    if (this.exitedOnce) return; this.exitedOnce = true;
    this.closed = true;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('app-server exited')); }
    this.pending.clear();
    this.onExit?.(code);
  }

  writable() {
    if (this.closed) return false;
    return this.transport ? this.transport.writable() : !(this.proc.stdin.destroyed || this.proc.stdin.writableEnded);
  }

  _write(obj, cb) {
    if (this.closed) throw new Error('app-server closed');
    const line = JSON.stringify(obj) + '\n';
    if (this.transport) this.transport.write(line, cb); else this.proc.stdin.write(line, cb);
  }

  notify(method, params = {}) {
    try { this._write({ jsonrpc: '2.0', method, params }); } catch { }
  }

  request(method, params = {}, timeoutMs = 60_000) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('app-server closed'));
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      // 1.73.8: a write that fails (EPIPE, a closed pipe) rejects its request at once instead of at the timeout.
      const failed = e => { if (!this.pending.has(id)) return; this.pending.delete(id); clearTimeout(timer); reject(e); };
      try { this._write({ jsonrpc: '2.0', id, method, params }, e => { if (e) failed(e); }); }
      catch (e) { failed(e); }
    });
  }

  async init() {
    const r = await this.request('initialize', {
      clientInfo: { name: 'pocket', title: 'Pocket', version: '1.0' },
      capabilities: { experimentalApi: true },
    }, 30_000);
    this.notify('initialized', {});
    return r;
  }

  close() {
    this.closed = true;
    // 1.73.8: requests still waiting are answered now; a process that does not exit would otherwise leave them to their timeouts.
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('app-server closed')); }
    this.pending.clear();
    if (this.transport) { this.transport.close(); return; }
    try { this.proc.stdin.end(); } catch { }
    try { this.proc.kill(); } catch { }
  }
}

// ---------- shared read connection ----------
// One warm process answers every list/read. It never resumes a thread, so it never
// competes with code-server for a lock.
// It is long-lived, so an in-place `npm i -g @openai/codex` upgrade would leave it running
// the old build forever (2026-09-25: model/list still served the pre-upgrade catalog 4 days
// after the upgrade). Each read checks the install's fingerprint and respawns on change.
// Session processes are unaffected — each thread gets its own app-server.
let reader = null, readerReady = null, readerStamp = null;
async function readConn() {
  if (reader && !reader.closed && binStamp(CODEX_BIN) !== readerStamp) {
    log('codex binary changed since the reader started — respawning on the new build');
    reader.close(); reader = null; modelCache = { at: 0, list: [] };
  }
  if (reader && !reader.closed) { await readerReady; return reader; }
  readerStamp = binStamp(CODEX_BIN);
  // handlers clear only their own instance — a retired reader exiting late must not
  // null out its replacement
  const r = reader = new AppServer({ name: 'reader' });
  r.onExit = code => { log(`reader exited (${code}) — will respawn on next read`); if (reader === r) reader = null; };
  readerReady = r.init().catch(e => { log(`reader init failed: ${e.message}`); r.close(); if (reader === r) reader = null; throw e; }); // 1.73.7: close it, or a wedged one keeps running
  await readerReady;
  return r;
}
async function rpc(method, params, timeoutMs) {
  const c = await readConn();
  try { return await c.request(method, params, timeoutMs); }
  catch (e) {
    if (/closed|exited/.test(e.message)) { // one transparent retry across a respawn
      if (reader === c) reader = null; // 1.73.7: only the failed one; a concurrent retry may already have a live replacement
      const c2 = await readConn();
      return c2.request(method, params, timeoutMs);
    }
    throw e;
  }
}

// A held lock means some other surface (code-server, a terminal, `codex exec`) owns
// writes to that thread right now. We can still read it; we just can't send.
export function threadLocked(threadId) {
  const f = path.join(LOCK_DIR, `${threadId}.lock`);
  let fd;
  try { fd = fs.openSync(f, 'r+'); } catch { return false; } // no lock file = never opened
  try {
    // No flock in node core; the app-server itself is the authority. Fall back to
    // "lock file touched recently and a codex process is alive" — cheap and good
    // enough for a UI hint. The real answer comes from thread/resume failing.
    const st = fs.fstatSync(fd);
    return Date.now() - st.mtimeMs < 24 * 3600_000;
  } catch { return false; } finally { try { fs.closeSync(fd); } catch { } }
}

// ---------- item → Pocket display model ----------
// The client renders {role:'user',text} and {role:'assistant',blocks:[…]} where a block
// is {t:'text'} or {t:'tool',name,detail}. Codex items map onto that cleanly; anything
// unrecognized becomes a ledger line rather than disappearing.
const clip = (s, n = 140) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim().slice(0, n));

// Reply suggestions ride on the thread's developer instructions. A Codex config that sets its own
// developer_instructions keeps them: Pocket never replaces an operator's instructions.
let extraInstructions = () => '';
let trustedMatch = null; // 1.87: (command, cwd) -> the trusted rule it matches, or null (server.mjs sets it)
export const setTrustedMatcher = fn => { trustedMatch = fn; };
export const setExtraInstructions = fn => { extraInstructions = fn; }; // 1.29: the server adds the projects line when that feature is on
// 1.39: Settings says so when an operator's own developer_instructions keep Pocket's lines (projects, files, tasks, vault) from reaching Codex.
export function instructionsOverridden() { try { return /^\s*developer_instructions\s*=/m.test(fs.readFileSync(path.join(CODEX_HOME, 'config.toml'), 'utf8')); } catch { return false; } }
function choiceInstructions(threadId = null) {
  try { if (/^\s*developer_instructions\s*=/m.test(fs.readFileSync(path.join(CODEX_HOME, 'config.toml'), 'utf8'))) return {}; } catch { }
  const parts = [process.env.POCKET_CHOICES !== '0' ? CHOICE_INSTRUCTIONS : '', extraInstructions(threadId)].filter(Boolean);
  return parts.length ? { developerInstructions: parts.join(' ') } : {};
}

function itemBlocks(it) {
  switch (it.type) {
    case 'agentMessage':
      return it.text?.trim() ? textBlocks(it.text) : [];
    case 'reasoning': {
      // Codex keeps summaries separate from raw reasoning; show the summary only, and
      // only when there is one (most items come back empty).
      const parts = [...(it.summary || []), ...(it.content || [])]
        .map(p => typeof p === 'string' ? p : p?.text || '').filter(Boolean);
      return parts.length ? [{ t: 'tool', name: 'Thinking', detail: clip(parts.join(' ')) }] : [];
    }
    case 'commandExecution': {
      const cmd = (it.command || '').replace(/^\/bin\/(ba)?sh\s+-l?c\s+/, '').replace(/^(['"])([\s\S]*)\1$/, '$2'); // 1.87: without the shell's quotes
      const bad = it.exitCode != null && it.exitCode !== 0;
      return [{ t: 'tool', name: 'Bash', detail: clip(cmd) + (bad ? ` (exit ${it.exitCode})` : '') }];
    }
    case 'fileChange': {
      // 1.87: full paths (Results, file cards and auto-keep read them, as they read Claude's Edit and Write) and each
      // file's diff, which the Changes view shows; the diffs never go to the phone with the conversation (forClient).
      const changes = (it.changes || []).filter(c => c?.path).slice(0, 40);
      const paths = changes.map(c => c.path);
      return [{ t: 'tool', name: 'Edit', detail: (paths[0] || '') + (paths.length > 1 ? ` +${paths.length - 1} more` : ''), paths,
        changes: changes.map(c => ({ path: c.path, kind: c.kind?.type || 'update', ...(c.kind?.move_path ? { to: c.kind.move_path } : {}), diff: String(c.diff || '').slice(0, 40_000), ...(String(c.diff || '').length > 40_000 ? { trunc: true } : {}) })) }];
    }
    case 'plan': // 1.87: Plan first's plan: its text, as the reply
      return it.text?.trim() ? textBlocks(it.text) : [];
    case 'pocketPlan': // 1.87: the checklist from turn/plan/updated, kept in the transcript cache as this item
      return Array.isArray(it.plan) && it.plan.length ? [planTodo(it.plan)] : [];
    case 'webSearch':
      return [{ t: 'tool', name: 'Web', detail: clip(it.query || it.action?.url || '') }];
    case 'mcpToolCall':
      return [{ t: 'tool', name: `${it.server || 'mcp'}.${it.tool || ''}`, detail: clip(JSON.stringify(it.arguments || {})) }];
    case 'collabAgentToolCall':
      return [{ t: 'tool', name: it.tool || 'agent', detail: clip(it.prompt || '') }];
    case 'subAgentActivity':
      return [{ t: 'tool', name: 'Subagent', detail: `${(it.agentPath || '').split('/').pop() || 'agent'} ${it.kind || ''}`.trim() }];
    case 'imageView':
      return [{ t: 'tool', name: 'Image', detail: clip(it.path || '') }];
    case 'sleep':
      return [{ t: 'tool', name: 'Sleep', detail: it.durationMs ? `${Math.round(it.durationMs / 1000)}s` : '' }];
    case 'enteredReviewMode': // 1.87: /review
      return [{ t: 'tool', name: 'Review', detail: clip(it.review || 'reviewing the changes') }];
    case 'exitedReviewMode':
      return it.review?.trim() ? textBlocks(it.review) : [];
    case 'contextCompaction':
      return [{ t: 'tool', name: 'Compact', detail: 'context compacted' }];
    case 'error':
      return [{ t: 'text', text: `⚠︎ ${clip(it.message || it.text || 'error', 600)}` }];
    default:
      return it.type ? [{ t: 'tool', name: it.type, detail: '' }] : [];
  }
}

// A user message can carry non-text blocks (images); keep the text, note the rest.
// 1.87: a plan update as the UI's checklist block, the shape Claude's TodoWrite takes (statuses pending/inProgress/completed).
export const planTodo = plan => ({ t: 'todo', todos: plan.map(p => ({ s: p?.status === 'inProgress' ? 'in_progress' : p?.status === 'completed' ? 'completed' : 'pending', c: String(p?.step || '') })) });
// What a message carries to the phone: the diffs stay on the server for the Changes view.
export const forClient = msg => msg?.blocks?.some(b => b.changes) ? { ...msg, blocks: msg.blocks.map(({ changes, ...b }) => b) } : msg;

function userText(it) {
  const c = it.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter(b => b?.type === 'text').map(b => b.text || '').join('\n');
}

// 1.21: Codex items carry no time, but their turn id is a UUIDv7 whose first 48 bits are the turn's start in ms.
// That is enough to place "New since …" in a conversation. Not a v7 id → no time.
export function uuid7Time(id) {
  const m = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-/i.exec(String(id || ''));
  if (!m) return undefined;
  const ms = parseInt(m[1] + m[2], 16);
  return ms > 1.5e12 && ms < 4e12 ? new Date(ms).toISOString() : undefined;
}
export function normalizeItem(it, ts) {
  if (!it || typeof it !== 'object') return null;
  try {
    if (it.type === 'userMessage') {
      let txt = userText(it).trim();
      if (!txt) return null;
      // 1.87: the attachment note as file chips, as Claude's messages show it
      let files;
      const am = txt.match(/\n\n\[Attached files? — read as needed:\n([\s\S]*?)\n\]\s*$/);
      if (am) { files = am[1].split('\n').filter(Boolean).map(p => ({ n: p.split('/').pop(), p })); txt = txt.slice(0, am.index).trim(); }
      return { role: 'user', text: txt, ...(files ? { files } : {}), ts };
    }
    const blocks = itemBlocks(it);
    return blocks.length ? { role: 'assistant', blocks, ts } : null;
  } catch { return null; }
}

// Consecutive assistant items are separate rows in the store but one bubble in the UI —
// merge them so a turn reads as a document, not as 40 fragments.
function mergeAssistant(msgs) {
  const out = [];
  for (const m of msgs) {
    const prev = out[out.length - 1];
    if (m.role === 'assistant' && prev?.role === 'assistant') prev.blocks.push(...m.blocks);
    else out.push(m);
  }
  return out;
}

// ---------- session list ----------
const iso = secs => secs ? new Date(secs * 1000).toISOString() : undefined;

export function promptOnlyName(t) {
  const name = String(t.name || '').trim(), preview = String(t.preview || '').trim();
  if (!name) return Boolean(preview);
  if (name.length > 80) return true;
  return Boolean(preview) && (preview === name || preview.startsWith(name.slice(0, 40)) && name.length >= 40);
}
function threadToSession(t) {
  const title = t.name || clip(t.preview, 120) || '(untitled conversation)';
  return {
    id: CX + t.id,
    provider: 'codex',
    title,
    // 1.19: Pocket may generate a short title (server.mjs finishTitle). Codex often stores the whole first
    // message as the thread name (1.19.1), so a name that is just the request still counts as untitled.
    untitled: promptOnlyName(t),
    prompt: promptOnlyName(t) ? String(t.preview || t.name).slice(0, 1500) : undefined,
    cwd: t.cwd || null,
    mtimeMs: (t.updatedAt || t.recencyAt || t.createdAt || 0) * 1000,
    model: t.model || undefined,
    source: t.source || undefined,
  };
}

// thread/list's default mode re-scans the JSONL rollouts to repair thread metadata, which
// grows with the whole store — 5.4s per list on 2,800 rollouts / 4.5 GB (2026-09-28). The
// state DB answers the same rows in ~20ms. Repair still happens: pollCodexActivity() runs
// the scanning form over the newest threads every 15s, off the request path.
// Codex builds that don't know useStateDbOnly get the scanning call instead.
async function threadList(params, timeoutMs) {
  try {
    return await rpc('thread/list', { ...params, useStateDbOnly: true }, timeoutMs);
  } catch (e) {
    if (e?.rpc?.code !== -32602 && e?.rpc?.code !== -32601) throw e;
    return rpc('thread/list', params, timeoutMs);
  }
}

export async function listCodexSessions(limit = 60) {
  // sorted like the merged list (by last update), so a long-lived thread resumed today
  // isn't pushed out of the page by newer-created ones
  const r = await threadList({ limit: Math.min(limit, 200), archived: false, sortKey: 'updated_at' }, 30_000);
  const rows = (r?.data || []).filter(t => t && t.id && !t.ephemeral);
  // subagent threads (spawned by a parent) are machinery, not sessions the user started
  const sessions = rows.filter(t => !t.parentThreadId).map(threadToSession);
  await attachCache(sessions);
  return sessions;
}

export async function searchCodexSessions(term, limit = 40) {
  const r = await threadList({ limit, archived: false, searchTerm: term }, 30_000);
  return (r?.data || []).filter(t => t && t.id && !t.parentThreadId).map(threadToSession);
}

// ---------- transcript ----------
// Codex has two thread history formats. Threads written by 0.153.4+ (Pocket's own) are
// "paginated" and answer `thread/items/list`. Threads written by an older build — the
// code-server extension bundles 0.153.0 — are "legacy" and the app-server refuses to
// page them (-32601 "thread/items/list is not supported yet"), which used to surface on
// the phone as "Session not found" (2026-09-09). For those, `thread/read` with
// `includeTurns: true` still hands back the whole history, so fall back to it.
const legacyThreads = new Set(); // threadIds known to need the fallback

function isLegacyError(e) {
  return e?.rpc?.code === -32601 || /not supported yet/i.test(e?.message || '');
}

async function readLegacyItems(threadId) {
  const r = await rpc('thread/read', { threadId, includeTurns: true }, 60_000);
  const t = r?.thread || r;
  return (t?.turns || []).flatMap(turn => (turn?.items || []).map(it => (it && typeof it === 'object' && turn.id ? Object.assign(it, { __turnId: turn.id }) : it))).filter(Boolean);
}

// All items of a thread, oldest first, whichever format it is in.
async function listAllItems(threadId) {
  const items = [];
  if (!legacyThreads.has(threadId)) {
    try {
      let cursor = null, pages = 0;
      do {
        const r = await rpc('thread/items/list', { threadId, limit: 200, ...(cursor ? { cursor } : {}) }, 60_000);
        for (const row of r?.data || []) { const it = row.item || row; if (row.turnId && it && typeof it === 'object') it.__turnId = row.turnId; items.push(it); }
        cursor = r?.nextCursor || null;
      } while (cursor && ++pages < 20);
      return items;
    } catch (e) {
      if (!isLegacyError(e)) throw e;
      legacyThreads.add(threadId);
      log(`thread=${threadId} is legacy-format; reading via thread/read`);
    }
  }
  return readLegacyItems(threadId);
}

// The open conversation polls its agent activity every 5 s. Reading the whole thread each
// time (18 MB and 5.5 s of Codex time for a 50 MB rollout, 2026-10-16) held up every other
// request on the server. After one full walk the agent-bearing items are kept per thread;
// later polls fetch only the newest page and merge it, walking again only when the page is
// all news (more items landed than one page holds). Legacy-format threads, which the
// app-server cannot page, are reread at most every AGENT_LEGACY_MS.
const AGENT_TYPES = new Set(['collabAgentToolCall', 'subAgentActivity']);
const AGENT_PAGE = 50, AGENT_LEGACY_MS = 15_000, AGENT_CACHE_THREADS = 40;
const agentItemCache = new Map(); // threadId -> { byKey: Map<key,item>, seen: Set<id>, at }
function rememberAgentItem(c, it, i) {
  if (!it || typeof it !== 'object') return;
  if (it.id) c.seen.add(it.id);
  if (AGENT_TYPES.has(it.type)) c.byKey.set(it.id || 'history-' + i, it);
}
// 1.73.8: concurrent reads of one thread share one in-flight read, so an older full walk can no longer replace a newer merge.
const agentReads = new Map();
function agentItems(threadId) {
  if (!agentReads.has(threadId)) agentReads.set(threadId, agentItemsNow(threadId).finally(() => agentReads.delete(threadId)));
  return agentReads.get(threadId);
}
async function agentItemsNow(threadId) {
  const c = agentItemCache.get(threadId);
  if (c && legacyThreads.has(threadId) && Date.now() - c.at < AGENT_LEGACY_MS) return [...c.byKey.values()];
  if (c && !legacyThreads.has(threadId)) {
    const r = await rpc('thread/items/list', { threadId, limit: AGENT_PAGE, sortDirection: 'desc' }, 30_000);
    const rows = (r?.data || []).map(row => { const it = row.item || row; if (row.turnId && it && typeof it === 'object') it.__turnId = row.turnId; return it; }).reverse();
    const known = rows.some(it => it?.id && c.seen.has(it.id));
    if (rows.length < AGENT_PAGE || known) { // the page overlaps what is held: merge and done
      rows.forEach((it, i) => rememberAgentItem(c, it, c.seen.size + i));
      c.at = Date.now();
      return [...c.byKey.values()];
    }
  }
  const items = await listAllItems(threadId);
  const fresh = { byKey: new Map(), seen: new Set(), at: Date.now() };
  items.forEach((it, i) => rememberAgentItem(fresh, it, i));
  agentItemCache.delete(threadId); agentItemCache.set(threadId, fresh);
  if (agentItemCache.size > AGENT_CACHE_THREADS) agentItemCache.delete(agentItemCache.keys().next().value);
  return [...fresh.byKey.values()];
}

export async function readCodexAgents(threadId) {
  const items = await agentItems(threadId);
  const turn = codexTurns.get(threadId);
  const byId = new Map(items.map((it,i)=>[it.id || 'history-'+i,it]));
  for (const [id,it] of turn?.agentItems || []) byId.set(id,it);
  const activity = new AgentActivity();
  for (const it of byId.values()) activity.codex(it);
  return activity.snapshot({confirmed:Boolean(turn)});
}

// ---------- transcript cache (1.53.5) ----------
// Opening a Codex conversation used to walk the whole thread oldest-first. A thread that
// had generated images inline (six `imageGeneration` items, 4.7 MB of base64 each, in a
// 51.6 MB rollout on 2026-10-16) took 26 s to read, and Pocket never shows those bytes.
// Now a thread is read newest-first in small pages, only as far back as the view needs;
// each item is reduced to its display message as soon as it is parsed, so image payloads
// are dropped at once; and the result is kept per thread, in memory and on disk, so a later
// open fetches one page and merges it. Items Pocket's own turns stream in are added as
// they complete, so a thread Pocket drives is never cold. Paging further back happens on
// demand (deep find, results, summaries ask for more than the view).
const TX_PAGE = 40, TX_MEM_THREADS = 30, TX_REFRESH_PAGES = 50, TX_LEGACY_MS = 15_000, TX_FILES_KEPT = 300;
const TX_DIR = path.join(DATA_DIR, 'codex-transcripts');
const transcripts = new Map(); // threadId -> cache
const txSaves = new Map(); // threadId -> timer
function txFile(threadId) { return path.join(TX_DIR, threadId.replace(/[^0-9a-f-]/gi, '_') + '.json'); }
function txLoad(threadId) {
  try {
    const o = JSON.parse(fs.readFileSync(txFile(threadId), 'utf8'));
    if (o?.v !== 1 || !Array.isArray(o.entries)) return null;
    // 1.73.8: a hand-corrupted row is dropped, not thrown on
    return { entries: o.entries.filter(e => e && typeof e === 'object'), seen: new Set(Array.isArray(o.seen) ? o.seen : []), olderCursor: o.olderCursor ?? null, legacy: Boolean(o.legacy), at: o.at || 0, dirty: false };
  } catch { return null; }
}
function txSave(threadId, c) {
  c.dirty = true;
  if (txSaves.has(threadId)) return;
  const t = setTimeout(() => {
    txSaves.delete(threadId);
    if (!c.dirty) return; c.dirty = false;
    try {
      fs.mkdirSync(TX_DIR, { recursive: true, mode: 0o700 });
      const tmp = txFile(threadId) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, entries: c.entries, seen: [...c.seen], olderCursor: c.olderCursor, legacy: c.legacy, at: c.at }), { mode: 0o600 });
      fs.renameSync(tmp, txFile(threadId));
    } catch (e) { log(`transcript cache save failed thread=${threadId}: ${e.message}`); }
  }, 1000);
  t.unref(); txSaves.set(threadId, t);
}
// Startup sweep: keep the newest TX_FILES_KEPT files, so the directory cannot grow without bound.
export function pruneTranscriptCache() {
  let names; try { names = fs.readdirSync(TX_DIR).filter(n => n.endsWith('.json')); } catch { return; }
  if (names.length <= TX_FILES_KEPT) return;
  const stamped = names.map(n => { try { return { n, m: fs.statSync(path.join(TX_DIR, n)).mtimeMs }; } catch { return null; } }).filter(Boolean).sort((a, b) => b.m - a.m);
  for (const { n } of stamped.slice(TX_FILES_KEPT)) { try { fs.unlinkSync(path.join(TX_DIR, n)); } catch { } }
}
function txGet(threadId) {
  let c = transcripts.get(threadId);
  if (!c) {
    c = txLoad(threadId) || { entries: [], seen: new Set(), olderCursor: null, legacy: legacyThreads.has(threadId), at: 0, dirty: false, empty: true };
    if (c.legacy) legacyThreads.add(threadId);
  }
  transcripts.delete(threadId); transcripts.set(threadId, c); // most recent last
  if (transcripts.size > TX_MEM_THREADS) transcripts.delete(transcripts.keys().next().value);
  return c;
}
// One stored row per item that shows something: the display message and the ids needed to
// recognise the item again. Items that show nothing still count as seen.
function txEntry(row) {
  const it = row?.item || row; if (!it || typeof it !== 'object') return null;
  const turnId = row.turnId || it.__turnId || null;
  return { id: it.id || null, turnId, msg: normalizeItem(it, uuid7Time(turnId)) };
}
function txPut(c, e, { front = false } = {}) {
  if (!e) return;
  if (e.id) {
    if (c.seen.has(e.id)) { const i = c.entries.findIndex(x => x.id === e.id); if (i >= 0) { if (e.msg) c.entries[i] = e; else c.entries.splice(i, 1); } else if (e.msg) c.entries.push(e); return; }
    c.seen.add(e.id);
  }
  if (e.msg) front ? c.entries.unshift(e) : c.entries.push(e);
}
async function txPage(threadId, cursor) {
  const r = await rpc('thread/items/list', { threadId, limit: TX_PAGE, sortDirection: 'desc', ...(cursor ? { cursor } : {}) }, 60_000);
  return { rows: r?.data || [], next: r?.nextCursor || null };
}
// Legacy-format threads cannot be paged: the whole history, at most every TX_LEGACY_MS.
async function txLegacy(threadId, c) {
  if (c.at && Date.now() - c.at < TX_LEGACY_MS) return;
  const items = await readLegacyItems(threadId);
  c.entries = []; c.seen = new Set(); c.legacy = true; c.olderCursor = null;
  for (const it of items) txPut(c, txEntry(it));
  c.at = Date.now(); delete c.empty; txSave(threadId, c);
}
// Newest pages until one overlaps what is held (its items are refreshed in place: a command
// gains its exit code when it completes) or the thread ends. A fresh cache stops after
// `need` messages and remembers where to continue backwards.
async function txRefresh(threadId, c, need) {
  if (c.notes) return txRefreshNow(threadId, c, need); // the inner pass of a reset
  // 1.76.3: an item noted while a page is on its way is applied after the pages, so the page's older copy (a command still
  // running) cannot replace the completed one. Before, the held page won and no later refresh reread it.
  c.notes = [];
  try { await txRefreshNow(threadId, c, need); }
  finally { const notes = c.notes; delete c.notes; if (notes.length && !c.empty) { for (const e of notes) txPut(c, e); c.at = Date.now(); txSave(threadId, c); } }
}
async function txRefreshNow(threadId, c, need) {
  const fresh = [];
  let cursor = null, pages = 0, hitKnown = false;
  do {
    const { rows, next } = await txPage(threadId, cursor);
    for (const row of rows) {
      const e = txEntry(row); if (!e) continue;
      if (e.id && c.seen.has(e.id)) { hitKnown = true; txPut(c, e); } else fresh.push(e);
    }
    cursor = next; pages++;
    if (c.empty && fresh.filter(e => e.msg).length >= need) break;
  } while (cursor && !hitKnown && pages < TX_REFRESH_PAGES);
  if (!hitKnown && !c.empty && cursor) { // more than TX_REFRESH_PAGES pages of news: start over
    c.entries = []; c.seen = new Set(); c.empty = true; c.olderCursor = null; // 1.73.8: items noted meanwhile are kept (c.notes, applied by txRefresh)
    return txRefreshNow(threadId, c, need);
  }
  fresh.reverse().forEach(e => txPut(c, e));
  if (c.empty) { c.olderCursor = cursor; delete c.empty; }
  c.at = Date.now(); txSave(threadId, c);
}
// Older pages, on demand, until `need` messages are held or the thread's start is reached.
async function txExtend(threadId, c, need) {
  let pages = 0;
  while (c.olderCursor && c.entries.length < need && pages < 200) {
    const { rows, next } = await txPage(threadId, c.olderCursor);
    for (const row of rows) txPut(c, txEntry(row), { front: true });
    c.olderCursor = next; pages++;
  }
  if (pages) { c.at = Date.now(); txSave(threadId, c); }
}
// A completed item from a turn Pocket runs lands in the cache at once, when the cache exists.
export function noteCodexItem(threadId, turnId, item) {
  const c = transcripts.get(threadId);
  if (c?.notes && !c.legacy) { c.notes.push(txEntry({ turnId, item })); return; } // a refresh is under way: applied once its pages are in
  if (!c || c.empty || c.legacy) return;
  txPut(c, txEntry({ turnId, item })); c.at = Date.now(); txSave(threadId, c);
}
// 1.73.8: reads of one thread run one after another; two at once used to page and reset the same cache across awaits.
const txReads = new Map();
export function readCodexThread(threadId, maxMsgs = 400) {
  const p = (txReads.get(threadId) || Promise.resolve()).catch(() => { }).then(() => readCodexThreadNow(threadId, maxMsgs));
  txReads.set(threadId, p);
  p.finally(() => { if (txReads.get(threadId) === p) txReads.delete(threadId); }).catch(() => { });
  return p;
}
async function readCodexThreadNow(threadId, maxMsgs) {
  const c = txGet(threadId);
  if (c.legacy || legacyThreads.has(threadId)) await txLegacy(threadId, c);
  else {
    try {
      await txRefresh(threadId, c, maxMsgs);
      if (c.entries.length < maxMsgs) await txExtend(threadId, c, maxMsgs);
    } catch (e) {
      if (!isLegacyError(e)) throw e;
      legacyThreads.add(threadId); c.legacy = true; c.at = 0;
      await txLegacy(threadId, c);
    }
  }
  // mergeAssistant appends blocks into the first bubble of a run: give it copies, the cache keeps the originals
  const msgs = mergeAssistant(c.entries.filter(e => e.msg).map(e => ({ ...e.msg, ...(e.msg.blocks ? { blocks: [...e.msg.blocks] } : {}) })));
  return { msgs: msgs.slice(-maxMsgs), total: msgs.length, itemCount: c.seen.size, complete: !c.olderCursor };
}

export async function codexThreadMeta(threadId) {
  const r = await rpc('thread/read', { threadId }, 30_000).catch(() => null);
  const t = r?.thread || r;
  if (!t?.id) return null;
  return threadToSession(t);
}

// ---------- sessions and turns ----------
// 1.7: one app-server per thread, kept between turns, so MCP connections, tools and
// question handling stay up the way they do in code-server. While it is open it holds
// Codex's per-thread writer lock: code-server can't write to that thread until Pocket
// closes it (after IDLE_CLOSE_MS idle, the Close session control, or a settings change).
// Spawned detached so a `pm2 restart pocket-claude` mid-turn doesn't kill the work — the
// same rule the Claude side learned the hard way on 2026-08-14.
function msSetting(name, dflt) { // same rule as server.mjs: milliseconds, 0 disables, junk → default
  const raw = (process.env[name] ?? '').trim();
  if (!raw) return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}
const IDLE_CLOSE_MS = msSetting('POCKET_IDLE_CLOSE_MS', 60 * 60_000);
const STALL_MS = msSetting('POCKET_STALL_MS', 30 * 60_000);
export const codexTurns = new Map(); // threadId -> active turn
export const codexSessions = new Map(); // threadId -> {conn, approvalMode, cwd, model, effort, turn, hooks}

export function codexTurnActive(threadId) { return codexTurns.has(threadId); }

// Session processes read a named pipe and write to a log file instead of pipes to this
// server, so a Pocket restart doesn't end them (with plain pipes the app-server exits
// within a second of losing its parent — verified 2026-10-04). A keeper process holds
// the pipe's write end open across restarts; closing = kill keeper + end our end → EOF.
// Own directories: the Claude side's startup sweep removes pipes it doesn't own. 1.73.2: the
// pipes live outside the data directory (pipes.mjs); pre-1.73.2 sessions keep theirs here.
const CX_LOG_DIR = path.join(DATA_DIR, 'turnlogs-codex');
const CX_PIPES = pipeDirs(DATA_DIR), CX_PIPE_DIR = CX_PIPES.codex;
const cxFiles = key => ({
  out: path.join(CX_LOG_DIR, key + '.out.ndjson'), err: path.join(CX_LOG_DIR, key + '.err.log'),
  fifo: path.join(CX_PIPE_DIR, key + '.in.fifo'), legacyFifo: path.join(CX_LOG_DIR, key + '.in.fifo'),
  meta: path.join(CX_LOG_DIR, key + '.session.json'),
});
const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const DRAIN_MAX = 1 << 20;

export function makeTransport({ pid, keeperPid, key, files, writer, offset, skipBefore = 0 }) { // exported for tests
  const stale = new Map(); // requests logged before a restart, minus those the log shows resolved
  const t = {
    pid, keeperPid, key, files, writer, offset, rem: '', onData: null, onExit: null, exited: false,
    write: (line, cb) => writer.write(line, cb),
    writable: () => !writer.destroyed && !writer.writableEnded,
    close() { try { process.kill(-keeperPid, 'SIGTERM'); } catch { } try { writer.end(); } catch { } },
    drain() {
      let size; try { size = fs.statSync(files.out).size; } catch { return; }
      if (size <= t.offset) return;
      const fh = fs.openSync(files.out, 'r');
      try {
        // 1.73.7: at most DRAIN_MAX per pass, cut on a character boundary; the next 150 ms pass reads on. A long log read on
        // adoption no longer stalls the daemon in one synchronous read.
        let n = Math.min(size - t.offset, DRAIN_MAX);
        const buf = Buffer.alloc(n);
        fs.readSync(fh, buf, 0, n, t.offset);
        if (n < size - t.offset) { let k = n; while (k > 0 && (buf[k - 1] & 0xC0) === 0x80) k--; if (k > 0 && buf[k - 1] >= 0xC0) k--; if (k > 0) n = k; }
        let at = t.offset - Buffer.byteLength(t.rem);
        t.offset += n;
        const lines = (t.rem + buf.toString('utf8', 0, n)).split('\n');
        t.rem = lines.pop() ?? '';
        for (const l of lines) {
          const lineAt = at; at += Buffer.byteLength(l) + 1;
          // requests the app-server sent the previous server can't be relayed from here;
          // the ones it never saw resolved are declined below so the turn carries on
          if (lineAt < skipBefore) {
            let o; try { o = JSON.parse(l); } catch { }
            if (o?.method && o.id != null) { stale.set(o.id, o.method); continue; }
            if (o?.method === 'serverRequest/resolved' && o.params?.requestId != null) stale.delete(o.params.requestId);
          }
          if (l.trim()) t.onData?.(l + '\n');
        }
        if (skipBefore && t.offset >= skipBefore && stale.size && !t.exited) {
          for (const [id, method] of stale) { try { t.write(JSON.stringify({ jsonrpc: '2.0', id, result: declineFor(method) }) + '\n'); log(`declined a pre-restart ${method} request`); } catch { } }
          stale.clear();
        }
      } finally { fs.closeSync(fh); }
    },
    exit(code) {
      if (t.exited) return;
      t.exited = true;
      clearInterval(t.timer); clearInterval(t.poll);
      try { let last = -1; while (t.offset !== last) { last = t.offset; t.drain(); } } catch (e) { log(`codex transport drain failed: ${e.message}`); }
      try { writer.destroy(); } catch { }
      try { process.kill(-keeperPid, 'SIGTERM'); } catch { }
      for (const f of [files.fifo, files.meta]) { try { fs.unlinkSync(f); } catch { } }
      t.onExit?.(code);
    },
  };
  // 1.73.3: a throw inside a timer is an uncaught exception that would take the daemon down; it costs the frame, not the process.
  t.timer = setInterval(() => { try { t.drain(); } catch (e) { log(`codex transport drain failed: ${e.message}`); } }, 150);
  return t;
}

// 1.39: each session process carries a runner token in its environment, so a pocket-vault call from inside a turn
// can be tied to its session; the server maps the token back through codexSessions.
function spawnTransport(extraEnv = {}) {
  fs.mkdirSync(CX_LOG_DIR, { recursive: true, mode: 0o700 });
  const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const files = cxFiles(key);
  for (const f of [files.out, files.err]) fs.writeFileSync(f, '', { mode: 0o600 });
  ensurePipeDir(CX_PIPE_DIR, CX_PIPES.top);
  execFileSync('mkfifo', ['-m', '600', files.fifo]);
  const hold = fs.openSync(files.fifo, fs.constants.O_RDWR); // never blocks; lets the read end open
  const inFd = fs.openSync(files.fifo, 'r');
  const outFd = fs.openSync(files.out, 'a'), errFd = fs.openSync(files.err, 'a');
  const proc = spawn(CODEX_BIN, ['app-server', '--listen', 'stdio://'], { stdio: [inFd, outFd, errFd], detached: true, env: { ...agentEnv(process.env), ...extraEnv } });
  fs.closeSync(inFd); fs.closeSync(outFd); fs.closeSync(errFd);
  proc.unref();
  const keeper = spawn('sh', ['-c', 'while kill -0 "$1" 2>/dev/null; do sleep 5; done', 'pocket-keeper', String(proc.pid)], { detached: true, stdio: ['ignore', hold, 'ignore'], env: agentEnv(process.env) }); // 1.73.7: not the daemon's secrets
  keeper.unref();
  const writer = fs.createWriteStream(null, { fd: hold });
  writer.on('error', () => { });
  const t = makeTransport({ pid: proc.pid, keeperPid: keeper.pid, key, files, writer, offset: 0 });
  t.pidStart = startTime(proc.pid); t.keeperStart = startTime(keeper.pid);
  proc.on('exit', code => t.exit(code));
  proc.on('error', () => t.exit(-1));
  return t;
}

function writeSessionMeta(s) {
  const t = s.conn?.transport, turn = s.turn;
  if (!t || !s.threadId || s.exited) return;
  const meta = {
    threadId: s.threadId, cliBin:s.cliBin||null, pid: t.pid, keeperPid: t.keeperPid, key: t.key, bootId: BOOT_ID, pidStart: t.pidStart ?? null, keeperStart: t.keeperStart ?? null, approvalMode: s.approvalMode, cwd: s.cwd, model: s.model, effort: s.effort, runnerToken: s.runnerToken || null,
    turn: turn ? { turnId: turn.turnId, startedAt: turn.startedAt, userText: turn.userText, offset: turn.offset, executionMode: turn.executionMode } : null,
    waitingForInput: Boolean(turn && (turn.questions?.list().length || turn.approvals?.list().length || turn.inputUnavailable || turn.approvalUnavailable)),
    waitingForApproval: Boolean(turn?.approvals?.list().length || turn?.approvalUnavailable),
  };
  // 1.73.7: written whole and renamed into place; a torn file could not be adopted and its app-server kept the writer lock.
  try { fs.writeFileSync(t.files.meta + '.tmp', JSON.stringify(meta), { mode: 0o600 }); fs.renameSync(t.files.meta + '.tmp', t.files.meta); } catch { }
}
// 1.73.7: a recorded pid is signalled or adopted only when it is provably the process Pocket started: same boot (boot id, or
// for a pre-1.73.7 file, written after this boot began) and, when recorded, the same start time. After a reboot the kernel
// reuses pids, and a stale file used to make Pocket SIGTERM unrelated process groups at boot.
// 1.81 (#171): on macOS there is no boot id and BOOTED_AT was always null, so every record looked like an earlier boot's:
// the record was dropped and its app-server kept the thread's writer lock. Without /proc a recorded start time is the proof
// (sameProcess compares it with the live process's, from ps); a record without one falls back to its mtime against
// kern.boottime. `here` stands in for this machine in tests.
const BOOTED_AT = bootedAt();
export function sameBoot(m, file, here = { proc: HAS_PROC, bootId: BOOT_ID, bootedAt: BOOTED_AT }) {
  if (m.bootId) return m.bootId === here.bootId;
  if (!here.proc && m.pidStart) return true;
  if (here.bootedAt == null) return false;
  try { return fs.statSync(file).mtimeMs > here.bootedAt; } catch { return false; }
}
const sameProcess = (pid, start, legacy) => Boolean(pid) && pidAlive(pid) && (start ? startTime(pid) === start : legacy);

// After a Pocket restart: reattach to session processes that are still running and sweep
// files nothing uses. `hooksFor(threadId)` supplies the server's per-thread callbacks.
export function adoptCodexSessions(hooksFor) {
  let entries = []; try { entries = fs.readdirSync(CX_LOG_DIR); } catch { return; }
  const live = new Set();
  for (const f of entries.filter(n => n.endsWith('.session.json'))) {
    let m; try { m = JSON.parse(fs.readFileSync(path.join(CX_LOG_DIR, f), 'utf8')); } catch { continue; }
    if (!m || typeof m !== 'object' || typeof m.key !== 'string' || !/^[a-z0-9]+$/.test(m.key)) continue;
    const files = cxFiles(m.key);
    const boot = sameBoot(m, path.join(CX_LOG_DIR, f)), legacy = !m.bootId;
    const ours = boot && sameProcess(m.pid, m.pidStart, legacy) && commandLine(m.pid).includes('app-server');
    if (!m.threadId || !ours) {
      if (boot && sameProcess(m.keeperPid, m.keeperStart, legacy) && commandLine(m.keeperPid).includes('pocket-keeper')) signalGroup(m.keeperPid, 'SIGTERM');
      for (const x of [files.meta, files.fifo, files.legacyFifo]) { try { fs.unlinkSync(x); } catch { } }
      log(`codex session ended while the server was down thread=${m.threadId}${boot ? '' : ' (from an earlier boot; nothing signalled)'}`);
      continue;
    }
    let writer;
    if (!fs.existsSync(files.fifo) && fs.existsSync(files.legacyFifo)) files.fifo = files.legacyFifo; // started before 1.73.2
    try { writer = fs.createWriteStream(null, { fd: fs.openSync(files.fifo, fs.constants.O_RDWR) }); writer.on('error', () => { }); }
    catch { try { process.kill(-m.pid, 'SIGTERM'); } catch { } continue; } // unreachable: let it go
    let size = 0; try { size = fs.statSync(files.out).size; } catch { }
    const offset = m.turn ? Math.min(m.turn.offset || 0, size) : size;
    const t = makeTransport({ pid: m.pid, keeperPid: m.keeperPid, key: m.key, files, writer, offset, skipBefore: size });
    t.pidStart = m.pidStart ?? startTime(m.pid); t.keeperStart = m.keeperStart ?? (commandLine(m.keeperPid).includes('pocket-keeper') ? startTime(m.keeperPid) : null);
    t.poll = setInterval(() => { if (!pidAlive(m.pid)) t.exit(null); }, 1000);
    const s = { threadId: m.threadId, cliBin:m.cliBin||(CODEX_BIN?.includes('/cli-runtimes/')?null:CODEX_BIN), approvalMode: m.approvalMode, cwd: m.cwd, model: m.model, effort: m.effort, turn: null, hooks: hooksFor(m.threadId), lastActivityAt: Date.now(), runnerToken: typeof m.runnerToken === 'string' ? m.runnerToken : null };
    wireSession(s, new AppServer({ name: `codex ${m.threadId}`, transport: t, onNotify: (method, params) => onSessionNotify(s, method, params), onRequest: request => onSessionRequest(s, request) }));
    codexSessions.set(s.threadId, s);
    live.add(m.key);
    if (m.turn) {
      const turn = makeTurn(s, { text: m.turn.userText, executionMode: m.turn.executionMode, hooks: s.hooks, offset });
      // A request the app-server sent before the restart was skipped above; the turn is
      // blocked on it until the user stops it. Say so instead of showing "Running".
      Object.assign(turn, { turnId: m.turn.turnId, startedAt: m.turn.startedAt || turn.startedAt, adopted: true,
        inputUnavailable: Boolean(m.waitingForInput) && !m.waitingForApproval, approvalUnavailable: Boolean(m.waitingForApproval) });
      writeSessionMeta(s);
    } else scheduleIdle(s);
    log(`adopted codex session thread=${m.threadId} pid=${m.pid} turn=${Boolean(m.turn)}`);
  }
  for (const f of fs.readdirSync(CX_LOG_DIR)) {
    if (live.has(f.split('.')[0])) continue;
    const full = path.join(CX_LOG_DIR, f);
    if (f.endsWith('.in.fifo')) { try { fs.unlinkSync(full); } catch { } continue; }
    if (/\.(out\.ndjson|err\.log)$/.test(f)) { try { if (Date.now() - fs.statSync(full).mtimeMs > 48 * 3600_000) fs.unlinkSync(full); } catch { } }
  }
  let pipes = []; try { pipes = fs.readdirSync(CX_PIPE_DIR); } catch { }
  for (const f of pipes) if (f.endsWith('.in.fifo') && !live.has(f.split('.')[0])) { try { fs.unlinkSync(path.join(CX_PIPE_DIR, f)); } catch { } }
}

function finish(turn, ev) {
  if (turn.done) return;
  turn.done = true;
  ownedFinishedAt.set(turn.threadId,Date.now());
  if(ownedFinishedAt.size>1000)ownedFinishedAt.delete(ownedFinishedAt.keys().next().value);
  const priorActivity=extSeen.get(turn.threadId);if(priorActivity)priorActivity.at=0;
  turn.questions?.clear();
  turn.approvals?.clear();
  turn.emit(ev);
  turn.emit({ type: 'done' });
  if (codexTurns.get(turn.threadId) === turn) codexTurns.delete(turn.threadId);
  const s = turn.session;
  if (s && s.turn === turn) { s.turn = null; writeSessionMeta(s); scheduleIdle(s); }
  else if (!s) setTimeout(() => { try { turn.conn.close(); } catch { } }, 500); // never opened a session
  // the daemon's own follow-ups (push, queue drain) must never be able to kill it
  try { turn.onFinish?.(ev, turn); } catch (e) { log(`onFinish threw thread=${turn.threadId}: ${e.message}`); }
}

function scheduleIdle(s) {
  clearTimeout(s.idleTimer);
  if (s.turn || s.closing || s.exited || !(IDLE_CLOSE_MS > 0)) return;
  s.idleTimer = setTimeout(() => { if (!s.turn) closeCodexSession(s, 'idle'); }, IDLE_CLOSE_MS);
}

// Resolves once the app-server has exited, i.e. the writer lock is free again.
// 1.39: the session a runner token belongs to, for pocket-vault calls made from inside a Codex turn.
const sameToken = (a, b) => Boolean(a && b) && timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest()); // 1.73.3: constant time
export function sessionForRunnerToken(token) {
  for (const s of codexSessions.values()) if (sameToken(s.runnerToken, token) && !s.exited) return s;
  return null;
}
export function closeCodexSession(s, why) {
  if (!s) return Promise.resolve();
  if (s.exited) return Promise.resolve();
  if (s.closeFailed && !pidAlive(s.conn.pid)) return Promise.resolve(); // 1.89: gone since the close gave up on it
  if (!s.closing) {
    s.closing = true;
    clearTimeout(s.idleTimer);
    log(`codex session closing thread=${s.threadId} pid=${s.conn.pid} reason=${why}`);
    // 1.73.7: an app-server that ignores SIGTERM is killed after 5 s (it held the thread's writer lock, so later turns got 423).
    // 1.89 (F-12): the close resolves only on a confirmed exit (the exit hook, or the pid gone). Still running 5 s after the
    // SIGKILL, it rejects instead, so a caller that awaits it (a settings change) reports that rather than starting a
    // replacement beside the old process; it never waits forever. Callers that do not await it are not affected.
    s.closed = new Promise((resolve, reject) => {
      s.exitResolve = resolve;
      setTimeout(() => {
        if (s.exited) return resolve();
        log(`codex session did not exit after SIGTERM; killing thread=${s.threadId} pid=${s.conn.pid}`);
        signalGroup(s.conn.pid, 'SIGKILL'); if (s.conn.transport?.keeperPid) signalGroup(s.conn.transport.keeperPid, 'SIGKILL');
        const pid = s.conn.pid, until = Date.now() + 5000;
        const poll = setInterval(() => {
          if (s.exited || !pidAlive(pid)) { clearInterval(poll); return resolve(); }
          if (Date.now() < until) return;
          clearInterval(poll); s.closeFailed = true;
          log(`codex session still running after SIGKILL thread=${s.threadId} pid=${pid}`);
          reject(Object.assign(new Error('The previous Codex process for this conversation has not exited yet, so a new one was not started. Try again in a minute; if this keeps happening, restart Pocket.'), { code: 423 }));
        }, 250);
      }, 5000);
    });
    s.closed.catch(() => { }); // handled here for the callers that do not await it
    try { process.kill(-s.conn.pid, 'SIGTERM'); } catch { } // its MCP servers go with it
    s.conn.close();
  }
  return s.closed;
}

// A turn object wired to the session's connection. `autonomous` turns are ones Codex
// started without a message from us.
function makeTurn(s, { text, model, effort, executionMode = 'work', hooks, autonomous = false, offset }) {
  const { emit, onFinish, onQuestion, onApproval, auditApproval } = hooks;
  const turn = {
    threadId: s.threadId, cwd: s.cwd, startedAt: Date.now(), userText: text, model, effort,
    events: [], subs: new Set(), queue: [], turnId: null, done: false, onFinish, executionMode, approvalMode: s.approvalMode, approvalItems: new Map(),
    conn: s.conn, session: s, autonomous, effectiveModel: model || s.model, effectiveEffort: effort || s.effort || null,
    baseline: descendantCpu(s.conn.pid).pids,
    offset: offset ?? (() => { try { return fs.statSync(s.conn.transport.files.out).size; } catch { return 0; } })(),
  };
  // events fan out to SSE subscribers exactly like the Claude side
  turn.emit = ev => {
    turn.events.push(ev);
    const data = `id: ${turn.events.length - 1}\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const res of turn.subs) { try { res.write(data); } catch { } }
    emit?.(ev);
  };
  const conn = s.conn;
  turn.questions=new QuestionInbox({threadId:()=>turn.threadId,write:reply=>conn._write(reply),onChange:()=>{writeSessionMeta(s);turn.emit({type:'questions'});if(turn.questions?.list().length)onQuestion?.(turn);}});
  turn.approvals=new ApprovalInbox({sessionId:()=>CX+turn.threadId,turnId:()=>turn.turnId,audit:auditApproval,write:(id,result)=>new Promise((resolve,reject)=>{
    if(!conn.writable())return reject(new Error('Approval connection closed'));
    try{conn._write({jsonrpc:'2.0',id,result},e=>e?reject(e):resolve());}catch(e){reject(e);}
  }),onChange:()=>{writeSessionMeta(s);turn.emit({type:'approvals'});if(turn.approvals?.list().length)onApproval?.(turn);}});
  clearTimeout(s.idleTimer);
  s.turn = turn;
  s.lastActivityAt = Date.now();
  codexTurns.set(turn.threadId, turn);
  writeSessionMeta(s);
  return turn;
}

function onSessionNotify(s, method, params) {
  // App-server also streams child threads. A child's completion must never finish
  // the parent turn, replace its turn id, or charge its usage to the parent.
  // Parent-owned subAgentActivity items still pass through normally.
  if (params?.threadId && s.threadId && params.threadId !== s.threadId) return;
  s.lastActivityAt = Date.now();
  if (!s.turn && method === 'turn/started' && s.threadId) { // Codex started a turn by itself
    makeTurn(s, { text: '', hooks: s.hooks, autonomous: true });
    log(`codex turn start (started by the agent) thread=${s.threadId}`);
  }
  if (s.turn) {
    onTurnNotify(s.turn, method, params);
    if (method === 'turn/started') writeSessionMeta(s);
  } else if (method === 'account/rateLimits/updated') mergeCodexRateLimits(params?.rateLimits);
}
// 1.82: a request from one of this reply's subagent threads. Codex sends it with the agent's own thread and turn ids,
// which the inboxes would refuse (and the connection would then decline it, so the agent never got an answer). It is
// re-homed on the parent reply and labelled with the agent's name. Threads are known from the collaboration items
// the reply has streamed; anything else keeps failing closed.
export function agentThreadName(turn, threadId) {
  if (!turn || typeof threadId !== 'string' || !threadId || threadId === turn.threadId) return null;
  for (const it of turn.agentItems?.values() || []) {
    if (it.type === 'subAgentActivity' && it.agentThreadId === threadId) return String(it.agentPath || '').split('/').pop() || 'Subagent';
    if (it.type === 'collabAgentToolCall' && (Array.isArray(it.receiverThreadIds) ? it.receiverThreadIds : []).includes(threadId)) return String(it.agentsStates?.[threadId]?.name || it.agentsStates?.[threadId]?.agentPath || '').split('/').pop() || 'Subagent';
  }
  return null;
}
export function rehomeAgentRequest(turn, request) {
  const agent = agentThreadName(turn, request?.params?.threadId);
  if (!agent) return { request, agent: null };
  return { request: { ...request, params: { ...request.params, threadId: turn.threadId, turnId: turn.turnId } }, agent };
}
function onSessionRequest(s, request) {
  s.lastActivityAt = Date.now();
  const turn = s.turn;
  if (!turn) return false;
  const { request: req, agent } = rehomeAgentRequest(turn, request);
  if(turn.questions?.receive(req,turn.turnId,{agent}))return true;
  const approval=codexApproval(req,turn);
  // 1.87: in Review actions, a command matching one of the owner's trusted read-only rules runs without a card (audited),
  // as Claude's do. Codex wraps commands in a login shell; the rule sees the command itself.
  if(approval?.kind==='command'&&turn.approvalMode==='review'&&trustedMatch){
    const cmd=(Array.isArray(approval.details?.command)?approval.details.command.join(' '):String(approval.details?.command||'')).replace(/^\/bin\/(ba)?sh\s+-l?c\s+/,'').replace(/^(['"])([\s\S]*)\1$/,'$2');
    const rule=cmd?trustedMatch(cmd,turn.cwd):null;
    if(rule&&turn.approvals?.autoAllow({...approval,rule,tool:'Bash'}))return true;
  }
  return approval ? turn.approvals?.receive({...approval,agent}) || false : false;
}
function wireSession(s, conn) {
  s.conn = conn;
  conn.onExit = () => {
    s.exited = true;
    clearTimeout(s.idleTimer);
    if (codexSessions.get(s.threadId) === s) codexSessions.delete(s.threadId);
    log(`codex session exit thread=${s.threadId} pid=${conn.pid}`);
    if (s.turn) finish(s.turn, { type: 'result', ok: false, error: s.turn.stalled ? `Stopped: no activity for ${Math.round(STALL_MS / 60_000)} minutes` : s.turn.stopped ? 'Stopped by you' : 'codex exited' });
    s.exitResolve?.();
  };
}

async function openCodexSession({ threadId, forkFrom, cwd, model, approvalMode, hooks, onForked, launch }) {
  const policyConfig = launch?.key ? { config: launch.config } : {}; // 1.92: the context limit and subagent model (context-policy.mjs)
  const s = { threadId, cliBin:CODEX_BIN, approvalMode, cwd, turn: null, hooks, lastActivityAt: Date.now(), runnerToken: randomBytes(16).toString('hex'), policyKey: launch?.key || '' };
  const conn = new AppServer({
    name: `codex ${threadId || 'new'}`, transport: spawnTransport({ POCKET_RUNNER_TOKEN: s.runnerToken, ...(threadId ? { POCKET_SESSION_ID: 'cx:' + threadId } : {}) }),
    onNotify: (method, params) => onSessionNotify(s, method, params),
    onRequest: request => onSessionRequest(s, request),
  });
  s.conn = conn;
  conn.onExit = () => s.exitResolve?.(); // until the session is set up
  try {
    await conn.init();
    if (threadId) {
      // sandbox/approval ride on the resume, not the turn: turn/start's sandboxPolicy is
      // a tagged union, and setting it here keeps one code path for both entry points.
      const resumed = await conn.request('thread/resume', {
        threadId, ...codexPermissionSettings(approvalMode), ...(cwd ? { cwd } : {}), ...choiceInstructions(threadId), ...policyConfig,
      }, 60_000);
      s.model = resumed.model; s.effort = resumed.reasoningEffort || null; s.cwd = resumed.cwd || cwd;
    } else if (forkFrom) {
      // 1.79 Branch: a new, saved thread that starts with everything in `forkFrom`. This process forks it, so it holds
      // the new thread's writer lock exactly as a resume would; the source thread is only read.
      const r = await conn.request('thread/fork', {
        threadId: forkFrom, excludeTurns: true, ...codexPermissionSettings(approvalMode), ...(cwd ? { cwd } : {}), ...choiceInstructions(),
        ...(model ? { model } : {}), ...policyConfig,
      }, 60_000);
      s.model = r.model; s.effort = r.reasoningEffort || null; s.cwd = r.cwd || cwd;
      s.threadId = r?.thread?.id;
      if (!s.threadId) throw new Error('thread/fork returned no id');
      // 1.89 (F-3): the fork is saved from here on, so the caller records its lineage now, not after turn/start answers
      // (a restart in between left a branch with no parent).
      try { onForked?.(s.threadId); } catch (e) { log(`branch record failed thread=${s.threadId}: ${e.message}`); }
    } else {
      const r = await conn.request('thread/start', {
        cwd, ...codexPermissionSettings(approvalMode), ...choiceInstructions(),
        ...(model ? { model } : {}), ...policyConfig,
      }, 60_000);
      s.model = r.model; s.effort = r.reasoningEffort || null;
      s.threadId = r?.thread?.id || r?.threadId;
      if (!s.threadId) throw new Error('thread/start returned no id');
    }
  } catch (e) {
    try { process.kill(-conn.pid, 'SIGTERM'); } catch { }
    conn.close();
    // "already has an active writer" is the one failure worth naming precisely: the
    // thread is open somewhere else and the fix is a human action, not a retry.
    if (/active writer/i.test(e.message)) {
      throw Object.assign(new Error('This thread is open in another surface (code-server or a terminal). Close it there to send from Pocket.'), { code: 423 });
    }
    throw e;
  }
  wireSession(s, conn);
  codexSessions.set(s.threadId, s);
  writeSessionMeta(s);
  log(`codex session start thread=${s.threadId} pid=${conn.pid} resume=${Boolean(threadId)}`);
  return s;
}

export async function startCodexTurn({ threadId, forkFrom, cwd, text, model, effort, executionMode = 'work', approvalMode='review', attachments, action = null, emit, onFinish, onQuestion, onApproval, auditApproval, onForked, launch = null }) {
  const existing = threadId && codexTurns.get(threadId);
  if (existing) throw Object.assign(new Error('busy'), { code: 409 });
  const hooks = { emit, onFinish, onQuestion, onApproval, auditApproval };
  let s = threadId && codexSessions.get(threadId);
  // Permissions ride on thread/resume, so a change needs a fresh process (after the old
  // one has let go of the writer lock).
  // 1.92: and so does a changed context policy (the config rides on thread/resume too).
  if (s && (s.closing || s.exited || s.cliBin !== CODEX_BIN || s.approvalMode !== approvalMode || (cwd && s.cwd && cwd !== s.cwd) || (s.policyKey || '') !== (launch?.key || ''))) {
    await closeCodexSession(s, s.closing || s.exited ? 'closing' : 'settings changed');
    s = null;
  }
  const reused = Boolean(s);
  if (!s) s = await openCodexSession({ threadId, forkFrom: threadId ? undefined : forkFrom, cwd, model, approvalMode, hooks, onForked, launch });
  s.hooks = hooks;
  if (codexTurns.get(s.threadId)) throw Object.assign(new Error('busy'), { code: 409 });
  const turn = makeTurn(s, { text, model, effort, executionMode, hooks });
  turn.emit({ type: 'user', msg: { role: 'user', text, ts: new Date().toISOString() } });

  const input = [{ type: 'text', text: promptWithAttachments(text, attachments) }];
  try {
    // 1.87: /compact and /review are Codex's own turns on the thread (thread/compact/start, review/start), streamed like any turn
    const r = action?.kind === 'compact' ? await s.conn.request('thread/compact/start', { threadId: turn.threadId }, 120_000)
      : action?.kind === 'review' ? await s.conn.request('review/start', { threadId: turn.threadId, target: action.target, delivery: 'inline' }, 120_000)
      : await s.conn.request('turn/start', {
      threadId:turn.threadId,input,
      collaborationMode:{mode:executionMode==='plan'?'plan':'default',settings:{model:turn.effectiveModel,reasoning_effort:turn.effectiveEffort,developer_instructions:null}},
      ...(model?{model}:{}),...(effort?{effort}:{}),
    },120_000);
    turn.turnId=r?.turn?.id || turn.turnId;
    writeSessionMeta(s);
  }catch(e){
    finish(turn,{type:'result',ok:false,error:e.message});
    closeCodexSession(s, 'turn/start failed'); // don't hold the thread's writer lock on a failed start
    throw e;
  }

  log(`turn start thread=${turn.threadId} process=${reused ? 'reused' : 'new'} pid=${s.conn.pid} cwd=${s.cwd || '(thread cwd)'}`);
  return turn;
}

// Stall watchdog, same rule as the Claude side: stop a turn only after STALL_MS with no
// notification from the app-server, nothing waiting on the user and no CPU use by
// programs the turn started. Interrupt first; close the process if that goes unanswered.
function codexStallCheck() {
  if (!(STALL_MS > 0)) return;
  for (const s of codexSessions.values()) {
    const t = s.turn;
    if (!t || s.exited || t.stalled || t.done) continue;
    const { pids, cpu } = descendantCpu(s.conn.pid);
    let ticks = 0;
    for (const p of pids) if (!t.baseline.has(p)) ticks += cpu.get(p) || 0;
    if (t.cpuTicks === undefined || ticks > t.cpuTicks + 100) t.cpuBusyAt = Date.now();
    t.cpuTicks = ticks;
    const quietFor = Date.now() - Math.max(s.lastActivityAt, t.cpuBusyAt || 0);
    if (quietFor < STALL_MS) continue;
    if (t.questions?.list().length || t.approvals?.list().length) continue;
    t.stalled = true;
    log(`codex turn STALLED thread=${s.threadId} quiet=${Math.round(quietFor / 60_000)}min — stopping`);
    if (t.turnId) s.conn.request('turn/interrupt', { threadId: s.threadId, turnId: t.turnId }, 20_000).catch(() => { });
    setTimeout(() => { if (s.turn === t) closeCodexSession(s, 'stalled'); }, 30_000);
  }
}
setInterval(codexStallCheck, Math.min(60_000, Math.max(250, STALL_MS / 4))).unref();

function promptWithAttachments(text, attachments) {
  if (!attachments?.length) return text;
  return text + '\n\n[Attached file' + (attachments.length > 1 ? 's' : '') + ' — read as needed:\n'
    + attachments.join('\n') + '\n]';
}

// The streaming channel. `item/agentMessage/delta` is the word-by-word feed; completed
// items become finished bubbles; `turn/completed` closes the turn out with usage.
function onTurnNotify(turn, method, params) {
  if (method === 'item/completed' && params?.item && turn.threadId) noteCodexItem(turn.threadId, params.turnId || turn.turnId || null, params.item);
  if (['item/started','item/completed'].includes(method) && ['collabAgentToolCall','subAgentActivity'].includes(params?.item?.type)) {
    turn.agentItems ||= new Map();
    turn.agentItems.set(params.item.id, params.item);
  }
  switch (method) {
    case 'serverRequest/resolved':
      turn.questions?.resolve(params.requestId);
      turn.approvals?.resolve(params.requestId);
      break;
    case 'turn/started':
      turn.turnId = params?.turnId || params?.turn?.id || turn.turnId;
      break;
    case 'item/agentMessage/delta': {
      const d = params?.delta ?? params?.text ?? '';
      if (d) turn.emit({ type: 'delta', text: d });
      break;
    }
    case 'item/started':
      if(params.item?.type==='fileChange')turn.approvalItems.set(params.item.id,params.item);
      break;
    case 'item/completed': {
      const it = params?.item || params;
      if(it?.id)turn.approvalItems.delete(it.id);
      // our own prompt comes back as a userMessage item ~2s later; we already echoed it
      if (it?.type === 'userMessage') break;
      const msg = normalizeItem(it, new Date().toISOString());
      if (msg) turn.emit({ type: 'assistant', msg: forClient(msg) });
      break;
    }
    case 'turn/plan/updated': { // 1.87: the plan checklist, live and in the transcript (one entry per turn, updated in place)
      const plan = Array.isArray(params?.plan) ? params.plan : [];
      if (!plan.length) break;
      const item = { type: 'pocketPlan', id: 'pocket-plan-' + (params.turnId || turn.turnId), plan };
      if (turn.threadId) noteCodexItem(turn.threadId, params.turnId || turn.turnId || null, item);
      turn.emit({ type: 'assistant', msg: { role: 'assistant', blocks: [planTodo(plan)], ts: new Date().toISOString(), planOf: item.id } });
      break;
    }
    case 'thread/tokenUsage/updated': {
      turn.usage = params?.usage || params;
      const tu = params?.tokenUsage;
      if (tu) {
        // "last" is this call's breakdown — the context fed into the model, same idea
        // as Claude's input + cache_read + cache_creation on the latest assistant line.
        const last = tu.last || tu.total || {};
        // 1.48: Codex's inputTokens already includes cachedInputTokens (a subset, unlike Claude's
        // separate cache_read figure), so the context is the input alone. Adding the two counted
        // nearly the whole context twice and pinned the meter at 100% from about 55% real
        // (Damon, 2026-10-14, Ramesh's session: 153k input / 152k cached shown as 118%).
        const used = contextUsed(last), cached = cachedTokens(last);
        turn.tokenSum = (turn.tokenSum || 0) + (Number(last.totalTokens) || 0); // 1.87: the reply's tokens, shown under it
        const window = tu.modelContextWindow || null;
        codexUsage.context[turn.threadId] = {
          used, cached, window: window || estimateWindow(turn.effectiveModel, used),
          estimated: !window, model: turn.effectiveModel || null, lastAt: Date.now(),
        };
        // the turn's first call shows whether it resumed warm or cold (the Claude side's cacheFirst)
        if (turn.cacheFirst === undefined && used > 0) turn.cacheFirst = { hit: cached / used, read: cached, written: used - cached };
        saveCodexUsage();
      }
      break;
    }
    case 'account/rateLimits/updated':
      mergeCodexRateLimits(params?.rateLimits);
      break;
    case 'model/rerouted': // 1.87: say so, as Claude's replies do when they run on another model
      turn.emit({ type: 'note', text: `Codex ran this reply on ${params?.toModel || 'another model'} instead of ${params?.fromModel || 'the one you picked'}${params?.reason === 'highRiskCyberActivity' ? ' (a security-sensitive request)' : ''}.` });
      break;
    case 'error': // 1.87: a usage or rate limit that Codex will not retry itself; the reply resumes after the reset
      if (!params?.willRetry && isCodexLimit(params?.error?.codexErrorInfo)) turn.limit = { message: params.error.message || 'Usage limit reached' };
      break;
    case 'turn/completed': {
      const u = params?.usage || turn.usage || {};
      if (!turn.limit && isCodexLimit(params?.turn?.error?.codexErrorInfo)) turn.limit = { message: params.turn.error.message || 'Usage limit reached' };
      finish(turn, {
        type: 'result', ok: !turn.stopped && !turn.stalled && !turn.limit && !['failed','interrupted'].includes(params?.turn?.status),
        ...(turn.limit && !turn.stopped ? { limit: true } : {}),
        error:turn.stalled?`Stopped: no activity for ${Math.round(STALL_MS / 60_000)} minutes`:turn.stopped?'Stopped by you':params?.turn?.error?.message,
        duration_ms: Date.now() - turn.startedAt,
        tokens: u.totalTokens ?? u.total_tokens ?? (turn.tokenSum || undefined),
        cache: turn.cacheFirst || null,
      });
      break;
    }
    case 'turn/failed':
    case 'turn/aborted':
      finish(turn, { type: 'result', ok: false, error: params?.error?.message || params?.reason || method });
      break;
    default:
      break;
  }
}

// Mid-turn steering: same idea as writing to the CLI's stdin, but the protocol has a
// precondition — the turn id must still be the live one, so a steer can't land in the
// wrong turn after a race.
export async function steerCodexTurn(threadId, text) {
  const turn = codexTurns.get(threadId);
  if (!turn || turn.done || !turn.turnId) return false;
  await turn.conn.request('turn/steer', {
    threadId, expectedTurnId: turn.turnId, input: [{ type: 'text', text }],
  }, 30_000);
  turn.emit({ type: 'user', msg: { role: 'user', text, ts: new Date().toISOString() } });
  return true;
}

export function stopCodexTurn(threadId) {
  const turn = codexTurns.get(threadId);
  if (!turn) return false;
  turn.stopped = true;
  turn.questions?.clear(); turn.approvals?.clear(); // 1.73.8: no card stays answerable after Stop, even if the interrupt is ignored
  if (turn.turnId) {
    turn.conn.request('turn/interrupt', { threadId, turnId: turn.turnId }, 20_000)
      .catch(e => { log(`interrupt failed thread=${threadId}: ${e.message}`); closeCodexSession(turn.session, 'interrupt failed'); });
  } else if (turn.session) closeCodexSession(turn.session, 'stopped before the turn began');
  else turn.conn.close();
  return true;
}

// ---------- external activity (threads driven from code-server / a terminal) ----------
// The Claude side watches transcript files. Codex's equivalent signal is the thread's
// updatedAt moving in the shared store, so a light poll gives the same live mirror.
const EXT_ACTIVE_MS = 45_000;
const ownedFinishedAt = new Map();
const extSeen = new Map(); // threadId -> {updatedAt, at}
export function codexExtActive(threadId) {
  const rec = extSeen.get(threadId);
  return Boolean(rec && Date.now() - rec.at < EXT_ACTIVE_MS);
}
export async function pollCodexActivity() {
  try {
    const r = await rpc('thread/list', { limit: 30, archived: false }, 20_000);
    const now = Date.now();
    for (const t of r?.data || []) {
      const prev = extSeen.get(t.id);
      const u = t.updatedAt || 0;
      if (!prev) { extSeen.set(t.id, { updatedAt: u, at: 0 }); continue; }
      const updatedMs=u<1e12?u*1000:u;
      if(codexTurns.has(t.id)||updatedMs<=(ownedFinishedAt.get(t.id)||0))extSeen.set(t.id,{updatedAt:u,at:0});
      else if (u > prev.updatedAt) extSeen.set(t.id, { updatedAt: u, at: now });
    }
  } catch { /* transient */ }
}

// Watch mode: mirror a thread being driven somewhere else (code-server, a terminal).
// Polls the newest items and emits the ones we haven't shown. Descending + small limit
// keeps this cheap on threads with thousands of items.
export function watchCodexThread(threadId, onMsg, { intervalMs = 2500, after = null } = {}) {
  const seen = new Set();
  let stopped = false, priming = true, complained = false;
  const tick = async () => {
    if (stopped) return;
    try {
      let rows;
      if (legacyThreads.has(threadId)) rows = (await readLegacyItems(threadId)).slice(-20);
      else {
        try {
          const r = await rpc('thread/items/list', { threadId, limit: 20, sortDirection: 'desc' }, 30_000);
          rows = (r?.data || []).map(x => x.item || x).filter(Boolean).reverse();
        } catch (e) {
          if (!isLegacyError(e)) throw e;
          legacyThreads.add(threadId);
          rows = (await readLegacyItems(threadId)).slice(-20);
        }
      }
      // A reconnect names the last item it saw: everything after it is news, not baseline.
      let resumeAt = priming && after ? rows.findIndex(it => it.id === after) : -1;
      for (const [i, it] of rows.entries()) {
        const key = it.id || JSON.stringify(it).slice(0, 120);
        if (seen.has(key)) continue;
        seen.add(key);
        if (priming && (resumeAt < 0 || i <= resumeAt)) continue; // baseline, it isn't news
        const msg = normalizeItem(it, new Date().toISOString());
        if (msg) onMsg({ type: msg.role === 'user' ? 'user' : 'assistant', msg, itemId: it.id || undefined });
      }
      priming = false;
    } catch (e) {
      // a poll that fails every tick is a silent blind spot — say it once, keep trying
      if (!complained) { complained = true; log(`watch poll failed thread=${threadId}: ${e.message}`); }
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  let timer = setTimeout(tick, 0);
  return () => { stopped = true; clearTimeout(timer); };
}

// Codex stores thread names itself, so a rename can be real rather than an overlay —
// code-server's picker shows it too. Same titleSync setting gates it.
export async function setCodexThreadName(threadId, name) {
  await rpc('thread/name/set', { threadId, name }, 20_000);
}

// ---------- models ----------
let modelCache = { at: 0, list: [] };
// model/list answers [{reasoningEffort, description}]; the picker needs only the names.
const effortNames = list => Array.isArray(list) ? list.map(e => typeof e === 'string' ? e : e?.reasoningEffort ?? e?.effort).filter(e => typeof e === 'string') : undefined;
// 1.91: only the newest version of each Codex family is shown (GPT-6.1 Sol replaces GPT-6 Sol). An id reads
// <maker>-<version>[-<family>] (gpt-6.1-sol, gpt-6-astra, gpt-5.1-codex-max, gpt-5); anything else (o3,
// codex-mini-latest) has no version and is kept as is. Returns the kept list in Codex's order and
// { replaced id: successor }.
const CODEX_VER_RE = /^([a-z]+)-(\d+(?:\.\d+)*)(?:-([a-z][a-z0-9-]*))?$/i;
export function codexVersionOf(id) {
  const m = String(id || '').match(CODEX_VER_RE);
  return m ? { family: `${m[1].toLowerCase()}|${(m[3] || '').toLowerCase()}`, v: m[2].split('.').map(Number) } : null;
}
const cmpVer = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };
export function latestCodexModels(list) {
  const best = new Map();
  for (const m of list) { const p = codexVersionOf(m.id); if (p && (!best.has(p.family) || cmpVer(p.v, best.get(p.family).v) > 0)) best.set(p.family, { id: m.id, v: p.v }); }
  const replaced = {};
  const models = list.filter(m => { const p = codexVersionOf(m.id), top = p && best.get(p.family); if (top && top.id !== m.id) { replaced[m.id] = top.id; return false; } return true; });
  return { models, replaced };
}
// The newest version of `id` the last model list had (itself when nothing newer is known). Synchronous:
// it reads the cached list, which codexModels() fills at startup and on every picker load.
let knownModels = []; // the last non-empty list, kept across a reader restart (modelCache is cleared then)
export const codexSuccessor = id => (id && latestCodexModels(knownModels).replaced[id]) || id;
// 1.92: the newest GPT Sol the last model list had (the context policy's worker under GPT Astra), or null before a list.
export const codexNewestSol = () => latestCodexModels(knownModels).models.find(m => codexVersionOf(m.id)?.family === 'gpt|sol')?.id || null;
// 1.92: Codex's own default model (top-level `model` in config.toml), for a conversation started on Default.
export function codexDefaultModel() {
  try { const top = fs.readFileSync(path.join(CODEX_HOME, 'config.toml'), 'utf8').split(/^\s*\[/m)[0]; return top.match(/^\s*model\s*=\s*["']([^"']+)["']/m)?.[1] || null; } catch { return null; }
}

export async function codexModels() {
  if (Date.now() - modelCache.at < 10 * 60_000 && modelCache.list.length && modelCache.stamp === binStamp(CODEX_BIN)) return modelCache.list;
  try {
    const r = await rpc('model/list', {}, 20_000);
    const list = (r?.data || r?.models || []).map(m => ({
      id: m.id || m.model || m.slug,
      label: m.displayName || m.name || m.id,
      efforts: effortNames(m.supportedReasoningEfforts || m.reasoningEfforts), // 1.81: the picker offers Ultra only where the model lists it
    })).filter(m => m.id);
    if (list.length) { modelCache = { at: Date.now(), list, stamp: binStamp(CODEX_BIN) }; knownModels = list; }
    return list;
  } catch { return modelCache.list; }
}

export async function codexVersion() {
  try {
    const c = await readConn();
    return c.userAgent || null;
  } catch { return null; }
}

// Let the installed runtime resolve project, user and plugin skills itself.
export async function listCodexSkills(cwd) {
  const r=await rpc('skills/list',{cwds:cwd?[cwd]:[],forceReload:false},30000);
  const rows=(r?.data||[]).flatMap(entry=>entry.skills||[]).filter(s=>s.enabled!==false);
  const unique=new Map(rows.map(s=>[s.path,s]));
  return [...unique.values()].map(s=>({name:s.name,label:s.interface?.displayName||s.name,
    desc:s.interface?.shortDescription||s.shortDescription||s.description||'',path:s.path,
    invocation:`Use the $${s.name} skill at ${s.path}.`}));
}

// ---------- usage visibility (Feature G) ----------
// Sparse update: the backend sends only the fields that changed, so this merges onto
// whatever we last saw rather than replacing it (per AccountRateLimitsUpdatedNotification's
// own contract — nullable fields absent from an update don't clear a previously observed
// value). Shallow merge is good enough for the primary/secondary window objects we show.
function mergeCodexRateLimits(snap) {
  if (!snap) return;
  const prev = codexUsage.rateLimits || {};
  codexUsage.rateLimits = {
    ...prev, ...snap,
    primary: snap.primary ? { ...prev.primary, ...snap.primary } : prev.primary,
    secondary: snap.secondary ? { ...prev.secondary, ...snap.secondary } : prev.secondary,
    observedAt: Date.now(),
  };
  saveCodexUsage();
}

// Per-session context meter and prompt-cache warmth for the UI: the same {used,window,pct,
// estimated,model} and {at,ttlMs,cached,lastTurn} shapes the Claude side exposes. 1.48: read
// from the thread's rollout file first (codex-rollout.mjs), which covers threads run outside
// Pocket and corrects figures saved by the double-counting builds; the tokenUsage/updated
// figure kept in memory is the fallback when no rollout can be read.
export async function codexContextAndCache(threadId) {
  const live = codexUsage.context[threadId] || null;
  const r = await rolloutState(threadId).catch(() => null);
  const c = r?.context ? { ...r.context, model: r.context.model || live?.model || null, lastAt: r.context.at } : live;
  if (!c) return { context: null, cache: null };
  const window = c.window || estimateWindow(c.model, c.used);
  const context = { used: c.used, window, pct: window ? Math.min(1, c.used / window) : 0, estimated: !c.window, model: c.model || null, lastAt: c.lastAt || null };
  const cache = r?.cache || (live?.lastAt && live.used > 0
    ? { at: live.lastAt, ttlMs: TTL_CODEX, ttlKnown: false, ttlNote: TTL_CODEX_NOTE, cached: live.used, lastTurn: null } : null);
  return { context, cache };
}

// 1.48: prompt-cache warmth for the tab marks, from the tail of each thread's rollout, 8 at a time.
async function attachCache(sessions) {
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < sessions.length) {
      const s = sessions[next++];
      const r = await rolloutState(bareId(s.id), { maxBytes: 256 * 1024 }).catch(() => null);
      if (r?.cache) s.cache = { at: r.cache.at, ttlMs: r.cache.ttlMs, cached: r.cache.cached };
    }
  }));
}

// Best-effort account rate limits: try a live read on the shared reader connection (this
// is the one account/rateLimits/read call Pocket makes, so the plan-usage panel doesn't
// need an active turn to show something), falling back to whatever a running turn last
// pushed via the account/rateLimits/updated notification. Returns null — not an error —
// when this Codex CLI build doesn't expose the method at all.
// 1.87: a Codex usage or rate limit (TurnError.codexErrorInfo: the enum string or a {kind:{…}} variant).
export const isCodexLimit = info => ['usageLimitExceeded', 'rateLimitExceeded'].some(k => info === k || (info && typeof info === 'object' && k in info));
// When the limit that stopped a reply lifts: the reset of a plan window that is full (resetsAt, unix seconds), read
// fresh from Codex; null when Codex does not say (the caller then estimates).
export async function codexLimitReset() {
  const rl = await codexRateLimits().catch(() => null) || codexUsage.rateLimits || {};
  const wins = [rl.primary, rl.secondary].filter(w => w && Number.isFinite(w.resetsAt));
  const full = wins.filter(w => w.usedPercent >= 100), pick = (full.length ? full : wins.filter(w => w.usedPercent >= 90));
  if (!pick.length) return null;
  return Math.max(...pick.map(w => w.resetsAt)) * 1000;
}
export async function codexRateLimits() {
  try {
    const r = await rpc('account/rateLimits/read', {}, 15_000);
    if (r?.rateLimits) mergeCodexRateLimits(r.rateLimits);
  } catch (e) { log(`account/rateLimits/read unavailable: ${e.message}`); }
  return codexUsage.rateLimits || null;
}

// 1.53: the ChatGPT apps (connectors) Codex offers, for Settings → Connectors. Only app/ reads.
export function appRpc(method, params, timeoutMs) {
  if (!/^app\/(list|read)$/.test(method)) throw new Error('not an app read');
  return rpc(method, params, timeoutMs);
}
export async function accountSummary(){
 const r=await rpc('account/read',{refreshToken:false},15000);const a=r.account;
 return {provider:'codex',signedIn:Boolean(a),method:a?.type||'Not signed in',email:typeof a?.email==='string'?a.email:null,plan:typeof a?.planType==='string'?a.planType:null};
}

// 1.79: a side chat runs with no MCP servers and no app connectors, like Claude's (--strict-mcp-config): it only reads
// and answers. Codex has no "none" switch, so each server is turned off by name.
// 1.89 (S-1): the names come from Codex itself, `codex mcp list --json` run with the same binary, CODEX_HOME and folder as
// the side chat (a trusted project's .codex/config.toml adds servers), not from reading config.toml: TOML writes a table
// many ways, and a name the old pattern missed stayed on in a fork that never asks. Each is turned off in the nested form,
// which Codex merges (a dotted key cannot name a server with a dot in it). When Codex cannot list them the side chat does
// not start. The list is kept until the binary or one of the config files it reads changes.
const sideMcpCache = new Map();
function mcpConfigStamp(cwd) {
  const files = ['/etc/codex/config.toml', path.join(CODEX_HOME, 'config.toml')];
  for (let d = path.resolve(cwd); ; d = path.dirname(d)) { files.push(path.join(d, '.codex', 'config.toml')); if (path.dirname(d) === d) break; }
  return [binStamp(CODEX_BIN), ...files.map(f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } })].join('|');
}
function listMcpServers(cwd) {
  return new Promise((resolve, reject) => execFile(CODEX_BIN, ['mcp', 'list', '--json'], { cwd, env: agentEnv(process.env), timeout: 20_000, killSignal: 'SIGKILL', maxBuffer: 4 << 20 }, (e, out, err) => {
    const said = String(err || '').split('\n').map(l => l.trim()).filter(l => l && !/^WARNING\b/.test(l)).slice(0, 3).join(' ');
    if (e) return reject(new Error(`codex mcp list failed: ${(said || e.message).slice(0, 200)}`));
    let list; try { list = JSON.parse(out); } catch { return reject(new Error('codex mcp list did not print JSON')); }
    if (!Array.isArray(list) || !list.every(s => typeof s?.name === 'string' && s.name)) return reject(new Error('codex mcp list did not print a list of named servers'));
    resolve(list.map(s => s.name));
  }));
}
export async function sideChatConfig(cwd = HOME) {
  if (!CODEX_BIN) throw new Error('Codex is not installed, so its MCP servers cannot be listed');
  const stamp = mcpConfigStamp(cwd);
  let names = sideMcpCache.get(cwd)?.stamp === stamp ? sideMcpCache.get(cwd).names : null;
  if (!names) {
    try { names = await listMcpServers(cwd); }
    catch (e) { throw new Error(`Pocket could not ask Codex which MCP servers it has, so it will not start a side chat that might leave them on (${e.message}).`); }
    sideMcpCache.delete(cwd); sideMcpCache.set(cwd, { stamp, names });
    if (sideMcpCache.size > 50) sideMcpCache.delete(sideMcpCache.keys().next().value);
  }
  return { 'features.apps': false, ...(names.length ? { mcp_servers: Object.fromEntries(names.map(n => [n, { enabled: false }])) } : {}) };
}


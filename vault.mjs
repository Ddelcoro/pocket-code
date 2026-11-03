// The Vault (1.39): credentials agents use without seeing. One encrypted file in the data directory
// (<data dir>/vault.enc, AES-256-GCM over the whole store under POCKET_VAULT_KEY) holds every item, its
// policy and the commands the owner has approved for it; nothing about the store is readable on disk
// without the key. The daemon decrypts it into memory at boot. Agents never receive a value: `pocket-vault
// run` sends the daemon a command and the variables to bind, the daemon spawns the child itself with the
// values in its environment, and the output comes back with every value scrubbed. Every release of a value,
// every request and answer, and every owner view is appended to vault-audit.jsonl, which never holds a value.
// Design: docs/plans/1.39.0-vault.md.
import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { signalGroup } from './proctree.mjs';
import { shellArg } from './skills.mjs';

// Fixed fields by kind; any item may carry custom fields beside them (1.39.1), and `credentials` has only custom ones.
export const KINDS = { api_key: ['value'], token: ['value'], login: ['username', 'password'], credentials: [], note: ['text'] };
export const FIELD_RE = /^[a-z][a-z0-9_]{0,31}$/;
// A stored secret named in text: {{vault:name}} or (1.43) {{vault:name.field}}.
export const PLACEHOLDER_RE = /\{\{vault:[a-z0-9-]+(?:\.[a-z][a-z0-9_]*)?\}\}/;
export const PLACEHOLDER_ALL = /\{\{vault:([a-z0-9-]+(?:\.[a-z][a-z0-9_]*)?)\}\}/g;
export const fieldNames = i => [...KINDS[i.kind], ...(i.custom || [])];
// 1.41: how freely agents may use secrets is a dial. The install-wide Agent access setting is free (no prompts), once
// (a new command is approved once, then remembered) or every (every use is approved); an item follows it ('default')
// or overrides it (auto = free rein, ask = once per command, every, owner = agents cannot use it).
export const POLICIES = ['default', 'auto', 'ask', 'every', 'owner'];
export const ACCESS = ['free', 'once', 'every'];
const ACCESS_POLICY = { free: 'auto', once: 'ask', every: 'every' };
const STORE_SCHEMA = 2; // 2 (1.41): 'default' exists; a version-1 store's 'ask' items are the old default and become 'default'
export const ACTIONS = ['add', 'update', 'remove', 'restore', 'recipe-remove', 'answer'];
export const LIMITS = { items: 500, name: 64, url: 500, notes: 2000, tags: 20, tag: 40, value: 64 * 1024, argv: 200, arg: 4096, cwd: 1024, env: 32,
  customFields: 20, output: 1 << 20, timeoutMax: 3600, timeoutDefault: 600, waitMax: 300, requestTtlMs: 15 * 60_000, trashDays: 30, recipes: 50, auditRows: 200, concurrent: 8 };
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ENV_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;
const SESSION_RE = /^(cx:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
// 1.81 (#177): notes past the limit are refused, not cut: the editor allowed 4,000 characters and the store kept 2,000 silently.
const notesIn = v => { const n = typeof v === 'string' ? v.trim() : ''; if (n.length > LIMITS.notes) throw fail(`Notes can be up to ${LIMITS.notes.toLocaleString('en-US')} characters.`); return n; };
const shortId = () => randomBytes(6).toString('hex');
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const POLICY_WORDS = { auto: 'Free rein', ask: 'Asks once per command', every: 'Asks every time', owner: 'Only you' };

// ---------- the key and the file format ----------
// POCKET_VAULT_KEY is 32 random bytes, base64 (`openssl rand -base64 32`).
export function parseKey(raw) {
  const s = String(raw || '').trim().replace(/^(["'])(.*)\1$/, '$2');
  if (!s) throw new Error('POCKET_VAULT_KEY is not set.');
  let b; try { b = Buffer.from(s, 'base64'); } catch { b = Buffer.alloc(0); }
  if (b.length !== 32) throw new Error('POCKET_VAULT_KEY must be 32 random bytes, base64 (openssl rand -base64 32).');
  return b;
}
export const newKey = () => randomBytes(32).toString('base64');
// Two file formats, told apart by the first byte (which is also the associated data, so a record cannot be replayed
// under the other one). 1: [1][iv 12][tag 16][ciphertext], opened by the raw key from POCKET_VAULT_KEY.
// 2 (1.40, passphrase mode): [2][salt 16][iv 12][tag 16][ciphertext], opened by a key derived from the owner's
// passphrase with scrypt over the salt; the daemon holds that key in memory only, so a restart locks the store.
export const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
export const PASSPHRASE_MIN = 12;
export function deriveKey(passphrase, salt) {
  const pw = String(passphrase || ''); if (pw.length < PASSPHRASE_MIN) throw fail(`The passphrase must be at least ${PASSPHRASE_MIN} characters.`);
  return scryptSync(pw.normalize('NFKC'), salt, 32, SCRYPT);
}
export function storeHeader(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 29) throw new Error('The vault file is not in a known format.');
  if (buf[0] === 1) return { version: 1, salt: null, offset: 1 };
  if (buf[0] === 2 && buf.length >= 45) return { version: 2, salt: buf.subarray(1, 17), offset: 17 };
  throw new Error('The vault file is not in a known format.');
}
export function encryptStore(key, data, { salt = null } = {}) {
  const iv = randomBytes(12), aad = salt ? Buffer.concat([Buffer.from([2]), salt]) : Buffer.from([1]);
  const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(aad);
  const body = Buffer.concat([c.update(Buffer.from(JSON.stringify(data), 'utf8')), c.final()]);
  return Buffer.concat([aad, iv, c.getAuthTag(), body]);
}
// `keys` are raw 32-byte keys (for format 2, already derived from the passphrase and the file's salt).
export function decryptStore(keys, buf) {
  const h = storeHeader(buf), o = h.offset;
  const iv = buf.subarray(o, o + 12), tag = buf.subarray(o + 12, o + 28), body = buf.subarray(o + 28);
  for (const key of keys) {
    try {
      const d = createDecipheriv('aes-256-gcm', key, iv); d.setAAD(buf.subarray(0, o)); d.setAuthTag(tag);
      return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString('utf8'));
    } catch { /* next key */ }
  }
  throw new Error(h.version === 2 ? 'Wrong passphrase.' : 'The vault cannot be opened with this key.');
}
// An export is a format-2 file of its own under a passphrase the owner types for it: the same items, portable.
export const EXPORT_FORMAT = 'pocket-vault-export';

// ---------- what agents are told ----------
export function vaultInstructions(cli, sessionId) {
  // 1.82.1: the skill's path is built from the CLI's own path, then quoted on its own; built from the quoted CLI path it
  // carried a stray quote when the install path had a space.
  const skill = shellArg(path.join(path.dirname(String(cli)), '..', 'skills', 'pocket-vault', 'SKILL.md'));
  cli = shellArg(cli); // 1.73.8: one shell word even with a space in the install path
  return [
    'This Pocket Code keeps a Vault of credentials (API keys, tokens, logins) that agents use by name and never see.',
    `Run commands that need one with \`node ${cli} run --env VAR=<name>[.field] -- <command…>\`: Pocket runs the command with the value in that variable and returns the output with the value scrubbed. Values never appear in arguments, output, files, messages or your context; never print, echo, write down or ask for one.`,
    'If the command answers `pending <id>`, the owner is being asked to allow it (a push with Allow and Deny went to their devices): say so in one line and end your reply offering "Allow <name> for this command" and "Deny <name>" as the choices; the owner answering either way, by the notification, the Vault view or that reply, settles the request, and you then continue with `wait <id>`. If it is refused, say so and stop; do not look for another way to the value.',
    'To type a stored value into a web page with the Playwright browser tools (a login form, say), put `{{vault:<name>.<field>}}` as the text to type or fill; Pocket fills in the real value on the way to the browser and removes it from what comes back. Never read a filled value back out of the page. Values go into typing and form-filling tools only, and once one has been typed, screenshots and other pictures from that browser are unavailable for the rest of the session (a value cannot be scrubbed out of a picture): use text snapshots.',
    `When you meet a secret in a file, a result or a message, store it at once with \`node ${cli} put <name> --kind <api_key|token|login|credentials|note> --stdin\` (or --from-file), tell the owner it was seen, and use the name from then on. \`list\` shows what exists. A \`{{vault:name}}\` in a message is the owner handing you a stored secret by name.`,
    `The pocket-vault skill (\`${skill}\`) has the procedure.${sessionId ? '' : ' Pass --cwd when the command depends on the working directory.'}`,
  ].join(' ');
}

// ---------- the store ----------
export class VaultStore {
  // `key` (from POCKET_VAULT_KEY) opens a format-1 file; `oldKeys` are retired keys still accepted while a rotation is
  // pending a restart. A format-2 file (passphrase mode) starts LOCKED: nothing is decrypted until unlock(passphrase).
  constructor(file, { key = null, oldKeys = [], auditFile, now, write, log = () => {} } = {}) {
    if (key != null && (!Buffer.isBuffer(key) || key.length !== 32)) throw new Error('A 32-byte key is required.');
    this.file = file; this.envKey = key; this.keys = key ? [key, ...oldKeys] : []; this.salt = null; this.openedWith = null;
    this.auditFile = auditFile || path.join(path.dirname(file), 'vault-audit.jsonl');
    this.now = now || Date.now; this.log = log;
    // 1.73.6: the one file whose loss is every secret at once is synced before and after the rename (the other stores keep tmp+rename alone).
    this.write = write || ((f, buf) => {
      fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.tmp';
      const fd = fs.openSync(tmp, 'w', 0o600); try { fs.writeSync(fd, buf); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, f);
      let dir = null; try { dir = fs.openSync(path.dirname(f), 'r'); fs.fsyncSync(dir); } catch { } finally { if (dir !== null) fs.closeSync(dir); }
    });
    this.requests = new Map(); // id -> request (pending ones live in memory only; they expire in minutes)
    this.running = 0; this.items = null; this.lastActivityAt = this.now();
    this.access = () => 'once'; // the server points this at the Agent access setting
    if (!fs.existsSync(file)) { if (!key) throw new Error('POCKET_VAULT_KEY is not set.'); this.items = []; return; }
    const buf = fs.readFileSync(file), h = storeHeader(buf);
    if (h.version === 2) { this.salt = Buffer.from(h.salt); return; } // locked until the owner unlocks it
    if (!key) throw new Error('POCKET_VAULT_KEY is not set.');
    // 1.76.3: the key that opened the store is remembered: when it is a previous key, a rotation stopped between its two
    // .env saves, and the daemon rolls .env back to it rather than carry a key the owner was never shown.
    let data = null; for (const k of this.keys) { try { data = decryptStore([k], buf); this.openedWith = k; break; } catch { } }
    if (!data) decryptStore(this.keys, buf); // throws: the daemon reports "cannot be opened" and serves nothing
    this.load(data);
  }
  load(data) { const legacy = !(data.version >= STORE_SCHEMA); this.items = (Array.isArray(data.items) ? data.items : []).filter(i => i && typeof i.id === 'string' && NAME_RE.test(i.name || '')).map(i => this.normalize(legacy && i.policy === 'ask' ? { ...i, policy: 'default' } : i)); this.lastActivityAt = this.now(); }
  get mode() { return this.salt ? 'passphrase' : 'key'; }
  get locked() { return this.items === null; }
  open() { if (this.locked) throw fail('The Vault is locked. Ask the owner to unlock it in Pocket Code.', 423, { code: 'vault_locked' }); this.lastActivityAt = this.now(); return this; }
  // Passphrase mode: unlock derives the key from the passphrase and the file's salt and decrypts; lock forgets both the
  // key and every item. Switching modes rewrites the file under the other key.
  unlock(passphrase) {
    if (!this.locked) return true;
    // 1.73.6: the salt comes from the file being opened, not from memory, so it is always the one the file was written with.
    const buf = fs.readFileSync(this.file), h = storeHeader(buf), salt = h.version === 2 ? Buffer.from(h.salt) : this.salt;
    const k = deriveKey(passphrase, salt);
    // 1.82.1: a failed audit write must not turn a wrong passphrase into a status-less error: the server would answer 500 and not
    // count the try toward the hourly limit. The failure is logged instead.
    let data; try { data = decryptStore([k], buf); } catch {
      try { this.audit({ action: 'unlock-failed', by: 'owner' }); } catch (e) { this.log(`vault: could not record a failed unlock: ${e.message}`); }
      throw fail('Wrong passphrase.', 401);
    }
    this.salt = salt; this.keys = [k]; this.load(data); this.audit({ action: 'unlock', by: 'owner' }); return true;
  }
  lock() {
    if (this.mode !== 'passphrase') throw fail('The Vault is opened by the server key; set a passphrase to be able to lock it.');
    if (this.locked) return;
    this.items = null; this.keys = [];
    // 1.73.3: a request still waiting is answered "locked" before its waiters wake, so no continuation meets an unanswered row.
    const at = iso(this.now());
    for (const r of this.requests.values()) { if (!r.answer) r.answer = { decision: 'locked', at }; for (const w of r.waiters.splice(0)) w(r); }
    this.requests.clear();
    this.audit({ action: 'lock', by: 'owner' });
  }
  setPassphrase(passphrase, confirm) {
    this.open();
    if (String(passphrase) !== String(confirm)) throw fail('The passphrases do not match.');
    const salt = randomBytes(16), k = deriveKey(passphrase, salt);
    this.save({ key: k, salt }); this.salt = salt; this.keys = [k]; // 1.73.6: the new material is taken up only once the file holds it
    this.audit({ action: 'passphrase-set', by: 'owner' });
  }
  checkPassphrase(passphrase) { if (this.mode !== 'passphrase') return false; try { decryptStore([deriveKey(passphrase, this.salt)], fs.readFileSync(this.file)); return true; } catch { return false; } }
  removePassphrase(passphrase) {
    this.open();
    if (this.mode !== 'passphrase') throw fail('The Vault is not protected by a passphrase.');
    if (!this.envKey) throw fail('POCKET_VAULT_KEY is not set, so the Vault cannot go back to the server key.', 409, { code: 'vault_no_key' });
    try { decryptStore([deriveKey(passphrase, this.salt)], fs.readFileSync(this.file)); } catch { throw fail('Wrong passphrase.', 401); }
    this.save({ key: this.envKey, salt: null }); this.salt = null; this.keys = [this.envKey]; this.audit({ action: 'passphrase-removed', by: 'owner' });
  }
  // Idle lock: the owner's setting, in minutes; 0 never.
  idleLockDue(minutes, now = this.now()) { return this.mode === 'passphrase' && !this.locked && minutes > 0 && now - this.lastActivityAt >= minutes * 60_000; }
  // 1.73.6: writes a state and changes nothing in memory: every change computes its next items (and key or salt) on a copy,
  // writes them, and installs them only once the file holds them, so a failed write leaves memory and disk agreeing.
  save({ items = this.items, key = this.keys[0], salt = this.salt } = {}) { this.open(); this.write(this.file, encryptStore(key, { version: STORE_SCHEMA, savedAt: iso(this.now()), items }, { salt })); }
  // The live list with one item replaced by its edited copy (or removed when `next` is null).
  withItem(i, next) { return next ? this.items.map(x => x === i ? next : x) : this.items.filter(x => x !== i); }
  // Rotation (key mode): the store is rewritten under the new key; the old one stays accepted until the daemon restarts with the new .env.
  rotate(newKeyRaw) { this.open(); if (this.mode !== 'key') throw fail('Rotation applies to the server key; the Vault is protected by a passphrase.'); const k = parseKey(newKeyRaw); this.save({ key: k }); this.keys = [k, ...this.keys]; this.envKey = k; return k; }
  // Export: every item (values included) as a format-2 file under a passphrase of its own; import merges by name.
  exportBundle(passphrase, confirm) {
    this.open();
    if (String(passphrase) !== String(confirm)) throw fail('The passphrases do not match.');
    const salt = randomBytes(16), k = deriveKey(passphrase, salt);
    const items = this.items.filter(i => !i.trashedAt).map(({ lastUsedAt, lastUsedBy, trashedAt, ...i }) => i);
    this.audit({ action: 'export', by: 'owner', decision: String(items.length) });
    return encryptStore(k, { format: EXPORT_FORMAT, version: STORE_SCHEMA, exportedAt: iso(this.now()), items }, { salt });
  }
  importBundle(buf, passphrase) {
    this.open();
    let h; try { h = storeHeader(buf); } catch { throw fail('That is not a Vault export file.'); }
    if (h.version !== 2) throw fail('That is not a Vault export file.');
    let data; try { data = decryptStore([deriveKey(passphrase, h.salt)], buf); } catch (e) { throw fail(e.message === 'Wrong passphrase.' ? 'Wrong passphrase.' : 'That is not a Vault export file.'); }
    if (data?.format !== EXPORT_FORMAT || !Array.isArray(data.items)) throw fail('That is not a Vault export file.');
    const skipped = [], added = [], legacy = !(data.version >= STORE_SCHEMA), next = [...this.items];
    for (const raw of data.items) {
      if (!raw || typeof raw !== 'object') continue;
      const i = this.normalize({ ...raw, ...(legacy && raw.policy === 'ask' ? { policy: 'default' } : {}), id: shortId(), addedIn: undefined, lastUsedAt: null, lastUsedBy: null, trashedAt: null }); // 1.93: the conversation that added it belongs to the other install
      if (!NAME_RE.test(i.name || '')) continue;
      if (next.some(x => x.name === i.name)) { skipped.push(i.name); continue; }
      if (next.length >= LIMITS.items) throw fail(`You can keep up to ${LIMITS.items} items.`, 409);
      try { this.checkValues({ kind: i.kind, custom: [] }, i.values, { all: false }); } catch (e) { throw fail(`${i.name}: ${e.message}`); } // 1.73.6: an export is held to the same value rules
      i.created = i.created || iso(this.now()); i.updated = iso(this.now()); i.revision = 1;
      next.push(i); added.push(i.name);
    }
    this.audit({ action: 'import', by: 'owner', decision: `${added.length} added, ${skipped.length} skipped` });
    if (added.length) { this.save({ items: next }); this.items = next; }
    return { added: added.length, skipped };
  }
  normalize(i) {
    const kind = KINDS[i.kind] ? i.kind : 'note';
    const custom = [...new Set((Array.isArray(i.custom) ? i.custom : []).filter(f => typeof f === 'string' && FIELD_RE.test(f) && !KINDS[kind].includes(f)))].slice(0, LIMITS.customFields);
    const values = {}; for (const f of [...KINDS[kind], ...custom]) values[f] = typeof i.values?.[f] === 'string' ? i.values[f] : '';
    return { ...i, kind, custom, values, url: str(i.url, LIMITS.url), notes: str(i.notes, LIMITS.notes), tags: Array.isArray(i.tags) ? i.tags.map(t => str(t, LIMITS.tag)).filter(Boolean).slice(0, LIMITS.tags) : [],
      policy: POLICIES.includes(i.policy) ? i.policy : 'default', recipes: Array.isArray(i.recipes) ? i.recipes.filter(r => r && Array.isArray(r.argv)).slice(0, LIMITS.recipes) : [],
      expiresAt: i.expiresAt && !Number.isNaN(Date.parse(i.expiresAt)) ? i.expiresAt : null, lastUsedAt: i.lastUsedAt || null, lastUsedBy: i.lastUsedBy || null,
      trashedAt: i.trashedAt || null, revision: Number.isInteger(i.revision) && i.revision > 0 ? i.revision : 1 };
  }

  // The audit row is written before the action is final; if it cannot be written the action fails (no unrecorded release).
  audit(record) {
    const row = { at: iso(this.now()), ...record };
    for (const k of ['argv', 'cwd', 'decision', 'session', 'sessionTitle', 'request', 'name', 'item', 'by', 'action']) if (row[k] === undefined || row[k] === null || row[k] === '') delete row[k];
    const fd = fs.openSync(this.auditFile, 'a+', 0o600);
    // 1.73.8: a short write is continued, so a row is never left half-written for the next one to merge into.
    // 1.76.3: an append that failed part-way (a full disk, an I/O error) still leaves a torn row with no newline; the next row
    // starts on a line of its own, so the torn one is the only line lost.
    let lead = '';
    try { const { size } = fs.fstatSync(fd); if (size > 0) { const last = Buffer.alloc(1); fs.readSync(fd, last, 0, 1, size - 1); if (last[0] !== 0x0a) lead = '\n'; } } catch { }
    const buf = Buffer.from(lead + JSON.stringify(row) + '\n');
    try { for (let at = 0; at < buf.length;) { const n = fs.writeSync(fd, buf, at, buf.length - at); if (!(n > 0)) throw new Error('The Vault record could not be written.'); at += n; } fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  // The newest rows, newest first. Owners see everything; an agent sees only its own session's rows.
  auditRows({ item, session, owner = false, limit = 50 } = {}) {
    let text = ''; try { text = fs.readFileSync(this.auditFile, 'utf8'); } catch { return []; }
    const rows = [];
    for (const line of text.trim().split('\n').reverse()) {
      if (!line) continue; let r; try { r = JSON.parse(line); } catch { continue; }
      if (item && r.item !== item) continue;
      if (!owner && (!session || r.session !== session)) continue;
      rows.push(r); if (rows.length >= Math.min(limit, LIMITS.auditRows)) break;
    }
    return rows;
  }

  get(id) { this.open(); const i = this.items.find(x => x.id === id); if (!i) throw fail('That item does not exist.', 404); return i; }
  byName(name) { this.open(); return this.items.find(x => x.name === name && !x.trashedAt) || null; }
  // The item as the UI and CLI see it: never a value; notes only for the owner.
  view(i, { owner = false, now = this.now() } = {}) {
    const { values, notes, ...rest } = i;
    const eff = this.effective(i);
    return { ...rest, fields: fieldNames(i), custom: i.custom, effectivePolicy: eff, policyWord: POLICY_WORDS[eff], ...(owner ? { notes } : {}), expiring: Boolean(i.expiresAt) && Date.parse(i.expiresAt) - now < 14 * 86400_000 };
  }
  requestView(r) { const { env, waiters, caller, bindings, ...rest } = r; return { ...rest, pending: !r.answer, allowAlways: r.allowAlways !== false }; }
  // The policy that applies to an item now: its own, or the Agent access setting's when it follows the default.
  effective(i) { if (i.policy !== 'default') return i.policy; const a = this.access(); return ACCESS_POLICY[ACCESS.includes(a) ? a : 'once']; }
  snapshot({ owner = false, now = this.now() } = {}) {
    this.open();
    this.expireRequests(now);
    const live = this.items.filter(i => !i.trashedAt).sort((a, b) => a.name.localeCompare(b.name)).map(i => this.view(i, { owner, now }));
    const trash = owner ? this.items.filter(i => i.trashedAt).sort((a, b) => Date.parse(b.trashedAt) - Date.parse(a.trashedAt)).map(i => this.view(i, { owner, now })) : [];
    const requests = [...this.requests.values()].filter(r => !r.answer).map(r => this.requestView(r));
    // 1.93: requests answered or expired in the last 15 minutes, as id, answer and time only, so a link to one (a notification
    // tapped late, an Allow that did not go through) can say what happened to it instead of finding nothing.
    const answered = owner ? [...this.requests.values()].filter(r => r.answer).map(r => ({ id: r.id, itemNames: r.itemNames, decision: r.answer.decision, at: r.answer.at })) : [];
    return { version: 1, now, ready: true, access: ACCESS.includes(this.access()) ? this.access() : 'once', items: live, trash, requests, answered, openRequests: requests.length };
  }
  touch(i) { i.updated = iso(this.now()); i.revision += 1; }

  // Every change goes through here. Agents may only add (create-only); everything else is the owner's.
  act(input, { actor = 'owner', session = null, sessionTitle = '' } = {}) {
    this.open();
    const action = str(input?.action, 40);
    if (!ACTIONS.includes(action)) throw fail('Unknown action.');
    const owner = actor === 'owner', by = owner ? 'owner' : actor === 'agent' ? 'agent' : 'terminal';
    const at = iso(this.now());
    if (action === 'add') {
      const name = str(input.name, LIMITS.name + 1).toLowerCase();
      if (!NAME_RE.test(name)) throw fail('The name must be 1 to 64 characters: lower-case letters, digits and hyphens.');
      if (this.items.some(i => i.name === name)) throw fail(owner ? 'An item with that name already exists.' : `An item named ${name} already exists; agents cannot replace it. Use another name or ask the owner.`, 409);
      const kind = str(input.kind, 20); if (!KINDS[kind]) throw fail('The kind must be api_key, token, login, credentials or note.');
      if (this.items.length >= LIMITS.items) throw fail(`You can keep up to ${LIMITS.items} items.`, 409);
      const { values, custom } = this.checkValues({ kind, custom: [] }, input.values, { all: true });
      const item = { id: shortId(), name, kind, custom, values, url: str(input.url, LIMITS.url), notes: owner ? notesIn(input.notes) : '', tags: this.checkTags(input.tags),
        policy: owner && POLICIES.includes(input.policy) ? input.policy : 'default', recipes: [], expiresAt: this.checkWhen(input.expiresAt),
        created: at, updated: at, by, ...(session ? { addedIn: { session: str(session, 80), sessionTitle: str(sessionTitle, 200) } } : {}), lastUsedAt: null, lastUsedBy: null, trashedAt: null, revision: 1 };
      this.audit({ action: 'put', item: item.id, name, by, session, sessionTitle });
      const next = [...this.items, item]; this.save({ items: next }); this.items = next;
      return this.view(item, { owner });
    }
    if (action === 'answer') {
      if (!owner) throw fail('Only the owner answers requests.', 403);
      return this.answer(str(input.request, 40), str(input.decision, 10));
    }
    if (!owner) throw fail('Agents cannot change items. Ask the owner.', 403);
    const live = this.get(str(input.item, 40));
    if (input.expected_revision != null && Number(input.expected_revision) !== live.revision) throw fail('This item changed since you loaded it. Review it and try again.', 409, { item: this.view(live, { owner }) });
    // 1.73.6: the edit is made on a copy; the copy replaces the item only once the file holds it, so a check that fails
    // halfway (or a write that fails) leaves the item as it was.
    const i = structuredClone(live), commit = () => { const next = this.withItem(live, i); this.save({ items: next }); this.items = next; };
    if (action === 'remove') { if (i.trashedAt) throw fail('Already removed.'); i.trashedAt = at; this.touch(i); this.audit({ action: 'remove', item: i.id, name: i.name, by }); commit(); return { ...this.view(i, { owner }), removed: true }; }
    if (action === 'restore') {
      if (!i.trashedAt) throw fail('This item is not removed.');
      if (this.items.some(x => x !== live && x.name === i.name && !x.trashedAt)) throw fail('Another item now has that name. Rename it first.', 409);
      i.trashedAt = null; this.touch(i); this.audit({ action: 'restore', item: i.id, name: i.name, by }); commit(); return this.view(i, { owner });
    }
    if (action === 'recipe-remove') {
      const id = str(input.recipe, 40); if (!i.recipes.some(r => r.id === id)) throw fail('That approved command does not exist.', 404);
      i.recipes = i.recipes.filter(r => r.id !== id); this.touch(i); this.audit({ action: 'update', item: i.id, name: i.name, by, decision: 'recipe-removed' }); commit(); return this.view(i, { owner });
    }
    let changed = false;
    const touched = []; // field names an edit changed, added or removed: recorded in the audit, never a value
    if ('name' in input) { const name = str(input.name, LIMITS.name + 1).toLowerCase(); if (!NAME_RE.test(name)) throw fail('The name must be 1 to 64 characters: lower-case letters, digits and hyphens.'); if (this.items.some(x => x !== live && x.name === name)) throw fail('An item with that name already exists.', 409); i.name = name; changed = true; }
    if (Array.isArray(input.removeFields)) { // custom fields only; a fixed field cannot be dropped
      for (const f of input.removeFields.map(x => str(x, 40))) { if (!i.custom.includes(f)) throw fail(`${f} is not a custom field of this item.`); i.custom = i.custom.filter(x => x !== f); delete i.values[f]; touched.push(f); changed = true; }
    }
    if (input.values && typeof input.values === 'object') {
      const { values, custom } = this.checkValues(i, input.values, { all: false });
      for (const [f, val] of Object.entries(values)) if (val !== '') { if (val !== i.values[f]) touched.push(f); i.values[f] = val; changed = true; }
      for (const f of custom) if (!i.custom.includes(f)) { i.custom.push(f); changed = true; }
      if (i.custom.length > LIMITS.customFields) throw fail(`An item can have up to ${LIMITS.customFields} custom fields.`);
    }
    if ('url' in input) { i.url = str(input.url, LIMITS.url); changed = true; }
    if ('notes' in input) { i.notes = notesIn(input.notes); changed = true; }
    if ('tags' in input) { i.tags = this.checkTags(input.tags); changed = true; }
    if ('policy' in input) { if (!POLICIES.includes(input.policy)) throw fail('The policy must be default, auto, ask, every or owner.'); i.policy = input.policy; changed = true; }
    if ('expiresAt' in input) { i.expiresAt = this.checkWhen(input.expiresAt); changed = true; }
    if (!changed) throw fail('Nothing to change.');
    this.touch(i); this.audit({ action: 'update', item: i.id, name: i.name, by, ...(touched.length ? { fields: [...new Set(touched)] } : {}) }); commit();
    return this.view(i, { owner });
  }
  // Fixed fields are required on add; any other key is a custom field (named by the rule, not clashing with a fixed one).
  checkValues(item, values, { all }) {
    const fixed = KINDS[item.kind], out = {}, custom = [];
    const check = (f, v) => { if (v.length > LIMITS.value) throw fail(`The ${f} is too long.`); if (PLACEHOLDER_RE.test(v)) throw fail(`The ${f} looks like a placeholder, not a value.`); };
    for (const f of fixed) { const v = typeof values?.[f] === 'string' ? values[f] : ''; check(f, v); if (all && !v.trim()) throw fail(`The ${f} is required.`); out[f] = v; }
    for (const [f, raw] of Object.entries(values && typeof values === 'object' ? values : {})) {
      if (fixed.includes(f)) continue;
      if (!FIELD_RE.test(f)) throw fail(`${f} is not a field name: lowercase letters, digits and underscores, up to 32 characters, starting with a letter.`);
      const v = typeof raw === 'string' ? raw : ''; check(f, v);
      const exists = (item.custom || []).includes(f);
      if (!exists && !v.trim()) { if (all) throw fail(`The ${f} field needs a value.`); continue; } // a blank new field is ignored on edit
      out[f] = v; if (!exists) custom.push(f);
    }
    if (all && !fixed.length && !custom.length) throw fail('Give at least one field, for example client_id.');
    if ((item.custom || []).length + custom.length > LIMITS.customFields) throw fail(`An item can have up to ${LIMITS.customFields} custom fields.`);
    return { values: out, custom };
  }
  checkTags(tags) { const list = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(',') : []; return [...new Set(list.map(t => str(t, LIMITS.tag).toLowerCase()).filter(Boolean))].slice(0, LIMITS.tags); }
  checkWhen(v) { if (!v) return null; const t = Date.parse(v); if (Number.isNaN(t)) throw fail('The expiry must be a date.'); return iso(t); }

  // The owner reads one field at a time; each read is recorded.
  field(id, field) {
    this.open();
    const i = this.get(id);
    if (!fieldNames(i).includes(field)) throw fail('That field does not exist.', 404);
    this.audit({ action: 'owner-view', item: i.id, name: i.name, by: 'owner', decision: field });
    return i.values[field];
  }

  // ---------- runs ----------
  // Bindings: { VAR: 'name' | 'name.field' } → the items and the field each variable needs. Nothing is released here.
  resolveBindings(env) {
    this.open();
    if (!env || typeof env !== 'object') throw fail('Nothing to bind: give at least one --env VAR=name.');
    const entries = Object.entries(env); if (!entries.length) throw fail('Nothing to bind: give at least one --env VAR=name.');
    if (entries.length > LIMITS.env) throw fail('Too many variables.');
    const bound = [];
    for (const [v, ref] of entries) {
      if (!ENV_RE.test(v)) throw fail(`${v} is not a variable name.`);
      if (/^POCKET_|^PATH$|^HOME$|^LD_|^NODE_OPTIONS$/.test(v)) throw fail(`${v} cannot be bound.`);
      const m = /^([a-z0-9-]+)(?:\.([a-z][a-z0-9_]*))?$/.exec(String(ref || '')); if (!m) throw fail(`${ref} is not an item name.`);
      const item = this.byName(m[1]); if (!item) throw fail(`There is no item named ${m[1]}. \`list\` shows what exists.`, 404);
      const fields = fieldNames(item);
      const field = m[2] || (fields.length === 1 ? fields[0] : null);
      if (!field) throw fail(`${item.name} has the fields ${fields.join(' and ')}; name one, for example ${item.name}.${fields[0]}.`);
      if (!fields.includes(field)) throw fail(`${item.name} has no field ${field}.`);
      bound.push({ v, item, field });
    }
    return bound;
  }
  checkCommand(argv, cwd) {
    if (!Array.isArray(argv) || !argv.length || argv.length > LIMITS.argv || argv.some(a => typeof a !== 'string' || a.length > LIMITS.arg)) throw fail('Give the command after --.');
    if (!argv[0].trim()) throw fail('Give the command after --.');
    const dir = str(cwd, LIMITS.cwd);
    if (!dir || !path.isAbsolute(dir)) throw fail('The working directory must be a full path.');
    let st; try { st = fs.statSync(dir); } catch { throw fail('The working directory does not exist.'); }
    if (!st.isDirectory()) throw fail('The working directory is not a directory.');
    return { argv: argv.map(String), cwd: path.normalize(dir).replace(/\/+$/, '') || '/' };
  }
  // 1.73.4: a command is a run or a browser fill; a recipe saved before 1.73.4 carries no action and is read from its argv.
  static actionOf(x) { return x?.action === 'fill' || (!x?.action && x?.argv?.[0] === 'pocket-fill') ? 'fill' : 'run'; }
  static sameCommand(a, b) { return a.cwd === b.cwd && VaultStore.actionOf(a) === VaultStore.actionOf(b) && a.argv.length === b.argv.length && a.argv.every((x, k) => x === b.argv[k]); }
  // What the policies say about running this command with these items: 'run', or 'ask' with the items that need the owner's word.
  decide(bound, cmd) {
    const need = [];
    for (const { item: boundItem } of new Map(bound.map(b => [b.item.id, b])).values()) {
      const item = this.items.find(x => x.id === boundItem.id) || boundItem; // 1.73.6: an edit replaces the item object; the policy read is the one in the store now
      const p = this.effective(item);
      if (p === 'owner') throw fail(`${item.name} is for the owner only; agents cannot use it. Ask the owner to change its policy.`, 403, { code: 'owner_only' });
      if (p === 'every' || (p === 'ask' && !item.recipes.some(r => VaultStore.sameCommand(r, cmd)))) need.push(item);
    }
    return need;
  }
  // A request for the owner: one per command, naming every item that needs approval. 1.73.4: the row also records the kind
  // of use (`action`: run or fill), every binding by item id, and the caller (actor, session, and the SHA-256 of the runner
  // token when there is one), so a continuation can be held to the same use by the same caller.
  request({ bound, cmd, need, env, session = null, sessionTitle = '', by = 'agent', tokenHash = null }) {
    this.expireRequests();
    const now = this.now();
    let id = shortId(); for (let n = 0; this.requests.has(id); n++) { if (n >= 8) throw fail('Could not number the request; try again.', 500); id = shortId(); } // never over an existing row
    const r = { id, action: VaultStore.actionOf(cmd), items: need.map(i => i.id), itemNames: need.map(i => i.name), argv: cmd.argv, cwd: cmd.cwd, env, session, sessionTitle, by, created: iso(now), expiresAt: iso(now + LIMITS.requestTtlMs), answer: null, consumed: false, waiters: [], allowAlways: need.every(i => this.effective(i) !== 'every'),
      bindings: bound.map(b => ({ v: b.v, item: b.item.id, name: b.item.name, field: b.field })), caller: { actor: by, session, tokenHash } };
    this.audit({ action: 'request', request: r.id, item: need[0].id, name: need.map(i => i.name).join(','), by, session, sessionTitle, argv: cmd.argv, cwd: cmd.cwd });
    this.requests.set(r.id, r);
    return r;
  }
  // 1.73.4: who may continue a request. An agent inside a Pocket session is its session (the token the daemon put in that
  // process names it; a restarted process of the same session still counts); terminal and code-server callers share the one
  // identity `terminal`, since nothing tells them apart.
  static sameCaller(a, b) { return (a?.actor || 'terminal') === (b?.actor || 'terminal') && (a?.session || null) === (b?.session || null); }
  // The continuation of a request (pocket-vault wait, or the relay calling again with the id): the row must exist, be the same
  // kind of use, belong to this caller and not be used up. Checked before waiting on the answer, and again inside claim().
  continuation(id, { action = 'run', caller = null } = {}) {
    this.open(); this.expireRequests();
    const r = this.requests.get(String(id)); if (!r) throw fail('That request does not exist or has expired.', 404);
    if (r.action !== action) throw fail(r.action === 'fill' ? 'That request is for a browser fill, not a command.' : 'That request is for a command, not a browser fill.', 409, { code: 'request_mismatch' });
    if (!VaultStore.sameCaller(r.caller, caller)) throw fail('That request was raised by another session.', 403, { code: 'request_mismatch' });
    if (r.consumed) throw fail('That request was already used.', 409, { code: 'request_used' });
    return r;
  }
  // The one step between the owner's answer and the release, synchronous so that two continuations of one answer cannot
  // both pass: the bindings are resolved again by item id against the store as it is now (a removed item or field voids the
  // approval; a renamed item does not), the policy decision is run again (an item that is now the owner's only refuses; one
  // that now needs approval and was not in the answered set sends the agent back to ask), and the row is marked used.
  claim(id, { action = 'run', caller = null } = {}) {
    const r = this.continuation(id, { action, caller });
    if (!r.answer || !['once', 'always'].includes(r.answer.decision)) throw fail('The owner has not allowed that request.', 409);
    const bound = [];
    for (const b of r.bindings) {
      const item = this.items.find(x => x.id === b.item);
      if (!item || item.trashedAt || !fieldNames(item).includes(b.field)) throw fail(`${b.name} changed since the owner was asked; ask again.`, 409, { code: 'request_stale' });
      bound.push({ v: b.v, item, field: b.field });
    }
    const cmd = { argv: r.argv, cwd: r.cwd, action: r.action };
    const need = this.decide(bound, cmd);
    if (need.some(i => !r.items.includes(i.id))) throw fail('A policy changed since the owner was asked; ask again.', 409, { code: 'request_stale' });
    r.consumed = true;
    return { request: r, bound, cmd };
  }
  answer(id, decision) {
    this.expireRequests();
    const r = this.requests.get(id); if (!r) throw fail('That request does not exist or has expired.', 404);
    if (r.answer) throw fail('That request was already answered.', 409);
    if (!['once', 'always', 'deny'].includes(decision)) throw fail('Answer once, always or deny.');
    const answer = { decision, at: iso(this.now()) };
    // 1.73.6: the recipes an Always saves are written first; the row is answered, and its waiters woken, only once they are on disk.
    let next = null;
    if (decision === 'always') {
      next = this.items.map(live => {
        if (!r.items.includes(live.id) || live.trashedAt || this.effective(live) === 'every' || live.recipes.some(x => VaultStore.sameCommand(x, r))) return live;
        const i = structuredClone(live); i.recipes.push({ id: shortId(), argv: r.argv, cwd: r.cwd, action: r.action, created: answer.at }); if (i.recipes.length > LIMITS.recipes) i.recipes.shift(); this.touch(i); return i;
      });
    }
    this.audit({ action: 'request-answered', request: r.id, item: r.items[0], name: r.itemNames.join(','), by: 'owner', decision, session: r.session, sessionTitle: r.sessionTitle, argv: r.argv, cwd: r.cwd });
    if (next) { this.save({ items: next }); this.items = next; }
    r.answer = answer;
    for (const w of r.waiters.splice(0)) w(r);
    return this.requestView(r);
  }
  // The pending requests a session raised, oldest first (for answers the owner types in that conversation).
  pendingFor(session) { this.expireRequests(); return [...this.requests.values()].filter(r => !r.answer && r.session && r.session === session); }
  // Resolves with the request once answered, or null when `ms` pass first.
  waitAnswer(id, ms) {
    this.expireRequests();
    const r = this.requests.get(id); if (!r) throw fail('That request does not exist or has expired.', 404);
    if (r.answer) return Promise.resolve(r);
    return new Promise(resolve => { const t = setTimeout(() => { r.waiters = r.waiters.filter(w => w !== done); resolve(null); }, ms); const done = () => { clearTimeout(t); resolve(r); }; r.waiters.push(done); });
  }
  expireRequests(now = this.now()) {
    // 1.82.1: an answered request lives until 15 minutes after the answer, as the second clause always meant; the first
    // clause used to delete it at the request's own expiry first, so an approval given near the end of the window was gone
    // a minute later. An unanswered request still expires at its own time.
    for (const [id, r] of this.requests) {
      const dead = r.answer ? Date.parse(r.answer.at) + LIMITS.requestTtlMs <= now : Date.parse(r.expiresAt) <= now;
      if (!dead) continue;
      if (!r.answer) { r.answer = { decision: 'expired', at: iso(now) }; for (const w of r.waiters.splice(0)) w(r); }
      this.requests.delete(id);
    }
  }
  // Values for a run that policy allows; recorded first. Returns the secrets to bind and the scrub list.
  // `action` is 'run' (a command the daemon spawns) or 'fill' (1.43: a value typed into a browser tool by pocket-mcp-proxy).
  release(bound, cmd, { session = null, sessionTitle = '', by = 'agent', request = null, action = 'run' } = {}) {
    this.open();
    const items = [...new Map(bound.map(b => [b.item.id, b.item])).values()];
    for (const item of items) this.audit({ action, item: item.id, name: item.name, by, session, sessionTitle, argv: cmd.argv, cwd: cmd.cwd, request });
    const at = iso(this.now());
    const next = this.items.map(live => items.includes(live) ? { ...live, lastUsedAt: at, lastUsedBy: { session, sessionTitle, kind: by } } : live);
    this.save({ items: next }); this.items = next;
    const secrets = {}; for (const b of bound) secrets[b.v] = b.item.values[b.field];
    return secrets;
  }
  // Removed items are purged after 30 days.
  purge(now = this.now()) {
    if (this.locked) { this.expireRequests(now); return []; }
    const gone = this.items.filter(i => i.trashedAt && Date.parse(i.trashedAt) + LIMITS.trashDays * 86400_000 <= now);
    if (gone.length) { const next = this.items.filter(i => !gone.includes(i)); this.save({ items: next }); this.items = next; }
    this.expireRequests(now);
    return gone.map(i => i.name);
  }
}

// ---------- scrubbing ----------
// Every form a value is likely to take in a program's output: as typed, base64, base64url, URL-encoded, JSON-escaped
// (1.73.3: in the spellings other JSON writers use too, and escaped twice).
export function needlesFor(values) {
  const out = new Set();
  // 1.73.8: a value with a lone surrogate reaches a child's environment as U+FFFD; that spelling is a form too.
  for (const v of values.flatMap(x => typeof x === 'string' && x.toWellFormed && x.toWellFormed() !== x ? [x, x.toWellFormed()] : [x])) {
    if (typeof v !== 'string' || v.length < 4) continue; // a 1–3 character value would shred the output; it is not a secret anyone can keep
    out.add(v);
    const bytes = Buffer.from(v, 'utf8'), std = bytes.toString('base64');
    out.add(std); out.add(bytes.toString('base64url')); out.add(std.replace(/=+$/, '')); // 1.82.1: unpadded standard base64 too
    // 1.82.1: a value inside a longer base64 text (an HTTP Basic header is base64 of "user:password"; tokens and config
    // blobs carry values the same way) is spelled by one of three alignments. The characters of each alignment that depend
    // on the value alone are a form, in standard and URL-safe spelling, when there are at least 7 of them (every value of 6
    // characters or more; a 4–5 character value is caught only when it is encoded on its own).
    for (let k = 0; k < 3; k++) {
      const core = Buffer.concat([Buffer.alloc(k), bytes]).toString('base64').slice(Math.ceil(k * 8 / 6), Math.floor((k + bytes.length) * 8 / 6));
      if (core.length >= 7) { out.add(core); out.add(core.replace(/\+/g, '-').replace(/\//g, '_')); }
    }
    try { const e = encodeURIComponent(v); if (e !== v) out.add(e); } catch { }
    const j = JSON.stringify(v).slice(1, -1); if (j !== v) out.add(j);
    // PHP's json_encode writes "/" as "\/" and, like Python's json.dumps, non-ASCII as \uXXXX; a JSON string carried inside
    // another JSON string (a log line, an API body echoed back) is escaped once more.
    const slashed = j.replace(/\//g, '\\/'); if (slashed !== j) out.add(slashed);
    const ascii = t => t.replace(/[^\x00-\x7f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    for (const t of [j, slashed]) { const a = ascii(t); if (a !== t) out.add(a); }
    const twice = JSON.stringify(j).slice(1, -1); if (twice !== j) out.add(twice);
  }
  return [...out].filter(Boolean).sort((a, b) => b.length - a.length);
}
// A streaming replacer: text arrives in chunks; the tail of each chunk (one less than the longest form) is held
// back until the next chunk or the end, and the cut is moved back to the start of any form that straddles it, so a
// value split across two chunks is still caught. (1.73.8: it used to move forward past the form, which could leave
// the start of an overlapping occurrence at the very end with nothing held to complete it.) `table` is [{forms, ph}]
// with the longest forms first.
export function makeScrubStream(table) {
  const forms = table.flatMap(p => p.forms), hold = Math.max(0, ...forms.map(f => f.length - 1));
  let carry = '';
  const rep = t => { for (const p of table) for (const f of p.forms) t = t.split(f).join(p.ph); return t; };
  return {
    push(chunk) {
      const t = carry + chunk; let cut = Math.max(0, t.length - hold), moved = true;
      while (moved) { moved = false; for (const f of forms) { const i = t.indexOf(f, Math.max(0, cut - f.length + 1)); if (i !== -1 && i < cut) { cut = i; moved = true; } } }
      carry = t.slice(cut); return rep(t.slice(0, cut));
    },
    end() { const t = rep(carry); carry = ''; return t; },
  };
}
export function scrubber(values, placeholder = '{{vault}}') { return makeScrubStream([{ forms: needlesFor(values), ph: placeholder }]); }

// ---------- the run ----------
// Spawns the command with the secrets in its environment (never its arguments), no TTY, output piped through the
// scrubber and capped. `onOut`/`onErr` get scrubbed text as it arrives. Resolves when the child is gone.
// 1.73.7: the command leads its own process group. Timeout, abort and the output cap signal the whole group (TERM, then
// KILL after five seconds), and so does the command's own exit: whatever it started and left running is ended, so a run
// cannot leave a daemon behind holding the values or the output pipes. The run resolves within about two seconds of the
// command's exit even if something outside the group still holds a pipe.
export function runWithSecrets({ argv, cwd, env, secrets, placeholders, timeoutMs = LIMITS.timeoutDefault * 1000, maxOutput = LIMITS.output, onOut = () => {}, onErr = () => {}, signal }) {
  return new Promise(resolve => {
    // One replacer per stream: every form of every value becomes that value's own placeholder, longest values first.
    const table = Object.values(secrets).map(v => ({ forms: needlesFor([v]), ph: placeholders?.[v] ? `{{vault:${placeholders[v]}}}` : '{{vault}}' })).filter(p => p.forms.length).sort((a, b) => b.forms[0].length - a.forms[0].length);
    const out = makeScrubStream(table), err = makeScrubStream(table);
    let total = 0, truncated = false, done = false, timedOut = false, child, exited = null, grace = null, aborted = false;
    const group = sig => signalGroup(child?.pid, sig);
    const finish = (code, signalName, error) => { if (done) return; done = true; clearTimeout(timer); clearTimeout(grace); signal?.removeEventListener?.('abort', abort); resolve({ code, signal: signalName, truncated, timedOut, error }); };
    const abort = () => { if (!child?.pid || aborted || done) return; aborted = true; group('SIGTERM'); setTimeout(() => group('SIGKILL'), 5000).unref(); };
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
    signal?.addEventListener?.('abort', abort);
    try { child = spawn(argv[0], argv.slice(1), { cwd, env: { ...env, ...secrets }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: true }); }
    catch (e) { return finish(null, null, e.message); }
    child.on('error', e => finish(null, null, e.message));
    const emit = (fn, text) => { if (!text) return; total += text.length; if (total > maxOutput) { if (!truncated) { truncated = true; fn(text.slice(0, Math.max(0, text.length - (total - maxOutput)))); abort(); } return; } fn(text); };
    const settle = (code, sig) => { if (done) return; emit(onOut, out.end()); emit(onErr, err.end()); finish(code, sig, null); };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', c => emit(onOut, out.push(c))); child.stderr.on('data', c => emit(onErr, err.push(c)));
    // The command is done: end what it left in its group, give the pipes a second to drain, then stop waiting for them.
    // 1.82.1: the KILL a second later is its own timer, not part of the drain wait: when the pipes closed at once, settling
    // cancelled the drain timer and the KILL with it, and a group member that ignored TERM outlived the run.
    child.on('exit', (code, sig) => {
      exited = [code, sig]; group('SIGTERM');
      setTimeout(() => group('SIGKILL'), 1000);
      grace = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); settle(...exited); }, 2000);
    });
    child.on('close', (code, sig) => settle(...(exited || [code, sig])));
  });
}

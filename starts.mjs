// Start links (1.57): a briefing an agent or a job hands to Pocket, kept in one JSON file in the data directory and
// written atomically. POST /api/start stores it and answers with an id; opening #/start/<id> signed in puts the briefing
// in New session's draft, in the workspace and with the agent the entry names. Nothing starts until the owner taps
// Start. Entries expire (7 days by default, 1 to 30) and the file keeps at most LIMITS.entries, oldest dropped first.
// Made for alerts that arrive elsewhere (a Telegram message with an "Open in Pocket Code" button) so handling one is a
// tap and a sentence rather than a copy and paste.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const LIMITS = { text: 20000, title: 160, entries: 1600, ttlDaysDefault: 7, ttlDaysMax: 30 };
const PROVIDERS = ['claude', 'codex'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export class StartStore {
  constructor(file, { write, now } = {}) {
    this.file = file;
    this.now = now || Date.now;
    this.write = write || ((f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 }); fs.renameSync(tmp, f); });
    this.entries = [];
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(d.entries)) this.entries = d.entries; } catch { }
  }
  save(entries = this.entries) { this.write(this.file, { version: 1, entries }); }
  // The live list without expired entries and within the cap (newest kept); nothing changes here.
  pruned() {
    const t = this.now(), live = this.entries.filter(e => Date.parse(e.expiresAt) > t);
    return live.length > LIMITS.entries ? live.slice(live.length - LIMITS.entries) : live;
  }
  purge() { const next = this.pruned(), n = this.entries.length - next.length; this.entries = next; return n; }
  // body: { text, directory?, provider?, title?, ttlDays? } → the stored entry. The caller decides who may add.
  add(body, { actor = 'ui' } = {}) {
    const text = str(body.text, LIMITS.text);
    if (!text) throw fail('A start link needs the briefing text.');
    if (typeof body.text === 'string' && body.text.trim().length > LIMITS.text) throw fail(`The briefing is too long (at most ${LIMITS.text} characters).`);
    let directory = str(body.directory, 1000);
    if (directory) { if (!path.isAbsolute(directory)) throw fail('The directory must be a full path.'); directory = path.normalize(directory).replace(/\/+$/, '') || '/'; }
    const provider = str(body.provider, 10);
    if (provider && !PROVIDERS.includes(provider)) throw fail('The agent must be claude or codex.');
    const title = str(body.title, LIMITS.title);
    let ttl = body.ttlDays === undefined || body.ttlDays === '' ? LIMITS.ttlDaysDefault : Number(body.ttlDays);
    if (!Number.isFinite(ttl) || ttl < 1 || ttl > LIMITS.ttlDaysMax) throw fail(`The link must last 1 to ${LIMITS.ttlDaysMax} days.`);
    ttl = Math.round(ttl);
    // 1.73.6: the next list is written first and installed once the file holds it; a failed write leaves no entry readable.
    const next = this.pruned();
    let id;
    do { id = randomBytes(6).toString('hex'); } while (next.some(e => e.id === id));
    const t = this.now();
    const entry = { id, text, directory, provider, title, by: actor, createdAt: iso(t), expiresAt: iso(t + ttl * 86400_000) };
    next.push(entry);
    if (next.length > LIMITS.entries) next.splice(0, next.length - LIMITS.entries);
    this.save(next); this.entries = next;
    return entry;
  }
  get(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{12}$/.test(id)) return null;
    const e = this.entries.find(x => x.id === id);
    if (!e || Date.parse(e.expiresAt) <= this.now()) return null;
    return e;
  }
}

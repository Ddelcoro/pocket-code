// Coordination (1.99): named holds, so two conversations don't work the same shared thing at once. A hold is advisory:
// one holder, a reason and an expiry. Agents check it because their instructions say to, and nothing stops a deploy; a
// real lock such as `dad-deploy-locked` keeps doing the enforcing. It covers the whole job (build, verify, wait for the
// owner), where a lock covers only the rollout step. The server proves who a conversation is from its runner token and
// never takes a name from what an agent says; anything else counts as `Terminal session`, unverified.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { shellArg } from './skills.mjs';

export const SEEDS = ['dad-staging', 'dad-production', 'tpv-deploy', 'pocket-main'];
export const LIMITS = { ttlDefaultMs: 60 * 60_000, ttlMaxMs: 8 * 3600_000, ttlMinMs: 60_000, reason: 200, note: 300, recent: 30, recentMs: 7 * 86400_000, names: 200, waiters: 20, notices: 10, offerMs: 10 * 60_000, blockStaleMs: 30_000, waitMs: 8 * 3600_000 };
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';

export function checkName(value) {
  const name = str(value, 80).toLowerCase();
  if (!NAME.test(name)) throw fail('A hold name is letters, numbers, dots and dashes, such as dad-staging.');
  return name;
}
// 45m, 2h or a plain number of minutes.
export function parseTtl(value) {
  if (value === undefined || value === null || value === '') return LIMITS.ttlDefaultMs;
  const m = /^(\d+)\s*([mh]?)$/.exec(String(value).trim().toLowerCase());
  if (!m) throw fail('Give the time as minutes or hours, such as 45m or 2h.');
  const ms = Number(m[1]) * (m[2] === 'h' ? 3600_000 : 60_000);
  if (ms < LIMITS.ttlMinMs || ms > LIMITS.ttlMaxMs) throw fail('A hold lasts from 1 minute to 8 hours.');
  return ms;
}
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
// `staging` beside `dad-staging` would be two holds on one thing. One name inside the other at a word boundary, or a
// slip of a letter or two, counts as close.
export function closeName(name, known) {
  const within = (a, b) => (`-${b}-`).includes(`-${a}-`) || b.startsWith(a) && a.length >= 4;
  return known.find(k => k !== name && (within(name, k) || within(k, name) || (Math.min(name.length, k.length) >= 5 && distance(name, k) <= 2))) || null;
}
const sameHolder = (a, b) => Boolean(a?.session) && a.session === b?.session;

export class CoordStore {
  constructor(file, { write, now } = {}) {
    this.file = file; this.now = now || Date.now;
    this.write = write || ((f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 }); fs.renameSync(tmp, f); });
    this.state = { holds: [], waits: {}, offers: {}, recent: [], names: [], notices: {} };
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); for (const k of Object.keys(this.state)) if (d[k] && typeof d[k] === typeof this.state[k]) this.state[k] = d[k]; } catch { }
  }
  // Every change is written first and installed once the file holds it, so a failed write leaves nothing half done.
  commit(next) { this.write(this.file, { version: 1, ...next }); this.state = next; }
  draft() { return structuredClone(this.state); }
  known(s = this.state) { return [...new Set([...SEEDS, ...s.names, ...s.holds.map(h => h.name)])]; }
  live(name, s = this.state) { return s.holds.find(h => h.name === name) || null; }
  ended(s, hold, event, extra = {}) {
    s.holds = s.holds.filter(h => h !== hold);
    s.recent.unshift({ ...hold, event, endedAt: this.now(), ...extra });
    const cutoff = this.now() - LIMITS.recentMs;
    s.recent = s.recent.filter(r => r.endedAt > cutoff).slice(0, LIMITS.recent);
  }
  queue(s, name) {
    const t = this.now();
    const rows = (s.waits[name] || []).filter(w => t - w.at < LIMITS.waitMs && !(w.block && t - (w.seenAt || w.at) > LIMITS.blockStaleMs));
    if (rows.length) s.waits[name] = rows; else delete s.waits[name];
    return rows;
  }
  notice(s, session, text) {
    if (!session) return;
    s.notices[session] = [...(s.notices[session] || []), text].slice(-LIMITS.notices);
    const sessions = Object.keys(s.notices); // one that never runs again must not keep them for ever
    if (sessions.length > 100) delete s.notices[sessions[0]];
  }
  // The next conversation to wake: the first in line, if it asked to be woken. One running `--block` in its shell finds
  // the name free on its own next check.
  offer(s, name) {
    if (this.live(name, s)) return null;
    const first = this.queue(s, name)[0];
    if (!first || first.block) return null;
    s.waits[name].shift(); if (!s.waits[name].length) delete s.waits[name];
    s.offers[name] = this.now();
    return { name, ...first };
  }
  hold(value, { reason, ttl, isNew = false, holder }) {
    const name = checkName(value), ttlMs = parseTtl(ttl), s = this.draft(), t = this.now(), held = this.live(name, s);
    if (held && !sameHolder(held.holder, holder)) throw fail(`${name} is held.`, 409, { code: 'held', hold: held });
    if (!held && !this.known(s).includes(name)) {
      const close = isNew ? null : closeName(name, this.known(s));
      if (close) throw fail(`${name} is close to ${close}. Use ${close}, or pass --new if this is a different thing.`, 409, { code: 'close_name', close });
      s.names = [...s.names, name].slice(-LIMITS.names);
    }
    const text = str(reason, LIMITS.reason);
    if (!held && !text) throw fail('A hold needs a reason, so whoever finds it knows what is happening.');
    if (held) Object.assign(held, { reason: text || held.reason, ttlMs, expiresAt: t + ttlMs });
    else s.holds.push({ name, reason: text, holder, heldAt: t, ttlMs, expiresAt: t + ttlMs });
    if (holder.session && s.waits[name]) { s.waits[name] = s.waits[name].filter(w => w.session !== holder.session); if (!s.waits[name].length) delete s.waits[name]; }
    delete s.offers[name];
    this.commit(s);
    return { hold: this.live(name), renewed: Boolean(held) };
  }
  // A free name answers at once. Otherwise the caller joins the line: a conversation to be woken, or `block` to keep asking.
  wait(value, { waiter, block = false, id = '', run = {} }) {
    const name = checkName(value), s = this.draft(), t = this.now(), held = this.live(name, s), rows = this.queue(s, name);
    if (sameHolder(held?.holder, waiter)) throw fail(`You hold ${name}.`, 409, { code: 'own_hold' });
    if (!block && !waiter.session) throw fail('A terminal session cannot be woken. Use --block to wait here.', 400, { code: 'needs_block' });
    let mine = rows.find(w => id ? w.id === id : sameHolder(w, waiter));
    const offered = t - (s.offers[name] || 0) < LIMITS.offerMs; // the one just told has a while to claim it
    if (!held && !offered && (!rows.length || rows[0] === mine)) {
      if (mine) { s.waits[name] = rows.slice(1); if (s.waits[name].length) s.offers[name] = t; else delete s.waits[name]; this.commit(s); }
      return { free: true, name };
    }
    if (!mine) {
      if (rows.length >= LIMITS.waiters) throw fail(`Too many are already waiting for ${name}.`, 429);
      mine = { id: randomBytes(6).toString('hex'), ...waiter, at: t, block: Boolean(block), ...(block ? { seenAt: t } : { run }) };
      s.waits[name] = [...rows, mine];
    } else if (block) mine.seenAt = t;
    this.commit(s);
    return { free: false, name, id: mine.id, position: s.waits[name].findIndex(w => w.id === mine.id) + 1, hold: held };
  }
  cancelWait(value, { id }) {
    const name = checkName(value), s = this.draft(), rows = s.waits[name] || [];
    if (!rows.some(w => w.id === id)) return false;
    s.waits[name] = rows.filter(w => w.id !== id); if (!s.waits[name].length) delete s.waits[name];
    this.commit(s); return true;
  }
  // The holder lets go. A terminal session is unverified, so it can release only a hold no conversation proved.
  release(value, { by, note }) {
    const name = checkName(value), s = this.draft(), held = this.live(name, s);
    if (!held) throw fail(`${name} is not held.`, 404, { code: 'not_held' });
    if (!sameHolder(held.holder, by) && held.holder.session) throw fail(`${name} is held by another conversation. It releases it, or the owner does in Coordination.`, 403, { code: 'not_holder', hold: held });
    const text = str(note, LIMITS.note);
    this.ended(s, held, 'released', { note: text });
    const next = this.offer(s, name);
    this.commit(s);
    return { name, next, note: text };
  }
  // The owner's one tap. The holder finds out when it next runs.
  ownerRelease(value) {
    const name = checkName(value), s = this.draft(), held = this.live(name, s);
    if (!held) throw fail(`${name} is not held.`, 404, { code: 'not_held' });
    this.ended(s, held, 'owner');
    this.notice(s, held.holder.session, `The owner released your hold on ${name}. Check with \`pocket-coord list\` and claim it again before you carry on with that work.`);
    const next = this.offer(s, name);
    this.commit(s);
    return { name, next };
  }
  // Each sweep renews what its conversation is still running, ends what ran out, and offers free names to the next in line.
  sweep({ running = new Set() } = {}) {
    const s = this.draft(), t = this.now(), woken = [];
    let changed = false;
    for (const h of [...s.holds]) {
      if (h.holder.session && running.has(h.holder.session)) {
        if (h.expiresAt - t < h.ttlMs - 60_000) { h.expiresAt = t + h.ttlMs; changed = true; }
      } else if (h.expiresAt <= t) {
        this.ended(s, h, 'expired');
        this.notice(s, h.holder.session, `Your hold on ${h.name} expired. Check with \`pocket-coord list\` and claim it again before you carry on with that work.`);
        changed = true;
      }
    }
    for (const name of Object.keys(s.waits)) {
      const before = s.waits[name].length, rows = this.queue(s, name);
      if (rows.length !== before) changed = true;
      if (!rows.length || this.live(name, s) || t - (s.offers[name] || 0) < LIMITS.offerMs) continue;
      const next = this.offer(s, name);
      if (next) { woken.push(next); changed = true; }
    }
    for (const name of Object.keys(s.offers)) if (t - s.offers[name] >= LIMITS.offerMs && !s.waits[name]) { delete s.offers[name]; changed = true; }
    if (changed) this.commit(s);
    return woken;
  }
  // The one just offered it couldn't be told, so the next in line gets it.
  wakeNext(name) {
    const s = this.draft(), next = this.offer(s, name);
    if (next) this.commit(s);
    return next;
  }
  // What a conversation has to be told, taken once.
  takeNotices(session) {
    const rows = this.state.notices[session];
    if (!rows?.length) return [];
    const s = this.draft(); delete s.notices[session];
    this.commit(s);
    return rows;
  }
  snapshot() {
    const { holds, waits, recent } = this.state, t = this.now();
    return {
      now: t, seeds: SEEDS,
      holds: holds.map(h => ({ ...h, waiters: (waits[h.name] || []).map(({ run, ...w }) => w) })), // eslint-disable-line no-unused-vars
      recent,
    };
  }
}

// The line every agent gets while Coordination is on.
export function coordinationInstructions(script) {
  const cli = shellArg(script), skill = path.join(path.dirname(path.dirname(script)), 'skills', 'pocket-coord', 'SKILL.md');
  return [
    'This Pocket Code keeps holds: named claims on shared things such as a staging site or a deploy.',
    `Before you deploy, or work on anything shared that another conversation could be using, claim it with \`node ${cli} hold <name> --reason "…"\`, and release it with \`release <name>\` when the job is done, not when your reply ends.`,
    '`list` shows what is held. If the name is held, the command fails and names the holder: stop, and either tell the user or run `wait <name>`, which wakes this conversation once when it is free.',
    `A hold is advice and stops nothing, so keep obeying any real deploy lock. The pocket-coord skill (\`${skill}\`) has the procedure.`,
  ].join(' ');
}

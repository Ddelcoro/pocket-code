#!/usr/bin/env node
// pocket-coord: claim shared things so two conversations don't work on them at once (1.99).
// Talks to the running Pocket Code server over loopback with the token it writes to <data dir>/cli-token; it never opens
// coordination.json itself. Who is asking comes from the conversation's runner token, never from anything said here.
//
//   pocket-coord hold <name> --reason "…" [--ttl 45m] [--new]   claim it; held by someone else exits 2 and names them
//   pocket-coord wait <name>                                    be woken once when it is free (a conversation only)
//   pocket-coord wait <name> --block [--timeout 30m]            wait here instead; a timeout exits 3
//   pocket-coord release <name> [--note "…"]                    let it go
//   pocket-coord list [--json]                                  what is held, who waits, what ended lately
// A hold lasts 60 minutes unless --ttl says otherwise, 8 hours at most, and renews while its conversation is running.
// --new says a name close to an existing one really is a different thing.
// Environment: POCKET_DATA_DIR and PORT as for the server (the server's .env is read for both); POCKET_URL overrides.
import fs from 'node:fs';
import path from 'node:path';
import { readEnvFile } from '../env-file.mjs';

const root = path.resolve(import.meta.dirname, '..');
const envFile = process.env.POCKET_ENV_FILE ?? path.join(root, '.env');
const fileEnv = readEnvFile(envFile);
const env = k => process.env[k] ?? fileEnv[k];
const dataDir = env('POCKET_DATA_DIR') || root;
// The daemon's own address first, then this checkout's .env, and only then an inherited PORT: an app the agent is working on
// may export PORT, and the CLI token must never go to it.
const base = (() => { if (env('POCKET_URL')) return env('POCKET_URL'); try { const u = fs.readFileSync(path.join(dataDir, 'cli-url'), 'utf8').trim(); if (/^http:\/\/127\.0\.0\.1:\d+$/.test(u)) return u; } catch { } return `http://127.0.0.1:${Number(fileEnv.PORT) || Number(process.env.PORT) || 3610}`; })();

const argv = process.argv.slice(2);
const opts = { _: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (['--json', '--block', '--new'].includes(a)) opts[a.slice(2)] = true;
  else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i] ?? '';
  else opts._.push(a);
}
const [cmd, name] = opts._;
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };
if (!cmd || cmd === 'help' || cmd === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 13).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }

let token = '';
try { token = fs.readFileSync(path.join(dataDir, 'cli-token'), 'utf8').trim(); } catch { die(`No CLI token at ${path.join(dataDir, 'cli-token')}. Is Pocket Code running from this checkout?`); }
const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(process.env.POCKET_RUNNER_TOKEN ? { 'x-pocket-runner': process.env.POCKET_RUNNER_TOKEN } : {}) };
const age = ms => { const m = Math.max(0, Math.round(ms / 60_000)); return m < 1 ? 'under a minute' : m < 60 ? `${m} minute${m === 1 ? '' : 's'}` : `${Math.floor(m / 60)}h ${m % 60}m`; };
const who = h => h.holder?.session ? `"${h.holder.title || 'a conversation'}"` : 'a terminal session (unverified)';
const held = (h, now) => `${h.name} is held by ${who(h)}: ${h.reason}. Held for ${age((now || Date.now()) - h.heldAt)}.`;
const inLine = (d) => d.hold ? held(d.hold, d.now) : `${d.name} was just offered to the conversation before you.`;
const ENDED = { released: 'released', expired: 'expired', owner: 'released by the owner' };
async function call(p, body) {
  let r;
  try { r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) }); }
  catch (e) { die(`Pocket Code is not reachable at ${base}: ${e.name === 'TimeoutError' ? 'no answer in 30 seconds' : e.cause?.code || e.message}`); }
  const data = await r.json().catch(() => ({}));
  if (r.ok) return data;
  if (data.code === 'coordination_off') die('Coordination is off for this Pocket Code. Turn it on in Settings → Projects, files, tasks & vault.', 5);
  if (data.code === 'held') die(`${held(data.hold, data.now)}\nStop and tell the user, or wait with: pocket-coord wait ${data.hold.name}`, 2);
  die(data.error || `${r.status} from ${p}`, r.status === 401 ? 4 : r.status === 409 ? 2 : 1);
}
const out = (data, text) => console.log(opts.json ? JSON.stringify(data, null, 1) : text);
const need = () => { if (!name) die(`Name what to ${cmd}: pocket-coord ${cmd} <name>`); };

switch (cmd) {
  case 'hold': {
    need();
    const d = await call('/api/coordination/hold', { name, reason: opts.reason, ttl: opts.ttl, new: Boolean(opts.new) });
    out(d, `${d.renewed ? 'Renewed' : 'Holding'} ${d.hold.name} until ${new Date(d.hold.expiresAt).toLocaleTimeString()}. Release it when the job is done.`);
    break;
  }
  case 'wait': {
    need();
    let timeoutMs = 0;
    if (opts.timeout) { const m = /^(\d+)([smh]?)$/.exec(String(opts.timeout)); if (!m) die('Give the timeout as seconds, minutes or hours, such as 30m.'); timeoutMs = Number(m[1]) * ({ s: 1000, h: 3600_000 }[m[2]] || 60_000); }
    let d = await call('/api/coordination/wait', { name, block: Boolean(opts.block) });
    if (d.free) { out(d, `${d.name} is free. Claim it with: pocket-coord hold ${d.name} --reason "…"`); break; }
    if (!opts.block) { out(d, `${inLine(d)}\nNumber ${d.position} in line. Pocket wakes this conversation once when it is free. End your reply now.`); break; }
    const id = d.id, began = Date.now();
    console.error(`${inLine(d)} Waiting…`);
    const giveUp = async () => { await call('/api/coordination/wait/cancel', { name, id }); };
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { giveUp().finally(() => process.exit(130)); });
    while (!d.free) {
      if (timeoutMs && Date.now() - began >= timeoutMs) { await giveUp(); die(`Still held after ${age(timeoutMs)}.`, 3); }
      await new Promise(r => setTimeout(r, Number(process.env.POCKET_COORD_POLL_MS) || 5000));
      d = await call('/api/coordination/wait', { name, block: true, id });
    }
    out(d, `${d.name} is free. Claim it with: pocket-coord hold ${d.name} --reason "…"`);
    break;
  }
  case 'release': {
    need();
    const d = await call('/api/coordination/release', { name, note: opts.note });
    out(d, `Released ${d.name}.${d.woke ? ` Woke "${d.woke}".` : ''}`);
    break;
  }
  case 'list': {
    const d = await call('/api/coordination');
    if (opts.json) { console.log(JSON.stringify(d, null, 1)); break; }
    if (!d.holds.length) console.log('Nothing is held.');
    for (const h of d.holds) {
      console.log(held(h, d.now));
      if (h.waiters.length) console.log('  Waiting: ' + h.waiters.map(w => w.session ? `"${w.title || 'a conversation'}"` : 'a terminal session').join(', '));
    }
    for (const r of d.recent.slice(0, 5)) console.log(`Lately: ${r.name} ${ENDED[r.event] || r.event} ${age(d.now - r.endedAt)} ago${r.note ? `: ${r.note}` : ''}`);
    console.log('Usual names: ' + d.seeds.join(', '));
    break;
  }
  default: die(`Unknown command: ${cmd}. Run pocket-coord help.`);
}

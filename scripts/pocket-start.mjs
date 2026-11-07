#!/usr/bin/env node
// pocket-start: hand Pocket Code a briefing and get a link that opens New session with it typed in (1.57).
// Talks to the running Pocket Code server over loopback with the token it writes to <data dir>/cli-token.
// Nothing starts until the owner opens the link and taps Start.
//
//   pocket-start add --text "…" | --file <path|->  [--dir <workspace>] [--provider claude|codex|acp] [--title "…"] [--ttl-days N] [--handoff] [--json]
//                                                  prints the URL (or the path, when Pocket does not know its public address)
//                                                  --handoff: put the link on its own line in your reply and Pocket shows a card with
//                                                  Start. The folder defaults to the one you are in, the agent to your own.
//   pocket-start show <id> [--json]                the stored briefing
// Environment: POCKET_DATA_DIR and PORT as for the server (the server's .env is read for both); POCKET_URL overrides;
// POCKET_PUBLIC_URL is used for the printed link when the server has none.
import fs from 'node:fs';
import path from 'node:path';
import { readEnvFile } from '../env-file.mjs';

const root = path.resolve(import.meta.dirname, '..');
const envFile = process.env.POCKET_ENV_FILE ?? path.join(root, '.env');
const fileEnv = readEnvFile(envFile);
const env = k => process.env[k] ?? fileEnv[k];
const dataDir = env('POCKET_DATA_DIR') || root;
const base = (() => { if (env('POCKET_URL')) return env('POCKET_URL'); try { const u = fs.readFileSync(path.join(dataDir, 'cli-url'), 'utf8').trim(); if (/^http:\/\/127\.0\.0\.1:\d+$/.test(u)) return u; } catch { } return `http://127.0.0.1:${Number(fileEnv.PORT) || Number(process.env.PORT) || 3610}`; })();

const argv = process.argv.slice(2);
const opts = { _: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json') opts.json = true;
  else if (a === '--handoff') opts.handoff = true;
  else if (a.startsWith('--')) { const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); opts[k] = argv[++i] ?? ''; }
  else opts._.push(a);
}
const [cmd, ...rest] = opts._;
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };
if (!cmd || cmd === 'help' || cmd === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 12).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }

let token = '';
try { token = fs.readFileSync(path.join(dataDir, 'cli-token'), 'utf8').trim(); } catch { die(`No CLI token at ${path.join(dataDir, 'cli-token')}. Is Pocket Code running from this checkout? (POCKET_DATA_DIR=${dataDir})`); }
async function call(p, body, { missing } = {}) {
  let r;
  try { r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(process.env.POCKET_RUNNER_TOKEN ? { 'x-pocket-runner': process.env.POCKET_RUNNER_TOKEN } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) }); } // 1.73.8: a hung daemon is not waited on for undici's 5 minutes
  catch (e) { die(`Pocket Code is not reachable at ${base}: ${e.name === 'TimeoutError' ? 'no answer in 30 seconds' : e.cause?.code || e.message}`); }
  const data = await r.json().catch(() => ({}));
  if (r.status === 404 && missing) return null;
  if (!r.ok) die(data.error || `${r.status} from ${p}`, r.status === 401 ? 4 : 1);
  return data;
}

if (cmd === 'add') {
  let text = opts.text || '';
  if (opts.file !== undefined) text = opts.file === '-' || opts.file === '' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(opts.file, 'utf8');
  if (!text.trim()) die('Give the briefing with --text "…" or --file <path|->.');
  const body = { text, directory: opts.dir || (opts.handoff ? process.cwd() : ''), provider: opts.provider || '', title: opts.title || '', ttlDays: opts.ttlDays, ...(opts.handoff ? { kind: 'handoff' } : {}) };
  const d = await call('/api/start', body);
  const url = d.url || (env('POCKET_PUBLIC_URL') ? env('POCKET_PUBLIC_URL').replace(/\/$/, '') + d.path : d.path);
  if (opts.json) console.log(JSON.stringify({ ...d, url }, null, 1)); else console.log(url);
} else if (cmd === 'show') {
  const id = rest[0] || die('Which id?');
  const d = await call('/api/start/' + encodeURIComponent(id), null, { missing: true });
  if (!d) die('That start link has expired or never existed.', 2);
  if (opts.json) console.log(JSON.stringify(d, null, 1)); else console.log(`${d.title || '(untitled)'} · ${d.provider || 'default agent'} · ${d.directory || 'default workspace'} · expires ${d.expiresAt}\n\n${d.text}`);
} else die(`Unknown command: ${cmd}`);

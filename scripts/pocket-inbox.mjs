#!/usr/bin/env node
// pocket-inbox: Inbox Watch from a terminal, an agent session or the inbox watcher itself (1.69).
// Talks to the running Pocket Code server over loopback with the token it writes to <data dir>/cli-token;
// it never opens inbox.json itself. An agent records a decision (act) only when the user asks.
//
//   pocket-inbox add --title "…" (--text "…" | --file <path|->) [--kind alert|digest|lookahead] [--priority critical|high|normal|low]
//                    [--story "…"] [--source "…"] [--url </#/start/<id> or a web address>] [--gmail <https://mail.google.com/…>]
//                    [--doc <Files id>] [--dedupe <key>] [--items <path|->] [--email] [--no-push] [--json]      prints "<id> push=<devices|off> mail=<yes|no|off|failed>"
//                    --items (1.95): a digest's or look-ahead's items as JSON, [{ref, section, title, text, story, gmail, priority}]
//   pocket-inbox list [--state new|all|dismissed] [--since <ISO>] [--json]                   new ones by default, newest first
//   pocket-inbox show <id> [--json]
//   pocket-inbox act <id> <open|unread|dismiss|resolve|not_useful|restore> [--note "…"] [--json]
//   pocket-inbox act <id> <alert|resolve|not_useful|dismiss|restore> --item <ref> [--note "…"]       one item of a digest (1.95)
//   pocket-inbox feedback [--since <ISO>] [--json]                                           the owner's decisions not yet applied
//   pocket-inbox ack <id…>                                                                   the worker applied them
//   pocket-inbox seen [--source <name>] [--profile <path|->]                                 a heartbeat: the worker ran (1.70: with its profile)
//   pocket-inbox watch [--source <name>] [--json]                                            when the watcher checks, which models judge, cost
//   pocket-inbox watch set (--file <path|-> | --every <min> | --pause | --resume) [--source <name>]   change them (only when the user asks)
//   pocket-inbox watch reset [--source <name>]                                               back to the watcher's config file
//   pocket-inbox check [--source <name>] [--json]                                            check mail now (1.75): the watcher takes it up within a minute
// Exit codes: 2 when Pocket is not running here or refused the token, 1 on any other error.
// Environment: POCKET_DATA_DIR and PORT as for the server (the server's .env is read for both); POCKET_URL overrides.
import fs from 'node:fs';
import path from 'node:path';
import { ownerZone, whenIn } from './owner-zone.mjs';
import { readEnvFile } from '../env-file.mjs';

const root = path.resolve(import.meta.dirname, '..');
const envFile = process.env.POCKET_ENV_FILE ?? path.join(root, '.env');
const fileEnv = readEnvFile(envFile);
const env = k => process.env[k] ?? fileEnv[k];
const dataDir = env('POCKET_DATA_DIR') || root;
// The daemon's own address first (<data dir>/cli-url, 1.43.1): an app the agent is working on may export PORT, and the token must never go to it.
const base = (() => { if (env('POCKET_URL')) return env('POCKET_URL'); try { const u = fs.readFileSync(path.join(dataDir, 'cli-url'), 'utf8').trim(); if (/^http:\/\/127\.0\.0\.1:\d+$/.test(u)) return u; } catch { } return `http://127.0.0.1:${Number(fileEnv.PORT) || Number(process.env.PORT) || 3610}`; })();

const argv = process.argv.slice(2);
const opts = { _: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (['--json', '--email', '--no-push', '--pause', '--resume'].includes(a)) opts[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
  else if (a.startsWith('--')) { const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); opts[k] = argv[++i] ?? ''; }
  else opts._.push(a);
}
const [cmd, ...rest] = opts._;
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };
if (!cmd || cmd === 'help' || argv.includes('--help')) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 20).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }

let token = '';
try { token = fs.readFileSync(path.join(dataDir, 'cli-token'), 'utf8').trim(); } catch { die(`Pocket Code is not running here (no cli-token in ${dataDir}).`, 2); }
async function call(p, body) {
  let r;
  try { r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) }); } // 1.73.8: a hung daemon is not waited on for undici's 5 minutes
  catch (e) { die(`Pocket Code is not reachable at ${base}: ${e.name === 'TimeoutError' ? 'no answer in 30 seconds' : e.cause?.code || e.message}`, 2); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (data.code === 'inbox_off') die('Inbox Watch is off for this Pocket Code. Turn it on in Settings → Projects, files, tasks & vault.');
    die(data.error || `${r.status} from ${p}`, r.status === 401 ? 2 : 1);
  }
  return data;
}
const qs = o => { const q = new URLSearchParams(Object.entries(o).filter(([, v]) => v)); return q.size ? '?' + q : ''; };
const when = whenIn(ownerZone(dataDir, env('POCKET_TZ')));
const KIND = { alert: 'alert', digest: 'digest', lookahead: 'look-ahead' };
const STATE = { new: 'new', opened: 'seen', dismissed: 'dismissed', resolved: 'resolved', not_useful: 'not useful' };
const plain = t => String(t || '').replace(/\[([^\]\n]+)\]\([^)\s]*\)/g, '$1');
const line = e => `${e.state === 'new' ? '*' : ' '} ${when(e.at)}  ${e.title}  (${e.id})  ${KIND[e.kind] || e.kind}${e.priority !== 'normal' ? ' · ' + e.priority : ''}${e.state !== 'new' ? ' · ' + (STATE[e.state] || e.state) : ''}`;
function card(e) {
  const lines = [line(e)];
  if (e.story) lines.push(`  Story: ${e.story}`);
  lines.push(`  From: ${e.source}`);
  if (Array.isArray(e.items) && e.items.length) { // 1.95: a digest's items, with the ref `act --item` takes
    const SECTION = { held: 'Held overnight', resolved: 'Came up overnight and already resolved', worth: 'Worth knowing', tidied: 'Taken off your Inbox', listed: 'Already on your list' };
    const ITEM = { alerted: 'added to Inbox', resolved: 'resolved', not_useful: 'not useful' };
    let sec = '';
    for (const it of e.items) {
      if (it.section !== sec) { sec = it.section; lines.push(`  ${SECTION[sec] || sec}:`); }
      lines.push(`  - ${it.title}  [${it.ref}]${it.state !== 'open' ? ' · ' + (ITEM[it.state] || it.state) : ''}${it.story ? '  story: ' + it.story : ''}`);
      if (it.text) lines.push('      ' + plain(it.text).split('\n').join('\n      '));
      if (it.url) lines.push(`      Open: ${it.url}`);
    }
    const rest = plain(e.text).split('\n').filter(l => l.trim() && !l.startsWith('## ') && !l.startsWith('- '));
    if (rest.length) lines.push('  ' + rest.join('\n  '));
  } else if (e.text) lines.push('  ' + plain(e.text).split('\n').join('\n  '));
  if (e.url) lines.push(`  Open: ${e.url}`);
  if (e.gmail) lines.push(`  Gmail: ${e.gmail}`);
  if (e.doc) lines.push(`  File: ${e.doc}`);
  if (e.note) lines.push(`  Note: ${e.note}`);
  if (e.actedAt) lines.push(`  ${e.lastAction === 'restore' ? 'Restored' : 'Marked ' + (STATE[e.state] || e.state)} ${when(e.actedAt)}`);
  return lines.join('\n');
}
const out = (data, text) => console.log(opts.json ? JSON.stringify(data, null, 1) : text);
const mailWord = m => m === true ? 'yes' : m === false ? 'no' : m;

switch (cmd) {
  case 'add': {
    const title = String(opts.title || '').trim();
    if (!title) die('add needs --title "…"');
    let text = opts.text;
    if (opts.file !== undefined) { try { text = opts.file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(opts.file, 'utf8'); } catch (e) { die(`Could not read ${opts.file}: ${e.message}`); } }
    if (text === undefined) die('add needs --text "…" or --file <path|->');
    let items;
    if (opts.items !== undefined) { // 1.95: a digest's items; "-" reads stdin only when the text did not
      try { items = JSON.parse(opts.items === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(opts.items, 'utf8')); } catch (e) { die(`Could not read the items: ${e.message}`); }
      if (!Array.isArray(items)) die('--items must be a JSON list of items');
    }
    const r = await call('/api/inbox', { title, text: String(text).trim(), kind: opts.kind || undefined, priority: opts.priority || undefined, story: opts.story || '', source: opts.source || undefined,
      url: opts.url || '', gmail: opts.gmail || '', doc: opts.doc || '', dedupe: opts.dedupe || '', email: Boolean(opts.email), push: !opts.noPush, ...(items ? { items } : {}) });
    out(r, `${r.entry.id} push=${r.push ?? 'off'} mail=${mailWord(r.mail)}${r.duplicate ? ' duplicate' : ''}`);
    break;
  }
  case 'list': {
    const snap = await call('/api/inbox' + qs({ state: opts.state || 'new', since: opts.since }));
    if (opts.json) { console.log(JSON.stringify(snap.entries, null, 1)); break; }
    if (!snap.entries.length) { console.log((opts.state || 'new') === 'new' ? 'Nothing new from Inbox Watch.' : 'Nothing here.'); break; }
    for (const e of snap.entries) console.log(line(e));
    break;
  }
  case 'show': {
    if (!rest[0]) die('show needs an entry id');
    let e = (await call('/api/inbox?state=all')).entries.find(x => x.id === rest[0]);
    if (!e) e = (await call('/api/inbox?state=dismissed')).entries.find(x => x.id === rest[0]);
    if (!e) die(`No Inbox entry with id ${rest[0]}.`);
    out(e, card(e)); break;
  }
  case 'act': {
    const [id, action] = rest;
    if (!id || !action) die('act needs an entry id and an action: pocket-inbox act <id> resolve');
    const r = await call('/api/inbox/act', { action, id, ...(opts.item ? { item: opts.item } : {}), ...(opts.note !== undefined ? { note: opts.note } : {}) });
    out(r.entry, card(r.entry)); break;
  }
  case 'feedback': {
    const r = await call('/api/inbox/feedback' + qs({ since: opts.since }));
    if (opts.json) { console.log(JSON.stringify(r.feedback, null, 1)); break; }
    if (!r.feedback.length) { console.log('No new feedback.'); break; }
    for (const f of r.feedback) console.log(`${when(f.at)}  ${f.action}  ${f.title}  (${f.id})${f.story ? '  story: ' + f.story : ''}${f.note ? '  note: ' + f.note : ''}`);
    break;
  }
  case 'ack': {
    if (!rest.length) die('ack needs one or more entry ids');
    const r = await call('/api/inbox/ack', { ids: rest });
    out(r, `acked ${r.acked}`); break;
  }
  case 'seen': {
    let profile;
    if (opts.profile !== undefined) { try { profile = JSON.parse(opts.profile === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(opts.profile, 'utf8')); } catch (e) { die(`Could not read the profile: ${e.message}`); } }
    const r = await call('/api/inbox/seen', { source: opts.source || undefined, ...(opts.at ? { at: opts.at } : {}), ...(profile !== undefined ? { profile } : {}) });
    out(r, 'ok'); break;
  }
  case 'watch': {
    const q = qs({ source: opts.source });
    if (rest[0] === 'set' || rest[0] === 'reset') {
      let settings = null;
      if (rest[0] === 'set') {
        const cur = await call('/api/inbox/watch' + q);
        if (opts.file !== undefined) { try { settings = JSON.parse(opts.file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(opts.file, 'utf8')); } catch (e) { die(`Could not read the settings: ${e.message}`); } }
        else {
          settings = structuredClone(cur.settings || cur.profile?.defaults || {});
          if (opts.every !== undefined) settings.every = Number(opts.every);
          if (opts.pause) settings.paused = true;
          if (opts.resume) settings.paused = false;
          if (opts.every === undefined && !opts.pause && !opts.resume) die('watch set needs --file <path|->, --every <minutes>, --pause or --resume');
        }
      }
      const r = await call('/api/inbox/watch', { source: opts.source || undefined, settings });
      out(r, `revision ${r.revision}: ${r.settings ? 'saved' : 'back to the watcher\'s config file'}`); break;
    }
    if (rest[0]) die(`Unknown watch command ${rest[0]}. Use watch, watch set or watch reset.`);
    const r = await call('/api/inbox/watch' + q);
    if (opts.json) { console.log(JSON.stringify({ source: r.source, settings: r.settings, revision: r.revision, updatedAt: r.updatedAt, checkRequestedAt: r.checkRequestedAt, profile: r.profile }, null, 1)); break; }
    const s = r.settings || r.profile?.defaults, st = r.profile?.status, days = r.profile?.usage?.days || [];
    const lines = [`Source: ${r.source}${r.settings ? ` · your settings (revision ${r.revision})` : " · the watcher's config file"}`];
    if (s) {
      lines.push(s.paused ? 'Paused' : s.every ? `Checks every ${s.every} min outside the periods` : 'No checks outside the periods');
      for (const p of s.periods || []) lines.push(`  ${p.name || 'Period'}: days ${p.days.join(',')} ${p.from}–${p.to}, ${p.every ? 'every ' + p.every + ' min' : 'no checks'}`);
      if (s.models) lines.push(`Decisions: ${s.models.decisions?.model} (${s.models.decisions?.reasoning}) · Look-ahead: ${s.models.lookahead?.model} (${s.models.lookahead?.reasoning})`);
      if (typeof (r.profile?.rules?.text ?? s.rules) === 'string') lines.push(`Your rules: ${(r.profile?.rules?.text ?? s.rules).trim().split('\n').filter(Boolean).length} lines (pocket-inbox watch --json shows them)`);
      if (s.tidy) lines.push(`Tidy: ${s.tidy.enabled ? `every ${s.tidy.every} h, takes resolved and handled entries off the list` : 'off'}`);
      if (s.gmailLabel) lines.push(`Gmail label: ${s.gmailLabel.enabled ? `${r.profile?.options?.gmailLabel?.name || 'Pocket Inbox'}, kept in step with this list${r.profile?.options?.gmailLabel?.available === false ? ' (not available: ' + (r.profile.options.gmailLabel.reason || 'no write access') + ')' : ''}` : 'off'}`);
      if (s.firstPass) lines.push(`First pass: ${s.firstPass.enabled ? `on, ${s.firstPass.provider}, skips at ${Math.round(s.firstPass.threshold * 100)}% sure` : 'off'}`);
    } else lines.push('The watcher has not reported its settings yet (it needs inbox-monitor 0.3 or later).');
    if (st) lines.push(`Now: ${st.paused ? 'paused' : st.every ? 'every ' + st.every + ' min' : 'no checks'}${st.period ? ' (' + st.period + ')' : ''}; last check ${when(st.lastCheckAt) || 'never'}; next ${when(st.nextCheckAt) || 'none scheduled'}`);
    const since = r.profile?.usage?.since ? Date.parse(r.profile.usage.since) : 0;
    if (days.length) lines.push(`Last ${Math.min(7, days.length)} days (${r.profile.usage.billing === 'plan' ? 'billed to the plan; dollars at API list price' : r.profile.usage.billing === 'api' ? 'billed per token' : 'no price reported'}):`);
    for (const d of days.slice(0, 7)) lines.push(since && Date.parse(d.date + 'T23:59:59Z') >= since ? `  ${d.date}  ${d.checks} checks  ${d.firstPass?.skipped ? d.firstPass.skipped + ' skipped  ' : ''}${d.calls} calls  ${(d.inputTokens + d.outputTokens).toLocaleString('en-US')} tokens${d.costUsd != null ? '  $' + d.costUsd.toFixed(2) : ''}` : `  ${d.date}  ${d.checks} checks  (calls and cost not recorded)`);
    console.log(lines.join('\n')); break;
  }
  case 'check': { // 1.75: the same as Check now in the Inbox
    const r = await call('/api/inbox/check', { source: opts.source || undefined });
    out(r, `asked ${r.source} to check now (${r.checkRequestedAt}); it takes it up within a minute${r.lastReportAt ? '' : ', once it is running (it has not reported yet)'}`); break;
  }
  default: die(`Unknown command ${cmd}. Run pocket-inbox help.`);
}

// 1.74: Pocket runs Inbox Watch's watcher (inbox-runner.mjs). The real watcher runs against a fake `claude` that answers
// the Gmail connector's calls in stream-json from a JSON mailbox; nothing reaches a mailbox, a model or the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InboxRunner } from '../inbox-runner.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const FAKE = `#!/usr/bin/env python3
import json, os, sys
box = json.load(open(os.environ["FAKE_BOX"]))
prompt = sys.stdin.read()
calls = json.loads(prompt[prompt.index("["):])
def emit(e): print(json.dumps(e))
emit({"type": "system", "subtype": "init", "tools": [] if box.get("no_connector") else ["mcp__claude_ai_Gmail__search_threads", "mcp__claude_ai_Gmail__get_thread", "mcp__claude_ai_Gmail__get_message"]})
if box.get("no_connector"):
    emit({"type": "result", "subtype": "success", "result": "DONE", "total_cost_usd": 0, "usage": {}}); sys.exit()
for i, c in enumerate(calls):
    emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": f"u{i}", "name": c["tool"], "input": c["input"]}]}})
    if c["tool"].endswith("search_threads"):
        sent = "in:sent" in c["input"]["query"]
        senders = [box.get("owner", "Alex Rivera <alex@example.com>")] + box.get("also_sent_as", []) if sent else ["Pat <pat@vendor.example>"]
        res = {"threads": [{"id": f"t{i + 1}", "messageCount": 1, "messages": [{"id": f"m{i + 1}", "sender": x, "labelIds": ["SENT"] if sent else ["INBOX"], "date": "2026-10-21T12:00:00Z"}]} for i, x in enumerate(senders)]}
    else:
        res = {"id": "t1", "messages": [{"id": "m1", "threadId": "t1", "internalDate": "1792584000000", "labelIds": ["INBOX"], "sender": "Pat <pat@vendor.example>", "subject": "Invoice", "plaintextBody": "Attached."}]}
    emit({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": f"u{i}", "content": [{"type": "text", "text": json.dumps(res)}]}]}})
emit({"type": "result", "subtype": "success", "result": "DONE", "total_cost_usd": 0.001, "duration_ms": 10, "usage": {"input_tokens": 10, "output_tokens": 1}})
`;

const FAKE_CODEX = `#!/usr/bin/env python3
import json, os, sys
if os.environ.get("FAKE_CODEX_NO_GMAIL"):
    print(json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "No Gmail tool."}})); sys.exit()
print(json.dumps({"type": "item.completed", "item": {"type": "mcp_tool_call", "tool": "gmail.get_profile", "arguments": {}, "status": "completed",
    "result": {"structured_content": {"email": json.load(open(os.environ["FAKE_BOX"])).get("codex_owner", "alex@example.com"), "name": "Alex Rivera"}}}}))
print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 10, "output_tokens": 1}}))
`;

function rig({ profiles = {}, tz = 'America/New_York', box = {}, claude = true, codex = false, codexModel } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-runner-'));
  const bin = path.join(dir, 'claude'), boxFile = path.join(dir, 'box.json');
  fs.writeFileSync(bin, FAKE, { mode: 0o755 });
  fs.writeFileSync(boxFile, JSON.stringify(box));
  const data = path.join(dir, 'data'); fs.mkdirSync(data);
  const settings = { inbox: true, ownerTimezone: tz }, logs = [], pushes = [];
  const codexBin = path.join(dir, 'codex');
  fs.writeFileSync(codexBin, FAKE_CODEX, { mode: 0o755 });
  fs.mkdirSync(path.join(dir, '.codex')); fs.writeFileSync(path.join(dir, '.codex', 'auth.json'), '{}');
  const runner = new InboxRunner({ dataDir: data, appDir: repo, claudeBin: claude ? bin : path.join(dir, 'no-claude'), codexBin: codex ? codexBin : null,
    codexHome: path.join(dir, '.codex'), sessionDir: dir, home: dir, settings: () => settings, store: { profiles }, log: m => logs.push(m),
    notify: (t, b) => pushes.push([t, b]), env: () => ({ ...process.env, FAKE_BOX: boxFile, POCKET_DATA_DIR: data, HOME: dir }), ...(codexModel ? { codexModel } : {}) });
  return { dir, data, runner, settings, logs, pushes, boxFile };
}

test('a hand-installed watcher is left alone', async () => {
  const r = rig({ profiles: { 'inbox-monitor': { at: new Date().toISOString(), profile: { version: 1 } } } });
  assert.deepEqual(r.runner.status(), { managed: false, state: 'external' });
  await r.runner.step();
  assert.equal(fs.existsSync(path.join(r.data, 'inbox-watch-data', 'config.toml')), false);
});

test('1.81: a job that posted to the Inbox is not a watcher; Pocket still sets up', async () => {
  const r = rig(); // pocket-inbox add (or a bare seen) records a source but sends no profile
  r.runner.store.sources = { nightly: { lastReportAt: new Date().toISOString() } };
  assert.equal(r.runner.status().managed, true);
  await r.runner.step();
  assert.equal(r.runner.status().state, 'setting-up');
  assert.equal(fs.existsSync(path.join(r.data, 'inbox-watch-data', 'config.toml')), true);
});

test('1.81: deleting config.toml to start over does not make Pocket\'s own earlier reports look external', async () => {
  const r = rig();
  await r.runner.step(); // set up
  await r.runner.step(); // baseline: a run, so ranAt is recorded
  r.runner.store.profiles = { 'inbox-monitor': { at: new Date(r.runner.now() - 1000).toISOString(), profile: { version: 1 } } }; // what Pocket's watcher reported
  fs.unlinkSync(path.join(r.data, 'inbox-watch-data', 'config.toml'));
  assert.notEqual(r.runner.status().state, 'external');
  r.runner.store.profiles = { 'inbox-monitor': { at: new Date(r.runner.now() + 60_000).toISOString(), profile: { version: 1 } } }; // a watcher that reports after the runner's last run is another one
  assert.equal(r.runner.status().state, 'external');
  r.runner.store.profiles = { 'inbox-monitor': { at: new Date(r.runner.now() - 8 * 86400_000).toISOString(), profile: { version: 1 } } };
  r.runner.state.ranAt = null; // a watcher that went quiet a week ago no longer holds Pocket back
  assert.notEqual(r.runner.status().state, 'external');
});

test('off when Inbox Watch is off', async () => {
  const r = rig(); r.settings.inbox = false;
  assert.deepEqual(r.runner.status(), { managed: false, state: 'off' });
  await r.runner.step();
  assert.equal(fs.existsSync(path.join(r.data, 'inbox-watch-data')), false);
});

test('waits for the owner\'s time zone', async () => {
  const r = rig({ tz: '' });
  await r.runner.step();
  assert.equal(r.runner.status().state, 'waiting');
  assert.equal(fs.existsSync(path.join(r.data, 'inbox-watch-data', 'config.toml')), false);
});

test('sets up from the connector, starts from now, then ticks', async () => {
  const r = rig();
  await r.runner.step();
  const cfg = fs.readFileSync(path.join(r.data, 'inbox-watch-data', 'config.toml'), 'utf8');
  assert.match(cfg, /email = "alex@example.com"/);
  assert.match(cfg, /name = "Alex Rivera"/);
  assert.match(cfg, /timezone = "America\/New_York"/);
  assert.match(cfg, /provider = "connector"/);
  assert.match(cfg, /\[gmail_label\][^\n]*\nenabled = true/, '1.75.1: the label is on from the start');
  assert.match(cfg, /\[judge\]\nkind = "claude"/);
  assert.match(cfg, /docs_dir = ".*inbox-watch-data\/files"/); // Files keeps only files in the home directory

  assert.equal(r.runner.status().state, 'setting-up');
  assert.equal(r.runner.status().mailbox, 'alex@example.com');
  await r.runner.step(); // --baseline-only
  assert.equal(r.runner.status().state, 'running', JSON.stringify(r.runner.state));
  assert.equal(r.runner.state.baselined, true);
  assert.equal(r.runner.state.backfill, 'due');
  r.settings.ownerTimezone = 'America/Chicago'; // signed in from elsewhere
  r.runner.retime(r.settings.ownerTimezone);
  assert.match(fs.readFileSync(path.join(r.data, 'inbox-watch-data', 'config.toml'), 'utf8'), /timezone = "America\/Chicago"/);
  assert.equal(r.runner.state.timezone, 'America/Chicago');
  const file = path.join(r.data, 'inbox-watch-data', 'config.toml'); // a config from before docs_dir gains it
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^docs_dir = .*\n/m, ''));
  r.runner.checked = false; r.runner.upgradeConfig();
  assert.match(fs.readFileSync(file, 'utf8'), /root = .*\ndocs_dir = ".*inbox-watch-data\/files"\nemail = false/);
});

test('no Gmail connector says what to connect', async () => {
  const r = rig({ box: { no_connector: true } });
  await r.runner.step();
  const s = r.runner.status();
  assert.equal(s.state, 'needs-connector');
  assert.match(s.message, /Connectors/);
});

test('a Codex-only server reads Gmail and judges with Codex', async () => {
  const r = rig({ claude: false, codex: true });
  await r.runner.step();
  const cfg = fs.readFileSync(path.join(r.data, 'inbox-watch-data', 'config.toml'), 'utf8');
  assert.match(cfg, /email = "alex@example.com"/);
  assert.match(cfg, /agent = "codex"\nbin = .*\nmodel = "gpt-6-luna"/);
  assert.match(cfg, /\[judge\]\nkind = "codex"/);
  assert.match(cfg, /\[pocket\][^[]*provider = "codex"/);
  assert.doesNotMatch(cfg, /fallback_agent/);
  assert.equal(r.runner.status().agent, 'codex');
});

test('1.91.1: a Codex setup writes the newest version of each model the installed Codex lists', async () => {
  const r = rig({ claude: false, codex: true, codexModel: id => ({ 'gpt-6-sol': 'gpt-6.1-sol', 'gpt-6-luna': 'gpt-6.2-luna' })[id] || id });
  await r.runner.step();
  const cfg = fs.readFileSync(path.join(r.data, 'inbox-watch-data', 'config.toml'), 'utf8');
  assert.match(cfg, /agent = "codex"\nbin = .*\nmodel = "gpt-6.2-luna"/);
  assert.match(cfg, /\[judge\]\nkind = "codex"\nbin = .*\nmodel = "gpt-6.1-sol"/);
});

test('with both, Claude reads and Codex is the fallback', async () => {
  const r = rig({ claude: true, codex: true });
  await r.runner.step();
  const cfg = fs.readFileSync(path.join(r.data, 'inbox-watch-data', 'config.toml'), 'utf8');
  assert.match(cfg, /agent = "claude"/);
  assert.match(cfg, /fallback_agent = "codex"/);
  assert.match(cfg, /\[mail\.fallback\]\nbin = .*codex"\nmodel = "gpt-6-luna"/);
  assert.match(cfg, /\[judge\]\nkind = "claude"/);
  assert.deepEqual([r.runner.status().agent, r.runner.status().fallback], ['claude', 'codex']);
});

test('neither connected: says to connect Gmail', async () => {
  const r = rig({ claude: true, codex: true, box: { no_connector: true } });
  process.env.FAKE_CODEX_NO_GMAIL = '1';
  try { await r.runner.step(); } finally { delete process.env.FAKE_CODEX_NO_GMAIL; }
  assert.equal(r.runner.status().state, 'needs-connector');
  assert.match(r.runner.status().message, /Claude Code or Codex/);
});

// 1.81: a reconnected Gmail account is noticed at the next start of Pocket
const restart = (r, box) => { fs.writeFileSync(r.boxFile, JSON.stringify(box)); r.runner.accountChecked = false; r.runner.accountRetryAt = 0; r.runner.checked = false; };
const cfgOf = r => fs.readFileSync(path.join(r.data, 'inbox-watch-data', 'config.toml'), 'utf8');

test('1.81: the same account at the next start changes nothing', async () => {
  const r = rig();
  await r.runner.step(); await r.runner.step();
  const before = cfgOf(r);
  restart(r, {});
  await r.runner.step();
  assert.equal(r.runner.accountChecked, true);
  assert.equal(cfgOf(r), before);
  assert.equal(r.runner.status().accountChange, null);
});

test('1.81: Gmail reconnected to another account updates the owner and says so', async () => {
  const r = rig();
  await r.runner.step(); await r.runner.step();
  restart(r, { owner: 'Sam Lee <Sam@Example.com>' });
  await r.runner.step();
  const cfg = cfgOf(r);
  assert.match(cfg, /^\[owner\]\nname = "Sam Lee"\nemail = "sam@example.com"\ntimezone = /m);
  assert.match(cfg, /^# Inbox Watch for sam@example.com, written by Pocket Code/);
  const s = r.runner.status();
  assert.equal(s.mailbox, 'sam@example.com');
  assert.deepEqual([s.accountChange.from, s.accountChange.to], ['alex@example.com', 'sam@example.com']);
  assert.ok(r.logs.some(l => /Gmail now sam@example.com \(was alex@example.com\)/.test(l)));
  r.runner.now = () => Date.now() + 4 * 86400_000; // the notice fades after a few days
  assert.equal(r.runner.status().accountChange, null);
});

test('1.81: a fallback agent still on the old account is dropped; one on the new account stays', async () => {
  const r = rig({ codex: true });
  await r.runner.step(); await r.runner.step();
  assert.match(cfgOf(r), /fallback_agent = "codex"/);
  restart(r, { owner: 'Sam Lee <sam@example.com>', codex_owner: 'alex@example.com' });
  await r.runner.step();
  const cfg = cfgOf(r);
  assert.doesNotMatch(cfg, /fallback_agent|\[mail\.fallback\]/);
  assert.match(cfg, /\[mail\]\nprovider = .*\nagent = "claude"\nbin = .*\nmodel = "haiku"\nscope = "all".*\n\n\[judge\]/); // 1.95: the scope line closes [mail]; no fallback_agent, no [mail.fallback]
  assert.equal(r.runner.status().fallback, null);
  const k = rig({ codex: true });
  await k.runner.step(); await k.runner.step();
  restart(k, { owner: 'Sam Lee <sam@example.com>', codex_owner: 'sam@example.com' });
  await k.runner.step();
  assert.match(cfgOf(k), /email = "sam@example.com"[\s\S]*fallback_agent = "codex"/);
});

test('1.81: a connector that does not answer at the start is asked again later, and a hand-written config is left alone', async () => {
  const r = rig();
  await r.runner.step(); await r.runner.step();
  restart(r, { no_connector: true });
  await r.runner.step();
  assert.equal(r.runner.accountChecked, false);
  assert.ok(r.runner.accountRetryAt > Date.now());
  const file = path.join(r.data, 'inbox-watch-data', 'config.toml'), before = cfgOf(r).replace(/^# Inbox Watch for .*\n/m, '# my own\n');
  fs.writeFileSync(file, before);
  restart(r, { owner: 'Sam Lee <sam@example.com>' });
  await r.runner.step();
  assert.equal(cfgOf(r), before);
});

test('1.81: sending from an alias is not a changed account', async () => {
  const r = rig();
  await r.runner.step(); await r.runner.step();
  const before = cfgOf(r);
  restart(r, { owner: 'Alex Rivera <alias@example.org>', also_sent_as: ['Alex Rivera <Alex@example.com>'] }); // the newest sent mail is from the alias
  await r.runner.step();
  assert.equal(r.runner.accountChecked, true);
  assert.equal(cfgOf(r), before, 'the configured address is among the senders: nothing rewritten');
  assert.equal(r.runner.status().accountChange, null);
  restart(r, { owner: 'Sam Lee <sam@example.com>', also_sent_as: ['Sam <sam.lee@example.org>'] }); // none of them is the configured one
  await r.runner.step();
  assert.equal(r.runner.status().accountChange.to, 'sam@example.com');
});

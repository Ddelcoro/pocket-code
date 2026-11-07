// 1.74: Pocket runs Inbox Watch's watcher itself. Turning Inbox Watch on is the whole setup: when no other watcher reports
// to this Pocket, the runner writes a config for the owner's mailbox under <data dir>/inbox-watch-data/, reads mail through
// the Gmail connector the owner already linked to Claude Code (inbox-watch's mail_connector.py: no Google client, token
// or service account), starts from now, and then runs the watcher's `tick` every minute, which checks mail only when
// the schedule set in Settings → Inbox Watch says a check is due. A watcher installed by hand (its own config and
// timer, sending its profile under its own source) is left alone: the runner never manages a mailbox someone else set up.
//
// States (status() → the Inbox shows them): off · external (a hand-installed watcher reports here) · waiting (needs the
// owner's time zone: open Pocket once) · setting-up · needs-connector (Claude Code has no Gmail connector) · error ·
// running. Three failed runs in a row send one push; the next good run clears it.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const MINUTE = 60_000;
const RUN_LIMIT_MS = 30 * MINUTE;
const WATCHER_FRESH_MS = 7 * 24 * 60 * MINUTE; // 1.81: a hand-installed watcher quiet for a week is gone; Pocket may set up its own
const ACCOUNT_NOTICE_MS = 3 * 24 * 60 * MINUTE; // 1.81: how long the Inbox says the Gmail account changed
const BACKFILL_DAYS = 14; // the connector reads a thread per call slot; two weeks gives the judge context without a long first night
const toml = v => JSON.stringify(String(v)); // TOML basic strings take JSON's escapes

export class InboxRunner {
  // 1.91.1: codexModel maps a Codex model to the newest version of its family the installed Codex lists (codex.codexSuccessor),
  // so a new setup writes GPT-6.1 Sol rather than GPT-6 Sol, and an older Codex that does not list 6.1 keeps GPT-6 Sol.
  constructor({ dataDir, appDir, claudeBin, codexBin = null, codexHome = null, sessionDir, env, settings, store, log, notify, python = 'python3', home = process.env.HOME || '', now = () => Date.now(), codexModel = id => id }) {
    Object.assign(this, { appDir, claudeBin, codexBin, codexHome, sessionDir, env, settings, store, log, notify, python, home, now, codexModel });
    this.dir = path.join(dataDir, 'inbox-watch-data'); // not 'inbox-watch': the default data dir is the checkout, which has the watcher's code there
    this.config = path.join(this.dir, 'config.toml');
    this.statusFile = path.join(this.dir, 'status.json');
    this.watchDir = path.join(appDir, 'inbox-watch');
    // Digests and look-aheads are kept in Files, which takes only files in the home directory outside hidden folders.
    const inside = path.join(this.dir, 'files');
    this.docsDir = home && inside.startsWith(home + path.sep) && !path.relative(home, inside).split(path.sep).some(p => p.startsWith('.')) ? inside : path.join(home, 'inbox-watch-files');
    this.busy = null; // { proc, startedAt, what }
    this.state = this.readStatus();
  }

  readStatus() { try { return JSON.parse(fs.readFileSync(this.statusFile, 'utf8')); } catch { return { state: 'off', failures: 0 }; } }
  setStatus(patch) {
    this.state = { ...this.state, ...patch, at: new Date(this.now()).toISOString() };
    try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(this.statusFile, JSON.stringify(this.state, null, 1)); } catch (e) { this.log(`inbox runner: status not saved: ${e.message}`); }
  }

  // Another watcher (installed by hand, with its own timer) is reporting to this Pocket and the runner has no config of its own.
  // 1.81: a watcher is what sends its profile with `seen` (every inbox-monitor does), not any source that ever posted: a job or
  // agent using `pocket-inbox add` or a bare `seen` is not one. Pocket's own earlier runs report the same way, so only a profile
  // newer than the runner's last run counts (delete config.toml to start over and the runner sets up again, not stands down),
  // and one that went quiet for a week no longer does.
  external() {
    if (fs.existsSync(this.config)) return false;
    const after = Math.max(Date.parse(this.state.ranAt || '') || 0, this.now() - WATCHER_FRESH_MS);
    return Object.values(this.store.profiles || {}).some(p => Date.parse(p?.at) > after);
  }

  status() {
    const s = this.settings();
    if (!s.inbox) return { managed: false, state: 'off' };
    if (this.external()) return { managed: false, state: 'external' };
    const { state = 'waiting', message = null, mailbox = null, agent = null, fallback = null, at = null, lastOkAt = null, failures = 0, accountChange = null } = this.state;
    const changed = accountChange && this.now() - Date.parse(accountChange.at) < ACCOUNT_NOTICE_MS ? accountChange : null; // 1.81: said in the Inbox for a few days
    return { managed: true, state, message, mailbox, agent, fallback, at, lastOkAt, failures, accountChange: changed, running: this.busy?.what || null };
  }

  start() { this.timer = setInterval(() => this.step().catch(e => this.log(`inbox runner: ${e.message}`)), MINUTE); this.timer.unref?.(); setTimeout(() => this.step().catch(() => {}), 5000).unref?.(); }
  stop() { clearInterval(this.timer); this.busy?.proc.kill('SIGTERM'); }
  // 1.75: Check now. Run the tick at once rather than at the next minute; a run already under way takes the request up after it.
  kick() { if (!this.busy && this.timer) this.step().catch(e => this.log(`inbox runner: ${e.message}`)); }

  async step() {
    const s = this.settings();
    if (!s.inbox || this.external()) return;
    if (this.busy) {
      if (this.now() - this.busy.startedAt > RUN_LIMIT_MS) { this.log(`inbox runner: ${this.busy.what} ran over 30 min; stopped`); this.busy.proc.kill('SIGKILL'); }
      return;
    }
    if (!fs.existsSync(this.config)) return this.setup();
    if (!this.checked) this.upgradeConfig();
    if (!this.accountChecked && this.now() >= (this.accountRetryAt || 0)) await this.checkAccount();
    if (s.ownerTimezone && this.state.timezone && s.ownerTimezone !== this.state.timezone) this.retime(s.ownerTimezone);
    if (!this.state.baselined) return this.baseline();
    if (this.state.backfill === 'due') return this.backfill();
    const r = await this.run('tick', ['tick']);
    if (r.code === 0) {
      if (this.state.state !== 'running' || this.state.failures) this.setStatus({ state: 'running', message: null, failures: 0, alerted: false });
      this.setStatus({ lastOkAt: new Date(this.now()).toISOString() });
      return;
    }
    const failures = (this.state.failures || 0) + 1, message = errLine(r) || `the watcher exited ${r.code}`;
    const connector = /Gmail connector|Connectors/.test(r.err);
    this.setStatus({ state: connector ? 'needs-connector' : 'error', message, failures });
    if (failures >= 3 && !this.state.alerted) {
      this.setStatus({ alerted: true });
      this.notify?.('Inbox Watch can’t check your mail', connector ? 'Connect Gmail in Settings → Connectors, then it starts again by itself.' : message);
    }
  }

  // python3 with the watcher on its path, isolated (-I) so nothing in the working directory can shadow a module.
  run(what, args, { module = 'inbox_monitor.engine', config = true } = {}) {
    const code = `import sys; sys.path.insert(0, ${JSON.stringify(this.watchDir)}); from ${module} import main; sys.exit(main(sys.argv[1:]))`;
    const argv = ['-I', '-c', code, ...(config ? ['--config', this.config] : []), ...args];
    const env = { ...this.env(), PATH: [path.dirname(process.execPath), this.env().PATH || ''].join(path.delimiter) };
    return new Promise(resolve => {
      let out = '', err = '';
      const proc = spawn(this.python, argv, { cwd: this.dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
      this.busy = { proc, startedAt: this.now(), what };
      proc.stdout.on('data', d => { out = (out + d).slice(-20000); });
      proc.stderr.on('data', d => { err = (err + d).slice(-20000); });
      const done = code => { if (this.busy?.proc === proc) this.busy = null; this.setStatus({ ranAt: new Date(this.now()).toISOString() }); resolve({ code, out, err }); }; // 1.81: ranAt tells Pocket's own reports from another watcher's
      proc.on('error', e => { err += e.message; done(127); });
      proc.on('close', code => done(code ?? 1));
    });
  }

  // Which agent can read the mailbox: Claude Code's Gmail connector first (Haiku fetches, no bot checks), then Codex's Gmail
  // app. Both on the same mailbox: the other is the fallback. The judge is Claude when Claude Code runs here, else Codex.
  async setup() {
    const s = this.settings(), tz = s.ownerTimezone;
    if (!tz) { if (this.state.state !== 'waiting') this.setStatus({ state: 'waiting', message: 'Open Pocket Code once on your phone or computer so Inbox Watch knows your time zone.' }); return; }
    const stateDir = path.join(this.dir, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    this.setStatus({ state: 'setting-up', message: 'Finding your mailbox through the Gmail connector…' });
    const found = [], failed = {};
    for (const [agent, bin] of [['claude', this.claudeBin], ['codex', this.codexBin]]) {
      if (!bin) continue;
      const r = await this.run('setup', ['whoami', '--agent', agent, '--state', stateDir, '--bin', bin], { module: 'inbox_monitor.mail_connector', config: false });
      let who = {};
      try { who = JSON.parse(lastLine(r.out) || '{}'); } catch { }
      if (who.ok) found.push({ agent, bin, who }); else failed[agent] = { status: who.status, error: who.error || errLine(r) };
    }
    if (!found.length) {
      const none = Object.values(failed).every(f => f.status === 401 || f.status === 500);
      const msg = none ? 'Gmail isn’t connected to Claude Code or Codex on this server. Connect it in Settings → Connectors.' : (failed.claude?.error || failed.codex?.error || 'The Gmail connector did not answer.');
      return this.setStatus({ state: none ? 'needs-connector' : 'error', message: msg });
    }
    const [main] = found, who = main.who;
    const backup = found.find(f => f.agent !== main.agent && f.who.email === who.email);
    const claudeRuns = found.some(f => f.agent === 'claude') || failed.claude?.status === 401; // signed in, just no Gmail connector
    const mailKeys = f => f.agent === 'codex'
      ? [`bin = ${toml(f.bin)}`, `model = ${toml(this.codexModel('gpt-6-luna'))}`, 'reasoning = "low"', ...(this.codexHome ? [`codex_home = ${toml(this.codexHome)}`] : [])]
      : [`bin = ${toml(f.bin)}`, 'model = "haiku"'];
    const judge = claudeRuns
      ? ['[judge]', 'kind = "claude"', `bin = ${toml(this.claudeBin)}`, 'model = "sonnet"', 'reasoning = "medium"', 'timeout = 300']
      : ['[judge]', 'kind = "codex"', `bin = ${toml(this.codexBin)}`, `model = ${toml(this.codexModel('gpt-6-sol'))}`, 'reasoning = "medium"', 'timeout = 300   # isolated: its own CODEX_HOME, no apps'];
    const key = [path.join(this.home, '.config', 'openrouter', 'keys', 'inbox-monitor.key')].find(f => fs.existsSync(f));
    const name = who.name || who.email.split('@')[0];
    const lines = [
      `# Inbox Watch for ${who.email}, written by Pocket Code on ${new Date(this.now()).toISOString().slice(0, 10)}.`,
      '# Pocket runs this watcher every minute while Inbox Watch is on. Schedule, models, rules and tidy are set in Pocket',
      '# (Settings → Inbox Watch) and win over this file; edit it only for what Pocket has no setting for.',
      '[owner]', `name = ${toml(name)}`, `email = ${toml(who.email)}`, `timezone = ${toml(tz)}`, '',
      '[assistant]', 'name = "Pocket Assistant"', '',
      '[schedule]', 'every = 5', 'quiet_hours = [22, 8]', 'digest_hour = 8', 'lookahead = { morning = [8, 12], evening = [17, 22] }', '',
      '[mail]', `provider = "connector"            # Gmail through ${main.agent === 'codex' ? 'Codex’s Gmail app' : 'Claude Code’s Gmail connector'} (Settings → Connectors)`,
      `agent = ${toml(main.agent)}`, ...mailKeys(main), ...(backup ? [`fallback_agent = ${toml(backup.agent)}   # when a read fails (a bot check, a timeout)`] : []),
      'scope = "all"                       # 1.95: what it reads: "all" (every thread but spam, trash, drafts), "inbox", or "inbox_labels" with scope_labels = [...]; also a Pocket setting', '',
      ...(backup ? ['[mail.fallback]', ...mailKeys(backup), ''] : []),
      ...judge, '',
      '[firstpass]                          # skips routine mail before the judge; needs an OpenRouter key',
      'enabled = true', 'provider = "jev"', 'threshold = 0.8', 'timeout = 20',
      `key_file = ${toml(key || '~/.config/openrouter/keys/inbox-monitor.key')}`, 'key_env = "OPENROUTER_API_KEY"', '',
      '[tidy]', 'enabled = true', 'every_hours = 2', '',
      '[pocket]', `root = ${toml(this.appDir)}`, `session_dir = ${toml(this.sessionDir)}`, `provider = ${toml(claudeRuns ? 'claude' : 'codex')}`, '',
      '[[delivery]]', 'kind = "pocket"', `root = ${toml(this.appDir)}`, `docs_dir = ${toml(this.docsDir)}`, 'email = false', '',
      '[gmail_label]                          # 1.75: the Pocket Inbox label in Gmail, kept in step with the Inbox both ways', 'enabled = true', '',
    ];
    const prefs = path.join(this.dir, 'preferences.md');
    if (!fs.existsSync(prefs)) fs.writeFileSync(prefs, '');
    fs.writeFileSync(this.config + '.tmp', lines.join('\n'));
    fs.renameSync(this.config + '.tmp', this.config);
    this.log(`inbox runner: set up for ${who.email} (${tz}); mail via ${main.agent}${backup ? ', fallback ' + backup.agent : ''}; judge ${claudeRuns ? 'claude' : 'codex'}`);
    this.accountChecked = true; // it was just read
    this.setStatus({ state: 'setting-up', mailbox: who.email, timezone: tz, agent: main.agent, fallback: backup?.agent || null, message: 'Starting from now…', baselined: false });
  }

  // Keys a config written by an earlier runner lacks (1.74.0 before docs_dir: look-aheads were written to /tmp, which Files refuses).
  upgradeConfig() {
    this.checked = true;
    const text = fs.readFileSync(this.config, 'utf8');
    if (!/^# Inbox Watch for .*written by Pocket Code/m.test(text) || /^docs_dir = /m.test(text)) return;
    const next = text.replace(/^(\[\[delivery\]\]\nkind = "pocket"\nroot = .*)$/m, `$1\ndocs_dir = ${toml(this.docsDir)}`);
    if (next !== text) { fs.writeFileSync(this.config + '.tmp', next); fs.renameSync(this.config + '.tmp', this.config); this.log('inbox runner: config gains docs_dir'); }
  }

  // 1.81: the Gmail connector may have been reconnected to another account since the config was written, and the watcher tells the
  // owner's own mail from other mail by the address in it. At each start of Pocket, ask the connector the config reads through whose
  // mailbox it is; if the configured owner is not among the addresses it reports, write the new address (and name) and say so in the Inbox. A fallback agent on
  // the old account is dropped, or it would read the old mailbox when the first one fails. The mail archive and stories stay as they are.
  async checkAccount() {
    const text = fs.readFileSync(this.config, 'utf8');
    const block = name => new RegExp(`^\\[${name}\\]\\n([^\\[]*)`, 'm').exec(text)?.[1] || '';
    const key = (b, k) => { const m = new RegExp(`^${k} = ("(?:[^"\\\\]|\\\\.)*")`, 'm').exec(b); try { return m ? JSON.parse(m[1]) : ''; } catch { return ''; } };
    const owner = block('owner'), mail = block('mail'), configured = key(owner, 'email'), agent = key(mail, 'agent');
    const bin = agent === 'codex' ? this.codexBin : agent === 'claude' ? this.claudeBin : null;
    if (!/^# Inbox Watch for .*written by Pocket Code/m.test(text) || !/^provider = "connector"/m.test(mail) || !configured || !bin) { this.accountChecked = true; return; } // not Pocket's to edit
    const stateDir = path.join(this.dir, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    const whoami = async (a, b) => {
      const r = await this.run('account', ['whoami', '--agent', a, '--state', stateDir, '--bin', b], { module: 'inbox_monitor.mail_connector', config: false });
      try { return JSON.parse(lastLine(r.out) || '{}'); } catch { return {}; }
    };
    const who = await whoami(agent, bin);
    if (!who.ok || !who.email) { this.accountRetryAt = this.now() + 30 * MINUTE; return; } // the connector did not answer: try again later
    this.accountChecked = true;
    // The newest sent message may come from an alias ("send as"): the account is unchanged while the configured address is among those who sent the last few.
    if ([who.email, ...(Array.isArray(who.senders) ? who.senders : [])].some(a => String(a).toLowerCase() === configured.toLowerCase())) return;
    let next = text.replace(/^(\[owner\]\nname = ).*\n(email = ).*$/m, (_, a, b) => `${a}${toml(who.name || who.email.split('@')[0])}\n${b}${toml(who.email)}`)
      .replace(/^(# Inbox Watch for ).*(, written by Pocket Code)/m, `$1${who.email}$2`);
    const fallbackAgent = key(mail, 'fallback_agent'), fbBin = fallbackAgent === 'codex' ? this.codexBin : fallbackAgent === 'claude' ? this.claudeBin : null;
    if (fallbackAgent && !(fbBin && (await whoami(fallbackAgent, fbBin)).email?.toLowerCase() === who.email.toLowerCase())) {
      next = next.replace(/^fallback_agent = .*\n/m, '').replace(/^\[mail\.fallback\]\n[^\[]*/m, '');
      this.setStatus({ fallback: null });
    }
    fs.writeFileSync(this.config + '.tmp', next); fs.renameSync(this.config + '.tmp', this.config);
    this.log(`inbox runner: Gmail now ${who.email} (was ${configured}); config updated`);
    this.setStatus({ mailbox: who.email, accountChange: { from: configured, to: who.email, at: new Date(this.now()).toISOString() } });
  }

  // The owner signed in from another time zone (or the first one was a guess): the digest and quiet hours follow them.
  retime(tz) {
    const text = fs.readFileSync(this.config, 'utf8'), next = text.replace(/^timezone = ".*"$/m, `timezone = ${toml(tz)}`);
    if (next !== text) { fs.writeFileSync(this.config + '.tmp', next); fs.renameSync(this.config + '.tmp', this.config); this.log(`inbox runner: time zone now ${tz}`); }
    this.setStatus({ timezone: tz });
  }

  // Start from now: what is already in the mailbox is not news. Then two weeks of mail as the judge's memory, in the background of the next steps.
  async baseline() {
    const r = await this.run('baseline', ['--baseline-only']);
    if (r.code !== 0) return this.setStatus({ state: /Connectors/.test(r.err) ? 'needs-connector' : 'error', message: errLine(r) || 'The first check failed.' });
    this.setStatus({ baselined: true, backfill: 'due', state: 'running', message: null, lastOkAt: new Date(this.now()).toISOString() });
  }

  async backfill() {
    this.setStatus({ backfill: 'running' });
    const r = await this.run('backfill', ['backfill', '--days', String(BACKFILL_DAYS)]);
    this.setStatus({ backfill: r.code === 0 ? 'done' : 'failed' });
    if (r.code !== 0) this.log(`inbox runner: backfill failed: ${errLine(r)}`);
  }
}

// The traceback's last line without the exception's module path, or the last thing the watcher printed.
function errLine(r) { return (lastLine(r.err) || lastLine(r.out)).replace(/^[\w.]+(Error|Exception): /, ''); }
function lastLine(text) { return String(text || '').trim().split('\n').filter(Boolean).pop()?.slice(0, 300) || ''; }

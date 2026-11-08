// Pocket Code — mobile web UI for the Claude Code and Codex sessions on this box.
// The daemon owns every turn: a message POSTed here is written to the session's own
// long-lived `claude -p` process (spawned on first use, kept between turns), so the
// phone can disconnect/sleep and the turn still completes.
// Transcripts stay in ~/.claude/projects — the same store code-server reads.

import express from 'express';
import webpush from 'web-push';
import { spawn, execSync, execFileSync } from 'node:child_process';
import { createHmac, createHash, timingSafeEqual, randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import * as codex from './codex.mjs';
import * as acp from './acp.mjs';
import {validateModelForEngine, engineForSessionId, ENGINES, ENGINE_IDS} from './engines.mjs';
import { readPolicy, cleanPolicy, claudeLaunch, codexLaunch, isDefaultPolicy, LIMIT_CHOICES } from './context-policy.mjs'; // 1.92
import {migrateSmeta, readEngineConfig, overlayIds, VERSION_KEY} from './session-schema.mjs';
import {fetchOpenRouterModels, tierModels} from './openrouter.mjs';
import { DeliveryReceipts, withDeliveryReceipt } from './delivery.mjs';
import { sessionState, prioritizeSessions, wrapUpRequest, replyAsksNothing } from './session-state.mjs';
import { collectResults } from './results.mjs';
import { pipeDirs, ensurePipeDir } from './pipes.mjs';
import { FollowupQueue } from './queue.mjs';
import {workspaceStatus,workspaceDiff,gitAvailable} from './workspace.mjs';
import { FolderReader } from './folders.mjs';
import { Worktrees } from './worktrees.mjs';
import { CoordStore, coordinationInstructions } from './coordination.mjs';
import { findRolloutFile } from './codex-rollout.mjs';
import {readClaudeIdentity,agentEnv} from './environment.mjs';
import {QuestionInbox} from './questions.mjs';
import {descendantCpu, commandLine, signalGroup, startTime, BOOT_ID} from './proctree.mjs';
import {ApprovalInbox,approvalAudit,approvalMode,claudePermissionSettings} from './approvals.mjs';
import {parseRuleList, validateRules, matchTrusted} from './trusted.mjs';
import {UsageStore,getSessionContext,atomicWrite} from './usage.mjs';
import {cacheFromTranscript,turnCacheSummary} from './cache.mjs';
import {CHOICE_INSTRUCTIONS,textBlocks} from './choices.mjs';
import {AgentActivity,ClaudeAgentFiles,SubagentIndex,subagentDir} from './subagents.mjs';
import {VoiceService} from './voice.mjs';
import {automation,createTitler,cleanTitle,generateTitle,generateCodexTitle,TITLE_VERSION,summarizeAway,awayDigest,awayWorthSummary,createRetitler,retitle,summarizeForTask} from './titles.mjs';
import zlib from 'node:zlib';
import {sessionIdFromRef,bestSnippet,cleanMemstemSnippet} from './search.mjs';
import {PromptStore} from './prompts.mjs';
import {ClaudeLogin} from './claude-login.mjs';
import {claudeConnectors, codexConnectors} from './connectors.mjs';
import {ProjectStore, projectInstructions} from './projects.mjs';
import {CLAUDE_MODELS, CATALOG_IDS, managedDir, readManagedPolicy, policyAllows, parseSelection, resolveOffer, helperModel, successorOf, replacedModels, addDiscovered} from './models.mjs';
import {readClaudeCredential, fetchAnthropicModels, newModelsFrom, loadDiscovered} from './claude-catalog.mjs';
import {ModelRouter, capEffort, tierChoice, TIERS} from './router.mjs';
import {AccessVerifier} from './access.mjs';
import {createMailer, looksLikeEmail, dueMessage} from './mail.mjs';
import {syncSkills, googleInstructions, manualInstructions} from './skills.mjs';
import {DocumentStore, documentInstructions, mimeOf, LIMITS as DOC_LIMITS} from './documents.mjs';
import {TaskStore, taskInstructions} from './tasks.mjs';
import {InboxStore, inboxInstructions} from './inbox.mjs';
import { InboxRunner } from './inbox-runner.mjs';
import { StartStore, handoffInstructions } from './starts.mjs';
import {Thumbnailer,openChecked} from './thumbnails.mjs';
import './public/secret-detect.js'; // 1.42: defines globalThis.PocketSecrets, the detector the composer also runs
import { SideChats } from './sidechat.mjs';
import {VaultStore, parseKey, newKey as newVaultKey, vaultInstructions, runWithSecrets, LIMITS as VAULT_LIMITS, ACCESS as VAULT_ACCESS} from './vault.mjs';
import { CliUpdates } from './cli-updates.mjs';
import { parseEnv } from './env-file.mjs';

// ---------- config ----------
const HOME = os.homedir();
const ENV_FILE = process.env.POCKET_ENV_FILE ?? path.join(import.meta.dirname, '.env');
// 1.73.6: a Vault key set in the process environment (PM2 ecosystem, systemd) wins over .env, and a rotation could only ever
// write .env; so such a key is rotated or created where it is set, and the routes say so instead of leaving a store no key opens.
const VAULT_KEY_PRESET = Boolean(process.env.POCKET_VAULT_KEY);
// 1.81: read by the same parser the commands use (env-file.mjs), so a quoted value or a digit in a name means the same to both.
for (const [k, v] of Object.entries(fs.existsSync(ENV_FILE) ? parseEnv(fs.readFileSync(ENV_FILE, 'utf8')) : {})) if (!process.env[k]) process.env[k] = v;
// 1.39: the vault key is read once and removed from the process environment, so no child of the daemon,
// whatever path spawns it, can inherit it (see vault.mjs).
let VAULT_KEY_RAW = process.env.POCKET_VAULT_KEY || '';
delete process.env.POCKET_VAULT_KEY;
// 1.44: the key a rotation is replacing, kept only for the moment between saving the new key and rewriting the store.
const VAULT_KEY_PREVIOUS = process.env.POCKET_VAULT_KEY_PREVIOUS || '';
delete process.env.POCKET_VAULT_KEY_PREVIOUS;
// 1.73.3: the SMTP address (its URL carries the mail password), the sender and the router key are read once and removed
// the same way: they are the daemon's alone, and every agent turn, hook, keeper and Vault child inherits what is left.
const SMTP_URL = process.env.POCKET_SMTP_URL || '';
const SMTP_FROM = process.env.POCKET_SMTP_FROM || '';
const ROUTER_KEY = process.env.POCKET_ROUTER_KEY || '';
for (const k of ['POCKET_SMTP_URL', 'POCKET_SMTP_FROM', 'POCKET_ROUTER_KEY']) delete process.env[k];
const PROJECTS_ROOT = process.env.POCKET_SESSION_ROOT || path.join(HOME, '.claude', 'projects');
const DATA_DIR = process.env.POCKET_DATA_DIR || import.meta.dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const deliveryReceipts = new DeliveryReceipts(path.join(DATA_DIR, 'delivery-receipts.json'));
const followups = new FollowupQueue(path.join(DATA_DIR, 'followup-queue.json'));
const usage = new UsageStore(path.join(DATA_DIR, 'usage-state.json'));
const ALLOW_FULL_ACCESS=process.env.POCKET_ALLOW_FULL_ACCESS!=='0';
// 1.81: a default the install cannot use (not review or full, or full with Full access turned off) logs one line and
// falls back to review; it used to throw here, and the daemon did not come up.
const DEFAULT_APPROVAL_MODE=(raw=>{
  try { return approvalMode(raw||undefined,'review',ALLOW_FULL_ACCESS); }
  catch { console.warn(raw==='full'?'POCKET_APPROVAL_MODE=full conflicts with POCKET_ALLOW_FULL_ACCESS=0 (Full access is turned off); using review':`POCKET_APPROVAL_MODE=${raw} is not review or full (POCKET_ALLOW_FULL_ACCESS=${process.env.POCKET_ALLOW_FULL_ACCESS??'unset'}); using review`); return 'review'; }
})((process.env.POCKET_APPROVAL_MODE||'').trim());
const auditApproval=approvalAudit(path.join(DATA_DIR,'approval-decisions.jsonl'));
const PORT = Number(process.env.PORT || 3610);
const PASSWORD = process.env.POCKET_PASSWORD;
const SECRET = process.env.POCKET_SECRET;
if (!PASSWORD || !SECRET) {
  console.error('POCKET_PASSWORD and POCKET_SECRET must be set in .env');
  process.exit(1);
}
let CLAUDE_BIN = process.env.CLAUDE_BIN
  || [path.join(HOME, '.npm-global', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude']
    .find(p => fs.existsSync(p)) || 'claude';
// Managed paths are restored before any provider/helper is created; explicit overrides remain externally managed.
const cliUpdates = new CliUpdates({dir:DATA_DIR,bins:{claude:CLAUDE_BIN,codex:process.env.POCKET_CODEX==='0'?null:codex.CODEX_BIN},
  zone:()=>ownerZone(),enabled:process.env.POCKET_CLI_UPDATES!=='0',overrides:{claude:!!process.env.CLAUDE_BIN,codex:!!process.env.CODEX_BIN},
  onActivate:(key,bin)=>{
    if(key==='claude'){CLAUDE_BIN=bin;sideChats.bin=bin;claudeLogin.bin=bin;claudeLogin.env.DISABLE_AUTOUPDATER='1';claudeLogin.env.DISABLE_UPDATES='1';inboxRunner.claudeBin=bin;}
    else {codex.setCodexBinary(bin);inboxRunner.codexBin=bin;}
  }});
CLAUDE_BIN=cliUpdates.binary('claude');
if(cliUpdates.binary('codex'))codex.setCodexBinary(cliUpdates.binary('codex'));
process.once('exit',()=>cliUpdates.dispose());
// A session's CLI process closes after this long with no turn and no background job.
// Timer settings are milliseconds; anything else logs and keeps the default. 0 disables.
function msSetting(name, dflt) {
  const raw = (process.env[name] ?? '').trim();
  if (!raw) return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) { console.warn(`${name}=${raw} is not a number of milliseconds; using ${dflt}`); return dflt; }
  return n;
}
const IDLE_CLOSE_MS = msSetting('POCKET_IDLE_CLOSE_MS', 60 * 60_000);
// Live CLI processes (Claude runners + Codex app-servers) kept at once. Spawning past the
// cap closes the longest-idle one that has no turn and no background job. 0 = no cap.
const MAX_PROCESSES = Math.floor(msSetting('POCKET_MAX_PROCESSES', 8));
// Changes on every daemon start: streams carry it so a client can tell a rebuilt turn
// (same session, same startedAt, different event numbering) from the one it was following.
const BOOT = Date.now().toString(36);
// A turn is stopped only after this long with no output, no background job, nothing
// waiting on the user and no CPU use by programs it started (replaces the 2h hard kill).
const STALL_MS = msSetting('POCKET_STALL_MS', 30 * 60_000);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Codex threads live behind a `cx:` prefix (see codex.mjs) — their ids are UUID-shaped
// too, so every id check below has to ask the prefix, not the regex.
const CODEX_ON = process.env.POCKET_CODEX !== '0' && codex.codexAvailable();
// The ACP/OpenRouter engine is OFF unless POCKET_ACP_ENABLE is set AND a runtime (OpenCode) is
// found (acp.acpConfig). Every acp code path below is gated on ACP_ON, so a default install —
// and the two shipped engines — are untouched. acpLaunch() is the child's launch spec.
const ACP_CFG = acp.acpConfig();
const ACP_ON = Boolean(ACP_CFG);
const isAcpId = acp.isAcpId;
const acpLaunch = () => ({ cmd: ACP_CFG.cmd, args: ACP_CFG.args, env: spawnEnv() });
// 1.86: an OpenCode process that runs replies gets Pocket's config merged over the user's (OpenCode appends its
// instruction files and keeps the user's MCP servers and providers, verified live): this process's instruction file
// (rewritten before each request), Pocket's ask tool (questions as question cards, acp-ask-mcp.mjs) under a key only
// this process holds, and ask-first permissions so Review actions shows each edit, command and fetch as a card (Full
// access answers them at once). The OpenRouter key comes from the environment.
const ACP_RUN_DIR = path.join(DATA_DIR, 'data', 'acp-run');
const ACP_ASK_MCP = path.join(import.meta.dirname, 'acp-ask-mcp.mjs');
function acpTurnLaunch() {
  fs.mkdirSync(ACP_RUN_DIR, { recursive: true, mode: 0o700 });
  const askKey = randomBytes(24).toString('hex'), instructionsFile = path.join(ACP_RUN_DIR, askKey.slice(0, 16) + '.md');
  fs.writeFileSync(instructionsFile, '', { mode: 0o600 });
  let user = {}; try { user = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || '{}') || {}; } catch { }
  const content = { ...user, instructions: [...(Array.isArray(user.instructions) ? user.instructions : []), instructionsFile],
    permission: { ...(user.permission || {}), edit: 'ask', bash: 'ask', webfetch: 'ask' },
    provider: { ...(user.provider || {}), openrouter: { ...(user.provider?.openrouter || {}), options: { apiKey: '{env:OPENROUTER_API_KEY}', ...(user.provider?.openrouter?.options || {}) } } },
    mcp: { ...(user.mcp || {}), pocket: { type: 'local', command: [process.execPath, ACP_ASK_MCP], environment: { POCKET_ASK_URL: `http://127.0.0.1:${PORT}/api/internal/acp-ask`, POCKET_ASK_KEY: askKey }, enabled: true } } };
  return { ...acpLaunch(), env: { ...spawnEnv(), POCKET_RUNNER_TOKEN: randomBytes(16).toString('hex'), OPENCODE_CONFIG_CONTENT: JSON.stringify(content) }, instructionsFile, askKey };
}
const isCx = codex.isCodexId;
// ACP (OpenCode) session ids are `ses_<token>` (uuid-ish or base62), not a bare UUID.
const ACP_ID_RE = /^ses_[0-9a-zA-Z-]{1,64}$/;
const anyId = id => acp.isAcpId(id) ? ACP_ID_RE.test(acp.bareAcpId(id)) : isCx(id) ? UUID_RE.test(codex.bareId(id)) : UUID_RE.test(id);
const UPLOAD_DIR = path.join(HOME, 'pocket-uploads');
// Claude model picker. The catalog (models.mjs CLAUDE_MODELS) is every model Pocket knows; the picker
// offers the ones the owner chose (Settings → Agents & instance, else POCKET_CLAUDE_MODELS, else all)
// that this computer's Claude Code managed policy allows. 'default' = no --model flag, i.e. the
// CLI's own default (managed or ~/.claude/settings.json `model`, else the account's).
// Effort maps to settings.effortLevel.
const MODELS = CATALOG_IDS;
// 1.91: Claude models found in Anthropic's model list since the last Pocket release (claude-catalog.mjs) join the
// catalog at startup, before anything below reads it, and again whenever the daily check finds one.
const CLAUDE_FOUND_FILE = path.join(DATA_DIR, 'claude-models.json');
let claudeFound = loadDiscovered(CLAUDE_FOUND_FILE);
addDiscovered(claudeFound.added);
const MANAGED_DIR = managedDir();
// The policy files are small; re-read at most every few seconds so an admin's change shows without a restart.
let policyCache = { at: 0, value: null };
function managedPolicy() {
  if (Date.now() - policyCache.at > 3000) policyCache = { at: Date.now(), value: readManagedPolicy(MANAGED_DIR) };
  return policyCache.value;
}
// The policy that limits models, or null when there is none (no file, or no model keys in it).
const modelPolicy = () => { const p = managedPolicy(); return p.availableModels || p.deniedModels?.length ? p : null; };
const ENV_CLAUDE_MODELS = (() => {
  const raw = (process.env.POCKET_CLAUDE_MODELS || '').trim();
  if (!raw) return null;
  const { ids, unknown } = parseSelection(raw);
  if (unknown.length) console.warn(`POCKET_CLAUDE_MODELS: ${unknown.join(', ')} ${unknown.length > 1 ? 'are' : 'is'} not in the model catalog; ignored`);
  if (!ids.length) { console.warn('POCKET_CLAUDE_MODELS names no known model; offering every model'); return null; }
  return ids;
})();
const claudeOffer = () => resolveOffer({ saved: settings.offeredClaudeModels, envList: ENV_CLAUDE_MODELS, policy: modelPolicy() });
const isOffered = id => claudeOffer().offered.includes(id);
// 1.62: the effort ceiling from the managed policy (maxEffortLevel), applied to every Claude turn Pocket starts.
const maxEffort = () => managedPolicy().maxEffortLevel || null;
// POCKET_CLAUDE_MODEL counts only while it is offered; otherwise Default is the CLI's own default.
// 1.91: it follows its family forward, so POCKET_CLAUDE_MODEL=claude-opus-5-5[1m] runs the newest Opus once there is one.
const claudePocketModel = () => { const want = POCKET_DEFAULTS.claude.model; if (!want) return undefined; const id = successorOf(want, modelPolicy()) || want; return isOffered(id) ? id : undefined; };
// Human label for whatever the CLI's own default is ('opus[1m]', 'claude-fable-5-1', …): a managed
// `model` outranks ~/.claude/settings.json. Read per request so a settings change shows without a restart.
function claudeDefaultLabel() {
  const pocket = claudePocketModel();
  if (pocket) return CLAUDE_MODELS.find(m => m.id === pocket).label;
  let raw = managedPolicy().model;
  if (!raw) try { raw = JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'settings.json'), 'utf8')).model; } catch { }
  if (!raw) return 'CLI default';
  const base = raw.replace(/\[1m\]$/i, ''), big = base !== raw ? ' · 1M' : '';
  const hit = CLAUDE_MODELS.find(m => m.id.replace(/\[1m\]$/, '') === base) || CLAUDE_MODELS.find(m => m.alias === base);
  return hit ? hit.label + big : raw;
}
// 1.92: the model a Claude conversation runs on, for the context policy's one-tier-down worker. A turn's own pick wins,
// then Pocket's default, then the CLI's (a managed `model`, then ~/.claude/settings.json). null when none is set.
function claudeLeader(model) {
  if (model) return model;
  const pocket = claudePocketModel(); if (pocket) return pocket;
  let raw = managedPolicy().model;
  if (!raw) try { raw = JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'settings.json'), 'utf8')).model; } catch { }
  return typeof raw === 'string' ? raw : null;
}
const claudePolicyLaunch = model => claudeLaunch(settings.contextPolicy, claudeLeader(model));
// What Settings shows: the policy with its defaults filled in, the limit choices, and which of this server's engines apply it.
const contextPolicyView = () => ({ ...readPolicy(settings.contextPolicy), limits: LIMIT_CHOICES,
  engines: ENGINE_IDS.filter(id => id === 'claude' || (id === 'codex' && CODEX_ON) || (id === 'acp' && ACP_ON)).map(id => ({ id, label: ENGINES[id].label, applies: Boolean(ENGINES[id].features.contextPolicy) })) });
const EFFORTS = new Set(['max', 'xhigh', 'high', 'medium', 'low']);
const CODEX_EFFORTS = new Set([...EFFORTS, 'ultra']); // 1.81: Ultra is Codex's, on models whose supportedReasoningEfforts list it; the picker offers it model by model (/api/codex/models `efforts`)
// Pocket-only defaults for turns that leave Model/Effort on Default. Unset = the CLI's
// own config (~/.claude/settings.json, ~/.codex/config.toml); terminal sessions never
// see these.
const envPick = (name, ok) => { const v = (process.env[name] || '').trim(); return v && ok(v) ? v : undefined; };
const POCKET_DEFAULTS = {
  claude: { model: envPick('POCKET_CLAUDE_MODEL', v => MODELS.has(v)), effort: envPick('POCKET_CLAUDE_EFFORT', v => EFFORTS.has(v)) },
  codex: { model: envPick('POCKET_CODEX_MODEL', v => /^[\w.-]{1,64}$/.test(v)), effort: envPick('POCKET_CODEX_EFFORT', v => CODEX_EFFORTS.has(v)) },
  // acp model ids are provider-prefixed OpenRouter slugs (openrouter/vendor/model); effort is unused.
  acp: { model: envPick('POCKET_ACP_MODEL', v => /^[\w./-]{1,120}$/.test(v)), effort: undefined },
};
for (const [name, ok] of [['POCKET_CLAUDE_MODEL', POCKET_DEFAULTS.claude.model], ['POCKET_CLAUDE_EFFORT', POCKET_DEFAULTS.claude.effort], ['POCKET_CODEX_MODEL', POCKET_DEFAULTS.codex.model], ['POCKET_CODEX_EFFORT', POCKET_DEFAULTS.codex.effort]])
  if (process.env[name] && !ok) console.warn(`${name}=${process.env[name]} is not a supported value; using the CLI default`);
// The per-engine model-compatibility check now lives in engines.mjs (the engine registry),
// so a third engine is a registry entry, not another branch here. `provider` is the engine id.
const validateModel = (provider, model) => validateModelForEngine(provider, model);
// A Claude model the picker does not offer (unchosen, blocked by the managed policy, unknown) is never
// passed to the CLI: the turn runs on the default instead and `modelFallback` says so.
const withDefaults = (provider, opts) => {
  if (provider === 'claude') {
    const asked = opts.model && opts.model !== 'default' ? opts.model : null;
    validateModel(provider, asked);
    let model = asked, modelFallback = null;
    // 1.91: a pick of a version that has been replaced (a conversation started on Sonnet 5) runs its successor.
    const next = asked && successorOf(asked, modelPolicy());
    if (next && isOffered(next)) model = next;
    else if (asked && !isOffered(asked)) {
      model = claudePocketModel();
      const known = CLAUDE_MODELS.find(m => m.id === asked);
      modelFallback = { requested: asked, label: known?.label || asked, used: model || 'default', usedLabel: claudeDefaultLabel(),
        reason: !known ? 'unknown' : !policyAllows(asked, modelPolicy()) ? 'policy' : 'not-offered' };
    } else if (!asked) model = claudePocketModel();
    const effort = opts.effort || POCKET_DEFAULTS[provider].effort;
    return { ...opts, model, effort: EFFORTS.has(effort) ? capEffort(effort, maxEffort()) : effort, modelFallback }; // 1.62: never above the policy's ceiling
  }
  let model = opts.model && opts.model !== 'default' ? opts.model : POCKET_DEFAULTS[provider].model;
  if (provider === 'codex') model = codex.codexSuccessor(model); // 1.91: GPT-6 Sol runs as GPT-6.1 Sol once Codex lists it
  validateModel(provider, model);
  return { ...opts, model, effort: opts.effort || POCKET_DEFAULTS[provider].effort };
};
const fallbackText = f => `${f.label} is ${f.reason === 'policy' ? "blocked by this computer's Claude Code policy" : f.reason === 'unknown' ? 'not a model Pocket knows' : 'not offered in Settings'}, so this reply uses ${f.used === 'default' ? 'the default model' : f.usedLabel}${f.used === 'default' ? ` (${f.usedLabel})` : ''}.`;
// Workspace the New session screen preselects; unset = wherever you last started one.
const DEFAULT_CWD = envPick('POCKET_DEFAULT_CWD', v => path.isAbsolute(v) && fs.existsSync(v) && fs.statSync(v).isDirectory());
// 1.55: POCKET_LOCK_CWD=1 pins every session to DEFAULT_CWD: the New session screen shows the folder with nothing to
// choose, and a start that names another folder is moved there. For installs whose users should never meet a folder.
const LOCK_CWD = ['1', 'true', 'yes', 'on'].includes(String(process.env.POCKET_LOCK_CWD || '').trim().toLowerCase()) && Boolean(DEFAULT_CWD);
if (!LOCK_CWD && /^(1|true|yes|on)$/i.test(String(process.env.POCKET_LOCK_CWD || '').trim())) console.log(new Date().toISOString(), 'POCKET_LOCK_CWD is set but POCKET_DEFAULT_CWD is not a directory; the workspace is not locked');

const log = (...a) => console.log(new Date().toISOString(), ...a);
// A rejected promise nobody awaited (a transcript deleted mid-read, a timer callback that
// threw) must cost that request, never the daemon: a crash drops every open stream and
// the in-memory approval/question inboxes of every live turn.
process.on('unhandledRejection', e => log(`unhandled rejection: ${e?.stack || e}`));
// Origins allowed to embed the app (Mission Control). Space-separated; default = same origin.
const FRAME_ANCESTORS = (process.env.POCKET_FRAME_ANCESTORS || '').split(/\s+/).filter(Boolean);

// ---------- web push (turn-completion notifications) ----------
const SUBS_FILE = path.join(DATA_DIR, 'push-subs.json');
const pushReady = Boolean(process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE);
// VAPID subject: the operator contact push services may use — an email (mailto: added) or an https URL.
const vapidSubject = (c => !c ? 'https://github.com/bbesner/pocket-code' : /^(mailto:|https:)/.test(c) ? c : `mailto:${c}`)(process.env.VAPID_CONTACT);
if (pushReady) webpush.setVapidDetails(vapidSubject, process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
else log('push disabled: VAPID keys not set');
const loadSubs = () => { try { return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch { return []; } };
const saveSubs = s => atomicWrite(SUBS_FILE, s);
// 1.50: what each device wants. A subscription saved by an earlier build has no prefs and gets everything, as before.
const PUSH_KINDS = ['turns', 'reminders', 'vault', 'alerts']; // 1.69: alerts (POST /api/notify, Inbox Watch) is a saved kind with its own device toggle; a device saved before it gets them, as before
const pushPrefsOf = s => ({ kinds: Object.fromEntries(PUSH_KINDS.map(k => [k, s.kinds?.[k] !== false])), badge: s.badge !== false });
const cleanPushPrefs = p => { const out = {}; if (p?.kinds && typeof p.kinds === 'object') out.kinds = Object.fromEntries(PUSH_KINDS.filter(k => typeof p.kinds[k] === 'boolean').map(k => [k, p.kinds[k]])); if (typeof p?.badge === 'boolean') out.badge = p.badge; return out; };
// per-session mute: a chatty background session shouldn't buzz the phone every turn
const MUTES_FILE = path.join(DATA_DIR, 'mutes.json');
const loadMutes = () => { try { return new Set(JSON.parse(fs.readFileSync(MUTES_FILE, 'utf8'))); } catch { return new Set(); } };
let mutes = loadMutes();
const saveMutes = () => atomicWrite(MUTES_FILE, [...mutes]);
// per-session pin + custom name: the CLI's session store has no field for either, so they
// live in an overlay here (same pattern as mutes) — transcripts stay untouched
const SMETA_FILE = path.join(DATA_DIR, 'session-meta.json');
// The overlay is migrated to the current schema on load (migrateSmeta stamps the version and
// is a no-op for today's records); it persists on the next natural save. See session-schema.mjs.
const loadSmeta = () => { let raw = null; try { raw = JSON.parse(fs.readFileSync(SMETA_FILE, 'utf8')); } catch { } return migrateSmeta(raw); };
let smeta = loadSmeta();
const saveSmeta = () => atomicWrite(SMETA_FILE, smeta);
const isPinned = id => Boolean(smeta[id]?.pin);
// The engine that owns a session: a persisted engine config wins (set by engines that need it,
// e.g. the ACP/OpenRouter engine), else it's derived from the id prefix — the long-standing rule.
const sessionEngine = id => readEngineConfig(smeta[id])?.engine || engineForSessionId(id);
// Pinned-session order chosen in the rail (drag, or Move up/down). Pins without an order follow by recency.
const pinRank = id => Number.isFinite(smeta[id]?.pinOrder) ? smeta[id].pinOrder : Number.MAX_SAFE_INTEGER;
// server-wide options (one tenant per install). titleSync: share session names with
// Claude Code itself — read the CLI/code-server's custom-title/ai-title records from the
// transcript and write renames back as custom-title lines (their own rename mechanism).
const SETTINGS_FILE = path.join(DATA_DIR, 'pocket-settings.json');
const SETTINGS_DEFAULTS = { contextPolicy: null, titleSync: false, projects: false, documents: false, tasks: false, inbox: false, coordination: false, ownerTimezone: '', vault: false, vaultAutoLockMinutes: 0, vaultAccess: 'once', secretGuard: true, remindAhead: 0, notifyEmail: '', offeredClaudeModels: null, trustedActions: null }; // 1.50: remindAhead (hours, 0 or 24), notifyEmail; 1.52: offeredClaudeModels (null = the server default); 1.56: trustedActions (null = the server default)
const loadSettings = () => { try { return { ...SETTINGS_DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch { return { ...SETTINGS_DEFAULTS }; } };
let settings = loadSettings();
const saveSettings = () => atomicWrite(SETTINGS_FILE, settings);
// 1.60: Assistant mode, a simpler Pocket for people who don't write code (docs/plans/assistant-mode.md).
// POCKET_ASSISTANT_MODE=locked keeps it on and out of Settings; on (or 1) sets the starting value until Settings
// changes it; off or unset starts with the full workbench.
const ASSISTANT_ENV = (process.env.POCKET_ASSISTANT_MODE || '').trim().toLowerCase();
const assistantLocked = ASSISTANT_ENV === 'locked';
if (typeof settings.assistantMode !== 'boolean') settings.assistantMode = ['on', '1', 'true', 'locked'].includes(ASSISTANT_ENV);
const assistantOn = () => assistantLocked || settings.assistantMode === true;
// 1.56: read-only actions Claude may run without a card in Review actions (trusted.mjs). A list saved in
// Settings → Agents & instance wins; until one is saved, POCKET_TRUSTED_ACTIONS; else none (every action asks).
const ENV_TRUSTED = parseRuleList(process.env.POCKET_TRUSTED_ACTIONS || '');
for (const x of ENV_TRUSTED.ignored) console.warn(`POCKET_TRUSTED_ACTIONS: ignored ${JSON.stringify(x.rule)}: ${x.error}`);
const trustedRules = () => Array.isArray(settings.trustedActions) ? settings.trustedActions : ENV_TRUSTED.rules;
const trustedSettings = () => ({ rules: trustedRules(), source: Array.isArray(settings.trustedActions) ? 'settings' : ENV_TRUSTED.rules.length ? 'env' : 'none',
  saved: Array.isArray(settings.trustedActions), env: ENV_TRUSTED.rules, envIgnored: ENV_TRUSTED.ignored });
if (POCKET_DEFAULTS.claude.model && !isOffered(POCKET_DEFAULTS.claude.model)) console.warn(`POCKET_CLAUDE_MODEL=${POCKET_DEFAULTS.claude.model} is not offered (Settings, POCKET_CLAUDE_MODELS or this computer's Claude Code policy); Default uses the CLI's own default`);

// ---------- 1.29: projects ----------
// The tracked-project board (projects.mjs), off until Settings → Projects & documents turns it on. Agents reach it with the
// loopback token Pocket writes at boot: a bearer accepted only on /api/board*, only from a direct loopback
// connection (a request that arrived through the tunnel or a proxy carries forwarding headers and is refused),
// and never in place of the cookie anywhere else. Due reminders go out by web push and, when the operator sets
// POCKET_REMINDER_HOOK, to that command with the reminder as JSON on stdin; each is announced once.
const board = new ProjectStore(path.join(DATA_DIR, 'projects.json'), { zone: () => ownerZone() }); // 1.81: offsetless times in the zone the commands print
const BOARD_CLI = path.join(import.meta.dirname, 'scripts', 'pocket-board.mjs');
// ---------- 1.30: documents ----------
// The library (documents.mjs): files in POCKET_DOCUMENTS_DIR, records in <data dir>/documents.json. Off until
// Settings → Projects & documents turns it on; while off nothing is served, not even public files. The same loopback token as
// the board serves pocket-docs on /api/documents* only.
const DOCS_DIR = process.env.POCKET_DOCUMENTS_DIR || path.join(DATA_DIR, 'documents');
const docs = new DocumentStore(DOCS_DIR, path.join(DATA_DIR, 'documents.json'));
const thumbs = new Thumbnailer(docs, { log }); // 1.32: pictures for the library's grid, cached in <documents dir>/.thumbs
// 1.61: pictures for file cards in a conversation (PDF pages and images only), cached under the data directory.
const artifactThumbs = new Thumbnailer({ dir: path.join(DATA_DIR, 'artifact-thumbs'), filePath: r => r.file }, { log });
const DOCS_CLI = path.join(import.meta.dirname, 'scripts', 'pocket-docs.mjs');
const docsOn = (_req, res, next) => settings.documents ? next() : res.status(404).json({ error: 'Files is off. Turn it on in Settings → Projects, files, tasks & vault.', code: 'documents_off' });
const purgeDocs = () => { try { const gone = docs.purge(); if (gone.length) log(`documents purged from trash: ${gone.length}`); } catch (e) { log('documents purge: ' + e.message); } };
setInterval(purgeDocs, 6 * 3600_000).unref();
setTimeout(purgeDocs, 60_000).unref(); // 1.45: also a minute after start, so a restart does not wait six hours (it clears orphaned thumbnails too)
// ---------- 1.36: tasks ----------
// To-dos (tasks.mjs): <data dir>/tasks.json. Off until Settings → Projects, files, tasks & vault turns it on. The same loopback
// token serves pocket-tasks on /api/tasks* only; a dated task is announced once when due, like a project reminder.
const taskStore = new TaskStore(path.join(DATA_DIR, 'tasks.json'), { zone: () => ownerZone() });
const TASKS_CLI = path.join(import.meta.dirname, 'scripts', 'pocket-tasks.mjs');
// ---------- 1.99: coordination ----------
// Named holds, so two conversations don't work the same shared thing at once (coordination.mjs): <data dir>/coordination.json.
// Off until Settings → Projects, files, tasks & vault turns it on, and never in Assistant mode. The same loopback token serves pocket-coord on
// /api/coordination* only; who is asking comes from the runner token (coordCaller), never from the request body.
const coord = new CoordStore(path.join(DATA_DIR, 'coordination.json'));
const COORD_CLI = path.join(import.meta.dirname, 'scripts', 'pocket-coord.mjs');
const coordLive = () => Boolean(settings.coordination) && !assistantOn();
const coordOn = (_req, res, next) => coordLive() ? next() : res.status(404).json({ error: 'Coordination is off. Turn it on in Settings → Projects, files, tasks & vault.', code: 'coordination_off' });
// ---------- 1.69: inbox ----------
// What the owner's inbox watcher sent (inbox.mjs): <data dir>/inbox.json. Off until Settings → Projects, files, tasks & vault
// turns it on. The same loopback token serves pocket-inbox and the worker on /api/inbox* only.
const inboxStore = new InboxStore(path.join(DATA_DIR, 'inbox.json'));
const INBOX_CLI = path.join(import.meta.dirname, 'scripts', 'pocket-inbox.mjs');
const inboxOn = (_req, res, next) => settings.inbox ? next() : res.status(404).json({ error: 'Inbox Watch is off. Turn it on in Settings → Projects, files, tasks & vault.', code: 'inbox_off' });
// 1.74: Pocket runs the watcher itself (inbox-runner.mjs) unless one installed by hand already reports here. POCKET_INBOX_RUNNER=0 turns it off.
const inboxRunner = new InboxRunner({ codexModel: id => codex.codexSuccessor(id), dataDir: DATA_DIR, appDir: import.meta.dirname, claudeBin: CLAUDE_BIN, codexBin: process.env.POCKET_CODEX === '0' ? null : codex.CODEX_BIN, codexHome: process.env.CODEX_HOME || path.join(HOME, '.codex'), sessionDir: HOME, env: () => spawnEnv(), settings: () => settings,
  store: inboxStore, log: m => log(m), notify: (title, body) => pushRaw(title, body, { tag: 'inbox-runner', url: '/#/inbox', kind: 'alerts' }).catch(e => log(`inbox runner push: ${e.message}`)) });
if (process.env.POCKET_INBOX_RUNNER !== '0') inboxRunner.start();
// ---------- 1.57: start links ----------
// A briefing an agent or a job hands to Pocket (starts.mjs): <data dir>/starts.json. POST /api/start with the loopback token
// (or the owner's cookie) stores it and answers with an id and a URL; opening #/start/<id> signed in puts the briefing in New
// session with the workspace and agent it names. Entries expire (7 days by default). Nothing starts until the owner taps Start.
const starts = new StartStore(path.join(DATA_DIR, 'starts.json'));
const START_CLI = path.join(import.meta.dirname, 'scripts', 'pocket-start.mjs');
const startsClaimed = new Set(); // 1.96: handoffs whose /api/new is running, so a second tap in that window never makes a second conversation
const tasksOn = (_req, res, next) => settings.tasks ? next() : res.status(404).json({ error: 'Tasks is off. Turn it on in Settings → Projects, files, tasks & vault.', code: 'tasks_off' });
// ---------- 1.39: the vault ----------
// Credentials agents use by name and never see (vault.mjs): <data dir>/vault.enc, one AES-256-GCM blob under
// POCKET_VAULT_KEY, decrypted into memory here; vault-audit.jsonl records every use and never a value. Off until
// Settings turns it on, which needs the key. The same loopback token serves pocket-vault on /api/vault* only;
// what each caller may do is decided per route (the owner's cookie, or an agent's token plus its runner token).
const VAULT_CLI = path.join(import.meta.dirname, 'scripts', 'pocket-vault.mjs');
// 1.40: a passphrase-mode store opens without the env key and starts locked; the owner unlocks it from Pocket.
let vault = null, vaultError = '';
const VAULT_FILE = path.join(DATA_DIR, 'vault.enc');
const openVault = (keyRaw, oldRaw = '') => { const v = new VaultStore(VAULT_FILE, { key: keyRaw ? parseKey(keyRaw) : null, oldKeys: oldRaw ? [parseKey(oldRaw)] : [], log }); v.access = () => settings.vaultAccess; return v; }; // 1.41: Agent access
try { vault = openVault(VAULT_KEY_RAW, VAULT_KEY_PREVIOUS); } catch (e) { vaultError = e.message; log(`vault: ${e.message}`); }
// 1.76.3: a rotation that stopped between its two .env saves left POCKET_VAULT_KEY holding a key the owner was never shown, with
// the previous one beside it and the store still under the previous one. The store's key is the one that opened it: .env goes
// back to it, so a passphrase set and later removed, the recovery key and the next rotation all use the key the owner has.
if (vault && vault.openedWith && vault.envKey && !vault.openedWith.equals(vault.envKey)) {
  vault.envKey = vault.openedWith; vault.keys = [vault.openedWith]; VAULT_KEY_RAW = vault.openedWith.toString('base64');
  if (VAULT_KEY_PRESET) log('vault: POCKET_VAULT_KEY in the environment is not the key the store is written under; POCKET_VAULT_KEY_PREVIOUS is. The store stays under the previous key.');
  else try { saveVaultKeyToEnv(VAULT_KEY_RAW); log('vault: an unfinished key rotation was rolled back; .env holds the key the store is written under'); } catch (e) { log(`vault: an unfinished key rotation could not be rolled back in .env: ${e.message}`); }
}
// 1.44: Pocket keeps the key itself. Switching the Vault on with no key and no store creates one and saves it to this
// install's .env (mode 0600, the file backups already leave out); a store whose key went missing is restored from the
// owner's recovery key, never recreated. Rotation saves the new key the same way, with the previous one kept beside it
// only until the store has been rewritten, so a crash in between can still open it.
const vaultCanCreateKey = () => !vault && !VAULT_KEY_RAW && !fs.existsSync(VAULT_FILE);
const vaultNeedsKey = () => !vault && !VAULT_KEY_RAW && fs.existsSync(VAULT_FILE);
function saveVaultKeyToEnv(key, { previous = '' } = {}) {
  if (!ENV_FILE) throw Object.assign(new Error('This install has no .env file to keep the Vault key in (POCKET_ENV_FILE is empty). Set POCKET_VAULT_KEY yourself.'), { status: 409, code: 'vault_no_key' });
  let text = ''; try { text = fs.readFileSync(ENV_FILE, 'utf8'); } catch { }
  const lines = text.split('\n').filter(l => !/^\s*POCKET_VAULT_KEY_PREVIOUS\s*=/.test(l));
  let at = lines.findIndex(l => /^\s*POCKET_VAULT_KEY\s*=/.test(l));
  if (at === -1) { while (lines.length && lines[lines.length - 1] === '') lines.pop(); lines.push(`# The Vault's encryption key, kept by Pocket Code. Save a copy (Settings → Vault → Download recovery key): a backup of vault.enc opens only with it.`, `POCKET_VAULT_KEY=${key}`, ''); at = lines.length - 2; }
  else lines[at] = `POCKET_VAULT_KEY=${key}`;
  if (previous) lines.splice(at + 1, 0, `POCKET_VAULT_KEY_PREVIOUS=${previous}`);
  const tmp = ENV_FILE + '.tmp'; fs.writeFileSync(tmp, lines.join('\n'), { mode: 0o600 }); fs.renameSync(tmp, ENV_FILE); fs.chmodSync(ENV_FILE, 0o600);
}
const normalKey = raw => parseKey(String(raw).trim().replace(/^POCKET_VAULT_KEY\s*=\s*/, '')).toString('base64');
const vaultReady = () => Boolean(vault);
const vaultLive = () => Boolean(settings.vault && vault);
const vaultOn = (_req, res, next) => settings.vault ? (vault ? next() : res.status(503).json({ error: `The Vault cannot be opened: ${vaultError}`, code: 'vault_unavailable' })) : res.status(404).json({ error: 'The Vault is off. Turn it on in Settings → Projects, files, tasks & vault.', code: 'vault_off' });
// Everything but the snapshot and unlock needs an open store. An agent that hits a locked Vault gets a push to the owner, at most one every ten minutes.
let lockedPushAt = 0;
const vaultOpen = (req, res, next) => {
  if (!vault.locked) return next();
  if (req.boardActor === 'cli' && Date.now() - lockedPushAt > 600_000) { lockedPushAt = Date.now(); pushRaw('The Vault is locked', 'An agent needs a secret. Unlock the Vault in Pocket Code.', { tag: 'vault:locked', url: '/#/vault', kind: 'vault' }).catch(() => {}); }
  res.status(423).json({ error: 'The Vault is locked. Ask the owner to unlock it in Pocket Code.', code: 'vault_locked' });
};
const AUTO_LOCK_CHOICES = [0, 15, 60, 480, 1440];
setInterval(() => { try { if (vault && vault.idleLockDue(settings.vaultAutoLockMinutes || 0)) { vault.lock(); log(`vault locked after ${settings.vaultAutoLockMinutes} minutes idle`); } } catch (e) { log('vault idle lock: ' + e.message); } }, Math.max(1000, Number(process.env.POCKET_VAULT_IDLE_CHECK_MS) || 60_000)).unref();
setInterval(() => { try { if (vault) { const gone = vault.purge(); if (gone.length) log(`vault purged from trash: ${gone.length}`); } } catch (e) { log('vault purge: ' + e.message); } }, 6 * 3600_000).unref();
// 1.86: Pocket's instructions for an agent, the same for every engine (Claude --append-system-prompt, Codex developer
// instructions, OpenRouter an instruction file OpenCode reads each request). `sid` is the conversation id the CLIs are
// told to record; Codex adds its suggested-reply text itself; OpenRouter has no Google connectors.
function pocketInstructions(engine, sid) {
  const choices = process.env.POCKET_CHOICES !== '0';
  return [engine !== 'codex' && choices ? CHOICE_INSTRUCTIONS : '', settings.projects ? projectInstructions(BOARD_CLI, sid) : '', settings.documents ? documentInstructions(DOCS_CLI, sid) : '',
    settings.tasks ? taskInstructions(TASKS_CLI, sid, { choices }) : '', settings.inbox ? inboxInstructions(INBOX_CLI, sid) : '', vaultLive() ? vaultInstructions(VAULT_CLI, sid) : '', coordLive() ? coordinationInstructions(COORD_CLI) : '',
    handoffInstructions(START_CLI), engine === 'acp' ? '' : googleInstructions(engine), manualInstructions()].filter(Boolean).join(' ');
}
codex.setExtraInstructions(threadId => pocketInstructions('codex', threadId ? 'cx:' + threadId : null));
// 1.87: the trusted read-only actions (Settings -> Agents) apply to every agent's commands in Review actions
const trustedCommand = command => matchTrusted(trustedRules(), 'Bash', { command }); // the command alone: the matcher refuses fields it does not know
codex.setTrustedMatcher(trustedCommand);
acp.setTrustedMatcher(trustedCommand);
const syncAgentSkills = () => syncSkills({ settings: { ...settings, vault: vaultLive(), coordination: coordLive() }, commands: { board: BOARD_CLI, docs: DOCS_CLI, tasks: TASKS_CLI, vault: VAULT_CLI, inbox: INBOX_CLI, coord: COORD_CLI }, log }); // 1.34: pocket-projects / pocket-files (1.36: pocket-tasks, 1.39: pocket-vault, 1.69: pocket-inbox) for every agent on the box
syncAgentSkills();
const CLI_TOKEN_FILE = path.join(DATA_DIR, 'cli-token');
const cliToken = randomBytes(32).toString('hex');
fs.writeFileSync(CLI_TOKEN_FILE, cliToken + '\n', { mode: 0o600 }); fs.chmodSync(CLI_TOKEN_FILE, 0o600);
// 1.43.1: the daemon's own address beside the token, so the CLIs and pocket-mcp-proxy never follow a PORT some other app exported.
const CLI_URL_FILE = path.join(DATA_DIR, 'cli-url');
fs.writeFileSync(CLI_URL_FILE, `http://127.0.0.1:${PORT}\n`, { mode: 0o600 }); fs.chmodSync(CLI_URL_FILE, 0o600);
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
// Cookie, or the loopback CLI token: mounted only on /api/board* and /api/documents*.
async function requireBoardAuth(req, res, next) {
  if (checkCookie(getCookie(req, 'pc_auth'))) return next();
  const m = /^Bearer ([0-9a-f]{64})$/.exec(req.get('authorization') || '');
  const direct = LOOPBACK.has(req.socket.remoteAddress) && !req.get('cf-connecting-ip') && !req.get('x-forwarded-for');
  if (m && direct && timingSafeEqual(Buffer.from(m[1]), Buffer.from(cliToken))) { req.boardActor = 'cli'; return next(); }
  if (await accessSignIn(req, res)) return next(); // 1.63
  res.status(401).json({ error: 'unauthorized' });
}
const boardOn = (_req, res, next) => settings.projects ? next() : res.status(404).json({ error: 'Projects is off. Turn it on in Settings → Projects, files, tasks & vault.', code: 'projects_off' });
const REMINDER_HOOK = process.env.POCKET_REMINDER_HOOK || '';
// 1.50: email for due reminders and tasks, when the operator set POCKET_SMTP_URL and the owner named an address in
// Settings → Notifications. Links in the mail use POCKET_PUBLIC_URL, or the address the owner last signed in from.
const mailer = (() => { try { return createMailer(SMTP_URL, { from: SMTP_FROM, log }); } catch (e) { log(`mail: ${e.message}`); return { configured: false, error: e.message, from: '', describe: () => e.message, send: async () => { throw e; } }; } })();
if (mailer.configured) log(`mail: ${mailer.describe()}`);
const emailOn = () => mailer.configured && looksLikeEmail(settings.notifyEmail);
// 1.77.6: where people see times. The zone the owner's browser reports (learnTimezone), else POCKET_TZ, else the box's.
const ownerZone = () => settings.ownerTimezone || process.env.POCKET_TZ || '';
const publicBase = () => (process.env.POCKET_PUBLIC_URL || settings.publicUrl || '').replace(/\/$/, '');
const LOOPBACK_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
function learnPublicUrl(req) { // the owner's own address, from a signed-in request that came through the tunnel or proxy
  if (process.env.POCKET_PUBLIC_URL) return;
  const host = req.get('x-forwarded-host') || req.get('host') || '';
  if (!host || LOOPBACK_HOSTS.test(host)) return;
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const url = `${proto}://${host.split(',')[0].trim()}`;
  if (url !== settings.publicUrl) { settings.publicUrl = url; saveSettings(); }
}
const emailSettings = () => ({ configured: mailer.configured, from: mailer.from || '', to: settings.notifyEmail || '', on: emailOn(), hook: Boolean(REMINDER_HOOK), error: mailer.error || null, base: publicBase() });
async function mailDue(item, { ahead = false } = {}) {
  if (!emailOn()) return false;
  try { await mailer.send({ to: settings.notifyEmail, ...dueMessage(item, { ahead, base: publicBase(), tz: ownerZone() }) }); return true; }
  catch (e) { log(`mail failed: ${e.message}`); return false; }
}
// 1.37.1: the hook gets the same environment as agent turns, without the daemon's secrets (login password,
// cookie-signing key, push private key). It is an operator's own command, but it has no use for them.
// 1.73.7: each run leads its own process group, keeps the last 4 KB of stderr, is killed (with everything it started) after
// POCKET_REMINDER_HOOK_TIMEOUT_MS (default 60 s), and is ended when the daemon exits. Work the hook leaves running in the
// background after it exits is its own business.
const REMINDER_HOOK_TIMEOUT_MS = Math.max(100, Number(process.env.POCKET_REMINDER_HOOK_TIMEOUT_MS) || 60_000);
const reminderHooks = new Set();
process.on('exit', () => { for (const pid of reminderHooks) signalGroup(pid, 'SIGTERM'); });
function runReminderHook(payload) {
  const child = spawn(REMINDER_HOOK, { shell: true, env: agentEnv(process.env), stdio: ['pipe', 'ignore', 'pipe'], detached: true });
  if (child.pid) reminderHooks.add(child.pid);
  let err = ''; child.stderr.on('data', b => { err = (err + b).slice(-4096); });
  const timer = setTimeout(() => { log(`reminder hook still running after ${REMINDER_HOOK_TIMEOUT_MS} ms; ending it`); signalGroup(child.pid, 'SIGTERM'); setTimeout(() => signalGroup(child.pid, 'SIGKILL'), 5000).unref(); }, REMINDER_HOOK_TIMEOUT_MS);
  timer.unref();
  child.on('exit', (code, sig) => { clearTimeout(timer); reminderHooks.delete(child.pid); if (code || sig) log(`reminder hook exited ${code ?? sig}: ${err.trim().slice(-300)}`); });
  child.on('error', e => { clearTimeout(timer); reminderHooks.delete(child.pid); log(`reminder hook failed: ${e.message}`); });
  child.stdin.on('error', () => { }); child.stdin.end(JSON.stringify(payload));
}
// The count a device's app icon shows: due tasks and due project reminders together (1.50).
const dueTotal = () => (settings.tasks ? taskStore.snapshot().dueCount : 0) + (settings.projects ? board.snapshot().dueCount : 0);
const AHEAD_MS = () => (Number(settings.remindAhead) === 24 ? 24 : 0) * 3600_000;
// One announcement per due item: push (with Tomorrow / Done actions the service worker answers), the hook, email.
// With "a day before" on, a second, earlier notice goes out 24 hours ahead, marked `ahead`.
// 1.73.7: one run at a time (a slow push or mail server used to let the next tick announce the items this run had not
// reached yet, twice), and each item is checked against the store again right before it is marked: one done, deleted or
// given a new time while an earlier item was being sent is skipped, so its new notice is not lost.
let announcing = false;
async function announceRemindersOnce() {
  if (announcing) return;
  announcing = true;
  try { await announceReminders(); } finally { announcing = false; }
}
const stillDue = (list, key, item) => list.some(x => x[key] === item[key] && x.dueAt === item.dueAt);
async function announceReminders() {
  const ahead = AHEAD_MS();
  if (settings.tasks) {
    for (const t of taskStore.due()) { // 1.36: a dated task, once, with a link to the list
      if (!stillDue(taskStore.due(), 'task', t)) continue;
      taskStore.markNotified(t.task);
      const url = '/#/tasks', payload = { kind: 'task', ...t, url };
      const devices = await pushRaw('Task due', t.text, { tag: 'task:' + t.task, url, kind: 'reminders', badge: dueTotal(), snooze: { task: t.task }, actions: [{ action: 'later', title: 'Tomorrow' }, { action: 'done', title: 'Done' }] });
      if (REMINDER_HOOK) runReminderHook(payload);
      const mailed = await mailDue(payload);
      log(`task due task=${t.task} push=${devices ?? 'off'} hook=${REMINDER_HOOK ? 'yes' : 'no'} mail=${mailed ? 'yes' : 'no'}`);
    }
    if (ahead) for (const t of taskStore.dueAhead(ahead)) {
      if (!stillDue(taskStore.dueAhead(ahead), 'task', t)) continue;
      taskStore.markAheadNotified(t.task);
      const url = '/#/tasks', payload = { kind: 'task', ...t, url, ahead: true };
      const devices = await pushRaw('Task due tomorrow', t.text, { tag: 'task-ahead:' + t.task, url, kind: 'reminders' });
      if (REMINDER_HOOK) runReminderHook(payload);
      const mailed = await mailDue(payload, { ahead: true });
      log(`task due tomorrow task=${t.task} push=${devices ?? 'off'} hook=${REMINDER_HOOK ? 'yes' : 'no'} mail=${mailed ? 'yes' : 'no'}`);
    }
  }
  if (!settings.projects) return;
  for (const r of board.due()) {
    if (!stillDue(board.due(), 'reminder', r)) continue;
    board.markNotified(r.project, r.reminder); // first, so a crash mid-send never announces it twice
    const url = '/#/projects/' + r.project, payload = { ...r, url };
    const devices = await pushRaw(`Reminder: ${r.projectName}`, r.label, { tag: 'reminder:' + r.reminder, url, kind: 'reminders', badge: dueTotal(), snooze: { project: r.project, reminder: r.reminder, task: r.task || null, label: r.label }, actions: [{ action: 'later', title: 'Tomorrow' }] });
    if (REMINDER_HOOK) runReminderHook(payload);
    const mailed = await mailDue(payload);
    log(`reminder due project=${r.project} reminder=${r.reminder} push=${devices ?? 'off'} hook=${REMINDER_HOOK ? 'yes' : 'no'} mail=${mailed ? 'yes' : 'no'}`);
  }
  if (ahead) for (const r of board.dueAhead(ahead)) {
    if (!stillDue(board.dueAhead(ahead), 'reminder', r)) continue;
    board.markAheadNotified(r.project, r.reminder);
    const url = '/#/projects/' + r.project, payload = { ...r, url, ahead: true };
    const devices = await pushRaw(`Reminder tomorrow: ${r.projectName}`, r.label, { tag: 'reminder-ahead:' + r.reminder, url, kind: 'reminders' });
    if (REMINDER_HOOK) runReminderHook(payload);
    const mailed = await mailDue(payload, { ahead: true });
    log(`reminder due tomorrow project=${r.project} reminder=${r.reminder} push=${devices ?? 'off'} hook=${REMINDER_HOOK ? 'yes' : 'no'} mail=${mailed ? 'yes' : 'no'}`);
  }
}
const REMINDER_CHECK_MS = Math.max(250, Number(process.env.POCKET_REMINDER_CHECK_MS) || 60_000);
setInterval(() => announceRemindersOnce().catch(e => log('reminders: ' + e.message)), REMINDER_CHECK_MS).unref();
setTimeout(() => announceRemindersOnce().catch(e => log('reminders: ' + e.message)), Math.min(5_000, REMINDER_CHECK_MS)).unref();

const setSmeta = (id, patch) => {
  const m = { ...smeta[id], ...patch };
  for (const k of Object.keys(m)) if (m[k] == null) delete m[k];
  if (Object.keys(m).length) smeta[id] = m; else delete smeta[id];
  saveSmeta();
};
// 1.19.1: titles saved by 1.19.0 may carry Markdown ("# Planning phase"); show them through the same cleanup.
// 1.20: turning generated titles off in Settings also stops showing them (the stored titles are kept).
const storedAutoTitle = id => settings.autoTitles && smeta[id]?.autoTitle ? cleanTitle(smeta[id].autoTitle) : null; // a bad stored title falls back to the request until it is redone
// 1.29.1: a title updated from the session's progress outranks the agent's own one-shot title (not a rename).
const liveAutoTitle = id => smeta[id]?.autoTitleLive ? storedAutoTitle(id) : null;
// 1.20: generated titles are a server setting (Settings → Session titles): on/off and Automatic / Claude / Codex.
// POCKET_AUTO_TITLES only sets the starting value until someone changes it in Settings.
if (typeof settings.autoTitles !== 'boolean') settings.autoTitles = (process.env.POCKET_AUTO_TITLES ?? '1').trim() !== '0';
if (!['auto', 'claude', 'codex'].includes(settings.titleProvider)) settings.titleProvider = 'auto';
if (typeof settings.awaySummaries !== 'boolean') settings.awaySummaries = true; // 1.21: "While you were away" summaries
if (typeof settings.liveTitles !== 'boolean') settings.liveTitles = true; // 1.29.1: titles follow the session
// 1.61: keep every file Claude hands over in a reply in Files (Settings, or always in Assistant mode).
if (typeof settings.autoKeepFiles !== 'boolean') settings.autoKeepFiles = false;
const autoKeepOn = () => Boolean(settings.documents) && (assistantOn() || settings.autoKeepFiles);
// 1.62: in Assistant mode a request typed from scratch gets its model and effort from a decision model (router.mjs).
// POCKET_ROUTER=jev (TypeSafe Jev through OpenRouter) or openai (OpenAI Decisions API) with POCKET_ROUTER_KEY or
// POCKET_ROUTER_KEY_FILE; off or unset: the instance default, as before. It fails open to the default.
// 1.67: everything here can also be set in Settings → Agents & instance → Automatic model choice; a choice saved
// there wins over the environment, and its key lives in <data dir>/router-key (0600), never in pocket-settings.json.
const ROUTER_ENV = { provider: (process.env.POCKET_ROUTER || 'off').trim().toLowerCase(),
  key: (() => { const k = ROUTER_KEY.trim(); if (k) return k; const f = (process.env.POCKET_ROUTER_KEY_FILE || '').trim(); try { return f ? fs.readFileSync(f, 'utf8').trim() : ''; } catch { return ''; } })() };
const ROUTER_KEY_FILE = path.join(DATA_DIR, 'router-key');
const routerSavedKey = () => { try { return fs.readFileSync(ROUTER_KEY_FILE, 'utf8').trim(); } catch { return ''; } };
const ROUTER_PROVIDERS = ['jev', 'openai'];
function routerConfig() {
  const r = settings.router || {}, envOn = ROUTER_PROVIDERS.includes(ROUTER_ENV.provider);
  const provider = ROUTER_PROVIDERS.includes(r.provider) ? r.provider : envOn ? ROUTER_ENV.provider : 'jev';
  const saved = routerSavedKey(), key = saved || ROUTER_ENV.key;
  const enabled = typeof r.enabled === 'boolean' ? r.enabled : envOn;
  return { enabled, enabledSource: typeof r.enabled === 'boolean' ? 'settings' : envOn ? 'env' : 'default', provider, key,
    keySource: saved ? 'settings' : ROUTER_ENV.key ? 'env' : 'none', levels: r.levels || null };
}
let router = null;
function buildRouter() {
  const c = routerConfig(), last = router?.last || null;
  router = new ModelRouter({ provider: c.enabled ? c.provider : 'off', key: c.key, url: process.env.POCKET_ROUTER_URL || null,
    timeoutMs: Math.max(300, Number(process.env.POCKET_ROUTER_TIMEOUT_MS) || 1500), context: process.env.POCKET_ROUTER_CONTEXT || '', log });
  router.last = last;
}
buildRouter();
const routerOffered = () => CLAUDE_MODELS.filter(m => isOffered(m.id));
const TITLE_MODELS = { claude: (process.env.POCKET_TITLE_CLAUDE_MODEL || 'haiku').trim(), codex: (process.env.POCKET_TITLE_CODEX_MODEL || 'gpt-6-luna').trim() };
// 1.52: a helper call never names a Claude model the managed policy blocks (the CLI would run its default,
// often the most expensive model, instead); it takes the cheapest offered model the policy allows.
const helperModels = () => ({ claude: helperModel(TITLE_MODELS.claude, { policy: modelPolicy(), offered: claudeOffer().offered }), codex: TITLE_MODELS.codex });
const helperLabel = id => CLAUDE_MODELS.find(m => m.id === id)?.label || ({ haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable' })[id] || id;
// Whether each CLI can make titles: installed, signed in, and (Codex) offering the title model. Refreshed at
// most every 10 minutes, or when Settings opens. null = not known yet; a call is tried and backs off on failure.
const titleProviders = { checkedAt: 0, checking: null, claude: { available: null, reason: '' }, codex: { available: null, reason: '', label: null }, last: null };
const claudeInstalled = () => CLAUDE_BIN === 'claude' ? (process.env.PATH || '').split(path.delimiter).some(d => d && fs.existsSync(path.join(d, 'claude'))) : fs.existsSync(CLAUDE_BIN);
function refreshTitleProviders(maxAgeMs = 10 * 60_000) {
  if (Date.now() - titleProviders.checkedAt < maxAgeMs) return Promise.resolve();
  return titleProviders.checking ??= (async () => {
    const [cl, cx] = await Promise.all([
      (async () => {
        if (!claudeInstalled()) return { available: false, reason: 'Claude Code is not installed on this server.' };
        const id = await readClaudeIdentity(CLAUDE_BIN, spawnEnv());
        return id.signedIn === false ? { available: false, reason: 'Claude Code is not signed in on this server.' } : { available: id.signedIn ? true : null, reason: '' };
      })(),
      (async () => {
        if (!CODEX_ON) return { available: false, reason: process.env.POCKET_CODEX === '0' ? 'Codex is turned off for Pocket on this server.' : 'Codex is not installed on this server.' };
        const acct = await codex.accountSummary().catch(() => null);
        if (acct?.signedIn === false) return { available: false, reason: 'Codex is not signed in on this server.' };
        const models = await codex.codexModels().catch(() => []);
        const m = models.find(x => x.id === TITLE_MODELS.codex);
        if (models.length && !m) return { available: false, reason: `This Codex CLI does not offer ${TITLE_MODELS.codex}. Update Codex to use it.` };
        return { available: acct?.signedIn ? true : null, reason: '', label: m?.label || null };
      })(),
    ]).catch(() => [titleProviders.claude, titleProviders.codex]);
    Object.assign(titleProviders, { claude: cl, codex: cx, checkedAt: Date.now(), checking: null });
  })();
}
// The helper model's provider (titles and away summaries share the choice): the chosen one if it can, or for
// Automatic Claude first (far smaller calls), then Codex.
const titleProvider = () => settings.autoTitles ? helperProvider() : null;
function helperProvider() {
  const ok = p => (p === 'claude' ? claudeInstalled() && !claudeLogin.active : CODEX_ON) && titleProviders[p].available !== false; // installed is known at once; sign-in after the first check
  if (settings.titleProvider !== 'auto') return ok(settings.titleProvider) ? settings.titleProvider : null;
  return ok('claude') ? 'claude' : ok('codex') ? 'codex' : null;
}
const titler = createTitler({ getMeta: id => smeta[id], setMeta: setSmeta, log,
  isEnabled: () => { refreshTitleProviders(); return Boolean(titleProvider()); },
  attempt: () => TITLE_VERSION + ':' + titleProvider(),
  generate: text => titleProvider() === 'codex'
    ? generateCodexTitle(codex.CODEX_BIN, text, { model: TITLE_MODELS.codex, env: spawnEnv() })
    : generateTitle(CLAUDE_BIN, text, { model: helperModels().claude, env: spawnEnv() }),
  onTitled: r => { titleProviders.last = { provider: titleProvider(), model: r.model, at: Date.now() }; } });
// 1.29.1: living titles. After a turn run from Pocket ends, a session that has grown enough since its last check
// (four owner turns or 8k characters, at least ten minutes apart) is shown to the helper model with its current
// title; the model keeps it or writes a better one. Needs generated titles on and the same helper as titles.
const liveTitlesOn = () => settings.autoTitles && settings.liveTitles && Boolean(helperProvider());
const retitler = createRetitler({ getMeta: id => smeta[id], setMeta: setSmeta, log,
  isEnabled: () => { refreshTitleProviders(); return liveTitlesOn(); },
  load: async id => {
    if (isCx(id)) return codex.readCodexThread(codex.bareId(id), 600);
    const file = await findSessionFile(id);
    return file ? readTranscript(file, 600) : { msgs: [], total: 0 };
  },
  currentTitle: async id => {
    if (smeta[id]?.name) return null;
    if (isCx(id)) { const m = await codex.codexThreadMeta(codex.bareId(id)); return m ? liveAutoTitle(id) || (m.untitled && storedAutoTitle(id)) || m.title : null; }
    const file = await findSessionFile(id);
    const m = file && await sessionMeta(file, id);
    return m && !m.noise && !automation(m.title).automated ? m.title : null;
  },
  generate: (digest, current) => retitle({ provider: helperProvider(), claudeBin: CLAUDE_BIN, codexBin: codex.CODEX_BIN, models: helperModels(), env: spawnEnv() }, digest, current),
  onTitled: r => { titleProviders.lastLive = { provider: helperProvider(), model: r.model, at: Date.now(), title: r.title, from: r.from }; },
  gapMs: msSetting('POCKET_LIVE_TITLE_GAP_MS', 10 * 60_000) }); // tests shorten the gap between checks
function titleSettings() {
  return { enabled: settings.autoTitles, choice: settings.titleProvider, using: titleProvider(), helper: helperProvider(), awaySummaries: settings.awaySummaries, models: helperModels(), configuredModels: TITLE_MODELS, claudeModelLabel: helperLabel(helperModels().claude),
    live: settings.liveTitles, liveUsing: liveTitlesOn() ? helperProvider() : null, lastLive: titleProviders.lastLive || null,
    claude: titleProviders.claude, codex: titleProviders.codex, last: titleProviders.last, checkedAt: titleProviders.checkedAt };
}
async function pushNotify(sessionId, title, body) {
  if (!pushReady) return;
  if (mutes.has(sessionId)) return log(`push muted session=${sessionId}`);
  const devices = await pushRaw(title, body, { tag: sessionId, url: '/#/chat/' + sessionId, kind: 'turns' });
  if (devices != null) log(`push sent (${devices} devices) session=${sessionId}`);
}
// One notification to every subscribed device that wants this kind (1.50: turns, reminders or vault; a device's
// choice in Settings → Notifications); returns how many received it, or null when push is off or no device wants it.
// `badge` is the count of due items for the app icon, sent only to devices that show it.
// 1.50.2: a due task or reminder and a Vault request are sent as urgent, so Android delivers them while the phone is idle
// (a normal-priority push waits until the phone wakes, which is how the 1.50.0 reminder pushes went missing on Brad's phone);
// a finished turn stays normal priority, so a busy session does not keep waking the phone.
async function pushRaw(title, body, { tag, url, kind = 'turns', badge, ...extra }) { // 1.41: extra fields (actions, vaultRequest) ride along for the service worker
  if (!pushReady) return null;
  const subs = loadSubs().filter(s => pushPrefsOf(s).kinds[kind] !== false);
  if (!subs.length) return null;
  const base = { title: title.slice(0, 70), body, tag, url, ...extra };
  const options = kind === 'turns' ? {} : { urgency: 'high' };
  const dead = [];
  await Promise.all(subs.map(async s => {
    const payload = JSON.stringify(typeof badge === 'number' && pushPrefsOf(s).badge ? { ...base, badge } : base);
    try { await webpush.sendNotification(s, payload, options); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dead.push(s.endpoint); }
  }));
  if (dead.length) saveSubs(loadSubs().filter(s => !dead.includes(s.endpoint)));
  return subs.length - dead.length;
}

// ---------- auth ----------
function sign(exp) {
  return createHmac('sha256', SECRET).update(String(exp)).digest('hex');
}
function makeCookie(ms = 90 * 24 * 3600 * 1000) {
  const exp = Date.now() + ms;
  return `${exp}.${sign(exp)}`;
}
// 1.89 (S-6): exactly `<digits>.<sig>`. split('.') ignored anything after a second dot, so `<cookie>.1`, `.2` and so on
// were each a valid cookie, and each a fresh key for the per-session Vault count.
function checkCookie(v) {
  if (!v || !/^\d+\.[^.]+$/.test(v)) return false;
  const [exp, sig] = v.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = sign(exp);
  return sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
// 1.89 (S-6): only wrong passwords count, twenty an hour per address, as the Vault's tries have since 1.81. Every attempt
// used to count, so on a tunnel without Access (every caller is 127.0.0.1) twenty stray POSTs, or twenty sign-ins, made
// the owner's next correct password wait an hour.
const loginAttempts = new Map(); // address -> {n wrong, resetAt}
function rateLimited(ip) {
  const rec = loginAttempts.get(ip);
  if (rec && rec.resetAt < Date.now()) { loginAttempts.delete(ip); return false; }
  return (rec?.n || 0) >= 20;
}
function loginFailed(ip) {
  const now = Date.now(), rec = loginAttempts.get(ip);
  if (loginAttempts.size > 5000) for (const [k, v] of loginAttempts) if (v.resetAt < now) loginAttempts.delete(k);
  if (!rec || rec.resetAt < now) loginAttempts.set(ip, { n: 1, resetAt: now + 3600_000 }); else rec.n++;
}
// 1.89 (S-6): the address the login and Vault attempt limits count against. cf-connecting-ip is Cloudflare's, but any
// caller that reaches the port can type it, so a new value on each try never ran out of tries. It counts only when the
// request carries a Cloudflare Access token that verifies for this application (the result accessSignIn already got is
// reused), or when POCKET_TRUSTED_PROXY=1 says the port is reachable only through a proxy that sets the header. Otherwise
// the socket's address: through a tunnel with neither, every caller is the tunnel's 127.0.0.1 and shares one count.
const TRUSTED_PROXY = process.env.POCKET_TRUSTED_PROXY === '1';
async function clientAddress(req) {
  const socket = req.socket.remoteAddress || '?', cf = req.get('cf-connecting-ip');
  if (!cf) return socket;
  if (TRUSTED_PROXY) return cf;
  const token = access.on ? req.get('cf-access-jwt-assertion') : null;
  if (token && req.accessResult === undefined) req.accessResult = await access.verify(token).catch(e => ({ error: e.message }));
  return token && req.accessResult?.through ? cf : socket;
}
function getCookie(req, name) {
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
// 1.63: one sign-in. Behind Cloudflare Access, a valid Access token for an allowed email signs in without Pocket's
// password (access.mjs). POCKET_ACCESS_TEAM (<team>.cloudflareaccess.com), POCKET_ACCESS_AUD (the application's
// audience tag) and POCKET_ACCESS_EMAILS (comma-separated) turn it on; any of them missing keeps the password only.
// 1.67: Settings → Agents & instance → One sign-in can set, change or turn this off; a saved choice wins over the
// environment until "Use the server's values".
const ACCESS_ENV = { team: process.env.POCKET_ACCESS_TEAM || '', aud: process.env.POCKET_ACCESS_AUD || '', emails: process.env.POCKET_ACCESS_EMAILS || '' };
let access = null, accessLast = null; // accessLast: { at, email } of the last sign-in through Access
function accessConfig() {
  const a = settings.access;
  if (a?.enabled === false) return { source: 'settings', team: '', aud: '', emails: [], off: true };
  if (a?.team) return { source: 'settings', team: a.team, aud: a.aud, emails: a.emails };
  const emails = ACCESS_ENV.emails.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return { source: ACCESS_ENV.team || ACCESS_ENV.aud || emails.length ? 'env' : 'none', team: ACCESS_ENV.team.trim().toLowerCase(), aud: ACCESS_ENV.aud.trim(), emails };
}
function buildAccess() { const c = accessConfig(); access = new AccessVerifier({ team: c.off ? '' : c.team, aud: c.aud, emails: c.emails, certsUrl: process.env.POCKET_ACCESS_CERTS_URL || null, log }); }
function accessView() { const c = accessConfig(); return { on: access.on, source: c.source, off: Boolean(c.off), team: c.team, aud: c.aud, emails: c.emails, last: accessLast, envSet: Boolean(ACCESS_ENV.team || ACCESS_ENV.aud || ACCESS_ENV.emails) }; }
buildAccess();
if (process.env.POCKET_ACCESS_CERTS_URL) console.warn('POCKET_ACCESS_CERTS_URL is set: Cloudflare Access keys come from ' + process.env.POCKET_ACCESS_CERTS_URL + ' (tests only)');
const accessRefusals = new Map(); // reason → last logged, so a bad token on every poll is logged once a minute
const accessSignIns = new Map(); // email → last logged
async function accessSignIn(req, res) {
  const token = access.on ? req.get('cf-access-jwt-assertion') : null;
  if (!token) return false;
  // A cross-site request could carry Cloudflare's own cookie (its SameSite is set in Access, not here), so only a
  // same-site request may sign in this way; Pocket's own cookie keeps SameSite=Lax as before.
  const site = req.get('sec-fetch-site'), origin = req.get('origin');
  if (req.method !== 'GET' && req.method !== 'HEAD' && (site === 'cross-site' || (origin && origin !== `https://${req.get('host')}` && origin !== `http://${req.get('host')}`))) return false;
  const r = req.accessResult = await access.verify(token).catch(e => ({ error: e.message })); // 1.89: kept for clientAddress
  if (r.email) {
    // Signed in for a day at most, and never past the Access token's own expiry: someone removed from Access (or
    // from POCKET_ACCESS_EMAILS) is out within a day, and the next request through Access signs in again quietly.
    const ms = Math.max(60_000, Math.min(24 * 3600_000, (r.exp || 0) * 1000 - Date.now()));
    res.setHeader('Set-Cookie', `pc_auth=${makeCookie(ms)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(ms / 1000)}`);
    accessLast = { at: Date.now(), email: r.email };
    if (Date.now() - (accessSignIns.get(r.email) || 0) > 3600_000) { accessSignIns.set(r.email, Date.now()); log(`signed in through Cloudflare Access: ${r.email}`); }
    return true;
  }
  if (Date.now() - (accessRefusals.get(r.error) || 0) > 60_000) { accessRefusals.set(r.error, Date.now()); log(`Cloudflare Access token not accepted (${r.error}); the password page stays`); }
  return false;
}
async function requireAuth(req, res, next) {
  if (checkCookie(getCookie(req, 'pc_auth'))) return next();
  if (await accessSignIn(req, res)) return next();
  res.status(401).json({ error: 'unauthorized' });
}

// ---------- session store (read side) ----------
async function readFirstLines(file, maxBytes = 128 * 1024) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.toString('utf8', 0, bytesRead).split('\n');
  } finally { await fh.close(); }
}

// Cheap metadata: title + cwd from the head of the transcript.
const metaCache = new Map(); // file -> {mtimeMs, meta}
function scanMetaLine(line, acc) {
  if (!line.trim()) return;
  let o; try { o = JSON.parse(line); } catch { return; }
  if (!acc.cwd && o.cwd) acc.cwd = o.cwd;
  // Claude Code's own title records (what code-server / `claude --resume` display).
  // Appended over time — LAST occurrence wins, matching their reader.
  if (o.type === 'custom-title' && o.customTitle) acc.customTitle = o.customTitle;
  if (o.type === 'ai-title' && o.aiTitle) acc.aiTitle = o.aiTitle;
  if (!acc.title && o.type === 'summary' && o.summary) acc.title = o.summary;
  if (!acc.firstUser && o.type === 'user' && !o.isSidechain) {
    const c = o.message?.content;
    const txt = typeof c === 'string' ? c : (Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join(' ') : '');
    // "Workdir: /path." prefixes (a common session template) are boilerplate — the
    // project is already shown on the row; title should be the actual ask
    // 1.89: the title is the prompt's first 300 characters (TITLE_CAP), so the tag strip runs on its first 16 KB, not on a
    // pasted 500 KB; a cut title keeps the whole prompt's hash, so two long prompts that start alike are not one conversation
    const clean = (txt || '').slice(0, 16_000).replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').replace(/\s+/g, ' ')
      .replace(/^\s*Workdir:\s*\S+\s*[.,;—-]*\s*/i, '').trim();
    // (the title generator still reads the first 1,500, through an internal prompt field the routes never send)
    if (clean) acc.firstUser = capTitle(clean);
    if (clean.length > TITLE_CAP) acc.prompt = clean.slice(0, 1500);
    if (clean && (clean.length > TITLE_CAP || txt.length > 16_000)) acc.promptKey = createHash('sha1').update(txt).digest('base64url');
  }
}
const TITLE_CAP = 300; // 1.89: a row titled by its opening request; the conversation itself keeps the whole request
const capTitle = t => t && t.length > TITLE_CAP ? t.slice(0, TITLE_CAP - 1).replace(/\s+\S*$/, '') + '…' : t;
// Title records live at the end of the transcript (appended on each rename), past the
// 128KB head window — read a generous tail chunk too. A record buried mid-file in a
// very large session can escape both windows; Pocket's own renames also land in the
// overlay, so only a deeply-buried code-server rename could lag.
async function readTailLines(file, size, maxBytes = 256 * 1024) {
  const start = Math.max(0, size - maxBytes);
  if (size <= 0 || start === 0) return []; // small file: the head read saw everything
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    return buf.toString('utf8', 0, bytesRead).split('\n').slice(1); // first line is partial
  } finally { await fh.close(); }
}

// titles compose on the way out — the cache keeps raw fields so a rename or a
// settings flip never requires re-reading the transcript.
// titleSync ON: Claude Code's own records win (custom-title = a rename on either
// surface, last one in the file wins — matching their reader), then Pocket's overlay,
// then their ai-title, then the derived title. OFF: overlay then derived, as before.
// 1.19: Claude Code's own ai-title (not a rename) is also used with sync off, ahead of the opening
// request; a session with neither gets Pocket's generated title. dedupeTitle keeps the pre-1.19 key
// for collapsing resume copies, so two different sessions with the same short title never merge.
const composeTitle = m => {
  const ov = smeta[m.id]?.name;
  const live = liveAutoTitle(m.id);
  const named = settings.titleSync ? (m.customTitle || ov || live || m.aiTitle) : (ov || live || m.aiTitle);
  const dedupeTitle = (settings.titleSync ? (m.customTitle || ov || m.aiTitle) : ov) || (m.promptKey ? m.title + '\u0000' + m.promptKey : m.title);
  const untitled = !named && Boolean(m.fromPrompt);
  return { ...m, title: named || (untitled && storedAutoTitle(m.id)) || m.title, untitled, dedupeTitle };
};
async function sessionMeta(file, id) {
  const st = await fsp.stat(file);
  const cached = metaCache.get(file);
  if (cached && cached.mtimeMs === st.mtimeMs) return composeTitle({ ...cached.meta, mtimeMs: st.mtimeMs, size: st.size });
  const acc = { title: null, cwd: null, firstUser: null, customTitle: null, aiTitle: null };
  try {
    for (const line of await readFirstLines(file)) {
      scanMetaLine(line, acc);
      if (acc.cwd && acc.title && acc.firstUser) break;
    }
    // tail pass for title records appended after the head window (later line wins)
    for (const line of await readTailLines(file, st.size)) {
      if (!line.includes('"custom-title"') && !line.includes('"ai-title"')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'custom-title' && o.customTitle) acc.customTitle = o.customTitle;
      if (o.type === 'ai-title' && o.aiTitle) acc.aiTitle = o.aiTitle;
    }
    // Giant early lines (file-history snapshots, queue ops) can push the first real
    // user message past the 128KB head — a head-only verdict would hide a real session.
    // Deep-scan before calling it noise; skip pathological lines, stop at first hit.
    if (!acc.firstUser && !acc.title) {
      const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
      for await (const line of rl) {
        // 1.89: a long line is parsed only when it is a user line (snapshots and queue records are skipped unread)
        if (line.length > 500_000 || (line.length > 128 * 1024 && !line.includes('"type":"user"'))) continue;
        scanMetaLine(line, acc);
        if (acc.firstUser || acc.title) break;
      }
      rl.close();
    }
  } catch { /* unreadable — show what we have */ }
  const { title, cwd, firstUser, customTitle, aiTitle, promptKey, prompt } = acc;
  // noise = no human message and no summary anywhere: hook runs, subagent scratch, warmups
  const meta = { id, title: title || firstUser || '(untitled conversation)', cwd, noise: !firstUser && !title, customTitle, aiTitle, fromPrompt: !title && Boolean(firstUser), promptKey: !title && promptKey || undefined, prompt: !title && prompt || undefined };
  metaCache.set(file, { mtimeMs: st.mtimeMs, meta });
  return composeTitle({ ...meta, mtimeMs: st.mtimeMs, size: st.size });
}

async function listSessions(limit = 60) {
  const out = [];
  let dirs = [];
  try { dirs = await fsp.readdir(PROJECTS_ROOT); } catch { return out; }
  const files = [];
  await Promise.all(dirs.map(async d => {
    const dir = path.join(PROJECTS_ROOT, d);
    let entries; try { entries = await fsp.readdir(dir); } catch { return; }
    for (const f of entries) {
      const id = f.replace(/\.jsonl$/, '');
      if (f.endsWith('.jsonl') && UUID_RE.test(id)) files.push({ file: path.join(dir, f), id });
    }
  }));
  const stats = await Promise.all(files.map(async x => {
    try { return { ...x, mtimeMs: (await fsp.stat(x.file)).mtimeMs }; } catch { return null; }
  }));
  // overshoot the limit: hygiene below drops noise rows and collapses duplicates
  const sorted = stats.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const recent = sorted.slice(0, Math.min(limit * 2, 400));
  for (const x of sorted.slice(recent.length)) if (isPinned(x.id) || turns.has(x.id) || backgroundJobs(x.id).length || extActive(x.id) || followups.list(x.id).length) recent.push(x); // pins never age out
  // read metadata 8 files at a time — a cold cache (every restart) meant up to 400 serial
  // head/tail reads; the dedupe walk below is order-dependent, the reads aren't
  const metas = new Array(recent.length);
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < recent.length) {
      const i = next++; metas[i] = await sessionMeta(recent[i].file, recent[i].id);
      // 1.28: prompt-cache warmth for the tab marks — only the last request matters here, so a short tail
      const c = await cacheFromTranscript(recent[i].file, { maxBytes: 256 * 1024 }).catch(() => null);
      if (c) metas[i] = { ...metas[i], cache: { at: c.at, ttlMs: c.ttlMs, cached: c.cached } };
    }
  }));
  const seen = new Map(); // title+cwd -> listed entry (resumed sessions repeat both)
  for (const [i, x] of recent.entries()) {
    const pinned = isPinned(x.id);
    const meta = metas[i];
    if (meta.cwd?.startsWith('/tmp/') && !pinned) continue; // scratch/test sessions
    const active = turns.has(x.id) || backgroundJobs(x.id).length > 0 || extActive(x.id);
    if (meta.noise && !active && !pinned) continue; // hook/subagent noise: no user message, no summary
    // 1.79: a branch repeats its parent's first message and folder; it is its own conversation, never a resume copy.
    const key = smeta[x.id]?.branchOf ? 'branch\u0000' + x.id : meta.dedupeTitle + '\u0000' + (meta.cwd || '');
    const prev = seen.get(key);
    if (prev && !active && !pinned) { prev.dupes = (prev.dupes || 0) + 1; continue; } // older resume copy
    const entry = { ...meta, noise: undefined, active, pinned: pinned || undefined };
    if (!prev) seen.set(key, entry);
    out.push(entry);
  }
  // pins float; the limit applies to the unpinned remainder so a deep pin can't push
  // recent sessions out (dupes-collapsing needed the full walk anyway)
  const pins = out.filter(e => e.pinned);
  const active = out.filter(e => !e.pinned && e.active);
  return [...pins, ...active, ...out.filter(e => !e.pinned && !e.active).slice(0, Math.max(0, limit - pins.length - active.length))];
}

async function findSessionFile(id) {
  if (!UUID_RE.test(id)) return null;
  let dirs; try { dirs = await fsp.readdir(PROJECTS_ROOT); } catch { return null; }
  for (const d of dirs) {
    const f = path.join(PROJECTS_ROOT, d, id + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return null;
}
function sessionFileSync(id) {
  if (!UUID_RE.test(id)) return null;
  let dirs; try { dirs = fs.readdirSync(PROJECTS_ROOT); } catch { return null; }
  for (const d of dirs) {
    const f = path.join(PROJECTS_ROOT, d, id + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// ---------- transcript normalization ----------
function toolSummary(name, input) {
  if (!input) return name;
  if (name === 'Bash') return input.description || (input.command || '').slice(0, 140);
  if (name === 'Read' || name === 'Write' || name === 'Edit') return input.file_path || '';
  if (name === 'Skill') return input.skill || '';
  if (name === 'Agent' || name === 'Task') return input.description || '';
  if (name === 'WebFetch' || name === 'WebSearch') return input.url || input.query || '';
  try { return JSON.stringify(input).slice(0, 140); } catch { return ''; }
}

// The transcript format drifts across CLI versions — one surprising line must cost
// that line, never the whole session view.
function normalizeLine(o, opts) {
  try { return normalizeLineInner(o, opts); } catch { return null; }
}

// Our attachment block at the end of a message reads back as file chips (name + path, so the client can thumbnail
// images), not raw bracket text. 1.89: a steered message is saved as a queued_command line, so both branches use it.
function splitAttachments(txt) {
  const am = txt.match(/\n\n\[Attached files? — read as needed:\n([\s\S]*?)\n\]\s*$/);
  if (!am) return { text: txt.trim() };
  return { text: txt.slice(0, am.index).trim(), files: am[1].split('\n').filter(Boolean).map(p => ({ n: p.split('/').pop(), p })) };
}

function normalizeLineInner(o, { sidechain = false } = {}) {
  // returns a display message or null. sidechain: reading a subagent's own transcript (1.82), where every line is one.
  if (o.isSidechain && !sidechain) return null;
  // a message steered/queued into a running turn lands as an attachment line, not a user line
  if (o.type === 'attachment' && o.attachment?.type === 'queued_command') {
    // prompt was an array of content blocks in older CLI versions, a plain string in newer ones
    const p = o.attachment.prompt;
    const raw = typeof p === 'string' ? p
      : Array.isArray(p) ? p.filter(b => b?.type === 'text').map(b => b.text).join('\n')
        : '';
    const txt = raw.trim();
    if (!txt || /^\s*<(local-command|command-name|system-remind|task-notification)/.test(txt)) return null;
    return { role: 'user', ...splitAttachments(raw), ts: o.timestamp };
  }
  // 1.83: a built-in slash command (/context, /usage, /compact…) answers in a system line; it is the reply.
  if (o.type === 'system' && o.subtype === 'local_command' && typeof o.content === 'string') {
    const out = o.content.replace(/<\/?local-command-(?:stdout|stderr)>/g, '').trim();
    return out ? { role: 'assistant', blocks: textBlocks(out), ts: o.timestamp } : null;
  }
  if (o.type === 'user') {
    // 1.89: a compaction's summary is written as a user line for the model (isCompactSummary, no isMeta); the owner
    // never sent it. The reader has no note row to say "compacted" with, so the line is left out.
    if (o.isCompactSummary) return null;
    // 1.89: Claude Code 2.1.199+ writes a background task's finish as a plain user line (origin.kind task-notification,
    // no isMeta); hidden as in the queued_command branch above, which shows nothing for it either
    if (o.origin?.kind === 'task-notification') return null;
    const c = o.message?.content;
    let txt = null;
    if (typeof c === 'string') txt = c;
    else if (Array.isArray(c)) {
      if (c.some(b => b.type === 'tool_result')) return null; // tool results ride user lines
      txt = c.filter(b => b.type === 'text').map(b => b.text).join('\n');
    }
    // 1.83: lines the CLI writes for the model (a skill's own instructions, image placeholders) are not the user's;
    // a message from another session and a safety stop notice still show
    if (o.isMeta && !/^\s*(Another Claude session|Your response above was stopped)/.test(txt || '')) return null;
    // 1.83: a slash command is saved as tags; show what was typed (/hello there), not nothing
    const cmd = txt && /^\s*<command-(?:name|message)>/.test(txt) && txt.match(/<command-name>\/?([^<]+)<\/command-name>/);
    if (cmd) { const args = txt.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1].trim(); return { role: 'user', text: '/' + cmd[1].trim() + (args ? ' ' + args : ''), ts: o.timestamp }; }
    if (!txt || !txt.trim() || /^\s*<(local-command|command-name|command-message|system-remind|task-notification)/.test(txt)) return null;
    return { role: 'user', ...splitAttachments(txt), ts: o.timestamp };
  }
  if (o.type === 'assistant') {
    const blocks = [];
    for (const b of o.message?.content || []) {
      if (b.type === 'text' && b.text?.trim()) blocks.push(...textBlocks(b.text)); // a trailing ```choices block → reply buttons
      if (b.type === 'tool_use') {
        // TodoWrite carries the plan — pass the list through so the client can draw a
        // live checklist instead of a truncated JSON blob on a ledger line.
        if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) {
          blocks.push({ t: 'todo', todos: b.input.todos.map(x => ({ c: String(x.content ?? ''), s: String(x.status ?? '') })) });
        } else blocks.push({ t: 'tool', name: b.name, detail: toolSummary(b.name, b.input) });
      }
    }
    return blocks.length ? { role: 'assistant', blocks, ts: o.timestamp } : null;
  }
  return null;
}

async function readTranscript(file, maxMsgs = 400, opts) {
  const msgs = [];
  let total = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const m = normalizeLine(o, opts);
    if (m) { total++; msgs.push(m); if (msgs.length > maxMsgs * 2) msgs.splice(0, msgs.length - maxMsgs); }
  }
  return { msgs: msgs.slice(-maxMsgs), total };
}

// ---------- changed files (what did it do to my code) ----------
// normalizeLine drops old_string/new_string on purpose (ledger lines stay small), so
// the changes view re-reads the .jsonl. Sidechain (subagent) edits are included — they
// touch the code just the same. Ops whose tool_result came back is_error are dropped.
const CHANGE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const CHANGE_CAP = 20_000; // per-string payload bound
async function collectChanges(file) {
  const clip = s => s == null ? null : String(s).slice(0, CHANGE_CAP);
  const recs = []; // {ops:[{path,tool,old,new,all,trunc}], ts, err}
  const byUse = new Map(); // tool_use id -> rec
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'assistant') {
      for (const b of o.message?.content || []) {
        if (b.type !== 'tool_use' || !CHANGE_TOOLS.has(b.name)) continue;
        const inp = b.input || {};
        const p = inp.file_path || inp.notebook_path;
        if (!p) continue;
        const op = (tool, old, nw, all) => ({
          path: p, tool, old: clip(old), new: clip(nw), all: Boolean(all),
          trunc: (old?.length > CHANGE_CAP) || (nw?.length > CHANGE_CAP) || undefined,
        });
        let ops;
        if (b.name === 'MultiEdit' && Array.isArray(inp.edits)) {
          ops = inp.edits.map(e => op('Edit', e.old_string, e.new_string, e.replace_all));
        } else if (b.name === 'Edit') ops = [op('Edit', inp.old_string, inp.new_string, inp.replace_all)];
        else if (b.name === 'Write') ops = [op('Write', null, inp.content)];
        else ops = [op('NotebookEdit', null, inp.new_source)];
        const rec = { ops, ts: o.timestamp, err: false };
        if (b.id) byUse.set(b.id, rec);
        recs.push(rec);
      }
    } else if (o.type === 'user' && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b.type === 'tool_result' && b.is_error && byUse.has(b.tool_use_id)) byUse.get(b.tool_use_id).err = true;
      }
    }
  }
  const files = new Map(); // path -> ops in transcript order
  let failed = 0;
  for (const rec of recs) {
    if (rec.err) { failed += rec.ops.length; continue; }
    for (const op of rec.ops) {
      if (!files.has(op.path)) files.set(op.path, []);
      files.get(op.path).push({ ...op, path: undefined, ts: rec.ts });
    }
  }
  return { files: [...files.entries()].map(([path, ops]) => ({ path, ops })), failed };
}

// ---------- full-text search within one session ----------
function msgSearchText(m) {
  if (m.role === 'user') return m.text || '';
  return (m.blocks || []).map(b =>
    b.t === 'text' ? b.text
      : b.t === 'choices' ? b.options.join('\n')
      : b.t === 'todo' ? b.todos.map(t => t.c).join('\n')
        : `${b.name} ${b.detail || ''}`).join('\n');
}
async function searchTranscript(file, q, maxMatches = 50) {
  const needle = q.toLowerCase();
  const matches = [];
  let total = 0, more = false;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const m = normalizeLine(o);
    if (!m) continue;
    total++;
    const text = msgSearchText(m), lc = text.toLowerCase();
    const at = lc.indexOf(needle);
    if (at < 0) continue;
    if (matches.length >= maxMatches) { more = true; continue; }
    let hits = 0;
    for (let i = at; i >= 0; i = lc.indexOf(needle, i + needle.length)) hits++;
    const s = Math.max(0, at - 120), e = Math.min(text.length, at + needle.length + 240);
    matches.push({
      i: total - 1, role: m.role, ts: m.ts, hits,
      text: (s ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ').trim() + (e < text.length ? '…' : ''),
    });
  }
  return { total, matches, more };
}

// Same matcher, but over already-normalized messages (Codex hands us objects, not a
// file of lines). Keeps one shape of search result for the client's find bar.
function searchMsgs(msgs, q, maxMatches = 50) {
  const needle = q.toLowerCase();
  const matches = [];
  let more = false;
  msgs.forEach((m, i) => {
    const text = msgSearchText(m), lc = text.toLowerCase();
    const at = lc.indexOf(needle);
    if (at < 0) return;
    if (matches.length >= maxMatches) { more = true; return; }
    let hits = 0;
    for (let j = at; j >= 0; j = lc.indexOf(needle, j + needle.length)) hits++;
    const s = Math.max(0, at - 120), e = Math.min(text.length, at + needle.length + 240);
    matches.push({
      i, role: m.role, ts: m.ts, hits,
      text: (s ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ').trim() + (e < text.length ? '…' : ''),
    });
  });
  return { total: msgs.length, matches, more };
}

// ---------- external activity watcher (live mirror of sessions driven elsewhere) ----------
// code-server / terminal sessions write the same transcript files; watching them lets
// the app stream those turns live and light the ember for work started anywhere.
const EXT_ACTIVE_MS = 45_000;
const ownedTranscriptMtime = new Map();
// Transcript size after our last turn (fork guard), kept across restarts so our own
// earlier turns are never mistaken for another app's.
const OWNED_FILE = path.join(DATA_DIR, 'owned-transcripts.json');
const ownedTranscriptSize = new Map((() => { try { return Object.entries(JSON.parse(fs.readFileSync(OWNED_FILE, 'utf8'))); } catch { return []; } })());
function rememberOwnedSize(id, size) {
  ownedTranscriptSize.delete(id); ownedTranscriptSize.set(id, size);
  while (ownedTranscriptSize.size > 500) ownedTranscriptSize.delete(ownedTranscriptSize.keys().next().value);
  try { fs.writeFileSync(OWNED_FILE, JSON.stringify(Object.fromEntries(ownedTranscriptSize)), { mode: 0o600 }); } catch { }
}
const extActivity = new Map(); // sessionId -> last transcript write (ms)
const tailers = new Map();     // sessionId -> Set<{res, offset, rem}>
const dirWatchers = new Map();
function watchDirs() {
  let dirs = []; try { dirs = fs.readdirSync(PROJECTS_ROOT); } catch { return; }
  for (const d of dirs) {
    const dir = path.join(PROJECTS_ROOT, d);
    if (dirWatchers.has(dir)) continue;
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      const w = fs.watch(dir, (_evt, fname) => {
        if (!fname || !fname.endsWith('.jsonl')) return;
        const id = fname.slice(0, -6);
        if (!UUID_RE.test(id)) return;
        if(!turns.has(id)){let mtime;try{mtime=fs.statSync(path.join(dir,fname)).mtimeMs;}catch{}if(mtime===undefined||ownedTranscriptMtime.get(id)!==mtime&&!quietSinceOwned(id,mtime))extActivity.set(id,Date.now());}
        if (tailers.get(id)?.size) pumpTail(id, path.join(dir, fname));
      });
      w.on('error', () => { try { w.close(); } catch { } dirWatchers.delete(dir); });
      dirWatchers.set(dir, w);
    } catch { }
  }
}
watchDirs();
setInterval(watchDirs, 60_000).unref();
const extActive = id => (Date.now() - (extActivity.get(id) || 0)) < EXT_ACTIVE_MS;
// 1.88.1: when its process exits, the CLI appends bookkeeping (cost-state, last-prompt, ai-title) to the
// transcript. Pocket closes a process after an idle hour, or seconds after its reply when a new conversation
// needs the slot under POCKET_MAX_PROCESSES, and that write read as work in another app: the row lost Response
// ready and left Attention. Only a user or assistant line after our last turn counts. Cached per mtime.
const quietCache = new Map(); // sessionId -> { mtimeMs, quiet }
function quietSinceOwned(id, mtimeMs) {
  const owned = ownedTranscriptSize.get(id);
  if (owned === undefined || !mtimeMs) return false;
  const hit = quietCache.get(id);
  if (hit && hit.mtimeMs === mtimeMs) return hit.quiet;
  const quiet = !foreignTurns(id, owned).since;
  quietCache.delete(id); quietCache.set(id, { mtimeMs, quiet });
  while (quietCache.size > 500) quietCache.delete(quietCache.keys().next().value);
  return quiet;
}

// Codex has no per-file signal to watch (its store is a sqlite projection), so the
// equivalent "someone else is working in this thread" hint comes from polling recency.
if (CODEX_ON) {
  codex.pollCodexActivity();
  setInterval(() => codex.pollCodexActivity(), 15_000).unref();
}

const pumping = new Set();
async function pumpTail(id, file) {
  if (pumping.has(id)) return;
  pumping.add(id);
  try {
    const set = tailers.get(id);
    if (!set?.size) return;
    const size = (await fsp.stat(file)).size;
    for (const t of set) {
      if (size <= t.offset) continue;
      const fh = await fsp.open(file, 'r');
      try {
        const buf = Buffer.alloc(size - t.offset);
        await fh.read(buf, 0, buf.length, t.offset);
        let at = t.offset - Buffer.byteLength(t.rem);
        t.offset = size;
        const lines = (t.rem + buf.toString('utf8')).split('\n');
        t.rem = lines.pop() ?? '';
        for (const line of lines) {
          at += Buffer.byteLength(line) + 1; // byte offset just past this line
          if (!line.trim()) continue;
          let o; try { o = JSON.parse(line); } catch { continue; }
          const m = normalizeLine(o);
          // id = transcript offset: a browser reconnect sends it back as Last-Event-ID
          if (m) { try { t.res.write(`id: ${at}\ndata: ${JSON.stringify({ type: m.role === 'user' ? 'user' : 'assistant', msg: m, offset: at })}\n\n`); } catch { } }
        }
      } finally { await fh.close(); }
    }
  } catch { } finally {
    pumping.delete(id);
  }
}

// ---------- session runners and turns ----------
// Each session gets ONE long-lived CLI process (a "runner", 1.7). Messages are written to
// its stdin, a `result` line ends a turn, and the process then waits for the next
// message, keeping its working directory, MCP connections and background jobs. The CLI
// also starts turns by itself (e.g. when a background job finishes), so a turn can begin
// without a message. Runners close after IDLE_CLOSE_MS idle; the next message resumes
// the session from its transcript in a fresh process.
// Runners run DETACHED (own process group, stdout/stderr to files under turnlogs/) and
// PM2 runs this server with --no-treekill, so restarting pocket-claude — even from inside
// one of its own turns (the 2026-08-14 self-kill incident) — doesn't kill them. stdin is
// a named pipe that a tiny keeper process holds open, so a restarted server reattaches
// from the .runner.json marker. Closing a runner = kill the keeper and close our end;
// the CLI then reads EOF and exits 0.
const turns = new Map(); // sessionId -> active turn {pid, events[], subs:Set<res>, cwd, startedAt, runner}
const runners = new Map(); // sessionId -> live CLI process for that session
// 1.64: the live process's background jobs (a Bash command run in the background, a subagent). The CLI
// reports the list on every change; it is empty once the process has exited.
const backgroundJobs = id => { const r = runners.get(id); return r && !r.exited ? r.bgTasks : []; };
const claudeLogin = new ClaudeLogin({
  bin:CLAUDE_BIN, env:spawnEnv(), cwd:HOME,
  busy:() => turns.size > 0,
  prepare:() => {
    for (const runner of runners.values()) {
      if (runner.bgTasks.length) { runner.accountStale = true; writeRunnerMeta(runner); }
      else closeRunner(runner,'account sign-in');
    }
    sideChats.closeAll('account sign-in', 'claude');
  },
  identify:() => readClaudeIdentity(CLAUDE_BIN,spawnEnv()),
  onSuccess:() => { usage.clearAccount(); titleProviders.checkedAt = 0; log('Claude account sign-in completed'); },
});
process.on('exit', () => claudeLogin.dispose());
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { claudeLogin.dispose(); process.exit(0); });
const TURNLOG_DIR = path.join(DATA_DIR, 'turnlogs');
fs.mkdirSync(TURNLOG_DIR, { recursive: true });
// 1.73.2: input pipes live outside the data directory (pipes.mjs); pre-1.73.2 runners keep theirs in turnlogs/.
const PIPES = pipeDirs(DATA_DIR), PIPE_DIR = PIPES.claude;
const turnFiles = id => ({
  out: path.join(TURNLOG_DIR, id + '.out.ndjson'),
  err: path.join(TURNLOG_DIR, id + '.err.log'),
  meta: path.join(TURNLOG_DIR, id + '.turn.json'), // pre-1.7 one-process-per-turn marker
  retry: path.join(TURNLOG_DIR, id + '.retry.json'),
});
// Per-runner files carry a key so a closing process never shares files with its successor.
const runnerFiles = (id, key) => ({
  out: path.join(TURNLOG_DIR, `${id}.${key}.out.ndjson`),
  err: path.join(TURNLOG_DIR, `${id}.${key}.err.log`),
  fifo: path.join(PIPE_DIR, `${id}.${key}.in.fifo`),
  legacyFifo: path.join(TURNLOG_DIR, `${id}.${key}.in.fifo`),
  meta: path.join(TURNLOG_DIR, `${id}.${key}.runner.json`),
});

// ---------- rate-limit auto-continue ----------
// A turn that dies on a usage/rate limit gets rescheduled for just after the reset
// instead of losing the whole overnight window. The pending retry survives server
// restarts via a .retry.json marker (armed again in adoptOrphans).
const RETRY_BUFFER_MS = Number(process.env.POCKET_RETRY_BUFFER_MS ?? 5 * 60_000);
const RETRY_MAX_ATTEMPTS = 6;
const RETRY_MAX_DELAY_MS = 12 * 3600_000;
const RETRY_PROMPT = 'You were interrupted by an API rate limit and were resumed automatically after the reset. '
  + 'Continue the task from where it left off. If the previous request already completed, just say so briefly.';
const retryTimers = new Map(); // sessionId -> timeout
// 1.77.6: the owner's zone (from their browser, else POCKET_TZ, else this box's), named: "6:00 AM EST".
const fmtOwnerTime = ms => { const o = { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }; try { return new Date(ms).toLocaleTimeString('en-US', { ...o, timeZone: ownerZone() || undefined }); } catch { return new Date(ms).toLocaleTimeString('en-US', o); } };

function detectRateLimit(text) {
  if (!/rate.?limit|usage limit|limit reached|overloaded|too many requests|\b429\b/i.test(text)) return null;
  let at = null;
  const epoch = text.match(/\|\s*(\d{10})\b/); // "Claude AI usage limit reached|<epoch>"
  if (epoch) at = Number(epoch[1]) * 1000;
  if (!at) {
    const t = text.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)?/i);
    if (t) { // CLI prints reset in its own (= this box's) local tz
      let h = Number(t[1]);
      if (t[3]) h = h % 12 + (t[3].toLowerCase() === 'pm' ? 12 : 0);
      const d = new Date(); d.setHours(h, Number(t[2] || 0), 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      at = d.getTime();
    }
  }
  if (!at) {
    const ra = text.match(/retry.?after[:\s"]+(\d+)/i);
    if (ra) at = Date.now() + Number(ra[1]) * 1000;
  }
  if (!at || at < Date.now()) at = Date.now() + 3600_000; // unparseable → try in an hour
  return { resetAt: Math.min(at, Date.now() + RETRY_MAX_DELAY_MS) + RETRY_BUFFER_MS };
}

function cancelRetry(sessionId) {
  const t = retryTimers.get(sessionId);
  if (t) { clearTimeout(t); retryTimers.delete(sessionId); }
  try { fs.unlinkSync(turnFiles(sessionId).retry); } catch { }
}
function armRetry(m) {
  clearTimeout(retryTimers.get(m.sessionId));
  retryTimers.set(m.sessionId, setTimeout(() => fireRetry(m), Math.max(5_000, m.at - Date.now())));
}
function scheduleRetry(sessionId, turn, resetAt) {
  const m = {
    sessionId, cwd: turn.cwd, at: resetAt, createdAt: Date.now(), userText: turn.userText,
    model: turn.model || turn.requestedModel || null, effort: turn.effort || null, approvalMode:turn.approvalMode, attempt: (turn.retryAttempt || 0) + 1, fork: turn.runner?.fork || null,
  };
  try { fs.writeFileSync(turnFiles(sessionId).retry, JSON.stringify(m)); } catch { }
  armRetry(m);
  log(`rate limited session=${sessionId} — auto-resume at ${fmtOwnerTime(resetAt)} (attempt ${m.attempt})`);
}
async function fireRetry(m) {
  if (claudeLogin.active && engineForSessionId(m.sessionId) === 'claude') return armRetry({...m,at:Date.now()+15_000});
  retryTimers.delete(m.sessionId);
  try { fs.unlinkSync(turnFiles(m.sessionId).retry); } catch { }
  if (ownedTurn(m.sessionId)) return log(`retry skipped (turn already running) session=${m.sessionId}`);
  if (engineForSessionId(m.sessionId) !== 'claude') { // 1.87: Codex and OpenRouter pick up again the same way
    const id = m.sessionId, body = { model: m.model, effort: m.effort, approvalMode: m.approvalMode };
    try {
      const t = isCx(id) ? await startCodexFromApi({ id, threadId: codex.bareId(id), cwd: m.cwd, text: RETRY_PROMPT, body })
        : await startAcpFromApi({ id, sessionId: acp.bareAcpId(id), cwd: m.cwd, text: RETRY_PROMPT, body, resume: true });
      if (t) t.retryAttempt = m.attempt; // three resumes at most, as on Claude
      log(`auto-resume after usage limit session=${id} attempt=${m.attempt}`);
      pushNotify(id, smeta[id]?.name || `${ENGINES[engineForSessionId(id)].label} conversation`, 'Usage limit reset. Picking the task back up').catch(() => { });
    } catch (e) { log(`auto-resume failed session=${id}: ${e.message}`); }
    return;
  }
  const file = await findSessionFile(m.sessionId);
  try { // the user (or code-server) may have moved the session along during the wait
    if (file && (await fsp.stat(file)).mtimeMs > m.createdAt + 15_000) {
      return log(`retry skipped (session continued elsewhere) session=${m.sessionId}`);
    }
  } catch { }
  try {
    const opts = { sessionId: m.sessionId, cwd: m.cwd, model: m.model, effort: m.effort, approvalMode:approvalMode(m.approvalMode,DEFAULT_APPROVAL_MODE,ALLOW_FULL_ACCESS), retryAttempt: m.attempt };
    if (file) startTurn({ ...opts, resume: true, text: RETRY_PROMPT });
    else startTurn({ ...opts, resume: false, fork: m.fork || undefined, text: m.userText }); // limit hit before the transcript existed (1.79: a branch forks again)
    log(`auto-resume after rate limit session=${m.sessionId} attempt=${m.attempt}`);
    const meta = file ? await sessionMeta(file, m.sessionId).catch(() => null) : null;
    pushNotify(m.sessionId, meta?.title || 'Claude conversation', 'Usage limit reset. Picking the task back up');
  } catch (e) { log(`auto-resume failed session=${m.sessionId}: ${e.message}`); }
}

function broadcast(turn, ev) {
  turn.events.push(ev);
  const data = `id: ${turn.events.length - 1}\ndata: ${JSON.stringify(ev)}\n\n`;
  for (const res of turn.subs) { try { res.write(data); } catch { /* dropped */ } }
}

function spawnEnv() {
  const env = agentEnv(process.env);
  for (const k of Object.keys(env)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k];
  }
  if(cliUpdates.state.providers.claude?.active){env.DISABLE_AUTOUPDATER='1';env.DISABLE_UPDATES='1';}
  return env;
}

const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
// pid-reuse guard: only trust a marker whose pid's cmdline still names this session
const isTurnProc = (pid, id) => commandLine(pid).includes(id); // /proc on Linux, ps on macOS (1.47)
// 1.89 (F-10): and, when the marker recorded them (1.89 on), the same boot and the same process start time, as Codex's
// records have had since 1.73.7: a reused pid has a later start, even when its command line names the session.
const sameRunner = m => Boolean(m?.sessionId && m.pid && m.key) && pidAlive(m.pid) && isTurnProc(m.pid, m.sessionId)
  && (!m.bootId || m.bootId === BOOT_ID) && (!m.procStart || startTime(m.pid) === m.procStart);
function signalTurn(turn, sig = 'SIGTERM') {
  if (turn.pending) return void turn.cancel?.(); // 1.89 (F-8): a reply still waiting for its process ends here
  if (!(turn.pid > 0)) return; // never kill(0): that is Pocket's own process group
  try { process.kill(-turn.pid, sig); } // negative pid = whole (detached) process group
  catch { try { process.kill(turn.pid, sig); } catch { } }
}

function attachClaudeQuestions(turn,sessionId){
  const inputs=new Map();turn.questionInputs=inputs;
  turn.questions=new QuestionInbox({threadId:()=>sessionId,write:(reply,opts)=>{
    if(!turn.stdin||turn.stdin.destroyed||turn.stdin.writableEnded)throw new Error('Question connection closed');
    const input=inputs.get(reply.id);if(!input)throw new Error('Question expired');
    if(opts?.skipped){turn.stdin.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:reply.id,response:{behavior:'deny',message:opts.skipped}}})+'\n');inputs.delete(reply.id);turn.rawRequests?.delete(reply.id);return;}
    const answers=Object.fromEntries(input.questions.map((q,i)=>[q.question,reply.result.answers['question-'+i].answers.join(', ')]));
    turn.stdin.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:reply.id,response:{behavior:'allow',updatedInput:{...input,answers}}}})+'\n');
    inputs.delete(reply.id);turn.rawRequests?.delete(reply.id);
  },onChange:()=>{
    const pending=turn.questions.list().length;
    try{const meta=JSON.parse(fs.readFileSync(turn.files.meta,'utf8'));meta.waitingForInput=Boolean(pending||turn.approvals?.list().length);fs.writeFileSync(turn.files.meta,JSON.stringify(meta),{mode:0o600});}catch{}
    broadcast(turn,{type:'questions'});
    const last=turn.questions.list().at(-1);
    if(pending&&turn.questionNotified!==last.id&&!mutes.has(sessionId)){turn.questionNotified=last.id;pushNotify(sessionId,last.agent?'A subagent has a question':'Claude has a question','Open Pocket Code to answer it.').catch(()=>{});}
    maybeEndControlTurn(turn);
  }});
  turn.approvals=new ApprovalInbox({sessionId:()=>sessionId,turnId:()=>String(turn.startedAt),audit:auditApproval,write:(id,response)=>new Promise((resolve,reject)=>{
    if(!turn.stdin||turn.stdin.destroyed||turn.stdin.writableEnded)return reject(new Error('Approval connection closed'));
    turn.stdin.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:id,response}})+'\n',e=>{if(!e)turn.rawRequests?.delete(id);e?reject(e):resolve();});
  }),onChange:()=>{
    const requests=turn.approvals?.list()||[];
    try{const meta=JSON.parse(fs.readFileSync(turn.files.meta,'utf8'));meta.waitingForApproval=Boolean(requests.length);meta.waitingForInput=Boolean(requests.length||turn.questions.list().length);fs.writeFileSync(turn.files.meta,JSON.stringify(meta),{mode:0o600});}catch{}
    broadcast(turn,{type:'approvals'});
    const last=requests.at(-1);
    if(last&&turn.approvalNotified!==last.id&&!mutes.has(sessionId)){turn.approvalNotified=last.id;pushNotify(sessionId,last.agent?'A subagent is waiting for your OK':'Waiting for your OK','Open Pocket Code to review the pending action.').catch(()=>{});}
    maybeEndControlTurn(turn);
  },onAutoError:(e,{tool})=>log(`trusted action reply not delivered session=${sessionId} tool=${tool}: ${e.message}`)});
}
// 1.83: the slash commands the Claude CLI reports on its init line, so the / picker offers only the built-ins this CLI
// has and the plugin skills that are not on disk. The newest report wins; null until a reply has started.
let cliSlash = null;
function handleTurnLine(turn, line) {
  let o; try { o = JSON.parse(line); } catch { return; }
  if (o.type === 'system' && o.subtype === 'init' && Array.isArray(o.slash_commands)) cliSlash = o.slash_commands.filter(n => typeof n === 'string' && n && !n.startsWith('_'));
  const usageEvent = turn.runner?.accountStale && o.type === 'rate_limit_event' ? null : usage.observe(turn.sessionId, o);
  if (usageEvent) broadcast(turn, { type: 'usage', kind: usageEvent.kind });
  // 1.28: the turn's first request shows whether it resumed from a warm cache or wrote it again
  if (o.type === 'assistant' && !o.parent_tool_use_id && o.message?.usage && o.message.model !== '<synthetic>' && turn.cacheFirst === undefined) turn.cacheFirst = turnCacheSummary(o.message.usage);
  // 1.89 (F-19): a background subagent's own output (parent_tool_use_id set) is not the agent replying; the stand-in stays one.
  if (turn.controlOnly && ['assistant', 'stream_event', 'result'].includes(o.type) && !o.parent_tool_use_id) turn.controlOnly = false; // the agent is replying: a real turn now
  if(o.type==='control_request'){
    // 1.82: the asking subagent's name, and the request itself so a reply that ends while it waits can carry it over.
    const agent=o.request?.subtype==='can_use_tool'?askingAgent(turn,o.request.tool_use_id):null;
    if(o.request?.subtype==='can_use_tool'&&o.request_id!=null)(turn.rawRequests??=new Map()).set(o.request_id,o);
    if(o.request?.subtype==='can_use_tool'&&o.request.tool_name==='AskUserQuestion'&&turn.questions){
      const input=o.request.input;const questions=Array.isArray(input?.questions)?input.questions.map((q,i)=>({id:'question-'+i,header:q.header,question:q.question,options:q.options,multiple:q.multiSelect})):[];
      turn.questionInputs.set(o.request_id,input);
      if(turn.questions.receive({id:o.request_id,method:'item/tool/requestUserInput',params:{threadId:turn.sessionId,turnId:String(turn.startedAt),isBlocking:true,questions}},String(turn.startedAt),{agent}))return;
      turn.questionInputs.delete(o.request_id);
    }
    if(o.request?.subtype==='can_use_tool'&&o.request.tool_name!=='AskUserQuestion'&&typeof o.request.tool_name==='string'&&o.request.input&&typeof o.request.input==='object'&&turn.approvals){
      const tool=o.request.tool_name;
      // 1.56: in Review actions only, a request matching a trusted rule is answered Allow and audited, no card.
      const rule=turn.approvalMode==='review'?matchTrusted(trustedRules(),tool,o.request.input):null;
      if(rule&&turn.approvals.autoAllow({nativeId:o.request_id,turnId:String(turn.startedAt),kind:'tool',title:'Allow '+tool+'?',details:{tool,cwd:turn.cwd,input:o.request.input},allow:{behavior:'allow',updatedInput:o.request.input},deny:{behavior:'deny',message:'The user denied this action. Do not run it through another tool.'},rule,tool})){turn.rawRequests?.delete(o.request_id);log(`trusted action allowed session=${turn.sessionId} tool=${tool} rule=${JSON.stringify(rule)}`);return;}
      if(turn.approvals.receive({nativeId:o.request_id,turnId:String(turn.startedAt),kind:'tool',title:'Allow '+tool+'?',details:{tool,cwd:turn.cwd,input:o.request.input},allow:{behavior:'allow',updatedInput:o.request.input},deny:{behavior:'deny',message:'The user denied this action. Do not run it through another tool.'},agent}))return;
    }
    turn.rawRequests?.delete(o.request_id);
    if(turn.stdin&&!turn.stdin.destroyed)turn.stdin.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:o.request_id,response:{behavior:'deny',message:'This interactive request is not supported in Pocket Code.'}}})+'\n');
    return;
  }
  if(o.type==='control_cancel_request'){turn.rawRequests?.delete(o.request_id);turn.questions?.resolve(o.request_id);turn.approvals?.resolve(o.request_id);return;}
  if (o.type === 'stream_event') {
    const ev = o.event;
    if (!o.parent_tool_use_id && ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
      broadcast(turn, { type: 'delta', text: ev.delta.text });
    }
  } else if (o.type === 'assistant') {
    const m = normalizeLine(o);
    if (m) broadcast(turn, { type: 'assistant', msg: m });
  } else if (o.type === 'result') {
    broadcast(turn, {
      type: 'result', ok: o.subtype === 'success',
      error: o.subtype !== 'success' ? (o.result || o.subtype) : null,
      cost: turnCost(turn, o.total_cost_usd), duration_ms: o.duration_ms, cache: turn.cacheFirst || null,
    });
    // The turn is over but the process stays up for the next message. Legacy pre-1.7
    // turns (no runner) still close stdin so their process exits as before.
    if (turn.runner) finalizeTurn(turn.sessionId, turn, 0);
    else try { turn.stdin?.end(); } catch { }
  }
}

// 1.78.1: the CLI's total_cost_usd is its process's running total, so in a process reused across turns every
// later reply showed the cost of all the earlier ones too. A turn costs the difference from the last total that
// process reported (kept in its runner marker, so a restarted daemon carries on). A process adopted from before
// 1.78.1 has no baseline: its next reply shows no cost rather than a wrong one.
function carryRequests(r, carry) {
  if (!r || !carry.length || r.turn || r.exited || r.closing) return;
  const next = beginTurn(r, { autonomous: true, controlOnly: true });
  log(`turn start (${carry.length} request(s) carried from the ended reply) session=${r.sessionId} pid=${r.pid}`);
  for (const o of carry) handleTurnLine(next, JSON.stringify(o));
  maybeEndControlTurn(next);
}
function turnCost(turn, total) {
  const spent = Number(total);
  if (total == null || !Number.isFinite(spent)) return null;
  const r = turn.runner;
  if (!r) return spent; // pre-1.7: one process per turn
  const before = r.spent;
  r.spent = spent; writeRunnerMeta(r);
  if (!Number.isFinite(before)) return null;
  return spent >= before ? Math.round((spent - before) * 1e6) / 1e6 : spent;
}

function drainTurnLog(turn) {
  try {
    const size = fs.statSync(turn.files.out).size;
    if (size <= turn.tailOffset) return;
    const fh = fs.openSync(turn.files.out, 'r');
    try {
      const buf = Buffer.alloc(size - turn.tailOffset);
      fs.readSync(fh, buf, 0, buf.length, turn.tailOffset);
      turn.tailOffset = size;
      const lines = (turn.tailRem + buf.toString('utf8')).split('\n');
      turn.tailRem = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) handleTurnLine(turn, l);
    } finally { fs.closeSync(fh); }
  } catch { /* log file briefly absent — next tick */ }
}

// Pre-1.7 turns (one process per turn) still running when this version starts: stream
// them to the end, as before.
function trackTurn(sessionId, turn) {
  turns.set(sessionId, turn);
  turn.tailOffset = 0; turn.tailRem = '';
  turn.tailTimer = setInterval(() => drainTurnLog(turn), 300);
}

// 1.89: procStart and bootId prove the pid is still this process on adoption (F-10); closing marks one being closed, which
// a restart stops rather than adopts (F-10); outOffset is how far its output has been handled, so a restart replays what
// the CLI printed while Pocket was down, e.g. a turn it ran by itself when a background job finished (F-9).
// `strict` rethrows a failed write: a process Pocket could not record is not started (F-11).
function writeRunnerMeta(r, { strict = false } = {}) {
  const t = r.turn;
  const meta = {
    sessionId: r.sessionId, cliBin:r.cliBin||null, pid: r.pid, keeperPid: r.keeperPid, key: r.key, cwd: r.cwd, startedAt: r.startedAt,
    procStart: r.procStart || null, bootId: BOOT_ID, closing: Boolean(r.closing), outOffset: Number.isFinite(r.doneOffset) ? r.doneOffset : null,
    model: r.model, effort: r.effort, approvalMode: r.approvalMode, runnerToken: r.runnerToken || null, policyKey: r.policyKey || '',
    turn: t ? { startedAt: t.startedAt, userText: t.userText, offset: t.offset, autonomous: Boolean(t.autonomous) } : null,
    bgTasks: r.bgTasks, accountStale: Boolean(r.accountStale), spent: Number.isFinite(r.spent) ? r.spent : null,
    waitingForInput: Boolean(t && (t.questions?.list().length || t.approvals?.list().length || t.inputUnavailable || t.approvalUnavailable)),
    waitingForApproval: Boolean(t?.approvals?.list().length || t?.approvalUnavailable),
  };
  try { atomicWrite(r.files.meta, meta); r.metaFailed = false; }
  catch (e) {
    if (strict) throw e;
    if (!r.metaFailed) log(`session process marker not written session=${r.sessionId} pid=${r.pid}: ${e.message}`);
    r.metaFailed = true;
  }
}

// Keep the number of live CLI processes under MAX_PROCESSES by closing the longest-idle
// one (no turn, no background job). Never refuses the new process.
function reclaimProcess() {
  if (!(MAX_PROCESSES > 0)) return;
  const live = runners.size + (CODEX_ON ? codex.codexSessions.size : 0) + (ACP_ON ? acp.acpSessions.size : 0);
  if (live < MAX_PROCESSES) return;
  const idle = [
    ...[...runners.values()].filter(x => !x.turn && !x.bgTasks.length && !x.closing && !x.exited).map(x => ({ at: x.lastLineAt, close: () => closeRunner(x, 'process limit') })),
    ...(CODEX_ON ? [...codex.codexSessions.values()].filter(s => !s.turn && !s.closing && !s.exited).map(s => ({ at: s.lastActivityAt, close: () => codex.closeCodexSession(s, 'process limit') })) : []),
    ...(ACP_ON ? [...acp.acpSessions.values()].filter(s => !acp.acpTurnActive(s.sessionId)).map(s => ({ at: s.lastActivityAt || 0, close: () => acp.closeAcpSession(s.sessionId) })) : []),
  ].sort((a, b) => a.at - b.at);
  if (idle[0]) idle[0].close();
}
function spawnRunner({ sessionId, cwd, resume, fork, model, effort, mode }) {
  reclaimProcess();
  const policy = claudePermissionSettings(mode);
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', policy.permissionMode, '--permission-prompt-tool', 'stdio'];
  if (model && MODELS.has(model)) args.push('--model', model);
  const extra = pocketInstructions('claude', sessionId);
  if (extra) args.push('--append-system-prompt', extra);
  const ctx = claudePolicyLaunch(model); // 1.92: the context limit and subagent model, in --settings env (it outranks ~/.claude/settings.json)
  args.push('--settings', JSON.stringify({ permissions: policy.permissions, ...(effort && EFFORTS.has(effort) ? { effortLevel: effort } : {}), ...(ctx.key ? { env: ctx.env } : {}) }));
  // 1.79 Branch: a new saved session, with this id, that starts with everything in `fork`; that transcript is only read.
  if (fork) args.push('--resume', fork, '--fork-session', '--session-id', sessionId);
  else args.push(resume ? '--resume' : '--session-id', sessionId);
  const key = Date.now().toString(36);
  const files = runnerFiles(sessionId, key);
  for (const file of [files.out, files.err]) { fs.writeFileSync(file, '', { mode: 0o600 }); fs.chmodSync(file, 0o600); }
  ensurePipeDir(PIPE_DIR, PIPES.top);
  execFileSync('mkfifo', ['-m', '600', files.fifo]);
  // O_RDWR never blocks on a FIFO, and while it is open the read end opens without blocking too.
  const hold = fs.openSync(files.fifo, fs.constants.O_RDWR);
  const inFd = fs.openSync(files.fifo, 'r');
  const outFd = fs.openSync(files.out, 'a'), errFd = fs.openSync(files.err, 'a');
  // 1.39: a runner token in the process environment ties a pocket-vault call from inside this session to it.
  const runnerToken = randomBytes(16).toString('hex');
  const proc = spawn(CLAUDE_BIN, args, { cwd, env: { ...spawnEnv(), POCKET_SESSION_ID: sessionId, POCKET_RUNNER_TOKEN: runnerToken }, detached: true, stdio: [inFd, outFd, errFd] });
  fs.closeSync(inFd); fs.closeSync(outFd); fs.closeSync(errFd);
  proc.unref();
  // The keeper holds a write end across server restarts and exits when the CLI does.
  const keeper = spawn('sh', ['-c', 'while kill -0 "$1" 2>/dev/null; do sleep 5; done', 'pocket-keeper', String(proc.pid)], { detached: true, stdio: ['ignore', hold, 'ignore'], env: agentEnv(process.env) });
  keeper.unref();
  const writer = fs.createWriteStream(null, { fd: hold });
  writer.on('error', () => { });
  const r = {
    sessionId, key, cliBin: CLAUDE_BIN, pid: proc.pid, keeperPid: keeper.pid, writer, cwd, model, effort, approvalMode: mode, files, runnerToken, fork: fork || null, policyKey: ctx.key,
    startedAt: Date.now(), turn: null, bgTasks: [], lastLineAt: Date.now(), tailOffset: 0, tailRem: '', doneOffset: 0, spent: 0, procStart: startTime(proc.pid),
  };
  // 1.89 (F-11): the marker is written before the first prompt. A process Pocket could not record would outlive a restart
  // unmanaged (neither adopted nor stopped), so when the write fails the CLI and its keeper are killed and the start refused.
  try { writeRunnerMeta(r, { strict: true }); }
  catch (e) {
    r.exited = true; proc.on('error', () => { });
    signalGroup(keeper.pid, 'SIGKILL'); signalGroup(proc.pid, 'SIGKILL');
    try { writer.destroy(); } catch { }
    for (const f of [files.fifo, files.meta + '.tmp', files.out, files.err]) { try { fs.unlinkSync(f); } catch { } }
    log(`session process refused session=${sessionId} pid=${proc.pid}: its marker could not be written (${e.message})`);
    throw Object.assign(new Error(`Pocket Code could not record the Claude process on disk, so it did not start it (${e.code || e.message}). Check the server's free disk space, then send again.`), { code: 500 });
  }
  runners.set(sessionId, r);
  r.tailTimer = setInterval(() => drainRunnerLog(r), 300);
  proc.on('exit', code => onRunnerExit(r, code));
  proc.on('error', () => onRunnerExit(r, -1));
  log(`session process start session=${sessionId} resume=${!!resume}${fork ? ` fork=${fork}` : ''} pid=${proc.pid} cwd=${cwd}`);
  return r;
}

// controlOnly (1.82): a stand-in for a reply, opened to hold a permission request or question that arrived while no
// reply was running (a background subagent asked). It ends as soon as nothing is waiting; output turns it into a reply.
// 1.89 (F-8): `into` is a reply that waited for its process (waitingTurn); it keeps its events, viewers and inboxes.
function beginTurn(r, { userText = '', retryAttempt, autonomous = false, offset, controlOnly = false, into = null }) {
  let size = r.tailOffset; try { size = fs.statSync(r.files.out).size; } catch { }
  const turn = Object.assign(into || { events: [], subs: new Set(), queue: [], rawRequests: new Map(), startedAt: Date.now() }, {
    sessionId: r.sessionId, runner: r, pid: r.pid, stdin: r.writer, cwd: r.cwd,
    userText, model: r.model, effort: r.effort, retryAttempt, approvalMode: r.approvalMode,
    files: r.files, offset: offset ?? size, autonomous, controlOnly, baseline: descendantCpu(r.pid).pids,
  });
  if (!into) attachClaudeQuestions(turn, r.sessionId);
  clearTimeout(r.idleTimer);
  r.turn = turn;
  turns.set(r.sessionId, turn);
  r.lastLineAt = Date.now();
  writeRunnerMeta(r);
  return turn;
}

function handleRunnerLine(r, line, lineOffset) {
  r.lastLineAt = Date.now();
  let o; try { o = JSON.parse(line); } catch { return; }
  if (o.type === 'system' && o.subtype === 'background_tasks_changed') {
    r.bgTasks = Array.isArray(o.tasks) ? o.tasks : [];
    writeRunnerMeta(r); // a restart must know a job is still running (no idle close, release asks first)
    if (!r.turn) scheduleIdle(r);
    if (r.accountStale && !r.bgTasks.length) startAfterJobs(r.sessionId, r.cwd);
  }
  if (r.skipControlBefore && lineOffset < r.skipControlBefore && (o.type === 'control_request' || o.type === 'control_cancel_request')) {
    // A request from before the restart: the old daemon may or may not have answered it.
    // Deny it so the CLI carries on (a second response to an answered request is ignored
    // and a denied tool is simply re-requested — both verified on CLI 2.1.281).
    if (o.type === 'control_request' && o.request_id && r.writer && !r.writer.destroyed) {
      try { r.writer.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: o.request_id, response: { behavior: 'deny', message: 'Pocket Code restarted while this request was waiting. Request it again if it is still needed.' } } }) + '\n'); log(`denied a pre-restart ${o.request?.tool_name || 'control'} request session=${r.sessionId}`); } catch { }
    }
    return;
  }
  let turn = r.turn;
  if (!turn) {
    // The CLI started a turn by itself, e.g. to report a finished background job.
    // 1.82: a permission request or question with no reply running comes from a background subagent. Dropping it
    // left the agent waiting forever (and the conversation "working in background" with nothing to see).
    const control = o.type === 'control_request' && o.request?.subtype === 'can_use_tool';
    // 1.89 (F-19): a background subagent's output (parent_tool_use_id set) opens no reply: the conversation stays Working
    // in background and a typed message starts a turn of its own instead of steering into the subagent's.
    const wakes = control || ((o.type === 'assistant' || o.type === 'stream_event') && !o.parent_tool_use_id) || (o.type === 'system' && o.subtype === 'init');
    // 1.89 (F-8): a closing process whose successor's reply is already waiting must not take that reply's place.
    if (!wakes || r.exited || (r.closing && turns.has(r.sessionId))) return;
    turn = beginTurn(r, { autonomous: true, offset: lineOffset, controlOnly: control });
    log(control ? `turn start (a background job asked for permission) session=${r.sessionId} pid=${r.pid}` : `turn start (started by the agent) session=${r.sessionId} pid=${r.pid}`);
    // Viewers in transcript-mirror mode resync on `done` and attach to this live turn.
    for (const t of tailers.get(r.sessionId) || []) { try { t.res.write('data: {"type":"done"}\n\n'); t.res.end(); } catch { } }
  }
  handleTurnLine(turn, line);
  maybeEndControlTurn(turn);
}
// A control-only turn with nothing waiting any more is over: the conversation goes back to Working in background.
function maybeEndControlTurn(turn) {
  if (!turn?.controlOnly || turn.finalized || turn.questions?.list().length || turn.approvals?.list().length) return;
  finalizeTurn(turn.sessionId, turn, 0).catch(e => log(`control turn close failed session=${turn.sessionId}: ${e.message}`));
}
// 1.82: which subagent asked. The request carries only its tool_use id; the agent's own transcript is where that id
// is written, so the match is read from the session's subagents directory (null when the parent itself asked).
const subagentIndex = new SubagentIndex();
function sessionAgentDir(id, runner) {
  if (runner && runner.sessionFile === undefined) runner.sessionFile = sessionFileSync(id);
  const file = runner ? runner.sessionFile : sessionFileSync(id);
  return file ? subagentDir(file, id) : null;
}
function askingAgent(turn, toolUseId) {
  if (!toolUseId) return null;
  try { return subagentIndex.agentFor(sessionAgentDir(turn.sessionId, turn.runner), toolUseId)?.name || null; } catch { return null; }
}

function drainRunnerLog(r) {
  try {
    const size = fs.statSync(r.files.out).size;
    if (size <= r.tailOffset) return;
    const fh = fs.openSync(r.files.out, 'r');
    try {
      const buf = Buffer.alloc(size - r.tailOffset);
      fs.readSync(fh, buf, 0, buf.length, r.tailOffset);
      const text = r.tailRem + buf.toString('utf8');
      let at = r.tailOffset - Buffer.byteLength(r.tailRem);
      r.tailOffset = size;
      const lines = text.split('\n');
      r.tailRem = lines.pop() ?? '';
      for (const l of lines) {
        const lineOffset = at; at += Buffer.byteLength(l) + 1;
        r.doneOffset = at; // 1.89 (F-9): a marker written while this line is handled counts it as handled
        if (l.trim()) handleRunnerLine(r, l, lineOffset);
      }
    } finally { fs.closeSync(fh); }
  } catch { /* log file briefly absent — next tick */ }
}

function scheduleIdle(r) {
  clearTimeout(r.idleTimer);
  if (r.turn || r.closing || r.exited || !(IDLE_CLOSE_MS > 0)) return;
  if (r.bgTasks.length) return; // re-armed when the CLI reports its background jobs are done
  r.idleTimer = setTimeout(() => { if (!r.turn && !r.bgTasks.length) closeRunner(r, 'idle'); }, IDLE_CLOSE_MS);
}

// `waiting`: a reply is waiting for this process to go (startTurn), so the close uses the short steps (escalateClose).
function closeRunner(r, why, { waiting = false } = {}) {
  if (r.closing || r.exited) return;
  r.closing = true;
  clearTimeout(r.idleTimer);
  log(`session process closing session=${r.sessionId} pid=${r.pid} reason=${why}`);
  try { process.kill(-r.keeperPid, 'SIGTERM'); } catch { try { process.kill(r.keeperPid, 'SIGTERM'); } catch { } }
  try { r.writer?.end(); } catch { } // last write end closed → the CLI reads EOF and exits 0
  writeRunnerMeta(r); // 1.89 (F-10): a restart stops a closing process instead of adopting it
  escalateClose(r, waiting ? RUNNER_CLOSE_STEP_MS : RUNNER_CLOSE_GRACE_MS);
}
// 1.89 (F-8): a closing process that has not exited on EOF gets SIGTERM, and SIGKILL RUNNER_CLOSE_STEP_MS later, both to
// its process group (its MCP servers and tools go with it), as Codex sessions and Vault runs do. It used to get one SIGTERM
// after 30 s, so a CLI that ignored it ran on beside its replacement for good. An ordinary close (idle, process limit,
// sign-in change) keeps the 30 s grace before SIGTERM, for SessionEnd hooks, MCP shutdowns and the last transcript
// write; when a reply is waiting for the process to go, SIGTERM comes one step after EOF. A shorter call replaces a
// longer schedule; one whose SIGTERM is already sent keeps its SIGKILL.
const RUNNER_CLOSE_STEP_MS = 3000, RUNNER_CLOSE_GRACE_MS = 30_000;
function escalateClose(r, wait = RUNNER_CLOSE_STEP_MS) {
  const due = Date.now() + wait;
  if (r.exited || (r.termDue && r.termDue <= due)) return;
  r.termDue = due; clearTimeout(r.forceTimer);
  const step = (sig, then) => {
    if (r.exited || !r.procStart || startTime(r.pid) !== r.procStart) return; // gone, or not provably this process (no start time)
    log(`session process still running after ${sig === 'SIGTERM' ? 'EOF' : 'SIGTERM'}; sending ${sig} session=${r.sessionId} pid=${r.pid}`);
    signalTurn(r, sig); then?.();
  };
  r.forceTimer = setTimeout(() => step('SIGTERM', () => { r.forceTimer = setTimeout(() => step('SIGKILL'), RUNNER_CLOSE_STEP_MS); }), wait);
}
// Resolves when the process has exited (onRunnerExit).
const runnerGone = r => r.exited ? Promise.resolve() : (r.gone ??= new Promise(resolve => { r.goneResolve = resolve; }));

function onRunnerExit(r, code) {
  if (r.exited) return;
  r.exited = true;
  r.goneResolve?.();
  clearInterval(r.tailTimer); clearInterval(r.pollTimer); clearTimeout(r.idleTimer); clearTimeout(r.forceTimer);
  drainRunnerLog(r);
  if (runners.get(r.sessionId) === r) runners.delete(r.sessionId);
  try { r.writer?.destroy(); } catch { }
  try { process.kill(-r.keeperPid, 'SIGTERM'); } catch { }
  for (const f of [r.files.fifo, r.files.meta]) { try { fs.unlinkSync(f); } catch { } }
  log(`session process exit session=${r.sessionId} pid=${r.pid} code=${code}`);
  if (r.turn) finalizeTurn(r.sessionId, r.turn, code);
  else if (r.accountStale) startAfterJobs(r.sessionId, r.cwd); // its jobs ended with it
}

function stallCheck() {
  if (!(STALL_MS > 0)) return; // 0 = never stop a turn for being quiet
  for (const r of runners.values()) {
    const t = r.turn;
    if (!t || r.exited || t.stopped || t.stalled) continue;
    const { pids, cpu } = descendantCpu(r.pid);
    let ticks = 0;
    for (const p of pids) if (!t.baseline.has(p)) ticks += cpu.get(p) || 0;
    if (t.cpuTicks === undefined || ticks > t.cpuTicks + 100) t.cpuBusyAt = Date.now(); // >1s of CPU since last check
    t.cpuTicks = ticks;
    const quietFor = Date.now() - Math.max(r.lastLineAt, t.cpuBusyAt || 0);
    if (quietFor < STALL_MS || r.bgTasks.length) continue;
    if (t.questions?.list().length || t.approvals?.list().length) continue;
    t.stalled = true;
    log(`turn STALLED session=${r.sessionId} quiet=${Math.round(quietFor / 60_000)}min — stopping`);
    signalTurn(r);
  }
}
setInterval(stallCheck, Math.min(60_000, Math.max(250, STALL_MS / 4))).unref();

// Turns another app (code-server, a terminal) added to the transcript after `from`.
// Title and summary records don't count — only user/assistant messages.
function foreignTurns(sessionId, from) {
  const file = sessionFileSync(sessionId);
  if (!file) return { since: false, recentAt: 0 };
  let size; try { size = fs.statSync(file).size; } catch { return { since: false, recentAt: 0 }; }
  const start = from === undefined ? Math.max(0, size - 65536) : Math.min(from, size);
  let since = from !== undefined && size < from, recentAt = 0;
  if (size > start) {
    const fh = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(Math.min(size - start, 4 << 20));
      fs.readSync(fh, buf, 0, buf.length, size - buf.length);
      for (const l of buf.toString('utf8').split('\n')) {
        let o; try { o = JSON.parse(l); } catch { continue; }
        if (o.type !== 'user' && o.type !== 'assistant') continue;
        if (from !== undefined) since = true;
        const at = Date.parse(o.timestamp || '') || 0;
        if (at > recentAt) recentAt = at;
      }
    } finally { fs.closeSync(fh); }
  }
  return { since, recentAt };
}

// The CLI stamps headless (-p) turns entrypoint:"sdk-cli", and the vscode extension
// (>=2.1.239) hides sdk-* sessions from its session picker — but ours are the user's real
// sessions, not automation, so restamp them "cli". The patch is byte-length-preserving
// ("sdk-cli" -> "cli" + 4 trailing spaces, still valid JSON) and written in place at
// the found offsets, so a concurrently-appending CLI or a tail reader with a saved
// offset is never disturbed.
const SDK_STAMP = Buffer.from('"entrypoint":"sdk-cli"');
const CLI_STAMP = Buffer.from('"entrypoint":"cli"    ');
async function restampEntrypoint(sessionId, from = 0) {
  try {
    const file = await findSessionFile(sessionId);
    if (file) await restampFile(file, from);
  } catch (e) { log(`entrypoint restamp failed session=${sessionId}: ${e.message}`); }
}
// Lines before `from` were stamped after an earlier turn (or never came from us), so only
// the bytes appended since then are read — transcripts run to tens of MB.
async function restampFile(file, from = 0) {
  const size = (await fsp.stat(file)).size;
  const start = Math.max(0, Math.min(Number(from) || 0, size) - SDK_STAMP.length);
  if (size <= start) return false;
  const fh = await fsp.open(file, 'r+');
  try {
    const buf = Buffer.alloc(size - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    const offs = [];
    for (let i = buf.indexOf(SDK_STAMP); i >= 0 && i < bytesRead; i = buf.indexOf(SDK_STAMP, i + 1)) offs.push(start + i);
    for (const at of offs) await fh.write(CLI_STAMP, 0, CLI_STAMP.length, at);
    return offs.length > 0;
  } finally { await fh.close(); }
}

async function finalizeTurn(sessionId, turn, code) {
  if (turn.finalized) return;
  turn.finalized = true;
  const r = turn.runner;
  if (r && r.turn === turn) r.turn = null; // later lines from the process belong to the next turn
  // 1.82: requests still waiting when a reply ends came from a background subagent, which keeps waiting for them.
  // They move to a control-only turn so they stay answerable; Stop, an exit or a stall withdraws them as before.
  const carry = r && !r.exited && !r.closing && !turn.stopped && !turn.stalled && code === 0 ? [...(turn.rawRequests?.values() || [])] : [];
  turn.questions?.clear();
  turn.approvals?.clear();
  turn.finalizeDone = new Promise(resolve => { turn.finalizeResolve = resolve; });
  if (turn.controlOnly) { // a stand-in for a reply: no outcome, no title, no queue, no notification
    try {
      broadcast(turn, { type: 'done' });
      for (const res of turn.subs) { try { res.end(); } catch { } }
      if (turns.get(sessionId) === turn) turns.delete(sessionId);
      if (r && !r.exited) { writeRunnerMeta(r); scheduleIdle(r); }
      log(`turn done (background job's request answered) session=${sessionId}`);
      carryRequests(r, carry);
    } finally { turn.finalizeResolve?.(); }
    return;
  }
  try {
  await restampEntrypoint(sessionId, ownedTranscriptSize.get(sessionId) ?? 0);
  try{const file=await findSessionFile(sessionId);if(file){const st=await fsp.stat(file);ownedTranscriptMtime.set(sessionId,st.mtimeMs);rememberOwnedSize(sessionId,st.size);}}catch{}
  extActivity.delete(sessionId);
  clearInterval(turn.tailTimer); clearInterval(turn.pollTimer);
  if (!r) drainTurnLog(turn);
  let stderrTail = '';
  try { stderrTail = fs.readFileSync(turn.files.err, 'utf8').slice(-500); } catch { }
  if (turn.stalled && !turn.events.some(e => e.type === 'result')) {
    broadcast(turn, { type: 'result', ok: false, error: `Stopped: no activity for ${Math.round(STALL_MS / 60_000)} minutes` });
    log(`turn STALL-STOPPED session=${sessionId}`);
  } else if (turn.stopped && !turn.events.some(e => e.type === 'result')) {
    broadcast(turn, { type: 'result', ok: false, error: 'Stopped by you' });
    log(`turn STOPPED session=${sessionId}`);
  } else if (code !== 0 && !turn.events.some(e => e.type === 'result')) {
    broadcast(turn, { type: 'result', ok: false, error: `claude exited ${code}: ${stderrTail}` });
    log(`turn FAIL session=${sessionId} code=${code} stderr=${stderrTail.slice(-300)}`);
  } else {
    log(`turn done session=${sessionId} code=${code} events=${turn.events.length}`);
  }
  // rate-limit auto-continue: schedule a resume for just after the reset
  let retryAt = null;
  if (!turn.stopped && !followups.list(sessionId).length && (turn.retryAttempt || 0) < RETRY_MAX_ATTEMPTS) {
    const failed = turn.events.find(e => e.type === 'result' && !e.ok);
    if (failed) {
      const rl = detectRateLimit(`${failed.error || ''} ${stderrTail}`);
      if (rl) { retryAt = rl.resetAt; broadcast(turn, { type: 'retry', at: retryAt }); }
    }
  }
  const settled = recordOutcome(sessionId, turn, [...turn.events].reverse().find(e => e.type === 'result'), retryAt);
  retitler.request(sessionId); // 1.29.1: does the title still fit?
  const watching = turn.subs.size > 0;
  broadcast(turn, { type: 'done' });
  for (const res of turn.subs) { try { res.end(); } catch { } }
  if (turns.get(sessionId) === turn) turns.delete(sessionId);
  if (!r) { try { fs.unlinkSync(turn.files.meta); } catch { } }
  else if (!r.exited) { writeRunnerMeta(r); scheduleIdle(r); }
  if (retryAt) scheduleRetry(sessionId, turn, retryAt); // after turns.delete — cancelRetry in startTurn
  // Drain one saved follow-up at a time; each entry gets its own turn.
  // 1.89.2: not while background jobs hold the process on the earlier login (it drains when they finish). A message held
  // for them starts even after a failed reply: that reply ran on the earlier login (its usage limit, say), the message won't.
  const head = followups.list(sessionId)[0];
  if (!turn.stopped && head?.status === 'pending' && !staleJobs(sessionId).length && (head.afterJobs || [...turn.events].reverse().find(e=>e.type==='result')?.ok)) {
    // 1.89 (F-16): a background agent's request still waiting moves into the reply the queued message starts on the same
    // process (its answer goes to that process); with no such reply it gets its stand-in turn as below.
    runNextFollowup(sessionId, turn.cwd).then(next => {
      if (!carry.length) return;
      if (next && next.runner === r && r.turn === next && !next.finalized) { for (const o of carry) handleTurnLine(next, JSON.stringify(o)); log(`${carry.length} request(s) carried into the queued reply session=${sessionId}`); }
      else carryRequests(r, carry);
    }, e => { log(`queue start failed session=${sessionId}: ${e.message}`); carryRequests(r, carry); });
    return;
  }
  if (!turn.stopped) autoKeepTurnFiles(sessionId, turn.startedAt || 0);
  carryRequests(r, carry);
  // 1.64: a reply that leaves background jobs running is not done. The CLI starts a turn by itself when
  // they finish, and that turn's end sends the notification; a push now would say Done too early.
  if (!watching && !turn.stopped && r && !r.exited && r.bgTasks.length) log(`notification held: ${r.bgTasks.length} background job(s) still running session=${sessionId}`);
  else if (!watching && !turn.stopped && !settled) {
    const result = turn.events.find(e => e.type === 'result');
    // 1.59: plain words; the cost and time stay after "Ready" for the owner who wants them.
    const body = retryAt ? `Usage limit reached. Picks up again at ${fmtOwnerTime(retryAt)}`
      : !result ? 'Stopped'
        : !result.ok ? 'Something went wrong. Tap to see what happened'
          : assistantOn() ? 'Ready' // 1.60: no meters in Assistant mode
          : `Ready${result.cost != null ? ` · $${result.cost.toFixed(2)}` : ''}${result.duration_ms ? ` · ${Math.round(result.duration_ms / 1000)}s` : ''}`;
    findSessionFile(sessionId)
      .then(f => f ? sessionMeta(f, sessionId) : null)
      .then(m => pushNotify(sessionId, m?.title || 'Claude conversation', body))
      .catch(() => { });
  }
  } finally { turn.finalizeResolve?.(); }
}

// 1.61: after a reply, keep the files it handed over (named in its text since the turn started) in Files, once each.
const AUTO_KEEP_RE = /\.(pdf|docx|pptx|xlsx|csv|html?|md|png|jpe?g|gif|webp)$/i;
async function autoKeepTurnFiles(sessionId, since, msgs = null) {
  if (!autoKeepOn()) return;
  try {
    resultCache.delete(sessionId);
    const { results } = msgs ? collectResults(msgs) : await sessionResults(sessionId);
    for (const r of results) {
      if (r.kind !== 'file' || !r.inText || !AUTO_KEEP_RE.test(r.target) || !(Date.parse(r.at || 0) >= since - 2000)) continue;
      let real; try { real = await documentSource(r.target); } catch { continue; }
      if (docs.documents.some(d => !d.trashedAt && d.session === sessionId && d.source === real)) continue;
      const d = docs.addFromPath(real, { session: sessionId, addedBy: 'session', source: real });
      log(`document auto-kept from session ${sessionId}: ${d.id} ${d.file}`);
    }
  } catch (e) { log(`auto-keep failed session=${sessionId}: ${e.message}`); }
}

// 1.67: what Settings shows for automatic model choice: on/off and where that comes from, the provider, whether a key
// is set (never the key), and each level's own choice beside what it runs now.
function routerView() {
  const c = routerConfig(), offered = routerOffered(), cap = maxEffort();
  return { enabled: c.enabled, enabledSource: c.enabledSource, provider: c.provider, providers: ROUTER_PROVIDERS, keySource: c.keySource, active: router.on,
    maxEffort: cap, last: router.last, levels: TIERS.map(t => ({ key: t.key, label: t.label, about: t.about,
      chosen: c.levels?.[t.key] || null, auto: tierChoice(t.key, offered, cap), runs: tierChoice(t.key, offered, cap, c.levels) })) };
}

function promptText(text, attachments) {
  let prompt = text;
  if (attachments?.length) {
    prompt += '\n\n[Attached file' + (attachments.length > 1 ? 's' : '') + ' — read as needed:\n'
      + attachments.join('\n') + '\n]';
  }
  return prompt;
}
const userJSON = text => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n';
// mid-turn steering: another user message written to the process's stdin during a turn
// is delivered at the next model boundary (verified 2026-08-16). Since 1.7 stdin stays
// open between turns, so a message must not be written once the turn is finishing — the
// idle CLI would run it as a new, unlabeled turn.
// 1.76.1: a steered message no longer waits behind a pending question. Claude Code (and Codex) hold steered input
// until the question is answered, so a person who typed instead of answering got no reply and no sign why (Damon,
// 2026-10-22: 33 minutes). After the message is written, each blocking question gets its no-answer reply; Claude reads
// the skip note as the tool result and the message beside it, in the same turn (checked against the real CLI).
const QUESTION_SKIPPED = 'The user skipped these questions without answering and sent a message instead; it follows. Respond to that message. Ask again later only if you still need the answers.';
function skipQuestions(questions) {
  try { return questions?.skipBlocking(QUESTION_SKIPPED) || 0; }
  catch (e) { log(`question skip failed: ${e.message}`); return 0; }
}
function steerTurn(turn, text) {
  if (turn.finalized || turn.stopped || turn.stalled) return false;
  if (!turn.stdin || turn.stdin.destroyed || turn.stdin.writableEnded) return false;
  try { turn.stdin.write(userJSON(text)); } catch { return false; }
  return true;
}

function startTurn({ sessionId, cwd, text, resume, fork, model, effort, attachments, retryAttempt,approvalMode:requestedMode, replaceStale = false }) {
  if (claudeLogin.active) throw Object.assign(new Error('Claude account sign-in is in progress. Finish or cancel it in Accounts & instance.'), {code:409});
  if (turns.has(sessionId)) throw Object.assign(new Error('busy'), { code: 409 });
  cancelRetry(sessionId); // a manually-started turn supersedes any pending auto-resume
  if (resume) text = coordNotice(sessionId, text); // 1.99
  if (resume && cwd && !fs.existsSync(cwd)) cwd = HOME; // 1.98: a queued or retried reply whose folder went away
  let modelFallback;
  // 1.62: in Assistant mode a conversation remembers the model and effort it was given (by the router, or by Try
  // harder), since the person never picks one and every later reply arrives as "default".
  if (assistantOn()) {
    const asked = model && model !== 'default', kept = smeta[sessionId]?.routed;
    if (asked) { if (kept?.model !== model || kept?.effort !== effort) setSmeta(sessionId, { routed: { model, effort: effort && effort !== 'default' ? effort : null } }); }
    else if (kept?.model) { model = kept.model; if (!effort || effort === 'default') effort = kept.effort || effort; }
  }
  ({ model, effort, modelFallback } = withDefaults('claude', { model, effort }));
  if (modelFallback) log(`model fallback session=${sessionId} requested=${modelFallback.requested} reason=${modelFallback.reason} using=${modelFallback.used}`);
  const mode=approvalMode(requestedMode,DEFAULT_APPROVAL_MODE,ALLOW_FULL_ACCESS);
  let r = runners.get(sessionId), old = null;
  if (r) {
    // 1.89.1: a background job kept this process on the earlier login at a sign-in change. The refusal names the jobs and
    // says how to go on; a send that asks to replace the process (Stop background jobs and send) closes it, which ends the
    // jobs with it, and the reply waits for it to exit like any other replaced process. A job that never ends by itself (a
    // `tail -f` watcher) used to hold the conversation on the earlier login for good.
    if (r.accountStale && r.bgTasks.length) {
      if (!replaceStale) throw staleLoginRefusal(r.bgTasks);
      log(`stopping ${r.bgTasks.length} background job(s) on the earlier Claude login session=${sessionId}`);
    }
    // A process can only carry on if nothing it was started with has changed, and if no
    // other app added turns since ours (its in-memory history would fork the transcript).
    const why = r.closing || r.exited ? 'closing' : r.accountStale ? 'account sign-in changed'
      : r.cliBin !== CLAUDE_BIN && !r.bgTasks.length ? 'CLI updated' : r.cwd !== cwd ? 'workspace changed' : r.model !== model ? 'model changed'
        : r.effort !== effort ? 'effort changed' : r.approvalMode !== mode ? 'permissions changed'
          : !r.bgTasks.length && (r.policyKey || '') !== claudePolicyLaunch(model).key ? 'context policy changed' // 1.92
          : foreignTurns(sessionId, ownedTranscriptSize.get(sessionId)).since ? 'continued in another app' : null;
    if (why) { if (why !== 'closing') closeRunner(r, why, { waiting: true }); else escalateClose(r); old = r; r = null; }
  }
  const reused = Boolean(r);
  // 1.89 (F-8): a process that could not be reused is still closing. Its replacement starts once it has exited (at most
  // the close's SIGTERM and SIGKILL steps later), so two CLIs never run on one conversation; the reply is registered now,
  // so a second message steers into it or queues as usual.
  const waitFor = !r && old && !old.exited ? old : null;
  if (!r && !waitFor) r = spawnRunner({ sessionId, cwd, resume, fork: resume ? undefined : fork, model, effort, mode });
  const turn = waitFor ? waitingTurn({ sessionId, cwd, text, attachments, retryAttempt, resume, fork: resume ? undefined : fork, model, effort, mode }, waitFor)
    : beginTurn(r, { userText: text, retryAttempt });
  if (modelFallback) { turn.modelFallback = { ...modelFallback, message: fallbackText(modelFallback) }; broadcast(turn, { type: 'note', text: turn.modelFallback.message }); }
  if (waitFor) { log(`turn start session=${sessionId} process=new (once pid=${waitFor.pid} has exited) cwd=${cwd}`); return turn; }
  try { r.writer.write(userJSON(promptText(text, attachments))); } catch { }
  log(`turn start session=${sessionId} process=${reused ? 'reused' : 'new'} pid=${r.pid} cwd=${cwd}`);
  return turn;
}

function staleLoginRefusal(tasks) {
  const jobs = jobList(tasks);
  const n = jobs.length, named = jobs.slice(0, 3).map(j => j.description).join('; ') + (n > 3 ? `; and ${n - 3} more` : '');
  return Object.assign(new Error(`This conversation is still on the earlier Claude login because ${n === 1 ? 'a background job is' : `${n} background jobs are`} running (${named}). Stop ${n === 1 ? 'it' : 'them'} and send to continue on the current account, or wait until ${n === 1 ? 'it finishes' : 'they finish'}.`),
    { code: 409, reason: 'account_stale_jobs', jobs });
}
// 1.89.2: the background jobs keeping a conversation's process on the earlier Claude login (none once they have finished).
const staleJobs = id => { const r = runners.get(id); return r && r.accountStale && !r.exited && !r.closing ? r.bgTasks : []; };
const jobList = tasks => tasks.map(t => ({ id: String(t.task_id || ''), description: String(t.description || t.task_type || 'Background job').slice(0, 200) }));
// 1.89.2: a message sent while background jobs held the conversation on the earlier login waits in the queue (afterJobs) and
// starts on the current login once they have finished or their process has gone. The CLI usually reports a finished job in
// a reply of its own first; that reply's end starts the message (finalizeTurn), so this waits a moment and steps aside then.
const AFTER_JOBS_GRACE_MS = Math.max(0, Number(process.env.POCKET_AFTER_JOBS_GRACE_MS ?? 5000));
function startAfterJobs(id, cwd) {
  if (!followups.list(id)[0]?.afterJobs) return;
  setTimeout(() => {
    const head = followups.list(id)[0];
    if (!head?.afterJobs || head.status !== 'pending' || ownedTurn(id) || staleJobs(id).length) return;
    log(`background jobs on the earlier Claude login are done; starting the message held for them session=${id}`);
    runNextFollowup(id, cwd).catch(e => log(`queue start failed session=${id}: ${e.message}`));
  }, AFTER_JOBS_GRACE_MS).unref();
}
// After a restart: a held message whose process ended while Pocket was down starts now; one still held waits for its jobs.
function resumeAfterJobs() {
  for (const id of new Set(followups.rows.filter(x => x.afterJobs && x.status === 'pending').map(x => x.sessionId))) {
    if (!staleJobs(id).length) startAfterJobs(id, runners.get(id)?.cwd);
  }
}

// 1.89 (F-8): a reply waiting for the conversation's closing process to exit. It is in `turns` (viewers attach, a second
// message steers into it: the text waits in `held` and follows the prompt), and Stop ends it before any process starts.
// When the old process has gone, or the close's steps have run out, the new one is spawned and the reply moves onto it.
function waitingTurn({ sessionId, cwd, text, attachments, retryAttempt, resume, fork, model, effort, mode }, old) {
  const held = [];
  const turn = {
    sessionId, runner: null, pending: true, pid: null, events: [], subs: new Set(), queue: [], rawRequests: new Map(), cwd,
    startedAt: Date.now(), userText: text, model, effort, retryAttempt, approvalMode: mode, files: {}, offset: 0, autonomous: false, controlOnly: false, baseline: new Set(),
    stdin: { destroyed: false, writableEnded: false, write: s => { held.push(s); return true; } },
  };
  attachClaudeQuestions(turn, sessionId);
  turns.set(sessionId, turn);
  // 1.89 (F-8): the text also waits in the follow-up queue (held, first in line, not shown while this reply waits),
  // so a restart in the wait runs it as the next message (resumeHeldReplies) instead of dropping it; the route has already
  // answered 202. It leaves the queue when the reply starts, is stopped, or fails to start.
  let row = null;
  try { row = followups.hold(sessionId, { text, cwd, attachments, model, effort, approvalMode: mode }); }
  catch (e) { log(`waiting reply not saved to the queue session=${sessionId}: ${e.message}`); }
  const unhold = () => { if (!row) return; try { followups.discard(row.id); } catch (e) { log(`held reply not removed from the queue session=${sessionId}: ${e.message}`); } row = null; };
  turn.cancel = () => {
    if (!turn.pending) return;
    turn.pending = false; unhold();
    log(`turn stopped before its process started session=${sessionId}`);
    finalizeTurn(sessionId, turn, null).catch(e => log(`turn close failed session=${sessionId}: ${e.message}`));
  };
  const steps = new Promise(resolve => setTimeout(resolve, 3 * RUNNER_CLOSE_STEP_MS));
  Promise.race([runnerGone(old), steps]).then(() => {
    if (!turn.pending) return;
    turn.pending = false; unhold();
    let r;
    // 1.89 (F-8): anything that throws here fails the reply and releases the conversation (sends and Stop work
    // again), and a process already spawned for it is closed; before, the reply stayed "running" with no process for good.
    try {
      if (!old.exited) log(`session process still running after SIGKILL session=${sessionId} pid=${old.pid}; starting its replacement anyway`);
      r = spawnRunner({ sessionId, cwd, resume, fork, model, effort, mode });
      beginTurn(r, { userText: text, retryAttempt, into: turn });
      try { r.writer.write(userJSON(promptText(text, attachments))); for (const s of held) r.writer.write(s); } catch { }
      log(`turn start session=${sessionId} process=new pid=${r.pid} cwd=${cwd} (the closing process has exited)`);
    } catch (e) {
      try {
        log(`turn start failed session=${sessionId}: ${e.message}`);
        if (r) closeRunner(r, 'start failed');
        broadcast(turn, { type: 'result', ok: false, error: e.message });
      } catch { }
      return finalizeTurn(sessionId, turn, -1).catch(e2 => { log(`turn close failed session=${sessionId}: ${e2.message}`); if (turns.get(sessionId) === turn) turns.delete(sessionId); });
    }
  });
  return turn;
}
// After a restart: a reply that was waiting for its conversation's closing process (held in the queue, first in line) starts
// now, as the next message would, once any process the restart stopped for that conversation has gone (at most the stop's
// two steps). A start that fails marks the row for review, as any queued message does.
function resumeHeldReplies() {
  for (const id of new Set(followups.rows.filter(x => x.held && x.status === 'pending').map(x => x.sessionId))) {
    const head = followups.list(id)[0]; if (!head?.held || head.status !== 'pending') continue;
    const stopped = strayStops.get(id) || [], until = Date.now() + 3 * RUNNER_CLOSE_STEP_MS;
    const go = () => {
      if (stopped.some(pidAlive) && Date.now() < until) return void setTimeout(go, 200);
      if (ownedTurn(id)) return; // a reply is running after all; the queue drains when it ends
      log(`starting the reply that was waiting when Pocket stopped session=${id}`);
      runNextFollowup(id, head.cwd && fs.existsSync(head.cwd) ? head.cwd : undefined).catch(e => log(`held reply start failed session=${id}: ${e.message}`));
    };
    go();
  }
}

// Another app (code-server, a terminal) wrote a turn to this session moments ago and may
// still be working: refuse rather than run two agents on one transcript.
const FOREIGN_BUSY_MS = 45_000;
function busyElsewhere(sessionId) {
  if (turns.has(sessionId)) return false;
  const { recentAt } = foreignTurns(sessionId, ownedTranscriptSize.get(sessionId));
  return Date.now() - recentAt < FOREIGN_BUSY_MS;
}

// Reattach session processes (and pre-1.7 turns) that survived a server restart; sweep
// stale logs.
// 1.89 (F-10): a live session process a restart does not adopt (an older duplicate, or one that was closing). Its keeper
// and its process group get SIGTERM, and SIGKILL one step later if the same process is still there; its marker and pipe go.
const strayStops = new Map(); // sessionId -> pids stopped at boot, which a held reply waits out (resumeHeldReplies)
function stopStrayRunner(m, files, full, kept) {
  log(`stopping session process session=${m.sessionId} pid=${m.pid} (${kept ? `pid ${kept.pid} is newer` : 'it was closing'})`);
  strayStops.set(m.sessionId, [...(strayStops.get(m.sessionId) || []), m.pid]);
  const start = m.procStart || startTime(m.pid);
  if (new RegExp(`pocket-keeper[\\s\\0]${m.pid}(\\D|$)`).test(commandLine(m.keeperPid))) signalGroup(m.keeperPid, 'SIGTERM'); // still this CLI's keeper
  signalGroup(m.pid, 'SIGTERM');
  setTimeout(() => { if (pidAlive(m.pid) && startTime(m.pid) === start) { log(`session process still running after SIGTERM; sending SIGKILL session=${m.sessionId} pid=${m.pid}`); signalGroup(m.pid, 'SIGKILL'); } }, RUNNER_CLOSE_STEP_MS).unref();
  for (const x of [full, files.fifo, files.legacyFifo]) { try { fs.unlinkSync(x); } catch { } }
}
function adoptOrphans() {
  let entries = []; try { entries = fs.readdirSync(TURNLOG_DIR); } catch { return; }
  // 1.89 (F-10): one process per conversation. Of the live markers for a session (a closing process outlived its
  // replacement's start before 1.89), the newest is adopted and the others are stopped; so is one that was closing with no
  // reply in flight. Each must still be the process the marker recorded (sameRunner).
  const keep = new Map();
  for (const f of entries) {
    if (!f.endsWith('.runner.json')) continue;
    let m; try { m = JSON.parse(fs.readFileSync(path.join(TURNLOG_DIR, f), 'utf8')); } catch { continue; }
    if (!sameRunner(m) || (m.closing && !m.turn)) continue;
    const k = keep.get(m.sessionId);
    if (!k || (Number(m.startedAt) || 0) > (Number(k.startedAt) || 0)) keep.set(m.sessionId, { f, pid: m.pid, startedAt: m.startedAt });
  }
  for (const f of entries) {
    const full = path.join(TURNLOG_DIR, f);
    if (f.endsWith('.runner.json')) {
      let m; try { m = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { try { fs.unlinkSync(full); } catch { } continue; }
      const files = runnerFiles(m.sessionId, m.key);
      if (m.sessionId && keep.get(m.sessionId)?.f !== f && sameRunner(m)) stopStrayRunner(m, files, full, keep.get(m.sessionId));
      else if (keep.get(m.sessionId)?.f === f) {
        let writer = null;
        if (!fs.existsSync(files.fifo) && fs.existsSync(files.legacyFifo)) files.fifo = files.legacyFifo; // started before 1.73.2
        try { writer = fs.createWriteStream(null, { fd: fs.openSync(files.fifo, fs.constants.O_RDWR) }); writer.on('error', () => { }); } catch { }
        let size = 0; try { size = fs.statSync(files.out).size; } catch { }
        const r = {
          sessionId: m.sessionId, cliBin:m.cliBin||(cliUpdates.state.providers.claude?.active?null:CLAUDE_BIN), key: m.key, pid: m.pid, keeperPid: m.keeperPid, writer, cwd: m.cwd, model: m.model, effort: m.effort,
          approvalMode: m.approvalMode || 'full', files, startedAt: m.startedAt || Date.now(), turn: null, bgTasks: Array.isArray(m.bgTasks) ? m.bgTasks : [], accountStale: m.accountStale === true, runnerToken: typeof m.runnerToken === 'string' ? m.runnerToken : null, policyKey: typeof m.policyKey === 'string' ? m.policyKey : '', spent: Number.isFinite(m.spent) ? m.spent : undefined,
          // 1.89 (F-9): with no reply in flight, the output is read again from where the last marker said it was handled
          // (outOffset), not from its end: a turn the CLI ran by itself while Pocket was down (a background job finished) is
          // opened and finished as it would have been live, so its transcript lines count as Pocket's, not another app's,
          // and its background-job list is current. Markers from before 1.89 have no offset and start at the end as before.
          lastLineAt: Date.now(), tailOffset: m.turn ? Math.min(m.turn.offset || 0, size) : Number.isFinite(m.outOffset) ? Math.min(m.outOffset, size) : size, tailRem: '', adopted: true,
          skipControlBefore: size, // requests answered (or lost) before the restart can't be answered now
          procStart: m.procStart || startTime(m.pid),
        };
        r.doneOffset = r.tailOffset;
        runners.set(m.sessionId, r);
        if (m.turn) {
          const turn = beginTurn(r, { userText: m.turn.userText, autonomous: m.turn.autonomous, offset: r.tailOffset });
          turn.startedAt = m.turn.startedAt || turn.startedAt;
          // With the pipe back, pending requests are denied and the turn carries on; only a
          // process we can no longer write to is left waiting on an answer that can't come.
          Object.assign(turn, { adopted: true, inputUnavailable: !writer && Boolean(m.waitingForInput) && !m.waitingForApproval, approvalUnavailable: !writer && Boolean(m.waitingForApproval) });
          writeRunnerMeta(r); // beginTurn wrote the marker before the flags existed; a second restart must still see them
        }
        if (!writer) { // can't send to it any more: drop the keeper so the CLI reads EOF after this turn
          log(`adopted session process without input pipe session=${m.sessionId} — it closes after this turn`);
          r.closing = true;
          try { process.kill(-m.keeperPid, 'SIGTERM'); } catch { }
          r.forceTimer = setTimeout(() => { if (!r.exited && !r.turn) signalTurn(r); }, 30_000);
        }
        r.tailTimer = setInterval(() => drainRunnerLog(r), 300);
        setImmediate(() => drainRunnerLog(r)); // the replay lands before the first message can be sent (F-9)
        r.pollTimer = setInterval(() => { if (!pidAlive(r.pid)) onRunnerExit(r, null); }, 1000);
        if (!r.turn) scheduleIdle(r);
        log(`adopted session process session=${m.sessionId} pid=${m.pid} turn=${Boolean(m.turn)}`);
      } else {
        try { process.kill(-m.keeperPid, 'SIGTERM'); } catch { }
        for (const x of [full, files.fifo, files.legacyFifo]) { try { fs.unlinkSync(x); } catch { } }
        if (m.sessionId) log(`session process ended while server was down session=${m.sessionId}`);
      }
    } else if (f.endsWith('.turn.json')) {
      let m; try { m = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { try { fs.unlinkSync(full); } catch { } continue; }
      if (m.sessionId && m.pid && pidAlive(m.pid) && isTurnProc(m.pid, m.sessionId)) {
        const turn = {
          sessionId:m.sessionId,inputUnavailable:Boolean(m.waitingForInput)&&!m.waitingForApproval,approvalUnavailable:Boolean(m.waitingForApproval)||m.approvalMode==='review',approvalMode:m.approvalMode||'full',pid: m.pid, adopted: true, events: [], subs: new Set(), cwd: m.cwd,
          startedAt: m.startedAt || Date.now(), userText: m.userText, queue: [], files: turnFiles(m.sessionId),
        };
        trackTurn(m.sessionId, turn);
        turn.pollTimer = setInterval(() => { if (!pidAlive(turn.pid)) finalizeTurn(m.sessionId, turn, null); }, 1000);
        log(`adopted in-flight turn session=${m.sessionId} pid=${m.pid}`);
      } else {
        try { fs.unlinkSync(full); } catch { }
        if (m.sessionId) log(`orphan turn finished while server was down session=${m.sessionId}`);
      }
    } else if (f.endsWith('.retry.json')) { // pending rate-limit resume survives restarts
      let m; try { m = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { try { fs.unlinkSync(full); } catch { } continue; }
      if (m.sessionId && m.at) { armRetry(m); log(`re-armed auto-resume session=${m.sessionId} at ${fmtOwnerTime(m.at)}`); }
      else { try { fs.unlinkSync(full); } catch { } }
    }
  }
  // Sweep logs and pipes no live process is using.
  const live = new Set([...runners.values()].map(r => `${r.sessionId}.${r.key}.`));
  for (const f of fs.readdirSync(TURNLOG_DIR)) {
    const full = path.join(TURNLOG_DIR, f);
    if ([...live].some(p => f.startsWith(p))) continue;
    if (f.endsWith('.in.fifo')) { try { fs.unlinkSync(full); } catch { } continue; }
    if (/\.(out\.ndjson|err\.log)$/.test(f)) {
      try { if (Date.now() - fs.statSync(full).mtimeMs > 48 * 3600_000) fs.unlinkSync(full); } catch { }
    }
  }
  let pipes = []; try { pipes = fs.readdirSync(PIPE_DIR); } catch { }
  for (const f of pipes) if (f.endsWith('.in.fifo') && ![...live].some(p => f.startsWith(p))) { try { fs.unlinkSync(path.join(PIPE_DIR, f)); } catch { } }
}
adoptOrphans();

// ---------- app ----------
const app = express();
// Express 4 does not catch a rejected promise from an async handler; without this every
// such rejection is an unhandled rejection. Route it to the error handler below instead.
for (const verb of ['get', 'post', 'patch', 'delete']) {
  const orig = app[verb].bind(app);
  app[verb] = (p, ...hs) => hs.length ? orig(p, ...hs.map(h => typeof h !== 'function' || h.length >= 4 ? h
    : (req, res, next) => { try { const r = h(req, res, next); if (r && typeof r.catch === 'function') r.catch(next); } catch (e) { next(e); } })) : orig(p);
}
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  // No inline scripts, no third-party hosts: everything the app needs is same-origin.
  // img-src 'self' also stops agent-written Markdown from loading a remote image (a
  // prompt-injected turn could otherwise exfiltrate text through an image URL).
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
    "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
    `frame-ancestors 'self'${FRAME_ANCESTORS.length ? ' ' + FRAME_ANCESTORS.join(' ') : ''}`,
  ].join('; '));
  next();
});
app.use(express.json({ limit: '2mb' }));
// 1.60: the installed app's name follows Assistant mode (Pocket Assistant), so a seat's home-screen icon says so.
const MANIFEST = (() => { try { return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'public', 'manifest.webmanifest'), 'utf8')); } catch { return null; } })();
app.get('/manifest.webmanifest', (_req, res, next) => {
  if (!MANIFEST) return next();
  const m = assistantOn() ? { ...MANIFEST, name: 'Pocket Assistant', short_name: 'Pocket Assistant', description: 'Your assistant for email, documents, quotes and everyday work' } : MANIFEST;
  res.setHeader('Cache-Control', 'no-cache'); res.type('application/manifest+json').send(JSON.stringify(m));
});
app.use(express.static(path.join(import.meta.dirname, 'public'), { index: 'index.html', maxAge: '5m',
  setHeaders(res, file) { if (['index.html', 'sw.js'].includes(path.basename(file))) res.setHeader('Cache-Control', 'no-cache'); },
}));

app.post('/api/login', async (req, res) => {
  const ip = await clientAddress(req); // 1.89 (S-6)
  if (rateLimited(ip)) return res.status(429).json({ error: 'too many attempts' });
  const given = String(req.body?.password || '');
  const digest = s => createHash('sha256').update(s, 'utf8').digest();
  if (timingSafeEqual(digest(PASSWORD), digest(given))) {
    res.setHeader('Set-Cookie', `pc_auth=${makeCookie()}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${90 * 24 * 3600}`);
    return res.json({ ok: true });
  }
  loginFailed(ip);
  log(`login FAIL from ${ip}`);
  res.status(403).json({ error: 'wrong password' });
});

// 1.20.1: a signed-out browser asks this first; answering 200 { ok: false } keeps the console free of a 401 error.
// 1.73.3: signed out, the reply names only the mode (the sign-in page says Pocket Assistant or Pocket Code); which modules are on is for the owner.
app.get('/api/me', async (req, res) => { const ok = checkCookie(getCookie(req, 'pc_auth')) || await accessSignIn(req, res); if (ok) { learnPublicUrl(req); learnTimezone(req.query.tz); } return res.json({ ok, features: ok ? { coordination: coordLive(), projects: Boolean(settings.projects), documents: Boolean(settings.documents), tasks: Boolean(settings.tasks), inbox: Boolean(settings.inbox), vault: vaultLive(), assistantMode: assistantOn(), assistantLocked } : { assistantMode: assistantOn() } }); });

// One list, both providers. Codex threads carry their own recency and titles, so the
// merge is just a sort — pins still float, and a Codex failure never costs the Claude
// list (the phone should degrade to half the sessions, not to an error screen).
function stateFor(s) {
  const cx = codex.isCodexId(s.id), ac = isAcpId(s.id);
  const turn = ac ? acp.ownedAcpTurn(s.id) : cx ? codex.codexTurns.get(codex.bareId(s.id)) : turns.get(s.id);
  let retryAt = null;
  if (retryTimers.has(s.id)) { // 1.87: every engine's usage-limit wait, not only Claude's
    try { retryAt = JSON.parse(fs.readFileSync(turnFiles(s.id).retry, 'utf8')).at; } catch { }
  }
  const queue=shownQueue(s.id);
  if(turn?.approvalUnavailable)return {kind:'input',label:'Approval connection interrupted',confirmed:true,approvals:1,queued:queue.length};
  const approvals=turn?.approvals?.list()||[];
  if(approvals.length)return {kind:'input',label:approvals.some(a=>a.status==='uncertain')?'Approval delivery uncertain':'Needs approval',confirmed:true,approvals:approvals.length,questions:turn.questions?.list().length||0,startedAt:turn.startedAt,queued:queue.length};
  if(turn?.inputUnavailable)return {kind:'input',label:'Question interrupted · review needed',confirmed:true,questions:1,queued:queue.length};
  const questions=turn?.questions?.list()||[];
  if(questions.length)return {kind:'input',label:questions.some(q=>q.blocking)?'Needs your answer':'Working · answer requested',confirmed:true,startedAt:turn.startedAt,queued:queue.length,questions:questions.length};
  const outcome=smeta[s.id]?.outcome;
  const quietSince=!cx && !ac && !turn && outcome && s.mtimeMs > outcome.at + 5000 && quietSinceOwned(s.id, s.mtimeMs);
  const state=sessionState({ turn: turn ? {...turn,queue} : null, external: ac ? false : cx ? codex.codexExtActive(codex.bareId(s.id)) : extActive(s.id),
    retryAt, outcome, mtimeMs:s.mtimeMs, background: cx || ac ? [] : backgroundJobs(s.id), quietSince });
  if(queue.length&&!turn && state.kind!=='failed')return {kind:'waiting',label:queue[0].status==='uncertain'?'Queue needs review':'Queue paused',queued:queue.length,confirmed:true};
  return {...state,...(queue.length?{queued:queue.length}:{})};
}
function recordOutcome(id, turn, result, retryAt = null) {
  const kind = retryAt ? 'waiting' : turn.stopped ? 'stopped' : result?.ok ? 'finished' : result ? 'failed' : 'ended';
  const labels = { waiting: 'Waiting for usage reset', stopped: 'Stopped', finished: 'Response ready', failed: 'Didn\'t finish', ended: 'Stopped' };
  // 1.19: a failed turn keeps its reason, so the conversation can say what went wrong after a reload.
  const error = kind === 'failed' && result?.error ? String(result.error).slice(0, 300) : null;
  // 1.101: the reply to a wrap-up request (Mark resolved, Remind me …, No thanks) is reviewed as it finishes, on every
  // device, so it never lands in Attention; nor is a push sent for it. Returns whether it was.
  const at = Date.now(), settled = kind === 'finished' && !turn.autonomous && !turn.controlOnly && wrapUpRequest(turn.userText)
    && replyAsksNothing(turn.events.filter(e => e.type === 'assistant').map(e => e.msg));
  try { setSmeta(id, { outcome: { kind, label: labels[kind], at, ...(retryAt ? { retryAt } : {}), ...(error ? { error } : {}) }, ...(settled ? { seen: Math.max(at, smeta[id]?.seen || 0) } : {}) }); }
  catch (e) { log(`outcome not saved session=${id}: ${e.message}`); return false; }
  if (settled) log(`wrap-up reply marked reviewed session=${id}`);
  return settled;
}
// The title a row shows: a rename, else the agent's own title, else Pocket's generated one, else
// the opening request. Scheduled runs show their job name and are marked automated. request: ask
// for a generated title when the row has none (recent sessions only, one model call at a time).
const TITLE_WINDOW_MS = 14 * 86400_000;
function finishTitle(s, request = false) {
  const out = { ...s, untitled: undefined, dedupeTitle: undefined, fromPrompt: undefined, promptKey: undefined, prompt: undefined }; // prompt: the generator's input, server-side only
  if (smeta[s.id]?.name) return out;
  const a = automation(s.title);
  if (a.automated) return { ...out, automated: true, title: a.title || s.title };
  const live = liveAutoTitle(s.id); // 1.29.1: an updated title, ahead of the agent's own
  if (live) return { ...out, title: live };
  // 1.79: a branch starts with its parent's history (and, on Codex, maybe its name), so it is titled by its own
  // instruction: the generated title once there is one, until then "Branch: <instruction>".
  if (smeta[s.id]?.branchOf) return { ...out, title: storedAutoTitle(s.id) || 'Branch: ' + smeta[s.id].branchNote };
  if (s.untitled && storedAutoTitle(s.id)) return { ...out, title: storedAutoTitle(s.id) };
  if (request && s.untitled && Date.now() - (s.mtimeMs || 0) < TITLE_WINDOW_MS) titler.request(s.id, s.prompt || s.title);
  return out;
}
// JSON over 1 KB is gzipped when the client accepts it (the session list is ~70 KB every 5 s).
function sendJson(req, res, body) {
  const buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); // a string is JSON already serialised
  res.set('Content-Type', 'application/json; charset=utf-8'); res.vary('Accept-Encoding');
  if (buf.length > 1024 && /\bgzip\b/.test(req.get('accept-encoding') || '')) { res.set('Content-Encoding', 'gzip'); return res.end(zlib.gzipSync(buf, { level: 4 })); }
  res.end(buf);
}
async function listAllSessions(limit) {
  let rows = (await listSessions(limit)).map(s => ({ ...s, provider: 'claude' }));
  const warnings = [];
  if (CODEX_ON) {
    try {
      rows.push(...(await codex.listCodexSessions(limit)).map(s => ({ ...s,
        title: smeta[s.id]?.name || capTitle(s.title), untitled: !smeta[s.id]?.name && s.untitled, pinned: isPinned(s.id) || undefined, // 1.89: Codex often names a thread by its whole first message
        active: codex.codexTurnActive(codex.bareId(s.id)) || codex.codexExtActive(codex.bareId(s.id)),
      })));
    } catch (e) { log(`codex list failed: ${e.message}`); warnings.push('Codex conversations are temporarily unavailable.'); }
  }
  if (ACP_ON) {
    if (Date.now() - acpListCache.at > 15_000) { const p = refreshAcpList(); if (!acpListCache.at) await p; }
    rows.push(...acpListCache.rows.map(s => ({ ...s, title: smeta[s.id]?.name || s.title, untitled: !smeta[s.id]?.name && s.untitled,
      pinned: isPinned(s.id) || undefined, active: acp.acpTurnActive(s.id) })));
  }
  // Owned runs must stay visible even before the CLI writes a transcript, or
  // after their last transcript update falls outside the recent-history window.
  const known = new Set(rows.map(s => s.id));
  const owned = [...turns.entries(), ...[...codex.codexTurns].map(([id, t]) => [codex.CX + id, t]), ...[...acp.acpTurns].map(([id, t]) => [acp.ACP + id, t])];
  for (const [id, t] of owned) if (!known.has(id)) rows.push({ id, title: smeta[id]?.name || t.userText?.slice(0,120) || 'New conversation',
    cwd: t.cwd, provider: sessionEngine(id), active: true, mtimeMs: t.startedAt, pinned: isPinned(id) });
  for(const id of new Set(followups.rows.map(r=>r.sessionId))){
    if(rows.some(s=>s.id===id))continue;
    const file=!isCx(id)?await findSessionFile(id):null;
    const meta=isCx(id)?await codex.codexThreadMeta(codex.bareId(id)).catch(()=>null):file?await sessionMeta(file,id):null;
    rows.push({...meta,id,provider:sessionEngine(id),title:smeta[id]?.name||capTitle(meta?.title)||'Queued conversation',mtimeMs:meta?.mtimeMs||followups.list(id)[0].createdAt});
  }
  // Scratch and test workspaces stay out of the list for both agents unless pinned or running.
  rows = rows.filter(s => !((s.provider === 'codex' || s.provider === 'acp') && s.cwd?.startsWith('/tmp/') && !s.pinned && !s.active));
  rows = rows.map(s => ({ ...finishTitle(s, true), state: stateFor(s) })).sort((a,b) => b.mtimeMs-a.mtimeMs);
  // pins first, in their chosen order (unordered pins by recency); everything else keeps recency
  rows.sort((a, b) => (a.pinned ? pinRank(a.id) : Infinity) < (b.pinned ? pinRank(b.id) : Infinity) ? -1 : (a.pinned ? pinRank(a.id) : Infinity) > (b.pinned ? pinRank(b.id) : Infinity) ? 1 : 0);
  const result = prioritizeSessions(rows, limit);
  result.warnings = warnings;
  return result;
}

let listJsonCache = { json: '', etag: '' }; // the last list served and its ETag
app.get('/api/sessions', requireAuth, async (req, res) => {
  try {
    const sessions = await listAllSessions(Math.min(Number(req.query.limit) || 60, 200));
    for (const s of sessions) if (mutes.has(s.id)) s.muted = true; // spoken alerts honor per-session mute
    for (const s of sessions) if (smeta[s.id]?.seen) s.seenAt = smeta[s.id].seen; // shared across devices
    for (const s of sessions) if (s.pinned && Number.isFinite(smeta[s.id]?.pinOrder)) s.pinOrder = smeta[s.id].pinOrder;
    for (const s of sessions) if (smeta[s.id]?.branchOf) s.branchOf = smeta[s.id].branchOf; // 1.79: the row says Branch
    for (const s of sessions) delete s.prompt;
    // 1.19: the list rarely changes between 5 s polls. A matching If-None-Match gets 304 with the
    // check time in a header, which still counts as a fresh server confirmation for the client.
    const held = coordLive() ? coord.state.holds.map(h => ({ name: h.name, title: coordHolderTitle(h.holder) })) : []; // 1.99: the line above the list
    const payload = { sessions, warnings: sessions.warnings, home: DEFAULT_CWD || HOME, ...(held.length ? { held } : {}) }; // 1.20.1: rows omit the workspace when it is this one
    // 1.89: serialised once per poll, and an unchanged list reuses the tag it was hashed to. The list itself is still
    // built each poll: row states follow live turns, queues and the clock, and no one signal says the list changed.
    const json = JSON.stringify(payload);
    if (json !== listJsonCache.json) listJsonCache = { json, etag: '"' + createHash('sha1').update(json).digest('base64url') + '"' };
    const etag = listJsonCache.etag, checkedAt = Date.now();
    res.set({ ETag: etag, 'X-Pocket-Checked-At': String(checkedAt), 'Cache-Control': 'no-store' });
    if (req.get('if-none-match') === etag) return res.status(304).end();
    sendJson(req, res, json.slice(0, -1) + ',"checkedAt":' + checkedAt + '}'); // { ...payload, checkedAt }
  } catch { res.status(503).json({ error: 'Conversation status is unavailable. Please retry.' }); }
});

app.get('/api/projects', requireAuth, async (_req, res) => {
  const seen = new Map(); // cwd -> latest mtime
  for (const s of await listAllSessions(200)) {
    if (!s.cwd || s.cwd.startsWith('/tmp/') || s.cwd.includes('/.claude/')) continue;
    if (!seen.has(s.cwd) || seen.get(s.cwd) < s.mtimeMs) seen.set(s.cwd, s.mtimeMs);
  }
  if (LOCK_CWD) return res.json({ projects: [DEFAULT_CWD], defaultCwd: DEFAULT_CWD, locked: true }); // 1.55: one folder, nothing to choose
  const projects = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([cwd]) => cwd);
  if (!projects.includes(HOME)) projects.push(HOME);
  if (DEFAULT_CWD) projects.splice(0, projects.length, DEFAULT_CWD, ...projects.filter(p => p !== DEFAULT_CWD));
  res.json({ projects, defaultCwd: DEFAULT_CWD || null });
});

// The CLI writes the user's line to the transcript a moment after a turn starts. A client that re-renders in
// that gap (it does, right after the send is acknowledged) would lose the message just sent until the turn
// ends. Show the turn's own text as pending until the transcript has it. Match the text among user lines
// written since the turn started, not "the last user line": a steered or queued message can land after it.
// (Reported, with a first patch, by Damon Delcoro 2026-10-05.) 1.48.1: Codex sessions too. Pocket reads a Codex
// thread through a separate reader process, which has the new user message only a few hundred ms after
// turn/start returns, so the same re-render dropped it there. Codex stores attachments as a note after the text.
function withPendingUser(messages, turn) {
  const text = String(turn?.userText || '').trim();
  if (!text || turn.autonomous) return messages;
  const since = (turn.startedAt || 0) - 5000;
  const same = t => t === text || t.startsWith(text + '\n\n[Attached file');
  const landed = messages.some(m => m.role === 'user' && same((m.text || '').trim()) && (!m.ts || Date.parse(m.ts) >= since));
  return landed ? messages : [...messages, { role: 'user', text, pending: true }];
}

app.get('/api/session/:id', requireAuth, async (req, res) => {
  if (isAcpId(req.params.id)) { // OpenRouter (ACP): history from OpenCode's session/load; a live turn streams the rest
    const id = req.params.id, turn = acp.ownedAcpTurn(id);
    if (!ACP_ON) return res.status(404).json({ error: 'not found' });
    let messages;
    try { messages = await acpMessages(id, turn); }
    catch (e) { if (!turn) { log(`acp history read failed session=${id}: ${e.message}`); return res.status(404).json({ error: 'not found' }); } messages = []; }
    // 1.86: your message shows while its reply runs (the stream then starts after it), as in Claude and Codex
    messages = withPendingUser(messages.map(acp.forClient), turn);
    const row = acpListCache.rows.find(r => r.id === id), cwd = turn?.cwd || row?.cwd || null;
    return sendJson(req, res, {
      id, provider: 'acp', model: readEngineConfig(smeta[id])?.model || turn?.model || null,
      title: smeta[id]?.name || (row && !row.untitled ? row.title : '') || turn?.userText?.slice(0, 120) || messages.find(m => m.role === 'user')?.text.slice(0, 120) || 'New conversation',
      cwd, state: stateFor({ id, mtimeMs: row?.mtimeMs || 0 }), active: Boolean(turn),
      turnEvents: turn ? 1 : null, // the history above ends with this reply's message; its stream replays from the event after it
      muted: mutes.has(id), pinned: isPinned(id), repo: await conversationRepo(id, cwd), messages, total: messages.length, ...lineage(id),
    });
  }
  if (isCx(req.params.id)) {
    const tid = codex.bareId(req.params.id);
    const meta = await codex.codexThreadMeta(tid).catch(() => null);
    const turn = codex.codexTurns.get(tid);
    if (!meta && !turn) return res.status(404).json({ error: 'not found' });
    let messages = [], total = 0;
    try { ({ msgs: messages, total } = await codex.readCodexThread(tid)); }
    catch (e) { // a brand-new thread has no history page yet — show the prompt we sent
      if (turn?.userText) { messages = [{ role: 'user', text: turn.userText }]; total = 1; }
      else return res.status(502).json({ error: String(e.message) });
    }
    messages = withPendingUser(messages.map(codex.forClient), turn); // 1.87: edits' diffs stay here for the Changes view
    return sendJson(req, res, {
      id: req.params.id, provider: 'codex',
      title: smeta[req.params.id]?.name || (meta ? capTitle(finishTitle({ ...meta, untitled: meta.untitled }).title) : turn?.userText?.slice(0, 120)) || 'New conversation',
      cwd: meta?.cwd || turn?.cwd || null, model: meta?.model, source: meta?.source,
      state: stateFor({ id: req.params.id, mtimeMs: meta?.mtimeMs || 0 }),
      executionMode:turn?.executionMode,active: Boolean(turn), ext: codex.codexExtActive(tid), turnEvents: turn?.events.length ?? null,
      locked: !turn && !codex.codexSessions.has(tid) && codex.threadLocked(tid), // Pocket's own open session holds the lock too
      muted: mutes.has(req.params.id), pinned: isPinned(req.params.id), repo: await conversationRepo(req.params.id, meta?.cwd || turn?.cwd),
      messages, total, ...lineage(req.params.id),
    });
  }
  const file = await findSessionFile(req.params.id);
  if (!file) {
    const turn = turns.get(req.params.id);
    if (turn) { // brand-new session: transcript file not written yet
      return res.json({
        id: req.params.id, title: titleOf(req.params.id) || turn.userText?.slice(0, 120) || 'New conversation', cwd: turn.cwd, repo: isGitWorkspace(turn.cwd),
        state: stateFor({ id: req.params.id }), active: true, messages: turn.userText ? [{ role: 'user', text: turn.userText }] : [], ...lineage(req.params.id),
      });
    }
    return res.status(404).json({ error: 'not found' });
  }
  const meta = await sessionMeta(file, req.params.id);
  const { msgs, total } = await readTranscript(file);
  const messages = withPendingUser(msgs, turns.get(req.params.id));
  // turnEvents: what the live stream has already broadcast for the running turn. The
  // transcript above covers it, so a fresh stream connection asks to start after it.
  sendJson(req, res, { ...finishTitle(meta), state: stateFor({ ...meta, id: req.params.id }), active: turns.has(req.params.id), ext: extActive(req.params.id), muted: mutes.has(req.params.id), pinned: isPinned(req.params.id), repo: await conversationRepo(req.params.id, meta.cwd), messages, total, turnEvents: turns.get(req.params.id)?.events.length ?? null, ...lineage(req.params.id) });
});

// Extract references from assistant messages on demand; no second document store.
const resultCache = new Map();
async function sessionResults(id) {
  const cached = resultCache.get(id);
  if (cached && Date.now() - cached.at < 5000) return cached.value;
  const transcript = await engineOf(id).transcript(id, 4000);
  const refs = collectResults(transcript.msgs);
  const value = { ...refs, truncated: transcript.total > transcript.msgs.length,
    scannedMessages: transcript.msgs.length };
  resultCache.set(id, {at:Date.now(),value});
  if(resultCache.size > 40) resultCache.delete(resultCache.keys().next().value);
  return value;
}
// 1.20.1: the conversation hides its Git control when the workspace is not inside a Git repository.
// 1.89: or when the folder or its repository is outside home, where the Git route always refuses (workspace.mjs rootFor).
function isGitWorkspace(cwd) {
  return gitAvailable(cwd, HOME);
}
// 1.97: the folders a conversation has worked in, from its transcript. The Git panel and Branch follow the active one.
const folderReader = new FolderReader({ home: HOME });
async function conversationFolders(id) {
  const ops = engineOf(id), quiet = async fn => { try { return await fn(); } catch { return null; } };
  const start = await quiet(() => ops.cwd(id));
  return folderReader.folders({ id, file: await quiet(() => ops.foldersFile?.(id)), kind: engineForSessionId(id), start });
}
// The first read of a long transcript shouldn't hold up opening it: the read carries on, and the next load has the answer.
async function conversationRepo(id, cwd) {
  if (isGitWorkspace(cwd)) return true;
  const read = conversationFolders(id).then(f => f.repo, () => false);
  return Promise.race([read, new Promise(r => setTimeout(r, 400, false))]);
}
function runningConversations() {
  return [...turns.keys(), ...[...codex.codexTurns.keys()].map(t => codex.CX + t), ...[...acp.acpTurns.keys()].map(t => acp.ACP + t)];
}
async function alsoWorkingHere(id, root) {
  if (!root) return [];
  const out = [];
  for (const other of runningConversations().filter(x => x !== id).slice(0, 12)) {
    const f = await conversationFolders(other).catch(() => null);
    if (f?.active === root) out.push({ id: other, title: titleOf(other) || 'Another conversation' });
  }
  return out;
}
// 1.97: a client can pick only a folder the server computed for this conversation; rootFor then applies its home check.
async function workspaceCwd(id,folder) {
  if(!anyId(id))throw Object.assign(new Error('Invalid conversation'),{status:400});
  const f=await conversationFolders(id).catch(()=>null);
  if(folder){if(!f?.folders.some(x=>x.root===folder))throw Object.assign(new Error('That folder is not one this conversation worked in.'),{status:403});return folder;}
  return f?.active||f?.start||engineOf(id).cwd(id);
}
// 1.98: which conversations worked in which worktree, for the Git panel. Read once a minute at most, and only when the
// panel asks. Anything older than 14 days can't change a row's group, so only its starting folder is kept.
const WORKTREE_WINDOW = 14 * 86_400_000, worktreeActivity = { at: 0, rows: [], pending: null };
function recentActivity() {
  if (Date.now() - worktreeActivity.at < 60_000) return Promise.resolve(worktreeActivity.rows);
  worktreeActivity.pending ||= (async () => {
    const all = await listAllSessions(1000), since = Date.now() - WORKTREE_WINDOW;
    const recent = all.filter(s => s.mtimeMs >= since).slice(0, 300), rows = new Map(all.map(s => [s.id, { id: s.id, title: s.title || 'Conversation', cwd: s.cwd, at: s.mtimeMs || 0, roots: null }]));
    for (let i = 0; i < recent.length; i += 8) await Promise.all(recent.slice(i, i + 8).map(async s => {
      const f = await conversationFolders(s.id).catch(() => null);
      if (f?.folders.length) rows.get(s.id).roots = f.folders.map(x => ({ root: x.root, at: x.lastUsedAt || 0 }));
    }));
    worktreeActivity.rows = [...rows.values()]; worktreeActivity.at = Date.now();
    return worktreeActivity.rows;
  })().finally(() => { worktreeActivity.pending = null; });
  return worktreeActivity.pending;
}
const within = (dir, p) => Boolean(p) && (p === dir || p.startsWith(dir + path.sep));
async function worktreeUsage(dir) {
  const rows = await recentActivity(), running = [];
  for (const id of runningConversations().slice(0, 40)) {
    const f = await conversationFolders(id).catch(() => null);
    if (within(dir, f?.start) || f?.active === dir) running.push({ id, title: titleOf(id) || 'A conversation' });
  }
  const seen = rows.map(r => ({ r, at: r.roots ? r.roots.find(x => x.root === dir)?.at || 0 : within(dir, r.cwd) ? r.at : 0 })).filter(x => x.at).sort((a, b) => b.at - a.at);
  return { running, lastAt: seen[0]?.at || 0, conversations: seen.slice(0, 3).map(x => ({ id: x.r.id, title: x.r.title })),
    started: rows.filter(r => within(dir, r.cwd)).sort((a, b) => b.at - a.at).slice(0, 50).map(r => ({ id: r.id, title: r.title })) };
}
const worktrees = new Worktrees({ home: HOME, selfDirs: [process.cwd(), import.meta.dirname], logFile: path.join(DATA_DIR, 'worktrees-removed.jsonl'), log, usage: worktreeUsage });
// A row the panel asks about has to be a worktree of a repository this conversation worked in.
async function conversationWorktree(req) {
  const rows = await worktrees.list(await workspaceCwd(req.params.id, String(req.query.folder || '')));
  const p = String(req.query.path || '');
  if (!rows.some(r => r.path === p)) throw Object.assign(new Error('That folder is not a worktree of this repository.'), { status: 403 });
  return p;
}
// 1.98: a conversation whose folder is gone carries on from home. Checked on the real agents 2026-11-07: Claude Code and
// OpenCode load the history from another folder; Codex, told nothing, resumes in the deleted one and every command fails.
async function folderGone(id, cwd) {
  let want = cwd;
  if (!want) try { want = await engineOf(id).cwd(id); } catch { want = null; }
  return Boolean(want) && !fs.existsSync(want);
}
// Said once. The transcript keeps naming the old folder, so without this every later message would repeat it.
function carriedOn(id, gone) {
  if (!gone || smeta[id]?.carriedOnAt) return {};
  setSmeta(id, { carriedOnAt: Date.now() });
  return { carriedOn: true };
}
// Read-only, cached per session; concurrent phone/pane requests share one provider read.
const agentFiles = new ClaudeAgentFiles(), agentResponses = new Map();
async function sessionAgents(id) {
  const prior=agentResponses.get(id);
  if(prior && (prior.pending || Date.now()-prior.at<4000))return prior.promise;
  const promise=(async()=>{
    if(isAcpId(id))return {running:0,agents:[]}; // OpenRouter (OpenCode) exposes no subagents
    if(isCx(id))return codex.readCodexAgents(codex.bareId(id));
    const file=await findSessionFile(id), runner=runners.get(id);
    if(!file&&!runner)throw Object.assign(new Error('Conversation not found'),{status:404});
    const activity=new AgentActivity();let truncated=false;
    // Transcript history supplies terminal/editor sessions; the current runner log
    // adds task lifecycle events that Claude does not write to its transcript.
    for(const source of [...new Set([file,runner?.files.out].filter(Boolean))]){
      const parsed=await agentFiles.read(source);truncated ||= parsed.truncated;
      for(const event of parsed.events)activity.claude(event);
    }
    if(file)activity.files(subagentIndex.summary(subagentDir(file,id))); // 1.82: the agents' own transcripts
    const result=activity.snapshot({confirmed:Boolean(turns.get(id)),backgroundIds:(runner?.bgTasks||[]).filter(t=>/agent/.test(t.task_type||'')).map(t=>t.task_id)});
    return {...result,truncated:result.truncated||truncated};
  })();
  const entry={at:Date.now(),promise,pending:true};
  agentResponses.set(id,entry);
  if(agentResponses.size>60)agentResponses.delete(agentResponses.keys().next().value);
  try{return await promise;}catch(e){agentResponses.delete(id);throw e;}
  finally{entry.pending=false;entry.at=Date.now();}
}
app.get('/api/session/:id/agents',requireAuth,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  if(!anyId(req.params.id))return res.status(400).json({error:'Invalid conversation'});
  try{res.json(await sessionAgents(req.params.id));}
  catch(e){res.status(e.status||503).json({error:e.status?e.message:'Subagent activity could not be loaded. Try again.'});}
});

// 1.82: what a subagent has done so far, from its own transcript, in the conversation's message shape.
app.get('/api/session/:id/agents/:agent/activity',requireAuth,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const {id,agent}=req.params;
  if(!anyId(id)||!/^[\w-]{1,64}$/.test(agent))return res.status(400).json({error:'Invalid conversation'});
  if(isAcpId(id))return res.status(404).json({error:'OpenRouter has no subagents.'});
  if(isCx(id)){ // 1.87: a Codex subagent is a thread of its own; show it once it is confirmed to be this conversation's
    try{
      const {agents=[]}=await codex.readCodexAgents(codex.bareId(id));
      const a=agents.find(x=>x.id===agent);
      if(!a)return res.status(404).json({error:'This subagent is not part of this conversation.'});
      const {msgs,total}=await codex.readCodexThread(agent,300);
      return res.json({agent:a,messages:msgs.map(codex.forClient),total,checkedAt:Date.now()});
    }catch(e){return res.status(503).json({error:'Subagent activity could not be loaded. Try again.'});}
  }
  try{
    const file=await findSessionFile(id);
    const info=file?subagentIndex.file(subagentDir(file,id),agent):null;
    if(!info)return res.status(404).json({error:'This subagent has not written a transcript yet.'});
    const {msgs,total}=await readTranscript(info.file,300,{sidechain:true});
    const {file:_,...summary}=info;
    res.json({agent:summary,messages:msgs,total,checkedAt:Date.now()});
  }catch(e){res.status(503).json({error:'Subagent activity could not be loaded. Try again.'});}
});
app.get('/api/approval-policy',requireAuth,(_req,res)=>res.json({defaultMode:DEFAULT_APPROVAL_MODE,allowFullAccess:ALLOW_FULL_ACCESS}));
app.get('/api/session/:id/approvals',requireAuth,(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!anyId(req.params.id))return res.status(400).json({error:'Invalid conversation'});
  const turn=ownedTurn(req.params.id);
  res.json({requests:turn?.approvals?.list()||[],interrupted:Boolean(turn?.approvalUnavailable),activeMode:turn?.approvalMode||null,defaultMode:DEFAULT_APPROVAL_MODE,allowFullAccess:ALLOW_FULL_ACCESS});
});
app.post('/api/session/:id/approvals/:request/decision',requireAuth,async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!anyId(req.params.id))return res.status(400).json({error:'Invalid conversation'});
  const turn=ownedTurn(req.params.id);
  if(!turn?.approvals||turn.done||turn.finalized||turn.stopped)return res.status(409).json({error:'This action is no longer waiting. Refresh the conversation.'});
  try{res.json(await turn.approvals.decide(req.params.request,req.body.decision));}
  catch(e){res.status(e.status||503).json({error:e.status?e.message:'The approval connection is unavailable. Stop this reply before trying again.'});}
});

app.get('/api/session/:id/questions',requireAuth,(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(!anyId(req.params.id))return res.status(400).json({error:'Invalid conversation'});
  const turn=ownedTurn(req.params.id);
  res.json({supported:true,interrupted:Boolean(turn?.inputUnavailable),requests:turn?.questions?.list()||[]});
});
app.post('/api/session/:id/questions/:request/answer',requireAuth,(req,res)=>{
  if(!anyId(req.params.id))return res.status(400).json({error:'Invalid conversation'});
  const turn=ownedTurn(req.params.id);
  if(!turn?.questions||turn.done)return res.status(409).json({error:'This question is no longer active. Refresh the conversation.'});
  try{res.json(turn.questions.answer(req.params.request,req.body.answers));}
  catch(e){res.status(e.status||503).json({error:e.status?e.message:'Answer could not be confirmed. Refresh before trying again.'});}
});
// 1.98: the list is one fast git call; each row's status is a separate read the panel makes four at a time.
app.get('/api/session/:id/worktrees',requireAuth,async(req,res)=>{
  try{
    const rows=await worktrees.list(await workspaceCwd(req.params.id,String(req.query.folder||'')));
    res.json({rows:rows.map(r=>({path:r.path,branch:r.branch||null,main:r.main,locked:Boolean(r.locked)}))});
  }catch(e){if(e.status)return res.status(e.status).json({error:e.message});res.json({rows:[]});}
});
app.get('/api/session/:id/worktrees/status',requireAuth,async(req,res)=>{
  try{res.json(await worktrees.status(await conversationWorktree(req)));}
  catch(e){res.status(e.status||500).json({error:e.status?e.message:'Could not read this worktree.'});}
});
app.get('/api/session/:id/worktrees/removal',requireAuth,async(req,res)=>{
  try{res.json(await worktrees.plan(await conversationWorktree(req)));}
  catch(e){res.status(e.status||500).json({error:e.status?e.message:'Could not read this worktree.'});}
});
// The owner's cookie only: requireAuth refuses the CLI token, so no agent can reach this in any approval mode.
app.post('/api/worktrees/remove',requireAuth,async(req,res)=>{
  try{res.json({ok:true,...await worktrees.remove(String(req.body?.path||''),String(req.body?.check||''))});}
  catch(e){res.status(e.status||500).json({error:e.status?e.message:'Could not remove this worktree.'});}
});
app.get('/api/session/:id/folders',requireAuth,async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(!anyId(req.params.id))return res.status(400).json({error:'Invalid conversation'});
  try{const f=await conversationFolders(req.params.id);res.json({...f,also:await alsoWorkingHere(req.params.id,f.active)});}
  catch(e){res.status(e.status||503).json({error:e.status?e.message:'Folders could not be read. Try again.'});}
});
app.get('/api/session/:id/workspace',requireAuth,async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  try {res.json(await workspaceStatus(await workspaceCwd(req.params.id,String(req.query.folder||'')),HOME));}
  catch(e){res.status(e.status||503).json({error:e.status?e.message:'Workspace could not be inspected. Try again.'});}
});
app.get('/api/session/:id/workspace/diff',requireAuth,async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  try {res.json(await workspaceDiff(await workspaceCwd(req.params.id,String(req.query.folder||'')),HOME,String(req.query.path||''),String(req.query.scope||'working')));}
  catch(e){res.status(e.status||503).json({error:e.status?e.message:'Diff could not be inspected. Try again.'});}
});
// ---------- 1.21: While you were away ----------
const awayCache = new Map(), awayInFlight = new Map();
app.post('/api/session/:id/away', requireAuth, async (req, res) => {
  const id = req.params.id, since = Number(req.body?.since);
  if (!anyId(id) || !Number.isFinite(since) || since <= 0) return res.status(400).json({ error: 'Invalid request' });
  if (!settings.awaySummaries) return res.json({ summary: null, reason: 'off' });
  if (!ENGINES[engineForSessionId(id)].features.awaySummary) return res.json({ summary: null, reason: 'unsupported' }); // 1.86: no message times to summarize from
  refreshTitleProviders();
  const provider = helperProvider();
  if (!provider) return res.json({ summary: null, reason: 'unavailable' });
  let msgs;
  try {
    if (isCx(id)) msgs = (await codex.readCodexThread(codex.bareId(id), 600)).msgs;
    else { const file = await findSessionFile(id); if (!file) return res.status(404).json({ error: 'not found' }); msgs = (await readTranscript(file, 600)).msgs; }
  } catch { return res.status(502).json({ error: 'Could not read the conversation.' }); }
  const after = msgs.filter(m => (Date.parse(m.ts || '') || 0) > since);
  const { digest, stats } = awayDigest(after);
  if (!awayWorthSummary(stats)) return res.json({ summary: null, reason: 'short' });
  const key = `${id}|${since}|${after.at(-1)?.ts}|${provider}`;
  if (awayCache.has(key)) return res.json(awayCache.get(key));
  if (!awayInFlight.has(key)) awayInFlight.set(key, summarizeAway({ provider, claudeBin: CLAUDE_BIN, codexBin: codex.CODEX_BIN, models: helperModels(), env: spawnEnv() }, digest)
    .finally(() => awayInFlight.delete(key)));
  const r = await awayInFlight.get(key);
  const body = r ? { summary: r.summary, model: r.model, provider, messages: after.length } : { summary: null, reason: 'failed' };
  if (r) { awayCache.set(key, body); if (awayCache.size > 100) awayCache.delete(awayCache.keys().next().value); log(`away summary session=${id} provider=${provider} model=${r.model} messages=${after.length}`); }
  res.json(body);
});
app.get('/api/session/:id/results', requireAuth, async (req,res) => {
  if(!anyId(req.params.id)) return res.status(400).json({error:'Invalid conversation'});
  try { res.json(await sessionResults(req.params.id)); }
  catch(e) { res.status(e.status || 503).json({error:e.status===404 ? e.message : 'Results could not be loaded. Try again.'}); }
});
app.get('/api/session/:id/artifact', requireAuth, async (req,res) => {
  if(!anyId(req.params.id)) return res.status(400).json({error:'Invalid conversation'});
  const requested=String(req.query.path || '');let h=null;
  try {
    const {results}=await sessionResults(req.params.id);
    if(!results.some(r=>r.kind==='file'&&r.target===requested))return res.status(403).json({error:'This file is not a result referenced by the conversation.'});
    // 1.89 (S-4): the file is opened once, its last step never through a link, and the rule is applied to the path that
    // descriptor really names; the picture, the inline view and the download all read that descriptor. The name used to
    // be checked with realpath and then reopened, so a file swapped for a link in between served the link's target.
    try{h=openChecked(requested,real=>real.startsWith(HOME+'/')&&!real.slice(HOME.length+1).split('/').some(p=>p.startsWith('.')));}
    catch(e){if(e.code==='EOUTSIDE'||e.code==='ELOOP')return res.status(403).json({error:'File is outside the supported report location.'});if(e.code==='ENOTFILE'||e.code==='EISDIR')return res.status(404).end();throw e;}
    const real=h.real,opened=h;
    // 1.61: ?thumb=1 is the file card's picture: the first page of a PDF or a scaled image, never an HTML page (an
    // agent-made page is not rendered by a browser on the server). 404 when there is none; the card shows its type.
    if(req.query.thumb==='1'){
      const kind=/\.pdf$/i.test(real)?'pdf':/\.(png|jpe?g|gif|webp)$/i.test(real)?'image':null;
      h=null; // the Thumbnailer owns the handle from here (and closes it), as does the close below when there is no kind
      const t=kind?await artifactThumbs.get({id:'a'+createHash('sha256').update(real).digest('hex').slice(0,20),kind,file:real},opened).catch(()=>null):(opened.close(),null);
      if(!t)return res.status(404).end();
      res.setHeader('Cache-Control','private, max-age=300');res.type(t.type);return res.sendFile(t.path);
    }
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");
    // HTML and other active documents must never execute under the app origin.
    // 1.61: ?inline=1 shows a readable file (PDF, image, HTML, text) in Pocket's link view instead of downloading it;
    // the sandbox policy above still applies, so a page cannot run scripts here.
    if(req.query.inline==='1'&&/\.(pdf|png|jpe?g|gif|webp|html?|md|txt|csv|tsv|json)$/i.test(real)){
      const text=/\.(md|txt|csv|tsv|json)$/i.test(real);
      res.setHeader('Content-Disposition','inline; filename="'+path.basename(requested).replace(/[^\w.\- ]+/g,'_')+'"');
      if(text)res.type('text/plain; charset=utf-8');else res.type(path.extname(real));
      h=null;return res.sendFile(opened.path,err=>{opened.close();if(err&&!res.headersSent)res.status(404).end();});
    }
    res.type(path.extname(real)||'bin'); // opened.path (/proc/self/fd/<n>) has no extension to take the type from
    h=null;res.download(opened.path,path.basename(requested),err=>{opened.close();if(err&&!res.headersSent)res.status(404).end();});
  }catch(e){h?.close();res.status(e.code==='ENOENT'||e.status===404?404:503).json({error:'This result is not available. It may have moved or been removed.'});}
});

// ---------- usage visibility (Feature G) ----------
// Account-level plan usage (5-hour / weekly windows, extra-usage status). Values only
// change when a turn runs — the client labels them "as of <observedAt>", never live.
app.get('/api/usage', requireAuth, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const claude = usage.accountSummary();
  const codexUsage = CODEX_ON ? await codex.codexRateLimits().catch(() => null) : null;
  res.json({ claude, codex: codexUsage });
});
// Per-session context meter ("70k / 1M · 7%"). Falls back to the transcript's last
// assistant usage line for sessions this daemon never ran a turn for.
app.get('/api/session/:id/context', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!anyId(req.params.id)) return res.status(400).json({ error: 'Invalid conversation' });
  try {
    if (isCx(req.params.id)) return res.json({ ...(await codex.codexContextAndCache(codex.bareId(req.params.id))), serverNow: Date.now() });
    if (isAcpId(req.params.id)) { // 1.86: OpenCode reports the context in use and the model's window with each step
      const id = req.params.id, c = acp.ownedAcpTurn(id)?.context || acp.acpSessions.get(acp.bareAcpId(id))?.context || smeta[id]?.acpContext;
      return res.json({ context: c ? { used: c.used, window: c.size, pct: c.size ? Math.min(1, c.used / c.size) : 0, estimated: false, model: readEngineConfig(smeta[id])?.model || null, lastAt: c.at || null } : null, cache: null, serverNow: Date.now() });
    }
    const file = await findSessionFile(req.params.id);
    const context = await getSessionContext(usage, req.params.id, { transcriptFile: file, fsp, modelHint: runners.get(req.params.id)?.model });
    // 1.28: prompt-cache warmth, estimated from the transcript's last request. serverNow lets the
    // browser correct for its own clock when it counts down.
    const cache = await cacheFromTranscript(file).catch(() => null);
    res.json({ context, cache, serverNow: Date.now() });
  } catch (e) { res.status(503).json({ error: 'Context could not be loaded. Try again.' }); }
});

// read-only "what did it do to my code": every Edit/Write with real before/after
app.get('/api/session/:id/changes', requireAuth, async (req, res) => {
  // Codex records edits as unified diff hunks, not before/after pairs — the view can't
  // render those yet, so report the touched files rather than pretending there's nothing.
  if (anyId(req.params.id) && engineForSessionId(req.params.id) !== 'claude') {
    // 1.87: Codex records each edit as a unified diff per file (kept on the transcript's Edit lines); OpenRouter names the
    // files. Claude records before/after pairs (collectChanges, below). The Changes view shows either.
    const { msgs } = await engineOf(req.params.id).transcript(req.params.id, 5000).catch(() => ({ msgs: [] }));
    const files = new Map(), add = (p, op) => { if (!files.has(p)) files.set(p, []); if (op) files.get(p).push(op); };
    for (const m of msgs) for (const b of m.blocks || []) {
      if (b.t !== 'tool' || b.name !== 'Edit') continue;
      if (Array.isArray(b.changes) && b.changes.length) for (const c of b.changes) add(c.path, typeof c.diff === 'string'
        ? { tool: c.kind === 'add' ? 'Write' : c.kind === 'delete' ? 'Delete' : 'Edit', patch: c.diff, ...(c.to ? { to: c.to } : {}), ...(c.trunc ? { trunc: true } : {}), ts: m.ts || null } // Codex: a unified diff
        : { tool: c.old == null ? 'Write' : 'Edit', old: c.old, new: c.new, ts: m.ts || null }); // OpenRouter: before/after, as Claude's
      else for (const p of b.paths || (b.detail ? [b.detail.replace(/ \+\d+ more$/, '')] : [])) add(p, null);
    }
    return res.json({ files: [...files.entries()].map(([path, ops]) => ({ path, ops })), failed: 0, ...([...files.values()].some(o => !o.length) ? { diffless: true } : {}) });
  }
  const file = await findSessionFile(req.params.id);
  if (!file) return res.status(404).json({ error: 'not found' });
  res.json(await collectChanges(file));
});

// ---------- 1.22: search across conversations ----------
// With MemStem beside Pocket (POCKET_MEMSTEM_URL, default http://127.0.0.1:7821; POCKET_MEMSTEM=0 turns it off),
// search uses its keyword + semantic index of every session, and snippets come from its plain-text copy of the
// conversation. Otherwise Pocket searches the recent conversations' text itself, for an exact phrase, within a
// time budget, and says how far it got.
const MEMSTEM_URL = (process.env.POCKET_MEMSTEM_URL || 'http://127.0.0.1:7821').trim().replace(/\/+$/, '');
const memstem = { on: process.env.POCKET_MEMSTEM !== '0', checkedAt: 0, ok: false, vault: null };
// 1.73.8: MemStem's answers are read up to a size limit; a larger one is a failed answer, not a memory spike.
async function cappedJson(r, max) {
  const parts = []; let size = 0;
  for await (const chunk of r.body) { size += chunk.length; if (size > max) { try { await r.body.cancel(); } catch { } throw new Error(`answer larger than ${max} bytes`); } parts.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
async function memstemStatus() {
  if (!memstem.on || Date.now() - memstem.checkedAt < 60_000) return memstem;
  try {
    const r = await fetch(MEMSTEM_URL + '/health', { signal: AbortSignal.timeout(3000) });
    const j = await cappedJson(r, 64 * 1024);
    memstem.ok = r.ok && j?.status !== 'down'; memstem.vault = typeof j?.vault === 'string' ? path.resolve(j.vault) : null;
    memstem.vaultReal = memstem.vault ? await fsp.realpath(memstem.vault).catch(() => null) : null;
  } catch { memstem.ok = false; }
  memstem.checkedAt = Date.now();
  return memstem;
}
async function readHead(file, maxBytes) {
  const fh = await fsp.open(file, 'r');
  try { const buf = Buffer.alloc(maxBytes); const { bytesRead } = await fh.read(buf, 0, maxBytes, 0); return buf.toString('utf8', 0, bytesRead); }
  finally { await fh.close(); }
}
const CODEX_SESSIONS_ROOT = path.join(process.env.CODEX_HOME || path.join(HOME, '.codex'), 'sessions');
const searchRow = (s, extra) => ({ id: s.id, title: s.title, provider: s.provider || sessionEngine(s.id), cwd: s.cwd || null,
  mtimeMs: s.mtimeMs || 0, automated: s.automated || undefined, pinned: s.pinned || undefined, ...extra });
app.get('/api/search', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const q = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (q.length < 3) return res.status(400).json({ error: 'Type at least 3 characters.' });
  const t0 = Date.now();
  const listed = new Map((await listAllSessions(200)).map(s => [s.id, s]));
  const describe = async id => {
    if (listed.has(id)) return listed.get(id);
    if (isCx(id)) { if (!CODEX_ON) return null; const m = await codex.codexThreadMeta(codex.bareId(id)).catch(() => null); return m ? finishTitle(m) : null; }
    const file = await findSessionFile(id); if (!file) return null;
    return { ...finishTitle(await sessionMeta(file, id)), provider: 'claude' };
  };
  const ms = await memstemStatus();
  if (ms.ok) {
    try {
      const r = await fetch(MEMSTEM_URL + '/search', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q, limit: 30, types: ['session'] }), signal: AbortSignal.timeout(25_000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const body = await cappedJson(r, 8 * 1024 * 1024), hits = Array.isArray(body) ? body : body?.results || [];
      const picked = [], seen = new Set();
      for (const h of hits) {
        const id = sessionIdFromRef(h?.frontmatter?.provenance?.ref, { projectsRoot: PROJECTS_ROOT, codexSessionsRoot: CODEX_SESSIONS_ROOT });
        if (!id || seen.has(id) || (isCx(id) && !CODEX_ON)) continue;
        seen.add(id); picked.push({ id, h }); if (picked.length >= 15) break;
      }
      const results = (await Promise.all(picked.map(async ({ id, h }) => {
        const s = await describe(id).catch(() => null); if (!s) return null;
        let snip = null;
        const file = ms.vault && typeof h.path === 'string' ? path.resolve(ms.vault, h.path) : null;
        // 1.73.8: the file must resolve (links followed) inside the vault and be a regular file; a link out of the vault or a FIFO is skipped.
        if (file && file.startsWith(ms.vault + path.sep) && ms.vaultReal) { try { const real = await fsp.realpath(file); if (real.startsWith(ms.vaultReal + path.sep) && (await fsp.stat(real)).isFile()) snip = bestSnippet(await readHead(real, 4 * 1024 * 1024), q); } catch { } }
        return searchRow(s, { role: snip?.role || null, snippet: snip?.text || cleanMemstemSnippet(h.snippet), related: !snip });
      }))).filter(Boolean);
      return res.json({ backend: 'memstem', results, tookMs: Date.now() - t0 });
    } catch (e) { log(`memstem search failed, using Pocket's own: ${e.message}`); memstem.ok = false; memstem.checkedAt = Date.now(); }
  }
  // Pocket's own: exact phrase in the newest conversations first, 4 at a time, for up to 6 seconds.
  const rows = [...listed.values()].sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
  const results = [], deadline = t0 + 6000; let next = 0, scanned = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < rows.length && results.length < 15 && Date.now() < deadline) {
      const s = rows[next++];
      let m = null;
      try {
        if (isCx(s.id)) { if (CODEX_ON) m = searchMsgs((await codex.readCodexThread(codex.bareId(s.id), 2000)).msgs, q, 1).matches[0]; }
        else { const file = await findSessionFile(s.id); if (file) m = (await searchTranscript(file, q, 1)).matches[0]; }
      } catch { }
      scanned++;
      if (m) results.push(searchRow(s, { role: m.role, snippet: m.text }));
    }
  }));
  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  res.json({ backend: 'pocket', results, scanned, total: rows.length, complete: scanned >= rows.length || results.length >= 15, tookMs: Date.now() - t0 });
});

// full-transcript search — the client's find bar only sees the rendered tail
app.get('/api/session/:id/search', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'query too short' });
  if (!anyId(req.params.id)) return res.status(400).json({ error: 'Invalid conversation' });
  if (engineForSessionId(req.params.id) !== 'claude') { // Claude's search reads its transcript file directly; the others search their messages
    const { msgs } = await engineOf(req.params.id).transcript(req.params.id, 5000).catch(() => ({ msgs: [] }));
    return res.json(searchMsgs(msgs, q));
  }
  const file = await findSessionFile(req.params.id);
  if (!file) return res.status(404).json({ error: 'not found' });
  res.json(await searchTranscript(file, q));
});

function turnOpts(body) {
  return {
    approvalMode:approvalMode(body?.approvalMode,DEFAULT_APPROVAL_MODE,ALLOW_FULL_ACCESS),
    executionMode:body?.executionMode==='plan'?'plan':'work',
    model: typeof body?.model === 'string' ? body.model : undefined,
    effort: typeof body?.effort === 'string' ? body.effort : undefined,
    attachments: Array.isArray(body?.attachments)
      ? body.attachments.filter(p => typeof p === 'string' && p.startsWith(UPLOAD_DIR) && fs.existsSync(p)).slice(0, 10)
      : undefined,
  };
}

// A Codex turn ends inside codex.mjs; the daemon-level follow-ups (notify the phone,
// run whatever was queued while it worked) mirror the Claude side's finalizeTurn.
async function codexTurnFinished(id, turn, ev) {
  // 1.81: the push follows Claude's rules: none while a browser has the conversation open (its stream is still attached
  // here, read before any await) and none for a reply the user stopped. It used to push for both.
  const watching = turn.subs.size > 0;
  // 1.87: a usage limit waits for the reset and picks the task up again, as Claude's replies do
  if (ev.limit && !turn.stopped && (turn.retryAttempt || 0) < 3) {
    const at = await codex.codexLimitReset().catch(() => null);
    const resetAt = Math.min(at && at > Date.now() ? at : (detectRateLimit(ev.error || 'usage limit')?.resetAt || Date.now() + 3600_000), Date.now() + RETRY_MAX_DELAY_MS) + (at ? RETRY_BUFFER_MS : 0);
    scheduleRetry(id, turn, resetAt);
    recordOutcome(id, turn, ev, resetAt);
    if (!mutes.has(id)) pushNotify(id, smeta[id]?.name || 'Codex conversation', `Usage limit reached. Picks up again at ${fmtOwnerTime(resetAt)}`).catch(() => { });
    return;
  }
  const settled = recordOutcome(id, turn, ev);
  retitler.request(id); // 1.29.1
  if (!turn.stopped) autoKeepTurnFiles(id, turn.startedAt || 0);
  if (!turn.stopped && ev.ok && followups.list(id)[0]?.status === 'pending') {
    // Let the previous app-server release its writer lock before resuming.
    await new Promise(resolve=>setTimeout(resolve,600));
    if(ownedTurn(id))return;
    await runNextFollowup(id, turn.cwd).catch(e => log(`codex queue start failed thread=${id}: ${e.message}`));
    return;
  }
  if (!watching && !turn.stopped && !settled && !mutes.has(id)) {
    const meta = await codex.codexThreadMeta(codex.bareId(id)).catch(() => null);
    // 1.87: the same body Claude's pushes have (the reply's time; tokens where Claude shows its cost)
    const body = !ev.ok ? 'Something went wrong. Tap to see what happened' : assistantOn() ? 'Ready' : `Ready${Number.isFinite(ev.tokens) && ev.tokens > 0 ? ` · ${ev.tokens >= 1e3 ? Math.round(ev.tokens / 1e3) + 'k' : ev.tokens} tokens` : ''}${ev.duration_ms ? ` · ${Math.round(ev.duration_ms / 1000)}s` : ''}`;
    pushNotify(id, meta?.title || 'Codex conversation', body).catch(() => {});
  }
}
async function runNextFollowup(id, cwd, { replaceStale = false } = {}) {
  // 1.89.2: background jobs hold this conversation on the earlier Claude login. Say so and leave the queue as it is (starting
  // would refuse, and the row would read "not confirmed"); Stop background jobs and run it passes replaceStale.
  const jobs = replaceStale ? [] : staleJobs(id);
  if (jobs.length) throw Object.assign(staleLoginRefusal(jobs), { status: 409 });
  return followups.dispatch(id, async row => {
    // 1.81: queued with Full access before it was turned off: it never starts, and the row says why (not "not confirmed").
    if (row.approvalMode === 'full' && !ALLOW_FULL_ACCESS) throw Object.assign(new Error('Full access is turned off on this server; send it again with Review actions.'), { status: 403, notStarted: true });
    return engineOf(id).startQueued(id, cwd, row, { replaceStale });
  });
}
// ---------- 1.86: the engine adapter ----------
// What a feature needs from the engine behind a conversation, one entry per engine. Features call engineOf(id).x(...)
// instead of branching on the id, so a feature written once works on every engine; an engine that cannot do
// something says so in engines.mjs (features), and the app hides it. test/engine-parity.test.mjs runs the same
// checks on all three.
const ENGINE_OPS = {
  claude: {
    turn: id => turns.get(id),
    exists: async id => Boolean(await findSessionFile(id)),
    cwd: async id => { const file = await findSessionFile(id); return turns.get(id)?.cwd || (file ? (await sessionMeta(file, id))?.cwd : null); },
    foldersFile: id => findSessionFile(id),
    transcript: async (id, limit) => { const file = await findSessionFile(id); if (!file) throw Object.assign(new Error('Conversation not found'), { status: 404 }); return readTranscript(file, limit); },
    startQueued: async (id, cwd, row, { replaceStale } = {}) => { const file = await findSessionFile(id), meta = file ? await sessionMeta(file, id) : null; return startTurn({ sessionId: id, cwd: cwd || meta?.cwd || HOME, text: row.text, resume: true, ...turnOpts(row), replaceStale }); },
  },
  codex: {
    turn: id => codex.codexTurns.get(codex.bareId(id)),
    exists: async id => Boolean(await codex.codexThreadMeta(codex.bareId(id))),
    cwd: async id => codex.codexTurns.get(codex.bareId(id))?.cwd || (await codex.codexThreadMeta(codex.bareId(id)))?.cwd,
    foldersFile: id => findRolloutFile(codex.bareId(id)),
    transcript: (id, limit) => codex.readCodexThread(codex.bareId(id), limit),
    startQueued: (id, cwd, row) => startCodexFromApi({ id, threadId: codex.bareId(id), cwd, text: row.text, body: row }),
  },
  acp: {
    turn: id => acp.ownedAcpTurn(id),
    exists: async id => { if (!ACP_ON) return false; if (acp.acpSessions.has(acp.bareAcpId(id)) || acpListCache.rows.some(r => r.id === id)) return true; acpListCache.at = 0; await refreshAcpList(); return acpListCache.rows.some(r => r.id === id); },
    cwd: async id => acp.ownedAcpTurn(id)?.cwd || acp.acpSessions.get(acp.bareAcpId(id))?.cwd || acpListCache.rows.find(r => r.id === id)?.cwd || null,
    transcript: async id => { const msgs = await acpMessages(id); return { msgs, total: msgs.length }; },
    startQueued: (id, cwd, row) => startAcpFromApi({ id, sessionId: acp.bareAcpId(id), cwd, text: row.text, body: row, resume: true }),
  },
};
const engineOf = id => ENGINE_OPS[engineForSessionId(id)];
function ownedTurn(id){return engineOf(id).turn(id);}
// An OpenRouter conversation's history from OpenCode (session/load), cached until its next reply ends. While a reply
// runs, the replay also holds that reply so far: it is cut at the reply's own message, which the stream replays.
async function acpMessages(id, turn = null) {
  if (acpHistory.has(id)) return acpHistory.get(id);
  let msgs = acp.messagesFromEvents(await acp.readAcpTranscript({ sessionId: id, ...acpLaunch() }));
  if (turn) {
    const t = String(turn.userText || '').trim(), mine = m => m.role === 'user' && ((m.text || '').trim() === t || (m.text || '').startsWith(t + '\n\n[Attached file'));
    const at = msgs.findLastIndex(mine); if (at >= 0) msgs = msgs.slice(0, at);
  } else acpHistory.set(id, msgs);
  return msgs;
}
// 1.89 (F-8): a reply's own text, held in the queue while it waits for the closing process (waitingTurn), is not a queued message.
const shownQueue = id => { const t = turns.get(id); return followups.list(id).filter(x => !(x.held && t?.pending)); };
function queueError(res,e){return res.status(e.status||503).json({error:e.status?e.message:'Queue could not be saved. Refresh and try again.'});}
app.get('/api/session/:id/queue',requireAuth,(req,res)=>{
  if(!anyId(req.params.id))return res.status(400).json({error:'Invalid conversation'});
  const id=req.params.id;
  const jobs=isCx(id)||isAcpId(id)?[]:staleJobs(id); // 1.89.2: what the queue is waiting for
  res.json({items:shownQueue(id),active:Boolean(ownedTurn(id)),external:isCx(id)?codex.codexExtActive(codex.bareId(id)):extActive(id),...(jobs.length&&{waitingForJobs:jobList(jobs)})});
});
app.patch('/api/session/:id/queue/:item',requireAuth,(req,res)=>{
  if(req.body.editing===true){try{return res.json({item:followups.beginEdit(req.params.id,req.params.item,req.body.revision)});}catch(e){return queueError(res,e);}}
  const text=String(req.body.text||'').trim();if(!text||text.length>100000)return res.status(400).json({error:'Enter a message under 100,000 characters.'});
  try {res.json({item:followups.edit(req.params.id,req.params.item,req.body.revision,text)});}catch(e){queueError(res,e);}
});
app.delete('/api/session/:id/queue/:item',requireAuth,(req,res)=>{
  try {followups.remove(req.params.id,req.params.item,req.body.revision);res.json({ok:true});}catch(e){queueError(res,e);}
});
app.post('/api/session/:id/queue/start',requireAuth,async(req,res)=>{
  const id=req.params.id;if(!anyId(id))return res.status(400).json({error:'Invalid conversation'});
  if(ownedTurn(id)|| (isCx(id)?codex.codexExtActive(codex.bareId(id)):extActive(id)))return res.status(409).json({error:'A reply is running or activity was seen elsewhere. Wait before starting queued work.'});
  if(followups.list(id)[0]?.id!==req.body.itemId)return res.status(409).json({error:'The queue changed. Refresh before starting the next message.'});
  try {const started=await runNextFollowup(id,undefined,{replaceStale:req.body?.replaceStaleLogin===true});res.json({ok:true,started:Boolean(started)});}catch(e){queueError(res,e);}
});

// Per-thread callbacks for Codex turns; also handed to sessions reattached after a restart.
// They take the turn as an argument: a turn that fails during resume finishes before
// startCodexTurn has returned, so a closure can't reach a local binding yet.
function codexHooks(id) {
  return {
    auditApproval,onApproval:turn=>{const sid=id||(codex.CX+turn.threadId);const aid=turn.approvals.list().at(-1)?.id;if(aid&&turn.approvalNotified!==aid&&!mutes.has(sid)){turn.approvalNotified=aid;pushNotify(sid,'Waiting for your OK','Open Pocket Code to review the pending action.').catch(()=>{});}},
    onQuestion:turn=>{const sid=id||(codex.CX+turn.threadId);const qid=turn.questions.list().at(-1)?.id;if(!mutes.has(sid)&&turn.questionNotified!==qid){turn.questionNotified=qid;pushNotify(sid,'Codex has a question','Open Pocket Code to answer it.').catch(()=>{});}},
    onFinish: (ev, turn) => codexTurnFinished(id || (codex.CX + turn.threadId), turn, ev),
  };
}
// 1.87: the Claude Code commands that have a Codex counterpart. /compact and /review run Codex's own turns; /recap asks
// for the same short summary Claude's gives. (/context opens Pocket's context panel in the app.)
const RECAP_PROMPT = 'Sum up where this conversation stands: what was asked, what is done, what is left and anything waiting on me, in a few short lines.';
function codexCommand(text) {
  const m = /^\/(compact|review|recap)(?:\s+(.*))?$/i.exec(String(text || '').trim()); if (!m) return null;
  const arg = (m[2] || '').trim(), kind = m[1].toLowerCase();
  if (kind === 'compact') return { action: { kind } };
  if (kind === 'recap') return { prompt: RECAP_PROMPT };
  const commit = /^commit\s+([0-9a-f]{6,40})$/i.exec(arg);
  return { action: { kind, target: commit ? { type: 'commit', sha: commit[1] } : arg ? { type: 'baseBranch', branch: arg } : { type: 'uncommittedChanges' } } };
}
async function startCodexFromApi({ id, threadId, forkFrom, cwd, text, body, onForked }) {
  if (id) cancelRetry(id); // 1.87: a reply you start replaces a pending usage-limit resume, as on Claude
  if (id && threadId && await folderGone(id, cwd)) cwd = HOME; // 1.98: also moves a kept process out of the deleted folder
  if (!threadId || !codex.codexSessions.has(threadId)) reclaimProcess();
  const opts = withDefaults('codex', turnOpts(body));
  // 1.92: the context limit and subagent model; the leader is this turn's model, else Codex's own default
  opts.launch = codexLaunch(settings.contextPolicy, opts.model || codex.codexDefaultModel(), codex.codexNewestSol());
  const cmd = threadId ? codexCommand(text) : null; // a command needs a thread; on a new conversation it is just text
  if (id && !cmd && !codex.codexTurns.has(threadId)) text = coordNotice(id, text); // 1.99
  if (cmd?.prompt) return codex.startCodexTurn({ threadId, forkFrom, cwd, text: cmd.prompt, ...opts, ...codexHooks(id) });
  return codex.startCodexTurn({ threadId, forkFrom, cwd, text, ...opts, ...(cmd?.action ? { action: cmd.action } : {}), ...codexHooks(id), onForked });
}
// ---------- ACP/OpenRouter engine bridge (mirrors the codex bridge; gated on ACP_ON) ----------
function acpHooks(id) {
  return {
    auditApproval,
    onApproval: turn => { const sid = id || (acp.ACP + turn.sessionId); const aid = turn.approvals.list().at(-1)?.id; if (aid && turn.approvalNotified !== aid && !mutes.has(sid)) { turn.approvalNotified = aid; pushNotify(sid, 'Waiting for your OK', 'Open Pocket Code to review the pending action.').catch(() => { }); } },
    onQuestion: turn => { const sid = id || (acp.ACP + turn.sessionId); const qid = turn.questions.list().at(-1)?.id; if (!mutes.has(sid) && turn.questionNotified !== qid) { turn.questionNotified = qid; pushNotify(sid, 'OpenRouter has a question', 'Open Pocket Code to answer it.').catch(() => { }); } },
    instructions: sid => pocketInstructions('acp', sid),
    onFinish: (result, turn) => acpTurnFinished(id || (acp.ACP + turn.sessionId), turn, { ok: !turn.stopped && result.stopReason !== 'error', stopReason: result.stopReason, ...(result.error ? { error: result.error } : {}) }),
  };
}
async function startAcpFromApi({ id, sessionId, cwd, text, body, resume }) {
  if (id) cancelRetry(id); // 1.87: as on Claude and Codex
  if (id && resume && await folderGone(id, cwd)) { if (acp.acpSessions.get(acp.bareAcpId(id))?.cwd !== HOME) acp.closeAcpSession(id); cwd = HOME; } // 1.98
  if (id && resume && !ownedTurn(id)) text = coordNotice(id, text); // 1.99
  const opts = withDefaults('acp', turnOpts(body));
  const model = opts.model || ACP_CFG.curated[0];
  const levels = acpEfforts.map[model];
  const effort = opts.effort && opts.effort !== 'default' && (!levels || levels.includes(opts.effort)) ? opts.effort : null;
  // the session's running OpenRouter cost as last seen (OpenCode does not report it on reopen), for the cost line
  const costBaseline = id && Number.isFinite(smeta[id]?.acpCost) ? smeta[id].acpCost : null;
  // Attachments the way the other engines get them: the files named in the prompt (promptText), and images sent as
  // images too (OpenCode takes ACP image blocks), up to 10 MB each.
  const images = [];
  for (const f of opts.attachments || []) {
    const mimeType = IMAGE_MIME[path.extname(f).toLowerCase()];
    if (!mimeType) continue;
    try { const st = fs.statSync(f); if (st.size <= 10 * 1024 * 1024) images.push({ mimeType, data: fs.readFileSync(f).toString('base64') }); } catch { }
  }
  const bare = sessionId ? acp.bareAcpId(sessionId) : id ? acp.bareAcpId(id) : null;
  const launch = bare && acp.acpSessions.has(bare) ? acpLaunch() : acpTurnLaunch(); // a live process keeps its own config
  const turn = await acp.startAcpTurn({ sessionId: sessionId || id, cwd, text, prompt: promptText(text, opts.attachments), images, model, effort, approvalMode: opts.approvalMode, executionMode: opts.executionMode,
    costBaseline, ...launch, resume, hooks: acpHooks(id) });
  setSmeta(id || acp.ACP + turn.sessionId, { acpRunning: Date.now() }); // a restart mid-reply is recorded as a stop (below)
  return turn;
}
const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
// OpenRouter conversations in the list: OpenCode's own session/list, read through a throwaway `opencode acp`
// and cached, so the frequently polled list waits for OpenCode only on its first read.
const acpListCache = { at: 0, rows: [], pending: null };
function refreshAcpList() {
  if (!ACP_ON) return Promise.resolve();
  if (!acpListCache.pending) acpListCache.pending = acp.listAcpSessions({ ...acpLaunch(), limit: 200, hideCwd: ACP_PROBE_DIR })
    .then(rows => { acpListCache.rows = rows; acpListCache.at = Date.now(); })
    .catch(e => { acpListCache.at = Date.now(); log(`acp list failed: ${e.message}`); })
    .finally(() => { acpListCache.pending = null; });
  return acpListCache.pending;
}
// Reasoning-effort levels per OpenRouter model, as OpenCode offers them ({slug: [levels]}), probed at boot and
// every 6 hours in a folder of its own that the conversation list hides. Until the first probe lands the
// effort chip waits; a failed probe keeps the last good map.
const ACP_PROBE_DIR = path.join(DATA_DIR, 'data', 'acp-probe');
const acpEfforts = { at: 0, map: {}, pending: null };
function refreshAcpEfforts() {
  if (!ACP_ON) return Promise.resolve();
  if (!acpEfforts.pending) acpEfforts.pending = (async () => {
    fs.mkdirSync(ACP_PROBE_DIR, { recursive: true });
    acpEfforts.map = await acp.probeAcpEfforts({ ...acpLaunch(), cwd: ACP_PROBE_DIR });
    acpEfforts.at = Date.now();
  })().catch(e => log(`acp effort probe failed: ${e.message}`)).finally(() => { acpEfforts.pending = null; });
  return acpEfforts.pending;
}
if (ACP_ON) { refreshAcpEfforts(); setInterval(refreshAcpEfforts, 6 * 3600_000).unref(); }
// 1.86: the housekeeping Claude and Codex replies get. A reply silent for POCKET_STALL_MS that is not waiting on you is
// stopped; an OpenCode process with no reply for POCKET_ACP_IDLE_MS is closed (the next message reopens it).
const ACP_IDLE_MS = msSetting('POCKET_ACP_IDLE_MS', 20 * 60_000);
if (ACP_ON) setInterval(() => {
  for (const t of acp.stalledAcpTurns(STALL_MS)) { log(`acp turn stalled session=${acp.ACP + t.sessionId}`); acp.stopAcpTurn(t.sessionId, `Stopped: no activity for ${Math.round(STALL_MS / 60_000)} minutes`); }
  const closed = acp.closeIdleAcpSessions(ACP_IDLE_MS); if (closed) log(`acp closed ${closed} idle OpenCode process(es)`);
}, 60_000).unref();
// A reply that was running when Pocket stopped cannot be reattached (its OpenCode process went with Pocket): say so.
for (const id of overlayIds(smeta)) if (isAcpId(id) && smeta[id]?.acpRunning) setSmeta(id, { acpRunning: null, outcome: { kind: 'stopped', label: 'Stopped', at: Date.now(), error: 'Pocket restarted during this reply. Send it again to continue.' } });
// The history shown when an OpenRouter conversation opens (session/load replay), by session id. A live turn
// streams its own events; this is what came before it. Dropped when a turn ends.
const acpHistory = new Map();
async function acpTurnFinished(id, turn, ev) {
  const watching = turn.subs.size > 0;
  acpHistory.delete(id); acpListCache.at = 0;
  setSmeta(id, { acpRunning: null, ...(Number.isFinite(turn.session?.costTotal) ? { acpCost: turn.session.costTotal } : {}), ...(turn.context ? { acpContext: { ...turn.context, at: Date.now() } } : {}) });
  // 1.87: OpenRouter's own rate limits (429, "retry after") wait and pick up again, as Claude's and Codex's usage limits do
  const limited = !ev.ok && !turn.stopped && (turn.retryAttempt || 0) < 3 ? detectRateLimit(ev.error || '') : null;
  if (limited) {
    scheduleRetry(id, turn, limited.resetAt);
    recordOutcome(id, turn, ev, limited.resetAt);
    if (!mutes.has(id)) pushNotify(id, smeta[id]?.name || 'OpenRouter conversation', `Rate limited. Picks up again at ${fmtOwnerTime(limited.resetAt)}`).catch(() => { });
    return;
  }
  const settled = recordOutcome(id, turn, ev);
  retitler.request(id);
  // the reply's own messages carry times (the replayed history does not), which auto-keep matches files by
  if (!turn.stopped) autoKeepTurnFiles(id, turn.startedAt || 0, turn.events.filter(e => e.type === 'assistant').map(e => e.msg));
  if (!turn.stopped && ev.ok && followups.list(id)[0]?.status === 'pending') {
    if (ownedTurn(id)) return;
    await runNextFollowup(id, turn.cwd).catch(e => log(`acp queue start failed session=${id}: ${e.message}`));
    return;
  }
  if (!watching && !turn.stopped && !settled && !mutes.has(id)) pushNotify(id, smeta[id]?.name || 'OpenRouter conversation', ev.ok ? 'Ready' : 'Something went wrong. Tap to see what happened').catch(() => { });
}
if (CODEX_ON) codex.adoptCodexSessions(threadId => codexHooks(codex.CX + threadId));
if (CODEX_ON) codex.pruneTranscriptCache(); // 1.53.5: the on-disk transcript cache keeps its newest files only

function validateApprovalMode(req,res,next){
  try{approvalMode(req.body?.approvalMode,DEFAULT_APPROVAL_MODE,ALLOW_FULL_ACCESS);next();}
  catch(e){res.status(e.status||400).json({error:e.message});}
}
function validateTurnModel(req, res, next) {
  const provider = req.params.id ? engineForSessionId(req.params.id) : (['codex', 'acp'].includes(req.body?.provider) ? req.body.provider : 'claude');
  try { validateModel(provider, req.body?.model); next(); }
  catch (error) { res.status(error.status || 400).json({ error: error.message }); }
}
// 1.42: a message that looks like it carries a secret (a known key format, a private key, a card number, "password: …")
// is refused before a delivery receipt is recorded, so the composer can offer to store it in the Vault and send a
// placeholder instead, or the owner can send it anyway with allowSecrets. The log names kinds and counts, never text.
function secretGuard(req, res, next) {
  if (settings.secretGuard === false || req.body?.allowSecrets === true) return next();
  const text = String(req.body?.text || ''); if (!text) return next();
  let hits = []; try { hits = globalThis.PocketSecrets.scan(text, { mode: 'message' }); } catch (e) { log(`secret check failed: ${e.message}`); return next(); }
  if (!hits.length) return next();
  log(`message held: looks like ${hits.length} secret(s) (${[...new Set(hits.map(h => h.kind))].join(', ')})${req.params?.id ? ' session=' + req.params.id : ' new session'}`);
  res.status(422).json({ error: 'This message looks like it contains a secret, so it was not sent.', code: 'secret_detected', matches: hits.map(({ kind, label, name, vaultKind, start, end }) => ({ kind, label, name, vaultKind, start, end })) });
}
app.post('/api/session/:id/message', requireAuth, validateApprovalMode, validateTurnModel, secretGuard, withDeliveryReceipt(deliveryReceipts, async (req, res) => {
  const id = req.params.id;
  if(!anyId(id))return res.status(400).json({error:'Invalid conversation'});
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty message' });
  vaultAnswerFromMessage(id, text); // 1.41: "Allow zoho-books for this command" answers that session's pending Vault request
  const mode=req.body.mode || 'auto';
  if(!['auto','steer','queue'].includes(mode))return res.status(400).json({error:'Invalid delivery mode'});
  if(mode==='steer'&&!ownedTurn(id))return res.status(409).json({error:'The reply has ended. Review the conversation, then send a new message.'});
  if(mode==='queue'&&!ownedTurn(id)){
    if(!await engineOf(id).exists(id))return res.status(404).json({error:'Conversation not found'});
    try{const item=followups.add(id,{text,...turnOpts(req.body)});return res.status(202).json({ok:true,queued:true,paused:true,itemId:item.id});}
    catch(e){return queueError(res,e);}
  }
  if (isCx(id)) {
    const tid = codex.bareId(id);
    const running = codex.codexTurns.get(tid);
    if (running) {
      const opts = turnOpts(req.body);
      try { if (mode !== 'queue' && await codex.steerCodexTurn(tid, promptText(text, opts.attachments))) {
        const skipped = skipQuestions(running.questions);
        log(`steered message into running codex turn thread=${tid}${skipped ? ` skipped=${skipped} question request(s)` : ''}`);
        return res.status(202).json({ ok: true, steered: true, ...(skipped && { skippedQuestions: skipped }) });
      } } catch {return res.status(503).json({error:'Steering was not confirmed. Review the conversation before sending again.',code:'delivery_uncertain'});}
      if(mode==='steer')return res.status(409).json({error:'This reply cannot accept steering now. Choose After this reply to queue it.'});
      try {const item=followups.add(id,{text,...opts});return res.status(202).json({ok:true,queued:true,itemId:item.id});}
      catch(e){return queueError(res,e);}

    }
    try {
      const gone = await folderGone(id);
      await startCodexFromApi({ id, threadId: tid, text, body: req.body });
      return res.status(202).json({ ok: true, ...carriedOn(id, gone) });
    } catch (e) {
      return res.status(e.code === 409 ? 409 : e.code === 423 ? 423 : 500).json({ error: String(e.message) });
    }
  }
  if (isAcpId(id)) {
    if (!ACP_ON) return res.status(400).json({ error: 'the OpenRouter engine is not enabled on this box' });
    if (acp.acpTurnActive(id)) { // ACP has no mid-turn steer; queue after the current reply
      if (mode === 'steer') return res.status(409).json({ error: 'This reply cannot accept steering. Choose After this reply to queue it.' });
      try { const item = followups.add(id, { text, ...turnOpts(req.body) }); return res.status(202).json({ ok: true, queued: true, itemId: item.id }); }
      catch (e) { return queueError(res, e); }
    }
    try {
      const gone = await folderGone(id);
      await startAcpFromApi({ id, sessionId: acp.bareAcpId(id), text, body: req.body, resume: true });
      return res.status(202).json({ ok: true, ...carriedOn(id, gone) });
    } catch (e) { return res.status(e.code === 409 ? 409 : 500).json({ error: String(e.message) }); }
  }
  const file = await findSessionFile(id);
  let running = turns.get(id);
  // 1.86: a reply already running needs no transcript yet (a brand-new conversation's can be a moment behind)
  if (!file && !running) return res.status(404).json({ error: 'not found' });
  const meta = file ? await sessionMeta(file, id) : { cwd: running.cwd };
  const cwd = meta.cwd && fs.existsSync(meta.cwd) ? meta.cwd : HOME;
  if (running?.finalized) { await running.finalizeDone; running = turns.get(id); } // a turn that is just ending: send as the next turn, not a steer
  if (!running && busyElsewhere(id)) return res.status(409).json({ error: 'This conversation is being used in another app right now (code-server or a terminal). Send again once that reply has finished.' });
  if (running) {
    const opts = turnOpts(req.body);
    // steer first: inject into the running turn (model sees it at the next boundary);
    // fall back to the queue when the pipe is gone (adopted without its pipe) or closing
    if (mode !== 'queue' && steerTurn(running, promptText(text, opts.attachments))) {
      broadcast(running, { type: 'user', msg: { role: 'user', text, ts: new Date().toISOString() } });
      const skipped = running.controlOnly ? 0 : skipQuestions(running.questions); // the message is in first, so Claude reads it with the skip (1.82: a background subagent's question is not skipped)
      log(`steered message into running turn session=${id}${skipped ? ` skipped=${skipped} question request(s)` : ''}`);
      return res.status(202).json({ ok: true, steered: true, ...(skipped && { skippedQuestions: skipped }) });
    }
    if(mode==='steer')return res.status(409).json({error:'This reply cannot accept steering now. Choose After this reply to queue it.'});
    try {const item=followups.add(id,{text,...opts});return res.status(202).json({ok:true,queued:true,itemId:item.id});}
    catch(e){return queueError(res,e);}

  }
  // 1.89.2: background jobs hold the process on the earlier Claude login. The message waits in the queue and starts on the
  // current login once they finish; Stop background jobs and send now (queue/start with replaceStaleLogin) skips the wait.
  const jobs = req.body?.replaceStaleLogin === true ? [] : staleJobs(id);
  if (jobs.length) {
    try {
      const item = followups.add(id, { text, ...turnOpts(req.body), afterJobs: true });
      log(`message held until ${jobs.length} background job(s) on the earlier Claude login finish session=${id}`);
      return res.status(202).json({ ok: true, queued: true, afterJobs: true, jobs: jobList(jobs), itemId: item.id });
    } catch (e) { return queueError(res, e); }
  }
  try {
    const turn = startTurn({ sessionId: id, cwd, text, resume: true, ...turnOpts(req.body), replaceStale: req.body?.replaceStaleLogin === true });
    res.status(202).json({ ok: true, ...(turn.modelFallback ? { modelFallback: turn.modelFallback } : {}), ...carriedOn(id, Boolean(meta.cwd) && cwd !== meta.cwd) });
  } catch (e) {
    res.status(e.code === 409 ? 409 : 500).json({ error: String(e.message), ...(e.reason && { code: e.reason, jobs: e.jobs }) });
  }
}));

// ---------- 1.23: saved prompts and recent starts (New session screen) ----------
const promptStore = new PromptStore(path.join(DATA_DIR, 'saved-prompts.json'), { write: atomicWrite });
const promptError = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'Could not save prompts. Try again.' });
app.get('/api/prompts', requireAuth, (_req, res) => { res.setHeader('Cache-Control', 'private, no-store'); res.json(promptStore.list()); });
app.post('/api/prompts', requireAuth, (req, res) => { try { res.status(201).json({ prompt: promptStore.create(req.body || {}), ...promptStore.list() }); } catch (e) { promptError(res, e); } });
app.post('/api/prompts/order', requireAuth, (req, res) => { try { promptStore.order(req.body?.ids); res.json(promptStore.list()); } catch (e) { promptError(res, e); } });
app.patch('/api/prompts/:id', requireAuth, (req, res) => { try { res.json({ prompt: promptStore.update(req.params.id, req.body || {}), ...promptStore.list() }); } catch (e) { promptError(res, e); } });
app.delete('/api/prompts/:id', requireAuth, (req, res) => { try { promptStore.remove(req.params.id); res.json(promptStore.list()); } catch (e) { promptError(res, e); } });

// 1.49: a session started from a project card is linked to that project. A missing, finished or switched-off project
// never blocks the start; the session simply starts unlinked.
function linkStartedSession(project, id) {
  if (!project || !settings.projects) return;
  try { board.act({ action: 'link-session', project: String(project).slice(0, 80), session: id }, { actor: 'ui' }); log(`board link-session project=${project} session=${id} (started from the card)`); }
  catch (e) { log(`project link skipped project=${project} session=${id}: ${e.message}`); }
}
// 1.77: started from a start link (an Inbox alert's briefing): the Inbox entries that open that link remember the session.
function linkStartLink(start, id) {
  if (!start) return;
  const entry = starts.get(String(start));
  if (entry?.kind === 'handoff') { // 1.96: the card now opens this conversation, which says where it continued from
    try { starts.markStarted(entry.id, id); } catch (e) { log(`handoff ${entry.id} not marked started: ${e.message}`); }
    if (entry.from) setSmeta(id, { continuedFrom: entry.from, continuedFromTitle: entry.fromTitle || null, continuedAt: Date.now() });
  }
  if (!settings.inbox) return;
  try { for (const e of inboxStore.linkStart(String(start), id)) log(`inbox link-session id=${e.id} session=${id} (started from its start link)`); }
  catch (e) { log(`inbox link skipped start=${start} session=${id}: ${e.message}`); }
}
// 1.96: a handoff starts once, and never with more permission than the conversation that wrote it had.
function handoffOnce(handler) {
  return async (req, res) => {
    const entry = req.body?.start ? starts.get(String(req.body.start)) : null;
    if (entry?.kind !== 'handoff') return handler(req, res);
    if (entry.startedSession) return res.status(409).json({ error: 'That handoff already started.', code: 'start_used', id: entry.startedSession });
    if (startsClaimed.has(entry.id)) return res.status(409).json({ error: 'That handoff is starting.', code: 'start_starting' });
    startsClaimed.add(entry.id);
    if (entry.approvalMode === 'review') req.body.approvalMode = 'review';
    try { return await handler(req, res); } finally { startsClaimed.delete(entry.id); }
  };
}
app.post('/api/new', requireAuth, validateApprovalMode, validateTurnModel, secretGuard, withDeliveryReceipt(deliveryReceipts, handoffOnce(async (req, res) => {
  let cwd = String(req.body?.cwd || '').trim();
  if (LOCK_CWD && cwd !== DEFAULT_CWD) { if (cwd) log(`new session asked for ${cwd}; this Pocket starts every session in ${DEFAULT_CWD}`); cwd = DEFAULT_CWD; } // 1.55
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty message' });
  if (!cwd.startsWith('/') || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    return res.status(400).json({ error: 'invalid project directory' });
  }
  if (req.body?.provider === 'codex') {
    if (!CODEX_ON) return res.status(400).json({ error: 'codex not available on this box' });
    try { // Codex mints the thread id, so the client learns it from the response
      const turn = await startCodexFromApi({ threadId: null, cwd, text, body: req.body });
      if (!req.body?.project) try { promptStore.recordRecent({ text, cwd, provider: 'codex' }); } catch (e) { log(`recent prompt not saved: ${e.message}`); }
      linkStartedSession(req.body?.project, codex.CX + turn.threadId);
      linkStartLink(req.body?.start, codex.CX + turn.threadId);
      return res.status(202).json({ id: codex.CX + turn.threadId });
    } catch (e) { return res.status(500).json({ error: String(e.message) }); }
  }
  if (req.body?.provider === 'acp') {
    if (!ACP_ON) return res.status(400).json({ error: 'the OpenRouter engine is not enabled on this box' });
    try { // OpenCode mints the session id; the client learns it from the response
      const turn = await startAcpFromApi({ id: null, sessionId: null, cwd, text, body: req.body });
      const id = acp.ACP + turn.sessionId;
      acpListCache.at = 0; // the list picks the new conversation up on its next read
      // persist the engine config so the session resumes as acp with its model (session-schema slot)
      try { setSmeta(id, { engineConfig: { engine: 'acp', inferenceProvider: 'openrouter', model: turn.model } }); } catch { }
      if (!req.body?.project) try { promptStore.recordRecent({ text, cwd, provider: 'acp' }); } catch (e) { log(`recent prompt not saved: ${e.message}`); }
      linkStartedSession(req.body?.project, id);
      linkStartLink(req.body?.start, id);
      return res.status(202).json({ id });
    } catch (e) { return res.status(e.code === 409 ? 409 : 500).json({ error: String(e.message) }); }
  }
  const id = randomUUID();
  const opts = turnOpts(req.body);
  if (assistantOn() && router.on && (!opts.model || opts.model === 'default')) { // 1.62
    const pick = await router.pick(text, { offered: routerOffered(), maxEffort: maxEffort(), levels: routerConfig().levels });
    if (pick) { opts.model = pick.model; opts.effort = pick.effort; log(`router: ${pick.tier} → ${pick.model} ${pick.effort} (${pick.ms} ms) session=${id}`); }
  }
  try {
    const turn = startTurn({ sessionId: id, cwd, text, resume: false, ...opts });
    if (!req.body?.project) try { promptStore.recordRecent({ text, cwd, provider: 'claude' }); } catch (e) { log(`recent prompt not saved: ${e.message}`); }
    linkStartedSession(req.body?.project, id);
    linkStartLink(req.body?.start, id);
    res.status(202).json({ id, ...(turn.modelFallback ? { modelFallback: turn.modelFallback } : {}) });
  } catch (e) {
    res.status(e.code === 409 ? 409 : 500).json({ error: String(e.message) });
  }
})));

// Reviewed markers: the newest reply or failure time each session was opened or marked reviewed at.
// Stored here so every device agrees on what is still waiting. `seen` only moves forward; `restore`
// sets an exact value (Undo of Mark all reviewed), 0 clearing it.
app.post('/api/seen', requireAuth, (req, res) => {
  const ok = (id, at) => anyId(id) && Number.isFinite(at) && at >= 0 && at <= Date.now() + 86400000;
  const seen = Object.entries(req.body?.seen || {}), restore = Object.entries(req.body?.restore || {});
  if (seen.length + restore.length > 500) return res.status(400).json({ error: 'too many conversations' });
  let changed = 0;
  for (const [id, at] of seen) if (ok(id, at) && at > (smeta[id]?.seen || 0)) { smeta[id] = { ...smeta[id], seen: at }; changed++; }
  for (const [id, at] of restore) if (ok(id, at) && at !== (smeta[id]?.seen || 0)) {
    const m = { ...smeta[id], seen: at || undefined }; if (!at) delete m.seen;
    if (Object.keys(m).length) smeta[id] = m; else delete smeta[id]; changed++;
  }
  if (changed) saveSmeta();
  res.json({ ok: true, changed, seen: Object.fromEntries([...seen, ...restore].map(([id]) => [id, smeta[id]?.seen || 0])) });
});

app.post('/api/session/:id/pin', requireAuth, (req, res) => {
  const id = req.params.id;
  if (!anyId(id)) return res.status(400).json({ error: 'bad id' });
  setSmeta(id, req.body?.pinned ? { pin: true } : { pin: null, pinOrder: null }); // unpinning forgets its place
  log(`session ${isPinned(id) ? 'pinned' : 'unpinned'} session=${id}`);
  res.json({ ok: true, pinned: isPinned(id) });
});

// Pinned order, shared by every device: the client sends the pinned ids in the order it wants;
// each gets its index. Ids that are not pinned are ignored; pins left out keep recency order after these.
app.post('/api/pins/order', requireAuth, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (!ids || ids.length > 200 || !ids.every(id => typeof id === 'string' && anyId(id))) return res.status(400).json({ error: 'ids: up to 200 conversation ids' });
  const order = [...new Set(ids)].filter(isPinned);
  order.forEach((id, i) => { smeta[id] = { ...smeta[id], pinOrder: i }; });
  if (order.length) saveSmeta();
  log(`pin order set n=${order.length}`);
  res.json({ ok: true, order });
});

// custom title overlay — empty name reverts to the transcript-derived title.
// With titleSync on, a rename is also appended to the transcript as a custom-title
// record — the exact line Claude Code's own rename writes — so code-server and the
// `claude --resume` picker show it too. (A reset can't retract those records: their
// reader keeps the last non-empty custom-title, so reset only clears the overlay.)
app.post('/api/session/:id/rename', requireAuth, async (req, res) => {
  const id = req.params.id;
  if (!anyId(id)) return res.status(400).json({ error: 'bad id' });
  const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  setSmeta(id, { name: name || null });
  if (isCx(id)) {
    if (name && settings.titleSync) {
      try { await codex.setCodexThreadName(codex.bareId(id), name); }
      catch (e) { log(`codex rename failed session=${id}: ${e.message}`); }
    }
    log(`session renamed session=${id} name=${name ? JSON.stringify(name) : '(reset)'}`);
    return res.json({ ok: true, name: name || null });
  }
  if (name && settings.titleSync) {
    const file = await findSessionFile(id);
    if (file) {
      try { fs.appendFileSync(file, JSON.stringify({ type: 'custom-title', sessionId: id, customTitle: name }) + '\n'); }
      catch (e) { log(`custom-title append failed session=${id}: ${e.message}`); }
    }
  }
  log(`session renamed session=${id} name=${name ? JSON.stringify(name) : '(reset)'}${name && settings.titleSync ? ' (synced to transcript)' : ''}`);
  res.json({ ok: true, name: name || null });
});

// 1.52: Settings → Agents & instance → Claude models in the picker.
function claudeModelSettings() {
  const p = managedPolicy(), offer = claudeOffer();
  return { ...offer, env: ENV_CLAUDE_MODELS, saved: Array.isArray(settings.offeredClaudeModels),
    policy: { dir: MANAGED_DIR, files: p.files, limits: Boolean(modelPolicy()), error: p.error },
    pocketDefault: { configured: POCKET_DEFAULTS.claude.model || null, used: claudePocketModel() || null, label: claudeDefaultLabel() },
    found: { checkedAt: claudeFound.checkedAt, error: claudeFound.error, added: claudeFound.added.map(m => m.id) } }; // 1.91: the daily Anthropic model-list check
}
// server-wide options (titleSync). One tenant per install, so no per-user scoping.
app.get('/api/settings', requireAuth, async (_req, res) => {
  await Promise.race([refreshTitleProviders(30_000), new Promise(r => setTimeout(r, 6000))]); // Settings shows current availability
  res.json({ ...settings, assistantMode: assistantOn(), assistantLocked, autoKeepActive: autoKeepOn(), router: routerView(), access: accessView(), vault: vaultLive(), vaultReady: vaultReady(), vaultError: vaultError || null, vaultMode: vault ? vault.mode : null, vaultLocked: vault ? vault.locked : false, vaultKeyPresent: Boolean(VAULT_KEY_RAW), vaultCanCreateKey: vaultCanCreateKey(), vaultNeedsKey: vaultNeedsKey(), codexInstructionsOverridden: CODEX_ON && codex.instructionsOverridden(), titles: titleSettings(), email: emailSettings(), claudeModels: claudeModelSettings(), trusted: trustedSettings(), contextPolicy: contextPolicyView() });
});
app.post('/api/settings', requireAuth, (req, res) => {
  // 1.73.6: every field is checked into `next` first; nothing is assigned, rebuilt or written until all of them pass, so a
  // 400 on a later field leaves the earlier ones untouched and the next save cannot persist half a patch.
  const b = req.body || {}, next = {}, unset = new Set();
  let routerKey, routerTouched = false, accessTouched = false; // routerKey: undefined untouched, '' remove, else the key to save
  if (typeof b.assistantMode === 'boolean') {
    if (assistantLocked && !b.assistantMode) return res.status(409).json({ error: 'Assistant mode is locked on for this Pocket.' });
    next.assistantMode = b.assistantMode;
  }
  if (typeof b.autoKeepFiles === 'boolean') next.autoKeepFiles = b.autoKeepFiles;
  // 1.67: automatic model choice and one sign-in, from Settings.
  const rb = b.router;
  if (rb !== undefined) {
    if (rb === null) { unset.add('router'); routerKey = ''; routerTouched = true; }
    else if (typeof rb === 'object' && !Array.isArray(rb)) {
      const r = { ...(settings.router || {}) };
      if (typeof rb.enabled === 'boolean') r.enabled = rb.enabled;
      if (rb.provider !== undefined) { if (!ROUTER_PROVIDERS.includes(rb.provider)) return res.status(400).json({ error: 'Choose Jev or OpenAI.' }); r.provider = rb.provider; }
      if (rb.levels !== undefined) {
        if (rb.levels === null) delete r.levels;
        else {
          const lv = {};
          for (const t of TIERS) {
            const v = rb.levels?.[t.key]; if (!v) continue;
            const model = v.model === 'auto' || CATALOG_IDS.has(v.model) ? v.model : null, effort = v.effort === 'auto' || EFFORTS.has(v.effort) ? v.effort : null;
            if (!model || !effort) return res.status(400).json({ error: `Pick a model and effort for ${t.label}.` });
            if (model !== 'auto' && !isOffered(model)) return res.status(400).json({ error: `${t.label}: that model is not offered on this Pocket.` });
            if (model !== 'auto' || effort !== 'auto') lv[t.key] = { model, effort };
          }
          if (Object.keys(lv).length) r.levels = lv; else delete r.levels;
        }
      }
      if (rb.key !== undefined) {
        const k = String(rb.key || '').trim();
        if (k && (k.length > 400 || !/^[\x21-\x7e]+$/.test(k))) return res.status(400).json({ error: 'That does not look like an API key.' });
        routerKey = k;
      }
      const keyAfter = routerKey !== undefined ? Boolean(routerKey) : routerSavedKey();
      if (r.enabled && !keyAfter && !ROUTER_ENV.key) return res.status(400).json({ error: 'Add a key first: automatic model choice needs one.' });
      next.router = r; routerTouched = true;
    }
  }
  const ab = b.access;
  if (ab !== undefined) {
    if (ab === null) { unset.add('access'); accessTouched = true; }
    else if (typeof ab === 'object' && !Array.isArray(ab)) {
      if (ab.enabled === false) next.access = { enabled: false };
      else {
        const team = String(ab.team || '').trim().toLowerCase(), aud = String(ab.aud || '').trim();
        const emails = (Array.isArray(ab.emails) ? ab.emails : String(ab.emails || '').split(/[\s,]+/)).map(e => String(e).trim().toLowerCase()).filter(Boolean);
        if (!/^[a-z0-9-]{1,63}$/.test(team)) return res.status(400).json({ error: 'The team name is the part before .cloudflareaccess.com.' });
        if (!/^[A-Za-z0-9]{16,128}$/.test(aud)) return res.status(400).json({ error: 'The audience tag is the long code on the Access application’s Overview.' });
        if (!emails.length || emails.length > 50 || emails.some(e => !/^[\x21-\x7e]+@[\x21-\x7e]+\.[a-z]{2,}$/.test(e))) return res.status(400).json({ error: 'List the emails that may sign in this way, separated by commas.' });
        next.access = { enabled: true, team, aud, emails };
      }
      accessTouched = true;
    }
  }
  for (const k of ['titleSync', 'autoTitles', 'awaySummaries', 'liveTitles', 'projects', 'documents', 'tasks', 'inbox', 'coordination', 'secretGuard']) if (typeof b[k] === 'boolean') next[k] = b[k]; // inbox 1.69, secretGuard 1.42
  if (['auto', 'claude', 'codex'].includes(b.titleProvider)) next.titleProvider = b.titleProvider;
  if (b.remindAhead === 0 || b.remindAhead === 24) next.remindAhead = b.remindAhead; // 1.50: the day-before notice
  if (typeof b.notifyEmail === 'string') { const to = b.notifyEmail.trim(); if (to && !looksLikeEmail(to)) return res.status(400).json({ error: 'That does not look like an email address.', code: 'bad_email' }); next.notifyEmail = to; }
  if ('offeredClaudeModels' in b) { // 1.52: null = back to POCKET_CLAUDE_MODELS (or every model)
    const v = b.offeredClaudeModels;
    if (v === null) next.offeredClaudeModels = null;
    else {
      if (!Array.isArray(v) || v.length > 50 || v.some(x => typeof x !== 'string' || !CATALOG_IDS.has(x))) return res.status(400).json({ error: 'Choose models from the list.', code: 'bad_models' });
      const ids = [...new Set(v)], offer = resolveOffer({ saved: ids, policy: modelPolicy() });
      if (!offer.offered.length && offer.models.some(m => !m.blocked)) return res.status(400).json({ error: 'Keep at least one model on.', code: 'no_models' });
      next.offeredClaudeModels = CLAUDE_MODELS.map(m => m.id).filter(id => ids.includes(id));
    }
  }
  if ('contextPolicy' in b) { // 1.92: null = back to the agents' own behavior
    if (b.contextPolicy === null) next.contextPolicy = null;
    else { const c = cleanPolicy(b.contextPolicy, settings.contextPolicy); if (c.error) return res.status(400).json({ error: c.error, code: 'bad_context_policy' }); next.contextPolicy = isDefaultPolicy(c.policy) ? null : c.policy; }
  }
  if ('trustedActions' in b) { // 1.56: null = back to POCKET_TRUSTED_ACTIONS (or none)
    const v = b.trustedActions;
    if (v === null) next.trustedActions = null;
    else {
      const checked = validateRules(v);
      if (checked.error) return res.status(400).json({ error: checked.error, code: 'bad_trusted_action', rule: checked.rule ?? null, index: checked.index ?? null });
      next.trustedActions = checked.rules;
    }
  }
  let vaultToggled = false, createVaultKey = false;
  if (typeof b.vault === 'boolean' && b.vault !== settings.vault) { // 1.39: on needs the key; a change restarts idle runners so the rules reach them
    if (b.vault && !vault) {
      if (vaultNeedsKey()) return res.status(409).json({ error: 'This Vault exists but its key is missing on this server. Restore it from your recovery key.', code: 'vault_needs_key' });
      if (VAULT_KEY_PRESET) return res.status(409).json({ error: `The Vault cannot be opened with the POCKET_VAULT_KEY set in the daemon's environment: ${vaultError}`, code: 'vault_key_preset' }); // 1.73.6
      if (!vaultCanCreateKey()) return res.status(409).json({ error: `The Vault cannot be opened: ${vaultError}`, code: 'vault_no_key' });
      createVaultKey = true;
    }
    next.vault = b.vault; vaultToggled = true;
  }
  if (AUTO_LOCK_CHOICES.includes(Number(b.vaultAutoLockMinutes))) next.vaultAutoLockMinutes = Number(b.vaultAutoLockMinutes); // 1.40
  if (VAULT_ACCESS.includes(b.vaultAccess)) next.vaultAccess = b.vaultAccess; // 1.41
  // Everything passed: the side effects that can still fail come first (the Vault key), then the patch is applied once.
  let createdVaultKey = '';
  if (createVaultKey) {
    try { // 1.44: create this install's key, keep it in .env, open an empty store and save it
      const k = newVaultKey(); saveVaultKeyToEnv(k); const v = openVault(k); v.save();
      vault = v; VAULT_KEY_RAW = k; vaultError = ''; createdVaultKey = k;
      try { vault.audit({ action: 'key-created', by: 'owner' }); } catch (e) { log(`vault key-created audit row failed: ${e.message}`); } // 1.73.8: the key exists; the owner still gets it
      log('vault key created and saved to .env');
    } catch (e) { log(`vault key creation failed: ${e.message}`); return res.status(e.status || 500).json({ error: e.message, code: e.code || 'vault_key_failed' }); }
  }
  if (routerKey !== undefined) { if (routerKey) { const tmp = ROUTER_KEY_FILE + '.tmp'; fs.writeFileSync(tmp, routerKey, { mode: 0o600 }); fs.chmodSync(tmp, 0o600); fs.renameSync(tmp, ROUTER_KEY_FILE); } else try { fs.rmSync(ROUTER_KEY_FILE, { force: true }); } catch { } }
  if (next.vaultAccess !== undefined && settings.vaultAccess !== next.vaultAccess) log(`vault agent access: ${settings.vaultAccess} -> ${next.vaultAccess}`);
  const prevContextPolicy = settings.contextPolicy; // 1.92
  for (const k of unset) delete settings[k];
  Object.assign(settings, next);
  if (routerTouched) buildRouter();
  if (accessTouched) buildAccess();
  if ('offeredClaudeModels' in next) log(`claude models offered: ${claudeOffer().offered.join(',') || '(none)'} (${claudeOffer().source})`);
  if ('trustedActions' in next) log(`trusted actions: ${trustedRules().length} rule(s) (${trustedSettings().source})`);
  saveSettings();
  if (['projects', 'documents', 'tasks', 'inbox', 'coordination', 'assistantMode'].some(k => k in next) || vaultToggled) syncAgentSkills();
  if (vaultToggled) restartIdleRunners('vault setting changed');
  if ('contextPolicy' in next && JSON.stringify(readPolicy(next.contextPolicy)) !== JSON.stringify(readPolicy(prevContextPolicy))) { // 1.92
    log(`context policy: ${JSON.stringify(readPolicy(settings.contextPolicy))}`);
    restartIdleRunners('context policy changed');
  }
  log(`settings updated: assistantMode=${assistantOn()} titleSync=${settings.titleSync} autoTitles=${settings.autoTitles} titleProvider=${settings.titleProvider} awaySummaries=${settings.awaySummaries} liveTitles=${settings.liveTitles} projects=${settings.projects} documents=${settings.documents} tasks=${settings.tasks} inbox=${settings.inbox} vault=${settings.vault} vaultAccess=${settings.vaultAccess} secretGuard=${settings.secretGuard !== false}`);
  res.json({ ...settings, assistantMode: assistantOn(), assistantLocked, autoKeepActive: autoKeepOn(), router: routerView(), access: accessView(), vault: vaultLive(), vaultReady: vaultReady(), vaultError: vaultError || null, vaultMode: vault ? vault.mode : null, vaultLocked: vault ? vault.locked : false, vaultKeyPresent: Boolean(VAULT_KEY_RAW), vaultCanCreateKey: vaultCanCreateKey(), vaultNeedsKey: vaultNeedsKey(), codexInstructionsOverridden: CODEX_ON && codex.instructionsOverridden(), titles: titleSettings(), email: emailSettings(), claudeModels: claudeModelSettings(), trusted: trustedSettings(), contextPolicy: contextPolicyView(), ...(createdVaultKey ? { recoveryKey: createdVaultKey } : {}) });
});

app.post('/api/session/:id/mute', requireAuth, (req, res) => {
  const id = req.params.id;
  if (!anyId(id)) return res.status(400).json({ error: 'bad id' });
  if (req.body?.muted) mutes.add(id); else mutes.delete(id);
  saveMutes();
  log(`push ${mutes.has(id) ? 'muted' : 'unmuted'} session=${id}`);
  res.json({ ok: true, muted: mutes.has(id) });
});

// Closing a session view ends its CLI process now rather than at the idle timeout.
// 409 while a turn (or a background job) is running unless the caller chose to stop it.
app.post('/api/session/:id/release', requireAuth, (req, res) => {
  const id = req.params.id, stop = req.body?.stop === true;
  if (!anyId(id)) return res.status(400).json({ error: 'Invalid conversation' });
  if (isAcpId(id)) { // 1.86: an OpenRouter conversation's OpenCode process, as for Codex
    const live = acp.acpSessions.has(acp.bareAcpId(id));
    if (acp.ownedAcpTurn(id)) { if (!stop) return res.status(409).json({ running: true }); acp.stopAcpTurn(id); }
    if (live) acp.closeAcpSession(id);
    return res.json({ released: live });
  }
  if (isCx(id)) {
    const tid = codex.bareId(id), cs = codex.codexSessions.get(tid);
    if (codex.codexTurns.get(tid)) {
      if (!stop) return res.status(409).json({ running: true });
      codex.stopCodexTurn(tid);
      if (cs) codex.closeCodexSession(cs, 'closed by you');
      return res.json({ released: true });
    }
    if (cs && !cs.closing && !cs.exited) { codex.closeCodexSession(cs, 'closed by you'); return res.json({ released: true }); }
    return res.json({ released: false });
  }
  const turn = turns.get(id), r = runners.get(id);
  if ((turn || r?.bgTasks.length) && !stop) return res.status(409).json({ running: true, background: !turn });
  if (turn) { turn.stopped = true; signalTurn(turn); log(`stop requested (closed) session=${id}`); return res.json({ released: true }); }
  if (r && !r.closing && !r.exited) { if (r.bgTasks.length) signalTurn(r); else closeRunner(r, 'closed by you'); return res.json({ released: true }); }
  res.json({ released: false });
});

app.post('/api/session/:id/stop', requireAuth, (req, res) => {
  if (isAcpId(req.params.id)) {
    if (!acp.stopAcpTurn(req.params.id)) return res.status(404).json({ error: 'nothing is running' });
    log(`stop requested session=${req.params.id}`);
    return res.json({ ok: true });
  }
  if (isCx(req.params.id)) {
    if (!codex.stopCodexTurn(codex.bareId(req.params.id))) return res.status(404).json({ error: 'nothing is running' });
    log(`stop requested session=${req.params.id}`);
    return res.json({ ok: true });
  }
  const turn = turns.get(req.params.id);
  if (!turn) return res.status(404).json({ error: 'nothing is running' });
  turn.stopped = true;
  signalTurn(turn);
  log(`stop requested session=${req.params.id}`);
  res.json({ ok: true });
});

// ---------- 1.78: side chat ----------
// A private aside next to a Claude conversation (sidechat.mjs): it starts from the conversation's transcript,
// can read and search but not change anything, and adds nothing to the conversation. One per conversation.
const SIDE_ON = process.env.POCKET_SIDE_CHAT !== '0';
const sideChats = new SideChats({
  bin: CLAUDE_BIN, env: spawnEnv, normalize: normalizeLine, log,
  budgetUsd: Number(process.env.POCKET_SIDE_CHAT_BUDGET_USD ?? 5),
  idleMs: msSetting('POCKET_SIDE_CHAT_IDLE_MS', 30 * 60_000),
  max: Math.max(1, Math.floor(Number(process.env.POCKET_SIDE_CHAT_MAX ?? 4)) || 4),
  codex: CODEX_ON ? { AppServer: codex.AppServer, normalizeItem: codex.normalizeItem, config: codex.sideChatConfig } : null, // 1.79
});
process.on('exit', () => sideChats.closeAll('daemon stopped', null, { now: true })); // 1.89: no timer runs after exit
// The conversation's own model, so the aside reads the same context the same way: the live process's, else the
// one Assistant mode routed it to, else this Pocket's default.
function sideModel(id) {
  const r = runners.get(id);
  if (r?.model) return r.model;
  try { return withDefaults('claude', { model: smeta[id]?.routed?.model || 'default' }).model || null; } catch { return null; }
}
// 1.89 (S-2): a Claude side chat may search the web only when the conversation would do it without asking: its live
// process (else this Pocket's default) is in Full access, or the owner trusts WebSearch. The page sends the mode its next
// message would use (`approvalMode`, as the message routes do); one the server cannot use counts as review.
function sideSearch(id, requested) {
  let mode; try { mode = approvalMode(requested ?? (runners.get(id)?.approvalMode || DEFAULT_APPROVAL_MODE), DEFAULT_APPROVAL_MODE, ALLOW_FULL_ACCESS); } catch { mode = 'review'; }
  return mode === 'full' || Boolean(matchTrusted(trustedRules(), 'WebSearch', {}));
}
const sideView = c => ({ side: c.id, parent: c.parentId, provider: c.provider, model: c.model, busy: c.busy, closed: c.closed, total: c.provider === 'codex' ? null : c.total, turns: c.turns });
app.post('/api/session/:id/side', requireAuth, secretGuard, async (req, res) => {
  if (!SIDE_ON) return res.status(404).json({ error: 'Side chat is switched off on this Pocket.' });
  const id = req.params.id;
  if (isCx(id) && !CODEX_ON) return res.status(400).json({ error: 'Codex is not available on this server.' });
  if (!anyId(id)) return res.status(400).json({ error: 'Invalid conversation' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty message' });
  if (text.length > 100_000) return res.status(413).json({ error: 'That message is too long for a side chat.' });
  if (!isCx(id) && claudeLogin.active) return res.status(409).json({ error: 'Claude account sign-in is in progress. Finish or cancel it in Accounts & instance.' });
  let chat = req.body?.side ? sideChats.get(String(req.body.side)) : null;
  if (chat && chat.parentId !== id) return res.status(400).json({ error: 'That side chat belongs to another conversation.' });
  try {
    if ((!chat || chat.closed) && isCx(id)) { // 1.79: Codex
      const meta = await codex.codexThreadMeta(codex.bareId(id)).catch(() => null);
      if (!meta) return res.status(409).json({ error: 'Send a message in the conversation first, so the side chat has something to start from.' });
      chat = await sideChats.openCodex({ parentId: id, threadId: codex.bareId(id), cwd: !meta.cwd || fs.existsSync(meta.cwd) ? meta.cwd || undefined : HOME });
    } else if (!chat || chat.closed) {
      const file = await findSessionFile(id);
      if (!file) return res.status(409).json({ error: 'Send a message in the conversation first, so the side chat has something to start from.' });
      const meta = await sessionMeta(file, id);
      chat = sideChats.open({ parentId: id, cwd: meta.cwd && fs.existsSync(meta.cwd) ? meta.cwd : HOME, model: sideModel(id), allowSearch: sideSearch(id, req.body?.approvalMode) });
    }
    sideChats.send(chat, text);
    res.status(202).json({ ok: true, ...sideView(chat) });
  } catch (e) { res.status([400, 409, 410, 429, 502].includes(e.code) ? e.code : 500).json({ error: String(e.message) }); }
});
// The conversation's live side chat, if any (a reopened panel finds it again).
app.get('/api/session/:id/side', requireAuth, (req, res) => {
  const chat = sideChats.forParent(req.params.id);
  res.json({ enabled: SIDE_ON, chat: chat ? sideView(chat) : null });
});
app.get('/api/side/:side/events', requireAuth, (req, res) => {
  const chat = sideChats.get(req.params.side);
  if (!chat) return res.status(404).json({ error: 'This side chat has ended.' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const last = Number(req.headers['last-event-id']), from = Number.isFinite(last) ? last + 1 : Math.max(0, Number(req.query.from) || 0);
  const off = sideChats.subscribe(chat, res, from);
  if (chat.closed) return res.end();
  const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch { } }, 25000);
  req.on('close', () => { clearInterval(ka); off(); });
});
app.post('/api/side/:side/stop', requireAuth, (req, res) => {
  const chat = sideChats.get(req.params.side);
  if (!chat || !sideChats.stop(chat)) return res.status(404).json({ error: 'nothing is running' });
  res.json({ ok: true });
});
app.delete('/api/side/:side', requireAuth, (req, res) => {
  const chat = sideChats.get(req.params.side);
  if (chat) sideChats.close(chat, 'closed');
  res.json({ ok: true });
});

// ---------- 1.79: branch ----------
// A new, saved conversation that starts with everything in this one and carries on by itself (it can edit files and
// run commands, with the permissions chosen for it). The parent is only read. Claude: `--resume <parent>
// --fork-session --session-id <new>`; Codex: `thread/fork` in the new conversation's own app-server. Side chat is the
// unsaved, read-only aside; Branch is a real conversation.
const titleOf = id => { const m = smeta[id] || {}; return m.name || storedAutoTitle(id) || (m.branchOf ? 'Branch: ' + m.branchNote : null); };
// The conversation this one branched from, and the ones branched from it (newest first), from Pocket's own metadata.
function lineage(id) {
  const m = smeta[id] || {};
  const branchOf = m.branchOf ? { id: m.branchOf, title: m.branchOfTitle || 'the earlier conversation' } : null;
  const branches = Object.entries(smeta).filter(([k, v]) => k !== VERSION_KEY && v?.branchOf === id).sort((a, b) => (b[1].branchedAt || 0) - (a[1].branchedAt || 0))
    .slice(0, 20).map(([cid, v]) => ({ id: cid, title: titleOf(cid) || 'Branch: ' + v.branchNote, at: v.branchedAt || null }));
  // 1.96: handoffs. continuedIn is read from the children, as branches are, so one field can't disagree with the other.
  const continuedFrom = m.continuedFrom ? { id: m.continuedFrom, title: m.continuedFromTitle || 'the earlier conversation' } : null;
  const continuedIn = Object.entries(smeta).filter(([k, v]) => k !== VERSION_KEY && v?.continuedFrom === id).sort((a, b) => (b[1].continuedAt || 0) - (a[1].continuedAt || 0))
    .slice(0, 20).map(([cid, v]) => ({ id: cid, title: titleOf(cid) || 'New conversation', at: v.continuedAt || null }));
  return { branchOf, branches, continuedFrom, continuedIn };
}
// 1.97: a branch starts where the work is, not where the conversation began. Both engines fork into another folder
// (checked 2026-11-07: Claude Code keeps the history across folders, Codex takes cwd on thread/fork).
async function branchFolder(id, start) {
  const f = await conversationFolders(id).catch(() => null);
  return [f?.activePath, start].find(d => d && fs.existsSync(d)) || (start ? HOME : null); // 1.98: a forked Codex thread would keep the deleted folder
}
app.post('/api/session/:id/branch', requireAuth, validateApprovalMode, validateTurnModel, secretGuard, withDeliveryReceipt(deliveryReceipts, async (req, res) => {
  const id = req.params.id;
  if (!anyId(id)) return res.status(400).json({ error: 'Invalid conversation' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Say what the branch should do.' });
  const note = text.replace(/\s+/g, ' ').slice(0, 80);
  if (isCx(id)) {
    if (!CODEX_ON) return res.status(400).json({ error: 'Codex is not available on this server.' });
    const meta = await codex.codexThreadMeta(codex.bareId(id)).catch(() => null);
    if (!meta) return res.status(409).json({ error: 'Send a message in the conversation first, so the branch has something to start from.' });
    try {
      // 1.89 (F-3): the lineage is written as soon as thread/fork answers, before turn/start; a restart while the first
      // turn starts used to leave the saved fork with no parent. The write after it is for a fork the hook missed.
      const lineage = nid => { if (!smeta[nid]?.branchOf) setSmeta(nid, { branchOf: id, branchOfTitle: smeta[id]?.name || storedAutoTitle(id) || meta.title || null, branchNote: note, branchedAt: Date.now() }); };
      const folder = await branchFolder(id, meta.cwd);
      const turn = await startCodexFromApi({ threadId: null, forkFrom: codex.bareId(id), cwd: folder || undefined, text, body: req.body, onForked: tid => lineage(codex.CX + tid) });
      const nid = codex.CX + turn.threadId;
      lineage(nid);
      titler.request(nid, text);
      log(`branch session=${nid} from=${id}`);
      return res.status(202).json({ id: nid });
    } catch (e) { return res.status(e.code === 409 || e.code === 423 ? e.code : 500).json({ error: String(e.message) }); }
  }
  const file = await findSessionFile(id);
  if (!file) return res.status(409).json({ error: 'Send a message in the conversation first, so the branch has something to start from.' });
  const meta = await sessionMeta(file, id);
  const nid = randomUUID();
  try {
    const turn = startTurn({ sessionId: nid, cwd: await branchFolder(id, meta.cwd) || HOME, text, resume: false, fork: id, ...turnOpts(req.body) });
    setSmeta(nid, { branchOf: id, branchOfTitle: finishTitle(meta).title || null, branchNote: note, branchedAt: Date.now() });
    titler.request(nid, text);
    log(`branch session=${nid} from=${id}`);
    res.status(202).json({ id: nid, ...(turn.modelFallback ? { modelFallback: turn.modelFallback } : {}) });
  } catch (e) { res.status(e.code === 409 ? 409 : 500).json({ error: String(e.message) }); }
}));

// Attachments: raw body upload, filename via header. Files land in ~/pocket-uploads
// and are referenced by absolute path in the prompt (Claude Reads them; verified
// with an image 2026-08-14).
app.post('/api/upload', requireAuth, express.raw({ type: () => true, limit: '30mb' }), (req, res) => {
  const raw = String(req.headers['x-filename'] || 'file.bin');
  const safe = path.basename(raw).replace(/[^\w.\-]+/g, '_').slice(-80) || 'file.bin';
  if (!req.body?.length) return res.status(400).json({ error: 'empty upload' });
  const dir = path.join(UPLOAD_DIR, new Date().toISOString().slice(0, 7));
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${Date.now().toString(36)}-${safe}`);
  fs.writeFileSync(dest, req.body);
  log(`upload ${dest} (${req.body.length} bytes)`);
  res.json({ path: dest, name: safe, size: req.body.length });
});

// Slash-command discovery: user skills/commands + the session project's own.
function readSkillDesc(file) {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 2000);
    if(/^user-invocable:\s*false\s*$/mi.test(head))return null;
    // 1.89: only the front matter (between the leading --- lines; to the end of the read if it runs past it) names the
    // description; a description: line in the body is the skill's text, and a file with no front matter has none
    const front = /^﻿?---[ \t]*\r?\n([\s\S]*?)(?:\r?\n---[ \t]*(?:\r?\n|$)|$)/.exec(head)?.[1] || '';
    const m = front.match(/^description:\s*(.+)$/m);
    if (!m) return '';
    // 1.89: a YAML block (|) or folded (>) description is the more-indented lines under the key, not the indicator:
    // a block keeps its line breaks, a folded one reads as one line
    const block = /^([|>])[-+]?\d*\s*$/.exec(m[1]);
    if (!block) return m[1].replace(/^['"]|['"]$/g, '').slice(0, 90);
    const lines = [];
    for (const l of front.slice(m.index + m[0].length + 1).split('\n')) { if (l.trim() && !/^\s/.test(l)) break; lines.push(l); }
    const indent = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length));
    const text = block[1] === '|' ? lines.map(l => l.slice(indent).trimEnd()).join('\n') : lines.map(l => l.trim()).filter(Boolean).join(' ');
    return text.trim().slice(0, 90).trimEnd();
  } catch { return ''; }
}
app.get('/api/commands', requireAuth, async (req, res) => {
  const cwd = String(req.query.cwd || '');
  if (req.query.provider === 'acp') { // 1.86: OpenCode's own commands and skills, run by sending /name
    if (!ACP_ON) return res.json({ commands: [] });
    return res.json({ commands: acp.acpCommands().map(c => ({ name: c.name, label: c.name, desc: c.description, path: '', invocation: '/' + c.name + ' ' })) });
  }
  if(req.query.provider==='codex'){
    if(!CODEX_ON)return res.json({commands:[],warning:'Codex is not available on this instance.'});
    try{return res.json({commands:await codex.listCodexSkills(cwd.startsWith('/')?cwd:HOME)});}
    catch{return res.status(503).json({error:'Codex skills are unavailable. Try again, or describe your task directly.'});}
  }
  const out = new Map();
  const scan = base => {
    for (const kind of ['skills', 'commands']) {
      const dir = path.join(base, '.claude', kind);
      let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        // skills may be symlinked dirs (house convention) — probe for SKILL.md directly
        const sk = path.join(dir, e.name, 'SKILL.md');
        if (fs.existsSync(sk)) {
          const desc=readSkillDesc(sk);if (desc!==null && !out.has(e.name)) out.set(e.name,desc);
        } else if (e.isFile() && e.name.endsWith('.md')) {
          const name = e.name.replace(/\.md$/, '');
          const desc=readSkillDesc(path.join(dir,e.name));if (desc!==null && !out.has(name)) out.set(name,desc);
        }
      }
    }
  };
  if (cwd.startsWith('/') && cwd !== HOME && fs.existsSync(cwd)) scan(cwd);
  scan(HOME);
  for (const n of cliSlash || []) if (n.includes(':') && !out.has(n)) out.set(n, ''); // plugin skills (plugin:skill)
  res.json({ commands: [...out.entries()].map(([name, desc]) => ({ name, desc, label:name.replace(/^[^:]*:/,'').replace(/[-_]/g,' '), invocation:`Use the /${name} skill or command.` })).sort((a, b) => a.name.localeCompare(b.name)), available: cliSlash });
});

// Where a stream connection's replay starts: after the last event the browser saw
// (Last-Event-ID on an automatic reconnect), else after the events the client already
// has from the transcript (?from, sent on a fresh connection), else from the start.
function replayFrom(req, turn) {
  const last = Number(req.headers['last-event-id']);
  if (Number.isFinite(last)) return last + 1;
  const from = Number(req.query.from);
  return Number.isFinite(from) && from >= 0 ? Math.min(from, turn.events.length) : 0;
}
app.get('/api/session/:id/events', requireAuth, async (req, res) => {
  const id = req.params.id;
  const turn = turns.get(id);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch { } }, 25000);
  if (isCx(id)) {
    const tid = codex.bareId(id);
    const cxTurn = codex.codexTurns.get(tid);
    if (cxTurn) { // our own turn: replay what the client missed, then stream live
      res.write(`data: ${JSON.stringify({ type: 'attach', key: `${BOOT}:${cxTurn.startedAt}` })}\n\n`);
      const from = replayFrom(req, cxTurn);
      for (let i = from; i < cxTurn.events.length; i++) {
        res.write(`id: ${i}\ndata: ${JSON.stringify(cxTurn.events[i])}\n\n`);
      }
      cxTurn.subs.add(res);
      req.on('close', () => { clearInterval(ka); cxTurn.subs.delete(res); });
      return;
    }
    res.write(`data: {"type":"watch"}\n\n`);
    // id = item id: a reconnect (Last-Event-ID) or a reopen (?after) resumes after it
    const after = String(req.headers['last-event-id'] || req.query.after || '') || null;
    const stop = codex.watchCodexThread(tid, ev => { try { res.write(`${ev.itemId ? `id: ${ev.itemId}\n` : ''}data: ${JSON.stringify(ev)}\n\n`); } catch { } }, { after });
    req.on('close', () => { clearInterval(ka); stop(); });
    return;
  }
  if (isAcpId(id)) {
    const aTurn = acp.ownedAcpTurn(id);
    if (aTurn) { // our own acp turn: replay what the client missed, then stream live (same shape as codex/claude)
      res.write(`data: ${JSON.stringify({ type: 'attach', key: `${BOOT}:${aTurn.startedAt}` })}\n\n`);
      const from = replayFrom(req, aTurn);
      for (let i = from; i < aTurn.events.length; i++) res.write(`id: ${i}\ndata: ${JSON.stringify(aTurn.events[i])}\n\n`);
      aTurn.subs.add(res);
      req.on('close', () => { clearInterval(ka); aTurn.subs.delete(res); });
      return;
    }
    // no live turn: the history came with GET /api/session/:id (Pocket does not follow an OpenCode session written elsewhere)
    clearInterval(ka); res.write(`data: {"type":"idle"}\n\n`); return res.end();
  }
  if (turn) { // a turn our daemon is running: replay + live events
    res.write(`data: ${JSON.stringify({ type: 'attach', key: `${BOOT}:${turn.startedAt}` })}\n\n`);
    const from = replayFrom(req, turn);
    for (let i = from; i < turn.events.length; i++) {
      res.write(`id: ${i}\ndata: ${JSON.stringify(turn.events[i])}\n\n`);
    }
    turn.subs.add(res);
    req.on('close', () => { clearInterval(ka); turn.subs.delete(res); });
    return;
  }
  // watch mode: mirror the transcript live (turns driven by code-server / terminal)
  const file = await findSessionFile(id);
  if (!file) { clearInterval(ka); res.write(`data: {"type":"idle"}\n\n`); return res.end(); }
  const size = (await fsp.stat(file)).size;
  const last = Number(req.headers['last-event-id']);
  let offset = Number.isFinite(last) ? last : Number(req.query.offset);
  if (!Number.isFinite(offset) || offset < 0 || offset > size) offset = size;
  res.write(`data: {"type":"watch"}\n\n`);
  const t = { res, offset, rem: '' };
  if (!tailers.has(id)) tailers.set(id, new Set());
  tailers.get(id).add(t);
  req.on('close', () => { clearInterval(ka); tailers.get(id)?.delete(t); if (!tailers.get(id)?.size) tailers.delete(id); });
  pumpTail(id, file); // catch anything written between transcript fetch and connect
});

// ---------- 1.29: projects board ----------
app.get('/api/board', requireBoardAuth, boardOn, (req, res) => {
  const dir = typeof req.query.dir === 'string' ? req.query.dir : '';
  let snap;
  try { snap = board.snapshot({ dir }); } catch (e) { if (!e.status) throw e; return res.status(e.status).json({ error: e.message }); }
  res.set('Cache-Control', 'private, no-store').json({ ...snap, push: { enabled: pushReady }, hook: Boolean(REMINDER_HOOK), email: emailOn() });
});
app.post('/api/board/act', requireBoardAuth, boardOn, (req, res) => {
  const actor = req.boardActor || 'ui';
  try {
    const project = board.act(req.body || {}, { actor });
    log(`board ${req.body?.action} project=${project.id} by ${actor}`);
    res.set('Cache-Control', 'private, no-store').json({ ok: true, project });
  } catch (e) { if (!e.status) throw e; res.status(e.status).json({ error: e.message, ...(e.project ? { project: e.project } : {}) }); }
});
// One-time import of a Mission Control board snapshot; projects already here are left alone.
app.post('/api/board/import', requireBoardAuth, boardOn, (req, res) => {
  try {
    const r = board.importSnapshot(req.body, { actor: req.boardActor || 'ui' });
    log(`board import added=${r.added.length} skipped=${r.skipped.length} by ${req.boardActor || 'ui'}`);
    res.json({ ok: true, ...r });
  } catch (e) { if (!e.status) throw e; res.status(e.status).json({ error: e.message }); }
});

// ---------- 1.36: tasks routes ----------
app.get('/api/tasks', requireBoardAuth, tasksOn, (_req, res) => {
  res.set('Cache-Control', 'private, no-store').json({ ...taskStore.snapshot(), push: { enabled: pushReady }, hook: Boolean(REMINDER_HOOK), email: emailOn() });
});
// 1.37: a task an agent adds from a session (pocket-tasks add --session) gets that session's title and
// workspace, as the Add task button does, so the list names where it came from and Start opens in the right place.
async function sessionFacts(id) {
  try {
    if (isCx(id)) { const m = await codex.codexThreadMeta(codex.bareId(id)).catch(() => null); return m ? { title: m.title || '', cwd: m.cwd || '' } : null; }
    const file = await findSessionFile(id);
    if (!file) return null;
    const m = await sessionMeta(file, id);
    return { title: m.title || '', cwd: m.cwd || '' };
  } catch { return null; }
}
app.post('/api/tasks/act', requireBoardAuth, tasksOn, async (req, res) => {
  const actor = req.boardActor || 'ui';
  const body = { ...(req.body || {}) };
  if (body.action === 'add' && anyId(String(body.session || '')) && (!body.sessionTitle || !body.directory)) {
    const f = await sessionFacts(String(body.session));
    if (f) { body.sessionTitle ||= f.title; body.directory ||= f.cwd; }
  }
  try {
    const task = taskStore.act(body, { actor });
    log(`task ${body.action} task=${task.id} by ${actor}`);
    res.set('Cache-Control', 'private, no-store').json({ ok: true, task });
  } catch (e) { if (!e.status) throw e; res.status(e.status).json({ error: e.message, ...(e.task ? { task: e.task } : {}) }); }
});
// 1.57: start links. Both routes accept the owner's cookie or the loopback token (a direct loopback request only, as for
// the board), so a job on the server (Ari's inbox monitor) can mint a link and the CLI can show one; nothing else reads them.
// 1.96: a handoff. The parent is whatever the runner token proves, never anything in the body, so an agent can't claim
// another conversation or borrow its permissions. With no proven parent (a terminal, OpenRouter) the mode is Review actions.
function handoffFrom(req) {
  const c = vaultCaller(req), from = c.actor === 'agent' ? c.session : '';
  const parent = !from ? null : isCx(from) ? codex.codexSessions.get(codex.bareId(from))?.approvalMode : [...runners.values()].find(r => r.sessionId === from)?.approvalMode;
  return { from, fromTitle: from ? titleOf(from) || '' : '', approvalMode: parent === 'full' && DEFAULT_APPROVAL_MODE === 'full' ? 'full' : 'review' };
}
app.post('/api/start', requireBoardAuth, (req, res) => {
  try {
    const body = req.body || {}, handoff = body.kind === 'handoff' ? handoffFrom(req) : null;
    if (handoff && settings.secretGuard !== false && globalThis.PocketSecrets?.scan(String(body.text || ''), { mode: 'message' }).length) return res.status(422).json({ error: 'This briefing looks like it contains a secret. Store it in the Vault and refer to it by name.', code: 'secret_detected' });
    const provider = String(body.provider || '') || (handoff?.from ? (isCx(handoff.from) ? 'codex' : 'claude') : '');
    const entry = starts.add({ ...body, provider }, { actor: req.boardActor || 'ui', handoff, providers: ACP_ON ? ['claude', 'codex', 'acp'] : ['claude', 'codex'] });
    const base = publicBase();
    log(`start link ${entry.id} by ${req.boardActor || 'ui'}`);
    res.set('Cache-Control', 'private, no-store').json({ ok: true, id: entry.id, path: '/#/start/' + entry.id, url: base ? base + '/#/start/' + entry.id : null, expiresAt: entry.expiresAt });
  } catch (e) { if (!e.status) throw e; res.status(e.status).json({ error: e.message }); }
});
app.get('/api/start/:id', requireBoardAuth, (req, res) => {
  const entry = starts.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'That start link has expired or never existed.', code: 'start_missing' });
  const extra = entry.kind !== 'handoff' ? {} : { // 1.96: what the card shows before and after Start
    folderMissing: Boolean(entry.directory) && !LOCK_CWD && !fs.existsSync(entry.directory),
    ...(entry.startedSession ? { startedTitle: titleOf(entry.startedSession) || 'New conversation' } : {}) };
  res.set('Cache-Control', 'private, no-store').json({ ok: true, ...entry, ...extra });
});
// A briefing on a session for a task created from it: the whole session so far, through the titles helper model.
app.post('/api/tasks/summary', requireAuth, tasksOn, async (req, res) => {
  const id = String(req.body?.session || '');
  if (!anyId(id)) return res.status(400).json({ error: 'Invalid conversation' });
  refreshTitleProviders();
  const provider = helperProvider();
  if (!provider) return res.json({ summary: null, reason: 'unavailable' });
  let msgs;
  try {
    if (isCx(id)) msgs = (await codex.readCodexThread(codex.bareId(id), 600)).msgs;
    else { const file = await findSessionFile(id); if (!file) return res.status(404).json({ error: 'not found' }); msgs = (await readTranscript(file, 600)).msgs; }
  } catch { return res.status(502).json({ error: 'Could not read the conversation.' }); }
  const { digest, stats } = awayDigest(msgs);
  if (!stats.assistant) return res.json({ summary: null, reason: 'short' });
  const r = await summarizeForTask({ provider, claudeBin: CLAUDE_BIN, codexBin: codex.CODEX_BIN, models: helperModels(), env: spawnEnv() }, digest, String(req.body?.text || ''));
  if (r) log(`task summary session=${id} provider=${provider} model=${r.model}`);
  res.json(r ? { summary: r.summary, model: r.model, provider } : { summary: null, reason: 'failed' });
});

// 1.74: the owner's time zone, from the browser they sign in with (Inbox Watch's digest, quiet hours and look-ahead follow it).
function learnTimezone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64 || tz === settings.ownerTimezone) return;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { return; }
  settings.ownerTimezone = tz; saveSettings(); log(`owner time zone: ${tz}`);
}
// ---------- 1.69: inbox routes ----------
// Inbox Watch: the owner's cookie or the loopback token (a direct loopback request only, as for Tasks and start links).
// POST /api/inbox is the worker's one call: the entry, the push (kind alerts, urgent) and, when asked, the email.
const inboxError = (res, e) => { if (!e.status) throw e; res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) }); };
// The push and mail text: the first sentence, with [label](msg:<id>) citations (and any other Markdown link) reduced to their labels.
const plainCitations = t => String(t || '').replace(/\[([^\]\n]+)\]\([^)\s]*\)/g, '$1');
function firstSentence(text, max = 200) {
  const flat = plainCitations(text).replace(/\s+/g, ' ').trim();
  const m = /^.*?[.!?](?=\s+["“(]?[A-Z0-9]|$)/.exec(flat);
  const s = m ? m[0] : flat;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}
// Where a tap goes: the entry's link when it is a Pocket path (or the public address), else the entry itself. A web
// address elsewhere is the row's to open, never the push's: the service worker navigates Pocket's own window.
function inboxTapPath(entry) {
  const base = publicBase(), u = entry.url || '';
  if (u.startsWith('/')) return u;
  if (base && u.startsWith(base + '/')) return u.slice(base.length);
  return '/#/inbox/' + entry.id;
}
app.get('/api/inbox', requireBoardAuth, inboxOn, (req, res) => {
  try {
    const state = typeof req.query.state === 'string' && req.query.state ? req.query.state : 'new';
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;
    res.set('Cache-Control', 'private, no-store').json({ ...inboxStore.snapshot({ state, since }), push: { enabled: pushReady }, email: emailOn(), runner: inboxRunner.status() });
  } catch (e) { inboxError(res, e); }
});
app.post('/api/inbox', requireBoardAuth, inboxOn, async (req, res) => {
  const b = req.body || {}, actor = req.boardActor || 'ui';
  let entry;
  try { entry = inboxStore.add(b, { actor }); inboxStore.seen(entry.source); } catch (e) { return inboxError(res, e); }
  const duplicate = entry.duplicate === true;
  let devices = null, mail = false;
  if (!duplicate) {
    const tap = inboxTapPath(entry), body = firstSentence(entry.text);
    if (b.push !== false) devices = await pushRaw(entry.title, body, { tag: 'inbox:' + entry.id, url: tap, kind: 'alerts' });
    if (b.email === true) {
      if (!emailOn()) mail = 'off';
      else {
        const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const base = publicBase(), link = base ? base + tap : '', text = plainCitations(entry.text);
        try {
          await mailer.send({ to: settings.notifyEmail, subject: '[Pocket Code] ' + entry.title, text: text + (link ? '\n\n' + link : '') + (entry.gmail ? '\n\nGmail: ' + entry.gmail : ''),
            html: `<p>${esc(text).replace(/\n/g, '<br>')}</p>${link ? `<p><a href="${esc(link)}">Open in Pocket Code</a></p>` : ''}${entry.gmail ? `<p><a href="${esc(entry.gmail)}">Open in Gmail</a></p>` : ''}` });
          mail = true;
        } catch (e) { log(`inbox mail failed: ${e.message}`); mail = 'failed'; }
      }
    }
  }
  log(`inbox add kind=${entry.kind} id=${entry.id} by=${actor} push=${devices ?? 'off'} mail=${mail}${duplicate ? ' duplicate' : ''}`);
  res.set('Cache-Control', 'private, no-store').json({ ok: true, entry, push: devices, mail, duplicate });
});
app.post('/api/inbox/act', requireBoardAuth, inboxOn, (req, res) => {
  const actor = req.boardActor || 'ui';
  try {
    const entry = inboxStore.act(req.body || {}, { actor });
    log(`inbox ${req.body?.action} id=${entry.id} by=${actor} state=${entry.state}`);
    res.set('Cache-Control', 'private, no-store').json({ ok: true, entry });
  } catch (e) { inboxError(res, e); }
});
// The worker's side of the loop: the owner's decisions it has not applied, then an ack once it has.
app.get('/api/inbox/feedback', requireBoardAuth, inboxOn, (req, res) => {
  try { res.set('Cache-Control', 'private, no-store').json({ ok: true, feedback: inboxStore.feedback({ since: typeof req.query.since === 'string' ? req.query.since : undefined }) }); }
  catch (e) { inboxError(res, e); }
});
app.post('/api/inbox/ack', requireBoardAuth, inboxOn, (req, res) => {
  try { const acked = inboxStore.ack(req.body?.ids); if (acked) log(`inbox ack n=${acked} by=${req.boardActor || 'ui'}`); res.json({ ok: true, acked }); }
  catch (e) { inboxError(res, e); }
});
app.post('/api/inbox/seen', requireBoardAuth, inboxOn, (req, res) => {
  try { inboxStore.seen(req.body?.source, req.body?.at ?? undefined, req.body?.profile ?? undefined); res.json({ ok: true }); }
  catch (e) { inboxError(res, e); }
});
// 1.70: when the watcher checks and which models judge. The owner sets them in Settings → Inbox Watch (or an agent, when
// asked, through pocket-inbox watch set); the worker reads them every minute and reports back in its heartbeat's profile.
app.get('/api/inbox/watch', requireBoardAuth, inboxOn, (req, res) => {
  try { res.set('Cache-Control', 'private, no-store').json({ ok: true, ...inboxStore.watchView(typeof req.query.source === 'string' ? req.query.source : '') }); }
  catch (e) { inboxError(res, e); }
});
app.post('/api/inbox/watch', requireBoardAuth, inboxOn, (req, res) => {
  const actor = req.boardActor || 'ui', b = req.body || {};
  try {
    const src = typeof b.source === 'string' && b.source ? b.source : inboxStore.watchSource();
    const view = inboxStore.setWatch(src, b.settings ?? null, { actor });
    log(`inbox watch settings source=${view.source} revision=${view.revision} by=${actor}${view.settings ? '' : ' (config file)'}`);
    res.set('Cache-Control', 'private, no-store').json({ ok: true, ...view });
  } catch (e) { inboxError(res, e); }
});

// 1.75: Check now. Recorded here, handed to the watcher with its settings on its next one-minute read; it reports it done.
app.post('/api/inbox/check', requireBoardAuth, inboxOn, (req, res) => {
  const actor = req.boardActor || 'ui', b = req.body || {};
  try {
    const view = inboxStore.requestCheck(typeof b.source === 'string' && b.source ? b.source : '');
    log(`inbox check now source=${view.source} at=${view.checkRequestedAt} by=${actor}`);
    inboxRunner.kick();
    res.set('Cache-Control', 'private, no-store').json({ ok: true, ...view });
  } catch (e) { inboxError(res, e); }
});

// ---------- 1.99: coordination routes ----------
const coordHolderTitle = who => who?.session ? titleOf(who.session) || 'Untitled conversation' : '';
const coordShown = h => ({ ...h, holder: { ...h.holder, title: coordHolderTitle(h.holder) } });
const coordError = (res, e) => res.status(e.status || 500).json({ error: e.message, ...(e.code ? { code: e.code } : {}), ...(e.hold ? { hold: coordShown(e.hold), now: Date.now() } : {}) });
// Agents and terminals only: a person acts in Coordination, and a cookie must not pose as a holder.
function coordCaller(req, res) {
  const who = vaultCaller(req);
  if (who.actor === 'owner') { res.status(403).json({ error: 'Holds are claimed by conversations and terminals. Release one in Coordination.', code: 'cli_only' }); return null; }
  // OpenRouter is proved here only: the Vault still treats it as a terminal, so its access doesn't change with this release.
  const openrouter = ACP_ON && who.actor !== 'agent' ? acp.sessionForRunnerToken(String(req.get('x-pocket-runner') || '')) : null;
  const session = who.session || (openrouter ? acp.ACP + openrouter.sessionId : null);
  return session ? { kind: 'conversation', session } : { kind: 'terminal', session: null };
}
// One labeled message, in the approval mode the conversation asked with. It goes through the conversation's own queue, so
// someone's paused messages stay paused and first: it starts now only if it is first in line and nothing is running.
async function coordWake(offer, note = '') {
  for (let next = offer; next; next = coord.wakeNext(next.name)) {
    const id = next.session;
    let row;
    try {
      if (!await engineOf(id).exists(id)) throw new Error('the conversation is gone');
      row = followups.add(id, { text: `[Pocket coordination] ${next.name} is free. You asked to wait for it. It is not yours yet: claim it with pocket-coord hold before you go on, because someone else may have got there first.${note ? ` The last holder left this note: ${note}` : ''}`, ...next.run });
    } catch (e) { log(`coordination wake skipped name=${next.name} session=${id}: ${e.message}`); continue; }
    log(`coordination woke session=${id} for ${next.name}`);
    if (followups.list(id)[0]?.id === row.id && !ownedTurn(id)) await runNextFollowup(id, await engineOf(id).cwd(id)).catch(e => log(`coordination wake start failed session=${id}: ${e.message}`));
    return coordHolderTitle(next);
  }
  return null;
}
// What the holder has to be told when its hold ended without it, added once to the next message it gets. A slash command is
// the engine's to read, so it waits for the next ordinary message.
function coordNotice(id, text) {
  if (!coordLive() || /^\s*\//.test(text)) return text;
  const rows = coord.takeNotices(id);
  return rows.length ? `${text}\n\n${rows.map(r => `[Pocket: ${r}]`).join('\n')}` : text;
}
async function coordSweep() {
  if (!coordLive()) return;
  for (const offer of coord.sweep({ running: new Set(runningConversations()) })) await coordWake(offer);
}
setInterval(() => coordSweep().catch(e => log('coordination sweep: ' + e.message)), Math.max(100, Number(process.env.POCKET_COORD_SWEEP_MS) || 30_000)).unref();
app.get('/api/coordination', requireBoardAuth, coordOn, (_req, res) => {
  const view = coord.snapshot();
  res.set('Cache-Control', 'no-store').json({ ...view, holds: view.holds.map(h => ({ ...coordShown(h), waiters: h.waiters.map(w => ({ ...w, title: coordHolderTitle(w) })) })), recent: view.recent.map(coordShown) });
});
app.post('/api/coordination/hold', requireBoardAuth, coordOn, (req, res) => {
  const holder = coordCaller(req, res); if (!holder) return;
  const b = req.body || {};
  try { const out = coord.hold(b.name, { reason: b.reason, ttl: b.ttl, isNew: b.new === true, holder }); log(`coordination hold ${out.hold.name} by ${holder.session || 'terminal'}`); res.json({ ok: true, ...out }); }
  catch (e) { coordError(res, e); }
});
app.post('/api/coordination/wait', requireBoardAuth, coordOn, (req, res) => {
  const waiter = coordCaller(req, res); if (!waiter) return;
  const b = req.body || {}, turn = waiter.session ? ownedTurn(waiter.session) : null;
  const run = turn ? { approvalMode: turn.approvalMode, executionMode: turn.executionMode, model: turn.model, effort: turn.effort } : {};
  try { const out = coord.wait(b.name, { waiter, block: b.block === true, id: typeof b.id === 'string' ? b.id : '', run }); res.json({ ...out, ...(out.hold ? { hold: coordShown(out.hold) } : {}), now: Date.now() }); }
  catch (e) { coordError(res, e); }
});
app.post('/api/coordination/wait/cancel', requireBoardAuth, coordOn, (req, res) => {
  if (!coordCaller(req, res)) return;
  try { res.json({ ok: coord.cancelWait(req.body?.name, { id: String(req.body?.id || '') }) }); }
  catch (e) { coordError(res, e); }
});
app.post('/api/coordination/release', requireBoardAuth, coordOn, async (req, res) => {
  const by = coordCaller(req, res); if (!by) return;
  try { const { name, next, note } = coord.release(req.body?.name, { by, note: req.body?.note }); log(`coordination release ${name} by ${by.session || 'terminal'}`); res.json({ ok: true, name, woke: next ? await coordWake(next, note) : null }); }
  catch (e) { coordError(res, e); }
});
app.post('/api/coordination/owner-release', requireAuth, coordOn, sameOrigin, async (req, res) => {
  try { const { name, next } = coord.ownerRelease(req.body?.name); log(`coordination owner released ${name}`); res.json({ ok: true, name, woke: next ? await coordWake(next) : null }); }
  catch (e) { coordError(res, e); }
});
// ---------- 1.39: vault routes ----------
// Who is calling: the owner (cookie), an agent inside a Pocket session (CLI token plus the runner token Pocket put in
// its environment), or a terminal/code-server agent (CLI token alone). Owner-only routes take the cookie only.
// 1.73.3: tokens are compared in constant time on their digests, so lengths and early mismatches say nothing.
const sameToken = (a, b) => Boolean(a && b) && timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
function vaultCaller(req) {
  if (req.boardActor !== 'cli') return { actor: 'owner', session: null, sessionTitle: '' };
  const token = String(req.get('x-pocket-runner') || '');
  if (token) {
    const tokenHash = createHash('sha256').update(token).digest('hex'); // 1.73.4: recorded on the request row, never the token itself
    for (const r of runners.values()) if (sameToken(r.runnerToken, token) && !r.exited) return { actor: 'agent', session: r.sessionId, sessionTitle: sessionName(r.sessionId), tokenHash };
    const cx = CODEX_ON ? codex.sessionForRunnerToken(token) : null;
    if (cx) return { actor: 'agent', session: 'cx:' + cx.threadId, sessionTitle: sessionName('cx:' + cx.threadId), tokenHash };
  }
  return { actor: 'terminal', session: null, sessionTitle: '', tokenHash: null };
}
const sessionName = id => { const m = smeta[id]; return (m && typeof m.name === 'string' && m.name) || ''; };
// 1.41: the owner can answer a pending request in the conversation that raised it: "Allow zoho-books for this command",
// "Always allow zoho-books for this command", "Deny zoho-books" (the suggested replies agents offer), or a bare "Allow"/"Deny"
// when that session has exactly one pending request. Only the owner's own messages (cookie) reach here; the message is
// still delivered, so the agent sees the answer and continues with `pocket-vault wait`.
function vaultAnswerFromMessage(sessionId, text) {
  if (!vault || vault.locked || !settings.vault) return null;
  const pending = vault.pendingFor(sessionId); if (!pending.length) return null;
  const t = String(text).trim().replace(/[.!]+$/, '');
  const m = /^(always allow|allow|approve|deny|don't allow|do not allow)\b\s*(.*)$/i.exec(t); if (!m || t.length > 200) return null;
  const verb = m[1].toLowerCase(), rest = m[2].toLowerCase();
  const named = pending.filter(r => r.itemNames.some(n => new RegExp(`(^|[^a-z0-9-])${n.replace(/[-]/g, '\\-')}([^a-z0-9-]|$)`).test(rest)));
  const target = named.length === 1 ? named[0] : (pending.length === 1 && !named.length ? pending[0] : null);
  if (!target) return null;
  const decision = verb === 'always allow' ? (target.allowAlways === false ? 'once' : 'always') : /^(allow|approve)$/.test(verb) ? 'once' : 'deny';
  try { vault.answer(target.id, decision); log(`vault request=${target.id} answered ${decision} from the conversation session=${sessionId}`); return { request: target.id, decision }; }
  catch (e) { log(`vault answer from the conversation failed: ${e.message}`); return null; }
}
// Cookie mutations must come from Pocket's own origin.
function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (req.boardActor === 'cli' || !origin) return next();
  let host = ''; try { host = new URL(origin).host; } catch { }
  if (host && host === req.get('host')) return next();
  res.status(403).json({ error: 'Cross-origin request refused.' });
}
const vaultNoStore = (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };
// 1.39: a changed Vault setting restarts idle runners so the new per-turn instructions reach them; running turns finish first.
function restartIdleRunners(why) {
  for (const r of [...runners.values()]) if (!r.turn && !r.bgTasks.length && !r.closing && !r.exited) closeRunner(r, why);
  if (CODEX_ON) for (const s of [...codex.codexSessions.values()]) if (!s.turn && !s.closing && !s.exited) codex.closeCodexSession(s, why);
}
app.get('/api/vault', requireBoardAuth, vaultOn, vaultNoStore, (req, res) => {
  const c = vaultCaller(req);
  if (vault.locked) return res.json({ version: 1, now: Date.now(), ready: false, locked: true, mode: vault.mode, items: [], trash: [], requests: [], openRequests: 0, push: { enabled: pushReady } });
  res.json({ ...vault.snapshot({ owner: c.actor === 'owner' }), mode: vault.mode, locked: false, push: { enabled: pushReady } });
});
// 1.40: lock, unlock, the passphrase, export and import. Owner only; a wrong passphrase is rate-limited like the login.
// 1.81 (#177): only wrong tries count, ten an hour per address, and a right one clears them. Every try used to count, so an
// owner who locked and unlocked often was locked out for an hour. A recovery key that does not open the store counts too.
// 1.89 (S-6): and fifty wrong tries an hour across the whole instance (every session, unlock and restore-key together, kept
// under the key '*'), a backstop for whatever can mint sessions without the login's limit (a replayed Access token).
const unlockFails = new Map(), UNLOCK_CAP = { key: 10, all: 50 };
const unlockCount = k => { const rec = unlockFails.get(k); if (rec && rec.resetAt < Date.now()) unlockFails.delete(k); return unlockFails.get(k)?.n || 0; };
function tooManyUnlocks(ip) {
  if (unlockCount(ip) >= UNLOCK_CAP.key) return true;
  if (unlockCount('*') < UNLOCK_CAP.all) return false;
  const rec = unlockFails.get('*'); if (!rec.logged) { rec.logged = true; log(`vault: ${UNLOCK_CAP.all} wrong passphrases or keys within the hour across all sessions; every unlock and key restore waits until ${new Date(rec.resetAt).toISOString()}`); }
  return true;
}
function unlockFailed(ip) { const now = Date.now(); for (const k of [ip, '*']) { const rec = unlockFails.get(k); if (!rec || rec.resetAt < now) unlockFails.set(k, { n: 1, resetAt: now + 3600_000 }); else rec.n += 1; } }
// 1.89 (S-6): the tries count per signed-in session, not per address: the limit is there to stop a session guessing the
// passphrase, a header can name any address, and a new session can only be had through the login's own limit. The key is
// a hash of the session cookie; a request signed in by its Access token alone counts under that email, and anything else
// (none reaches these routes today) under clientAddress. An unexpected error still goes to Express as a throw did.
async function vaultTryKey(req) {
  const c = getCookie(req, 'pc_auth');
  if (checkCookie(c)) { const [exp, sig] = c.split('.'); return 'session:' + createHash('sha256').update(exp + '.' + sig).digest('hex'); } // the parsed session, not its spelling
  if (req.accessResult?.email) return 'access:' + req.accessResult.email;
  return 'address:' + await clientAddress(req);
}
app.post('/api/vault/unlock', requireAuth, vaultOn, sameOrigin, vaultNoStore, (req, res, next) => vaultTryKey(req).then(ip => {
  if (tooManyUnlocks(ip)) return res.status(429).json({ error: 'Too many tries. Wait an hour.' });
  try { vault.unlock(String(req.body?.passphrase || '')); unlockFails.delete(ip); log('vault unlocked by the owner'); res.json({ ok: true }); }
  catch (e) { if (!e.status) throw e; if (e.status === 401) unlockFailed(ip); log(`vault unlock refused: ${e.message}`); res.status(e.status).json({ error: e.message }); }
}).catch(next));
app.post('/api/vault/lock', requireAuth, vaultOn, sameOrigin, vaultNoStore, (_req, res) => {
  try { vault.lock(); log('vault locked by the owner'); res.json({ ok: true }); } catch (e) { if (!e.status) throw e; res.status(e.status).json({ error: e.message }); }
});
app.post('/api/vault/passphrase', requireAuth, vaultOn, vaultOpen, sameOrigin, vaultNoStore, (req, res) => {
  const b = req.body || {};
  try {
    if (b.action === 'set') {
      if (vault.mode === 'passphrase' && !vault.checkPassphrase(String(b.current || ''))) return res.status(401).json({ error: 'The current passphrase is wrong.' });
      vault.setPassphrase(String(b.passphrase || ''), String(b.confirm || '')); log('vault passphrase set'); return res.json({ ok: true, mode: vault.mode });
    }
    if (b.action === 'remove') { vault.removePassphrase(String(b.passphrase || '')); log('vault passphrase removed; back to the server key'); return res.json({ ok: true, mode: vault.mode }); }
    res.status(400).json({ error: 'Unknown action.' });
  } catch (e) { if (!e.status) throw e; res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) }); }
});
app.post('/api/vault/export', requireAuth, vaultOn, vaultOpen, sameOrigin, vaultNoStore, (req, res) => {
  try {
    const buf = vault.exportBundle(String(req.body?.passphrase || ''), String(req.body?.confirm || ''));
    log('vault exported by the owner');
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="pocket-vault-export-${new Date().toISOString().slice(0, 10)}.pvault"`, 'X-Content-Type-Options': 'nosniff' }).send(buf);
  } catch (e) { if (!e.status) throw e; res.status(e.status).json({ error: e.message }); }
});
app.post('/api/vault/import', requireAuth, vaultOn, vaultOpen, sameOrigin, vaultNoStore, (req, res) => {
  try {
    const data = String(req.body?.data || ''); if (!data) return res.status(400).json({ error: 'Choose an export file.' });
    const r = vault.importBundle(Buffer.from(data, 'base64'), String(req.body?.passphrase || ''));
    log(`vault import: ${r.added} added, ${r.skipped.length} skipped`);
    res.json({ ok: true, ...r });
  } catch (e) { if (!e.status) throw e; res.status(e.status).json({ error: e.message }); }
});
// 1.93 (Damon): the request notification says plainly what is asked: "Allow ptvip-staging-damon-wp?" over "Fix the staging
// login wants to use it for: wp plugin list". A tap on its body opens that request in the Vault (it never approves); only the
// Allow button answers, once.
function vaultPushText(r, what) {
  const names = r.itemNames.join(', '), who = r.session ? (r.sessionTitle || 'An agent') : 'A terminal';
  return [`Allow ${names}?`, `${who} wants to use ${r.itemNames.length > 1 ? 'them' : 'it'} ${what}`];
}
const vaultPushOpts = r => ({ tag: 'vault:' + r.id, url: '/#/vault/request/' + encodeURIComponent(r.id), kind: 'vault', vaultRequest: r.id, actions: [{ action: 'allow', title: 'Allow' }, { action: 'deny', title: 'Deny' }] });
app.post('/api/vault/act', requireBoardAuth, vaultOn, vaultOpen, sameOrigin, vaultNoStore, (req, res) => {
  const c = vaultCaller(req), body = req.body || {};
  try {
    const out = vault.act(body, c);
    log(`vault ${body.action} ${out.name ? 'item=' + out.name : out.id ? 'request=' + out.id : ''} by ${c.actor}${c.session ? ' session=' + c.session : ''}`);
    res.json(body.action === 'answer' ? { ok: true, request: out } : { ok: true, item: out, ...(out.removed ? { removed: true } : {}) });
  } catch (e) {
    if (!e.status) throw e;
    if (body.action === 'answer') log(`vault answer request=${String(body.request || '').slice(0, 40)} refused ${e.status}: ${e.message}`); // 1.93: a notification Allow that did not land shows in the log
    res.status(e.status).json({ error: e.message, ...(e.item ? { item: e.item } : {}), ...(e.code ? { code: e.code } : {}) });
  }
});
// One value, for the owner, on tap; recorded.
app.post('/api/vault/field', requireAuth, vaultOn, vaultOpen, sameOrigin, vaultNoStore, (req, res) => {
  try { res.json({ value: vault.field(String(req.body?.item || ''), String(req.body?.field || '')) }); }
  catch (e) { if (!e.status) throw e; res.status(e.status).json({ error: e.message }); }
});
app.get('/api/vault/audit', requireBoardAuth, vaultOn, vaultOpen, vaultNoStore, (req, res) => {
  const c = vaultCaller(req);
  let item = String(req.query.item || '');
  if (!item && req.query.name) item = vault.byName(String(req.query.name))?.id || '-';
  res.json({ rows: vault.auditRows({ item: item || undefined, session: c.session, owner: c.actor === 'owner', limit: Number(req.query.limit) || 50 }) });
});
// Rotation: the store is rewritten under a new key, shown once; the old key keeps working until the daemon restarts with the new .env.
app.post('/api/vault/rotate', requireAuth, vaultOn, vaultOpen, sameOrigin, vaultNoStore, (_req, res) => {
  if (vault.mode !== 'key') return res.status(400).json({ error: 'Rotation applies to the server key; the Vault is protected by a passphrase.' });
  if (VAULT_KEY_PRESET) return res.status(409).json({ error: 'POCKET_VAULT_KEY is set in the daemon\'s environment, not in .env, so a rotation could not be kept. Move the key into .env, remove it from the environment, restart Pocket, then rotate.', code: 'vault_key_preset' }); // 1.73.6
  const key = newVaultKey(), old = VAULT_KEY_RAW;
  let rotated = false;
  try {
    saveVaultKeyToEnv(key, { previous: old }); // both keys saved before the store changes, so a crash between still opens it
    vault.rotate(key); rotated = true; VAULT_KEY_RAW = key; // 1.73.6: the store takes the new key only once the file holds it
    saveVaultKeyToEnv(key);                   // the store is rewritten: the old key goes
  } catch (e) {
    log(`vault key rotation failed: ${e.message}`);
    if (!rotated) try { saveVaultKeyToEnv(old); } catch { } // the store is still under the old key: .env goes back to it
    return res.status(e.status || 500).json({ error: e.message });
  }
  vault.audit({ action: 'rotate', by: 'owner' });
  log('vault key rotated and saved to .env');
  res.json({ key, saved: true });
});
// 1.44: the owner can take a copy of the key at any time (recorded); and restore a missing one from that copy.
app.post('/api/vault/recovery-key', requireAuth, vaultOn, vaultOpen, sameOrigin, vaultNoStore, (_req, res) => {
  if (vault.mode !== 'key' || !vault.envKey) return res.status(400).json({ error: 'The Vault is protected by a passphrase; there is no server key to save.' });
  vault.audit({ action: 'recovery-key-view', by: 'owner' });
  res.json({ key: vault.envKey.toString('base64') }); // 1.73.6: the key the store is written under, whatever a failed rotation left elsewhere
});
app.post('/api/vault/restore-key', requireAuth, sameOrigin, vaultNoStore, (req, res, next) => vaultTryKey(req).then(ip => { // 1.89 (S-6): per signed-in session
  if (tooManyUnlocks(ip)) return res.status(429).json({ error: 'Too many tries. Wait an hour.' });
  if (!vaultNeedsKey()) return res.status(409).json({ error: 'The Vault does not need its key restored.' });
  let k, v; try { k = normalKey(req.body?.key || ''); v = openVault(k); } catch { unlockFailed(ip); log('vault key restore refused: the key does not open the store'); return res.status(400).json({ error: 'That key does not open this Vault.' }); }
  unlockFails.delete(ip);
  try { saveVaultKeyToEnv(k); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  vault = v; VAULT_KEY_RAW = k; vaultError = ''; vault.audit({ action: 'key-restored', by: 'owner' });
  log('vault key restored from the recovery key and saved to .env');
  res.json({ ok: true });
}).catch(next));
// A run: the daemon binds the values, checks policy, asks the owner when it must, spawns the child itself and streams
// scrubbed output back as JSON lines. The CLI never receives a value.
const vaultRuns = new Set();
async function vaultRun(req, res, { argv, cwd, env, timeout, wait, request: existing }) {
  const c = vaultCaller(req);
  res.status(200).set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' });
  const send = ev => { try { res.write(JSON.stringify(ev) + '\n'); } catch { } };
  const beat = setInterval(() => send({ t: 'beat' }), 20_000);
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); }); // the CLI went away: stop the child (a request's own close fires once its body is read)
  const end = () => { clearInterval(beat); try { res.end(); } catch { } };
  try {
    let reqRow = null, bound, cmd;
    if (existing) {
      reqRow = vault.continuation(existing, { action: 'run', caller: c }); // 1.73.4: this caller's own run request, not yet used; anything else is refused before the wait
    } else {
      bound = vault.resolveBindings(env); cmd = { ...vault.checkCommand(argv, cwd), action: 'run' };
      const need = vault.decide(bound, cmd);
      if (need.length) {
        reqRow = vault.request({ bound, cmd, need, env, session: c.session, sessionTitle: c.sessionTitle, by: c.actor, tokenHash: c.tokenHash });
        send({ t: 'request', id: reqRow.id, items: reqRow.itemNames });
        const devices = await pushRaw(...vaultPushText(reqRow, `for: ${cmd.argv.join(' ').slice(0, 80)}`), vaultPushOpts(reqRow));
        log(`vault request=${reqRow.id} items=${reqRow.itemNames.join(',')} by ${c.actor}${c.session ? ' session=' + c.session : ''} push=${devices ?? 'off'}`);
      }
    }
    if (reqRow) {
      const waitMs = Math.min(VAULT_LIMITS.waitMax, Math.max(1, Number(wait) || 90)) * 1000;
      const answered = await vault.waitAnswer(reqRow.id, waitMs);
      if (ac.signal.aborted) return end();
      if (!answered) { send({ t: 'pending', id: reqRow.id }); return end(); }
      if (answered.answer.decision === 'deny' || answered.answer.decision === 'expired') { send({ t: 'denied', message: answered.answer.decision === 'deny' ? 'The owner did not allow this command.' : 'The request expired before the owner answered.' }); return end(); }
      if (answered.answer.decision === 'locked') { send({ t: 'error', message: 'The Vault was locked before the owner answered. Ask the owner to unlock it in Pocket Code, then try again.', code: 'vault_locked' }); return end(); } // 1.73.3
    }
    if (vaultRuns.size >= VAULT_LIMITS.concurrent) { send({ t: 'error', message: 'Too many vault runs at once; try again in a moment.' }); return end(); } // 1.73.4: before the approval is used up
    if (reqRow) ({ bound, cmd } = vault.claim(reqRow.id, { action: 'run', caller: c })); // 1.73.4: rebinds by item id, re-decides, marks the row used, all in one synchronous step
    const secrets = vault.release(bound, cmd, { session: c.session, sessionTitle: c.sessionTitle, by: c.actor, request: reqRow?.id || null });
    const placeholders = {}; for (const b of bound) placeholders[b.item.values[b.field]] = b.item.name;
    send({ t: 'start' });
    const timeoutMs = Math.min(VAULT_LIMITS.timeoutMax, Math.max(1, Number(timeout) || VAULT_LIMITS.timeoutDefault)) * 1000;
    const key = {}; vaultRuns.add(key);
    try {
      const r = await runWithSecrets({ argv: cmd.argv, cwd: cmd.cwd, env: agentEnv(process.env), secrets, placeholders, timeoutMs, signal: ac.signal, onOut: s => send({ t: 'out', s }), onErr: s => send({ t: 'err', s }) });
      if (r.error) send({ t: 'error', message: `Could not start the command: ${r.error}` });
      else send({ t: 'exit', code: r.code, signal: r.signal, truncated: r.truncated, timedOut: r.timedOut });
      log(`vault run argv=${JSON.stringify(cmd.argv.slice(0, 3))} by ${c.actor}${c.session ? ' session=' + c.session : ''} code=${r.code ?? r.signal ?? r.error}`);
    } finally { vaultRuns.delete(key); }
  } catch (e) {
    if (!e.status) log(`vault run failed: ${e.stack || e.message}`);
    send({ t: 'error', message: e.message, ...(e.code ? { code: e.code } : {}) });
  }
  end();
}
app.post('/api/vault/run', requireBoardAuth, vaultOn, vaultOpen, sameOrigin, (req, res) => vaultRun(req, res, { ...(req.body || {}) }));
// 1.43: Typed by Pocket. pocket-mcp-proxy sits between an agent and a browser tool (Playwright MCP); when a tool call
// names {{vault:name.field}}, it asks here for the values, under the same Agent access policy and approval flow as a
// run (the "command" is pocket-fill <server> <tool> in the proxy's folder), types them into the tool call on its way to
// the browser, and scrubs them from everything the tool sends back. The model and the transcript only ever hold the
// placeholder. Answers {ok, values}, {pending, request} (the proxy retries with `request`) or {denied}.
app.post('/api/vault/release', requireBoardAuth, vaultOn, vaultOpen, sameOrigin, vaultNoStore, async (req, res) => {
  const c = vaultCaller(req), b = req.body || {};
  const name = v => /^[\w.-]{1,64}$/.test(String(v || '')) ? String(v) : null;
  try {
    let reqRow = null, bound, cmd, refs;
    if (b.request) {
      reqRow = vault.continuation(String(b.request), { action: 'fill', caller: c }); // 1.73.4: this caller's own fill request, not yet used
      refs = Object.keys(reqRow.env).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1))).map(k => reqRow.env[k]);
    } else {
      refs = Array.isArray(b.refs) ? b.refs.map(String).slice(0, 32) : [];
      const server = name(b.server), tool = name(b.tool);
      if (!refs.length || !server || !tool) return res.status(400).json({ error: 'Give refs, server and tool.' });
      const env = Object.fromEntries(refs.map((r, i) => ['V' + i, r]));
      bound = vault.resolveBindings(env); cmd = { ...vault.checkCommand(['pocket-fill', server, tool], b.cwd || HOME), action: 'fill' };
      const need = vault.decide(bound, cmd);
      if (need.length) {
        reqRow = vault.request({ bound, cmd, need, env, session: c.session, sessionTitle: c.sessionTitle, by: c.actor, tokenHash: c.tokenHash });
        const devices = await pushRaw(...vaultPushText(reqRow, `to fill into ${tool}`), vaultPushOpts(reqRow));
        log(`vault fill request=${reqRow.id} items=${reqRow.itemNames.join(',')} tool=${tool} by ${c.actor}${c.session ? ' session=' + c.session : ''} push=${devices ?? 'off'}`);
      }
    }
    if (reqRow) {
      const answered = await vault.waitAnswer(reqRow.id, Math.min(VAULT_LIMITS.waitMax, Math.max(1, Number(b.wait) || 90)) * 1000);
      if (!answered) return res.json({ pending: true, request: reqRow.id, items: reqRow.itemNames });
      if (answered.answer.decision === 'deny' || answered.answer.decision === 'expired') return res.status(403).json({ denied: true, error: answered.answer.decision === 'deny' ? 'The owner did not allow this fill.' : 'The request expired before the owner answered.' });
      if (answered.answer.decision === 'locked') return res.status(423).json({ error: 'The Vault was locked before the owner answered. Ask the owner to unlock it in Pocket Code, then call the tool again.', code: 'vault_locked' }); // 1.73.3
      ({ bound, cmd } = vault.claim(reqRow.id, { action: 'fill', caller: c })); // 1.73.4
    }
    const secrets = vault.release(bound, cmd, { session: c.session, sessionTitle: c.sessionTitle, by: c.actor, request: reqRow?.id || null, action: 'fill' });
    const values = {}; refs.forEach((r, i) => { values[r] = secrets['V' + i]; });
    log(`vault fill tool=${cmd.argv[2]} items=${[...new Set(bound.map(x => x.item.name))].join(',')} by ${c.actor}${c.session ? ' session=' + c.session : ''}`);
    res.json({ ok: true, values });
  } catch (e) {
    // 1.73.3: Express 4 does not catch a rejection from an async route; a bare throw here left the relay waiting on a response that never came.
    if (!e.status) { log(`vault fill failed: ${e.stack || e.message}`); return res.status(500).json({ error: 'The Vault could not fill that value; see the server log.' }); }
    res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
  }
});
app.post('/api/vault/wait', requireBoardAuth, vaultOn, vaultOpen, sameOrigin, (req, res) => vaultRun(req, res, { request: String(req.body?.request || ''), wait: req.body?.wait }));

// ---------- 1.30: documents routes ----------
// A document is sent as itself, never under the app's authority: no-store, nosniff, noindex, and for HTML a
// sandbox policy that lets a dashboard's scripts run while denying it cookies, storage and the API. Public and
// share responses add frame-ancestors 'none'; the authenticated raw route allows Pocket's own viewer frame.
function sendDocument(res, r, { download = false, framed = false } = {}) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const ancestors = framed ? "frame-ancestors 'self'" : "frame-ancestors 'none'";
  res.setHeader('Content-Security-Policy', r.kind === 'html' ? `sandbox allow-scripts allow-popups allow-downloads allow-forms; ${ancestors}` : `default-src 'none'; style-src 'unsafe-inline'; ${ancestors}`);
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(r.file)}`);
  res.type(mimeOf(r.file));
  const file = storedDocument(r); if (!file) return res.status(404).end();
  res.sendFile(file.path, { dotfiles: 'allow', headers: { 'Content-Type': mimeOf(r.file) } }, err => { file.close(); if (err && !res.headersSent) res.status(err.code === 'ENOENT' ? 404 : 503).end(); });
}
// 1.76.3: the stored copy is sent only when it is a regular file inside the library reached through no link. A stored file
// replaced by a symlink (anything running as the daemon's user can do it) used to serve the link's target on a public link.
// 1.89 (S-4): checked as opened (openChecked): the file is opened once without following a link, the real path of that
// descriptor must be inside the library, and the caller sends or pictures that descriptor and closes it. The check used to
// look at the name and the send reopened it, so a swap in between still served the link's target.
function storedDocument(r) {
  try {
    const root = fs.realpathSync(docs.dir);
    return openChecked(docs.filePath(r), real => real.startsWith(root + path.sep));
  } catch { return null; }
}
// A source path an agent or the Results panel may hand in: a regular file under the home directory, outside dot-directories.
async function documentSource(p) {
  const requested = String(p || '');
  if (!requested.startsWith('/')) throw Object.assign(new Error('The path must be a full path.'), { status: 400 });
  let real; try { real = await fsp.realpath(requested); } catch { throw Object.assign(new Error('That file does not exist.'), { status: 404 }); }
  if (!real.startsWith(HOME + '/') || real.slice(HOME.length + 1).split('/').some(x => x.startsWith('.'))) throw Object.assign(new Error('Files outside the home directory, or in hidden directories, are not kept.'), { status: 403 });
  const st = await fsp.stat(real); if (!st.isFile()) throw Object.assign(new Error('That is not a file.'), { status: 400 });
  return real;
}
const docError = (res, e) => { if (!e.status) throw e; res.status(e.status).json({ error: e.message }); };
// 1.81 (#179): a file links only to a project that exists; a typo in --project used to link it to one nobody could open.
const checkDocProject = p => { const id = typeof p === 'string' ? p.trim() : ''; if (id && !board.projects.some(x => x.id === id)) throw Object.assign(new Error(`There is no project with the id ${id}. pocket-board status --all lists the ids.`), { status: 400 }); };
app.get('/api/documents', requireBoardAuth, docsOn, (req, res) => {
  const project = typeof req.query.project === 'string' ? req.query.project : '', q = typeof req.query.q === 'string' ? req.query.q : '';
  res.set('Cache-Control', 'private, no-store').json({ documents: docs.list({ project, q }), trash: docs.list({ trashed: true }), dir: DOCS_DIR, limits: { inlineHtml: DOC_LIMITS.inlineHtml, trashDays: DOC_LIMITS.trashDays }, thumbs: thumbs.capabilities() });
});
app.post('/api/documents', requireAuth, docsOn, express.raw({ type: () => true, limit: '30mb' }), (req, res) => {
  try {
    checkDocProject(String(req.headers['x-project'] || ''));
    const d = docs.addFromBuffer(String(req.headers['x-filename'] || ''), req.body, { addedBy: 'ui', project: String(req.headers['x-project'] || ''), session: String(req.headers['x-session'] || '') || null });
    log(`document added by upload ${d.id} ${d.file} (${d.size} bytes)`); res.json(d);
  } catch (e) { docError(res, e); }
});
app.post('/api/documents/add', requireBoardAuth, docsOn, async (req, res) => {
  try {
    checkDocProject(req.body?.project);
    const real = await documentSource(req.body?.path);
    const d = docs.addFromPath(real, { title: req.body?.title, project: req.body?.project, session: req.body?.session || null, visibility: VISIBILITY_OK(req.body?.visibility), addedBy: req.boardActor === 'cli' ? 'cli' : 'ui' });
    log(`document added ${d.id} ${d.file} by ${req.boardActor || 'ui'}`); res.json(d);
  } catch (e) { docError(res, e); }
});
const VISIBILITY_OK = v => ['private', 'link', 'public'].includes(v) ? v : 'private';
// Keep as document from a session's Results: the path must be one of that session's file results.
app.post('/api/documents/keep', requireAuth, docsOn, async (req, res) => {
  const id = String(req.body?.session || ''), requested = String(req.body?.path || '');
  if (!anyId(id)) return res.status(400).json({ error: 'Invalid conversation' });
  try {
    const { results } = await sessionResults(id);
    if (!results.some(r => r.kind === 'file' && r.target === requested)) return res.status(403).json({ error: 'This file is not a result referenced by the conversation.' });
    checkDocProject(req.body?.project);
    const real = await documentSource(requested);
    const d = docs.addFromPath(real, { title: req.body?.title, project: req.body?.project, session: id, addedBy: 'session' });
    log(`document kept from session ${id}: ${d.id} ${d.file}`); res.json(d);
  } catch (e) { docError(res, e); }
});
app.post('/api/documents/import', requireBoardAuth, docsOn, (req, res) => {
  try { const r = docs.importMeta(req.body); log(`documents import: ${JSON.stringify(r.counts)} adopted=${r.adopted} missing=${r.missing.length}`); res.json({ ok: true, ...r }); }
  catch (e) { docError(res, e); }
});
app.get('/api/documents/:id/raw', requireAuth, docsOn, (req, res) => {
  let r; try { r = docs.get(req.params.id); } catch (e) { return docError(res, e); }
  if (r.trashedAt && req.query.trash !== '1') return res.status(404).end();
  sendDocument(res, r, { download: req.query.download === '1', framed: true });
});
// 1.32: the thumbnail for the grid. Made on first request, then served from the cache; 404 when this install has no
// tool for the kind or the picture could not be made (the card shows the kind instead). Login only, never public.
app.get('/api/documents/:id/thumb', requireAuth, docsOn, async (req, res) => {
  let r; try { r = docs.get(req.params.id); } catch (e) { return docError(res, e); }
  if (r.trashedAt || r.missing) return res.status(404).end();
  // 1.89 (S-4): the picture is made from the stored file as storedDocument opened and checked it, as a send is; this route
  // used to hand the path to the renderer, which followed a stored file replaced by a link with no race needed.
  const file = thumbs.can(r) ? storedDocument(r) : null;
  const t = file ? await thumbs.get(r, file) : null;
  if (!t) return res.status(404).json({ error: 'No thumbnail for this file.' });
  res.setHeader('Cache-Control', 'private, max-age=86400'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.type(t.type); res.sendFile(t.path, { dotfiles: 'allow', headers: { 'Content-Type': t.type } }, err => { if (err && !res.headersSent) res.status(404).end(); });
});
// 1.45: the library's select mode (Remove or Restore several files) and the trash's Delete forever / Empty trash. Owner
// only, from Pocket's own origin: the CLI token is refused, so an agent can still only move one file to the trash.
app.post('/api/documents/bulk', requireAuth, sameOrigin, docsOn, (req, res) => {
  const action = req.body?.action;
  try {
    const r = docs.bulk(action, req.body?.ids);
    log(`documents ${action}: ${r.done.length} done${r.failed.length ? `, ${r.failed.length} failed` : ''}`); res.json(r);
  } catch (e) { docError(res, e); }
});
app.post('/api/documents/trash/empty', requireAuth, sameOrigin, docsOn, (_req, res) => {
  const r = docs.emptyTrash();
  log(`documents trash emptied: ${r.done.length} deleted${r.failed.length ? `, ${r.failed.length} failed` : ''}`); res.json(r);
});
app.post('/api/documents/:id', requireBoardAuth, docsOn, (req, res) => {
  const action = req.body?.action;
  if (action === 'delete') return res.status(403).json({ error: "Deleting is the owner's: Delete forever in the library's Trash." });
  try {
    if (!action && req.body && 'project' in req.body) checkDocProject(req.body.project);
    const r = action === 'trash' ? docs.trash(req.params.id) : action === 'restore' ? docs.restore(req.params.id) : docs.update(req.params.id, req.body || {}, { actor: req.boardActor || 'ui' });
    log(`document ${action || 'updated'} ${req.params.id} by ${req.boardActor || 'ui'}`); res.json(r);
  } catch (e) { docError(res, e); }
});
// Unauthenticated: public files by name, link documents by token. Nothing while the feature is off.
app.get('/files/:name', (req, res) => {
  if (!settings.documents) return res.status(404).end();
  const r = docs.resolvePublic(req.params.name); if (!r) return res.status(404).end();
  sendDocument(res, r, { download: req.query.download === '1' });
});
app.get('/share/:token', (req, res) => {
  if (!settings.documents) return res.status(404).end();
  const r = docs.resolveShare(req.params.token); if (!r) return res.status(404).end();
  sendDocument(res, r, { download: req.query.download === '1' });
});

// ---------- push endpoints ----------
app.get('/api/push/key', requireAuth, (_req, res) => res.json({ key: pushReady ? process.env.VAPID_PUBLIC : null }));
app.post('/api/push/subscribe', requireAuth, (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint) return res.status(400).json({ error: 'bad subscription' });
  const subs = loadSubs().filter(s => s.endpoint !== sub.endpoint);
  const row = { ...sub, ...cleanPushPrefs(req.body.prefs) }; // 1.50: what this device wants rides with its subscription
  subs.push(row);
  saveSubs(subs);
  log(`push subscribed (${subs.length} devices)`);
  res.json({ ok: true, prefs: pushPrefsOf(row) });
});
// 1.50: a device's notification choices (which kinds, the icon badge), read and changed by that device.
app.get('/api/push/prefs', requireAuth, (req, res) => {
  const s = loadSubs().find(x => x.endpoint === req.query.endpoint);
  if (!s) return res.status(404).json({ error: 'This device is not subscribed.', code: 'not_subscribed' });
  res.set('Cache-Control', 'private, no-store').json({ ok: true, prefs: pushPrefsOf(s) });
});
app.post('/api/push/prefs', requireAuth, (req, res) => {
  const subs = loadSubs(), s = subs.find(x => x.endpoint === req.body?.endpoint);
  if (!s) return res.status(404).json({ error: 'This device is not subscribed.', code: 'not_subscribed' });
  const clean = cleanPushPrefs(req.body);
  if (clean.kinds) s.kinds = { ...pushPrefsOf(s).kinds, ...clean.kinds };
  if ('badge' in clean) s.badge = clean.badge;
  saveSubs(subs);
  res.json({ ok: true, prefs: pushPrefsOf(s) });
});
// 1.50: a test message to the address in Settings, so the owner can see the mail path works before relying on it.
app.post('/api/notify/test-email', requireAuth, async (_req, res) => {
  if (!mailer.configured) return res.status(409).json({ error: mailer.error || 'Email is not set up on this server. Set POCKET_SMTP_URL in .env.', code: 'mail_off' });
  if (!looksLikeEmail(settings.notifyEmail)) return res.status(400).json({ error: 'Save an email address first.', code: 'no_address' });
  try {
    await mailer.send({ to: settings.notifyEmail, subject: '[Pocket Code] Test: reminders will arrive like this', text: `Pocket Code on ${os.hostname()} can email you. Due tasks and project reminders will arrive at this address.${publicBase() ? '\n\n' + publicBase() : ''}`, html: `<p>Pocket Code on <strong>${os.hostname()}</strong> can email you. Due tasks and project reminders will arrive at this address.</p>${publicBase() ? `<p><a href="${publicBase()}">${publicBase()}</a></p>` : ''}` });
    res.json({ ok: true, to: settings.notifyEmail });
  } catch (e) { log(`mail test failed: ${e.message}`); res.status(502).json({ error: 'The test message could not be sent: ' + e.message, code: 'mail_failed' }); }
});
// 1.58.1: an alert from an agent or a job on the server (Ari's inbox monitor), as a push to every device that wants
// alerts and, when asked and set up, an email to the address in Settings. Owner's cookie or the loopback token (direct
// loopback only, as for the board). The link is a Pocket path (a start link, a conversation, Files) or the public address.
app.post('/api/notify', requireBoardAuth, async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 70), body = String(b.body || '').trim().slice(0, 2000);
  if (!title) return res.status(400).json({ error: 'A title is needed.', code: 'no_title' });
  const base = publicBase();
  let url = String(b.url || '').trim().slice(0, 500);
  // 1.89 (S-3): the public address comes off first, then what is left must stay on Pocket's own site: one leading slash
  // not followed by another or a backslash, no control characters (a browser drops a tab or newline, so /<tab>/host is
  // //host), and it must resolve to the same origin. //host, /\host and <public address>//host used to pass and open
  // another site when the notification was tapped.
  if (url && base && url.startsWith(base + '/')) url = url.slice(base.length);
  const own = u => { try { return /^\/(?![/\\])/.test(u) && !/[\x00-\x1f\x7f]/.test(u) && new URL(u, 'http://pocket.invalid').origin === 'http://pocket.invalid'; } catch { return false; } };
  if (url && !own(url)) return res.status(400).json({ error: 'The link must be a Pocket path (/#/…) or start with the public address.', code: 'bad_url' });
  const tag = String(b.tag || '').trim().slice(0, 80) || Date.now().toString(36);
  const actor = req.boardActor || 'ui';
  const devices = await pushRaw(title, body, { tag: 'alert:' + tag, url: url || '/', kind: 'alerts' });
  let mail = false;
  if (b.email === true) {
    if (!emailOn()) mail = 'off';
    else {
      const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const link = url && base ? base + url : '';
      try {
        await mailer.send({ to: settings.notifyEmail, subject: '[Pocket Code] ' + title, text: body + (link ? '\n\n' + link : ''),
          html: `<p>${esc(body).replace(/\n/g, '<br>')}</p>${link ? `<p><a href="${esc(link)}">Open in Pocket Code</a></p>` : ''}` });
        mail = true;
      } catch (e) { log(`notify mail failed: ${e.message}`); mail = 'failed'; }
    }
  }
  log(`notify "${title}" by ${actor} push=${devices ?? 'off'} mail=${mail}`);
  res.set('Cache-Control', 'private, no-store').json({ ok: true, push: devices, mail, url: url || null });
});
app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
  saveSubs(loadSubs().filter(s => s.endpoint !== req.body?.endpoint));
  res.json({ ok: true });
});

// serve local images referenced in chats (Claude-generated charts, screenshots, uploads)
app.get('/api/file', requireAuth, (req, res) => {
  const p = String(req.query.path || '');
  if (!/\.(png|jpe?g|gif|webp)$/i.test(p)) return res.status(400).end();
  let real; try { real = fs.realpathSync(p); } catch { return res.status(404).end(); }
  if (!real.startsWith(HOME + '/')) return res.status(403).end();
  res.sendFile(real);
});

app.get('/api/health', (_req, res) => res.json({
  ok: true, active: turns.size + codex.codexTurns.size, codexActive: codex.codexTurns.size, processes: runners.size, codexProcesses: codex.codexSessions.size, uptime: process.uptime(),
}));

// model picker options — Claude's from CLAUDE_MODELS, Codex's straight from its app-server
app.get('/api/claude/models', requireAuth, (_req, res) => { const offer = claudeOffer(); res.json({
  models: offer.models.filter(m => m.offered).map(({ id, label, sub }) => ({ id, label, sub })),
  replaced: replacedModels(modelPolicy()), // 1.91: older versions the app moves a saved pick forward from
  defaultLabel: claudeDefaultLabel(),
  defaultEffort: POCKET_DEFAULTS.claude.effort || null,
  maxEffort: maxEffort(), // 1.67: the effort picker offers nothing above the managed policy's ceiling
  pocketDefault: Boolean(claudePocketModel() || POCKET_DEFAULTS.claude.effort),
  limited: offer.offered.length < CLAUDE_MODELS.length,
}); });
app.get('/api/codex/models', requireAuth, async (_req, res) => {
  const { model, effort } = POCKET_DEFAULTS.codex;
  const defaults = { defaultModel: model || null, defaultEffort: effort || null, pocketDefault: Boolean(model || effort) };
  if (!CODEX_ON) return res.json({ models: [], ...defaults });
  // 1.91: the newest version of each family only, and Default names the version it will really run.
  const { models, replaced } = codex.latestCodexModels(await codex.codexModels().catch(() => []));
  res.json({ models, replaced, ...defaults, defaultModel: replaced[model] || model || null });
});
// The OpenRouter model picker for the ACP engine: the live catalog, split into a curated/tested
// tier and an experimental tier (openrouter.mjs). `enabled:false` when the engine is off, so the
// UI can hide the picker. A catalog fetch failure returns enabled:true with empty tiers + error.
// 1.86: Pocket's ask tool (acp-ask-mcp.mjs) inside an OpenRouter reply's OpenCode process. Direct loopback only, and
// the key that one process was started with, which also names its conversation. Ask, then poll for the answer.
function acpAskTurn(req, res) {
  const direct = LOOPBACK.has(req.socket.remoteAddress) && !req.get('cf-connecting-ip') && !req.get('x-forwarded-for');
  const key = String(req.get('x-pocket-ask-key') || ''), session = direct && /^[0-9a-f]{48}$/.test(key) ? acp.acpSessionByAskKey(key) : null;
  if (!session) { res.status(403).json({ error: 'not allowed' }); return null; }
  return session;
}
app.post('/api/internal/acp-ask', (req, res) => {
  const session = acpAskTurn(req, res); if (!session) return;
  const turn = acp.ownedAcpTurn(session.sessionId);
  try { res.json({ id: acp.askAcpQuestion(turn, req.body?.questions) }); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
app.get('/api/internal/acp-ask/:id', (req, res) => {
  if (!acpAskTurn(req, res)) return;
  const st = acp.askState(req.params.id);
  res.json({ state: st.state, ...(st.state === 'answered' ? { answers: st.answers, skipped: st.skipped || null } : {}) });
});
// 1.86: what each engine can do, so the app shows a feature only where it works (engines.mjs).
app.get('/api/engines', requireAuth, (_req, res) => res.json({ engines: Object.fromEntries(ENGINE_IDS.map(e => [e, { label: ENGINES[e].label, features: ENGINES[e].features }])) }));
app.get('/api/acp/models', requireAuth, async (_req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=300');
  if (!ACP_ON) return res.json({ enabled: false, curated: [], experimental: [] });
  const defaultModel = POCKET_DEFAULTS.acp.model || ACP_CFG.curated[0] || null;
  try {
    const models = await fetchOpenRouterModels(process.env.POCKET_OPENROUTER_MODELS_URL ? { url: process.env.POCKET_OPENROUTER_MODELS_URL } : {}); // the override is for tests
    const { curated, experimental } = tierModels(models, ACP_CFG.curated);
    if (!acpEfforts.at) await Promise.race([refreshAcpEfforts(), new Promise(r => setTimeout(r, 8000))]);
    const withEfforts = m => ({ ...m, efforts: acpEfforts.map[m.slug] || [] });
    res.json({ enabled: true, defaultModel, defaultEfforts: acpEfforts.map[defaultModel] || [], curated: curated.map(withEfforts), experimental: experimental.map(withEfforts) });
  } catch (e) {
    log(`openrouter catalog fetch failed: ${e.message}`);
    res.json({ enabled: true, defaultModel, defaultEfforts: acpEfforts.map[defaultModel] || [], curated: [], experimental: [], error: 'The OpenRouter model catalog is unavailable right now.' });
  }
});

// What changed in the current asset version — shown under "What's new" in the settings
// sheet. Replace (don't append) on each release; the ledger keeps the history.
const RELEASE_NOTES = ["Wrap-up replies no longer wait in Attention. When you tap Mark resolved, Remind me …, Add a task …, No thanks or a similar closing reply, the agent's short confirmation now counts as read the moment it finishes, on every device, and sends no notification, so you no longer have to open the conversation again or scroll to clear it, even after closing its tab. If the agent answers with a question, reply buttons or a long report, the conversation waits in Attention as before, and an ordinary request still does. Reported by Brad.", "What it reads: choose which mail Inbox Watch looks at. Settings → Inbox Watch now offers Everything (every thread but spam, trash and drafts, as before), Inbox only, and Inbox and these labels, with your Gmail labels to pick from. Everything is the default, so nothing changes until you choose. In the narrower choices your replies still count, so the watcher sees that you answered; a new email you start is not read. Requested by Damon and Brad.", "New Coordination view shows which conversation holds staging or a deploy, who is waiting, and what ended lately. Agents claim with pocket-coord, a clash names the holder, and the first waiter is woken on release. Holds are advice, not a lock. Off until you turn it on in Settings.", "The Git panel now lists every worktree of a repository as In use, Has work or Ready to remove, and says why. Remove only appears when nothing would be lost, names any ignored files and conversations affected, and keeps the branch. A conversation whose folder was removed carries on from your home folder and says so once.", "The Git panel now follows the work. It shows the repository the conversation is working in, not the folder it started in, offers a picker when it touched several, and names other running conversations in the same repository. Branch starts in that folder too and says so.", "Pass work to a fresh conversation with one tap. When a conversation has grown long, ask the agent to hand off (or type /handoff). It writes a briefing and the reply shows a card with the title, folder, agent and permissions, a Start button and Review first. Start opens a new conversation that begins with only the briefing, so it reads far less than the old one, and each conversation links to the other. A handoff starts once, even from two devices, and it never gets more permission than the conversation it came from. Requested by Brad.", "The morning digest is readable and each line has its own buttons. The digest used to open as one block of text; it now shows each line as a card under its heading (Worth knowing, Held overnight, and so on), and the whole digest is shown rather than cut off after 2,000 characters. Under each card: Start a conversation, which opens a new conversation briefed with that one story and teaches Inbox Watch nothing; Add to Inbox, which puts that story on your Inbox as an alert right away and teaches Inbox Watch to alert on that kind of email from now on; Resolved and Not useful, which land on that story rather than on the whole digest; Dismiss; and Gmail. Undo takes any of them back, except an alert already sent. Each story has one status: lines on the same story share a card, and a story that is an open alert on your list appears under Already on your list as a link to that entry, showing what you decide there, so nothing is worked twice. Look-aheads work the same way: each item is a card with the same choices, most pressing first, and the whole look-ahead is shown rather than cut off after 2,000 characters. Add to Inbox on a look-ahead item teaches nothing, since it is a finding rather than a kind of email. Requested by Damon after a client's text message was filed for the digest instead of alerting him, with the one-status rule and the look-ahead cards from Brad.", "The morning digest can be turned off. Settings → Inbox Watch now has Off for Morning digest, as the look-aheads do. With it off, alerts held overnight arrive one by one when quiet hours end, and lines that would only have been in the digest are not sent. Requested by Brad.", "Pin and unpin in one click. Every conversation in the list now has a pin beside its ⋯ button: faint gray on an unpinned conversation (click it to pin) and orange on a pinned one (click it to unpin). Pin conversation is also the first choice in Conversation options now, instead of near the bottom. Requested by Damon.", "Finding a secret and answering the Vault is easier. The Vault list now shows the newest secrets first (Order switches to A–Z), a secret stored in the last day is marked New with the conversation that stored it, and Search secrets narrows the list by name, kind, tag or website. A conversation that stores a secret shows a card for it, and agents now link the name; either opens the Vault with that secret open. A request reads as one sentence, such as The agent in “Staging site” wants to use staging-wp for this command, with Allow once as an orange button beside Deny. Tapping the notification opens that request instead of the list; only the notification's Allow button approves, and if that Allow could not be recorded (signed out, locked, offline, or already ended) the request says so and you can answer it there. Requested by Damon.", "Keep long conversations and subagents in check. Settings → Agents & instance has a new Context and subagents group. Each reply reads the whole conversation again, so a conversation left to grow toward a million tokens uses the most of your plan. Compact conversations has the agent summarize the older part before a size you choose (150K to 600K tokens). Subagent model runs subagents one tier below the conversation: Fable conversations get Opus subagents, Opus gets Sonnet and GPT Astra gets GPT Sol; a conversation can still name a model for one subagent. Subagent effort sets how hard they think. It applies to Claude Code and Codex conversations from their next reply; OpenRouter keeps its own behavior for now. Nothing changes until you choose. Requested by Brad.", "Inbox Watch set up with Codex uses the newest models. When Pocket sets up Inbox Watch on a server where only Codex is signed in, the judge now runs the newest GPT Sol the installed Codex lists (GPT-6.1 Sol today, not GPT-6 Sol), and reading mail the newest GPT Luna. A Codex too old for GPT-6.1 Sol keeps GPT-6 Sol. A watcher that is already set up keeps its models. Requested by Brad.", "Only the newest model versions are shown, and new ones appear by themselves. The Codex menu lists GPT-6.1 Sol instead of GPT-6 Sol, and Default says GPT-6.1 Sol; the Claude menu lists the newest Fable, Opus, Sonnet and Haiku, without Sonnet 5 and Haiku 4.5 beside their newer versions. A conversation, saved prompt or Pocket default that names an older version now runs the newest one. Codex's menu was already its live list; for Claude, Pocket now reads Anthropic's model list once a day with the sign-in Claude Code already has, so a new model such as an Opus 6 joins the menu and replaces the older one without a Pocket update. Requested by Brad.", "Inbox Watch learns from what you put on your list, and no longer says you added something a Gmail filter labelled. An email that arrives already carrying the Pocket Inbox label (because one of your Gmail filters adds it) now reads Your Gmail filter put this on your list, not You added this. When you label an email yourself, the watcher notes what it had done with it (ignored it, kept it for the digest, skipped it as routine) and turns that into a short rule, as narrow as the examples allow: one email teaches it about that sender and topic, several of a kind teach it the kind. Not useful works the same way in the other direction, and the rules it has learned are merged, widened or dropped as you go on. They sit at the end of your rules under Learned from your choices, where you can edit or delete any of them, and the quick first pass now reads the whole rules file. Reported by Brad.", "Switching Claude accounts no longer makes you wait or start over. A message you send to a conversation whose background job (a build, a watcher) still holds the earlier sign-in now waits in its queue and sends by itself, on the new account, as soon as the job finishes. Stop background jobs and send now beside it skips the wait, and the Queue shows what it is waiting for. Reported by Brad.", "Switching Claude accounts no longer leaves a conversation stuck. When you sign in with another account, a conversation with a background job still running (a test run, a watcher) keeps the earlier sign-in so the job is not cut off, and Pocket refused your messages there until the job ended, which for a watcher could be never. The Not sent card now names the job and offers Stop background jobs and send, which ends the job and continues the conversation on the new account. And Retry same message now really asks again: a refused message used to get the same refusal back without checking, even after the reason had gone. Reported by Brad.", "Fixes from Casey's second review, checked against 1.88.1. Side chats: a Codex side chat now switches off every MCP server Codex knows about, however it is written in the config file, and refuses to start when it cannot ask; a Claude side chat searches the web only when the conversation is in Full access; Stop on a stuck Codex side chat closes it; a side chat that reconnects after a long run gets the right events. Processes: a replacement Claude process waits for the old one to exit, a Pocket restart adopts the right process and stops duplicates, and work the agent did while Pocket was down counts as Pocket's own instead of as another app's. A background agent's request that is waiting when a reply ends with an After this reply message now reaches you, and a subagent working alone no longer makes the conversation read Running. Transcript bookkeeping (a task notification, a compaction summary) no longer shows as a message you sent, a steered message with a file shows once, long first prompts no longer bloat the conversation list, a skill whose description spans several lines shows it in the / list, and a pasted HEIC or TIFF keeps its name. Security: notification links can only open Pocket's own pages, file previews and downloads read the file they checked, pictures are decoded only as what their name says, and the login and Vault attempt limits can no longer be reset by a caller naming its own address (see POCKET_TRUSTED_PROXY in the install guide). Reported by Casey.", "Finished replies stay in Attention. A conversation whose reply you had not opened could drop out of Attention and read Recent, with its reply buttons still waiting inside. When Pocket closes an idle conversation's process (after an hour, or seconds after a reply when several conversations start at once, such as a burst of Inbox Watch alerts), Claude Code writes a little bookkeeping to the transcript, and Pocket took that for work in another app. It now counts only messages, so Response ready stays until you open the conversation. Replies hidden this way since the problem began reappear in Attention once; Mark all reviewed clears them. Reported by Brad.", "The OpenRouter model menu has a search box. OpenRouter offers hundreds of models; type any words of a model's name or maker, such as kimi or sonnet 5.5, and the list narrows as you type, with Default and the tested models still first. It says how many match, or that none do. Enter picks the first match and the arrow keys move through the list; on a phone the keyboard waits until you tap the box. Escape clears the box, a second Escape closes the menu. Requested by Brad.", "Codex conversations now have what Claude Code conversations had over them. Changed files shows each Codex edit's diff, and files Codex writes become file cards and are kept in Files like Claude's. When Codex hits its usage limit, the conversation waits for the reset and picks the task up again by itself, as Claude's do, and tells you when. The / list offers compact, review (the uncommitted changes, or against a base branch), recap and context. Your attachments show as file chips, a subagent's activity opens, the trusted read-only actions in Settings apply to Codex (and OpenRouter) commands, each reply shows the tokens it used, a reply Codex moves to another model says so, the Usage sheet reads 5-hour and Weekly, and Plan first shows its plan. OpenRouter gets the same diffs in Changed files and picks up again after a rate limit. Requested by Brad.", "After a CLI upgrade, Pocket shows which Claude Code and Codex conversations still have an older process. The update notice stays visible until they switch. The review names each conversation, shows whether it is idle or working, and offers Switch now for idle work. Stop work & switch asks before interrupting a running reply; the next turn opens the selected CLI. Restarting Pocket does not switch those processes.", "OpenRouter conversations now have the everyday features Claude Code and Codex conversations have. Your message shows as soon as you send it. A question from the model is a question card with its options as buttons, and a reply that asks you to choose ends with reply buttons, because Pocket's instructions now reach OpenRouter too. Attachments and images reach it, Plan first works, Stop stops (a queued message waits), a message queued with After this reply runs on OpenRouter, and the context meter, Results, Search and the Git panel work. What OpenRouter cannot do yet (Steer, Side chat, Branch, While you were away) is hidden on its conversations instead of offered and failing. And OpenCode needs no setup of its own any more: Pocket starts it with the ask-first permissions it needs. Behind this, every feature now goes through one layer for all three agents, with one test run against each. Requested by Brad.", "Inbox fixes. An email you label Pocket Inbox in Gmail no longer gets stuck outside your list: when you label two copies of the same email (yours and the one sent to Ari only, say), both now follow the one entry they share, and labelling an email again after its entry was finished brings it back. An entry the tidy pass took off and you restored now stays until you finish it. And the Inbox opens as a tab you can close, like Tasks and the Vault; the link under the list now says how many are finished and opens Done. Reported by Brad.", "Pocket checks for Claude Code and Codex releases daily at 4 a.m. in your time zone. A notice opens the installed and available versions, release notes, and Upgrade selected. Nothing installs until you choose it. Upgrades run in the background, test startup compatibility in isolation, keep the previous version for restoration, and let active conversations finish before switching. Find CLI updates in Settings → Help & updates → About & updates.", "Codex conversations keep showing Running while the main agent is working. A subagent finishing could previously mark the whole conversation finished. Child-thread events now stay separate from the parent turn, while subagent activity remains visible. Reported during the CLI updater build.", "OpenRouter replies follow Full access, show what they are doing and what they cost. With Full access a reply ran no command until you allowed it, because the permission choice never reached OpenCode; now Full access runs without asking and Review actions asks as before. While a reply works you see its thinking and each file it reads and command it runs, as with Claude and Codex, and they are still there when you reopen the conversation. And each reply shows its cost under it, to a fraction of a cent (DeepSeek replies often cost less than one), with its time and how much was read from cache. Reported by Brad.", "OpenRouter conversations now work the way they should. Before, every reply ran on OpenCode's own free model whatever you picked, a conversation waiting for your OK said Recent with no Allow button, and there was no way to set the effort. Now the reply runs on the model you picked (Pocket checks with OpenCode first and stops rather than let it run on another), the approval shows on the banner with Allow and Don't allow, and the effort chip offers the levels the chosen model has, such as None, Low, High and Max for DeepSeek V4.1 Flash; a model with no effort setting shows no chip. Reported by Brad.", "OpenRouter is a new agent, beside Claude Code and Codex, for models you pay for by the token with your own OpenRouter key instead of a Claude or ChatGPT subscription, such as DeepSeek V4.1 Flash. It is off until the person who runs Pocket turns it on (it needs OpenCode installed, an OpenRouter key and POCKET_ACP_ENABLE). With it on, OpenRouter joins the Agent choice on New conversation; its model menu is OpenRouter's live catalogue of models that can use tools, a tested set first and the rest marked experimental, and a model OpenRouter adds shows up without a Pocket update. Replies stream, approvals, the conversation list, reopening and continuing all work the same way; the model's questions arrive as text, and billing is per token to your key. See the manual's Conversations page for the setup. Requested by Brad.", "Inbox Watch through the Gmail connector reads new mail again. Since Monday, October 27, the claude.ai Gmail connector has answered a search bounded by a time in seconds with nothing and no error, so a watcher reading through it saw no new mail and reported healthy. The watcher now bounds its searches by date, a day wider than it needs, and skips what it has already seen; mail from the last two days that was missed is caught up on the first check after the update. And a check that finds nothing while a search for the last day's mail does is now reported as a failure in the Inbox and, after three in a row, as a push, instead of as a quiet day. Reported by Damon.", "Typing / opens a list of commands, like the terminal. It shows the Claude Code commands worth having (compact, context, recap, init, code-review and more, only the ones your Claude Code has), Pocket's own actions (side chat, branch, new conversation, model, effort and plan usage) and your skills, grouped and narrowed as you type. On a computer use the arrow keys, then Enter or Tab; on a phone, tap. A command that needs nothing more runs as soon as you pick it. New conversation has the list too. The answer to a command such as /context or /usage now stays in the conversation after a reload, and a skill you ran reads back as you typed it rather than as the skill's own instructions. Requested by Brad.", "Vault fixes from a new kind of bug review, where one agent describes how the Vault should behave without seeing its tests and another tests that description without seeing the code. A command run with a secret can no longer leave a helper process behind that ignored the request to stop and kept the secret. A username and password sent as an HTTP Basic login header, and a secret carried inside any longer base64 text, are now hidden in a command's output. An approval you give near the end of its 15 minutes stays good for 15 minutes after you answer instead of vanishing a minute later. A wrong passphrase is always refused and counted, even when the Vault's activity log cannot be written. And agents are pointed at the Vault skill correctly when Pocket is installed in a folder whose name has a space. Prompted by Casey's description of how he finds bugs.", "Answer from the banner. When one action waits for your OK, the banner under the conversation header says what it is in plain words, shows the command or file, and carries Allow and Don't allow, so one tap decides it. One question with a few options shows the options as buttons the same way. Details or Answer still open the full sheet, and the sheet now closes itself once nothing is left waiting, instead of asking you to close it. Requested by Brad after talking with Casey.", "Subagents in view, and their requests reach you. The Subagents row under the conversation controls now also reports work left running in the background, and each agent has Show activity, which follows the agent's own transcript while it works. A permission request or question from a subagent is shown with the agent's name, including one that arrives after the reply that started it has ended; before, those were dropped and the agent, and the conversation, waited for an answer that could not come. Codex subagents' requests are passed on too. Requested by Brad after talking with Casey.", "Assistant mode has a Features section in Settings. Switch Projects, Files, Tasks, Inbox Watch and the Vault on or off there, and Automatic model choice. When Assistant mode is locked, it says which are on and to ask the person who runs Pocket to change them, and a library that is off says the same instead of sending you to Settings.", "Fixes found while writing the manual. A message sent with After this reply keeps the model, effort and Codex mode you picked. A start link opens New conversation in its own folder. Steer now falls back to After this reply when the reply cannot take it. A finished Codex reply no longer buzzes your phone while you are watching it. On a computer, the plus on New conversation clears it. On a Mac, Codex conversations survive a Pocket restart. Inbox Watch sets itself up even after another job has posted to the Inbox, keeps its Start a conversation button, and notices when Gmail is connected to a different account. The Vault counts only wrong unlock attempts, and the Files share link stays the same when an agent looks it up.", "Pocket Code has a manual: one page per feature (conversations, approvals, Projects, Files, Tasks, Inbox Watch, the Vault, voice, Settings and more) saying what it does, how to turn it on, how to use it and what to do when it misbehaves. It is written for you and for your agents: every agent Pocket starts is told where it is, and each Pocket skill names its page, so asking an agent how something in Pocket works gets an answer from the manual instead of a read through the code. It lives in docs/manual in the Pocket Code directory.", "Inbox Watch reads back only memory that is about the email. The memory search always brought three past sessions or notes with each email, related or not, so an email about one customer's billing came with a session about another's. Now an item has to share the email's names, numbers or subject words, which cuts what each decision reads by about a third. The tidy pass also keeps an entry on your list while part of what it asked for has no one on it. Requested by Brad.", "Typing / in a Codex conversation now offers /btw too, and picking it types /btw, ready for your question. Before, it was only suggested in Claude conversations, though typing it in full already worked in both."];

// version/about info, computed once at boot. assetV comes from index.html, so the
// settings sheet can tell a stale cached client "the server has something newer".
const ABOUT = (() => {
  const sh = cmd => { try { return execSync(cmd, { cwd: import.meta.dirname, timeout: 5000 }).toString().trim(); } catch { return null; } };
  let assetV = null;
  try { assetV = Number((fs.readFileSync(path.join(import.meta.dirname, 'public', 'index.html'), 'utf8').match(/app\.js\?v=(\d+)/) || [])[1]) || null; } catch { }
  return {
    assetV,
    version: JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'package.json'), 'utf8')).version,
    notes: RELEASE_NOTES,
    commit: sh('git log -1 --format=%h'),
    commitAt: sh('git log -1 --format=%cI'),
    node: process.version,
    host: os.hostname(),
    push: pushReady,
  };
})();
// CLI versions are re-read when the installed binary changes (npm upgrades swap the
// package in place while this server keeps running) — not frozen at boot.
const verCache = new Map(); // bin -> { stamp, v }
function binVersion(bin) {
  const stamp = codex.binStamp(bin);
  const hit = verCache.get(bin);
  if (hit && hit.stamp === stamp) return hit.v;
  let v = null;
  try { v = execSync(`'${bin}' --version`, { timeout: 5000 }).toString().trim(); } catch { }
  verCache.set(bin, { stamp, v });
  return v;
}
// Browser authentication only; never accepts the loopback agent token. Reject cross-origin writes explicitly.
const cliUpdateAction=(req,res,next)=>{
  const origin=req.get('origin');
  if(req.get('sec-fetch-site')==='cross-site'||(origin&&origin!==`https://${req.get('host')}`&&origin!==`http://${req.get('host')}`))return res.status(403).json({error:'Open updates in Pocket to continue.'});
  if(!req.is('application/json'))return res.status(415).json({error:'Expected JSON.'});next();
};
function oldCliProcesses(){
  const claude=[...runners.values()].filter(r=>!r.exited&&!r.closing&&r.cliBin!==CLAUDE_BIN).map(r=>({key:'claude',id:r.sessionId,process:r,busy:Boolean(r.turn||turns.has(r.sessionId)||r.bgTasks.length||extActive(r.sessionId))}));
  const cx=[...codex.codexSessions.values()].filter(s=>!s.exited&&!s.closing&&s.cliBin!==codex.CODEX_BIN).map(s=>({key:'codex',id:codex.CX+s.threadId,process:s,busy:Boolean(codex.codexTurns.has(s.threadId)||codex.codexExtActive(s.threadId))}));
  return [...claude,...cx];
}
app.get('/api/cli-updates',requireAuth,async(_req,res)=>{
  const state=cliUpdates.snapshot();
  const older=oldCliProcesses();
  const details=await Promise.all(older.map(async o=>{
    let title=smeta[o.id]?.name||storedAutoTitle(o.id);
    if(!title)try{
      const meta=o.key==='codex'?await codex.codexThreadMeta(codex.bareId(o.id)):await sessionMeta(await findSessionFile(o.id),o.id);
      title=meta?.title;
    }catch{}
    return {id:o.id,key:o.key,title:title||`Conversation ${o.id.slice(-8)}`,busy:o.busy,background:o.key==='claude'&&Boolean(o.process.bgTasks.length),version:binVersion(o.process.cliBin)||null};
  }));
  for(const p of state.providers){p.older=details.filter(o=>o.key===p.key);p.olderSessions=p.older.length;}
  res.setHeader('Cache-Control','no-store');res.json(state);
});
app.post('/api/cli-updates/check',requireAuth,cliUpdateAction,async(_req,res)=>{
  try{await cliUpdates.check();res.json(cliUpdates.snapshot());}catch(e){res.status(e.status||503).json({error:e.status?e.message:'Could not save the update check. Try again.'});}
});
app.post('/api/cli-updates/upgrade',requireAuth,cliUpdateAction,(req,res)=>{
  try{res.status(202).json(cliUpdates.begin(req.body?.selections,{rollback:req.body?.rollback===true}));}catch(e){res.status(e.status||503).json({error:e.status?e.message:'Could not start the upgrade. Try again.'});}
});
app.post('/api/cli-updates/switch',requireAuth,cliUpdateAction,(req,res)=>{
  const {key,id,interrupt}=req.body||{};
  if(!['claude','codex'].includes(key)||typeof id!=='string'||!anyId(id)||sessionEngine(id)!==key||typeof interrupt!=='boolean')return res.status(400).json({error:'Choose a Claude Code or Codex conversation.'});
  const old=oldCliProcesses().find(o=>o.key===key&&o.id===id);
  if(!old)return res.status(409).json({error:'This conversation has already switched or its process has closed. Refresh the status.'});
  if(old.busy&&!interrupt)return res.status(409).json({error:'This conversation is working. Let it finish or choose Stop work.'});
  if(old.busy){
    if(key==='codex'){
      if(!codex.codexTurns.has(codex.bareId(id)))return res.status(409).json({error:'This conversation is active outside Pocket. Stop it there before switching.'});
      codex.stopCodexTurn(codex.bareId(id));
    }else{
      const turn=turns.get(id)||old.process.turn;
      if(turn){turn.stopped=true;signalTurn(turn);}else if(old.process.bgTasks.length)signalTurn(old.process);
      else return res.status(409).json({error:'This conversation is active outside Pocket. Stop it there before switching.'});
    }
    log(`CLI switch requested after stop session=${id}`);
    return res.status(202).json({stopping:true,message:'Stopping work. The next turn will use the updated CLI.'});
  }
  if(key==='codex')codex.closeCodexSession(old.process,'CLI switch requested');
  else closeRunner(old.process,'CLI switch requested');
  res.status(202).json({stopping:false,message:'Old process closing. The next turn will use the updated CLI.'});
});
app.get('/api/environment',requireAuth,async(_req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  const [claude,cx]=await Promise.all([readClaudeIdentity(CLAUDE_BIN,spawnEnv()),CODEX_ON?codex.accountSummary().catch(()=>({provider:'codex',signedIn:null,method:'Status unavailable'})):Promise.resolve({provider:'codex',signedIn:false,method:'Not installed'})]);
  res.json({host:os.hostname(),checkedAt:Date.now(),providers:[claude,cx],claudeActive:turns.size,permissions:'Selectable native tool approvals; not employee isolation',accountManagement:'Claude sign-in changes the shared login on this server, including code-server using the same configuration. Other open Claude processes may need reopening. Codex sign-in is managed by its installed CLI.',capabilities:{claudeQuestions:true,codexQuestions:CODEX_ON,approvalControls:true,claudeLogin:true}});
});
// 1.53: Gmail, Calendar and Drive status through each CLI's own connectors (connectors.mjs).
// `claude mcp list` health-checks every MCP server and a forced Codex refetch reads the whole
// app catalog, so a result is kept for a minute and Refresh asks for a fresh one.
const connectorCache = { claude: null, codex: null };
const connectorFresh = hit => hit && Date.now() - hit.at < 60_000;
// 1.73.8: reads that arrive while one is running share it; two opens no longer run `claude mcp list` twice.
const connectorReads = { claude: null, codex: null };
function readConnectors(kind, refresh) {
  if (!refresh && connectorFresh(connectorCache[kind])) return Promise.resolve(connectorCache[kind].value);
  if (!connectorReads[kind]) connectorReads[kind] = readConnectorsNow(kind, refresh).finally(() => { connectorReads[kind] = null; });
  return connectorReads[kind];
}
async function readConnectorsNow(kind, refresh) {
  const value = kind === 'claude'
    ? await claudeConnectors({ bin: CLAUDE_BIN, env: spawnEnv(), cwd: HOME, home: HOME, managedDir: MANAGED_DIR, identity: await readClaudeIdentity(CLAUDE_BIN, spawnEnv()) })
    : !CODEX_ON ? { provider: 'codex', available: false, reason: 'Codex is turned off or not installed in Pocket on this server.', items: [] }
    : await codexConnectors({ rpc: codex.appRpc, refresh, account: await codex.accountSummary().catch(() => null) });
  // 1.53.2: a failed read is logged and not kept, so the next open or Refresh tries again.
  const { transient, error, ...shown } = value;
  if (transient) { log(`connectors: ${kind} read failed: ${shown.reason}`); connectorCache[kind] = null; return { ...shown, checkedAt: Date.now() }; } // 1.73.8: the fixed reason, not the CLI's error text
  connectorCache[kind] = { at: Date.now(), value: { ...shown, checkedAt: Date.now() } };
  return connectorCache[kind].value;
}
app.get('/api/connectors', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const refresh = req.query.refresh === '1';
  const [claude, cx] = await Promise.all(['claude', 'codex'].map(k => readConnectors(k, refresh).catch(e => { log(`connectors: ${k} read threw ${e?.name || 'an error'}`); return { provider: k, available: false, reason: 'Status unavailable. Try again.', items: [] }; })));
  res.json({ providers: [claude, cx] });
});
app.get('/api/claude/activity',requireAuth,(_req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.json({active:turns.size});
});
app.post('/api/claude/stop-all',requireAuth,(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if (!req.is('application/json') || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({error:'Open this control from Pocket Code.'});
  const expected=req.body?.expected;
  if (!Number.isSafeInteger(expected) || expected<0 || expected>1000) return res.status(400).json({error:'Refresh Claude activity and try again.'});
  if (turns.size>expected) return res.status(409).json({error:'More Claude replies started since you confirmed. Review the new count before stopping them.',active:turns.size});
  let stopping=0;
  for (const [id,turn] of turns) {
    if (turn.stopped || turn.finalized) continue;
    turn.stopped=true;
    signalTurn(turn);
    stopping++;
    log(`stop requested (account switch) session=${id}`);
  }
  res.json({stopping,active:turns.size});
});
app.get('/api/claude/login',requireAuth,(_req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.json(claudeLogin.snapshot());
});
app.post('/api/claude/login/:action',requireAuth,(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if (!req.is('application/json') || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({error:'Open sign-in from Pocket Code.'});
  const {action} = req.params;
  if (action === 'start') {
    const overridden = ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY'].some(key => process.env[key] && process.env[key] !== '0');
    if (overridden) return res.status(409).json({error:'This server uses configured API credentials or a cloud provider. Manage that sign-in on the server.'});
    return res.json(claudeLogin.start());
  }
  if (action === 'code') return res.json(claudeLogin.submit(req.body?.id,req.body?.code));
  if (action === 'cancel') return res.json(claudeLogin.cancel(req.body?.id));
  res.status(404).json({error:'Unknown sign-in action.'});
});
app.get('/api/about', requireAuth, (_req, res) => res.json({
  ...ABOUT, uptime: process.uptime(),
  cli: binVersion(CLAUDE_BIN), codex: CODEX_ON ? binVersion(codex.CODEX_BIN) : null,
}));

// Optional voice mode (voice.mjs): local speech-to-text and text-to-speech. Audio and text stay on this machine.
const voice = new VoiceService({ log });
process.on('exit', () => voice.stop());
const voiceError = (res, e) => res.status(e.status || 503).json({ error: e.message, code: e.code || 'voice_error' });
app.get('/api/voice/status', requireAuth, (_req, res) => res.json(voice.status()));
// Body: 16-bit little-endian mono PCM at 16 kHz (the browser resamples). 90 s cap ≈ 2.9 MB.
app.post('/api/voice/transcribe', requireAuth, express.raw({ type: () => true, limit: '3mb' }), async (req, res) => {
  if (!req.body?.length) return res.status(400).json({ error: 'No audio received.', code: 'audio_missing' });
  try {
    const out = await voice.transcribe(req.body, String(req.headers['x-vocabulary'] || ''));
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ text: out.text || '', seconds: out.seconds, ms: out.ms });
  } catch (e) { voiceError(res, e); }
});
app.post('/api/voice/speak', requireAuth, async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Nothing to say.', code: 'text_required' });
  try {
    const wav = await voice.speak(text, req.body?.voice, Number(req.body?.speed) || 1);
    res.setHeader('Content-Type', 'audio/wav'); res.setHeader('Cache-Control', 'private, no-store');
    res.end(wav);
  } catch (e) { voiceError(res, e); }
});

// Last: whatever a route threw or rejected with ends here, as a 503 for this request only.
app.use((err, req, res, _next) => {
  if (req.path.startsWith('/api/claude/login')) {
    const status = [400,403,409,413].includes(err?.status) ? err.status : 503;
    return res.status(status).set('Cache-Control','private, no-store').json({error:err?.type ? 'Invalid sign-in request. Refresh its status before trying again.' : status === 503 ? 'Sign-in request failed. Refresh its status before trying again.' : err.message});
  }
  log(`request failed ${req.method} ${req.path}: ${err?.stack || err}`);
  if (res.headersSent) { try { res.end(); } catch { } return; }
  res.status(err?.status || 503).json({ error: err?.status ? err.message : 'Request failed. Please retry.' });
});
const server = app.listen(PORT, '127.0.0.1', () => log(`pocket-claude listening on 127.0.0.1:${server.address().port}`));
// 1.91: keep the model lists current. Codex's list is read a few seconds after startup, so a turn that names an
// older version runs the newest from the first reply. Anthropic's list is read a while after startup and then
// daily; a newer Claude model joins the picker and replaces its family's older one. POCKET_CLAUDE_DISCOVERY=0 turns
// that check off.
if (CODEX_ON) setTimeout(() => codex.codexModels().catch(() => { }), 5000).unref();
async function refreshClaudeCatalog() {
  const at = new Date().toISOString();
  try {
    const cred = readClaudeCredential(process.env, HOME);
    if (!cred) { claudeFound = { ...claudeFound, checkedAt: at, error: 'no Claude sign-in on this computer' }; return; }
    const list = await fetchAnthropicModels(cred, process.env.POCKET_ANTHROPIC_MODELS_URL ? { url: process.env.POCKET_ANTHROPIC_MODELS_URL } : {}); // the override is for tests
    const added = addDiscovered(newModelsFrom(list, CLAUDE_MODELS, at.slice(0, 10)));
    for (const m of added) log(`claude catalog: ${m.label} (${m.id}) is new; it replaces older ${m.alias} versions in the picker`);
    claudeFound = { checkedAt: at, error: null, added: [...claudeFound.added, ...added.map(({ id, label, sub, cost, discovered }) => ({ id, label, sub, cost, discovered }))] };
  } catch (e) { claudeFound = { ...claudeFound, checkedAt: at, error: e.message }; log(`claude catalog check failed: ${e.message}`); }
  finally { try { atomicWrite(CLAUDE_FOUND_FILE, claudeFound); } catch { } }
}
if (process.env.POCKET_CLAUDE_DISCOVERY !== '0') {
  const d = process.env.POCKET_CLAUDE_DISCOVERY_DELAY_MS, first = d && Number(d) >= 0 ? Number(d) : 120_000; // the override is for tests
  setTimeout(() => { refreshClaudeCatalog(); setInterval(refreshClaudeCatalog, 24 * 3600_000).unref(); }, first).unref();
}
cliUpdates.start();
resumeHeldReplies(); // 1.89 (F-8): after adoptOrphans and the engine table, which it needs
resumeAfterJobs(); // 1.89.2
refreshTitleProviders(0).catch(() => { }); // know which CLIs can make titles before the first list request

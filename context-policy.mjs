// context-policy.mjs — 1.92: the context limit and the subagent (worker) model, one policy for every engine.
//
// Settings → Agents & instance → Context and subagents saves `contextPolicy` in pocket-settings.json. This module
// checks it, and turns it into what each engine reads when Pocket starts its process. Nothing here is engine
// state; server.mjs (Claude) and codex.mjs (Codex) apply the launch options. Spec: docs/context-policy-spec.md.
//
//   compaction.mode  'agent' (the agent's own behavior) | 'limit' (compact before `limit` tokens)
//   workers.model    'default' (the agent's own choice) | 'tier-down' (one tier below the leader)
//   workers.effort   null | 'low' | 'medium' | 'high'
//
// The defaults change nothing, so an install behaves as before until its owner picks something.

export const LIMIT_MIN = 50_000, LIMIT_MAX = 1_000_000;
export const LIMIT_CHOICES = [150_000, 200_000, 300_000, 400_000, 600_000];
export const WORKER_EFFORTS = ['low', 'medium', 'high'];
export const DEFAULT_POLICY = Object.freeze({ compaction: { mode: 'agent', limit: 200_000 }, workers: { model: 'default', effort: null } });
// Codex compacts at its token limit, Claude ~33K before its window (about 16% at 200K); 85% keeps the two close.
export const CODEX_LIMIT_SHARE = 0.85;

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// The saved value, filled out with the defaults. Anything unreadable counts as the default.
export function readPolicy(saved) {
  const c = isObj(saved?.compaction) ? saved.compaction : {}, w = isObj(saved?.workers) ? saved.workers : {};
  const limit = Number.isInteger(c.limit) && c.limit >= LIMIT_MIN && c.limit <= LIMIT_MAX ? c.limit : DEFAULT_POLICY.compaction.limit;
  return {
    compaction: { mode: c.mode === 'limit' ? 'limit' : 'agent', limit },
    workers: { model: w.model === 'tier-down' ? 'tier-down' : 'default', effort: WORKER_EFFORTS.includes(w.effort) ? w.effort : null },
  };
}

// A patch from POST /api/settings, merged over the current policy. Returns { policy } or { error } (a 400's text).
export function cleanPolicy(patch, current) {
  if (!isObj(patch)) return { error: 'Context and subagents: send an object.' };
  const next = readPolicy(current);
  if (patch.compaction !== undefined) {
    if (!isObj(patch.compaction)) return { error: 'Context limit: send an object.' };
    const { mode, limit } = patch.compaction;
    if (mode !== undefined) { if (!['agent', 'limit'].includes(mode)) return { error: 'Context limit: choose the agent’s own or a limit.' }; next.compaction.mode = mode; }
    if (limit !== undefined) {
      if (!Number.isInteger(limit) || limit < LIMIT_MIN || limit > LIMIT_MAX) return { error: `Context limit: choose between ${LIMIT_MIN / 1000}K and ${LIMIT_MAX / 1000}K tokens.` };
      next.compaction.limit = limit;
    }
  }
  if (patch.workers !== undefined) {
    if (!isObj(patch.workers)) return { error: 'Subagents: send an object.' };
    const { model, effort } = patch.workers;
    if (model !== undefined) { if (!['default', 'tier-down'].includes(model)) return { error: 'Subagent model: choose the agent’s own or one tier down.' }; next.workers.model = model; }
    if (effort !== undefined) { if (effort !== null && !WORKER_EFFORTS.includes(effort)) return { error: 'Subagent effort: choose low, medium, high or the agent’s own.' }; next.workers.effort = effort; }
  }
  return { policy: next };
}

// 1.102: the handoff offer. Pocket suggests handing a conversation off once its context passes this size, at a break in
// the work (the app decides the break). `handoffOffer` in pocket-settings.json is null (the default, 200K), 0 (off) or
// one of HANDOFF_CHOICES. With Compact conversations on at or below that size the agent would compact first, so the
// offer comes at three quarters of the compaction limit instead, rounded to 10K.
export const HANDOFF_CHOICES = [150_000, 200_000, 300_000, 400_000];
export const HANDOFF_DEFAULT = 200_000;
export const isHandoffOffer = v => v === null || v === 0 || HANDOFF_CHOICES.includes(v);
export function handoffOfferAt(offer, savedPolicy) {
  const at = offer === null || offer === undefined || !isHandoffOffer(offer) ? HANDOFF_DEFAULT : offer;
  if (!at) return 0;
  const p = readPolicy(savedPolicy);
  if (p.compaction.mode === 'limit' && p.compaction.limit <= at) return Math.max(LIMIT_MIN, Math.round(p.compaction.limit * 0.75 / 10_000) * 10_000);
  return at;
}

export const isDefaultPolicy = p => { const r = readPolicy(p); return r.compaction.mode === 'agent' && r.workers.model === 'default' && !r.workers.effort; };

// Claude: the worker one tier below the leader, as a CLI alias so it follows the newest version.
// Fable and Mythos → opus, Opus → sonnet; anything else keeps the CLI's own choice (null).
export function claudeWorkerFor(leader) {
  const m = String(leader || '').toLowerCase();
  if (/fable|mythos/.test(m)) return 'opus';
  if (/opus/.test(m)) return 'sonnet';
  return null;
}

// Codex: GPT Astra → the newest GPT Sol Codex lists (`newestSol`, null when the list is not known yet).
export function codexWorkerFor(leader, newestSol) {
  return /(^|-)astra$/i.test(String(leader || '')) && newestSol ? newestSol : null;
}

// What a Claude process is started with: `env` goes into --settings (it outranks ~/.claude/settings.json env).
export function claudeLaunch(saved, leader) {
  const p = readPolicy(saved), env = {};
  if (p.compaction.mode === 'limit') env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(p.compaction.limit);
  const worker = p.workers.model === 'tier-down' ? claudeWorkerFor(leader) : null;
  if (worker) env.CLAUDE_CODE_SUBAGENT_MODEL = worker;
  if (p.workers.effort) env.CLAUDE_CODE_SUBAGENT_EFFORT = p.workers.effort;
  return { env, key: launchKey(env) };
}

// What a Codex thread is opened with: `config` overrides on thread/start, thread/resume and thread/fork.
export function codexLaunch(saved, leader, newestSol) {
  const p = readPolicy(saved), config = {};
  if (p.compaction.mode === 'limit') config.model_auto_compact_token_limit = Math.round(p.compaction.limit * CODEX_LIMIT_SHARE);
  const worker = p.workers.model === 'tier-down' ? codexWorkerFor(leader, newestSol) : null;
  if (worker) config['agents.default_subagent_model'] = worker;
  if (p.workers.effort) config['agents.default_subagent_reasoning_effort'] = p.workers.effort;
  return { config, key: launchKey(config) };
}

// A stable string for what a process was started with, so a reused process can tell the policy has changed.
// The empty policy is '' so a process started before this feature counts as started with the default.
export function launchKey(obj) {
  const keys = Object.keys(obj || {}).sort();
  return keys.length ? keys.map(k => `${k}=${obj[k]}`).join(';') : '';
}

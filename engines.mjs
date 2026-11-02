// engines.mjs — the engine registry.
//
// An "engine" is the agent harness Pocket drives end to end: it owns the tool loop,
// approvals, questions, streaming, transcripts and usage. Today there are two — Claude
// Code and Codex — and the code branched on a `'claude' | 'codex'` string inline in many
// places (server.mjs validateModel, the `isCx(id) ? 'codex' : 'claude'` session-id rule,
// settings and routing). This module makes the engine a first-class, data-driven concept
// so a third engine is a registry entry plus its adapter, not scattered `=== 'codex'` edits.
//
// The engine (transport/harness) is distinct from the inference PROVIDER and the MODEL:
// one engine can front more than one provider. Splitting `provider` into
// {engine, inferenceProvider, model, credentialRef} is the next step — see
// docs/openrouter-acp-engine-spec.md (M0). This module is the first, behaviour-preserving
// slice: the registry + the generalized model-compatibility check server.mjs used to inline.
//
// Each entry:
//   id        — stable engine key (also the legacy `provider` value for claude/codex).
//   label     — human name used in the "choose a <label> model" error.
//   idPrefix  — session-id prefix marking this engine's sessions (null = the default/unprefixed).
//   routed    — true when server.mjs can actually run a turn on this engine today.
//   foreign   — model ids that clearly belong to ANOTHER engine, used to reject an obvious
//               mismatch early. The generalized form of the old validateModel regexes.
// features — what the app may offer on this engine's conversations (1.86). A feature that works on every engine is not
//               listed; one listed false is hidden for that engine rather than offered and failing. The rule for new
//               work: build a feature for every engine (server.mjs ENGINE_OPS), or list it here false where it cannot work.
//   steer          a message sent during a reply goes into that reply
//   sideChat       Side chat (a quick question beside the conversation)
//   branch         Branch (a copy of the conversation to continue separately)
//   planMode       "Plan first": explore and answer questions before changing anything
//   autoModel      Automatic model choice
//   awaySummary    "While you were away" (needs message times the engine records)
//   subagents      the Subagents panel
//   connectors     the account's Gmail, Calendar and Drive connectors
//   contextPolicy  1.92: Settings' context limit and subagent model reach this engine's processes (context-policy.mjs)
export const ENGINES = {
  claude: {
    id: 'claude', label: 'Claude', idPrefix: null, routed: true,
    foreign: /^(?:gpt-|codex(?:$|-)|o\d(?:$|-))/i,
    features: { steer: true, sideChat: true, branch: true, planMode: false, autoModel: true, awaySummary: true, subagents: true, connectors: true, contextPolicy: true },
  },
  codex: {
    id: 'codex', label: 'Codex', idPrefix: 'cx:', routed: true,
    foreign: /^(?:claude-|opus(?:$|\[)|sonnet(?:$|\[)|haiku(?:$|\[)|fable(?:$|\[))/i,
    features: { steer: true, sideChat: true, branch: true, planMode: true, autoModel: false, awaySummary: true, subagents: true, connectors: true, contextPolicy: true },
  },
  // OpenRouter models through OpenCode over ACP (acp.mjs), opt-in per server (POCKET_ACP_ENABLE). Its models are
  // provider-prefixed OpenRouter slugs (openrouter/deepseek/deepseek-v4.1-flash-1017); a Claude- or GPT-looking id is a
  // mismatch. ACP has no mid-reply input or fork that Pocket uses yet, replayed history carries no times, and OpenCode
  // exposes no subagents or account connectors.
  acp: {
    id: 'acp', label: 'OpenRouter', idPrefix: 'acp:', routed: true,
    foreign: /^(?:claude-|opus(?:$|\[)|sonnet(?:$|\[)|haiku(?:$|\[)|fable(?:$|\[)|gpt-|codex(?:$|-)|o\d(?:$|-))/i,
    features: { steer: false, sideChat: false, branch: false, planMode: true, autoModel: false, awaySummary: false, subagents: false, connectors: false, contextPolicy: false },
  },
};

export const ENGINE_IDS = Object.keys(ENGINES);
// Engines server.mjs can run a turn on (all three since 1.84; acp only where the server enables it).
export const routedEngineIds = () => ENGINE_IDS.filter(id => ENGINES[id].routed);

// The engine that owns a session id, by its prefix. Unprefixed ids are Claude (the default) —
// identical to the long-standing `isCx(id) ? 'codex' : 'claude'` rule, generalized to the registry.
export function engineForSessionId(id) {
  if (typeof id === 'string') for (const e of ENGINE_IDS) {
    const p = ENGINES[e].idPrefix;
    if (p && id.startsWith(p)) return e;
  }
  return 'claude';
}

// Throws a 400 when `model` is obviously not one this engine can run (a pick from the wrong
// menu). `null`/`'default'` always pass. For 'claude'/'codex' this is byte-for-byte the old
// server.mjs validateModel behaviour; the generalization is that the rule is per-engine data.
export function validateModelForEngine(engine, model) {
  if (model == null || model === 'default') return;
  const e = ENGINES[engine];
  const bad = typeof model !== 'string' || Boolean(e && e.foreign.test(model));
  if (bad) {
    const err = new Error(`Choose a ${e ? e.label : 'valid'} model from the model menu, then send again.`);
    err.status = 400; err.code = 400;
    throw err;
  }
}

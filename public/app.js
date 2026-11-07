/* Pocket Code client — hash router: #/ sessions · #/chat/<id> · #/new */
'use strict';
const $ = sel => document.querySelector(sel);
const app = $('#app');

/* ---------- drawn icons (1.8px stroke, round caps) ---------- */
const IC = {
  back: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  inbox: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13l2.5-7.5h11L20 13v6H4zM4 13h5l1.5 2.5h3L15 13h5"/></svg>', // 1.69
  vault: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>', // 1.69: the rail's Vault entry
  chat: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14v10H10l-4 3.5v-3.5H5z"/></svg>', // 1.69
  hand: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 12h2a2 2 0 100-4h-3c-.6 0-1.1.2-1.4.6L3 14"/><path d="M7 18l1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 00-2.75-2.91l-4.2 3.9"/><path d="M2 13l6 6"/></svg>', // 1.96: a side-on hand passing something, never a raised palm (that reads as stop). Lucide hand-helping, ISC
  branch: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="5.5" r="2"/><circle cx="7" cy="18.5" r="2"/><circle cx="17" cy="7.5" r="2"/><path d="M7 7.5v9M17 9.5c0 4.5-10 2.5-10 7"/></svg>', // 1.79
  // 1.76.2: the rail switch's own glyphs, one silhouette each (a bubble, a flag, a page, a circle, a lock, an envelope),
  // since a folder, a page, a checkbox and a tray all read as the same small box. The folder stays the workspace glyph.
  railChats: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5h15v10.5h-8.5l-4.5 3.8v-3.8h-2z"/><path d="M8.5 9.5h7M8.5 12.5h4.5"/></svg>',
  railProjects: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V3.5"/><path d="M6 4.5h12.5l-3.5 4.5 3.5 4.5H6"/></svg>', // 1.76.4: a flag, a goal with a next step (Damon's glyph)
  railFiles: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3h7.5l4.5 4.5V21h-12z"/><path d="M14 3v4.5h4.5M9.5 12h6M9.5 15.5h6"/></svg>',
  railTasks: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.3l2.6 2.6 4.9-5.3"/></svg>',
  railInbox: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/></svg>',
  plus: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  refresh: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 11-2.2-5.3M19.5 4.5V9H15"/></svg>', // 1.75: Inbox Check now
  up: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6 12l6-6 6 6"/></svg>',
  down: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v13M6 12l6 6 6-6"/></svg>',
  term: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7l4 5-4 5M12 17h7"/></svg>',
  doc: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7zM14 3v4h4"/></svg>',
  globe: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c-5 5.7-5 11.3 0 17 5-5.7 5-11.3 0-17z"/></svg>',
  cog: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.98 5.4L10.24 2.97L13.76 2.97L14.02 5.4L15.24 5.91L17.14 4.37L19.63 6.86L18.09 8.76L18.6 9.98L21.03 10.24L21.03 13.76L18.6 14.02L18.09 15.24L19.63 17.14L17.14 19.63L15.24 18.09L14.02 18.6L13.76 21.03L10.24 21.03L9.98 18.6L8.76 18.09L6.86 19.63L4.37 17.14L5.91 15.24L5.4 14.02L2.97 13.76L2.97 10.24L5.4 9.98L5.91 8.76L4.37 6.86L6.86 4.37L8.76 5.91z"/><circle cx="12" cy="12" r="3"/></svg>',
  sliders: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h8.5M16.5 7H20M4 12h2.5M10.5 12H20M4 17h10.5M18.5 17H20"/><circle cx="14.5" cy="7" r="2"/><circle cx="8.5" cy="12" r="2"/><circle cx="16.5" cy="17" r="2"/></svg>',
  folder: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2.5h9v10h-17z"/></svg>',
  clip: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5l-8.3 8.3a5 5 0 01-7-7L13 4.5a3.4 3.4 0 014.8 4.8L9.7 17.4a1.8 1.8 0 01-2.5-2.5L15 7.2"/></svg>',
  stop: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  x: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  info: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  gauge: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14a8 8 0 0116 0M12 14l3.5-4.5"/><circle cx="12" cy="14" r="1.6"/></svg>',
  bell: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10a6 6 0 0112 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6zM10 19.5a2.2 2.2 0 004 0"/></svg>',
  bellOff: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10a6 6 0 0112 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6zM10 19.5a2.2 2.2 0 004 0M4 4l16 16"/></svg>',
  search: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  panel: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/></svg>',
  model: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 2.5v2.5M15 2.5v2.5M9 19v2.5M15 19v2.5M2.5 9h2.5M2.5 15h2.5M19 9h2.5M19 15h2.5"/></svg>',
  copy: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 6.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7a2 2 0 002 2h.5"/></svg>',
  tick: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  task: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
  up1: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14l6-6 6 6"/></svg>',
  down1: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10l6 6 6-6"/></svg>',
  fwd1: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6l6 6-6 6"/></svg>',
  ask: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6M12 17v.5"/></svg>',
  diff: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7zM14 3v4h4M10.5 10.5h4M12.5 8.5v4M10.5 16h4"/></svg>',
  snow: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21L12 3M12 6.4l2.5 -2.1M12 6.4l-2.5 -2.1M19.8 16.5L4.2 7.5M7.2 9.2l-0.6 -3.2M7.2 9.2l-3 1.1M19.8 7.5L4.2 16.5M7.2 14.8l-3 -1.1M7.2 14.8l-0.6 3.2M12 17.6l-2.5 2.1M12 17.6l2.5 2.1M16.8 14.8l0.6 3.2M16.8 14.8l3 -1.1M16.8 9.2l3 1.1M16.8 9.2l0.6 -3.2"/></svg>',
  hourglass: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h12M6 20.5h12M7.5 3.5c0 5 9 4.5 9 8.5s-9 3.5-9 8.5M16.5 3.5c0 5-9 4.5-9 8.5s9 3.5 9 8.5"/></svg>',
  pin: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 3.5h7M10 3.5l-.6 6L6 12.5V14h12v-1.5L14.6 9.5l-.6-6M12 14v6.5"/></svg>',
  grip: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6.5h.01M9.5 12h.01M9.5 17.5h.01M14.5 6.5h.01M14.5 12h.01M14.5 17.5h.01" stroke-width="2.8"/></svg>',
  speaker: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4zM16.5 9.2a4.2 4.2 0 010 5.6M19 6.5a7.8 7.8 0 010 11"/></svg>',
  speakerOff: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4zM16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>',
  more: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
  columns: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5v15"/></svg>',
  tab: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17M10.5 4.5V9"/></svg>',
  list: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M4.5 12h15M4.5 17h15"/></svg>',
  grid: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>',
  external: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4.5h5.5V10M19.5 4.5L11 13M18 13.5v6H4.5V6H10"/></svg>',
  link: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 13.5a3.8 3.8 0 005.4 0l3-3a3.8 3.8 0 00-5.4-5.4l-1.3 1.3M13.5 10.5a3.8 3.8 0 00-5.4 0l-3 3a3.8 3.8 0 005.4 5.4l1.3-1.3"/></svg>',
  share: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="17.5" cy="6" r="2.3"/><circle cx="6.5" cy="12" r="2.3"/><circle cx="17.5" cy="18" r="2.3"/><path d="M8.6 10.9l6.8-3.7M8.6 13.1l6.8 3.7"/></svg>',
  swap: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5"/></svg>',
  spark: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 10.5l5.1-1.9zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>',
  bookmark: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h10a1 1 0 011 1v16l-6-4-6 4v-16a1 1 0 011-1z"/></svg>',
  pen: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l.9-3.9L16 5a2.1 2.1 0 013 3L7.9 19.1 4 20zM13.8 7.2l3 3"/></svg>',
};

/* ---------- per-turn options: model / effort / attachments ---------- */
// Claude's list lives on the server (server.mjs CLAUDE_MODELS) so a new model is a
// one-line server change; this copy is only the offline fallback until it loads.
// CLAUDE_CATALOG also lets Settings draw the model rows before the server's answer, so the panel keeps its height.
const CLAUDE_CATALOG = [
  ['claude-fable-5-1[1m]', 'Fable 5.1', 'Top tier · 1M context'],
  ['claude-opus-5-5[1m]', 'Opus 5.5', 'Strong + cheaper than Fable · 1M'],
  ['claude-sonnet-5-5', 'Sonnet 5.5', 'Fast, strong all-rounder · 1M'],
  ['claude-haiku-5-5', 'Haiku 5.5', 'Fastest current model · 1M'],
];
let MODELS = [['default', 'Default', 'Your global setting'], ...CLAUDE_CATALOG];
let claudeModelsLoaded = false;
async function loadClaudeModels() {
  if (claudeModelsLoaded) return MODELS;
  try {
    const { models, defaultLabel, defaultEffort, pocketDefault, maxEffort, replaced } = await api('/claude/models');
    Object.assign(LEGACY_MODELS, replaced || {}); // 1.91: older versions move forward to the newest of their family
    if (Array.isArray(models)) { // 1.52: only the offered models; none offered leaves Default alone
      // 4th field = chip text, so Default shows the model it actually runs
      MODELS = [['default', 'Default', `${defaultLabel || 'Global'} · ${pocketDefault ? 'Pocket default' : 'your global setting'}`, defaultLabel || 'Default'],
        ...models.map(m => [m.id, m.label || m.id, m.sub || ''])];
      providerDefaults.claude = { effort: defaultEffort, pocket: pocketDefault, maxEffort: maxEffort || null };
      claudeModelsLoaded = true;
    }
  } catch { }
  return MODELS;
}
// per-session picks saved under retired ids carry forward to their successor
// (1.91: the server adds every replaced Claude and Codex version here as the lists load)
const LEGACY_MODELS = { 'claude-opus-5': 'claude-opus-5-5[1m]', 'claude-fable-5': 'claude-fable-5-1[1m]' };
// Codex advertises its own models; fetched once and cached so the picker in a Codex
// session offers real options instead of Claude's list.
let CODEX_MODELS = [['default', 'Default', 'Your Codex config']];
// 1.81: what each Codex model says it supports. Ultra (maximum reasoning plus automatic task delegation) is on some models only,
// so it is offered for the model this reply will use, which for Default is POCKET_CODEX_MODEL when it is set.
let codexEfforts = new Map();
const offersUltra = () => tb?.provider === 'codex' && codexEfforts.get(tb.prefs.model === 'default' ? providerDefaults.codex.model : tb.prefs.model)?.includes('ultra');
async function loadCodexModels() {
  if (CODEX_MODELS.length > 1) return CODEX_MODELS;
  try {
    const { models, defaultModel, defaultEffort, pocketDefault, replaced } = await api('/codex/models');
    Object.assign(LEGACY_MODELS, replaced || {}); // 1.91
    if (models?.length) {
      const label = defaultModel && (models.find(m => m.id === defaultModel)?.label || defaultModel);
      CODEX_MODELS = [['default', 'Default', label ? `${label} · Pocket default` : 'Your Codex config', label || 'Default'],
        ...models.map(m => [m.id, m.label || m.id, ''])];
      providerDefaults.codex = { effort: defaultEffort, pocket: pocketDefault, model: defaultModel || null };
      codexEfforts = new Map(models.filter(m => Array.isArray(m.efforts)).map(m => [m.id, m.efforts])); // 1.81
    }
  } catch { }
  return CODEX_MODELS;
}
// The OpenRouter (ACP) engine's models, fetched once when the engine is enabled. Same row shape
// as the Claude/Codex lists ([value,label,sub,chip]); the sub carries the tier + context/price.
let ACP_MODELS = [['default', 'Default', 'The instance default model']];
let acpEnabled = null; // null = not yet checked; set by loadAcpModels
// 1.84.1: the reasoning-effort levels OpenCode offers for each OpenRouter model (slug -> levels; [] = none).
let acpEfforts = new Map();
async function loadAcpModels() {
  if (acpEnabled !== null) return ACP_MODELS;
  try {
    const { enabled, defaultModel, defaultEfforts, curated, experimental, error } = await api('/acp/models');
    acpEnabled = Boolean(enabled);
    if (enabled) {
      const defLabel = defaultModel && ([...(curated || []), ...(experimental || [])].find(m => m.slug === defaultModel)?.name || defaultModel);
      const row = (m, tier) => { const ctx = m.contextLength ? Math.round(m.contextLength / 1000) + 'K ctx' : ''; return [m.slug, m.name, [tier, ctx].filter(Boolean).join(' · '), m.name]; };
      ACP_MODELS = [['default', 'Default', defLabel ? `${defLabel} · instance default` : 'The instance default model', defLabel || 'Default'],
        ...(curated || []).map(m => row(m, 'Tested')),
        ...(experimental || []).map(m => row(m, 'Experimental — unverified'))];
      providerDefaults.acp = { model: defaultModel || null };
      acpEfforts = new Map([...(curated || []), ...(experimental || [])].map(m => [m.slug, Array.isArray(m.efforts) ? m.efforts : []]));
      if (defaultModel && !acpEfforts.has(defaultModel) && Array.isArray(defaultEfforts)) acpEfforts.set(defaultModel, defaultEfforts); // the catalog can be unreachable
      if (error) ACP_MODELS.push(['default', 'Catalog unavailable', error]);
    }
  } catch { acpEnabled = false; }
  return ACP_MODELS;
}
const modelList = () => (tb?.provider === 'codex' ? CODEX_MODELS : tb?.provider === 'acp' ? ACP_MODELS : MODELS);
// Default effort row names the level Pocket will send; without one it's the CLI's own setting.
// OpenRouter: only the levels the reply's model takes, strongest first; none at all hides the chip.
const acpModelNow = () => tb?.prefs.model === 'default' ? providerDefaults.acp.model : tb?.prefs.model;
const acpEffortLevels = () => { const order = ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none']; return (acpEfforts.get(acpModelNow()) || []).filter(v => order.includes(v)).sort((a, b) => order.indexOf(a) - order.indexOf(b)); };
const effortList = () => {
  if (tb?.provider === 'acp') return [['default', 'Default', "The model's own default", 'Default'], ...acpEffortLevels().map(v => EFFORTS.find(e => e[0] === v) || ACP_EFFORTS[v])];
  const d = providerDefaults[tb?.provider === 'codex' ? 'codex' : 'claude'], name = d.effort && EFFORT_NAMES[d.effort];
  // 1.67: nothing above the managed policy's ceiling (maxEffortLevel) is offered for Claude.
  const cap = tb?.provider === 'codex' ? null : d.maxEffort, order = EFFORTS.map(e => e[0]).reverse();
  const allowed = cap ? EFFORTS.filter(([v]) => order.indexOf(v) <= order.indexOf(cap)) : EFFORTS;
  return [['default', 'Default', name ? `${name} · Pocket default` : tb?.provider === 'codex' ? 'Your Codex config' : 'Your global setting', name || 'Default'], ...(offersUltra() ? [['ultra', 'Ultra', 'Maximum, with automatic task delegation']] : []), ...allowed];
};
const providerDefaults = { claude: {}, codex: {}, acp: {} };
// 1.86: what each engine can do (engines.mjs, served at /api/engines). A feature an engine lists false is hidden on its
// conversations rather than offered and failing. Until the server answers, OpenRouter's known gaps are assumed.
const ENGINE_FEATURES = { claude: {}, codex: {}, acp: { steer: false, sideChat: false, branch: false, autoModel: false, awaySummary: false, subagents: false, connectors: false } };
const providerOf = id => String(id || '').startsWith('cx:') ? 'codex' : String(id || '').startsWith('acp:') ? 'acp' : 'claude';
const engineHas = (provider, feature) => ENGINE_FEATURES[provider]?.[feature] !== false;
const ENGINE_LABELS = { claude: 'Claude', codex: 'Codex', acp: 'OpenRouter' };
window.PocketEngines = { has: engineHas, providerOf, label: p => ENGINE_LABELS[p] || 'Claude' };
api('/engines').then(r => { for (const [k, v] of Object.entries(r?.engines || {})) ENGINE_FEATURES[k] = { ...(v.features || {}) }; }).catch(() => { });
const EFFORTS = [
  ['max', 'Max', 'Deepest reasoning'],
  ['xhigh', 'X-High', 'Slightly leaner than max'],
  ['high', 'High', 'Balanced'],
  ['medium', 'Medium', 'Quicker, cheaper'],
  ['low', 'Low', 'Snappy, simple tasks'],
];
// Levels only some OpenRouter models take.
const ACP_EFFORTS = { minimal: ['minimal', 'Minimal', 'Barely any reasoning'], none: ['none', 'None', 'No reasoning, fastest and cheapest'] };
const EFFORT_NAMES = Object.fromEntries([...EFFORTS.map(([v, l]) => [v, l]), ['ultra', 'Ultra'], ['minimal', 'Minimal'], ['none', 'None']]);
function getPrefs(key) {
  try {
    const p = { model: 'default', effort: 'default', ...JSON.parse(localStorage.getItem('pc-prefs-' + key) || '{}') };
    if (LEGACY_MODELS[p.model]) p.model = LEGACY_MODELS[p.model];
    return p;
  }
  catch { return { model: 'default', effort: 'default' }; }
}
function setPrefs(key, p) { localStorage.setItem('pc-prefs-' + key, JSON.stringify(p)); }

let closeCurrentSheet = null, sheetReturnFocus = null;
function mountSheet(scrim, sh, trigger = document.activeElement) {
  const previousSheet = document.querySelector('.sheet[role=dialog]');
  const parentSettings = !sh.classList.contains('settings-sheet') && (previousSheet?._settingsReturn || previousSheet?._settingsParent);
  // A replacement sheet inherits the original, still-connected opener.
  if (trigger?.closest?.('[role="dialog"]')) trigger = sheetReturnFocus;
  closeCurrentSheet?.();
  sheetReturnFocus = trigger;
  const heading = sh.querySelector('h2');
  if (heading) { heading.id = 'sheet-title'; sh.setAttribute('aria-labelledby', heading.id); }
  sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.tabIndex = -1;
  const closeButton = document.createElement('button'); closeButton.className = 'sheet-close icon';
  closeButton.setAttribute('aria-label', 'Close dialog'); closeButton.innerHTML = IC.x;
  sh.prepend(closeButton);
  if (parentSettings) {
    sh._settingsParent = parentSettings;
    const back = document.createElement('button'); back.className = 'chip sheet-back'; back.innerHTML = IC.back + 'Back to Settings';
    back.onclick = parentSettings; heading?.before(back);
  }
  const close = () => {
    sh.removeEventListener('keydown', keydown); scrim.remove(); sh.remove(); app.inert = false;
    if (closeCurrentSheet === close) { closeCurrentSheet = null; sheetReturnFocus = null; }
    const target = [trigger, $('#chatmore'), $('#railsettings'), $('#settings'), $('#box'), $('#first')]
      .find(el => el?.isConnected && el.getClientRects().length && !el.disabled);
    target?.focus({preventScroll:true});
  };
  // Closed <details> content keeps layout boxes in newer Chrome (content-visibility), so rects alone
  // would count hidden links as tabbable and the trap would let focus escape past the last summary.
  const visible = el => (typeof el.checkVisibility === 'function' ? el.checkVisibility({contentVisibilityAuto:true}) : true) && el.getClientRects().length;
  const focusables = () => [...sh.querySelectorAll('button,input,textarea,select,summary,a[href],[tabindex="0"]')].filter(el => !el.disabled && el.tabIndex >= 0 && visible(el));
  const keydown = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      const items = focusables(), first = items[0], last = items.at(-1);
      if (!first) { e.preventDefault(); sh.focus(); }
      else if (e.shiftKey && (document.activeElement === first || document.activeElement === sh)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  scrim.onclick = close; closeButton.onclick = close; sh.addEventListener('keydown', keydown);
  app.inert = true; document.body.append(scrim, sh); closeCurrentSheet = close;
  (focusables().find(el => el.matches('input,textarea')) || closeButton).focus();
  return close;
}

// 1.88: `search` (a noun, e.g. 'models') adds a find box above a long list, such as OpenRouter's hundreds of models.
// Every word typed must appear in the row's name, line or id, so "kimi 3.1" finds Kimi K3.1 Pro; rows keep their order,
// so Default and Tested stay first. Enter picks the first match, Down moves into the list.
function sheet(title, options, current, onPick, { search = '' } = {}) {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet';
  sh.innerHTML = `<h2>${esc(title)}</h2>` + (search ? `
    <div class="sheet-find"><div class="session-search">${IC.search}<input type="search" aria-label="Search ${esc(search)}" placeholder="Search ${esc(search)}" autocomplete="off" spellcheck="false" enterkeyhint="go"></div>
    <p class="sheet-search-status" role="status"></p></div>` : '') + options.map(([val, label, sub]) => `
    <button class="opt ${val === current ? 'sel' : ''}" data-v="${esc(val)}">
      <span class="dot"></span><span>${esc(label)}<span class="sub">${esc(sub)}</span></span>
    </button>`).join('');
  const close = () => closeCurrentSheet?.();
  scrim.onclick = close;
  const opts = [...sh.querySelectorAll('.opt')];
  opts.forEach(b => b.onclick = () => { close(); onPick(b.dataset.v); });
  const input = search && sh.querySelector('.sheet-find input');
  if (input) {
    const status = sh.querySelector('.sheet-search-status');
    const haystack = opts.map((b, i) => [options[i][0], options[i][1], options[i][2]].join(' ').toLowerCase());
    const shown = () => opts.filter(b => !b.hidden);
    input.oninput = () => {
      const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      opts.forEach((b, i) => { b.hidden = !words.every(w => haystack[i].includes(w)); });
      const n = shown().length;
      status.textContent = !words.length ? '' : n ? `${n} of ${opts.length} ${search}` : `No ${search} match “${input.value.trim()}”`;
    };
    input.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); shown()[0]?.click(); }
      else if (e.key === 'Escape' && input.value) { e.preventDefault(); e.stopPropagation(); input.value = ''; input.oninput(); } // first Escape clears, the next closes
      else if (e.key === 'ArrowDown') { e.preventDefault(); shown()[0]?.focus(); }
    };
    sh.addEventListener('keydown', e => { // Up/Down walk the matches; Up from the first goes back to the box
      if (!e.target.matches?.('.opt') || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
      const list = shown(), i = list.indexOf(e.target); e.preventDefault();
      (e.key === 'ArrowDown' ? list[i + 1] : i > 0 ? list[i - 1] : input)?.focus();
    });
  }
  mountSheet(scrim, sh);
  // On a phone the keyboard would cover the Default and Tested rows, so the box waits for a tap there.
  if (input && matchMedia('(pointer: coarse)').matches) sh.focus({ preventScroll: true });
  sh.querySelector('.opt.sel')?.scrollIntoView({ block: 'nearest' });
}

// 1.52: the server ran a turn on the default because the picked model is not offered. Say so, refresh the
// picker (Settings or the policy changed since it loaded) and put this session's pick back to Default.
function modelFellBack(id, f) {
  toast(f.message || 'That model is not offered, so this reply uses the default model.');
  claudeModelsLoaded = false;
  if (id) { const p = getPrefs(id); if (p.model === f.requested) setPrefs(id, { ...p, model: 'default' }); }
  loadClaudeModels().then(() => renderToolbar());
}
/* Toolbar state shared by chat + new views */
let tb = null; // {key, prefs, attachments:[{path,name}], allowAttach}
function normalizeModelPick() {
  if (!tb) return;
  // 1.91: a saved pick of a version that has since been replaced moves to its successor (GPT-6 Sol → GPT-6.1 Sol).
  if (LEGACY_MODELS[tb.prefs.model]) { tb.prefs.model = LEGACY_MODELS[tb.prefs.model]; setPrefs(tb.key, tb.prefs); }
  const model = tb.prefs.model;
  // ACP models are provider-prefixed OpenRouter slugs; a pick not in the loaded acp list goes back
  // to Default (same rule as the Claude list), and any Claude/Codex-looking id is incompatible.
  const incompatible = tb.provider === 'acp'
    ? /^(?:claude-|opus(?:$|\[)|sonnet(?:$|\[)|haiku(?:$|\[)|fable(?:$|\[)|gpt-|codex(?:$|-)|o\d(?:$|-))/i.test(model)
    : tb.provider === 'codex'
    ? /^(?:claude-|opus(?:$|\[)|sonnet(?:$|\[)|haiku(?:$|\[)|fable(?:$|\[))/i.test(model)
    : /^(?:gpt-|codex(?:$|-)|o\d(?:$|-))/i.test(model);
  // 1.52: a pick the picker no longer offers (Settings or this computer's Claude Code policy) goes back to Default.
  const unoffered = (tb.provider === 'claude' && claudeModelsLoaded && model !== 'default' && !MODELS.some(m => m[0] === model))
    || (tb.provider === 'acp' && acpEnabled && model !== 'default' && !ACP_MODELS.some(m => m[0] === model));
  if (incompatible || unoffered) {
    tb.prefs.model = 'default';
    setPrefs(tb.key, tb.prefs);
  }
  // 1.84.1: an OpenRouter effort the reply's model does not take goes back to Default (once the levels are known).
  if (tb.provider === 'acp' && tb.prefs.effort !== 'default' && acpEfforts.size && !acpEffortLevels().includes(tb.prefs.effort)) {
    tb.prefs.effort = 'default';
    setPrefs(tb.key, tb.prefs);
  }
  // 1.81: an Ultra pick the model (or the agent) does not offer goes back to Default; until Codex's models load there is nothing to compare with.
  if (tb.prefs.effort === 'ultra' && (tb.provider !== 'codex' || codexEfforts.size) && !offersUltra()) {
    tb.prefs.effort = 'default';
    setPrefs(tb.key, tb.prefs);
  }
}
function tbLabel(list, v) { const option = list.find(option => option[0] === v); return option ? option[3] || option[1] : v || list[0][1]; }
function renderToolbar() {
  const bar = $('#tbar'); if (!bar || !tb) return;
  const focusedControl=bar.contains(document.activeElement)?document.activeElement.id:null;
  normalizeModelPick();
  $('#composer-actions #c-att')?.remove();
  bar.innerHTML = `
    ${tb.allowAttach ? `<button class="chip" id="c-att" aria-label="Attach files">${IC.clip}Attach</button>` : ''}
    <button class="chip ${tb.prefs.model !== 'default' ? 'set' : ''}" id="c-model">${IC.model}${esc(tbLabel(modelList(), tb.prefs.model))}</button>
    ${tb.provider === 'acp' && !acpEffortLevels().length ? '' : `<button class="chip ${tb.prefs.effort !== 'default' ? 'set' : ''}" id="c-eff">${IC.gauge}${esc(tbLabel(effortList(), tb.prefs.effort))}</button>`}
    <button class="chip" id="c-approval" title="Permissions for the next reply" aria-label="Permissions for the next reply: ${permissionLabel(nextApprovalMode())}"><span class="label-full">${permissionLabel(nextApprovalMode())}</span><span class="label-short" aria-hidden="true">${nextApprovalMode() === 'full' ? 'Full' : 'Review'}</span></button>
    ${engineHas(tb.provider,'planMode')?`<button class="chip ${tb.prefs.executionMode==='plan'?'set':''}" id="c-mode">${tb.prefs.executionMode==='plan'?'Plan first':'Work normally'}</button>`:''}
    ${tb.allowMute ? `<button class="chip ${chatMuted ? 'set' : ''}" id="c-mute" aria-label="Toggle notifications for this conversation">${chatMuted ? IC.bellOff : IC.bell}${chatMuted ? 'Muted' : 'Alerts'}</button>` : ''}${Voice.muteButtonHTML('chip')}${tb.allowMute ? '<button class="chip conversation-side" id="side-open" hidden>Side chat</button><button class="chip conversation-branch" id="branch-open" hidden>Branch</button><button class="chip conversation-project" id="project-open" hidden>Project</button><button class="chip conversation-task" id="task-open" hidden>Add task</button>' : ''}`;
  const ar = $('#attrow');
  if (ar) {
    ar.innerHTML = tb.attachments.map((a, i) => `
      <span class="afile">${isImg(a.path)
        ? `<img class="athumb" src="/api/file?path=${encodeURIComponent(a.path)}" alt="">` : IC.clip}<span class="n">${esc(a.name)}</span>
        <button data-i="${i}" aria-label="Remove ${esc(a.name)}">${IC.x}</button></span>`).join('');
    ar.querySelectorAll('button').forEach(b => b.onclick = () => { tb.attachments.splice(Number(b.dataset.i), 1); stashAttachments(); renderToolbar(); });
  }
  const att = $('#c-att');
  const actions=$('#composer-actions');
  if(att&&actions){att.className='icon composer-attach';att.innerHTML=IC.clip;actions.prepend(att);}
  if (att) att.onclick = () => sheet('Attach a file or screenshot',[['file','Choose files','Select from this device'],['paste','Paste screenshot','Use an image from your clipboard'],
    ...(vaultOn() ? [['vault','Store in the Vault','Save a key or password here instead of pasting it into the message']] : [])],null,v=>{if(v==='file')$('#fpick')?.click();else if(v==='vault')addVaultItemFromComposer();else pasteClipboardImage();}); // 1.39: the Vault option
  $('#c-model').onclick = () => sheet('Model for this reply', modelList(), tb.prefs.model,
    v => { tb.prefs.model = v; setPrefs(tb.key, tb.prefs); renderToolbar(); }, { search: modelList().length > 12 ? 'models' : '' });
  const eff = $('#c-eff'); // absent for an OpenRouter model that takes no reasoning-effort setting
  if (eff) eff.onclick = () => sheet('Reasoning effort', effortList(), tb.prefs.effort,
    v => { tb.prefs.effort = v; setPrefs(tb.key, tb.prefs); renderToolbar(); });
  if (loadOutbox(tb.key)) {
    bar.querySelectorAll('button:not(#c-mute):not([data-voice-mute]):not(#project-open):not(#task-open):not(#side-open):not(#branch-open)').forEach(b => { b.disabled = true; });
    if(att)att.disabled=true;
    ar?.querySelectorAll('button').forEach(b => { b.disabled = true; });
  }
  const mode=$('#c-mode');if(mode)mode.onclick=()=>sheet((ENGINE_LABELS[tb.provider]||'Codex')+' mode for the next reply',[['work','Work normally','Carry out your request'],['plan','Plan first','Explore an approach and answer native questions before implementation']],tb.prefs.executionMode||'work',v=>{tb.prefs.executionMode=v;setPrefs(tb.key,tb.prefs);renderToolbar();});
  $('#c-approval').onclick=()=>chooseApprovalMode();
  paintComposerDensity();
  paintUploadStatus();
  const mu = $('#c-mute');
  if (mu) mu.onclick = () => toggleMute();
  Voice.paint();                                              // the voice-mute chip reads its state from Voice
  if (typeof paintChatProject === 'function') paintChatProject(); // 1.35: Add project sits with the session's chips, not in a header row
  if (typeof paintChatTask === 'function') paintChatTask(); // 1.36: Add task beside it
  SideChat.paintButton(); // 1.78.2: Side chat beside them on a desktop
  bindToolbarScroll(bar);
  updateNewSummary();
  if(focusedControl)document.getElementById(focusedControl)?.focus({preventScroll:true});
}
/* ---------- session options: pin + rename (overlay metadata, server-side) ---------- */
// 1.19: Session options are grouped (conversation, session, process, display) with hairlines between groups.
function optGroup(label, items) { const body = items.filter(Boolean).join(''); return body ? `<div class="opt-group" role="group" aria-label="${label}">${body}</div>` : ''; }
function sessionSheet(s, refresh) { // s: {id, title, pinned}
  if (document.querySelector('.scrim')) return; // one sheet at a time
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet';
  sh.innerHTML = `
    <h2>Conversation options</h2>
    <p class="sheet-name">${esc(s.title)}</p>
    <button class="opt" id="so-pin">${IC.pin}<span>${s.pinned ? 'Unpin conversation' : 'Pin conversation'}<span class="sub">${s.pinned ? 'Back to its place by recency' : 'Keep it at the top of the list'}</span></span></button>
    ${s.id!==chatId&&canMarkReviewed(allSessions.find(r=>r.id===s.id)||s)?'<button class="opt" id="so-reviewed">'+IC.tick+'<span>Mark as reviewed<span class="sub">Clear '+(s.state?.kind==='failed'?'the failed reply':'Response ready')+' on all your devices without opening it</span></span></button>':''}
    ${optGroup('This conversation', [
      s.id===chatId?'<button class="opt" id="so-find">'+IC.search+'<span>Find in conversation</span></button><button class="opt" id="so-changes">'+IC.diff+'<span>Changed files</span></button>':'',
      !PANE && chatId && s.id !== chatId && isWide() ? '<button class="opt" id="so-beside">'+IC.columns+'<span>Open beside<span class="sub">Show it next to the current conversation</span></span></button>' : '',
      s.id===chatId&&SideChat.available(s.id)?'<button class="opt" id="so-side">'+IC.chat+'<span>Side chat<span class="sub">'+SIDE_WHAT+'</span></span></button><button class="opt" id="so-branch">'+IC.branch+'<span>Branch<span class="sub">'+BRANCH_WHAT+'</span></span></button>':'',
      `<button class="opt" id="so-agents">${IC.columns}<span>Subagents<span class="sub">What each one is doing, and work in the background</span></span></button>`,
      s.id===chatId?'<button class="opt" id="so-usage">'+IC.gauge+'<span>Plan usage<span class="sub">5-hour and weekly limits, extra-usage status</span></span></button>':''])}
    ${optGroup('Organize', [
      s.pinned && pinnedIds().indexOf(s.id) > 0 ? '<button class="opt" id="so-pin-up">'+IC.up+'<span>Move pin up<span class="sub">Earlier among pinned conversations, in the list and the tabs, on every device</span></span></button>' : '',
      s.pinned && pinnedIds().indexOf(s.id) >= 0 && pinnedIds().indexOf(s.id) < pinnedIds().length - 1 ? '<button class="opt" id="so-pin-down">'+IC.down+'<span>Move pin down<span class="sub">Later among pinned conversations, in the list and the tabs, on every device</span></span></button>' : '',
      `<button class="opt" id="so-ren">${IC.pen}<span>Rename<span class="sub">Your title, on every device. Clear it to go back to the automatic one</span></span></button>`,
      `<button class="opt" id="so-hide">${IC.folder}<span>${isHiddenSession(allSessions.find(r=>r.id===s.id)||s)?'Restore to conversation list':'Hide from this device'}<span class="sub">History stays intact. New activity brings it back.</span></span></button>`,
      `<button class="opt" id="so-permissions">${IC.sliders}<span>Permissions for the next reply<span class="sub">${permissionLabel(nextApprovalMode(getPrefs(s.id)))}. Running work keeps its current permissions.</span></span></button>`,
      projectsOn() ? '<button class="opt" id="so-project">'+IC.folder+'<span>Add project<span class="sub">Track a new project around this conversation, or link it to one</span></span></button>' : '',
      tasksOn() ? '<button class="opt" id="so-task">'+IC.task+'<span>Add task<span class="sub">A to-do with an optional date, kept with this conversation and its context</span></span></button>' : '',
      vaultOn() ? '<button class="opt" id="so-vault">'+VIC.lock+'<span>Store in the Vault<span class="sub">Save a key or password agents use by name, instead of pasting it here</span></span></button>' : ''])}
    ${optGroup('Server process', [!PANE && s.id === chatId ? '<button class="opt" id="so-close">'+IC.x+'<span>Close conversation process<span class="sub">Release its server process. If work is running, choose whether to keep it running or stop it</span></span></button>' : ''])}
    ${optGroup('Display and version', [chatTextControlsHTML(), s.id===chatId?'<button class="opt" id="so-version">'+IC.info+'<span>Version & updates<span class="sub" id="so-version-sub">'+esc(appVersionLabel())+'</span></span></button>':''])}`;
  const close = () => closeCurrentSheet?.();
  scrim.onclick = close;
  sh.querySelector('#so-pin').onclick = () => { close(); togglePin(s, refresh); };
  sh.querySelector('#so-pin-up')?.addEventListener('click',()=>{close();movePin(s.id,-1);});
  sh.querySelector('#so-pin-down')?.addEventListener('click',()=>{close();movePin(s.id,1);});
  sh.querySelector('#so-hide').onclick=()=>{const row=allSessions.find(r=>r.id===s.id)||s;if(['running','background','observed','waiting','input'].includes(rowState(row).kind))return toast('Active or waiting conversations stay visible.');if(hiddenSessions[s.id])delete hiddenSessions[s.id];else hiddenSessions[s.id]=Math.max(row.mtimeMs||0,row.state?.at||0,Date.now());writeLocal('pc-hidden-sessions',hiddenSessions);close();paintSessionPanels();};
  sh.querySelector('#so-ren').onclick = () => { close(); renameSheet(s, refresh); };
  sh.querySelector('#so-project')?.addEventListener('click',()=>{close();addSessionToProject(allSessions.find(r=>r.id===s.id)||s);});
  sh.querySelector('#so-task')?.addEventListener('click',()=>{close();addTaskFromSession(allSessions.find(r=>r.id===s.id)||s);});
  sh.querySelector('#so-vault')?.addEventListener('click',()=>{close();addVaultItemFromComposer({insert:s.id===chatId});}); // 1.39: the name goes into this conversation's message box
  sh.querySelector('#so-reviewed')?.addEventListener('click',()=>{close();markReviewed([allSessions.find(r=>r.id===s.id)||s]);paintSessionPanels();toast('Marked as reviewed');});
  bindChatTextControls(sh);
  sh.querySelector('#so-find')?.addEventListener('click',()=>{close();findOpen(true);});
  sh.querySelector('#so-changes')?.addEventListener('click',()=>{close();openChanges();});
  sh.querySelector('#so-beside')?.addEventListener('click',()=>{close();openBeside(s.id);});
  sh.querySelector('#so-close')?.addEventListener('click',()=>{close();closeMainPane();});
  sh.querySelector('#so-agents').onclick=()=>openAgentsPanel(s.id);
  sh.querySelector('#so-side')?.addEventListener('click',()=>{close();SideChat.open(s.id);});
  sh.querySelector('#so-branch')?.addEventListener('click',()=>{close();Branch.open(s.id);});
  sh.querySelector('#so-permissions').onclick=()=>{close();chooseApprovalMode(s.id);};
  sh.querySelector('#so-usage')?.addEventListener('click',openUsagePanel);
  sh.querySelector('#so-version')?.addEventListener('click',()=>settingsSheet({about:true}));
  if (sh.querySelector('#so-version')) loadAppRelease().then(()=>{const sub=sh.querySelector('#so-version-sub');if(sub)sub.textContent=appVersionLabel();});
  mountSheet(scrim, sh);
}
function renameSheet(s, refresh) {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet';
  sh.innerHTML = `
    <h2>Rename conversation</h2>
    <input type="text" class="rename" id="rn" maxlength="120" placeholder="Conversation title" enterkeyhint="done" autocomplete="off">
    <button class="primary" id="rn-save">Save</button>`;
  const close = () => closeCurrentSheet?.();
  scrim.onclick = close;
  const box = sh.querySelector('#rn');
  box.value = s.title === '(untitled conversation)' || s.title === '(untitled session)' ? '' : s.title;
  const save = async () => {
    close();
    try {
      const r = await api(`/session/${s.id}/rename`, { method: 'POST', body: JSON.stringify({ name: box.value }) });
      toast(r.name ? 'Renamed' : 'Back to the automatic title');
      refresh?.(r);
    } catch (e) { toast('Rename failed: ' + e.message); }
  };
  sh.querySelector('#rn-save').onclick = save;
  box.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } };
  mountSheet(scrim, sh);
  box.focus(); box.select();
}
// long-press (touch) or right-click (desktop) opens the options sheet for a row
function wireRowMenu(el, getS, refresh) {
  let t = null, sx = 0, sy = 0, held = false;
  el.addEventListener('contextmenu', e => { e.preventDefault(); held = true; sessionSheet(getS(), refresh); });
  el.addEventListener('touchstart', e => {
    held = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    t = setTimeout(() => { held = true; sessionSheet(getS(), refresh); }, 500);
  }, { passive: true });
  el.addEventListener('touchmove', e => { // scrolling, not holding
    if (Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 12) clearTimeout(t);
  }, { passive: true });
  el.addEventListener('touchend', () => clearTimeout(t));
  el.addEventListener('touchcancel', () => clearTimeout(t));
  el.addEventListener('click', e => { // swallow the tap that ended the long-press
    if (held) { e.preventDefault(); e.stopImmediatePropagation(); held = false; }
  }, true);
}

/* per-session push mute — server-side, so it silences every device */
let chatMuted = false;
async function toggleMute() {
  try {
    const r = await api(`/session/${chatId}/mute`, { method: 'POST', body: JSON.stringify({ muted: !chatMuted }) });
    chatMuted = r.muted;
    toast(chatMuted ? 'Notifications muted for this conversation' : 'Notifications back on for this conversation');
    renderToolbar();
    const wb = $('#muteb'); if (wb) { wb.innerHTML = chatMuted ? IC.bellOff : IC.bell; wb.classList.toggle('on', chatMuted); }
  } catch (e) { toast('Mute failed: ' + e.message); }
}
const uploadsInFlight = new Map();
function attachmentTarget() {
  if (!tb?.allowAttach || loadOutbox(tb.key)) { toast('Finish or discard the pending message before attaching files.'); return null; }
  if (tb.key !== NEW_KEY && composerWorking) { toast('Attach files after this reply finishes.'); return null; }
  return tb.key;
}
function paintUploadStatus() {
  const row = $('#attrow'); if (!row || !tb) return;
  row.querySelector('.upload-status')?.remove();
  const n = uploadsInFlight.get(tb.key) || 0;
  if (n) { const note=document.createElement('span');note.className='upload-status';note.role='status';note.textContent='Uploading '+n+' file'+(n===1?'':'s')+'…';row.append(note); }
}
async function uploadFiles(fileList, target = attachmentTarget()) {
  if (!target || !fileList.length) return;
  uploadsInFlight.set(target,(uploadsInFlight.get(target)||0)+fileList.length);paintUploadStatus();
  for (const f of fileList) {
    try {
      if (f.size > 30 * 1024 * 1024) throw new Error(`${f.name} is over 30 MB`);
      const r = await fetch('/api/upload', { method: 'POST', headers: { 'x-filename': f.name, 'content-type': 'application/octet-stream' }, body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      // Uploads belong to the initiating session, even if navigation happens meanwhile.
      const files=loadAttachments(target);files.push({path:j.path,name:j.name});
      localStorage.setItem('pc-attachments-'+target,JSON.stringify(files));
      if(tb?.key===target)tb.attachments=files;
    } catch (e) { toast('Upload failed: ' + e.message); }
    finally { const n=(uploadsInFlight.get(target)||1)-1;if(n)uploadsInFlight.set(target,n);else uploadsInFlight.delete(target); }
  }
  if(tb?.key===target){renderToolbar();paintUploadStatus();}
}
function clipboardFile(blob, index=0) {
  // 1.89: any other image type keeps its own extension (heic, avif, bmp…), so the agent is not handed HEIC bytes named .png;
  // png only when the browser names no type
  const ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/tiff':'tif','image/svg+xml':'svg','image/x-ms-bmp':'bmp','image/x-icon':'ico','image/vnd.microsoft.icon':'ico'})[blob.type]
    ||(/^image\/([\w.+-]+)$/.exec(blob.type||'')?.[1]||'').replace(/^x-/,'').replace(/\+.*/,'').replace(/\W/g,'')||'png';
  return new File([blob],`screenshot-${Date.now()}-${index}.${ext}`,{type:blob.type});
}
async function pasteClipboardImage() {
  const target=attachmentTarget();if(!target)return;
  if(!navigator.clipboard?.read){toast('This browser cannot read clipboard images. Try pasting into the message box or choose a file.');return;}
  uploadsInFlight.set(target,(uploadsInFlight.get(target)||0)+1);paintUploadStatus();
  try {
    const items=await navigator.clipboard.read(),files=[];
    for(const item of items){const type=item.types.find(t=>t.startsWith('image/'));if(type)files.push(clipboardFile(await item.getType(type),files.length));}
    if(!files.length){toast('No image on the clipboard. Copy a screenshot first.');return;}
    await uploadFiles(files,target);
  } catch {toast('Clipboard access was not available. Try pasting into the message box or choose a file.');}
  finally{const n=(uploadsInFlight.get(target)||1)-1;if(n)uploadsInFlight.set(target,n);else uploadsInFlight.delete(target);paintUploadStatus();}
}
document.addEventListener('paste',event=>{
  if(!event.target.matches?.('#box,#first,.queue-editor'))return;
  const files=[...(event.clipboardData?.items||[])].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);
  // 1.42: text that looks like a secret is held and the Vault offered; other text keeps the browser's normal paste.
  if(!files.length){secretGuardInput(event,event.clipboardData?.getData('text/plain')||'');return;}
  if(!event.target.matches('#box,#first'))return;
  event.preventDefault();const target=attachmentTarget();if(target)uploadFiles(files.map(clipboardFile),target);
});

function turnOpts() {
  if (!tb) return {};
  normalizeModelPick();
  return {
    approvalMode:nextApprovalMode(),
    executionMode:engineHas(tb.provider,'planMode')&&tb.prefs.executionMode==='plan'?'plan':'work',
    model: tb.prefs.model !== 'default' ? tb.prefs.model : undefined,
    effort: tb.prefs.effort !== 'default' ? tb.prefs.effort : undefined,
    attachments: tb.attachments.length ? tb.attachments.map(a => a.path) : undefined,
  };
}
function toolIcon(name) {
  if (/^(Bash|Skill)/.test(name)) return IC.term;
  if (/^(Read|Write|Edit|Notebook)/.test(name)) return IC.doc;
  if (/^(WebFetch|WebSearch)/.test(name)) return IC.globe;
  return IC.cog;
}

/* ---------- tiny helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 1.75.4: the question and approval banners are something to do, not a notice: --warn (Pocket's "waiting on you"),
// what is waiting, whether the reply is paused, and an Answer/Review button. The whole banner opens the sheet.
// 1.82: one waiting item answers from the banner itself: `actions` are buttons (Allow / Don't allow, or a question's
// options) beside the cta, which opens the sheet as before. `agent` names the subagent that asked. The banner is a
// group now, not one button: a click anywhere outside the buttons still opens the sheet.
function paintWaitBanner(b,{title,note='',mono=false,agent='',cta,mark=IC.ask,actions=[]}){
  if(!b)return;
  b.innerHTML=`<span class="wb-mark">${mark}</span><span class="wb-text"><span class="wb-title">${esc(title)}</span>${agent?`<span class="wb-agent">From subagent: ${esc(agent)}</span>`:''}${note?`<span class="wb-note${mono?' mono':''}">${esc(note)}</span>`:''}</span><span class="wb-actions">${actions.map((a,i)=>`<button type="button" class="wb-act${a.primary?' wb-allow':''}" data-act="${i}"${a.title?` title="${esc(a.title)}"`:''}>${esc(a.label)}</button>`).join('')}<button type="button" class="wb-cta">${esc(cta)}${IC.fwd1}</button></span>`;
  b.setAttribute('role','group');b.setAttribute('aria-label',title);
  b.querySelectorAll('[data-act]').forEach(button=>button.onclick=e=>{e.stopPropagation();actions[Number(button.dataset.act)]?.run?.(button);});
}
// The banner's buttons go quiet while a decision travels; the next refresh paints the banner again.
function waitBannerBusy(b,note){
  if(!b)return;
  b.querySelectorAll('button').forEach(x=>x.disabled=true);
  const n=b.querySelector('.wb-note');if(n&&note){n.textContent=note;n.classList.remove('mono');}
}
// code block with its own copy affordance — selecting text on a touchscreen is miserable
const codeHTML = t => `<div class="codewrap"><button class="copybtn" data-copy aria-label="Copy code">${IC.copy}</button><pre><code>${esc(t)}</code></pre></div>`;
function md(src) { return PocketFormat.render(src, chatId); }

function rel(ms) {
  const d = Date.now() - ms;
  if (d < 90e3) return 'just now';
  if (d < 3600e3) return `${Math.round(d / 60e3)}m ago`;
  if (d < 86400e3) return `${Math.round(d / 3600e3)}h ago`;
  if (d < 7 * 86400e3) return `${Math.round(d / 86400e3)}d ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
// home dir = /home/<user>, /Users/<user> or /root; shown as ~
const HOME_RE = /^\/(?:home\/[^/]+|Users\/[^/]+|root)(?=\/|$)/;
const projShort = cwd => !cwd ? '' : cwd.replace(HOME_RE, '~');
// list rows + chat tag show just the project folder name — the full path is noise there
// (search still matches the full path; the New screen still shows full paths)
const projName = cwd => !cwd ? '' : projShort(cwd) === '~' ? '~' : (cwd.split('/').pop() || cwd);
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200);
}
// Stale-build notice: an open window keeps running the build it loaded, even after the server updates and
// the service worker swaps the cache. Ask the server once a minute and when the app returns to the
// foreground; if its build is newer and nothing is mid-send, offer a reload.
let staleBannerShown = false;
async function checkStaleBuild() {
  if (!APP_V || staleBannerShown || document.visibilityState !== 'visible' || document.querySelector('.login')) return;
  try {
    const r = await fetch('/api/about', { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (!r.ok) return;                                   // /api/about reports the build the running server started with
    const j = await r.json(); const v = Number(j?.assetV) || 0;
    if (v > APP_V && sendsInFlight.size === 0) {
      staleBannerShown = true;
      const b = document.createElement('button'); b.className = 'stale-banner'; b.type = 'button';
      b.innerHTML = `New Pocket Code build ${v} is on the server (you are on ${APP_V}). Tap to reload.`;
      b.onclick = () => location.reload();
      document.body.append(b);
    }
  } catch { }
}
setInterval(checkStaleBuild, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(checkStaleBuild, 1500); });
setTimeout(checkStaleBuild, 4000);
async function api(path, opts) {
  const r = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts });
  if (r.status === 401) { renderLogin(); throw new Error('login'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status, code: j.code, body: j });
  return j;
}

function renderUnreachable(e) {
  app.innerHTML = `<div class="login" data-offline><h1>Pocket Code</h1><p class="sub">${navigator.onLine === false ? 'You’re offline.' : 'The server didn’t answer' + (e?.status ? ' (' + esc(String(e.status)) + ')' : '') + '.'} Your drafts are kept.</p><button class="chip" id="retry-route">Try again</button></div>`;
  $('#retry-route').onclick = () => route();
  clearTimeout(renderUnreachable.timer);
  renderUnreachable.timer = setTimeout(() => { if (document.querySelector('[data-offline]')) route(); }, 10000);
}
/* ---------- login ---------- */
function renderLogin() {
  app.innerHTML = `
    <div class="login">
      <h1>${appName()}</h1>
      <p class="sub">${assistantMode() ? 'Sign in to pick up where you left off.' : 'Your Claude Code and Codex conversations, from anywhere.'}</p>
      <input type="password" id="pw" placeholder="Password" autocomplete="current-password" enterkeyhint="go">
      <p class="err" id="lerr"></p>
      <button class="primary" id="go">Unlock</button>
    </div>`;
  const go = async () => {
    try {
      await api('/login', { method: 'POST', body: JSON.stringify({ password: $('#pw').value }) });
      route();
    } catch (e) { $('#lerr').textContent = e.status === 429 ? 'Too many attempts — wait an hour.' : 'Wrong password.'; }
  };
  $('#go').onclick = go;
  $('#pw').onkeydown = e => { if (e.key === 'Enter') go(); };
  $('#pw').focus();
}

/* ---------- push notifications ---------- */
const urlB64 = s => {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
};
// A failed registration must never hold the rest of the interface hostage.
async function pushRegistration() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  let timer;
  try {
    return await Promise.race([navigator.serviceWorker.ready, new Promise(resolve => { timer = setTimeout(() => resolve(null), 1500); })]);
  } catch { return null; }
  finally { clearTimeout(timer); }
}
async function pushState() {
  try { const reg = await pushRegistration(); return reg ? await reg.pushManager.getSubscription() : null; }
  catch { return null; }
}
async function togglePush(btn) {
  if (btn) btn.disabled = true;
  try {
    const reg = await pushRegistration();
    if (!reg) { toast('Notifications unavailable. Reload the app and try again.'); return; }
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
      toast('Notifications off for this device');
    } else {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return toast('Notifications blocked. Allow notifications in this site’s browser settings.');
      const { key } = await api('/push/key');
      if (!key) return toast('Push not configured on server');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) });
      // 1.50: this device's choices travel with the subscription: every kind on, the icon count as set here.
      await api('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON(), prefs: { kinds: { turns: true, reminders: true, vault: true, alerts: true }, badge: typeof iconBadgeOn === 'function' ? iconBadgeOn() : true } }) });
      toast('This device will get notifications');
    }
    const now = await pushState();
    if (btn?.id === 'bell') { btn.innerHTML = now ? IC.bell : IC.bellOff; btn.classList.toggle('on', Boolean(now)); }
  } catch (e) { toast('Notification setup failed: ' + e.message); }
  finally { if (btn) btn.disabled = false; }
}

/* ---------- settings sheet (version, update check, chime, notifications) ---------- */
// This browser's release metadata (semantic version + notes), fetched once and only
// trusted when it matches the loaded asset build.
let appRelease = null, appReleaseLoad = null;
const loadAppRelease = () => appReleaseLoad ??= fetch('/release.json?v=' + APP_V, {signal:AbortSignal.timeout(8000)})
  .then(r => r.ok ? r.json() : null).then(r => { if (r?.assetV === APP_V) appRelease = r; return appRelease; })
  .catch(() => { appReleaseLoad = null; return null; });
const appVersionLabel = () => `Pocket Code ${appRelease?.version ? appRelease.version + ' · ' : ''}build ${APP_V ?? '?'}`;
const REPO_URL = 'https://github.com/bbesner/pocket-code';
// GitHub issue forms accept field ids as query parameters; `version` prefills the form's version field.
const issueUrl = (template, version) => `${REPO_URL}/issues/new?template=${template}.yml&version=${encodeURIComponent(version || ('build ' + (APP_V ?? '?')))}`;
const APP_V = Number((document.querySelector('script[src*="app.js"]')?.src.match(/v=(\d+)/) || [])[1]) || null;
async function hardRefresh() {
  try {
    if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch { }
  location.reload();
}
// 1.68.1: Settings → Appearance → Mode. Two options, the current one pressed, so the view you are in is always visible
// (1.60's single Assistant mode switch read as "on/off" with nothing saying what off was). This instance, every device.
function modeControlsHTML() {
  const on = assistantMode(), locked = Boolean(window.pocketFeatures?.assistantLocked);
  const opt = (key, label) => `<button data-pocket-mode="${key}" aria-pressed="${(key === 'assistant') === on}"${locked ? ' aria-disabled="true"' : ''}>${label}</button>`;
  const help = locked
    ? 'Assistant mode is kept on by this server (POCKET_ASSISTANT_MODE=locked). Change it there to allow Developer mode.'
    : 'Developer mode is the full workbench. Assistant mode opens on the message box, in plain words, with the developer controls out of sight.';
  return `<section class="mode-settings" id="s-mode" aria-label="Mode">
  <p class="chat-text-label">Mode</p>
  <div class="chat-text-controls mode-controls" role="group" aria-label="Choose Developer mode or Assistant mode">${opt('developer', 'Developer mode')}${opt('assistant', 'Assistant mode')}</div>
  <p class="chat-text-help">${help}</p>
 </section>`;
}
// 1.81 (#175): Settings → Features in Assistant mode. A locked Pocket cannot change them, so it gets a line saying what is on.
function featuresLockedNote(f) {
  const all = [['Projects', f.projects], ['Files', f.documents], ['Tasks', f.tasks], ['Inbox Watch', f.inbox], ['Vault', f.vault]];
  const say = (names, state) => !names.length ? '' : (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.at(-1) + ' are ' : names[0] + ' is ') + (names.length === all.length ? 'all ' : '') + state + '.';
  return [say(all.filter(x => x[1]).map(x => x[0]), 'on'), say(all.filter(x => !x[1]).map(x => x[0]), 'off'), 'To change them, ask the person who runs this install.'].filter(Boolean).join(' ');
}
async function settingsSheet({about = false, category = '', scrollTop = 0} = {}) {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet settings-sheet';
  const chimeOn = localStorage.getItem('pc-chime') !== 'off';
  let srv = null;
  sh.innerHTML = `
    <h2>Settings</h2>
    ${themeControlsHTML()}
    ${chatTextControlsHTML()}
    ${accentControlsHTML()}
    ${modeControlsHTML()}
    <button class="opt" id="s-environment">${IC.model}<span>Accounts & instance<span class="sub">Provider sign-ins and supported controls</span></span></button>
    <button class="opt" id="s-connectors">${IC.globe}<span>Connectors<span class="sub">Gmail, Calendar and Drive for each agent</span></span></button>
    <button class="opt" id="s-usage">${IC.gauge}<span>Plan usage<span class="sub">5-hour and weekly limits, extra-usage status</span></span></button>
    <div class="title-settings model-offer" id="s-models" role="group" aria-labelledby="s-models-h">
      <p class="vault-set-head" id="s-models-h">Claude models in the picker</p>
      <div class="model-offer-list" id="s-models-list" aria-busy="true">${CLAUDE_CATALOG.map(([id, label, sub]) => `<button class="opt" data-offer-model="${esc(id)}" aria-pressed="false" aria-disabled="true"><span class="dot"></span><span>${esc(label)}<span class="sub">${esc(sub)}</span></span></button>`).join('')}</div>
      <p class="title-note" id="s-models-note" role="status">Loading the model list…</p>
      <span class="vault-set-actions"><button class="chip" id="s-models-reset" hidden>Use the server's list</button></span></div>
    <div class="title-settings model-offer" id="s-context" role="group" aria-labelledby="s-context-h" aria-describedby="s-context-lead">
      <p class="vault-set-head" id="s-context-h">Context and subagents</p>
      <p class="title-note" id="s-context-lead">Each reply reads the whole conversation again, so long conversations use the most of your plan. Compacting summarizes the older part. Subagents can run on a cheaper model than the conversation.</p>
      <label class="voice-field">Compact conversations<select id="s-context-limit" disabled><option value="agent">When the agent decides</option></select></label>
      <label class="voice-field">Subagent model<select id="s-context-workers" disabled><option value="default">The agent’s own choice</option><option value="tier-down">One tier below the conversation’s model</option></select></label>
      <label class="voice-field">Subagent effort<select id="s-context-effort" disabled><option value="">The agent’s own choice</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      <p class="title-note" id="s-context-note" role="status">Loading the context setting…</p></div>
    <div class="title-settings model-offer trusted-actions" id="s-trusted" role="group" aria-labelledby="s-trusted-h" aria-describedby="s-trusted-lead">
      <p class="vault-set-head" id="s-trusted-h">Actions that run without asking</p>
      <p class="title-note" id="s-trusted-lead">In Review actions, Claude Code, Codex and OpenRouter run the read-only actions listed here without an approval card. Everything else still asks.</p>
      <ul class="trusted-list" id="s-trusted-list" aria-labelledby="s-trusted-h" aria-busy="true"></ul>
      <form class="trusted-add" id="s-trusted-form" novalidate>
        <label class="trusted-label" for="s-trusted-input">Add an action</label>
        <span class="trusted-add-row"><input id="s-trusted-input" type="text" maxlength="300" placeholder="Bash(command:*)" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="s-trusted-error s-trusted-hint" disabled><button class="chip" type="submit" id="s-trusted-add" disabled>Add</button></span>
        <p class="vault-field-error" id="s-trusted-error" role="alert"></p>
        <p class="title-note" id="s-trusted-hint">Bash(command:*), Bash(exact command), mcp__server__tool, mcp__server__* or WebSearch. A listed command runs with any arguments, so list only ones that cannot change anything. Edit and Write always ask; Codex is not covered.</p>
      </form>
      <p class="title-note" id="s-trusted-note" role="status">Loading the list…</p>
      <span class="vault-set-actions"><button class="chip" id="s-trusted-reset" hidden>Use the server's list</button></span></div>
    <div class="title-settings model-offer router-settings" id="s-router" role="group" aria-labelledby="s-router-h" aria-describedby="s-router-lead">
      <p class="vault-set-head" id="s-router-h">Automatic model choice</p>
      <p class="title-note" id="s-router-lead">In Assistant mode, a request typed from scratch goes to a small decision model that picks the lightest of four levels that will do it well. Each level runs the model and effort below. Saved prompts keep their own.</p>
      <button class="opt" id="s-router-on" disabled aria-pressed="false"><span class="dot"></span><span>Choose the model for me<span class="sub" id="s-router-state">Loading…</span></span></button>
      <label class="voice-field">Decision model<select id="s-router-provider" disabled><option value="jev">TypeSafe Jev, through OpenRouter</option><option value="openai">OpenAI Decisions API (GPT-6 Luna)</option></select></label>
      <form class="trusted-add" id="s-router-key-form" novalidate>
        <label class="trusted-label" for="s-router-key">Key</label>
        <span class="trusted-add-row"><input id="s-router-key" type="password" maxlength="400" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste a key" disabled><button class="chip" type="submit" id="s-router-key-save" disabled>Save key</button><button class="chip" type="button" id="s-router-key-remove" hidden>Remove</button></span>
        <p class="title-note" id="s-router-key-note"></p>
      </form>
      <div class="router-levels" id="s-router-levels" aria-busy="true"></div>
      <p class="title-note" id="s-router-note" role="status"></p>
      <span class="vault-set-actions"><button class="chip" id="s-router-reset" hidden>Use the server's settings</button></span></div>
    <div class="title-settings model-offer access-settings" id="s-access" role="group" aria-labelledby="s-access-h" aria-describedby="s-access-lead">
      <p class="vault-set-head" id="s-access-h">One sign-in</p>
      <p class="title-note" id="s-access-lead">Behind Cloudflare Access, Pocket can accept the Access sign-in instead of asking for its own password as well. It checks Cloudflare's signature, this application and the email, and signs the browser in for a day at most.</p>
      <p class="title-note" id="s-access-state" role="status">Loading…</p>
      <form class="access-form" id="s-access-form" novalidate>
        <label class="voice-field">Team<input id="s-access-team" type="text" maxlength="63" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="the part before .cloudflareaccess.com" disabled></label>
        <label class="voice-field">Audience tag<input id="s-access-aud" type="text" maxlength="128" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="from the Access application's Overview" disabled></label>
        <label class="voice-field">Who may sign in this way<input id="s-access-emails" type="text" maxlength="2000" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="you@example.com, …" disabled></label>
        <p class="vault-field-error" id="s-access-error" role="alert"></p>
        <span class="vault-set-actions"><button class="chip" type="submit" id="s-access-save" disabled>Save</button><button class="chip" type="button" id="s-access-off" hidden>Turn off</button><button class="chip" type="button" id="s-access-reset" hidden>Use the server's values</button></span>
      </form></div>
    <button class="opt" id="s-keys">${IC.term}<span>Keyboard & workspace<span class="sub">Shortcuts and open-conversation tabs</span></span></button>
    <button class="opt" id="s-chime" aria-pressed="${chimeOn}"><span class="dot ${chimeOn ? 'on' : ''}"></span><span>Completion chime<span class="sub">Two-note blip when a reply finishes on screen</span></span></button>
    <button class="opt" id="s-tools" aria-pressed="${toolsCollapsed()}"><span class="dot ${toolsCollapsed() ? 'on' : ''}"></span><span>Collapse steps<span class="sub">Fold each run of steps behind a one-line summary</span></span></button>
    <button class="opt" id="s-plain" aria-pressed="${plainSteps()}"><span class="dot ${plainSteps() ? 'on' : ''}"></span><span>Describe steps in plain words<span class="sub">“Saved Proposal.pdf” with the command or path beside it. Off shows the tool name and its raw detail</span></span></button>
    <button class="opt" id="s-times" aria-pressed="${showTimes()}"><span class="dot ${showTimes() ? 'on' : ''}"></span><span>Show message times<span class="sub">A time on each message and a divider for each day</span></span></button>
    <button class="opt" id="s-push" aria-pressed="false"><span class="dot"></span><span>Push to this device<span class="sub" id="s-push-state">Checking notification support…</span></span></button>
    <div class="title-settings push-kinds" id="s-push-kinds" role="group" aria-label="Which notifications this device gets">
      <button class="opt" id="s-push-turns" disabled aria-pressed="false"><span class="dot"></span><span>Finished replies<span class="sub">When a conversation finishes a reply, unless it is muted</span></span></button>
      <button class="opt" id="s-push-reminders" disabled aria-pressed="false"><span class="dot"></span><span>Due tasks and reminders<span class="sub">Once when each comes due. Tomorrow and Done on the notification answer without opening Pocket</span></span></button>
      <button class="opt" id="s-push-vault" disabled aria-pressed="false"><span class="dot"></span><span>Vault requests<span class="sub">When an agent needs a secret you have to allow</span></span></button>
      <button class="opt" id="s-push-alerts" disabled aria-pressed="false"><span class="dot"></span><span>Inbox alerts<span class="sub">An alert from Inbox Watch or another job on the server; urgent, like a due reminder</span></span></button>
    </div>
    <button class="opt" id="s-badge" aria-pressed="false"><span class="dot"></span><span>Count on the app icon<span class="sub" id="s-badge-state">How many tasks and reminders are due, on the installed app's icon</span></span></button>
    <button class="opt" id="s-ahead" disabled aria-pressed="false"><span class="dot"></span><span>Notice a day before<span class="sub" id="s-ahead-state">Loading the reminder setting…</span></span></button>
    <div class="title-settings" id="s-email-wrap"><form class="email-form" id="s-email-form"><label class="voice-field">Email due tasks and reminders to<input type="email" name="to" id="s-email" placeholder="you@example.com" maxlength="200" autocomplete="email" disabled></label>
      <span class="vault-set-actions"><button class="chip" type="submit" id="s-email-save" disabled>Save</button><button class="chip" type="button" id="s-email-test" disabled>Send a test</button></span>
      <p class="title-note" id="s-email-note" role="status">Loading the email setting…</p></form></div>
    <button class="opt" id="s-sync" disabled aria-pressed="false"><span class="dot"></span><span>Sync names with code-server<span class="sub" id="s-sync-state">Loading name-sync setting…</span></span></button>
    <button class="chip" id="s-sync-retry" hidden>Retry name-sync setting</button>
    <button class="opt" id="s-titles" disabled aria-pressed="false"><span class="dot"></span><span>Generate short titles<span class="sub" id="s-titles-state">Loading the title setting…</span></span></button>
    <button class="opt" id="s-live" disabled aria-pressed="false"><span class="dot"></span><span>Update titles as conversations progress<span class="sub" id="s-live-state">Loading the title setting…</span></span></button>
    <button class="opt" id="s-away" disabled aria-pressed="false"><span class="dot"></span><span>Summarize what you missed<span class="sub" id="s-away-state">Loading the summary setting…</span></span></button>
    <div class="title-settings"><label class="voice-field">Model for titles and summaries<select id="s-title-model" disabled>
      <option value="auto">Automatic: Claude first, then Codex</option><option value="claude">Claude · Haiku</option><option value="codex">Codex · GPT-6-Luna</option></select></label>
      <p class="title-note" id="s-title-note" role="status"></p></div>
    ${assistantMode() ? `<div class="title-settings model-offer" id="s-features-lead"><p class="title-note" id="s-features-note" role="status">${featuresLocked() ? '' : 'Switch on what you want to use. Each one adds its own place beside your conversations.'}</p></div>` : ''}
    <h2 class="settings-group">Tools</h2>
    <button class="opt" id="s-projects" disabled aria-pressed="false"><span class="dot"></span><span>Projects<span class="sub" id="s-projects-state">Loading the projects setting…</span></span></button>
    <div class="title-settings"><label class="voice-field">Open projects<select id="s-projects-open"><option value="tab">As a tab, like a conversation</option><option value="beside">Beside the conversation (from a pane: a new pane to its left)</option><option value="window">In a new browser window</option></select></label></div>
    <button class="opt" id="s-documents" disabled aria-pressed="false"><span class="dot"></span><span>Files<span class="sub" id="s-documents-state">Loading the Files setting…</span></span></button>
    <div class="title-settings"><label class="voice-field">Files button<select id="s-files-button"><option value="rail">Lists files in the sidebar</option><option value="tab">Opens the library in a tab</option><option value="beside">Opens the library in split view</option></select></label></div>
    <div class="title-settings"><label class="voice-field">Open files and links<select id="s-documents-open"><option value="tab">As a tab, like a conversation</option><option value="beside">Beside the conversation (from a pane: a new pane to its left)</option><option value="window">In a new browser window</option></select></label><p class="title-note">A link in a conversation to one of your files, projects or conversations opens the same way. A link to an outside website opens in your browser.</p></div>
    <button class="opt" id="s-autokeep" disabled aria-pressed="false"><span class="dot"></span><span>Keep files from replies<span class="sub" id="s-autokeep-state">Loading…</span></span></button>
    <button class="opt" id="s-tasks" disabled aria-pressed="false"><span class="dot"></span><span>Tasks<span class="sub" id="s-tasks-state">Loading the Tasks setting…</span></span></button>
    <button class="opt" id="s-inbox" disabled aria-pressed="false"><span class="dot"></span><span>Inbox Watch<span class="sub" id="s-inbox-state">Loading the Inbox setting…</span></span></button>
    <button class="opt" id="s-inbox-watch" hidden>${IC.sliders}<span>${assistantMode() ? 'Inbox Watch schedule' : 'Schedule, models and cost'}<span class="sub">${assistantMode() ? 'When it checks your mail, quiet hours, the digest and look-ahead' : 'When Inbox Watch checks your mail, which models judge it, what it cost each day'}</span></span></button>
    <button class="opt" id="s-vault" disabled aria-pressed="false"><span class="dot"></span><span>Vault<span class="sub" id="s-vault-state">Loading the Vault setting…</span></span></button>
    <div class="title-settings vault-settings" id="s-vault-restore-wrap" hidden><span class="vault-set-actions"><button class="chip" id="s-vault-restore">${VIC.key}Restore key…</button></span></div>
    <div class="title-settings vault-settings" id="s-vault-more" hidden>
      <div class="vault-set"><label class="vault-set-head" for="s-vault-access">Agent access</label>
        <span class="voice-field"><select id="s-vault-access" aria-describedby="s-vault-access-note">${VAULT_ACCESS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></span>
        <p class="title-note" id="s-vault-access-note"></p></div>
      <div class="vault-set" role="group" aria-labelledby="s-vault-prot-h"><p class="vault-set-head" id="s-vault-prot-h">Protection</p>
        <p class="vault-mode" id="s-vault-mode"></p><p class="title-note" id="s-vault-mode-note"></p>
        <span class="vault-set-actions"><button class="chip" id="s-vault-setpass" hidden>Set a passphrase</button><button class="chip" id="s-vault-lock" hidden>${VIC.lock}Lock now</button><button class="chip" id="s-vault-unlock" hidden>Unlock…</button><button class="chip" id="s-vault-changepass" hidden>Change passphrase</button><button class="chip" id="s-vault-removepass" hidden>Remove passphrase</button><button class="chip" id="s-vault-recovery" hidden>${VIC.download}Download recovery key</button><button class="chip" id="s-vault-rotate" hidden>Rotate key</button></span>
        <label class="voice-field" id="s-vault-autolock-wrap" hidden>Lock after<select id="s-vault-autolock" aria-describedby="s-vault-autolock-note">${VAULT_LOCK_CHOICES.map(([m, l]) => `<option value="${m}">${l}</option>`).join('')}</select></label>
        <p class="title-note" id="s-vault-autolock-note" hidden>Counted from the last time you or an agent used it. It always locks after a restart.</p></div>
      <div class="vault-set" role="group" aria-labelledby="s-vault-backup-h"><p class="vault-set-head" id="s-vault-backup-h">Export and import</p>
        <p class="title-note" id="s-vault-backup-note">One file with every item, encrypted with a passphrase you choose.</p>
        <span class="vault-set-actions"><button class="chip" id="s-vault-export">Export…</button><button class="chip" id="s-vault-import">Import…</button></span></div>
      <p class="title-note vault-warning" id="s-vault-codex"></p></div>
    <button class="opt" id="s-secrets" disabled aria-pressed="${secretGuard.on}"><span class="dot ${secretGuard.on ? 'on' : ''}"></span><span>Catch secrets in messages<span class="sub">Holds a key or password pasted or typed into a message and offers to store it in the Vault first</span></span></button>
    ${Voice.settingsHTML()}
    <details class="settings-details" id="s-about"${about ? ' open' : ''}><summary>About & updates<span class="summary-meta" id="s-about-version"></span></summary>
      <div class="about" id="s-version-info"></div><p id="s-version-state" role="status">Checking for updates…</p>
      <button class="chip" id="s-cli-updates">CLI updates</button><button class="chip" id="s-check">Check again</button><button class="primary" id="s-refresh" hidden></button>
    </details>
    <details class="settings-details" id="s-notes"><summary>What's new</summary><div class="whatsnew" id="s-notes-body">Loading release notes…</div></details>
    <details class="settings-details" id="s-feedback"><summary>Bugs & feature requests</summary>
      <div class="feedback">
        <p>Pocket Code is developed in the open. Reports go to GitHub Issues, with your version filled in.</p>
        <div class="feedback-links">
          <a class="chip" id="s-report-bug" href="${esc(issueUrl('bug_report'))}" target="_blank" rel="noopener noreferrer">Report a bug</a>
          <a class="chip" id="s-request-feature" href="${esc(issueUrl('feature_request'))}" target="_blank" rel="noopener noreferrer">Request a feature</a>
        </div>
        <p>Found a security problem? <a href="${REPO_URL}/security/advisories/new" target="_blank" rel="noopener noreferrer">Report it privately</a>, not as a public issue.</p>
      </div>
    </details>`;
  organizeSettings(sh, {category: about ? 'help' : category, scrollTop});
  const paintFeaturesNote = () => { const n = sh.querySelector('#s-features-note'); if (n && featuresLocked()) n.textContent = featuresLockedNote(srv || window.pocketFeatures); };
  paintFeaturesNote();
  sh.querySelector('#s-vault-more')?.after(sh.querySelector('#s-secrets')); // 1.42: under the Vault and its settings, shown whether or not the Vault is on
  sh.querySelector('#s-vault')?.after(sh.querySelector('#s-vault-restore-wrap')); // 1.44: Restore key sits right under the Vault switch
  mountSheet(scrim, sh);
  if (about) sh.querySelector('#s-about').scrollIntoView({block:'start'});
  bindChatTextControls(sh);
  bindAccentControls(sh);
  sh.querySelector('#s-theme').onchange = e => PocketTheme.setPreference(e.target.value);
  Voice.bindSettings(sh);
  sh.querySelector('#s-environment').onclick = openEnvironment;
  sh.querySelector('#s-connectors').onclick = () => openConnectors();
  sh.querySelector('#s-usage').onclick = openUsagePanel;
  sh.querySelector('#s-keys').onclick = keyboardHelp;
  sh.querySelector('#s-tools').onclick = e => {
    const on = !toolsCollapsed();
    writeLocal('pc-tools-collapsed', on);
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.querySelector('.dot').classList.toggle('on', on);
    document.querySelectorAll('details.ledgerwrap').forEach(d => { d.open = !on; });
  };
  // 1.68.1: the mode is a two-way choice you can read, not a switch you flip to find out which view you are in.
  sh.querySelectorAll('#s-mode [data-pocket-mode]').forEach(b => { b.onclick = async e => {
    const want = e.currentTarget.dataset.pocketMode === 'assistant';
    if (want === assistantMode()) return;
    if (window.pocketFeatures?.assistantLocked) return toast('Assistant mode is kept on by this server');
    const buttons = sh.querySelectorAll('#s-mode [data-pocket-mode]'); buttons.forEach(x => { x.disabled = true; });
    try {
      await api('/settings', { method: 'POST', body: JSON.stringify({ assistantMode: want }) });
      window.pocketFeatures = { ...(window.pocketFeatures || {}), assistantMode: want };
      closeCurrentSheet?.(); applyAssistantMode(); route();
      toast(want ? 'Assistant mode is on' : 'Developer mode is on');
    } catch (err) { toast(err.message); buttons.forEach(x => { x.disabled = false; }); }
  }; });
  sh.querySelector('#s-plain').onclick = e => {
    const on = !plainSteps();
    writeLocal('pc-plain-steps', on);
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.querySelector('.dot').classList.toggle('on', on);
    applyPlainSteps();
    document.querySelectorAll('details.ledgerwrap').forEach(foldSummary);
  };
  sh.querySelector('#s-times').onclick = e => {
    const on = !showTimes();
    writeLocal('pc-times', on);
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.querySelector('.dot').classList.toggle('on', on);
    document.querySelectorAll('.msgs').forEach(m => m.classList.toggle('times-off', !on));
  };
  sh.querySelector('#s-chime').onclick = e => {
    const on = localStorage.getItem('pc-chime') === 'off';
    localStorage.setItem('pc-chime', on ? 'on' : 'off');
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.querySelector('.dot').classList.toggle('on', on);
  };
  // 1.50: push by kind and the icon count are this device's choices, kept with its subscription on the server.
  let pushSub = null, pushPrefs = null;
  const PUSH_KINDS = ['turns', 'reminders', 'vault', 'alerts']; // 1.69: alerts
  const paintPushKinds = () => {
    for (const k of PUSH_KINDS) { const b = sh.querySelector('#s-push-' + k); if (!b) continue; const on = Boolean(pushSub) && pushPrefs?.kinds?.[k] !== false; b.disabled = !pushSub; b.setAttribute('aria-pressed', String(on)); b.querySelector('.dot').classList.toggle('on', on); }
  };
  const refreshPush = async () => {
    const reg = await pushRegistration();
    let sub = null;
    try { if (reg) sub = await reg.pushManager.getSubscription(); } catch { }
    if (!sh.isConnected) return;
    pushSub = sub; pushPrefs = null;
    const btn = sh.querySelector('#s-push');
    btn.setAttribute('aria-pressed', String(Boolean(sub)));
    btn.querySelector('.dot').classList.toggle('on', Boolean(sub));
    sh.querySelector('#s-push-state').textContent = !reg ? 'Unavailable. Reload the app or tap to retry.' : sub ? 'On. Notifications reach this device even when Pocket is closed; choose which below' : 'Off. Turn on for finished replies, due tasks and reminders, and Vault requests on this device';
    if (sub) { try { pushPrefs = (await api('/push/prefs?endpoint=' + encodeURIComponent(sub.endpoint), { signal: AbortSignal.timeout(8000) })).prefs; } catch { pushPrefs = { kinds: { turns: true, reminders: true, vault: true, alerts: true }, badge: true }; } }
    if (sh.isConnected) paintPushKinds();
  };
  sh.querySelector('#s-push').onclick = async e => { await togglePush(e.currentTarget); await refreshPush(); };
  for (const k of PUSH_KINDS) sh.querySelector('#s-push-' + k).onclick = async e => {
    if (!pushSub) return; const btn = e.currentTarget, on = btn.getAttribute('aria-pressed') !== 'true'; btn.disabled = true;
    try { pushPrefs = (await api('/push/prefs', { method: 'POST', body: JSON.stringify({ endpoint: pushSub.endpoint, kinds: { [k]: on } }), signal: AbortSignal.timeout(8000) })).prefs; toast(({ turns: 'Finished replies', reminders: 'Due tasks and reminders', vault: 'Vault requests', alerts: 'Inbox alerts' })[k] + (on ? ' on for this device' : ' off for this device')); }
    catch (err) { toast('Could not save: ' + (err.message || 'error')); }
    finally { if (sh.isConnected) paintPushKinds(); }
  };
  // The icon count: supported in installed apps on most platforms; the server sends it with a reminder only to devices that want it.
  const badgeBtn = sh.querySelector('#s-badge'), badgeAble = 'setAppBadge' in navigator;
  const paintBadgeSetting = () => { const on = badgeAble && (typeof iconBadgeOn === 'function' ? iconBadgeOn() : true); badgeBtn.disabled = !badgeAble; badgeBtn.setAttribute('aria-pressed', String(on)); badgeBtn.querySelector('.dot').classList.toggle('on', on); sh.querySelector('#s-badge-state').textContent = !badgeAble ? 'Not available in this browser. Installed apps on Android, iOS 16.4+, Windows and macOS show it' : on ? 'How many tasks and reminders are due, on the installed app\'s icon' : 'Off. The icon shows no count'; };
  paintBadgeSetting();
  badgeBtn.onclick = async () => {
    const on = !(typeof iconBadgeOn === 'function' ? iconBadgeOn() : true); writeLocal('pc-icon-badge', on); paintBadgeSetting(); if (typeof paintAppBadge === 'function') paintAppBadge();
    if (pushSub) { try { pushPrefs = (await api('/push/prefs', { method: 'POST', body: JSON.stringify({ endpoint: pushSub.endpoint, badge: on }), signal: AbortSignal.timeout(8000) })).prefs; } catch { } }
    toast(on ? 'The app icon will show the due count' : 'No count on the app icon');
  };
  // Instance-wide: the day-before notice and the email address (needs POCKET_SMTP_URL on the server).
  const paintNotifySettings = () => {
    if (!srv) return;
    const ahead = sh.querySelector('#s-ahead'), on = Number(srv.remindAhead) === 24;
    ahead.disabled = false; ahead.setAttribute('aria-pressed', String(on)); ahead.querySelector('.dot').classList.toggle('on', on);
    sh.querySelector('#s-ahead-state').textContent = on ? 'A second notice 24 hours before a dated task or reminder comes due, the same way as the due one' : 'Off. Each task or reminder is announced once, when it comes due';
    const em = srv.email || {}, input = sh.querySelector('#s-email'), save = sh.querySelector('#s-email-save'), test = sh.querySelector('#s-email-test'), note = sh.querySelector('#s-email-note');
    input.disabled = save.disabled = !em.configured; test.disabled = !em.configured || !em.to;
    if (document.activeElement !== input) input.value = em.to || '';
    note.textContent = !em.configured ? (em.error ? 'Email cannot be set up: ' + em.error : 'Not set up on this server. Set POCKET_SMTP_URL (and POCKET_SMTP_FROM) in .env and restart to email due tasks and reminders.') + (em.hook ? ' This server runs its own reminder command as well.' : '')
      : (em.to ? 'Due tasks and reminders are emailed to ' + em.to + ', from ' + em.from + '.' : 'Enter the address to send to; messages come from ' + em.from + '.') + (em.base ? '' : ' Links in the mail need POCKET_PUBLIC_URL, or one sign-in from your own address.') + (em.hook ? ' This server runs its own reminder command as well.' : '');
  };
  sh.querySelector('#s-ahead').onclick = async e => {
    const btn = e.currentTarget; if (!srv) return; btn.disabled = true;
    try { srv = await api('/settings', { method: 'POST', body: JSON.stringify({ remindAhead: Number(srv.remindAhead) === 24 ? 0 : 24 }), signal: AbortSignal.timeout(8000) }); toast(Number(srv.remindAhead) === 24 ? 'A notice goes out a day before' : 'Announced once, when due'); }
    catch (err) { toast('Could not save: ' + (err.message || 'error')); }
    finally { paintNotifySettings(); }
  };
  sh.querySelector('#s-email-form').onsubmit = async e => {
    e.preventDefault(); if (!srv) return; const to = sh.querySelector('#s-email').value.trim(), save = sh.querySelector('#s-email-save'); save.disabled = true;
    try { srv = await api('/settings', { method: 'POST', body: JSON.stringify({ notifyEmail: to }), signal: AbortSignal.timeout(8000) }); toast(to ? 'Reminders will be emailed to ' + to : 'Email reminders off'); }
    catch (err) { toast(err.message || 'Could not save the address'); }
    finally { paintNotifySettings(); }
  };
  sh.querySelector('#s-email-test').onclick = async e => {
    const btn = e.currentTarget; btn.disabled = true; sh.querySelector('#s-email-note').textContent = 'Sending a test message…';
    try { const r = await api('/notify/test-email', { method: 'POST', body: '{}', signal: AbortSignal.timeout(30000) }); toast('Test message sent to ' + r.to); }
    catch (err) { toast(err.message || 'The test message could not be sent'); }
    finally { paintNotifySettings(); }
  };
  // 1.52: which Claude models the picker offers (instance-wide). A model this computer's Claude Code policy
  // blocks stays listed, marked and not offered, so the owner sees why it is missing from the picker.
  const paintModelOffer = () => {
    const cm = srv?.claudeModels, list = sh.querySelector('#s-models-list'), note = sh.querySelector('#s-models-note');
    if (!cm || !list) return;
    list.removeAttribute('aria-busy');
    const focused = document.activeElement?.dataset?.offerModel;
    list.innerHTML = cm.models.map(m => `<button class="opt" data-offer-model="${esc(m.id)}" aria-pressed="${m.offered}"${m.blocked ? ' aria-disabled="true"' : ''}><span class="dot${m.offered ? ' on' : ''}"></span><span>${esc(m.label)}<span class="sub">${esc(m.blocked ? m.reason : m.sub)}</span></span></button>`).join('');
    if (focused) list.querySelector(`[data-offer-model="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    const total = cm.models.length, on = cm.offered.length, blocked = cm.models.filter(m => m.blocked).length;
    note.textContent = [
      cm.source === 'settings' ? `Chosen here: the picker offers ${on} of ${total} models.` : cm.source === 'env' ? `From POCKET_CLAUDE_MODELS on this server: the picker offers ${on} of ${total} models. A change here replaces it.` : 'The picker offers every model. Turn off the ones this instance should not offer.',
      blocked ? `This computer's Claude Code policy blocks ${blocked === 1 ? 'one' : blocked}, so ${blocked === 1 ? 'it is' : 'they are'} never offered.` : '',
      cm.policy?.error ? `Claude Code's managed settings could not be read (${cm.policy.error}).` : '',
      !on ? 'No model can be offered, so the picker shows only Default.' : '',
      cm.pocketDefault?.configured && !cm.pocketDefault.used ? `The server's default model is not offered, so Default uses Claude Code's own (${cm.pocketDefault.label}).` : '',
    ].filter(Boolean).join(' ');
    sh.querySelector('#s-models-reset').hidden = !cm.saved;
  };
  // 1.92: the context limit and subagent model for every engine that supports them (context-policy.mjs on the server).
  const paintContext = () => {
    const cp = srv?.contextPolicy, lim = sh.querySelector('#s-context-limit'), wk = sh.querySelector('#s-context-workers'), ef = sh.querySelector('#s-context-effort'), note = sh.querySelector('#s-context-note');
    if (!cp || !lim) return;
    const k = n => `${Math.round(n / 1000)}K`, limits = [...new Set([...(cp.limits || []), cp.compaction.limit])].sort((a, b) => a - b);
    lim.innerHTML = '<option value="agent">When the agent decides</option>' + limits.map(n => `<option value="${n}">Before ${k(n)} tokens</option>`).join('');
    lim.value = cp.compaction.mode === 'limit' ? String(cp.compaction.limit) : 'agent';
    wk.value = cp.workers.model; ef.value = cp.workers.effort || '';
    lim.disabled = wk.disabled = ef.disabled = false;
    const on = (cp.engines || []).filter(e => e.applies).map(e => e.id === 'claude' ? 'Claude Code' : e.label), off = (cp.engines || []).filter(e => !e.applies).map(e => e.label);
    note.textContent = [
      on.length ? `Applies to ${on.join(' and ')} conversations from their next reply.` : '',
      off.length ? `${off.join(' and ')} conversations keep their own behavior for now.` : '',
      cp.compaction.mode === 'limit' ? `The agent compacts shortly before ${k(cp.compaction.limit)} tokens.` : '',
      cp.workers.model === 'tier-down' ? 'Fable conversations run Opus subagents, Opus runs Sonnet and GPT Astra runs GPT Sol. Other models keep the agent’s choice, and a conversation can still name a model for one subagent.' : '',
    ].filter(Boolean).join(' ');
  };
  const saveContext = async patch => {
    const fields = ['#s-context-limit', '#s-context-workers', '#s-context-effort'].map(q => sh.querySelector(q));
    fields.forEach(f => { f.disabled = true; });
    try { srv = await api('/settings', { method: 'POST', body: JSON.stringify({ contextPolicy: patch }), signal: AbortSignal.timeout(8000) }); toast('Saved. Conversations use it from their next reply'); }
    catch (err) { toast(err.message || 'Could not save the context setting'); }
    finally { if (sh.isConnected) { fields.forEach(f => { f.disabled = false; }); paintContext(); } }
  };
  sh.querySelector('#s-context-limit').onchange = e => saveContext({ compaction: e.target.value === 'agent' ? { mode: 'agent' } : { mode: 'limit', limit: Number(e.target.value) } });
  sh.querySelector('#s-context-workers').onchange = e => saveContext({ workers: { model: e.target.value } });
  sh.querySelector('#s-context-effort').onchange = e => saveContext({ workers: { effort: e.target.value || null } });
  const saveModelOffer = async (value, done) => {
    const list = sh.querySelector('#s-models-list'); list.setAttribute('aria-busy', 'true');
    try {
      srv = await api('/settings', { method: 'POST', body: JSON.stringify({ offeredClaudeModels: value }), signal: AbortSignal.timeout(8000) });
      claudeModelsLoaded = false; loadClaudeModels().then(() => renderToolbar());
      toast(done);
    } catch (err) { toast(err.message || 'Could not save the model list'); }
    finally { list.removeAttribute('aria-busy'); if (sh.isConnected) paintModelOffer(); }
  };
  // 1.67: automatic model choice. Each level's model list is the models this Pocket offers (Settings above and the
  // managed policy), strongest first; effort stops at the policy's ceiling. "Automatic" follows the newest offered
  // model of the level's family, so a newer model is picked up as soon as it is offered.
  const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];
  const routerModelLabel = id => srv?.claudeModels?.models.find(m => m.id === id)?.label || id || 'Default';
  const paintRouter = () => {
    const r = srv?.router, cm = srv?.claudeModels; if (!r) return;
    const on = sh.querySelector('#s-router-on'), prov = sh.querySelector('#s-router-provider'), key = sh.querySelector('#s-router-key');
    // 1.81 (#175): Assistant mode shows only the switch, so its lead says what it does without levels or models.
    sh.querySelector('#s-router-lead').textContent = assistantMode() ? 'A request typed from scratch gets as much effort as it needs: quick questions answer fast, bigger jobs get a stronger model. Saved prompts keep their own.' : 'In Assistant mode, a request typed from scratch goes to a small decision model that picks the lightest of four levels that will do it well. Each level runs the model and effort below. Saved prompts keep their own.';
    on.disabled = false; on.setAttribute('aria-pressed', String(r.enabled)); on.querySelector('.dot').classList.toggle('on', r.enabled);
    sh.querySelector('#s-router-state').textContent = !r.enabled ? 'Off. Typed requests run on the default model' : r.active ? 'On in Assistant mode' : 'On, but it needs a key to work';
    prov.disabled = false; prov.value = r.provider;
    key.disabled = false; sh.querySelector('#s-router-key-save').disabled = false;
    sh.querySelector('#s-router-key-remove').hidden = r.keySource !== 'settings';
    sh.querySelector('#s-router-key-note').textContent = r.keySource === 'settings' ? 'A key is saved here. It is never shown again; paste a new one to replace it.' : r.keySource === 'env' ? 'Using the key this server was started with (POCKET_ROUTER_KEY / POCKET_ROUTER_KEY_FILE). A key saved here replaces it.' : (r.provider === 'openai' ? 'An OpenAI API key with the Decisions API.' : 'An OpenRouter key.') + ' None is set yet.';
    const offered = (cm?.models || []).filter(m => m.offered), cap = r.maxEffort, efforts = EFFORT_ORDER.filter(e => !cap || EFFORT_ORDER.indexOf(e) <= EFFORT_ORDER.indexOf(cap)).reverse();
    const levels = sh.querySelector('#s-router-levels'); levels.removeAttribute('aria-busy');
    levels.innerHTML = r.levels.map(l => {
      const m = l.chosen?.model || 'auto', e = l.chosen?.effort || 'auto';
      return `<div class="router-level" data-level="${esc(l.key)}"><p class="router-level-name">${esc(l.label)}<span class="sub">${esc(l.about)}</span></p>
        <label class="voice-field">Model<select data-level-model>${[`<option value="auto">Automatic: ${esc(routerModelLabel(l.auto?.model))}</option>`, ...offered.map(x => `<option value="${esc(x.id)}">${esc(x.label)}</option>`)].join('')}</select></label>
        <label class="voice-field">Effort<select data-level-effort>${[`<option value="auto">Automatic: ${esc(EFFORT_NAMES[l.auto?.effort] || 'Default')}</option>`, ...efforts.map(x => `<option value="${x}">${esc(EFFORT_NAMES[x])}</option>`)].join('')}</select></label>
        <p class="title-note router-runs">Runs ${esc(routerModelLabel(l.runs?.model))}, ${esc((EFFORT_NAMES[l.runs?.effort] || 'default').toLowerCase())} effort</p></div>`;
    }).join('');
    levels.querySelectorAll('.router-level').forEach(row => { const l = r.levels.find(x => x.key === row.dataset.level); row.querySelector('[data-level-model]').value = l.chosen?.model && offered.some(x => x.id === l.chosen.model) ? l.chosen.model : 'auto'; row.querySelector('[data-level-effort]').value = l.chosen?.effort && efforts.includes(l.chosen.effort) ? l.chosen.effort : 'auto'; });
    const last = r.last;
    sh.querySelector('#s-router-note').textContent = [
      r.enabledSource === 'env' ? 'Turned on by this server (POCKET_ROUTER).' : '',
      cap ? `This computer's Claude Code policy caps effort at ${EFFORT_NAMES[cap]}.` : '',
      last?.used ? `Last choice ${ago(last.at)}: ${last.tier} → ${routerModelLabel(last.used.model)}, ${(EFFORT_NAMES[last.used.effort] || '').toLowerCase()} (${last.ms} ms).` : last?.error ? `Last attempt ${ago(last.at)} failed (${last.error}); the default ran.` : last?.tier ? `Last answer ${ago(last.at)} was unsure (${last.tier}); the default ran.` : '',
    ].filter(Boolean).join(' ');
    sh.querySelector('#s-router-reset').hidden = !(srv.router && (r.enabledSource === 'settings' || r.keySource === 'settings' || r.levels.some(l => l.chosen)));
  };
  const saveRouter = async (patch, done) => {
    try { srv = await api('/settings', { method: 'POST', body: JSON.stringify({ router: patch }), signal: AbortSignal.timeout(8000) }); if (done) toast(done); }
    catch (err) { toast(err.message || 'Could not save'); }
    finally { if (sh.isConnected) paintRouter(); }
  };
  const ago = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  sh.querySelector('#s-router-on').onclick = () => { const r = srv?.router; if (r) saveRouter({ enabled: !r.enabled }, !r.enabled ? 'Automatic model choice is on' : 'Automatic model choice is off'); };
  sh.querySelector('#s-router-provider').onchange = e => saveRouter({ provider: e.target.value }, 'Decision model saved');
  sh.querySelector('#s-router-key-form').onsubmit = e => { e.preventDefault(); const k = sh.querySelector('#s-router-key'); if (!k.value.trim()) return toast('Paste the key first'); saveRouter({ key: k.value.trim() }, 'Key saved'); k.value = ''; };
  sh.querySelector('#s-router-key-remove').onclick = () => confirmSheet('Remove the saved key?', srv?.router?.enabled ? 'Automatic model choice uses the server\'s key if it has one, and stops otherwise.' : 'The key saved here is deleted.', 'Remove', () => saveRouter({ key: '' }, 'Key removed'));
  sh.querySelector('#s-router-levels').onchange = () => {
    const levels = {}; sh.querySelectorAll('#s-router-levels .router-level').forEach(row => { levels[row.dataset.level] = { model: row.querySelector('[data-level-model]').value, effort: row.querySelector('[data-level-effort]').value }; });
    saveRouter({ levels }, 'Levels saved');
  };
  sh.querySelector('#s-router-reset').onclick = () => confirmSheet('Use the server\'s settings?', 'The switch, decision model, key and levels saved here are cleared; the server\'s POCKET_ROUTER settings apply again.', 'Use the server\'s settings', async () => { try { srv = await api('/settings', { method: 'POST', body: JSON.stringify({ router: null }) }); toast('Using the server\'s settings'); } catch (err) { toast(err.message); } paintRouter(); });
  // 1.67: one sign-in.
  const paintAccess = () => {
    const a = srv?.access; if (!a) return;
    ['#s-access-team', '#s-access-aud', '#s-access-emails', '#s-access-save'].forEach(q => { sh.querySelector(q).disabled = false; });
    const f = sh.querySelector('#s-access-form');
    if (!f.dataset.dirty) { sh.querySelector('#s-access-team').value = a.team || ''; sh.querySelector('#s-access-aud').value = a.aud || ''; sh.querySelector('#s-access-emails').value = (a.emails || []).join(', '); }
    sh.querySelector('#s-access-state').textContent = a.on
      ? `On${a.source === 'env' ? ', from this server\'s settings' : ''}: ${a.emails.join(', ')} can sign in with Cloudflare Access alone.${a.last ? ` Last sign-in ${ago(a.last.at)} (${a.last.email}).` : ''}`
      : a.off ? 'Off. Pocket asks for its own password.' : a.source === 'none' ? 'Off. Fill in the three fields to turn it on.' : 'Not working: the team, audience tag or emails are incomplete. Pocket asks for its own password.';
    sh.querySelector('#s-access-off').hidden = !a.on;
    sh.querySelector('#s-access-reset').hidden = !(a.source === 'settings' && a.envSet);
  };
  const saveAccess = async (body, done) => {
    const err = sh.querySelector('#s-access-error'); err.textContent = '';
    try { srv = await api('/settings', { method: 'POST', body: JSON.stringify({ access: body }), signal: AbortSignal.timeout(8000) }); delete sh.querySelector('#s-access-form').dataset.dirty; toast(done); }
    catch (e2) { err.textContent = e2.message || 'Could not save'; }
    finally { if (sh.isConnected) paintAccess(); }
  };
  sh.querySelector('#s-access-form').oninput = e => { e.currentTarget.dataset.dirty = '1'; };
  sh.querySelector('#s-access-form').onsubmit = e => { e.preventDefault(); saveAccess({ team: sh.querySelector('#s-access-team').value, aud: sh.querySelector('#s-access-aud').value, emails: sh.querySelector('#s-access-emails').value }, 'One sign-in saved'); };
  sh.querySelector('#s-access-off').onclick = () => confirmSheet('Turn off one sign-in?', 'Pocket asks for its own password again after Cloudflare Access. Browsers already signed in stay signed in for up to a day.', 'Turn off', () => saveAccess({ enabled: false }, 'One sign-in is off'));
  sh.querySelector('#s-access-reset').onclick = () => saveAccess(null, 'Using the server\'s values');
  sh.querySelector('#s-models-list').onclick = e => {
    const btn = e.target.closest('[data-offer-model]'), cm = srv?.claudeModels; if (!btn || !cm) return;
    const m = cm.models.find(x => x.id === btn.dataset.offerModel); if (!m) return;
    if (m.blocked) return toast(m.label + ': ' + m.reason);
    if (m.offered && cm.offered.length === 1) return toast('Keep at least one model on');
    const next = cm.models.filter(x => x.id === m.id ? !m.offered : x.selected).map(x => x.id);
    saveModelOffer(next, m.offered ? m.label + ' is no longer offered' : m.label + ' is offered');
  };
  sh.querySelector('#s-models-reset').onclick = () => saveModelOffer(null, srv?.claudeModels?.env ? 'Back to the list in POCKET_CLAUDE_MODELS' : 'Every model is offered again');
  // 1.56: read-only actions Claude runs without a card in Review actions (instance-wide). The server checks every
  // rule; its reason shows under the field. A list saved here replaces POCKET_TRUSTED_ACTIONS until Use the server's list.
  const trustedInput = sh.querySelector('#s-trusted-input'), trustedError = sh.querySelector('#s-trusted-error');
  let trustedSaving = false;
  const clearTrustedError = () => { trustedError.textContent = ''; trustedInput.removeAttribute('aria-invalid'); };
  const paintTrusted = () => {
    const tr = srv?.trusted, list = sh.querySelector('#s-trusted-list'), note = sh.querySelector('#s-trusted-note');
    if (!tr || !list) return;
    list.removeAttribute('aria-busy');
    list.innerHTML = tr.rules.length ? tr.rules.map((r, i) => `<li class="trusted-row"><code>${esc(r)}</code><button class="chip" type="button" data-trusted-remove="${i}" aria-label="Remove ${esc(r)}"${trustedSaving ? ' disabled' : ''}>Remove</button></li>`).join('')
      : '<li class="trusted-empty">None. Every action shows the approval card.</li>';
    trustedInput.disabled = trustedSaving; sh.querySelector('#s-trusted-add').disabled = trustedSaving || !trustedInput.value.trim();
    const n = tr.rules.length, rules = n === 1 ? 'one action' : n + ' actions', ignored = tr.envIgnored?.length || 0;
    note.textContent = [
      tr.source === 'settings' ? (n ? `Chosen here: ${rules} run without asking.` : 'Chosen here: every action asks.') + (tr.env?.length ? ' This replaces the server\'s list.' : '')
        : tr.source === 'env' ? `From POCKET_TRUSTED_ACTIONS on this server: ${rules} run without asking. A change here replaces it.` : '',
      tr.source !== 'settings' && ignored ? `The server's list skips ${ignored === 1 ? 'one rule' : ignored + ' rules'} it cannot use: ${tr.envIgnored.map(x => x.rule).join(', ')}.` : '',
    ].filter(Boolean).join(' ');
    sh.querySelector('#s-trusted-reset').hidden = !tr.saved;
  };
  const saveTrusted = async (value, done, { focus } = {}) => {
    trustedSaving = true; paintTrusted();
    try {
      srv = await api('/settings', { method: 'POST', body: JSON.stringify({ trustedActions: value }), signal: AbortSignal.timeout(8000) });
      toast(typeof done === 'function' ? done() : done); return true;
    } catch (err) {
      if (err.code === 'bad_trusted_action') { trustedError.textContent = err.message; trustedInput.setAttribute('aria-invalid', 'true'); }
      else if (err.message !== 'login') toast(err.message || 'Could not save the list');
      return false;
    } finally {
      trustedSaving = false;
      if (sh.isConnected) { paintTrusted(); (focus?.() || trustedInput).focus({ preventScroll: true }); }
    }
  };
  trustedInput.oninput = () => { clearTrustedError(); sh.querySelector('#s-trusted-add').disabled = trustedSaving || !trustedInput.value.trim(); };
  sh.querySelector('#s-trusted-form').onsubmit = async e => {
    e.preventDefault(); const tr = srv?.trusted, rule = trustedInput.value.trim(); if (!tr || !rule || trustedSaving) return;
    clearTrustedError();
    if (await saveTrusted([...tr.rules, rule], () => (srv.trusted?.rules.length || 0) > tr.rules.length ? 'Runs without asking: ' + srv.trusted.rules.at(-1) : 'Already on the list')) { trustedInput.value = ''; paintTrusted(); }
  };
  sh.querySelector('#s-trusted-list').onclick = e => {
    const btn = e.target.closest('[data-trusted-remove]'), tr = srv?.trusted; if (!btn || !tr || trustedSaving) return;
    const i = Number(btn.dataset.trustedRemove), rule = tr.rules[i]; if (rule == null) return;
    clearTrustedError();
    // Focus moves to the row that takes this one's place, else the one before, else the field.
    saveTrusted(tr.rules.filter((_, j) => j !== i), rule + ' asks again', { focus: () => { const b = sh.querySelectorAll('[data-trusted-remove]'); return b[Math.min(i, b.length - 1)]; } });
  };
  sh.querySelector('#s-trusted-reset').onclick = () => { clearTrustedError(); saveTrusted(null, srv?.trusted?.env?.length ? 'Back to the list in POCKET_TRUSTED_ACTIONS' : 'Every action asks again'); };
  // 1.20: generated session titles. Server-wide like name sync: on/off and which CLI makes them.
  const paintTitles = () => {
    const t = srv?.titles, btn = sh.querySelector('#s-titles'), sel = sh.querySelector('#s-title-model'), state = sh.querySelector('#s-titles-state'), note = sh.querySelector('#s-title-note');
    if (!t || !btn) return;
    btn.disabled = false; btn.setAttribute('aria-pressed', String(t.enabled)); btn.querySelector('.dot').classList.toggle('on', t.enabled);
    const name = p => p === 'codex' ? 'Codex · ' + (t.codex.label || t.models.codex) : 'Claude · ' + (t.claudeModelLabel || 'Haiku');
    state.textContent = !t.enabled ? 'Off. Conversations named only by their first message show that message.'
      : t.using ? 'On, using ' + name(t.using) + '. A rename always comes first.'
      : 'On, but no signed-in Claude Code or Codex on this server can make titles.';
    for (const o of sel.options) if (o.value !== 'auto') { const a = t[o.value]; o.disabled = a.available === false; o.textContent = name(o.value) + (a.available === false ? ' (unavailable)' : ''); }
    // 1.29.1: living titles follow the generated-titles switch and the same helper model.
    const live = sh.querySelector('#s-live'), liveOn = t.live !== false, ago = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
    live.disabled = !t.enabled; live.setAttribute('aria-pressed', String(liveOn && t.enabled)); live.querySelector('.dot').classList.toggle('on', liveOn && t.enabled);
    sh.querySelector('#s-live-state').textContent = !t.enabled ? 'Needs Generate short titles.'
      : !liveOn ? 'Off. A title is made once, from the opening request.'
      : t.liveUsing ? 'After a reply, once a conversation has moved on, its title is checked and rewritten to say what it is about now. Renames are never touched.' + (t.lastLive ? ' Last update ' + ago(t.lastLive.at) + ': "' + t.lastLive.title + '".' : '')
      : 'On, but no signed-in Claude Code or Codex on this server can check titles.';
    const away = sh.querySelector('#s-away'), awayOn = t.awaySummaries !== false;
    away.disabled = false; away.setAttribute('aria-pressed', String(awayOn)); away.querySelector('.dot').classList.toggle('on', awayOn);
    sh.querySelector('#s-away-state').textContent = !awayOn ? 'Off. Coming back to a conversation still marks where new work starts.'
      : t.helper ? 'When you come back to a conversation, it opens at the end with a New since card and a short summary of the new work. A New since divider marks where it starts.'
      : 'On, but no signed-in Claude Code or Codex on this server can write summaries. The New since divider and card still show.';
    sel.value = t.choice; sel.disabled = !t.enabled && !awayOn;
    const chosen = t.choice === 'auto' ? null : t[t.choice];
    note.textContent = [chosen?.available === false ? chosen.reason : '',
      (t.enabled || awayOn) && (t.helper || t.using) === 'codex' ? 'Each Codex call sends about 25k tokens of your plan; a Claude call about 400 for a title and a few thousand for a summary.' : '',
      t.last?.model ? 'Last title by ' + (t.last.provider === 'codex' ? (t.codex.label || t.last.model) : modelLabel(t.last.model)) + '.' : ''].filter(Boolean).join(' ');
  };
  const saveTitles = async patch => {
    const btn = sh.querySelector('#s-titles'), sel = sh.querySelector('#s-title-model'), away = sh.querySelector('#s-away'), live = sh.querySelector('#s-live'); btn.disabled = sel.disabled = away.disabled = live.disabled = true;
    try {
      srv = await api('/settings', { method: 'POST', body: JSON.stringify(patch), signal: AbortSignal.timeout(8000) });
      if (!sh.isConnected) return;
      toast(patch.autoTitles === false ? 'Generated titles off' : patch.autoTitles ? 'Generated titles on'
        : patch.liveTitles === false ? 'Titles stay as first made' : patch.liveTitles ? 'Titles will follow the conversation'
        : patch.awaySummaries === false ? 'Summaries off' : patch.awaySummaries ? 'Summaries on' : 'Titles and summaries will use ' + sel.selectedOptions[0].textContent);
      refreshSessions();
    } catch (err) { toast('Could not save: ' + err.message); }
    finally { paintTitles(); }
  };
  sh.querySelector('#s-titles').onclick = () => { if (srv?.titles) saveTitles({ autoTitles: !srv.titles.enabled }); };
  // 1.29: Projects is server-wide (every device, the CLI); how a project opens is this browser's choice.
  const paintProjectsSetting = () => {
    const btn = sh.querySelector('#s-projects'); if (!btn || !srv) return;
    const on = Boolean(srv.projects);
    btn.disabled = false; btn.setAttribute('aria-pressed', String(on)); btn.querySelector('.dot').classList.toggle('on', on);
    sh.querySelector('#s-projects-state').textContent = on ? 'On: tracked projects with steps and reminders, across your devices and agent conversations' : 'Off. Turn on to track projects, steps and reminders, here and from agent conversations';
  };
  sh.querySelector('#s-projects').onclick = async e => {
    const btn = e.currentTarget; if (!srv) return; btn.disabled = true;
    try {
      srv = await api('/settings', { method: 'POST', body: JSON.stringify({ projects: !srv.projects }), signal: AbortSignal.timeout(8000) });
      window.pocketFeatures = { ...(window.pocketFeatures || {}), projects: Boolean(srv.projects) };
      paintProjectsSetting(); toast(srv.projects ? 'Projects is on' : 'Projects is off');
      if (!srv.projects) writeLocal('pc-rail-view', 'sessions');
      paintProjectBadges(); document.querySelectorAll('.session-home, aside.rail').length && route();
    } catch (err) { toast('Could not save: ' + (err.message || 'error')); btn.disabled = false; }
  };
  const openSel = sh.querySelector('#s-projects-open'); openSel.value = readLocal('pc-projects-open', 'tab'); openSel.onchange = () => writeLocal('pc-projects-open', openSel.value);
  // 1.30: Documents, the same way.
  const paintDocumentsSetting = () => {
    const btn = sh.querySelector('#s-documents'); if (!btn || !srv) return;
    const on = Boolean(srv.documents);
    btn.disabled = false; btn.setAttribute('aria-pressed', String(on)); btn.querySelector('.dot').classList.toggle('on', on);
    sh.querySelector('#s-documents-state').textContent = on ? 'On: a library of files from your work, with previews, sharing and links to conversations' : 'Off. Turn on to keep reports, PDFs and other files from conversations in a library you can view and share';

    paintAutoKeepSetting();
  };
  // 1.61: keep every file a reply hands over in Files. Needs Files on; always on in Assistant mode.
  const paintAutoKeepSetting = () => {
    const btn = sh.querySelector('#s-autokeep'); if (!btn || !srv) return;
    const forced = assistantMode(), on = Boolean(srv.documents) && (forced || Boolean(srv.autoKeepFiles));
    btn.disabled = !srv.documents || forced; btn.setAttribute('aria-pressed', String(on)); btn.querySelector('.dot').classList.toggle('on', on);
    sh.querySelector('#s-autokeep-state').textContent = !srv.documents ? 'Needs Files on' : forced ? 'Always on in Assistant mode' : on ? 'On: a file a reply hands you (a PDF, deck, sheet, page) is kept in Files once, linked to its conversation' : 'Off. Keep a file from its card or from Results';
  };
  sh.querySelector('#s-autokeep').onclick = async e => {
    const btn = e.currentTarget; if (!srv || btn.disabled) return; btn.disabled = true;
    try { srv = await api('/settings', { method: 'POST', body: JSON.stringify({ autoKeepFiles: !srv.autoKeepFiles }), signal: AbortSignal.timeout(8000) }); paintAutoKeepSetting(); toast(srv.autoKeepFiles ? 'Files from replies will be kept' : 'Files from replies are no longer kept automatically'); }
    catch (err) { toast('Could not save: ' + (err.message || 'error')); paintAutoKeepSetting(); }
  };
  sh.querySelector('#s-documents').onclick = async e => {
    const btn = e.currentTarget; if (!srv) return; btn.disabled = true;
    try {
      srv = await api('/settings', { method: 'POST', body: JSON.stringify({ documents: !srv.documents }), signal: AbortSignal.timeout(8000) });
      window.pocketFeatures = { ...(window.pocketFeatures || {}), documents: Boolean(srv.documents) };
      paintDocumentsSetting(); toast(srv.documents ? 'Files is on' : 'Files is off');
      if (!srv.documents && readLocal('pc-rail-view', 'sessions') === 'documents') writeLocal('pc-rail-view', 'sessions');
      document.querySelectorAll('.session-home, aside.rail').length && route();
    } catch (err) { toast('Could not save: ' + (err.message || 'error')); btn.disabled = false; }
  };
  const filesBtnSel = sh.querySelector('#s-files-button'); filesBtnSel.value = filesButtonOpens(); filesBtnSel.onchange = () => writeLocal('pc-files-button', filesBtnSel.value);
  // 1.69: Inbox Watch, the same way.
  const paintInboxSetting = () => {
    const btn = sh.querySelector('#s-inbox'); if (!btn || !srv) return;
    const on = Boolean(srv.inbox);
    btn.disabled = false; btn.setAttribute('aria-pressed', String(on)); btn.querySelector('.dot').classList.toggle('on', on);
    sh.querySelector('#s-inbox-watch').hidden = !on;
    sh.querySelector('#s-inbox-state').textContent = on ? 'On: alerts, digests and look-aheads from your inbox watcher, in one list; Resolved and Not useful reach the watcher' : 'Off. Turn on to keep what Inbox Watch sends in one list, with a way to tell it when an alert was not useful';
  };
  sh.querySelector('#s-inbox-watch').onclick = () => inboxWatchSheet(); // 1.70
  sh.querySelector('#s-inbox').onclick = async e => {
    const btn = e.currentTarget; if (!srv) return; btn.disabled = true;
    try {
      srv = await api('/settings', { method: 'POST', body: JSON.stringify({ inbox: !srv.inbox }), signal: AbortSignal.timeout(8000) });
      window.pocketFeatures = { ...(window.pocketFeatures || {}), inbox: Boolean(srv.inbox) };
      paintInboxSetting(); toast(srv.inbox ? 'Inbox Watch is on' : 'Inbox Watch is off');
      if (!srv.inbox && readLocal('pc-rail-view', 'sessions') === 'inbox') writeLocal('pc-rail-view', 'sessions');
      document.querySelectorAll('.session-home, aside.rail').length && route();
    } catch (err) { toast('Could not save: ' + (err.message || 'error')); btn.disabled = false; }
  };
  // 1.36: Tasks, the same way.
  const paintTasksSetting = () => {
    const btn = sh.querySelector('#s-tasks'); if (!btn || !srv) return;
    const on = Boolean(srv.tasks);
    btn.disabled = false; btn.setAttribute('aria-pressed', String(on)); btn.querySelector('.dot').classList.toggle('on', on);
    sh.querySelector('#s-tasks-state').textContent = on ? 'On: to-dos with an optional date and the context of the conversation they came from, across your devices and agents' : 'Off. Turn on to keep to-dos here and from agent conversations, with dates and conversation context';
  };
  sh.querySelector('#s-tasks').onclick = async e => {
    const btn = e.currentTarget; if (!srv) return; btn.disabled = true;
    try {
      srv = await api('/settings', { method: 'POST', body: JSON.stringify({ tasks: !srv.tasks }), signal: AbortSignal.timeout(8000) });
      window.pocketFeatures = { ...(window.pocketFeatures || {}), tasks: Boolean(srv.tasks) };
      paintTasksSetting(); toast(srv.tasks ? 'Tasks is on' : 'Tasks is off');
      if (!srv.tasks && readLocal('pc-rail-view', 'sessions') === 'tasks') writeLocal('pc-rail-view', 'sessions');
      document.querySelectorAll('.session-home, aside.rail').length && route();
    } catch (err) { toast('Could not save: ' + (err.message || 'error')); btn.disabled = false; }
  };
  // 1.39: the Vault, the same way. 1.44: switching it on with no key yet makes one (and shows the recovery key);
  // a Vault whose key is missing here is restored from the recovery key, never recreated.
  const paintVaultSetting = () => {
    const btn = sh.querySelector('#s-vault'); if (!btn || !srv) return;
    const on = Boolean(srv.vault), ready = srv.vaultReady !== false, create = srv.vaultCanCreateKey === true, needsKey = srv.vaultNeedsKey === true;
    btn.disabled = !on && (needsKey || (!ready && !create)); btn.setAttribute('aria-pressed', String(on)); btn.querySelector('.dot').classList.toggle('on', on);
    sh.querySelector('#s-vault-state').textContent = needsKey ? "This Vault's key is missing on this server. Restore it from your recovery key."
      : on ? 'On: keys and passwords agents use by name in commands without seeing them. Every use is recorded'
      : create ? "Off. Turning it on creates this install's encryption key; you'll be shown a recovery key to save."
      : ready ? 'Off. Turn on to keep keys and passwords that agents use without seeing the value'
      : srv.vaultError && !/not set/i.test(srv.vaultError) ? 'Off. The Vault cannot be opened: ' + srv.vaultError
      : 'Off. Set POCKET_VAULT_KEY in .env (see the README) and restart to turn it on';
    sh.querySelector('#s-vault-restore-wrap').hidden = !needsKey;
    sh.querySelector('#s-vault-more').hidden = !on || needsKey;
    // 1.41: Agent access, how freely agents use secrets; items set to Vault default follow it.
    const access = VAULT_ACCESS.some(([v]) => v === srv.vaultAccess) ? srv.vaultAccess : 'once'; vaultAccess = access;
    sh.querySelector('#s-vault-access').value = access;
    sh.querySelector('#s-vault-access-note').textContent = VAULT_ACCESS.find(([v]) => v === access)[2];
    // 1.40: key mode (POCKET_VAULT_KEY opens it) or passphrase mode (held in memory; locked after a restart or idle).
    const pass = srv.vaultMode === 'passphrase', locked = pass && Boolean(srv.vaultLocked);
    sh.querySelector('#s-vault-mode').textContent = pass ? 'Protected by a passphrase' + (locked ? '. Locked now' : '') : 'Opened by the server key in .env';
    sh.querySelector('#s-vault-mode-note').textContent = !pass ? 'The key saved on this server opens the Vault whenever Pocket Code runs. Keep the recovery key in your password manager; rotating replaces it.'
      : locked ? 'Agents cannot use secrets until you unlock it. Unlock it to change the passphrase, export or import.'
      : 'Pocket holds the passphrase in memory only, so the Vault locks after a restart until you unlock it.';
    const show = { '#s-vault-setpass': !pass, '#s-vault-recovery': !pass, '#s-vault-rotate': !pass, '#s-vault-lock': pass && !locked, '#s-vault-unlock': locked, '#s-vault-changepass': pass && !locked, '#s-vault-removepass': pass && !locked, '#s-vault-autolock-wrap': pass, '#s-vault-autolock-note': pass };
    for (const [sel, v] of Object.entries(show)) sh.querySelector(sel).hidden = !v;
    sh.querySelector('#s-vault-autolock').value = String(VAULT_LOCK_CHOICES.some(([m]) => m === srv.vaultAutoLockMinutes) ? srv.vaultAutoLockMinutes : 0);
    sh.querySelector('#s-vault-export').disabled = sh.querySelector('#s-vault-import').disabled = locked;
    sh.querySelector('#s-vault-codex').textContent = on && srv.codexInstructionsOverridden ? "Codex's config.toml sets developer_instructions, so Codex conversations don't receive the Vault's rules. Claude Code conversations do." : '';
  };
  sh.querySelector('#s-vault').onclick = async e => {
    const btn = e.currentTarget; if (!srv) return; btn.disabled = true;
    try {
      // 1.44: the first switch-on answers with the new key once; it goes to the recovery sheet and is not kept in srv.
      const { recoveryKey, ...next } = await api('/settings', { method: 'POST', body: JSON.stringify({ vault: !srv.vault }), signal: AbortSignal.timeout(8000) });
      srv = next;
      window.pocketFeatures = { ...(window.pocketFeatures || {}), vault: Boolean(srv.vault) };
      paintVaultSetting(); toast(srv.vault ? 'Vault is on. Conversations get it from their next conversation process' : 'Vault is off');
      if (!srv.vault && readLocal('pc-rail-view', 'sessions') === 'vault') writeLocal('pc-rail-view', 'sessions');
      document.querySelectorAll('.session-home, aside.rail').length && route(); // closes Settings at once, so the sheet below opens on top
      if (recoveryKey) vaultRecoverySheet(recoveryKey);
    } catch (err) {
      if (err.code === 'vault_no_key') { srv = { ...srv, vaultReady: false }; paintVaultSetting(); }
      else if (err.code === 'vault_needs_key') { srv = { ...srv, vaultNeedsKey: true, vaultCanCreateKey: false }; paintVaultSetting(); }
      else btn.disabled = false;
      toast('Could not save: ' + (err.message || 'error'));
    }
  };
  sh.querySelector('#s-vault-access').onchange = async e => {
    const access = e.currentTarget.value, was = srv?.vaultAccess || 'once';
    sh.querySelector('#s-vault-access-note').textContent = VAULT_ACCESS.find(([v]) => v === access)[2]; // not disabled while saving: that would drop keyboard focus
    try {
      srv = await api('/settings', { method: 'POST', body: JSON.stringify({ vaultAccess: access }), signal: AbortSignal.timeout(8000) });
      vaultSetAccess(srv.vaultAccess || access); paintVaultSetting();
      toast('Agent access: ' + VAULT_ACCESS.find(([v]) => v === (srv.vaultAccess || access))[1]);
    } catch (err) { srv = { ...srv, vaultAccess: was }; paintVaultSetting(); if (err.message !== 'login') toast('Could not save: ' + (err.message || 'error')); }
  };
  // 1.42: Catch secrets in messages, install-wide; the server checks every message the same way.
  const paintSecretsSetting = () => {
    const btn = sh.querySelector('#s-secrets'); if (!btn || !srv) return;
    setSecretGuard(srv.secretGuard); const on = secretGuard.on;
    btn.disabled = false; btn.setAttribute('aria-pressed', String(on)); btn.querySelector('.dot').classList.toggle('on', on);
  };
  sh.querySelector('#s-secrets').onclick = async e => {
    const btn = e.currentTarget; if (!srv) return; btn.disabled = true;
    try {
      srv = await api('/settings', { method: 'POST', body: JSON.stringify({ secretGuard: srv.secretGuard === false }), signal: AbortSignal.timeout(8000) });
      paintSecretsSetting(); toast(srv.secretGuard === false ? 'Secrets in messages are no longer caught' : 'Secrets in messages are caught before they are sent');
    } catch (err) { if (err.message !== 'login') toast('Could not save: ' + (err.message || 'error')); btn.disabled = false; }
  };
  sh.querySelector('#s-vault-rotate').onclick = () => rotateVaultKey();
  sh.querySelector('#s-vault-recovery').onclick = () => vaultShowRecoveryKey();
  sh.querySelector('#s-vault-restore').onclick = () => vaultRestoreKeySheet();
  sh.querySelector('#s-vault-setpass').onclick = () => vaultPassphraseSheet(false);
  sh.querySelector('#s-vault-changepass').onclick = () => vaultPassphraseSheet(true);
  sh.querySelector('#s-vault-removepass').onclick = () => vaultRemovePassphraseSheet();
  sh.querySelector('#s-vault-unlock').onclick = () => vaultUnlockSheet();
  sh.querySelector('#s-vault-export').onclick = () => vaultExportSheet();
  sh.querySelector('#s-vault-import').onclick = () => vaultImportSheet();
  sh.querySelector('#s-vault-lock').onclick = async e => {
    const btn = e.currentTarget; btn.disabled = true;
    const ok = await vaultLockNow(); btn.disabled = false;
    if (!ok || !sh.isConnected) return;
    srv = { ...srv, vaultLocked: true }; paintVaultSetting(); sh.querySelector('#s-vault-unlock').focus();
  };
  sh.querySelector('#s-vault-autolock').onchange = async e => {
    const sel = e.currentTarget, minutes = Number(sel.value), was = srv?.vaultAutoLockMinutes || 0; sel.disabled = true;
    try {
      srv = await api('/settings', { method: 'POST', body: JSON.stringify({ vaultAutoLockMinutes: minutes }), signal: AbortSignal.timeout(8000) });
      vaultAutoLock = Number(srv.vaultAutoLockMinutes) || 0;
      toast(minutes ? 'The Vault locks after ' + VAULT_LOCK_CHOICES.find(([m]) => m === minutes)[1] + ' idle' : 'The Vault locks only after a restart');
    } catch (err) { sel.value = String(was); if (err.message !== 'login') toast('Could not save: ' + (err.message || 'error')); }
    finally { sel.disabled = false; }
  };
  const openDocSel = sh.querySelector('#s-documents-open'); openDocSel.value = readLocal('pc-documents-open', 'tab'); openDocSel.onchange = () => writeLocal('pc-documents-open', openDocSel.value);
  sh.querySelector('#s-title-model').onchange = e => saveTitles({ titleProvider: e.target.value });
  sh.querySelector('#s-away').onclick = () => { if (srv?.titles) saveTitles({ awaySummaries: srv.titles.awaySummaries === false }); };
  sh.querySelector('#s-live').onclick = () => { if (srv?.titles?.enabled) saveTitles({ liveTitles: srv.titles.live === false }); };
  const loadSettings = async () => {
    const btn = sh.querySelector('#s-sync'), retry = sh.querySelector('#s-sync-retry');
    btn.disabled = true; retry.hidden = true;
    try {
      srv = await api('/settings', {signal:AbortSignal.timeout(8000)});
      if (!sh.isConnected) return;
      paintTitles(); paintNotifySettings(); paintModelOffer(); paintContext(); paintTrusted(); paintRouter(); paintAccess(); paintProjectsSetting(); paintDocumentsSetting(); paintTasksSetting(); paintInboxSetting(); paintVaultSetting(); paintSecretsSetting(); paintFeaturesNote();
      btn.disabled = false; btn.setAttribute('aria-pressed', String(Boolean(srv.titleSync)));
      btn.querySelector('.dot').classList.toggle('on', Boolean(srv.titleSync));
      sh.querySelector('#s-sync-state').textContent = "Conversation names follow Claude Code's titles, and renames here show there too";
    } catch {
      if (sh.isConnected) { sh.querySelector('#s-sync-state').textContent = 'Could not load this setting.'; sh.querySelector('#s-titles-state').textContent = 'Could not load this setting.'; sh.querySelector('#s-context-note').textContent = 'Could not load this setting.'; sh.querySelector('#s-models-note').textContent = 'Could not load the model list.'; sh.querySelector('#s-trusted-note').textContent = 'Could not load the list.'; retry.hidden = false; }
    }
  };
  sh.querySelector('#s-sync-retry').onclick = loadSettings;
  sh.querySelector('#s-sync').onclick = async e => {
    const btn = e.currentTarget; if (!srv) return; btn.disabled = true;
    try {
      srv = await api('/settings', { method: 'POST', body: JSON.stringify({ titleSync: !srv.titleSync }), signal:AbortSignal.timeout(8000) });
      if (!sh.isConnected) return;
      btn.querySelector('.dot').classList.toggle('on', Boolean(srv.titleSync)); btn.setAttribute('aria-pressed', String(Boolean(srv.titleSync)));
      toast(srv.titleSync ? 'Conversation names now sync with code-server' : 'Name sync off. Pocket names stay local');
    } catch (err) { toast('Could not save: ' + err.message); }
    finally { btn.disabled = false; }
  };
  const checkVersion = async () => {
    const check = sh.querySelector('#s-check'), status = sh.querySelector('#s-version-state'), refresh = sh.querySelector('#s-refresh');
    check.disabled = true; status.textContent = 'Checking for updates…'; refresh.hidden = true;
    const [about, release] = await Promise.allSettled([
      api('/about', {signal:AbortSignal.timeout(8000)}),
      fetch('/release.json?v=' + APP_V, {signal:AbortSignal.timeout(8000),cache:'no-store'}).then(r => {if (!r.ok) throw Error('release unavailable');return r.json();}),
    ]);
    if (!sh.isConnected) return;
    const a = about.status === 'fulfilled' && about.value && typeof about.value === 'object' ? about.value : {};
    const client = release.status === 'fulfilled' && release.value?.assetV === APP_V ? release.value : null;
    if (client) appRelease = client;
    sh.querySelector('#s-about-version').textContent = appVersionLabel().replace('Pocket Code ', '');
    const notes = client?.notes || a.notes;
    const up = a.uptime ? (a.uptime > 5400 ? Math.round(a.uptime / 3600) + 'h' : Math.round(a.uptime / 60) + 'm') : '?';
    sh.querySelector('#s-version-info').innerHTML = `
      <div class="arow"><span>App</span><b>${esc(client?.version || 'Pocket Code')} · build ${APP_V ?? '?'}</b></div>
      <div class="arow"><span>Server</span><b>build ${a.assetV ?? '?'} · ${esc(a.commit || '?')}</b></div>
      <div class="arow"><span>Claude CLI</span><b>${esc(a.cli || '?')}</b></div>
      <div class="arow"><span>Codex CLI</span><b>${esc(a.codex || '?')}</b></div>
      <div class="arow"><span>Box</span><b>${esc(a.host || '?')} · up ${up}</b></div>`;
    const checked = about.status === 'fulfilled' && Number.isFinite(a.assetV) && a.assetV > 0;
    const newer = Math.max(checked ? a.assetV : 0, release.status === 'fulfilled' ? Number(release.value?.assetV) || 0 : 0);
    status.textContent = !checked ? 'Could not check for updates. Try again.' : newer > APP_V ? 'An update is available.' : a.assetV < APP_V ? 'This browser is newer than the server. Server update pending.' : 'Up to date';
    if (newer > APP_V) { refresh.hidden = false; refresh.textContent = 'Update available: refresh to build ' + newer; }
    const serverBuild = checked && a.assetV !== APP_V ? ` (server build ${a.assetV}${a.commit ? ' · ' + a.commit : ''})` : '';
    const versionLabel = `${client?.version || 'Pocket Code'} / build ${APP_V ?? '?'}${serverBuild}`;
    sh.querySelector('#s-report-bug').href = issueUrl('bug_report', versionLabel);
    sh.querySelector('#s-request-feature').href = issueUrl('feature_request', versionLabel);
    sh.querySelector('#s-notes-body').innerHTML = Array.isArray(notes) && notes.length ? '<ul>' + notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '<p>Release notes are unavailable. Check again to retry.</p>';
    check.disabled = false;
  };
  sh.querySelector('#s-cli-updates').onclick = () => openCliUpdates();
  sh.querySelector('#s-check').onclick = checkVersion;
  sh.querySelector('#s-refresh').onclick = hardRefresh;
  // The sheet is already usable; these independent services update only their own rows.
  refreshPush(); loadSettings(); checkVersion();
}

/* ---------- sessions list ---------- */
let serverSkew = 0; // server clock minus this browser's: cache countdowns run on the server's time (1.28)
let allSessions = [], sessionFilter = 'all', sessionQuery = '', sessionCheckedAt = 0, sessionWarnings = [], sessionsStale = false;
let sessionFetch = null;
let sessionProofReceivedAt=0,sessionProofReceivedWallAt=0;
// Reviewed markers: the newest reply or failure time you opened or marked reviewed. The server keeps them so
// every device agrees; this browser keeps a copy so the list is right before the server answers or offline.
// Unsent changes wait in seenPending (only moves forward) and seenRestore (Undo, exact) until a save succeeds.
const serverSeen = new Map(), seenPending = new Map(), seenRestore = new Map();
let seenFlushT = null, seenFlushing = null, seenFlushAgain = false;
const localSeen = id => { try { return Number(localStorage.getItem('pc-seen-' + id)) || 0; } catch { return 0; } };
const seenAt = id => Math.max(localSeen(id), serverSeen.get(id) || 0);
function setSeen(id, at) {
  if (!at || at <= seenAt(id)) return;
  try { localStorage.setItem('pc-seen-' + id, String(at)); } catch { }
  seenRestore.delete(id); seenPending.set(id, at); clearTimeout(seenFlushT); seenFlushT = setTimeout(flushSeen, 250);
}
async function flushSeen() {
  if (seenFlushing) { seenFlushAgain = true; return seenFlushing; }
  if (!seenPending.size && !seenRestore.size) return;
  const seen = Object.fromEntries(seenPending), restore = Object.fromEntries(seenRestore);
  seenFlushing = (async () => {
    try {
      const r = await api('/seen', { method: 'POST', body: JSON.stringify({ seen, restore }) });
      for (const [id, at] of Object.entries(seen)) if (seenPending.get(id) === at) seenPending.delete(id);
      for (const [id, at] of Object.entries(restore)) if (seenRestore.get(id) === at) seenRestore.delete(id);
      for (const [id, at] of Object.entries(r.seen || {})) if (!seenRestore.has(id)) serverSeen.set(id, at);
    } catch { } // kept for the next session refresh
    finally {
      seenFlushing = null;
      if (seenFlushAgain) { seenFlushAgain = false; setTimeout(flushSeen, 0); }
    }
  })();
  return seenFlushing;
}
// Take the server's markers, and send up any this browser has that the server lacks (including markers
// saved before they were shared), so a reply opened here is cleared everywhere.
function syncSeen() {
  for (const s of allSessions) {
    if (seenRestore.has(s.id)) continue;
    serverSeen.set(s.id, s.seenAt || 0);
    const mine = localSeen(s.id);
    if (mine > (s.seenAt || 0) && !seenPending.has(s.id)) seenPending.set(s.id, mine);
  }
  flushSeen();
}
const needsAttention = s => s.state?.kind === 'input' || s.state?.kind === 'failed' && (s.state.at || 0) > seenAt(s.id);
const isUnread = s => s.state?.kind === 'finished' && (s.state.at || 0) > seenAt(s.id);
// The Attention filter and count: anything waiting on you, including a finished reply (Response ready) you
// have not opened yet. Grouping and voice keep needsAttention, which means a question, approval or failure.
const inAttention = s => needsAttention(s) || isUnread(s);
// Mark reviewed clears a Response ready reply or a failed turn without opening it, on every device, exactly
// as opening would. Questions and approvals stay until they are answered.
const canMarkReviewed = s => isUnread(s) || s.state?.kind === 'failed' && (s.state.at || 0) > seenAt(s.id);
function markReviewed(list) {
  const prior = [];
  for (const s of list.filter(canMarkReviewed)) {
    let mine = null; try { mine = localStorage.getItem('pc-seen-' + s.id); } catch { }
    prior.push([s.id, mine, serverSeen.get(s.id) || 0]); setSeen(s.id, s.state.at);
  }
  return prior;
}
function restoreReviewed(prior) {
  for (const [id, mine, server] of prior) {
    try { mine === null ? localStorage.removeItem('pc-seen-' + id) : localStorage.setItem('pc-seen-' + id, mine); } catch { }
    seenPending.delete(id); seenRestore.set(id, server); serverSeen.set(id, server);
  }
  flushSeen();
}
// After Mark all reviewed, the bar offers Undo for a short while instead of the action.
let reviewUndo = null, reviewUndoT = null;
// A reply that finishes while its conversation is already on screen counts as read only after you engage
// with the page (tap, click, type, scroll, return to the tab or navigate). Voice mode keeps the screen awake
// while you wait for a spoken reply, so a visible page alone no longer proves you saw it.
const awaitingEngagement = new Set();
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, () => awaitingEngagement.clear(), { capture: true, passive: true });
addEventListener('hashchange', () => awaitingEngagement.clear());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') awaitingEngagement.clear(); });
function markRead(id, state) { if (document.visibilityState === 'visible' && state?.at && !awaitingEngagement.has(id)) setSeen(id, state.at); }
function rowState(s) { return s.state || { kind: s.active ? 'observed' : 'idle', label: s.active ? 'Activity elsewhere' : 'Recent' }; }
// The list announces a finished reply only until it has been opened; afterwards it is an ordinary recent session.
function listState(s) { const state = rowState(s); return state.kind === 'finished' && !isUnread(s) ? { ...state, kind: 'idle', label: 'Recent' } : state; }
function sessionCounts() {
  if(sessionsStale)return {running:0,background:0,input:0,observed:0,attention:allSessions.filter(inAttention).length,fresh:allSessions.filter(isUnread).length};
  return { running: allSessions.filter(s => rowState(s).kind === 'running').length,
    background: allSessions.filter(s => rowState(s).kind === 'background').length,
    input:allSessions.filter(s=>rowState(s).kind==='input').length,
    observed: allSessions.filter(s => rowState(s).kind === 'observed').length,
    attention: allSessions.filter(inAttention).length,
    fresh: allSessions.filter(isUnread).length };
}
function sessionSummary() {
  if (sessionsStale) return 'Status unavailable. Showing the last saved list.';
  if (!sessionCheckedAt) return 'Checking your conversations…';
  const c = sessionCounts();
  return [c.running ? `${c.running} running` : 'Nothing running', c.background ? `${c.background} in background` : '', c.observed ? `${c.observed} with activity elsewhere` : '', c.attention ? `${c.attention} ${c.attention === 1 ? 'needs' : 'need'} attention` : ''].filter(Boolean).join(' · ');
}
function filterButtons(keys) {
  const c = sessionCounts();
  return [['all','All',null],['active','Active',c.running+c.background+c.observed+c.input],['attention','Attention',c.attention],['new','New',c.fresh],['pinned','Pinned',null],['hidden','Hidden',null]].filter(([key]) => !keys || keys.includes(key)).map(([key,label,count]) =>
    `<button type="button" data-filter="${key}" aria-pressed="${sessionFilter === key}">${label}${count ? `<span>${count}</span>` : ''}</button>`).join('');
}
function filteredSessions() {
  const needle = sessionQuery.trim().toLowerCase();
  return allSessions.filter(s => (!workspaceFilter||s.cwd===workspaceFilter)&&(!providerFilter||s.provider===providerFilter)&&(sessionFilter==='hidden'?isHiddenSession(s):!isHiddenSession(s))&&(!needle || (s.title + ' ' + (s.cwd || '')).toLowerCase().includes(needle)) &&
    (sessionFilter === 'all' || sessionFilter === 'active' && ['running','background','observed','input'].includes(rowState(s).kind) ||
     sessionFilter === 'attention' && inAttention(s) || sessionFilter === 'new' && isUnread(s) || sessionFilter==='pinned'&&s.pinned || sessionFilter==='hidden'));
}
function sessionRowHTML(s) {
  const state = listState(s), running = state.kind === 'running', background = state.kind === 'background';
  const detail = running && state.startedAt ? `Started ${rel(state.startedAt)}`
    : background ? (state.background?.jobs?.[0]?.description ? `Background: ${state.background.jobs[0].description}` : 'Background work still running')
    : state.kind === 'observed' ? 'Recent transcript activity; run status unconfirmed'
    : state.kind === 'waiting' && state.retryAt ? `Retry at ${new Date(state.retryAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}` : `Updated ${rel(s.mtimeMs)}`;
  return `<div class="session-item ${s.id === chatId ? 'cur' : ''} ${s.pinned ? 'pinned' : ''}" data-item="${esc(s.id)}">
    <button class="row" data-id="${esc(s.id)}">
      <span class="body"><span class="title">${esc(s.title)}</span>
      <span class="meta">${s.cwd && s.cwd !== sessionsHome ? esc(projName(s.cwd)) + ' · ' : ''}${s.provider === 'codex' ? 'Codex' : s.provider === 'acp' ? 'OpenRouter' : 'Claude'}${s.branchOf ? ' · Branch' : ''}</span>
      <span class="session-status state-${sessionsStale ? 'unknown' : state.kind}">${running && !sessionsStale ? '<span class="ember" aria-hidden="true"></span>' : background && !sessionsStale ? '<span class="ember dim" aria-hidden="true"></span>' : ''}${sessionsStale ? 'Status unavailable' : esc(state.label)}${isUnread(s) ? '<span class="unread">New</span>' : ''}${running && state.queued ? ` · ${state.queued} queued` : ''}</span>
      <span class="activity-detail">${esc(detail)}${running?' · <span data-run-age></span>':''}</span></span>
    </button><button class="pin-toggle" type="button" data-pin-toggle="${esc(s.id)}" aria-pressed="${s.pinned ? 'true' : 'false'}" aria-label="${s.pinned ? 'Unpin' : 'Pin'} ${esc(s.title)}" title="${s.pinned ? 'Unpin' : 'Pin to the top'}">${IC.pin}</button>${s.pinned ? `<button class="pin-grip" type="button" data-grip="${esc(s.id)}" aria-label="Reorder pinned conversation ${esc(s.title)}: drag it, or press the up and down arrow keys">${IC.grip}</button>` : ''}<button class="session-more icon" data-more="${esc(s.id)}" aria-label="Options for ${esc(s.title)}">${IC.more}</button>
  </div>`;
}
/* ---------- pinned order: drag a pin's grip, press its arrow keys, or use Move up/down in Session options.
   Saved on the server, so every device (and the desktop tabs) share one order. ---------- */
let pinDragging = false;
const pinnedIds = () => allSessions.filter(s => s.pinned).map(s => s.id);
async function setPinOrder(ids, announce) {
  const rank = new Map(ids.map((id, i) => [id, i]));
  const key = s => s.pinned ? (rank.has(s.id) ? rank.get(s.id) : 1e9) : 1e10;
  allSessions = [...allSessions].sort((a, b) => key(a) - key(b));           // optimistic: the list and tabs move at once
  allSessions.forEach(s => { if (rank.has(s.id)) s.pinOrder = rank.get(s.id); });
  paintSessionPanels();
  if (announce) toast(announce);
  try { await api('/pins/order', { method: 'POST', body: JSON.stringify({ ids }) }); }
  catch (e) { toast('Could not save the pin order: ' + (e.message || 'error')); refreshSessions(); }
}
function movePin(id, delta) {
  const ids = pinnedIds(), i = ids.indexOf(id), j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return false;
  ids.splice(i, 1); ids.splice(j, 0, id);
  setPinOrder(ids, `Pinned ${j + 1} of ${ids.length}`);
  return true;
}
function placePin(id, targetId, after) {
  const ids = pinnedIds().filter(x => x !== id), j = ids.indexOf(targetId);
  if (j < 0 || !pinnedIds().includes(id)) return;
  ids.splice(j + (after ? 1 : 0), 0, id);
  setPinOrder(ids);
}
function bindPinDrag(container) {
  const clear = () => container.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  container.querySelectorAll('[data-grip]').forEach(grip => {
    const id = grip.dataset.grip, item = grip.closest('.session-item');
    grip.onkeydown = e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      movePin(id, e.key === 'ArrowUp' ? -1 : 1);                 // the repaint keeps focus on this grip
    };
    grip.onpointerdown = e => {
      if (e.button) return;
      e.preventDefault(); grip.setPointerCapture(e.pointerId);
      let target = null, after = false;
      pinDragging = true; item.classList.add('dragging');
      grip.onpointermove = ev => {
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.session-item.pinned');
        clear(); target = null;
        if (!over || over === item || !container.contains(over)) return;
        const r = over.getBoundingClientRect(); after = ev.clientY > r.top + r.height / 2;
        target = over; over.classList.add(after ? 'drop-after' : 'drop-before');
      };
      grip.onpointerup = grip.onpointercancel = ev => {
        grip.onpointermove = grip.onpointerup = grip.onpointercancel = null;
        pinDragging = false; item.classList.remove('dragging'); clear();
        if (ev.type === 'pointerup' && target) placePin(id, target.dataset.item, after); else paintSessionPanels();
      };
    };
  });
}
// 1.94 (Damon): the row's pin button and Conversation options share one toggle.
async function togglePin(s, refresh) {
  try {
    const r = await api(`/session/${s.id}/pin`, { method: 'POST', body: JSON.stringify({ pinned: !s.pinned }) });
    toast(r.pinned ? 'Pinned to the top' : 'Unpinned');
    refresh?.(r);
  } catch (e) { toast('Pin failed: ' + e.message); }
}
function bindSessionRows(container) {
  bindPinDrag(container);
  container.querySelector('[data-automated]')?.addEventListener('toggle', e => writeLocal('pc-automated-open', e.target.open));
  container.querySelectorAll('[data-id]').forEach(row => {
    row.onclick = () => { closeCurrentSheet?.(); location.hash = '#/chat/' + row.dataset.id; };
    const session = allSessions.find(s => s.id === row.dataset.id);
    wireRowMenu(row, () => session, refreshSessions);
  });
  container.querySelectorAll('[data-pin-toggle]').forEach(b => b.onclick = () => {
    const session = allSessions.find(s => s.id === b.dataset.pinToggle);
    if (session) togglePin(session, refreshSessions);
  });
  container.querySelectorAll('[data-more]').forEach(b => b.onclick = () => {
    const session = allSessions.find(s => s.id === b.dataset.more);
    if (session) { closeCurrentSheet?.(); sessionSheet(session, refreshSessions); }
  });
  container.querySelector('[data-mark-all-reviewed]')?.addEventListener('click', () => {
    const prior = markReviewed(filteredSessions());
    clearTimeout(reviewUndoT); reviewUndo = prior.length ? prior : null;
    reviewUndoT = setTimeout(() => { reviewUndo = null; paintSessionPanels(); }, 10000);
    paintSessionPanels(); document.querySelector('[data-undo-reviewed]')?.focus({preventScroll:true});
  });
  container.querySelector('[data-undo-reviewed]')?.addEventListener('click', () => {
    clearTimeout(reviewUndoT); if (reviewUndo) restoreReviewed(reviewUndo); reviewUndo = null; paintSessionPanels();
  });
}
// Shown in Attention and New: clears every listed reply or failure at once, then offers Undo.
function reviewBarHTML(list) {
  if (sessionsStale || !['attention','new'].includes(sessionFilter)) return '';
  if (reviewUndo) return `<div class="review-bar"><span role="status">Marked ${reviewUndo.length} as reviewed</span><button type="button" class="chip" data-undo-reviewed>Undo</button></div>`;
  const n = list.filter(canMarkReviewed).length;
  return n ? `<div class="review-bar"><span>${n} not reviewed yet</span><button type="button" class="chip" data-mark-all-reviewed>${IC.tick}Mark all reviewed</button></div>` : '';
}
// 1.19: scheduled runs (the server marks them automated) that need nothing from you sit in one collapsed group
// at the end of All, so the sessions you started lead the list. Search, filters, pins and attention show them normally.
const isQuietAutomated = s => s.automated && !s.pinned && !['running','background','observed','waiting','input'].includes(rowState(s).kind) && !needsAttention(s);
function groupedSessionsHTML(all) {
  const grouping = sessionFilter === 'all' && !sessionQuery.trim() && !sessionsStale;
  const automated = grouping ? all.filter(isQuietAutomated) : [];
  const list = automated.length ? all.filter(s => !isQuietAutomated(s)) : all;
  const groups = [['running','Running'],['background','Working in background'],['observed','Activity elsewhere'],['failed','Needs attention'],['waiting','Waiting'],['recent','Recent']];
  // 1.22: while a search also looks inside conversations, an empty title match is one quiet line, not a big empty state.
  if (!all.length && sessionQuery.trim().length >= 3 && !sessionsStale && !workspaceFilter && !providerFilter && sessionFilter === 'all')
    return `<p class="convo-note title-empty">No conversation titles match. Matches inside conversations are below.</p>`;
  if (!all.length) return `<div class="empty">${sessionsStale ? 'Could not load conversations. Use Refresh to try again.' : sessionQuery || workspaceFilter || providerFilter || ['pinned','hidden'].includes(sessionFilter) ? 'No conversations match these filters.' : sessionFilter === 'active' ? 'No runs or recent external activity.' : sessionFilter === 'attention' ? 'Nothing needs your attention.' : sessionFilter === 'new' ? 'No new recorded responses.' : 'No conversations yet. Start a conversation to begin.'}</div>`;
  if(sessionsStale)return `<section class="session-group"><h2>Status unconfirmed<span>${list.length}</span></h2>${list.map(sessionRowHTML).join('')}</section>`;
  return groups.map(([key,label]) => {
    const rows = list.filter(s => key === 'recent' ? !['running','background','observed','waiting','input'].includes(rowState(s).kind) && !needsAttention(s) : key === 'failed' ? needsAttention(s) : rowState(s).kind === key);
    // Pinned sessions first inside each group, then an accent-coloured rule before the rest.
    const pinned = rows.filter(s => s.pinned), rest = rows.filter(s => !s.pinned);
    const body = pinned.map(sessionRowHTML).join('') + (pinned.length && rest.length ? '<div class="pin-divider" role="separator" aria-label="Pinned conversations above, others below"></div>' : '') + rest.map(sessionRowHTML).join('');
    return rows.length ? `<section class="session-group"><h2>${label}<span>${rows.length}</span></h2>${body}</section>` : '';
  }).join('') + (automated.length ? `<details class="session-group automated-group" data-automated${readLocal('pc-automated-open', false) ? ' open' : ''}><summary><h2>Automated<span>${automated.length}</span></h2><span class="automated-note">Scheduled runs</span></summary>${automated.map(sessionRowHTML).join('')}</details>` : '');
}
/* ---------- 1.60: Assistant mode home ----------
   The message box first, then what needs the person ("Waiting for you": a question or approval, or a reply that
   didn't finish), then the five latest conversations and the way to the rest. On a wide screen with the
   conversation list open beside it, Recent is left to that list. */
function assistantIntroHTML() {
  if (readLocal('pc-assistant-intro', false)) return '';
  const asks = nextApprovalMode(getPrefs(NEW_KEY)) === 'review'; // only promise what Review actions does
  return `<section class="assistant-intro" id="assistant-intro" aria-label="Getting started"><p>Start with a button below, or just type what you need.${asks ? ' I’ll ask before I send, save or change anything.' : ''}</p><button class="chip" id="assistant-intro-ok">Got it</button></section>`;
}
function bindAssistantIntro() {
  const b = $('#assistant-intro-ok'); if (!b) return;
  b.onclick = () => { writeLocal('pc-assistant-intro', true); $('#assistant-intro')?.remove(); $('#first')?.focus(); };
}
function homeRowHTML(s) {
  const st = listState(s), kind = st.kind === 'input' ? 'input' : st.kind === 'running' || st.kind === 'observed' ? 'running' : st.kind === 'failed' ? 'failed' : isUnread(s) ? 'ready' : 'idle';
  const label = { input: 'Needs you', running: 'Working', failed: 'Didn’t finish', ready: 'Ready', idle: '' }[kind];
  return `<a class="home-row state-${kind}" href="#/chat/${esc(s.id)}"><span class="home-dot" aria-hidden="true"></span><span class="home-title">${esc(s.title || 'Untitled conversation')}</span><span class="home-when">${label ? `<span class="home-state">${esc(label)}</span> · ` : ''}${esc(rel(s.mtimeMs))}</span></a>`;
}
function paintAssistantHome() {
  const waiting = $('#home-waiting'), recent = $('#home-recent');
  if (!waiting && !recent) return;
  const rows = (allSessions || []).filter(s => !isHiddenSession(s));
  if (waiting) {
    const need = rows.filter(needsAttention).slice(0, 4);
    const inboxCards = typeof inboxWaitingCards === 'function' ? inboxWaitingCards() : []; // 1.69: a new Inbox Watch alert waits here too
    waiting.hidden = !need.length && !inboxCards.length;
    waiting.innerHTML = need.length || inboxCards.length ? `<h2 class="home-h" id="home-waiting-h">Waiting for you</h2>${inboxCards.join('')}${need.map(s => {
      const q = rowState(s).kind === 'input';
      return `<a class="home-card" href="#/chat/${esc(s.id)}"><span class="home-card-title">${esc(s.title || 'Untitled conversation')}</span><span class="home-card-what">${q ? esc(rowState(s).label || 'Needs your answer or OK') : 'Didn’t finish. Open to see what happened'}</span></a>`;
    }).join('')}` : '';
  }
  if (recent) {
    const beside = isWide() && railOpen() && !SOLO;
    const latest = rows.slice().sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0)).slice(0, 5);
    const links = [documentsOn() ? '<a class="chip" href="#/documents">Files</a>' : '', tasksOn() ? '<a class="chip" href="#/tasks">Tasks</a>' : '', projectsOn() ? '<a class="chip" href="#/projects">Projects</a>' : '', vaultOn() ? '<a class="chip" href="#/vault">Vault</a>' : '', inboxOn() ? '<a class="chip" href="#/inbox" data-inbox-home>Inbox</a>' : ''].join('');
    recent.innerHTML = (beside || !latest.length ? '' : `<h2 class="home-h" id="home-recent-h">Recent</h2><div class="home-list">${latest.map(homeRowHTML).join('')}</div><a class="home-all" href="#/all">See all conversations</a>`)
      + (links ? `<nav class="home-links" aria-label="Your things">${links}</nav>` : '');
    if (beside || !latest.length) { recent.removeAttribute('aria-labelledby'); recent.setAttribute('aria-label', 'Your things'); recent.hidden = !links; }
    else { recent.removeAttribute('aria-label'); recent.setAttribute('aria-labelledby', 'home-recent-h'); recent.hidden = false; }
  }
}
function paintSessionPanels() {
  paintAssistantHome();
  paintWorkspaceFilters();
  paintWorkspaceDensity();
  document.querySelectorAll('[data-session-summary]').forEach(el => { el.textContent = sessionSummary(); });
  document.querySelectorAll('[data-session-filters]').forEach(el => {
    const focused = el.contains(document.activeElement) ? document.activeElement.dataset.filter : null;
    el.innerHTML = filterButtons(el.dataset.filterKeys?.split(' '));
    el.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { sessionFilter = b.dataset.filter; paintSessionPanels(); el.querySelector(`[data-filter="${sessionFilter}"]`)?.focus(); });
    if (focused) el.querySelector(`[data-filter="${focused}"]`)?.focus({preventScroll:true});
  });
  document.querySelectorAll('[data-session-results]').forEach(el => {
    if (pinDragging) return;                                   // a background refresh must not pull the row out from under the pointer
    const focus = el.contains(document.activeElement) ? document.activeElement?.dataset : null;
    const id = focus?.id, more = focus?.more, grip = focus?.grip, pin = focus?.pinToggle;
    const list = filteredSessions();
    el.innerHTML = reviewBarHTML(list) + groupedSessionsHTML(list); bindSessionRows(el);
    if (id || more || grip || pin) el.querySelector(`[${grip ? 'data-grip' : pin ? 'data-pin-toggle' : more ? 'data-more' : 'data-id'}="${CSS.escape(grip || pin || more || id)}"]`)?.focus({preventScroll:true});
  });
  document.querySelectorAll('[data-session-warning]').forEach(el => { el.textContent = sessionWarnings.join(' '); el.hidden = !sessionWarnings.length; });
  const current = allSessions.find(s => s.id === chatId);
  const qb=$('#questions-open');if(qb){qb.hidden=!current?.state?.questions;if(!qb.hidden&&!qb.querySelector('.wb-cta'))paintWaitBanner(qb,{title:(ENGINE_LABELS[providerOf(chatId)])+' is waiting for your answer',note:current.state.label==='Needs your answer'?'The reply is paused until you answer.':'',cta:'Answer'});} // refreshQuestions fills in the count
  const ab=$('#approvals-open');if(ab){ab.hidden=!current?.state?.approvals;if(current?.state?.approvals&&!ab.querySelector('.wb-cta'))paintWaitBanner(ab,{title:current.state.label||'Action needs approval',note:current.state.label==='Needs approval'?'The reply is paused until you allow or deny it.':'',cta:'Review',mark:IC.info});} // refreshApprovals paints the request itself
  if(typeof paintAgents==='function')paintAgents(); // 1.82: the row under the controls also reports background jobs
  if (current && $('#chat-statebar') && !sessionsStale) markRead(chatId, current.state); // 1.35: the header's run status names the state; no second copy
  const queueButton=$('#queue-open');if(queueButton)queueButton.textContent='Queue'+(current?.state?.queued?' ('+current.state.queued+')':'');
  if(current?.state?.confirmed&&['finished','failed','stopped','ended'].includes(current.state.kind)&&!sessionsStale&&!loadOutbox(chatId)){deliveryNotices.delete(chatId);paintDelivery(chatId);}
  paintSessionFilterSummaries();
  paintRunConfirmation();
  const quick = $('#session-switch');
  if (quick) { const c = sessionCounts(); quick.textContent = sessionsStale ? 'Conversations · status unavailable' : `Conversations · ${c.running} running${c.background ? ` · ${c.background} in background` : ''}${c.observed ? ` · ${c.observed} elsewhere` : ''}`; }
  if (typeof paintOpenSessions === 'function') paintOpenSessions(); // tabs show pins and follow the pinned order
}
// 1.19: send the last list's ETag; an unchanged list comes back as 304 with the server's check time in a
// header, which proves a fresh authenticated check just as a full response does.
let sessionsEtag = '', sessionsHome = ''; // 1.20.1: rows in the default workspace show only the agent
async function fetchSessionList() {
  const r = await fetch('/api/sessions?limit=200&statusCheck=' + Date.now(), { cache: 'no-store', signal: AbortSignal.timeout(8000),
    headers: sessionsEtag && allSessions.length ? { 'if-none-match': sessionsEtag } : {} });
  if (r.status === 401) { sessionsEtag = ''; renderLogin(); throw new Error('login'); }
  if (r.status === 304) return { sessions: allSessions, warnings: sessionWarnings, home: sessionsHome, checkedAt: Number(r.headers.get('x-pocket-checked-at')) };
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { sessionsEtag = ''; throw new Error(j.error || r.statusText); }
  sessionsEtag = r.headers.get('etag') || '';
  return j;
}
// 1.29.1: a title updated on the server (living titles, or a rename from another device) reaches the open
// conversation's header on the next list refresh instead of waiting for a reload.
function followChatTitle() {
  if (!chatId) return;
  const row = allSessions.find(s => s.id === chatId);
  if (!row?.title || row.title === chatTitle) return;
  chatTitle = row.title;
  const t = $('#ctitle'); if (t) { t.textContent = row.title; t.title = row.title; }
}
async function refreshSessions() {
  if (sessionFetch) return sessionFetch;
  sessionFetch = (async () => {
    try { const d = await fetchSessionList(); allSessions = d.sessions; sessionsHome = d.home || ''; sessionWarnings = d.warnings || []; if(!Number.isFinite(d.checkedAt)||d.checkedAt<=0||d.checkedAt<=sessionCheckedAt)throw new Error('No fresh server confirmation');sessionCheckedAt = d.checkedAt;serverSkew = d.checkedAt - Date.now();sessionProofReceivedAt=performance.now();sessionProofReceivedWallAt=Date.now(); sessionsStale = false; syncSeen(); const current = allSessions.find(s => s.id === chatId); if (current) markRead(chatId, current.state); }
    catch { sessionsStale = true; }
    finally { sessionFetch = null; paintSessionPanels(); followChatTitle(); if (!sessionsStale) Voice.onSessions(allSessions); }
  })();
  return sessionFetch;
}
// This timestamp advances ONLY on a fresh authenticated server status response.
// Local animation, SSE keepalives and transcript activity never prove an owned run.
// 1.19: the check age moves in steps (just now, 10s, 20s… then minutes), so a healthy 5-second poll never
// changes the text; only a check that is getting old visibly counts up.
function checkAge(s){return s<10?'just now':s<60?Math.floor(s/10)*10+'s ago':Math.floor(s/60)+'m ago';}
function paintRunConfirmation(){
 const elapsed=sessionProofReceivedAt?Math.max(0,Math.floor(Math.max(performance.now()-sessionProofReceivedAt,Date.now()-sessionProofReceivedWallAt)/1000)):null;
 const fresh=!sessionsStale&&elapsed!==null&&elapsed<=15;
 const current=allSessions.find(s=>s.id===chatId),state=current?.state;
 const box=document.getElementById('run-confirmation');
 const name=document.getElementById('run-confirmed-state'),stamp=document.getElementById('run-confirmed-at');
 if(box&&name&&stamp){
  let label='Checking server…',kind='unknown';
  if(!fresh&&sessionProofReceivedAt)label='Status unconfirmed. Reconnecting…';
  else if(!fresh&&sessionsStale)label='Status unavailable';
  else if(fresh){
   if(state?.kind==='running'&&state.confirmed===true){label='Running on server';kind='running';}
   else if(state?.kind==='running'||state?.kind==='observed'){label='Activity seen. Run unconfirmed';}
   else if(state?.confirmed===true){label=state.label;kind=state.kind;}
   else {label='No active run here';kind='idle';}
  }
  // 1.19: in the title bar (phones, collapsed header) the same states use short words; the tooltip keeps the detail.
  if(box.closest('header'))label=kind==='background'?'Background':{'No active run here':'Idle','Running on server':'Running','Activity seen. Run unconfirmed':'Activity seen','Status unconfirmed. Reconnecting…':'Unconfirmed','Checking server…':'Checking…'}[label]||label;
  if(name.textContent!==label)name.textContent=label;
  box.dataset.state=kind;
  const stampText=elapsed===null?'':(fresh?'Checked ':'Last check ')+checkAge(elapsed);if(stamp.textContent!==stampText)stamp.textContent=stampText;
  box.title=sessionCheckedAt?'Server confirmation: '+new Date(sessionCheckedAt).toLocaleTimeString()+'. '+(state?.startedAt?'Started: '+new Date(state.startedAt).toLocaleTimeString()+'. ':'')+'Checks every 5 seconds. Running means the server owns an active reply; it does not guarantee continuous output.'+(state?.kind==='background'&&state.background?.jobs?.length?' Background: '+state.background.jobs.map(j=>j.description||j.kind).join('; ')+'.':''):'';
 }
 // 1.64: background work shows the dimmer ember in the title bar while the composer is free.
 const headerLamp=document.getElementById('hember'),inBackground=fresh&&state?.kind==='background'&&state.confirmed===true;
 if(headerLamp){headerLamp.hidden=!(fresh&&state?.kind==='running'&&state.confirmed===true)&&!inBackground;
  if(!composerWorking){const dim=headerLamp.querySelector('.ember.dim');if(inBackground&&!dim)headerLamp.innerHTML='<span class="ember dim" aria-hidden="true"></span>';else if(!inBackground&&dim)headerLamp.innerHTML='';}}
 const workingLabel=document.getElementById('work-label');
 if(workingLabel){
  const label=!fresh?'Run status unconfirmed':state?.kind==='running'&&state.confirmed===true?'Working on server':state?.label||'No active run confirmed';
  if(workingLabel.textContent!==label)workingLabel.textContent=label;
  const lamp=workingLabel.parentElement.querySelector('.ember');if(lamp)lamp.hidden=!(fresh&&state?.kind==='running'&&state.confirmed===true);
 }
 document.querySelectorAll('[data-run-age]').forEach(el=>{const t=fresh?'confirmed '+checkAge(elapsed):'not currently confirmed';if(el.textContent!==t)el.textContent=t;});
 paintTurnFailure();
}
// 1.19: a failed last turn is shown where you are reading, at the end of the conversation, with its reason
// when known and a way to try again. It comes from the server's session state, so it survives a reload.
// The streamed result shows it at once; the server's state takes over when the next list check confirms it.
let liveFailure = null;
function paintTurnFailure(live) {
  const msgs = $('#msgs'); if (!msgs) return;
  if (live) liveFailure = { id: chatId, error: live.error, at: Date.now() };
  const st = allSessions.find(s => s.id === chatId)?.state;
  const lf = liveFailure?.id === chatId && !(st?.kind === 'running' && (st.startedAt || 0) > liveFailure.at) && !(st?.confirmed && ['finished','stopped'].includes(st.kind) && (st.at || 0) > liveFailure.at) ? liveFailure : null;
  const failed = lf || (!sessionsStale && st?.kind === 'failed' && st.confirmed === true);
  let el = document.getElementById('turn-failure');
  if (!failed || (composerWorking && !lf)) { el?.remove(); return; }
  const reason = String(lf?.error || st?.error || '').trim();
  const text = reason ? 'This reply ended with an error: ' + reason : 'This reply ended with an error.';
  if (!el) {
    msgs.insertAdjacentHTML('beforeend', `<div class="turn-failure" id="turn-failure"><p role="status"></p><div class="turn-failure-actions"><button class="chip" type="button" data-retry-turn>Send again</button><button class="chip" type="button" data-edit-turn>Edit message</button></div></div>`);
    el = msgs.lastElementChild;
    scrollBottom(); requestAnimationFrame(() => setTimeout(() => scrollBottom(), 250)); // in view if you were reading at the end, after the composer settles
    const lastUser = () => [...msgs.querySelectorAll('.m-user')].at(-1)?.textContent || '';
    // Never overwrite a draft you are typing: both actions ask you to send or clear it first.
    const draftInTheWay = () => { const box = $('#box'); if (box?.value.trim()) { toast('Your draft is in the message box. Send or clear it first.'); box.focus(); return true; } return false; };
    el.querySelector('[data-retry-turn]').onclick = () => { const t = lastUser(); if (t && !draftInTheWay()) { liveFailure = null; sendMsg(t); } };
    el.querySelector('[data-edit-turn]').onclick = () => { const box = $('#box'), t = lastUser(); if (box && t && !draftInTheWay()) { box.value = t; box.dispatchEvent(new Event('input', { bubbles: true })); box.focus(); } };
  } else if (el !== msgs.lastElementChild) msgs.append(el);
  const p = el.querySelector('p'); if (p.textContent !== text) p.textContent = text;
  el.querySelector('[data-retry-turn]').hidden = el.querySelector('[data-edit-turn]').hidden = !msgs.querySelector('.m-user');
}
function sessionPanelHTML(rail = false) {
  const summary = `<p class="session-summary" data-session-summary role="status">${esc(sessionSummary())}</p>`;
  const filters = `<div data-workspace-filters></div><nav class="session-filters" data-session-filters aria-label="Filter conversations">${filterButtons()}</nav>`;
  return `<div class="session-panel ${rail ? 'compact' : ''}">
    ${rail ? '' : summary}
    <div class="session-search">${IC.search}<input type="search" data-session-search aria-label="Search recent conversations" placeholder="Search recent conversations" value="${esc(sessionQuery)}" autocomplete="off"></div>
    ${rail ? `<div id="rail-filter-summary" class="rail-filter-summary" hidden><span></span><button id="clear-rail-filters">Clear filters</button></div><div id="rail-filter-controls">${summary}${filters}</div>` : `<nav class="session-filters" data-session-filters data-filter-keys="all active attention" aria-label="Conversation shortcuts">${filterButtons(['all','active','attention'])}</nav><details class="session-more-filters" data-more-filters ${readLocal('pc-session-filters-open',false)?'open':''}><summary>Filters<span data-filter-summary></span></summary>${`<div data-workspace-filters></div><nav class="session-filters" data-session-filters data-filter-keys="new pinned hidden" aria-label="More conversation filters">${filterButtons(['new','pinned','hidden'])}</nav>`}</details><button class="chip clear-more-filters" data-clear-more-filters hidden>Clear filters</button>`}
    <p class="session-warning" data-session-warning hidden></p>
    <div class="session-results" data-session-results></div>
    <div class="convo-results" data-convo-results></div>
    <p class="session-footnote">Recent conversations and everything Pocket ran. Activity from other apps is an estimate.</p>
  </div>`;
}
/* ---------- 1.22: search inside conversations ----------
   Three or more characters in a session search box also search inside every conversation: MemStem's index when
   the server has it (wording and meaning, every session), otherwise Pocket's own scan of recent conversations for
   the exact phrase. A result opens the conversation with Find already on the match. */
let convo = { q: '', state: 'idle', results: [] }, convoT = null, convoSeq = 0, pendingFind = null;
function scheduleConvoSearch(force) {
  clearTimeout(convoT);
  const q = sessionQuery.replace(/\s+/g, ' ').trim();
  if (q.length < 3) { convoSeq++; convo = { q: '', state: 'idle', results: [] }; paintConvoResults(); return; }
  if (!force && q === convo.q && convo.state !== 'error') return;
  const my = ++convoSeq; convo = { q, state: 'loading', results: [] }; paintConvoResults();
  convoT = setTimeout(async () => {
    try {
      const d = await api('/search?q=' + encodeURIComponent(q), { signal: AbortSignal.timeout(35000) });
      if (my !== convoSeq) return;
      convo = { q, state: 'done', results: d.results || [], backend: d.backend, scanned: d.scanned, total: d.total, complete: d.complete };
    } catch { if (my !== convoSeq) return; convo = { q, state: 'error', results: [] }; }
    paintConvoResults();
  }, 450);
}
function markTerms(text, q) { // escaped text with each query word marked
  const terms = [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}_.-]+/u).filter(t => t.length >= 2))].sort((a, b) => b.length - a.length);
  if (!terms.length) return esc(text);
  const re = new RegExp('(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return String(text).split(re).map((part, i) => i % 2 ? `<mark class="fmark">${esc(part)}</mark>` : esc(part)).join('');
}
function convoResultsHTML() {
  const c = convo;
  if (c.state === 'idle') return '';
  const head = n => `<h2>In conversations${n != null ? `<span>${n}</span>` : ''}</h2>`;
  if (c.state === 'loading') return `<section class="session-group convo-group">${head()}<p class="convo-note" role="status">Searching inside conversations…</p></section>`;
  if (c.state === 'error') return `<section class="session-group convo-group">${head()}<p class="convo-note" role="status">Could not search inside conversations.</p><button type="button" class="chip convo-retry" data-convo-retry>Try again</button></section>`;
  const scope = c.backend === 'memstem' ? 'Searched every conversation by wording and meaning (MemStem).'
    : `Exact phrase in ${c.complete ? 'the' : c.scanned + ' of the'} ${c.total} most recent conversations${c.complete ? '' : ', newest first'}.`;
  const rows = c.results.map(r => {
    const who = r.related ? 'Related' : r.role === 'user' ? 'You' : r.provider === 'codex' ? 'Codex' : r.provider === 'acp' ? 'OpenRouter' : 'Claude';
    const where = r.cwd && r.cwd !== sessionsHome ? esc(projName(r.cwd)) + ' · ' : '';
    return `<div class="session-item convo-item"><button class="row" data-convo-id="${esc(r.id)}">
      <span class="body"><span class="title">${esc(r.title || 'Untitled conversation')}</span>
      <span class="meta">${where}${r.provider === 'codex' ? 'Codex' : r.provider === 'acp' ? 'OpenRouter' : 'Claude'}${r.mtimeMs ? ' · ' + esc(rel(r.mtimeMs)) : ''}</span>
      <span class="convo-snippet"><span class="convo-who">${who}:</span> ${r.related ? esc(r.snippet || '') : markTerms(r.snippet || '', c.q)}</span></span>
    </button></div>`;
  }).join('');
  return `<section class="session-group convo-group">${head(c.results.length)}<p class="convo-note">${esc(scope)}</p>${rows || '<p class="convo-note" role="status">No matches inside conversations.</p>'}</section>`;
}
function paintConvoResults() {
  document.querySelectorAll('[data-convo-results]').forEach(el => {
    el.innerHTML = convoResultsHTML();
    el.querySelector('[data-convo-retry]')?.addEventListener('click', () => scheduleConvoSearch(true));
    el.querySelectorAll('[data-convo-id]').forEach(b => b.onclick = () => {
      const id = b.dataset.convoId; pendingFind = convo.q; closeCurrentSheet?.();
      if (location.hash === '#/chat/' + id) renderChat(id); else location.hash = '#/chat/' + id;
    });
  });
}
// After opening a result: Find on the phrase, or else on the longest matching word.
function applyPendingFind() {
  const q = pendingFind; pendingFind = null; if (!q || !$('#fq')) return;
  findOpen(true);
  const words = q.split(/\s+/).filter(w => w.length >= 3).sort((a, b) => b.length - a.length);
  for (const term of [q, ...words]) {
    $('#fq').value = term; findRun(term);
    if (fmarks.length) break;
  }
  findDeep($('#fq').value.trim());
}
function bindSessionPanel(container) {
  container.querySelectorAll('[data-session-search]').forEach(input => input.oninput = e => { sessionQuery = e.target.value; paintSessionPanels(); scheduleConvoSearch(); });
  container.querySelectorAll('[data-more-filters]').forEach(el => {
    el.querySelector('summary').onclick = e => {e.preventDefault();el.open=!el.open;writeLocal('pc-session-filters-open',el.open);};
  });
  paintConvoResults();
  container.querySelectorAll('[data-clear-more-filters]').forEach(el => {el.onclick = () => {workspaceFilter='';providerFilter='';sessionFilter='all';writeLocal('pc-workspace-filter','');writeLocal('pc-provider-filter','');container.querySelector('[data-more-filters] summary')?.focus();paintSessionPanels();};});
  paintSessionPanels();
}
async function renderList() {
  Voice.onLeave();
  app.innerHTML = `<header class="bar">${assistantMode() ? `<button class="icon" id="back" aria-label="Back">${IC.back}</button><h1>Conversations</h1>` : '<h1>Pocket Code</h1>'}
    <button class="icon bell" id="bell" aria-label="Toggle notifications for this device">${IC.bellOff}</button>
    <button class="icon bell" id="settings" aria-label="Settings and version">${IC.cog}</button></header>
    <main class="scroll session-home"><div class="session-home-head"><h2>Your conversations</h2><span class="project-head-actions">${projectsOn() ? '<a class="chip" href="#/projects" data-projects-home>Projects</a>' : ''}${documentsOn() ? '<a class="chip" href="#/documents">Files</a>' : ''}${tasksOn() ? '<a class="chip" href="#/tasks" data-tasks-home>Tasks</a>' : ''}${vaultOn() ? '<a class="chip" href="#/vault" data-vault-home>Vault</a>' : ''}${inboxOn() ? '<a class="chip" href="#/inbox" data-inbox-home>Inbox</a>' : ''}<button class="chip" id="refresh-sessions">Refresh</button></span></div>
    <div id="resume-last"></div>${sessionPanelHTML()}</main><button class="fab" id="new" aria-label="New conversation">${IC.plus}</button>`;
  $('#new').onclick = () => openFreshNew(assistantMode() ? '#/' : '#/new');
  if (assistantMode()) $('#back').onclick = () => { location.hash = '#/'; };
  $('#settings').onclick = settingsSheet; $('#refresh-sessions').onclick = refreshSessions;
  pushState().then(sub => { const bell = $('#bell'); if (bell && sub) { bell.innerHTML = IC.bell; bell.classList.add('on'); } });
  $('#bell').onclick = () => togglePush($('#bell'));
  bindSessionPanel(app); if (projectsOn()) loadBoard().then(paintProjectBadges).catch(() => { }); if (tasksOn()) loadTasks().then(paintTaskBadges).catch(() => { }); if (vaultOn()) loadVault().then(paintVaultBadges).catch(() => { }); if (inboxOn()) loadInbox().then(paintInboxBadges).catch(() => { }); await refreshSessions();
  const last=openSessions.find(s=>s.id===readLocal('pc-last-session',''));if(last&&$('#resume-last'))$('#resume-last').innerHTML=`<a class="resume-last" href="#/chat/${esc(last.id)}">Resume: ${esc(last.title)}</a>`;
}
function openSessionSwitcher() {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet session-switcher';
  sh.innerHTML = `<h2>Switch conversation</h2>${sessionPanelHTML(true)}`;
  mountSheet(scrim, sh); bindSessionPanel(sh); refreshSessions();
}
// Refresh state without rebuilding the conversation or discarding its draft.
setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('.login')) refreshSessions(); }, 5000);
setInterval(()=>{
 if(sessionProofReceivedAt&&Math.max(performance.now()-sessionProofReceivedAt,Date.now()-sessionProofReceivedWallAt)>15000&&!sessionsStale){sessionsStale=true;paintSessionPanels();}
 else paintRunConfirmation();
},1000);
window.addEventListener('offline', () => { sessionsStale = true; paintSessionPanels(); setConnection('Offline. Your draft is kept on this device.'); });
window.addEventListener('online', () => { if (document.querySelector('[data-offline]')) return route(); refreshSessions(); if (chatId) openES(); });

/* ---------- saved follow-ups ---------- */
async function openQueue(id) {
  const scrim=document.createElement('div');scrim.className='scrim';
  const sh=document.createElement('div');sh.className='sheet queue-sheet';
  sh.innerHTML='<h2>Queued instructions</h2><p class="sheet-help">Each saved instruction runs as its own reply. Stopping the current reply pauses the queue.</p><button class="chip" id="queue-refresh">Refresh</button><div id="queue-items" role="status">Loading queue…</div>';
  workspaceMount(scrim,sh,'queue');
  const load=async()=>{
    try{
      const d=await api('/session/'+encodeURIComponent(id)+'/queue');if(!sh.isConnected)return;
      const target=sh.querySelector('#queue-items');
      target.innerHTML=d.items.length?d.items.map((r,i)=>`<article class="queue-item"><div class="result-detail">${i+1} · ${r.status==='pending'?(d.active?'After the current reply':d.waitingForJobs?'After the background jobs':'Paused'):r.status==='editing'?'Editing · paused':r.status==='dispatching'?'Starting…':'Needs review'}</div><p>${esc(r.text)}</p><div class="result-detail">${permissionLabel(r.approvalMode||approvalPolicy.defaultMode)}</div>${r.error?`<p class="sheet-help">${esc(r.error)}</p>`:''}<div class="queue-actions">${['pending','editing'].includes(r.status)?`<button class="chip" data-edit="${r.id}">${r.status==='editing'?'Continue editing':'Edit'}</button>`:''}${r.status!=='dispatching'?`<button class="chip" data-remove="${r.id}">Remove</button>`:''}</div></article>`).join(''):'<p class="empty">No queued instructions. While the agent works, choose After this reply before sending.</p>';
      const held=d.waitingForJobs; // 1.89.2: background jobs keep this conversation on the earlier Claude login
      if(d.items[0]?.status==='pending'&&!d.active)target.insertAdjacentHTML('beforeend',`${held?`<p class="sheet-help">${esc(heldForJobsText(held).replace(/^Held/,'Waiting'))}</p>`:''}<button class="primary" id="queue-start" ${d.external?'disabled':''}>${held?'Stop background jobs and run it':'Run next instruction'}</button>${d.external?'<p class="sheet-help">Recent activity was seen elsewhere. Refresh after that reply finishes.</p>':''}`);
      target.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{const r=d.items.find(x=>x.id===b.dataset.remove);b.disabled=true;
        try{await api('/session/'+id+'/queue/'+r.id,{method:'DELETE',body:JSON.stringify({revision:r.revision})});await load();refreshSessions();}catch(e){toast(e.message);b.disabled=false;}
      });
      target.querySelectorAll('[data-edit]').forEach(b=>b.onclick=async()=>{
        let r=d.items.find(x=>x.id===b.dataset.edit);const article=b.closest('article');b.disabled=true;
        try{r=(await api('/session/'+id+'/queue/'+r.id,{method:'PATCH',body:JSON.stringify({editing:true,revision:r.revision})})).item;}
        catch(err){toast(err.message);b.disabled=false;return;}
        if(!article.isConnected)return;
        article.innerHTML='<p class="sheet-help">This instruction is paused until you save or cancel.</p><label class="sheet-help">Queued instruction<textarea class="queue-editor" aria-label="Edit queued instruction"></textarea></label><div class="queue-actions"><button class="chip" data-save>Save changes</button><button class="chip" data-cancel>Cancel edit</button></div>';
        const key='pc-queue-draft-'+id+'-'+r.id,input=article.querySelector('textarea');input.value=readLocal(key,null)??r.text;input.focus();input.oninput=()=>writeLocal(key,input.value);
        const save=async(text,button)=>{button.disabled=true;try{await api('/session/'+id+'/queue/'+r.id,{method:'PATCH',body:JSON.stringify({text,revision:r.revision})});localStorage.removeItem(key);await load();refreshSessions();}catch(err){toast(err.message);button.disabled=false;}};
        article.querySelector('[data-cancel]').onclick=e=>save(r.text,e.currentTarget);
        article.querySelector('[data-save]').onclick=e=>save(input.value,e.currentTarget);
      });
      const start=target.querySelector('#queue-start');if(start)start.onclick=async()=>{start.disabled=true;
        try{await api('/session/'+id+'/queue/start',{method:'POST',body:JSON.stringify({itemId:d.items[0].id,...(held&&{replaceStaleLogin:true})})});closeCurrentSheet?.();if(chatId===id)renderChat(id);}
        catch(e){toast(e.message);await load();}
      };
    }catch(e){if(sh.isConnected)sh.querySelector('#queue-items').textContent=e.message;}
  };
  sh.querySelector('#queue-refresh').onclick=load;await load();
}

/* ---------- session results ---------- */
async function openResults(id) {
  const scrim=document.createElement('div');scrim.className='scrim';
  const sh=document.createElement('div');sh.className='sheet results-sheet';
  sh.innerHTML='<h2>Results & links</h2><p class="sheet-help">Reports, files and links shared in this conversation.</p><div class="results-tools"><input type="search" id="result-query" placeholder="Find a result" aria-label="Find a result"><button class="chip" id="result-refresh">Refresh</button></div><div id="result-list" role="status">Loading results…</div>';
  workspaceMount(scrim,sh,'results');let data={results:[]};
  const paint=()=>{
    const q=sh.querySelector('#result-query').value.trim().toLowerCase();
    const rows=data.results.filter(r=>(r.label+' '+r.detail+' '+r.target).toLowerCase().includes(q));
    sh.querySelector('#result-list').innerHTML=rows.map(r=>{
      const href=r.kind==='file'?'/api/session/'+encodeURIComponent(id)+'/artifact?path='+encodeURIComponent(r.target):PocketFormat.href(r.target);
      if(!href)return '';
      const safeTarget=r.kind==='file'?r.target.split('/').pop().replace(/[^\w.\-]+/g,'_'):'';
      const kept=typeof docsSnap!=='undefined'&&docsSnap?docsSnap.documents.find(d=>d.session===id&&d.addedBy==='session'&&(d.file===safeTarget||d.file.replace(/-\d+(?=\.[^.]+$)/,'')===safeTarget))||null:null;
      const keep=typeof documentsOn==='function'&&documentsOn()&&keepableResult(r)?(kept?`<button class="chip result-keep" data-kept="${esc(kept.id)}">Kept · Open</button>`:`<button class="chip result-keep" data-keep="${esc(r.target)}">Keep in Files</button>`):'';
      return `<article class="result-row"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer"><span class="result-name">${esc(r.label)}</span><span class="result-detail">${esc(r.detail)}${r.at?' · '+esc(rel(new Date(r.at).getTime())):''}${r.kind==='file'?' · Download':''}</span></a>${keep}<button class="chip result-copy" data-url="${esc(r.kind==='file'?new URL(href,location.origin).href:r.target)}" aria-label="Copy link for ${esc(r.label)}">Copy link</button></article>`;
    }).join('') || `<p class="empty">${q?'No matching results.':'No results linked yet. Ask the agent to share a report or file link.'}</p>`;
    if(data.truncated||data.limited)sh.querySelector('#result-list').insertAdjacentHTML('beforeend','<p class="sheet-help">Showing recent references. Older results may still be in the conversation.</p>');
    sh.querySelectorAll('.result-copy').forEach(b=>b.onclick=()=>copyText(b.dataset.url,b));
    sh.querySelectorAll('[data-keep]').forEach(b=>b.onclick=()=>keepResult(id,b.dataset.keep,b));sh.querySelectorAll('[data-kept]').forEach(b=>b.onclick=()=>{closeCurrentSheet?.();location.hash='#/documents/'+b.dataset.kept;});
  };
  const load=async()=>{const b=sh.querySelector('#result-refresh');b.disabled=true;
    try {if(typeof documentsOn==='function'&&documentsOn())await loadDocs().catch(()=>{});data=await api('/session/'+encodeURIComponent(id)+'/results');if(sh.isConnected)paint();}
    catch(e){if(sh.isConnected)sh.querySelector('#result-list').innerHTML=`<p class="sheet-help">${esc(e.message)}</p>`;}
    finally{b.disabled=false;}
  };
  sh.querySelector('#result-query').oninput=paint;sh.querySelector('#result-refresh').onclick=load;await load();
}

/* ---------- chat ---------- */
let chatRenderVersion = 0;
let es = null, chatId = null, lastMeta = null, chatTitle = '', chatPinned = false;
function closeES() { if (es) { es.close(); es = null; } }

// One fold per run of tool calls, even when Claude emits each call as its own transcript message: after a
// render, consecutive folds (end of one assistant message -> start of the next, or back-to-back inside one)
// are merged into the first, so a turn reads prose / one fold / prose. The summary shows the count and the
// latest call, so it keeps changing while a turn runs; expanding shows every call in order.
function foldSummary(d) {
  const items = d.querySelectorAll('.ledgerlist > .ledger');
  const last = items[items.length - 1];
  const name = last?.querySelector('.name')?.textContent || '', det = last?.querySelector('.det')?.textContent || '';
  const sum = d.querySelector(':scope > summary'); if (!sum) return;
  // 1.59: plain words by default ("3 steps · Saved Proposal.pdf"); Settings > Describe steps in plain words off
  // brings back the tool name and its raw detail.
  const plain = plainSteps(), say = last?.dataset.say || '';
  const html = plain
    ? `<span class="tc-count">${items.length} step${items.length === 1 ? '' : 's'}</span><span class="tc-last">${esc(say || (name + ' ' + det))}${say && det && !last.classList.contains('same') ? `<span class="tc-raw">${esc(det)}</span>` : ''}</span>`
    : `<span class="tc-count">${items.length} tool call${items.length === 1 ? '' : 's'}</span><span class="tc-last">${esc(name)} ${esc(det)}</span>`;
  if (sum.innerHTML !== html) sum.innerHTML = html;
}
/* ---------- 1.61: files in the conversation ----------
   A file a reply hands over (named in its text: a link, a code span or a path on its own line) shows under that
   reply as a card: a picture (the first page of a PDF), its name and type, and Open, Download and Keep in Files.
   Open follows Settings → Open files and links (a tab, beside the conversation or a new window), like any link
   here: a kept file opens in Files, a readable one (PDF, HTML, text) in Pocket's link view, an Office file downloads.
   Images already show in the reply, so they get no card. */
const CARD_EXT = /\.(pdf|docx|pptx|xlsx|csv|tsv|html?|md|txt|json|zip)$/i, INLINE_EXT = /\.(pdf|html?|md|txt|csv|tsv|json)$/i;
let cardResults = { id: null, at: 0, list: [] }, cardSeq = 0;
const artifactUrl = (id, target, extra = '') => '/api/session/' + encodeURIComponent(id) + '/artifact?path=' + encodeURIComponent(target) + extra;
function keptDocFor(id, target) { // kept by hand (1.30, by file name) or by auto-keep (1.61, by its source path)
  if (typeof docsSnap === 'undefined' || !docsSnap) return null;
  const safe = target.split('/').pop().replace(/[^\w.\-]+/g, '_');
  return docsSnap.documents.find(d => !d.trashedAt && d.session === id && (d.source ? d.source === target : d.addedBy === 'session' && d.file.replace(/-\d+(?=\.[^.]+$)/, '') === safe)) || null;
}
function fileCardHTML(id, r) {
  const name = r.target.split('/').pop(), ext = (name.match(/\.([^.]+)$/)?.[1] || '').toUpperCase();
  const kept = keptDocFor(id, r.target), docs = typeof documentsOn === 'function' && documentsOn();
  const open = kept && docs ? location.origin + '/#/documents/' + encodeURIComponent(kept.id) : INLINE_EXT.test(name) ? artifactUrl(id, r.target, '&inline=1') : artifactUrl(id, r.target);
  const thumb = /\.pdf$/i.test(name) ? `<img class="file-card-img" src="${esc(artifactUrl(id, r.target, '&thumb=1'))}" alt="" loading="lazy">` : '';
  const keep = docs ? (kept ? `<span class="file-card-kept">In Files</span>` : `<button class="chip" type="button" data-card-keep>Keep in Files</button>`) : '';
  return `<div class="file-card" data-card-path="${esc(r.target)}"><a class="file-card-main" href="${esc(open)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(name)}">
    <span class="file-card-thumb">${thumb}<span class="file-card-ext">${esc(ext || 'FILE')}</span></span>
    <span class="file-card-body"><span class="file-card-name">${esc(name)}</span><span class="file-card-meta">${esc(r.detail || ext + ' file')}</span></span></a>
    <span class="file-card-actions">${keep}<a class="chip" href="${esc(artifactUrl(id, r.target))}" download>Download</a></span></div>`;
}
// 1.96: a handoff. A reply line holding only one of this Pocket's handoff links becomes a card. The server knows the id or it
// is not ours, so a link to another Pocket or an old start link stays a link. The paragraph stays, hidden, so copying the
// reply keeps the link.
const HANDOFF_LINK = /^(?:https?:\/\/[^\s/]+)?\/#\/start\/([0-9a-f]{12})$/;
const handoffCache = new Map();
function handoffLineId(p) {
  const a = p.querySelector('a');
  if (p.children.length !== (a ? 1 : 0) || (a && a.textContent.trim() !== p.textContent.trim())) return null;
  return (a ? a.getAttribute('href') : p.textContent).trim().match(HANDOFF_LINK)?.[1] || null;
}
function handoffCardHTML(id, s) {
  if (!s) return `<div class="handoff-card" data-handoff="${id}"><div class="handoff-head">${IC.hand}<span>This handoff link has expired. Ask the agent for a new one.</span></div></div>`;
  const label = 'Continue in a new conversation';
  if (s.startedSession) return `<div class="handoff-card" data-handoff="${id}"><div class="handoff-head">${IC.hand}<span>Started: <a href="#/chat/${esc(s.startedSession)}">${esc(s.startedTitle || 'New conversation')}</a></span></div></div>`;
  const agent = { claude: 'Claude', codex: 'Codex', acp: 'OpenRouter' }[s.provider] || '';
  const meta = assistantMode() ? [] : [s.directory ? projName(s.directory) : '', agent, permissionLabel(s.approvalMode)].filter(Boolean);
  const canStart = !s.folderMissing && Boolean(s.directory);
  return `<div class="handoff-card" data-handoff="${id}" role="group" aria-label="${label}">
    <div class="handoff-head">${IC.hand}<span>${label}</span></div>
    ${s.title ? `<div class="handoff-title">${esc(s.title)}</div>` : ''}
    ${meta.length ? `<div class="handoff-meta">${esc(meta.join(' · '))}</div>` : ''}
    <p class="handoff-text">${esc(String(s.text || '').slice(0, 400))}</p>
    ${s.folderMissing ? `<p class="handoff-note">That folder no longer exists. Review first to choose another.</p>` : ''}
    <div class="handoff-actions"><button type="button" class="primary" data-handoff-start${canStart ? '' : ' disabled'}>Start</button><a class="chip" href="#/start/${id}">Review first</a></div></div>`;
}
async function loadHandoff(id, fresh) {
  const hit = handoffCache.get(id);
  if (hit && !fresh && Date.now() - hit.at < 4000) return hit.data;
  let data = null;
  try { data = await api('/start/' + id); } catch (e) { if (e.status !== 404) return hit?.data; }
  if (data && data.kind !== 'handoff') data = undefined; // a plain start link stays a plain link
  handoffCache.set(id, { at: Date.now(), data });
  return data;
}
async function paintHandoffCards(container, fresh = false) {
  const lines = [...container.querySelectorAll(':scope > .m-asst:not(.live) p:not(.handoff-text):not(.handoff-note)')].map(p => [p, handoffLineId(p)]).filter(([, id]) => id);
  for (const [p, id] of lines) {
    const s = await loadHandoff(id, fresh);
    if (s === undefined || !p.isConnected) continue;
    const html = handoffCardHTML(id, s), old = p.nextElementSibling?.matches('[data-handoff]') ? p.nextElementSibling : null;
    if (old?.dataset.painted === html) continue;
    old?.remove();
    p.hidden = true;
    p.insertAdjacentHTML('afterend', html);
    p.nextElementSibling.dataset.painted = html;
  }
}
async function startHandoff(id, btn) {
  const s = handoffCache.get(id)?.data; if (!s) return;
  btn.disabled = true;
  try {
    const d = await api('/new', { method: 'POST', body: JSON.stringify({ text: s.text, cwd: s.directory, provider: s.provider || undefined, start: id, approvalMode: s.approvalMode }) });
    setPrefs(d.id, { model: 'default', effort: 'default', executionMode: 'work', approvalMode: s.approvalMode });
    handoffCache.delete(id);
    location.hash = '#/chat/' + d.id;
  } catch (e) {
    if (e.message === 'login') return;
    if (e.code === 'start_used') { handoffCache.delete(id); location.hash = '#/chat/' + e.body.id; return; }
    if (e.status === 409) { toast('That handoff is starting.'); return paintHandoffCards($('#msgs'), true); }
    if (e.status === 422) { toast('This briefing may contain a secret. Review it first.'); location.hash = '#/start/' + id; return; }
    btn.disabled = false; toast('Could not start the conversation. Try again.');
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-handoff-start]');
  if (b) startHandoff(b.closest('[data-handoff]').dataset.handoff, b);
});
async function paintFileCards(container, fresh = false) {
  const id = chatId; if (!id || !container) return;
  paintHandoffCards(container, fresh).catch(() => { });
  const seq = ++cardSeq;
  if (fresh || cardResults.id !== id || Date.now() - cardResults.at > 4000) {
    let d; try { d = await api('/session/' + encodeURIComponent(id) + '/results'); } catch { return; }
    if (typeof documentsOn === 'function' && documentsOn()) await loadDocs(fresh).catch(() => { });
    if (typeof vaultOn === 'function' && vaultOn()) await loadVault(fresh).catch(() => { }); // 1.93: secrets this conversation stored, current when the chat opens or a turn ends
    cardResults = { id, at: Date.now(), list: (d.results || []).filter(r => r.kind === 'file' && r.inText && CARD_EXT.test(r.target)) };
  }
  if (seq !== cardSeq || chatId !== id || !container.isConnected) return;
  const replies = [...container.querySelectorAll(':scope > .m-asst:not(.live)')];
  for (const r of [...cardResults.list].reverse()) { // results are newest first; a reply's cards follow its own order
    const enc = encodeURIComponent(r.target), name = r.target.split('/').pop();
    const host = replies.filter(m => m.innerHTML.includes(enc) || m.textContent.includes(r.target)).pop() || replies.filter(m => m.textContent.includes(name)).pop();
    const old = container.querySelector(`.file-card[data-card-path="${CSS.escape(r.target)}"]`);
    if (!host) { old?.remove(); continue; }
    const html = fileCardHTML(id, r);
    if (old && old.outerHTML.replace(/\s+/g, ' ') === html.replace(/\s+/g, ' ')) continue;
    old?.remove();
    let list = host.querySelector(':scope > .file-cards');
    if (!list) { list = document.createElement('div'); list.className = 'file-cards'; const choices = host.querySelector(':scope > .choices'); choices ? choices.before(list) : host.append(list); }
    list.insertAdjacentHTML('beforeend', html);
    const card = list.lastElementChild;
    card.querySelector('.file-card-img')?.addEventListener('error', e => e.target.remove());
    card.querySelector('[data-card-keep]')?.addEventListener('click', async e => {
      const b = e.currentTarget; b.disabled = true;
      try { const doc = await api('/documents/keep', { method: 'POST', body: JSON.stringify({ session: id, path: r.target }) }); mergeDoc(doc); toast('Kept in Files: ' + doc.title); paintFileCards(container); }
      catch (err) { toast(err.message || 'Could not keep the file'); b.disabled = false; }
    });
  }
  // 1.64.2: files the conversation kept in Files itself (pocket-docs add --session …) get a card too, even when the
  // reply only says "it's in your Files". Under the first reply after it was kept; it opens in Files the way Settings →
  // Open files and links says, with the library's own picture.
  const docs = typeof documentsOn === 'function' && documentsOn() && typeof docsSnap !== 'undefined' && docsSnap ? docsSnap.documents : [];
  const shown = new Set(cardResults.list.map(r => keptDocFor(id, r.target)?.id).filter(Boolean));
  const linked = docs.filter(d => !d.trashedAt && d.session === id && !shown.has(d.id));
  container.querySelectorAll('.file-card[data-card-doc]').forEach(el => { if (!linked.some(d => d.id === el.dataset.cardDoc)) el.remove(); });
  for (const d of linked.slice().sort((a, b) => Date.parse(a.added) - Date.parse(b.added))) {
    const at = Date.parse(d.added) || 0;
    const host = replies.find(m => Date.parse(m.dataset.ts || 0) >= at) || replies.at(-1);
    const old = container.querySelector(`.file-card[data-card-doc="${CSS.escape(d.id)}"]`);
    if (!host) { old?.remove(); continue; }
    const html = keptCardHTML(d);
    if (old && old.parentElement?.parentElement === host && old.outerHTML.replace(/\s+/g, ' ') === html.replace(/\s+/g, ' ')) continue;
    old?.remove();
    let list = host.querySelector(':scope > .file-cards');
    if (!list) { list = document.createElement('div'); list.className = 'file-cards'; const choices = host.querySelector(':scope > .choices'); choices ? choices.before(list) : host.append(list); }
    list.insertAdjacentHTML('beforeend', html);
    list.lastElementChild.querySelector('.file-card-img')?.addEventListener('error', e => e.target.remove());
  }
  // 1.93 (Damon): a secret this conversation stored in the Vault gets a card under the first reply after it was stored,
  // which opens the Vault at that secret. Only the name and kind are shown; the value never reaches the page.
  const secrets = typeof vaultOn === 'function' && vaultOn() && typeof vaultSnap !== 'undefined' && vaultSnap?.items ? vaultSnap.items.filter(i => i.addedIn?.session === id) : [];
  container.querySelectorAll('.file-card[data-card-vault]').forEach(el => { if (!secrets.some(i => i.id === el.dataset.cardVault)) el.remove(); });
  for (const i of secrets.slice().sort((a, b) => vaultTime(a.created) - vaultTime(b.created))) {
    const at = vaultTime(i.created) || 0;
    const host = replies.find(m => Date.parse(m.dataset.ts || 0) >= at) || replies.at(-1);
    const old = container.querySelector(`.file-card[data-card-vault="${CSS.escape(i.id)}"]`);
    if (!host) { old?.remove(); continue; }
    const html = vaultCardHTML(i);
    if (old && old.parentElement?.parentElement === host && old.outerHTML.replace(/\s+/g, ' ') === html.replace(/\s+/g, ' ')) continue;
    old?.remove();
    let list = host.querySelector(':scope > .file-cards');
    if (!list) { list = document.createElement('div'); list.className = 'file-cards'; const choices = host.querySelector(':scope > .choices'); choices ? choices.before(list) : host.append(list); }
    list.insertAdjacentHTML('beforeend', html);
  }
  container.querySelectorAll('.file-cards:empty').forEach(el => el.remove());
}
function vaultCardHTML(i) {
  const kind = VAULT_KIND_WORD[i.kind] || 'Secret';
  return `<div class="file-card vault-card" data-card-vault="${esc(i.id)}"><a class="file-card-main" href="${esc(vaultItemHref(i.name))}" aria-label="Open ${esc(i.name)} in the Vault">
    <span class="file-card-thumb vault-card-thumb" aria-hidden="true">${vaultKindIcon(i.kind)}</span>
    <span class="file-card-body"><span class="file-card-name vault-name">${esc(i.name)}</span><span class="file-card-meta">${esc(kind)} · stored in the Vault</span></span></a>
    <span class="file-card-actions"><span class="file-card-kept">In the Vault</span></span></div>`;
}
function keptCardHTML(d) {
  const ext = (String(d.file || '').match(/\.([^.]+)$/)?.[1] || d.kind || 'file').toUpperCase();
  const pic = Boolean(docsSnap?.thumbs?.[d.kind]) && !d.missing;
  return `<div class="file-card" data-card-doc="${esc(d.id)}"><a class="file-card-main" href="${esc(location.origin + '/#/documents/' + encodeURIComponent(d.id))}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(d.title)}">
    <span class="file-card-thumb">${pic ? `<img class="file-card-img" src="/api/documents/${esc(d.id)}/thumb" alt="" loading="lazy">` : ''}<span class="file-card-ext">${esc(ext)}</span></span>
    <span class="file-card-body"><span class="file-card-name">${esc(d.title)}</span><span class="file-card-meta">${esc(ext)} file · ${esc(d.file)}</span></span></a>
    <span class="file-card-actions"><span class="file-card-kept">In Files</span><a class="chip" href="/api/documents/${esc(d.id)}/raw?download=1" download>Download</a></span></div>`;
}
function mergeToolFolds(container) {
  if (!container) return;
  const isFold = el => el?.matches?.('details.ledgerwrap');
  const content = el => [...el.children].filter(c => !c.matches('.copybtn'));
  for (const d of [...container.querySelectorAll('details.ledgerwrap')]) {
    if (!d.isConnected) continue;
    let target = null;
    const prevEl = d.previousElementSibling;
    if (isFold(prevEl)) target = prevEl;                       // back-to-back inside one message
    else {
      const msg = d.closest('.m-asst');
      if (msg && content(msg)[0] === d) {                       // first thing in this message
        // Walk back over empty streaming placeholders (.m-asst.live with no text) and attachment rows so a
        // run of single-tool messages still collapses into one fold while the turn is streaming.
        let q = msg.previousElementSibling;
        while (q && ((q.matches('.m-asst.live') && !q.textContent.trim()) || q.matches('.m-files'))) q = q.previousElementSibling;
        if (q?.matches('.m-asst') && isFold(q.lastElementChild)) target = q.lastElementChild;
      }
    }
    if (!target) { foldSummary(d); continue; }
    const list = target.querySelector('.ledgerlist');
    for (const li of [...d.querySelectorAll('.ledgerlist > .ledger')]) list.append(li);
    if (d.open) target.open = true;
    const msg = d.closest('.m-asst'); d.remove();
    if (msg && content(msg).length === 0) msg.remove();
    foldSummary(target);
  }
}
function toolsCollapsed() { return readLocal('pc-tools-collapsed', true) !== false; }
// 1.59: each tool call reads as a plain step ("Saved Proposal.pdf") with its raw call beside it in the ledger font.
// Off: the tool name and detail only, as before 1.59. A class on <html> switches every line already on screen.
function plainSteps() { return readLocal('pc-plain-steps', true) !== false; }
function applyPlainSteps() { document.documentElement.classList.toggle('raw-steps', !plainSteps()); }
applyPlainSteps();
// Reply suggestions: the agent ends a question with a ```choices block (see choices.mjs); the server turns it
// into {t:'choices', options}. They show only under the latest reply of a finished turn, while the message
// box is empty, until dismissed. A tap sends the option as the next message.
// `rec` is the index of the option the agent marked "(Recommended)": that button is filled clay and carries
// a "Recommended" tag (visible and read by screen readers); the tag is never part of the sent message.
function choicesHTML(options, rec) {
  if (!options.length) return '';
  return `<div class="choices" role="group" aria-label="Suggested replies" data-choices="${esc(options.join('\u241e'))}" hidden><div class="choice-opts">${
    options.map((o, i) => i === rec
      ? `<button type="button" class="choice choice-rec" data-choice="${esc(o)}"><span class="choice-text">${esc(o)}</span><span class="choice-tag">Recommended</span></button>`
      : `<button type="button" class="choice" data-choice="${esc(o)}">${esc(o)}</button>`).join('')
  }</div><button type="button" class="choice-x" aria-label="Dismiss suggested replies and type your own" title="Dismiss">${IC.x}</button></div>`;
}
function paintChoices() {
  const msgs = $('#msgs'); if (!msgs) return;
  paintTryHarder(msgs);
  const sets = msgs.querySelectorAll('[data-choices]'); if (!sets.length) return;
  const last = [...msgs.children].filter(e => e.matches('.m-user, .m-asst:not(.live)')).pop();
  const box = $('#box'), dismissed = readLocal('pc-choices-dismissed', {})[chatId];
  const open = !composerWorking && !sendsInFlight.has(chatId) && !loadOutbox(chatId) && !box?.value.trim() && !box?.readOnly;
  sets.forEach(c => { c.hidden = !(open && c.closest('.m-asst') === last && c.dataset.choices !== dismissed); });
}
// 1.62: Assistant mode's only model control, phrased as an outcome. Under the latest finished Claude reply, it asks
// for another, more careful pass on the strongest model this Pocket offers at high effort (capped by the policy);
// the conversation keeps that choice afterwards (the server remembers it).
function paintTryHarder(msgs) {
  msgs.querySelectorAll('.try-harder').forEach(b => b.remove());
  if (!assistantMode() || !chatId || /^(cx|acp):/.test(String(chatId)) || composerWorking || sendsInFlight.has(chatId)) return; // Automatic model choice picks Claude models only
  const last = [...msgs.children].filter(e => e.matches('.m-user, .m-asst:not(.live)')).pop();
  if (!last?.matches('.m-asst') || !last.textContent.trim()) return;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'chip try-harder'; b.textContent = 'Try harder';
  b.title = 'Take another, more careful pass at this';
  b.onclick = async () => {
    await loadClaudeModels().catch(() => { });
    // Opus when it's offered (Fable stays an explicit choice), else the strongest offered model.
    const offered = MODELS.filter(m => m[0] !== 'default'), strongest = (offered.find(m => /opus/i.test(m[0])) || offered[0])?.[0];
    if (!strongest || !tb) return toast('Try harder is not available here.');
    tb.prefs = { ...tb.prefs, model: strongest, effort: 'high' }; setPrefs(chatId, tb.prefs);
    sendMsg('Please take another, more careful pass at that. Check your work before you answer.');
  };
  last.after(b); // beside the reply, not in it, so copying or reading the reply aloud never includes the button
  scrollBottom(); // 1.63.1: it arrives after the reply has scrolled into view; keep it in view if you're at the bottom
}
document.addEventListener('click', e => {
  const x = e.target.closest?.('.choice-x');
  if (x) {
    const set = x.closest('[data-choices]'), m = readLocal('pc-choices-dismissed', {});
    delete m[chatId]; m[chatId] = set.dataset.choices;                          // newest last, so pruning drops the oldest
    const keys = Object.keys(m); keys.slice(0, Math.max(0, keys.length - 100)).forEach(k => delete m[k]);
    writeLocal('pc-choices-dismissed', m); set.hidden = true; $('#box')?.focus();
    return;
  }
  const b = e.target.closest?.('.choice');
  if (b && chatId) { b.closest('[data-choices]').hidden = true; sendMsg(b.dataset.choice); }
});
function ledgerHTML(name, detail) {
  const say = window.PocketPhrase ? PocketPhrase.step(name, detail) : '';
  // The raw detail stays beside a plain step only when it adds something (a full path, a command), not when the
  // step already says it (a Bash description).
  const extra = say && detail && !say.includes(String(detail).trim()) ? '' : ' same';
  if (!say) return `<div class="ledger enter">${toolIcon(name)}<span class="name">${esc(name)}</span><span class="det">${esc(detail || '')}</span></div>`;
  return `<div class="ledger step enter${extra}" data-say="${esc(say)}">${toolIcon(name)}<span class="say">${esc(say)}</span><span class="name">${esc(name)}</span><span class="det">${esc(detail || '')}</span></div>`;
}
// the plan, as a checklist — collapsed history, newest one open (see openLastTodo)
function todoHTML(todos) {
  const done = todos.filter(t => t.s === 'completed').length;
  const cur = todos.find(t => t.s === 'in_progress');
  const head = `Plan · ${done}/${todos.length}${cur ? ' · ' + cur.c : ''}`;
  return `<details class="todo enter"><summary><span class="thead">${esc(head)}</span></summary><ul>${todos.map(t =>
    `<li class="t-${esc(t.s)}"><span class="tbox">${t.s === 'completed' ? IC.tick : ''}</span><span>${esc(t.c)}</span></li>`).join('')}</ul></details>`;
}
function openLastTodo() {
  const all = $('#msgs')?.querySelectorAll('details.todo');
  if (all?.length) all.forEach((d, i) => { d.open = i === all.length - 1; });
}
const isImg = p => /\.(png|jpe?g|gif|webp)$/i.test(p || '');
function fileChip(f) { // f: {n,p} from the server, plain name string from optimistic sends
  const n = typeof f === 'string' ? f : f.n, p = typeof f === 'string' ? null : f.p;
  if (p && isImg(p)) {
    const src = '/api/file?path=' + encodeURIComponent(p);
    return `<a href="${esc(src)}" target="_blank" rel="noopener"><img class="athumb big" src="${esc(src)}" alt="${esc(n)}" loading="lazy"></a>`;
  }
  return `<div class="ledger">${IC.clip}<span class="det">${esc(n)}</span></div>`;
}
/* ---------- 1.24: message times and day dividers ----------
   Every transcript message already carries its time (data-ts, used by While you were away). Each bubble shows
   it as a small time, with the date when the message is not from today (data-time, drawn by CSS so copy and find
   never pick it up), and a day divider
   ("Today", "Yesterday", "Tue, Oct 6") sits before the first message of each day. Settings > Show message
   times hides both on this browser. Messages without a time (optimistic sends, steered echoes) show none. */
const showTimes = () => readLocal('pc-times', true) !== false;
const dayKey = ms => { const d = new Date(ms); return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate(); };
// 1.24.1: a message from another day carries its date too ("Yesterday 3:05 PM", "Oct 6, 3:05 PM", "Oct 6, 2025, 3:05 PM"),
// so the day is on the bubble itself and not only on the divider. Labels are fixed at render time, like the away line.
function timeLabel(ms) {
  const d = new Date(ms), now = new Date(), t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (dayKey(ms) === dayKey(now)) return t;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (dayKey(ms) === dayKey(y)) return 'Yesterday ' + t;
  return (d.getFullYear() === now.getFullYear() ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })) + ', ' + t;
}
function dayLabel(ms) {
  const d = new Date(ms), now = new Date();
  if (dayKey(ms) === dayKey(now)) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (dayKey(ms) === dayKey(y)) return 'Yesterday';
  return d.getFullYear() === now.getFullYear() ? d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
const timeAttr = ts => { const t = ts ? Date.parse(ts) : NaN; return t ? ` data-time="${esc(timeLabel(t))}"` : ''; };
const dayDividerHTML = ms => { const l = dayLabel(ms); return `<div class="day-divider" role="separator" aria-label="${esc(l)}"><span>${esc(l)}</span></div>`; };
// The transcript with a divider wherever the day changes between timestamped messages.
function withDays(messages) {
  let last = null;
  return messages.map(m => {
    const t = m.ts ? Date.parse(m.ts) : NaN;
    let h = '';
    if (t && dayKey(t) !== last) { h = dayDividerHTML(t); last = dayKey(t); }
    return h + msgHTML(m);
  }).join('');
}
// Live appends: a divider when the next message starts a new day after the last timestamped one on screen.
function appendDayDivider(msgs, ts) {
  const t = ts ? Date.parse(ts) : NaN; if (!t) return;
  const prev = [...msgs.querySelectorAll(':scope > [data-ts]')].at(-1), pt = prev ? Date.parse(prev.dataset.ts) : NaN;
  if (!pt || dayKey(pt) !== dayKey(t)) msgs.insertAdjacentHTML('beforeend', dayDividerHTML(t));
}
function msgHTML(m) {
  if (m.role === 'user') {
    let h = `<div class="m-user enter${m.pending ? ' pending' : ''}"${m.ts ? ` data-ts="${esc(m.ts)}"` : ''}${timeAttr(m.ts)}>${esc(m.text)}</div>`;   // pending: sent, not in the transcript yet
    if (m.files?.length) h += `<div class="m-files">${m.files.map(fileChip).join('')}</div>`;
    return h;
  }
  const parts = [];
  let tools = [];
  // Tool calls are folded behind a one-line summary (Settings > Collapse tool calls, default on) so a
  // reply reads as prose; open the fold to see the Bash/Edit/Read ledger. Copy-message skips it either way.
  const flush = () => {
    if (tools.length) {
      parts.push(`<details class="ledgerwrap"${toolsCollapsed() ? '' : ' open'}><summary></summary><div class="ledgerlist">${tools.join('')}</div></details>`);
      tools = [];
    }
  };
  for (const b of m.blocks || []) {
    if (b.t === 'tool') tools.push(ledgerHTML(b.name, b.detail));
    else if (b.t === 'todo') { flush(); parts.push(todoHTML(b.todos || [])); }
    else if (b.t === 'choices') { flush(); parts.push(choicesHTML(b.options || [], Number.isInteger(b.rec) ? b.rec : -1)); }
    else { flush(); parts.push(md(b.text)); }
  }
  flush();
  return `<div class="m-asst enter"${m.ts ? ` data-ts="${esc(m.ts)}"` : ''}${timeAttr(m.ts)}><button class="copybtn msgcopy" data-copy-msg aria-label="Copy message">${IC.copy}</button>${parts.join('')}</div>`;
}

/* ---------- copy affordances (delegated: messages + code blocks) ---------- */
async function copyText(t, btn) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(t);
    else { const ta = document.createElement('textarea'); ta.value = t; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    if (btn) { btn.innerHTML = IC.tick; btn.classList.add('ok'); setTimeout(() => { btn.innerHTML = IC.copy; btn.classList.remove('ok'); }, 1400); }
  } catch { toast('Copy failed'); }
}
document.addEventListener('click', e => {
  const code = e.target.closest?.('[data-copy]');
  if (code) { e.stopPropagation(); return copyText(code.closest('.codewrap')?.querySelector('code')?.textContent || '', code); }
  const msg = e.target.closest?.('[data-copy-msg]');
  if (msg) {
    e.stopPropagation();
    const clone = msg.closest('.m-asst')?.cloneNode(true);
    if (!clone) return;
    clone.querySelectorAll('.copybtn, .ledgerwrap, .choices, .away-card').forEach(n => n.remove()); // prose + code, not machinery
    return copyText((clone.innerText || '').trim(), msg);
  }
});

/* ---------- find in conversation (an installed PWA has no browser find bar) ---------- */
let fmarks = [], fidx = -1;
function findClear() {
  const msgs = $('#msgs');
  if (msgs) {
    for (const m of msgs.querySelectorAll('mark.fmark')) m.replaceWith(document.createTextNode(m.textContent));
    msgs.normalize();
  }
  fmarks = []; fidx = -1;
}
function findRun(q) {
  findClear();
  const msgs = $('#msgs'), count = $('#fcount');
  q = (q || '').trim();
  if (!msgs || q.length < 2) { if (count) count.textContent = ''; return; }
  const needle = q.toLowerCase();
  const walker = document.createTreeWalker(msgs, NodeFilter.SHOW_TEXT);
  const hits = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue && n.nodeValue.toLowerCase().includes(needle)) hits.push(n);
  }
  for (const node of hits) { // collected first, then replaced — mutating mid-walk skips nodes
    const text = node.nodeValue, frag = document.createDocumentFragment();
    let i = 0;
    for (;;) {
      const at = text.toLowerCase().indexOf(needle, i);
      if (at < 0) break;
      if (at > i) frag.append(document.createTextNode(text.slice(i, at)));
      const mk = document.createElement('mark');
      mk.className = 'fmark'; mk.textContent = text.slice(at, at + q.length);
      frag.append(mk); fmarks.push(mk);
      i = at + q.length;
    }
    frag.append(document.createTextNode(text.slice(i)));
    node.replaceWith(frag);
  }
  if (count) count.textContent = fmarks.length ? `1/${fmarks.length}` : 'none';
  if (fmarks.length) { fidx = -1; findStep(1); }
}
function findStep(d) {
  if (!fmarks.length) return;
  if (fidx >= 0) fmarks[fidx].classList.remove('cur');
  fidx = (fidx + d + fmarks.length) % fmarks.length;
  const m = fmarks[fidx];
  m.classList.add('cur');
  const det = m.closest('details'); if (det) det.open = true; // reveal a hit inside a collapsed plan
  m.scrollIntoView({ block: 'center' });
  const c = $('#fcount'); if (c) c.textContent = `${fidx + 1}/${fmarks.length}`;
}
const findIsOpen = () => { const b = $('#findbar'); return Boolean(b) && !b.hidden; };
function findOpen(on) {
  const bar = $('#findbar'); if (!bar) return;
  bar.hidden = !on;
  const box = $('#fq');
  if (on) { box.focus(); box.select(); }
  else {
    findClear(); if (box) box.value = ''; const c = $('#fcount'); if (c) c.textContent = '';
    clearTimeout(srchT); srchSeq++; const fm = $('#fmore'); if (fm) fm.hidden = true;
  }
}

/* ---------- full-transcript search (rendered chat is only the last ~400 messages) ---------- */
let chatTotal = 0, chatRendered = 0, srchT = null, srchSeq = 0;
function hl(text, q) { // escaped text with query hits wrapped in <mark>
  const lc = text.toLowerCase(), needle = q.toLowerCase(), out = [];
  let i = 0;
  for (;;) {
    const at = lc.indexOf(needle, i);
    if (at < 0) break;
    out.push(esc(text.slice(i, at)), `<mark class="fmark">${esc(text.slice(at, at + q.length))}</mark>`);
    i = at + q.length;
  }
  out.push(esc(text.slice(i)));
  return out.join('');
}
function findDeep(q) { // called from findRun once the local pass is done
  clearTimeout(srchT);
  const my = ++srchSeq;
  const fm = $('#fmore'); if (fm) fm.hidden = true;
  if (!q || q.length < 2 || chatTotal <= chatRendered) return;
  srchT = setTimeout(async () => {
    let d; try { d = await api(`/session/${chatId}/search?q=${encodeURIComponent(q)}`); } catch { return; }
    if (my !== srchSeq) return; // a newer query superseded this one
    const older = d.matches.filter(m => m.i < d.total - chatRendered);
    const fm2 = $('#fmore'); if (!fm2 || !older.length) return;
    fm2.innerHTML = `<button id="fmoreb">${older.length}${d.more ? '+' : ''} match${older.length === 1 ? '' : 'es'} in older messages — view</button>`;
    fm2.hidden = false;
    $('#fmoreb').onclick = () => openOlderMatches(q, older);
  }, 450);
}
function openOlderMatches(q, matches) {
  const ov = document.createElement('div'); ov.className = 'overlay'; ov.id = 'srchov';
  ov.innerHTML = `
    <header class="bar"><button class="icon" id="srchx" aria-label="Close">${IC.back}</button>
      <h1><span class="one">Older matches</span><span class="tag">“${esc(q)}” · before the rendered history</span></h1></header>
    <main class="scroll"><div class="srlist">${matches.map(m => `
      <div class="srow">
        <span class="smeta">${m.role === 'user' ? 'You' : 'Claude'}${m.ts ? ' · ' + rel(new Date(m.ts).getTime()) : ''}${m.hits > 1 ? ` · ${m.hits}×` : ''}</span>
        <span class="stext">${hl(m.text, q)}</span>
      </div>`).join('')}</div></main>`;
  document.body.append(ov);
  $('#srchx').onclick = () => ov.remove();
}

/* ---------- changed files (read-only: what did this session do to my code) ---------- */
function diffHTML(op) {
  const CTX = 2, CAP = 300;
  const rows = [];
  if (typeof op.patch === 'string') { // 1.87: a unified diff (Codex), shown as it is; file headers dropped, hunk lines kept
    for (const l of op.patch.split('\n')) {
      if (/^(diff |index |--- |\+\+\+ )/.test(l)) continue;
      rows.push(l.startsWith('@@') ? [' ', l] : [l[0] === '+' ? '+' : l[0] === '-' ? '-' : ' ', l.slice(1)]);
    }
  } else if (op.old == null) {
    for (const l of String(op.new ?? '').split('\n')) rows.push(['+', l]);
  } else {
    const a = op.old.split('\n'), b = String(op.new ?? '').split('\n');
    let pre = 0; while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let suf = 0; while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    for (let i = Math.max(0, pre - CTX); i < pre; i++) rows.push([' ', a[i]]);
    for (let i = pre; i < a.length - suf; i++) rows.push(['-', a[i]]);
    for (let i = pre; i < b.length - suf; i++) rows.push(['+', b[i]]);
    for (let i = a.length - suf; i < Math.min(a.length, a.length - suf + CTX); i++) rows.push([' ', a[i]]);
  }
  const head = `${op.tool}${op.all ? ' · replace all' : ''}${op.ts ? ' · ' + rel(new Date(op.ts).getTime()) : ''}${op.trunc ? ' · truncated' : ''}`;
  return `<div class="diff"><div class="dhead">${esc(head)}</div><pre>${rows.slice(0, CAP).map(([c, l]) =>
    `<span class="${c === '+' ? 'da' : c === '-' ? 'dd' : 'dx'}">${esc(c + ' ' + l)}</span>`).join('')}${
    rows.length > CAP ? `<span class="dx">… ${rows.length - CAP} more lines</span>` : ''}</pre></div>`;
}
async function openChanges() {
  if (!chatId || $('#chgov')) return;
  const ov = document.createElement('div'); ov.className = 'overlay'; ov.id = 'chgov';
  ov.innerHTML = `
    <header class="bar"><button class="icon" id="chgx" aria-label="Close">${IC.back}</button>
      <h1><span class="one">Changed files</span></h1></header>
    <main class="scroll"><div class="empty">Reading transcript…</div></main>`;
  document.body.append(ov);
  $('#chgx').onclick = () => ov.remove();
  let d; try { d = await api(`/session/${chatId}/changes`); } catch (e) { ov.remove(); return toast('Could not load changes: ' + e.message); }
  const m = ov.querySelector('main'); if (!m) return;
  if (!d.files.length) { m.innerHTML = '<div class="empty">This conversation hasn’t edited any files.</div>'; return; }
  const n = (k, w) => k ? `${k} ${w}${k > 1 ? 's' : ''}` : '';
  m.innerHTML = d.files.map((f, i) => {
    const edits = f.ops.filter(o => o.tool === 'Edit').length, deletes = f.ops.filter(o => o.tool === 'Delete').length, writes = f.ops.length - edits - deletes;
    return `<details class="chg"${d.files.length === 1 ? ' open' : ''}>
      <summary><span class="fname">&lrm;${esc(projShort(f.path))}</span>
        <span class="fmeta">${[n(edits, 'edit'), n(writes, 'write'), deletes ? 'deleted' : ''].filter(Boolean).join(' · ')}</span></summary>
      ${f.ops.length ? f.ops.map(diffHTML).join('') : '<div class="chgnote">Edited; this agent did not record the change itself.</div>'}</details>`;
  }).join('') + (d.failed ? `<div class="chgnote">${d.failed} failed edit${d.failed > 1 ? 's' : ''} not shown</div>` : '');
}

/* ---------- completion chime (push covers the screen-off case; this covers watching) ---------- */
let actx = null;
function chime() {
  if (localStorage.getItem('pc-chime') === 'off') return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const t0 = actx.currentTime;
    [660, 880].forEach((f, i) => {
      const at = t0 + i * 0.13;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(0.08, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
      o.connect(g).connect(actx.destination);
      o.start(at); o.stop(at + 0.3);
    });
  } catch { /* audio unavailable — silence is fine */ }
}

/* ---------- composer drafts (Android kills backgrounded PWAs mid-sentence) ---------- */
const readingPositions = (()=>{try{return JSON.parse(localStorage.getItem('pc-reading')||'{}');}catch{return {};}})();
let readingTimer;
// 1.21: when you last had each conversation in front of you (leaving it, switching away or hiding the app).
// With the shared reviewed marker this decides where "New since …" goes when you come back.
const viewedAt=readLocal('pc-viewed',{});
function rememberViewed(){
  if(!chatId||PANE&&document.visibilityState!=='visible')return;
  viewedAt[chatId]=Date.now();const keys=Object.keys(viewedAt);if(keys.length>150)delete viewedAt[keys[0]];writeLocal('pc-viewed',viewedAt);
}
function rememberReading() {
  if($('#msgs'))rememberViewed();
  const m=$('#msgs')?.closest('main.scroll');if(!m||!chatId)return;
  readingPositions[chatId]={top:m.scrollTop,bottom:m.scrollHeight-m.scrollTop-m.clientHeight<100};
  const keys=Object.keys(readingPositions);if(keys.length>80)delete readingPositions[keys[0]];
  try{localStorage.setItem('pc-reading',JSON.stringify(readingPositions));}catch{}
}
const draftKey = id => 'pc-draft-' + (id || 'new');
const saveDraft = (id, v) => { try { v.trim() ? localStorage.setItem(draftKey(id), v) : localStorage.removeItem(draftKey(id)); } catch { } };
const loadDraft = id => { try { return localStorage.getItem(draftKey(id)) || ''; } catch { return ''; } };
const clearDraft = id => { try { localStorage.removeItem(draftKey(id)); } catch { } };
// 1.69.3: a briefing handed to New (a start link or Inbox alert, a task's or project's Start) stays only for that visit.
// The plus button opens a clean conversation unless you changed the briefing, so one you walked away from does not return.
const briefingKey = () => 'pc-new-briefing-' + NEW_KEY;
const saveBriefing = text => { saveDraft(NEW_KEY, text); writeLocal(briefingKey(), text); };
function openFreshNew(hash = '#/new') {
  const here = location.hash === hash || (hash === '#/' && !location.hash);
  // The plus pressed on the New conversation screen itself starts over: setting the hash it already has did nothing,
  // so a desktop left on New kept its old draft and the button looked dead. The agent and workspace stay; a start
  // still being delivered is never dropped. Reported by Brad.
  if (here && document.getElementById('first') && !loadOutbox(NEW_KEY)) {
    clearDraft(NEW_KEY);
    try { ['pc-new-start', briefingKey(), 'pc-attachments-' + NEW_KEY].forEach(k => localStorage.removeItem(k)); } catch { }
    return Promise.resolve(route()).then(() => document.getElementById('first')?.focus());
  }
  const brief = readLocal(briefingKey(), null);
  if (brief !== null && !loadOutbox(NEW_KEY)) {
    if (loadDraft(NEW_KEY) === brief) { clearDraft(NEW_KEY); try { localStorage.removeItem('pc-new-start'); } catch { } }
    try { localStorage.removeItem(briefingKey()); } catch { }
    if (here) return route();
  }
  location.hash = hash;
}

const isWide = () => matchMedia('(min-width: 900px)').matches;
const railOpen = () => localStorage.getItem('pc-rail') !== 'closed';
const railW = () => Math.min(480, Math.max(220, Number(localStorage.getItem('pc-railw')) || 320));
// 1.29: with Projects on, the rail head switches between the session list and the project list.
const filesButtonOpens = () => { const v = readLocal('pc-files-button', 'rail'); return ['rail', 'tab', 'beside'].includes(v) ? v : 'rail'; };
const railView = () => { const v = readLocal('pc-rail-view', 'sessions'); return v === 'projects' && projectsOn() ? 'projects' : v === 'documents' && documentsOn() ? 'documents' : v === 'tasks' && tasksOn() ? 'tasks' : v === 'vault' && vaultOn() ? 'vault' : v === 'inbox' && inboxOn() ? 'inbox' : 'sessions'; }; // 1.39: vault; 1.69: inbox
// Which rail entry the main area belongs to: a conversation or the list is Chats, a library view its own entry.
function mainAreaView() {
  const h = location.hash || '#/';
  if (h.startsWith('#/chat/') || h === '#/all' || (h === '#/' && !assistantMode())) return 'sessions';
  const m = h.match(/^#\/(projects|documents|tasks|vault|inbox)(?:[/?]|$)/);
  return m ? m[1] : null;
}
function railSwitchHTML() {
  if (!projectsOn() && !documentsOn() && !tasksOn() && !vaultOn() && !inboxOn()) return '<span>Conversations</span>';
  const v = railView();
  // 1.69: each entry is an icon with its name; with five or more entries the rail shows the name only on the pressed one
  // (the icon, aria-label and title carry it for the rest), so Inbox fits beside the other four.
  // 1.76.2: the pressed entry is the rail's list; aria-current marks what the main area shows (a clay bar when the two
  // differ), so Files opened in a tab is marked while the rail keeps listing chats. Reported by Damon.
  const main = mainAreaView();
  const seg = (key, icon, label, badge) => `<button data-rail-view="${key}" aria-pressed="${v === key}"${main === key ? ' aria-current="page"' : ''} aria-label="${label}" title="${label}">${icon}<span class="rail-label">${label}</span>${badge ? `<span class="badge" ${badge} hidden></span>` : ''}</button>`;
  const segs = [seg('sessions', IC.railChats, 'Chats'), projectsOn() ? seg('projects', IC.railProjects, 'Projects', 'data-projects-badge') : '', documentsOn() ? seg('documents', IC.railFiles, 'Files') : '', tasksOn() ? seg('tasks', IC.railTasks, 'Tasks', 'data-tasks-badge') : '', vaultOn() ? seg('vault', IC.vault, 'Vault', 'data-vault-badge') : '', inboxOn() ? seg('inbox', IC.railInbox, 'Inbox', 'data-inbox-badge') : ''].filter(Boolean);
  return `<div class="rail-switch${segs.length >= 5 ? ' many' : ''}" role="group" aria-label="Browse conversations, projects, files, tasks, the vault or the inbox">${segs.join('')}</div>`;
}
function withShell(colHtml) { // desktop: session rail + resize grip beside the content column
  const inputId = colHtml.includes('id="first"') ? 'first' : colHtml.includes('id="projects-main"') ? 'projects-main' : colHtml.includes('id="documents-main"') ? 'documents-main' : colHtml.includes('id="tasks-main"') ? 'tasks-main' : colHtml.includes('id="vault-main"') ? 'vault-main' : colHtml.includes('id="inbox-main"') ? 'inbox-main' : 'box'; // 1.29/1.30: project and document views have no composer; 1.69: inbox
  if (PANE || SOLO) return `<div class="split"><div class="chatcol">${colHtml}</div></div>`; // the outer window has the rail and tabs; a solo window shows one view
  if (!railOpen()) return `<div class="split"><div class="chatcol"><nav id="open-sessions" class="open-sessions" aria-label="Open conversations"></nav>${colHtml}</div></div>`;
  return `<div class="split">
    <aside class="rail" style="width:${railW()}px"><a class="skip-chat" href="#${inputId}">${inputId==='first'?'Skip to task':inputId==='projects-main'?'Skip to projects':inputId==='documents-main'?'Skip to files':inputId==='tasks-main'?'Skip to tasks':inputId==='vault-main'?'Skip to the vault':inputId==='inbox-main'?'Skip to the inbox':'Skip to message'}</a>
      <div class="railhead">${railSwitchHTML()}<div class="rail-actions"><button id="rail-filter-toggle" class="density-toggle" aria-expanded="true" aria-controls="rail-filter-controls" title="Collapse conversation filters">Filters ${IC.up1}</button><button class="icon" id="railsettings" aria-label="App settings">${IC.cog}</button><button class="icon" id="railnew" aria-label="New conversation">${IC.plus}</button></div></div>
      <div id="rail"></div>
    </aside>
    <div class="rail-resize-region" role="region" aria-label="Conversation list layout"><div class="railgrip" id="grip" role="separator" tabindex="0" aria-orientation="vertical" aria-valuemin="220" aria-valuemax="480" aria-valuenow="${railW()}" aria-label="Resize conversation list"></div></div>
    <div class="chatcol"><nav id="open-sessions" class="open-sessions" aria-label="Open conversations"></nav>${colHtml}</div>
  </div>`;
}
function wireShell() {
  paintOpenSessions();
  if (typeof sizeMainForSplit === 'function') sizeMainForSplit();
  bindWorkspaceDensity();
  if (PANE || SOLO || !railOpen()) return;
  paintRail();
  paintRailBadges();
  document.querySelectorAll('[data-rail-view]').forEach(b => b.onclick = () => {
    // 1.35: Settings → Files button can open the library straight away instead of listing files here.
    if (b.dataset.railView === 'documents' && filesButtonOpens() !== 'rail') return openLibrary(filesButtonOpens());
    writeLocal('pc-rail-view', b.dataset.railView); document.querySelectorAll('[data-rail-view]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); paintRail(); });
  bindRailNavigation();
  $('#railsettings').onclick=settingsSheet;
  $('#railnew').onclick = () => openFreshNew();
  const grip = $('#grip'), rail = document.querySelector('aside.rail');
  grip.onkeydown = e => { if (!['ArrowLeft','ArrowRight'].includes(e.key)) return; e.preventDefault(); const w = Math.min(480, Math.max(220, railW() + (e.key === 'ArrowRight' ? 20 : -20))); rail.style.width = w + 'px'; localStorage.setItem('pc-railw', String(w)); grip.setAttribute('aria-valuenow', String(w)); };
  document.querySelector('.skip-chat').onclick = e => { e.preventDefault(); document.getElementById(e.currentTarget.hash.slice(1))?.focus(); };
  grip.onpointerdown = e => {
    grip.setPointerCapture(e.pointerId);
    grip.onpointermove = ev => {
      const w = Math.min(480, Math.max(220, ev.clientX));
      rail.style.width = w + 'px';
      localStorage.setItem('pc-railw', String(w)); grip.setAttribute('aria-valuenow', String(w));
      if (typeof sizeMainForSplit === 'function') sizeMainForSplit();
    };
    grip.onpointerup = () => { grip.onpointermove = null; grip.onpointerup = null; };
  };
}
let railCache = { at: 0, sessions: [] };
// 1.50: the counts on the rail switch (due tasks and reminders, Vault requests) show on every view, not only after a
// segment has been opened: paint from what is cached at once, then from a fresh list. Reported by Brad.
function paintRailBadges() {
  if (!document.querySelector('.rail-switch')) return;
  if (projectsOn()) { if (boardSnap) paintProjectBadges(); loadBoard().then(paintProjectBadges).catch(() => { }); }
  if (tasksOn()) { if (tasksSnap) paintTaskBadges(); loadTasks().then(paintTaskBadges).catch(() => { }); }
  if (vaultOn()) { if (typeof vaultSnap !== 'undefined' && vaultSnap) paintVaultBadges(); loadVault().then(paintVaultBadges).catch(() => { }); }
  if (inboxOn()) { if (inboxSnap) paintInboxBadges(); loadInbox().then(paintInboxBadges).catch(() => { }); } // 1.69
}
async function paintRail() {
  const el = $('#rail'); if (!el) return;
  const ft = $('#rail-filter-toggle'); if (ft) ft.hidden = railView() !== 'sessions';
  if (railView() === 'projects') { if (!el.querySelector('.rail-board')) el.innerHTML = ''; paintRailProjects(); return; } // 1.77.3: .rail-board is the project list alone; .rail-projects is also the Tasks, Vault and Inbox lists' styling class
  if (railView() === 'documents') { if (!el.querySelector('.rail-documents')) el.innerHTML = ''; paintRailDocuments(); return; }
  if (railView() === 'tasks') { if (!el.querySelector('.rail-tasks')) el.innerHTML = ''; paintRailTasks(); return; } // 1.36
  if (railView() === 'vault') { if (!el.querySelector('.rail-vault')) el.innerHTML = ''; paintRailVault(); return; } // 1.39
  if (railView() === 'inbox') { if (!el.querySelector('.rail-inbox')) el.innerHTML = ''; paintRailInbox(); return; } // 1.69
  if (!el.querySelector('.session-panel')) { el.innerHTML = sessionPanelHTML(true); bindSessionPanel(el); }
  await refreshSessions();
}

let chatOffset = 0, chatTurnEvents = null, chatAttachKey = null, chatLastItem = null, extT = null;
function extPulse() { // ember while another surface (code-server) drives this session
  const h = $('#hember'); if (!h) return;
  if (!composerWorking) h.innerHTML = '<span class="ember"></span>';
  clearTimeout(extT);
  extT = setTimeout(() => { const h2 = $('#hember'); if (h2 && !composerWorking) h2.innerHTML = ''; }, 45000);
}

// away: this render is you arriving (opening the session, or coming back to the app), so new work since you last
// looked is marked. Re-renders of a conversation you are watching (turn end, resync, rail toggle) never mark it.
async function renderChat(id, { away = false } = {}) {
  const renderVersion = ++chatRenderVersion;
  const awaySince = away && !pendingFind ? Math.max(seenAt(id), Number(viewedAt[id]) || 0) : 0; // a search result opens at its match instead
  stashAttachments();rememberReading();
  if (chatId !== id) Voice.onLeave(id);
  chatId = id; closeES();
  fmarks = []; fidx = -1; // marks from the previous render are gone with the DOM
  awayFollow = false;
  const chatCol = `
    <header class="bar">
      ${PANE ? `<button class="icon" id="pane-main" aria-label="Make this the main conversation">${IC.swap}</button>` : `<button class="icon" id="back" aria-label="Back">${IC.back}</button>
      <button class="icon desk" id="railtog" aria-label="Show or hide the conversation list">${IC.panel}</button>`}
      <h1><span class="one" id="ctitle">Conversation</span><span class="tag" id="cproj"></span></h1>
      <span id="hember"></span>
      <div class="chat-statebar" id="chat-statebar"><button id="session-switch" class="session-switch">Conversations</button><button id="results-open" class="session-switch">Results</button><button id="queue-open" class="session-switch">Queue</button><button id="git-open" class="session-switch">Git</button></div>
      <button class="icon" id="chgb" aria-label="Changed files">${IC.diff}</button>
      <button class="icon" id="sideb" aria-label="Side chat">${IC.chat}</button>
      <button class="icon" id="findb" aria-label="Find in conversation">${IC.search}</button>
      <button class="icon" id="chatmore" aria-label="Conversation options">${IC.more}</button>
      ${PANE ? '' : `<button class="icon desk" id="splitb" aria-label="Split view">${IC.columns}</button>`}
      <button class="icon" id="header-toggle" aria-label="Collapse conversation header" title="Collapse conversation header" aria-expanded="true" aria-controls="open-sessions cproj chat-statebar run-confirmation">${IC.up1}</button>
      ${PANE ? `<button class="icon" id="pane-close" aria-label="Close this pane">${IC.x}</button>` : ''}
    </header>
    <section class="conversation-controls" id="conversation-controls" aria-label="Conversation controls"><p class="lineage" id="lineage" hidden></p><div class="run-confirmation" id="run-confirmation" data-state="unknown"><span id="run-confirmed-state" role="status">Checking server…</span><span id="run-confirmed-at" aria-live="off"></span></div>
    <button id="agents-open" class="agents-open" aria-haspopup="dialog" hidden></button>
    <div class="question-banner" id="questions-open" hidden>${String(id).startsWith('cx:') ? 'Codex' : String(id).startsWith('acp:') ? 'OpenRouter' : 'Claude'} has a question</div>
    <div class="question-banner" id="approvals-open" hidden>Waiting for your OK · Review</div>
    <p id="connection-state" class="connection-state" role="status" hidden></p>
    <div class="findbar" id="findbar" hidden>
      <input type="search" id="fq" placeholder="Find in conversation" autocomplete="off" enterkeyhint="search">
      <span class="fcount" id="fcount"></span>
      <button class="icon" id="fprev" aria-label="Previous match">${IC.up1}</button>
      <button class="icon" id="fnext" aria-label="Next match">${IC.down1}</button>
      <button class="icon" id="fclose" aria-label="Close find">${IC.x}</button>
    </div>
    <div class="fmore" id="fmore" hidden></div></section>
    <main class="scroll"><div class="msgs" id="msgs"></div></main>
    <section class="composerwrap" aria-label="Message composer"><div class="delivery-status" id="delivery-status" role="status" hidden></div><div class="slash" id="slash" role="listbox" aria-label="Commands and skills" tabindex="0" hidden></div><div class="voice-strip" id="voice-strip" role="status" aria-live="polite" hidden></div><div class="composer" id="comp"></div></section>`;
  app.innerHTML = withShell(chatCol) + '<input type="file" id="fpick" multiple hidden>';
  wireShell();
  if (PANE) { $('#pane-main').onclick = () => paneSay('main'); $('#pane-close').onclick = () => paneSay('close'); }
  else { $('#back').onclick = () => { location.hash = '#/'; }; $('#splitb').onclick = chooseBeside; }
  $('#session-switch').onclick = openSessionSwitcher;
  $('#results-open').onclick = () => openResults(chatId);
  $('#queue-open').onclick = () => openQueue(chatId);
  $('#git-open').onclick = () => openGit(chatId);
  $('#questions-open').onclick=e=>{if(!e.target.closest?.('[data-act]'))openQuestions(chatId);};
  $('#approvals-open').onclick=e=>{if(!e.target.closest?.('[data-act]'))openApprovals(chatId);};
  $('#chgb').onclick = () => openChanges();
  $('#findb').onclick = () => findOpen(!findIsOpen());
  const sideb = $('#sideb'); if (sideb) sideb.onclick = () => SideChat.toggle(chatId); // 1.78
  $('#fq').oninput = e => { findRun(e.target.value); findDeep(e.target.value.trim()); };
  $('#fq').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); } };
  $('#fprev').onclick = () => findStep(-1);
  $('#fnext').onclick = () => findStep(1);
  $('#fclose').onclick = () => findOpen(false);
  const tog = $('#railtog');
  if (tog) tog.onclick = () => { localStorage.setItem('pc-rail', railOpen() ? 'closed' : 'open'); renderChat(chatId); };
  let s;
  try { s = await api('/session/' + id); }
  catch (e) { if (renderVersion !== chatRenderVersion) return; toast(e.status === 404 ? 'Conversation not found' : 'Could not open conversation: ' + (e.message || 'error')); location.hash = '#/'; return; }
  if (renderVersion !== chatRenderVersion || chatId !== id) return;
  markRead(id, s.state);
  $('#ctitle').textContent = s.title;
  $('#ctitle').title = s.title;
  $('#cproj').textContent = projName(s.cwd);
  const gitButton = $('#git-open'); if (gitButton) gitButton.hidden = s.repo === false; // 1.20.1: no Git control outside a repository
  paintChatProject(s); // 1.29: the linked project, or Add project
  Branch.paintLineage(s); // 1.79: Branch of …, and this conversation's branches
  if (PANE) paneSay('route', { id, title: s.title }); else if (!SOLO) rememberOpenSession({...s,id}); // a solo window is not a tab of the main one
  chatTitle = s.title; chatPinned = Boolean(s.pinned);
  const h1 = $('#ctitle').closest('h1');
  h1.classList.add('tappable');
  $('#chatmore').onclick = h1.onclick = () => sessionSheet({ id: chatId, title: chatTitle, pinned: chatPinned }, r => {
    if (typeof r.pinned === 'boolean') chatPinned = r.pinned;
    else if (r.name) { chatTitle = r.name; const t = $('#ctitle'); if (t) t.textContent = r.name; }
    else { renderChat(chatId); return; } // name cleared → resync the derived title
    railCache.at = 0; if (isWide()) paintRail();
  });
  const isCx = id.startsWith('cx:'), isAcp = id.startsWith('acp:'), prov = isCx ? 'codex' : isAcp ? 'acp' : 'claude';
  tb = { key: id, prefs: getPrefs(id), attachments: loadAttachments(id), allowAttach: true, allowMute: true, provider: prov };
  (isCx ? loadCodexModels() : isAcp ? loadAcpModels() : loadClaudeModels()).then(renderToolbar);
  chatMuted = Boolean(s.muted);
  if(s.executionMode){tb.prefs.executionMode=s.executionMode;setPrefs(id,tb.prefs);}
  slashCwd = s.cwd || '';
  // 1.83: the / picker's skills and the CLI's own commands for this folder (1.79.1: /btw on Codex too, in SLASH_POCKET)
  slashLists.delete(prov + '|' + slashCwd); slashLoad(prov, slashCwd);
  $('#fpick').onchange = e => { uploadFiles([...e.target.files]); e.target.value = ''; };
  const msgs = $('#msgs');
  paintTranscript(id, s, msgs);
  setComposer(s.active);
  const reading=readingPositions[id],scroller=msgs.closest('main.scroll');
  if(reading&&!reading.bottom)scroller.scrollTop=reading.top;else scrollBottom(true);
  if(awaySince)paintAway(id,awaySince,renderVersion);
  if(pendingFind)applyPendingFind();
  scroller.addEventListener('scroll',()=>{clearTimeout(readingTimer);readingTimer=setTimeout(rememberReading,200);},{passive:true});
  if (s.ext && !s.active) extPulse();
  paintDelivery(id); refreshSessions();
  refreshQuestions(id);
  refreshApprovals(id);
  restoreDock();
  refreshAgents(id);
  paintContextMeter(id);
  openES(); // always: daemon turns stream events, idle sessions mirror the transcript live
}

function paintTranscript(id, s, msgs) {
  chatOffset = s.size || 0; chatTurnEvents = Number.isInteger(s.turnEvents) ? s.turnEvents : null; chatAttachKey = null; chatLastItem = null;
  chatTotal = s.total || s.messages.length; chatRendered = s.messages.length;
  fmarks = []; fidx = -1;
  msgs.classList.toggle('times-off', !showTimes());
  msgs.innerHTML = withDays(s.messages) + steeredHTML(id, s.messages);
  mergeToolFolds(msgs);
  paintFileCards(msgs, true);
  openLastTodo();
  paintChoices();
  if (lastMeta && lastMeta.id === id) { msgs.insertAdjacentHTML('beforeend', lastMeta.html); lastMeta = null; }
}
// 1.77.4: sending and a turn's end bring the open conversation up to date without rebuilding the page. Both used
// renderChat, which replaced the rail, header and composer and left the list empty until the transcript arrived,
// so the whole screen blinked. Only the list is replaced, once the transcript is here; anything else is a full render.
let chatResyncVersion = 0;
async function resyncChat(id) {
  const msgs = $('#msgs');
  if (chatId !== id || !msgs || tb?.key !== id) return renderChat(id);
  const renderVersion = chatRenderVersion, resync = ++chatResyncVersion;
  const current = () => renderVersion === chatRenderVersion && resync === chatResyncVersion && chatId === id && msgs.isConnected;
  closeES();
  let s;
  try { s = await api('/session/' + id); }
  catch { if (current()) renderChat(id); return; } // as before: a failed read is a full render, with its message
  if (!current()) return;
  markRead(id, s.state);
  chatTitle = s.title; const t = $('#ctitle'); if (t) { t.textContent = s.title; t.title = s.title; }
  chatMuted = Boolean(s.muted);
  const scroller = msgs.closest('main.scroll'), top = scroller.scrollTop;
  const atEnd = scroller.scrollHeight - top - scroller.clientHeight < 100;
  paintTranscript(id, s, msgs);
  msgs.querySelectorAll('.enter').forEach(n => n.classList.remove('enter')); // 1.77.5: these were on screen already; replaying the fade-in blinked the list
  if (composerWorking !== Boolean(s.active)) { // Working ↔ Reply is a different composer; the same state keeps the box and what is in it
    const typing = document.activeElement?.id === 'box';
    setComposer(s.active);
    if (typing) $('#box')?.focus();
  } else if (!composerWorking) renderToolbar(); // the sent files' chips go, and the mute chip follows the server
  if (atEnd) scrollBottom(true); else scroller.scrollTop = top;
  if (s.ext && !s.active) extPulse();
  paintDelivery(id); refreshSessions();
  refreshQuestions(id);
  refreshApprovals(id);
  refreshAgents(id);
  paintContextMeter(id);
  openES();
}

/* ---------- 1.21 / 1.25: While you were away ----------
   Arriving at a conversation with work you have not seen: a "New since 8:40 PM" divider marks the first new
   message, and (1.25) the conversation opens at the end instead of at the divider. An away card under the
   latest message repeats the time with a "Read from there" button that jumps to the divider, and when the
   new part is more than a short exchange it carries a short summary from the helper model (Settings: same
   model as titles). The card sits above the latest reply's suggested replies, so the summary and the choices
   share the screen. Nothing is sent when the new part is only your own messages. */
let awayAnchor = null, awayFollow = false;
function anchorAway() {
  const d = awayAnchor; if (!d?.isConnected) return;
  const scroller = d.closest('main.scroll'); scroller.scrollTop += d.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
}
function awayTimeLabel(ms) {
  const d = new Date(ms), now = new Date(), t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return t;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'yesterday ' + t;
  return (now - d < 6 * 86400000 ? d.toLocaleDateString([], { weekday: 'short' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' })) + ' ' + t;
}
function paintAway(id, since, renderVersion) {
  const msgs = $('#msgs'); if (!msgs || chatId !== id) return;
  const rows = [...msgs.querySelectorAll(':scope > [data-ts]')];
  const first = rows.find(e => (Date.parse(e.dataset.ts) || 0) > since);
  if (!first) return;
  const fresh = rows.slice(rows.indexOf(first));
  const agent = fresh.filter(e => e.classList.contains('m-asst'));
  if (!agent.length) return;                                    // only your own messages since: nothing to point out
  const label = 'New since ' + awayTimeLabel(since);
  first.insertAdjacentHTML('beforebegin', `<div class="away-divider" id="away-divider" role="separator" aria-label="${esc(label)}"><span>${esc(label)}</span></div>`);
  const divider = $('#away-divider'), scroller = msgs.closest('main.scroll');
  // Summary only for more than a short exchange; the server checks the same rule before calling a model.
  const tools = fresh.reduce((n, e) => n + e.querySelectorAll('.ledger').length, 0);
  const chars = agent.reduce((n, e) => n + (e.textContent || '').length, 0);
  const wantSummary = tools >= 3 || agent.length >= 2 || chars >= 600;
  // The card goes under the last message, above its suggested replies when it has any.
  const lastRow = rows.at(-1), choices = lastRow.classList.contains('m-asst') ? lastRow.querySelector(':scope > .choices') : null;
  const cardHTML = `<section class="away-card away-end enter" id="away-card" aria-labelledby="away-card-label"><p class="away-label"><span id="away-card-label">${esc(label)}</span><button type="button" class="away-jump" id="away-jump" aria-label="Read from the first new message">Read from there</button></p>${
    wantSummary ? '<div class="away-body" role="status">Summarizing what happened…</div>' : ''}</section>`;
  if (choices) choices.insertAdjacentHTML('beforebegin', cardHTML); else lastRow.insertAdjacentHTML('afterend', cardHTML);
  // Open at the end and stay there while the page settles (toolbar, stream catch-up, the summary arriving),
  // until you scroll, tap or type. Read from there moves to the divider and holds it instead.
  const dividerOnScreen = () => divider.isConnected && divider.getBoundingClientRect().bottom >= scroller.getBoundingClientRect().top;
  const trimCard = () => { const c = $('#away-card'); if (c && !c.querySelector('.away-body') && dividerOnScreen()) c.remove(); };
  const settle = () => { if (chatId !== id || renderVersion !== chatRenderVersion) return; if (awayFollow) scrollBottom(true); else anchorAway(); trimCard(); };
  awayAnchor = null; awayFollow = true; scrollBottom(true); trimCard();
  const release = () => { awayFollow = false; awayAnchor = null; };
  ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(t => scroller.addEventListener(t, release, { passive: true }));
  const jump = $('#away-jump');
  if (jump) jump.onclick = () => { awayFollow = false; awayAnchor = divider; anchorAway(); };
  requestAnimationFrame(() => setTimeout(settle, 300));
  if (!wantSummary) return;
  api(`/session/${encodeURIComponent(id)}/away`, { method: 'POST', body: JSON.stringify({ since }), signal: AbortSignal.timeout(100000) })
    .then(r => {
      const card = $('#away-card'); if (!card || chatId !== id || renderVersion !== chatRenderVersion) return;
      const body = card.querySelector('.away-body');
      if (!r.summary) { body?.remove(); trimCard(); return; }
      body.innerHTML = '<ul>' + r.summary.split('\n').map(l => '<li>' + esc(l) + '</li>').join('') + '</ul>';
      card.insertAdjacentHTML('beforeend', `<p class="away-source">Summary by ${esc(r.provider === 'codex' ? (r.model || 'Codex') : modelLabel(r.model) || 'Claude')}. Read the messages for the details.</p>`);
      requestAnimationFrame(settle);
    })
    .catch(() => { $('#away-card .away-body')?.remove(); trimCard(); });
}

/* ---------- subagent activity ---------- */
const agentCache = new Map(), agentFetches = new Map();
const agentLabels = {running:'Working',pending:'Starting',completed:'Completed',failed:'Failed',interrupted:'Interrupted',closed:'Closed',unknown:'Status unconfirmed'};
function agentsFresh(d) { return d && !d.error && Date.now()-d.receivedAt<15000; }
// 1.82: the row also carries the session's background jobs (a command left running, an agent after the reply ended),
// which before showed only in the status bar's tooltip, and each agent can open its own transcript.
const backgroundOf=id=>allSessions.find(s=>s.id===id)?.state?.background||null;
function paintAgents() {
  const d=agentCache.get(chatId), b=$('#agents-open'), bg=backgroundOf(chatId);
  if(b){
    b.hidden=!d?.total&&!bg;
    if(!b.hidden){
      const jobs=bg?.jobs?.filter(j=>j.kind==='job').length||0, plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;
      const label=d?.total&&!agentsFresh(d)?'Subagents · status unavailable'
        :d?.running?`${plural(d.running,'subagent')} working${jobs?` · ${plural(jobs,'background job')}`:''}`
        :bg?`Working in background · ${bg.summary}`
        :`Subagents · ${d.total} recorded`;
      b.textContent=label+' · View'; b.setAttribute('aria-label',label+'. View what each one is doing');
    }
  }
  const sh=document.querySelector('.agents-sheet');if(!sh)return;
  const data=agentCache.get(sh.dataset.session), jobsLine=sh.querySelector('.agents-jobs'), sbg=backgroundOf(sh.dataset.session);
  if(jobsLine){const plain=sbg?.jobs?.filter(j=>j.kind==='job')||[];jobsLine.hidden=!plain.length;jobsLine.textContent=plain.length?`Background ${plain.length===1?'job':'jobs'}: ${plain.map(j=>j.description||'a command').join('; ')}.`:'';}
  if(!data)return;
  const fresh=agentsFresh(data), status=sh.querySelector('.agents-status'), list=sh.querySelector('.agents-list');
  status.textContent=!fresh?'Activity could not be confirmed. Showing the last available details.':data.total?`${data.running} working · ${data.total} recorded. Updates every 5 seconds.`:'No subagents recorded in this conversation yet.';
  sh.querySelector('.agents-retry').hidden=fresh;
  sh.querySelector('.agents-limit').hidden=!data.truncated;
  const keep=new Set();
  for(const a of data.agents||[]){
    keep.add(a.id);
    let row=[...list.children].find(el=>el.dataset.agent===a.id);
    if(!row){
      row=document.createElement('details');row.className='agent-row';row.dataset.agent=a.id;
      row.innerHTML='<summary><span class="agent-name"></span><span class="agent-state"></span></summary><div class="agent-detail"></div><div class="agent-more" hidden><button type="button" class="chip agent-activity-open" aria-expanded="false">Show activity</button><div class="agent-activity" role="log" aria-label="Subagent activity" hidden></div></div>';
      row.querySelector('.agent-activity-open').onclick=()=>toggleAgentActivity(sh.dataset.session,row);
      list.append(row);
    }
    const name=row.querySelector('.agent-name'), badge=row.querySelector('.agent-state');
    name.textContent=a.name==='Subagent'?`Subagent ${a.id.slice(0,8)}`:a.name;
    const state=!fresh&&['running','pending'].includes(a.status)?'unknown':a.status;
    badge.textContent=agentLabels[state]||'Status unconfirmed';badge.dataset.state=state;
    const facts=[a.kind,a.model,a.background?'in the background':''].filter(Boolean).join(' · ');
    const counts=a.usage?[Number.isFinite(a.usage.tools)?a.usage.tools+' tool calls':null,Number.isFinite(a.usage.tokens)?a.usage.tokens.toLocaleString()+' tokens':null]:[Number.isFinite(a.steps)?a.steps+' tool calls':null,Number.isFinite(a.messages)?a.messages+(a.messages===1?' message':' messages'):null];
    const html=(facts?`<p class="agent-meta">${esc(facts)}</p>`:'')+`<h3>Task</h3><p class="agent-copy">${esc(a.task||'The provider did not record a task description.')}</p><h3>Latest activity</h3><p class="agent-copy">${esc(a.latest||'No activity details reported yet.')}</p>`+
      (counts.filter(Boolean).length?`<p class="agent-meta">${esc(counts.filter(Boolean).join(' · '))}</p>`:'');
    const detail=row.querySelector('.agent-detail');if(detail.innerHTML!==html)detail.innerHTML=html;
    row.querySelector('.agent-more').hidden=!a.activity;
    if(row.dataset.activity==='1'&&row.open&&['running','pending'].includes(a.status))loadAgentActivity(sh.dataset.session,row); // follow a working agent
  }
  for(const row of [...list.children])if(!keep.has(row.dataset.agent))row.remove();
}
function toggleAgentActivity(id,row){
  const button=row.querySelector('.agent-activity-open'), box=row.querySelector('.agent-activity'), open=row.dataset.activity!=='1';
  row.dataset.activity=open?'1':'';button.setAttribute('aria-expanded',String(open));button.textContent=open?'Hide activity':'Show activity';box.hidden=!open;
  if(open){box.innerHTML='<p class="sheet-help">Loading…</p>';loadAgentActivity(id,row);}
}
const agentActivityLoads=new Map();
async function loadAgentActivity(id,row){
  const key=id+'/'+row.dataset.agent;if(agentActivityLoads.has(key))return;
  const box=row.querySelector('.agent-activity');
  const load=(async()=>{
    try{
      const d=await api('/session/'+encodeURIComponent(id)+'/agents/'+encodeURIComponent(row.dataset.agent)+'/activity',{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!box.isConnected||row.dataset.activity!=='1')return;
      const shown=d.messages.slice(-60);
      const html=`<p class="agent-meta">${esc([d.agent.steps+' tool call'+(d.agent.steps===1?'':'s'),d.agent.messages+' message'+(d.agent.messages===1?'':'s'),d.total>shown.length?'last '+shown.length+' shown':''].filter(Boolean).join(' · '))}</p>`+
        (shown.length?shown.map(m=>m.role==='user'?`<div class="agent-brief">${esc(m.text)}</div>`:msgHTML(m)).join(''):'<p class="sheet-help">Nothing written yet.</p>');
      if(box.dataset.html===html)return;
      const atEnd=box.scrollHeight-box.scrollTop-box.clientHeight<60||!box.dataset.html;
      box.dataset.html=html;box.innerHTML=html;
      box.querySelectorAll('details.ledgerwrap').forEach(f=>f.open=true); // the steps are the point here
      box.querySelectorAll('.enter').forEach(n=>n.classList.remove('enter'));
      if(atEnd)box.scrollTop=box.scrollHeight;
    }catch(e){if(box.isConnected&&!box.dataset.html)box.innerHTML=`<p class="sheet-help">${esc(e.message||'Activity could not be loaded.')}</p>`;}
    finally{agentActivityLoads.delete(key);}
  })();
  agentActivityLoads.set(key,load);return load;
}
async function refreshAgents(id) {
  if(!id)return;
  if(agentFetches.has(id))return agentFetches.get(id);
  const pending=(async()=>{
    try {
      const d=await api('/session/'+encodeURIComponent(id)+'/agents',{cache:'no-store',signal:AbortSignal.timeout(10000)});
      agentCache.set(id,{...d,receivedAt:Date.now()});
      if(agentCache.size>60)agentCache.delete(agentCache.keys().next().value);
    }catch{agentCache.set(id,{...agentCache.get(id),error:true});}
    finally{agentFetches.delete(id);paintAgents();}
  })();
  agentFetches.set(id,pending);return pending;
}
function openAgentsPanel(id=chatId) {
  if(!id)return;
  const scrim=document.createElement('div');scrim.className='scrim';
  const sh=document.createElement('div');sh.className='sheet agents-sheet';sh.dataset.session=id;
  sh.innerHTML='<h2>Subagents</h2><p class="sheet-help agents-jobs" hidden></p><p class="sheet-help agents-status" role="status">Loading subagent activity…</p><button class="chip agents-retry" hidden>Retry</button><div class="agents-list"></div><p class="sheet-help agents-limit" hidden>Showing recent activity. Older details may be omitted.</p>';
  sh.querySelector('.agents-retry').onclick=()=>refreshAgents(id);
  mountSheet(scrim,sh);paintAgents();refreshAgents(id);
}
document.addEventListener('click',e=>{if(e.target.closest?.('#agents-open'))openAgentsPanel();});
setInterval(()=>{if(document.visibilityState==='visible'){
  const ids=new Set([chatId,document.querySelector('.agents-sheet')?.dataset.session]);
  for(const id of ids)if(id)refreshAgents(id);
  paintAgents();
}},5000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){paintAgents();refreshAgents(chatId);}});

/* ---------- usage visibility (1.7): context meter + plan-usage panel ---------- */
function fmtTokens(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) { const m = n / 1_000_000; return (Math.round(m * 10) / 10).toString().replace(/\.0$/, '') + 'M'; }
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(n);
}
// Context ring (1.13): a small gauge in the composer that fills as the session's context window fills.
// Hover or focus shows window, used and percentage; a click opens this session's usage (context + plan).
const ctxCache = new Map(); // sessionId -> context summary from /api/session/:id/context
const CTX_RING = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ctx-track" cx="12" cy="12" r="8.5"/><circle class="ctx-fill" cx="12" cy="12" r="8.5" pathLength="100" stroke-dasharray="0 100" transform="rotate(-90 12 12)"/></svg>';
const ctxRingHTML = () => `<button type="button" class="icon ctx-ring" id="ctx-ring" aria-haspopup="dialog">${CTX_RING}<span class="ctx-cache" aria-hidden="true"></span></button>`;
function modelLabel(id) {
  if (!id) return '';
  const bare = String(id).replace(/\[1m\]$/, '');
  const known = MODELS.find(m => String(m[0]).replace(/\[1m\]$/, '') === bare)?.[1];
  if (known) return known;
  const m = bare.match(/^claude-([a-z]+)-(\d+(?:-\d+)*?)(?:-\d{8})?$/);  // claude-opus-5-5 → Opus 5.5 (not in the picker list)
  return m ? m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2].replace(/-/g, '.') : String(id);
}
function ctxPctText(ctx) { return ctx.used > 0 && ctx.pct < 0.005 ? '<1' : String(Math.round(ctx.pct * 100)); }
function ctxLine(ctx) { return `${fmtTokens(ctx.used)} of ${fmtTokens(ctx.window)} tokens used (${ctxPctText(ctx)}%${ctx.estimated ? ', estimated' : ''})`; }
function paintCtxRing() {
  const el = $('#ctx-ring'); if (!el) return;
  paintRingContext(el);
  paintRingCache(el);
}
function paintRingContext(el) {
  const ctx = ctxCache.get(chatId);
  const fill = el.querySelector('.ctx-fill');
  if (!ctx || !ctx.window) {
    fill.setAttribute('stroke-dasharray', '0 100'); el.dataset.level = '';
    el.dataset.tip = 'Context window: shown after the next reply reports it. Click for plan usage.';
    el.setAttribute('aria-label', 'Context window not reported yet. Open usage');
    return;
  }
  const pct = Math.max(0, Math.min(1, ctx.pct || 0));
  fill.setAttribute('stroke-dasharray', `${Math.max(pct * 100, ctx.used > 0 ? 2 : 0).toFixed(1)} 100`);
  el.dataset.level = pct >= 0.9 ? 'red' : pct >= 0.7 ? 'amber' : '';
  const model = modelLabel(ctx.model);
  el.dataset.tip = `${model ? model + ' · ' : ''}${ctxLine(ctx)}`;
  el.setAttribute('aria-label', `Context window${model ? ' for ' + model : ''}: ${ctxLine(ctx)}. Open usage`);
}
async function paintContextMeter(id) {
  let ctx, cache, serverNow;
  try { ({ context: ctx, cache, serverNow } = await api('/session/' + id + '/context')); } catch { return; }
  if (ctx) ctxCache.set(id, ctx); else ctxCache.delete(id);
  if (cache) cacheData.set(id, cache); else cacheData.delete(id);
  if (Number.isFinite(serverNow)) serverSkew = serverNow - Date.now();
  if (chatId === id) paintCtxRing();
}

/* ---------- prompt-cache warmth (1.28) ---------- */
// The server estimates it from the transcript's last request: when it ran (at) and the cache lifetime it
// used (ttlMs: one hour or five minutes for Claude; two hours for Codex, measured, since 1.48). Each request
// restarts the lifetime; after it, the next turn writes the whole context to cache again instead of reading
// it. An estimate: the provider can evict sooner.
const cacheData = new Map(); // sessionId -> { at, ttlMs, ttlKnown, cached, lastTurn }
const CACHE_MARK_MIN = 100_000; // tabs flag only sessions big enough for a cold start to cost real usage
function cacheStatus(c, now = Date.now() + serverSkew) {
  if (!c || !Number.isFinite(c.at) || !(c.ttlMs > 0)) return null;
  const expiresAt = c.at + c.ttlMs, left = expiresAt - now;
  const kind = left <= 0 ? 'cold' : left <= Math.min(10 * 60_000, c.ttlMs * 0.2) ? 'cooling' : 'warm';
  return { kind, left, expiresAt };
}
const cacheMinutes = ms => Math.floor(ms / 60_000);
const cacheLeftShort = ms => cacheMinutes(ms) < 1 ? '<1m' : cacheMinutes(ms) + 'm';
const cacheLeftLong = ms => cacheMinutes(ms) < 1 ? 'less than a minute' : 'about ' + cacheMinutes(ms) + ' min';
function cacheSentence(c, st) {
  if (st.kind === 'cold') return `Prompt cache expired at ${fmtAsOf(st.expiresAt)}; the next reply writes ${fmtTokens(c.cached)} tokens to cache again`;
  return `Prompt cache ${st.kind === 'cooling' ? 'cooling' : 'warm'}: ${cacheLeftLong(st.left)} left, until ${fmtAsOf(st.expiresAt)}`;
}
// The ring's companion label: minutes left while warm, amber in the last stretch, "cold" once expired.
function paintRingCache(el) {
  const label = el.querySelector('.ctx-cache'), c = cacheData.get(chatId), st = cacheStatus(c);
  if (!label) return;
  if (!st) { label.textContent = ''; delete el.dataset.cache; return; }
  label.textContent = st.kind === 'cold' ? 'cold' : cacheLeftShort(st.left);
  el.dataset.cache = st.kind;
  const sentence = cacheSentence(c, st);
  el.dataset.tip += ' · ' + sentence;
  el.setAttribute('aria-label', el.getAttribute('aria-label').replace(/\. Open usage$/, '') + '. ' + sentence + '. Open usage');
}
// Countdowns move without a turn: repaint the ring each half minute (the tabs repaint with the list poll).
setInterval(() => { if (document.visibilityState === 'visible' && chatId && cacheData.has(chatId)) paintCtxRing(); }, 30_000);
function cacheBlockHTML(c) {
  const st = cacheStatus(c); if (!st) return '';
  const head = st.kind === 'cold' ? 'Cold' : `${st.kind === 'cooling' ? 'Cooling' : 'Warm'} · ${cacheLeftLong(st.left)} left`;
  const hours = c.ttlMs / 3_600_000, life = hours >= 1 ? (hours === 1 ? '1 hour' : Math.round(hours) + ' hours') : Math.round(c.ttlMs / 60_000) + ' minutes';
  const t = c.lastTurn, pct = t && t.hit != null ? Math.floor(t.hit * 100) : null;
  // dated, so a warm start shown beside "Cold" reads as history rather than a contradiction
  const last = pct == null ? '' : `The last reply, at ${fmtAsOf(t.at)}, started ` + (t.hit >= 0.5 ? `${pct}% from cache.` : `cold: ${fmtTokens(t.written)} tokens written to cache.`);
  const next = st.kind === 'cold' ? 'The next reply writes the context to cache again, which uses more of your plan than reading it.' : 'A reply before then reads the context from cache at a fraction of the cost.';
  return `<div class="usage-block cache-block"><h3>Prompt cache</h3>
    <div class="usage-row-head"><span>Status</span><span class="cache-state" data-cache="${st.kind}">${esc(head)}</span></div>
    <dl class="ctx-facts"><div><dt>${st.kind === 'cold' ? 'Expired' : 'Expires'}</dt><dd>${esc(fmtAsOf(st.expiresAt))}</dd></div><div><dt>Cached</dt><dd>${esc(fmtTokens(c.cached))} tokens</dd></div><div><dt>Lifetime</dt><dd>${esc(life)}${c.ttlKnown ? '' : ' (' + esc(c.ttlNote || 'assumed') + ')'}</dd></div></dl>
    ${last ? `<p class="usage-reset">${esc(last)}</p>` : ''}
    <p class="usage-asof">${esc(next)} Estimated from the last request at ${esc(fmtAsOf(c.at))}; each request restarts the lifetime, and the provider can drop a cache sooner.</p></div>`;
}
async function openContextPanel() {
  const id = chatId; if (!id) return;
  const ctx = ctxCache.get(id), codexSession = String(id).startsWith('cx:');
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet usage-sheet';
  const model = modelLabel(ctx?.model);
  const ctxBlock = ctx?.window
    ? `<div class="usage-block"><h3>This conversation${model ? ' · ' + esc(model) : ''}</h3>${usageWindowRow('Context window', ctx.pct, null)}
       <dl class="ctx-facts"><div><dt>Window</dt><dd>${esc(fmtTokens(ctx.window))} tokens</dd></div><div><dt>Used</dt><dd>${esc(fmtTokens(ctx.used))} tokens</dd></div><div><dt>Free</dt><dd>${esc(fmtTokens(Math.max(0, ctx.window - ctx.used)))} tokens</dd></div></dl>
       <p class="usage-asof">${ctx.estimated ? 'Estimated from the transcript. ' : ''}As of ${esc(fmtAsOf(ctx.lastAt))}</p></div>`
    : '<div class="usage-block"><h3>This conversation</h3><p class="usage-empty">Context use appears after the next reply reports it.</p></div>';
  sh.innerHTML = `<h2>Usage</h2><p class="sheet-help">Only updates when a reply runs, not live.</p><div class="usage-body">${ctxBlock}${cacheBlockHTML(cacheData.get(id))}</div><div class="usage-body" id="usage-body">Loading plan usage…</div>`;
  mountSheet(scrim, sh);
  let d;
  try { d = await api('/usage'); } catch (e) { sh.querySelector('#usage-body').innerHTML = `<p class="usage-empty">Plan usage could not be loaded: ${esc(e.message)}</p>`; return; }
  if (!sh.isConnected) return;
  sh.querySelector('#usage-body').innerHTML = codexSession ? (d.codex ? codexUsageBlockHTML(d.codex) : '<div class="usage-block"><h3>Codex</h3><p class="usage-empty">No Codex usage reported.</p></div>') : claudeUsageBlockHTML(d.claude || {});
}
document.addEventListener('click', e => { if (e.target.closest?.('#ctx-ring')) openContextPanel(); });
// 1.77.6: the viewer's own time zone, named ("6:00 AM EST"), not Eastern for everyone.
const zoneTime = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
function fmtReset(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  return d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + zoneTime(d);
}
function fmtAsOf(ms) {
  if (!ms) return 'not yet observed';
  const d = new Date(ms), today = d.toDateString() === new Date().toDateString();
  return (today ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ') + zoneTime(d);
}
function usageWindowRow(label, pct, resetsAt) {
  const safePct = Math.max(0, Math.min(1, pct || 0));
  const level = safePct >= 0.9 ? 'red' : safePct >= 0.7 ? 'amber' : '';
  const reset = fmtReset(resetsAt), passed = resetsAt && resetsAt < Date.now();
  // a window that reset since the last observation is not at this percentage any more
  const resetText = !reset ? '' : passed ? `Reset ${reset} — the figure is from before that` : `Resets ${reset}`;
  return `<div class="usage-row">
    <div class="usage-row-head"><span>${esc(label)}</span><span class="usage-pct" data-level="${passed ? '' : level}">${passed ? 'was ' : ''}${Math.round(safePct * 100)}%</span></div>
    <div class="meter" role="img" aria-label="${esc(label)}: ${Math.round(safePct * 100)}% used${resetText ? ', ' + resetText : ''}"><div class="meter-fill" data-level="${passed ? '' : level}" style="width:${Math.round(safePct * 100)}%"></div></div>
    ${resetText ? `<p class="usage-reset">${esc(resetText)}</p>` : ''}
  </div>`;
}
function claudeUsageBlockHTML(d) {
  const w = d.windows || {};
  const rows = [
    w.five_hour && usageWindowRow('5-hour', w.five_hour.utilization, w.five_hour.resetsAt),
    w.seven_day && usageWindowRow('Weekly', w.seven_day.utilization, w.seven_day.resetsAt),
    w.seven_day_overage_included && usageWindowRow('Weekly + extra usage', w.seven_day_overage_included.utilization, w.seven_day_overage_included.resetsAt),
  ].filter(Boolean);
  if (!rows.length) return '<div class="usage-block"><h3>Claude Code</h3><p class="usage-empty">No usage observed yet — it reports usage on the next reply.</p></div>';
  const overage = d.overage ? `<div class="usage-row-head"><span>Extra usage</span><span>${d.overage.using ? 'On' : 'Off'}${d.overage.reason ? ' · ' + esc(String(d.overage.reason).replace(/_/g, ' ')) : ''}</span></div>` : '';
  return `<div class="usage-block"><h3>Claude Code</h3>${rows.join('')}${overage}<p class="usage-asof">As of ${esc(fmtAsOf(d.observedAt))}</p></div>`;
}
function codexUsageBlockHTML(d) {
  // 1.87: the plan windows in words (Codex reports them in minutes: 300 = 5 hours, 10080 = a week)
  const label = w => { const m = w?.windowDurationMins; if (!m) return 'Window'; if (m === 10080) return 'Weekly'; if (m % 1440 === 0) return (m / 1440) + '-day'; return Math.round(m / 60) + '-hour'; };
  const rows = [
    d.primary && usageWindowRow(label(d.primary), (d.primary.usedPercent || 0) / 100, d.primary.resetsAt ? d.primary.resetsAt * 1000 : null),
    d.secondary && usageWindowRow(label(d.secondary), (d.secondary.usedPercent || 0) / 100, d.secondary.resetsAt ? d.secondary.resetsAt * 1000 : null),
  ].filter(Boolean);
  if (!rows.length) return '<div class="usage-block"><h3>Codex</h3><p class="usage-empty">Rate limits aren’t available from this Codex build.</p></div>';
  return `<div class="usage-block"><h3>Codex</h3>${rows.join('')}<p class="usage-asof">As of ${esc(fmtAsOf(d.observedAt))}</p></div>`;
}
async function paintUsageBody(sh) {
  const body = sh.querySelector('#usage-body'); if (!body) return;
  let d;
  try { d = await api('/usage'); } catch (e) { body.innerHTML = `<p class="usage-empty">Usage could not be loaded: ${esc(e.message)}</p>`; return; }
  if (!sh.isConnected) return;
  body.innerHTML = [claudeUsageBlockHTML(d.claude || {}), d.codex ? codexUsageBlockHTML(d.codex) : null].filter(Boolean).join('');
}
async function openUsagePanel() {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet usage-sheet';
  sh.innerHTML = '<h2>Plan usage</h2><p class="sheet-help">Only updates when a reply runs, not live.</p><div class="usage-body" id="usage-body">Loading…</div>';
  mountSheet(scrim, sh);
  await paintUsageBody(sh);
}

function scrollBottom(force) {
  const m = app.querySelector('main.scroll');
  if (!m) return;
  if (!force && awayAnchor?.isConnected) return;               // 1.21: reading from "New since" until you scroll or send
  const near = m.scrollHeight - m.scrollTop - m.clientHeight < 240;
  if (force || near) m.scrollTop = m.scrollHeight;
}

/* ---------- 1.83: the / picker ---------- */
// Typing / at the start of a message lists what can go there, like the terminal: the Claude Code commands most worth
// having (sent to the session, and only those this CLI reports on its init line), Pocket's own actions (they run here
// and send nothing), then the installed skills. Arrow keys move, Enter or Tab picks, Escape closes. A command that needs nothing
// more is sent as soon as it is picked in a conversation; the rest are typed in, ready for the rest of the message.
const SLASH_POCKET = [
  { name: 'btw', desc: 'Ask in a side chat, without adding to this conversation', where: 'chat', working: true, insert: true, ok: () => SideChat.available(chatId) },
  { name: 'branch', desc: 'Start a saved conversation that carries on from here', where: 'chat', working: true, ok: () => Boolean(chatId) && engineHas(providerOf(chatId), 'branch'), act: () => Branch.open(chatId) },
  { name: 'handoff', desc: 'Have the agent write a briefing and offer a fresh conversation', where: 'chat', ok: () => Boolean(chatId), act: () => sendMsg('Hand this off: write a briefing for a new conversation to pick up from here, and give me the handoff card.') },
  { name: 'new', desc: 'Start a new conversation in this folder', where: 'chat', working: true, act: () => { writeLocal('pc-new-start', { cwd: slashCwd }); localStorage.setItem('pc-provider', ['codex', 'acp'].includes(tb?.provider) ? tb.provider : 'claude'); location.hash = '#/new'; } },
  { name: 'model', desc: 'Choose the model for the next reply', where: 'both', ok: () => $('#c-model'), act: () => $('#c-model')?.click() },
  { name: 'effort', desc: 'Choose how much it thinks before answering', where: 'both', ok: () => $('#c-eff'), act: () => $('#c-eff')?.click() },
  { name: 'usage', desc: 'See how much of your plan is used', where: 'both', working: true, act: () => openUsagePanel() },
];
// 1.87: the Claude Code commands Codex has a counterpart for (the server runs them as Codex's own turns).
const SLASH_CODEX = [
  { name: 'compact', desc: 'Summarize the conversation so far to free up context', where: 'chat', run: true },
  { name: 'review', arg: 'base branch', desc: 'Review the uncommitted changes, or the branch against a base branch', where: 'chat' },
  { name: 'recap', desc: 'Sum up where this conversation stands', where: 'chat', run: true },
  { name: 'context', desc: 'Show what is filling the context window', where: 'chat', act: () => openUsagePanel() },
];
const SLASH_CLAUDE = [
  { name: 'compact', arg: 'focus', desc: 'Summarize the conversation so far to free up context', where: 'chat' },
  { name: 'context', desc: 'Show what is filling the context window', where: 'chat', run: true },
  { name: 'recap', desc: 'Sum up where this conversation stands', where: 'chat', run: true },
  { name: 'init', desc: 'Write a CLAUDE.md that describes this project', where: 'both', run: true },
  { name: 'code-review', arg: 'level', desc: 'Review the current changes for bugs', where: 'both' },
  { name: 'security-review', desc: 'Check the pending changes for security problems', where: 'both', run: true },
  { name: 'simplify', desc: 'Clean up the code that was just changed', where: 'both', run: true },
  { name: 'mcp', desc: 'Show which MCP servers are connected', where: 'chat', run: true },
];
const slashLists = new Map(); // provider|cwd -> {skills, available}, or a promise while it loads
let slashCwd = '';
function slashLoad(provider, cwd) {
  const key = provider + '|' + cwd, have = slashLists.get(key);
  if (have) return have;
  const p = api('/commands?provider=' + provider + '&cwd=' + encodeURIComponent(cwd || ''))
    .then(r => { const v = { skills: r.commands || [], available: Array.isArray(r.available) ? r.available : null }; slashLists.set(key, v); return v; })
    .catch(() => { slashLists.delete(key); return { skills: [], available: null }; });
  slashLists.set(key, p);
  return p;
}
// 0 exact, 1 starts the name, 2 starts a word of it, 3 inside it, 4 in the description; -1 no match
function slashScore(c, q) {
  if (!q) return 1;
  const n = c.name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.split(/[-_:]/).some(w => w.startsWith(q))) return 2;
  if (n.includes(q)) return 3;
  return ((c.label || '') + ' ' + (c.desc || '')).toLowerCase().includes(q) ? 4 : -1;
}
function slashGroups(q, { where, provider, working, list }) {
  const fits = c => (c.where === 'both' || c.where === where) && (!working || c.working) && (!c.ok || c.ok());
  const pocket = SLASH_POCKET.filter(fits);
  const known = list?.available ? new Set(list.available) : null;
  // Claude Code's own commands only for Claude; OpenRouter (OpenCode) gets Pocket's actions and no Claude/Codex skills.
  const claude = provider === 'acp' ? [] : provider === 'codex' ? SLASH_CODEX.filter(fits) : SLASH_CLAUDE.filter(c => fits(c) && (!known || known.has(c.name)));
  const taken = new Set([...SLASH_POCKET, ...SLASH_CLAUDE, ...SLASH_CODEX].map(c => c.name));
  const skills = working ? [] : (list?.skills || []).filter(c => !taken.has(c.name)).map(c => ({ ...c, kind: 'skill' }));
  const rank = arr => arr.map((c, i) => ({ c, s: slashScore(c, q), i })).filter(x => x.s >= 0).sort((a, b) => a.s - b.s || a.i - b.i);
  const groups = [[provider === 'codex' ? 'Codex' : 'Claude Code', rank(claude)], ['Pocket', rank(pocket)], ['Skills', rank(skills)]];
  // a description is only searched when no name matches: /con is context and compact, not every "conversation"
  const byName = groups.some(([, hits]) => hits.some(x => x.s < 4));
  return groups.map(([t, hits]) => [t, byName ? hits.filter(x => x.s < 4) : hits]).filter(([, hits]) => hits.length);
}
function slashClose(box) {
  const panel = box?.closest('.composerwrap')?.querySelector('.slash'); if (panel) { panel.hidden = true; panel.innerHTML = ''; }
  box?.removeAttribute('aria-activedescendant');
}
// ctx: { where: 'chat' | 'new', provider, cwd, working, onRun(text) }
function slashUpdate(box, ctx) {
  const panel = box.closest('.composerwrap')?.querySelector('.slash'); if (!panel) return;
  const m = box.value.match(/^\/([\w:-]*)$/);
  if (!m) return slashClose(box);
  const q = m[1].toLowerCase();
  const loaded = slashLists.get(ctx.provider + '|' + (ctx.cwd || ''));
  if (!loaded || loaded instanceof Promise) slashLoad(ctx.provider, ctx.cwd || '').then(() => { if (box.isConnected && box.value === m[0]) slashUpdate(box, ctx); });
  const groups = slashGroups(q, { ...ctx, list: loaded instanceof Promise ? null : loaded });
  if (!groups.length) return slashClose(box);
  const items = [];
  let best = null;
  panel.innerHTML = groups.map(([title, hits], g) => `<div role="group" aria-labelledby="slash-g${g}"><div class="slash-h" id="slash-g${g}">${esc(title)}</div>${hits.map(({ c, s }) => {
    const i = items.push(c) - 1; if (!best || s < best.s) best = { i, s };
    return `<button type="button" role="option" tabindex="-1" id="slash-o${i}" data-i="${i}" data-n="${esc(c.name)}" aria-selected="false"><span class="cmd">/${esc(c.name)}</span>${c.arg ? `<span class="arg">${esc(c.arg)}</span>` : ''}${c.desc ? `<span class="d">${esc(c.desc)}</span>` : ''}</button>`;
  }).join('')}</div>`).join('');
  panel.hidden = false;
  const select = i => {
    panel.querySelectorAll('[role=option]').forEach(o => o.setAttribute('aria-selected', String(Number(o.dataset.i) === i)));
    const o = panel.querySelector('#slash-o' + i); if (!o) return;
    box.setAttribute('aria-activedescendant', o.id); o.scrollIntoView({ block: 'nearest' });
  };
  const pick = i => {
    const c = items[i]; if (!c) return;
    slashClose(box);
    if (c.act) { box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true })); c.act(); return; }
    const text = ctx.provider === 'codex' && !c.insert ? (c.invocation || 'Use the $' + c.name + ' skill.') : '/' + c.name;
    if (c.run && ctx.where === 'chat' && ctx.onRun) { box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true })); ctx.onRun(text); return; }
    box.value = text + ' '; box.dispatchEvent(new Event('input', { bubbles: true }));
    box.focus(); box.setSelectionRange(box.value.length, box.value.length);
  };
  select(best.i);
  panel.onmousedown = e => e.preventDefault(); // the message box keeps focus (and the phone keyboard stays up)
  panel.onclick = e => { const o = e.target.closest('[role=option]'); if (o) pick(Number(o.dataset.i)); };
  panel.slash = { select, pick, count: items.length };
}
// Arrow keys, Enter, Tab and Escape while the picker is open; true when the key was the picker's
function slashKey(e, box) {
  const panel = box.closest('.composerwrap')?.querySelector('.slash');
  if (!panel || panel.hidden || !panel.slash || e.isComposing) return false;
  const cur = Number(panel.querySelector('[aria-selected="true"]')?.dataset.i ?? 0), n = panel.slash.count;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); panel.slash.select((cur + (e.key === 'ArrowDown' ? 1 : n - 1)) % n); return true; }
  if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); panel.slash.pick(cur); return true; }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); slashClose(box); return true; }
  return false;
}
function bindSlash(box, ctx) {
  box.setAttribute('aria-controls', box.closest('.composerwrap')?.querySelector('.slash')?.id || '');
  box.setAttribute('aria-autocomplete', 'list');
  // after a tap on an option lands; the list itself can take focus (it scrolls), and keeps the message box's keys
  box.addEventListener('blur', () => setTimeout(() => { const a = document.activeElement; if (a !== box && !a?.closest?.('.slash')) slashClose(box); }, 150));
  const panel = box.closest('.composerwrap')?.querySelector('.slash');
  if (panel) panel.onkeydown = e => { if (slashKey(e, box)) box.focus(); };
  box.addEventListener('keydown', e => { if (slashKey(e, box)) e.stopImmediatePropagation(); }, true);
  return () => slashUpdate(box, typeof ctx === 'function' ? ctx() : ctx);
}

const sendModes = new Map();
// 1.60: in Assistant mode a message sent while Claude works waits for the current reply (the choice is hidden there).
// 1.86: an engine that cannot take a message mid-reply (OpenRouter) sends it after the reply, the choice hidden as here.
const canSteer = () => !assistantMode() && engineHas(providerOf(chatId), 'steer');
const defaultSendMode = () => canSteer() ? 'steer' : 'queue';
let composerWorking = false;
function setComposer(working) {
  const c = $('#comp'); if (!c) return;
  composerWorking = working;
  $('#hember').innerHTML = working ? '<span class="ember"></span>' : '';
  const p = $('#slash'); if (p) p.hidden = true;
  c.innerHTML = `
    ${working ? `
      <div class="workrow"><span class="ember"></span><span id="work-label">Working</span>
        ${ctxRingHTML()}<button class="icon wbell ${chatMuted ? 'on' : ''}" id="muteb" aria-label="Toggle notifications for this conversation">${chatMuted ? IC.bellOff : IC.bell}</button>${Voice.muteButtonHTML('icon')}<button class="icon wbell conversation-side" id="side-open" hidden></button><button class="icon wbell conversation-branch" id="branch-open" hidden></button><button class="icon wbell conversation-project" id="project-open" hidden></button><button class="icon wbell conversation-task" id="task-open" hidden></button>
        <button class="chip stopchip" id="stopb" aria-label="Stop">${IC.stop}Stop</button></div>`
      : `<div class="toolbar" id="tbar"></div><div class="attachrow" id="attrow"></div>`}
    <div class="composer-entry">
    ${working && canSteer() ? '<div class="send-mode" role="group" aria-label="When to send"><button data-mode="steer" title="Steer now" aria-label="Steer now">Steer<span class="sm-x"> now</span></button><button data-mode="queue" title="After this reply" aria-label="After this reply">After <span class="sm-x">this </span>reply</button></div>' : ''}
    ${!working ? `<div class="composer-actions" id="composer-actions"><button class="icon" id="composer-toggle" aria-label="Hide message settings" aria-expanded="true" aria-controls="tbar">${IC.sliders}</button>${ctxRingHTML()}</div>` : ''}
    <textarea id="box" rows="1" placeholder="${working ? (!canSteer() ? 'Send this after the current reply…' : "Add to what it's doing…") : (assistantMode() ? 'Reply…' : 'Reply, or / for commands')}" enterkeyhint="send"></textarea>
    ${Voice.micHTML()}<button class="send" id="send" aria-label="Send">${IC.up}</button></div>`;
  if (typeof paintChatProject === 'function') paintChatProject(); // the toolbar's chip, or the working row's folder button
  if (typeof paintChatTask === 'function') paintChatTask();
  SideChat.paintButton();
  if (working) {
    $('#stopb').onclick = async () => {
      try { await api(`/session/${chatId}/stop`, { method: 'POST', body: '{}' }); }
      catch (e) { toast(e.message); if (chatId) renderChat(chatId); } // stale "Working" → resync
    };
    $('#muteb').onclick = () => toggleMute();
  } else {
    renderToolbar();
  }
  const modeButtons=c.querySelectorAll('[data-mode]');
  const paintMode=()=>modeButtons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===(sendModes.get(chatId)||defaultSendMode()))));
  modeButtons.forEach(b=>b.onclick=()=>{sendModes.set(chatId,b.dataset.mode);paintMode();const box=$('#box'),ph=b.dataset.mode==='queue'?'Run this after the current reply…':"Add to what it's doing…";box.dataset.basePh=ph;box.placeholder=b.dataset.mode!=='queue'&&$('#questions-open')&&!$('#questions-open').hidden?SKIP_PH:ph;});paintMode();
  const box = $('#box');
  const grow = () => sizeComposerBox();
  const draft = loadOutbox(chatId)?.text || loadDraft(chatId);
  if (draft) { box.value = draft; grow(); }
  const slash = bindSlash(box, () => ({ where: 'chat', provider: tb?.provider || 'claude', cwd: slashCwd, working, onRun: t => sendMsg(t) }));
  box.oninput = () => {
    grow();
    saveDraft(chatId, box.value);
    slash();
    paintChoices();                                   // typing your own answer hides the suggested replies
  };
  box.onkeydown = e => { // desktop: Enter sends, Shift+Enter for a newline
    if (e.key === 'Enter' && !e.shiftKey && isWide()) { e.preventDefault(); sendMsg(box.value); }
  };
  $('#send').onclick = () => sendMsg(box.value);
  Voice.bindComposer();
  paintDelivery(chatId);
  paintChoices();
  paintCtxRing();
}

const sendsInFlight = new Set(), deliveryNotices = new Map();
function loadAttachments(id) { try { return JSON.parse(localStorage.getItem('pc-attachments-' + id) || '[]'); } catch { return []; } }
function stashAttachments() { if (tb?.key) { try { localStorage.setItem('pc-attachments-' + tb.key, JSON.stringify(tb.attachments)); } catch { } } }
function loadOutbox(id) { try { return JSON.parse(localStorage.getItem('pc-outbox-' + id) || 'null'); } catch { return null; } }
function saveOutbox(id, value) {
  if (value) localStorage.setItem('pc-outbox-' + id, JSON.stringify(value));
  else localStorage.removeItem('pc-outbox-' + id);
}
function setConnection(message = '') {
  const el = $('#connection-state'); if (!el) return;
  el.textContent = message; el.hidden = !message;
}
function paintDelivery(id = chatId) {
  if (id !== chatId) return;
  const el = $('#delivery-status'); if (!el) return;
  const pending = loadOutbox(id), sending = sendsInFlight.has(id), notice = deliveryNotices.get(id);
  el.hidden = !pending && !notice;
  el.classList.toggle('delivery-problem', Boolean(pending && !sending));
  if (pending) {
    const label = sending ? 'Sending…' : pending.error || 'Delivery was not confirmed. Retry checks the same message.';
    el.innerHTML = `<p>${esc(label)}</p>${!sending ? `<div class="delivery-actions"><button class="chip" id="retry-message">Retry same message</button>${pending.rejected ? '<button class="chip" id="edit-message">Edit message</button>' : '<button class="chip" id="review-message">Review conversation</button>'}<button class="chip" id="discard-message">Discard retry</button></div>` : ''}`;
    const retry = $('#retry-message'); if (retry) retry.onclick = () => submitPending(id);
    const edit = $('#edit-message'); if (edit) edit.onclick = () => { saveOutbox(id, null); deliveryNotices.delete(id); paintDelivery(id); $('#box')?.focus(); };
    const review = $('#review-message'); if (review) review.onclick = () => renderChat(id);
    const discard = $('#discard-message'); if (discard) discard.onclick = () => { saveOutbox(id, null); clearDraft(id); deliveryNotices.delete(id); const box = $('#box'); if (box) box.value = ''; paintDelivery(id); };
  } else if (notice?.itemId) {
    el.innerHTML = `<p>${esc(notice.text)}</p><div class="delivery-actions"><button class="chip" id="stop-jobs-now">Stop background jobs and send now</button></div>`;
    const stop = $('#stop-jobs-now'); stop.onclick = async () => {
      stop.disabled = true;
      try { await api('/session/' + id + '/queue/start', { method: 'POST', body: JSON.stringify({ itemId: notice.itemId, replaceStaleLogin: true }) }); deliveryNotices.set(id, 'Message delivered.'); paintDelivery(id); if (chatId === id) renderChat(id); }
      catch (e) { deliveryNotices.delete(id); paintDelivery(id); toast(e.message); }
    };
  } else el.textContent = notice || '';
  const box = $('#box'), send = $('#send');
  if (box) box.readOnly = Boolean(pending);
  document.querySelectorAll('#c-att,#c-model,#c-eff,#attrow button,[data-mode]').forEach(b => { b.disabled = Boolean(pending); });
  if (send) { send.disabled = Boolean(pending); send.setAttribute('aria-label', pending ? 'Resolve pending delivery first' : 'Send'); }
}
function heldForJobsText(jobs = []) {
  const n = jobs.length, named = jobs.slice(0, 2).map(j => j.description).join('; ') + (n > 2 ? `; and ${n - 2} more` : '');
  return `Held until ${n === 1 ? 'a background job finishes' : `${n || 'its'} background jobs finish`}${named ? ` (${named})` : ''}. It sends by itself then, on your current Claude account.`;
}
async function sendMsg(text, {allowSecrets = false, matches = null} = {}) {
  text = text.trim(); const id = chatId;
  if(uploadsInFlight.get(id)){toast('Wait for the attachment upload to finish.');return;}
  // 1.78: /btw asks in the side chat instead, like the desktop app
  const btw = text.match(/^\/btw(?:\s+([\s\S]*))?$/i);
  if (btw && id && SideChat.available(id)) { const box = $('#box'); if (box) { box.value = ''; sizeComposerBox(); } saveDraft(id, ''); SideChat.open(id, btw[1] || ''); return; }
  if (!text || !id || sendsInFlight.has(id) || loadOutbox(id)) return;
  if (!allowSecrets && holdSecretSend(id, text, matches)) return; // 1.42: offer the Vault before a secret leaves
  if (liveFailure?.id === id) liveFailure = null;
  awayAnchor = null; awayFollow = false;                         // sending goes back to following the conversation
  document.getElementById('turn-failure')?.remove();
  // 1.81: a message sent while a reply runs carries the chips' model and effort as well as the permissions, so if it is
  // queued it runs as they were set (it used to run on the defaults, which also restarted a Claude process).
  // Steer now goes as auto: the server steers, and when the reply cannot take it (finishing, or reattached without its
  // input) queues it after the reply, where mode steer answered a 409 and left the message to be sent again.
  const opts = composerWorking ? (({model, effort, executionMode}) => ({mode:(sendModes.get(id)||defaultSendMode())==='queue'?'queue':'auto',approvalMode:nextApprovalMode(),model,effort,executionMode}))(turnOpts()) : turnOpts();
  if (allowSecrets) opts.allowSecrets = true; // the owner chose Send as is; a retry of this message carries it too
  const pending = { text, opts, clientMessageId: crypto.randomUUID(),
    files: composerWorking ? [] : [...(tb?.attachments || [])], createdAt: Date.now() };
  try { saveDraft(id, text); saveOutbox(id, pending); }
  catch { toast('Could not save this message on the device. Copy it before trying again.'); return; }
  await submitPending(id);
}
async function submitPending(id) {
  if (sendsInFlight.has(id)) return;
  const pending = loadOutbox(id); if (!pending) return;
  sendsInFlight.add(id); deliveryNotices.delete(id); paintDelivery(id);
  recentSends = [...recentSends.slice(-4), { text: pending.text, at: Date.now() }];
  // Optimistic echo: show the message the instant Send is hit instead of after the server acknowledges and
  // the transcript is re-fetched. A message with files renders as two elements (bubble + file chips), so
  // track every node it adds; all are removed if delivery fails, and the canonical re-render replaces them.
  const ghost = [];
  if (chatId === id && !composerWorking) {
    const msgs = $('#msgs');
    if (msgs) {
      const mark = msgs.lastElementChild;
      msgs.insertAdjacentHTML('beforeend', msgHTML({ role: 'user', text: pending.text, files: pending.files }));
      for (let n = mark ? mark.nextElementSibling : msgs.firstElementChild; n; n = n.nextElementSibling) { n.classList.add('pending'); ghost.push(n); }
      paintChoices();
      const box = $('#box'); if (box) box.value = '';
      scrollBottom();
    }
  }
  try {
    const result = await api(`/session/${id}/message`, { method: 'POST', body: JSON.stringify({ text: pending.text, ...pending.opts, clientMessageId: pending.clientMessageId }) });
    saveOutbox(id, null); clearDraft(id);
    if (pending.files.length) localStorage.removeItem('pc-attachments-' + id);
    if (result.steered) steeredEchoes.set(id, [...(steeredEchoes.get(id) || []), { text: pending.text.trim(), at: Date.now() }]);
    // 1.89.2: held for background jobs on the earlier Claude login: it sends by itself when they finish, or now with Stop
    if (result.afterJobs) deliveryNotices.set(id, { text: heldForJobsText(result.jobs), itemId: result.itemId });
    else deliveryNotices.set(id, result.queued ? result.paused ? 'Saved in Queue. Open Queue to start it when ready.' : 'Queued after the current reply.' : result.steered ? (result.skippedQuestions ? 'Questions skipped. Your message went to the running reply.' : 'Sent to the running reply.') : 'Message delivered.');
    if (result.modelFallback) modelFellBack(id, result.modelFallback);
    if (chatId === id) {
      if (tb?.key === id && pending.files.length) tb.attachments = [];
      const box = $('#box'); if (box) box.value = '';
      // Show the canonical transcript after acknowledgment; no unsent ghost
      // bubble remains on failure, and a replayed receipt adds no duplicate.
      await resyncChat(id);
    }
    refreshSessions();
  } catch (e) {
    if (e.code === 'secret_detected') { // 1.42: held by the server before any receipt: not delivered, never retried by itself
      saveOutbox(id, null); ghost.forEach(n => n.remove());
      if (chatId === id && $('#box')) $('#box').value = pending.text;
      sendsInFlight.delete(id); holdSecretSend(id, pending.text, e.body?.matches || []);
      return;
    }
    const rejected = e.status >= 400 && e.status < 500 && e.code !== 'delivery_uncertain';
    pending.rejected = rejected;
    pending.error = e.code === 'delivery_uncertain' ? e.message
      : rejected ? `Not sent: ${e.message}` : 'Delivery not confirmed. Your message is saved. Retry checks the same request.';
    try { saveOutbox(id, pending); } catch { }
    ghost.forEach(n => n.remove());
    if (chatId === id && $('#box')) $('#box').value = pending.text;
  } finally { sendsInFlight.delete(id); paintDelivery(id); if (chatId === id) paintChoices(); }
}

// 1.42: a message that looks like it carries a secret waits in the box while the owner chooses: store it in the Vault
// and send a {{vault:name}} placeholder, send it as it is, or edit it. The draft stays until a send succeeds.
function holdSecretSend(id, text, matches = null) {
  const box = () => chatId === id ? $('#box') : null;
  return secretHold(text, { matches, trigger: box(),
    onAsIs: t => { if (chatId !== id) return toast('You switched conversations, so that was not sent.'); sendMsg(t, { allowSecrets: true }); },
    onStore: t => {
      if (chatId !== id) return toast('Stored. You switched conversations, so the message was not sent.');
      const b = box(); if (b && !b.readOnly) { b.value = t; sizeComposerBox(); }
      saveDraft(id, t); sendMsg(t);
    } }) && (() => { // held: keep the words in the box (a voice message has none there yet) so Edit returns to them
      const b = box(); if (b && !b.readOnly && b.value.trim() !== text) { b.value = text; saveDraft(id, text); sizeComposerBox(); }
      return true; })();
}
let recentSends = []; // for deduping our own messages when they echo back via the mirror
// A steered message reaches the agent at once but only enters the transcript at the
// agent's next step; until then the canonical re-render would hide it. Keep showing it.
const steeredEchoes = new Map(); // sessionId -> [{text, at}]
function steeredHTML(id, messages) {
  // 1.89: a row that still carries our attachment block (an older server, an API caller's format) is compared without it
  const recentUser = messages.slice(-40).filter(m => m.role === 'user').map(m => (m.text || '').replace(/\n\n\[Attached files? — read as needed:\n[\s\S]*?\n\]\s*$/, '').trim());
  const left = (steeredEchoes.get(id) || []).filter(x => Date.now() - x.at < 30 * 60000 && !recentUser.some(t => t === x.text || t.endsWith(x.text)));
  if (left.length) steeredEchoes.set(id, left); else steeredEchoes.delete(id);
  return left.map(x => msgHTML({ role: 'user', text: x.text })).join('');
}
function openES() {
  closeES();
  if (!chatId) return;
  const streamId = chatId;
  // A fresh connection has no Last-Event-ID; without ?from the server would replay the
  // whole running turn on top of the transcript just rendered (every message twice).
  es = new EventSource(`/api/session/${chatId}/events?offset=${chatOffset}${chatTurnEvents != null ? `&from=${chatTurnEvents}` : ''}${chatLastItem ? `&after=${encodeURIComponent(chatLastItem)}` : ''}`);
  es.onopen = () => { if (chatId === streamId) setConnection(); };
  const msgs = $('#msgs');
  let live = null; // word-by-word streaming buffer, replaced by the formatted message
  let watching = false; // mirror mode: session is idle here, may be driven elsewhere
  const dropLive = () => { if (live) { live.remove(); live = null; } };
  es.onmessage = ev => {
    if (chatId !== streamId) return;
    let d; try { d = JSON.parse(ev.data); } catch { return; }
    // watch = the daemon has no turn for this session; if we still show "Working",
    // we missed the turn-end events (SSE drop + reconnect after finalize) — clear it
    // attach names the turn + daemon boot: a different key after a reconnect means the
    // turn was rebuilt (daemon restart) and event numbers no longer line up — resync
    if (d.type === 'attach') { if (chatAttachKey && chatAttachKey !== d.key) { chatAttachKey = null; closeES(); renderChat(streamId); } else chatAttachKey = d.key; return; }
    if (d.offset) chatOffset = d.offset; // watch mode: where a reopen should continue from
    if (d.itemId) chatLastItem = d.itemId;
    if(d.type==='questions'){refreshQuestions(streamId);refreshSessions();Voice.onAttention(streamId,'questions');return;}
    if(d.type==='approvals'){refreshApprovals(streamId);refreshSessions();Voice.onAttention(streamId,'approvals');return;}
    if(d.type==='usage'){paintContextMeter(streamId);return;}
    if (d.type === 'watch') { watching = true; if (composerWorking) setComposer(false); }
    else if (d.type === 'user') { // mirror: a message sent from another surface
      if (recentSends.some(x => x.text === d.msg.text && Date.now() - x.at < 120000)) return;
      appendDayDivider(msgs, d.msg.ts);
      msgs.insertAdjacentHTML('beforeend', msgHTML(d.msg));
      if (watching) extPulse();
      scrollBottom();
    }
    else if (d.type === 'delta') {
      if (!live || !msgs.contains(live)) {
        msgs.insertAdjacentHTML('beforeend', '<div class="m-asst live enter"></div>');
        live = msgs.lastElementChild;
      }
      live.raw = (live.raw || '') + d.text;                   // the suggested-replies block never shows as raw text
      const cut = live.raw.indexOf('```choices'); live.textContent = cut < 0 ? live.raw : live.raw.slice(0, cut);
      scrollBottom();
    }
    else if (d.type === 'assistant') {
      dropLive(); Voice.onAssistant(streamId, d.msg);
      appendDayDivider(msgs, d.msg.ts);
      msgs.insertAdjacentHTML('beforeend', msgHTML(d.msg));
      mergeToolFolds(msgs);
      openLastTodo();
      paintChoices();
      if (watching) extPulse();
      scrollBottom();
    }
    else if (d.type === 'result') {
      awaitingEngagement.add(streamId); // finished on screen: stays Response ready / New until you engage
      if (document.visibilityState === 'visible' && !Voice.replacesChime()) chime(); // not watching → push already notified; spoken alerts replace the chime
      Voice.onTurnEnd(streamId, d.ok, d.error);
      announceListsStale(); // the agent may have added a project, file or task during the turn
      setTimeout(() => paintFileCards($('#msgs'), true), 600); // 1.61: the reply's files, and any it kept in Files
      if (!d.ok && !/^Stopped/.test(String(d.error || ''))) paintTurnFailure({ error: String(d.error || '').slice(0, 300) });
      // 1.48: a Codex turn has no cost line, but its time and cache start show the same way
      if (d.cost != null || Number.isFinite(d.tokens) || (d.cache && Number.isFinite(d.cache.hit))) {
        const secs = d.duration_ms ? Math.round(d.duration_ms / 1000) : null;
        // 1.28: whether the turn resumed from a warm prompt cache or wrote it again
        const cached = d.cache && Number.isFinite(d.cache.hit) ? (d.cache.hit >= 0.5 ? `${Math.floor(d.cache.hit * 100)}% cached` : 'cold start') : '';
        // 1.84.2: an OpenRouter reply can cost a fraction of a cent; show it rather than $0.00
        const money = c => c >= 0.01 || c === 0 ? `$${c.toFixed(2)}` : c >= 0.0001 ? `$${c.toFixed(4)}` : '<$0.0001';
        // 1.87: an agent billed by plan, not per token (Codex), shows the reply's tokens where Claude shows its cost
        const toks = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
        const parts = [d.cost != null ? money(d.cost) : Number.isFinite(d.tokens) && d.tokens > 0 ? toks(d.tokens) + ' tokens' : '', secs ? (secs >= 90 ? Math.round(secs / 60) + 'm' : secs + 's') : '', cached].filter(Boolean);
        lastMeta = { id: chatId, html: `<div class="turnmeta">${parts.join(' · ')}</div>` };
        msgs.insertAdjacentHTML('beforeend', lastMeta.html);
      }
      scrollBottom();
    }
    else if (d.type === 'note') { // 1.52: e.g. the picked model is not offered, so the turn runs on the default
      msgs.insertAdjacentHTML('beforeend', `<div class="turnmeta" role="status">${esc(d.text)}</div>`);
      scrollBottom();
    }
    else if (d.type === 'retry') { // rate limited — the server scheduled its own resume
      const t = new Date(d.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      msgs.insertAdjacentHTML('beforeend', `<div class="turnmeta">Rate limited — auto-resume at ${esc(t)}</div>`);
      scrollBottom();
    }
    else if (d.type === 'done') { dropLive(); closeES(); if (chatId) resyncChat(chatId); } // resync from canonical transcript
    else if (d.type === 'idle') { dropLive(); closeES(); setComposer(false); Voice.onIdle(streamId); }
  };
  es.onerror = () => { if (chatId === streamId) setConnection('Connection interrupted. Reconnecting; your draft is kept.'); };
}

/* resync when the phone comes back — the turn kept running server-side */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') {rememberReading();return;}
  if (location.hash.startsWith('#/chat/') && chatId) renderChat(chatId, { away: true });
  else if (location.hash === '' || location.hash === '#/') renderList();
});

/* ---------- discover existing agent skills ---------- */
async function openSkills(provider,cwd,box) {
  const scrim=document.createElement('div');scrim.className='scrim';
  const sh=document.createElement('div');sh.className='sheet skills-sheet';
  sh.innerHTML='<h2>Choose a skill</h2><p class="sheet-help">Choose a starting point, then add your instructions before sending.</p><input class="skill-search" type="search" aria-label="Search skills" placeholder="Search skills and tasks"><div class="skill-list" role="status">Loading installed skills…</div>';
  mountSheet(scrim,sh);let skills=[];
  const paint=()=>{
    const q=sh.querySelector('input').value.toLowerCase().trim();
    const hits=skills.filter(s=>(s.name+' '+(s.label||'')+' '+s.desc).toLowerCase().includes(q));
    sh.querySelector('.skill-list').innerHTML=hits.map((s,i)=>`<button class="skill-choice" data-skill="${i}"><span>${esc(s.label||s.name.replace(/[-_]/g,' '))}</span><span class="skill-description">${esc(s.desc||s.name)}</span></button>`).join('')||'<p class="empty">No matching skills. You can still describe your task directly.</p>';
    sh.querySelectorAll('[data-skill]').forEach(b=>b.onclick=()=>{
      const s=hits[Number(b.dataset.skill)];closeCurrentSheet?.();if(!box.isConnected)return;
      box.value=(s.invocation || (provider==='codex'?'Use the $'+s.name+' skill.':'Use the /'+s.name+' skill.'))+'\n\n'+box.value;
      box.dispatchEvent(new Event('input',{bubbles:true}));box.focus();box.setSelectionRange(box.value.length,box.value.length);
    });
  };
  sh.querySelector('input').oninput=paint;
  try{const d=await api('/commands?provider='+provider+'&cwd='+encodeURIComponent(cwd));if(!sh.isConnected)return;skills=d.commands||[];paint();if(d.warning)sh.querySelector('.sheet-help').textContent=d.warning;}
  catch(e){if(sh.isConnected)sh.querySelector('.skill-list').textContent=e.message;}
}

/* ---------- new session ---------- */
// 1.57: #/start/<id> — a briefing handed to Pocket by an agent or a job (POST /api/start, pocket-start add). Loads it into
// New session's draft with the workspace and agent it names, then goes there; the session starts only when the owner taps Start.
// 1.77: pc-new-start carries the link's id to /api/new, so the Inbox entry that sent it can show the conversation.
async function openStartLink(id) {
  if (!/^[0-9a-f]{12}$/.test(id)) { toast('That start link is not valid.'); location.replace('#/new'); return; }
  try {
    const s = await api('/start/' + id);
    if (s.startedSession) { location.replace('#/chat/' + s.startedSession); return; } // 1.96: a handoff starts once
    saveBriefing(s.text || '');
    // 1.81: the link's folder rides in pc-new-start like a project's, so New selects it, or fills it in when it is not
    // listed, over the default workspace (pc-lastproj alone lost to POCKET_DEFAULT_CWD and to the most recent workspace).
    try { writeLocal('pc-new-start', { start: id, cwd: s.directory || '' }); if (s.directory) localStorage.setItem('pc-lastproj', s.directory); if (s.provider) localStorage.setItem('pc-provider', s.provider); } catch { }
  } catch (e) { if (e.message === 'login') return; toast(e.status === 404 ? 'That start link has expired.' : 'Could not load the start link.'); }
  location.replace('#/new');
}
async function renderNew({ home = false } = {}) {
  const viewVersion=++chatRenderVersion;
  home = home && assistantMode() && !PANE;
  const pendingNew = loadOutbox(NEW_KEY);
  Voice.onLeave(); // 1.58: the mic below speaks to this New session, not the conversation you left
  // 1.58: the message box is the conversation's own composer (settings chips, attach, skill, save as prompt,
  // mic, hands-free, Send); the task heading, saved prompts and workspace setup sit above it.
  const col = `
    <header class="bar">
      ${home ? `<h1>${esc(appName())}</h1><button class="icon" id="settings" aria-label="Settings">${IC.cog}</button>` : PANE ? `<button class="icon" id="pane-close" aria-label="Close this pane">${IC.x}</button>` : `<button class="icon" id="back" aria-label="Back">${IC.back}</button>`}
      ${home ? '' : '<h1>New conversation</h1>'}
    </header>
    <main class="scroll"><div class="pane task-pane${home ? ' assistant-home' : ''}">
      ${home ? assistantIntroHTML() + '<section class="home-waiting" id="home-waiting" aria-labelledby="home-waiting-h" hidden></section>' : ''}
      <div><label class="task-heading" for="first">What would you like done?</label><div class="starters" id="starters" hidden></div></div>
      <div class="task-actions" id="new-actions" hidden><button class="chip conversation-project linked" id="new-project" hidden></button></div>
      <details id="new-setup"><summary id="choose-workspace"><span class="task-context" id="task-context"></span><span class="setup-edit">Edit setup</span></summary><div class="setup-fields">
      <div><span class="h" id="agenth">Agent</span><div class="projlist" id="apick" role="radiogroup" aria-labelledby="agenth">
        <button class="row" role="radio" aria-checked="false" data-a="claude"><span class="dot"></span>${IC.term}<span class="p">Claude Code</span></button>
        <button class="row" role="radio" aria-checked="false" data-a="codex"><span class="dot"></span>${IC.term}<span class="p">Codex</span></button>
        <button class="row" role="radio" aria-checked="false" data-a="acp" hidden><span class="dot"></span>${IC.term}<span class="p">OpenRouter</span></button>
      </div></div>
      <div><span class="h" id="projh">Project</span><div class="projlist" id="plist" role="radiogroup" aria-labelledby="projh"><div class="empty">Loading…</div></div></div>
      <div><label class="h" for="cpath">Or a custom path</label><input type="text" id="cpath" placeholder="/full/path/to/project" autocapitalize="off" autocorrect="off"></div>
      </div></details>
      ${home ? '<section class="home-recent" id="home-recent" aria-labelledby="home-recent-h"></section>' : ''}
    </div></main>
    <section class="composerwrap" aria-label="New conversation message"><div id="new-delivery" class="delivery-status" role="status" hidden></div><div class="slash" id="slash" role="listbox" aria-label="Commands and skills" tabindex="0" hidden></div><p class="start-hint" id="start-hint" role="alert" hidden></p><div class="voice-strip" id="voice-strip" role="status" aria-live="polite" hidden></div>
      <div class="composer" id="comp"><div class="toolbar" id="tbar"></div><div class="attachrow" id="attrow"></div>
        <div class="composer-entry"><div class="composer-actions" id="composer-actions"><button class="icon" id="composer-toggle" aria-label="Hide message settings" aria-expanded="true" aria-controls="tbar">${IC.sliders}</button><button class="icon" id="choose-skill" aria-label="Choose a skill" title="Choose a skill">${IC.spark}</button><button class="icon" id="save-prompt" aria-label="Save as prompt" title="Save as prompt" disabled>${IC.bookmark}</button></div>
        <textarea id="first" rows="1" placeholder="Describe the task, or choose a skill" enterkeyhint="send" aria-describedby="start-hint"></textarea>
        ${Voice.micHTML()}<button class="send" id="start" aria-label="Start conversation" title="Start conversation">${IC.up}</button></div></div></section>`;
  app.innerHTML = withShell(col) + '<input type="file" id="fpick" multiple hidden>';
  wireShell();
  if (PANE) $('#pane-close').onclick = () => paneSay('close'); else if (home) { $('#settings').onclick = settingsSheet; bindAssistantIntro(); paintAssistantHome(); refreshSessions(); } else $('#back').onclick = () => { location.hash = '#/'; };
  tb = { key: NEW_KEY, prefs: pendingNew ? { model: pendingNew.payload.model || 'default', effort: pendingNew.payload.effort || 'default' } : getPrefs(NEW_KEY), attachments: loadAttachments(NEW_KEY), allowAttach: true, provider: pendingNew?.payload.provider || (['codex','acp'].includes(localStorage.getItem('pc-provider')) ? localStorage.getItem('pc-provider') : 'claude') };
  renderToolbar();
  // which agent runs this session — remembered, since most days you stay on one
  let provider = pendingNew?.payload.provider || (['codex','acp'].includes(localStorage.getItem('pc-provider')) ? localStorage.getItem('pc-provider') : 'claude');
  let sel = null;
  // 1.49: Start session on a project card leaves its id here; the session is linked to the project when it starts.
  let startFrom = pendingNew?.payload.project ? { project: pendingNew.payload.project, projectName: pendingNew.payload.projectName || '' } : readLocal('pc-new-start', null);
  const paintNewProject = () => {
    const b = $('#new-project'); if (!b) return;
    b.hidden = !startFrom?.project; $('#new-actions').hidden = b.hidden;
    if (!startFrom?.project) return;
    const name = startFrom.projectName || startFrom.project;
    b.innerHTML = IC.folder + '<span>' + esc(name) + '</span>'; b.title = 'This conversation will be linked to the project ' + name;
    b.setAttribute('aria-label', 'Linked to the project ' + name + '. Options');
    b.onclick = () => { if (loadOutbox(NEW_KEY)) return toast('Retry or discard the unconfirmed start first.'); confirmSheet('Start without the project?', 'The new conversation will not be linked to ' + name + '. The briefing stays in the message; edit it if you no longer want it.', 'Remove the link', () => { startFrom = null; try { localStorage.removeItem('pc-new-start'); } catch { } paintNewProject(); }); };
  };
  paintNewProject();
  const context = () => {const cwd=$('#cpath')?.value.trim()||sel;const el=$('#task-context');if(el)el.dataset.workspace=cwd?projName(cwd):'Choose a workspace';updateNewSummary();};
  $('#new-setup').ontoggle=()=>{ $('#new-setup .setup-edit').textContent=$('#new-setup').open?'Close setup':'Edit setup'; };
  $('#cpath').oninput=context;
  $('#choose-skill').onclick=()=>openSkills(provider,$('#cpath').value.trim()||sel||'', $('#first'));
  const ap = $('#apick');
  const pickAgent = a => {
    provider = a;
    localStorage.setItem('pc-provider', a);
    ap.querySelectorAll('.row').forEach(x => {
      const on = x.dataset.a === a;
      x.classList.toggle('sel', on); x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1;
    });
    tb.provider = a;
    const fm = $('#first');
    if (fm) fm.placeholder = a === 'codex' ? 'What should Codex work on?' : a === 'acp' ? 'What should OpenRouter work on?' : 'What should Claude work on?';
    renderToolbar();
    (a === 'codex' ? loadCodexModels() : a === 'acp' ? loadAcpModels() : loadClaudeModels()).then(renderToolbar);context();
  };
  ap.querySelectorAll('.row').forEach(r => r.onclick = () => pickAgent(r.dataset.a));
  pickAgent(provider);
  bindRadioGroup(ap);
  // The OpenRouter engine is opt-in; reveal its row only when the server reports it enabled.
  loadAcpModels().then(() => {
    const row = ap.querySelector('[data-a="acp"]');
    if (row) row.hidden = !acpEnabled;
    if (provider === 'acp' && !acpEnabled) pickAgent('claude'); // a remembered pick that's no longer available
  });
  $('#fpick').onchange = e => { uploadFiles([...e.target.files]); e.target.value = ''; };
  const first = $('#first');
  first.value = pendingNew?.payload.text || loadDraft(NEW_KEY);
  let savedPrompts = [], recentStarts = [], activeStarter = null; // 1.23 (declared before the handlers that read them)
  const slashNew = bindSlash(first, () => ({ where: 'new', provider, cwd: $('#cpath')?.value.trim() || sel || '' }));
  first.oninput = () => { sizeComposerBox(); saveDraft(NEW_KEY, first.value); slashNew(); const h = $('#start-hint'); if (h) h.hidden = true; paintSaveButton(); if (activeStarter && first.value !== activeStarter.text) { activeStarter = null; paintStarters(); } };
  first.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && isWide()) { e.preventDefault(); startSession(); } }; // like the conversation: Enter starts, Shift+Enter for a newline
  sizeComposerBox();
  try {
    const { projects, defaultCwd, locked } = await api('/projects');
    if(viewVersion!==chatRenderVersion)return;
    const pl = $('#plist');
    if (locked && defaultCwd) { // 1.55: this Pocket starts every session in one folder; nothing to choose
      pl.innerHTML = `<div class="row workspace-locked">${IC.folder}<span class="p">${esc(projName(defaultCwd))}${projShort(defaultCwd) !== projName(defaultCwd) ? `<span class="workspace-path">${esc(projShort(defaultCwd))}</span>` : ''}</span><span class="workspace-note">Every conversation starts here</span></div>`;
      $('#projh').textContent = 'Workspace';
      $('#cpath').value = ''; $('#cpath').closest('div').hidden = true;
      sel = defaultCwd; context();
    } else {
    pl.innerHTML = projects.slice(0, 10).map((p, i) => `
      <button class="row" role="radio" aria-checked="false" data-p="${esc(p)}">
        <span class="dot"></span>${IC.folder}<span class="p">${esc(projName(p))}${projShort(p) !== projName(p) ? `<span class="workspace-path">${esc(projShort(p))}</span>` : ''}</span>
      </button>`).join('');
    const pick = r => {
      pl.querySelectorAll('.row').forEach(x => { x.classList.remove('sel'); x.setAttribute('aria-checked', 'false'); x.tabIndex = -1; });
      r.classList.add('sel'); r.setAttribute('aria-checked', 'true'); r.tabIndex = 0;
      sel = r.dataset.p; $('#cpath').value = '';context();
    };
    pl.querySelectorAll('.row').forEach(r => r.onclick = () => pick(r));
    // preselect the instance's default workspace, else where you last started a session
    const last = startFrom?.cwd || defaultCwd || localStorage.getItem('pc-lastproj');
    const lastRow = last && pl.querySelector(`.row[data-p="${CSS.escape(last)}"]`);
    // 1.19: with no default and nothing remembered, start in the most recent workspace (shown above Start).
    const firstRow = pl.querySelector('.row');
    if (lastRow) pick(lastRow); else if (startFrom?.cwd && !pendingNew) { $('#cpath').value = startFrom.cwd; context(); } else if (firstRow && !$('#cpath').value.trim()) pick(firstRow);
    bindRadioGroup(pl);
    }
  } catch { }
  if(viewVersion!==chatRenderVersion)return;
  if (pendingNew) $('#cpath').value = pendingNew.payload.cwd;context();
  if (assistantMode() && ($('#cpath').value.trim() || sel)) $('#new-setup').hidden = true; // 1.60: nothing to choose
  const paintNewDelivery = () => {
    const pending = loadOutbox(NEW_KEY), note = $('#new-delivery');
    if (!note) return;
    note.hidden = !pending;
    note.classList.toggle('delivery-problem', Boolean(pending));
    note.innerHTML = pending ? '<p>Start request not yet confirmed. Retry checks the same request.</p><div class="delivery-actions"><button class="chip" id="retry-new">Retry start</button><button class="chip" id="discard-new">Discard retry</button></div>' : '';
    const retry = $('#retry-new'); if (retry) retry.onclick = () => startSession();
    const discard = $('#discard-new'); if (discard) discard.onclick = () => { saveOutbox(NEW_KEY, null); clearDraft(NEW_KEY); localStorage.removeItem('pc-new-start'); localStorage.removeItem(briefingKey()); renderNew(); };
    app.querySelectorAll('.pane input,.pane textarea,.pane button,#comp textarea,#comp button:not(#start):not(#composer-toggle)').forEach(el => { el.disabled = Boolean(pending); });
    const label = pending ? 'Retry start' : 'Start conversation';
    $('#start').setAttribute('aria-label', label); $('#start').title = label;
  };
  paintNewDelivery();
  /* ---------- 1.23: saved prompts and recent starts ----------
     A row of saved prompts above the task box and a Recent list. Choosing one fills the wording, workspace and
     agent (and model, effort, permissions or Codex mode when saved); you still press Start. */
  const formState = () => ({ text: first.value.trim(), cwd: $('#cpath').value.trim() || sel || null, provider,
    model: tb.prefs.model, effort: tb.prefs.effort, approvalMode: nextApprovalMode(), executionMode: engineHas(provider, 'planMode') ? tb.prefs.executionMode : null });
  const describe = p => [p.cwd ? projName(p.cwd) : 'No workspace', p.provider === 'codex' ? 'Codex' : 'Claude Code',
    p.model ? modelLabel(p.model) : '', p.effort ? p.effort[0].toUpperCase() + p.effort.slice(1) : '', p.approvalMode === 'full' ? 'Full access' : p.approvalMode === 'review' ? 'Review actions' : '',
    p.executionMode === 'plan' ? 'Plan first' : ''].filter(Boolean).join(' · ');
  function paintSaveButton() { const b = $('#save-prompt'); if (b) b.disabled = !first.value.trim() || Boolean(loadOutbox(NEW_KEY)); }
  function selectWorkspace(cwd) {
    const pl = $('#plist'), row = cwd && pl?.querySelector(`.row[data-p="${CSS.escape(cwd)}"]`);
    if (row) { row.click(); return; }
    pl?.querySelectorAll('.row').forEach(x => { x.classList.remove('sel'); x.setAttribute('aria-checked', 'false'); });
    sel = null; $('#cpath').value = cwd || ''; context();
  }
  function applyStarter(p) {
    if (loadOutbox(NEW_KEY)) return toast('Retry or discard the unconfirmed start first.');
    pickAgent(p.provider === 'codex' ? 'codex' : 'claude');
    selectWorkspace(p.cwd);
    const prefs = { ...tb.prefs, model: p.model || tb.prefs.model, effort: p.effort || tb.prefs.effort };
    if (p.approvalMode) { prefs.approvalMode = p.approvalMode; prefs.approvalModeSource = 'user'; }
    if (p.executionMode) prefs.executionMode = p.executionMode;
    tb.prefs = prefs; setPrefs(NEW_KEY, prefs); renderToolbar();
    first.value = p.text; saveDraft(NEW_KEY, first.value); paintSaveButton();
    activeStarter = p; paintStarters();
    $('#start-hint').hidden = true;
    first.focus({ preventScroll: true }); first.setSelectionRange(first.value.length, first.value.length);
  }
  function paintStarters() {
    const box = $('#starters'); if (!box) return;
    const recentOpen = box.querySelector('details')?.open ?? readLocal('pc-recent-open', false);
    box.hidden = !savedPrompts.length && !recentStarts.length;
    box.innerHTML = (savedPrompts.length ? `<div class="starter-chips" role="group" aria-label="Saved prompts">${savedPrompts.map(p =>
      `<button type="button" class="chip starter" data-prompt="${esc(p.id)}" aria-pressed="${activeStarter?.id === p.id}" title="${esc(describe(p))}">${esc(p.name)}</button>`).join('')}<button type="button" class="chip starter-manage" id="manage-prompts">Manage</button></div>` : '')
      + (recentStarts.length ? `<details class="recent-starts"${recentOpen ? ' open' : ''}><summary>Recent</summary><div class="recent-list">${recentStarts.map((r, i) =>
        `<button type="button" class="recent-start" data-recent="${i}"><span class="recent-text">${esc(r.text)}</span><span class="recent-meta">${esc(describe(r))} · ${esc(rel(r.at))}</span></button>`).join('')}</div></details>` : '');
    box.querySelectorAll('[data-prompt]').forEach(b => {
      const pr = savedPrompts.find(x => x.id === b.dataset.prompt);
      b.onclick = () => { if (!b.dataset.held) applyStarter(pr); delete b.dataset.held; };
      let t; // long-press (touch) or right-click opens Manage on this prompt
      b.oncontextmenu = e => { e.preventDefault(); managePrompts(pr.id); };
      b.ontouchstart = () => { t = setTimeout(() => { b.dataset.held = '1'; managePrompts(pr.id); }, 500); };
      b.ontouchend = b.ontouchmove = b.ontouchcancel = () => clearTimeout(t);
    });
    box.querySelectorAll('[data-recent]').forEach(b => b.onclick = () => applyStarter(recentStarts[Number(b.dataset.recent)]));
    box.querySelector('#manage-prompts')?.addEventListener('click', () => managePrompts());
    box.querySelector('details')?.addEventListener('toggle', e => writeLocal('pc-recent-open', e.target.open));
  }
  const takeLists = d => { savedPrompts = d.prompts || []; recentStarts = d.recent || []; };
  // Save what is on screen as a new prompt, or (edit) rename / replace a saved one.
  function promptSheet(existing) {
    const state = formState();
    if (!existing && !state.text) return;
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const sh = document.createElement('div'); sh.className = 'sheet prompt-sheet';
    const guess = state.text.replace(/\s+/g, ' ').split(' ').slice(0, 6).join(' ').slice(0, 48);
    sh.innerHTML = `<h2>${existing ? 'Edit saved prompt' : 'Save as prompt'}</h2>
      <label class="prompt-field">Name<input type="text" class="rename" id="pr-name" maxlength="60" autocomplete="off" value="${esc(existing ? existing.name : guess)}"></label>
      ${existing ? `<p class="prompt-summary">${esc(describe(existing))}</p><p class="prompt-text">${esc(existing.text)}</p>
        <button type="button" class="opt" id="pr-replace" ${state.text ? '' : 'disabled'}>${IC.pen}<span>Replace with what is on screen<span class="sub">${esc(state.text ? describe(state) : 'Write or choose a task first')}</span></span></button>`
      : `<p class="prompt-summary">${esc(describe(state))}</p>
        <button type="button" class="opt" id="pr-settings" aria-pressed="true"><span class="dot on"></span><span>Keep model, effort and permissions<span class="sub">Off saves only the wording, workspace and agent</span></span></button>`}
      <p class="prompt-error" id="pr-error" role="alert" hidden></p>
      <button class="primary" id="pr-save">${existing ? 'Save name' : 'Save prompt'}</button>`;
    mountSheet(scrim, sh);
    const name = sh.querySelector('#pr-name'); name.focus(); name.select();
    let keepSettings = true, replace = false;
    sh.querySelector('#pr-settings')?.addEventListener('click', e => { keepSettings = !keepSettings; e.currentTarget.setAttribute('aria-pressed', String(keepSettings)); e.currentTarget.querySelector('.dot').classList.toggle('on', keepSettings); });
    sh.querySelector('#pr-replace')?.addEventListener('click', e => { replace = !replace; e.currentTarget.setAttribute('aria-pressed', String(replace)); e.currentTarget.classList.toggle('sel', replace); sh.querySelector('#pr-save').textContent = replace ? 'Save changes' : 'Save name'; });
    const save = async () => {
      const err = sh.querySelector('#pr-error'), btn = sh.querySelector('#pr-save');
      const body = { name: name.value };
      if (!existing || replace) Object.assign(body, { text: state.text, cwd: state.cwd, provider: state.provider },
        !existing && !keepSettings ? { model: null, effort: null, approvalMode: null, executionMode: null }
          : { model: state.model, effort: state.effort, approvalMode: state.approvalMode, executionMode: state.executionMode });
      btn.disabled = true;
      try {
        const d = await api(existing ? '/prompts/' + encodeURIComponent(existing.id) : '/prompts', { method: existing ? 'PATCH' : 'POST', body: JSON.stringify(body) });
        takeLists(d); if (!existing) activeStarter = d.prompt; closeCurrentSheet?.(); paintStarters();
        toast(existing ? 'Saved prompt updated' : 'Saved. Tap it next time to start the same way.');
      } catch (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; }
    };
    sh.querySelector('#pr-save').onclick = save;
    name.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } };
  }
  // Every saved prompt with Up, Down, Edit and Delete (Delete asks once more).
  function managePrompts(focusId) {
    closeCurrentSheet?.();
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const sh = document.createElement('div'); sh.className = 'sheet prompts-sheet';
    const paint = () => {
      sh.innerHTML = `<h2>Saved prompts</h2>${savedPrompts.length ? '' : '<p class="sheet-help">No saved prompts. Write a task and choose Save as prompt.</p>'}<ul class="prompt-rows">${savedPrompts.map((p, i) => `
        <li class="prompt-row" data-row="${esc(p.id)}"><div class="prompt-row-body"><span class="prompt-row-name">${esc(p.name)}</span><span class="prompt-row-meta">${esc(describe(p))}</span><span class="prompt-row-text">${esc(p.text)}</span></div>
        <div class="prompt-row-actions"><button type="button" class="icon" data-up="${esc(p.id)}" aria-label="Move ${esc(p.name)} earlier" ${i ? '' : 'disabled'}>${IC.up}</button><button type="button" class="icon" data-down="${esc(p.id)}" aria-label="Move ${esc(p.name)} later" ${i < savedPrompts.length - 1 ? '' : 'disabled'}>${IC.down}</button>
        <button type="button" class="chip" data-edit="${esc(p.id)}">Edit</button><button type="button" class="chip prompt-delete" data-del="${esc(p.id)}">Delete</button></div></li>`).join('')}</ul>`;
      sh.querySelectorAll('[data-up],[data-down]').forEach(b => b.onclick = async () => {
        const id = b.dataset.up || b.dataset.down, ids = savedPrompts.map(p => p.id), i = ids.indexOf(id), j = i + (b.dataset.up ? -1 : 1);
        ids.splice(i, 1); ids.splice(j, 0, id);
        try { takeLists(await api('/prompts/order', { method: 'POST', body: JSON.stringify({ ids }) })); paint(); paintStarters(); sh.querySelector(`[${b.dataset.up ? 'data-up' : 'data-down'}="${CSS.escape(id)}"]:not(:disabled)`)?.focus() || sh.querySelector(`[data-row="${CSS.escape(id)}"] button`)?.focus(); }
        catch (e) { toast(e.message); }
      });
      sh.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { closeCurrentSheet?.(); promptSheet(savedPrompts.find(p => p.id === b.dataset.edit)); });
      sh.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Delete for good'; b.classList.add('confirm'); return; }
        try { takeLists(await api('/prompts/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' })); if (activeStarter?.id === b.dataset.del) activeStarter = null; paint(); paintStarters(); toast('Saved prompt deleted'); sh.querySelector('button')?.focus(); }
        catch (e) { toast(e.message); }
      });
    };
    paint(); mountSheet(scrim, sh);
    (focusId && sh.querySelector(`[data-row="${CSS.escape(focusId)}"] [data-edit]`) || sh.querySelector('[data-edit]'))?.focus();
    sh.querySelector(`[data-row="${CSS.escape(focusId || '')}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  $('#save-prompt').onclick = () => promptSheet();
  paintSaveButton();
  api('/prompts').then(d => { if (viewVersion !== chatRenderVersion) return; takeLists(d); paintStarters(); }).catch(() => { });
  let newPending = null;
  const startSession = async ({ allowSecrets = false } = {}) => {
    if(uploadsInFlight.get(NEW_KEY))return toast('Wait for the attachment upload to finish.');
    const savedStart = loadOutbox(NEW_KEY);
    const cwd = savedStart?.payload.cwd || $('#cpath').value.trim() || sel;
    const text = savedStart?.payload.text || $('#first').value.trim();
    const hint = msg => { const h = $('#start-hint'); h.textContent = msg; h.hidden = false; };
    if (!cwd) {$('#new-setup').hidden=false;$('#new-setup').open=true;hint('Choose a workspace above, or enter its path.');$('#new-setup').scrollIntoView({block:'start'});return false;}
    if (!text) { hint('Write what you would like done first.'); $('#first').focus(); return false; }
    if (!savedStart && !allowSecrets && holdSecretStart(text)) return false; // 1.42
    $('#start-hint').hidden = true;
    $('#start').disabled = true; $('#start').setAttribute('aria-label', 'Starting…');
    try {
      const payload = savedStart?.payload || { cwd, text, provider, ...turnOpts(), ...(startFrom?.project ? { project: startFrom.project, projectName: startFrom.projectName || '' } : {}), ...(startFrom?.start ? { start: startFrom.start } : {}) };
      const saved = loadOutbox(NEW_KEY);
      if (saved && JSON.stringify(saved.payload) !== JSON.stringify(payload)) { toast('Retry the saved new conversation request before changing it.'); return false; }
      newPending = saved || { payload, clientMessageId: crypto.randomUUID(), ...(allowSecrets ? { allowSecrets: true } : {}) };
      saveOutbox(NEW_KEY, newPending);
      const { id, modelFallback } = await api('/new', { method: 'POST', body: JSON.stringify({ ...newPending.payload, clientMessageId: newPending.clientMessageId, ...(newPending.allowSecrets ? { allowSecrets: true } : {}) }) });
      setPrefs(id,{model:modelFallback?'default':payload.model||'default',effort:payload.effort||'default',executionMode:payload.executionMode||'work',approvalMode:payload.approvalMode||approvalPolicy.defaultMode});
      saveOutbox(NEW_KEY, null);
      clearDraft(NEW_KEY); localStorage.removeItem('pc-attachments-'+NEW_KEY); localStorage.removeItem('pc-new-start'); localStorage.removeItem(briefingKey()); if (tb?.key === NEW_KEY) tb.attachments = [];
      try { localStorage.setItem('pc-lastproj', cwd); } catch { }
      if (payload.project && typeof loadBoard === 'function') loadBoard(true).catch(() => { }); // the card now lists the session
      Voice.carryTo(NEW_KEY, id); // a spoken start keeps its reply and hands-free conversation in the new session
      location.hash = '#/chat/' + id;
      if (modelFallback) modelFellBack(null, modelFallback);
      return true;
    } catch (e) {
      if (e.status >= 400 && e.status < 500 && e.code !== 'delivery_uncertain') saveOutbox(NEW_KEY, null);
      if (e.code === 'start_used') { clearDraft(NEW_KEY); localStorage.removeItem('pc-new-start'); localStorage.removeItem(briefingKey()); location.hash = '#/chat/' + e.body.id; return false; } // 1.96: another tap or device started it
      if (e.code === 'secret_detected') holdSecretStart(newPending?.payload.text || text, e.body?.matches || []);
      else toast(e.message || 'Delivery not confirmed. Retry the same request.');
      return false;
    } finally { const start = $('#start'); if (start) { start.disabled = false; paintNewDelivery(); } }
  };
  // 1.42: the task waits in the box while the owner chooses Store and send, Send as is or Edit.
  const holdSecretStart = (text, matches = null) => secretHold(text, { matches, trigger: $('#first'),
    onAsIs: () => { if (viewVersion === chatRenderVersion) startSession({ allowSecrets: true }); },
    onStore: t => { const f = $('#first'); if (viewVersion !== chatRenderVersion || !f) return toast('Stored. The new conversation was not started.'); f.value = t; saveDraft(NEW_KEY, t); paintSaveButton(); startSession(); } });
  $('#start').onclick = () => startSession();
  Voice.bindComposer({ key: NEW_KEY, send: t => { if (viewVersion !== chatRenderVersion) return false; first.value = t; saveDraft(NEW_KEY, t); paintSaveButton(); return startSession(); } });
}

/* ---------- router ---------- */
async function route() {
  { const f = vaultFocusOf(location.hash); if (f) { history.replaceState(history.state, '', '#/vault'); vaultSetFocus(f); } } // 1.39: a request push opens the list at its Requests; 1.93: at one secret or one request
  rememberViewNavigation(location.hash || '#/');
  rememberReading();stashAttachments(); closeCurrentSheet?.(); ++chatRenderVersion;
  closeES(); chatId = null;
  try { const me = await api('/me?tz=' + encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || '')); window.pocketFeatures = me.features || {}; applyAssistantMode(); if (me.ok === false) { renderLogin(); reportWorkspaceChrome(); return; } loadSecretGuard(); } // 1.20.1: 200 {ok:false} when signed out
  catch (e) { // 401 rendered the login; anything else (offline, deploy restart) gets a retry view
    if (e.message !== 'login') renderUnreachable(e);
    reportWorkspaceChrome(); return;
  }
  await loadApprovalPolicy();
  dockSurface?.remove();dockSurface=null;
  const h = location.hash;
  if (typeof boardView !== 'undefined') boardView = null;
  if (typeof taskView !== 'undefined') taskView = null; // 1.36: a conversation opened from the task list must not count Tasks as the current view
  if (typeof vaultView !== 'undefined') vaultView = null; // 1.39: the same for the Vault
  if (typeof linkView !== 'undefined') linkView = null; // 1.54: and for a linked page
  if (typeof inboxView !== 'undefined') inboxView = null; // 1.69: and for the inbox
  if (h.startsWith('#/chat/')) return renderChat(h.slice(7), { away: true });
  if (typeof docView !== 'undefined') docView = null;
  if (h === '#/projects/scheduled' && tasksOn()) { location.replace('#/tasks'); return; } // 1.50: with Tasks on, reminders are listed there
  if (isViewId(h.slice(2))) return h === '#/vault' ? renderVault('vault') : h === '#/tasks' ? renderTasks('tasks') : h.startsWith('#/inbox') ? renderInbox('inbox') : h.startsWith('#/documents') ? renderDocuments(h.slice(2)) : h.startsWith('#/link/') ? renderLink(h.slice(2)) : renderProjects(h.slice(2)); // 1.29/1.30/1.36/1.54: project, document, task and linked-page views
  if (h.startsWith('#/start/')) return openStartLink(h.slice(8)); // 1.57: a start link puts its briefing in New session
  if (h === '#/new') return renderNew();
  if (h === '#/all') return renderList();
  return assistantMode() ? renderNew({ home: true }) : renderList(); // 1.60: Assistant mode opens on the message box
}
// 1.60: one class on <html> carries Assistant mode's simplifications (app.css), and the window takes its name.
function applyAssistantMode() {
  const on = assistantMode();
  document.documentElement.classList.toggle('assistant', on);
  if (!SOLO && !PANE) document.title = appName();
}
document.addEventListener('load', e => { if (e.target?.classList?.contains('genimg')) scrollBottom(); }, true);
document.addEventListener('keydown', e => {
  const inChat = location.hash.startsWith('#/chat/');
  if (inChat && (e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); findOpen(true); return; }
  if (inChat && chatId && (e.ctrlKey || e.metaKey) && e.key === ';' && SideChat.available(chatId)) { e.preventDefault(); SideChat.toggle(chatId); return; } // 1.78
  if (e.key !== 'Escape') return;
  if (closeCurrentSheet) { e.preventDefault(); closeCurrentSheet(); return; }
  const ov = document.querySelector('.overlay');
  if (ov) return ov.remove();
  if (findIsOpen()) return findOpen(false);
  if(dockSurface?.contains(document.activeElement)){e.preventDefault();return dockSurface.querySelector('[data-close-dock]').click();}
  if (inChat && !PANE && !document.querySelector('.scrim')) location.hash = '#/';
});
window.addEventListener('pagehide',()=>{rememberReading();closeES();});
window.addEventListener('pageshow',e=>{if(e.persisted&&chatId){openES();refreshSessions();}});
window.addEventListener('hashchange', route);
route();
if (!PANE && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* The online app remains usable without installation support. */ });

/* ---------- update announcement ---------- */
// First load after an asset bump: tell an existing install once that it updated and
// where the notes are. Fresh installs (no pc-* keys yet) get no toast.
(() => {
  if (!APP_V || PANE) return;
  const prev = localStorage.getItem('pc-seenv');
  if (prev === String(APP_V)) return;
  localStorage.setItem('pc-seenv', String(APP_V));
  const existing = prev || ['pc-chime', 'pc-rail', 'pc-agent', 'pc-draft'].some(k => localStorage.getItem(k) != null);
  if (existing) setTimeout(() => toast(`Updated to v${APP_V} — see What's new in Settings`), 1500);
})();

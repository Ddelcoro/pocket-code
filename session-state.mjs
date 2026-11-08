// 1.64: the CLI's background job list. A Bash command run in the background or a subagent keeps
// the session's process alive after the reply, and the CLI starts a turn by itself when one
// finishes. Until then the session is working, not finished: this state outranks the outcome
// and the transcript's age, and ends when the CLI reports an empty list or the process exits.
export function backgroundSummary(tasks) {
  const jobs = (Array.isArray(tasks) ? tasks : []).map(t => ({
    kind: /agent/.test(t?.task_type || '') ? 'agent' : 'job',
    description: String(t?.description || t?.subagent_type || '').slice(0, 120),
  }));
  if (!jobs.length) return null;
  const agents = jobs.filter(j => j.kind === 'agent').length, plain = jobs.length - agents;
  const parts = [agents ? `${agents} ${agents === 1 ? 'agent' : 'agents'}` : '', plain ? `${plain} ${plain === 1 ? 'job' : 'jobs'}` : ''].filter(Boolean);
  return { count: jobs.length, summary: parts.join(', '), jobs };
}

// quietSince: the transcript has had no message from another app since our last turn ended. The CLI
// appends its own bookkeeping when its process exits (an idle close, or the process limit making room
// seconds after a reply), and that write alone must not turn Response ready into Recent (1.88.1).
export function sessionState({ turn, external = false, retryAt = null, outcome = null, mtimeMs = 0, background = [], quietSince = false }) {
  if (turn) return {
    kind: 'running', label: 'Running', confirmed: true,
    startedAt: turn.startedAt, queued: turn.queue?.length || 0,
  };
  if (retryAt) return { kind: 'waiting', label: 'Waiting for usage reset', retryAt, confirmed: true };
  const bg = backgroundSummary(background);
  if (bg) return { kind: 'background', label: `Working in background · ${bg.summary}`, confirmed: true, background: bg };
  // A newer external turn invalidates our older outcome. Filesystem flushes can
  // trail our completion callback, so tolerate a small bounded delay.
  if (outcome && (mtimeMs <= outcome.at + 5000 || quietSince)) return { ...outcome, confirmed: true };
  if (external) return { kind: 'observed', label: 'Activity elsewhere', confirmed: false };
  return { kind: 'idle', label: 'Recent', confirmed: false };
}

export function prioritizeSessions(rows, limit) {
  const important = rows.filter(s => s.pinned || ['running', 'background', 'observed', 'waiting', 'failed', 'input'].includes(s.state.kind));
  const importantIds = new Set(important.map(s => s.id));
  return [...important, ...rows.filter(s => !importantIds.has(s.id)).slice(0, Math.max(0, limit - important.length))];
}

// 1.101: a reply to a wrap-up request leaves nothing for the owner to read. Tapping Mark resolved, Remind me … or
// No thanks under a reply starts one more turn, and its short confirmation used to land in Attention as Response
// ready, so the owner had to come back and open it. A turn counts as a wrap-up only when both sides say so:
// the request is a short closing phrase (wrapUpRequest), and the reply asks nothing back (replyAsksNothing).
// Either check failing keeps the ordinary behavior, so a doubtful case still waits in Attention.
const POLITE = /^(?:(?:ok(?:ay)?|yes|yep|sure|great|perfect|thanks|thank you|please|just|no action|leave it)[,.!]?\s+)+/i;
const ITEM = String.raw`(?:it|this|that|them|these|both|all|the\s+(?:inbox(?:\s+watch)?\s+)?(?:alert|story|item|entry|task|reminder|to-?do))`;
// The whole message is the closing phrase, perhaps with a short reason after a comma ("Mark it resolved, Sam has it").
const WHOLE = new RegExp(String.raw`^(?:mark(?:\s+${ITEM})?(?:\s+as)?\s+(?:resolved|done|complete|completed|reviewed|finished|handled)|resolve(?:\s+${ITEM})?|dismiss(?:\s+${ITEM})?|close(?:\s+${ITEM})(?:\s+out)?|not\s+useful|no(?:,)?\s+(?:thanks|thank\s+you|reminder(?:\s+needed)?|task(?:\s+needed)?|need|that'?s\s+(?:all|it|fine))|skip\s+(?:it|the\s+reminder|the\s+task|that)|that'?s\s+(?:all|it|everything)|all\s+(?:set|done|good)|done|nothing\s+else)(?:[,;.!]?\s+(?:thanks|thank\s+you|for\s+now))?(?:[,;]\s+[^,;]{1,50})?$`, 'i');
// The message starts with the closing step and goes on to say when or what ("Remind me Nov 7 to recheck the numbers").
const LEAD = /^(?:remind\s+me\s+(?:to|on|at|in|about|tomorrow|tonight|today|next|this|later|mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d)|set\s+(?:me\s+)?(?:a|the|up\s+a)\s+reminder\b|(?:add|create|make)\s+(?:a|the|it\s+as\s+a|this\s+as\s+a)\s+(?:task|to-?do|reminder)(?:\s+(?:to|for|on|at|about)\b|$))/i;
// Words that add a second step ("Mark it resolved, then deploy", "Remind me Monday and send it now") make it a real request.
const MORE = /\b(?:and|then|also|but|after|before|first|next|now)\b/i;
export function wrapUpRequest(text) {
  const s = String(text ?? '').trim().replace(/[.!]+$/, '').replace(POLITE, '').trim();
  if (!s || s.length > 80 || /[?\n]/.test(s)) return false;          // a question, or anything longer, is a real request
  if (WHOLE.test(s)) { const reason = s.match(/[,;]\s+([^,;]{1,50})$/)?.[1] || ''; return !MORE.test(reason); }
  return LEAD.test(s) && !MORE.test(s.replace(LEAD, '').split(/\bto\b/)[0]);
}
// The turn's own assistant messages ({blocks}) -> true when the last reply is a short statement: no reply buttons,
// no question in its closing paragraph, and not a report (over 1,500 characters) the owner would want to read.
export function replyAsksNothing(msgs) {
  const list = (Array.isArray(msgs) ? msgs : []).filter(m => m && Array.isArray(m.blocks));
  const texts = list.flatMap(m => m.blocks.filter(b => b?.t === 'text').map(b => String(b.text || ''))).filter(t => t.trim());
  if (!texts.length || list.some(m => m.blocks.some(b => b?.t === 'choices'))) return false;
  const all = texts.join('\n\n').trim();
  if (all.length > 1500 || all.includes('```choices')) return false;
  return !texts.at(-1).trim().split(/\n\s*\n/).at(-1).includes('?');
}

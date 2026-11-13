/* Voice mode: speak to a session and hear short spoken replies.
   Speech-to-text and text-to-speech run on the Pocket server (local Whisper + Kokoro, see voice.mjs); this file
   records, detects the end of speech, handles a few short commands on the device, and plays replies.
   Uses app.js globals: api, toast, esc, chatId, composerWorking, sendMsg, allSessions, needsAttention.
   New session binds the same controls with its own key and send (1.58): what you say starts the session, and a
   hands-free conversation follows it into the session it started.
   Two composer buttons: the mic takes one message (tap or hold); the headset starts a hands-free conversation
   that speaks each reply and listens for the answer. Only that conversation ever reopens the microphone:
   session alerts, approval prompts and the spoken reply to anything else never listen afterwards. */
'use strict';
const Voice = (() => {
  const MIC = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v2.5"/></svg>';
  const HEADSET = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 14.5V12a7.5 7.5 0 0115 0v2.5"/><rect x="3.5" y="13.5" width="4" height="6" rx="1.8"/><rect x="16.5" y="13.5" width="4" height="6" rx="1.8"/><path d="M18.5 19.5c0 1.3-1.6 2-4 2H13"/></svg>';
  const PREF_KEY = 'pc-voice';
  const DEFAULTS = { speak: true, review: false, replyWait: 120, alerts: 'off', voice: 'af_heart', vocab: '', replyLength: 'normal', mute: false };
  const LENGTH_CHOICES = [['brief', 'Brief: one sentence'], ['normal', 'Normal: about two sentences'], ['detailed', 'Detailed: the whole reply']];
  const ALERT_CHOICES = [['off', 'Off'], ['name', 'Conversation name only'], ['summary', 'Name and a one-line summary']];
  // A tap means you're about to speak, so silence ends it after 10 s. After a spoken reply (hands-free) the mic
  // waits replyWait seconds, so there is time to read the rest of the reply first. MAX_MS limits one utterance.
  const HOLD_MS = 350, END_SILENCE_MS = 1100, NO_SPEECH_MS = 10000, MAX_MS = 60000;
  const WAIT_CHOICES = [[30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes']];
  let status = null, statusLoading = null;
  let state = 'idle', note = '', noteTimer = null;            // idle | listening | holding | transcribing | speaking
  let rec = null, ctx = null, workletReady = false, wakeLock = null;
  let speech = null;                                            // { cancelled, source }
  let handsFree = null, hfStarting = false;                     // session id of the hands-free conversation, if one is on
  let pendingSend = null;                                       // {id, text}: a hands-free instruction waiting for "send it"
  let boundKey = null, boundSend = null, carry = null;          // New session: its key, its send, and a hands-free hand-over
  const target = () => chatId || boundKey;                      // the conversation the mic speaks to
  const boxEl = () => document.getElementById('box') || document.getElementById('first');
  const send = text => boundSend ? boundSend(text) : sendMsg(text);
  const armed = new Set();                                      // sessions whose next finished turn is spoken
  const lastReply = new Map();                                  // sessionId -> markdown of the latest reply
  const announced = new Map();                                  // sessionId -> kinds already announced this turn

  const prefs = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return { ...DEFAULTS }; } };
  const setPref = (k, v) => { const p = prefs(); p[k] = v; localStorage.setItem(PREF_KEY, JSON.stringify(p)); };

  /* ---------- quick mute: one tap silences every spoken reply, announcement and prompt on this device.
     The other voice settings are kept, so unmuting brings back exactly what was configured. ---------- */
  const isMuted = () => Boolean(prefs().mute);
  function setMuted(on) {
    setPref('mute', Boolean(on));
    if (on) { handsFree = null; pendingSend = null; stopSpeaking(); queue.length = 0; if (state === 'speaking') setState('idle'); }
    paint();
    if (typeof toast === 'function') toast(on ? 'Voice muted on this device until you turn it back on' : 'Voice is back on');
  }
  // The same control in the idle composer (a chip beside Alerts) and in the working row (an icon beside the bell).
  function muteButtonHTML(kind) {
    return `<button class="${kind === 'chip' ? 'chip' : 'icon wbell'} voice-mute" type="button" data-voice-mute hidden aria-pressed="false" aria-label="Mute voice on this device">${IC.speaker}${kind === 'chip' ? '<span data-voice-mute-label>Voice</span>' : ''}</button>`;
  }
  function paintMuteButtons() {
    const on = isMuted();
    document.querySelectorAll('[data-voice-mute]').forEach(b => {
      b.hidden = !status?.available;
      b.setAttribute('aria-pressed', String(on)); b.classList.toggle('set', on); b.classList.toggle('on', on);
      b.setAttribute('aria-label', on ? 'Voice muted on this device. Turn spoken replies and announcements back on' : 'Mute voice on this device: no spoken replies, announcements or prompts until you turn it back on');
      b.title = on ? 'Voice muted' : 'Mute voice';
      const icon = b.querySelector('svg'); if (icon) icon.outerHTML = on ? IC.speakerOff : IC.speaker;
      const label = b.querySelector('[data-voice-mute-label]'); if (label) label.textContent = on ? 'Voice off' : 'Voice';
      b.onclick = () => { unlockAudio(); setMuted(!isMuted()); };
    });
  }
  addEventListener('storage', e => { if (e.key === PREF_KEY) paint(); });   // muted in one tab: every tab shows it

  async function loadStatus(force = false) {
    if (status && !force) return status;
    if (!statusLoading || force) statusLoading = api('/voice/status').catch(() => ({ available: false, reason: 'Could not check voice on the server.' }))
      .then(s => { status = s; statusLoading = null; return s; });
    return statusLoading;
  }

  /* ---------- composer controls ---------- */
  function micHTML() {
    return `<button class="icon voice-mic voice-hf" id="hfb" type="button" hidden aria-pressed="false" aria-label="Hands-free conversation" aria-describedby="voice-strip">${HEADSET}</button>`
      + `<button class="icon voice-mic" id="micb" type="button" hidden aria-pressed="false" aria-label="Voice input" aria-describedby="voice-strip">${MIC}</button>`;
  }
  const inHandsFree = (id = target()) => Boolean(id) && handsFree === id;
  function bindComposer({ key = null, send: sendText = null } = {}) {
    boundKey = key; boundSend = sendText;
    const b = document.getElementById('micb'), hf = document.getElementById('hfb'); if (!b) return;
    loadStatus().then(s => { if (b.isConnected) b.hidden = !s.available; if (hf?.isConnected) hf.hidden = !s.available; paint(); });
    if (hf) hf.onclick = () => handsFreeTap();
    boxEl()?.addEventListener('input', syncDraft);
    let downAt = 0, holdTimer = null;
    b.onpointerdown = e => {
      if (e.button) return;
      downAt = Date.now();
      unlockAudio();
      if (handsFree) { handsFree = null; paint(); }                              // the plain mic is always one message
      if (state === 'idle' || state === 'speaking') holdTimer = setTimeout(() => { holdTimer = null; start('hold'); }, HOLD_MS);
    };
    const up = () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; tap(); }        // short press: a tap
      else if (state === 'holding') finish();                                     // release ends push-to-talk
      downAt = 0;
    };
    b.onpointerup = up;
    b.onpointercancel = () => { if (holdTimer) clearTimeout(holdTimer); holdTimer = null; if (state === 'holding') finish(); };
    b.onclick = e => { if (e.detail === 0) tap(); };                             // keyboard Enter/Space
    paint();
  }
  function tap() {
    if (handsFree) { handsFree = null; paint(); }
    if (state === 'speaking') { stopSpeaking(); return start('auto'); }
    if (state === 'idle') return start('auto');
    if (state === 'listening') return finish();
  }

  // A typed draft turns any voice input into an addition to that draft (nothing is sent), so the headset has
  // nothing to do then; it steps aside and gives the narrow phone composer its width back.
  function syncDraft() {
    const hf = document.getElementById('hfb'), box = boxEl();
    if (hf) hf.classList.toggle('drafting', Boolean(box?.value.trim()) && !inHandsFree());
  }
  function paint() {
    syncDraft(); paintMuteButtons();
    const b = document.getElementById('micb'), hf = document.getElementById('hfb'), strip = document.getElementById('voice-strip');
    const live = state === 'listening' || state === 'holding', conv = inHandsFree();
    if (b) {
      const mine = live && !conv;
      b.setAttribute('aria-pressed', String(mine));
      b.classList.toggle('on', mine);
      b.setAttribute('aria-label', mine ? 'Finish speaking' : state === 'speaking' ? 'Stop reply and speak' : 'Voice input (beta): tap to talk once, hold for push-to-talk');
      b.disabled = state === 'transcribing';
    }
    if (hf) {
      hf.setAttribute('aria-pressed', String(conv));
      hf.classList.toggle('on', conv);
      hf.setAttribute('aria-label', conv ? 'End hands-free conversation' : 'Hands-free conversation (beta): speaks each reply and listens for your answer');
      hf.title = conv ? 'End hands-free' : 'Hands-free conversation';
    }
    if (!strip) return;
    const pre = conv ? 'Hands-free. ' : '';
    const pend = pendingSend?.id === target() ? pendingSend : null;
    const label = { listening: pre + (rec?.reopened && !rec.speechAt ? 'Listening for your reply. Take your time' : conv ? 'Listening. Pause when you’re done' : 'Listening. Tap the mic when you’re done'),
      holding: 'Listening. Release to send', transcribing: pre + 'Transcribing…', speaking: pre + 'Speaking' }[state] || note || (pend ? `Send this? “${pend.text}”` : '') || (conv ? hfStarting ? 'Hands-free. Starting the mic…' : 'Hands-free is on. Waiting for the reply' : '');
    strip.hidden = !label;
    strip.dataset.state = state;
    strip.innerHTML = label ? `${live ? '<span class="voice-level" aria-hidden="true"><i></i><i></i><i></i></span>' : ''}<span class="voice-label">${esc(label)}</span>${
      live ? '<button class="chip" id="voice-cancel" type="button">Cancel</button>' : state === 'speaking' ? '<button class="chip" id="voice-stop" type="button">Stop</button>'
        : pend && state === 'idle' && !note ? '<span class="voice-confirm"><button class="chip voice-send" id="voice-send" type="button">Send</button><button class="chip" id="voice-edit" type="button">Edit</button><button class="chip" id="voice-discard" type="button">Cancel</button></span>'
        : conv && state === 'idle' ? '<button class="chip" id="voice-end" type="button">End hands-free</button>' : ''}` : '';
    if (pend && (live || state === 'speaking')) strip.querySelector('.voice-label')?.insertAdjacentHTML('beforeend', `<span class="voice-pending"> · Waiting to send: “${esc(pend.text)}”</span>`);
    const c = document.getElementById('voice-cancel'); if (c) c.onclick = () => cancel();
    const s = document.getElementById('voice-stop'); if (s) s.onclick = () => { handsFree = null; stopSpeaking(); paint(); };
    const e = document.getElementById('voice-end'); if (e) e.onclick = () => endHandsFree('Hands-free is off.');
    const vs = document.getElementById('voice-send'); if (vs) vs.onclick = () => sendPending();
    const ve = document.getElementById('voice-edit'); if (ve) ve.onclick = () => editPending();
    const vd = document.getElementById('voice-discard'); if (vd) vd.onclick = () => { pendingSend = null; say('Cancelled. Nothing was sent.', 4000); };
  }
  // The headset toggles a hands-free conversation for the open session. It never turns on by itself.
  async function handsFreeTap() {
    unlockAudio();
    if (isMuted() && !inHandsFree()) setMuted(false);           // starting a conversation is asking to hear it
    if (inHandsFree()) return endHandsFree('Hands-free is off.');
    if (!target()) return;
    if (rec) release();
    handsFree = target(); hfStarting = true; paint();
    try { await start('auto'); } finally { hfStarting = false; }
    if (!rec && inHandsFree() && state === 'idle') { handsFree = null; paint(); }   // the mic did not start: nothing is on
  }
  function endHandsFree(message) {
    handsFree = null;
    if (rec) release();
    stopSpeaking();
    setState('idle');
    if (message) say(message, 4000);
  }
  function say(message, ms = 5000) { note = message; paint(); clearTimeout(noteTimer); if (ms) noteTimer = setTimeout(() => { note = ''; paint(); }, ms); }
  function setState(next) { state = next; if (next !== 'idle') { note = ''; clearTimeout(noteTimer); } paint(); keepAwake(); }

  /* ---------- audio plumbing ---------- */
  function unlockAudio() { // must run inside a user gesture on iOS/Safari
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch { }
  }
  async function keepAwake() {
    const want = state !== 'idle' || (handsFree && armed.size);
    try {
      if (want && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      else if (!want && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch { }
  }
  function micError(e) {
    if (window.top !== window && (e?.name === 'NotAllowedError' || e?.name === 'SecurityError')) return 'The microphone is blocked in this embedded view. Open Pocket Code directly to use voice.';
    if (e?.name === 'NotAllowedError') return 'Microphone permission is off. Allow it for this site in the browser settings.';
    if (e?.name === 'NotFoundError') return 'No microphone was found.';
    if (!window.isSecureContext) return 'Voice needs HTTPS.';
    return 'The microphone could not start.';
  }

  /* ---------- listening ---------- */
  async function start(mode, { waitMs = NO_SPEECH_MS, reopened = false } = {}) {
    const s = await loadStatus();
    if (!s.available) { toast(s.reason || 'Voice is not available on this server.'); return; }
    if (!target()) return;
    stopSpeaking();
    unlockAudio();
    if (!ctx || !navigator.mediaDevices?.getUserMedia) { say(micError()); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
    catch (e) { say(micError(e), 8000); return; }
    try {
      if (!workletReady) { await ctx.audioWorklet.addModule('voice-worklet.js?v=49'); workletReady = true; }
      const src = ctx.createMediaStreamSource(stream), node = new AudioWorkletNode(ctx, 'pocket-capture'), sink = ctx.createGain();
      sink.gain.value = 0; src.connect(node); node.connect(sink); sink.connect(ctx.destination);   // a pulled graph keeps the worklet running
      rec = { session: target(), mode, stream, src, node, sink, chunks: [], rate: ctx.sampleRate, startedAt: Date.now(), waitMs, reopened, handsFree: inHandsFree(),
        floor: null, warm: 0, voiced: 0, speechAt: 0, lastVoiceAt: 0 };
      node.port.onmessage = e => hear(e.data);
      setState(mode === 'hold' ? 'holding' : 'listening');
    } catch { stream.getTracks().forEach(t => t.stop()); say('The microphone could not start.'); }
  }
  function hear({ samples, rms }) {
    const r = rec; if (!r) return;
    r.chunks.push(samples);
    const now = Date.now();
    if (r.warm < 6) { r.floor = r.floor == null ? rms : Math.min(r.floor * 0.7 + rms * 0.3, Math.max(r.floor, rms)); r.warm++; }
    const threshold = Math.max(0.012, (r.floor || 0) * 2.6);
    if (rms > threshold) { r.voiced++; r.lastVoiceAt = now; if (r.voiced >= 3 && !r.speechAt) { r.speechAt = now; if (r.reopened) paint(); } }
    else r.voiced = Math.max(0, r.voiced - 1);
    const strip = document.getElementById('voice-strip');
    if (strip) strip.style.setProperty('--lvl', Math.min(1, rms / Math.max(threshold * 4, 0.05)).toFixed(2));
    if (r.mode !== 'auto') { if (now - r.startedAt > MAX_MS) finish(); return; }
    if (r.speechAt && now - r.lastVoiceAt > END_SILENCE_MS) finish();
    else if (r.speechAt && now - r.speechAt > MAX_MS) finish();
    else if (!r.speechAt && now - r.startedAt > r.waitMs) { const conv = r.handsFree; cancel(); say(conv ? 'Stopped listening. Hands-free is off.' : 'I didn’t hear anything.', conv && r.reopened ? 0 : 5000); }
    else if (!r.speechAt && r.chunks.length > (r.rate * 8) / 2048) r.chunks.splice(0, r.chunks.length - Math.ceil((r.rate * 8) / 2048)); // keep only recent silence
  }
  function release() {
    const r = rec; rec = null; if (!r) return null;
    try { r.node.port.onmessage = null; r.src.disconnect(); r.node.disconnect(); r.sink.disconnect(); } catch { }
    r.stream.getTracks().forEach(t => t.stop());
    return r;
  }
  function cancel() { release(); handsFree = null; setState('idle'); }   // Cancel also ends a hands-free conversation

  // Float32 at the device rate → 16 kHz 16-bit PCM (box-filter downsample; plenty for speech recognition).
  function toPcm16(chunks, rate) {
    const total = chunks.reduce((n, c) => n + c.length, 0), ratio = rate / 16000, out = new Int16Array(Math.floor(total / ratio));
    const all = new Float32Array(total); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    for (let i = 0; i < out.length; i++) {
      const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio)); let sum = 0;
      for (let j = a; j < b && j < total; j++) sum += all[j];
      out[i] = Math.max(-1, Math.min(1, sum / (b - a))) * 32767;
    }
    return out;
  }
  async function finish() {
    const r = release(); if (!r) return;
    if (r.mode === 'auto' && !r.speechAt) { setState('idle'); return; }
    const pcm = toPcm16(r.chunks, r.rate);
    if (pcm.length < 16000 * 0.3) { setState('idle'); say('That was too short to hear.'); return; }
    setState('transcribing');
    let text = '';
    try {
      const res = await fetch('/api/voice/transcribe', { method: 'POST', body: pcm.buffer,
        headers: { 'Content-Type': 'application/octet-stream', 'X-Vocabulary': vocabulary() } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Transcription failed.');
      text = (j.text || '').trim();
    } catch (e) { setState('idle'); say(e.message || 'Transcription failed.', 8000); return; }
    setState('idle');
    const left = r.waitMs - (Date.now() - r.startedAt);
    if (r.handsFree && inHandsFree(r.session) && (!text || VoiceText.isNoise(text, pcm.length / 16000)) && left > 2000 && r.session === target()) return start('auto', { waitMs: left, reopened: r.reopened });
    if (!text) { if (r.handsFree) handsFree = null; say(r.handsFree ? 'I didn’t catch that. Hands-free is off.' : 'I didn’t catch that.'); return; }
    if (r.session !== target()) { handsFree = null; say('You switched conversations, so that wasn’t sent.'); return; }
    await handle(text);
  }
  const replyLength = () => LENGTH_CHOICES.some(([v]) => v === prefs().replyLength) ? prefs().replyLength : DEFAULTS.replyLength;
  function replyWaitMs() { const s = Number(prefs().replyWait); return (WAIT_CHOICES.some(([v]) => v === s) ? s : DEFAULTS.replyWait) * 1000; }
  function vocabulary() {
    const own = prefs().vocab, names = (allSessions || []).slice(0, 12).map(s => s.title || '').join(', ');
    return `Pocket Code, Claude, Codex. ${own} ${names}`.replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').slice(0, 400);
  }

  /* ---------- what was said ---------- */
  async function handle(text) {
    const id = target();
    if (pendingSend?.id === id) return confirmStep(text);
    const kind = VoiceText.intent(text);
    if (kind) { say(`Heard: “${text}”`, 4000); return command(kind, id); }
    const p = prefs();
    const box = boxEl();
    // Review mode, or a typed draft already in the box: add the words to the draft and let the user send it.
    // Never send a half-written draft on the user's behalf.
    const draft = box?.value.trim();
    if (p.review || draft || !box || box.readOnly || box.disabled) {
      handsFree = null;                                          // nothing is sent, so there is no reply to listen after
      if (box && !box.readOnly && !box.disabled) { box.value = draft ? `${draft} ${text}` : text; box.dispatchEvent(new Event('input')); box.focus(); }
      say(box?.readOnly || box?.disabled ? `Heard: “${text}”. Resolve the pending message first.` : draft ? 'Added to your draft. Review it, then send.' : 'Review the text, then send it.', 6000);
      return;
    }
    if (inHandsFree(id)) return askToSend(id, text);       // hands-free never starts a turn without a yes
    if (heldAsSecret(text)) { say('That sounded like a password or key, so it was not sent. Choose what to do in the sheet.', 8000); await send(text); return; }
    say(`${boundSend ? 'Starting' : 'Sent'}: “${text}”`, 5000);
    if (p.speak) arm(id);
    await send(text);
  }
  // 1.42: a dictated message that sounds like it carries a key or password is held by sendMsg's sheet, so say that, not "Sent".
  const heldAsSecret = text => typeof PocketSecrets !== 'undefined' && typeof secretGuard !== 'undefined' && secretGuard.on && PocketSecrets.scan(text, { mode: 'message' }).length > 0;
  // Hands-free: read the instruction back and wait for "send it" (or a tap) before anything reaches the agent.
  function askToSend(id, text) {
    pendingSend = { id, text }; paint();
    const short = text.length > 140 ? text.slice(0, 140).replace(/\s+\S*$/, '') + ', and the rest' : text;
    return speakOut(`Ready to send: ${short}. Say send it, or cancel.`, { listenAfter: true });
  }
  async function confirmStep(text) {
    const p = pendingSend, a = VoiceText.confirmReply(text);
    if (a === 'yes') return sendPending();
    if (a === 'edit') return editPending();
    if (a === 'no') { pendingSend = null; paint(); return speakOut('Cancelled. Nothing was sent.', { listenAfter: inHandsFree(p.id) }); }
    return askToSend(p.id, text);                              // a different instruction replaces it and is confirmed again
  }
  async function sendPending() {
    const p = pendingSend; if (!p) return;
    pendingSend = null;
    if (p.id !== target()) { say('You switched conversations, so that wasn’t sent.'); return; }
    if (heldAsSecret(p.text)) { say('That sounded like a password or key, so it was not sent. Choose what to do in the sheet.', 8000); await send(p.text); return; }
    say(`${boundSend ? 'Starting' : 'Sent'}: “${p.text}”`, 5000);
    if (prefs().speak || inHandsFree(p.id)) arm(p.id);
    // New session reports false when nothing started (no workspace, held as a secret): there is no reply to wait for.
    if (await send(p.text) === false && inHandsFree(p.id)) { handsFree = null; armed.delete(p.id); say('The conversation did not start. Hands-free is off.', 8000); }
  }
  function editPending() {
    const p = pendingSend; if (!p) return;
    pendingSend = null; handsFree = null; if (rec) release(); stopSpeaking(); setState('idle');
    const box = boxEl();
    if (box && !box.readOnly) { box.value = box.value.trim() ? `${box.value.trim()} ${p.text}` : p.text; box.dispatchEvent(new Event('input')); box.focus(); }
    say('Edit the message, then send it.', 6000);
  }
  function arm(id) { armed.add(id); announced.delete(id); keepAwake(); }

  // Quick answers keep a hands-free conversation going.
  async function command(kind, id) {
    const speak = text => speakOut(text, { listenAfter: inHandsFree(id) });
    if (kind === 'quiet') { handsFree = null; stopSpeaking(); return paint(); }
    if (kind === 'mute') { setMuted(true); return; }
    if (kind === 'unmute') { setMuted(false); return speak('Voice is back on.'); }
    if (kind === 'stop') {
      if (!composerWorking) return speak('Nothing is running in this conversation.');
      armed.delete(id);
      try { await api(`/session/${id}/stop`, { method: 'POST', body: '{}' }); return speak('Stopped.'); }
      catch (e) { return speak('I couldn’t stop it. ' + (e.message || '')); }
    }
    if (kind === 'status') {
      if (composerWorking) {
        const step = latestStep();
        return speak(step ? `It’s working. Latest step: ${step}.` : 'It’s working on the server.');
      }
      const s = replySummary(id);
      return speak(s ? `It isn’t running right now. Its last reply: ${s}` : 'It isn’t running right now.');
    }
    if (kind === 'read' || kind === 'readAll') {
      const md = replyText(id);
      if (!md) return speak('There’s no reply to read yet.');
      return speak(kind === 'readAll' ? VoiceText.full(md) : VoiceText.reply(md, replyLength()));
    }
    if (kind === 'waiting') {
      const here = [!document.getElementById('approvals-open')?.hidden && 'this conversation needs an approval', !document.getElementById('questions-open')?.hidden && 'this conversation has a question'].filter(Boolean);
      const others = (allSessions || []).filter(s => s.id !== id && needsAttention(s)).map(s => s.title || 'an untitled conversation').slice(0, 4);
      if (!here.length && !others.length) return speak('Nothing is waiting on you.');
      return speak([here.length ? cap(here.join(' and ')) + '.' : '', others.length ? `${others.length === 1 ? 'One other conversation needs you' : `${others.length} other conversations need you`}: ${others.join(', ')}.` : ''].join(' ').trim());
    }
  }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  function latestStep() {
    const lines = document.querySelectorAll('#msgs .ledger'); const l = lines[lines.length - 1]; if (!l) return '';
    return VoiceText.stepText(l.querySelector('.name')?.textContent, l.querySelector('.det')?.textContent);
  }
  function replyText(id) {
    if (lastReply.get(id)) return lastReply.get(id);
    const all = document.querySelectorAll('#msgs .m-asst:not(.live)'); const m = all[all.length - 1]; if (!m) return '';
    const c = m.cloneNode(true); c.querySelectorAll('.copybtn,.ledgerwrap,.choices,pre,table,.todo,.todos').forEach(n => n.remove());
    return (c.innerText || c.textContent || '').trim();
  }
  const replySummary = id => { const t = replyText(id); return t ? VoiceText.reply(t, replyLength() === 'brief' ? 'brief' : 'normal') : ''; }; // a status answer stays short

  /* ---------- speaking ---------- */
  async function speakOut(text, { listenAfter = false, force = false } = {}) {
    stopSpeaking();
    const parts = VoiceText.chunks(text); if (!parts.length) return;
    if (isMuted() && !force) { say(text.length > 160 ? text.slice(0, 157) + '…' : text, 8000); return true; } // muted: the answer is shown, not spoken
    unlockAudio(); if (!ctx) { say(text, 8000); return; }
    if (ctx.state !== 'running') { try { await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, 400))]); } catch { } }
    if (ctx.state !== 'running') { say('Tap anywhere to turn on spoken replies and alerts.', 8000); return false; } // browsers need one tap first
    const me = speech = { cancelled: false, source: null };
    setState('speaking');
    const fetchPart = t => fetch('/api/voice/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t, voice: prefs().voice }) })
      .then(r => { if (!r.ok) throw new Error('speak'); return r.arrayBuffer(); }).then(b => ctx.decodeAudioData(b));
    try {
      let next = fetchPart(parts[0]);
      for (let i = 0; i < parts.length && !me.cancelled; i++) {
        const buf = await next;
        if (i + 1 < parts.length) { next = fetchPart(parts[i + 1]); next.catch(() => {}); } // fetch ahead while this part plays
        if (me.cancelled) break;
        await new Promise(done => { const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.onended = done; me.source = src; src.start(); });
      }
    } catch { if (!me.cancelled) say('The reply could not be spoken. It’s on screen.', 6000); }
    // Listening again needs both: a caller that asked for it (a reply, never an alert) and a hands-free
    // conversation still on for the open session.
    if (speech === me) { speech = null; setState('idle'); if (!me.cancelled && listenAfter && inHandsFree()) start('auto', { waitMs: replyWaitMs(), reopened: true }); }
    return true;
  }
  // Any tap or click anywhere unlocks audio for later alerts (browser autoplay rules).
  document.addEventListener('pointerdown', () => unlockAudio(), { capture: true, passive: true });
  function stopSpeaking() {
    const s = speech; speech = null; if (!s) return;
    s.cancelled = true; try { s.source?.stop(); } catch { }
    if (state === 'speaking') setState('idle');
  }

  /* ---------- session events (called from app.js) ---------- */
  function onAssistant(id, msg) {
    const text = (msg?.blocks || []).filter(b => b.t !== 'tool' && b.t !== 'todo' && b.text).map(b => b.text).join('\n\n').trim();
    if (text) lastReply.set(id, text);
  }
  function onTurnEnd(id, ok, error) {
    announced.delete(id);
    if (!armed.has(id)) return;
    if (ok === false && /stopped by you/i.test(error || '')) { armed.delete(id); keepAwake(); return; }
    armed.delete(id); keepAwake();
    if (isMuted()) return;                                     // muted: the reply stays on screen; the chime preference applies
    const conv = inHandsFree(id);
    if (id !== chatId || (!prefs().speak && !conv)) return;
    spokenTurnEnd.set(id, Date.now());                         // its spoken reply stands in for the alert
    const md = lastReply.get(id) || replyText(id);
    const line = ok === false ? 'It didn’t finish. Details are on screen.' : md ? VoiceText.reply(md, replyLength()) : 'It finished.';
    speakOut(line, { listenAfter: conv });                     // only a hands-free conversation listens after a reply
  }
  /* ---------- spoken alerts: any session finishing or needing you, while Pocket is open ---------- */
  const spokenTurnEnd = new Map(), seen = new Map(), queue = [];
  let baselined = false;
  const alertMode = () => (status?.available && !isMuted() && ALERT_CHOICES.some(([v]) => v === prefs().alerts)) ? prefs().alerts : 'off';
  function replacesChime() { return alertMode() !== 'off'; }
  // Cross-tab dedupe: two Pocket tabs (or Mission Control plus standalone) say each event once.
  function claim(key) {
    let m = {}; try { m = JSON.parse(localStorage.getItem('pc-voice-alerted') || '{}'); } catch { }
    if (m[key]) return false;
    const now = Date.now(); m[key] = now;
    for (const k of Object.keys(m)) if (now - m[k] > 86400000) delete m[k];
    try { localStorage.setItem('pc-voice-alerted', JSON.stringify(m)); } catch { }
    return true;
  }
  function onSessions(list) {
    if (typeof PANE !== 'undefined' && PANE) return;             // split panes: only the main window speaks
    if (!status) { loadStatus(); return; }
    const mode = alertMode(), first = !baselined;
    baselined = true;
    for (const s of list || []) {
      const st = s.state || {}, prev = seen.get(s.id);
      seen.set(s.id, { kind: st.kind, at: st.at || 0, approvals: st.approvals || 0, questions: st.questions || 0 });
      if (first || mode === 'off' || s.muted) continue;
      let kind = null;
      // Compare with the previous check, not clocks: device and server time can differ.
      if (['finished', 'failed', 'ended'].includes(st.kind) && st.at && st.at !== prev?.at) kind = st.kind === 'finished' ? 'finished' : 'failed';
      else if (st.kind === 'input' && (prev?.kind !== 'input' || (st.approvals || 0) > prev.approvals || (st.questions || 0) > prev.questions)) kind = 'input';
      if (!kind) continue;
      if (kind === 'finished' && Date.now() - (spokenTurnEnd.get(s.id) || 0) < 60000) continue;
      if (!claim(`${s.id}|${kind}|${st.at || ''}|${st.approvals || 0}|${st.questions || 0}`)) continue;
      announce({ id: s.id, title: s.title, kind, approvals: st.approvals || 0 }, mode);
    }
  }
  async function announce(ev, mode) {
    let reply = '';
    if (ev.kind === 'finished' && mode === 'summary') {
      try { const d = await api(`/session/${encodeURIComponent(ev.id)}`, { signal: AbortSignal.timeout(8000) });
        const m = [...(d.messages || [])].reverse().find(x => x.role === 'assistant');
        reply = (m?.blocks || []).filter(b => b.t !== 'tool' && b.t !== 'todo' && b.text).map(b => b.text).join('\n\n'); } catch { }
    }
    queue.push(VoiceText.alertText({ ...ev, reply }, mode));
    drain();
  }
  // Alerts wait their turn: never over you speaking, a recording, or another reply. They never listen afterwards.
  let audioLocked = false;
  async function drain() {
    if (!queue.length || audioLocked || state !== 'idle' || speech || rec) return;
    const text = queue.shift();
    if (await speakOut(text) === false) { queue.unshift(text); audioLocked = true; } // keep it until the next tap
  }
  document.addEventListener('pointerdown', () => { if (audioLocked) { audioLocked = false; setTimeout(drain, 300); } }, { capture: true, passive: true });
  setInterval(() => {
    drain();
    // A hidden tab stops the list's own 5 s refresh; keep checking when alerts are on.
    if (alertMode() !== 'off' && document.visibilityState !== 'visible' && !document.querySelector('.login') && typeof refreshSessions === 'function') refreshSessions();
  }, 8000);
  setInterval(() => { if (queue.length) drain(); }, 700);

  function onIdle(id) { if (armed.delete(id)) keepAwake(); } // stopped or ended without a result: nothing to read
  function onAttention(id, kind) {
    if (!armed.has(id) || id !== chatId || isMuted()) return;
    setTimeout(() => {
      const banner = document.getElementById(kind === 'approvals' ? 'approvals-open' : kind === 'vault' ? 'vault-open' : 'questions-open');
      if (!banner || banner.hidden) return;
      const seen = announced.get(id) || new Set(); if (seen.has(kind)) return;
      seen.add(kind); announced.set(id, seen);
      speakOut(kind === 'approvals' ? 'It needs your approval. Review it on screen.' : kind === 'vault' ? 'It needs a secret from the Vault. Allow it on screen.' : 'It has a question for you on screen.');
    }, 800);
  }
  // nextId: the conversation being opened. A session started from New session by voice keeps its conversation going.
  function onLeave(nextId) {
    const c = carry; carry = null;
    if (boundKey) armed.delete(boundKey);
    boundKey = null; boundSend = null;
    if (c && nextId && c.to === nextId) { if (rec) { release(); setState('idle'); } if (c.handsFree) handsFree = nextId; paint(); return; } // a mic still open for New session stops; the conversation does not
    handsFree = null; pendingSend = null; if (rec) cancel(); stopSpeaking(); paint();
  }
  // New session started `to`: its spoken reply and any hands-free conversation move from the New session key to it.
  function carryTo(from, to) {
    if (armed.delete(from)) arm(to);
    carry = { to, handsFree: handsFree === from };
  }

  /* ---------- settings ---------- */
  function settingsHTML() {
    const p = prefs();
    const toggle = (id, on, title, sub) => `<button class="opt" id="${id}" aria-pressed="${on}"><span class="dot ${on ? 'on' : ''}"></span><span>${title}<span class="sub">${sub}</span></span></button>`;
    return `<details class="settings-details" id="s-voice"><summary>Voice (beta)</summary>
      <div class="voice-settings">
        <p id="s-voice-state" role="status">Checking voice on the server…</p>
        ${toggle('s-voice-mute', p.mute, 'Mute voice on this device', 'Nothing is spoken here: replies, announcements, approval prompts. The settings below are kept for when you unmute. Also in the composer, or say “mute”')}
        ${toggle('s-voice-speak', p.speak, 'Speak replies', 'Read the reply aloud when a reply you asked for by voice finishes')}
        <label class="voice-field">Spoken reply length<select id="s-voice-length">${LENGTH_CHOICES.map(([v, l]) => `<option value="${v}"${replyLength() === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <p class="sub">Applies to replies and “read it”. Detailed skips code, tables and links, and stops after about three minutes. Say “read it all” for the whole reply at any length.</p>
        ${toggle('s-voice-review', p.review, 'Review before sending', 'Put what you said in the message box instead of sending it')}
        <label class="voice-field">Announce conversations<select id="s-voice-alerts">${ALERT_CHOICES.map(([v, l]) => `<option value="${v}"${p.alerts === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <p class="sub">Says when any conversation finishes or needs you, while Pocket is open, in place of the chime. Muted conversations stay quiet.</p>
        <label class="voice-field">Hands-free: wait for my reply<select id="s-voice-wait">${WAIT_CHOICES.map(([v, l]) => `<option value="${v}"${Number(p.replyWait) === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="voice-field">Voice<select id="s-voice-voice"></select></label>
        <label class="voice-field">Names and terms to recognize<input id="s-voice-vocab" type="text" autocomplete="off" spellcheck="false" placeholder="MemStem, TechPro, Zoho" value="${esc(p.vocab)}"></label>
        <button class="chip" id="s-voice-test" type="button">Play a sample</button>
        <p class="sub">Tap the mic to send one message; it sends when you pause. Hold it for push-to-talk. Tap the headset for a hands-free conversation: each reply is spoken and the mic listens for your answer, until you end it or stay quiet. In hands-free, Pocket reads your instruction back and sends it only after you say “send it” or tap Send. Announcements never turn on the mic. Say “what’s it doing”, “stop”, “read it” or “what’s waiting on me” for quick answers; “mute” and “unmute” switch spoken output on this device. Speech is processed on your Pocket server.</p>
        <p class="sub">Voice is in beta and still improving. Report problems under Bugs &amp; feature requests.</p>
      </div></details>`;
  }
  function bindSettings(root) {
    const flip = (sel, key) => { const b = root.querySelector(sel); if (!b) return; b.onclick = () => { const on = !prefs()[key]; setPref(key, on); b.setAttribute('aria-pressed', String(on)); b.querySelector('.dot').classList.toggle('on', on); }; };
    flip('#s-voice-speak', 'speak'); flip('#s-voice-review', 'review');
    const mute = root.querySelector('#s-voice-mute'); if (mute) mute.onclick = () => { setMuted(!isMuted()); mute.setAttribute('aria-pressed', String(isMuted())); mute.querySelector('.dot').classList.toggle('on', isMuted()); };
    const vocab = root.querySelector('#s-voice-vocab'); if (vocab) vocab.onchange = () => setPref('vocab', vocab.value.trim().slice(0, 300));
    const length = root.querySelector('#s-voice-length'); if (length) length.onchange = () => setPref('replyLength', length.value);
    const wait = root.querySelector('#s-voice-wait'); if (wait) wait.onchange = () => setPref('replyWait', Number(wait.value));
    const alerts = root.querySelector('#s-voice-alerts'); if (alerts) alerts.onchange = () => { setPref('alerts', alerts.value); unlockAudio(); };
    loadStatus(true).then(s => {
      const st = root.querySelector('#s-voice-state'), sel = root.querySelector('#s-voice-voice'), test = root.querySelector('#s-voice-test');
      if (!st) return;
      st.textContent = s.available ? 'Voice is available on this server.' : s.reason || 'Voice is not available on this server.';
      root.querySelectorAll('#s-voice .opt, #s-voice-voice, #s-voice-alerts, #s-voice-wait, #s-voice-vocab, #s-voice-test').forEach(el => { el.disabled = !s.available; });
      if (sel) { sel.innerHTML = (s.voices || [{ id: 'af_heart', label: 'American female' }]).map(v => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join(''); sel.value = prefs().voice; sel.onchange = () => setPref('voice', sel.value); }
      if (test) test.onclick = () => { unlockAudio(); speakOut('This is how spoken replies will sound in Pocket Code.', { force: true }); }; // a sample is asked for, muted or not
      document.querySelectorAll('#micb, #hfb').forEach(b => { b.hidden = !s.available; });
    });
  }

  return { micHTML, muteButtonHTML, bindComposer, carryTo, paint, onAssistant, onTurnEnd, onIdle, onSessions, replacesChime, onAttention, onLeave, settingsHTML, bindSettings, speak: speakOut, stopSpeaking, isMuted, setMuted, _test: { toPcm16, handsFree: () => handsFree, setHandsFree: id => { handsFree = id; paint(); }, arm: id => armed.add(id), state: () => state, handle: t => handle(t), pending: () => pendingSend } };
})();

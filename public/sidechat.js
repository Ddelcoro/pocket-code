/* 1.78: Side chat. A private aside next to a Claude conversation: ask about it while it keeps working, and nothing
   is added to it. The server (sidechat.mjs) runs a forked, unsaved, read-only copy of the conversation and keeps the
   side chat's events, so this panel holds no history of its own: opening it replays them, on any device. It docks
   beside the conversation on a wide window (with Results, Queue and Git) and is a sheet on a phone. */
// 1.79: two ways off a conversation, worded the same everywhere they appear (buttons, hover text, Conversation options,
// the panel and the Branch sheet) so they are never confused.
const SIDE_WHAT = 'Ask a quick question about this conversation. Nothing is saved and nothing changes.';
const BRANCH_WHAT = 'Start a new saved conversation that carries on from here and can do work. This one stays as it is.';
const SideChat = (() => {
  const sides = new Map(); // conversation id -> its live side chat id
  let view = null;         // {parentId, sh, es, list, box, send, status, busy, total, model, ended, live}
  const available = id => Boolean(id) && (window.PocketEngines?.has(window.PocketEngines.providerOf(id), 'sideChat') ?? true); // 1.86: where the engine has it
  const modelName = m => { if (!m) return 'Default model'; const hit = (typeof MODELS !== 'undefined' ? MODELS : []).find(x => x[0] === m); return hit ? hit[1] : m; };
  const money = n => '$' + (n < 0.01 && n > 0 ? n.toFixed(3) : n.toFixed(2));
  const ENDED = { idle: 'This side chat ended after a quiet spell.', 'account sign-in': 'This side chat ended because the Claude sign-in changed.',
    replaced: 'This side chat was replaced by a newer one.', limit: 'This side chat ended to make room for another.', 'daemon stopped': 'This side chat ended because Pocket restarted.' };
  const isOpen = () => Boolean(view?.sh.isConnected);

  function paintState() {
    if (!isOpen()) return;
    const v = view;
    v.send.textContent = v.busy ? 'Stop' : 'Ask';
    v.send.classList.toggle('side-stop', v.busy);
    v.send.setAttribute('aria-label', v.busy ? 'Stop the answer' : 'Ask in the side chat');
    v.status.textContent = v.busy ? 'Answering…' : v.total ? `${modelName(v.model)} · ${money(v.total)} so far` : v.model ? modelName(v.model) : '';
    v.sh.querySelector('[data-side-new]').hidden = !sides.get(v.parentId) && !v.list.querySelector('.m-user');
    v.sh.querySelector('.side-empty').hidden = Boolean(v.list.children.length);
  }
  function note(text, cls = '') { view.list.insertAdjacentHTML('beforeend', `<div class="turnmeta ${cls}" role="status">${esc(text)}</div>`); }
  function scrollEnd() { const s = view.list.closest('.side-scroll'); if (s) s.scrollTop = s.scrollHeight; }
  function onEvent(v, d) {
    if (view !== v || !isOpen()) { v.es?.close(); return; }
    const dropLive = () => { v.live?.remove(); v.live = null; };
    if (d.type === 'user') { v.busy = true; v.list.insertAdjacentHTML('beforeend', msgHTML({ role: 'user', text: d.msg.text, ts: d.msg.ts })); }
    else if (d.type === 'delta') {
      if (!v.live?.isConnected) { v.list.insertAdjacentHTML('beforeend', '<div class="m-asst live"></div>'); v.live = v.list.lastElementChild; }
      v.live.textContent += d.text;
    } else if (d.type === 'assistant') {
      dropLive();
      v.list.insertAdjacentHTML('beforeend', msgHTML({ ...d.msg, blocks: (d.msg.blocks || []).filter(b => b.t !== 'choices') }));
      mergeToolFolds(v.list);
    } else if (d.type === 'result') {
      dropLive(); v.busy = false; v.total = d.total || 0;
      if (d.error) note(d.error, d.error === 'Stopped' ? '' : 'side-error');
      else { const meta = [d.cost != null ? money(d.cost) : '', d.duration_ms ? Math.max(1, Math.round(d.duration_ms / 1000)) + 's' : ''].filter(Boolean).join(' · '); if (meta) note(meta); }
    } else if (d.type === 'error') { dropLive(); v.busy = false; note(d.error, 'side-error'); }
    else if (d.type === 'closed') {
      dropLive(); v.busy = false; v.ended = true; v.es?.close(); v.es = null;
      if (sides.get(v.parentId) === v.side) sides.delete(v.parentId);
      if (d.why !== 'closed') note((ENDED[d.why] || 'This side chat has ended.') + ' Your next question starts a new one.');
    }
    paintState(); scrollEnd();
  }
  // Replays the side chat's events from the start, then follows it (EventSource resumes after the last event it saw).
  function connect(v, side) {
    v.es?.close();
    v.side = side; v.ended = false; v.list.innerHTML = ''; v.live = null; v.busy = false; v.total = 0;
    const es = new EventSource(`/api/side/${encodeURIComponent(side)}/events?from=0`);
    v.es = es;
    es.onmessage = ev => { let d; try { d = JSON.parse(ev.data); } catch { return; } onEvent(v, d); };
    es.onerror = () => { if (view !== v || !isOpen()) es.close(); else if (es.readyState === EventSource.CLOSED) { v.es = null; if (!v.ended) { sides.delete(v.parentId); v.ended = true; paintState(); } } };
  }
  async function ask(text) {
    const v = view; if (!v) return;
    text = text.trim(); if (!text) return;
    if (v.busy) return toast('Wait for the answer, or stop it, before asking again.');
    v.send.disabled = true;
    try {
      // 1.89 (S-2): the mode the conversation's next message would use, so a Full access conversation's side chat can search the web
      const approvalMode = typeof nextApprovalMode === 'function' && typeof getPrefs === 'function' ? nextApprovalMode(getPrefs(v.parentId)) : undefined;
      const r = await api(`/session/${v.parentId}/side`, { method: 'POST', body: JSON.stringify({ text, side: v.ended ? undefined : sides.get(v.parentId), approvalMode }) });
      v.box.value = ''; sizeBox(v.box);
      v.model = r.model;
      if (r.side !== v.side || !v.es) { sides.set(v.parentId, r.side); connect(v, r.side); }
      v.busy = true; paintState();
    } catch (e) {
      if (e.code === 'secret_detected') toast('That looks like a secret, so it was not sent. Store it in the Vault and use its name instead.');
      else toast(e.message || 'Could not send to the side chat.');
    } finally { v.send.disabled = false; if (view === v) v.box.focus(); }
  }
  async function stop() { const v = view; if (!v?.side) return; try { await api(`/side/${v.side}/stop`, { method: 'POST', body: '{}' }); } catch { } }
  async function startOver() {
    const v = view; if (!v) return;
    const side = sides.get(v.parentId); sides.delete(v.parentId);
    v.es?.close(); v.es = null; v.side = null; v.ended = true; v.busy = false; v.total = 0; v.list.innerHTML = '';
    paintState(); v.box.focus();
    if (side) try { await api(`/side/${side}`, { method: 'DELETE' }); } catch { }
  }
  function sizeBox(box) { box.style.height = 'auto'; box.style.height = Math.min(box.scrollHeight + 2, 160) + 'px'; }

  // question: asked at once (/btw); draft: only put in the box (moved over from Branch).
  async function open(parentId, question = '', { draft = '' } = {}) {
    if (!available(parentId)) return; // 1.81: only a missing id; Claude and Codex both have a side chat, so there is nothing to say
    if (isOpen() && view.parentId === parentId) { if (question) ask(question); else { if (draft) { view.box.value = draft; sizeBox(view.box); } view.box.focus(); } return; }
    view?.es?.close();
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const sh = document.createElement('div'); sh.className = 'sheet side-sheet';
    sh.innerHTML = `<h2>Side chat</h2>
      <p class="sheet-help side-help">Ask about this conversation while it keeps going. Nothing here is saved or added to it, and the side chat can read but not change anything. <button type="button" class="text-link" data-side-branch>Need work done? Branch instead</button></p>
      <div class="side-scroll"><p class="side-empty">Ask why something was decided, what a file does or where the work stands. Answers come from the conversation as it is when you ask the first question.</p><div class="msgs side-msgs" role="log" aria-label="Side chat messages"></div></div>
      <div class="side-foot"><span class="turnmeta side-status" role="status"></span><button type="button" class="chip" data-side-new hidden>New side chat</button></div>
      <form class="composer side-compose"><textarea rows="1" aria-label="Ask in the side chat" placeholder="Ask about this conversation" enterkeyhint="send"></textarea><button class="primary side-send" type="submit">Ask</button></form>`;
    view = { parentId, sh, list: sh.querySelector('.side-msgs'), box: sh.querySelector('textarea'), send: sh.querySelector('.side-send'), status: sh.querySelector('.side-status'), busy: false, total: 0, model: null, ended: true, live: null, es: null, side: null };
    const v = view;
    workspaceMount(scrim, sh, 'side');
    watchClose(sh); paintButton();
    v.box.oninput = () => sizeBox(v.box);
    v.box.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && isWide()) { e.preventDefault(); ask(v.box.value); } };
    sh.querySelector('form').onsubmit = e => { e.preventDefault(); if (v.busy) stop(); else ask(v.box.value); };
    sh.querySelector('[data-side-new]').onclick = startOver;
    sh.querySelector('[data-side-branch]').onclick = () => { const text = v.box.value; close(); Branch.open(parentId, text); };
    paintState();
    if (question || draft) { v.box.value = question || draft; sizeBox(v.box); }
    v.box.focus();
    // This device's side chat, or one started on another device or before a reload.
    let side = sides.get(parentId);
    if (!side) { try { const r = await api(`/session/${parentId}/side`); side = r.chat?.side; if (r.chat) { v.model = r.chat.model; sides.set(parentId, side); } } catch { } }
    if (view !== v || !isOpen()) return;
    if (side) connect(v, side);
    if (question) ask(question);
  }
  function close() {
    if (!isOpen()) return;
    view.es?.close();
    const dockClose = view.sh.querySelector('[data-close-dock]');
    if (dockClose) dockClose.click(); else closeCurrentSheet?.();
  }
  // 1.78.2: on a desktop the Side chat button sits with Add task and Add project (the header icon is for phones);
  // an icon in the Working row, a chip in the reply toolbar, pressed while this conversation's side chat is open.
  function paintButton() {
    const head = document.getElementById('sideb'); if (head) head.dataset.tip = 'Side chat (Ctrl+;): ' + SIDE_WHAT;
    const b = document.getElementById('side-open'), br = document.getElementById('branch-open');
    const show = available(chatId) && isWide(); // phones: the header icon, and Branch in Conversation options
    if (br) {
      br.hidden = !show;
      br.innerHTML = br.classList.contains('icon') ? IC.branch : IC.branch + '<span>Branch</span>';
      br.setAttribute('aria-label', 'Branch: ' + BRANCH_WHAT); br.dataset.tip = 'Branch: ' + BRANCH_WHAT;
      br.onclick = () => Branch.open(chatId);
    }
    if (!b) return;
    if (!show) { b.hidden = true; return; }
    b.hidden = false;
    b.innerHTML = b.classList.contains('icon') ? IC.chat : IC.chat + '<span>Side chat</span>';
    const open = isOpen() && view.parentId === chatId;
    b.setAttribute('aria-pressed', String(open)); b.classList.toggle('set', open);
    b.setAttribute('aria-label', open ? 'Close the side chat' : 'Side chat: ' + SIDE_WHAT);
    b.dataset.tip = 'Side chat (Ctrl+;): ' + SIDE_WHAT;
    b.onclick = () => toggle(chatId);
  }
  // Repaint the button whenever the panel goes away (its close button, Escape, another dock tab, a new page).
  function watchClose(sh) {
    const obs = new MutationObserver(() => { if (!sh.isConnected) { obs.disconnect(); paintButton(); } });
    obs.observe(document.body, { childList: true, subtree: true });
  }
  function toggle(parentId) { if (isOpen() && view.parentId === parentId) close(); else open(parentId); }
  matchMedia('(min-width: 900px)').addEventListener('change', () => paintButton());
  return { open, toggle, close, isOpen, available, paintButton };
})();

/* 1.79: Branch. A new, saved conversation that starts with everything in this one and carries on by itself, with this
   conversation's model and permissions. The parent is only read. The sheet says what it is, what it costs, warns when
   the parent is still working in the same folder, and offers Side chat for a question that needs no work. */
const Branch = (() => {
  function open(parentId, text = '') {
    if (!parentId) return;
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const sh = document.createElement('div'); sh.className = 'sheet branch-sheet';
    const here = tb?.key === parentId, working = parentId === chatId && composerWorking;
    const folder = parentId === chatId ? ($('#cproj')?.textContent || '') : '';
    const settings = here ? [tbLabel(modelList(), tb.prefs.model), permissionLabel(nextApprovalMode())].filter(Boolean).join(' · ') : '';
    sh.innerHTML = `<h2>Branch</h2>
      <p class="sheet-help">A new saved conversation that carries on from here. It starts with everything in this one so far, can edit files and run commands on its own, and shows in your list as a branch. This conversation stays as it is.</p>
      ${working ? `<p class="sheet-help branch-warn" role="status">This conversation is still working. Both will work in <span data-branch-where>${folder ? esc(folder) : 'the same folder'}</span>, so keep them off the same files.</p>` : ''}
      <label class="branch-label" for="branch-text">What should the branch do?</label>
      <textarea class="queue-editor" id="branch-text" placeholder="For example: write the export script we discussed"></textarea>
      <p class="sheet-help branch-note"><span data-branch-folder></span>${settings ? 'Uses ' + esc(settings) + '. ' : ''}Its first reply reads the whole conversation again.</p>
      <button class="primary" data-branch-start>Start branch</button>
      <div class="branch-alt"><span>Only want to ask something?</span><button type="button" class="chip" data-branch-side>${IC.chat}Use side chat instead</button></div>`;
    mountSheet(scrim, sh);
    const box = sh.querySelector('textarea'), go = sh.querySelector('[data-branch-start]');
    box.value = text; box.focus();
    // 1.97: a branch starts where the work is, which may not be the folder the conversation began in
    api(`/session/${encodeURIComponent(parentId)}/folders`).then(f => {
      const name = String(f.activePath || '').split('/').filter(Boolean).pop();
      if (!name || !sh.isConnected) return;
      sh.querySelector('[data-branch-folder]').textContent = `Starts in ${name}. `;
      const where = sh.querySelector('[data-branch-where]'); if (where) where.textContent = name;
    }).catch(() => { });
    const clientMessageId = crypto.randomUUID(); // a double tap is one branch
    go.onclick = async () => {
      const t = box.value.trim(); if (!t) { toast('Say what the branch should do.'); return box.focus(); }
      go.disabled = true; go.textContent = 'Starting…';
      const { attachments, ...opts } = here ? turnOpts() : {};
      try {
        const r = await api(`/session/${parentId}/branch`, { method: 'POST', body: JSON.stringify({ text: t, clientMessageId, ...opts }) });
        closeCurrentSheet?.();
        toast('Branch started. The original conversation is unchanged.');
        location.hash = '#/chat/' + r.id;
      } catch (e) {
        go.disabled = false; go.textContent = 'Start branch';
        if (e.code === 'secret_detected') toast('That looks like a secret, so it was not sent. Store it in the Vault and use its name instead.');
        else toast(e.message || 'Could not start the branch.');
      }
    };
    sh.querySelector('[data-branch-side]').onclick = () => { const t = box.value; closeCurrentSheet?.(); SideChat.open(parentId, '', { draft: t }); };
  }
  // "Branch of …" on a branch, and this conversation's own branches, under the header.
  function paintLineage(s) {
    const el = document.getElementById('lineage'); if (!el) return;
    const link = b => `<a href="#/chat/${esc(b.id)}">${esc(b.title || 'Untitled branch')}</a>`;
    const parts = [];
    if (s.branchOf) parts.push(`<span>Branch of ${link(s.branchOf)}</span>`);
    const kids = s.branches || [];
    if (kids.length) parts.push(`<span>${kids.length === 1 ? 'Branch' : kids.length + ' branches'}: ${kids.slice(0, 3).map(link).join(', ')}${kids.length > 3 ? ' and ' + (kids.length - 3) + ' more' : ''}</span>`);
    if (s.continuedFrom) parts.push(`<span>Continued from ${link(s.continuedFrom)}</span>`); // 1.96: handoffs
    const next = s.continuedIn || [];
    if (next.length) parts.push(`<span>Continued in ${next.slice(0, 3).map(link).join(', ')}${next.length > 3 ? ' and ' + (next.length - 3) + ' more' : ''}</span>`);
    el.hidden = !parts.length;
    el.innerHTML = parts.length ? (s.branchOf || kids.length ? IC.branch : IC.hand) + parts.join('<span class="lineage-sep" aria-hidden="true">·</span>') : '';
  }
  return { open, paintLineage };
})();


/* Inbox (1.69): what Inbox Watch sent, kept beside sessions, projects, files and tasks. Off until Settings → Projects,
   files, tasks & vault turns it on (window.pocketFeatures.inbox). One view, the list (#/inbox), which opens like a
   session: as a tab, beside a conversation, in a window of its own, or full-screen on the phone. An entry is an alert,
   a morning digest or a look-ahead from the watcher: Open goes to the briefed conversation (the start link) or the
   Files document; X dismisses; the row menu records Resolved or Not useful, which the watcher reads back on its next
   run. Data comes from /api/inbox; every change goes through /api/inbox/act.
   1.77: the dot on the left is read state and its own control (mark read, mark unread); a conversation started from the
   entry's briefing shows as a bubble under it, which opens that conversation. */
const inboxOn=()=>Boolean(window.pocketFeatures?.inbox);
let inboxSnap=null,inboxAt=0,inboxLoading=null,inboxView=null,inboxFilter='open',inboxQuery='',inboxDismissed=null; // 1.69.2: reading clears the dot, never the row; 1.71: the list opens on Open (unread and read), Done holds the rest
let inboxCheck=null; // 1.75: Check now on its way: {at, source, until, before} until the watcher reports it done
const inboxReadHere=new Set(); // 1.75.2: opened on this device; reads as read at once, and a list fetched before the server took it up cannot bring the unread mark back
const inboxOpenState=e=>e.state==='new'||e.state==='opened'; // still on the owner's plate: not dismissed, resolved or marked not useful
const INBOX_GMAIL_MSG='https://mail.google.com/mail/u/0/#all/';
const inboxById=id=>inboxSnap?.entries.find(e=>e.id===id)||inboxDismissed?.entries.find(e=>e.id===id)||null;
async function loadInbox(force){
 if(!force&&inboxSnap&&Date.now()-inboxAt<4000)return inboxSnap;
 if(inboxLoading)return inboxLoading;
 inboxLoading=api('/inbox?state=all',{signal:AbortSignal.timeout(8000)}).then(s=>{for(const e of s.entries)if(inboxReadHere.has(e.id)){if(e.state==='new')e.state='opened';else inboxReadHere.delete(e.id);}s.newCount=s.entries.filter(x=>x.state==='new').length;inboxSnap=s;inboxAt=Date.now();return s;}).finally(()=>{inboxLoading=null;});
 return inboxLoading;
}
async function loadInboxDismissed(){inboxDismissed=await api('/inbox?state=dismissed',{signal:AbortSignal.timeout(8000)});return inboxDismissed;}
// Keep the local list in the server's order (newest first) after one entry changed.
function mergeInbox(e){
 for(const snap of [inboxSnap,inboxDismissed]){if(!snap)continue;snap.entries=snap.entries.filter(x=>x.id!==e.id);}
 const target=e.state==='dismissed'?inboxDismissed:inboxSnap;
 if(target){target.entries.push(e);target.entries.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));}
 if(inboxSnap)inboxSnap.newCount=inboxSnap.entries.filter(x=>x.state==='new').length;
}
// Opening an entry is reading it: the dot goes quiet now, and the server is told after.
function inboxMarkRead(e){
 inboxReadHere.add(e.id);e.state='opened';if(inboxSnap)inboxSnap.newCount=inboxSnap.entries.filter(x=>x.state==='new').length;
 paintInboxView();paintRailInbox();paintInboxBadges();if(typeof paintAssistantHome==='function')paintAssistantHome();
 inboxAct({action:'open',id:e.id});
}
// 1.77: the dot takes it back. The server is told first, so a list fetched meanwhile cannot undo it.
async function inboxMarkUnread(e){
 inboxReadHere.delete(e.id);
 const r=await inboxAct({action:'unread',id:e.id});
 if(r&&r.state==='new')toast('Marked unread');
}
// The newest conversation started from the entry's briefing, or null.
const inboxSession=e=>Array.isArray(e.sessions)&&e.sessions.length?e.sessions[e.sessions.length-1]:null;
const INBOX_DOT='<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/></svg>';
async function inboxAct(body,done){
 try{const r=await api('/inbox/act',{method:'POST',body:JSON.stringify(body)});mergeInbox(r.entry);if(done)toast(done);paintInboxView();paintRailInbox();paintInboxBadges();if(typeof paintAssistantHome==='function')paintAssistantHome();return r.entry;}
 catch(e){toast(e.message||'Could not update the inbox');return null;}
}
const inboxNewCount=()=>inboxSnap?.newCount||0;
// 1.103: with the Gmail label on, Dismiss (the row's X or the sheet's) also takes the label off in Gmail at the next check.
const inboxLabelName=()=>inboxSnap?.gmailLabel?.name||'';
const inboxDismissDone=()=>inboxLabelName()?`Dismissed. The ${inboxLabelName()} label comes off in Gmail at the next check`:'Dismissed';
const inboxKindWord=e=>e.kind==='digest'?'digest':e.kind==='lookahead'?'look-ahead':'alert';
const inboxStateWord=e=>({resolved:'Resolved',not_useful:'Not useful',dismissed:'Dismissed'})[e.state]||'';
// The watcher writes citations as [label](msg:<gmail id>); they become Gmail links. Plain text otherwise.
// 1.70.1: a digest's "## Worth knowing" heading and "- " lines read as a heading and bullets, not as raw marks.
// 1.95: headings, bullets and paragraphs are blocks with room between them. Until now a digest's items ran together with
// single line breaks and read as one paragraph (Damon).
const inboxCite=s=>esc(s||'').replace(/\[([^\]\n]{1,80})\]\(msg:([0-9a-f]{6,24})\)/g,(m,label,id)=>`<a href="${INBOX_GMAIL_MSG}${id}" target="_blank" rel="noopener">${label}</a>`);
function inboxText(text){
 const out=[];let list=null;
 for(const raw of String(text||'').split('\n')){
  const l=raw.trim();if(!l)continue;
  const h=/^#{1,3}[ \t]+(.+)$/.exec(l),b=/^[-*][ \t]+(.+)$/.exec(l);
  if(b){if(!list){list=[];out.push(list);}list.push(`<li>${inboxCite(b[1])}</li>`);continue;}
  list=null;out.push(h?`<p class="inbox-h">${inboxCite(h[1])}</p>`:`<p>${inboxCite(l)}</p>`);
 }
 return out.map(x=>Array.isArray(x)?`<ul>${x.join('')}</ul>`:x).join('');
}
/* 1.95: a digest's or look-ahead's items (inbox.mjs items), each a card with the choices an Inbox entry has. Add to Inbox asks the
   watcher to send that story as an alert of its own and, from a digest, to learn from it; Resolved, Not useful and Dismiss land on that story, not on the whole
   digest; Undo takes any of them back, except an alert the watcher has already sent. A line on a story that is on the list opens
   that entry and shows its state, so the story is decided in one place. A line that resolved overnight or was taken off by the
   tidy pass is history and only links to Gmail. */
const INBOX_SECTION={held:'Held overnight',resolved:'Came up overnight and already resolved',worth:'Worth knowing',tidied:'Taken off your Inbox',listed:'Already on your list',ahead:'Coming up'};
const INBOX_ITEM_STATE={alerted:'Added to Inbox',resolved:'Resolved',not_useful:'Not useful',dismissed:'Dismissed'};
const inboxItemWord=it=>it.state==='alerted'&&!it.ackedAt?'Adding to Inbox':INBOX_ITEM_STATE[it.state]||it.state;
const inboxActable=it=>it.section==='worth'||it.section==='held'||it.section==='ahead';
function inboxItemHTML(it,e){
 const ahead=e?.kind==='lookahead';
 if(it.section==='listed'&&!ahead){ // 1.95 (Brad): an open entry already has this story; one line that opens it, never a new card
  const t=inboxTarget({url:it.url||''}),first=inboxFirst(it.text);
  return `<p class="inbox-item-listed">${t?`<a href="${esc(t.startsWith('#')?t:'#'+t)}">${esc(it.title)}</a>`:`<strong>${esc(it.title)}</strong>`}${it.state!=='open'&&INBOX_ITEM_STATE[it.state]?` <strong class="inbox-item-state">${esc(inboxItemWord(it))}</strong>`:''}${first?` <span>${esc(first)}</span>`:''}</p>`;
 }
 const facts=[it.story?esc(it.story.replace(/-/g,' ')):'',it.priority&&it.priority!=='normal'?esc(it.priority):''].filter(Boolean).join(' · ');
 const onList=it.section==='listed'?inboxTarget({url:it.url||''}):''; // 1.95: a look-ahead keeps what it found about a story on the list, and opens that entry
 const acts=onList?`${it.state!=='open'?`<span class="inbox-item-state">${esc(inboxItemWord(it))}</span>`:''}<a class="chip" href="${esc(onList.startsWith('#')?onList:'#'+onList)}" data-item-chat>${IC.inbox}Open in Inbox</a>`:!inboxActable(it)?'':it.state!=='open'?`<span class="inbox-item-state">${esc(inboxItemWord(it))}</span>${it.state==='alerted'&&it.ackedAt?'':`<button class="chip" data-item-act="restore" data-item="${esc(it.ref)}" title="Take that back">Undo</button>`}`
  :`<button class="chip inbox-item-alert" data-item-act="alert" data-item="${esc(it.ref)}" title="${ahead?'Put this in your Inbox as an alert of its own':'Put this in your Inbox as an alert of its own; the watcher alerts on this kind of thing from now on'}">${IC.inbox}Add to Inbox</button><button class="chip" data-item-act="resolve" data-item="${esc(it.ref)}" title="This situation is over; the watcher stops following it">${IC.tick}Resolved</button><button class="chip" data-item-act="not_useful" data-item="${esc(it.ref)}" title="Don’t tell me about this kind of thing">${IC.bellOff}Not useful</button><button class="chip" data-item-act="dismiss" data-item="${esc(it.ref)}" title="Take this off the digest; the watcher learns nothing from it">${IC.x}Dismiss</button>`;
 const sess=inboxActable(it)?inboxSession(it):null,chat=sess?`<a class="chip" href="#/chat/${esc(sess.id)}" data-item-chat>${IC.chat}Open the conversation</a>`:'';
 const talk=inboxActable(it)&&inboxTarget({url:it.url||''})?`<button class="chip" data-item-go="${esc(it.ref)}" title="A new conversation already briefed with this story and its evidence; the watcher learns nothing from it">${IC.plus}${sess?'Start another':'Start a conversation'}</button>`:''; // 1.95.1: about this one line, now, no rule
 return `<article class="inbox-item-card state-${esc(it.state)}" data-item-card="${esc(it.ref)}"><h4>${esc(it.title)}</h4>${it.text?`<div class="inbox-body">${inboxText(it.text)}</div>`:''}${facts?`<p class="inbox-item-facts">${facts}</p>`:''}<div class="inbox-item-actions">${chat}${talk}${acts}${it.gmail?`<a class="chip" href="${esc(it.gmail)}" target="_blank" rel="noopener">${IC.globe}Gmail</a>`:''}</div></article>`;
}
function inboxItemsHTML(e){
 const groups=[];let sec=null;
 for(const it of e.items){if(it.section!==sec){sec=it.section;groups.push({sec,items:[]});}groups[groups.length-1].items.push(it);}
 const rest=String(e.text||'').split('\n').filter(l=>l.trim()&&!/^#{1,3}[ \t]/.test(l)&&!/^[ \t]*[-*][ \t]/.test(l)); // what the text says besides its items (how many threads were ignored; a look-ahead's lead line)
 if(e.kind==='lookahead')return `${rest.length?`<div class="inbox-body inbox-lead">${inboxText(rest.join('\n'))}</div>`:''}<section class="inbox-items"><h3>${INBOX_SECTION.ahead} <span>${e.items.length}</span></h3>${e.items.map(it=>inboxItemHTML(it,e)).join('')}</section>`;
 return groups.map(g=>`<section class="inbox-items"><h3>${esc(INBOX_SECTION[g.sec]||g.sec)} <span>${g.items.length}</span></h3>${g.items.map(it=>inboxItemHTML(it,e)).join('')}</section>`).join('')+(rest.length?`<div class="inbox-body inbox-rest">${inboxText(rest.join('\n'))}</div>`:'');
}
const inboxFirst=text=>{const t=String(text||'').replace(/\[([^\]\n]{1,80})\]\(msg:[0-9a-f]{6,24}\)/g,'$1').replace(/^#{1,3}[ \t]+.*$/gm,'').replace(/^[ \t]*[-*][ \t]+/gm,'').replace(/\s+/g,' ').trim();const m=/^(.{20,220}?[.!?])(\s|$)/.exec(t);return m?m[1]:t.slice(0,220);};
const inboxWhen=iso=>{const d=new Date(iso);return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).replace(' ',' ').toLowerCase();};
const inboxDay=iso=>{const d=new Date(iso),t=new Date();const same=(a,b)=>a.toDateString()===b.toDateString();const y=new Date(t);y.setDate(t.getDate()-1);return same(d,t)?'Today':same(d,y)?'Yesterday':d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});};
// Where Open goes: the start link (a Pocket path or this Pocket's own address), the Files document, else the entry itself.
function inboxTarget(e){
 const u=e.url||'';
 if(u.startsWith('/#/'))return u.slice(1);
 if(u.startsWith(location.origin+'/#/'))return u.slice(location.origin.length+1);
 if(/^https?:\/\//.test(u))return u;
 if(e.doc)return '#/documents/'+e.doc;
 return '';
}
function inboxOpen(id){
 const e=inboxById(id);if(!e)return;
 if(e.state==='new')inboxMarkRead(e);
 const t=inboxTarget(e);
 if(!t)return inboxSheet(id);
 if(/^https?:\/\//.test(t))window.open(t,'_blank','noopener');else location.hash=t;
}

/* ---------- the list view ---------- */
async function renderInbox(view){
 Voice.onLeave?.();
 inboxView=view;if(typeof boardView!=='undefined')boardView=null;if(typeof docView!=='undefined')docView=null;if(typeof taskView!=='undefined')taskView=null;
 const col=`<header class="bar">
   ${PANE?`<button class="icon" id="pane-main" aria-label="Make this the main view">${IC.swap}</button>`:SOLO?'':`<button class="icon" id="back" aria-label="Back">${IC.back}</button><button class="icon desk" id="railtog" aria-label="Show or hide the conversation list">${IC.panel}</button>`}
   <h1><span class="one" id="ktitle">Inbox</span><span class="tag" id="ktag">What Inbox Watch sent · tap to read</span></h1>
   ${SOLO?'':`<button class="icon" id="kwin" aria-label="Open in a new window" title="Open in a new window">${IC.external}</button>`}
   ${PANE||SOLO?'':`<button class="icon desk" id="splitb" aria-label="Split view">${IC.columns}</button>`}
   ${PANE?`<button class="icon" id="pane-close" aria-label="Close this pane">${IC.x}</button>`:''}
  </header>
  <main class="scroll projects-view inbox-view" id="inbox-main" tabindex="-1"><p class="sheet-help projects-loading">Loading the inbox…</p></main>`;
 app.innerHTML=withShell(col);
 wireShell();
 if(PANE){$('#pane-main').onclick=()=>paneSay('main',{view});$('#pane-close').onclick=()=>paneSay('close');}
 else if(!SOLO){bindViewBack($('#back'),view);$('#splitb').onclick=chooseBeside;}
 if(!SOLO)$('#kwin').onclick=()=>openInWindow(view);
 const tog=$('#railtog');if(tog)tog.onclick=()=>{localStorage.setItem('pc-rail',railOpen()?'closed':'open');route();};
 try{await loadInbox(true);if(inboxFilter==='done')await loadInboxDismissed();}catch(e){const m=$('#inbox-main');if(m&&e.status===404)showLibraryError(m,e,'Inbox Watch',()=>renderInbox(view),false);else if(m)m.innerHTML=`<p class="sheet-help">The inbox could not load: ${esc(e.message||'error')}</p>`;return;} // 1.81: off says where to turn it on, like the other libraries
 if(inboxView!==view)return;
 paintInboxView();
 if(PANE)paneSay('route',{id:view,title:'Inbox'});else if(SOLO)document.title='Inbox · '+appName();else rememberOpenView(view,'Inbox'); // 1.85.1: a tab like Tasks and Vault, with its close button
 const open=/^#\/inbox\/([0-9a-f]{12})$/.exec(location.hash);if(open)inboxSheet(open[1]);
}
let inboxPainted='';
function paintInboxView(){
 const main=$('#inbox-main');if(!main||!inboxSnap||!inboxView)return;
 const html=inboxListHTML();
 if(html===inboxPainted&&main.querySelector('[data-inbox-filter]')){paintInboxBadges();return;} // a repaint that changes nothing leaves the rows and chips alone
 inboxPainted=html;
 const q=main.querySelector('#inbox-search'),focus=q&&document.activeElement===q,pos=q?q.selectionStart:0;
 main.innerHTML=html;
 bindInboxRows(main);
 main.querySelectorAll('[data-inbox-filter]').forEach(b=>b.onclick=async()=>{inboxFilter=b.dataset.inboxFilter;if(inboxFilter==='done'&&!inboxDismissed)try{await loadInboxDismissed();}catch{}paintInboxView();});
 main.querySelector('#inbox-watch')?.addEventListener('click',inboxWatchSheet);
 const s=main.querySelector('#inbox-search');if(s){s.oninput=()=>{inboxQuery=s.value;paintInboxView();};if(focus){s.focus();s.setSelectionRange(pos,pos);}}
 paintInboxBadges();
}
function inboxRows(){
 // Done: resolved and not useful (in the main list) with dismissed (fetched on demand), newest first.
 const src=inboxFilter==='done'?[...inboxSnap.entries.filter(e=>!inboxOpenState(e)),...(inboxDismissed?.entries||[])].sort((a,b)=>Date.parse(b.actedAt||b.at)-Date.parse(a.actedAt||a.at))
  :inboxSnap.entries.filter(e=>inboxFilter==='new'?e.state==='new':inboxOpenState(e));
 const q=inboxQuery.trim().toLowerCase();
 return q?src.filter(e=>(e.title+' '+(e.story||'')+' '+(e.text||'')).toLowerCase().includes(q)):src;
}
function inboxRowHTML(e){
 const facts=[`<span>${esc(inboxWhen(e.at))}</span>`,e.story?`<span>${esc(e.story.replace(/-/g,' '))}</span>`:'',`<span>${inboxKindWord(e)}${e.priority==='critical'?' · critical':''}</span>`,inboxStateWord(e)?`<span>${inboxStateWord(e)}</span>`:''].filter(Boolean).join('<span aria-hidden="true">·</span>');
 const first=!inboxOpenState(e)&&e.note?e.note:inboxFirst(e.text),sess=inboxSession(e); // a finished entry says why it is finished (the tidy pass writes the reason)
 return `<div class="session-item task-item inbox-item state-${esc(e.state)} kind-${esc(e.kind)}" data-item="${esc(e.id)}">
  <span class="inbox-marks">${inboxOpenState(e)?`<button class="task-check inbox-mark" data-inbox-read="${esc(e.id)}" aria-label="${e.state==='new'?'Mark as read':'Mark as unread'}: ${esc(e.title)}" title="${e.state==='new'?'Unread. Mark as read':'Read. Mark as unread'}">${INBOX_DOT}</button>`:`<span class="task-check inbox-mark" aria-hidden="true">${INBOX_DOT}</span>`}${sess?`<a class="task-check inbox-chat" href="#/chat/${esc(sess.id)}" aria-label="Open the conversation: ${esc(e.title)}" title="Open the conversation">${IC.chat}</a>`:''}</span>
  <button class="row" data-inbox-open="${esc(e.id)}"><span class="body"><span class="title">${esc(e.title)}</span>${first?`<span class="inbox-text">${esc(first)}</span>`:''}<span class="session-status">${facts}</span></span></button>
  ${e.state==='dismissed'?'':`<button class="session-more icon inbox-x" data-inbox-dismiss="${esc(e.id)}" aria-label="Dismiss: ${esc(e.title)}" title="${inboxLabelName()?`Dismiss: off your list and out of ${esc(inboxLabelName())} in Gmail`:'Dismiss'}">${IC.x}</button>`}
  <button class="session-more icon" data-inbox-more="${esc(e.id)}" aria-label="Options for ${esc(e.title)}">${IC.more}</button></div>`;
}
/* 1.74: what Pocket's own watcher is doing (inbox-runner.mjs), when that is the reason the list is empty or stale. */
function inboxRunnerLine(r){
 if(r&&r.state==='external')return 'A watcher installed separately is reporting here; Pocket is not running its own.'; // 1.81: say why Pocket is not setting one up
 if(!r||!r.managed)return '';
 const box=r.mailbox?` for ${esc(r.mailbox)}`:'';
 if(r.state==='waiting')return esc(r.message||'Inbox Watch starts once Pocket knows your time zone. Open Pocket Code on your phone or computer.');
 if(r.state==='setting-up')return `Setting up Inbox Watch${box}. ${esc(r.message||'')}`;
 if(r.state==='needs-connector')return 'Inbox Watch can’t read your mail yet. Connect Gmail in Settings → Connectors, using the account Claude Code is signed in with. It starts by itself once Gmail is connected.';
 if(r.state==='error')return `Inbox Watch couldn’t check your mail${box}: ${esc(r.message||'unknown error')}. It tries again every minute.`;
 if(r.accountChange)return `Gmail is now connected as ${esc(r.accountChange.to)} (it was ${esc(r.accountChange.from)}), so Inbox Watch now watches ${esc(r.accountChange.to)}. Mail already kept from the old account stays in its memory.`; // 1.81: the connector was reconnected to another account
 return '';
}
function inboxListHTML(){
 const rows=inboxRows(),n=inboxNewCount(),last=inboxSnap.lastReportAt?Date.parse(inboxSnap.lastReportAt):0,stale=last&&Date.now()-last>24*3600000;
 const chip=(k,label)=>`<button class="chip" data-inbox-filter="${k}" aria-pressed="${inboxFilter===k}">${label}</button>`;
 const groups=[];let day='';
 for(const e of rows){const d=inboxDay(e.at);if(d!==day){day=d;groups.push({day:d,html:[]});}groups[groups.length-1].html.push(inboxRowHTML(e));}
 const empty=inboxFilter==='done'?'Nothing finished yet.':inboxQuery.trim()?'Nothing matches.':inboxFilter==='open'&&inboxSnap.entries.length?'Nothing open. Done has everything resolved, not useful or dismissed.':inboxFilter==='new'?(inboxSnap.entries.length?'Nothing unread. Open shows everything still on your list.':(inboxSnap.runner?.state==='running'&&inboxSnap.runner.mailbox?`Watching ${esc(inboxSnap.runner.mailbox)}. Nothing needs you yet: it sends an alert only when an email tells you something the email itself doesn’t.`:'Nothing from Inbox Watch yet. It sends an alert only when an email tells you something the email itself doesn’t.')):'Nothing from Inbox Watch yet. It sends an alert only when an email tells you something the email itself doesn’t.';
 return `<div class="session-home-head"><h2>Inbox</h2><span class="project-head-actions">${chip('open','Open')}${chip('new',`Unread${n?` <span class="badge" data-inbox-badge>${n}</span>`:''}`)}${chip('done','Done')}</span></div>
  <div class="inbox-tools"><div class="inbox-tools-row"><input type="search" id="inbox-search" class="inbox-search" placeholder="Search titles and stories" value="${esc(inboxQuery)}" aria-label="Search the inbox">${inboxCheckChip()}<button class="chip" id="inbox-watch" aria-label="Inbox Watch schedule${assistantMode()?'':', models and cost'}">${IC.sliders}Schedule</button></div>${inboxRunnerLine(inboxSnap.runner)?`<p class="sheet-help${['needs-connector','error'].includes(inboxSnap.runner.state)?' inbox-stale':' inbox-runner'}" role="status">${inboxRunnerLine(inboxSnap.runner)}</p>`:stale&&!inboxSnap.paused?`<p class="sheet-help inbox-stale">Inbox Watch hasn’t reported since ${esc(inboxDay(inboxSnap.lastReportAt))} ${esc(inboxWhen(inboxSnap.lastReportAt))}.</p>`:''}</div>
  ${groups.length?groups.map(g=>`<section class="session-group project-group"><h2>${esc(g.day)} <span>${g.html.length}</span></h2>${g.html.join('')}</section>`).join(''):`<p class="sheet-help project-empty">${empty}</p>`}`;
}
function bindInboxRows(root){
 root.querySelectorAll('[data-inbox-check]').forEach(b=>b.onclick=inboxCheckNow);
 root.querySelectorAll('[data-inbox-done]').forEach(a=>a.addEventListener('click',async()=>{inboxFilter='done';if(inboxView){try{if(!inboxDismissed)await loadInboxDismissed();}catch{}paintInboxView();}})); // 1.85.1: the finished ones are under Done
 root.querySelectorAll('[data-inbox-open]').forEach(b=>b.onclick=()=>inboxSheet(b.dataset.inboxOpen)); // 1.69.1: read first; the sheet starts the conversation
 root.querySelectorAll('[data-inbox-read]').forEach(b=>b.onclick=()=>{const e=inboxById(b.dataset.inboxRead);if(!e)return;if(e.state==='new')inboxMarkRead(e);else inboxMarkUnread(e);}); // 1.77
 root.querySelectorAll('[data-inbox-dismiss]').forEach(b=>b.onclick=()=>inboxAct({action:'dismiss',id:b.dataset.inboxDismiss},inboxDismissDone()));
 root.querySelectorAll('[data-inbox-more]').forEach(b=>b.onclick=()=>inboxSheet(b.dataset.inboxMore));
}

/* ---------- 1.75: Check now ----------
   Asks the watcher to check mail now, whatever its schedule (so a schedule of Don't check means on demand only). Pocket
   records the request; the watcher takes it up on its next one-minute tick and reports it done in its heartbeat. The chip
   stays busy until then, and the list reloads with whatever the check found. */
const inboxCheckChip=()=>`<button class="chip inbox-check" data-inbox-check${inboxCheck?' aria-busy="true" disabled':''} aria-label="${inboxCheck?'Checking your mail':'Check mail now'}" title="Check mail now">${IC.refresh}<span class="inbox-check-label">${inboxCheck?'Checking…':'Check now'}</span></button>`;
function paintInboxCheck(){paintInboxView();paintRailInbox();}
async function inboxCheckNow(){
 if(inboxCheck)return;
 let w;
 try{w=await api('/inbox/check',{method:'POST',body:'{}',signal:AbortSignal.timeout(8000)});}catch(e){toast(e.message||'Could not ask Inbox Watch to check');return;}
 if(!w.lastReportAt&&!w.profile){toast('Inbox Watch hasn’t reported yet, so nothing is reading your mail. The check runs once it starts.');return;}
 inboxCheck={at:w.checkRequestedAt,source:w.source,until:Date.now()+6*60000,before:new Set((inboxSnap?.entries||[]).map(e=>e.id))};
 paintInboxCheck();toast('Checking your mail. New alerts show up here when it’s done.');
 while(inboxCheck){
  await new Promise(r=>setTimeout(r,5000));
  const c=inboxCheck;if(!c)return;
  let n=null;try{n=await api('/inbox/watch?source='+encodeURIComponent(c.source),{signal:AbortSignal.timeout(8000)});}catch{}
  const done=n?.profile?.status?.checkRequestDone;
  if(done&&Date.parse(done)>=Date.parse(c.at)){
   inboxCheck=null;
   try{await loadInbox(true);}catch{}
   const fresh=(inboxSnap?.entries||[]).filter(e=>!c.before.has(e.id)).length;
   paintInboxCheck();paintInboxBadges();if(typeof paintAssistantHome==='function')paintAssistantHome();
   toast(fresh?`Checked. ${fresh===1?'One new item':fresh+' new items'}.`:'Checked. Nothing new needs you.');
   return;
  }
  if(Date.now()>c.until){inboxCheck=null;paintInboxCheck();toast('Inbox Watch hasn’t finished the check yet. Anything it finds will show up here.');return;}
 }
}

/* ---------- one entry: the sheet with the whole text and the choices ---------- */
function inboxSheet(id){
 const e=inboxById(id);if(!e)return;
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet task-sheet inbox-sheet';
 const facts=[`<span>${esc(inboxDay(e.at))} ${esc(inboxWhen(e.at))}</span>`,e.story?`<span>${esc(e.story.replace(/-/g,' '))}</span>`:'',`<span>${inboxKindWord(e)}</span>`,e.priority&&e.priority!=='normal'?`<span>${esc(e.priority)}</span>`:'',inboxStateWord(e)?`<span>${inboxStateWord(e)}</span>`:''].filter(Boolean).join(''); // the sheet's facts stack one per line, as a task's do
 const target=inboxTarget(e),gone=['dismissed','resolved','not_useful'].includes(e.state),sess=inboxSession(e),n=e.sessions?.length||0;
 sh.innerHTML=`<h2>${e.kind==='alert'?'Alert':e.kind==='digest'?'Digest':'Look-ahead'}</h2><p class="task-text">${esc(e.title)}</p><div class="task-facts">${facts}</div>
  ${e.items?.length?`<div class="inbox-items-wrap" data-items>${inboxItemsHTML(e)}</div>`:`<div class="task-summary inbox-body">${inboxText(e.text)}</div>`}
  ${sess?`<a class="opt" href="#/chat/${esc(sess.id)}" data-chat>${IC.chat}<span>Open the conversation<span class="sub">${n>1?`The latest of ${n}, started`:'Started'} ${esc(inboxDay(sess.at))} ${esc(inboxWhen(sess.at))}</span></span></a>`:''}
  ${target?`<button class="opt" data-go>${e.doc&&!e.url?IC.doc:IC.plus}<span>${e.doc&&!e.url?'Open in Files':sess?'Start another conversation':'Start a conversation'}<span class="sub">${e.doc&&!e.url?'The full text, kept in Files':'New conversation, already briefed with the story and the evidence; nothing starts until you press Start'}</span></span></button>`:''}
  ${e.gmail?`<a class="opt" href="${esc(e.gmail)}" target="_blank" rel="noopener">${IC.globe}<span>Open in Gmail</span></a>`:''}
  ${gone?`<button class="opt" data-restore>${IC.swap}<span>Restore<span class="sub">Back to the list; the watcher is told</span></span></button>`:`<button class="opt" data-resolve>${IC.tick}<span>Resolved<span class="sub">This situation is over; the watcher stops following it</span></span></button>
  <button class="opt" data-useless>${IC.bellOff}<span>Not useful<span class="sub">Don’t alert me about this kind of thing; the watcher adds it to your preferences</span></span></button>
  <button class="opt" data-dismiss>${IC.x}<span>Dismiss<span class="sub">${inboxLabelName()?`Off your list and out of ${esc(inboxLabelName())} in Gmail; the watcher learns nothing`:'Off your list; the watcher learns nothing'}</span></span></button>`}`;
 sh.querySelector('[data-go]')?.addEventListener('click',()=>{closeCurrentSheet?.();inboxOpen(id);});
 sh.querySelector('[data-chat]')?.addEventListener('click',()=>closeCurrentSheet?.());
 sh.querySelector('[data-resolve]')?.addEventListener('click',()=>{closeCurrentSheet?.();inboxAct({action:'resolve',id},'Marked resolved');});
 sh.querySelector('[data-useless]')?.addEventListener('click',()=>{closeCurrentSheet?.();inboxAct({action:'not_useful',id},'Noted: not useful');});
 sh.querySelector('[data-dismiss]')?.addEventListener('click',()=>{closeCurrentSheet?.();inboxAct({action:'dismiss',id},inboxDismissDone());});
 sh.querySelector('[data-restore]')?.addEventListener('click',()=>{closeCurrentSheet?.();inboxAct({action:'restore',id},'Restored');});
 const ITEM_DONE={alert:e.kind==='lookahead'?'Adding it to your Inbox at the next check':'Adding it to your Inbox at the next check. The watcher learns from it',resolve:'Marked resolved',not_useful:'Noted: not useful',dismiss:'Dismissed',restore:'Undone'};
 const bindItems=()=>{sh.querySelectorAll('[data-item-act]').forEach(b=>b.onclick=async()=>{ // 1.95: the sheet stays open; the card repaints with its new state
  const act=b.dataset.itemAct,ref=b.dataset.item;b.disabled=true;
  const ent=await inboxAct({action:act,id,item:ref},ITEM_DONE[act]);
  const wrap=sh.querySelector('[data-items]');
  if(ent&&wrap){wrap.innerHTML=inboxItemsHTML(ent);bindItems();}else b.disabled=false;
 });bindItemGo();};
 const bindItemGo=()=>{sh.querySelectorAll('[data-item-go]').forEach(b=>b.onclick=()=>{ // 1.95.1: the item's own start link opens like an entry's
  const it=(inboxById(id)?.items||[]).find(x=>x.ref===b.dataset.itemGo),t=it?inboxTarget({url:it.url||''}):'';
  if(!t)return;closeCurrentSheet?.();if(/^https?:\/\//.test(t))window.open(t,'_blank','noopener');else location.hash=t;
 });sh.querySelectorAll('[data-item-chat]').forEach(a=>a.onclick=()=>closeCurrentSheet?.());};
 bindItems();
 if(e.state==='new')inboxMarkRead(e);
 mountSheet(scrim,sh);
}

/* ---------- rail, home, badges ---------- */
function railInboxHTML(){
 if(!inboxSnap)return '<p class="sheet-help">Loading the inbox…</p>';
 const rows=inboxSnap.entries.filter(inboxOpenState).sort((a,b)=>(a.state==='new'?0:1)-(b.state==='new'?0:1)||Date.parse(b.at)-Date.parse(a.at)),rest=inboxSnap.entries.length-rows.length;
 return `<div class="rail-projects rail-inbox"><div class="rail-project-actions"><a class="chip" href="${viewHref('inbox')}" data-view-link>All</a>${inboxCheckChip()}</div>
  ${rows.length?rows.slice(0,40).map(inboxRowHTML).join(''):'<p class="sheet-help">Nothing open from Inbox Watch.</p>'}
  ${rest?`<a class="rail-done-link" href="${viewHref('inbox')}" data-view-link data-inbox-done>${rest} finished</a>`:''}</div>`;
}
let railInboxPainted='';
function paintRailInbox(){
 const el=document.getElementById('rail');if(!el||railView()!=='inbox')return;
 const html=railInboxHTML();
 if(html!==railInboxPainted||!el.querySelector('.rail-inbox')){railInboxPainted=html;el.innerHTML=html;bindInboxRows(el);}
 if(!inboxSnap||Date.now()-inboxAt>4000)loadInbox(true).then(()=>{paintRailInbox();paintInboxBadges();}).catch(()=>{const r=document.getElementById('rail');if(!inboxSnap&&r&&railView()==='inbox')r.innerHTML='<p class="sheet-help">The inbox could not load.</p>';});
}
function paintInboxBadges(){
 const n=inboxNewCount();
 document.querySelectorAll('[data-inbox-badge]').forEach(el=>{el.textContent=n?String(n):'';el.hidden=!n;});
 document.querySelectorAll('[data-inbox-home]').forEach(el=>{el.innerHTML=(el.dataset.icon||'')+'<span class="chip-label">Inbox'+(n?' · '+n+' new':'')+'</span>';el.classList.toggle('due',n>0);});
}
// Assistant mode home (1.60): a new alert is a Waiting-for-you card, like a question from a conversation.
function inboxWaitingCards(){
 if(!inboxOn())return [];
 if(!inboxSnap){if(!inboxLoading)loadInbox().then(()=>{if(typeof paintAssistantHome==='function')paintAssistantHome();}).catch(()=>{});return [];} // first paint on a fresh page: fetch, then paint again
 return inboxSnap.entries.filter(e=>inboxOpenState(e)&&e.kind==='alert').slice(0,3).map(e=>`<a class="home-card inbox-card" href="#/inbox/${esc(e.id)}" data-inbox-card="${esc(e.id)}"><span class="home-card-title">${esc(e.title)}</span><span class="home-card-what">Inbox Watch · ${esc(inboxFirst(e.text)||'Open to read')}</span></a>`);
}
function inboxTick(){if(!inboxOn()||document.visibilityState!=='visible'||!(inboxView||railView()==='inbox'||document.querySelector('[data-inbox-home],[data-inbox-badge],.assistant-home')))return;loadInbox(true).then(()=>{paintInboxView();paintRailInbox();paintInboxBadges();if(typeof paintAssistantHome==='function')paintAssistantHome();if(typeof paintOpenSessions==='function')paintOpenSessions();}).catch(()=>{});}
setInterval(inboxTick,30000);onListsStale(inboxTick);

/* ---------- 1.70: Inbox Watch settings: when it checks, quiet hours and summaries, models, cost ----------
   One sheet, opened from Settings (Schedule, models and cost) or the Inbox header. The watcher's profile (its defaults,
   the choices it offers, what is in force, what it cost) arrives with its heartbeat; the owner's settings go to
   /api/inbox/watch and reach the watcher within a minute. Assistant mode shows the schedule only: no model names, no dollars. */
const WATCH_DAYS=[['M','Monday'],['T','Tuesday'],['W','Wednesday'],['T','Thursday'],['F','Friday'],['S','Saturday'],['S','Sunday']];
const watchEvery=n=>n===0?'Don’t check':n===1?'Every minute':n<60||n%60?`Every ${n} minutes`:n===60?'Every hour':`Every ${n/60} hours`;
const watchHour=h=>h===0?'12 AM':h<12?`${h} AM`:h===12?'12 PM':`${h-12} PM`;
let watchTZ; // the watcher's time zone, so the status reads in the same clock as the periods
const watchTime=iso=>{if(!iso)return '';try{return new Date(iso).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:watchTZ});}catch{return new Date(iso).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});}};
const watchTokens=n=>n>=1e6?(n/1e6).toFixed(n>=1e7?0:1)+'M':n>=1e3?Math.round(n/1e3)+'k':String(n||0);
const watchMoney=v=>v==null?'—':'$'+(v>=100?v.toFixed(0):v.toFixed(2));
const watchDay=d=>{const t=new Date(d+'T12:00:00');return `${t.toLocaleDateString('en-US',{weekday:'short'})} ${t.getDate()}`;};
function watchStatus(w){
 const p=w.profile,st=p?.status;
 if(!p)return 'Inbox Watch hasn’t reported its settings yet. It needs inbox-monitor 0.3 or later on the server.';
 const pending=w.settings&&p.applied?.revision!==w.revision?' Your last change reaches the watcher within a minute.':w.settings?'':' Using the watcher’s config file.';
 if(st?.paused)return 'Paused. Nothing is checked until you resume.'+pending;
 const now=st?st.every===0?'Not checking now':`Checking ${watchEvery(st.every).toLowerCase()} now`:'';
 return `${now}${st?.period?` (${st.period})`:''}.${st?.lastCheckAt?` Last check ${watchTime(st.lastCheckAt)}`:''}${st?.nextCheckAt?`, next about ${watchTime(st.nextCheckAt)}.`:st?.lastCheckAt?'.':''}${pending}`;
}
const watchQuietNote=digest=>digest==null?'In quiet hours only critical alerts reach you. With the digest off, the rest arrive one by one when quiet hours end, and what would only have been a digest line is not sent.':'In quiet hours only critical alerts reach you; the rest wait for the morning digest.';
function watchSelect(id,label,values,current,word,extra=''){
 return `<label class="voice-field">${label}<select id="${id}" ${extra}>${values.map(v=>`<option value="${v===null?'off':v}"${v===current||(v===null&&current==null)?' selected':''}>${word(v)}</option>`).join('')}</select></label>`;
}
function watchPeriodHTML(p,i,everyChoices){
 const days=WATCH_DAYS.map(([l,name],d)=>`<button type="button" class="chip" data-day="${d}" aria-pressed="${p.days.includes(d)}" aria-label="${name}">${l}</button>`).join('');
 return `<div class="router-level watch-period" data-period="${i}">
  <div class="watch-period-head"><input class="watch-name" type="text" maxlength="40" value="${esc(p.name||'')}" placeholder="Name, e.g. Overnight" aria-label="Period ${i+1} name"><button type="button" class="chip" data-remove aria-label="Remove period ${i+1}">Remove</button></div>
  <div class="watch-days" role="group" aria-label="Days for period ${i+1}">${days}</div>
  <label class="voice-field">From<input type="time" step="900" data-from value="${esc(p.from)}"></label>
  <label class="voice-field">Until<input type="time" step="900" data-to value="${esc(p.to)}"></label>
  <label class="voice-field watch-wide">Interval<select data-every>${everyChoices.map(v=>`<option value="${v}"${v===p.every?' selected':''}>${watchEvery(v)}</option>`).join('')}</select></label></div>`;
}
function watchUsageHTML(u){
 const days=(u?.days||[]).slice(0,7);
 if(!days.length)return '<p class="title-note">No checks recorded yet.</p>';
 const since=u.since?Date.parse(u.since):0,rec=d=>since&&Date.parse(d.date+'T23:59:59')>=since;
 const tot=days.filter(rec).reduce((a,d)=>({skipped:a.skipped+(d.firstPass?.skipped||0),calls:a.calls+d.calls,tokens:a.tokens+d.inputTokens+d.outputTokens,cost:d.costUsd==null?a.cost:(a.cost||0)+d.costUsd}),{skipped:0,calls:0,tokens:0,cost:null});
 const bill=u.billing==='plan'?'Billed to your plan, not per call; the dollars are what the same tokens cost at API list prices.':u.billing==='api'?'Billed per token through an API key, at about these list prices.':'This watcher’s judge does not report a price.';
 return `<p class="title-note">${bill}</p><table class="watch-usage"><thead><tr><th scope="col">Day</th><th scope="col">Checks</th><th scope="col">Skipped</th><th scope="col">Calls</th><th scope="col">Tokens</th><th scope="col">Cost</th></tr></thead><tbody>
  ${days.map(d=>rec(d)?`<tr><th scope="row">${esc(watchDay(d.date))}</th><td>${d.checks}</td><td>${d.firstPass?.skipped||0}</td><td>${d.calls}</td><td>${watchTokens(d.inputTokens+d.outputTokens)}</td><td>${watchMoney(d.costUsd)}</td></tr>`:`<tr class="watch-unrecorded"><th scope="row">${esc(watchDay(d.date))}</th><td>${d.checks}</td><td colspan="4">Not recorded</td></tr>`).join('')}
  </tbody>${tot.calls?`<tfoot><tr><th scope="row">Total</th><td></td><td>${tot.skipped}</td><td>${tot.calls}</td><td>${watchTokens(tot.tokens)}</td><td>${watchMoney(tot.cost)}</td></tr></tfoot>`:''}</table>
  ${since?`<p class="title-note">Recorded since ${esc(new Date(since).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:watchTZ}))}.</p>`:''}`;
}
async function inboxWatchSheet(){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet watch-sheet';
 sh.innerHTML='<h2>Inbox Watch</h2><div class="watch-body"><p class="title-note" role="status">Loading…</p></div>';
 mountSheet(scrim,sh);
 const holder=sh.querySelector('.watch-body');
 let w;
 try{w=await api('/inbox/watch',{signal:AbortSignal.timeout(8000)});}catch(e){if(sh.isConnected)holder.querySelector('[role=status]').textContent='The settings could not load: '+(e.message||'error');return;}
 if(!sh.isConnected)return;
 watchTZ=w.profile?.timezone||undefined;
 const dev=!assistantMode(),p=w.profile,opts=p?.options||{},everyChoices=opts.every||[0,1,2,3,5,10,15,20,30,45,60,90,120,180,240];
 let s=structuredClone(w.settings||p?.defaults||null);
 if(!s){holder.querySelector('[role=status]').textContent=watchStatus(w);return;}
 s.periods ||= [];
 for(const k of ['scope','tidy','firstPass','gmailLabel'])if(p?.defaults?.[k]&&!s[k])s[k]=structuredClone(p.defaults[k]); // 1.100: a group the watcher offers that your saved settings predate (the scope setting for everyone who saved before it existed)
 // 1.73: the rules box shows the watcher's file (it may have learned lines since), unless a save of yours has not reached it yet
 const rulesText=typeof w.settings?.rules==='string'&&p?.applied?.revision!==w.revision?w.settings.rules:(p?.rules?.text||'');
 const hours=[...Array(24).keys()],tz=p?.timezone&&p.timezone!==Intl.DateTimeFormat().resolvedOptions().timeZone?` Times are ${p.timezone.split('/').pop().replace(/_/g,' ')} time.`:'';
 const modelRow=(job,name,what)=>{const m=s.models?.[job]||{};const models=opts.models||[];return `<div class="router-level" data-job="${job}"><p class="router-level-name">${name}<span class="sub">${what}</span></p>
   <label class="voice-field">Model<select data-model>${models.map(x=>`<option value="${esc(x.id)}"${x.id===m.model?' selected':''}>${esc(x.label)}</option>`).join('')}</select></label>
   <label class="voice-field">Reasoning<select data-reasoning>${(opts.reasoning||[{id:'default',label:'Model default'}]).map(x=>`<option value="${esc(x.id)}"${x.id===m.reasoning?' selected':''}>${esc(x.label)}</option>`).join('')}</select></label></div>`;};
 const body=`<p class="title-note watch-status" role="status" id="w-status">${esc(watchStatus(w))}</p>
  <button class="opt" id="w-pause" aria-pressed="${Boolean(s.paused)}"><span class="dot${s.paused?' on':''}"></span><span>Pause Inbox Watch<span class="sub">No mail checks, digests or look-aheads until you turn this off</span></span></button>
  ${p.rules?`<div class="title-settings model-offer" role="group" aria-labelledby="w-rules-h"><p class="vault-set-head" id="w-rules-h">Your rules</p>
   <p class="title-note" id="w-rules-lead">Your instructions to Inbox Watch, in your own words: what matters to you, what doesn’t, and any rules of your own. It follows them on every check, in the first pass, the look-ahead and the tidy pass, and they win over its own judgment, even for something it would call critical. <strong>Not useful</strong> adds a line here.</p>
   <label class="voice-field watch-rules">Rules<textarea id="w-rules" rows="10" maxlength="${p.rules.max||8000}" spellcheck="true" aria-describedby="w-rules-lead w-rules-count" placeholder="${esc('Write your instructions here. For example:\nWho I am: I run a landscaping company; my office manager does scheduling.\nWhat matters: Tell me when a customer asks for a quote.\nWhat doesn’t: Never alert me about newsletters or receipts.\nMy rules: Anything from my accountant is high priority.')}">${esc(rulesText)}</textarea></label>
   <p class="title-note" id="w-rules-count"></p></div>`:''}
  ${s.gmailLabel?(()=>{const gl=opts.gmailLabel||{},name=esc(gl.name||'Pocket Inbox'),off=gl.available===false;return `<div class="title-settings model-offer" role="group" aria-labelledby="w-label-h"><p class="vault-set-head" id="w-label-h">Your list in Gmail</p>
   <button class="opt" id="w-label" aria-pressed="${Boolean(s.gmailLabel.enabled)}"${off?' aria-describedby="w-label-off"':''}><span class="dot${s.gmailLabel.enabled?' on':''}"></span><span>Keep a ${name} label in Gmail<span class="sub">Everything on this list carries the label in Gmail and stays in your inbox. Give an email the label and it comes here with a summary; take it off and it leaves this list. Finish one here and its email is archived in Gmail.</span></span></button>
   ${off?`<p class="title-note" id="w-label-off">Inbox Watch can only read this mailbox, so it can’t add the label yet: ${esc(gl.reason||'it has no Gmail write access')}.</p>`:''}</div>`;})():''}
  ${s.scope?(()=>{const sc=s.scope,known=Array.isArray(opts.labels)?opts.labels:[],all=[...new Set([...known,...(sc.labels||[])])];return `<div class="title-settings model-offer" role="group" aria-labelledby="w-scope-h"><p class="vault-set-head" id="w-scope-h">What it reads</p>
   <p class="title-note">Which mail Inbox Watch looks at. Everything is every thread but spam, trash and drafts, so mail your Gmail filters archive or file away is judged too. Inbox only reads what is in your Gmail inbox. Inbox and labels adds the labels you pick. An email you label ${esc((opts.gmailLabel||{}).name||'Pocket Inbox')} always joins the check. Your replies count wherever the thread sits; a new email you start is not read.</p>
   ${watchSelect('w-scope','Read',['all','inbox','inbox_labels'],sc.mode||'all',v=>({all:'Everything',inbox:'Inbox only',inbox_labels:'Inbox and these labels'})[v])}
   <div class="watch-labels" id="w-scope-labels"${(sc.mode||'all')==='inbox_labels'?'':' hidden'}><p class="title-note" id="w-scope-labels-lead">${known.length?'Your Gmail labels. Pick the ones to read.':'Type a Gmail label name and press Add; Inbox Watch lists your labels here once it has read them.'}</p>
    <div class="watch-label-chips" role="group" aria-labelledby="w-scope-labels-lead">${all.map(n=>`<button type="button" class="chip" data-scope-label="${esc(n)}" aria-pressed="${(sc.labels||[]).includes(n)}">${esc(n)}</button>`).join('')}</div>
    <div class="inbox-tools-row watch-label-add"><input type="text" class="watch-name" id="w-scope-add" placeholder="Another label name" aria-label="Add a Gmail label by name" maxlength="60"><button type="button" class="chip" id="w-scope-add-btn">${IC.plus}Add</button></div></div></div>`;})():''}
  <div class="title-settings model-offer" role="group" aria-labelledby="w-sched-h"><p class="vault-set-head" id="w-sched-h">Schedule</p>
   <p class="title-note">How often it checks your mail. Inside a period, that period’s interval applies; the rest of the time, this one. When periods overlap, the first listed wins. <strong>Check now</strong> in the Inbox checks at any time, so Don’t check means on demand only.${esc(tz)}</p>
   ${watchSelect('w-every','The rest of the time',everyChoices,s.every,watchEvery)}
   <div class="router-levels watch-periods" id="w-periods"></div>
   <span class="vault-set-actions"><button type="button" class="chip" id="w-add">${IC.plus}Add a period</button></span></div>
  <div class="title-settings model-offer" role="group" aria-labelledby="w-times-h"><p class="vault-set-head" id="w-times-h">Quiet hours and summaries</p>
   <div class="watch-pair">${watchSelect('w-quiet-from','Quiet from',hours,s.quietHours[0],watchHour)}${watchSelect('w-quiet-to','Until',hours,s.quietHours[1],watchHour)}</div>
   <p class="title-note" id="w-quiet-note">${watchQuietNote(s.digestHour)}</p>
   <div class="watch-pair">${watchSelect('w-digest','Morning digest',[null,...hours],s.digestHour,v=>v===null?'Off':watchHour(v))}</div>
   <div class="watch-pair">${watchSelect('w-la-morning','Morning look-ahead',[null,...hours],s.lookahead?.morning,v=>v===null?'Off':watchHour(v))}${watchSelect('w-la-evening','Evening look-ahead',[null,...hours],s.lookahead?.evening,v=>v===null?'Off':watchHour(v))}</div>
   <p class="title-note">The look-ahead checks what is coming due in the next few days and says so only when something needs you.</p></div>
  ${s.tidy?`<div class="title-settings model-offer" role="group" aria-labelledby="w-tidy-h"><p class="vault-set-head" id="w-tidy-h">Keep the Inbox tidy</p>
   <p class="title-note">Inbox Watch checks what is still on your list against the mail since, and takes off what has been resolved or handled, saying why. Restore brings any of them back.</p>
   <button class="opt" id="w-tidy" aria-pressed="${Boolean(s.tidy.enabled)}"><span class="dot${s.tidy.enabled?' on':''}"></span><span>Take finished items off my list<span class="sub">They move to Done; anything that still needs you stays</span></span></button>
   <div class="watch-pair">${watchSelect('w-tidy-every','How often',opts.tidyEvery||[1,2,4,8,12,24],s.tidy.every,v=>v===1?'Every hour':v===24?'Once a day':`Every ${v} hours`)}</div></div>`:''}
  ${dev?`<div class="title-settings model-offer" role="group" aria-labelledby="w-models-h"><p class="vault-set-head" id="w-models-h">Models</p>
   <div class="router-levels" id="w-models">${modelRow('decisions','Decisions','Every check that finds new mail')}${modelRow('lookahead','Look-ahead','Twice a day')}</div>
   <p class="title-note">Model default lets the model decide how much to reason.</p></div>
  ${s.firstPass?`<div class="title-settings model-offer" role="group" aria-labelledby="w-fp-h"><p class="vault-set-head" id="w-fp-h">First pass</p>
   <p class="title-note">A fast classifier skips mail that is clearly routine (receipts, shipping, newsletters, marketing), so the model reads less. Threads you wrote in, threads that mattered before and anything close to a story it follows are always read, and a skipped email’s headline still reaches the model.</p>
   <button class="opt" id="w-fp" aria-pressed="${Boolean(s.firstPass.enabled)}"${opts.firstPass?.available===false?' aria-describedby="w-fp-nokey"':''}><span class="dot${s.firstPass.enabled?' on':''}"></span><span>Skip routine mail first<span class="sub">${opts.firstPass?.available===false?'The watcher has no classifier key, so everything is read until one is set':'A few cents a day, even for a busy inbox'}</span></span></button>
   <div class="watch-pair">${watchSelect('w-fp-provider','Classifier',(opts.firstPass?.providers||[{id:'jev'},{id:'openai'},{id:'both'}]).map(x=>x.id),s.firstPass.provider,v=>({jev:'Jev (TypeSafe)',openai:'OpenAI decision model',both:'Both must agree'})[v]||v)}${watchSelect('w-fp-threshold','Skip when at least',opts.firstPass?.thresholds||[0.95,0.9,0.8,0.7],s.firstPass.threshold,v=>`${Math.round(v*100)}% sure`)}</div>
   ${opts.firstPass?.available===false?'<p class="title-note" id="w-fp-nokey">Add an OpenRouter key to the watcher’s [firstpass] settings to use it.</p>':''}</div>`:''}
  <div class="title-settings model-offer" role="group" aria-labelledby="w-cost-h"><p class="vault-set-head" id="w-cost-h">Cost, last 7 days</p><div id="w-usage">${watchUsageHTML(p.usage)}</div></div>`:''}
  <p class="vault-field-error" id="w-error" role="alert"></p>
  <div class="watch-actions"><button class="primary" id="w-save">Save</button>${w.settings?'<button class="chip" id="w-reset">Use the config file’s settings</button>':''}</div>`;
 holder.innerHTML=body;
 const $w=q=>sh.querySelector(q);
 const paintPeriods=()=>{const el=$w('#w-periods');el.innerHTML=s.periods.map((x,i)=>watchPeriodHTML(x,i,everyChoices)).join('');el.hidden=!s.periods.length;$w('#w-add').disabled=s.periods.length>=(opts.maxPeriods||12);};
 const readPeriods=()=>{s.periods=[...sh.querySelectorAll('.watch-period')].map(row=>({name:row.querySelector('.watch-name').value.trim(),days:[...row.querySelectorAll('[data-day][aria-pressed="true"]')].map(b=>Number(b.dataset.day)),
   from:row.querySelector('[data-from]').value,to:row.querySelector('[data-to]').value,every:Number(row.querySelector('[data-every]').value)}));};
 paintPeriods();
 $w('#w-periods').addEventListener('click',e=>{
  const day=e.target.closest('[data-day]');if(day){day.setAttribute('aria-pressed',String(day.getAttribute('aria-pressed')!=='true'));return;}
  const rm=e.target.closest('[data-remove]');if(rm){readPeriods();const i=Number(rm.closest('.watch-period').dataset.period);s.periods.splice(i,1);paintPeriods();($w('.watch-period .watch-name')||$w('#w-add')).focus();}
 });
 $w('#w-add').onclick=()=>{readPeriods();s.periods.push({name:'',days:[0,1,2,3,4,5,6],from:'22:00',to:'07:00',every:Math.max(15,s.every||15)});paintPeriods();sh.querySelector('.watch-period:last-child .watch-name')?.focus();};
 const rulesBox=$w('#w-rules'),rulesCount=()=>{const c=$w('#w-rules-count');if(c&&rulesBox)c.textContent=`${rulesBox.value.length.toLocaleString('en-US')} of ${Number(rulesBox.maxLength).toLocaleString('en-US')} characters`;};
 rulesBox?.addEventListener('input',rulesCount);rulesCount();
 $w('#w-tidy')?.addEventListener('click',e=>{s.tidy.enabled=!s.tidy.enabled;e.currentTarget.setAttribute('aria-pressed',String(s.tidy.enabled));e.currentTarget.querySelector('.dot').classList.toggle('on',s.tidy.enabled);});
 $w('#w-label')?.addEventListener('click',e=>{s.gmailLabel.enabled=!s.gmailLabel.enabled;e.currentTarget.setAttribute('aria-pressed',String(s.gmailLabel.enabled));e.currentTarget.querySelector('.dot').classList.toggle('on',s.gmailLabel.enabled);});
 $w('#w-fp')?.addEventListener('click',e=>{s.firstPass.enabled=!s.firstPass.enabled;e.currentTarget.setAttribute('aria-pressed',String(s.firstPass.enabled));e.currentTarget.querySelector('.dot').classList.toggle('on',s.firstPass.enabled);});
 if(s.scope){ // 1.100: the scope's mode shows or hides the label chips; a chip toggles a label; Add puts a typed name in as a pressed chip
  $w('#w-scope')?.addEventListener('change',e=>{s.scope.mode=e.target.value;const box=$w('#w-scope-labels');if(box)box.hidden=s.scope.mode!=='inbox_labels';});
  const chips=$w('#w-scope-labels');
  chips?.addEventListener('click',e=>{const b=e.target.closest('[data-scope-label]');if(!b)return;const on=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',String(on));});
  const addLabel=()=>{const inp=$w('#w-scope-add'),name=inp.value.replace(/\s+/g,' ').trim().slice(0,60);if(!name)return;const row=$w('.watch-label-chips');if(![...row.children].some(c=>c.dataset.scopeLabel===name))row.insertAdjacentHTML('beforeend',`<button type="button" class="chip" data-scope-label="${esc(name)}" aria-pressed="true">${esc(name)}</button>`);else row.querySelector(`[data-scope-label="${CSS.escape(name)}"]`).setAttribute('aria-pressed','true');inp.value='';};
  $w('#w-scope-add-btn')?.addEventListener('click',addLabel);$w('#w-scope-add')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addLabel();}});
 }
 $w('#w-pause').onclick=e=>{s.paused=!s.paused;e.currentTarget.setAttribute('aria-pressed',String(s.paused));e.currentTarget.querySelector('.dot').classList.toggle('on',s.paused);};
 const hourVal=id=>{const v=$w(id).value;return v==='off'?null:Number(v);};
 $w('#w-digest').addEventListener('change',()=>{$w('#w-quiet-note').textContent=watchQuietNote(hourVal('#w-digest'));});
 const collect=()=>{
  readPeriods();
  const out={paused:Boolean(s.paused),every:Number($w('#w-every').value),periods:s.periods,quietHours:[hourVal('#w-quiet-from'),hourVal('#w-quiet-to')],digestHour:hourVal('#w-digest'),
   lookahead:{morning:hourVal('#w-la-morning'),evening:hourVal('#w-la-evening')},models:structuredClone(s.models||{})};
  if(rulesBox)out.rules=rulesBox.value;
  if(s.gmailLabel)out.gmailLabel={enabled:Boolean(s.gmailLabel.enabled)};
  if(s.scope)out.scope={mode:$w('#w-scope')?.value||s.scope.mode||'all',labels:[...sh.querySelectorAll('[data-scope-label][aria-pressed="true"]')].map(b=>b.dataset.scopeLabel)};
  if(s.tidy)out.tidy={enabled:Boolean(s.tidy.enabled),every:Number($w('#w-tidy-every')?.value||s.tidy.every)};
  if(s.firstPass)out.firstPass={enabled:Boolean(s.firstPass.enabled),provider:$w('#w-fp-provider')?.value||s.firstPass.provider,threshold:Number($w('#w-fp-threshold')?.value||s.firstPass.threshold)};
  sh.querySelectorAll('#w-models [data-job]').forEach(row=>{out.models[row.dataset.job]={model:row.querySelector('[data-model]').value,reasoning:row.querySelector('[data-reasoning]').value};});
  const bad=out.periods.findIndex(x=>!x.days.length||!x.from||!x.to);
  if(bad>=0)throw new Error(`Period ${bad+1} needs at least one day and a start and end time.`);
  return out;
 };
 const save=async(settings,done)=>{
  const err=$w('#w-error');err.textContent='';const btn=$w('#w-save');btn.disabled=true;
  try{w={...w,...await api('/inbox/watch',{method:'POST',body:JSON.stringify({source:w.source,settings}),signal:AbortSignal.timeout(8000)})};toast(done);
   if(!settings){closeCurrentSheet?.();return inboxWatchSheet();}
   $w('#w-status').textContent=watchStatus(w);if(!$w('#w-reset'))$w('.watch-actions').insertAdjacentHTML('beforeend','<button class="chip" id="w-reset">Use the config file’s settings</button>'),bindReset();}
  catch(e){err.textContent=e.message||'Could not save';}finally{btn.disabled=false;}
 };
 $w('#w-save').onclick=()=>{let v;try{v=collect();}catch(e){$w('#w-error').textContent=e.message;return;}save(v,'Saved. Inbox Watch picks it up within a minute');};
 const bindReset=()=>{const r=$w('#w-reset');if(r)r.onclick=()=>save(null,'Back to the config file’s settings');};bindReset();
 // While the sheet is open, the status and the cost table keep up; the form is left as you have it.
 const poll=setInterval(async()=>{if(!sh.isConnected)return clearInterval(poll);try{const n=await api('/inbox/watch?source='+encodeURIComponent(w.source));w={...w,profile:n.profile,revision:n.revision};$w('#w-status').textContent=watchStatus(w);if(dev&&$w('#w-usage'))$w('#w-usage').innerHTML=watchUsageHTML(n.profile?.usage);}catch{}},20000);
}

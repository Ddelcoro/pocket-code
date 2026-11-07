/* Coordination (1.99): which conversation holds staging or a deploy, who is waiting, and what ended lately. Off until
   Settings → Projects, files, tasks & vault turns it on (window.pocketFeatures.coordination), and never in Assistant mode. One view (#/coordination),
   which opens like a session: as a tab, beside a conversation, in a window of its own, or full-screen on the phone.
   Agents make the claims with pocket-coord. A person only reads this list and releases, and a hold is advisory: nothing
   here stops a deploy. Data comes from /api/coordination; the only action is /api/coordination/owner-release. */
const coordOn=()=>Boolean(window.pocketFeatures?.coordination);
let coordSnap=null,coordView=null,coordPainted='',coordHeld=[];
// The line above the conversation list, only while something is held: `held` from /api/sessions.
function coordHeldLine(){
 const first=coordHeld[0];if(!first)return '';
 const rest=coordHeld.length-1;
 return `${first.name} held by ${first.title?`"${first.title}"`:'a terminal session'}${rest?` and ${rest} more`:''}`;
}
const coordAge=ms=>{const m=Math.max(1,Math.floor(ms/60000));return m<60?m+'m':Math.floor(m/60)+'h'+(m%60?' '+m%60+'m':'');};
const coordWho=x=>x.session?`<a href="${tabHref(x.session)}">${esc(x.title||'Untitled conversation')}</a>`:'Terminal session';
const coordWaiters=w=>w.length?`${w.length} waiting: ${w.map(x=>x.session?`"${esc(x.title||'Untitled conversation')}"`:'Terminal session').join(', ')}`:'';
const coordEnded={released:'Released',expired:'Expired',owner:'Released by you'};

function coordHoldRow(h,now){
 const waiting=coordWaiters(h.waiters||[]);
 return `<div class="coord-row" data-hold="${esc(h.name)}">
  <span class="coord-name">${esc(h.name)}</span>
  <span class="coord-who">${coordWho(h.holder)}</span>
  <span class="coord-why">${esc(h.reason||'')}</span>
  <span class="coord-time">${esc(coordAge(now-h.heldAt))}</span>
  ${waiting?`<span class="coord-wait">${waiting}</span>`:''}
  <button class="chip coord-release" data-coord-release="${esc(h.name)}" aria-label="Release ${esc(h.name)}">Release</button>
 </div>`;
}
function coordRecentRow(h,now){
 const said=[coordEnded[h.event]||'Ended',h.note].filter(Boolean).join(': ');
 return `<div class="coord-row coord-past" data-past="${esc(h.name)}">
  <span class="coord-name">${esc(h.name)}</span>
  <span class="coord-who">${coordWho(h.holder)}</span>
  <span class="coord-why">${esc(said)}</span>
  <span class="coord-time">${esc(coordAge(now-h.endedAt))}</span>
 </div>`;
}
function coordHTML(){
 const {holds,recent,now}=coordSnap;
 return `<section class="session-group project-group"><h2>Held now${holds.length?` <span>${holds.length}</span>`:''}</h2>
   ${holds.length?holds.map(h=>coordHoldRow(h,now)).join(''):'<p class="sheet-help project-empty">Nothing is held. A conversation that claims staging or a deploy shows here.</p>'}</section>
  ${recent.length?`<section class="session-group project-group"><h2>Recent</h2>${recent.map(h=>coordRecentRow(h,now)).join('')}</section>`:''}
  <p class="sheet-help coord-foot">Holds are a courtesy between agents. Nothing here stops a deploy.</p>`;
}
function paintCoordination(){
 const main=$('#coord-main');if(!main||!coordSnap||!coordView)return;
 const html=coordHTML();if(html===coordPainted)return;
 const focused=document.activeElement?.dataset?.coordRelease;
 main.innerHTML=html;coordPainted=html;
 main.querySelectorAll('[data-coord-release]').forEach(b=>b.onclick=()=>coordRelease(b));
 if(focused)[...main.querySelectorAll('[data-coord-release]')].find(b=>b.dataset.coordRelease===focused)?.focus();
}
async function loadCoordination(){coordSnap=await api('/coordination',{signal:AbortSignal.timeout(8000)});return coordSnap;}
// One tap, as the plan says: the holder is told the next time it runs, and the next waiter is woken.
async function coordRelease(btn){
 const name=btn.dataset.coordRelease,hold=coordSnap?.holds.find(h=>h.name===name);btn.disabled=true;
 try{
  const r=await api('/coordination/owner-release',{method:'POST',body:JSON.stringify({name})});
  toast([`Released ${name}.`,hold?.holder?.session?'Its conversation is told when it next runs.':'',r.woke?`Woke "${r.woke}".`:''].filter(Boolean).join(' '));
 }catch(e){toast(e.message||'Could not release that');}
 await loadCoordination().catch(()=>{});coordPainted='';paintCoordination();
 if(typeof refreshSessions==='function')refreshSessions().catch(()=>{});
}
async function renderCoordination(view){
 Voice.onLeave?.();
 coordView=view;coordPainted='';if(typeof boardView!=='undefined')boardView=null;if(typeof docView!=='undefined')docView=null;
 const col=`<header class="bar">
   ${PANE?`<button class="icon" id="pane-main" aria-label="Make this the main view">${IC.swap}</button>`:SOLO?'':`<button class="icon" id="back" aria-label="Back">${IC.back}</button><button class="icon desk" id="railtog" aria-label="Show or hide the conversation list">${IC.panel}</button>`}
   <h1><span class="one" id="ktitle">Coordination</span><span class="tag" id="ktag">Who holds what</span></h1>
   ${SOLO?'':`<button class="icon" id="kwin" aria-label="Open in a new window" title="Open in a new window">${IC.external}</button>`}
   ${PANE||SOLO?'':`<button class="icon desk" id="splitb" aria-label="Split view">${IC.columns}</button>`}
   ${PANE?`<button class="icon" id="pane-close" aria-label="Close this pane">${IC.x}</button>`:''}
  </header>
  <main class="scroll projects-view coord-view" id="coord-main" tabindex="-1"><p class="sheet-help projects-loading">Loading holds…</p></main>`;
 app.innerHTML=withShell(col);
 wireShell();
 if(PANE){$('#pane-main').onclick=()=>paneSay('main',{view});$('#pane-close').onclick=()=>paneSay('close');}
 else if(!SOLO){bindViewBack($('#back'),view);$('#splitb').onclick=chooseBeside;}
 $('#kwin')?.addEventListener('click',()=>openInWindow(view));
 const tog=$('#railtog');if(tog)tog.onclick=()=>{localStorage.setItem('pc-rail',railOpen()?'closed':'open');route();};
 try{await loadCoordination();}
 catch(e){if(coordView!==view)return;const main=$('#coord-main');if(!main)return;if(coordSnap)paintCoordination();showLibraryError(main,e,'Coordination',()=>renderCoordination(view),Boolean(coordSnap));restoreViewPosition(view);return;}
 if(coordView!==view)return;
 if(PANE)paneSay('route',{id:view,title:'Coordination'});else if(SOLO)document.title='Coordination · '+appName();else rememberOpenView(view,'Coordination');
 paintCoordination();
 restoreViewPosition(view);
}
// Holds change without anyone here touching them, so the open view keeps up. It repaints only when the words change.
setInterval(()=>{if(coordView&&document.visibilityState==='visible')loadCoordination().then(paintCoordination).catch(()=>{});},10000);

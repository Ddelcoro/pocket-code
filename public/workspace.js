/* Daily workspace: local navigation preferences, shared session data. */
// ?pane=1: this window is a split-view pane inside another Pocket window (split.js)
const PANE=new URLSearchParams(location.search).has('pane');
// A pane's New session screen keeps its own draft, attachments and retry state, so it
// never collides with the main window's New screen or another pane's.
const PANE_KEY=(k=>/^[0-9a-f-]{36}$/.test(k||'')?k:'')(new URLSearchParams(location.search).get('pane'));
const NEW_KEY=PANE&&PANE_KEY?'new-pane-'+PANE_KEY:'new';
// ?solo=1 (1.31): this window shows one view on its own, in its own browser tab or app window: no rail, no tab
// strip, no pane controls. "Open in a new window" for a project or a document.
const SOLO=!PANE&&new URLSearchParams(location.search).has('solo');
function openInWindow(id){
 const w=window.open('/?solo=1'+tabHref(id),'_blank');
 if(!w&&typeof toast==='function')toast('The browser blocked the new window. Allow pop-ups for Pocket Code and try again.');
}
// A plain click on a project or document link opens it the way this browser prefers (Settings → Projects & documents): a tab here,
// beside the conversation, or its own window. Modified clicks keep the browser's own behaviour.
const plainClick=e=>e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey;
function openViewPreferred(id,prefKey,e,canBeside){
 if(!plainClick(e))return false;
 const pref=readLocal(prefKey,'tab');
 if(pref==='window'){e.preventDefault();openInWindow(id);return true;}
 // 1.53.3: inside a split pane, "beside" asks the window around it for a new pane to this pane's left, so the
 // list the view was chosen from stays in sight. (The pane's own width is not what decides; the window checks room.)
 if(pref==='beside'&&PANE&&id!==currentView()&&typeof paneSay==='function'){e.preventDefault();paneSay('beside',{id});return true;}
 if(pref==='beside'&&canBeside&&!PANE&&!SOLO&&typeof openBeside==='function'){e.preventDefault();openBeside(id);return true;}
 return false;
}
function readLocal(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function writeLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
// 1.29: project views open like sessions (tabs, panes); their ids are routes without the leading #/.
const VIEW_TAB_RE=/^(?:projects(?:\/(?:scheduled|[a-z0-9][a-z0-9-]{0,79}))?|documents(?:\/[0-9a-f]{12})?|tasks|vault|inbox(?:\/[0-9a-f]{12})?|link\/[A-Za-z0-9%._~!*'()-]{1,2000})$/; // 1.30: documents too; 1.36: tasks; 1.39: vault; 1.54: a linked page (links.js)
const isViewId=id=>typeof id==='string'&&VIEW_TAB_RE.test(id);
const tabHref=id=>isViewId(id)?'#/'+id:'#/chat/'+encodeURIComponent(id).replaceAll('%3A',':');
// The view the main column shows when it is not a conversation: a project view (1.29) or a document view (1.30).
const currentView=()=>(typeof boardView!=='undefined'&&boardView)||(typeof docView!=='undefined'&&docView)||(typeof taskView!=='undefined'&&taskView)||(typeof vaultView!=='undefined'&&vaultView)||(typeof linkView!=='undefined'&&linkView)||(typeof inboxView!=='undefined'&&inboxView)||null; // 1.39: vault; 1.54: a linked page; 1.85.1: the inbox
// Native radio keyboard conventions for our button-based choices.
function bindRadioGroup(group) {
 const radios=()=>[...group.querySelectorAll('[role="radio"]')].filter(el=>!el.disabled&&!el.hidden);
 const items=radios(),selected=items.find(el=>el.getAttribute('aria-checked')==='true')||items[0];
 items.forEach(el=>{el.tabIndex=el===selected?0:-1;});
 group.onkeydown=e=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;
  const list=radios(),index=list.indexOf(e.target.closest('[role="radio"]'));if(index<0)return;
  e.preventDefault();
  const next=e.key==='Home'?0:e.key==='End'?list.length-1:(index+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)+list.length)%list.length;
  list[next].click();list[next].focus();
 };
}
function paintSessionFilterSummaries(){
 const parts=[workspaceFilter?projShort(workspaceFilter):'',providerFilter==='codex'?'Codex':providerFilter==='claude'?'Claude':providerFilter==='acp'?'OpenRouter':'', ['new','pinned','hidden'].includes(sessionFilter)?({new:'New',pinned:'Pinned',hidden:'Hidden'}[sessionFilter]):''].filter(Boolean);
 document.querySelectorAll('[data-filter-summary]').forEach(el=>{el.textContent=parts.length?' · '+parts.join(' · '):'';});
 document.querySelectorAll('[data-clear-more-filters]').forEach(el=>{el.hidden=!parts.length;});
}
let toolbarScrollObserver=null;
function bindToolbarScroll(bar){
 let wrap=bar.closest('.toolbar-scroll');
 if(!wrap){
  wrap=document.createElement('div');wrap.className='toolbar-scroll';bar.before(wrap);wrap.append(bar);
  const previous=document.createElement('button'),next=document.createElement('button');
  previous.className='icon toolbar-previous';next.className='icon toolbar-next';
  previous.setAttribute('aria-label','Previous message settings');next.setAttribute('aria-label','More message settings');
  previous.setAttribute('aria-controls','tbar');next.setAttribute('aria-controls','tbar');
  previous.innerHTML=next.innerHTML=IC.back;previous.hidden=next.hidden=true;
  wrap.prepend(previous);wrap.append(next);
  const paint=()=>{
   if(!bar.isConnected)return;
   const overflow=bar.scrollWidth>wrap.clientWidth+1;
   if(!overflow&&(document.activeElement===previous||document.activeElement===next))bar.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
   previous.hidden=next.hidden=!overflow;
   previous.disabled=bar.scrollLeft<=1;next.disabled=bar.scrollLeft+bar.clientWidth>=bar.scrollWidth-1;
   bar.classList.toggle('fade-start',overflow&&!previous.disabled);bar.classList.toggle('fade-end',overflow&&!next.disabled); // 1.20.1: a soft edge, not a cut word
  };
  previous.onclick=()=>{bar.scrollLeft-=Math.max(120,bar.clientWidth*.8);paint();};
  next.onclick=()=>{bar.scrollLeft+=Math.max(120,bar.clientWidth*.8);paint();};
  bar.addEventListener('scroll',paint,{passive:true});
  toolbarScrollObserver?.disconnect();toolbarScrollObserver=new ResizeObserver(paint);toolbarScrollObserver.observe(wrap);toolbarScrollObserver.observe(bar);
  wrap.paintOverflow=paint;
 }
 wrap.paintOverflow();
}
const CHAT_TEXT_DEFAULT=17,CHAT_TEXT_MIN=14,CHAT_TEXT_MAX=24;
const savedChatText=readLocal('pc-chat-text-size',CHAT_TEXT_DEFAULT);
let chatTextSize=Number.isInteger(savedChatText)&&savedChatText>=CHAT_TEXT_MIN&&savedChatText<=CHAT_TEXT_MAX?savedChatText:CHAT_TEXT_DEFAULT;
document.documentElement.style.setProperty('--chat-text-size',chatTextSize+'px');
function chatTextControlsHTML(){
 return `<section class="chat-text-settings" aria-label="Chat text size">
  <p class="chat-text-label">Chat text size</p>
  <div class="chat-text-controls" role="group" aria-label="Adjust chat text size">
   <button data-text-smaller aria-label="Smaller chat text">Smaller</button>
   <output data-text-size aria-live="polite" aria-atomic="true">${chatTextSize}px</output>
   <button data-text-larger aria-label="Larger chat text">Larger</button>
   <button data-text-reset aria-label="Reset chat text to 17 pixels">Reset</button>
  </div>
  <p class="chat-text-preview">Your conversation, at a size that works for you.</p>
  <p class="chat-text-help">Saved for all conversations on this browser.</p>
 </section>`;
}
function setChatTextSize(size){
 if(!Number.isInteger(size))return;
 const scroller=document.querySelector('#msgs')?.closest('main.scroll');
 const bottom=scroller&&scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<24;
 const edge=scroller?.getBoundingClientRect().top||0;
 const anchor=scroller&&[...scroller.querySelectorAll('.m-user,.m-asst > p,.m-asst > h1,.m-asst > h2,.m-asst > h3,.m-asst > ul,.m-asst > ol,.m-asst > blockquote,.report-table')].find(el=>el.getBoundingClientRect().bottom>edge);
 const anchorTop=anchor?.getBoundingClientRect().top;
 chatTextSize=Math.min(CHAT_TEXT_MAX,Math.max(CHAT_TEXT_MIN,size));
 writeLocal('pc-chat-text-size',chatTextSize);
 document.documentElement.style.setProperty('--chat-text-size',chatTextSize+'px');
 if(scroller){
  if(bottom)scroller.scrollTop=scroller.scrollHeight;
  else if(anchor)scroller.scrollTop+=anchor.getBoundingClientRect().top-anchorTop;
  rememberReading();
 }
 document.querySelectorAll('[data-text-size]').forEach(el=>el.textContent=chatTextSize+'px');
 document.querySelectorAll('[data-text-smaller]').forEach(el=>el.disabled=chatTextSize===CHAT_TEXT_MIN);
 document.querySelectorAll('[data-text-larger]').forEach(el=>el.disabled=chatTextSize===CHAT_TEXT_MAX);
}
function bindChatTextControls(container){
 container.querySelectorAll('[data-text-smaller]').forEach(el=>{el.disabled=chatTextSize===CHAT_TEXT_MIN;el.onclick=()=>setChatTextSize(chatTextSize-1);});
 container.querySelectorAll('[data-text-larger]').forEach(el=>{el.disabled=chatTextSize===CHAT_TEXT_MAX;el.onclick=()=>setChatTextSize(chatTextSize+1);});
 container.querySelectorAll('[data-text-reset]').forEach(el=>el.onclick=()=>setChatTextSize(CHAT_TEXT_DEFAULT));
}
// Appearance is bootstrapped by theme.js before CSS; palettes live in app.css.
const ACCENTS={
 clay:{label:'Orange'}, blue:{label:'Blue'}, purple:{label:'Purple'}
};
const ACCENT_DEFAULT='clay';
let accentKey=PocketTheme.accent;
function applyAccent(key){
 PocketTheme.setAccent(ACCENTS[key]?key:ACCENT_DEFAULT);
}
function setAccent(key){
 if(!ACCENTS[key])return;
 applyAccent(key);
}
function accentControlsHTML(){
 const swatches=Object.entries(ACCENTS).map(([k,a])=>`<button data-accent="${k}" aria-pressed="${k===accentKey}" aria-label="${a.label}" title="${a.label}"><span class="accent-dot"></span>${a.label}</button>`).join('');
 return `<section class="chat-text-settings accent-settings" aria-label="Highlight colour">
  <p class="chat-text-label">Highlight colour</p>
  <div class="chat-text-controls accent-controls" role="group" aria-label="Choose highlight colour">${swatches}</div>
  <p class="chat-text-help">Used for the send button, links, active markers and your messages. Saved on this browser.</p>
 </section>`;
}
function bindAccentControls(container){
 container.querySelectorAll('[data-accent]').forEach(el=>{el.onclick=()=>setAccent(el.dataset.accent);});
}
function themeControlsHTML(){
 return `<section class="chat-text-settings theme-settings" aria-label="Colour mode">
  <label class="voice-field">Colour mode<select id="s-theme">
   ${[['system','System'],['light','Light'],['dark','Dark']].map(([key,label])=>`<option value="${key}"${PocketTheme.preference===key?' selected':''}>${label}</option>`).join('')}
  </select></label>
  <p class="chat-text-help">System follows your device’s appearance. Saved on this browser for all Pocket windows and split views.</p>
 </section>`;
}
function syncAppearanceControls(){
 accentKey=PocketTheme.accent;
 document.querySelectorAll('button[data-accent]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.accent===accentKey)));
 const select=document.getElementById('s-theme');if(select)select.value=PocketTheme.preference;
}
window.addEventListener('pocket-appearance-change',syncAppearanceControls);
let headerCollapsed=readLocal('pc-header-collapsed',false)===true;
let composerCollapsed=readLocal('pc-composer-collapsed',false)===true;
let railFiltersCollapsed=readLocal('pc-rail-filters-collapsed',false)===true;
// 1.19: the run status sits in the title bar beside the project name instead of its own 28px strip;
// 1.35: at every width, with the session links in the same header (one header, not three rows).
function paintWorkspaceDensity(){
 const split=document.querySelector('.split');
 split?.classList.toggle('compact-header',headerCollapsed);
 const statusInHeader=true;
 split?.classList.toggle('status-in-header',statusInHeader);
 const header=document.getElementById('header-toggle');
 if(header){
  const label=(headerCollapsed?'Expand':'Collapse')+' conversation header';
  header.setAttribute('aria-expanded',String(!headerCollapsed));header.setAttribute('aria-label',label);header.title=label;
  header.innerHTML=headerCollapsed?IC.down1:IC.up1;
 }
 const confirmation=document.getElementById('run-confirmation');
 const bar=header?.closest('header');
 if(confirmation&&bar){
  const target=statusInHeader?bar.querySelector('h1'):document.getElementById('conversation-controls');
  if(confirmation.parentElement!==target){
   if(statusInHeader)target.append(confirmation);else target.prepend(confirmation);
  }
 }
 reportWorkspaceChrome();
 const toggle=document.getElementById('rail-filter-toggle'),controls=document.getElementById('rail-filter-controls');
 if(toggle){
  const label=(railFiltersCollapsed?'Expand':'Collapse')+' conversation filters';
  toggle.setAttribute('aria-expanded',String(!railFiltersCollapsed));toggle.setAttribute('aria-label',label);toggle.title=label;
  toggle.innerHTML='Filters '+(railFiltersCollapsed?IC.down1:IC.up1);
 }
 if(controls)controls.hidden=railFiltersCollapsed;
 const summary=document.getElementById('rail-filter-summary');
 if(summary){
  const parts=[workspaceFilter?projShort(workspaceFilter):'',providerFilter==='codex'?'Codex':providerFilter==='claude'?'Claude':providerFilter==='acp'?'OpenRouter':'',sessionFilter!=='all'?({active:'Active',attention:'Attention',new:'New',pinned:'Pinned',hidden:'Hidden'}[sessionFilter]||sessionFilter):''].filter(Boolean);
  summary.hidden=!parts.length;summary.querySelector('span').textContent=parts.join(' · ');
  summary.querySelector('button').onclick=()=>{
   workspaceFilter='';providerFilter='';sessionFilter='all';
   writeLocal('pc-workspace-filter','');writeLocal('pc-provider-filter','');
   document.getElementById('rail-filter-toggle')?.focus({preventScroll:true});paintSessionPanels();
  };
 }
}
// Change visibility in place: drafts, attachments, streams and open docks survive.
function preserveConversationView(change){
 const scroller=document.querySelector('#msgs')?.closest('main.scroll');
 const top=scroller?.scrollTop||0,bottom=scroller&&scroller.scrollHeight-top-scroller.clientHeight<24;
 change();
 if(scroller)scroller.scrollTop=bottom?scroller.scrollHeight:top;
}
function setHeaderCollapsed(value){
 preserveConversationView(()=>{headerCollapsed=value;writeLocal('pc-header-collapsed',value);paintWorkspaceDensity();});
}
function paintComposerDensity(){
 const comp=document.getElementById('comp'),button=document.getElementById('composer-toggle');
 comp?.classList.toggle('compact-composer',composerCollapsed);
 if(button){
  const label=(composerCollapsed?'Show':'Hide')+' message settings';
  button.setAttribute('aria-expanded',String(!composerCollapsed));button.setAttribute('aria-label',label);button.title=label;
  button.onclick=()=>preserveConversationView(()=>{composerCollapsed=!composerCollapsed;writeLocal('pc-composer-collapsed',composerCollapsed);paintComposerDensity();});
 }
}
// The embedder may coordinate chrome only; never share session data or credentials.
const workspaceParentOrigin=(()=>{try{return !PANE&&parent!==window?new URL(document.referrer).origin:null;}catch{return null;}})();
function reportWorkspaceChrome(){
 if(workspaceParentOrigin)parent.postMessage({pocketWorkspace:'state',active:Boolean(document.getElementById('header-toggle')),collapsed:headerCollapsed},workspaceParentOrigin);
}
addEventListener('message',event=>{
 if(!workspaceParentOrigin||event.source!==parent||event.origin!==workspaceParentOrigin)return;
 if(event.data?.pocketWorkspace==='ready')reportWorkspaceChrome();
 if(event.data?.pocketWorkspace==='set'&&typeof event.data.collapsed==='boolean'&&document.getElementById('header-toggle'))setHeaderCollapsed(event.data.collapsed);
});
function bindWorkspaceDensity(){
 const header=document.getElementById('header-toggle');
 if(header)header.onclick=()=>setHeaderCollapsed(!headerCollapsed);
 const filters=document.getElementById('rail-filter-toggle');
 if(filters)filters.onclick=()=>{railFiltersCollapsed=!railFiltersCollapsed;writeLocal('pc-rail-filters-collapsed',railFiltersCollapsed);paintWorkspaceDensity();};
 paintWorkspaceDensity();
}
let workspaceFilter=readLocal('pc-workspace-filter',''), providerFilter=readLocal('pc-provider-filter','');
let hiddenSessions=readLocal('pc-hidden-sessions',{}), openSessions=readLocal('pc-open-sessions',[]);
if(typeof workspaceFilter!=='string')workspaceFilter='';
if(!['','claude','codex','acp'].includes(providerFilter))providerFilter='';
if(!hiddenSessions||typeof hiddenSessions!=='object'||Array.isArray(hiddenSessions))hiddenSessions={};
openSessions=Array.isArray(openSessions)?openSessions.filter(s=>s&&typeof s.id==='string'&&(/^(?:(?:cx:)?[0-9a-f-]{36}|acp:ses_[0-9A-Za-z-]{1,64})$/.test(s.id)||isViewId(s.id))&&typeof s.title==='string').slice(-12):[];
let dockKind=readLocal('pc-dock-kind',''),dockSurface=null;
const hasDockRoom=()=>matchMedia('(min-width: 1280px)').matches;
function isHiddenSession(s){return hiddenSessions[s.id]>=Math.max(s.mtimeMs||0,s.state?.at||0)&&!['running','background','observed','waiting','input'].includes(rowState(s).kind);}
function workspaceFilterHTML(){
 const paths=[...new Set(allSessions.map(s=>s.cwd).filter(Boolean))].sort();
 if(workspaceFilter&&!paths.includes(workspaceFilter))paths.unshift(workspaceFilter);
 return `<div class="workspace-filters"><label>Workspace<select data-workspace-filter><option value="">All workspaces</option>${paths.map(p=>`<option value="${esc(p)}" ${workspaceFilter===p?'selected':''}>${esc(projShort(p))}</option>`).join('')}</select></label><label>Agent<select data-provider-filter><option value="">All agents</option><option value="claude" ${providerFilter==='claude'?'selected':''}>Claude</option><option value="codex" ${providerFilter==='codex'?'selected':''}>Codex</option>${allSessions.some(s=>s.provider==='acp')||providerFilter==='acp'?`<option value="acp" ${providerFilter==='acp'?'selected':''}>OpenRouter</option>`:''}</select></label></div>`;
}
function paintWorkspaceFilters(){
 document.querySelectorAll('[data-workspace-filters]').forEach(el=>{
  // Do not replace an open native select while background polling updates rows.
  if(el.contains(document.activeElement))return;
  el.innerHTML=workspaceFilterHTML();
  el.querySelector('[data-workspace-filter]').onchange=e=>{workspaceFilter=e.target.value;writeLocal('pc-workspace-filter',workspaceFilter);paintSessionPanels();};
  el.querySelector('[data-provider-filter]').onchange=e=>{providerFilter=e.target.value;writeLocal('pc-provider-filter',providerFilter);paintSessionPanels();};
 });
}
function rememberOpenSession(s){
 const row={id:s.id,title:s.title};
 const index=openSessions.findIndex(r=>r.id===s.id);
 if(index<0)openSessions.push(row);else openSessions[index]=row;
 if(openSessions.length>12)openSessions.shift();
 writeLocal('pc-open-sessions',openSessions);writeLocal('pc-last-session',s.id);paintOpenSessions();
}
// Tabs follow the session list: pinned sessions first, in their pinned order (shared by every device),
// then the rest in the order they were opened. Pinned tabs carry the pin and the accent, like the rail rows.
const pinnedSession=id=>(typeof allSessions!=='undefined'?allSessions:[]).find(s=>s.id===id&&s.pinned)||null;
function orderedOpenSessions(){
 const pins=(typeof allSessions!=='undefined'?allSessions:[]).filter(s=>s.pinned).map(s=>s.id);
 return [...pins.map(id=>openSessions.find(s=>s.id===id)).filter(Boolean),...openSessions.filter(s=>!pins.includes(s.id))];
}
// A tab carries the same status as its rail row: the breathing ember while a turn runs, a clay dot when it
// needs you, green for an unread reply, red for a failure, a ring for activity elsewhere or a paused queue.
// Quiet sessions and an unconfirmed list show nothing, so a dot always means a confirmed state.
function tabState(id){
 if(isViewId(id))return typeof viewTabState==='function'?viewTabState(id):null; // 1.29: a project tab marks due reminders
 if(typeof allSessions==='undefined'||sessionsStale)return null;
 const row=allSessions.find(s=>s.id===id);if(!row)return null;
 const st=listState(row);
 return ['running','background','input','failed','finished','observed','waiting'].includes(st.kind)?{kind:st.kind,label:st.kind==='finished'?'Response ready':st.label}:null;
}
// 1.28: a large session whose prompt cache is about to expire (hourglass) or has expired (snowflake). Resuming it
// cold writes the whole context to cache again. Warm and small sessions show nothing; an unconfirmed list neither.
function tabCache(id){
 if(typeof allSessions==='undefined'||sessionsStale||typeof cacheStatus!=='function')return null;
 const c=allSessions.find(s=>s.id===id)?.cache;if(!c||!(c.cached>=CACHE_MARK_MIN))return null;
 const st=cacheStatus(c);if(!st||st.kind==='warm')return null;
 return st.kind==='cold'?{kind:'cold',label:'Prompt cache expired: '+fmtTokens(c.cached)+' tokens to write again'}:{kind:'cooling',label:'Prompt cache expiring soon'};
}
function paintOpenSessions(){
 const el=document.getElementById('open-sessions');if(!el)return;
 const list=orderedOpenSessions();
 // Repaint only when something shows differently: the list refreshes every few seconds and must not snap the strip's scroll back.
 const states=list.map(s=>tabState(s.id)),caches=list.map(s=>tabCache(s.id));
 const current=id=>id===chatId||(!chatId&&id===currentView());
 const key=JSON.stringify([chatId,currentView(),list.map((s,i)=>[s.id,s.title,Boolean(pinnedSession(s.id)),states[i]?.kind,states[i]?.label,caches[i]?.label])]);
 if(el.dataset.key===key)return;el.dataset.key=key;
 el.innerHTML=list.map((s,i)=>{const pinned=Boolean(pinnedSession(s.id)),st=states[i],ca=caches[i];return `<span class="open-session ${current(s.id)?'current':''} ${pinned?'pinned':''}"><a href="${tabHref(s.id)}" ${current(s.id)?'aria-current="page"':''} title="${esc(s.title)}${pinned?' · Pinned':''}${st?' · '+esc(st.label):''}${ca?' · '+esc(ca.label):''}">${st?`<span class="tab-state ${st.kind==='running'?'ember':st.kind==='background'?'ember dim':'tab-'+st.kind}" role="img" aria-label="${esc(st.label)}"></span>`:''}${pinned?`<span class="pinmark">${IC.pin}</span><span class="vh">Pinned: </span>`:''}${ca?`<span class="tab-cache tab-cache-${ca.kind}" role="img" aria-label="${esc(ca.label)}">${ca.kind==='cold'?IC.snow:IC.hourglass}</span>`:''}${esc(s.title)}</a><button data-close-session="${esc(s.id)}" aria-label="Close tab for ${esc(s.title)}">${IC.x}</button></span>`;}).join('');
 el.querySelectorAll('[data-close-session]').forEach(b=>b.onclick=()=>{
  const id=b.dataset.closeSession,shown=orderedOpenSessions(),index=shown.findIndex(s=>s.id===id),rest=shown.filter(s=>s.id!==id);
  openSessions=openSessions.filter(s=>s.id!==id);writeLocal('pc-open-sessions',openSessions);
  if(chatId===id||currentView()===id)location.hash=rest.length?tabHref(rest[Math.max(0,index-1)].id):'#/';else paintOpenSessions();
 });
 el.querySelector('[aria-current]')?.scrollIntoView({block:'nearest',inline:'nearest'});
}
function workspaceMount(scrim,sh,kind){
 dockSurface?.remove();dockSurface=null;
 if(!hasDockRoom()||!document.querySelector('.split'))return mountSheet(scrim,sh);
 closeCurrentSheet?.();dockKind=kind;writeLocal('pc-dock-kind',kind);
 sh.classList.remove('sheet');sh.classList.add('workspace-dock');sh.setAttribute('role','complementary');sh.setAttribute('aria-label',kind==='git'?'Git workspace':kind==='queue'?'Queued instructions':kind==='side'?'Side chat':'Conversation results');
 const actions=document.createElement('nav');actions.className='dock-tabs';actions.setAttribute('aria-label','Workspace panel');
 actions.innerHTML=[['results','Results'],['queue','Queue'],['git','Git'],...(SideChat.available(chatId)?[['side','Side chat']]:[])].map(([key,label])=>`<button class="chip" data-dock="${key}" aria-pressed="${kind===key}">${label}</button>`).join('')+`<button class="icon" data-close-dock aria-label="Close workspace panel">${IC.x}</button>`;
 sh.prepend(actions);document.querySelector('.split').append(sh);dockSurface=sh;
 if(typeof sizeMainForSplit==='function')sizeMainForSplit();
 actions.querySelectorAll('[data-dock]').forEach(b=>b.onclick=()=>openDock(b.dataset.dock,chatId));
 actions.querySelector('[data-close-dock]').onclick=()=>{sh.remove();dockSurface=null;dockKind='';writeLocal('pc-dock-kind','');if(typeof sizeMainForSplit==='function')sizeMainForSplit();$('#box')?.focus();};
 return ()=>{sh.remove();if(dockSurface===sh)dockSurface=null;if(typeof sizeMainForSplit==='function')sizeMainForSplit();};
}
function openDock(kind,id){if(kind==='results')return openResults(id);if(kind==='queue')return openQueue(id);if(kind==='git')return openGit(id);if(kind==='side')return SideChat.open(id);}
// 1.78: a side chat dock stays open across conversations only where one can run (Claude, not Codex).
function restoreDock(){if(hasDockRoom()&&['results','queue','git'].includes(dockKind)||hasDockRoom()&&dockKind==='side'&&SideChat.available(chatId))openDock(dockKind,chatId);}
async function openGit(id){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet git-sheet';
 sh.innerHTML='<h2 data-git-title>Git workspace</h2><label class="git-pick" data-git-pick hidden><span>Repository</span><select data-git-folder></select></label><p class="git-also" data-git-also hidden></p><p class="sheet-help">Current changes in this repository, including work from other conversations. Read only.</p><button class="chip" data-git-refresh>Refresh</button><div data-git-status role="status">Reading repository…</div><div data-git-files></div><div data-git-diff></div>';
 workspaceMount(scrim,sh,'git');let generation=0,folder='',folders=[];
 const gitPath=(tail,extra='')=>'/session/'+encodeURIComponent(id)+tail+(folder?(extra?extra+'&':'?')+'folder='+encodeURIComponent(folder):extra);
 const shortName=p=>String(p||'').split('/').filter(Boolean).pop()||p;
 // 1.97: the panel follows the conversation, so it reads which folders that is first. If that read fails it still opens on the starting folder.
 const readFolders=async()=>{
  let f;try{f=await api('/session/'+encodeURIComponent(id)+'/folders');}catch{return;}
  if(!sh.isConnected)return;folders=f.folders||[];
  if(!folders.some(x=>x.root===folder))folder=f.active||'';
  const pick=sh.querySelector('[data-git-pick]'),select=sh.querySelector('[data-git-folder]');pick.hidden=folders.length<2;
  select.innerHTML=folders.map(x=>`<option value="${esc(x.root)}">${esc(shortName(x.root))} · ${esc(x.branch)}</option>`).join('');select.value=folder;
  const also=sh.querySelector('[data-git-also]'),rows=(f.also||[]).slice(0,3);also.hidden=!rows.length;
  also.innerHTML=rows.length?'Also working here: '+rows.map(r=>`<a href="#/chat/${encodeURIComponent(r.id)}">${esc(r.title)}</a>`).join(', '):'';
 };
 const load=async()=>{
  const token=++generation;sh.querySelector('[data-git-diff]').replaceChildren();const btn=sh.querySelector('[data-git-refresh]');btn.disabled=true;
  try{
   await readFolders();if(!sh.isConnected||token!==generation)return;
   const d=await api(gitPath('/workspace'));if(!sh.isConnected||token!==generation)return;
   sh.querySelector('[data-git-title]').textContent=folder?'Working in '+shortName(folder)+' · '+d.branch:'Git workspace';
   sh.querySelector('[data-git-status]').textContent=(folder?'':d.branch+' · ')+d.total+' changed '+(d.total===1?'file':'files')+' · '+new Date(d.checkedAt).toLocaleTimeString();
   sh.querySelector('[data-git-files]').innerHTML=d.files.map((f,i)=>`<button class="git-file" data-git-file="${i}" ${f.inspectable?'':'disabled'}><code>${esc(f.status)}</code><span>${esc(f.path)}${!f.inspectable?' · Preview unavailable':''}</span></button>`).join('')+(d.limited?'<p class="sheet-help">Showing the first 250 files.</p>':'');
   sh.querySelectorAll('[data-git-file]').forEach(b=>b.onclick=()=>showDiff(d.files[Number(b.dataset.gitFile)],'working'));
  }catch(e){if(sh.isConnected){sh.querySelector('[data-git-status]').textContent=e.message;sh.querySelector('[data-git-files]').replaceChildren();}}
  finally{btn.disabled=false;}
 };
 const showDiff=async(file,scope)=>{
  const token=++generation,target=sh.querySelector('[data-git-diff]');target.innerHTML=`<h3>${esc(file.path)}</h3><div class="git-scopes"><button class="chip" data-scope="working" aria-pressed="${scope==='working'}">Working tree</button><button class="chip" data-scope="staged" aria-pressed="${scope==='staged'}">Staged</button></div><pre tabindex="0" aria-label="File diff">Loading diff…</pre>`;
  target.querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>showDiff(file,b.dataset.scope));
  try{const d=await api(gitPath('/workspace/diff','?path='+encodeURIComponent(file.path)+'&scope='+scope));if(sh.isConnected&&token===generation)target.querySelector('pre').textContent=d.text;}
  catch(e){if(sh.isConnected&&token===generation)target.querySelector('pre').textContent=e.message;}
 };
 sh.querySelector('[data-git-folder]').onchange=e=>{folder=e.target.value;load();};
 sh.querySelector('[data-git-refresh]').onclick=load;await load();
}
function keyboardHelp(){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet';
 sh.innerHTML='<h2>Keyboard shortcuts</h2><dl class="shortcut-list"><dt>Ctrl / ⌘ K</dt><dd>Find a conversation</dd><dt>Ctrl / ⌘ Shift L</dt><dd>Start a conversation</dd><dt>Alt [ / Alt ]</dt><dd>Previous / next open conversation</dd><dt>Ctrl / ⌘ F</dt><dd>Find in the conversation</dd><dt>Ctrl / ⌘ ;</dt><dd>Open or close the side chat</dd><dt>Enter</dt><dd>Send, or start a conversation, in a window at least 900 px wide. On a narrower one it adds a line, and the send button sends</dd><dt>Shift Enter</dt><dd>Add a line</dd><dt>Escape</dt><dd>Close a dialog or search</dd></dl><p class="sheet-help">Open-conversation tabs and workspace filters are saved on this device. Closing a tab never stops an agent or deletes its conversation.</p>';
 mountSheet(scrim,sh);
}
document.addEventListener('keydown',e=>{
 if(!document.getElementById('app')?.querySelector('[data-session-search],#box,#first'))return;
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openSessionSwitcher();return;}
 if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='l'){e.preventDefault();openFreshNew();return;}
 const openId=chatId||currentView();
 if(e.altKey&&['[',']'].includes(e.key)&&openId&&!closeCurrentSheet){const shown=orderedOpenSessions(),index=shown.findIndex(s=>s.id===openId),next=shown[(index+(e.key===']'?1:-1)+shown.length)%shown.length];if(next){e.preventDefault();location.hash=tabHref(next.id);}}
});

const SKIP_PH='Answer above, or type here to skip the questions…';
async function refreshQuestions(id){
 try{const d=await api('/session/'+encodeURIComponent(id)+'/questions');if(chatId!==id)return;const b=$('#questions-open');if(b){
  const who=String(id).startsWith('cx:')?'Codex':String(id).startsWith('acp:')?'OpenRouter':'Claude',n=d.requests.reduce((t,r)=>t+(r.questions?.length||1),0);
  b.hidden=!d.requests.length&&!d.interrupted;
  // 1.76.1: typing instead of answering skips a blocking question (the server declines it), so the box says so
  const box=$('#box'),skip=!d.interrupted&&d.requests.some(r=>r.blocking!==false)&&sendModes.get(id)!=='queue';
  if(box){if(box.dataset.basePh===undefined)box.dataset.basePh=box.placeholder;box.placeholder=skip?SKIP_PH:box.dataset.basePh;}
  // 1.82: one question with a few options answers from the banner; Answer still opens the form (a typed answer, the
  // options' descriptions). Several questions, a multiple-choice or secret one, or more than four options use the form.
  const one=!d.interrupted&&d.requests.length===1&&d.requests[0].questions?.length===1?d.requests[0]:null,q=one?.questions[0];
  const paused=d.requests.some(r=>r.blocking!==false);
  if(q&&!q.multiple&&!q.isSecret&&q.options.length>=1&&q.options.length<=4)
   paintWaitBanner(b,{title:q.question,agent:one.agent||'',note:(paused?'The reply is paused until you answer. ':who+' keeps working while it waits. ')+'Pick one, or Answer to write your own.',cta:'Answer',
    actions:q.options.map(o=>({label:o.label,title:o.description,run:()=>answerFromBanner(id,one,q,o.label,b)}))});
  else paintWaitBanner(b,d.interrupted?{title:'Question interrupted',note:'The server restarted while '+who+' was waiting for your answer.',cta:'Review'}
   :{title:who+(n===1?' has a question for you':' has '+n+' questions for you'),agent:d.requests.every(r=>r.agent)?[...new Set(d.requests.map(r=>r.agent))].join(', '):'',note:paused?'The reply is paused until you answer.':who+' keeps working while it waits.',cta:n===1?'Answer':'Answer all'});}}
 catch{if(chatId===id&&$('#questions-open')&&!$('#questions-open').hidden)paintWaitBanner($('#questions-open'),{title:'Question status unavailable',cta:'Retry'});}
}
async function answerFromBanner(id,r,q,label,banner){
 waitBannerBusy(banner,'Sending your answer…');
 try{await api('/session/'+encodeURIComponent(id)+'/questions/'+encodeURIComponent(r.id)+'/answer',{method:'POST',body:JSON.stringify({answers:{[q.id]:[label]}})});toast('Answer sent.');}
 catch(e){toast(e.message);}
 refreshQuestions(id);refreshSessions();
}
async function openQuestions(id){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet question-sheet';sh.innerHTML='<h2>Agent questions</h2><div data-questions role="status">Loading…</div>';mountSheet(scrim,sh);
 try{
  const d=await api('/session/'+encodeURIComponent(id)+'/questions');if(!sh.isConnected)return;
  const target=sh.querySelector('[data-questions]');
  if(d.interrupted){target.innerHTML='<p class="sheet-help">The server restarted while Claude was waiting for an answer. The original question connection cannot be resumed. Stop this reply, then send your answer as a new message after reviewing the conversation.</p><button class="chip" data-stop-question>Stop interrupted reply</button>';target.querySelector('[data-stop-question]').onclick=async e=>{e.target.disabled=true;try{await api('/session/'+encodeURIComponent(id)+'/stop',{method:'POST',body:'{}'});closeCurrentSheet?.();toast('Stop requested. Send your answer after the reply stops.');}catch(err){toast(err.message);e.target.disabled=false;}};return;}
  if(!d.requests.length){target.textContent=d.supported?'No questions are waiting.':'Native questions are unavailable for this conversation.';return;}
  target.innerHTML='';
  for(const r of d.requests){
   const form=document.createElement('form');form.className='question-form';
   form.innerHTML=(r.agent?`<p class="approval-agent">From subagent: ${esc(r.agent)}</p>`:'')+r.questions.map((q,i)=>`<fieldset><legend>${esc(q.question)}</legend>${q.options.map((o,j)=>`<label class="question-option"><input type="${q.multiple?'checkbox':'radio'}" name="q${i}" value="${j}"><span>${esc(o.label)}<small>${esc(o.description)}</small></span></label>`).join('')}<label class="question-custom">${q.options.length?'Or write an answer':'Your answer'}<input type="${q.isSecret?'password':'text'}" data-answer="${i}" autocomplete="off" maxlength="10000"></label></fieldset>`).join('')+'<p class="question-error" role="status"></p><button class="primary" type="submit">Send answers</button>';
   form.onsubmit=async e=>{
    e.preventDefault();const answers=Object.create(null),error=form.querySelector('.question-error'),b=form.querySelector('[type=submit]');
    for(let i=0;i<r.questions.length;i++){const q=r.questions[i],typed=form.querySelector(`[data-answer="${i}"]`).value.trim(),selected=[...form.querySelectorAll(`[name="q${i}"]:checked`)];const values=typed?[typed]:selected.map(option=>q.options[Number(option.value)].label);if(!values.length){error.textContent='Answer each question before sending.';return;}answers[q.id]=values;}
    b.disabled=true;
    try{
     await api('/session/'+encodeURIComponent(id)+'/questions/'+r.id+'/answer',{method:'POST',body:JSON.stringify({answers})});
     form.innerHTML='<p>Answers sent to the agent.</p>';refreshQuestions(id);refreshSessions();
     // 1.82: the sheet closes itself once no question is left waiting.
     let left=null;try{left=await api('/session/'+encodeURIComponent(id)+'/questions');}catch{}
     if(sh.isConnected&&left&&!left.requests.length&&!left.interrupted){closeCurrentSheet?.();toast(r.questions.length===1?'Answer sent.':'Answers sent.');}
    }
    catch(err){error.textContent=err.message;b.disabled=false;}
   };
   target.append(form);
  }
 }catch(e){if(sh.isConnected)sh.querySelector('[data-questions]').textContent=e.message;}
}
// 1.53: Gmail, Calendar and Drive through each agent's own connectors (claude.ai connectors, ChatGPT apps).
// A first connection is made on claude.ai or chatgpt.com, which neither CLI can start; the sheet links
// there and checks again when this window comes back into focus.
const CONNECTOR_STATE={connected:'Connected','needs-auth':'Needs signing in again','not-connected':'Not connected',failed:'Could not connect',off:'Off on this server',unavailable:'Unavailable'};
function openConnectors(){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet';
 sh.innerHTML='<h2>Connectors</h2><p class="sheet-help">Each agent reaches Google through its own account: Claude Code through claude.ai connectors, Codex through ChatGPT apps. Connect once on that site with your Google account, then come back here. New conversations can then search and send mail, manage calendar events and work with Drive files.</p><div data-connectors role="status" aria-live="polite">Checking connectors…</div><p class="sheet-help">On Claude Team and Enterprise plans an admin adds connectors first. Conversations already open pick up a new connection when they restart.</p><button class="chip" data-connectors-refresh>Refresh status</button>';
 mountSheet(scrim,sh);
 const box=sh.querySelector('[data-connectors]'),again=sh.querySelector('[data-connectors-refresh]');
 let away=false,loading=false;
 const site=p=>p.provider==='codex'?'chatgpt.com':'claude.ai';
 const row=(p,c)=>{const open=['not-connected','needs-auth','failed'].includes(c.status);const href=p.provider==='codex'?c.connectUrl:p.manageUrl;
  return `<li class="connector-row"><span>${esc(c.label)}<span class="connector-state is-${esc(c.status)}">${esc(CONNECTOR_STATE[c.status]||c.status)}</span></span>${open&&href?`<a class="chip" href="${esc(href)}" target="_blank" rel="noopener noreferrer" data-connector-link aria-label="${esc((c.status==='not-connected'?'Connect ':'Reconnect ')+c.label+' for '+(p.provider==='codex'?'Codex':'Claude Code'))}">${c.status==='not-connected'?'Connect':'Reconnect'}</a>`:''}</li>`;};
 const draw=d=>{box.innerHTML=d.providers.map(p=>`<section class="provider-account"><h3>${p.provider==='codex'?'Codex':'Claude Code'}</h3>${p.available?`<ul class="connector-list">${p.items.map(c=>row(p,c)).join('')}</ul>${p.manageUrl?`<div class="provider-actions"><a class="chip" href="${esc(p.manageUrl)}" target="_blank" rel="noopener noreferrer" data-connector-link>Manage on ${site(p)}</a></div>`:''}`:`<p class="sheet-help">${esc(p.reason||'Unavailable.')}</p>`}</section>`).join('');
  box.querySelectorAll('[data-connector-link]').forEach(a=>a.addEventListener('click',()=>{away=true;}));};
 const load=async refresh=>{
  if(loading)return;loading=true;again.disabled=true;again.textContent='Checking…';
  if(refresh)box.setAttribute('aria-busy','true');
  try{const d=await api('/connectors'+(refresh?'?refresh=1':''));if(sh.isConnected)draw(d);}
  catch(e){if(sh.isConnected)box.textContent=e.message||'Could not check connectors. Try again.';}
  finally{loading=false;box.removeAttribute('aria-busy');again.disabled=false;again.textContent='Refresh status';}
 };
 const back=()=>{if(!sh.isConnected){removeEventListener('focus',back);document.removeEventListener('visibilitychange',back);return;}if(away&&document.visibilityState==='visible'){away=false;load(true);}};
 addEventListener('focus',back);document.addEventListener('visibilitychange',back);
 again.onclick=()=>load(true);
 load(false);
}
async function openEnvironment(){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet';sh.innerHTML='<h2>Accounts & instance</h2><div data-environment role="status">Checking provider sign-ins…</div>';mountSheet(scrim,sh);
 try{
  const d=await api('/environment');if(!sh.isConnected)return;
  const count=Number.isInteger(d.claudeActive)?d.claudeActive:0;
  sh.querySelector('[data-environment]').innerHTML=`<p class="sheet-help">${esc(d.host)} · Checked ${esc(new Date(d.checkedAt).toLocaleTimeString())}</p>${d.providers.map(p=>`<section class="provider-account"><h3>${p.provider==='codex'?'Codex':'Claude Code'}</h3><p>${esc(p.email||p.method)}</p><p class="sheet-help">${esc([p.plan,p.method].filter(Boolean).join(' · '))}${p.signedIn===false?' · Not signed in':p.signedIn===null?' · Could not verify':''}</p>${p.provider==='claude'?`<div class="provider-actions">${d.capabilities?.claudeLogin?`<button class="chip" data-claude-login>${p.signedIn?'Switch account':'Sign in'}</button>`:''}<button class="chip claude-stop" data-claude-stop ${count?'':'disabled'}>Stop all Claude replies</button></div><p class="sheet-help" data-claude-count aria-live="polite">${count} active Claude ${count===1?'reply':'replies'}</p><div class="claude-stop-confirm" data-claude-confirm hidden><p data-claude-stop-copy></p><div class="provider-actions"><button class="chip claude-stop" data-claude-stop-yes>Stop replies</button><button class="chip" data-claude-stop-no>Keep running</button></div></div><p class="question-error" data-claude-stop-error role="alert"></p>`:''}</section>`).join('')}<p class="sheet-help">${esc(d.accountManagement)}</p><h3>Conversation controls</h3><p class="sheet-help">${esc(d.permissions)}. Codex Plan first can show native agent questions. Plan mode guides behavior; it does not change server permissions. Claude can show native questions during owned replies.</p><p class="sheet-help">MemStem and other tools follow each agent’s server configuration.</p><button class="chip" data-env-refresh>Refresh status</button>`;
  sh.querySelector('[data-env-refresh]').onclick=openEnvironment;
  sh.querySelector('[data-claude-login]')?.addEventListener('click',openClaudeLogin);
  const stop=sh.querySelector('[data-claude-stop]'),confirm=sh.querySelector('[data-claude-confirm]');
  if(!stop)return;
  const countLine=sh.querySelector('[data-claude-count]'),error=sh.querySelector('[data-claude-stop-error]');
  let expected=count,stopping=false;
  const showCount=n=>{countLine.textContent=`${n} active Claude ${n===1?'reply':'replies'}`;stop.disabled=stopping||n===0;};
  stop.onclick=async()=>{
   stop.disabled=true;error.textContent='';
   try{
    const {active}=await api('/claude/activity');if(!sh.isConnected)return;
    expected=active;showCount(active);
    if(!active)return;
    confirm.hidden=false;stop.disabled=true;
    confirm.querySelector('[data-claude-stop-copy]').textContent=`Stop ${active} active Claude ${active===1?'reply':'replies'}? Work in those replies and their child processes will stop. Saved conversations remain. Codex replies and idle background jobs continue.`;
    const yes=confirm.querySelector('[data-claude-stop-yes]');yes.textContent=`Stop ${active} ${active===1?'reply':'replies'}`;yes.focus();
   }catch(problem){if(sh.isConnected){error.textContent=problem.message;stop.disabled=false;}}
  };
  confirm.querySelector('[data-claude-stop-no]').onclick=()=>{confirm.hidden=true;stop.disabled=false;stop.focus();};
  confirm.querySelector('[data-claude-stop-yes]').onclick=async()=>{
   const yes=confirm.querySelector('[data-claude-stop-yes]');yes.disabled=true;error.textContent='';
   try{
    const {stopping:requested}=await api('/claude/stop-all',{method:'POST',body:JSON.stringify({expected})});
    if(!sh.isConnected)return;
    confirm.hidden=true;stopping=true;stop.disabled=true;countLine.textContent=`Stopping ${requested} Claude ${requested===1?'reply':'replies'}…`;
    const poll=async()=>{
     if(!sh.isConnected)return;
     try{const {active}=await api('/claude/activity');if(!sh.isConnected)return;
      if(active){countLine.textContent=`Waiting for ${active} Claude ${active===1?'reply':'replies'} to stop…`;setTimeout(poll,750);}
      else{stopping=false;showCount(0);countLine.textContent='All Claude replies stopped. You can switch accounts now.';}
     }catch(problem){stopping=false;error.textContent=problem.message;stop.disabled=false;}
    };
    poll();
   }catch(problem){if(sh.isConnected){
    confirm.hidden=true;error.textContent=problem.message;
    try{const {active}=await api('/claude/activity');if(sh.isConnected){expected=active;showCount(active);}}
    catch{stop.disabled=false;}
   }}
   finally{yes.disabled=false;}
  };
 }
 catch(e){if(sh.isConnected)sh.querySelector('[data-environment]').textContent=e.message;}
}

async function openClaudeLogin(){
 const scrim=document.createElement('div');scrim.className='scrim';
 const sh=document.createElement('div');sh.className='sheet claude-login-sheet';
 sh.innerHTML='<h2>Claude Code sign-in</h2><p class="sheet-help">Changes the shared Claude login on this server, including code-server. Let current Claude replies finish first. Background jobs and Codex keep running; existing jobs may keep the earlier login.</p><p data-login-status role="status">Checking sign-in…</p><div data-login-controls></div><p class="question-error" data-login-error role="alert"></p>';
 mountSheet(scrim,sh);
 const controls=sh.querySelector('[data-login-controls]'),error=sh.querySelector('[data-login-error]');
 let current={status:'idle'},rendered='',pollTimer,busy=false,disconnected=false;
 const schedule=()=>{clearTimeout(pollTimer);if(sh.isConnected)pollTimer=setTimeout(refresh,1500);};
 const action=async(name,extra={})=>{
  if(busy)return;busy=true;error.textContent='';
  controls.querySelectorAll('button').forEach(button=>button.disabled=true);
  try{draw(await api('/claude/login/'+name,{method:'POST',body:JSON.stringify({id:current.id,...extra})}));}
  catch(problem){if(sh.isConnected)error.textContent=problem.message;}
  finally{busy=false;if(sh.isConnected)controls.querySelectorAll('button').forEach(button=>button.disabled=false);schedule();}
 };
 function draw(state){
  if(!sh.isConnected)return;
  current=state;sh.querySelector('[data-login-status]').textContent=state.message||'Sign in with your Claude subscription.';
  const key=(state.id||'')+':'+state.status;if(rendered===key)return;rendered=key;
  if(state.status==='waiting'){
   controls.innerHTML=`<p class="sheet-help">Open Claude, switch to the account you want, and authorize Claude Code. Return here with the code. This link expires after 10 minutes.</p><div class="login-actions"><a class="chip" data-login-link href="${esc(state.url)}" target="_blank" rel="noopener noreferrer">Open Claude sign-in</a><button class="chip" data-login-copy>Copy link</button></div><form data-login-form><label for="claude-login-code">Code from Claude</label><input id="claude-login-code" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required maxlength="4096" aria-describedby="claude-code-help"><p class="sheet-help" id="claude-code-help">Paste the code here, including any # suffix. It is sent directly to the sign-in process and is not saved in a conversation.</p><button class="primary" type="submit">Finish sign-in</button></form><button class="chip" data-login-cancel>Cancel sign-in</button>`;
   controls.querySelector('[data-login-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(state.url);toast('Sign-in link copied');}catch{error.textContent='Could not copy. Use Open Claude sign-in.';}};
   controls.querySelector('form').onsubmit=event=>{event.preventDefault();const input=controls.querySelector('input'),code=input.value;input.value='';action('code',{code});};
  }else if(state.status==='starting'||state.status==='verifying'){
   controls.innerHTML='<p class="sheet-help">You can return to Accounts & instance if you close this window.</p><button class="chip" data-login-cancel>Cancel sign-in</button>';
  }else if(state.status==='success'){
   controls.innerHTML=`<p class="login-account">${esc(state.account?.email||'Account verified')}</p><p class="sheet-help">New Claude conversations use this login. Existing background jobs keep running; their conversations refresh the login after those jobs finish. Reopen other Claude processes to use the new account there.</p><button class="chip" data-login-done>Back to accounts</button><button class="chip" data-login-start>Switch again</button>`;
   controls.querySelector('[data-login-done]').onclick=openEnvironment;
  }else{
   controls.innerHTML='<p class="sheet-help">You’ll get a link to open in your browser. Choose the Claude account you want, then return here to paste its code.</p><button class="primary" data-login-start>Get sign-in link</button><button class="chip" data-login-done>Back to accounts</button>';
   controls.querySelector('[data-login-done]').onclick=openEnvironment;
  }
  controls.querySelector('[data-login-start]')?.addEventListener('click',()=>action('start'));
  controls.querySelector('[data-login-cancel]')?.addEventListener('click',()=>action('cancel'));
 }
 async function refresh(){
  if(!sh.isConnected)return;if(busy){schedule();return;}
  try{const state=await api('/claude/login');if(!busy){draw(state);if(disconnected)error.textContent='';disconnected=false;}}
  catch(problem){disconnected=true;if(sh.isConnected)error.textContent='Could not check sign-in. Reconnecting…';}
  if(['starting','waiting','verifying'].includes(current.status)||disconnected)schedule();
 }
 await refresh();
}

matchMedia('(min-width: 1280px)').addEventListener('change',()=>{
 if(!hasDockRoom()&&dockSurface?.isConnected){
  const sh=dockSurface;dockSurface=null;sh.remove();sh.classList.remove('workspace-dock');sh.classList.add('sheet');sh.querySelector('.dock-tabs')?.remove();
  const scrim=document.createElement('div');scrim.className='scrim';mountSheet(scrim,sh);
 }
});


// Keep the same conversation DOM, draft and selection while the viewport changes.
function sizeComposerBox(){
 const box=document.getElementById('box')||document.getElementById('first');if(!box)return; // 1.58: New session uses the same composer
 const limit=Math.min(innerHeight<500?90:180,innerHeight*.25);
 box.style.height='auto';box.style.height=Math.max(46,Math.min(box.scrollHeight+2,limit))+'px';
}
let viewportFrame;
function syncViewport(){
 cancelAnimationFrame(viewportFrame);
 viewportFrame=requestAnimationFrame(()=>{
  const viewport=window.visualViewport;
  // 1.66: only on touch screens, where the keyboard and the home indicator shrink the visible area; a desktop keeps
  // the browser's own height, which never lags a frame behind a window resize.
  if(window===window.top&&viewport&&viewport.scale===1&&matchMedia('(pointer: coarse)').matches)document.documentElement.style.setProperty('--app-height',Math.min(innerHeight,viewport.height)+'px');
  else document.documentElement.style.removeProperty('--app-height');
  sizeComposerBox();
 });
}
window.addEventListener('resize',syncViewport);
window.addEventListener('orientationchange',syncViewport);
window.addEventListener('pageshow',syncViewport);
window.visualViewport?.addEventListener('resize',syncViewport);
syncViewport();

/* Shared navigation and recovery for Projects and Documents. */
let visibleRoute = null, returningToView = false;
const viewPositions = new Map(), viewOrigins = new Map();
function rememberViewNavigation(next) {
 const main = document.querySelector('main.scroll');
 if (visibleRoute && main) viewPositions.set(visibleRoute, {top:main.scrollTop, details:[...main.querySelectorAll('details')].map(d=>d.open)});
 if (next !== visibleRoute) {
  // Browser Back/Forward revisits an entry's original parent instead of inventing
  // a reverse relationship between two detail pages.
  const saved=history.state?.pocketViewNavigation;
  const origin=saved?.route===next?saved.origin:returningToView?viewOrigins.get(next):visibleRoute;
  if (/^#\/(projects\/(?!scheduled$)|documents\/|link\/)/.test(next)) { // 1.54: Back from a linked page returns to the conversation it was clicked in
   if(origin&&origin!==next)viewOrigins.set(next,origin);else viewOrigins.delete(next);
  }
  history.replaceState({...history.state,pocketViewNavigation:{route:next,origin:origin||null}},'');
 }
 for(const cache of [viewPositions,viewOrigins])while(cache.size>128)cache.delete(cache.keys().next().value);
 visibleRoute = next; returningToView = false;
}
function viewBackTarget(view) {
 return viewOrigins.get('#/'+view) || (view.startsWith('documents/') ? '#/documents' : view.startsWith('projects/') ? '#/projects' : '#/');
}
function bindViewBack(button, view) {
 const target=viewBackTarget(view),label=target==='#/documents'?'Back to Files':target==='#/projects'?'Back to Projects':target==='#/projects/scheduled'?'Back to Scheduled':target.startsWith('#/chat/')?'Back to conversation':target==='#/'?'Back to Conversations':'Back to previous view';
 button.setAttribute('aria-label',label);button.title=label;
 button.onclick=()=>{returningToView=true;location.hash=target;};
}
function restoreViewPosition(view) {
 const state=viewPositions.get('#/'+view),main=document.querySelector('main.scroll');if(!state||!main)return;
 main.querySelectorAll('details').forEach((d,i)=>{if(state.details[i]!==undefined)d.open=state.details[i];});main.scrollTop=state.top;
}
// 1.81 (#175): where an "is off" message sends you. Assistant mode has no Projects, files, tasks & vault category, its switches
// are in Settings → Features, and a locked Pocket (POCKET_ASSISTANT_MODE=locked) leaves them to the person who runs the install.
const featuresLocked=()=>Boolean(window.pocketFeatures?.assistantLocked);
function turnOnHint(){return featuresLocked()?'Ask the person who runs this install to turn it on.':assistantMode()?'Turn it on in Settings → Features.':'Turn it on in Settings → Projects, files, tasks & vault.';}
function showLibraryError(main,error,label,retry,hasData) {
 const panel=document.createElement('div');panel.className='library-error';panel.setAttribute('role','status');
 const off=error.status===404;
 panel.innerHTML=`<p>${esc(off?label+' is off. '+turnOnHint():label+' could not load. '+(hasData?'Showing the last loaded data.':'')+' '+(error.message||'Try again.'))}</p><button class="chip" data-library-retry>Retry</button>${off&&!featuresLocked()?'<button class="chip" data-library-settings>Open Settings</button>':''}`;
 if(!hasData)main.replaceChildren();main.prepend(panel);
 panel.querySelector('[data-library-settings]')?.addEventListener('click',()=>settingsSheet({category:assistantMode()?'features':'libraries'}));
 panel.querySelector('[data-library-retry]').onclick=async e=>{e.currentTarget.disabled=true;e.currentTarget.textContent='Retrying…';await retry();const again=document.querySelector('[data-library-retry]');if(again)again.focus();else{document.getElementById(main.id)?.focus();toast(label+' loaded');}};
}
function bindRailNavigation() {
 const group=document.querySelector('.rail-switch');if(!group)return;
 group.onkeydown=e=>{const items=[...group.querySelectorAll('button')],i=items.indexOf(document.activeElement);if(i<0||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  e.preventDefault();const target=items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowRight'?1:-1)+items.length)%items.length];target.focus();
  if(target.dataset.railView!=='documents'||filesButtonOpens()==='rail')target.click();}; // arrowing onto a Files button that opens the library only focuses it
}
// 1.35: the collapsed setup names the model and reasoning level, so you see what will run without opening it.
function agentSummary(){
 const model=tbLabel(modelList(),tb.prefs.model);
 // the ACP/OpenRouter engine has no reasoning-effort setting, so the summary omits it
 const effort=tb.provider==='acp'&&effortList().length<2?'':(tbLabel(effortList(),tb.prefs.effort)==='Default'?'default reasoning':tbLabel(effortList(),tb.prefs.effort)+' reasoning');
 return [tb.provider==='codex'?'Codex':tb.provider==='acp'?'OpenRouter':'Claude Code',model==='Default'?'':model,effort].filter(Boolean).join(' · ');
}
function updateNewSummary() {
 const el=document.querySelector('#task-context');if(!el||!tb)return;
 el.innerHTML=`<span><strong>Workspace</strong> ${esc(el.dataset.workspace||'Choose a workspace')}</span><span><strong>Agent</strong> ${esc(agentSummary())}</span><span><strong>Permissions</strong> ${esc(permissionLabel(nextApprovalMode()))}</span>`;
}
function organizeSettings(sh, {category='',scrollTop=0}={}) {
 // 1.60: Assistant mode shows the settings a person needs day to day; everything else stays as it is, hidden.
 const groups=assistantMode()?[
  ['appearance','Appearance','Light, dark, text size and highlight colour', [['This device','.chat-text-settings'],['This Pocket · all devices','#s-mode']]],
  ['conversation','Conversation','How replies and steps read', [['This device','#s-tools,#s-times']]],
  ['accounts','Accounts','Your Claude sign-in and Gmail, Calendar and Drive', [['','#s-environment,#s-connectors']]],
  // 1.81 (#175): the switches the Developer category holds, for the seats that can change them; a locked Pocket gets a line saying what is on.
  featuresLocked()
   ?['features','Features','Which parts of Pocket are on', [['','#s-features-lead']]]
   :['features','Features','Projects, Files, Tasks, Inbox Watch, Vault and automatic model choice', [['','#s-features-lead,#s-projects,#s-documents,#s-tasks,#s-inbox,#s-inbox-watch,#s-vault'],['','#s-router']]],
  ['notifications','Notifications & voice','Sounds, alerts on this device, reminders by email and spoken replies', [['This device','#s-chime,#s-push,#s-push-kinds,#s-badge,#s-voice'],['This Pocket · all devices','#s-ahead,#s-email-wrap']]],
  ['help','Help & updates','Version and what’s new', [['','#s-about,#s-notes']]],
 ]:[
  ['appearance','Appearance','Light, dark, text size and highlight colour', [['This device','.chat-text-settings'],['This instance · all devices','#s-mode']]],
  ['conversation','Conversation','Reading, conversation titles and summaries', [['This device','#s-tools,#s-plain,#s-times'],['This instance · all devices','#s-sync,#s-sync-retry,#s-titles,#s-live,#s-away','#s-title-model']]],
  ['agents','Agents & instance','Accounts, connectors, plan usage, models, context and subagents, automatic model choice, actions that run without asking and sign-in', [['This instance · all devices','#s-environment,#s-connectors,#s-usage,#s-models,#s-context,#s-trusted,#s-router,#s-access']]],
  ['libraries','Projects, files, tasks & vault','Tools and how they open', [['This instance · all devices','#s-projects,#s-documents,#s-autokeep,#s-tasks,#s-inbox,#s-inbox-watch,#s-vault,#s-vault-more'],['This device','', '#s-projects-open,#s-files-button,#s-documents-open']]],
  ['notifications','Notifications & voice','Chime, push, the icon count, email and spoken replies', [['This device','#s-chime,#s-push,#s-push-kinds,#s-badge,#s-voice'],['This instance · all devices','#s-ahead,#s-email-wrap']]],
  ['help','Help & updates','Keyboard shortcuts, version and feedback', [['','#s-keys,#s-about,#s-notes,#s-feedback']]],
 ];
 const heading=sh.querySelector('h2'),index=document.createElement('div');index.className='settings-index';
 const back=document.createElement('button');back.className='chip sheet-back';back.id='settings-back';back.innerHTML=IC.back+'All settings';back.hidden=true;heading.before(back);
 const panels=new Map(),positions=new Map();let current='';
 for(const [key,title,description,sections] of groups){
  const panel=document.createElement('section');panel.dataset.settingsPanel=key;panel.hidden=true;panel.setAttribute('aria-label',title);
  for(const [scope,selector,fieldSelector] of sections){
   const nodes=[...(selector?sh.querySelectorAll(selector):[]),...(fieldSelector?[...sh.querySelectorAll(fieldSelector)].map(e=>e.closest('.title-settings')):[])].filter(Boolean);
   if(scope){const h=document.createElement('h3');h.className='settings-scope';h.textContent=scope;panel.append(h);}
   nodes.forEach(n=>panel.append(n));
  }
  panels.set(key,panel);sh.append(panel);
  const button=document.createElement('button');button.className='opt';button.dataset.settingsCategory=key;button.innerHTML=`<span>${esc(title)}<span class="sub">${esc(description)}</span></span>${IC.back}`;button.onclick=()=>select(key);index.append(button);
 }
 sh.querySelector('.settings-group')?.remove();heading.after(index);
 if(assistantMode())for(const el of [...sh.children])if(el!==heading&&el!==index&&el!==back&&!el.dataset.settingsPanel)el.classList.add('settings-assistant-hidden');
 function select(key,initial=false){
  positions.set(current,sh.scrollTop);current=panels.has(key)?key:'';
  heading.textContent=groups.find(g=>g[0]===current)?.[1]||'Settings';index.hidden=Boolean(current);back.hidden=!current;
  for(const [k,p] of panels)p.hidden=k!==current;
  sh.scrollTop=positions.get(current)||0;
  if(!initial)(current?back:index.querySelector(`[data-settings-category="${key||sh.dataset.lastCategory||'appearance'}"]`))?.focus({preventScroll:true});
  if(current)sh.dataset.lastCategory=current;
 }
 back.onclick=()=>select('');
 Object.defineProperty(sh,'_settingsReturn',{get(){const key=current,top=sh.scrollTop;return()=>settingsSheet({category:key,scrollTop:top});}});
 select(category,true);requestAnimationFrame(()=>{if(sh.isConnected)sh.scrollTop=scrollTop;});
}
// 1.44.1: Projects, Files and Tasks catch up without a reload. A list registers its refresh here; it runs when this
// window comes back into view or focus, and when a turn ends in any Pocket window on this device (a pane, a window of
// its own, another tab), since an agent's pocket-board / pocket-docs / pocket-tasks change most often lands mid-turn.
const listRefreshers=[];
const listsChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('pocket-lists'):null;
function onListsStale(fn){listRefreshers.push(fn);}
function refreshLists(){for(const fn of listRefreshers)try{fn();}catch{}}
function announceListsStale(){refreshLists();try{listsChannel?.postMessage('stale');}catch{}}
if(listsChannel)listsChannel.onmessage=()=>refreshLists();
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshLists();});
addEventListener('focus',refreshLists);

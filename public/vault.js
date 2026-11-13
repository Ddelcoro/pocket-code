/* Vault (1.39): secrets agents use without seeing. Off until Settings → Projects, files, tasks & vault turns it on
   (window.pocketFeatures.vault), and it can only be turned on once POCKET_VAULT_KEY is set. One view, the list (#/vault,
   and #/vault/requests from a push; 1.93: #/vault/item/<name> and #/vault/request/<id> open the list at one secret or one request), which opens like Tasks: as a tab, beside a conversation, in a window of its own, or
   full-screen on the phone. The list never carries a value: a value is fetched one field at a time when the owner taps
   Show, lives only in that sheet's DOM, and is wiped when the sheet closes or the app is hidden. Nothing here writes a
   value to storage, a draft, a toast or the console. Data comes from /api/vault; every change goes through
   /api/vault/act. Names, commands, notes and session titles are written by agents: always esc() them. */
const vaultOn=()=>Boolean(window.pocketFeatures?.vault);
let vaultSnap=null,vaultAt=0,vaultLoading=null,vaultView=null,vaultPainted='';
// Icons drawn in the app's stroke (IC lives in app.js, which loads after this file).
const VIC={
 key:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15.5" r="4"/><path d="M11 12.5l8.5-8.5M16.5 7l2.5 2.5M14 9.5l2 2"/></svg>',
 token:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="7" width="17" height="10" rx="2.5"/><path d="M8 12h.01M12 12h.01M16 12h.01" stroke-width="2.6"/></svg>',
 login:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>',
 note:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 15.5h5"/></svg>',
 lock:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/></svg>',
 download:'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/></svg>',
};
const VAULT_KINDS=[['api_key','API key'],['token','Token'],['login','Login'],['credentials','Credentials'],['note','Secure note']];
const VAULT_KIND_WORD=Object.fromEntries(VAULT_KINDS);
const VAULT_KIND_SUB={credentials:'Any set of named fields, such as a client ID and secret'};
// Each kind's fixed fields. Any item may also carry up to 20 custom fields (item.custom); Credentials has only those.
const VAULT_FIELDS={api_key:['value'],token:['value'],login:['username','password'],credentials:[],note:['text']};
const VAULT_FIELD_RE=/^[a-z][a-z0-9_]{0,31}$/,VAULT_CUSTOM_MAX=20;
const vaultFixedFields=kind=>VAULT_FIELDS[kind]||['value'];
// A fixed field reads as a word; a custom field is its own name.
const vaultFieldWord=(kind,f)=>!vaultFixedFields(kind).includes(f)?f:f==='value'?(kind==='token'?'Token':'Key'):f==='username'?'Username':f==='password'?'Password':'Note';
const vaultKindIcon=kind=>VIC[kind==='api_key'||kind==='credentials'?'key':kind]||VIC.lock;
// 1.41: Agent access is the install-wide dial (Settings → Vault); an item follows it ('default') or sets its own policy.
// The server sends each item's effectivePolicy and policyWord; the fallbacks here only cover a snapshot without them.
const VAULT_ACCESS=[['free','Free rein','Agents use any secret by name without asking. Values still never enter the conversation, and every use is recorded.'],
 ['once','Ask once per command','A new command needs your approval once; approved commands are remembered.'],
 ['every','Ask every time','Every use needs your approval, from the notification or in the conversation.']];
const VAULT_ACCESS_POLICY={free:'auto',once:'ask',every:'every'};
const VAULT_POLICY={auto:['Free rein','Agents use it without asking. Every use is recorded'],ask:['Ask once per command','A new command needs your approval once; approved commands are remembered'],
 every:['Ask every time','Every use needs your approval, from the notification or in the conversation'],owner:['Only you','Agents cannot use it']};
const VAULT_POLICY_WORD={auto:'Free rein',ask:'Asks once per command',every:'Asks every time',owner:'Only you'};
let vaultAccess=null; // from /api/settings when Settings has loaded it; the snapshot's access wins once the list has loaded
const vaultAccessNow=()=>VAULT_ACCESS_POLICY[vaultSnap?.access]?vaultSnap.access:VAULT_ACCESS_POLICY[vaultAccess]?vaultAccess:'once';
const vaultAccessWord=a=>(VAULT_ACCESS.find(([v])=>v===a)||VAULT_ACCESS[1])[1];
const vaultEff=i=>VAULT_POLICY[i.effectivePolicy]?i.effectivePolicy:!i.policy||i.policy==='default'?VAULT_ACCESS_POLICY[vaultAccessNow()]:VAULT_POLICY[i.policy]?i.policy:'ask';
const vaultPolicyWord=i=>i.policyWord||VAULT_POLICY_WORD[vaultEff(i)];
const vaultOwnPolicy=i=>Boolean(i.policy)&&i.policy!=='default';
// The five choices for an item, the first naming what the Vault default is now.
const vaultPolicyChoices=()=>[['default',`Vault default (currently: ${vaultAccessWord(vaultAccessNow())})`,'Follows Agent access in Settings → Vault'],...Object.entries(VAULT_POLICY).map(([v,[l,sub]])=>[v,l,sub])];
// Settings saved a new Agent access: the items that follow it change, so reload them.
function vaultSetAccess(a){vaultAccess=a;if(vaultSnap){vaultSnap.access=a;loadVault(true).then(repaintVault).catch(()=>{});}}
const VAULT_NAME_RE=/^[a-z0-9-]{1,64}$/;
const vaultItemById=id=>vaultSnap?.items.find(i=>i.id===id)||vaultSnap?.trash.find(i=>i.id===id)||null;
const vaultTime=v=>typeof v==='number'?v:Date.parse(v);
const vaultHost=u=>{try{const x=new URL(u);return /^https?:$/.test(x.protocol)?x.host:'';}catch{return '';}};
const vaultSafeUrl=u=>vaultHost(u)?u:''; // only http(s) becomes a link; anything else (javascript:, data:) stays text
const vaultDate=iso=>{const d=new Date(iso);return d.toLocaleDateString('en-US',{month:'short',day:'numeric',...(d.getFullYear()===new Date().getFullYear()?{}:{year:'numeric'})});};
const vaultExpired=i=>Boolean(i.expiresAt)&&Date.parse(i.expiresAt)<=Date.now();
// 1.43: a browser fill by pocket-mcp-proxy is recorded as pocket-fill <server> <tool>; say it in words.
const vaultCmd=argv=>Array.isArray(argv)?(argv[0]==='pocket-fill'&&argv.length===3?`Fill into the ${argv[1]} tool (${argv[2]})`:argv.join(' ')):String(argv||'');
// A run can bind several secrets: the server lists them as itemNames (itemName is accepted too).
const vaultRequestNames=r=>Array.isArray(r.itemNames)&&r.itemNames.length?r.itemNames.join(', '):r.itemName||'';
const vaultRequests=()=>(vaultSnap?.requests||[]).filter(r=>!r.answer&&!(r.expiresAt&&Date.parse(r.expiresAt)<=Date.now()));
const vaultRequestCount=()=>vaultRequests().length;
const vaultViewTitle=()=>'Vault';
/* 1.93 (Damon): finding a secret. A search box over the list, newest first (or A–Z, remembered on this device), a New mark
   for a day, and links that open one secret or one request. A link's address is put back to #/vault, so there is one Vault
   tab whatever was linked; the target is kept in localStorage for five minutes, so a Vault that opens in a pane, a window of
   its own or after signing in finds it too, and a Vault already open in a pane or window hears of it from the storage event. */
let vaultQuery='',vaultFocusMem=null,vaultNotice='';
const vaultMissed=new Map(); // request id -> why the notification's answer did not land; shown on its card until answered
const VAULT_NEW_MS=24*3600e3,VAULT_FOCUS_KEY='pc-vault-focus',VAULT_FOCUS_TTL=5*60e3,VAULT_ORDER_KEY='pc-vault-order';
const vaultOrder=()=>{try{return localStorage.getItem(VAULT_ORDER_KEY)==='name'?'name':'new';}catch{return 'new';}};
function vaultSetOrder(v){try{localStorage.setItem(VAULT_ORDER_KEY,v==='name'?'name':'new');}catch{}}
// Newest first: created is to the second, so two stored in the same second keep the store's order (it appends), later first.
const vaultSorted=items=>items.map((i,n)=>[i,n]).sort(vaultOrder()==='name'?([a],[b])=>a.name.localeCompare(b.name):([a,x],[b,y])=>(vaultTime(b.created)||0)-(vaultTime(a.created)||0)||y-x).map(([i])=>i);
const vaultIsNew=i=>Date.now()-(vaultTime(i.created)||0)<VAULT_NEW_MS;
const vaultSearchText=i=>[i.name,VAULT_KIND_WORD[i.kind]||'',...(i.tags||[]),vaultHost(i.url),i.addedIn?.sessionTitle||''].join(' ').toLowerCase();
const vaultMatches=(i,q)=>q.split(/\s+/).filter(Boolean).every(w=>vaultSearchText(i).includes(w));
const vaultItemHref=name=>location.origin+'/#/vault/item/'+encodeURIComponent(name);
// #/vault/item/<name>, #/vault/request/<id>[?missed=<why>&tap=allow|deny] (a notification answer that did not land), #/vault/requests.
function vaultFocusOf(hash){
 if(hash==='#/vault/requests')return {requests:true};
 const m=/^#\/vault\/(item|request)\/([^?]+)(?:\?(.*))?$/.exec(hash||'');if(!m)return null;
 let v='';try{v=decodeURIComponent(m[2]);}catch{return null;}
 if(m[1]==='item')return VAULT_NAME_RE.test(v)?{item:v}:null;
 const q=new URLSearchParams(m[3]||''),missed=q.get('missed')||'',tap=q.get('tap')==='deny'?'deny':'allow';
 return /^[A-Za-z0-9_-]{1,40}$/.test(v)?{request:v,...(missed?{missed,tap}:{})}:null;
}
function vaultSetFocus(f){try{localStorage.setItem(VAULT_FOCUS_KEY,JSON.stringify({...f,at:Date.now()}));vaultFocusMem=null;}catch{vaultFocusMem=f;}}
function vaultTakeFocus(){
 let f=vaultFocusMem;vaultFocusMem=null;
 try{const raw=localStorage.getItem(VAULT_FOCUS_KEY);if(raw){localStorage.removeItem(VAULT_FOCUS_KEY);const s=JSON.parse(raw);if(!f&&s&&Date.now()-s.at<VAULT_FOCUS_TTL)f=s;}}catch{}
 return f;
}
// A link in a conversation to one secret or request: the Vault opens the way Settings → Open files and links says, at it.
function openVaultLink(f){
 if(!vaultOn()){toast('The Vault is off. '+turnOnHint());return;}
 vaultSetFocus(f);
 if(vaultView&&$('#vault-main'))return vaultApplyFocus(vaultTakeFocus());
 openIdPreferred('vault','pc-documents-open');
}
window.addEventListener('storage',e=>{if(e.key===VAULT_FOCUS_KEY&&e.newValue&&vaultView&&vaultSnap&&document.visibilityState==='visible')vaultApplyFocus(vaultTakeFocus());});
const VAULT_MISSED_WHY={signin:'this device was signed out of Pocket',locked:'the Vault was locked',offline:'the device could not reach Pocket',gone:'the request was no longer waiting',error:'Pocket could not record it'};
const vaultMissedLine=(why,tap)=>`Your ${tap==='deny'?'Deny':'Allow'} from the notification didn’t go through: ${VAULT_MISSED_WHY[why]||VAULT_MISSED_WHY.error}.`;
function vaultFlash(el){
 if(!el)return;el.classList.remove('vault-flash');void el.offsetWidth;el.classList.add('vault-flash');
 el.scrollIntoView({block:'center',behavior:'auto'});setTimeout(()=>el.classList.remove('vault-flash'),2600);
}
function vaultApplyFocus(f){
 const main=$('#vault-main');if(!f||!main||!vaultSnap||vaultIsLocked())return;
 if(f.requests){const req=$('#vault-requests');if(req){req.scrollIntoView({block:'start'});req.querySelector('h2')?.focus({preventScroll:true});}return;}
 if(f.item){
  const i=vaultSnap.items.find(x=>x.name===f.item);
  if(!i){toast(vaultSnap.trash.some(x=>x.name===f.item)?f.item+' was removed. It is under Removed for 30 days.':'There is no secret named '+f.item+' in the Vault.');return;}
  if(vaultQuery.trim()&&!vaultMatches(i,vaultQuery.trim().toLowerCase())){vaultQuery='';const box=main.querySelector('#vault-query');if(box)box.value='';vaultApplyQuery(main);}
  vaultFlash(main.querySelector(`.vault-secrets .vault-item[data-item="${CSS.escape(i.id)}"]`));
  vaultSheet(i.id);return;
 }
 if(!f.request)return;
 if(f.missed)vaultMissed.set(f.request,{why:f.missed,tap:f.tap});
 const live=vaultRequests().find(r=>r.id===f.request);
 if(live){
  vaultNotice='';vaultPainted='';paintVaultView(); // the card now carries what happened to the notification's answer
  const card=main.querySelector(`#vault-requests .vault-request[data-request="${CSS.escape(f.request)}"]`);
  vaultFlash(card);card?.querySelector('h3')?.focus({preventScroll:true});return;
 }
 // No longer waiting: say what became of it rather than showing nothing.
 const done=(vaultSnap.answered||[]).find(r=>r.id===f.request),names=done?.itemNames?.join(', ')||'';
 const what=!done?'That request is no longer waiting. It was answered or it expired; if the agent still needs the secret, it will ask again.'
  :done.decision==='once'||done.decision==='always'?`You already allowed ${names} ${rel(vaultTime(done.at))}.`
  :done.decision==='deny'?`You already denied ${names} ${rel(vaultTime(done.at))}.`
  :`The request for ${names} ${done.decision==='locked'?'ended when the Vault locked':'expired before it was answered'}. If the agent still needs it, it will ask again.`;
 vaultNotice=(f.missed&&!(done&&['once','always','deny'].includes(done.decision))?vaultMissedLine(f.missed,f.tap)+' ':'')+what;
 vaultPainted='';paintVaultView();
 const n=main.querySelector('.vault-notice');if(n){n.scrollIntoView({block:'nearest'});n.focus({preventScroll:true});}
}
// The search box filters rows in place, so typing never rebuilds the list under the cursor.
function vaultApplyQuery(root){
 const q=vaultQuery.trim().toLowerCase(),rows=[...root.querySelectorAll('.vault-secrets .vault-item')];let n=0;
 for(const row of rows){const i=vaultItemById(row.dataset.item),hit=!q||(Boolean(i)&&vaultMatches(i,q));row.hidden=!hit;if(hit)n++;}
 const count=root.querySelector('[data-vault-count]');if(count)count.textContent=q?`${n} of ${rows.length}`:String(rows.length);
 const none=root.querySelector('[data-vault-none]');if(none){none.hidden=!q||n>0;none.textContent=q&&!n?`No secrets match “${vaultQuery.trim()}”.`:'';}
}
// 1.40: passphrase mode. A locked Vault answers GET /api/vault with ready:false, locked:true and every other route 423.
const vaultIsLocked=()=>Boolean(vaultSnap&&vaultSnap.ready===false&&vaultSnap.locked);
const VAULT_LOCK_CHOICES=[[0,'Never'],[15,'15 minutes'],[60,'1 hour'],[480,'8 hours'],[1440,'24 hours']];
const VAULT_PASS_MIN=12;
let vaultAutoLock=null,vaultLockInfoLoading=false; // minutes from /api/settings, for the lock panel's sentence
const vaultLockedLine=()=>{const w=VAULT_LOCK_CHOICES.find(([m])=>m===vaultAutoLock)?.[1];return 'Agents cannot use secrets until you unlock it. Pocket locks it after a restart'+(vaultAutoLock&&w?`, and after ${w} idle`:'')+'.';};
function vaultLoadLockInfo(){
 if(vaultLockInfoLoading||vaultAutoLock!==null)return;vaultLockInfoLoading=true;
 api('/settings',{cache:'no-store',signal:AbortSignal.timeout(8000)}).then(s=>{vaultAutoLock=Number(s.vaultAutoLockMinutes)||0;}).catch(()=>{vaultAutoLock=0;}).finally(()=>{vaultLockInfoLoading=false;paintVaultView();paintRailVault();});
}
// A route that answered 423 found the Vault locked (an idle lock, another device): reload so the lock panel shows.
const vaultLockedError=e=>{if(e?.status!==423)return false;loadVault(true).then(repaintVault).catch(()=>{});return true;};
// The passphrase routes answer 401 for a wrong passphrase, so they cannot use api(), which takes every 401 for a
// signed-out browser. Only the server's own 'unauthorized' means that. A passphrase goes in this body and nowhere else.
async function vaultPost(path,body,{blob=false}={}){
 const r=await fetch('/api'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
 if(r.ok&&blob)return {blob:await r.blob(),disposition:r.headers.get('content-disposition')||''};
 const j=await r.json().catch(()=>({}));
 if(r.status===401&&(!j.error||j.error==='unauthorized')){renderLogin();throw new Error('login');}
 if(!r.ok)throw Object.assign(new Error(j.error||r.statusText||'Something went wrong.'),{status:r.status,code:j.code,body:j});
 return j;
}
async function loadVault(force){
 if(!force&&vaultSnap&&Date.now()-vaultAt<4000)return vaultSnap;
 if(vaultLoading)return vaultLoading;
 vaultLoading=api('/vault',{cache:'no-store',signal:AbortSignal.timeout(8000)}).then(s=>{s.items=s.items||[];s.trash=s.trash||[];s.requests=s.requests||[];vaultSnap=s;vaultAt=Date.now();return s;}).finally(()=>{vaultLoading=null;});
 return vaultLoading;
}
// Keep the local list in name order, removed items in the Removed section, newest removal first.
function mergeVaultItem(i){
 if(!vaultSnap||!i)return;
 vaultSnap.items=vaultSnap.items.filter(x=>x.id!==i.id);vaultSnap.trash=vaultSnap.trash.filter(x=>x.id!==i.id);
 (i.trashedAt?vaultSnap.trash:vaultSnap.items).push(i);
 vaultSnap.items.sort((a,b)=>a.name.localeCompare(b.name));
 vaultSnap.trash.sort((a,b)=>vaultTime(b.trashedAt)-vaultTime(a.trashedAt));
}
function repaintVault(){paintVaultView();paintRailVault();paintVaultBadges();if(typeof paintOpenSessions==='function')paintOpenSessions();}
// Every change; returns the response, or null after telling the owner why it failed. A stale revision merges the
// server's copy so the next attempt starts from it.
async function vaultAct(body,done){
 try{
  const r=await api('/vault/act',{method:'POST',body:JSON.stringify(body),cache:'no-store'});
  if(r.item)mergeVaultItem(r.item);
  if(body.action==='answer'&&vaultSnap){vaultSnap.requests=vaultSnap.requests.filter(x=>x.id!==body.request);vaultSnap.openRequests=vaultRequestCount();}
  if(done)toast(done);repaintVault();return r;
 }catch(e){
  if(e.status===409&&e.body?.item){mergeVaultItem(e.body.item);repaintVault();}
  if(vaultLockedError(e)){toast('The Vault is locked. Unlock it to make changes.');return null;}
  if(body.action==='answer')loadVault(true).then(repaintVault).catch(()=>{}); // an expired or answered request leaves the list
  if(e.message!=='login')toast(e.message||'Could not update the Vault');
  return null;
 }
}

/* ---------- the list view ---------- */
async function renderVault(view){
 Voice.onLeave?.();
 vaultView=view;vaultPainted='';vaultNotice='';if(typeof boardView!=='undefined')boardView=null;if(typeof docView!=='undefined')docView=null;if(typeof taskView!=='undefined')taskView=null;
 const col=`<header class="bar">
   ${PANE?`<button class="icon" id="pane-main" aria-label="Make this the main view">${IC.swap}</button>`:SOLO?'':`<button class="icon" id="back" aria-label="Back">${IC.back}</button><button class="icon desk" id="railtog" aria-label="Show or hide the conversation list">${IC.panel}</button>`}
   <h1><span class="one" id="vtitle">Vault</span><span class="tag" id="vtag">Secrets agents use without seeing</span></h1>
   ${SOLO?'':`<button class="icon" id="vwin" aria-label="Open in a new window" title="Open in a new window">${IC.external}</button>`}
   ${PANE||SOLO?'':`<button class="icon desk" id="splitb" aria-label="Split view">${IC.columns}</button>`}
   ${PANE?`<button class="icon" id="pane-close" aria-label="Close this pane">${IC.x}</button>`:''}
  </header>
  <main class="scroll projects-view vault-view" id="vault-main" tabindex="-1"><p class="sheet-help projects-loading">Loading the Vault…</p></main>`;
 app.innerHTML=withShell(col);
 wireShell();
 if(PANE){$('#pane-main').onclick=()=>paneSay('main',{view});$('#pane-close').onclick=()=>paneSay('close');}
 else if(!SOLO){bindViewBack($('#back'),view);$('#splitb').onclick=chooseBeside;}
 $('#vwin')?.addEventListener('click',()=>openInWindow(view));
 const tog=$('#railtog');if(tog)tog.onclick=()=>{localStorage.setItem('pc-rail',railOpen()?'closed':'open');route();};
 try{await loadVault(true);}
 catch(e){if(vaultView!==view)return;const main=$('#vault-main');if(!main)return;if(vaultSnap)paintVaultView();showLibraryError(main,e,'The Vault',()=>renderVault(view),Boolean(vaultSnap));restoreViewPosition(view);return;}
 if(vaultView!==view)return;
 if(PANE)paneSay('route',{id:view,title:'Vault'});else if(SOLO)document.title='Vault · '+appName();else rememberOpenView(view,'Vault');
 paintVaultView();
 restoreViewPosition(view);
 vaultApplyFocus(vaultTakeFocus()); // 1.93: a link to one secret or request, or a push's #/vault/requests
}
function paintVaultView(){
 const main=$('#vault-main');if(!main||!vaultSnap||!vaultView)return;
 // The 30-second refresh must not rebuild the list under a finger or a focused button when nothing changed.
 if(vaultIsLocked()){document.querySelectorAll('.vault-field[data-shown]').forEach(vaultHideValue);vaultLoadLockInfo();} // a value shown before the lock goes
 const key=JSON.stringify([vaultSnap.ready,vaultSnap.locked,vaultSnap.access,vaultIsLocked()?vaultAutoLock:0,vaultSnap.items,vaultSnap.trash,vaultRequests(),vaultOrder(),vaultNotice,[...vaultMissed]]);
 if(key===vaultPainted&&main.querySelector('.vault-list-head'))return paintVaultBadges();
 const focused=document.activeElement&&main.contains(document.activeElement)?[...main.querySelectorAll('button,a,summary,input,select')].indexOf(document.activeElement):-1;
 const caret=document.activeElement?.id==='vault-query'?document.activeElement.selectionStart:null;
 const open=[...main.querySelectorAll('details')].map(d=>d.open);
 vaultPainted=key;
 main.innerHTML=vaultListHTML();
 main.querySelectorAll('details').forEach((d,i)=>{if(open[i])d.open=true;});
 bindVaultRows(main);
 main.querySelector('#vt-add')?.addEventListener('click',()=>vaultEditor(null));
 main.querySelector('#vt-unlock')?.addEventListener('click',()=>vaultUnlockSheet());
 const q=main.querySelector('#vault-query');if(q)q.oninput=()=>{vaultQuery=q.value;vaultApplyQuery(main);};
 const order=main.querySelector('#vault-order');if(order)order.onchange=()=>{vaultSetOrder(order.value);repaintVault();};
 vaultApplyQuery(main);
 if(focused>=0){const el=main.querySelectorAll('button,a,summary,input,select')[focused];el?.focus({preventScroll:true});if(el&&caret!==null&&el.id==='vault-query')try{el.setSelectionRange(caret,caret);}catch{}}
 paintVaultBadges();
 if(typeof paintOpenSessions==='function')paintOpenSessions();
}
// The kind is drawn as an icon; screen readers get the word instead.
function vaultFactsHTML(i){
 const host=vaultHost(i.url),tags=(i.tags||[]).join(', ');
 const facts=[vaultIsNew(i)?`<span>Added ${esc(rel(vaultTime(i.created)))}${i.addedIn?.sessionTitle?' in '+esc(i.addedIn.sessionTitle):''}</span>`:'',host?`<span>${esc(host)}</span>`:'',tags?`<span>${esc(tags)}</span>`:'',`<span>${esc(vaultPolicyWord(i))}</span>`,
  i.lastUsedAt?`<span>Used ${esc(rel(vaultTime(i.lastUsedAt)))}</span>`:'',
  i.expiresAt?`<span class="${i.expiring||vaultExpired(i)?'due-label':''}">${vaultExpired(i)?'Expired':'Expires'} ${esc(vaultDate(i.expiresAt))}</span>`:''].filter(Boolean);
 return `<span class="vault-sr">${esc(VAULT_KIND_WORD[i.kind]||'Secret')}, </span>`+facts.join('<span aria-hidden="true">·</span>');
}
function vaultRowHTML(i){
 return `<div class="session-item vault-item ${i.expiring||vaultExpired(i)?'due':''}" data-item="${esc(i.id)}">
  <span class="vault-kind" aria-hidden="true">${vaultKindIcon(i.kind)}</span>
  <button class="row" data-vault-open="${esc(i.id)}"><span class="body"><span class="title vault-name">${esc(i.name)}</span>${vaultIsNew(i)?'<span class="vault-new">New</span>':''}<span class="session-status">${vaultFactsHTML(i)}</span></span></button>
  <button class="session-more icon" data-vault-more="${esc(i.id)}" aria-label="Options for ${esc(i.name)}">${IC.more}</button></div>`;
}
function vaultTrashRowHTML(i){
 const until=i.trashedAt?vaultDate(new Date(vaultTime(i.trashedAt)+30*86400e3).toISOString()):'';
 return `<div class="session-item vault-item finished" data-item="${esc(i.id)}">
  <span class="vault-kind" aria-hidden="true">${vaultKindIcon(i.kind)}</span>
  <span class="row"><span class="body"><span class="title vault-name">${esc(i.name)}</span><span class="session-status"><span>${esc(VAULT_KIND_WORD[i.kind]||'Secret')}</span>${until?`<span aria-hidden="true">·</span><span>Kept until ${esc(until)}</span>`:''}</span></span></span>
  <button class="chip vault-restore" data-vault-restore="${esc(i.id)}" aria-label="Restore ${esc(i.name)}">Restore</button></div>`;
}
// A request, said as a sentence (1.93, Damon: "<agent> wants to use <name> for this command"), then the exact command, where it
// runs and when. Allow once is the filled accent button and Deny its outlined twin; Always allow stays the quieter choice.
function vaultRequestHTML(r,where='main'){
 const hid=`vr-${where}-${r.id}`,title=r.session?(r.sessionTitle||(typeof sessionName==='function'?sessionName(r.session):'')||''):'';
 const who=r.session?(title?`The agent in “${title}”`:'An agent'):'A terminal or code-server';
 const fill=Array.isArray(r.argv)&&r.argv[0]==='pocket-fill',names=vaultRequestNames(r),missed=vaultMissed.get(r.id);
 return `<section class="vault-request" data-request="${esc(r.id)}" aria-labelledby="${esc(hid)}">
  <h3 id="${esc(hid)}" tabindex="-1"><span class="vault-request-who">${esc(who)}</span> wants to ${fill?'fill':'use'} <span class="vault-name">${esc(names)}</span> ${fill?'into a web page':'for this command'}</h3>
  ${missed?`<p class="vault-request-missed" role="status">${esc(vaultMissedLine(missed.why,missed.tap))} Answer it here.</p>`:''}
  <code class="vault-cmd" tabindex="0" title="${esc(vaultCmd(r.argv))}">${esc(vaultCmd(r.argv))}</code>
  <p class="vault-request-where">${r.cwd?`<span class="vault-path">${esc(projShort(r.cwd))}</span><span aria-hidden="true">·</span>`:''}<span>Asked ${esc(rel(vaultTime(r.created)))}</span></p>
  <div class="approval-actions vault-request-actions"><button class="vault-answer vault-deny" data-answer="deny">Deny</button>${r.allowAlways===false?'':'<button class="chip vault-always" data-answer="always">Always allow</button>'}<button class="vault-answer vault-allow" data-answer="once">Allow once</button></div>
 </section>`;
}
function vaultLockedHTML(where='main'){
 return `<section class="vault-locked${where==='rail'?' rail-locked':''}" aria-labelledby="vault-locked-${where}">
  <h3 id="vault-locked-${where}"><span class="vault-lock-glyph" aria-hidden="true">${VIC.lock}</span>The Vault is locked</h3>
  <p>${esc(vaultLockedLine())}</p>
  <button class="${where==='rail'?'chip':'primary'} vault-unlock" id="${where==='rail'?'rail-vault-unlock':'vt-unlock'}">Unlock</button></section>`;
}
function vaultListHTML(){
 if(vaultIsLocked())return `<div class="session-home-head vault-list-head"><h2>Vault</h2></div>${vaultLockedHTML()}`;
 if(vaultSnap.ready===false)return `<div class="session-home-head vault-list-head"><h2>Vault</h2></div><p class="sheet-help project-empty">The Vault cannot be opened. Check that POCKET_VAULT_KEY in .env is the key it was saved with, then restart Pocket Code.</p>`;
 const reqs=vaultRequests(),items=vaultSnap.items,trash=vaultSnap.trash;
 return `<div class="session-home-head vault-list-head"><h2>Vault</h2><span class="project-head-actions"><button class="chip" id="vt-add">${IC.plus}Add secret</button></span></div>
  ${reqs.length?`<section class="session-group project-group vault-requests" id="vault-requests"><h2 tabindex="-1">Requests <span>${reqs.length} waiting</span></h2><p class="sheet-help vault-requests-help">An agent wants to run a command with a secret.${reqs.some(r=>r.allowAlways!==false)?' Always allow remembers this exact command and folder for that secret.':''}</p>${reqs.map(r=>vaultRequestHTML(r)).join('')}</section>`:''}
  ${vaultNotice?`<p class="vault-notice" role="status" tabindex="-1">${esc(vaultNotice)}</p>`:''}
  ${items.length?`<div class="documents-tools vault-tools"><div class="session-search">${IC.search}<input type="search" id="vault-query" placeholder="Search secrets" aria-label="Search secrets by name, kind, tag or website" value="${esc(vaultQuery)}" autocomplete="off" spellcheck="false" enterkeyhint="search"></div>
   <label class="voice-field vault-order">Order<select id="vault-order"><option value="new"${vaultOrder()==='new'?' selected':''}>Newest first</option><option value="name"${vaultOrder()==='name'?' selected':''}>A–Z</option></select></label></div>
   <section class="session-group project-group vault-secrets"><h2>Secrets <span data-vault-count>${items.length}</span></h2>${vaultSorted(items).map(vaultRowHTML).join('')}<p class="sheet-help project-empty" data-vault-none role="status" hidden></p></section>`
   :'<p class="sheet-help project-empty">No secrets yet. Add one here, or from a conversation with Store in the Vault. Agents use them by name and never see the value.</p>'}
  ${trash.length?`<details class="session-group project-group settings-details"><summary><h2>Removed <span>${trash.length}</span></h2></summary><p class="sheet-help vault-requests-help">Kept for 30 days, then deleted. A removed name can't be reused until then.</p>${trash.map(vaultTrashRowHTML).join('')}</details>`:''}`;
}
function bindVaultRows(root){
 root.querySelectorAll('[data-vault-open]').forEach(b=>b.onclick=()=>vaultSheet(b.dataset.vaultOpen));
 root.querySelectorAll('[data-vault-more]').forEach(b=>b.onclick=()=>vaultSheet(b.dataset.vaultMore));
 root.querySelectorAll('[data-vault-restore]').forEach(b=>b.onclick=()=>{const i=vaultItemById(b.dataset.vaultRestore);if(i)vaultAct({action:'restore',item:i.id},'Restored '+i.name);});
 root.querySelectorAll('[data-request]').forEach(card=>card.querySelectorAll('[data-answer]').forEach(b=>b.onclick=async()=>{
  const r=vaultSnap?.requests.find(x=>x.id===card.dataset.request);if(!r)return;
  card.querySelectorAll('button').forEach(x=>x.disabled=true);
  const decision=b.dataset.answer;vaultMissed.delete(r.id);
  const out=await vaultAct({action:'answer',request:r.id,decision},decision==='deny'?'Denied':decision==='always'?'Allowed. This command is remembered for '+vaultRequestNames(r):'Allowed once');
  if(!out){if(card.isConnected)card.querySelectorAll('button').forEach(x=>x.disabled=false);return;}
  loadVault(true).then(repaintVault).catch(()=>{}); // recipes and last use come from the server
 }));
}

/* ---------- one secret: the sheet ---------- */
// Run fn once the sheet has left the page, however it closed (button, scrim, Escape, another sheet).
function onSheetGone(sh,fn){const mo=new MutationObserver(()=>{if(!sh.isConnected){mo.disconnect();fn();}});mo.observe(document.body,{childList:true});}
function vaultHideValue(row){
 const v=row.querySelector('.vault-value');if(v){v.classList.remove('shown');v.innerHTML='<span aria-hidden="true">••••••••</span><span class="vault-sr">Hidden</span>';}
 const show=row.querySelector('[data-show]');if(show)show.textContent='Show';
 const copy=row.querySelector('[data-copy-value]');if(copy)copy.hidden=true;
 delete row.dataset.shown;
}
// Hiding the app (screen off, another app) hides every shown value.
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')document.querySelectorAll('.vault-field[data-shown]').forEach(vaultHideValue);});
async function vaultCopy(text,btn,what){
 try{
  if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);
  else{const ta=document.createElement('textarea');ta.value=text;ta.setAttribute('aria-hidden','true');document.body.append(ta);ta.select();document.execCommand('copy');ta.remove();}
  if(btn?.isConnected){btn.innerHTML=IC.tick+'Copied';btn.classList.add('ok');setTimeout(()=>{if(btn.isConnected){btn.innerHTML=IC.copy+'Copy';btn.classList.remove('ok');}},1400);}
  toast(what+' copied');
 }catch{toast('Copy failed');}
}
function vaultHistoryLine(row){
 const by=row.by==='owner'?'by you':row.by==='terminal'?'from a terminal':'by an agent';
 const what={run:'Run '+by,fill:'Filled into a browser '+by,'run-denied':'Run refused, '+by.replace(/^by /,'asked by '),request:'Asked to run '+by,'request-answered':row.decision==='deny'?'Request denied by you':row.decision==='always'?'Always allowed by you':row.decision==='once'?'Allowed once by you':'Request answered by you',
  'owner-view':'Viewed by you',put:'Stored '+by,update:row.decision==='recipe-removed'?'Approved command removed '+by:'Changed '+(Array.isArray(row.fields)&&row.fields.length?row.fields.join(', ')+' ':'')+by,remove:'Removed '+by,restore:'Restored '+by,rotate:'Key rotated by you'}[row.action]||row.action;
 const parts=[what,row.session?(row.sessionTitle||(typeof sessionName==='function'?sessionName(row.session):'')):'',row.at?rel(vaultTime(row.at)):''].filter(Boolean);
 const cmd=row.argv&&row.argv.length?vaultCmd(row.argv):'';
 return `<li><span class="vault-history-what">${esc(parts.join(' · '))}</span>${cmd?`<code class="vault-cmd">${esc(cmd)}</code>`:''}</li>`;
}
function vaultRecipesHTML(i){
 const rs=i.recipes||[],eff=vaultEff(i);
 if(!rs.length)return `<p class="project-empty">${eff==='ask'?'None yet. Always allow on a request adds one.':eff==='auto'?'Not needed: agents may run any command with it.':eff==='every'?'Not used: every use asks.':'Agents cannot use this secret.'}</p>`;
 return `${eff==='auto'||eff==='every'?`<p class="project-empty">Kept, but not needed while it ${eff==='auto'?'has free rein':'asks every time'}.</p>`:''}<ul class="vault-recipes">${rs.map(r=>`<li><span class="vault-recipe-body"><code class="vault-cmd">${esc(vaultCmd(r.argv))}</code>${r.cwd?`<span class="vault-path">in ${esc(projShort(r.cwd))}</span>`:''}</span><button class="icon vault-recipe-remove" data-recipe="${esc(r.id)}" aria-label="Remove approved command: ${esc(vaultCmd(r.argv))}">${IC.x}</button></li>`).join('')}</ul>`;
}
function vaultSheet(id){
 const i=vaultItemById(id);if(!i||i.trashedAt)return;
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet task-sheet vault-sheet';
 const url=vaultSafeUrl(i.url),eff=vaultEff(i),word=vaultPolicyWord(i);
 const used=i.lastUsedAt?`Used ${rel(vaultTime(i.lastUsedAt))}${i.lastUsedBy?(i.lastUsedBy.kind==='owner'?' by you':i.lastUsedBy.kind==='terminal'?' from a terminal':' by an agent')+(i.lastUsedBy.sessionTitle?' · '+i.lastUsedBy.sessionTitle:''):''}`:'Not used yet';
 const facts=[url?`<span><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(vaultHost(url))}</a></span>`:i.url?`<span>${esc(i.url)}</span>`:'',
  i.tags?.length?`<span>Tags: ${esc(i.tags.join(', '))}</span>`:'',
  i.expiresAt?`<span class="${i.expiring||vaultExpired(i)?'due-label':''}">${vaultExpired(i)?'Expired':'Expires'} ${esc(vaultDate(i.expiresAt))}</span>`:'',
  `<span>${esc(used)}</span>`,`<span>Added ${esc(rel(vaultTime(i.created)))}${i.updated&&i.updated!==i.created?' · Changed '+esc(rel(vaultTime(i.updated))):''}</span>`].filter(Boolean).join('');
 const fields=i.fields?.length?i.fields:vaultFixedFields(i.kind),fixed=vaultFixedFields(i.kind);
 // How an agent names it in a run: the item alone when it has one field, item.field for each when it has several.
 const use=fields.length>1?fields.map(f=>`<code class="vault-path">${esc(i.name+'.'+f)}</code>`).join(' '):`<code class="vault-path">${esc(i.name)}</code>`;
 sh.innerHTML=`<h2>${esc(VAULT_KIND_WORD[i.kind]||'Secret')}</h2><p class="task-text vault-name" id="vault-sheet-name">${esc(i.name)}</p><div class="task-facts">${facts}</div>
  <section class="vault-section"><h3>${fields.length>1?'Values':'Value'}</h3>${fields.map(f=>`<div class="vault-field" data-field="${esc(f)}">
    <span class="vault-field-label${fixed.includes(f)?'':' vault-field-custom'}" id="vf-${esc(f)}">${esc(vaultFieldWord(i.kind,f))}</span>
    <span class="vault-value"><span aria-hidden="true">••••••••</span><span class="vault-sr">Hidden</span></span>
    <span class="vault-field-actions"><button class="chip" data-copy-value aria-describedby="vf-${esc(f)}" hidden>${IC.copy}Copy</button><button class="chip" data-show aria-describedby="vf-${esc(f)}">Show</button></span></div>`).join('')}</section>
  <section class="vault-section"><h3>Agents</h3><p class="vault-policy"><strong>${esc(word)}</strong>: ${esc(VAULT_POLICY[eff][1])}</p>
   ${vaultOwnPolicy(i)?`<p class="vault-policy-note">Set for this item. The Vault default is ${esc(vaultAccessWord(vaultAccessNow()))}.</p>`:''}${eff==='owner'?'':`<p class="vault-use">${fields.length>1?'Each field is used by name':'Used by name'} in a command: ${use}</p>`}</section>
  ${eff==='owner'?'':`<section class="vault-section"><h3>Approved commands <span>${(i.recipes||[]).length||''}</span></h3><div data-recipes>${vaultRecipesHTML(i)}</div></section>`}
  ${i.notes?`<div class="task-summary"><h3>Notes</h3>${esc(i.notes)}</div>`:''}
  <button class="opt" data-edit>${IC.pen}<span>Edit<span class="sub">Name, values, fields, website, tags, notes and expiry</span></span></button>
  <button class="opt" data-policy>${VIC.lock}<span>Change who can use it<span class="sub">${esc(word)}${vaultOwnPolicy(i)?', set for this item':''}</span></span></button>
  <button class="opt" data-remove>${IC.x}<span>Remove<span class="sub">Kept for 30 days, then deleted</span></span></button>
  <section class="vault-section vault-history-section"><h3>History</h3><div class="vault-history" data-history role="status">Loading history…</div></section>`;
 sh.querySelectorAll('.vault-field').forEach(row=>{
  const f=row.dataset.field,show=row.querySelector('[data-show]'),copy=row.querySelector('[data-copy-value]');
  show.onclick=async()=>{
   if(row.dataset.shown!==undefined)return vaultHideValue(row);
   show.disabled=true;show.textContent='Loading…';
   try{
    const r=await api('/vault/field',{method:'POST',body:JSON.stringify({item:i.id,field:f}),cache:'no-store'});
    if(!sh.isConnected)return;
    const v=row.querySelector('.vault-value');v.classList.add('shown');v.textContent=String(r.value??'');
    row.dataset.shown='';show.textContent='Hide';copy.hidden=false;
    vaultHistory(sh,i.id); // the view is recorded; show it
   }catch(e){if(sh.isConnected){show.textContent='Show';}if(vaultLockedError(e)){closeCurrentSheet?.();toast('The Vault is locked');}else if(e.message!=='login')toast(e.message||'Could not show the value');}
   finally{show.disabled=false;}
  };
  copy.onclick=()=>{const v=row.querySelector('.vault-value.shown');if(v)vaultCopy(v.textContent,copy,vaultFieldWord(i.kind,f));};
 });
 const bindRecipes=()=>sh.querySelectorAll('[data-recipe]').forEach(b=>b.onclick=async()=>{
  b.disabled=true;const cur=vaultItemById(i.id)||i;
  const r=await vaultAct({action:'recipe-remove',item:i.id,recipe:b.dataset.recipe},'Approved command removed');
  if(!sh.isConnected)return;const now=r?.item||vaultItemById(i.id)||cur;
  const box=sh.querySelector('[data-recipes]');if(!box)return;
  box.innerHTML=vaultRecipesHTML(now);const n=box.previousElementSibling?.querySelector('span');if(n)n.textContent=(now.recipes||[]).length||'';bindRecipes();
  const next=box.querySelector('button');if(next)next.focus();else{const h=box.previousElementSibling;h.tabIndex=-1;h.focus();}
 });
 bindRecipes();
 sh.querySelector('[data-edit]').onclick=()=>{closeCurrentSheet?.();vaultEditor(vaultItemById(i.id)||i);};
 sh.querySelector('[data-policy]').onclick=()=>vaultPolicySheet(vaultItemById(i.id)||i);
 sh.querySelector('[data-remove]').onclick=()=>{closeCurrentSheet?.();confirmSheet('Remove this secret?',`${i.name} goes to Removed for 30 days, then it is deleted. Agents can't use it once removed, and the name can't be reused until then.`,'Remove it',()=>vaultAct({action:'remove',item:i.id},'Removed '+i.name));};
 onSheetGone(sh,()=>sh.querySelectorAll('.vault-field').forEach(vaultHideValue)); // no value outlives its sheet
 mountSheet(scrim,sh);
 sh.setAttribute('aria-labelledby','sheet-title vault-sheet-name');
 vaultHistory(sh,i.id);
}
async function vaultHistory(sh,id){
 const box=sh.querySelector('[data-history]');if(!box)return;
 try{
  const r=await api('/vault/audit?item='+encodeURIComponent(id)+'&limit=50',{cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!sh.isConnected)return;
  const rows=(r.rows||[]).slice().sort((a,b)=>vaultTime(b.at)-vaultTime(a.at)).slice(0,20);
  box.innerHTML=rows.length?`<ul class="vault-history-list">${rows.map(vaultHistoryLine).join('')}</ul>`:'<p class="project-empty">Nothing recorded yet.</p>';
 }catch(e){if(sh.isConnected)box.innerHTML=vaultLockedError(e)?'<p class="project-empty">The Vault is locked.</p>':`<p class="project-empty">History could not load. ${esc(e.message||'')}</p>`;}
}
function vaultPolicySheet(i){
 sheet('Who can use it',vaultPolicyChoices(),i.policy||'default',async v=>{
  if(v===(i.policy||'default'))return vaultSheet(i.id);
  const r=await vaultAct({action:'update',item:i.id,expected_revision:i.revision,policy:v},v==='default'?i.name+' follows the Vault default':VAULT_POLICY[v][0]+': '+i.name);
  if(r)vaultSheet(i.id);
 });
}

/* ---------- the editor: add or edit ---------- */
let vaultFieldSeq=0;
const VAULT_SECRET_ATTRS='autocomplete="off" spellcheck="false" autocapitalize="none" autocorrect="off" data-1p-ignore data-lpignore="true"';
const vaultRevealBtn=(id,label)=>`<button type="button" class="chip vault-reveal" data-reveal="${id}" aria-pressed="false" aria-describedby="${label}">Show</button>`;
function vaultSecretFieldsHTML(kind,editing){
 return vaultFixedFields(kind).map(f=>{
  const id='vs-'+(++vaultFieldSeq),label=vaultFieldWord(kind,f),ph=editing?'Unchanged':'';
  const common=`id="${id}" name="v-${f}" ${VAULT_SECRET_ATTRS} data-secret="${f}" placeholder="${ph}"`;
  if(f==='username')return editing?`<div class="vault-secret"><label class="voice-field" for="${id}" id="${id}-l">${label}</label><div class="vault-secret-input"><input type="text" data-plain ${common}>${vaultRevealBtn(id,id+'-l')}</div></div>`:`<label class="voice-field">${label}<input type="text" ${common}></label>`;
  if(f==='text')return `<div class="vault-secret"><label class="voice-field" for="${id}" id="${id}-l">${label}</label><div class="vault-secret-input"><textarea rows="4" class="vault-masked" ${common}></textarea>${vaultRevealBtn(id,id+'-l')}</div></div>`;
  return `<div class="vault-secret"><label class="voice-field" for="${id}" id="${id}-l">${label}</label><div class="vault-secret-input"><input type="password" ${common}>${vaultRevealBtn(id,id+'-l')}</div></div>`;
 }).join('');
}
// A custom field the item already has: its name is fixed (rename = remove and add), its value is replaced only when typed.
function vaultCustomRowHTML(name){
 const id='vs-'+(++vaultFieldSeq);
 return `<div class="vault-custom-row" data-custom="${esc(name)}">
  <span class="vault-custom-name" id="${id}-l">${esc(name)}</span>
  <div class="vault-secret-input"><input type="password" id="${id}" ${VAULT_SECRET_ATTRS} data-custom-value placeholder="Unchanged" aria-labelledby="${id}-l">${vaultRevealBtn(id,id+'-l')}</div>
  <button type="button" class="chip vault-field-remove" data-remove-field aria-pressed="false" aria-describedby="${id}-l">Remove</button>
  <p class="vault-hint vault-removing" hidden>Removed when you save.</p>
 </div>`;
}
// A field being added: a name and a value. A row left empty is ignored on save.
function vaultNewFieldHTML(){
 const id='vs-'+(++vaultFieldSeq);
 return `<div class="vault-custom-row new" data-new-field>
  <label class="voice-field vault-custom-key">Name<input type="text" data-custom-name maxlength="32" pattern="[a-z][a-z0-9_]{0,31}" placeholder="client_id" class="vault-name-input" ${VAULT_SECRET_ATTRS} aria-describedby="vault-field-hint ${id}-e"></label>
  <button type="button" class="icon vault-field-drop" data-drop-field aria-label="Remove this field">${IC.x}</button>
  <div class="vault-secret"><label class="voice-field" for="${id}" id="${id}-l">Value</label><div class="vault-secret-input"><input type="password" id="${id}" ${VAULT_SECRET_ATTRS} data-custom-value aria-describedby="${id}-e">${vaultRevealBtn(id,id+'-l')}</div></div>
  <p class="vault-field-error" id="${id}-e"></p>
 </div>`;
}
// insert: after saving, put {{vault:name}} into the open message box so the message refers to the secret by name.
function vaultEditor(t,{insert=null}={}){
 if(!vaultOn())return toast('The Vault is off. '+turnOnHint());
 if(vaultIsLocked())return vaultUnlockSheet(()=>vaultEditor(t,{insert})); // unlock first, then the sheet that was asked for
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet vault-editor';
 let revision=t?.revision;
 const kind=t?.kind||'api_key',expires=t?.expiresAt?(d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`)(new Date(t.expiresAt)):'';
 const existing=t?(t.custom||[]):[];
 const customHead=k=>k==='credentials'?'Fields':'Custom fields';
 sh.innerHTML=`<h2>${t?'Edit secret':'Add to the Vault'}</h2>${t?`<p class="sheet-name vault-name">${esc(t.name)}</p>`:'<p class="sheet-help vault-editor-help">Stored encrypted on this server. Agents use it by name in commands and never see the value.</p>'}
  <form class="project-form vault-form" autocomplete="off" novalidate>
   <label class="voice-field">Name<input type="text" name="name" required maxlength="64" pattern="[a-z0-9\\-]{1,64}" value="${esc(t?.name||'')}" placeholder="zoho-books" autocomplete="off" spellcheck="false" autocapitalize="none" autocorrect="off" aria-describedby="vault-name-hint" class="vault-name-input"></label>
   <p class="vault-hint" id="vault-name-hint">Lowercase letters, numbers and hyphens. Agents use this name.</p>
   <label class="voice-field">Kind<select name="kind" aria-describedby="${t?'vault-kind-hint':'vault-kind-sub'}" ${t?'disabled':''}>${VAULT_KINDS.map(([v,l])=>`<option value="${v}" ${v===kind?'selected':''}>${l}</option>`).join('')}</select></label>
   ${t?'<p class="vault-hint" id="vault-kind-hint">The kind is fixed. For a different kind, add a new secret.</p>':`<p class="vault-hint" id="vault-kind-sub" data-kind-sub>${esc(VAULT_KIND_SUB[kind]||'')}</p>`}
   <div class="vault-secrets" data-secret-fields>${vaultSecretFieldsHTML(kind,Boolean(t))}</div>
   <div class="vault-custom" role="group" aria-labelledby="vault-custom-h">
    <h3 class="vault-custom-head" id="vault-custom-h">${customHead(kind)}</h3>
    <p class="vault-hint" id="vault-field-hint" hidden>Lowercase letters, digits and underscores, for example client_id</p>
    <div class="vault-custom-rows" data-custom-rows>${existing.map(vaultCustomRowHTML).join('')}</div>
    <button type="button" class="chip vault-add-field" data-add-field>${IC.plus}Add field</button>
   </div>
   ${t?'<p class="vault-hint">Show loads a saved value so you can change it. A value left empty stays as it is.</p>':''}
   <label class="voice-field">Website (optional)<input type="text" inputmode="url" name="url" value="${esc(t?.url||'')}" placeholder="https://" autocomplete="off" spellcheck="false" autocapitalize="none"></label>
   <label class="voice-field">Tags (optional)<input type="text" name="tags" value="${esc((t?.tags||[]).join(', '))}" placeholder="billing, zoho" autocomplete="off" autocapitalize="none" aria-describedby="vault-tags-hint"></label>
   <p class="vault-hint" id="vault-tags-hint">Separate tags with commas.</p>
   <label class="voice-field">Notes (optional)<textarea name="notes" rows="3" maxlength="2000" placeholder="Where it came from, what it's for">${esc(t?.notes||'')}</textarea></label>
   <label class="voice-field">Who can use it<select name="policy" aria-describedby="vault-policy-hint">${vaultPolicyChoices().map(([v,l])=>`<option value="${v}" ${v===(t?.policy||'default')?'selected':''}>${esc(l)}</option>`).join('')}</select></label>
   <p class="vault-hint" id="vault-policy-hint" data-policy-hint></p>
   <div class="task-due-row"><label class="voice-field">Expires (optional)<input type="date" name="expires" value="${esc(expires)}"></label><button class="chip" type="button" data-clear-exp>No date</button></div>
   <p class="vault-form-error" role="alert"></p>
   <button class="primary" type="submit">${t?'Save changes':'Save to the Vault'}</button>
  </form>`;
 const form=sh.querySelector('form'),err=sh.querySelector('.vault-form-error'),box=sh.querySelector('[data-secret-fields]');
 const rowsBox=sh.querySelector('[data-custom-rows]'),addBtn=sh.querySelector('[data-add-field]'),fieldHint=sh.querySelector('#vault-field-hint');
 // Editing: Show on a saved field that has nothing typed in it loads the saved value into the box (one field, recorded
 // as a view, like Show on the item's sheet), so it can be corrected in place. loaded holds what each box held as
 // loaded, only to tell an untouched box from a changed one; it goes with the sheet. A value with a line break opens
 // in a box that keeps it.
 const loaded=new Map();
 const savedField=el=>t&&!el.closest('[data-new-field]')?(el.dataset.secret||el.closest('[data-custom]')?.dataset.custom||''):'';
 const toTextarea=el=>{const ta=document.createElement('textarea');for(const a of el.attributes)if(a.name!=='type')ta.setAttribute(a.name,a.value);el.replaceWith(ta);return ta;};
 const mask=(el,on)=>{if(el.tagName==='TEXTAREA')el.classList.toggle('vault-masked',on);else if(!el.hasAttribute('data-plain'))el.type=on?'password':'text';};
 const bindReveal=root=>root.querySelectorAll('[data-reveal]').forEach(b=>b.onclick=async()=>{
  let el=document.getElementById(b.dataset.reveal);const on=b.getAttribute('aria-pressed')!=='true',f=on&&!el.value&&!loaded.has(el)?savedField(el):'';
  if(f){
   b.disabled=true;b.textContent='Loading…';
   try{
    const r=await api('/vault/field',{method:'POST',body:JSON.stringify({item:t.id,field:f}),cache:'no-store'});
    if(!sh.isConnected||el.value)return; // closed, or typed into while it loaded: what was typed wins
    const v=String(r.value??'');
    if(/[\r\n]/.test(v)&&el.tagName!=='TEXTAREA')el=toTextarea(el);
    el.value=v;el.placeholder='';loaded.set(el,el.value);
    if(el.tagName==='TEXTAREA'){el.classList.remove('vault-masked');el.style.height='auto';el.style.height=Math.min(el.scrollHeight+2,220)+'px';} // tall enough to read it whole
    if(el.hasAttribute('data-plain'))b.hidden=true; // a username is never masked; once loaded there is nothing to show
   }catch(e){if(vaultLockedError(e)){err.textContent='The Vault is locked. Unlock it to see saved values.';}else if(e.message!=='login')toast(e.message||'Could not load the value');return;}
   finally{if(b.isConnected){b.disabled=false;b.textContent='Show';}}
  }
  mask(el,!on);b.setAttribute('aria-pressed',String(on));
 });
 // Hiding the app masks every value shown here again; what was typed or loaded stays until the sheet closes.
 const onHidden=()=>{if(document.visibilityState!=='hidden')return;sh.querySelectorAll('[data-reveal][aria-pressed="true"]').forEach(b=>{const el=document.getElementById(b.dataset.reveal);if(el)mask(el,true);b.setAttribute('aria-pressed','false');});};
 document.addEventListener('visibilitychange',onHidden);
 bindReveal(box);
 form.addEventListener('input',e=>{
  const el=e.target;if(!el.matches('[data-secret],[data-custom] [data-custom-value]'))return;
  el.removeAttribute('aria-invalid');err.textContent='';
  if(el.hasAttribute('data-plain')&&!loaded.has(el)){const b=el.parentElement.querySelector('[data-reveal]');if(b)b.hidden=Boolean(el.value);} // Show only loads a username
 });
 // Custom rows: the 20-field cap counts the fields kept plus the rows being added.
 const keptCount=()=>rowsBox.querySelectorAll('[data-custom]:not(.removing),[data-new-field]').length;
 const syncCustom=()=>{fieldHint.hidden=!rowsBox.querySelector('[data-new-field]');addBtn.disabled=keptCount()>=VAULT_CUSTOM_MAX;};
 const clearRowError=row=>{const e=row.querySelector('.vault-field-error');if(e)e.textContent='';row.querySelectorAll('[aria-invalid]').forEach(x=>x.removeAttribute('aria-invalid'));};
 const fieldError=(row,msg,input)=>{row.querySelector('.vault-field-error').textContent=msg;input.setAttribute('aria-invalid','true');input.focus();};
 const bindNewRow=row=>{
  bindReveal(row);
  const nIn=row.querySelector('[data-custom-name]');
  nIn.oninput=()=>{const v=nIn.value.toLowerCase().replace(/[\s-]/g,'_');if(v!==nIn.value){const p=nIn.selectionStart;nIn.value=v;nIn.setSelectionRange(p,p);}clearRowError(row);err.textContent='';};
  row.querySelector('[data-custom-value]').addEventListener('input',()=>{clearRowError(row);err.textContent='';});
  row.querySelector('[data-drop-field]').onclick=()=>{row.querySelector('[data-custom-value]').value='';row.remove();syncCustom();addBtn.focus();};
 };
 const addRow=focus=>{rowsBox.insertAdjacentHTML('beforeend',vaultNewFieldHTML());const row=rowsBox.lastElementChild;bindNewRow(row);syncCustom();if(focus)row.querySelector('[data-custom-name]').focus();return row;};
 rowsBox.querySelectorAll('[data-custom]').forEach(row=>{
  bindReveal(row);
  const rm=row.querySelector('[data-remove-field]');
  rm.onclick=()=>{
   const on=rm.getAttribute('aria-pressed')!=='true',val=row.querySelector('[data-custom-value]');
   row.classList.toggle('removing',on);rm.setAttribute('aria-pressed',String(on));rm.textContent=on?'Undo':'Remove';
   row.querySelector('.vault-removing').hidden=!on;val.disabled=on;if(on){val.value='';loaded.delete(val);} // Undo leaves it empty: kept as it is
   syncCustom();
  };
 });
 addBtn.onclick=()=>addRow(true);
 if(!t&&kind==='credentials')addRow(false);
 syncCustom();
 if(!t)form.elements.kind.onchange=()=>{
  const k=form.elements.kind.value;
  box.innerHTML=vaultSecretFieldsHTML(k,false);bindReveal(box); // the custom rows typed so far stay
  sh.querySelector('#vault-custom-h').textContent=customHead(k);sh.querySelector('[data-kind-sub]').textContent=VAULT_KIND_SUB[k]||'';
  if(k==='credentials'&&!rowsBox.querySelector('[data-new-field]'))addRow(false);
 };
 const nameIn=form.elements.name;
 nameIn.oninput=()=>{const v=nameIn.value.toLowerCase().replace(/[\s_]/g,'-');if(v!==nameIn.value){const p=nameIn.selectionStart;nameIn.value=v;nameIn.setSelectionRange(p,p);}nameIn.removeAttribute('aria-invalid');err.textContent='';};
 const polHint=()=>{const c=vaultPolicyChoices().find(([v])=>v===form.elements.policy.value);sh.querySelector('[data-policy-hint]').textContent=c?c[2]+'.':'';};
 form.elements.policy.onchange=polHint;polHint();
 sh.querySelector('[data-clear-exp]').onclick=()=>{form.elements.expires.value='';};
 const wipe=()=>{form.querySelectorAll('[data-secret],[data-custom-value]').forEach(el=>{el.value='';});loaded.clear();};
 onSheetGone(sh,()=>{wipe();document.removeEventListener('visibilitychange',onHidden);}); // typed and loaded values never outlive the sheet
 // A loaded value left as it was is not sent; one emptied is refused, since an empty box otherwise means "keep it".
 const untouched=el=>loaded.has(el)&&el.value===loaded.get(el);
 const emptied=(el,msg)=>{if(!loaded.has(el)||el.value.trim())return false;err.textContent=msg;el.setAttribute('aria-invalid','true');el.focus();return true;};
 form.onsubmit=async e=>{
  e.preventDefault();err.textContent='';rowsBox.querySelectorAll('[data-new-field]').forEach(clearRowError);
  const name=nameIn.value.trim();
  if(!VAULT_NAME_RE.test(name)){nameIn.setAttribute('aria-invalid','true');err.textContent='Name: 1 to 64 lowercase letters, numbers or hyphens.';nameIn.focus();return;}
  const k=t?t.kind:form.elements.kind.value,fixed=vaultFixedFields(k),values={},removeFields=[];
  for(const el of box.querySelectorAll('[data-secret]')){
   const f=el.dataset.secret;if(untouched(el))continue;
   if(emptied(el,`${vaultFieldWord(k,f)} can’t be empty. Type a value, or close without saving.`))return;
   const v=f==='value'||f==='username'?el.value.trim():el.value;if(v)values[f]=v;
  }
  if(!t){const need=fixed.find(f=>!values[f]);if(need){err.textContent=vaultFieldWord(k,need)+' is required.';box.querySelector(`[data-secret="${need}"]`)?.focus();return;}} // the server needs every fixed field of the kind
  for(const row of rowsBox.querySelectorAll('[data-custom]')){
   if(row.classList.contains('removing')){removeFields.push(row.dataset.custom);continue;}
   const el=row.querySelector('[data-custom-value]');if(untouched(el))continue;
   if(emptied(el,`${row.dataset.custom} can’t be empty. To drop the field, use Remove.`))return;
   const v=el.value.trim();if(v)values[row.dataset.custom]=v;
  }
  // New fields: refused here, beside the row, before anything is sent.
  const seen=new Set();
  for(const row of rowsBox.querySelectorAll('[data-new-field]')){
   const nIn=row.querySelector('[data-custom-name]'),vIn=row.querySelector('[data-custom-value]'),n=nIn.value.trim(),v=vIn.value.trim();
   if(!n&&!v)continue;
   const why=!n?'Give this field a name.'
    :!VAULT_FIELD_RE.test(n)?'Start with a letter, then up to 31 lowercase letters, digits or underscores.'
    :fixed.includes(n)?`${VAULT_KIND_WORD[k]} already has a field named ${n}.`
    :existing.includes(n)?`This secret already has a field named ${n}.`
    :seen.has(n)?`Two fields are named ${n}.`:'';
   if(why)return fieldError(row,why,nIn);
   if(!v)return fieldError(row,`Give ${n} a value, or remove this field.`,vIn);
   seen.add(n);values[n]=v;
  }
  if(rowsBox.querySelectorAll('[data-custom]:not(.removing)').length+seen.size>VAULT_CUSTOM_MAX){err.textContent=`A secret can have up to ${VAULT_CUSTOM_MAX} custom fields.`;return;}
  if(!t&&!Object.keys(values).length){err.textContent='Add at least one field with a value.';(rowsBox.querySelector('[data-new-field] [data-custom-name]')||addRow(false).querySelector('[data-custom-name]')).focus();return;}
  let url=form.elements.url.value.trim();if(url&&!/^[a-z][a-z0-9+.-]*:/i.test(url))url='https://'+url;
  const tags=[...new Set(form.elements.tags.value.split(',').map(s=>s.trim()).filter(Boolean))];
  let expiresAt=null;if(form.elements.expires.value){const d=new Date(form.elements.expires.value+'T23:59:59');if(Number.isNaN(d.getTime())){err.textContent='Pick an expiry date, or clear it.';return;}expiresAt=d.toISOString();}
  const meta={url,notes:form.elements.notes.value.trim(),tags,policy:form.elements.policy.value,expiresAt};
  const body=t?{action:'update',item:t.id,expected_revision:revision,...(name!==t.name?{name}:{}),...(Object.keys(values).length?{values}:{}),...(removeFields.length?{removeFields}:{}),...meta}:{action:'add',name,kind:k,values,...meta};
  const btn=form.querySelector('.primary');btn.disabled=true;
  try{
   const r=await api('/vault/act',{method:'POST',body:JSON.stringify(body),cache:'no-store'});
   mergeVaultItem(r.item);repaintVault();wipe();
   closeCurrentSheet?.();
   if(insert&&r.item)insert(r.item.name);
   toast(t?'Saved '+(r.item?.name||name):'Stored in the Vault as '+(r.item?.name||name));
  }catch(e2){
   if(e2.message==='login')return;
   const msg=e2.message||'Could not save.';
   if(vaultLockedError(e2)){err.textContent='The Vault locked before this was saved. Unlock it, then save again.';return;}
   if(e2.status===409&&e2.body?.item){mergeVaultItem(e2.body.item);revision=e2.body.item.revision;repaintVault();err.textContent='This secret changed on another device. Check the fields and save again.';return;}
   // A refused field name goes under the row that named it.
   const row=[...rowsBox.querySelectorAll('[data-new-field]')].find(r=>{const n=r.querySelector('[data-custom-name]').value.trim();return n&&new RegExp('(^|[^a-z0-9_])'+n+'($|[^a-z0-9_])').test(msg);});
   if(row)fieldError(row,msg,row.querySelector('[data-custom-name]'));
   else{err.textContent=msg;if(/name/i.test(msg)&&!/field/i.test(msg)){nameIn.setAttribute('aria-invalid','true');nameIn.focus();}}
  }finally{if(btn.isConnected)btn.disabled=false;}
 };
 mountSheet(scrim,sh);
}
// The composer's Store in the Vault: the add sheet, never the message. Once stored, the message box gets the name.
function addVaultItemFromComposer({insert=true}={}){
 const box=insert?(document.getElementById('box')||document.getElementById('first')):null;
 vaultEditor(null,{insert:box?name=>{
  if(!box.isConnected)return;
  const ref=`{{vault:${name}}}`,s=box.selectionStart??box.value.length,e=box.selectionEnd??s,before=box.value.slice(0,s),after=box.value.slice(e),pad=before&&!/\s$/.test(before)?' ':'';
  box.value=before+pad+ref+(after&&!/^\s/.test(after)?' ':'')+after;box.setSelectionRange(s+pad.length+ref.length,s+pad.length+ref.length);
  box.dispatchEvent(new Event('input',{bubbles:true}));box.focus({preventScroll:true});
 }:null});
}

/* ---------- Settings: the recovery key (1.44: the server makes and saves the key itself) ---------- */
const vaultToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
function rotateVaultKey(){
 confirmSheet('Rotate the Vault key?','Pocket re-encrypts the Vault under a new key, saves it on this server and shows you the new recovery key. Backups made before now still need the old key, so keep it with them.','Rotate key',async()=>{
  try{const r=await vaultPost('/vault/rotate',{});vaultRecoverySheet(r.key,{note:'New key saved on the server. Save the new recovery key; backups made before now still need the old one.'});}
  catch(e){if(e.message==='login')return;if(!vaultLockedError(e))toast(e.message||'Could not rotate the key');else toast('The Vault is locked. Unlock it, then rotate the key.');}
 });
}
// Settings → Download recovery key: the server's current key, recorded in the Vault history as a view.
async function vaultShowRecoveryKey(){
 try{const r=await vaultPost('/vault/recovery-key',{});vaultRecoverySheet(r.key);}
 catch(e){if(e.message==='login')return;if(!vaultLockedError(e))toast(e.message||'Could not get the recovery key');else toast('The Vault is locked. Unlock it, then download the key.');}
}
// One sheet for the first switch-on, Download recovery key and Rotate. The key lives in this sheet's field and
// nowhere else: not in storage, a toast or the console, and the field is emptied however the sheet closes.
function vaultRecoverySheet(key,{note=''}={}){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet vault-key-sheet';
 const fid='vk-'+(++vaultFieldSeq);
 sh.innerHTML=`<h2>Save your recovery key</h2>${note?`<p class="vault-key-note">${esc(note)}</p>`:''}
  <p class="sheet-help">This key opens your Vault. Pocket keeps it on this server, but if the server or its settings are lost, a backup of the Vault can only be opened with it. Keep it in your password manager.</p>
  <label class="vault-key-label" for="${fid}">Recovery key</label>
  <textarea class="vault-key" id="${fid}" readonly rows="2" spellcheck="false" autocapitalize="none" autocorrect="off" autocomplete="off"></textarea>
  <div class="vault-key-actions"><button class="chip" data-copy-key>${IC.copy}Copy</button><button class="chip" data-download-key>${VIC.download}Download</button><button class="primary" data-done>Done</button></div>`;
 const field=sh.querySelector('.vault-key');field.value=String(key||'');key=null;
 field.addEventListener('focus',()=>field.select());
 sh.querySelector('[data-copy-key]').onclick=e=>vaultCopy(field.value,e.currentTarget,'Recovery key');
 sh.querySelector('[data-download-key]').onclick=()=>{
  const day=vaultToday(),host=(location.hostname||'pocket').replace(/[^a-z0-9.-]+/gi,'-'),name=`pocket-vault-recovery-key-${host}-${day}.txt`;
  const text=`# Pocket Code Vault recovery key for ${location.host||host}, saved ${day}.\n# It opens this Vault and its backups. Keep it private, in your password manager.\nPOCKET_VAULT_KEY=${field.value}\n`;
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain'})),a=document.createElement('a');a.href=url;a.download=name;a.hidden=true;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  toast('Saved '+name);
 };
 // Done: back to Settings when it was opened from there, otherwise closed.
 sh.querySelector('[data-done]').onclick=()=>{field.value='';const back=sh._settingsParent;if(back)back();else closeCurrentSheet?.();};
 onSheetGone(sh,()=>{field.value='';});
 mountSheet(scrim,sh);
}
// The key is missing on this server but the Vault is still here: paste the recovery key or open the saved file.
const vaultKeyFromText=t=>String(t||'').trim().replace(/^POCKET_VAULT_KEY\s*=\s*/,'').replace(/^(["'])(.*)\1$/,'$2').trim();
function vaultRestoreKeySheet(){
 const fid='vp-'+(++vaultFieldSeq);
 const ctx=vaultPassSheet({title:'Restore the Vault key',cls:'vault-restore-sheet',
  help:'Paste the recovery key you saved when the Vault was turned on or its key was rotated. Pocket saves it on this server and opens the Vault.',
  fields:[['key','Recovery key','off']],
  after:`<div class="vault-secret"><label class="voice-field" for="${fid}">Or open the saved file</label><input type="file" id="${fid}" name="file" accept=".txt,text/plain" class="vault-file" aria-describedby="${fid}-h"><p class="vault-hint" id="${fid}-h">The .txt from Download recovery key. Pocket reads its POCKET_VAULT_KEY line.</p></div>`,
  submit:'Restore',
  onSubmit:async(v,ctx)=>{
   const key=vaultKeyFromText(v('key'));
   if(!key)return ctx.fail('Paste the recovery key, or open the saved file.','key');
   try{await vaultPost('/vault/restore-key',{key});}
   catch(e){if(e.status===400)return ctx.fail(e.message||'That key does not open this Vault.','key');throw e;}
   ctx.wipe();if(typeof vaultOn==='function'&&vaultOn())vaultAfterModeChange();
   ctx.done('Vault restored');
  }});
 const file=ctx.form.elements.file;
 file.onchange=async()=>{
  const f=file.files?.[0];if(!f)return;
  let text='';try{text=await f.text();}catch{return ctx.fail('Could not read the file.','file');}
  const line=/^\s*POCKET_VAULT_KEY\s*=\s*(\S+)\s*$/m.exec(text);text='';
  if(!line)return ctx.fail('That file has no POCKET_VAULT_KEY line. Choose the recovery key file, or paste the key.','file');
  const input=ctx.form.elements.key;input.value=vaultKeyFromText(line[1]);input.dispatchEvent(new Event('input',{bubbles:true}));
  ctx.result.textContent='Key read from '+f.name+'.';
 };
 onSheetGone(ctx.sh,()=>{file.value='';});
}

/* ---------- 1.40: the passphrase, the lock, export and import ---------- */
// One sheet for every passphrase form. fields: [name, label, autocomplete, hint]. A passphrase lives only in these
// inputs and the request body: never in a variable that outlives the submit, storage, a toast or the console, and the
// inputs are wiped however the sheet closes. Password managers are welcome here (autocomplete is set, not off).
function vaultPassFieldHTML([name,label,ac,hint]){
 const id='vp-'+(++vaultFieldSeq);
 return `<div class="vault-secret"><label class="voice-field" for="${id}" id="${id}-l">${esc(label)}</label>
  <div class="vault-secret-input"><input type="password" id="${id}" name="${name}" data-pass autocomplete="${ac}" spellcheck="false" autocapitalize="none" autocorrect="off" ${hint?`aria-describedby="${id}-h"`:''}>${vaultRevealBtn(id,id+'-l')}</div>
  ${hint?`<p class="vault-hint" id="${id}-h">${esc(hint)}</p>`:''}</div>`;
}
function vaultPassSheet({title,help,fields,warn,submit,cls='',before='',after='',onSubmit}){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className=('sheet vault-pass-sheet '+cls).trim();
 sh.innerHTML=`<h2>${esc(title)}</h2>${help?`<p class="sheet-help vault-pass-help">${esc(help)}</p>`:''}
  <form class="project-form vault-form" novalidate>${before}${fields.map(vaultPassFieldHTML).join('')}${after}
   ${warn?`<p class="vault-pass-warn">${esc(warn)}</p>`:''}
   <p class="vault-form-error" role="alert"></p><p class="vault-pass-result" role="status"></p>
   <button class="primary" type="submit">${esc(submit)}</button></form>`;
 const form=sh.querySelector('form'),err=sh.querySelector('.vault-form-error'),btn=form.querySelector('.primary');
 const wipe=()=>form.querySelectorAll('[data-pass]').forEach(el=>{el.value='';});
 form.querySelectorAll('[data-reveal]').forEach(b=>b.onclick=()=>{const el=document.getElementById(b.dataset.reveal),on=b.getAttribute('aria-pressed')!=='true';el.type=on?'text':'password';b.setAttribute('aria-pressed',String(on));});
 form.addEventListener('input',e=>{e.target.removeAttribute?.('aria-invalid');err.textContent='';});
 const ctx={sh,form,wipe,result:sh.querySelector('.vault-pass-result'),
  fail(msg,name){err.textContent=msg;const el=name&&form.elements[name];if(el){el.setAttribute('aria-invalid','true');el.focus();if(el.dataset.pass!==undefined)el.select();}},
  // Done: back to Settings when it was opened from there, otherwise closed.
  done(msg){wipe();const back=sh._settingsParent;if(back)back();else closeCurrentSheet?.();if(msg)toast(msg);},
 };
 form.onsubmit=async e=>{
  e.preventDefault();if(btn.disabled)return;err.textContent='';form.querySelectorAll('[aria-invalid]').forEach(x=>x.removeAttribute('aria-invalid'));
  btn.disabled=true;
  try{await onSubmit(name=>form.elements[name]?.value??'',ctx);}
  catch(e2){if(e2.message!=='login'&&sh.isConnected)ctx.fail(e2.message||'Something went wrong.');}
  finally{if(btn.isConnected)btn.disabled=false;}
 };
 onSheetGone(sh,wipe);
 mountSheet(scrim,sh);
 return ctx;
}
// A new passphrase: long enough, typed the same twice. Returns false after marking the field.
function vaultCheckNewPass(v,ctx){
 if(v('passphrase').length<VAULT_PASS_MIN){ctx.fail(`Use at least ${VAULT_PASS_MIN} characters.`,'passphrase');return false;}
 if(v('confirm')!==v('passphrase')){ctx.fail('The two passphrases are different. Type it again.','confirm');return false;}
 return true;
}
const vaultAfterModeChange=()=>{vaultAutoLock=null;loadVault(true).then(repaintVault).catch(()=>{});};
// then: what to open once it is unlocked (the editor that was asked for while locked).
function vaultUnlockSheet(then){
 vaultPassSheet({title:'Unlock the Vault',help:'Enter the Vault passphrase. Agents can use secrets again as soon as it opens.',cls:'vault-unlock-sheet',
  fields:[['passphrase','Passphrase','current-password']],submit:'Unlock',
  onSubmit:async(v,ctx)=>{
   if(!v('passphrase'))return ctx.fail('Enter the passphrase.','passphrase');
   try{await vaultPost('/vault/unlock',{passphrase:v('passphrase')});}
   catch(e){if(e.status===401||e.status===429)return ctx.fail(e.message||(e.status===429?'Too many tries. Wait a few minutes, then try again.':'Wrong passphrase.'),'passphrase');throw e;}
   ctx.wipe();
   try{await loadVault(true);}catch{}
   repaintVault();
   if(then){closeCurrentSheet?.();then();}else ctx.done('The Vault is unlocked');
  }});
}
function vaultPassphraseSheet(change){
 vaultPassSheet({title:change?'Change the passphrase':'Set a passphrase',cls:'vault-passphrase-sheet',
  help:change?'Pocket re-encrypts the Vault under the new passphrase.':'Pocket encrypts the Vault under this passphrase and holds it in memory only. After a restart the Vault stays locked until you unlock it here.',
  fields:[...(change?[['current','Current passphrase','current-password']]:[]),['passphrase',change?'New passphrase':'Passphrase','new-password',`At least ${VAULT_PASS_MIN} characters. A few unrelated words are easy to type and hard to guess.`],['confirm','Type it again','new-password']],
  warn:'If you forget it, the Vault cannot be opened and there is no reset. Keep it in your password manager.',
  submit:change?'Change passphrase':'Set passphrase',
  onSubmit:async(v,ctx)=>{
   if(change&&!v('current'))return ctx.fail('Enter the current passphrase.','current');
   if(!vaultCheckNewPass(v,ctx))return;
   try{await vaultPost('/vault/passphrase',{action:'set',passphrase:v('passphrase'),confirm:v('confirm'),...(change?{current:v('current')}:{})});}
   catch(e){if(e.status===401)return ctx.fail(e.message||'The current passphrase is wrong.',change?'current':'passphrase');throw e;}
   vaultAfterModeChange();ctx.done(change?'Passphrase changed':'The Vault is now protected by a passphrase');
  }});
}
function vaultRemovePassphraseSheet(){
 vaultPassSheet({title:'Remove the passphrase?',cls:'vault-passphrase-sheet',
  help:'The Vault goes back to the server key in .env (POCKET_VAULT_KEY): it opens whenever Pocket Code runs and never locks. Enter the passphrase to confirm.',
  fields:[['passphrase','Passphrase','current-password']],submit:'Remove passphrase',
  onSubmit:async(v,ctx)=>{
   if(!v('passphrase'))return ctx.fail('Enter the passphrase.','passphrase');
   try{await vaultPost('/vault/passphrase',{action:'remove',passphrase:v('passphrase')});}
   catch(e){
    if(e.status===401)return ctx.fail(e.message||'Wrong passphrase.','passphrase');
    if(e.code==='vault_no_key')return ctx.fail('POCKET_VAULT_KEY is not set on the server. Add it to .env and restart Pocket Code, then remove the passphrase.');
    throw e;
   }
   vaultAfterModeChange();ctx.done('The Vault is opened by the server key again');
  }});
}
async function vaultLockNow(){
 try{await vaultPost('/vault/lock',{});toast('The Vault is locked');}
 catch(e){if(e.message!=='login')toast(e.message||'Could not lock the Vault');return false;}
 vaultAfterModeChange();return true;
}
function vaultExportSheet(){
 vaultPassSheet({title:'Export the Vault',cls:'vault-export-sheet',
  help:'Downloads every item in one file, encrypted with this passphrase. Import it into another Pocket Code or keep it as your own backup.',
  fields:[['passphrase','Passphrase for the file','new-password',`At least ${VAULT_PASS_MIN} characters. You need it to import the file.`],['confirm','Type it again','new-password']],
  submit:'Export',
  onSubmit:async(v,ctx)=>{
   if(!vaultCheckNewPass(v,ctx))return;
   let r;try{r=await vaultPost('/vault/export',{passphrase:v('passphrase'),confirm:v('confirm')},{blob:true});}
   catch(e){if(vaultLockedError(e))return ctx.fail('The Vault is locked. Unlock it, then export.');throw e;}
   const d=new Date(),name=(/filename="?([^";]+)"?/i.exec(r.disposition)||[])[1]||`pocket-vault-export-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}.pvault`;
   // fetch + a blob link, so the download carries the cookie and the passphrase never sits in a URL.
   const url=URL.createObjectURL(r.blob),a=document.createElement('a');a.href=url;a.download=name;a.hidden=true;document.body.append(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),60000);
   ctx.done('Exported to '+name);
  }});
}
const vaultFileBase64=file=>new Promise((ok,no)=>{const fr=new FileReader();fr.onload=()=>ok(String(fr.result).split(',')[1]||'');fr.onerror=()=>no(new Error('Could not read the file.'));fr.readAsDataURL(file);});
function vaultImportSheet(){
 const fid='vp-'+(++vaultFieldSeq);let finished=false;
 vaultPassSheet({title:'Import into the Vault',cls:'vault-import-sheet',
  help:'Adds the items in a Pocket Code Vault export. An item whose name is already here is left as it is.',
  before:`<div class="vault-secret"><label class="voice-field" for="${fid}">Export file</label><input type="file" id="${fid}" name="file" accept=".pvault" class="vault-file"></div>`,
  fields:[['passphrase','Passphrase of the file','current-password']],submit:'Import',
  onSubmit:async(v,ctx)=>{
   if(finished)return ctx.done();
   const file=ctx.form.elements.file.files?.[0];
   if(!file)return ctx.fail('Choose a .pvault file.','file');
   if(!v('passphrase'))return ctx.fail('Enter the passphrase the file was exported with.','passphrase');
   const data=await vaultFileBase64(file);
   let r;try{r=await vaultPost('/vault/import',{data,passphrase:v('passphrase')});}
   catch(e){if(vaultLockedError(e))return ctx.fail('The Vault is locked. Unlock it, then import.');throw e;}
   const n=Number(r.added)||0,skipped=Array.isArray(r.skipped)?r.skipped:[];
   loadVault(true).then(repaintVault).catch(()=>{});
   toast(n===1?'Imported 1 item':`Imported ${n} items`);
   if(!skipped.length)return ctx.done();
   // Names that were already here stay listed until the sheet closes.
   ctx.wipe();finished=true;ctx.result.textContent='Already here: '+skipped.join(', ');
   const btn=ctx.form.querySelector('.primary');btn.textContent='Done';
  }});
}

/* ---------- rail, home chip, badges, tabs ---------- */
function railVaultHTML(){
 if(!vaultSnap)return '<p class="sheet-help">Loading the Vault…</p>';
 if(vaultIsLocked())return `<div class="rail-projects rail-vault">${vaultLockedHTML('rail')}</div>`;
 const reqs=vaultRequests();
 return `<div class="rail-projects rail-vault"><div class="rail-project-actions"><button class="chip" id="rail-vault-add">${IC.plus}Add secret</button><a class="chip" href="${viewHref('vault')}" data-view-link>All</a></div>
  ${reqs.length?`<section class="vault-requests" aria-label="Requests waiting">${reqs.map(r=>vaultRequestHTML(r,'rail')).join('')}</section>`:''}
  ${vaultSnap.items.length?vaultSorted(vaultSnap.items).slice(0,60).map(vaultRowHTML).join(''):'<p class="sheet-help">No secrets yet. Add one, or use Store in the Vault in a conversation.</p>'}
  ${vaultSnap.trash.length?`<a class="rail-done-link" href="${viewHref('vault')}" data-view-link>${vaultSnap.trash.length} removed</a>`:''}</div>`;
}
function paintRailVault(){
 const el=document.getElementById('rail');if(!el||railView()!=='vault')return;
 el.innerHTML=railVaultHTML();
 el.querySelector('#rail-vault-add')?.addEventListener('click',()=>vaultEditor(null));
 el.querySelector('#rail-vault-unlock')?.addEventListener('click',()=>vaultUnlockSheet());
 bindVaultRows(el);
 if(!vaultSnap)loadVault().then(()=>{paintRailVault();paintVaultBadges();}).catch(()=>{const r=document.getElementById('rail');if(r&&railView()==='vault')r.innerHTML='<p class="sheet-help">The Vault could not load.</p>';});else paintVaultBadges();
}
// While locked, the rail's Vault segment and the home chip carry a lock; screen readers hear "Vault, locked".
const VAULT_LOCK_MARK=`<span class="vault-lock-glyph" data-vault-lock><span aria-hidden="true">${VIC.lock}</span><span class="vault-sr">, locked</span></span>`;
function paintVaultBadges(){
 const n=vaultRequestCount(),locked=vaultIsLocked();
 document.querySelectorAll('[data-vault-badge]').forEach(el=>{el.textContent=n?String(n):'';el.hidden=!n;});
 document.querySelectorAll('[data-rail-view="vault"]').forEach(b=>{const g=b.querySelector('[data-vault-lock]');if(locked&&!g)b.querySelector('[data-vault-badge]')?.insertAdjacentHTML('beforebegin',VAULT_LOCK_MARK);else if(!locked)g?.remove();});
 document.querySelectorAll('[data-vault-home]').forEach(el=>{el.innerHTML='Vault'+(locked?VAULT_LOCK_MARK:'')+(n?' · '+n+' waiting':'');el.classList.toggle('due',n>0);});
 if(typeof vaultToastNew==='function')vaultToastNew(); // 1.104
}
const vaultTabState=()=>{const n=vaultRequestCount();return n?{kind:'input',label:n===1?'A request is waiting':n+' requests are waiting'}:null;};
/* ---------- 1.104 (Damon): the request shows in the conversation that raised it ----------
A device push can go by unseen; the Vault tab badge is small. So the conversation gets the same kind of banner an
approval gets, with Deny / Always allow / Allow once, and a toast the moment a new request appears anywhere in the app. */
const vaultRequestsFor=id=>vaultRequests().filter(r=>r.session===id);
async function refreshVaultBanner(id){
 const b=document.getElementById('vault-open');if(!b||chatId!==id)return;
 try{await loadVault(true);}catch{return;}
 if(chatId!==id)return;
 repaintVault();
 const reqs=vaultRequestsFor(id);
 b.hidden=!reqs.length;
 const label=document.getElementById('work-label');
 if(!reqs.length){if(label&&label.textContent==='Waiting for your OK on the Vault')label.textContent='Working';return;}
 if(reqs.length===1){
  const r=reqs[0],fill=Array.isArray(r.argv)&&r.argv[0]==='pocket-fill',names=vaultRequestNames(r);
  const note=fill?`Fill ${names} into a web page (${r.argv[2]||''})`:(Array.isArray(r.argv)?r.argv.join(' '):'');
  const answer=async(decision,button)=>{
   if(typeof waitBannerBusy==='function')waitBannerBusy(b,'Sending your answer…');
   vaultMissed.delete(r.id);
   const out=await vaultAct({action:'answer',request:r.id,decision},decision==='deny'?'Denied':decision==='always'?'Allowed. This command is remembered for '+names:'Allowed once');
   if(!out)b.querySelectorAll('button').forEach(x=>x.disabled=false);
   refreshVaultBanner(id);if(typeof refreshSessions==='function')refreshSessions();
  };
  const actions=[{label:'Deny',run:()=>answer('deny')}];
  if(r.allowAlways!==false)actions.push({label:'Always allow',run:()=>answer('always')});
  actions.push({label:'Allow once',primary:true,run:()=>answer('once')});
  paintWaitBanner(b,{title:`The agent wants to ${fill?'fill':'use'} ${names}${fill?'':' for this command'}`,note,mono:!fill,cta:'Details',mark:IC.info,actions});
 } else paintWaitBanner(b,{title:reqs.length+' Vault requests need your OK',note:'The reply is paused until you answer them in the Vault.',cta:'Review',mark:IC.info});
 if(label)label.textContent='Waiting for your OK on the Vault';
}
function openVaultRequestFor(id){
 const reqs=vaultRequestsFor(id);
 location.hash=reqs.length===1?'#/vault/request/'+encodeURIComponent(reqs[0].id):'#/vault/requests';
}
// A toast the first time each request is seen on this page, wherever the owner is in the app.
const vaultToasted=new Set();
function vaultToastNew(){
 for(const r of vaultRequests()){
  if(vaultToasted.has(r.id))continue;vaultToasted.add(r.id);
  if(typeof toast!=='function')continue;
  const title=r.session?(r.sessionTitle||(typeof sessionName==='function'?sessionName(r.session):'')||''):'';
  toast(`Vault: ${title?'“'+title+'”':'an agent'} is waiting for your OK to use ${vaultRequestNames(r)}`);
 }
}
setInterval(()=>{if(!vaultOn()||document.visibilityState!=='visible'||!(vaultView||railView()==='vault'||document.querySelector('[data-vault-home],[data-vault-badge]')||openSessions?.some?.(s=>s.id==='vault')))return;loadVault(true).then(()=>{repaintVault();}).catch(()=>{});},30000);

/* ---------- 1.42: catching secrets in the composer ----------
   A key or password pasted, dropped or typed into a message is held before it reaches the model, the transcript or
   MemStem, and the owner is offered the Vault instead. The detector is the shared secret-detect.js (PocketSecrets); the
   server runs the same check on every message and answers 422 secret_detected. Held text lives only in the closures
   below: never in a textarea, a draft, storage, the outbox, a toast, the DOM of the sheet or the console. The sheet
   names what was found and how long it is, never any of its characters. */
const secretGuard={on:(()=>{try{return localStorage.getItem('pc-secret-guard')!=='off';}catch{return true;}})(),loaded:false};
// The setting is install-wide (Settings → Vault); this device remembers the last value so a reload starts with it.
function setSecretGuard(on){secretGuard.on=on!==false;try{localStorage.setItem('pc-secret-guard',secretGuard.on?'on':'off');}catch{}}
const secretsOn=()=>secretGuard.on&&Boolean(window.PocketSecrets);
function loadSecretGuard(){
 if(secretGuard.loaded)return;secretGuard.loaded=true;
 api('/settings',{cache:'no-store',signal:AbortSignal.timeout(12000)}).then(s=>setSecretGuard(s.secretGuard)).catch(()=>{secretGuard.loaded=false;});
}
const SECRET_KINDS=[['api_key','API key'],['token','Token'],['note','Secure note']];
const secretLen=h=>{const n=h.end-h.start;return n+(n===1?' character':' characters');};
const secretCap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const secretList=parts=>parts.length<2?parts.join(''):parts.slice(0,-1).join(', ')+' and '+parts.at(-1);
// "An OpenAI API key, 164 characters." or "An OpenAI API key (164 characters) and a password or secret (9 characters)."
const secretWhat=hits=>!hits.length?'It has what looks like a key or password.':secretCap(hits.length===1?`${hits[0].label}, ${secretLen(hits[0])}`:secretList(hits.map(h=>`${h.label} (${secretLen(h)})`)))+'.';
// Matches from the server are checked against the text they describe; anything that does not fit is dropped.
function secretHits(text,hits){
 const n=String(text||'').length;let end=0;
 return (Array.isArray(hits)?hits:[]).filter(h=>h&&Number.isInteger(h.start)&&Number.isInteger(h.end)&&h.start>=end&&h.end>h.start&&h.end<=n&&(end=h.end,true))
  .map(h=>({kind:String(h.kind||''),label:String(h.label||'a secret'),name:VAULT_NAME_RE.test(String(h.name||''))?String(h.name):'secret',vaultKind:SECRET_KINDS.some(([v])=>v===h.vaultKind)?h.vaultKind:'api_key',start:h.start,end:h.end}));
}
// Can the Vault take it now? off, locked, unready (no key, failed to open) or ready with every name already used.
async function secretVaultState(){
 if(!vaultOn())return {state:'off'};
 try{const s=await loadVault(true);if(s.ready===false)return {state:s.locked?'locked':'unready'};return {state:'ready',names:[...(s.items||[]),...(s.trash||[])].map(i=>i.name)};}
 catch(e){return {state:e?.status===423?'locked':'unready'};}
}
const SECRET_HINT={get off(){return featuresLocked()?'Ask the person who runs this install to turn on the Vault, to store secrets instead.':'Turn on the Vault in Settings to store secrets instead.';},locked:'Unlock the Vault to store it.',unready:'The Vault is not ready, so it cannot store this now.'};
// Over an open sheet (the queue editor in its dialog) the guard stacks instead of replacing it; elsewhere it is an
// ordinary sheet. Returns the close function.
function secretMount(scrim,sh,trigger){
 const parent=trigger?.closest?.('.sheet[role=dialog]');
 if(!parent)return mountSheet(scrim,sh,trigger||undefined);
 scrim.classList.add('scrim-over');sh.classList.add('sheet-over');
 const heading=sh.querySelector('h2');heading.id='secret-sheet-title';
 sh.setAttribute('role','dialog');sh.setAttribute('aria-modal','true');sh.setAttribute('aria-labelledby',heading.id);sh.tabIndex=-1;
 const x=document.createElement('button');x.className='sheet-close icon';x.setAttribute('aria-label','Close dialog');x.innerHTML=IC.x;sh.prepend(x);
 const items=()=>[...sh.querySelectorAll('button,input,select')].filter(el=>!el.disabled&&el.getClientRects().length);
 const keydown=e=>{
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}
  if(e.key==='Tab'){const l=items(),f=l[0],z=l.at(-1);if(e.shiftKey&&document.activeElement===f){e.preventDefault();z.focus();}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();f.focus();}}
 };
 const close=()=>{sh.removeEventListener('keydown',keydown);scrim.remove();sh.remove();parent.inert=false;if(trigger?.isConnected)trigger.focus({preventScroll:true});};
 scrim.onclick=close;x.onclick=close;sh.addEventListener('keydown',keydown);
 parent.inert=true;document.body.append(scrim,sh);(items().find(el=>el.matches('input'))||x).focus();
 return close;
}
/* The one sheet for a paste (or drop) and a send. mode 'paste' | 'send'. text is the held text; hits its spans.
   onAsIs(): use the text unchanged. onStore(replaced): every hit is stored; replaced has a {{vault:name}} for each. */
async function openSecretSheet({mode,text,hits,trigger,onAsIs,onStore}){
 const vault=hits.length?await secretVaultState():{state:'none'},ready=vault.state==='ready',many=hits.length>1,paste=mode==='paste';
 if(trigger&&!trigger.isConnected)trigger=null;
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet secret-sheet';
 const taken=[...(vault.names||[])],names=hits.map(h=>{const n=PocketSecrets.uniqueName(h.name,taken);taken.push(n);return n;});
 const it=many?'them':'it';
 const rows=hits.map((h,i)=>`<div class="secret-row" role="group" aria-labelledby="${many?'secret-row-'+i:'secret-what'}" data-row="${i}">
   ${many?`<p class="secret-row-head" id="secret-row-${i}">${esc(secretCap(h.label))} · ${esc(secretLen(h))}</p>`:''}
   <label class="voice-field secret-name">Name<input type="text" name="name-${i}" value="${esc(names[i])}" maxlength="64" required spellcheck="false" autocapitalize="none" autocorrect="off" autocomplete="off" class="vault-name-input" aria-describedby="secret-row-${i}-e secret-name-hint"></label>
   <label class="voice-field secret-kind">Kind<select name="kind-${i}">${SECRET_KINDS.map(([v,l])=>`<option value="${v}" ${v===h.vaultKind?'selected':''}>${l}</option>`).join('')}</select></label>
   <p class="vault-field-error" id="secret-row-${i}-e"></p></div>`).join('');
 const asIs=paste?['Paste as is','It goes to the model and stays in the transcript']:['Send as is','It goes to the model and stays in the transcript'];
 const back=paste?['Cancel','Nothing is pasted']:['Edit','Back to the message. Nothing is sent'];
 sh.innerHTML=`<h2>That looks like a secret</h2>
  <p class="secret-what" id="secret-what">${esc(secretWhat(hits))}</p>
  ${ready?`<p class="sheet-help secret-help">${paste?`Store ${it} in the Vault and the message gets a placeholder that agents use instead.`:`Store ${it} in the Vault and send the message with a placeholder that agents use instead.`}</p>
   <form class="project-form vault-form secret-form" autocomplete="off" novalidate>${rows}
    <p class="vault-hint" id="secret-name-hint">Lowercase letters, numbers and hyphens. Agents use this name.</p>
    <p class="vault-form-error" role="alert"></p>
    <button class="primary" type="submit">${paste?'Store in the Vault':'Store and send'}</button></form>`
  :`<p class="sheet-help secret-help">${paste?'Pasting it sends it to the model and keeps it in the transcript.':'Sending it gives it to the model and keeps it in the transcript.'}</p>
   ${SECRET_HINT[vault.state]?`<p class="secret-hint">${esc(SECRET_HINT[vault.state])}</p>`:''}`}
  <div class="opt-group secret-alt"><button class="opt" type="button" data-as-is>${paste?IC.doc:IC.up}<span>${asIs[0]}<span class="sub">${asIs[1]}</span></span></button>
   <button class="opt" type="button" data-back>${paste?IC.x:IC.pen}<span>${back[0]}<span class="sub">${back[1]}</span></span></button></div>`;
 let decided=false,held=text;
 onSheetGone(sh,()=>{held=null;}); // closed any way at all: the text goes with the sheet
 const close=secretMount(scrim,sh,trigger);
 const finish=fn=>{if(decided)return;decided=true;const t=held;held=null;close();fn(t);};
 sh.querySelector('[data-as-is]').onclick=()=>finish(t=>onAsIs(t));
 sh.querySelector('[data-back]').onclick=()=>finish(()=>{});
 const form=sh.querySelector('form');if(!form)return;
 const err=form.querySelector('.vault-form-error'),btn=form.querySelector('.primary'),stored=new Map(); // row -> stored name
 form.addEventListener('input',e=>{const el=e.target;if(el.matches('.vault-name-input')){const v=el.value.toLowerCase().replace(/[\s_]/g,'-');if(v!==el.value){const p=el.selectionStart;el.value=v;el.setSelectionRange(p,p);}el.removeAttribute('aria-invalid');el.closest('.secret-row').querySelector('.vault-field-error').textContent='';err.textContent='';}});
 const rowFail=(i,msg)=>{const row=form.querySelector(`[data-row="${i}"]`),el=row.querySelector('input');row.querySelector('.vault-field-error').textContent=msg;el.setAttribute('aria-invalid','true');el.focus();};
 form.onsubmit=async e=>{
  e.preventDefault();if(btn.disabled||decided||held==null)return;err.textContent='';
  const picks=hits.map((h,i)=>({i,name:form.elements['name-'+i].value.trim(),kind:form.elements['kind-'+i].value}));
  const seen=new Set();
  for(const p of picks){if(stored.has(p.i))continue;
   if(!VAULT_NAME_RE.test(p.name))return rowFail(p.i,'Use 1 to 64 lowercase letters, numbers or hyphens.');
   if((vault.names||[]).includes(p.name)||seen.has(p.name)||[...stored.values()].includes(p.name))return rowFail(p.i,`The Vault already has ${p.name}. Choose another name.`);
   seen.add(p.name);}
  btn.disabled=true;
  try{
   for(const p of picks){
    if(stored.has(p.i))continue;
    const value=held.slice(hits[p.i].start,hits[p.i].end);
    let r;
    try{r=await api('/vault/act',{method:'POST',body:JSON.stringify({action:'add',name:p.name,kind:p.kind,values:p.kind==='note'?{text:value}:{value}}),cache:'no-store'});}
    catch(e2){
     if(e2.message==='login')return;
     if(vaultLockedError(e2)){err.textContent='The Vault locked before this was stored. Unlock it, then try again, or choose another option.';return;}
     return rowFail(p.i,e2.message||'Could not store this.');
    }
    stored.set(p.i,r.item?.name||p.name);mergeVaultItem(r.item);
    const row=form.querySelector(`[data-row="${p.i}"]`);row.classList.add('stored');row.querySelector('.secret-row-head')?.insertAdjacentHTML('beforeend',' <span class="secret-stored">· Stored</span>');row.querySelectorAll('input,select').forEach(el=>{el.disabled=true;});
   }
   repaintVault();
   const final=hits.map((_,i)=>stored.get(i)),replaced=PocketSecrets.replaceSpans(held,hits,final);
   finish(()=>onStore(replaced));
   toast('Stored in the Vault as '+secretList(final)+(paste?'; the message has a placeholder':'; sending the message with a placeholder'));
  }finally{if(btn.isConnected)btn.disabled=false;}
 };
}
// Put text into a box at the selection it had when the paste was held. A box that was re-rendered meanwhile (the
// composer redraws when a turn starts or ends) is found again by id; a box that is gone gets nothing.
function secretInsert(el,sel,str){
 const live=el?.isConnected?el:el?.id?document.getElementById(el.id):null;
 if(!live||live.readOnly||live.disabled){toast('The message box closed, so nothing was pasted.');return;}
 const n=live.value.length,[s,e]=live===el?[Math.min(sel[0],n),Math.min(sel[1],n)]:[live.selectionStart??n,live.selectionEnd??n];
 live.focus({preventScroll:true});live.setSelectionRange(s,e);
 // insertText keeps the browser's undo history; setRangeText is the fallback.
 if(!document.execCommand?.('insertText',false,str)){live.setRangeText(str,s,e,'end');live.dispatchEvent(new Event('input',{bubbles:true}));}
}
const SECRET_BOXES='#box,#first,.queue-editor';
// A paste or a text drop into a message box. Returns true when the text was held (the event is cancelled).
function secretGuardInput(event,text){
 const el=event.target;
 if(!secretsOn()||!el?.matches?.(SECRET_BOXES)||el.readOnly||el.disabled||!text)return false;
 const hits=PocketSecrets.scan(text,{mode:'paste'});if(!hits.length)return false;
 event.preventDefault();
 const sel=[el.selectionStart??el.value.length,el.selectionEnd??el.value.length];
 openSecretSheet({mode:'paste',text,hits,trigger:el,onAsIs:t=>secretInsert(el,sel,t),onStore:t=>secretInsert(el,sel,t)});
 return true;
}
let secretDragInside=false; // moving text within a box is not a new paste
document.addEventListener('dragstart',e=>{secretDragInside=Boolean(e.target?.matches?.(SECRET_BOXES));});
document.addEventListener('dragend',()=>{secretDragInside=false;});
document.addEventListener('drop',e=>{
 if(secretDragInside||!e.target?.matches?.(SECRET_BOXES)||e.dataTransfer?.files?.length)return;
 secretGuardInput(e,e.dataTransfer?.getData('text/plain')||'');
});
/* Before a send. matches: the server's 422 spans for text; without them the text is scanned here (when the guard is on).
   Returns true when the send is held: the sheet is open and onAsIs / onStore decide what is sent. */
function secretHold(text,{matches=null,trigger=null,onAsIs,onStore}={}){
 let hits=matches?secretHits(text,matches):null;
 if(!hits||!hits.length){if(!window.PocketSecrets||(!matches&&!secretsOn()))return false;hits=PocketSecrets.scan(text,{mode:'message'});}
 if(!hits.length&&!matches)return false; // a 422 whose spans do not fit this text still opens the sheet, without Store
 openSecretSheet({mode:'send',text,hits,trigger,onAsIs,onStore});
 return true;
}

/* Split view (desktop): more sessions beside the main conversation, like editor groups.
   Each pane is a full Pocket Code instance in a same-origin frame (?pane=1), so it keeps
   its own stream, composer, draft and sheets. Panes never move in the DOM once created:
   moving a frame reloads it. */
const SPLIT_MIN=380,SPLIT_MAX_PANES=3,SPLIT_GRIP=5;
let splitRailObserver=null,observedSplitRail=null;
// id null = the pane is on its New session screen until that session starts
const validPane=p=>p&&typeof p.key==='string'&&/^[0-9a-f-]{36}$/.test(p.key)&&(p.id===null||typeof p.id==='string'&&(/^(?:(?:cx:)?[0-9a-f-]{36}|acp:ses_[0-9A-Za-z-]{1,64})$/.test(p.id)||isViewId(p.id))); // 1.29: a pane may show a project view
let splitPanes=PANE?[]:readLocal('pc-split-panes',[]);
splitPanes=Array.isArray(splitPanes)?splitPanes.filter(validPane).slice(0,SPLIT_MAX_PANES).map(p=>({key:p.key,id:p.id,w:Number.isFinite(p.w)?p.w:null})):[];
const saveSplit=()=>writeLocal('pc-split-panes',splitPanes);
const paneSrc=(key,id)=>'/?pane='+key+(id?tabHref(id):'#/new');
const sessionTitle=id=>!id?'New conversation':isViewId(id)?(typeof viewTitle==='function'?viewTitle(id):'Projects'):allSessions.find(s=>s.id===id)?.title||openSessions.find(s=>s.id===id)?.title||'Conversation';
const railSpace=()=>{const rail=document.querySelector('aside.rail');if(!rail)return 0;const grip=document.getElementById('grip');return Math.round(rail.getBoundingClientRect().width+(grip?.getBoundingClientRect().width||0));};
const dockSpace=()=>Math.round(document.querySelector('.workspace-dock')?.getBoundingClientRect().width||0);
function splitHasRoom(){return innerWidth>=900 && innerWidth-railSpace()-dockSpace()>=(splitPanes.length+2)*SPLIT_MIN+(splitPanes.length+1)*SPLIT_GRIP;}
function paintSplit(){
 const host=document.getElementById('panes');if(!host)return;host.setAttribute('role','region');host.setAttribute('aria-label','Side conversations');
 for(const section of [...host.querySelectorAll('.split-pane')])if(!splitPanes.some(p=>p.key===section.dataset.key)){section.previousElementSibling?.remove();section.remove();}
 for(const p of splitPanes){
  let section=host.querySelector(`.split-pane[data-key="${CSS.escape(p.key)}"]`);
  if(!section){
   const grip=document.createElement('div');
   grip.className='pane-grip';grip.setAttribute('role','separator');grip.setAttribute('aria-orientation','vertical');grip.tabIndex=0;
   grip.setAttribute('aria-label','Resize pane');grip.dataset.tip='Drag to resize. Double-click to share space equally.';
   section=document.createElement('section');section.className='split-pane';section.dataset.key=p.key;section.id='pane-'+p.key;
   grip.setAttribute('aria-controls',section.id);grip.setAttribute('aria-valuemin',String(SPLIT_MIN));grip.setAttribute('aria-valuenow',String(SPLIT_MIN));grip.setAttribute('aria-valuemax',String(SPLIT_MIN));
   const frame=document.createElement('iframe');frame.src=paneSrc(p.key,p.id);
   section.append(frame);
   // 1.53.3: a pane opened from another pane sits to its left. Insert before the next pane that already has a
   // frame so the DOM follows splitPanes without moving (and so reloading) any existing frame.
   const next=splitPanes.slice(splitPanes.indexOf(p)+1).map(q=>host.querySelector(`.split-pane[data-key="${CSS.escape(q.key)}"]`)).find(Boolean);
   if(next)next.previousElementSibling.before(grip,section);else host.append(grip,section);
   bindPaneGrip(grip,section);
  }
  section.querySelector('iframe').title='Conversation beside: '+sessionTitle(p.id);
  section.style.flex=p.w?`0 1 ${p.w}px`:'';
 }
 host.hidden=!splitPanes.length;
 document.body.classList.toggle('has-panes',splitPanes.length>0);
 sizeMainForSplit();
}
// The main column holds the rail too; give its conversation the same share as a pane.
function sizeMainForSplit(){
 if(PANE)return;
 const app=document.getElementById('app'),host=document.getElementById('panes');if(!app||!host)return;
 const rail=railSpace(),reserved=rail+dockSpace(),available=innerWidth-reserved;
 const count=innerWidth<900?0:Math.max(0,Math.min(splitPanes.length,Math.floor((available-SPLIT_MIN)/(SPLIT_MIN+SPLIT_GRIP))));
 const sections=[...host.querySelectorAll('.split-pane')];
 sections.forEach((section,i)=>{
  // Hide in place: moving or recreating an iframe would lose its input and stream.
  const hide=i>=count;
  if(hide&&section.contains(document.activeElement))document.querySelector('#splitb,#box,#first')?.focus({preventScroll:true});
  section.hidden=hide;section.previousElementSibling.hidden=hide;
 });
 host.hidden=count===0;
 app.style.flexBasis=count?reserved+'px':'';
 app.style.minWidth=count?reserved+SPLIT_MIN+'px':'';
 const max=Math.max(SPLIT_MIN,available-count*SPLIT_GRIP-count*SPLIT_MIN);
 for(const section of sections.slice(0,count)){
  const pane=splitPanes.find(p=>p.key===section.dataset.key);
  section.style.flex=pane?.w?`0 1 ${Math.min(max,Math.max(SPLIT_MIN,pane.w))}px`:'';
 }
 // Layout has settled synchronously after the styles above; expose actual sizes, not saved preferences.
 for(const section of sections.slice(0,count)){
  const grip=section.previousElementSibling;
  grip.setAttribute('aria-valuemin',String(SPLIT_MIN));grip.setAttribute('aria-valuemax',String(max));
  grip.setAttribute('aria-valuenow',String(Math.round(section.getBoundingClientRect().width)));
 }
 const hidden=splitPanes.length-count;
 let notice=document.getElementById('split-notice');
 if(!notice&&hidden&&innerWidth>=900&&document.querySelector('.chatcol')){
  notice=document.createElement('p');notice.id='split-notice';notice.className='split-notice';notice.setAttribute('role','status');
  document.querySelector('.chatcol > header').after(notice);
 }
 if(notice){notice.hidden=!hidden||innerWidth<900;notice.textContent=hidden?`${hidden} ${hidden===1?'pane is':'panes are'} hidden at this width. Widen the window or hide the conversation list to restore split view.`:'';}
 const railElement=document.querySelector('aside.rail');
 if(railElement!==observedSplitRail){
  splitRailObserver?.disconnect();observedSplitRail=railElement;
  if(railElement){splitRailObserver=new ResizeObserver(sizeMainForSplit);splitRailObserver.observe(railElement);}
 }
}
function bindPaneGrip(grip,section){
 const setWidth=w=>{
  const p=splitPanes.find(x=>x.key===section.dataset.key);if(!p)return;
  const count=document.querySelectorAll('#panes .split-pane:not([hidden])').length;
  const max=innerWidth-railSpace()-dockSpace()-count*SPLIT_GRIP-count*SPLIT_MIN;
  p.w=Math.round(Math.max(SPLIT_MIN,Math.min(max,w)));section.style.flex=`0 1 ${p.w}px`;
  saveSplit();sizeMainForSplit();
 };
 grip.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();setWidth(section.getBoundingClientRect().width+(e.key==='ArrowLeft'?40:-40));};
 grip.ondblclick=()=>{const p=splitPanes.find(x=>x.key===section.dataset.key);if(p){p.w=null;saveSplit();paintSplit();}};
 grip.onpointerdown=e=>{
  grip.setPointerCapture(e.pointerId);document.body.classList.add('pane-resizing');
  const right=section.getBoundingClientRect().right;
  grip.onpointermove=ev=>setWidth(right-ev.clientX);
  grip.onpointerup=grip.onpointercancel=()=>{grip.onpointermove=grip.onpointerup=grip.onpointercancel=null;document.body.classList.remove('pane-resizing');};
 };
}
// before: the key of an existing pane; the new pane goes to its left (1.53.3, for a view chosen inside that pane).
function openBeside(id,before){
 if(PANE)return;
 if(id&&id===chatId)return toast('That conversation is already the main conversation.');
 if(splitPanes.some(p=>p.id===id))return toast(id?'That conversation is already open beside.':'A new conversation is already waiting beside. Start it or close it first.');
 if(splitPanes.length>=SPLIT_MAX_PANES)return toast('Split view holds up to four conversations. Close a pane first.');
 if(!splitHasRoom())return toast('Not enough room for another pane. Hide the conversation list, close a pane or widen the window.');
 // a new group shares the width equally, like an editor split
 for(const p of splitPanes)p.w=null;
 const pane={key:crypto.randomUUID(),id,w:null},at=before?splitPanes.findIndex(p=>p.key===before):-1;
 if(at>=0)splitPanes.splice(at,0,pane);else splitPanes.push(pane);
 saveSplit();paintSplit();
}
function closePane(key){
 splitPanes=splitPanes.filter(p=>p.key!==key);saveSplit();paintSplit();
 // the pane's own New-session draft, attachments, choices and retry state go with it
 for(const k of ['pc-draft-','pc-attachments-','pc-prefs-','pc-outbox-'])try{localStorage.removeItem(k+'new-pane-'+key);}catch{}
}
// Close the MAIN conversation (never available inside a pane — panes use pane-close).
// Closing never deletes or hides the session; it only asks the server to end its live
// process, then either promotes the first beside pane into main or goes to New session.
async function closeMainPane(){
 if(PANE||!chatId)return;
 const id=chatId;
 const afterRelease=()=>{
  if(splitPanes.length){
   const p=splitPanes[0];
   splitPanes=splitPanes.filter(x=>x.key!==p.key);saveSplit();
   // a New-session pane becoming main brings its draft, attachments, choices and retry state
   if(!p.id)for(const k of ['pc-draft-','pc-attachments-','pc-prefs-','pc-outbox-'])try{const v=localStorage.getItem(k+'new-pane-'+p.key);if(v!=null)localStorage.setItem(k+'new',v);localStorage.removeItem(k+'new-pane-'+p.key);}catch{}
   location.hash=p.id?'#/chat/'+p.id:'#/new';
   paintSplit();
  }else location.hash='#/new';
 };
 try{
  await api(`/session/${id}/release`,{method:'POST',body:JSON.stringify({stop:false})});
  afterRelease();
 }catch(e){
  if(e.status!==409)return toast('Could not close: '+(e.message||'error'));
  sheet('A reply is still running',[
   ['keep','Keep it running in the background','Closes this view only; the reply keeps going on the server'],
   ['stop','Stop the reply','Ends it now, then closes this view'],
  ],null,async v=>{
   if(v==='stop'){
    try{await api(`/session/${id}/release`,{method:'POST',body:JSON.stringify({stop:true})});}
    catch(err){toast('Could not stop: '+(err.message||'error'));return;}
   }
   afterRelease();
  });
 }
}
// 1.32.1: a fresh page has no document list yet; fetch it first so the chooser can name documents, not just the library.
function chooseBeside(){
 const pending=documentsOn()||projectsOn();
 const sh=chooseBesideNow(pending);
 const loads=[];
 if(typeof documentsOn==='function'&&documentsOn())loads.push(Promise.resolve(docsLoading).catch(()=>{}).then(()=>loadDocs(true)));
 if(typeof projectsOn==='function'&&projectsOn())loads.push(Promise.resolve(boardLoading).catch(()=>{}).then(()=>loadBoard(true)));
 if(loads.length){
  sh.querySelector('[role=status]').textContent='Loading available views…';let deadline;
  // A slow library must not block New session or the already loaded session list.
  const timedOut=new Promise(resolve=>{deadline=setTimeout(()=>resolve(null),4000);});
  Promise.race([Promise.allSettled(loads),timedOut]).then(results=>{clearTimeout(deadline);if(sh.isConnected){sh.loading=false;sh.loadError=results===null?'Some views are still loading. Reopen to refresh them.':results.some(r=>r.status==='rejected')?'Some views could not load. Close and reopen to try again.':'';sh.paintChoices();}});
 }
}
function chooseBesideNow(loading=false){
 const scrim=document.createElement('div');scrim.className='scrim';const sh=document.createElement('div');sh.className='sheet split-picker';
 sh.innerHTML=`<h2>Open beside</h2><div class="session-search">${IC.search}<input id="split-picker-search" type="search" aria-label="Find a conversation, project or file" placeholder="Find a conversation, project or file" autocomplete="off"></div><p class="sheet-help" role="status"></p><div class="split-choices"></div>`;
 sh.loading=loading;
 const paint=()=>{
  if(sh.loading)return;
  const taken=new Set([chatId,currentView(),...splitPanes.map(p=>p.id)]),seen=new Set(),q=sh.querySelector('input').value.trim().toLowerCase();
  const groups=[['New and libraries',[['new','New conversation','Start a conversation in the new pane']]],['Conversations',[]],['Projects',[]],['Files',[]]];
  for(const s of [...openSessions.slice().reverse(),...allSessions.filter(s=>!isHiddenSession(s))]){
   if(taken.has(s.id)||seen.has(s.id)||isViewId(s.id))continue;seen.add(s.id);const full=allSessions.find(r=>r.id===s.id)||s;
   groups[1][1].push([s.id,full.title||s.title,[projName(full.cwd),full.provider==='codex'?'Codex':full.provider==='acp'?'OpenRouter':'Claude',full.state?.label].filter(Boolean).join(' · ')]);
  }
  if(projectsOn()){
   groups[0][1].push(['projects','Projects','All tracked projects'],['projects/scheduled','Scheduled','Reminders, due first']);
   groups[2][1]=(boardSnap?.projects||[]).filter(p=>p.status!=='done').map(p=>['projects/'+p.id,p.name,p.next||p.summary||'Project']);
  }
  if(typeof tasksOn==='function'&&tasksOn())groups[0][1].push(['tasks','Tasks','To-dos, due first']); // 1.36
  if(typeof vaultOn==='function'&&vaultOn())groups[0][1].push(['vault','Vault','Secrets agents use without seeing']); // 1.39
  if(typeof coordOn==='function'&&coordOn())groups[0][1].push(['coordination','Coordination','What conversations hold, and who is waiting']); // 1.99
  if(documentsOn()){
   groups[0][1].push(['documents','Files','The library of files from the work']);
   const docs=docsSnap?.documents||[],open=openSessions.slice().reverse().filter(t=>t.id.startsWith('documents/')).map(t=>docs.find(d=>d.id===t.id.slice(10))).filter(Boolean);
   groups[3][1]=[...new Map([...open,...docs].map(d=>[d.id,d])).values()].map(d=>['documents/'+d.id,d.title,[KIND_WORD[d.kind],docWhere(d),visWord[d.visibility]].filter(Boolean).join(' · ')]);
  }
  let total=0,shown=0;
  sh.querySelector('.split-choices').innerHTML=groups.map(([label,rows])=>{
   const matches=rows.filter(r=>!taken.has(r[0])&&(!q||r.slice(1).join(' ').toLowerCase().includes(q))),limited=matches.slice(0,q?50:8);total+=matches.length;shown+=limited.length;
   if(!limited.length)return '';return `<section><h3>${label}</h3>${limited.map(([id,title,sub])=>`<button class="opt" data-v="${esc(id)}"><span>${esc(title)}<span class="sub">${esc(sub)}</span></span></button>`).join('')}</section>`;
  }).join('');
  sh.querySelector('[role=status]').textContent=sh.loadError||(!total?'No matching views. Try another name.':shown<total?`${shown} of ${total} views. ${q?'Refine your search to see other matches.':'Recent items first; search for more.'}`:q?`${total} matching view${total===1?'':'s'}`:'');
  sh.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{const v=b.dataset.v;closeCurrentSheet?.();openBeside(v==='new'?null:v);});
 };
 sh.paintChoices=paint;sh.querySelector('input').oninput=paint;paint();mountSheet(scrim,sh);return sh;
}

if(PANE){
 document.documentElement.classList.add('in-pane');
 // Let the window around this pane track which session it shows.
 window.paneSay=(type,extra={})=>{if(parent!==window)parent.postMessage({pocketPane:type,...extra},location.origin);};
}else{
 addEventListener('message',e=>{
  if(e.origin!==location.origin||!e.data?.pocketPane)return;
  const frame=[...document.querySelectorAll('#panes iframe')].find(f=>f.contentWindow===e.source);
  const section=frame?.closest('.split-pane'),p=section&&splitPanes.find(x=>x.key===section.dataset.key);if(!p)return;
  const {pocketPane:type,id,title}=e.data;
  if(type==='route'&&typeof id==='string'&&validPane({key:p.key,id})){p.id=id;saveSplit();frame.title='Conversation beside: '+(typeof title==='string'?title:sessionTitle(id));}
  if(type==='close')closePane(p.key);
  // 1.53.3: a file or project chosen inside a pane (Settings: open beside) gets a pane of its own, to that pane's left.
  if(type==='beside'&&typeof id==='string'&&validPane({key:p.key,id}))openBeside(id,p.key);
  if(type==='main'&&p.id){
   const mainId=chatId||currentView();location.hash=tabHref(p.id);
   if(mainId&&mainId!==p.id){p.id=mainId;saveSplit();frame.title='Conversation beside: '+sessionTitle(mainId);frame.contentWindow.location.hash=tabHref(mainId);}else closePane(p.key);
  }
 });
 addEventListener('resize',()=>{clearTimeout(window.splitResizeT);window.splitResizeT=setTimeout(sizeMainForSplit,100);});
 // Tabs opened in another window or pane show up here without a reload.
 addEventListener('storage',e=>{if(e.key==='pc-open-sessions'){openSessions=readLocal('pc-open-sessions',[]).filter(s=>s&&typeof s.id==='string');paintOpenSessions();}});
 paintSplit();
}

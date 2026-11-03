/* Links (1.54): a link in a conversation to one of this Pocket's own things opens the way files do (Settings →
   Open files and links): as a tab, beside the conversation in a split pane, or in a new browser window. A Pocket
   address (#/documents/…, #/projects/…, a session) opens that view; a share or public link to one of your own
   files opens the file; an image or file served by this Pocket shows in a small link view (#/link/<address>). A
   download stays a download, and a link to an outside website is left to the browser, as before (1.54.1: Brad —
   "I really only meant for links that are to our own internal documents"). */
let linkView=null;
const linkLabels=new Map(); // address → the text it was clicked by, for the tab title (this window only)
const LINK_ID_RE=/^link\/([A-Za-z0-9%._~!*'()-]{1,2000})$/;
const linkViewId=url=>'link/'+encodeURIComponent(url);
const linkImageUrl=u=>/\.(png|jpe?g|gif|webp)$/i.test(u.searchParams.get('path')||u.pathname);
// The view only ever shows an address of this Pocket; anything else is not a view.
function linkViewUrl(id){
 const m=LINK_ID_RE.exec(id||'');if(!m)return null;
 let u;try{u=new URL(decodeURIComponent(m[1]),location.origin);}catch{return null;}
 return ['http:','https:'].includes(u.protocol)&&u.origin===location.origin&&!u.username&&!u.password?u:null;
}
function linkViewTitle(id){
 const u=linkViewUrl(id);if(!u)return 'Link';
 const label=linkLabels.get(u.href);if(label)return label;
 const p=u.searchParams.get('path')||'';let name='';try{name=decodeURIComponent((p||u.pathname).split('/').filter(Boolean).pop()||'');}catch{}
 return name||u.hostname;
}
// The Pocket view a same-origin address names (#/documents/x, #/projects/x, #/tasks, #/vault, #/chat/<id>), else null.
function pocketViewOf(u){
 if(u.origin!==location.origin||!['/','/index.html'].includes(u.pathname))return null;
 const h=u.hash||'';
 if(h.startsWith('#/chat/')){let id='';try{id=decodeURIComponent(h.slice(7));}catch{}return /^(?:(?:cx:)?[0-9a-f-]{36}|acp:ses_[0-9A-Za-z-]{1,64})$/.test(id)?id:null;}
 const id=h.slice(2);return isViewId(id)&&!id.startsWith('link/')?id:null;
}
// Open a session or view id the way the setting says. Unlike openViewPreferred, "tab" is done here too: the
// clicked link's own address (an absolute URL with target=_blank) is not the view's route.
function openIdPreferred(id,prefKey){
 const pref=readLocal(prefKey,'tab'),here=id===chatId||id===currentView();
 if(pref==='window')return openInWindow(id);
 if(pref==='beside'&&!here){
  if(PANE&&typeof paneSay==='function')return paneSay('beside',{id});
  if(!SOLO&&isWide()&&typeof openBeside==='function')return openBeside(id);
 }
 if(!here)location.hash=tabHref(id);
}
// A share or public link of one of your own files is that file.
async function resolveSharedLink(u){
 try{const s=await loadDocs();return (s?.documents||[]).find(d=>(d.url&&d.url===u.pathname)||(d.share?.url&&d.share.url===u.pathname))?.id||null;}catch{return null;}
}
// A plain click on a link in a conversation. Returns true when the click was handled here; false leaves it to
// the browser (the link's own target opens a new tab).
function openLinkPreferred(a,e){
 if(!plainClick(e))return false;
 let u;try{u=new URL(a.href,location.href);}catch{return false;}
 if(!['http:','https:'].includes(u.protocol)||u.origin!==location.origin)return false; // an outside website is the browser's
 const vf=typeof vaultFocusOf==='function'&&['/','/index.html'].includes(u.pathname)?vaultFocusOf(u.hash):null; // 1.93: one secret or request in the Vault
 if(vf){e.preventDefault();openVaultLink(vf);return true;}
 const viewId=pocketViewOf(u);
 if(viewId){e.preventDefault();openIdPreferred(viewId,viewId.startsWith('projects')?'pc-projects-open':'pc-documents-open');return true;}
 if(/^\/api\/session\/[^/]+\/artifact$/.test(u.pathname)&&u.searchParams.get('inline')!=='1'||u.searchParams.get('download')==='1')return false; // a download stays a download (1.61: an inline view of a file opens like any link)
 const pref=readLocal('pc-documents-open','tab');
 if(pref==='window')return false;                                   // the link's own target already opens the browser's window
 if(/^\/(share|files)\/[^/]+$/.test(u.pathname)&&typeof documentsOn==='function'&&documentsOn()){
  e.preventDefault();
  resolveSharedLink(u).then(id=>{if(id)openIdPreferred('documents/'+id,'pc-documents-open');else location.hash=tabHref(linkViewId(u.href));});
  return true;
 }
 const id=linkViewId(u.href);if(!LINK_ID_RE.test(id))return false;   // too long an address to be a view
 const label=(a.textContent||'').trim().replace(/\s+/g,' ').slice(0,80);if(label)linkLabels.set(u.href,label);
 e.preventDefault();
 if(pref==='beside'&&id!==currentView()){
  if(PANE&&typeof paneSay==='function')return paneSay('beside',{id}),true;
  if(!SOLO&&isWide()&&typeof openBeside==='function')return openBeside(id),true;
 }
 if(id!==currentView())location.hash=tabHref(id);
 return true;
}
document.addEventListener('click',e=>{
 const a=e.target.closest?.('#msgs a[href], .result-row > a[href]');
 if(!a||e.defaultPrevented||a.closest('.choices, .away-card'))return;
 openLinkPreferred(a,e);
});

/* ---------- the view: an image or file served by this Pocket ---------- */
const linkToolsHTML=u=>`<div class="doc-tools"><a class="chip" href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${IC.globe}Open in browser</a><button class="chip" data-copy-link>${IC.link}Copy link</button></div>`;
function linkBodyHTML(u,title){
 if(linkImageUrl(u))return `<div class="doc-media-wrap"><img class="doc-media" src="${esc(u.href)}" alt="${esc(title)}"></div>`;
 return `<iframe class="doc-frame link-frame" src="${esc(u.href)}" title="${esc(title)}" referrerpolicy="no-referrer" sandbox="allow-scripts allow-popups allow-downloads allow-forms"></iframe>`; // the file viewer's sandbox
}
async function renderLink(view){
 Voice.onLeave?.();
 linkView=view;
 const u=linkViewUrl(view),title=linkViewTitle(view);
 const col=`<header class="bar">
   ${PANE?`<button class="icon" id="pane-main" aria-label="Make this the main view">${IC.swap}</button>`:SOLO?'':`<button class="icon" id="back" aria-label="Back">${IC.back}</button><button class="icon desk" id="railtog" aria-label="Show or hide the conversation list">${IC.panel}</button>`}
   <h1><span class="one" id="ltitle">${esc(title)}</span><span class="tag" id="ltag">${u?'From this Pocket':'Link'}</span></h1>
   ${SOLO?'':`<button class="icon" id="lwin" aria-label="Open in a new window" title="Open in a new window">${IC.external}</button>`}
   ${PANE||SOLO?'':`<button class="icon desk" id="splitb" aria-label="Split view">${IC.columns}</button>`}
   ${PANE?`<button class="icon" id="pane-close" aria-label="Close this pane">${IC.x}</button>`:''}
  </header>
  <main class="scroll documents-view link-view" id="link-main" data-kind="doc" tabindex="-1"></main>`;
 app.innerHTML=withShell(col);
 wireShell();
 if(PANE){$('#pane-main').onclick=()=>paneSay('main',{view});$('#pane-close').onclick=()=>paneSay('close');}
 else if(!SOLO){bindViewBack($('#back'),view);$('#splitb').onclick=chooseBeside;}
 $('#lwin')?.addEventListener('click',()=>openInWindow(view));
 const tog=$('#railtog');if(tog)tog.onclick=()=>{localStorage.setItem('pc-rail',railOpen()?'closed':'open');route();};
 if(typeof refreshSessions==='function')refreshSessions().catch(()=>{}); // the rail's session list
 const main=$('#link-main');
 if(!u){main.innerHTML='<p class="sheet-help doc-note">That link cannot be opened here. Links to outside websites open in your browser.</p>';return;}
 main.innerHTML=linkToolsHTML(u)+linkBodyHTML(u,title);
 main.querySelector('[data-copy-link]').onclick=e=>copyLink(u.href,e.currentTarget);
 if(PANE)paneSay('route',{id:view,title});else if(SOLO)document.title=title+' · '+appName();else rememberOpenView(view,title);
}

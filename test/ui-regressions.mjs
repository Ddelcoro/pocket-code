import {clickControl} from './ui-controls.mjs';
// Browser regressions for the 1.7 audit. Uses the existing synthetic API server;
// no real credentials, transcripts, providers or production processes are involved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const axePath=require.resolve('axe-core/axe.min.js');
const pause=ms=>new Promise(r=>setTimeout(r,ms));

export async function runUIRegressions({browser,base,rows,out,setMode,getMode=()=>({}),settingsState=()=>({}),vaultFixture={},received=[],voiceLog={transcribe:[],speak:[]},conversations=new Map(),pinOrders=[]}) {
 const context=await browser.createBrowserContext(),page=await context.newPage();
 // Preserve the established dark-mode colour assertions. theme-browser covers
 // every palette and live switching independently, including fresh System users.
 await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'dark'}]);
 page.setDefaultTimeout(8000);
 const errors=[],checks=[],scans=[];
 page.on('pageerror',e=>errors.push(e.message));
 const idle=rows[4].id;
 const check=async(name,fn)=>{if(process.env.POCKET_CHECK&&!name.includes(process.env.POCKET_CHECK))return;await fn();checks.push(name);}; // POCKET_CHECK=<substring> runs one check while iterating on it
 const chat=async()=>{await page.goto(base+'/#/chat/'+idle);await page.waitForSelector('#box');};
 // Hash-only navigation keeps the old view for a moment; wait for the requested conversation to be loaded.
 const openChat=async id=>{await page.goto(base+'/#/chat/'+id);await page.waitForFunction(id=>chatId===id&&document.querySelector('#ctitle')?.textContent!=='Conversation'&&document.querySelector('#box'),{},id);};
 const scan=async name=>{
  // Measure final colors, not the translucent opening frame of a sheet animation.
  await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
  // A toast from the previous step is transient feedback, not part of the view: dismiss it (as its own 3.2 s timer would)
  // before measuring, so a scan does not race its fade on a slow runner. Only the toast is touched; nothing else moves.
  const lingering=await page.evaluate(()=>{const t=document.getElementById('toast');if(!t||!t.classList.contains('show'))return '';t.classList.remove('show');return t.textContent;});
  if(lingering){console.log(`scan ${name}: dismissed the toast "${lingering}"`);await new Promise(r=>setTimeout(r,250));
   // The pause lets a hover tooltip (tips.js, 350 ms after pointerover) catch up with a pointer left on a control; leave the control as a pointer would.
   await page.evaluate(()=>{for(const el of document.querySelectorAll(':hover'))el.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,relatedTarget:null}));const t=document.getElementById('tip');if(t)t.hidden=true;});}
  const axeScript=await page.addScriptTag({path:axePath});await axeScript.evaluate(el=>el.remove());
  // A toast can still arrive while axe runs (a fetch from the previous step resolving late) and fail color-contrast
  // mid-fade, the suite's one recurring flake (#toast at subagents-mobile). Keep the toast out of the measurement
  // for the scan's duration only: it stays in the DOM with its text, so a later assertion on it is unaffected.
  const result=await page.evaluate(async()=>{const t=document.getElementById('toast');const was=t?t.style.visibility:'';if(t)t.style.visibility='hidden';
   try{return await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}});}finally{if(t)t.style.visibility=was;}});
  const record={name,violations:result.violations};
  scans.push(record);
  if(process.env.POCKET_DESIGN_SCANNER){
   await page.evaluate(()=>{window.__IMPECCABLE_CONFIG__={autoScan:false};});
   if(!await page.evaluate(()=>Boolean(window.impeccableDetectAsync))){const injected=await page.addScriptTag({path:process.env.POCKET_DESIGN_SCANNER});await injected.evaluate(el=>el.remove());}
   record.detector=await page.evaluate(()=>window.impeccableDetectAsync({scrollOffscreen:false}));
  }
  assert.deepEqual(result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],name+' accessibility');
 };
 try {
  await page.setViewport({width:390,height:844});
  // A fresh profile and a real HTTP503 from sw.js reproduce the registration failure.
  setMode({workerFailed:true,aboutFailed:true});
  await page.goto(base+'/#/');await page.waitForSelector('#settings');
  await check('The plus button opens a clean conversation, not a briefing you walked away from',async()=>{
   const ctx=await browser.createBrowserContext(),ph=await ctx.newPage();
   try{
    await ph.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
    await ph.goto(base+'/#/',{waitUntil:'domcontentloaded'});await ph.waitForSelector('#new');
    const tapPlus=async()=>{const b=await ph.$eval('#new',e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});await ph.touchscreen.tap(b.x,b.y);await ph.waitForSelector('#first');await pause(150);return ph.$eval('#first',e=>e.value);};
    const briefing='Email alert from the inbox monitor.\n\nSubject: Contoso installation confirmation';
    // An alert's Start a conversation loads its briefing into New; leaving without starting it must not keep it there.
    await ph.evaluate(t=>{saveBriefing(t);location.hash='#/new';},briefing);await ph.waitForFunction(t=>document.querySelector('#first')?.value===t,{},briefing);
    await ph.evaluate(()=>{location.hash='#/';});await ph.waitForSelector('#new');
    assert.equal(await tapPlus(),'','the untouched briefing is gone');
    // A briefing you edited is your draft now, and a typed draft is kept as before.
    await ph.evaluate(t=>{saveBriefing(t);saveDraft(NEW_KEY,t+' Also check the invoice.');location.hash='#/';},briefing);await ph.waitForSelector('#new');
    assert.equal(await tapPlus(),briefing+' Also check the invoice.','an edited briefing stays');
    await ph.evaluate(()=>{clearDraft(NEW_KEY);location.hash='#/';});await ph.waitForSelector('#new');
    await ph.evaluate(()=>saveDraft(NEW_KEY,'My own half-written task'));
    assert.equal(await tapPlus(),'My own half-written task','a typed draft stays');
   }finally{await ctx.close();}
  });
  await check('The plus pressed on New conversation itself starts over (desktop)',async()=>{
   const ctx=await browser.createBrowserContext(),pd=await ctx.newPage();
   try{
    await pd.setViewport({width:1440,height:900});
    await pd.goto(base+'/#/new',{waitUntil:'domcontentloaded'});await pd.waitForSelector('#first');await pd.waitForSelector('#railnew');
    await pd.evaluate(()=>{saveDraft(NEW_KEY,'Yesterday\'s half-written task');localStorage.setItem('pc-attachments-'+NEW_KEY,JSON.stringify([{path:'/tmp/old.png',name:'old.png'}]));localStorage.setItem('pc-new-start',JSON.stringify({project:'p1',projectName:'Old project'}));route();});
    await pd.waitForFunction(()=>document.querySelector('#first')?.value==='Yesterday\'s half-written task');
    await clickControl(pd,'#railnew');
    await pd.waitForFunction(()=>document.querySelector('#first')?.value==='');
    assert.equal(await pd.evaluate(()=>location.hash),'#/new');
    assert.equal(await pd.evaluate(()=>loadAttachments(NEW_KEY).length),0,'old attachments are gone');
    assert.equal(await pd.evaluate(()=>localStorage.getItem('pc-new-start')),null,'the old project link is gone');
    await pd.waitForFunction(()=>document.activeElement?.id==='first');
   }finally{await ctx.close();}
  });
  await check('Settings usable when service worker fails; explicit notification fallback',async()=>{
   await clickControl(page,'#settings');await page.waitForSelector('#s-usage',{timeout:1000});
   assert.equal(await page.$$eval('.settings-index button',es=>es.filter(e=>e.checkVisibility()).length),6);
   assert.equal(await page.$eval('#s-notes',e=>e.open),false);
   await clickControl(page,'#s-chime');assert.equal(await page.$eval('#s-chime',e=>e.getAttribute('aria-pressed')),'false');
   await page.waitForFunction(()=>document.querySelector('#s-push-state').textContent.includes('Unavailable'));
   await clickControl(page,'#s-push');await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Notifications unavailable'));
   await page.screenshot({path:path.join(out,'fixed-settings-mobile.png')});
  });
  await check('Failed update check is honest and Retry recovers',async()=>{
   await clickControl(page,'#s-about > summary');
   await page.waitForFunction(()=>document.querySelector('#s-version-state').textContent.includes('Could not check'));
   assert.equal(await page.$eval('#s-refresh',e=>e.hidden),true);
   setMode({aboutFailed:false});await clickControl(page,'#s-check');
   await page.waitForFunction(()=>document.querySelector('#s-version-state').textContent==='Up to date');
   await clickControl(page,'#s-about > summary');
  });
  await check('Bugs & feature requests links open the GitHub issue forms with the version filled in',async()=>{
   assert.equal(await page.$eval('#s-feedback',e=>e.open),false);
   await clickControl(page,'#s-feedback > summary');
   const bug=await page.$eval('#s-report-bug',e=>({href:e.href,target:e.target,rel:e.rel}));
   assert.match(bug.href,/^https:\/\/github\.com\/bbesner\/pocket-code\/issues\/new\?template=bug_report\.yml&version=/);
   assert.match(decodeURIComponent(bug.href),/build \d+/);
   assert.equal(bug.target,'_blank');assert.ok(bug.rel.includes('noopener'));
   assert.match(await page.$eval('#s-request-feature',e=>e.href),/template=feature_request\.yml&version=/);
   await page.$eval('#s-feedback',e=>e.scrollIntoView({block:'end'}));await page.screenshot({path:path.join(out,'fixed-settings-feedback.png')});
   await clickControl(page,'#s-feedback > summary');
  });
  await check('Nested usage sheet returns focus to the Settings opener',async()=>{
   await clickControl(page,'#s-usage');await page.waitForSelector('#usage-body');await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'settings');
  });
  await check('Settings disclosures remain keyboard reachable and focus stays trapped',async()=>{
   await clickControl(page,'#settings');await page.waitForSelector('#s-sync:not(:disabled)');
   await clickControl(page,'[data-settings-category=help]');
   await page.focus('.sheet-close');const focused=new Set();
   for(let i=0;i<30;i++){ // the Tools rows (1.29, 1.30) added four stops before the disclosures
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(()=>document.querySelector('[role=dialog]').contains(document.activeElement)));
    focused.add(await page.evaluate(()=>document.activeElement.closest('details')?.id));
   }
   assert.ok(focused.has('s-about')&&focused.has('s-notes')&&focused.has('s-feedback'));
   await page.keyboard.press('Escape');
  });
  await check('Compact filters expose active selections and remember expansion',async()=>{
   assert.equal(await page.$eval('[data-more-filters]',e=>e.open),false);
   const firstTop=await page.$eval('[data-session-results] [data-id]',e=>e.getBoundingClientRect().top);
   assert.ok(firstTop<430,'first session should be visible above the fold');
   await clickControl(page,'[data-more-filters] > summary');
   await page.select('[data-provider-filter]','codex');
   await clickControl(page,'[data-more-filters] > summary');
   assert.match(await page.$eval('[data-filter-summary]',e=>e.textContent),/Codex/);
   await page.reload();await page.waitForSelector('[data-more-filters]');
   assert.equal(await page.$eval('[data-more-filters]',e=>e.open),false);
   await clickControl(page,'[data-clear-more-filters]');
   assert.equal(await page.$eval('[data-filter-summary]',e=>e.textContent),'');
   await clickControl(page,'[data-more-filters] > summary');await pause(30);await page.reload();
   await page.waitForSelector('[data-more-filters]');assert.equal(await page.$eval('[data-more-filters]',e=>e.open),true);
   await clickControl(page,'[data-more-filters] > summary');
   await page.screenshot({path:path.join(out,'fixed-sessions-mobile.png')});
  });
  await check('A finished reply reads Response ready until opened, then Recent',async()=>{
   const done=rows.find(r=>r.state?.kind==='finished'&&r.state.at);
   const status=()=>page.$eval(`[data-session-results] [data-id="${done.id}"] .session-status`,e=>({cls:e.className,text:e.textContent}));
   setMode({ignoreSeen:done.id});                             // an upload already in flight from the old page must not re-mark it (CI race)
   delete done.seenAt;await page.evaluate(id=>{localStorage.removeItem('pc-seen-'+id);serverSeen.delete(id);seenPending.delete(id);},done.id);await page.reload();await page.waitForSelector(`[data-session-results] [data-id="${done.id}"]`);
   assert.deepEqual(await status(),{cls:'session-status state-finished',text:'Response readyNew'});
   setMode({ignoreSeen:null});
   await page.evaluate(([id,at])=>localStorage.setItem('pc-seen-'+id,String(at)),[done.id,done.state.at]);await page.reload();await page.waitForSelector(`[data-session-results] [data-id="${done.id}"]`);
   assert.deepEqual(await status(),{cls:'session-status state-idle',text:'Recent'});
  });
  await check('A session with background work reads Working in background, grouped and counted, with the dim ember in the row and the title bar',async()=>{
   const row=rows.find(r=>r.id===idle);const saved=row.state;
   row.state={kind:'background',label:'Working in background · 1 job',confirmed:true,background:{count:1,summary:'1 job',jobs:[{kind:'job',description:'Run the full test suites'}]}};
   await page.goto(base+'/#/');await page.evaluate(()=>refreshSessions());await page.waitForSelector(`[data-session-results] [data-id="${row.id}"] .state-background`);
   const status=await page.$eval(`[data-session-results] [data-id="${row.id}"] .session-status`,e=>({cls:e.className,text:e.textContent,dim:Boolean(e.querySelector('.ember.dim'))}));
   assert.deepEqual(status,{cls:'session-status state-background',text:'Working in background · 1 job',dim:true});
   assert.match(await page.$eval(`[data-session-results] [data-id="${row.id}"] .activity-detail`,e=>e.textContent),/^Background: Run the full test suites/);
   const groups=await page.$$eval('[data-session-results] .session-group h2',es=>es.map(e=>e.firstChild.textContent));
   assert.ok(groups.indexOf('Working in background')>groups.indexOf('Running')||!groups.includes('Running'),groups.join(','));assert.ok(groups.includes('Working in background'),groups.join(','));
   assert.match(await page.$eval('[data-session-summary]',e=>e.textContent),/1 in background/);
   await scan('sessions-background-mobile');await page.screenshot({path:path.join(out,'sessions-background-mobile.png')});
   await openChat(row.id);
   await page.waitForFunction(()=>/Background/.test(document.querySelector('#run-confirmed-state')?.textContent||''));
   assert.equal(await page.$eval('#run-confirmation',e=>e.dataset.state),'background');
   assert.ok(await page.$('#hember:not([hidden]) .ember.dim'),'the title bar shows the dim ember');
   assert.match(await page.$eval('#run-confirmation',e=>e.title),/Background: Run the full test suites/);
   if(saved===undefined)delete row.state;else row.state=saved;
   await page.goto(base+'/#/');await page.evaluate(()=>refreshSessions());await page.waitForFunction(id=>!document.querySelector(`[data-session-results] [data-id="${id}"] .state-background`),{},row.id);
  });
  setMode({workerFailed:false});
  await page.setViewport({width:1440,height:900});
  await page.goto(base+'/#/new');await page.waitForSelector('#first');
  await check('New-session skip link targets the task field',async()=>{
   await page.focus('.skip-chat');await page.keyboard.press('Enter');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'first');
  });
  await check('Agent and workspace radio groups support arrows, Home/End and roving Tab',async()=>{
   await clickControl(page,'#choose-workspace');await page.focus('[data-a=claude]');await page.keyboard.press('ArrowDown');
   assert.equal(await page.$eval('[data-a=codex]',e=>e.getAttribute('aria-checked')),'true');
   assert.equal(await page.$$eval('#apick [tabindex="0"]',es=>es.length),1);
   await page.keyboard.press('Home');assert.equal(await page.$eval('[data-a=claude]',e=>e.getAttribute('aria-checked')),'true');
   await page.focus('#plist [role=radio]');await page.keyboard.press('End');
   assert.equal(await page.$$eval('#plist [role=radio]',es=>es.at(-1).getAttribute('aria-checked')),'true');
   await page.keyboard.press('ArrowDown');
   assert.equal(await page.$eval('#plist [role=radio]',e=>e.getAttribute('aria-checked')),'true');
   assert.equal(await page.$$eval('#plist [tabindex="0"]',es=>es.length),1);
  });
  await scan('new-desktop');
  await chat();await page.type('#box','Main draft survives resizing.');
  await check('Process closing is a labelled session-menu action, not an adjacent X',async()=>{
   assert.equal(await page.$('#close-main'),null);
   assert.ok(await page.$('[data-close-session]'));
   await clickControl(page,'#chatmore');assert.match(await page.$eval('#so-close',e=>e.textContent),/Close conversation process/);
   await page.keyboard.press('Escape');
  });
  await check('Session menu names itself, shows the title as the conversation, and opens the version in one tap',async()=>{
   const release=JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname),'../public/release.json'),'utf8'));
   const vp=page.viewport();await page.setViewport({width:390,height:844});
   const settled=()=>page.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=='running'));
   await clickControl(page,'#chatmore');await settled();
   assert.equal(await page.$eval('#sheet-title',e=>e.textContent),'Conversation options');
   assert.equal(await page.$eval('.sheet-name',e=>e.textContent),rows[4].title);
   await page.waitForFunction(v=>document.querySelector('#so-version-sub')?.textContent.includes(v),{},release.version);
   assert.equal(await page.$eval('#so-version-sub',e=>e.textContent),`Pocket Code ${release.version} · build ${release.assetV}`);
   await page.screenshot({path:path.join(out,'session-menu-version.png')});
   await page.$eval('#so-version',e=>e.scrollIntoView({block:'end'}));await page.screenshot({path:path.join(out,'session-menu-version-row.png')});
   await clickControl(page,'#so-version');await page.waitForSelector('.settings-sheet #s-about[open]');await settled();
   await page.waitForFunction(()=>document.querySelector('#s-about-version')?.textContent);
   assert.equal(await page.$eval('#s-about-version',e=>e.textContent),`${release.version} · build ${release.assetV}`);
   assert.ok(await page.$eval('#s-about',e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.top<innerHeight;}));
   await page.screenshot({path:path.join(out,'settings-about-open.png')});
   await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'chatmore');
   await page.setViewport(vp);
  });
  await clickControl(page,'#splitb');await clickControl(page,'[data-v=new]');await page.waitForSelector('#panes iframe');
  let pane=await(await page.$('#panes iframe')).contentFrame();await pane.waitForSelector('#first');
  await pane.type('#first','Beside draft survives resizing.');
  await pane.evaluate(()=>{window.originalInput=document.querySelector('#first');});
  await check('Split separators expose valid initial and resized bounds',async()=>{
   const get=()=>page.$eval('.pane-grip',e=>['aria-valuemin','aria-valuenow','aria-valuemax'].map(a=>Number(e.getAttribute(a))));
   let [min,now,max]=await get();assert.ok(min>=380&&now>=min&&now<=max);
   await page.focus('.pane-grip');await page.keyboard.press('ArrowLeft');
   [min,now,max]=await get();assert.ok(now>=min&&now<=max);
  });
  await check('Narrow split hides in place and restores exact draft DOM',async()=>{
   await page.setViewport({width:900,height:900});
   await page.waitForFunction(()=>document.getElementById('panes').hidden);
   assert.match(await page.$eval('#split-notice',e=>e.textContent),/1 pane is hidden/);
   assert.equal(await page.$eval('#box',e=>e.value),'Main draft survives resizing.');
   assert.ok(await page.$eval('#box',e=>e.getBoundingClientRect().right<=innerWidth));
   await page.screenshot({path:path.join(out,'fixed-split-900.png')});
   await page.setViewport({width:1440,height:900});
   await page.waitForFunction(()=>!document.getElementById('panes').hidden);
   assert.equal(await pane.$eval('#first',e=>e===window.originalInput),true);
   assert.equal(await pane.$eval('#first',e=>e.value),'Beside draft survives resizing.');
   assert.ok(await page.$eval('#panes iframe',e=>e.getBoundingClientRect().right<=innerWidth+1));
  });
  await check('Rail keyboard resizing re-evaluates pane capacity',async()=>{
   await page.setViewport({width:1150,height:900});await pause(150);
   await page.focus('#grip');for(let i=0;i<8;i++)await page.keyboard.press('ArrowRight');
   await page.waitForFunction(()=>document.getElementById('panes').hidden);
   for(let i=0;i<8;i++)await page.keyboard.press('ArrowLeft');
   await page.waitForFunction(()=>!document.getElementById('panes').hidden);
  });
  await page.setViewport({width:2560,height:900});
  await page.evaluate(ids=>ids.forEach(openBeside),[rows[0].id,rows[1].id]);
  await check('Multiple panes fit or hide without out-of-bounds controls',async()=>{
   await page.waitForFunction(()=>document.querySelectorAll('.split-pane:not([hidden])').length===3);
   for(const width of [1920,1440,1280,1100,900,840,390,2560]){
    await page.setViewport({width,height:900});await pause(150);
    const rects=await page.$$eval('.split-pane:not([hidden])',els=>els.map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})));
    assert.ok(rects.every(r=>r.width>=379&&r.left>=0&&r.right<=width+1),'pane bounds '+width+': '+JSON.stringify(rects));
   }
   assert.equal(await pane.$eval('#first',e=>e.value),'Beside draft survives resizing.');
  });
  await check('Dock width is included in split capacity',async()=>{
   await page.setViewport({width:1440,height:900});await pause(150);
   await clickControl(page,'#results-open');await page.waitForSelector('.workspace-dock');await pause(150);
   assert.ok(await page.$eval('.chatcol',e=>e.getBoundingClientRect().width>=379));
   assert.ok(await page.$$eval('.split-pane:not([hidden])',es=>es.every(e=>e.getBoundingClientRect().right<=innerWidth+1)));
   await scan('split-and-dock-desktop');
   await page.screenshot({path:path.join(out,'fixed-split-desktop.png')});
   await clickControl(page,'[data-close-dock]');
  });
  await check('New-session button stays in the main column and never covers a pane composer',async()=>{
   const back=await page.evaluate(()=>location.hash);
   await page.evaluate(()=>{location.hash='#/';});await page.waitForSelector('#new');
   await page.waitForFunction(()=>!document.getElementById('panes').hidden);
   const r=await page.evaluate(()=>{const f=document.getElementById('new').getBoundingClientRect(),a=document.getElementById('app').getBoundingClientRect(),
    p=document.querySelector('.split-pane:not([hidden])').getBoundingClientRect();return {fabRight:f.right,fabBottom:f.bottom,appRight:a.right,paneLeft:p.left,h:innerHeight};});
   assert.ok(r.fabRight<=r.appRight+1&&r.fabRight<=r.paneLeft+1,'button inside the main column: '+JSON.stringify(r));
   assert.ok(r.fabBottom<=r.h,'button on screen: '+JSON.stringify(r));
   await page.screenshot({path:path.join(out,'fab-beside-split.png')});
   await page.evaluate(h=>{location.hash=h;},back);await page.waitForSelector('#chatmore');
  });
  await check('Closing main promotes a new pane with its draft',async()=>{
   await clickControl(page,'#chatmore');await clickControl(page,'#so-close');await page.waitForSelector('#first');
   assert.equal(await page.$eval('#first',e=>e.value),'Beside draft survives resizing.');
  });
  await page.evaluate(()=>{for(const pane of [...splitPanes])closePane(pane.key);localStorage.removeItem('pc-dock-kind');});
  await page.setViewport({width:390,height:844});await chat();
  await check('Toolbar overflow offers working controls and preserves draft',async()=>{
   await page.waitForSelector('.toolbar-next:not([hidden])');
   const before=await page.$eval('#box',e=>e.value);
   await clickControl(page,'.toolbar-next');
   assert.ok(await page.$eval('#tbar',e=>e.scrollLeft>0));
   assert.equal(await page.$eval('.toolbar-previous',e=>e.disabled),false);
   await clickControl(page,'.toolbar-previous');assert.equal(await page.$eval('#tbar',e=>e.scrollLeft),0);
   await clickControl(page,'#composer-toggle');assert.equal(await page.$eval('.toolbar-scroll',e=>e.getClientRects().length),0);
   await clickControl(page,'#composer-toggle');
   assert.equal(await page.$eval('#box',e=>e.value),before);
   await page.screenshot({path:path.join(out,'fixed-toolbar-mobile.png')});
   await page.setViewport({width:1440,height:900});await page.waitForFunction(()=>document.querySelector('.toolbar-next').hidden);
  });
  await check('Voice: hold to talk records, transcribes and sends to the session',async()=>{
   setMode({voice:true,voiceText:'Please review the incoming quantities again.'});
   await page.setViewport({width:390,height:844});await chat();await page.waitForSelector('#micb:not([hidden])');
   const talk=async ms=>{const b=await (await page.$('#micb')).boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();
    await page.waitForFunction(()=>document.querySelector('#micb').getAttribute('aria-pressed')==='true');await pause(ms);await page.mouse.up();};
   const draft=await page.$eval('#box',e=>e.value.trim());assert.ok(draft,'fixture has a typed draft');
   let sentBefore=received.length;await talk(900);
   await page.waitForFunction(()=>/Added to your draft/.test(document.querySelector('#voice-strip').textContent));
   assert.equal(await page.$eval('#box',e=>e.value),draft+' Please review the incoming quantities again.');
   assert.equal(received.length,sentBefore,'a typed draft is never sent on the user\'s behalf');
   await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input'));});
   const sent=received.length,heard=voiceLog.transcribe.length;
   const mic=await page.$('#micb'),box=await mic.boundingBox();
   assert.ok(box.width>=44&&box.height>=44,'mic target '+JSON.stringify(box));
   await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
   await page.waitForFunction(()=>document.querySelector('#micb').getAttribute('aria-pressed')==='true');
   assert.match(await page.$eval('#voice-strip',e=>e.textContent),/Release to send/);
   await pause(1400);await page.mouse.up();
   await page.waitForFunction(()=>/Sent:/.test(document.querySelector('#voice-strip').textContent));
   assert.equal(voiceLog.transcribe.length,heard+1);
   assert.ok(voiceLog.transcribe.at(-1).bytes>16000*2*.8,'about a second of 16 kHz PCM: '+voiceLog.transcribe.at(-1).bytes);
   assert.match(voiceLog.transcribe.at(-1).vocabulary,/Pocket Code/);
   for(let i=0;i<40&&received.length===sent;i++)await pause(100);
   assert.equal(received.at(-1).text,'Please review the incoming quantities again.');
   await page.screenshot({path:path.join(out,'voice-sent-mobile.png')});
  });
  await check('Voice: a quick command is answered on the device and nothing is sent',async()=>{
   setMode({voiceText:'Read it.'});const sent=received.length,spoken=voiceLog.speak.length;
   const box=await (await page.$('#micb')).boundingBox();
   await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
   await page.waitForFunction(()=>document.querySelector('#micb').getAttribute('aria-pressed')==='true');
   await pause(900);await page.mouse.up();
   for(let i=0;i<40&&voiceLog.speak.length===spoken;i++)await pause(100);
   assert.ok(voiceLog.speak.length>spoken,'reply spoken');
   const expected=await page.evaluate(()=>{const all=document.querySelectorAll('#msgs .m-asst');const c=all[all.length-1].cloneNode(true);
    c.querySelectorAll('.copybtn,.ledgerwrap,pre,table').forEach(n=>n.remove());return VoiceText.chunks(VoiceText.summary(c.innerText))[0];});
   assert.ok(expected,'latest reply has speakable text');
   assert.equal(voiceLog.speak[spoken].text,expected,'speaks the start of the latest reply');
   assert.equal(received.length,sent,'nothing sent to the session');
  });
  await check('Voice: tap starts listening, Cancel stops without sending',async()=>{
   const heard=voiceLog.transcribe.length;
   await clickControl(page,'#micb');
   await page.waitForFunction(()=>document.querySelector('#micb').getAttribute('aria-pressed')==='true');
   assert.match(await page.$eval('#voice-strip',e=>e.textContent),/Listening/);
   await scan('voice-listening-mobile');
   await clickControl(page,'#voice-cancel');
   await page.waitForFunction(()=>document.querySelector('#micb').getAttribute('aria-pressed')==='false');
   assert.equal(voiceLog.transcribe.length,heard);
  });
  await check('Tool calls: consecutive calls across messages fold into one summary that names the latest call',async()=>{
   const r=await page.evaluate(()=>{const c=document.createElement('div');
    c.innerHTML=[{role:'assistant',blocks:[{t:'text',text:'Checking.'},{t:'tool',name:'Bash',detail:'pm2 list'}]},{role:'assistant',blocks:[{t:'tool',name:'Edit',detail:'app.js'}]},{role:'assistant',blocks:[{t:'text',text:'Done.'}]}].map(msgHTML).join('');
    document.body.append(c);mergeToolFolds(c);const f=c.querySelectorAll('details.ledgerwrap');
    const out={folds:f.length,summary:f[0]?.querySelector('summary').textContent,lines:f[0]?.querySelectorAll('.ledger').length,msgs:c.querySelectorAll('.m-asst').length,open:f[0]?.open};c.remove();return out;});
   assert.equal(r.folds,1);assert.equal(r.lines,2);assert.equal(r.msgs,2,'a message that held only tool calls is absorbed');
   assert.match(r.summary,/2 steps/);assert.match(r.summary,/Edited app\.js/);assert.equal(r.open,false,'collapsed by default');
  });
  await check('Tool calls: a run stays one fold while streaming, across an empty live placeholder',async()=>{
   const r=await page.evaluate(()=>{const c=document.createElement('div');
    c.innerHTML=msgHTML({role:'assistant',blocks:[{t:'tool',name:'Read',detail:'a.js'}]})+'<div class="m-asst live enter"></div>'
     +msgHTML({role:'assistant',blocks:[{t:'tool',name:'Bash',detail:'npm test'}]});
    document.body.append(c);mergeToolFolds(c);const f=c.querySelectorAll('details.ledgerwrap');
    const out={folds:f.length,summary:f[0]?.querySelector('summary').textContent};c.remove();return out;});
   assert.equal(r.folds,1,'one fold for the run');assert.match(r.summary,/2 steps/);assert.match(r.summary,/Ran a command/,'shows the latest step');
  });
  await check('Voice: the headset starts a hands-free conversation; the mic stays a single message',async()=>{
   const heard=voiceLog.transcribe.length;
   await page.$eval('#box',e=>{e.value='A typed draft';e.dispatchEvent(new Event('input'));});
   assert.equal(await page.$eval('#hfb',e=>getComputedStyle(e).display),'none','a typed draft hides the headset');
   assert.notEqual(await page.$eval('#micb',e=>getComputedStyle(e).display),'none','the mic still adds to a draft');
   await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input'));});
   const hf=await page.$('#hfb'),box=await hf.boundingBox();
   assert.ok(box.width>=44&&box.height>=44,'headset target '+JSON.stringify(box));
   assert.match(await page.$eval('#hfb',e=>e.getAttribute('aria-label')),/Hands-free conversation/);
   await clickControl(page,'#hfb');
   await page.waitForFunction(()=>document.querySelector('#hfb').getAttribute('aria-pressed')==='true');
   assert.equal(await page.$eval('#micb',e=>e.getAttribute('aria-pressed')),'false','the plain mic is not the active control');
   await page.waitForFunction(()=>/Hands-free\. Listening/.test(document.querySelector('#voice-strip').textContent));
   await scan('voice-hands-free-mobile');await page.screenshot({path:path.join(out,'voice-hands-free-mobile.png')});
   await clickControl(page,'#voice-cancel');
   await page.waitForFunction(()=>document.querySelector('#hfb').getAttribute('aria-pressed')==='false');
   assert.equal(await page.evaluate(()=>Voice._test.handsFree()),null,'Cancel ends the conversation');
   assert.equal(voiceLog.transcribe.length,heard);
  });
  await check('Voice: only a hands-free reply listens again; replies and alerts outside it never open the mic',async()=>{
   const id=await page.evaluate(()=>chatId);
   const settle=async n=>{for(let i=0;i<60&&voiceLog.speak.length<n;i++)await pause(100);for(let i=0;i<60&&await page.evaluate(()=>Voice._test.state()==='speaking');i++)await pause(100);await pause(600);};
   // An old "Keep listening" preference must not reopen the mic any more.
   await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('pc-voice')||'{}');p.keepListening=true;p.speak=true;localStorage.setItem('pc-voice',JSON.stringify(p));});
   let n=voiceLog.speak.length;
   await page.evaluate(id=>{Voice._test.arm(id);Voice.onTurnEnd(id,true);},id);await settle(n+1);
   assert.ok(voiceLog.speak.length>n,'the reply to a plain-mic message is spoken');
   assert.equal(await page.evaluate(()=>Voice._test.state()),'idle','…and the mic stays off');
   // A notification never listens, even while a hands-free conversation is on.
   await page.evaluate(id=>Voice._test.setHandsFree(id),id);
   assert.match(await page.$eval('#voice-strip',e=>e.textContent),/Hands-free is on/);
   n=voiceLog.speak.length;await page.evaluate(()=>Voice.speak('Pocket Code. A session finished.'));await settle(n+1);
   assert.equal(await page.evaluate(()=>Voice._test.state()),'idle','an announcement does not open the mic');
   // The reply inside the hands-free conversation does listen for the answer.
   n=voiceLog.speak.length;await page.evaluate(id=>{Voice._test.arm(id);Voice.onTurnEnd(id,true);},id);
   await page.waitForFunction(()=>Voice._test.state()==='listening',{timeout:8000});
   assert.match(await page.$eval('#voice-strip',e=>e.textContent),/Hands-free\. Listening for your reply/);
   await clickControl(page,'#hfb');
   await page.waitForFunction(()=>Voice._test.state()==='idle'&&Voice._test.handsFree()===null);
   await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('pc-voice'));delete p.keepListening;localStorage.setItem('pc-voice',JSON.stringify(p));});
  });
  await check('New session: the conversation composer, and a hands-free start carries into the new session',async()=>{
   const back=await page.evaluate(()=>chatId); // the checks after this one continue in that conversation
   await page.setViewport({width:390,height:844});await page.goto(base+'/#/new');await page.waitForSelector('#plist .row.sel');await page.waitForSelector('#micb:not([hidden])');
   await page.evaluate(()=>{clearDraft(NEW_KEY);const f=document.querySelector('#first');f.value='';f.dispatchEvent(new Event('input'));const p=JSON.parse(localStorage.getItem('pc-voice')||'{}');p.review=false;p.speak=true;localStorage.setItem('pc-voice',JSON.stringify(p));});
   // 1.58: the same controls as a conversation's composer, in the composer (an empty box shows the headset).
   for(const sel of ['#composer-actions #c-att','#composer-actions #composer-toggle','#composer-actions #choose-skill','#composer-actions #save-prompt','#comp .toolbar-scroll #tbar #c-model','#comp #c-eff','#comp #c-approval','#comp #hfb','#comp #micb','#comp #first','#comp #start.send']){
    const r=await page.$eval(sel,e=>{const b=e.getBoundingClientRect();return {w:b.width,h:b.height,in:b.left>=0&&b.right<=innerWidth&&b.bottom<=innerHeight};});
    assert.ok(r.in&&r.h>=44||sel.endsWith('#first')&&r.in,sel+' '+JSON.stringify(r));
   }
   assert.equal(await page.$eval('#start',b=>b.getAttribute('aria-label')),'Start conversation');
   await scan('new-session-composer-mobile');await page.screenshot({path:path.join(out,'new-session-composer-mobile.png')});
   const sent=received.length;
   await page.evaluate(()=>{Voice._test.setHandsFree(NEW_KEY);Voice._test.handle('Count the incoming camera stock.');});
   assert.deepEqual(await page.evaluate(()=>Voice._test.pending()),{id:'new',text:'Count the incoming camera stock.'});assert.equal(received.length,sent,'hands-free never starts a session without a yes');
   await page.evaluate(()=>Voice._test.handle('Yes, send it'));
   await page.waitForFunction(()=>location.hash.startsWith('#/chat/')&&chatId&&document.querySelector('#box'));
   assert.equal(received.at(-1).text,'Count the incoming camera stock.');
   assert.equal(await page.evaluate(()=>Voice._test.handsFree()===chatId),true,'the hands-free conversation follows the session it started');
   await page.evaluate(()=>Voice._test.setHandsFree(null));await openChat(back);
  });
  await check('Voice: the spoken reply follows the chosen length',async()=>{
   const id=await page.evaluate(()=>chatId);
   const said=async length=>{
    await page.evaluate(l=>{const p=JSON.parse(localStorage.getItem('pc-voice')||'{}');p.replyLength=l;p.speak=true;localStorage.setItem('pc-voice',JSON.stringify(p));},length);
    const n=voiceLog.speak.length;
    const expected=await page.evaluate((id,l)=>{const all=document.querySelectorAll('#msgs .m-asst:not(.live)');const c=all[all.length-1].cloneNode(true);
     c.querySelectorAll('.copybtn,.ledgerwrap,.choices,pre,table,.todo,.todos').forEach(n=>n.remove());
     const parts=VoiceText.chunks(VoiceText.reply((c.innerText||c.textContent).trim(),l));Voice._test.arm(id);Voice.onTurnEnd(id,true);return parts;},id,length);
    for(let i=0;i<80&&voiceLog.speak.length<n+expected.length;i++)await pause(100);
    for(let i=0;i<60&&await page.evaluate(()=>Voice._test.state()==='speaking');i++)await pause(100);
    return {expected,spoken:voiceLog.speak.slice(n).map(x=>x.text)};
   };
   const brief=await said('brief');assert.deepEqual(brief.spoken,brief.expected,'brief speaks one line');
   const detailed=await said('detailed');assert.deepEqual(detailed.spoken,detailed.expected,'detailed speaks the whole reply');
   assert.ok(detailed.expected.join(' ').length>=brief.expected.join(' ').length);
   await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('pc-voice'));delete p.replyLength;localStorage.setItem('pc-voice',JSON.stringify(p));});
  });
  await check('Reply suggestions: cards under the last reply send on tap; typing or X hides them',async()=>{
   const conv=conversations.get(idle),saved=conv.slice();await chat();
   conv.push({role:'assistant',blocks:[{t:'text',text:'Tests pass. Should I merge and deploy?'},{t:'choices',options:['Merge and deploy',"Don't merge yet"],rec:0}]});
   await page.evaluate(id=>{localStorage.removeItem('pc-choices-dismissed');localStorage.removeItem('pc-draft-'+id);},idle);
   await page.reload();await page.waitForSelector('#box');await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input'));});
   await page.waitForSelector('.choices:not([hidden])');
   assert.deepEqual(await page.$$eval('.choices .choice',b=>b.map(x=>x.dataset.choice)),['Merge and deploy',"Don't merge yet"]);
   assert.deepEqual(await page.$$eval('.choices .choice',b=>b.map(x=>x.classList.contains('choice-rec'))),[true,false],'the marked option is the recommended one');
   assert.equal(await page.$eval('.choice-rec .choice-tag',e=>e.textContent),'Recommended');
   assert.equal(await page.$eval('.choice-rec',e=>e.textContent),'Merge and deployRecommended','the tag is in the accessible name');
   assert.ok(await page.$eval('.choice-rec',e=>{const s=getComputedStyle(e);return s.backgroundColor!==getComputedStyle(e.nextElementSibling).backgroundColor;}),'the recommended button is filled differently');
   assert.equal(await page.$eval('.choices',e=>e.closest('.m-asst')===[...document.querySelectorAll('#msgs .m-asst')].pop()),true,'under the latest reply');
   assert.ok(await page.$$eval('.choices button',b=>b.every(x=>{const r=x.getBoundingClientRect();return r.width>=44&&r.height>=44;})),'44px targets');
   assert.doesNotMatch(await page.$eval('#msgs',e=>e.textContent),/```|choices\n/,'the raw block never shows');
   await page.$eval('.choices',e=>e.scrollIntoView({block:'end'}));await pause(150);
   await scan('reply-suggestions-mobile');await page.screenshot({path:path.join(out,'reply-suggestions-mobile.png')});
   await page.type('#box','Something else');
   assert.equal(await page.$eval('.choices',e=>e.hidden),true,'typing your own answer hides them');
   await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input'));});
   assert.equal(await page.$eval('.choices',e=>e.hidden),false);
   await clickControl(page,'.choice-x');
   assert.equal(await page.$eval('.choices',e=>e.hidden),true);
   assert.equal(await page.evaluate(()=>document.activeElement.id),'box','focus moves to the message box');
   await page.reload();await page.waitForSelector('#box');await pause(300);
   assert.equal(await page.$eval('.choices',e=>e.hidden),true,'a dismissal sticks for that reply');
   await page.evaluate(()=>localStorage.removeItem('pc-choices-dismissed'));await page.reload();await page.waitForSelector('#box');
   await page.waitForSelector('.choices:not([hidden])');
   const sent=received.length;await clickControl(page,'.choice');
   for(let i=0;i<40&&received.length===sent;i++)await pause(100);
   assert.equal(received.at(-1).text,'Merge and deploy','a tap sends the option as the next message');
   await page.waitForFunction(()=>!document.querySelector('.choices:not([hidden])'));
   await page.waitForFunction(()=>!loadOutbox(chatId)&&!sendsInFlight.has(chatId));      // delivered before the page reloads
   conv.splice(0,conv.length,...saved);await page.reload();await page.waitForSelector('#box');
  });
  await check('Context ring: fills with context use, explains itself on hover and opens the session usage',async()=>{
   await page.setViewport({width:1440,height:900});await page.reload();await page.waitForSelector('#box');
   await page.waitForFunction(()=>(document.querySelector('#ctx-ring')?.dataset.tip||'').includes('tokens used'));
   assert.ok(await page.$eval('#ctx-ring',e=>!!e.closest('.composer-actions')),'idle: beside the settings button');
   assert.equal(await page.$eval('#ctx-ring .ctx-fill',e=>e.getAttribute('stroke-dasharray')),'43.5 100');
   const tip=await page.$eval('#ctx-ring',e=>e.dataset.tip);
   assert.match(tip,/Opus 5\.5/);assert.match(tip,/435k of 1M tokens used \(44%\)/);
   assert.match(await page.$eval('#ctx-ring',e=>e.getAttribute('aria-label')),/Context window for Opus 5\.5: 435k of 1M tokens used \(44%\)/);
   assert.equal(await page.$('#ctx-meter'),null,'the old text meter is gone');
   await page.hover('#ctx-ring');await page.waitForFunction(()=>!document.getElementById('tip').hidden);
   assert.match(await page.$eval('#tip',e=>e.textContent),/435k of 1M tokens used/);
   await page.screenshot({path:path.join(out,'context-ring-hover.png')});
   await clickControl(page,'#ctx-ring');await page.waitForSelector('.usage-sheet #usage-body .usage-block');
   const sheet=await page.$eval('.usage-sheet',e=>e.textContent);
   assert.match(sheet,/This conversation · Opus 5\.5/);assert.match(sheet,/Context window/);assert.match(sheet,/Window1M tokens/);assert.match(sheet,/Used435k tokens/);assert.match(sheet,/Free565k tokens/);
   assert.match(sheet,/Claude Code/);assert.match(sheet,/5-hour/);
   await scan('context-usage-sheet');await page.screenshot({path:path.join(out,'context-usage-sheet.png')});
   await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'ctx-ring','focus returns to the ring');
   const run=rows.find(r=>r.state.kind==='running');
   await page.goto(base+'/#/chat/'+run.id);await page.waitForSelector('.workrow #ctx-ring');
   await page.setViewport({width:390,height:844});await chat();await page.waitForSelector('.composer-actions #ctx-ring');
   assert.ok(await page.$eval('#ctx-ring',e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.right<=innerWidth;}),'44px target on a phone');
  });
  await check('Hands-free: an instruction is read back and sent only after a yes or a tap on Send',async()=>{
   const id=await page.evaluate(()=>chatId);let sent=received.length;
   const spoken=()=>voiceLog.speak.map(x=>x.text).join(' | ');
   const tap=()=>page.evaluate(()=>document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})));  // browsers allow sound after a tap
   await tap();
   await page.evaluate(id=>Voice._test.setHandsFree(id),id);
   await page.evaluate(()=>Voice._test.handle('Deploy the new build'));
   for(let i=0;i<40&&!/Ready to send: Deploy the new build/.test(spoken());i++)await pause(100);
   assert.match(spoken(),/Ready to send: Deploy the new build\./);
   for(let i=0;i<30&&!/Say send it, or cancel/.test(spoken());i++)await pause(100);
   assert.match(spoken(),/Say send it, or cancel\./);
   assert.equal(received.length,sent,'nothing sent before a yes');
   assert.deepEqual(await page.evaluate(()=>Voice._test.pending()),{id,text:'Deploy the new build'});
   await page.evaluate(()=>Voice._test.handle('Cancel'));
   assert.equal(await page.evaluate(()=>Voice._test.pending()),null);assert.equal(received.length,sent,'cancel sends nothing');
   await page.evaluate(()=>Voice._test.handle('Check the error logs'));
   await page.evaluate(()=>Voice._test.handle('Actually check the access logs'));
   assert.equal(await page.evaluate(()=>Voice._test.pending().text),'Actually check the access logs','a new instruction replaces the pending one');
   assert.equal(received.length,sent);
   await page.evaluate(()=>Voice._test.handle('Yes, send it'));
   for(let i=0;i<40&&received.length===sent;i++)await pause(100);
   assert.equal(received.at(-1).text,'Actually check the access logs','a yes sends it');
   sent=received.length;
   await page.evaluate(id=>{Voice.onLeave();Voice._test.setHandsFree(id);},id);await page.reload();await page.waitForSelector('#box');
   await tap();await page.evaluate(id=>Voice._test.setHandsFree(id),id);
   await page.evaluate(()=>Voice._test.handle('Summarize the queue'));
   await page.waitForFunction(()=>Voice._test.state()==='listening',{timeout:8000});
   await clickControl(page,'#voice-cancel');                                  // stop listening: the instruction waits with buttons
   await page.waitForSelector('#voice-send');
   assert.match(await page.$eval('#voice-strip',e=>e.textContent),/Send this\? “Summarize the queue”/);
   await scan('voice-confirm-mobile');await page.screenshot({path:path.join(out,'voice-confirm-mobile.png')});
   await clickControl(page,'#voice-send');
   for(let i=0;i<40&&received.length===sent;i++)await pause(100);
   assert.equal(received.at(-1).text,'Summarize the queue','tapping Send sends it');
   await page.evaluate(()=>Voice.onLeave());await page.reload();await page.waitForSelector('#box');
  });
  await check('Voice: Settings saves preferences and lists voices',async()=>{
   await page.evaluate(()=>settingsSheet());await page.waitForSelector('#s-voice');
   await clickControl(page,'#s-voice > summary');
   await page.waitForFunction(()=>document.querySelector('#s-voice-state').textContent.includes('available'));
   assert.deepEqual(await page.$$eval('#s-voice-voice option',o=>o.map(x=>x.value)),['af_heart','bm_george']);
   await clickControl(page,'#s-voice-review');
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pc-voice')).review),true);
   assert.equal(await page.$eval('#s-voice-wait',e=>e.value),'120','waits 2 minutes for a reply by default');
   assert.equal(await page.$eval('#s-voice-length',e=>e.value),'normal','spoken replies stay about two sentences by default');
   await page.select('#s-voice-length','detailed');
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pc-voice')).replyLength),'detailed');
   await page.select('#s-voice-length','normal');
   await page.select('#s-voice-wait','300');
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pc-voice')).replyWait),300);
   await page.select('#s-voice-voice','bm_george');
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pc-voice')).voice),'bm_george');
   await scan('settings-voice-mobile');
   await page.screenshot({path:path.join(out,'voice-settings-mobile.png')});
   await clickControl(page,'#s-voice-review');await page.keyboard.press('Escape');
  });
  await check('Voice: sessions that finish or need you are announced once; muted sessions stay quiet',async()=>{
   const saved=rows.map(r=>({state:r.state,muted:r.muted}));
   await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('pc-voice')||'{}');p.alerts='summary';localStorage.setItem('pc-voice',JSON.stringify(p));});
   await page.goto(base+'/#/');await page.waitForSelector('#settings');await page.mouse.click(5,5); // one tap unlocks audio
   await page.evaluate(()=>refreshSessions());await pause(300);await page.evaluate(()=>refreshSessions()); // status, then baseline
   const spoken=voiceLog.speak.length,at=Date.now();
   rows[1].state={kind:'finished',label:'Response ready',at};
   rows[2].state={kind:'input',label:'Needs approval',confirmed:true,approvals:1};
   rows[3].state={kind:'finished',label:'Response ready',at:at+1};rows[3].muted=true;
   await page.evaluate(()=>refreshSessions());
   const text=()=>voiceLog.speak.slice(spoken).map(x=>x.text).join(' | ');
   for(let i=0;i<120&&!(/finished\./.test(text())&&/needs your approval/.test(text()));i++)await pause(100);
   await pause(1500); // a summary is spoken as a second chunk
   const said=text(),settled=voiceLog.speak.length;
   assert.match(said,/finished\./,said);assert.match(said,/needs your approval\./,said);
   const short=t=>t.split(/\s+/).slice(0,3).join(' ');
   assert.ok(said.includes(short(rows[1].title)),said);assert.ok(!said.includes(short(rows[3].title)),'muted session stays quiet: '+said);
   await page.evaluate(()=>refreshSessions());await pause(1500);
   assert.equal(voiceLog.speak.length,settled,'each event is announced once: '+text());
   assert.equal((said.match(/finished\./g)||[]).length,1);assert.equal((said.match(/needs your approval/g)||[]).length,1);
   rows.forEach((r,i)=>{r.state=saved[i].state;if(saved[i].muted===undefined)delete r.muted;else r.muted=saved[i].muted;});
   await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('pc-voice'));p.alerts='off';localStorage.setItem('pc-voice',JSON.stringify(p));});
   await chat();
  });
  await check('Phone composer: the message box keeps a full row, idle and while a turn runs',async()=>{
   await page.setViewport({width:390,height:844});
   const run=rows.find(r=>r.state.kind==='running');
   for(const id of [idle,run.id]){
    await page.goto(base+'/#/chat/'+id);await page.waitForSelector('#box');await pause(200);
    const w=await page.$eval('#box',e=>e.getBoundingClientRect().width);
    assert.ok(w>=390*0.8,'box width '+w+' for '+id);
    const bad=await page.$$eval('.composer > .composer-actions button, .composer > .voice-mic:not([hidden]), .composer > .send, .composer > .send-mode button',b=>b.filter(x=>x.getClientRects().length).map(x=>{const r=x.getBoundingClientRect();return {id:x.id||x.className||x.textContent.trim().slice(0,20),right:Math.round(r.right),h:Math.round(r.height),w:Math.round(r.width)};}).filter(r=>r.right>innerWidth+1||r.h<40));
    assert.deepEqual(bad,[],'buttons on screen '+id);
   }
   // one row = every control's vertical centre within a few px of the others
   const spread=()=>page.$$eval('.composer > .voice-mic:not([hidden]), .composer > .send, .composer > .send-mode',els=>{const c=els.map(e=>{const r=e.getBoundingClientRect();return r.top+r.height/2;});return Math.max(...c)-Math.min(...c);});
   await page.screenshot({path:path.join(out,'composer-working-mobile.png')});
   assert.ok(await spread()<8,'steer choices, voice and Send share one row at 390px');
   await page.setViewport({width:360,height:800});await pause(200);
   await page.screenshot({path:path.join(out,'composer-working-360.png')});
   assert.ok(await spread()<8,'one row at 360px: '+await spread());
   await page.setViewport({width:390,height:844});
  });
  await check('A message sent while a reply runs carries the chips\' model and effort (1.81, #173)',async()=>{
   const run=rows.find(r=>r.state.kind==='running');
   await page.evaluate(id=>localStorage.setItem('pc-prefs-'+id,JSON.stringify({model:'claude-opus-5-5[1m]',effort:'high'})),run.id);
   await page.goto(base+'/#/chat/'+run.id);await page.reload();await page.waitForSelector('[data-mode="queue"]'); // reload: the previous check may have left this conversation open
   await clickControl(page,'[data-mode="queue"]');
   const sent=received.length;await page.type('#box','Then check the returns shelf.');await clickControl(page,'#send');
   for(let i=0;i<40&&received.length===sent;i++)await pause(100);
   const {text,mode,model,effort,executionMode}=received.at(-1);
   assert.deepEqual({text,mode,model,effort,executionMode},{text:'Then check the returns shelf.',mode:'queue',model:'claude-opus-5-5[1m]',effort:'high',executionMode:'work'},'queued with the model, effort and Codex mode it was sent with');
   // 1.81 (#183): Steer now is sent as auto, so a reply that cannot take a steer queues the message instead of refusing it
   await page.waitForFunction(id=>!localStorage.getItem('pc-outbox-'+id)&&!sendsInFlight.has(id)&&document.querySelector('#box')?.value==='',{},run.id); // the first send has settled
   await clickControl(page,'[data-mode="steer"]');
   const steered=received.length;await page.type('#box','Also count the spare cables.');await clickControl(page,'#send');
   for(let i=0;i<40&&received.length===steered;i++)await pause(100);
   assert.equal(received.at(-1).text,'Also count the spare cables.');assert.equal(received.at(-1).mode,'auto','Steer now sends auto');
   await page.evaluate(id=>{localStorage.removeItem('pc-prefs-'+id);sendModes.delete(id);},run.id);
  });
  await check('A start link\'s folder wins in New conversation, listed or not, over the default workspace (1.81, #176)',async()=>{
   const workspace=()=>page.evaluate(()=>({selected:document.querySelector('#plist .row.sel')?.dataset.p||null,custom:document.querySelector('#cpath').value}));
   const open=async link=>{await page.goto(base+'/#/start/'+link);await page.waitForFunction(()=>location.hash==='#/new'&&/Reach Jordan/.test(document.querySelector('#first')?.value||'')&&document.querySelector('#plist .row'));await pause(150);};
   setMode({defaultCwd:'/workspaces/products',startDirectory:'/workspaces/warehouse'});
   await open('0123456789ad');
   assert.deepEqual(await workspace(),{selected:'/workspaces/warehouse',custom:''},'a listed folder is selected, not the default');
   setMode({startDirectory:'/workspaces/returns'});
   await open('0123456789ae');
   assert.deepEqual(await workspace(),{selected:null,custom:'/workspaces/returns'},'a folder not listed is filled in as a custom path');
   setMode({defaultCwd:null,startDirectory:null});
   await page.evaluate(()=>{clearDraft(NEW_KEY);localStorage.removeItem('pc-new-start');localStorage.removeItem(briefingKey());});
  });
  await check('Attention filter includes Response ready replies until they are opened',async()=>{
   const done=rows.find(r=>r.state.kind==='finished')||rows[4];const saved=done.state,at=Date.now();
   done.state={kind:'finished',label:'Response ready',at};
   await page.goto(base+'/#/');await page.waitForSelector('[data-filter="attention"]');
   delete done.seenAt;await page.evaluate(id=>{localStorage.removeItem('pc-seen-'+id);serverSeen.delete(id);seenPending.delete(id);},done.id);await page.evaluate(()=>refreshSessions());await pause(300);
   await clickControl(page,'[data-filter="attention"]');await pause(200);
   const listed=()=>page.evaluate(id=>filteredSessions().some(s=>s.id===id)&&[...document.querySelectorAll('.session-item .row')].some(b=>b.dataset.id===id),done.id);
   assert.equal(await listed(),true,'an unopened reply is in Attention');
   assert.match(await page.$eval('[data-filter="attention"]',e=>e.textContent),/Attention\s*\d+/,'counted');
   await page.evaluate(([id,at])=>{localStorage.setItem('pc-seen-'+id,String(at));},[done.id,at]);await page.evaluate(()=>refreshSessions());await pause(300);
   assert.equal(await listed(),false,'leaves Attention once opened');
   await clickControl(page,'[data-filter="all"]');done.state=saved;
  });
  await check('Mark reviewed clears Response ready without opening it, singly or all at once with Undo',async()=>{
   const done=rows.find(r=>r.state.kind==='finished')||rows[4];const saved=done.state,at=Date.now();
   done.state={kind:'finished',label:'Response ready',at};
   await page.goto(base+'/#/');await page.waitForSelector('[data-filter="attention"]');
   delete done.seenAt;await page.evaluate(id=>{localStorage.removeItem('pc-seen-'+id);serverSeen.delete(id);seenPending.delete(id);},done.id);await page.evaluate(()=>refreshSessions());await pause(300);
   await clickControl(page,'[data-filter="attention"]');await pause(200);
   const listed=()=>page.evaluate(id=>filteredSessions().some(s=>s.id===id),done.id);
   assert.equal(await listed(),true,'starts in Attention');
   await clickControl(page,`[data-more="${done.id}"]`);await page.waitForSelector('#so-reviewed');await page.screenshot({path:path.join(out,'review-option.png')});await clickControl(page,'#so-reviewed');await pause(200);
   assert.equal(await listed(),false,'single mark leaves Attention');
   assert.equal(await page.evaluate(()=>location.hash),'#/','did not open the conversation');
   delete done.seenAt;await page.evaluate(id=>{localStorage.removeItem('pc-seen-'+id);serverSeen.delete(id);seenPending.delete(id);},done.id);await page.evaluate(()=>paintSessionPanels());
   await page.waitForSelector('[data-mark-all-reviewed]');await page.screenshot({path:path.join(out,'review-bar.png')});
   await clickControl(page,'[data-mark-all-reviewed]');await pause(200);await page.screenshot({path:path.join(out,'review-bar-undo.png')});
   assert.equal(await listed(),false,'bulk mark leaves Attention');
   for(let attempt=0;attempt<100&&done.seenAt!==at;attempt++)await pause(50);
   assert.equal(done.seenAt,at,'saved on the server for other devices');
   await clickControl(page,'[data-undo-reviewed]');
   for(let attempt=0;attempt<100&&done.seenAt!==undefined;attempt++)await pause(50);
   assert.equal(await listed(),true,'Undo brings it back');
   assert.equal(done.seenAt,undefined,'Undo also clears it on the server');
   await page.evaluate(([id,at])=>localStorage.setItem('pc-seen-'+id,String(at)),[done.id,at]);
   await clickControl(page,'[data-filter="all"]');done.state=saved;delete done.seenAt;
  });
  await check('A reply reviewed on another device leaves Attention here, and one opened here is shared',async()=>{
   const done=rows.find(r=>r.state.kind==='finished')||rows[4];const saved=done.state,at=Date.now();
   done.state={kind:'finished',label:'Response ready',at};done.seenAt=at;
   await page.goto(base+'/#/');await page.waitForSelector('[data-filter="attention"]');
   await page.evaluate(id=>localStorage.removeItem('pc-seen-'+id),done.id);await page.evaluate(()=>refreshSessions());await pause(300);
   await clickControl(page,'[data-filter="attention"]');await pause(200);
   assert.equal(await page.evaluate(id=>filteredSessions().some(s=>s.id===id),done.id),false,'the other device\'s review counts here');
   delete done.seenAt;await page.evaluate(([id,at])=>localStorage.setItem('pc-seen-'+id,String(at)),[done.id,at]);
   await page.evaluate(()=>refreshSessions());await pause(600);
   assert.equal(done.seenAt,at,'a marker saved only in this browser is sent to the server');
   await clickControl(page,'[data-filter="all"]');done.state=saved;delete done.seenAt;
  });
  await check('A reply that finishes on screen stays Response ready until you engage with the page',async()=>{
   const done=rows.find(r=>r.state.kind==='finished')||rows[4];const saved=done.state;
   done.state={kind:'finished',label:'Response ready',at:Date.now()};
   await page.goto(base+'/#/chat/'+done.id);await page.waitForSelector('#box');
   delete done.seenAt;await page.evaluate(id=>{localStorage.removeItem('pc-seen-'+id);serverSeen.delete(id);seenPending.delete(id);awaitingEngagement.add(id);},done.id); // as if the turn ended while watching
   await page.evaluate(()=>refreshSessions());await pause(200);
   assert.equal(await page.evaluate(id=>localStorage.getItem('pc-seen-'+id),done.id),null,'an unattended screen does not mark it read');
   assert.equal(await page.evaluate(id=>isUnread(allSessions.find(s=>s.id===id)),done.id),true,'still New in the session list');
   await page.mouse.click(200,300);await page.evaluate(()=>refreshSessions());await pause(200);
   assert.equal(await page.evaluate(id=>localStorage.getItem('pc-seen-'+id),done.id),String(done.state.at),'engaging marks it read');
   done.state=saved;
  });
  await check('Subagents: live count, disclosure, safe details, refresh, failure and keyboard return',async()=>{
   const agents=[{id:'review',name:'Review imports',task:'Check duplicate SKUs <script>unsafe()</script>',latest:'Reading supplier.csv',status:'running',model:'Test model'},{id:'tests',name:'Check tests',task:'Run the import checks.',latest:'All checks passed.',status:'completed'}];
   setMode({agents});await page.setViewport({width:390,height:844});await chat();
   await page.waitForSelector('#agents-open:not([hidden])');
   assert.match(await page.$eval('#agents-open',e=>e.textContent),/1 subagent working/);
   await clickControl(page,'#agents-open');await page.waitForSelector('.agent-row');await clickControl(page,'.agent-row summary');
   assert.equal(await page.$$eval('.agent-copy script',es=>es.length),0);
   assert.match(await page.$eval('.agent-copy',e=>e.textContent),/<script>/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   agents[0].task='Check duplicate SKUs across supplier imports.';await page.evaluate(()=>refreshAgents(chatId));
   assert.equal(await page.$eval('.agents-retry',e=>getComputedStyle(e).display),'none');
   await scan('subagents-mobile');await page.screenshot({path:path.join(out,'subagents-mobile.png')});
   agents[0].latest='Checking duplicates now';await page.evaluate(()=>refreshAgents(chatId));
   await page.waitForFunction(()=>document.querySelector('.agent-detail')?.textContent.includes('Checking duplicates now'),{timeout:8000}); // the re-render is async; wait for it before reading
   assert.equal(await page.$eval('.agent-row',e=>e.open),true,'refresh preserves disclosure');
   assert.match(await page.$eval('.agent-detail',e=>e.textContent),/Checking duplicates now/);
   setMode({agentsFail:true});await page.evaluate(()=>refreshAgents(chatId));
   assert.match(await page.$eval('.agents-status',e=>e.textContent),/could not be confirmed/);
   assert.match(await page.$eval('.agent-state',e=>e.textContent),/unconfirmed/);
   setMode({agentsFail:false});agents[0].status='completed';agents[0].latest='No duplicates.';
   // The open panel also refreshes itself every 5 s (app.js setInterval), and with the fixture healthy again that poll
   // can recover the panel — hiding Retry — between the line above and a pointer click. Fire Retry's handler directly so
   // the click cannot race the poll; the wait below still proves the panel recovers.
   await page.$eval('.agents-retry',e=>e.click());await page.waitForFunction(()=>document.querySelector('.agents-status').textContent.includes('0 working'));
   await page.setViewport({width:1440,height:900});await scan('subagents-desktop');await page.screenshot({path:path.join(out,'subagents-desktop.png')});
   await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'agents-open');
   await page.reload();await page.waitForSelector('#agents-open:not([hidden])');
   assert.match(await page.$eval('#agents-open',e=>e.textContent),/2 recorded/);
   setMode({agents:[]});await page.evaluate(()=>refreshAgents(chatId));
   assert.equal(await page.$eval('#agents-open',e=>e.hidden),true);
   await clickControl(page,'#chatmore');await clickControl(page,'#so-agents');await page.waitForFunction(()=>document.querySelector('.agents-status').textContent.includes('No subagents'));
   await page.keyboard.press('Escape');
   // 1.82: an agent with a transcript of its own opens it (steps unfolded, text escaped), and the row under the controls
   // also reports background jobs with the Subagents sheet naming them.
   const working=[{...agents[0],status:'running',activity:true,steps:3,messages:1,background:true}];
   setMode({agents:working,agentActivity:{agent:{id:'review',name:'Review imports',steps:3,messages:1},total:2,messages:[{role:'user',text:'Check duplicate SKUs across supplier imports.'},{role:'assistant',blocks:[{t:'text',text:'Looking at the imports <script>unsafe()</script>'},{t:'tool',name:'Read',detail:'supplier.csv'},{t:'tool',name:'Bash',detail:'npm run import:check'}]}]}});
   rows[4].state={kind:'background',label:'Working in background · 1 job',confirmed:true,background:{count:1,summary:'1 job',jobs:[{kind:'job',description:'npm run build'}]}};
   await page.evaluate(()=>{refreshSessions();return refreshAgents(chatId);});
   await page.waitForFunction(()=>/1 subagent working · 1 background job · View/.test(document.querySelector('#agents-open')?.textContent));
   await clickControl(page,'#agents-open');await page.waitForSelector('.agent-row');
   assert.match(await page.$eval('.agents-jobs',e=>e.textContent),/Background job: npm run build/);
   assert.match(await page.$eval('.agent-detail',e=>e.textContent),/in the background/);assert.match(await page.$eval('.agent-detail',e=>e.textContent),/3 tool calls · 1 message/);
   await clickControl(page,'.agent-row summary');assert.equal(await page.$eval('.agent-more',e=>e.hidden),false);
   await clickControl(page,'.agent-activity-open');await page.waitForSelector('.agent-activity .ledger');
   assert.equal(await page.$eval('.agent-activity-open',e=>e.getAttribute('aria-expanded')),'true');
   assert.equal(await page.$$eval('.agent-activity .ledger',e=>e.length),2);assert.equal(await page.$$eval('.agent-activity script',e=>e.length),0);
   assert.match(await page.$eval('.agent-activity .agent-brief',e=>e.textContent),/Check duplicate SKUs/);
   assert.equal(await page.$eval('.agent-activity details.ledgerwrap',e=>e.open),true,'the steps are unfolded');
   await scan('subagent-activity');await page.screenshot({path:path.join(out,'subagent-activity.png')});
   await clickControl(page,'.agent-activity-open');assert.equal(await page.$eval('.agent-activity',e=>e.hidden),true);
   await page.keyboard.press('Escape');
   // With no agents at all, the row still names the background work.
   setMode({agents:[],agentActivity:null});await page.evaluate(()=>refreshAgents(chatId));
   await page.waitForFunction(()=>document.querySelector('#agents-open')?.textContent==='Working in background · 1 job · View');
   rows[4].state={kind:'idle',label:'Recent'};await page.evaluate(()=>refreshSessions());
   await page.waitForFunction(()=>document.querySelector('#agents-open')?.hidden===true);
   await page.keyboard.press('Escape');
  });
  await check('Pinned sessions: tabs carry the pin and follow the shared order; grip drag, arrow keys and Session options reorder',async()=>{
   await page.setViewport({width:1440,height:900});
   const a=rows[3].id,b=rows[4].id,clay='rgb(217, 119, 87)';
   await page.goto(base+'/#/chat/'+a);await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},a);
   await page.goto(base+'/#/chat/'+b);await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},b);
   assert.equal(await page.$$eval('#open-sessions .open-session.pinned',es=>es.length),0,'no pins yet');
   await clickControl(page,'#chatmore');await page.waitForSelector('#so-pin');await clickControl(page,'#so-pin');                       // pin the open session from its header
   await page.waitForSelector(`.session-item.pinned[data-item="${b}"] [data-grip]`);
   await clickControl(page,`[data-more="${a}"]`);await page.waitForSelector('#so-pin');await clickControl(page,'#so-pin');            // pin another from the rail
   await page.waitForSelector(`.session-item.pinned[data-item="${a}"]`);
   await page.waitForFunction(()=>document.querySelectorAll('#open-sessions .open-session.pinned').length===2);
   const tabs=()=>page.$$eval('#open-sessions .open-session',es=>es.map(e=>({pinned:e.classList.contains('pinned'),title:e.querySelector('a').textContent.replace(/^Pinned: /,'').trim(),color:getComputedStyle(e.querySelector('a')).color,mark:Boolean(e.querySelector('.pinmark'))})));
   let shown=await tabs();
   assert.deepEqual(shown.slice(0,2).map(t=>t.pinned),[true,true],'pinned tabs come first');assert.ok(shown.slice(2).every(t=>!t.pinned),'unpinned tabs after them');
   assert.deepEqual(shown.slice(0,2).map(t=>t.title),[rows[3].title,rows[4].title],'in the list order (recency) before any reorder');
   assert.ok(shown.slice(0,2).every(t=>t.mark&&t.color===clay),'pinned tabs show the pin in the accent: '+JSON.stringify(shown));
   const grip=await page.$(`[data-grip="${b}"]`),gb=await grip.boundingBox(),ab=await (await page.$(`.session-item[data-item="${a}"]`)).boundingBox();
   let n=pinOrders.length;
   await page.mouse.move(gb.x+gb.width/2,gb.y+gb.height/2);await page.mouse.down();await page.mouse.move(ab.x+ab.width/2,ab.y+4,{steps:8});
   assert.equal(await page.$eval(`.session-item[data-item="${a}"]`,e=>e.classList.contains('drop-before')),true,'drop target is marked while dragging');
   await page.mouse.up();
   for(let i=0;i<40&&pinOrders.length===n;i++)await pause(100);
   assert.deepEqual(pinOrders.at(-1),[b,a],'drag saves the order on the server');
   assert.deepEqual(await page.$$eval('.session-item.pinned',es=>es.map(e=>e.dataset.item)),[b,a],'the list moved at once');
   shown=await tabs();assert.deepEqual(shown.slice(0,2).map(t=>t.title),[rows[4].title,rows[3].title],'tabs follow the pinned order');
   n=pinOrders.length;await page.focus(`[data-grip="${b}"]`);await page.keyboard.press('ArrowDown');
   for(let i=0;i<40&&pinOrders.length===n;i++)await pause(100);
   assert.deepEqual(pinOrders.at(-1),[a,b],'arrow keys reorder too');
   assert.equal(await page.evaluate(()=>document.activeElement?.dataset.grip),b,'focus stays on the moved grip');
   assert.match(await page.$eval('#toast',e=>e.textContent),/Pinned 2 of 2/);
   await clickControl(page,`[data-more="${a}"]`);await page.waitForSelector('#so-pin-down');assert.equal(await page.$('#so-pin-up'),null,'the first pin cannot move up');
   n=pinOrders.length;await clickControl(page,'#so-pin-down');for(let i=0;i<40&&pinOrders.length===n;i++)await pause(100);
   assert.deepEqual(pinOrders.at(-1),[b,a],'Session options moves it too');
   await scan('pinned-tabs-desktop');await page.screenshot({path:path.join(out,'pinned-tabs-desktop.png')});
   for(const id of [a,b]){await clickControl(page,`[data-more="${id}"]`);await page.waitForSelector('#so-pin');await clickControl(page,'#so-pin');await page.waitForFunction(id=>!document.querySelector(`.session-item.pinned[data-item="${id}"]`),{},id);}
   await page.waitForFunction(()=>document.querySelectorAll('#open-sessions .open-session.pinned').length===0);
  });
  await check('Row pin: one click pins and unpins without opening the conversation; Pin is the first option (1.94, Damon)',async()=>{
   await page.setViewport({width:1440,height:900});
   const a=rows[4].id,clay='rgb(217, 119, 87)';
   await openChat(rows[3].id);
   const pin=()=>page.$eval(`.rail [data-pin-toggle="${a}"]`,e=>({pressed:e.getAttribute('aria-pressed'),label:e.getAttribute('aria-label'),color:getComputedStyle(e).color,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}));
   let p=await pin();assert.equal(p.pressed,'false');assert.match(p.label,/^Pin /);assert.ok(p.h>=44&&p.w>=36,'pin target size '+JSON.stringify(p)+' '+await page.evaluate(()=>location.hash+' '+[...document.querySelectorAll('.rail')].length));
   await clickControl(page,`.rail [data-pin-toggle="${a}"]`);
   await page.waitForSelector(`.rail .session-item.pinned[data-item="${a}"]`);
   p=await pin();assert.equal(p.pressed,'true');assert.match(p.label,/^Unpin /);assert.equal(p.color,clay,'a pinned row shows the pin in the accent');
   assert.equal(await page.evaluate(()=>chatId),rows[3].id,'the pin does not open the conversation');
   assert.equal(await page.$(`.rail .session-item[data-item="${a}"] .row .pinmark`),null,'the meta line no longer repeats the pin');
   await clickControl(page,`.rail [data-more="${a}"]`);await page.waitForSelector('#so-pin');
   assert.equal(await page.$eval('.sheet .opt',e=>e.id),'so-pin','Unpin is the first option');
   assert.match(await page.$eval('#so-pin',e=>e.textContent),/^Unpin conversation/);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));
   await scan('row-pin-desktop');await page.screenshot({path:path.join(out,'row-pin-desktop.png')});
   await clickControl(page,`.rail [data-pin-toggle="${a}"]`);
   await page.waitForFunction(id=>!document.querySelector(`.session-item.pinned[data-item="${id}"]`),{},a);
   assert.equal((await pin()).pressed,'false');
   assert.equal(await page.evaluate(id=>document.activeElement?.dataset.pinToggle,a),a,'focus stays on the pin after the list repaints');
  });
  await check('Open-session tabs show each session status like its rail row; nothing when quiet or unconfirmed',async()=>{
   await page.setViewport({width:1440,height:900});
   const a=rows[3].id,b=rows[4].id;
   await page.goto(base+'/#/chat/'+a);await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},a);
   await page.goto(base+'/#/chat/'+b);await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},b);
   // One synchronous pass, so the list's background refresh cannot repaint between setting and reading.
   const r=await page.evaluate((a,b)=>{
    const sa=allSessions.find(s=>s.id===a),sb=allSessions.find(s=>s.id===b),saved=[sa.state,sb.state];
    const read=id=>{const tab=[...document.querySelectorAll('#open-sessions .open-session')].find(e=>e.querySelector('a').getAttribute('href').endsWith(id)),d=tab.querySelector('.tab-state'),cs=d&&getComputedStyle(d);
     return d?{cls:d.className,label:d.getAttribute('aria-label'),bg:cs.backgroundColor,border:cs.borderTopColor+' '+cs.borderTopWidth,anim:cs.animationName,w:d.getBoundingClientRect().width,tip:tab.querySelector('a').title,text:tab.querySelector('a').textContent}:null;};
    const out={};
    sa.state={kind:'running',label:'Running',confirmed:true};sb.state={kind:'input',label:'Needs your answer',confirmed:true};paintOpenSessions();out.running=read(a);out.input=read(b);
    sa.state={kind:'finished',label:'Response ready',at:Date.now()+1e9};sb.state={kind:'failed',label:'Turn failed',at:Date.now()+1e9};paintOpenSessions();out.finished=read(a);out.failed=read(b);
    sa.state={kind:'observed',label:'Activity elsewhere'};sb.state={kind:'idle',label:'Recent'};paintOpenSessions();out.observed=read(a);out.idle=read(b);
    sa.state={kind:'running',label:'Running',confirmed:true};sessionsStale=true;paintOpenSessions();out.stale=read(a);
    const probe=document.createElement('span');probe.className='session-status state-input';document.querySelector('.rail').append(probe);out.railInput=getComputedStyle(probe).color;probe.remove();
    sessionsStale=false;[sa.state,sb.state]=saved;paintOpenSessions();
    return out;
   },a,b);
   const clay='rgb(217, 119, 87)';
   assert.match(r.running.cls,/\bember\b/,'running reuses the ember');assert.equal(r.running.anim,'breathe');assert.equal(r.running.bg,clay);
   assert.equal(r.running.label,'Running');assert.match(r.running.tip,/ · Running$/);assert.equal(r.running.w,7,'small enough not to widen the tab');
   assert.equal(r.running.text,rows[3].title,'the status is not part of the tab text');
   assert.equal(r.input.bg,'rgb(217, 169, 78)','needs-you is amber, not the clay of a running turn');assert.equal(r.input.anim,'none','needs-you is a still dot, not the ember');assert.equal(r.input.label,'Needs your answer');assert.equal(r.railInput,'rgb(217, 169, 78)','the session list labels it in the same amber');
   assert.equal(r.finished.label,'Response ready');assert.notEqual(r.finished.bg,clay);
   assert.equal(r.failed.label,'Turn failed');assert.notEqual(r.failed.bg,r.finished.bg);
   assert.match(r.observed.border,/^rgb\(169, 158, 147\) [1-9]/,'activity elsewhere is a dim ring');
   assert.equal(r.idle,null,'quiet sessions show nothing');assert.equal(r.stale,null,'an unconfirmed list shows no status');
   await page.evaluate((a,b)=>{allSessions.find(s=>s.id===a).state={kind:'running',label:'Running',confirmed:true};allSessions.find(s=>s.id===b).state={kind:'input',label:'Needs your answer',confirmed:true};paintOpenSessions();},a,b);
   await scan('tab-status-desktop');await page.screenshot({path:path.join(out,'tab-status-desktop.png'),clip:{x:0,y:0,width:1440,height:160}});
  });
  await check('Prompt cache (1.28): the ring counts down, the usage sheet explains it, large expiring or cold tabs are marked',async()=>{
   await page.setViewport({width:1440,height:900});
   const id=rows[4].id,other=rows[3].id,min=60000;
   const cache=(ago,extra={})=>({at:Date.now()-ago*min,ttlMs:60*min,ttlKnown:true,cached:729000,lastTurn:{at:Date.now()-ago*min-2*min,read:707000,written:21000,input:4,hit:.97},...extra});
   const ring=()=>page.$eval('#ctx-ring',e=>({kind:e.dataset.cache||null,label:e.querySelector('.ctx-cache').textContent,tip:e.dataset.tip,aria:e.getAttribute('aria-label'),color:getComputedStyle(e.querySelector('.ctx-cache')).color,w:e.getBoundingClientRect().width}));
   const repaint=async kind=>{await page.evaluate(id=>paintContextMeter(id),id);await page.waitForFunction(k=>(document.querySelector('#ctx-ring')?.dataset.cache||null)===k,{},kind);};
   try{
    setMode({cache:cache(8)});
    await page.goto(base+'/#/chat/'+id);await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},id);
    await repaint('warm'); // already open from the previous check, so the hash change alone refetches nothing
    const warm=await ring();
    assert.match(warm.label,/^5[12]m$/,'minutes left beside the ring');assert.equal(warm.color,'rgb(169, 158, 147)','warm is dim, not a warning');
    assert.match(warm.tip,/435k of 1M tokens used \(44%\) · Prompt cache warm: about 5[12] min left, until .+ [AP]M \S+/);
    assert.match(warm.aria,/Context window for Opus 5\.5: 435k of 1M tokens used \(44%\)\. Prompt cache warm: about 5[12] min left, until .+ [AP]M \S+\. Open usage$/);
    await clickControl(page,'#ctx-ring');await page.waitForSelector('.usage-sheet .cache-block');
    let sheet=await page.$eval('.usage-sheet .cache-block',e=>e.textContent.replace(/\s+/g,' '));
    assert.match(sheet,/Prompt cache/);assert.match(sheet,/Status ?Warm · about 5[12] min left/);assert.match(sheet,/Expires ?([A-Z][a-z]{2} \d+, )?\d/);
    assert.match(sheet,/Cached ?729k tokens/);assert.match(sheet,/Lifetime ?1 hour/);assert.match(sheet,/The last reply, at .+ [AP]M \S+, started 97% from cache\./);
    assert.match(sheet,/Estimated from the last request at .+ [AP]M \S+; each request restarts the lifetime/);
    await page.waitForSelector('.usage-sheet #usage-body .usage-block');
    await scan('cache-usage-sheet');await page.screenshot({path:path.join(out,'cache-usage-sheet.png')});
    await page.keyboard.press('Escape');
    setMode({cache:cache(55)});await repaint('cooling');
    const cooling=await ring();assert.equal(cooling.label,'4m');assert.equal(cooling.color,'rgb(217, 169, 78)','the last stretch is amber');assert.match(cooling.tip,/Prompt cache cooling: about 4 min left/);
    await page.setViewport({width:390,height:844});await repaint('cooling');
    const phone=await page.evaluate(()=>{const r=document.getElementById('ctx-ring'),b=r.getBoundingClientRect(),row=r.parentElement.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,inRow:b.right<=row.right+0.5&&b.top>=row.top-0.5,h:b.height,x:b.x,y:b.y};});
    assert.equal(phone.overflow,false);assert.ok(phone.inRow,'the label stays inside the composer row');assert.ok(phone.h>=44,'still a 44px target');
    await scan('cache-ring-phone');await page.screenshot({path:path.join(out,'cache-ring-phone.png'),clip:{x:0,y:Math.max(0,phone.y-120),width:390,height:200}});
    await page.setViewport({width:1440,height:900});
    setMode({cache:cache(125,{lastTurn:{at:Date.now()-130*min,read:0,written:729000,input:4,hit:0}})});await repaint('cold');
    const cold=await ring();assert.equal(cold.label,'cold');assert.equal(cold.color,'rgb(159, 212, 240)','cold is ice blue');assert.equal(await page.$eval('#ctx-ring .ctx-fill',e=>getComputedStyle(e).stroke),'rgb(159, 212, 240)','the ring itself turns ice blue');assert.match(cold.aria,/Prompt cache expired at .+ [AP]M \S+; the next reply writes 729k tokens to cache again\. Open usage$/);
    const rr=await page.$eval('#ctx-ring',e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y};});
    await page.screenshot({path:path.join(out,'cache-ring-cold.png'),clip:{x:Math.max(0,rr.x-160),y:Math.max(0,rr.y-40),width:420,height:120}});
    await clickControl(page,'#ctx-ring');await page.waitForSelector('.usage-sheet .cache-block');
    sheet=await page.$eval('.usage-sheet .cache-block',e=>e.textContent.replace(/\s+/g,' '));
    assert.match(sheet,/Status ?Cold/);assert.match(sheet,/Expired ?([A-Z][a-z]{2} \d+, )?\d/);assert.match(sheet,/The last reply, at .+ [AP]M \S+, started cold: 729k tokens written to cache\./);assert.match(sheet,/The next reply writes the context to cache again/);
    await page.keyboard.press('Escape');
    setMode({cache:{...cache(8),ttlKnown:false,ttlMs:5*min,at:Date.now()-min}});await repaint('warm');
    await clickControl(page,'#ctx-ring');await page.waitForSelector('.usage-sheet .cache-block');
    assert.match(await page.$eval('.usage-sheet .cache-block',e=>e.textContent.replace(/\s+/g,' ')),/Lifetime ?5 minutes \(assumed\)/);
    await page.keyboard.press('Escape');
    setMode({cache:null});await repaint(null);
    const none=await ring();assert.equal(none.label,'');assert.equal(none.w,44,'no estimate: the ring alone, as before');assert.doesNotMatch(none.tip,/cache/i);
    // Tabs: only large sessions that are expiring or expired; warm, small and unconfirmed show nothing.
    await page.goto(base+'/#/chat/'+other);await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},other);
    await page.goto(base+'/#/chat/'+id);await page.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},id);
    const r=await page.evaluate((a,b)=>{
     const sa=allSessions.find(s=>s.id===a),sb=allSessions.find(s=>s.id===b),saved=[sa.cache,sb.cache],at=m=>Date.now()+serverSkew-m*60000;
     const read=id=>{const tab=[...document.querySelectorAll('#open-sessions .open-session')].find(e=>e.querySelector('a').getAttribute('href').endsWith(id)),m=tab.querySelector('.tab-cache');
      return m?{cls:m.className,label:m.getAttribute('aria-label'),role:m.getAttribute('role'),w:m.getBoundingClientRect().width,color:getComputedStyle(m).color,tip:tab.querySelector('a').title,text:tab.querySelector('a').textContent}:null;};
     const out={};
     sa.cache={at:at(125),ttlMs:3600000,cached:300000};sb.cache={at:at(55),ttlMs:3600000,cached:300000};paintOpenSessions();out.cold=read(a);out.cooling=read(b);
     sa.cache={at:at(5),ttlMs:3600000,cached:300000};sb.cache={at:at(125),ttlMs:3600000,cached:50000};paintOpenSessions();out.warm=read(a);out.small=read(b);
     sa.cache={at:at(125),ttlMs:3600000,cached:300000};sessionsStale=true;paintOpenSessions();out.stale=read(a);
     sessionsStale=false;[sa.cache,sb.cache]=saved;paintOpenSessions();
     return out;
    },other,id);
    assert.match(r.cold.cls,/tab-cache-cold/);assert.equal(r.cold.role,'img');assert.equal(r.cold.label,'Prompt cache expired: 300k tokens to write again');
    assert.match(r.cold.tip,/ · Prompt cache expired: 300k tokens to write again$/);assert.equal(r.cold.text,rows[3].title,'the mark adds no text to the tab');
    assert.ok(r.cold.w<=13,'small enough not to widen the tab');assert.equal(r.cold.color,'rgb(169, 158, 147)','dim, so it never reads as a session status colour');
    assert.match(r.cooling.cls,/tab-cache-cooling/);assert.equal(r.cooling.label,'Prompt cache expiring soon');
    assert.equal(r.warm,null,'a warm cache shows nothing');assert.equal(r.small,null,'a small session shows nothing');assert.equal(r.stale,null,'an unconfirmed list shows nothing');
    // The live list carries the estimate: both marks arrive with the next poll.
    rows[3].cache={at:Date.now()-125*min,ttlMs:60*min,cached:300000};rows[4].cache={at:Date.now()-55*min,ttlMs:60*min,cached:640000};
    await page.waitForFunction(()=>document.querySelectorAll('#open-sessions .tab-cache').length===2,{timeout:12000});
    await scan('cache-tabs-desktop');await page.screenshot({path:path.join(out,'cache-tabs-desktop.png'),clip:{x:0,y:0,width:1440,height:160}});
   }finally{setMode({cache:null});delete rows[3].cache;delete rows[4].cache;}
  });
  await check('Voice: one tap mutes replies and announcements on this device; settings mirror it; hands-free turns it back on',async()=>{
   await page.setViewport({width:390,height:844});await chat();await page.waitForSelector('#micb:not([hidden])');
   await page.waitForSelector('[data-voice-mute]:not([hidden])');
   assert.equal(await page.$eval('[data-voice-mute]',e=>e.getAttribute('aria-pressed')),'false');
   assert.match(await page.$eval('[data-voice-mute]',e=>e.textContent),/^Voice$/);
   await clickControl(page,'[data-voice-mute]');
   assert.equal(await page.evaluate(()=>Voice.isMuted()),true);
   assert.match(await page.$eval('[data-voice-mute]',e=>e.textContent),/Voice off/);
   assert.equal(await page.$eval('[data-voice-mute]',e=>e.getAttribute('aria-pressed')),'true');
   const spoken=voiceLog.speak.length;
   await page.evaluate(()=>Voice._test.handle('Read it.'));await pause(400);
   assert.equal(voiceLog.speak.length,spoken,'a quick command is answered on screen, not spoken');
   const strip=await page.$eval('#voice-strip',e=>e.textContent);assert.ok(strip.length>12&&!/^Heard:/.test(strip),'the strip shows the answer: '+strip);
   await page.evaluate(id=>{Voice._test.arm(id);Voice.onTurnEnd(id,true);},idle);await pause(400);
   assert.equal(voiceLog.speak.length,spoken,'a finished turn is not read aloud while muted');
   assert.equal(await page.evaluate(()=>Voice.replacesChime()),false,'the chime preference applies while muted');
   await page.evaluate(()=>settingsSheet());await page.waitForSelector('#s-voice-mute');
   assert.equal(await page.$eval('#s-voice-mute',e=>e.getAttribute('aria-pressed')),'true','Settings shows the same switch');
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));
   await scan('voice-muted-mobile');await page.screenshot({path:path.join(out,'voice-muted-mobile.png')});
   await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input'));});                                      // a saved draft would hide the headset
   await clickControl(page,'#hfb');await page.waitForFunction(()=>!Voice.isMuted());                                            // starting hands-free is asking to hear it
   await page.waitForSelector('#voice-cancel');await clickControl(page,'#voice-cancel');
   assert.equal(await page.$eval('[data-voice-mute]',e=>e.getAttribute('aria-pressed')),'false');
  });
  await check('Voice: the mic is hidden when the server has no voice engine',async()=>{
   setMode({voice:false});await page.reload();await page.waitForSelector('#box');await pause(300);
   assert.equal(await page.$eval('#micb',e=>e.hidden),true);assert.equal(await page.$eval('#hfb',e=>e.hidden),true);
   setMode({voice:true});await page.reload();await page.waitForSelector('#micb:not([hidden])');
  });
  // ---------- 1.19: fixes from the 2026-10-08 UI/UX audit ----------
  await check('1.19 Reading measure: prose stops near 68 characters on wide screens; tables keep the full width',async()=>{
   const target=rows[3].id,prose='Stock on hand covers the next three weeks for most products, but the outdoor camera line will run short before the incoming order lands, so we should move part of the recorder budget to cameras this month.';
   conversations.set(target,[{role:'user',text:'How does stock look?'},{role:'assistant',blocks:[{t:'text',text:prose+'\n\n- '+prose+'\n\n| Product | On hand | Incoming | Supplier reference | Notes |\n|---|---:|---:|---|---|\n| Outdoor camera | 24 | 12 | WAREHOUSE-LONG-REFERENCE-001 | '+prose+' |'}]}]);
   await page.setViewport({width:1440,height:900});await page.goto(base+'/#/chat/'+target);await page.waitForSelector('.m-asst .report-table');
   const m=await page.evaluate(()=>{const p=[...document.querySelectorAll('.m-asst :is(p,ul,ol,blockquote)')].find(e=>!e.closest('.report-table')),t=document.querySelector('.report-table'),size=parseFloat(getComputedStyle(p).fontSize);
    const probe=document.createElement('div');probe.style.width='68ch';p.parentElement.append(probe);const limit=probe.getBoundingClientRect().width;probe.remove();
    const para=[...document.querySelectorAll('.m-asst p')].find(e=>e.textContent.length>150),range=document.createRange();range.selectNodeContents(para);
    const lines=new Set([...range.getClientRects()].map(r=>Math.round(r.top))).size;
    return {p:p.getBoundingClientRect().width,t:t.getBoundingClientRect().width,limit,size,charsPerLine:Math.round(para.textContent.length/lines),msgs:document.querySelector('.msgs').getBoundingClientRect().width};});
   assert.ok(m.p<=m.limit+1,'prose width '+JSON.stringify(m));assert.ok(m.charsPerLine<=80,'line length '+JSON.stringify(m));assert.ok(m.t>m.p+100,'tables keep the wide frame '+JSON.stringify(m));
   await page.screenshot({path:path.join(out,'measure-desktop.png')});
  });
  await check('1.19 Phone header: the run status shares the title bar with the project, with no separate strip',async()=>{
   await page.setViewport({width:390,height:844});
   await page.evaluate(()=>{headerCollapsed=false;writeLocal('pc-header-collapsed',false);});await chat();await page.evaluate(()=>refreshSessions());
   const r=await page.evaluate(()=>{const c=document.getElementById('run-confirmation'),tag=document.getElementById('cproj');
    return {inHeader:Boolean(c.closest('header.bar h1')),inControls:document.getElementById('conversation-controls').contains(c),dy:Math.abs(c.getBoundingClientRect().bottom-tag.getBoundingClientRect().bottom),
     header:document.querySelector('.chatcol > header.bar').getBoundingClientRect().height,visible:c.getClientRects().length>0,label:c.textContent};});
   assert.ok(r.inHeader&&!r.inControls&&r.visible,JSON.stringify(r));
   assert.equal(await page.$eval('#run-confirmed-state',e=>e.textContent),'Idle','short words in the title bar');assert.ok(r.dy<6,'project and status on one line '+JSON.stringify(r));assert.ok(r.header<=104,'1.35: title, status and session links fit the old title bar plus strip '+JSON.stringify(r));
   assert.equal(await page.$eval('#chat-statebar',e=>Boolean(e.closest('header.bar'))),true,'1.35: the session links live in the header, not a strip below it');
   assert.equal(await page.$eval('#run-confirmed-at',e=>e.getClientRects().length),0,'a phone keeps the check age in the tooltip');
   await scan('status-in-header-mobile');await page.screenshot({path:path.join(out,'status-in-header-mobile.png')});
   await page.setViewport({width:1440,height:900});
   // 1.35: desktop uses the same single header: status and check age under the title, session links on the title row.
   await page.evaluate(()=>paintRunConfirmation());
   const d=await page.evaluate(()=>{const h=document.querySelector('.chatcol > header.bar').getBoundingClientRect(),t=document.getElementById('ctitle').getBoundingClientRect(),q=document.getElementById('queue-open').getBoundingClientRect(),c=document.getElementById('run-confirmation');
    return {header:h.height,sameRow:Math.abs((q.top+q.bottom)/2-(h.top+h.bottom)/2)<8&&q.left>t.left,inHeader:Boolean(c.closest('header.bar h1')),stamp:document.getElementById('run-confirmed-at').getClientRects().length>0};});
   assert.ok(d.inHeader&&d.stamp&&d.sameRow&&d.header<=64,JSON.stringify(d));
   await scan('one-header-desktop');await page.screenshot({path:path.join(out,'one-header-desktop.png')});
   await page.setViewport({width:390,height:844});
  });
  await check('1.19 Automated runs: one collapsed group at the end of All; search shows them normally',async()=>{
   const extra={id:'77777777-7777-4777-8777-777777777777',title:'Nightly backup check',automated:true,cwd:'/workspaces/ops',provider:'codex',mtimeMs:Date.now()-50000,state:{kind:'idle',label:'Recent'}};
   rows.push(extra);
   try{
    await page.goto(base+'/#/');await page.evaluate(()=>{localStorage.removeItem('pc-automated-open');sessionFilter='all';sessionQuery='';refreshSessions();});
    await page.waitForSelector('[data-automated]');
    const g=await page.$eval('[data-automated]',(e,id)=>({open:e.open,last:e===e.parentElement.lastElementChild,has:Boolean(e.querySelector(`[data-id="${id}"]`)),label:e.querySelector('summary h2').textContent}),extra.id);
    assert.equal(g.open,false);assert.ok(g.last&&g.has,JSON.stringify(g));assert.equal(g.label,'Automated1');
    assert.equal(await page.$$eval('.session-group:not([data-automated]) [data-id="'+extra.id+'"]',e=>e.length),0,'not repeated in Recent');
    await clickControl(page,'[data-automated] > summary');await page.waitForFunction(()=>readLocal('pc-automated-open',false)===true);
    await page.evaluate(()=>refreshSessions());assert.equal(await page.$eval('[data-automated]',e=>e.open),true,'open state survives a refresh');
    await scan('automated-group-mobile');await page.screenshot({path:path.join(out,'automated-group-mobile.png')});
    await page.type('[data-session-search]','backup');
    assert.equal(await page.$('[data-automated]'),null);assert.ok(await page.$(`section.session-group [data-id="${extra.id}"]`));
   } finally {
    rows.splice(rows.indexOf(extra),1);
    await page.evaluate(()=>{localStorage.removeItem('pc-automated-open');sessionQuery='';document.querySelectorAll('[data-session-search]').forEach(i=>i.value='');refreshSessions();});
   }
  });
  await check('1.19 Session list: an unchanged list answers 304 and still counts as a fresh check',async()=>{
   await page.goto(base+'/#/');await page.waitForSelector('[data-id]');
   const before=getMode().notModified||0,t0=await page.evaluate(async()=>{await refreshSessions();return sessionCheckedAt;});
   await pause(20);await page.evaluate(()=>refreshSessions());
   assert.ok((getMode().notModified||0)>before,'a 304 was served');
   assert.ok(await page.evaluate(()=>sessionCheckedAt)>t0,'the check time advanced');
   assert.equal(await page.evaluate(()=>sessionsStale),false);
   assert.ok(await page.$$eval('[data-session-results] [data-id]',e=>e.length)>=rows.length,'the list is kept');
  });
  await check('1.19 Failed turn: the reason and Send again at the end of the conversation; a draft is never overwritten',async()=>{
   const failed=rows[2],prior=failed.state;
   failed.state={kind:'failed',label:'Turn failed',at:Date.now(),confirmed:true,error:'Tool crashed while reading the supplier file'};
   try{
    await page.goto(base+'/#/chat/'+failed.id);await page.waitForSelector('#box');await page.evaluate(()=>refreshSessions());
    await page.waitForSelector('#turn-failure');
    assert.match(await page.$eval('#turn-failure',e=>e.textContent),/This reply ended with an error: Tool crashed while reading the supplier file/);
    assert.equal(await page.$eval('#msgs',e=>e.lastElementChild.id),'turn-failure','shown where you are reading');
    await page.waitForFunction(()=>{const r=document.querySelector('[data-retry-turn]').getBoundingClientRect(),c=document.querySelector('.composerwrap').getBoundingClientRect();return r.bottom<=c.top;},{timeout:3000}); // Send again is above the composer, not behind it
    await scan('turn-failure-mobile');await page.screenshot({path:path.join(out,'turn-failure-mobile.png')});
    await page.$eval('#box',e=>{e.value='My own draft';e.dispatchEvent(new Event('input'));});
    const before=received.length;await clickControl(page,'[data-retry-turn]');await pause(300);
    assert.equal(await page.$eval('#box',e=>e.value),'My own draft');assert.equal(received.length,before,'nothing sent over a draft');
    await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input'));});
    await clickControl(page,'[data-retry-turn]');
    for(let i=0;i<40&&received.length===before;i++)await pause(100);
    assert.equal(received.at(-1).text,'Review the stock report.');
    assert.equal(await page.$('#turn-failure'),null,'the row goes once you send');
   } finally {failed.state=prior;}
  });
  await check('1.19 Session options: grouped, with display settings last',async()=>{
   await chat();await clickControl(page,'#chatmore');await page.waitForSelector('.sheet .opt-group');
   const groups=await page.$$eval('.sheet .opt-group',gs=>gs.map(g=>({label:g.getAttribute('aria-label'),ids:[...g.querySelectorAll('button.opt')].map(b=>b.id),size:Boolean(g.querySelector('.chat-text-settings'))})));
   assert.deepEqual(groups.map(g=>g.label),['This conversation','Organize','Server process','Display and version']);
   assert.deepEqual(groups[0].ids,['so-find','so-changes','so-side','so-branch','so-agents','so-usage'],'1.78/1.79: Side chat and Branch sit with the conversation tools');
   assert.ok(groups.at(-1).size&&groups.at(-1).ids.includes('so-version'));
   assert.ok(await page.$eval('#so-find',e=>e.getBoundingClientRect().bottom<innerHeight),'the first action is in view on a phone');
   await scan('session-options-grouped-mobile');await page.screenshot({path:path.join(out,'session-options-grouped-mobile.png')});
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));
  });
  await check('1.19 New session: the most recent workspace is preselected; missing input is explained beside Start',async()=>{
   await page.evaluate(()=>{localStorage.removeItem('pc-lastproj');clearDraft(NEW_KEY);});
   await page.goto(base+'/#/new');await page.waitForSelector('#plist .row.sel');
   assert.equal(await page.$eval('#plist .row.sel',e=>e.dataset.p),'/workspaces/warehouse');
   assert.match(await page.$eval('#task-context',e=>e.textContent),/warehouse/);
   await page.$eval('#first',e=>{e.value='';e.dispatchEvent(new Event('input'));});await clickControl(page,'#start');
   assert.equal(await page.$eval('#start-hint',e=>e.hidden),false);assert.match(await page.$eval('#start-hint',e=>e.textContent),/Write what you would like done/);
   await scan('new-session-hint-mobile');
   await page.type('#first','x');assert.equal(await page.$eval('#start-hint',e=>e.hidden),true);
   await page.$eval('#first',e=>{e.value='';e.dispatchEvent(new Event('input'));});
  });
  await check('1.55 New session: a locked workspace shows the one folder with nothing to choose',async()=>{
   setMode({lockedWorkspace:true});
   await page.goto(base+'/#/');await page.waitForSelector('.session-home, #rail'); // leave the New screen so the next hash renders it afresh
   await page.goto(base+'/#/new');await page.waitForSelector('#plist .workspace-locked');
   assert.equal(await page.$$eval('#plist [role=radio]',es=>es.length),0,'no picker');
   const shown=await page.$eval('#plist .workspace-locked',e=>e.textContent);assert.match(shown,/warehouse/);assert.match(shown,/Every conversation starts here/);
   assert.equal(await page.$eval('#projh',e=>e.textContent),'Workspace');
   assert.equal(await page.$eval('#cpath',e=>e.closest('div').hidden),true,'no custom path field');
   assert.match(await page.$eval('#task-context',e=>e.textContent),/Workspace.*warehouse/);
   await scan('new-session-locked-mobile');
   setMode({lockedWorkspace:false});
   await page.goto(base+'/#/');await page.waitForSelector('.session-home, #rail');
   await page.goto(base+'/#/new');await page.waitForSelector('#plist .row.sel');assert.equal(await page.$$eval('#plist [role=radio]',es=>es.length),2,'the picker is back');
  });
  await check('1.20 Settings: generated titles switch on and off, choose a model, and say why one is unavailable',async()=>{
   await page.setViewport({width:390,height:844});await page.goto(base+'/#/');await page.waitForSelector('#settings');
   await clickControl(page,'#settings');await page.waitForFunction(()=>!document.querySelector('#s-titles').disabled);
   assert.equal(await page.$eval('#s-titles',e=>e.getAttribute('aria-pressed')),'true');
   assert.match(await page.$eval('#s-titles-state',e=>e.textContent),/On, using Claude · Haiku/);
   assert.deepEqual(await page.$$eval('#s-title-model option',os=>os.map(o=>[o.value,o.disabled])),[['auto',false],['claude',false],['codex',true]],'an unavailable provider cannot be chosen');
   assert.match(await page.$eval('#s-title-model option[value="codex"]',o=>o.textContent),/unavailable/);
   assert.match(await page.$eval('#s-title-note',e=>e.textContent),/Last title by Haiku 4\.5/);
   await clickControl(page,'[data-settings-category=conversation]');
   assert.ok(await page.$eval('#s-titles',e=>e.getBoundingClientRect().height)>=44);
   await page.$eval('#s-titles',e=>e.scrollIntoView({block:'center'}));
   await scan('title-settings-mobile');await page.screenshot({path:path.join(out,'title-settings-mobile.png')});
   await clickControl(page,'#s-titles');await page.waitForFunction(()=>document.querySelector('#s-titles').getAttribute('aria-pressed')==='false');
   assert.equal(settingsState().autoTitles,false);assert.equal(await page.$eval('#s-title-model',e=>e.disabled),false,'the model choice stays available while summaries are on (1.21)');
   assert.match(await page.$eval('#s-titles-state',e=>e.textContent),/^Off\./);
   await clickControl(page,'#s-titles');await page.waitForFunction(()=>!document.querySelector('#s-title-model').disabled);
   await page.select('#s-title-model','claude');await page.waitForFunction(()=>!document.querySelector('#s-title-model').disabled);
   assert.equal(settingsState().titleProvider,'claude');
   await page.select('#s-title-model','auto');await page.waitForFunction(()=>!document.querySelector('#s-title-model').disabled);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));
  });
  await check('1.20.1 Polish: chip fade and short label, gauge track, home workspace, copy, Git, 44px targets, suggestion X',async()=>{
   await page.setViewport({width:390,height:844});
   await page.goto(base+'/#/');await page.waitForSelector('[data-id]');
   const meta=await page.$eval(`[data-id="${idle}"] .meta`,e=>e.textContent.trim());
   assert.equal(meta,'Claude','a session in the default workspace shows only the agent');
   assert.match(await page.$eval(`[data-id="${rows[0].id}"] .meta`,e=>e.textContent),/warehouse · Claude/,'other workspaces stay named');
   const summary=n=>page.evaluate(n=>{const saved=allSessions;allSessions=Array.from({length:n},(_,i)=>({id:'a'+i,state:{kind:'input',label:'Needs approval'}}));const s=sessionSummary();allSessions=saved;return s;},n);
   assert.match(await summary(1),/· 1 needs attention$/);assert.match(await summary(2),/· 2 need attention$/);
   rows[4].repo=false;
   try{
    await chat();await page.waitForSelector('#c-approval');
    assert.equal(await page.$eval('#git-open',e=>e.hidden),true,'no Git control outside a repository');
    const chip=await page.$eval('#c-approval',e=>({text:e.innerText.trim(),label:e.getAttribute('aria-label')}));
    assert.match(chip.text,/^(Full|Review)$/);assert.match(chip.label,/^Permissions for the next reply: (Full access|Review actions)$/);
    const fade=await page.$eval('#tbar',e=>({over:e.scrollWidth>e.clientWidth+1,end:e.classList.contains('fade-end')}));
    assert.equal(fade.end,fade.over,'the scrolling edge fades exactly when the row overflows');
    assert.match(await page.$eval('.ctx-ring .ctx-track',e=>getComputedStyle(e).strokeDasharray),/\d/,'dotted gauge track');
    const small=await page.$$eval('.copybtn.msgcopy, .toolbar-scroll > .icon:not([hidden])',es=>es.map(e=>e.getBoundingClientRect()).filter(r=>r.width&&(r.width<44||r.height<44)).length);
    assert.equal(small,0,'copy and scroll controls are 44px');
   } finally {delete rows[4].repo;}
   await openChat(rows[0].id);
   assert.equal(await page.$eval('#git-open',e=>e.hidden),false,'Git stays where the server does not say otherwise');
   // Suggested replies: two long options wrap, the X stays on the first line.
   const id=rows[3].id;conversations.set(id,[{role:'user',text:'Ready?'},{role:'assistant',blocks:[{t:'text',text:'Tests pass. What next?'},{t:'choices',options:['Merge the pull request and deploy it to both servers now','Hold the release until I have reviewed it']}]}]);
   await openChat(id);
   await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input'));});
   await page.waitForSelector('.choices:not([hidden])');
   const pos=await page.$eval('.choices',c=>{const x=c.querySelector('.choice-x').getBoundingClientRect(),first=c.querySelector('.choice').getBoundingClientRect();return {xTop:Math.round(x.top),firstTop:Math.round(first.top)};});
   assert.ok(Math.abs(pos.xTop-pos.firstTop)<4,'dismiss X on the first line '+JSON.stringify(pos));
   await scan('polish-choices-mobile');await page.screenshot({path:path.join(out,'polish-choices-mobile.png')});
  });
  await check('1.21/1.25 While you were away: divider at the first new message, view opens at the end, away card above the choices, Read from there, none on re-render',async()=>{
   await page.setViewport({width:390,height:844});
   const id=rows[1].id,now=Date.now(),ts=m=>new Date(now-m*60000).toISOString(),long='Paragraph of earlier work that you already read. '.repeat(8);
   conversations.set(id,[
    ...Array.from({length:6},(_,i)=>[{role:'user',text:'Earlier question '+i,ts:ts(300-i*10)},{role:'assistant',blocks:[{t:'text',text:long}],ts:ts(299-i*10)}]).flat(),
    {role:'user',text:'Check stock and draft the order',ts:ts(60)},
    {role:'assistant',blocks:[{t:'tool',name:'Bash',detail:'stock --all'},{t:'tool',name:'Read',detail:'reorder.csv'},{t:'tool',name:'Bash',detail:'draft-order'},{t:'text',text:'Three products are below their reorder level. The order is drafted. '+'Details for each product follow in the table below. '.repeat(14)}],ts:ts(30)},
    {role:'assistant',blocks:[{t:'text',text:'Waiting for your approval before sending it. Send the order?'},{t:'choices',options:['Send the order','Hold it for now'],rec:0}],ts:ts(20)},
   ]);
   const since=now-45*60000;await page.evaluate((id,since)=>{viewedAt[id]=since;writeLocal('pc-viewed',viewedAt);},id,since);
   const before=(getMode().awayCalls||[]).length;
   await page.goto(base+'/#/');await page.waitForSelector('[data-id]');
   await page.evaluate(id=>{location.hash='#/chat/'+id;},id);await page.waitForSelector('#away-divider');
   await page.waitForFunction(()=>document.querySelector('#away-card .away-body li'));await pause(500);
   // the nearest message each side; a day divider sits between them when the hour before falls on either side of midnight
   const r=await page.evaluate(()=>{const d=document.getElementById('away-divider'),c=document.getElementById('away-card'),s=d.closest('main.scroll'),last=[...document.querySelectorAll('#msgs > .m-asst')].pop();
    const near=dir=>{let n=d[dir];while(n?.classList.contains('day-divider'))n=n[dir];return n?.dataset.ts;};
    return {label:d.getAttribute('aria-label'),after:near('nextElementSibling'),before:near('previousElementSibling'),
     cardLabel:c.querySelector('#away-card-label').textContent,inLast:c.parentElement===last,beforeChoices:c.nextElementSibling?.classList.contains('choices')&&!c.nextElementSibling.hidden,
     gap:Math.round(s.scrollHeight-s.scrollTop-s.clientHeight),dividerAbove:d.getBoundingClientRect().bottom<s.getBoundingClientRect().top,anchored:Boolean(awayAnchor?.isConnected),following:awayFollow};});
   assert.match(r.label,/^New since (?:yesterday )?\d{1,2}:\d{2}/);
   assert.equal(r.after,ts(30),'the divider sits before the first message after you left');assert.equal(r.before,ts(60),'your message from before you left stays above');
   assert.ok(r.gap<40,'the view opens at the end '+JSON.stringify(r));assert.ok(r.dividerAbove,'the divider is up in the conversation, not on screen');
   assert.equal(r.cardLabel,r.label,'the card repeats the New since line');assert.ok(r.inLast&&r.beforeChoices,'the card sits in the latest reply above its suggested replies '+JSON.stringify(r));
   assert.ok(r.following&&!r.anchored,'the view follows the end while the page settles');
   assert.deepEqual(await page.$$eval('#away-card .away-body li',l=>l.map(x=>x.textContent)),['Checked stock for 24 products','Three are below their reorder level','Waiting on you: approve the order']);
   assert.match(await page.$eval('#away-card .away-source',e=>e.textContent),/^Summary by Haiku 5\.5\./);
   assert.equal((getMode().awayCalls||[]).length,before+1);assert.equal(getMode().awayCalls.at(-1),since);
   await scan('away-mobile');await page.screenshot({path:path.join(out,'away-mobile.png')});
   await page.setViewport({width:1440,height:900});await pause(200);await page.screenshot({path:path.join(out,'away-desktop.png')});await page.setViewport({width:390,height:844});await pause(200);
   // Read from there: the divider comes to the top and holds; a scroll releases it.
   await clickControl(page,'#away-jump');await pause(100);
   const j=await page.evaluate(()=>{const d=document.getElementById('away-divider'),s=d.closest('main.scroll');return {top:Math.round(d.getBoundingClientRect().top-s.getBoundingClientRect().top),anchored:Boolean(awayAnchor?.isConnected),following:awayFollow};});
   assert.ok(j.top>=0&&j.top<=24&&j.anchored&&!j.following,'Read from there moves to the divider and holds it '+JSON.stringify(j));
   await page.evaluate(()=>document.querySelector('main.scroll').dispatchEvent(new WheelEvent('wheel',{deltaY:40})));
   assert.equal(await page.evaluate(()=>awayAnchor),null,'a scroll releases the hold');
   // A resync of the conversation you are reading (turn end, rail toggle) never adds a divider or a card.
   await page.evaluate(id=>renderChat(id),id);await page.waitForSelector('#box');await pause(200);
   assert.equal(await page.$('#away-divider'),null);assert.equal(await page.$('#away-card'),null);
   // Coming back right after leaving: nothing new, no divider and no call.
   await page.goto(base+'/#/');await page.waitForSelector('[data-id]');await page.evaluate(id=>{location.hash='#/chat/'+id;},id);await page.waitForFunction(id=>chatId===id&&document.querySelector('#ctitle')?.textContent!=='Session',{},id);await pause(300);
   assert.equal(await page.$('#away-divider'),null);assert.equal((getMode().awayCalls||[]).length,before+1);
   // A short exchange whose divider is already on screen at the end gets the divider only: no summary, no card.
   await page.goto(base+'/#/');await page.waitForSelector('[data-id]');                     // leaving records a fresh viewed time, so set it from the list
   await page.evaluate((id,since)=>{viewedAt[id]=since;writeLocal('pc-viewed',viewedAt);},id,now-25*60000);
   await page.evaluate(id=>{location.hash='#/chat/'+id;},id);await page.waitForSelector('#away-divider');await pause(400);
   assert.equal(await page.$('#away-card'),null,'one short message with its divider on screen: no card');
   assert.equal((getMode().awayCalls||[]).length,before+1,'no summary call for a short exchange');
   assert.ok(await page.evaluate(()=>{const s=document.querySelector('main.scroll');return s.scrollHeight-s.scrollTop-s.clientHeight<40;}),'still opens at the end');
  });
  await check('1.21 Settings: Summarize what you missed switches summaries on and off',async()=>{
   await page.goto(base+'/#/');await page.waitForSelector('#settings');await clickControl(page,'#settings');
   await page.waitForFunction(()=>!document.querySelector('#s-away').disabled);
   assert.equal(await page.$eval('#s-away',e=>e.getAttribute('aria-pressed')),'true');
   assert.match(await page.$eval('#s-away-state',e=>e.textContent),/opens at the end with a New since card/);
   await clickControl(page,'#s-away');await page.waitForFunction(()=>document.querySelector('#s-away').getAttribute('aria-pressed')==='false');
   assert.equal(settingsState().awaySummaries,false);
   await page.$eval('#s-away',e=>e.scrollIntoView({block:'center'}));await scan('away-settings-mobile');
   await clickControl(page,'#s-away');await page.waitForFunction(()=>document.querySelector('#s-away').getAttribute('aria-pressed')==='true');
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));
  });
  await check('1.24 Message times: a time on each timestamped message (with the date on other days), a divider per day, live dividers, setting hides both',async()=>{
   await page.setViewport({width:390,height:844});
   // Anchor fixture times at local noon so subtracting hours cannot cross midnight.
   const id=rows[3].id,now=new Date().setHours(12,0,0,0),day=86400000,ts=ms=>new Date(ms).toISOString();
   conversations.set(id,[
    {role:'user',text:'Start the stock review.',ts:ts(now-2*day-3600000)},{role:'assistant',blocks:[{t:'text',text:'Counting the warehouse shelves now.'}],ts:ts(now-2*day-3500000)},
    {role:'user',text:'Any surprises?',ts:ts(now-day-7200000)},{role:'assistant',blocks:[{t:'text',text:'Two recorders are missing from bay 4.'}],ts:ts(now-day-7100000)},
    {role:'user',text:'Draft the reorder.',ts:ts(now-600000)},{role:'assistant',blocks:[{t:'text',text:'The reorder is drafted and waiting for you.'}],ts:ts(now-540000)},
    {role:'user',text:'A message with no time yet.'},
   ]);
   await openChat(id);await pause(200);
   const r=await page.evaluate(()=>{const m=document.getElementById('msgs'),divs=[...m.querySelectorAll('.day-divider')],rows=[...m.querySelectorAll('[data-ts]')],asst=m.querySelector('.m-asst[data-time]'),user=m.querySelector('.m-user[data-time]');
    return {labels:divs.map(d=>d.getAttribute('aria-label')),firstIsDivider:m.firstElementChild?.classList.contains('day-divider'),times:rows.map(e=>e.dataset.time||null),
     noTime:[...m.querySelectorAll('.m-user:not([data-ts])')].map(e=>e.hasAttribute('data-time')),asstBefore:getComputedStyle(asst,'::before').content,userAfter:getComputedStyle(user,'::after').content,
     asstText:asst.textContent,asstColor:getComputedStyle(asst,'::before').color,userColor:getComputedStyle(user,'::after').color,userBg:getComputedStyle(user).backgroundColor};});
   assert.equal(r.labels.length,3,'one divider per day '+JSON.stringify(r.labels));assert.deepEqual(r.labels.slice(1),['Yesterday','Today']);
   assert.match(r.labels[0],/^([A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}|[A-Z][a-z]{2} \d{1,2}, \d{4})$/,'an older day is named by date');
   assert.ok(r.firstIsDivider,'the conversation opens with the first day');
   assert.equal(r.times.length,6);
   r.times.slice(4).forEach(t=>assert.match(t,/^\d{1,2}:\d{2} [AP]M$/,'today: time only'));
   r.times.slice(2,4).forEach(t=>assert.match(t,/^Yesterday \d{1,2}:\d{2} [AP]M$/,'yesterday is named'));
   r.times.slice(0,2).forEach(t=>assert.match(t,/^[A-Z][a-z]{2} \d{1,2}(, \d{4})?, \d{1,2}:\d{2} [AP]M$/,'older days carry the date'));
   assert.deepEqual(r.noTime,[false],'a message without a transcript time shows none');
   assert.equal(r.asstBefore,'"'+r.times[1]+'"');assert.equal(r.userAfter,'"'+r.times[0]+'"');
   assert.ok(!r.asstText.includes(r.times[1]),'the time is not part of the copied text');
   // Find never matches a time; the live stream adds a divider only when the day changes.
   await clickControl(page,'#findb');await page.type('#fq',r.times[1]);await pause(100);
   assert.equal(await page.$eval('#fcount',e=>e.textContent.trim()),'none','a time is not findable text');await clickControl(page,'#fclose');
   const live=await page.evaluate(()=>{const m=document.getElementById('msgs'),n=m.querySelectorAll('.day-divider').length;
    appendDayDivider(m,new Date().toISOString());const same=m.querySelectorAll('.day-divider').length;
    appendDayDivider(m,new Date(Date.now()+86400000).toISOString());return {same:same-n,next:m.querySelectorAll('.day-divider').length-same,last:m.lastElementChild.classList.contains('day-divider')};});
   assert.deepEqual(live,{same:0,next:1,last:true});
   await page.evaluate(()=>document.querySelector('#msgs .day-divider:last-child')?.remove());
   await scan('message-times-mobile');await page.screenshot({path:path.join(out,'message-times-mobile.png')});
   await page.setViewport({width:1440,height:900});await pause(200);await page.screenshot({path:path.join(out,'message-times-desktop.png')});await page.setViewport({width:390,height:844});
   await page.evaluate(()=>settingsSheet());await page.waitForSelector('#s-times');
   assert.equal(await page.$eval('#s-times',b=>b.getAttribute('aria-pressed')),'true');
   await clickControl(page,'#s-times');await pause(100);
   const off=await page.evaluate(()=>{const m=document.getElementById('msgs');return {cls:m.classList.contains('times-off'),div:getComputedStyle(m.querySelector('.day-divider')).display,t:getComputedStyle(m.querySelector('.m-asst[data-time]'),'::before').display,pressed:document.querySelector('#s-times').getAttribute('aria-pressed'),stored:readLocal('pc-times',true)};});
   assert.deepEqual(off,{cls:true,div:'none',t:'none',pressed:'false',stored:false});
   await clickControl(page,'#s-times');await pause(100);
   assert.equal(await page.$eval('#msgs',m=>m.classList.contains('times-off')),false);
   await page.keyboard.press('Escape');await pause(200);
  });
  await check('1.22 Search inside conversations: results under the box, marked words, related rows, open at the match',async()=>{
   await page.setViewport({width:390,height:844});
   conversations.set(rows[3].id,[{role:'user',text:'How is stock?'},{role:'assistant',blocks:[{t:'text',text:'Incoming stock is separate from the on-hand count for each recorder.'}]}]);
   await page.goto(base+'/#/');await page.waitForSelector('[data-session-search]');
   const before=(getMode().searchCalls||[]).length;
   await page.type('[data-session-search]','in');await pause(700);
   assert.equal(await page.$('.convo-group'),null,'two characters do not search inside conversations');
   assert.equal((getMode().searchCalls||[]).length,before);
   await page.type('[data-session-search]','coming stock');
   await page.waitForSelector('.convo-group .convo-item');
   assert.equal((getMode().searchCalls||[]).length,before+1,'one request after typing settles');
   assert.equal(getMode().searchCalls.at(-1),'incoming stock');
   const g=await page.$eval('.convo-group',e=>({h:e.querySelector('h2').textContent,note:e.querySelector('.convo-note').textContent,
     rows:[...e.querySelectorAll('.convo-item')].map(r=>({who:r.querySelector('.convo-who').textContent,marks:[...r.querySelectorAll('mark')].map(m=>m.textContent)}))}));
   assert.equal(g.h,'In conversations2');assert.match(g.note,/MemStem/);
   assert.equal(await page.$eval('[data-session-results]',e=>e.textContent.trim()),'No conversation titles match. Matches inside conversations are below.');
   assert.deepEqual(g.rows,[{who:'Claude:',marks:['Incoming','stock']},{who:'Related:',marks:[]}]);
   await scan('convo-search-mobile');await page.screenshot({path:path.join(out,'convo-search-mobile.png')});
   await clickControl(page,`.convo-item [data-convo-id="${rows[3].id}"]`);
   await page.waitForFunction(id=>chatId===id&&!document.querySelector('#findbar').hidden&&document.querySelector('#fq').value,{},rows[3].id);
   const find=await page.evaluate(()=>({q:document.querySelector('#fq').value,marks:fmarks.length}));
   assert.ok(find.marks>0,'Find lands on the match: '+JSON.stringify(find));assert.match(find.q,/incoming stock|incoming|stock/i);
   assert.equal(await page.$('#away-divider'),null,'a search result opens at the match, not at New since');
   await page.keyboard.press('Escape');
   // A failure says so and offers a retry; clearing the box removes the section.
   setMode({searchFail:true});
   await page.goto(base+'/#/');await page.waitForSelector('[data-session-search]');
   await page.type('[data-session-search]','recorder');await page.waitForSelector('[data-convo-retry]');
   setMode({searchFail:false});await clickControl(page,'[data-convo-retry]');await page.waitForSelector('.convo-group .convo-item');
   await page.$eval('[data-session-search]',e=>{e.value='';e.dispatchEvent(new Event('input'));});
   assert.equal(await page.$('.convo-group'),null);
   await page.evaluate(()=>{sessionQuery='';});
  });
  await check('1.23 Saved prompts: save what is on screen, start from a chip or Recent, manage, delete',async()=>{
   await page.setViewport({width:390,height:844});
   await page.evaluate(()=>{clearDraft(NEW_KEY);localStorage.removeItem('pc-lastproj');localStorage.setItem('pc-provider','claude');localStorage.removeItem('pc-recent-open');});
   await page.goto(base+'/#/new');await page.waitForSelector('#plist .row.sel');await page.waitForSelector('#starters .recent-starts');
   assert.equal(await page.$('.starter-chips'),null,'no saved prompts yet');
   assert.equal(await page.$eval('#save-prompt',e=>e.disabled),true,'nothing to save until there is a task');
   // Save as prompt from what is on screen (warehouse workspace, Claude, Full access).
   await page.$eval('#first',e=>{e.value='';});await page.type('#first','Check stock levels and draft the reorder list');
   await page.evaluate(()=>{tb.prefs.approvalMode='full';});
   assert.equal(await page.$eval('#save-prompt',e=>e.disabled),false);
   await clickControl(page,'#save-prompt');await page.waitForSelector('#pr-name');
   assert.equal(await page.$eval('#pr-name',e=>e.value),'Check stock levels and draft the');
   assert.match(await page.$eval('.prompt-summary',e=>e.textContent),/^warehouse · Claude Code/);
   await scan('save-prompt-sheet-mobile');
   await page.$eval('#pr-name',e=>{e.value='';});await page.type('#pr-name','Stock check');await clickControl(page,'#pr-save');
   await page.waitForSelector('.starter[aria-pressed="true"]');
   const saved=getMode().prompts.prompts[0];
   assert.deepEqual([saved.name,saved.text,saved.cwd,saved.provider],['Stock check','Check stock levels and draft the reorder list','/workspaces/warehouse','claude']);
   // Change everything, then the chip puts it back.
   await clickControl(page,'#apick [data-a="codex"]');await page.$eval('#first',e=>{e.value='Something else';e.dispatchEvent(new Event('input'));});
   assert.equal(await page.$eval('.starter',e=>e.getAttribute('aria-pressed')),'false','editing the text lets go of the chip');
   await clickControl(page,'.starter');
   const form=await page.evaluate(()=>({text:document.getElementById('first').value,agent:document.querySelector('#apick .row.sel')?.dataset.a,ws:document.querySelector('#plist .row.sel')?.dataset.p,ctx:document.getElementById('task-context').textContent}));
   assert.deepEqual(form,{text:'Check stock levels and draft the reorder list',agent:'claude',ws:'/workspaces/warehouse',ctx:'Workspace warehouseAgent Claude Code · Test agent · default reasoningPermissions Full access'});
   await scan('saved-prompts-mobile');await page.screenshot({path:path.join(out,'saved-prompts-mobile.png')});
   // Recent fills from a start made on another device (Codex, products).
   await clickControl(page,'#starters .recent-starts > summary');await clickControl(page,'[data-recent="0"]');
   assert.deepEqual(await page.evaluate(()=>[document.getElementById('first').value,document.querySelector('#apick .row.sel')?.dataset.a,document.querySelector('#plist .row.sel')?.dataset.p]),
     ['Check incoming quantities before ordering','codex','/workspaces/products']);
   // Manage: a second prompt, reorder, rename through Edit, delete with a second tap.
   await clickControl(page,'#save-prompt');await page.waitForSelector('#pr-name');await page.$eval('#pr-name',e=>{e.value='';});await page.type('#pr-name','Incoming check');await clickControl(page,'#pr-save');
   await page.waitForFunction(()=>document.querySelectorAll('.starter').length===2);
   await clickControl(page,'#manage-prompts');await page.waitForSelector('.prompt-row');
   await scan('manage-prompts-mobile');await page.screenshot({path:path.join(out,'manage-prompts-mobile.png')});
   const second=getMode().prompts.prompts[1].id;
   await clickControl(page,`[data-up="${second}"]`);await page.waitForFunction(()=>document.querySelector('.prompt-row-name').textContent==='Incoming check');
   assert.deepEqual(await page.$$eval('.starter',e=>e.map(x=>x.textContent)),['Incoming check','Stock check'],'the chips follow the order');
   await clickControl(page,`[data-del="${second}"]`);assert.equal(await page.$eval(`[data-del="${second}"]`,e=>e.textContent),'Delete for good');
   assert.equal(getMode().prompts.prompts.length,2,'one tap does not delete');
   await clickControl(page,`[data-del="${second}"]`);await page.waitForFunction(()=>document.querySelectorAll('.prompt-row').length===1);
   const first=getMode().prompts.prompts[0].id;await clickControl(page,`[data-edit="${first}"]`);await page.waitForSelector('#pr-name');
   await page.$eval('#pr-name',e=>{e.value='';});await page.type('#pr-name','Morning stock check');await clickControl(page,'#pr-save');
   await page.waitForFunction(()=>document.querySelector('.starter')?.textContent==='Morning stock check');
   assert.equal(getMode().prompts.prompts[0].text,'Check stock levels and draft the reorder list','renaming keeps the wording');
   await page.$eval('#first',e=>{e.value='';e.dispatchEvent(new Event('input'));});await page.evaluate(()=>clearDraft(NEW_KEY));
  });
  await scan('chat-desktop');await page.setViewport({width:390,height:844});await scan('chat-mobile');
  await page.evaluate(()=>settingsSheet());await scan('settings-mobile');
  assert.deepEqual(errors,[]);

  await check('Tasks (1.36): off by default, then the list, done, the sheet and Start, a task from a session with its briefing, the rail, split, settings and the phone',async()=>{
   await page.setViewport({width:1440,height:900});const sleep=ms=>new Promise(r=>setTimeout(r,ms));
   const settings=settingsState();settings.tasks=false;settings.projects=true;settings.documents=true;
   await page.goto(base+'/#/tasks');await page.waitForSelector('#tasks-main');
   await page.waitForFunction(()=>/Tasks is off/.test(document.querySelector('#tasks-main')?.textContent||''));
   assert.equal(await page.$('[data-rail-view="tasks"]'),null,'no Tasks segment while off');
   await openChat(rows[4].id);assert.equal(await page.$eval('#task-open',e=>e.hidden),true,'no Add task chip while off');
   settings.tasks=true;await page.evaluate(()=>fetch('/api/tasks/reset',{method:'POST'}));
   await page.goto(base+'/#/tasks');await page.waitForSelector('.task-item');
   const list=await page.evaluate(()=>({titles:[...document.querySelectorAll('.task-item .title')].map(e=>e.textContent),groups:[...document.querySelectorAll('.project-group h2')].map(h=>h.textContent.replace(/\s+/g,' ').trim()),due:document.querySelector('.task-item.due .due-label')?.textContent,tab:document.querySelector('.open-session.current a')?.textContent,badge:document.querySelector('[data-tasks-badge]')?.textContent,done:document.querySelector('details.project-group')?.open}));
   // 1.50: with Projects on, the open project reminders sit among the dated tasks, soonest first; the Tasks badge counts both.
   assert.deepEqual(list.titles,['Send the aisle 4 recount to purchasing','Recount aisle 4 excluding Friday delivery','Chase the revised camera quote','Chase the revised quote','Read the TVT firmware notes','Book the forklift service'],'due first (task, then reminder), then dated by time, then undated, finished last');
   assert.deepEqual(list.groups,['To do 5 · 2 due','Done 1']);assert.match(list.due,/^Due /);assert.equal(list.tab,'Tasks','the list is a tab like a session');assert.equal(list.badge,'2','due tasks and reminders on the rail switch');assert.equal(list.done,false,'finished tasks start collapsed');
   const rem=await page.evaluate(()=>{const r=document.querySelector('.reminder-item');return {due:r.classList.contains('due'),facts:r.querySelector('.session-status').textContent,href:r.querySelector('a.row').getAttribute('href'),icon:r.querySelector('.task-check').getAttribute('aria-label'),projectsBadge:document.querySelector('[data-projects-badge]')?.hidden,tabMark:document.querySelector('.open-session.current .tab-state')?.getAttribute('aria-label')};});
   assert.equal(rem.due,true);assert.match(rem.facts,/^Due .*Warehouse stock report/);assert.match(rem.href,/^#\/projects\/warehouse-stock-report/);assert.match(rem.icon,/^Reminder options: Recount aisle 4/);
   assert.equal(rem.projectsBadge,true,'the Projects segment stops counting while Tasks is on');assert.equal(rem.tabMark,'2 items are due');
   await scan('tasks-list-desktop');await page.screenshot({path:path.join(out,'tasks-list-desktop.png')});
   // The reminder's hourglass opens its options; its row opens the project card; Scheduled now opens the Tasks list.
   await clickControl(page,'.reminder-item .task-check');await page.waitForSelector('.sheet [data-later]');
   assert.deepEqual(await page.$$eval('.sheet .opt',els=>els.map(e=>Object.keys(e.dataset)[0])),['open','later','dismiss'],'Open project, Remind later, Dismiss');
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.sheet'));
   await clickControl(page,'.reminder-item a.row');await page.waitForSelector('.project-card');assert.match(await page.evaluate(()=>location.hash),/^#\/projects\/warehouse-stock-report/);
   await page.goto(base+'/#/projects');await page.waitForSelector('#pj-track');
   assert.match(await page.$eval('.session-home-head .chip.due',e=>e.textContent),/^Reminders · 1 due$/,'the Projects list counts its own due reminders and points at the one due list');assert.equal(await page.$eval('.session-home-head .chip.due',e=>e.getAttribute('href')),'#/tasks');
   await page.goto(base+'/#/projects/scheduled');await page.waitForSelector('#tasks-main');assert.equal(await page.evaluate(()=>location.hash),'#/tasks','Scheduled opens the Tasks list while Tasks is on');
   await page.waitForSelector('.task-item');
   // Remind later on a dated task: the project reminder's quick picks, the task re-dated.
   const later=await page.evaluate(()=>{const t=tasksSnap.tasks.find(x=>x.text==='Chase the revised camera quote');taskSheet(t.id);return t.dueAt;});
   await page.waitForSelector('.task-sheet [data-later]');await clickControl(page,'.task-sheet [data-later]');await page.waitForSelector('.sheet [data-pick="week"]');
   assert.deepEqual(await page.$$eval('.sheet [data-pick]',els=>els.map(e=>e.dataset.pick)),['tomorrow','three','monday','week']);
   await clickControl(page,'.sheet [data-pick="week"]');await page.waitForFunction(prev=>tasksSnap.tasks.find(x=>x.text==='Chase the revised camera quote').dueAt!==prev,{},later);
   const moved=new Date(await page.evaluate(()=>tasksSnap.tasks.find(x=>x.text==='Chase the revised camera quote').dueAt));assert.equal(moved.getHours(),9,'9 AM in the device zone');assert.ok(moved.getTime()-Date.now()>6*86400000,'a week out');
   // The sheet: facts and the briefing; Start writes the New session draft in the task's workspace.
   await clickControl(page,'.task-item [data-task-open]');await page.waitForSelector('.task-sheet');
   const sheet=await page.evaluate(()=>({text:document.querySelector('.task-sheet .task-text').textContent,summary:document.querySelector('.task-sheet .task-summary')?.textContent,facts:document.querySelector('.task-sheet .task-facts').textContent}));
   assert.equal(sheet.text,'Send the aisle 4 recount to purchasing');assert.match(sheet.summary,/aisle 4 is 14 units short/);assert.match(sheet.facts,/From Warehouse stock report/);
   await scan('task-sheet-desktop');await page.screenshot({path:path.join(out,'task-sheet-desktop.png')});
   await clickControl(page,'.task-sheet [data-start]');await page.waitForSelector('#first');await page.waitForFunction(()=>document.querySelector('#plist .row.sel'));
   const draft=await page.$eval('#first',e=>e.value);
   assert.match(draft,/^Send the aisle 4 recount to purchasing\n\nContext from the earlier conversation:\nRecounting aisle 4/);assert.match(draft,/\(Pocket task [0-9a-f]{12}\. When it is finished, mark it done with pocket-tasks done [0-9a-f]{12}\.\)$/);
   assert.equal(await page.$eval('#plist .row.sel',e=>e.dataset.p),rows[0].cwd,'Start picks the task\'s workspace');
   await page.evaluate(()=>{clearDraft(NEW_KEY);localStorage.removeItem('pc-lastproj');});
   // Done from the list clears the due badge; the task moves under Done.
   await page.goto(base+'/#/tasks');await page.waitForSelector('.task-item');
   await clickControl(page,'.task-item:not(.finished) [data-task-check]');await page.waitForFunction(()=>document.querySelectorAll('.task-item.finished').length===2);
   assert.equal(await page.$eval('[data-tasks-badge]',e=>e.textContent),'1','the due task is done: the due reminder is what remains');
   // From a session: the Add task chip, the editor naming the session, the briefing on by default and kept with the task.
   await openChat(rows[4].id);await page.waitForFunction(()=>document.querySelector('#task-open')?.hidden===false);
   // 1.50: the rail switch shows the due count on every view, here a conversation with the rail on Sessions (reported by Brad).
   await page.waitForFunction(()=>document.querySelector('[data-rail-view="sessions"]')?.getAttribute('aria-pressed')==='true'&&document.querySelector('[data-tasks-badge]')?.textContent==='1');
   assert.equal(await page.$eval('[data-tasks-badge]',e=>e.hidden),false,'the Tasks count shows without opening the Tasks list');
   assert.equal(await page.$eval('#task-open',e=>e.textContent),'Add task');assert.equal(await page.$eval('#task-open',e=>Boolean(e.closest('#tbar'))),true,'Add task is a chip in the message toolbar');
   await clickControl(page,'#task-open');await page.waitForSelector('.task-form');
   assert.equal(await page.$eval('.sheet .sheet-name',e=>e.textContent),rows[4].title);assert.equal(await page.$eval('[data-summarize]',e=>e.getAttribute('aria-pressed')),'true','the briefing is on by default from a session');
   await page.type('.task-form [name=text]','Decide on the camera order');await scan('task-editor-desktop');await page.screenshot({path:path.join(out,'task-editor-desktop.png')});
   await clickControl(page,'.task-form .primary');await page.waitForFunction(()=>!document.querySelector('.task-form'));
   const made=await page.evaluate(()=>tasksSnap.tasks.find(t=>t.text==='Decide on the camera order'));
   assert.equal(made.session,rows[4].id);assert.match(made.summary,/Reviewing the warehouse stock report/);assert.equal(made.dueAt,null);assert.equal(made.directory,rows[4].cwd);
   // Without a helper the task is still added, without context.
   setMode({noSummary:true});await clickControl(page,'#task-open');await page.waitForSelector('.task-form');await page.type('.task-form [name=text]','Order the junction boxes');await clickControl(page,'.task-form .primary');
   await page.waitForFunction(()=>!document.querySelector('.task-form')&&tasksSnap.tasks.some(t=>t.text==='Order the junction boxes'));setMode({noSummary:false});
   assert.equal(await page.evaluate(()=>tasksSnap.tasks.find(t=>t.text==='Order the junction boxes').summary),'');
   // Session options offer it; the rail lists open tasks with Add task and All; Split view offers Tasks.
   await clickControl(page,'#chatmore');await page.waitForSelector('#so-task');await page.keyboard.press('Escape');
   await clickControl(page,'[data-rail-view="tasks"]');await page.waitForSelector('#rail .rail-tasks .task-item');
   assert.deepEqual(await page.$$eval('#rail .rail-project-actions .chip',els=>els.map(e=>e.textContent.trim())),['Add task','All']);
   assert.equal(await page.$eval('#rail-filter-toggle',e=>e.hidden),true,'session filters hide with the task list');
   await (await page.$('aside.rail')).screenshot({path:path.join(out,'rail-tasks.png')});
   await clickControl(page,'[data-rail-view="sessions"]');await page.waitForSelector('#rail .session-panel');
   await clickControl(page,'#splitb');await page.waitForSelector('.sheet [data-v="tasks"]');await page.keyboard.press('Escape');
   // Settings → Projects, files, tasks & vault turns the feature off for the whole install.
   await clickControl(page,'#railsettings');await page.waitForFunction(()=>document.querySelector('#s-tasks')?.disabled===false);
   assert.equal(await page.$eval('#s-tasks',e=>e.getAttribute('aria-pressed')),'true');
   await clickControl(page,'#s-tasks');for(let i=0;i<30&&settings.tasks;i++)await sleep(100);assert.equal(settings.tasks,false,'the server setting changed');
   await page.keyboard.press('Escape');
   // Settings → Notifications & voice (1.50): push by kind (off here, so the kinds wait), the icon count, the day-before notice and the email address.
   settings.tasks=true;await page.goto(base+'/#/tasks');await page.waitForSelector('.task-item');
   await page.evaluate(()=>settingsSheet({category:'notifications'}));await page.waitForFunction(()=>document.querySelector('#s-ahead')?.disabled===false);
   const notify=await page.evaluate(()=>({heading:document.querySelector('.settings-sheet h2').textContent,push:document.querySelector('#s-push > span:last-child').firstChild.textContent,kindsDisabled:[...document.querySelectorAll('.push-kinds .opt')].map(b=>b.disabled),badge:Boolean(document.querySelector('#s-badge')),scopes:[...document.querySelectorAll('[data-settings-panel="notifications"] .settings-scope')].map(e=>e.textContent),ahead:document.querySelector('#s-ahead').getAttribute('aria-pressed'),email:document.querySelector('#s-email').disabled,note:document.querySelector('#s-email-note').textContent}));
   assert.equal(notify.heading,'Notifications & voice');assert.equal(notify.push,'Push to this device');assert.deepEqual(notify.kindsDisabled,[true,true,true,true],'the four kinds wait for a subscription (1.69: Inbox alerts too)');assert.equal(notify.badge,true);
   assert.deepEqual(notify.scopes,['This device','This instance · all devices']);assert.equal(notify.ahead,'false');assert.equal(notify.email,false,'the fixture server has mail set up');assert.match(notify.note,/Enter the address/);
   await clickControl(page,'#s-ahead');for(let i=0;i<30&&settings.remindAhead!==24;i++)await sleep(100);assert.equal(settings.remindAhead,24,'the notice is instance-wide');
   await page.waitForFunction(()=>document.querySelector('#s-ahead')?.getAttribute('aria-pressed')==='true');
   await page.type('#s-email','owner@example.test');await clickControl(page,'#s-email-save');for(let i=0;i<30&&settings.notifyEmail!=='owner@example.test';i++)await sleep(100);assert.equal(settings.notifyEmail,'owner@example.test');
   await page.waitForFunction(()=>document.querySelector('#s-email-test')?.disabled===false);await clickControl(page,'#s-email-test');for(let i=0;i<30&&!(getMode().mailLog||[]).length;i++)await sleep(100);
   assert.equal((getMode().mailLog||[]).length,1,'Send a test asked the server for a message');
   await scan('settings-notifications');await page.screenshot({path:path.join(out,'settings-notifications.png')});
   await page.keyboard.press('Escape');settings.remindAhead=0;settings.notifyEmail='';
   // The phone: a Tasks chip on the session home, the list full-screen.
   await page.setViewport({width:390,height:844});await page.goto(base+'/#/');await page.waitForSelector('[data-tasks-home]');
   await clickControl(page,'[data-tasks-home]');await page.waitForSelector('.task-item');await scan('tasks-list-mobile');await page.screenshot({path:path.join(out,'tasks-list-mobile.png')});
   await page.setViewport({width:1440,height:900});settings.tasks=false;settings.projects=false;settings.documents=false; // as the Projects check expects
  });
  await check('Offered models (1.52): Settings → Agents & instance lists the catalog, a policy-blocked model is marked and cannot be turned on, a change saves and narrows the picker, the last model stays on, the server list comes back, at 1440 and 390',async()=>{
   const settings=settingsState();delete settings.offeredClaudeModels;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
   const rows=()=>page.$$eval('#s-models-list .opt',bs=>bs.map(b=>({id:b.dataset.offerModel,on:b.getAttribute('aria-pressed'),blocked:b.getAttribute('aria-disabled')==='true',sub:b.querySelector('.sub').textContent})));
   const open=async()=>{await page.evaluate(()=>settingsSheet({category:'agents'}));assert.equal(await page.$$eval('#s-models-list .opt',e=>e.length),4,'the rows are drawn before the server answers');await page.waitForFunction(()=>!document.querySelector('#s-models-list').hasAttribute('aria-busy'));};
   for(const width of [1440,390]){
    await page.setViewport({width,height:900});await page.goto(base+'/#/');await page.waitForSelector('.rail,.list,main');
    await open();
    assert.equal(await page.$eval('.settings-sheet h2',e=>e.textContent),'Agents & instance');
    let r=await rows();
    assert.deepEqual(r.map(x=>x.id),['claude-fable-5-1[1m]','claude-opus-5-5[1m]','claude-sonnet-5-5','claude-haiku-5-5'],'1.91: the newest of each family only');
    assert.deepEqual(r.map(x=>[x.on,x.blocked]),[['false',true],['true',false],['true',false],['true',false]]);
    assert.equal(r[0].sub,"Blocked by this computer's Claude Code policy");
    assert.match(await page.$eval('#s-models-note',e=>e.textContent),/The picker offers every model\. .*policy blocks one, so it is never offered/);
    assert.equal(await page.$eval('#s-models-reset',e=>e.hidden),true);
    // The blocked row explains itself and changes nothing.
    await clickControl(page,'[data-offer-model="claude-fable-5-1[1m]"]');
    await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes("Fable 5.1: Blocked by this computer's Claude Code policy"));
    assert.equal(settings.offeredClaudeModels,undefined);
    // Turn Haiku 5.5 off: saved for the instance, the row and note follow, the picker narrows.
    await clickControl(page,'[data-offer-model="claude-haiku-5-5"]');
    for(let i=0;i<30&&!Array.isArray(settings.offeredClaudeModels);i++)await sleep(100);
    assert.deepEqual(settings.offeredClaudeModels,['claude-fable-5-1[1m]','claude-opus-5-5[1m]','claude-sonnet-5-5'],'a blocked model keeps its place in the choice, for when the policy allows it');
    await page.waitForFunction(()=>document.querySelector('[data-offer-model="claude-haiku-5-5"]')?.getAttribute('aria-pressed')==='false');
    assert.match(await page.$eval('#s-models-note',e=>e.textContent),/Chosen here: the picker offers 2 of 4 models\./);
    assert.equal(await page.$eval('#s-models-reset',e=>e.hidden),false);
    await page.waitForFunction(()=>claudeModelsLoaded&&!MODELS.some(m=>m[0]==='claude-haiku-5-5'));
    assert.deepEqual(await page.evaluate(()=>MODELS.map(m=>m[0])),['default','claude-opus-5-5[1m]','claude-sonnet-5-5']);
    await scan('settings-models-'+width);await page.screenshot({path:path.join(out,'settings-models-'+width+'.png')});
    // Use the server's list: every allowed model again.
    await clickControl(page,'#s-models-reset');for(let i=0;i<30&&settings.offeredClaudeModels!==null;i++)await sleep(100);
    assert.equal(settings.offeredClaudeModels,null);
    await page.waitForFunction(()=>document.querySelector('[data-offer-model="claude-haiku-5-5"]')?.getAttribute('aria-pressed')==='true'&&document.querySelector('#s-models-reset').hidden);
    await page.keyboard.press('Escape');
    // The last offered model stays on. (A choice saved as Sonnet 5 shows Sonnet 5.5 on, the newest of its family.)
    settings.offeredClaudeModels=['claude-sonnet-5'];await open();
    r=await rows();assert.deepEqual(r.filter(x=>x.on==='true').map(x=>x.id),['claude-sonnet-5-5']);
    await clickControl(page,'[data-offer-model="claude-sonnet-5-5"]');
    await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Keep at least one model on'));
    assert.deepEqual(settings.offeredClaudeModels,['claude-sonnet-5']);
    await page.keyboard.press('Escape');delete settings.offeredClaudeModels;
   }
   // A picked model the picker no longer offers goes back to Default instead of being sent.
   settings.offeredClaudeModels=['claude-sonnet-5-5'];
   await page.goto(base+'/#/');await page.evaluate(()=>{localStorage.setItem('pc-provider','claude');localStorage.setItem('pc-prefs-'+NEW_KEY,JSON.stringify({model:'claude-opus-5-5[1m]',effort:'default'}));});
   await page.goto(base+'/#/new');await page.reload();await page.waitForSelector('#first'); // a fresh load fetches the narrowed list
   await page.waitForFunction(()=>claudeModelsLoaded&&tb&&tb.prefs.model==='default');
   assert.deepEqual(await page.evaluate(()=>MODELS.map(m=>m[0])),['default','claude-sonnet-5-5']);
   assert.equal(await page.evaluate(()=>turnOpts().model),undefined);
   delete settings.offeredClaudeModels;await page.evaluate(()=>{localStorage.removeItem('pc-prefs-'+NEW_KEY);localStorage.removeItem('pc-provider');claudeModelsLoaded=false;});
   await page.setViewport({width:1440,height:900});
  });
  await check('Trusted actions (1.56): Settings → Agents & instance shows the server default, adds a rule, explains a refused one under the field, removes one with focus kept, and goes back to the server list, at 1440 and 390',async()=>{
   const settings=settingsState();delete settings.trustedActions;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
   const rules=()=>page.$$eval('#s-trusted-list .trusted-row code',e=>e.map(x=>x.textContent));
   for(const width of [1440,390]){
    await page.setViewport({width,height:900});await page.goto(base+'/#/');await page.waitForSelector('.rail,.list,main');
    await page.evaluate(()=>settingsSheet({category:'agents'}));await page.waitForFunction(()=>!document.querySelector('#s-trusted-list').hasAttribute('aria-busy'));
    // The server default, said so, with the rule it skipped.
    assert.deepEqual(await rules(),['Bash(techpro-lookup:*)']);
    assert.match(await page.$eval('#s-trusted-note',e=>e.textContent),/^From POCKET_TRUSTED_ACTIONS on this server: one action run without asking\. A change here replaces it\. The server's list skips one rule it cannot use: Edit\.$/);
    assert.equal(await page.$eval('#s-trusted-reset',e=>e.hidden),true);
    assert.equal(await page.$eval('#s-trusted-add',e=>e.disabled),true,'nothing to add yet');
    // A write is refused, the reason sits under the field, tied to it, and the text stays for fixing.
    await page.type('#s-trusted-input','Write(/etc/hosts)');await clickControl(page,'#s-trusted-add');
    await page.waitForFunction(()=>document.querySelector('#s-trusted-error').textContent.length>0);
    const refused=await page.evaluate(()=>{const i=document.querySelector('#s-trusted-input');return {error:document.querySelector('#s-trusted-error').textContent,invalid:i.getAttribute('aria-invalid'),value:i.value,described:i.getAttribute('aria-describedby'),focused:document.activeElement===i};});
    assert.deepEqual(refused,{error:'Write changes files, so it always asks.',invalid:'true',value:'Write(/etc/hosts)',described:'s-trusted-error s-trusted-hint',focused:true});
    assert.equal(settings.trustedActions,undefined,'nothing was saved');
    await scan('settings-trusted-error-'+width);
    // Typing clears the error; a good rule is saved for the instance, normalised, and the field empties.
    await page.evaluate(()=>{const i=document.querySelector('#s-trusted-input');i.value='';});await page.type('#s-trusted-input','Bash(sck-site product :*)');
    assert.equal(await page.$eval('#s-trusted-error',e=>e.textContent),'');
    await page.keyboard.press('Enter');for(let i=0;i<30&&!Array.isArray(settings.trustedActions);i++)await sleep(100);
    assert.deepEqual(settings.trustedActions,['Bash(techpro-lookup:*)','Bash(sck-site product:*)']);
    await page.waitForFunction(()=>document.querySelectorAll('#s-trusted-list .trusted-row').length===2&&document.querySelector('#s-trusted-input').value==='');
    assert.match(await page.$eval('#s-trusted-note',e=>e.textContent),/^Chosen here: 2 actions run without asking\. This replaces the server's list\.$/);
    assert.equal(await page.$eval('#s-trusted-reset',e=>e.hidden),false);
    const overflow=await page.evaluate(()=>{const s=document.querySelector('.settings-sheet');return s.scrollWidth-s.clientWidth;});assert.ok(overflow<=1,'no horizontal overflow at '+width);
    await scan('settings-trusted-'+width);await page.screenshot({path:path.join(out,'settings-trusted-'+width+'.png')});
    // Remove the first: saved, and focus goes to the row that took its place.
    assert.equal(await page.$eval('[data-trusted-remove="0"]',e=>e.getAttribute('aria-label')),'Remove Bash(techpro-lookup:*)');
    await clickControl(page,'[data-trusted-remove="0"]');for(let i=0;i<30&&settings.trustedActions.length!==1;i++)await sleep(100);
    assert.deepEqual(settings.trustedActions,['Bash(sck-site product:*)']);
    await page.waitForFunction(()=>document.activeElement?.dataset?.trustedRemove==='0'&&document.activeElement.getAttribute('aria-label')==='Remove Bash(sck-site product:*)');
    // Remove the last: the list says every action asks; focus falls back to the field.
    await clickControl(page,'[data-trusted-remove="0"]');for(let i=0;i<30&&settings.trustedActions.length;i++)await sleep(100);
    await page.waitForFunction(()=>/Every action shows the approval card/.test(document.querySelector('#s-trusted-list').textContent)&&document.activeElement?.id==='s-trusted-input');
    assert.match(await page.$eval('#s-trusted-note',e=>e.textContent),/^Chosen here: every action asks\./);
    // Use the server's list.
    await clickControl(page,'#s-trusted-reset');for(let i=0;i<30&&settings.trustedActions!==null;i++)await sleep(100);
    assert.equal(settings.trustedActions,null);
    await page.waitForFunction(()=>document.querySelector('#s-trusted-reset').hidden&&document.querySelectorAll('#s-trusted-list .trusted-row').length===1);
    await page.keyboard.press('Escape');delete settings.trustedActions;
   }
   await page.setViewport({width:1440,height:900});
  });
  await check('Vault (1.39): Settings turns it on, the rail and list, Always allow, Show and the sheet, the editor and a stale save, Remove and Restore, Store in the Vault from the composer, and the phone',async()=>{
   await page.setViewport({width:1440,height:900});const sleep=ms=>new Promise(r=>setTimeout(r,ms));const SECRET='zk-fixture-secret-7731';
   const settings=settingsState();settings.vault=false;settings.vaultReady=true;
   await page.goto(base+'/#/vault');await page.waitForFunction(()=>/The Vault is off/.test(document.querySelector('#vault-main')?.textContent||''));
   assert.equal(await page.$('[data-rail-view="vault"]'),null,'no Vault segment while off');
   // Settings → Projects, files, tasks & vault turns it on for the install.
   await clickControl(page,'#railsettings');await page.waitForFunction(()=>document.querySelector('#s-vault')?.disabled===false);
   assert.equal(await page.$eval('#s-vault',e=>e.getAttribute('aria-pressed')),'false');
   await clickControl(page,'#s-vault');for(let i=0;i<30&&!settings.vault;i++)await sleep(100);assert.equal(settings.vault,true,'the server setting changed');
   await page.keyboard.press('Escape'); // turning a library on re-renders the view, which closes Settings
   await page.evaluate(()=>fetch('/api/vault/reset',{method:'POST'}));
   // The list: the waiting request above the secrets, a badge on the rail switch, the login's expiry in amber.
   await page.goto(base+'/#/vault');await page.reload();await page.waitForSelector('.vault-item');
   const list=await page.evaluate(()=>({names:[...document.querySelectorAll('#vault-main .vault-item [data-vault-open] .title')].map(e=>e.textContent),requests:[...document.querySelectorAll('#vault-main .vault-request h3 .vault-name')].map(e=>e.textContent),badge:document.querySelector('[data-vault-badge]')?.textContent,rail:Boolean(document.querySelector('[data-rail-view="vault"]')),due:document.querySelector('.vault-item.due .due-label')?.textContent,tab:document.querySelector('.open-session.current a')?.textContent}));
   assert.deepEqual(list.names,['square-hooks','acme-oauth','bank-recovery','vendor-portal','zoho-books'],'newest first by default');assert.deepEqual(list.requests,['zoho-books']);assert.equal(list.badge,'1');assert.equal(list.rail,true,'the rail switch shows Vault');assert.match(list.due,/^Expires /);assert.equal(list.tab,'Vault');
   await scan('vault-list-desktop');await page.screenshot({path:path.join(out,'vault-list-desktop.png')});
   // 1.93 (Damon): the request is one plain sentence; Allow is the brand orange beside a matching Deny.
   const ask=await page.evaluate(()=>{const c=document.querySelector('#vault-main .vault-request'),a=c.querySelector('.vault-allow'),p=document.createElement('i');p.style.color='var(--clay)';document.body.append(p);const clay=getComputedStyle(p).color;p.remove();
    return {text:c.querySelector('h3').textContent.replace(/\s+/g,' ').trim(),allow:a?.dataset.answer,allowText:a?.textContent,deny:c.querySelector('.vault-deny')?.dataset.answer,bg:getComputedStyle(a).backgroundColor,clay,h:a.getBoundingClientRect().height};});
   assert.equal(ask.text,'The agent in “Warehouse stock report” wants to use zoho-books for this command');
   assert.equal(ask.allow,'once');assert.equal(ask.allowText,'Allow once');assert.equal(ask.deny,'deny');assert.equal(ask.bg,ask.clay,'Allow is the brand orange');assert.ok(ask.h>=44,'Allow is a full-size button');
   // Order: A–Z on request, remembered on the device; the search narrows the list by name, kind or tag.
   const shownNames=()=>page.$$eval('#vault-main .vault-secrets .vault-item:not([hidden]) [data-vault-open] .title',e=>e.map(x=>x.textContent));
   await page.select('#vault-order','name');await page.waitForFunction(()=>document.querySelector('#vault-main .vault-secrets .vault-item .title')?.textContent==='acme-oauth');
   assert.deepEqual(await shownNames(),['acme-oauth','bank-recovery','square-hooks','vendor-portal','zoho-books']);assert.equal(await page.evaluate(()=>localStorage.getItem('pc-vault-order')),'name');
   await page.select('#vault-order','new');await page.waitForFunction(()=>document.querySelector('#vault-main .vault-secrets .vault-item .title')?.textContent==='square-hooks');
   const query=async q=>{await page.$eval('#vault-query',(e,q)=>{e.value=q;e.dispatchEvent(new Event('input',{bubbles:true}));},q);};
   await query('billing');assert.deepEqual(await shownNames(),['zoho-books'],'a tag matches');assert.equal(await page.$eval('[data-vault-count]',e=>e.textContent),'1 of 5');
   await query('login vendor');assert.deepEqual(await shownNames(),['vendor-portal'],'every word must match');
   await query('nothing-like-this');assert.deepEqual(await shownNames(),[]);assert.equal(await page.$eval('[data-vault-none]',e=>e.hidden?'':e.textContent),'No secrets match “nothing-like-this”.');
   await query('');assert.equal((await shownNames()).length,5);
   // The notification body opens that request; an Allow from the notification that failed says so on the card.
   const rid=await page.evaluate(()=>vaultSnap.requests[0].id);
   await page.goto(base+'/#/vault/request/'+rid+'?missed=signin&tap=allow');await page.waitForSelector('#vault-main .vault-request-missed');
   assert.equal(await page.evaluate(()=>location.hash),'#/vault','the deep link settles on the Vault');
   assert.match(await page.$eval('#vault-main .vault-request-missed',e=>e.textContent),/Your Allow from the notification didn’t go through: this device was signed out of Pocket\./);
   assert.equal(await page.evaluate(()=>document.activeElement?.closest('.vault-request')!==null),true,'the request has focus');
   // A link to one secret opens its sheet and marks its row.
   await page.goto(base+'/#/vault/item/vendor-portal');await page.waitForSelector('.vault-sheet');
   assert.equal(await page.evaluate(()=>document.querySelector('.vault-item.vault-flash [data-vault-open] .title')?.textContent),'vendor-portal');
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.vault-sheet'));
   // Always allow answers the request and saves the command on the item.
   await clickControl(page,'#vault-main .vault-request [data-answer="always"]');await page.waitForFunction(()=>!document.querySelector('#vault-main .vault-request'));
   await page.waitForFunction(()=>vaultSnap.items.find(i=>i.name==='zoho-books')?.recipes.length===2);
   assert.equal(await page.$eval('[data-vault-badge]',e=>e.hidden),true,'no request, no badge');
   // 1.93: the notification for an answered request opens on what happened to it.
   await page.goto(base+'/#/vault/request/'+rid);await page.waitForSelector('#vault-main .vault-notice');
   assert.match(await page.$eval('#vault-main .vault-notice',e=>e.textContent),/^You already allowed zoho-books /);
   // The sheet: a value only on Show, gone from the page once it closes, never in storage.
   const id=name=>page.evaluate(n=>(vaultSnap.items.find(i=>i.name===n)||vaultSnap.trash.find(i=>i.name===n)).id,name);
   const zoho=await id('zoho-books');await clickControl(page,`[data-vault-open="${zoho}"]`);await page.waitForSelector('.vault-sheet [data-history] ul');
   assert.equal((await page.content()).includes(SECRET),false,'no value before Show');assert.equal(await page.$$eval('.vault-sheet [data-recipe]',e=>e.length),2);
   await clickControl(page,'.vault-sheet [data-field="value"] [data-show]');await page.waitForFunction(s=>document.querySelector('.vault-value.shown')?.textContent===s,{},SECRET);
   await scan('vault-sheet-desktop');await page.screenshot({path:path.join(out,'vault-sheet-desktop.png')});
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.vault-sheet'));
   assert.equal(await page.evaluate(s=>document.documentElement.outerHTML.includes(s)||JSON.stringify(localStorage).includes(s),SECRET),false,'the value left with the sheet');
   // The editor adds an item; its value goes to the server and nowhere else.
   await clickControl(page,'#vt-add');await page.waitForSelector('.vault-editor form');
   await page.type('.vault-editor [name=name]','stripe-live');await page.type('.vault-editor [data-secret=value]','sk-fixture-stripe');
   await scan('vault-editor-desktop');await clickControl(page,'.vault-editor .primary');
   await page.waitForFunction(()=>!document.querySelector('.vault-editor')&&vaultSnap.items.some(i=>i.name==='stripe-live'));
   assert.equal(await page.evaluate(()=>document.documentElement.outerHTML.includes('sk-fixture-stripe')||JSON.stringify(localStorage).includes('sk-fixture-stripe')),false);
   // A save against a stale revision is refused and the form stays open with the reason.
   await clickControl(page,`[data-vault-open="${zoho}"]`);await page.waitForSelector('.vault-sheet [data-edit]');await clickControl(page,'.vault-sheet [data-edit]');await page.waitForSelector('.vault-editor form');
   await page.evaluate(id=>{const i=vaultSnap.items.find(x=>x.id===id);return fetch('/api/vault/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'update',item:id,expected_revision:i.revision,tags:['elsewhere']})});},zoho);
   await clickControl(page,'.vault-editor .primary');await page.waitForFunction(()=>/changed on another device/.test(document.querySelector('.vault-form-error')?.textContent||''));
   assert.ok(await page.$('.vault-editor form'),'the form stays open');await page.keyboard.press('Escape');
   // Remove sends it to Removed; Restore brings it back.
   const stripe=await id('stripe-live');await clickControl(page,`[data-vault-open="${stripe}"]`);await page.waitForSelector('.vault-sheet [data-remove]');
   await clickControl(page,'.vault-sheet [data-remove]');await page.waitForSelector('.sheet [data-yes]');await clickControl(page,'.sheet [data-yes]');
   await page.waitForFunction(()=>vaultSnap.trash.some(i=>i.name==='stripe-live'));
   await page.$eval('#vault-main details',d=>{d.open=true;});await clickControl(page,`[data-vault-restore="${stripe}"]`);await page.waitForFunction(()=>vaultSnap.items.some(i=>i.name==='stripe-live'));
   // The composer: Attach offers Store in the Vault; saving puts the name at the cursor, not the value.
   await page.goto(base+'/#/new');await page.waitForSelector('#first');await page.$eval('#first',b=>{b.value='Use for the sync';b.focus();b.setSelectionRange(4,4);});
   await clickControl(page,'#c-att');await page.waitForSelector('.sheet [data-v="vault"]');await clickControl(page,'.sheet [data-v="vault"]');await page.waitForSelector('.vault-editor form');
   await page.type('.vault-editor [name=name]','openai-key');await page.type('.vault-editor [data-secret=value]','sk-fixture-openai');await clickControl(page,'.vault-editor .primary');
   await page.waitForFunction(()=>!document.querySelector('.vault-editor'));
   assert.equal(await page.$eval('#first',b=>b.value),'Use {{vault:openai-key}} for the sync');
   assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('sk-fixture-openai')),false,'the value is not in the draft');
   await page.evaluate(()=>clearDraft(NEW_KEY));
   // The phone: a Vault chip on the session home, the list full-screen without sideways scrolling.
   await page.setViewport({width:390,height:844});await page.goto(base+'/#/');await page.waitForSelector('[data-vault-home]');
   await clickControl(page,'[data-vault-home]');await page.waitForSelector('.vault-item');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at 390');
   await scan('vault-list-mobile');await page.screenshot({path:path.join(out,'vault-list-mobile.png')});
   // 1.93 (Damon): a secret an agent stores from a conversation is marked New, and the conversation gets a card that opens it.
   await page.setViewport({width:1440,height:900});
   await page.evaluate(s=>fetch('/api/vault/agent-add',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'staging-wp',kind:'login',values:{username:'ops',password:'wp-fixture-pass-5512'},...s})}),{session:rows[0].id,sessionTitle:rows[0].title});
   await page.goto(base+'/#/chat/'+rows[0].id);await page.waitForSelector('.file-card[data-card-vault]');
   const card=await page.$eval('.file-card[data-card-vault]',e=>({name:e.querySelector('.file-card-name').textContent,href:e.querySelector('a').getAttribute('href'),html:e.outerHTML}));
   assert.equal(card.name,'staging-wp');assert.equal(new URL(card.href,base).hash,'#/vault/item/staging-wp');assert.equal(card.html.includes('wp-fixture-pass-5512'),false,'no value on the card');
   await clickControl(page,'.file-card[data-card-vault] a');await page.waitForSelector('.vault-sheet');
   assert.equal(await page.$eval('.vault-sheet h2',e=>e.textContent.length>0),true);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.vault-sheet'));
   const fresh=await page.evaluate(()=>{const r=[...document.querySelectorAll('#vault-main .vault-secrets .vault-item')][0];return {name:r?.querySelector('[data-vault-open] .title')?.textContent,mark:r?.querySelector('.vault-new')?.textContent,facts:r?.textContent.replace(/\s+/g,' ')};});
   assert.equal(fresh.name,'staging-wp','the newest is on top');assert.equal(fresh.mark,'New');assert.match(fresh.facts,/Added .* in Warehouse stock report/);
   await page.setViewport({width:1440,height:900});settings.vault=false;
  });
  await check('Vault custom fields (1.39.1): Credentials and custom fields in the sheet, the editor adds them, an edit removes one, a bad name is refused inline',async()=>{
   await page.setViewport({width:1440,height:900});const settings=settingsState();settings.vault=true;settings.vaultReady=true;
   await page.evaluate(()=>fetch('/api/vault/reset',{method:'POST'}));
   const acts=[];const onReq=r=>{if(r.url().endsWith('/api/vault/act')&&r.method()==='POST')acts.push(JSON.parse(r.postData()||'{}'));};page.on('request',onReq);
   try{
    await page.goto(base+'/#/vault');await page.reload();await page.waitForSelector('.vault-item');
    const id=name=>page.evaluate(n=>(vaultSnap.items.find(i=>i.name===n)||vaultSnap.trash.find(i=>i.name===n)).id,name);
    // The sheet lists every field, fixed first then custom; each is masked until Show, and the agent hint names item.field.
    const acme=await id('acme-oauth');
    assert.equal(await page.$eval(`.vault-item[data-item="${acme}"] .vault-kind`,e=>e.innerHTML),await page.$eval(`.vault-item[data-item="${await id('zoho-books')}"] .vault-kind`,e=>e.innerHTML),'Credentials use the key icon');
    await clickControl(page,`[data-vault-open="${acme}"]`);await page.waitForSelector('.vault-sheet [data-history] ul');
    const sheetA=await page.evaluate(()=>({kind:document.querySelector('.vault-sheet h2').textContent,labels:[...document.querySelectorAll('.vault-sheet .vault-field-label')].map(e=>e.textContent),use:[...document.querySelectorAll('.vault-sheet .vault-use code')].map(e=>e.textContent)}));
    assert.deepEqual(sheetA,{kind:'Credentials',labels:['client_id','client_secret'],use:['acme-oauth.client_id','acme-oauth.client_secret']});
    assert.equal((await page.content()).includes('acme-secret-fixture-4410'),false,'no value before Show');
    await clickControl(page,'.vault-sheet [data-field="client_secret"] [data-show]');
    await page.waitForFunction(()=>document.querySelector('.vault-sheet [data-field="client_secret"] .vault-value.shown')?.textContent==='acme-secret-fixture-4410');
    assert.equal(await page.$eval('.vault-sheet [data-field="client_secret"] [data-copy-value]',b=>b.hidden),false,'Copy appears with the value');
    await scan('vault-sheet-custom');await page.screenshot({path:path.join(out,'vault-sheet-custom.png')});
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.vault-sheet'));
    assert.equal(await page.evaluate(()=>document.documentElement.outerHTML.includes('acme-secret-fixture-4410')),false,'the value left with the sheet');
    const sq=await id('square-hooks');await clickControl(page,`[data-vault-open="${sq}"]`);await page.waitForSelector('.vault-sheet .vault-field');
    assert.deepEqual(await page.$$eval('.vault-sheet .vault-field-label',e=>e.map(x=>x.textContent)),['Key','signature_key'],'an API key with a custom field');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.vault-sheet'));
    // The editor: a custom row typed under API key survives the switch to Credentials, which has no fixed fields.
    await clickControl(page,'#vt-add');await page.waitForSelector('.vault-editor form');
    await page.type('.vault-editor [name=name]','stripe-connect');
    await clickControl(page,'.vault-editor [data-add-field]');await page.waitForSelector('.vault-editor [data-new-field]');
    await page.type('.vault-editor [data-new-field]:nth-child(1) [data-custom-name]','Client ID');
    await page.type('.vault-editor [data-new-field]:nth-child(1) [data-custom-value]','sc-client-fixture');
    await page.select('.vault-editor [name=kind]','credentials');
    const switched=await page.evaluate(()=>({fixed:document.querySelectorAll('.vault-editor [data-secret]').length,rows:[...document.querySelectorAll('.vault-editor [data-new-field] [data-custom-name]')].map(e=>e.value),head:document.querySelector('#vault-custom-h').textContent,sub:document.querySelector('[data-kind-sub]').textContent}));
    assert.deepEqual(switched,{fixed:0,rows:['client_id'],head:'Fields',sub:'Any set of named fields, such as a client ID and secret'},'the typed row stays and the name is normalised');
    await clickControl(page,'.vault-editor [data-add-field]');await page.type('.vault-editor [data-new-field]:nth-child(2) [data-custom-name]','client_secret');
    await page.type('.vault-editor [data-new-field]:nth-child(2) [data-custom-value]','sc-secret-fixture-3390');
    // A bad name and a duplicate are refused beside the row, before anything is sent.
    await clickControl(page,'.vault-editor [data-add-field]');await page.type('.vault-editor [data-new-field]:nth-child(3) [data-custom-name]','2fa');await page.type('.vault-editor [data-new-field]:nth-child(3) [data-custom-value]','x');
    const sent=acts.length;await clickControl(page,'.vault-editor .primary');
    await page.waitForFunction(()=>/Start with a letter/.test(document.querySelector('.vault-editor [data-new-field]:nth-child(3) .vault-field-error')?.textContent||''));
    assert.equal(await page.evaluate(()=>{const n=document.querySelector('.vault-editor [data-new-field]:nth-child(3) [data-custom-name]');return n===document.activeElement&&n.getAttribute('aria-invalid');}),'true','the bad name is marked and focused');
    await scan('vault-editor-custom');await page.screenshot({path:path.join(out,'vault-editor-custom.png')});
    await page.$eval('.vault-editor [data-new-field]:nth-child(3) [data-custom-name]',e=>{e.value='';});await page.type('.vault-editor [data-new-field]:nth-child(3) [data-custom-name]','client_id');
    await clickControl(page,'.vault-editor .primary');
    await page.waitForFunction(()=>/Two fields are named client_id/.test(document.querySelector('.vault-editor [data-new-field]:nth-child(3) .vault-field-error')?.textContent||''));
    assert.equal(acts.length,sent,'nothing was sent');
    await clickControl(page,'.vault-editor [data-new-field]:nth-child(3) [data-drop-field]');
    assert.equal(await page.$$eval('.vault-editor [data-new-field]',e=>e.length),2);
    await clickControl(page,'.vault-editor .primary');
    await page.waitForFunction(()=>!document.querySelector('.vault-editor')&&vaultSnap.items.some(i=>i.name==='stripe-connect'));
    assert.deepEqual(acts.at(-1).values,{client_id:'sc-client-fixture',client_secret:'sc-secret-fixture-3390'});assert.equal(acts.at(-1).kind,'credentials');
    const made=await page.evaluate(()=>vaultSnap.items.find(i=>i.name==='stripe-connect'));
    assert.deepEqual({kind:made.kind,fields:made.fields,custom:made.custom},{kind:'credentials',fields:['client_id','client_secret'],custom:['client_id','client_secret']});
    assert.equal(await page.evaluate(()=>document.documentElement.outerHTML.includes('sc-secret-fixture-3390')||JSON.stringify(localStorage).includes('sc-secret-fixture-3390')),false,'the value went to the server only');
    // An edit removes one custom field: Remove marks it, Save sends removeFields and no values.
    await clickControl(page,`[data-vault-open="${made.id}"]`);await page.waitForSelector('.vault-sheet [data-edit]');await clickControl(page,'.vault-sheet [data-edit]');await page.waitForSelector('.vault-editor form');
    assert.deepEqual(await page.$$eval('.vault-editor [data-custom] .vault-custom-name',e=>e.map(x=>x.textContent)),['client_id','client_secret']);
    await clickControl(page,'.vault-editor [data-custom="client_secret"] [data-remove-field]');
    assert.equal(await page.$eval('.vault-editor [data-custom="client_secret"] [data-remove-field]',b=>b.getAttribute('aria-pressed')+' '+b.textContent),'true Undo');
    await page.setViewport({width:390,height:844});await pause(150);
    assert.equal(await page.evaluate(()=>{const s=document.querySelector('.vault-editor');return s.scrollWidth>s.clientWidth+1||document.documentElement.scrollWidth>innerWidth;}),false,'the editor fits at 390');
    await scan('vault-editor-custom-mobile');await page.screenshot({path:path.join(out,'vault-editor-custom-mobile.png')});
    await page.setViewport({width:1440,height:900});
    await clickControl(page,'.vault-editor .primary');
    await page.waitForFunction(()=>!document.querySelector('.vault-editor')&&vaultSnap.items.find(i=>i.name==='stripe-connect')?.custom?.length===1);
    const upd=acts.at(-1);assert.equal(upd.action,'update');assert.deepEqual(upd.removeFields,['client_secret']);assert.equal(upd.values,undefined,'blank values are left unchanged');
    assert.deepEqual(await page.evaluate(()=>vaultSnap.items.find(i=>i.name==='stripe-connect').fields),['client_id']);
   }finally{page.off('request',onReq);settings.vault=false;}
  });
  await check('Vault in-place edit (1.44.2): Show reveals every field of a multi-field API key with its line break, and Edit loads a saved value to correct it, at 390 and 1440',async()=>{
   const settings=settingsState();settings.vault=true;settings.vaultReady=true;
   const PASTED='sinch-secret-fixture-30-chars\nAuthorization: Basic c2luY2gtZml4dHVyZQ==',CLEAN='sinch-secret-fixture-30-chars';
   const acts=[],views=[];const onReq=r=>{const u=new URL(r.url()).pathname;if(r.method()!=='POST')return;if(u==='/api/vault/act')acts.push(JSON.parse(r.postData()||'{}'));if(u==='/api/vault/field')views.push(JSON.parse(r.postData()||'{}').field);};page.on('request',onReq);
   const leaked=()=>page.evaluate(vs=>vs.filter(v=>document.documentElement.outerHTML.includes(v)||JSON.stringify(localStorage).includes(v)||JSON.stringify(sessionStorage).includes(v)),['sinch-secret-fixture','c2luY2gtZml4dHVyZQ','sinch-key-fixture']);
   try{
    for(const [w,h] of [[390,844],[1440,900]]){
     await page.setViewport({width:w,height:h});
     await page.evaluate(()=>fetch('/api/vault/reset',{method:'POST'}));
     await page.goto(base+'/#/vault');await page.reload();await page.waitForSelector('#vault-main .vault-item');
     const id=await page.evaluate(v=>fetch('/api/vault/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'add',name:'sinch-engage',kind:'api_key',values:{value:'sinch-key-fixture-2026',base_url:'https://au.app.api.sinch.com',api_secret:v}})}).then(r=>r.json()).then(j=>j.item.id),PASTED);
     await page.evaluate(()=>loadVault(true).then(repaintVault));await page.waitForSelector(`[data-vault-open="${id}"]`);
     // The sheet: Show on each field shows that field, and a pasted line break shows as one.
     await clickControl(page,`[data-vault-open="${id}"]`);await page.waitForSelector('.vault-sheet [data-history] ul');
     assert.deepEqual(await page.$$eval('.vault-sheet .vault-field-label',e=>e.map(x=>x.textContent)),['Key','base_url','api_secret']);
     for(const f of ['value','base_url','api_secret'])await clickControl(page,`.vault-sheet [data-field="${f}"] [data-show]`);
     await page.waitForFunction(()=>document.querySelectorAll('.vault-sheet .vault-value.shown').length===3);
     const shown=await page.evaluate(()=>[...document.querySelectorAll('.vault-sheet .vault-field')].map(r=>{const v=r.querySelector('.vault-value');const b=v.getBoundingClientRect();return {f:r.dataset.field,text:v.textContent,ws:getComputedStyle(v).whiteSpace,h:b.height,w:b.width};}));
     assert.deepEqual(shown.map(x=>x.text),['sinch-key-fixture-2026','https://au.app.api.sinch.com',PASTED]);
     assert.equal(shown[2].ws,'pre-wrap');assert.ok(shown.every(x=>x.w>100&&x.h>10),'every value is visible: '+JSON.stringify(shown));
     assert.equal(await page.evaluate(()=>{const s=document.querySelector('.vault-sheet');return s.scrollWidth>s.clientWidth+1||document.documentElement.scrollWidth>innerWidth;}),false,'the sheet fits at '+w);
     await scan('vault-sheet-shown-'+w);await page.screenshot({path:path.join(out,`vault-sheet-shown-${w}.png`)});
     // Edit: the boxes start empty; Show loads the saved value, as a view, into a box that keeps the line break.
     await clickControl(page,'.vault-sheet [data-edit]');await page.waitForSelector('.vault-editor form');
     assert.deepEqual(await leaked(),[],'nothing from the sheet is left in the page');
     const before=views.length;
     const secretBox='.vault-editor [data-custom="api_secret"] [data-custom-value]';
     assert.equal(await page.$eval(secretBox,e=>e.value+'|'+e.placeholder),'|Unchanged');
     await clickControl(page,'.vault-editor [data-custom="api_secret"] [data-reveal]');
     await page.waitForFunction(sel=>document.querySelector(sel)?.tagName==='TEXTAREA'&&document.querySelector(sel).value.length>0,{},secretBox);
     const box=await page.$eval(secretBox,e=>({value:e.value,masked:e.classList.contains('vault-masked'),pressed:e.closest('.vault-custom-row').querySelector('[data-reveal]').getAttribute('aria-pressed'),label:e.getAttribute('aria-labelledby'),focusable:e.tabIndex>=0}));
     assert.deepEqual(box,{value:PASTED,masked:false,pressed:'true',label:box.label,focusable:true});assert.ok(box.label,'the loaded box keeps its label');
     assert.deepEqual(views.slice(before),['api_secret'],'one field fetched, through the recorded route');
     assert.equal(await page.evaluate(()=>{const s=document.querySelector('.vault-editor');return s.scrollWidth>s.clientWidth+1||document.documentElement.scrollWidth>innerWidth;}),false,'the editor fits at '+w);
     await scan('vault-editor-loaded-'+w);await page.screenshot({path:path.join(out,`vault-editor-loaded-${w}.png`)});
     // Show again masks it; Show once more unmasks without another fetch.
     await clickControl(page,'.vault-editor [data-custom="api_secret"] [data-reveal]');assert.equal(await page.$eval(secretBox,e=>e.classList.contains('vault-masked')),true);
     await clickControl(page,'.vault-editor [data-custom="api_secret"] [data-reveal]');assert.equal(views.length,before+1,'loaded once');
     // The Key is loaded too but left as it was; emptying a loaded value is refused, not saved as "keep".
     await clickControl(page,'.vault-editor [data-secret="value"] ~ [data-reveal]');
     await page.waitForFunction(()=>document.querySelector('.vault-editor [data-secret="value"]').value==='sinch-key-fixture-2026');
     assert.equal(await page.$eval('.vault-editor [data-secret="value"]',e=>e.type),'text');
     await page.$eval(secretBox,e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});
     const sent=acts.length;await clickControl(page,'.vault-editor .primary');
     await page.waitForFunction(()=>/api_secret can’t be empty/.test(document.querySelector('.vault-form-error')?.textContent||''));
     assert.equal(await page.$eval(secretBox,e=>e.getAttribute('aria-invalid')+' '+(e===document.activeElement)),'true true');assert.equal(acts.length,sent,'nothing was sent');
     // Trim it to the secret and save: only that field goes to the server.
     await page.type(secretBox,CLEAN);
     assert.equal(await page.$eval(secretBox,e=>e.hasAttribute('aria-invalid')),false,'typing clears the mark');
     await clickControl(page,'.vault-editor .primary');
     await page.waitForFunction(()=>!document.querySelector('.vault-editor'));
     const upd=acts.at(-1);assert.equal(upd.action,'update');assert.equal(upd.item,id);assert.deepEqual(upd.values,{api_secret:CLEAN},'the untouched Key and base_url are not sent');
     const after=await page.evaluate(id=>fetch('/api/vault/field',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({item:id,field:'api_secret'})}).then(r=>r.json()),id);
     assert.equal(after.value,CLEAN,'the store holds the trimmed value');
     assert.deepEqual(await leaked(),[],'no value outlives the editor, in the page or in storage');
     // The item's history names the field the edit changed.
     await clickControl(page,`[data-vault-open="${id}"]`);await page.waitForSelector('.vault-sheet [data-history] ul');
     assert.match(await page.$eval('.vault-sheet [data-history]',e=>e.textContent),/Changed api_secret by you/);
     await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.vault-sheet'));
    }
    // A login's username: Show loads it (it is never masked), and then the Show button goes.
    await page.goto(base+'/#/vault');await page.waitForSelector('#vault-main .vault-item');
    const vp=await page.evaluate(()=>vaultSnap.items.find(i=>i.name==='vendor-portal').id);
    await clickControl(page,`[data-vault-open="${vp}"]`);await page.waitForSelector('.vault-sheet [data-edit]');await clickControl(page,'.vault-sheet [data-edit]');await page.waitForSelector('.vault-editor form');
    await clickControl(page,'.vault-editor [data-secret="username"] ~ [data-reveal]');
    await page.waitForFunction(()=>document.querySelector('.vault-editor [data-secret="username"]').value==='ops@example.test');
    assert.deepEqual(await page.$eval('.vault-editor [data-secret="username"]',e=>[e.type,e.parentElement.querySelector('[data-reveal]').hidden]),['text',true]);
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.vault-editor'));
    assert.equal(await page.evaluate(()=>document.documentElement.outerHTML.includes('ops@example.test')),false);
   }finally{page.off('request',onReq);await page.setViewport({width:1440,height:900});settings.vault=false;}
  });
  await check('Vault lock (1.40): Settings shows the mode, Set a passphrase, Lock after, Lock now, the locked panel and Unlock, Export and Import, Remove, and the phone',async()=>{
   await page.setViewport({width:1440,height:900});const settings=settingsState();settings.vault=true;settings.vaultReady=true;
   await page.evaluate(()=>fetch('/api/vault/reset',{method:'POST'}));
   const PASS='correct horse battery',EXPORT_PASS='export fixture passphrase',IMPORT_PASS='import-fixture-pass';
   // Every passphrase request, as the browser sent it.
   const posts=[];const onReq=r=>{const u=new URL(r.url());if(r.method()==='POST'&&/^\/api\/(vault\/(unlock|lock|passphrase|export|import)|settings)$/.test(u.pathname))posts.push({path:u.pathname,url:r.url(),body:JSON.parse(r.postData()||'{}')});};page.on('request',onReq);
   const cdp=await page.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path.join(out,'downloads')});
   const last=p=>posts.filter(x=>x.path===p).at(-1);
   const visible=sel=>page.$eval(sel,e=>!e.hidden&&e.getClientRects().length>0);
   const openSettings=async()=>{await clickControl(page,'#railsettings');await page.waitForFunction(()=>document.querySelector('#s-vault')?.disabled===false&&document.querySelector('#s-vault-mode')?.textContent);};
   const fill=async(sel,v)=>{await page.$eval(sel,e=>{e.value='';});await page.type(sel,v);};
   try{
    await page.goto(base+'/#/vault');await page.reload();await page.waitForSelector('#vault-main .vault-item');
    // Key mode: the mode, Set a passphrase and Rotate key; nothing to lock.
    await openSettings();await clickControl(page,'#s-vault-setpass');
    await page.waitForSelector('.vault-passphrase-sheet form');
    assert.equal(await page.$eval('.sheet-back',e=>e.textContent),'Back to Settings');
    assert.match(await page.$eval('.vault-passphrase-sheet .vault-pass-warn',e=>e.textContent),/no reset\. Keep it in your password manager/);
    assert.deepEqual(await page.$$eval('.vault-passphrase-sheet [data-pass]',e=>e.map(x=>x.name+':'+x.autocomplete)),['passphrase:new-password','confirm:new-password']);
    // Checked here first: too short, then different, and nothing is sent.
    await fill('.vault-passphrase-sheet [name=passphrase]','too short');await fill('.vault-passphrase-sheet [name=confirm]','too short');
    await clickControl(page,'.vault-passphrase-sheet .primary');await page.waitForFunction(()=>/at least 12/.test(document.querySelector('.vault-passphrase-sheet .vault-form-error')?.textContent||''));
    await fill('.vault-passphrase-sheet [name=passphrase]',PASS);await fill('.vault-passphrase-sheet [name=confirm]',PASS+'!');
    await clickControl(page,'.vault-passphrase-sheet .primary');await page.waitForFunction(()=>/different/.test(document.querySelector('.vault-passphrase-sheet .vault-form-error')?.textContent||''));
    assert.equal(await page.$eval('.vault-passphrase-sheet [name=confirm]',e=>e.getAttribute('aria-invalid')),'true');
    assert.equal(last('/api/vault/passphrase'),undefined,'nothing sent before the checks pass');
    await scan('vault-passphrase-sheet');
    await fill('.vault-passphrase-sheet [name=confirm]',PASS);await clickControl(page,'.vault-passphrase-sheet .primary');
    // Back in Settings, now in passphrase mode.
    await page.waitForFunction(()=>!document.querySelector('.vault-passphrase-sheet')&&document.querySelector('#s-vault-mode')?.textContent==='Protected by a passphrase');
    assert.deepEqual(last('/api/vault/passphrase').body,{action:'set',passphrase:PASS,confirm:PASS});assert.equal(settings.vaultMode,'passphrase');
    assert.match(await page.$eval('#toast',e=>e.textContent),/now protected by a passphrase/);
    assert.deepEqual({set:await visible('#s-vault-setpass'),rotate:await visible('#s-vault-rotate'),lock:await visible('#s-vault-lock'),change:await visible('#s-vault-changepass'),remove:await visible('#s-vault-removepass'),after:await visible('#s-vault-autolock')},{set:false,rotate:false,lock:true,change:true,remove:true,after:true});
    // Lock after saves to the server.
    await page.select('#s-vault-autolock','15');for(let i=0;i<30&&settings.vaultAutoLockMinutes!==15;i++)await pause(100);
    assert.deepEqual(last('/api/settings').body,{vaultAutoLockMinutes:15});assert.equal(settings.vaultAutoLockMinutes,15);
    await page.$eval('#s-vault-more',e=>e.scrollIntoView({block:'center'}));
    await scan('vault-settings-passphrase');await page.screenshot({path:path.join(out,'vault-settings-passphrase.png')});
    // Lock now: Unlock takes its place and export waits for it.
    await clickControl(page,'#s-vault-lock');await page.waitForFunction(()=>!document.querySelector('#s-vault-unlock').hidden);
    assert.equal(settings.vaultLocked,true);assert.deepEqual(last('/api/vault/lock').body,{});
    assert.equal(await page.$eval('#s-vault-export',e=>e.disabled),true);assert.equal(await page.evaluate(()=>document.activeElement?.id),'s-vault-unlock');
    await page.keyboard.press('Escape');
    // The list becomes the lock panel; the rail segment carries the lock.
    await page.waitForSelector('#vault-main .vault-locked');
    assert.equal(await page.$('#vault-main .vault-item'),null,'no items while locked');
    assert.match(await page.$eval('#vault-main .vault-locked',e=>e.textContent),/The Vault is locked.*Pocket locks it after a restart, and after 15 minutes idle\./s);
    assert.ok(await page.$('[data-rail-view="vault"] [data-vault-lock]'),'the rail segment shows the lock');
    assert.match(await page.$eval('[data-rail-view="vault"]',e=>e.textContent),/Vault, locked/);
    await scan('vault-locked-desktop');await page.screenshot({path:path.join(out,'vault-locked-desktop.png')});
    // Unlock: a wrong passphrase stays in the sheet (no sign-in screen), the right one brings the list back.
    await clickControl(page,'#vt-unlock');await page.waitForSelector('.vault-unlock-sheet form');
    assert.equal(await page.$eval('.vault-unlock-sheet [name=passphrase]',e=>e.autocomplete+' '+(e===document.activeElement)),'current-password true');
    await page.type('.vault-unlock-sheet [name=passphrase]','not the passphrase');await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('.vault-unlock-sheet .vault-form-error')?.textContent==='Wrong passphrase.');
    assert.equal(await page.$('.login'),null,'a wrong passphrase is not a signed-out browser');
    assert.equal(await page.$eval('.vault-unlock-sheet [name=passphrase]',e=>e.getAttribute('aria-invalid')),'true');
    await scan('vault-unlock-sheet');await page.screenshot({path:path.join(out,'vault-unlock-sheet.png')});
    await fill('.vault-unlock-sheet [name=passphrase]',PASS);await clickControl(page,'.vault-unlock-sheet .primary');
    await page.waitForFunction(()=>!document.querySelector('.vault-unlock-sheet')&&document.querySelector('#vault-main .vault-item'));
    assert.deepEqual(posts.filter(x=>x.path==='/api/vault/unlock').map(x=>x.body),[{passphrase:'not the passphrase'},{passphrase:PASS}]);
    assert.equal(await page.$('[data-rail-view="vault"] [data-vault-lock]'),null,'the lock leaves the rail');
    // Export: fetch with the passphrase in the body only, then a download.
    await openSettings();await clickControl(page,'#s-vault-export');await page.waitForSelector('.vault-export-sheet form');
    assert.match(await page.$eval('.vault-export-sheet .vault-pass-help',e=>e.textContent),/^Downloads every item in one file, encrypted with this passphrase\./);
    await scan('vault-export-sheet');
    await page.type('.vault-export-sheet [name=passphrase]',EXPORT_PASS);await page.type('.vault-export-sheet [name=confirm]',EXPORT_PASS);
    await clickControl(page,'.vault-export-sheet .primary');await page.waitForFunction(()=>!document.querySelector('.vault-export-sheet'));
    const exp=last('/api/vault/export');assert.deepEqual(exp.body,{passphrase:EXPORT_PASS,confirm:EXPORT_PASS});assert.equal(exp.url,base+'/api/vault/export','the passphrase is not in the URL');
    assert.match(await page.$eval('#toast',e=>e.textContent),/pocket-vault-export-2026-10-12\.pvault/);
    // Import: the count in a toast, the names that were already here in the sheet.
    await page.waitForSelector('#s-vault-import');await clickControl(page,'#s-vault-import');await page.waitForSelector('.vault-import-sheet form');
    const file=path.join(out,'fixture-import.pvault');fs.writeFileSync(file,'PVAULT import fixture');
    await (await page.$('.vault-import-sheet input[type=file]')).uploadFile(file);
    await page.type('.vault-import-sheet [name=passphrase]',IMPORT_PASS);await clickControl(page,'.vault-import-sheet .primary');
    await page.waitForFunction(()=>document.querySelector('.vault-import-sheet .vault-pass-result')?.textContent==='Already here: zoho-books');
    assert.equal(await page.$eval('#toast',e=>e.textContent),'Imported 2 items');
    const imp=last('/api/vault/import');assert.equal(imp.body.passphrase,IMPORT_PASS);assert.equal(vaultFixture.imported,'PVAULT import fixture','the file went as base64');
    assert.equal(await page.$eval('.vault-import-sheet [name=passphrase]',e=>e.value),'','the passphrase is wiped once imported');
    assert.equal(await page.$eval('.vault-import-sheet .primary',e=>e.textContent),'Done');
    await scan('vault-import-sheet');await page.screenshot({path:path.join(out,'vault-import-sheet.png')});
    await clickControl(page,'.vault-import-sheet .primary');await page.waitForFunction(()=>!document.querySelector('.vault-import-sheet')&&document.querySelector('#s-vault-mode'));
    // Nothing kept: no passphrase in storage or the page.
    const kept=await page.evaluate(ps=>{const s=JSON.stringify(localStorage)+JSON.stringify(sessionStorage)+document.documentElement.outerHTML;return ps.filter(p=>s.includes(p));},[PASS,EXPORT_PASS,IMPORT_PASS]);
    assert.deepEqual(kept,[],'no passphrase is kept in the browser');
    // The phone: locked from elsewhere, the home chip shows the lock, the panel fits.
    await page.keyboard.press('Escape');await page.evaluate(()=>fetch('/api/vault/lock',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}));
    await page.setViewport({width:390,height:844});await page.goto(base+'/#/');await page.reload();await page.waitForSelector('[data-vault-home] [data-vault-lock]');
    assert.match(await page.$eval('[data-vault-home]',e=>e.textContent),/^Vault, locked/);
    await clickControl(page,'[data-vault-home]');await page.waitForSelector('#vault-main .vault-locked');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at 390');
    await scan('vault-locked-mobile');await page.screenshot({path:path.join(out,'vault-locked-mobile.png')});
    await clickControl(page,'#vt-unlock');await page.waitForSelector('.vault-unlock-sheet form');
    assert.equal(await page.evaluate(()=>{const s=document.querySelector('.vault-unlock-sheet');return s.scrollWidth>s.clientWidth+1||document.documentElement.scrollWidth>innerWidth;}),false,'the unlock sheet fits at 390');
    await page.type('.vault-unlock-sheet [name=passphrase]',PASS);await page.keyboard.press('Enter');await page.waitForSelector('#vault-main .vault-item');
    // Remove the passphrase: back to the server key.
    await page.setViewport({width:1440,height:900});await page.reload();await page.waitForSelector('#vault-main .vault-item');
    await openSettings();await clickControl(page,'#s-vault-removepass');await page.waitForSelector('.vault-passphrase-sheet form');
    await page.type('.vault-passphrase-sheet [name=passphrase]',PASS);await clickControl(page,'.vault-passphrase-sheet .primary');
    await page.waitForFunction(()=>document.querySelector('#s-vault-mode')?.textContent==='Opened by the server key in .env');
    assert.deepEqual(last('/api/vault/passphrase').body,{action:'remove',passphrase:PASS});assert.equal(settings.vaultMode,'key');
    assert.equal(await visible('#s-vault-rotate'),true,'Rotate key is back in key mode');
    await page.keyboard.press('Escape');
   }finally{page.off('request',onReq);await cdp.send('Browser.setDownloadBehavior',{behavior:'default'}).catch(()=>{});await cdp.detach().catch(()=>{});await page.evaluate(()=>fetch('/api/vault/reset',{method:'POST'})).catch(()=>{});await page.setViewport({width:1440,height:900});settings.vault=false;}
  });
  await check('Vault access (1.41): Agent access in Settings saves and toasts, the item policy sheet offers five choices with the current default, an override is noted, a request that asks every time has no Always allow, and the phone',async()=>{
   await page.setViewport({width:1440,height:900});const settings=settingsState();settings.vault=true;settings.vaultReady=true;
   await page.evaluate(()=>fetch('/api/vault/reset',{method:'POST'}));
   const posts=[];const onReq=r=>{const u=new URL(r.url());if(r.method()==='POST'&&/^\/api\/(settings|vault\/act)$/.test(u.pathname))posts.push({path:u.pathname,body:JSON.parse(r.postData()||'{}')});};page.on('request',onReq);
   const last=p=>posts.filter(x=>x.path===p).at(-1);
   const id=name=>page.evaluate(n=>vaultSnap.items.find(i=>i.name===n).id,name);
   // Show the Settings category that holds Agent access, as clickControl does before a click.
   const showAccess=async()=>{await page.waitForFunction(()=>document.querySelector('#s-vault')?.disabled===false&&!document.querySelector('#s-vault-more').hidden);
    const cat=await page.$eval('#s-vault-access',e=>e.closest('[data-settings-panel]')?.dataset.settingsPanel);
    if(cat&&await page.$eval(`[data-settings-panel="${cat}"]`,e=>e.hidden)){if(await page.$eval('.settings-index',e=>e.hidden))await page.click('#settings-back');await page.click(`[data-settings-category="${cat}"]`);}
    await page.$eval('#s-vault-access',e=>e.scrollIntoView({block:'center'}));};
   const openSettings=async()=>{await clickControl(page,'#railsettings');await showAccess();};
   try{
    await page.goto(base+'/#/vault');await page.reload();await page.waitForSelector('#vault-main .vault-item');
    // Settings: Agent access sits under the Vault toggle, above Protection, at the install default.
    await openSettings();
    const before=await page.evaluate(()=>{const sel=document.querySelector('#s-vault-access'),prot=document.querySelector('#s-vault-prot-h');
     return {value:sel.value,label:sel.labels[0]?.textContent,options:[...sel.options].map(o=>o.textContent),note:document.querySelector('#s-vault-access-note').textContent,above:Boolean(sel.compareDocumentPosition(prot)&Node.DOCUMENT_POSITION_FOLLOWING),visible:sel.getClientRects().length>0};});
    assert.deepEqual(before,{value:'once',label:'Agent access',options:['Free rein','Ask once per command','Ask every time'],note:'A new command needs your approval once; approved commands are remembered.',above:true,visible:true});
    await page.select('#s-vault-access','every');for(let i=0;i<30&&settings.vaultAccess!=='every';i++)await pause(100);
    assert.deepEqual(last('/api/settings').body,{vaultAccess:'every'});assert.equal(settings.vaultAccess,'every');
    await page.waitForFunction(()=>document.querySelector('#toast')?.textContent==='Agent access: Ask every time');
    assert.equal(await page.$eval('#s-vault-access-note',e=>e.textContent),'Every use needs your approval, from the notification or in the conversation.');
    await page.select('#s-vault-access','free');for(let i=0;i<30&&settings.vaultAccess!=='free';i++)await pause(100);
    await page.waitForFunction(()=>document.querySelector('#toast')?.textContent==='Agent access: Free rein');
    assert.match(await page.$eval('#s-vault-access-note',e=>e.textContent),/^Agents use any secret by name without asking\. Values still never enter the conversation, and every use is recorded\.$/);
    await page.$eval('#s-vault-more',e=>e.scrollIntoView({block:'center'}));
    await scan('vault-settings-access');await page.screenshot({path:path.join(out,'vault-settings-access.png')});
    await page.select('#s-vault-access','every');for(let i=0;i<30&&settings.vaultAccess!=='every';i++)await pause(100);
    await page.keyboard.press('Escape');
    // The list: an item that follows the default reads as the setting; one with its own policy keeps it.
    const zoho=await id('zoho-books'),sq=await id('square-hooks');
    await page.waitForFunction(z=>/Asks every time/.test(document.querySelector(`#vault-main .vault-item[data-item="${z}"] .session-status`)?.textContent||''),{},zoho);
    assert.match(await page.$eval(`#vault-main .vault-item[data-item="${sq}"] .session-status`,e=>e.textContent),/Asks once per command/);
    // The sheet: the effective word, no override note for an item on the default.
    await clickControl(page,`[data-vault-open="${zoho}"]`);await page.waitForSelector('.vault-sheet [data-policy]');
    assert.equal(await page.$eval('.vault-sheet .vault-policy strong',e=>e.textContent),'Asks every time');
    assert.equal(await page.$('.vault-sheet .vault-policy-note'),null,'no note while it follows the default');
    // Change who can use it: five choices, the default named with the current setting and selected.
    await clickControl(page,'.vault-sheet [data-policy]');await page.waitForSelector('.sheet .opt[data-v="default"]');
    const choices=await page.$$eval('.sheet .opt[data-v]',bs=>bs.map(b=>({v:b.dataset.v,label:b.querySelector('span:not(.dot)').firstChild.textContent,sub:b.querySelector('.sub').textContent,sel:b.classList.contains('sel')})));
    assert.deepEqual(choices.map(c=>c.v),['default','auto','ask','every','owner']);
    assert.deepEqual(choices.map(c=>c.label),['Vault default (currently: Ask every time)','Free rein','Ask once per command','Ask every time','Only you']);
    assert.ok(choices.every(c=>c.sub.length>10),'each choice says what it does');assert.deepEqual(choices.filter(c=>c.sel).map(c=>c.v),['default']);
    await scan('vault-policy-sheet');await page.screenshot({path:path.join(out,'vault-policy-sheet.png')});
    // Phone width: the policy sheet fits.
    await page.setViewport({width:390,height:844});await pause(150);
    assert.equal(await page.evaluate(()=>{const s=document.querySelector('.sheet[role=dialog]');return s.scrollWidth>s.clientWidth+1||document.documentElement.scrollWidth>innerWidth;}),false,'the policy sheet fits at 390');
    await scan('vault-policy-sheet-mobile');await page.setViewport({width:1440,height:900});
    // Ask once per command overrides the default: the update carries it, the sheet notes it.
    await clickControl(page,'.sheet .opt[data-v="ask"]');await page.waitForSelector('.vault-sheet .vault-policy-note');
    assert.deepEqual({action:last('/api/vault/act').body.action,policy:last('/api/vault/act').body.policy},{action:'update',policy:'ask'});
    assert.equal(await page.$eval('.vault-sheet .vault-policy-note',e=>e.textContent),'Set for this item. The Vault default is Ask every time.');
    assert.equal(await page.$eval('.vault-sheet .vault-policy strong',e=>e.textContent),'Asks once per command');
    // Back to the default.
    await clickControl(page,'.vault-sheet [data-policy]');await page.waitForSelector('.sheet .opt[data-v="default"].sel, .sheet .opt[data-v="ask"].sel');
    await clickControl(page,'.sheet .opt[data-v="default"]');await page.waitForFunction(()=>document.querySelector('.vault-sheet .vault-policy')&&!document.querySelector('.vault-sheet .vault-policy-note'));
    assert.equal(last('/api/vault/act').body.policy,'default');await page.keyboard.press('Escape');
    // The editor: Who can use it has the same five, Vault default selected for a new secret.
    await clickControl(page,'#vt-add');await page.waitForSelector('.vault-editor [name=policy]');
    assert.deepEqual(await page.$eval('.vault-editor [name=policy]',s=>({value:s.value,options:[...s.options].map(o=>o.value),first:s.options[0].textContent,hint:document.querySelector('[data-policy-hint]').textContent})),
     {value:'default',options:['default','auto','ask','every','owner'],first:'Vault default (currently: Ask every time)',hint:'Follows Agent access in Settings → Vault.'});
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.vault-editor'));
    // A request on an item that asks every time: Allow once and Deny only.
    vaultFixture.extraRequests=[{id:'fixture-every',items:['fixture'],itemNames:['payroll-api'],argv:['node','run-payroll.mjs'],cwd:'/srv/payroll',session:rows[0].id,sessionTitle:rows[0].title,created:new Date().toISOString(),expiresAt:new Date(Date.now()+15*60000).toISOString(),answer:null,allowAlways:false}];
    await page.reload();await page.waitForSelector('#vault-main .vault-request[data-request="fixture-every"]');
    assert.deepEqual(await page.$$eval('#vault-main .vault-request[data-request="fixture-every"] [data-answer]',bs=>bs.map(b=>b.dataset.answer)),['deny','once']);
    assert.ok(await page.$('#vault-main .vault-request:not([data-request="fixture-every"]) [data-answer="always"]'),'a request that may be remembered keeps Always allow');
    await scan('vault-request-every');
    // The phone: Settings → Vault and the requests fit at 390.
    await page.setViewport({width:390,height:844});await page.reload();await page.waitForSelector('#vault-main .vault-request[data-request="fixture-every"]');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at 390');
    await page.screenshot({path:path.join(out,'vault-request-every-mobile.png')});
    await page.goto(base+'/#/');await page.waitForSelector('#settings');
    await clickControl(page,'#settings');await showAccess();
    assert.equal(await page.evaluate(()=>{const s=document.querySelector('#s-vault-more').closest('.sheet');return s.scrollWidth>s.clientWidth+1||document.documentElement.scrollWidth>innerWidth;}),false,'Settings → Vault fits at 390');
    await scan('vault-settings-access-mobile');await page.screenshot({path:path.join(out,'vault-settings-access-mobile.png')});
    await page.keyboard.press('Escape');
   }finally{page.off('request',onReq);vaultFixture.extraRequests=[];await page.evaluate(()=>fetch('/api/vault/reset',{method:'POST'})).catch(()=>{});await page.setViewport({width:1440,height:900});settings.vault=false;}
  });
  await check('Vault key (1.44): switching on with no key shows the recovery key (Copy, Download, gone after Done, never stored), Download recovery key, Rotate saves and shows the new key, a missing key is restored from the key or its file and a wrong key errors inline, and the phone',async()=>{
   await page.setViewport({width:1440,height:900});const settings=settingsState();
   settings.vault=true;await page.goto(base+'/#/vault');await page.evaluate(()=>fetch('/api/vault/reset',{method:'POST'}));
   const KEY=vaultFixture.key;Object.assign(settings,{vault:false,vaultReady:false,vaultCanCreateKey:true,vaultNeedsKey:false});
   const HELP='This key opens your Vault. Pocket keeps it on this server, but if the server or its settings are lost, a backup of the Vault can only be opened with it. Keep it in your password manager.';
   const posts=[];const onReq=r=>{const u=new URL(r.url());if(r.method()==='POST'&&/^\/api\/(settings|vault\/(recovery-key|rotate|restore-key))$/.test(u.pathname))posts.push({path:u.pathname,body:JSON.parse(r.postData()||'{}')});};page.on('request',onReq);
   const last=p=>posts.filter(x=>x.path===p).at(-1);
   const dl=path.join(out,'recovery-files');fs.rmSync(dl,{recursive:true,force:true});fs.mkdirSync(dl,{recursive:true});
   // A blob download as the browser would save it: the link's name and the blob's text (headless Chrome saves nothing).
   const catchDownload=()=>page.evaluate(()=>{const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(!this.download||!this.href.startsWith('blob:'))return click.call(this);HTMLAnchorElement.prototype.click=click;const d=window.__download={name:this.download};fetch(this.href).then(r=>r.text()).then(t=>{d.text=t;});};});
   const takeDownload=async()=>{await page.waitForFunction(()=>typeof window.__download?.text==='string');return page.evaluate(()=>{const d=window.__download;delete window.__download;return d;});};
   // The key anywhere it must not be: the markup, storage, any field still on the page.
   const leaked=k=>page.evaluate(k=>document.documentElement.outerHTML.includes(k)||JSON.stringify(localStorage).includes(k)||JSON.stringify(sessionStorage).includes(k)||[...document.querySelectorAll('textarea,input')].some(e=>e.value.includes(k)),k);
   const openSettings=async()=>{await clickControl(page,'#railsettings');await page.waitForFunction(()=>{const s=document.querySelector('#s-vault-state');return s&&!/^Loading/.test(s.textContent);});};
   const toggle=()=>page.$eval('#s-vault',b=>({disabled:b.disabled,sub:b.querySelector('.sub').textContent}));
   const fits=sel=>page.evaluate(sel=>{const s=document.querySelector(sel).closest('.sheet');return s.scrollWidth>s.clientWidth+1||document.documentElement.scrollWidth>innerWidth;},sel);
   try{
    await page.reload();await page.waitForFunction(()=>/The Vault is off/.test(document.querySelector('#vault-main')?.textContent||''));
    // No key and no Vault yet: the switch is on offer and says what turning it on does.
    await openSettings();
    assert.deepEqual(await toggle(),{disabled:false,sub:"Off. Turning it on creates this install's encryption key; you'll be shown a recovery key to save."});
    assert.equal(await page.$eval('#s-vault-restore-wrap',e=>e.hidden),true,'nothing to restore');
    await page.evaluate(()=>{navigator.clipboard.writeText=t=>{window.__copied=t;return Promise.resolve();};});
    await clickControl(page,'#s-vault');await page.waitForSelector('.vault-key-sheet .vault-key');
    assert.deepEqual(last('/api/settings').body,{vault:true});assert.equal(settings.vault,true,'the server setting changed');
    assert.deepEqual(await page.$eval('.vault-key-sheet',s=>{const f=s.querySelector('.vault-key');return {title:s.querySelector('h2').textContent,help:s.querySelector('.sheet-help').textContent,key:f.value,readOnly:f.readOnly,label:f.labels[0]?.textContent,buttons:[...s.querySelectorAll('.vault-key-actions button')].map(b=>b.textContent.trim()),note:Boolean(s.querySelector('.vault-key-note'))};}),
     {title:'Save your recovery key',help:HELP,key:KEY,readOnly:true,label:'Recovery key',buttons:['Copy','Download','Done'],note:false});
    assert.equal(await page.evaluate(k=>document.documentElement.outerHTML.includes(k)||JSON.stringify(localStorage).includes(k),KEY),false,'the key is the field value only, never markup or storage');
    await scan('vault-recovery-sheet');await page.screenshot({path:path.join(out,'vault-recovery-sheet.png')});
    await clickControl(page,'.vault-key-sheet [data-copy-key]');await page.waitForFunction(()=>document.querySelector('#toast')?.textContent==='Recovery key copied');
    assert.equal(await page.evaluate(()=>{const t=window.__copied;delete window.__copied;return t;}),KEY);
    await catchDownload();await clickControl(page,'.vault-key-sheet [data-download-key]');const file=await takeDownload();
    assert.match(file.name,new RegExp(`^pocket-vault-recovery-key-${new URL(base).hostname.replaceAll('.','\\.')}-\\d{4}-\\d{2}-\\d{2}\\.txt$`));
    const lines=file.text.trimEnd().split('\n');
    assert.equal(lines.length,3);assert.ok(lines[0].startsWith('# ')&&lines[1].startsWith('# '),'a two-line header');assert.equal(lines[2],'POCKET_VAULT_KEY='+KEY);
    await page.waitForFunction(n=>document.querySelector('#toast')?.textContent==='Saved '+n,{},file.name);
    fs.writeFileSync(path.join(dl,file.name),file.text);
    // The phone: the sheet fits at 390.
    await page.setViewport({width:390,height:844});await pause(150);
    assert.equal(await fits('.vault-key-sheet'),false,'the recovery sheet fits at 390');
    await scan('vault-recovery-sheet-mobile');await page.screenshot({path:path.join(out,'vault-recovery-sheet-mobile.png')});
    await page.setViewport({width:1440,height:900});
    await clickControl(page,'.vault-key-sheet [data-done]');await page.waitForFunction(()=>!document.querySelector('.vault-key-sheet'));
    assert.equal(await leaked(KEY),false,'the key left with the sheet');
    // Download recovery key: in key mode, under Protection; Done goes back to Settings.
    await openSettings();await page.waitForFunction(()=>!document.querySelector('#s-vault-recovery').hidden);
    await clickControl(page,'#s-vault-recovery');await page.waitForSelector('.vault-key-sheet .vault-key');
    assert.deepEqual(last('/api/vault/recovery-key').body,{});
    assert.equal(await page.$eval('.vault-key-sheet .vault-key',e=>e.value),KEY);assert.ok(await page.$('.vault-key-sheet .sheet-back'),'Back to Settings');
    await clickControl(page,'.vault-key-sheet [data-done]');await page.waitForFunction(()=>!document.querySelector('.vault-key-sheet')&&document.querySelector('.settings-sheet #s-vault-rotate'));
    assert.equal(await leaked(KEY),false,'the key left with the sheet');
    // Rotate: the server saves the new key; the sheet says so and shows it.
    await clickControl(page,'#s-vault-rotate');await page.waitForSelector('.sheet [data-yes]');
    await clickControl(page,'.sheet [data-yes]');await page.waitForSelector('.vault-key-sheet .vault-key-note');
    const NEW=vaultFixture.key;assert.notEqual(NEW,KEY);assert.deepEqual(last('/api/vault/rotate').body,{});
    assert.deepEqual(await page.$eval('.vault-key-sheet',s=>({note:s.querySelector('.vault-key-note').textContent,key:s.querySelector('.vault-key').value})),
     {note:'New key saved on the server. Save the new recovery key; backups made before now still need the old one.',key:NEW});
    await scan('vault-rotate-sheet');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.vault-key-sheet'));
    assert.equal(await leaked(NEW),false,'the new key left with the sheet');
    // The key is missing on this server: no switch, Restore key instead.
    Object.assign(settings,{vault:false,vaultReady:false,vaultNeedsKey:true});
    await page.reload();await page.waitForFunction(()=>/The Vault is off/.test(document.querySelector('#vault-main')?.textContent||''));
    await openSettings();
    assert.deepEqual(await toggle(),{disabled:true,sub:"This Vault's key is missing on this server. Restore it from your recovery key."});
    if(await page.$eval('[data-settings-panel="libraries"]',e=>e.hidden)){if(await page.$eval('.settings-index',e=>e.hidden))await page.click('#settings-back');await page.click('[data-settings-category="libraries"]');}
    assert.deepEqual(await page.$eval('#s-vault-restore-wrap',e=>({shown:!e.hidden&&e.getClientRects().length>0,panel:e.closest('[data-settings-panel]')?.dataset.settingsPanel,underSwitch:e.previousElementSibling?.id,more:document.querySelector('#s-vault-more').hidden})),{shown:true,panel:'libraries',underSwitch:'s-vault',more:true});
    await page.$eval('#s-vault-restore',e=>e.scrollIntoView({block:'center'}));await scan('vault-needs-key-settings');
    await clickControl(page,'#s-vault-restore');await page.waitForSelector('.vault-restore-sheet form');
    assert.equal(await page.$eval('.vault-restore-sheet [name=key]',e=>e.type),'password');
    // A wrong key: the reason inline, the field marked; not a signed-out browser.
    await page.type('.vault-restore-sheet [name=key]','not-the-key');await clickControl(page,'.vault-restore-sheet .primary');
    await page.waitForFunction(()=>document.querySelector('.vault-restore-sheet .vault-form-error')?.textContent==='That key does not open this Vault.');
    assert.equal(await page.$eval('.vault-restore-sheet [name=key]',e=>e.getAttribute('aria-invalid')),'true');assert.equal(await page.$('.login'),null);
    await scan('vault-restore-sheet');await page.screenshot({path:path.join(out,'vault-restore-sheet.png')});
    // A file without the key line says so.
    fs.writeFileSync(path.join(dl,'notes.txt'),'just some notes\n');
    await (await page.$('.vault-restore-sheet [name=file]')).uploadFile(path.join(dl,'notes.txt'));
    await page.waitForFunction(()=>/no POCKET_VAULT_KEY line/.test(document.querySelector('.vault-restore-sheet .vault-form-error')?.textContent||''));
    await page.setViewport({width:390,height:844});await pause(150);
    assert.equal(await fits('.vault-restore-sheet'),false,'the restore sheet fits at 390');await scan('vault-restore-sheet-mobile');
    await page.setViewport({width:1440,height:900});
    // The file saved before the rotation: its key is read in, and refused, inline.
    await (await page.$('.vault-restore-sheet [name=file]')).uploadFile(path.join(dl,file.name));
    await page.waitForFunction(k=>document.querySelector('.vault-restore-sheet [name=key]').value===k,{},KEY);
    await clickControl(page,'.vault-restore-sheet .primary');
    await page.waitForFunction(()=>document.querySelector('.vault-restore-sheet .vault-form-error')?.textContent==='That key does not open this Vault.');
    // The saved recovery file: its POCKET_VAULT_KEY line fills the field; Restore opens the Vault.
    fs.writeFileSync(path.join(dl,'pocket-vault-recovery-key-new.txt'),`# Pocket Code Vault recovery key\n# Keep it private.\nPOCKET_VAULT_KEY=${NEW}\n`);
    await (await page.$('.vault-restore-sheet [name=file]')).uploadFile(path.join(dl,'pocket-vault-recovery-key-new.txt'));
    await page.waitForFunction(k=>document.querySelector('.vault-restore-sheet [name=key]').value===k&&!document.querySelector('.vault-restore-sheet .vault-form-error').textContent,{},NEW);
    await clickControl(page,'.vault-restore-sheet .primary');await page.waitForFunction(()=>!document.querySelector('.vault-restore-sheet'));
    await page.waitForFunction(()=>document.querySelector('#toast')?.textContent==='Vault restored');
    assert.deepEqual(posts.filter(x=>x.path==='/api/vault/restore-key').map(x=>x.body),[{key:'not-the-key'},{key:KEY},{key:NEW}]);
    // Back in Settings, repainted: the switch is on offer again and Restore key is gone.
    await page.waitForFunction(()=>document.querySelector('#s-vault')?.disabled===false&&document.querySelector('#s-vault-restore-wrap')?.hidden);
    assert.equal(await leaked(NEW),false,'the key left with the restore sheet');
    await page.keyboard.press('Escape');
   }finally{page.off('request',onReq);
    settings.vault=true;await page.evaluate(()=>fetch('/api/vault/reset',{method:'POST'})).catch(()=>{});await page.setViewport({width:1440,height:900});Object.assign(settings,{vault:false,vaultReady:true,vaultCanCreateKey:false,vaultNeedsKey:false});}
  });
  await check('Secrets in the composer (1.42): a pasted key is held and stored, pasted as is or cancelled, a lone token is caught, ordinary text and a URL paste normally, a send is held with Send as is and Store and send, a server 422 opens the sheet, the queue editor, the toggle, the Vault off, and the phone',async()=>{
   await page.setViewport({width:1440,height:900});const settings=settingsState();settings.vault=true;settings.vaultReady=true;settings.secretGuard=true;
   await page.evaluate(()=>fetch('/api/vault/reset',{method:'POST'}));
   const KEY='sk-proj-Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7cDe0fGh2',TOKEN='Zq8vR2mX9pL4tY7wK3nB6cJ1hF5dG0sAe';
   const posts=[];const onReq=r=>{const u=new URL(r.url());if(r.method()==='POST'&&(/\/message$/.test(u.pathname)||/^\/api\/(new|vault\/act|settings)$/.test(u.pathname)))posts.push({path:u.pathname,body:JSON.parse(r.postData()||'{}')});};page.on('request',onReq);
   const last=re=>posts.filter(x=>re.test(x.path)).at(-1);
   // A paste as the browser delivers it; returns whether the browser was left to paste it (a synthetic event never inserts).
   const paste=(sel,text)=>page.$eval(sel,(el,t)=>{el.focus();const dt=new DataTransfer();dt.setData('text/plain',t);const ev=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});el.dispatchEvent(ev);return !ev.defaultPrevented;},text);
   const leaked=secret=>page.evaluate(k=>document.documentElement.outerHTML.includes(k)||JSON.stringify(localStorage).includes(k)||[...document.querySelectorAll('textarea,input')].some(e=>e.value.includes(k)),secret);
   const sheetGone=()=>page.waitForFunction(()=>!document.querySelector('.secret-sheet'));
   const idleId=rows[4].id;
   // A hover tip from a control the pointer rests on after a reload is not part of the sheet: leave it as a pointer would.
   const untip=()=>page.evaluate(()=>{for(const el of document.querySelectorAll(':hover'))el.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,relatedTarget:null}));const t=document.getElementById('tip');if(t)t.hidden=true;});
   const setBox=v=>page.$eval('#box',(b,v)=>{b.value=v;b.dispatchEvent(new Event('input',{bubbles:true}));b.focus();b.setSelectionRange(v.length,v.length);},v);
   try{
    await openChat(idleId);await page.evaluate(id=>{saveOutbox(id,null);clearDraft(id);},idleId);await page.reload();await page.waitForFunction(()=>document.querySelector('#box')&&!document.querySelector('#box').readOnly);
    // Paste: held before it reaches the box; the sheet names it and its length, never a character of it.
    await setBox('Use ');
    assert.equal(await paste('#box',KEY),false,'the paste is cancelled');await page.waitForSelector('.secret-sheet .secret-form');
    const sheet=await page.evaluate(()=>({title:document.querySelector('.secret-sheet h2').textContent,what:document.querySelector('.secret-sheet .secret-what').textContent,name:document.querySelector('.secret-sheet [name="name-0"]').value,kind:document.querySelector('.secret-sheet [name="kind-0"]').value,kinds:[...document.querySelector('.secret-sheet [name="kind-0"]').options].map(o=>o.textContent),primary:document.querySelector('.secret-sheet .primary').textContent,alt:[...document.querySelectorAll('.secret-sheet .secret-alt .opt')].map(b=>b.firstChild.nextSibling?.firstChild?.textContent||b.textContent)}));
    assert.deepEqual(sheet,{title:'That looks like a secret',what:`An OpenAI API key, ${KEY.length} characters.`,name:'openai-api-key',kind:'api_key',kinds:['API key','Token','Secure note'],primary:'Store in the Vault',alt:['Paste as is','Cancel']});
    assert.equal(await page.$eval('#box',b=>b.value),'Use ');assert.equal(await leaked(KEY),false,'the key is nowhere on the page or in storage while held');
    await untip();await scan('secret-paste-sheet');await page.screenshot({path:path.join(out,'secret-paste-sheet.png')});
    // Store in the Vault: the item is added and the box gets the placeholder.
    await clickControl(page,'.secret-sheet .primary');await sheetGone();
    assert.equal(await page.$eval('#box',b=>b.value),'Use {{vault:openai-api-key}}');
    assert.deepEqual(last(/vault\/act$/).body,{action:'add',name:'openai-api-key',kind:'api_key',values:{value:KEY}});
    await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Stored in the Vault as openai-api-key; the message has a placeholder');
    assert.equal(await page.evaluate(()=>vaultSnap.items.some(i=>i.name==='openai-api-key')),true);assert.equal(await leaked(KEY),false,'stored, not left behind');
    // The next suggestion is unique; Paste as is puts the text in as it was.
    await setBox('');await paste('#box',KEY);await page.waitForSelector('.secret-sheet .secret-form');
    assert.equal(await page.$eval('.secret-sheet [name="name-0"]',e=>e.value),'openai-api-key-2');
    await clickControl(page,'.secret-sheet [data-as-is]');await sheetGone();assert.equal(await page.$eval('#box',b=>b.value),KEY);
    // Cancel inserts nothing.
    await setBox('Keep this');await paste('#box',KEY);await page.waitForSelector('.secret-sheet');
    await clickControl(page,'.secret-sheet [data-back]');await sheetGone();assert.equal(await page.$eval('#box',b=>b.value),'Keep this');assert.equal(await leaked(KEY),false);
    // A lone random token with no known prefix is caught on paste; ordinary text and a URL paste normally.
    await setBox('');assert.equal(await paste('#box',TOKEN),false);await page.waitForSelector('.secret-sheet');
    assert.equal(await page.$eval('.secret-sheet .secret-what',e=>e.textContent),`A key or token, ${TOKEN.length} characters.`);
    await page.keyboard.press('Escape');await sheetGone();assert.equal(await page.$eval('#box',b=>b.value),'');
    // Two secrets in one paste: a row each, with unique names.
    await paste('#box',`OPENAI_API_KEY=${KEY}\nportal password: hunter2!`);await page.waitForSelector('.secret-sheet .secret-form');
    assert.deepEqual(await page.evaluate(()=>({what:document.querySelector('.secret-sheet .secret-what').textContent,heads:[...document.querySelectorAll('.secret-sheet .secret-row-head')].map(e=>e.textContent),names:[...document.querySelectorAll('.secret-sheet .vault-name-input')].map(e=>e.value)})),
     {what:`An OpenAI API key (${KEY.length} characters) and a password or secret (8 characters).`,heads:[`An OpenAI API key · ${KEY.length} characters`,'A password or secret · 8 characters'],names:['openai-api-key-2','secret']});
    await untip();await scan('secret-paste-sheet-two');await page.screenshot({path:path.join(out,'secret-paste-sheet-two.png')});
    await clickControl(page,'.secret-sheet [data-back]');await sheetGone();
    assert.equal(await paste('#box','Check aisle 4 against the Friday delivery'),true,'ordinary text pastes normally');
    assert.equal(await paste('#box','https://example.com/inventory?id=42&sort=desc'),true,'a URL pastes normally');
    assert.equal(await page.$('.secret-sheet'),null);
    // Send: held before the request; Send as is posts with allowSecrets.
    const before=posts.filter(x=>/\/message$/.test(x.path)).length;
    await setBox('The portal password: hunter2!');await clickControl(page,'#send');await page.waitForSelector('.secret-sheet .secret-form');
    assert.equal(posts.filter(x=>/\/message$/.test(x.path)).length,before,'nothing was posted');
    assert.deepEqual(await page.evaluate(()=>({what:document.querySelector('.secret-sheet .secret-what').textContent,primary:document.querySelector('.secret-sheet .primary').textContent,box:document.querySelector('#box').value,name:document.querySelector('.secret-sheet [name="name-0"]').value})),
     {what:'A password or secret, 8 characters.',primary:'Store and send',box:'The portal password: hunter2!',name:'secret'});
    await untip();await scan('secret-send-sheet');await page.screenshot({path:path.join(out,'secret-send-sheet.png')});
    await clickControl(page,'.secret-sheet [data-as-is]');await sheetGone();
    await page.waitForFunction(n=>document.querySelector('#delivery-status')?.textContent==='Message delivered.',{},before);
    assert.deepEqual((({text,allowSecrets})=>({text,allowSecrets}))(last(/\/message$/).body),{text:'The portal password: hunter2!',allowSecrets:true});
    // Store and send: the item is added, then the placeholder text goes as a new send.
    await openChat(idleId);await setBox('The portal password: hunter2!');await clickControl(page,'#send');await page.waitForSelector('.secret-sheet .secret-form');
    await clickControl(page,'.secret-sheet .primary');await sheetGone();
    await page.waitForFunction(()=>document.querySelector('#delivery-status')?.textContent==='Message delivered.');
    assert.deepEqual(last(/vault\/act$/).body,{action:'add',name:'secret',kind:'api_key',values:{value:'hunter2!'}});
    const stored=last(/\/message$/).body;assert.equal(stored.text,'The portal password: {{vault:secret}}');assert.equal(stored.allowSecrets,undefined);
    // A server 422 (this browser's check missed it) opens the same sheet; nothing is marked delivered or kept for retry.
    await openChat(idleId);await page.evaluate(()=>{secretGuard.on=false;});
    await setBox('password: hunter2!');await clickControl(page,'#send');await page.waitForSelector('.secret-sheet');
    assert.deepEqual(await page.evaluate(id=>({outbox:loadOutbox(id),box:document.querySelector('#box').value,readOnly:document.querySelector('#box').readOnly,what:document.querySelector('.secret-sheet .secret-what').textContent,notice:document.querySelector('#delivery-status')?.textContent||''}),idleId),
     {outbox:null,box:'password: hunter2!',readOnly:false,what:'A password or secret, 8 characters.',notice:''});
    await clickControl(page,'.secret-sheet [data-back]');await sheetGone();assert.equal(await page.$eval('#box',b=>b.value),'password: hunter2!','Edit leaves the draft');
    await page.evaluate(id=>{secretGuard.on=true;clearDraft(id);document.querySelector('#box').value='';},idleId);
    // New session: the task is held the same way and Edit leaves it in the box.
    await page.goto(base+'/#/new');await page.waitForSelector('#first');const newPosts=posts.filter(x=>x.path==='/api/new').length;
    await page.$eval('#first',f=>{f.value='Log in with password: hunter2! and pull the invoices';f.dispatchEvent(new Event('input',{bubbles:true}));});
    await clickControl(page,'#start');await page.waitForSelector('.secret-sheet');
    assert.equal(posts.filter(x=>x.path==='/api/new').length,newPosts,'no start was posted');
    await clickControl(page,'.secret-sheet [data-back]');await sheetGone();
    assert.equal(await page.$eval('#first',f=>f.value),'Log in with password: hunter2! and pull the invoices');
    assert.equal(await page.$eval('#start',b=>b.getAttribute('aria-label')),'Start conversation');
    await page.evaluate(()=>{clearDraft(NEW_KEY);document.querySelector('#first').value='';});
    // Settings → Vault: Catch secrets in messages, on by default; off lets a key paste through untouched.
    await openChat(idleId);await clickControl(page,'#railsettings');await page.waitForFunction(()=>document.querySelector('#s-secrets')?.disabled===false);
    assert.deepEqual(await page.$eval('#s-secrets',b=>({pressed:b.getAttribute('aria-pressed'),label:b.querySelector('span:not(.dot)').firstChild.textContent,sub:b.querySelector('.sub').textContent,panel:b.closest('[data-settings-panel]')?.dataset.settingsPanel,afterVault:Boolean(document.querySelector('#s-vault-more').compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING)})),
     {pressed:'true',label:'Catch secrets in messages',sub:'Holds a key or password pasted or typed into a message and offers to store it in the Vault first',panel:'libraries',afterVault:true});
    await clickControl(page,'#s-secrets');for(let i=0;i<30&&settings.secretGuard!==false;i++)await pause(100);
    assert.deepEqual(last(/settings$/).body,{secretGuard:false});await page.waitForFunction(()=>document.querySelector('#s-secrets').getAttribute('aria-pressed')==='false');
    await untip();await scan('secret-settings');await page.keyboard.press('Escape');
    assert.equal(await paste('#box',KEY),true,'with the guard off a key pastes normally');assert.equal(await page.$('.secret-sheet'),null);
    settings.secretGuard=true;await page.evaluate(()=>setSecretGuard(true));
    // The Vault off: the sheet says what pasting does and how to store it instead, with Paste as is and Cancel.
    settings.vault=false;await page.reload();await page.waitForSelector('#box');
    await paste('#box',KEY);await page.waitForSelector('.secret-sheet');
    assert.deepEqual(await page.evaluate(()=>({form:Boolean(document.querySelector('.secret-sheet form')),help:document.querySelector('.secret-sheet .secret-help').textContent,hint:document.querySelector('.secret-sheet .secret-hint').textContent,alt:[...document.querySelectorAll('.secret-sheet .secret-alt .opt')].length})),
     {form:false,help:'Pasting it sends it to the model and keeps it in the transcript.',hint:'Turn on the Vault in Settings to store secrets instead.',alt:2});
    await untip();await scan('secret-paste-sheet-vault-off');await clickControl(page,'.secret-sheet [data-back]');await sheetGone();settings.vault=true;
    // The phone: both sheets fit at 390, and the queue editor's paste stacks over its dialog and returns to it.
    await page.setViewport({width:390,height:844});await page.reload();await page.waitForSelector('#box');await setBox('');
    await paste('#box',KEY);await page.waitForSelector('.secret-sheet .secret-form');
    assert.equal(await page.evaluate(()=>{const s=document.querySelector('.secret-sheet');return s.scrollWidth>s.clientWidth+1||document.documentElement.scrollWidth>innerWidth;}),false,'the paste sheet fits at 390');
    await untip();await scan('secret-paste-sheet-mobile');await page.screenshot({path:path.join(out,'secret-paste-sheet-mobile.png')});
    await clickControl(page,'.secret-sheet [data-back]');await sheetGone();
    await setBox('password: hunter2!');await clickControl(page,'#send');await page.waitForSelector('.secret-sheet .secret-form');
    assert.equal(await page.evaluate(()=>{const s=document.querySelector('.secret-sheet');return s.scrollWidth>s.clientWidth+1||document.documentElement.scrollWidth>innerWidth;}),false,'the send sheet fits at 390');
    await untip();await scan('secret-send-sheet-mobile');await page.screenshot({path:path.join(out,'secret-send-sheet-mobile.png')});
    await clickControl(page,'.secret-sheet [data-back]');await sheetGone();await page.evaluate(id=>{clearDraft(id);document.querySelector('#box').value='';},idleId);
    setMode({queueSeed:{id:'q-secret',revision:1,text:'Pull the invoices after this turn.',status:'pending'}});
    await openChat(rows[0].id);await clickControl(page,'#queue-open');await page.waitForSelector('[data-edit]');await clickControl(page,'[data-edit]');await page.waitForSelector('.queue-editor');
    const queued=await page.$eval('.queue-editor',e=>e.value);
    assert.equal(await paste('.queue-editor',KEY),false);await page.waitForSelector('.secret-sheet.sheet-over');
    assert.equal(await page.evaluate(()=>Boolean(document.querySelector('.queue-editor')?.closest('.sheet[role=dialog]')?.inert)),true,'the queue dialog waits underneath');
    await page.keyboard.press('Escape');await sheetGone();
    assert.deepEqual(await page.evaluate(()=>({value:document.querySelector('.queue-editor').value,focused:document.activeElement===document.querySelector('.queue-editor'),inert:document.querySelector('.queue-editor').closest('.sheet').inert})),{value:queued,focused:true,inert:false});
    assert.equal(await leaked(KEY),false);
    await clickControl(page,'[data-cancel]');await page.waitForFunction(()=>!document.querySelector('.queue-editor'));
    await clickControl(page,'[data-remove]');await page.waitForFunction(()=>document.querySelector('#queue-items')?.textContent.includes('No queued instructions'));await page.keyboard.press('Escape');
   }finally{page.off('request',onReq);await page.evaluate(()=>{try{secretGuard.on=true;}catch{}}).catch(()=>{});await page.evaluate(()=>fetch('/api/vault/reset',{method:'POST'})).catch(()=>{});await page.setViewport({width:1440,height:900});settings.vault=false;settings.secretGuard=true;}
  });
  await check('Projects (1.29): off by default, then the list, card, steps, reminders, finish and resume, tracking from a session, tabs, split pane, rail switch, settings and the phone',async()=>{
   await page.setViewport({width:1440,height:900});const sleep=ms=>new Promise(r=>setTimeout(r,ms));
   const settings=settingsState();settings.projects=false;
   await page.goto(base+'/#/projects');await page.waitForSelector('#projects-main');
   await page.waitForFunction(()=>/Projects is off/.test(document.querySelector('#projects-main')?.textContent||''));
   assert.equal(await page.$('.rail-switch'),null,'no rail switch while the feature is off');
   await openChat(rows[4].id);await clickControl(page,'#chatmore');await page.waitForSelector('.sheet');
   assert.equal(await page.$('#so-project'),null,'session options offer no project while it is off');await page.keyboard.press('Escape');
   assert.equal(await page.$eval('#project-open',e=>e.hidden),true,'no Project control while it is off');
   settings.projects=true;
   await page.evaluate(()=>fetch('/api/board/reset',{method:'POST'}));
   await page.goto(base+'/#/projects');await page.waitForSelector('.project-item');
   const list=await page.evaluate(()=>({groups:[...document.querySelectorAll('.project-group h2')].map(h=>h.textContent.replace(/\s+/g,' ').trim()),done:document.querySelector('details.project-group')?.open,chip:document.querySelector('[data-view-link]')?.textContent,tab:document.querySelector('.open-session.current a')?.textContent,badge:document.querySelector('[data-projects-badge]')?.textContent,switchOn:document.querySelector('[data-rail-view="projects"]')?.getAttribute('aria-pressed'),first:document.querySelector('.project-item .title')?.textContent}));
   assert.deepEqual(list.groups,['Active 2','Waiting 1','Done 1']);assert.equal(list.done,false,'finished projects start collapsed');
   assert.equal(list.chip,'Scheduled · 1 due');assert.equal(list.tab,'Projects','the list is a tab like a session');assert.equal(list.badge,'1','due count on the rail switch');assert.equal(list.switchOn,'false');
   assert.equal(list.first,'Warehouse stock report','the project with a due reminder comes first');
   await scan('projects-list-desktop');await page.screenshot({path:path.join(out,'projects-list-desktop.png')});
   // The card: steps, a reminder on a step that ends with the step, a new step, a reminder for the project, finish and resume.
   await clickControl(page,'.project-item a[data-project]');await page.waitForSelector('.project-card');
   const card=async()=>page.evaluate(()=>({title:document.querySelector('#ptitle').textContent,tag:document.querySelector('#ptag').textContent,status:document.querySelector('.project-status').textContent,steps:[...document.querySelectorAll('.task-row')].map(r=>[r.querySelector('.task-label span').textContent,r.classList.contains('completed'),r.querySelector('.task-meta')?.textContent||'']),reminders:[...document.querySelectorAll('.reminder-title')].map(e=>e.textContent),sessions:[...document.querySelectorAll('.linked-session .title')].map(e=>e.textContent.trim()),marks:[...document.querySelectorAll('.linked-session .tab-state')].map(e=>e.className),history:Number(document.querySelector('.project-history .summary-meta').textContent),actions:[...document.querySelectorAll('.project-actions .chip')].map(b=>b.textContent),tab:document.querySelector('.open-session.current a')?.textContent}));
   let c=await card();
   assert.equal(c.title,'Warehouse stock report');assert.match(c.tag,/^Active · \/workspaces\/warehouse$/);assert.equal(c.status,'Active');
   assert.deepEqual(c.steps.map(x=>x[1]),[true,false]);assert.match(c.steps[1][2],/^Due /,'the open step carries its due reminder');
   assert.deepEqual(c.reminders,['Recount aisle 4 excluding Friday delivery']);assert.deepEqual(c.sessions,[rows[0].title]);assert.match(c.marks[0],/ember/,'the linked session shows its live status');
   assert.equal(c.tab,'Warehouse stock report','the card is a tab');
   await scan('project-card-desktop');await page.screenshot({path:path.join(out,'project-card-desktop.png')});
   const before=c.history;
   await clickControl(page,'.task-row:not(.completed) input[data-task]');await page.waitForFunction(()=>document.querySelectorAll('.task-row.completed').length===2);
   c=await card();assert.deepEqual(c.reminders,[],'finishing the step stops its reminder');assert.equal(c.history,before+1);
   await page.type('[data-task-add] input','Post the inventory adjustment');await page.keyboard.press('Enter');
   await page.waitForFunction(()=>document.querySelectorAll('.task-row').length===3);c=await card();assert.deepEqual(c.steps[2],['Post the inventory adjustment',false,'']);
   await clickControl(page,'[data-remind]');await page.waitForSelector('.sheet [data-pick="tomorrow"]');
   const picks=await page.$$eval('.sheet [data-pick]',els=>els.map(e=>e.textContent.replace(/\s+/g,' ').trim()));assert.equal(picks.length,4);assert.match(picks[0],/^Tomorrow morning/);
   await clickControl(page,'.sheet [data-pick="tomorrow"]');await page.waitForFunction(()=>document.querySelectorAll('.reminder-title').length===1);
   c=await card();assert.deepEqual(c.reminders,['Revisit Warehouse stock report']);
   await clickControl(page,'[data-finish]');await page.waitForSelector('.sheet [data-yes]');await clickControl(page,'.sheet [data-yes]');
   await page.waitForFunction(()=>document.querySelector('.project-status')?.textContent==='Done');
   c=await card();assert.deepEqual(c.reminders,[],'finishing stops the reminders');assert.deepEqual(c.actions,['Resume project']);assert.equal(await page.$('[data-task-add]'),null,'a finished card takes no new steps');
   await clickControl(page,'[data-resume]');await page.waitForFunction(()=>document.querySelector('.project-status')?.textContent==='Active');
   c=await card();assert.deepEqual(c.reminders,[],'resuming does not restore them');assert.deepEqual(c.actions,['Start conversation','Edit','Remind me','Finish project']);
   // 1.49 Start session: a New session in the project's directory, briefed on the card and linked to the project when it starts.
   await page.evaluate(async()=>{const act=b=>fetch('/api/board/act',{method:'POST',body:JSON.stringify({project:'warehouse-stock-report',...b})});await act({action:'note',text:'MOM shows the Friday delivery twice.'});await act({action:'remind',at:new Date(Date.now()+86400000).toISOString(),text:'Revisit Warehouse stock report'});});
   await page.reload();await page.waitForSelector('.project-card [data-start]');
   await clickControl(page,'.project-card [data-start]');await page.waitForSelector('#first');await page.waitForFunction(()=>document.querySelector('#plist .row.sel')&&!document.querySelector('#new-project').hidden);
   const brief=await page.$eval('#first',e=>e.value);
   assert.match(brief,/^Pick up the project "Warehouse stock report" where it left off\.\n\nWhere we left off: Counts for aisles 1-3/);
   assert.match(brief,/\nNext step: Recount aisle 4 with the Friday delivery excluded/);
   assert.match(brief,/\nRemaining steps \(2 of 3 done\):\n- Post the inventory adjustment \(step [0-9a-f]{12}\)\n/);
   assert.match(brief,/\nRecent notes:\n- .+: MOM shows the Friday delivery twice\.\n/);assert.match(brief,/\nReminders:\n- Revisit Warehouse stock report/);
   assert.match(brief,new RegExp('Earlier conversations on this project, newest last:\\n- Warehouse stock report \\(Claude conversation '+rows[0].id+'\\)'));
   assert.match(brief,/\(Pocket project warehouse-stock-report; this conversation is linked to it\..*pocket-board update -p warehouse-stock-report/);
   assert.equal(await page.$eval('#plist .row.sel',e=>e.dataset.p),'/workspaces/warehouse','Start picks the project\'s directory');
   assert.equal(await page.$eval('#new-project',e=>e.textContent),'Warehouse stock report','the New session names the project it will join');
   await scan('project-start-desktop');await page.screenshot({path:path.join(out,'project-start-desktop.png')});
   const sentBefore=received.length;await clickControl(page,'#start');await page.waitForFunction(()=>location.hash.startsWith('#/chat/'));
   assert.equal(received.length,sentBefore+1);assert.equal(received.at(-1).project,'warehouse-stock-report','the start carries the project');assert.equal(received.at(-1).cwd,'/workspaces/warehouse');
   const newId=await page.evaluate(()=>location.hash.slice(7));
   assert.equal(await page.evaluate(()=>localStorage.getItem('pc-new-start')),null,'the link is used once');
   await page.goto(base+'/#/projects/warehouse-stock-report');await page.waitForSelector('.project-card');
   assert.ok((await page.evaluate(()=>projectById('warehouse-stock-report').sessions)).includes(newId),'the card lists the new session');
   // The link can be removed before starting; then the start carries no project.
   await clickControl(page,'.project-card [data-start]');await page.waitForSelector('#new-project:not([hidden])');
   await clickControl(page,'#new-project');await page.waitForSelector('.sheet [data-yes]');await clickControl(page,'.sheet [data-yes]');
   await page.waitForFunction(()=>document.querySelector('#new-project').hidden);assert.equal(await page.evaluate(()=>localStorage.getItem('pc-new-start')),null);
   await page.evaluate(()=>{clearDraft(NEW_KEY);localStorage.removeItem('pc-lastproj');});
   await page.goto(base+'/#/projects/warehouse-stock-report');await page.waitForSelector('.project-card');
   // Track a project from a session: the editor takes the session's workspace, the card links the session.
   await openChat(rows[4].id);await page.waitForFunction(()=>document.querySelector('#project-open')?.hidden===false);
   assert.equal(await page.$eval('#project-open',e=>e.textContent),'Add project','the conversation offers Add project (1.36 wording)');
   assert.equal(await page.$eval('#project-open',e=>Boolean(e.closest('#tbar'))),true,'1.35: Add to project is a chip in the message toolbar');
   await (await page.$('#comp')).screenshot({path:path.join(out,'composer-project-chip.png')});
   await clickControl(page,'#project-open');await page.waitForSelector('.sheet [data-v="__new"]');await page.keyboard.press('Escape');
   await clickControl(page,'#chatmore');await page.waitForSelector('#so-project');await clickControl(page,'#so-project');
   await page.waitForSelector('.sheet [data-v="__new"]');
   const choices=await page.$$eval('.sheet .opt',els=>els.map(e=>e.dataset.v));assert.deepEqual(choices.slice(0,1),['__new']);assert.ok(choices.length>=3,'open projects are offered');
   await clickControl(page,'.sheet [data-v="__new"]');await page.waitForSelector('.project-editor');
   assert.equal(await page.$eval('.project-editor [name=directory]',e=>e.value),rows[4].cwd);
   await page.type('.project-editor [name=name]','Purchasing review');await clickControl(page,'.project-editor .primary');
   await page.waitForFunction(()=>location.hash==='#/projects/purchasing-review'&&document.querySelector('.project-card'));
   c=await card();assert.equal(c.title,'Purchasing review');assert.deepEqual(c.sessions,[rows[4].title]);
   await openChat(rows[4].id);await page.waitForFunction(()=>document.querySelector('#project-open')?.textContent==='Purchasing review');
   await clickControl(page,'#project-open');await page.waitForFunction(()=>location.hash==='#/projects/purchasing-review');await page.waitForSelector('.project-card');assert.match(c.tag,new RegExp(rows[4].cwd.replace(/[/]/g,'\\/')+'$'));
   // Tabs: project tabs sit beside sessions; closing the current one moves to its neighbour; Alt ] cycles through them.
   let tabs=await page.$$eval('#open-sessions .open-session a',els=>els.map(e=>e.textContent));
   assert.ok(tabs.includes('Projects')&&tabs.includes('Warehouse stock report')&&tabs.includes('Purchasing review'),'project tabs: '+tabs.join(' | '));
   await page.keyboard.down('Alt');await page.keyboard.press(']');await page.keyboard.up('Alt');await sleep(300);
   assert.notEqual(await page.evaluate(()=>location.hash),'#/projects/purchasing-review','Alt ] moved to another tab');
   await page.goto(base+'/#/projects/purchasing-review');await page.waitForSelector('.project-card');
   await clickControl(page,'[data-close-session="projects/purchasing-review"]');await page.waitForFunction(()=>location.hash!=='#/projects/purchasing-review'&&!document.querySelector('[data-close-session="projects/purchasing-review"]'));
   tabs=await page.$$eval('#open-sessions .open-session a',els=>els.map(e=>e.textContent));assert.ok(!tabs.includes('Purchasing review'));
   // Split: a project view beside a conversation; the pane is a full Pocket instance on that route.
   await openChat(rows[4].id);await clickControl(page,'#splitb');await page.waitForSelector('.sheet [data-v="projects/scheduled"]');
   await clickControl(page,'.sheet [data-v="projects/scheduled"]');await page.waitForSelector('#panes iframe');
   const pane=await page.$eval('#panes iframe',f=>({src:f.getAttribute('src'),title:f.title}));assert.match(pane.src,/#\/projects\/scheduled$/);assert.equal(pane.title,'Conversation beside: Scheduled');
   const frame=page.frames().find(f=>f.url().includes('#/projects/scheduled'));await frame.waitForSelector('.reminder-item');
   assert.equal(await frame.$eval('#ptitle',e=>e.textContent),'Scheduled');
   await scan('projects-split-desktop');await page.screenshot({path:path.join(out,'projects-split-desktop.png')});
   await frame.click('#pane-close');await page.waitForFunction(()=>!document.querySelector('#panes iframe'));
   // The rail switch: project rows in the rail open as a tab, or beside when this browser says so.
   await clickControl(page,'[data-rail-view="projects"]');await page.waitForSelector('#rail .rail-projects .project-item');
   assert.equal(await page.$eval('#rail-filter-toggle',e=>e.hidden),true,'session filters hide with the project list');
   await clickControl(page,'#rail .project-item a[data-project]');await page.waitForFunction(()=>location.hash.startsWith('#/projects/')&&document.querySelector('.project-card'));
   await page.evaluate(()=>localStorage.setItem('pc-projects-open',JSON.stringify('beside')));
   await openChat(rows[4].id);await page.waitForSelector('#rail .rail-projects .project-item');
   await clickControl(page,'#rail .project-item a[data-project]');await page.waitForSelector('#panes iframe');
   assert.match(await page.$eval('#panes iframe',f=>f.getAttribute('src')),/#\/projects\//,'beside: the card opens in a pane');
   await page.evaluate(()=>localStorage.setItem('pc-projects-open',JSON.stringify('tab')));
   await page.evaluate(()=>{document.querySelector('#panes iframe')&&closePane(splitPanes[0].key);});
   // Settings → Projects & documents turns the feature off and on for the whole install.
   await clickControl(page,'#railsettings');await page.waitForFunction(()=>document.querySelector('#s-projects')?.disabled===false);
   assert.equal(await page.$eval('#s-projects',e=>e.getAttribute('aria-pressed')),'true');
   await clickControl(page,'#s-projects');for(let i=0;i<30&&settings.projects;i++)await sleep(100);
   assert.equal(settings.projects,false,'the server setting changed');
   await page.goto(base+'/#/');await page.waitForSelector('.session-home');assert.equal(await page.$('[data-projects-home]'),null,'the home chip is gone while off');
   settings.projects=true;await clickControl(page,'[data-rail-view="sessions"]').catch(()=>{});
   // Phone: full-screen views, the home chip, no overflow.
   await page.setViewport({width:390,height:844});
   await page.evaluate(()=>fetch('/api/board/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'remind',project:'camera-ordering-review',at:new Date(Date.now()-60000).toISOString(),text:'Chase the revised quote'})})); // one due reminder for the badge
   await page.goto(base+'/?phone=1#/');await page.waitForSelector('[data-projects-home]'); // a fresh load picks up the restored setting
   await page.waitForFunction(()=>document.querySelector('[data-projects-home]')?.textContent==='Projects · 1 due');
   for(const [hash,sel] of [['#/projects','.project-item'],['#/projects/warehouse-stock-report','.project-card'],['#/projects/scheduled','.reminder-item']]){
    await page.goto(base+'/'+hash);await page.waitForSelector(sel);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at 390: '+hash);
    assert.equal(await page.evaluate(()=>Boolean(document.querySelector('aside.rail')?.getClientRects().length)),false,'the rail is not shown on the phone');
   }
   await page.goto(base+'/#/projects/warehouse-stock-report');await page.waitForSelector('.project-card');
   await scan('project-card-phone');await page.screenshot({path:path.join(out,'project-card-phone.png')});
   await page.setViewport({width:1440,height:900});
  });

  await check('Documents (1.30): off by default, then the library, a sandboxed HTML document, Markdown and CSV views, sharing, keep from Results, the project section, tabs, split, rail, settings and the phone',async()=>{
   await page.setViewport({width:1440,height:900});const sleep=ms=>new Promise(r=>setTimeout(r,ms));
   const settings=settingsState();settings.documents=false;settings.projects=true;
   await page.evaluate(()=>fetch('/api/board/reset',{method:'POST'}));
   await page.goto(base+'/#/documents');await page.waitForFunction(()=>/Files is off/.test(document.querySelector('#documents-main')?.textContent||''));
   assert.equal(await page.$('[data-rail-view="documents"]'),null,'no Files segment while off');
   settings.documents=true;await page.evaluate(()=>fetch('/api/documents/reset',{method:'POST'}));
   await page.evaluate(()=>localStorage.setItem('pc-documents-layout','"list"')); // 1.32: the wide default is the grid; these checks read the rows
   await page.goto(base+'/?docs=1#/documents');await page.waitForSelector('.document-item');
   const lib=await page.evaluate(()=>({rows:[...document.querySelectorAll('.document-item .title')].map(e=>e.textContent.trim()),kinds:[...document.querySelectorAll('.document-item .doc-kind')].map(e=>e.textContent),tab:document.querySelector('.open-session.current a')?.textContent,seg:document.querySelector('[data-rail-view="documents"]')?.textContent,where:document.querySelector('.document-item .meta')?.textContent}));
   assert.deepEqual(lib.kinds.sort(),['CSV','HTML','MD']);assert.equal(lib.tab,'Files','the library is a tab');assert.equal(lib.seg,'Files');
   await scan('documents-list-desktop');await page.screenshot({path:path.join(out,'documents-list-desktop.png')});
   // Search narrows the list without losing the keyboard.
   await page.type('#doc-query','weekly');await page.waitForFunction(()=>document.querySelectorAll('.document-item').length===1);assert.equal(await page.evaluate(()=>document.activeElement.id),'doc-query');
   await page.evaluate(()=>{document.querySelector('#doc-query').value='';});await page.evaluate(()=>{docQuery='';});
   // 1.31: visibility and kind filters, badges, the grouped options sheet, the share address of a private document, a solo window.
   await page.goto(base+'/#/documents');await page.waitForSelector('.document-item');
   assert.deepEqual(await page.$$eval('.doc-filters [data-vis]',els=>els.map(e=>e.textContent.replace(/\s+/g,' ').trim())),['All 3','Private 3','Link 0','Public 0']);
   assert.deepEqual(await page.$$eval('.document-item .doc-vis',els=>els.map(e=>e.textContent)),['Private','Private','Private']);
   await page.select('#doc-kind','text');await page.waitForFunction(()=>document.querySelectorAll('.document-item').length===1);
   assert.match(await page.$eval('.document-group h2',e=>e.textContent.replace(/\s+/g,' ')),/^Markdown and text 1 of 3$/);
   await clickControl(page,'#doc-clear');await page.waitForFunction(()=>document.querySelectorAll('.document-item').length===3);
   await clickControl(page,'.document-item [data-document-more]');await page.waitForSelector('.sheet [data-window]');
   assert.equal(await page.$('.sheet [data-copy-link]'),null,'no Copy link while private');
   assert.equal(await page.$eval('.sheet a.opt',e=>getComputedStyle(e).textDecorationLine),'none','a link row is styled like the other rows');
   assert.deepEqual(await page.$$eval('.sheet .opt-group',els=>els.map(e=>e.getAttribute('aria-label'))),['Open','Share','Organize']);
   await clickControl(page,'.sheet [data-share]');await page.waitForSelector('.share-sheet #share-url');
   assert.match(await page.$eval('#share-url',e=>e.value),/\/#\/documents\/[0-9a-f]{12}$/,'a private document shows its in-app address');
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));
   const soloId=await page.evaluate(()=>docsSnap.documents.find(d=>d.kind==='md').id);
   await page.goto(base+'/?solo=1#/documents/'+soloId);await page.waitForSelector('.doc-md');
   assert.equal(await page.$('aside.rail'),null,'a solo window has no rail');assert.equal(await page.$('#open-sessions'),null,'nor a tab strip');
   assert.equal(await page.$('#back'),null);assert.equal(await page.$('#dwin'),null);assert.equal(await page.title(),'Weekly summary · Pocket Code');
   await page.goto(base+'/?solo=1#/projects/warehouse-stock-report');await page.waitForSelector('.project-card');
   assert.equal(await page.$('aside.rail'),null);assert.equal(await page.$('#pwin'),null);assert.equal(await page.title(),'Warehouse stock report · Pocket Code');
   // 1.32: the grid of previews on a wide screen: a picture for the HTML report, the kind for the CSV, the choice remembered.
   await page.evaluate(()=>localStorage.removeItem('pc-documents-layout'));
   await page.goto(base+'/#/documents');await page.waitForSelector('.doc-card');
   assert.equal(await page.$eval('.doc-layout [data-layout="grid"]',e=>e.getAttribute('aria-pressed')),'true','the grid is the wide default');
   await page.waitForFunction(()=>document.querySelector('.doc-thumb.loaded img'));
   const cards=await page.$$eval('.doc-card',els=>els.map(c=>({kind:c.querySelector('.doc-kind').textContent,pic:Boolean(c.querySelector('.doc-thumb.loaded img')),title:c.querySelector('.doc-card-title').textContent})));
   assert.ok(cards.find(c=>c.kind==='HTML')?.pic,'the HTML report has a picture: '+JSON.stringify(cards));assert.equal(cards.find(c=>c.kind==='CSV')?.pic,false,'the CSV shows its kind');
   assert.equal(await page.$eval('.doc-card img',e=>e.getAttribute('loading')),'lazy');
   await scan('documents-grid-desktop');await page.screenshot({path:path.join(out,'documents-grid-desktop.png')});
   await clickControl(page,'.doc-card [data-document-more]');await page.waitForSelector('.sheet [data-window]');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));
   await clickControl(page,'.doc-layout [data-layout="list"]');await page.waitForSelector('.document-item');assert.equal(await page.$('.doc-card'),null);
   await page.goto(base+'/#/documents');await page.waitForSelector('.document-item');assert.equal(await page.$('.doc-card'),null,'the list choice is remembered');
   // The HTML document renders in a sandboxed frame that cannot reach the app.
   await page.goto(base+'/#/documents');await page.waitForSelector('.document-item');
   const htmlRow=await page.$eval('.document-item .doc-kind',()=>null,[]).catch(()=>null);
   await page.evaluate(()=>{const a=[...document.querySelectorAll('.document-item')].find(r=>r.querySelector('.doc-kind').textContent==='HTML').querySelector('a');a.click();});
   await page.waitForSelector('iframe.doc-frame');
   const frame=await (await page.$('iframe.doc-frame')).contentFrame();await frame.waitForFunction(()=>/Sandboxed|isolated|REACHED/.test(document.getElementById('probe')?.textContent||''));
   const probe=await frame.$eval('#probe',e=>e.textContent);assert.match(probe,/^Sandboxed: SecurityError|isolated/,'the document\'s script cannot reach Pocket: '+probe);
   assert.equal(await page.$eval('iframe.doc-frame',f=>f.getAttribute('sandbox')),'allow-scripts allow-popups allow-downloads allow-forms');
   const tag=await page.$eval('#dtag',e=>e.textContent);assert.match(tag,/^HTML · /);assert.match(tag,/Private$/);
   const tools=await page.$$eval('.doc-tools .chip',els=>els.map(e=>[e.textContent,e.getAttribute('href')||'',e.getAttribute('download')||'',e.getAttribute('target')||'']));
   assert.equal(tools[0][0],'Open in your viewer');assert.match(tools[0][1],/\/api\/documents\/[0-9a-f]{12}\/raw$/);assert.equal(tools[0][3],'_blank');assert.equal(tools[1][0],'Download');assert.match(tools[1][1],/raw\?download=1$/);assert.equal(tools[1][2],'ops-dashboard.html');
   await scan('document-html-desktop');await page.screenshot({path:path.join(out,'document-html-desktop.png')});
   // Share: private → link (URL shown, copy), expiry, new link, → public, → private revokes. Coming back from a share
   // link restores the page from the back-forward cache with the sheet still open, as a browser would; close it first.
   const back=async()=>{await page.goBack();await page.waitForSelector('.doc-tools');if(await page.$('.scrim')){await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));}};
   await clickControl(page,'.doc-tools [data-share]');await page.waitForSelector('.share-sheet');
   await clickControl(page,'.share-sheet [data-v="link"]');await page.waitForSelector('.share-sheet #share-url');
   const shareUrl=await page.$eval('#share-url',e=>e.value);assert.match(shareUrl,new RegExp('^'+base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/share/[A-Za-z0-9_-]{40,}$'));
   const shared=await page.goto(shareUrl);assert.equal(shared.status(),200);assert.match(shared.headers()['content-security-policy'],/frame-ancestors 'none'/);
   await back();await clickControl(page,'.doc-tools [data-share]');await page.waitForSelector('.share-sheet [data-reshare]');
   await clickControl(page,'.share-sheet [data-reshare]');await page.waitForSelector('.share-sheet #share-url');const shareUrl2=await page.$eval('#share-url',e=>e.value);assert.notEqual(shareUrl2,shareUrl);
   assert.equal((await page.goto(shareUrl)).status(),404,'the old link no longer works');await back();
   await clickControl(page,'.doc-tools [data-share]');await page.waitForSelector('.share-sheet');await clickControl(page,'.share-sheet [data-v="public"]');await page.waitForFunction(()=>/\/files\//.test(document.querySelector('#share-url')?.value||''));
   const pubUrl=await page.$eval('#share-url',e=>e.value);assert.match(pubUrl,/\/files\/ops-dashboard\.html$/);assert.equal((await page.goto(pubUrl)).status(),200);await back();
   await clickControl(page,'.doc-tools [data-share]');await page.waitForSelector('.share-sheet');await clickControl(page,'.share-sheet [data-v="private"]');await page.waitForFunction(()=>!document.querySelector('.share-sheet'));
   assert.equal((await page.goto(pubUrl)).status(),404,'private again');await back();
   // Markdown and CSV render natively.
   await page.goto(base+'/#/documents');await page.waitForSelector('.document-item');
   await page.evaluate(()=>{[...document.querySelectorAll('.document-item')].find(r=>r.querySelector('.doc-kind').textContent==='MD').querySelector('a').click();});
   await page.waitForSelector('.doc-md strong');assert.equal(await page.$eval('.doc-md strong',e=>e.textContent),'reconciled');assert.equal(await page.$eval('#dtitle',e=>e.textContent),'Weekly summary');
   assert.equal(await page.$eval('.doc-tools [data-project]',e=>e.textContent),'Warehouse stock report','the document shows its project');assert.ok(await page.$('.doc-tools a[href^="#/chat/"]'),'and its session');
   await page.goto(base+'/#/documents');await page.waitForSelector('.document-item');
   await page.evaluate(()=>{[...document.querySelectorAll('.document-item')].find(r=>r.querySelector('.doc-kind').textContent==='CSV').querySelector('a').click();});
   await page.waitForSelector('.doc-table tbody tr');assert.deepEqual(await page.$$eval('.doc-table th',els=>els.map(e=>e.textContent)),['Aisle','On hand','Incoming']);
   // Keep as document from a session's Results.
   await openChat(rows[0].id);await clickControl(page,'#results-open');await page.waitForSelector('[data-keep]');
   assert.equal(await page.$eval('[data-keep]',e=>e.textContent),'Keep in Files');
   await clickControl(page,'[data-keep]');await page.waitForFunction(()=>document.querySelector('[data-kept]'));
   assert.equal(await page.$eval('[data-kept]',e=>e.textContent),'Kept · Open');await page.keyboard.press('Escape');
   // The project card lists its documents.
   await page.goto(base+'/#/projects/warehouse-stock-report');await page.waitForSelector('.project-documents .document-item');
   const pdocs=await page.$$eval('.project-documents .document-item .title',els=>els.map(e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim()));assert.ok(pdocs.includes('Weekly summary'),pdocs.join('|'));assert.ok(pdocs.includes('Kept from a session'),pdocs.join('|'));
   // Tabs and split.
   let tabs=await page.$$eval('#open-sessions .open-session a',els=>els.map(e=>e.textContent));assert.ok(tabs.includes('Files')&&tabs.includes('Weekly summary'),tabs.join('|'));
   await openChat(rows[4].id);await page.evaluate(()=>{docsSnap=null;}); // 1.32.1: as on a fresh page, the list is fetched before the chooser opens
   await clickControl(page,'#splitb');await page.waitForSelector('.sheet [data-v^="documents/"]');
   const offered=await page.$$eval('.sheet [data-v^="documents/"]',els=>els.map(e=>e.textContent.replace(/\s+/g,' ').trim()));
   assert.ok(offered.some(t=>/^Weekly summary/.test(t)),'1.31.1: the chooser offers the open document tab: '+offered.join('|'));assert.ok(offered.length>=3,'and the recent documents');
   await clickControl(page,'.sheet [data-v="documents"]');
   await page.waitForSelector('#panes iframe');assert.match(await page.$eval('#panes iframe',f=>f.getAttribute('src')),/#\/documents$/);assert.equal(await page.$eval('#panes iframe',f=>f.title),'Conversation beside: Files');
   const pane=page.frames().find(f=>f.url().includes('#/documents'));await pane.waitForSelector('.document-item');await pane.click('#pane-close');await page.waitForFunction(()=>!document.querySelector('#panes iframe'));
   // Rail: Docs segment lists documents; the Project control is unaffected.
   await clickControl(page,'[data-rail-view="documents"]');await page.waitForSelector('#rail .rail-documents .document-item');
   assert.equal(await page.$eval('#rail-filter-toggle',e=>e.hidden),true);
   // 1.35: the panel says where the library opens; no setting decides behind an "All files" label.
   assert.deepEqual(await page.$$eval('#rail .rail-documents .rail-project-actions .chip',els=>els.map(e=>e.textContent.trim())),['Upload','Split','Tab']);
   assert.deepEqual(await page.$$eval('[data-open-library]',els=>els.map(e=>e.getAttribute('aria-label'))),['Open the file library in split view','Open the file library in a tab']);
   await (await page.$('aside.rail')).screenshot({path:path.join(out,'rail-files-actions.png')});
   // 1.37.2: a split pane is a narrow frame on a desktop, so it keeps the grid of previews instead of falling back to the phone's list.
   await page.evaluate(()=>writeLocal('pc-documents-layout','grid'));
   await clickControl(page,'[data-open-library="beside"]');await page.waitForSelector('#panes iframe');assert.match(await page.$eval('#panes iframe',f=>f.getAttribute('src')),/#\/documents$/);
   {const gridPane=page.frames().find(f=>f.url().includes('#/documents'));await gridPane.waitForSelector('.doc-card');await gridPane.waitForFunction(()=>document.querySelector('.doc-thumb.loaded img'));
    const g=await gridPane.evaluate(()=>({w:innerWidth,cols:getComputedStyle(document.querySelector('.doc-grid')).gridTemplateColumns.split(' ').length,toggle:getComputedStyle(document.querySelector('.doc-layout')).display}));
    assert.ok(g.w<700,'the pane is narrower than the phone breakpoint: '+g.w);assert.ok(g.cols>=2,'two or more columns of previews in the pane: '+JSON.stringify(g));assert.notEqual(g.toggle,'none','the layout switch shows in a pane');
    await page.screenshot({path:path.join(out,'documents-grid-pane.png')});}
   await page.evaluate(()=>writeLocal('pc-documents-layout','list'));
   // 1.53.3: with files set to open beside, a file chosen inside the library pane gets a new pane to the pane's left; the library stays.
   await check('A file opened from the library pane gets its own pane to the left',async()=>{
    const vp=page.viewport();await page.setViewport({width:2560,height:900});await pause(150);
    await page.evaluate(()=>writeLocal('pc-documents-open','beside'));
    const lib=page.frames().find(f=>f.url().includes('#/documents'));await lib.waitForSelector('a[data-document]');
    const libKey=await page.$eval('#panes .split-pane',e=>e.dataset.key);
    await lib.click('a[data-document]');
    await page.waitForFunction(()=>document.querySelectorAll('#panes .split-pane').length===2);
    const panes=await page.$$eval('#panes .split-pane',els=>els.map(e=>({key:e.dataset.key,src:e.querySelector('iframe').getAttribute('src'),left:e.getBoundingClientRect().left,hidden:e.hidden})));
    assert.equal(panes[1].key,libKey,'the library pane keeps its frame and place: '+JSON.stringify(panes));
    assert.match(panes[0].src,/#\/documents\/[0-9a-f]{12}$/,'the file opened in the new pane: '+JSON.stringify(panes));
    assert.ok(!panes[0].hidden&&!panes[1].hidden&&panes[0].left<panes[1].left,'and it sits to the left of the library: '+JSON.stringify(panes));
    assert.equal(await lib.evaluate(()=>location.hash),'#/documents','the library pane still shows the library');
    await lib.click('[data-document-more]');await lib.waitForSelector('.sheet [data-beside]');
    assert.equal(await lib.$eval('.sheet [data-beside] .sub',e=>e.textContent),'In a new pane to the left of this one','the pane\'s option sheet offers it too');
    await lib.evaluate(()=>closeCurrentSheet?.());await lib.waitForFunction(()=>!document.querySelector('.sheet'));
    await page.screenshot({path:path.join(out,'documents-pane-opens-left.png')});
    const filePane=page.frames().find(f=>/#\/documents\/[0-9a-f]{12}$/.test(f.url()));await filePane.waitForSelector('#pane-close');await filePane.click('#pane-close');
    await page.waitForFunction(()=>document.querySelectorAll('#panes .split-pane').length===1);
    assert.equal(await page.$eval('#panes .split-pane',e=>e.dataset.key),libKey);
    await page.evaluate(()=>writeLocal('pc-documents-open','tab'));await page.setViewport(vp);await pause(150);
   });
   // 1.54.1: a link in the conversation to one of your files opens the way files do (beside, as a tab); an outside website is left to the browser.
   await check('A link in the conversation to one of your files opens like a file; an outside site goes to the browser',async()=>{
    const vp=page.viewport();await page.setViewport({width:2560,height:900});await pause(150);
    const was=await page.evaluate(()=>location.hash),chat=rows[0].id;await openChat(chat); // its last message links a kept file; its report links example.com
    const fileLink='#msgs .m-asst a[href*="#/documents/"]',outside='#msgs .m-asst a[href="https://example.com/inventory"]';await page.waitForSelector(fileLink);await page.waitForSelector(outside);
    await page.evaluate(()=>writeLocal('pc-documents-open','beside'));
    await page.click(fileLink);
    await page.waitForFunction(()=>document.querySelectorAll('#panes .split-pane').length===2);
    const srcs=await page.$$eval('#panes .split-pane iframe',els=>els.map(e=>e.getAttribute('src')));
    assert.ok(srcs.some(s=>/#\/documents\/[0-9a-f]{12}$/.test(s)),'the file opened in a pane: '+srcs.join('|'));
    assert.equal(await page.evaluate(()=>location.hash),'#/chat/'+chat,'the conversation stayed in the main column');
    const filePane=page.frames().find(f=>/#\/documents\/[0-9a-f]{12}$/.test(f.url()));await filePane.waitForSelector('.doc-md strong');
    assert.equal(await filePane.$eval('#dtitle',e=>e.textContent),'Weekly summary');
    await page.screenshot({path:path.join(out,'link-file-beside.png')});
    await filePane.click('#pane-close');await page.waitForFunction(()=>document.querySelectorAll('#panes .split-pane').length===1);
    // As a tab: the file takes this column, and Back returns to the conversation.
    await page.evaluate(()=>writeLocal('pc-documents-open','tab'));
    await page.click(fileLink);await page.waitForFunction(()=>/^#\/documents\/[0-9a-f]{12}$/.test(location.hash));await page.waitForSelector('.doc-md strong');
    assert.equal(await page.$eval('#dtitle',e=>e.textContent),'Weekly summary');
    assert.equal(await page.$eval('#back',e=>e.getAttribute('aria-label')),'Back to conversation');
    await page.evaluate(()=>document.querySelector('#back').click()); // the Back control is for the phone; on a desktop the rail is the way back
    await page.waitForFunction(id=>location.hash==='#/chat/'+id&&document.querySelector('#msgs .m-asst a'),{},chat);
    // An outside website is the browser's under every setting, and so is a modified click on anything.
    for(const pref of ['tab','beside','window']){
     await page.evaluate(p=>writeLocal('pc-documents-open',p),pref);
     const left=await page.evaluate(sel=>{const a=document.querySelector(sel);const e=new MouseEvent('click',{bubbles:true,cancelable:true,button:0});return [openLinkPreferred(a,e),e.defaultPrevented,document.querySelectorAll('#panes .split-pane').length,location.hash];},outside);
     assert.deepEqual(left,[false,false,1,'#/chat/'+chat],pref+': the outside link is left to the browser');
    }
    await page.evaluate(()=>writeLocal('pc-documents-open','beside'));
    const ctrl=await page.evaluate(sel=>{const a=document.querySelector(sel);const e=new MouseEvent('click',{bubbles:true,cancelable:true,button:0,ctrlKey:true});return [openLinkPreferred(a,e),e.defaultPrevented,document.querySelectorAll('#panes .split-pane').length];},fileLink);
    assert.deepEqual(ctrl,[false,false,1]);
    await page.evaluate(()=>writeLocal('pc-documents-open','tab'));await page.setViewport(vp);await pause(150);
    await page.evaluate(h=>{location.hash=h;},was);await page.waitForFunction(h=>location.hash===h,{},was);
   });
   await page.frames().find(f=>f.url().includes('#/documents')).waitForSelector('#pane-close');await page.frames().find(f=>f.url().includes('#/documents')).click('#pane-close');await page.waitForFunction(()=>!document.querySelector('#panes iframe'));
   await clickControl(page,'[data-rail-view="sessions"]');await page.waitForSelector('#rail .session-panel');
   // Settings → Files button: open the library in a tab straight from the Files segment.
   await page.evaluate(()=>writeLocal('pc-files-button','tab'));const backTo=await page.evaluate(()=>location.hash);
   await clickControl(page,'[data-rail-view="documents"]');await page.waitForFunction(()=>location.hash==='#/documents');
   assert.equal(await page.evaluate(()=>readLocal('pc-rail-view','sessions')),'sessions','the sidebar keeps its list');
   // 1.76.2: the rail keeps Chats pressed, and Files is marked as what the main area shows
   await page.waitForFunction(()=>document.querySelector('[data-rail-view="documents"]')?.getAttribute('aria-current')==='page');
   assert.equal(await page.$eval('[data-rail-view="sessions"]',b=>b.getAttribute('aria-pressed')+'/'+b.getAttribute('aria-current')),'true/null');
   await page.evaluate(h=>{writeLocal('pc-files-button','rail');location.hash=h;},backTo);await page.waitForSelector('#rail .session-panel');
   // Settings → Projects & documents.
   await clickControl(page,'#railsettings');await page.waitForFunction(()=>document.querySelector('#s-documents')?.disabled===false);
   assert.equal(await page.$eval('#s-documents',e=>e.getAttribute('aria-pressed')),'true');await page.keyboard.press('Escape');
   // Trash and restore from the library.
   await page.goto(base+'/#/documents');await page.waitForSelector('.document-item');
   await clickControl(page,'.document-item [data-document-more]');await page.waitForSelector('.sheet [data-trash]');await clickControl(page,'.sheet [data-trash]');await page.waitForSelector('.sheet [data-yes]');await clickControl(page,'.sheet [data-yes]');
   await page.waitForSelector('details.document-group [data-restore]');await clickControl(page,'details.document-group summary');await clickControl(page,'[data-restore]');await page.waitForFunction(()=>!document.querySelector('[data-restore]'));
   // 1.45: select several files and remove them in one step; Delete forever and Empty trash free the space now.
   {const add=name=>page.evaluate(n=>fetch('/api/documents',{method:'POST',headers:{'x-filename':n},body:'# '+n.slice(0,-3).replace('-',' ')}).then(r=>r.json()),name);
    const scratch=[await add('scratch-one.md'),await add('scratch-two.md'),await add('scratch-three.md')];
    const names=()=>page.$$eval('.doc-pickable .title',els=>els.map(e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim()));
    const pickRow=title=>page.evaluate(t=>{const row=[...document.querySelectorAll('.doc-pickable')].find(r=>r.querySelector('.title,.doc-card-title').textContent.includes(t));row.querySelector('label').click();},title);
    await page.goto(base+'/?bulk=1#/documents');await page.waitForSelector('.document-item');
    await clickControl(page,'#doc-select');await page.waitForSelector('.doc-selectbar');
    assert.equal(await page.$eval('#doc-select',e=>[e.getAttribute('aria-pressed'),e.textContent.trim()].join()),'true,Done');assert.equal(await page.$('#doc-upload'),null,'Upload steps aside while selecting');
    assert.equal(await page.$('.doc-pickable a, .doc-pickable [data-document-more]'),null,'a picked row has no link or options');
    assert.equal(await page.$eval('#doc-pick-remove',e=>e.disabled),true);assert.equal(await page.$eval('.doc-selectcount',e=>e.textContent),'Select files to remove');
    await pickRow('scratch one');await pickRow('scratch two');
    assert.equal(await page.$eval('.doc-selectcount',e=>e.textContent),'2 files selected');assert.equal(await page.$eval('#doc-pick-remove',e=>[e.disabled,e.textContent].join()),'false,Remove 2');
    assert.equal(await page.$$eval('.doc-pickable.picked',els=>els.length),2);
    await scan('documents-select-desktop');await page.screenshot({path:path.join(out,'documents-select-desktop.png')});
    // A search keeps only the picks it shows; Select all takes what is shown.
    await page.type('#doc-query','scratch t');await page.waitForFunction(()=>document.querySelector('.doc-selectcount')?.textContent==='1 file selected');
    assert.deepEqual((await names()).sort(),['scratch three','scratch two']);
    await clickControl(page,'#doc-pick-all');await page.waitForFunction(()=>document.querySelector('.doc-selectcount')?.textContent==='2 files selected');
    assert.equal(await page.$eval('#doc-pick-all',e=>e.textContent),'Clear');
    await clickControl(page,'#doc-pick-remove');await page.waitForSelector('.sheet [data-yes]');
    assert.equal(await page.$eval('.sheet h2',e=>e.textContent),'Remove 2 files?');await clickControl(page,'.sheet [data-yes]');
    await page.waitForFunction(()=>!document.querySelector('.doc-selectbar')&&/Trash 2/.test(document.querySelector('details.doc-trash summary')?.textContent||''));
    assert.deepEqual((await page.evaluate(()=>fetch('/api/documents').then(r=>r.json()))).trash.map(d=>d.title).sort(),['scratch three','scratch two']);
    await page.$eval('#doc-query',e=>{e.value='';e.dispatchEvent(new Event('input'));});await page.waitForFunction(()=>document.querySelectorAll('.document-group:not(.doc-trash) .document-item').length===docsSnap.documents.length&&docsSnap.documents.length>=3);
    // Escape leaves select mode; the picks do not outlive it.
    await clickControl(page,'#doc-select');await page.waitForSelector('.doc-selectbar');await pickRow('scratch one');await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('.doc-selectbar'));assert.equal(await page.evaluate(()=>document.activeElement?.id),'doc-select');
    // The Trash: Restore and options per row; Delete forever asks once, then the file is gone.
    await clickControl(page,'details.doc-trash summary');await page.waitForSelector('#doc-empty-trash');
    await page.evaluate(()=>loadDocs(true).then(paintDocumentsView));assert.equal(await page.$eval('details.doc-trash',e=>e.open),true,'a repaint keeps the Trash open');
    await page.$eval('details.doc-trash',e=>e.scrollIntoView({block:'end'}));await scan('documents-trash-desktop');await page.screenshot({path:path.join(out,'documents-trash-desktop.png')});
    await clickControl(page,'details.doc-trash [data-document-more]');await page.waitForSelector('.sheet [data-destroy]');
    assert.equal(await page.$eval('.sheet [data-destroy]',e=>e.textContent.trim().startsWith('Delete forever')),true);await clickControl(page,'.sheet [data-destroy]');
    await page.waitForFunction(()=>document.querySelector('.sheet h2')?.textContent==='Delete this file forever?');await clickControl(page,'.sheet [data-yes]');
    await page.waitForFunction(()=>/Trash 1/.test(document.querySelector('details.doc-trash summary')?.textContent||''));
    await clickControl(page,'#doc-empty-trash');await page.waitForFunction(()=>document.querySelector('.sheet h2')?.textContent==='Delete 1 file forever?');await clickControl(page,'.sheet [data-yes]');
    await page.waitForFunction(()=>!document.querySelector('details.doc-trash'));
    const after=await page.evaluate(()=>fetch('/api/documents').then(r=>r.json()));assert.equal(after.trash.length,0);assert.deepEqual(after.documents.map(d=>d.title).filter(t=>/scratch/.test(t)),['scratch one']);
    // Grid: a card is a label too, with its checkbox on the picture.
    await page.evaluate(()=>writeLocal('pc-documents-layout','grid'));await page.goto(base+'/?bulk=2#/documents');await page.waitForSelector('.doc-card');
    await clickControl(page,'#doc-select');await page.waitForSelector('.doc-card .doc-card-pick');await pickRow('scratch one');
    assert.equal(await page.$$eval('.doc-card.picked',els=>els.length),1);await scan('documents-select-grid');await page.screenshot({path:path.join(out,'documents-select-grid.png')});
    await page.keyboard.press('Escape');await page.evaluate(()=>writeLocal('pc-documents-layout','list'));
    // Phone: the bar fits at 390 and the trash header stacks.
    await page.setViewport({width:390,height:844});await page.goto(base+'/?bulk=3#/documents');await page.waitForSelector('.document-item');
    await clickControl(page,'#doc-select');await page.waitForSelector('.doc-selectbar');await pickRow('scratch one');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at 390 while selecting');
    await scan('documents-select-phone');await page.screenshot({path:path.join(out,'documents-select-phone.png')});
    await page.keyboard.press('Escape');
    await page.evaluate(id=>fetch('/api/documents/bulk',{method:'POST',body:JSON.stringify({action:'trash',ids:[id]})}),scratch[0].id);await page.evaluate(()=>fetch('/api/documents/trash/empty',{method:'POST'}));
    await page.setViewport({width:1440,height:900});}
   // Phone.
   await page.setViewport({width:390,height:844});
   await page.goto(base+'/?phone=2#/');await page.waitForSelector('a[href="#/documents"].chip');
   for(const [hash,sel] of [['#/documents','.document-item'],['#/documents/'+await page.evaluate(()=>docsSnap?.documents.find(d=>d.kind==='html')?.id||''),'iframe.doc-frame']]){
    if(hash.endsWith('/'))continue;
    await page.goto(base+'/'+hash);await page.waitForSelector(sel);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at 390: '+hash);
   }
   await scan('document-html-phone');await page.screenshot({path:path.join(out,'document-html-phone.png')});
   // The 30 s library poll repaints an open file; it must keep the same frame (a new one reloads the page and scrolls the reader to the top).
   {const htmlId=await page.evaluate(()=>fetch('/api/documents').then(r=>r.json()).then(j=>j.documents.find(d=>d.kind==='html').id));
    await page.goto(base+'/#/documents/'+htmlId);await page.waitForSelector('iframe.doc-frame');}
   await page.evaluate(()=>{document.querySelector('iframe.doc-frame').dataset.keep='1';});
   await page.evaluate(()=>loadDocs(true).then(paintDocumentsView));
   assert.equal(await page.$eval('iframe.doc-frame',e=>e.dataset.keep),'1','a repaint keeps the open document frame');
   await clickControl(page,'#documents-main [data-share]');await page.waitForSelector('.sheet');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.scrim'));
   await page.setViewport({width:1440,height:900});settings.documents=true;
  });

  await check('Lists catch up without a reload (1.44.1): a task, file or project an agent adds outside the page shows in the open rail and on a project card when the window regains focus or a turn ends in another Pocket window',async()=>{
   await page.setViewport({width:1440,height:900});const settings=settingsState(),before={projects:settings.projects,documents:settings.documents,tasks:settings.tasks};Object.assign(settings,{projects:true,documents:true,tasks:true});
   await page.evaluate(()=>Promise.all(['/api/tasks/reset','/api/board/reset','/api/documents/reset'].map(u=>fetch(u,{method:'POST'}))));
   const agent=(url,init)=>fetch(base+url,{method:'POST',...init}).then(r=>{assert.equal(r.ok,true,url);return r.json();}); // the CLI's write, not the page's
   const railHas=text=>page.evaluate(t=>document.getElementById('rail')?.textContent.includes(t)||false,text);
   // Tasks rail: an added task is not shown until something says the list may be stale; focus is enough.
   await openChat(rows[4].id);await clickControl(page,'[data-rail-view="tasks"]');await page.waitForSelector('#rail .rail-tasks .task-item');
   await agent('/api/tasks/act',{headers:{'content-type':'application/json'},body:JSON.stringify({action:'add',text:'Added by an agent mid-turn'})});
   await pause(300);assert.equal(await railHas('Added by an agent mid-turn'),false,'no fetch without a trigger (the 30 s poll is the fallback)');
   await page.evaluate(()=>dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.getElementById('rail').textContent.includes('Added by an agent mid-turn'));
   // Files rail: a turn ending in another Pocket window (a pane, a solo window, another tab) refreshes this one.
   await clickControl(page,'[data-rail-view="documents"]');await page.waitForSelector('#rail .rail-documents .document-item');
   await agent('/api/documents',{headers:{'x-filename':'agent-report.md','content-type':'application/octet-stream','x-project':'warehouse-stock-report'},body:'# Agent report\n'});
   const other=await page.browserContext().newPage();await other.goto(base+'/?solo=1#/tasks');await other.waitForSelector('#tasks-main');
   await other.evaluate(()=>announceListsStale());await other.close();
   await page.waitForFunction(()=>/agent.report/i.test(document.getElementById('rail').textContent));
   // Projects rail: shown again with an older snapshot, it refetches instead of painting the stale list.
   await agent('/api/board/act',{headers:{'content-type':'application/json'},body:JSON.stringify({action:'track',name:'Tracked by an agent'})});
   await page.evaluate(()=>{boardAt=0;});await clickControl(page,'[data-rail-view="projects"]');
   await page.waitForFunction(()=>document.getElementById('rail').textContent.includes('Tracked by an agent'));
   // A project card's Files section is current when the card opens, not stuck on the library from the first load.
   await page.goto(base+'/#/projects/warehouse-stock-report');await page.waitForSelector('.project-documents .document-item');
   await agent('/api/documents',{headers:{'x-filename':'second-agent-note.md','content-type':'application/octet-stream','x-project':'warehouse-stock-report'},body:'# Second note\n'});
   await page.evaluate(()=>dispatchEvent(new Event('focus')));
   await page.waitForFunction(()=>/Second note/.test(document.querySelector('.project-documents').textContent));
   await page.evaluate(()=>Promise.all(['/api/tasks/reset','/api/board/reset','/api/documents/reset'].map(u=>fetch(u,{method:'POST'}))));
   await clickControl(page,'[data-rail-view="sessions"]');Object.assign(settings,before); // later suites expect the features as they were
   assert.deepEqual(errors,[]);
  });

  await check('1.60 Assistant mode: home is the message box, developer controls and meters are hidden, Settings is short',async()=>{
   const settings=settingsState(),before={assistantMode:settings.assistantMode},vp=page.viewport();settings.assistantMode=true;
   const shown=sel=>page.evaluate(s=>[...document.querySelectorAll(s)].some(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'),sel);
   try{
    for(const [w,h] of [[390,844],[1440,900]]){
     await page.setViewport({width:w,height:h});
     await page.goto(base+'/#/all');await page.waitForSelector('.session-home');await page.goto(base+'/#/');await page.waitForSelector('.assistant-home');await page.waitForSelector('#first');
     assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('assistant')),true);
     assert.equal(await page.$eval('header.bar h1',e=>e.textContent.trim()),'Pocket Assistant');
     assert.equal(await page.evaluate(()=>document.title),'Pocket Assistant');
     for(const sel of ['#tbar','#composer-toggle','#choose-skill','#save-prompt'])assert.equal(await shown(sel),false,sel+' is hidden at '+w);
     assert.equal(await shown('#start'),true,'Send is there');assert.equal(await shown('#home-recent .home-row')||w>=900,true,'Recent on a phone; the list beside it on a desktop');
     await scan('assistant-home-'+w);
    }
    await page.setViewport({width:390,height:844});
    await openChat(idle);
    for(const sel of ['#tbar','#results-open','#queue-open','#git-open','#ctx-ring','.turnmeta','#cproj'])assert.equal(await shown(sel),false,sel+' is hidden in a conversation');
    assert.equal(await page.$eval('#box',b=>b.placeholder),'Reply…');
    await scan('assistant-chat-390');
    await page.goto(base+'/#/');await page.waitForSelector('.assistant-home');await clickControl(page,'#settings');await page.waitForSelector('.settings-index');
    assert.deepEqual(await page.$$eval('.settings-index [data-settings-category]',b=>b.map(x=>x.dataset.settingsCategory)),['appearance','conversation','accounts','features','notifications','help']); // 1.81 (#175): Features joins Accounts
    assert.equal(await shown('#s-models'),false,'the model list is not offered');assert.equal(await shown('#s-trusted'),false);
    await page.keyboard.press('Escape');
    await page.goto(base+'/#/all');await page.waitForSelector('.session-home');
    assert.equal(await page.$eval('header.bar h1',e=>e.textContent.trim()),'Conversations');assert.equal(await shown('.session-filters'),false);
   }finally{Object.assign(settings,before);if(vp)await page.setViewport(vp);await page.goto(base+'/#/');}
  });

  await check('1.81 Assistant mode Features: the switches and Automatic model choice in Settings, the "is off" message goes there; a locked Pocket gets a line and no switches',async()=>{
   const settings=settingsState(),keys=['assistantMode','assistantLocked','projects','documents','tasks','inbox','vault'],before=Object.fromEntries(keys.map(k=>[k,settings[k]])),vp=page.viewport();
   const shown=sel=>page.evaluate(s=>[...document.querySelectorAll(s)].some(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'),sel);
   const open=async()=>{await page.reload();await page.waitForSelector('.assistant-home');await clickControl(page,'#settings');await page.waitForSelector('.settings-index');};
   const features=async()=>{await clickControl(page,'[data-settings-category=features]');await page.waitForSelector('[data-settings-panel=features]:not([hidden])');};
   const theme=async t=>{await page.evaluate(t=>PocketTheme.setPreference(t),t);await pause(150);};
   try{
    // not locked: five switches and Automatic model choice, the same controls (and handlers) as Developer mode
    Object.assign(settings,{assistantMode:true,assistantLocked:false,projects:false,documents:false,tasks:false,inbox:false,vault:false});
    for(const [w,h] of [[390,844],[1440,900]]){
     await page.setViewport({width:w,height:h});await page.goto(base+'/#/');await open();await features();
     assert.equal(await page.$eval('.sheet h2',e=>e.textContent.trim()),'Features');
     assert.deepEqual(await page.$$eval('[data-settings-panel=features] > *',es=>es.filter(e=>e.getClientRects().length).map(e=>e.id)),['s-features-lead','s-projects','s-documents','s-tasks','s-inbox','s-vault','s-router'],'the lead, the five switches, then Automatic model choice, in that order at '+w);
     assert.equal(await page.$eval('#s-features-note',e=>e.textContent),'Switch on what you want to use. Each one adds its own place beside your conversations.');
     assert.equal(await shown('#s-inbox-watch'),false,'no schedule button while Inbox Watch is off');assert.equal(await shown('#s-trusted'),false,'only Automatic model choice comes along, not the rest of Agents & instance');
     for(const t of ['light','dark']){await theme(t);await scan(`assistant-features-${w}-${t}`);await page.screenshot({path:path.join(out,`assistant-features-${w}-${t}.png`)});}
     await theme('system');
     if(w===390){
      // a switch that shows or hides a library redraws the view behind Settings, which closes the sheet (as in Developer mode): reopen it on Features
      const reopen=async()=>{if(!await page.$('.settings-sheet'))await page.evaluate(()=>settingsSheet({category:'features'}));await page.waitForSelector('[data-settings-panel=features]:not([hidden]) #s-vault:not([disabled])');};
      for(const [id,key] of [['s-projects','projects'],['s-documents','documents'],['s-tasks','tasks'],['s-inbox','inbox'],['s-vault','vault']]){
       await reopen();await clickControl(page,'#'+id);
       for(let i=0;i<30&&!settings[key];i++)await pause(100);assert.equal(settings[key],true,id+' saved through /api/settings');
       await page.waitForFunction(()=>!document.querySelector('.settings-sheet'),{timeout:2500}).catch(()=>{}); // the view redraws a moment after the save
      }
      await reopen();
      assert.deepEqual(await page.$$eval('[data-settings-panel=features] > *',es=>es.filter(e=>e.getClientRects().length).map(e=>e.id)),['s-features-lead','s-projects','s-documents','s-tasks','s-inbox','s-inbox-watch','s-vault','s-router'],'Inbox Watch brings its schedule button right under it');
      assert.equal(await page.$eval('#s-inbox-watch',e=>e.textContent.trim().startsWith('Inbox Watch schedule')),true,'the Assistant-mode label');
      await clickControl(page,'#s-inbox-watch');await page.waitForSelector('.watch-sheet #w-save');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.watch-sheet'));
      await reopen();
      await page.$eval('#s-router',e=>e.scrollIntoView({block:'start'}));
      for(const sel of ['#s-router-provider','#s-router-key','#s-router-levels','#s-router-note'])assert.equal(await page.$eval(sel,e=>e.getClientRects().length),0,sel+': no model, level or key in Assistant mode');
      assert.doesNotMatch(await page.$eval('#s-router',e=>e.innerText),/Opus|Sonnet|Haiku|GPT|Jev|OpenRouter/,'no model name reaches a seat');
      await clickControl(page,'#s-router-on');await page.waitForFunction(()=>/Automatic model choice is (on|off)/.test(document.getElementById('toast')?.textContent||''));
      await scan('assistant-features-router-390');
      Object.assign(settings,{projects:false,documents:false,tasks:false,inbox:false,vault:false});
     }
     await page.keyboard.press('Escape');
    }
    // a library that is off sends an Assistant-mode seat to Features, not to a category it does not have
    await page.setViewport({width:390,height:844});await page.goto(base+'/#/projects');await page.reload();
    await page.waitForFunction(()=>/Projects is off/.test(document.querySelector('#projects-main')?.textContent||''));
    assert.equal(await page.$eval('#projects-main .library-error p',e=>e.textContent),'Projects is off. Turn it on in Settings → Features.');
    await clickControl(page,'[data-library-settings]');await page.waitForSelector('[data-settings-panel=features]:not([hidden])');assert.equal(await page.$eval('.sheet h2',e=>e.textContent.trim()),'Features');
    await page.keyboard.press('Escape');await page.goto(base+'/#/inbox');await page.reload();
    await page.waitForFunction(()=>/Inbox Watch is off/.test(document.querySelector('#inbox-main')?.textContent||''));
    assert.equal(await page.$eval('#inbox-main .library-error p',e=>e.textContent),'Inbox Watch is off. Turn it on in Settings → Features.');
    // locked: a line saying what is on and who changes it, and no switches
    Object.assign(settings,{assistantLocked:true,projects:true,documents:false,tasks:true,inbox:false,vault:false});
    for(const [w,h] of [[390,844],[1440,900]]){
     await page.setViewport({width:w,height:h});await page.goto(base+'/#/');await open();
     assert.deepEqual(await page.$$eval('.settings-index [data-settings-category]',b=>b.map(x=>x.dataset.settingsCategory)),['appearance','conversation','accounts','features','notifications','help']);
     assert.equal(await page.$eval('[data-settings-category=features] .sub',e=>e.textContent),'Which parts of Pocket are on');
     await features();
     assert.deepEqual(await page.$$eval('[data-settings-panel=features] > *',es=>es.map(e=>e.id)),['s-features-lead'],'nothing but the line');
     assert.equal(await page.$eval('#s-features-note',e=>e.textContent),'Projects and Tasks are on. Files, Inbox Watch and Vault are off. To change them, ask the person who runs this install.');
     for(const id of ['s-projects','s-documents','s-tasks','s-inbox','s-vault','s-router-on'])assert.equal(await shown('#'+id),false,id+' is not offered when the mode is locked');
     if(w===390)for(const t of ['light','dark']){await theme(t);await scan(`assistant-features-locked-${w}-${t}`);await page.screenshot({path:path.join(out,`assistant-features-locked-${w}-${t}.png`)});}
     await theme('system');
     await page.keyboard.press('Escape');
    }
    await page.setViewport({width:390,height:844});await page.goto(base+'/#/documents');await page.reload();
    await page.waitForFunction(()=>/Files is off/.test(document.querySelector('#documents-main')?.textContent||''));
    assert.equal(await page.$eval('#documents-main .library-error p',e=>e.textContent),'Files is off. Ask the person who runs this install to turn it on.');
    assert.equal(await page.$('[data-library-settings]'),null,'no Open Settings button when there is nothing to open');
   }finally{Object.assign(settings,before);await page.evaluate(()=>PocketTheme.setPreference('system'));if(vp)await page.setViewport(vp);await page.goto(base+'/#/');await page.reload();}
  });

  await check('1.81 Keyboard shortcuts: the sheet lists the side chat shortcut and the Enter rules, and the message box follows them',async()=>{
   const vp=page.viewport();
   try{
    for(const [w,h] of [[390,844],[1440,900]]){
     await page.setViewport({width:w,height:h});await chat();
     const sent=received.length,setBox=v=>page.$eval('#box',(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));},v),draft=await page.$eval('#box',e=>e.value);await setBox('');
     // the rule the sheet states: Enter sends from 900 px, below that it adds a line; Shift+Enter always adds one
     await page.focus('#box');await page.keyboard.type('one');await page.keyboard.down('Shift');await page.keyboard.press('Enter');await page.keyboard.up('Shift');await page.keyboard.type('two');
     assert.equal(await page.$eval('#box',e=>e.value),'one\ntwo','Shift+Enter adds a line at '+w);
     if(w<900){await page.keyboard.press('Enter');await page.keyboard.type('three');assert.equal(await page.$eval('#box',e=>e.value),'one\ntwo\nthree','below 900 px Enter adds a line');assert.equal(received.length,sent,'and sends nothing');}
     await setBox(draft);
     await page.evaluate(()=>settingsSheet({category:'help'}));await clickControl(page,'#s-keys');await page.waitForSelector('.shortcut-list');
     const rows=await page.$$eval('.shortcut-list dt',ts=>ts.map(t=>[t.textContent.trim(),t.nextElementSibling.textContent.trim()]));
     assert.deepEqual(rows.map(r=>r[0]),['Ctrl / ⌘ K','Ctrl / ⌘ Shift L','Alt [ / Alt ]','Ctrl / ⌘ F','Ctrl / ⌘ ;','Enter','Shift Enter','Escape']);
     assert.equal(rows.find(r=>r[0]==='Ctrl / ⌘ ;')[1],'Open or close the side chat');
     assert.match(rows.find(r=>r[0]==='Enter')[1],/at least 900 px wide.*narrower one it adds a line.*send button sends/);assert.equal(rows.find(r=>r[0]==='Shift Enter')[1],'Add a line');
     await scan('keyboard-shortcuts-'+w);
     await page.keyboard.press('Escape');
    }
   }finally{if(vp)await page.setViewport(vp);await page.goto(base+'/#/');}
  });

  await check('1.81 Split panes: the stylesheet and split.js agree on the narrowest pane',async()=>{
   await page.goto(base+'/#/');
   const [css,js]=await page.evaluate(()=>{const e=document.createElement('div');e.className='split-pane';document.body.append(e);const w=getComputedStyle(e).minWidth;e.remove();return [w,SPLIT_MIN+'px'];});
   assert.equal(css,js,'.split-pane min-width follows SPLIT_MIN');
  });

  await check('1.69 Inbox: the rail fits six libraries, the list opens with New / All / Dismissed, X dismisses, the row menu resolves, Settings and the push kind are there',async()=>{
   const settings=settingsState(),before={projects:settings.projects,documents:settings.documents,tasks:settings.tasks,vault:settings.vault,inbox:settings.inbox},vp=page.viewport();
   Object.assign(settings,{projects:true,documents:true,tasks:true,vault:true,inbox:true});
   const shown=sel=>page.evaluate(s=>[...document.querySelectorAll(s)].some(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'),sel);
   try{
    await page.evaluate(()=>fetch('/api/inbox/reset',{method:'POST'}));
    // the rail at a desk: six entries, each an icon over its name at the default width (1.76.2), every entry named for assistive tech
    await page.setViewport({width:1440,height:900});await page.goto(base+'/#/inbox');await page.reload();await page.waitForSelector('.inbox-view'); // the rail belongs to the view shell
    await page.waitForSelector('.rail-switch.many');
    const segs=await page.$$eval('.rail-switch button',bs=>bs.map(b=>({view:b.dataset.railView,label:b.getAttribute('aria-label'),pressed:b.getAttribute('aria-pressed'),named:b.querySelector('.rail-label').getBoundingClientRect().width>4,icon:Boolean(b.querySelector('svg')),w:b.getBoundingClientRect().width})));
    assert.deepEqual(segs.map(x=>x.view),['sessions','projects','documents','tasks','vault','inbox']);
    assert.deepEqual(segs.map(x=>x.label),['Chats','Projects','Files','Tasks','Vault','Inbox']);
    assert.ok(segs.every(x=>x.icon),'every entry has an icon');assert.deepEqual(segs.map(x=>x.named),[true,true,true,true,true,true],'every entry shows its name at the default rail width (1.76.2)');
    // 1.76.2: the rail still lists chats, the main area shows the Inbox: Chats is pressed, Inbox carries aria-current and the clay bar
    assert.deepEqual(segs.map(x=>x.pressed),['true','false','false','false','false','false']);
    assert.deepEqual(await page.$$eval('.rail-switch button',bs=>bs.map(b=>b.getAttribute('aria-current'))),[null,null,null,null,null,'page']);
    assert.notEqual(await page.$eval('[data-rail-view="inbox"]',b=>getComputedStyle(b,'::after').content),'none','the main area’s entry shows the bar');
    const fit=await page.evaluate(()=>{const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {left:Math.round(b.left),right:Math.round(b.right),top:Math.round(b.top),bottom:Math.round(b.bottom),w:Math.round(b.width)};};return {switch:r('.rail-switch'),head:r('.railhead'),actions:r('.rail-actions'),rail:r('aside.rail'),overflow:document.querySelector('.railhead').scrollWidth>document.querySelector('.railhead').clientWidth+1,buttons:[...document.querySelectorAll('.rail-switch button')].map(b=>[Math.round(b.getBoundingClientRect().width),Math.round(b.querySelector('.rail-label').getBoundingClientRect().width),getComputedStyle(b.querySelector('.rail-label')).position,b.className]),many:document.querySelector('.rail-switch').className};});
    assert.ok(!fit.overflow&&fit.switch.right<=fit.head.right&&(fit.switch.right<=fit.actions.left||fit.switch.top>=fit.actions.bottom||fit.switch.bottom<=fit.actions.top),'the switch fits the rail head, beside the rail actions or on its own row: '+JSON.stringify(fit));
    assert.ok(fit.switch.bottom<=fit.actions.top,'at the default rail width the named switch has the head’s first row, the rail actions the second: '+JSON.stringify(fit));
    // a narrow rail falls back to icons with only the pressed entry named, on one row with the actions where they fit
    await page.$eval('aside.rail',e=>e.style.width='260px');
    assert.deepEqual(await page.$$eval('.rail-switch button',bs=>bs.map(b=>b.querySelector('.rail-label').getBoundingClientRect().width>4)),[true,false,false,false,false,false],'a 260px rail names only the pressed entry');
    assert.equal(await page.evaluate(()=>document.querySelector('.railhead').scrollWidth>document.querySelector('.railhead').clientWidth+1),false,'nothing overflows a 260px rail');
    await page.$eval('aside.rail',e=>e.style.width='');
    await page.waitForFunction(()=>document.querySelector('[data-inbox-badge]')?.textContent==='1');
    await scan('rail-six-1440');
    // 1.77.3 (Brad): every order of switching shows the entry's own list. Tasks → Projects left the task list where it was: the
    // Tasks, Vault and Inbox lists carry .rail-projects for their styling, and once Projects had painted, its painter took any
    // of them for its own list and did nothing. Chats → Projects worked, which is how Brad got there.
    const railLists=()=>page.evaluate(()=>[...document.querySelectorAll('#rail > .session-panel, #rail > .rail-projects, #rail > .rail-documents')].map(e=>['session-panel','rail-documents','rail-tasks','rail-vault','rail-inbox'].find(c=>e.classList.contains(c))||'rail-board').map(c=>({'session-panel':'sessions','rail-board':'projects','rail-documents':'documents','rail-tasks':'tasks','rail-vault':'vault','rail-inbox':'inbox'})[c]).join('+')); // the project list is the .rail-projects root that is none of the other three
    const switchRail=async view=>{await clickControl(page,`[data-rail-view="${view}"]`);await page.waitForFunction(v=>document.querySelector(`[data-rail-view="${v}"]`)?.getAttribute('aria-pressed')==='true',{},view);
     try{await page.waitForFunction(v=>document.querySelectorAll('#rail > *').length===1&&(v==='sessions'?document.querySelector('#rail > .session-panel'):v==='projects'?document.querySelector('#rail > .rail-projects:not(.rail-tasks):not(.rail-vault):not(.rail-inbox) .project-item'):document.querySelector(`#rail > .rail-${v}`)),{timeout:3000},view);}catch{}
     assert.equal(await railLists(),view,'the rail lists '+view+' after switching to it');};
    for(const v of ['projects','tasks','projects','vault','projects','inbox','projects','documents','projects','sessions','projects','tasks','inbox','vault','documents','tasks','sessions','vault','projects'])await switchRail(v);
    // the list
    for(const w of [390,1440]){
     await page.setViewport({width:w,height:w===390?844:900});await page.goto(base+'/#/inbox');await page.waitForSelector('.inbox-view .inbox-item');
     assert.equal(await page.$eval('#ktitle',e=>e.textContent),'Inbox');
     assert.deepEqual(await page.$$eval('.inbox-view .inbox-item',r=>r.map(x=>x.className.match(/state-\w+/)[0])),['state-new','state-opened'],'1.71: Open opens first: unread and read, nothing finished, at '+w);
     await clickControl(page,'[data-inbox-filter="new"]');await page.waitForFunction(()=>document.querySelectorAll('.inbox-view .inbox-item').length===1);
     assert.deepEqual(await page.$$eval('.inbox-view .inbox-item .title',t=>t.map(x=>x.textContent)),['Oakridge dispatch conflict'],'Unread shows the one new alert at '+w);
     assert.ok((await page.$$eval('.inbox-item button',bs=>bs.map(b=>b.getBoundingClientRect().height))).every(h=>h>=44),'44px targets');
     await clickControl(page,'[data-inbox-filter="open"]');await page.waitForFunction(()=>document.querySelectorAll('.inbox-view .inbox-item').length===2);
     assert.match(await page.$eval('.inbox-item.state-new .inbox-text',e=>e.textContent),/Robin says/);
     if(w===390)await scan('inbox-all-390');else await scan('inbox-all-1440');
    }
    // 1.69.1: a tap on the row reads it (the sheet), and only the sheet starts a conversation
    await clickControl(page,'.inbox-item.state-new .row[data-inbox-open]');await page.waitForSelector('.inbox-sheet');assert.equal(await page.$eval('.inbox-sheet [data-go]',e=>e.textContent.includes('Start a conversation')),true);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.inbox-sheet'));
    // 1.69.2: reading cleared the dot but the row stays in Open; the row menu: Resolved moves it to Done; X there dismisses; Restore brings it back
    await page.waitForFunction(()=>document.querySelectorAll('.inbox-view .inbox-item').length===2&&!document.querySelector('.inbox-view .inbox-item.state-new'));
    // The list repaints when the server answers an action; a click that lands on the row just replaced is tried again.
    const clickRow=async sel=>{for(let i=0;;i++){try{return await clickControl(page,sel);}catch(e){if(i>=4||!/detached|not clickable|No element/i.test(String(e.message)))throw e;await new Promise(r=>setTimeout(r,250));}}};
    // 1.77: the dot is its own control: read → unread → read, the row staying where it is; it sits level with the title
    await clickRow('[data-inbox-read][aria-label="Mark as unread: Oakridge dispatch conflict"]');await page.waitForSelector('.inbox-view .inbox-item.state-new [data-inbox-read][aria-label="Mark as read: Oakridge dispatch conflict"]');
    assert.equal(await page.$eval('.inbox-item.state-new .inbox-mark .i circle',c=>getComputedStyle(c).fill!=='none'),true,'unread is a filled dot');
    assert.ok(await page.$eval('.inbox-item.state-new',r=>{const d=r.querySelector('.inbox-mark .i').getBoundingClientRect(),t=r.querySelector('.row .title').getBoundingClientRect();const mid=d.top+d.height/2;return mid>t.top&&mid<t.top+28;}),'the dot is level with the first line of the title');
    assert.equal(await page.evaluate(()=>document.querySelector('.inbox-sheet')),null,'the dot opens nothing');
    await clickRow('[data-inbox-read][aria-label="Mark as read: Oakridge dispatch conflict"]');await page.waitForFunction(()=>!document.querySelector('.inbox-view .inbox-item.state-new'));
    assert.equal(await page.$eval('[data-inbox-read][aria-label="Mark as unread: Oakridge dispatch conflict"] .i circle',c=>getComputedStyle(c).fill),'none','read is a ring');
    // 1.77: Start a conversation from the alert: New carries the start link, and the row then shows the conversation
    await clickRow('.inbox-item:has([aria-label="Mark as unread: Oakridge dispatch conflict"]) .row[data-inbox-open]');await page.waitForSelector('.inbox-sheet [data-go]');
    assert.equal(await page.$('.inbox-sheet [data-chat]'),null,'no conversation yet');
    await clickControl(page,'.inbox-sheet [data-go]');await page.waitForFunction(()=>location.hash==='#/new'&&/Reach Jordan/.test(document.querySelector('#first')?.value||''));
    const sentBefore=received.length;await clickControl(page,'#start');await page.waitForFunction(n=>location.hash.startsWith('#/chat/')||false,{},sentBefore);
    assert.equal(received.at(-1).start,'0123456789ab','the start link reaches /api/new');
    await page.goto(base+'/#/inbox');await page.waitForSelector('.inbox-view .inbox-item .inbox-chat');
    assert.equal(await page.$eval('.inbox-item .inbox-chat',a=>[a.getAttribute('href'),a.getAttribute('aria-label'),a.getBoundingClientRect().height>=44&&a.getBoundingClientRect().width>=44].join('|')),'#/chat/66666666-6666-4666-8666-666666666666|Open the conversation: Oakridge dispatch conflict|true');
    assert.equal(await page.$$eval('.inbox-view .inbox-chat',a=>a.length),1,'only the entry it started from');
    await clickRow('.inbox-item:has(.inbox-chat) .row[data-inbox-open]');await page.waitForSelector('.inbox-sheet [data-chat]');
    assert.deepEqual(await page.$$eval('.inbox-sheet .opt',o=>o.slice(0,2).map(x=>x.firstElementChild.nextElementSibling.firstChild.textContent)),['Open the conversation','Start another conversation']);
    await scan('inbox-conversation-1440');
    await clickControl(page,'.inbox-sheet [data-chat]');await page.waitForFunction(()=>location.hash==='#/chat/66666666-6666-4666-8666-666666666666'&&!document.querySelector('.inbox-sheet'));
    await page.goto(base+'/#/inbox');await page.waitForSelector('.inbox-view [data-inbox-more][aria-label="Options for Oakridge dispatch conflict"]');
    await clickRow('[data-inbox-more][aria-label="Options for Oakridge dispatch conflict"]');await page.waitForSelector('.inbox-sheet');await page.waitForFunction(()=>[...document.querySelectorAll('.inbox-sheet')].every(e=>e.getAnimations({subtree:true}).every(a=>a.playState==='finished')));
    assert.match(await page.$eval('.inbox-sheet .inbox-body',e=>e.innerHTML),/<a href="https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/1a1540e0de10f879"/,'a citation is a Gmail link');
    assert.deepEqual(await page.evaluate(()=>['[data-go]','a.opt[href^="https://mail.google.com/"]','[data-resolve]','[data-useless]','[data-dismiss]','[data-restore]'].map(q=>Boolean(document.querySelector('.inbox-sheet '+q)))),[true,true,true,true,true,false],'the choices: open, Gmail, Resolved, Not useful, Dismiss; no Restore on a new entry');
    await clickControl(page,'.inbox-sheet [data-resolve]');await page.waitForFunction(()=>!document.querySelector('.inbox-sheet'));
    await page.waitForFunction(()=>document.querySelectorAll('.inbox-view .inbox-item').length===1,'Oakridge leaves Open');
    await clickControl(page,'[data-inbox-filter="done"]');await page.waitForFunction(()=>document.querySelectorAll('.inbox-view .inbox-item.state-resolved').length===2,'Done: Oakridge joins Lakeview as resolved');
    await clickControl(page,'[data-inbox-dismiss][aria-label="Dismiss: Oakridge dispatch conflict"]');await page.waitForSelector('.inbox-item.state-dismissed');
    assert.equal(await page.$$eval('.inbox-view .inbox-item',r=>r.length),2,'Done holds resolved and dismissed alike');
    await clickControl(page,'.inbox-item.state-dismissed [data-inbox-more]');await page.waitForSelector('.inbox-sheet [data-restore]');await page.waitForFunction(()=>[...document.querySelectorAll('.inbox-sheet')].every(e=>e.getAnimations({subtree:true}).every(a=>a.playState==='finished')));await clickControl(page,'.inbox-sheet [data-restore]');
    await page.waitForFunction(()=>!document.querySelector('.inbox-sheet'));await page.waitForFunction(()=>[...document.querySelectorAll('.inbox-view .inbox-item .title')].map(x=>x.textContent).join()==='Lakeview alarm timer tests','restored: only Lakeview is left in Done');
    await clickControl(page,'[data-inbox-filter="open"]');await page.waitForFunction(()=>document.querySelectorAll('.inbox-view .inbox-item').length===2);
    // 1.75: Check now, beside Schedule in the view and beside All in the rail; busy until the watcher reports it done
    assert.equal(await page.evaluate(()=>{const d=document.createElement('div');d.innerHTML=railInboxHTML();return [...d.querySelector('.rail-project-actions').children].map(x=>x.textContent.trim()).join('|');}),'All|Check now','the rail: Check now beside All');
    assert.equal(await page.$eval('.inbox-tools-row',e=>[...e.querySelectorAll('.chip')].map(x=>x.textContent.trim()).join('|')),'Check now|Schedule');
    await clickControl(page,'.inbox-view [data-inbox-check]');
    await page.waitForFunction(()=>[...document.querySelectorAll('[data-inbox-check]')].every(b=>b.getAttribute('aria-busy')==='true'&&b.disabled&&b.textContent.trim()==='Checking…'),{},'both chips busy');
    await page.evaluate(()=>fetch('/api/inbox/check-done',{method:'POST'}));
    await page.waitForFunction(()=>document.querySelector('.inbox-view [data-inbox-check]:not([aria-busy])')&&/Checked\. One new item\./.test(document.querySelector('#toast')?.textContent||''),{timeout:15000});
    await page.waitForFunction(()=>[...document.querySelectorAll('.inbox-view .inbox-item .title')].some(t=>t.textContent==='Added in Gmail: quote request'),{},'the list reloads with what the check found');
    // 1.81: when Pocket stands down for a watcher installed separately, the status line says so (it used to be blank)
    assert.equal(await page.evaluate(()=>inboxRunnerLine({managed:false,state:'external'})),'A watcher installed separately is reporting here; Pocket is not running its own.');
    assert.equal(await page.evaluate(()=>inboxRunnerLine({managed:false,state:'off'})),'');
    assert.equal(await page.evaluate(()=>inboxRunnerLine({managed:true,state:'running',mailbox:'sam@example.com',accountChange:{from:'alex@example.com',to:'sam@example.com'}})),'Gmail is now connected as sam@example.com (it was alex@example.com), so Inbox Watch now watches sam@example.com. Mail already kept from the old account stays in its memory.');
    assert.equal(await page.evaluate(()=>inboxRunnerLine({managed:true,state:'running',mailbox:'sam@example.com',accountChange:null})),'');
    // Settings: the switch under the libraries, the push kind under notifications
    await page.setViewport({width:1440,height:900});await page.goto(base+'/#/all');await page.evaluate(()=>settingsSheet({category:'libraries'}));await page.waitForSelector('#s-inbox');
    await page.waitForFunction(()=>document.querySelector('#s-inbox')?.getAttribute('aria-pressed')==='true');assert.match(await page.$eval('#s-inbox-state',e=>e.textContent),/^On: alerts, digests and look-aheads/);
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.settings-sheet'));
    await page.evaluate(()=>settingsSheet({category:'notifications'}));await page.waitForSelector('#s-push-alerts');assert.equal(await page.$eval('#s-push-alerts',e=>e.textContent.includes('Inbox alerts')),true);
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.settings-sheet'));
    // Assistant mode: a new alert is a Waiting-for-you card on home
    await page.evaluate(()=>fetch('/api/inbox/reset',{method:'POST'}));settings.assistantMode=true;
    await page.setViewport({width:390,height:844});await page.goto(base+'/#/');await page.reload();await page.waitForSelector('.assistant-home');
    await page.waitForSelector('#home-waiting .inbox-card');
    assert.equal(await page.$eval('#home-waiting .inbox-card .home-card-title',e=>e.textContent),'Oakridge dispatch conflict');
    assert.match(await page.$eval('#home-waiting .inbox-card',e=>e.getAttribute('href')),/^#\/inbox\/[0-9a-f]{12}$/,'1.69.1: the card opens the entry to read, not the session');
    await page.mouse.move(1,1);await page.evaluate(()=>document.querySelector('#tip')?.setAttribute('hidden',''));await scan('assistant-home-inbox-390');
   }finally{Object.assign(settings,before);settings.assistantMode=false;await page.evaluate(()=>fetch('/api/inbox/reset',{method:'POST'}));if(vp)await page.setViewport(vp);await page.goto(base+'/#/');}
  });

  await check('1.95 digest cards: a card has the Inbox choices, and a story that is on the list opens that entry instead of being a second thing to work',async()=>{
   const settings=settingsState(),before={inbox:settings.inbox},vp=page.viewport();
   settings.inbox=true;
   try{
    await page.evaluate(()=>fetch('/api/inbox/reset',{method:'POST'}));
    const {digest,alert}=await page.evaluate(()=>fetch('/api/inbox/digest-cards',{method:'POST'}).then(r=>r.json()));
    for(const w of [390,1440]){
     await page.setViewport({width:w,height:w===390?844:900});await page.goto(base+'/#/inbox/'+digest);await page.reload();await page.waitForSelector('.inbox-sheet [data-item-card="a1"]');
     assert.deepEqual(await page.$$eval('.inbox-sheet [data-item-card="a1"] .inbox-item-actions > *',es=>es.map(e=>e.textContent.trim())),['Start a conversation','Add to Inbox','Resolved','Not useful','Dismiss']);
     assert.equal(await page.$('.inbox-sheet [data-item-card="a3"]'),null,'no card for a story on the list');
     assert.equal(await page.$eval('.inbox-sheet .inbox-item-listed a',e=>e.getAttribute('href')),'#/inbox/'+alert,'the line opens the entry');
     await page.mouse.move(1,1);await page.evaluate(()=>document.querySelector('#tip')?.setAttribute('hidden',''));await scan('digest-cards-'+w);
     await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.inbox-sheet'));
    }
    await page.goto(base+'/#/inbox/'+digest);await page.reload();await page.waitForSelector('.inbox-sheet [data-item-card="a1"]');
    await clickControl(page,'.inbox-sheet [data-item-card="a1"] [data-item-act="dismiss"]');await page.waitForSelector('.inbox-sheet .inbox-item-card.state-dismissed');
    assert.deepEqual(await page.$$eval('.inbox-sheet [data-item-card="a1"] .inbox-item-actions > *',es=>es.map(e=>e.textContent.trim())),['Start a conversation','Dismissed','Undo'],'the sheet stays open and the card says what happened');
    await clickControl(page,'.inbox-sheet [data-item-card="a1"] [data-item-act="restore"]');await page.waitForFunction(()=>document.querySelector('.inbox-sheet [data-item-card="a1"]')?.classList.contains('state-open'));
    await page.evaluate(id=>fetch('/api/inbox/act',{method:'POST',body:JSON.stringify({action:'resolve',id})}),alert);
    await page.reload();await page.waitForSelector('.inbox-sheet .inbox-item-listed .inbox-item-state');
    assert.equal(await page.$eval('.inbox-sheet .inbox-item-listed .inbox-item-state',e=>e.textContent),'Resolved','the line shows what happened to the entry');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.inbox-sheet'));
   }finally{Object.assign(settings,before);await page.evaluate(()=>fetch('/api/inbox/reset',{method:'POST'}));if(vp)await page.setViewport(vp);await page.goto(base+'/#/');}
  });

  await check('1.95 look-ahead cards: its lead line, then its items in order with the same choices, and a story on the list opens that entry',async()=>{
   const settings=settingsState(),before={inbox:settings.inbox},vp=page.viewport();
   settings.inbox=true;
   try{
    await page.evaluate(()=>fetch('/api/inbox/reset',{method:'POST'}));
    const {lookahead,alert}=await page.evaluate(()=>fetch('/api/inbox/lookahead-cards',{method:'POST'}).then(r=>r.json()));
    for(const w of [390,1440]){
     await page.setViewport({width:w,height:w===390?844:900});await page.goto(base+'/#/inbox/'+lookahead);await page.reload();await page.waitForSelector('.inbox-sheet [data-item-card="c9.1"]');
     assert.equal(await page.$eval('.inbox-sheet .inbox-lead',e=>e.textContent),'Three things worth catching before Monday:');
     assert.deepEqual(await page.$$eval('.inbox-sheet [data-item-card]',es=>es.map(e=>e.dataset.itemCard)),['c9.1','c9.2','c9.3'],'most pressing first, the listed one in its place');
     assert.deepEqual(await page.$$eval('.inbox-sheet [data-item-card="c9.1"] .inbox-item-actions > *',es=>es.map(e=>e.textContent.trim())),['Start a conversation','Add to Inbox','Resolved','Not useful','Dismiss']);
     assert.deepEqual(await page.$$eval('.inbox-sheet [data-item-card="c9.2"] .inbox-item-actions > *',es=>es.map(e=>e.textContent.trim())),['Open in Inbox'],'decided on its entry');
     assert.equal(await page.$eval('.inbox-sheet [data-item-card="c9.2"] .inbox-item-actions a',e=>e.getAttribute('href')),'#/inbox/'+alert);
     assert.match(await page.$eval('.inbox-sheet [data-item-card="c9.2"] .inbox-body',e=>e.textContent),/still down/,'the card keeps what the look-ahead found');
     await page.mouse.move(1,1);await page.evaluate(()=>document.querySelector('#tip')?.setAttribute('hidden',''));await scan('lookahead-cards-'+w);
     await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.inbox-sheet'));
    }
    await page.goto(base+'/#/inbox/'+lookahead);await page.reload();await page.waitForSelector('.inbox-sheet [data-item-card="c9.1"]');
    await clickControl(page,'.inbox-sheet [data-item-card="c9.1"] [data-item-act="alert"]');await page.waitForSelector('.inbox-sheet .inbox-item-card.state-alerted');
    assert.deepEqual(await page.$$eval('.inbox-sheet [data-item-card="c9.1"] .inbox-item-actions > *',es=>es.map(e=>e.textContent.trim())),['Start a conversation','Adding to Inbox','Undo'],'it says what is happening until the watcher has sent it');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.inbox-sheet'));
   }finally{Object.assign(settings,before);await page.evaluate(()=>fetch('/api/inbox/reset',{method:'POST'}));if(vp)await page.setViewport(vp);await page.goto(base+'/#/');}
  });

  await check('1.70 Inbox Watch settings: periods, quiet hours and summaries, models and cost; Save reaches the store; Assistant mode shows no models or dollars',async()=>{
   const settings=settingsState(),before={inbox:settings.inbox,assistantMode:settings.assistantMode},vp=page.viewport();
   settings.inbox=true;
   try{
    await page.evaluate(()=>fetch('/api/inbox/reset',{method:'POST'}));
    for(const w of [390,1440]){
     await page.setViewport({width:w,height:w===390?844:900});await page.goto(base+'/#/inbox');await page.reload();await page.waitForSelector('.inbox-view #inbox-watch');
     await clickControl(page,'#inbox-watch');await page.waitForSelector('.watch-sheet #w-save');
     await page.waitForFunction(()=>[...document.querySelectorAll('.watch-sheet')].every(e=>e.getAnimations({subtree:true}).every(a=>a.playState==='finished')));
     assert.match(await page.$eval('#w-status',e=>e.textContent),/^Checking every 5 minutes now\. Last check .*Using the watcher’s config file\.$/);
     assert.deepEqual(await page.$$eval('.watch-sheet .vault-set-head',h=>h.map(x=>x.textContent)),['Your rules','Your list in Gmail','Schedule','Quiet hours and summaries','Keep the Inbox tidy','Models','First pass','Cost, last 7 days']);
     assert.equal(await page.$eval('#w-digest',e=>e.options[0].textContent),'Off','1.95: the morning digest can be off');assert.match(await page.$eval('#w-quiet-note',e=>e.textContent),/wait for the morning digest/);
     await page.select('#w-digest','off');assert.match(await page.$eval('#w-quiet-note',e=>e.textContent),/arrive one by one when quiet hours end/,'the note follows the choice');
     await page.select('#w-digest','8');
     assert.equal(await page.$eval('#w-label',e=>e.getAttribute('aria-pressed')),'true','1.75: the Pocket Inbox label, on by default');assert.match(await page.$eval('#w-label',e=>e.textContent),/Keep a Pocket Inbox label in Gmail/);assert.equal(await page.$('#w-label-off'),null);
     assert.equal(await page.$eval('#w-rules',e=>getComputedStyle(e,'::placeholder').fontStyle),'italic','the placeholder reads as guidance');
     assert.match(await page.$eval('#w-rules',e=>e.placeholder),/^Write your instructions here/);
     assert.match(await page.$eval('#w-rules',e=>e.value),/Every sale from the web store over \$500/,'the box shows the watcher\'s rules');
     assert.match(await page.$eval('#w-rules-count',e=>e.textContent),/^\d+ of 8,000 characters$/);
     assert.equal(await page.$eval('#w-tidy',e=>e.getAttribute('aria-pressed')),'true');assert.equal(await page.$eval('#w-tidy-every',e=>e.value),'2');
     assert.equal(await page.$eval('#w-fp',e=>e.getAttribute('aria-pressed')),'true');assert.equal(await page.$eval('#w-fp-provider',e=>e.value),'jev');assert.equal(await page.$eval('#w-fp-threshold',e=>e.value),'0.8');
     assert.equal(await page.$eval('#w-every',e=>e.value),'5');assert.equal(await page.$$eval('.watch-period',r=>r.length),1,'the config file’s Overnight period');
     assert.deepEqual(await page.$$eval('.watch-period [data-day]',b=>b.map(x=>x.getAttribute('aria-pressed'))),Array(7).fill('true'));
     const days=await page.$$eval('.watch-period [data-day]',b=>b.map(x=>{const r=x.getBoundingClientRect();return [Math.round(r.top),r.width>=44&&r.height>=44];}));
     assert.equal(new Set(days.map(d=>d[0])).size,1,'seven days on one row at '+w);assert.ok(days.every(d=>d[1]),'44px day targets at '+w);
     assert.deepEqual(await page.$$eval('.watch-usage tbody tr',r=>r.map(x=>[...x.cells].map(c=>c.textContent.trim()).join(' '))),['Wed 21 190 120 150 6.5M $15.62','Tue 20 240 0 180 8.1M $19.04','Mon 19 277 Not recorded']);
     assert.equal(await page.$eval('.watch-usage tfoot tr',e=>[...e.cells].map(c=>c.textContent.trim()).filter(Boolean).join(' ')),'Total 120 330 15M $34.66');
     await scan('inbox-watch-'+w);
     await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.watch-sheet'));
    }
    // change things and save: a weekday period, a day off, a slower default, a cheaper decisions model
    await clickControl(page,'#inbox-watch');await page.waitForSelector('.watch-sheet #w-add');
    await clickControl(page,'#w-add');await page.waitForFunction(()=>document.querySelectorAll('.watch-period').length===2);
    assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('watch-name')),true,'focus goes to the new period’s name');
    await page.type('.watch-period:last-child .watch-name','Work hours');
    for(const d of [5,6])await clickControl(page,`.watch-period:last-child [data-day="${d}"]`);
    await page.$eval('.watch-period:last-child [data-from]',e=>{e.value='07:00';});await page.$eval('.watch-period:last-child [data-to]',e=>{e.value='19:00';});await page.select('.watch-period:last-child [data-every]','5');
    await page.select('#w-every','15');await page.select('#w-fp-threshold','0.9');await page.select('#w-tidy-every','4');await page.$eval('#w-rules',e=>{e.focus();e.setSelectionRange(e.value.length,e.value.length);});await page.keyboard.type('- Never tell me about cameras that go offline.\n');await page.select('#w-fp-provider','both');await page.select('#w-models [data-job="decisions"] [data-model]','haiku');await page.select('#w-la-evening','off');
    await clickControl(page,'#w-label');
    await clickControl(page,'#w-save');await page.waitForSelector('#w-reset');
    const saved=await page.evaluate(()=>fetch('/api/inbox/watch').then(r=>r.json()));
    assert.equal(saved.revision,1);assert.equal(saved.settings.every,15);assert.equal(saved.settings.lookahead.evening,null);assert.deepEqual(saved.settings.models.decisions,{model:'haiku',reasoning:'medium'});assert.deepEqual(saved.settings.firstPass,{enabled:true,provider:'both',threshold:0.9});assert.deepEqual(saved.settings.tidy,{enabled:true,every:4});assert.match(saved.settings.rules,/Every sale from the web store over \$500[\s\S]*Never tell me about cameras that go offline\./,'the rules are saved with the settings');
    assert.deepEqual(saved.settings.gmailLabel,{enabled:false},'1.75: turned off and saved');
    assert.deepEqual(saved.settings.periods[1],{name:'Work hours',days:[0,1,2,3,4],from:'07:00',to:'19:00',every:5});
    assert.match(await page.$eval('#w-status',e=>e.textContent),/Your last change reaches the watcher within a minute\./);
    // a period with no day is refused before it leaves the page
    for(const d of [0,1,2,3,4])await clickControl(page,`.watch-period:last-child [data-day="${d}"]`);
    await clickControl(page,'#w-save');await page.waitForFunction(()=>/Period 2 needs at least one day/.test(document.querySelector('#w-error')?.textContent||''));
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.watch-sheet'));
    // Settings opens the same sheet; Assistant mode keeps the schedule and drops models and cost
    // 1.81 (#182): inside its category the button still disappears with the switch (a hidden .opt needs its own rule)
    settings.inbox=false;await page.goto(base+'/#/all');await page.evaluate(()=>settingsSheet({category:'libraries'}));
    await page.waitForFunction(()=>/^Off\./.test(document.querySelector('#s-inbox-state')?.textContent||''));
    assert.equal(await page.$eval('#s-inbox-watch',e=>e.getClientRects().length),0,'no Schedule, models and cost while Inbox Watch is off');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.settings-sheet'));settings.inbox=true;
    await page.goto(base+'/#/all');await page.evaluate(()=>settingsSheet({category:'libraries'}));await page.waitForSelector('#s-inbox-watch:not([hidden])');
    // 1.81 (#182): the button sits in Projects, files, tasks & vault, right under the Inbox Watch switch, not loose above the categories
    assert.deepEqual(await page.$eval('#s-inbox-watch',e=>({panel:e.closest('[data-settings-panel]')?.dataset.settingsPanel,after:e.previousElementSibling?.id,before:e.nextElementSibling?.id,parent:e.parentElement.tagName})),{panel:'libraries',after:'s-inbox',before:'s-vault',parent:'SECTION'},'Schedule, models and cost follows the Inbox Watch switch');
    await clickControl(page,'#s-inbox-watch');await page.waitForSelector('.watch-sheet #w-save');assert.ok(await page.$('.watch-sheet .sheet-back'),'Back to Settings');
    await page.keyboard.press('Escape');
    settings.assistantMode=true;await page.setViewport({width:390,height:844});await page.goto(base+'/#/inbox');await page.reload();await page.waitForSelector('#inbox-watch');
    await clickControl(page,'#inbox-watch');await page.waitForSelector('.watch-sheet #w-save');
    assert.deepEqual(await page.$$eval('.watch-sheet .vault-set-head',h=>h.map(x=>x.textContent)),['Your rules','Your list in Gmail','Schedule','Quiet hours and summaries','Keep the Inbox tidy']);
    assert.doesNotMatch(await page.$eval('.watch-sheet',e=>{const c=e.cloneNode(true);c.querySelector('#w-rules')?.remove();return c.textContent;}),/Sonnet|Haiku|Opus|\$/,'no model names or dollars (the owner\'s own rules may mention money)');
    await scan('inbox-watch-assistant-390');
   }finally{Object.assign(settings,before);await page.evaluate(()=>fetch('/api/inbox/reset',{method:'POST'}));if(vp)await page.setViewport(vp);await page.goto(base+'/#/');}
  });

  await check('1.68.1 Settings → Appearance: Mode shows Developer mode and Assistant mode with the current one pressed',async()=>{
   const settings=settingsState(),before={assistantMode:settings.assistantMode},vp=page.viewport();
   try{
    for(const [w,h] of [[390,844],[1440,900]])for(const assistant of [false,true]){
     settings.assistantMode=assistant;await page.setViewport({width:w,height:h});
     await page.goto(base+'/#/all');await page.reload();await page.waitForSelector('.session-home'); // a reload, so the page reads the mode afresh
     await page.evaluate(()=>settingsSheet({category:'appearance'}));await page.waitForSelector('#s-mode');
     assert.deepEqual(await page.$$eval('#s-mode [data-pocket-mode]',b=>b.map(x=>[x.dataset.pocketMode,x.textContent.trim(),x.getAttribute('aria-pressed')])),[['developer','Developer mode',String(!assistant)],['assistant','Assistant mode',String(assistant)]],'the current mode is pressed at '+w+' assistant='+assistant);
     assert.ok((await page.$$eval('#s-mode [data-pocket-mode]',b=>b.map(x=>x.getBoundingClientRect().height))).every(x=>x>=44),'44px targets');
     assert.equal(await page.$('#s-assistant'),null,'the 1.60 switch is gone');
     assert.match(await page.$eval('#s-mode .chat-text-help',e=>e.textContent),/Developer mode is the full workbench/);
     if(!assistant){await page.mouse.move(1,1);await page.evaluate(()=>document.querySelector('#tip')?.setAttribute('hidden',''));await scan('settings-mode-'+w);} // the hover tip from the reload is not part of this surface
     await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.settings-sheet'));
    }
   }finally{Object.assign(settings,before);if(vp)await page.setViewport(vp);await page.goto(base+'/#/');}
  });

  await check('1.67 Settings: automatic model choice and one sign-in are set here, with the levels, the key state and the sign-in fields',async()=>{
   const vp=page.viewport();
   try{
    for(const [w,h] of [[390,844],[1440,900]]){
     await page.setViewport({width:w,height:h});await page.goto(base+'/#/all');await page.waitForSelector('.session-home');
     await page.evaluate(()=>settingsSheet({category:'agents'}));await page.waitForFunction(()=>document.querySelectorAll('#s-router-levels .router-level').length===4);
     assert.equal(await page.$eval('#s-router-on',b=>b.getAttribute('aria-pressed')),'true');
     assert.equal(await page.$eval('#s-router-provider',s=>s.value),'jev');
     assert.match(await page.$eval('#s-router-key-note',p=>p.textContent),/never shown again/);
     assert.deepEqual(await page.$$eval('#s-router-levels .router-level-name',ns=>ns.map(n=>n.firstChild.textContent)),['Quick','Standard','Careful','Deep']);
     assert.deepEqual(await page.$eval('#s-router-levels [data-level-effort]',s=>[...s.options].map(o=>o.value)),['auto','high','medium','low'],'no effort above the policy ceiling');
     assert.match(await page.$eval('#s-router-note',p=>p.textContent),/caps effort at High/);
     assert.match(await page.$eval('#s-access-state',p=>p.textContent),/owner@example\.test can sign in/);
     assert.equal(await page.$eval('#s-access-team',i=>i.value),'example');
     await page.$eval('#s-router',el=>el.scrollIntoView());await page.screenshot({path:path.join(out,`settings-router-${w}.png`)});
     await page.$eval('#s-access',el=>el.scrollIntoView());await page.screenshot({path:path.join(out,`settings-access-${w}.png`)});
     await scan('settings-router-access-'+w);
     await page.keyboard.press('Escape');
    }
   }finally{if(vp)await page.setViewport(vp);}
  });

  await check('1.77.4 Sending a message and a turn ending refresh only the message list: the sidebar, header and composer stay, the list never goes empty, and no message replays its fade-in',async()=>{
   const vp=page.viewport(),convo=conversations.get(idle),kept=convo.length;
   const keep=['.rail','.bar','#comp','#box','#msgs'];
   try{
    for(const [w,h] of [[1440,900],[390,844]]){
     await page.setViewport({width:w,height:h,isMobile:w<700,hasTouch:w<700});
     await page.evaluate(()=>closeCurrentSheet?.());await openChat(idle); // a sheet left open makes the app inert
     // Tag what a full render replaces, and count every moment the list has no message in it (a full render empties it until the transcript arrives).
     const tagged=await page.evaluate(keep=>{const found=keep.filter(s=>document.querySelector(s));found.forEach(s=>{document.querySelector(s).dataset.keep='1';});
      window.__emptied=0;window.__listObs=new MutationObserver(()=>{if(!document.querySelector('#msgs .m-user'))window.__emptied++;});
      window.__listObs.observe(document.querySelector('#app'),{childList:true,subtree:true});return found;},keep);
     assert.ok(tagged.includes('#msgs')&&tagged.includes('#comp'),'the conversation is on screen at '+w);
     if(w>=1440)assert.ok(tagged.includes('.rail'),'the sidebar is open at '+w);
     const stillThere=()=>page.evaluate(found=>found.filter(s=>document.querySelector(s)?.dataset.keep!=='1'),tagged);
     setMode({sessionDelay:400});
     const text='Check the overnight camera report '+w;
     await page.evaluate(id=>{clearDraft(id);const b=document.querySelector('#box');b.value='';},idle); // an earlier check leaves a draft in this conversation
     await page.bringToFront();await page.type('#box',text);assert.equal(await page.$eval('#box',b=>b.value),text,'the box holds the message at '+w);await clickControl(page,'#send');
     await page.waitForFunction(t=>[...document.querySelectorAll('#msgs .m-user')].some(m=>m.textContent.includes(t))&&!document.querySelector('#msgs .pending')&&!sendsInFlight.size,{},text);
     assert.deepEqual(await stillThere(),[],'nothing but the list is rebuilt after a send at '+w);
     assert.equal(await page.evaluate(()=>window.__emptied),0,'the list never went empty after a send at '+w);
     assert.equal(await page.$$eval('#msgs .enter',ns=>ns.length),0,'1.77.5: no message on screen replays its fade-in after a send at '+w);
     assert.equal(await page.$$eval('#msgs .m-user',(ms,t)=>ms.filter(m=>m.textContent.includes(t)).length,text),1,'the message shows once at '+w);
     // A turn's end ("done" on the stream) resyncs the same way.
     const reply='Report reviewed, nothing missing '+w;
     convo.push({role:'assistant',blocks:[{t:'text',text:reply}]});setMode({streamDone:true});
     await page.evaluate(()=>openES());
     await page.waitForFunction(t=>document.querySelector('#msgs')?.textContent.includes(t),{},reply);
     assert.deepEqual(await stillThere(),[],'nothing but the list is rebuilt at a turn end at '+w);
     assert.equal(await page.evaluate(()=>window.__emptied),0,'the list never went empty at a turn end at '+w);
     assert.equal(await page.$$eval('#msgs .enter',ns=>ns.length),0,'1.77.5: no message on screen replays its fade-in at a turn end at '+w);
     await page.evaluate(()=>window.__listObs.disconnect());
     setMode({sessionDelay:0});
    }
   }finally{setMode({sessionDelay:0,streamDone:false});convo.splice(kept);if(vp)await page.setViewport(vp);await page.goto(base+'/#/');}
  });

  fs.writeFileSync(path.join(out,'ui-regressions.json'),JSON.stringify({checks,scans,errors},null,2));
  console.log(JSON.stringify({uiRegressions:checks.length,accessibilityScans:scans.length,ok:true}));
 } catch(e) {
  await page.screenshot({path:path.join(out,'ui-regression-failure.png')});
  fs.writeFileSync(path.join(out,'ui-regressions.json'),JSON.stringify({checks,scans,errors,error:e.message},null,2));throw e;
 } finally {setMode({workerFailed:false,aboutFailed:false});await context.close();}
}

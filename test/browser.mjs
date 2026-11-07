import {clickControl} from './ui-controls.mjs';
import {runCoordinationRegressions} from './coordination-browser.mjs';
// Deterministic frontend acceptance checks. This serves fixtures only: no real
// sessions, credentials, CLI, or production service is involved.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {createHash} from 'node:crypto';
import {runUIRegressions} from './ui-regressions.mjs';
import {captureDocs} from './docs-screenshots.mjs';
import {ProjectStore} from '../projects.mjs';
import {DocumentStore,mimeOf} from '../documents.mjs';
import {TaskStore} from '../tasks.mjs';
import {InboxStore} from '../inbox.mjs'; // 1.69
import {VaultStore,newKey,parseKey} from '../vault.mjs';
import {resolveOffer} from '../models.mjs';
import {validateRules} from '../trusted.mjs';
import '../public/secret-detect.js'; // 1.42: globalThis.PocketSecrets, the detector the server uses
const repo=path.resolve(import.meta.dirname,'..');
const out=process.env.POCKET_SCREENSHOTS || fs.mkdtempSync(path.join(os.tmpdir(),'pocket-browser-'));
fs.mkdirSync(out,{recursive:true});
const now=Date.now();
const rows=[
 {id:'11111111-1111-4111-8111-111111111111',title:'Warehouse stock report',cwd:'/workspaces/warehouse',provider:'claude',mtimeMs:now,state:{kind:'running',label:'Running',confirmed:true,startedAt:now-240000,queued:1}},
 {id:'cx:22222222-2222-4222-8222-222222222222',title:'Product photos and listing updates',cwd:'/workspaces/products',provider:'codex',mtimeMs:now-30000,state:{kind:'observed',label:'Activity elsewhere'}},
 {id:'33333333-3333-4333-8333-333333333333',title:'Supplier inventory import',cwd:'/workspaces/inventory',provider:'claude',mtimeMs:now-100000,state:{kind:'failed',label:'Turn failed',at:now-100000}},
 {id:'44444444-4444-4444-8444-444444444444',title:'Monthly warehouse summary',cwd:'/workspaces/warehouse',provider:'claude',mtimeMs:now-200000,state:{kind:'finished',label:'Response ready',at:now-200000}},
 {id:'55555555-5555-4555-8555-555555555555',title:'Camera ordering review with a deliberately long title that remains readable on a narrow phone',cwd:'/workspaces/purchasing',provider:'claude',mtimeMs:now-300000,state:{kind:'idle',label:'Recent'}},
];
const idle=rows.at(-1);let dispatches=0,failNext=false,stale=false;const receipts=new Map();const received=[];
const uploads=[];let uploadDelay=0;
const uiModes={aboutFailed:false,workerFailed:false,voice:true,voiceText:'Please review the incoming quantities again.'};
let loginState={status:'idle'},loginSequence=0;const loginCodes=[];
const voiceLog={transcribe:[],speak:[]};const pinOrders=[];
const pinKey=s=>s.pinned?(Number.isFinite(s.pinOrder)?s.pinOrder:1e9):1e10; // the live server lists pins first, in their chosen order
// 0.2 s of silence at 24 kHz: a valid reply for the speak fixture.
const silentWav=(()=>{const n=4800,b=Buffer.alloc(44+n*2);b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);return b;})();
// 1.67: what Settings shows for automatic model choice and one sign-in (static: the server tests cover the logic).
const fixtureRouter=()=>{const sonnet='claude-sonnet-5-5',opus='claude-opus-5-5[1m]';const lv=[['quick','Quick',sonnet,'low'],['standard','Standard',sonnet,'medium'],['careful','Careful',sonnet,'high'],['deep','Deep',opus,'high']];
 return {enabled:true,enabledSource:'settings',provider:'jev',providers:['jev','openai'],keySource:'settings',active:true,maxEffort:'high',last:{at:Date.now()-120000,tier:'deep',confidence:.93,ms:142,used:{model:opus,effort:'high',tier:'deep'}},
  levels:lv.map(([key,label,model,effort])=>({key,label,about:'What this level is for.',chosen:null,auto:{model,effort,tier:key},runs:{model,effort,tier:key}}))};};
const fixtureAccess=()=>({on:true,source:'settings',off:false,team:'example',aud:'a'.repeat(32),emails:['owner@example.test'],last:{at:Date.now()-300000,email:'owner@example.test'},envSet:false});
let fixtureSettings={titleSync:false,autoTitles:true,titleProvider:'auto',awaySummaries:true,projects:false,documents:false,tasks:false,inbox:false,vault:false,vaultReady:true,vaultCanCreateKey:false,vaultNeedsKey:false,vaultMode:'key',vaultLocked:false,vaultAutoLockMinutes:0,vaultAccess:'once',secretGuard:true,remindAhead:0,notifyEmail:''};
// 1.52: the picker's models. The fixture's Claude Code policy blocks Fable; a saved choice also drives /api/claude/models.
const fixturePolicy={availableModels:null,deniedModels:['fable'],availableModelsMatch:'prefix'};
const fixtureOffer=saved=>resolveOffer({saved:Array.isArray(saved)?saved:null,envList:null,policy:fixturePolicy});
const fixtureClaudeModels=()=>({...fixtureOffer(fixtureSettings.offeredClaudeModels),env:null,saved:Array.isArray(fixtureSettings.offeredClaudeModels),
 policy:{dir:'/etc/claude-code',files:['/etc/claude-code/managed-settings.json'],limits:true,error:null},pocketDefault:{configured:null,used:null,label:'Test agent'}});
// 1.56: actions that run without asking. The fixture server's POCKET_TRUSTED_ACTIONS names one rule and skips one.
const fixtureTrustedEnv=['Bash(techpro-lookup:*)'];
const fixtureTrusted=()=>{const saved=Array.isArray(fixtureSettings.trustedActions);return {rules:saved?fixtureSettings.trustedActions:fixtureTrustedEnv,source:saved?'settings':'env',saved,env:fixtureTrustedEnv,envIgnored:[{rule:'Edit',error:'Edit changes files, so it always asks.'}]};};
// 1.50: the fixture server has mail set up (so Settings shows the address field) and records test messages.
const fixtureEmail=()=>({configured:true,from:'pocket@example.test',to:fixtureSettings.notifyEmail||'',on:Boolean(fixtureSettings.notifyEmail),hook:false,error:null,base:'http://localhost'});
// 1.42: like the server, a message that looks like it carries a secret is refused (422) before any receipt, unless allowSecrets.
const secretRefusal=body=>{if(fixtureSettings.secretGuard===false||body.allowSecrets===true)return null;const hits=globalThis.PocketSecrets.scan(String(body.text||''),{mode:'message'});return hits.length?{error:'This message looks like it contains a secret, so it was not sent.',code:'secret_detected',matches:hits.map(({kind,label,name,vaultKind,start,end})=>({kind,label,name,vaultKind,start,end}))}:null;};
// 1.40: the passphrase the fixture checks (never sent back on /api/settings), and the last import's decoded file.
// 1.41: extraRequests are added to the snapshot's requests as they are (a request on an item that asks every time).
const vaultFixture={passphrase:null,imported:null,extraRequests:[],key:null}; // 1.44: key is the fixture store's key, the recovery key the routes hand out
const coordFixture={holds:[],recent:[],released:[],failNext:false,reset(holds){const ago=m=>Date.now()-m*60000-5000;this.released=[];this.failNext=false;
 this.holds=holds||[{name:'dad-staging',reason:'Building and verifying',holder:{kind:'conversation',session:'f00d0000-0000-4000-8000-0000000000aa',title:'DAD 1.168 build'},heldAt:ago(12),expiresAt:Date.now()+48*60000,ttlMs:3600000,waiters:[{id:'w1',kind:'conversation',session:'f00d0000-0000-4000-8000-0000000000ab',at:ago(4),block:false,title:'PayPal fix'}]},
  {name:'tpv-deploy',reason:'Rolling out to the Oaks recorder from a terminal on the ops box, so wait for it to finish',holder:{kind:'terminal',session:null,title:''},heldAt:ago(185),expiresAt:Date.now()+295*60000,ttlMs:28800000,waiters:[]}];
 this.recent=[{name:'pocket-main',reason:'Release',holder:{kind:'conversation',session:'f00d0000-0000-4000-8000-0000000000aa',title:'Release 1.98'},heldAt:ago(90),endedAt:ago(40),event:'released',note:'Deployed and checked'},
  {name:'dad-production',reason:'Rollout',holder:{kind:'terminal',session:null,title:''},heldAt:ago(300),endedAt:ago(120),event:'expired',note:''},
  {name:'staging-db',reason:'Reset',holder:{kind:'conversation',session:'f00d0000-0000-4000-8000-0000000000ab',title:'Database reset'},heldAt:ago(500),endedAt:ago(200),event:'owner',note:''}];}};
coordFixture.reset();
const resetVaultLock=()=>{Object.assign(fixtureSettings,{vaultMode:'key',vaultLocked:false,vaultAutoLockMinutes:0,vaultAccess:'once',vaultCanCreateKey:false,vaultNeedsKey:false});vaultFixture.passphrase=null;vaultFixture.imported=null;vaultFixture.extraRequests=[];};
// 1.30: the documents fixture is the real store on a scratch folder: an HTML dashboard whose script tries to reach
// the parent (the sandbox must stop it), a Markdown note and a CSV.
const docsDir=path.join(out,'documents');fs.mkdirSync(docsDir,{recursive:true});
fs.writeFileSync(path.join(docsDir,'ops-dashboard.html'),'<!doctype html><html><head><title>Ops dashboard</title></head><body style="font-family:sans-serif;padding:24px"><h1>Ops dashboard</h1><p id="probe">probing…</p><script>try{document.getElementById("probe").textContent=(parent.document?"REACHED PARENT":"isolated");}catch(e){document.getElementById("probe").textContent="isolated: "+e.name}</script></body></html>');
fs.writeFileSync(path.join(docsDir,'weekly-summary.md'),'# Weekly summary\n\nStock counts are **reconciled**.\n\n- Aisle 4 recounted\n- Adjustment posted\n');
fs.writeFileSync(path.join(docsDir,'count-sheet.csv'),'Aisle,On hand,Incoming\n1,24,12\n4,8,4\n');
const docStore=new DocumentStore(docsDir,path.join(out,'documents.json'));
const seedDocs=()=>{for(const f of fs.readdirSync(docsDir))if(!['ops-dashboard.html','weekly-summary.md','count-sheet.csv'].includes(f))fs.rmSync(path.join(docsDir,f),{recursive:true,force:true}); // a previous run's kept or uploaded files
 docStore.documents.length=0;docStore.scan();const md=docStore.documents.find(d=>d.file==='weekly-summary.md');if(md){md.project='warehouse-stock-report';md.session=rows[0].id;docStore.save();}};
seedDocs();
// 1.29: the projects fixture is the real store on a scratch file, so the browser checks exercise its rules.
// 1.36: tasks on a scratch file: one due, one dated later, one plain, one done, one from a session with its briefing.
const taskStore=new TaskStore(path.join(out,'tasks.json'));
const seedTasks=()=>{taskStore.tasks.length=0;
 taskStore.act({action:'add',text:'Send the aisle 4 recount to purchasing',dueAt:new Date(now-3600000).toISOString(),session:rows[0].id,sessionTitle:rows[0].title,directory:rows[0].cwd,summary:'Recounting aisle 4 against the Friday delivery.\nAisles 1-3 reconcile; aisle 4 is 14 units short.\nThe recount sheet is in results.'});
 taskStore.act({action:'add',text:'Chase the revised camera quote',dueAt:new Date(now+3*86400000).toISOString()});
 taskStore.act({action:'add',text:'Read the TVT firmware notes'});
 const d=taskStore.act({action:'add',text:'Book the forklift service'});taskStore.act({action:'update',task:d.id,done:true});};
// 1.39: the vault is the real store on a scratch vault.enc under a test key: an API key that asks (one approved command),
// a login agents may use that expires in 5 days, an owner-only note, a removed token, and one request waiting for the owner.
// 1.39.1: Credentials with two custom fields, and an API key that carries one custom field beside its key.
// 1.41: zoho-books and acme-oauth follow the Vault default (Agent access); square-hooks sets its own (asks once per command).
const vaultDir=path.join(out,'vault');let vaultStore=null;
const seedVault=()=>{fs.rmSync(vaultDir,{recursive:true,force:true});fs.mkdirSync(vaultDir,{recursive:true});
 vaultFixture.key=newKey();vaultStore=new VaultStore(path.join(vaultDir,'vault.enc'),{key:parseKey(vaultFixture.key)});vaultStore.access=()=>fixtureSettings.vaultAccess||'once';
 // 1.93: the items were added an hour apart, ten days ago, so Newest first has one order; square-hooks is the newest.
 let added=now-10*86400000;const act=vaultStore.act.bind(vaultStore);vaultStore.now=()=>added;vaultStore.act=(...a)=>{const r=act(...a);if(a[0]?.action==='add')added+=3600000;return r;};
 vaultStore.act({action:'add',name:'zoho-books',kind:'api_key',values:{value:'zk-fixture-secret-7731'},url:'https://books.zoho.com',tags:['billing']});
 vaultStore.act({action:'add',name:'vendor-portal',kind:'login',values:{username:'ops@example.test',password:'portal-fixture-pass'},url:'https://portal.example.test',policy:'auto',expiresAt:new Date(now+5*86400000).toISOString()});
 vaultStore.act({action:'add',name:'bank-recovery',kind:'note',values:{text:'recovery codes fixture'},policy:'owner'});
 vaultStore.act({action:'add',name:'acme-oauth',kind:'credentials',values:{client_id:'acme-client-fixture',client_secret:'acme-secret-fixture-4410'},url:'https://auth.acme.test'});
 vaultStore.act({action:'add',name:'square-hooks',kind:'api_key',values:{value:'sq-fixture-key-2208',signature_key:'sq-signature-fixture-6631'},policy:'ask'});
 const old=vaultStore.act({action:'add',name:'old-twilio',kind:'token',values:{value:'tw-fixture-old'}});vaultStore.act({action:'remove',item:old.id});
 vaultStore.act=act;vaultStore.now=Date.now;
 const ask=argv=>{const env={TOKEN:'zoho-books'},bound=vaultStore.resolveBindings(env),cmd=vaultStore.checkCommand(argv,vaultDir);return vaultStore.request({bound,cmd,need:vaultStore.decide(bound,cmd),env,session:rows[0].id,sessionTitle:rows[0].title});};
 vaultStore.answer(ask(['node','sync-invoices.mjs']).id,'always');
 ask(['node','export-ledger.mjs','--month','2026-09']);};
seedVault();
const board=new ProjectStore(path.join(out,'projects.json'));
const seedBoard=()=>{board.projects.length=0;
 const a=board.act({action:'track',name:'Warehouse stock report',summary:'Counts for aisles 1-3 are reconciled against MOM. Aisle 4 still shows 14 units unaccounted for.',next:'Recount aisle 4 with the Friday delivery excluded, then post the adjustment.',directory:'/workspaces/warehouse',link:'https://example.test/stock',session:rows[0].id});
 board.act({action:'task-add',project:a.id,text:'Reconcile aisles 1-3 against MOM'});const t=board.act({action:'task-add',project:a.id,text:'Recount aisle 4 excluding Friday delivery'}).tasks[1];
 board.act({action:'task-update',project:a.id,task:board.get(a.id).tasks[0].id,done:true});
 board.act({action:'remind',project:a.id,at:new Date(now-3600000).toISOString(),task:t.id});
 const b=board.act({action:'track',name:'Supplier inventory import',summary:'CSV mapping drafted for ENS and Centro feeds.',next:'Run the dry import against staging and compare counts.',directory:'/workspaces/inventory',session:rows[2].id});
 board.act({action:'task-add',project:b.id,text:'Dry run on staging'});
 const c=board.act({action:'track',name:'Camera ordering review',summary:'Vendor quotes collected; waiting on the revised pricing.',next:'Compare the revised quote and decide.'});
 board.act({action:'update',project:c.id,status:'waiting',waitingFor:'Revised vendor quote'});board.act({action:'remind',project:c.id,at:new Date(now+5*86400000).toISOString(),text:'Chase the revised quote'});
 const d=board.act({action:'track',name:'Monthly warehouse summary',summary:'September summary sent.'});board.act({action:'update',project:d.id,status:'done'});
};
// 1.69: Inbox Watch entries: a new alert with a start link and a Gmail thread, an opened digest kept in Files, a resolved alert.
const inboxStore=new InboxStore(path.join(out,'inbox.json'));
const seedInbox=()=>{inboxStore.entries.length=0;inboxStore.sources={};
 const r=inboxStore.add({kind:'alert',title:'Lakeview alarm timer tests',text:'Ten missed tests since October 13. [Latest](msg:1a151dff1dfb590e)',story:'lakeview-late-alarm-test',source:'inbox-monitor',url:'/#/start/0123456789ac'},{actor:'cli'});inboxStore.act({action:'resolve',id:r.id});
 const d=inboxStore.add({kind:'digest',title:'Morning email digest — Mon Oct 19',text:'## Worth knowing\n- Storefront payout deductions: the scheduled payout includes $267.48 in deductions.\nIgnored since the last digest: 142 threads.',source:'inbox-monitor',doc:'4897fe3220c8',dedupe:'digest|2026-10-19'},{actor:'cli'});inboxStore.act({action:'open',id:d.id});
 inboxStore.add({kind:'alert',priority:'high',title:'Oakridge dispatch conflict',text:'Robin says the visit was supposed to be last night and asks that nobody be dispatched, while the 8:03 notice has Jordan on the way for 9–10. [Call transcript](msg:1a1540e0de10f879) · [Dispatch notice](msg:1a1540b3f8676388) Avery should reach Jordan before 9 a.m.',story:'oakridge-service-scheduling',source:'inbox-monitor',url:'/#/start/0123456789ab',gmail:'https://mail.google.com/mail/u/0/#all/1a1540b3f8676388',dedupe:'oakridge|1'},{actor:'cli'});
 inboxStore.seen('inbox-monitor');
 // 1.70: the watcher's profile, as inbox-monitor 0.3 sends it with its heartbeat; no owner settings yet
 inboxStore.profiles={};inboxStore.watch={};
 inboxStore.seen('inbox-monitor',undefined,{version:1,timezone:'America/New_York',defaults:{paused:false,every:5,periods:[{name:'Overnight',days:[0,1,2,3,4,5,6],from:'22:00',to:'07:00',every:30}],quietHours:[22,8],digestHour:8,scope:{mode:'all',labels:[]},lookahead:{morning:8,evening:17},models:{decisions:{model:'sonnet',reasoning:'medium'},lookahead:{model:'opus',reasoning:'medium'}},firstPass:{enabled:true,provider:'jev',threshold:0.8},tidy:{enabled:true,every:2},gmailLabel:{enabled:true}},
  options:{every:[0,1,2,3,5,10,15,20,30,45,60,90,120,180,240],models:[{id:'haiku',label:'Haiku 5.5'},{id:'sonnet',label:'Sonnet 5.5'},{id:'opus',label:'Opus 5.5'},{id:'fable',label:'Fable 5.1'}],reasoning:[{id:'default',label:'Model default'},{id:'low',label:'Low'},{id:'medium',label:'Medium'},{id:'high',label:'High'}],judge:'claude',maxPeriods:12,tidyEvery:[1,2,4,8,12,24],labels:['Customers','Billing/Invoices','Newsletters and very long vendor updates from the distributor list'],
   gmailLabel:{available:true,name:'Pocket Inbox',reason:null},firstPass:{available:true,providers:[{id:'jev',label:'Jev (TypeSafe)'},{id:'openai',label:'OpenAI decision model'},{id:'both',label:'Both must agree'}],thresholds:[0.95,0.9,0.8,0.7]}},
  rules:{text:'## Always tell me\n- Every sale from the web store over $500.\n\n## Never tell me\n- Newsletters and webinar invitations.\n',max:8000},
  applied:{from:'config',revision:null},status:{paused:false,every:5,period:'',lastCheckAt:new Date(Date.now()-120000).toISOString(),nextCheckAt:new Date(Date.now()+180000).toISOString(),backlog:0},
  usage:{billing:'plan',costBasis:'list',since:'2026-10-20T13:00:00Z',days:[{date:'2026-10-21',checks:190,threads:410,calls:150,failed:0,inputTokens:6400000,cacheWriteTokens:0,cacheReadTokens:0,outputTokens:120000,costUsd:15.62,decisions:{calls:148,costUsd:14.2},lookahead:{calls:2,costUsd:1.42},firstPass:{checked:300,skipped:120,costUsd:0.012}},{date:'2026-10-20',checks:240,threads:520,calls:180,failed:1,inputTokens:7900000,cacheWriteTokens:0,cacheReadTokens:0,outputTokens:150000,costUsd:19.04,decisions:{calls:178,costUsd:17.5},lookahead:{calls:2,costUsd:1.54}},{date:'2026-10-19',checks:277,threads:543,calls:0,failed:0,inputTokens:0,cacheWriteTokens:0,cacheReadTokens:0,outputTokens:0,costUsd:null,decisions:{calls:0,costUsd:null},lookahead:{calls:0,costUsd:null}}]}});};
seedBoard();seedTasks();seedInbox();
// Mirrors the server's titleSettings() (1.20): Claude signed in, Codex without GPT-6-Luna.
const fixtureTitles=()=>{const using=!fixtureSettings.autoTitles?null:fixtureSettings.titleProvider==='codex'?null:'claude';
 return {enabled:fixtureSettings.autoTitles,choice:fixtureSettings.titleProvider,using,helper:'claude',awaySummaries:fixtureSettings.awaySummaries,models:{claude:'haiku',codex:'gpt-6-luna'},
  claude:{available:true,reason:''},codex:{available:false,reason:'This Codex CLI does not offer gpt-6-luna. Update Codex to use it.'},
  last:{provider:'claude',model:'claude-haiku-4-5-20251001',at:Date.now()},checkedAt:Date.now()};};
const worktreeRows={'vault-fix':{group:'use',reason:'Used in the last 24 hours',branch:'fix/vault',conversations:[{id:'f00d0000-0000-4000-8000-0000000000aa',title:'Stock count export'}]},'report-v2':{group:'work',reason:'2 uncommitted changes',branch:'feat/report-v2'},'stock-sync':{group:'ready',reason:'Merged in PR #41',branch:'feat/stock-sync'}};let worktreeRemoved=null;
let questionRequests=[];let questionAnswers=null;
let approvalRequests=[],approvalDecisions=[],approvalFail=false;
const queueStarts=[]; // 1.89.2: queue/start requests (Stop background jobs and send now)
const queueRows=[{id:'q1',revision:1,text:'Check incoming quantities before placing an order.',status:'pending'}];
// 1.54.1: with Files on, the first session's conversation ends with a link to one of the kept files (the link test clicks it).
const messagesOf=id=>{const m=conversations.get(id);if(id!==rows[0].id||!fixtureSettings.documents)return m;const d=docStore.documents.find(x=>x.file==='weekly-summary.md');return d?[...m,{role:'assistant',blocks:[{t:'text',text:'Kept in Files: [Weekly summary]('+base+'/#/documents/'+d.id+').'}]}]:m;};
const report='## Inventory review\n\n| Product | On hand | Incoming | Supplier reference |\n|---|---:|---:|---|\n| Outdoor camera | 24 | 12 | WAREHOUSE-LONG-REFERENCE-001 |\n| Recorder | 8 | 4 | PURCHASE-ORDER-2026-10-03 |\n\n> Incoming stock is separate from the on-hand count.\n\n1. Review stock\n   - Exclude discontinued products\n   - Check expected delivery dates\n2. Confirm the order\n\n[Open the report](https://example.com/inventory)';
const conversations=new Map(rows.map(r=>[r.id,[{role:'user',text:'Review the stock report.'},{role:'assistant',blocks:[{t:'text',text:report}]}]]));
// 1.78 side chat: a scripted side chat that answers each question, streaming events the way the daemon does.
const sideFixture={n:0,id:null,live:false,events:[],subs:new Set(),posts:[],total:0,turns:0,branchPosts:[],lineage:{},
 push(e){this.events.push(e);const i=this.events.length-1;for(const r of this.subs)r.write(`id: ${i}\ndata: ${JSON.stringify(e)}\n\n`);}};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const json=(body,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
 // 1.79 Branch: the new conversation is an existing fixture row, which then reads as a branch of the parent.
 if(req.method==='POST'&&/^\/api\/session\/[^/]+\/branch$/.test(url.pathname)){
  let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw||'{}'),parent=decodeURIComponent(url.pathname.split('/')[3]);
  sideFixture.branchPosts.push({parent,...b});
  const child=rows.find(r=>r.id==='55555555-5555-4555-8555-555555555555'),p=rows.find(r=>r.id===parent);
  sideFixture.lineage[child.id]={branchOf:{id:parent,title:p?.title||'Parent'}};sideFixture.lineage[parent]={branches:[{id:child.id,title:'Branch: '+b.text}]};
  return json({id:child.id},202);
 }
 if(url.pathname.startsWith('/api/side/')||/^\/api\/session\/[^/]+\/side$/.test(url.pathname)){ // 1.78
  const sc=sideFixture,m=url.pathname.match(/^\/api\/side\/([^/]+)(\/events|\/stop)?$/);
  if(req.method==='GET'&&url.pathname.endsWith('/side'))return json({enabled:true,chat:sc.live?{side:sc.id,model:'claude-opus-5-5[1m]',busy:false,closed:null,total:sc.total,turns:sc.turns}:null});
  if(req.method==='POST'&&url.pathname.endsWith('/side')){
   let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw||'{}');sc.posts.push({path:url.pathname,...b});
   if(!sc.live||b.side!==sc.id){sc.id='side-'+ ++sc.n;sc.events=[];sc.live=true;sc.total=0;sc.turns=0;}
   sc.turns++;sc.total+=0.25;const total=sc.total;
   sc.push({type:'user',msg:{role:'user',text:b.text,ts:new Date().toISOString()}});
   setTimeout(()=>{sc.push({type:'delta',text:'Side '});sc.push({type:'assistant',msg:{role:'assistant',blocks:[{t:'text',text:'Side answer: **'+b.text+'**'}],ts:new Date().toISOString()}});sc.push({type:'result',ok:true,error:null,cost:0.25,total,duration_ms:1200});},120);
   return json({ok:true,side:sc.id,model:'claude-opus-5-5[1m]',busy:true,closed:null,total,turns:sc.turns},202);
  }
  if(m?.[2]==='/events'){
   if(m[1]!==sc.id)return json({error:'This side chat has ended.'},404);
   res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
   const last=Number(req.headers['last-event-id']),from=Number.isFinite(last)?last+1:Number(url.searchParams.get('from'))||0;
   sc.events.slice(from).forEach((e,i)=>res.write(`id: ${from+i}\ndata: ${JSON.stringify(e)}\n\n`));
   sc.subs.add(res);req.on('close',()=>sc.subs.delete(res));return;
  }
  if(m?.[2]==='/stop')return json({ok:true});
  if(m&&req.method==='DELETE'){sc.live=false;sc.push({type:'closed',why:'closed'});return json({ok:true});}
  return json({error:'not found'},404);
 }
 if(url.pathname.startsWith('/mission-control/')&&process.env.MISSION_CONTROL_REPO){
  const rel=url.pathname.slice('/mission-control/'.length),file=path.join(process.env.MISSION_CONTROL_REPO,'web',rel);
  if(!file.startsWith(path.join(process.env.MISSION_CONTROL_REPO,'web')+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  let body=fs.readFileSync(file);
  if(rel.endsWith('.html'))body=Buffer.from(body.toString().replaceAll('https://claude.bbesner.com','http://localhost:'+server.address().port).replaceAll('href="/','href="/mission-control/').replaceAll('src="/','src="/mission-control/'));
  res.writeHead(200,{'content-type':rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':'text/html'});res.end(body);return;
 }
 if(url.pathname==='/api/upload'){
  const chunks=[];for await(const c of req)chunks.push(c);
  const upload={name:req.headers['x-filename'],size:Buffer.concat(chunks).length};uploads.push(upload);
  if(uploadDelay)await new Promise(r=>setTimeout(r,uploadDelay));
  return json({name:upload.name,path:'/fixture/uploads/'+uploads.length+'-'+upload.name});
 }
 if(url.pathname==='/sw.js'&&uiModes.workerFailed){res.writeHead(503);res.end('Worker unavailable');return;}
 if(url.pathname==='/api/usage')return json({claude:{windows:{five_hour:{utilization:.17,resetsAt:Date.now()+3600000},seven_day:{utilization:.24,resetsAt:Date.now()+86400000}},observedAt:Date.now()},codex:null});
 if(/^\/api\/session\/[^/]+\/context$/.test(url.pathname))return json({context:uiModes.noContext?null:{used:435000,window:1000000,pct:.435,estimated:false,model:'claude-opus-5-5[1m]',lastAt:Date.now()},cache:uiModes.cache||null,serverNow:Date.now()});
 if(url.pathname==='/api/voice/status')return json(uiModes.voice?{available:true,voices:[{id:'af_heart',label:'American female'},{id:'bm_george',label:'British male (George)'}],defaultVoice:'af_heart'}:{available:false,reason:'Voice is not installed on this server. Run scripts/voice-setup.sh, then restart Pocket Code.'});
 if(url.pathname==='/api/voice/transcribe'){const chunks=[];for await(const c of req)chunks.push(c);voiceLog.transcribe.push({bytes:Buffer.concat(chunks).length,vocabulary:req.headers['x-vocabulary']||''});return json({text:uiModes.voiceText});}
 if(url.pathname==='/api/voice/speak'){let raw='';for await(const c of req)raw+=c;voiceLog.speak.push(JSON.parse(raw));res.writeHead(200,{'content-type':'audio/wav'});res.end(silentWav);return;}
 if(url.pathname.endsWith('/release')){let raw='';for await(const c of req)raw+=c;const stop=JSON.parse(raw||'{}').stop;return url.pathname.includes(rows[0].id)&&!stop?json({error:'Still running'},409):json({ok:true});}
 if(url.pathname==='/api/me')return json({ok:true,features:{coordination:Boolean(fixtureSettings.coordination)&&!fixtureSettings.assistantMode,projects:Boolean(fixtureSettings.projects),documents:Boolean(fixtureSettings.documents),tasks:Boolean(fixtureSettings.tasks),vault:Boolean(fixtureSettings.vault),inbox:Boolean(fixtureSettings.inbox),assistantMode:Boolean(fixtureSettings.assistantMode),assistantLocked:Boolean(fixtureSettings.assistantLocked)}});
 // 1.99: Coordination's two calls, on a list the test resets.
 if(url.pathname==='/api/coordination')return json({now:Date.now(),seeds:[],holds:coordFixture.holds,recent:coordFixture.recent});
 if(url.pathname==='/api/coordination/owner-release'){let raw='';for await(const c of req)raw+=c;const {name}=JSON.parse(raw),hold=coordFixture.holds.find(h=>h.name===name);coordFixture.holds=coordFixture.holds.filter(h=>h!==hold);
  if(coordFixture.failNext){coordFixture.failNext=false;return json({error:`${name} is already free.`,code:'not_held'},404);}
  coordFixture.released.push(name);coordFixture.recent=[{...hold,event:'owner',endedAt:Date.now(),note:''},...coordFixture.recent];return json({ok:true,name,woke:hold.waiters[0]?.title||null});}
 if(url.pathname==='/api/approval-policy')return json({defaultMode:'review',allowFullAccess:true});
 if(url.pathname.endsWith('/approvals'))return json({requests:approvalRequests,interrupted:Boolean(uiModes.approvalsInterrupted),activeMode:'review',defaultMode:'review',allowFullAccess:true});
 if(/\/approvals\/[^/]+\/decision$/.test(url.pathname)){
  let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);
  if(approvalFail)return json({error:'Decision delivery is uncertain. Review the conversation.'},503);
  approvalDecisions.push(body.decision);approvalRequests=[];return json({ok:true});
 }
 if(url.pathname==='/api/seen'){let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw||'{}'),out={};
  for(const [id,at] of Object.entries(body.seen||{})){const r=rows.find(x=>x.id===id);if(r&&at>(r.seenAt||0)&&uiModes.ignoreSeen!==id)r.seenAt=at;out[id]=r?.seenAt||0;} // ignoreSeen: a check that clears a marker must not be re-marked by a late upload from the page it just left
  for(const [id,at] of Object.entries(body.restore||{})){const r=rows.find(x=>x.id===id);if(r){if(at)r.seenAt=at;else delete r.seenAt;}out[id]=r?.seenAt||0;}
  return json({ok:true,seen:out});}
 if(url.pathname==='/api/sessions'){
  if(stale)return json({error:'Fixture offline'},503);
  // Like the live server (1.19): an unchanged list answers 304 with the check time in a header.
  const coordHeld=fixtureSettings.coordination&&!fixtureSettings.assistantMode?coordFixture.holds.map(h=>({name:h.name,title:h.holder.title})):[];
  const payload={sessions:[...rows].sort((a,b)=>pinKey(a)-pinKey(b)),warnings:[],home:'/workspaces/purchasing',...(coordHeld.length?{held:coordHeld}:{})},checkedAt=Date.now();
  const etag='"'+createHash('sha1').update(JSON.stringify(payload)).digest('base64url')+'"';
  if(req.headers['if-none-match']===etag){uiModes.notModified=(uiModes.notModified||0)+1;res.writeHead(304,{etag,'x-pocket-checked-at':String(checkedAt)});res.end();return;}
  res.writeHead(200,{'content-type':'application/json',etag,'x-pocket-checked-at':String(checkedAt)});res.end(JSON.stringify({...payload,checkedAt}));return;
 }
 if(url.pathname.endsWith('/pin')){let raw='';for await(const c of req)raw+=c;const r=rows.find(x=>x.id===decodeURIComponent(url.pathname.split('/').at(-2)));if(r){if(JSON.parse(raw||'{}').pinned)r.pinned=true;else{delete r.pinned;delete r.pinOrder;}}return json({ok:true,pinned:Boolean(r?.pinned)});}
 if(url.pathname==='/api/pins/order'){let raw='';for await(const c of req)raw+=c;const ids=JSON.parse(raw||'{}').ids||[];pinOrders.push(ids);ids.forEach((id,i)=>{const r=rows.find(x=>x.id===id);if(r?.pinned)r.pinOrder=i;});return json({ok:true,order:ids});}
 if(/^\/api\/start\/f00d[0-9a-f]{8}$/.test(url.pathname)){const id=url.pathname.slice(11),h=uiModes.handoffs?.[id];return h?json({ok:true,id,kind:'handoff',title:'Finish the Oakridge schedule',text:'Pick up the Oakridge schedule from the last draft. The dispatch list is done; the on-call rota for next week is not.',directory:'/workspaces/warehouse',provider:'claude',approvalMode:'review',...h}):json({error:'missing'},404);} // 1.96 handoff cards
 if(url.pathname.startsWith('/api/start/'))return /^\/api\/start\/[0-9a-f]{12}$/.test(url.pathname)?json({ok:true,id:url.pathname.slice(11),text:'Oakridge: Robin asks that nobody be dispatched. Reach Jordan before 9 a.m.',directory:uiModes.startDirectory||'/workspaces/warehouse',provider:'claude'}):json({error:'missing'},404); // 1.57 start links; 1.77 the Inbox briefing; 1.81 startDirectory: a link to another folder
 if(url.pathname==='/api/projects')return json(uiModes.lockedWorkspace?{projects:['/workspaces/warehouse'],defaultCwd:'/workspaces/warehouse',locked:true}:{projects:['/workspaces/warehouse','/workspaces/products'],...(uiModes.defaultCwd&&{defaultCwd:uiModes.defaultCwd})}); // 1.55: lockedWorkspace = one folder, nothing to choose; 1.81 defaultCwd: POCKET_DEFAULT_CWD
 if(url.pathname==='/api/commands')return json({commands:[{name:'inventory-report',label:'Inventory report',desc:'Review on-hand and incoming stock.',invocation:url.searchParams.get('provider')==='codex'?'Use the $inventory-report skill.':'Use the /inventory-report skill.'},{name:'product-listing',label:'Product listing',desc:'Prepare a new product listing.'}],...(url.searchParams.get('provider')==='codex'?{}:{available:['context','compact','init','recap','code-review']})});
 if(url.pathname==='/api/claude/models')return json(Array.isArray(fixtureSettings.offeredClaudeModels)?{models:fixtureOffer(fixtureSettings.offeredClaudeModels).models.filter(m=>m.offered).map(({id,label,sub})=>({id,label,sub})),defaultLabel:'Test agent',limited:true}:{models:[{id:'test',label:'Test agent'},{id:'claude-opus-5-5[1m]',label:'Opus 5.5'}],defaultLabel:'Test agent'});
 if(url.pathname==='/api/codex/models')return json({models:[{id:'test',label:'Test agent'},...Array.from({length:8},(_,index)=>({id:'gpt-fixture-'+index,label:'Fixture '+index})),{id:'gpt-6-sol',label:'GPT-6 Sol',efforts:['low','medium','high','xhigh','max','ultra']},{id:'gpt-6-astra',label:'GPT-6 Astra',efforts:['low','medium','high','xhigh','max']}],defaultModel:'gpt-6-sol',pocketDefault:true});
 if(url.pathname==='/api/push/key')return json({});
 if(url.pathname==='/api/push/prefs')return json({error:'This device is not subscribed.',code:'not_subscribed'},404); // push is off in the fixture
 if(url.pathname==='/api/notify/test-email'){if(!fixtureSettings.notifyEmail)return json({error:'Save an email address first.',code:'no_address'},400);(uiModes.mailLog??=[]).push({to:fixtureSettings.notifyEmail,subject:'[Pocket Code] Test: reminders will arrive like this'});return json({ok:true,to:fixtureSettings.notifyEmail});}
 if(url.pathname.startsWith('/api/inbox')){ // 1.69
  if(!fixtureSettings.inbox)return json({error:'Inbox Watch is off. Turn it on in Settings → Projects, files, tasks & vault.',code:'inbox_off'},404);
  if(url.pathname==='/api/inbox')return json({...inboxStore.snapshot({state:url.searchParams.get('state')||'new',since:url.searchParams.get('since')||undefined}),push:{enabled:false},email:Boolean(fixtureSettings.notifyEmail)});
  if(url.pathname==='/api/inbox/act'){let raw='';for await(const c of req)raw+=c;try{return json({ok:true,entry:inboxStore.act(JSON.parse(raw),{actor:'ui'})});}catch(e){return json({error:e.message},e.status||400);}}
  if(url.pathname==='/api/inbox/reset'){seedInbox();inboxStore.checks={};return json({ok:true});}
  if(url.pathname==='/api/inbox/digest-cards'){ // 1.95: a digest whose story is also an open alert, and two lines of its own
   const al=inboxStore.add({kind:'alert',title:'Gate controller offline',text:'The north gate stopped answering at 6:12.',story:'north-gate',source:'inbox-monitor'},{actor:'cli'});
   const d=inboxStore.add({kind:'digest',title:'Morning email digest — Sat Nov 7',text:'## Worth knowing\n- Payout deductions\nIgnored since the last digest: 12 threads.',source:'inbox-monitor',items:[
    {ref:'a1',section:'worth',title:'Payout deductions',text:'The scheduled payout includes $267.48 in deductions.',story:'payout',url:'/#/start/0123456789ad'},
    {ref:'a2',section:'worth',title:'Vendor price list',text:'The new price list starts Monday.',story:'vendor-prices',url:'/#/start/0123456789ae'},
    {ref:'a3',section:'worth',title:'North gate',text:'The north gate stopped answering.',story:'north-gate',url:'/#/start/0123456789af'},
   ]},{actor:'cli'});
   return json({ok:true,digest:d.id,alert:al.id});
  }
  if(url.pathname==='/api/inbox/lookahead-cards'){ // 1.95: a look-ahead with a story on the list, a story of its own and an item on no story
   const al=inboxStore.add({kind:'alert',title:'Gate controller offline',text:'The north gate stopped answering at 6:12.',story:'north-gate',source:'inbox-monitor'},{actor:'cli'});
   const l=inboxStore.add({kind:'lookahead',title:'Look-ahead · Sat 8 AM',text:'Three things worth catching before Monday:\n- The card payment has to settle by Tuesday.\n- North gate is still down.\n- Veterans Day closes the banks.',source:'inbox-monitor',items:[
    {ref:'c9.1',section:'ahead',title:'Card payment',text:'The card payment has to settle by Tuesday.',story:'card-payment',priority:'high',url:'/#/start/0123456789b1'},
    {ref:'c9.2',section:'ahead',title:'North gate',text:'North gate is still down.',story:'north-gate'},
    {ref:'c9.3',section:'ahead',title:'Veterans Day closes the banks.',text:'Veterans Day closes the banks.',url:'/#/start/0123456789b2'},
   ]},{actor:'cli'});
   return json({ok:true,lookahead:l.id,alert:al.id});
  }
  if(url.pathname==='/api/inbox/check')return json({ok:true,...inboxStore.requestCheck('')}); // 1.75: Check now
  if(url.pathname==='/api/inbox/check-done'){const k=inboxStore.watchSource(),p=inboxStore.profiles[k].profile;p.status={...p.status,checkRequestDone:inboxStore.checks[k]?.at};inboxStore.add({kind:'alert',title:'Added in Gmail: quote request',text:'Pat asks for a quote by Friday.',source:k},{actor:'cli'});return json({ok:true});} // the watcher reports it done, with what it found
  if(url.pathname==='/api/inbox/watch'){ // 1.70
   if(req.method==='POST'){let raw='';for await(const c of req)raw+=c;try{const b=JSON.parse(raw);return json({ok:true,...inboxStore.setWatch(b.source||'inbox-monitor',b.settings??null,{actor:'ui'})});}catch(e){return json({error:e.message,code:e.code},e.status||400);}}
   return json({ok:true,...inboxStore.watchView(url.searchParams.get('source')||'')});
  }
 }
 if(url.pathname.startsWith('/api/tasks')){ // 1.36
  if(!fixtureSettings.tasks)return json({error:'Tasks is off. Turn it on in Settings → Projects, files, tasks & vault.',code:'tasks_off'},404);
  if(url.pathname==='/api/tasks')return json({...taskStore.snapshot(),push:{enabled:false},hook:false,email:Boolean(fixtureSettings.notifyEmail)});
  if(url.pathname==='/api/tasks/act'){let raw='';for await(const c of req)raw+=c;try{return json({ok:true,task:taskStore.act(JSON.parse(raw),{actor:'ui'})});}catch(e){return json({error:e.message,...(e.task?{task:e.task}:{})},e.status||400);}}
  if(url.pathname==='/api/tasks/summary'){let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw||'{}');await new Promise(r=>setTimeout(r,uiModes.slowSummary?1500:50));return json(uiModes.noSummary?{summary:null,reason:'unavailable'}:{summary:'Reviewing the warehouse stock report for '+(rows.find(r=>r.id===b.session)?.title||'a session')+'.\nAisle 4 is still 14 units short after the recount.\nThe reorder list is drafted and waiting for a decision.',model:'haiku',provider:'claude'});}
  if(url.pathname==='/api/tasks/reset'){seedTasks();return json({ok:true});}
 }
 if(url.pathname==='/api/vault/restore-key'){let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw||'{}'); // 1.44: usable while the key is missing, on or off
  if(b.key!==vaultFixture.key)return json({error:'That key does not open this Vault.'},400);Object.assign(fixtureSettings,{vaultNeedsKey:false,vaultReady:true});return json({ok:true});}
 if(url.pathname.startsWith('/api/vault')){ // 1.39
  if(!fixtureSettings.vault)return json({error:'The Vault is off. Turn it on in Settings → Projects, files, tasks & vault.',code:'vault_off'},404);
  const body=async()=>{let raw='';for await(const c of req)raw+=c;return JSON.parse(raw||'{}');};
  const fail=e=>json({error:e.message,...(e.item?{item:e.item}:{}),...(e.code?{code:e.code}:{})},e.status||400);
  if(url.pathname==='/api/vault/reset'){resetVaultLock();seedVault();return json({ok:true});}
  // 1.40: passphrase mode. Unlock and the passphrase routes answer while locked; the snapshot is the locked one and
  // every other route answers 423, as the server does.
  const pass=fixtureSettings.vaultMode==='passphrase',longEnough=v=>typeof v==='string'&&v.length>=12;
  if(url.pathname==='/api/vault/unlock'){const b=await body();if(!pass)return json({error:'The Vault has no passphrase.'},400);if(b.passphrase!==vaultFixture.passphrase)return json({error:'Wrong passphrase.'},401);fixtureSettings.vaultLocked=false;return json({ok:true});}
  if(url.pathname==='/api/vault/passphrase'){const b=await body();
   if(b.action==='set'){if(!longEnough(b.passphrase))return json({error:'Use a passphrase of at least 12 characters.'},400);if(b.confirm!==b.passphrase)return json({error:'The passphrases do not match.'},400);if(pass&&b.current!==vaultFixture.passphrase)return json({error:'The current passphrase is wrong.'},401);
    vaultFixture.passphrase=b.passphrase;Object.assign(fixtureSettings,{vaultMode:'passphrase',vaultLocked:false});return json({ok:true,mode:'passphrase'});}
   if(b.action==='remove'){if(!pass)return json({error:'The Vault has no passphrase.'},400);if(b.passphrase!==vaultFixture.passphrase)return json({error:'Wrong passphrase.'},401);vaultFixture.passphrase=null;Object.assign(fixtureSettings,{vaultMode:'key',vaultLocked:false});return json({ok:true,mode:'key'});}
   return json({error:'Unknown action.'},400);}
  if(fixtureSettings.vaultLocked)return url.pathname==='/api/vault'?json({version:1,ready:false,locked:true,mode:'passphrase',items:[],trash:[],requests:[],openRequests:0}):json({error:'The Vault is locked. Unlock it in Pocket Code.',code:'vault_locked'},423);
  if(url.pathname==='/api/vault/lock'){if(!pass)return json({error:'The Vault is opened by the server key; there is nothing to lock.'},400);fixtureSettings.vaultLocked=true;return json({ok:true});}
  if(url.pathname==='/api/vault/export'){const b=await body();if(!longEnough(b.passphrase)||b.confirm!==b.passphrase)return json({error:'Use a passphrase of at least 12 characters, typed the same twice.'},400);
   res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="pocket-vault-export-2026-10-12.pvault"'});res.end(Buffer.from('PVAULT fixture bytes'));return;}
  if(url.pathname==='/api/vault/import'){const b=await body();if(b.passphrase!=='import-fixture-pass')return json({error:'Wrong passphrase, or not a Pocket Code Vault export.'},400);vaultFixture.imported=Buffer.from(String(b.data||''),'base64').toString();return json({ok:true,added:2,skipped:['zoho-books']});}
  if(url.pathname==='/api/vault'){const snap=vaultStore.snapshot({owner:true});return json({...snap,requests:[...snap.requests,...vaultFixture.extraRequests],push:{enabled:false}});}
  // The whole body goes to the real store, so values (fixed and custom) and removeFields reach it unchanged.
  if(url.pathname==='/api/vault/agent-add'){const b=await body();try{return json({ok:true,item:vaultStore.act({action:'add',name:b.name,kind:b.kind,values:b.values},{actor:'agent',session:b.session,sessionTitle:b.sessionTitle})});}catch(e){return fail(e);}} // 1.93: an agent's pocket-vault put from a conversation
  if(url.pathname==='/api/vault/act'){const b=await body();try{const r=vaultStore.act(b,{actor:'owner'});return json(b.action==='answer'?{ok:true,request:r}:{ok:true,item:r,...(r.removed?{removed:true}:{})});}catch(e){return fail(e);}}
  if(url.pathname==='/api/vault/field'){const b=await body();try{return json({value:vaultStore.field(String(b.item||''),String(b.field||''))});}catch(e){return fail(e);}}
  if(url.pathname==='/api/vault/audit')return json({rows:vaultStore.auditRows({item:url.searchParams.get('item')||undefined,owner:true,limit:Number(url.searchParams.get('limit'))||50})});
  if(url.pathname==='/api/vault/rotate'){const key=newKey();vaultStore.rotate(key);vaultFixture.key=key;return json({key,saved:true});}
  if(url.pathname==='/api/vault/recovery-key'){if(pass)return json({error:'The Vault is protected by a passphrase; there is no recovery key.'},400);return json({key:vaultFixture.key});}
 }
 if(url.pathname.startsWith('/api/board')){
  if(!fixtureSettings.projects)return json({error:'Projects is off. Turn it on in Settings → Projects, files, tasks & vault.',code:'projects_off'},404);
  if(url.pathname==='/api/board')return json({...board.snapshot({dir:url.searchParams.get('dir')||''}),push:{enabled:false},hook:false,email:Boolean(fixtureSettings.notifyEmail)});
  if(url.pathname==='/api/board/act'){let raw='';for await(const c of req)raw+=c;try{return json({ok:true,project:board.act(JSON.parse(raw),{actor:'ui'})});}catch(e){return json({error:e.message,...(e.project?{project:e.project}:{})},e.status||400);}}
  if(url.pathname==='/api/board/reset'){seedBoard();return json({ok:true});}
 }
 if(url.pathname.startsWith('/api/documents')||url.pathname.startsWith('/files/')||url.pathname.startsWith('/share/')){
  if(!fixtureSettings.documents){if(url.pathname.startsWith('/api/'))return json({error:'Files is off. Turn it on in Settings → Projects, files, tasks & vault.',code:'documents_off'},404);res.writeHead(404);res.end();return;}
  const sendDoc=(r,framed)=>{const file=docStore.filePath(r);if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
   res.writeHead(200,{'content-type':mimeOf(r.file),'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':r.kind==='html'?`sandbox allow-scripts allow-popups allow-downloads allow-forms; frame-ancestors ${framed?"'self'":"'none'"}`:`default-src 'none'; style-src 'unsafe-inline'; frame-ancestors ${framed?"'self'":"'none'"}`,'content-disposition':(url.searchParams.get('download')==='1'?'attachment':'inline')+"; filename*=UTF-8''"+encodeURIComponent(r.file)});
   res.end(fs.readFileSync(file));};
  if(url.pathname.startsWith('/files/')){const r=docStore.resolvePublic(decodeURIComponent(url.pathname.slice(7)));if(!r){res.writeHead(404);res.end();return;}return sendDoc(r,false);}
  if(url.pathname.startsWith('/share/')){const r=docStore.resolveShare(url.pathname.slice(7));if(!r){res.writeHead(404);res.end();return;}return sendDoc(r,false);}
  if(url.pathname==='/api/documents'&&req.method==='GET')return json({documents:docStore.list({project:url.searchParams.get('project')||'',q:url.searchParams.get('q')||''}),trash:docStore.list({trashed:true}),dir:docsDir,limits:{inlineHtml:10485760,trashDays:30},thumbs:{html:true,pdf:false,image:false}});
  if(url.pathname==='/api/documents'&&req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);try{return json(docStore.addFromBuffer(String(req.headers['x-filename']||''),Buffer.concat(chunks),{addedBy:'ui',project:String(req.headers['x-project']||'')}));}catch(e){return json({error:e.message},e.status||400);}}
  if(url.pathname==='/api/documents/keep'){let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);const src=path.join(out,'kept-source.md');fs.writeFileSync(src,'# Kept from a session\n\nbody');try{return json(docStore.addFromPath(src,{session:b.session,project:b.project||'',addedBy:'session'}));}catch(e){return json({error:e.message},e.status||400);}}
  if(url.pathname==='/api/documents/reset'){seedDocs();return json({ok:true});}
  // 1.45: select mode's Remove, Delete forever and Empty trash, on the real store.
  if(url.pathname==='/api/documents/bulk'&&req.method==='POST'){let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw||'{}');try{return json(docStore.bulk(b.action,b.ids));}catch(e){return json({error:e.message},e.status||400);}}
  if(url.pathname==='/api/documents/trash/empty'&&req.method==='POST')return json(docStore.emptyTrash());
  // 1.32: a fixed picture for HTML documents, nothing for the other kinds (the card shows the kind).
  const th=/^\/api\/documents\/([0-9a-f]{12})\/thumb$/.exec(url.pathname);
  if(th){const r=docStore.documents.find(d=>d.id===th[1]);if(!r||r.kind!=='html'){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':'image/png','cache-control':'private, max-age=86400'});res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4b2pqysBgamoKAB4zA9HwpVv4AAAAAElFTkSuQmCC','base64'));return;}
  const m=/^\/api\/documents\/([0-9a-f]{12})(\/raw)?$/.exec(url.pathname);
  if(m&&m[2]){let r;try{r=docStore.get(m[1]);}catch{res.writeHead(404);res.end();return;}return sendDoc(r,true);}
  if(m&&req.method==='POST'){let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw||'{}');try{return json(b.action==='trash'?docStore.trash(m[1]):b.action==='restore'?docStore.restore(m[1]):docStore.update(m[1],b,{actor:'ui'}));}catch(e){return json({error:e.message},e.status||400);}}
 }
 if(url.pathname==='/api/settings'){let extra={};if(req.method==='POST'){let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);
  // 1.44: switching on with no key makes one and answers with it once; a Vault whose key is missing must be restored.
  if(b.vault===true&&!fixtureSettings.vault&&fixtureSettings.vaultNeedsKey)return json({error:"This Vault's key is missing on this server. Restore it from your recovery key.",code:'vault_needs_key'},409);
  if(b.vault===true&&!fixtureSettings.vault&&fixtureSettings.vaultCanCreateKey){Object.assign(fixtureSettings,{vaultCanCreateKey:false,vaultReady:true});extra={recoveryKey:vaultFixture.key};}
  if(typeof b.notifyEmail==='string'&&b.notifyEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.notifyEmail))return json({error:'That does not look like an email address.',code:'bad_email'},400);
  if(Array.isArray(b.offeredClaudeModels)&&!fixtureOffer(b.offeredClaudeModels).offered.length)return json({error:'Keep at least one model on.',code:'no_models'},400);
  if(b.trustedActions!=null){const v=validateRules(b.trustedActions);if(v.error)return json({error:v.error,code:'bad_trusted_action',rule:v.rule??null,index:v.index??null},400);b.trustedActions=v.rules;}
  Object.assign(fixtureSettings,b);}return json({...fixtureSettings,titles:fixtureTitles(),email:fixtureEmail(),claudeModels:fixtureClaudeModels(),router:fixtureRouter(),access:fixtureAccess(),trusted:fixtureTrusted(),...extra});}
 if(url.pathname==='/api/about')return uiModes.aboutFailed?json({error:'Version unavailable'},503):json({...JSON.parse(fs.readFileSync(path.join(repo,'public/release.json'),'utf8')),cli:'test',host:'preview'});
 if(url.pathname==='/api/connectors'){uiModes.connectorCalls=(uiModes.connectorCalls||[]).concat(url.search);return json({providers:[{provider:'claude',available:true,manageUrl:'https://claude.ai/customize/connectors',items:[{key:'gmail',label:'Gmail',status:url.search?'connected':'needs-auth'},{key:'calendar',label:'Google Calendar',status:'not-connected'},{key:'drive',label:'Google Drive',status:'connected'}]},{provider:'codex',available:false,reason:'Apps need a ChatGPT sign-in. This Codex uses an API key.',manageUrl:'https://chatgpt.com/apps',items:[]}]});}
 if(url.pathname==='/api/environment')return json({host:'test-instance',checkedAt:Date.now(),providers:[{provider:'claude',email:'owner@example.test',plan:'max',method:'claude.ai',signedIn:true},{provider:'codex',email:'coder@example.test',plan:'pro',method:'chatgpt',signedIn:true}],claudeActive:uiModes.claudeActive||0,accountManagement:'Sign-ins follow this instance.',permissions:'Unattended server permissions',capabilities:{claudeLogin:true}});
 if(url.pathname==='/api/claude/activity')return json({active:uiModes.claudeActive||0});
 if(url.pathname==='/api/claude/stop-all'){
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  if((uiModes.claudeActive||0)>body.expected)return json({error:'More Claude replies started since you confirmed.'},409);
  const stopping=uiModes.claudeActive||0;uiModes.claudeActive=0;return json({stopping,active:stopping});
 }
 if(url.pathname==='/api/claude/login')return uiModes.loginOffline?json({error:'Offline'},503):json(loginState);
 if(url.pathname.startsWith('/api/claude/login/')){
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  if(url.pathname.endsWith('/start')){
   if(uiModes.loginBusy)return json({error:'Claude still has active replies. Let them finish, or use Stop all Claude replies in Accounts & instance.'},409);
   loginState={id:'login-'+(++loginSequence),status:'waiting',url:'https://claude.com/cai/oauth/authorize?state=fixture&code_challenge=fixture',message:'Open the sign-in link, choose your account, then paste the code here.'};
  }
  if(url.pathname.endsWith('/code')){loginCodes.push(body.code);loginState={id:loginState.id,status:'success',account:{email:'new@example.test'},message:'Claude Code is signed in.'};}
  if(url.pathname.endsWith('/cancel'))loginState={id:loginState.id,status:'cancelled',message:'Sign-in cancelled.'};
  return json(loginState);
 }
 if(url.pathname.endsWith('/questions'))return json({supported:url.pathname.includes('cx:'),requests:questionRequests});
 if(url.pathname.endsWith('/questions/request-1/answer')){let raw='';for await(const c of req)raw+=c;questionAnswers=JSON.parse(raw).answers;questionRequests=[];return json({ok:true});}
 if(url.pathname.endsWith('/worktrees'))return json({rows:[{path:'/home/work/inventory',branch:'main',main:true,locked:false},...Object.keys(worktreeRows).map(k=>({path:'/home/work/trees/'+k,branch:worktreeRows[k].branch,main:false,locked:false}))]});
 if(url.pathname.endsWith('/worktrees/status')){const k=url.searchParams.get('path').split('/').pop();return json({path:url.searchParams.get('path'),lastCommitAt:Date.parse('2026-10-14T15:00:00Z'),conversations:[],...worktreeRows[k]});}
 if(url.pathname.endsWith('/worktrees/removal'))return json({path:url.searchParams.get('path'),branch:'feat/stock-sync',head:'abc',main:'/home/work/inventory',refused:null,ignored:['.env','data/exports/'],ignoredMore:0,rebuildable:3,started:[{id:'f00d0000-0000-4000-8000-0000000000aa',title:'Stock count export'}],check:'token-1'});
 if(url.pathname==='/api/worktrees/remove'){let raw='';for await(const c of req)raw+=c;worktreeRemoved=JSON.parse(raw);delete worktreeRows['stock-sync'];return json({ok:true});}
 if(url.pathname.endsWith('/folders'))return json({active:'/home/work/inventory',activePath:'/home/work/inventory/src',repo:true,start:'/home/work',also:[{id:'f00d0000-0000-4000-8000-0000000000aa',title:'Stock count export'}],folders:[{path:'/home/work/inventory/src',root:'/home/work/inventory',branch:'feature/inventory',isWorktree:false,lastUsedAt:2,source:'edit'},{path:'/home/work/reports',root:'/home/work/reports',branch:'main',isWorktree:true,lastUsedAt:1,source:'cwd'}]});
 if(url.pathname.endsWith('/workspace'))return json({branch:'feature/inventory',total:2,checkedAt:Date.now(),files:[{path:'report.csv',status:' M',inspectable:true},{path:'.env',status:'??',inspectable:false}]});
 if(url.pathname.endsWith('/workspace/diff'))return json({text:url.searchParams.get('scope')==='staged'?'No staged diff for this file.':'-old quantity\n+new quantity\n+<script>unsafe-looking content is literal</script>'});
 if(url.pathname.endsWith('/events')){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});res.write(url.pathname.includes(rows[0].id)?': running\n\n':'data: {"type":"watch"}\n\n');if(uiModes.streamDone){uiModes.streamDone=false;res.write('data: {"type":"done"}\n\n');} /* streamDone: the next stream ends a turn once */const t=setInterval(()=>res.write(': keepalive\n\n'),1000);req.on('close',()=>clearInterval(t));return;}
 if(url.pathname==='/api/new'){
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);received.push(body);
  const held=secretRefusal(body);if(held)return json(held,422);
  if(body.start?.startsWith('f00d')){const h=uiModes.handoffs[body.start];if(h.startedSession)return json({error:'This handoff has already started.',code:'start_used',id:h.startedSession},409);dispatches++;h.startedSession=rows[1].id;h.startedTitle=rows[1].title;return json({id:rows[1].id},202);} // 1.96: a handoff starts once
  if(!receipts.has(body.clientMessageId)){
   dispatches++;const id='66666666-6666-4666-8666-666666666666';
   rows.push({...idle,id,title:body.text});conversations.set(id,[{role:'user',text:body.text}]);receipts.set(body.clientMessageId,{id});if(body.start)inboxStore.linkStart(body.start,id); // 1.77: as the server does
   if(body.project)try{board.act({action:'link-session',project:body.project,session:id},{actor:'ui'});}catch{} // 1.49, as the server does
  }
  if(failNext){req.socket.destroy();return;}return json(receipts.get(body.clientMessageId),202);
 }
 if(/\/agents\/[^/]+\/activity$/.test(url.pathname)){ // 1.82
  if(!uiModes.agentActivity)return json({error:'This subagent has not written a transcript yet.'},404);
  return json({...uiModes.agentActivity,checkedAt:Date.now()});
 }
 if(url.pathname.endsWith('/agents')){
  if(uiModes.agentsFail)return json({error:'Temporarily unavailable'},503);
  const agents=uiModes.agents||[];return json({agents,total:agents.length,running:agents.filter(a=>a.status==='running').length,checkedAt:Date.now()});
 }
 if(url.pathname.startsWith('/api/prompts')){ // in-memory stand-in for prompts.mjs (1.23)
  const st=uiModes.prompts||(uiModes.prompts={prompts:[],recent:[{text:'Check incoming quantities before ordering',cwd:'/workspaces/products',provider:'codex',at:Date.now()-3600000}]});
  let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};const id=decodeURIComponent(url.pathname.split('/')[3]||'');
  if(req.method==='GET')return json(st);
  if(url.pathname==='/api/prompts/order'){st.prompts.sort((a,b)=>body.ids.indexOf(a.id)-body.ids.indexOf(b.id));return json(st);}
  if(req.method==='POST'){if(!String(body.name||'').trim())return json({error:'Give the prompt a name.'},400);const p={...Object.fromEntries(Object.entries(body).filter(([,v])=>v!=null&&v!=='default')),id:'p'+(st.prompts.length+1)+'-'+Date.now()};st.prompts.push(p);return json({prompt:p,...st},201);}
  const p=st.prompts.find(x=>x.id===id);if(!p)return json({error:'That prompt no longer exists.'},404);
  if(req.method==='PATCH'){Object.assign(p,body);return json({prompt:p,...st});}
  if(req.method==='DELETE'){st.prompts.splice(st.prompts.indexOf(p),1);return json(st);}
 }
 if(url.pathname==='/api/search'){const q=url.searchParams.get('q')||'';uiModes.searchCalls=[...(uiModes.searchCalls||[]),q];
  if(uiModes.searchFail)return json({error:'Search unavailable'},503);
  return json({backend:'memstem',tookMs:12,results:[
   {id:rows[3].id,title:rows[3].title,provider:'claude',cwd:rows[3].cwd,mtimeMs:rows[3].mtimeMs,role:'assistant',snippet:'…Incoming stock is separate from the on-hand count for each recorder.',related:false},
   {id:rows[1].id,title:rows[1].title,provider:'codex',cwd:rows[1].cwd,mtimeMs:rows[1].mtimeMs,role:null,snippet:'Product photos and listing updates for the new cameras',related:true}]});}
 if(url.pathname.endsWith('/away')){let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw||'{}');uiModes.awayCalls=[...(uiModes.awayCalls||[]),body.since];
  return json(fixtureSettings.awaySummaries===false?{summary:null,reason:'off'}:{summary:'Checked stock for 24 products\nThree are below their reorder level\nWaiting on you: approve the order',model:'claude-haiku-5-5',provider:'claude',messages:3});}
 if(url.pathname.endsWith('/results'))return json({results:[{kind:'link',target:'https://example.com/inventory',label:'Inventory report',detail:'example.com'},{kind:'file',target:'/home/test/reports/stock.csv',label:'Stock CSV',detail:'CSV file'}]});
 if(url.pathname.includes('/queue')){
  if(req.method==='GET'){if(uiModes.queueSeed){queueRows.push(uiModes.queueSeed);uiModes.queueSeed=null;}return json({items:queueRows,active:true,external:false});} // queueSeed: a check that needs a queued row adds one
  let raw='';for await(const chunk of req)raw+=chunk;const b=JSON.parse(raw);const id=url.pathname.split('/').at(-1),idx=queueRows.findIndex(x=>x.id===id);
  if(id==='start'&&req.method==='POST'){queueStarts.push({id:decodeURIComponent(url.pathname.split('/')[3]),...b});return json({ok:true,started:true});} // 1.89.2
  if(req.method==='PATCH'){queueRows[idx]={...queueRows[idx],...(b.editing?{status:'editing'}:{text:b.text,status:'pending'}),revision:queueRows[idx].revision+1};return json({item:queueRows[idx]});}
  if(req.method==='DELETE'){queueRows.splice(idx,1);return json({ok:true});}
 }
 const match=url.pathname.match(/^\/api\/session\/([^/]+)(\/message)?$/);
 if(match){const id=decodeURIComponent(match[1]),r=rows.find(x=>x.id===id);
  if(!match[2]){if(uiModes.sessionDelay)await new Promise(r=>setTimeout(r,uiModes.sessionDelay));/* sessionDelay: a slow transcript read, so a check can see the view while it waits */const messages=messagesOf(id);return json({...r,...(sideFixture.lineage[id]||{}),active:r.state.kind==='running',ext:false,messages,total:messages.length});}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);received.push(body);
  const held=secretRefusal(body);if(held)return json(held,422);
  if(body.text.includes('__STALE__')){dispatches++;return json({ok:true,queued:true,afterJobs:true,jobs:[{id:'bg1',description:'test-suite results'}],itemId:'held-1'},202);} // 1.89.2: held for the jobs (accepted, so a dispatch)
  if(!receipts.has(body.clientMessageId)){dispatches++;receipts.set(body.clientMessageId,{ok:true});conversations.get(id).push({role:'user',text:body.text});}
  if(failNext){req.socket.destroy();return;}
  return json(receipts.get(body.clientMessageId),202);
 }
 if(url.pathname==='/sw.js'&&!uiModes.realWorker){res.writeHead(200,{'content-type':'text/javascript'});res.end('// Fixture worker: no caching.');return;}
 const rel=url.pathname==='/'?'index.html':url.pathname.slice(1);const file=path.join(repo,'public',rel);
 if(!file.startsWith(path.join(repo,'public')+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'content-type':rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':rel.endsWith('.html')?'text/html':'application/octet-stream'});res.end(fs.readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await puppeteer.launch({executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
const errors=[];const p=await browser.newPage();await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);p.on('pageerror',e=>errors.push(e.message));
const scans=[];
const scan=async label=>{
 if(!process.env.POCKET_DESIGN_SCANNER)return;
 await p.evaluate(()=>{window.__IMPECCABLE_CONFIG__={autoScan:false};});
 if(!await p.evaluate(()=>Boolean(window.impeccableDetectAsync))){const injected=await p.addScriptTag({path:process.env.POCKET_DESIGN_SCANNER});await injected.evaluate(el=>el.remove());}
 scans.push({label,result:await p.evaluate(()=>window.impeccableDetectAsync({scrollOffscreen:false}))});
};
try{
 if(process.env.POCKET_SLASH_ONLY){ /* POCKET_SLASH_ONLY=n: the / picker checks only, n times over, to shake out a flake */const {runSlashRegressions}=await import('./slash-browser.mjs');for(let k=0;k<Number(process.env.POCKET_SLASH_ONLY);k++){console.log('iteration',k);await runSlashRegressions({browser,base,rows,received,out});}throw Object.assign(Error('slash only'),{docsOnly:true});}
 if(process.env.POCKET_CLI_UPDATES_ONLY){const {runCliUpdateRegressions}=await import('./cli-updates-browser.mjs');await runCliUpdateRegressions({browser,base,out});throw Object.assign(Error('CLI updates only'),{docsOnly:true});}
 if(process.env.POCKET_COORD_ONLY){await runCoordinationRegressions({p,base,out,repo,rows,settings:fixtureSettings,coord:coordFixture,scan});if(scans.length)fs.writeFileSync(path.join(out,'design-scan.json'),JSON.stringify(scans,null,2));console.log(JSON.stringify({ok:true,coordinationOnly:true,screenshots:out}));throw Object.assign(Error('coordination only'),{docsOnly:true});}
 if(process.env.POCKET_THEME_ONLY){
  const {runThemeRegressions}=await import('./theme-browser.mjs');
  await runThemeRegressions({browser,base,rows,out,settings:fixtureSettings,modes:uiModes,setRequests:r=>{questionRequests=r.questions||[];approvalRequests=r.approvals||[];}});
  console.log(JSON.stringify({ok:true,themesOnly:true,screenshots:out}));
  throw Object.assign(Error('themes only'),{docsOnly:true});
 }
 if(process.env.POCKET_DOCS_SCREENSHOTS){
  await captureDocs({browser,base,rows,dir:process.env.POCKET_DOCS_SCREENSHOTS,conversations,settings:fixtureSettings,inboxStore});
  if(process.env.POCKET_DOCS_ONLY){console.log(JSON.stringify({ok:true,docsOnly:true,dir:process.env.POCKET_DOCS_SCREENSHOTS}));process.exitCode=0;throw Object.assign(Error('docs only'),{docsOnly:true});}
 }
 for(const width of [360,390,768,1440]){
  await p.setViewport({width,height:900,isMobile:width<700,hasTouch:width<700});
  await p.goto(base,{waitUntil:'domcontentloaded'});await p.waitForSelector('[data-id]');
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'list overflow '+width);
  assert.match(await p.$eval('[data-session-summary]',el=>el.textContent),/1 running/);
  await clickControl(p,'[data-filter="active"]');assert.equal(await p.$$eval('[data-session-results] [data-id]',els=>els.length),2);
  await clickControl(p,'[data-filter="attention"]');assert.equal(await p.$$eval('[data-session-results] [data-id]',els=>els.length),2,'the failed turn and the unopened Response ready reply');
  await clickControl(p,'[data-filter="all"]');await p.screenshot({path:path.join(out,`sessions-${width}.png`)});
  if([390,1440].includes(width))await scan('sessions-'+width);
  await clickControl(p,`[data-id="${idle.id}"]`);await p.waitForSelector('#box');
  await p.type('#box','Keep this draft while switching sessions.');
  await clickControl(p,'#session-switch');await p.waitForSelector('[role="dialog"]');
  assert.equal(await p.evaluate(()=>document.querySelector('[role="dialog"]').contains(document.activeElement)),true);
  await p.keyboard.press('Escape');assert.equal(await p.$('[role="dialog"]'),null);
  assert.equal(await p.$eval('#box',e=>e.value),'Keep this draft while switching sessions.');
  await clickControl(p,'#c-model');await p.waitForSelector('[role="dialog"]');
  for(let i=0;i<8;i++){await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.querySelector('[role="dialog"]').contains(document.activeElement)),true);}
  await p.keyboard.press('Escape');assert.equal(await p.$eval('#c-model',e=>e===document.activeElement),true);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'chat overflow '+width);
  assert.equal(await p.$$eval('.report-table table',e=>e.length),1);assert.equal(await p.$$eval('blockquote',e=>e.length),1);assert.equal(await p.$$eval('ol li ul',e=>e.length)>0,true);
  await clickControl(p,'#results-open');await p.waitForSelector('.result-row');
  assert.equal(await p.$$eval('.result-row',e=>e.length),2);
  if(width===390)await p.screenshot({path:path.join(out,'results-mobile.png')});
  await p.type('#result-query','CSV');assert.equal(await p.$$eval('.result-row',e=>e.length),1);
  assert.match(await p.$eval('.result-row a',e=>e.getAttribute('href')),/artifact\?path=/);
  await p.keyboard.press('Escape');
  await p.screenshot({path:path.join(out,`chat-${width}.png`)});
  if([390,1440].includes(width))await scan('chat-'+width);
  await p.evaluate(()=>{clearDraft(chatId);document.querySelector('#box').value='';});
 }
 // Response lost after server dispatch: draft + attachment survive reload;
 // replaying the identical client ID confirms it without dispatching again.
 await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await p.goto(base+'/#/chat/'+idle.id,{waitUntil:'domcontentloaded'});await p.waitForSelector('#box');
 await p.evaluate(()=>{tb.attachments=[{path:'/fixture/stock.csv',name:'stock.csv'}];stashAttachments();renderToolbar();});
 await p.type('#box','Exclude discontinued products.');failNext=true;await clickControl(p,'#send');
 await p.waitForSelector('#retry-message');
 assert.equal(await p.$eval('#box',e=>e.value),'Exclude discontinued products.');
 assert.equal(dispatches,1);
 assert.equal(await p.evaluate(id=>JSON.parse(localStorage.getItem('pc-attachments-'+id)).length,idle.id),1);
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('#retry-message');
 assert.equal(await p.$eval('#box',e=>e.value),'Exclude discontinued products.');
 await p.screenshot({path:path.join(out,'delivery-recovery.png')});
 failNext=false;await clickControl(p,'#retry-message');await p.waitForFunction(id=>!localStorage.getItem('pc-outbox-'+id),{},idle.id);await p.waitForSelector('#box');
 assert.equal(dispatches,1);assert.equal(received[0].clientMessageId,received[1].clientMessageId);
 assert.deepEqual(received[0].attachments,['/fixture/stock.csv']);
 assert.equal(await p.$eval('#box',e=>e.value),'');
 assert.equal(await p.$$eval('.m-user',els=>els.filter(e=>e.textContent==='Exclude discontinued products.').length),1);
 // 1.89.2: background jobs holding the earlier Claude login: the message is held for them, and Stop sends it now
 await p.type('#box','__STALE__ carry on');await clickControl(p,'#send');await p.waitForSelector('#stop-jobs-now');
 assert.match(await p.$eval('#delivery-status',e=>e.textContent),/Held until a background job finishes \(test-suite results\)\. It sends by itself then/);
 assert.equal(await p.$eval('#send',e=>e.disabled),false,'the composer stays free');assert.equal(await p.$eval('#box',e=>e.value),'');
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'held-message notice overflow');
 await p.screenshot({path:path.join(out,'stale-login-held.png')});
 const startsBefore=queueStarts.length;await clickControl(p,'#stop-jobs-now');await p.waitForFunction(()=>!document.querySelector('#stop-jobs-now'));
 assert.deepEqual(queueStarts.slice(startsBefore),[{id:idle.id,itemId:'held-1',replaceStaleLogin:true}]);
 assert.match(await p.$eval('#delivery-status',e=>e.textContent),/Message delivered/);
 // A failed list refresh retains the last list but removes any implied live status.
 stale=true;await p.evaluate(()=>refreshSessions());
 assert.match(await p.$eval('#session-switch',e=>e.textContent),/unavailable/);
 assert.equal(await p.$$eval('.state-unknown',els=>els.filter(e=>e.getClientRects().length).length)>0,false,'mobile chat has no rendered list until switcher opens');
 await clickControl(p,'#session-switch');await p.waitForSelector('.state-unknown');
 await p.keyboard.press('Escape');
 // New-session creation must recover the same server-issued session ID too.
 stale=false;await p.goto(base+'/#/new',{waitUntil:'domcontentloaded'});await p.waitForSelector('[data-p]');
 await clickControl(p,'#choose-workspace');await clickControl(p,'[data-p]');await p.type('#first','Prepare the weekly inventory.');failNext=true;await clickControl(p,'#start');
 await p.waitForFunction(()=>document.querySelector('#start')?.getAttribute('aria-label')==='Retry start');
 assert.equal(dispatches,3);await p.reload({waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>document.querySelector('#start')?.getAttribute('aria-label')==='Retry start');
 assert.equal(await p.$eval('#first',e=>e.value),'Prepare the weekly inventory.');
 failNext=false;await clickControl(p,'#start');await p.waitForSelector('#box');
 assert.equal(dispatches,3);assert.match(p.url(),/66666666-6666-4666-8666-666666666666/);
 assert.equal(await p.evaluate(()=>localStorage.getItem('pc-outbox-new')),null);
 // Reading position survives reopening a long conversation.
 conversations.get(idle.id).push({role:'assistant',blocks:[{t:'text',text:Array.from({length:60},(_,i)=>'Paragraph '+i+' in a long report.').join('\n\n')}]});
 await p.goto(base+'/#/chat/'+idle.id);await p.waitForSelector('#box');
 await p.evaluate(()=>{const m=document.querySelector('#msgs').closest('main.scroll');m.scrollTop=180;rememberReading();});
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('#box');
 assert.ok(Math.abs(await p.$eval('#msgs',e=>e.closest('main.scroll').scrollTop)-180)<4);
 // Agent-produced Markdown must not execute code or create active form controls.
 const security=await p.evaluate(()=>{
  const div=document.createElement('div');div.innerHTML=md('<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>\n\n[bad](javascript:alert(1))\n\n![bad](data:image/svg+xml;base64,AAAA)\n\n<input autofocus onfocus="window.__pwned=1">');
  return {danger:div.querySelectorAll('script,iframe,form,[onerror],[onfocus],a[href^="javascript:"],img[src^="data:"]').length,pwned:Boolean(window.__pwned)};
 });assert.deepEqual(security,{danger:0,pwned:false});
 await p.goto(base+'/#/chat/'+rows[0].id);await p.waitForSelector('[data-mode="queue"]');
 await clickControl(p,'[data-mode="queue"]');assert.equal(await p.$eval('[data-mode="queue"]',e=>e.getAttribute('aria-pressed')),'true');
 await clickControl(p,'#queue-open');await p.waitForSelector('[data-edit]');await clickControl(p,'[data-edit]');await p.waitForSelector('.queue-editor');
 await p.$eval('.queue-editor',e=>e.value='Only order current models.');await clickControl(p,'[data-save]');
 await p.waitForFunction(()=>document.querySelector('.queue-item p')?.textContent==='Only order current models.');
 await p.screenshot({path:path.join(out,'queue-mobile.png')});await clickControl(p,'[data-remove]');await p.waitForFunction(()=>document.querySelector('#queue-items')?.textContent.includes('No queued instructions'));await p.keyboard.press('Escape');
 for(const width of [390,1440]){
  await p.setViewport({width,height:900,isMobile:width<700,hasTouch:width<700});await p.goto(base+'/#/new');await p.waitForSelector('[data-p]');
  await clickControl(p,'#choose-skill');await p.waitForSelector('.skill-choice');await p.type('.skill-search','inventory');assert.equal(await p.$$eval('.skill-choice',e=>e.length),1);
  if(width===390)await p.screenshot({path:path.join(out,'skills-mobile.png')});await clickControl(p,'.skill-choice');
  assert.match(await p.$eval('#first',e=>e.value),/inventory-report/);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await p.screenshot({path:path.join(out,'new-'+width+'.png')});
 }
 // Daily workspace: filters, tabs, docking, read-only Git and native questions.
 await p.setViewport({width:1440,height:900});await p.goto(base);await p.waitForSelector('[data-workspace-filter]');await clickControl(p,'[data-more-filters] > summary');
 await p.select('[data-workspace-filter]','/workspaces/warehouse');
 assert.equal(await p.$$eval('[data-id]',e=>e.length),2);
 await p.select('[data-provider-filter]','codex');assert.equal(await p.$$eval('[data-id]',e=>e.length),0);
 await p.select('[data-workspace-filter]','');await p.select('[data-provider-filter]','');
 await clickControl(p,`[data-more="${idle.id}"]`);await clickControl(p,'#so-hide');assert.equal(await p.$(`[data-id="${idle.id}"]`),null);
 await clickControl(p,'[data-filter="hidden"]');await clickControl(p,`[data-more="${idle.id}"]`);await clickControl(p,'#so-hide');await clickControl(p,'[data-filter="all"]');
 await clickControl(p,`[data-id="${idle.id}"]`);await p.waitForSelector('#box');await clickControl(p,'#results-open');await p.waitForSelector('.workspace-dock .result-row');
 assert.equal(await p.$eval('#app',e=>e.inert),false);await p.type('#box','Desktop draft remains editable.');
 await clickControl(p,`[data-id="${rows[0].id}"]`);await p.waitForFunction(id=>chatId===id&&document.querySelector('#box'),{},rows[0].id);
 await p.waitForSelector('.workspace-dock .result-row');assert.ok(await p.$$eval('#open-sessions a',e=>e.length)>=2);
 await clickControl(p,'#git-open');await p.waitForSelector('[data-git-file]');
 assert.equal(await p.$eval('[data-git-title]',e=>e.textContent),'Working in inventory · feature/inventory','the panel names the folder the work is in');
 assert.equal(await p.$eval('[data-git-folder]',e=>e.value),'/home/work/inventory','it opens on the repository last edited');
 assert.equal(await p.$$eval('[data-git-folder] option',e=>e.length),2);assert.match(await p.$eval('[data-git-also]',e=>e.textContent),/Also working here: Stock count export/);
 await clickControl(p,'[data-git-file="0"]');await p.waitForFunction(()=>document.querySelector('[data-git-diff] pre')?.textContent.includes('new quantity'));
 assert.equal(await p.$$eval('[data-git-diff] script',e=>e.length),0);await clickControl(p,'[data-scope="staged"]');await p.waitForFunction(()=>document.querySelector('[data-git-diff] pre')?.textContent.includes('No staged'));
 await p.screenshot({path:path.join(out,'workspace-desktop.png')});await scan('workspace-desktop');
 // 1.98: worktrees sit below the changed files, grouped, and only a Ready row offers Remove.
 await p.waitForFunction(()=>document.querySelectorAll('.git-tree').length===3&&!document.querySelector('[data-git-trees-progress]').textContent);
 assert.deepEqual(await p.$$eval('.git-tree-group summary',e=>e.map(x=>x.textContent)),['In use (1)','Has work (1)','Ready to remove (1)']);
 assert.equal(await p.$$eval('[data-git-tree-remove]',e=>e.length),1);assert.equal(await p.$eval('[data-git-tree-group="use"] a',e=>e.textContent),'Stock count export');
 await p.$eval('[data-git-trees]',e=>e.scrollIntoView());await p.screenshot({path:path.join(out,'worktrees-1440.png')});await scan('worktrees-1440');await p.addScriptTag({path:path.join(repo,'node_modules/axe-core/axe.min.js')});assert.deepEqual(await p.evaluate(async sel=>{const result=await axe.run(sel);return result.violations.map(violation=>({id:violation.id,nodes:violation.nodes.map(node=>node.target)}));},'.git-trees'),[]);
 // Resizing preserves the open panel as a phone dialog rather than dropping its contents.
 await p.setViewport({width:390,height:844});await p.waitForSelector('.git-sheet[role="dialog"]');
 await p.waitForFunction(()=>getComputedStyle(document.querySelector('[data-git-folder]')).display!=='none');await p.screenshot({path:path.join(out,'git-folders-390.png')});await scan('git-folders-390');
 // A phone collapses the groups, counts showing. The sheet names ignored files and where conversations go, then removal posts its check.
 await p.waitForFunction(()=>document.querySelectorAll('.git-tree-group').length===3);
 await p.$$eval('.git-tree-group',e=>e.forEach(d=>{d.open=false;}));await p.$eval('[data-git-trees]',e=>e.scrollIntoView());await p.screenshot({path:path.join(out,'worktrees-390.png')});await scan('worktrees-390');await p.addScriptTag({path:path.join(repo,'node_modules/axe-core/axe.min.js')});assert.deepEqual(await p.evaluate(async sel=>{const result=await axe.run(sel);return result.violations.map(violation=>({id:violation.id,nodes:violation.nodes.map(node=>node.target)}));},'.git-trees'),[]);
 assert.ok((await p.$$eval('.git-tree-group summary',e=>e.map(x=>x.getBoundingClientRect().height))).every(h=>h>=44),'group rows are 44px on a phone');
 await p.$eval('[data-git-tree-group="ready"]',d=>{d.open=true;});await clickControl(p,'[data-git-tree-remove]');await p.waitForSelector('.git-remove[role="dialog"]');
 assert.match(await p.$eval('.git-remove-files',e=>e.textContent),/\.env/);assert.match(await p.$eval('.git-remove',e=>e.textContent),/carry on from your home folder: Stock count export/);
 await p.screenshot({path:path.join(out,'worktree-remove-390.png')});await scan('worktree-remove-390');await p.addScriptTag({path:path.join(repo,'node_modules/axe-core/axe.min.js')});assert.deepEqual(await p.evaluate(async sel=>{const result=await axe.run(sel);return result.violations.map(violation=>({id:violation.id,nodes:violation.nodes.map(node=>node.target)}));},'.git-remove'),[]);
 await clickControl(p,'[data-remove-yes]');await p.waitForSelector('.git-sheet[role="dialog"]');assert.deepEqual(worktreeRemoved,{path:'/home/work/trees/stock-sync',check:'token-1'});
 await p.waitForFunction(()=>document.querySelectorAll('.git-tree-group').length===2);
 await p.keyboard.press('Escape');
 questionRequests=[{id:'request-1',blocking:true,questions:[{id:'format',header:'Format',question:'Which format should the report use?',options:[{label:'CSV',description:'For spreadsheets'},{label:'PDF',description:'For reading'}]}]}];
 rows[1].state={kind:'input',label:'Needs your answer',questions:1};
 await p.goto(base+'/#/chat/'+rows[1].id);await p.waitForSelector('#questions-open:not([hidden])');
 // 1.75.4: the banner says what is waiting and that the reply is paused. 1.82: one question with a few options is
 // asked in the banner itself, each option a button; Answer still opens the form.
 await p.waitForFunction(()=>{const b=document.querySelector('#questions-open');return b?.querySelector('.wb-title')?.textContent==='Which format should the report use?'&&/The reply is paused until you answer/.test(b.querySelector('.wb-note')?.textContent)&&b.querySelector('.wb-cta')?.textContent==='Answer'&&b.getAttribute('role')==='group';});
 assert.deepEqual(await p.$$eval('#questions-open .wb-act',e=>e.map(x=>[x.textContent,x.title])),[['CSV','For spreadsheets'],['PDF','For reading']]);
 await p.waitForFunction(()=>document.querySelector('#box')?.placeholder==='Answer above, or type here to skip the questions…'); // 1.76.1
 await p.screenshot({path:path.join(out,'question-banner-mobile.png')});await scan('question-banner-mobile');
 await clickControl(p,'#questions-open .wb-cta');await p.waitForSelector('.question-form');
 await p.screenshot({path:path.join(out,'native-question-mobile.png')});await scan('native-question-mobile');
 await clickControl(p,'.question-form [type=submit]');assert.match(await p.$eval('.question-error',e=>e.textContent),/Answer each/);
 await clickControl(p,'.question-option input');await clickControl(p,'.question-form [type=submit]');
 await p.waitForFunction(()=>!document.querySelector('.question-sheet'),'1.82: the form closes itself once nothing is waiting');
 assert.deepEqual(questionAnswers,{format:['CSV']});
 // The banner's own buttons answer without the form.
 questionRequests=[{id:'request-1',blocking:true,agent:'Review imports',questions:[{id:'format',header:'Format',question:'Which format should the report use?',options:[{label:'CSV',description:'For spreadsheets'},{label:'PDF',description:'For reading'}]}]}];questionAnswers=null;
 await p.evaluate(()=>refreshQuestions(chatId));await p.waitForFunction(()=>document.querySelector('#questions-open .wb-agent')?.textContent==='From subagent: Review imports');
 await clickControl(p,'#questions-open .wb-act:nth-of-type(2)');await p.waitForFunction(()=>document.querySelector('#toast')?.textContent==='Answer sent.');
 assert.deepEqual(questionAnswers,{format:['PDF']});assert.equal(await p.$('.question-sheet'),null,'no form opened');
 // Several questions, or a multiple-choice one, still go to the form.
 questionRequests=[{id:'request-1',blocking:true,questions:[{id:'format',question:'Which format?',multiple:true,options:[{label:'CSV',description:''},{label:'PDF',description:''}]}]}];
 await p.evaluate(()=>refreshQuestions(chatId));await p.waitForFunction(()=>document.querySelector('#questions-open .wb-title')?.textContent==='Codex has a question for you'&&!document.querySelector('#questions-open .wb-act'));
 questionRequests=[];
 await clickControl(p,'#c-mode');await p.waitForSelector('[data-v="plan"]');await clickControl(p,'[data-v="plan"]');assert.match(await p.$eval('#c-mode',e=>e.textContent),/Plan first/);
 await p.evaluate(()=>openEnvironment());await p.waitForSelector('.provider-account');assert.match(await p.$eval('.provider-account',e=>e.textContent),/owner@example.test/);await p.keyboard.press('Escape');
 for(const width of [390,1440]){
  loginState={status:'idle'};uiModes.claudeActive=2;await p.setViewport({width,height:900,isMobile:width<700,hasTouch:width<700});await p.goto(base+'/#/chat/'+rows[1].id);await p.waitForSelector('#box');
  await p.evaluate(()=>openEnvironment());await p.waitForSelector('[data-claude-stop]:not([disabled])');
  assert.match(await p.$eval('[data-claude-count]',element=>element.textContent),/2 active Claude replies/);
  await clickControl(p,'[data-claude-stop]');await p.waitForSelector('[data-claude-confirm]:not([hidden])');
  assert.match(await p.$eval('[data-claude-stop-copy]',element=>element.textContent),/Saved conversations remain/);
  await clickControl(p,'[data-claude-stop-no]');assert.equal(uiModes.claudeActive,2);
  await clickControl(p,'[data-claude-stop]');await p.waitForSelector('[data-claude-confirm]:not([hidden])');await clickControl(p,'[data-claude-stop-yes]');
  await p.waitForFunction(()=>document.querySelector('[data-claude-count]')?.textContent.includes('All Claude replies stopped'));
  assert.equal(uiModes.claudeActive,0);assert.equal(await p.$eval('[data-claude-stop]',element=>element.disabled),true);
  await p.screenshot({path:path.join(out,'claude-stop-all-'+width+'.png')});await scan('claude-stop-all-'+width);
  // 1.53: Connectors — status per agent, Connect/Reconnect open claude.ai, Refresh asks for a fresh read.
  uiModes.connectorCalls=[];await p.keyboard.press('Escape');await p.evaluate(()=>openConnectors());await p.waitForSelector('.connector-row');
  assert.deepEqual(await p.$$eval('.connector-row',rows=>rows.map(r=>r.querySelector('.connector-state').textContent)),['Needs signing in again','Not connected','Connected']);
  assert.deepEqual(await p.$$eval('.connector-row a.chip',links=>links.map(a=>[a.textContent,a.origin,a.target,a.rel])),[['Reconnect','https://claude.ai','_blank','noopener noreferrer'],['Connect','https://claude.ai','_blank','noopener noreferrer']]);
  assert.match(await p.$eval('[data-connectors]',e=>e.textContent),/ChatGPT sign-in/);
  await p.screenshot({path:path.join(out,'connectors-'+width+'.png')});await scan('connectors-'+width);
  await clickControl(p,'[data-connectors-refresh]');await p.waitForFunction(()=>document.querySelector('.connector-state')?.textContent==='Connected');
  assert.deepEqual(uiModes.connectorCalls,['','?refresh=1']);await p.keyboard.press('Escape');
  await p.evaluate(()=>openEnvironment());await p.waitForSelector('[data-claude-login]');
  await clickControl(p,'[data-claude-login]');await p.waitForSelector('[data-login-start]');
  uiModes.loginBusy=true;await clickControl(p,'[data-login-start]');await p.waitForFunction(()=>document.querySelector('[data-login-error]')?.textContent.includes('Stop all Claude replies'));uiModes.loginBusy=false;
  await clickControl(p,'[data-login-start]');await p.waitForSelector('#claude-login-code');
  assert.equal(await p.$eval('[data-login-link]',element=>element.origin),'https://claude.com');
  await p.type('#claude-login-code','unsent-secret');await p.keyboard.press('Escape');
  await p.evaluate(()=>openClaudeLogin());await p.waitForSelector('#claude-login-code');assert.equal(await p.$eval('#claude-login-code',element=>element.value),'');
  await p.type('#claude-login-code','synthetic-code#fixture');
  uiModes.loginOffline=true;await p.waitForFunction(()=>document.querySelector('[data-login-error]')?.textContent.includes('Reconnecting'));uiModes.loginOffline=false;
  await p.waitForFunction(()=>document.querySelector('[data-login-error]')?.textContent==='');assert.equal(await p.$eval('#claude-login-code',element=>element.value),'synthetic-code#fixture');
  await p.screenshot({path:path.join(out,'claude-login-'+width+'.png')});await scan('claude-login-'+width);
  await p.addScriptTag({path:path.join(repo,'node_modules/axe-core/axe.min.js')});
  const accountAxe=await p.evaluate(async()=>{const result=await axe.run('.claude-login-sheet');return result.violations.map(violation=>({id:violation.id,nodes:violation.nodes.map(node=>node.target)}));});assert.deepEqual(accountAxe,[]);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await clickControl(p,'[data-login-form] button');await p.waitForSelector('.login-account');assert.equal(loginCodes.at(-1),'synthetic-code#fixture');
  assert.match(await p.$eval('.login-account',element=>element.textContent),/new@example.test/);assert.equal(await p.$('#claude-login-code'),null);
  await clickControl(p,'[data-login-start]');await p.waitForSelector('[data-login-cancel]');await clickControl(p,'[data-login-cancel]');await p.waitForSelector('[data-login-start]');
  assert.equal(loginState.status,'cancelled');await p.keyboard.press('Escape');
 }
 await p.keyboard.down('Control');await p.keyboard.press('k');await p.keyboard.up('Control');await p.waitForSelector('.session-switcher');await p.keyboard.press('Escape');
 // Desktop density controls act independently and do not remount the conversation.
 await p.setViewport({width:1440,height:800,isMobile:false,hasTouch:false});
 await p.goto(base+'/#/chat/'+idle.id);await p.waitForSelector('#box');
 await p.waitForSelector('#rail [data-workspace-filter]');
 await p.select('#rail [data-workspace-filter]','/workspaces/warehouse');
 await p.select('#rail [data-provider-filter]','claude');
 await p.type('#rail [data-session-search]','warehouse');
 await p.$eval('#box',e=>{e.value='Keep my draft while making room.';e.dispatchEvent(new Event('input',{bubbles:true}));});
 const expanded=await p.evaluate(()=>({chat:document.querySelector('#msgs').closest('main').clientHeight,rows:document.querySelector('#rail [data-session-results]').getBoundingClientRect().top}));
 await p.evaluate(()=>{window.densityComposer=document.querySelector('#box');document.querySelector('#msgs').closest('main').scrollTop=180;});
 await p.focus('#header-toggle');await p.keyboard.press('Enter');
 assert.equal(await p.$eval('#header-toggle',e=>e.getAttribute('aria-expanded')),'false');
 assert.equal(await p.$eval('#rail-filter-toggle',e=>e.getAttribute('aria-expanded')),'true');
 assert.equal(await p.$eval('#open-sessions',e=>e.getClientRects().length),0);
 assert.equal(await p.$eval('#cproj',e=>e.getClientRects().length),0);
 assert.ok(await p.$eval('#msgs',e=>Math.abs(e.closest('main').scrollTop-180)<4));
 await p.focus('#rail-filter-toggle');await p.keyboard.press('Enter');
 assert.equal(await p.$eval('#rail-filter-controls',e=>e.hidden),true);
 assert.match(await p.$eval('#rail-filter-summary',e=>e.textContent),/warehouse · Claude/);
 assert.equal(await p.$$eval('#rail [data-id]',e=>e.length),2);
 assert.equal(await p.$eval('#box',e=>e===window.densityComposer),true);
 assert.equal(await p.$eval('#box',e=>e.value),'Keep my draft while making room.');
 const collapsed=await p.evaluate(()=>({chat:document.querySelector('#msgs').closest('main').clientHeight,rows:document.querySelector('#rail [data-session-results]').getBoundingClientRect().top}));
 assert.ok(collapsed.chat-expanded.chat>=50,'header recovers at least 50px');
 assert.ok(expanded.rows-collapsed.rows>=120,'collapsed filters recover at least 120px');
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('#box');await p.waitForSelector('#rail [data-id]');
 assert.equal(await p.$eval('#header-toggle',e=>e.getAttribute('aria-expanded')),'false');
 assert.equal(await p.$eval('#rail-filter-toggle',e=>e.getAttribute('aria-expanded')),'false');
 assert.equal(await p.$eval('#box',e=>e.value),'Keep my draft while making room.');
 await clickControl(p,'#clear-rail-filters');assert.equal(await p.$eval('#rail-filter-summary',e=>e.hidden),true);
 await p.type('#rail [data-session-search]','warehouse');await clickControl(p,'#rail-filter-toggle');await clickControl(p,'#rail-filter-toggle');
 assert.equal(await p.$eval('#rail [data-session-search]',e=>e.value),'warehouse');
 await p.$eval('#rail [data-session-search]',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});
 await clickControl(p,'#header-toggle');await clickControl(p,'#results-open');await p.waitForSelector('.workspace-dock');
 await p.evaluate(()=>{window.densityDock=document.querySelector('.workspace-dock');});
 await clickControl(p,'#header-toggle');await clickControl(p,'#header-toggle');
 assert.equal(await p.$eval('.workspace-dock',e=>e===window.densityDock),true);
 await clickControl(p,'[data-close-dock]');await clickControl(p,'#header-toggle');
 for(const width of [900,1279,1280,1440,1536]){
  await p.setViewport({width,height:760});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'compact desktop overflow '+width);
  for(const selector of ['#ctitle','#run-confirmed-state','#header-toggle','#rail-filter-toggle','#send']){
   assert.ok(await p.$eval(selector,e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;}),selector+' stays reachable at '+width);
  }
  if(width===1440){await p.screenshot({path:path.join(out,'compact-workspace-desktop.png')});await scan('compact-workspace-desktop');}
 }
 // Collapse is now available on phones and carries the same saved preference.
 await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 assert.equal(await p.$eval('#cproj',e=>e.getClientRects().length),0);
 assert.ok(await p.$eval('#header-toggle',e=>e.getClientRects().length)>0);
 assert.equal(await p.$eval('.chat-statebar',e=>e.getClientRects().length),0);
 await p.screenshot({path:path.join(out,'compact-preference-mobile.png')});await scan('compact-preference-mobile');
 await p.setViewport({width:1440,height:760,isMobile:false,hasTouch:false});
 await clickControl(p,'#header-toggle');await clickControl(p,'#rail-filter-toggle');
 assert.ok(await p.$eval('#open-sessions',e=>e.getClientRects().length)>0);
 assert.equal(await p.$eval('#rail-filter-controls',e=>e.hidden),false);
 await p.screenshot({path:path.join(out,'expanded-workspace-desktop.png')});await scan('expanded-workspace-desktop');
 fs.writeFileSync(path.join(out,'density-metrics.json'),JSON.stringify({expanded,collapsed,conversationGain:collapsed.chat-expanded.chat,sessionListGain:expanded.rows-collapsed.rows},null,2));
 // Bottom settings collapse independently, preserve the actual input and attachments,
 // and survive resizing, model changes and a reload without changing turn preferences.
 await p.evaluate(()=>{window.focusInput=document.querySelector('#box');window.focusPrefs=JSON.stringify(tb.prefs);tb.attachments=[{path:'/tmp/fixture.txt',name:'fixture.txt'}];renderToolbar();stashAttachments();});
 const fullHeight=await p.$eval('main.scroll',e=>e.clientHeight);
 await p.focus('#composer-toggle');await p.keyboard.press('Enter');
 assert.equal(await p.$eval('#composer-toggle',e=>e.getAttribute('aria-expanded')),'false');
 assert.equal(await p.$eval('#header-toggle',e=>e.getAttribute('aria-expanded')),'true');
 assert.equal(await p.$eval('#tbar',e=>e.getClientRects().length),0);
 assert.equal(await p.$eval('#box',e=>e===window.focusInput),true);
 assert.ok(await p.$eval('main.scroll',e=>e.clientHeight)>fullHeight+40);
 await p.evaluate(()=>renderToolbar());
 assert.equal(await p.$$eval('#c-att',es=>es.length),1,'toolbar repaint does not duplicate attachment access');
 assert.equal(await p.evaluate(()=>JSON.stringify(tb.prefs)===window.focusPrefs),true);
 for(const width of [360,691,840,1440]){
  await p.setViewport({width,height:800});
  for(const selector of ['#c-att','#composer-toggle','#send','#box','#attrow'])assert.ok(await p.$eval(selector,e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}),'compact composer control '+selector+' at '+width);
  assert.equal(await p.$eval('#box',e=>e===window.focusInput),true);
  assert.equal(await p.$eval('#tbar',e=>e.getClientRects().length),0);
  if([360,1440].includes(width)){await p.screenshot({path:path.join(out,'focus-composer-'+width+'.png')});await scan('focus-composer-'+width);}
 }
 await clickControl(p,'#c-att');await p.waitForSelector('[data-v="file"]');await p.keyboard.press('Escape');
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('#box');
 assert.equal(await p.$eval('#composer-toggle',e=>e.getAttribute('aria-expanded')),'false');
 assert.match(await p.$eval('#attrow',e=>e.textContent),/fixture.txt/);
 await clickControl(p,'#composer-toggle');await clickControl(p,'#c-model');await p.waitForSelector('[data-v="test"]');await clickControl(p,'[data-v="test"]');
 assert.equal(await p.$$eval('#c-att',es=>es.length),1);
 await p.evaluate(()=>{tb.attachments=[];renderToolbar();stashAttachments();});
 // Chat text scales independently of application chrome and keeps its value on reload.
 const chromeSize=await p.$eval('#results-open',e=>getComputedStyle(e).fontSize);
 await clickControl(p,'#chatmore');await p.waitForSelector('[data-text-larger]');
 assert.equal(await p.$eval('[data-text-size]',e=>e.textContent),'17px');
 await p.focus('[data-text-larger]');await p.keyboard.press('Enter');
 assert.equal(await p.$eval('.m-asst',e=>getComputedStyle(e).fontSize),'18px');
 assert.equal(await p.$eval('.m-user',e=>getComputedStyle(e).fontSize),'18px');
 assert.equal(await p.$eval('#results-open',e=>getComputedStyle(e).fontSize),chromeSize);
 assert.equal(await p.$eval('#box',e=>e.value),'Keep my draft while making room.');
 for(let i=0;i<6;i++)await clickControl(p,'[data-text-larger]');
 assert.equal(await p.$eval('[data-text-larger]',e=>e.disabled),true);
 assert.equal(await p.$eval('.chat-text-preview',e=>getComputedStyle(e).fontSize),'24px');
 assert.ok(await p.$eval('.m-asst h2',e=>Math.abs(parseFloat(getComputedStyle(e).fontSize)-24*22/17)<.01));
 assert.ok(await p.$eval('.report-table table',e=>Math.abs(parseFloat(getComputedStyle(e).fontSize)-24*15/17)<.01));
 await p.screenshot({path:path.join(out,'chat-text-size-desktop.png')});await scan('chat-text-size-desktop');
 await p.keyboard.press('Escape');assert.equal(await p.$eval('#chatmore',e=>e===document.activeElement),true);
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('#box');
 assert.equal(await p.$eval('.m-asst',e=>getComputedStyle(e).fontSize),'24px');
 await clickControl(p,'#chatmore');await p.waitForSelector('[data-text-smaller]');
 for(let i=0;i<10;i++)await clickControl(p,'[data-text-smaller]');
 assert.equal(await p.$eval('[data-text-smaller]',e=>e.disabled),true);
 assert.equal(await p.$eval('.m-asst',e=>getComputedStyle(e).fontSize),'14px');
 await clickControl(p,'[data-text-reset]');assert.equal(await p.$eval('[data-text-size]',e=>e.textContent),'17px');
 await p.keyboard.press('Escape');
 // Settings exposes the same preference and message anchors remain steady as text reflows.
 await clickControl(p,'#railsettings');await p.waitForSelector('[data-text-larger]');
 await clickControl(p,'[data-text-larger]');assert.equal(await p.$eval('.m-asst',e=>getComputedStyle(e).fontSize),'18px');
 await p.keyboard.press('Escape');
 const anchorShift=await p.evaluate(()=>{
  const m=document.querySelector('#msgs').closest('main'),anchor=[...m.querySelectorAll('.m-asst p')].find(e=>e.textContent==='Paragraph 12 in a long report.');
  m.scrollTop+=anchor.getBoundingClientRect().top-m.getBoundingClientRect().top;
  const top=anchor.getBoundingClientRect().top;setChatTextSize(24);return Math.abs(anchor.getBoundingClientRect().top-top);
 });assert.ok(anchorShift<4,'font changes retain the visible paragraph');
 for(const width of [360,390,768,1440]){
  await p.setViewport({width,height:844,isMobile:width<700,hasTouch:width<700});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'large chat text overflow '+width);
  await clickControl(p,'#chatmore');await p.waitForSelector('[data-text-reset]');
  assert.equal(await p.$eval('[data-text-size]',e=>e.textContent),'24px');
  assert.ok(await p.$eval('[data-text-reset]',e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.right<=innerWidth;}));
  if(width===390){await p.screenshot({path:path.join(out,'chat-text-size-mobile.png')});await scan('chat-text-size-mobile');}
  await p.keyboard.press('Escape');
 }
 await p.evaluate(()=>{localStorage.setItem('pc-chat-text-size','999');});await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('#box');
 assert.equal(await p.$eval('.m-asst',e=>getComputedStyle(e).fontSize),'17px','invalid saved sizes fall back to the default');
 await p.evaluate(()=>setChatTextSize(17));
 // Approvals show the exact escaped request; no decision is selected or sent on open.
 await p.goto(base+'/#/chat/'+idle.id);await p.waitForSelector('#c-approval');
 await clickControl(p,'#c-approval');await p.waitForSelector('[data-v="full"]');
 assert.equal(await p.$eval('.sheet h2',e=>e.textContent.trim()),'Permissions for the next reply','1.81: the sheet says reply, like its menu entry');await clickControl(p,'[data-v="full"]');
 assert.match(await p.$eval('#c-approval',e=>e.textContent),/Full access/);
 await clickControl(p,'#c-approval');await clickControl(p,'[data-v="review"]');assert.equal(await p.evaluate(()=>turnOpts().approvalMode),'review');
 for(const width of [390,1440]){
  approvalRequests=[{id:'approval-1',title:'Run this command?',kind:'command',details:JSON.stringify({command:'printf "<script>window.__approvalXSS=1</script>" > report.txt',cwd:'/workspaces/reports'},null,2),canAllow:true,status:'pending'}];
  await p.setViewport({width,height:900,isMobile:width<700,hasTouch:width<700});await p.evaluate(()=>refreshApprovals(chatId));await p.waitForSelector('#approvals-open:not([hidden])');
  await clickControl(p,'#approvals-open');await p.waitForSelector('.approval-card');
  assert.equal(await p.evaluate(()=>Boolean(window.__approvalXSS)),false);assert.equal(await p.$$eval('.approval-card script',e=>e.length),0);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const before=approvalDecisions.length;await p.screenshot({path:path.join(out,'approval-'+width+'.png')});await scan('approval-'+width);
  assert.equal(approvalDecisions.length,before);await p.focus('[data-decision="deny"]');await p.keyboard.press('Enter');
  await p.waitForFunction(()=>!document.querySelector('.approvals-sheet'),'1.82: the sheet closes itself once nothing is waiting');
  assert.equal(approvalDecisions.at(-1),'deny');
  // 1.82: one request is answered from the banner: the question in plain words, the command, the asking subagent, Allow and Don't allow.
  approvalRequests=[{id:'approval-3',title:'Allow Bash?',kind:'tool',agent:'Review imports',details:JSON.stringify({tool:'Bash',cwd:'/workspaces/reports',input:{command:'npm run import:check <script>window.__bannerXSS=1</script>',description:'Run the import checks'}},null,2),canAllow:true,status:'pending'}];
  await p.evaluate(()=>refreshApprovals(chatId));
  await p.waitForFunction(()=>document.querySelector('#approvals-open .wb-title')?.textContent==='Run: Run the import checks?'&&document.querySelector('#approvals-open .wb-agent')?.textContent==='From subagent: Review imports');
  assert.equal(await p.evaluate(()=>Boolean(window.__bannerXSS)),false);
  assert.match(await p.$eval('#approvals-open .wb-note.mono',e=>e.textContent),/npm run import:check/);
  assert.deepEqual(await p.$$eval('#approvals-open .wb-act',e=>e.map(x=>x.textContent)),['Don’t allow','Allow']);
  assert.equal(await p.$eval('#approvals-open .wb-cta',e=>e.textContent),'Details');
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await p.screenshot({path:path.join(out,'approval-banner-'+width+'.png')});await scan('approval-banner-'+width);
  await clickControl(p,'#approvals-open .wb-allow');await p.waitForFunction(()=>document.querySelector('#toast')?.textContent.startsWith('Allowed'));
  assert.equal(approvalDecisions.at(-1),'allow');assert.equal(await p.$('.approvals-sheet'),null,'no sheet opened');
  // Two requests keep the Review button and no inline decision.
  approvalRequests=[{id:'approval-4',title:'Run this command?',kind:'command',details:JSON.stringify({command:'ls'}),canAllow:true,status:'pending'},{id:'approval-5',title:'Run this command?',kind:'command',details:JSON.stringify({command:'pwd'}),canAllow:true,status:'pending'}];
  await p.evaluate(()=>refreshApprovals(chatId));await p.waitForFunction(()=>document.querySelector('#approvals-open .wb-title')?.textContent==='2 requests waiting for your OK'&&!document.querySelector('#approvals-open .wb-act')&&document.querySelector('#approvals-open .wb-cta')?.textContent==='Review');
  // A request Pocket cannot preview offers only Don't allow and Details.
  approvalRequests=[{id:'approval-6',title:'Run this command?',kind:'command',details:JSON.stringify({}),canAllow:false,status:'pending'}];
  await p.evaluate(()=>refreshApprovals(chatId));await p.waitForFunction(()=>document.querySelectorAll('#approvals-open .wb-act').length===1&&document.querySelector('#approvals-open .wb-act')?.textContent==='Don’t allow');
 }
 approvalRequests=[{id:'approval-2',title:'Apply file changes?',kind:'fileChange',details:'+new line',canAllow:true,status:'pending'}];
 await p.evaluate(()=>openApprovals(chatId));await p.waitForSelector('[data-decision="allow"]');approvalFail=true;
 await clickControl(p,'[data-decision="allow"]');await p.waitForFunction(()=>document.querySelector('.approval-outcome')?.textContent.includes('uncertain'));
 assert.equal(await p.$eval('[data-decision="allow"]',e=>e.disabled),true);
 approvalFail=false;approvalRequests=[{...approvalRequests[0],status:'uncertain'}];await clickControl(p,'[data-refresh-approvals]');
 await p.waitForFunction(()=>document.querySelector('.approval-outcome')?.textContent.includes('Decision sent or uncertain'));
 assert.equal(await p.$eval('[data-decision="allow"]',e=>e.disabled),true);await p.keyboard.press('Escape');
 approvalRequests=[];
 // 1.81 (#186): a Codex permissions request and an interrupted connection say reply, not turn
 approvalRequests=[{id:'approval-3',title:'Allow more access?',kind:'permissions',details:'network access to example.test',canAllow:true,status:'pending'}];
 await p.evaluate(()=>openApprovals(chatId));await p.waitForSelector('[data-decision="allow"]');
 assert.equal(await p.$eval('[data-decision="allow"]',e=>e.textContent.trim()),'Allow for this reply');assert.match(await p.$eval('.approval-card .sheet-help',e=>e.textContent),/for the rest of this reply\./);await p.keyboard.press('Escape');
 approvalRequests=[];uiModes.approvalsInterrupted=true;
 await p.evaluate(()=>openApprovals(chatId));await p.waitForSelector('[data-stop-approval]');
 assert.equal(await p.$eval('[data-stop-approval]',e=>e.textContent.trim()),'Stop interrupted reply');assert.doesNotMatch(await p.$eval('.approvals-sheet',e=>e.textContent),/\bturn\b/i);await p.keyboard.press('Escape');uiModes.approvalsInterrupted=false;
 await p.goto(base);await p.waitForSelector('[data-more]');
 await clickControl(p,`[data-more="${rows[0].id}"]`);await clickControl(p,'#so-permissions');await p.waitForSelector('[data-v="full"]');await clickControl(p,'[data-v="full"]');
 assert.equal(await p.evaluate(id=>getPrefs(id).approvalMode,rows[0].id),'full','home-list permissions target the selected session');
 assert.equal(await p.evaluate(id=>getPrefs(id).approvalMode,idle.id),'review','another session keeps its own policy');
 // A server-owned run needs fresh server proof, including while headers collapse.
 await p.goto(base+'/#/chat/'+rows[0].id,{waitUntil:'domcontentloaded'});await p.waitForSelector('#box');
 await p.evaluate(()=>refreshSessions());
 assert.match(await p.$eval('#run-confirmed-state',e=>e.textContent),/^Running( on server)?$/); // short form in the title bar (1.19)
 const proof=await p.evaluate(()=>sessionProofReceivedAt);
 await p.waitForFunction(previous=>sessionProofReceivedAt>previous,{timeout:8000},proof);
 assert.match(await p.$eval('#run-confirmed-at',e=>e.textContent),/^Checked (just now|[0-9]+0s ago)$/);
 await p.evaluate(()=>{headerCollapsed=true;paintWorkspaceDensity();sessionProofReceivedAt=performance.now()-16000;paintRunConfirmation();});
 assert.match(await p.$eval('#run-confirmed-state',e=>e.textContent),/unconfirmed/i);
 assert.equal(await p.$eval('#run-confirmed-at',e=>e.textContent),'Last check 10s ago','an old check is shown in 10-second steps');
 assert.ok(await p.$eval('#run-confirmation',e=>e.getBoundingClientRect().height)>=18);
 stale=true;await p.evaluate(()=>refreshSessions());
 assert.match(await p.$eval('#run-confirmed-state',e=>e.textContent),/unconfirmed/i);
 assert.equal(await p.evaluate(()=>sessionCounts().running),0);
 assert.equal(await p.$eval('#hember',e=>e.hidden),true);
 assert.ok((await p.$$eval('.session-group h2',es=>es.map(e=>e.textContent))).every(t=>!t.startsWith('Running')));
 stale=false;await p.evaluate(()=>refreshSessions());
 assert.match(await p.$eval('#run-confirmed-state',e=>e.textContent),/^Running( on server)?$/); // short form in the title bar (1.19)
 const savedRunning=rows[0].state;rows[0].state={kind:'input',label:'Needs approval',confirmed:true};await p.evaluate(()=>refreshSessions());
 assert.equal(await p.$eval('#run-confirmed-state',e=>e.textContent),'Needs approval');
 await p.evaluate(()=>deliveryNotices.set(chatId,'Message delivered.'));
 rows[0].state={kind:'finished',label:'Response ready',confirmed:true};await p.evaluate(()=>refreshSessions());
 assert.equal(await p.$eval('#delivery-status',e=>e.hidden),true);
 assert.equal(await p.$eval('#run-confirmed-state',e=>e.textContent),'Response ready');rows[0].state=savedRunning;
 rows[1].state={kind:'observed',label:'Activity elsewhere',confirmed:false};
 await p.goto(base+'/#/chat/'+rows[1].id,{waitUntil:'domcontentloaded'});await p.waitForSelector('#box');await p.evaluate(()=>refreshSessions());
 assert.match(await p.$eval('#run-confirmed-state',e=>e.textContent),/^Activity seen(\. Run unconfirmed)?$/);
 // Real clipboard image/text, and attachment ownership across a delayed upload.
 await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await p.goto(base+'/#/chat/'+idle.id,{waitUntil:'domcontentloaded'});await p.waitForSelector('#box');
 await p.bringToFront();await browser.defaultBrowserContext().overridePermissions(base,['clipboard-read','clipboard-write','clipboard-sanitized-write']);
 const png=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=16;c.height=16;c.getContext('2d').fillRect(0,0,16,16);return c.toDataURL('image/png').split(',')[1];});
 await p.evaluate(async png=>{const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));await navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([bytes],{type:'image/png'})})]);},png);
 const beforePaste=uploads.length;
 await p.focus('#box');await p.keyboard.down('Control');await p.keyboard.press('v');await p.keyboard.up('Control');
 await p.waitForFunction(()=>document.querySelector('#attrow')?.textContent.includes('screenshot-'));
 assert.equal(uploads.length,beforePaste+1);assert.ok(uploads.at(-1).size>0);
 await p.evaluate(async()=>{document.querySelector('#box').value='';await navigator.clipboard.writeText('Plain text still pastes normally.');});
 await p.focus('#box');await p.keyboard.down('Control');await p.keyboard.press('v');await p.keyboard.up('Control');
 assert.equal(await p.$eval('#box',e=>e.value),'Plain text still pastes normally.');
 await p.evaluate(async png=>{const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));await navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([bytes],{type:'image/png'})})]);},png);
 await clickControl(p,'#c-att');await p.waitForSelector('[data-v="paste"]');await clickControl(p,'[data-v="paste"]');
 await p.waitForFunction(()=>!uploadsInFlight.size);
 assert.equal(uploads.length,beforePaste+2,'explicit clipboard action uploads the image');
 uploadDelay=700;const destination=rows[3].id;
 await p.evaluate(()=>{uploadFiles([new File(['slow fixture'],'delayed.png',{type:'image/png'})]);location.hash='#/chat/44444444-4444-4444-8444-444444444444';});
 await p.waitForSelector('#box');await p.waitForFunction(()=>!uploadsInFlight.size);
 assert.equal(await p.evaluate(()=>tb.attachments.some(a=>a.name==='delayed.png')),false,'upload must not attach to the destination session');
 assert.equal(await p.evaluate(id=>loadAttachments(id).some(a=>a.name==='delayed.png'),idle.id),true);
 uploadDelay=0;
 await p.goto(base+'/#/new');await p.waitForSelector('#first');
 await p.focus('#first');await p.keyboard.down('Control');await p.keyboard.press('v');await p.keyboard.up('Control');
 await p.waitForFunction(()=>loadAttachments('new').some(a=>a.name.startsWith('screenshot-')));
 // Keep the old conversation and composer alive through Fold and keyboard-sized changes.
 conversations.set(idle.id,[{role:'assistant',blocks:[{t:'text',text:Array.from({length:70},(_,i)=>'Paragraph '+i+': Read the existing conversation without losing your draft.').join('\n\n')}]}]);
 const parent=process.env.MISSION_CONTROL_REPO?base+'/mission-control/pocket.html':null;
 if(parent){
  await p.goto(parent,{waitUntil:'domcontentloaded'});
  const f=await p.waitForFrame(f=>f.url().startsWith('http://localhost:'));
  await f.evaluate(id=>location.hash='#/chat/'+id,idle.id);await f.waitForSelector('#box');
  await f.evaluate(()=>{document.querySelector('#box').value='Fold regression draft';saveDraft(chatId,'Fold regression draft');window.originalComposer=document.querySelector('#box');});
  assert.equal(await f.evaluate(()=>document.featurePolicy.allowsFeature('clipboard-read')),true);
  // Voice mode inside the wrapper: Mission Control must delegate the microphone and screen wake lock to the frame.
  assert.equal(await f.evaluate(()=>document.featurePolicy.allowsFeature('microphone')),true,'Mission Control grants Pocket the microphone');
  assert.equal(await f.evaluate(()=>document.featurePolicy.allowsFeature('screen-wake-lock')),true,'Mission Control grants screen wake lock');
  {
   await f.waitForSelector('#micb:not([hidden])');const heard=voiceLog.transcribe.length;
   const b=await (await f.$('#micb')).boundingBox();await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();
   await f.waitForFunction(()=>document.querySelector('#micb').getAttribute('aria-pressed')==='true');
   await new Promise(r=>setTimeout(r,900));await p.mouse.up();
   await f.waitForFunction(()=>/Added to your draft/.test(document.querySelector('#voice-strip').textContent));
   assert.equal(voiceLog.transcribe.length,heard+1,'speech recorded inside Mission Control reached the server');
   await f.evaluate(()=>{document.querySelector('#box').value='Fold regression draft';saveDraft(chatId,'Fold regression draft');});
  }
  for(const [width,height] of [[390,844],[691,650],[840,650],[1000,700],[390,844]]){
   await p.setViewport({width,height,isMobile:true,hasTouch:true});await new Promise(r=>setTimeout(r,120));
   assert.equal(await f.evaluate(()=>document.querySelector('#box')===window.originalComposer),true,'fold must not remount composer');
   assert.equal(await f.$eval('#box',e=>e.value),'Fold regression draft');
   const outer=await p.$eval('iframe',e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom}));
   const input=await f.$eval('#box',e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom}));
   assert.ok(outer.top+input.bottom<=height+1,'embedded composer visible '+width);
   assert.ok(outer.bottom<=height+1,'frame visible '+width);
  }
  await f.evaluate(()=>setHeaderCollapsed(false));
  await p.waitForFunction(()=>!document.querySelector('.masthead').hidden);
  await new Promise(r=>setTimeout(r,100));
  const before=await f.$eval('main.scroll',e=>e.clientHeight);
  await clickControl(p,'#workspace-toggle');
  await p.waitForFunction(()=>document.querySelector('.masthead').hidden);
  await new Promise(r=>setTimeout(r,100));
  const after=await f.$eval('main.scroll',e=>e.clientHeight);assert.ok(after-before>80,'collapsing both headers returns reading space');
  assert.equal(await p.$eval('.masthead',e=>e.hidden),true,'whole Mission Control header yields to the session control');
  assert.ok(await f.$eval('header #run-confirmation',e=>e.getClientRects().length)>0,'status remains in the header');
  await f.click('#composer-toggle');
  const focused=await f.$eval('main.scroll',e=>e.clientHeight);
  assert.ok(focused-after>=44,'bottom settings return another row');
  assert.equal(await f.$eval('#box',e=>e===window.originalComposer),true);
  await p.screenshot({path:path.join(out,'fold-closed-compact.png')});
  await p.evaluate(()=>{window.visibleTestHeight=430;Object.defineProperty(window.visualViewport,'height',{configurable:true,get:()=>window.visibleTestHeight});window.visualViewport.dispatchEvent(new Event('resize'));});
  await new Promise(r=>setTimeout(r,100));
  const top=await p.$eval('iframe',e=>e.getBoundingClientRect().top),bottom=await f.$eval('#box',e=>e.getBoundingClientRect().bottom);
  assert.ok(top+bottom<=431,'composer stays in visual viewport when layout viewport does not shrink');
  await p.evaluate(()=>{delete window.visualViewport.height;window.dispatchEvent(new Event('resize'));});
  await p.setViewport({width:691,height:650,isMobile:true,hasTouch:true});await new Promise(r=>setTimeout(r,150));
  await p.screenshot({path:path.join(out,'fold-open-compact.png')});
  await p.setViewport({width:2048,height:1050,isMobile:true,hasTouch:true});await new Promise(r=>setTimeout(r,150));
  const measure=await f.$eval('#msgs',e=>e.getBoundingClientRect().width);assert.ok(measure>=1200&&measure<=1280);
  await p.screenshot({path:path.join(out,'desktop-wide.png')});
  // Parent integration accepts only its child origin + window, never arbitrary messages.
  await p.evaluate(()=>dispatchEvent(new MessageEvent('message',{origin:location.origin,source:window,data:{pocketWorkspace:'state',active:false,collapsed:false}})));
  assert.equal(await p.$eval('.masthead',e=>e.hidden),true);
  await f.evaluate(()=>dispatchEvent(new MessageEvent('message',{origin:location.origin,source:window,data:{pocketWorkspace:'set',collapsed:false}})));
  assert.equal(await f.$eval('#header-toggle',e=>e.getAttribute('aria-expanded')),'false');
  await f.click('#header-toggle');await p.waitForFunction(()=>!document.querySelector('.masthead').hidden);
  assert.equal(await p.$eval('#workspace-nav',e=>e.hidden),false);
  assert.equal(await f.$eval('#composer-toggle',e=>e.getAttribute('aria-expanded')),'false','header expand does not expand bottom');
  await clickControl(p,'#workspace-toggle');await p.waitForFunction(()=>document.querySelector('.masthead').hidden);
  assert.equal(await f.$eval('#header-toggle',e=>e.getAttribute('aria-expanded')),'false');
  assert.equal(await f.$eval('#box',e=>e===window.originalComposer),true,'parent control keeps the actual input');
  await p.reload({waitUntil:'domcontentloaded'});
  const restored=await p.waitForFrame(frame=>frame.url().startsWith('http://localhost:'));
  await restored.evaluate(id=>location.hash='#/chat/'+id,idle.id);await restored.waitForSelector('#box');
  await p.waitForFunction(()=>document.querySelector('.masthead').hidden);
  assert.equal(await restored.$eval('#composer-toggle',e=>e.getAttribute('aria-expanded')),'false');
  assert.equal(await restored.$eval('#box',e=>e.value),'Fold regression draft');
  await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  await restored.waitForSelector('#back',{visible:true});await restored.click('#back');await restored.waitForSelector('[data-id]');
  await p.waitForFunction(()=>!document.querySelector('.masthead').hidden);
  // Critical run controls and requests remain available with both preferences saved.
  await restored.evaluate(id=>location.hash='#/chat/'+id,rows[0].id);await restored.waitForSelector('#stopb');
  assert.ok(await restored.$eval('#stopb',e=>e.getClientRects().length)>0);
  assert.ok(await restored.$eval('.send-mode',e=>e.getClientRects().length)>0);
  await restored.evaluate(()=>setConnection('Connection lost. Reconnecting…'));
  assert.ok(await restored.$eval('#connection-state',e=>e.getClientRects().length)>0);

  fs.writeFileSync(path.join(out,'responsive-metrics.json'),JSON.stringify({before,after,focused,readingGain:focused-before,desktopConversationWidth:measure,foldDraftPreserved:true,clipboardUploads:uploads.length},null,2));
 }
 const {runModelSelectionRegressions} = await import('./model-selection-browser.mjs');
 await runModelSelectionRegressions({browser,base,rows,out,received});
 await runUIRegressions({browser,base,rows,out,setMode:patch=>Object.assign(uiModes,patch),getMode:()=>uiModes,settingsState:()=>fixtureSettings,vaultFixture,received,voiceLog,conversations,pinOrders});
 const {runSideChatRegressions}=await import('./sidechat-browser.mjs');
 await runSideChatRegressions({browser,base,rows,out,side:sideFixture,conversations});
 const {runSlashRegressions}=await import('./slash-browser.mjs');
 await runSlashRegressions({browser,base,rows,received,out});
 const {runCliUpdateRegressions}=await import('./cli-updates-browser.mjs');
 await runCliUpdateRegressions({browser,base,out});
 const {runCleanupRegressions}=await import('./cleanup-ui.mjs');
 await runCleanupRegressions({browser,base,rows,out});
 const {runThemeRegressions}=await import('./theme-browser.mjs');
 await runThemeRegressions({browser,base,rows,out,settings:fixtureSettings,modes:uiModes,setRequests:r=>{questionRequests=r.questions||[];approvalRequests=r.approvals||[];}});
 assert.deepEqual(errors,[]);
 await runCoordinationRegressions({p,base,out,repo,rows,settings:fixtureSettings,coord:coordFixture,scan});
 if(scans.length)fs.writeFileSync(path.join(out,'design-scan.json'),JSON.stringify(scans,null,2));
 console.log(JSON.stringify({ok:true,viewports:[360,390,768,1440],dispatches,receiptReplay:true,newSessionRecovery:true,draftAndAttachmentRecovery:true,dialogFocus:true,staleStatus:true,markdownSafety:true,results:true,queueEditing:true,skillLauncher:true,screenshots:out}));
}catch(e){if(e.docsOnly){}else{console.error('Page errors:',errors);console.error('Page URL:',p.url());throw e;}}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}

// 1.56: Settings → Agents & instance → Actions that run without asking. The setting (validation,
// persistence, POCKET_TRUSTED_ACTIONS as the server default) and the approval flow with the fake CLI:
// a trusted request is answered Allow and audited without a card; anything else still shows one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {ApprovalInbox} from '../approvals.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));

test('auto-allow is bound to the live turn, audited first, and fails closed',async()=>{
 const writes=[],audit=[];let broken=false,turn='turn-1';
 const box=new ApprovalInbox({sessionId:()=>'s',turnId:()=>turn,write:async(id,r)=>writes.push([id,r]),audit:r=>{if(broken)throw Error('disk full');audit.push(r);}});
 const req={nativeId:'n1',turnId:'turn-1',kind:'tool',title:'Allow Bash?',details:{tool:'Bash',input:{command:'techpro-lookup secret-arg'}},allow:{behavior:'allow'},deny:{behavior:'deny'},rule:'Bash(techpro-lookup:*)',tool:'Bash'};
 assert.equal(box.autoAllow(req),true);await sleep(0);
 assert.deepEqual(writes,[['n1',{behavior:'allow'}]]);assert.equal(box.list().length,0,'no card');
 assert.deepEqual([audit[0].event,audit[0].decision,audit[0].source,audit[0].rule,audit[0].tool],['auto-allowed','allow','auto-trusted','Bash(techpro-lookup:*)','Bash']);
 assert.equal(JSON.stringify(audit).includes('secret-arg'),false,'the audit holds no arguments');
 assert.equal(box.autoAllow(req),true);await sleep(0);assert.equal(writes.length,1,'a repeated request is not answered twice');
 assert.equal(box.autoAllow({...req,nativeId:'n2',turnId:'old-turn'}),false,'an old turn cannot be auto-approved');
 assert.equal(box.autoAllow({...req,nativeId:'n3',rule:null}),false);
 broken=true;assert.equal(box.autoAllow({...req,nativeId:'n4'}),false,'no audit, no approval');await sleep(0);assert.equal(writes.length,1);
 broken=false;box.receive({...req,nativeId:'n5'});assert.equal(box.autoAllow({...req,nativeId:'n5'}),false,'a request already on a card stays on the card');
 assert.equal(box.autoAllow({...req,nativeId:'n6',details:{text:'x'.repeat(200001)}}),false);
 assert.equal(box.autoAllow({...req,nativeId:'n3b',rule:'full-access:safetyCheck',source:'full-access'}),true);await sleep(0);assert.deepEqual([audit.at(-1).source,audit.at(-1).rule],['full-access','full-access:safetyCheck']);
 box.clear();assert.equal(box.autoAllow({...req,nativeId:'n7'}),false);
 let failed=null;const lost=new ApprovalInbox({sessionId:()=>'s',turnId:()=>'t',write:async()=>{throw Error('pipe lost');},onAutoError:(e,info)=>failed=[e.message,info.rule]});
 assert.equal(lost.autoAllow({...req,turnId:'t'}),true);await sleep(0);assert.deepEqual(failed,['pipe lost','Bash(techpro-lookup:*)']);
});

async function server(t,port,env){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-trusted-'));let logs='';
 const secret=randomUUID(),exp=Date.now()+3600000;
 const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
 fs.mkdirSync(path.join(dir,'sessions','test-workspace'),{recursive:true});
 const child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),POCKET_SKILLS:'0',PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',
  POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),POCKET_CLAUDE_MANAGED_DIR:path.join(dir,'no-policy'),
  CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),...env},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
 t.after(async()=>{if(child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true});});
 for(let i=0;;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{} if(i>100)throw Error('Test server failed: '+logs);await sleep(30);}
 const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
 const lines=f=>fs.existsSync(path.join(dir,f))?fs.readFileSync(path.join(dir,f),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 const auditFile=path.join(dir,'data','approval-decisions.jsonl');
 // Start a turn whose CLI asks permission for one tool call; resolve with what happened to it.
 const ask=async(tool,input,approvalMode='review',request)=>{
  const r=await call('/new',{cwd:repo,text:'__TOOLREQ__ '+JSON.stringify({tool,input,request}),approvalMode,clientMessageId:randomUUID()});
  assert.equal(r.status,202,JSON.stringify(r.body));const id=r.body.id;
  for(let i=0;i<100;i++){
   const answered=lines('calls.responses').find(x=>x.id===id);if(answered)return {id,auto:answered.behavior,card:null};
   const cards=(await call(`/session/${id}/approvals`)).body.requests;if(cards.length)return {id,auto:null,card:cards[0]};
   await sleep(50);
  }
  throw Error('The request was neither answered nor shown: '+logs);
 };
 return {dir,call,ask,lines,auditFile,logs:()=>logs};
}

test('HTTP: trusted actions run without a card in Review actions, are audited, and everything else still asks',async t=>{
 const s=await server(t,18556,{POCKET_TRUSTED_ACTIONS:'Bash(techpro-lookup:*), mcp__memstem__*\nEdit, Bash(x; y)'});
 assert.match(s.logs(),/POCKET_TRUSTED_ACTIONS: ignored "Edit": Edit changes files, so it always asks\./);
 assert.match(s.logs(),/POCKET_TRUSTED_ACTIONS: ignored "Bash\(x; y\)"/);
 const tr=(await s.call('/settings')).body.trusted;
 assert.deepEqual([tr.source,tr.saved,tr.rules,tr.env],['env',false,['Bash(techpro-lookup:*)','mcp__memstem__*'],['Bash(techpro-lookup:*)','mcp__memstem__*']]);
 assert.deepEqual(tr.envIgnored.map(x=>x.rule),['Edit','Bash(x; y)']);

 // A trusted read runs straight through: answered Allow, no card, one audit line naming the rule.
 const ok=await s.ask('Bash',{command:'techpro-lookup quote QT-0001 fixture-arg',description:'Look up a quote'});
 assert.equal(ok.auto,'allow');assert.equal(ok.card,null);
 assert.equal((await s.call(`/session/${ok.id}/approvals`)).body.requests.length,0);
 const entry=s.lines('data/approval-decisions.jsonl').find(x=>x.sessionId===ok.id);
 assert.deepEqual([entry.event,entry.decision,entry.source,entry.rule,entry.tool,entry.kind],['auto-allowed','allow','auto-trusted','Bash(techpro-lookup:*)','Bash','tool']);
 assert.equal(fs.readFileSync(s.auditFile,'utf8').includes('fixture-arg'),false,'arguments never reach the audit');
 assert.match(s.logs(),/trusted action allowed session=\S+ tool=Bash rule="Bash\(techpro-lookup:\*\)"/);
 const mcp=await s.ask('mcp__memstem__memstem_search',{query:'quote'});assert.equal(mcp.auto,'allow');

 // An injection attempt, a look-alike name and an unlisted tool each get the normal card.
 for(const [tool,input] of [['Bash',{command:'techpro-lookup help; rm -rf ~'}],['Bash',{command:'techpro-lookup $(id)'}],['Bash',{command:'techpro-lookup-evil'}],['mcp__memstemx__tool',{}],['Write',{file_path:'/tmp/x',content:'x'}]]){
  const r=await s.ask(tool,input);assert.equal(r.auto,null,JSON.stringify(input));assert.equal(r.card.title,'Allow '+tool+'?');
  assert.equal((await s.call(`/session/${r.id}/approvals/${r.card.id}/decision`,{decision:'deny'})).status,200);
 }
 // 1.105: Full access answers the CLI's own asks (its bypass-immune safety checks) without a card, audited as full-access.
 const full=await s.ask('Bash',{command:"python3 - <<'EOF'\nprint('fixture-arg')\nEOF",description:'Run a script'},'full',{decision_reason:'Dangerous rm operation not ruled out — the shell may read this command differently than it was parsed',decision_reason_type:'safetyCheck',classifier_approvable:false,suppress_always_allow_rule:true});
 assert.equal(full.auto,'allow');assert.equal(full.card,null);
 const fe=s.lines('data/approval-decisions.jsonl').find(x=>x.sessionId===full.id);
 assert.deepEqual([fe.event,fe.decision,fe.source,fe.rule,fe.tool,fe.kind],['auto-allowed','allow','full-access','full-access:safetyCheck','Bash','tool']);
 assert.equal(fs.readFileSync(s.auditFile,'utf8').includes('fixture-arg'),false,'the command never reaches the audit');
 assert.match(s.logs(),/full access allowed session=\S+ tool=Bash reason=safetyCheck: Dangerous rm operation not ruled out/);
 // The trusted list still never answers for Full access; the mode itself does, with its own source.
 const full2=await s.ask('Bash',{command:'techpro-lookup help'},'full');assert.equal(full2.auto,'allow');
 assert.equal(s.lines('data/approval-decisions.jsonl').some(x=>x.sessionId===full2.id&&x.source==='auto-trusted'),false);
 assert.equal(s.lines('data/approval-decisions.jsonl').find(x=>x.sessionId===full2.id).rule,'full-access:ask');

 // Settings: validated, saved outside git, outranks the environment; an empty saved list trusts nothing.
 const bad=await s.call('/settings',{trustedActions:['WebSearch','Write(/etc/x)']});
 assert.equal(bad.status,400);assert.deepEqual([bad.body.code,bad.body.rule,bad.body.index],['bad_trusted_action','Write(/etc/x)',1]);assert.match(bad.body.error,/changes files/);
 assert.equal((await s.call('/settings',{trustedActions:'Bash(a:*)'})).status,400);
 assert.equal((await s.call('/settings',{trustedActions:['Bash']})).status,400);
 assert.equal((await s.call('/settings',{trustedActions:['mcp__*']})).status,400);
 const saved=await s.call('/settings',{trustedActions:['  Bash(sck-site product :*)','WebSearch','WebSearch']});
 assert.equal(saved.status,200);assert.deepEqual([saved.body.trusted.source,saved.body.trusted.saved,saved.body.trusted.rules],['settings',true,['Bash(sck-site product:*)','WebSearch']]);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.dir,'data','pocket-settings.json'),'utf8')).trustedActions,['Bash(sck-site product:*)','WebSearch']);
 assert.equal((await s.ask('Bash',{command:'sck-site product list'})).auto,'allow','a saved rule applies at once');
 assert.equal((await s.ask('Bash',{command:'techpro-lookup help'})).auto,null,'the saved list replaces the environment list');
 const none=await s.call('/settings',{trustedActions:[]});assert.deepEqual([none.body.trusted.source,none.body.trusted.rules],['settings',[]]);
 assert.equal((await s.ask('Bash',{command:'sck-site product list'})).auto,null);
 const reset=await s.call('/settings',{trustedActions:null});
 assert.deepEqual([reset.body.trusted.source,reset.body.trusted.saved,reset.body.trustedActions],['env',false,null]);

 // An audit that cannot be written approves nothing.
 fs.rmSync(s.auditFile);fs.mkdirSync(s.auditFile);
 const blind=await s.ask('Bash',{command:'techpro-lookup help'});assert.notEqual(blind.auto,'allow');
});

test('HTTP: without POCKET_TRUSTED_ACTIONS or a saved list, every action asks as before',async t=>{
 const s=await server(t,18557,{});
 assert.deepEqual((await s.call('/settings')).body.trusted,{rules:[],source:'none',saved:false,env:[],envIgnored:[]});
 const r=await s.ask('WebSearch',{query:'x'});assert.equal(r.auto,null);assert.ok(r.card);
});

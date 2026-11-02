// 1.92: the context limit and subagent (worker) model, one policy for every engine (context-policy.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {readPolicy,cleanPolicy,claudeLaunch,codexLaunch,claudeWorkerFor,codexWorkerFor,isDefaultPolicy,launchKey,DEFAULT_POLICY} from '../context-policy.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID)_/.test(k)));

test('the default policy changes nothing on either engine',()=>{
 assert.deepEqual(readPolicy(null),DEFAULT_POLICY);
 assert.deepEqual(readPolicy({compaction:'x',workers:[1]}),DEFAULT_POLICY,'anything unreadable is the default');
 assert.ok(isDefaultPolicy(null));
 assert.deepEqual(claudeLaunch(null,'claude-opus-5-5'),{env:{},key:''});
 assert.deepEqual(codexLaunch(null,'gpt-6-astra','gpt-6.1-sol'),{config:{},key:''});
});

test('one tier down: Fable → Opus, Opus → Sonnet, Astra → the newest Sol; the rest keep the agent default',()=>{
 assert.equal(claudeWorkerFor('claude-fable-5-1'),'opus');
 assert.equal(claudeWorkerFor('claude-mythos-5-1'),'opus');
 assert.equal(claudeWorkerFor('opus[1m]'),'sonnet');
 assert.equal(claudeWorkerFor('claude-opus-5-5[1m]'),'sonnet');
 for(const m of ['claude-sonnet-5-5','sonnet','claude-haiku-5-5',null,''])assert.equal(claudeWorkerFor(m),null,String(m));
 assert.equal(codexWorkerFor('gpt-6-astra','gpt-6.1-sol'),'gpt-6.1-sol');
 assert.equal(codexWorkerFor('gpt-6-astra',null),null,'no model list yet: no override');
 for(const m of ['gpt-6.1-sol','gpt-6-luna','gpt-6.1-terra',null])assert.equal(codexWorkerFor(m,'gpt-6.1-sol'),null,String(m));
});

test('launch options for a limit, tier-down workers and a worker effort',()=>{
 const p={compaction:{mode:'limit',limit:200000},workers:{model:'tier-down',effort:'low'}};
 const c=claudeLaunch(p,'claude-opus-5-5[1m]');
 assert.deepEqual(c.env,{CLAUDE_CODE_AUTO_COMPACT_WINDOW:'200000',CLAUDE_CODE_SUBAGENT_MODEL:'sonnet',CLAUDE_CODE_SUBAGENT_EFFORT:'low'});
 assert.equal(c.key,launchKey(c.env));assert.notEqual(c.key,'');
 assert.deepEqual(claudeLaunch(p,'claude-sonnet-5-5').env,{CLAUDE_CODE_AUTO_COMPACT_WINDOW:'200000',CLAUDE_CODE_SUBAGENT_EFFORT:'low'},'a Sonnet leader keeps the agent default worker');
 const x=codexLaunch(p,'gpt-6-astra','gpt-6.1-sol');
 assert.deepEqual(x.config,{model_auto_compact_token_limit:170000,'agents.default_subagent_model':'gpt-6.1-sol','agents.default_subagent_reasoning_effort':'low'});
 assert.equal(launchKey({b:1,a:2}),launchKey({a:2,b:1}),'the key does not depend on key order');
});

test('settings patches are checked and merged over the saved policy',()=>{
 let r=cleanPolicy({compaction:{mode:'limit',limit:300000}},null);
 assert.deepEqual(r.policy,{compaction:{mode:'limit',limit:300000},workers:{model:'default',effort:null}});
 r=cleanPolicy({workers:{model:'tier-down'}},r.policy);
 assert.deepEqual(r.policy,{compaction:{mode:'limit',limit:300000},workers:{model:'tier-down',effort:null}},'a patch keeps what it does not name');
 for(const bad of [null,[],'x',{compaction:{mode:'handoff'}},{compaction:{limit:10}},{compaction:{limit:2e6}},{compaction:{limit:200000.5}},{workers:{model:'haiku'}},{workers:{effort:'max'}},{workers:'x'}])
  assert.ok(cleanPolicy(bad,null).error,JSON.stringify(bad));
 assert.equal(cleanPolicy({workers:{effort:null}},{workers:{effort:'low'}}).policy.workers.effort,null,'null clears the effort');
});

async function server(t,port,extraEnv={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pocket-ctxpolicy-'));
 const codexHome=path.join(dir,'codex-home');fs.mkdirSync(codexHome);fs.writeFileSync(path.join(codexHome,'config.toml'),'model = "gpt-6-astra"\n\n[agents]\ndefault_subagent_model = "gpt-6-luna"\n');
 const secret=randomUUID(),exp=Date.now()+3600000;
 const headers={'content-type':'application/json',cookie:'pc_auth='+exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex')};
 let logs='';
 const child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),POCKET_SKILLS:'0',PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,
  POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CODEX_HOME:codexHome,HOME:dir, // HOME: never read the owner's ~/.claude/settings.json
 
  CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),CODEX_BIN:path.join(repo,'test/fake-codex.mjs'),
  FAKE_CODEX_MODELS:JSON.stringify([{id:'gpt-6.1-sol',displayName:'GPT-6.1 Sol'},{id:'gpt-6-sol',displayName:'GPT-6 Sol'},{id:'gpt-6-astra',displayName:'GPT-6 Astra'}]),...extraEnv},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
 t.after(async()=>{if(child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}fs.rmSync(dir,{recursive:true,force:true});});
 for(let i=0;;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{} if(i>150)throw Error('Test server failed: '+logs);await sleep(30);}
 const call=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)}};
 const lines=f=>{try{return fs.readFileSync(path.join(dir,f),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)}catch{return []}};
 const until=async(fn,ms=5000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return true;await sleep(50)}return false;};
 return {dir,call,lines,until,logs:()=>logs};
}

test('Settings saves the policy and every new Claude and Codex process starts with it',async t=>{
 const s=await server(t,18481);
 let st=(await s.call('/settings')).body.contextPolicy;
 assert.deepEqual([st.compaction,st.workers],[DEFAULT_POLICY.compaction,DEFAULT_POLICY.workers],'an install starts on the agents’ own behavior');
 assert.deepEqual(st.engines.map(e=>[e.id,e.applies]),[['claude',true],['codex',true]]);
 // Default policy: nothing is passed.
 const a=await s.call('/new',{cwd:repo,text:'before',model:'claude-opus-5-5[1m]',clientMessageId:randomUUID()});assert.equal(a.status,202);
 assert.ok(await s.until(()=>s.lines('calls').length>=1));
 assert.equal(s.lines('calls')[0].settingsEnv,null);
 // A bad patch is refused and changes nothing.
 const bad=await s.call('/settings',{contextPolicy:{compaction:{mode:'limit',limit:5}}});assert.equal(bad.status,400);assert.equal(bad.body.code,'bad_context_policy');
 const ok=await s.call('/settings',{contextPolicy:{compaction:{mode:'limit',limit:200000},workers:{model:'tier-down',effort:'low'}}});
 assert.equal(ok.status,200);assert.deepEqual(ok.body.contextPolicy.compaction,{mode:'limit',limit:200000});
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.dir,'data','pocket-settings.json'),'utf8')).contextPolicy,{compaction:{mode:'limit',limit:200000},workers:{model:'tier-down',effort:'low'}});
 // The same conversation's next reply runs on a process started with the policy (the idle one was restarted).
 assert.ok(await s.until(async()=>!(await s.call(`/session/${a.body.id}`)).body?.active));
 const b=await s.call(`/session/${a.body.id}/message`,{text:'after',model:'claude-opus-5-5[1m]',clientMessageId:randomUUID()});assert.equal(b.status,202);
 assert.ok(await s.until(()=>s.lines('calls').some(c=>c.text==='after')));
 assert.deepEqual(s.lines('calls').find(c=>c.text==='after').settingsEnv,{CLAUDE_CODE_AUTO_COMPACT_WINDOW:'200000',CLAUDE_CODE_SUBAGENT_MODEL:'sonnet',CLAUDE_CODE_SUBAGENT_EFFORT:'low'});
 assert.match(s.logs(),/context policy changed/);
 // A Fable conversation gets Opus workers.
 await s.call('/new',{cwd:repo,text:'fable',model:'claude-fable-5-1[1m]',clientMessageId:randomUUID()});
 assert.ok(await s.until(()=>s.lines('calls').some(c=>c.text==='fable')));
 {const f=s.lines('calls').find(c=>c.text==='fable');assert.equal(f.settingsEnv.CLAUDE_CODE_SUBAGENT_MODEL,'opus',JSON.stringify(f));}
 // Codex on Default: the leader is config.toml's GPT-6 Astra, so its workers are the newest Sol.
 await s.call('/codex/models');
 const cx=await s.call('/new',{cwd:repo,provider:'codex',text:'codex',clientMessageId:randomUUID()});assert.equal(cx.status,202);
 assert.ok(await s.until(()=>s.lines('calls.threads').length>=1));
 assert.deepEqual(s.lines('calls.threads')[0].config,{model_auto_compact_token_limit:170000,'agents.default_subagent_model':'gpt-6.1-sol','agents.default_subagent_reasoning_effort':'low'});
 // Back to the default: null clears it from the file, and new processes get nothing again.
 const off=await s.call('/settings',{contextPolicy:null});assert.equal(off.status,200);assert.equal(off.body.contextPolicy.compaction.mode,'agent');
 assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir,'data','pocket-settings.json'),'utf8')).contextPolicy,null);
 await s.call('/new',{cwd:repo,text:'cleared',model:'claude-opus-5-5[1m]',clientMessageId:randomUUID()});
 assert.ok(await s.until(()=>s.lines('calls').some(c=>c.text==='cleared')));
 assert.equal(s.lines('calls').find(c=>c.text==='cleared').settingsEnv,null);
});

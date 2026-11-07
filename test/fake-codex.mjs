#!/usr/bin/env node
// Integration-only Codex app-server: JSON-RPC over stdio, never calls a model.
// Simulates the per-thread writer lock that a loaded thread holds until the process exits.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {randomUUID} from 'node:crypto';
// 1.89 side chat (codex.mjs sideChatConfig): `codex mcp list --json` lists the servers in $CODEX_HOME/config.toml (plain and
// double-quoted [mcp_servers.<name>] headers only; the real CLI reads every form). FAKE_CODEX_MCP_LIST=fail makes it fail.
if(process.argv[2]==='mcp'&&process.argv[3]==='list'){
  if(process.env.FAKE_CODEX_MCP_LIST==='fail'){console.error('Error: failed to load configuration');process.exit(1);}
  let toml='';try{toml=fs.readFileSync(path.join(process.env.CODEX_HOME||path.join(process.env.HOME,'.codex'),'config.toml'),'utf8');}catch{}
  console.log(JSON.stringify([...toml.matchAll(/^\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]\s*$/gm)].map(m=>({name:m[1]||m[2],enabled:true}))));
} else
// One-shot title call (titles.mjs): `codex exec --ephemeral … --json -` reads the prompt on stdin and prints JSONL events.
if(process.argv[2]==='exec'&&process.argv.includes('--ephemeral')){
  let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
    const tr=input.match(/<transcript>\n([\s\S]*?)\n<\/transcript>/);
    const se=input.match(/<session>\n([\s\S]*?)\n<\/session>\n\nThe session is currently titled: (.*)\n/);
    if(se){if(process.env.POCKET_TEST_CALLS)fs.appendFileSync(process.env.POCKET_TEST_CALLS+'.live','codex '+se[2]+' => '+se[1].replace(/\n/g,' | ').slice(0,300)+'\n');
      for(const o of [{type:'item.completed',item:{type:'agent_message',text:/KEEPTITLE/.test(se[1])?'KEEP':'Codex now '+(se[1].split('\n').filter(l=>l.startsWith('Owner: ')).at(-1)||'').replace(/^Owner: /,'').split(/\s+/).slice(0,3).join(' ')}},{type:'turn.completed',usage:{}}])console.log(JSON.stringify(o));return;}
    if(tr){for(const o of [{type:'item.completed',item:{type:'agent_message',text:'Codex summary: '+tr[1].split('\n')[0].slice(0,40)}},{type:'turn.completed',usage:{}}])console.log(JSON.stringify(o));return;}
    const req=(input.match(/<request>\n([\s\S]*?)\n<\/request>/)||[,input])[1];
    if(process.env.POCKET_TEST_CALLS)fs.appendFileSync(process.env.POCKET_TEST_CALLS+'.titles','codex '+process.argv[process.argv.indexOf('-m')+1]+': '+req.slice(0,200).replace(/\n/g,' ')+'\n');
    for(const o of [{type:'thread.started',thread_id:'x'},{type:'item.completed',item:{type:'reasoning',text:''}},{type:'item.completed',item:{type:'agent_message',text:'Codex '+req.split(/\s+/).slice(0,3).join(' ')}},{type:'turn.completed',usage:{}}])console.log(JSON.stringify(o));
  });
} else {
const root=process.env.POCKET_SESSION_ROOT,calls=process.env.POCKET_TEST_CALLS;
if(!root||!calls)throw Error('Test environment required');
const lockDir=path.join(root,'codex-locks');fs.mkdirSync(lockDir,{recursive:true});
const held=new Set();
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
function takeLock(id){
  const f=path.join(lockDir,id);
  try{const pid=Number(fs.readFileSync(f,'utf8'));if(pid!==process.pid&&alive(pid))return false;}catch{}
  fs.writeFileSync(f,String(process.pid));held.add(id);return true;
}
process.on('exit',()=>{for(const id of held){try{fs.unlinkSync(path.join(lockDir,id))}catch{}}});
// FAKE_CODEX_STUBBORN ignores SIGTERM and stays up after stdin ends (a hung app-server); FAKE_CODEX_PIDS records each process;
// FAKE_CODEX_INIT_FAIL / FAKE_CODEX_DIE_ON name marker files: while one exists, the next initialize fails / thread/list exits.
const stubborn=Boolean(process.env.FAKE_CODEX_STUBBORN);
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{if(!stubborn)process.exit(0);});
if(stubborn)setInterval(()=>{},1000);
if(process.env.FAKE_CODEX_PIDS)fs.appendFileSync(process.env.FAKE_CODEX_PIDS,process.pid+'\n');
const takeMarker=f=>{if(!f)return false;try{fs.unlinkSync(f);return true;}catch{return false;}};
setInterval(()=>{if(!fs.existsSync(root))process.exit(0)},300).unref();
const send=o=>process.stdout.write(JSON.stringify(o)+'\n');
const notify=(method,params)=>send({jsonrpc:'2.0',method,params});
const reply=(id,result)=>send({jsonrpc:'2.0',id,result});
const fail=(id,message)=>send({jsonrpc:'2.0',id,error:{code:-32600,message}});
// 1.86: this fake's own requests to Pocket (a question), answered by id
const asked=new Map();let askSeq=0;
// 1.87 parity markers: __PLAN__ (a plan update), __EDIT__ (a file change with its diff, saved to the thread),
// __LIMIT__ (a usage limit with its plan window full until 2 s from now), __CMDAPPROVAL__ (asks to run `echo CX_OK`);
// every reply reports token usage; thread/compact/start and review/start run their own turns.
// the account's limit is shared by every app-server process (Pocket reads it from its reader process), so it lives in a file
const limitFile=path.join(root,'.limit');
const limitAt=()=>{try{return Number(fs.readFileSync(limitFile,'utf8'))||0;}catch{return 0;}};
const persist=(threadId,turnId,item)=>{const f=path.join(root,threadId+'.items.json');let items=[];try{items=JSON.parse(fs.readFileSync(f,'utf8'));}catch{}fs.writeFileSync(f,JSON.stringify([...items,{turnId,item}]));};
const askPocket=(method,params)=>new Promise(r=>{const id='fake-ask-'+(++askSeq);asked.set(id,r);send({jsonrpc:'2.0',id,method,params});});
readline.createInterface({input:process.stdin}).on('line',line=>{
  let m;try{m=JSON.parse(line)}catch{return}
  if(m.id!=null&&!m.method&&asked.has(m.id)){const r=asked.get(m.id);asked.delete(m.id);return r(m.result);}
  if(m.id==null)return; // notifications and responses
  const p=m.params||{};
  if(m.method==='thread/start'||m.method==='thread/resume')fs.appendFileSync(calls+'.threads',JSON.stringify({method:m.method,choices:/`choices`/.test(p.developerInstructions||''),projects:/pocket-board/.test(p.developerInstructions||''),documents:/pocket-docs/.test(p.developerInstructions||''),google:/pocket-google\/SKILL\.codex\.md/.test(p.developerInstructions||''),config:p.config??null,model:p.model??null})+'\n');
  switch(m.method){
    case 'initialize':if(takeMarker(process.env.FAKE_CODEX_INIT_FAIL))return fail(m.id,'initialize refused');
      // Close before advertising readiness. Otherwise a fast parent can write the next request
      // between reply() and close(), so it succeeds and waits for a response instead of EPIPE.
      if(process.env.FAKE_CODEX_CLOSE_STDIN){fs.closeSync(0);setInterval(()=>{},1000);}
      reply(m.id,{});return;
    case 'thread/start':{const id=randomUUID();takeLock(id);if(p.cwd)fs.writeFileSync(path.join(root,id+'.cwd'),p.cwd);return reply(m.id,{thread:{id},model:'gpt-test',reasoningEffort:null});} // 1.86: remembers its folder for thread/read
    case 'thread/resume':
      if(!takeLock(p.threadId))return fail(m.id,`thread ${p.threadId} already has an active writer`);
      if(calls)fs.appendFileSync(calls+'.resumes',JSON.stringify({threadId:p.threadId,cwd:p.cwd||null})+'\n');
      return reply(m.id,{model:'gpt-test',reasoningEffort:null,cwd:p.cwd||process.cwd()});
    case 'turn/start':{
      const text=p.input?.[0]?.text||'',turnId=randomUUID();
      fs.appendFileSync(calls+'.codex',JSON.stringify({threadId:p.threadId,pid:process.pid,text,model:p.model,collaborationModel:p.collaborationMode?.settings?.model})+'\n');
      reply(m.id,{turn:{id:turnId}});
      notify('turn/started',{turnId});
      // __NULLFRAME__: lines that parse as JSON but are not objects (a real app-server once wrote a bare `null`).
      if(text.includes('__NULLFRAME__'))for(const raw of ['null','1','"str"','[]','true'])process.stdout.write(raw+'\n');
      // __LATEUSER__: like Pocket's reader process, the history has the user message only a moment after turn/start
      // returns. __ATTACHNOTE__: stored with the note Codex keeps after the text when files are attached.
      if(text.includes('__LATEUSER__'))setTimeout(()=>{
        const f=path.join(root,p.threadId+'.items.json');let items=[];try{items=JSON.parse(fs.readFileSync(f,'utf8'));}catch{}
        const stored=text.includes('__ATTACHNOTE__')?text+'\n\n[Attached file — read as needed:\n/tmp/a.png\n]':text;
        fs.writeFileSync(f,JSON.stringify([...items,{turnId,item:{type:'userMessage',id:randomUUID(),content:[{type:'text',text:stored}]}}]));
      },900);
      if(text.includes('__CHILD_LIFECYCLE__')){
        const item={id:'child-start',type:'subAgentActivity',agentThreadId:'child-thread',agentPath:'/root/reviewer',kind:'started'};
        notify('item/completed',{threadId:p.threadId,item});
        notify('turn/started',{threadId:'child-thread',turn:{id:'child-turn',status:'inProgress'}});
        notify('item/agentMessage/delta',{threadId:'child-thread',delta:'CHILD TEXT MUST NOT LEAK'});
        notify('turn/completed',{threadId:'child-thread',turn:{id:'child-turn',status:'completed'}});
        notify('item/completed',{threadId:p.threadId,item:{...item,id:'child-finish',kind:'completed'}});
      }
      if(text.includes('__HANG__'))return;
      if(text.includes('__AGENTS__')){
        const item={id:'agent-spawn',type:'collabAgentToolCall',tool:'spawnAgent',status:'completed',receiverThreadIds:['child-agent'],agentsStates:{'child-agent':{status:'running'}},prompt:'Check parser failures',model:'gpt-test'};
        notify('item/completed',{item});
        fs.writeFileSync(path.join(root,p.threadId+'.items.json'),JSON.stringify([item]));
        setTimeout(()=>{
          const done={...item,id:'agent-wait',tool:'wait',agentsStates:{'child-agent':{status:'completed',message:'Parser checks passed.'}}};
          fs.writeFileSync(path.join(root,p.threadId+'.items.json'),JSON.stringify([item,done]));
          notify('item/completed',{item:done});
        },1000);
      }
      // 1.86: __CHOICES__ ends with a ```choices block; __QUESTION__ asks Pocket (requestUserInput) and answers with the choice
      const finish=said=>{notify('item/agentMessage/delta',{delta:'Codex test '});notify('item/completed',{item:{type:'agentMessage',id:randomUUID(),text:said}});notify('thread/tokenUsage/updated',{threadId:p.threadId,turnId,tokenUsage:{last:{totalTokens:1234,inputTokens:1000,cachedInputTokens:800,outputTokens:234},modelContextWindow:200000}});notify('turn/completed',{turn:{id:turnId,status:'completed'}});};
      if(text.includes('__PLAN__'))notify('turn/plan/updated',{threadId:p.threadId,turnId,plan:[{step:'Read the code',status:'completed'},{step:'Fix the bug',status:'inProgress'}]});
      if(text.includes('__EDIT__')){const item={type:'fileChange',id:randomUUID(),status:'completed',changes:[{path:path.join(fs.existsSync(path.join(root,p.threadId+'.cwd'))?fs.readFileSync(path.join(root,p.threadId+'.cwd'),'utf8'):process.cwd(),'parity.txt'),kind:{type:'update'},diff:'@@ -1 +1 @@\n-old line\n+new line\n'}]};persist(p.threadId,turnId,item);notify('item/completed',{threadId:p.threadId,turnId,item});}
      if(text.includes('__LIMIT__')){fs.writeFileSync(limitFile,String(Date.now()+2000));const error={message:"You've hit your usage limit.",codexErrorInfo:'usageLimitExceeded'};setTimeout(()=>{notify('error',{threadId:p.threadId,turnId,willRetry:false,error});notify('turn/completed',{turn:{id:turnId,status:'failed',error}});},150);return;}
      if(text.includes('__CMDAPPROVAL__')){askPocket('item/commandExecution/requestApproval',{threadId:p.threadId,turnId,itemId:randomUUID(),command:"/bin/bash -lc 'echo CX_OK'",cwd:process.cwd()}).then(r=>{fs.appendFileSync(calls+'.cxapprovals',JSON.stringify({decision:r?.decision})+'\n');finish('Codex ran it: '+(r?.decision||'none'));});return;}
      if(text.includes('__QUESTION__')){askPocket('item/tool/requestUserInput',{threadId:p.threadId,turnId,questions:[{id:'q-color',header:'Color',question:'Which color?',options:[{label:'Blue',description:'Cool'},{label:'Red',description:'Warm'}]}]}).then(r=>finish('Codex heard '+JSON.stringify(r?.answers||{})));return;}
      setTimeout(()=>finish(text.includes('__CHOICES__')?'Tests pass. Should I merge and deploy?\n\n```choices\nMerge and deploy\nNot yet\n```':'Codex test response.'),text.includes('__SLOW__')?1500:200);
      return;
    }
    // 1.79: a fork copies the source thread's items into a new thread; ephemeral ones are not saved and hold no lock.
    case 'thread/fork':{
      fs.appendFileSync(calls+'.forks',JSON.stringify({threadId:p.threadId,ephemeral:Boolean(p.ephemeral),sandbox:p.sandbox,approvalPolicy:p.approvalPolicy,config:p.config||null,side:/side chat/.test(p.developerInstructions||''),pid:process.pid})+'\n');
      const id=randomUUID();
      if(!p.ephemeral){takeLock(id);let items=[];try{items=JSON.parse(fs.readFileSync(path.join(root,p.threadId+'.items.json'),'utf8'));}catch{}fs.writeFileSync(path.join(root,id+'.items.json'),JSON.stringify(items));}
      return reply(m.id,{thread:{id,ephemeral:Boolean(p.ephemeral)},model:'gpt-test',reasoningEffort:null,cwd:p.cwd||process.cwd()});
    }
    case 'turn/interrupt':reply(m.id,{});return notify('turn/completed',{turn:{id:p.turnId,status:'interrupted'}});
    case 'thread/items/list':{
      let data=[];try{data=JSON.parse(fs.readFileSync(path.join(root,p.threadId+'.items.json'),'utf8'));}catch{}
      // Pages like the real app-server: newest first on request, `limit` rows; every call is recorded.
      fs.appendFileSync(calls+'.items',JSON.stringify({threadId:p.threadId,limit:p.limit??null,desc:p.sortDirection==='desc',cursor:p.cursor??null})+'\n');
      if(p.sortDirection==='desc')data=data.slice().reverse();
      let from=0;if(p.cursor){try{from=JSON.parse(p.cursor).o|0;}catch{return fail(m.id,'bad cursor');}}
      const limit=Number.isInteger(p.limit)?Math.min(p.limit,100):100; // the real app-server caps a page at 100
      const page=data.slice(from,from+limit),end=from+page.length;
      return reply(m.id,{data:page,nextCursor:end<data.length?JSON.stringify({o:end,desc:p.sortDirection==='desc'}):null});
    }
    case 'thread/list':if(takeMarker(process.env.FAKE_CODEX_DIE_ON))process.exit(0);
    case 'model/list':return reply(m.id,{data:process.env.FAKE_CODEX_MODELS?JSON.parse(process.env.FAKE_CODEX_MODELS):[],nextCursor:null}); // FAKE_CODEX_MODELS: the models to list, in the app-server's shape
    case 'skills/list':return reply(m.id,{data:[],nextCursor:null});
    case 'thread/read':{let cwd=process.cwd();try{cwd=fs.readFileSync(path.join(root,p.threadId+'.cwd'),'utf8');}catch{}return reply(m.id,{thread:{id:p.threadId,turns:[],preview:'',cwd}});}
    case 'account/rateLimits/read':{const at=limitAt();return reply(m.id,{rateLimits:{primary:{usedPercent:at>Date.now()?100:12,resetsAt:Math.ceil((at>Date.now()?at:Date.now()+3600_000)/1000),windowDurationMins:300},secondary:{usedPercent:5,resetsAt:Math.ceil(Date.now()/1000)+604800,windowDurationMins:10080}}});}
    case 'thread/compact/start':case 'review/start':{ // 1.87: Codex's own turns on the thread
      const turnId=randomUUID(),kind=m.method==='review/start'?'review':'compact';
      fs.appendFileSync(calls+'.codex',JSON.stringify({threadId:p.threadId,pid:process.pid,text:'['+kind+']',target:p.target||null})+'\n');
      reply(m.id,kind==='review'?{turn:{id:turnId}}:{});
      notify('turn/started',{turnId});
      setTimeout(()=>{
        if(kind==='review'){notify('item/completed',{item:{type:'enteredReviewMode',id:randomUUID(),review:'the uncommitted changes'}});notify('item/completed',{item:{type:'exitedReviewMode',id:randomUUID(),review:'Review: no issues found.'}});}
        else notify('item/completed',{item:{type:'contextCompaction',id:randomUUID()}});
        notify('turn/completed',{turn:{id:turnId,status:'completed'}});
      },200);
      return;
    }
    default:return fail(m.id,'unsupported in fake codex: '+m.method);
  }
});
}

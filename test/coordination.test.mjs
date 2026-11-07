// 1.99 holds: one holder, close names refused, a line of waiters woken once, and nothing half written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CoordStore,LIMITS,SEEDS,checkName,closeName,coordinationInstructions,parseTtl} from '../coordination.mjs';

const A={kind:'conversation',session:'a'},B={kind:'conversation',session:'b'},C={kind:'conversation',session:'c'},T={kind:'terminal',session:null};
const min=60_000;
function store(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coord-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const clock={t:1_000_000},file=path.join(dir,'coordination.json');
  return {s:new CoordStore(file,{now:()=>clock.t}),clock,file,dir};
}
const code=c=>e=>e.code===c;

test('names and times are checked',()=>{
  assert.equal(checkName(' DAD-Staging '),'dad-staging');
  for(const bad of ['','-x','a b','a/b','x'.repeat(65),null])assert.throws(()=>checkName(bad),/letters, numbers/);
  assert.equal(parseTtl('45m'),45*min);assert.equal(parseTtl('2h'),120*min);assert.equal(parseTtl(30),30*min);assert.equal(parseTtl(undefined),60*min);
  for(const bad of ['9h','0','soon','-5m'])assert.throws(()=>parseTtl(bad));
});

test('close names catch two names for one thing, and leave different things alone',()=>{
  assert.equal(closeName('staging',SEEDS),'dad-staging');
  assert.equal(closeName('dad-stagin',SEEDS),'dad-staging');
  assert.equal(closeName('dad-production-2',SEEDS),'dad-production');
  assert.equal(closeName('tpv-deplo',SEEDS),'tpv-deploy');
  for(const name of ['sck-live','tpv-cloud','memstem','dad'.padEnd(3)])assert.equal(closeName(name,['pocket-main','tpv-deploy','dad-production2']),name==='dad'?'dad-production2':null);
});

test('one holder: a clash names them, the same conversation renews, and a reason is required',t=>{
  const {s,clock}=store(t);
  assert.throws(()=>s.hold('dad-staging',{holder:A}),/needs a reason/);
  s.hold('dad-staging',{reason:'Build 1.168',ttl:'45m',holder:A});
  assert.throws(()=>s.hold('dad-staging',{reason:'mine',holder:B}),e=>e.status===409&&e.code==='held'&&e.hold.holder.session==='a'&&e.hold.reason==='Build 1.168');
  clock.t+=10*min;
  const again=s.hold('dad-staging',{holder:A});
  assert.equal(again.renewed,true);assert.equal(again.hold.reason,'Build 1.168','renewing without a reason keeps the reason');
  assert.equal(again.hold.expiresAt,clock.t+60*min);assert.equal(s.state.holds.length,1);
  s.hold('pocket-main',{reason:'Terminal job',holder:T});
  assert.throws(()=>s.hold('pocket-main',{reason:'Again',holder:T}),code('held'),'an unverified session cannot prove it is the same one');
});

test('close-name refusal, and --new records the name for next time',t=>{
  const {s}=store(t);
  assert.throws(()=>s.hold('staging',{reason:'x',holder:A}),e=>e.code==='close_name'&&e.status===409&&/Use dad-staging/.test(e.message));
  s.hold('staging',{reason:'x',isNew:true,holder:A});s.release('staging',{by:A});
  assert.ok(s.state.names.includes('staging'));
  s.hold('staging',{reason:'y',holder:B});
  s.hold('sck-live',{reason:'z',holder:B});
  assert.throws(()=>s.hold('sck-livee',{reason:'x',holder:A}),e=>e.code==='close_name','a live hold counts as a known name');
});

test('who may release: the holder, or anyone for a terminal hold; the owner always',t=>{
  const {s}=store(t);
  s.hold('dad-staging',{reason:'x',holder:A});
  assert.throws(()=>s.release('dad-staging',{by:T}),e=>e.status===403&&e.code==='not_holder');
  assert.throws(()=>s.release('dad-staging',{by:B}),code('not_holder'));
  assert.deepEqual(s.release('dad-staging',{by:A,note:'  Clean  '}).note,'Clean');
  assert.throws(()=>s.release('dad-staging',{by:A}),e=>e.code==='not_held'&&e.status===404);
  s.hold('tpv-deploy',{reason:'x',holder:T});s.release('tpv-deploy',{by:T});
  assert.deepEqual(s.state.recent.map(r=>r.event),['released','released']);assert.equal(s.state.recent[1].note,'Clean');
  s.hold('pocket-main',{reason:'x',holder:A});s.ownerRelease('pocket-main');
  assert.equal(s.state.recent[0].event,'owner');
  assert.throws(()=>s.ownerRelease('pocket-main'),code('not_held'));
});

test('waiting: free answers at once, the holder cannot wait, and a terminal must block',t=>{
  const {s}=store(t);
  assert.deepEqual(s.wait('dad-staging',{waiter:B}),{free:true,name:'dad-staging'});
  s.hold('dad-staging',{reason:'x',holder:A});
  assert.throws(()=>s.wait('dad-staging',{waiter:A}),code('own_hold'));
  assert.throws(()=>s.wait('dad-staging',{waiter:T}),code('needs_block'));
  const first=s.wait('dad-staging',{waiter:B,run:{approvalMode:'full'}});
  assert.equal(first.free,false);assert.equal(first.position,1);assert.equal(first.hold.reason,'x');
  assert.equal(s.wait('dad-staging',{waiter:B}).id,first.id,'asking again keeps one place');
  assert.equal(s.wait('dad-staging',{waiter:C}).position,2);
  assert.equal(s.snapshot().holds[0].waiters.length,2);assert.equal(s.snapshot().holds[0].waiters[0].run,undefined);
  assert.equal(s.cancelWait('dad-staging',{id:first.id}),true);assert.equal(s.cancelWait('dad-staging',{id:first.id}),false);
});

test('release wakes the first in line once, with what it captured; the next gets it only after the grace',t=>{
  const {s,clock}=store(t);
  s.hold('dad-staging',{reason:'x',holder:A});
  s.wait('dad-staging',{waiter:B,run:{approvalMode:'full',model:'m'}});s.wait('dad-staging',{waiter:C});
  const {next}=s.release('dad-staging',{by:A});
  assert.equal(next.session,'b');assert.deepEqual(next.run,{approvalMode:'full',model:'m'});
  assert.deepEqual(s.sweep(),[],'inside the grace nobody else is woken');
  clock.t+=LIMITS.offerMs;
  assert.deepEqual(s.sweep().map(w=>w.session),['c'],'b had its turn and is not woken twice');
  clock.t+=LIMITS.offerMs;
  assert.deepEqual(s.sweep(),[]);assert.deepEqual(s.state.offers,{});
});

test('claiming ends the offer, and the woken one leaves the line for good',t=>{
  const {s,clock}=store(t);
  s.hold('dad-staging',{reason:'x',holder:A});
  s.wait('dad-staging',{waiter:B});s.wait('dad-staging',{waiter:C});
  s.release('dad-staging',{by:A});
  s.hold('dad-staging',{reason:'y',holder:B});
  assert.deepEqual(s.state.offers,{});
  clock.t+=LIMITS.offerMs*2;
  assert.deepEqual(s.sweep({running:new Set(['b'])}),[],'still held, so nobody is woken');
  assert.deepEqual(s.state.waits['dad-staging'].map(w=>w.session),['c']);
});

test('one that cannot be told passes to the next',t=>{
  const {s}=store(t);
  s.hold('dad-staging',{reason:'x',holder:A});
  s.wait('dad-staging',{waiter:B});s.wait('dad-staging',{waiter:C});
  s.release('dad-staging',{by:A});
  assert.equal(s.wakeNext('dad-staging').session,'c');assert.equal(s.wakeNext('dad-staging'),null);
});

test('blocking: first in line finds it free, an unseen one is dropped, and an offer is respected',t=>{
  const {s,clock}=store(t);
  s.hold('dad-staging',{reason:'x',holder:A});
  const w=s.wait('dad-staging',{waiter:T,block:true});
  const behind=s.wait('dad-staging',{waiter:T,block:true});
  assert.equal(behind.position,2);
  assert.equal(s.release('dad-staging',{by:A}).next,null,'a shell is not woken, it asks');
  assert.equal(s.wait('dad-staging',{waiter:T,block:true,id:behind.id}).free,false,'second in line waits');
  assert.equal(s.wait('dad-staging',{waiter:T,block:true,id:w.id}).free,true);
  assert.equal(s.wait('dad-staging',{waiter:T,block:true,id:behind.id}).free,false,'the first has a while to claim it');
  clock.t+=LIMITS.offerMs;
  assert.equal(s.wait('dad-staging',{waiter:T,block:true,id:behind.id}).free,true,'the grace is over and nobody is ahead');
  const again=s.wait('pocket-main',{waiter:T,block:true});
  assert.equal(again.free,true);
  s.hold('pocket-main',{reason:'x',holder:A});
  s.wait('pocket-main',{waiter:T,block:true});s.wait('pocket-main',{waiter:B});
  clock.t+=LIMITS.blockStaleMs+1;
  assert.equal(s.release('pocket-main',{by:A}).next.session,'b','the shell stopped asking, so the conversation behind it is first');
});

test('sweep: a running conversation keeps its hold, an idle one expires and is told once',t=>{
  const {s,clock,file}=store(t);
  s.hold('dad-staging',{reason:'x',ttl:'10m',holder:A});s.hold('tpv-deploy',{reason:'y',ttl:'10m',holder:B});s.hold('pocket-main',{reason:'z',ttl:'10m',holder:T});
  s.wait('tpv-deploy',{waiter:C});
  clock.t+=30_000;
  const before=fs.statSync(file).mtimeMs;let writes=0;const write=s.write;s.write=(...a)=>{writes++;write(...a);};
  s.sweep({running:new Set(['a'])});
  assert.equal(writes,0,'a renewal under a minute is not worth a write');assert.ok(before);
  clock.t+=10*min;
  const woken=s.sweep({running:new Set(['a'])});
  assert.deepEqual(woken.map(w=>w.session),['c']);
  assert.deepEqual(s.state.holds.map(h=>h.name),['dad-staging']);
  assert.equal(s.state.holds[0].expiresAt,clock.t+10*min);
  assert.deepEqual(s.state.recent.map(r=>[r.name,r.event]).sort(),[['pocket-main','expired'],['tpv-deploy','expired']]);
  assert.match(s.takeNotices('b')[0],/hold on tpv-deploy expired/);
  assert.deepEqual(s.takeNotices('b'),[],'told once');
  s.ownerRelease('dad-staging');
  assert.match(new CoordStore(file).takeNotices('a')[0],/owner released your hold on dad-staging/,'survives a restart');
});

test('recent is capped by count and age',t=>{
  const {s,clock}=store(t);
  for(let i=0;i<LIMITS.recent+5;i++){s.hold('dad-staging',{reason:'r'+i,holder:A});s.release('dad-staging',{by:A});}
  assert.equal(s.state.recent.length,LIMITS.recent);assert.equal(s.state.recent[0].reason,'r'+(LIMITS.recent+4));
  clock.t+=LIMITS.recentMs+1;
  s.hold('dad-staging',{reason:'last',holder:A});s.release('dad-staging',{by:A});
  assert.deepEqual(s.state.recent.map(r=>r.reason),['last']);
});

test('a failed write changes nothing, and a restart keeps everything',t=>{
  const {s,file}=store(t);
  s.hold('dad-staging',{reason:'x',holder:A});s.wait('dad-staging',{waiter:B,run:{model:'m'}});
  const write=s.write;s.write=()=>{throw new Error('disk full');};
  assert.throws(()=>s.release('dad-staging',{by:A}),/disk full/);
  assert.equal(s.state.holds.length,1);assert.equal(s.state.waits['dad-staging'].length,1);
  s.write=write;
  const back=new CoordStore(file);
  assert.equal(back.state.holds[0].reason,'x');assert.equal(back.state.waits['dad-staging'][0].run.model,'m');
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  fs.writeFileSync(file,'not json');
  assert.deepEqual(new CoordStore(file).state.holds,[]);
});

test('the instructions name the command and the skill, quoted when the path has a space',()=>{
  const line=coordinationInstructions('/srv/my pocket/scripts/pocket-coord.mjs');
  assert.match(line,/node '\/srv\/my pocket\/scripts\/pocket-coord\.mjs' hold <name>/);
  assert.match(line,/\/srv\/my pocket\/skills\/pocket-coord\/SKILL\.md/);
  assert.match(line,/stops nothing/);
});

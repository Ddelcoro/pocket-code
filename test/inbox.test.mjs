// 1.69 Inbox Watch: the store's rules (inbox.mjs), the /api/inbox routes (cookie and loopback token, push and email on add,
// the act → feedback → ack loop, the heartbeat) and scripts/pocket-inbox.mjs. Push is off here (no VAPID keys), so the routes
// report push=null; the file mail transport records each email.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {InboxStore,LIMITS,KINDS,PRIORITIES,STATES,ACTIONS,WATCH,checkWatch,inboxInstructions} from '../inbox.mjs';
import {syncSkills} from '../skills.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pocket-inbox-'));
const DAY=86400000,GMAIL='https://mail.google.com/mail/u/0/#all/19a2b3c4d5e6f708';

test('InboxStore: the contract, normalizing input, limits and the instructions line',()=>{
  assert.deepEqual(LIMITS,{entries:500,text:2000,digestText:12000,title:160,story:120,source:60,items:40,itemText:1200,ref:40,keepDays:60,dismissedDays:30});
  assert.deepEqual(KINDS,['alert','digest','lookahead']);assert.deepEqual(PRIORITIES,['critical','high','normal','low']);
  assert.deepEqual(STATES,['new','opened','dismissed','resolved','not_useful']);assert.deepEqual(ACTIONS,['open','unread','dismiss','resolve','not_useful','restore']);
  const dir=tmp(),file=path.join(dir,'inbox.json');const clock=Date.parse('2026-10-19T12:00:00Z');
  const s=new InboxStore(file,{now:()=>clock});
  const e=s.add({title:'  Oakridge needs   dispatch\nattention ',text:'Jordan is on the way [Robin](msg:19a2b3) says it was last night.',story:'Oakridge service-call story',url:'/#/start/0123456789ab',gmail:GMAIL});
  assert.match(e.id,/^[0-9a-f]{12}$/);assert.equal(e.title,'Oakridge needs dispatch attention');assert.equal(e.text,'Jordan is on the way [Robin](msg:19a2b3) says it was last night.','citations are kept as-is');
  assert.deepEqual([e.kind,e.priority,e.source,e.state,e.new,e.by,e.revision],['alert','normal','inbox-monitor','new',true,'cli',1],'defaults');
  assert.deepEqual([e.at,e.seenAt,e.actedAt,e.ackedAt,e.note,e.doc,e.dedupe],['2026-10-19T12:00:00Z',null,null,null,'','','']);
  assert.equal(s.add({title:'x',url:'https://pocket.example.test/#/inbox'}).url,'https://pocket.example.test/#/inbox','an absolute web address is a link too');
  const d=s.add({title:'Morning digest',kind:'digest',priority:'low',doc:'abcdef012345',source:'nightly job'},{actor:'ui'});
  assert.deepEqual([d.kind,d.priority,d.doc,d.source,d.by],['digest','low','abcdef012345','nightly job','ui']);
  assert.throws(()=>s.add({text:'no title'}),e=>e.status===400&&e.code==='no_title');
  assert.throws(()=>s.add({title:'x',kind:'memo'}),e=>e.code==='bad_kind'&&/alert, digest, lookahead/.test(e.message));
  assert.throws(()=>s.add({title:'x',priority:'urgent'}),e=>e.code==='bad_priority');
  assert.throws(()=>s.add({title:'x',url:'javascript:alert(1)'}),e=>e.code==='bad_url');assert.throws(()=>s.add({title:'x',url:'//evil.example/x'}),e=>e.code==='bad_url','a protocol-relative link is refused');
  assert.throws(()=>s.add({title:'x',gmail:'https://evil.example/mail.google.com/'}),e=>e.code==='bad_gmail');
  assert.throws(()=>s.add({title:'x',doc:'ABCDEF012345'}),e=>e.code==='bad_doc');assert.throws(()=>s.add({title:'x',doc:'../etc'}),e=>e.code==='bad_doc');
  const long=s.add({title:'t'.repeat(400),text:'x'.repeat(5000),story:'s'.repeat(400),source:'q'.repeat(400)});
  assert.deepEqual([long.title.length,long.text.length,long.story.length,long.source.length],[LIMITS.title,LIMITS.text,LIMITS.story,LIMITS.source]);
  assert.equal(fs.statSync(file).mode&0o777,0o600,'written 0600');
  const again=new InboxStore(file,{now:()=>clock});assert.equal(again.entries.length,4);assert.deepEqual(again.get(e.id),s.get(e.id),'persisted as written');
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).version,1);
  // A hand-edited or older file comes back with every field.
  fs.writeFileSync(file,JSON.stringify({version:1,entries:[{id:'aaaaaaaaaaaa',title:'Old',at:'2026-10-18T10:00:00Z',kind:'memo',url:'javascript:x'},{id:'bbbbbbbbbbbb'},null],sources:{w:{lastReportAt:'nope'}}}));
  const old=new InboxStore(file,{now:()=>clock});assert.equal(old.entries.length,1);
  assert.deepEqual([old.entries[0].kind,old.entries[0].state,old.entries[0].url,old.entries[0].revision],['alert','new','',1]);assert.deepEqual(old.sources,{});
  const line=inboxInstructions('/srv/pocket/scripts/pocket-inbox.mjs','11111111-1111-4111-8111-111111111111');
  assert.match(line,/Inbox Watch/);assert.match(line,/node \/srv\/pocket\/scripts\/pocket-inbox\.mjs list/);assert.match(line,/act <id> resolve\|not_useful\|dismiss/);
  assert.match(line,/act only when the user asks/);assert.match(line,/\/srv\/pocket\/skills\/pocket-inbox\/SKILL\.md/);
  // The pocket-inbox skill is installed while Inbox Watch is on, named for this server's command, and removed when it is off.
  const roots=[path.join(dir,'claude')],commands={inbox:'/srv/pocket/scripts/pocket-inbox.mjs'};
  const r=syncSkills({settings:{inbox:true},commands,env:{},roots,codexRoots:[]});assert.ok(r.installed.includes(path.join(dir,'claude','pocket-inbox')));
  const skill=fs.readFileSync(path.join(dir,'claude','pocket-inbox','SKILL.md'),'utf8');
  assert.match(skill,/^---\nname: pocket-inbox\n/);assert.match(skill,/run `pocket-inbox` as `node \/srv\/pocket\/scripts\/pocket-inbox\.mjs`/);
  assert.match(skill,/\*\*Act only when the user asks\*\*/);assert.match(skill,/Settings → Projects, files, tasks & vault → Inbox Watch/);
  syncSkills({settings:{inbox:false},commands,env:{},roots,codexRoots:[]});assert.equal(fs.existsSync(path.join(dir,'claude','pocket-inbox')),false);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('InboxStore: dedupe within 24 hours, the state machine with restore, feedback and ack, filters, the heartbeat',()=>{
  const dir=tmp(),file=path.join(dir,'inbox.json');let clock=Date.parse('2026-10-19T08:00:00Z');
  const s=new InboxStore(file,{now:()=>clock});
  const a=s.add({title:'Oakridge alert',dedupe:'oakridge:t1',story:'Oakridge'});
  clock+=3600000;const dup=s.add({title:'Oakridge alert again',dedupe:'oakridge:t1'});
  assert.equal(dup.duplicate,true);assert.equal(dup.id,a.id);assert.equal(dup.title,'Oakridge alert','nothing changes');assert.equal(s.entries.length,1);
  clock+=DAY;const later=s.add({title:'Oakridge next day',dedupe:'oakridge:t1'});assert.notEqual(later.id,a.id,'after 24 hours the key is fresh');assert.equal(later.duplicate,undefined);
  clock+=1000;const b=s.add({title:'Lakeview look-ahead',kind:'lookahead'});clock+=1000;const c=s.add({title:'Vendor newsletter'});
  // open: new → opened, seenAt, no actedAt; a second open changes nothing.
  clock+=1000;let r=s.act({action:'open',id:a.id});
  assert.deepEqual([r.state,r.new,r.seenAt,r.actedAt,r.revision],['opened',false,'2026-10-20T09:00:03Z',null,2]);
  clock+=1000;assert.equal(s.act({action:'open',id:a.id}).revision,2,'open is idempotent');
  assert.deepEqual(s.feedback(),[],'opening is not feedback');
  // dismiss / resolve / not_useful record a decision; repeating it changes nothing.
  r=s.act({action:'dismiss',id:b.id},{actor:'ui'});assert.deepEqual([r.state,r.actedAt,r.ackedAt,r.revision,r.seenAt],['dismissed','2026-10-20T09:00:04Z',null,2,null]);
  assert.equal(s.act({action:'dismiss',id:b.id}).revision,2,'the same decision twice is one decision');
  clock+=1000;r=s.act({action:'not_useful',id:c.id,note:'n'.repeat(500)});assert.equal(r.state,'not_useful');assert.equal(r.note.length,300);
  clock+=1000;r=s.act({action:'resolve',id:a.id,note:'Jordan arrived'});assert.deepEqual([r.state,r.note,r.revision],['resolved','Jordan arrived',3]);
  assert.throws(()=>s.act({action:'explode',id:a.id}),e=>e.status===400&&e.code==='bad_action');assert.throws(()=>s.act({action:'open',id:'nope'}),e=>e.status===404);
  let fb=s.feedback();
  assert.deepEqual(fb.map(f=>[f.id,f.action]),[[a.id,'resolved'],[c.id,'not_useful'],[b.id,'dismissed']],'newest decision first');
  assert.deepEqual(fb[0],{id:a.id,action:'resolved',at:'2026-10-20T09:00:06Z',note:'Jordan arrived',title:'Oakridge alert',story:'Oakridge',source:'inbox-monitor',kind:'alert'});
  assert.deepEqual(s.feedback({since:'2026-10-20T09:00:05Z'}).map(f=>f.id),[a.id,c.id],'since filters by when it was decided');
  assert.throws(()=>s.feedback({since:'yesterday'}),e=>e.code==='bad_since');
  assert.equal(s.ack([a.id,c.id,'unknown',later.id]),2,'only pending decisions count');assert.equal(s.ack([a.id]),0,'once');
  assert.deepEqual(s.feedback().map(f=>f.id),[b.id]);assert.throws(()=>s.ack('x'),e=>e.code==='bad_ids');
  // restore: back to opened and reported as a restore, so a worker that resolved a story can un-resolve it.
  clock+=1000;r=s.act({action:'restore',id:a.id});
  assert.deepEqual([r.state,r.actedAt,r.ackedAt,r.lastAction,r.revision],['opened','2026-10-20T09:00:07Z',null,'restore',4]);
  assert.deepEqual(s.feedback()[0],{id:a.id,action:'restore',at:'2026-10-20T09:00:07Z',note:'Jordan arrived',title:'Oakridge alert',story:'Oakridge',source:'inbox-monitor',kind:'alert'});
  assert.equal(s.act({action:'restore',id:a.id}).revision,4,'restoring an open entry does nothing');assert.equal(s.act({action:'restore',id:later.id}).state,'new');
  s.ack([a.id]);assert.deepEqual(s.feedback().map(f=>f.id),[b.id]);
  clock+=1000;s.act({action:'resolve',id:a.id});assert.deepEqual(s.feedback().map(f=>[f.id,f.action])[0],[a.id,'resolved'],'a new decision after an ack is feedback again');
  // Filters: new = unread, all = everything but dismissed, dismissed alone; newest first; since by when it came in.
  let snap=s.snapshot();assert.deepEqual(snap.entries.map(e=>e.id),[later.id]);assert.equal(snap.newCount,1);assert.equal(snap.version,1);assert.equal(snap.now,clock);
  snap=s.snapshot({state:'all'});assert.deepEqual(snap.entries.map(e=>e.title),['Vendor newsletter','Oakridge next day','Oakridge alert']);
  assert.deepEqual(s.snapshot({state:'dismissed'}).entries.map(e=>e.id),[b.id]);
  assert.deepEqual(s.snapshot({state:'all',since:'2026-10-20T09:00:00Z'}).entries.map(e=>e.id),[c.id,later.id]);
  assert.throws(()=>s.snapshot({state:'everything'}),e=>e.status===400&&e.code==='bad_state');
  // The heartbeat: per source, never moves back, never ahead of now.
  assert.equal(snap.lastReportAt,null);
  s.seen('inbox-monitor');s.seen('inbox-monitor','2026-10-01T00:00:00Z');s.seen('',clock+DAY);
  snap=s.snapshot();assert.deepEqual(snap.sources,{'inbox-monitor':{lastReportAt:new Date(clock).toISOString().replace(/\.\d{3}Z$/,'Z')}});assert.equal(snap.lastReportAt,snap.sources['inbox-monitor'].lastReportAt);
  clock+=60000;s.seen('nightly');assert.equal(s.snapshot().lastReportAt,s.sources.nightly.lastReportAt,'the latest source wins');
  assert.throws(()=>s.seen('x','not a date'),e=>e.code==='bad_at');
  assert.deepEqual(new InboxStore(file,{now:()=>clock}).sources,s.sources,'persisted');
  fs.rmSync(dir,{recursive:true,force:true});
});

// 1.77: marking unread, and the conversations started from an entry's start link.
test('InboxStore: unread takes an open back, and a session started from a start link is remembered on its entries',()=>{
  const dir=tmp(),file=path.join(dir,'inbox.json');let clock=Date.parse('2026-10-22T16:00:00Z');
  const s=new InboxStore(file,{now:()=>clock});
  const a=s.add({title:'PHP2 advisory',url:'/#/start/0123456789ab'}),b=s.add({title:'Churches images',url:'https://pocket.example/#/start/0123456789ab'});
  const c=s.add({title:'Digest',doc:'4897fe3220c8'}),d=s.add({title:'Other link',url:'/#/start/0123456789ac'});
  // unread: opened → new, seenAt kept; idempotent; a finished entry stays finished.
  s.act({action:'open',id:c.id});clock+=1000;let r=s.act({action:'unread',id:c.id});
  assert.deepEqual([r.state,r.new,r.revision,Boolean(r.seenAt)],['new',true,3,true]);
  assert.equal(s.act({action:'unread',id:c.id}).revision,3,'unread twice is once');
  assert.equal(s.act({action:'unread',id:d.id}).revision,1,'an unread entry stays as it is');
  s.act({action:'resolve',id:d.id});assert.equal(s.act({action:'unread',id:d.id}).state,'resolved','restore it first');
  assert.deepEqual(s.feedback().map(f=>f.id),[d.id],'unread is not feedback');
  // linkStart: every entry whose link ends in that start id, path or full address; it is read once started from.
  clock+=1000;let linked=s.linkStart('0123456789ab','5f0c1f8e-2d3b-4c5a-9e7f-0a1b2c3d4e5f');
  assert.deepEqual(linked.map(e=>e.id).sort(),[a.id,b.id].sort());
  assert.deepEqual(linked.map(e=>e.state),['opened','opened']);
  assert.deepEqual(s.get(a.id).sessions,[{id:'5f0c1f8e-2d3b-4c5a-9e7f-0a1b2c3d4e5f',at:'2026-10-22T16:00:02Z'}]);
  assert.deepEqual(s.get(c.id).sessions,[],'an entry without that link is untouched');
  assert.deepEqual(s.linkStart('0123456789ab','5f0c1f8e-2d3b-4c5a-9e7f-0a1b2c3d4e5f'),[],'the same session twice is once');
  for(const [start,sess] of [['nope','5f0c1f8e-2d3b-4c5a-9e7f-0a1b2c3d4e5f'],['0123456789ab','../etc'],['0123456789ab',''],['ffffffffffff','5f0c1f8e-2d3b-4c5a-9e7f-0a1b2c3d4e5f']])assert.deepEqual(s.linkStart(start,sess),[]);
  // At most five, newest last; Codex ids keep their prefix; it survives a reload and a hand-edited file.
  for(let i=0;i<6;i++){clock+=1000;s.linkStart('0123456789ab','cx:019a2b3c-4d5e-6f70-8192-a3b4c5d6e7f'+i);}
  assert.equal(s.get(a.id).sessions.length,5);assert.equal(s.get(a.id).sessions.at(-1).id,'cx:019a2b3c-4d5e-6f70-8192-a3b4c5d6e7f5');
  const raw=JSON.parse(fs.readFileSync(file,'utf8'));raw.entries.find(e=>e.id===b.id).sessions=[{id:'bad id!',at:'2026-10-22T16:00:00Z'},{id:'5f0c1f8e-2d3b-4c5a-9e7f-0a1b2c3d4e5f'},'x',{id:'cx:abcdef12-0000',at:'2026-10-22T16:00:00Z'}];
  raw.entries.find(e=>e.id===c.id).sessions=undefined;fs.writeFileSync(file,JSON.stringify(raw));
  const back=new InboxStore(file,{now:()=>clock});
  assert.deepEqual(back.get(b.id).sessions,[{id:'cx:abcdef12-0000',at:'2026-10-22T16:00:00Z'}],'only well-formed links come back');
  assert.deepEqual(back.get(c.id).sessions,[],'an older file reads as none');assert.equal(back.get(a.id).sessions.length,5);
  fs.rmSync(dir,{recursive:true,force:true});
});

// 1.70: the owner's Inbox Watch settings and the watcher's profile, kept per source.
const PROFILE={version:1,timezone:'America/New_York',defaults:{paused:false,every:5,periods:[],quietHours:[22,8],digestHour:8,lookahead:{morning:8,evening:17},models:{decisions:{model:'sonnet',reasoning:'medium'},lookahead:{model:'opus',reasoning:'medium'}}},
  options:{every:[0,5,10,15,30],models:[{id:'sonnet',label:'Sonnet 5.5'},{id:'opus',label:'Opus 5.5'}],reasoning:[{id:'default',label:'Model default'},{id:'medium',label:'Medium'}]},
  applied:{from:'config',revision:null},status:{paused:false,every:5,period:'',lastCheckAt:'2026-10-20T12:00:00+00:00',nextCheckAt:'2026-10-20T12:05:00+00:00'},
  usage:{billing:'plan',costBasis:'list',since:'2026-10-20T11:00:00+00:00',days:[{date:'2026-10-20',checks:30,threads:40,calls:12,failed:0,inputTokens:500000,cacheWriteTokens:0,cacheReadTokens:0,outputTokens:9000,costUsd:1.25,decisions:{calls:12,costUsd:1.25},lookahead:{calls:0,costUsd:null}}]}};
test('InboxStore: Inbox Watch settings, the watcher\'s profile, revisions and paused',()=>{
  assert.equal(checkWatch(null),null);
  const ok=checkWatch({paused:false,every:10,periods:[{name:' Overnight ',days:[6,0,0],from:'22:00',to:'07:00',every:30}],quietHours:[22,8],digestHour:8,lookahead:{morning:8,evening:null},models:{decisions:{model:'sonnet',reasoning:'low'}}});
  assert.deepEqual(ok.periods,[{name:'Overnight',days:[0,6],from:'22:00',to:'07:00',every:30}],'days deduplicated and sorted');
  assert.deepEqual(checkWatch({firstPass:{enabled:true,provider:'both',threshold:0.876}}).firstPass,{enabled:true,provider:'both',threshold:0.88});
  assert.deepEqual(checkWatch({tidy:{enabled:true,every:4}}).tidy,{enabled:true,every:4});
  assert.deepEqual(checkWatch({gmailLabel:{enabled:false}}).gmailLabel,{enabled:false},'1.75: the Pocket Inbox label in Gmail');
  assert.deepEqual(checkWatch({scope:{mode:'inbox_labels',labels:[' Clients ','Clients','Ultra/Ask first','']}}).scope,{mode:'inbox_labels',labels:['Clients','Ultra/Ask first']},'1.95: what the watcher reads; labels trimmed and deduplicated');
  assert.deepEqual(checkWatch({scope:{mode:'inbox'}}).scope,{mode:'inbox',labels:[]});assert.deepEqual(checkWatch({scope:{}}).scope,{mode:'all',labels:[]});
  assert.equal(checkWatch({rules:'- Never tell me about cameras.\r\n- Tell me about every sale.'}).rules,'- Never tell me about cameras.\n- Tell me about every sale.');assert.equal(ok.lookahead.evening,null);
  for(const [bad,re] of [[{every:-1},/every is whole minutes/],[{every:500},/to 240/],[{periods:[{days:[],from:'01:00',to:'02:00',every:5}]},/Period 1 needs at least one day/],
    [{periods:[{days:[1],from:'1am',to:'02:00',every:5}]},/start and an end time/],[{periods:Array(WATCH.periods+1).fill({days:[1],from:'01:00',to:'02:00',every:5})},/at most 12/],
    [{quietHours:[22]},/quietHours/],[{digestHour:24},/digestHour/],[{lookahead:{morning:'8'}},/morning look-ahead/],[{models:{decisions:{model:'sonnet',reasoning:'huge'}}},/Reasoning is one of/],
    [{paused:'yes'},/paused is true or false/],[{scope:{mode:'archive'}},/scope.mode is one of all, inbox, inbox_labels/],[{scope:{mode:'inbox_labels',labels:'Clients'}},/scope.labels is a list/],[{scope:{mode:'inbox_labels',labels:Array.from({length:21},(_,i)=>'L'+i)}},/at most 20 labels/],[{scope:'inbox'},/scope is \{mode, labels\}/],[{firstPass:{provider:'grok'}},/first pass is one of jev, openai, both/],[{firstPass:{threshold:0.3}},/between 0.5 and 0.99/],[{firstPass:{enabled:1}},/firstPass.enabled/],[{tidy:{every:3}},/Tidy runs every 1, 2, 4, 8, 12, 24 hours/],[{rules:5},/rules is text/],[{rules:'x'.repeat(8001)},/over 8,000 characters/],[{tidy:{enabled:'on'}},/tidy.enabled/],[{gmailLabel:{enabled:'yes'}},/gmailLabel is/],[{gmailLabel:true},/gmailLabel is/],['x',/settings must be an object/]])
    assert.throws(()=>checkWatch(bad),e=>e.status===400&&e.code==='bad_watch'&&re.test(e.message),JSON.stringify(bad));
  assert.throws(()=>checkWatch({models:{decisions:{model:'gpt-9'}}},PROFILE),/Choose one of the models/,'only what the watcher offers');
  const dir=tmp(),file=path.join(dir,'inbox.json');let clock=Date.parse('2026-10-20T12:00:00Z');
  const s=new InboxStore(file,{now:()=>clock});
  assert.deepEqual(s.watchView(),{source:'inbox-monitor',settings:null,revision:0,updatedAt:null,by:null,profile:null,profileAt:null,lastReportAt:null,checkRequestedAt:null});
  s.seen('inbox-monitor',undefined,PROFILE);assert.deepEqual(s.watchView().profile,PROFILE);assert.equal(s.paused(),false);
  assert.deepEqual(s.snapshot().sources,{'inbox-monitor':{lastReportAt:'2026-10-20T12:00:00Z'}},'the list stays lean: no profile in it');
  assert.throws(()=>s.seen('inbox-monitor',undefined,{big:'x'.repeat(WATCH.profileBytes)}),e=>e.code==='bad_profile');
  let v=s.setWatch('inbox-monitor',{every:15,paused:true});assert.deepEqual([v.revision,v.by,v.settings],[1,'ui',{every:15,paused:true}]);assert.equal(s.paused(),true,'paused as the owner set it');
  assert.equal(s.snapshot().paused,true);
  v=s.setWatch('inbox-monitor',{models:{decisions:{model:'opus',reasoning:'default'}}},{actor:'cli'});assert.deepEqual([v.revision,v.by],[2,'cli']);
  assert.throws(()=>s.setWatch('inbox-monitor',{models:{decisions:{model:'haiku'}}}),/Choose one of the models/);
  clock+=60000;s.seen('other-watcher',undefined,{...PROFILE,status:{paused:true}});assert.equal(s.watchSource(),'other-watcher','the latest profile is the one Settings shows');
  v=s.setWatch('inbox-monitor',null);assert.deepEqual([v.revision,v.settings],[3,null],'null goes back to the config file');
  // 1.75: Check now. One request until the watcher reports it done (or ten minutes pass); then a press is a new one.
  v=s.requestCheck('inbox-monitor');const first=v.checkRequestedAt;assert.equal(first,'2026-10-20T12:01:00Z');
  clock+=5000;assert.equal(s.requestCheck('inbox-monitor').checkRequestedAt,first,'a second press while it is on its way changes nothing');
  s.seen('inbox-monitor',undefined,{...PROFILE,status:{checkRequestDone:first}});
  assert.equal(s.requestCheck('inbox-monitor').checkRequestedAt,'2026-10-20T12:01:05Z','done: a new request');
  clock+=11*60000;assert.equal(s.requestCheck('inbox-monitor').checkRequestedAt,'2026-10-20T12:12:05Z','never taken up in ten minutes: a new request');
  assert.equal(s.watchView('inbox-monitor').checkRequestedAt,'2026-10-20T12:12:05Z');
  const again=new InboxStore(file,{now:()=>clock});assert.deepEqual(again.watchView('inbox-monitor'),s.watchView('inbox-monitor'),'persisted');assert.deepEqual(again.watchView('other-watcher').profile.status,{paused:true});
  fs.rmSync(dir,{recursive:true,force:true});
});

test('InboxStore: pruning after 60 days (dismissed after 30) and the 500-entry cap drop the oldest seen entries first',()=>{
  const dir=tmp(),file=path.join(dir,'inbox.json');let clock=Date.parse('2026-08-01T12:00:00Z');
  const s=new InboxStore(file,{now:()=>clock});
  const old=s.add({title:'Old new'}),seen=s.add({title:'Old opened'});s.act({action:'open',id:seen.id});
  clock=Date.parse('2026-09-01T12:00:00Z');const dis=s.add({title:'Dismissed early'});s.act({action:'dismiss',id:dis.id});
  const dis2=s.add({title:'Dismissed later'});
  clock=Date.parse('2026-09-20T12:00:00Z');s.act({action:'dismiss',id:dis2.id});
  clock=Date.parse('2026-10-01T13:00:00Z');assert.equal(s.prune(),3,'over 60 days old, and dismissed over 30 days ago');
  assert.deepEqual(s.entries.map(e=>e.title),['Dismissed later']);void old;
  clock=Date.parse('2026-10-21T13:00:00Z');s.snapshot();assert.equal(s.entries.length,0,'the snapshot prunes too');
  // The cap: 500 entries; one more drops the oldest seen entry, never an unread one while a seen one is left.
  const seed=[];const t0=Date.parse('2026-10-10T00:00:00Z');
  for(let i=0;i<LIMITS.entries;i++)seed.push({id:i.toString(16).padStart(12,'0'),kind:'alert',priority:'normal',title:'E'+i,text:'',story:'',source:'inbox-monitor',url:'',gmail:'',doc:'',dedupe:'',state:i%2?'opened':'new',at:new Date(t0+i*60000).toISOString(),seenAt:null,actedAt:null,ackedAt:null,note:'',by:'cli',revision:1});
  fs.writeFileSync(file,JSON.stringify({version:1,entries:seed,sources:{}}));
  clock=Date.parse('2026-10-19T00:00:00Z');const big=new InboxStore(file,{now:()=>clock});
  big.add({title:'One more'});assert.equal(big.entries.length,LIMITS.entries);
  assert.equal(big.entries.find(e=>e.title==='E1'),undefined,'the oldest opened entry went');assert.ok(big.entries.find(e=>e.title==='E0'),'the older unread one stayed');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('HTTP: Inbox is off until Settings turns it on; token and cookie, tunnel refused; add pushes and mails; act → feedback → ack; seen; filters; and the CLI',async t=>{
  const dir=tmp();let port=19691;
  const secret=randomUUID(),exp=Date.now()+3600000;
  const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  const mailFile=path.join(dir,'mail.jsonl');
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  fs.writeFileSync(path.join(dir,'data','pocket-settings.json'),JSON.stringify({notifyEmail:'owner@example.test'}));
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_PUBLIC_URL:'https://pocket.example.test',POCKET_TZ:'America/New_York',POCKET_SMTP_URL:'file:'+mailFile,POCKET_SMTP_FROM:'pocket@example.test'},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=43;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  const stop=async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}};
  t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  const call=async(p,body,h=headers)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({})),cache:r.headers.get('cache-control')};};
  const mails=()=>fs.existsSync(mailFile)?fs.readFileSync(mailFile,'utf8').trim().split('\n').map(JSON.parse):[];
  await start();
  const tokenOf=()=>fs.readFileSync(path.join(dir,'data','cli-token'),'utf8').trim();
  let bearer={'content-type':'application/json',authorization:'Bearer '+tokenOf()};
  // Off by default, for the owner and the token alike; never reachable signed out.
  let r=await call('/inbox');assert.equal(r.status,404);assert.equal(r.body.code,'inbox_off');assert.match(r.body.error,/Settings → Projects, files, tasks & vault/);
  assert.equal((await call('/inbox',{title:'x'},bearer)).body.code,'inbox_off');assert.equal((await call('/inbox/feedback',null,bearer)).status,404);
  assert.equal((await call('/inbox',null,{})).status,401);
  assert.equal((await call('/me')).body.features.inbox,false);
  r=await call('/settings',{inbox:true});assert.equal(r.status,200);assert.equal(r.body.inbox,true);assert.equal((await call('/me')).body.features.inbox,true);
  assert.match(logs,/settings updated: .* inbox=true/);
  r=await call('/inbox');assert.equal(r.status,200);assert.equal(r.cache,'private, no-store');
  assert.deepEqual(r.body.entries,[]);assert.equal(r.body.newCount,0);assert.equal(r.body.lastReportAt,null);assert.deepEqual(r.body.push,{enabled:false});assert.equal(r.body.email,true);
  assert.equal((await call('/inbox',null,bearer)).status,200,'the loopback token reads the list');
  assert.equal((await call('/inbox',null,{...bearer,'cf-connecting-ip':'203.0.113.5'})).status,401,'a request through the tunnel cannot use the token');
  assert.equal((await call('/inbox',null,{...bearer,'x-forwarded-for':'203.0.113.5'})).status,401,'nor one through a proxy');
  assert.equal((await call('/sessions',null,bearer)).status,401,'the token opens nothing else');
  // Add from the worker: the entry, no push (no VAPID keys), the email through the file transport, the heartbeat.
  const add=await call('/inbox',{title:'Oakridge needs dispatch attention before 9 a.m.',text:'Jordan is on the way for 9–10 [per Robin](msg:19a2b3c4). She says the call was last night. Check the board.',story:'Oakridge service-call story',priority:'high',url:'/#/start/0123456789ab',gmail:GMAIL,dedupe:'oakridge:t1',email:true},bearer);
  assert.equal(add.status,200,JSON.stringify(add.body));assert.equal(add.body.ok,true);assert.equal(add.body.push,null);assert.equal(add.body.mail,true);assert.equal(add.body.duplicate,false);
  const e=add.body.entry;assert.deepEqual([e.by,e.state,e.new,e.priority,e.kind,e.url],['cli','new',true,'high','alert','/#/start/0123456789ab']);
  const m=mails().at(-1);assert.equal(m.to,'owner@example.test');assert.equal(m.subject,'[Pocket Code] Oakridge needs dispatch attention before 9 a.m.');
  assert.match(m.text,/^Jordan is on the way for 9–10 per Robin\. She says/,'citations become their labels in mail');assert.match(m.text,/\n\nhttps:\/\/pocket\.example\.test\/#\/start\/0123456789ab/);assert.match(m.text,/Gmail: https:\/\/mail\.google\.com\//);
  assert.match(m.html,/Open in Pocket Code/);assert.match(m.html,/Open in Gmail/);
  assert.match(logs,new RegExp(`inbox add kind=alert id=${e.id} by=cli push=off mail=true`));
  r=await call('/inbox');assert.deepEqual(r.body.entries.map(x=>x.id),[e.id]);assert.equal(r.body.newCount,1);assert.ok(r.body.lastReportAt,'adding records the heartbeat');assert.ok(r.body.sources['inbox-monitor']);
  // A duplicate changes nothing and sends nothing; push:false sends no push; mail only when asked.
  const before=mails().length;
  const dup=await call('/inbox',{title:'Oakridge again',dedupe:'oakridge:t1',email:true},bearer);assert.equal(dup.body.duplicate,true);assert.equal(dup.body.entry.id,e.id);assert.equal(dup.body.mail,false);assert.equal(dup.body.push,null);
  assert.equal(mails().length,before,'no mail for a duplicate');assert.match(logs,/ duplicate/);
  const quiet=await call('/inbox',{title:'Morning look-ahead',kind:'lookahead',text:'Three visits today.',doc:'abcdef012345',push:false});
  assert.equal(quiet.status,200);assert.equal(quiet.body.entry.by,'ui','the owner can add too');assert.equal(quiet.body.mail,false);assert.equal(quiet.body.push,null);assert.equal(mails().length,before);
  assert.equal((await call('/inbox',{text:'no title'},bearer)).body.code,'no_title');
  assert.equal((await call('/inbox',{title:'x',gmail:'https://evil.example/'},bearer)).body.code,'bad_gmail');
  assert.equal((await call('/inbox',{title:'x',kind:'memo'},bearer)).status,400);
  // act → feedback → ack, through the owner's cookie and the worker's token.
  r=await call('/inbox/act',{action:'open',id:e.id});assert.equal(r.status,200);assert.equal(r.body.entry.state,'opened');assert.ok(r.body.entry.seenAt);
  r=await call('/inbox/act',{action:'not_useful',id:e.id,note:'Dispatch already knew'});assert.equal(r.body.entry.state,'not_useful');
  assert.equal((await call('/inbox/act',{action:'dismiss',id:'000000000000'})).status,404);
  r=await call('/inbox/act',{action:'explode',id:e.id});assert.equal(r.status,400);assert.equal(r.body.code,'bad_action');
  r=await call('/inbox/feedback',null,bearer);assert.equal(r.status,200);assert.equal(r.body.ok,true);
  assert.deepEqual(r.body.feedback.map(f=>[f.id,f.action,f.note,f.story]),[[e.id,'not_useful','Dispatch already knew','Oakridge service-call story']]);
  assert.deepEqual((await call('/inbox/feedback?since=2999-01-01T00:00:00Z',null,bearer)).body.feedback,[]);
  assert.equal((await call('/inbox/feedback?since=soon',null,bearer)).status,400);
  r=await call('/inbox/ack',{ids:[e.id]},bearer);assert.deepEqual(r.body,{ok:true,acked:1});
  assert.deepEqual((await call('/inbox/feedback',null,bearer)).body.feedback,[]);
  assert.equal((await call('/inbox/ack',{ids:'x'},bearer)).status,400);
  // seen: the heartbeat on its own.
  assert.deepEqual((await call('/inbox/seen',{source:'nightly-digest'},bearer)).body,{ok:true});
  assert.ok((await call('/inbox')).body.sources['nightly-digest']);assert.equal((await call('/inbox/seen',{at:'later'},bearer)).status,400);
  // Filters.
  await call('/inbox/act',{action:'dismiss',id:quiet.body.entry.id});
  assert.deepEqual((await call('/inbox')).body.entries,[],'nothing new');
  assert.deepEqual((await call('/inbox?state=all')).body.entries.map(x=>x.id),[e.id]);
  assert.deepEqual((await call('/inbox?state=dismissed')).body.entries.map(x=>x.id),[quiet.body.entry.id]);
  assert.deepEqual((await call('/inbox?state=all&since=2999-01-01T00:00:00Z')).body.entries,[]);
  assert.equal((await call('/inbox?state=bogus')).body.code,'bad_state');
  // 1.69: alerts is a push kind a device can turn off.
  r=await call('/push/subscribe',{subscription:{endpoint:'https://push.example.test/a',keys:{p256dh:'k',auth:'a'}},prefs:{kinds:{alerts:false}}});
  assert.deepEqual(r.body.prefs.kinds,{turns:true,reminders:true,vault:true,alerts:false});
  // The CLI.
  const cli=(args,input,extra={})=>new Promise(res=>{const c=execFile(process.execPath,[path.join(repo,'scripts/pocket-inbox.mjs'),...args],{cwd:dir,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_DATA_DIR:path.join(dir,'data'),...extra}},(err,stdout,stderr)=>res({code:err?err.code:0,stdout,stderr}));if(input!==undefined)c.stdin.end(input);});
  let out=await cli(['add','--title','Lakeview invoice question','--file','-','--story','Lakeview billing','--priority','critical','--gmail',GMAIL],'Their AP asks for the W-9 [AP](msg:abc).\n');
  assert.equal(out.code,0,out.stderr);const m2=/^([0-9a-f]{12}) push=off mail=no$/.exec(out.stdout.trim());assert.ok(m2,out.stdout);const cid=m2[1];
  out=await cli(['list','--json']);assert.equal(out.code,0,out.stderr);const rows=JSON.parse(out.stdout);assert.deepEqual(rows.map(x=>x.id),[cid]);assert.equal(rows[0].text,'Their AP asks for the W-9 [AP](msg:abc).');
  out=await cli(['list']);assert.match(out.stdout,new RegExp(`^\\* .*Lakeview invoice question  \\(${cid}\\)  alert · critical$`,'m'));
  out=await cli(['list','--state','all']);assert.match(out.stdout,/Oakridge needs dispatch .* · not useful/);
  out=await cli(['show',cid]);assert.match(out.stdout,/Story: Lakeview billing/);assert.match(out.stdout,/Their AP asks for the W-9 AP\./);assert.match(out.stdout,/Gmail: https:\/\/mail\.google\.com/);
  out=await cli(['act',cid,'resolve','--note','Sent the W-9']);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/resolved/);assert.match(out.stdout,/Note: Sent the W-9/);
  out=await cli(['show',quiet.body.entry.id,'--json']);assert.equal(JSON.parse(out.stdout).state,'dismissed','show finds a dismissed entry too');
  out=await cli(['feedback','--json']);assert.deepEqual(JSON.parse(out.stdout).map(f=>[f.id,f.action]).sort(),[[cid,'resolved'],[quiet.body.entry.id,'dismissed']].sort(),'both decisions (they can share a second, so in either order)');
  out=await cli(['feedback']);assert.match(out.stdout,/resolved  Lakeview invoice question .*note: Sent the W-9/);
  out=await cli(['ack',cid,quiet.body.entry.id]);assert.equal(out.stdout.trim(),'acked 2');
  out=await cli(['feedback']);assert.equal(out.stdout.trim(),'No new feedback.');
  out=await cli(['help']);assert.match(out.stdout,/act <id> <open\|unread\|dismiss\|resolve\|not_useful\|restore>/,'1.81: the help lists act … unread, which the server accepts');
  out=await cli(['seen','--source','cli-test']);assert.equal(out.stdout.trim(),'ok');assert.ok((await call('/inbox')).body.sources['cli-test']);
  // 1.70: Inbox Watch settings. The watcher's heartbeat brings its profile; the owner (or an agent when asked) sets; the watcher reads.
  out=await cli(['watch']);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/has not reported its settings yet/);
  out=await cli(['seen','--source','inbox-monitor','--profile','-'],JSON.stringify(PROFILE));assert.equal(out.code,0,out.stderr);
  r=await call('/inbox/watch');assert.equal(r.status,200);assert.equal(r.cache,'private, no-store');assert.deepEqual([r.body.source,r.body.settings,r.body.revision],['inbox-monitor',null,0]);assert.deepEqual(r.body.profile,PROFILE);
  assert.equal((await call('/inbox/watch',null,{...bearer,'cf-connecting-ip':'203.0.113.5'})).status,401,'the token stays on loopback here too');
  r=await call('/inbox/watch',{settings:{every:7.5}});assert.equal(r.status,400);assert.equal(r.body.code,'bad_watch');
  r=await call('/inbox/watch',{settings:{...PROFILE.defaults,every:10,periods:[{name:'Overnight',days:[0,1,2,3,4,5,6],from:'22:00',to:'07:00',every:30}]}});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.revision,1);assert.equal(r.body.by,'ui');assert.match(logs,/inbox watch settings source=inbox-monitor revision=1 by=ui/);
  out=await cli(['watch','--json']);const wj=JSON.parse(out.stdout);assert.deepEqual([wj.revision,wj.settings.every,wj.settings.periods[0].every],[1,10,30]);
  out=await cli(['watch']);assert.match(out.stdout,/your settings \(revision 1\)/);assert.match(out.stdout,/Overnight: days 0,1,2,3,4,5,6 22:00–07:00, every 30 min/);assert.match(out.stdout,/Decisions: sonnet \(medium\)/);assert.match(out.stdout,/2026-10-20  30 checks  12 calls  509,000 tokens  \$1\.25/);
  out=await cli(['watch','set','--every','15']);assert.equal(out.code,0,out.stderr);assert.equal(out.stdout.trim(),'revision 2: saved');
  out=await cli(['watch','set','--pause']);assert.equal((await call('/inbox/watch')).body.settings.paused,true);assert.equal((await call('/inbox')).body.paused,true,'a paused watcher is not called silent');
  assert.deepEqual([(await call('/inbox/watch')).body.settings.every,(await call('/inbox/watch')).body.settings.periods.length],[15,1],'set changes one thing');
  out=await cli(['watch','set']);assert.equal(out.code,1);assert.match(out.stderr,/needs --file/);
  out=await cli(['watch','set','--file','-'],'{"models":{"decisions":{"model":"gpt-9"}}}');assert.equal(out.code,1);assert.match(out.stderr,/Choose one of the models/);
  out=await cli(['watch','reset']);assert.equal(out.stdout.trim(),"revision 4: back to the watcher's config file");assert.equal((await call('/inbox/watch')).body.settings,null);
  // 1.75: Check now, from the Inbox (cookie) and from the CLI; the watcher reads the request with its settings.
  r=await call('/inbox/check',{});assert.equal(r.status,200,JSON.stringify(r.body));assert.match(r.body.checkRequestedAt,/^\d{4}-\d\d-\d\dT/);assert.match(logs,/inbox check now source=inbox-monitor at=\S+ by=ui/);
  out=await cli(['watch','--json']);assert.equal(JSON.parse(out.stdout).checkRequestedAt,r.body.checkRequestedAt,'the watcher sees the request');
  out=await cli(['check']);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/asked inbox-monitor to check now/);
  out=await cli(['act',cid,'explode']);assert.equal(out.code,1);assert.match(out.stderr,/Unknown action/);
  out=await cli(['add','--title','x']);assert.equal(out.code,1);assert.match(out.stderr,/--text/);
  out=await cli(['show','000000000000']);assert.equal(out.code,1);
  out=await cli(['list'],undefined,{POCKET_DATA_DIR:path.join(dir,'nowhere')});assert.equal(out.code,2,'not running here');
  fs.mkdirSync(path.join(dir,'stale'));fs.writeFileSync(path.join(dir,'stale','cli-token'),'0'.repeat(64));fs.writeFileSync(path.join(dir,'stale','cli-url'),`http://127.0.0.1:${port}`);
  out=await cli(['list'],undefined,{POCKET_DATA_DIR:path.join(dir,'stale')});assert.equal(out.code,2,'a refused token');
  // With no address saved, asking for email says off; after the restart the feature stays on.
  fs.writeFileSync(path.join(dir,'data','pocket-settings.json'),JSON.stringify({...JSON.parse(fs.readFileSync(path.join(dir,'data','pocket-settings.json'),'utf8')),notifyEmail:''}));
  // 1.77: a conversation started from an entry's start link is remembered on the entry; a bad link id starts it anyway.
  const begun=await call('/new',{cwd:repo,text:'Handle Oakridge',provider:'claude',start:'0123456789ab',clientMessageId:randomUUID()});assert.equal(begun.status,202,JSON.stringify(begun.body));
  r=await call('/inbox?state=all');assert.deepEqual(r.body.entries.find(x=>x.id===e.id).sessions.map(x=>x.id),[begun.body.id]);
  assert.match(logs,new RegExp(`inbox link-session id=${e.id} session=${begun.body.id}`));
  assert.equal((await call('/new',{cwd:repo,text:'No link',provider:'claude',start:'../x',clientMessageId:randomUUID()})).status,202,'a bad start id is ignored');
  await stop();await start();bearer={'content-type':'application/json',authorization:'Bearer '+tokenOf()};
  r=await call('/inbox',{title:'No address',text:'x',email:true},bearer);assert.equal(r.status,200);assert.equal(r.body.mail,'off');
  assert.equal((await call('/inbox?state=all')).body.entries.length,3,'kept across a restart');
  out=await cli(['add','--title','Via CLI','--text','t','--email','--no-push','--json']);assert.equal(out.code,0,out.stderr);const j=JSON.parse(out.stdout);assert.equal(j.mail,'off');assert.equal(j.push,null);
  // Off again: the routes and the CLI say so.
  assert.equal((await call('/settings',{inbox:false})).body.inbox,false);
  out=await cli(['list']);assert.equal(out.code,1);assert.match(out.stderr,/Inbox Watch is off/);
  assert.equal((await call('/inbox')).status,404);
});

// 1.95: a digest's items, each with its own decision (alert, resolve, not_useful, restore) that reaches the watcher as feedback.
test('InboxStore: digest items are checked on add, kept on reload, decided one at a time and reported as digest-item feedback',()=>{
  const dir=tmp(),file=path.join(dir,'inbox.json');let clock=Date.parse('2026-11-07T13:00:00Z');
  const s=new InboxStore(file,{now:()=>clock});
  const items=[{ref:'a317',section:'worth',title:'Roslynn website feedback and review',text:'Roslynn texted that business is up 25%. [Text](msg:1a1b398659576b53)',story:'roslynn-website-feedback',gmail:GMAIL,url:'/#/start/0123456789ab',priority:'low'},
    {ref:'a296',section:'held',title:'Wireless Experts Google Ads keywords',text:'Steve asked for a keyword review.',story:'wireless-experts-google-ads-keywords'},
    {ref:'t12',section:'tidied',title:'Polo launch',text:'Resolved'}];
  const d=s.add({kind:'digest',title:'Morning email digest — Sat Nov 7',text:'## Worth knowing\n- Roslynn website feedback and review: business is up.\nIgnored since the last digest: 9 threads.',items,dedupe:'digest|2026-11-07'});
  assert.equal(d.items.length,3);assert.deepEqual(d.items[0],{ref:'a317',section:'worth',title:'Roslynn website feedback and review',text:items[0].text,story:'roslynn-website-feedback',gmail:GMAIL,url:'/#/start/0123456789ab',priority:'low',state:'open',actedAt:null,ackedAt:null,note:'',lastAction:null});
  assert.deepEqual([d.items[1].priority,d.items[1].gmail,d.items[1].url,d.items[2].section],['normal','','','tidied'],'defaults');
  assert.throws(()=>s.add({title:'x',items:[{ref:'a1',title:'t',url:'javascript:alert(1)'}]}),e=>e.code==='bad_item','an item\'s start link is checked like an entry\'s');
  assert.equal(s.add({kind:'alert',title:'plain'}).items.length,0,'an alert has no items');
  assert.throws(()=>s.add({title:'x',items:'nope'}),e=>e.code==='bad_items');
  assert.throws(()=>s.add({title:'x',items:[{ref:'a1',title:'one'},{ref:'a1',title:'two'}]}),e=>e.code==='bad_item'&&/used twice/.test(e.message));
  assert.throws(()=>s.add({title:'x',items:[{ref:'bad ref',title:'one'}]}),e=>e.code==='bad_item');
  assert.throws(()=>s.add({title:'x',items:[{ref:'a1'}]}),e=>e.code==='bad_item'&&/title/.test(e.message));
  assert.throws(()=>s.add({title:'x',items:[{ref:'a1',title:'t',section:'misc'}]}),e=>e.code==='bad_section');
  assert.throws(()=>s.add({title:'x',items:[{ref:'a1',title:'t',gmail:'https://evil.example/'}]}),e=>e.code==='bad_item');
  assert.throws(()=>s.add({title:'x',items:Array.from({length:41},(_,i)=>({ref:'a'+i,title:'t'}))}),e=>e.code==='bad_items');
  // A digest's text may run long; an alert's is still cut at 2000.
  assert.equal(s.add({kind:'digest',title:'long',text:'x'.repeat(13000)}).text.length,LIMITS.digestText);assert.equal(s.add({title:'long alert',text:'x'.repeat(13000)}).text.length,LIMITS.text);
  // Deciding on an item reads the entry, records the decision on the item and is feedback of kind digest-item with id <entry>/<ref>.
  clock+=1000;let r=s.act({action:'alert',id:d.id,item:'a317'});
  assert.deepEqual([r.state,r.seenAt,r.revision,r.items[0].state,r.items[0].actedAt,r.items[0].lastAction],['opened','2026-11-07T13:00:01Z',2,'alerted','2026-11-07T13:00:01Z','alert']);
  assert.equal(s.act({action:'alert',id:d.id,item:'a317'}).revision,2,'the same decision twice is one decision');
  clock+=1000;r=s.act({action:'not_useful',id:d.id,item:'a296',note:'Steve texts me anyway'});assert.deepEqual([r.items[1].state,r.items[1].note],['not_useful','Steve texts me anyway']);
  assert.throws(()=>s.act({action:'dismiss',id:d.id,item:'a317'}),e=>e.code==='bad_action');assert.throws(()=>s.act({action:'alert',id:d.id,item:'a999'}),e=>e.status===404&&e.code==='item_missing');
  let fb=s.feedback();
  assert.deepEqual(fb.map(f=>f.id),[`${d.id}/a296`,`${d.id}/a317`],'newest first, the entry itself undecided');
  assert.deepEqual(fb[1],{id:`${d.id}/a317`,entry:d.id,item:'a317',action:'alert',at:'2026-11-07T13:00:01Z',note:'',title:'Roslynn website feedback and review',story:'roslynn-website-feedback',source:'inbox-monitor',kind:'digest-item'});
  assert.equal(fb[0].action,'not_useful');
  assert.equal(s.ack([`${d.id}/a317`,d.id,'nope']),1,'the item is acked, the undecided entry is not');assert.deepEqual(s.feedback().map(f=>f.id),[`${d.id}/a296`]);
  // Restore undoes the item's decision and is feedback again; the entry's own decisions still work beside the items'.
  clock+=1000;r=s.act({action:'restore',id:d.id,item:'a317'});assert.deepEqual([r.items[0].state,r.items[0].lastAction,r.items[0].ackedAt],['open','restore',null]);
  assert.deepEqual(s.feedback().map(f=>[f.id,f.action]),[[`${d.id}/a317`,'restore'],[`${d.id}/a296`,'not_useful']]);
  clock+=1000;s.act({action:'dismiss',id:d.id});assert.deepEqual(s.feedback().map(f=>f.id),[d.id,`${d.id}/a317`,`${d.id}/a296`]);
  assert.equal(s.ack([d.id,`${d.id}/a317`,`${d.id}/a296`]),3);assert.deepEqual(s.feedback(),[]);
  // 1.95 (Brad): a line whose story already has an open alert on the list is not a new card: it is 'listed', links to that entry, and takes no decision.
  const open=s.add({kind:'alert',title:'Wireless Experts Google Ads keywords',story:'wireless-experts-google-ads-keywords',gmail:GMAIL});
  const gone=s.add({kind:'alert',title:'Old one',story:'old-story'});s.act({action:'resolve',id:gone.id});
  const d2=s.add({kind:'digest',title:'Morning email digest — Sun Nov 8',text:'## Worth knowing\n- a\n- b',dedupe:'digest|2026-11-08',items:[
    {ref:'a400',section:'worth',title:'Steve wants the keyword list',text:'Steve asked again.',story:'wireless-experts-google-ads-keywords'},
    {ref:'a401',section:'held',title:'Same thread, other story',text:'x',story:'other',gmail:GMAIL},
    {ref:'a402',section:'worth',title:'Old story returns',text:'y',story:'old-story'},
    {ref:'a403',section:'worth',title:'Fresh',text:'z',story:'fresh'}]});
  assert.deepEqual(d2.items.map(i=>[i.ref,i.section,i.url]),[['a402','worth',''],['a403','worth',''],['a400','listed','/#/inbox/'+open.id],['a401','listed','/#/inbox/'+open.id]],'story or thread matches an open alert; a resolved one does not; listed lines go last, the rest keep their order');
  assert.throws(()=>s.act({action:'alert',id:d2.id,item:'a400'}),e=>e.code==='item_history'&&/already on your list/.test(e.message));
  assert.throws(()=>s.act({action:'resolve',id:d.id,item:'t12'}),e=>e.code==='item_history');
  // Reload: items come back; a hand-edited bad item is dropped, not fatal.
  const raw=JSON.parse(fs.readFileSync(file,'utf8'));raw.entries[0].items.push({ref:'bad ref',title:'x'},{ref:'a317',title:'dup'});fs.writeFileSync(file,JSON.stringify(raw));
  const s2=new InboxStore(file,{now:()=>clock});const e2=s2.get(d.id);
  assert.deepEqual(e2.items.map(i=>[i.ref,i.state]),[['a317','open'],['a296','not_useful'],['t12','open']]);
});

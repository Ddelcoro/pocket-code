// 1.64: a session whose reply ended but whose background jobs (Bash run in the background, subagents)
// are still running reads Working in background, ahead of Response ready and the transcript's age.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionState, backgroundSummary, prioritizeSessions} from '../session-state.mjs';

const bash={task_id:'b1',task_type:'local_bash',description:'Run the full test suites'};
const agent={task_id:'a1',task_type:'local_agent',subagent_type:'general-purpose',description:'Audit the images'};
const outcome={kind:'finished',label:'Response ready',at:1000};

test('background jobs outrank a finished outcome and transcript age, never a live turn or a usage wait',()=>{
  const bg=sessionState({turn:null,outcome,mtimeMs:1000,background:[bash]});
  assert.equal(bg.kind,'background');assert.equal(bg.confirmed,true);
  assert.equal(bg.label,'Working in background · 1 job');
  assert.deepEqual(bg.background,{count:1,summary:'1 job',jobs:[{kind:'job',description:'Run the full test suites'}]});
  assert.equal(sessionState({turn:null,outcome,mtimeMs:1000,background:[]}).kind,'finished');
  assert.equal(sessionState({turn:null,outcome,mtimeMs:1000}).kind,'finished');
  assert.equal(sessionState({turn:null,outcome,mtimeMs:99000,background:[bash],external:true}).kind,'background','transcript activity does not hide background work');
  assert.equal(sessionState({turn:{startedAt:5},background:[bash]}).kind,'running');
  assert.equal(sessionState({turn:null,retryAt:5,background:[bash]}).kind,'waiting');
});

test('the summary counts agents and jobs separately and never carries a long description',()=>{
  assert.equal(backgroundSummary([]),null);assert.equal(backgroundSummary(undefined),null);
  const two=backgroundSummary([agent,bash,{task_type:'local_agent',subagent_type:'Explore'}]);
  assert.equal(two.summary,'2 agents, 1 job');assert.equal(two.count,3);
  assert.equal(two.jobs[2].description,'Explore','a subagent without a description shows its type');
  assert.equal(sessionState({turn:null,background:[agent]}).label,'Working in background · 1 agent');
  assert.equal(backgroundSummary([{task_type:'local_bash',description:'x'.repeat(500)}]).jobs[0].description.length,120);
});

test('a session working in the background never ages out of the list',()=>{
  const rows=[{id:'a',state:{kind:'idle'}},{id:'b',state:{kind:'background'}},{id:'c',state:{kind:'idle'}}];
  assert.deepEqual(prioritizeSessions(rows,2).map(r=>r.id),['b','a']);
});

test('a transcript written after the outcome keeps it only when nothing but bookkeeping was added',()=>{
  assert.equal(sessionState({turn:null,outcome,mtimeMs:99000}).kind,'idle','a later write ends the outcome');
  assert.equal(sessionState({turn:null,outcome,mtimeMs:99000,external:true}).kind,'observed');
  assert.equal(sessionState({turn:null,outcome,mtimeMs:99000,quietSince:true}).kind,'finished','process-exit bookkeeping keeps it');
  assert.equal(sessionState({turn:null,outcome:null,mtimeMs:99000,quietSince:true}).kind,'idle','no outcome, nothing to keep');
  assert.equal(sessionState({turn:{startedAt:5},outcome,quietSince:true}).kind,'running','a live turn still leads');
});

// 1.101: the reply to a wrap-up request (Mark resolved, Remind me …, No thanks) is reviewed as it finishes.
import {wrapUpRequest, replyAsksNothing} from '../session-state.mjs';
test('wrap-up requests are the short closing phrases, not requests that only start like one',()=>{
  for(const s of ['Mark resolved','Mark it resolved.','Mark as done','Ok, mark it resolved','Mark resolved, thanks','Dismiss','Not useful',
    'Remind me Nov 7 to recheck the numbers','Remind me to test it Monday','Add a task to test the fix','Add a task','Set a reminder for 3pm',
    'No thanks','No, thanks','No reminder needed','That\'s all','Thanks, that\'s all','Done','All set',
    // from the owner's own replies (two weeks of sessions, 2026-11-08)
    'Mark the alert resolved','Mark the Inbox Watch alert resolved','Yes, resolve the alert','No action, mark the alert resolved',
    'Leave it, just mark the alert resolved','Mark it resolved, Sam has it','No reminder, I\'ll start it myself','Close the task, Jo covered it',
    'Remind me Mon Nov 9 at 10 AM to check their replies','please set me a reminder for working on this tomorrow at 9 a.m.'])assert.equal(wrapUpRequest(s),true,s);
  for(const s of ['','Remind me what we decided','Add a task system to the app','Mark resolved and also fix the bug in server.mjs','Done?','Mark resolved?',
    'Done with the deploy, now run tests','Dismiss the old PR and open a new one','Merge and deploy','No, use the other approach',
    'Remind me tomorrow and then deploy it now','Commit the fix and resolve the alert','Send it and remind me Monday to close #226',
    'Confirm it\'s the portal notice, then resolve','Mark it resolved, then deploy','Mark 1 done; approve 2, 3, 5, 6, 8','Close the PR','Mark resolved\n\n[Attached file: notes.txt]','Remind me to '+'x'.repeat(80),null,undefined])assert.equal(wrapUpRequest(s),false,String(s));
});
test('a wrap-up reply counts as read only when it asks nothing back',()=>{
  const m=(...blocks)=>({blocks});
  assert.equal(replyAsksNothing([m({t:'tool',name:'Bash'}),m({t:'text',text:'Marked resolved. The reminder is set for Nov 7.'})]),true);
  assert.equal(replyAsksNothing([m({t:'text',text:'Which day should the reminder be?'})]),false,'a question');
  assert.equal(replyAsksNothing([m({t:'text',text:'Done.\n\nShould I also close the PR?'})]),false,'a question in the closing paragraph');
  assert.equal(replyAsksNothing([m({t:'text',text:'Set.'},{t:'choices',options:['Yes','No']})]),false,'reply buttons');
  assert.equal(replyAsksNothing([m({t:'text',text:'x'.repeat(1600)})]),false,'a report');
  assert.equal(replyAsksNothing([]),false,'no reply at all');
});

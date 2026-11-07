// 1.30 documents: the store's rules, the routes (private raw, public files, share links, keep from results, import),
// the agent instruction following the setting, and the CLI. Fake CLI only; scratch folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {DocumentStore,safeName,titleFor,kindOf,LIMITS} from '../documents.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pocket-documents-'));
const S1='11111111-1111-4111-8111-111111111111';

test('documents: names, kinds and titles',()=>{
  assert.equal(safeName('/x/y/Stock report (Oct).html'),'Stock_report_Oct_.html');assert.equal(safeName('../../etc/passwd'),null);assert.equal(safeName('.hidden.html'),'hidden.html');assert.equal(safeName('notes.exe'),null);
  assert.equal(kindOf('a.PDF'),'pdf');assert.equal(kindOf('a.csv'),'table');assert.equal(kindOf('a.xlsx'),'office');assert.equal(kindOf('a.sh'),null);
  assert.equal(titleFor('r.html','<html><head><title> Inventory &amp; stock \n review </title>'),'Inventory & stock review');
  assert.equal(titleFor('r.md','intro\n\n## The *plan*\n'),'The plan');assert.equal(titleFor('stock_report-2026.pdf',''),'stock report 2026');
});

test('DocumentStore: adopt, add, share, revoke, trash, restore, purge and import',()=>{
  const dir=tmp(),docsDir=path.join(dir,'documents');let clock=Date.parse('2026-10-09T12:00:00Z');
  fs.mkdirSync(docsDir,{recursive:true});fs.writeFileSync(path.join(docsDir,'dropped.html'),'<title>Dropped report</title><script>alert(1)</script>');fs.writeFileSync(path.join(docsDir,'.secret.html'),'x');fs.writeFileSync(path.join(docsDir,'notes.exe'),'x');
  const s=new DocumentStore(docsDir,path.join(dir,'documents.json'),{now:()=>clock});
  const list=s.list();assert.deepEqual(list.map(d=>[d.file,d.title,d.visibility,d.addedBy,d.inline]),[['dropped.html','Dropped report','private','folder',true]],'files in the folder are adopted private; dot-files and unknown kinds are not');
  const src=path.join(dir,'Weekly summary.md');fs.writeFileSync(src,'# Weekly summary\n\ntext');
  const a=s.addFromPath(src,{project:'warehouse-stock-report',session:S1,addedBy:'cli'});
  assert.equal(a.file,'Weekly_summary.md');assert.equal(a.title,'Weekly summary');assert.equal(a.project,'warehouse-stock-report');assert.equal(a.session,S1);assert.equal(a.url,null);assert.equal(a.share,null);
  assert.ok(fs.existsSync(path.join(docsDir,'Weekly_summary.md')));assert.equal((fs.statSync(path.join(docsDir,'Weekly_summary.md')).mode&0o777),0o600);
  const b=s.addFromPath(src,{addedBy:'cli'});assert.equal(b.file,'Weekly_summary-2.md','a name clash gets a suffix');
  assert.throws(()=>s.addFromPath(path.join(dir,'nope.md')),/ENOENT/);assert.throws(()=>s.addFromBuffer('run.sh',Buffer.from('x')),/cannot be kept/);assert.throws(()=>s.addFromBuffer('a.txt',Buffer.alloc(0)),/empty/);
  const up=s.addFromBuffer('photo.PNG',Buffer.from([1,2,3]),{addedBy:'ui'});assert.equal(up.kind,'image');assert.equal(up.size,3);
  const shared=s.update(a.id,{visibility:'link'});assert.match(shared.token,/^[A-Za-z0-9_-]{40,}$/);assert.equal(shared.share.url,'/share/'+shared.token);assert.equal(s.resolveShare(shared.token).id,a.id);
  assert.equal(s.resolveShare('short'),null);assert.equal(s.resolveShare(shared.token+'x'),null);
  const again=s.update(a.id,{action:'reshare'});assert.notEqual(again.token,shared.token);assert.equal(s.resolveShare(shared.token),null,'reshare revokes the old link');assert.equal(s.resolveShare(again.token).id,a.id);
  s.update(a.id,{expiresAt:'2026-10-10T12:00:00Z'});assert.equal(s.resolveShare(again.token).id,a.id);clock=Date.parse('2026-10-10T12:00:01Z');assert.equal(s.resolveShare(again.token),null,'expired');clock=Date.parse('2026-10-09T13:00:00Z');
  const pub=s.update(a.id,{visibility:'public'});assert.equal(pub.share,null);assert.equal(pub.url,'/files/Weekly_summary.md');assert.equal(s.resolveShare(again.token),null,'leaving link revokes it');assert.equal(s.resolvePublic('Weekly_summary.md').id,a.id);assert.equal(s.resolvePublic('Weekly_summary-2.md'),null);
  assert.throws(()=>s.update(a.id,{visibility:'staff'}),/private, link or public/);assert.throws(()=>s.update(a.id,{title:' '}),/title/);assert.throws(()=>s.update('nope',{title:'x'}),e=>e.status===404);
  assert.equal(s.update(a.id,{title:'Week 41',project:''}).project,null);
  const t=s.trash(a.id);assert.ok(t.trashedAt);assert.equal(t.visibility,'private');assert.equal(s.resolvePublic('Weekly_summary.md'),null,'trashed documents are reachable by nobody');
  assert.ok(fs.existsSync(path.join(docsDir,'.trash',a.id+'-Weekly_summary.md')));assert.equal(s.list().some(d=>d.id===a.id),false);assert.equal(s.list({trashed:true})[0].id,a.id);
  assert.throws(()=>s.update(a.id,{title:'x'}),e=>e.status===409);
  assert.equal(s.purge(Date.parse('2026-10-20T00:00:00Z')).length,0,'inside the 30 days');
  const r=s.restore(a.id);assert.equal(r.trashedAt,null);assert.equal(r.file,'Weekly_summary.md');assert.ok(fs.existsSync(path.join(docsDir,'Weekly_summary.md')));
  s.trash(b.id);assert.deepEqual(s.purge(Date.parse('2026-11-10T00:00:00Z')),[b.id]);assert.equal(fs.existsSync(path.join(docsDir,'.trash',b.id+'-Weekly_summary-2.md')),false);
  const reloaded=new DocumentStore(docsDir,path.join(dir,'documents.json'),{now:()=>clock});assert.equal(reloaded.documents.length,3);assert.equal(reloaded.get(a.id).title,'Week 41');
  // import of Mission Control's metadata: public stays public, staff becomes a link, private stays private; unknown names are reported
  fs.writeFileSync(path.join(docsDir,'pub.html'),'<title>Public one</title>');fs.writeFileSync(path.join(docsDir,'staff.pdf'),'%PDF');fs.writeFileSync(path.join(docsDir,'priv.png'),'x');fs.writeFileSync(path.join(docsDir,'extra.md'),'# Extra');
  const imp=reloaded.importMeta({'pub.html':{visibility:'public',updated:'2026-09-01T00:00:00Z'},'staff.pdf':{visibility:'private',access:'techpro'},'priv.png':{visibility:'private'},'gone.html':{visibility:'public'},'dropped.html':{visibility:'public'}});
  assert.deepEqual(imp.counts,{public:1,link:1,private:1,skipped:1});assert.deepEqual(imp.missing,['gone.html']);assert.equal(imp.links.length,1);assert.equal(imp.links[0].file,'staff.pdf');assert.equal(imp.adopted,1,'extra.md adopted from the folder');
  assert.equal(reloaded.resolvePublic('pub.html').title,'Public one');assert.equal(reloaded.resolvePublic('pub.html').added,'2026-09-01T00:00:00Z');
  assert.equal(reloaded.get('x'===1?'':reloaded.documents.find(d=>d.file==='dropped.html').id).visibility,'private','already-known files are left alone');
  assert.throws(()=>reloaded.importMeta([]),/metadata/);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('DocumentStore 1.45: bulk trash and restore, Delete forever, Empty trash, and thumbnails go with their files',()=>{
  const dir=tmp(),docsDir=path.join(dir,'documents'),thumbs=path.join(docsDir,'.thumbs');let clock=Date.parse('2026-10-13T12:00:00Z');
  const s=new DocumentStore(docsDir,path.join(dir,'documents.json'),{now:()=>clock});
  const [a,b,c]=['a.md','b.md','c.md'].map(n=>s.addFromBuffer(n,Buffer.from('# '+n)));
  fs.mkdirSync(thumbs,{recursive:true});for(const d of [a,b,c])fs.writeFileSync(path.join(thumbs,`${d.id}-9-1.jpg`),'x');
  fs.writeFileSync(path.join(thumbs,'0123456789ab-1-1.jpg'),'orphan');fs.writeFileSync(path.join(thumbs,'notes.txt'),'not a thumbnail');
  assert.throws(()=>s.bulk('shred',[a.id]),/trash, restore or delete/);assert.throws(()=>s.bulk('trash',[]),/Choose/);assert.throws(()=>s.bulk('trash','x'),/Choose/);
  let r=s.bulk('trash',[a.id,b.id,a.id,'nope']);
  assert.deepEqual(r.done.map(d=>d.id).sort(),[a.id,b.id].sort());assert.deepEqual(r.failed,[{id:'nope',error:'That file does not exist.'}]);
  assert.ok(r.done.every(d=>d.trashedAt));assert.equal(s.list({trashed:true}).length,2);
  assert.equal(new DocumentStore(docsDir,path.join(dir,'documents.json')).documents.filter(d=>d.trashedAt).length,2,'one save covers the batch');
  assert.throws(()=>s.destroy(c.id),e=>e.status===409,'only a file in the trash can be deleted');
  r=s.bulk('delete',[a.id,c.id]);assert.deepEqual(r.done,[{id:a.id,file:'a.md',deleted:true}]);assert.equal(r.failed[0].id,c.id);
  assert.equal(fs.existsSync(path.join(docsDir,'.trash',a.id+'-a.md')),false,'the file is gone at once');assert.throws(()=>s.get(a.id),/does not exist/);
  assert.deepEqual(fs.readdirSync(thumbs).sort(),[`${b.id}-9-1.jpg`,`${c.id}-9-1.jpg`,'notes.txt'].sort(),'its thumbnail and the orphan went; others stay');
  r=s.bulk('restore',[b.id]);assert.equal(r.done[0].trashedAt,null);assert.ok(fs.existsSync(path.join(docsDir,'b.md')));
  s.bulk('trash',[b.id,c.id]);r=s.emptyTrash();assert.deepEqual(r.done.sort(),[b.id,c.id].sort());assert.deepEqual(r.failed,[]);
  assert.equal(s.documents.length,0);assert.deepEqual(fs.readdirSync(path.join(docsDir,'.trash')),[]);assert.deepEqual(fs.readdirSync(thumbs),['notes.txt']);
  assert.deepEqual(s.emptyTrash(),{done:[],failed:[]});
  assert.equal(s.list().length,0,'deleted files are not adopted back from the folder');
  // The 30-day purge also takes thumbnails, and clears orphans even when nothing is due.
  const d=s.addFromBuffer('d.md',Buffer.from('# d'));fs.writeFileSync(path.join(thumbs,`${d.id}-3-1.jpg`),'x');fs.writeFileSync(path.join(thumbs,'ba9876543210-1-1.png'),'orphan');
  assert.deepEqual(s.purge(),[]);assert.deepEqual(fs.readdirSync(thumbs).sort(),[`${d.id}-3-1.jpg`,'notes.txt'].sort());
  s.trash(d.id);assert.deepEqual(s.purge(clock+31*86400000),[d.id]);assert.deepEqual(fs.readdirSync(thumbs),['notes.txt']);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('HTTP: documents are off until Settings turns them on; raw is sandboxed; public and share paths serve only what they should; keep, import, the agent line and the CLI',async t=>{
  const dir=tmp();let port=19011;
  const secret=randomUUID(),exp=Date.now()+3600000;
  const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  const docsDir=path.join(dir,'docs');fs.mkdirSync(docsDir,{recursive:true});fs.mkdirSync(path.join(dir,'sessions','test-workspace'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  fs.writeFileSync(path.join(docsDir,'dashboard.html'),'<!doctype html><title>Ops dashboard</title><script>document.title="ran"</script><p>hi</p>');
  fs.writeFileSync(path.join(dir,'data','projects.json'),JSON.stringify({version:1,projects:[{id:'warehouse-stock-report',name:'Warehouse stock report'}]})); // 1.81: a file links only to a project that exists
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),POCKET_SKILLS:'0',PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_DOCUMENTS_DIR:docsDir,POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs')},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  const stop=async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}};
  t.after(async()=>{await stop();try{for(const line of fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n')){const pid=JSON.parse(line).pid;if(pid)try{process.kill(pid,'SIGKILL');}catch{}}}catch{}await sleep(50);fs.rmSync(dir,{recursive:true,force:true,maxRetries:30,retryDelay:100});});
  const base=()=>`http://127.0.0.1:${port}`;
  const call=async(p,body,h=headers,method)=>{const r=await fetch(base()+p,{method:method||(body?'POST':'GET'),headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({})),headers:r.headers};};
  const raw=async(p,h={})=>{const r=await fetch(base()+p,{headers:h});return {status:r.status,text:await r.text(),headers:r.headers};};
  await start();
  const token=fs.readFileSync(path.join(dir,'data','cli-token'),'utf8').trim(),bearer={'content-type':'application/json',authorization:'Bearer '+token};
  const calls=()=>fs.existsSync(path.join(dir,'calls'))?fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n').map(JSON.parse):[];
  assert.equal((await call('/api/documents')).body.code,'documents_off');assert.equal((await raw('/files/dashboard.html')).status,404,'nothing public while off');
  assert.equal((await call('/api/new',{cwd:repo,text:'Before',provider:'claude',clientMessageId:randomUUID()})).status,202);for(let i=0;i<50&&calls().length<1;i++)await sleep(50);
  assert.equal(calls().at(-1).documents,false);
  assert.equal((await call('/api/settings',{documents:true})).body.documents,true);assert.deepEqual((await call('/api/me')).body.features,{projects:false,documents:true,tasks:false,inbox:false,coordination:false,vault:false,assistantMode:false,assistantLocked:false});
  assert.equal((await call('/api/new',{cwd:repo,text:'After',provider:'claude',clientMessageId:randomUUID()})).status,202);for(let i=0;i<50&&calls().length<2;i++)await sleep(50);
  assert.equal(calls().at(-1).documents,true,'agents are told how to keep documents once the feature is on');
  let lib=await call('/api/documents');assert.equal(lib.status,200);assert.deepEqual(lib.body.documents.map(d=>[d.file,d.title,d.addedBy]),[['dashboard.html','Ops dashboard','folder']],'the folder was adopted');
  const dash=lib.body.documents[0];
  // Private raw: login required, inline, sandboxed, never cached.
  assert.equal((await raw('/api/documents/'+dash.id+'/raw')).status,401);
  const r1=await raw('/api/documents/'+dash.id+'/raw',{cookie:'pc_auth='+cookie});
  assert.equal(r1.status,200);assert.match(r1.headers.get('content-type'),/^text\/html/);assert.match(r1.headers.get('content-security-policy'),/^sandbox allow-scripts allow-popups allow-downloads allow-forms; frame-ancestors 'self'$/);
  assert.equal(r1.headers.get('cache-control'),'private, no-store');assert.equal(r1.headers.get('x-content-type-options'),'nosniff');assert.match(r1.headers.get('content-disposition'),/^inline; filename\*=UTF-8''dashboard\.html$/);assert.match(r1.text,/Ops dashboard/);
  const r1d=await raw('/api/documents/'+dash.id+'/raw?download=1',{cookie:'pc_auth='+cookie});assert.match(r1d.headers.get('content-disposition'),/^attachment/);
  // Upload from the UI.
  const up=await fetch(base()+'/api/documents',{method:'POST',headers:{cookie:'pc_auth='+cookie,'x-filename':'Count sheet.csv','x-project':'warehouse-stock-report','content-type':'application/octet-stream'},body:'a,b\n1,2\n'});
  const sheet=await up.json();assert.equal(up.status,200);assert.equal(sheet.file,'Count_sheet.csv');assert.equal(sheet.kind,'table');assert.equal(sheet.project,'warehouse-stock-report');assert.equal(sheet.addedBy,'ui');
  assert.equal((await fetch(base()+'/api/documents',{method:'POST',headers:{cookie:'pc_auth='+cookie,'x-filename':'virus.exe'},body:'x'})).status,400);
  // The CLI's add: a real file under the home directory, outside dot-directories; the token works here and nowhere else.
  const home=os.homedir(),srcDir=fs.mkdtempSync(path.join(home,'.pocket-doc-test-')),okDir=fs.mkdtempSync(path.join(home,'pocket-doc-test-'));
  t.after(()=>{fs.rmSync(srcDir,{recursive:true,force:true});fs.rmSync(okDir,{recursive:true,force:true});});
  fs.writeFileSync(path.join(srcDir,'hidden.md'),'# no');fs.writeFileSync(path.join(okDir,'report.md'),'# Quarterly report\n\nnumbers');
  assert.equal((await call('/api/documents/add',{path:path.join(srcDir,'hidden.md')},bearer)).status,403,'hidden directories are refused');
  assert.equal((await call('/api/documents/add',{path:'relative.md'},bearer)).status,400);assert.equal((await call('/api/documents/add',{path:path.join(okDir,'missing.md')},bearer)).status,404);
  const added=await call('/api/documents/add',{path:path.join(okDir,'report.md'),session:S1,visibility:'link'},bearer);
  assert.equal(added.status,200);assert.equal(added.body.addedBy,'cli');assert.equal(added.body.title,'Quarterly report');assert.match(added.body.token,/^[A-Za-z0-9_-]{40,}$/);assert.equal(added.body.session,S1);
  assert.equal((await call('/api/documents',null,{...bearer,'cf-connecting-ip':'203.0.113.5'})).status,401,'the token is refused through the tunnel');
  // Share and public paths: no login; the right file and nothing else; strict headers; revocation.
  const sh=await raw('/share/'+added.body.token);assert.equal(sh.status,200);assert.match(sh.text,/Quarterly report/);assert.match(sh.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(sh.headers.get('x-robots-tag'),'noindex, nofollow, noarchive, nosnippet');
  assert.equal((await raw('/share/'+added.body.token.slice(0,-1)+(added.body.token.endsWith('A')?'B':'A'))).status,404,'a token with one character changed is refused');assert.equal((await raw('/files/report.md')).status,404,'a link document is not public');
  assert.equal((await raw('/files/dashboard.html')).status,404,'private is private');
  const pub=await call('/api/documents/'+dash.id,{visibility:'public'});assert.equal(pub.body.url,'/files/dashboard.html');
  const pf=await raw('/files/dashboard.html');assert.equal(pf.status,200);assert.match(pf.headers.get('content-security-policy'),/^sandbox allow-scripts[^;]*; frame-ancestors 'none'$/);assert.match(pf.text,/<script>/,'the document is sent as itself');
  assert.equal((await raw('/files/../server.mjs')).status,404);assert.equal((await raw('/files/.trash')).status,404);
  // 1.76.3: the stored copy replaced by a symlink (anything running as the daemon's user can do it) serves nothing, to nobody: not the link's target.
  const stored=path.join(docsDir,'dashboard.html'),storedBytes=fs.readFileSync(stored);fs.rmSync(stored);fs.symlinkSync(path.join(repo,'server.mjs'),stored);
  const viaLink=await raw('/files/dashboard.html');assert.equal(viaLink.status,404,'a public link does not follow a link out of the library');assert.doesNotMatch(viaLink.text,/import /);
  assert.equal((await raw('/api/documents/'+dash.id+'/raw',headers)).status,404,'nor does the signed-in viewer');
  fs.rmSync(stored);fs.writeFileSync(stored,storedBytes);assert.equal((await raw('/files/dashboard.html')).status,200,'the real file is served again');
  const rev=await call('/api/documents/'+added.body.id,{visibility:'private'});assert.equal(rev.body.share,null);assert.equal((await raw('/share/'+added.body.token)).status,404,'revoked');
  // Keep as document from a session's Results: only a file the session referenced.
  const sid=(await call('/api/new',{cwd:okDir,text:'Write a report',provider:'claude',clientMessageId:randomUUID()})).body.id;
  await sleep(1500);
  fs.appendFileSync(path.join(dir,'sessions','test-workspace',sid+'.jsonl'),JSON.stringify({type:'assistant',message:{role:'assistant',content:[{type:'text',text:'Saved the report to `'+path.join(okDir,'report.md')+'` for review.'}]},timestamp:new Date().toISOString()})+'\n');
  assert.equal((await call('/api/documents/keep',{session:sid,path:path.join(okDir,'other.md')})).status,403);
  const kept=await call('/api/documents/keep',{session:sid,path:path.join(okDir,'report.md'),project:'warehouse-stock-report'});
  assert.equal(kept.status,200,JSON.stringify(kept.body));assert.equal(kept.body.addedBy,'session');assert.equal(kept.body.session,sid);assert.equal(kept.body.file,'report-2.md','a second copy of the same name gets a suffix');
  // Trash, restore and the listing.
  assert.ok((await call('/api/documents/'+sheet.id,{action:'trash'})).body.trashedAt);lib=await call('/api/documents');assert.equal(lib.body.trash.length,1);assert.equal(lib.body.documents.some(d=>d.id===sheet.id),false);
  assert.equal((await raw('/api/documents/'+sheet.id+'/raw',{cookie:'pc_auth='+cookie})).status,404);
  assert.equal((await call('/api/documents/'+sheet.id,{action:'restore'})).body.trashedAt,null);
  // 1.45: several at once, Delete forever and Empty trash: the owner's cookie from Pocket's origin only; never the CLI token.
  const tmpA=await fetch(base()+'/api/documents',{method:'POST',headers:{cookie:'pc_auth='+cookie,'x-filename':'scratch-a.md'},body:'# A'}).then(r=>r.json());
  const tmpB=await fetch(base()+'/api/documents',{method:'POST',headers:{cookie:'pc_auth='+cookie,'x-filename':'scratch-b.md'},body:'# B'}).then(r=>r.json());
  assert.equal((await call('/api/documents/bulk',{action:'trash',ids:[tmpA.id]},bearer)).status,401,'the CLI token cannot bulk-remove');
  assert.equal((await call('/api/documents/bulk',{action:'trash',ids:[tmpA.id]},{...headers,origin:'https://evil.example'})).status,403,'cross-origin refused');
  assert.equal((await call('/api/documents/bulk',{action:'trash',ids:[]})).status,400);
  let bulk=await call('/api/documents/bulk',{action:'trash',ids:[tmpA.id,tmpB.id]},{...headers,origin:base()});
  assert.equal(bulk.status,200,JSON.stringify(bulk.body));assert.equal(bulk.body.done.length,2);assert.equal((await call('/api/documents')).body.trash.length,2);
  assert.equal((await call('/api/documents/bulk',{action:'delete',ids:[tmpA.id]},bearer)).status,401,'an agent cannot delete');
  assert.equal((await call('/api/documents/'+tmpA.id,{action:'delete'},bearer)).status,403,'the per-file route has no delete');
  assert.equal((await call('/api/documents/trash/empty',{},bearer)).status,401,'nor empty the trash');
  bulk=await call('/api/documents/bulk',{action:'delete',ids:[tmpA.id]});assert.deepEqual(bulk.body.done.map(d=>d.id),[tmpA.id]);
  assert.equal(fs.readdirSync(path.join(docsDir,'.trash')).some(f=>f.includes(tmpA.id)),false,'the file left the server');
  const empty=await call('/api/documents/trash/empty',{});assert.deepEqual(empty.body,{done:[tmpB.id],failed:[]});assert.equal((await call('/api/documents')).body.trash.length,0);
  assert.match(logs,/documents trash emptied: 1 deleted/);
  assert.equal((await call('/api/documents?project=warehouse-stock-report')).body.documents.length,2);assert.equal((await call('/api/documents?q=quarterly')).body.documents.length,2);
  // Import of Mission Control's metadata.
  fs.writeFileSync(path.join(docsDir,'old-public.html'),'<title>Old public</title>');fs.writeFileSync(path.join(docsDir,'old-staff.html'),'<title>Old staff</title>');
  const imp=await call('/api/documents/import',{'old-public.html':{visibility:'public'},'old-staff.html':{visibility:'private',access:'techpro'},'dashboard.html':{visibility:'private'},'nothere.pdf':{visibility:'public'}},bearer);
  assert.deepEqual(imp.body.counts,{public:1,link:1,private:0,skipped:1});assert.deepEqual(imp.body.missing,['nothere.pdf']);assert.equal((await raw('/files/old-public.html')).status,200);assert.equal((await raw(imp.body.links[0].url)).status,200);
  // The CLI.
  const cli=(args,cwd=okDir)=>new Promise(r=>execFile(process.execPath,[path.join(repo,'scripts/pocket-docs.mjs'),...args],{cwd,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_DATA_DIR:path.join(dir,'data'),POCKET_PUBLIC_URL:'https://pocket.example.test'}},(e,stdout,stderr)=>r({code:e?e.code:0,stdout,stderr})));
  let out=await cli(['list']);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/Ops dashboard/);assert.match(out.stdout,/Quarterly report/);
  fs.writeFileSync(path.join(okDir,'memo.txt'),'memo');
  out=await cli(['add','memo.txt','--title','Memo to staff','--project','warehouse-stock-report']);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/Kept in Files:\n[0-9a-f]{12}  private txt    Memo to staff  \[warehouse-stock-report\]/);
  const memoId=/\n([0-9a-f]{12}) /.exec(out.stdout)[1];
  out=await cli(['share',memoId,'--expires','7d']);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/^Share URL: https:\/\/pocket\.example\.test\/share\/[A-Za-z0-9_-]{40,}  \(expires /);
  const url=/\/share\/([A-Za-z0-9_-]+)/.exec(out.stdout)[1];assert.equal((await raw('/share/'+url)).status,200);
  // 1.81 (#179): show and set print the link already made; share on a shared file says the old link stopped working; a project
  // id that names no project is refused; --expires takes any number of days.
  out=await cli(['show',memoId]);assert.match(out.stdout,new RegExp(`Share URL: https://pocket\\.example\\.test/share/${url}  expires `));
  out=await cli(['set',memoId,'--title','Memo to staff']);assert.match(out.stdout,new RegExp(`Share URL: https://pocket\\.example\\.test/share/${url}`));
  out=await cli(['share',memoId,'--expires','45d']);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/\nThe previous link no longer works\.$/m);
  const url2=/\/share\/([A-Za-z0-9_-]+)/.exec(out.stdout)[1];assert.notEqual(url2,url);assert.equal((await raw('/share/'+url)).status,404);
  assert.match((await cli(['show',memoId])).stdout,new RegExp(`/share/${url2}  expires `));
  out=await cli(['share',memoId,'--expires','0d']);assert.equal(out.code,1);assert.match(out.stderr,/number of days, like 7d or 30d, or none/);
  out=await cli(['set',memoId,'--project','warehouse-stok-report']);assert.equal(out.code,1);assert.match(out.stderr,/no project with the id warehouse-stok-report/);
  out=await cli(['add','memo.txt','--project','nope']);assert.equal(out.code,1);assert.match(out.stderr,/no project with the id nope/);
  assert.equal((await cli(['set',memoId,'--project',''])).code,0,'clearing the project is always allowed');
  out=await cli(['set',memoId,'--visibility','private']);assert.equal(out.code,0,out.stderr);assert.equal((await raw('/share/'+url2)).status,404);
  out=await cli(['trash',memoId]);assert.match(out.stdout,/Moved to the trash/);out=await cli(['restore',memoId]);assert.match(out.stdout,/Restored: Memo to staff/);
  assert.equal((await call('/api/settings',{documents:false})).body.documents,false);
  out=await cli(['list']);assert.equal(out.code,3);assert.equal((await raw('/files/old-public.html')).status,404,'off again: nothing public');
});

// 1.73.6: the checks come before the copy, and a record changes only once the file holds it.
test('DocumentStore (1.73.6): a refused add copies nothing; a failed check or write leaves the record and the folder as they were',()=>{
  const dir=tmp(),docsDir=path.join(dir,'documents'),meta=path.join(dir,'documents.json');let failNext=false;const write=(f,data)=>{if(failNext){failNext=false;throw Object.assign(new Error('ENOSPC: no space left on device'),{code:'ENOSPC'});}fs.writeFileSync(f,JSON.stringify(data));};
  const s=new DocumentStore(docsDir,meta,{write});
  const src=path.join(dir,'report.html');fs.writeFileSync(src,'<title>T</title>');
  assert.throws(()=>s.addFromPath(src,{session:'not-a-session-id',addedBy:'cli'}),/not a session id/);
  assert.deepEqual(fs.readdirSync(docsDir),[],'nothing was copied');assert.deepEqual(s.list(),[],'so nothing is adopted');
  assert.throws(()=>s.addFromBuffer('x.txt',Buffer.from('x'),{visibility:'bogus'}),/Visibility/);assert.deepEqual(fs.readdirSync(docsDir),[]);
  failNext=true;assert.throws(()=>s.addFromPath(src,{addedBy:'cli'}),/ENOSPC/);
  assert.deepEqual(fs.readdirSync(docsDir),[],'a copy the write could not record is removed');assert.deepEqual(s.list(),[]);
  const d=s.addFromPath(src,{title:'Good',addedBy:'cli'});assert.deepEqual(fs.readdirSync(docsDir),['report.html']);
  assert.throws(()=>s.update(d.id,{title:'Changed',visibility:'bogus'}),/Visibility/);
  assert.equal(s.get(d.id).title,'Good','a title set before a later check failed is not kept');assert.equal(JSON.parse(fs.readFileSync(meta,'utf8')).documents[0].title,'Good');
  failNext=true;assert.throws(()=>s.update(d.id,{title:'Changed'}),/ENOSPC/);assert.equal(s.get(d.id).title,'Good');
  failNext=true;assert.throws(()=>s.update(d.id,{visibility:'link'}),/ENOSPC/);assert.equal(s.get(d.id).visibility,'private');assert.equal(s.get(d.id).shareHash,null);
  failNext=true;assert.throws(()=>s.trash(d.id),/ENOSPC/);assert.equal(s.get(d.id).trashedAt,null,'the record stays in place even though the file moved');
  fs.rmSync(dir,{recursive:true,force:true});
});
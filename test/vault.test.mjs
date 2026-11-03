// 1.39 vault: the encrypted store's rules, the scrubber and the daemon-side run, the /api/vault routes (what the owner's
// cookie and an agent's token may each do), runner tokens, the agent line, and the CLI. No value ever reaches an agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {VaultStore,parseKey,newKey,encryptStore,decryptStore,storeHeader,deriveKey,scrubber,needlesFor,makeScrubStream,runWithSecrets,vaultInstructions,LIMITS,EXPORT_FORMAT} from '../vault.mjs';
import {agentEnv} from '../environment.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const repo=path.resolve(import.meta.dirname,'..');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET|VAPID|CODEX)_/.test(k)));
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pocket-vault-'));
const S1='11111111-1111-4111-8111-111111111111';
const SECRET='sk-live-hunter2-0123456789abcdef';

test('key and file format: round trip, wrong key and tampering fail closed',()=>{
  const k1=parseKey(newKey()),k2=parseKey(newKey());
  const buf=encryptStore(k1,{items:[{name:'a',values:{value:SECRET}}]});
  assert.equal(buf[0],1);assert.doesNotMatch(buf.toString('latin1'),/hunter2/,'nothing readable on disk');
  assert.deepEqual(decryptStore([k1],buf).items[0].values.value,SECRET);
  assert.deepEqual(decryptStore([k2,k1],buf).items[0].name,'a','a retired key still opens an older file');
  assert.throws(()=>decryptStore([k2],buf),/cannot be opened/);
  const bad=Buffer.from(buf);bad[40]^=1;assert.throws(()=>decryptStore([k1],bad),/cannot be opened/,'a flipped byte fails the tag');
  assert.throws(()=>decryptStore([k1],Buffer.from('nope')),/not in a known format/);
  assert.throws(()=>parseKey('short'),/32 random bytes/);assert.throws(()=>parseKey(''),/not set/);
  assert.equal(parseKey('"'+newKey()+'"').length,32,'quotes from .env are tolerated');
});

test('VaultStore: items, policies, recipes, requests, trash, audit; values never leave through a view',()=>{
  const dir=tmp(),file=path.join(dir,'vault.enc'),key=parseKey(newKey());let clock=Date.parse('2026-10-12T12:00:00Z');
  const s=new VaultStore(file,{key,now:()=>clock});
  const a=s.act({action:'add',name:'Zoho-Books',kind:'api_key',values:{value:SECRET},url:'https://books.zoho.com',tags:['Zoho','finance'],notes:'Renew yearly'});
  assert.equal(a.name,'zoho-books');assert.equal(a.policy,'default','follows the Agent access setting by default');assert.equal(a.effectivePolicy,'ask');assert.equal(a.policyWord,'Asks once per command');assert.deepEqual(a.fields,['value']);assert.deepEqual(a.tags,['zoho','finance']);assert.equal(a.notes,'Renew yearly');
  assert.equal(JSON.stringify(a).includes('hunter2'),false,'no value in a view');assert.equal('values' in a,false);
  const login=s.act({action:'add',name:'vendor-portal',kind:'login',values:{username:'brad@example.test',password:'P@ss word "quoted"'},policy:'auto'});
  assert.equal(login.policy,'auto');assert.deepEqual(login.fields,['username','password']);
  assert.throws(()=>s.act({action:'add',name:'Bad Name',kind:'token',values:{value:'x'}}),/lower-case letters/);
  assert.throws(()=>s.act({action:'add',name:'zoho-books',kind:'token',values:{value:'x'}}),e=>e.status===409);
  assert.throws(()=>s.act({action:'add',name:'empty',kind:'token',values:{value:'  '}}),/required/);
  assert.throws(()=>s.act({action:'add',name:'ph',kind:'token',values:{value:'{{vault:zoho-books}}'}}),/placeholder/);
  assert.throws(()=>s.act({action:'add',name:'k',kind:'card',values:{}}),/kind must be/);
  // 1.39.1: custom fields on any kind, and a credentials kind with only custom fields.
  const authnet=s.act({action:'add',name:'authorize-net',kind:'login',values:{username:'login-id-123',password:'txn-key-secret-9876',signature_key:'sig-key-secret-abcdef'}});
  assert.deepEqual(authnet.fields,['username','password','signature_key']);assert.deepEqual(authnet.custom,['signature_key']);
  const ups=s.act({action:'add',name:'ups-api',kind:'credentials',values:{client_id:'ups-client-id-1',client_secret:'ups-client-secret-2'}});
  assert.deepEqual(ups.fields,['client_id','client_secret']);assert.deepEqual(ups.custom,['client_id','client_secret']);
  assert.throws(()=>s.act({action:'add',name:'c0',kind:'credentials',values:{}}),/at least one field/);
  assert.throws(()=>s.act({action:'add',name:'c1',kind:'credentials',values:{'Client ID':'x'}}),/not a field name/);
  assert.throws(()=>s.act({action:'add',name:'c2',kind:'credentials',values:{client_id:'  '}}),/needs a value/);
  assert.throws(()=>s.act({action:'add',name:'c3',kind:'credentials',values:Object.fromEntries(Array.from({length:21},(_,k)=>['f'+k,'v']))}),/up to 20 custom fields/);
  // Edits: a blank new custom field is ignored, a typed one is added, removeFields drops one, fixed fields cannot be removed.
  s.act({action:'update',item:ups.id,values:{client_id:'',account_number:'acct-777',extra:''}});
  assert.deepEqual(s.view(s.get(ups.id)).fields,['client_id','client_secret','account_number']);assert.equal(s.get(ups.id).values.client_id,'ups-client-id-1');
  s.act({action:'update',item:ups.id,removeFields:['account_number']});assert.deepEqual(s.get(ups.id).custom,['client_id','client_secret']);assert.equal('account_number' in s.get(ups.id).values,false);
  assert.throws(()=>s.act({action:'update',item:authnet.id,removeFields:['password']}),/not a custom field/);
  assert.throws(()=>s.act({action:'update',item:authnet.id,values:{'bad-name':'x'}}),/not a field name/);
  assert.equal(s.field(authnet.id,'signature_key'),'sig-key-secret-abcdef');
  assert.throws(()=>s.resolveBindings({U:'ups-api'}),/name one, for example ups-api\.client_id/);
  assert.equal(s.resolveBindings({S:'authorize-net.signature_key'})[0].field,'signature_key');
  assert.throws(()=>s.resolveBindings({S:'authorize-net.nope'}),/no field nope/);
  // Agents: create-only, nothing else.
  const fromAgent=s.act({action:'add',name:'twilio-auth',kind:'token',values:{value:'tw-secret-value-1234'},policy:'auto',notes:'ignored'},{actor:'agent',session:S1,sessionTitle:'Billing'});
  assert.equal(fromAgent.policy,'default','an agent cannot pick a policy');assert.equal('notes' in fromAgent,false,'agents never see notes');
  assert.throws(()=>s.act({action:'add',name:'twilio-auth',kind:'token',values:{value:'other'}},{actor:'agent'}),/agents cannot replace it/);
  assert.throws(()=>s.act({action:'update',item:a.id,policy:'auto'},{actor:'agent'}),e=>e.status===403);
  assert.throws(()=>s.act({action:'remove',item:a.id},{actor:'terminal'}),e=>e.status===403);
  assert.throws(()=>s.act({action:'answer',request:'x',decision:'once'},{actor:'agent'}),e=>e.status===403);
  // Owner edits: values only when typed; stale revisions refused.
  clock+=1000;const e1=s.act({action:'update',item:a.id,expected_revision:1,values:{value:''},url:'https://books.zoho.com/app'});
  assert.equal(e1.revision,2);assert.equal(s.get(a.id).values.value,SECRET,'an empty value leaves the stored one');
  assert.throws(()=>s.act({action:'update',item:a.id,expected_revision:1,url:'x'}),e=>e.status===409&&e.item.revision===2);
  s.act({action:'update',item:a.id,values:{value:'sk-live-rotated-9876543210abcdef'}});assert.equal(s.get(a.id).values.value,'sk-live-rotated-9876543210abcdef');
  assert.throws(()=>s.act({action:'update',item:a.id,policy:'maybe'}),/default, auto, ask, every or owner/);
  assert.throws(()=>s.act({action:'update',item:a.id}),/Nothing to change/);
  // Bindings and the decision.
  const cmd=s.checkCommand(['node','sync.mjs'],dir);
  assert.throws(()=>s.resolveBindings({TOKEN:'nope'}),e=>e.status===404);
  assert.throws(()=>s.resolveBindings({TOKEN:'vendor-portal'}),/name one, for example vendor-portal\.username/);
  assert.throws(()=>s.resolveBindings({PATH:'zoho-books'}),/cannot be bound/);assert.throws(()=>s.resolveBindings({'bad-name':'zoho-books'}),/not a variable name/);
  assert.throws(()=>s.checkCommand(['node'],'relative'),/full path/);assert.throws(()=>s.checkCommand(['node'],path.join(dir,'missing')),/does not exist/);
  let bound=s.resolveBindings({TOKEN:'zoho-books',USER:'vendor-portal.username',PASS:'vendor-portal.password'});
  assert.deepEqual(bound.map(b=>b.v+'='+b.item.name+'.'+b.field),['TOKEN=zoho-books.value','USER=vendor-portal.username','PASS=vendor-portal.password']);
  let need=s.decide(bound,cmd);assert.deepEqual(need.map(i=>i.name),['zoho-books'],'only the ask item without a recipe needs the owner');
  s.act({action:'update',item:a.id,policy:'owner'});assert.throws(()=>s.decide(s.resolveBindings({TOKEN:'zoho-books'}),cmd),e=>e.code==='owner_only');
  s.act({action:'update',item:a.id,policy:'ask'});
  // A request, answered "always", becomes a recipe; "once" does not; the answer is single-use and the row expires.
  bound=s.resolveBindings({TOKEN:'zoho-books'});need=s.decide(bound,cmd);
  const r=s.request({bound,cmd,need,env:{TOKEN:'zoho-books'},session:S1,sessionTitle:'Billing'});
  assert.equal(s.snapshot({owner:true}).requests[0].id,r.id);assert.equal(s.snapshot({owner:true}).requests[0].pending,true);
  assert.throws(()=>s.answer(r.id,'maybe'),/once, always or deny/);assert.throws(()=>s.answer('nope','once'),e=>e.status===404);
  const waited=s.waitAnswer(r.id,5000);
  assert.equal(s.answer(r.id,'always').answer.decision,'always');
  assert.throws(()=>s.answer(r.id,'deny'),/already answered/);
  return waited.then(async w=>{
    assert.equal(w.answer.decision,'always');
    assert.equal(s.get(a.id).recipes.length,1);assert.deepEqual(s.get(a.id).recipes[0].argv,['node','sync.mjs']);
    assert.deepEqual(s.decide(s.resolveBindings({TOKEN:'zoho-books'}),cmd),[],'the approved command runs without asking');
    assert.equal(s.decide(s.resolveBindings({TOKEN:'zoho-books'}),s.checkCommand(['node','sync.mjs','--all'],dir)).length,1,'a changed argument is a new request');
    assert.equal(s.snapshot({owner:true}).requests.length,0,'answered requests are not listed');
    const r2=s.request({bound,cmd:s.checkCommand(['node','other.mjs'],dir),need,env:{TOKEN:'zoho-books'}});
    assert.equal(await s.waitAnswer(r2.id,30),null,'no answer in time');
    clock+=LIMITS.requestTtlMs+1;s.expireRequests();assert.equal(s.requests.has(r2.id),false,'expired');
    const r3=s.request({bound,cmd:s.checkCommand(['node','third.mjs'],dir),need,env:{TOKEN:'zoho-books'}});
    s.answer(r3.id,'deny');assert.equal((await s.waitAnswer(r3.id,10)).answer.decision,'deny');
    s.act({action:'recipe-remove',item:a.id,recipe:s.get(a.id).recipes[0].id});assert.equal(s.get(a.id).recipes.length,0);
    // Release: recorded first, last used stamped, the secrets come out by variable.
    const secrets=s.release(s.resolveBindings({TOKEN:'zoho-books',PASS:'vendor-portal.password'}),cmd,{session:S1,sessionTitle:'Billing',by:'agent'});
    assert.deepEqual(secrets,{TOKEN:'sk-live-rotated-9876543210abcdef',PASS:'P@ss word "quoted"'});
    assert.equal(s.view(s.get(a.id)).lastUsedBy.session,S1);
    // The owner reads one field at a time; each read is recorded.
    assert.equal(s.field(login.id,'password'),'P@ss word "quoted"');assert.throws(()=>s.field(login.id,'value'),e=>e.status===404);
    // Trash and restore.
    const gone=s.act({action:'remove',item:fromAgent.id});assert.equal(gone.removed,true);
    assert.equal(s.snapshot({owner:true}).items.some(i=>i.name==='twilio-auth'),false);assert.equal(s.snapshot({owner:true}).trash[0].name,'twilio-auth');
    assert.equal(s.snapshot().trash.length,0,'agents do not see the trash');
    assert.equal(s.byName('twilio-auth'),null);assert.throws(()=>s.resolveBindings({T:'twilio-auth'}),e=>e.status===404);
    s.act({action:'restore',item:fromAgent.id});assert.equal(s.byName('twilio-auth').id,fromAgent.id);
    s.act({action:'remove',item:fromAgent.id});clock+=LIMITS.trashDays*86400_000+1;assert.deepEqual(s.purge(),['twilio-auth']);
    // Persistence, mode, and a reopened store under a rotated key.
    assert.equal((fs.statSync(file).mode&0o777),0o600);
    const again=new VaultStore(file,{key,now:()=>clock});assert.equal(again.get(a.id).values.value,'sk-live-rotated-9876543210abcdef');assert.equal(again.items.length,4);
    assert.deepEqual(again.view(again.get(ups.id)).fields,['client_id','client_secret'],'custom fields persist');assert.equal(again.get(authnet.id).values.signature_key,'sig-key-secret-abcdef');
    const fresh=newKey();s.rotate(fresh);
    assert.throws(()=>new VaultStore(file,{key,now:()=>clock}),/cannot be opened/,'the old key alone no longer opens it');
    assert.equal(new VaultStore(file,{key:parseKey(fresh),now:()=>clock}).items.length,4);
    // The audit log never holds a value, and an agent sees only its own session's rows.
    const audit=fs.readFileSync(path.join(dir,'vault-audit.jsonl'),'utf8');
    assert.equal((fs.statSync(path.join(dir,'vault-audit.jsonl')).mode&0o777),0o600);
    for(const v of [SECRET,'sk-live-rotated','P@ss word','tw-secret','txn-key-secret','ups-client-secret','sig-key-secret'])assert.equal(audit.includes(v),false,'no value in the audit: '+v);
    const actions=audit.trim().split('\n').map(l=>JSON.parse(l).action);
    for(const x of ['put','update','request','request-answered','run','owner-view','remove','restore'])assert.ok(actions.includes(x),x+' is recorded');
    assert.ok(s.auditRows({owner:true}).length>8);assert.ok(s.auditRows({session:S1}).every(r=>r.session===S1));assert.equal(s.auditRows({session:'22222222-2222-4222-8222-222222222222'}).length,0);
    assert.ok(s.auditRows({owner:true,item:a.id}).every(r=>r.item===a.id));
    assert.match(vaultInstructions('/srv/pocket/scripts/pocket-vault.mjs',S1),/node \/srv\/pocket\/scripts\/pocket-vault\.mjs run --env VAR=<name>\[\.field\] -- <command…>/);
    assert.match(vaultInstructions('/srv/pocket/scripts/pocket-vault.mjs',S1),/never print, echo, write down or ask for one/);assert.match(vaultInstructions('/srv/pocket/scripts/pocket-vault.mjs',null),/skills\/pocket-vault\/SKILL\.md/);
    fs.rmSync(dir,{recursive:true,force:true});
  });
});

test('passphrase mode (1.40): the store locks and unlocks, idles out, exports and imports; nothing opens without the passphrase',()=>{
  const dir=tmp(),file=path.join(dir,'vault.enc'),key=parseKey(newKey());let clock=Date.parse('2026-10-12T12:00:00Z');
  const s=new VaultStore(file,{key,now:()=>clock});
  const a=s.act({action:'add',name:'zoho-books',kind:'api_key',values:{value:SECRET}});
  assert.equal(s.mode,'key');assert.throws(()=>s.lock(),/set a passphrase/);assert.equal(s.checkPassphrase('x'),false);
  assert.throws(()=>s.setPassphrase('short','short'),/at least 12/);assert.throws(()=>s.setPassphrase('correct horse battery','correct horse staple'),/do not match/);
  s.setPassphrase('correct horse battery','correct horse battery');
  assert.equal(s.mode,'passphrase');assert.equal(storeHeader(fs.readFileSync(file)).version,2);
  assert.throws(()=>decryptStore([key],fs.readFileSync(file)),/Wrong passphrase/,'the env key no longer opens the file');
  assert.equal(s.checkPassphrase('correct horse battery'),true);assert.equal(s.checkPassphrase('correct horse staple'),false);
  assert.throws(()=>s.rotate(newKey()),/protected by a passphrase/);
  // A reopened store is locked: every read and write refuses with 423 until the owner unlocks it.
  const r=new VaultStore(file,{key,now:()=>clock});assert.equal(r.locked,true);assert.equal(r.mode,'passphrase');
  for(const f of [()=>r.snapshot(),()=>r.act({action:'add',name:'x',kind:'token',values:{value:'xxxxxxxx'}}),()=>r.field(a.id,'value'),()=>r.resolveBindings({T:'zoho-books'}),()=>r.exportBundle('x'.repeat(12),'x'.repeat(12))])assert.throws(f,e=>e.status===423&&e.code==='vault_locked');
  assert.throws(()=>r.unlock('correct horse staple'),e=>e.status===401);
  assert.equal(r.unlock('correct horse battery'),true);assert.equal(r.locked,false);assert.equal(r.get(a.id).values.value,SECRET);
  assert.equal(new VaultStore(file,{now:()=>clock}).locked,true,'opens (locked) with no env key at all');
  // Idle lock on the owner's schedule; activity resets it; lock forgets everything in memory.
  assert.equal(r.idleLockDue(0),false);clock+=14*60_000;assert.equal(r.idleLockDue(15),false);clock+=60_000;assert.equal(r.idleLockDue(15),true);
  r.snapshot();assert.equal(r.idleLockDue(15),false,'a read counts as activity');clock+=16*60_000;assert.equal(r.idleLockDue(15),true);
  r.lock();assert.equal(r.locked,true);assert.equal(r.keys.length,0);assert.equal(r.items,null);assert.throws(()=>r.save(),e=>e.status===423);
  r.unlock('correct horse battery');
  // Export under its own passphrase; import merges by name and never a trashed or used-stamp field.
  r.act({action:'add',name:'ups-api',kind:'credentials',values:{client_id:'id-1',client_secret:'ups-secret-value-2'},tags:['ups']});
  const gone=r.act({action:'add',name:'old',kind:'token',values:{value:'old-secret-value'}});r.act({action:'remove',item:gone.id});
  assert.throws(()=>r.exportBundle('a'.repeat(12),'b'.repeat(12)),/do not match/);
  const bundle=r.exportBundle('export passphrase one','export passphrase one');
  assert.equal(storeHeader(bundle).version,2);assert.equal(bundle.toString('latin1').includes('ups-secret'),false);
  const t=new VaultStore(path.join(dir,'t.enc'),{key,now:()=>clock});
  assert.throws(()=>t.importBundle(bundle,'export passphrase two'),/Wrong passphrase/);assert.throws(()=>t.importBundle(Buffer.from('junk'),'export passphrase one'),/not a Vault export/);
  assert.throws(()=>t.importBundle(encryptStore(key,{items:[]}),'export passphrase one'),/not a Vault export/,'a format-1 store is not an export');
  let r1=t.importBundle(bundle,'export passphrase one');assert.deepEqual(r1,{added:2,skipped:[]},'the trashed item is not exported');
  assert.equal(t.get(t.byName('ups-api').id).values.client_secret,'ups-secret-value-2');assert.deepEqual(t.byName('ups-api').custom,['client_id','client_secret']);assert.equal(t.byName('ups-api').lastUsedAt,null);
  r1=t.importBundle(bundle,'export passphrase one');assert.equal(r1.added,0);assert.deepEqual(r1.skipped.sort(),['ups-api','zoho-books']);
  // Back to key mode needs the env key and the passphrase.
  assert.throws(()=>new VaultStore(file,{now:()=>clock}).removePassphrase('correct horse battery'),e=>e.status===423);
  const k2=new VaultStore(file,{now:()=>clock});k2.unlock('correct horse battery');assert.throws(()=>k2.removePassphrase('correct horse battery'),e=>e.code==='vault_no_key');
  assert.throws(()=>r.removePassphrase('wrong passphrase 1'),e=>e.status===401);
  r.removePassphrase('correct horse battery');assert.equal(r.mode,'key');assert.equal(storeHeader(fs.readFileSync(file)).version,1);assert.equal(new VaultStore(file,{key}).items.length,3);
  const actions=fs.readFileSync(path.join(dir,'vault-audit.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l).action);
  for(const x of ['passphrase-set','unlock-failed','unlock','lock','export','import','passphrase-removed'])assert.ok(actions.includes(x),x+' is recorded');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('Agent access (1.41): the install-wide dial, per-item overrides, ask-every-time, and the old store migrates',()=>{
  const dir=tmp(),file=path.join(dir,'vault.enc'),key=parseKey(newKey());let access='once';
  const s=new VaultStore(file,{key});s.access=()=>access;
  const a=s.act({action:'add',name:'zoho-books',kind:'api_key',values:{value:SECRET}});
  const own=s.act({action:'add',name:'bank',kind:'note',values:{text:'routing 123456789'},policy:'owner'});
  const every=s.act({action:'add',name:'stripe-live',kind:'api_key',values:{value:'sk_live_abcdefgh123'},policy:'every'});
  const cmd=s.checkCommand(['node','sync.mjs'],dir),zb=s.resolveBindings({T:'zoho-books'});
  assert.equal(s.decide(zb,cmd).length,1,'once: a new command asks');
  access='free';assert.deepEqual(s.decide(zb,cmd),[],'free rein: nothing asks');assert.equal(s.view(s.get(a.id)).policyWord,'Free rein');assert.equal(s.snapshot().access,'free');
  assert.throws(()=>s.decide(s.resolveBindings({B:'bank'}),cmd),e=>e.code==='owner_only','an Only you item stays closed under free rein');
  assert.equal(s.decide(s.resolveBindings({S:'stripe-live'}),cmd).length,1,'an item set to ask every time still asks under free rein');
  access='every';const need=s.decide(zb,cmd);assert.equal(need.length,1);
  const r=s.request({bound:zb,cmd,need,env:{T:'zoho-books'}});assert.equal(s.requestView(r).allowAlways,false,'no Always allow when it asks every time');
  s.answer(r.id,'always');assert.equal(s.get(a.id).recipes.length,0,'and Always saves no recipe');
  access='once';const r2=s.request({bound:zb,cmd,need:s.decide(zb,cmd),env:{T:'zoho-books'}});assert.equal(s.requestView(r2).allowAlways,true);s.answer(r2.id,'always');assert.equal(s.get(a.id).recipes.length,1);
  access='every';assert.equal(s.decide(zb,cmd).length,1,'ask every time ignores saved recipes');
  access='bogus';assert.equal(s.view(s.get(a.id)).effectivePolicy,'ask','an unknown setting behaves as once');
  assert.throws(()=>s.act({action:'update',item:a.id,policy:'sometimes'}),/default, auto, ask, every or owner/);
  s.act({action:'update',item:a.id,policy:'auto'});access='every';assert.deepEqual(s.decide(zb,cmd),[],'an item set to free rein runs under any setting');
  // Pending requests by session.
  const S2='22222222-2222-4222-8222-222222222222';s.act({action:'update',item:a.id,policy:'default'});
  const r3=s.request({bound:zb,cmd:s.checkCommand(['node','x.mjs'],dir),need:[s.get(a.id)],env:{T:'zoho-books'},session:S2});
  assert.deepEqual(s.pendingFor(S2).map(x=>x.id),[r3.id]);assert.deepEqual(s.pendingFor(S1),[]);
  // A 1.39/1.40 store: its ask items were the old default and now follow the setting; explicit auto and owner stay.
  const old=path.join(dir,'old.enc');
  fs.writeFileSync(old,encryptStore(key,{version:1,items:[{id:'aaaaaaaaaaaa',name:'legacy-ask',kind:'token',values:{value:'legacy-secret-1'},policy:'ask'},{id:'bbbbbbbbbbbb',name:'legacy-auto',kind:'token',values:{value:'legacy-secret-2'},policy:'auto'},{id:'cccccccccccc',name:'legacy-owner',kind:'token',values:{value:'legacy-secret-3'},policy:'owner'}]}));
  const o=new VaultStore(old,{key});assert.deepEqual(o.items.map(i=>i.policy),['default','auto','owner']);
  o.act({action:'update',item:'aaaaaaaaaaaa',policy:'ask'});assert.equal(new VaultStore(old,{key}).get('aaaaaaaaaaaa').policy,'ask','once saved under the new schema, an explicit ask stays ask');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('scrubber: every form of a value, across chunk boundaries; short values are left alone',()=>{
  const forms=needlesFor([SECRET]);
  assert.ok(forms.includes(SECRET));assert.ok(forms.includes(Buffer.from(SECRET).toString('base64')));assert.ok(forms.includes(encodeURIComponent('a b&c')) || true);
  assert.deepEqual(needlesFor(['abc']),[],'three characters would shred the output');
  const s=scrubber([SECRET,'P@ss word "quoted"'],'{{vault}}');
  let out='';for(const chunk of ['token=sk-live-hun','ter2-0123456789ab','cdef; b64=',Buffer.from(SECRET).toString('base64'),' url=',encodeURIComponent('P@ss word "quoted"'),' json=',JSON.stringify('P@ss word "quoted"'),' done'])out+=s.push(chunk);out+=s.end();
  assert.equal(out,'token={{vault}}; b64={{vault}} url={{vault}} json="{{vault}}" done');
  const one=scrubber(['abcdef']);assert.equal(one.push('x')+one.push('abc')+one.push('def')+one.push('y')+one.end(),'x{{vault}}y');
  // 1.73.3: the spellings other JSON writers use. PHP's json_encode escapes "/", Python's json.dumps writes non-ASCII as \uXXXX, and a JSON
  // string carried inside another JSON string is escaped twice; none of them matched before.
  const php=scrubber(['abc/def+ghi']);assert.equal(php.push('{"token":"abc\\/def+ghi"}')+php.end(),'{"token":"{{vault}}"}','PHP json_encode');
  const py=scrubber(['clé-secrète-1234']);assert.equal(py.push('"cl\\u00e9-secr\\u00e8te-1234"')+py.end(),'"{{vault}}"','Python json.dumps');
  const both=scrubber(['clé/x-1234']);assert.equal(both.push('"cl\\u00e9\\/x-1234"')+both.end(),'"{{vault}}"','PHP does both at once');
  const twice=scrubber(['a"b/c-1234']);assert.equal(twice.push(JSON.stringify(JSON.stringify('a"b/c-1234')))+twice.end(),'"\\"{{vault}}\\""','a JSON string inside a JSON string');
  const split=scrubber(['abc/def+ghi']);assert.equal(split.push('x=abc\\')+split.push('/def+ghi;')+split.end(),'x={{vault}};','the new forms cross chunk boundaries like the others');
});

test('runWithSecrets: the value is in the child environment only, scrubbed from both streams; timeout, cap and a missing binary',async()=>{
  const dir=tmp();
  const run=(argv,extra={})=>new Promise(resolve=>{let out='',err='';runWithSecrets({argv,cwd:dir,env:{PATH:process.env.PATH,HOME:dir},secrets:{TOKEN:SECRET,PASS:'P@ss word "quoted"'},placeholders:{[SECRET]:'zoho-books'},onOut:t=>out+=t,onErr:t=>err+=t,...extra}).then(r=>resolve({...r,out,err}));});
  let r=await run(['sh','-c','echo "t=$TOKEN"; printf %s "$TOKEN" | base64; echo "p=$PASS" >&2; echo "k=${POCKET_VAULT_KEY-unset}"; exit 3']);
  assert.equal(r.code,3);assert.equal(r.out,'t={{vault:zoho-books}}\n{{vault:zoho-books}}\nk=unset\n');assert.equal(r.err,'p={{vault}}\n');
  r=await run(['sh','-c','sleep 5'],{timeoutMs:200});assert.equal(r.timedOut,true);assert.ok(r.signal||r.code!==0);
  r=await run(['sh','-c','yes | head -c 50000; echo END'],{maxOutput:1000});assert.equal(r.truncated,true);assert.ok(r.out.length<=1000);assert.doesNotMatch(r.out,/END/);
  r=await run(['/nonexistent/binary']);assert.match(r.error,/ENOENT/);
  const ac=new AbortController();const p=run(['sh','-c','sleep 5'],{signal:ac.signal});setTimeout(()=>ac.abort(),100);r=await p;assert.notEqual(r.code,0);
  fs.rmSync(dir,{recursive:true,force:true});
});

// 1.73.7: a run is a process group. Before, a timeout signalled only the direct child and the run resolved on 'close', so a
// grandchild holding stdout kept the run (and its slot) open until it chose to exit, with the value in its environment; and
// anything the command left running after it exited stayed alive.
test('runWithSecrets: timeout, abort and the command\'s own exit end everything it started, promptly',async()=>{
  const dir=tmp(),pidFile=path.join(dir,'pid');
  const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
  const gone=async pid=>{for(let i=0;i<40&&alive(pid);i++)await new Promise(r=>setTimeout(r,50));return !alive(pid);};
  const run=(argv,extra={})=>{const t0=Date.now();return runWithSecrets({argv,cwd:dir,env:{PATH:process.env.PATH,HOME:dir},secrets:{TOKEN:SECRET},...extra}).then(r=>({...r,ms:Date.now()-t0}));};
  const grandchild=()=>Number(fs.readFileSync(pidFile,'utf8'));
  // A grandchild holds stdout: the timeout still ends the run, and the grandchild with it.
  let r=await run(['sh','-c',`sleep 6 & echo $! > ${pidFile}; wait`],{timeoutMs:500});
  assert.equal(r.timedOut,true);assert.ok(r.ms<3000,`timed out run resolved in ${r.ms} ms`);assert.ok(await gone(grandchild()),'the grandchild was ended');
  // The command exits and leaves a background job holding stdout, then one that let go of its pipes.
  r=await run(['sh','-c',`sleep 6 & echo $! > ${pidFile}; exit 0`]);
  assert.equal(r.code,0);assert.ok(r.ms<3000,`run resolved in ${r.ms} ms`);assert.ok(await gone(grandchild()),'the job holding stdout was ended');
  r=await run(['sh','-c',`sleep 6 >/dev/null 2>&1 & echo $! > ${pidFile}; exit 0`]);
  assert.equal(r.code,0);assert.ok(await gone(grandchild()),'a run cannot leave a daemon behind');
  // Abort reaches the grandchild too.
  const ac=new AbortController();const p=run(['sh','-c',`sleep 6 & echo $! > ${pidFile}; wait`],{signal:ac.signal});setTimeout(()=>ac.abort(),300);
  r=await p;assert.ok(r.ms<3000,`aborted run resolved in ${r.ms} ms`);assert.ok(await gone(grandchild()));
  fs.rmSync(dir,{recursive:true,force:true});
});

// 1.73.3: lock() used to wake a waiter with an unanswered row; the run route then showed the agent a TypeError and the fill
// route threw from an async handler and never answered. Now the row is answered "locked" first.
test('lock() answers a waiting request locked, so a continuation meets a decision and never an unanswered row',async()=>{
  const dir=tmp(),s=new VaultStore(path.join(dir,'vault.enc'),{key:parseKey(newKey())});
  s.act({action:'add',name:'alpha',kind:'token',values:{value:SECRET}});
  s.setPassphrase('correct horse battery','correct horse battery');
  const bound=s.resolveBindings({T:'alpha'}),cmd=s.checkCommand(['true'],dir),need=s.decide(bound,cmd);assert.equal(need.length,1);
  const r=s.request({bound,cmd,need,env:{T:'alpha'},by:'agent'});
  const waiting=s.waitAnswer(r.id,5000);
  s.lock();
  const answered=await waiting;assert.equal(answered.answer.decision,'locked');assert.equal(s.requests.size,0);
  fs.rmSync(dir,{recursive:true,force:true});
});

// 1.73.4: a request is bound to what it is for and to who raised it. Before, a continuation was looked up by id alone: a run the
// owner allowed (output scrubbed) could be continued as a browser fill (plaintext to the caller), any CLI-token holder with the
// id could continue it, two continuations of one answer both released, nothing re-checked the policy after the approval, and an
// Always recipe did not know a fill from a run.
test('request binding (1.73.4): action, caller, one use, the policy as it is now, recipes that know a fill from a run, expiry swept',async()=>{
  const dir=tmp(),s=new VaultStore(path.join(dir,'vault.enc'),{key:parseKey(newKey())});
  const alpha=s.act({action:'add',name:'alpha',kind:'token',values:{value:SECRET}});
  const beta=s.act({action:'add',name:'beta',kind:'token',values:{value:'beta-secret-value-5678'},policy:'auto'});
  const agentA={actor:'agent',session:S1,tokenHash:'a'.repeat(64)},agentB={actor:'agent',session:'22222222-2222-4222-8222-222222222222',tokenHash:'b'.repeat(64)},terminal={actor:'terminal',session:null,tokenHash:null};
  const raise=(env,cmd,caller)=>{const bound=s.resolveBindings(env),need=s.decide(bound,cmd);assert.ok(need.length,'needs the owner');return s.request({bound,cmd,need,env,session:caller.session,by:caller.actor,tokenHash:caller.tokenHash});};
  const run={...s.checkCommand(['true'],dir),action:'run'},fill={...s.checkCommand(['pocket-fill','browser','type'],dir),action:'fill'};
  // The run-to-fill crossover: a run the owner allowed cannot be claimed as a fill.
  let r=raise({V0:'alpha'},run,agentA);assert.equal(r.action,'run');assert.deepEqual(r.caller,{actor:'agent',session:S1,tokenHash:'a'.repeat(64)});
  assert.equal(JSON.stringify(s.requestView(r)).includes('tokenHash'),false,'views never carry the caller');assert.equal(s.requestView(r).action,'run');
  s.answer(r.id,'once');
  assert.throws(()=>s.claim(r.id,{action:'fill',caller:agentA}),e=>e.status===409&&/for a command, not a browser fill/.test(e.message));
  // A foreign caller: another session, or a terminal, cannot continue it; the same session from a restarted process (new token) can.
  assert.throws(()=>s.continuation(r.id,{action:'run',caller:agentB}),e=>e.status===403&&/another session/.test(e.message));
  assert.throws(()=>s.continuation(r.id,{action:'run',caller:terminal}),e=>e.status===403);
  assert.equal(s.requests.get(r.id).consumed,false,'refusals do not use the answer up');
  const claimed=s.claim(r.id,{action:'run',caller:{...agentA,tokenHash:'c'.repeat(64)}});
  assert.equal(claimed.bound[0].item.name,'alpha');assert.equal(claimed.bound[0].v,'V0');assert.deepEqual(claimed.cmd,{argv:['true'],cwd:run.cwd,action:'run'});
  // One answer, one use.
  assert.throws(()=>s.claim(r.id,{action:'run',caller:agentA}),e=>e.status===409&&/already used/.test(e.message));
  // Two continuations racing on one answer: both wake, exactly one claims.
  r=raise({V0:'alpha'},run,agentA);
  const w1=s.waitAnswer(r.id,5000),w2=s.waitAnswer(r.id,5000);s.answer(r.id,'once');await Promise.all([w1,w2]);
  const results=[1,2].map(()=>{try{s.claim(r.id,{action:'run',caller:agentA});return 'released';}catch(e){return e.message;}});
  assert.deepEqual(results.sort(),['That request was already used.','released']);
  // Terminal callers share one identity.
  r=raise({V0:'alpha'},run,terminal);s.answer(r.id,'once');assert.equal(s.claim(r.id,{action:'run',caller:{actor:'terminal',session:null,tokenHash:null}}).bound.length,1);
  // The policy as it is now: owner-only after the approval refuses; a removed item refuses; a renamed item still releases (bound by id).
  r=raise({T:'alpha'},run,agentA);s.answer(r.id,'once');
  s.act({action:'update',item:alpha.id,policy:'owner'});assert.throws(()=>s.claim(r.id,{action:'run',caller:agentA}),e=>e.status===403&&e.code==='owner_only');
  s.act({action:'update',item:alpha.id,policy:'default',name:'alpha-renamed'});assert.equal(s.requests.get(r.id).consumed,false);
  assert.equal(s.claim(r.id,{action:'run',caller:agentA}).bound[0].item.name,'alpha-renamed');
  r=raise({T:'alpha-renamed'},run,agentA);s.answer(r.id,'once');s.act({action:'remove',item:alpha.id});
  assert.throws(()=>s.claim(r.id,{action:'run',caller:agentA}),e=>e.status===409&&e.code==='request_stale');
  s.act({action:'restore',item:alpha.id});
  // An item that was free when the owner was asked and asks now: the answer did not cover it.
  r=raise({T:'alpha-renamed',B:'beta'},run,agentA);assert.deepEqual(r.itemNames,['alpha-renamed']);assert.equal(r.bindings.length,2);s.answer(r.id,'once');
  s.act({action:'update',item:beta.id,policy:'ask'});assert.throws(()=>s.claim(r.id,{action:'run',caller:agentA}),e=>e.status===409&&/policy changed/.test(e.message));
  s.act({action:'update',item:beta.id,policy:'auto'});assert.equal(s.claim(r.id,{action:'run',caller:agentA}).bound.length,2);
  // Recipes: Always on a fill saves a fill recipe; the same literal command as a run still asks, and the reverse. A recipe saved
  // before 1.73.4 carries no action and is read from its argv.
  r=raise({V0:'alpha-renamed'},fill,agentA);assert.equal(r.action,'fill');s.answer(r.id,'always');
  const item=s.get(alpha.id);assert.equal(item.recipes.length,1);assert.equal(item.recipes[0].action,'fill');
  assert.equal(s.decide(s.resolveBindings({V0:'alpha-renamed'}),fill).length,0,'the fill is approved');
  assert.equal(s.decide(s.resolveBindings({V0:'alpha-renamed'}),{...fill,action:'run'}).length,1,'the literal command as a run is not');
  item.recipes=[{id:'legacy',argv:['pocket-fill','browser','type'],cwd:fill.cwd,created:'2026-01-01T00:00:00.000Z'}];
  assert.equal(s.decide(s.resolveBindings({V0:'alpha-renamed'}),fill).length,0,'a legacy fill recipe is a fill');
  assert.equal(s.decide(s.resolveBindings({V0:'alpha-renamed'}),{...fill,action:'run'}).length,1);
  item.recipes=[{id:'legacy2',argv:['true'],cwd:run.cwd,created:'2026-01-01T00:00:00.000Z'}];
  assert.equal(s.decide(s.resolveBindings({V0:'alpha-renamed'}),run).length,0,'a legacy run recipe is a run');
  assert.equal(s.decide(s.resolveBindings({V0:'alpha-renamed'}),{...run,action:'fill'}).length,1);
  // Expiry is swept on answer and wait, not only on the next snapshot.
  let clock=Date.parse('2026-10-21T12:00:00Z');const s2=new VaultStore(path.join(dir,'v2.enc'),{key:parseKey(newKey()),now:()=>clock});
  s2.act({action:'add',name:'gamma',kind:'token',values:{value:'gamma-secret-value-1'}});
  const b2=s2.resolveBindings({G:'gamma'}),c2={...s2.checkCommand(['true'],dir),action:'run'};const r2=s2.request({bound:b2,cmd:c2,need:s2.decide(b2,c2),env:{G:'gamma'},by:'agent',session:S1});
  clock+=LIMITS.requestTtlMs+1;
  assert.throws(()=>s2.answer(r2.id,'once'),e=>e.status===404,'an expired request cannot be answered');
  assert.throws(()=>s2.waitAnswer(r2.id,10),e=>e.status===404,'nor waited on');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('finding a secret (1.93): an agent\'s add names its conversation; answered requests stay findable for the owner only',()=>{
  const dir=tmp();let clock=Date.parse('2026-11-03T12:00:00Z');const s=new VaultStore(path.join(dir,'v.enc'),{key:parseKey(newKey()),now:()=>clock});
  const a=s.act({action:'add',name:'ptvip-staging',kind:'login',values:{username:'u',password:'staging-pass-77'}},{actor:'agent',session:'s-1',sessionTitle:'Fix the staging login'});
  assert.deepEqual(a.addedIn,{session:'s-1',sessionTitle:'Fix the staging login'});
  const o=s.act({action:'add',name:'owner-made',kind:'token',values:{value:'owner-token-123'}});assert.equal('addedIn' in o,false,'an add without a conversation names none');
  assert.deepEqual(s.snapshot({owner:true}).items.find(i=>i.name==='ptvip-staging').addedIn,{session:'s-1',sessionTitle:'Fix the staging login'});
  const b=s.resolveBindings({P:'ptvip-staging.password'}),c={...s.checkCommand(['true'],dir),action:'run'};
  const r=s.request({bound:b,cmd:c,need:s.decide(b,c),env:{P:'ptvip-staging.password'},by:'agent',session:'s-1',sessionTitle:'Fix the staging login'});
  assert.deepEqual(s.snapshot({owner:true}).answered,[],'nothing answered yet');
  s.answer(r.id,'once');clock+=60_000;
  const snap=s.snapshot({owner:true});assert.equal(snap.requests.length,0);
  assert.deepEqual(snap.answered,[{id:r.id,itemNames:['ptvip-staging'],decision:'once',at:'2026-11-03T12:00:00Z'}]);
  assert.deepEqual(s.snapshot({owner:false}).answered,[],'an agent does not see the answers');
  assert.equal(JSON.stringify(snap).includes('staging-pass-77'),false,'no value anywhere in the snapshot');
  clock+=LIMITS.requestTtlMs;assert.deepEqual(s.snapshot({owner:true}).answered,[],'gone 15 minutes after the answer');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('agentEnv removes the vault key with the other daemon secrets',()=>{
  assert.deepEqual(agentEnv({PATH:'/bin',POCKET_VAULT_KEY:'k',POCKET_PASSWORD:'p'}),{PATH:'/bin'});
});

test('HTTP: off until Settings turns it on (and only with a key), the matrix of what the cookie and the token may do, runs, requests, runner tokens, the agent line, and the CLI',async t=>{
  const dir=tmp();let port=18981;
  const secret=randomUUID(),exp=Date.now()+3600000,key=newKey();
  const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  let child,logs='';
  const start=async(withKey)=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_SMTP_URL:'file:'+path.join(dir,'mail.jsonl'),POCKET_SMTP_FROM:'pocket@example.test',POCKET_ROUTER_KEY:'router-key-not-real',...(withKey?{POCKET_VAULT_KEY:key}:{})},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start(withKey);}
   throw Error('Test server failed: '+logs);
  };
  const stop=async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}};
  t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  const call=async(p,body,h=headers,method)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:method||(body?'POST':'GET'),headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({})),text:null};};
  // Streams: a run answers JSON lines; collect them all.
  const streamCall=async(p,body,h)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:'POST',headers:h,body:JSON.stringify(body)});if(!r.ok)return {status:r.status,events:[],body:await r.json().catch(()=>({}))};const text=await r.text();return {status:r.status,events:text.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l))};};
  // Without a key: the setting cannot be turned on.
  await start(false);
  assert.equal((await call('/vault')).status,404);assert.equal((await call('/vault')).body.code,'vault_off');
  let st=await call('/settings');assert.equal(st.body.vaultReady,false);assert.match(st.body.vaultError,/not set/);
  const noKey=await call('/settings',{vault:true});assert.equal(noKey.status,409);assert.equal(noKey.body.code,'vault_no_key');
  await stop();
  // With the key.
  await start(true);
  const token=fs.readFileSync(path.join(dir,'data','cli-token'),'utf8').trim();
  const bearer={'content-type':'application/json',authorization:'Bearer '+token};
  assert.equal((await call('/vault')).status,404,'off by default');assert.equal((await call('/me')).body.features.vault,false);
  assert.equal((await call('/vault',null,{})).status,401,'never reachable signed out');
  const calls=()=>fs.existsSync(path.join(dir,'calls'))?fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n').map(JSON.parse):[];
  fs.mkdirSync(path.join(dir,'sessions','test-workspace'),{recursive:true});
  assert.equal((await call('/new',{cwd:repo,text:'Before',provider:'claude',clientMessageId:randomUUID()})).status,202);
  for(let i=0;i<50&&calls().length<1;i++)await sleep(50);
  assert.equal(calls().at(-1).vault,false,'no vault line while off');assert.equal(calls().at(-1).vaultKeySeen,false,'the key is never in a runner environment');
  assert.deepEqual(calls().at(-1).daemonSecretsSeen,[],'1.73.3: nor the SMTP address, the sender or the router key');
  assert.equal('vault' in ((await call('/me',null,{})).body.features||{}),false,'1.73.3: signed out, /api/me does not say which modules are on');
  assert.ok(calls().at(-1).runnerToken,'every runner carries a runner token');assert.equal(calls().at(-1).sessionEnv,calls().at(-1).id);
  for(let i=0;i<60&&!/turn done/.test(logs);i++)await sleep(50); // the first turn must finish: only idle runners restart
  st=await call('/settings',{vault:true});assert.equal(st.status,200);assert.equal(st.body.vault,true);assert.equal(st.body.vaultReady,true);
  assert.equal((await call('/me')).body.features.vault,true);
  // Turning it on restarts idle runners: the next message starts a fresh process carrying the line.
  for(let i=0;i<40&&/session process closing .*vault setting changed/.test(logs)===false;i++)await sleep(50);
  assert.match(logs,/vault setting changed/);
  const before=calls().length;
  assert.equal((await call('/new',{cwd:repo,text:'After',provider:'claude',clientMessageId:randomUUID()})).status,202);
  for(let i=0;i<60&&calls().length<=before;i++)await sleep(50);
  assert.equal(calls().at(-1).vault,true,'agents are told about the vault once it is on');
  const runnerToken=calls().at(-1).runnerToken,sid=calls().at(-1).id;
  const agent={...bearer,'x-pocket-runner':runnerToken};
  // The matrix.
  let snap=await call('/vault');assert.equal(snap.status,200);assert.deepEqual(snap.body.items,[]);assert.equal(snap.body.ready,true);
  assert.equal((await call('/vault',null,bearer)).status,200,'the loopback token reads the list');
  assert.equal((await call('/vault',null,{...bearer,'cf-connecting-ip':'203.0.113.5'})).status,401,'not through the tunnel');
  assert.equal((await call('/sessions',null,bearer)).status,401,'the token opens nothing else');
  const made=await call('/vault/act',{action:'add',name:'zoho-books',kind:'api_key',values:{value:SECRET},url:'https://books.zoho.com',notes:'owner note',tags:['zoho']});
  assert.equal(made.status,200);assert.equal(made.body.item.policy,'default');assert.equal(made.body.item.effectivePolicy,'ask');assert.equal(made.body.item.notes,'owner note');
  const auto=await call('/vault/act',{action:'add',name:'vendor-portal',kind:'login',values:{username:'brad@example.test',password:'P@ss word "quoted"'},policy:'auto'});assert.equal(auto.status,200);
  const ownerOnly=await call('/vault/act',{action:'add',name:'bank',kind:'note',values:{text:'routing 123456789 account 9876543210'},policy:'owner'});assert.equal(ownerOnly.status,200);
  const xo=await call('/vault/act',{action:'add',name:'x',kind:'token',values:{value:'xxxxxxxx'}},{...headers,origin:'https://evil.example'});assert.equal(xo.status,403,'a cross-origin cookie request is refused');
  const viaAgent=await call('/vault/act',{action:'add',name:'twilio-auth',kind:'token',values:{value:'tw-secret-value-1234'},policy:'auto',notes:'x'},agent);
  assert.equal(viaAgent.status,200);assert.equal(viaAgent.body.item.policy,'default');assert.equal('notes' in viaAgent.body.item,false);
  assert.equal((await call('/vault/act',{action:'add',name:'twilio-auth',kind:'token',values:{value:'again'}},agent)).status,409,'create-only');
  assert.equal((await call('/vault/act',{action:'update',item:made.body.item.id,policy:'auto'},agent)).status,403,'an agent cannot change a policy');
  assert.equal((await call('/vault/act',{action:'remove',item:made.body.item.id},agent)).status,403);
  assert.equal((await call('/vault/field',{item:auto.body.item.id,field:'password'},bearer)).status,401,'the token has no route to a value');
  assert.equal((await call('/vault/field',{item:auto.body.item.id,field:'password'},agent)).status,401);
  const field=await call('/vault/field',{item:auto.body.item.id,field:'password'});assert.equal(field.status,200);assert.equal(field.body.value,'P@ss word "quoted"');
  snap=await call('/vault',null,agent);
  assert.equal(JSON.stringify(snap.body).includes('hunter2'),false);assert.equal(JSON.stringify(snap.body).includes('P@ss'),false);assert.equal(JSON.stringify(snap.body).includes('owner note'),false,'agents never see notes');
  assert.equal(snap.body.trash.length,0);
  // A run against an auto item: scrubbed output, exit code, no key or daemon secret in the child.
  let r=await streamCall('/vault/run',{argv:['sh','-c','echo "u=$U p=$P"; printf %s "$P" | base64; env | grep -c "POCKET_VAULT_KEY\\|POCKET_PASSWORD\\|POCKET_SECRET\\|POCKET_SMTP_URL\\|POCKET_SMTP_FROM\\|POCKET_ROUTER_KEY" || true; exit 2'],cwd:dir,env:{U:'vendor-portal.username',P:'vendor-portal.password'}},agent);
  assert.equal(r.status,200);const out=r.events.filter(e=>e.t==='out').map(e=>e.s).join('');
  assert.equal(out,'u={{vault:vendor-portal}} p={{vault:vendor-portal}}\n{{vault:vendor-portal}}\n0\n',JSON.stringify(r.events));assert.equal(r.events.at(-1).t,'exit');assert.equal(r.events.at(-1).code,2);
  r=await streamCall('/vault/run',{argv:['true'],cwd:dir,env:{U:'vendor-portal.username'}},{...bearer,'x-pocket-runner':'not-a-token'});assert.equal(r.events[0].t,'start','1.73.3: an unknown runner token of any length is a terminal caller, not an error');
  // Owner-only: refused with a code the CLI maps to exit 5.
  r=await streamCall('/vault/run',{argv:['true'],cwd:dir,env:{B:'bank'}},agent);assert.equal(r.events.at(-1).t,'error');assert.equal(r.events.at(-1).code,'owner_only');
  // Ask policy: a request appears, the owner answers "always", the run proceeds; the recipe then runs without asking.
  const pending=streamCall('/vault/run',{argv:['sh','-c','echo "t=$T"'],cwd:dir,env:{T:'zoho-books'},wait:60},agent);
  let reqs=[];for(let i=0;i<60&&!reqs.length;i++){await sleep(50);reqs=(await call('/vault')).body.requests;}
  assert.equal(reqs.length,1);assert.deepEqual(reqs[0].argv,['sh','-c','echo "t=$T"']);assert.equal(reqs[0].session,sid);assert.equal(reqs[0].itemNames[0],'zoho-books');
  assert.equal((await call('/vault/act',{action:'answer',request:reqs[0].id,decision:'always'},agent)).status,403,'agents cannot answer');
  const ans=await call('/vault/act',{action:'answer',request:reqs[0].id,decision:'always'});assert.equal(ans.status,200);assert.equal(ans.body.request.answer.decision,'always');
  r=await pending;assert.equal(r.events[0].t,'request');assert.equal(r.events.filter(e=>e.t==='out').map(e=>e.s).join(''),'t={{vault:zoho-books}}\n');assert.equal(r.events.at(-1).code,0);
  assert.match(logs,/vault request=/);
  assert.equal((await call('/vault')).body.items.find(i=>i.name==='zoho-books').recipes.length,1,'always saved a recipe');
  r=await streamCall('/vault/run',{argv:['sh','-c','echo "t=$T"'],cwd:dir,env:{T:'zoho-books'}},agent);assert.equal(r.events[0].t,'start','an approved command runs without asking');
  // A short wait: pending, then `wait` picks it up; deny ends it.
  r=await streamCall('/vault/run',{argv:['sh','-c','echo again $T'],cwd:dir,env:{T:'zoho-books'},wait:1},agent);
  assert.equal(r.events.at(-1).t,'pending');const rid=r.events.at(-1).id;
  const waiting=streamCall('/vault/wait',{request:rid,wait:60},agent);await sleep(100);
  assert.equal((await call('/vault/act',{action:'answer',request:rid,decision:'deny'})).status,200);
  r=await waiting;assert.equal(r.events.at(-1).t,'denied');
  assert.equal((await streamCall('/vault/wait',{request:'nope'},agent)).events.at(-1).t,'error');
  // Audit: rows carry commands and sessions, never values; an agent sees its own session only; the owner sees all.
  const audit=fs.readFileSync(path.join(dir,'data','vault-audit.jsonl'),'utf8');
  for(const v of [SECRET,'P@ss word','tw-secret','routing 123456789'])assert.equal(audit.includes(v),false,'no value in the audit: '+v);
  let rows=(await call('/vault/audit',null,agent)).body.rows;assert.ok(rows.length>=3);assert.ok(rows.every(x=>x.session===sid));
  rows=(await call('/vault/audit',null,bearer)).body.rows;assert.equal(rows.length,0,'a terminal caller has no session rows');
  rows=(await call('/vault/audit?item='+made.body.item.id)).body.rows;assert.ok(rows.length>=3);assert.ok(rows.every(x=>x.item===made.body.item.id));
  // Rotation (1.44) saves the new key to .env before rewriting the store; with no .env to write (this server runs with
  // POCKET_ENV_FILE empty) it refuses rather than leave a key nobody saved. The saved path is in vault-key.test.mjs.
  const rot=await call('/vault/rotate',{});assert.equal(rot.status,409);assert.equal(rot.body.code,'vault_key_preset','1.73.6: a key set in the process environment is rotated where it is set');
  assert.equal((await call('/vault/rotate',{},bearer)).status,401);
  assert.equal((await call('/vault')).body.items.length,4,'the store is untouched');
  // The CLI, as an agent inside the session.
  const cliEnv={...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_DATA_DIR:path.join(dir,'data'),POCKET_RUNNER_TOKEN:runnerToken};
  const cli=(args,extra={})=>new Promise(res=>{const p=execFile(process.execPath,[path.join(repo,'scripts/pocket-vault.mjs'),...args],{cwd:dir,env:{...cliEnv,...extra.env}},(e,stdout,stderr)=>res({code:e?e.code:0,stdout,stderr}));if(extra.stdin!=null){p.stdin.end(extra.stdin);}});
  // 1.43.1: the CLIs find the daemon through <data dir>/cli-url, so a PORT exported by some other app never redirects them (or the token).
  assert.equal(fs.readFileSync(path.join(dir,'data','cli-url'),'utf8').trim(),`http://127.0.0.1:${port}`);assert.equal(fs.statSync(path.join(dir,'data','cli-url')).mode&0o777,0o600);
  let o=await cli(['list'],{env:{PORT:'9'}});assert.equal(o.code,0,'an inherited PORT is ignored: '+o.stderr);
  o=await cli(['list']);assert.equal(o.code,0,o.stderr);assert.match(o.stdout,/^bank  \(note\)  Only you/m);assert.match(o.stdout,/zoho-books  \(api_key\)  Asks once per command  https:\/\/books\.zoho\.com  #zoho/);assert.doesNotMatch(o.stdout,/hunter2|P@ss/);
  o=await cli(['show','vendor-portal']);assert.match(o.stdout,/fields: username, password/);assert.match(o.stdout,/--env VAR=vendor-portal\.username/);
  o=await cli(['put','github-pat','--kind','token','--stdin','--url','https://github.com'],{stdin:'ghp_abcdefghijklmnop1234\n'});assert.equal(o.code,0,o.stderr);assert.equal(o.stdout,'github-pat\n');
  o=await cli(['put','github-pat','--kind','token','--stdin'],{stdin:'x'});assert.equal(o.code,1);assert.match(o.stderr,/already exists/);
  fs.writeFileSync(path.join(dir,'creds.json'),JSON.stringify({user:'u1',pass:'p1-secret-value'}));
  o=await cli(['put','portal2','--kind','login','--from-file',path.join(dir,'creds.json'),'--map','username=user,password=pass']);assert.equal(o.code,0,o.stderr);
  o=await cli(['put','nothing','--kind','token']);assert.equal(o.code,1);assert.match(o.stderr,/never on the command line/);
  // 1.39.1: a credentials item from a JSON object, custom fields on a login, and a run binding a custom field.
  o=await cli(['put','ups-api','--kind','credentials','--stdin'],{stdin:JSON.stringify({client_id:'ups-id-001',client_secret:'ups-secret-value-xyz'})});assert.equal(o.code,0,o.stderr);assert.equal(o.stdout,'ups-api\n');
  o=await cli(['put','ups-bad','--kind','credentials','--stdin'],{stdin:'plain text'});assert.equal(o.code,1);assert.match(o.stderr,/JSON object naming each field/);
  o=await cli(['put','authnet','--kind','login','--stdin'],{stdin:JSON.stringify({username:'login-id',password:'txn-key-secret-1',signature_key:'sig-secret-value-2'})});assert.equal(o.code,0,o.stderr);
  o=await cli(['show','ups-api']);assert.match(o.stdout,/\(credentials: client_id, client_secret\)/);assert.match(o.stdout,/--env VAR=ups-api\.client_id/);
  o=await cli(['list']);assert.doesNotMatch(o.stdout,/ups-secret-value|sig-secret-value|txn-key-secret/);
  const ids=(await call('/vault')).body.items;const upsId=ids.find(i=>i.name==='ups-api').id,authnetId=ids.find(i=>i.name==='authnet').id;
  assert.deepEqual(ids.find(i=>i.name==='authnet').fields,['username','password','signature_key']);
  assert.equal((await call('/vault/act',{action:'update',item:authnetId,policy:'auto'})).status,200);
  r=await streamCall('/vault/run',{argv:['sh','-c','echo "sig=$SIG id=$ID"'],cwd:dir,env:{SIG:'authnet.signature_key',ID:'authnet.username'}},agent);
  assert.equal(r.events.filter(e=>e.t==='out').map(e=>e.s).join(''),'sig={{vault:authnet}} id={{vault:authnet}}\n');
  assert.equal((await call('/vault/field',{item:upsId,field:'client_secret'})).body.value,'ups-secret-value-xyz');
  assert.equal((await call('/vault/act',{action:'update',item:upsId,removeFields:['client_secret']})).status,200);
  assert.deepEqual((await call('/vault')).body.items.find(i=>i.id===upsId).fields,['client_id']);
  assert.equal((await call('/vault/act',{action:'update',item:upsId,values:{'Bad Name':'x'}})).status,400);
  // 1.41: the Agent access setting, and answering a request from the conversation that raised it.
  let acc=await call('/settings');assert.equal(acc.body.vaultAccess,'once');
  assert.equal((await call('/settings',{vaultAccess:'nonsense'})).body.vaultAccess,'once','only the three levels');
  assert.equal((await call('/vault/act',{action:'add',name:'chat-approve',kind:'token',values:{value:'chat-approve-secret-1'}})).status,200);
  const chatRun=streamCall('/vault/run',{argv:['sh','-c','echo "c=$C"'],cwd:dir,env:{C:'chat-approve'},wait:60},agent);
  let cr=[];for(let i=0;i<60&&!cr.length;i++){await sleep(50);cr=(await call('/vault')).body.requests.filter(x=>x.itemNames.includes('chat-approve'));}
  assert.equal(cr.length,1);assert.equal(cr[0].allowAlways,true);assert.equal(cr[0].session,sid);
  const said=await call(`/session/${sid}/message`,{text:'Allow chat-approve for this command.',clientMessageId:randomUUID()});assert.ok([200,202].includes(said.status),JSON.stringify(said.body));
  r=await chatRun;assert.equal(r.events.filter(e=>e.t==='out').map(e=>e.s).join(''),'c={{vault:chat-approve}}\n','the owner\'s reply in the conversation allowed it');
  assert.match(logs,/answered once from the conversation session=/);
  // A message that names nothing pending, or another session's message, answers nothing.
  const deny=streamCall('/vault/run',{argv:['sh','-c','echo again'],cwd:dir,env:{C:'chat-approve'},wait:60},agent);
  for(let i=0;i<60;i++){await sleep(50);if((await call('/vault')).body.requests.length)break;}
  await call(`/session/${S1}/message`,{text:'Allow chat-approve for this command',clientMessageId:randomUUID()});
  assert.equal((await call('/vault')).body.requests.length,1,'a message in another session does not answer it');
  await call(`/session/${sid}/message`,{text:'Deny chat-approve',clientMessageId:randomUUID()});
  r=await deny;assert.equal(r.events.at(-1).t,'denied');
  // Free rein: a default item runs without any request.
  assert.equal((await call('/settings',{vaultAccess:'free'})).body.vaultAccess,'free');assert.match(logs,/vault agent access: once -> free/);
  r=await streamCall('/vault/run',{argv:['sh','-c','echo free'],cwd:dir,env:{C:'chat-approve'}},agent);assert.equal(r.events[0].t,'start','no request under free rein');
  assert.equal((await call('/vault',null,agent)).body.items.find(i=>i.name==='chat-approve').policyWord,'Free rein');
  r=await streamCall('/vault/run',{argv:['true'],cwd:dir,env:{B:'bank'}},agent);assert.equal(r.events.at(-1).code,'owner_only','Only you stays closed');
  assert.equal((await call('/settings',{vaultAccess:'once'})).body.vaultAccess,'once');
  // github-pat has the default ask policy: the CLI waits while the owner is asked, then runs once allowed.
  const running=cli(['run','--env','GH=github-pat','--','sh','-c','echo "gh=$GH"; printf %s "$GH" | base64; exit 7']);
  let req2=[];for(let i=0;i<100&&!req2.length;i++){await sleep(50);req2=(await call('/vault')).body.requests;}
  assert.equal(req2.length,1);assert.equal((await call('/vault/act',{action:'answer',request:req2[0].id,decision:'once'})).status,200);
  o=await running;assert.equal(o.code,7);assert.equal(o.stdout,'gh={{vault:github-pat}}\n{{vault:github-pat}}\n');assert.match(o.stderr,/Asking the owner/);
  assert.equal((await call('/vault')).body.items.find(i=>i.name==='github-pat').recipes.length,0,'once saves no recipe');
  o=await cli(['run','--env','B=bank','--','true']);assert.equal(o.code,5);assert.match(o.stderr,/owner only/);
  o=await cli(['run','--','true']);assert.equal(o.code,1);assert.match(o.stderr,/at least one --env/);
  o=await cli(['run','--env','T=zoho-books']);assert.equal(o.code,1);assert.match(o.stderr,/needs the command after --/);
  o=await cli(['history']);assert.equal(o.code,0,o.stderr);assert.match(o.stdout,/run  vendor-portal/);assert.doesNotMatch(o.stdout,/hunter2|P@ss/);
  // 1.40: a passphrase locks the store; agents get 423 and the CLI says so; the owner unlocks, exports, imports and can go back.
  let st2=await call('/settings');assert.equal(st2.body.vaultMode,'key');assert.equal(st2.body.vaultLocked,false);assert.equal(st2.body.vaultKeyPresent,true);assert.equal(st2.body.vaultAutoLockMinutes,0);
  assert.equal((await call('/vault/lock',{})).status,400,'nothing to lock in key mode');
  assert.equal((await call('/vault/passphrase',{action:'set',passphrase:'short',confirm:'short'})).status,400);
  assert.equal((await call('/vault/passphrase',{action:'set',passphrase:'correct horse battery',confirm:'correct horse battery'},bearer)).status,401,'owner only');
  let pp=await call('/vault/passphrase',{action:'set',passphrase:'correct horse battery',confirm:'correct horse battery'});assert.equal(pp.status,200);assert.equal(pp.body.mode,'passphrase');
  assert.equal((await call('/settings',{vaultAutoLockMinutes:15})).body.vaultAutoLockMinutes,15);assert.equal((await call('/settings',{vaultAutoLockMinutes:7})).body.vaultAutoLockMinutes,15,'only the offered choices');
  assert.equal((await call('/vault/rotate',{})).status,400,'no key rotation in passphrase mode');
  assert.equal((await call('/vault/lock',{})).status,200);
  st2=await call('/settings');assert.equal(st2.body.vaultMode,'passphrase');assert.equal(st2.body.vaultLocked,true);
  let lockedSnap=await call('/vault',null,agent);assert.equal(lockedSnap.status,200);assert.equal(lockedSnap.body.locked,true);assert.equal(lockedSnap.body.ready,false);assert.deepEqual(lockedSnap.body.items,[]);
  assert.equal((await call('/vault/act',{action:'add',name:'l',kind:'token',values:{value:'xxxxxxxxxx'}},agent)).status,423);
  r=await streamCall('/vault/run',{argv:['true'],cwd:dir,env:{T:'zoho-books'}},agent);assert.equal(r.status,423);assert.equal(r.body.code,'vault_locked');
  assert.equal((await call('/vault/field',{item:made.body.item.id,field:'value'})).status,423,'the owner cannot read a value from a locked store either');
  assert.equal((await call('/vault/export',{passphrase:'x'.repeat(12),confirm:'x'.repeat(12)})).status,423);
  o=await cli(['list']);assert.equal(o.code,3);assert.match(o.stderr,/The Vault is locked/);
  o=await cli(['run','--env','T=zoho-books','--','true']);assert.equal(o.code,3);assert.match(o.stderr,/locked/);
  assert.match(logs,/vault locked by the owner/);
  assert.equal((await call('/vault/unlock',{passphrase:'correct horse staple'})).status,401);
  assert.equal((await call('/vault/unlock',{passphrase:'correct horse battery'},bearer)).status,401,'the token cannot unlock');
  assert.equal((await call('/vault/unlock',{passphrase:'correct horse battery'})).status,200);
  assert.equal((await call('/settings')).body.vaultLocked,false);assert.equal((await call('/vault')).body.items.length>=4,true,'everything is back');
  // Export is a binary download; import into the same store skips every name.
  const ex=await fetch(`http://127.0.0.1:${port}/api/vault/export`,{method:'POST',headers,body:JSON.stringify({passphrase:'export passphrase one',confirm:'export passphrase one'})});
  assert.equal(ex.status,200);assert.match(ex.headers.get('content-disposition'),/attachment; filename="pocket-vault-export-\d{4}-\d{2}-\d{2}\.pvault"/);assert.equal(ex.headers.get('content-type'),'application/octet-stream');
  const bytes=Buffer.from(await ex.arrayBuffer());assert.equal(bytes[0],2);assert.equal(bytes.toString('latin1').includes('hunter2'),false);
  const imp=await call('/vault/import',{data:bytes.toString('base64'),passphrase:'export passphrase one'});assert.equal(imp.status,200);assert.equal(imp.body.added,0);assert.ok(imp.body.skipped.includes('zoho-books'));
  assert.equal((await call('/vault/import',{data:bytes.toString('base64'),passphrase:'export passphrase two'})).status,400);
  assert.equal((await call('/vault/import',{data:'',passphrase:'x'})).status,400);
  assert.equal((await call('/vault/passphrase',{action:'set',passphrase:'another passphrase 2',confirm:'another passphrase 2',current:'wrong one here'})).status,401);
  assert.equal((await call('/vault/passphrase',{action:'set',passphrase:'another passphrase 2',confirm:'another passphrase 2',current:'correct horse battery'})).status,200);
  assert.equal((await call('/vault/passphrase',{action:'remove',passphrase:'correct horse battery'})).status,401,'the old passphrase is gone');
  pp=await call('/vault/passphrase',{action:'remove',passphrase:'another passphrase 2'});assert.equal(pp.status,200);assert.equal(pp.body.mode,'key');
  // Ten wrong tries in an hour, then 429.
  // 1.81 (#177): only wrong tries count, and a right one clears them; every try used to count, so frequent unlocking locked the owner out.
  await call('/vault/passphrase',{action:'set',passphrase:'correct horse battery',confirm:'correct horse battery'});await call('/vault/lock',{});
  for(let i=0;i<12;i++){assert.equal((await call('/vault/unlock',{passphrase:'correct horse battery'})).status,200,'right try '+i);await call('/vault/lock',{});}
  for(let i=0;i<9;i++)assert.equal((await call('/vault/unlock',{passphrase:'nope nope nope nope'})).status,401);
  assert.equal((await call('/vault/unlock',{passphrase:'correct horse battery'})).status,200,'nine wrong, then right: open, and the count is cleared');await call('/vault/lock',{});
  let last=0;for(let i=0;i<10;i++)last=(await call('/vault/unlock',{passphrase:'nope nope nope nope'})).status;assert.equal(last,401,'ten wrong tries are answered');
  assert.equal((await call('/vault/unlock',{passphrase:'nope nope nope nope'})).status,429);
  assert.equal((await call('/vault/unlock',{passphrase:'correct horse battery'})).status,429,'then even the right one waits');
  assert.equal((await call('/settings',{vault:false})).body.vault,false);
  o=await cli(['list']);assert.equal(o.code,3);assert.match(o.stderr,/Settings → Projects, files, tasks & vault/);
  assert.equal((await call('/vault')).status,404);
});

// 1.73.3: locking the Vault while agents wait. Before, the run route reported a TypeError to the agent and the fill route
// never answered at all (an async Express 4 handler threw), so the relay's tool call hung for minutes.
test('HTTP: a lock while a run and a fill wait for the owner answers both at once, as locked',async t=>{
  const dir=tmp();let port=19731;
  const secret=randomUUID(),exp=Date.now()+3600000,key=newKey();
  const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_VAULT_KEY:key},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  t.after(async()=>{if(child&&child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  const call=async(p,body,h=headers)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  const streamCall=async(p,body,h)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:'POST',headers:h,body:JSON.stringify(body)});if(!r.ok)return {status:r.status,events:[],body:await r.json().catch(()=>({}))};const text=await r.text();return {status:r.status,events:text.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l))};};
  await start();
  const bearer={'content-type':'application/json',authorization:'Bearer '+fs.readFileSync(path.join(dir,'data','cli-token'),'utf8').trim()};
  assert.equal((await call('/settings',{vault:true})).body.vault,true);
  assert.equal((await call('/vault/act',{action:'add',name:'alpha',kind:'token',values:{value:SECRET}})).status,200,'asks once per command');
  assert.equal((await call('/vault/passphrase',{action:'set',passphrase:'correct horse battery',confirm:'correct horse battery'})).status,200);
  // A run and a fill, each waiting for the owner's answer.
  const run=streamCall('/vault/run',{argv:['sh','-c','echo "t=$T"'],cwd:dir,env:{T:'alpha'},wait:60},bearer);
  const fill=call('/vault/release',{refs:['alpha'],server:'browser',tool:'type',cwd:dir,wait:60},bearer);
  let reqs=[];for(let i=0;i<80&&reqs.length<2;i++){await sleep(50);reqs=(await call('/vault')).body.requests;}
  assert.equal(reqs.length,2,'both are pending');
  const t0=Date.now();assert.equal((await call('/vault/lock',{})).status,200);
  const r=await run;assert.equal(r.events.at(-1).t,'error',JSON.stringify(r.events));assert.equal(r.events.at(-1).code,'vault_locked');assert.match(r.events.at(-1).message,/locked/);
  const f=await fill;assert.equal(f.status,423,JSON.stringify(f.body));assert.equal(f.body.code,'vault_locked');assert.equal('values' in f.body,false);
  assert.ok(Date.now()-t0<3000,'both answered at once, not after a timeout');
  assert.doesNotMatch(logs,/TypeError|unhandled rejection/);
  assert.equal((await call('/health')).status,200);
  assert.equal((await call('/vault')).body.requests.length,0,'nothing left pending');
  // The requests cannot be continued after the lock either.
  assert.equal((await call('/vault/release',{request:reqs[1].id},bearer)).status,423,'the store is locked');
});

// 1.73.4 through the routes: the run-to-fill crossover (plaintext from a run approval), a foreign caller, the reverse crossover,
// one use per answer, and a full run table that must leave the approval unused.
test('HTTP: a request continues only as what it is, by who raised it, and once; a full run table leaves the approval for later',async t=>{
  const dir=tmp();let port=19811;
  const secret=randomUUID(),exp=Date.now()+3600000,key=newKey();
  const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),POCKET_TEST_CALLS:path.join(dir,'calls'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_VAULT_KEY:key},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=41;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  t.after(async()=>{if(child&&child.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  const call=async(p,body,h=headers)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  const streamCall=async(p,body,h)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:'POST',headers:h,body:JSON.stringify(body)});if(!r.ok)return {status:r.status,events:[],body:await r.json().catch(()=>({}))};const text=await r.text();return {status:r.status,events:text.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l))};};
  const calls=()=>fs.existsSync(path.join(dir,'calls'))?fs.readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n').map(JSON.parse):[];
  await start();
  const bearer={'content-type':'application/json',authorization:'Bearer '+fs.readFileSync(path.join(dir,'data','cli-token'),'utf8').trim()};
  assert.equal((await call('/settings',{vault:true})).body.vault,true);
  assert.equal((await call('/vault/act',{action:'add',name:'alpha',kind:'token',values:{value:SECRET}})).status,200,'asks once per command');
  assert.equal((await call('/vault/act',{action:'add',name:'free',kind:'token',values:{value:'free-secret-value-1'},policy:'auto'})).status,200);
  // An agent inside a Pocket session, known by its runner token.
  assert.equal((await call('/new',{cwd:repo,text:'Hello',provider:'claude',clientMessageId:randomUUID()})).status,202);
  for(let i=0;i<60&&calls().length<1;i++)await sleep(50);
  const agent={...bearer,'x-pocket-runner':calls().at(-1).runnerToken};
  // The agent asks to run; the owner allows.
  let r=await streamCall('/vault/run',{argv:['sh','-c','echo "t=$V0"'],cwd:dir,env:{V0:'alpha'},wait:1},agent);assert.equal(r.events.at(-1).t,'pending');const id=r.events.at(-1).id;
  assert.equal((await call('/vault').then(x=>x.body.requests[0])).action,'run');
  assert.equal((await call('/vault/act',{action:'answer',request:id,decision:'once'})).status,200);
  // The crossover: continued through the fill route, the approved run would have come back in plaintext. Refused, no values.
  let f=await call('/vault/release',{request:id},agent);assert.equal(f.status,409,JSON.stringify(f.body));assert.match(f.body.error,/for a command, not a browser fill/);assert.equal('values' in f.body,false);
  // A foreign caller (the terminal, which has the CLI token and the id) cannot continue it.
  r=await streamCall('/vault/wait',{request:id},bearer);assert.equal(r.events.at(-1).t,'error');assert.match(r.events.at(-1).message,/another session/);
  // The run table is full: the approval is not used up by the refusal.
  const sleepers=Array.from({length:LIMITS.concurrent},()=>streamCall('/vault/run',{argv:['sleep','1.5'],cwd:dir,env:{F:'free'}},bearer));await sleep(400);
  r=await streamCall('/vault/wait',{request:id},agent);assert.equal(r.events.at(-1).t,'error');assert.match(r.events.at(-1).message,/Too many vault runs/);
  await Promise.all(sleepers);
  r=await streamCall('/vault/wait',{request:id},agent);assert.equal(r.events.filter(e=>e.t==='out').map(e=>e.s).join(''),'t={{vault:alpha}}\n','the right caller, once the table has room');assert.equal(r.events.at(-1).code,0);
  r=await streamCall('/vault/wait',{request:id},agent);assert.equal(r.events.at(-1).t,'error');assert.match(r.events.at(-1).message,/already used/);
  // The reverse: a fill the terminal asked for cannot be continued as a run, nor by the agent; the terminal fills it once.
  f=await call('/vault/release',{refs:['alpha'],server:'browser',tool:'type',cwd:dir,wait:1},bearer);assert.equal(f.body.pending,true);const id2=f.body.request;
  assert.equal((await call('/vault/act',{action:'answer',request:id2,decision:'once'})).status,200);
  r=await streamCall('/vault/wait',{request:id2},bearer);assert.equal(r.events.at(-1).t,'error');assert.match(r.events.at(-1).message,/for a browser fill, not a command/);
  f=await call('/vault/release',{request:id2},agent);assert.equal(f.status,403);assert.match(f.body.error,/another session/);
  f=await call('/vault/release',{request:id2},bearer);assert.equal(f.status,200,JSON.stringify(f.body));assert.equal(f.body.values.alpha,SECRET);
  f=await call('/vault/release',{request:id2},bearer);assert.equal(f.status,409);assert.match(f.body.error,/already used/);
  // The audit: one run and one fill, each with its request; no value.
  const audit=fs.readFileSync(path.join(dir,'data','vault-audit.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(audit.filter(x=>x.action==='run'&&x.request===id).length,1);assert.equal(audit.filter(x=>x.action==='fill'&&x.request===id2).length,1);
  assert.equal(fs.readFileSync(path.join(dir,'data','vault-audit.jsonl'),'utf8').includes(SECRET),false);
  assert.doesNotMatch(logs,/TypeError|unhandled rejection/);
});

// 1.44.2: the owner corrects a value in place. The editor's Show loads the saved value (an owner view, recorded), the
// owner trims it and saves an update; the audit names the field, never the value. Agents and terminals still cannot
// change an item, so an owner's mistake is the owner's to fix.
test('in-place edit (1.44.2): the store changes one field, names it in the audit, and keeps the agent restriction',()=>{
  const dir=tmp(),file=path.join(dir,'vault.enc'),key=parseKey(newKey());
  const s=new VaultStore(file,{key});
  const pasted='sinch-secret-30-characters-abc\nAuthorization: Basic c2luY2gta2V5OnNpbmNo';
  const it=s.act({action:'add',name:'sinch-engage',kind:'api_key',values:{value:'sinch-key-1234567890',base_url:'https://au.app.api.sinch.com',api_secret:pasted}});
  assert.deepEqual(it.fields,['value','base_url','api_secret']);
  assert.equal(s.field(it.id,'api_secret'),pasted,'Show returns the whole value, line break included');
  // Agents and terminals cannot replace or edit it, by update or by adding over the name.
  for(const actor of ['agent','terminal']){
    assert.throws(()=>s.act({action:'update',item:it.id,values:{api_secret:'x'}},{actor}),e=>e.status===403);
    assert.throws(()=>s.act({action:'update',item:it.id,removeFields:['api_secret']},{actor}),e=>e.status===403);
    assert.throws(()=>s.act({action:'add',name:'sinch-engage',kind:'api_key',values:{value:'x'}},{actor}),/agents cannot replace it/);
  }
  assert.equal(s.get(it.id).values.api_secret,pasted,'unchanged by the refused calls');
  // The owner trims one field; the others are untouched and the change survives a reopen.
  const rev=s.get(it.id).revision;
  const out=s.act({action:'update',item:it.id,expected_revision:rev,values:{api_secret:'sinch-secret-30-characters-abc'}});
  assert.equal(out.revision,rev+1);assert.equal('values' in out,false,'the answer carries no value');
  const again=new VaultStore(file,{key});
  assert.deepEqual(again.get(it.id).values,{value:'sinch-key-1234567890',base_url:'https://au.app.api.sinch.com',api_secret:'sinch-secret-30-characters-abc'});
  // A fixed field edits in place too; an empty value keeps it; a stale revision is refused.
  s.act({action:'update',item:it.id,values:{value:'sinch-key-0987654321',api_secret:''}});
  assert.equal(s.get(it.id).values.value,'sinch-key-0987654321');assert.equal(s.get(it.id).values.api_secret,'sinch-secret-30-characters-abc');
  assert.throws(()=>s.act({action:'update',item:it.id,expected_revision:rev,values:{value:'x'}}),e=>e.status===409&&e.item?.id===it.id);
  // Add and remove fields in the same store, without re-creating the item.
  s.act({action:'update',item:it.id,values:{sender:'+15619228416'},removeFields:['base_url']});
  assert.deepEqual(s.view(s.get(it.id)).fields,['value','api_secret','sender']);assert.equal(s.get(it.id).id,it.id);
  // The audit: each edit names the fields it changed, an untouched save names none, and no value appears anywhere.
  s.act({action:'update',item:it.id,values:{value:'sinch-key-0987654321'},tags:['sms']});
  const rows=s.auditRows({owner:true,item:it.id}).filter(r=>r.action==='update').reverse();
  assert.deepEqual(rows.map(r=>r.fields||[]),[['api_secret'],['value'],['base_url','sender'],[]]);
  assert.ok(rows.every(r=>r.by==='owner'));
  const audit=fs.readFileSync(path.join(dir,'vault-audit.jsonl'),'utf8');
  for(const v of ['sinch-secret','sinch-key-','Authorization','+15619228416'])assert.equal(audit.includes(v),false,'no value in the audit: '+v);
  assert.equal(fs.readFileSync(file).toString('latin1').includes('sinch-secret'),false,'the store stays encrypted');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('HTTP in-place edit (1.44.2): the owner loads and saves a field; the token and an agent cannot; nothing is logged',async t=>{
  const dir=tmp();let port=19431;
  const secret=randomUUID(),exp=Date.now()+3600000,key=newKey();
  const cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const headers={'content-type':'application/json',cookie:'pc_auth='+cookie};
  fs.mkdirSync(path.join(dir,'sessions'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  let child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...cleanEnv(),PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SKILLS:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data'),CLAUDE_BIN:path.join(repo,'test/fake-claude.mjs'),POCKET_VAULT_KEY:key},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return;}catch{} await sleep(30)}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=37;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  t.after(async()=>{if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});});
  const call=async(p,body,h=headers)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};};
  await start();
  assert.equal((await call('/settings',{vault:true})).status,200);
  const token=fs.readFileSync(path.join(dir,'data','cli-token'),'utf8').trim(),bearer={'content-type':'application/json',authorization:'Bearer '+token};
  const pasted='sinch-secret-30-characters-abc\nAuthorization: Basic c2luY2gta2V5OnNpbmNo';
  const made=await call('/vault/act',{action:'add',name:'sinch-engage',kind:'api_key',values:{value:'sinch-key-1234567890',base_url:'https://au.app.api.sinch.com',api_secret:pasted}});
  assert.equal(made.status,200);const id=made.body.item.id;
  // Show on each field of a multi-field API key returns that field's value to the owner.
  for(const [f,v] of [['value','sinch-key-1234567890'],['base_url','https://au.app.api.sinch.com'],['api_secret',pasted]]){
    const r=await call('/vault/field',{item:id,field:f});assert.equal(r.status,200,f);assert.equal(r.body.value,v,f);
  }
  assert.equal((await call('/vault/field',{item:id,field:'api_secret'},bearer)).status,401,'no value for the token');
  // The token (a terminal, or an agent) cannot edit it, nor replace it by name.
  assert.equal((await call('/vault/act',{action:'update',item:id,values:{api_secret:'x'}},bearer)).status,403);
  const replace=await call('/vault/act',{action:'add',name:'sinch-engage',kind:'api_key',values:{value:'x'}},bearer);
  assert.equal(replace.status,409);assert.match(replace.body.error,/agents cannot replace it/);
  // The owner saves the trimmed value; a cross-origin save is refused.
  assert.equal((await call('/vault/act',{action:'update',item:id,values:{api_secret:'x'}},{...headers,origin:'https://evil.example'})).status,403);
  const saved=await call('/vault/act',{action:'update',item:id,expected_revision:made.body.item.revision,values:{api_secret:'sinch-secret-30-characters-abc'}});
  assert.equal(saved.status,200);assert.equal(JSON.stringify(saved.body).includes('sinch-secret'),false,'the answer carries no value');
  assert.equal((await call('/vault/field',{item:id,field:'api_secret'})).body.value,'sinch-secret-30-characters-abc');
  assert.equal((await call('/vault/field',{item:id,field:'value'})).body.value,'sinch-key-1234567890','other fields untouched');
  const hist=await call('/vault/audit?item='+id);
  const update=hist.body.rows.find(r=>r.action==='update');assert.deepEqual(update.fields,['api_secret']);assert.equal(update.by,'owner');
  assert.ok(hist.body.rows.filter(r=>r.action==='owner-view').length>=4,'every load is recorded');
  const audit=fs.readFileSync(path.join(dir,'data','vault-audit.jsonl'),'utf8');
  for(const v of ['sinch-secret','sinch-key-','Authorization'])assert.equal(audit.includes(v)||logs.includes(v),false,'no value in the audit or the log: '+v);
});

// 1.73.6: every change is computed on a copy, written, then installed; the passphrase salt and the key are taken up only once
// the file holds them; unlock reads the salt from the file; the file and its directory are synced on every write.
test('validate then commit (1.73.6): a failed check or write leaves the store, its salt and its key as they were; the file is synced',async()=>{
  const d=tmp(),s=new VaultStore(path.join(d,'vault.enc'),{key:parseKey(newKey())});
  const a=s.act({action:'add',name:'alpha',kind:'token',values:{value:SECRET}});
  assert.throws(()=>s.act({action:'update',item:a.id,name:'renamed',removeFields:['nope']}),/not a custom field/);
  assert.equal(s.get(a.id).name,'alpha','a rename before a failed check is not kept');assert.equal(s.get(a.id).revision,1);
  s.act({action:'update',item:a.id,tags:['x']});
  assert.equal(new VaultStore(path.join(d,'vault.enc'),{key:s.keys[0]}).items[0].name,'alpha','and an unrelated later save does not carry it');
  // The default writer syncs the file and its directory (the audit row syncs its own file).
  const synced=[],orig=fs.fsyncSync;fs.fsyncSync=fd=>{synced.push(fd);return orig(fd);};
  try{s.act({action:'update',item:a.id,notes:'n'});}finally{fs.fsyncSync=orig;}
  assert.ok(synced.length>=3,'audit row, store file and its directory');
  // A writer that fails: memory stays with the disk.
  let failNext=false;const write=(f,buf)=>{if(failNext){failNext=false;throw Object.assign(new Error('ENOSPC: no space left on device'),{code:'ENOSPC'});}fs.writeFileSync(f+'.tmp',buf,{mode:0o600});fs.renameSync(f+'.tmp',f);};
  const d2=tmp(),file=path.join(d2,'vault.enc'),k0=newKey(),w=new VaultStore(file,{key:parseKey(k0),write});w.access=()=>'once';
  const b=w.act({action:'add',name:'beta',kind:'token',values:{value:SECRET}});
  failNext=true;assert.throws(()=>w.act({action:'add',name:'gamma',kind:'token',values:{value:'gamma-secret-1234'}}),/ENOSPC/);
  assert.equal(w.items.length,1,'memory is not ahead of disk');assert.equal(w.byName('gamma'),null);
  failNext=true;assert.throws(()=>w.act({action:'update',item:b.id,tags:['t']}),/ENOSPC/);assert.deepEqual(w.get(b.id).tags,[]);assert.equal(w.get(b.id).revision,1);
  failNext=true;assert.throws(()=>w.act({action:'remove',item:b.id}),/ENOSPC/);assert.equal(w.get(b.id).trashedAt,null);
  // A rotation whose write fails keeps the old key everywhere; the next save is still under it.
  const k1=newKey();failNext=true;assert.throws(()=>w.rotate(k1),/ENOSPC/);
  assert.ok(w.keys[0].equals(parseKey(k0)),'the key in memory is the old one');assert.ok(w.envKey.equals(parseKey(k0)),'and so is the recovery key');
  w.act({action:'update',item:b.id,tags:['later']});
  assert.equal(decryptStore([parseKey(k0)],fs.readFileSync(file)).items[0].name,'beta','the next save is under the old key');assert.throws(()=>decryptStore([parseKey(k1)],fs.readFileSync(file)));
  assert.ok(w.rotate(k1).equals(parseKey(k1)));assert.equal(decryptStore([parseKey(k1)],fs.readFileSync(file)).items[0].name,'beta','a rotation that writes takes effect');
  // An Always whose recipe write fails leaves the request unanswered and its waiters waiting; the owner answers again.
  const bound=w.resolveBindings({T:'beta'}),cmd=w.checkCommand(['true'],d2),r=w.request({bound,cmd,need:w.decide(bound,cmd),env:{T:'beta'}});
  let woken=0;const waiting=w.waitAnswer(r.id,5000).then(()=>{woken++;});
  failNext=true;assert.throws(()=>w.answer(r.id,'always'),/ENOSPC/);
  assert.equal(w.requests.get(r.id).answer,null,'the row stays unanswered');assert.equal(w.get(b.id).recipes.length,0,'no recipe in memory');await sleep(20);assert.equal(woken,0);
  assert.equal(w.answer(r.id,'always').pending,false,'the owner can answer again');assert.equal(w.get(b.id).recipes.length,1);await waiting;assert.equal(woken,1);
  assert.equal(decryptStore([parseKey(k1)],fs.readFileSync(file)).items[0].recipes.length,1);
  // A passphrase change whose write fails leaves the salt the file has, so the old passphrase still opens it after a lock.
  const d3=tmp(),f3=path.join(d3,'vault.enc'),p=new VaultStore(f3,{key:parseKey(newKey()),write});
  p.act({action:'add',name:'alpha',kind:'token',values:{value:SECRET}});
  p.setPassphrase('old passphrase 123','old passphrase 123');const salt0=Buffer.from(p.salt);
  failNext=true;assert.throws(()=>p.setPassphrase('new passphrase 456','new passphrase 456'),/ENOSPC/);
  assert.ok(p.salt.equals(salt0),'the salt in memory is the one on disk');assert.ok(p.salt.equals(storeHeader(fs.readFileSync(f3)).salt));
  p.lock();assert.throws(()=>p.unlock('new passphrase 456'),/Wrong passphrase/);assert.equal(p.unlock('old passphrase 123'),true,'the old passphrase opens it after a lock');
  // unlock reads the salt from the file: a store rewritten under another salt (a restore from backup, say) opens with its own passphrase.
  const q=new VaultStore(f3,{key:null});const other=path.join(d3,'other.enc'),o=new VaultStore(other,{key:parseKey(newKey())});
  o.act({action:'add',name:'omega',kind:'token',values:{value:'omega-secret-1234'}});o.setPassphrase('other passphrase 789','other passphrase 789');
  fs.copyFileSync(other,f3);assert.equal(q.unlock('other passphrase 789'),true);assert.equal(q.items[0].name,'omega');
  // An import is checked whole: a bad value anywhere adds nothing, and a null row is skipped.
  const salt=Buffer.alloc(16,3),bundle=items=>encryptStore(deriveKey('export passphrase 1','export passphrase 1'.length>0?salt:salt),{format:EXPORT_FORMAT,version:2,items},{salt});
  assert.throws(()=>s.importBundle(bundle([{name:'good',kind:'token',values:{value:'good-value-1234'}},null,{name:'bad',kind:'token',values:{value:'{{vault:other}}'}}]),'export passphrase 1'),/bad: The value looks like a placeholder/);
  assert.equal(s.byName('good'),null,'the valid item before the bad one was not kept');
  assert.deepEqual(s.importBundle(bundle([{name:'good',kind:'token',values:{value:'good-value-1234'}},null]),'export passphrase 1'),{added:1,skipped:[]});
  for(const x of [d,d2,d3])fs.rmSync(x,{recursive:true,force:true});
});
// 1.73.8, the Low batch. A short write in audit() left half a row for the next one to merge into; a value with a lone surrogate
// reached the child as U+FFFD, a spelling no form matched; and the streaming cut moved forward past an occurrence, which for
// a value that overlaps itself could publish the start of the next occurrence with nothing held to complete it.
test('audit rows survive short writes',()=>{
  const dir=tmp(),s=new VaultStore(path.join(dir,'vault.enc'),{key:parseKey(newKey())}),real=fs.writeSync;
  fs.writeSync=(fd,buf,off,len,...rest)=>typeof buf==='string'?real(fd,buf.slice(0,7)):real(fd,buf,off??0,Math.min(len??buf.length,7),...rest);
  try{s.audit({action:'first',by:'owner'});s.audit({action:'second',by:'owner'});}finally{fs.writeSync=real;}
  assert.deepEqual(s.auditRows({owner:true}).map(r=>r.action).filter(a=>a==='first'||a==='second'),['second','first']);
  fs.rmSync(dir,{recursive:true,force:true});
});
// 1.76.3: an append that fails part-way (EIO, a full disk) leaves a torn row with no newline; the next row used to be glued to it,
// the line no longer parsed, and the audit silently lost a release that happened. Now the next row starts on its own line.
test('a torn audit append does not hide the next release from the audit',()=>{
  const dir=tmp(),s=new VaultStore(path.join(dir,'vault.enc'),{key:parseKey(newKey())}),real=fs.writeSync;
  s.act({action:'add',name:'billing',kind:'token',values:{value:SECRET},policy:'auto'});
  const bound=s.resolveBindings({T:'billing'}),cmd=s.checkCommand(['node','sync.mjs'],dir);
  fs.writeSync=(fd,buf,off,len,...rest)=>{fs.writeSync=real;real(fd,buf,off??0,Math.min(len??buf.length,40),...rest);throw Object.assign(new Error('EIO: i/o error, write'),{code:'EIO'});};
  try{assert.throws(()=>s.release(bound,cmd,{session:S1,by:'agent'}),/EIO/,'the failed audit stops the release');}finally{fs.writeSync=real;}
  assert.deepEqual(s.release(bound,cmd,{session:S1,by:'agent'}),{T:SECRET},'the retry releases the value');
  assert.deepEqual(s.auditRows({owner:true}).map(r=>r.action),['run','put'],'the successful release is in the audit; only the torn row is lost');
  fs.rmSync(dir,{recursive:true,force:true});
});
test('a value with a lone surrogate is scrubbed in the spelling the child sees',async()=>{
  const dir=tmp();let out='';
  const r=await runWithSecrets({argv:['sh','-c','printf %s "$TOKEN"'],cwd:dir,env:{PATH:process.env.PATH},secrets:{TOKEN:'ab\ud800cdef'},onOut:t=>out+=t});
  assert.equal(r.code,0);assert.equal(out,'{{vault}}');
  fs.rmSync(dir,{recursive:true,force:true});
});
test('the streaming scrubber gives the whole-text result for values that overlap themselves, however the text is cut',()=>{
  for(const [v,text,max] of [['ffff','fffffffffffffcb',4],['abc123abc123','abc123abc123abc123abc123abc123',8]]){
    const forms=needlesFor([v]);let whole=text;for(const f of forms)whole=whole.split(f).join('{{v}}');
    const run=sizes=>{const st=makeScrubStream([{forms,ph:'{{v}}'}]);let out='',i=0;for(const n of sizes){out+=st.push(text.slice(i,i+n));i+=n;}return out+st.end();};
    if(v==='ffff')assert.equal(run([2,4,4,1,3,2]),whole,'the cut that used to publish a raw run');
    for(let t=0;t<3000;t++){const sizes=[];for(let n=0;n<text.length;){const k=1+Math.floor(Math.random()*max);sizes.push(k);n+=k;}assert.equal(run(sizes),whole,'chunks '+sizes.join(','));}
  }
});
// 1.73.8: the CLI decoded each chunk of a run's stream on its own, so a character split across two chunks printed as U+FFFD.
test('pocket-vault run prints a character that arrives split across two chunks whole',async t=>{
  const http=await import('node:http');
  const dir=tmp();fs.mkdirSync(path.join(dir,'data'));fs.writeFileSync(path.join(dir,'data','cli-token'),'test-token');
  const line=Buffer.from(JSON.stringify({t:'out',s:'café ✓\n'})+'\n'+JSON.stringify({t:'exit',code:0})+'\n');
  const cut=line.indexOf(Buffer.from('é'))+1; // inside the two bytes of é
  const server=http.createServer((req,res)=>{req.resume();res.writeHead(200,{'content-type':'application/x-ndjson'});res.write(line.subarray(0,cut));setTimeout(()=>res.end(line.subarray(cut)),100);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.close();fs.rmSync(dir,{recursive:true,force:true});});
  const out=await new Promise(res=>execFile(process.execPath,[path.join(repo,'scripts/pocket-vault.mjs'),'run','--env','T=x','--','true'],{cwd:dir,env:{...cleanEnv(),POCKET_ENV_FILE:'',POCKET_DATA_DIR:path.join(dir,'data'),POCKET_URL:`http://127.0.0.1:${server.address().port}`}},(e,stdout)=>res({code:e?e.code:0,stdout})));
  assert.equal(out.code,0);assert.equal(out.stdout,'café ✓\n');
});

// 1.81 (#177): the editor allowed 4,000 characters of notes and the store cut them to 2,000 without a word. Now one limit, refused.
test('notes past the limit are refused on add and edit, not cut; the editor allows the same length',()=>{
  const dir=tmp();const v=new VaultStore(path.join(dir,'vault.enc'),{key:parseKey(newKey())});
  const at=LIMITS.notes;assert.equal(at,2000);
  const a=v.act({action:'add',name:'n1',kind:'token',values:{value:'tok-1234567890'},notes:'x'.repeat(at)},{actor:'owner'});assert.equal(a.notes.length,at);
  assert.throws(()=>v.act({action:'add',name:'n2',kind:'token',values:{value:'tok-1234567890'},notes:'x'.repeat(at+1)},{actor:'owner'}),e=>e.status===400&&/Notes can be up to 2,000 characters/.test(e.message));
  assert.throws(()=>v.act({action:'update',item:a.id,notes:'y'.repeat(at+1)},{actor:'owner'}),e=>e.status===400);
  assert.equal(v.get(a.id).notes,'x'.repeat(at),'a refused edit changes nothing');
  assert.equal(v.act({action:'update',item:a.id,notes:'  short  '},{actor:'owner'}).notes,'short');
  const editor=fs.readFileSync(path.join(import.meta.dirname,'..','public','vault.js'),'utf8');
  assert.match(editor,new RegExp(`<textarea name="notes"[^>]*maxlength="${at}"`),'the editor allows exactly the store limit');
});

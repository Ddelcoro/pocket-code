import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {syncSkills,renderSkill,skillRoots,MARKER,googleInstructions,manualInstructions,SKILLS} from '../skills.mjs';
import {projectInstructions} from '../projects.mjs';
import {documentInstructions} from '../documents.mjs';

const repo=path.resolve(import.meta.dirname,'..');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pocket-skills-'));
const commands={board:'/srv/pocket/scripts/pocket-board.mjs',docs:'/srv/pocket/scripts/pocket-docs.mjs',tasks:'/srv/pocket/scripts/pocket-tasks.mjs',vault:'/srv/pocket/scripts/pocket-vault.mjs',coord:'/srv/pocket/scripts/pocket-coord.mjs'};

test('skills: installed while the feature is on, rewritten with this server\'s command, removed when off, never over a user\'s own skill',t=>{
  const ours=r=>({...r,installed:r.installed.filter(d=>!d.endsWith('pocket-google'))}); // pocket-google is always on (own test)
  const dir=tmp();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const claude=path.join(dir,'claude'),codex=path.join(dir,'codex'),roots=[claude,codex],env={};
  let r=ours(syncSkills({settings:{projects:true,documents:false},commands,env,roots}));
  assert.deepEqual(r.installed.sort(),[path.join(claude,'pocket-projects'),path.join(codex,'pocket-projects')].sort());
  const body=fs.readFileSync(path.join(claude,'pocket-projects','SKILL.md'),'utf8');
  assert.match(body,/^---\nname: pocket-projects\n/);
  assert.match(body,/run `pocket-board` as `node \/srv\/pocket\/scripts\/pocket-board\.mjs`/);
  assert.doesNotMatch(body,/npx pocket-board/,'the repository wording is replaced');
  assert.ok(fs.existsSync(path.join(claude,'pocket-projects',MARKER)));
  assert.equal(fs.existsSync(path.join(claude,'pocket-files')),false);
  // Unchanged content is not rewritten; turning Files on adds its skill.
  assert.deepEqual(syncSkills({settings:{projects:true},commands,env,roots}).installed,[]);
  r=ours(syncSkills({settings:{projects:true,documents:true},commands,env,roots}));
  assert.equal(r.installed.length,2);
  assert.match(fs.readFileSync(path.join(codex,'pocket-files','SKILL.md'),'utf8'),/my documents/);
  // 1.36: Tasks brings pocket-tasks, named for this server's command.
  r=ours(syncSkills({settings:{projects:true,documents:true,tasks:true},commands,env,roots}));
  assert.deepEqual(r.installed.sort(),[path.join(claude,'pocket-tasks'),path.join(codex,'pocket-tasks')].sort());
  assert.match(fs.readFileSync(path.join(claude,'pocket-tasks','SKILL.md'),'utf8'),/run `pocket-tasks` as `node \/srv\/pocket\/scripts\/pocket-tasks\.mjs`/);
  syncSkills({settings:{projects:true,documents:true,tasks:false},commands,env,roots});assert.equal(fs.existsSync(path.join(claude,'pocket-tasks')),false);
  // 1.39: the Vault brings pocket-vault.
  r=ours(syncSkills({settings:{projects:true,documents:true,vault:true},commands,env,roots}));
  assert.deepEqual(r.installed.sort(),[path.join(claude,'pocket-vault'),path.join(codex,'pocket-vault')].sort());
  assert.match(fs.readFileSync(path.join(claude,'pocket-vault','SKILL.md'),'utf8'),/run `pocket-vault` as `node \/srv\/pocket\/scripts\/pocket-vault\.mjs`/);
  syncSkills({settings:{projects:true,documents:true,vault:false},commands,env,roots});assert.equal(fs.existsSync(path.join(claude,'pocket-vault')),false);
  // A user's own skill with the same name is left alone, both ways.
  fs.rmSync(path.join(codex,'pocket-files'),{recursive:true});fs.mkdirSync(path.join(codex,'pocket-files'));fs.writeFileSync(path.join(codex,'pocket-files','SKILL.md'),'mine');
  r=syncSkills({settings:{projects:true,documents:true},commands,env,roots});
  assert.deepEqual(r.skipped,[path.join(codex,'pocket-files')]);
  syncSkills({settings:{projects:false,documents:false},commands,env,roots});
  assert.equal(fs.readFileSync(path.join(codex,'pocket-files','SKILL.md'),'utf8'),'mine');
  assert.equal(fs.existsSync(path.join(claude,'pocket-projects')),false);
  assert.equal(fs.existsSync(path.join(claude,'pocket-files')),false);
  // POCKET_SKILLS=0 does nothing at all.
  assert.deepEqual(syncSkills({settings:{projects:true,documents:true},commands,env:{POCKET_SKILLS:'0'},roots}),{installed:[],removed:[],skipped:[]});
  assert.equal(fs.existsSync(path.join(claude,'pocket-projects')),false);
});

test('skills: pocket-coord is installed only while Coordination is on, with this server\'s command',t=>{
  const dir=tmp();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const claude=path.join(dir,'claude'),codex=path.join(dir,'codex'),roots=[claude,codex],env={};
  assert.equal(syncSkills({settings:{},commands,env,roots}).installed.some(d=>d.endsWith('pocket-coord')),false);
  const r=syncSkills({settings:{coordination:true},commands,env,roots});
  assert.deepEqual(r.installed.filter(d=>d.endsWith('pocket-coord')).sort(),[path.join(claude,'pocket-coord'),path.join(codex,'pocket-coord')].sort());
  assert.match(fs.readFileSync(path.join(claude,'pocket-coord','SKILL.md'),'utf8'),/run `pocket-coord` as `node \/srv\/pocket\/scripts\/pocket-coord\.mjs`/);
  syncSkills({settings:{coordination:false},commands,env,roots});assert.equal(fs.existsSync(path.join(claude,'pocket-coord')),false);
});

test('skills: pocket-google is always on, with Claude\'s connector file for Claude Code and the apps file for Codex; a user\'s own skill is left alone',t=>{
  const dir=tmp();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const claude=path.join(dir,'claude'),codex=path.join(dir,'codex'),roots=[claude,codex],env={};
  let r=syncSkills({settings:{},commands,env,roots,codexRoots:[codex]});
  assert.deepEqual(r.installed.sort(),[path.join(claude,'pocket-google'),path.join(codex,'pocket-google')].sort());
  const cl=fs.readFileSync(path.join(claude,'pocket-google','SKILL.md'),'utf8'),cx=fs.readFileSync(path.join(codex,'pocket-google','SKILL.md'),'utf8');
  for(const body of [cl,cx]){
    assert.match(body,/^---\nname: pocket-google\n/);
    assert.match(body,/Draft by default/);
    assert.match(body,/Never refuse to send/);
    assert.match(body,/never ask the person to share their files with that other account/);
  }
  assert.match(cl,/mcp__claude_ai_Gmail__/);assert.match(cl,/`send_message` and its `draftId`/);assert.match(cl,/includeSignature: true/);
  assert.doesNotMatch(cl,/codex_apps|send_draft/,'Claude\'s file names only Claude\'s tools');
  assert.match(cx,/Codex apps/);assert.match(cx,/send_draft/);assert.match(cx,/get_profile/);
  assert.doesNotMatch(cx,/mcp__claude_ai_/,'Codex\'s file names only the Codex apps');
  assert.ok(fs.existsSync(path.join(codex,'pocket-google',MARKER)));
  // Nothing changes on a second run.
  assert.deepEqual(syncSkills({settings:{},commands,env,roots,codexRoots:[codex]}).installed,[]);
  // A user's own pocket-google is never touched.
  fs.rmSync(path.join(codex,'pocket-google'),{recursive:true});fs.mkdirSync(path.join(codex,'pocket-google'));fs.writeFileSync(path.join(codex,'pocket-google','SKILL.md'),'mine');
  r=syncSkills({settings:{},commands,env,roots,codexRoots:[codex]});
  assert.deepEqual(r.skipped,[path.join(codex,'pocket-google')]);
  assert.equal(fs.readFileSync(path.join(codex,'pocket-google','SKILL.md'),'utf8'),'mine');
  assert.deepEqual(syncSkills({settings:{},commands,env:{POCKET_SKILLS:'0'},roots,codexRoots:[codex]}).installed,[]);
});

test('skills: the per-turn Google line points each agent at its own pocket-google file, and that file exists',()=>{
  for(const [agent,file,via] of [['claude','SKILL.claude.md','Claude connectors'],['codex','SKILL.codex.md','Codex apps']]){
    const line=googleInstructions(agent);
    const m=line.match(/`([^`]+pocket-google[^`]+)`/);assert.ok(m,'names the skill file');
    assert.equal(path.basename(m[1]),file);assert.ok(fs.existsSync(m[1]),'the path is the repository copy, readable without an installed skill');
    assert.ok(line.includes(via));assert.match(line,/Settings → Connectors/);
    assert.match(line,/draft and show it first/);assert.match(line,/never refuse a send/);assert.match(line,/whose Google account/);
  }
  assert.doesNotMatch(googleInstructions('claude'),/SKILL\.codex\.md/);
});

test('skills: roots follow HOME, CLAUDE_CONFIG_DIR and CODEX_HOME; Codex only where it exists',()=>{
  const dir=tmp();
  try{
   assert.deepEqual(skillRoots({HOME:dir}),[path.join(dir,'.claude','skills')]);
   fs.mkdirSync(path.join(dir,'.codex'));
   assert.deepEqual(skillRoots({HOME:dir}),[path.join(dir,'.claude','skills'),path.join(dir,'.codex','skills')]);
   assert.deepEqual(skillRoots({HOME:dir,CLAUDE_CONFIG_DIR:path.join(dir,'cc'),CODEX_HOME:path.join(dir,'none')}),[path.join(dir,'cc','skills')]);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('skills and agent lines: every name for the library maps to Files; projects ask little and remind only on request',()=>{
  const files=fs.readFileSync(path.join(repo,'skills','pocket-files','SKILL.md'),'utf8'),projects=fs.readFileSync(path.join(repo,'skills','pocket-projects','SKILL.md'),'utf8'),tasks=fs.readFileSync(path.join(repo,'skills','pocket-tasks','SKILL.md'),'utf8');
  assert.match(tasks,/only when the user asks/);assert.match(tasks,/## Offering one/);assert.match(tasks,/offer \*\*once\*\*/);assert.match(tasks,/for every accepted offer/);assert.match(tasks,/Never add the task before the user says yes/);assert.match(tasks,/Never invent a time/);assert.match(tasks,/--summary/);assert.match(tasks,/Settings → Projects, files, tasks & vault → Tasks/);
  for(const phrase of ['files','my files','documents','my documents','docs'])assert.ok(files.toLowerCase().includes(phrase),phrase);
  assert.match(files,/Settings → Projects, files, tasks & vault → Files/);
  assert.match(projects,/at most one short question/);assert.match(projects,/Never add a reminder by default/);assert.match(projects,/--requested/);
  assert.match(renderSkill('a\n<!-- pocket:commands -->\nold\n<!-- /pocket:commands -->\nb','/x/c.mjs','pocket-docs'),/^a\n<!-- pocket:commands -->\nOn this server, run `pocket-docs` as `node \/x\/c\.mjs`\..*\n<!-- \/pocket:commands -->\nb$/s);
  const d=documentInstructions('/x/pocket-docs.mjs','s1');
  for(const phrase of ['files, my files, documents, my documents or docs','pocket-files skill','add <path> --session s1'])assert.ok(d.includes(phrase),phrase);
  const p=projectInstructions('/x/pocket-board.mjs','s1');
  for(const phrase of ['pocket-projects skill','status --all','track --requested','at most one question'])assert.ok(p.includes(phrase),phrase);
});

test('HTTP: turning Projects and Files on in Settings installs their skills for this user; off removes them',async t=>{
  const dir=tmp(),home=path.join(dir,'home');fs.mkdirSync(path.join(home,'.codex'),{recursive:true});fs.mkdirSync(path.join(dir,'data'));fs.mkdirSync(path.join(dir,'sessions'));
  const secret=randomUUID(),exp=Date.now()+3600000,cookie=exp+'.'+createHmac('sha256',secret).update(String(exp)).digest('hex');
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(POCKET_|CLAUDE_CONFIG_DIR$|CODEX_HOME$)/.test(k)));
  let port=19511,child,logs='';
  const start=async()=>{
   child=spawn(process.execPath,['server.mjs'],{cwd:repo,env:{...env,HOME:home,PORT:String(port),POCKET_ENV_FILE:'',POCKET_AUTO_TITLES:'0',POCKET_PASSWORD:'test-only',POCKET_SECRET:secret,POCKET_CODEX:'0',POCKET_VOICE:'off',POCKET_MEMSTEM:'0',POCKET_SESSION_ROOT:path.join(dir,'sessions'),POCKET_DATA_DIR:path.join(dir,'data')}});
   child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)return;}catch{} await sleep(30);}
   if(child.exitCode!==null&&/EADDRINUSE/.test(logs)&&(start.tries=(start.tries||0)+1)<4){port+=37;logs='';return start();}
   throw Error('Test server failed: '+logs);
  };
  t.after(async()=>{if(child?.exitCode===null){const e=new Promise(r=>child.once('exit',r));child.kill();await e;}fs.rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});});
  await start();
  const set=body=>fetch(`http://127.0.0.1:${port}/api/settings`,{method:'POST',headers:{'content-type':'application/json',cookie:'pc_auth='+cookie},body:JSON.stringify(body)}).then(r=>r.json());
  const has=(root,name)=>fs.existsSync(path.join(home,root,'skills',name,'SKILL.md'));
  assert.equal(has('.claude','pocket-projects'),false,'nothing while both features are off');
  await set({projects:true,documents:true,tasks:true});
  for(const root of ['.claude','.codex'])for(const name of ['pocket-projects','pocket-files','pocket-tasks'])assert.ok(has(root,name),root+'/'+name);
  assert.match(fs.readFileSync(path.join(home,'.claude','skills','pocket-files','SKILL.md'),'utf8'),new RegExp('node '+path.join(repo,'scripts','pocket-docs.mjs').replace(/[.*+?^${}()|[\]\\/]/g,'\\$&')));
  await set({documents:false});
  assert.equal(has('.claude','pocket-files'),false);assert.ok(has('.claude','pocket-projects'));
});

// 1.73.8: a folder Pocket marked but whose SKILL.md is missing (a failure between the two writes) is repaired, not skipped
// forever; the marker is written first. An install path with a space is quoted in the skill and in every agent line.
test('skills: a marked folder without its skill is repaired; a path with a space is one shell word everywhere',t=>{
  const dir=tmp();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const root=path.join(dir,'claude'),skill=path.join(root,'pocket-projects');
  fs.mkdirSync(skill,{recursive:true});fs.writeFileSync(path.join(skill,MARKER),'Installed by Pocket Code.\n');
  const r=syncSkills({settings:{projects:true},commands,env:{},roots:[root],codexRoots:[]});
  assert.ok(r.installed.includes(skill),'repaired');assert.match(fs.readFileSync(path.join(skill,'SKILL.md'),'utf8'),/^---\nname: pocket-projects\n/);
  const spaced='/Users/Pat Doe/pocket code/scripts/pocket-board.mjs';
  assert.match(renderSkill('<!-- pocket:commands -->x<!-- /pocket:commands -->',spaced,'pocket-board'),/as `node '\/Users\/Pat Doe\/pocket code\/scripts\/pocket-board\.mjs'`/);
  assert.match(renderSkill('<!-- pocket:commands -->x<!-- /pocket:commands -->','/srv/pocket/scripts/pocket-board.mjs','pocket-board'),/as `node \/srv\/pocket\/scripts\/pocket-board\.mjs`/,'a plain path is unchanged');
  for(const line of [projectInstructions(spaced,null),documentInstructions(spaced,null)])assert.match(line,/node '\/Users\/Pat Doe\/pocket code\/scripts\/pocket-board\.mjs'/);
  assert.match(renderSkill('<!-- pocket:commands -->x<!-- /pocket:commands -->',"/a/it's/p.mjs",'pocket-board'),/node '\/a\/it'\\''s\/p\.mjs'/);
});

test('skills: each names its manual page, installed with this checkout\'s path; every turn points at the manual index',t=>{
  const dir=tmp();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const roots=[path.join(dir,'claude'),path.join(dir,'codex')];
  syncSkills({settings:{projects:true,documents:true,tasks:true,vault:true,inbox:true,coordination:true},commands:{...commands,inbox:'/srv/pocket/scripts/pocket-inbox.mjs'},env:{},roots,codexRoots:[roots[1]]});
  for(const s of SKILLS){
    assert.ok(s.manual,`${s.name} names a manual page`);
    const page=path.join(repo,'docs','manual',s.manual);
    assert.ok(fs.existsSync(page),`docs/manual/${s.manual} exists`);
    for(const f of s.files?Object.values(s.files):['SKILL.md'])assert.match(fs.readFileSync(path.join(repo,'skills',s.name,f),'utf8'),new RegExp('`docs/manual/'+s.manual.replace('.','\\.')+'`'),`${s.name}/${f}: repository copy names the page`);
    for(const root of roots)assert.ok(fs.readFileSync(path.join(root,s.name,'SKILL.md'),'utf8').includes('the Pocket Code manual, `'+page+'`'),`${root}/${s.name}: installed copy has the path`);
  }
  const line=manualInstructions(),m=line.match(/`([^`]+)`/);
  assert.equal(m[1],path.join(repo,'docs','manual','README.md'));assert.ok(fs.existsSync(m[1]));
  assert.match(line,/how a Pocket feature works/);
});

import fs from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';

const fail=(message,status=409)=>Object.assign(new Error(message),{status});
export function approvalMode(value,defaultMode='review',allowFull=true){
 const mode=value??defaultMode;
 if(!['review','full'].includes(mode))throw fail('Choose Review actions or Full access.',400);
 if(mode==='full'&&!allowFull)throw fail('Full access is disabled on this instance.',403);
 return mode;
}
export function claudePermissionSettings(mode){
 return {permissionMode:mode==='full'?'bypassPermissions':'default',permissions:{ask:mode==='full'?['AskUserQuestion']:['AskUserQuestion','Bash','PowerShell','Edit','Write','NotebookEdit','Agent','Task','WebFetch','WebSearch','mcp__*']}};
}
export function codexPermissionSettings(mode){
 return mode==='full'?{sandbox:'danger-full-access',approvalPolicy:'never'}:{sandbox:'read-only',approvalPolicy:'untrusted',config:{approvals_reviewer:'user'}};
}
// Store only identifiers, hashes and decisions. Tool arguments may contain secrets.
export function approvalAudit(file){
 return record=>{
  const fd=fs.openSync(file,'a',0o600);
  try{fs.writeSync(fd,JSON.stringify({at:new Date().toISOString(),...record})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 };
}
export class ApprovalInbox {
 constructor({sessionId,turnId,write,audit=()=>{},onChange=()=>{},onAutoError=()=>{}}){
  this.onAutoError=onAutoError;this.autoAnswered=new Set();this.sessionId=sessionId;this.turnId=turnId;this.write=write;this.audit=audit;this.onChange=onChange;this.pending=new Map();this.answered=new Map();this.closed=false;
 }
 // 1.82: `agent` names the subagent that asked, when the request came from one; it is shown, never fingerprinted.
 receive({nativeId,turnId,kind,title,details,allow,deny,canAllow=true,agent=null}){
  if(this.closed||nativeId==null||!turnId||turnId!==this.turnId()||this.pending.size>=20)return false;
  const text=JSON.stringify(details,null,2);
  if(!text||text.length>200000)return false; // Never approve a truncated preview.
  const fingerprint=createHash('sha256').update(JSON.stringify({kind,title,details,allow,deny})).digest('hex');
  const prior=[...this.pending.values()].find(r=>r.nativeId===nativeId);
  if(prior)return prior.fingerprint===fingerprint;
  const row={id:randomUUID(),nativeId,turnId,kind,title,details:text,allow,deny,canAllow,fingerprint,createdAt:Date.now(),status:'pending',agent:typeof agent==='string'&&agent?agent.slice(0,240):null};
  try{this.audit({event:'requested',sessionId:this.sessionId(),turnId,requestId:row.id,kind,fingerprint});}catch{return false;}
  this.pending.set(row.id,row);this.onChange();return true;
 }
 // 1.56: a request matching one of the owner's trusted rules (trusted.mjs) is answered Allow without a
 // card. Same guarantees as a tapped Allow: bound to this live turn, recorded before the pipe is written.
 // Returns false (show the card instead) whenever it cannot do that: closed or old turn, an oversized
 // request, a card already open for it, or an audit that cannot be written.
 // 1.105: `source` says who answered: 'auto-trusted' (a trusted rule) or 'full-access' (the reply's own mode).
 autoAllow({nativeId,turnId,kind,title,details,allow,deny,rule,tool,source='auto-trusted'}){
  if(this.closed||nativeId==null||!turnId||turnId!==this.turnId()||!rule)return false;
  if(this.autoAnswered.has(nativeId))return true;
  if([...this.pending.values()].some(r=>r.nativeId===nativeId))return false;
  const text=JSON.stringify(details,null,2);
  if(!text||text.length>200000)return false;
  const fingerprint=createHash('sha256').update(JSON.stringify({kind,title,details,allow,deny})).digest('hex');
  try{this.audit({event:'auto-allowed',sessionId:this.sessionId(),turnId,requestId:randomUUID(),kind,tool,fingerprint,decision:'allow',source,rule});}catch{return false;}
  this.autoAnswered.add(nativeId);
  if(this.autoAnswered.size>500)this.autoAnswered.delete(this.autoAnswered.values().next().value);
  // A failed write means the turn's input pipe is gone; nothing else can be sent on it either.
  Promise.resolve().then(()=>this.write(nativeId,allow)).catch(e=>this.onAutoError(e,{tool,rule}));
  return true;
 }
 list(){return [...this.pending.values()].map(({nativeId,allow,deny,fingerprint,...r})=>r);}
 async decide(id,decision){
  if(!['allow','deny'].includes(decision))throw fail("Choose Allow or Don't allow.",400); // 1.81: the buttons' current names
  const prior=this.answered.get(id);
  if(prior){if(prior!==decision)throw fail('This action was already answered differently.');return {ok:true,duplicate:true};}
  const row=this.pending.get(id);
  if(this.closed||!row||row.turnId!==this.turnId())throw fail('This action is no longer waiting. Refresh the approvals.');
  if(row.status!=='pending')throw fail('The decision was already sent or could not be confirmed. Refresh before continuing.');
  if(decision==='allow'&&!row.canAllow)throw fail('This request cannot be approved safely here. Deny it and ask for a supported action.',400);
  // Persist the decision before touching the native pipe. Failed transport is uncertain,
  // never permission to retry an Allow against another action or provider connection.
  try{this.audit({event:'decision',sessionId:this.sessionId(),turnId:row.turnId,requestId:id,kind:row.kind,fingerprint:row.fingerprint,decision});}
  catch{throw fail('Could not record this decision. Nothing was approved; try again.',503);}
  row.status='sending';this.onChange();
  try{await this.write(row.nativeId,decision==='allow'?row.allow:row.deny);}
  catch{row.status='uncertain';this.onChange();throw fail('Delivery of this decision is uncertain. Stop the reply and review the conversation; do not approve it again.',503);}
  this.pending.delete(id);this.answered.set(id,decision);
  if(this.answered.size>200)this.answered.delete(this.answered.keys().next().value);
  this.onChange();return {ok:true,decision};
 }
 resolve(nativeId){for(const [id,r] of this.pending)if(r.nativeId===nativeId)this.pending.delete(id);this.onChange();}
 clear(){this.closed=true;this.pending.clear();this.onChange();}
}

export function codexApproval(request,turn){
 const p=request.params;if(p?.threadId!==turn.threadId||!p.turnId||p.turnId!==turn.turnId)return null;
 const common={nativeId:request.id,turnId:p.turnId,deny:{decision:'decline'},allow:{decision:'accept'}};
 if(request.method==='item/commandExecution/requestApproval')return {...common,kind:p.networkApprovalContext?'network':'command',title:p.networkApprovalContext?'Allow network access?':'Run this command?',details:{command:p.command,cwd:p.cwd,reason:p.reason,network:p.networkApprovalContext,additionalPermissions:p.additionalPermissions,kind:p.kind||'command'},canAllow:Boolean(p.command||p.networkApprovalContext)&&(!p.availableDecisions||p.availableDecisions.includes('accept'))};
 if(request.method==='item/fileChange/requestApproval'){
  const item=turn.approvalItems.get(p.itemId);
  return {...common,kind:'fileChange',title:'Apply these file changes?',details:{cwd:turn.cwd,reason:p.reason,changes:item?.changes,grantRoot:p.grantRoot},canAllow:Boolean(item?.changes?.length)&&!p.grantRoot};
 }
 if(request.method==='item/permissions/requestApproval')return {...common,kind:'permissions',title:'Allow access for this reply?',details:{cwd:p.cwd,reason:p.reason,permissions:p.permissions},canAllow:Boolean(p.permissions&&typeof p.permissions==='object'&&!Array.isArray(p.permissions)),allow:{permissions:p.permissions,scope:'turn'},deny:{permissions:{},scope:'turn'}};
 return null;
}

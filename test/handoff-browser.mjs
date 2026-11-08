// 1.102 Handoff in the browser: the button beside Branch (Conversation options on a phone), the size-based offer under
// the latest finished reply, Not now, the ring past the offer size, and an already continued conversation.
// Runs against browser.mjs's fixtures: every conversation reports 435K of a 1M window.
// POCKET_DESIGN_SCANNER: the impeccable detector on each scanned view; its findings are written beside the screenshots.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ASK='Hand this off: write a briefing for a new conversation to pick up from here, and give me the handoff card.';
const WHAT='Have the agent write a briefing and offer a fresh conversation that picks up from it. This one stays as it is.';
export async function runHandoffRegressions({browser,base,rows,out,settings,received,side,conversations}) {
 const context=await browser.createBrowserContext(),page=await context.newPage();page.setDefaultTimeout(8000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 const shown=rows.find(r=>r.state.kind==='finished').id,idle=rows.find(r=>r.state.kind==='idle').id; // the send goes last: it leaves a message without a reply
 const scan=async(name,sel)=>{const s=await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});await s.evaluate(e=>e.remove());const r=await page.evaluate(sel=>axe.run(sel,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}}),sel);assert.deepEqual(r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],name);await page.screenshot({path:path.join(out,'handoff-'+name+'.png')});if(process.env.POCKET_DESIGN_SCANNER){await page.evaluate(()=>{window.__IMPECCABLE_CONFIG__={autoScan:false};});if(!await page.evaluate(()=>Boolean(window.impeccableDetectAsync))){const t=await page.addScriptTag({path:process.env.POCKET_DESIGN_SCANNER});await t.evaluate(e=>e.remove());}const r=await page.evaluate(()=>window.impeccableDetectAsync({scrollOffscreen:false}));const fs=await import('node:fs');fs.writeFileSync(path.join(out,'handoff-design-'+name+'.json'),JSON.stringify(r,null,1));}};
 let visit=0;const open=async(width,id)=>{await page.setViewport({width,height:width<900?844:900});await page.goto(base+'/?handoff='+width+'-'+(++visit)+'#/chat/'+id);await page.waitForSelector('#msgs .m-asst');await page.waitForFunction(()=>document.getElementById('ctx-ring')?.dataset.tip?.includes('tokens'));};
 const offer=()=>page.$eval('#msgs',m=>{const o=m.querySelector('.handoff-offer');return o?{text:o.querySelector('.handoff-offer-text').textContent,afterReply:o.previousElementSibling?.matches('.m-asst, .try-harder')}:null;});
 const prev=settings.handoffAt;
 try{
  console.log('Handoff: off by default in this fixture, so no offer');
  await open(1440,shown);
  assert.equal(await offer(),null,'handoffAt 0: no offer');
  assert.equal(await page.$eval('#ctx-ring',e=>e.dataset.level),'','43% of a 1M window stays grey without the offer');
  assert.equal(await page.$eval('#handoff-open',e=>!e.hidden&&e.textContent.trim()),'Handoff','the button is there either way');

  console.log('Handoff: the offer at 1440, the ring and the button');
  settings.handoffAt=200000;
  await open(1440,shown);
  await page.waitForSelector('.handoff-offer');
  assert.deepEqual(await offer(),{text:'This conversation is at 435K tokens, and every reply reads all of it.',afterReply:true});
  assert.equal(await page.$eval('#ctx-ring',e=>e.dataset.level),'amber','past the offer size the ring warns');
  assert.match(await page.$eval('#ctx-ring',e=>e.dataset.tip),/Large enough to hand off$/);
  assert.equal(await page.$eval('#handoff-open',e=>e.dataset.tip),'Handoff: '+WHAT);
  await scan('offer-1440','#msgs');
  console.log('Handoff: typing hides it, clearing brings it back');
  await page.type('#box','x');await page.waitForFunction(()=>!document.querySelector('.handoff-offer'));
  await page.$eval('#box',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForSelector('.handoff-offer');
  console.log('Handoff: Not now holds until the conversation grows by the offer size again');
  await page.click('[data-handoff-later]');await page.waitForFunction(()=>!document.querySelector('.handoff-offer'));
  assert.deepEqual(await page.evaluate(id=>JSON.parse(localStorage.getItem('pc-handoff-dismissed'))[id],shown),2,'435K is the second 200K step');
  await open(1440,shown);assert.equal(await offer(),null,'still dismissed after a reload');
  console.log('Handoff: a conversation already continued elsewhere is not offered');
  await page.evaluate(()=>localStorage.removeItem('pc-handoff-dismissed'));
  side.lineage[shown]={continuedIn:[{id:idle,title:'Next steps'}]};
  await open(1440,shown);assert.equal(await offer(),null,'continued in another conversation: no offer');
  delete side.lineage[shown];

  console.log('Handoff: a phone gets it in Conversation options, and the offer wraps');
  await page.evaluate(()=>localStorage.removeItem('pc-handoff-dismissed'));
  await open(390,shown);await page.waitForSelector('.handoff-offer');
  assert.equal(await page.$eval('#handoff-open',e=>e.getClientRects().length),0,'no Handoff chip on a phone');
  const fits=await page.$eval('.handoff-offer',e=>{const r=e.getBoundingClientRect();return r.right<=innerWidth&&[...e.querySelectorAll('button')].every(b=>b.getBoundingClientRect().height>=44);});
  assert.ok(fits,'inside the phone width, 44px targets');
  await scan('offer-390','#msgs');
  await page.click('#chatmore');await page.waitForSelector('#so-handoff');
  assert.equal(await page.$eval('#so-handoff .sub',e=>e.textContent),WHAT);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#so-handoff'));
  console.log('Handoff: with reply choices showing, Hand off first joins them instead of the line');
  // Each send gets its own conversation: a sent message leaves that one waiting for a reply, which rightly hides the offer.
  const pick=rows.find(r=>r.state.kind==='failed').id,carry=idle,saved=new Map([pick,carry].map(id=>[id,conversations.get(id)]));
  const withChoices=(id=pick)=>conversations.set(id,[{role:'user',text:'Run the tests.'},{role:'assistant',blocks:[{t:'text',text:'Tests pass. Should I merge and deploy?'},{t:'choices',options:['Merge and deploy','Hold it'],rec:0}]}]);
  const sentOne=async act=>{const n=received.length;await act();for(let i=0;i<80&&received.length===n;i++)await new Promise(r=>setTimeout(r,50));assert.equal(received.length,n+1,'one request');return received.at(-1).text;};
  for(const width of [1440,390]){
   await page.evaluate(()=>localStorage.removeItem('pc-handoff-dismissed'));withChoices();
   await open(width,pick);await page.waitForSelector('[data-choices]:not([hidden]) .choice-handoff');
   assert.equal(await offer(),null,'no line while the choices show');
   assert.deepEqual(await page.$$eval('[data-choices]:not([hidden]) .choice',b=>b.map(x=>x.textContent.trim())),['Merge and deployRecommended','Hold it','Hand off first'],'the last choice');
   assert.ok(await page.$eval('.choice-handoff',b=>{const r=b.getBoundingClientRect();return r.height>=44&&r.right<=innerWidth;}),'44px, inside the width');
   await scan('choices-'+width,'#msgs');
  }
  console.log('Handoff: picking a choice runs it here and answers the offer for this size');
  assert.equal(await sentOne(()=>page.click('[data-choices]:not([hidden]) .choice:not(.choice-rec):not(.choice-handoff)')),'Hold it','the choice, not a handoff');
  assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem('pc-handoff-dismissed'))[id],pick),2,'no offer again at this size');
  console.log('Handoff: Hand off first carries the open choices into the request');
  await page.evaluate(()=>localStorage.removeItem('pc-handoff-dismissed'));withChoices(carry);
  await open(1440,carry);await page.waitForSelector('.choice-handoff');
  assert.equal(await sentOne(()=>page.click('.choice-handoff')),ASK+' I have not picked one of these options yet: "Merge and deploy (Recommended)"; "Hold it". Put them in the briefing as the first decision, so the new conversation starts by offering them.');
  assert.equal(await page.$('[data-choices]:not([hidden])'),null,'the choices close');
  saved.forEach((m,id)=>conversations.set(id,m));
  console.log('Handoff: Hand off sends the request once and records the step');
  await page.evaluate(()=>localStorage.removeItem('pc-handoff-dismissed'));
  await open(1440,shown);await page.waitForSelector('.handoff-offer')
  const before=received.length;
  await page.click('[data-handoff-offer]');
  for(let i=0;i<80&&received.length===before;i++)await new Promise(r=>setTimeout(r,50));
  assert.equal(received.length,before+1,'one request');assert.equal(received.at(-1).text,ASK);
  assert.ok(await page.evaluate(id=>JSON.parse(localStorage.getItem('pc-handoff-dismissed'))[id]===2,shown),'asking counts as an answer');

  assert.deepEqual(errors,[]);
 } finally { settings.handoffAt=prev; await context.close(); }
}

// The Coordination view (1.99): off leaves no trace, the line above the list shows only while something is held, one tap
// releases, a terminal holder reads as unverified, and Assistant mode never sees any of it. Runs inside test/browser.mjs,
// or alone with POCKET_COORD_ONLY=1.
import assert from 'node:assert/strict';
import path from 'node:path';
import {clickControl} from './ui-controls.mjs';

const axeCheck=async(p,repo,sel)=>{await p.addScriptTag({path:path.join(repo,'node_modules/axe-core/axe.min.js')});assert.deepEqual(await p.evaluate(async s=>{const result=await axe.run(s);return result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));},sel),[]);};
export async function runCoordinationRegressions({p,base,out,repo,rows,settings,coord,scan}){
 const home=async()=>{await p.goto(base+'/#/all');await p.waitForSelector('.session-home');};
 const noHold=()=>p.$eval('[data-session-held]',e=>e.hidden);
 // Off: no chip, no line, and the address goes home.
 settings.coordination=false;
 await p.setViewport({width:1440,height:900,isMobile:false,hasTouch:false});await home();
 assert.equal(await p.$('[data-coord-home]'),null);assert.equal(await noHold(),true);
 await p.goto(base+'/#/coordination');await p.waitForFunction(()=>location.hash!=='#/coordination');
 // The switch lives with the other tools, and turning it on adds the way in.
 await home();await clickControl(p,'#settings');await p.waitForSelector('.settings-sheet');
 await p.evaluate(()=>[...document.querySelectorAll('.settings-sheet button')].find(b=>/Projects, files, tasks/.test(b.textContent))?.click());
 await p.waitForFunction(()=>{const b=document.querySelector('#s-coordination');return b&&!b.disabled&&b.offsetParent;});
 assert.match(await p.$eval('#s-coordination-state',e=>e.textContent),/^Off\./);
 await clickControl(p,'#s-coordination');await p.waitForFunction(()=>window.pocketFeatures.coordination===true);
 assert.equal(settings.coordination,true);await p.keyboard.press('Escape');
 // A quiet day: the chip, but no line, and the view says what will show there.
 coord.reset([]);await home();await p.waitForFunction(()=>document.querySelector('[data-session-held]').hidden);assert.ok(await p.$('[data-coord-home]'));
 await p.goto(base+'/#/coordination');await p.waitForSelector('#coord-main .project-empty');
 assert.equal(await p.$eval('#coord-main .project-empty',e=>e.textContent),'Nothing is held. A conversation that claims staging or a deploy shows here.');
 await p.screenshot({path:path.join(out,'coordination-empty-1440.png')});await scan('coordination-empty-1440');
 // Held: one line above the list, which opens the view.
 coord.reset();await home();await p.waitForFunction(()=>!document.querySelector('[data-session-held]').hidden);
 assert.equal(await p.$eval('[data-session-held]',e=>e.textContent),'dad-staging held by "DAD 1.168 build" and 1 more');
 await p.screenshot({path:path.join(out,'coordination-line-1440.png')});await scan('coordination-line-1440');
 await clickControl(p,'[data-session-held]');await p.waitForSelector('#coord-main [data-hold]');
 assert.deepEqual(await p.$$eval('[data-hold]',e=>e.map(x=>x.dataset.hold)),['dad-staging','tpv-deploy']);
 assert.equal(await p.$eval('[data-hold="dad-staging"] .coord-time',e=>e.textContent),'12m');
 assert.equal(await p.$eval('[data-hold="dad-staging"] .coord-wait',e=>e.textContent),'1 waiting: "PayPal fix"');
 assert.match(await p.$eval('[data-hold="dad-staging"] .coord-who a',e=>e.getAttribute('href')),/^#\/chat\//);
 assert.equal(await p.$eval('[data-hold="tpv-deploy"] .coord-who',e=>e.textContent),'Terminal session');assert.equal(await p.$('[data-hold="tpv-deploy"] .coord-who a'),null);
 assert.deepEqual(await p.$$eval('[data-past] .coord-why',e=>e.map(x=>x.textContent)),['Released: Deployed and checked','Expired','Released by you']);
 assert.equal(await p.$eval('#ktitle',e=>e.textContent),'Coordination');
 await p.screenshot({path:path.join(out,'coordination-1440.png')});await scan('coordination-1440');await axeCheck(p,repo,'#coord-main');
 // It opens beside a conversation like any other view.
 await p.goto(base+'/#/chat/'+rows[0].id);await p.waitForSelector('#splitb');await clickControl(p,'#splitb');await p.waitForFunction(()=>/Coordination/.test(document.querySelector('.split-choices')?.textContent||''));
 await p.keyboard.press('Escape');
 // The phone: a stack, 44px controls, nothing overflows.
 await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await p.goto(base+'/#/coordination');await p.waitForSelector('#coord-main [data-hold]');
 await p.screenshot({path:path.join(out,'coordination-390.png')});await scan('coordination-390');await axeCheck(p,repo,'#coord-main');
 assert.ok((await p.$$eval('.coord-release',e=>e.map(x=>x.getBoundingClientRect().height))).every(h=>h>=44),'Release is 44px on a phone');
 assert.equal(await p.$eval('#coord-main',e=>e.scrollWidth<=e.clientWidth),true);
 // One tap releases: the row leaves Held now, lands in Recent, and the toast says the holder hears about it.
 await clickControl(p,'[data-coord-release="dad-staging"]');await p.waitForFunction(()=>!document.querySelector('[data-hold="dad-staging"]'));
 assert.deepEqual(coord.released,['dad-staging']);assert.ok(await p.$('[data-past="dad-staging"]'));
 assert.match(await p.$eval('#toast',e=>e.textContent),/Released dad-staging\. Its conversation is told when it next runs\. Woke "PayPal fix"\./);
 // A hold someone else ended first: the message shows and the list catches up.
 coord.failNext=true;await clickControl(p,'[data-coord-release="tpv-deploy"]');await p.waitForFunction(()=>!document.querySelector('[data-hold="tpv-deploy"]'));
 await p.waitForFunction(()=>/already free/.test(document.querySelector('#toast')?.textContent||''));
 // Assistant mode: no row, no chip, no line, no view, whatever the setting says.
 const assistant=settings.assistantMode;settings.assistantMode=true;coord.reset();
 await p.setViewport({width:1440,height:900,isMobile:false,hasTouch:false});await p.goto(base+'/#/all');await p.waitForSelector('.session-home');
 assert.equal(await p.$('[data-coord-home]'),null);assert.equal(await noHold(),true);
 await p.goto(base+'/#/coordination');await p.waitForFunction(()=>location.hash!=='#/coordination');
 settings.assistantMode=assistant;settings.coordination=false;
}

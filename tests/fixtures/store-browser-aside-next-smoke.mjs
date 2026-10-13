// Manual: actual Aside executable against a mocked localhost store and photo endpoint.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createAsideAdapter } from '../../scripts/lib/store-browser-aside.mjs';
import { validateConfig, canonicalSchedule, WEEK_DAYS } from '../../scripts/lib/store-browser-config.mjs';
import { preparePhotoAsset } from '../../scripts/lib/store-browser-photo.mjs';
import { runJob } from '../../scripts/store-browser-worker.mjs';
let weekly=Object.fromEntries(WEEK_DAYS.map(d=>[d,{state:'open',intervals:[{start:'09:00',end:'18:00',endsNextDay:false}]}]));
let hoursSaves=0,photoSaves=0,photoHash='';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJfsAAAAASUVORK5CYII=','base64');
const sha=createHash('sha256').update(png).digest('hex');
const server=createServer(async(req,res)=>{
 if(req.method==='POST') {
  let bytes=Buffer.alloc(0);for await(const chunk of req)bytes=Buffer.concat([bytes,chunk]);
  if(req.url==='/hours'){weekly=JSON.parse(bytes.toString());hoursSaves++;}else if(req.url==='/photo'){photoHash=createHash('sha256').update(bytes).digest('hex');photoSaves++;}
  res.end('ok');return;
 }
 res.setHeader('Content-Type','text/html; charset=utf-8');
 const rows=WEEK_DAYS.map(d=>`<label>${d}<select id="${d}-state"><option value="open" ${weekly[d].state==='open'?'selected':''}>Open</option><option value="closed" ${weekly[d].state==='closed'?'selected':''}>Closed</option><option value="unknown" ${weekly[d].state==='unknown'?'selected':''}>Unknown</option></select><input id="${d}-start" value="${weekly[d].intervals[0]?.start||'09:00'}"><input id="${d}-end" value="${weekly[d].intervals[0]?.end||'18:00'}"><select id="${d}-overnight"><option value="false" ${!weekly[d].intervals[0]?.endsNextDay?'selected':''}>Same day</option><option value="true" ${weekly[d].intervals[0]?.endsNextDay?'selected':''}>Next day</option></select></label>`).join('');
 res.end(`<!doctype html><title>COLLECTIVE weekly/photo fixture</title><style>label{display:block}input{width:80px}input[type=checkbox]{width:20px}</style><p id="business">1</p><p id="place">2</p><h1 id="store">Fixture Store</h1>${rows}<button id="save">Save week</button><input id="file" type="file"><button id="photo-submit">Upload photo</button><p id="photo-id">${photoHash?'photo-1':''}</p><p id="photo-sha">${photoHash}</p><p id="result"></p><script>document.querySelector('#save').onclick=async()=>{const s={};for(const d of ${JSON.stringify(WEEK_DAYS)}){const state=document.querySelector('#'+d+'-state').value;s[d]={state,intervals:state==='open'?[{start:document.querySelector('#'+d+'-start').value,end:document.querySelector('#'+d+'-end').value,endsNextDay:document.querySelector('#'+d+'-overnight').value==='true'}]:[]};}await fetch('/hours',{method:'POST',body:JSON.stringify(s)});document.querySelector('#result').textContent='Saved week';};document.querySelector('#photo-submit').onclick=async()=>{await fetch('/photo',{method:'POST',body:await document.querySelector('#file').files[0].arrayBuffer()});document.querySelector('#result').textContent='Uploaded photo';};</script>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
try {
 const weeklyLocators=Object.fromEntries(WEEK_DAYS.map(d=>[d,{state:{css:`#${d}-state`},values:{open:'open',closed:'closed',unknown:'unknown'},intervals:[{start:{css:`#${d}-start`},end:{css:`#${d}-end`},endsNextDay:{css:`#${d}-overnight`},endsNextDayMode:'select'}]}]));
 const config=validateConfig({version:2,host:'local',account:'u0',weekly:weeklyLocators,locators:{managerBusinessId:{css:'#business'},naverPlaceId:{css:'#place'},storeName:{css:'#store'},save:{css:'#save'}},public:{naverPlaceId:{css:'#place'},weekly:weeklyLocators},photo:{fileInput:{css:'#file'},submit:{css:'#photo-submit'},photoId:{css:'#photo-id'},photoSha256:{css:'#photo-sha'}}});
 const binding={managerUrl:`${origin}/`,publicUrl:`${origin}/public`,managerBusinessId:'1',naverPlaceId:'2',storeName:'Fixture Store'};
 const after={...weekly,mon:{state:'open',intervals:[{start:'19:00',end:'01:00',endsNextDay:true}]},sun:{state:'closed',intervals:[]}};
 const claim={job:{id:'fixture',type:'change_weekly_hours',beforeSchedule:weekly,afterSchedule:after,beforeHours:canonicalSchedule(weekly),afterHours:canonicalSchedule(after)},binding,executionMode:'write'};
 const adapter=createAsideAdapter(config,binding,undefined,true);const phases=[];
 const report=async(action,details)=>{phases.push(action);if(action==='public_readback')assert.equal(details.evidence.hours,canonicalSchedule(after));return{permitSubmit:action==='begin_submit'};};
 assert.equal((await runJob(claim,adapter,report)).state,'verified');assert.equal(hoursSaves,1);assert.deepEqual(weekly,after);
 const photo={sourceId:'asset',sourceVersion:1,rightsId:'rights',rightsVersion:1,sha256:sha,mime:'image/png',size:png.length};
 const photoClaim={...claim,job:{id:'photo-fixture',type:'upload_photo',photo},attemptId:'a',leaseToken:'lease'};
 const photoAdapter={...adapter,preparePhotoAsset:()=>preparePhotoAsset(origin,'sb.fixture.notreal',photoClaim,async()=>new Response(png,{headers:{'Content-Type':'image/png','Content-Length':String(png.length)}}))};
 assert.equal((await runJob(photoClaim,photoAdapter,async action=>({permitSubmit:action==='begin_submit'}))).state,'verified');assert.equal(photoSaves,1);assert.equal(photoHash,sha);
 assert.equal((await runJob({...photoClaim,executionMode:'reconcile'},photoAdapter,async()=>({}))).state,'verified');assert.equal(photoSaves,1);
 console.log(JSON.stringify({passed:4,failed:0,browser:'real Aside CLI',store:'mocked localhost fixture',serverPhases:'mocked',hoursSaves,photoSaves,phases}));
} finally {
 await promisify(execFile)('aside',['repl','--host','local','--account','u0',`await(async()=>{for(const t of (await listBrowserTabs()).filter(t=>t.url.startsWith(${JSON.stringify(origin+'/')}))){await attachBrowserTab(t.targetId);await closeTab(page);}})()`],{timeout:125000});
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}

// Explicit manual test: real Aside executable, mocked local store and API phases.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { createAsideAdapter } from '../../scripts/lib/store-browser-aside.mjs';
import { runJob, validateConfig } from '../../scripts/store-browser-worker.mjs';
let hours = '09:00-18:00'; let saves = 0;
const server = createServer(async (req,res) => {
 if(req.url === '/save' && req.method === 'POST') {
  let body = ''; for await(const chunk of req) body += chunk;
  hours = JSON.parse(body).hours; saves++; res.end('ok'); return;
 }
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.end(`<!doctype html><title>COLLECTIVE worker fixture</title><p id="business">7</p><p id="place">8</p><h1 id="store">Fixture Store</h1><input aria-label="Hours" id="hours" value="${hours}"><button id="save" onclick="fetch('/save',{method:'POST',body:JSON.stringify({hours:document.querySelector('#hours').value})}).then(()=>{document.querySelector('#result').textContent='Saved'})">Save hours</button><p id="result"></p>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const managerUrl = `http://127.0.0.1:${server.address().port}/`;
try {
 const config = validateConfig({host:'local',account:'u0',hoursReadMode:'input',locators:{managerBusinessId:{css:'#business'},naverPlaceId:{css:'#place'},storeName:{css:'#store'},hours:{role:'textbox',name:'Hours'},save:{role:'button',name:'Save hours'}}});
 const binding = {managerUrl,managerBusinessId:'7',naverPlaceId:'8',storeName:'Fixture Store'};
 const adapter = createAsideAdapter(config,binding,undefined,true);
 const observed = await adapter.observe(); assert.equal(observed.hours,hours); assert.equal(observed.source,'mocked');
 const claim = {job:{id:'fixture',version:1,type:'change_hours',beforeHours:hours,afterHours:'10:00-19:00'},binding,executionMode:'write'};
 const phases=[];
 const result = await runJob(claim,adapter,async action=>{phases.push(action);return {permitSubmit:action==='begin_submit'};});
 assert.equal(result.state,'verified'); assert.equal(saves,1); assert.equal(hours,claim.job.afterHours);
 const reconcile = await runJob({...claim,executionMode:'reconcile'},adapter,async action=>{assert.equal(action,'verify');});
 assert.equal(reconcile.state,'verified'); assert.equal(saves,1);
 console.log(JSON.stringify({passed:3,failed:0,browser:'real Aside CLI',store:'mocked localhost fixture',serverPhases:'mocked',saves,phases}));
} finally {
 await promisify(execFile)('aside',['repl','--host','local','--account','u0',`await (async()=>{const listed=await listBrowserTabs();for(const t of listed.filter(t=>t.url===${JSON.stringify(managerUrl)})){await attachBrowserTab(t.targetId);await closeTab(page);}})()`],{timeout:125000});
 server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
}

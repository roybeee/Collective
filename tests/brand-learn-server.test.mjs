// 브랜드 자동 학습 서버(G1): 스위치 꺼짐 409, 사설 주소 거부(리다이렉트 포함), 미리보기 → 실행 기록, 후보 저장 → 사실 원장 '확인 후보'(확정 아님),
// 색 적용(관리자, 불변 갱신·출처), 템플릿 → 기존 save_campaign 경로로 캠페인 초안. 근거: mocked(메모리 SQLite, fetch 스텁, 헤더 인증). 외부 네트워크 호출 0회.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
import {readFileSync} from 'node:fs';

const calls=[];
const PAGE=readFileSync('lib/brand-learn-sample.ts','utf8').match(/BRAND_LEARN_SAMPLE_HTML=`([\s\S]*?)`;/)[1];
const html=(body,init={})=>new Response(body,{status:200,headers:{'content-type':'text/html; charset=utf-8'},...init});
const fetchStub=async(url,init)=>{
 calls.push({url,redirect:init?.redirect});
 if(url==='https://brand.example.test/')return html(PAGE);
 if(url==='https://redirect.example.test/')return new Response('',{status:302,headers:{location:'http://127.0.0.1:8787/admin'}});
 if(url==='https://moved.example.test/')return new Response('',{status:301,headers:{location:'https://brand.example.test/'}});
 if(url==='https://json.example.test/')return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
 if(url==='https://big.example.test/')return html('<html>'+'x'.repeat(1_100_000)+'</html>');
 if(url==='https://down.example.test/')return new Response('nope',{status:503});
 throw new Error('외부 호출 금지: '+url);
};
const {sql,load}=testRuntime(fetchStub);
const server=await load('lib/brand-learn-server.ts'),flags=await load('lib/feature-flags.ts'),route=await load('app/api/brand-learn/route.ts'),sampleRoute=await load('app/api/brand-learn/sample/route.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const owner='learn-owner',brandId='learn-brand',origin='https://agency.test';
const brand={id:brandId,name:'가상 분식',short:'GB',category:'분식',color:'#224466',bg:'#eef2f6',description:'합성 소개(미확인).',audience:'가상동 주민(가설)',tone:'친근한',constraints:'',knowledge:''};
const insert=(kind,id,data,parent='')=>sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),new Date().toISOString());
insert('brand',brandId,brand);
const rows=kind=>sql.prepare('SELECT data FROM records WHERE owner=? AND kind=?').all(owner,kind).map(r=>JSON.parse(r.data));
const headers={'oai-authenticated-user-id':owner,origin,'content-type':'application/json'};
const call=async res=>({status:res.status,body:await res.json().catch(()=>null)});
const post=input=>route.POST(new Request(origin+'/api/brand-learn',{method:'POST',headers,body:JSON.stringify(input)})).then(call);
const get=()=>route.GET(new Request(origin+'/api/brand-learn?brandId='+brandId,{headers})).then(call);

// 1) SSRF 가드: 사설·루프백·링크로컬·계정 정보·비http는 400. 공개 호스트와 공개 IP는 통과한다.
for(const bad of ['http://localhost/','http://127.0.0.1:8787/','http://10.0.0.5/','http://172.16.3.1/','http://172.31.255.1/','http://192.168.0.200/','http://169.254.169.254/latest','http://[::1]/','http://[fd00::1]/','http://0.0.0.0/','http://user:pw@example.test/','ftp://example.test/','http://printer.local/','http://db.internal/','not a url']){
 assert.throws(()=>server.assertPublicHttpUrl(bad),e=>e.status===400,bad);
}
passed.push('private, loopback, link-local, credentialed, non-http and malformed urls are rejected with 400');
check('public hosts and public ips pass',server.assertPublicHttpUrl('https://brand.example.test/x?y=1').hostname==='brand.example.test'&&server.assertPublicHttpUrl('http://172.32.0.1/').hostname==='172.32.0.1'&&server.assertPublicHttpUrl('http://8.8.8.8/').hostname==='8.8.8.8');
await assert.rejects(()=>server.fetchBrandHtml('https://redirect.example.test/',{fetchImpl:fetchStub}),e=>e.status===400);passed.push('a redirect into a private address is rejected before following it');
check('redirects are requested with redirect:manual and the private target was never fetched',calls.every(c=>c.redirect==='manual')&&!calls.some(c=>c.url.includes('127.0.0.1')));
const moved=await server.fetchBrandHtml('https://moved.example.test/',{fetchImpl:fetchStub});
check('a public redirect is followed once and the final url is recorded',moved.finalUrl==='https://brand.example.test/'&&moved.html.includes('가상 분식 연구소'));
await assert.rejects(()=>server.fetchBrandHtml('https://json.example.test/',{fetchImpl:fetchStub}),e=>e.status===400);passed.push('non-html content is rejected');
await assert.rejects(()=>server.fetchBrandHtml('https://big.example.test/',{fetchImpl:fetchStub}),e=>e.status===413);passed.push('bodies over 1MB are cut off with 413');
await assert.rejects(()=>server.fetchBrandHtml('https://down.example.test/',{fetchImpl:fetchStub}),e=>e.status===502);passed.push('upstream errors are 502');

// 2) 스위치 꺼짐: 모든 쓰기 409, 읽기는 enabled:false와 이유.
let r=await get();
check('GET reports the switch off with a reason and the templates',r.status===200&&r.body.enabled===false&&r.body.offReason==='브랜드 자동 학습 스위치가 꺼져 있습니다.'&&r.body.templates.length===3&&r.body.runs.length===0);
for(const input of [{action:'preview',brandId,url:'https://brand.example.test/'},{action:'save_candidates',runId:'x'},{action:'apply_visual',runId:'x',hex:'#c2410c'},{action:'create_from_template',brandId,template:'new_menu'}]){
 r=await post(input);check(`${input.action} is 409 while the switch is off`,r.status===409&&/스위치가 꺼져/.test(r.body.error));
}
check('nothing was written while off',rows('brand_learn_run').length===0&&rows('brand_fact').length===0&&rows('campaign').length===0);
const before=calls.length;
r=await post({action:'preview',brandId,url:'http://127.0.0.1/'});
check('switch check comes before any fetch',r.status===409&&calls.length===before);

// 3) 켜고 미리보기: 공개 페이지를 1회 읽어 실행 기록을 남긴다(사실 원장은 아직 비어 있다).
await flags.setFeatureFlag(owner,{flag:'brand_autolearn',enabled:true},{id:'o',email:null});
r=await post({action:'preview',brandId,url:'http://192.168.0.200/'});
check('private url is 400 even with the switch on',r.status===400&&calls.length===before);
r=await post({action:'preview',brandId,url:'https://brand.example.test/'});
check('preview returns a run with name, 5 colors, logo, tagline and candidates',r.status===200&&r.body.run.status==='previewed'&&r.body.run.result.name.value==='가상 분식 연구소'&&r.body.run.result.colors.length===5&&r.body.run.result.colors[0].hex==='#c2410c'&&r.body.run.result.logo.value==='https://brand.example.test/images/sample-logo.png'&&r.body.run.candidates.length===5);
const run=r.body.run;
check('the run is stored under the brand without raw html and with who/when',(()=>{const stored=rows('brand_learn_run');return stored.length===1&&stored[0].brandId===brandId&&stored[0].by.id===owner&&!JSON.stringify(stored[0]).includes('<html')&&Number.isFinite(Date.parse(stored[0].observedAt))&&stored[0].bytes>0&&stored[0].url==='https://brand.example.test/'})());
check('preview wrote no facts',rows('brand_fact').length===0);
check('exactly one GET hit the page',calls.filter(c=>c.url==='https://brand.example.test/').length===2);

// 4) 후보 저장: 사실 원장에 status candidate로만 쓴다. 같은 항목이 이미 있으면 건너뛴다. 두 번 저장해도 늘지 않는다.
insert('brand_fact','existing-hours',{id:'existing-hours',brandId,key:'hours',value:'매일 10:00~20:00',status:'confirmed',source:'점주 확인',verifiedAt:'2026-01-01T00:00:00.000Z',validUntil:'2027-01-01T00:00:00.000Z',version:1,updatedAt:'2026-01-01T00:00:00.000Z'},brandId);
r=await post({action:'save_candidates',runId:run.id});
check('save writes 4 candidates and skips the existing hours item',r.status===200&&r.body.imported===4&&r.body.skipped.length===1&&r.body.skipped[0].key==='hours'&&r.body.run.status==='saved');
const facts=rows('brand_fact').filter(f=>f.id!=='existing-hours');
check('every learned fact is a candidate with the url in its source and empty verification dates',facts.length===4&&facts.every(f=>f.status==='candidate'&&f.source.includes('https://brand.example.test/')&&f.verifiedAt===''&&f.validUntil===''&&f.importedBy.id===owner&&f.brandId===brandId));
check('candidate keys are catalog keys',facts.map(f=>f.key).sort().join(',')==='address,menu_price,official_account,phone');
check('address and phone values come from the page',facts.find(f=>f.key==='address').value==='서울특별시 가상구 가상로 123, 1층'&&facts.find(f=>f.key==='phone').value==='02-000-0000');
check('the confirmed hours fact is untouched',rows('brand_fact').find(f=>f.id==='existing-hours').status==='confirmed');
r=await post({action:'save_candidates',runId:run.id});
check('saving again is idempotent',r.status===200&&r.body.imported===4&&rows('brand_fact').length===5);

// 5) 색 적용(관리자): 제안 색만 받고, 브랜드를 새 객체로 바꾸며 출처를 남긴다.
const frozen=Object.freeze({...brand});
const applied=server.brandWithVisual(frozen,'#c2410c',{runId:'r',url:'u',observedAt:'t',appliedBy:{id:'o',email:null},appliedAt:'t2',previousColor:frozen.color});
check('brandWithVisual returns a new object and leaves the input unchanged',applied!==frozen&&applied.color==='#c2410c'&&frozen.color==='#224466'&&applied.visualProvenance.previousColor==='#224466'&&applied.name===brand.name);
r=await post({action:'apply_visual',runId:run.id,hex:'#123456'});
check('a color the run did not propose is a 400',r.status===400);
r=await post({action:'apply_visual',runId:run.id,hex:'#C2410C'});
check('applying a proposed color updates the brand and records provenance',r.status===200&&r.body.brand.color==='#c2410c'&&r.body.brand.visualProvenance.runId===run.id&&r.body.brand.visualProvenance.previousColor==='#224466'&&r.body.run.appliedVisual.appliedBy.id===owner);
const storedBrand=rows('brand')[0];
check('stored brand has the new color, provenance and all other fields intact',storedBrand.color==='#c2410c'&&storedBrand.visualProvenance.url==='https://brand.example.test/'&&storedBrand.name==='가상 분식'&&storedBrand.bg==='#eef2f6');
check('the run version advanced and keeps the proposal',rows('brand_learn_run')[0].version===3&&rows('brand_learn_run')[0].appliedVisual.previousColor==='#224466');
await assert.rejects(()=>server.applyLearnedVisual(owner,{runId:run.id,hex:'#c2410c'},{id:'m',email:null,role:'member'}),e=>e.status===403);passed.push('members cannot apply the visual (403)');

// 6) 템플릿 → 기존 브리프 저장 경로(save_campaign). 캠페인 초안이 [확인 필요] 자리표시를 담고 가격은 없다.
r=await post({action:'create_from_template',brandId,template:'nope'});
check('unknown template is a 400',r.status===400);
r=await post({action:'create_from_template',brandId,template:'new_menu'});
check('template creates a draft campaign through save_campaign',r.status===200&&typeof r.body.id==='string');
const campaigns=rows('campaign');
check('the campaign is a v1 draft for the brand with the template goal',campaigns.length===1&&campaigns[0].id===r.body.id&&campaigns[0].status==='draft'&&campaigns[0].version===1&&campaigns[0].brandId===brandId&&campaigns[0].goal.includes('가상 분식의 신메뉴')&&campaigns[0].goal.includes('[확인 필요]'));
check('plan fields are filled and protected fields empty',campaigns[0].plan.kpi.length>10&&campaigns[0].plan.baseline===''&&campaigns[0].plan.target===''&&campaigns[0].plan.owner===''&&campaigns[0].budget===null);
check('no won amounts in the draft',!/\d[\d,]*\s*원/.test(JSON.stringify(campaigns[0])));
check('an event records the brief creation',rows('event').some(e=>e.campaignId===campaigns[0].id&&/새 캠페인 브리프/.test(e.message)));
check('the template draft counts registered stores (0) as 미등록',campaigns[0].stores==='지점 미등록');

// 7) 읽기와 고정물 경로.
r=await get();
check('GET lists the run with enabled:true',r.status===200&&r.body.enabled===true&&r.body.offReason===null&&r.body.runs.length===1&&r.body.runs[0].status==='saved');
const fixture=await sampleRoute.GET();
check('the sample fixture route serves html marked as a fixture',fixture.headers.get('content-type').startsWith('text/html')&&fixture.headers.get('x-collective-fixture')==='brand-learn-sample'&&(await fixture.text()).includes('가상 분식 연구소'));
const before2=calls.length;
r=await post({action:'preview',brandId,url:origin+'/api/brand-learn/sample'});
check('a same-origin sample url is served from the fixture without any fetch',r.status===200&&r.body.run.fixture===true&&r.body.run.result.name.value==='가상 분식 연구소'&&calls.length===before2);
r=await post({action:'preview',brandId,url:'https://other.example.test/api/brand-learn/sample'});
check('the sample path on another origin is a normal fetch (and here blocked by the stub as 502)',r.status===502);
r=await post({action:'preview',brandId:'nope',url:'https://brand.example.test/'});
check('unknown brand is 404',r.status===404);
r=await post({action:'whatever'});
check('unknown action is 400',r.status===400);
console.log(JSON.stringify({passed:passed.length}));

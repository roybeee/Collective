// QA D8 회귀(docs/observations/2026-11-09-qa-global-eval.md): 성장·판매 탭이 열 때 부르는 GET /api/growth/signal-sources?campaignId=…가
// 모든 기능 스위치를 켠 소유자·지점 캠페인·상품 기록이 있어도 200이고, 캠페인 id가 없거나 빈 요청만 400이다(패널은 빈 id로 요청하지 않는다).
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더). 외부 호출 0회.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

const {load}=testRuntime(async()=>{throw Error('external forbidden')});
const server=await load('lib/server.ts'),flags=await load('lib/feature-flags.ts'),route=await load('app/api/growth/signal-sources/route.ts');
const passed=[];const check=(name,v)=>{assert.ok(v,name);passed.push(name)};
const owner='d8-owner',headers={'oai-authenticated-user-id':owner};
const put=(kind,id,v,parent='')=>server.recordStatement(owner,kind,id,v,parent).run();
await put('brand','ofd',{id:'ofd',name:'Old Ferry Donut'});await put('store','s1',{id:'s1',brandId:'ofd'},'ofd');
await put('campaign','c-d8',{id:'c-d8',brandId:'ofd',storeId:'s1',title:'맵달 매운 세트 10월 판매',goal:'300개',version:1,status:'draft',channels:''});
await put('growth_catalog','cat-spicy',{id:'cat-spicy',campaignId:'c-d8',brandId:'ofd',version:1,input:{sku:'MD-SPICY-SET'}},'c-d8');
for(const flag of Object.keys(flags.FEATURE_FLAGS))await flags.setFeatureFlag(owner,{flag,enabled:true},{id:owner,email:null});
check('every feature flag is on for the audit owner',(await flags.listFeatureFlags(owner)).every(f=>f.enabled));
const get=async query=>{const r=await route.GET(new Request(`https://agency.test/api/growth/signal-sources${query}`,{headers}));return {status:r.status,body:await r.json()}};
const ok=await get('?campaignId=c-d8');
check('a store campaign with all flags on reads its candidates with 200',ok.status===200&&ok.body.campaignId==='c-d8'&&Array.isArray(ok.body.candidates)&&ok.body.canImport===true);
check('an encoded campaign id with surrounding spaces still reads',(await get('?campaignId=%20c-d8%20')).status===200);
const missing=await get(''),empty=await get('?campaignId=');
check('only a missing or empty campaign id is a 400 with the input message',missing.status===400&&empty.status===400&&missing.body.error==='캠페인 입력을 확인해 주세요.');
check('an unknown campaign is a 404, not a 400',(await get('?campaignId=nope')).status===404);
// QA N3(docs/observations/2026-11-15-qa-global-eval.md 4절): 시장 자료 id에 Date.now() 13자리가 있어도(e2e/trust-ui.spec.ts 시드 모양) 목록은 200이고 그 자료를 가져올 수 있다.
// 형식이 맞지 않는 id의 자료 한 건은 목록을 막지 않고 보류 후보로만 보인다(원래 id는 응답에 싣지 않는다).
const market=(id,title)=>({id,brandId:'ofd',title,category:'market',origin:'manual',status:'confirmed',url:'https://example.com/market',content:'공개 자료에서 확인한 관찰',scope:'공개 웹 자료',observedAt:'2026-01-01T00:00:00Z',version:1});
const stampId='d8-src-1794677180051',oddId='odd id:1';
await put('brand_source',stampId,market(stampId,'타임스탬프 id 자료'),'ofd');await put('brand_source',oddId,market(oddId,'형식 밖 id 자료'),'ofd');await put('brand_source','src-plain',market('src-plain','평범한 자료'),'ofd');
const listed=await get('?campaignId=c-d8'),byTitle=t=>listed.body.candidates.find(x=>x.title===t);
check('a 13-digit Date.now() source id no longer 400s the whole list',listed.status===200&&listed.body.candidates.length===3);
check('the timestamp-id source is listed under its own id and is importable',byTitle('타임스탬프 id 자료')?.sourceId===stampId&&byTitle('타임스탬프 id 자료')?.status==='ready');
check('an unreadable id is held with an accurate reason and its raw id is not echoed',byTitle('형식 밖 id 자료')?.status==='held'&&/식별자 형식/.test(byTitle('형식 밖 id 자료').reasons[0])&&/^held_[0-9a-f]{32}$/.test(byTitle('형식 밖 id 자료').sourceId)&&!JSON.stringify(listed.body).includes(oddId));
check('other sources still read normally next to the bad one',byTitle('평범한 자료')?.status==='ready');
const postHeaders={...headers,origin:'https://agency.test','content-type':'application/json'},post=async b=>{const r=await route.POST(new Request('https://agency.test/api/growth/signal-sources',{method:'POST',headers:postHeaders,body:JSON.stringify(b)}));return {status:r.status,body:await r.json()}};
const imported=await post({campaignId:'c-d8',campaignVersion:1,sourceId:stampId,sourceVersion:1,expiresAt:'2099-01-01',requestId:'00000000-0000-4000-8000-000000000001'});
check('importing the timestamp-id source succeeds',imported.status===200&&imported.body.imported===true);
const odd=await post({campaignId:'c-d8',campaignVersion:1,sourceId:oddId,sourceVersion:1,expiresAt:'2099-01-01',requestId:'00000000-0000-4000-8000-000000000002'});
check('importing an unreadable id is a 400 format error, not a PII error',odd.status===400&&odd.body.error==='내부 식별자 형식을 확인하세요.');
const panel=readFileSync('app/growth-signal-source-panel.tsx','utf8');
check('the panel shows the server reason instead of the access hint for non-auth failures',/response\.status===401\|\|response\.status===403\|\|!reason/.test(panel));
check('the panel does not request with an empty campaign id',/if\(!campaignId\.trim\(\)\)\{setLoading\(false\);return;\}/.test(panel));
console.log(JSON.stringify({passed:passed.length,checks:passed,sqlite:'real',auth:'mocked',external:0},null,1));

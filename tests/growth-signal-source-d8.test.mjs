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
const panel=readFileSync('app/growth-signal-source-panel.tsx','utf8');
check('the panel does not request with an empty campaign id',/if\(!campaignId\.trim\(\)\)\{setLoading\(false\);return;\}/.test(panel));
console.log(JSON.stringify({passed:passed.length,checks:passed,sqlite:'real',auth:'mocked',external:0},null,1));

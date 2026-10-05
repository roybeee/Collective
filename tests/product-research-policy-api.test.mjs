import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';
let calls=0;
const {sql,load}=testRuntime(async()=>{calls++;throw new Error('unexpected provider call')});
const flags=await load('lib/feature-flags.ts'),route=await load('app/api/product-research/route.ts');
const owner='research-policy-owner',headers={'oai-authenticated-user-id':owner,origin:'https://agency.test','content-type':'application/json'};
await flags.setFeatureFlag(owner,{flag:'product_research',enabled:true},{id:owner,email:null});
let passed=0;
for(const credentialKey of ['youtube','naver_searchad']){
 const r=await route.POST(new Request('https://agency.test/api/product-research',{method:'POST',headers,body:JSON.stringify({action:'connect_source',credentialKey,input:{},requestId:randomUUID()})}));
 const b=await r.json();
 assert.equal(r.status,409,JSON.stringify(b));passed++;
 assert.match(b.error,/보류|목적|정책|사용할 수 없습니다/);passed++;
}
assert.equal(calls,0);passed++;
for(const kind of ['pr_quota','pr_credential']){assert.equal(sql.prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=?').get(owner,kind).n,0);passed++}
const r=await route.GET(new Request('https://agency.test/api/product-research',{headers}));
const view=await r.json();
for(const source of ['youtube_data','naver_searchad_keyword','naver_shop_search']){assert.equal(view.sources.find(x=>x.id===source).policy.allowed,false);passed++}
console.log(`product research policy API: ${passed} passed (real SQLite; mocked auth, provider calls ${calls})`);
const post=async body=>{const r=await route.POST(new Request('https://agency.test/api/product-research',{method:'POST',headers,body:JSON.stringify({requestId:randomUUID(),...body})}));return {status:r.status,body:await r.json()}};
const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const imported=await post({action:'import_file',sourceId:'coupang_ranking_manual',fileName:'policy.csv',scope:'소스',observedDate:today,text:'rank,title,brand,price,external_id,url\n1,마라소스 500g,시험브랜드,3900,policy-one,https://www.coupang.com/vp/products/1001'});
assert.equal(imported.status,200,JSON.stringify(imported.body));
const product=imported.body.products[0],card=product.score;
const put=(kind,id,data)=>sql.prepare('INSERT OR REPLACE INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${owner}:${kind}:${id}`,owner,kind,'',JSON.stringify(data),new Date().toISOString());
const blockedId=randomUUID();put('pr_snapshot',blockedId,{id:blockedId,sourceId:'youtube_data',fetchedAt:new Date().toISOString(),status:'ok',method:'api',request:{},limitations:[],observations:[],importedBy:null});
put('pr_score',card.id,{...card,subScores:card.subScores.map(s=>({...s,evidence:[blockedId]}))});
put('pr_brief','blocked-brief',{id:'blocked-brief',productIds:[product.id],scoreCardIds:[card.id],claims:[{text:'forbidden metric 999',citations:[blockedId]}],summary:'forbidden summary',createdAt:new Date().toISOString()});
put('pr_backtest','legacy-backtest',{id:'legacy-backtest',marker:'forbidden historical result'});
const hidden=await route.GET(new Request('https://agency.test/api/product-research',{headers}));
const hiddenView=await hidden.json();
assert.equal(hiddenView.products.find(p=>p.id===product.id).score,null);passed++;
assert.equal(hiddenView.products.find(p=>p.id===product.id).previousScore,null);passed++;
assert.equal(hiddenView.briefs.length,0);passed++;
assert.equal(hiddenView.backtests.length,0);passed++;
assert.equal(JSON.stringify(hiddenView).includes('forbidden'),false);passed++;
const approved=await post({action:'decide',productId:product.id,scoreCardId:card.id,briefId:null,status:'approved',reason:'검토를 완료하여 승인합니다.'});
assert.equal(approved.status,409,JSON.stringify(approved.body));passed++;
console.log(`product research policy API + legacy evidence: ${passed} passed`);

await flags.setFeatureFlag(owner,{flag:'product_research',enabled:false},{id:owner,email:null});
const inventory=await route.GET(new Request('https://agency.test/api/product-research?view=retention',{headers}));
assert.equal(inventory.status,200);passed++;
const report=await inventory.json();
assert.equal(report.automaticDeletion,false);passed++;
assert.equal(report.rows.find(r=>r.kind==='pr_snapshot').youtubeRecords,1);passed++;
assert.equal(JSON.stringify(report).includes('forbidden'),false);passed++;
const anonymous=await route.GET(new Request('https://agency.test/api/product-research?view=retention'));
assert.equal(anonymous.status,401);passed++;
console.log(JSON.stringify({passed,sqlite:'real',auth:'mocked',providerCalls:calls}));

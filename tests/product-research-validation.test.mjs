import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const rt=testRuntime(async()=>{throw new Error('unexpected external request')});
const domain=await rt.load('lib/product-research/validation.ts');
const server=await rt.load('lib/product-research/server-validation.ts');
const db=await rt.load('lib/server.ts');
const now=new Date('2026-10-05T00:00:00Z'),who={owner:'validation-owner',id:'validation-owner',role:'owner',email:null};
let passed=0;const check=(x,label)=>{assert.ok(x,label);passed++};
const truth=i=>({id:`truth-${i}`,sku:`SKU-${i}`,title:`상품 ${i}`,periodStart:'2026-08-01',periodEnd:'2026-08-31',decisionAt:'2026-07-31T00:00:00Z',criterionFrozenAt:'2026-07-31T00:00:00Z',criterion:'28일 순매출 기준 사전 고정',evidenceHash:'b'.repeat(64),label:i%2?'hit':'control',evidenceUrl:'https://example.com/evidence',reviewer:'실제 검수자',reviewedAt:'2026-09-01T00:00:00Z',origin:'human'});
const empty=await server.validationView(who,now);check(empty.version===0&&!empty.readiness.complete,'empty is incomplete with switches OFF');
await assert.rejects(()=>server.validationView({...who,role:'admin'},now),e=>e.status===403);passed++;
const entries=Array.from({length:50},(_,i)=>truth(i));
const request={requestId:crypto.randomUUID(),expectedVersion:0,section:'groundTruth',entries};
const saved=await server.saveValidation(who,request,now);check(saved.version===1&&saved.readiness.groundTruth.ready,'50 human exact SKU labels ready');
check((await server.saveValidation(who,request,now)).version===1,'replay returns original result');
await assert.rejects(()=>server.saveValidation(who,{...request,entries:[]},now),e=>e.status===409);passed++;
await assert.rejects(()=>server.saveValidation(who,{...request,requestId:crypto.randomUUID()},now),e=>e.status===409);passed++;
await assert.rejects(()=>server.saveValidation({...who,role:'member'},request,now),e=>e.status===403);passed++;
for(const input of [{...request,requestId:'bad'},{...request,entries:[truth(0),truth(0)]},{...request,entries:[{...truth(0),evidenceUrl:'javascript:bad'}]},{...request,entries:[{...truth(0),periodEnd:'2026-02-30'}]},{...request,entries:[{...truth(0),reviewedAt:'2030-01-01T00:00:00Z'}]}]){assert.throws(()=>domain.parseValidationMutation(input,now),e=>e.status===400);passed++}
const ai=domain.validationReadiness({legal:[],groundTruth:entries.map(t=>({...t,origin:'ai'})),blind:[]},[],now);check(!ai.groundTruth.ready&&ai.groundTruth.verified===0,'AI labels never human ground truth');
const duplicate=domain.validationReadiness({legal:[],groundTruth:entries.map(t=>({...t,sku:'ONE'})),blind:[]},[],now);check(!duplicate.groundTruth.ready,'same SKU cannot count 50 times');
const blind=Array.from({length:3},(_,i)=>({id:`blind-${i}`,evaluatorName:`평가자${i}`,packetHash:'a'.repeat(64),submittedFileHash:'c'.repeat(64),frozenAt:'2026-09-01T00:00:00Z',evaluatedAt:'2026-09-02T00:00:00Z',evidenceUrl:'https://example.com/rating',score:4.5}));
const b=await server.saveValidation(who,{requestId:crypto.randomUUID(),expectedVersion:1,section:'blind',entries:blind},now);check(!b.readiness.blind.ready&&b.readiness.blind.verified===0&&b.blind.every(x=>x.independence==='unverified_owner_submission'),'owner entered names are not authenticated independent raters');
check((await server.validationView({...who,owner:'other',id:'other'},now)).version===0,'owner isolation');
const audit=await db.listRecords(who.owner,'pr_validation_audit');check(audit.length===2&&audit[0].actorId===who.id,'append audit atomic for actual writes only');
check((await db.listRecords(who.owner,'pr_validation_request')).length===2,'replays append no receipts');
check((await server.validationView(who,now)).automaticPolicyRelease===false,'evidence does not release source policy');

const goodLegal=sourceId=>({id:sourceId,sourceId,reviewer:'법무 검토자',reviewedAt:'2026-09-01T00:00:00Z',validUntil:'2026-12-01T00:00:00Z',evidenceUrl:'https://example.com/legal',allowedScope:'허가 범위별 저장기간 및 분석 승인',decision:'approved'});
const legalInput={requestId:crypto.randomUUID(),expectedVersion:2,section:'legal',entries:['naver_datalab_search','naver_datalab_shopping'].map(goodLegal)};
const legalSaved=await server.saveValidation(who,legalInput,now);check(legalSaved.readiness.legal.ready&&!legalSaved.readiness.complete&&legalSaved.automaticPolicyRelease===false,'legal registered approval never overrides source policy or blind gate');
check(!domain.validationReadiness(legalSaved,[],new Date('2027-01-01T00:00:00Z')).legal.ready,'expired legal is not current approval');
check(!domain.validationReadiness({...legalSaved,legal:[...legalSaved.legal,{...goodLegal('naver_datalab_search'),id:'revoked',decision:'rejected',reviewedAt:'2026-10-01T00:00:00Z'}]},[],now).legal.ready,'newer rejection defeats old approval');
const onlyHits=domain.validationReadiness({...legalSaved,groundTruth:entries.map(x=>({...x,label:'hit'}))},[],now);check(!onlyHits.groundTruth.ready,'50 hits without controls incomplete');
check(!domain.validationReadiness({...legalSaved,groundTruth:[...entries,{...entries[0],id:'duplicate',label:'hit'}]},[],now).groundTruth.ready,'contradictory duplicate SKU cannot satisfy controls');
for(const change of [{criterionFrozenAt:'2026-08-02T00:00:00Z'},{decisionAt:'2026-08-01T12:00:00Z'},{reviewedAt:'2026-08-31T00:00:00Z'},{evidenceHash:'not-a-hash'}]){assert.throws(()=>domain.parseValidationMutation({...request,entries:[{...truth(0),...change}]},now),e=>e.status===400);passed++}
const measured={decisionId:'d',productId:'p',campaignId:'c',handedOffAt:'2026-01-01T00:00:00Z',sku:'SKU',reason:null,windows:[{weeks:4,complete:true,orders:1,units:1,revenue:100}]};
check(domain.validationReadiness(legalSaved,[measured],now).sales.ready,'completed actual order window counted');
check(!domain.validationReadiness(legalSaved,[{...measured,windows:[{...measured.windows[0],orders:0}]}],now).sales.ready,'empty order window does not fabricate launch sales');
check(!domain.validationReadiness(legalSaved,[{...measured,windows:[{...measured.windows[0],complete:false}]}],now).sales.ready,'unfinished sales window remains pending');

const addOne={requestId:crypto.randomUUID(),expectedVersion:3,section:'groundTruth',entries:[truth(50)]};
const added=await server.saveValidation(who,addOne,now);check(added.groundTruth.length===51,'adding one preserves previous 50 labels');
const sameAgain=await server.saveValidation(who,{...addOne,requestId:crypto.randomUUID(),expectedVersion:4},now);check(sameAgain.groundTruth.length===51,'same ID and same evidence does not duplicate');
await assert.rejects(()=>server.saveValidation(who,{...addOne,requestId:crypto.randomUUID(),expectedVersion:5,entries:[{...truth(50),label:'hit'}]},now),e=>e.status===409);passed++;
check(!domain.validationReadiness(legalSaved,[{...measured,reason:'incomplete ledger'}],now).sales.ready,'unreliable ledger results held');
check((await server.saveValidation(who,request,now)).version===5,'old request retry returns fresh state without another write');
check((await db.listRecords(who.owner,'pr_validation_request')).every(r=>!('state' in r)&&Number.isInteger(r.version)),'receipts do not duplicate accumulated evidence');
console.log(JSON.stringify({passed,sqlite:'real',provider:'not_called'}));

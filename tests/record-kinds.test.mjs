// 레코드 kind 레지스트리 회귀. 코드(app/, lib/, server/)가 records에 쓰거나 읽는 kind는 모두 lib/record-kinds.ts에 캠페인 삭제 정책을 가져야 한다.
// 새 kind를 추가하고 레지스트리에 적지 않으면 이 스위트가 실패한다. 레지스트리에만 남은 kind(코드에서 사라진 것)도 실패로 본다.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('외부 호출 금지')});
const registry=await rt.load('lib/record-kinds.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
// vm 컨텍스트의 배열·객체는 프로토타입이 달라 JSON으로 옮겨 비교한다.
const kinds=JSON.parse(JSON.stringify(registry.recordKinds));

// records가 아닌 테이블의 kind 값. auth_tokens.kind('invite'|'reset')는 레코드 종류가 아니다.
const notRecordKinds=new Set(['invite','reset']);
// records.kind를 드러내는 코드 형태. 새 접근 방식을 만들면 여기에도 추가한다.
const patterns=[
 /\b(?:recordStatement|readRecord|listRecords|optionalRecord)(?:<[^>]*>)?\(\s*[^,()]+,\s*'([a-z_]+)'/g, // 공용 헬퍼
 /\b(?:rows|record|one)(?:<[^>]*>)?\(\s*db\s*,\s*[^,()]+,\s*'([a-z_]+)'/g, // 모듈 내부 조회 헬퍼(ai-context, fact-import)
 /\bquery(?:<[^>]*>)?\(\s*'([a-z_]+)'/g, // 점포 운영 기간 조회
 /\bkind\s*=\s*'([a-z_]+)'/g, // SQL kind='x' (별칭 포함)
 /\bkind IN \(([^)]*)\)/g, // SQL kind IN ('a','b')
 /(?:owner\}|OWNER\}|owner\s*\|\|\s*'|\?\s*\|\|\s*')\s*:([a-z_]+):/g, // 레코드 id 규칙 `${owner}:kind:id`
 /INTO records\(id,owner,kind,parent_id,data,updated_at\)[^;]*?\.bind\([^,]+,\s*[^,]+,\s*'([a-z_]+)'/g, // 직접 INSERT의 kind 바인드
];
function scanKinds(source){
 const found=new Set();
 for(const re of patterns)for(const m of source.matchAll(re)){const values=m[1].includes("'")?[...m[1].matchAll(/'([a-z_]+)'/g)].map(x=>x[1]):[m[1]];for(const v of values)if(!notRecordKinds.has(v))found.add(v)}
 return found;
}
const registered=new Set(kinds.map(k=>k.kind));
const missing=found=>[...found].filter(k=>!registered.has(k)).sort();

// 1) 스캐너 자체 검증: 각 형태를 잡고, 정책 없는 kind를 넣으면 누락으로 보고한다.
const synthetic=[
 "recordStatement(owner,'artifact',a.id,a,c.id)","await readRecord<Campaign>(owner,'campaign',id)","listRecords<X>(owner, 'event', cid)",
 "rows<BrandFact>(db,owner,'brand_fact',brandId)","query<StoreOrder>('store_order','orderDate')","\"SELECT id FROM records WHERE owner=? AND kind='deleted_campaign'\"",
 "\"kind IN ('worker_credential','worker_state')\"","`${owner}:provider_usage:${id}`","workspace_owner||':account_event:'||?",
 "'INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(key,owner,'usage_pricing','',x)",
 "t.kind IN ('invite','reset')",
].join('\n');
const syntheticFound=scanKinds(synthetic);
check('scanner recognises every access form',['artifact','campaign','event','brand_fact','store_order','deleted_campaign','worker_credential','worker_state','provider_usage','account_event','usage_pricing'].every(k=>syntheticFound.has(k)));
check('scanner ignores auth token kinds',!syntheticFound.has('invite')&&!syntheticFound.has('reset'));
check('a kind without a registry policy is reported',JSON.stringify(missing(scanKinds("recordStatement(owner,'unregistered_probe',id,data,cid)")))===JSON.stringify(['unregistered_probe']));

// 2) 실제 소스 전수 조사. 레지스트리 파일 자체는 스캔하지 않는다(자기 참조로 통과하지 않게).
const walk=d=>readdirSync(d).flatMap(f=>{const p=join(d,f);return statSync(p).isDirectory()?walk(p):/\.(ts|tsx|py)$/.test(f)?[p]:[]});
const files=['app','lib','server'].flatMap(walk).filter(f=>f!==join('lib','record-kinds.ts'));
const inCode=new Set(files.flatMap(f=>[...scanKinds(readFileSync(f,'utf8'))]));
const unregistered=missing(inCode);
assert.deepEqual(unregistered,[],'레지스트리에 정책이 없는 kind: '+unregistered.join(', '));passed.push('every kind used in app/lib/server has a deletion policy');
const stale=[...registered].filter(k=>!inCode.has(k)).sort();
assert.deepEqual(stale,[],'코드에서 쓰지 않는 레지스트리 kind: '+stale.join(', '));passed.push('registry has no kinds the code no longer uses');
check('source scan covers the known record surface',inCode.size>=60);

// 3) 항목 형식
const policies=['delete','retain','retire_and_mark','not_campaign_scoped'];
check('registry kinds are unique',registered.size===kinds.length);
check('every entry has a known policy',kinds.every(k=>policies.includes(k.campaignDeletion)));
check('every entry has a known parent type',kinds.every(k=>JSON.parse(JSON.stringify(registry.recordParents)).includes(k.parent)));
check('every entry is described in Korean',kinds.every(k=>typeof k.description==='string'&&/[가-힣]/.test(k.description)));
const linkNames=Object.keys(registry.linkClauses);
check('campaign links are known',kinds.every(k=>(k.links||[]).every(l=>linkNames.includes(l))));
check('unscoped kinds carry no campaign link',kinds.filter(k=>k.campaignDeletion==='not_campaign_scoped').every(k=>!(k.links||[]).length));
check('deleted and retired kinds say how they reach the campaign',kinds.filter(k=>['delete','retire_and_mark'].includes(k.campaignDeletion)).every(k=>(k.links||[]).length>0));

// 4) 결정 7(b)와 삭제 보호가 레지스트리에 그대로 적혀 있다.
const policyOf=kind=>kinds.find(k=>k.kind===kind)?.campaignDeletion;
check('only viral learning rules are retired and marked',JSON.stringify(kinds.filter(k=>k.campaignDeletion==='retire_and_mark').map(k=>k.kind))===JSON.stringify(['learning_rule']));
check('frozen experiment summary is a retained brand record',policyOf('viral_experiment_summary')==='retain'&&kinds.find(k=>k.kind==='viral_experiment_summary').parent==='brand');
check('store experiments and tombstones are retained',policyOf('store_experiment')==='retain'&&policyOf('deleted_campaign')==='retain');
check('viral experiments and their revisions are deleted',policyOf('viral_experiment')==='delete'&&policyOf('experiment_revision')==='delete');
check('execution and attributed order history blocks deletion',JSON.stringify(kinds.filter(k=>k.blocksDeletion).map(k=>k.kind).sort())===JSON.stringify(['execution_creative','execution_publication','store_order']));
check('blocking kinds are never deleted',kinds.filter(k=>k.blocksDeletion).every(k=>k.campaignDeletion==='retain'));
// A4: 추적 코드는 주문 장부의 귀속 근거라 캠페인을 지워도 남긴다(코드 재사용으로 옛 인쇄물 주문이 다른 캠페인에 붙지 않게). 삭제를 막지는 않는다.
const kindOf=kind=>kinds.find(k=>k.kind===kind);
check('tracking codes are retained through their campaign link without blocking deletion',policyOf('tracking_code')==='retain'&&JSON.stringify(kindOf('tracking_code').links)==='["data_campaign"]'&&!kindOf('tracking_code').blocksDeletion&&kindOf('tracking_code').parent==='store');
// F4b-2(결정 7): 비식별 평가 신호는 캠페인과 잇지 않고(links 없음) 보존하며, token_budget 묶음(마지막 3개) 바로 앞에 둔다.
check('de-identified signals are retained without a campaign link just before the token budget group',policyOf('deidentified_signal')==='retain'&&!(kindOf('deidentified_signal').links||[]).length&&kindOf('deidentified_signal').parent==='none'&&kinds.at(-4).kind==='deidentified_signal'&&/90일/.test(kindOf('deidentified_signal').description));
// Q2 평가 월 승인(eval_budget_approval): 캠페인과 무관한 소유자 기록(UTC 월당 1행)이라 완전 삭제 동작(purge)이 없다. token_budget 묶음과 비식별 신호 앞에 둔다.
check('eval budget approvals are owner records outside campaign deletion, placed before the token budget group',policyOf('eval_budget_approval')==='not_campaign_scoped'&&kindOf('eval_budget_approval').parent==='none'&&!kindOf('eval_budget_approval').links&&kindOf('eval_budget_approval').purge===undefined&&kinds.at(-5).kind==='eval_budget_approval'&&/월/.test(kindOf('eval_budget_approval').description));
// F4b-2(결정 7): 남기는 kind(retain·retire_and_mark)는 모두 '학습 자산까지 완전 삭제' 때의 동작(purge)을 정한다. 새 보존 kind가 완전 삭제에서 조용히 빠지지 않게 한다.
const purges=['keep','delete','not_created','delete_all'],kept=kinds.filter(k=>k.campaignDeletion==='retain'||k.campaignDeletion==='retire_and_mark');
check('every retained or retired kind declares its complete-deletion behaviour',kept.every(k=>purges.includes(k.purge))&&kinds.filter(k=>k.purge!==undefined).length===kept.length);
check('complete deletion removes the learning assets of decision 7',JSON.stringify(Object.fromEntries(kinds.filter(k=>k.purge&&k.purge!=='keep').map(k=>[k.kind,k.purge])))==='{"learning_rule":"delete","viral_experiment_summary":"not_created","review_decision":"delete","deidentified_signal":"not_created"}');
check('kinds deleted per campaign are campaign-linked and owner-wide ones are not',kinds.filter(k=>k.purge==='delete').every(k=>k.links?.length)&&kinds.filter(k=>k.purge==='delete_all'||k.purge==='not_created').every(k=>!k.links?.length));
check('descriptions state the complete-deletion exception',kinds.filter(k=>k.purge&&k.purge!=='keep').every(k=>/완전 삭제/.test(k.description)));
const plainOf=x=>JSON.parse(JSON.stringify(x)),purgeScopes=[...plainOf(registry.campaignScopes('retire_and_mark','o','c',k=>k.purge==='delete')),...plainOf(registry.campaignScopes('retain','o','c',k=>k.purge==='delete'))].flatMap(s=>s.kinds).sort();
check('complete-deletion scopes come from the registry',JSON.stringify(purgeScopes)==='["learning_rule","review_decision"]'&&JSON.stringify(plainOf(registry.purgeAllKinds))==='[]');
check('order imports and POS weekly totals are store records outside campaign deletion',['order_import','pos_weekly_total'].every(k=>policyOf(k)==='not_campaign_scoped'&&kindOf(k).parent==='store'));
// 트랙 R(가맹, R1a·R4b): 모든 franchise_* kind는 보존·정보주체 삭제 축을 선언하고 캠페인과 무관하다. 기존 kind는 두 축이 없다. 비식별 신호·eval_budget_approval 앞에 둔다.
const franchise=kinds.filter(k=>k.kind.startsWith('franchise_')),franchiseNames=['franchise_profile','franchise_disclosure_version','franchise_contract_template','franchise_privacy_notice','franchise_lead','franchise_lead_key','franchise_lead_event','franchise_delivery','franchise_subject_request','franchise_audit'];
check('record parents include franchise_lead',JSON.parse(JSON.stringify(registry.recordParents)).includes('franchise_lead'));
check('the ten track R kinds are registered',JSON.stringify(franchise.map(k=>k.kind).sort())===JSON.stringify([...franchiseNames].sort()));
check('every franchise kind declares retention and subject erasure',franchise.every(k=>k.retention&&['statutory','policy'].includes(k.retention.basis)&&typeof k.retention.anchor==='string'&&k.retention.anchor.length>0&&typeof k.retention.ref==='string'&&k.retention.ref.length>0&&(k.retention.days===null||typeof k.retention.days==='number')&&['delete','minimize','legal_hold','none'].includes(k.subjectErasure)));
check('no kind outside track R declares the retention axes',kinds.filter(k=>!/^(franchise|recruitment)_/.test(k.kind)).every(k=>k.retention===undefined&&k.subjectErasure===undefined));
check('franchise kinds are outside campaign deletion without links or purge',franchise.every(k=>k.campaignDeletion==='not_campaign_scoped'&&!k.links&&k.purge===undefined&&/캠페인과 무관/.test(k.description)));
check('lead keys, events and deliveries hang off the lead',['franchise_lead_key','franchise_lead_event','franchise_delivery'].every(k=>kindOf(k).parent==='franchise_lead')&&kindOf('franchise_lead').parent==='brand');
check('lead contacts are minimized, keys deleted and evidence held on subject erasure',kindOf('franchise_lead').subjectErasure==='minimize'&&kindOf('franchise_lead_key').subjectErasure==='delete'&&kindOf('franchise_delivery').subjectErasure==='legal_hold'&&kindOf('franchise_lead_event').subjectErasure==='none'&&kindOf('franchise_lead').retention.days===180&&kindOf('franchise_audit').retention.days===365);
check('the franchise block sits before the eval budget approval and signal group',Math.max(...franchise.map(k=>kinds.indexOf(k)))<kinds.findIndex(k=>k.kind==='eval_budget_approval')&&kinds.findIndex(k=>k.kind==='playbook_audit')<Math.min(...franchise.map(k=>kinds.indexOf(k))));
// 트랙 R R15a-2a: 모집 자료·행사는 브랜드 행이고 캠페인과 무관하다(캠페인 id는 참조, 캠페인을 지워도 승인·내보내기·게시 증빙으로 남는다). franchise_audit 바로 뒤, data_request 앞에 둔다.
const recruitment=['recruitment_asset','recruitment_event'].map(kindOf),auditAt=kinds.findIndex(k=>k.kind==='franchise_audit');
check('the two R15a kinds declare retention and no subject erasure, hang off the brand and stay outside campaign deletion',recruitment.every(k=>k&&k.retention&&k.retention.basis==='policy'&&k.retention.anchor==='attributed_lead_evidence'&&k.retention.days===null&&typeof k.retention.ref==='string'&&k.retention.ref.length>0&&k.subjectErasure==='none'&&k.parent==='brand'&&k.campaignDeletion==='not_campaign_scoped'&&!k.links&&k.purge===undefined&&!k.blocksDeletion&&/캠페인과 무관/.test(k.description)));
check('the R15a kinds sit right after franchise_audit and before data_request',kinds[auditAt+1].kind==='recruitment_asset'&&kinds[auditAt+2].kind==='recruitment_event'&&kinds[auditAt+3].kind==='data_request');

// 5) 조건 생성: 같은 link의 kind를 묶고, kind가 id에 들어가는 link는 kind별로 나눈다.
const scopes=JSON.parse(JSON.stringify(registry.campaignScopes('delete','o','c')));
const parentScope=scopes.find(s=>s.link==='parent');
check('parent-linked deletions share one statement',!!parentScope&&parentScope.kinds.includes('artifact')&&parentScope.kinds.includes('measurement_draft')&&parentScope.binds[0]==='c');
check('job-linked submissions are split per kind',scopes.filter(s=>s.link==='guidance_job').every(s=>s.kinds.length===1)&&scopes.filter(s=>s.link==='guidance_job').length===3);
check('derived links run before the records they depend on',scopes.findIndex(s=>s.link==='experiment_child')<scopes.findIndex(s=>s.link==='parent')&&scopes.findIndex(s=>s.link==='draft_submission')<scopes.findIndex(s=>s.link==='brief_draft')&&scopes.at(-1).link==='self');
const ruleScope=JSON.parse(JSON.stringify(registry.campaignScopes('retire_and_mark','o','c')));
check('rule marking excludes store-origin rules',ruleScope.length===1&&ruleScope[0].where.includes("'store'"));

// 6) 동결 요약은 원문(대조안·실험안·조건·메모·수치 출처)을 담지 않는다.
const experiment={id:'e',brandId:'b',campaignId:'c',caseId:'case',analysisId:'a',title:'제목',channel:'Instagram',hypothesis:'가설',variable:'바꿀 요소',control:'대조 원문',treatment:'실험 원문',metric:'share_rate',minSample:100,minHours:24,minLift:10,conditions:'조건 원문',version:3,status:'evaluated',startedAt:'2026-09-01T00:00:00.000Z',createdAt:'x',updatedAt:'y',result:{control:{denominator:1000,numerator:10,source:'출처 원문'},treatment:{denominator:900,numerator:20,source:'출처 원문'},comparable:true,notes:'메모 원문',observedUntil:'2026-09-03T00:00:00.000Z',recordedAt:'z'},assessment:{status:'promising',label:'관찰상 개선',controlRate:0.01,treatmentRate:0.022,lift:120,reasons:['근거']}};
const mark={at:'2026-09-24T00:00:00.000Z',by:{id:'u',email:null}};
const summary=JSON.parse(JSON.stringify(registry.freezeExperimentSummary(experiment,['e:3'],mark)));
check('summary keeps hypothesis metric judgement and period',summary.id==='e'&&summary.hypothesis==='가설'&&summary.metric==='share_rate'&&summary.assessment.status==='promising'&&summary.assessment.lift===120&&summary.startedAt==='2026-09-01T00:00:00.000Z'&&summary.observedUntil==='2026-09-03T00:00:00.000Z');
check('summary keeps sample sizes and adopted rule ids',summary.controlSample===1000&&summary.treatmentSample===900&&JSON.stringify(summary.adoptedRuleIds)==='["e:3"]'&&summary.campaignId==='c'&&summary.sourceCampaignDeleted.at===mark.at);
check('summary drops raw experiment text',!/원문/.test(JSON.stringify(summary))&&!('control' in summary)&&!('treatment' in summary)&&!('conditions' in summary)&&!('result' in summary));
check('summary of an unmeasured experiment has empty judgement',JSON.parse(JSON.stringify(registry.freezeExperimentSummary({...experiment,result:null,assessment:null,startedAt:null},[],mark))).assessment===null);

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));

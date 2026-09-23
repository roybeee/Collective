// 학습 규칙 카드의 표시 판정(lib/learning-view.ts). 원 캠페인이 삭제된 보존 규칙(결정 7)은 버튼 대신 서버 안내를 보인다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const m=moduleFor('lib/learning-view.ts');await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();
const {ruleState,SOURCE_DELETED_NOTICE,frozenSummaryFor,frozenSummaryLines}=m.namespace;
let passed=0;
function check(name,actual,expected){assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,name);passed++}

const now=Date.parse('2026-09-24T00:00:00.000Z'),day=86400000;
const rule=(over={})=>({origin:'viral',id:'exp:1',brandId:'oda',channel:'Instagram',experimentId:'exp',experimentVersion:1,caseId:'case',title:'첫 장면 단면',guidance:'단면을 먼저 보여 준다',scope:'',evidenceLevel:'observational',status:'active',version:1,expiresAt:new Date(now+20*day).toISOString(),createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z',...over});
const none={retest:false,renew:false,retire:false,pause:false};
const mark={at:'2026-09-23T05:30:00.000Z',by:{id:'owner',email:'owner@example.com'}};

// --- 원 캠페인 삭제 표시(결정 7) -------------------------------------------------------
const deleted=ruleState(rule({status:'retired',version:2,scope:'',sourceCampaignDeleted:mark}),now);
check('deleted source shows the badge instead of the retired label',deleted.label,'원 캠페인 삭제됨');
check('deleted source carries the deletion time',[deleted.sourceDeleted,deleted.deletedAt],[true,mark.at]);
check('deleted source offers no retest, renew, retire or pause',deleted.actions,none);
check('deleted source shows the server notice',deleted.notice,SOURCE_DELETED_NOTICE);
// 서버가 409로 거절할 규칙은 상태와 상관없이 버튼을 숨긴다(만료 임박 활성 규칙에 표시가 붙어도).
const odd=ruleState(rule({status:'active',expiresAt:new Date(now-day).toISOString(),sourceCampaignDeleted:mark}),now);
check('a marked rule never shows actions even when active and due',[odd.label,odd.actions],['원 캠페인 삭제됨',none]);
check('an unreadable deletion time is null',ruleState(rule({status:'retired',sourceCampaignDeleted:{at:'not-a-date',by:null}}),now).deletedAt,null);
check('a deletion mark without a time is null',ruleState(rule({status:'retired',sourceCampaignDeleted:{by:null}}),now).deletedAt,null);
// 화면 안내는 서버(assertSourceCampaign) 409 문구와 같은 뜻이어야 한다. 서버 문구가 바뀌면 여기서 드러난다.
const server=readFileSync('lib/learning-server.ts','utf8').match(/function assertSourceCampaign[^]*?ApiError\(409,'([^']+)'\)/);
check('notice matches the assertSourceCampaign 409 message',server?.[1],SOURCE_DELETED_NOTICE);

// --- 기존 상태(표시 없음) -----------------------------------------------------------------
const plain=ruleState(rule(),now);
check('active rule outside the review window can only be paused',[plain.label,plain.actions,plain.sourceDeleted,plain.deletedAt,plain.notice],['시험 적용 중',{...none,pause:true},false,null,'']);
check('active rule near expiry offers retest, renew, retire and pause',ruleState(rule({expiresAt:new Date(now+3*day).toISOString()}),now),{label:'시험 적용 중',sourceDeleted:false,deletedAt:null,notice:'',actions:{retest:true,renew:true,retire:true,pause:true}});
check('expired active rule needs review',ruleState(rule({expiresAt:new Date(now-day).toISOString()}),now).label,'재검토 필요');
check('store rule is retested from store marketing, not here',ruleState(rule({origin:'store',expiresAt:new Date(now-day).toISOString()}),now).actions,{retest:false,renew:true,retire:true,pause:true});
check('paused rule shows no actions',[ruleState(rule({status:'paused'}),now).label,ruleState(rule({status:'paused'}),now).actions],['적용 중지',none]);
check('retired rule without a mark keeps the correction label',[ruleState(rule({status:'retired'}),now).label,ruleState(rule({status:'retired'}),now).notice],['근거 정정 · 적용 종료','']);

// --- 화면 연결(tests/deletion-summary.test.mjs와 같은 원문 검사) -------------------------------------
// 규칙 카드가 ruleState 결과로만 배지·안내·버튼을 그리는지 본다. 예전 인라인 조건으로 돌아가면 여기서 드러난다.
const panel=readFileSync('app/learning-panel.tsx','utf8');
const has=(name,text)=>{assert.ok(panel.includes(text),name);passed++};
const lacks=(name,text)=>{assert.ok(!panel.includes(text),name);passed++};
has('the rule card uses ruleState','const s=ruleState(r)');
has('the badge comes from ruleState','<span className="learning-tag">{s.label}</span>');
has('the deleted-source notice is rendered','{s.sourceDeleted&&<p className="learning-note" role="note">{s.notice}</p>}');
has('the deletion time replaces the review date',"s.sourceDeleted?`원 캠페인 삭제 ${s.deletedAt?date(s.deletedAt):'시각 미확인'}`");
for(const action of ['retest','renew','retire','pause'])has(`the ${action} button follows ruleState`,`{s.actions.${action}&&<Button`);
lacks('the inline review condition is gone',"{r.status==='active'&&ruleNeedsReview(r)&&<>");
lacks('the inline pause condition is gone',"{r.status==='active'&&<Button");

// 동결 요약: 보존 규칙은 experimentId로 요약을 찾고, 요약 줄은 원문 없이 수치 판정만 보여 준다.
const summary={id:'e1',experimentId:'e1',experimentVersion:2,brandId:'ofd',campaignId:'gone',channel:'Instagram',title:'저장 유도 첫 장면',hypothesis:'원문 가설',metric:'saves',minSample:100,minHours:24,minLift:10,status:'completed',assessment:{status:'promising',label:'관찰상 개선',controlRate:0.1,treatmentRate:0.2,lift:100},controlSample:100,treatmentSample:120,startedAt:'2026-09-01T00:00:00.000Z',observedUntil:'2026-09-08T00:00:00.000Z',adoptedRuleIds:['r1'],frozenAt:'2026-09-24T00:00:00.000Z',sourceCampaignDeleted:mark};
check('a retained rule finds its frozen summary by experiment id',frozenSummaryFor(rule({experimentId:'e1',sourceCampaignDeleted:mark}),[summary])?.id,'e1');
check('a rule without a deletion mark has no frozen summary',frozenSummaryFor(rule({experimentId:'e1'}),[summary]),null);
check('a missing summary is null, not an error',frozenSummaryFor(rule({experimentId:'other',sourceCampaignDeleted:mark}),[summary]),null);
check('summary lines show title, verdict, rates with samples and period without the raw hypothesis',frozenSummaryLines(summary),['실험: 저장 유도 첫 장면 (v2)','판정: 관찰상 개선','대조 10.0% (n=100) · 실험 20.0% (n=120) · 차이 +100%','관찰 기간: 2026-09-01 ~ 2026-09-08']);
check('unknown numbers read as unknown',frozenSummaryLines({...summary,assessment:null,controlSample:null,treatmentSample:null,startedAt:null,observedUntil:null}),['실험: 저장 유도 첫 장면 (v2)','판정: 기록 없음']);

console.log(JSON.stringify({passed}));

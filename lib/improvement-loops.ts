// B4-2c 닫힌 개선 루프 대장(순수 모듈, docs/REWARD-LINEAGE.ko.md 11절). 개선 한 번(프롬프트 버전 활성화·승격, 운영자 선호 규칙 승인)의 전후 14일 보상을 나란히 세운다.
// 후보: 평가 run과 대표 승인이 있는 prompt_release_event activate·promote(stage는 아니다), 그리고 playbook_audit activate. 롤백(규칙은 중지)된 버전은 닫힌 루프로 세지 않는다.
// 비교는 B4-2a buildRewardLineage를 창마다 다시 부른 L0(1차 판정)·L1(발행)·L3(주문 경로)이고 probTreatmentBetter는 설명용이다. 권고·판정 필드와 자동 승격·강등은 없다.
// 닫기(동결)는 서버(lib/reward-lineage-server.ts)가 소유자 요청으로 improvement_loop 행에 남기고, 닫은 루프는 그 동결 수치를 그대로 보인다. 시계는 호출자가 today로 넘긴다.
import {buildRewardLineage,canonicalInput,DECISION16_NOTICE,MIN_SAMPLE,usesVersion,type RewardInput,type RewardLineage,type RewardTotals} from './reward-lineage';
import {ATTRIBUTION_NOT_INCREMENTAL,addDays,koreaMinute} from './store-attribution';
import {probTreatmentBetter} from './viral-stats';
import type {ReleaseEventRecord} from './prompt-registry';

export const IMPROVEMENT_LOOPS_SCHEMA='collective.improvement-loops.v1';
// 창 길이(한국 날짜): 전 = 활성화 전날까지 14일, 후 = 활성화 날부터 14일. 후 창이 끝나기 전(오늘 ≤ 후 창 끝)은 open이다.
export const LOOP_WINDOW_DAYS=14;
// 이보다 오래된 활성화는 닫지 않은 한 목록에 싣지 않는다(서버 조회 기간과 같은 상한).
export const LOOP_MAX_AGE_DAYS=180;
// 4단계 종료 조건(GROWTH-PLAN): 닫힌 개선 루프 누적 5건. 롤백되지 않은 닫은 루프만 센다.
export const LOOP_EXIT_TARGET=5;
export const LOOP_NOTICE='자동 판정 아님: 개선 루프는 활성화 전후 14일의 기록을 나란히 세운 설명용 비교입니다. 같은 기간의 다른 변화가 섞이므로 차이는 인과·증분이 아니고, 닫기는 대표가 그때 수치를 동결해 남기는 기록일 뿐 프롬프트·규칙을 바꾸지 않습니다.';
export const LOOP_ROLLBACK_NOTICE='롤백된 프롬프트 버전과 중지된 운영자 선호 규칙은 닫힌 루프로 세지 않습니다(닫은 뒤 롤백돼도 종료 조건에서 빠집니다).';

export type LoopReleaseEvent=Pick<ReleaseEventRecord,'id'|'unit'|'action'|'from'|'to'|'evalRunId'|'approval'|'at'>;
// playbook_audit 행(lib/learning-server.ts auditStatement)의 필요한 필드와, 서버가 규칙에서 붙이는 역할(없으면 모든 역할).
export type LoopPlaybookAudit={id:string;ruleId:string;brandId:string;action:string;ruleVersion:number;createdAt:string;role?:string|null};
export type LoopSource={kind:'prompt';eventId:string;unit:string;action:'activate'|'promote';from:string|null;to:string;evalRunId:string}
 |{kind:'playbook';auditId:string;ruleId:string;ruleVersion:number;role:string|null;brandId:string};
export type LoopWindows={before:{from:string;to:string};after:{from:string;to:string}};
export type LoopSide={decidedFirst:number;approvedFirst:number;editedFirst:number;revisions:number;firstPassRate:number|null;status:'measured'|'insufficient';
 publish:{publications:number;approved:number;live:number};order:{attributedOrders:number;netRevenue:number;contribution:number|null;unknownCostOrders:number}};
export type LoopComparison={before:LoopSide;after:LoopSide;probTreatmentBetter:number|null};
export type LoopStatus='open'|'insufficient'|'closable'|'closed'|'rolled_back';
export type LoopCandidate={id:string;source:LoopSource;activatedAt:string;activatedDay:string;windows:LoopWindows;rolledBack:boolean};
// improvement_loop 행(추가만, parent 없음, 원문 없음): 닫을 때의 비교 수치와 inputDigest를 동결한다. 닫은 사람은 id·역할만.
export type ImprovementLoopRecord={id:string;version:1;source:LoopSource;activatedAt:string;activatedDay:string;windows:LoopWindows;scope:RewardLineage['scope'];comparison:LoopComparison;inputDigest:string;closedBy:{id:string;role:'owner'};closedAt:string};
export type ImprovementLoop=LoopCandidate&{status:LoopStatus;version:0|1;comparison:LoopComparison;inputDigest:string|null;closed:{at:string;by:{id:string;role:'owner'};scope:RewardLineage['scope']}|null;countsToExit:boolean};
export type ImprovementLoops={schema:typeof IMPROVEMENT_LOOPS_SCHEMA;today:string;loops:ImprovementLoop[];exit:{target:number;closed:number;counted:number};notices:string[]};
export type LoopInput={today:string;brandId:string;releaseEvents:readonly LoopReleaseEvent[];playbookAudits:readonly LoopPlaybookAudit[];closures:readonly ImprovementLoopRecord[];reward:RewardInput|null};

const byText=(a:string,b:string)=>a<b?-1:a>b?1:0;
const sum=(values:readonly number[])=>values.reduce((n,v)=>n+v,0);
const kstDay=(iso:unknown)=>koreaMinute(iso).slice(0,10);
export function loopWindows(day:string):LoopWindows{
 return {before:{from:addDays(day,-LOOP_WINDOW_DAYS),to:addDays(day,-1)},after:{from:day,to:addDays(day,LOOP_WINDOW_DAYS-1)}};
}
const PROMPT_ACTIONS=new Set(['activate','promote']);
// 롤백: 같은 단위에서 이 루프의 버전(to)을 되돌린 rollback이 활성화 뒤에 있다. 규칙은 활성화 뒤의 중지(pause)다.
function promptRolledBack(e:LoopReleaseEvent,events:readonly LoopReleaseEvent[]){return events.some(x=>x.action==='rollback'&&x.unit===e.unit&&x.from===e.to&&x.at>e.at)}
function playbookRolledBack(a:LoopPlaybookAudit,audits:readonly LoopPlaybookAudit[]){return audits.some(x=>x.action==='pause'&&x.ruleId===a.ruleId&&x.createdAt>a.createdAt)}
const candidate=(id:string,source:LoopSource,at:string,rolledBack:boolean):LoopCandidate=>{const day=kstDay(at);return {id,source,activatedAt:at,activatedDay:day,windows:loopWindows(day),rolledBack}};
// 루프 후보. 프롬프트는 워크스페이스 전체, 운영자 선호 규칙은 이 브랜드만이다. 최근 활성화부터(시각, id 순).
export function loopCandidates(input:Pick<LoopInput,'releaseEvents'|'playbookAudits'|'brandId'|'today'>):LoopCandidate[]{
 const prompts=input.releaseEvents.filter(e=>PROMPT_ACTIONS.has(e.action)&&!!e.evalRunId&&!!e.approval&&!!e.to&&!!e.unit&&!!kstDay(e.at))
  .map(e=>candidate('prompt:'+e.id,{kind:'prompt',eventId:e.id,unit:e.unit as string,action:e.action as 'activate'|'promote',from:e.from,to:e.to as string,evalRunId:e.evalRunId as string},e.at,promptRolledBack(e,input.releaseEvents)));
 const playbooks=input.playbookAudits.filter(a=>a.action==='activate'&&a.brandId===input.brandId&&!!kstDay(a.createdAt))
  .map(a=>candidate('playbook:'+a.id,{kind:'playbook',auditId:a.id,ruleId:a.ruleId,ruleVersion:a.ruleVersion,role:a.role||null,brandId:a.brandId},a.createdAt,playbookRolledBack(a,input.playbookAudits)));
 return [...prompts,...playbooks].sort((a,b)=>byText(b.activatedAt,a.activatedAt)||byText(a.id,b.id));
}
const recent=(c:LoopCandidate,today:string)=>c.activatedDay>=addDays(today,-LOOP_MAX_AGE_DAYS);
// 서버가 한 번에 읽을 기간: 목록에 실을 후보 창을 모두 덮는 [가장 이른 전 창 시작, 오늘]. 후보가 없으면 null.
export function loopSpan(candidates:readonly LoopCandidate[],today:string){
 const live=candidates.filter(c=>recent(c,today));
 return live.length?{from:live.map(c=>c.windows.before.from).sort(byText)[0],to:today}:null;
}

// 루프 한 건의 입력: 루프 창 [전 창 시작, 후 창 끝] 안의 발행·주문·실험과 후 창 끝까지의 판정(1차 판정은 이전 판정까지 봐야 정해진다).
function windowInput(input:RewardInput,from:string,to:string):RewardInput{
 const inside=(day:string)=>!!day&&day>=from&&day<=to,orders=(input.orders||[]).filter(o=>inside(o.orderDate));
 const gated=new Set(orders.map(o=>o.codeAttribution?.publicationId).filter((x):x is string=>!!x));
 return {...input,period:{from,to},decisions:input.decisions.filter(d=>{const day=kstDay(d.createdAt);return !!day&&day<=to}),orders,
  publications:(input.publications||[]).filter(p=>inside(kstDay(p.scheduledAt))||gated.has(p.id)),experiments:(input.experiments||[]).filter(e=>inside(kstDay(e.createdAt)))};
}
function sideOf(rows:readonly RewardTotals[]):LoopSide{
 const h=rows.map(r=>r.human),decidedFirst=sum(h.map(x=>x.decidedFirst)),approvedFirst=sum(h.map(x=>x.approvedFirst)),enough=decidedFirst>=MIN_SAMPLE,o=rows.map(r=>r.order);
 return {decidedFirst,approvedFirst,editedFirst:sum(h.map(x=>x.editedFirst)),revisions:sum(h.map(x=>x.revisions)),firstPassRate:enough?Math.round(approvedFirst/decidedFirst*10000)/10000:null,status:enough?'measured':'insufficient',
  publish:{publications:sum(rows.map(r=>r.publish.publications)),approved:sum(rows.map(r=>r.publish.approved)),live:sum(rows.map(r=>r.publish.live))},
  order:{attributedOrders:sum(o.map(x=>x.attributedOrders)),netRevenue:sum(o.map(x=>x.netRevenue)),contribution:o.some(x=>x.contribution===null)?null:sum(o.map(x=>x.contribution as number)),unknownCostOrders:sum(o.map(x=>x.unknownCostOrders))}};
}
// 창별 줄 고르기. 프롬프트: 후 = to 버전을 쓴 줄, 전 = from 버전을 쓴 줄(코드 상수면 그 단위의 레지스트리 버전이 없는 줄). 역할 단위는 같은 역할만.
// 운영자 선호 규칙: 후 = 그 규칙이 주입된 작업물(byRule ruleId@*), 전 = 같은 브랜드의 같은 역할(역할이 없으면 모든 역할) 줄.
const unitVersions=(key:string,unit:string)=>key.split('+').some(k=>k.startsWith(unit+'@'));
function rowsFor(source:LoopSource,l:RewardLineage,side:'before'|'after'):RewardTotals[]{
 if(source.kind==='playbook')return side==='after'?l.byRule.filter(r=>r.ruleRef.startsWith(source.ruleId+'@')):l.byPromptVersion.filter(r=>!source.role||r.role===source.role);
 const role=source.unit.startsWith('role.')?source.unit.slice(5):null,sameRole=(r:{role:string|null})=>!role||r.role===role;
 if(side==='after')return l.byPromptVersion.filter(r=>usesVersion(r.promptVersion,source.to));
 return l.byPromptVersion.filter(r=>sameRole(r)&&!usesVersion(r.promptVersion,source.to)&&(source.from?usesVersion(r.promptVersion,source.from):!unitVersions(r.promptVersion,source.unit)));
}
function compare(c:LoopCandidate,input:RewardInput):{comparison:LoopComparison;input:RewardInput}{
 const scoped=windowInput(input,c.windows.before.from,c.windows.after.to),at=(w:{from:string;to:string})=>buildRewardLineage({...scoped,period:w});
 const before=sideOf(rowsFor(c.source,at(c.windows.before),'before')),after=sideOf(rowsFor(c.source,at(c.windows.after),'after'));
 const prob=before.status==='measured'&&after.status==='measured'?probTreatmentBetter({successes:before.approvedFirst,trials:before.decidedFirst},{successes:after.approvedFirst,trials:after.decidedFirst}):null;
 return {comparison:{before,after,probTreatmentBetter:prob},input:scoped};
}
function statusOf(c:LoopCandidate,cmp:LoopComparison,today:string):LoopStatus{
 if(c.rolledBack)return 'rolled_back';
 if(today<=c.windows.after.to)return 'open';
 return cmp.before.status==='measured'&&cmp.after.status==='measured'?'closable':'insufficient';
}
const EMPTY_SIDE:LoopSide={decidedFirst:0,approvedFirst:0,editedFirst:0,revisions:0,firstPassRate:null,status:'insufficient',publish:{publications:0,approved:0,live:0},order:{attributedOrders:0,netRevenue:0,contribution:0,unknownCostOrders:0}};
// 닫은 루프: 동결 수치·inputDigest를 그대로 보이고, 롤백 여부만 지금 이벤트로 다시 본다.
function closedLoop(r:ImprovementLoopRecord,rolledBack:boolean):ImprovementLoop{
 return {id:r.id,source:r.source,activatedAt:r.activatedAt,activatedDay:r.activatedDay,windows:r.windows,rolledBack,status:'closed',version:1,comparison:r.comparison,inputDigest:r.inputDigest,
  closed:{at:r.closedAt,by:r.closedBy,scope:r.scope},countsToExit:!rolledBack};
}
function rolledBackOf(r:ImprovementLoopRecord,input:LoopInput){
 const s=r.source;
 if(s.kind==='prompt'){const e=input.releaseEvents.find(x=>x.id===s.eventId);return promptRolledBack(e??{id:s.eventId,unit:s.unit,action:s.action,from:s.from,to:s.to,evalRunId:s.evalRunId,approval:null,at:r.activatedAt},input.releaseEvents)}
 return playbookRolledBack({id:s.auditId,ruleId:s.ruleId,brandId:s.brandId,action:'activate',ruleVersion:s.ruleVersion,createdAt:r.activatedAt},input.playbookAudits);
}
type Built={report:ImprovementLoops;inputs:Map<string,RewardInput>};
function build(input:LoopInput):Built{
 const closures=new Map(input.closures.map(r=>[r.id,r])),inputs=new Map<string,RewardInput>();
 const open=loopCandidates(input).filter(c=>!closures.has(c.id)&&recent(c,input.today)).map(c=>{
  const computed=input.reward?compare(c,input.reward):null;
  if(computed)inputs.set(c.id,computed.input);
  const comparison=computed?.comparison??{before:EMPTY_SIDE,after:EMPTY_SIDE,probTreatmentBetter:null};
  return {...c,status:statusOf(c,comparison,input.today),version:0 as const,comparison,inputDigest:null,closed:null,countsToExit:false};
 });
 const closed=[...closures.values()].map(r=>closedLoop(r,rolledBackOf(r,input)));
 const loops=[...open,...closed].sort((a,b)=>byText(b.activatedAt,a.activatedAt)||byText(a.id,b.id));
 return {report:{schema:IMPROVEMENT_LOOPS_SCHEMA,today:input.today,loops,exit:{target:LOOP_EXIT_TARGET,closed:closed.length,counted:closed.filter(l=>l.countsToExit).length},
  notices:[LOOP_NOTICE,LOOP_ROLLBACK_NOTICE,ATTRIBUTION_NOT_INCREMENTAL,...(input.reward?.decision16==='real'?[]:[DECISION16_NOTICE])]},inputs};
}
// 동기 계산(inputDigest null). 같은 입력이면 배열 순서와 관계없이 바이트가 같다.
export function buildImprovementLoops(input:LoopInput):ImprovementLoops{return build(input).report}
// 닫지 않은 루프마다 inputDigest(루프 창 입력 참조의 SHA-256, lib/reward-lineage.ts canonicalInput)를 붙인다. 닫은 루프는 동결한 값을 그대로 둔다.
export async function improvementLoops(input:LoopInput):Promise<ImprovementLoops>{
 const {report,inputs}=build(input);
 const digest=async(id:string,r:RewardInput)=>'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([id,canonicalInput(r)])))),b=>b.toString(16).padStart(2,'0')).join('');
 const loops=await Promise.all(report.loops.map(async l=>{const r=inputs.get(l.id);return l.status==='closed'||!r?l:{...l,inputDigest:await digest(l.id,r)}}));
 return {...report,loops};
}

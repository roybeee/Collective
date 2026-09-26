// B4-2a 보상 계보(순수 모듈). 보상 층 L0 사람 판정~L4 재방문을 promptVersion과 ruleRef(`ruleId@version`)별로 모은다. 서버·API·스위치 연결은 B4-2b다.
// 읽기 전용: 이 결과로 프롬프트 버전·규칙을 자동으로 올리거나 내리지 않고, B3-2 feedback에도 쓰지 않는다. 버전 비교 확률(probTreatmentBetter)은 설명용이다.
// 배분 규칙: 정확한 계보(작업물 판·게시 copy·게시 코드)만 버전·규칙에 배분하고, 수동·캠페인만 귀속은 unallocated에 둔다. 설계와 층 정의: docs/REWARD-LINEAGE.ko.md
import {firstPassApproval,REVIEW_REASONS,type ReviewDecision} from './review-decisions';
import {ATTRIBUTION_NOT_INCREMENTAL,LIVE_PUBLICATION_STATUSES,isAttributed,koreaMinute,orderMetrics,publicationGate,publicationGateView,type PublicationGate} from './store-attribution';
import {probTreatmentBetter} from './viral-stats';
import type {LearningRule,LearningSnapshot,RuleGrade,ViralExperiment} from './learning';
import type {Publication} from './execution';
import type {MetricSource} from './customer-report';

export const REWARD_LINEAGE_SCHEMA='collective.reward-lineage.v1';
export const REWARD_TIME_ZONE='Asia/Seoul';
// 표본 하한: 1차 판정이 이보다 적으면 비율을 null로 두고 insufficient로 표시한다.
export const MIN_SAMPLE=5;
export const REWARD_AUTO_NOTICE='자동 판정 아님: 보상 계보는 기록을 정해진 규칙으로 모은 읽기 전용 집계입니다. 프롬프트 버전·규칙을 자동으로 올리거나 내리지 않고 교정 플레이북 feedback에도 쓰지 않습니다. 버전 비교 확률은 설명용이며 판단은 대표가 합니다.';
export const REWARD_ALLOCATION_NOTICE='배분: 정확한 계보(작업물 판·게시 copy·게시 코드)만 버전·규칙에 배분합니다. 수동·캠페인만 귀속한 주문은 어느 버전에도 배분하지 않습니다. 한 작업물에 규칙이 여럿이면 규칙마다 같은 보상을 세므로 규칙별 합계는 전체보다 클 수 있습니다.';
export const DECISION16_NOTICE='결정 16 첫 실게시 not_run: 발행(L1)은 앱 승인 기록이며 실제 게시가 아닙니다. 반응(L2)은 작업물 출처 실험만 축소해 셉니다.';
export const REVISIT_NOTICE='재방문(L4)은 A5 전이라 측정하지 않습니다(not_run).';
export class RewardLineageError extends Error{status=400;constructor(message:string){super(message);this.name='RewardLineageError'}}

type StoreOrder=Parameters<typeof orderMetrics>[0][number];
// 작업물 판 레코드(현재 판·이전 판). 사람이 고친 판(ai_edited)은 aiSource가 AI 원본 판과 그 promptVersion을 가리킨다.
export type RewardArtifact={id:string;version:number;role?:string|null;origin?:string;promptVersion?:string|null;aiSource?:{version?:number|null;promptVersion?:string|null}|null};
export type RewardPublication=Pick<Publication,'id'|'version'|'status'|'scheduledAt'|'copy'|'approvedAt'>;
type SnapshotRule=Pick<LearningRule,'id'|'version'|'grade'>;
export type RewardSnapshot=Pick<LearningSnapshot,'id'|'artifactId'>&{rules:readonly SnapshotRule[];operatorPreferences?:readonly SnapshotRule[]};
export type RewardExperiment=Pick<ViralExperiment,'id'|'version'|'status'|'createdAt'|'source'>;
// roleArtifactIds: 스냅샷 id(=역할 실행 id) → 작업물 id. 역할 실행의 작업물 id는 비동기 해시(lib/role-execution.ts roleArtifactId)라 서버가 계산해 넘긴다.
export type RewardInput={period:{from:string;to:string};scope:{brandId:string;storeId?:string|null;campaignId?:string|null};decision16:'real'|'not_run';
 decisions:readonly ReviewDecision[];artifacts:readonly RewardArtifact[];snapshots?:readonly RewardSnapshot[];roleArtifactIds?:Readonly<Record<string,string>>;
 publications?:readonly RewardPublication[];orders?:readonly StoreOrder[];experiments?:readonly RewardExperiment[];rules?:readonly Pick<LearningRule,'id'|'version'|'experimentId'|'status'>[]};

export type HumanTotals={decidedFirst:number;approvedFirst:number;editedFirst:number;revisions:number;firstPassRate:number|null;status:'measured'|'insufficient';reasonCodes:Record<string,number>};
export type RewardTotals={artifacts:number;human:HumanTotals;publish:{publications:number;approved:number;live:number;cancelled:number;failed:number};engagement:{experiments:number;evaluated:number;adoptedRules:number};
 order:{attributedOrders:number;netRevenue:number;contribution:number|null;unknownCostOrders:number};revisit:null;lineage:{exact:number}};
type LayerSource=MetricSource|'user_record+derived';
export type RewardLayers={human:{status:'measured';source:LayerSource};publish:{status:'measured';source:LayerSource;liveSource:LayerSource;realPublish:boolean};
 engagement:{status:'measured'|'reduced';reason?:'decision16_not_run';source:LayerSource;excluded:{caseBased:number}};order:{status:'measured';source:LayerSource;notice:'귀속≠증분'};revisit:{status:'not_run';reason:'a5_not_started'}};
export type Comparison={role:string;metric:'firstPassRate';control:{promptVersion:string;decidedFirst:number;approvedFirst:number};treatment:{promptVersion:string;decidedFirst:number;approvedFirst:number};probTreatmentBetter:number};
export type RewardLineage={schema:typeof REWARD_LINEAGE_SCHEMA;period:{from:string;to:string;timeZone:typeof REWARD_TIME_ZONE};scope:{brandId:string;storeId:string|null;campaignId:string|null};layers:RewardLayers;
 byPromptVersion:({promptVersion:string;role:string|null}&RewardTotals)[];byUnitVersion:({unitVersion:string;promptVersions:string[]}&RewardTotals)[];byRule:({ruleRef:string;grade:RuleGrade}&RewardTotals)[];comparisons:Comparison[];
 unallocated:{human:{firstDecisions:number;reasons:{no_prompt_version:number}};publish:{publications:number;reasons:{no_copy:number;no_prompt_version:number}};engagement:{experiments:number;reasons:{no_prompt_version:number}};
  order:{attributedOrders:number;reasons:{manual_or_campaign_only:number;no_copy:number;no_prompt_version:number}};rules:{snapshots:number;reasons:{no_artifact_mapping:number}}};notices:string[];inputDigest:string|null};

// lib/prompt-registry.ts usesVersion 사본: 그 파일은 server를 import해 순수 모듈에서 부를 수 없다. 복합 키(a+b)를 단위로 나눠 본다.
export const usesVersion=(promptVersion:unknown,id:string)=>typeof promptVersion==='string'&&promptVersion.split('+').includes(id);
const ref=(id:string,version:number|null|undefined)=>`${id}@${version??''}`;
const byText=(a:string,b:string)=>a<b?-1:a>b?1:0;
const sum=(values:readonly number[])=>values.reduce((n,v)=>n+v,0);
const ratio=(n:number)=>Math.round(n*10000)/10000;
const kstDay=(iso:unknown)=>koreaMinute(iso).slice(0,10);
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const KNOWN_REASONS=new Set<string>(REVIEW_REASONS.map(r=>r.code));
const AI_ORIGINS=new Set(['ai','ai_edited']);

type Link={artifactId:string|null;key:string|null;role:string|null};
type HumanEvent=Link&{first:boolean;d:ReviewDecision};
type PublishEvent=Link&{p:RewardPublication};
type EngagementEvent=Link&{e:RewardExperiment};
type OrderEvent=Link&{o:StoreOrder};
type Events={human:HumanEvent[];publish:PublishEvent[];engagement:EngagementEvent[];order:OrderEvent[];caseBased:number};
type Index=ReadonlyMap<string,RewardArtifact>;

// 판의 AI 원본 promptVersion. 사람이 고친 판은 aiSource.promptVersion, 없으면 원본 판 레코드, 그것도 없으면 판 레코드 값이다(lib/deidentified-signals.ts와 같은 순서).
function recordKey(index:Index,rec:RewardArtifact|undefined):string|null{
 if(!rec)return null;
 if(rec.origin!=='ai_edited')return rec.promptVersion||null;
 return rec.aiSource?.promptVersion||index.get(ref(rec.id,rec.aiSource?.version))?.promptVersion||rec.promptVersion||null;
}
const linkOf=(index:Index,target:{id:string;version:number}|null):Link=>{
 if(!target)return {artifactId:null,key:null,role:null};
 const rec=index.get(ref(target.id,target.version));
 return {artifactId:target.id,key:recordKey(index,rec),role:rec?.role??null};
};
// L0: 판정의 promptVersion. 사람이 고친 판은 AI 원본(aiSource) 쪽을 먼저 본다. 1차 판정은 기록 순서(createdAt, id)상 작업물의 첫 판정이다(기간 밖 판정 포함).
function humanEvents(input:RewardInput,index:Index,inPeriod:(day:string)=>boolean):HumanEvent[]{
 const sorted=input.decisions.filter(d=>d.targetKind==='artifact').sort((a,b)=>byText(a.createdAt,b.createdAt)||byText(a.id,b.id));
 const first=new Map([...sorted].reverse().map(d=>[d.targetId,d.id]));
 return sorted.filter(d=>AI_ORIGINS.has(d.origin||'')&&inPeriod(kstDay(d.createdAt))).map(d=>{
  const rec=index.get(ref(d.targetId,d.version)),key=d.origin==='ai_edited'?recordKey(index,rec)??d.promptVersion:d.promptVersion??recordKey(index,rec);
  return {artifactId:d.targetId,key:key||null,role:d.role??rec?.role??null,first:first.get(d.targetId)===d.id,d};
 });
}
// L3: 게시 관문(publicationGateView)을 지금 게시 상태로 다시 본 뒤 귀속 주문만 남긴다. 게시 코드 귀속이 아니면 수동·캠페인만 귀속(artifactId null)이다.
function orderEvents(input:RewardInput,index:Index,inPeriod:(day:string)=>boolean):(OrderEvent&{manual:boolean})[]{
 const pubs=input.publications||[],gates=new Map<string,PublicationGate>(pubs.map(p=>[p.id,publicationGate(p)])),byId=new Map(pubs.map(p=>[p.id,p]));
 return (input.orders||[]).filter(o=>inPeriod(o.orderDate)).map(o=>publicationGateView(o,gates)).filter(isAttributed).map(o=>{
  const publicationId=o.codeAttribution?.publicationId,copy=publicationId?byId.get(publicationId)?.copy:undefined;
  return {...linkOf(index,copy?{id:copy.artifactId,version:copy.artifactVersion}:null),o,manual:!publicationId};
 });
}
function collect(input:RewardInput,index:Index):Events&{orderManual:number}{
 const inPeriod=(day:string)=>!!day&&day>=input.period.from&&day<=input.period.to;
 const publish=(input.publications||[]).filter(p=>inPeriod(kstDay(p.scheduledAt))).map(p=>({...linkOf(index,p.copy?{id:p.copy.artifactId,version:p.copy.artifactVersion}:null),p}));
 const experiments=(input.experiments||[]).filter(e=>inPeriod(kstDay(e.createdAt))),fromArtifact=experiments.filter(e=>e.source?.kind==='artifact');
 const engagement=fromArtifact.map(e=>({...linkOf(index,e.source?{id:e.source.artifactId,version:e.source.artifactVersion}:null),e}));
 const orders=orderEvents(input,index,inPeriod);
 return {human:humanEvents(input,index,inPeriod),publish,engagement,order:orders.filter(o=>!o.manual),orderManual:orders.filter(o=>o.manual).length,caseBased:experiments.length-fromArtifact.length};
}

function humanTotals(events:readonly HumanEvent[]):HumanTotals{
 const rows=firstPassApproval(events.filter(e=>e.first).map(e=>e.d)),decidedFirst=sum(rows.map(r=>r.artifacts)),approvedFirst=sum(rows.map(r=>r.approvedFirst)),enough=decidedFirst>=MIN_SAMPLE;
 const codes=events.flatMap(e=>e.d.reasonCodes.filter(c=>KNOWN_REASONS.has(c)));
 return {decidedFirst,approvedFirst,editedFirst:sum(rows.map(r=>r.editedFirst)),revisions:events.filter(e=>e.d.decision==='revision').length,firstPassRate:enough?ratio(approvedFirst/decidedFirst):null,status:enough?'measured':'insufficient',
  reasonCodes:Object.fromEntries([...new Set(codes)].sort(byText).map(c=>[c,codes.filter(x=>x===c).length]))};
}
function totals(ev:Events,match:(l:Link)=>boolean,rules:RewardInput['rules']):RewardTotals{
 const h=ev.human.filter(match),p=ev.publish.filter(match),g=ev.engagement.filter(match),o=ev.order.filter(match),status=(s:string)=>p.filter(e=>e.p.status===s).length;
 const experimentIds=new Set(g.map(e=>e.e.id)),adopted=new Set((rules||[]).filter(r=>r.status!=='draft'&&experimentIds.has(r.experimentId)).map(r=>r.id)),m=orderMetrics(o.map(e=>e.o));
 return {artifacts:new Set([...h,...p,...g,...o].map(e=>e.artifactId)).size,human:humanTotals(h),
  publish:{publications:p.length,approved:p.filter(e=>!!e.p.approvedAt).length,live:p.filter(e=>LIVE_PUBLICATION_STATUSES.includes(e.p.status)).length,cancelled:status('cancelled'),failed:status('failed')},
  engagement:{experiments:g.length,evaluated:g.filter(e=>e.e.status==='evaluated').length,adoptedRules:adopted.size},
  order:{attributedOrders:m.orders,netRevenue:m.netRevenue,contribution:m.contribution,unknownCostOrders:m.unknownCostOrders},revisit:null,lineage:{exact:h.length+p.length+g.length+o.length}};
}

// learning_snapshot의 rules·operatorPreferences를 appliedRules로 파생한다(새 필드 없음). 등급이 없는 규칙은 performance_observed다(lib/learning.ts ruleGrade와 같은 기본값).
export const appliedRules=(s:Pick<RewardSnapshot,'rules'|'operatorPreferences'>)=>[
 ...s.rules.map(r=>({ruleRef:ref(r.id,r.version),grade:(r.grade??'performance_observed') as RuleGrade,block:'rules' as const})),
 ...(s.operatorPreferences||[]).map(r=>({ruleRef:ref(r.id,r.version),grade:(r.grade??'performance_observed') as RuleGrade,block:'operatorPreferences' as const})),
];
function ruleRows(input:RewardInput,ev:Events){
 const linked=(input.snapshots||[]).map(s=>({s,artifactId:s.artifactId||input.roleArtifactIds?.[s.id]||null})).sort((a,b)=>byText(a.s.id,b.s.id));
 const applied=linked.flatMap(({s,artifactId})=>artifactId?appliedRules(s).map(r=>({...r,artifactId})):[]);
 const rows=[...new Set(applied.map(a=>a.ruleRef))].sort(byText).map(ruleRef=>{
  const mine=applied.filter(a=>a.ruleRef===ruleRef),ids=new Set(mine.map(a=>a.artifactId));
  return {ruleRef,grade:mine[0].grade,...totals(ev,l=>!!l.artifactId&&ids.has(l.artifactId),input.rules)};
 });
 return {rows,unlinked:linked.filter(l=>!l.artifactId).length};
}
// 버전 비교(설명용): 같은 역할에서 표본이 충분한 버전을 첫 1차 판정 시각 순으로 세우고 이웃한 두 버전의 'B가 A보다 1차 승인율이 높을 확률'만 적는다. 권고·판정은 없다.
function comparisons(rows:RewardLineage['byPromptVersion'],ev:Events):Comparison[]{
 const since=(r:{promptVersion:string;role:string|null})=>ev.human.filter(e=>e.first&&e.key===r.promptVersion&&e.role===r.role).map(e=>e.d.createdAt).sort(byText)[0]||'';
 const ready=rows.filter(r=>r.role&&r.human.status==='measured').map(r=>({r,at:since(r)})).sort((a,b)=>byText(a.r.role||'',b.r.role||'')||byText(a.at,b.at)||byText(a.r.promptVersion,b.r.promptVersion)).map(x=>x.r);
 const side=(r:typeof rows[number])=>({promptVersion:r.promptVersion,decidedFirst:r.human.decidedFirst,approvedFirst:r.human.approvedFirst});
 return ready.slice(1).flatMap((t,i)=>{const c=ready[i];return c.role===t.role?[{role:t.role||'',metric:'firstPassRate' as const,control:side(c),treatment:side(t),
  probTreatmentBetter:probTreatmentBetter({successes:c.human.approvedFirst,trials:c.human.decidedFirst},{successes:t.human.approvedFirst,trials:t.human.decidedFirst})}]:[]});
}

function checkedInput(input:RewardInput){
 const {from,to}=input.period||{};
 if(!DAY.test(from||'')||!DAY.test(to||'')||from>to)throw new RewardLineageError('기간은 YYYY-MM-DD 형식의 시작일과 종료일(시작일 ≤ 종료일)로 보내 주세요.');
 if(input.decision16!=='real'&&input.decision16!=='not_run')throw new RewardLineageError('결정 16 상태는 real 또는 not_run이어야 합니다.');
 if(!input.scope?.brandId)throw new RewardLineageError('브랜드 범위가 필요합니다.');
 return input;
}
function layersOf(real:boolean,caseBased:number):RewardLayers{
 return {human:{status:'measured',source:'app_record'},publish:{status:'measured',source:'app_record',liveSource:'connector',realPublish:real},
  engagement:{status:real?'measured':'reduced',...(real?{}:{reason:'decision16_not_run' as const}),source:'user_record',excluded:{caseBased}},
  order:{status:'measured',source:'user_record+derived',notice:'귀속≠증분'},revisit:{status:'not_run',reason:'a5_not_started'}};
}
function unallocatedOf(ev:Events&{orderManual:number},unlinked:number):RewardLineage['unallocated']{
 const count=(list:readonly Link[],artifact:boolean)=>list.filter(e=>artifact?!!e.artifactId&&!e.key:!e.artifactId).length;
 const human=ev.human.filter(e=>e.first&&!e.key).length,noCopy=count(ev.publish,false),noVersion=count(ev.publish,true),orderNoCopy=count(ev.order,false),orderNoVersion=count(ev.order,true),engagement=count(ev.engagement,true);
 return {human:{firstDecisions:human,reasons:{no_prompt_version:human}},publish:{publications:noCopy+noVersion,reasons:{no_copy:noCopy,no_prompt_version:noVersion}},engagement:{experiments:engagement,reasons:{no_prompt_version:engagement}},
  order:{attributedOrders:ev.orderManual+orderNoCopy+orderNoVersion,reasons:{manual_or_campaign_only:ev.orderManual,no_copy:orderNoCopy,no_prompt_version:orderNoVersion}},rules:{snapshots:unlinked,reasons:{no_artifact_mapping:unlinked}}};
}

// 보상 계보를 만든다. 같은 입력이면 입력 배열 순서와 관계없이 바이트 동일한 결과를 낸다. 범위(브랜드·지점·캠페인)로 거르는 일은 호출자(서버)가 한다. inputDigest는 rewardLineage가 채운다.
export function buildRewardLineage(raw:RewardInput):RewardLineage{
 const input=checkedInput(raw),index:Index=new Map(input.artifacts.map(a=>[ref(a.id,a.version),a])),ev=collect(input,index),real=input.decision16==='real';
 const linked=[...ev.human,...ev.publish,...ev.engagement,...ev.order].filter(e=>!!e.key);
 const groups=[...new Map(linked.map(e=>[JSON.stringify([e.key,e.role]),{promptVersion:e.key as string,role:e.role}])).values()].sort((a,b)=>byText(a.promptVersion,b.promptVersion)||byText(a.role||'',b.role||''));
 const byPromptVersion=groups.map(g=>({...g,...totals(ev,l=>l.key===g.promptVersion&&l.role===g.role,input.rules)}));
 const keys=[...new Set(linked.map(e=>e.key as string))],units=[...new Set(keys.filter(k=>k.includes('+')).flatMap(k=>k.split('+')))].sort(byText);
 const byUnitVersion=units.map(unitVersion=>({unitVersion,promptVersions:keys.filter(k=>usesVersion(k,unitVersion)).sort(byText),...totals(ev,l=>usesVersion(l.key,unitVersion),input.rules)}));
 const rules=ruleRows(input,ev);
 return {schema:REWARD_LINEAGE_SCHEMA,period:{from:input.period.from,to:input.period.to,timeZone:REWARD_TIME_ZONE},scope:{brandId:input.scope.brandId,storeId:input.scope.storeId??null,campaignId:input.scope.campaignId??null},
  layers:layersOf(real,ev.caseBased),byPromptVersion,byUnitVersion,byRule:rules.rows,comparisons:comparisons(byPromptVersion,ev),unallocated:unallocatedOf(ev,rules.unlinked),
  notices:[ATTRIBUTION_NOT_INCREMENTAL,REWARD_AUTO_NOTICE,REWARD_ALLOCATION_NOTICE,...(real?[]:[DECISION16_NOTICE]),REVISIT_NOTICE],inputDigest:null};
}
// 입력 참조의 정규 문자열(inputDigest 원문). 기록 id·판만 담고 원문(주문번호·메모·근거·이메일)은 담지 않는다. 배열 순서와 무관하다.
export function canonicalInput(raw:RewardInput){
 const input=checkedInput(raw),refs=(list:readonly {id:string;version:number}[]|undefined)=>(list||[]).map(x=>ref(x.id,x.version)).sort(byText);
 return JSON.stringify({schema:REWARD_LINEAGE_SCHEMA,period:[input.period.from,input.period.to],scope:[input.scope.brandId,input.scope.storeId??null,input.scope.campaignId??null],decision16:input.decision16,
  decisions:input.decisions.map(d=>d.id).sort(byText),artifacts:refs(input.artifacts),snapshots:(input.snapshots||[]).map(s=>s.id).sort(byText),
  roleArtifactIds:Object.entries(input.roleArtifactIds||{}).sort((a,b)=>byText(a[0],b[0])),publications:refs(input.publications),orders:refs(input.orders),experiments:refs(input.experiments),rules:refs(input.rules)});
}
// inputDigest를 붙인 보상 계보. Web Crypto SHA-256(플랫폼 전역, 비동기)만 쓰고 저장소·네트워크는 읽지 않는다.
export async function rewardLineage(input:RewardInput):Promise<RewardLineage>{
 const report=buildRewardLineage(input),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalInput(input)));
 return {...report,inputDigest:'sha256:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};
}

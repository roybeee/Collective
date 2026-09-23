// records 테이블 kind 레지스트리(순수 모듈). 코드가 쓰는 모든 kind와 캠페인 삭제 정책을 한곳에 적는다.
// 새 kind를 만들면 여기에 정책을 추가한다. tests/record-kinds.test.mjs가 app/·lib/·server/ 소스를 스캔해 누락을 막는다.
// 대표 결정 7(2026-09-24, b): 캠페인을 지워도 바이럴 출처 학습 규칙은 지우지 않고 종료(retired)와 원 캠페인 삭제 표시로 남긴다. 규칙에 복사된 원천 실험 원문은 뺀다.
// 원천 바이럴 실험은 원문을 뺀 요약만 동결 보관하고 실험·개정 이력은 지운다. 점포 출처 규칙·점포 실험은 그대로 둔다.
import type {ViralExperiment,LearningMetric,LearningRule} from './learning';

// delete: 캠페인과 함께 삭제 · retain: 캠페인과 이어져 있어도 남김 · retire_and_mark: 종료 상태와 삭제 표시로 남김 · not_campaign_scoped: 캠페인과 무관
export type CampaignDeletionPolicy='delete'|'retain'|'retire_and_mark'|'not_campaign_scoped';
// parent_id에 들어가는 값의 유형. none은 빈 문자열이다.
export const recordParents=['none','brand','campaign','store','viral_case','viral_experiment','brand_fact','media','eval_run'] as const;
export type RecordParent=typeof recordParents[number];
// 레코드가 캠페인에 이어지는 경로. 삭제와 삭제 영향 조회가 같은 조건을 쓴다.
export type CampaignLink='self'|'parent'|'brief_draft'|'draft_submission'|'job_submission'|'experiment_child'|'experiment_rule'|'guidance_job'|'sequence_attempt'|'data_campaign';
export type RecordKind={kind:string;parent:RecordParent;campaignDeletion:CampaignDeletionPolicy;links?:readonly CampaignLink[];blocksDeletion?:true;description:string};

export const recordKinds:readonly RecordKind[]=[
 {kind:'account_event',parent:'none',campaignDeletion:'not_campaign_scoped',description:'계정 초대·역할 변경·잠금 등 워크스페이스 계정 감사 기록'},
 {kind:'artifact',parent:'campaign',campaignDeletion:'delete',links:['parent'],description:'담당자 작업물'},
 {kind:'background_attempt',parent:'none',campaignDeletion:'delete',links:['sequence_attempt'],description:'백그라운드 작업 재시도 기록. 캠페인 연속 실행(sequence:<캠페인>) 기록만 캠페인과 함께 지운다'},
 {kind:'background_cursor',parent:'none',campaignDeletion:'not_campaign_scoped',description:'백그라운드 작업 순번 커서'},
 {kind:'brand',parent:'none',campaignDeletion:'not_campaign_scoped',description:'브랜드 지식'},
 {kind:'brand_archive_state',parent:'brand',campaignDeletion:'not_campaign_scoped',description:'브랜드 아카이브 개정 번호'},
 {kind:'brand_diagnostic',parent:'brand',campaignDeletion:'not_campaign_scoped',description:'브랜드 진단 결과'},
 {kind:'brand_fact',parent:'brand',campaignDeletion:'not_campaign_scoped',description:'브랜드·지점 사실(후보·확정·거절)'},
 {kind:'brand_fact_history',parent:'brand_fact',campaignDeletion:'not_campaign_scoped',description:'브랜드 사실 이전 버전'},
 {kind:'brand_observation',parent:'brand',campaignDeletion:'not_campaign_scoped',description:'브랜드 관찰 메모'},
 {kind:'brand_research',parent:'brand',campaignDeletion:'not_campaign_scoped',description:'브랜드·지점 조사 실행 기록'},
 {kind:'brand_source',parent:'brand',campaignDeletion:'not_campaign_scoped',description:'브랜드 아카이브 자료'},
 {kind:'brief_draft',parent:'none',campaignDeletion:'delete',links:['brief_draft'],description:'HERMES 브리프 초안. 캠페인을 요청했거나 캠페인으로 저장된 초안만 지운다'},
 {kind:'campaign',parent:'none',campaignDeletion:'delete',links:['self'],description:'캠페인 브리프'},
 {kind:'campaign_directive',parent:'campaign',campaignDeletion:'delete',links:['parent'],description:'캠페인 상시 지시'},
 {kind:'campaign_sequence',parent:'campaign',campaignDeletion:'delete',links:['parent'],description:'캠페인 연속 실행 동의·진행 상태'},
 {kind:'case_observation',parent:'viral_case',campaignDeletion:'not_campaign_scoped',description:'같은 바이럴 사례의 추가 관찰'},
 {kind:'channel_credential',parent:'none',campaignDeletion:'not_campaign_scoped',description:'성과 수집 채널 자격증명(암호화)'},
 {kind:'deleted_campaign',parent:'none',campaignDeletion:'retain',description:'캠페인 삭제 기록(tombstone). 삭제할 때 만들어 재생성과 재시도를 막는다'},
 {kind:'eval_case',parent:'none',campaignDeletion:'retain',links:['data_campaign'],description:'평가 골든셋 케이스(동결한 역할 요청·기대 판정·세트). 캠페인을 지워도 남기고 소유자만 개별 삭제한다(결정 6·7 취지)'},
 {kind:'eval_connection',parent:'none',campaignDeletion:'not_campaign_scoped',description:'평가 전용 HERMES 연결(주소·키 암호화, 운영 연결과 다른 호스트)'},
 {kind:'eval_output',parent:'eval_run',campaignDeletion:'not_campaign_scoped',description:'평가 실행의 케이스별 모델 출력 원문과 규제 점검 상세(소유자 전용)'},
 {kind:'eval_run',parent:'none',campaignDeletion:'not_campaign_scoped',description:'서버 평가 실행(케이스별 채점 결과·토큰·예산 승인·봉인 세트 사용 기록). delete_run은 결과·출력만 지우고 행은 월 예산 장부로 남긴다'},
 {kind:'event',parent:'campaign',campaignDeletion:'delete',links:['parent'],description:'캠페인 이력 이벤트'},
 {kind:'execution_creative',parent:'campaign',campaignDeletion:'retain',links:['parent'],blocksDeletion:true,description:'제작한 소재. 있으면 캠페인 삭제를 거부한다'},
 {kind:'execution_limits',parent:'campaign',campaignDeletion:'delete',links:['parent'],description:'발행 한도 설정'},
 {kind:'execution_provider_audit',parent:'campaign',campaignDeletion:'retain',links:['parent'],description:'발행 공급자 응답 감사 기록. 발행 기록과 함께 생겨 삭제 거부 대상 캠페인에만 있다'},
 {kind:'execution_publication',parent:'campaign',campaignDeletion:'retain',links:['parent'],blocksDeletion:true,description:'발행 시도·결과. 있으면 캠페인 삭제를 거부한다'},
 {kind:'execution_rate',parent:'none',campaignDeletion:'not_campaign_scoped',description:'API 호출 빈도 제한 창'},
 {kind:'experiment_revision',parent:'viral_experiment',campaignDeletion:'delete',links:['experiment_child'],description:'바이럴 실험 결과 정정 전 버전'},
 {kind:'feature_flag',parent:'none',campaignDeletion:'not_campaign_scoped',description:'서버 기능 스위치(소유자 범위, 플래그당 1행). 행이 없으면 lib/feature-flags.ts 기본값을 쓴다'},
 {kind:'gateway_change',parent:'none',campaignDeletion:'not_campaign_scoped',description:'게이트웨이 스냅샷 해시 변경 경보(바뀐 섹션의 추가·삭제·변경 경로 요약). 응답 원문·키·주소는 담지 않는다(F2b)'},
 {kind:'gateway_snapshot',parent:'none',campaignDeletion:'not_campaign_scoped',description:'운영 HERMES 게이트웨이 상태 스냅샷(소유자당 UTC 하루 1행). 정규화한 응답의 sha256과 섹션 요약만 남긴다(F2b)'},
 {kind:'grading',parent:'campaign',campaignDeletion:'delete',links:['parent'],description:'온라인 채점 결과(작업물 id·버전별 채점기 판정·규제 점검 요약·소요 ms). 기능 스위치 online_grading이 켜졌을 때만 생긴다(F2b)'},
 {kind:'hermes_submission',parent:'none',campaignDeletion:'delete',links:['parent','job_submission','draft_submission','guidance_job'],description:'HERMES 요청 원문. 캠페인 회의·실행 작업·연결 초안·실험 규칙 초안 작업의 원문만 지운다'},
 {kind:'history',parent:'campaign',campaignDeletion:'delete',links:['parent'],description:'작업물 이전 버전'},
 {kind:'learning_guidance',parent:'viral_experiment',campaignDeletion:'delete',links:['experiment_child'],description:'바이럴 실험 규칙 문구 초안'},
 {kind:'learning_job_output',parent:'none',campaignDeletion:'delete',links:['guidance_job'],description:'학습 작업 응답 원문. 캠페인 실험의 규칙 초안 작업 출력만 지우고 사례 분석·조사 출력은 남긴다'},
 {kind:'learning_rule',parent:'brand',campaignDeletion:'retire_and_mark',links:['experiment_rule'],description:'학습 규칙. 바이럴 출처는 종료+원 캠페인 삭제 표시로 남기고 점포 출처는 그대로 둔다(결정 7)'},
 {kind:'learning_snapshot',parent:'campaign',campaignDeletion:'delete',links:['parent'],description:'실행 시점에 전달한 학습 규칙 사본'},
 {kind:'learning_task',parent:'none',campaignDeletion:'delete',links:['guidance_job'],description:'학습 작업 입력. 캠페인 실험의 규칙 초안 작업만 지운다'},
 {kind:'measurement_draft',parent:'campaign',campaignDeletion:'delete',links:['parent'],description:'바이럴 실험 자동 수집 성과 초안'},
 {kind:'measurement_source',parent:'viral_experiment',campaignDeletion:'delete',links:['experiment_child'],description:'바이럴 실험 성과 반복 수집 대상'},
 {kind:'metric',parent:'campaign',campaignDeletion:'delete',links:['parent'],description:'캠페인 성과 기록'},
 {kind:'model_change',parent:'none',campaignDeletion:'not_campaign_scoped',description:'보고 모델 변경 경보. 별칭은 실제 모델 미확인(actual=null)으로 적는다(결정 10)'},
 {kind:'openai_submission',parent:'campaign',campaignDeletion:'delete',links:['parent'],description:'OpenAI 요청 원문'},
 {kind:'order_import',parent:'store',campaignDeletion:'not_campaign_scoped',description:'주문 CSV 가져오기 기록(건수·중복·귀속 수·식별 가능 주문 수·열 매핑·행위자). CSV 원문과 고객 ID 값은 담지 않는다'},
 {kind:'pos_weekly_total',parent:'store',campaignDeletion:'not_campaign_scoped',description:'지점 주간 POS 합계(순매출·주문 수). 주문 장부 완전성 대조 기준'},
 {kind:'provider_usage',parent:'none',campaignDeletion:'not_campaign_scoped',description:'AI 공급자 사용량 장부'},
 {kind:'public_media',parent:'media',campaignDeletion:'not_campaign_scoped',description:'공개 제공 소재 파일과 발행 참조'},
 {kind:'public_media_ref',parent:'media',campaignDeletion:'not_campaign_scoped',description:'공개 소재 파일의 소유자 참조'},
 {kind:'publisher_credential',parent:'brand',campaignDeletion:'not_campaign_scoped',description:'브랜드 발행 채널(Buffer) 자격증명(암호화)'},
 {kind:'role_output_contract',parent:'campaign',campaignDeletion:'delete',links:['parent'],description:'담당자 출력 계약'},
 {kind:'role_output_failure',parent:'campaign',campaignDeletion:'delete',links:['parent'],description:'담당자 출력 검증 실패 원문'},
 {kind:'store',parent:'brand',campaignDeletion:'not_campaign_scoped',description:'지점'},
 {kind:'store_channel',parent:'store',campaignDeletion:'not_campaign_scoped',description:'지점 채널'},
 {kind:'store_diagnostic',parent:'store',campaignDeletion:'not_campaign_scoped',description:'지점 진단'},
 {kind:'store_experiment',parent:'store',campaignDeletion:'retain',links:['data_campaign'],description:'점포 실험. 캠페인과 연결돼도 그대로 남는다(결정 7)'},
 {kind:'store_measurement',parent:'store',campaignDeletion:'not_campaign_scoped',description:'점포 실험 측정'},
 {kind:'store_order',parent:'store',campaignDeletion:'retain',links:['data_campaign'],blocksDeletion:true,description:'지점 주문 장부. 캠페인에 귀속된 주문이 있으면 캠페인 삭제를 거부한다'},
 {kind:'store_report',parent:'store',campaignDeletion:'not_campaign_scoped',description:'지점 조사 보고서'},
 {kind:'store_spend',parent:'store',campaignDeletion:'not_campaign_scoped',description:'지점 비용 장부'},
 {kind:'store_task',parent:'store',campaignDeletion:'not_campaign_scoped',description:'지점 조사 후속 과제'},
 {kind:'team_meeting',parent:'campaign',campaignDeletion:'delete',links:['parent'],description:'AI 팀 회의'},
 // 추적 코드(A4)는 주문 장부의 귀속 근거다. 주문 장부 보존 원칙에 맞춰 캠페인을 지워도 남긴다: 코드→캠페인·팔·게시 연결이 남아야 옛 주문의 귀속을 설명할 수 있고,
 // 코드(레코드 id)가 남아 있어 인쇄된 옛 쿠폰·QR 코드가 다른 캠페인에 다시 쓰이지 않는다. 캠페인이 사라진 코드는 자동 귀속에 쓰지 않는다(lib/store-operations-server.ts codeBook).
 // 삭제를 막지는 않는다. 코드로 귀속된 주문이 있으면 store_order가 이미 캠페인 삭제를 거부한다.
 {kind:'tracking_code',parent:'store',campaignDeletion:'retain',links:['data_campaign'],description:'점포 추적 코드(쿠폰·QR·POS 태그·UTM)와 캠페인·소재·게시·팔 연결. 캠페인을 지워도 귀속 근거로 남기고 자동 귀속에는 쓰지 않는다'},
 {kind:'usage_model_state',parent:'none',campaignDeletion:'not_campaign_scoped',description:'공급자별 마지막 보고 모델(1행). 모델 변경 경보의 비교 기준'},
 {kind:'usage_pricing',parent:'none',campaignDeletion:'not_campaign_scoped',description:'사용량 단가'},
 {kind:'viral_analysis',parent:'viral_case',campaignDeletion:'not_campaign_scoped',description:'바이럴 사례 분석'},
 {kind:'viral_case',parent:'brand',campaignDeletion:'not_campaign_scoped',description:'수집한 바이럴 사례'},
 {kind:'viral_experiment',parent:'campaign',campaignDeletion:'delete',links:['parent'],description:'바이럴 실험. 규칙을 낳은 실험은 삭제 전에 원문 제외 요약을 동결한다'},
 {kind:'viral_experiment_summary',parent:'brand',campaignDeletion:'retain',description:'삭제된 캠페인의 원천 바이럴 실험 동결 요약(원문 제외). 캠페인 삭제 때 만든다(결정 7)'},
 {kind:'worker_credential',parent:'none',campaignDeletion:'not_campaign_scoped',description:'조사 워커 인증 해시'},
 {kind:'worker_event',parent:'none',campaignDeletion:'not_campaign_scoped',description:'조사 워커 설치·해제 감사 기록'},
 {kind:'worker_state',parent:'none',campaignDeletion:'not_campaign_scoped',description:'조사 워커 상태'},
 {kind:'worker_rejection',parent:'none',campaignDeletion:'not_campaign_scoped',description:'조사 워커 인증 거부 기록(소유자당 1행: 사유별 마지막 거부 시각). 토큰·헤더 값은 담지 않고 재발급·연결 해제 때 지운다(security-ops-4)'},
 {kind:'token_budget',parent:'none',campaignDeletion:'delete',links:['data_campaign'],description:'소유자가 정한 월 토큰 상한(한국 시간 달력 월). 워크스페이스 1행(id workspace, campaignId 없음)과 캠페인별 행(id campaign:<캠페인>). 캠페인별 행은 캠페인과 함께 지운다(loop-4)'},
 {kind:'token_reservation',parent:'none',campaignDeletion:'not_campaign_scoped',description:'HERMES 제출 1건의 진행 중 토큰 예약(예상 토큰·실행 종류·캠페인 id·실행 번호·멱등 키 해시). 요청 원문은 담지 않고 토큰을 아는 종료 사용량을 기록하면 지운다(loop-4)'},
 {kind:'usage_alias_pricing',parent:'none',campaignDeletion:'not_campaign_scoped',description:'HERMES 별칭(hermes-agent) 단가 선언(기반 모델·입력/출력 단가·통화·근거 URL·적용 시작일). 원장은 바꾸지 않고 읽을 때 추정한다(loop-5, 결정 10)'},
];

// 캠페인에 속한 바이럴 실험 id. 바인드 순서: owner, campaignId.
const EXPERIMENTS="SELECT json_extract(data,'$.id') FROM records WHERE owner=? AND kind='viral_experiment' AND parent_id=?";
// 캠페인 실험의 규칙 초안(guidance) 작업. 작업 묶음 id는 'guidance:<실험 id>'다(lib/learning-execution.ts).
const GUIDANCE_GROUPS=`SELECT 'guidance:' || json_extract(data,'$.id') FROM records WHERE owner=? AND kind='viral_experiment' AND parent_id=?`;
// where는 records 행 조건이다. kindInBinds가 참이면 kind가 id에 들어가 kind별로 문장을 나눈다.
export type LinkClause={where:string;binds:(owner:string,campaignId:string,kind:string)=>unknown[];kindInBinds?:true};
export const linkClauses:Record<CampaignLink,LinkClause>={
 self:{where:'id=?',binds:(o,c,k)=>[`${o}:${k}:${c}`],kindInBinds:true},
 parent:{where:'parent_id=?',binds:(o,c)=>[c]},
 brief_draft:{where:"(json_extract(data,'$.campaignId')=? OR json_extract(data,'$.savedCampaignId')=?)",binds:(o,c)=>[c,c]},
 draft_submission:{where:"id IN (SELECT ? || ':hermes_submission:brief-' || json_extract(data,'$.id') FROM records WHERE owner=? AND kind='brief_draft' AND (json_extract(data,'$.campaignId')=? OR json_extract(data,'$.savedCampaignId')=?))",binds:(o,c)=>[o,o,c,c]},
 job_submission:{where:"id IN (SELECT ? || ':' || ? || ':' || id FROM jobs WHERE owner=? AND campaign_id=?)",binds:(o,c,k)=>[o,k,o,c],kindInBinds:true},
 experiment_child:{where:`parent_id IN (${EXPERIMENTS})`,binds:(o,c)=>[o,c]},
 // 점포 출처 규칙의 experimentId는 점포 실험이다. id가 겹치지 않아도 출처로 한 번 더 막는다. origin이 없는 이전 규칙은 바이럴이다.
 experiment_rule:{where:`json_extract(data,'$.experimentId') IN (${EXPERIMENTS}) AND json_extract(data,'$.origin') IS NOT 'store'`,binds:(o,c)=>[o,c]},
 guidance_job:{where:`id IN (SELECT ? || ':' || ? || ':' || id FROM jobs WHERE owner=? AND campaign_id IN (${GUIDANCE_GROUPS}))`,binds:(o,c,k)=>[o,k,o,o,c],kindInBinds:true},
 sequence_attempt:{where:'id=?',binds:(o,c,k)=>[`${o}:${k}:sequence:${c}`],kindInBinds:true},
 data_campaign:{where:"json_extract(data,'$.campaignId')=?",binds:(o,c)=>[c]},
};
// 다른 행(초안·jobs·실험)을 참조해 대상을 찾는 경로. 참조 대상(초안·작업·실험)보다 먼저 실행해야 한다.
export const derivedLinks:ReadonlySet<CampaignLink>=new Set<CampaignLink>(['draft_submission','job_submission','guidance_job','experiment_child','experiment_rule']);
// 파생 경로를 먼저, 캠페인 자신을 마지막에 둔다.
const LINK_ORDER:readonly CampaignLink[]=['draft_submission','job_submission','guidance_job','experiment_child','experiment_rule','data_campaign','brief_draft','sequence_attempt','parent','self'];
export type CampaignScope={link:CampaignLink;kinds:string[];where:string;binds:unknown[]};
// 정책이 같은 kind를 경로별로 묶어 조건을 만든다. 같은 경로의 kind는 한 문장으로 처리해 D1 호출 수를 줄인다.
export function campaignScopes(policy:CampaignDeletionPolicy,owner:string,campaignId:string,filter:(k:RecordKind)=>boolean=()=>true):CampaignScope[]{
 return LINK_ORDER.flatMap(link=>{
  const kinds=recordKinds.filter(k=>k.campaignDeletion===policy&&filter(k)&&k.links?.includes(link)).map(k=>k.kind);
  const clause=linkClauses[link];
  if(!kinds.length)return [];
  return clause.kindInBinds?kinds.map(kind=>({link,kinds:[kind],where:clause.where,binds:clause.binds(owner,campaignId,kind)})):[{link,kinds,where:clause.where,binds:clause.binds(owner,campaignId,'')}];
 });
}
// records에 대한 SQL 한 문장. verb는 'DELETE' 또는 'SELECT ...' 앞부분이다. 여러 경로는 OR로 묶어 한 행을 한 번만 센다.
export function scopesSql(verb:string,owner:string,scopes:readonly CampaignScope[]){
 const parts=scopes.map(s=>`(kind IN (${s.kinds.map(()=>'?').join(',')}) AND ${s.where})`);
 return {sql:`${verb} FROM records WHERE owner=? AND (${parts.join(' OR ')||'0'})`,binds:[owner,...scopes.flatMap(s=>[...s.kinds,...s.binds])]};
}
// 캠페인이 삭제 거부 대상인지 보는 조건(실행·발행·주문 귀속 이력).
export const blockingScopes=(owner:string,campaignId:string)=>campaignScopes('retain',owner,campaignId,k=>!!k.blocksDeletion);
// jobs 테이블의 캠페인 작업: 캠페인 실행 작업과 캠페인 실험의 규칙 초안 작업. 바인드 순서: campaignId, owner, campaignId.
export const campaignJobs={where:`(campaign_id=? OR campaign_id IN (${GUIDANCE_GROUPS}))`,binds:(owner:string,campaignId:string)=>[campaignId,owner,campaignId]};

// 결정 7(b) 표시와 동결 요약. 원문(대조안·실험안·유지 조건·결과 메모·수치 출처)은 담지 않는다.
export type SourceCampaignDeleted={at:string;by:{id:string;email:string|null}|null};
// 보존 규칙에 복사돼 있던 원천 실험 원문을 뺀다: 적용 범위(scope=실험의 유지 조건), sourceAssessment의 유지 조건·결과 메모·판정 사유.
// 규칙 제목·문구(guidance)·연장 기록과 수치 판정(비율·표본·기간·통계·채택/중단)은 남긴다. 필수 문자열 필드는 빈 문자열로 둬 기존 모양을 지킨다.
const RULE_RAW_ASSESSMENT=['conditions','notes','decisionReason'];
export function retireRuleOfDeletedCampaign(r:LearningRule,mark:SourceCampaignDeleted):LearningRule&{sourceCampaignDeleted:SourceCampaignDeleted}{
 const a=r.sourceAssessment,assessment=a?{...Object.fromEntries(Object.entries(a).filter(([k])=>!RULE_RAW_ASSESSMENT.includes(k))),conditions:'',notes:''} as NonNullable<LearningRule['sourceAssessment']>:undefined;
 return {...r,scope:'',...(assessment?{sourceAssessment:assessment}:{}),status:'retired',version:r.version+1,updatedAt:mark.at,sourceCampaignDeleted:mark};
}
export type FrozenExperimentSummary={id:string;experimentId:string;experimentVersion:number;brandId:string;campaignId:string;channel:string;title:string;hypothesis:string;metric:LearningMetric;minSample:number;minHours:number;minLift:number;status:ViralExperiment['status'];assessment:{status:string;label:string;controlRate:number|null;treatmentRate:number|null;lift:number|null}|null;controlSample:number|null;treatmentSample:number|null;startedAt:string|null;observedUntil:string|null;adoptedRuleIds:string[];frozenAt:string;sourceCampaignDeleted:SourceCampaignDeleted};
export function freezeExperimentSummary(e:ViralExperiment,adoptedRuleIds:readonly string[],mark:SourceCampaignDeleted):FrozenExperimentSummary{
 const a=e.assessment;
 return {id:e.id,experimentId:e.id,experimentVersion:e.version,brandId:e.brandId,campaignId:e.campaignId,channel:e.channel,title:e.title,hypothesis:e.hypothesis,metric:e.metric,minSample:e.minSample,minHours:e.minHours,minLift:e.minLift,status:e.status,
  assessment:a?{status:a.status,label:a.label,controlRate:a.controlRate,treatmentRate:a.treatmentRate,lift:a.lift}:null,
  controlSample:e.result?.control.denominator??null,treatmentSample:e.result?.treatment.denominator??null,startedAt:e.startedAt,observedUntil:e.result?.observedUntil??null,
  adoptedRuleIds:[...adoptedRuleIds],frozenAt:mark.at,sourceCampaignDeleted:mark};
}

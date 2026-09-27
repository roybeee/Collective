// 트랙 R R6d 워크스페이스 할 일 판정 순수 모듈. 리드·계약 게이트 요약·정보공개서 버전·모집 자료 귀속 수를 받아 할 일 5종(미응대, 계약 가능일 3일 전,
// 증빙 결손, 변경등록 기한 30일 전, H10 재검토)의 브랜드별 건수를 센다. 시계·조회·스위치·모델 호출이 없다(LLM 0). 읽기는 lib/franchise-workspace-server.ts가 한다.
// 결과에는 브랜드 id와 건수만 있다. 리드 id·가명 코드·이름·연락처는 싣지 않는다. 판정은 COLLECTIVE 휴리스틱 · 법률 자문 아님(결정 20 보류).
import {isDate,isInstant,parseInstant,toKstDate,addDays} from './franchise-rules';
import {amendmentDeadline,GATE_DISCLAIMER} from './franchise-gates';
import {currentDisclosureVersion,fyEndOf,type VersionLite} from './franchise-facts';
import {FRANCHISE_TASKS,CONTRACT_SOON_DAYS,REGISTRATION_DUE_DAYS,H10_REVIEW_AT,EVENT_FOLLOWUP_HOURS,type FranchiseTaskKind,type FranchiseWorkspaceTasks} from './franchise-tasks';

// .2: R15a-3 행사 뒤 48시간 연락(event_followup).
export const WORKSPACE_TASKS_VERSION='fr-tasks@2026-09-28.2';
const DAY_MS=86400000;
export type TaskLead={id:string;stage:string;firstContactAt:string|null;contactState:string;contractedAt:string|null};
// 계약 게이트 요약(lib/franchise-server.ts gateSummaries에서 옮김): 계약 가능 시각(모르면 null), 계약 게이트 통과 여부(계약 기록이 없으면 null).
export type TaskGate={windowAt:string|null;complete:boolean|null};
export type AssetVersionLite={id:string;version:number;brandId:string;status:string};
// 행사 요약(가명 코드·장소 라벨 없이 id·브랜드·시작 시각·상태만).
export type TaskEvent={id:string;brandId:string;startsAt:string;status:string};
export type RegistrationInput={brandId:string;versions:readonly VersionLite[];fiscalYearEnd:string|null};
export type RegistrationReason='version_expiring'|'version_expired'|'annual_deadline';
export type BrandTaskCounts={brandId:string}&Partial<Record<FranchiseTaskKind,number>>;

// 미응대: 문의 단계에서 첫 연락 기록이 없고 연락처가 남은 리드. 파기·삭제된 리드는 연락할 수 없어 세지 않는다.
export const isUnanswered=(l:TaskLead)=>l.stage==='inquiry'&&l.firstContactAt===null&&l.contactState==='present';
// 게이트 요약을 읽을 리드: 계약 기록이 있는 리드(증빙 결손)와 계약 전 정보공개서·계약서안 제공 단계 리드(계약 가능일). 문의·상담 단계는 제공 기록이 없어 읽지 않는다.
export const gateCandidate=(l:TaskLead)=>l.contractedAt!==null||(l.stage==='disclosed'||l.stage==='draft_provided');
// 계약 가능일 3일 전: 계약·종결 전 리드의 계약 가능 시각이 지금 뒤 CONTRACT_SOON_DAYS일 안(이미 지난 시각은 할 일이 아니다).
export function isContractSoon(l:TaskLead,windowAt:string|null|undefined,now:string){
 if(l.contractedAt!==null||l.stage==='closed'||!isInstant(windowAt))return false;
 const t=parseInstant(windowAt),n=parseInstant(now);
 return t>n&&t<=n+CONTRACT_SOON_DAYS*DAY_MS;
}
// 증빙 결손: 계약 기록이 있고 지금 증빙으로 계약 게이트를 다시 돌리면 통과하지 못한다(정정·무효화로 빠진 증빙). 주간 보고 '증빙 완결'의 반대편이다.
export const isEvidenceGap=(complete:boolean|null|undefined)=>complete===false;

// 변경등록 기한: (1) 현재 등록 버전의 유효 기간 끝(등록 때 적은 다음 변경등록 기한)이 30일 안이거나, 현재 버전 없이 마지막 버전이 지났고 뒤를 잇는 등록 버전이 없다.
// (2) 가맹 프로필의 사업연도 종료일이 있으면 정기 변경등록(사업연도 종료 후 120일, 별표 1의2, 신청일 미정이라 가장 이른 기한)이 30일 안이거나 지났고
// 그 사업연도 종료 뒤 등록한 버전이 없다. 등록 버전이 하나도 없는 브랜드는 기한을 모른다(분기 판정은 R0가 한다).
export function registrationDue(i:RegistrationInput,now:string):{due:boolean;reasons:RegistrationReason[]}{
 const n=parseInstant(now),mine=i.versions.filter(v=>v.brandId===i.brandId&&v.status==='active'&&v.registeredAt!==null&&isInstant(v.validFrom)&&isInstant(v.validUntil));
 const reasons:RegistrationReason[]=[];
 if(!mine.length)return {due:false,reasons};
 const successor=mine.some(v=>parseInstant(v.validFrom)>n),current=currentDisclosureVersion(mine,i.brandId,now);
 if(!successor&&current&&parseInstant(current.validUntil)-n<=REGISTRATION_DUE_DAYS*DAY_MS)reasons.push('version_expiring');
 if(!successor&&!current&&mine.some(v=>parseInstant(v.validUntil)<=n))reasons.push('version_expired');
 if(annualDue(mine,i.fiscalYearEnd,now))reasons.push('annual_deadline');
 return {due:reasons.length>0,reasons};
}
function annualDue(versions:readonly VersionLite[],fiscalYearEnd:string|null,now:string){
 if(!fiscalYearEnd||!isDate(fiscalYearEnd))return false;
 const today=toKstDate(now),year=Number(today.slice(0,4)),thisYear=fyEndOf(year,fiscalYearEnd),fy=thisYear<today?thisYear:fyEndOf(year-1,fiscalYearEnd);
 const deadline=amendmentDeadline(fy,{item:'financials'},null).deadline;
 if(!deadline||today<addDays(deadline,-REGISTRATION_DUE_DAYS))return false;
 return !versions.some(v=>isInstant(v.registeredAt)&&toKstDate(v.registeredAt)>fy);
}

// H10: 이 브랜드의 승인 자료 판 가운데 코드 귀속 리드가 H10_REVIEW_AT명 이상인 판 수. attributed 키는 '<자료 id>:<판>'이다.
export function assetReviewCount(brandId:string,assets:readonly AssetVersionLite[],attributed:ReadonlyMap<string,number>){
 return assets.filter(a=>a.brandId===brandId&&a.status==='approved'&&(attributed.get(`${a.id}:${a.version}`)??0)>=H10_REVIEW_AT).length;
}

// 행사 뒤 연락: 예정(취소 아님) 행사 가운데 시작 시각 ≤ 지금 < 시작 + 48시간인 행사 수. 행사 보기(followUps)와 같은 창이다.
export function eventFollowupCount(brandId:string,events:readonly TaskEvent[],now:string){
 if(!isInstant(now))return 0;
 const n=parseInstant(now);
 return events.filter(e=>e.brandId===brandId&&e.status==='scheduled'&&isInstant(e.startsAt)&&parseInstant(e.startsAt)<=n&&n<parseInstant(e.startsAt)+EVENT_FOLLOWUP_HOURS*3600000).length;
}

// 한 브랜드의 할 일 건수. leads는 보는 사람이 볼 수 있는 리드만 넘긴다(직원은 본인 담당·미배정). 변경등록은 설정 화면(대표·관리자)으로 가므로 admin일 때만 센다.
export function brandTaskCounts(i:{brandId:string;leads:readonly TaskLead[];gates:ReadonlyMap<string,TaskGate>;registration:RegistrationInput|null;assets:readonly AssetVersionLite[];attributed:ReadonlyMap<string,number>;admin:boolean;events?:readonly TaskEvent[]},now:string):BrandTaskCounts{
 const gate=(l:TaskLead)=>i.gates.get(l.id);
 return {brandId:i.brandId,
  unanswered:i.leads.filter(isUnanswered).length,
  contract_soon:i.leads.filter(l=>isContractSoon(l,gate(l)?.windowAt,now)).length,
  evidence_gap:i.leads.filter(l=>l.contractedAt!==null&&isEvidenceGap(gate(l)?.complete)).length,
  ...(i.admin?{registration_due:i.registration&&registrationDue(i.registration,now).due?1:0}:{}),
  asset_review:assetReviewCount(i.brandId,i.assets,i.attributed),
  event_followup:eventFollowupCount(i.brandId,i.events??[],now),
 };
}

// 브랜드별 건수를 할 일 목록으로 합친다. 순서는 FRANCHISE_TASKS, 합계 0은 뺀다. 이동할 브랜드는 건수가 가장 많은 브랜드(같으면 id 순)다.
export function buildWorkspaceTasks(rows:readonly BrandTaskCounts[]):FranchiseWorkspaceTasks{
 const items=FRANCHISE_TASKS.flatMap(task=>{
  const hits=rows.filter(r=>(r[task]??0)>0).toSorted((a,b)=>(b[task]??0)-(a[task]??0)||(a.brandId<b.brandId?-1:a.brandId>b.brandId?1:0));
  const count=hits.reduce((s,r)=>s+(r[task]??0),0);
  return count>0?[{task,count,brandId:hits[0].brandId}]:[];
 });
 return {items,ruleVersion:WORKSPACE_TASKS_VERSION,disclaimer:GATE_DISCLAIMER};
}

// GEO 프로토콜 v2 — 개선 변경 기록(record kind geo_change, 순수 모듈). '가설 → 작은 변경 → 같은 조건 재관측'의 변경 쪽 기록이다.
// 변경 하나마다 반영일(게시·색인 확인일, KST 날짜)부터 +14·+42일 재관측을 예약한다(lib/scheduled-runs.ts geoRecheckDates).
// 엔티티 부재 처방 0(공식 정보 페이지·지도 등록 정보·이름 표기)은 한 묶음 변경(entity_basics)으로 적고 효과를 하나씩 나누지 않는다.
import {geoRecheckDates,kstParts,type GeoRecheck} from './scheduled-runs';
import {GEO_QUESTION_ID} from './geo-questions';

export const GEO_CHANGE_KINDS=['entity_basics','faq','page','listing','other'] as const;
export type GeoChangeKind=typeof GEO_CHANGE_KINDS[number];
export const GEO_CHANGE_KIND_LABELS:Record<GeoChangeKind,string>={entity_basics:'처방 0 묶음(공식 정보 페이지·지도 등록 정보·표기 통일)',faq:'자주 묻는 질문 추가·수정',page:'공식 페이지 본문 수정',listing:'플랫폼 등록 정보 수정',other:'기타'};
export const GEO_CHANGE_BASES=['published','indexed'] as const;
export type GeoChangeBasis=typeof GEO_CHANGE_BASES[number];
export const GEO_CHANGE_SUMMARY_MAX=200,GEO_CHANGE_BACK_DAYS=365;
export const GEO_CHANGE_ID=/^gchg-[a-z0-9]{8,32}$/;
export type GeoChangeInput={kind:GeoChangeKind;summary:string;appliedOn:string;appliedBasis:GeoChangeBasis;questionIds:string[]};
export type GeoChange=GeoChangeInput&{id:string;brandId:string;campaignId:string;rechecks:GeoRecheck[];createdAt:string;createdBy:string};

export class GeoChangeError extends Error{constructor(message:string){super(message);this.name='GeoChangeError'}}
const fail=(m:string):never=>{throw new GeoChangeError(m)};
const DAY=86400000;
export function parseGeoChangeInput(value:unknown,now:number):GeoChangeInput{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('변경 기록 입력 객체가 필요합니다.');
 const b=value as Record<string,unknown>;
 if(!GEO_CHANGE_KINDS.includes(b.kind as GeoChangeKind))fail('변경 종류를 고르세요.');
 if(typeof b.summary!=='string'||!b.summary.trim()||b.summary.length>GEO_CHANGE_SUMMARY_MAX||/[\u0000-\u001f\u007f]/.test(b.summary))fail(`변경 요약은 1~${GEO_CHANGE_SUMMARY_MAX}자 한 줄입니다.`);
 const day=typeof b.appliedOn==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(b.appliedOn)&&new Date(b.appliedOn+'T00:00:00Z').toISOString().slice(0,10)===b.appliedOn?b.appliedOn:fail('반영일은 YYYY-MM-DD 날짜입니다.');
 const today=kstParts(now).day,earliest=kstParts(now-GEO_CHANGE_BACK_DAYS*DAY).day;
 if(day>today)fail('반영일은 오늘(한국 시간) 이후일 수 없습니다. 반영을 확인한 날을 적으세요.');
 if(day<earliest)fail(`반영일은 최근 ${GEO_CHANGE_BACK_DAYS}일 안이어야 합니다.`);
 if(!GEO_CHANGE_BASES.includes(b.appliedBasis as GeoChangeBasis))fail('반영 근거(게시 확인·색인 확인)를 고르세요.');
 const ids=b.questionIds===undefined?[]:b.questionIds;
 if(!Array.isArray(ids)||ids.length>30||ids.some(id=>typeof id!=='string'||!GEO_QUESTION_ID.test(id)))fail('관련 질문 번호 형식이 올바르지 않습니다.');
 return {kind:b.kind as GeoChangeKind,summary:(b.summary as string).replace(/\s+/g,' ').trim(),appliedOn:day,appliedBasis:b.appliedBasis as GeoChangeBasis,questionIds:[...new Set(ids as string[])]};
}
export const newRechecks=(appliedOn:string):GeoRecheck[]=>geoRecheckDates(appliedOn).map(r=>({...r,status:'scheduled'}));
// 재관측 시작 표시(새 객체). 같은 회차를 두 번 시작하지 않는다.
export const markRecheckStarted=(c:GeoChange,offset:number,runId:string,at:string):GeoChange=>({...c,rechecks:c.rechecks.map(r=>r.offset===offset&&r.status==='scheduled'?{...r,status:'started',runId,startedAt:at}:r)});
// 재관측 측정 번호: 변경 id와 회차로 정한다(같은 회차는 같은 번호라 두 번 만들지 않는다).
export const recheckRunId=(changeId:string,offset:number)=>'geo-run-'+(changeId.replace(/[^a-z0-9]/g,'')+'d'+offset).slice(-32);

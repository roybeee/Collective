// Evidence registration does not authenticate its author or override source policy.
import {ApiError} from '../server';
import {SOURCES} from './sources';
import type {LaunchOutcome} from './api';
import type {BlindResult,GroundTruth,LegalEvidence,ValidationEvidence,ValidationGate,ValidationMutation,ValidationReadiness} from './validation-types';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[a-f0-9]{64}$/i;
const fail=(field:string):never=>{throw new ApiError(400,`${field} 입력을 확인해 주세요.`)};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))return fail('증빙');return value as Record<string,unknown>}
function text(row:Record<string,unknown>,key:string,max=200):string{const v=row[key];if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f\x7f]/.test(v))return fail(key);return v.trim()}
function hash(row:Record<string,unknown>,key:string):string{const v=text(row,key,64);if(!HEX.test(v))return fail(key);return v.toLowerCase()}
function url(row:Record<string,unknown>):string{const v=text(row,'evidenceUrl',2000);try{const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password)throw new Error()}catch{return fail('HTTPS 증빙 링크')}return v}
function time(row:Record<string,unknown>,key:string,now:Date,future=false):string{
 const v=text(row,key,40),stamp=Date.parse(v);
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)||!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,19)!==v.slice(0,19)||(!future&&stamp>now.getTime()))return fail(key);
 return new Date(stamp).toISOString();
}
function day(row:Record<string,unknown>,key:string):string{const v=text(row,key,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)return fail(key);return v}
function choice<T extends string>(row:Record<string,unknown>,key:string,values:readonly T[]):T{const v=row[key];if(typeof v!=='string'||!values.includes(v as T))return fail(key);return v as T}
function legal(value:unknown,now:Date):LegalEvidence{
 const r=object(value),sourceId=text(r,'sourceId',80);if(!SOURCES.some(s=>s.id===sourceId))return fail('sourceId');
 const reviewedAt=time(r,'reviewedAt',now),validUntil=time(r,'validUntil',now,true);if(validUntil<=reviewedAt)return fail('검토 유효 기간');
 return {id:text(r,'id',80),sourceId,reviewer:text(r,'reviewer'),reviewedAt,validUntil,evidenceUrl:url(r),allowedScope:text(r,'allowedScope',2000),decision:choice(r,'decision',['approved','restricted','rejected'])};
}
function truth(value:unknown,now:Date):GroundTruth{
 const r=object(value),periodStart=day(r,'periodStart'),periodEnd=day(r,'periodEnd'),decisionAt=time(r,'decisionAt',now),criterionFrozenAt=time(r,'criterionFrozenAt',now),reviewedAt=time(r,'reviewedAt',now);
 if(periodEnd<periodStart||decisionAt>`${periodStart}T00:00:00.000Z`||criterionFrozenAt>`${periodStart}T00:00:00.000Z`||reviewedAt.slice(0,10)<=periodEnd)return fail('예측·기준 고정·관측·검수 시간 순서');
 return {id:text(r,'id',80),sku:text(r,'sku',80),title:text(r,'title'),periodStart,periodEnd,decisionAt,criterion:text(r,'criterion',2000),criterionFrozenAt,evidenceUrl:url(r),evidenceHash:hash(r,'evidenceHash'),reviewer:text(r,'reviewer'),reviewedAt,label:choice(r,'label',['hit','control']),origin:choice(r,'origin',['human','candidate','ai'])};
}
function blind(value:unknown,now:Date):BlindResult{
 const r=object(value),frozenAt=time(r,'frozenAt',now),evaluatedAt=time(r,'evaluatedAt',now);if(evaluatedAt<frozenAt)return fail('동결·평가 시간 순서');
 if(typeof r.score!=='number'||!Number.isFinite(r.score)||r.score<0||r.score>5)return fail('score');
 return {id:text(r,'id',80),evaluatorName:text(r,'evaluatorName'),packetHash:hash(r,'packetHash'),submittedFileHash:hash(r,'submittedFileHash'),frozenAt,evaluatedAt,evidenceUrl:url(r),score:r.score,independence:'unverified_owner_submission'};
}
export function parseValidationMutation(value:unknown,now=new Date()):ValidationMutation{
 const r=object(value);if(typeof r.requestId!=='string'||!UUID.test(r.requestId))return fail('requestId');
 if(!Number.isSafeInteger(r.expectedVersion)||(r.expectedVersion as number)<0)return fail('expectedVersion');
 const section=choice(r,'section',['legal','groundTruth','blind']);if(!Array.isArray(r.entries)||r.entries.length>500)return fail('증빙 목록(최대 500개)');
 const common={requestId:r.requestId.toLowerCase(),expectedVersion:r.expectedVersion as number};
 const parsed:ValidationMutation=section==='legal'?{...common,section,entries:r.entries.map(v=>legal(v,now))}:section==='groundTruth'?{...common,section,entries:r.entries.map(v=>truth(v,now))}:{...common,section,entries:r.entries.map(v=>blind(v,now))};
 if(new Set(parsed.entries.map(v=>v.id)).size!==parsed.entries.length)return fail('중복 증빙 ID');
 return parsed;
}
const gate=(verified:number,required:number,reasons:string[]):ValidationGate=>({ready:verified>=required&&!reasons.length,verified,required,reasons});
export function validationReadiness(evidence:ValidationEvidence,outcomes:LaunchOutcome[],now=new Date()):ValidationReadiness{
 const required=['naver_datalab_search','naver_datalab_shopping'];
 const covered=required.filter(source=>{const rows=evidence.legal.filter(e=>e.sourceId===source).sort((a,b)=>b.reviewedAt.localeCompare(a.reviewedAt));return rows.length&&rows.filter(r=>r.reviewedAt===rows[0].reviewedAt).every(r=>r.decision==='approved'&&Date.parse(r.validUntil)>now.getTime())});
 const legalGate=gate(covered.length,required.length,required.filter(s=>!covered.includes(s)).map(s=>`${s}: 현재 유효한 법무 승인 증빙 필요`));
 const human=evidence.groundTruth.filter(e=>e.origin==='human'),skus=new Set(human.map(e=>e.sku)),labels=new Set(human.map(e=>e.label));
 const truthReasons=[...(human.length!==skus.size?['중복 SKU를 제거하고 독립 상품 표본으로 정리해야 합니다.']:[]),...(skus.size<50?['사람이 검수한 서로 다른 정확한 SKU 50개 이상 필요']:[]),...(labels.size<2?['성공(hit)과 대조(control) 표본 모두 필요']:[])];
 const truthGate=gate(skus.size,50,truthReasons);
 // An owner supplying names/files is not proof of distinct authenticated raters or blinding.
 const blindGate=gate(0,3,['소유자 대리 등록은 독립성 미확인입니다. 실제 평가자 3명의 계정·맹검 절차 검증이 필요합니다.']);
 const measured=new Set(outcomes.filter(o=>o.sku&&!o.reason&&o.windows.some(w=>w.complete&&w.orders!==null&&w.orders>0&&w.units!==null&&w.revenue!==null)).map(o=>o.sku));
 const salesGate=gate(measured.size,1,measured.size?[]:['성장2에서 넘긴 정확한 SKU의 관측 기간 종료·실제 주문 결과 필요(과거 참고 매출 제외)']);
 return {complete:legalGate.ready&&truthGate.ready&&blindGate.ready&&salesGate.ready,legal:legalGate,groundTruth:truthGate,blind:blindGate,sales:salesGate};
}

import {executionId,executionSafeText} from './growth-execution';
export class GrowthExpansionError extends Error {}
export type ExpansionInput={missionId:string;missionVersion:number;experimentId:string;analysisNumber:number;nextBudget:number;addQuantity:number;rationale:string};
export type ExpansionEvidence={experimentId:string;analysisNumber:number;status:string;interval:[number,number]|null;minEffect:number;metric:string;channel:string;offerId:string;offerVersion:number;designDigest:string;inputDigest:string;recordedAt:string;refs:{kind:string;id:string;version:number}[]};
export const EVIDENCE_MAX_AGE_DAYS=90;
export function parseExpansionInput(value:unknown):ExpansionInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new GrowthExpansionError('확대 제안 입력을 확인하세요.');const b=value as Record<string,unknown>;
 const int=(v:unknown,label:string,min:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=1_000_000_000_000?v:(()=>{throw new GrowthExpansionError(`${label}: ${min} 이상 정수를 입력하세요.`)})();
 try{return {missionId:executionId(b.missionId),missionVersion:int(b.missionVersion,'미션 판',1),experimentId:executionId(b.experimentId),analysisNumber:int(b.analysisNumber,'분석 회차',1),nextBudget:int(b.nextBudget,'확대 후 예산',1),addQuantity:int(b.addQuantity,'추가 판매 수량',0),rationale:executionSafeText(b.rationale,'확대 이유',1000)}}
 catch(e){if(e instanceof GrowthExpansionError)throw e;throw new GrowthExpansionError(e instanceof Error?e.message:'입력을 확인하세요.')}
}
/**
 * Evidence validity for a single owner-approved scale step. Exploration results, stale or superseded analyses, other offers/channels,
 * unknown or negative unit contribution and insufficient shared stock all block; causal scope stays the registered one.
 */
export function assessExpansion(x:{input:ExpansionInput;evidence:ExpansionEvidence|null;latestAnalysis:number|null;experiment:{status:string;mode:string;aa:boolean;missionId:string;registrationDigest:string|null}|null;refsCurrent:boolean;mission:{version:number;channel:string;offerId:string;budget:number|null}|null;offer:{version:number;unitContribution:number|null}|null;stock:{status:string;available:number|null}|null;now:number}){
 const r:string[]=[],e=x.evidence,m=x.mission,prev=m?.budget??null;
 if(!x.experiment||!e)r.push('분석 결과를 찾지 못했습니다.');
 else{
  if(x.experiment.status!=='registered'||x.experiment.mode!=='confirm'||x.experiment.aa)r.push('사전등록한 확증 실험(A/A 제외)만 확대 근거가 됩니다.');
  if(x.experiment.missionId!==x.input.missionId)r.push('실험의 미션과 확대할 미션이 다릅니다.');
  if(e.status!=='supported')r.push('개선 근거(supported) 결과만 확대 근거가 됩니다.');
  if(x.latestAnalysis!==e.analysisNumber)r.push('더 최근 분석이 있습니다. 최신 회차로 다시 검토하세요.');
  if(e.designDigest!==x.experiment.registrationDigest)r.push('분석 결과의 설계 digest가 등록 설계와 다릅니다.');
  if(x.now-Date.parse(e.recordedAt)>EVIDENCE_MAX_AGE_DAYS*86400000)r.push(`${EVIDENCE_MAX_AGE_DAYS}일이 지난 분석은 확대 근거로 쓰지 않습니다.`);
  if(!x.refsCurrent)r.push('실험 당시 개입 근거의 판이 바뀌었습니다(증거 유효범위 밖).');
 }
 if(!m||m.version!==x.input.missionVersion)r.push('판매 미션의 현재 판을 확인하세요.');
 if(m&&e&&(m.channel!==e.channel||m.offerId!==e.offerId))r.push('실험과 같은 채널·오퍼에서만 확대합니다.');
 if(!x.offer||(e&&x.offer.version!==e.offerVersion))r.push('실험 당시와 같은 오퍼 판에서만 확대합니다.');
 const profitable=x.offer?.unitContribution!==null&&x.offer?.unitContribution!==undefined&&x.offer.unitContribution>0;if(!profitable)r.push('오퍼 단위 공헌이익이 확인된 양수여야 합니다.');
 const capacity=x.stock?.status==='known'&&x.stock.available!==null&&x.stock.available>=x.input.addQuantity;if(!capacity)r.push('공유 가용 재고가 추가 판매 수량보다 적거나 확인되지 않습니다.');
 if(prev===null||prev<=0)r.push('기존 예산이 있는 미션만 확대합니다.');
 else if(x.input.nextBudget<=prev||x.input.nextBudget-prev>Math.floor(prev/5))r.push('확대는 기존 예산 대비 1회 20% 이내여야 합니다.');
 return {allowed:!r.length,reasons:[...new Set(r)],incremental:!!e&&e.status==='supported',profitable,capacity,previousBudget:prev,increase:prev!==null?x.input.nextBudget-prev:null,causalScope:e?`${e.channel}·오퍼 ${e.offerId} v${e.offerVersion}·실험 ${e.experimentId} ${e.analysisNumber}회차 범위`:null};
}

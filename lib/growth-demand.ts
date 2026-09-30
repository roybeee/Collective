import {scanText} from './pii-scan';

export type DemandStep = {
  id:string; channel:'storefront'|'organic'|'meta'|'manual'; placement:'owned'|'ad'|'creator'|'partner';
  message:string; useScene:string; creativeBrief:string; keywords:string[]; audience:string;
  purchaseUrl:string; sourceUrls:string[]; rightsStatus:'unknown'|'confirmed'|'denied';
  rightsEvidence:string; authenticityConfirmed:boolean; partnerRole:string; partnerTerms:string; plannedCost:number|null;
  performanceStatus:'not_measured'|'observed'; performanceEvidence:string; performanceNote:string;
};
export type DemandInput = {
  title:string; offerId:string; offerVersion:number; missionId:string; missionVersion:number;
  objective:string; steps:DemandStep[];
};
export class GrowthDemandError extends Error {
  constructor(message:string) { super(message); this.name='GrowthDemandError'; }
}
export function emptyDemandStep():DemandStep {
  return {id:'',channel:'organic',placement:'owned',message:'',useScene:'',creativeBrief:'',keywords:[],audience:'',
    purchaseUrl:'',sourceUrls:[],rightsStatus:'unknown',rightsEvidence:'',authenticityConfirmed:false,partnerRole:'',partnerTerms:'',plannedCost:null,
    performanceStatus:'not_measured',performanceEvidence:'',performanceNote:''};
}
export function emptyDemandInput():DemandInput {
  return {title:'',offerId:'',offerVersion:0,missionId:'',missionVersion:0,objective:'',steps:[]};
}
function object(value:unknown):Record<string,unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new GrowthDemandError('입력은 객체여야 합니다.');
  return value as Record<string,unknown>;
}
function safeText(value:unknown,field:string,max=2000):string {
  if (value===undefined) return '';
  if (typeof value!=='string' || value.length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new GrowthDemandError(`${field}: 유효한 문자열을 입력하세요(최대 ${max}자).`);
  }
  const normalized=value.normalize('NFKC').replace(/[\u200b-\u200d\u2060\ufeff]/g,'');
  if (scanText(normalized).length || /(?:bearer\s+\S+|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*\S+|\bsk-(?:proj-)?[\w-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(normalized)) {
    throw new GrowthDemandError(`${field}: 식별정보와 인증정보를 넣을 수 없습니다.`);
  }
  return value.trim();
}
function identifier(value:unknown,field:string):string {
  const result=safeText(value,field,100);
  if (result && !/^[A-Za-z0-9_.:-]+$/.test(result)) throw new GrowthDemandError(`${field}: 내부 식별자를 입력하세요.`);
  return result;
}
function number(value:unknown,field:string,fallback:number|null):number|null {
  if (value===undefined) return fallback;
  if (value===null && fallback===null) return null;
  if (typeof value!=='number' || !Number.isSafeInteger(value) || value<0) throw new GrowthDemandError(`${field}: 0 이상의 안전한 정수를 입력하세요.`);
  return value;
}
function choice<T extends string>(value:unknown,values:readonly T[],fallback:T,field:string):T {
  if (value===undefined) return fallback;
  if (typeof value!=='string' || !values.includes(value as T)) throw new GrowthDemandError(`${field}: 지원하는 값을 선택하세요.`);
  return value as T;
}
function confirmation(value:unknown):boolean {
  if (value===undefined) return false;
  if (typeof value!=='boolean') throw new GrowthDemandError('진정성 확인은 참 또는 거짓이어야 합니다.');
  return value;
}
function publicUrl(value:unknown):string {
  const result=safeText(value,'공개 URL',2048);
  if (!result) return '';
  let url:URL;
  try { url=new URL(result); } catch { throw new GrowthDemandError('공개 URL 형식이 유효하지 않습니다.'); }
  const host=url.hostname.toLowerCase();
  const publicDomain=/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) && !/(^|\.)(localhost|local|internal|test|invalid|lan|home|onion)$/.test(host);
  if (url.protocol!=='https:' || url.username || url.password || url.port || !publicDomain || /[\s\\?#]/.test(result)) {
    throw new GrowthDemandError('공개 URL은 인증정보·쿼리·해시 없는 공개 HTTPS 주소여야 합니다.');
  }
  let path=url.pathname;
  for (let round=0;round<4;round++) {
    let decoded:string;
    try { decoded=decodeURIComponent(path); } catch { throw new GrowthDemandError('URL 인코딩을 확인하세요.'); }
    safeText(decoded,'URL 경로',2048);
    if (decoded===path) return result;
    path=decoded;
  }
  throw new GrowthDemandError('URL 경로가 과도하게 인코딩되어 있습니다.');
}
function strings(value:unknown,field:string,max:number,parse:(item:unknown)=>string):string[] {
  if (value===undefined) return [];
  if (!Array.isArray(value) || value.length>max) throw new GrowthDemandError(`${field}: 최대 ${max}개 배열이어야 합니다.`);
  return [...new Set(value.map(item=>{
    const result=parse(item);
    if (!result) throw new GrowthDemandError(`${field}: 빈 항목을 넣을 수 없습니다.`);
    return result;
  }))];
}
function parseStep(value:unknown):DemandStep {
  const input=object(value);
  const step:DemandStep={id:identifier(input.id,'단계 ID'),
    channel:choice(input.channel,['storefront','organic','meta','manual'],'organic','채널'),
    placement:choice(input.placement,['owned','ad','creator','partner'],'owned','게재 방식'),
    message:safeText(input.message,'메시지'),useScene:safeText(input.useScene,'사용 장면'),
    creativeBrief:safeText(input.creativeBrief,'소재 지침'),keywords:strings(input.keywords,'키워드',30,item=>safeText(item,'키워드',100)),
    audience:safeText(input.audience,'대상'),purchaseUrl:publicUrl(input.purchaseUrl),sourceUrls:strings(input.sourceUrls,'출처 URL',20,publicUrl),
    rightsStatus:choice(input.rightsStatus,['unknown','confirmed','denied'],'unknown','권리 상태'),
    rightsEvidence:safeText(input.rightsEvidence,'권리 근거'),authenticityConfirmed:confirmation(input.authenticityConfirmed),partnerRole:safeText(input.partnerRole,'협력 역할'),
    partnerTerms:safeText(input.partnerTerms,'협력 조건'),plannedCost:number(input.plannedCost,'계획 비용',null),
    performanceStatus:choice(input.performanceStatus,['not_measured','observed'],'not_measured','성과 상태'),
    performanceEvidence:safeText(input.performanceEvidence,'관찰 근거'),performanceNote:safeText(input.performanceNote,'관찰 설명')};
  if (step.plannedCost!==null && step.plannedCost>1_000_000_000_000) throw new GrowthDemandError('단계 계획 비용은 1조 원 이하여야 합니다.');
  if (step.performanceStatus==='observed' && (!step.performanceEvidence || !step.performanceNote)) {
    throw new GrowthDemandError('관찰 성과에는 근거와 설명이 필요합니다.');
  }
  return step;
}
export function parseDemandInput(value:unknown):DemandInput {
  const input=object(value),rawSteps=input.steps===undefined?[]:input.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length>12) throw new GrowthDemandError('수요 단계는 최대 12개여야 합니다.');
  const steps=rawSteps.map(parseStep),ids=steps.map(step=>step.id);
  if (new Set(ids).size!==ids.length) throw new GrowthDemandError('수요 단계 ID가 중복되었습니다.');
  return {title:safeText(input.title,'시퀀스 제목',200),offerId:identifier(input.offerId,'오퍼 ID'),
    offerVersion:number(input.offerVersion,'오퍼 버전',0)!,missionId:identifier(input.missionId,'미션 ID'),
    missionVersion:number(input.missionVersion,'미션 버전',0)!,objective:safeText(input.objective,'목표'),steps};
}
// Narrow explicit instruction patterns; this is not a semantic authenticity classifier.
function fabricationInstruction(value:string):boolean {
  const text=value.normalize('NFKC').replace(/[\u200b-\u200d\u2060\ufeff]/g,'');
  const pattern=/(?:가짜|허위)\s*(?:후기|리뷰|참여|좋아요|팔로워)\s*(?:작성|제작|생성|구매|조작)|(?:fake|fabricated)\s+(?:reviews?|engagement)\s+(?:creation|generation|purchase)|(?:buy|create|generate|purchase)\s+(?:fake|fabricated)\s+(?:reviews?|engagement)/gi;
  return [...text.matchAll(pattern)].some(match=>{
    const before=text.slice(Math.max(0,match.index!-20),match.index!);
    const after=text.slice(match.index!+match[0].length);
    return !/\b(?:do not|don't|never|must not)\s*$/i.test(before) && !/^\s*(?:금지|하지\s*(?:마|말)|불가|엄금)/.test(after);
  });
}
function stepMissing(step:DemandStep,index:number):string[] {
  const label=`단계 ${index+1}: `;
  const required:readonly [string,string][]=[[step.id,'단계 ID'],[step.message,'메시지'],[step.useScene,'사용 장면'],
    [step.creativeBrief,'소재 지침'],[step.audience,'대상'],[step.purchaseUrl,'구매 URL'],[step.rightsEvidence,'권리 근거']];
  return [...required.filter(([value])=>!value).map(([,field])=>`${label}${field}를 입력하세요.`),
    ...(!step.sourceUrls.length?[`${label}출처 URL을 연결하세요.`]:[]),
    ...(step.rightsStatus!=='confirmed'?[`${label}사용 권리를 확인하세요.`]:[]),
    ...(!step.authenticityConfirmed?[`${label}가짜 참여·후기를 만들지 않는지 확인하세요.`]:[]),
    ...([step.message,step.creativeBrief,step.partnerTerms].some(fabricationInstruction)?[`${label}가짜 참여·후기 제작 지시를 제거하세요.`]:[]),
    ...(step.plannedCost===null?[`${label}계획 비용을 확인하세요.`]:[]),
    ...(['creator','partner'].includes(step.placement) && (!step.partnerRole || !step.partnerTerms)?[`${label}협력 역할과 조건을 확인하세요.`]:[])];
}
/** Preparation is not permission to publish, spend, send, or claim causal performance. */
export function demandReadiness(value:DemandInput,upstream:string[]):{missing:string[];mayExecute:false;plannedCost:number|null} {
  const input=parseDemandInput(value);
  const total=input.steps.reduce((sum,step)=>sum+(step.plannedCost??0),0);
  const plannedCost=input.steps.length && input.steps.every(step=>step.plannedCost!==null) && Number.isSafeInteger(total)?total:null;
  const missing=[...upstream,
    ...(!input.title?['시퀀스 제목을 입력하세요.']:[]),...(!input.objective?['수요 시퀀스 목표를 입력하세요.']:[]),
    ...(!input.offerId || input.offerVersion<1?['현재 오퍼와 버전을 연결하세요.']:[]),
    ...(!input.missionId || input.missionVersion<1?['현재 미션과 버전을 연결하세요.']:[]),
    ...(!input.steps.length?['수요 단계를 하나 이상 추가하세요.']:[]),
    ...input.steps.flatMap(stepMissing),...(!Number.isSafeInteger(total)?['계획 비용 합계가 계산 범위를 초과합니다.']:[])];
  return {missing:[...new Set(missing)],mayExecute:false,plannedCost};
}

import {scanText} from './pii-scan';
import type {FactRef} from './brand-facts';
export class GrowthLandingError extends Error {}
export const landingSectionKinds=['headline','purchase_reason','price_display','shipping','returns','trust','option_guide','faq','cta'] as const;
export type LandingSection={kind:typeof landingSectionKinds[number];before:string;after:string;factIds:string[]};
export type LandingProposalInput={title:string;offerId:string;offerVersion:number;journeyId:string;journeyVersion:number;landingUrl:string;rationale:string;rollbackPlan:string;sections:LandingSection[]};
export type LandingStatus='draft'|'approved'|'applied'|'rolled_back'|'withdrawn';
export type LandingSnapshot={offerVersion:number;catalogId:string;catalogVersion:number;offerPrice:number|null;priceApproved:boolean;facts:FactRef[];journeyVersion:number|null};
export type LandingReceipt={method:'manual_attested';at:string;evidenceRef:string;observedUrl:string;recordedAt:string;recordedBy:string;reason:string};
const control=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/,secret=/(?:bearer\s+\S+|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*\S+|\bsk-(?:proj-)?[\w-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
function text(value:unknown,field:string,max:number,required=false):string{
 if(value===undefined||value==='')return required?fail(`${field}을(를) 입력하세요.`):'';
 if(typeof value!=='string'||value.length>max||control.test(value))fail(`${field}: 최대 ${max}자 문자열이어야 합니다.`);
 const normalized=(value as string).normalize('NFKC').replace(/[​-‍⁠﻿]/g,'');
 if(scanText(normalized).length||secret.test(normalized))fail(`${field}: 식별정보·인증정보를 넣을 수 없습니다.`);
 return (value as string).trim();
}
function fail(message:string):never{throw new GrowthLandingError(message)}
const id=(v:unknown,field:string,required=true)=>{const r=text(v,field,100,required);if(r&&!/^[A-Za-z0-9_-]+$/.test(r))fail(`${field}: 내부 식별자 형식을 확인하세요.`);return r};
const version=(v:unknown,field:string,min:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min?v:fail(`${field}: 정확한 판을 입력하세요.`);
export function landingUrl(value:unknown):string{
 const raw=text(value,'상세페이지 URL',2048,true);let url:URL;try{url=new URL(raw)}catch{return fail('상세페이지 URL 형식을 확인하세요.')}
 if(url.protocol!=='https:'||url.username||url.password||url.port||/[\s\\?#]/.test(raw)||!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname.toLowerCase()))fail('상세페이지 URL은 인증정보·쿼리 없는 공개 HTTPS 주소여야 합니다.');
 return raw;
}
export function parseLandingProposal(value:unknown):LandingProposalInput{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('수정안 입력을 확인하세요.');const b=value as Record<string,unknown>;
 if(!Array.isArray(b.sections)||b.sections.length<1||b.sections.length>12)fail('변경 구역은 1~12개여야 합니다.');
 const sections=(b.sections as unknown[]).map((raw,i)=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail(`구역 ${i+1}: 입력을 확인하세요.`);const s=raw as Record<string,unknown>;
  if(!landingSectionKinds.includes(s.kind as LandingSection['kind']))fail(`구역 ${i+1}: 지원하는 구역을 선택하세요.`);
  if(s.factIds!==undefined&&(!Array.isArray(s.factIds)||s.factIds.length>10))fail(`구역 ${i+1}: 사실 근거는 최대 10개입니다.`);
  const section:LandingSection={kind:s.kind as LandingSection['kind'],before:text(s.before,`구역 ${i+1} 현재 문구`,2000),after:text(s.after,`구역 ${i+1} 변경 문구`,2000,true),factIds:[...new Set(((s.factIds as unknown[])??[]).map(f=>id(f,'사실 ID')))]};
  if(section.before===section.after)fail(`구역 ${i+1}: 현재 문구와 변경 문구가 같습니다.`);
  return section;
 });
 if(new Set(sections.map(s=>s.kind)).size!==sections.length)fail('같은 구역을 두 번 바꿀 수 없습니다.');
 const journeyId=id(b.journeyId,'병목 ID',false);
 return {title:text(b.title,'수정안 제목',200,true),offerId:id(b.offerId,'오퍼 ID'),offerVersion:version(b.offerVersion,'오퍼',1),journeyId,journeyVersion:journeyId?version(b.journeyVersion,'병목',1):0,landingUrl:landingUrl(b.landingUrl),rationale:text(b.rationale,'변경 이유',2000,true),rollbackPlan:text(b.rollbackPlan,'되돌림 기준',1000,true),sections};
}
const digits=(n:number)=>[String(n),n.toLocaleString('en-US')];
const prices=(s:string)=>[...s.normalize('NFKC').matchAll(/\d{1,3}(?:,\d{3})+|\d+/g)].map(m=>Number(m[0].replaceAll(',','')));
/** Readiness is review-only: approval never means the page changed, and price/stock/rights claims must match approved sources. */
export function landingReadiness(input:LandingProposalInput,ctx:{offerPrice:number|null;priceApproved:boolean;rightsConfirmed:boolean;factIds:string[];offerLandingUrl:string}){
 const missing:string[]=[],known=new Set(ctx.factIds);
 if(input.landingUrl!==ctx.offerLandingUrl)missing.push('오퍼에 등록한 상세페이지 URL과 같아야 합니다.');
 if(!ctx.rightsConfirmed)missing.push('상품 권리 확인이 필요합니다.');
 for(const s of input.sections){
  for(const f of s.factIds)if(!known.has(f))missing.push(`${s.kind}: 현재 확정 사실이 아닌 근거(${f})가 있습니다.`);
  const numbers=prices(s.after);
  if(s.kind==='price_display'){if(!ctx.priceApproved||ctx.offerPrice===null)missing.push('가격 표시는 승인된 오퍼 가격이 있어야 합니다.');else if(!digits(ctx.offerPrice).some(d=>s.after.includes(d))||numbers.some(n=>n>=100&&n!==ctx.offerPrice))missing.push('가격 표시 문구는 승인된 오퍼 가격과 같아야 합니다.');}
  else if(/[원₩]|KRW/i.test(s.after)&&numbers.some(n=>n>=100&&n!==ctx.offerPrice))missing.push(`${s.kind}: 승인되지 않은 금액 표기가 있습니다.`);
  if(/재고\s*\d|\d+\s*개\s*남|한정\s*\d+/.test(s.after))missing.push(`${s.kind}: 재고·한정 수량 표기는 공유 재고 확인 경로 밖에서 쓰지 않습니다.`);
  if(['trust','shipping','returns'].includes(s.kind)&&!s.factIds.length)missing.push(`${s.kind}: 신뢰·배송·반품 문구에는 확정 사실 근거가 필요합니다.`);
 }
 return {missing:[...new Set(missing)],mayApply:false as const};
}
export function parseReceipt(value:unknown,now=Date.now()):Pick<LandingReceipt,'at'|'evidenceRef'|'observedUrl'|'reason'>{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('적용 확인 입력을 확인하세요.');const b=value as Record<string,unknown>;
 const at=text(b.at,'적용·되돌림 시각',40,true);if(!Number.isFinite(Date.parse(at))||Date.parse(at)>now+60_000)fail('적용·되돌림 시각은 현재 이전이어야 합니다.');
 return {at:new Date(Date.parse(at)).toISOString(),evidenceRef:id(b.evidenceRef,'페이지 확인 증빙 ID'),observedUrl:landingUrl(b.observedUrl),reason:text(b.reason,'사유',500)};
}

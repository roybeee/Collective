import type {Campaign} from './agency';
import type {ArchiveSource,BrandResearch} from './archive';
import {parseSignalInput,signalEvidence,type SignalInput} from './growth-market';
import {executionSafeText} from './growth-execution';
export type SignalSourceProvenance={sourceId:string;sourceVersion:number;sourceDigest:string;researchId:string|null;importedAt:string};
export function signalSourceText(value:unknown,max:number){if(typeof value!=='string')throw Error('invalid source text');executionSafeText(value.replace(/[\r\n\t]/g,' '),'자료',max);return value.trim()}
export function assessSignalSource(c:Pick<Campaign,'brandId'|'storeId'>,s:ArchiveSource|null,r:BrandResearch|null,expiresAt:string,now=Date.now()):{status:'ready'|'held';input:SignalInput|null;reasons:string[]}{
 const reasons:string[]=[];let input:SignalInput|null=null;
 if(!s||s.brandId!==c.brandId||(s.storeId!==undefined&&s.storeId!==c.storeId))reasons.push('자료의 브랜드·지점 범위가 일치하지 않습니다.');
 if(!s||!Number.isSafeInteger(s.version)||s.version<1||s.status!=='confirmed'||s.category!=='market'||!['manual','upload','research'].includes(s.origin))reasons.push('확정된 시장·경쟁 자료만 가져올 수 있습니다.');
 if(s?.origin==='research'){
  const access=Array.isArray(r?.report?.access)?r.report.access.filter(a=>a&&typeof a==='object'&&a.sourceId===s.id):[];
  if(!r||r.id!==s.researchId||r.brandId!==c.brandId||r.storeId!==s.storeId||r.status!=='completed'||!Number.isFinite(Date.parse(r.report?.completedAt??''))||Date.parse(r.report!.completedAt)>now||access.length!==1||!['browser','api','upload'].includes(access[0]?.method)||typeof access[0]?.tool!=='string'||!access[0].tool.trim()||typeof access[0]?.scope!=='string'||!access[0].scope.trim())reasons.push('완료된 조사와 원문 접근 근거를 확인하세요.');
 }
 try{if(s)input=parseSignalInput({title:signalSourceText(s.title,200),sourceUrl:signalSourceText(s.url,2000),observedAt:s.observedAt,expiresAt,sourceType:'market',summary:signalSourceText(s.content,4000),sampleSize:null});else throw Error('missing');if(signalEvidence(input,now).status!=='usable')reasons.push('신호의 유효기한이 지났습니다.')}catch{reasons.push('출처 URL·관측 시각·내용 길이·민감정보를 검토하세요.');}
 return {status:reasons.length?'held':'ready',input:reasons.length?null:input,reasons};
}
export function signalSourceBasis(s:ArchiveSource,r:BrandResearch|null){return {id:s.id,version:s.version,brandId:s.brandId,storeId:s.storeId??null,title:s.title,category:s.category,origin:s.origin,status:s.status,url:s.url,content:s.content,scope:s.scope,observedAt:s.observedAt,researchId:s.researchId??null,research:s.origin==='research'?{id:r?.id??null,brandId:r?.brandId??null,storeId:r?.storeId??null,status:r?.status??null,completedAt:r?.report?.completedAt??null,access:Array.isArray(r?.report?.access)?r.report.access.filter(a=>a&&typeof a==='object'&&a.sourceId===s.id):[]}:null}}

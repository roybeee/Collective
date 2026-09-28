import {captionIssues,type FactRef} from './execution';
import {checkCompliance} from './graders/compliance';
import type {BrandFact} from './brand-facts';
export const metaCreativeFields={title:'소재안 이름',hook:'첫 문장',body:'본문 카피',cta:'행동 유도',script:'영상 대본·장면 구성',rightsEvidence:'파일·음원·출연자 사용권 확인 근거',reviewNote:'문구·랜딩 검토 메모'} as const;
export type MetaCreativeInput=Record<keyof typeof metaCreativeFields,string>&{creativeId:string;experimentKind:'store'|'viral';experimentId:string;rightsConfirmed:boolean;landingConfirmed:boolean};
export type MetaCreativeReview={id:string;campaignId:string;brandId:string;campaignVersion:number;planVersion:number;version:number;input:MetaCreativeInput;status:'draft'|'reviewed';factRefs:FactRef[];creativeVersion:number|null;pngHash:string|null;experimentVersion:number|null;reviewedAt:string|null;reviewedBy:string|null;updatedAt:string;updatedBy:string};
export const emptyMetaCreative=():MetaCreativeInput=>({title:'',hook:'',body:'',cta:'',script:'',rightsEvidence:'',reviewNote:'',creativeId:'',experimentKind:'store',experimentId:'',rightsConfirmed:false,landingConfirmed:false});
export class MetaCreativeError extends Error {}
// Existing copy-pack experiment arms contain these labels. Reuse their text; do not generate claims.
export function copyFromMetaExperiment(treatment:string){
 const take=(label:string)=>treatment.match(new RegExp('(?:^|\\n)'+label+':\\s*([\\s\\S]*?)(?=\\n(?:훅|본문|CTA|확인 필요):|$)'))?.[1].trim()??'';
 return {hook:take('훅'),body:take('본문')||treatment,cta:take('CTA')};
}
export function parseMetaCreative(v:unknown):MetaCreativeInput{
 if(!v||typeof v!=='object'||Array.isArray(v))throw new MetaCreativeError('소재안을 입력하세요.');const raw=v as Record<string,unknown>,out=emptyMetaCreative();
 for(const key of Object.keys(metaCreativeFields) as (keyof typeof metaCreativeFields)[]){if(typeof raw[key]!=='string'||raw[key].length>(key==='script'?6000:2000))throw new MetaCreativeError(metaCreativeFields[key]+' 입력 길이를 확인하세요.');out[key]=raw[key].trim()}
 for(const key of ['creativeId','experimentId'] as const){if(typeof raw[key]!=='string'||raw[key].length>100)throw new MetaCreativeError('소재 또는 실험 선택을 확인하세요.');out[key]=raw[key]}
 if(raw.experimentKind!=='store'&&raw.experimentKind!=='viral')throw new MetaCreativeError('실험 종류를 확인하세요.');out.experimentKind=raw.experimentKind;
 for(const key of ['rightsConfirmed','landingConfirmed'] as const){if(typeof raw[key]!=='boolean')throw new MetaCreativeError('검토 여부를 확인하세요.');out[key]=raw[key]}
 return out;
}
export function metaCopyReview(input:MetaCreativeInput,facts:{confirmed:BrandFact[];prohibited:BrandFact[];candidate:BrandFact[]}){
 const text=[input.hook,input.body,input.cta,input.script].join('\n'),compliance=checkCompliance(text,{facts}),issues=captionIssues(text,facts);
 const amounts=(s:string)=>s.match(/\d[\d,]*(?:\.\d+)?\s*(?:만원|천원|원|%)/g)??[];
 const key=(s:string)=>{const clean=s.replace(/\s|,/g,''),n=Number(clean.replace(/만원|천원|원|%/,''));return clean.endsWith('%')?'percent:'+n:'krw:'+n*(clean.endsWith('만원')?10000:clean.endsWith('천원')?1000:1)};
 const known=new Set(facts.confirmed.flatMap(f=>amounts(f.value).map(key)));
 for(const amount of amounts(text))if(!known.has(key(amount)))issues.push('확정 사실에서 확인되지 않은 가격·할인율: '+amount);
 if(/후기|리뷰|평점|별점|체험담/.test(text)&&!facts.confirmed.some(f=>/후기|리뷰|평점|별점|체험담/.test(f.key)))issues.push('후기·평점의 실제 수집 근거가 없습니다.');
 issues.push(...compliance.issues.filter(x=>x.severity==='block').map(x=>x.title));
 return {issues:[...new Set(issues)],warnings:compliance.issues.filter(x=>x.severity==='warn').map(x=>x.title),notice:compliance.notice};
}

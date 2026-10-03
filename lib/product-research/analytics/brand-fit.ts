// 브랜드 적합성 힌트(순수·결정형). 계획 ⑧ 4점 조건: 브랜드 아카이브 사실과 대조한 적합성 메모.
// 방법: 소유자 브랜드마다 확정 사실(brand_fact: key·value)에 상품 말(키워드 묶음·카테고리 이름·상품 이름 낱말)이 나오는지 센다(낱말 겹침).
// 점수 = 겹친 상품 말 수 / 상품 말 수 × 100(가장 많이 겹친 브랜드 하나). 사실이 하나도 없으면 null. 겹침이 0이면 0(맞지 않는다는 뜻이 아니라 근거가 없다는 뜻).
// 이 힌트는 사람 판정(brand_fit 하위 점수)을 자동으로 채우지 않는다. 메모는 근거 사실 ID를 인용한다.
import type {BrandFitHint} from '../types';
import {normalizeKeyword} from './normalize';

export type BrandLite={id:string;name:string};
export type BrandFactLite={id:string;brandId:string;key:string;value:string};
export type BrandFitInput={brands:readonly BrandLite[];facts:readonly BrandFactLite[];productName:string;categoryLabel:string|null;keywords:readonly string[]};
const STOP=new Set(['상온','냉장','냉동','식품','제품','상품','세트','선물','무료배송','정품','국내산','대용량','소용량']);
const compact=(s:string)=>String(s??'').normalize('NFC').toLowerCase().replace(/[\s·,()[\]{}<>'"/|-]+/g,'');
// 상품 말: 키워드 정규형, 카테고리 이름 조각, 상품 이름 낱말(숫자·단위 낱말 제외). 두 글자 이상만.
export function productTerms(i:Pick<BrandFitInput,'productName'|'categoryLabel'|'keywords'>):string[]{
 const out=new Set<string>();
 for(const k of i.keywords){const n=normalizeKeyword(k);if([...n].length>=2)out.add(n)}
 for(const part of String(i.categoryLabel??'').split(/[·()\s,/]+/))if([...part].length>=2&&!STOP.has(part))out.add(part.toLowerCase());
 for(const w of String(i.productName??'').normalize('NFC').split(/[\s[\]()【】]+/)){const t=w.replace(/[^0-9a-zA-Z가-힣]/g,'').toLowerCase();if([...t].length>=2&&!/\d/.test(t)&&!STOP.has(t))out.add(t)}
 return [...out].sort();
}
const MEMO_CAP=5;
export function brandFitHint(i:BrandFitInput):BrandFitHint{
 const terms=productTerms(i);
 if(!i.facts.length)return {score:null,memo:'브랜드 아카이브에 확정 사실이 없어 적합성 힌트를 만들지 않았습니다. 대표·MD 판정이 필요합니다.',factIds:[]};
 if(!terms.length)return {score:null,memo:'상품 키워드·카테고리 말이 없어 브랜드 사실과 대조하지 않았습니다.',factIds:[]};
 let best:{brand:BrandLite;matched:string[];facts:string[];total:number}|null=null;
 for(const brand of [...i.brands].sort((a,b)=>a.id<b.id?-1:1)){
  const facts=i.facts.filter(f=>f.brandId===brand.id).sort((a,b)=>a.id<b.id?-1:1);if(!facts.length)continue;
  const matched=new Set<string>(),hit=new Set<string>();
  for(const f of facts){const text=compact(`${f.key} ${f.value}`);for(const t of terms)if(text.includes(compact(t))){matched.add(t);hit.add(f.id)}}
  const cur={brand,matched:[...matched].sort(),facts:[...hit].sort(),total:facts.length};
  if(!best||cur.matched.length>best.matched.length)best=cur;
 }
 if(!best)return {score:null,memo:'소유자 브랜드의 확정 사실이 없어 적합성 힌트를 만들지 않았습니다. 대표·MD 판정이 필요합니다.',factIds:[]};
 const name=String(best.brand.name??'').normalize('NFC').replace(/\s+/g,' ').trim().slice(0,40)||best.brand.id;
 const score=Math.round(best.matched.length/terms.length*100);
 const memo=best.matched.length
  ?`브랜드 '${name}' 확정 사실 ${best.total}개 중 ${best.facts.length}개가 상품 말(${best.matched.slice(0,MEMO_CAP).join('·')})과 겹칩니다(근거 사실 ${best.facts.slice(0,MEMO_CAP).join(', ')}). 낱말 겹침 힌트이며 대표·MD 판정을 대신하지 않습니다.`
  :`브랜드 '${name}' 확정 사실 ${best.total}개에 상품 말(${terms.slice(0,MEMO_CAP).join('·')})이 나오지 않습니다. 맞지 않는다는 뜻이 아니라 근거가 없다는 뜻이며 대표·MD 판정이 필요합니다.`;
 return {score,memo,factIds:best.facts.slice(0,MEMO_CAP)};
}

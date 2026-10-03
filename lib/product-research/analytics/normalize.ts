// 키워드 정규화·묶음(순수). docs/PRODUCT-RESEARCH-PLAN.ko.md 4절 [정규화].
// 비교용 형태만 만든다. 화면에 보이는 이름은 원문을 그대로 둔다(정규화 결과는 사람이 읽을 이름이 아니다).
import {CATEGORIES} from '../categories';
import type {CategoryId,KeywordGroup} from '../types';
import {shortId} from './hash';

// 흔한 표기 변형. 공백·문장부호를 지운 뒤 적용한다. 새 변형은 여기만 고친다(정답 표본으로 확인 후).
export const KEYWORD_VARIANTS:readonly (readonly [string,string])[]=[
 ['쏘스','소스'],['떡뽁이','떡볶이'],['떡복이','떡볶이'],['쨈','잼'],['케챱','케첩'],['케찹','케첩'],['쥬스','주스'],['초콜렛','초콜릿'],['쵸코','초코'],['떡볶기','떡볶이'],
];
// 용량·수량 표기. 같은 수요를 뜻하는 키워드가 '마라소스 1kg'·'마라소스 500g'처럼 갈라지지 않게 지운다(상품 매칭은 match.ts가 따로 읽는다).
const UNIT_NOISE=/\d+(?:[.,]\d+)?\s*(?:kg|mg|ml|g|l|리터|그램|키로|킬로|개입|개|입|팩|봉지|봉|병|캔|박스|box|ea|매|포|인분|구)(?![a-z])/g;
// 'x 12개'처럼 곱하기 뒤에 수량 단위가 붙는 표기를 한 번에 지운다(단위를 먼저 지우면 'x'만 남는다).
const MULTI_NOISE=/(?:[x×*]\s*\d+\s*(?:개입|개|입|팩|봉지|봉|병|캔|ea|매|포|구)?(?![a-z0-9]))|(?:\d+\s*\+\s*\d+)/g;

export function normalizeKeyword(text:string):string{
 let s=String(text??'').normalize('NFC').toLowerCase();
 s=s.replace(MULTI_NOISE,' ').replace(UNIT_NOISE,' ');
 s=s.replace(/[^0-9a-z가-힣]+/g,'');
 for(const [from,to] of KEYWORD_VARIANTS)if(from)s=s.split(from).join(to);
 return s;
}

// 문자 바이그램 다이스 계수(0~1). 한 글자 문자열은 글자 일치로 본다.
export function bigramDice(a:string,b:string):number{
 if(a===b)return a?1:0;if(!a||!b)return 0;
 if(a.length<2||b.length<2)return a.includes(b)||b.includes(a)?Math.min(a.length,b.length)/Math.max(a.length,b.length):0;
 const grams=(s:string)=>{const m=new Map<string,number>();for(let i=0;i<s.length-1;i++){const g=s.slice(i,i+2);m.set(g,(m.get(g)??0)+1)}return m};
 const A=grams(a),B=grams(b);let both=0;
 for(const [g,n] of A)both+=Math.min(n,B.get(g)??0);
 return 2*both/(a.length-1+b.length-1);
}

// 한쪽이 다른 쪽을 품고 글자 수 비율이 0.8 이상이면 같은 수요로 본다('마라소스'·'마라소스맛'). 0.8 미만('마라소스'·'마라소스추천')은 의도가 달라질 수 있어 나눈다.
export const CONTAIN_RATIO=0.8;
export function sameDemand(a:string,b:string):boolean{
 if(!a||!b)return false;if(a===b)return true;
 const [s,l]=a.length<=b.length?[a,b]:[b,a];
 return l.includes(s)&&s.length/l.length>=CONTAIN_RATIO;
}

// 씨앗 키워드로 카테고리를 고른다. 가장 긴 씨앗이 이긴다('김부각'은 과자, '김치'는 냉장). 한 글자 씨앗('김'·'죽')은 낱말 전체가 같을 때만 쓴다('튀김'이 건조식품이 되지 않게).
// 맞는 씨앗이 없으면 null(미확인)이다. 추측해서 채우지 않는다.
export function seedCategoryOf(text:string):CategoryId|null{
 const n=normalizeKeyword(text),tokens=new Set(String(text??'').normalize('NFC').toLowerCase().split(/[^0-9a-z가-힣]+/).filter(Boolean));
 let best:{id:CategoryId;len:number}|null=null;
 for(const c of CATEGORIES)for(const seed of c.seedKeywords){
  const s=normalizeKeyword(seed);if(!s)continue;
  const hit=s.length>=2?n.includes(s):(n===s||tokens.has(s));
  if(hit&&(!best||s.length>best.len))best={id:c.id,len:s.length};
 }
 return best?.id??null;
}

export type KeywordCluster={id:string;label:string;normalized:string;keywords:string[];categoryId:CategoryId|null};

// 키워드 묶음. 같은 정규형이거나 sameDemand면 한 묶음(연결 요소)이다. 입력 순서와 무관하게 같은 결과를 낸다.
export function groupKeywords(keywords:readonly string[]):KeywordCluster[]{
 const originals=[...new Set(keywords.map(k=>String(k??'').normalize('NFC').trim()).filter(Boolean))].sort();
 const items=originals.map(k=>({k,n:normalizeKeyword(k)})).filter(x=>x.n);
 const parent=items.map((_,i)=>i),find=(i:number):number=>parent[i]===i?i:(parent[i]=find(parent[i]));
 for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++)if(sameDemand(items[i].n,items[j].n)){const a=find(i),b=find(j);if(a!==b)parent[Math.max(a,b)]=Math.min(a,b)}
 const groups=new Map<number,typeof items>();
 items.forEach((x,i)=>{const r=find(i);groups.set(r,[...(groups.get(r)??[]),x])});
 const out:KeywordCluster[]=[];
 for(const members of groups.values()){
  // 대표 이름: 정규형이 가장 짧은 원문(핵심 수요어). 같으면 정규형·원문 사전순.
  const head=[...members].sort((a,b)=>a.n.length-b.n.length||(a.n<b.n?-1:a.n>b.n?1:0)||(a.k<b.k?-1:1))[0];
  const cats=members.map(m=>seedCategoryOf(m.k)).filter((c):c is string=>!!c);
  // 묶음 안에서 카테고리가 갈리면 미확인으로 둔다.
  const categoryId=cats.length&&cats.every(c=>c===cats[0])?cats[0]:null;
  out.push({id:shortId('kg',head.n),label:head.k,normalized:head.n,keywords:members.map(m=>m.k).sort(),categoryId});
 }
 return out.sort((a,b)=>a.normalized<b.normalized?-1:a.normalized>b.normalized?1:0);
}

export function toKeywordGroup(c:KeywordCluster,at:string):KeywordGroup{return {id:c.id,label:c.label,keywords:[...c.keywords],categoryId:c.categoryId,createdAt:at,updatedAt:at}}
// 키워드가 어느 묶음에 드는지(정규형 기준). 없으면 null.
export function clusterOf(clusters:readonly KeywordCluster[],keyword:string):KeywordCluster|null{
 const n=normalizeKeyword(keyword);if(!n)return null;
 return clusters.find(c=>c.keywords.some(k=>normalizeKeyword(k)===n))??clusters.find(c=>sameDemand(c.normalized,n))??null;
}

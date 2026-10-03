// 상품 동일성 매칭(순수). 바코드가 있으면 바코드가 정본, 없으면 브랜드 + 정규화 상품명 + 용량으로 신뢰도를 낸다.
// 신뢰도 ≥0.95만 자동으로 묶고, 0.8~0.95는 사람 확인 대기, 그 밑은 따로 둔다(ResearchProduct.match 주석과 같은 기준).
import {categorySpec} from '../categories';
import type {CategoryId,RegulatoryClass,ResearchProduct,Subject,Temperature} from '../types';
import {shortId} from './hash';
import {bigramDice,normalizeKeyword,seedCategoryOf,type KeywordCluster} from './normalize';

export type ListingSubject=Extract<Subject,{type:'listing'}>;
// 수집기가 바코드(GTIN)를 얻은 경우에만 barcode를 채운다. 없으면 null.
export type ListingInput=ListingSubject&{barcode?:string|null};
export const AUTO_MERGE=0.95,NEEDS_CONFIRM=0.8;
export type MatchDecision='merge'|'confirm'|'separate';
export const decide=(confidence:number):MatchDecision=>confidence>=AUTO_MERGE?'merge':confidence>=NEEDS_CONFIRM?'confirm':'separate';

// 판매 문구라 상품 동일성과 무관한 말. 정답 표본에서 오탐이 나오면 여기만 고친다.
export const TITLE_NOISE=['무료배송','당일발송','당일출고','빠른배송','로켓배송','최저가','특가','대용량','행사','증정','공식','본사','단독','신상','인기','추천','베스트','할인','세일','기획','한정','정품','택배','묶음'];

export type SizeToken={amount:number|null;unit:'g'|'ml'|null;count:number;countStated:boolean};
// 용량·수량 읽기. '1kg'→1000g, '1.5L'→1500ml, '10개입'·'x10'→수량 10. 용량이 둘 이상이면 첫 값(대표 용량)을 쓴다.
export function parseSize(title:string):SizeToken{
 const s=String(title??'').normalize('NFC').toLowerCase();
 let amount:number|null=null,unit:SizeToken['unit']=null;
 const m=/(\d+(?:\.\d+)?)\s*(kg|킬로|키로|mg|ml|g|그램|l|리터)(?![a-z])/.exec(s);
 if(m){const v=Number(m[1]),u=m[2];
  if(u==='kg'||u==='킬로'||u==='키로'){amount=v*1000;unit='g'}else if(u==='mg'){amount=v/1000;unit='g'}else if(u==='g'||u==='그램'){amount=v;unit='g'}else if(u==='l'||u==='리터'){amount=v*1000;unit='ml'}else{amount=v;unit='ml'}}
 const x=/[x×*]\s*(\d+)(?![a-z0-9])/.exec(s),c=/(\d+)\s*(개입|개|입|팩|봉지|봉|병|캔|ea|매|포|구)(?![a-z])/.exec(s);
 const count=x?Number(x[1]):c?Number(c[1]):1;
 return {amount,unit,count,countStated:!!(x||c)};
}
// 용량 일치: 'agree'·'unknown'·'conflict'. 용량은 2% 안이면 같다(표기 반올림). 수량은 둘 다 적혀 있을 때만 다르면 충돌이다.
export function sizeAgreement(a:SizeToken,b:SizeToken):'agree'|'unknown'|'conflict'{
 if(a.countStated&&b.countStated&&a.count!==b.count)return 'conflict';
 if(a.amount!==null&&b.amount!==null){if(a.unit!==b.unit||Math.abs(a.amount-b.amount)/Math.max(a.amount,b.amount)>0.02)return 'conflict'}
 else return 'unknown';
 if(a.countStated!==b.countStated&&(a.countStated?a.count:b.count)!==1)return 'unknown';
 return 'agree';
}

const brandFromTitle=(title:string)=>{const m=/^\s*[[(【〔]([^\])】〕]{1,20})[\])】〕]/.exec(String(title??'').normalize('NFC'));return m?m[1].trim():null};
export const listingBrand=(l:Pick<ListingInput,'brand'|'title'>)=>l.brand?.trim()||brandFromTitle(l.title);
// 상품명 핵심: 괄호 기호·브랜드·판매 문구·용량을 지운 정규형.
export function nameCore(title:string,brands:readonly (string|null)[]=[]):string{
 // 긴 브랜드부터 지운다('칠갑농산'을 '칠갑'보다 먼저 지워야 '농산'이 남지 않는다).
 const bs=[...new Set(brands.filter((b):b is string=>!!b&&!!b.trim()))].sort((a,b)=>b.length-a.length);
 let s=String(title??'').normalize('NFC').toLowerCase().replace(/[[\](){}【】〔〕<>]/g,' ');
 for(const b of bs)s=s.split(b.normalize('NFC').toLowerCase().trim()).join(' ');
 for(const w of TITLE_NOISE)s=s.split(w).join(' ');
 let n=normalizeKeyword(s);
 for(const b of bs){const nb=normalizeKeyword(b);if(nb)n=n.split(nb).join('')}
 return n;
}
const digits=(v:string|null|undefined)=>v?String(v).replace(/\D/g,''):'';

export type PairScore={a:string;b:string;confidence:number;method:'barcode'|'brand_name_size';decision:MatchDecision;detail:{brand:'agree'|'unknown'|'conflict';size:'agree'|'unknown'|'conflict';name:number}};
export const listingKey=(l:Pick<ListingInput,'sourceId'|'externalId'>)=>`${l.sourceId}:${l.externalId}`;
// 두 목록의 동일 상품 신뢰도. 브랜드·용량이 확실히 다르면 이름이 같아도 다른 상품이다(같은 브랜드 500g·1kg은 다른 SKU).
export function scorePair(a:ListingInput,b:ListingInput):PairScore{
 const ka=listingKey(a),kb=listingKey(b),ba=digits(a.barcode),bb=digits(b.barcode);
 if(ba.length>=8&&bb.length>=8){const same=ba===bb;return {a:ka,b:kb,confidence:same?1:0,method:'barcode',decision:same?'merge':'separate',detail:{brand:'unknown',size:'unknown',name:same?1:0}}}
 const brA=listingBrand(a),brB=listingBrand(b),nA=brA?normalizeKeyword(brA):'',nB=brB?normalizeKeyword(brB):'';
 let brand:PairScore['detail']['brand']='unknown';
 // 한쪽 브랜드가 다른 쪽 제목에 그대로 있으면 제조사·하위 브랜드 관계로 본다('일동후디스 하이뮨 …'의 브랜드 '하이뮨').
 if(nA&&nB)brand=nA===nB||nA.includes(nB)||nB.includes(nA)||normalizeKeyword(b.title).includes(nA)||normalizeKeyword(a.title).includes(nB)?'agree':'conflict';
 else if(nA||nB){const known=nA||nB,other=normalizeKeyword(nA?b.title:a.title);brand=other.includes(known)?'agree':'unknown'}
 const brands=[brA,brB],size=sizeAgreement(parseSize(a.title),parseSize(b.title)),name=bigramDice(nameCore(a.title,brands),nameCore(b.title,brands));
 // 확인되지 않은 브랜드·용량 하나마다 0.93을 곱한다: 이름이 같아도 자동 병합선(0.95) 아래로 내려 사람 확인을 받게 한다.
 let confidence=name*(brand==='unknown'?0.93:1)*(size==='unknown'?0.93:1);
 if(brand==='conflict')confidence=Math.min(confidence,0.5);
 if(size==='conflict')confidence=Math.min(confidence,0.6);
 confidence=Math.round(confidence*1000)/1000;
 return {a:ka,b:kb,confidence,method:'brand_name_size',decision:decide(confidence),detail:{brand,size,name:Math.round(name*1000)/1000}};
}

export type Classification={categoryId:CategoryId|null;temperature:Temperature;regulatory:RegulatoryClass;regulatorySure:boolean;reasons:string[]};
const HFF_HINT=/건강기능식품|건기식|프로바이오틱스|유산균|홍삼|오메가3|루테인|밀크씨슬|밀크시슬/;
// 카테고리·보관 온도·규제 분류. 제목의 '냉동'·'냉장'·'아이스' 표기가 카테고리 기본 온도보다 우선한다. 모르면 unknown·regulatorySure=false.
export function classifyListing(title:string,categoryPath?:string|null,clusters?:readonly KeywordCluster[]):Classification{
 const reasons:string[]=[],t=String(title??'').normalize('NFC').toLowerCase(),n=normalizeKeyword(t);
 let categoryId=seedCategoryOf(t);
 if(categoryId)reasons.push('제목의 카테고리 씨앗 키워드');
 if(!categoryId&&categoryPath){categoryId=seedCategoryOf(categoryPath);if(categoryId)reasons.push('플랫폼 카테고리 경로')}
 if(!categoryId&&clusters){const hit=clusters.filter(c=>c.categoryId&&c.keywords.some(k=>{const nk=normalizeKeyword(k);return nk.length>=2&&n.includes(nk)})).sort((a,b)=>b.normalized.length-a.normalized.length)[0];if(hit){categoryId=hit.categoryId;reasons.push(`키워드 묶음 '${hit.label}'`)}}
 const spec=categorySpec(categoryId);
 let regulatory:RegulatoryClass=spec?.regulatory??'general',regulatorySure=!!spec;
 if(HFF_HINT.test(t)){regulatory='health_functional_food';regulatorySure=true;reasons.push('건강기능식품 표기')}
 let temperature:Temperature=spec?.temperature??'unknown';
 if(/냉동|아이스크림|frozen/.test(t)){temperature='frozen';reasons.push("제목의 '냉동' 표기")}
 else if(/냉장|아이스박스|아이스팩|chilled/.test(t)||(/아이스/.test(t)&&!/아이스\s*(티|커피|아메리카노|초코)/.test(t))){temperature='chilled';reasons.push("제목의 '냉장·아이스' 표기")}
 if(!spec)reasons.push('카테고리 미확인: 보관 온도·규제 분류를 확인하세요');
 return {categoryId,temperature,regulatory,regulatorySure,reasons};
}

export type MatchedProduct={key:string;name:string;brand:string|null;listings:ListingInput[];method:'barcode'|'brand_name_size';confidence:number;pendingWith:string[];classification:Classification;priceBand:{min:number|null;max:number|null}};
export type MatchResult={products:MatchedProduct[];pairs:PairScore[]};
// 목록 묶기. 자동 병합(≥0.95) 간선으로만 연결 요소를 만든다. 확인 대기(0.8~0.95) 간선은 pendingWith로만 남기고 묶지 않는다.
export function matchListings(listings:readonly ListingInput[],clusters?:readonly KeywordCluster[]):MatchResult{
 const uniq=[...new Map(listings.map(l=>[listingKey(l),l])).values()].sort((a,b)=>listingKey(a)<listingKey(b)?-1:1);
 const parent=uniq.map((_,i)=>i),find=(i:number):number=>parent[i]===i?i:(parent[i]=find(parent[i]));
 const pairs:PairScore[]=[],edgeMin=new Map<number,number>();
 for(let i=0;i<uniq.length;i++)for(let j=i+1;j<uniq.length;j++){
  const p=scorePair(uniq[i],uniq[j]);if(p.decision==='separate')continue;pairs.push(p);
  if(p.decision==='merge'){const a=find(i),b=find(j),lo=Math.min(a,b),hi=Math.max(a,b),m=Math.min(p.confidence,edgeMin.get(a)??1,edgeMin.get(b)??1);parent[hi]=lo;edgeMin.set(lo,m)}
 }
 const groups=new Map<number,number[]>();uniq.forEach((_,i)=>{const r=find(i);groups.set(r,[...(groups.get(r)??[]),i])});
 const keyOf=new Map<number,string>();
 for(const [root,idx] of groups)keyOf.set(root,shortId('prp',idx.map(i=>listingKey(uniq[i])).sort()));
 const products:MatchedProduct[]=[];
 for(const [root,idx] of groups){
  const ls=idx.map(i=>uniq[i]),head=[...ls].sort((a,b)=>a.title.length-b.title.length||(a.title<b.title?-1:1))[0];
  const pending=new Set<string>();
  for(const p of pairs)if(p.decision==='confirm'){const ia=uniq.findIndex(l=>listingKey(l)===p.a),ib=uniq.findIndex(l=>listingKey(l)===p.b),ra=find(ia),rb=find(ib);if(ra!==rb){if(ra===root)pending.add(keyOf.get(rb)!);if(rb===root)pending.add(keyOf.get(ra)!)}}
  // 묶인 목록들의 분류가 갈리면 더 보수적인 쪽(냉동>냉장>상온, 미확인 우선)을 쓴다.
  const cls=ls.map(l=>classifyListing(l.title,l.categoryPath,clusters)),order:Temperature[]=['unknown','frozen','chilled','ambient'];
  const classification=[...cls].sort((a,b)=>order.indexOf(a.temperature)-order.indexOf(b.temperature)||(a.regulatorySure===b.regulatorySure?0:a.regulatorySure?1:-1))[0];
  const hff=cls.find(c=>c.regulatory==='health_functional_food');
  const prices=ls.map(l=>l.price).filter((p):p is number=>typeof p==='number'&&p>0);
  const barcode=ls.length>1&&ls.every(l=>digits(l.barcode).length>=8&&digits(l.barcode)===digits(ls[0].barcode));
  products.push({key:keyOf.get(root)!,name:cleanTitle(head.title,listingBrand(head)),brand:ls.map(listingBrand).find(Boolean)??null,listings:ls,method:barcode?'barcode':'brand_name_size',confidence:idx.length>1?(edgeMin.get(root)??1):1,pendingWith:[...pending].sort(),
   classification:hff?{...classification,regulatory:'health_functional_food',regulatorySure:true}:classification,priceBand:{min:prices.length?Math.min(...prices):null,max:prices.length?Math.max(...prices):null}});
 }
 return {products:products.sort((a,b)=>a.key<b.key?-1:1),pairs:pairs.sort((a,b)=>b.confidence-a.confidence||(a.a+a.b<b.a+b.b?-1:1))};
}
export function cleanTitle(title:string,brand?:string|null):string{
 let s=String(title??'').normalize('NFC').replace(/^\s*[[(【〔][^\])】〕]{1,20}[\])】〕]\s*/,'');
 for(const w of TITLE_NOISE)s=s.split(w).join(' ');
 s=s.replace(/\s+/g,' ').trim();
 return brand&&!s.includes(brand)?`${brand} ${s}`:s;
}
export function toResearchProduct(m:MatchedProduct,at:string,keywordGroupIds:readonly string[]=[]):ResearchProduct{
 return {id:m.key,name:m.name,brand:m.brand,categoryId:m.classification.categoryId,temperature:m.classification.temperature,regulatory:m.classification.regulatory,priceBand:m.priceBand,
  listings:m.listings.map(l=>({sourceId:l.sourceId,externalId:l.externalId,title:l.title,url:l.url})),keywordGroupIds:[...keywordGroupIds],match:{method:m.method,confidence:m.confidence,confirmedBy:null},createdAt:at,updatedAt:at};
}

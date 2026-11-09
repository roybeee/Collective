// G5 GEO 자동 추적 — 질문 세트(순수 모듈). 브랜드마다 추적할 질문(record kind geo_question)과 시작 질문 생성기를 둔다.
// 시작 질문은 확정 사실(유효기한·범위를 통과한 brand_fact, lib/brand-facts.ts effectiveBrandFacts)과 브랜드 이름·업종에서만 만든다.
// 사실이 없으면 그 템플릿은 건너뛴다(지역·메뉴를 지어내지 않는다). 같은 입력이면 같은 질문이 같은 순서로 나온다.
import {scanText} from './pii-scan';
import {canonicalFactKey} from './fact-catalog';

export const GEO_ENGINES=['chatgpt','perplexity','gemini','google_ai_overview','naver'] as const;
export type GeoEngine=typeof GEO_ENGINES[number];
export const GEO_LOCALES=['ko','en','ja'] as const;
export type GeoLocale=typeof GEO_LOCALES[number];
export const GEO_INTENTS=['brand','category','local'] as const;
export type GeoIntent=typeof GEO_INTENTS[number];
export const GEO_INTENT_LABELS:Record<GeoIntent,string>={brand:'브랜드',category:'카테고리',local:'지역'};
export const GEO_LOCALE_LABELS:Record<GeoLocale,string>={ko:'한국어',en:'영어',ja:'일본어'};
export const GEO_QUESTION_LIMIT=30,GEO_STARTER_COUNT=10,GEO_QUESTION_MAX=200;
export const GEO_QUESTION_ID=/^gq-[a-z0-9-]{4,60}$/;

export type GeoQuestionInput={text:string;locale:GeoLocale;intent:GeoIntent;engines:GeoEngine[];active:boolean};
// basis: 시작 질문이 쓴 근거(사실 id 또는 'brand.name'·'brand.category'). 직접 쓴 질문은 빈 배열이다.
export type GeoQuestion=GeoQuestionInput&{id:string;brandId:string;version:number;origin:'starter'|'manual';basis:string[];createdAt:string;updatedAt:string;updatedBy:string};
export type GeoFact={id:string;key:string;value:string};
export type GeoStarterSource={brandName:string;category:string;facts:readonly GeoFact[]};
export type GeoStarter={text:string;intent:GeoIntent;basis:string[]};

export class GeoInputError extends Error{constructor(message:string){super(message);this.name='GeoInputError'}}
const fail=(message:string):never=>{throw new GeoInputError(message)};
const control=/[\u0000-\u001f\u007f]/;
export const normalizeQuestion=(text:string)=>text.normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();

export function parseGeoQuestionInput(value:unknown):GeoQuestionInput{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('질문 입력 객체가 필요합니다.');
 const b=value as Record<string,unknown>;
 if(typeof b.text!=='string'||!b.text.trim()||b.text.length>GEO_QUESTION_MAX||control.test(b.text))fail(`질문은 1~${GEO_QUESTION_MAX}자 한 줄입니다.`);
 const text=(b.text as string).replace(/\s+/g,' ').trim();
 if(scanText(text.normalize('NFKC')).length)fail('질문에 연락처·주소 같은 식별정보를 넣을 수 없습니다.');
 if(!GEO_LOCALES.includes(b.locale as GeoLocale))fail('언어는 한국어·영어·일본어 중 하나입니다.');
 if(!GEO_INTENTS.includes(b.intent as GeoIntent))fail('질문 유형(브랜드·카테고리·지역)을 고르세요.');
 if(!Array.isArray(b.engines)||!b.engines.length||b.engines.some(e=>!GEO_ENGINES.includes(e as GeoEngine)))fail('측정할 AI 답변 서비스를 하나 이상 고르세요.');
 if(typeof b.active!=='boolean')fail('추적 여부(켜기/끄기)를 지정하세요.');
 const engines=GEO_ENGINES.filter(e=>(b.engines as unknown[]).includes(e));
 return {text,locale:b.locale as GeoLocale,intent:b.intent as GeoIntent,engines,active:b.active as boolean};
}

// 확정 사실에서 항목 값을 찾는다. 자유 key(업종·지역)는 정규화한 이름으로 비교한다.
const CATEGORY_KEYS=['category','업종','카테고리','분야'].map(canonicalFactKey),AREA_KEYS=['area','지역','상권','동네'].map(canonicalFactKey);
const factOf=(facts:readonly GeoFact[],keys:readonly string[])=>facts.find(f=>keys.includes(canonicalFactKey(f.key))&&f.value.trim());
const clean=(v:string)=>v.normalize('NFKC').replace(/\s+/g,' ').trim();
// 주소 사실에서 가장 좁은 행정 구역 한 낱말(동·읍·면 → 구·군 → 시)을 고른다. 숫자가 든 낱말(번지·호)은 쓰지 않는다.
export function areaFromAddress(address:string):string{
 const tokens=clean(address).split(' ').filter(t=>t&&!/\d/.test(t)).map(t=>t.replace(/[(),]/g,''));
 const pick=(re:RegExp)=>tokens.filter(t=>re.test(t)&&t.length>=2).at(-1);
 const city=pick(/(특별시|광역시|특별자치시|시)$/);
 return pick(/(동|읍|면|가)$/)??pick(/(구|군)$/)??(city?city.replace(/(특별자치시|특별시|광역시)$/,''):'');
}
const menus=(value:string)=>clean(value).split(/[,·/|\n]/).map(x=>x.trim()).filter(x=>x&&x.length<=30).slice(0,2);

// 시작 질문 생성기. 템플릿 순서가 우선순위다. 근거가 없는 템플릿은 건너뛰고 중복(정규화 기준)은 한 번만 남긴다.
export function starterQuestions(src:GeoStarterSource,limit=GEO_STARTER_COUNT):GeoStarter[]{
 const brand=clean(src.brandName),facts=src.facts.filter(f=>typeof f.value==='string'&&f.value.trim());
 const categoryFact=factOf(facts,CATEGORY_KEYS),category=categoryFact?clean(categoryFact.value):clean(src.category);
 const categoryBasis=categoryFact?[categoryFact.id]:category?['brand.category']:[];
 const areaFact=factOf(facts,AREA_KEYS),addressFact=factOf(facts,['address']);
 const area=areaFact?clean(areaFact.value):addressFact?areaFromAddress(addressFact.value):'';
 const areaBasis=areaFact?[areaFact.id]:addressFact&&area?[addressFact.id]:[];
 const menuFact=factOf(facts,['signature_menu']),menuList=menuFact?menus(menuFact.value):[];
 const hoursFact=factOf(facts,['hours']),parkingFact=factOf(facts,['parking']);
 const b=brand?['brand.name']:[];
 const candidates:(GeoStarter|null)[]=[
  area&&category?{text:`${area} ${category} 추천`,intent:'local',basis:[...areaBasis,...categoryBasis]}:null,
  brand?{text:`${brand} 영업시간`,intent:'brand',basis:[...b,...(hoursFact?[hoursFact.id]:[])]}:null,
  ...menuList.map(m=>({text:`${m} 맛집`,intent:'category' as const,basis:[menuFact!.id]})),
  ...(area?menuList.map(m=>({text:`${area} ${m} 맛집`,intent:'local' as const,basis:[...areaBasis,menuFact!.id]})):[]),
  category?{text:`${category} 추천`,intent:'category',basis:categoryBasis}:null,
  brand&&addressFact?{text:`${brand} 위치`,intent:'brand',basis:[...b,addressFact.id]}:null,
  brand?{text:`${brand} 후기`,intent:'brand',basis:b}:null,
  brand&&menuFact?{text:`${brand} 대표 메뉴`,intent:'brand',basis:[...b,menuFact.id]}:null,
  area&&category?{text:`${area} ${category} 가볼 만한 곳`,intent:'local',basis:[...areaBasis,...categoryBasis]}:null,
  brand&&parkingFact?{text:`${brand} 주차`,intent:'brand',basis:[...b,parkingFact.id]}:null,
  category?{text:`${category} 인기 브랜드`,intent:'category',basis:categoryBasis}:null,
  brand&&category?{text:`${brand} ${category} 어때`,intent:'brand',basis:[...b,...categoryBasis]}:null,
 ];
 const seen=new Set<string>(),out:GeoStarter[]=[];
 for(const c of candidates){
  if(!c||c.text.length>GEO_QUESTION_MAX)continue;
  const key=normalizeQuestion(c.text);if(seen.has(key))continue;
  seen.add(key);out.push({...c,basis:[...new Set(c.basis)]});
  if(out.length>=limit)break;
 }
 return out;
}
// 이미 있는 질문을 뺀 시작 질문(화면 추천 목록). 서버는 저장 요청의 문장이 이 목록에 있을 때만 받는다(화면이 만든 문장을 시작 질문으로 꾸미지 않는다).
export function pendingStarters(src:GeoStarterSource,existing:readonly Pick<GeoQuestion,'text'>[]):GeoStarter[]{
 const have=new Set(existing.map(q=>normalizeQuestion(q.text)));
 return starterQuestions(src).filter(s=>!have.has(normalizeQuestion(s.text)));
}
// 측정 계획: 켜 둔 질문 × 그 질문이 고른 엔진.
export function measurementPairs(questions:readonly GeoQuestion[]):{question:GeoQuestion;engine:GeoEngine}[]{
 return questions.filter(q=>q.active).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).flatMap(question=>question.engines.map(engine=>({question,engine})));
}

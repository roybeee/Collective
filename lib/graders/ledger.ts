import {claimGuard} from '../campaign-policy';
import {verdict,outputObject,proseValues,briefPlanValues,type Grader,type EvalItem,type GradeContext} from './types';
import {isText,bodyOf,sentences,compact,excerpt,blocks} from './text';
import {mentions,usesTerm} from './negation';
import {outsideProhibition,withoutBannedLists} from './prohibition';

// 사실 원장 대조(fact_conflict)와 미확정 구체 값 단정(unconfirmed_value_assertion). 원장이 없으면 둘 다 not_applicable이다.
const factText=(v:unknown)=>typeof v==='string'?v:'';
const hitsVerdict=(hits:string[])=>hits.length?verdict('fail',[...new Set(hits)]):verdict('pass');
// 동 이름 길이에 상한을 둬 긴 한글 연속 입력에서도 선형 시간에 끝난다.
const ADDRESS=/[가-힣]{1,12}동\s?\d+(?:-\d+)?[^\n]{0,8}?[A-Z]동\s?\d+\s?호/g;
// 판매가가 아닌 금액(예산·비용·객단가·매출 목표 등)이 있는 문장은 가격으로 보지 않는다.
const NON_PRICE=/예산|비용|한도|객단가|매출|목표|광고비|제작비|촬영비|수수료|인건비|임대료|월세|보증금|원가|마진|이익|손익|투자|지원금|배송비|최소\s?주문|이상\s?주문|결제\s?금액|판매액|상금/;
const num=(s:string)=>Number(s.replace(/,/g,''));
export const amounts=(s:string)=>[...s.matchAll(/(\d{1,3}(?:,\d{3})+|\d{4,})\s?원|(\d+(?:\.\d+)?)\s?만\s?원/g)].map(m=>String(m[1]?num(m[1]):Math.round(num(m[2])*10000)));
const monthDay=(m:string,d:string)=>`${Number(m)}-${Number(d)}`;
export const dates=(s:string)=>[...s.matchAll(/(\d{1,2})월\s?(\d{1,2})일|\d{4}[-./](\d{1,2})[-./](\d{1,2})/g)].map(m=>m[1]?monthDay(m[1],m[2]):monthDay(m[3],m[4]));
const OPEN_DATE=/오픈(?:일)?\s?(?:은|는|:)?\s?\d{1,2}월\s?\d{1,2}일|\d{1,2}월\s?\d{1,2}일\s?(?:에\s?)?(?:오픈|개업|개점)|\d{4}[-.]\d{1,2}[-.]\d{1,2}\s?(?:오픈|개업|개점)/g;
const minutes=(s:string)=>[...s.matchAll(/(\d+)\s?분/g)].map(m=>String(Number(m[1])));
const counts=(s:string)=>[...s.matchAll(/(\d[\d,]*(?:\.\d+)?)\s?(만|천)?/g)].map(m=>String(Math.round(num(m[1])*(m[2]==='만'?10000:m[2]==='천'?1000:1))));
// 원장이 확정할 수 있는 구체 값. body: 본문 문장에서 찾은 값(정규화), ledger: 원장 값에서 찾은 값. 브리프 지시 위반(brief.ts)도 같은 추출을 쓴다.
type ValueKind={kind:string;key:RegExp;body:(s:string)=>string[];ledger:(v:string)=>string[]};
export const VALUE_KINDS:ValueKind[]=[
 {kind:'가격',key:/가격|판매가|price|메뉴/i,body:s=>NON_PRICE.test(s)?[]:amounts(s),ledger:amounts},
 {kind:'오픈일',key:/오픈|개점|개업|open/i,body:s=>[...s.matchAll(OPEN_DATE)].flatMap(m=>dates(m[0])),ledger:dates},
 {kind:'도보 시간',key:/도보|거리|접근/,body:s=>[...s.matchAll(/도보\s?\d+\s?분/g)].flatMap(m=>minutes(m[0])),ledger:minutes},
 {kind:'유동인구',key:/유동|상권/,body:s=>[...s.matchAll(/유동\s?인구[^\n.]{0,10}?\d[\d,]*(?:\.\d+)?\s?(?:만|천)?/g)].flatMap(m=>counts(m[0]).slice(-1)),ledger:counts},
];
// 예시·확인 필요·미확정 표시가 있는 문장은 단정이 아니다.
export const MARKED=/\[[^\]]*(?:확인|예시|실제|확정)[^\]]*\]|확인\s?필요|미확정|자료\s?필요|예시/;
export function confirmedFacts(ctx:GradeContext){
 return (ctx.facts?.confirmed||[]).map(f=>({key:factText(f.key),value:factText(f.value)})).filter(f=>f.value);
}
// 종류별 원장 확정값. 키가 맞아도 값에서 구체 값을 찾지 못하면 확정값이 없는 것으로 본다.
const ledgerValues=(kind:ValueKind,confirmed:{key:string;value:string}[])=>new Set(confirmed.filter(f=>kind.key.test(f.key)).flatMap(f=>kind.ledger(f.value)));
const bodySentences=(text:string)=>text.split('\n').flatMap(sentences);
type Check={hit?:string};

function addressChecks(text:string,confirmed:{key:string;value:string}[]):Check[]{
 const address=confirmed.find(f=>/주소|address/i.test(f.key));
 if(!address)return [];
 return [...text.matchAll(ADDRESS)].map(m=>compact(address.value).includes(compact(m[0]))?{}:{hit:`주소 불일치: ${m[0]}`});
}
function valueChecks(lines:string[],confirmed:{key:string;value:string}[]):Check[]{
 return VALUE_KINDS.flatMap(kind=>{
  const known=ledgerValues(kind,confirmed);
  if(!known.size)return [];
  return lines.filter(s=>!MARKED.test(s)).flatMap(s=>kind.body(s).map(v=>known.has(v)?{}:{hit:`${kind.kind} 불일치: ${excerpt(s)}`}));
 });
}
// 거절값은 문장에 나오면 대조 대상이고, 부정·배제 없이 쓰이면 fail이다.
// allowed: 금지·보류 맥락 밖 문장. 그 안의 언급은 대조는 하되(적용됨) 사용으로 세지 않는다.
function rejectedChecks(lines:string[],facts:NonNullable<GradeContext['facts']>,allowed:Set<string>):Check[]{
 const rejected=claimGuard({confirmed:facts.confirmed||[],prohibited:facts.prohibited||[]}).prohibited;
 return rejected.flatMap(t=>lines.filter(s=>mentions(s,t)).map(s=>allowed.has(s)&&usesTerm(s,t)?{hit:`거절 사실 사용: ${excerpt(s)}`}:{}));
}
// 원장에 있는 항목만 대조한다. 원장에 없는 항목은 세지 않고, 대조할 항목이 하나도 없으면 not_applicable(합격률 분모에서 제외).
export const factConflict:Grader={id:'fact_conflict',content:true,grade(item,ctx){
 if(!isText(item))return verdict('not_applicable');
 if(!ctx.facts)return verdict('not_applicable','원장 없음');
 const text=bodyOf(item),lines=bodySentences(text),confirmed=confirmedFacts(ctx);
 // 거절 사실은 금지·보류 맥락(제목·라벨·금지 표 칸·금지 리드 아래 인용 목록) 밖 문장만 본다. 그 안은 쓰지 않을 표현의 목록이다(R3 기준선 S6 실측).
 const allowed=new Set(outsideProhibition(blocks(withoutBannedLists(text))).filter(b=>!b.isLabel).flatMap(b=>sentences(b.line)));
 const checks=[...addressChecks(text,confirmed),...valueChecks(lines,confirmed),...rejectedChecks(lines,ctx.facts,allowed)];
 return checks.length?hitsVerdict(checks.flatMap(c=>c.hit?[c.hit]:[])):verdict('not_applicable','원장 항목을 다루지 않음');
}};

// 원장이 확정하지 않은 가격·오픈일·도보 시간·유동인구 수치를 [확인 필요]·[예시]·미확정 표시 없이 단정하면 fail(factPolicy).
export const unconfirmedValueAssertion:Grader={id:'unconfirmed_value_assertion',content:true,grade(item,ctx){
 if(!isText(item))return verdict('not_applicable');
 if(!ctx.facts)return verdict('not_applicable','원장 없음');
 const confirmed=confirmedFacts(ctx),open=VALUE_KINDS.filter(k=>!ledgerValues(k,confirmed).size);
 const found=bodySentences(bodyOf(item)).flatMap(s=>open.filter(k=>k.body(s).length).map(k=>({kind:k.kind,s})));
 if(!found.length)return verdict('not_applicable','미확정 항목의 구체 값 없음');
 return hitsVerdict(found.filter(x=>!MARKED.test(x.s)).map(x=>`미확정 ${x.kind} 단정: ${excerpt(x.s)}`));
}};

// 미확인 브랜드 소개(brand.brandIntro)를 '확인 사실' 구역에 적으면 fail(원장 구역 규칙, G3. docs/EVAL.ko.md 결정론 불가 유형의 v1.1 후보를 옮겼다).
// 확인 사실 구역: 가장 가까운 라벨(인라인 라벨 우선)이 확인·확정·검증된 사실(사항·정보)이고 미확인·확인 필요·후보·가정·가설·추정이 섞이지 않은 블록, 또는 첫 칸이 그런 라벨인 표 행.
// 구역 문장이 소개문과 공백·문장부호를 뺀 8자(한국어 두세 어절)를 글자 그대로 공유하고 그 조각이 확정 사실 값·브랜드 이름 안에 없으면 소개문을 사실로 옮긴 것이다.
// [확인 필요]·미확인 표시 문장은 면제한다. 소개문을 바꿔 쓴 문장, '소개문에 그렇게 적혀 있다'는 서술과 상품 사실의 구분은 판단하지 않는다(심사 대상).
// 대상: 역할 산출물, 회의 단계(출력 JSON의 사람이 읽는 값), 브리프(렌더본, 없으면 summary·제안 값). 소개문이 없거나 확인 사실 구역이 없으면 not_applicable.
const INTRO_WINDOW=8;
const FACT_ZONE=/(?:확인|확정|검증)(?:된|한)?\s?(?:사실|사항|정보)|^확정$|^사실(?:\s?근거)?$/,NOT_FACT=/미확인|미확정|확인\s?(?:필요|전|대기)|후보|가정|가설|추정|추론|요청/;
const UNVERIFIED=new RegExp(`${MARKED.source}|미확인|(?:검증|확인)\\s?전`);
const plainText=(s:string)=>s.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
const factLabel=(label:string)=>FACT_ZONE.test(label.trim())&&!NOT_FACT.test(label);
function factZoneSentences(text:string){
 return blocks(text).flatMap(b=>{
  if(b.isLabel)return [];
  const cells=b.line.trim().startsWith('|')?b.line.split('|').map(c=>c.trim()).filter(Boolean):[];
  // 표 행은 첫 칸이 라벨이다: 미확인·후보 행은 구역 밖, 확인 사실 행은 나머지 칸이 구역이다.
  if(cells.length>1&&NOT_FACT.test(cells[0]))return [];
  if(cells.length>1&&factLabel(cells[0]))return cells.slice(1);
  return factLabel(b.inline??b.label)?sentences(b.line):[];
 });
}
// 소개문의 8자 조각 가운데 확정 사실 값·브랜드 이름 안에 없는 것.
function introWindows(intro:string,allowed:string[]){
 const p=plainText(intro),allow=allowed.map(plainText).filter(Boolean),out=new Set<string>();
 for(let i=0;i+INTRO_WINDOW<=p.length;i++){const w=p.slice(i,i+INTRO_WINDOW);if(!allow.some(a=>a.includes(w)))out.add(w)}
 return out;
}
function copiesIntro(sentence:string,windows:Set<string>){
 const p=plainText(sentence);
 for(let i=0;i+INTRO_WINDOW<=p.length;i++)if(windows.has(p.slice(i,i+INTRO_WINDOW)))return true;
 return false;
}
function zoneText(item:EvalItem){
 if(item.kind==='role')return bodyOf(item);
 const x=outputObject(item);
 if(item.kind==='brief')return item.text??(x?briefPlanValues(x).join('\n'):'');
 return x?proseValues(x).join('\n'):bodyOf(item);
}
export const brandIntroAsFact:Grader={id:'brand_intro_as_fact',content:true,grade(item,ctx){
 if(!['role','meeting_step','brief'].includes(item.kind))return verdict('not_applicable');
 if(!ctx.brandIntro?.trim())return verdict('not_applicable','브랜드 소개 없음');
 const zone=factZoneSentences(zoneText(item));
 if(!zone.length)return verdict('not_applicable','확인 사실 구역 없음');
 const windows=introWindows(ctx.brandIntro,[...confirmedFacts(ctx).map(f=>f.value),ctx.brandName||'']);
 return hitsVerdict(zone.filter(s=>!UNVERIFIED.test(s)&&copiesIntro(s,windows)).map(s=>`소개문을 확인 사실로 씀: ${excerpt(s)}`));
}};

// 역할·회의 단계 호출의 입력 토큰 절대 상한. 제안값 32,000은 대표 결정 사항이며 설정으로 바꾼다(ctx.inputTokenCap).
export const INPUT_TOKEN_CAP=32000;
// 회의 단계(발언·합의·개선본·재검토) 상한. R3 기준선(2026-09-25) 실측 최대 52,268(운영 MAPDAL 회의 재검토: 개선본 전체와 후보 24,000자를 읽는다)의 약 1.2배다.
// 역할 최대 23,701은 32,000 안이라 역할 상한은 그대로 둔다(대표 위임 결정 2026-09-25, QUALITY-ROADMAP 승인 기록).
export const MEETING_INPUT_TOKEN_CAP=64000;
export const inputBudget:Grader={id:'input_budget',grade(item,ctx){
 const tokens=item.inputTokens;
 if(typeof tokens!=='number'||!Number.isFinite(tokens))return verdict('not_applicable','토큰 미확인');
 if(item.kind==='brief'||/^(?:brief|research)/.test(item.role||''))return verdict('not_applicable','브리프 초안·조사 호출(대상 여부 결정 전)');
 const cap=ctx.inputTokenCap??(item.meetingId?MEETING_INPUT_TOKEN_CAP:INPUT_TOKEN_CAP);
 return tokens>cap?verdict('fail',`${tokens} > ${cap}`):verdict('pass',`${tokens} (${Math.round(tokens/cap*100)}%)`);
}};

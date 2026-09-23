import {claimGuard} from '../campaign-policy';
import {verdict,type Grader,type GradeContext} from './types';
import {isText,bodyOf,sentences,NEGATION,compact,excerpt} from './text';

// 사실 원장 대조. 원장이 없거나 본문이 원장 항목을 하나도 다루지 않으면 not_applicable(합격률 분모에서 제외).
const factText=(v:unknown)=>typeof v==='string'?v:'';
// 동 이름 길이에 상한을 둬 긴 한글 연속 입력에서도 선형 시간에 끝난다.
const ADDRESS=/[가-힣]{1,12}동\s?\d+(?:-\d+)?[^\n]{0,8}?[A-Z]동\s?\d+\s?호/g;
// 미확정이면 단정하면 안 되는 구체 값. key는 이 값을 확정하는 원장 항목 이름이다.
const SPECIFIC_VALUES=[
 {kind:'가격',value:/\d{1,3}(?:,\d{3})+\s?원|\d+(?:\.\d+)?\s?만\s?원/,key:/가격|price|메뉴/i},
 {kind:'오픈일',value:/오픈(?:일)?\s?(?:은|는|:)?\s?\d{1,2}월\s?\d{1,2}일|\d{1,2}월\s?\d{1,2}일\s?(?:에\s?)?(?:오픈|개업|개점)|\d{4}[-.]\d{1,2}[-.]\d{1,2}\s?(?:오픈|개업|개점)/,key:/오픈|개점|개업|open/i},
 {kind:'도보 시간',value:/도보\s?\d+\s?분/,key:/도보|거리|접근/},
 {kind:'유동인구',value:/유동\s?인구[^\n.]{0,10}\d/,key:/유동|상권/},
];
// 예시·확인 필요·미확정 표시가 있는 문장은 단정이 아니다.
const MARKED=/\[[^\]]*(?:확인|예시|실제|확정)[^\]]*\]|확인\s?필요|미확정|자료\s?필요|예시/;
function confirmedFacts(ctx:GradeContext){
 return (ctx.facts?.confirmed||[]).map(f=>({key:factText(f.key),value:factText(f.value)})).filter(f=>f.value);
}
export const factConflict:Grader={id:'fact_conflict',content:true,grade(item,ctx){
 if(!isText(item))return verdict('not_applicable');
 if(!ctx.facts)return verdict('not_applicable','원장 없음');
 const text=bodyOf(item),confirmed=confirmedFacts(ctx),address=confirmed.find(f=>/주소|address/i.test(f.key));
 const addresses=[...text.matchAll(ADDRESS)].map(m=>m[0]);
 const rejected=claimGuard({confirmed:ctx.facts.confirmed||[],prohibited:ctx.facts.prohibited||[]}).prohibited;
 const lines=text.split('\n').flatMap(sentences);
 const values=lines.flatMap(s=>SPECIFIC_VALUES.filter(v=>v.value.test(s)).map(v=>({...v,s})));
 const rejectedUses=lines.filter(s=>!NEGATION.test(s)).flatMap(s=>rejected.filter(t=>compact(s).includes(compact(t))).map(t=>({t,s})));
 if(!addresses.length&&!values.length&&!rejectedUses.length&&!rejected.some(t=>compact(text).includes(compact(t))))return verdict('not_applicable','원장 항목을 다루지 않음');
 const hits=[
  ...(address?addresses.filter(a=>!compact(address.value).includes(compact(a))).map(a=>`주소 불일치: ${a}`):[]),
  ...rejectedUses.map(x=>`거절 사실 사용: ${excerpt(x.s)}`),
  ...values.filter(v=>!confirmed.some(f=>v.key.test(f.key))&&!MARKED.test(v.s)).map(v=>`미확정 ${v.kind} 단정: ${excerpt(v.s)}`),
 ];
 return hits.length?verdict('fail',[...new Set(hits)]):verdict('pass');
}};

// 역할·회의 단계 호출의 입력 토큰 절대 상한. 제안값 32,000은 대표 결정 사항이며 설정으로 바꾼다(ctx.inputTokenCap).
export const INPUT_TOKEN_CAP=32000;
export const inputBudget:Grader={id:'input_budget',grade(item,ctx){
 const tokens=item.inputTokens;
 if(typeof tokens!=='number'||!Number.isFinite(tokens))return verdict('not_applicable','토큰 미확인');
 if(item.kind==='brief'||/^(?:brief|research)/.test(item.role||''))return verdict('not_applicable','브리프 초안·조사 호출(대상 여부 결정 전)');
 const cap=ctx.inputTokenCap??INPUT_TOKEN_CAP;
 return tokens>cap?verdict('fail',`${tokens} > ${cap}`):verdict('pass',`${tokens} (${Math.round(tokens/cap*100)}%)`);
}};

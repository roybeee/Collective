import {parseBrief,briefFields,protectedFields,type BriefKey} from '../brief';
import {verdict,outputObject,outputText,briefPlanValues,type Grader,type GradeContext} from './types';
import {bodyOf,sentences,excerpt} from './text';
import {usesTerm} from './negation';
import {VALUE_KINDS,MARKED,amounts,dates,confirmedFacts} from './ledger';
import {prohibitedTerms} from './content';

// 브리프 초안 채점기(G3). kind 'brief'만 채점한다. brief_contract는 원 JSON이 있어야 하고, brief_instruction_violation은 JSON이 없으면 렌더본(text)을 본다.
const MAX_QUESTIONS=3,MAX_FACT_CANDIDATES=10;
const list=(v:unknown)=>Array.isArray(v)?v:[];
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);

// 필수 필드·형식: 앱 파서 parseBrief가 받아야 한다(summary·suggestions·questions·assumptions와 kpi·hypothesis·experiment·tracking·decision 제안).
// 앱이 조용히 버리는 형식 위반도 센다: 확인 질문 3개 초과, 허용 밖·중복 제안 키, 사실 후보 10개 초과(lib/brief.ts briefInstructions의 형식 규칙).
// 보호 항목(baseline 등) 제안은 지시 위반이라 brief_instruction_violation이 맡는다.
export const briefContract:Grader={id:'brief_contract',grade(item){
 if(item.kind!=='brief')return verdict('not_applicable');
 const text=outputText(item);
 if(text===undefined)return verdict('not_applicable','원 JSON 없음');
 try{parseBrief(text)}catch(error){return verdict('fail',(error as Error).message)}
 const x=outputObject(item)||{},keys=list(x.suggestions).map(s=>isObject(s)?s.field:undefined);
 const unknown=keys.filter(k=>typeof k!=='string'||!Object.hasOwn(briefFields,k)),repeated=keys.filter((k,i)=>typeof k==='string'&&keys.indexOf(k)!==i);
 const questions=list(x.questions).length,candidates=list(x.factCandidates).length;
 const issues=[questions>MAX_QUESTIONS?`확인 질문 ${questions}개 > ${MAX_QUESTIONS}`:'',unknown.length?`허용 밖 제안 키 ${unknown.map(String).join(',')}`:'',repeated.length?`중복 제안 키 ${[...new Set(repeated)].join(',')}`:'',candidates>MAX_FACT_CANDIDATES?`사실 후보 ${candidates}개 > ${MAX_FACT_CANDIDATES}`:''].filter(Boolean);
 return issues.length?verdict('fail',issues):verdict('pass');
}};

// 지시 금지 사항(lib/brief.ts briefInstructions): (a) 보호 항목(baseline·target·operations·owner·learning) 제안, (b) 사용자 입력(ctx.briefInput)·확정 원장에 없는 가격·날짜 단정
// (일정은 상대 단계로 쓴다), (c) 금지 표현(큐레이션 prohibitedTerms ∪ 원장 거절값)을 부정·배제 없이 사용. 대상은 계획이 되는 summary·제안 값이다(questions·assumptions 제외).
// [확인 필요]·[예시]·미확정 표시 문장은 단정이 아니다. 가격·날짜 추출(ledger.ts)과 금지 표현 목록·부정 판정(content.ts·negation.ts)은 fact_conflict·brief_prohibition_conflict와 같은 로직이다.
const PRICE=VALUE_KINDS.find(k=>k.kind==='가격')!;
function protectedHits(suggestions:Record<string,unknown>[]){
 return suggestions.flatMap(s=>typeof s.field==='string'&&protectedFields.has(s.field as BriefKey)?[`보호 항목 제안: ${s.field}`]:[]);
}
function valueHits(lines:string[],ctx:GradeContext){
 const known=[...confirmedFacts(ctx).map(f=>f.value),ctx.briefInput||''];
 const prices=new Set(known.flatMap(amounts)),days=new Set(known.flatMap(dates));
 return lines.filter(s=>!MARKED.test(s)).flatMap(s=>[
  ...PRICE.body(s).some(v=>!prices.has(v))?[`미확정 가격 단정: ${excerpt(s)}`]:[],
  ...dates(s).some(v=>!days.has(v))?[`일정 단정: ${excerpt(s)}`]:[],
 ]);
}
function termHits(lines:string[],ctx:GradeContext){
 const terms=prohibitedTerms(ctx);
 return lines.flatMap(s=>terms.filter(t=>usesTerm(s,t)).map(t=>`금지 표현 ${t}: ${excerpt(s)}`));
}
export const briefInstructionViolation:Grader={id:'brief_instruction_violation',content:true,grade(item,ctx){
 if(item.kind!=='brief')return verdict('not_applicable');
 const x=outputObject(item),suggestions=list(x?.suggestions).filter(isObject);
 const lines=(x?briefPlanValues(x):[bodyOf(item)]).flatMap(t=>t.split('\n')).flatMap(sentences);
 if(!lines.length&&!suggestions.length)return verdict('not_applicable','초안 본문 없음');
 const hits=[...protectedHits(suggestions),...valueHits(lines,ctx),...termHits(lines,ctx)];
 return hits.length?verdict('fail',[...new Set(hits)]):verdict('pass');
}};

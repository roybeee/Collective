import {learningMetrics} from '../learning';
import {verdict,outputObject,type Grader,type EvalItem,type GradeContext} from './types';
import {sentences,excerpt} from './text';
import {usesTerm} from './negation';
import {prohibitedTerms} from './content';
import {inputBudget} from './ledger';

// 바이럴 사례 분석(L1) 채점기(레인 Q 바이럴 평가 PR 1). kind 'viral_analysis'만 채점하고 결정론·네트워크 0이다. 규칙 정의는 docs/EVAL.ko.md '바이럴 사례 분석'.
// 운영 파서(lib/learning-server.ts parseAnalysis)는 서버 모듈이라 채점기에서 부르지 않고 같은 규칙을 여기 둔다(tests/viral-analysis-eval.test.mjs가 운영 출력으로 맞춰 본다).
const ANALYSIS_FIELDS=['facts','hook','retention','sharing','context','counterEvidence','unknowns'] as const;
const IDEA_FIELDS=['hypothesis','variable','control','treatment'] as const;
// 관찰 수치를 단정할 수 있는 분석 필드. 실험안(ideas)은 앞으로 볼 목표·기준이고 unknowns는 미확인 목록이라 관찰 밖 수치 판정에서 뺀다.
const OBSERVED_FIELDS=['facts','hook','retention','sharing','context','counterEvidence'] as const;
const FIELD_MAX=6000,MIN_IDEAS=1,MAX_IDEAS=3;
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown)=>typeof v==='string'?v:'';
const filled=(v:unknown)=>typeof v==='string'&&v.length<=FIELD_MAX&&!!v.trim();
const analysisOf=(item:EvalItem)=>item.kind==='viral_analysis'?outputObject(item):null;
const ideasOf=(x:Record<string,unknown>)=>(Array.isArray(x.ideas)?x.ideas:[]).filter(isObject);
// 사람이 읽는 분석 본문: 분석 필드와 실험안 문장(주지표 코드 metric 제외). JSON이 아니면 원문이다. 규제 가드레일·금지 표현이 이 본문을 읽는다.
export function viralProse(item:EvalItem):string[]{
 const x=analysisOf(item);
 if(!x)return [item.raw??item.text??''];
 return [...ANALYSIS_FIELDS.map(k=>text(x[k])),...ideasOf(x).flatMap(i=>IDEA_FIELDS.map(k=>text(i[k])))].filter(Boolean);
}
const lines=(values:string[])=>values.flatMap(v=>v.split('\n')).flatMap(sentences);

// 1) 형식: 운영 파서와 같은 규칙. 분석 7필드는 비지 않은 6,000자 이하 문자열, ideas는 1~3개, 실험안마다 주지표(learningMetrics)와 가설·변수·대조·실험 문장.
export const viralAnalysisContract:Grader={id:'viral_analysis_contract',grade(item){
 if(item.kind!=='viral_analysis')return verdict('not_applicable');
 const x=outputObject(item);
 if(!x)return verdict('fail','JSON 객체가 아닙니다');
 const ideas=Array.isArray(x.ideas)?x.ideas:null;
 const issues=[
  ...ANALYSIS_FIELDS.filter(k=>!filled(x[k])).map(k=>`${k} 없음·빈 값·${FIELD_MAX}자 초과`),
  ...(!ideas||ideas.length<MIN_IDEAS||ideas.length>MAX_IDEAS?[`실험안 ${ideas?ideas.length:0}개(${MIN_IDEAS}~${MAX_IDEAS}개)`]:[]),
  ...(ideas||[]).flatMap((idea,i)=>!isObject(idea)?[`실험안 ${i+1} 객체 아님`]:[
   ...(!Object.hasOwn(learningMetrics,text(idea.metric))?[`실험안 ${i+1} 주지표 ${String(idea.metric)}`]:[]),
   ...IDEA_FIELDS.filter(k=>!filled(idea[k])).map(k=>`실험안 ${i+1} ${k} 없음·빈 값`),
  ]),
 ];
 return issues.length?verdict('fail',issues):verdict('pass');
}};

// 2) 반례·미확인: counterEvidence·unknowns가 비었거나 자리 채움 말('없음', '-', 'N/A')뿐이면 fail. JSON이 아니면 형식 채점기가 맡는다(not_applicable).
const PLACEHOLDER=/^(?:없음|없다|없습니다|해당\s?없음|특이\s?사항\s?없음|n\/?a|none|null|미상|[-—–.]+)[.。]?$/i;
export const viralCounterEvidence:Grader={id:'viral_counter_evidence',grade(item){
 const x=analysisOf(item);
 if(!x)return verdict('not_applicable','JSON 아님(형식 채점기가 맡음)');
 const empty=(['counterEvidence','unknowns'] as const).filter(k=>!text(x[k]).trim()||PLACEHOLDER.test(text(x[k]).trim()));
 return empty.length?verdict('fail',empty.map(k=>`${k} 비었거나 자리 채움 말`)):verdict('pass');
}};

// 3) 관찰 밖 수치 단정: 관찰 분석 필드(OBSERVED_FIELDS)의 문장이 조회수·재생·공유 같은 지표 수, 백분율, 배수를 말하는데 그 값이 사례·관찰 기록(ctx.viralCase)에 없으면 fail.
// 허용 값: 사례·관찰의 제목·범위·관찰·자막·비교 조건에 적힌 모든 수(만·천·억 단위 환산 포함), views·baselineViews, 그리고 둘로 계산한 배수·백분율(반올림 0~2자리).
// '약·대략·정도·여·가량·수준'이 붙은 수는 허용 값과 5% 안이면 같은 값으로 본다. 미확인·[확인 필요]·추정·가설·예상·예시 문장은 단정이 아니다.
const UNIT:Record<string,number>={만:1e4,천:1e3,억:1e8};
const numberOf=(digits:string,unit?:string)=>Number(digits.replace(/,/g,''))*(unit?UNIT[unit]:1);
const keyOf=(n:number)=>String(Math.round(n*100)/100);
const HEDGE=/\[[^\]]*\]|미확인|확인\s?(?:필요|하지\s?못|되지\s?않|안\s?됨)|추정|가설|예상|가정|예시|미확정|자료\s?필요|알\s?수\s?없|모릅|불명/;
const APPROX=/약\s?\d|대략|정도|\d\s?여|가량|수준/;
const CLAIMS=[
 /(\d[\d,]*(?:\.\d+)?)\s?(?:%|퍼센트)()/g,
 /(\d+(?:\.\d+)?)\s?배()/g,
 /(\d[\d,]*(?:\.\d+)?)\s?(만|천|억)?\s?(?:회(?![사의원복전계차])|뷰|views?\b)/gi,
 /(?:조회수|조회|재생\s?수|좋아요|공유\s?수|공유|댓글\s?수|댓글|저장\s?수|팔로워|구독자|도달|노출|클릭)\s?(?:수)?\s?(?:는|은|이|가|:)?\s?(?:약\s?)?(\d[\d,]*(?:\.\d+)?)\s?(만|천|억)?/g,
];
function claimsOf(sentence:string){
 return CLAIMS.flatMap(re=>[...sentence.matchAll(re)].map(m=>numberOf(m[1],m[2]||undefined))).filter(Number.isFinite);
}
const SOURCE_FIELDS=['title','scope','observations','transcript','comparison'];
function allowedValues(ctx:GradeContext){
 const records=[ctx.viralCase?.case,...(ctx.viralCase?.observations||[])].filter(isObject);
 const written=records.flatMap(r=>SOURCE_FIELDS.map(k=>text(r[k]))).join('\n');
 const values=[...written.matchAll(/(\d[\d,]*(?:\.\d+)?)\s?(만|천|억)?/g)].flatMap(m=>[numberOf(m[1]),numberOf(m[1],m[2]||undefined)]);
 const derived=records.flatMap(r=>{
  const v=r.views,b=r.baselineViews;
  if(typeof v!=='number'||typeof b!=='number'||v<0||b<=0)return [];
  const ratio=v/b;
  return [...[0,1,2].flatMap(d=>[Number(ratio.toFixed(d)),Number((ratio*100).toFixed(d)),Number(((ratio-1)*100).toFixed(d))]),Math.floor(ratio)];
 });
 return [...values,...records.flatMap(r=>[r.views,r.baselineViews].filter((n):n is number=>typeof n==='number')),...derived].filter(Number.isFinite);
}
export const viralUnobservedMetric:Grader={id:'viral_unobserved_metric',content:true,grade(item,ctx){
 if(item.kind!=='viral_analysis')return verdict('not_applicable');
 if(!ctx.viralCase)return verdict('not_applicable','사례·관찰 기록 없음');
 const x=outputObject(item),allowed=allowedValues(ctx),keys=new Set(allowed.map(keyOf));
 const known=(n:number,approx:boolean)=>keys.has(keyOf(n))||approx&&allowed.some(a=>a>0&&Math.abs(n-a)/a<=0.05);
 const hits=lines(x?OBSERVED_FIELDS.map(k=>text(x[k])):[item.raw??item.text??'']).filter(s=>!HEDGE.test(s))
  .flatMap(s=>claimsOf(s).filter(n=>!known(n,APPROX.test(s))).map(n=>`관찰 밖 수치 ${keyOf(n)}: ${excerpt(s)}`));
 return hits.length?verdict('fail',[...new Set(hits)]):verdict('pass');
}};

// 4) 금지 표현: 큐레이션 금지 표현(ctx.prohibitedTerms)과 원장 거절값을 분석·실험안 문장에서 부정·배제 없이 쓰면 fail. 목록·부정 판정은 content.ts·negation.ts 그대로다.
export const viralProhibitedTerm:Grader={id:'viral_prohibited_term',content:true,grade(item,ctx){
 if(item.kind!=='viral_analysis')return verdict('not_applicable');
 const terms=prohibitedTerms(ctx);
 if(!terms.length)return verdict('not_applicable','금지 표현 없음');
 const hits=lines(viralProse(item)).flatMap(s=>terms.filter(t=>usesTerm(s,t)).map(t=>`금지 표현 ${t}: ${excerpt(s)}`));
 return hits.length?verdict('fail',[...new Set(hits)]):verdict('pass');
}};

// 바이럴 사례 분석 채점 목록. input_budget은 역할 상한(32,000, ctx.inputTokenCap이 있으면 그 값)을 쓰는 기존 채점기다.
// 역할(GRADERS)·회의·브리프(KIND_GRADERS) 목록에 넣지 않아 그 채점 결과는 바뀌지 않는다.
export const VIRAL_GRADERS:Grader[]=[viralAnalysisContract,viralCounterEvidence,viralUnobservedMetric,viralProhibitedTerm,inputBudget];

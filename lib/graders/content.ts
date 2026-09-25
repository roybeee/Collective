import {claimGuard} from '../campaign-policy';
import {verdict,type Grader,type EvalItem,type GradeContext} from './types';
import {isText,bodyOf,proseFields,blocks,sentences,excerpt,placeholderOnly} from './text';
import {NEGATION,usesTerm,neutralize,predicateOf,quoteSpans} from './negation';
import {INDUSTRY_TERMS,industryIds} from './industry';
import {outsideProhibition,withoutBannedLists} from './prohibition';

// 내용 채점기: question_only가 fail이면 not_applicable로 둔다(index.ts 우선순위 규칙).
const ledger=(ctx:GradeContext)=>ctx.facts?{confirmed:ctx.facts.confirmed||[],prohibited:ctx.facts.prohibited||[]}:{confirmed:[],prohibited:[]};
const hitsVerdict=(hits:string[])=>hits.length?verdict('fail',[...new Set(hits)]):verdict('pass');

// 브리프·안건이 막은 표현이 가설·실험·카피 구역에 부정·배제 없이 다시 나오면 fail. [확인 필요]는 면제 사유가 아니다(claimPolicy).
// 부정·배제는 그 표현 바로 뒤 서술부만 본다(negation.ts). 문장 안 다른 곳의 '놓치지 말고'·'아닌'은 면제 사유가 아니다.
const PROHIBITION_ZONE=/가설|실험|카피|문안|메시지|대본|자막|슬로건|헤드라인/;
const NUMBERED_TRIAL=/^(?:[-*]\s*)?(?:고객\s?|우선\s?)?(?:가설|실험)\s?\d/,TRIAL_SENTENCE=/^(?:가설|실험)\s?\d/;
// 브리프 지시 위반(brief.ts brief_instruction_violation)도 같은 금지 표현 목록을 쓴다.
export function prohibitedTerms(ctx:GradeContext){
 return [...(ctx.prohibitedTerms||[]),...claimGuard(ledger(ctx)).prohibited].map(t=>t.toLowerCase());
}
function zoneSentences(item:EvalItem){
 if(item.kind==='discussion')return [item.fields?.position,item.fields?.proposal].flatMap(v=>typeof v==='string'?v.split('\n').flatMap(sentences):[]);
 return blocks(bodyOf(item)).flatMap(b=>{
  const labelled=PROHIBITION_ZONE.test(b.label)&&!NEGATION.test(b.label);
  if(b.isLabel||!labelled&&!NUMBERED_TRIAL.test(b.line.trim()))return [];
  return sentences(b.line).filter(s=>labelled||TRIAL_SENTENCE.test(s));
 });
}
export const briefProhibitionConflict:Grader={id:'brief_prohibition_conflict',content:true,grade(item,ctx){
 if(!isText(item))return verdict('not_applicable');
 const terms=prohibitedTerms(ctx);
 if(!terms.length)return verdict('not_applicable','금지 표현 없음');
 return hitsVerdict(zoneSentences(item).flatMap(s=>terms.filter(t=>usesTerm(s,t)).map(t=>`${t}: ${excerpt(s)}`)));
}};

// 근거 없는 광고 표현(claimTerms 중 확정 원장에 없는 것)이 카피 구역 문장이나 따옴표 안 문구에 부정·[확인 필요] 없이 쓰이면 fail.
// 따옴표 안 문구도 그 문장 안에서 부정을 본다('“가장 인기 있는 …” 같은 문구는 쓰지 않는다'는 사용이 아니다).
const COPY_ZONE=/카피|문안|메시지\s?초안|대본|자막|헤드라인|슬로건|CTA/;
type CopyUnit={sentence:string;within?:(at:number)=>boolean};
function quotedUnits(line:string):CopyUnit[]{
 return sentences(line).flatMap(sentence=>{
  const spans=quoteSpans(sentence).filter(q=>q.end-q.start>=6);
  return spans.length?[{sentence,within:(at:number)=>spans.some(q=>at>=q.start&&at<q.end)}]:[];
 });
}
function copyUnits(item:EvalItem):CopyUnit[]{
 if(item.kind==='discussion')return proseFields(item).flatMap(f=>f.split('\n')).flatMap(quotedUnits);
 return outsideProhibition(blocks(withoutBannedLists(bodyOf(item)))).filter(b=>!b.isLabel).flatMap(b=>COPY_ZONE.test(b.label)?sentences(b.line).map(sentence=>({sentence})):quotedUnits(b.line));
}
export const unsupportedClaimTerm:Grader={id:'unsupported_claim_term',content:true,grade(item,ctx){
 if(!isText(item))return verdict('not_applicable');
 const terms=claimGuard(ledger(ctx)).unverified;
 const candidates=copyUnits(item).filter(u=>!/확인\s?필요/.test(u.sentence));
 return hitsVerdict(candidates.flatMap(u=>terms.filter(t=>usesTerm(u.sentence,t,u.within)).map(t=>`${t}: ${excerpt(u.sentence)}`)));
}};

// 캠페인 업종이 아닌 업종의 지표·용어. 사전은 industry.ts(G3에서 옮김). 캠페인 업종은 단일 ID 또는 [주 업종, ...허용 업종]이며 둘 다 사전 대조에서 뺀다.
export {INDUSTRY_TERMS};
const INDUSTRY_EXCLUDED=/무관|삭제|제외|해당\s?없|관련\s?없/;
// 로컬 채널 결정 줄('- 배달앱: 제외. … 배달 주문 흐름과 맞지 않는다', '| 배달앱 | 후순위 | …')은 현장 스킬이 쓰게 한 채널 결정이지 업종 지표 유출이 아니다(e8bd8e0 S8 재실행 실측).
// 줄이 배달 채널 이름으로 시작하고 그 줄의 결정이 제외·보류·후순위일 때만 줄 전체를 뺀다(표 행은 결정이 끝 칸에 있다: '| 배달앱 | … | 제외 |').
// 채택·선택 줄과 다른 줄의 배달 지표는 계속 본다.
// 결정은 라벨처럼 따로 선 낱말이다('제외.', '| 제외 |', '(제외)', '보류:'). '… 쿠폰 고객은 제외한다' 같은 서술은 결정이 아니다.
const DELIVERY_LINE=/^\s*(?:[-*•|]\s*)?(?:\*\*)?(?:배달\s?앱|배달의민족|배민|쿠팡이츠|요기요|배달\s?플랫폼)/,HOLD_DECISION=/[\s(：](?:제외|보류|후순위)(?=[\s).:])/;
const deliveryDecisionLine=(line:string)=>DELIVERY_LINE.test(line)&&HOLD_DECISION.test(line)&&!/채택|선택/.test(line);
export const industryMetricLeak:Grader={id:'industry_metric_leak',content:true,grade(item,ctx){
 const own=industryIds(ctx.industry);
 if(!isText(item)||!own.length)return verdict('not_applicable',own.length?undefined:'캠페인 업종 미상');
 const lines=bodyOf(item).split('\n').filter(l=>!deliveryDecisionLine(l)).flatMap(sentences).filter(s=>!INDUSTRY_EXCLUDED.test(s));
 return hitsVerdict(Object.entries(INDUSTRY_TERMS).filter(([id])=>!own.includes(id)).flatMap(([id,re])=>lines.filter(s=>re.test(s)).map(s=>`${id}: ${excerpt(s)}`)));
}};

// 재방문율·재구매율 정의 문장에 성숙 기준(30일 관찰 완료 코호트)이 없으면 fail(measurementDiscipline).
// 정의 서술만 본다: '재방문율 =', '재방문율: … / …', '÷', '나눈·나누어·나눠', '수 / 수', '비율로 정의', '재방문율은(:) … 고객(수)의 비율·비중', '재방문율은 … 수로 계산한다'.
// '재방문율은'만으로는 정의가 아니다. 재방문율·재구매율이 든 절(쉼표·연결 어미 전)의 서술부가 '아니다·계산하지 않는다·측정 보류'면 정의가 아니다
// ('30일 재방문율은 이번 결과의 주 KPI가 아니다'). 뒤 절의 '쿠폰 고객은 제외한다' 같은 단서는 정의를 지우지 않는다.
const REVISIT_DEFINITION=/재(?:방문|구매)율\s*=|재(?:방문|구매)율\s*[:：][^.\n]{0,80}?(?:\/|÷|나눈|나누어|나눠|비율|비중|대비)|÷|나눈|나누어|나눠|수\s?\/\s?[^/]{1,40}?수|비율(?:로|을)\s?정의|재(?:방문|구매)율(?:은|는|이란|\s?:)[^.]{0,80}?(?:고객|손님|구매자|방문자|회원|수)\s?(?:의\s?)?(?:비율|비중)|재(?:방문|구매)율[^.]{0,80}?(?:으로|로)\s?(?:계산|산출|정의)(?:한다|합니다|하며|하고|해)/;
const NOT_DEFINED=/(?:아니(?:다|며|고)?|아닙니다|아님|(?:계산|측정|산출|집계|사용|활용|보고|정의|추적)하?지\s?(?:않|말|못)[가-힣]{0,4}|(?:계산|측정|산출|집계|판단|정의)할\s?수\s?(?:는\s?)?없[가-힣]{0,4}|쓰지\s?(?:않|말)[가-힣]{0,4}|보류(?:한다|합니다|함)?)$/;
const REVISIT_TERM=/재(?:방문|구매)율/,REVISIT_CLAUSE_CUT=/[,，;；]|(?<![광재참최공신경원창])고\s|(?:며|면서|지만|는데|으나|니까|되)\s/;
// 산식은 재방문율이 든 절 안에 있어야 한다. 앞 절의 다른 지표 산식('카드 회수율은 … ÷ …로 정의하고, 재방문율과 섞지 마세요')과
// 'X는 재방문율이 아니라 Y'는 정의가 아니다(2026-09-25 파일럿 1 회의 토론의 상류 산식 비판).
const REVISIT_ANY=/재(?:방문|구매)/,NOT_THE_RATE=/^재(?:방문|구매)율(?:이|가)\s?아(?:니|닌|닙)/;
function defines(s:string){
 if(!REVISIT_DEFINITION.test(s))return false;
 const n=neutralize(s),term=n.search(REVISIT_TERM),at=term<0?Math.max(0,n.search(REVISIT_ANY)):term;
 const clause=n.slice(at).split(REVISIT_CLAUSE_CUT)[0],whole=(n.slice(0,at).split(REVISIT_CLAUSE_CUT).pop()||'')+clause;
 if(!REVISIT_DEFINITION.test(whole)||NOT_THE_RATE.test(clause))return false;
 return !NOT_DEFINED.test(predicateOf(clause).slice(-24));
}
const REVISIT_LABEL=/^재(?:방문|구매)율$/,MATURED=/관찰(?:이|을)?\s?(?:끝난|마친|완료)|성숙|코호트/;
export const revisitCohortDefinition:Grader={id:'revisit_cohort_definition',content:true,grade(item){
 if(!isText(item))return verdict('not_applicable');
 const lines=bodyOf(item).split('\n');
 const definitions=lines.flatMap((line,i)=>{
  if(REVISIT_LABEL.test(line.trim())&&/^\s*=/.test(lines[i+1]||''))return [line+' '+lines[i+1]];
  return sentences(line).filter(s=>/재방문|재구매/.test(s)&&defines(s));
 });
 if(!definitions.length)return verdict('not_applicable','재방문율 정의 없음');
 return hitsVerdict(definitions.filter(d=>!MATURED.test(d)).map(d=>`성숙 기준 없음: ${excerpt(d)}`));
}};

// F&B·점포 캠페인의 CMO·strategy는 4개 로컬 채널군을 후보로 다루고 선택·제외를 밝힌다. 자료 요청·산식 줄의 언급은 세지 않는다.
export const LOCAL_CHANNELS:Record<string,RegExp>={place:/네이버\s?(?:지도|플레이스)|플레이스/,daangn:/당근/,delivery:/배달\s?앱|배달의민족|배민|쿠팡이츠|요기요|배달\s?플랫폼/,kakao:/카카오/};
const CHANNEL_DECISION=/선택|제외|보류|후순위|채택|쓰지\s?않|다루지\s?않/;
export const localChannelCoverage:Grader={id:'local_channel_coverage',content:true,grade(item,ctx){
 if(!ctx.localStore||item.kind!=='role'||!['cmo','strategy'].includes(item.role||''))return verdict('not_applicable');
 const lines=blocks(bodyOf(item)).filter(b=>!placeholderOnly(b.line)&&!/^\s*=/.test(b.line)&&(/채널/.test(b.label)||/채널/.test(b.line)||CHANNEL_DECISION.test(b.line)));
 const covered=Object.entries(LOCAL_CHANNELS).filter(([,re])=>lines.some(b=>re.test(b.line))).map(([id])=>id);
 return covered.length===4?verdict('pass'):verdict('fail',`${covered.length}/4 (${covered.join(',')||'없음'})`);
}};

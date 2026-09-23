import {claimGuard} from '../campaign-policy';
import {verdict,type Grader,type EvalItem,type GradeContext} from './types';
import {isText,bodyOf,proseFields,blocks,sentences,NEGATION,compact,excerpt,placeholderOnly} from './text';

// 내용 채점기: question_only가 fail이면 not_applicable로 둔다(index.ts 우선순위 규칙).
const ledger=(ctx:GradeContext)=>ctx.facts?{confirmed:ctx.facts.confirmed||[],prohibited:ctx.facts.prohibited||[]}:{confirmed:[],prohibited:[]};
const hitsVerdict=(hits:string[])=>hits.length?verdict('fail',[...new Set(hits)]):verdict('pass');

// 브리프·안건이 막은 표현이 가설·실험·카피 구역에 부정·배제 없이 다시 나오면 fail. [확인 필요]는 면제 사유가 아니다(claimPolicy).
const PROHIBITION_ZONE=/가설|실험|카피|문안|메시지|대본|자막|슬로건|헤드라인/;
const NUMBERED_TRIAL=/^(?:[-*]\s*)?(?:고객\s?|우선\s?)?(?:가설|실험)\s?\d/,TRIAL_SENTENCE=/^(?:가설|실험)\s?\d/;
function prohibitedTerms(ctx:GradeContext){
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
 return hitsVerdict(zoneSentences(item).filter(s=>!NEGATION.test(s)).flatMap(s=>terms.filter(t=>s.toLowerCase().includes(t)).map(t=>`${t}: ${excerpt(s)}`)));
}};

// 근거 없는 광고 표현(claimTerms 중 확정 원장에 없는 것)이 카피 구역 문장에 부정·[확인 필요] 없이 쓰이면 fail.
const COPY_ZONE=/카피|문안|메시지\s?초안|대본|자막|헤드라인|슬로건|CTA/,COPY_EXEMPT=/하지\s?않을|사용하지\s?않을|금지|제외/;
const quoted=(text:string)=>[...text.matchAll(/[‘“"]([^’”"]{6,})[’”"]/g)].map(m=>m[1]);
function copyUnits(item:EvalItem){
 if(item.kind==='discussion')return proseFields(item).flatMap(quoted);
 return blocks(bodyOf(item)).filter(b=>!b.isLabel&&!(COPY_ZONE.test(b.label)&&COPY_EXEMPT.test(b.label))).flatMap(b=>COPY_ZONE.test(b.label)?[b.line]:quoted(b.line));
}
export const unsupportedClaimTerm:Grader={id:'unsupported_claim_term',content:true,grade(item,ctx){
 if(!isText(item))return verdict('not_applicable');
 const terms=claimGuard(ledger(ctx)).unverified;
 const candidates=copyUnits(item).flatMap(sentences).filter(s=>!NEGATION.test(s)&&!/확인\s?필요/.test(s));
 return hitsVerdict(candidates.flatMap(s=>terms.filter(t=>compact(s).includes(compact(t))).map(t=>`${t}: ${excerpt(s)}`)));
}};

// 캠페인 업종이 아닌 업종의 지표·용어. v1 사전은 campaign-policy.ts campaignEvidencePolicy의 보관함 정규식을 업종 사전으로 일반화했다.
export const INDUSTRY_TERMS:Record<string,RegExp>={locker:/물품보관함|보관함|락커|\blocker\b|가동\s?가능\s?시간|가동률/i,kpop:/포토카드|초동|팬사인회|앨범\s?판매/,beauty:/피부\s?개선|보습\s?효과|성분\s?함량/};
const INDUSTRY_EXCLUDED=/무관|삭제|제외|해당\s?없|관련\s?없/;
export const industryMetricLeak:Grader={id:'industry_metric_leak',content:true,grade(item,ctx){
 if(!isText(item)||!ctx.industry)return verdict('not_applicable',ctx.industry?undefined:'캠페인 업종 미상');
 const lines=bodyOf(item).split('\n').flatMap(sentences).filter(s=>!INDUSTRY_EXCLUDED.test(s));
 return hitsVerdict(Object.entries(INDUSTRY_TERMS).filter(([id])=>id!==ctx.industry).flatMap(([id,re])=>lines.filter(s=>re.test(s)).map(s=>`${id}: ${excerpt(s)}`)));
}};

// 재방문율·재구매율 정의 문장에 성숙 기준(30일 관찰 완료 코호트)이 없으면 fail(measurementDiscipline).
const REVISIT_DEFINITION=/재(?:방문|구매)율\s*[=:]|재(?:방문|구매)율은|÷|나눈|나누어/,REVISIT_LABEL=/^재(?:방문|구매)율$/,MATURED=/관찰(?:이|을)?\s?(?:끝난|마친|완료)|성숙|코호트/;
export const revisitCohortDefinition:Grader={id:'revisit_cohort_definition',content:true,grade(item){
 if(!isText(item))return verdict('not_applicable');
 const lines=bodyOf(item).split('\n');
 const definitions=lines.flatMap((line,i)=>{
  if(REVISIT_LABEL.test(line.trim())&&/^\s*=/.test(lines[i+1]||''))return [line+' '+lines[i+1]];
  return sentences(line).filter(s=>/재방문|재구매/.test(s)&&REVISIT_DEFINITION.test(s));
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

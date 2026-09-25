import {claimGuard} from '../campaign-policy';
import {verdict,type Grader,type EvalItem,type GradeContext} from './types';
import {isText,bodyOf,proseFields,blocks,sentences,excerpt,placeholderOnly,type Block} from './text';
import {NEGATION,usesTerm,neutralize,predicateOf,prohibitiveLabel,quoteSpans} from './negation';

// 내용 채점기: question_only가 fail이면 not_applicable로 둔다(index.ts 우선순위 규칙).
const ledger=(ctx:GradeContext)=>ctx.facts?{confirmed:ctx.facts.confirmed||[],prohibited:ctx.facts.prohibited||[]}:{confirmed:[],prohibited:[]};
const hitsVerdict=(hits:string[])=>hits.length?verdict('fail',[...new Set(hits)]):verdict('pass');

// 브리프·안건이 막은 표현이 가설·실험·카피 구역에 부정·배제 없이 다시 나오면 fail. [확인 필요]는 면제 사유가 아니다(claimPolicy).
// 부정·배제는 그 표현 바로 뒤 서술부만 본다(negation.ts). 문장 안 다른 곳의 '놓치지 말고'·'아닌'은 면제 사유가 아니다.
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
// 금지·보류 맥락(prohibitiveLabel)은 대상이 아니다: 그런 제목 아래(다음 같은 수준 이상 제목 전까지), 그런 라벨·인라인 라벨의 블록,
// 머리칸이 금지·보류인 표의 행(나머지 머리칸이 분류·보조 칸이 아니면 금지 칸만). '금지 또는 보류 표현' 표·목록은 규칙이지 카피 사용이 아니다.
const headingLevel=(line:string)=>/^(#{1,6})\s/.exec(line)?.[1].length||0;
const cellsOf=(row:string)=>row.trim().split('|');
// 금지 열: 머리칸이 금지 맥락이거나 금지·보류의 사유 칸('보류 사유', '제외 이유')이다. 표 전체가 금지 목록인 것은 나머지 머리칸이 모두 분류·보조 칸일 때뿐이다
// ('| 구분 | 사용하지 않을 표현 | 이유 |'). '| 안 | 문구 | 보류 사유 |', '| 채널 | 내용 | 금지 |'처럼 다른 열이 있으면 금지 열만 비우고 나머지 칸은 채점한다.
const TABLE_AUX=/^(?:유형|구분|분류|항목|범주|이유|사유|근거|조치|처리|기준|예시|비고|표현|번호)$/;
function bannedColumns(header:string){
 const cells=cellsOf(header),banned=cells.flatMap((c,i)=>c.trim()&&prohibitiveLabel(c.replace(/\s?(?:사유|이유)\s*$/,''))?[i]:[]);
 return {all:banned.length>0&&cells.every((c,i)=>!c.trim()||banned.includes(i)||TABLE_AUX.test(c.trim())),cols:banned};
}
// level: 금지 맥락 제목의 수준(0이면 없음). banned: 둘러싼 라벨(가장 가까운 라벨 줄)이 금지 맥락인지. table: 지금 표의 금지 열.
type Scope={level:number;banned:boolean;table:ReturnType<typeof bannedColumns>|null;out:Block[]};
function outsideProhibition(list:Block[]):Block[]{
 return list.reduce<Scope>((acc,b)=>{
  const h=headingLevel(b.line),row=b.line.trim().startsWith('|'),own=b.isLabel&&prohibitiveLabel(b.label);
  const open=h&&acc.level&&h<=acc.level?0:acc.level,level=h&&!open&&own?h:open;
  const banned=b.isLabel?own:acc.banned,table=row?acc.table||bannedColumns(b.line):null;
  if(level||banned||b.inline&&prohibitiveLabel(b.inline)||table?.all)return {level,banned,table,out:acc.out};
  const line=table?.cols.length?cellsOf(b.line).map((c,i)=>table.cols.includes(i)?'':c).join('|'):b.line;
  return {level,banned,table,out:[...acc.out,{...b,line}]};
 },{level:0,banned:false,table:null,out:[]}).out;
}
function copyUnits(item:EvalItem):CopyUnit[]{
 if(item.kind==='discussion')return proseFields(item).flatMap(f=>f.split('\n')).flatMap(quotedUnits);
 return outsideProhibition(blocks(bodyOf(item))).filter(b=>!b.isLabel).flatMap(b=>COPY_ZONE.test(b.label)?sentences(b.line).map(sentence=>({sentence})):quotedUnits(b.line));
}
export const unsupportedClaimTerm:Grader={id:'unsupported_claim_term',content:true,grade(item,ctx){
 if(!isText(item))return verdict('not_applicable');
 const terms=claimGuard(ledger(ctx)).unverified;
 const candidates=copyUnits(item).filter(u=>!/확인\s?필요/.test(u.sentence));
 return hitsVerdict(candidates.flatMap(u=>terms.filter(t=>usesTerm(u.sentence,t,u.within)).map(t=>`${t}: ${excerpt(u.sentence)}`)));
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
// 정의 서술만 본다: '재방문율 =', '재방문율: … / …', '÷', '나눈·나누어·나눠', '수 / 수', '비율로 정의', '재방문율은(:) … 고객(수)의 비율·비중', '재방문율은 … 수로 계산한다'.
// '재방문율은'만으로는 정의가 아니다. 재방문율·재구매율이 든 절(쉼표·연결 어미 전)의 서술부가 '아니다·계산하지 않는다·측정 보류'면 정의가 아니다
// ('30일 재방문율은 이번 결과의 주 KPI가 아니다'). 뒤 절의 '쿠폰 고객은 제외한다' 같은 단서는 정의를 지우지 않는다.
const REVISIT_DEFINITION=/재(?:방문|구매)율\s*=|재(?:방문|구매)율\s*[:：][^.\n]{0,80}?(?:\/|÷|나눈|나누어|나눠|비율|비중|대비)|÷|나눈|나누어|나눠|수\s?\/\s?[^/]{1,40}?수|비율(?:로|을)\s?정의|재(?:방문|구매)율(?:은|는|이란|\s?:)[^.]{0,80}?(?:고객|손님|구매자|방문자|회원|수)\s?(?:의\s?)?(?:비율|비중)|재(?:방문|구매)율[^.]{0,80}?(?:으로|로)\s?(?:계산|산출|정의)(?:한다|합니다|하며|하고|해)/;
const NOT_DEFINED=/(?:아니(?:다|며|고)?|아닙니다|아님|(?:계산|측정|산출|집계|사용|활용|보고|정의|추적)하?지\s?(?:않|말|못)[가-힣]{0,4}|쓰지\s?(?:않|말)[가-힣]{0,4}|보류(?:한다|합니다|함)?)$/;
const REVISIT_TERM=/재(?:방문|구매)율/,REVISIT_CLAUSE_CUT=/[,，;；]|(?<![광재참최공신경원창])고\s|(?:며|면서|지만|는데|으나|니까|되)\s/;
function defines(s:string){
 if(!REVISIT_DEFINITION.test(s))return false;
 const n=neutralize(s),clause=n.slice(Math.max(0,n.search(REVISIT_TERM))).split(REVISIT_CLAUSE_CUT)[0];
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

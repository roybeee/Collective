// B2 주간 다이제스트(한국어 마크다운). 같은 집계(lib/quality-console.ts consoleSummary·lib/quality-kappa.ts criterionKappa)만 쓰고 LLM·네트워크·DB를 부르지 않는다.
// GET /api/quality-console?format=digest&week=YYYY-Www와 로컬 스크립트(scripts/quality-digest.mjs)가 같은 함수로 같은 마크다운을 만든다. 형식은 docs/QUALITY-CONSOLE.ko.md.
// 요약에 없는 것은 쓰지 않는다: 작업물 본문·검토 메모 원문·채점 상세·회의 안건·이메일·계정 id는 이 모듈에 들어오지 않는다.
import {roles} from './agency';
import {isModelAlias} from './usage-summary';
import {REVIEW_REASONS,REVIEW_REASONS_VERSION,type ReasonCode} from './review-decisions';
import {MIN_SAMPLE,consoleSummary,weekRange,previousWeek,kstDate,type ConsoleInput,type ConsoleMetrics,type ConsoleSummary,type ConsoleRow,type MeetingCompletion} from './quality-console';
import {MIN_KAPPA_N,criterionKappa,unitsFromDecisions,kappaBand,type CriterionKappaRow,type KappaUnit} from './quality-kappa';

// 서버 JSON(GET /api/quality-console?week=)과 스크립트 입력이 같은 모양을 쓴다. kappa는 주 끝까지 누적한 사람 라벨이다.
// campaignId: 캠페인 범위로 좁힌 조회. partial: 조회 상한(limit)을 넘어 일부만 읽은 레코드 종류. 둘 다 머리말에 밝힌다.
export type DigestScope={campaignId?:string|null;partial?:{kinds:readonly string[];limit:number}|null};
export type DigestPayload={week:string;summary:ConsoleSummary;previous:ConsoleSummary|null;kappa:CriterionKappaRow[]}&DigestScope;
// units: 누적 κ 단위(B1 criterionUnits). 서버처럼 기간 안 판정만 읽었으면 따로 넘긴다. 없으면 input.decisions에서 만든다. 어느 쪽이든 주 끝 이후 라벨은 뺀다.
export function weeklyPayload(input:ConsoleInput,week:string,units?:readonly (KappaUnit&{createdAt:string})[]):DigestPayload{
 const range=weekRange(week),prev=previousWeek(week);
 if(!range||!prev)throw new RangeError('주(YYYY-Www)를 확인하세요.');
 const end=Date.parse(range.to),labels=(units??unitsFromDecisions(input.decisions)).filter(u=>Date.parse(u.createdAt)<end);
 return {week,summary:consoleSummary(input,range),previous:consoleSummary(input,weekRange(prev)!),kappa:criterionKappa(labels)};
}
export const digestMarkdown=(p:DigestPayload)=>weeklyDigest(p.summary,p.kappa,{week:p.week,previous:p.previous,campaignId:p.campaignId,partial:p.partial});
export const digestFileName=(week:string)=>`collective-quality-digest-${week}.md`;

const num=(n:number)=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,',');
const pct=(r:number)=>(Math.round(r*1000)/10).toFixed(1)+'%';
const cell=(s:string)=>s.replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
const table=(head:string[],rows:string[][])=>[`| ${head.join(' | ')} |`,`|${head.map(()=>'---').join('|')}|`,...rows.map(r=>`| ${r.map(cell).join(' | ')} |`)].join('\n');
const sampled=(rate:number|null,k:number,n:number)=>rate===null?`표본 부족 (n=${n})`:`${pct(rate)} (${k}/${n})`;
const signed=(d:number,text:string)=>d>0?'+'+text:d<0?'-'+text:text;
const countDiff=(a:number,b:number)=>a===b?'0':signed(a-b,num(Math.abs(a-b)));
const rateDiff=(a:number|null,b:number|null)=>a===null||b===null?'비교 불가':signed(a-b,(Math.round(Math.abs(a-b)*1000)/10).toFixed(1)+'%p');
const roleName=(id:string)=>id?roles.find(r=>r.id===id)?.name??id:'미확인';
const modelName=(m:string|null)=>m===null?'미확인':isModelAlias('hermes',m)?`${m} (실제 모델 미확인)`:m;
const range=(s:ConsoleSummary)=>`${kstDate(s.from)} ~ ${kstDate(new Date(Date.parse(s.to)-1).toISOString())}`;
const reasonLabel=(code:string)=>REVIEW_REASONS.find(r=>r.code===code)?.label??code;

function header(s:ConsoleSummary,week:string,previous:ConsoleSummary|null|undefined,scope:DigestScope){
 return [`# 품질 주간 다이제스트 · ${week}`,[`- 기간: ${range(s)} (한국 시간)`,previous?`- 비교: 전주 ${previousWeek(week)??'-'} (${range(previous)})`:'- 비교: 전주 자료 없음',
  ...(scope.campaignId?[`- 범위: 캠페인 ${scope.campaignId}만`]:[]),`- 집계: ${s.version} · 사유 코드 ${REVIEW_REASONS_VERSION}`].join('\n'),
  ['> **자동 판정 아님.** 기록된 사람 판정·사용량·채점 결과를 LLM 없이 센 숫자입니다. 작업물을 자동으로 합격·불합격 처리하지 않으며 최종 판단은 사람이 합니다.',
   `> 표본 규칙: 비율은 표본 ${MIN_SAMPLE}건 미만이면 '표본 부족', κ는 기준별 사람 라벨 ${MIN_KAPPA_N}건 미만이면 '보정 불가(표본 부족)'로 적습니다.`,
   ...(scope.partial?.kinds.length?[`> **일부만 집계.** 기록 종류 ${scope.partial.kinds.join(', ')}가 상한 ${num(scope.partial.limit)}건을 넘어 일부만 셌습니다. 실제 숫자는 더 클 수 있습니다.`]:[])].join('\n')].join('\n\n');
}
type Line={label:string;count?:(m:ConsoleMetrics)=>number;rate?:(s:ConsoleSummary)=>{rate:number|null;k:number;n:number}};
const OVERVIEW:Line[]=[
 {label:'AI 작업물(이전 버전 포함)',count:m=>m.artifacts},
 {label:'1차 승인율',rate:s=>({rate:s.totals.firstPassRate,k:s.totals.approvedFirst,n:s.totals.n})},
 {label:'수정 요청',count:m=>m.revisions},{label:'폐기 토큰',count:m=>m.discardedTokens},{label:'미연결 토큰',count:m=>m.unlinkedTokens},
 {label:'회의 완주율',rate:s=>({rate:s.meetings.rate,k:s.meetings.completed,n:s.meetings.started})},
 {label:'규제 보류',count:m=>m.holds},{label:'실패 채점기',count:m=>m.gradings.failedGraders},{label:'채점 오류',count:m=>m.gradings.grader_error},{label:'채점 미실행',count:m=>m.gradings.not_run},
];
function overview(s:ConsoleSummary,p:ConsoleSummary|null|undefined){
 const value=(line:Line,x:ConsoleSummary)=>{if(line.count)return num(line.count(x.totals));const r=line.rate!(x);return sampled(r.rate,r.k,r.n)};
 const change=(line:Line,x:ConsoleSummary,y:ConsoleSummary)=>line.count?countDiff(line.count(x.totals),line.count(y.totals)):rateDiff(line.rate!(x).rate,line.rate!(y).rate);
 const rows=OVERVIEW.map(line=>p?[line.label,value(line,s),value(line,p),change(line,s,p)]:[line.label,value(line,s)]);
 return '## 한눈에 보기\n\n'+table(p?['지표','이번 주','전주','변화']:['지표','이번 주'],rows);
}
function topReasons(r:ConsoleRow){
 const top=REVIEW_REASONS.map(x=>[x.code,r.reasons[x.code]] as [ReasonCode,number]).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]).slice(0,3);
 return top.length?top.map(([c,n])=>`${reasonLabel(c)} ${n}`).join(' · '):'—';
}
// 레지스트리 실행 행은 프롬프트 버전으로 묶어 스킬 버전 칸이 비고(—), 코드 상수 실행 행은 프롬프트 버전 칸이 '코드 상수'다.
function rowsSection(s:ConsoleSummary){
 const head=['역할','스킬 버전','프롬프트 버전','보고 모델','작업물','1차 승인율','수정 요청','주요 사유','폐기 토큰','미연결 토큰','채점 완료·오류·미실행','실패 채점기','규제 보류'];
 const body=s.rows.map(r=>[roleName(r.role),r.skillVersion??(r.promptVersion?'—':'미확인'),r.promptVersion??'코드 상수',modelName(r.reportedModel),num(r.artifacts),sampled(r.firstPassRate,r.approvedFirst,r.n),num(r.revisions),topReasons(r),
  num(r.discardedTokens),num(r.unlinkedTokens),`${r.gradings.graded}·${r.gradings.grader_error}·${r.gradings.not_run}`,num(r.gradings.failedGraders),num(r.holds)]);
 return '## 역할 × 스킬·프롬프트 버전 × 보고 모델\n\n'+(body.length?table(head,body):'이번 주 집계할 AI 작업물·판정·사용량이 없습니다.');
}
function reasonsSection(s:ConsoleSummary){
 const d=s.decisions,total=d.artifact+d.brief_suggestion+d.source+d.publication,used=s.reasons.filter(r=>r.total>0);
 const line=`판정 ${num(total)}건: 작업물 ${num(d.artifact)} · 브리프 제안 ${num(d.brief_suggestion)} · 자료 ${num(d.source)} · 발행 ${num(d.publication)}`;
 const body=used.map(r=>[r.label,num(r.artifact),num(r.brief_suggestion),num(r.source),num(r.publication),num(r.total)]);
 return `## 사람 판정 사유\n\n${line}\n\n`+(body.length?table(['사유','작업물','브리프 제안','자료','발행','합계'],body):'이번 주 사유 코드가 붙은 판정이 없습니다.');
}
const TOKEN_LINES:[string,(s:ConsoleSummary)=>number][]=[
 ['재질문만 남김',s=>s.totals.discarded.question_only],['수정 요청으로 대체',s=>s.totals.discarded.revision],['이전 버전(outdated)',s=>s.totals.discarded.outdated],['형식 오류(invalid_output)',s=>s.totals.discarded.invalid_output],
 ['폐기 합계',s=>s.totals.discardedTokens],['미연결',s=>s.totals.unlinkedTokens],['토큰 미보고 실행(건)',s=>s.totals.unknownTokenRuns],['다른 실행 종류(브리프·조사·학습)',s=>s.totals.otherKindTokens],
];
function tokensSection(s:ConsoleSummary,p:ConsoleSummary|null|undefined){
 const body=TOKEN_LINES.map(([label,f])=>p?[label,num(f(s)),num(f(p))]:[label,num(f(s))]);
 return "## 폐기 토큰\n\n쓰이지 않은 AI 작업물의 사용량입니다. 작업물·회의와 잇지 못한 사용량은 '미연결'로 따로 셉니다.\n\n"+table(p?['구분','이번 주','전주']:['구분','이번 주'],body);
}
const meetingsSection=(m:MeetingCompletion)=>`## 회의 완주율\n\n- 시작 ${num(m.started)}건 · 완료 ${num(m.completed)} · 실패 ${num(m.failed)} · 취소 ${num(m.cancelled)} · 진행 중 ${num(m.inProgress)}\n- 완주율(완료/시작): ${sampled(m.rate,m.completed,m.started)}`;
function kappaCells(r:CriterionKappaRow):[string,string,string]{
 const agreement=r.n===0?'라벨 없음':r.agreement===null?`표본 부족 (n=${r.n})`:pct(r.agreement);
 if(r.status==='ok'&&r.kappa!==null)return [agreement,r.kappa.toFixed(2),kappaBand(r.kappa)];
 if(r.status==='single_category')return [agreement,'κ 정의 불가(한 범주만 있음)','—'];
 return [agreement,`보정 불가(${r.status==='no_data'?'라벨 없음':'표본 부족'}, ${r.needed}건 더 필요)`,'—'];
}
const collapsedCell=(r:CriterionKappaRow)=>r.kappaCollapsed===null?'—':r.kappaCollapsed.toFixed(2);
function kappaSection(rows:readonly CriterionKappaRow[]){
 const missing=rows.reduce((s,r)=>s+r.missingAi,0),needsData=rows.reduce((s,r)=>s+r.aiNeedsData,0);
 return ['## 판정 보정 κ (주 끝까지 누적한 사람 라벨)',"사람의 기준별 판정(통과·수정)과 AI 품질 검수 checks 상태(통과·수정·자료 필요)의 일치도입니다. AI의 '자료 필요'는 사람 라벨에 없어 불일치로 셉니다. '묶은 κ'는 '자료 필요'를 '수정'으로 묶은 보조 값입니다. κ는 보정 참고값이며 자동 판정 기준이 아닙니다.",
  table(['기준','라벨 n','일치율','κ','해석','묶은 κ'],rows.map(r=>[r.label,num(r.n),...kappaCells(r),collapsedCell(r)])),
  ...(missing||needsData?[[...(needsData?[`- AI가 '자료 필요'로 둔 라벨 ${num(needsData)}건이 있습니다.`]:[]),...(missing?[`- AI 검수 상태가 없던 라벨 ${num(missing)}건은 빼고 셉니다.`]:[])].join('\n')]:[])].join('\n\n');
}
const gradersSection=(s:ConsoleSummary)=>'## 자주 실패한 채점기\n\n'+(s.failedGraders.length?'- '+s.failedGraders.slice(0,5).map(g=>`${g.id} ${num(g.count)}`).join(' · '):'- 이번 주 실패한 채점기가 없습니다.');

export function weeklyDigest(summary:ConsoleSummary,kappa:readonly CriterionKappaRow[],opts:{week:string;previous?:ConsoleSummary|null}&DigestScope):string{
 const p=opts.previous??null;
 return [header(summary,opts.week,p,opts),overview(summary,p),rowsSection(summary),reasonsSection(summary),tokensSection(summary,p),meetingsSection(summary.meetings),kappaSection(kappa),gradersSection(summary),
  '---','이 다이제스트는 작업물 본문·검토 메모 원문·이메일·계정 id를 담지 않습니다.'].join('\n\n')+'\n';
}

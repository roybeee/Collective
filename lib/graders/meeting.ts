import {parseMeetingStep,type MeetingStep,type QualityReview} from '../meetings';
import {verdict,outputObject,outputText,proseValues,type Grader,type EvalItem,type GradeContext,type SeededDefect} from './types';
import {bodyOf,sentences} from './text';
import {mentions,usesTerm} from './negation';

// 회의 단계 채점기(G3): 합의·개선본·품질 재검토. kind 'meeting_step'만 채점하고 단계(phase)가 대상이 아니면 not_applicable이다.
const phaseOf=(item:EvalItem)=>item.kind==='meeting_step'?item.phase:undefined;

// 합의·품질 재검토의 필수 필드·형식: 운영 파서 parseMeetingStep이 받아야 한다(합의: 결정·이견·질문과 과제 1~3개, 과제는 quality가 아닌 역할·중복 없음·필드 셋.
// 재검토: 판정 3종·요약·발견). 실무 스킬 회의(contract)의 재검토는 enforceQuality가 남긴 형식 누락(5개 기준 checks, 합의 과제별 taskChecks)도 fail이다.
// 재검토 항목은 taskRoles(합의 과제 담당)를 함께 줘야 한다. 없으면 합의 과제가 없는 회의로 본다(운영 파서와 같다).
// 개선본은 계약 없는 본문이라 대상이 아니고(revision_repeat), 회의 발언은 contract_json이 본다.
export const meetingStepContract:Grader={id:'meeting_step_contract',grade(item){
 const phase=phaseOf(item);
 if(phase!=='synthesis'&&phase!=='quality')return verdict('not_applicable');
 const text=outputText(item);
 if(text===undefined)return verdict('fail','단계 JSON 없음');
 const meeting=item.meetingId||'eval-meeting';
 const step:MeetingStep={id:`${meeting}:${phase}`,role:phase==='synthesis'?'cmo':'quality',phase,status:'running'};
 const synthesis:MeetingStep={id:`${meeting}:synthesis`,role:'cmo',phase:'synthesis',status:'completed',output:{decisions:'',disagreements:'',questions:'',tasks:(item.taskRoles||[]).map(role=>({role,instruction:'',reason:'',acceptance:''}))}};
 try{
  const {output}=parseMeetingStep(text,step,phase==='quality'?[synthesis,step]:[step],!!item.contract);
  const issues=(output as QualityReview).gateIssues||[];
  return issues.length?verdict('fail',issues):verdict('pass');
 }catch(error){return verdict('fail',(error as Error).message)}
}};

// 개선본이 원 작업물을 거의 그대로 반복하면 fail(lib/meetings.ts 개선 지시 '이전 작업물을 그대로 반복하지 마세요'). 설계 문서에 수치가 없어 기준을 여기서 정한다:
// 공백·문장부호를 뺀 본문의 3글자 조각 집합의 자카드 유사도 ≥ 0.9. 원본의 k 비율을 연속으로 고치면 유사도는 약 (1-k)/(1+k)라서
// 0.9는 본문의 약 5%(3,000자 원본이면 150자, 두세 문장) 미만만 고친 개선본이다. 한 줄짜리 과제라도 개선본은 지적을 반영해 다시 쓰므로
// 이 수준의 반복은 원본을 되돌려 주거나 수정 계획만 덧붙인 경우로 본다. 유사도는 pass에도 남겨 기준을 다시 맞출 때 쓴다.
export const REVISION_REPEAT_SIMILARITY=0.9;
const SHINGLE=3;
const plain=(s:string)=>s.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
function shingles(s:string){
 const p=plain(s),out=new Set<string>();
 for(let i=0;i+SHINGLE<=p.length;i++)out.add(p.slice(i,i+SHINGLE));
 return out;
}
export function similarity(a:string,b:string){
 const x=shingles(a),y=shingles(b);
 if(!x.size||!y.size)return x.size===y.size?1:0;
 let common=0;
 for(const s of x)if(y.has(s))common++;
 return common/(x.size+y.size-common);
}
// 개선본 본문(content). 본문이 없으면 반복·수정 여부를 판정하지 않는다(형식 누락은 채점 대상 밖).
const revisionText=(item:EvalItem)=>{const x=outputObject(item);return typeof x?.content==='string'?x.content:bodyOf(item)};
export const revisionRepeat:Grader={id:'revision_repeat',content:true,grade(item){
 if(phaseOf(item)!=='revision')return verdict('not_applicable');
 if(!item.original?.trim())return verdict('not_applicable','원 작업물 없음');
 const text=revisionText(item);
 if(!text.trim())return verdict('not_applicable','개선본 본문 없음');
 const s=similarity(text,item.original),shown=`유사도 ${s.toFixed(3)}`;
 return s>=REVISION_REPEAT_SIMILARITY?verdict('fail',`${shown} ≥ ${REVISION_REPEAT_SIMILARITY} (3글자 조각 자카드)`):verdict('pass',shown);
}};

// 평가 케이스에 심은 결함(ctx.seededDefects)을 품질 재검토가 지적했는지, 개선본이 고쳤는지. 심은 결함이 없으면 not_applicable이다.
// 재검토: 판정·역할 같은 코드 필드를 뺀 모든 문장(요약·발견·기준별·과제별 검토)에 결함의 marker나 keywords 중 하나가 나오면 지적이다.
//   부정과 무관하다('…표현은 삭제' 요청도 지적이다). '문제없다'는 서술도 언급으로 세는 한계가 있어 keywords는 결함을 가리키는 고유 표현으로 고른다.
// 개선본: 같은 역할에 심은 marker 결함만 본다. marker를 부정·배제 없이(negation.ts usesTerm, 부정 맥락 판정 재사용) 다시 쓰면 미수정이다. 대상 결함이 없으면 not_applicable.
function defectsOf(ctx:GradeContext):SeededDefect[]{
 return (ctx.seededDefects||[]).map(d=>{if(!d||typeof d.id!=='string'||!d.id)throw new Error('seededDefects 항목에 id가 없습니다.');return d});
}
const cues=(d:SeededDefect)=>[d.marker,...(d.keywords||[])].filter((t):t is string=>typeof t==='string'&&!!t.trim());
export const seededDefectDetection:Grader={id:'seeded_defect_detection',content:true,grade(item,ctx){
 const phase=phaseOf(item);
 if(phase!=='quality'&&phase!=='revision')return verdict('not_applicable');
 const defects=defectsOf(ctx);
 if(!defects.length)return verdict('not_applicable','심은 결함 없음');
 if(phase==='quality'){
  const x=outputObject(item),text=x?proseValues(x).join('\n'):bodyOf(item);
  const missed=defects.filter(d=>!cues(d).some(t=>mentions(text,t)));
  return missed.length?verdict('fail',`지적 누락 ${missed.map(d=>d.id).join(', ')}`):verdict('pass',`${defects.length}건 지적`);
 }
 const own=defects.filter(d=>d.role===item.role&&typeof d.marker==='string'&&!!d.marker.trim()),text=revisionText(item);
 if(!own.length)return verdict('not_applicable','이 역할 개선본에 심은 문구 없음');
 if(!text.trim())return verdict('not_applicable','개선본 본문 없음');
 const lines=text.split('\n').flatMap(sentences);
 const kept=own.filter(d=>lines.some(s=>usesTerm(s,d.marker!)));
 return kept.length?verdict('fail',`미수정 ${kept.map(d=>d.id).join(', ')}`):verdict('pass',`${own.length}건 수정`);
}};

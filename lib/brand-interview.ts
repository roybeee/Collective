import type {ArchiveSource,ArchiveCategory} from './archive';
import {industryQuestion,type InterviewIndustryId} from './brand-interview-industries';
export const interviewSections = [
 {id:'story',title:'브랜드의 시작과 약속',category:'brand',question:'이 브랜드를 시작하게 된 계기와, 고객에게 꼭 지키고 싶은 약속은 무엇인가요?',followups:['그 생각을 실제로 지킨 최근 사례를 들려주세요.','고객이 우리를 한 문장으로 기억한다면 어떤 말이면 좋을까요?','절대 바꾸고 싶지 않은 가치와 피하고 싶은 이미지는 무엇인가요?']},
 {id:'product',title:'상품·가격·선택 이유',category:'product',question:'처음 온 고객에게 가장 추천하는 상품은 무엇이고, 왜 그것을 추천하시나요?',followups:['판매가·원가·마진·베스트셀러와 알리고 싶은 상품이 다른가요?','재료·제조법·서비스 중 경쟁사가 쉽게 따라 하기 어려운 점은요?','차별점을 보여줄 사진·실험·후기·인증 자료가 있나요?']},
 {id:'customer',title:'고객과 구매 순간',category:'customer',question:'최근 만족하며 구매한 고객 한 분을 떠올리면, 어떤 상황에서 무엇을 찾던 분인가요?',followups:['고객이 실제로 했던 말을 그대로 들려주세요.','방문·구매를 망설이는 이유와 반복되는 불만은 무엇인가요?','신규 고객과 재방문 고객은 무엇이 다른가요?']},
 {id:'market',title:'상권·경쟁·대안',category:'market',question:'고객이 우리를 선택하지 않았다면 어디에서 무엇을 샀을까요?',followups:['주요 상권·유입 동선·요일과 시간대별 차이가 있나요?','경쟁 브랜드보다 강한 점과 솔직히 약한 점은 무엇인가요?','계절·날씨·지역 행사에 따라 수요가 달라지나요?']},
 {id:'channels',title:'콘텐츠와 고객 접점',category:'channel',question:'고객은 주로 어디에서 우리를 알게 되고, 어떤 콘텐츠에 반응했나요?',followups:['공식 채널 주소와 성과가 좋았던 게시물, 실패한 시도를 알려주세요.','브랜드다운 말투·레퍼런스와 피하고 싶은 표현은요?','촬영 가능한 인물·공간·제작 과정, 사용 허락된 자료는 있나요?']},
 {id:'goals',title:'목표·성과·예산',category:'performance',question:'이번 마케팅이 끝났을 때 어떤 변화가 생기면 성공이라고 하실까요?',followups:['현재 수치와 목표 수치, 기간, 측정 자료를 알려주세요.','신규 방문·재방문·매출 중 우선순위는 무엇인가요?','광고비와 제작비 한도, 할인 가능한 범위는 어떻게 되나요?']},
 {id:'operations',title:'운영 현실과 제약',category:'operations',question:'마케팅으로 주문이나 방문이 늘어나면 어느 정도까지 무리 없이 대응할 수 있나요?',followups:['영업시간·휴무·재고·예약·배달 가능 범위는요?','피해야 할 표현·법적 검토·촬영 제한·알레르기 등 필수 고지가 있나요?','실행 담당 역할, 승인 절차와 수정 마감은 어떻게 되나요?']},
 {id:'campaign',title:'첫 캠페인의 방향',category:'operations',question:'이번에는 누구에게 어떤 이유로 어떤 행동을 하게 만들고 싶으신가요?',followups:['지금 시작해야 하는 이유나 출시·행사 일정이 있나요?','고객에게 제안할 혜택과 구매·예약 링크는 무엇인가요?','아직 확인하지 못한 사실과 추가로 전달할 자료는 무엇인가요?']},
] as const;
export type InterviewSectionId=typeof interviewSections[number]['id'];
export type InterviewAnswers=Partial<Record<InterviewSectionId,string>>;
export type InterviewProposal={section:InterviewSectionId;answer:string;quote:string;sourceId:string};
export type InterviewJob={id:string;status:'queued'|'uncertain'|'completed'|'failed'|'cancelled';providerId?:string;endpoint:string;sourceIds:string[];evidence:Record<string,string>;error?:string;createdAt:string;updatedAt:string};
export type InterviewData={industry?:InterviewIndustryId;role:string;answers:InterviewAnswers;attachments:string[];proposals:InterviewProposal[];job?:InterviewJob;consentAt?:string};
export type InterviewSource=ArchiveSource&{interview:InterviewData};
export const interviewBusy=(d:InterviewData)=>!!d.job&&['queued','uncertain'].includes(d.job.status);
export function interviewContent(answers:InterviewAnswers){return interviewSections.filter(s=>answers[s.id]?.trim()).map(s=>`## ${s.title}\n${answers[s.id]!.trim()}`).join('\n\n')}
export function interviewProgress(answers:InterviewAnswers){return interviewSections.filter(s=>answers[s.id]?.trim()).length}
export function recommendedQuestions(answers:InterviewAnswers,industry:InterviewIndustryId='general'){const common= interviewSections.flatMap<{section:InterviewSectionId;question:string;reason:string}>(s=>!answers[s.id]?.trim()?[{section:s.id,question:s.question,reason:'필수 답변 미입력'}]:answers[s.id]!.trim().length<60?[{section:s.id,question:s.followups[0],reason:'구체적인 사례 보완'}]:[]).slice(0,5);const tailored=interviewSections.filter(s=>(answers[s.id]?.trim().length||0)<60).flatMap(s=>{const question=industryQuestion(industry,s.id);return question?[{section:s.id,question,reason:'업종 관점 보완'}]:[]}).slice(0,2);return [...common.slice(0,5-tailored.length),...tailored]}
export function parseInterviewProposals(output:string,evidence:Record<string,string>):InterviewProposal[]{
 const raw:unknown=JSON.parse(output.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
 if(!raw||typeof raw!=='object'||!('sections'in raw)||!Array.isArray(raw.sections)||raw.sections.length>24)throw new Error('인터뷰 정리 응답 형식이 올바르지 않습니다.');
 return raw.sections.map((p:unknown)=>{
  if(!p||typeof p!=='object')throw new Error('섹션 형식을 확인하세요.');
  const v=p as Record<string,unknown>;
  if(!interviewSections.some(s=>s.id===v.section)||typeof v.answer!=='string'||!v.answer.trim()||v.answer.length>5000||typeof v.quote!=='string'||v.quote.trim().length<4||v.quote.length>2000||typeof v.sourceId!=='string'||!Object.hasOwn(evidence,v.sourceId)||!evidence[v.sourceId].includes(v.quote))throw new Error('원문에서 확인할 수 없는 인용 또는 섹션입니다.');
  return {section:v.section as InterviewSectionId,answer:v.answer.trim(),quote:v.quote,sourceId:v.sourceId};
 });
}
export const audioFile=(name:string)=>/\.(mp3|wav|m4a|mp4|webm|ogg)$/i.test(name);
export function interviewAudioProblem(name:string,b:Uint8Array){
 const ascii=(s:string,at=0)=>[...s].every((c,i)=>b[at+i]===c.charCodeAt(0));
 const ext=name.split('.').pop()?.toLowerCase();
 const valid=ext==='wav'?ascii('RIFF')&&ascii('WAVE',8):ext==='mp3'?ascii('ID3')||(b[0]===255&&(b[1]&224)===224):ext==='m4a'||ext==='mp4'?ascii('ftyp',4):ext==='ogg'?ascii('OggS'):ext==='webm'?b[0]===26&&b[1]===69&&b[2]===223&&b[3]===163:false;
 return valid?'':'녹음 파일의 형식과 확장자가 다릅니다.';
}
export const interviewCategory=(id:InterviewSectionId):ArchiveCategory=>interviewSections.find(s=>s.id===id)!.category;

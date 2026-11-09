// 홈 '오늘의 안건' 결정 인박스 v2(GLOBAL-PLAN X1)의 새 출처: 작업물 검토 대기·발행 승인 대기·회의/연속 실행 확인 대기·자료 요청 열림·질문(브리프 확인 질문·회의 확인할 사실).
// 순수 함수만 둔다(DB 접근은 lib/agenda-server.ts). 입력은 저장된 기록 그대로(필드가 없거나 형식이 달라도 건너뛴다). 외부 호출·자동 집행은 없다.
import {roles} from './agency';
import type {AgendaItem} from './agenda-types';
export type SourceCampaign={id:string;title:string;version:number;brandId:string;storeId?:string};
export type Names={brand:(id:string)=>string;store:(id:string|undefined)=>string};
type R=Record<string,unknown>;
const text=(v:unknown,max=80)=>typeof v==='string'?v.slice(0,max):'';
const roleName=(id:unknown)=>roles.find(r=>r.id===id)?.name||'';
const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const where=(c:SourceCampaign,names:Names)=>[names.brand(c.brandId),names.store(c.storeId)].filter(Boolean);
// 범위 역할 화면 판정에 쓰는 자원(브랜드·지점). 행 안 동작이 있는 출처에만 단다.
const scope=(c:SourceCampaign)=>({brandId:c.brandId,storeId:c.storeId??null});
// 작업물 검토 대기: status 'review'(lib/history-labels.ts 표기 '검토 대기'). 현재 브리프 버전의 작업물만 행 안에서 승인·수정 요청할 수 있다(서버가 같은 조건을 409로 막는다).
export function artifactItem(d:R,c:SourceCampaign,names:Names):AgendaItem|null{
 if(d.status!=='review'||typeof d.id!=='string')return null;
 const current=d.campaignVersion===undefined||d.campaignVersion===c.version,version=Number.isSafeInteger(d.version)?Number(d.version):0;
 return {id:`artifact:${d.id}`,kind:'decision',source:'artifact',title:`${roleName(d.role)||'작업물'} 작업물 검토 대기`,detail:text(d.title)||`v${version}`,campaignId:c.id,campaignTitle:c.title,where:where(c,names),due:null,cost:null,section:'decide',ctab:'outputs',...scope(c),
  ...(current&&version>0?{action:{type:'review_artifact' as const,recordId:d.id,version,role:String(d.role??'')}}:{})};
}
// 발행 승인 대기(초안)·접수 대기(승인됨). 초안만 행 안에서 승인한다. AI 카피·코드 PNG 발행은 화면의 별도 확인란이 필요해 실행 탭에서만 승인한다(열기만).
export function publicationItem(d:R,c:SourceCampaign,names:Names):AgendaItem|null{
 if(typeof d.id!=='string'||(d.status!=='draft'&&d.status!=='approved'))return null;
 const cost=num(d.plannedCostKRW)??0,due=typeof d.scheduledAt==='string'?d.scheduledAt:null,copy=(d.copy??{}) as R,aiCopy=copy.aiGenerated===true,codedPng=!!d.codedPng,version=Number.isSafeInteger(d.version)?Number(d.version):0;
 const account=text(d.channelId,60);
 const base={id:`publication:${d.id}`,kind:'decision' as const,source:'publication' as const,campaignId:c.id,campaignTitle:c.title,where:[...where(c,names),...(account?[`계정 ${account}`]:[])],due,cost,section:'execute' as const,ctab:'execution' as const,detail:text(d.caption).split('\n')[0],...scope(c)};
 if(d.status==='approved')return {...base,title:'승인한 발행 접수 대기'};
 return {...base,title:'발행 승인 대기',...(version>0&&!d.needsReview?{action:{type:'approve_publication' as const,recordId:d.id,version,aiCopy,codedPng}}:{})};
}
// 회의: 접수 여부가 불확실한 회의(또는 그런 단계)는 사람이 재시도·복구를 정해야 한다. 끝난 회의의 종합 '확인할 사실'(synthesis.questions)은 질문 탭에 둔다.
export function meetingItems(d:R,c:SourceCampaign,names:Names):AgendaItem[]{
 if(typeof d.id!=='string')return [];
 const steps=Array.isArray(d.steps)?d.steps as R[]:[],out:AgendaItem[]=[],base={campaignId:c.id,campaignTitle:c.title,where:where(c,names),due:null,cost:null,section:'decide' as const,ctab:'meeting' as const};
 const uncertain=d.status==='uncertain'||steps.filter(s=>s.status==='uncertain').length;
 if(uncertain)out.push({...base,id:`meeting:${d.id}`,kind:'decision',source:'meeting',title:'회의 진행 확인 대기',detail:text(d.agenda)||`확인할 단계 ${typeof uncertain==='number'?uncertain:1}개`});
 if(d.status==='completed'){const synthesis=steps.find(s=>s.phase==='synthesis'&&s.status==='completed'),questions=text(((synthesis?.output??{}) as R).questions,200);
  if(questions)out.push({...base,id:`meeting-question:${d.id}`,kind:'question',source:'meeting',title:'회의에서 확인할 사실',detail:questions});}
 return out;
}
// 연속 실행이 독립 품질 검수 지적으로 멈춘 상태(needs_review). 사람이 수정 목록을 보고 회의·보완을 정한다.
export function sequenceItem(d:R,c:SourceCampaign,names:Names):AgendaItem|null{
 if(d.status!=='needs_review')return null;
 const fixes=Array.isArray(d.fixes)?d.fixes.length:0;
 return {id:`sequence:${c.id}`,kind:'decision',source:'sequence',title:'연속 실행 검수 확인 대기',detail:fixes?`수정 요청 ${fixes}건`:text(d.error),campaignId:c.id,campaignTitle:c.title,where:where(c,names),due:null,cost:null,section:'decide',ctab:'team'};
}
// 자료 요청 열림(lib/data-requests.ts status 'open'). 캠페인 범위 요청만 안건에 넣는다(행은 캠페인으로 연다). 지점 범위 요청은 지점 이름을 함께 보인다.
export function dataRequestItem(d:R,c:SourceCampaign,names:Names):AgendaItem|null{
 if(d.status!=='open'||typeof d.id!=='string')return null;
 const store=typeof d.storeId==='string'?names.store(d.storeId):'';
 return {id:`data_request:${d.id}`,kind:'decision',source:'data_request',title:'자료 요청 열림',detail:text(d.label)||text(d.text),campaignId:c.id,campaignTitle:c.title,where:[names.brand(c.brandId),store||names.store(c.storeId),text(d.assignee,40)&&`담당 ${text(d.assignee,40)}`].filter(Boolean),due:null,cost:null,section:'prepare',ctab:'brief'};
}
// 브리프 확인 질문(HERMES 초안 result.questions). 기존 캠페인을 고치던 초안(campaignId)이 끝났고 아직 저장하지 않았을 때만 질문으로 둔다.
export function briefQuestionItem(d:R,c:SourceCampaign,names:Names):AgendaItem|null{
 if(d.status!=='completed'||typeof d.id!=='string'||typeof d.savedCampaignId==='string')return null;
 const questions=(Array.isArray((d.result as R|undefined)?.questions)?(d.result as R).questions as R[]:[]).map(q=>text(q.question,120)).filter(Boolean);
 if(!questions.length)return null;
 return {id:`brief-question:${d.id}`,kind:'question',source:'brief',title:`브리프 확인 질문 ${questions.length}개`,detail:questions[0],campaignId:c.id,campaignTitle:c.title,where:where(c,names),due:null,cost:null,section:'prepare',ctab:'brief'};
}

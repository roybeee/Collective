import type {Campaign} from './agency';
import {lessonOutcomeView,lessonOutcomeHistory} from './growth-lesson-outcomes-server';
import {growthDecisionsView} from './growth-decisions-server';
import {lessonReuse,parseApplicationInput,parseOutcome,type ApplicationInput,type ApplicationOutcome} from './growth-lesson-applications';
import {campaignRows,inCampaign,optionalRecord,versionedMutation,type Versioned} from './growth-ledger-server';
import {storefrontDigest} from './storefront-orders';
import {ApiError,str,type Actor} from './server';
const kinds={current:'growth_lesson_application',history:'growth_lesson_application_history',request:'growth_lesson_application_request'} as const;
const targetKinds={mission:'growth_mission',landing_revision:'growth_landing_revision',demand:'growth_demand',experiment:'growth_experiment'} as const;
export type LessonApplicationRecord=Versioned&{input:ApplicationInput;lessonDigest:string;outcome:ApplicationOutcome|null;createdAt:string;updatedAt:string;updatedBy:string};
export async function growthLessonApplicationView(who:Actor,c:Campaign){
 const [rows,history,decisions]=await Promise.all([campaignRows<LessonApplicationRecord>(who.owner,c,kinds.current,1000),campaignRows<LessonApplicationRecord>(who.owner,c,kinds.history,10000),growthDecisionsView(who,c)]);
 const own=rows.filter(r=>inCampaign(r,c)),today=new Date().toISOString().slice(0,10);
 const [automatic,automaticHistory]=await Promise.all([lessonOutcomeView(who,c,own),lessonOutcomeHistory(who,c)]);
 const applications=await Promise.all(own.map(async r=>{const lesson=decisions.lessons.find(l=>l.id===r.input.lessonId),target=await optionalRecord<{brandId:string;campaignId:string;version:number}>(who.owner,targetKinds[r.input.targetKind],r.input.targetId);
  const reasons=[...(!lesson?['교훈이 없습니다.']:lesson.version!==r.input.lessonVersion?['적용 뒤 교훈이 개정되었습니다.']:[]),...(!target||!inCampaign(target,c)?['적용 대상이 없습니다.']:target.version!==r.input.targetVersion?['적용 뒤 대상 기록이 바뀌었습니다.']:[])];
  return {...r,automatic:automatic.get(r.id)??null,sourceStatus:reasons.length?'changed' as const:'current' as const,sourceReasons:reasons,overdue:!r.outcome&&r.input.checkAt<today}}));
 const reusable=decisions.lessons.filter(l=>l.assessment.canReuse).map(l=>({id:l.id,version:l.version,title:l.input.title,scope:l.input.scope,method:l.input.method,expiresAt:l.input.expiresAt}));
 const tally=lessonReuse(own.map(a=>({lessonId:a.input.lessonId,outcome:a.outcome,checkAt:a.input.checkAt})),today);
 const suggestions=decisions.missions.filter(m=>!['failed','cancelled'].includes(m.status??'')).map(m=>({missionId:m.id,missionVersion:m.version,title:m.input.title,lessons:reusable.filter(l=>!own.some(a=>a.input.lessonId===l.id&&a.input.targetKind==='mission'&&a.input.targetId===m.id)).map(l=>({...l,record:tally.find(t=>t.lessonId===l.id)??null})).sort((a,b)=>(b.record?.success??0)-(a.record?.success??0))})).filter(s=>s.lessons.length);
 return {campaignId:c.id,campaignVersion:c.version,applications,automaticHistory,history:history.filter(h=>inCampaign(h,c)),reusable,tally,suggestions,canEdit:who.role!=='member',mayPromote:false as const,autoApply:false as const};
}
export type GrowthLessonApplicationView=Awaited<ReturnType<typeof growthLessonApplicationView>>;
export async function saveGrowthLessonApplication(who:Actor,c:Campaign,b:Record<string,unknown>){
 const id=str(b.id,'적용 ID',100,true),action=String(b.action??'');
 if(action==='apply'){
  if(c.status==='archived')throw new ApiError(409,'보관한 캠페인에는 새 적용을 기록하지 않습니다.');
  const input=parseApplicationInput(b.input);
  return versionedMutation<LessonApplicationRecord>(who,c,b,kinds,id,{action,input},async(old,at)=>{
   if(old)throw new ApiError(409,'적용 기록은 새로 만듭니다. 결과는 결과 기록으로 남기세요.');
   const decisions=await growthDecisionsView(who,c),lesson=decisions.lessons.find(l=>l.id===input.lessonId);
   if(!lesson)throw new ApiError(404,'현재 캠페인의 교훈이 아닙니다.');if(lesson.version!==input.lessonVersion)throw new ApiError(409,'교훈이 개정되었습니다. 최신 판을 선택하세요.');
   if(!lesson.assessment.canReuse)throw new ApiError(409,'재사용 가능(reusable)하고 누락·만료가 없는 교훈만 적용합니다.');
   const target=await optionalRecord<{brandId:string;campaignId:string;version:number}>(who.owner,targetKinds[input.targetKind],input.targetId);
   if(!target||!inCampaign(target,c))throw new ApiError(404,'현재 캠페인의 적용 대상이 아닙니다.');if(target.version!==input.targetVersion)throw new ApiError(409,'적용 대상이 변경되었습니다. 최신 판을 선택하세요.');
   return {next:{id,brandId:c.brandId,campaignId:c.id,version:1,input,lessonDigest:await storefrontDigest({id:lesson.id,version:lesson.version,input:lesson.input}),outcome:null,createdAt:at,updatedAt:at,updatedBy:who.id},limit:1000};
  });
 }
 if(action==='record_outcome'){
  let outcome;try{outcome=parseOutcome(b.outcome)}catch(e){throw new ApiError(400,e instanceof Error?e.message:'결과를 확인하세요.')}
  return versionedMutation<LessonApplicationRecord>(who,c,b,kinds,id,{action,outcome},async(old,at)=>{
   if(!old)throw new ApiError(404,'적용 기록을 찾지 못했습니다.');if(old.outcome)throw new ApiError(409,'이미 결과를 기록했습니다. 결과는 덮어쓰지 않습니다.');
   if(Date.parse(outcome.at)<Math.floor(Date.parse(old.createdAt)/60_000)*60_000)throw new ApiError(409,'결과 시각은 적용 이후여야 합니다.');
   return {next:{...old,version:old.version+1,outcome:{...outcome,recordedAt:at,recordedBy:who.id},updatedAt:at,updatedBy:who.id},limit:1000};
  });
 }
 throw new ApiError(400,'지원하지 않는 교훈 적용 작업입니다.');
}

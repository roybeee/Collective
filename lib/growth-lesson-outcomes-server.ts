import type {Campaign} from './agency';
import type {LessonApplicationRecord} from './growth-lesson-applications-server';
import {readGrowthLessonEvidence,type LessonEvidenceRow} from './growth-lesson-evidence-server';
import {readExperimentOutcomeBasis} from './growth-experiment-server';
import {appendRow,campaignRows,inCampaign,optionalRecord} from './growth-ledger-server';
import {ApiError,acquireLock,releaseLock,database,readRecord,recordStatement,stamp,type Actor} from './server';
import {storefrontDigest} from './storefront-orders';

const kinds={current:'growth_lesson_outcome',history:'growth_lesson_outcome_history',cursor:'growth_lesson_outcome_cursor'} as const;
const targets={mission:'growth_mission',landing_revision:'growth_landing_revision',demand:'growth_demand',experiment:'growth_experiment'} as const;
type Target={id:string;brandId:string;campaignId:string;campaignVersion?:number;storeId?:string;version:number;status?:string;input?:{steps?:{performanceStatus?:string}[]};applied?:{method?:string}};
type Basis={state:'current'|'changed'|'pending'|'unavailable';reasons:string[];digest:string;observation:{kind:'operational'|'experiment';status:string;analysisId?:string}|null;lessonCausalStatus:'not_measured'};
export type LessonOutcome=Basis&{id:string;brandId:string;campaignId:string;version:number;collectedAt:string;lesson:{id:string;version:number;digest:string};target:{kind:string;id:string;version:number}};
const changed='교훈·대상의 정확한 판 또는 현재 근거가 바뀌었습니다.';
export async function lessonOutcomeHistory(who:Actor,c:Campaign){
 const page=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC,id DESC LIMIT 201').bind(who.owner,kinds.history,c.id).all<{data:string}>();
 return {rows:page.results.slice(0,200).map(r=>JSON.parse(r.data) as LessonOutcome).filter(r=>inCampaign(r,c)),hasMore:page.results.length>200};
}

async function outcomeReader(who:Actor,c:Campaign){
 const lessons=await campaignRows<LessonEvidenceRow>(who.owner,c,'growth_lesson',500);
 const evidence=new Map((await readGrowthLessonEvidence(who.owner,c,lessons)).map(x=>[x.id,x]));
 const cache=new Map<string,Promise<Target|null>>(),experiments=new Map<string,ReturnType<typeof readExperimentOutcomeBasis>>();
 return async(a:LessonApplicationRecord):Promise<Basis>=>{
  const lesson=evidence.get(a.input.lessonId),key=`${a.input.targetKind}:${a.input.targetId}`,kind=targets[a.input.targetKind];
  if(!cache.has(key))cache.set(key,optionalRecord<Target>(who.owner,kind,a.input.targetId));
  const target=await cache.get(key)!,valid=inCampaign(a,c)&&lesson?.version===a.input.lessonVersion&&lesson.reference.digest===a.lessonDigest&&lesson.assessment.canReuse&&target&&inCampaign(target,c)&&target.id===a.input.targetId&&target.version===a.input.targetVersion&&(target.storeId===undefined||target.storeId===c.storeId)&&(target.campaignVersion===undefined||target.campaignVersion===c.version);
  let state:Basis['state']=valid?'pending':'changed',observation:Basis['observation']=null,extra:unknown=null,reasons=valid?[]:[changed];
  if(valid&&a.input.targetKind==='experiment'){
   try{
    if(!experiments.has(target.id))experiments.set(target.id,readExperimentOutcomeBasis(who.owner,c,target.id));
    const result=await experiments.get(target.id)!;extra=result;
    if(result.current&&result.latest){state='current';observation={kind:'experiment',status:result.latest.status,analysisId:result.latest.id};}
    else if(result.latest){state='changed';reasons=['최신 분석과 현재 주문·관측 근거가 일치하지 않습니다.'];}
   }catch(e){state=e instanceof ApiError&&[400,404,409].includes(e.status)?'changed':'unavailable';reasons=['판매 실험의 현재 등록·관측 근거를 확인해야 합니다.'];}
  }else if(valid){
   const statuses=a.input.targetKind==='mission'?['draft','staged','unknown','failed','observed','cancelled']:['draft','approved','applied','rolled_back','withdrawn'];
   const status=a.input.targetKind==='demand'?(target.input?.steps?.length&&target.input.steps.every(s=>s.performanceStatus==='observed')?'observed':'not_measured'):statuses.includes(target.status??'')?target.status!:null;
   if(status){state='current';observation={kind:'operational',status};}
  }
  const digest=await storefrontDigest({campaign:{id:c.id,brandId:c.brandId,storeId:c.storeId??null,version:c.version,status:c.status},application:{input:a.input,lessonDigest:a.lessonDigest},lesson:lesson?{reference:lesson.reference,evidenceDigest:lesson.evidenceDigest,canReuse:lesson.assessment.canReuse}:null,target,extra,state,observation});
  return {state,reasons,digest,observation,lessonCausalStatus:'not_measured'};
 };
}

/** Last collected evidence is checked again on every read; a daily timestamp never makes old evidence current. */
export async function lessonOutcomeView(who:Actor,c:Campaign,applications:LessonApplicationRecord[]){
 const stored=await campaignRows<LessonOutcome>(who.owner,c,kinds.current,1000),read=await outcomeReader(who,c),result=new Map<string,LessonOutcome&{sourceStatus:'current'|'changed';sourceReasons:string[]}>();
 for(const a of applications){const old=stored.find(x=>x.id===a.id&&inCampaign(x,c));if(!old)continue;
  const live=await read(a),same=live.digest===old.digest;result.set(a.id,{...old,sourceStatus:same?'current':'changed',sourceReasons:same?live.reasons:[changed]});
 }
 return result;
}

/** One owner-locked bounded chunk. Existing evidence can invalidate/recover beyond soft intake caps. */
export async function collectGrowthLessonOutcomes(who:Actor,c:Campaign){
 if(who.role==='member')throw new ApiError(403,'관리자만 교훈 근거를 회수합니다.');
 const token=await acquireLock(who.owner);
 try{
  const current=await readRecord<Campaign>(who.owner,'campaign',c.id);
  if(current.version!==c.version||current.brandId!==c.brandId||current.storeId!==c.storeId)throw new ApiError(409,'캠페인이 변경되었습니다.');
  const apps=(await campaignRows<LessonApplicationRecord>(who.owner,c,'growth_lesson_application',1000)).filter(a=>inCampaign(a,c)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  if(!apps.length)return {collected:0,processed:0,remaining:false};
  const cursor=await optionalRecord<{after:string|null}>(who.owner,kinds.cursor,c.id),start=cursor?.after?apps.findIndex(a=>a.id>cursor.after!):0,index=start<0?0:start,chunk=apps.slice(index,index+20),remaining=index+chunk.length<apps.length;
  const read=await outcomeReader(who,c),stored=await campaignRows<LessonOutcome>(who.owner,c,kinds.current,1000);
  const history=await database().prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(who.owner,kinds.history,c.id).first<{n:number}>();
  const at=stamp(),writes:D1PreparedStatement[]=[];let collected=0;
  for(const a of chunk){
   const old=stored.find(x=>x.id===a.id&&inCampaign(x,c)),basis=await read(a);if(old?.digest===basis.digest)continue;
   if(!old&&((history?.n??0)+collected>=10000||stored.length+collected>=1000))continue;
   const next:LessonOutcome={...basis,id:a.id,brandId:c.brandId,campaignId:c.id,version:(old?.version??0)+1,collectedAt:at,lesson:{id:a.input.lessonId,version:a.input.lessonVersion,digest:a.lessonDigest},target:{kind:a.input.targetKind,id:a.input.targetId,version:a.input.targetVersion}};
   writes.push(recordStatement(who.owner,kinds.current,a.id,next,c.id),appendRow(who.owner,c,kinds.history,`${a.id}:${next.version}`,next,at));collected++;
  }
  writes.push(recordStatement(who.owner,kinds.cursor,c.id,{id:c.id,brandId:c.brandId,campaignId:c.id,after:remaining?chunk.at(-1)!.id:null},c.id));
  await database().batch(writes);return {collected,processed:chunk.length,remaining};
 }finally{await releaseLock(who.owner,token)}
}

import type {Artifact,Campaign} from './agency';
import type {GrowthLessonContext,GrowthLessonReference} from './growth-lesson-context';
import {readGrowthLessonEvidence,type LessonEvidenceRow} from './growth-lesson-evidence-server';
import {campaignRows,inCampaign} from './growth-ledger-server';
import {readGrowthStop} from './growth-stop-server';
import {storefrontDigest} from './storefront-orders';
const supported=new Set(['cmo','strategy','creative','content','growth','data','quality']);
async function snapshot(owner:string,c:Campaign){
 const rows=await campaignRows<LessonEvidenceRow>(owner,c,'growth_lesson',500);
 if(!rows.some(r=>inCampaign(r,c)))return {rows:[],running:true};
 const [evidence,stop]=await Promise.all([readGrowthLessonEvidence(owner,c,rows),readGrowthStop(owner)]);
 return {rows:evidence,running:stop.status==='running'};
}
type Snapshot=Awaited<ReturnType<typeof snapshot>>;
/** No operational workspace reads, writes or external calls are on this model path. */
export async function growthLessonContext(owner:string,c:Campaign,role:string):Promise<GrowthLessonContext|undefined>{
 if(!supported.has(role)||c.status==='archived')return;
 const state=await snapshot(owner,c);if(!state.running)return;
 const eligible=state.rows.filter(l=>l.assessment.canReuse&&l.input).sort((a,b)=>a.id.localeCompare(b.id));
 const selected:GrowthLessonContext['lessons']=[],references:GrowthLessonReference[]=[];
 for(const row of eligible){
  const input=row.input!,lesson={title:input.title,version:row.version,method:input.method,scope:input.scope,counterEvidence:input.counterEvidence,falsificationRule:input.falsificationRule,expiresAt:input.expiresAt,direction:input.outcome==='failure'?'avoid_or_retest' as const:'consider' as const};
  if(selected.length>=5||JSON.stringify([...selected,lesson]).length>8000)continue;
  selected.push(lesson);references.push(row.reference);
 }
 if(!selected.length)return;
 return {digest:await storefrontDigest({campaignId:c.id,campaignVersion:c.version,references}),references,lessons:selected};
}
function referenceState(c:Campaign,role:string,references:GrowthLessonReference[],state:Snapshot){
 return references.map(expected=>{const row=state.rows.find(r=>r.id===expected.id);return {expected,campaignVersion:c.version,current:row?{...row.reference,evidenceDigest:row.evidenceDigest,assessment:row.assessment}:null,allowed:state.running&&c.status!=='archived'&&supported.has(role)}});
}
const stale=(state:ReturnType<typeof referenceState>)=>state.some(s=>!s.allowed||!s.current?.assessment.canReuse||s.current.version!==s.expected.version||s.current.digest!==s.expected.digest);
export async function growthLessonSourcesChanged(owner:string,c:Campaign,role:string,references?:GrowthLessonReference[]){
 if(!references?.length)return false;
 return stale(referenceState(c,role,references,await snapshot(owner,c)));
}
async function reviewState(c:Campaign,a:Artifact,state:Snapshot){
 const refs=referenceState(c,a.role,a.growthLessonReferences??[],state),stateDigest=await storefrontDigest(refs);
 return {changed:stale(refs)&&a.growthLessonAcknowledgedState!==stateDigest,stateDigest};
}
export async function growthLessonReviewState(owner:string,c:Campaign,a:Artifact){
 if(!a.growthLessonReferences?.length)return {changed:false,stateDigest:''};
 return reviewState(c,a,await snapshot(owner,c));
}
export async function refreshGrowthLessonArtifacts(owner:string,campaigns:Campaign[],artifacts:Artifact[]){
 const snapshots=new Map<string,Promise<Snapshot>>();
 return Promise.all(artifacts.map(async a=>{
  if(!a.growthLessonReferences?.length)return a;
  const c=campaigns.find(c=>c.id===a.campaignId);if(!c)return {...a,growthLessonsChanged:true};
  if(!snapshots.has(c.id))snapshots.set(c.id,snapshot(owner,c));
  return {...a,growthLessonsChanged:(await reviewState(c,a,await snapshots.get(c.id)!)).changed};
 }));
}

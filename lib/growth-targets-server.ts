import type {Campaign} from './agency';
import {growthBusiness} from './growth-business-server';
import {parseTargetInput,parseReviewInput,targetAssessment,targetReviewAssessment,type TargetInput,type ReviewInput} from './growth-targets';
import {parseDecisionInput} from './growth-decisions';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,str,type Actor} from './server';
const kinds={target:'growth_target',history:'growth_target_history',review:'growth_target_review',request:'growth_target_request'} as const;
export type TargetRecord={id:string;brandId:string;campaignId:string;campaignVersion:number;version:number;input:TargetInput;createdAt:string;updatedAt:string};
type DecisionRef={id:string;version:number;input:{title:string}};
export type TargetReviewRecord={id:string;brandId:string;campaignId:string;campaignVersion:number;targetId:string;targetVersion:number;input:ReviewInput;snapshot:{target:TargetRecord;storeId:string|null;business:Awaited<ReturnType<typeof growthBusiness>>;decision:DecisionRef|null};snapshotDigest:string;assessment:ReturnType<typeof targetReviewAssessment>;createdAt:string};
type RequestRecord={id:string;brandId:string;campaignId:string;digest:string;resultId:string};
function scope<T extends {brandId:string;campaignId:string}>(row:T,c:Campaign){if(row.brandId!==c.brandId||row.campaignId!==c.id)throw new ApiError(404,'현재 캠페인의 목표·리뷰가 아닙니다.');return row}
function append(owner:string,kind:string,id:string,data:unknown,parent:string){return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),stamp())}
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
async function records<T extends {brandId:string;campaignId:string}>(owner:string,c:Campaign,kind:string,limit=500){
 const result=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC LIMIT ?').bind(owner,kind,c.id,limit+1).all<{data:string}>();
 if(result.results.length>limit)throw new ApiError(409,'목표·리뷰 기록 한도를 넘었습니다. 전체 대사가 필요합니다.');
 return result.results.map(r=>scope(JSON.parse(r.data) as T,c));
}
async function capacity(owner:string,c:Campaign,kind:string,max:number){const r=await database().prepare('SELECT COUNT(*) AS n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(owner,kind,c.id).first<{n:number}>();if((r?.n??0)>=max)throw new ApiError(409,'캠페인 기록 한도에 도달했습니다.')}
async function decisionChoices(who:Actor,c:Campaign){const rows=await records<{brandId:string;campaignId:string;id:string;version:number;input:unknown}>(who.owner,c,'growth_decision');return rows.map(r=>({id:r.id,version:r.version,input:{title:parseDecisionInput(r.input).title}}))}
export async function growthTargetsView(who:Actor,c:Campaign){
 const [targets,targetHistory,reviews,decisions]=await Promise.all([records<TargetRecord>(who.owner,c,kinds.target,100),records<TargetRecord>(who.owner,c,kinds.history,1000),records<TargetReviewRecord>(who.owner,c,kinds.review),decisionChoices(who,c)]);
 return {targets:targets.map(t=>({...t,assessment:{...targetAssessment(t.input),missing:[...targetAssessment(t.input).missing,...(t.campaignVersion!==c.version?['캠페인 변경 후 목표 재검토']:[])]}})),targetHistory,reviews:reviews.map(r=>({...r,currentTargetChanged:!targets.some(t=>t.id===r.targetId&&t.version===r.targetVersion&&t.campaignVersion===c.version)})),decisions,campaignVersion:c.version,canEdit:c.status!=='archived',mayExecute:false as const};
}
export type TargetsView=Awaited<ReturnType<typeof growthTargetsView>>;
export async function compareTargetReview(who:Actor,c:Campaign,id:string){
 const row=scope(await readRecord<TargetReviewRecord>(who.owner,kinds.review,identifier(id)),c);
 const input=parseTargetInput(row.snapshot.target.input),currentBusiness=await growthBusiness(who.owner,c,{from:input.from,to:input.to});
 const current=await optional<TargetRecord>(who.owner,kinds.target,row.targetId);
 const scopeChanged=row.campaignVersion!==c.version||row.snapshot.storeId!==(c.storeId??null);
 const comparisonStatus=currentBusiness.status==='ledger_only'&&row.snapshot.business.status==='ledger_only'?'comparable':'unavailable';
 const currentBusinessChanged=scopeChanged?true:comparisonStatus==='unavailable'?null:await storefrontDigest(currentBusiness)!==await storefrontDigest(row.snapshot.business);
 return {reviewId:row.id,comparisonStatus,currentBusinessChanged,scopeChanged,checkedAt:stamp(),currentBusiness,currentTargetChanged:!current||current.version!==row.targetVersion||current.campaignVersion!==c.version};
}
function identifier(v:unknown){const id=str(v,'기록 ID',100,true);if(!/^[A-Za-z0-9_-]+$/.test(id))throw new ApiError(400,'기록 ID 형식을 확인하세요.');return id}
function requestId(v:unknown){if(typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))throw new ApiError(400,'요청 UUID를 확인하세요.');return v.toLowerCase()}
async function saveTarget(who:Actor,c:Campaign,b:Record<string,unknown>,id:string){
 const input=parseTargetInput(b.input),old=await optional<TargetRecord>(who.owner,kinds.target,id);if(old)scope(old,c);
 if(b.expectedVersion!==(old?.version??0))throw new ApiError(409,'목표가 변경되었습니다. 최신 판과 비교하세요.');
 if(old&&!input.changeReason)throw new ApiError(400,'목표 변경 이유를 입력하세요.');
 if(!old)await capacity(who.owner,c,kinds.target,100);await capacity(who.owner,c,kinds.history,1000);
 const at=stamp(),row:TargetRecord={id,brandId:c.brandId,campaignId:c.id,campaignVersion:c.version,version:(old?.version??0)+1,input,createdAt:old?.createdAt??at,updatedAt:at};
 return [old?recordStatement(who.owner,kinds.target,id,row,c.id):append(who.owner,kinds.target,id,row,c.id),append(who.owner,kinds.history,crypto.randomUUID(),row,c.id)];
}
async function decisionSnapshot(who:Actor,c:Campaign,input:ReviewInput):Promise<DecisionRef|null>{
 if(!input.decisionId)return null;
 const row=scope(await readRecord<{id:string;brandId:string;campaignId:string;campaignVersion:number;version:number;input:unknown}>(who.owner,'growth_decision',input.decisionId),c);
 if(row.version!==input.decisionVersion||row.campaignVersion!==c.version)throw new ApiError(409,'결정이 변경되었습니다. 최신 판을 선택하세요.');
 return {id:row.id,version:row.version,input:{title:parseDecisionInput(row.input).title}};
}
async function captureReview(who:Actor,c:Campaign,b:Record<string,unknown>,id:string){
 if(b.expectedVersion!==0||await optional(who.owner,kinds.review,id))throw new ApiError(409,'리뷰는 변경할 수 없습니다. 새 리뷰로 기록하세요.');
 const target=scope(await readRecord<TargetRecord>(who.owner,kinds.target,identifier(b.targetId)),c);
 if(target.version!==b.targetVersion||target.campaignVersion!==c.version)throw new ApiError(409,'목표·캠페인이 변경되었습니다. 현재 판을 선택하세요.');
 const input=parseReviewInput(b.input),targetInput=parseTargetInput(target.input);
 const [business,decision]=await Promise.all([growthBusiness(who.owner,c,{from:targetInput.from,to:targetInput.to}),decisionSnapshot(who,c,input)]);
 await capacity(who.owner,c,kinds.review,500);
 const snapshot={target:{...target,input:targetInput},storeId:c.storeId??null,business,decision};
 const row:TargetReviewRecord={id,brandId:c.brandId,campaignId:c.id,campaignVersion:c.version,targetId:target.id,targetVersion:target.version,input,snapshot,snapshotDigest:await storefrontDigest(snapshot),assessment:targetReviewAssessment(targetInput,business),createdAt:stamp()};
 return [append(who.owner,kinds.review,id,row,c.id)];
}
export async function saveGrowthTarget(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(b.action!=='save_target'&&b.action!=='capture_review')throw new ApiError(400,'지원하지 않는 목표 작업입니다.');
 if(c.status==='archived')throw new ApiError(409,'보관한 캠페인은 수정할 수 없습니다.');
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다.');
 const req=requestId(b.requestId),id=identifier(b.id),digest=await storefrontDigest(b),previous=await optional<RequestRecord>(who.owner,kinds.request,req);
 if(previous){scope(previous,c);if(previous.digest!==digest)throw new ApiError(409,'동일 요청 ID의 내용이 변경되었습니다.');return {...await growthTargetsView(who,c),duplicate:true,resultId:previous.resultId};}
 await capacity(who.owner,c,kinds.request,5000);
 // Ensure bounded reads can succeed before any write; all writes below share one batch.
 await growthTargetsView(who,c);
 const statements=b.action==='save_target'?await saveTarget(who,c,b,id):await captureReview(who,c,b,id);
 statements.push(append(who.owner,kinds.request,req,{id:req,brandId:c.brandId,campaignId:c.id,digest,resultId:id},c.id));
 await database().batch(statements);
 return {...await growthTargetsView(who,c),resultId:id};
}

import type {Campaign} from './agency';
import {parseDemandInput,demandReadiness,type DemandInput} from './growth-demand';
import {growthView} from './growth-workspace-server';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,str,type Actor} from './server';
export type DemandRecord={id:string;brandId:string;campaignId:string;campaignVersion:number;version:number;input:DemandInput;requestDigest:string;createdAt:string;updatedAt:string;updatedBy:string};
type Workspace=Awaited<ReturnType<typeof growthView>>;
function scope(row:DemandRecord,c:Campaign){if(row.campaignId!==c.id||row.brandId!==c.brandId)throw new ApiError(404,'현재 캠페인의 수요 시퀀스를 찾지 못했습니다.');return row}
async function records(owner:string,c:Campaign){
 const data=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='growth_demand' AND parent_id=? ORDER BY updated_at DESC LIMIT 501").bind(owner,c.id).all<{data:string}>();
 if(data.results.length>500)throw new ApiError(409,'수요 시퀀스 한도를 넘었습니다. 전체 기록을 대사하세요.');
 return data.results.map(row=>scope(JSON.parse(row.data) as DemandRecord,c));
}
function references(input:DemandInput,view:Workspace){return {offer:view.offers.find(r=>r.id===input.offerId),mission:view.missions.find(r=>r.id===input.missionId)}}
function readiness(row:DemandRecord,c:Campaign,view:Workspace){
 const {offer,mission}=references(row.input,view),upstream:string[]=[];
 if(row.campaignVersion!==c.version)upstream.push('캠페인 변경 후 시퀀스 재검토');
 if(!offer)upstream.push('판매 오퍼 연결');else{upstream.push(...offer.readiness.missing);if(offer.version!==row.input.offerVersion)upstream.push('오퍼 변경 후 시퀀스 재검토');}
 if(!mission)upstream.push('판매 미션 연결');else{
  upstream.push(...mission.readiness.missing);
  if(mission.version!==row.input.missionVersion)upstream.push('미션 변경 후 시퀀스 재검토');
  if(mission.input.offerId!==row.input.offerId||mission.input.offerVersion!==row.input.offerVersion)upstream.push('미션과 시퀀스의 오퍼 일치 확인');
  if(['unknown','failed','cancelled'].includes(mission.status??''))upstream.push('미션 결과·중단 상태 확인');
  const knownCost=row.input.steps.reduce((sum,step)=>sum+(step.plannedCost??0),0);
  if(mission.input.budget!==null&&knownCost>mission.input.budget)upstream.push('수요 시퀀스 계획 비용이 미션 예산을 초과합니다.');
 }
 return demandReadiness(row.input,upstream);
}
export async function growthDemandView(who:Actor,c:Campaign){
 const [sequences,view]=await Promise.all([records(who.owner,c),growthView(who.owner,c,who.role!=='member')]);
 return {sequences:sequences.map(row=>({...row,readiness:readiness(row,c,view)})),offers:view.offers,missions:view.missions,campaignVersion:c.version,canEdit:who.role!=='member'&&c.status!=='archived',mayExecute:false as const};
}
async function existing(owner:string,id:string){try{return await readRecord<DemandRecord>(owner,'growth_demand',id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
function checkReferences(input:DemandInput,view:Workspace){
 const {offer,mission}=references(input,view);
 if(input.offerId&&!offer)throw new ApiError(404,'현재 캠페인의 오퍼를 선택하세요.');
 if(input.missionId&&!mission)throw new ApiError(404,'현재 캠페인의 미션을 선택하세요.');
 if(offer&&offer.version!==input.offerVersion)throw new ApiError(409,'오퍼가 변경되었습니다. 최신 판을 선택하세요.');
 if(mission&&mission.version!==input.missionVersion)throw new ApiError(409,'미션이 변경되었습니다. 최신 판을 선택하세요.');
 if(mission&&(mission.input.offerId!==input.offerId||mission.input.offerVersion!==input.offerVersion))throw new ApiError(409,'미션에 연결된 같은 오퍼와 판을 선택하세요.');
}
export async function saveGrowthDemand(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(c.status==='archived')throw new ApiError(409,'보관한 캠페인은 변경할 수 없습니다.');
 if(b.action!=='save_sequence')throw new ApiError(400,'지원하지 않는 수요 시퀀스 작업입니다.');
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다.');
 const id=str(b.id,'시퀀스 ID',100,true);if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new ApiError(400,'시퀀스 ID 형식을 확인하세요.');
 const input=parseDemandInput(b.input),old=await existing(who.owner,id);if(old)scope(old,c);
 const digest=await storefrontDigest({input,expectedVersion:b.expectedVersion,campaignVersion:c.version});
 if(old?.requestDigest===digest)return {...await growthDemandView(who,c),duplicate:true};
 if(b.expectedVersion!==(old?.version??0))throw new ApiError(409,'수요 시퀀스가 변경되었습니다. 입력을 보존하고 최신 판과 비교하세요.');
 const [all,view]=await Promise.all([records(who.owner,c),growthView(who.owner,c,true)]);
 if(!old&&all.length>=500)throw new ApiError(409,'캠페인별 수요 시퀀스는 500개까지 저장할 수 있습니다.');
 checkReferences(input,view);
 const at=stamp(),row:DemandRecord={id,brandId:c.brandId,campaignId:c.id,campaignVersion:c.version,version:(old?.version??0)+1,input,requestDigest:digest,createdAt:old?.createdAt??at,updatedAt:at,updatedBy:who.id};
 const historyId=`${id}:v${row.version}`,history=database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${who.owner}:growth_demand_history:${historyId}`,who.owner,'growth_demand_history',c.id,JSON.stringify({...row,id:historyId,sequenceId:id}),at);
 await database().batch([recordStatement(who.owner,'growth_demand',id,row,c.id),history]);
 return {...await growthDemandView(who,c),duplicate:false};
}

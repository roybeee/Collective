import type {Campaign} from '@/lib/agency';
import {metaSyncErrors,type MetaSyncState} from '@/lib/meta-sync-state';
import {ImportError} from '@/lib/order-import';
import {MetaInsightError,metaAttributions,metaId,metaWindow,parseMetaInsightImport,summarizeMetaInsights,type MetaAttribution,type MetaInsightReport} from '@/lib/meta-insights';
import {collectMetaRead,MetaReadError} from '@/lib/meta-insights-provider';
import {metaConnectionId,metaReadToken,prepareMetaConnection,publicMetaConnection,readMetaConnection,type MetaReadConnection} from '@/lib/meta-read-connection';
import {ApiError,acquireLock,actor,body,database,eventStatement,failure,json,listRecords,readRecord,recordStatement,releaseLock,requireAdminActor,secureMutation,stamp,str} from '@/lib/server';
async function report(owner:string,id:string){try{return await readRecord<MetaInsightReport>(owner,'meta_ads_insights',id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
async function syncState(owner:string,id:string){try{return await readRecord<MetaSyncState>(owner,'meta_ads_sync_state',id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
const view=async(owner:string,r:MetaInsightReport|null,c:Campaign,canEdit:boolean)=>({syncState:await syncState(owner,c.id),report:r,summary:r?summarizeMetaInsights(r.rows):null,version:r?.version??0,campaignVersion:c.version,canEdit,stale:!!r&&(r.brandId!==c.brandId||r.campaignVersion!==c.version)});
export async function GET(req:Request){try{const who=await actor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json({...await view(who.owner,await report(who.owner,c.id),c,who.role!=='member'),connection:publicMetaConnection(await readMetaConnection(who.owner,c.brandId))})}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{
 const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);
 if(!['import','connect','disconnect','sync'].includes(String(b.action)))throw new ApiError(400,'지원하지 않는 성과 작업입니다.');
 owner=who.owner;lock=await acquireLock(owner);
 const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true)),old=await report(owner,c.id);
 if(c.status==='archived'||b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었거나 보관되었습니다. 최신 화면을 불러오세요.');
 const connection=await readMetaConnection(owner,c.brandId);
 if(b.action==='connect'||b.action==='disconnect'){
  if(b.connectionVersion!==(connection?.version??0))throw new ApiError(409,'연결이 변경되었습니다. 최신 화면을 불러오세요.');
  if(b.action==='disconnect'){
   await database().batch([database().prepare("DELETE FROM records WHERE owner=? AND kind='channel_credential' AND id=?").bind(owner,`${owner}:channel_credential:${metaConnectionId(c.brandId)}`),eventStatement(owner,c.id,'Meta 읽기 연결 해제',{id:who.id,email:who.email})]);
   return json({...await view(owner,old,c,true),connection:null});
  }
  if(b.readEnabled!==true)throw new ApiError(400,'광고 성과 읽기를 명시적으로 허용하세요.');
  const accountId=metaId(b.accountId,'광고 계정');
  if((await listRecords<MetaReadConnection>(owner,'channel_credential')).some(x=>x.channel==='meta_ads'&&x.accountId===accountId&&x.brandId!==c.brandId))throw new ApiError(409,'다른 브랜드에 연결된 광고 계정입니다. 해당 연결을 먼저 확인하세요.');
  const saved=await prepareMetaConnection(owner,c.brandId,accountId,b.token,(connection?.version??0)+1);
  await database().batch([recordStatement(owner,'channel_credential',metaConnectionId(c.brandId),saved),eventStatement(owner,c.id,'Meta 광고 계정 읽기 연결 확인',{id:who.id,email:who.email})]);
  return json({...await view(owner,old,c,true),connection:publicMetaConnection(saved)});
 }
 let input,nextSync:MetaSyncState|null=null;
 if(b.action==='sync'){
  if(!connection?.readEnabled)throw new ApiError(409,'이 브랜드의 광고 계정을 먼저 연결하세요.');
  if(b.accountId!==connection.accountId)throw new ApiError(409,'연결된 광고 계정과 입력이 다릅니다.');
  if(!metaAttributions.includes(b.attribution as MetaAttribution))throw new ApiError(400,'전환 인정 기간을 선택하세요.');
  if(b.expectedVersion!==(old?.version??0))throw new ApiError(409,'최신 성과를 불러온 뒤 수집하세요.');
  const scope={...metaWindow(b),accountId:connection.accountId,externalCampaignId:metaId(b.externalCampaignId,'Meta 캠페인'),attribution:b.attribution as MetaAttribution},previous=await syncState(owner,c.id),now=stamp();
  const attempt:MetaSyncState={...scope,id:c.id,campaignId:c.id,brandId:c.brandId,attemptedAt:now,finishedAt:null,lastSucceededAt:previous?.accountId===scope.accountId&&previous.externalCampaignId===scope.externalCampaignId&&previous.since===scope.since&&previous.until===scope.until&&previous.attribution===scope.attribution?previous.lastSucceededAt:null,status:'running',errorCode:null,version:(previous?.version??0)+1};
  await recordStatement(owner,'meta_ads_sync_state',c.id,attempt,c.id).run();
  try{input=await collectMetaRead(await metaReadToken(owner,connection),scope);const finishedAt=stamp();nextSync={...attempt,finishedAt,lastSucceededAt:finishedAt,status:'succeeded'}}catch(e){const code=e instanceof MetaReadError?e.code:e instanceof MetaInsightError?'format':'unavailable';await recordStatement(owner,'meta_ads_sync_state',c.id,{...attempt,finishedAt:stamp(),status:'failed',errorCode:code},c.id).run();throw new MetaReadError(code,metaSyncErrors[code])}
 }else input=parseMetaInsightImport(b);
 const source=b.action==='sync'?'meta_api':'manual';
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({source,...input}))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 if(source==='manual'&&old?.digest===digest&&old.brandId===c.brandId&&old.campaignVersion===c.version)return json({...await view(owner,old,c,true),connection:publicMetaConnection(connection),unchanged:true});
 if(b.expectedVersion!==(old?.version??0))throw new ApiError(409,'다른 성과가 저장되었습니다. 최신 화면을 불러온 뒤 다시 확인하세요.');
 const saved:MetaInsightReport={...input,id:c.id,campaignId:c.id,brandId:c.brandId,campaignVersion:c.version,version:(old?.version??0)+1,source,collectedAt:stamp(),updatedBy:who.id,digest};
 await database().batch([recordStatement(owner,'meta_ads_insights',c.id,saved,c.id),...(nextSync?[recordStatement(owner,'meta_ads_sync_state',c.id,nextSync,c.id)]:[]),eventStatement(owner,c.id,`Meta 성과 ${source==='manual'?'수동 가져오기':'읽기 수집'} v${saved.version} · ${saved.rows.length}행 · 실제 주문 매출 미검증`,{id:who.id,email:who.email})]);
 return json({...await view(owner,saved,c,true),connection:publicMetaConnection(connection)});
 }catch(e){return failure(e instanceof MetaReadError?new ApiError(e.code==='rate_limit'?429:502,e.message):e instanceof MetaInsightError||e instanceof ImportError?new ApiError(400,e.message):e)}finally{if(lock)await releaseLock(owner,lock)}}

import type {Campaign} from '@/lib/agency';
import {readMetaConnection,metaReadToken} from '@/lib/meta-read-connection';
import {listMetaCampaigns,MetaReadError} from '@/lib/meta-insights-provider';
import {ApiError,body,failure,json,readRecord,requireAdminActor,secureMutation,str} from '@/lib/server';
export async function POST(req:Request) {
 try {
  const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);
  if(b.action!=='browse')throw new ApiError(400,'캠페인 목록 조회만 지원합니다.');
  const c=await readRecord<Campaign>(who.owner,'campaign',str(b.campaignId,'캠페인',100,true)),connection=await readMetaConnection(who.owner,c.brandId);
  if(c.status==='archived'||!connection||b.connectionVersion!==connection.version||b.connectionUpdatedAt!==connection.updatedAt)throw new ApiError(409,'현재 브랜드의 읽기 연결과 캠페인을 다시 확인하세요.');
  const result=await listMetaCampaigns(await metaReadToken(who.owner,connection),connection.accountId,b.cursor??'');
  const [current,latest]=await Promise.all([readMetaConnection(who.owner,c.brandId),readRecord<Campaign>(who.owner,'campaign',c.id)]);
  if(!current||current.version!==connection.version||current.updatedAt!==connection.updatedAt||current.accountId!==connection.accountId||latest.version!==c.version||latest.brandId!==c.brandId||latest.status==='archived')throw new ApiError(409,'조회 중 연결 또는 캠페인이 변경되었습니다. 다시 불러오세요.');
  return json({...result,connectionVersion:connection.version,connectionUpdatedAt:connection.updatedAt,collectedAt:new Date().toISOString()});
 }catch(e){return failure(e instanceof MetaReadError?new ApiError(502,e.message):e);}
}

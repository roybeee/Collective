import type {Campaign} from './agency';
import {createGrowthProviderClient,GROWTH_PROVIDER_PRODUCT_ID} from './growth-provider';
import {openRecordSecret,sealRecordSecret} from './credential-crypto-server';
import {requireGrowthRunning} from './growth-stop-server';
import {scanText} from './pii-scan';
import {ApiError,database,readRecord,recordStatement,stamp,type Actor} from './server';
export type LandingProviderConnection={channel:'growth_landing_provider';id:string;brandId:string;storeId:string;baseUrl:string;tenantId:string;providerStoreId:string;secret:string;enabled:boolean;version:number;installationEvidenceRef:string;updatedAt:string;updatedBy:string};
export const landingProviderConnectionId=(storeId:string)=>'growth_landing_provider:'+storeId;
export function providerIdentifier(value:unknown){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value)||scanText(value).length)throw new ApiError(400,'판매처 내부 식별자를 확인하세요.');return value;}
export function providerProductIdentifier(value:unknown){if(typeof value!=='string'||!GROWTH_PROVIDER_PRODUCT_ID.test(value)||scanText(value).length)throw new ApiError(400,'판매처 상품 식별자를 확인하세요.');return value;}
export async function readLandingProviderConnection(owner:string,c:Campaign){
 if(!c.storeId)return null;
 let row:LandingProviderConnection;try{row=await readRecord(owner,'channel_credential',landingProviderConnectionId(c.storeId))}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}
 if(row.channel!=='growth_landing_provider'||row.brandId!==c.brandId||row.storeId!==c.storeId)throw new ApiError(409,'판매처 연결 범위를 확인하세요.');return row;
}
export function landingProviderConnectionView(row:LandingProviderConnection|null){
 if(!row)return null;
 return {id:row.id,baseUrl:row.baseUrl,tenantId:row.tenantId,providerStoreId:row.providerStoreId,storeId:row.storeId,enabled:row.enabled,version:row.version,installationEvidenceRef:row.installationEvidenceRef,updatedAt:row.updatedAt,accountId:'mapdal:'+row.storeId,channel:'storefront',credentialConfigured:true};
}
export async function landingProviderClient(owner:string,row:LandingProviderConnection){
 const secret=await openRecordSecret(owner,'channel_credential',row.id,row.secret);
 return createGrowthProviderClient({baseUrl:row.baseUrl,tenantId:row.tenantId,storeId:row.providerStoreId,secret});
}
export async function saveLandingProviderConnection(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(who.role!=='owner')throw new ApiError(403,'판매처 변경 연결은 소유자만 설정합니다.');
 if(!c.storeId||c.status==='archived')throw new ApiError(409,'운영 캠페인의 지점이 필요합니다.');
 const store=await readRecord<{brandId:string;status:string}>(who.owner,'store',c.storeId);if(store.brandId!==c.brandId||store.status!=='active')throw new ApiError(409,'운영 지점 범위를 확인하세요.');
 const old=await readLandingProviderConnection(who.owner,c);if(b.expectedVersion!==(old?.version??0))throw new ApiError(409,'연결 설정이 변경되었습니다. 다시 불러오세요.');
 const id=landingProviderConnectionId(c.storeId),at=stamp();let next:LandingProviderConnection;
 if(b.action==='provider_configure'){
  const pending=await database().prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='growth_landing_revision' AND json_extract(data,'$.provider.binding.storeId')=? AND json_extract(data,'$.provider.attempt.status')='unknown'").bind(who.owner,c.storeId).first<{n:number}>();
  if(pending?.n)throw new ApiError(409,'결과불명 요청을 먼저 대사한 뒤 연결을 변경하세요.');
  const v=b.input as Record<string,unknown>|undefined;if(!v||typeof v!=='object'||Array.isArray(v))throw new ApiError(400,'연결 입력을 확인하세요.');
  const baseUrl=String(v.baseUrl??''),tenantId=providerIdentifier(v.tenantId),providerStoreId=providerIdentifier(v.providerStoreId);
  const secret=v.secret===undefined||v.secret===''?old?await openRecordSecret(who.owner,'channel_credential',id,old.secret):'':String(v.secret);
  try{createGrowthProviderClient({baseUrl,tenantId,storeId:providerStoreId,secret})}catch{throw new ApiError(400,'허용된 MAPDAL 주소와 32바이트 이상의 서명키를 확인하세요.');}
  next={channel:'growth_landing_provider',id,brandId:c.brandId,storeId:c.storeId,baseUrl:new URL(baseUrl).origin,tenantId,providerStoreId,secret:await sealRecordSecret(who.owner,'channel_credential',id,secret),enabled:false,version:(old?.version??0)+1,installationEvidenceRef:'',updatedAt:at,updatedBy:who.id};
 }else{
  if(!old)throw new ApiError(404,'판매처 연결을 먼저 저장하세요.');
  const enable=b.action==='provider_enable';if(!enable&&b.action!=='provider_disable')throw new ApiError(400,'지원하지 않는 연결 작업입니다.');
  if(enable){await requireGrowthRunning(who.owner);if(b.installed!==true)throw new ApiError(400,'실제 상품 저장소 어댑터 설치 확인이 필요합니다.');}
  next={...old,enabled:enable,installationEvidenceRef:enable?providerIdentifier(b.evidenceRef):old.installationEvidenceRef,version:old.version+1,updatedAt:at,updatedBy:who.id};
 }
 await recordStatement(who.owner,'channel_credential',id,next).run();return {recorded:true as const,version:next.version,providerConnection:landingProviderConnectionView(next)};
}

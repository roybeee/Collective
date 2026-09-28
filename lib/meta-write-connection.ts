import {openRecordSecret,sealRecordSecret} from './credential-crypto-server';
import {ApiError,readRecord,stamp} from './server';
import {readBoundedJson} from './http-limits';
import {metaId} from './meta-insights';
import {META_READ_API_VERSION,verifyMetaRead} from './meta-insights-provider';
import {readMetaConnection} from './meta-read-connection';
export type MetaWriteConnection={channel:'meta_ads_write';brandId:string;accountId:string;secret:string;updatedAt:string;version:number;permission:'ads_management'};
export const metaWriteConnectionId=(brandId:string)=>'meta_ads_write:'+brandId;
export async function readMetaWriteConnection(owner:string,brandId:string){try{return await readRecord<MetaWriteConnection>(owner,'channel_credential',metaWriteConnectionId(brandId))}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
export const publicMetaWriteConnection=(c:MetaWriteConnection|null)=>c?{accountId:c.accountId,brandId:c.brandId,updatedAt:c.updatedAt,version:c.version}:null;
export async function prepareMetaWriteConnection(owner:string,brandId:string,account:unknown,token:unknown,version:number){
 await readRecord(owner,'brand',brandId);const accountId=metaId(account,'광고 계정'),reading=await readMetaConnection(owner,brandId);
 if(!reading?.readEnabled||reading.accountId!==accountId)throw new ApiError(409,'같은 브랜드·광고 계정의 읽기 연결을 먼저 확인하세요.');
 if(typeof token!=='string'||token.length<10||token.length>4096||!/^[A-Za-z0-9_.|\-]+$/.test(token))throw new ApiError(400,'별도 Meta 쓰기 권한 토큰을 확인하세요.');
 const secret=await sealRecordSecret(owner,'channel_credential',metaWriteConnectionId(brandId),token);
 await verifyMetaRead(token,accountId);
 try{const response=await fetch(`https://graph.facebook.com/${META_READ_API_VERSION}/me/permissions`,{method:'GET',redirect:'manual',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)}),value=await readBoundedJson<{data?:{permission?:string;status?:string}[]}>(response,100000);if(!response.ok||!Array.isArray(value.data)||!value.data.some(x=>x.permission==='ads_management'&&x.status==='granted'))throw new Error()}catch{throw new ApiError(409,'ads_management 쓰기 권한을 확인하지 못했습니다. 확인 가능한 별도 토큰이 필요합니다. 기존 읽기 연결은 유지됩니다.')}
 return {channel:'meta_ads_write' as const,brandId,accountId,secret,updatedAt:stamp(),version,permission:'ads_management' as const};
}
export async function metaWriteToken(owner:string,c:MetaWriteConnection){return openRecordSecret(owner,'channel_credential',metaWriteConnectionId(c.brandId),c.secret)}

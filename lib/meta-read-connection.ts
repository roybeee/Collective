import {openRecordSecret,sealRecordSecret} from './credential-crypto-server';
import {ApiError,readRecord,stamp} from './server';
import {metaId} from './meta-insights';
import {verifyMetaRead} from './meta-insights-provider';
export type MetaReadConnection={channel:'meta_ads';brandId:string;accountId:string;secret:string;updatedAt:string;readEnabled:true;version:number};
export const metaConnectionId=(brandId:string)=>'meta_ads:'+brandId;
export async function readMetaConnection(owner:string,brandId:string){try{return await readRecord<MetaReadConnection>(owner,'channel_credential',metaConnectionId(brandId))}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
export const publicMetaConnection=(c:MetaReadConnection|null)=>c?{accountId:c.accountId,brandId:c.brandId,updatedAt:c.updatedAt,readEnabled:c.readEnabled,version:c.version}:null;
export async function prepareMetaConnection(owner:string,brandId:string,account:unknown,token:unknown,version:number){
 await readRecord(owner,'brand',brandId);const accountId=metaId(account,'광고 계정');
 if(typeof token!=='string'||token.length<10||token.length>4096||!/^[A-Za-z0-9_.|\-]+$/.test(token))throw new ApiError(400,'Meta 읽기 권한 토큰을 확인하세요.');
 const secret=await sealRecordSecret(owner,'channel_credential',metaConnectionId(brandId),token);
 await verifyMetaRead(token,accountId);
 return {channel:'meta_ads' as const,brandId,accountId,secret,updatedAt:stamp(),readEnabled:true as const,version};
}
export async function metaReadToken(owner:string,c:MetaReadConnection){return openRecordSecret(owner,'channel_credential',metaConnectionId(c.brandId),c.secret)}

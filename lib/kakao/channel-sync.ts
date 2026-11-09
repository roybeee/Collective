// C6 카카오톡 채널 친구 관계 동기화(ADDED·BLOCKED·NONE). 카카오톡 채널 API '채널 관계 확인하기'(GET https://kapi.kakao.com/v1/api/talk/channels, Authorization: KakaoAK {adminKey})를 가정한다.
// 공개 API로는 메시지를 보낼 수 없고 관계 조회·고객 파일 업로드만 된다. 조회 키는 카카오 앱 사용자 id이며 레코드에는 수신자 해시와 관계만 남긴다(사용자 id·번호는 저장하지 않는다).
// 테스트는 client를 주입한다(mocked). 결과를 모르면 'unknown'으로 두고 기존 레코드를 덮어쓰지 않는다.
import {ApiError,database,stamp,type Actor} from '../server';
import {CONSENT_CHANNEL,consentRecordId,isRecipientHash,type FriendRelation,type FriendRelationRecord} from './consent';
import {friendRelationStatement,requireBrand} from './consent-server';

export const KAKAO_CHANNEL_API='https://kapi.kakao.com/v1/api/talk/channels';
export const FRIEND_SYNC_MAX=500;
export type FriendRelationClient={relation(appUserId:string):Promise<FriendRelation|'unknown'>};
type FetchFn=(input:string,init:RequestInit)=>Promise<Response>;
const RELATIONS:readonly FriendRelation[]=['ADDED','BLOCKED','NONE'];
export const isFriendRelation=(v:unknown):v is FriendRelation=>typeof v==='string'&&(RELATIONS as readonly string[]).includes(v);

// Admin 키 클라이언트(참고 구현). 응답 {channels:[{channel_public_id, relation}]}에서 이 채널의 relation을 읽는다. 비2xx·형식 불일치는 unknown이다.
export function kakaoChannelClient(input:{adminKey:string;channelPublicId:string;fetch?:FetchFn}):FriendRelationClient{
 const fetchFn=input.fetch??((u:string,i:RequestInit)=>fetch(u,i));
 return {
  async relation(appUserId){
   try{
    const url=`${KAKAO_CHANNEL_API}?target_id_type=user_id&target_id=${encodeURIComponent(appUserId)}&channel_public_ids=${encodeURIComponent(input.channelPublicId)}`;
    const res=await fetchFn(url,{method:'GET',headers:{Authorization:`KakaoAK ${input.adminKey}`}});
    if(res.status<200||res.status>=300)return 'unknown';
    const body=await res.json() as {channels?:{channel_public_id?:string;relation?:string}[]};
    const hit=(body.channels??[]).find(c=>c.channel_public_id===input.channelPublicId);
    return hit&&isFriendRelation(hit.relation)?hit.relation:'unknown';
   }catch{return 'unknown'}
  },
 };
}
export type FriendSyncPair={recipientHash:string;appUserId:string};
export function parseFriendPairs(value:unknown):FriendSyncPair[]{
 if(!Array.isArray(value)||!value.length)throw new ApiError(400,'동기화할 수신자 목록(recipientHash, appUserId)을 넣어 주세요.');
 if(value.length>FRIEND_SYNC_MAX)throw new ApiError(400,`한 번에 ${FRIEND_SYNC_MAX}명까지 동기화할 수 있습니다.`);
 return value.map(v=>{
  const p=v as Record<string,unknown>;
  if(!p||typeof p!=='object'||!isRecipientHash(p.recipientHash)||typeof p.appUserId!=='string'||!/^\d{1,30}$/.test(p.appUserId))throw new ApiError(400,'수신자 해시(64자 hex)와 카카오 사용자 id(숫자)를 확인해 주세요.');
  return {recipientHash:p.recipientHash,appUserId:p.appUserId};
 });
}
export type FriendSyncSummary={brandId:string;synced:number;unknown:number;relations:Record<FriendRelation,number>};
export async function syncFriendRelations(owner:string,who:Actor,input:Record<string,unknown>,client:FriendRelationClient):Promise<FriendSyncSummary>{
 const brandId=await requireBrand(owner,input.brandId),pairs=parseFriendPairs(input.recipients),at=stamp();
 const relations:Record<FriendRelation,number>={ADDED:0,BLOCKED:0,NONE:0},writes:D1PreparedStatement[]=[];let unknown=0;
 for(const pair of pairs){
  const relation=await client.relation(pair.appUserId);
  if(relation==='unknown'){unknown++;continue}
  relations[relation]++;
  const record:FriendRelationRecord={id:consentRecordId(brandId,pair.recipientHash),recipientHash:pair.recipientHash,brandId,channel:CONSENT_CHANNEL,relation,syncedAt:at,syncedBy:who.id};
  writes.push(friendRelationStatement(owner,record));
 }
 if(writes.length)await database().batch(writes);
 return {brandId,synced:writes.length,unknown,relations};
}

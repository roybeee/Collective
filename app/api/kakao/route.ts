import {acquireLock,actor,body,failure,json,releaseLock,requireAdminActor,requireOwnerActor,secureMutation,str,type Actor} from '@/lib/server';
import {executionRate} from '@/lib/execution-rate';
import {connectDealer,dealerStatus,disconnectDealer,loadDealer,verifyDealer} from '@/lib/kakao/credential-server';
import {consentSegment,consentSummary,generateReconsentNotice,importConsents,listReconsentNotices,recordOptout,requireBrand} from '@/lib/kakao/consent-server';
import {ESTIMATED_UNIT_KRW} from '@/lib/kakao/segments';
import {kakaoChannelClient,syncFriendRelations} from '@/lib/kakao/channel-sync';
import {approveMessage,checkMessage,draftMessage,kakaoEnabled,listSends,pollResult,sendMessage} from '@/lib/kakao/send-server';
import {KAKAO_RULES} from '@/lib/kakao/compliance';
import {requireAccess} from '@/lib/server-access';

// C6 카카오 비즈메시지 API(docs/KAKAO-BIZMESSAGE.ko.md 7절). 소유자·관리자만(직원 403, 비로그인 401, 다른 출처 403). 화면은 이 판에 없다.
// GET ?brandId=: 스위치·딜러 연결 상태(비밀값 없음)·수신동의 요약·재동의 안내·최근 전송 기록·규칙 근거.
// POST {action}: connect·disconnect(소유자) / verify·check·draft·approve·send·result·consent_import·optout·reconsent·friend_sync(소유자·관리자).
// 전송(send)은 스위치가 꺼져 있으면 409이고, 승인 없이는 보내지 않는다. 전화번호는 요청 본문에만 있고 응답·레코드에는 해시만 남는다.
const OWNER_ACTIONS=new Set(['connect','disconnect']);
const ACTIONS=new Set(['connect','disconnect','verify','check','draft','approve','send','result','consent_import','optout','reconsent','friend_sync']);
const scopeOf=(input:Record<string,unknown>)=>input.brandId===undefined||input.brandId===null||input.brandId===''?undefined:{brandId:str(input.brandId,'브랜드',100,true)};

export async function GET(req:Request){
 try{
  const who=await actor(req);
  if(who.role==='member')return json({error:'소유자·관리자만 볼 수 있습니다.'},403);
  const p=new URL(req.url).searchParams,brandId=p.get('brandId');
  const [enabled,dealer]=await Promise.all([kakaoEnabled(who.owner),dealerStatus(who.owner,brandId?{brandId}:undefined)]);
  if(!brandId)return json({enabled,dealer,rules:KAKAO_RULES});
  const id=await requireBrand(who.owner,brandId);
  // C6 후속(전송 화면): segment가 있으면 그 수신자 묶음의 수·해시(최대 50)와 추정 단가만 돌려준다(읽기, 저장 없음).
  const segment=p.get('segment');
  if(segment)return json({enabled,...await consentSegment(who.owner,id,segment),unitKrw:ESTIMATED_UNIT_KRW});
  const [consents,notices,sends]=await Promise.all([consentSummary(who.owner,id),listReconsentNotices(who.owner,id),listSends(who.owner,id)]);
  return json({enabled,dealer,brandId:id,consents,notices,sends,rules:KAKAO_RULES});
 }catch(error){return failure(error)}
}
async function run(who:Actor,action:string,input:Record<string,unknown>){
 const owner=who.owner;
 switch(action){
  case 'connect':return connectDealer(owner,input,scopeOf(input));
  case 'disconnect':return disconnectDealer(owner,scopeOf(input));
  case 'verify':return verifyDealer(owner,scopeOf(input));
  case 'check':return checkMessage(owner,input);
  case 'draft':return draftMessage(owner,who,input);
  case 'approve':return approveMessage(owner,who,input);
  case 'send':return sendMessage(owner,who,input);
  case 'result':return pollResult(owner,who,input);
  case 'consent_import':return importConsents(owner,who,input);
  case 'optout':return recordOptout(owner,who,input);
  case 'reconsent':{const brandId=await requireBrand(owner,input.brandId);return {brandId,notice:await generateReconsentNotice(owner,who,brandId)}}
  case 'friend_sync':{
   const brandId=await requireBrand(owner,input.brandId),{credential}=await loadDealer(owner,{brandId});
   if(!credential.adminKey)return json({error:'카카오 Admin 키가 연결에 없습니다. 딜러 연결에서 adminKey를 함께 등록하세요.'},409);
   return syncFriendRelations(owner,who,{...input,brandId},kakaoChannelClient({adminKey:credential.adminKey,channelPublicId:str(input.channelPublicId,'채널 공개 ID',100,true)}));
  }
  default:return json({error:'지원하지 않는 작업입니다.'},400);
 }
}
export async function POST(req:Request){
 let owner='',lock='';
 try{
  const input=await body(req),action=typeof input.action==='string'?input.action:'';
  if(!ACTIONS.has(action))return json({error:'지원하지 않는 작업입니다.'},400);
  const who=OWNER_ACTIONS.has(action)?await requireOwnerActor(req):await requireAdminActor(req);owner=who.owner;secureMutation(req);
  // G7: 승인·전송은 고객 발송(send_customer), 연결·해제는 연결 관리 권한이다(대표·관리자 그대로, 범위 역할 403).
  if(action==='approve'||action==='send'||OWNER_ACTIONS.has(action))await requireAccess(req,OWNER_ACTIONS.has(action)?'manage_connections':'send_customer');
  lock=await acquireLock(owner);
  await executionRate(owner,'kakao_bizmessage');
  const out=await run(who,action,input);
  if(out instanceof Response)return out;
  // 전송 기록 응답은 저장된 모양 그대로다(번호 없음). send는 {record, executed}다.
  return json(out);
 }catch(error){return failure(error)}finally{if(lock)await releaseLock(owner,lock)}
}

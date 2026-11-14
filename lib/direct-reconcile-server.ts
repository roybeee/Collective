// C3 후속 서버: 결과 미확인 직접 게시 발행의 '계정 게시물로 대조'(POST /api/execution {action:'reconcile_direct'}, 관리자). 읽기만 하고 절대 다시 보내지 않는다.
// 하나 일치 → published(게시물 id·permalink 기록, 두 단계 저널도 published로 닫아 재실행이 cached가 된다).
// 일치 없음 → 창(lib/direct-reconcile.ts)이 닫힌 뒤에만 failed(사유 기록), 창 안이면 미확인 유지. 여럿 → 미확인 유지·후보 표시(사람이 고른다).
import {ApiError,database,eventStatement,listRecords,recordStatement,stamp,type Actor} from './server';
import {uncertainResolvable,type Publication} from './execution';
import {retireMedia} from './execution-server';
import {d1ContainerJournal,directChannelId,isDirectChannelId,publisherFor,selectDirectPublisher} from './execution-publisher-server';
import {matchUncertain} from './direct-reconcile';
import type {Campaign} from './agency';

type Who=Pick<Actor,'id'|'email'>;
export async function reconcileDirect(owner:string,campaign:Campaign,p:Publication,who:Who,now=Date.now()){
 if(!isDirectChannelId(p.channelId)||(p.status!=='uncertain'&&p.status!=='submitting'))throw new ApiError(409,'결과 미확인인 직접 게시(Instagram·Threads) 발행만 계정 게시물로 대조할 수 있습니다.');
 if(!uncertainResolvable(p,now))throw new ApiError(409,'접수 처리 중입니다. 잠시 후 대조하세요.');
 const sel=await selectDirectPublisher(owner,campaign.brandId);
 if(!sel||directChannelId(sel.kind,sel.credential.userId)!==p.channelId)throw new ApiError(409,'이 발행을 보낸 계정의 연결과 스위치가 켜져 있어야 대조할 수 있습니다.');
 const journal=d1ContainerJournal(owner,campaign.id),publisher=publisherFor(sel,journal);
 const media=publisher.recentMedia?await publisher.recentMedia():null;
 if(!media)throw new ApiError(502,'계정의 최근 게시물을 읽지 못했습니다. 상태는 바꾸지 않았습니다. 잠시 후 다시 대조하세요.');
 const linked=new Set((await listRecords<Publication>(owner,'execution_publication',campaign.id)).filter(x=>x.id!==p.id&&x.providerId).map(x=>x.providerId!));
 const verdict=await matchUncertain({caption:p.caption,attemptedAt:p.attemptedAt??'',now,media,excludeIds:linked});
 const at=stamp(),base={version:p.version+1,updatedAt:at};
 let next:Publication,message:string;
 if(verdict.result==='match'){
  next={...p,...base,status:'published',providerId:verdict.media.id,providerStatus:'published',...(verdict.media.permalink?{permalink:verdict.media.permalink}:{}),resolvedBy:who.id,resolvedAt:at,error:undefined,directReconcile:undefined};
  message=`접수 확인 · 계정 게시물 대조로 게시를 확인했습니다(게시물 ${verdict.media.id}).`;
  const entry=await journal.get(p.id);
  await journal.set({id:p.id,channel:sel.kind,state:'published',containerId:entry?.containerId??null,publishedId:verdict.media.id,attempts:entry?.attempts??0,error:null,updatedAt:at});
 }else if(verdict.result==='multiple'){
  next={...p,...base,directReconcile:{checkedAt:at,checkedBy:who.id,result:'multiple',candidates:verdict.candidates.map(c=>({id:c.id,timestamp:c.timestamp,permalink:c.permalink}))}};
  message=`접수 확인 · 같은 캡션 게시물이 ${verdict.candidates.length}개라 확정하지 않았습니다. 계정에서 확인하세요.`;
 }else if(verdict.windowClosed){
  next={...p,...base,status:'failed',resolvedBy:who.id,resolvedAt:at,directReconcile:undefined,error:`계정 게시물 대조: 접수 시각 창(~${verdict.closesAt}) 안에 같은 캡션 게시물이 없습니다. 게시되지 않은 것으로 닫았습니다. 자동 재전송하지 않습니다.`};
  message='접수 확인 · 계정에 같은 캡션 게시물이 없어 실패로 닫았습니다.';
 }else{
  next={...p,...base,directReconcile:{checkedAt:at,checkedBy:who.id,result:'none_yet',candidates:[]}};
  message=`접수 확인 · 아직 같은 캡션 게시물이 없습니다. ${verdict.closesAt}까지 다시 대조할 수 있습니다.`;
 }
 await database().batch([recordStatement(owner,'execution_publication',p.id,next,campaign.id),eventStatement(owner,campaign.id,message,who)]);
 if(next.status==='failed')await retireMedia(owner,[p]);
 return {...next,reconcile:verdict.result==='none'?{result:'none',windowClosed:verdict.windowClosed,closesAt:verdict.closesAt}:{result:verdict.result}};
}

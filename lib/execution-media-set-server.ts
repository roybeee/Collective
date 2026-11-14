// C3 후속 서버: 캐러셀·릴스 발행 묶음의 저장·승인·접수 검사(lib/execution-server.ts의 준비·승인·접수가 한 줄씩 부른다).
// 묶음은 Instagram 직접 게시(스위치 instagram_direct_publish + 브랜드 연결)일 때만 만들 수 있다. Buffer·Threads 경로는 단일 이미지 그대로다.
// 승인 화면에 보인 모든 미디어 해시(mediaHashes)가 지금 묶음과 같아야 승인하고, 승인 뒤 어느 소재가 바뀌면 승인·접수가 409다(캡션 규칙과 같음).
import {ApiError} from './server';
import {publishPublicMedia,retirePublicMedia,verifyMedia} from './execution-media';
import {selectDirectPublisher} from './execution-publisher-server';
import {MediaSetError,parseCarouselIds,parseVideoInput,publicationMediaHashes,sameHashes} from './execution-media-set';
import type {Campaign} from './agency';
import type {ExecutionCreative,Publication,PublicationMediaSet} from './execution';

type Current=(id:string)=>Promise<ExecutionCreative>;
const wrap=<T>(fn:()=>T):T=>{try{return fn()}catch(e){if(e instanceof MediaSetError)throw new ApiError(400,e.message);throw e}};
export const isDirectInstagram=(channelId:string|undefined)=>/^instagram_direct:\d+$/.test(channelId??'');

// 발행 준비(save_publication)의 mediaSet 입력. {type:'CAROUSEL', creativeIds:[…]} 또는 {type:'REELS', video:{url,sha256,bytes}}.
export async function parseMediaSet(owner:string,campaign:Campaign,raw:unknown,primary:ExecutionCreative,current:Current):Promise<PublicationMediaSet>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ApiError(400,'캐러셀·릴스 입력 형식을 확인하세요.');
 const input=raw as Record<string,unknown>,sel=await selectDirectPublisher(owner,campaign.brandId);
 if(sel?.kind!=='instagram_direct')throw new ApiError(409,'캐러셀·릴스는 Instagram 직접 게시(스위치 instagram_direct_publish와 브랜드 연결)에서만 준비할 수 있습니다.');
 if(input.type==='REELS')return {type:'REELS',video:wrap(()=>parseVideoInput(input.video))};
 if(input.type!=='CAROUSEL')throw new ApiError(400,"묶음 종류는 'CAROUSEL'(캐러셀) 또는 'REELS'(릴스)입니다.");
 const ids=wrap(()=>parseCarouselIds(input.creativeIds,primary.id));
 const creatives=await Promise.all(ids.map(id=>current(id)));
 return {type:'CAROUSEL',items:creatives.map(c=>({creativeId:c.id,creativeVersion:c.version,pngHash:c.pngHash,mediaUrl:''}))};
}
// 승인·접수 직전: 캐러셀의 각 소재가 준비 때 버전·PNG와 같아야 한다. 하나라도 바뀌면 409(다시 준비).
export async function assertMediaSetCurrent(p:Publication,current:Current){
 if(p.mediaSet?.type!=='CAROUSEL')return;
 for(const item of p.mediaSet.items){
  const c=await current(item.creativeId);
  if(c.version!==item.creativeVersion||c.pngHash!==item.pngHash)throw new ApiError(409,'캐러셀 소재가 변경됐습니다. 이 발행을 취소하고 다시 준비하세요.');
 }
}
// 승인: 묶음은 Instagram 직접 게시 계정에서만, 화면에 보인 해시 목록이 지금 묶음과 같아야 한다.
export function assertMediaSetApproval(p:Publication,input:Record<string,unknown>,channelId:string){
 if(!p.mediaSet)return;
 if(!isDirectInstagram(channelId))throw new ApiError(409,'캐러셀·릴스 발행은 Instagram 직접 게시 계정으로만 승인할 수 있습니다.');
 if(!sameHashes(input.mediaHashes,publicationMediaHashes(p)))throw new ApiError(409,'화면에 표시된 미디어가 변경됐습니다(미디어 해시). 새로고침하고 다시 확인하세요.');
}
// 승인 때 캐러셀 추가 장을 앱 공개 주소로 제공한다(첫 장은 기존 경로). 릴스 영상은 외부 주소 그대로다. 실패하면 이미 연 공개 사본을 되돌린다.
export async function publishMediaSet(owner:string,p:Publication,origin:string):Promise<PublicationMediaSet|undefined>{
 const set=p.mediaSet;
 if(set?.type!=='CAROUSEL')return set;
 const done:string[]=[];
 try{
  const items=[];
  for(const item of set.items){const url=await publishPublicMedia(owner,item.pngHash,p.id,origin);done.push(item.pngHash);items.push({...item,mediaUrl:url})}
  return {type:'CAROUSEL',items};
 }catch(e){for(const h of done)await retirePublicMedia(owner,h,p.id).catch(()=>{});throw e}
}
// 승인을 벗어난 발행(취소·초안 되돌림·실패)의 캐러셀 공개 사본 참조를 해제한다. 실패는 기록만 한다.
export async function retireMediaSet(owner:string,p:Publication){
 if(p.mediaSet?.type!=='CAROUSEL')return;
 for(const item of p.mediaSet.items)if(item.mediaUrl)await retirePublicMedia(owner,item.pngHash,p.id).catch(e=>console.error('execution_media_set_retire_failed',e instanceof Error?e.message:'unknown'));
}
// 초안으로 되돌릴 때 캐러셀 공개 주소를 비운다(다시 승인하면 새로 채운다).
export const draftMediaSet=(set:PublicationMediaSet|undefined):PublicationMediaSet|undefined=>set?.type==='CAROUSEL'?{type:'CAROUSEL',items:set.items.map(i=>({...i,mediaUrl:''}))}:set;
// 접수 직전: 묶음은 직접 게시 경로만, 캐러셀 공개 사본은 원본 해시와 같아야 한다(영상 크기는 공급자 준비 검사가 HEAD로 본다).
export async function verifyMediaSet(p:Publication,origin:string,direct:boolean){
 if(!p.mediaSet)return;
 if(!direct||!isDirectInstagram(p.channelId))throw new ApiError(409,'캐러셀·릴스 발행은 Instagram 직접 게시로만 보낼 수 있습니다. 보내지 않았습니다.');
 if(p.mediaSet.type==='CAROUSEL')for(const item of p.mediaSet.items)await verifyMedia(item.mediaUrl,item.pngHash,origin);
}

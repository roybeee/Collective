// C3 후속: 발행 하나가 여러 승인 이미지(캐러셀 2~10장) 또는 승인 영상 1개(릴스)를 싣는 묶음(순수 모듈, 화면·서버 공용).
// 첫 장(또는 릴스 표지)은 발행의 원래 소재 PNG(pngHash·codedPng)이고, 나머지는 같은 캠페인의 다른 현재 소재다. 영상은 외부 공개 주소(파일명=SHA-256)다.
// 승인 요청은 묶음의 모든 해시(mediaHashes)를 화면에 보인 순서대로 싣는다. 승인 뒤 어느 하나라도 바뀌면 캡션과 같이 409다(lib/execution-media-set-server.ts).
import {mediaHash,type Publication,type PublicationMediaSet,type PublicationVideo} from './execution';

export const CAROUSEL_MIN_ITEMS=2,CAROUSEL_MAX_ITEMS=10;
// 릴스 영상 상한(가정, lib/connectors/instagram-publish.ts REELS_MAX_BYTES와 같은 값). 순수 모듈이라 커넥터를 불러오지 않고 같은 수를 둔다.
export const REELS_VIDEO_MAX_BYTES=300*1024*1024;
const HASH=/^[a-f0-9]{64}$/;
export class MediaSetError extends Error{constructor(message:string){super(message);this.name='MediaSetError'}}

// 승인 화면·승인 요청·서버 검사가 같은 순서로 읽는 해시 목록. 묶음이 없으면 원래 소재 하나다.
export function publicationMediaHashes(p:Pick<Publication,'pngHash'|'codedPng'|'mediaSet'>):string[]{
 const first=mediaHash(p),set=p.mediaSet;
 if(!set)return [first];
 return set.type==='CAROUSEL'?[first,...set.items.map(i=>i.pngHash)]:[first,set.video.sha256];
}
// 승인 요청 본문에 더하는 값. 묶음이 없는 발행은 빈 객체라 이전 본문과 같다.
export const mediaSetApproval=(p:Pick<Publication,'pngHash'|'codedPng'|'mediaSet'>)=>p.mediaSet?{mediaHashes:publicationMediaHashes(p)}:{};
export const sameHashes=(a:unknown,b:readonly string[])=>Array.isArray(a)&&a.length===b.length&&a.every((h,i)=>h===b[i]);
// 캐러셀 장수(첫 장 포함). 릴스는 0.
export const carouselCount=(set:PublicationMediaSet|undefined)=>set?.type==='CAROUSEL'?set.items.length+1:0;

// 릴스 영상 입력: Cloudinary·R2 공개 https 주소, 파일명이 소문자 SHA-256 64자 + .mp4, 크기(바이트) 정수. 서버는 영상을 내려받지 않고 HEAD 길이로 대조한다.
export function parseVideoInput(value:unknown):PublicationVideo{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new MediaSetError('릴스 영상 입력(url·sha256·bytes)을 확인하세요.');
 const v=value as Record<string,unknown>,sha=typeof v.sha256==='string'?v.sha256.toLowerCase():'';
 if(!HASH.test(sha))throw new MediaSetError('릴스 영상 해시는 SHA-256 64자(소문자 16진수)여야 합니다.');
 let url:URL;try{url=new URL(String(v.url??''))}catch{throw new MediaSetError('릴스 영상 공개 주소를 확인하세요.')}
 const allowed=url.hostname==='res.cloudinary.com'||/^[a-z0-9-]+\.r2\.dev$/.test(url.hostname);
 if(!allowed||url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/'+sha+'.mp4'))throw new MediaSetError('릴스 영상은 Cloudinary 또는 R2 공개 주소에 영상 해시 파일명(<sha256>.mp4)으로 올려 주세요.');
 const bytes=v.bytes;
 if(typeof bytes!=='number'||!Number.isSafeInteger(bytes)||bytes<1||bytes>REELS_VIDEO_MAX_BYTES)throw new MediaSetError(`릴스 영상 크기는 1바이트~${Math.round(REELS_VIDEO_MAX_BYTES/1048576)}MB 정수여야 합니다.`);
 return {url:url.href,sha256:sha,bytes};
}
// 캐러셀 추가 소재 id 목록(첫 장 제외 1~9개, 중복·첫 장 반복 불가).
export function parseCarouselIds(value:unknown,primaryId:string):string[]{
 if(!Array.isArray(value)||value.length<CAROUSEL_MIN_ITEMS-1||value.length>CAROUSEL_MAX_ITEMS-1)throw new MediaSetError(`캐러셀은 첫 장 외에 소재 ${CAROUSEL_MIN_ITEMS-1}~${CAROUSEL_MAX_ITEMS-1}개를 더 골라야 합니다(모두 ${CAROUSEL_MIN_ITEMS}~${CAROUSEL_MAX_ITEMS}장).`);
 const ids=value.map(v=>typeof v==='string'&&v&&v.length<=100?v:'');
 if(ids.some(id=>!id))throw new MediaSetError('캐러셀 소재를 확인하세요.');
 if(new Set([primaryId,...ids]).size!==ids.length+1)throw new MediaSetError('캐러셀에 같은 소재를 두 번 넣을 수 없습니다.');
 return ids;
}

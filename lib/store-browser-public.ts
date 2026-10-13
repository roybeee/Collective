import {ApiError,str} from './server';
import {weeklyCanonical,weeklySchedule} from './store-browser-hours';
import type {BrowserJob,BrowserPublicEvidence,BrowserPublicReadback} from './store-browser';
export function browserPublicUrl(raw:unknown){
 const value=str(raw,'공개 주소',2000,true);try{const u=new URL(value);if(u.protocol!=='https:'||!['place.naver.com','map.naver.com','pcmap.place.naver.com'].includes(u.hostname)||u.username||u.password||u.port||u.hash)throw Error();return u.href}catch{throw new ApiError(400,'네이버 플레이스·지도 공식 공개 HTTPS 주소를 입력하세요.')}
}
export function publicReadback(input:Record<string,unknown>,job:BrowserJob):BrowserPublicReadback{
 if(!job.binding.publicUrl)throw new ApiError(409,'승인 연결에 공개 주소가 없습니다.');
 const raw=input.evidence;if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ApiError(400,'공개 화면 관찰 근거가 필요합니다.');const r=raw as Record<string,unknown>;
 if(r.unavailable===true)return {state:'unavailable',note:str(r.note,'공개 확인 불가 사유',1000,true)};
 if(Object.keys(r).some(k=>!['publicUrl','naverPlaceId','capturedAt','source','hours','schedule','photoId','photoSha256','note'].includes(k)))throw new ApiError(400,'공개 근거 항목을 확인하세요.');
 const capturedAt=str(r.capturedAt,'확인 시각',50,true),time=Date.parse(capturedAt);
 if(!Number.isFinite(time)||Math.abs(Date.now()-time)>300000||!['real','mocked'].includes(String(r.source)))throw new ApiError(400,'최근 관찰 시각과 실측·모의 구분을 확인하세요.');
 const evidence:BrowserPublicEvidence={publicUrl:browserPublicUrl(r.publicUrl),naverPlaceId:str(r.naverPlaceId,'관찰 플레이스 ID',100,true),capturedAt,source:r.source as 'real'|'mocked',...(r.hours!==undefined?{hours:str(r.hours,'공개 영업시간',3000,true)}:{}),...(r.schedule!==undefined?{schedule:weeklySchedule(r.schedule)}:{}),...(r.photoId!==undefined?{photoId:str(r.photoId,'공개 사진 ID',200,true)}:{}),...(r.photoSha256!==undefined?{photoSha256:str(r.photoSha256,'공개 사진 해시',64,true)}:{})};
 if(evidence.publicUrl!==job.binding.publicUrl||evidence.naverPlaceId!==job.binding.naverPlaceId)throw new ApiError(409,'공개 화면의 주소·플레이스 ID가 승인 대상과 다릅니다.');
 const matched=job.type==='upload_photo'?!!evidence.photoId&&evidence.photoId===job.evidence?.photoId&&evidence.photoSha256===job.photo?.sha256:job.type.includes('weekly')?!!evidence.schedule&&weeklyCanonical(evidence.schedule)===weeklyCanonical(job.afterSchedule??job.evidence?.schedule):evidence.hours===(job.type==='change_hours'?job.afterHours:job.evidence?.hours);
 return {state:matched?'matched':'different',evidence:{...evidence,...(r.note!==undefined?{note:str(r.note,'공개 관찰 범위',1000,true)}:{})}};
}

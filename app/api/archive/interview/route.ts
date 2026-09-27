import {identity,secureMutation,body,str,json,failure,readRecord,listRecords,ApiError} from '@/lib/server';
import {saveInterview,getInterview,publicInterview,startInterview,advanceInterview,applyInterview,transcribeInterviewAudio,interviewLock} from '@/lib/brand-interview-server';
import type {InterviewSource} from '@/lib/brand-interview';
export async function GET(req:Request){try{const owner=await identity(req),brandId=str(new URL(req.url).searchParams.get('brandId'),'브랜드',100,true);await readRecord(owner,'brand',brandId);return json({interviews:(await listRecords<InterviewSource>(owner,'brand_source',brandId)).filter(s=>s.interview&&s.status!=='excluded').map(publicInterview)})}catch(e){return failure(e)}}
export async function POST(req:Request){try{const owner=await identity(req);secureMutation(req);const b=await body(req),brandId=str(b.brandId,'브랜드',100,true);await readRecord(owner,'brand',brandId);
 return await interviewLock(owner,brandId,async()=>{
  if(b.action==='save')return json(publicInterview(await saveInterview(owner,brandId,b)));
  const s=await getInterview(owner,brandId,str(b.id,'인터뷰',100,true));if(s.version!==b.version)throw new ApiError(409,'인터뷰가 변경됐습니다. 다시 불러오세요.');
  if(b.action==='start')return json(publicInterview(await startInterview(owner,s)));
  if(b.action==='poll'||b.action==='cancel')return json(publicInterview(await advanceInterview(owner,s,b.action==='cancel')));
  if(b.action==='apply')return json(publicInterview(await applyInterview(owner,s,b.selected)));
  if(b.action==='transcribe'){const result=await transcribeInterviewAudio(owner,s,str(b.sourceId,'녹음',100,true),b.consent===true);return json({...publicInterview(s),transcriptionPending:'pending' in result&&result.pending})}
  throw new ApiError(400,'지원하지 않는 인터뷰 작업입니다.');
 });
 }catch(e){return failure(e)}}

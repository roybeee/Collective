import {identity,requireAdminActor,secureMutation,body,str,json,failure,readRecord,acquireLock,releaseLock} from '@/lib/server';
import {readBrandVoice,saveBrandVoice} from '@/lib/brand-voice-server';
import {activeVoiceInput,BRAND_VOICE_LIMITS} from '@/lib/brand-voice';
import type {Brand} from '@/lib/agency';

// 브랜드 말투 원장(A3-2). 조회는 워크스페이스 구성원 모두, 쓰기(초안 저장·확정·철회)는 대표·관리자만(직원 403). 쓰기는 version 비교(CAS)로 409를 낸다.
// active는 모델에 가는 확정본 블록이다(초안은 들어가지 않는다). 실제 입력 주입은 기능 스위치 a3_brand_voice가 켜진 content·creative 역할만이다.
export async function GET(req:Request){
 try{
  const owner=await identity(req),brandId=str(new URL(req.url).searchParams.get('brandId')??'','브랜드',100,true);
  await readRecord<Brand>(owner,'brand',brandId);
  const voice=await readBrandVoice(owner,brandId);
  return json({voice,active:activeVoiceInput(voice),limits:BRAND_VOICE_LIMITS});
 }catch(error){return failure(error)}
}

export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await requireAdminActor(req);owner=who.owner;secureMutation(req);
  const input=await body(req);
  lock=await acquireLock(owner);
  return json(await saveBrandVoice(owner,input,who));
 }catch(error){return failure(error)}finally{if(lock)await releaseLock(owner,lock)}
}

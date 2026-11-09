import {actor,secureMutation,body,json,failure,ApiError,acquireLock,releaseLock,str,listRecords,readRecord} from '@/lib/server';
import {POST as actionPost} from '@/app/api/action/route';
import {executionRate} from '@/lib/execution-rate';
import {isEnabled} from '@/lib/feature-flags';
import type {Brand} from '@/lib/agency';
import type {Store} from '@/lib/store-marketing';
import {confirmedFactContext} from '@/lib/brand-facts-server';
import {applyLearnedVisual,learnBrandPage,listLearnRuns,saveLearnRun,saveLearnedCandidates,BRAND_AUTOLEARN_OFF,type LearnSourceInput} from '@/lib/brand-learn-server';
import {BRAND_LEARN_SAMPLE_HTML,BRAND_LEARN_SAMPLE_PATH} from '@/lib/brand-learn-sample';
import {campaignTemplates,isTemplateId,templateBriefInput} from '@/lib/campaign-templates';
import {requireBrandRead} from '@/lib/server-access';

// 브랜드 자동 학습(에픽 G1). 읽기: 스위치 상태·최근 실행 기록·템플릿 목록. 쓰기(스위치 꺼짐이면 409):
//  preview(공개 페이지 1회 GET → 후보 미리보기, 실행 기록) · save_candidates(후보를 사실 원장 '확인 후보'로) · apply_visual(관리자: 제안 색을 브랜드 색으로)
//  · create_from_template(템플릿 → 기존 브리프 저장 경로 save_campaign으로 캠페인 초안). 확정은 사람이 원장에서 한다.
export async function GET(req:Request){
 try{
  const who=await actor(req),params=new URL(req.url).searchParams,brandId=str(params.get('brandId')??'','브랜드',100,true);
  await requireBrandRead(req,brandId);
  const [enabled,runs]=await Promise.all([isEnabled(who.owner,'brand_autolearn'),listLearnRuns(who.owner,brandId)]);
  return json({enabled,offReason:enabled?null:BRAND_AUTOLEARN_OFF,runs,templates:campaignTemplates});
 }catch(error){return failure(error)}
}
// 같은 출처의 테스트 고정물 경로(/api/brand-learn/sample)는 네트워크 없이 고정 HTML로 바꾼다. 사설 주소 가드는 그대로다(E2E가 자기 서버를 읽는 길).
function learnSource(req:Request,raw:unknown):LearnSourceInput{
 if(typeof raw!=='string')return {kind:'fetch'};
 try{const target=new URL(raw.trim()),self=new URL(req.url);return target.origin===self.origin&&target.pathname===BRAND_LEARN_SAMPLE_PATH?{kind:'fixture',html:BRAND_LEARN_SAMPLE_HTML}:{kind:'fetch'}}catch{return {kind:'fetch'}}
}
export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await actor(req);owner=who.owner;secureMutation(req);
  const input=await body(req);
  if(input.action==='create_from_template'){
   // 템플릿 입력만 여기서 만들고 저장은 기존 브리프 저장 경로(save_campaign: validateCampaign·브랜드 검사·이벤트)가 한다. 잠금은 그 경로가 잡는다.
   if(!await isEnabled(owner,'brand_autolearn'))throw new ApiError(409,BRAND_AUTOLEARN_OFF);
   const brandId=str(input.brandId,'브랜드',100,true),template=input.template;
   if(!isTemplateId(template))throw new ApiError(400,'템플릿을 확인하세요.');
   const brand=await readRecord<Brand>(owner,'brand',brandId);
   const [stores,confirmed]=await Promise.all([listRecords<Store>(owner,'store',brandId),confirmedFactContext(owner,brandId)]);
   const data=templateBriefInput(template,{brandId,name:brand.name,category:brand.category,storeCount:stores.filter(s=>s.status!=='archived').length,confirmedFactCount:confirmed.length});
   return actionPost(new Request(new URL('/api/action',req.url),{method:'POST',headers:req.headers,body:JSON.stringify({action:'save_campaign',data})}));
  }
  if(input.action==='preview'){
   // 가져오기(최대 10초)는 잠금 밖에서 하고 기록만 잠금 안에서 쓴다.
   const run=await learnBrandPage(owner,input,learnSource(req,input.url));
   lock=await acquireLock(owner);await executionRate(owner,'brand_learn');
   return json({run:await saveLearnRun(owner,run,who)});
  }
  if(input.action!=='save_candidates'&&input.action!=='apply_visual')throw new ApiError(400,'지원하지 않는 작업입니다.');
  lock=await acquireLock(owner);await executionRate(owner,'brand_learn');
  if(input.action==='save_candidates')return json(await saveLearnedCandidates(owner,input,who));
  return json(await applyLearnedVisual(owner,input,who));
 }catch(error){return failure(error)}finally{if(lock)await releaseLock(owner,lock)}
}

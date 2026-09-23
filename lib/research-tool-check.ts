// 조사 시작 때의 도구 점검(security-ops-1 권고 2·3). 서버 전용: 화면 코드는 lib/research-tools.ts만 가져간다.
// RESEARCH_TOOL_POLICY=block일 때만 위험 도구 광고·목록 미확인·점검 실패를 409로 막는다. 기본(warn)은 막지 않고 경고를 남긴다.
// 운영 목록에는 훅으로 막은 browser_cdp·browser_dialog도 보이므로 기본 차단이면 조사가 모두 멈춘다.
// 연결: 대화형 시작은 app/api/archive/research/route.ts, 브랜드 등록 자동 조사는 app/api/archive/route.ts. lib/research-execution.ts의 시작 경로는 이 레인에서 고치지 않는다.
import {ApiError,stamp,runtime,readRecord,recordStatement,acquireLock,releaseLock,type Connection} from './server';
import {inspectResearchAccess} from './deep-research-server';
import {toolPolicy,toolPolicyViolation,type RiskedResearchAccess} from './research-tools';
import type {BrandResearch} from './archive';
const currentPolicy=()=>toolPolicy((runtime as {RESEARCH_TOOL_POLICY?:string}).RESEARCH_TOOL_POLICY);
// 시작 응답을 기다리게 하는 점검이라 호출당 제한 시간을 짧게 둔다(기본 HERMES 요청은 30초). 넘으면 warn은 미확인으로 시작하고 block은 409다.
export const START_CHECK_TIMEOUT_MS=8000;
export async function startResearchAccess(cfg:Connection,policy=currentPolicy(),timeoutMs=START_CHECK_TIMEOUT_MS):Promise<RiskedResearchAccess>{
 let access:RiskedResearchAccess;
 try{access=await inspectResearchAccess(cfg,timeoutMs)}catch(e){const reason=e instanceof ApiError?e.message:'HERMES 도구 점검 중 오류가 발생했습니다.';if(policy==='block')throw new ApiError(409,'도구 점검에 실패해 조사를 시작하지 않습니다(RESEARCH_TOOL_POLICY=block). '+reason);return {checkedAt:stamp(),gateway:false,aside:'unverified',browser:'unverified',tools:[],notes:['조사 시작 때 도구 점검에 실패해 위험 도구 여부를 확인하지 못했습니다. '+reason],dangerousAdvertised:false}}
 const blocked=toolPolicyViolation(access,policy);if(blocked)throw new ApiError(409,blocked);
 return access.dangerousAdvertised?{...access,notes:[...access.notes,'위험 도구가 목록에 있지만 RESEARCH_TOOL_POLICY가 block이 아니어서 경고만 남기고 조사를 시작했습니다.']}:access;
}
// 브랜드 등록은 네트워크를 기다리지 않고 바로 끝나는 것이 기본 계약이다. warn이면 점검하지 않고(research.access는 unverified 그대로),
// block이면 등록 전에 점검해 막히면 조사를 만들지 않고 사유를 돌려주며, 통과하면 점검 결과를 research.access로 쓴다.
export async function autoResearchAccess(cfg:Connection,policy=currentPolicy()):Promise<{access?:RiskedResearchAccess;blocked?:string}>{
 if(policy!=='block')return {};
 try{return {access:await startResearchAccess(cfg,policy)}}catch(e){if(e instanceof ApiError&&e.status===409)return {blocked:e.message};throw e}
}
// 대화형 시작은 lib/research-execution.ts가 research.access를 unverified로 저장한다. 새로 만든 조사의 모든 단계가 아직 접수 전이면
// 같은 조사 잠금 안에서 access만 바꿔 쓴다. 잠금을 못 잡았거나 이미 접수가 시작됐으면 그대로 둔다(점검 기록은 남기지 못해도 조사는 막지 않는다).
export async function saveStartAccess(owner:string,id:string,access:RiskedResearchAccess){
 const key=owner+':research:'+id;let lock='';
 try{
  lock=await acquireLock(key);const r=await readRecord<BrandResearch>(owner,'brand_research',id);
  if(r.mode!=='deep'||!r.steps.every(s=>s.status==='pending'))return false;
  await recordStatement(owner,'brand_research',id,{...r,access},r.brandId).run();return true;
 }catch{return false}finally{if(lock)await releaseLock(key,lock)}
}

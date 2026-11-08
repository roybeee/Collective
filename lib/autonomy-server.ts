// G3 자율성 규칙 서버 적용. 저장은 소유자 범위 records(kind 'autonomy_settings', id 'current', 1행)이고 읽기·쓰기는 스위치와 무관하다.
// 적용(evaluate/assert)은 기능 스위치 autonomy_rules가 켜져 있을 때만 저장값을 쓰고, 꺼져 있으면 모두 ask(기존 동작 그대로)다.
// 라우트 삽입은 한 줄이다: never면 403(한국어 사유), ask면 그대로, auto(저등급만)면 응답에 autonomy:'auto'를 덧붙여 화면이 표시만 한다.
import {ApiError,readRecord,recordStatement,stamp,type Actor} from './server';
import {isEnabled} from './feature-flags';
import {AutonomyError,autonomyActionInfos,defaultAutonomySettings,evaluateAutonomy,parseAutonomySettings,sanitizeAutonomySettings,type AutonomyAction,type AutonomyDecision,type AutonomySettings} from './autonomy';

const ID='current';
export type AutonomySettingsRecord={id:'current';version:number;settings:AutonomySettings;updatedAt:string|null;updatedBy:string|null};
export const emptyAutonomyRecord=():AutonomySettingsRecord=>({id:'current',version:0,settings:defaultAutonomySettings(),updatedAt:null,updatedBy:null});

export async function readAutonomyRecord(owner:string):Promise<AutonomySettingsRecord>{
 let saved:Partial<AutonomySettingsRecord>|null=null;
 try{saved=await readRecord<Partial<AutonomySettingsRecord>>(owner,'autonomy_settings',ID)}catch(e){if(e instanceof ApiError&&e.status===404)return emptyAutonomyRecord();throw e}
 return {id:'current',version:Number.isSafeInteger(saved?.version)?Number(saved!.version):0,settings:sanitizeAutonomySettings(saved?.settings),updatedAt:typeof saved?.updatedAt==='string'?saved.updatedAt:null,updatedBy:typeof saved?.updatedBy==='string'?saved.updatedBy:null};
}
export async function autonomyView(who:Actor){
 const record=await readAutonomyRecord(who.owner),admin=who.role==='owner'||who.role==='admin';
 return {settings:record.settings,version:record.version,updatedAt:record.updatedAt,updatedBy:admin?record.updatedBy:null,enabled:await isEnabled(who.owner,'autonomy_rules'),actions:autonomyActionInfos(),canEdit:admin,
  notice:'자율성 규칙은 행동마다 자동·확인 후·금지를 정합니다. 스위치가 꺼져 있으면 모두 확인 후로 동작하고, 고위험 행동은 자동으로 둘 수 없습니다.'};
}
export type AutonomyView=Awaited<ReturnType<typeof autonomyView>>;
// 쓰기는 소유자·관리자만. expectedVersion(선택)이 다르면 409. 부분 입력은 저장값 위에 덮어 새 행으로 저장한다.
export async function saveAutonomySettings(who:Actor,input:Record<string,unknown>){
 if(who.role!=='owner'&&who.role!=='admin')throw new ApiError(403,'소유자·관리자만 자율성 규칙을 바꿀 수 있습니다.');
 const current=await readAutonomyRecord(who.owner);
 if(input.expectedVersion!==undefined&&input.expectedVersion!==current.version)throw new ApiError(409,'자율성 규칙이 다른 곳에서 바뀌었습니다. 최신 판을 확인하세요.');
 let settings:AutonomySettings;
 try{settings=parseAutonomySettings(input.settings,current.settings)}catch(e){if(e instanceof AutonomyError)throw new ApiError(400,e.message);throw e}
 const next:AutonomySettingsRecord={id:'current',version:current.version+1,settings,updatedAt:stamp(),updatedBy:who.id};
 await recordStatement(who.owner,'autonomy_settings',ID,next).run();
 return autonomyView(who);
}
export async function evaluateAutonomyFor(owner:string,action:AutonomyAction):Promise<AutonomyDecision>{
 const enabled=await isEnabled(owner,'autonomy_rules');
 if(!enabled)return evaluateAutonomy(null,action,{enabled:false});
 return evaluateAutonomy((await readAutonomyRecord(owner)).settings,action,{enabled:true});
}
// never면 403으로 막는다. ask·auto는 결정을 돌려주고 라우트는 기존 동작을 그대로 한다.
export async function assertAutonomy(owner:string,action:AutonomyAction):Promise<AutonomyDecision>{
 const decision=await evaluateAutonomyFor(owner,action);
 if(decision.mode==='never')throw new ApiError(403,decision.reason);
 return decision;
}
// auto 결정이고 성공 JSON 응답이면 autonomy:'auto'를 덧붙인다. 그 밖에는 응답을 그대로 돌려준다(본문을 읽지 않는다).
export async function markAutonomy(response:Response,decision:AutonomyDecision|null):Promise<Response>{
 if(!decision||decision.mode!=='auto'||!response.ok||!(response.headers.get('content-type')||'').includes('application/json'))return response;
 let data:unknown;
 try{data=await response.clone().json()}catch{return response}
 if(!data||typeof data!=='object'||Array.isArray(data))return response;
 return new Response(JSON.stringify({...(data as Record<string,unknown>),autonomy:'auto'}),{status:response.status,headers:response.headers});
}

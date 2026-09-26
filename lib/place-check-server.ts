import {ApiError,database,listRecords,readRecord,recordStatement,stamp,str,type Actor} from './server';
import type {BrandFact} from './brand-facts';
import type {Store,StoreTask} from './store-marketing';
import {checkedVersion,localDate,option} from './store-server';
import {isEnabled} from './feature-flags';
import {compareSnapshot,isPlaceTask,placeUrl,planPlaceTasks,withHistory,PLACE_FIELDS,PLACE_LIMITS,PLACE_PLATFORMS,type PlaceActor,type PlaceField,type PlacePlatform,type PlaceSnapshot} from './place-check';

// 플레이스 대조(A6-2) 저장. records kind place_snapshot(parent = 지점 id, id=<지점>:<플랫폼>)과 점포 할 일 store_task(id place:<지점>:<플랫폼>:<항목>, reportId '').
// 스위치 a6_place_check(기본 꺼짐, 소유자 단위)는 이 파일에서만 읽고, 읽기 실패는 꺼짐으로 본다. 꺼져 있으면 쓰기는 409이고 사실 저장 응답은 바이트 동일하다(placeTasksAfterFact가 {}).
// 권한: 스냅샷 입력은 대표·관리자(직원 403), 할 일 처리는 기존 점포 할 일(save_task)과 같이 구성원 모두. 호출자(app/api/place-checks/route.ts)가 소유자 변경 잠금을 가진다.
// fact_missing의 자료 요청은 lib/data-requests-server.ts placeCheckRequests가 만든다(스위치 a6_data_requests). 모델 호출·외부 네트워크 0이고 URL을 열지 않는다.
export type PlaceCheckAction='save_snapshot'|'save_task';
const ACTIONS:readonly string[]=['save_snapshot','save_task'];
export const PLACE_CHECK_MESSAGES={
 off:'플레이스 대조 기능이 꺼져 있습니다. 소유자가 기능 스위치 a6_place_check를 켜야 합니다.',
 adminOnly:'플레이스 스냅샷 입력은 대표·관리자만 할 수 있습니다.',
 archived:'보관한 지점입니다.',
 platform:'지원하는 플랫폼은 네이버 플레이스(naver_place)뿐입니다.',
 url:'네이버 플레이스·네이버 지도 주소(https://place.naver.com, https://map.naver.com)만 입력할 수 있습니다.',
 future:'확인일은 오늘까지 입력하세요.',
 fields:'플레이스 항목은 주소·영업시간·휴무·전화·메뉴 가격만 입력할 수 있습니다.',
 stale:'플레이스 스냅샷이 그사이 바뀌었습니다. 새로고침한 뒤 다시 입력하세요.',
 notPlaceTask:'플레이스 대조 할 일이 아닙니다. 보고서 할 일은 진단·실행 과제 탭에서 처리하세요.',
} as const;
const FIELD_LABELS:Record<PlaceField,string>={address:'주소',hours:'영업시간',closed_days:'휴무',phone:'전화',menu_price:'메뉴 가격'};

export async function placeCheckOn(owner:string){
 return isEnabled(owner,'a6_place_check').catch(()=>{console.error('a6_place_check_flag_unreadable');return false});
}
async function readOptional<T>(owner:string,kind:string,id:string):Promise<T|undefined>{
 try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return undefined;throw e}
}
const storeTasks=(owner:string,storeId:string)=>listRecords<StoreTask>(owner,'store_task',storeId);
const brandFacts=(owner:string,brandId:string)=>listRecords<BrandFact>(owner,'brand_fact',brandId);
async function activeStore(owner:string,raw:unknown){
 const store=await readRecord<Store>(owner,'store',str(raw,'지점',100,true));
 if(store.status!=='active')throw new ApiError(409,PLACE_CHECK_MESSAGES.archived);
 return store;
}

// 조회: 지점의 스냅샷과 플레이스 할 일. 스위치와 무관하게 읽는다(enabled로 상태를 알린다). 사람은 id·역할만 담는다.
export async function listPlaceChecks(owner:string,storeId:string){
 const store=await readRecord<Store>(owner,'store',storeId);
 const [snapshots,tasks]=await Promise.all([listRecords<PlaceSnapshot>(owner,'place_snapshot',store.id),storeTasks(owner,store.id)]);
 return {enabled:await placeCheckOn(owner),snapshots,tasks:tasks.filter(isPlaceTask)};
}

// 스냅샷 입력: 플랫폼, 공식 호스트 https URL, 오늘까지의 확인일, 다섯 항목 이하(항목당 글자 상한). 모르는 항목은 400이다.
function snapshotInput(input:Record<string,unknown>){
 const platform=input.platform??'naver_place';
 if(typeof platform!=='string'||!Object.hasOwn(PLACE_PLATFORMS,platform))throw new ApiError(400,PLACE_CHECK_MESSAGES.platform);
 const url=placeUrl(platform as PlacePlatform,input.url);
 if(!url)throw new ApiError(400,PLACE_CHECK_MESSAGES.url);
 const checkedAt=localDate(input.checkedAt,'확인일',true);
 if(checkedAt>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}))throw new ApiError(400,PLACE_CHECK_MESSAGES.future);
 const raw=input.fields;
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!(PLACE_FIELDS as readonly string[]).includes(k)))throw new ApiError(400,PLACE_CHECK_MESSAGES.fields);
 const given=raw as Record<string,unknown>;
 const fields=Object.fromEntries(PLACE_FIELDS.map(f=>[f,str(given[f]??'','플레이스 '+FIELD_LABELS[f],PLACE_LIMITS.field[f])])) as Record<PlaceField,string>;
 return {platform:platform as PlacePlatform,url,checkedAt,fields};
}

// 스냅샷 저장: 지금 유효한 확정 사실과 대조해 결과를 싣고, 할 일을 열거나(conflict·place_missing) 닫는다(match). version 비교(CAS)로 409를 낸다. 스냅샷과 할 일은 한 batch다.
async function saveSnapshot(owner:string,input:Record<string,unknown>,by:PlaceActor){
 const store=await activeStore(owner,input.storeId),{platform,url,checkedAt,fields}=snapshotInput(input);
 const id=`${store.id}:${platform}`,old=await readOptional<PlaceSnapshot>(owner,'place_snapshot',id);
 if(old?input.version!==old.version:input.version!==undefined&&input.version!==null&&input.version!==0)throw new ApiError(409,PLACE_CHECK_MESSAGES.stale);
 const now=stamp(),result=compareSnapshot({brandId:store.brandId,storeId:store.id,fields,facts:await brandFacts(owner,store.brandId),now:Date.parse(now)});
 const snapshot:PlaceSnapshot={id,storeId:store.id,brandId:store.brandId,platform,url,checkedAt,checkedBy:by,fields,result,version:(old?.version??0)+1,updatedAt:now,history:withHistory(old)};
 const tasks=planPlaceTasks({snapshot,result,tasks:await storeTasks(owner,store.id),now});
 await database().batch([recordStatement(owner,'place_snapshot',id,snapshot,store.id),...tasks.map(t=>recordStatement(owner,'store_task',t.id,t,store.id))]);
 return {snapshot,tasks};
}

// 플레이스 할 일 수동 처리: 기존 점포 할 일(save_task)과 같은 권한·규칙(완료는 근거 필수, 오래된 version 409). 보고서 할 일은 400이다.
async function saveTask(owner:string,input:Record<string,unknown>){
 const store=await activeStore(owner,input.storeId),old=await readOptional<StoreTask>(owner,'store_task',str(input.id,'할 일',200,true));
 if(!old||old.storeId!==store.id||!isPlaceTask(old))throw new ApiError(400,PLACE_CHECK_MESSAGES.notPlaceTask);
 checkedVersion(old,input.version);
 const status=option(input.status,['open','done'] as const,'처리 상태'),evidence=str(input.evidence??'','완료 근거',3000,status==='done');
 const task:StoreTask={...old,status,evidence,version:old.version+1,updatedAt:stamp()};
 await recordStatement(owner,'store_task',task.id,task,store.id).run();
 return {task};
}

// 판정 순서: 모르는 작업 400 → 권한 403 → 스위치 꺼짐 409 → 지점(없음 404·보관 409) → 입력 400 → 판 409.
export async function placeCheckAction(owner:string,input:Record<string,unknown>,who:Pick<Actor,'id'|'role'>){
 const action=String(input.action);
 if(!ACTIONS.includes(action))throw new ApiError(400,'지원하지 않는 작업입니다.');
 if(action==='save_snapshot'&&who.role!=='owner'&&who.role!=='admin')throw new ApiError(403,PLACE_CHECK_MESSAGES.adminOnly);
 if(!await placeCheckOn(owner))throw new ApiError(409,PLACE_CHECK_MESSAGES.off);
 return (action as PlaceCheckAction)==='save_snapshot'?saveSnapshot(owner,input,{id:who.id,role:who.role}):saveTask(owner,input);
}

// 지점(없으면 브랜드 전체) 스냅샷을 지금 유효한 사실과 다시 대조해 일치하는 열린 할 일을 닫는다(멱등, 열지는 않는다). 스냅샷은 바꾸지 않는다.
export async function recheckPlaceSnapshots(owner:string,brandId:string,storeId?:string,note=''){
 const snapshots=(await listRecords<PlaceSnapshot>(owner,'place_snapshot',storeId)).filter(s=>s.brandId===brandId);
 if(!snapshots.length)return [] as StoreTask[];
 const facts=await brandFacts(owner,brandId),now=stamp();
 const closed=(await Promise.all(snapshots.map(async s=>planPlaceTasks({snapshot:s,result:compareSnapshot({brandId,storeId:s.storeId,fields:s.fields,facts,now:Date.parse(now)}),tasks:await storeTasks(owner,s.storeId),now,closeOnly:true,note})))).flat();
 if(closed.length)await database().batch(closed.map(t=>recordStatement(owner,'store_task',t.id,t,t.storeId)));
 return closed;
}
// 사실 저장 뒤(lib/data-requests-server.ts afterFactSaved). 스위치 꺼짐이면 {}(응답 바이트 동일), 켜짐이면 {closedPlaceTasks: 닫은 수},
// 닫기가 실패하면 사실 저장은 유지하고 {closedPlaceTasks:null}이다(다음 스냅샷 입력이나 사실 저장 때 다시 닫힌다). 확정 사실이 아니면 0이다.
export async function placeTasksAfterFact(owner:string,fact:Pick<BrandFact,'id'|'version'|'brandId'|'storeId'|'status'>):Promise<{closedPlaceTasks?:number|null}>{
 if(!await placeCheckOn(owner))return {};
 if(fact.status!=='confirmed')return {closedPlaceTasks:0};
 try{return {closedPlaceTasks:(await recheckPlaceSnapshots(owner,fact.brandId,fact.storeId,` · 사실 ${fact.id} v${fact.version} 저장 뒤`)).length}}
 catch{console.error('place_task_recheck_failed');return {closedPlaceTasks:null}}
}

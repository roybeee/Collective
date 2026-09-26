// 서버 기능 스위치(F2a). 알려진 플래그와 기본값은 이 파일의 상수가 정본이다. 저장은 소유자 범위 records(kind 'feature_flag', id=플래그 이름, 플래그당 1행)다.
// 저장된 행이 없으면 코드 기본값을 쓴다. 캐시 없음: isEnabled는 호출마다 D1에서 1행을 읽으므로 쓰기(켜기·끄기·기본값 복귀)는 다음 요청부터 바로 반영된다(게시 불필요).
// 쓰기 권한은 워크스페이스 소유자만이다(app/api/feature-flags/route.ts requireOwnerActor). 스위치는 채점·귀속 같은 서버 동작을 바꾸므로 서버 평가(F1b-2)와 같은 등급을 쓴다.
import {ApiError,database,listRecords,recordStatement,stamp} from './server';

export const FEATURE_FLAGS={
 online_grading:{defaultEnabled:false,description:'운영 작업물 저장 뒤 결정론 채점기를 온라인으로 돌려 기록한다(F2 온라인 채점).'},
 b1_reason_required:{defaultEnabled:false,description:'수정 요청·반려 때 사유 코드 선택을 필수로 한다(B1 판정 로그).'},
 a4_auto_attribution:{defaultEnabled:false,description:'추적 코드가 맞는 주문을 캠페인에 자동 귀속한다(A4 점포 실측).'},
 a2_downgrade:{defaultEnabled:false,description:'규제 가드레일 차단 위반을 작업물에 규제 점검 차단으로 표시하고, 품질 검수 판정을 수정 필요로만 낮춘다(A2 런타임 하향, 법률 자문 아님).'},
 a7_repair_turn:{defaultEnabled:false,description:'심층 조사 결과가 형식 오류로 버려지거나 출처 번호 충돌로 근거가 빠질 때 같은 조사에 수리 요청을 1회 보낸다(토큰 사용, 예산 가드 적용).'},
 r_franchise:{defaultEnabled:false,description:'가맹 모집 화면과 쓰기 API(리드·연락처·제공 증빙·가맹 설정)를 켠다. 꺼도 조회·연락처 보기·내보내기·파기·정보주체 요청 처리는 계속된다(트랙 R, COLLECTIVE 휴리스틱 · 법률 자문 아님).'},
 a3_copy_pack:{defaultEnabled:false,description:'콘텐츠 역할 단독 실행을 카피 팩 v2 계약으로 받는다(채널당 3~5안 카피·숏폼 장면 배열·제안 실험을 작업물에 구조화 저장). 팩 형식 문제는 작업물을 막지 않고 표시만 한다.'},
} as const satisfies Record<string,{defaultEnabled:boolean;description:string}>;
export type FeatureFlag=keyof typeof FEATURE_FLAGS;
export type FlagAuthor={id:string;email:string|null};
type StoredFlag={flag:FeatureFlag;enabled:boolean;updatedAt:string;updatedBy:FlagAuthor};
export type FeatureFlagState={flag:FeatureFlag;enabled:boolean;defaultEnabled:boolean;source:'default'|'override';description:string;updatedAt:string|null;updatedBy?:FlagAuthor|null};

export const isFeatureFlag=(value:unknown):value is FeatureFlag=>typeof value==='string'&&Object.hasOwn(FEATURE_FLAGS,value);
function knownFlag(value:unknown){
 if(!isFeatureFlag(value))throw new ApiError(400,'알 수 없는 기능 스위치입니다. 코드에 등록된 스위치만 바꿀 수 있습니다.');
 return value;
}
const flagId=(owner:string,flag:FeatureFlag)=>`${owner}:feature_flag:${flag}`;
function stateOf(flag:FeatureFlag,saved?:StoredFlag):FeatureFlagState{
 const {defaultEnabled,description}=FEATURE_FLAGS[flag],override=typeof saved?.enabled==='boolean';
 return {flag,enabled:override?saved!.enabled:defaultEnabled,defaultEnabled,source:override?'override':'default',description,updatedAt:override?saved!.updatedAt:null,updatedBy:override?saved!.updatedBy:null};
}
// 소유자가 아닌 역할에게 보낼 때 변경자(updatedBy)를 뺀다.
export const withoutAuthor=({flag,enabled,defaultEnabled,source,description,updatedAt}:FeatureFlagState):FeatureFlagState=>({flag,enabled,defaultEnabled,source,description,updatedAt});
// 서버 코드가 쓰는 읽기. 모르는 플래그 이름은 400으로 막아 오타가 조용히 기본값으로 빠지지 않게 한다.
export async function isEnabled(owner:string,flag:FeatureFlag){
 const name=knownFlag(flag);
 const row=await database().prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='feature_flag'").bind(flagId(owner,name),owner).first<{data:string}>();
 return stateOf(name,row?JSON.parse(row.data) as StoredFlag:undefined).enabled;
}
// 코드에 등록된 플래그만 돌려준다. 코드에서 사라진 플래그의 저장 행은 무시한다.
export async function listFeatureFlags(owner:string){
 const saved=new Map((await listRecords<StoredFlag>(owner,'feature_flag')).map(r=>[r.flag,r]));
 return (Object.keys(FEATURE_FLAGS) as FeatureFlag[]).map(flag=>stateOf(flag,saved.get(flag)));
}
export async function setFeatureFlag(owner:string,input:Record<string,unknown>,by:FlagAuthor){
 const flag=knownFlag(input.flag);
 if(typeof input.enabled!=='boolean')throw new ApiError(400,'켜기(true) 또는 끄기(false)를 지정하세요.');
 const saved:StoredFlag={flag,enabled:input.enabled,updatedAt:stamp(),updatedBy:{id:by.id,email:by.email}};
 await recordStatement(owner,'feature_flag',flag,saved).run();
 return stateOf(flag,saved);
}
// 저장 행을 지워 코드 기본값으로 되돌린다.
export async function resetFeatureFlag(owner:string,input:Record<string,unknown>){
 const flag=knownFlag(input.flag);
 await database().prepare("DELETE FROM records WHERE id=? AND owner=? AND kind='feature_flag'").bind(flagId(owner,flag),owner).run();
 return stateOf(flag);
}

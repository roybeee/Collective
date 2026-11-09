// 서버 기능 스위치(F2a). 알려진 플래그와 기본값은 이 파일의 상수가 정본이다. 저장은 소유자 범위 records(kind 'feature_flag', id=플래그 이름, 플래그당 1행)다.
// 저장된 행이 없으면 코드 기본값을 쓴다. 캐시 없음: isEnabled는 호출마다 D1에서 1행을 읽으므로 쓰기(켜기·끄기·기본값 복귀)는 다음 요청부터 바로 반영된다(게시 불필요).
// 쓰기 권한은 워크스페이스 소유자만이다(app/api/feature-flags/route.ts requireOwnerActor). 스위치는 채점·귀속 같은 서버 동작을 바꾸므로 서버 평가(F1b-2)와 같은 등급을 쓴다.
import {ApiError,database,listRecords,recordStatement,stamp} from './server';

export const FEATURE_FLAGS={
 meta_ads_capi:{defaultEnabled:false,description:'별도 전환 연결과 고객 동의를 확인한 구매 이벤트를 같은 식별자로 전송한다. 철회·주문 변경 시 대기 전송을 차단한다.'},
 meta_ads_execution:{defaultEnabled:false,description:'소유자가 승인한 범위에서 광고를 활성화하고 지출·기간을 감시한다. 꺼도 기존 실행의 확인·긴급 정지는 계속된다.'},
 meta_ads_child_create:{defaultEnabled:false,description:'현재 검수·원본 업로드 영수증·PAUSED 부모 아래 광고세트와 소재와 광고를 단계별 생성한다. 광고세트/광고는 PAUSED 고정, 미확정 단계 재전송 금지, ACTIVE 없음.'},
 meta_ads_image_upload:{defaultEnabled:false,description:'검수 원본 PNG를 별도 쓰기 연결로 Meta 이미지 라이브러리에 한 번 업로드한다. 광고 생성·활성화 없음. 결과 미확인 재업로드 금지.'},
 meta_ads_bundle:{defaultEnabled:false,description:'소유자가 외부 광고 구성·계정·부모·PAUSED 상태를 읽기 검증한다. 외부 생성·활성화·지출 없음.'},
 meta_ads_paused_write:{defaultEnabled:false,description:'소유자가 별도 쓰기 권한·현재 계획/소재 검수·명시 확인을 거쳐 Meta에 PAUSED 판매 캠페인만 만든다. 광고세트·광고·예산·ACTIVE 변경 없음. 꺼도 결과 미확인 작업의 읽기 대조·연결 해제는 가능하다.'},
 online_grading:{defaultEnabled:false,description:'운영 작업물 저장 뒤 결정론 채점기를 온라인으로 돌려 기록한다(F2 온라인 채점).'},
 b1_reason_required:{defaultEnabled:false,description:'수정 요청·반려 때 사유 코드 선택을 필수로 한다(B1 판정 로그).'},
 a4_auto_attribution:{defaultEnabled:false,description:'추적 코드가 맞는 주문을 캠페인에 자동 귀속한다(A4 점포 실측).'},
 a2_downgrade:{defaultEnabled:false,description:'규제 가드레일 차단 위반을 작업물에 규제 점검 차단으로 표시하고, 품질 검수 판정을 수정 필요로만 낮춘다(A2 런타임 하향, 법률 자문 아님).'},
 a7_repair_turn:{defaultEnabled:false,description:'심층 조사 결과가 형식 오류로 버려지거나 출처 번호 충돌로 근거가 빠질 때 같은 조사에 수리 요청을 1회 보낸다(토큰 사용, 예산 가드 적용).'},
 r_franchise:{defaultEnabled:false,description:'가맹 모집 화면과 쓰기 API(리드·연락처·제공 증빙·가맹 설정)를 켠다. 꺼도 조회·연락처 보기·내보내기·파기·정보주체 요청 처리는 계속된다(트랙 R, COLLECTIVE 휴리스틱 · 법률 자문 아님).'},
 a3_copy_pack:{defaultEnabled:false,description:'콘텐츠 역할 단독 실행을 카피 팩 v2 계약으로 받는다(채널당 3~5안 카피·숏폼 장면 배열·제안 실험을 작업물에 구조화 저장). 팩 형식 문제는 작업물을 막지 않고 표시만 한다.'},
 a3_brand_voice:{defaultEnabled:false,description:'대표·관리자가 확정한 브랜드 말투(어조·쓸 것·피할 것·선호 표현·피할 표현·예시)를 크리에이티브·콘텐츠 역할 입력에 싣는다. 초안은 싣지 않는다. 꺼도 말투 원장 조회·편집은 계속된다.'},
 a6_data_requests:{defaultEnabled:false,description:'작업물의 자료 필요 표지를 자료 요청으로 모으고, 관리자가 같은 항목의 사실을 확정하면 요청을 자동으로 닫는다(A6 자료 요청, 모델 호출 없음). 꺼도 조회는 계속된다.'},
 a6_place_check:{defaultEnabled:false,description:'관리자가 옮겨 적은 지점 플레이스 정보(주소·영업시간·휴무·전화·메뉴 가격)를 확정 사실과 대조해 다른 항목을 점포 할 일로 열고, 다시 일치하면 닫는다(A6-2, 모델 호출·스크래핑 없음). 꺼도 조회는 계속된다.'},
 a8_customer_report:{defaultEnabled:false,description:'대표·관리자가 끝난 주의 점포 고객 보고서(장부·POS 대조·north-star·채널 단위경제·커넥터 참고값)를 미리 보고 동결하며, 사실 팩을 받는다. 대표가 동결 판을 검토한다(A8, 모델 호출 없음). 꺼도 동결한 보고서 목록·다운로드는 계속된다.'},
 b4_reward_lineage:{defaultEnabled:false,description:'대표·관리자가 사람 판정·발행·반응·주문 보상을 프롬프트 버전·학습 규칙별로 모은 보상 계보(읽기 전용 집계)를 본다(B4 2부, 모델·커넥터 호출 없음). 자동 승격·강등은 없다.'},
 b3_playbook_signals:{defaultEnabled:false,description:'대표·관리자가 학습 화면에서 브랜드×역할 교정 묶음(90일 5건 이상이면 규칙 초안 대상)·운영자 선호 규칙별 피드백·같은 사유 재발률(4주)을 본다(B3-2a, 읽을 때 계산, 모델 호출 없음). 규칙 상태·만료를 자동으로 바꾸지 않는다.'},
 crypto_v1_write:{defaultEnabled:false,description:'연결 자격증명(AI 연결·성과 수집 채널·Buffer 발행)을 새 암호문 형식(키 ID·저장 위치 AAD)과 현재 키로 쓰고, 옛 형식·이전 키 암호문은 읽을 때 현재 키로 다시 쓴다. 대표 전체 재암호화도 켜져 있을 때만 된다. 켜면 이전 코드로 롤백했을 때 새로 쓴 연결을 읽지 못한다(security-ops-6).'},
 collect_guard:{defaultEnabled:false,description:'성과 자동 수집(워커)이 인증 오류(토큰 무효·연결 없음)를 만나면 그 대상을 바로 멈추고 재연결 필요로 표시하며, 연속 실패가 늘면 다음 시도 간격을 6→12→24시간으로 늘린다(PR 4b security-ops-5). 꺼도 실패 분류·실험 카드 경고·워크스페이스 알림은 계속된다.'},
 a4_png_code:{defaultEnabled:false,description:'관리자가 게시 코드가 있는 발행 초안에 코드를 그린 파생 PNG를 만들어 연결하고, 승인하면 그 파생 PNG를 앱 공개 주소로 제공한다(A4-4, 원본 소재 PNG·해시는 그대로, 승인 때 코드 PNG 확인 필수). 끄면 파생 PNG가 연결된 초안은 승인·접수하지 않는다(취소는 가능).'},
 b2_digest_queue:{defaultEnabled:false,description:'워커 tick이 주 1회 지난주 품질 집계(역할×프롬프트 버전×보고 모델)와 드리프트 경보(보고 모델·게이트웨이 변경, 역할 무효율 2배, 골든 스모크 하락, 토큰 예산 소진율)·보존 정리 제안을 기록한다(B2 2단계, 모델 호출 없음). 캠페인·작업물 상태는 바꾸지 않는다.'},
 input_diet:{defaultEnabled:false,description:'역할·회의·브리프 입력을 줄인다(PR 4b): 캠페인 메타 제거, 선행 작업물 섹션별 예산(모든 섹션 포함), 회의 단계별 작업물 축소(품질 재검토 본문 중복 제거), 브랜드 자료 역할별 요약(digest)과 입력 상한. 확정 사실·근거 규율·출력 계약은 그대로다. 켜기 전에 레인 Q 쌍 평가가 필요하다.'},
 b3_reflector:{defaultEnabled:false,description:'대표·관리자가 같은 브랜드×역할 교정 5건 이상 묶음을 Reflector 전용 HERMES 격리 프로필에 1회 보내 운영자 선호 규칙 초안(최대 5개, 인용 필수, 초안만·승인은 사람)을 제안받는다(B3-2, 토큰 사용·예산 가드 적용). 미리보기 확인·개인정보 탐지 시 전송 차단·대표 격리 확인이 있어야 보낸다.'},
 storefront_pull:{defaultEnabled:false,description:'워커 tick이 소유자가 켠 판매처 주문 조회 연결을 간격마다 1페이지씩 읽어(읽기 전용, 고객 정보 없음) 기존 주문 장부에 반영한다. 커서는 저장과 같은 묶음에서만 전진한다.'},
 growth_daily_loop:{defaultEnabled:false,description:'워커 tick이 KST 하루 1회 지점 캠페인마다 자사 장부 신호를 감지하고 문의 기한·신호·교훈 확인·실험 분석·예약 대사·미션 기한 안건을 기록한다. 게시·지출·발주·고객 발송·프롬프트 승격은 하지 않는다.'},
 product_research:{defaultEnabled:false,description:'상품 리서치 탭과 점수표·MD 선정 메모·선정 결정·운영자 랭킹 가져오기를 켠다. 외부 API 호출은 product_research_collect가 따로 켠다. 발주·결제·공급자 연락 없음.'},
 product_research_collect:{defaultEnabled:false,description:'워커 tick이 하루 1회 공식 API(네이버 검색광고·데이터랩·쇼핑 검색, YouTube, 쿠팡 파트너스)로 상품 리서치 지표를 모은다. 출처별 하루 쿼터 안에서만 호출하고 robots·약관 금지 출처는 부르지 않는다.'},
 publication_auto_link:{defaultEnabled:false,description:'워커가 예약 접수된 발행의 Buffer 상태를 30분마다 확인하고(예약 1시간 전~7일 뒤), 게시 확인·실험 연결·Instagram 게시물 ID가 모두 있는 발행을 그 실험 안의 성과 자동 수집 대상으로 등록한다(PR 4b loop-2). 꺼도 발행–실험 연결과 게시물 ID 입력은 계속된다.'},
 meeting_choice_gate:{defaultEnabled:false,description:'회의 합의 단계에 남은 이견이 있으면 첫 개선 단계를 승인 대기로 멈추고, 사용자가 A/B·보류를 고른 뒤에만 다음 단계를 제출한다(X2). 꺼져 있으면 선택은 기록·전달만 하고 회의는 멈추지 않는다.'},
 store_browser_execution:{defaultEnabled:false,description:'등록한 로컬 장치가 지정된 네이버 점포의 영업시간을 조회하고, 관리자가 승인한 전후값만 한 번 저장한다. 대상·판·제출 허가를 확인하며 결과 미확인 작업은 조회로만 대사한다. 로그인·보안 차단은 사람에게 인계한다. 꺼도 기존 결과 조회·장치 회수·미확인 대사는 계속된다.'},
 ai_image_disclosure:{defaultEnabled:false,description:'AI 출처(ai·ai_edited)로 등록한 소재 PNG에 저장 전 기계판독 표시(iTXt ai-disclosure, AI 기본법 31조)를 넣고, 표시·출처 불명 경고·반출(앱 공개 사본·Meta 이미지 업로드) 감사 기록을 남긴다(C2). 출처 불명은 표시하지 않고 막지 않는다. 가시 표시 줄은 화면 경로가 그린다. 꺼져 있으면 바이트·기록 모두 이전과 같다.'},
 pos_tossplace:{defaultEnabled:false,description:'워커 tick이 소유자가 켠 토스플레이스 POS 연결의 주문·결제를 간격마다 1페이지씩 읽어(읽기 전용, 고객 정보 없음) 기존 주문 장부에 출처 POS로 반영하고, 서명된 웹훅을 받는다. 커서는 저장과 같은 묶음에서만 전진한다. 꺼도 연결 설정·조회·저장된 증분 결과 보기는 계속된다(C7).'},
 autonomy_rules:{defaultEnabled:false,description:'소유자가 행동별로 정한 자율성 규칙(자동·확인 후·금지)을 회의 시작·역할 실행·발행 접수·광고 활성화에 적용한다. 금지는 403, 자동은 저위험 행동만 표시한다. 꺼도 규칙 조회·편집은 계속되고 모든 행동은 확인 후로 동작한다(G3).'},
 scheduled_runs:{defaultEnabled:false,description:'워커 tick이 소유자 예약(KST 요일·시각)마다 하루 1회 회의 안건 초안 또는 오늘의 안건 항목을 기록한다(G3, 모델·외부 호출 없음). 전역 중단 중과 회의 시작 금지 규칙에서는 건너뛴 사유만 남긴다. 꺼도 예약 조회·편집은 계속된다.'},
 digest_mail:{defaultEnabled:false,description:'예약 실행 큐가 하루 1회 오늘의 결정 대기·기한·실행 결과·비용을 한 화면 요약으로 만들어 설정된 전송 어댑터에 넘기고 기록한다(G3). 이 판의 mail 어댑터는 기록만 남기는 스텁이며 실제 메일·알림톡은 보내지 않는다.'},
 kakao_bizmessage:{defaultEnabled:false,description:'소유자·관리자가 승인한 카카오 비즈메시지(알림톡 정보성·브랜드 메시지 광고성)를 연결한 딜러사 API로 보내고 결과를 조회한다(C6). 전송 전 광고성 규칙((광고) 머리말·080 수신거부·20:50~08:00 제한·2년 재동의·수신거부·하루 상한)을 다시 판정하며 자동 전송은 없다. 꺼도 판정·초안·승인·수신동의 가져오기·조회는 계속된다.'},
 share_links:{defaultEnabled:false,description:'대표·관리자가 동결 고객 보고서의 읽기 전용 공유 링크와 작업물 판별 외부 검토자 승인 링크(최대 10개)를 만든다(G4, 로그인 없음·만료 기본 14일·최대 90일·취소 가능). 꺼지면 만들기는 409, 공개 주소는 모두 404다. 취소·목록은 계속된다.'},
 creative_score:{defaultEnabled:false,description:'작업물이 저장되면 소재 예측 점수(0~100, 추정·규칙 기반·성과 보장 아님)를 결정론 규칙으로 계산해 기록하고 작업물 옆에 근거와 함께 보인다(G2, 모델 호출 없음). 게시 뒤 노출·클릭이 쌓이면 대표·관리자가 브랜드×채널 보정표를 만든다. 꺼도 저장된 점수 조회는 계속된다.'},
 instagram_direct_publish:{defaultEnabled:false,description:'브랜드에 Instagram 직접 게시 연결(장수명 토큰)이 있으면 승인된 발행의 실행을 Buffer 대신 Instagram Graph API로 보낸다(컨테이너 → 게시 두 단계, 실행 즉시 게시, 결과 미확인 재전송 금지, 게시 한도 사전 확인). 꺼져 있거나 연결이 없으면 Buffer 경로 그대로다(C3). 승인·실행 버튼 없이 보내는 일은 없다.'},
 threads_publish:{defaultEnabled:false,description:'브랜드에 Threads 연결이 있고 Instagram 직접 게시 연결이 없으면 승인된 발행의 실행을 Threads API로 보낸다(텍스트·이미지, 본문 500자, 두 단계, 결과 미확인 재전송 금지). 꺼져 있거나 연결이 없으면 이전 경로 그대로다(C3). 답글은 수집만 하고 자동 답글은 없다.'},
 naver_ads_write:{defaultEnabled:false,description:'소유자·관리자가 승인한 네이버 검색광고 제안(규칙 기반 입찰 조정·중지·재개·키워드/캠페인 생성, 추정·규칙 기반)만 서명한 POST/PUT로 반영하고 읽기 대조로 확인한다(C4). 자동 입찰·자동 적용 없음, 결과 미확인 작업은 재전송하지 않는다. 꺼지면 승인·반영은 409이고 제안 생성·조회·반려·미확인 대조는 계속된다.'},
 brand_autolearn:{defaultEnabled:false,description:'공식 웹사이트·플레이스·SNS 공개 페이지 주소 1개를 서버가 1회 읽어(10초·1MB, 사설 주소 거부, 모델 호출 없음) 이름·로고·색·소개·주소·전화·영업시간·가격·말투 신호를 미확인 후보로 뽑고, 사람이 누르면 사실 원장 확인 후보로 저장하며 첫 캠페인 템플릿 3개로 브리프 초안을 만든다(G1). 확정과 브랜드 색 적용은 사람이 한다. 꺼지면 미리보기·저장·색 적용·템플릿 초안은 409이고 기록 조회는 계속된다.'},
 selection_rewrite:{defaultEnabled:false,description:'제작·발행 캡션 편집기에서 고른 글 한 조각을 소유자·관리자가 확인 카드(무엇·어디·추정 비용)를 거쳐 HERMES에 1회 보내 다시 쓰기·줄이기·톤 바꾸기 제안을 받는다(X6, 토큰 사용, 예산 가드·자율성 규칙 적용). 제안은 비교 화면에서 받기 전까지 반영되지 않고 캡션·발행을 바꾸지 않는다. 꺼지면 요청·조회·결정은 409다.'},
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

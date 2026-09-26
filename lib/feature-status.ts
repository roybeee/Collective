// 설정 '현재 사용할 수 있는 기능' 표(ux-5·eng-hygiene-12). 워크스페이스 응답과 기존 GET 응답(/api/brand-facts·/api/channels·/api/execution)만으로
// 행마다 사용 가능·조건 부족(사유와 해당 화면 링크)·미구현을 계산한다. 입력이 없거나(불러오는 중·실패) 형식이 틀리면 '사용 가능'으로 보이지 않고
// '확인하지 못했습니다' 사유의 조건 부족으로 둔다. 기능을 추가·변경하면 이 표를 함께 고친다(.github/pull_request_template.md '설정 기능표 갱신').
import {effectiveBrandFacts,type BrandFact} from './brand-facts';
import type {NavTab,NavView} from './nav-state';

export type FeatureStatus='available'|'blocked'|'unimplemented';
export const featureStatusLabels:Record<FeatureStatus,string>={available:'사용 가능',blocked:'조건 부족',unimplemented:'미구현'};
// section은 설정 화면 안의 카드 id다(같은 화면이면 그 카드로 스크롤한다). 나머지는 주소 라우팅(lib/nav-state.ts)으로 이동하고, tab이 있으면 그 화면의 탭을 연다.
// 캠페인 상세의 탭은 주소에 싣지 않으므로 캠페인 링크 라벨은 '캠페인을 열어 … 탭에서'로 도착 화면을 그대로 말한다.
export type SettingsSection='settings-ai'|'settings-worker'|'settings-channels';
export type FeatureLink={label:string;view:NavView;brand?:string;campaign?:string;tab?:NavTab;section?:SettingsSection};
export type FeatureRow={key:string;label:string;status:FeatureStatus;reason?:string;link?:FeatureLink};
type CampaignRef={id:string;brandId:string;updatedAt?:string;archivedAt?:string|null};
// expiresAt: GET /api/channels의 토큰 만료 시각. 서버는 만료된 토큰도 connected:true로 주므로 now와 비교해 만료면 연결로 세지 않는다.
type ChannelRef={label:string;connected:boolean;expiresAt?:string|null;expiringSoon?:boolean};
// publishers: 브랜드 id → Buffer 연결 여부(GET /api/execution의 publisher.connected). null은 그 브랜드 확인 실패, 키가 없으면 연결 전이다.
// brandChannels: GET /api/channels의 byBrand(브랜드·지점 단위 자격증명, F5). channels는 워크스페이스 기본(기존 소유자 단위) 상태다.
// flags: GET /api/feature-flags의 flags(기능 스위치 상태 목록). 가맹 모집 행(트랙 R)이 r_franchise 상태를 읽는다.
export type FeatureInput={connection?:unknown;worker?:unknown;brands?:unknown;campaigns?:unknown;facts?:unknown;channels?:unknown;brandChannels?:unknown;publishers?:unknown;flags?:unknown;now?:number};

const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string';
const brandIds=(value:unknown)=>Array.isArray(value)?value.filter(b=>record(b)&&text(b.id)).map(b=>(b as {id:string}).id):[];
const campaignRefs=(value:unknown):CampaignRef[]=>Array.isArray(value)?value.filter((c):c is CampaignRef=>record(c)&&text(c.id)&&text(c.brandId)):[];
const isFact=(f:unknown):f is BrandFact=>record(f)&&['brandId','key','status','source','verifiedAt','validUntil'].every(k=>text(f[k]))&&(f.storeId===undefined||text(f.storeId));
// 현재 유효한 확정 사실(근거·확인 시점·유효 기한 통과, 브랜드·지점 공통)만 센다. 판정은 제작 화면과 같은 effectiveBrandFacts다.
const usableFacts=(facts:BrandFact[],now:number)=>facts.filter(f=>effectiveBrandFacts([f],f.brandId,f.storeId,now).length>0).length;

// F5 성과 수집 자격증명의 연결 상태 4단계(설정 채널 카드·기능표 공용). 만료 시각이 지났으면 만료, 서버가 갱신 필요(expiringSoon)로 주면 만료 임박이다.
export type CredentialState='connected'|'expiring'|'expired'|'none';
export const credentialStateLabels:Record<CredentialState,string>={connected:'연결됨',expiring:'만료 임박',expired:'만료',none:'연결 전'};
export function credentialState(c:{connected?:unknown;expiresAt?:unknown;expiringSoon?:unknown}|null|undefined,now=Date.now()):CredentialState{
 if(!c||c.connected!==true)return 'none';
 return text(c.expiresAt)&&Date.parse(c.expiresAt)<=now?'expired':c.expiringSoon===true?'expiring':'connected';
}
const usableState=(state:CredentialState)=>state==='connected'||state==='expiring';
// byBrand 항목은 channels 항목에 brandId·storeId(지점 단위만)가 붙은 모양이다. connected:true가 아닌 항목과 형식이 틀린 항목은 버린다.
export type ScopedCredential={brandId:string;storeId:string|null;channel:string;connected:true;account:string;expiresAt:string|null;expiringSoon:boolean};
export function scopedCredentials(value:unknown):ScopedCredential[]{
 const one=(c:unknown):ScopedCredential[]=>{if(!record(c))return [];const {brandId,storeId}=c;
  return text(brandId)&&brandId&&text(c.channel)&&c.connected===true?[{brandId,storeId:text(storeId)&&storeId?storeId:null,channel:c.channel,connected:true,account:text(c.account)?c.account:'',expiresAt:text(c.expiresAt)?c.expiresAt:null,expiringSoon:c.expiringSoon===true}]:[]};
 return Array.isArray(value)?value.flatMap(e=>one(e)):[];
}
// 설정 채널 카드의 한 채널 목록: 워크스페이스 브랜드마다 그 브랜드 자신의 브랜드 단위 상태와 지점 단위 자격증명만 보인다(다른 브랜드 것은 섞지 않는다).
export function channelScopes(brands:unknown,channel:string,scoped:ScopedCredential[],now=Date.now()){
 const line=(c?:ScopedCredential)=>({state:credentialState(c,now),account:c?.account||'',expiresAt:c?.expiresAt??null});
 return brandIds(brands).map(brandId=>{const own=scoped.filter(c=>c.channel===channel&&c.brandId===brandId);return {brandId,...line(own.find(c=>!c.storeId)),stores:own.filter(c=>c.storeId).map(c=>({storeId:c.storeId as string,...line(c)}))}});
}

// Buffer 연결은 브랜드 단위로 저장되고 캠페인 실행 상태(GET /api/execution)로만 읽힌다. 브랜드마다 확인에 쓸 캠페인 1개: 보관 안 된 최근 캠페인, 없으면 보관 캠페인.
export function bufferCheckCampaigns(brands:unknown,campaigns:unknown):Record<string,string>{
 const all=campaignRefs(campaigns),latest=(items:CampaignRef[])=>items.reduce<CampaignRef|null>((best,c)=>!best||(c.updatedAt||'')>(best.updatedAt||'')?c:best,null);
 return Object.fromEntries(brandIds(brands).flatMap(id=>{const own=all.filter(c=>c.brandId===id),pick=latest(own.filter(c=>!c.archivedAt))||latest(own);return pick?[[id,pick.id]]:[]}));
}

function aiRow(connection:unknown):FeatureRow{
 const base={key:'ai',label:'8개 담당별 AI 작업 · HERMES 연결'},link:FeatureLink={label:'AI 팀 연결로 이동',view:'settings',section:'settings-ai'};
 if(!record(connection)||typeof connection.configured!=='boolean')return {...base,status:'blocked',reason:'AI 연결 상태를 확인하지 못했습니다',link};
 return connection.configured?{...base,status:'available',reason:connection.provider==='openai'?'OpenAI API로 실행(별도 과금)':'HERMES로 실행'}:{...base,status:'blocked',reason:'HERMES 연결 전 · AI 작업·팀 회의·조사를 실행할 수 없습니다',link};
}
function workerRow(worker:unknown):FeatureRow{
 const base={key:'worker',label:'조사 작업자 연결'},link:FeatureLink={label:'작업자 연결로 이동',view:'settings',section:'settings-worker'},later=' · 앱을 열어 둔 동안만 조사·AI 팀 실행이 이어집니다';
 if(!record(worker))return {...base,status:'blocked',reason:'작업자 상태를 확인하지 못했습니다',link};
 if(worker.online===true)return {...base,status:'available',reason:'서버 작업자 연결됨 · 화면을 닫아도 조사·AI 팀 실행이 이어집니다'};
 return {...base,status:'blocked',reason:(worker.registered===true?'서버 작업자 응답 없음':'서버 작업자 설치 전')+later,link};
}
function pngRow(facts:unknown,brands:string[],now:number):FeatureRow{
 const base={key:'png',label:'PNG 정보 카드'},link:FeatureLink={label:'브랜드 아카이브의 확인 사실로 이동',view:'brands',...(brands[0]?{brand:brands[0],tab:'facts'}:{})};
 if(!Array.isArray(facts))return {...base,status:'blocked',reason:'확정 사실 수를 확인하지 못했습니다',link};
 const count=usableFacts(facts.filter(isFact),now);
 return count?{...base,status:'available',reason:`확정 사실 ${count}건 · 캠페인 제작·발행 탭에서 제작`}:{...base,status:'blocked',reason:'확정 사실 필요(현재 0건)',link};
}
function bufferRow(publishers:unknown,brands:string[],campaigns:unknown):FeatureRow{
 const base={key:'buffer',label:'Instagram 예약 발행(Buffer)'},checks=bufferCheckCampaigns(brands.map(id=>({id})),campaigns);
 const target=record(publishers)?brands.find(id=>publishers[id]!==true&&checks[id]):brands.find(id=>checks[id]);
 const link:FeatureLink=target?{label:'캠페인을 열어 제작·발행 탭에서 연결',view:'campaigns',campaign:checks[target]}:{label:'캠페인을 만든 뒤 제작·발행 탭에서 연결',view:'campaigns'};
 if(!record(publishers))return {...base,status:'blocked',reason:'Buffer 연결 상태를 확인하지 못했습니다',link};
 const connected=brands.filter(id=>publishers[id]===true).length,failed=brands.filter(id=>publishers[id]===null).length;
 const reason=`브랜드별 연결 ${connected}/${brands.length}`+(failed?` · ${failed}개 브랜드 확인 실패`:'');
 return connected?{...base,status:'available',reason}:{...base,status:'blocked',reason,link};
}
// 채널별 상태는 워크스페이스 기본이고(E2E가 사유 맨 앞의 기본 상태를 본다), 뒤에 자기 브랜드·지점 자격증명이 하나라도 쓸 수 있는 브랜드 수를 붙인다(F5).
function measurementRow(channels:unknown,brandChannels:unknown,brands:string[],now:number):FeatureRow{
 const base={key:'measurement',label:'광고 · 게시물 성과 자동 수집'},link:FeatureLink={label:'성과 자동 수집 연결로 이동',view:'settings',section:'settings-channels'};
 if(!Array.isArray(channels))return {...base,status:'blocked',reason:'채널 연결 상태를 확인하지 못했습니다',link};
 const list=channels.filter((c):c is ChannelRef=>record(c)&&text(c.label)&&typeof c.connected==='boolean');
 if(!list.length)return {...base,status:'blocked',reason:'연결할 수 있는 채널이 없습니다',link};
 const expired=(c:ChannelRef)=>text(c.expiresAt)&&Date.parse(c.expiresAt)<=now,usable=(c:ChannelRef)=>c.connected&&!expired(c);
 const known=new Set(brands),linked=new Set(scopedCredentials(brandChannels).filter(c=>known.has(c.brandId)&&usableState(credentialState(c,now))).map(c=>c.brandId)).size;
 const reason=list.map(c=>c.label+(!c.connected?' 연결 전':expired(c)?' 토큰 만료':c.expiringSoon?' 연결됨(토큰 갱신 필요)':' 연결됨')).join(' · ')+' (워크스페이스 기본) · '+(Array.isArray(brandChannels)?`브랜드별 연결 ${linked}/${brands.length} 브랜드`:'브랜드별 연결을 확인하지 못했습니다');
 return list.some(usable)||linked?{...base,status:'available',reason}:{...base,status:'blocked',reason,link};
}

// r_franchise 스위치 상태: 켜짐 true, 꺼짐 false, 목록이 없거나 형식이 틀리면 null(알 수 없음). 설정 기능표의 소유자 켜기·끄기 버튼도 이 값을 쓴다.
export function franchiseSwitch(flags:unknown):boolean|null{
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='r_franchise'):undefined;
 return record(state)&&typeof state.enabled==='boolean'?state.enabled:null;
}
// 가맹 모집 리드 원장(트랙 R R4b)과 캠페인 가맹 모집 목적(R3): 기능 스위치 r_franchise가 켜져 있어야 쓴다(목적 해제는 꺼져도 된다). 스위치는 소유자만 켠다(/api/feature-flags). 게이트 결과는 휴리스틱이다.
function franchiseRow(flags:unknown):FeatureRow{
 const base={key:'franchise',label:'가맹 모집 리드 원장'},link:FeatureLink={label:'가맹 모집 화면으로 이동',view:'franchise'};
 const enabled=franchiseSwitch(flags);
 if(enabled===null)return {...base,status:'blocked',reason:'가맹 모집 스위치 상태를 확인하지 못했습니다',link};
 return enabled?{...base,status:'available',reason:'리드 · 연락처(암호화) · 캠페인 가맹 모집 목적(대표·관리자) · 법정 절차 판정(COLLECTIVE 휴리스틱 · 법률 자문 아님)'}:{...base,status:'blocked',reason:'기능 스위치 r_franchise 꺼짐 · 소유자가 켭니다',link};
}
// 자료 요청(A6-1): 기능 스위치 a6_data_requests 상태를 읽는다. 켜지면 캠페인 상세 '작업물' 탭에서 모으고, 사실 확정으로 자동으로 닫힌다.
function dataRequestsRow(flags:unknown):FeatureRow{
 const base={key:'data-requests',label:'자료 요청(작업물의 자료 필요 → 사실 확정)'},link:FeatureLink={label:'캠페인을 열어 작업물 탭에서 확인',view:'campaigns'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='a6_data_requests'):undefined;
 if(!record(state)||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'자료 요청 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:'작업물의 자료 필요 표지 모으기 · 같은 항목 사실 확정 때 자동 닫힘(모델 호출 없음)'}:{...base,status:'blocked',reason:'기능 스위치 a6_data_requests 꺼짐 · 소유자가 켭니다',link};
}

// 플레이스 대조(A6-2): 기능 스위치 a6_place_check 상태를 읽는다. 켜지면 점포 마케팅 '채널 점검' 탭에서 관리자가 스냅샷을 입력한다.
function placeCheckRow(flags:unknown):FeatureRow{
 const base={key:'place-check',label:'플레이스 정보 대조(수동 스냅샷 → 확정 사실)'},link:FeatureLink={label:'점포 마케팅 채널 점검 탭에서 확인',view:'stores',tab:'channels'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='a6_place_check'):undefined;
 if(!record(state)||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'플레이스 대조 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:'관리자가 옮겨 적은 네이버 플레이스 정보를 확정 사실과 대조 · 다른 항목은 점포 할 일, 다시 일치하면 자동 완료(모델 호출·스크래핑 없음)'}:{...base,status:'blocked',reason:'기능 스위치 a6_place_check 꺼짐 · 소유자가 켭니다',link};
}
// 고객 보고서(A8): 기능 스위치 a8_customer_report 상태를 읽는다. 켜지면 대표·관리자가 끝난 주 보고서를 미리 보고 동결하고, 대표가 검토한다(화면은 A8-3).
function customerReportRow(flags:unknown):FeatureRow{
 const base={key:'customer-report',label:'주간 고객 보고서 · 사실 팩(동결 → 대표 검토)'},link:FeatureLink={label:'점포 마케팅에서 확인',view:'stores'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='a8_customer_report'):undefined;
 if(!record(state)||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'고객 보고서 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:'끝난 주 장부·POS 대조·north-star 결정론 집계 · 동결·대표 검토 · JSON·Markdown·CSV 다운로드(모델 호출 없음)'}:{...base,status:'blocked',reason:'기능 스위치 a8_customer_report 꺼짐 · 소유자가 켭니다',link};
}
// 보상 계보(B4-2b): 기능 스위치 b4_reward_lineage 상태를 읽는다. 켜지면 대표·관리자가 GET /api/reward-lineage로 읽기 전용 집계를 본다(화면은 B4-2c).
function rewardLineageRow(flags:unknown):FeatureRow{
 const base={key:'reward-lineage',label:'보상 계보(프롬프트 버전·학습 규칙별 보상, 읽기 전용)'},link:FeatureLink={label:'학습 화면으로 이동(보상 계보 표는 B4-2c)',view:'learning'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='b4_reward_lineage'):undefined;
 if(!record(state)||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'보상 계보 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:'사람 판정·발행·반응(축소)·주문 귀속 결정론 집계 · 재방문 not_run · 자동 승격·강등 없음(모델 호출 없음, 화면은 B4-2c)'}:{...base,status:'blocked',reason:'기능 스위치 b4_reward_lineage 꺼짐 · 소유자가 켭니다',link};
}
export function featureRows(input:FeatureInput={}):FeatureRow[]{
 const now=typeof input.now==='number'?input.now:Date.now(),brands=brandIds(input.brands);
 return [
  {key:'brand',label:'브랜드 지식과 캠페인',status:'available',reason:'저장 및 수정'},
  aiRow(input.connection),
  {key:'text',label:'카피 · 대본 · 제작 지시서',status:'available',reason:'텍스트 작업물(AI 작성 또는 직접 등록)'},
  {key:'review',label:'작업물 검수와 버전 승인',status:'available',reason:'검토 · 수정 요청 · 승인'},
  {key:'quality-ops',label:'소유자 운영 검증·재채점·프롬프트 적용',status:'available',reason:'품질 콘솔 → 운영 상태 조회 · 쌍 평가 게이트 통과 후 지정 캠페인 적용'},
  {key:'metrics',label:'실측 데이터 · 손익 계산',status:'available',reason:'직접 입력'},
  workerRow(input.worker),
  pngRow(input.facts,brands,now),
  bufferRow(input.publishers,brands,input.campaigns),
  measurementRow(input.channels,input.brandChannels,brands,now),
  franchiseRow(input.flags),
  dataRequestsRow(input.flags),
  placeCheckRow(input.flags),
  customerReportRow(input.flags),
  rewardLineageRow(input.flags),
  {key:'pos-csv',label:'POS 주문 CSV 가져오기',status:'available',reason:'CSV 가져오기 가능(점포 마케팅 → 주문 장부)'},
  {key:'pos-auto',label:'POS 자동 수집',status:'unimplemented',reason:'POS 연동 없음 · CSV로 가져오세요'},
  {key:'video',label:'영상 렌더링',status:'unimplemented',reason:'영상 제작 기능 없음'},
  {key:'ads',label:'광고 집행',status:'unimplemented',reason:'광고 생성·광고비 집행 기능 없음'},
 ];
}

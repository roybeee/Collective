// 설정 '현재 사용할 수 있는 기능' 표(ux-5·eng-hygiene-12). 워크스페이스 응답과 기존 GET 응답(/api/brand-facts·/api/channels·/api/execution)만으로
// 행마다 사용 가능·조건 부족(사유와 해당 화면 링크)·미구현을 계산한다. 입력이 없거나(불러오는 중·실패) 형식이 틀리면 '사용 가능'으로 보이지 않고
// '확인하지 못했습니다' 사유의 조건 부족으로 둔다. 기능을 추가·변경하면 이 표를 함께 고친다(.github/pull_request_template.md '설정 기능표 갱신').
import {effectiveBrandFacts,type BrandFact} from './brand-facts';
import type {NavTab,NavView} from './nav-state';

export type FeatureStatus='available'|'blocked'|'unimplemented';
export const featureStatusLabels:Record<FeatureStatus,string>={available:'사용 가능',blocked:'조건 부족',unimplemented:'미구현'};
// section은 설정 화면 안의 카드 id다(같은 화면이면 그 카드로 스크롤한다). 나머지는 주소 라우팅(lib/nav-state.ts)으로 이동하고, tab이 있으면 그 화면의 탭을 연다.
// 캠페인 안쪽 탭은 주소(ctab, lib/nav-state.ts)에 실리지만 이 링크는 아직 그것을 쓰지 않는다. 그래서 캠페인 링크 라벨은 '캠페인을 열어 … 탭에서'로 도착 화면을 그대로 말한다.
export type SettingsSection='settings-ai'|'settings-worker'|'settings-channels';
export type FeatureLink={label:string;view:NavView;brand?:string;campaign?:string;tab?:NavTab;section?:SettingsSection};
// reason은 화면에서 항목으로 나눠 그린다(MetaLine). 레인 A 행은 항목 배열로 쓰고, 다른 레인 행의 문자열은 featureView가 나눈다.
// flag는 그 행이 읽는 기능 스위치 이름이다. 화면 문구에는 넣지 않고 '자세히'의 기술 정보로만 보인다(평가 9회차 결함 3).
export type FeatureRow={key:string;label:string;status:FeatureStatus;reason?:string|string[];link?:FeatureLink;flag?:string};
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

// 공유 링크(G4): 기능 스위치 share_links 상태를 읽는다. 켜지면 대표·관리자가 점포 마케팅 고객 보고서 탭의 동결본에서 링크를 만든다.
function shareLinksRow(flags:unknown):FeatureRow{
 const base={key:'share-links',label:'보고서 공유 링크, 외부 검토자 승인 링크(로그인 없음)',flag:'share_links'},link:FeatureLink={label:'점포 마케팅 고객 보고서 탭에서 확인',view:'stores'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='share_links'):undefined;
 if(!record(state)||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'공유 링크 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:['동결 보고서 읽기 전용 링크(만료 기본 14일, 취소 가능)','작업물 판별 외부 검토자 승인·수정 요청 링크 최대 10개']}:{...base,status:'blocked',reason:['공유 링크 스위치 꺼짐','소유자가 켭니다'],link};
}
// 소재 예측 점수(G2): 기능 스위치 creative_score 상태를 읽는다. 켜지면 작업물 저장 때 결정론 추정 점수를 기록하고 작업물 옆에 근거를 보인다.
function creativeScoreRow(flags:unknown):FeatureRow{
 const base={key:'creative-score',label:'소재 예측 점수(추정)',flag:'creative_score'},link:FeatureLink={label:'캠페인을 열어 작업물 탭에서 확인',view:'campaigns'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='creative_score'):undefined;
 if(!record(state)||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'소재 예측 점수 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:['저장 때 0~100점 추정 점수와 구성 요소별 근거 기록(규칙 기반, 성과 보장 아님)','게시 뒤 노출·클릭으로 브랜드×채널 보정표 만들기']}:{...base,status:'blocked',reason:['소재 예측 점수 스위치 꺼짐','소유자가 켭니다'],link};
// G1 브랜드 자동 학습: 스위치 brand_autolearn. 꺼져 있어도 실행 기록 조회는 되고 미리보기·후보 저장·색 적용·템플릿 초안만 멈춘다.
function brandAutolearnRow(flags:unknown):FeatureRow{
 const base={key:'brand-autolearn',label:'브랜드 자동 학습(URL→후보)',flag:'brand_autolearn'},link:FeatureLink={label:'홈 시작하기 카드에서 확인',view:'overview'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='brand_autolearn'):undefined;
 if(!record(state)||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'브랜드 자동 학습 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:['공개 페이지 1회 읽기(10초, 1MB, 사설 주소 거부, 모델 호출 없음)','이름·로고·색·소개·주소·전화·영업시간·가격은 미확인 후보, 확정은 사람이 원장에서','첫 캠페인 템플릿 3개는 기존 브리프 저장 경로로 초안만 만듭니다']}:{...base,status:'blocked',reason:['기능 꺼짐','소유자가 켭니다(기록 조회는 가능)'],link};
}
function aiRow(connection:unknown):FeatureRow{
 const base={key:'ai',label:'8개 담당별 AI 작업(HERMES 연결)'},link:FeatureLink={label:'AI 팀 연결로 이동',view:'settings',section:'settings-ai'};
 if(!record(connection)||typeof connection.configured!=='boolean')return {...base,status:'blocked',reason:'AI 연결 상태를 확인하지 못했습니다',link};
 return connection.configured?{...base,status:'available',reason:connection.provider==='openai'?'OpenAI API로 실행(별도 과금)':'HERMES로 실행'}:{...base,status:'blocked',reason:['HERMES 연결 전','AI 작업·팀 회의·조사를 실행할 수 없습니다'],link};
}
function workerRow(worker:unknown):FeatureRow{
 const base={key:'worker',label:'조사 작업자 연결'},link:FeatureLink={label:'작업자 연결로 이동',view:'settings',section:'settings-worker'},later='앱을 열어 둔 동안만 조사·AI 팀 실행이 이어집니다';
 if(!record(worker))return {...base,status:'blocked',reason:'작업자 상태를 확인하지 못했습니다',link};
 if(worker.online===true)return {...base,status:'available',reason:['서버 작업자 연결됨','화면을 닫아도 조사·AI 팀 실행이 이어집니다']};
 return {...base,status:'blocked',reason:[worker.registered===true?'서버 작업자 응답 없음':'서버 작업자 설치 전',later],link};
}
function pngRow(facts:unknown,brands:string[],now:number):FeatureRow{
 const base={key:'png',label:'PNG 정보 카드'},link:FeatureLink={label:'브랜드 아카이브의 확인 사실로 이동',view:'brands',...(brands[0]?{brand:brands[0],tab:'facts'}:{})};
 if(!Array.isArray(facts))return {...base,status:'blocked',reason:'확정 사실 수를 확인하지 못했습니다',link};
 const count=usableFacts(facts.filter(isFact),now);
 return count?{...base,status:'available',reason:[`확정 사실 ${count}건`,'캠페인 제작·발행 탭에서 제작']}:{...base,status:'blocked',reason:'확정 사실 필요(현재 0건)',link};
}
function bufferRow(publishers:unknown,brands:string[],campaigns:unknown):FeatureRow{
 const base={key:'buffer',label:'Instagram 예약 발행(Buffer)'},checks=bufferCheckCampaigns(brands.map(id=>({id})),campaigns);
 const target=record(publishers)?brands.find(id=>publishers[id]!==true&&checks[id]):brands.find(id=>checks[id]);
 const link:FeatureLink=target?{label:'캠페인을 열어 제작·발행 탭에서 연결',view:'campaigns',campaign:checks[target]}:{label:'캠페인을 만든 뒤 제작·발행 탭에서 연결',view:'campaigns'};
 if(!record(publishers))return {...base,status:'blocked',reason:'Buffer 연결 상태를 확인하지 못했습니다',link};
 const connected=brands.filter(id=>publishers[id]===true).length,failed=brands.filter(id=>publishers[id]===null).length;
 const reason=[`브랜드별 연결 ${connected}/${brands.length}`,...(failed?[`${failed}개 브랜드 확인 실패`]:[])];
 return connected?{...base,status:'available',reason}:{...base,status:'blocked',reason,link};
}
// 채널별 상태는 워크스페이스 기본이고(E2E가 사유 맨 앞의 기본 상태를 본다), 뒤에 자기 브랜드·지점 자격증명이 하나라도 쓸 수 있는 브랜드 수를 붙인다(F5).
function measurementRow(channels:unknown,brandChannels:unknown,brands:string[],now:number):FeatureRow{
 const base={key:'measurement',label:'광고와 게시물 성과 자동 수집'},link:FeatureLink={label:'성과 자동 수집 연결로 이동',view:'settings',section:'settings-channels'};
 if(!Array.isArray(channels))return {...base,status:'blocked',reason:'채널 연결 상태를 확인하지 못했습니다',link};
 const list=channels.filter((c):c is ChannelRef=>record(c)&&text(c.label)&&typeof c.connected==='boolean');
 if(!list.length)return {...base,status:'blocked',reason:'연결할 수 있는 채널이 없습니다',link};
 const expired=(c:ChannelRef)=>text(c.expiresAt)&&Date.parse(c.expiresAt)<=now,usable=(c:ChannelRef)=>c.connected&&!expired(c);
 const known=new Set(brands),linked=new Set(scopedCredentials(brandChannels).filter(c=>known.has(c.brandId)&&usableState(credentialState(c,now))).map(c=>c.brandId)).size;
 const reason=[list.map(c=>c.label+(!c.connected?' 연결 전':expired(c)?' 토큰 만료':c.expiringSoon?' 연결됨(토큰 갱신 필요)':' 연결됨')).join(', ')+' (워크스페이스 기본)',Array.isArray(brandChannels)?`브랜드별 연결 ${linked}/${brands.length} 브랜드`:'브랜드별 연결을 확인하지 못했습니다'];
 return list.some(usable)||linked?{...base,status:'available',reason}:{...base,status:'blocked',reason,link};
}

// r_franchise 스위치 상태: 켜짐 true, 꺼짐 false, 목록이 없거나 형식이 틀리면 null(알 수 없음). 설정 기능표의 소유자 켜기·끄기 버튼도 이 값을 쓴다.
export function franchiseSwitch(flags:unknown):boolean|null{
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='r_franchise'):undefined;
 return record(state)&&typeof state.enabled==='boolean'?state.enabled:null;
}
// 가맹 모집 리드 원장(트랙 R R4b)·캠페인 가맹 모집 목적(R3)·모집 자료와 설명회 행사(R15a-2b 화면)·유입 코드와 모집 비용(R5b-1 API): 기능 스위치 r_franchise가 켜져 있어야 쓴다(목적 해제는 꺼져도 된다). 스위치는 소유자만 켠다(/api/feature-flags). 게이트 결과는 휴리스틱이다.
function franchiseRow(flags:unknown):FeatureRow{
 const base={key:'franchise',label:'가맹 모집 리드 원장'},link:FeatureLink={label:'가맹 모집 화면으로 이동',view:'franchise'};
 const enabled=franchiseSwitch(flags);
 if(enabled===null)return {...base,status:'blocked',reason:'가맹 모집 스위치 상태를 확인하지 못했습니다',link};
 return enabled?{...base,status:'available',reason:'리드 · 연락처(암호화) · 캠페인 가맹 모집 목적(대표·관리자) · 모집 자료(승인·내보내기 대표·관리자)·설명회 행사 · 유입 코드·모집 비용(대표·관리자) · 법정 절차 판정(COLLECTIVE 휴리스틱 · 법률 자문 아님)'}:{...base,status:'blocked',reason:'기능 스위치 r_franchise 꺼짐 · 소유자가 켭니다',link};
}
// 자료 요청(A6-1): 기능 스위치 a6_data_requests 상태를 읽는다(스위치 이름은 flag로만 넘긴다). 켜지면 캠페인 상세 '작업물' 탭에서 모으고, 사실 확정으로 자동으로 닫힌다.
function dataRequestsRow(flags:unknown):FeatureRow{
 const base={key:'data-requests',label:'자료 요청(작업물의 자료 필요 → 사실 확정)',flag:'a6_data_requests'},link:FeatureLink={label:'캠페인을 열어 작업물 탭에서 확인',view:'campaigns'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='a6_data_requests'):undefined;
 if(!record(state)||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'자료 요청 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:['작업물의 자료 필요 표지 모으기','같은 항목 사실이 확정되면 자동으로 닫힘(모델 호출 없음)']}:{...base,status:'blocked',reason:['기능 꺼짐','소유자가 켭니다'],link};
}

// 플레이스 대조(A6-2): 기능 스위치 a6_place_check 상태를 읽는다. 켜지면 점포 마케팅 '채널 점검' 탭에서 관리자가 스냅샷을 입력한다.
function placeCheckRow(flags:unknown):FeatureRow{
 const base={key:'place-check',label:'플레이스 정보 대조(직접 옮겨 적은 정보 → 확정 사실)',flag:'a6_place_check'},link:FeatureLink={label:'점포 마케팅 채널 점검 탭에서 확인',view:'stores',tab:'channels'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='a6_place_check'):undefined;
 if(!record(state)||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'플레이스 대조 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:['관리자가 옮겨 적은 네이버 플레이스 정보를 확정 사실과 대조','다른 항목은 점포 할 일로 남기고 다시 일치하면 자동 완료(모델 호출·자동 수집 없음)']}:{...base,status:'blocked',reason:['기능 꺼짐','소유자가 켭니다'],link};
}
// 고객 보고서(A8): 기능 스위치 a8_customer_report 상태를 읽는다. 켜지면 대표·관리자가 끝난 주 보고서를 미리 보고 동결하고, 대표가 검토한다(화면은 A8-3).
function customerReportRow(flags:unknown):FeatureRow{
 const base={key:'customer-report',label:'주간 고객 보고서 · 사실 팩(동결 → 대표 검토)'},link:FeatureLink={label:'점포 마케팅에서 확인',view:'stores'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='a8_customer_report'):undefined;
 if(!record(state)||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'고객 보고서 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:'끝난 주 장부·POS 대조·north-star 결정론 집계 · 동결·대표 검토 · JSON·Markdown·CSV 다운로드(모델 호출 없음)'}:{...base,status:'blocked',reason:'기능 스위치 a8_customer_report 꺼짐 · 소유자가 켭니다',link};
}
// 보상 계보(B4-2b): 기능 스위치 b4_reward_lineage 상태를 읽는다. 켜지면 대표·관리자가 학습 화면 학습 규칙 탭(app/reward-lineage-section.tsx)에서 읽기 전용 집계를 본다.
function rewardLineageRow(flags:unknown):FeatureRow{
 const base={key:'reward-lineage',label:'보상 계보(프롬프트 버전·학습 규칙별 보상, 읽기 전용)',flag:'b4_reward_lineage'},link:FeatureLink={label:'학습 화면 학습 규칙 탭에서 확인',view:'learning'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='b4_reward_lineage'):undefined;
 if(!record(state)||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'보상 계보 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:['사람 판정·발행·반응(축소)·주문 귀속을 정해진 규칙으로 집계','재방문은 아직 집계 전','자동 승격·강등 없음(모델 호출 없음)']}:{...base,status:'blocked',reason:['기능 꺼짐','소유자가 켭니다'],link};
}
// 교정 신호(B3-2a): 기능 스위치 b3_playbook_signals 상태를 읽는다. 켜지면 대표·관리자가 학습 규칙 탭에서 교정 묶음·규칙별 피드백·같은 사유 재발률을 본다.
function playbookSignalsRow(flags:unknown):FeatureRow{
 const base={key:'playbook-signals',label:'교정 신호(교정 묶음·규칙별 피드백·같은 사유 재발률)',flag:'b3_playbook_signals'},link:FeatureLink={label:'학습 화면 학습 규칙 탭에서 확인',view:'learning'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='b3_playbook_signals'):undefined;
 if(!record(state)||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'교정 신호 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:['브랜드×역할 교정이 90일에 5건 이상이면 초안 대상','규칙 버전별 파생 피드백','4주 재발률(읽을 때 계산, 모델 호출과 규칙 자동 변경 없음)']}:{...base,status:'blocked',reason:['기능 꺼짐','소유자가 켭니다'],link};
}
// 주간 품질 집계(B2 2단계): 기능 스위치 b2_digest_queue 상태를 읽는다. 켜지면 워커 tick이 주 1회 집계·드리프트 경보를 남기고 사용량 화면에 역할×프롬프트 버전×보고 모델 표가 보인다.
function qualityDigestRow(flags:unknown):FeatureRow{
 const base={key:'quality-digest',label:'주간 품질 집계 · 드리프트 경보(워커 digest 큐)'},link:FeatureLink={label:'설정의 AI 사용량에서 확인',view:'settings',section:'settings-ai'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='b2_digest_queue'):undefined;
 if(!record(state)||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'주간 품질 집계 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:'조사 작업자가 주 1회 지난주 집계·경보를 기록(모델 호출 없음, 캠페인 상태 변경 없음)'}:{...base,status:'blocked',reason:'기능 스위치 b2_digest_queue 꺼짐 · 소유자가 켭니다',link};
}
// 일일 운영 루프(G2-00/28): 기능 스위치 growth_daily_loop 상태를 읽는다. 켜지면 조사 작업자가 KST 하루 1회 지점 캠페인의 자사 장부 신호 감지와 검토 안건을 기록한다.
function growthDailyRow(flags:unknown):FeatureRow{
 const base={key:'growth-daily',label:'일일 운영 루프(자사 장부 감지·검토 안건)',flag:'growth_daily_loop'},link:FeatureLink={label:'캠페인의 성장·판매 탭에서 확인',view:'campaigns'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='growth_daily_loop'):undefined;
 if(!record(state)||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'일일 운영 루프 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:['조사 작업자가 하루 1회 신호 감지·안건 기록(모델 호출·게시·지출·발송 없음)']}:{...base,status:'blocked',reason:['기능 꺼짐','소유자가 켭니다(“오늘 안건 지금 만들기”는 직접 누를 수 있음)'],link};
}
// 판매처 주문 조회(G2-04/18): 기능 스위치 storefront_pull. 켜지면 조사 작업자가 소유자가 켠 연결을 간격마다 읽는다.
function storefrontPullRow(flags:unknown):FeatureRow{
 const base={key:'storefront-pull',label:'판매처 주문 조회 연결(이어 읽기·재시도)',flag:'storefront_pull'},link:FeatureLink={label:'캠페인의 성장·판매 탭에서 확인',view:'campaigns'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='storefront_pull'):undefined;
 if(!record(state)||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'판매처 조회 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:['켠 연결을 간격마다 1페이지 읽기(고객 정보 없음, 외부 쓰기 없음)']}:{...base,status:'blocked',reason:['기능 꺼짐','소유자가 켭니다'],link};
}
// 가맹 경쟁 브랜드 공공 벤치마크(트랙 R R7a): r_franchise 스위치 뒤. 대표·관리자가 가맹 모집 → 벤치마크 탭에서 공공데이터 키를 저장한 뒤 버튼으로 적재한다(키가 없으면 막힘, 외부 호출 0).
function franchiseBenchmarkRow(flags:unknown):FeatureRow{
 const base={key:'franchise-benchmark',label:'가맹 경쟁 브랜드 공공 벤치마크(공정위 공개 API)'},link:FeatureLink={label:'가맹 모집의 벤치마크 탭으로 이동',view:'franchise',tab:'benchmark'};
 const enabled=franchiseSwitch(flags);
 if(enabled===null)return {...base,status:'blocked',reason:'공공 벤치마크 스위치 상태를 확인하지 못했습니다',link};
 return enabled?{...base,status:'available',reason:'대표·관리자가 공공데이터 키를 저장한 뒤 버튼으로 적재(토큰 0, 주기 조회 없음) · 키가 없으면 적재 막힘 · 타 브랜드 공개 수치이며 자사 예상매출 근거가 아님',link}:{...base,status:'blocked',reason:'기능 스위치 r_franchise 꺼짐 · 소유자가 켭니다',link};
}
// Reflector(B3-2): 기능 스위치 b3_reflector 상태를 읽는다. 켜지면 대표·관리자가 학습 규칙 탭에서 교정 5건 이상 묶음의 규칙 초안을 격리 HERMES로 제안받는다.
function reflectorRow(flags:unknown):FeatureRow{
 const base={key:'reflector',label:'Reflector 규칙 초안 제안(교정 묶음 → 운영자 선호 규칙 초안)'},link:FeatureLink={label:'학습 화면 학습 규칙 탭에서 확인',view:'learning'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='b3_reflector'):undefined;
 if(!record(state)||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'Reflector 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:'교정 5건 이상 · 미리보기 확인 · 개인정보 탐지 시 차단 · 대표 격리 확인 뒤 전용 HERMES 1회 호출(토큰 사용) · 초안만 저장, 승인은 사람'}:{...base,status:'blocked',reason:'기능 스위치 b3_reflector 꺼짐 · 소유자가 켭니다',link};
}
// 상품 리서치·MD 에이전트(docs/PRODUCT-RESEARCH-PLAN.ko.md): 기능 스위치 product_research(탭·점수표·선정)와 product_research_collect(공식 API 자동 수집)를 읽는다.
function productResearchRow(flags:unknown):FeatureRow{
 const base={key:'product-research',label:'상품 리서치·MD 선정(공식 지표 수집·점수표·선정 메모)',flag:'product_research'},link:FeatureLink={label:'상품 리서치 화면에서 확인',view:'research'};
 const find=(name:string)=>Array.isArray(flags)?flags.find(f=>record(f)&&f.flag===name):undefined;
 const main=find('product_research'),collect=find('product_research_collect');
 if(!record(main)||typeof main.enabled!=='boolean')return {...base,status:'blocked',reason:'상품 리서치 스위치 상태를 확인하지 못했습니다',link};
 if(!main.enabled)return {...base,status:'blocked',reason:['기능 꺼짐','소유자가 켭니다'],link};
 const auto=record(collect)&&collect.enabled===true;
 return {...base,status:'available',reason:[auto?'공식 API 하루 1회 자동 수집(출처별 쿼터 안)':'자동 수집 꺼짐, 운영자 가져오기만','점수표와 선정 메모는 근거 인용 필수','발주·결제·공급자 연락 없음'],link};
}
function storeBrowserRow(flags:unknown):FeatureRow{
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='store_browser_execution'):undefined;
 const reason=!record(state)||typeof state.enabled!=='boolean'?'점포 브라우저 관리 상태를 확인하지 못했습니다':state.enabled?['점포별 관리 주소·장치·브라우저 설정 확인 필요','변경 전후 승인 후 한 번 저장, 결과 미확인은 조회로 확인','실제 네이버 적용 여부는 점포별 작업 근거에서 확인']:['기능 꺼짐','소유자가 켭니다'];
 return {key:'store-browser',label:'네이버 점포 영업시간 관리(로컬 장치)',flag:'store_browser_execution',status:'blocked',reason,link:{label:'점포 마케팅 채널 점검에서 연결',view:'stores',tab:'channels'}};
}
// C2 AI 생성 이미지 표시: 스위치 ai_image_disclosure가 켜져 있어야 AI 출처 소재 PNG에 기계판독 표시와 감사 기록이 남는다. 가시 표시 줄은 화면 경로가 따로 그린다.
function aiImageDisclosureRow(flags:unknown):FeatureRow{
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='ai_image_disclosure'):undefined;
 const reason=!record(state)||typeof state.enabled!=='boolean'?'AI 생성 이미지 표시 상태를 확인하지 못했습니다':state.enabled?['AI 출처로 등록한 소재 PNG에 기계판독 표시와 감사 기록','출처 불명 소재는 표시하지 않고 경고만 기록','가시 표시 줄은 화면에서 따로 적용']:['기능 꺼짐','소유자가 켭니다'];
 return {key:'ai-image-disclosure',label:'AI 생성 이미지 표시(AI 기본법 31조)',flag:'ai_image_disclosure',status:'blocked',reason,link:{label:'설정의 AI 사용량에서 확인',view:'settings',section:'settings-ai'}};
}
// POS 자동 수집(C7): 기능 스위치 pos_tossplace 상태를 읽는다. 켜지면 워커가 소유자가 켠 토스플레이스 연결의 주문·결제를 읽기 전용으로 장부에 반영한다(docs/POS-INTEGRATION.ko.md).
function posAutoRow(flags:unknown):FeatureRow{
 const base={key:'pos-auto',label:'POS 자동 수집(토스플레이스)',flag:'pos_tossplace'},link:FeatureLink={label:'캠페인의 성과 탭에서 확인',view:'campaigns'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='pos_tossplace'):undefined;
 if(!record(state)||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'POS 자동 수집 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:'토스플레이스 주문·결제 자동 수집(읽기 전용, 고객 정보 없음, 외부 쓰기 없음)'}:{...base,status:'blocked',reason:['기능 스위치 pos_tossplace 꺼짐','소유자가 켭니다'],link};
}
// C6 카카오 비즈메시지: 스위치 kakao_bizmessage 상태를 읽는다. 켜져도 전송은 사람이 승인한 건만 간다(docs/KAKAO-BIZMESSAGE.ko.md).
function kakaoBizmessageRow(flags:unknown):FeatureRow{
 const base={key:'kakao-bizmessage',label:'카카오 비즈메시지(알림톡·브랜드 메시지)',flag:'kakao_bizmessage'},link:FeatureLink={label:'연결 및 설정에서 확인',view:'settings',section:'settings-channels'};
 const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag==='kakao_bizmessage'):undefined;
 if(!state||typeof state.enabled!=='boolean')return {...base,status:'blocked',reason:'카카오 비즈메시지 스위치 상태를 확인하지 못했습니다',link};
 return state.enabled?{...base,status:'available',reason:'승인한 알림톡·브랜드 메시지를 딜러사 API로 전송(광고성 규칙 판정·수신동의 확인·자동 전송 없음)'}:{...base,status:'blocked',reason:['기능 스위치 kakao_bizmessage 꺼짐','소유자가 켭니다'],link};
}
// G3 자율성 규칙·예약 실행: 스위치 autonomy_rules·scheduled_runs. 꺼져 있어도 규칙·예약 조회·편집은 되고 적용·실행만 멈춘다.
function flagState(flags:unknown,flag:string){const state=Array.isArray(flags)?flags.find(f=>record(f)&&f.flag===flag):undefined;return record(state)&&typeof state.enabled==='boolean'?state.enabled:null}
function autonomyRulesRow(flags:unknown):FeatureRow{
 const base={key:'autonomy-rules',label:'자율성 규칙(행동별 자동·확인 후·금지)',flag:'autonomy_rules'},link:FeatureLink={label:'연결 및 설정에서 확인',view:'settings'},enabled=flagState(flags,'autonomy_rules');
 if(enabled===null)return {...base,status:'blocked',reason:'자율성 규칙 스위치 상태를 확인하지 못했습니다',link};
 return enabled?{...base,status:'available',reason:['회의 시작·역할 실행·발행 접수·광고 활성화에 규칙 적용(금지는 차단, 고위험은 자동 불가)']}:{...base,status:'blocked',reason:['기능 꺼짐','소유자가 켭니다(규칙 편집은 가능, 모든 행동은 확인 후)'],link};
}
function scheduledRunsRow(flags:unknown):FeatureRow{
 const base={key:'scheduled-runs',label:'예약 실행(주간 성과 요약·일일 신호 검토)',flag:'scheduled_runs'},link:FeatureLink={label:'연결 및 설정에서 확인',view:'settings'},enabled=flagState(flags,'scheduled_runs');
 if(enabled===null)return {...base,status:'blocked',reason:'예약 실행 스위치 상태를 확인하지 못했습니다',link};
 return enabled?{...base,status:'available',reason:['조사 작업자가 예약마다 하루 1회 회의 안건 초안·오늘의 안건 항목 기록(모델 호출·게시·지출 없음)']}:{...base,status:'blocked',reason:['기능 꺼짐','소유자가 켭니다(예약 편집은 가능)'],link};
}
// C4 네이버 검색광고 제안·반영: 스위치 naver_ads_write. 꺼져 있어도 제안 생성·조회·반려·미확인 대조는 되고 승인·반영만 409다. 자동 입찰은 없다(docs/NAVER-ADS-WRITE.ko.md).
function naverAdsWriteRow(flags:unknown):FeatureRow{
 const base={key:'naver-ads-write',label:'네이버 검색광고 제안·반영',flag:'naver_ads_write'},link:FeatureLink={label:'연결 및 설정의 성과 수집 채널에서 확인',view:'settings',section:'settings-channels'},enabled=flagState(flags,'naver_ads_write');
 if(enabled===null)return {...base,status:'blocked',reason:'네이버 검색광고 쓰기 스위치 상태를 확인하지 못했습니다',link};
 return enabled?{...base,status:'available',reason:['규칙 기반 입찰 조정·중지 제안(추정)을 관리자가 승인하면 네이버 검색광고에 반영하고 읽기 대조로 확인','자동 입찰·자동 적용 없음(승인 필수, 결과 미확인은 재전송 없음)']}:{...base,status:'blocked',reason:['기능 꺼짐','소유자가 켭니다(제안 생성·조회·대조는 가능, 승인·반영은 막힘)'],link};
}
export function featureRows(input:FeatureInput={}):FeatureRow[]{
 const now=typeof input.now==='number'?input.now:Date.now(),brands=brandIds(input.brands);
 return [
  {key:'brand',label:'브랜드 지식과 캠페인',status:'available',reason:'저장 및 수정'},
  aiRow(input.connection),
  {key:'text',label:'카피, 대본, 제작 지시서',status:'available',reason:'텍스트 작업물(AI 작성 또는 직접 등록)'},
  {key:'review',label:'작업물 검수와 버전 승인',status:'available',reason:['검토','수정 요청','승인']},
  {key:'quality-ops',label:'소유자 운영 검증·재채점·프롬프트 적용',status:'available',reason:'품질 콘솔 → 운영 상태 조회 · 쌍 평가 게이트 통과 후 지정 캠페인 적용'},
  {key:'metrics',label:'실측 데이터와 손익 계산',status:'available',reason:'직접 입력'},
  workerRow(input.worker),
  pngRow(input.facts,brands,now),
  bufferRow(input.publishers,brands,input.campaigns),
  measurementRow(input.channels,input.brandChannels,brands,now),
  franchiseRow(input.flags),
  dataRequestsRow(input.flags),
  placeCheckRow(input.flags),
  customerReportRow(input.flags),
  rewardLineageRow(input.flags),
  playbookSignalsRow(input.flags),
  qualityDigestRow(input.flags),
  growthDailyRow(input.flags),
  storefrontPullRow(input.flags),
  franchiseBenchmarkRow(input.flags),
  reflectorRow(input.flags),
  productResearchRow(input.flags),
  storeBrowserRow(input.flags),
  aiImageDisclosureRow(input.flags),
  autonomyRulesRow(input.flags),
  scheduledRunsRow(input.flags),
  shareLinksRow(input.flags),
  creativeScoreRow(input.flags),
  brandAutolearnRow(input.flags),
  {key:'pos-csv',label:'POS 주문 CSV 가져오기',status:'available',reason:'CSV 가져오기 가능(점포 마케팅 → 주문 장부)'},
  posAutoRow(input.flags),
  kakaoBizmessageRow(input.flags),
  naverAdsWriteRow(input.flags),
  {key:'video',label:'영상 렌더링',status:'unimplemented',reason:'영상 제작 기능 없음'},
  {key:'ads',label:'광고 집행',status:'unimplemented',reason:'광고 생성·광고비 집행 기능 없음'},
  instagramDirectRow(input.flags),
  threadsRow(input.flags),
 ];
}
// C3 직접 게시: 스위치 instagram_direct_publish·threads_publish. 켜져 있어도 브랜드 연결(장수명 토큰)과 사람의 승인·실행이 있어야 보낸다. 꺼져 있으면 Buffer 경로 그대로다.
function instagramDirectRow(flags:unknown):FeatureRow{
 const base={key:'instagram-direct',label:'Instagram 직접 게시(Graph API)',flag:'instagram_direct_publish'},link:FeatureLink={label:'연결 및 설정에서 확인',view:'settings',section:'settings-channels'},enabled=flagState(flags,'instagram_direct_publish');
 if(enabled===null)return {...base,status:'blocked',reason:'Instagram 직접 게시 스위치 상태를 확인하지 못했습니다',link};
 return enabled?{...base,status:'available',reason:['브랜드별 Instagram 직접 게시 연결이 있는 캠페인의 승인된 발행을 실행 때 Graph API로 게시(두 단계, 결과 미확인 재전송 없음)','연결이 없는 브랜드는 Buffer 경로 그대로']}:{...base,status:'blocked',reason:['기능 꺼짐','소유자가 켭니다(꺼져 있으면 Buffer 경로)'],link};
}
function threadsRow(flags:unknown):FeatureRow{
 const base={key:'threads',label:'Threads 게시',flag:'threads_publish'},link:FeatureLink={label:'연결 및 설정에서 확인',view:'settings',section:'settings-channels'},enabled=flagState(flags,'threads_publish');
 if(enabled===null)return {...base,status:'blocked',reason:'Threads 게시 스위치 상태를 확인하지 못했습니다',link};
 return enabled?{...base,status:'available',reason:['브랜드별 Threads 연결이 있는 캠페인의 승인된 발행을 실행 때 Threads API로 게시(텍스트·이미지, 본문 500자)','답글은 수집만, 자동 답글 없음']}:{...base,status:'blocked',reason:['기능 꺼짐','소유자가 켭니다'],link};
}
// 화면에 그릴 모양(평가 9회차 결함 2·3). 사유는 항목 배열로 나눠 MetaLine으로 그리고(가운뎃점 ' · '로 잇지 않는다),
// 기능 스위치 이름(소문자_밑줄)·단계 코드(B4-2c 등)·내부 이름(digest 큐)은 화면 문구에서 빼서 tech로 넘긴다. 화면은 tech를 '자세히' 안 기술 정보로만 보인다.
// 레인 A 행은 lib 문구 자체에 코드가 없고 스위치 이름은 flag로 온다. 다른 레인 행의 문구는 고치지 않고, 여기서 화면에 그릴 때만 코드를 숨긴다.
// 평가 보고서의 검사식(/\b[a-z]\d?_[a-z_]+\b/)은 growth_daily_loop처럼 첫 단어가 두 글자 이상인 스위치를 놓쳐서 넓혔다.
export const INTERNAL_CODE=/\b[a-z][a-z0-9]*_[a-z0-9_]+\b|\bB\d-\d|성장2|digest/;
function plainText(text:string,tech:string[]){
 return text.replace(/\s*\(([^()]*)\)/g,(whole,inner:string)=>INTERNAL_CODE.test(inner)?(tech.push(inner.trim()),''):whole)
  .replace(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g,name=>(tech.push('스위치 이름 '+name),''))
  .replace(/\s*\bB\d-\d\w*/g,code=>(tech.push('단계 '+code.trim()),''))
  .replace(/성장2\s*/g,'').replace(/\s{2,}/g,' ').trim();
}
export type FeatureView={key:string;label:string;status:FeatureStatus;reason:string[];link?:FeatureLink;tech:string[]};
export function featureView(row:FeatureRow):FeatureView{
 const tech:string[]=row.flag?['스위치 이름 '+row.flag]:[];
 const label=plainText(row.label,tech).split(/\s·\s/).join(', ');
 const reason=(Array.isArray(row.reason)?row.reason:row.reason?row.reason.split(/\s·\s/):[]).map(p=>plainText(p,tech)).filter(Boolean);
 return {key:row.key,label,status:row.status,reason,...(row.link?{link:{...row.link,label:plainText(row.link.label,tech)}}:{}),tech:[...new Set(tech)]};
}

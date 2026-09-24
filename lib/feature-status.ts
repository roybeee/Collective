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
export type FeatureInput={connection?:unknown;worker?:unknown;brands?:unknown;campaigns?:unknown;facts?:unknown;channels?:unknown;brandChannels?:unknown;publishers?:unknown;now?:number};

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

export function featureRows(input:FeatureInput={}):FeatureRow[]{
 const now=typeof input.now==='number'?input.now:Date.now(),brands=brandIds(input.brands);
 return [
  {key:'brand',label:'브랜드 지식과 캠페인',status:'available',reason:'저장 및 수정'},
  aiRow(input.connection),
  {key:'text',label:'카피 · 대본 · 제작 지시서',status:'available',reason:'텍스트 작업물(AI 작성 또는 직접 등록)'},
  {key:'review',label:'작업물 검수와 버전 승인',status:'available',reason:'검토 · 수정 요청 · 승인'},
  {key:'metrics',label:'실측 데이터 · 손익 계산',status:'available',reason:'직접 입력'},
  workerRow(input.worker),
  pngRow(input.facts,brands,now),
  bufferRow(input.publishers,brands,input.campaigns),
  measurementRow(input.channels,input.brandChannels,brands,now),
  {key:'pos-csv',label:'POS 주문 CSV 가져오기',status:'available',reason:'CSV 가져오기 가능(점포 마케팅 → 주문 장부)'},
  {key:'pos-auto',label:'POS 자동 수집',status:'unimplemented',reason:'POS 연동 없음 · CSV로 가져오세요'},
  {key:'video',label:'영상 렌더링',status:'unimplemented',reason:'영상 제작 기능 없음'},
  {key:'ads',label:'광고 집행',status:'unimplemented',reason:'광고 생성·광고비 집행 기능 없음'},
 ];
}

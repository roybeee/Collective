// 설정 '현재 사용할 수 있는 기능' 표의 실시간 판정(lib/feature-status.ts, ux-5·eng-hygiene-12).
// 행마다 사용 가능·조건 부족(사유·이동 링크)·미구현 3단계이고, 입력이 없거나 깨졌으면 '사용 가능'으로 보이지 않는다.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const m=moduleFor('lib/feature-status.ts');await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();
const {featureRows,featureStatusLabels,franchiseSwitch,bufferCheckCampaigns,credentialState,credentialStateLabels,scopedCredentials,channelScopes}=m.namespace;
let passed=0;
// vm 모듈의 배열·객체는 다른 realm이라 양쪽 모두 JSON으로 옮겨 비교한다.
const plain=value=>JSON.parse(JSON.stringify(value));
function check(name,actual,expected){assert.deepEqual(plain(actual),plain(expected),name);passed++}
function ok(name,value){assert.ok(value,name);passed++}

const now=Date.parse('2026-09-24T00:00:00.000Z'),day=86400000;
const iso=offset=>new Date(now+offset).toISOString();
const brands=[{id:'ofd'},{id:'oda'},{id:'mapdal'},{id:'mealzip'}];
const fact=(over={})=>({id:'f'+Math.random(),brandId:'ofd',key:'address',value:'서울',status:'confirmed',source:'점주 확인',verifiedAt:iso(-day),validUntil:iso(30*day),version:1,updatedAt:iso(-day),...over});
const channels=(naver,instagram,expiringSoon=false,expiresAt=null)=>[{channel:'naver_ads',label:'네이버 검색광고',connected:naver,expiresAt:null,expiringSoon:false},{channel:'instagram',label:'Instagram',connected:instagram,expiresAt,expiringSoon}];
const full=(over={})=>({connection:{configured:true,provider:'hermes'},worker:{registered:true,online:true},brands,campaigns:[],facts:[fact()],channels:channels(true,false),brandChannels:[],publishers:{ofd:true},now,...over});
// F5: GET /api/channels의 byBrand 항목(브랜드·지점 단위 자격증명의 공개 상태).
const scoped=(over={})=>({brandId:'ofd',storeId:null,channel:'naver_ads',label:'네이버 검색광고',connected:true,account:'acct',expiresAt:null,expiringSoon:false,...over});
const defaults='네이버 검색광고 연결 전 · Instagram 연결 전 (워크스페이스 기본)';
const row=(input,key)=>featureRows(input).find(r=>r.key===key);
const view=r=>r&&{status:r.status,reason:r.reason,link:r.link};

// --- 3단계와 라벨 ----------------------------------------------------------------------
check('status labels are the three user-facing stages',featureStatusLabels,{available:'사용 가능',blocked:'조건 부족',unimplemented:'미구현'});
const rows=featureRows(full());
check('row keys are unique and in display order',rows.map(r=>r.key),['brand','ai','text','review','metrics','worker','png','buffer','measurement','franchise','pos-csv','pos-auto','video','ads']);
ok('every row uses one of the three stages',rows.every(r=>['available','blocked','unimplemented'].includes(r.status)));
ok('the required rows are present by label',['HERMES 연결','조사 작업자 연결','PNG 정보 카드','Instagram 예약 발행(Buffer)','성과 자동 수집','POS 주문 CSV 가져오기'].every(label=>rows.some(r=>r.label.includes(label))));
check('video, ads and POS auto collection are not implemented',['video','ads','pos-auto'].map(k=>row(full(),k).status),['unimplemented','unimplemented','unimplemented']);
check('POS orders can be imported from CSV',view(row(full(),'pos-csv')),{status:'available',reason:'CSV 가져오기 가능(점포 마케팅 → 주문 장부)'});

// --- HERMES 연결 -----------------------------------------------------------------------
check('HERMES connected runs the AI team',view(row(full(),'ai')),{status:'available',reason:'HERMES로 실행'});
check('an OpenAI connection says it is billed separately',row(full({connection:{configured:true,provider:'openai'}}),'ai').reason,'OpenAI API로 실행(별도 과금)');
check('no connection blocks the AI team with a link to the connection card',view(row(full({connection:{configured:false,provider:'hermes'}}),'ai')),{status:'blocked',reason:'HERMES 연결 전 · AI 작업·팀 회의·조사를 실행할 수 없습니다',link:{label:'AI 팀 연결로 이동',view:'settings',section:'settings-ai'}});

// --- 조사 작업자 -----------------------------------------------------------------------
check('an online worker is available',row(full(),'worker').status,'available');
check('a registered but silent worker is blocked with the reason',view(row(full({worker:{registered:true,online:false}}),'worker')),{status:'blocked',reason:'서버 작업자 응답 없음 · 앱을 열어 둔 동안만 조사·AI 팀 실행이 이어집니다',link:{label:'작업자 연결로 이동',view:'settings',section:'settings-worker'}});
check('an unregistered worker is blocked with the install reason',row(full({worker:{registered:false,online:false}}),'worker').reason,'서버 작업자 설치 전 · 앱을 열어 둔 동안만 조사·AI 팀 실행이 이어집니다');

// --- PNG 정보 카드: 현재 유효한 확정 사실 수 --------------------------------------------
check('zero confirmed facts blocks PNG cards and links to the first brand archive',view(row(full({facts:[]}),'png')),{status:'blocked',reason:'확정 사실 필요(현재 0건)',link:{label:'브랜드 아카이브의 확인 사실로 이동',view:'brands',brand:'ofd',tab:'facts'}});
const mixed=[fact(),fact({status:'candidate'}),fact({status:'rejected'}),fact({validUntil:iso(-1)}),fact({verifiedAt:iso(day)}),fact({source:'  '}),fact({brandId:'oda',storeId:'s1',key:'hours'})];
check('only confirmed, sourced and currently valid facts count (brand and store level)',view(row(full({facts:mixed}),'png')),{status:'available',reason:'확정 사실 2건 · 캠페인 제작·발행 탭에서 제작'});
check('candidates and expired facts alone still block',row(full({facts:[fact({status:'candidate'}),fact({validUntil:iso(-day)})]}),'png').reason,'확정 사실 필요(현재 0건)');
check('malformed fact entries are ignored instead of crashing',row(full({facts:[null,'x',{status:'confirmed'},fact({source:undefined}),fact()]}),'png').reason,'확정 사실 1건 · 캠페인 제작·발행 탭에서 제작');

// --- Instagram 예약 발행(Buffer): 브랜드별 연결 ------------------------------------------
const campaigns=[{id:'c-old',brandId:'ofd',updatedAt:iso(-3*day)},{id:'c-new',brandId:'ofd',updatedAt:iso(-day)},{id:'c-arch',brandId:'ofd',updatedAt:iso(0),archivedAt:iso(0)},{id:'c-oda',brandId:'oda',updatedAt:iso(-day),archivedAt:iso(-day)}];
check('no connected brand blocks scheduling and links to a campaign of the first unconnected brand',view(row(full({publishers:{},campaigns}),'buffer')),{status:'blocked',reason:'브랜드별 연결 0/4',link:{label:'캠페인을 열어 제작·발행 탭에서 연결',view:'campaigns',campaign:'c-new'}});
check('one connected brand makes scheduling available with the count',view(row(full({publishers:{oda:true,ofd:false},campaigns}),'buffer')),{status:'available',reason:'브랜드별 연결 1/4'});
check('without campaigns the link opens the campaign list',row(full({publishers:{}}),'buffer').link,{label:'캠페인을 만든 뒤 제작·발행 탭에서 연결',view:'campaigns'});
check('brands whose check failed are named in the reason',row(full({publishers:{ofd:null,oda:false},campaigns}),'buffer').reason,'브랜드별 연결 0/4 · 1개 브랜드 확인 실패');
check('connections of unknown brands are not counted',row(full({publishers:{ghost:true}}),'buffer').reason,'브랜드별 연결 0/4');
check('the check picks the latest non-archived campaign per brand, else an archived one',bufferCheckCampaigns(brands,campaigns),{ofd:'c-new',oda:'c-oda'});
check('the check tolerates missing lists',bufferCheckCampaigns(undefined,null),{});

// --- 성과 자동 수집: 네이버·Instagram 연결 상태 ----------------------------------------
// 채널별 상태는 워크스페이스 기본(기존 소유자 단위 자격증명)이고, 뒤에 브랜드 단위 연결 수가 붙는다(F5).
check('no measurement channel connected is blocked with both states and a link',view(row(full({channels:channels(false,false)}),'measurement')),{status:'blocked',reason:defaults+' · 브랜드별 연결 0/4 브랜드',link:{label:'성과 자동 수집 연결로 이동',view:'settings',section:'settings-channels'}});
check('any connected channel makes collection available and flags token renewal',view(row(full({channels:channels(false,true,true,iso(3*day))}),'measurement')),{status:'available',reason:'네이버 검색광고 연결 전 · Instagram 연결됨(토큰 갱신 필요) (워크스페이스 기본) · 브랜드별 연결 0/4 브랜드'});
// channelStatus는 만료된 토큰도 connected:true·expiringSoon:true로 준다. 만료 시각이 지났으면 연결로 세지 않는다.
check('an expired token alone blocks collection with the channel link',view(row(full({channels:channels(false,true,true,iso(-1))}),'measurement')),{status:'blocked',reason:'네이버 검색광고 연결 전 · Instagram 토큰 만료 (워크스페이스 기본) · 브랜드별 연결 0/4 브랜드',link:{label:'성과 자동 수집 연결로 이동',view:'settings',section:'settings-channels'}});
check('a token expiring exactly now counts as expired',row(full({channels:channels(false,true,true,iso(0))}),'measurement').status,'blocked');
check('another valid connection keeps collection available beside an expired token',view(row(full({channels:[{label:'네이버 검색광고',connected:true,expiresAt:null},{label:'Instagram',connected:true,expiresAt:iso(-day),expiringSoon:true}]}),'measurement')),{status:'available',reason:'네이버 검색광고 연결됨 · Instagram 토큰 만료 (워크스페이스 기본) · 브랜드별 연결 0/4 브랜드'});
check('an unreadable expiry time is not treated as expired',row(full({channels:channels(false,true,false,'not-a-date')}),'measurement').status,'available');
// E2E(설정 기능표)는 '조건 부족 · 네이버 검색광고 연결 전 · Instagram 연결 전'을 부분 문자열로 본다. 기본 상태가 사유 맨 앞에 남아야 한다.
ok('the workspace default states stay at the start of the reason',row(full({channels:channels(false,false)}),'measurement').reason.startsWith('네이버 검색광고 연결 전 · Instagram 연결 전'));

// --- 성과 자동 수집: 브랜드·지점 단위 자격증명(F5) -------------------------------------
check('a brand credential alone makes collection available with the brand count',view(row(full({channels:channels(false,false),brandChannels:[scoped()]}),'measurement')),{status:'available',reason:defaults+' · 브랜드별 연결 1/4 브랜드'});
check('brand and store credentials of one brand count that brand once',row(full({channels:channels(false,false),brandChannels:[scoped(),scoped({channel:'instagram',label:'Instagram'}),scoped({storeId:'s1'})]}),'measurement').reason,defaults+' · 브랜드별 연결 1/4 브랜드');
check('a store credential counts its brand',view(row(full({channels:channels(false,false),brandChannels:[scoped({brandId:'oda',storeId:'s1',channel:'instagram'})]}),'measurement')),{status:'available',reason:defaults+' · 브랜드별 연결 1/4 브랜드'});
check('two brands with their own credentials are counted separately',row(full({channels:channels(true,false),brandChannels:[scoped(),scoped({brandId:'mapdal'})]}),'measurement').reason,'네이버 검색광고 연결됨 · Instagram 연결 전 (워크스페이스 기본) · 브랜드별 연결 2/4 브랜드');
check('an expired brand credential is not counted and blocks without a default',view(row(full({channels:channels(false,false),brandChannels:[scoped({expiresAt:iso(-1),expiringSoon:true})]}),'measurement')),{status:'blocked',reason:defaults+' · 브랜드별 연결 0/4 브랜드',link:{label:'성과 자동 수집 연결로 이동',view:'settings',section:'settings-channels'}});
check('a brand credential expiring soon still counts',row(full({channels:channels(false,false),brandChannels:[scoped({expiresAt:iso(3*day),expiringSoon:true})]}),'measurement').status,'available');
check('credentials of brands outside this workspace are not counted',row(full({channels:channels(false,false),brandChannels:[scoped({brandId:'ghost'})]}),'measurement').reason,defaults+' · 브랜드별 연결 0/4 브랜드');
check('a disconnected brand entry is not counted',row(full({channels:channels(false,false),brandChannels:[scoped({connected:false})]}),'measurement').status,'blocked');
check('an unreadable brand list keeps the default states and says so',view(row(full({channels:channels(true,false),brandChannels:null}),'measurement')),{status:'available',reason:'네이버 검색광고 연결됨 · Instagram 연결 전 (워크스페이스 기본) · 브랜드별 연결을 확인하지 못했습니다'});
// channelStatus의 실제 모양: 브랜드 × 채널마다 브랜드 단위 상태(없으면 connected:false, storeId 없음)와 저장된 지점 단위 상태(storeId 있음).
const statusShape=[...brands.flatMap(b=>['naver_ads','instagram'].map(channel=>({channel,label:channel,connected:b.id==='oda'&&channel==='instagram',account:'',expiresAt:null,expiringSoon:false,updatedAt:null,brandId:b.id}))),{channel:'naver_ads',label:'네이버 검색광고',connected:true,account:'s',expiresAt:iso(-1),expiringSoon:true,updatedAt:iso(-day),brandId:'mapdal',storeId:'s9',warning:'토큰이 만료됐습니다. 새 토큰으로 다시 연결하세요.'}];
check('the channelStatus byBrand shape counts only usable brand and store credentials',row(full({channels:channels(false,false),brandChannels:statusShape}),'measurement').reason,defaults+' · 브랜드별 연결 1/4 브랜드');
check('the channelStatus byBrand shape keeps store entries under their brand',channelScopes(brands,'naver_ads',scopedCredentials(statusShape),now).map(l=>[l.brandId,l.state,l.stores.map(s=>s.storeId+':'+s.state).join()]),[['ofd','none',''],['oda','none',''],['mapdal','none','s9:expired'],['mealzip','none','']]);

// 연결 상태 4단계(설정 채널 카드와 기능표 공용): 연결됨·만료 임박·만료·연결 전.
check('credential state labels are the four card states',credentialStateLabels,{connected:'연결됨',expiring:'만료 임박',expired:'만료',none:'연결 전'});
check('credential states follow connection, expiry and the renewal flag',[credentialState(undefined,now),credentialState({connected:false},now),credentialState({connected:true,expiresAt:null,expiringSoon:false},now),credentialState({connected:true,expiresAt:iso(3*day),expiringSoon:true},now),credentialState({connected:true,expiresAt:iso(-1),expiringSoon:true},now),credentialState({connected:true,expiresAt:iso(0)},now)],['none','none','connected','expiring','expired','expired']);
check('scoped credentials are normalised and malformed entries dropped',scopedCredentials([scoped({storeId:''}),scoped({brandId:'oda',storeId:'s1',account:undefined}),null,'x',{channel:'naver_ads'},{brandId:'ofd'},{brandId:'ofd',channel:'naver_ads'},scoped({connected:false})]),[{brandId:'ofd',storeId:null,channel:'naver_ads',connected:true,account:'acct',expiresAt:null,expiringSoon:false},{brandId:'oda',storeId:'s1',channel:'naver_ads',connected:true,account:'',expiresAt:null,expiringSoon:false}]);
check('scoped credentials tolerate a missing list',scopedCredentials(undefined),[]);
// 채널 카드의 브랜드별 목록: 브랜드마다 자기 자격증명만 보인다(다른 브랜드 자격증명이 섞이지 않는다). 없으면 연결 전.
const lines=channelScopes(brands,'naver_ads',scopedCredentials([scoped({account:'ofd-acct'}),scoped({storeId:'s1',account:'s1-acct',expiresAt:iso(3*day),expiringSoon:true}),scoped({brandId:'oda',channel:'instagram'}),scoped({brandId:'mapdal',expiresAt:iso(-1)}),scoped({brandId:'ghost'})]),now);
check('the card lists every workspace brand in order with its own state',lines.map(l=>[l.brandId,l.state,l.account]),[['ofd','connected','ofd-acct'],['oda','none',''],['mapdal','expired','acct'],['mealzip','none','']]);
check('store credentials are listed under their brand only',lines.map(l=>l.stores.map(s=>[s.storeId,s.state,s.account])),[[['s1','expiring','s1-acct']],[],[],[]]);
check('another channel shows the other brand credential',channelScopes(brands,'instagram',scopedCredentials([scoped({brandId:'oda',channel:'instagram'})]),now).map(l=>l.state),['none','connected','none','none']);

// --- 가맹 모집 리드 원장(트랙 R): 기능 스위치 r_franchise 상태 ---------------------------------
const flagList=enabled=>[{flag:'online_grading',enabled:true},{flag:'r_franchise',enabled}];
check('franchise row is available when r_franchise is on',row(full({flags:flagList(true)}),'franchise').status,'available');
ok('franchise available reason keeps the heuristic disclaimer',row(full({flags:flagList(true)}),'franchise').reason.includes('COLLECTIVE 휴리스틱 · 법률 자문 아님'));
ok('franchise available reason names the campaign recruitment objective (R3)',row(full({flags:flagList(true)}),'franchise').reason.includes('캠페인 가맹 모집 목적(대표·관리자)'));
check('franchise row is blocked with the switch reason when off',view(row(full({flags:flagList(false)}),'franchise')),{status:'blocked',reason:'기능 스위치 r_franchise 꺼짐 · 소유자가 켭니다',link:{label:'가맹 모집 화면으로 이동',view:'franchise'}});
check('unknown or broken flag state is not available',[row(full(),'franchise').status,row(full({flags:'x'}),'franchise').status,row(full({flags:[{flag:'r_franchise'}]}),'franchise').status],['blocked','blocked','blocked']);
check('franchiseSwitch reads on, off and unknown',[franchiseSwitch(flagList(true)),franchiseSwitch(flagList(false)),franchiseSwitch(null),franchiseSwitch([{flag:'r_franchise',enabled:'yes'}]),franchiseSwitch([{flag:'online_grading',enabled:true}])],[true,false,null,null,null]);
{const panelsSrc=readFileSync('app/panels.tsx','utf8');
 ok('only the owner sees the franchise switch button',panelsSrc.includes("r.key==='franchise'&&account?.isOwner&&franchiseOn!==null"));
 ok('the switch button asks first and posts the owner-only flag change',panelsSrc.includes('window.confirm(on?')&&panelsSrc.includes("JSON.stringify({action:'set',flag:'r_franchise',enabled:on})"));
 ok('after switching the sidebar status is re-read without a reload',panelsSrc.includes("window.dispatchEvent(new Event('focus'))")&&readFileSync('app/workspace.tsx','utf8').includes("window.addEventListener('focus',read)"));
}
ok('settings loads the switch list for the table',readFileSync('app/panels.tsx','utf8').includes("readJson('/api/feature-flags').then(d=>d.flags,()=>null)"));

// --- 입력 누락: 안전한 기본 ------------------------------------------------------------
const none=featureRows();
check('without input the same rows are returned',none.map(r=>r.key),rows.map(r=>r.key));
check('without input nothing that depends on live state claims to be available',none.filter(r=>['ai','worker','png','buffer','measurement','franchise'].includes(r.key)).map(r=>r.status),['blocked','blocked','blocked','blocked','blocked','blocked']);
check('unknown live states say the state could not be checked',none.filter(r=>r.status==='blocked').map(r=>r.reason),['AI 연결 상태를 확인하지 못했습니다','작업자 상태를 확인하지 못했습니다','확정 사실 수를 확인하지 못했습니다','Buffer 연결 상태를 확인하지 못했습니다','채널 연결 상태를 확인하지 못했습니다','가맹 모집 스위치 상태를 확인하지 못했습니다']);
ok('an empty object input behaves like no input',JSON.stringify(featureRows({}).map(r=>[r.key,r.status]))===JSON.stringify(none.map(r=>[r.key,r.status])));
ok('broken shapes fall back to the safe default',featureRows({connection:'x',worker:7,brands:'x',campaigns:{},facts:{},channels:'x',brandChannels:'x',publishers:[]}).filter(r=>['ai','worker','png','buffer','measurement'].includes(r.key)).every(r=>r.status==='blocked'));
check('an empty channel list is blocked, not available',row(full({channels:[]}),'measurement').status,'blocked');
ok('every blocked row has a reason and a link',[...featureRows(),...featureRows(full({connection:{configured:false},worker:{registered:false,online:false},facts:[],publishers:{},channels:channels(false,false)}))].filter(r=>r.status==='blocked').every(r=>!!r.reason&&!!r.link?.label&&!!r.link.view));
ok('available and unimplemented rows carry no link',rows.filter(r=>r.status!=='blocked').every(r=>!r.link));

// --- 화면 연결 -------------------------------------------------------------------------
const panels=readFileSync('app/panels.tsx','utf8');
ok('the settings table renders featureRows instead of a fixed list',panels.includes('featureRows(')&&!panels.includes("['PNG 안내 카드','사용 가능']")&&!panels.includes("['POS 자동 수집','연결 전']"));
ok('the settings table reads only existing GET endpoints',['/api/brand-facts','/api/channels','/api/execution?campaignId=','/api/research-worker/setup'].every(path=>panels.includes(path)));
// '다시 확인'은 작업자 상태도 다시 읽는다(워크스페이스 응답은 주기적으로 갱신되지 않는다). 응답이 없는 요청은 시간 제한 뒤 '확인하지 못했습니다'로 끝난다.
ok('the recheck reads the worker status and falls back to the workspace value',panels.includes('worker:loaded?.sources.worker??data.worker'));
ok('feature reads time out instead of waiting forever',panels.includes("fetch(path,{cache:'no-store',signal:AbortSignal.timeout(15_000)})"));
ok('blocked links carry the target tab to the address',panels.includes('pushNav({view:link.view,brand:link.brand,campaign:link.campaign,tab:link.tab})'));
ok('blocked rows navigate with the URL route helper',panels.includes('pushNav('));
ok('the HERMES connection form is admin-only on screen',panels.includes('<AdminOnly')&&panels.includes("from './account-context'"));
ok('the AI team note matches the current feature range',!panels.includes('이미지·영상 렌더링 및 광고 집행은 별도 연결이 필요합니다')&&panels.includes('PNG 정보 카드')&&panels.includes('영상 렌더링과 광고 집행은 아직 지원하지 않습니다'));
// F5 설정 채널 카드: 브랜드·지점 단위 자격증명 상태와 '적용 범위' 연결 폼. 상태는 모두에게, 연결·해제는 관리자만(AdminOnly, PR 5c).
const card=panels.slice(panels.indexOf('function ChannelCredentialsPanel('),panels.indexOf('function FeatureTable('));
ok('the settings channel card is the brand-scoped card',panels.includes('<div id="settings-channels"><ChannelCredentialsPanel brands={data.brands}/></div>')&&!panels.includes("from './channel-panel'")&&!existsSync('app/channel-panel.tsx')&&card.length>0);
ok('the card reads the brand list of GET /api/channels and the stores',panels.includes('byBrand:scopedCredentials(d.byBrand)')&&card.includes('channelSnapshot()')&&card.includes('channelScopes(')&&card.includes("readJson('/api/stores')"));
ok('the connection form picks the scope with a labelled combobox',card.includes('aria-label="적용 범위"')&&["workspace:'워크스페이스 기본'","brand:'브랜드'","store:'브랜드 · 지점'"].every(label=>panels.includes(label)));
ok('save and revoke send the chosen brand and store',card.includes("send('save_credential',{channel,data:form,...target}")&&card.includes("send('revoke_credential',{channel,...target}"));
ok('the workspace default and per-brand states are shown before the admin-only form',card.includes('워크스페이스 기본 · ')&&card.indexOf('channelScopes(')<card.indexOf('<AdminOnly')&&card.includes("<AdminOnly note={'채널 연결·해제는 관리자만 할 수 있습니다. '+adminRequestNote}>")&&card.indexOf('<form')>card.indexOf('<AdminOnly')&&card.indexOf("send('revoke_credential'")>card.indexOf('<AdminOnly'));
// 보관한 지점도 이 채널에 저장된 자격증명이 있으면 지점 선택지에 '(보관됨)'으로 남는다. 고르면 저장은 막고(서버 409와 같은 규칙) 해제만 할 수 있다.
ok('an archived store with a saved credential stays selectable for revoking',card.includes("s.status!=='archived'||snapshot.byBrand.some(c=>c.channel===channel&&c.brandId===brandId&&c.storeId===s.id)")&&card.includes("s.status==='archived'?' (보관됨)':''"));
ok('an archived store can only be revoked, not saved',card.includes('disabled={busy||missing||archived}')&&card.includes('보관한 지점에는 새로 연결할 수 없습니다')&&card.includes("disabled={busy||missing} onClick={()=>void send('revoke_credential'"));
ok('brands without their own credential say when the workspace default is used',card.includes('워크스페이스 기본으로 수집'));
ok('the feature table passes the brand list of GET /api/channels',panels.includes('brandChannels:channelState?.byBrand??null'));
const smoke=readFileSync('e2e/smoke.spec.ts','utf8');
ok('the smoke E2E sees the scope choice on the settings channel card',smoke.includes("getByRole('combobox', {name: '적용 범위', exact: true})")&&smoke.includes("['워크스페이스 기본', '브랜드', '브랜드 · 지점']"));
ok('the smoke E2E keeps the measurement row assertion',smoke.includes("toContainText('조건 부족 · 네이버 검색광고 연결 전 · Instagram 연결 전')"));
ok('the smoke E2E checks that the PNG link lands on the facts tab',smoke.includes("toHaveURL(/[?&]view=brands&brand=[^&]+&tab=facts/)")&&smoke.includes("getByRole('tab', {name: '확인 사실', exact: true})).toHaveAttribute('aria-selected', 'true')"));
const template=existsSync('.github/pull_request_template.md')?readFileSync('.github/pull_request_template.md','utf8'):'';
ok('the PR template asks to update the settings feature table',template.includes('설정 기능표 갱신'));

console.log(JSON.stringify({passed}));

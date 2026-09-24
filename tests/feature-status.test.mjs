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
const {featureRows,featureStatusLabels,bufferCheckCampaigns}=m.namespace;
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
const full=(over={})=>({connection:{configured:true,provider:'hermes'},worker:{registered:true,online:true},brands,campaigns:[],facts:[fact()],channels:channels(true,false),publishers:{ofd:true},now,...over});
const row=(input,key)=>featureRows(input).find(r=>r.key===key);
const view=r=>r&&{status:r.status,reason:r.reason,link:r.link};

// --- 3단계와 라벨 ----------------------------------------------------------------------
check('status labels are the three user-facing stages',featureStatusLabels,{available:'사용 가능',blocked:'조건 부족',unimplemented:'미구현'});
const rows=featureRows(full());
check('row keys are unique and in display order',rows.map(r=>r.key),['brand','ai','text','review','metrics','worker','png','buffer','measurement','pos-csv','pos-auto','video','ads']);
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
check('no measurement channel connected is blocked with both states and a link',view(row(full({channels:channels(false,false)}),'measurement')),{status:'blocked',reason:'네이버 검색광고 연결 전 · Instagram 연결 전',link:{label:'성과 자동 수집 연결로 이동',view:'settings',section:'settings-channels'}});
check('any connected channel makes collection available and flags token renewal',view(row(full({channels:channels(false,true,true,iso(3*day))}),'measurement')),{status:'available',reason:'네이버 검색광고 연결 전 · Instagram 연결됨(토큰 갱신 필요)'});
// channelStatus는 만료된 토큰도 connected:true·expiringSoon:true로 준다. 만료 시각이 지났으면 연결로 세지 않는다.
check('an expired token alone blocks collection with the channel link',view(row(full({channels:channels(false,true,true,iso(-1))}),'measurement')),{status:'blocked',reason:'네이버 검색광고 연결 전 · Instagram 토큰 만료',link:{label:'성과 자동 수집 연결로 이동',view:'settings',section:'settings-channels'}});
check('a token expiring exactly now counts as expired',row(full({channels:channels(false,true,true,iso(0))}),'measurement').status,'blocked');
check('another valid connection keeps collection available beside an expired token',view(row(full({channels:[{label:'네이버 검색광고',connected:true,expiresAt:null},{label:'Instagram',connected:true,expiresAt:iso(-day),expiringSoon:true}]}),'measurement')),{status:'available',reason:'네이버 검색광고 연결됨 · Instagram 토큰 만료'});
check('an unreadable expiry time is not treated as expired',row(full({channels:channels(false,true,false,'not-a-date')}),'measurement').status,'available');

// --- 입력 누락: 안전한 기본 ------------------------------------------------------------
const none=featureRows();
check('without input the same rows are returned',none.map(r=>r.key),rows.map(r=>r.key));
check('without input nothing that depends on live state claims to be available',none.filter(r=>['ai','worker','png','buffer','measurement'].includes(r.key)).map(r=>r.status),['blocked','blocked','blocked','blocked','blocked']);
check('unknown live states say the state could not be checked',none.filter(r=>r.status==='blocked').map(r=>r.reason),['AI 연결 상태를 확인하지 못했습니다','작업자 상태를 확인하지 못했습니다','확정 사실 수를 확인하지 못했습니다','Buffer 연결 상태를 확인하지 못했습니다','채널 연결 상태를 확인하지 못했습니다']);
ok('an empty object input behaves like no input',JSON.stringify(featureRows({}).map(r=>[r.key,r.status]))===JSON.stringify(none.map(r=>[r.key,r.status])));
ok('broken shapes fall back to the safe default',featureRows({connection:'x',worker:7,brands:'x',campaigns:{},facts:{},channels:'x',publishers:[]}).filter(r=>['ai','worker','png','buffer','measurement'].includes(r.key)).every(r=>r.status==='blocked'));
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
const smoke=readFileSync('e2e/smoke.spec.ts','utf8');
ok('the smoke E2E checks that the PNG link lands on the facts tab',smoke.includes("toHaveURL(/[?&]view=brands&brand=[^&]+&tab=facts/)")&&smoke.includes("getByRole('tab', {name: '확인 사실', exact: true})).toHaveAttribute('aria-selected', 'true')"));
const template=existsSync('.github/pull_request_template.md')?readFileSync('.github/pull_request_template.md','utf8'):'';
ok('the PR template asks to update the settings feature table',template.includes('설정 기능표 갱신'));

console.log(JSON.stringify({passed}));

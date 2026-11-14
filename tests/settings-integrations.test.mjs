// X-F 연결 및 설정 재구성: 채널 연결 카드의 순수 판정(app/settings-channel-state.ts)과 화면 배선(섹션 탭·카드 6종·광고 제안 카드·자동화 규칙 탭)을 고정한다.
// 근거: mocked(순수 함수, 고정 시각). 실제 공급자 호출은 없다.
import {koSource} from './helpers/i18n-source.mjs';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console,Number,Math,Date,JSON,Set,Array,Object,String}),load=async path=>{const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:resolve(path)});await m.link(()=>{throw new Error('no imports expected')});await m.evaluate();return m.namespace};
const s=await load('app/settings-channel-state.ts');
let passed=0;
const check=(name,actual,expected)=>{assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,name);passed++};
const ok=(name,value)=>{assert.ok(value,name);passed++};
const now=Date.parse('2026-11-09T00:00:00.000Z'),day=86_400_000,iso=d=>new Date(now+d*day).toISOString();

// --- 연결 상태와 토큰 만료 경고(14일) ---------------------------------------------------
check('unknown when the status could not be read',s.connectionState(null,null,now),'unknown');
check('not connected',s.connectionState(false,iso(30),now),'none');
check('connected without an expiry date',s.connectionState(true,null,now),'connected');
check('connected with a far expiry',s.connectionState(true,iso(15),now),'connected');
check('14 days left is a warning',s.connectionState(true,iso(14),now),'expiring');
check('one day left is a warning',s.connectionState(true,iso(1),now),'expiring');
check('expired token',s.connectionState(true,iso(0),now),'expired');
check('a malformed date does not warn',s.connectionState(true,'not-a-date',now),'connected');
check('days left rounds up',[s.daysLeft(iso(13.2),now),s.daysLeft(null,now),s.daysLeft('x',now)],[14,null,null]);
check('labels',s.connectionLabels,{connected:'연결됨',expiring:'만료 임박',expired:'만료',none:'연결 전',unknown:'확인하지 못함'});

// --- 기능 스위치 --------------------------------------------------------------------------
const flags=[{flag:'naver_ads_write',enabled:false},{flag:'threads_publish',enabled:true}];
check('switch states from the flag list',[s.flagOn(flags,'naver_ads_write'),s.flagOn(flags,'threads_publish'),s.flagOn(flags,'missing'),s.flagOn(null,'threads_publish')],[false,true,null,null]);
check('switch line words',[s.switchLabel(true),s.switchLabel(false),s.switchLabel(null)],['스위치 켜짐','스위치 꺼짐','스위치 확인하지 못함']);

// --- 폼 검증(서버 규칙과 같은 문구) ------------------------------------------------------
check('publisher form needs a token first',s.publisherIssue({accessToken:' ',userId:'',expiresAt:''}),'액세스 토큰을 입력하세요.');
check('publisher form needs an account id',s.publisherIssue({accessToken:'t',userId:'',expiresAt:''}),'계정 ID를 입력하세요.');
check('publisher account id is numeric',s.publisherIssue({accessToken:'t',userId:'abc',expiresAt:''}),'계정 ID는 숫자입니다.');
check('publisher expiry must parse',s.publisherIssue({accessToken:'t',userId:'123',expiresAt:'bad'}),'토큰 만료일을 확인해 주세요.');
check('a complete publisher form passes',s.publisherIssue({accessToken:'t',userId:'17841400000000000',expiresAt:'2027-01-08'}),'');
const dealer={baseUrl:'https://dealer.example',apiKey:'k',senderKey:'s',senderName:'브랜드',optoutNumber:'080-123-4567'};
check('dealer needs https',s.dealerIssue({...dealer,baseUrl:'http://dealer.example'}),'딜러 API 주소는 https://로 시작해야 합니다.');
check('dealer needs the keys and sender name',s.dealerIssue({...dealer,senderKey:''}),'딜러 API 키, 발신프로필 키, 전송자 명칭을 모두 입력하세요.');
check('dealer needs an 080 number',s.dealerIssue({...dealer,optoutNumber:'02-123-4567'}),'080 수신거부 번호는 080-XXX-XXXX 형식이어야 합니다.');
check('a complete dealer form passes',[s.dealerIssue(dealer),s.dealerIssue({...dealer,optoutNumber:'0801234567'})],['','']);
const pos={storeId:'st1',merchantId:'12345',accessKey:'access-key-1',secretKey:'secret-key-1',intervalMinutes:'60'};
check('pos needs a store',s.posIssue({...pos,storeId:''},true),'지점을 고르세요.');
check('pos merchant id is numeric',s.posIssue({...pos,merchantId:'12a'},true),'매장 ID(merchantId)는 숫자만 입력하세요.');
check('a new pos connection needs both keys',s.posIssue({...pos,secretKey:'short'},true),'Access Key와 Secret Key를 공백 없이 8자 이상 입력하세요.');
check('an update may keep the stored keys',s.posIssue({...pos,accessKey:'',secretKey:''},false),'');
check('pos interval range',[s.posIssue({...pos,intervalMinutes:'14'},true),s.posIssue({...pos,intervalMinutes:'1441'},true),s.posIssue({...pos,intervalMinutes:'15'},true)],['조회 간격은 15~1440분입니다.','조회 간격은 15~1440분입니다.','']);
check('csv data rows skip the header and blank lines',[s.csvDataRows('phone,consentedAt\n010-1111-2222,2026-01-01\n\n010-3333-4444,2026-02-01\n'),s.csvDataRows('phone,consentedAt'),s.csvDataRows('')],[2,0,0]);

// --- 광고 제안 diff -----------------------------------------------------------------------
check('bid diff line and delta',[s.diffLines({before:{bidAmt:500},after:{bidAmt:450}}),s.bidDelta({before:{bidAmt:500},after:{bidAmt:450}})],[[{key:'bidAmt',label:'입찰가(원)',before:'500',after:'450'}],-50]);
check('pause diff reads as yes/no',s.diffLines({before:{userLock:false},after:{userLock:true}}),[{key:'userLock',label:'중지',before:'아니요',after:'예'}]);
check('created items show as text and missing values as 없음',s.diffLines({before:{},after:{created:{op:'create_keywords'}}}),[{key:'created',label:'새로 만들 항목',before:'없음',after:'{"op":"create_keywords"}'}]);
check('no diff and non-bid delta',[s.diffLines(null),s.bidDelta({before:{userLock:true},after:{userLock:false}})],[[],null]);

// --- 화면 배선(소스) ----------------------------------------------------------------------
const src=f=>readFileSync(f,'utf8');
const panels=koSource('app/panels.tsx'),sections=src('app/settings-sections.tsx'),channels=koSource('app/settings-channels.tsx'),metrics=koSource('app/campaign-metrics.tsx'),detection=src('app/growth-detection-panel.tsx');
ok('settings panel renders the section shell and keeps the card ids',panels.includes('<SettingsShell data={data} reload={reload} connect={')&&['id="settings-safety"','id="settings-ai"','id="settings-worker"','<div id="settings-channels"><ChannelCredentialsPanel brands={data.brands}/></div>'].every(x=>panels.includes(x))&&panels.includes('usage={<UsagePanel/>} features={<FeatureTable data={data}/>}'));
ok('feature links inside settings open the tab that holds the card',panels.includes("if(link.view==='settings'&&link.section){openSettingsSection(link.section);return}"));
ok('the old anchor bar is gone',!panels.includes('href="#settings-ai"'));
ok('tabs keep the shortcut navigation name and the address state',sections.includes("aria-label={t('settings.nav')}")&&src('lib/i18n/ko-lazy.ts').includes("'settings.nav':'설정 바로가기'")&&sections.includes("serializeNav({...parseNav(location.search),section})")&&sections.includes("orientation={mobile?'horizontal':'vertical'}"));
ok('channel and automation tabs load lazily',/lazy\(\(\)=>import\('\.\/settings-channels'\)/.test(sections)&&/lazy\(\(\)=>import\('\.\/autonomy-panel'\)/.test(sections)&&!/^import [^;]*from '\.\/(settings-channels|autonomy-panel)';/m.test(sections));
ok('panels does not import the lazy settings cards statically',!/from '\.\/(settings-channels|autonomy-panel|ads-proposals-card)'/.test(panels));
ok('six channel cards',['<BufferCard','channel="instagram_direct"','channel="threads"','<KakaoCard','<PosCard','<NaverCard'].every(x=>channels.includes(x)));
ok('secret inputs are write-only password fields',['app/settings-publishers.tsx','app/settings-kakao.tsx','app/settings-pos.tsx'].every(f=>(src(f).match(/type="password" autoComplete="off"/g)||[]).length>=1));
ok('revokes ask with confirm fields',['app/settings-publishers.tsx','app/settings-kakao.tsx','app/settings-pos.tsx'].every(f=>/askConfirm\(\{title:[^]*?fields:\{what:/.test(src(f))));
ok('ads proposals card is lazy in the campaign results area and shows the label',/lazy\(\(\)=>import\('\.\/ads-proposals-card'\)/.test(metrics)&&src('app/ads-proposals-card.tsx').includes("'추정·규칙 기반, 자동 적용 없음'"));
// 레인 X-G: 반영은 spend 판정(applyReason)을 먼저 보고, 그 밖에는 승인과 같은 스위치 이유(switchReason)로 막는다.
ok('ads proposals approve and apply carry the switch reason',(src('app/ads-proposals-card.tsx').match(/disabled=\{busy\|\|!!switchReason\} disabledReason=\{switchReason\}/g)||[]).length===1&&(src('app/ads-proposals-card.tsx').match(/disabled=\{busy\|\|!!applyReason\} disabledReason=\{applyReason\}/g)||[]).length===1&&/applyReason=[^;]*:switchReason;/.test(src('app/ads-proposals-card.tsx')));
ok('growth detection labels scheduled reviews',detection.includes("scheduled_review:'예약 검토'"));
ok('the e2e spec exists',existsSync('e2e/settings-integrations.spec.ts'));
ok('new files stay under 800 lines',['app/settings-sections.tsx','app/settings-channels.tsx','app/settings-channel-card.tsx','app/settings-channel-state.ts','app/settings-publishers.tsx','app/settings-kakao.tsx','app/settings-pos.tsx','app/ads-proposals-card.tsx'].every(f=>src(f).split('\n').length<800));

console.log(JSON.stringify({passed},null,2));

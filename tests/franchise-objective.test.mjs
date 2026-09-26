// 트랙 R R3a: 캠페인 가맹 모집 목적(objective 'franchise_recruitment', 결정 26). 형식 검사·지정·해제 권한·스위치, 지점·브랜드·제작 기록 보호,
// 소비자 채널 스킬(offline·search·commerce) 끄기, 가맹 근거 정책, 발행 캡션의 모집 범위 판정(가맹 프로필 없어도), 브리프 초안의 목적 이어받기,
// objective 없는 캠페인의 제출 바이트 불변(기준 fixture 재캡처 없음).
// R3b: 가맹 모집 채널 단위 6개(franchise·portal·keyword·expo·leadad·referral, objective 한정·channels 문구만 봄), 본문 되풀이 안전,
// objective 캠페인의 역할·회의·브리프 지시문에서 소비자 30일 재방문율 정의 자리를 가맹 모집 규칙으로 바꾸기(소비자 지시 바이트는 그대로).
// 근거: mocked(메모리 SQLite, 이메일 모드 세션 주입, 모의 R2, 외부 fetch는 던지는 스텁, 모의 HERMES). 값·문장은 모두 합성이다. 판정은 COLLECTIVE 휴리스틱 · 법률 자문 아님(결정 20 보류).
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {franchiseFixture,captureConsole} from './helpers/franchise-fixture.mjs';
import {testRuntime} from './helpers/runtime.mjs';
import {seed,mockHermes,runRole,runMeeting,roleCampaign,meetingCampaign,brand as seedBrand} from './helpers/prompt-seed.mjs';

captureConsole();
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const O='franchise_recruitment';

const f=await franchiseFixture();
const {sql,env,server}=f;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const objects=new Map();env.BUCKET={put:async(k,v)=>objects.set(k,new Uint8Array(v)),get:async k=>objects.has(k)?{arrayBuffer:async()=>objects.get(k).slice().buffer,body:new Response(objects.get(k).slice()).body}:null,head:async k=>objects.has(k)?{size:objects.get(k).length}:null,delete:async k=>objects.delete(k)};
f.clock.set(Date.parse('2026-09-26T03:00:00Z')-Date.now());
const NOW='2026-09-26T12:00:00+09:00';
const practice=await f.load('lib/practice.ts'),policy=await f.load('lib/campaign-policy.ts'),agency=await f.load('lib/agency.ts'),registry=await f.load('lib/prompt-registry.ts');
const ri=await f.load('lib/role-instruction.ts'),briefInput=await f.load('lib/brief-input.ts'),briefLib=await f.load('lib/brief.ts'),meetings=await f.load('lib/meetings.ts'),units=await f.load('lib/prompt-units.ts');
const jc=await f.load('lib/franchise-compliance.ts'),comp=await f.load('lib/graders/compliance.ts'),graders=await f.load('lib/graders/index.ts');

// ════ 1) 채널 스킬: objective 캠페인은 offline·search·commerce를 끄고 가맹 모집 단위(R3b)를 켠다. objective 없는 캠페인은 그대로 ════
// MD: 소비자 30일 재방문율 정의(측정 정의), P: 가맹 모집 규칙(코드 소유 정책). 지시문 치환은 함수 치환자로 한다('$' 패턴 해석 없음).
const MD=policy.measurementDiscipline,P=policy.franchiseEvidencePolicy;
const bodyOf=id=>practice.channelSkills.find(x=>x.id===id).body;
const NEW_IDS=['franchise','portal','keyword','expo','leadad','referral'];
const idsOf=c=>practice.channelSkillIds(c);
check('1: the 30-day definition is in the evidence rules exactly once and in the brief instructions exactly once as its own line',practice.evidenceDiscipline.split(MD).length===2&&briefLib.briefInstructions.split(MD).length===2&&briefLib.briefInstructions.split('\n'+MD+'\n').length===2);
const OFD={goal:'매장 창업을 고민하는 분의 가맹 상담 신청을 받는다.',products:'',stores:'',channels:'네이버 블로그, 매장 QR'};
check('1: the OFD-shaped objective campaign gets franchise, keyword and referral after R3b (no offline, search or commerce)',same(idsOf({...OFD,objective:O}),['franchise','keyword','referral'])&&['offline','search','commerce','default'].every(x=>!idsOf({...OFD,objective:O}).includes(x)));
check('1: the same campaign without objective keeps search and offline',same(idsOf(OFD),['search','offline']));
const MIXED={goal:'가맹 상담을 받는다.',products:'',stores:'',channels:'인스타 릴스, 유튜브, 창업 커뮤니티, 올리브영, 네이버'};
check('1: shortform, youtube and community stay; commerce and search go; portal and keyword join; 인스타 alone is not a lead ad channel',same(idsOf({...MIXED,objective:O}),['shortform','youtube','community','franchise','portal','keyword'])&&same(idsOf(MIXED),['shortform','youtube','community','search','commerce']));
check('1: roleRunUnits follow the same list (promptVersion units)',same(registry.roleRunUnits('cmo',{...OFD,objective:O}),['role.cmo','channel.franchise','channel.keyword','channel.referral'])&&same(registry.roleRunUnits('cmo',OFD),['role.cmo','channel.search','channel.offline']));
check('1: all eight roles get the same recruitment channel units',agency.roles.length===8&&agency.roles.every(r=>same(registry.roleRunUnits(r.id,{...OFD,objective:O}),['role.'+r.id,'channel.franchise','channel.keyword','channel.referral'])));
const SENTINEL={offline:'센티넬-현장',search:'센티넬-검색',commerce:'센티넬-커머스'};
const objectivePractice=practice.campaignPractice({...OFD,objective:O},SENTINEL);
check('1: registry bodies of the dropped units never reach the objective practice text',!Object.values(SENTINEL).some(x=>objectivePractice.includes(x))&&objectivePractice===[bodyOf('franchise'),bodyOf('keyword'),bodyOf('referral'),P].join('\n'));
check('1: consumer practice still uses the registry bodies',practice.campaignPractice(OFD,SENTINEL).includes('센티넬-현장')&&practice.campaignPractice(OFD,SENTINEL).includes('센티넬-검색'));
const SENTINEL_R={franchise:'센티넬-가맹',keyword:'센티넬-키워드',referral:'센티넬-추천'};
check('1: registry bodies of the recruitment units reach the objective practice text in code order',practice.campaignPractice({...OFD,objective:O},SENTINEL_R)===['센티넬-가맹','센티넬-키워드','센티넬-추천',P].join('\n'));
check('1: registry bodies of the recruitment units never reach a consumer practice text',!Object.values(SENTINEL_R).some(x=>practice.campaignPractice(OFD,SENTINEL_R).includes(x))&&practice.campaignPractice(OFD,SENTINEL_R)===practice.campaignPractice(OFD));
const ALL={goal:'가맹 상담 신청을 받는다.',products:'',stores:'',channels:'네이버 블로그, 창업 카페, 커뮤니티, 박람회, 설명회, 메타 리드광고, 페이스북, 인스타그램, 점주 추천, 매장 QR, 키워드, 파워링크, 입점, 견학, 포털, 엑스포'};
check('1: a consumer campaign with every trigger word keeps its consumer skills and gets none of the recruitment bodies',same(idsOf(ALL),['shortform','community','search','offline'])&&NEW_IDS.every(id=>!practice.campaignPractice(ALL).includes(bodyOf(id))));
check('1: the same campaign with objective gets all six recruitment units after the kept consumer skills',same(idsOf({...ALL,objective:O}),['shortform','community','franchise','portal','keyword','expo','leadad','referral']));
// 트리거 정밀도(objective): channels 문구만 본다. 메타버스·예비 점주·'인스타'만·'카페'만은 켜지 않는다.
const EDGES=[
 [{channels:''},['franchise']],
 [{channels:'예비 점주 카페'},['franchise']],
 [{channels:'예비점주 모임'},['franchise']],
 [{channels:'기존 점주 소개'},['franchise','referral']],
 [{channels:'메타버스 전시'},['franchise']],
 [{channels:'메타 광고'},['franchise','leadad']],
 [{channels:'인스타 릴스'},['shortform','franchise']],
 [{channels:'인스타그램'},['shortform','franchise','leadad']],
 [{channels:'Facebook lead ads'},['franchise','leadad']],
 [{channels:'카페 홍보'},['franchise']],
 [{channels:'창업 카페'},['franchise','portal']],
 [{channels:'창업카페 입점'},['franchise','portal']],
 [{channels:'',goal:'설명회·박람회·점주 추천을 늘린다.'},['franchise']],
 [{channels:'',goal:'네이버 블로그와 창업 카페, 메타 리드광고, QR'},['franchise']],
 [{channels:'',stores:'설명회장 QR'},['franchise']],
 [{channels:'Meta 리드광고, 페이스북'},['franchise','leadad']],
 [{channels:'창업 박람회, 설명회, 본사 견학'},['franchise','expo']],
 [{channels:'EXPO 부스'},['franchise','expo']],
 [{channels:'파워 링크'},['franchise','keyword']],
 [{channels:'큐알 코드'},['franchise','referral']],
];
for(const [c,want] of EDGES)check(`1: objective ${JSON.stringify(c)} gets ${want.join(', ')}`,same(idsOf({goal:'',products:'',stores:'',...c,objective:O}),want));
check('1: objective with a storeId (frozen eval request) still drops offline',!idsOf({...OFD,objective:O,storeId:'s1'}).includes('offline'));
check('1: only the exact value switches: other values behave like a consumer campaign (old and new units)',['franchise','FRANCHISE_RECRUITMENT',' franchise_recruitment','',null,true].every(v=>[OFD,MIXED,ALL].every(c=>same(idsOf({...c,objective:v}),idsOf(c))&&practice.campaignPractice({...c,objective:v})===practice.campaignPractice(c))));
check('1: one predicate decides (lib/agency.ts isRecruitmentObjective)',agency.isRecruitmentObjective({objective:O})&&!agency.isRecruitmentObjective({objective:'franchise'})&&!agency.isRecruitmentObjective({})&&!agency.isRecruitmentObjective(null));
check('1: PRACTICE_VERSION is unchanged',practice.PRACTICE_VERSION==='2026-09-25.1');

// ════ 1b) 가맹 모집 채널 단위 본문(R3b): 순서, 한 줄, 레지스트리 본문 검사, 계획 항목, 되풀이 안전 ════
check('1b: the six recruitment units follow offline in code order',same(practice.channelSkills.map(x=>x.id),['shortform','youtube','community','search','commerce','offline',...NEW_IDS]));
const WORKSPACE_TERMS=[...units.brandTermsFromCode(),'가상분식','가상동 12'];
const validBody=id=>{try{units.validateUnitBody('channel.'+id,bodyOf(id),WORKSPACE_TERMS);return true}catch{return false}};
check('1b: every recruitment body is one trimmed NFC line and passes the registry body check (code and synthetic workspace brand terms)',NEW_IDS.every(id=>{const b=bodyOf(id);return !/[\r\n]/.test(b)&&b===b.trim()&&b===b.normalize('NFC')&&validBody(id)}));
check('1b: each recruitment body is the code unit body of its registry unit',NEW_IDS.every(id=>units.codeUnitBody('channel.'+id)===bodyOf(id)));
const PLAN={
 franchise:[...agency.roles.map(r=>r.name),'창업 페이지 문안','포털 소개문','네이버 검색 문안','메타 리드광고 문안','박람회 배너·리플렛 문안','설명회 덱 개요·원고','첫 통화 스크립트','[의견]','수익 수치 칸은 두지 않는다'],
 portal:['수집 출처와 동의 범위'],
 keyword:['입찰가·예산은 사람이 정하고'],
 expo:['48시간','승인된 버전만','서면 절차'],
 leadad:['이름·연락처·희망 지역·희망 시기만','금융 정보는 묻지 않는다','처리방침'],
 referral:['추천 보상은 제안하지 않는다','경제적 이해관계'],
};
for(const id of NEW_IDS)check(`1b: channel.${id} covers the plan items`,PLAN[id].every(x=>bodyOf(id).includes(x)));
check('1b: the bodies leave the fact label format to the code-owned policy and name no amount (only 48시간)',NEW_IDS.every(id=>!bodyOf(id).includes('[사실')&&!/만원|₩/.test(bodyOf(id)))&&NEW_IDS.map(bodyOf).join(' ').match(/\d+/g).join(',')==='48');
const ECHO=[...NEW_IDS.map(bodyOf),[...NEW_IDS.map(bodyOf),P].join('\n')];
check('1b: echoing the recruitment bodies raises no franchise judge issue in either scope',ECHO.every(text=>['recruitment','consumer'].every(scope=>jc.judgeFranchiseText({text,at:NOW,now:NOW,scope,brandId:'b',facts:[],versions:[]}).issues.length===0)));
check('1b: echoing the recruitment bodies raises no compliance issue (default, consumer and recruitment franchise scope)',ECHO.every(text=>[null,{scope:'consumer'},{scope:'recruitment'}].every(fr=>comp.checkCompliance(text,{facts:null,franchise:fr}).issues.length===0)));
check('1b: echoing the recruitment bodies fails no grader but thin_section (industry null, fnb, franchise; cmo, content, data, quality)',ECHO.every(text=>[null,'fnb','franchise'].every(industry=>['cmo','content','data','quality'].every(role=>!graders.runGraders({id:'p',kind:'role',role,contract:false,text},{industry,facts:{confirmed:[],prohibited:[]}}).some(r=>r.status==='fail'&&r.id!=='thin_section')))));
check('1b: echoing the recruitment bodies is not an unverified ad claim',ECHO.every(text=>policy.unverifiedClaims(text,policy.claimGuard({confirmed:[],prohibited:[]})).length===0));

// ════ 2) 역할 제출 바이트: 기준 fixture의 모든 케이스에서 지시문은 같고, 입력은 campaign·channelPractice만 달라진다 ════
const fixtureFile=readdirSync('tests/fixtures').filter(x=>/^role-submission-[0-9a-f]{7}\.json$/.test(x));
assert.equal(fixtureFile.length,1);
const fixture=JSON.parse(readFileSync('tests/fixtures/'+fixtureFile[0],'utf8'));
const diffKeys=(a,b)=>[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k])).sort();
const byteRows=fixture.cases.map(c=>{
 const ctx={...c.context,campaign:{...c.context.campaign,objective:O}},input=JSON.parse(ri.buildRoleInput(ctx)),base=JSON.parse(c.submission.input),objective=ri.buildRoleInstruction(ctx);
 return {once:c.submission.instructions.split(MD).length===2,instructions:objective===c.submission.instructions.replace(MD,()=>P),counts:objective.split(P).length===2&&!objective.includes(MD)&&!objective.includes('30일 재방문율의 기준일'),consumer:ri.buildRoleInstruction(c.context)===c.submission.instructions,keys:diffKeys(input,base),objective:input.campaign.objective,policy:input.channelPractice.includes(policy.franchiseEvidencePolicy),undef:ri.buildRoleInput({...c.context,campaign:{...c.context.campaign,objective:undefined}})===c.submission.input};
});
check('2: every fixture instruction carries the consumer 30-day definition once',byteRows.length===16&&byteRows.every(r=>r.once));
check('2: objective replaces only the 30-day definition with the franchise policy in every fixture instruction (R3b)',byteRows.every(r=>r.instructions&&r.counts));
check('2: the same fixture contexts without objective still build the fixture instruction bytes',byteRows.every(r=>r.consumer));
check('2: objective changes only campaign and channelPractice in the role input',byteRows.every(r=>same(r.keys,['campaign','channelPractice'])&&r.objective===O&&r.policy));
check('2: an undefined objective key serializes to the fixture bytes',byteRows.every(r=>r.undef));
check('2: evidenceDisciplineFor returns the consumer constant for anything but the exact objective',[undefined,null,{},{objective:'franchise'},{objective:true},{objective:'FRANCHISE_RECRUITMENT'},{objective:' franchise_recruitment'}].every(v=>practice.evidenceDisciplineFor(v)===practice.evidenceDiscipline));
check('2: the recruitment evidence rules are the consumer rules with the 30-day definition replaced by the policy',practice.evidenceDisciplineFor({objective:O})===practice.recruitmentEvidenceDiscipline&&practice.recruitmentEvidenceDiscipline===practice.evidenceDiscipline.replace(MD,()=>P)&&practice.recruitmentEvidenceDiscipline!==practice.evidenceDiscipline);
check('2: a role instruction without a campaign equals the consumer instruction',['cmo','quality'].every(role=>ri.buildRoleInstruction({role})===ri.buildRoleInstruction({role,campaign:roleCampaign})&&ri.buildRoleInstruction({role})===ri.buildRoleInstruction({role,campaign:null})&&ri.buildRoleInstruction({role})===ri.buildRoleInstruction({role,campaign:{objective:'franchise'}})));
check('2: for all eight roles (quality included) the objective instruction is the consumer one with only the 30-day definition replaced',agency.roles.every(r=>{const con=ri.buildRoleInstruction({role:r.id}),obj=ri.buildRoleInstruction({role:r.id,campaign:{objective:O}});return con.split(MD).length===2&&obj===con.replace(MD,()=>P)&&obj!==con}));
check('2: an unknown role still throws before the campaign is read',(()=>{try{ri.buildRoleInstruction({role:'intern',campaign:{objective:O}});return false}catch(e){return /Unknown agency role/.test(e.message)}})());
// quality-fixes-v1의 입력 경로 검사(라벨 없는 점 표기 경로 0건)를 정책과 objective 지시문에 그대로 적용한다.
const PATH=/(?<![\w/.])[a-z][A-Za-z]*(?:\.[A-Za-z_]\w*)+/g;
const unlabeledPaths=text=>{const labelled=[...text.matchAll(/[가-힣]\(([^()]*)\)/g)].map(m=>[m.index+2,m.index+m[0].length-1]);return [...text.matchAll(PATH)].filter(m=>!labelled.some(([a,b])=>m.index>=a&&m.index+m[0].length<=b)).map(m=>m[0])};
check('2: the policy and every objective role instruction name no bare dotted input path',unlabeledPaths(P).length===0&&agency.roles.every(r=>unlabeledPaths(ri.buildRoleInstruction({role:r.id,campaign:{objective:O}})).length===0));

// ════ 2b) 회의 지시문(순수): 개선 회의(skillVersion)는 모집 플래그로 같은 치환, 비개선 회의는 근거 규율이 없어 플래그와 무관 ════
const STEPS=[...agency.roles.flatMap(r=>['discussion','revision','quality'].map(phase=>({id:`x:${phase}:${r.id}`,role:r.id,phase,status:'pending'}))),{id:'x:synthesis:cmo',role:'cmo',phase:'synthesis',status:'pending'}];
check('2b: enhanced meeting instructions of every role and phase replace only the 30-day definition when the recruitment flag is set',STEPS.length===25&&STEPS.every(st=>{const con=meetings.meetingInstructions(st,true);return con.split(MD).length===2&&meetings.meetingInstructions(st,true,undefined,false,true)===con.replace(MD,()=>P)}));
check('2b: the recruitment flag defaults to false (consumer bytes)',STEPS.every(st=>meetings.meetingInstructions(st,true,undefined,false)===meetings.meetingInstructions(st,true,undefined,false,false)&&meetings.meetingInstructions(st)===meetings.meetingInstructions(st,true)));
check('2b: unenhanced meeting instructions carry no evidence rules and ignore the flag',STEPS.every(st=>{const con=meetings.meetingInstructions(st,false);return !con.includes(MD)&&!con.includes(P)&&meetings.meetingInstructions(st,false,undefined,false,true)===con}));
const packStep={id:'x:revision:content',role:'content',phase:'revision',status:'pending'},packed=meetings.meetingInstructions(packStep,true,undefined,true);
check('2b: the copy-pack content revision gets the same replacement',packed!==meetings.meetingInstructions(packStep,true)&&meetings.meetingInstructions(packStep,true,undefined,true,true)===packed.replace(MD,()=>P));

// ════ 3) 가맹 근거 정책 ════
const GENERIC='이번 제품·서비스의 실제 목표 행동만 측정하고 관련 없는 업종의 지표를 추가하지 마세요.';
const LOCKER={goal:'물품보관함 이용을 늘린다.',products:'락커',stores:'',channels:'인스타그램'};
check('3: consumer policy strings are byte-pinned',policy.campaignEvidencePolicy(OFD)===GENERIC&&policy.campaignEvidencePolicy({...OFD,objective:'franchise'})===GENERIC&&policy.campaignEvidencePolicy(LOCKER).includes('가동 가능 시간'));
check('3: the objective branch replaces even the locker instruction',policy.campaignEvidencePolicy({...LOCKER,objective:O})===P&&!P.includes('가동 가능 시간'));
// 소비자 캠페인에는 새 단위 id가 나오지 않는다(역할 fixture 캠페인, 기준선 역할·회의 캠페인, 보관함, 커머스).
const CONSUMERS=[...fixture.cases.map(c=>c.context.campaign),roleCampaign,meetingCampaign,LOCKER,{goal:'',products:'',stores:'',channels:'쿠팡 마켓플레이스, 자사몰'}];
check('1: consumer campaigns never get a recruitment unit id or body',CONSUMERS.every(c=>!idsOf(c).some(id=>NEW_IDS.includes(id))&&NEW_IDS.every(id=>!practice.campaignPractice(c).includes(bodyOf(id)))));
const ITEMS=['보장','서면 절차','정보공개서 버전','[사실:','[의견]','대기기간','가맹금','점주 후기','문의 → 첫 연락 → 상담 → 설명회 → 정보공개서 제공 → 대기기간 → 계약서안 제공 → 계약 → 개점','CPL','계약당 비용','순증 효과가 아니','30일 재방문율 정의는 이 캠페인에 적용하지 마세요'];
check('3: the policy covers every plan item',ITEMS.every(x=>P.includes(x))&&!P.includes(policy.measurementDiscipline));
check('3: the policy names no amount, period figure or startup-cost claim word (only the name of the 30-day revisit definition it switches off)',!/\d|창업\s?비용|만원|개월/.test(P.replaceAll('30일 재방문율','재방문율')));
// 모델이 정책 문장을 되풀이해도 가맹 판정·규제 사전·광고 표현 검사·채점기에 걸리지 않는다(정책을 옮긴 산출물이 막히지 않게).
const judge=scope=>jc.judgeFranchiseText({text:P,at:NOW,now:NOW,scope,brandId:'b',facts:[],versions:[]});
check('3: echoing the policy raises no franchise judge issue in either scope',judge('recruitment').issues.length===0&&judge('consumer').issues.length===0);
check('3: echoing the policy raises no compliance issue (default, consumer and recruitment franchise scope)',[null,{scope:'consumer'},{scope:'recruitment'}].every(fr=>comp.checkCompliance(P,{facts:null,franchise:fr}).issues.length===0));
check('3: echoing the policy fails no grader',[null,'fnb','franchise'].every(industry=>!graders.runGraders({id:'p',kind:'role',role:'data',contract:false,text:P},{industry,facts:{confirmed:[],prohibited:[]}}).some(r=>r.status==='fail')));
check('3: echoing the policy is not an unverified ad claim',policy.unverifiedClaims(P,policy.claimGuard({confirmed:[],prohibited:[]})).length===0);
// 정책을 따른 산출물 문장: 사실 표시는 가맹 판정 H8과 채점기의 확정 표시를 함께 만족하고, 후기 자리표시는 추천·보증 표시 경고에 걸리지 않는다.
const FACT_LINE='가맹비는 1,100만원입니다 [사실: 가맹비 · 확정 사실].',PLACEHOLDER='[점주 후기 자리 — 동의·경제적 이해관계 표시 확인 필요]';
check('3: the policy prescribes exactly these labels',P.includes('[사실: 항목 · 확정 사실]')&&P.includes(PLACEHOLDER));
const LEDGERS=[{confirmed:[{key:'가맹비',value:'1,100만원'}],prohibited:[]},{confirmed:[{key:'가맹비',value:'1,100만원'},{key:'menu_price',value:'도넛 2,500원'}],prohibited:[]},{confirmed:[],prohibited:[]}];
check('3: a fact sentence labelled as the policy says fails no content grader (with and without a price ledger; thin_section only measures length)',LEDGERS.every(facts=>!graders.runGraders({id:'p',kind:'role',role:'content',contract:false,text:FACT_LINE},{industry:null,facts}).some(r=>r.status==='fail'&&r.id!=='thin_section')));
check('3: the same label satisfies the franchise fact/opinion label rule (H8)',!jc.judgeFranchiseText({text:FACT_LINE,at:NOW,now:NOW,scope:'recruitment',brandId:'b',facts:[],versions:[]}).issues.some(i=>i.ruleId==='h.fact_opinion_labels'));
check('3: the testimonial placeholder raises nothing in the judge or the lexicon',['recruitment','consumer'].every(scope=>jc.judgeFranchiseText({text:PLACEHOLDER,at:NOW,now:NOW,scope,brandId:'b',facts:[],versions:[]}).issues.length===0)&&[null,{scope:'consumer'},{scope:'recruitment'}].every(fr=>comp.checkCompliance(PLACEHOLDER,{facts:null,franchise:fr}).issues.length===0));

// ════ 4) 브리프 이전 캠페인: 목적이 같은 캠페인만 ════
const req=(input,campaigns)=>briefInput.briefRequestFor({campaignId:'now',input,brand:{id:'b1',name:'가상',short:'GV',category:'X',color:'#000',bg:'#fff',description:'',audience:'',tone:'',constraints:'',knowledge:''},evidence:{facts:{confirmed:[],candidates:[],prohibited:[]},directives:[]},archive:{sources:[],research:null},sourceMasking:[],trialLearning:null,campaigns,metrics:[],artifacts:[],contextDate:'2026-09-26',storeAllow:[]});
const PREV=[{id:'c-con',brandId:'b1',title:'소비자',goal:'g',plan:{},status:'draft',updatedAt:NOW},{id:'c-obj',brandId:'b1',title:'모집',goal:'g',plan:{},status:'draft',updatedAt:NOW,objective:O}];
const briefIn={brandId:'b1',title:'t',goal:'g',audience:'',channels:'',stores:'',products:'',budget:null,startDate:'',endDate:'',constraints:'',sources:'',plan:{}};
check('4: a consumer brief sees only consumer campaigns and a recruitment brief only recruitment campaigns',same(req(briefIn,PREV).context.previousCampaigns.map(c=>c.id),['c-con'])&&same(req({...briefIn,objective:O},PREV).context.previousCampaigns.map(c=>c.id),['c-obj']));
const objBrief=briefInput.buildBriefSubmission(req({...briefIn,objective:O},PREV)).instructions,conBrief=briefInput.buildBriefSubmission(req(briefIn,PREV)).instructions;
check('4: the recruitment brief instructions end with the franchise policy',objBrief.endsWith('\n'+P)&&conBrief.endsWith('\n'+GENERIC));
check('4: the recruitment brief drops only the consumer 30-day definition line (the policy at the end defines recruitment measurement)',objBrief===briefLib.recruitmentBriefInstructions+'\n'+P&&briefLib.recruitmentBriefInstructions===briefLib.briefInstructions.replace('\n'+MD+'\n','\n')&&!objBrief.includes(MD)&&objBrief.split(P).length===2);
check('4: the consumer brief instructions are the constant plus the generic policy and keep the 30-day definition',conBrief===briefLib.briefInstructions+'\n'+GENERIC&&conBrief.includes(MD));
check('4: briefInstructionsFor switches on the exact value only',[undefined,null,{},{objective:'franchise'},{objective:true},{objective:'FRANCHISE_RECRUITMENT'}].every(v=>briefLib.briefInstructionsFor(v)===briefLib.briefInstructions)&&briefLib.briefInstructionsFor({objective:O})===briefLib.recruitmentBriefInstructions);

// ════ 5) 저장(save_campaign): 형식·스위치·역할·해제·지점·브랜드·제작 기록 ════
const WS='fo-owner';
const boss=f.signIn('fo-boss','admin',1000,WS),admin=f.signIn('fo-admin','admin',2000,WS),member=f.signIn('fo-member','member',3000,WS);
const N='fo-n',F='fo-f',M='fo-m';
for(const b of [N,F,M])await f.brand(WS,b);
const actionRoute=await f.load('app/api/action/route.ts'),storesRoute=await f.load('app/api/stores/route.ts'),execRoute=await f.load('app/api/execution/route.ts');
const headersOf=s=>Object.fromEntries(Object.entries(s).filter(([k])=>k!=='id'));
const call=async res=>({status:res.status,body:await res.json()});
const clearRate=()=>sql.prepare("DELETE FROM records WHERE kind='execution_rate'").run();
const act=async(s,input)=>{clearRate();return call(await actionRoute.POST(new Request('https://agency.test/api/action',{method:'POST',headers:{'content-type':'application/json',...headersOf(s)},body:JSON.stringify(input)})))};
const rawCampaign=id=>JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='campaign' AND id=?").get(WS,`${WS}:campaign:${id}`).data);
const events=id=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='event' AND parent_id=?").all(WS,id).map(r=>JSON.parse(r.data));
const DATA={brandId:N,title:'가상 가맹 모집',goal:'가맹 상담 신청을 받는다.',audience:'예비 창업자(가설)',channels:'네이버 블로그, 매장 QR',stores:'',products:'',budget:null,startDate:'',endDate:'',constraints:'',sources:''};
const saveNew=(s,data)=>act(s,{action:'save_campaign',data});
const saveEdit=(s,c,data)=>act(s,{action:'save_campaign',id:c.id,version:c.version,data});

const off=await saveNew(boss,{...DATA,objective:O});
check('5: setting objective with r_franchise off is 409 (owner)',off.status===409&&off.body.error===agency.OBJECTIVE_MESSAGES.off);
const invalid=[];for(const v of ['franchise','FRANCHISE_RECRUITMENT',' franchise_recruitment','franchise_recruitment ',1,{},[O]])invalid.push(await saveNew(boss,{...DATA,objective:v}));
check('5: any other objective value is 400 (even with the switch off)',invalid.every(r=>r.status===400&&r.body.error===agency.OBJECTIVE_MESSAGES.invalid));
const withStore=await saveNew(boss,{...DATA,objective:O,storeId:'fo-store'});
check('5: objective together with storeId is 400',withStore.status===400&&withStore.body.error===agency.OBJECTIVE_MESSAGES.withStore);
const consumerNull=await saveNew(boss,{...DATA,title:'소비자 null',objective:null}),consumerEmpty=await saveNew(boss,{...DATA,title:'소비자 빈값',objective:''}),consumerNone=await saveNew(member,{...DATA,title:'소비자 없음'});
check('5: consumer saves with null, empty or no objective are 200 and store no objective key',[consumerNull,consumerEmpty,consumerNone].every(r=>r.status===200&&!('objective' in rawCampaign(r.body.id))&&!events(r.body.id).some(e=>e.objectiveChange)));
assert.equal((await f.setFlag(boss,true)).status,200);
const memberSet=await saveNew(member,{...DATA,objective:O});
check('5: a member setting objective is 403',memberSet.status===403&&memberSet.body.error===agency.OBJECTIVE_MESSAGES.adminOnly);
const adminSet=await saveNew(admin,{...DATA,objective:O});
const C1=rawCampaign(adminSet.body.id),setEvent=events(C1.id).find(e=>e.objectiveChange);
check('5: an admin sets objective (200), the record carries it and an audit event names the change',adminSet.status===200&&C1.objective===O&&!C1.storeId&&same(setEvent?.objectiveChange,{from:null,to:O,role:'admin'})&&setEvent.actor?.id==='fo-admin');
const memberSame=await saveEdit(member,C1,{...DATA,goal:'가맹 상담 신청을 더 받는다.',objective:O});
const C2=rawCampaign(C1.id);
check('5: a member edit that resends the same objective is 200 and writes no objective event',memberSame.status===200&&C2.objective===O&&C2.version===2&&events(C1.id).filter(e=>e.objectiveChange).length===1);
const memberOmit=await saveEdit(member,C2,{...DATA,goal:'가맹 상담 신청을 받는다(수정).'});
const C3=rawCampaign(C1.id);
check('5: a member edit without the objective key keeps it',memberOmit.status===200&&C3.objective===O&&C3.version===3);
const memberUnset=await saveEdit(member,C3,{...DATA,objective:null});
check('5: a member unset is 403',memberUnset.status===403&&rawCampaign(C1.id).objective===O);
assert.equal((await f.setFlag(boss,false)).status,200);
const unsetOff=await saveEdit(boss,C3,{...DATA,objective:null});
const C4=rawCampaign(C1.id),unsetEvent=events(C1.id).filter(e=>e.objectiveChange).at(-1);
check('5: the owner unsets with the switch off (the way to turn the recruitment scope off): 200, key removed, audit event',unsetOff.status===200&&!('objective' in C4)&&same(unsetEvent?.objectiveChange,{from:O,to:null,role:'owner'}));
const resetOff=await saveEdit(boss,C4,{...DATA,objective:O});
check('5: setting it again while the switch is off is 409',resetOff.status===409&&!('objective' in rawCampaign(C1.id)));
assert.equal((await f.setFlag(boss,true)).status,200);
const obj=await saveNew(boss,{...DATA,title:'가상 모집 2',objective:O}),CO=rawCampaign(obj.body.id);
const moved=await saveEdit(boss,CO,{...DATA,brandId:M,objective:O});
check('5: an objective campaign cannot move to another brand (400)',moved.status===400&&moved.body.error===agency.OBJECTIVE_MESSAGES.brandLocked&&rawCampaign(CO.id).brandId===N);
await server.recordStatement(WS,'store','fo-store',{id:'fo-store',brandId:N,name:'가상 1호점',address:'가상시 1',status:'active',version:1,createdAt:NOW,updatedAt:NOW},N).run();
const storesPost=async(s,input)=>call(await storesRoute.POST(new Request('https://agency.test/api/stores',{method:'POST',headers:{'content-type':'application/json',...headersOf(s)},body:JSON.stringify(input)})));
const linked=await storesPost(boss,{action:'link_store',storeId:'fo-store',campaignId:CO.id,version:CO.version});
check('5: link_store refuses an objective campaign (400) and leaves it without a store',linked.status===400&&linked.body.error===agency.OBJECTIVE_MESSAGES.withStore&&!rawCampaign(CO.id).storeId);
const storeCampaign=await saveNew(boss,{...DATA,title:'가상 1호점 캠페인',storeId:'fo-store'}),CS=rawCampaign(storeCampaign.body.id);
const storeSet=await saveEdit(boss,CS,{...DATA,title:'가상 1호점 캠페인',objective:O});
check('5: an existing store campaign cannot get objective even when the request omits storeId (400 after the merge)',storeCampaign.status===200&&CS.storeId==='fo-store'&&storeSet.status===400&&storeSet.body.error===agency.OBJECTIVE_MESSAGES.withStore&&!('objective' in rawCampaign(CS.id)));
const CU=rawCampaign((await saveNew(boss,{...DATA,title:'가상 모집 3',objective:O})).body.id);
const unsetWithStore=await saveEdit(boss,CU,{...DATA,title:'가상 모집 3',objective:null,storeId:'fo-store'});
check('5: unsetting objective and attaching a store in one request is 400 (link_store checks production records)',unsetWithStore.status===400&&unsetWithStore.body.error===agency.OBJECTIVE_MESSAGES.unsetWithStore&&rawCampaign(CU.id).objective===O&&!rawCampaign(CU.id).storeId);
const CD=rawCampaign((await saveNew(boss,{...DATA,title:'초안 캠페인'})).body.id);
await server.recordStatement(WS,'brief_draft','fo-draft',{id:'fo-draft',campaignId:CD.id,campaignVersion:CD.version,status:'completed',input:{...DATA,title:'초안 캠페인',plan:{}},result:null,createdAt:NOW,updatedAt:NOW}).run();
const draftSet=await act(boss,{action:'save_campaign',id:CD.id,version:CD.version,briefDraftId:'fo-draft',data:{...DATA,title:'초안 캠페인',objective:O}});
check('5: a consumer-scope brief draft cannot be saved while the same save sets objective (409, like the store rule)',draftSet.status===409&&draftSet.body.error===agency.OBJECTIVE_MESSAGES.draftMismatch&&!('objective' in rawCampaign(CD.id)));
const draftKeep=await act(boss,{action:'save_campaign',id:CD.id,version:CD.version,briefDraftId:'fo-draft',data:{...DATA,title:'초안 캠페인'}});
check('5: the same draft saves when the objective does not change',draftKeep.status===200);
await server.recordStatement(WS,'campaign','fo-junk',{...rawCampaign(CD.id),id:'fo-junk',objective:'FRANCHISE_RECRUITMENT',version:1}).run();
const junk=await saveEdit(member,{id:'fo-junk',version:1},{...DATA,title:'직접 기록 캠페인'});
check('5: a non-exact stored value is a consumer campaign: a member edit is 200 and the stray value is removed without an objective event',junk.status===200&&!('objective' in rawCampaign('fo-junk'))&&!events('fo-junk').some(e=>e.objectiveChange));
const produced=await saveNew(boss,{...DATA,title:'제작한 소비자 캠페인'}),CP=rawCampaign(produced.body.id);
await server.recordStatement(WS,'execution_creative','fo-cr-1',{id:'fo-cr-1',campaignId:CP.id},CP.id).run();
const producedSet=await saveEdit(boss,CP,{...DATA,title:'제작한 소비자 캠페인',objective:O});
check('5: a campaign with production records cannot get objective (409)',producedSet.status===409&&producedSet.body.error===agency.OBJECTIVE_MESSAGES.hasExecution&&!('objective' in rawCampaign(CP.id)));

// ════ 6) 발행 캡션 판정: objective 캠페인은 가맹 프로필 없이도 모집 범위, 스위치를 읽지 않는다 ════
const execPost=async(s,input)=>{clearRate();return call(await execRoute.POST(new Request('https://agency.test/api/execution',{method:'POST',headers:{'content-type':'application/json',...headersOf(s)},body:JSON.stringify(input)})))};
const execGet=async(s,id)=>call(await execRoute.GET(new Request('https://agency.test/api/execution?campaignId='+id,{headers:headersOf(s)})));
const factsRoute=await f.load('app/api/brand-facts/route.ts');
const factPost=async(s,input)=>{clearRate();return call(await factsRoute.POST(new Request('https://agency.test/api/brand-facts',{method:'POST',headers:{'content-type':'application/json',...headersOf(s)},body:JSON.stringify(input)})))};
const confirmed=(brandId,key,value)=>factPost(boss,{action:'save_fact',confirmed:true,data:{brandId,key,value,status:'confirmed',source:'가상 근거',verifiedAt:'2026-09-25T10:00:00+09:00',validUntil:'2027-04-01T00:00:00+09:00'}});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1080,0);ihdr.writeUInt32BE(1080,4);ihdr[8]=8;ihdr[9]=2;
let fill=1;const png=()=>{const pixels=Buffer.alloc((1080*3+1)*1080,fill++);for(let row=0;row<1080;row++)pixels[row*(1080*3+1)]=0;return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]).toString('base64')};
const campaign=async(id,brandId,extra={})=>{const c={id,brandId,title:'가상 도넛 가을',goal:'가을 신메뉴 알리기',audience:'동네 주민',channels:'인스타그램',version:1,status:'approved',startDate:'2026-09-01',endDate:'2026-12-31',budget:0,budgetConfirmedAt:'2026-09-01T00:00:00.000Z',...extra};await server.recordStatement(WS,'campaign',id,c).run();
 if(!await server.readRecord(WS,'publisher_credential',brandId).catch(()=>null))await server.recordStatement(WS,'publisher_credential',brandId,{secret:await server.encrypt('synthetic-buffer-token'),channelId:'channel-1',account:'가상 계정',organizationId:'org',version:1},brandId).run();
 const l=await execPost(boss,{action:'save_limits',campaignId:id,maxPublications:20,maxPlannedCostKRW:0});assert.equal(l.status,200,JSON.stringify(l.body));return {...c,limitsVersion:l.body.version}};
const creative=(c,refs)=>execPost(boss,{action:'save_creative',campaignId:c.id,campaignVersion:c.version,factRefs:refs.map(x=>({id:x.id,version:x.version})),png:png()});
let minute=0;
const publication=(c,creativeId)=>execPost(boss,{action:'save_publication',campaignId:c.id,creativeId,scheduledAt:new Date(Date.parse('2026-10-15T01:00:00.000Z')+(minute++)*60000).toISOString(),plannedCostKRW:0});
const approve=(c,p)=>execPost(boss,{action:'approve',campaignId:c.id,id:p.id,version:p.version,confirmed:true,rightsConfirmed:true,immutableMediaConfirmed:true,channelId:'channel-1',credentialVersion:1,limitsVersion:c.limitsVersion});
// 가맹 프로필도 정보공개서 버전도 없는 브랜드 N: 소비자 캠페인은 판정하지 않고, objective 캠페인은 모집 범위로 판정한다.
const CN=await campaign('fo-exec-n',N),CNO=await campaign('fo-exec-n-obj',N,{objective:O});
const handmade=await confirmed(N,'promotion','매일 직접 굽는 수제 도넛'),revenue=await confirmed(N,'가상 행사 문구','월 순수익 500만원 보장 이벤트');
check('6: synthetic consumer facts are saved',handmade.status===200&&revenue.status===200);
const consumerCard=await creative(CN,[handmade.body]),objectiveCard=await creative(CNO,[handmade.body]);
check('6: a handmade card saves in the consumer campaign and is 409 in the objective campaign (recruitment-only rule)',consumerCard.status===200&&objectiveCard.status===409&&objectiveCard.body.error.includes('가맹 모집 규칙')&&objectiveCard.body.error.includes('수제 표현'));
const revenueConsumer=await creative(CN,[revenue.body]),revenueObjective=await creative(CNO,[revenue.body]);
check('6: a revenue guarantee without recruitment wording saves in a non-franchise consumer campaign and is unremovable in the objective campaign',revenueConsumer.status===200&&revenueObjective.status===409&&revenueObjective.body.error.includes('승인으로 풀 수 없음'));
const stateN=await execGet(boss,CN.id),stateO=await execGet(boss,CNO.id);
check('6: the consumer campaign of a non-franchise brand has no franchise key; the objective campaign reports recruitment scope without a branch or consumer warning',stateN.status===200&&!('franchise' in stateN.body)&&stateO.status===200&&stateO.body.franchise.scope==='recruitment'&&stateO.body.franchise.branch===null&&stateO.body.franchise.recruitmentWarning===null&&same(Object.keys(stateO.body.franchise),['scope','branch','versions','blockedFacts','publications','recruitmentWarning','notice','disclaimer']));
// 사실 사용 게이트: 가맹 문맥이 없는 브랜드라도 objective 캠페인은 정보공개서 근거 없는 가맹 사실(가맹비)을 카드에 쓰지 못한다. 소비자 캠페인은 그대로다.
const legacyFee={id:'fo-fee',brandId:N,key:'franchise_fee',value:'870만원',status:'confirmed',source:'옛 기록',verifiedAt:'2026-09-01T00:00:00.000Z',validUntil:'2027-01-01T00:00:00.000Z',version:1,updatedAt:'2026-09-01T00:00:00.000Z'};
await server.recordStatement(WS,'brand_fact',legacyFee.id,legacyFee,N).run();
const ffacts=await f.load('lib/franchise-facts.ts');
const feeConsumer=await creative(CN,[legacyFee]),feeObjective=await creative(CNO,[legacyFee]);
check('6: an unsourced franchise fee fact is refused in the objective campaign even without franchise records (fact gate) and untouched in the consumer campaign',feeConsumer.status===200&&feeObjective.status===409&&feeObjective.body.error===ffacts.FRANCHISE_FACT_MESSAGES.sourceMissingInUse);
// 발행 쪽 게이트(발행 준비·승인·화면 판정): 소비자 캠페인 때 만든 소재·초안 발행이 남아 있는데 저장 목적이 objective가 된 경우(검증을 거치지 않은 직접 기록)에도 모집 범위로 막는다.
const CN2=await campaign('fo-exec-n2',N),card2=await creative(CN2,[revenue.body]),draftPub=await publication(CN2,card2.body.id);
check('6: the consumer card and draft publication save before objective (200)',card2.status===200&&draftPub.status===200);
await server.recordStatement(WS,'campaign',CN2.id,{...rawCampaign(CN2.id),objective:O}).run();
const pubAfter=await publication(CN2,card2.body.id),approveAfter=await approve(CN2,draftPub.body),stateN2=(await execGet(boss,CN2.id)).body.franchise;
check('6: save_publication judges the caption in recruitment scope (409)',pubAfter.status===409&&pubAfter.body.error.includes('승인으로 풀 수 없음'));
check('6: approval re-checks in recruitment scope (409, the draft stays a draft)',approveAfter.status===409&&approveAfter.body.error.includes('승인으로 풀 수 없음')&&(await server.readRecord(WS,'execution_publication',draftPub.body.id)).status==='draft');
check('6: the publish tab blockers are computed in recruitment scope',stateN2.scope==='recruitment'&&(stateN2.publications[draftPub.body.id]?.blockers??[]).some(x=>x.startsWith('가맹 규칙(해제 불가)')));
assert.equal((await f.setFlag(boss,false)).status,200);
const whileOff=await creative(CNO,[revenue.body]);
check('6: turning r_franchise off does not relax a stored objective campaign (the switch is not read)',whileOff.status===409&&whileOff.body.error.includes('승인으로 풀 수 없음'));
assert.equal((await f.setFlag(boss,true)).status,200);
// 가맹 프로필 브랜드 F: objective를 해제하면 소비자 범위로 돌아가 모집 문구 없는 수익 표현은 경고만 남는다(R2 15d). 모집 문구가 있으면 해제 뒤에도 해제 불가다.
assert.equal((await f.profile(boss,F,{forecastInputs:{sme:true,storesAtFyEnd:3,fiscalYearEnd:'2025-12-31'},storageLabels:['가상 보관함']},0)).status,200);
const revenueF=await confirmed(F,'가상 행사 문구','월 순수익 500만원 보장 이벤트'),recruitF=await confirmed(F,'가상 행사 문구 2','월 순수익 500만원 보장 이벤트 · 가맹 문의 환영');
const CFO=await campaign('fo-exec-f-obj',F,{objective:O});
// 모집처럼 읽히는 제목: 소비자 캠페인은 '소비자 캠페인 규칙만 적용' 경고를 받고, objective 캠페인은 그 경고 없이 모집 범위다(분기 A).
const CFT=await campaign('fo-exec-f-title',F,{title:'가맹점 모집 설명회 안내'}),CFTO=await campaign('fo-exec-f-title-obj',F,{title:'가맹점 모집 설명회 안내',objective:O});
const titleConsumer=(await execGet(boss,CFT.id)).body.franchise,titleObjective=(await execGet(boss,CFTO.id)).body.franchise;
check('6: a recruitment-looking title warns only in the consumer campaign; the objective campaign is recruitment scope with branch A and no consumer warning',titleConsumer.scope==='consumer'&&typeof titleConsumer.recruitmentWarning==='string'&&titleObjective.scope==='recruitment'&&titleObjective.branch==='A'&&titleObjective.recruitmentWarning===null);
const beforeUnset=await creative(CFO,[revenueF.body]);
check('6: in a franchise-profile brand the objective campaign blocks the plain revenue guarantee (409)',beforeUnset.status===409&&beforeUnset.body.error.includes('승인으로 풀 수 없음'));
const unset=await act(boss,{action:'save_campaign',id:CFO.id,version:1,data:{brandId:F,title:'가상 도넛 가을',goal:'가을 신메뉴 알리기',audience:'동네 주민',channels:'인스타그램',stores:'',products:'',budget:0,startDate:'2026-09-01',endDate:'2026-12-31',constraints:'',sources:'',objective:null}});
assert.equal(unset.status,200,JSON.stringify(unset.body));
// 브리프 수정은 기획 승인을 끝내므로(상태 draft) 발행 승인 검사를 위해 합성 기록을 다시 승인 상태로 둔다(목적 키는 해제된 그대로).
const CFCraw=rawCampaign(CFO.id);await server.recordStatement(WS,'campaign',CFO.id,{...CFCraw,status:'approved'}).run();
const CFC={...CFCraw,status:'approved',limitsVersion:CFO.limitsVersion};
check('6: the unset record has no objective key',!('objective' in CFCraw)&&CFCraw.version===2);
const afterPlain=await creative(CFC,[revenueF.body]),afterRecruit=await creative(CFC,[recruitF.body]);
check('6: after the unset the plain claim is a consumer warning (200) and the recruitment-worded claim stays 409',afterPlain.status===200&&afterRecruit.status===409&&afterRecruit.body.error.includes('승인으로 풀 수 없음'));
const pubPlain=await publication(CFC,afterPlain.body.id),approvedPlain=await approve(CFC,pubPlain.body);
check('6: the unset consumer caption approves with the franchise warning only',pubPlain.status===200&&approvedPlain.status===200&&(await execGet(boss,CFC.id)).body.franchise.scope==='consumer');
// 다른 스위치(예: A3 a3_copy_pack)는 실행 경로가 읽어도 된다. 막는 것은 모집 범위를 r_franchise로 여닫는 것뿐이다.
check('6: execution and model runners do not read the franchise switch (stored objective drives the scope)',['lib/execution-server.ts','lib/role-execution.ts','lib/meeting-execution.ts','lib/brief-execution.ts'].every(p=>!/r_franchise/.test(readFileSync(p,'utf8'))));

// ════ 6b) 화면(원문 검사, mocked): 목적은 목적 선택란에서만 보내고, 선택란은 대표·관리자에게만 보인다(스위치가 꺼져도 지정된 캠페인은 해제할 수 있게) ════
const briefSrc=readFileSync('app/campaign-brief.tsx','utf8');
check('6b: the dialog strips the objective carried in the form and sends it only from the objective control (null to unset, no key for consumer campaigns)',briefSrc.includes('delete rest.objective')&&briefSrc.includes('...(objective||storedObjective?{objective:objective||null}:{})')&&briefSrc.includes('const storedObjective=isRecruitmentObjective(edit)')&&briefSrc.includes('data:briefData()'));
check('6b: only owner/admin see the objective control, and an objective campaign disables store selection',briefSrc.includes('canManage&&(franchiseOn||storedObjective||!!objective)?')&&briefSrc.includes('setFranchiseOn(false)')&&briefSrc.includes('const canManage=canChange(useAccount())')&&briefSrc.includes('disabled={!!lockedStoreId||!!objective||storedObjective||active||busy}')&&briefSrc.includes('edit&&!lockedStoreId&&!objective&&!storedObjective&&linkChoice'));
const panelSrc=readFileSync('app/execution-panel.tsx','utf8');
check('6b: the publish tab names the recruitment scope for objective campaigns and keeps the consumer sentence',panelSrc.includes("state.franchise.scope==='recruitment'?'가맹 모집 캠페인입니다.")&&panelSrc.includes('가맹 프로필이 있는 브랜드입니다. 캡션에 가맹 모집 규칙(소비자 캠페인 범위)을 적용합니다.'));

// ════ 7) 모델 제출: 역할 입력과 브리프 초안 ════
const hermes=mockHermes();
const rt=testRuntime(hermes.fetch);
const s=await rt.load('lib/server.ts'),execution=await rt.load('lib/role-execution.ts'),brief=await rt.load('lib/brief-execution.ts');
const owner='fo-model-owner';
await seed(s,rt.sql,owner);
const consumerRun=await runRole(execution,s,owner,roleCampaign,'cmo');
const objectiveCampaign={...roleCampaign,id:'fo-role-obj',objective:O};
// 상시 지시는 캠페인마다 붙으므로 시드 지시와 같은 합성 지시를 objective 캠페인에도 둔다(입력 비교를 campaign·channelPractice로 좁힌다).
await s.recordStatement(owner,'campaign_directive','fo-directive',{id:'fo-directive',campaignId:objectiveCampaign.id,text:'합성 지시: 날짜는 D-day 상대 일정으로 쓴다.',createdAt:'2026-01-01T00:00:00.000Z',createdBy:{id:'synthetic-member',email:null,role:'member'}},objectiveCampaign.id).run();
const objectiveRun=await runRole(execution,s,owner,objectiveCampaign,'cmo');
const ci=JSON.parse(consumerRun.input),oi=JSON.parse(objectiveRun.input);
check('7: an objective role run replaces only the 30-day definition in the instructions and changes only campaign and channelPractice in the input',objectiveRun.instructions===consumerRun.instructions.replace(MD,()=>P)&&objectiveRun.instructions!==consumerRun.instructions&&same(diffKeys(oi,ci),['campaign','channelPractice'])&&oi.campaign.objective===O);
check('7: the objective role input carries the recruitment bodies and the franchise policy and no consumer channel skill',oi.channelPractice===practice.campaignPractice(objectiveCampaign)&&['franchise','keyword','leadad'].every(id=>oi.channelPractice.includes(bodyOf(id)))&&oi.channelPractice.includes(P)&&!oi.channelPractice.includes(bodyOf('offline'))&&!oi.channelPractice.includes(bodyOf('search')));
// 회의(R3b): 소비자 회의를 끝까지 돌린 기록으로, 같은 기록의 스냅샷 캠페인에 objective를 넣은 사본의 단계 제출을 비교한다(meeting-input이 스냅샷 캠페인으로 판정).
const meetingExec=await rt.load('lib/meeting-execution.ts'),meetingInput=await rt.load('lib/meeting-input.ts');
const met=await runMeeting(meetingExec,s,owner,meetingCampaign,'fo-meeting'),done=met.meeting;
const withObjective=m=>({...m,snapshot:{...m.snapshot,campaign:{...m.snapshot.campaign,objective:O}}});
const withoutSkill=m=>Object.fromEntries(Object.entries(m).filter(([k])=>k!=='skillVersion'));
const meetingRows=done.steps.map((st,i)=>{
 const a=meetingInput.buildMeetingSubmission(done,st.id,[]),b=meetingInput.buildMeetingSubmission(withObjective(done),st.id,[]);
 const a0=meetingInput.buildMeetingSubmission(withoutSkill(done),st.id,[]),b0=meetingInput.buildMeetingSubmission(withObjective(withoutSkill(done)),st.id,[]);
 return {stored:a.instructions===met.steps[i].instructions,replaced:a.instructions.split(MD).length===2&&b.instructions===a.instructions.replace(MD,()=>P),keys:same(diffKeys(JSON.parse(b.input),JSON.parse(a.input)),['campaign','channelPractice']),plain:!a0.instructions.includes(MD)&&b0.instructions===a0.instructions};
});
check('7: the consumer meeting completes (enhanced) and rebuilding each step gives the stored instructions',done.status==='completed'&&done.skillVersion===practice.PRACTICE_VERSION&&meetingRows.length===12&&meetingRows.every(r=>r.stored));
check('7: an objective snapshot replaces only the 30-day definition in every enhanced meeting step instruction',meetingRows.every(r=>r.replaced));
check('7: the objective meeting input changes only campaign and channelPractice',meetingRows.every(r=>r.keys));
check('7: a meeting without skillVersion (not enhanced) keeps identical instructions under objective',meetingRows.every(r=>r.plain));
const retryStep=done.steps.find(t=>t.phase==='discussion'),retried=m=>({...m,steps:m.steps.map(t=>t.id===retryStep.id?{...t,correction:{error:'합성 검증 실패'}}:t)});
const ra=meetingInput.buildMeetingSubmission(retried(done),retryStep.id,[]),rb=meetingInput.buildMeetingSubmission(withObjective(retried(done)),retryStep.id,[]);
check('7: a correction retry step keeps its correction sentence and gets the same replacement',ra.instructions.startsWith(meetingInput.buildMeetingSubmission(done,retryStep.id,[]).instructions)&&ra.instructions.length>meetingInput.buildMeetingSubmission(done,retryStep.id,[]).instructions.length&&rb.instructions===ra.instructions.replace(MD,()=>P));
await s.recordStatement(owner,'campaign',objectiveCampaign.id,objectiveCampaign).run();
const objStart=await (await brief.executeBrief(owner,{action:'start',id:'fo-brief-obj',data:{brandId:seedBrand.id,title:'가상 모집 초안',goal:'가맹 상담 신청을 받는다.'},campaignId:objectiveCampaign.id,campaignVersion:objectiveCampaign.version})).json();
const objDraft=JSON.parse(rt.sql.prepare("SELECT data FROM records WHERE owner=? AND kind='brief_draft' AND json_extract(data,'$.id')='fo-brief-obj'").get(owner).data);
check('7: a brief draft of the objective campaign inherits the stored objective',objStart.status==='queued'&&objDraft.input.objective===O);
await (await brief.executeBrief(owner,{action:'cancel',id:'fo-brief-obj'})).json().catch(()=>null);
rt.sql.prepare("UPDATE records SET data=json_set(data,'$.status','cancelled') WHERE owner=? AND kind='brief_draft'").run(owner);
const conStart=await (await brief.executeBrief(owner,{action:'start',id:'fo-brief-con',data:{brandId:seedBrand.id,title:'가상 소비자 초안',goal:'첫 방문을 늘린다.',objective:O}})).json();
const conDraft=JSON.parse(rt.sql.prepare("SELECT data FROM records WHERE owner=? AND kind='brief_draft' AND json_extract(data,'$.id')='fo-brief-con'").get(owner).data);
check('7: a brief draft never takes objective from the request (no key, no 400)',conStart.status==='queued'&&!('objective' in conDraft.input));
rt.sql.prepare("UPDATE records SET data=json_set(data,'$.status','cancelled') WHERE owner=? AND kind='brief_draft'").run(owner);
const storeReq=await brief.executeBrief(owner,{action:'start',id:'fo-brief-store',data:{brandId:seedBrand.id,title:'가상',goal:'가맹 상담',storeId:'pr-store'},campaignId:objectiveCampaign.id,campaignVersion:objectiveCampaign.version});
check('7: a brief draft of an objective campaign with a store in the request is 400',storeReq.status===400);
const submissions=[...hermes.bodies.values()].map(b=>JSON.parse(b));
const briefSubs=submissions.filter(b=>!JSON.parse(b.input).task&&!JSON.parse(b.input).phase);
check('7: the objective brief instructions end with the franchise policy and the consumer brief with the generic policy',briefSubs.length===2&&briefSubs[0].instructions.endsWith('\n'+P)&&briefSubs[1].instructions.endsWith('\n'+GENERIC));
check('7: the objective brief submission has no consumer 30-day definition and the consumer brief keeps it',!briefSubs[0].instructions.includes(MD)&&briefSubs[1].instructions.includes(MD));
check('7: no external call',hermes.external.length===0&&f.calls.length===0);

console.log(JSON.stringify({passed:passed.length}));

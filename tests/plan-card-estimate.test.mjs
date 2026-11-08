// 실행 전 계획 카드(X3) 추정(lib/token-estimate.ts)과 실행 타임라인(X2) 상태 어휘(lib/run-timeline.ts). 순수 모듈만 vm에 올린다(mocked, 네트워크 없음).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console,TextEncoder,Date}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,isolatedModules:true}}).outputText,{context,identifier:path});cache.set(path,m);return m}
async function load(path){const m=moduleFor(path);await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();return m.namespace}
const est=await load('lib/token-estimate.ts'),tl=await load('lib/run-timeline.ts');
let passed=0;const check=(name,value)=>{assert.ok(value,name);passed++};
const plain=x=>JSON.parse(JSON.stringify(x));
const roles=[{id:'cmo',name:'총괄 파트너',deliverable:'실행 브리프'},{id:'insight',name:'고객 인사이트',deliverable:'관찰 사실'},{id:'content',name:'콘텐츠 스튜디오',deliverable:'카피 3종'}];
const campaign={id:'c1',brandId:'ofd',title:'평일 오후 픽업 캠페인',goal:'평일 오후 3~5시 포장 주문 20% 증가',audience:'성수동 직장인',channels:'Instagram, 네이버 플레이스',stores:'성수점',products:'크림 도넛',budget:300000,startDate:'2026-11-10',endDate:'2026-12-10',constraints:'할인 의존 금지',sources:'',status:'ready',version:1};
const brand={id:'ofd',name:'브랜드',description:'묵직한 도우',audience:'디저트 고객',tone:'따뜻한',constraints:'로고 유지',knowledge:'네이비+크림'};

// --- 입력 토큰 추정식(서버 예산 가드와 같은 식) -------------------------------------------
check('ASCII estimates chars/2',est.estimateInputTokens('a'.repeat(101))===51);
check('Korean estimates about one token per character',est.estimateInputTokens('가'.repeat(100))===100);
check('empty text estimates zero',est.estimateInputTokens('')===0);
check('averageOf ignores null, zero and negative values',est.averageOf([null,0,-5,100,200])===150&&est.averageOf([])===null&&est.averageOf([null])===null);

// --- 역할 실행 계획 ---------------------------------------------------------------------
const first=est.estimateRolePlan({roles,campaign,brand,artifacts:[],directives:0,recent:[]});
check('role plan returns a positive integer per remaining role and a total',first.items.length===3&&first.items.every(i=>Number.isSafeInteger(i.estimatedTokens)&&i.estimatedTokens>0)&&first.totalTokens===first.items.reduce((n,i)=>n+i.estimatedTokens,0));
check('role plan is labelled as an estimate with input basis when no history exists',first.label==='추정'&&first.items.every(i=>i.basis==='input')&&first.samples===0);
check('role plan has no duration without history',first.durationMs===null);
const withArtifacts=est.estimateRolePlan({roles,campaign,brand,artifacts:[{role:'cmo',content:'가'.repeat(6000)}],directives:3,recent:[]});
check('upstream artifacts and directives raise the estimate of later roles',withArtifacts.items[2].estimatedTokens>first.items[2].estimatedTokens&&withArtifacts.items[0].estimatedTokens>first.items[0].estimatedTokens);
check('a role does not count its own previous artifact as upstream',withArtifacts.items[0].estimatedTokens<withArtifacts.items[1].estimatedTokens);
const recent=[{role:'cmo',tokens:50000,durationMs:60000},{role:'cmo',tokens:70000,durationMs:120000},{role:'insight',tokens:9000,durationMs:30000},{role:'content',tokens:null,durationMs:null}];
const withHistory=est.estimateRolePlan({roles,campaign,brand,artifacts:[],directives:0,recent});
check('recent averages override smaller input estimates per role',withHistory.items[0].estimatedTokens===60000&&withHistory.items[0].basis==='history');
check('a role with unknown recent tokens keeps its input estimate',withHistory.items[2].basis==='input'&&withHistory.items[2].estimatedTokens===first.items[2].estimatedTokens);
check('duration stays unknown while any remaining role lacks a duration',withHistory.durationMs===null&&withHistory.samples===3);
const allKnown=est.estimateRolePlan({roles:roles.slice(0,2),campaign,brand,artifacts:[],directives:0,recent});
check('duration is the sum of per-role recent averages when every role has one',allKnown.durationMs===90000+30000);

// --- 회의 계획 --------------------------------------------------------------------------
const roster=[...roles,{id:'strategy',name:'전략',deliverable:'전략'},{id:'creative',name:'크리에이티브',deliverable:'콘셉트'},{id:'growth',name:'그로스',deliverable:'채널'},{id:'data',name:'데이터',deliverable:'측정'},{id:'quality',name:'품질',deliverable:'검수'}];
const meeting=est.estimateMeetingPlan({roles:roster,campaign,brand,agenda:'가장 큰 약점을 검토',artifacts:[{role:'content',content:'카피 '.repeat(500)}],directives:2,history:[]});
check('meeting plan lists eight discussion items, synthesis, revisions and quality',meeting.items.length===11&&meeting.items.filter(i=>i.id.startsWith('discussion:')).length===8&&meeting.items.some(i=>i.id==='synthesis')&&meeting.items.some(i=>i.id==='revision')&&meeting.items.some(i=>i.id==='quality'));
check('meeting plan totals twelve steps worth of tokens',meeting.totalTokens===meeting.items[0].estimatedTokens*est.MEETING_DEFAULT_STEPS&&meeting.durationMs===null);
const meetingHistory=est.estimateMeetingPlan({roles:roster,campaign,brand,agenda:'a',artifacts:[],directives:0,history:[{tokens:600000,durationMs:600000,steps:12},{tokens:480000,durationMs:480000,steps:12}]});
check('completed meetings set the per-step average and duration',meetingHistory.items[0].estimatedTokens===45000&&meetingHistory.items[0].basis==='history'&&meetingHistory.durationMs===540000&&meetingHistory.samples===2);

// --- 완료 뒤 실제 대비 추정 ---------------------------------------------------------------
check('comparison keeps an unknown actual as null',plain(est.compareTokens(1000,null)).ratio===null&&est.compareTokens(1000,null).label==='실제 사용량 미확인');
check('comparison labels over, under and close',est.compareTokens(1000,1500).label==='추정보다 많이 썼습니다.'&&est.compareTokens(1000,500).label==='추정보다 적게 썼습니다.'&&est.compareTokens(1000,1000).label==='추정과 비슷합니다.'&&est.compareTokens(1000,1000).ratio===1);
check('token formatting uses Korean grouping and the unknown word',est.formatTokens(12345)==='12,345 토큰'&&est.formatTokens(null)==='미확인');

// --- 타임라인 상태 어휘 -------------------------------------------------------------------
const labels=Object.fromEntries(['pending','starting','queued','running','in_progress','waiting_for_approval','uncertain','completed','failed','cancelled','incomplete'].map(s=>[s,tl.statusView(s).label]));
check('every known status has a Korean text label',plain(labels).pending==='대기'&&labels.running==='실행 중'&&labels.in_progress==='실행 중'&&labels.waiting_for_approval==='승인 대기'&&labels.completed==='완료'&&labels.failed==='실패'&&labels.cancelled==='취소'&&labels.incomplete==='중단됨'&&labels.uncertain==='접수 확인 필요');
check('thinking uses a concrete verb per phase',tl.statusView('thinking','discussion').label==='근거 정리 중'&&tl.statusView('thinking','synthesis').label==='합의안 정리 중'&&tl.statusView('thinking','revision').label==='개선본 작성 중'&&tl.statusView('thinking','quality').label==='검수 항목 대조 중'&&tl.statusView('thinking').label==='근거 정리 중');
check('an unknown legacy status still renders as unknown instead of crashing',tl.statusView('mystery').label==='상태 미확인'&&tl.statusView('mystery').tone==='unknown'&&tl.statusView('').label==='상태 미확인');
check('live statuses are the ones still moving',['starting','queued','running','in_progress','thinking','waiting_for_approval'].every(s=>tl.statusView(s).live)&&['pending','completed','failed','cancelled','uncertain','mystery'].every(s=>!tl.statusView(s).live));
const now=Date.parse('2026-11-09T03:00:10.000Z');
check('elapsed uses finish time for finished items and now for live ones',tl.elapsedMs({status:'completed',startedAt:'2026-11-09T03:00:00.000Z',finishedAt:'2026-11-09T03:00:05.000Z'},now)===5000&&tl.elapsedMs({status:'running',startedAt:'2026-11-09T03:00:00.000Z'},now)===10000);
check('elapsed is unknown without a start or without a finish for a finished item',tl.elapsedMs({status:'running'},now)===null&&tl.elapsedMs({status:'completed',startedAt:'2026-11-09T03:00:00.000Z'},now)===null);
check('elapsed formats seconds, minutes and hours',tl.formatElapsed(12000)==='12초'&&tl.formatElapsed(185000)==='3분 05초'&&tl.formatElapsed(4380000)==='1시간 13분'&&tl.formatElapsed(null)==='경과 미확인');
const roleName=id=>({cmo:'총괄 파트너',content:'콘텐츠 스튜디오'})[id]||id,phaseName=p=>({discussion:'의견 교환',synthesis:'합의'})[p];
const steps=[{id:'m:discussion:cmo',role:'cmo',phase:'discussion',status:'completed',startedAt:'2026-11-09T03:00:00.000Z',completedAt:'2026-11-09T03:00:05.000Z',tokens:120,attempt:1},{id:'m:discussion:content',role:'content',phase:'discussion',status:'legacy_value'},{id:'m:synthesis',role:'cmo',phase:'synthesis',status:'pending'}];
const items=plain(tl.meetingTimeline(steps,roleName,phaseName));
check('meeting steps map to timeline items with role, phase, times, attempt and tokens',items[0].title==='총괄 파트너'&&items[0].subtitle==='의견 교환'&&items[0].finishedAt==='2026-11-09T03:00:05.000Z'&&items[0].attempt===2&&items[0].tokens===120&&items[2].status==='pending');
check('legacy step statuses are kept verbatim and still labelled',items[1].status==='legacy_value'&&tl.statusView(items[1].status).label==='상태 미확인'&&items[1].tokens===null);
const runs=plain(tl.runTimeline([{id:'r2',role:'content',status:'in_progress',createdAt:'2026-11-09T03:02:00.000Z',tokens:0},{id:'r1',role:'cmo',status:'completed',createdAt:'2026-11-09T03:00:00.000Z',tokens:900},{id:'r0',role:'cmo',status:'incomplete',createdAt:'2026-11-09T02:00:00.000Z',tokens:0}],roleName,2));
check('run timeline is chronological, limited, and uses the receipt time as start',runs.length===2&&runs[0].id==='r1'&&runs[1].id==='r2'&&runs[0].startedAt==='2026-11-09T03:00:00.000Z'&&runs[0].tokens===900&&runs[1].tokens===null);
check('finished runs without a recorded finish do not invent an elapsed time',tl.elapsedMs(runs[0],now)===null&&tl.elapsedMs(runs[1],Date.parse('2026-11-09T03:02:30.000Z'))===30000);
check('hasLive and polling interval are exported for screens',tl.hasLive(runs)===true&&tl.hasLive([runs[0]])===false&&tl.POLL_RUNNING_MS===3000);
console.log(JSON.stringify({passed}));

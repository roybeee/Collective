import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

// C1 커넥터 프레임워크 v2: 레지스트리 서술자 규칙, 한도 큐(고정 창·대기), 429 Retry-After·지터 백오프, 결과 분류(쓰기 unknown은 재시도 금지),
// 계약 테스트 하네스 5 시나리오(성공·실패·타임아웃·재시작/재개·중복)를 모의 커넥터로 돈다. 네트워크·D1 없음(순수, mocked 아님·real 아님: 순수 함수 검증).
const rt=testRuntime(async()=>new Response('{}'));
const registry=await rt.load('lib/connectors/registry.ts'),queue=await rt.load('lib/connectors/rate-queue.ts'),contract=await rt.load('lib/connectors/contract-test.ts');
let checks=0;const failures=[];function check(value,label){checks++;if(!value)failures.push(label)}

// 1) 레지스트리: 현재 커넥터가 모두 있고 서술자 규칙 위반이 없다.
const keys=registry.connectorRegistry.map(d=>d.key);
check(['instagram','naver_ads','buffer','meta_ads','store_browser','ftc_franchise'].every(k=>keys.includes(k)),'registry lists the current connectors: '+keys.join(','));
check(registry.describeViolations().length===0,'registry has no descriptor violations: '+registry.describeViolations().join(' | '));
check(registry.capabilityFor('buffer.post.publish')?.riskTier==='T3'&&registry.capabilityFor('meta_ads.campaign.execution')?.riskTier==='T4'&&registry.capabilityFor('instagram.insights.read')?.riskTier==='T1','tiers: buffer publish T3, meta execution T4, instagram read T1');
check(registry.connectorRegistry.flatMap(d=>d.capabilities).every(c=>c.defaultOff===true&&c.retryUnknown===false),'every capability is default off and never retries unknown writes');
check(registry.capabilityFor('instagram.insights.read')?.credentialScope==='store'&&registry.capabilityFor('naver_ads.stats.read')?.credentialScope==='store','read connectors allow store-scoped credentials (lib/channel-credentials.ts F5)');
check(registry.capabilitiesByTier('T4').map(c=>c.key).sort().join(',')==='meta_ads.campaign.execution,meta_ads.conversion.capi','T4 is only money-moving Meta writes');
const bad=registry.describeViolations([{key:'x',label:'x',module:'x',capabilities:[{key:'x.a',reads:[],writes:['w'],riskTier:'T1',rateLimit:{},credentialScope:'brand',defaultOff:true,flag:null,retryUnknown:false},{key:'x.a',reads:[],writes:[],riskTier:'T3',rateLimit:{perMinute:1},credentialScope:'brand',defaultOff:false,flag:null,retryUnknown:false}]}]);
check(bad.length>=5,'violations are reported for bad key form, duplicate key, write on T1, no-write T3, no limit, defaultOff false: '+bad.length);

// 2) 한도 큐: 분당 2회 → 세 번째는 거부되고 대기 시간이 창 끝까지다. 창이 지나면 다시 허용. 상태는 새 객체다.
const limit={perMinute:2,perSecond:5};
let s=queue.emptyQueue;
const r1=queue.reserve(s,'acct',limit,1000),r2=queue.reserve(r1.state,'acct',limit,2000),r3=queue.reserve(r2.state,'acct',limit,3000);
check(r1.allowed&&r2.allowed&&!r3.allowed&&r3.waitMs===58000,'third call within the minute waits until the window ends: '+r3.waitMs);
check(s===queue.emptyQueue&&Object.keys(s).length===0&&r1.state!==r2.state,'reserve returns new state objects and never mutates the input');
check(queue.reserve(r3.state,'other',limit,3000).allowed,'another account key has its own bucket');
check(queue.reserve(r3.state,'acct',limit,61000).allowed,'after the window the same key is allowed again');
check(queue.reserve(queue.emptyQueue,'acct',{},0).allowed&&queue.reserve(queue.emptyQueue,'acct',{perSecond:0},0).allowed,'no limit means always allowed');
const perSecond={perSecond:1};const p1=queue.reserve(queue.emptyQueue,'k',perSecond,10),p2=queue.reserve(p1.state,'k',perSecond,500);
check(p1.allowed&&!p2.allowed&&p2.waitMs===510,'per-second window waits the remainder of the second');

// 3) 결과 분류: 2xx 성공, 429 rate_limited, 5xx 읽기 retryable·쓰기 unknown, 4xx fatal, 보낸 뒤 타임아웃 쓰기 unknown, 보내기 전 실패 retryable.
const cls=(r,w)=>queue.classifyOutcome(r,w);
check(cls({kind:'response',status:200},true)==='success'&&cls({kind:'response',status:429},true)==='rate_limited'&&cls({kind:'response',status:503},false)==='retryable'&&cls({kind:'response',status:503},true)==='unknown'&&cls({kind:'response',status:400},false)==='fatal'&&cls({kind:'response',status:401},true)==='fatal','response classification');
check(cls({kind:'timeout',sent:true},true)==='unknown'&&cls({kind:'timeout',sent:true},false)==='retryable'&&cls({kind:'network_error',sent:false},true)==='retryable'&&cls({kind:'network_error',sent:true},true)==='unknown'&&cls({kind:'thrown'},true)==='fatal','timeout and network classification');
const policy={maxAttempts:3,baseDelayMs:100,maxDelayMs:5000};
check(queue.retryDecision({outcome:'unknown',attempt:1,policy,write:true}).retry===false&&queue.retryDecision({outcome:'unknown',attempt:1,policy,write:true}).reason==='unknown_write','unknown write outcome is never retried');
check(queue.retryDecision({outcome:'retryable',attempt:1,policy,write:false}).retry===true&&queue.retryDecision({outcome:'retryable',attempt:3,policy,write:false}).reason==='max_attempts'&&queue.retryDecision({outcome:'fatal',attempt:1,policy,write:false}).reason==='fatal'&&queue.retryDecision({outcome:'rate_limited',attempt:2,policy,write:true}).retry===true,'retry decisions');

// 4) 429 백오프: Retry-After 초·HTTP 날짜·잘못된 값, 지터 지수 백오프와 상한.
const now=Date.UTC(2026,10,9,0,0,0);
check(queue.retryAfterMs('7',now)===7000&&queue.retryAfterMs(new Date(now+30000).toUTCString(),now)===30000&&queue.retryAfterMs(new Date(now-30000).toUTCString(),now)===0&&queue.retryAfterMs('soon',now)===null&&queue.retryAfterMs(null,now)===null,'Retry-After parsing');
check(queue.nextDelayMs({attempt:1,policy,retryAfterMs:7000,random:()=>0})===5000&&queue.nextDelayMs({attempt:1,policy,retryAfterMs:700,random:()=>0})===700,'Retry-After wins over exponential and is capped');
check(queue.nextDelayMs({attempt:1,policy,random:()=>0.5})===100&&queue.nextDelayMs({attempt:2,policy,random:()=>0.5})===200&&queue.nextDelayMs({attempt:3,policy,random:()=>0})===200&&queue.nextDelayMs({attempt:3,policy,random:()=>0.999})===600&&queue.nextDelayMs({attempt:20,policy,random:()=>0.5})===5000,'jittered exponential backoff within 0.5x~1.5x and capped');

// 5) runWithBackoff: 429 두 번(Retry-After 1초·없음) 뒤 성공, 대기는 Retry-After·지터 순이다. 쓰기 타임아웃은 1회로 끝나며 onBeforeSend가 먼저 불린다.
const deps=()=>{const waits=[];let t=0;return {deps:{now:()=>t,random:()=>0.5,sleep:async ms=>{waits.push(ms);t+=ms}},waits}};
{
 const d=deps();let n=0;
 const run=await queue.runWithBackoff({key:'a',limit:{perMinute:10},write:false,policy,send:async()=>{n++;return n===1?{kind:'response',status:429,retryAfter:'1'}:n===2?{kind:'response',status:429}:{kind:'response',status:200,value:'ok'}}},d.deps);
 check(run.outcome==='success'&&run.attempts===3&&run.value==='ok'&&JSON.stringify(run.waits)==='[1000,200]','429 then Retry-After wait, then jittered wait, then success: '+JSON.stringify(run.waits));
}
{
 const d=deps();const order=[];
 const run=await queue.runWithBackoff({key:'w',limit:{perMinute:10},write:true,policy,onBeforeSend:async a=>{order.push('journal'+a)},send:async()=>{order.push('send');return {kind:'timeout',sent:true}}},d.deps);
 check(run.outcome==='unknown'&&run.attempts===1&&order.join(',')==='journal1,send','a write timeout after send ends as unknown with no retry and the journal written before sending');
}
{
 const d=deps();let n=0;
 const run=await queue.runWithBackoff({key:'q',limit:{perSecond:1},write:false,policy,send:async()=>{n++;return {kind:'response',status:200,value:n}}},d.deps);
 const run2=await queue.runWithBackoff({key:'q',limit:{perSecond:1},write:false,policy,state:run.state,send:async()=>{n++;return {kind:'response',status:200,value:n}}},d.deps);
 check(run.waits.length===0&&run2.waits.length===1&&run2.waits[0]===1000&&run2.outcome==='success','the second call in the same second waits for the window before sending');
}

// 6) 계약 하네스: 모의 커넥터(서술자 구현)로 5 시나리오가 모두 통과한다. 쓰기 능력이 없는 커넥터에 쓰기 작업을 넣으면 거부한다.
const mockCapabilities=[
 {key:'mock.items.read',reads:['items'],writes:[],riskTier:'T1',rateLimit:{perMinute:100},credentialScope:'brand',defaultOff:true,flag:null,retryUnknown:false},
 {key:'mock.items.write',reads:[],writes:['items'],riskTier:'T3',rateLimit:{perMinute:100},credentialScope:'brand',defaultOff:true,flag:'mock_write',retryUnknown:false},
];
check(registry.describeViolations([{key:'mock',label:'모의',module:'tests',capabilities:mockCapabilities}]).length===0,'the mock connector descriptor is valid');
const results=await contract.runContractScenarios(contract.scriptedConnector(mockCapabilities),{read:'mock.items.read',write:'mock.items.write'});
check(results.length===5&&results.map(r=>r.scenario).join(',')==='success,failure,timeout,restart_resume,duplicate_idempotent','five scenarios run in order');
for(const r of results)check(r.passed,`contract scenario ${r.scenario}: ${r.details.join(' | ')}`);
let refused=null;try{await contract.submit(contract.scriptedConnector(mockCapabilities)({}),contract.memoryJournal(),{id:'x',capability:'mock.nothing.write'},{now:()=>0,random:()=>0,sleep:async()=>{}})}catch(e){refused=e.message}
check(/서술자/.test(refused||''),'an operation outside the descriptor is refused');
// 하네스가 규율 위반을 잡는지: 보낸 뒤 타임아웃을 '보내기 전 실패'로 속여 쓰기를 재전송하는 나쁜 커넥터는 timeout 시나리오에서 실패해야 한다.
const badFactory=script=>{const inner=contract.scriptedConnector(mockCapabilities)(script);return {...inner,calls:inner.calls,async execute(op,attempt){const r=await inner.execute(op,attempt);return r.kind==='timeout'?{kind:'network_error',sent:false}:r}}};
const badResults=await contract.runContractScenarios(badFactory,{read:'mock.items.read',write:'mock.items.write'});
check(badResults.find(r=>r.scenario==='timeout').passed===false&&badResults.filter(r=>r.passed).length===4,'the harness reports a connector that resends a write after an ambiguous timeout as failing the timeout scenario');

// 7) 문서: 커넥터 문서가 서술자·위험도·큐·자격증명 단위·계약 테스트를 적는다.
const doc=readFileSync('docs/CONNECTORS.ko.md','utf8');
check(['T1','T4','rate-queue','contract-test','channel-credentials','Retry-After','unknown'].every(w=>doc.includes(w)),'docs/CONNECTORS.ko.md covers tiers, queue, contract harness, credential scopes');

if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log(JSON.stringify({passed:checks}));

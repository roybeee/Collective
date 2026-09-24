// 캠페인 파생 상태(data-truth-8, lib/campaign-status.ts)의 전이표와 API 응답을 고정한다. 정의·우선순위: docs/CAMPAIGN-STATUS.ko.md.
// 저장된 campaign.status는 바꾸지 않는다: 파생은 순수 계산이고, 응답(워크스페이스·캠페인 상세)에 derivedStatus·statusReason을 더할 뿐이다.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';

const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
class Statement {
 constructor(query,values=[]){this.query=query;this.values=values}
 bind(...values){return new Statement(this.query,values)}
 async first(){return sql.prepare(this.query).get(...this.values)||null}
 async all(){return {results:sql.prepare(this.query).all(...this.values)}}
 async run(){return {meta:{changes:Number(sql.prepare(this.query).run(...this.values).changes)}}}
}
const DB={prepare:q=>new Statement(q),batch:async ss=>{sql.exec('BEGIN');try{const result=[];for(const s of ss)result.push(await s.run());sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}}};
const ctx=createContext({console,crypto:webcrypto,Response,Request,Headers,TextEncoder,TextDecoder,Uint8Array,Date,URL,AbortSignal,btoa,atob,process:{env:{NODE_ENV:'production'}}});
const env=new SyntheticModule(['env'],function(){this.setExport('env',{DB,AUTH_MODE:'legacy'})},{context:ctx});
const modules=new Map();
function moduleFor(file){file=resolve(file);if(modules.has(file))return modules.get(file);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const m=new SourceTextModule(code,{context:ctx,identifier:file});modules.set(file,m);return m}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link((spec,ref)=>{if(spec==='cloudflare:workers')return env;const path=spec.startsWith('@/')?resolve(spec.slice(2)):resolve(dirname(ref.identifier),spec);return moduleFor(path.endsWith('.ts')?path:path+'.ts')});await m.evaluate();return m.namespace}
const {deriveCampaignStatus,withDerivedStatus,derivedStatuses}=await load('lib/campaign-status.ts');
const {statuses}=await load('lib/agency.ts');
const detailRoute=await load('app/api/campaigns/[id]/route.ts');
const workspaceRoute=await load('app/api/workspace/route.ts');
const server=await load('lib/server.ts');

let passed=0;
const check=(name,actual,expected)=>{assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,name);passed++};
const ok=(name,value)=>{assert.ok(value,name);passed++};

// --- 공통 입력 ---------------------------------------------------------------------------
const T=n=>`2026-09-${String(n).padStart(2,'0')}T00:00:00.000Z`;
const base={id:'c1',brandId:'ofd',title:'평일 방문',goal:'평일 방문 늘리기',audience:'',channels:'',stores:'',products:'',budget:100000,budgetConfirmedAt:T(1),startDate:'2026-10-01',endDate:'2026-10-31',constraints:'',sources:'',status:'review',version:2,createdAt:T(1),updatedAt:T(1)};
const usable='검토 가능한 실행 기획 초안입니다. 타깃과 채널, 예산 배분을 담았습니다.';
const reask='현재 메시지에는 수행할 작업이 명시되지 않았습니다. 원하시는 작업을 선택해 주세요. 1. 시장 조사 2. 전략 수립';
const art=(id,role,status,extra={})=>({id,campaignId:'c1',campaignVersion:2,role,title:id,content:usable,status,version:1,origin:'ai',createdAt:T(10),...extra});
const job=(role,status)=>({id:'job-'+role+status,campaignId:'c1',role,status,error:null,createdAt:T(12),model:'m',tokens:0});
const meeting=(status,extra={})=>({campaignId:'c1',campaignVersion:2,status,error:status==='failed'?'브랜드 전략 발언 형식 오류':null,createdAt:T(12),updatedAt:T(12),...extra});
const sequence=(status,extra={})=>({campaignId:'c1',campaignVersion:2,status,error:status==='blocked'?'담당자 작업이 실패하거나 중단되어 연속 실행을 멈췄습니다.':undefined,startedAt:T(11),updatedAt:T(12),...extra});
const publication=(status,extra={})=>({campaignId:'c1',campaignVersion:2,status,attemptedAt:T(14),createdAt:T(13),updatedAt:T(14),...extra});
const metric=(extra={})=>({id:'m1',campaignId:'c1',period:'2026-10-01 ~ 2026-10-07 · 성수점',revenue:100,variableCosts:null,adSpend:0,productionCost:0,orders:2,baselineContribution:null,notes:'',updatedAt:T(16),...extra});
const approvedPlan=[art('cmo','cmo','approved',{reviewedAt:T(11)}),art('quality','quality','approved',{reviewedAt:T(11)})];
const derive=(input={})=>deriveCampaignStatus({campaign:{...base,...input.campaign},artifacts:input.artifacts||[],activeJobs:input.activeJobs||[],sequence:input.sequence,meetings:input.meetings||[],publications:input.publications||[],metrics:input.metrics||[]});
const statusOf=input=>derive(input).status;

// --- 어휘 ------------------------------------------------------------------------------
ok('every derived status has a Korean label in lib/agency.ts statuses',derivedStatuses.every(s=>typeof statuses[s]==='string'&&statuses[s].length>0));
ok('the vocabulary keeps every existing status',['draft','ready','running','review','approved','revision','measuring'].every(s=>derivedStatuses.includes(s)));
check('only blocked and executing are new',derivedStatuses.filter(s=>!['draft','ready','running','review','approved','revision','measuring'].includes(s)).toSorted(),['blocked','executing']);

// --- 전이표: 우선순위 AI 작업 중 > 막힘 > (발행 진행 | 성과 기록, 더 최근 기록) > 기획 승인 > 수정 요청 > 검토 대기 > 실행 준비 > 브리프 작성 ---
const table=[
 ['brief with missing budget and dates, no work → draft',{campaign:{budget:null,budgetConfirmedAt:undefined,startDate:'',endDate:''}},'draft'],
 ['complete brief, no work → ready',{},'ready'],
 ['usable review artifact → review',{artifacts:[art('cmo','cmo','review')]},'review'],
 ['revision requested → revision',{artifacts:[art('cmo','cmo','review'),art('insight','insight','revision')]},'revision'],
 ['re-ask output is not reviewable → revision',{artifacts:[art('cmo','cmo','review',{content:reask})]},'revision'],
 ['output for a previous brief version → revision',{artifacts:[art('cmo','cmo','review',{campaignVersion:1})]},'revision'],
 ['quality review asks for fixes → revision',{artifacts:[art('cmo','cmo','approved'),art('quality','quality','review',{qualityReview:{verdict:'revise',summary:'',findings:''}})]},'revision'],
 ['quality review ready for review → review',{artifacts:[art('cmo','cmo','approved'),art('quality','quality','review',{qualityReview:{verdict:'ready_for_review',summary:'',findings:''}})]},'review'],
 ['all current artifacts approved including quality → approved',{artifacts:approvedPlan},'approved'],
 ['approved without quality review, nothing to review → ready',{artifacts:[art('cmo','cmo','approved')]},'ready'],
 ['outdated artifacts are ignored',{artifacts:[art('old','cmo','outdated',{campaignVersion:1})]},'ready'],
 ['active role job → running',{artifacts:[art('cmo','cmo','review')],activeJobs:[job('strategy','in_progress')]},'running'],
 ['uncertain job still counts as running',{activeJobs:[job('strategy','uncertain')]},'running'],
 ['meeting job → running',{activeJobs:[job('meeting','queued')]},'running'],
 ['live meeting record without a job row → running',{meetings:[meeting('running')]},'running'],
 ['finished jobs are ignored',{activeJobs:[job('strategy','completed'),job('insight','failed'),job('data','cancelled')]},'ready'],
 ['latest meeting failed after the last work → blocked',{artifacts:[art('cmo','cmo','review')],meetings:[meeting('failed')]},'blocked'],
 ['a later completed meeting clears the failure',{artifacts:[art('cmo','cmo','review')],meetings:[meeting('failed'),meeting('completed',{createdAt:T(13),updatedAt:T(13)})]},'review'],
 ['work after the failed meeting clears the failure',{artifacts:[art('cmo','cmo','review',{createdAt:T(13)})],meetings:[meeting('failed')]},'review'],
 ['a review decision after the failed meeting clears the failure',{artifacts:[art('cmo','cmo','approved',{reviewedAt:T(13)})],meetings:[meeting('failed')]},'ready'],
 ['a failed meeting on a previous brief version does not block',{artifacts:[art('cmo','cmo','review')],meetings:[meeting('failed',{campaignVersion:1})]},'review'],
 ['a cancelled meeting does not block',{artifacts:[art('cmo','cmo','review')],meetings:[meeting('cancelled')]},'review'],
 ['blocked sequence after the last work → blocked',{artifacts:[art('cmo','cmo','review')],sequence:sequence('blocked')},'blocked'],
 ['a sequence blocked on a previous brief version does not block',{artifacts:[art('cmo','cmo','review')],sequence:sequence('blocked',{campaignVersion:1})},'review'],
 ['a paused sequence does not block',{artifacts:[art('cmo','cmo','review')],sequence:sequence('paused')},'review'],
 ['work after the sequence stopped clears the block',{artifacts:[art('cmo','cmo','review',{createdAt:T(13)})],sequence:sequence('blocked')},'review'],
 ['accepted publication → executing',{artifacts:approvedPlan,publications:[publication('accepted')]},'executing'],
 ['published publication without results → executing',{artifacts:approvedPlan,publications:[publication('published')]},'executing'],
 ['publications not yet accepted do not execute',{artifacts:approvedPlan,publications:['draft','approved','submitting','uncertain','failed','cancelled','blocked'].map(s=>publication(s))},'approved'],
 ['a publication for a previous brief version does not execute',{artifacts:[art('cmo','cmo','review')],publications:[publication('accepted',{campaignVersion:1})]},'review'],
 ['results recorded after publishing → measuring',{artifacts:approvedPlan,publications:[publication('published')],metrics:[metric()]},'measuring'],
 ['a new publication after the results → executing again',{artifacts:approvedPlan,publications:[publication('accepted',{attemptedAt:T(18)})],metrics:[metric()]},'executing'],
 ['results without publications → measuring',{artifacts:approvedPlan,metrics:[metric()]},'measuring'],
 ['new work after the results starts a new cycle',{artifacts:[...approvedPlan,art('content','content','review',{createdAt:T(17)})],metrics:[metric()]},'review'],
 ['legacy results without a time count only without work',[{metrics:[metric({updatedAt:undefined})]},{artifacts:approvedPlan,metrics:[metric({updatedAt:undefined})]}],['measuring','approved']],
 ['running outranks blocked',{meetings:[meeting('failed')],activeJobs:[job('strategy','queued')]},'running'],
 ['blocked outranks executing',{artifacts:approvedPlan,publications:[publication('accepted',{attemptedAt:T(11)})],meetings:[meeting('failed')]},'blocked'],
 // 보관(archivedAt)은 진행 단계가 아니다. 보관 캠페인도 진행 단계를 그대로 보여 보관 중 도는 AI 작업이 가려지지 않는다.
 ['an archived campaign with an active job is still running',{activeJobs:[job('strategy','in_progress')],campaign:{archivedAt:T(20)}},'running'],
 ['an archived campaign keeps its plan stage',{artifacts:[art('cmo','cmo','review')],campaign:{archivedAt:T(20)}},'review'],
];
for(const [name,input,expected] of table)check(name,Array.isArray(input)?input.map(statusOf):statusOf(input),expected);

// --- 저장값이 오래된 경우(운영 관찰) -------------------------------------------------------------------
check('stored review with an active job → running',derive({artifacts:[art('cmo','cmo','review')],activeJobs:[job('strategy','in_progress')]}).status,'running');
const oda=derive({campaign:{status:'review'},artifacts:[art('cmo','cmo','review'),art('insight','insight','review')],meetings:[meeting('failed')],sequence:sequence('paused')});
check('ODA: failed meeting and paused sequence under stored review → blocked',oda.status,'blocked');
ok('the blocked reason names the meeting failure',oda.reason.includes('팀 회의')&&oda.reason.includes('브랜드 전략 발언 형식 오류'));
ok('a reason that differs from the stored status says so',oda.reason.includes('저장값: 검토 대기'));
const stale=derive({campaign:{status:'draft'},artifacts:approvedPlan});
check('stored draft after a failed rerun keeps the approved plan',stale.status,'approved');
ok('the stored draft is named in the reason',stale.reason.includes('저장값: 브리프 작성'));
ok('a stored status that matches has no stored note',!derive({artifacts:[art('cmo','cmo','review')]}).reason.includes('저장값'));
ok('a running reason names the role',derive({activeJobs:[job('strategy','in_progress')]}).reason.includes('브랜드 전략'));
ok('a sequence block reason keeps the sequence error',derive({artifacts:[art('cmo','cmo','review')],sequence:sequence('blocked')}).reason.includes('연속 실행'));
ok('a draft reason lists the missing brief fields',derive({campaign:{budget:null,budgetConfirmedAt:undefined,startDate:'',endDate:''}}).reason.includes('예산 상한'));
ok('an executing reason counts accepted publications',derive({artifacts:approvedPlan,publications:[publication('accepted'),publication('published')]}).reason.includes('2건'));
ok('every reason is non-empty Korean text',table.flatMap(([,input])=>Array.isArray(input)?input:[input]).every(input=>/[가-힣]/.test(derive(input).reason)));

// --- 순수성: 입력을 바꾸지 않는다 --------------------------------------------------------------------
const frozenInput=Object.freeze({campaign:Object.freeze({...base}),artifacts:Object.freeze(approvedPlan.map(a=>Object.freeze({...a}))),activeJobs:Object.freeze([]),meetings:Object.freeze([Object.freeze(meeting('failed',{createdAt:T(9),updatedAt:T(9)}))]),publications:Object.freeze([Object.freeze(publication('accepted'))]),metrics:Object.freeze([Object.freeze(metric())]),sequence:Object.freeze(sequence('paused'))});
check('frozen inputs derive without mutation',deriveCampaignStatus(frozenInput).status,'measuring');
check('the same input always derives the same result',deriveCampaignStatus(frozenInput),JSON.parse(JSON.stringify(deriveCampaignStatus(frozenInput))));
const listed=withDerivedStatus(Object.freeze([Object.freeze({...base}),Object.freeze({...base,id:'c2',status:'approved'})]),{artifacts:[...approvedPlan,art('other','cmo','review',{campaignId:'c2'})],runs:[job('strategy','in_progress')],sequences:[],meetings:[],publications:[],metrics:[]});
check('withDerivedStatus groups sources by campaign',listed.map(c=>[c.id,c.status,c.derivedStatus]),[['c1','review','running'],['c2','approved','review']]);
ok('withDerivedStatus adds a reason and keeps every stored field',listed.every(c=>typeof c.statusReason==='string'&&c.title===base.title&&c.version===2));

// --- API 응답: 워크스페이스·캠페인 상세 --------------------------------------------------------------
const owner='campaign-status-test-owner',headers={'oai-authenticated-user-id':owner};
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
await server.seedBrands(owner);
const seeds=[
 ['c-run','review',[art('cmo','cmo','review',{campaignId:'c-run',campaignVersion:1})]],
 ['c-meet','review',[art('cmo','cmo','review',{campaignId:'c-meet',campaignVersion:1})]],
 ['c-exec','approved',approvedPlan.map(a=>({...a,id:'exec-'+a.id,campaignId:'c-exec',campaignVersion:1}))],
 ['c-measure','approved',approvedPlan.map(a=>({...a,id:'measure-'+a.id,campaignId:'c-measure',campaignVersion:1}))],
 ['c-archived','review',[]],
];
for(const [id,status,artifacts] of seeds){
 await put('campaign',id,{...base,id,status,version:1,...(id==='c-archived'?{archivedAt:T(20),archivedBy:{id:owner,email:null}}:{})});
 for(const a of artifacts)await put('artifact',a.id,a,id);
}
sql.prepare('INSERT INTO jobs(id,owner,campaign_id,role,status,model,campaign_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('job-run',owner,'c-run','strategy','in_progress','m',1,T(12),T(12));
await put('team_meeting','meeting-1',{id:'meeting-1',campaignId:'c-meet',campaignVersion:1,agenda:'회의',status:'failed',error:'브랜드 전략 발언 형식 오류',steps:[],createdAt:T(12),updatedAt:T(12),model:'m',stopRequested:false,artifactIds:[],invalidatedRoles:[],snapshot:{campaign:base,brand:{},artifacts:[],metrics:[],learning:[]}},'c-meet');
await put('execution_publication','pub-1',{id:'pub-1',campaignId:'c-exec',creativeId:'cr',creativeVersion:1,campaignVersion:1,pngHash:'h',factRefs:[],caption:'캡션',mediaUrl:'',scheduledAt:T(20),plannedCostKRW:0,version:2,status:'accepted',attemptedAt:T(14),createdAt:T(13),updatedAt:T(14)},'c-exec');
await put('metric','metric-1',{...metric(),id:'metric-1',campaignId:'c-measure'},'c-measure');
const snapshot=()=>JSON.stringify([sql.prepare("SELECT id,data,updated_at FROM records WHERE owner=? ORDER BY id").all(owner),sql.prepare('SELECT * FROM jobs WHERE owner=? ORDER BY id').all(owner)]);
const before=snapshot();
const workspace=await (await workspaceRoute.GET(new Request('https://agency.test/api/workspace',{headers}))).json();
const byId=Object.fromEntries(workspace.campaigns.map(c=>[c.id,c]));
check('workspace derives every campaign',['c-run','c-meet','c-exec','c-measure','c-archived','ofd-pilot-01'].map(id=>byId[id]?.derivedStatus),['running','blocked','executing','measuring','ready','draft']);
check('an archived campaign keeps its archive mark apart from the derived status',[byId['c-archived'].archivedAt,'archivedAt' in byId['c-run']],[T(20),false]);
check('workspace keeps the stored status for existing clients',['c-run','c-meet','c-exec','c-measure','c-archived','ofd-pilot-01'].map(id=>byId[id].status),['review','review','approved','approved','review','draft']);
ok('workspace sends a reason with every derived status',workspace.campaigns.every(c=>typeof c.statusReason==='string'&&c.statusReason.length>0));
ok('workspace keeps its other fields',['brands','artifacts','metrics','events','runs','sequences','connection'].every(k=>k in workspace));
async function detail(id){const r=await detailRoute.GET(new Request('https://agency.test/api/campaigns/'+id,{headers}),{params:Promise.resolve({id})});return {status:r.status,data:await r.json()}}
for(const id of ['c-run','c-meet','c-exec','c-measure','c-archived']){
 const loaded=await detail(id);
 check(`detail derives ${id} like the workspace`,[loaded.status,loaded.data.campaign.derivedStatus,loaded.data.campaign.statusReason,loaded.data.campaign.status],[200,byId[id].derivedStatus,byId[id].statusReason,byId[id].status]);
}
const full=await detail('c-meet');
ok('detail keeps artifacts, history, metrics, events and runs',['artifacts','history','metrics','events','runs'].every(k=>Array.isArray(full.data[k])));
check('a missing campaign is still 404',(await detail('missing')).status,404);
check('reading derived status writes nothing',snapshot(),before);
check('stored campaign status is unchanged after reading',(await server.readRecord(owner,'campaign','c-run')).status,'review');

console.log(JSON.stringify({passed},null,2));

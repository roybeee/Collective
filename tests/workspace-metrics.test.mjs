// 대시보드 숫자 정의(lib/workspace-metrics.ts)를 고정한다: 검토 필요·보완 필요·진행 중 캠페인·역할 진행·샘플 캠페인·다음 할 일.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const m=moduleFor('lib/workspace-metrics.ts');await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();
const {workspaceMetrics,isActiveCampaign,activeCampaigns,reviewArtifacts,needsWorkArtifacts,recentCampaigns,campaignStatusCounts,failedRuns,nextTasks,onboardingComplete,usableRoleCount,activeCampaignNote,isSampleCampaign,sampleCampaignIds}=m.namespace;
let passed=0;
function check(name,actual,expected){assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,name);passed++}
const ids=list=>list.map(x=>x.id);

const campaign=(id,status,extra={})=>({id,brandId:'ofd',title:id,goal:'',status,version:1,updatedAt:'2026-09-01T00:00:00.000Z',...extra});
const campaigns=[
 campaign('draft1','draft',{updatedAt:'2026-09-22T00:00:00.000Z',brandId:'oda'}),
 campaign('ready1','ready',{updatedAt:'2026-09-10T00:00:00.000Z'}),
 campaign('running1','running',{updatedAt:'2026-09-12T00:00:00.000Z'}),
 campaign('review1','review',{version:2,updatedAt:'2026-09-20T00:00:00.000Z'}),
 campaign('revision1','revision',{updatedAt:'2026-09-15T00:00:00.000Z'}),
 campaign('approved1','approved',{updatedAt:'2026-09-21T00:00:00.000Z'}),
 campaign('measuring1','measuring',{updatedAt:'2026-09-05T00:00:00.000Z'}),
 campaign('legacy1','paused',{updatedAt:'2026-09-02T00:00:00.000Z'}),
];
const reask='현재 메시지에는 수행할 작업이 명시되지 않았습니다. 원하시는 작업을 선택해 주세요. 1. 시장 조사 2. 전략 수립';
const artifact=(id,campaignId,status,extra={})=>({id,campaignId,role:'cmo',title:id,content:'검토 가능한 실행 기획 초안입니다.',status,version:1,origin:'ai',createdAt:'2026-09-01T00:00:00.000Z',campaignVersion:1,...extra});
const artifacts=[
 artifact('usable-review','review1','review',{campaignVersion:2}),
 artifact('manual-review','ready1','review',{campaignVersion:undefined,origin:'manual'}),
 artifact('reask-review','review1','review',{campaignVersion:2,content:reask,createdAt:'2026-09-19T00:00:00.000Z'}),
 artifact('old-version-review','review1','review',{campaignVersion:1}),
 artifact('empty-review','running1','review',{content:'   '}),
 artifact('revision','revision1','revision',{createdAt:'2026-09-18T00:00:00.000Z'}),
 artifact('approved','approved1','approved'),
 artifact('outdated','review1','outdated',{campaignVersion:1}),
 artifact('orphan-review','deleted','review'),
 artifact('orphan-revision','deleted','revision'),
];

// --- 진행 중 캠페인 ---------------------------------------------------------------------
check('draft is not in progress',isActiveCampaign({status:'draft'}),false);
check('approved (기획 승인) is closed',isActiveCampaign({status:'approved'}),false);
check('measuring (성과 기록) is closed',isActiveCampaign({status:'measuring'}),false);
for(const status of ['ready','running','review','revision'])check(status+' is in progress',isActiveCampaign({status}),true);
check('unknown status is still counted as in progress',isActiveCampaign({status:'paused'}),true);
check('in-progress campaigns keep input order',ids(activeCampaigns(campaigns)),['ready1','running1','review1','revision1','legacy1']);

// --- 검토 필요·보완 필요 -------------------------------------------------------------------
check('review needs usable content on the current brief version',ids(reviewArtifacts(artifacts,campaigns)),['usable-review','manual-review']);
check('needs work = unusable review + revision, only for existing campaigns',ids(needsWorkArtifacts(artifacts,campaigns)),['reask-review','old-version-review','empty-review','revision']);

// --- 요약 숫자 -------------------------------------------------------------------------
check('dashboard metrics share one definition',workspaceMetrics({campaigns,artifacts}),{totalCampaigns:8,sampleCampaigns:0,activeCampaigns:5,review:2,needsWork:4,roles:8});
check('empty workspace is all zero except roles',workspaceMetrics({campaigns:[],artifacts:[]}),{totalCampaigns:0,sampleCampaigns:0,activeCampaigns:0,review:0,needsWork:0,roles:8});
check('the in-progress note names every excluded status',activeCampaignNote,'초안·기획 승인·성과 기록 제외');

// --- 정렬·상태별 개수 -----------------------------------------------------------------------
const frozen=Object.freeze([...campaigns]);
check('recent campaigns are sorted by updatedAt descending',ids(recentCampaigns(frozen)),['draft1','approved1','review1','revision1','running1','ready1','measuring1','legacy1']);
check('recentCampaigns does not reorder its input',ids(frozen)[0],'draft1');
check('missing updatedAt sorts last',ids(recentCampaigns([campaign('a','draft',{updatedAt:undefined}),campaign('b','draft')])),['b','a']);
check('status counts follow lib/agency.ts order with labels; unknown statuses last',campaignStatusCounts([...campaigns,campaign('review2','review')]),[
 {status:'draft',label:'브리프 작성',count:1},{status:'ready',label:'실행 준비',count:1},{status:'running',label:'AI 작업 중',count:1},{status:'review',label:'검토 대기',count:2},
 {status:'approved',label:'기획 승인',count:1},{status:'revision',label:'수정 요청',count:1},{status:'measuring',label:'성과 기록',count:1},{status:'paused',label:'paused',count:1}]);
check('statuses without campaigns are omitted',campaignStatusCounts([campaign('x','draft')]),[{status:'draft',label:'브리프 작성',count:1}]);

// --- 역할 진행(캠페인 목록 진행 막대) ----------------------------------------------------------
// 진행 = 캠페인 현재 버전 기준으로 쓸 수 있는 작업물이 있는 역할 수(8개 역할 중). 같은 역할의 여러 작업물은 한 번만 센다.
const roleArtifact=(id,role,extra={})=>artifact(id,'review1','review',{role,campaignVersion:2,...extra});
const progress=[
 roleArtifact('cmo-a','cmo'),roleArtifact('cmo-b','cmo',{status:'approved'}),roleArtifact('cmo-quality-rerun','cmo'),
 roleArtifact('insight-reask','insight',{content:reask}),
 roleArtifact('strategy-old-brief','strategy',{campaignVersion:1}),
 roleArtifact('creative-outdated','creative',{status:'outdated'}),
 roleArtifact('content-revision','content',{status:'revision'}),
 roleArtifact('growth-empty','growth',{content:'  '}),
 roleArtifact('quality','quality',{status:'approved'}),
 roleArtifact('unknown-role','meeting'),
 artifact('other-campaign','ready1','review',{role:'data'}),
];
check('usable roles count each role once on the current brief version',usableRoleCount({id:'review1',version:2},progress),2);
check('re-asks, previous brief versions, outdated, revision, empty and unknown roles do not count',usableRoleCount({id:'review1',version:2},progress.filter(a=>!['cmo-a','cmo-b','cmo-quality-rerun','quality'].includes(a.id))),0);
check('after a new brief version the old artifacts no longer count',usableRoleCount({id:'review1',version:3},progress),0);

// --- 샘플 캠페인 --------------------------------------------------------------------------
// lib/server.ts seedBrands가 새 워크스페이스에 넣는 예시(ofd-pilot-01)는 손대기 전(v1·브리프 작성)까지 샘플로 따로 센다.
const sample=campaign('ofd-pilot-01','draft',{updatedAt:'2026-09-23T00:00:00.000Z'});
check('the seed campaign id matches lib/server.ts seedBrands',sampleCampaignIds,['ofd-pilot-01']);
check('an untouched seed campaign is a sample',isSampleCampaign(sample),true);
check('an edited or started seed campaign is a real campaign',[isSampleCampaign({...sample,version:2}),isSampleCampaign({...sample,status:'running'})],[false,false]);
check('other draft campaigns are not samples',isSampleCampaign(campaigns[0]),false);
check('samples are counted apart from the total',workspaceMetrics({campaigns:[...campaigns,sample],artifacts}),{totalCampaigns:8,sampleCampaigns:1,activeCampaigns:5,review:2,needsWork:4,roles:8});
check('status counts leave samples out',campaignStatusCounts([sample,campaign('x','draft')]),[{status:'draft',label:'브리프 작성',count:1}]);
check('a workspace with only the sample has no status counts',campaignStatusCounts([sample]),[]);

// --- 실패한 실행 ------------------------------------------------------------------------
const run=(id,campaignId,role,status,createdAt)=>({id,campaignId,role,status,error:null,createdAt,model:'m',tokens:0});
const runs=[
 run('r1','review1','cmo','failed','2026-09-10T00:00:00.000Z'),
 run('r2','review1','cmo','completed','2026-09-11T00:00:00.000Z'),
 run('r3','review1','insight','completed','2026-09-10T00:00:00.000Z'),
 run('r4','review1','insight','failed','2026-09-12T00:00:00.000Z'),
 run('r5','running1','strategy','failed','2026-09-13T00:00:00.000Z'),
 run('r6','deleted','cmo','failed','2026-09-14T00:00:00.000Z'),
 run('r7','ready1','cmo','cancelled','2026-09-14T00:00:00.000Z'),
];
check('only the latest run per campaign and role counts, newest first',ids(failedRuns(runs,campaigns)),['r5','r4']);
check('a retried and completed run is not failed',ids(failedRuns([runs[0],runs[1]],campaigns)),[]);

// --- 다음 할 일·온보딩 -----------------------------------------------------------------------
check('next tasks: failed runs then needs-work artifacts, each pointing at the newest campaign',nextTasks({campaigns,artifacts,runs}),[{kind:'failed-run',count:2,campaignId:'running1'},{kind:'needs-work',count:4,campaignId:'review1'}]);
check('nothing to do yields no tasks',nextTasks({campaigns,artifacts:[artifacts[0]],runs:[runs[1]]}),[]);
const connected={configured:true},brands=[{id:'ofd'},{id:'oda'},{id:'mapdal'}];
check('onboarding complete needs brands, AI connection and a campaign',onboardingComplete({brands,campaigns,connection:connected}),true);
check('onboarding incomplete without connection',onboardingComplete({brands,campaigns,connection:{configured:false}}),false);
check('onboarding incomplete without campaigns',onboardingComplete({brands,campaigns:[],connection:connected}),false);
check('onboarding incomplete without brands',onboardingComplete({brands:[],campaigns,connection:connected}),false);

console.log(JSON.stringify({passed},null,2));

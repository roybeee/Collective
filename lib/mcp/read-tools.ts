// MCP 읽기 도구(G9, read 범위). 모두 키 소유자 범위만 읽고 아무것도 쓰지 않는다(호출 감사는 lib/mcp/server.ts가 남긴다). 모델·외부 호출 없음.
// 결과는 화면에 쓰는 값 중 외부 AI 도구에 필요한 것만 새 객체로 조립한다. 연결 비밀값·연락처·내부 실행 원문은 싣지 않는다.
import {listRecords,readRecord} from '../server';
import {metricSummary,roles,type Artifact,type Brand,type Campaign,type Metric} from '../agency';
import {originLabel} from '../review-decisions';
import {readIncrementality} from '../incrementality-server';
import {verdictLabels} from '../incrementality';
import {agenda} from '../agenda-server';
import type {LearningRule} from '../learning';
import {bool,clip,schema,str,text,type McpTool} from './schema';

const CAMPAIGN_STATUSES=['draft','review','revision','approved'] as const;
const LIST_MAX=200;
// 외부 AI 도구가 작업물을 옮겨 쓸 때 붙이는 안내. AI 생성물 게시 문구(lib/ai-disclosure.ts)와 다른, API 응답용 안내문이다.
export const MCP_AI_NOTE='AI 표시 안내: originLabel이 AI 작성 또는 AI 작성 · 사람 수정이면 AI가 만든 초안입니다. 외부에 게시할 때는 COLLECTIVE의 AI 생성물 표시 규칙을 따르고, 최종 승인은 COLLECTIVE에서 담당자가 합니다.';
const roleName=(id:string)=>roles.find(r=>r.id===id)?.name||'작업물';
type Archivable=Campaign&{archivedAt?:string|null};
const read=(annotationsTitle:string)=>({title:annotationsTitle,readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false} as const);
const artifactLine=(a:Artifact)=>({id:a.id,role:a.role,roleLabel:roleName(a.role),title:a.title,status:a.status,version:a.version,origin:a.origin||'manual',originLabel:originLabel(a.origin)});

async function campaignArtifacts(owner:string,campaignId:string,includeOutdated:boolean){
 const all=await listRecords<Artifact>(owner,'artifact',campaignId);
 const order=(a:Artifact)=>roles.findIndex(r=>r.id===a.role);
 const current=all.filter(a=>includeOutdated||a.status!=='outdated').sort((a,b)=>order(a)-order(b)||b.version-a.version);
 return {artifacts:current.map(artifactLine),outdatedCount:all.filter(a=>a.status==='outdated').length};
}

const listBrands:McpTool={name:'list_brands',title:'브랜드 목록',tier:'read',
 description:'워크스페이스의 브랜드 id·이름·업종·소개를 돌려줍니다. List the workspace brands (id, name, category, short description).',
 inputSchema:schema({}),annotations:read('브랜드 목록'),
 run:async({owner})=>{
  const brands=await listRecords<Brand>(owner,'brand');
  return {brands:brands.slice(0,LIST_MAX).map(b=>({id:b.id,name:b.name,category:b.category||'',description:clip(b.description,300)})),total:brands.length};
 }};

const listCampaigns:McpTool={name:'list_campaigns',title:'캠페인 목록',tier:'read',
 description:'캠페인 id·제목·브랜드·저장 상태를 돌려줍니다. status로 거르고 includeArchived로 보관 캠페인을 포함합니다. List campaigns with optional status filter.',
 inputSchema:schema({status:str('저장 상태 필터 / stored status filter',20,{enum:CAMPAIGN_STATUSES}),brandId:str('브랜드 id 필터 / brand id filter',100),includeArchived:bool('보관한 캠페인 포함 / include archived campaigns')}),
 annotations:read('캠페인 목록'),
 run:async({owner},args)=>{
  const status=text(args,'status'),brandId=text(args,'brandId');
  const campaigns=(await listRecords<Archivable>(owner,'campaign')).filter(c=>(args.includeArchived===true||!c.archivedAt)&&(!status||c.status===status)&&(!brandId||c.brandId===brandId));
  return {campaigns:campaigns.slice(0,LIST_MAX).map(c=>({id:c.id,title:c.title,brandId:c.brandId,status:c.status,version:c.version,archived:!!c.archivedAt,updatedAt:c.updatedAt})),total:campaigns.length};
 }};

const getCampaign:McpTool={name:'get_campaign',title:'캠페인 요약',tier:'read',
 description:'캠페인 브리프 요약(목표·대상·채널·기간·예산)과 상태, 현재 작업물 제목·상태를 돌려줍니다. Get a campaign brief summary, status and its current artifact titles/statuses.',
 inputSchema:schema({id:str('캠페인 id / campaign id',100)},['id']),annotations:read('캠페인 요약'),
 run:async({owner},args)=>{
  const c=await readRecord<Archivable>(owner,'campaign',text(args,'id'));
  const brief={goal:clip(c.goal,1000),audience:clip(c.audience,500),channels:clip(c.channels,300),products:clip(c.products,500),constraints:clip(c.constraints,500),startDate:c.startDate||null,endDate:c.endDate||null,budget:c.budget??null};
  return {id:c.id,title:c.title,brandId:c.brandId,status:c.status,version:c.version,archived:!!c.archivedAt,updatedAt:c.updatedAt,brief,...await campaignArtifacts(owner,c.id,false)};
 }};

const listArtifacts:McpTool={name:'list_artifacts',title:'작업물 목록',tier:'read',
 description:'한 캠페인의 작업물 id·담당·제목·상태·판·작성 출처를 돌려줍니다. List the artifacts of a campaign (role, title, status, version, origin).',
 inputSchema:schema({campaignId:str('캠페인 id / campaign id',100),includeOutdated:bool('이전 브리프 작업물 포함 / include outdated artifacts')},['campaignId']),annotations:read('작업물 목록'),
 run:async({owner},args)=>{
  const c=await readRecord<Campaign>(owner,'campaign',text(args,'campaignId'));
  return {campaignId:c.id,...await campaignArtifacts(owner,c.id,args.includeOutdated===true)};
 }};

const getArtifact:McpTool={name:'get_artifact',title:'작업물 본문',tier:'read',
 description:'작업물 본문과 작성 출처 라벨(직접 등록·AI 작성 등), AI 표시 안내를 돌려줍니다. Get an artifact text with its origin label and an AI disclosure note.',
 inputSchema:schema({id:str('작업물 id / artifact id',100)},['id']),annotations:read('작업물 본문'),
 run:async({owner},args)=>{
  const a=await readRecord<Artifact>(owner,'artifact',text(args,'id'));
  return {...artifactLine(a),campaignId:a.campaignId,aiNote:MCP_AI_NOTE,content:clip(a.content,40000)};
 }};

const getPerformance:McpTool={name:'get_performance',title:'캠페인 성과',tier:'read',
 description:'캠페인에 기록된 성과(기간별 매출·광고비·주문·공헌이익·ROAS)와 홀드아웃 증분 결과(관찰 비교, 인과 증명 아님)를 돌려줍니다. Get recorded campaign measurements and the incrementality result if any.',
 inputSchema:schema({campaignId:str('캠페인 id / campaign id',100)},['campaignId']),annotations:read('캠페인 성과'),
 run:async({owner},args)=>{
  const c=await readRecord<Campaign>(owner,'campaign',text(args,'campaignId'));
  const [metrics,inc]=await Promise.all([listRecords<Metric>(owner,'metric',c.id),readIncrementality(owner,c.id)]);
  const sum=(k:'revenue'|'adSpend'|'orders')=>metrics.some(m=>typeof m[k]==='number')?metrics.reduce((t,m)=>t+(typeof m[k]==='number'?m[k] as number:0),0):null;
  const measurements=metrics.slice(0,LIST_MAX).map(m=>({period:m.period,periodStart:m.periodStart??null,periodEnd:m.periodEnd??null,revenue:m.revenue,adSpend:m.adSpend,orders:m.orders,source:m.source??null,...metricSummary(m)}));
  const incrementality=inc?{label:inc.result.label,verdict:inc.result.verdict,verdictLabel:verdictLabels[inc.result.verdict],periodStart:inc.periodStart,periodEnd:inc.periodEnd,liftTotal:inc.result.liftTotal,liftRate:inc.result.liftRate,ci:inc.result.ci,stores:inc.result.stores,computedAt:inc.computedAt}:null;
  return {campaignId:c.id,measurements,totals:{revenue:sum('revenue'),adSpend:sum('adSpend'),orders:sum('orders'),periods:metrics.length},incrementality,note:'기록된 값만 돌려줍니다. 추정·예측이 아니며 비어 있으면 아직 기록되지 않은 것입니다.'};
 }};

const getAgenda:McpTool={name:'get_agenda',title:'오늘의 안건',tier:'read',
 description:'홈의 오늘의 안건(결정·질문·알림) 건수와 항목 제목을 돌려줍니다. Get today\'s agenda counts and item titles (decisions, questions, notices).',
 inputSchema:schema({}),annotations:read('오늘의 안건'),
 run:async({actor})=>{
  const a=await agenda(actor);
  return {generatedAt:a.generatedAt,total:a.total,counts:a.counts,tabs:a.tabs,items:a.items.map(i=>({kind:i.kind,title:i.title,campaignId:i.campaignId,campaignTitle:i.campaignTitle,due:i.due}))};
 }};

const listLearningRules:McpTool={name:'list_learning_rules',title:'학습 규칙',tier:'read',
 description:'지금 적용 중인(활성·만료 전) 학습 규칙을 돌려줍니다. brandId로 거릅니다. List active, unexpired learning rules, optionally for one brand.',
 inputSchema:schema({brandId:str('브랜드 id 필터 / brand id filter',100)}),annotations:read('학습 규칙'),
 run:async({owner},args)=>{
  const now=Date.now(),brandId=text(args,'brandId');
  const rules=(await listRecords<LearningRule>(owner,'learning_rule')).filter(r=>r.status==='active'&&Date.parse(r.expiresAt)>now&&(!brandId||r.brandId===brandId));
  return {rules:rules.slice(0,LIST_MAX).map(r=>({id:r.id,brandId:r.brandId,channel:r.channel,title:r.title,guidance:clip(r.guidance,1000),scope:clip(r.scope,300),origin:r.origin??'viral',expiresAt:r.expiresAt})),total:rules.length};
 }};

export const READ_TOOLS:readonly McpTool[]=[listBrands,listCampaigns,getCampaign,listArtifacts,getArtifact,getPerformance,getAgenda,listLearningRules];

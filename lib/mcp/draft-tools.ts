// MCP 초안 도구(G9, draft 범위). 캠페인 초안과 작업물 초안(검토 대기 '직접 등록')만 저장한다. 승인·발행·지출·고객 발송·AI 실행은 하지 않는다.
// 저장 형식은 기존 저장 경로(app/api/action save_campaign 새 캠페인 · save_artifact 새 작업물)와 같다. 그 경로는 세션 인증이라 여기서 같은 규칙을 다시 적는다
// (tests/mcp-server.test.mjs가 두 경로의 저장 모양이 같은지 대조한다). 기존 캠페인·작업물 수정은 이 도구로 하지 않는다.
import {acquireLock,assertNoActiveJobs,database,eventStatement,readRecord,recordStatement,releaseLock,stamp,str as field,uid,validateCampaign,listRecords,type CampaignInput} from '../server';
import {roles,type Artifact,type Brand,type Campaign} from '../agency';
import {assertAutonomy} from '../autonomy-server';
import {originLabel} from '../review-decisions';
import {schema,str,text,type McpTool,type ToolContext} from './schema';

const ROLE_IDS=roles.map(r=>r.id);
const write=(title:string)=>({title,readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false} as const);
const by=(ctx:ToolContext)=>({id:ctx.actor.id,email:null});
const via=(ctx:ToolContext)=>({via:'api',apiKeyId:ctx.key.id});
async function locked<T>(owner:string,task:()=>Promise<T>):Promise<T>{
 const lock=await acquireLock(owner);
 try{return await task()}finally{await releaseLock(owner,lock)}
}

const createCampaignDraft:McpTool={name:'create_campaign_draft',title:'캠페인 초안 저장',tier:'draft',
 description:'브랜드·제목·목표로 캠페인 초안(상태 draft)만 저장합니다. AI 실행·승인·광고 집행은 하지 않습니다. Save a campaign draft only; no AI run, approval or ad spend.',
 inputSchema:schema({brandId:str('브랜드 id / brand id',100),title:str('캠페인 이름 / campaign title',200),goal:str('목표 / goal',5000)},['brandId','title','goal']),
 annotations:write('캠페인 초안 저장'),
 run:async(ctx,args)=>{
  // 자율성 규칙(G3): 브리프 초안 작성이 '금지'면 403(한국어 사유)으로 막는다. 스위치가 꺼져 있으면 확인 후(그대로 저장)다.
  await assertAutonomy(ctx.owner,'brief_draft');
  // 목적(objective)은 넘기지 않으므로 결과에 없다(소비자 캠페인). 가맹 모집 목적 지정은 화면에서만 한다.
  const data:Omit<CampaignInput,'objective'>=validateCampaign({brandId:text(args,'brandId'),title:text(args,'title'),goal:text(args,'goal'),budget:null});
  return locked(ctx.owner,async()=>{
   await readRecord<Brand>(ctx.owner,'brand',data.brandId);
   const now=stamp(),campaign:Campaign={...data,id:uid(),status:'draft',version:1,createdAt:now,updatedAt:now};
   await database().batch([recordStatement(ctx.owner,'campaign',campaign.id,campaign),eventStatement(ctx.owner,campaign.id,'새 캠페인 브리프를 만들었습니다.',by(ctx),via(ctx))]);
   return {id:campaign.id,brandId:campaign.brandId,title:campaign.title,status:campaign.status,version:campaign.version,note:'초안만 저장했습니다. AI 팀 실행·승인·발행은 COLLECTIVE에서 사람이 합니다.'};
  });
 }};

const addArtifactDraft:McpTool={name:'add_artifact_draft',title:'작업물 초안 등록',tier:'draft',
 description:'캠페인에 작업물 초안을 검토 대기(직접 등록)로 등록합니다. 승인은 COLLECTIVE에서 담당자가 합니다. Add an artifact draft to a campaign as review-pending; approval happens in COLLECTIVE.',
 inputSchema:schema({campaignId:str('캠페인 id / campaign id',100),role:str('담당 역할 / role',20,{enum:ROLE_IDS}),title:str('제목 / title',200),text:str('본문 / text',40000)},['campaignId','role','title','text']),
 annotations:write('작업물 초안 등록'),
 run:async(ctx,args)=>locked(ctx.owner,async()=>{
  const owner=ctx.owner,c=await readRecord<Campaign>(owner,'campaign',field(text(args,'campaignId'),'캠페인',100,true));
  await assertNoActiveJobs(owner,c.id);
  const role=text(args,'role'),title=field(text(args,'title'),'제목',200,true),content=field(text(args,'text'),'내용',40000,true);
  const a:Artifact&Record<string,unknown>={id:uid(),campaignId:c.id,campaignVersion:c.version,role,title,content,version:1,status:'review',origin:'manual',...via(ctx),createdAt:stamp()};
  const name=roles.find(r=>r.id===role)?.name;
  const writes=[recordStatement(owner,'artifact',a.id,a,c.id),recordStatement(owner,'campaign',c.id,{...c,status:'review',updatedAt:stamp()}),eventStatement(owner,c.id,`${name} 작업물 등록 · v${a.version}`,by(ctx),via(ctx))];
  // 기존 저장 경로와 같게: 같은 역할 이후 단계의 현재 작업물은 이전 판(outdated)으로 표시한다.
  const at=roles.findIndex(r=>r.id===role);
  for(const d of await listRecords<Artifact>(owner,'artifact',c.id))if(d.id!==a.id&&d.status!=='outdated'&&roles.findIndex(r=>r.id===d.role)>=at)writes.push(recordStatement(owner,'artifact',d.id,{...d,status:'outdated'},c.id));
  await database().batch(writes);
  return {id:a.id,campaignId:c.id,role,title,version:a.version,status:a.status,origin:a.origin,originLabel:originLabel(a.origin),note:'검토 대기로 등록했습니다. 승인·발행은 COLLECTIVE에서 담당자가 합니다.'};
 })};

export const DRAFT_TOOLS:readonly McpTool[]=[createCampaignDraft,addArtifactDraft];

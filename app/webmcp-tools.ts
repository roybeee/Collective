import {api,type WorkspaceData} from '@/lib/client';
import {withCampaign,type NavState} from '@/lib/nav-state';

// WebMCP 도구(document.modelContext.registerTool) 정의. 이 기능이 있는 브라우저에서만 불러온다(app/workspace.tsx).
// 홈 첫 로딩 JS에서 빼려고 workspace.tsx에서 옮겼다(UX-PLAN-3 11.26). 도구 이름·설명·입력·동작은 그대로다.
export type ModelContext={registerTool:(tool:unknown,options:unknown)=>Promise<void>|void};
type WorkspaceState={current:{data:WorkspaceData;reload:()=>Promise<unknown>}};
type SetRoute=(update:(n:NavState)=>NavState)=>void;

export function registerWorkspaceTools(context:ModelContext,state:WorkspaceState,setRoute:SetRoute,signal:AbortSignal){
 const tools=[{name:'list_campaigns',title:'캠페인 목록',description:'현재 사용자의 캠페인과 상태를 조회합니다.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async()=>state.current.data.campaigns.map(c=>({id:c.id,title:c.title,brandId:c.brandId,status:c.derivedStatus||c.status}))},{name:'open_campaign',title:'캠페인 열기',description:'기존 캠페인 상세 화면을 읽기 전용으로 엽니다.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:true},execute:async(input:unknown)=>{const id=(input as {id?:unknown})?.id;if(typeof id!=='string'||!state.current.data.campaigns.some(c=>c.id===id))throw new Error('유효한 캠페인 ID가 필요합니다.');setRoute(n=>withCampaign(n,id));return {opened:id}}},{name:'create_campaign_draft',title:'캠페인 초안 저장',description:'브랜드와 목표로 캠페인 초안만 실제 저장합니다. AI 실행·광고 집행은 별도입니다.',inputSchema:{type:'object',properties:{brandId:{type:'string'},title:{type:'string'},goal:{type:'string'}},required:['brandId','title','goal'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async(input:unknown)=>{const x=input as Record<string,unknown>;if(!x||typeof x.title!=='string'||!x.title.trim()||typeof x.goal!=='string'||!x.goal.trim()||!state.current.data.brands.some(b=>b.id===x.brandId))throw new Error('브랜드·제목·목표를 확인하세요.');const r=await api('save_campaign',{data:{...x,budget:null}});await state.current.reload();setRoute(n=>withCampaign(n,r.id));return {id:r.id,status:'draft'}}}];
 for(const tool of tools){try{Promise.resolve(context.registerTool(tool,{signal})).catch(()=>{})}catch{}}
}

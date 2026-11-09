// MCP 도구 목록과 호출(G9). tools/list는 키 범위가 쓸 수 있는 도구만 보이고, tools/call은 범위·인자를 확인한 뒤 실행한다.
// 결과는 MCP CallToolResult({content:[{type:'text',text}],structuredContent,isError?})다. 업무 오류(없음·충돌·금지·범위 밖)는 isError:true와 한국어 문장,
// 인자 오류와 모르는 도구는 호출자(lib/mcp/server.ts)가 JSON-RPC -32602로 답하도록 McpParamsError·UnknownToolError를 던진다.
import {ApiError} from '../server';
import {AuthError} from '../auth-errors';
import {API_KEY_SCOPE_LABELS,scopeAllows,type ApiKeyScope} from '../api-keys';
import {READ_TOOLS} from './read-tools';
import {DRAFT_TOOLS} from './draft-tools';
import {McpParamsError,validateArgs,type McpTool,type ToolContext} from './schema';

export const MCP_TOOLS:readonly McpTool[]=[...READ_TOOLS,...DRAFT_TOOLS];
export class UnknownToolError extends Error{}
export const toolNamed=(name:unknown)=>typeof name==='string'?MCP_TOOLS.find(t=>t.name===name):undefined;
// 공개 정의(MCP Tool): 실행 함수·내부 등급은 싣지 않는다.
const definition=(t:McpTool)=>({name:t.name,title:t.title,description:t.description,inputSchema:t.inputSchema,annotations:t.annotations});
export const listTools=(scope:ApiKeyScope)=>({tools:MCP_TOOLS.filter(t=>scopeAllows(scope,t.tier)).map(definition)});

export type CallResult={content:{type:'text';text:string}[];structuredContent?:Record<string,unknown>;isError?:true};
export type CallOutcome={result:CallResult;audit:{ok:boolean;error?:'tool_error'|'scope_denied'}};
const errorResult=(message:string):CallResult=>({content:[{type:'text',text:message}],isError:true});
export const scopeDeniedMessage=(scope:ApiKeyScope,tool:string)=>`이 API 키는 '${API_KEY_SCOPE_LABELS[scope]}' 범위라 ${tool} 도구를 쓸 수 없습니다. 초안 저장 범위(draft) 키를 새로 만드세요.`;

export async function callTool(ctx:ToolContext,params:unknown):Promise<CallOutcome>{
 if(!params||typeof params!=='object'||Array.isArray(params))throw new McpParamsError('params는 {name, arguments} 객체여야 합니다.');
 const {name,arguments:raw}=params as {name?:unknown;arguments?:unknown};
 const tool=toolNamed(name);
 if(!tool)throw new UnknownToolError(`알 수 없는 도구입니다: ${typeof name==='string'?name.slice(0,64):'(이름 없음)'}`);
 if(!scopeAllows(ctx.key.scope,tool.tier))return {result:errorResult(scopeDeniedMessage(ctx.key.scope,tool.name)),audit:{ok:false,error:'scope_denied'}};
 const args=validateArgs(tool.inputSchema,raw);
 try{
  const data=await tool.run(ctx,args);
  return {result:{content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data},audit:{ok:true}};
 }catch(e){
  if(e instanceof ApiError||e instanceof AuthError)return {result:errorResult(e.message),audit:{ok:false,error:'tool_error'}};
  throw e;
 }
}

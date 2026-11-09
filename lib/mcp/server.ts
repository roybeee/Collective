// MCP 서버 전송(G9, docs/MCP-SERVER.ko.md): Streamable HTTP의 단일 엔드포인트에서 JSON-RPC 2.0 POST를 받아 JSON으로 답한다(SSE·세션 없음, 상태 없는 서버).
// 순서: Bearer API 키 확인(실패 401) → 키 소유자의 스위치 mcp_server(꺼짐 404) → 키당 빈도 제한(429) → POST만(그 밖 405) → Origin·MCP-Protocol-Version 확인
// → 본문(1MB, JSON 아님 -32700, 배열 묶음 -32600) → 메서드. 알림(id 없음)과 클라이언트 응답은 202 빈 본문이다.
// 세션 쿠키와 oai-authenticated-user-id 헤더는 읽지 않는다. 키 원문·요청 본문은 기록하지 않는다(감사 api_call은 도구 이름·성공 여부만).
import {APP_BUILD} from '../app-version';
import {ApiError} from '../server';
import {HttpBodyError,readBoundedText} from '../http-limits';
import {API_KEY_MESSAGES,bearerToken} from '../api-keys';
import {apiCallStatement,apiKeyRate,keyActor,mcpServerOn,resolveApiKey,touchApiKey,type ApiCallAudit,type ResolvedKey} from '../api-keys-server';
import {McpParamsError,type ToolContext} from './schema';
import {UnknownToolError,callTool,listTools} from './tools';

export const MCP_PROTOCOL_VERSION='2025-06-18';
export const SUPPORTED_PROTOCOL_VERSIONS=['2025-06-18','2025-03-26','2024-11-05'] as const;
export const MCP_BODY_MAX=1048576;
export const RPC={parse:-32700,invalidRequest:-32600,methodNotFound:-32601,invalidParams:-32602,internal:-32603,unauthorized:-32001,rateLimited:-32029} as const;
const INSTRUCTIONS='COLLECTIVE 워크스페이스의 브랜드·캠페인·작업물·성과·오늘의 안건·학습 규칙을 읽고, 초안 범위 키는 캠페인 초안과 작업물 초안(검토 대기)만 저장합니다. 승인·발행·지출·고객 발송·AI 실행은 COLLECTIVE 화면에서 사람이 합니다.';

type Id=string|number|null;
const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(body:unknown,status=200,extra:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{...headers,...extra}});
const rpcResult=(id:Id,result:unknown)=>reply({jsonrpc:'2.0',id,result});
const rpcError=(id:Id,code:number,message:string,status=200,extra:Record<string,string>={})=>reply({jsonrpc:'2.0',id,error:{code,message}},status,extra);
const accepted=()=>new Response(null,{status:202,headers:{'Cache-Control':'no-store'}});
// 스위치가 꺼진 소유자의 키는 엔드포인트가 없는 것처럼 404다(본문은 다른 404와 같다).
export const mcpNotFound=()=>reply({error:'찾을 수 없습니다.'},404);
const isId=(v:unknown):v is string|number=>typeof v==='string'||(typeof v==='number'&&Number.isFinite(v));

async function audit(owner:string,entry:ApiCallAudit){
 await apiCallStatement(owner,entry).run().catch(()=>console.error('api_call_audit_failed'));
}
function initializeResult(params:unknown){
 const requested=params&&typeof params==='object'?(params as {protocolVersion?:unknown}).protocolVersion:undefined;
 const protocolVersion=(SUPPORTED_PROTOCOL_VERSIONS as readonly unknown[]).includes(requested)?requested as string:MCP_PROTOCOL_VERSION;
 return {protocolVersion,capabilities:{tools:{listChanged:false}},serverInfo:{name:'collective',title:'COLLECTIVE',version:APP_BUILD},instructions:INSTRUCTIONS};
}
async function toolCall(ctx:ToolContext,id:string|number,params:unknown){
 const tool=params&&typeof params==='object'&&typeof (params as {name?:unknown}).name==='string'?String((params as {name:string}).name):'(unknown)';
 try{
  const {result,audit:a}=await callTool(ctx,params);
  await audit(ctx.owner,{keyId:ctx.key.id,tool,...a});
  return rpcResult(id,result);
 }catch(e){
  if(e instanceof McpParamsError||e instanceof UnknownToolError){
   await audit(ctx.owner,{keyId:ctx.key.id,tool,ok:false,error:e instanceof UnknownToolError?'unknown_tool':'invalid_params'});
   return rpcError(id,RPC.invalidParams,e.message);
  }
  console.error('mcp_tool_failed',tool,e instanceof Error?e.name:'unknown');
  await audit(ctx.owner,{keyId:ctx.key.id,tool,ok:false,error:'internal'});
  return rpcError(id,RPC.internal,'도구를 실행하지 못했습니다. 잠시 후 다시 시도하세요.');
 }
}
export async function dispatch(ctx:ToolContext,message:unknown):Promise<Response>{
 if(!message||typeof message!=='object'||Array.isArray(message))return rpcError(null,RPC.invalidRequest,'JSON-RPC 요청 객체가 아닙니다.',400);
 const m=message as {jsonrpc?:unknown;id?:unknown;method?:unknown;params?:unknown};
 const id=isId(m.id)?m.id:null;
 if(m.jsonrpc!=='2.0')return rpcError(id,RPC.invalidRequest,'jsonrpc는 "2.0"이어야 합니다.',400);
 if(m.method===undefined&&('result' in m||'error' in m))return accepted();
 if(typeof m.method!=='string')return rpcError(id,RPC.invalidRequest,'method가 없습니다.',400);
 if(!('id' in m))return accepted();
 if(!isId(m.id))return rpcError(null,RPC.invalidRequest,'id는 문자열 또는 숫자여야 합니다.',400);
 switch(m.method){
  case 'initialize':return rpcResult(m.id,initializeResult(m.params));
  case 'ping':return rpcResult(m.id,{});
  case 'tools/list':return rpcResult(m.id,listTools(ctx.key.scope));
  case 'tools/call':return toolCall(ctx,m.id,m.params);
  default:return rpcError(m.id,RPC.methodNotFound,`지원하지 않는 메서드입니다: ${m.method.slice(0,64)}`);
 }
}
async function readMessage(req:Request):Promise<{ok:true;value:unknown}|{ok:false;response:Response}>{
 let text:string;
 try{text=await readBoundedText(req,MCP_BODY_MAX)}catch(e){
  if(e instanceof HttpBodyError)return {ok:false,response:rpcError(null,RPC.invalidRequest,e.message,e.status)};
  throw e;
 }
 try{return {ok:true,value:JSON.parse(text)}}catch{return {ok:false,response:rpcError(null,RPC.parse,'JSON을 읽지 못했습니다.',400)}}
}
// 같은 출처가 아닌 브라우저 Origin은 거부한다(DNS 리바인딩 방지). 서버 간 호출(Origin 없음)은 받는다.
const foreignOrigin=(req:Request)=>{const o=req.headers.get('origin');return !!o&&o!=='null'&&o!==new URL(req.url).origin};
// MCP-Protocol-Version은 너그럽게 본다: 없으면 받고, 있으면 알려진 판이어야 한다.
const badProtocol=(req:Request)=>{const v=req.headers.get('mcp-protocol-version');return v!==null&&!(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(v.trim())};

async function authorized(req:Request):Promise<{ok:true;key:ResolvedKey}|{ok:false;response:Response}>{
 const key=await resolveApiKey(bearerToken(req.headers.get('authorization')));
 if(!key)return {ok:false,response:rpcError(null,RPC.unauthorized,API_KEY_MESSAGES.unauthorized,401,{'WWW-Authenticate':'Bearer realm="collective", error="invalid_token"'})};
 if(!await mcpServerOn(key.owner))return {ok:false,response:mcpNotFound()};
 try{await apiKeyRate(key.key.id)}catch(e){
  if(e instanceof ApiError&&e.status===429)return {ok:false,response:rpcError(null,RPC.rateLimited,e.message,429,{'Retry-After':'60'})};
  throw e;
 }
 return {ok:true,key};
}
export async function handleMcp(req:Request):Promise<Response>{
 try{
  const auth=await authorized(req);
  if(!auth.ok)return auth.response;
  if(req.method!=='POST')return rpcError(null,RPC.invalidRequest,'이 MCP 서버는 POST(JSON 응답)만 받습니다. SSE 스트림(GET)은 제공하지 않습니다.',405,{Allow:'POST'});
  if(foreignOrigin(req))return rpcError(null,RPC.invalidRequest,'허용되지 않은 요청 출처입니다.',403);
  if(badProtocol(req))return rpcError(null,RPC.invalidRequest,`지원하지 않는 MCP-Protocol-Version입니다. 지원: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`,400);
  const message=await readMessage(req);
  if(!message.ok)return message.response;
  if(Array.isArray(message.value))return rpcError(null,RPC.invalidRequest,'JSON-RPC 묶음(batch) 요청은 지원하지 않습니다. 요청을 하나씩 보내세요.',400);
  await touchApiKey(auth.key);
  return await dispatch({owner:auth.key.owner,actor:keyActor(auth.key),key:auth.key.key},message.value);
 }catch(e){
  console.error('mcp_request_failed',e instanceof Error?e.name:'unknown');
  return rpcError(null,RPC.internal,'요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.',500);
 }
}

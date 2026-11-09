import {handleMcp} from '@/lib/mcp/server';

// MCP 서버(G9, docs/MCP-SERVER.ko.md). Streamable HTTP 단일 엔드포인트: POST JSON-RPC 2.0 → JSON 응답. 인증은 Authorization: Bearer <API 키>만 쓴다.
// 키 소유자의 스위치 mcp_server가 꺼져 있으면 모든 요청이 404다. GET(SSE)·DELETE(세션 종료)는 제공하지 않아 405다.
export const POST=(req:Request)=>handleMcp(req);
export const GET=(req:Request)=>handleMcp(req);
export const DELETE=(req:Request)=>handleMcp(req);
export const PUT=(req:Request)=>handleMcp(req);
export const PATCH=(req:Request)=>handleMcp(req);

import {ApiError,str} from './server';
import {readBoundedJson} from './http-limits';

async function graphql(token:string,query:string,variables:Record<string,unknown>){
 const response=await fetch('https://api.buffer.com',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!response.ok)throw new ApiError(502,'Buffer 연결을 확인하지 못했습니다. 공급자 화면에서 상태를 확인하세요.');
 const result=await readBoundedJson<{data?:Record<string,unknown>;errors?:unknown[]}>(response,100000);
 if(result.errors?.length||!result.data)throw new ApiError(502,'Buffer 응답을 확인하지 못했습니다. 공급자 화면에서 상태를 확인하세요.');
 return result.data;
}
const channelsQuery='query Channels($organizationId: OrganizationId!){channels(input:{organizationId:$organizationId}){id name service isQueuePaused}}';
export async function verifyBuffer(token:string,organizationId:string,channelId:string){
 const data=await graphql(token,channelsQuery,{organizationId});
 const channel=Array.isArray(data.channels)?data.channels.find((c:Record<string,unknown>)=>c.id===channelId&&c.service==='instagram'):null;
 if(!channel)throw new ApiError(400,'이 Buffer 조직의 Instagram 채널을 선택하세요.');
 if(channel.isQueuePaused)throw new ApiError(409,'Buffer에서 일시 중지된 채널입니다.');
 return str(channel.name,'계정 이름',200,true);
}
// API 키로 볼 수 있는 조직과 그 조직의 Instagram 채널 목록(선택지). 조직을 고르지 않으면 첫 조직을 쓴다. 아무것도 저장하지 않는다.
export async function listBufferChannels(token:string,organizationId?:string){
 const listed=(await graphql(token,'query Organizations{account{organizations{id name}}}',{})).account as {organizations?:unknown}|undefined,rows=Array.isArray(listed?.organizations)?listed.organizations as Record<string,unknown>[]:[];
 const organizations=rows.filter(o=>typeof o?.id==='string').slice(0,50).map(o=>({id:o.id as string,name:typeof o.name==='string'&&o.name?o.name:o.id as string}));
 const chosen=organizationId??organizations[0]?.id;
 if(!chosen||!organizations.some(o=>o.id===chosen))throw new ApiError(400,'이 API 키로 접근할 수 있는 Buffer 조직을 선택하세요.');
 const data=await graphql(token,channelsQuery,{organizationId:chosen});
 const channels=(Array.isArray(data.channels)?data.channels as Record<string,unknown>[]:[]).filter(c=>c?.service==='instagram'&&typeof c.id==='string').slice(0,100).map(c=>({id:c.id as string,name:typeof c.name==='string'&&c.name?c.name:c.id as string,paused:c.isQueuePaused===true}));
 return {organizations,organizationId:chosen,channels};
}
export async function submitBuffer(token:string,input:{channelId:string;text:string;url:string;dueAt:string}){
 const data=await graphql(token,'mutation Publish($input:CreatePostInput!){createPost(input:$input){__typename ... on PostActionSuccess{post{id status}} ... on MutationError{message}}}',{input:{channelId:input.channelId,text:input.text,schedulingType:'automatic',mode:'customScheduled',dueAt:input.dueAt,assets:[{image:{url:input.url}}]}});
 const result=data.createPost as {__typename?:string;post?:{id?:unknown;status?:unknown}}|undefined;
 if(result?.__typename==='PostActionSuccess'&&typeof result.post?.id==='string')return {id:result.post.id,status:String(result.post.status||'unknown')};
 // Even a mutation error can follow partial provider work; keep it uncertain for reconciliation.
 throw new ApiError(502,'Buffer 접수 여부를 확인하지 못했습니다. 자동 재전송하지 않습니다.');
}
export async function inspectBuffer(token:string,id:string){
 const data=await graphql(token,'query Publication($id:PostId!){post(input:{id:$id}){id status channelId}}',{id});
 const post=data.post as {id?:unknown;status?:unknown;channelId?:unknown}|undefined;
 if(post?.id!==id||typeof post?.status!=='string'||typeof post?.channelId!=='string')throw new ApiError(502,'Buffer 게시 상태를 확인하지 못했습니다.');
 return post as {id:string;status:string;channelId:string};
}

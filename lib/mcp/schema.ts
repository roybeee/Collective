// MCP 도구 입력 스키마(JSON Schema 부분집합)와 그 스키마 그대로의 검증(G9). 스키마와 검사가 어긋나지 않게 한 정의에서 둘 다 쓴다.
// 지원: object(properties·required·additionalProperties:false), string(enum·minLength·maxLength), boolean. 모르는 필드는 거부한다.
import type {Actor} from '../server';
import type {ApiKey} from '../api-keys';

export type JsonProp={type:'string';description:string;enum?:readonly string[];minLength?:number;maxLength?:number}|{type:'boolean';description:string};
export type InputSchema={type:'object';properties:Record<string,JsonProp>;required:readonly string[];additionalProperties:false};
export type ToolArgs=Record<string,string|boolean>;
export type ToolContext={owner:string;actor:Actor;key:ApiKey};
export type ToolTier='read'|'draft';
export type McpTool={name:string;title:string;description:string;tier:ToolTier;inputSchema:InputSchema;
 annotations:{title:string;readOnlyHint:boolean;destructiveHint:boolean;idempotentHint:boolean;openWorldHint:false};
 run:(ctx:ToolContext,args:ToolArgs)=>Promise<Record<string,unknown>>};
// 인자 검증 실패. JSON-RPC -32602(Invalid params)로 답한다.
export class McpParamsError extends Error{}

export const str=(description:string,maxLength=200,extra:{enum?:readonly string[];minLength?:number}={}):JsonProp=>({type:'string',description,maxLength,minLength:extra.minLength??1,...(extra.enum?{enum:extra.enum}:{})});
export const bool=(description:string):JsonProp=>({type:'boolean',description});
export const schema=(properties:Record<string,JsonProp>,required:readonly string[]=[]):InputSchema=>({type:'object',properties,required,additionalProperties:false});

export function validateArgs(s:InputSchema,raw:unknown):ToolArgs{
 const value=raw===undefined||raw===null?{}:raw;
 if(typeof value!=='object'||Array.isArray(value))throw new McpParamsError('도구 인자(arguments)는 객체여야 합니다.');
 const input=value as Record<string,unknown>,out:ToolArgs={};
 const extra=Object.keys(input).find(k=>!Object.hasOwn(s.properties,k));
 if(extra)throw new McpParamsError(`알 수 없는 인자입니다: ${extra.slice(0,40)}`);
 for(const name of s.required)if(input[name]===undefined)throw new McpParamsError(`필수 인자가 없습니다: ${name}`);
 for(const [name,prop] of Object.entries(s.properties)){
  const v=input[name];if(v===undefined)continue;
  if(prop.type==='boolean'){if(typeof v!=='boolean')throw new McpParamsError(`${name}은(는) true 또는 false입니다.`);out[name]=v;continue}
  if(typeof v!=='string')throw new McpParamsError(`${name}은(는) 문자열입니다.`);
  const text=v.trim();
  if(text.length<(prop.minLength??0)||(prop.maxLength!==undefined&&v.length>prop.maxLength))throw new McpParamsError(`${name} 길이를 확인하세요(${prop.minLength??0}~${prop.maxLength??'제한 없음'}자).`);
  if(prop.enum&&!prop.enum.includes(text))throw new McpParamsError(`${name}은(는) ${prop.enum.join(', ')} 중 하나입니다.`);
  out[name]=text;
 }
 return out;
}
export const text=(args:ToolArgs,name:string)=>typeof args[name]==='string'?args[name] as string:'';
export const clip=(value:unknown,max:number)=>{const s=typeof value==='string'?value:'';return s.length>max?s.slice(0,max)+'…':s};

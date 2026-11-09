import {ApiError,failure} from '@/lib/server';
import {readBoundedJson,HttpBodyError} from '@/lib/http-limits';
import {externalDecision,openShareLink,requireSameOrigin} from '@/lib/share-links-server';

// 공개 공유 API(G4, 로그인 없음). GET /api/share/<token>: 공개 보기(JSON). POST {decision,note?}: 작업물 검토자 결정(같은 출처만).
// 모르는·만료·취소 토큰, 스위치 꺼짐, 바뀐 판은 모두 같은 404다. 응답은 저장 금지·색인 금지이고 세션 쿠키를 읽거나 쓰지 않는다.
const guard={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:guard});
type Context={params:Promise<{token:string}>};
const withGuard=(response:Response)=>{const headers=new Headers(response.headers);for(const [k,v] of Object.entries(guard))headers.set(k,v);return new Response(response.body,{status:response.status,headers})};

export async function GET(req:Request,context:Context){
 try{return reply(await openShareLink((await context.params)?.token,req))}
 catch(error){return withGuard(failure(error))}
}
export async function POST(req:Request,context:Context){
 try{
  requireSameOrigin(req);
  let input:unknown;
  try{input=await readBoundedJson(req,16384)}catch(e){if(e instanceof HttpBodyError)throw new ApiError(e.status,e.message);throw e}
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'입력 형식을 확인해 주세요.');
  return reply(await externalDecision((await context.params)?.token,input,req));
 }catch(error){return withGuard(failure(error))}
}

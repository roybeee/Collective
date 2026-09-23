import {runtime} from '@/lib/server';
import {isPublicMediaServed,publicMediaKey} from '@/lib/execution-media';

// 승인된 발행이 참조하는 소재 PNG만 인증 없이 제공한다(Buffer 등 외부 게시 도구가 가져간다).
// 형식 불일치·객체 없음·레코드 없음·참조 0은 모두 같은 404로 답해 존재 여부를 드러내지 않는다.
// 공개를 멈출 수 있는 자원이라 짧게(5분) 캐시하고, 내용이 해시로 고정돼 있어 ETag로 재검증한다(SEC-3).
const FILE=/^([0-9a-f]{64})\.png$/;
const guard={'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"};
const notFound=()=>new Response('Not Found',{status:404,headers:{...guard,'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
type Context={params:Promise<{file:string}>};

async function serve(req:Request,context:Context,head:boolean){try{
 const file=(await context.params)?.file,match=typeof file==='string'?FILE.exec(file):null,bucket=runtime.BUCKET;
 if(!match||!bucket)return notFound();
 // R2를 먼저 본다. 추측한 해시는 D1 조회 없이 404로 끝난다.
 const hash=match[1],key=publicMediaKey(hash),etag=`"${hash}"`,headers={...guard,'Content-Type':'image/png','Cache-Control':'public, max-age=300, must-revalidate',ETag:etag};
 const notModified=(req.headers.get('if-none-match')||'').split(',').map(t=>t.trim().replace(/^W\//,'')).some(t=>t===etag||t==='*');
 if(head||notModified){const meta=await bucket.head(key);if(!meta||!await isPublicMediaServed(hash))return notFound();return new Response(null,notModified?{status:304,headers}:{headers:{...headers,'Content-Length':String(meta.size)}})}
 const object=await bucket.get(key);if(!object)return notFound();
 if(!await isPublicMediaServed(hash)){await object.body.cancel().catch(()=>{});return notFound()}
 return new Response(object.body,{headers});
}catch(e){console.error('public_media_failed',e instanceof Error?e.message:'unknown');return new Response(null,{status:503,headers:{...guard,'Cache-Control':'no-store'}})}}

export async function GET(req:Request,context:Context){return serve(req,context,false)}
export async function HEAD(req:Request,context:Context){return serve(req,context,true)}

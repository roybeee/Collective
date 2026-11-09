import {ApiError} from '@/lib/server';
import {readBoundedText,HttpBodyError} from '@/lib/http-limits';
import {externalDecision,openShareLink,requireSameOrigin} from '@/lib/share-links-server';
import {renderNotFound,renderShare,type FormResult} from '@/lib/share-links-html';
import {DECISION_LABELS,SHARE_MESSAGES} from '@/lib/share-links';

// 공개 공유 화면(G4, 로그인 없음, docs/SHARE-LINKS.ko.md). GET /share/<token>: 보고서 또는 작업물 검토 화면(HTML). POST(폼): 검토자 결정 뒤 같은 화면을 결과와 함께 다시 그린다.
// 인라인 스크립트 없음(CSP default-src 'none'; style-src 'self'), 색인 금지, 저장 금지, 참조 주소 없음. 세션 쿠키는 읽지 않는다. 모든 실패는 같은 404 화면이다.
const guard={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
 'Content-Security-Policy':"default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
const html=(body:string,status=200)=>new Response(body,{status,headers:guard});
const notFound=()=>html(renderNotFound(),404);
type Context={params:Promise<{token:string}>};
// application/x-www-form-urlencoded 본문을 첫 값 기준으로 읽는다(같은 이름이 여러 번이면 첫 값). 깨진 퍼센트 인코딩은 그 값만 빈 문자열로 둔다.
function parseForm(text:string){
 const out=new Map<string,string>(),decode=(v:string)=>{try{return decodeURIComponent(v.replace(/\+/g,' '))}catch{return ''}};
 for(const pair of text.split('&')){if(!pair)continue;const at=pair.indexOf('='),key=decode(at<0?pair:pair.slice(0,at));if(!out.has(key))out.set(key,at<0?'':decode(pair.slice(at+1)))}
 return out;
}
const tokenOf=async(context:Context)=>(await context.params)?.token;
function fail(error:unknown){
 if(error instanceof ApiError&&error.status===429)return html(renderNotFound().replace('링크가 없거나 만료·취소됐습니다.',SHARE_MESSAGES.rate),429);
 if(!(error instanceof ApiError))console.error('share_page_failed',error instanceof Error?error.message:'unknown');
 return notFound();
}

export async function GET(req:Request,context:Context){
 try{const token=await tokenOf(context);return html(renderShare(await openShareLink(token,req),token))}
 catch(error){return fail(error)}
}
// 폼 본문(application/x-www-form-urlencoded)만 받는다. 숨은 token 칸은 경로의 토큰과 같아야 한다(다른 화면의 폼을 이 주소로 보내는 실수를 막는다).
export async function POST(req:Request,context:Context){
 const token=await tokenOf(context);
 try{
  requireSameOrigin(req);
  let form:Map<string,string>;
  try{form=parseForm(await readBoundedText(req,16384))}catch(e){if(e instanceof HttpBodyError)throw new ApiError(e.status,e.message);throw e}
  if(form.get('token')!==token)throw new ApiError(400,SHARE_MESSAGES.origin);
  const note=form.get('note');
  let result:FormResult;
  try{
   const r=await externalDecision(token,{decision:form.get('decision'),...(note===undefined?{}:{note})},req);
   result={message:r.repeated?`${DECISION_LABELS[r.decision]}은 이미 전달됐습니다.`:`${DECISION_LABELS[r.decision]}을 담당자에게 전달했습니다.`,error:false};
  }catch(e){if(e instanceof ApiError&&e.status===400)result={message:e.message,error:true};else throw e}
  return html(renderShare(await openShareLink(token,req),token,result),result.error?400:200);
 }catch(error){return fail(error)}
}

import {actor,ApiError,acquireLock,body,failure,json,releaseLock,secureMutation} from '@/lib/server';
import {executionRate} from '@/lib/execution-rate';
import {CUSTOMER_REPORT_MESSAGES,customerReportAction,downloadReport,factPackFile,listReports,previewReport,type Attachment} from '@/lib/customer-report-server';

// 주간 고객 보고서(A8-2, docs/CUSTOMER-REPORT.ko.md). 모두 대표·관리자만(직원 403, 비로그인 401), 검토는 대표만. 모델·외부 호출 없음.
// GET ?storeId=&week=YYYY-Www 또는 ?brandId=&week=: 미리보기(저장 안 함)와 그 주 동결본. 스위치 a8_customer_report 꺼짐 409.
// GET ?brandId=&from=&to=(ISO 주, 최대 26주, &storeId= 선택): 동결본 목록(stale 포함). 스위치가 꺼져도 읽는다.
// GET ?id=&format=json|md|csv(&version=): 동결본 첨부. 스위치가 꺼져도 받는다. GET ?type=fact_pack&brandId=(&storeId=)&format=: 사실 팩 첨부(꺼짐 409).
// POST {action:'freeze',storeId|brandId,week,confirmed:true,expected} · {action:'review',id,version}: 같은 출처 요청, 소유자 변경 잠금, 빈도 제한.
const attachment=(a:Attachment)=>new Response(a.body,{headers:{'Content-Type':a.type,'Content-Disposition':`attachment; filename="${a.fileName}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function GET(req:Request){
 try{
  const who=await actor(req),params=new URL(req.url).searchParams;
  if(who.role==='member')throw new ApiError(403,CUSTOMER_REPORT_MESSAGES.adminOnly);
  if(params.has('id'))return attachment(await downloadReport(who.owner,params));
  if(params.has('type')){if(params.get('type')!=='fact_pack')throw new ApiError(400,'지원하지 않는 조회입니다.');return attachment(await factPackFile(who.owner,params))}
  return json(params.has('from')||params.has('to')?await listReports(who.owner,params):await previewReport(who.owner,params));
 }catch(error){return failure(error)}
}

export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await actor(req);owner=who.owner;secureMutation(req);
  const input=await body(req);
  lock=await acquireLock(owner);
  await executionRate(owner,'customer_reports');
  return json(await customerReportAction(owner,input,{id:who.id,role:who.role}));
 }catch(error){return failure(error)}finally{if(lock)await releaseLock(owner,lock)}
}

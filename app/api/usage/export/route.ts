import {requireOwnerActor,ApiError,failure} from '@/lib/server';
import {usageCsv,usageFilter,campaignSubmissions} from '@/lib/usage-export';

// 소유자 전용 읽기 내보내기(F2a). 비로그인 401, 관리자·직원 403, 다른 소유자의 캠페인은 404(소유자 범위 records).
// type=usage_csv(기본): provider_usage CSV(조인 키 포함, campaignId·kind·role 필터는 사용량 화면과 같다).
// type=submissions&campaignId=: 캠페인 HERMES 제출 원문 JSON(리플레이용, 멱등 키 제외).
const safeName=(value:string)=>value.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80);
function download(body:string,type:string,name:string,extension:'csv'|'json'){
 return new Response(body,{headers:{'Content-Type':type,'Content-Disposition':`attachment; filename="${safeName(name)}.${extension}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
export async function GET(req:Request){
 try{
  const who=await requireOwnerActor(req),params=new URL(req.url).searchParams,type=params.get('type')||'usage_csv';
  if(type==='usage_csv'){const csv=await usageCsv(who.owner,usageFilter(params));return download(csv.body,'text/csv; charset=utf-8',csv.name,'csv')}
  if(type==='submissions'){const data=await campaignSubmissions(who.owner,params.get('campaignId'));return download(JSON.stringify(data),'application/json; charset=utf-8','collective-submissions-'+data.campaignId,'json')}
  throw new ApiError(400,'지원하지 않는 내보내기입니다.');
 }catch(error){return failure(error)}
}

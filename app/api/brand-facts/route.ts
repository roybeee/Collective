import {identity,actor,secureMutation,body,str,json,failure,ApiError,acquireLock,releaseLock,database} from '@/lib/server';
import {getBrandFacts,saveBrandFact,rebaseFranchiseFacts,franchiseFactsOverview} from '@/lib/brand-facts-server';
import {factOverview,importFactCandidates} from '@/lib/fact-import';
import {flagPublicationsForFactChange} from '@/lib/execution-server';
import {executionRate} from '@/lib/execution-rate';
import {afterFactSaved} from '@/lib/data-requests-server';

export async function GET(req:Request){
 try{
  const owner=await identity(req),params=new URL(req.url).searchParams;
  const brandId=str(params.get('brandId')??'','브랜드',100)||undefined;
  const storeId=str(params.get('storeId')??'','지점',100)||undefined;
  const facts=await getBrandFacts(owner,brandId,storeId);
  if(!brandId)return json({facts});
  // 가맹 프로필이나 정보공개서 버전이 있는 브랜드만 franchise 블록을 싣는다(비가맹 브랜드 응답 불변).
  const franchise=await franchiseFactsOverview(owner,brandId,facts);
  return json({facts,...await factOverview(database(),owner,brandId,storeId),...(franchise?{franchise}:{})});
 }catch(error){return failure(error)}
}

// 후보 가져오기는 직원도 할 수 있다(모두 확인 후보로 저장). 확정·거절은 saveBrandFact가 관리자에게만 허용한다.
export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await actor(req);owner=who.owner;secureMutation(req);
  const input=await body(req);
  if(input.action!=='save_fact'&&input.action!=='import_candidates'&&input.action!=='rebase_facts')throw new ApiError(400,'지원하지 않는 작업입니다.');
  lock=await acquireLock(owner);
  await executionRate(owner,'facts');
  if(input.action==='import_candidates')return json(await importFactCandidates(database(),owner,str(input.brandId,'브랜드',100,true),str(input.storeId??'','지점',100)||undefined,who));
  // 가맹 사실을 새 정보공개서 버전으로 옮긴다(대표·관리자). 옮긴 사실을 쓴 발행에 재검토를 붙인다.
  if(input.action==='rebase_facts'){
   const {ids,...moved}=await rebaseFranchiseFacts(owner,input,who);
   const reviewPublications=ids.length?await flagPublicationsForFactChange(database(),owner,ids).catch(()=>{console.error('fact_publication_flag_failed');return null}):0;
   return json({...moved,reviewPublications});
  }
  const {affectsPublications,...saved}=await saveBrandFact(owner,input,who);
  // 사실이 저장된 뒤 확인하므로 실패해도 저장은 유지하고, 확인하지 못했음(null)을 알린다.
  const reviewPublications=affectsPublications?await flagPublicationsForFactChange(database(),owner,[saved.id]).catch(()=>{console.error('fact_publication_flag_failed');return null}):0;
  // 자료 요청(A6-1): 스위치가 켜졌을 때만 closedRequests를 싣는다(꺼짐이면 응답 바이트 동일, 닫기 실패면 null이고 사실 저장은 유지).
  return json({...saved,reviewPublications,...await afterFactSaved(owner,saved.fact,who)});
 }catch(error){return failure(error)}finally{if(lock)await releaseLock(owner,lock)}
}

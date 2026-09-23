import {identity,actor,secureMutation,body,str,json,failure,ApiError,acquireLock,releaseLock,database} from '@/lib/server';
import {getBrandFacts,saveBrandFact} from '@/lib/brand-facts-server';
import {factOverview,importFactCandidates} from '@/lib/fact-import';
import {flagPublicationsForFactChange} from '@/lib/execution-server';
import {executionRate} from '@/lib/execution-rate';

export async function GET(req:Request){
 try{
  const owner=await identity(req),params=new URL(req.url).searchParams;
  const brandId=str(params.get('brandId')??'','브랜드',100)||undefined;
  const storeId=str(params.get('storeId')??'','지점',100)||undefined;
  const facts=await getBrandFacts(owner,brandId,storeId);
  return json(brandId?{facts,...await factOverview(database(),owner,brandId,storeId)}:{facts});
 }catch(error){return failure(error)}
}

// 후보 가져오기는 직원도 할 수 있다(모두 확인 후보로 저장). 확정·거절은 saveBrandFact가 관리자에게만 허용한다.
export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await actor(req);owner=who.owner;secureMutation(req);
  const input=await body(req);
  if(input.action!=='save_fact'&&input.action!=='import_candidates')throw new ApiError(400,'지원하지 않는 작업입니다.');
  lock=await acquireLock(owner);
  await executionRate(owner,'facts');
  if(input.action==='import_candidates')return json(await importFactCandidates(database(),owner,str(input.brandId,'브랜드',100,true),str(input.storeId??'','지점',100)||undefined,who));
  const {affectsPublications,...saved}=await saveBrandFact(owner,input,who);
  // 사실이 저장된 뒤 확인하므로 실패해도 저장은 유지하고, 확인하지 못했음(null)을 알린다.
  const reviewPublications=affectsPublications?await flagPublicationsForFactChange(database(),owner,[saved.id]).catch(()=>{console.error('fact_publication_flag_failed');return null}):0;
  return json({...saved,reviewPublications});
 }catch(error){return failure(error)}finally{if(lock)await releaseLock(owner,lock)}
}

import {identity,actor,secureMutation,body,str,json,failure,ApiError,acquireLock,releaseLock} from '@/lib/server';
import {getBrandFacts,saveBrandFact} from '@/lib/brand-facts-server';
import {executionRate} from '@/lib/execution-rate';

export async function GET(req:Request){
 try{
  const owner=await identity(req),params=new URL(req.url).searchParams;
  const brandId=str(params.get('brandId')??'','브랜드',100)||undefined;
  const storeId=str(params.get('storeId')??'','지점',100)||undefined;
  return json({facts:await getBrandFacts(owner,brandId,storeId)});
 }catch(error){return failure(error)}
}

export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await actor(req);owner=who.owner;secureMutation(req);
  const input=await body(req);
  if(input.action!=='save_fact')throw new ApiError(400,'지원하지 않는 작업입니다.');
  lock=await acquireLock(owner);
  await executionRate(owner,'facts');
  return json(await saveBrandFact(owner,input,who));
 }catch(error){return failure(error)}finally{if(lock)await releaseLock(owner,lock)}
}

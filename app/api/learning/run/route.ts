import {identity,secureMutation,body,failure} from '@/lib/server';
import {executeLearning} from '@/lib/learning-execution';
import {denyScoped} from '@/lib/server-access';

export async function POST(req:Request){
 try{
  const owner=await identity(req);
  secureMutation(req);
  await denyScoped(req);
  return await executeLearning(owner,await body(req));
 }catch(error){return failure(error)}
}

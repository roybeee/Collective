import {identity,secureMutation,body,failure} from '@/lib/server';
import {executeLearning} from '@/lib/learning-execution';

export async function POST(req:Request){
 try{
  const owner=identity(req);
  secureMutation(req);
  return await executeLearning(owner,await body(req));
 }catch(error){return failure(error)}
}

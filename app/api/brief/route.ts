import {identity,secureMutation,body,failure} from '@/lib/server';
import {executeBrief} from '@/lib/brief-execution';

export async function POST(req:Request){
 try{
  const owner=identity(req);
  secureMutation(req);
  return await executeBrief(owner,await body(req));
 }catch(error){return failure(error)}
}

import {identity,secureMutation,body,failure} from '@/lib/server';
import {executeRole} from '@/lib/role-execution';

export async function POST(req:Request){
 try{
  const owner=await identity(req);
  secureMutation(req);
  return await executeRole(owner,await body(req));
 }catch(error){return failure(error)}
}

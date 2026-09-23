import {actor,secureMutation,body,failure} from '@/lib/server';
import {executeRole} from '@/lib/role-execution';

export async function POST(req:Request){
 try{
  const who=await actor(req);
  secureMutation(req);
  return await executeRole(who.owner,await body(req),{id:who.id,email:who.email});
 }catch(error){return failure(error)}
}

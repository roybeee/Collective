import {actor,secureMutation,body,failure} from '@/lib/server';
import {executeMeeting} from '@/lib/meeting-execution';
export {GET} from '@/lib/meeting-execution';

export async function POST(req:Request){
 try{
  const who=await actor(req);
  secureMutation(req);
  return await executeMeeting(who.owner,await body(req),{id:who.id,email:who.email});
 }catch(error){return failure(error)}
}

import {identity,secureMutation,body,failure} from '@/lib/server';
import {executeMeeting} from '@/lib/meeting-execution';
export {GET} from '@/lib/meeting-execution';

export async function POST(req:Request){
 try{
  const owner=identity(req);
  secureMutation(req);
  return await executeMeeting(owner,await body(req));
 }catch(error){return failure(error)}
}

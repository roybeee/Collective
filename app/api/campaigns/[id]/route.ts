import {campaignDetail} from '@/lib/campaign-detail';
import {failure,identity,json,str} from '@/lib/server';

export async function GET(req:Request,context:{params:Promise<{id:string}>}){
 try{
  const owner=identity(req),{id}=await context.params;
  return json(await campaignDetail(owner,str(id,'캠페인',100,true)));
 }catch(e){return failure(e)}
}

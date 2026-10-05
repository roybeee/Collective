import {ApiError,body,failure,json,requireOwnerActor,secureMutation} from '@/lib/server';
import {retentionAction,retentionView} from '@/lib/product-research/server-retention-actions';
export async function GET(req:Request){try{const who=await requireOwnerActor(req);return json(await retentionView(who.owner))}catch(e){return failure(e)}}
export async function POST(req:Request){try{const who=await requireOwnerActor(req);secureMutation(req);const input=await body(req);if(!input.action)throw new ApiError(400,'작업을 선택하세요.');await retentionAction(who,input);return json(await retentionView(who.owner))}catch(e){return failure(e)}}

import {ApiError,failure,json,requireOwnerActor,secureMutation} from '@/lib/server';
import {HttpBodyError,readBoundedJson} from '@/lib/http-limits';
import {saveValidation,validationView} from '@/lib/product-research/server-validation';
export async function GET(req:Request){try{return json(await validationView(await requireOwnerActor(req)))}catch(e){return failure(e)}}
export async function POST(req:Request){try{
 const who=await requireOwnerActor(req);secureMutation(req);
 let input:unknown;
 try{input=await readBoundedJson(req,500000)}catch(e){if(e instanceof HttpBodyError)throw new ApiError(e.status,e.message);throw new ApiError(400,'입력 형식을 확인해 주세요.')}
 return json(await saveValidation(who,input));
}catch(e){return failure(e)}}

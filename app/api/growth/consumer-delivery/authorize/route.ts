import {authorizeConsumerRequest} from '@/lib/growth-consumer-delivery-authorization';
import {failure} from '@/lib/server';
export async function POST(req:Request){try{return await authorizeConsumerRequest(req)}catch(e){return failure(e)}}

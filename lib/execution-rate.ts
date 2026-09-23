import {ApiError,readRecord,recordStatement} from './server';

// Caller holds the owner lock. Persist before validation/external work so failures count too.
export async function executionRate(owner:string,scope:string){
 let prior:{startedAt:number;count:number}|null=null;
 try{prior=await readRecord(owner,'execution_rate',scope)}catch(e){if(!(e instanceof ApiError&&e.status===404))throw e}
 const now=Date.now(),current=prior&&now-prior.startedAt<60000?prior:{startedAt:now,count:0};
 if(current.count>=60)throw new ApiError(429,'요청이 많습니다. 잠시 후 다시 시도하세요.');
 await recordStatement(owner,'execution_rate',scope,{...current,count:current.count+1}).run();
}

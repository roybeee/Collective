import type {MetaExecution} from './meta-execution';
type Statuses={campaign:string;adset:string;ad:string};
export async function runExecutionTransition(initial:MetaExecution,target:'ACTIVE'|'PAUSED',api:{read:()=>Promise<Statuses>;write:(id:string,status:'ACTIVE'|'PAUSED')=>Promise<void>},journal:{save:(patch:Partial<MetaExecution>)=>Promise<MetaExecution>;current:()=>Promise<boolean>}){
 if(target==='ACTIVE'&&initial.state!=='approved')throw new Error('승인된 작업만 처음 활성화할 수 있습니다.');
 let row=await journal.save({state:target==='ACTIVE'?'activating':'stopping',maySpend:true});
 try{
  if(target==='PAUSED'){
   let failed=false;
   // Stored, approved IDs only. Stop the parent before any child read can fail.
   for(const objectId of [row.scope.campaignId,row.scope.adsetId,row.scope.adId]){
    row=await journal.save({pending:{objectId,status:'PAUSED'}});
    try{await api.write(objectId,'PAUSED')}catch{failed=true}
   }
   const statuses=await api.read();
   if(failed||Object.values(statuses).some(s=>s!=='PAUSED'))throw new Error('전체 중단을 확인하지 못했습니다.');
   return journal.save({state:'stopped',pending:null,maySpend:false,lastObservedAt:new Date().toISOString()});
  }
  const order:('ad'|'adset'|'campaign')[]=['ad','adset','campaign'];
  for(const key of order){
   if(target==='ACTIVE'&&!await journal.current())throw new Error('승인 근거가 변경되었습니다.');
   const statuses=await api.read(),id=row.scope[key==='ad'?'adId':key==='adset'?'adsetId':'campaignId'];
   if(statuses[key]===target)continue;
   row=await journal.save({pending:{objectId:id,status:target}});
   await api.write(id,target);
   const verified=await api.read();if(verified[key]!==target)throw new Error('변경한 상태를 확인하지 못했습니다.');
   row=await journal.save({pending:null,lastObservedAt:new Date().toISOString()});
  }
  const final=await api.read();if(Object.values(final).some(s=>s!==target))throw new Error('전체 상태를 확인하지 못했습니다.');
  return await journal.save({state:target==='ACTIVE'?'active':'stopped',pending:null,maySpend:target==='ACTIVE',lastObservedAt:new Date().toISOString()});
 }catch{
  // If persistence itself fails, the durable activating/stopping or pending record remains recoverable.
  return journal.save({state:'unknown',maySpend:true,stopReason:row.stopReason??'provider_result_unknown'});
 }
}

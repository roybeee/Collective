import {expect} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// Synthetic observations in real local D1; the actual API calculates all result fields.
type FixtureRow={kind:string;id:string;parent:string;data:unknown};
function fixtures(owner:string,rows:FixtureRow[]){
 const quote=(value:string)=>`'${value.replaceAll("'","''")}'`,folder=mkdtempSync(join(tmpdir(),'collective-expansion-'));
 try{const path=join(folder,'fixture.sql'),at=new Date().toISOString();writeFileSync(path,rows.map(({kind,id,parent,data})=>`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(${[`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),at].map(quote).join(',')}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;`).join('\n'));execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','e2e/.state','--file',path],{stdio:'pipe'});}finally{rmSync(folder,{recursive:true,force:true})}
}
export async function seedCanonicalExpansion({owner,campaignId,storeId,before,post}:{owner:string;campaignId:string;storeId:string;before:string;post:(path:string,data:unknown)=>Promise<{status?:string}>}){
  const refs=[{kind:'offer',id:'x-offer',version:1}],endAt=new Date(Date.now()-3600000).toISOString();
  const input={title:'실험',mode:'confirm',aa:false,missionId:'x-mission',missionVersion:1,offerId:'x-offer',offerVersion:1,channel:'storefront',interventionRefs:refs,minEffect:0.05,metric:'paid_orders',hypothesis:'가설',intervention:'개입',assignmentUnit:'pseudonymous_visitor',treatmentShare:0.5,lowerBound:0,upperBound:1,minSamplePerArm:30,startAt:before,endAt,maturityDays:0,stopRule:'중단'};
  const digest=createHash('sha256').update(JSON.stringify({id:'x-exp',input})).digest('hex');
  const rows:FixtureRow[]=[{kind:'growth_experiment',id:'x-exp',parent:campaignId,data:{id:'x-exp',brandId:'ofd',campaignId,storeId,version:2,status:'registered',input,seed:'s',registration:{digest,at:before,by:owner,refs}}}];
  for(const arm of ['control','treatment'])for(let i=0;i<100;i++){
   const id=`x-exp-${arm}-${i}`,orderId=`order-${id}`;
   if(arm==='treatment')rows.push({kind:'store_order',id:orderId,parent:storeId,data:{id:orderId,storeId,campaignId,version:1,orderDate:before.slice(0,10),status:'paid',paidAmount:100,refundAmount:0,costs:{unitCost:10}}});
   rows.push({kind:'growth_experiment_unit',id,parent:campaignId,data:{id,designId:'x-exp',brandId:'ofd',campaignId,version:1,unitHash:id,arm,observation:{exposed:true,trackingComplete:true,contaminated:false,orderIds:arm==='treatment'?[orderId]:[]}}});
  }
  fixtures(owner,rows);
  const analysis=await post('/api/growth/experiments',{action:'analyse',id:'x-exp',campaignId,campaignVersion:1,requestId:randomUUID()});
  expect(analysis.status).toBe('supported');
}

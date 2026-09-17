import {after} from 'next/server';
import {executeResearch} from './research-execution';
import {readRecord} from './server';
import {researchActive,type BrandResearch} from './archive';
// Only the short, idempotent handoff runs in waitUntil. Long research runs in HERMES.
// Stay within Workers' post-response lifetime; foreground recovery has a longer budget.
export function scheduleResearch(owner:string,id:string){after(async()=>{try{const r=await readRecord<BrandResearch>(owner,'brand_research',id);if(!researchActive(r)||r.steps.find(s=>s.status!=='completed')?.status!=='pending')return;const response=await executeResearch(owner,{id,action:'advance'},20000);if(!response.ok&&response.status!==409)console.error('research_background_handoff',response.status)}catch{console.error('research_background_handoff_interrupted')}})}

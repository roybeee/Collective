import {markUsageOutcome,type UsageOutcome,type UsageProvider} from './usage-ledger';

// Provider accounting is recorded before domain processing. A later annotation
// failure must not regress an already committed artifact/job or trigger a rerun.
export async function markUsageOutcomeSafely(owner:string,provider:UsageProvider,runId:string,outcome:UsageOutcome){
 try{return await markUsageOutcome(owner,provider,runId,outcome)}
 catch{console.error('usage_outcome_write_failed');return false}
}

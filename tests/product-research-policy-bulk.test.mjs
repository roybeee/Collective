import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load,env,sql}=testRuntime(async()=>{throw new Error('external forbidden')});
const p=await load('lib/product-research/server-policy.ts'),ops=await load('lib/product-research/server-ops.ts');
const owner='bulk-md',at=new Date(Date.now()-1000).toISOString();let passed=0;const check=(v,m)=>{assert.ok(v,m);passed++};
const insert=sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)');
const put=(kind,id,data,parent='')=>insert.run(`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),at);
put('pr_snapshot','shared',{id:'shared',sourceId:'own_sales',fetchedAt:at});
for(let i=0;i<2000;i++){
 put('pr_product',`p${i}`,{id:`p${i}`,scoreId:`c${i}`,listings:[]});
 put('pr_score',`c${i}`,{id:`c${i}`,productId:`p${i}`,computedAt:at,total:10,subScores:[{key:'momentum',value:10,evidence:['shared']}]},`p${i}`);
 put('pr_score_index',`p${i}`,{productId:`p${i}`,entries:[{id:`old${i}`,computedAt:'2020-01-01T00:00:00Z',total:1,momentum:1}],updatedAt:at});
}
const briefs=Array.from({length:50},(_,i)=>({id:`b${i}`,sourcePolicyVersion:p.SOURCE_POLICY_VERSION,productIds:Array.from({length:20},(_,j)=>`p${i*20+j}`),scoreCardIds:Array.from({length:20},(_,j)=>`c${i*20+j}`),claims:[{citations:['shared']}]}));
const real=env.DB;let queries=0;const wrap=st=>({bind:(...a)=>wrap(st.bind(...a)),first:async()=>{queries++;return st.first()},all:async()=>{queries++;return st.all()},run:()=>st.run()});env.DB={prepare:q=>wrap(real.prepare(q)),batch:real.batch};
let results=await p.briefResearchPolicies(owner,briefs);const briefQueries=queries;
check(results.size===50&&[...results.values()].every(r=>r.allowed),'50 briefs with 20 products each validated');
check(briefQueries<=12,`brief product/card/snapshot batches: ${briefQueries}`);
queries=0;const index=await ops.updateScoreIndex(owner);const indexQueries=queries;
check(index.updated===2000,'all 2000 current index revisions updated');
check(indexQueries<=25,`index snapshot policy shared: ${indexQueries}`);
sql.prepare("UPDATE records SET data=json_set(data,'$.sourceId','youtube_data') WHERE owner=? AND kind='pr_snapshot'").run(owner);
results=await p.briefResearchPolicies(owner,briefs);check([...results.values()].every(r=>!r.allowed),'next request rechecks original change, no stale cache');
check([...(await p.briefResearchPolicies('foreign',briefs)).values()].every(r=>!r.allowed),'context owner isolated');
env.DB=real;console.log(JSON.stringify({passed,briefQueries,indexQueries,sqlite:'real',externalCalls:0}));

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,SourceTextModule,SyntheticModule} from 'node:vm';
import ts from 'typescript';

// Run the production reservation function with boundary doubles. The adapter's
// SQLite transaction/permissions tests live in growth-publication-route.
const source=readFileSync('lib/execution-server.ts','utf8');
const ast=ts.createSourceFile('server.ts',source,ts.ScriptTarget.Latest,true);
const declaration=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='reservePublication');
let prepareBlocked=false,writeBlocked=false,linked=true,prepared=0,batches=[],singleWrites=0;
const pubWrite={name:'publication',run:async()=>{singleWrites++;}},growthWrite={name:'growth'};
class ApiError extends Error{constructor(status,message){super(message);this.status=status}}
const context=createContext({
 ApiError,stamp:()=>new Date().toISOString(),requireGrowthRunning:async()=>{},assertNotArchived:()=>{},
 approvalInputs:async()=>({credential:{secret:'mock'},limits:{maxPublications:3,maxPlannedCostKRW:1000}}),
 approvalDrift:()=>[],executionTotals:()=>({attempts:0,plannedCostKRW:0}),listRecords:async()=>[],
 verifyMedia:async()=>{},mediaHash:()=>'',openRecordSecret:async()=>'mock-token',
 publicationKeepingReview:()=>pubWrite,
 prepareGrowthPublicationSubmission:async()=>{prepared++;if(prepareBlocked)throw new ApiError(409,'reservation changed');return {writes:linked?[growthWrite]:[]}},
 database:()=>({batch:async writes=>{if(writeBlocked)throw new Error('write failed');batches.push([...writes]);}}),
});
const code=ts.transpileModule(declaration.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const reservation=new SourceTextModule(code,{context});await reservation.link(()=>{throw new Error('unexpected import')});await reservation.evaluate();
const p={id:'p',status:'approved',version:2,plannedCostKRW:100};
const reserve=()=>reservation.namespace.reservePublication('owner',{id:'campaign'},p,'https://app.test');
let result=await reserve();assert.equal(prepared,1,'every existing Buffer reservation must consult the growth adapter');
assert.equal(singleWrites,0,'publication cannot commit before growth writes');
assert.equal(batches.length,1);assert.deepEqual(batches[0],[pubWrite,growthWrite]);assert.equal(result.pending.status,'submitting');
prepareBlocked=true;await assert.rejects(reserve,/reservation changed/);assert.equal(batches.length,1);
prepareBlocked=false;writeBlocked=true;await assert.rejects(reserve,/write failed/);assert.equal(batches.length,1);
writeBlocked=false;linked=false;result=await reserve();assert.equal(result.pending.version,3);assert.deepEqual(batches[1],[pubWrite]);

// Execute the complete API module. Only its imported boundaries are doubled;
// the pre-dispatch branch, catches and Buffer invocation are production code.
let dispatchBlocked=false,dispatchCalls=0,providerCalls=0,stopBlocked=false;
const pending={...p,status:'submitting',version:3,channelId:'channel',caption:'text',mediaUrl:'https://app.test/a.png',scheduledAt:'2098-01-01T00:00:00Z'};
const implementations={
 identity:async()=>'owner',requireAdminActor:async()=>({owner:'owner',id:'owner',role:'owner'}),secureMutation:()=>{},
 readBoundedJson:async req=>req.json(),readRecord:async()=>({id:'campaign',brandId:'brand'}),str:v=>v,
 json:value=>Response.json(value),failure:e=>Response.json({error:e.message},{status:e.status??500}),
 acquireLock:async()=>'lock',releaseLock:async()=>{},executionRate:async()=>{},authEnv:{AUTH_ORIGIN:'https://app.test'},
 publicationFor:async()=>p,reservePublication:async()=>({pending,token:'mock-token'}),
 requireGrowthRunning:async()=>{if(stopBlocked)throw new ApiError(409,'stopped')},
 assertGrowthPublicationDispatch:async()=>{dispatchCalls++;if(dispatchBlocked)throw new ApiError(409,'delegation revoked')},
 submitBuffer:async()=>{providerCalls++;return {id:'remote',status:'scheduled'}},providerPublicationStatus:()=> 'accepted',
 saveProviderResult:async(_o,_c,_p,value)=>value,ApiError,HttpBodyError:ApiError,
};
const routeContext=createContext({Request,Response,URL,console});
const routeCode=ts.transpileModule(readFileSync('app/api/execution/route.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const imports=ts.createSourceFile('route.js',routeCode,ts.ScriptTarget.Latest,true).statements.filter(ts.isImportDeclaration);
const names=new Map(imports.map(i=>[i.moduleSpecifier.text,i.importClause.namedBindings.elements.map(e=>e.propertyName?.text??e.name.text)]));
const route=new SourceTextModule(routeCode,{context:routeContext});
await route.link(spec=>new SyntheticModule(names.get(spec),function(){for(const name of names.get(spec))this.setExport(name,implementations[name]??(()=>{throw new Error('Unexpected boundary '+name)}));},{context:routeContext}));await route.evaluate();
const execute=()=>route.namespace.POST(new Request('https://app.test/api/execution',{method:'POST',body:JSON.stringify({action:'execute',campaignId:'campaign',id:'p',version:2})}));
dispatchBlocked=true;result=await execute();assert.equal(result.status,200);assert.equal((await result.json()).status,'failed');assert.equal(dispatchCalls,1);assert.equal(providerCalls,0,'revoked linked intent must never call Buffer');
dispatchBlocked=false;result=await execute();assert.equal((await result.json()).status,'accepted');assert.equal(providerCalls,1);assert.equal(dispatchCalls,2);
stopBlocked=true;result=await execute();assert.equal((await result.json()).status,'failed');assert.equal(providerCalls,1,'global stop still blocks provider');
console.log(JSON.stringify({passed:22,boundaries:'mocked adapter/provider, production reservation and API control flow',external:0}));

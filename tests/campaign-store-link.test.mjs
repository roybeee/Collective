// 지점↔캠페인 연결(data-truth-3), 예산 미확정(null)과 0원 구분(data-truth-4), 지점 수정 시 복사 필드 동기화(data-truth-7).
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
class Statement{constructor(query,values=[]){this.query=query;this.values=values}bind(...v){return new Statement(this.query,v)}async first(){return sql.prepare(this.query).get(...this.values)||null}async all(){return {results:sql.prepare(this.query).all(...this.values)}}async run(){const r=sql.prepare(this.query).run(...this.values);return {meta:{changes:Number(r.changes)}}}}
const DB={prepare:q=>new Statement(q),batch:async ss=>{sql.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
const runtime={DB,AUTH_MODE:'legacy',AGENCY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
const fakeFetch=async url=>{throw new Error('Unexpected destination: '+url)};
const ctx=createContext({console,crypto:webcrypto,Response,Request,Headers,TextEncoder,TextDecoder,Uint8Array,Date,URL,AbortSignal,btoa,atob,fetch:fakeFetch,process:{env:{NODE_ENV:'production'}}});
const afterModule=new SyntheticModule(['after'],function(){this.setExport('after',()=>{})},{context:ctx});
const modules=new Map();const envModule=new SyntheticModule(['env'],function(){this.setExport('env',runtime)},{context:ctx});
function moduleFor(file){file=resolve(file);if(modules.has(file))return modules.get(file);if(file.endsWith('?raw')){const raw=new SyntheticModule(['default'],function(){this.setExport('default',readFileSync(file.slice(0,-4),'utf8'))},{context:ctx});modules.set(file,raw);return raw;}const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const m=new SourceTextModule(code,{context:ctx,identifier:file});modules.set(file,m);return m}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link((spec,ref)=>{if(spec==='cloudflare:workers')return envModule;if(spec==='next/server')return afterModule;const f=spec.startsWith('@/')?resolve(spec.slice(2)):resolve(dirname(ref.identifier),spec);return moduleFor(f.endsWith('.ts')||f.endsWith('?raw')?f:f+'.ts')});await m.evaluate();return m.namespace}
const action=await load('app/api/action/route.ts'),workspace=await load('app/api/workspace/route.ts'),stores=await load('app/api/stores/route.ts');
const server=await load('lib/server.ts'),brief=await load('lib/brief.ts'),agency=await load('lib/agency.ts');
const owner='qa-owner-with-a-production-length-authenticated-user-id';const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
async function request(fn,b,override={}){const headers={'Content-Type':'application/json','oai-authenticated-user-id':owner,...override};for(const k in headers)if(headers[k]===null)delete headers[k];const r=await fn(new Request('https://agency.test/api/test',{method:b?'POST':'GET',headers,...(b?{body:JSON.stringify(b)}:{})}));return {status:r.status,data:await r.json()}}
const act=(name,b={})=>request(action.POST,{action:name,...b});const sp=(name,b={},override)=>request(stores.POST,{action:name,...b},override);
const read=(kind,id)=>server.readRecord(owner,kind,id);const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const events=campaignId=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='event' AND parent_id=? ORDER BY rowid").all(owner,campaignId).map(r=>JSON.parse(r.data));
await request(workspace.GET);

// 1. 예산: 비어 있으면 미확정(null), 명시한 0은 무예산 확정. 확정 표시가 없는 기존 0은 읽을 때 미확정으로 취급한다.
let r=await act('save_campaign',{data:{brandId:'oda',title:'예산 미정',goal:'평일 방문 늘리기'}});
const unset=await read('campaign',r.data.id);
check('omitted budget is saved as unconfirmed null',r.status===200&&unset.budget===null&&!unset.budgetConfirmedAt);
const blank=await read('campaign',(await act('save_campaign',{data:{brandId:'oda',title:'빈 예산',goal:'평일 방문',budget:''}})).data.id);
check('blank budget is saved as unconfirmed null',blank.budget===null&&!blank.budgetConfirmedAt);
const zero=await read('campaign',(await act('save_campaign',{data:{brandId:'oda',title:'무예산',goal:'오가닉 실험',budget:0}})).data.id);
check('explicit zero is saved as a confirmed no-budget decision',zero.budget===0&&typeof zero.budgetConfirmedAt==='string');
check('negative budget is still rejected',(await act('save_campaign',{data:{brandId:'oda',title:'음수',goal:'x',budget:-1}})).status===400);
const cleared=await act('save_campaign',{id:zero.id,version:zero.version,data:{...zero,budget:null}});const clearedRecord=await read('campaign',zero.id);
check('clearing a confirmed budget drops the confirmation mark',cleared.status===200&&clearedRecord.budget===null&&!clearedRecord.budgetConfirmedAt);
const legacy={...unset,budget:0,budgetConfirmedAt:undefined};
check('legacy zero without a confirmation mark reads as unconfirmed',agency.campaignBudget(legacy)===null&&agency.budgetLabel(legacy)==='미확정');
check('confirmed zero reads as zero won',agency.campaignBudget(zero)===0&&agency.budgetLabel(zero)==='0원(무예산)');
check('null budget label is unconfirmed',agency.budgetLabel(unset)==='미확정');
check('positive legacy budget stays confirmed',agency.campaignBudget({budget:50000})===50000&&agency.budgetLabel({budget:50000})==='50,000원');
const operations=c=>brief.readiness(c).find(g=>g.title==='운영 준비').missing;
const form={brandId:'oda',title:'t',goal:'g',audience:'',channels:'',stores:'',products:'',budget:null,startDate:'',endDate:'',constraints:'',sources:'',plan:brief.emptyPlan()};
check('operation readiness asks for confirmed budget and dates',['budget','startDate','endDate'].every(k=>operations(form).includes(k)));
check('explicit zero in the form counts as a confirmed budget',!operations({...form,budget:0,startDate:'2026-10-01',endDate:'2026-10-31'}).some(k=>['budget','startDate','endDate'].includes(k)));
check('readiness groups keep unique titles',new Set(brief.readiness(form).map(g=>g.title)).size===brief.readiness(form).length);
check('execution gaps flag a legacy zero budget',brief.executionGaps({...legacy,startDate:'2026-10-01',endDate:'2026-10-31'}).join()==='budget');
check('execution gaps are empty once budget and period are set',brief.executionGaps({...zero,budget:0,startDate:'2026-10-01',endDate:'2026-10-31'}).length===0);
check('execution gaps list missing dates',brief.executionGaps(unset).join()==='budget,startDate,endDate');
// 화면: 확정 0원을 '미확정'으로 보이지 않게 모든 예산 표시는 budgetLabel을 쓰고, 캠페인 표는 실행 준비 미완 배지를 보여 준다.
// WebMCP 초안 도구는 사용자가 정하지 않은 예산을 확정하지 않는다(null=미확정).
const source=file=>readFileSync(file,'utf8');
check('WebMCP draft tool leaves the budget unconfirmed',!/budget:0\b/.test(source('app/workspace.tsx'))&&source('app/workspace.tsx').includes("api('save_campaign',{data:{...x,budget:null}})"));
check('campaign screens label budgets with budgetLabel',['app/workspace.tsx','app/panels.tsx'].every(f=>!source(f).includes('c.budget?money(c.budget)')&&source(f).includes('budgetLabel(c)')));
check('campaign table shows the execution readiness badge with missing items',source('app/workspace.tsx').includes('executionGaps(c)')&&source('app/workspace.tsx').includes('실행 준비 미완'));
check('execution gap labels name budget and dates',brief.executionGapLabels?.(unset)==='예산 상한, 시작일, 종료일');

// 2. 캠페인 텍스트의 동·호수가 연결 지점 주소에 없으면 충돌이다. 동네 이름·지하철 노선·지점 번호는 건물 동·호수가 아니다.
const conflicts=brief.addressConflicts;
check('unit missing from the store address is a conflict',conflicts('휘경동 C동 107호 매장 오픈 알리기','서울 동대문구 외대역동로 63-12 상가 동·층·호수 추가 필요').join()==='C동,107호');
check('matching unit is not a conflict',conflicts('C동 107호 오픈','외대역동로 63-12 c동 107호').length===0);
check('different unit is a conflict',conflicts('B동 101호에서 만나요','외대역동로 63-12 C동 107호').join()==='B동,101호');
check('neighborhoods, subway lines and branch numbers are ignored',conflicts('이문2동 휘경동 성수동 2호선 역 2호점','서울 어딘가').length===0);
check('numbered buildings are units',conflicts('101동 1203호','아파트 101동 1203호').length===0&&conflicts('102동','아파트 101동').join()==='102동');

// 3. 기존 캠페인을 지점에 1회만 연결한다. 이벤트와 행위자를 남기고 이미 연결됐으면 409.
const info={name:'ODA 이문동점',address:'서울 동대문구 외대역동로 63-12 상가 동·층·호수 추가 필요',tradeArea:'residential',customer:'인근 대학생',goal:'평일 저녁 방문',menu:'마르게리타',hours:'11시~21시',economics:'원가 확인 필요'};
const storeId=(await sp('save_store',{brandId:'oda',data:info})).data.id;
const foreignStore=(await sp('save_store',{brandId:'ofd',data:{...info,name:'OFD 지점'}})).data.id;
const secondStore=(await sp('save_store',{brandId:'oda',data:{...info,name:'ODA 2호점'}})).data.id;
const cid=(await act('save_campaign',{data:{brandId:'oda',title:'C107 오픈',goal:'휘경동 C동 107호 매장 오픈 알리기',stores:'휘경동'}})).data.id;
await put('artifact','with-refs',{id:'with-refs',campaignId:cid,campaignVersion:1,role:'cmo',title:'브리프',content:'본문',status:'review',version:1,origin:'manual',createdAt:'2026-09-01T00:00:00Z',factRefs:[]},cid);
await put('artifact','legacy-art',{id:'legacy-art',campaignId:cid,campaignVersion:1,role:'insight',title:'조사',content:'본문',status:'review',version:1,origin:'manual',createdAt:'2026-09-01T00:00:00Z'},cid);
await put('brand_fact','store-address',{id:'store-address',brandId:'oda',storeId,key:'주소',value:'외대역동로 63-12 C동 107호',status:'confirmed',source:'대표 확인',verifiedAt:'2026-09-01T00:00:00.000Z',validUntil:'2027-09-01T00:00:00.000Z',version:1,updatedAt:'2026-09-01T00:00:00.000Z'},'oda');
check('anonymous link denied',(await sp('link_store',{storeId,campaignId:cid,version:1},{'oai-authenticated-user-id':null})).status===401);
check('cross-origin link denied',(await sp('link_store',{storeId,campaignId:cid,version:1},{origin:'https://other.test'})).status===403);
check('store of another brand cannot be linked',(await sp('link_store',{storeId:foreignStore,campaignId:cid,version:1})).status===400);
check('stale campaign version cannot be linked',(await sp('link_store',{storeId,campaignId:cid,version:0})).status===409);
sql.prepare('INSERT INTO jobs(id,owner,campaign_id,role,status,model,campaign_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('link-job',owner,cid,'cmo','in_progress','mock',1,'now','now');
check('active AI work blocks linking',(await sp('link_store',{storeId,campaignId:cid,version:1})).status===409&&!(await read('campaign',cid)).storeId);
sql.prepare("UPDATE jobs SET status='completed' WHERE id='link-job'").run();
// R4: 제작·발행 기록이 있는 캠페인은 연결하지 않는다. 연결 뒤 기존 소재(지점 없음)는 접수할 수 없게 되기 때문이다.
const produced=(await act('save_campaign',{data:{brandId:'oda',title:'제작한 캠페인',goal:'소재가 있는 캠페인'}})).data.id;
await put('execution_creative','linked-png',{id:'linked-png',campaignId:produced,brandId:'oda',version:1,factRefs:[],caption:'',pngHash:'h',objectKey:'',createdAt:'2026-09-01T00:00:00Z'},produced);
const producedLink=await sp('link_store',{storeId,campaignId:produced,version:1});
check('campaign with execution records cannot be linked to a store',producedLink.status===409&&producedLink.data.error.includes('제작·발행')&&!(await read('campaign',produced)).storeId);
// R10: 연결 전에 요청한 HERMES 브리프 초안(지점 컨텍스트 없음)은 연결 뒤 저장하지 않는다.
const preLinkCampaign=await read('campaign',cid);
await put('brief_draft','pre-link-draft',{id:'pre-link-draft',status:'completed',input:{brandId:'oda',title:preLinkCampaign.title,goal:preLinkCampaign.goal,audience:'',channels:'',stores:'',products:'',budget:null,startDate:'',endDate:'',constraints:'',sources:'',plan:brief.emptyPlan()},campaignId:cid,campaignVersion:1,result:{summary:'초안',suggestions:[],questions:[],assumptions:[],contextUsed:[]},model:'mock',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'});
r=await sp('link_store',{storeId,campaignId:cid,version:1});let linked=await read('campaign',cid);
check('existing campaign links to a store',r.status===200&&linked.storeId===storeId&&linked.version===1);
const linkEvent=events(cid).find(e=>e.message.includes('지점 연결'));
check('link event records the store and requester',!!linkEvent&&linkEvent.message.includes(info.name)&&linkEvent.actor?.id===owner);
check('artifacts that now miss store facts are marked changed',(await read('artifact','with-refs')).factsChanged===true&&!(await read('artifact','legacy-art')).factsChanged);
check('every current artifact is marked for store context review',(await read('artifact','with-refs')).brandChanged===true&&(await read('artifact','legacy-art')).brandChanged===true);
const staleDraft=await act('save_campaign',{id:cid,version:1,briefDraftId:'pre-link-draft',data:{...linked}});
check('brief draft requested before the store link cannot be saved',staleDraft.status===409&&staleDraft.data.error.includes('지점')&&(await read('campaign',cid)).version===1);
check('linking twice is rejected',(await sp('link_store',{storeId,campaignId:cid,version:1})).status===409);
check('linking to another store is rejected',(await sp('link_store',{storeId:secondStore,campaignId:cid,version:1})).status===409&&(await read('campaign',cid)).storeId===storeId);
check('brief save cannot move the linked store',(await act('save_campaign',{id:cid,version:1,data:{...linked,storeId:secondStore}})).status===400);
check('brief save keeps the link when the form omits it',(await act('save_campaign',{id:cid,version:1,data:{...linked,storeId:undefined}})).status===200&&(await read('campaign',cid)).storeId===storeId);

// 4. 점포 실험에서 만든 캠페인은 실험 예산을 그대로 옮긴다(0원 확정 유지).
const plan={title:'무예산 전단',channel:'daangn',hypothesis:'가격 안내가 방문을 늘린다',control:'기존 안내',treatment:'가격 추가',primaryMetric:'orders',target:10,budget:0,startDate:'2026-10-01',endDate:'2026-10-31',measurement:'POS 코드',stopRule:'손실 시 중단'};
const experimentId=(await sp('save_experiment',{storeId,data:plan})).data.id;
const storeCampaignId=(await sp('create_campaign',{storeId,experimentId})).data.id;let sc=await read('campaign',storeCampaignId);
check('store campaign keeps a confirmed zero budget',sc.budget===0&&typeof sc.budgetConfirmedAt==='string'&&agency.budgetLabel(sc)==='0원(무예산)');
check('store campaign copies store fields',sc.stores===info.name+' · '+info.address&&sc.products===info.menu&&sc.audience===info.customer&&sc.plan.operations.startsWith(info.menu));

// 5. 지점 수정: 사용자가 손대지 않은 복사 필드는 자동 갱신, 수정한 필드는 충돌 목록으로 남긴다. 바뀐 게 없으면 연쇄 무효화하지 않는다.
await act('save_campaign',{id:storeCampaignId,version:1,data:{...sc,audience:'사용자가 고친 타깃'}});sc=await read('campaign',storeCampaignId);
await put('artifact','store-art',{id:'store-art',campaignId:storeCampaignId,campaignVersion:sc.version,role:'cmo',title:'브리프',content:'본문',status:'review',version:1,origin:'manual',createdAt:'2026-09-01T00:00:00Z'},storeCampaignId);
let store=await read('store',storeId);
const moved={...info,address:'서울 동대문구 외대역동로 63-12 C동 107호',customer:'인근 직장인',menu:'마르게리타 12,900원'};
check('store edit saved',(await sp('save_store',{brandId:'oda',id:storeId,version:store.version,data:moved})).status===200);
let after=await read('campaign',storeCampaignId);
check('untouched copied fields follow the store',after.stores===info.name+' · '+moved.address&&after.products===moved.menu&&after.plan.operations.startsWith(moved.menu)&&after.constraints===info.economics);
check('user-edited copied field is kept',after.audience==='사용자가 고친 타깃');
check('changed brief bumps the version and resets approval',after.version===sc.version+1&&after.status==='draft'&&(await read('artifact','store-art')).status==='outdated');
let syncEvent=events(storeCampaignId).filter(e=>e.message.includes('지점 정보 변경')).at(-1);
check('store change event lists updated fields and conflicts',!!syncEvent&&syncEvent.storeSync?.updated.includes('stores')&&syncEvent.storeSync.updated.includes('products')&&syncEvent.storeSync.updated.includes('operations')&&syncEvent.storeSync.conflicts.join()==='audience'&&syncEvent.message.includes('타깃 고객')&&syncEvent.actor?.id===owner);
check('linked campaign with its own text reports conflicts only',(()=>{const e=events(cid).filter(e=>e.message.includes('지점 정보 변경')).at(-1);return !!e&&e.storeSync.updated.length===0&&e.storeSync.conflicts.includes('stores')})());
check('linked campaign text is not overwritten',(await read('campaign',cid)).stores==='휘경동');
const eventCount=events(storeCampaignId).length;store=await read('store',storeId);
check('identical store save succeeds',(await sp('save_store',{brandId:'oda',id:storeId,version:store.version,data:moved})).status===200);
check('identical store save does not invalidate campaigns',(await read('campaign',storeCampaignId)).version===after.version&&events(storeCampaignId).length===eventCount);
await put('artifact','fresh-art',{id:'fresh-art',campaignId:storeCampaignId,campaignVersion:after.version,role:'cmo',title:'브리프',content:'본문',status:'approved',version:1,origin:'manual',createdAt:'2026-09-01T00:00:00Z'},storeCampaignId);
store=await read('store',storeId);
await sp('save_store',{brandId:'oda',id:storeId,version:store.version,data:{...moved,customer:'주말 가족',competitors:'인근 피자 매장'}});
const kept=await read('campaign',storeCampaignId),fresh=await read('artifact','fresh-art');
check('store change without copied field updates keeps brief version and status',kept.version===after.version&&kept.status===after.status&&kept.audience==='사용자가 고친 타깃');
check('store change marks current work for review instead of outdating it',fresh.status==='approved'&&fresh.brandChanged===true);
syncEvent=events(storeCampaignId).at(-1);
check('conflict-only store change is still recorded',syncEvent.message.includes('지점 정보 변경')&&syncEvent.storeSync.updated.length===0&&syncEvent.storeSync.conflicts.join()==='audience');

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));

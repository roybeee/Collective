import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

// 근거 컨텍스트: 역할·회의·브리프가 같은 사실 집합(확정·금지·후보)과 상시 지시, 미확인 브랜드 소개를 받는지 확인한다.
const rt=testRuntime(async()=>{throw new Error('External calls forbidden in evidence context regression')});
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const server=await rt.load('lib/server.ts'),ctx=await rt.load('lib/ai-context.ts'),archive=await rt.load('app/api/archive/route.ts'),archiveServer=await rt.load('lib/archive-server.ts');
const owner='workspace',admin='a'.repeat(64),member='b'.repeat(64);
await server.seedBrands(owner);
for(const [id,role,token] of [['admin','admin',admin],['member','member',member]]){
 rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',owner,role,'active',Date.now());
 rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());
}
let passed=0;const check=(name,value)=>{assert.ok(value,name);passed++};
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const call=async(token,data)=>{const r=await archive.POST(new Request('https://app.test/api/archive',{method:'POST',headers:{cookie:'__Host-collective_session='+token,origin:'https://app.test','content-type':'application/json'},body:JSON.stringify(data)}));return {status:r.status,...await r.json()}};
const keys=list=>list.map(x=>x.key).sort().join(',');
const now=Date.now(),past=new Date(now-60000).toISOString(),future=new Date(now+86400000).toISOString();
const fact=(id,extra={})=>({id,brandId:'oda',key:id,value:id+' 값',status:'confirmed',source:'점주 확인',verifiedAt:past,validUntil:future,version:1,updatedAt:past,...extra});

// (1) 사실 원장: 확정(유효기한·범위), 금지(거절), 후보(미확인·만료)를 구분하고 캠페인의 브랜드·지점 범위로 거른다.
await put('store','s1',{id:'s1',brandId:'oda',status:'active'},'oda');await put('store','s2',{id:'s2',brandId:'oda',status:'active'},'oda');
await put('brand_fact','address',fact('address',{storeId:'s1',value:'휘경동 377 C동 107호'}),'oda');
await put('brand_fact','hours',fact('hours',{version:3}),'oda');
await put('brand_fact','other-store',fact('other-store',{storeId:'s2'}),'oda');
await put('brand_fact','expired',fact('expired',{validUntil:past}),'oda');
await put('brand_fact','oven',fact('oven',{status:'rejected',value:'화덕'}),'oda');
await put('brand_fact','popular',fact('popular',{status:'candidate',source:'',verifiedAt:'',validUntil:'',value:'동네 1위'}),'oda');
await put('brand_fact','ofd-fact',fact('ofd-fact',{brandId:'ofd'}),'ofd');
const storeCampaign={id:'c1',brandId:'oda',storeId:'s1',title:'오픈',goal:'오픈 알리기',version:3,status:'draft'};await put('campaign','c1',storeCampaign);
const brandCampaign={id:'c2',brandId:'oda',title:'브랜드',goal:'브랜드 알리기',version:1,status:'draft'};await put('campaign','c2',brandCampaign);
let ev=await ctx.evidenceContext(rt.env.DB,owner,storeCampaign);
check('confirmed facts keep validity and store scope',keys(ev.facts.confirmed)==='address,hours');
check('rejected facts reach AI as prohibited ad claims',keys(ev.facts.prohibited)==='oven'&&JSON.stringify(ev.facts.prohibited).includes('화덕')&&JSON.stringify(ev.facts.prohibited).includes('광고 금지 표현'));
check('candidate and expired facts are marked unverified',keys(ev.facts.candidate)==='expired,popular'&&JSON.stringify(ev.facts.candidate).includes('미확인'));
check('other store and other brand facts excluded',!JSON.stringify(ev).includes('other-store')&&!JSON.stringify(ev).includes('ofd-fact'));
check('AI fact items expose no internal ids or store ids',!JSON.stringify(ev.facts).includes('"id"')&&!JSON.stringify(ev.facts).includes('s1'));
check('factRefs record confirmed and rejected fact versions',JSON.stringify(ev.factRefs)===JSON.stringify([{id:'address',version:1,status:'confirmed'},{id:'hours',version:3,status:'confirmed'},{id:'oven',version:1,status:'rejected'}]));
check('brand campaign excludes store-only facts',keys((await ctx.evidenceContext(rt.env.DB,owner,brandCampaign)).facts.confirmed)==='hours');
await put('brand_fact','oven-local',fact('oven-local',{key:'oven',storeId:'s1',value:'전기 오븐'}),'oda');
ev=await ctx.evidenceContext(rt.env.DB,owner,storeCampaign);
check('store confirmation overrides brand-level prohibition of the same key',keys(ev.facts.confirmed)==='address,hours,oven'&&ev.facts.confirmed.some(f=>f.value==='전기 오븐')&&!ev.facts.prohibited.length);
check('brand scope keeps prohibition when only a store confirmed it',keys((await ctx.evidenceContext(rt.env.DB,owner,brandCampaign)).facts.prohibited)==='oven');

// (2) 상시 지시: 해당 캠페인의 지시만 등록 순서대로 전달한다.
check('no directives yet',Array.isArray(ev.directives)&&ev.directives.length===0);
await put('campaign_directive','d2',{id:'d2',campaignId:'c1',text:'인기·할인은 확인 전 쓰지 않습니다.',createdAt:new Date(now-1000).toISOString(),createdBy:{id:'admin',email:null}},'c1');
await put('campaign_directive','d1',{id:'d1',campaignId:'c1',text:'선택지를 되묻지 말고 초안을 완성합니다.',createdAt:new Date(now-5000).toISOString(),createdBy:{id:'admin',email:null}},'c1');
await put('campaign_directive','d3',{id:'d3',campaignId:'c2',text:'다른 캠페인 지시',createdAt:past,createdBy:{id:'admin',email:null}},'c2');
ev=await ctx.evidenceContext(rt.env.DB,owner,storeCampaign);
check('directives delivered in creation order for this campaign only',JSON.stringify(ev.directives.map(d=>d.text))===JSON.stringify(['선택지를 되묻지 말고 초안을 완성합니다.','인기·할인은 확인 전 쓰지 않습니다.']));
check('directives without a stored role are labelled as admin directives',ev.directives.every(d=>d.author==='관리자'));
check('brand intro marked unverified in context',ev.brandIntro.verification==='unverified'&&typeof ev.brandIntro.text==='string');

// (3) 브랜드 소개는 사실이 아닌 '미확인 소개'로 분리한다.
const oda=await server.readRecord(owner,'brand','oda');
const aiOda=ctx.aiBrand({...oda,description:'화덕의 열기',knowledge:'대표 대화 기반 메모'});
check('identity carries profile fields including brand color',Object.keys(aiOda.identity).sort().join(',')==='audience,category,color,constraints,name,short,tone'&&aiOda.identity.color===oda.color);
check('description and knowledge move to unverified intro',aiOda.brandIntro.text.includes('화덕의 열기')&&aiOda.brandIntro.text.includes('대표 대화 기반 메모')&&aiOda.brandIntro.verification==='unverified'&&aiOda.brandIntro.useInCopy===false);
check('identity never repeats intro claims',!JSON.stringify(aiOda.identity).includes('화덕'));
check('new workspace ODA seed no longer asserts unverified equipment',!/화덕|wood-fired/i.test(oda.description)&&oda.description.includes('미확인'));
await server.recordStatement('kept-owner','brand','oda',{...oda,description:'운영자가 저장한 소개'}).run();await server.seedBrands('kept-owner');
check('stored brand records are not rewritten by the seed',(await server.readRecord('kept-owner','brand','oda')).description==='운영자가 저장한 소개');

// (6) 근거 자료: 확정 자료 수·제외된 후보 수·진단 상태.
const source=(id,extra={})=>({id,brandId:'oda',title:id,category:'product',origin:'research',status:'candidate',url:'',content:id+' 내용',observedAt:past,createdAt:past,version:1,scope:'테스트',...extra});
await put('brand_source','conf-brand',source('conf-brand',{status:'confirmed'}),'oda');
await put('brand_source','conf-s1',source('conf-s1',{status:'confirmed',storeId:'s1'}),'oda');
await put('brand_source','conf-s2',source('conf-s2',{status:'confirmed',storeId:'s2'}),'oda');
await put('brand_source','cand-1',source('cand-1'),'oda');await put('brand_source','cand-2',source('cand-2'),'oda');
await put('brand_source','empty',source('empty',{content:''}),'oda');
await put('brand_source','gone',source('gone',{status:'excluded'}),'oda');
await archiveServer.stateWrite(owner,'oda',4).run();
ev=await ctx.evidenceContext(rt.env.DB,owner,storeCampaign);
check('source counts follow campaign scope',ev.sources.confirmed===2&&ev.sources.excludedCandidates===3&&ev.sources.diagnosis==='none');

// 일괄 검토: 직원은 확정·제외 불가(PR 1), 관리자는 여러 자료를 한 번에 검토하고 revision은 한 번만 오른다.
const diagnosis={id:'diag',brandId:'oda',researchId:'r1',archiveRevision:1,status:'candidate',summary:'진단',positioning:'',audience:'',needs:'',strengths:'',gaps:'',opportunities:[],questions:[],sourceIds:['cand-1','cand-2'],limitations:'',createdAt:new Date(now-30000).toISOString()};
await put('brand_diagnostic','diag',diagnosis,'oda');
const bulk=[{id:'cand-1',version:1,status:'confirmed'},{id:'cand-2',version:1,status:'confirmed'}];
check('member cannot confirm sources in bulk',(await call(member,{action:'review_sources',brandId:'oda',items:bulk})).status===403);
check('member bulk attempt changes nothing',(await server.readRecord(owner,'brand_source','cand-1')).status==='candidate');
check('stale item rejects whole batch',(await call(admin,{action:'review_sources',brandId:'oda',items:[bulk[0],{...bulk[1],version:9}]})).status===409&&(await server.readRecord(owner,'brand_source','cand-1')).status==='candidate');
check('content-less source cannot be confirmed in bulk',(await call(admin,{action:'review_sources',brandId:'oda',items:[{id:'empty',version:1,status:'confirmed'}]})).status===400);
check('duplicate items rejected',(await call(admin,{action:'review_sources',brandId:'oda',items:[bulk[0],bulk[0]]})).status===400);
check('empty batch rejected',(await call(admin,{action:'review_sources',brandId:'oda',items:[]})).status===400);
const reviewed=await call(admin,{action:'review_sources',brandId:'oda',items:bulk});
check('admin reviews many sources at once',reviewed.status===200&&(await server.readRecord(owner,'brand_source','cand-2')).status==='confirmed'&&(await server.readRecord(owner,'brand_source','cand-2')).version===2);
check('bulk review raises revision exactly once',(await archiveServer.archiveState(owner,'oda')).revision===5);
check('member may return a source to candidate in bulk',(await call(member,{action:'review_sources',brandId:'oda',items:[{id:'empty',version:1,status:'candidate'}]})).status===200);

// 진단 채택: 근거 자료가 모두 확정이고 진단 이후 근거가 바뀌지 않았다면 revision이 달라도 다시 진단하지 않고 채택한다.
check('member cannot adopt diagnosis',(await call(member,{action:'confirm_diagnosis',brandId:'oda',id:'diag'})).status===403);
check('diagnosis adoptable after confirming its basis without rerun',(await call(admin,{action:'confirm_diagnosis',brandId:'oda',id:'diag'})).status===200);
const adopted=await server.readRecord(owner,'brand_diagnostic','diag');
check('adoption records the deciding admin',adopted.status==='confirmed'&&adopted.confirmedBy?.id==='admin'&&Number.isFinite(Date.parse(adopted.confirmedAt)));
ev=await ctx.evidenceContext(rt.env.DB,owner,storeCampaign);
check('adopted diagnosis reported as included',ev.sources.diagnosis==='included');
check('adopted diagnosis reaches archive context',(await archiveServer.brandArchiveContext(owner,'oda','s1')).confirmedDiagnosis?.id==='diag');
await call(member,{action:'add_source',brandId:'oda',data:{title:'새 자료',content:'근거와 무관한 새 자료'}});
check('unrelated new source does not invalidate adopted diagnosis',(await ctx.evidenceContext(rt.env.DB,owner,storeCampaign)).sources.diagnosis==='included');
await put('brand_diagnostic','diag-2',{...diagnosis,id:'diag-2',sourceIds:['gone']},'oda');
check('diagnosis grounded in excluded source cannot be adopted',(await call(admin,{action:'confirm_diagnosis',brandId:'oda',id:'diag-2'})).status===409);
await put('brand_diagnostic','diag-3',{...diagnosis,id:'diag-3',sourceIds:['late'],createdAt:new Date(now-90000).toISOString()},'oda');
await put('brand_source','late',source('late',{status:'confirmed',createdAt:new Date(now-1000).toISOString()}),'oda');
check('basis source created after the diagnosis blocks adoption',(await call(admin,{action:'confirm_diagnosis',brandId:'oda',id:'diag-3'})).status===409);
check('brand profile change makes adopted diagnosis stale',(await (async()=>{await put('brand','oda',{...oda,tone:'바뀐 톤'});return (await ctx.evidenceContext(rt.env.DB,owner,storeCampaign)).sources.diagnosis==='stale'&&(await archiveServer.brandArchiveContext(owner,'oda','s1')).confirmedDiagnosis===null})()));
check('stale diagnosis can be re-adopted without rerun',(await call(admin,{action:'confirm_diagnosis',brandId:'oda',id:'diag'})).status===200&&(await ctx.evidenceContext(rt.env.DB,owner,storeCampaign)).sources.diagnosis==='included');
// 가장 최근에 채택한 진단이 빠지면 예전에 채택한 진단으로 조용히 돌아가지 않는다(diagnosis-fallback).
await put('brand_diagnostic','diag-new',{...diagnosis,id:'diag-new',sourceIds:['late'],createdAt:new Date().toISOString()},'oda');
check('newer diagnosis adopted',(await call(admin,{action:'confirm_diagnosis',brandId:'oda',id:'diag-new'})).status===200);
const late=await server.readRecord(owner,'brand_source','late');await call(admin,{action:'review_source',brandId:'oda',id:'late',version:late.version,status:'excluded'});
check('stale latest diagnosis does not fall back to an older adoption',(await ctx.evidenceContext(rt.env.DB,owner,storeCampaign)).sources.diagnosis==='stale'&&(await archiveServer.brandArchiveContext(owner,'oda','s1')).confirmedDiagnosis===null);
check('archive listing marks only the latest adoption as included',(await (await archive.GET(new Request('https://app.test/api/archive?brandId=oda',{headers:{cookie:'__Host-collective_session='+admin}}))).json()).diagnostics.every(d=>!d.included));
const current=await server.readRecord(owner,'brand_source','cand-1');await call(admin,{action:'review_source',brandId:'oda',id:'cand-1',version:current.version,status:'excluded'});
ev=await ctx.evidenceContext(rt.env.DB,owner,storeCampaign);
check('excluding a basis source makes diagnosis stale',ev.sources.diagnosis==='stale'&&(await archiveServer.brandArchiveContext(owner,'oda','s1')).confirmedDiagnosis===null);
const state=await archiveServer.archiveState(owner,'oda');
await put('brand_diagnostic','legacy',{...diagnosis,id:'legacy',status:'confirmed',sourceIds:['conf-brand'],archiveRevision:state.revision,createdAt:new Date().toISOString()},'oda');
check('legacy adopted diagnosis keeps revision rule',(await ctx.evidenceContext(rt.env.DB,owner,storeCampaign)).sources.diagnosis==='included');
await archiveServer.stateWrite(owner,'oda',state.revision+1).run();
check('legacy adopted diagnosis stale after revision change',(await ctx.evidenceContext(rt.env.DB,owner,storeCampaign)).sources.diagnosis==='stale');
console.log(JSON.stringify({passed}));

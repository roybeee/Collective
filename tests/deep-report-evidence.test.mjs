// 심층 조사 최종 보고서의 근거 보존. 운영 실측(2026-09-24 심층 조사 4단계 완료, 최종 보고서에서 19개 항목 제외)을 합성 자료로 재현한다.
// 모델이 이미 보관된 입력 자료를 결과 sources에 다시 선언했다. 같은 URL 재선언은 기존 자료 참조라 '뺀 항목'이 아니라 재선언 수로만 남기고 인용은 입력 자료로 잇는다.
// 입력 자료 번호를 다른 URL로 다시 쓴 충돌은 근거를 옮겨 붙이지 않고 빼되 사유가 원인을 말한다. 기능 스위치 a7_repair_turn이 켜져 있으면 뼈대 오류 수리와 같은 경로·같은 1회 한도로 번호 수리를 요청한다.
// 번호 수리 응답은 원래 응답과 대조해 번호 바꾸기만 받는다(관찰값 변경·항목 추가·다른 출처로 옮긴 인용은 원래 결과). 수리가 결과 없이 끝나거나 중지되면 원래 구제 결과로 완료한다.
// 근거: mocked(합성 보고서, 모의 HERMES fetch 스텁, 메모리 SQLite, React 정적 렌더). 유료 모델·HERMES·외부 API 호출은 0회다.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {testRuntime} from './helpers/runtime.mjs';

const HERMES='https://hermes.example.com',runs=new Map(),byKey=new Map(),posts=[],external=[];
let seq=0,postMode='ok',nextOutput='',repairOutput='',repairStatus='completed',failDiagnostic=0;
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);if(!url.startsWith(HERMES+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 const path=url.slice(HERMES.length);
 // 중지 요청: HERMES처럼 실행을 cancelled로 바꾸고 그 실행 기록을 돌려준다.
 const stopped=/^\/v1\/runs\/([\w-]+)\/stop$/.exec(path)?.[1];if(stopped&&runs.has(stopped)){runs.get(stopped).status='cancelled';return Response.json({object:'hermes.run',run_id:stopped,status:'cancelled',output:null,usage:{total_tokens:5},model:'mock-model'})}
 if(path==='/v1/runs'&&options.method==='POST'){
  const key=options.headers['Idempotency-Key'],body=JSON.parse(options.body),repair='original' in JSON.parse(body.input);
  posts.push({key,repair,body});
  if(postMode==='reject')return new Response('{}',{status:400});
  // HERMES처럼 같은 멱등 키는 같은 실행 번호를 돌려준다. lost: 접수는 됐지만 응답이 사라졌다(502).
  let id=byKey.get(key);if(!id){id='run_'+ ++seq;byKey.set(key,id);runs.set(id,repair?{output:repairOutput,status:repairStatus}:{output:nextOutput,status:'completed'})}
  if(postMode==='lost')return new Response('{}',{status:502});
  return Response.json({run_id:id});
 }
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1];if(!id||!runs.has(id))return new Response('{}',{status:404});const run=runs.get(id);
 return Response.json({object:'hermes.run',run_id:id,status:run.status,output:run.status==='completed'?run.output:null,usage:{total_tokens:10},model:'mock-model'});
// failDiagnostic: 진단 후보 쓰기를 그 횟수만큼 실패시킨다(D1 일시 오류 재현, 같은 batch는 롤백된다).
},{beforeRun:s=>{if(failDiagnostic&&s.values.includes('brand_diagnostic')){failDiagnostic--;throw new Error('모의 D1 일시 오류')}}});
const server=await load('lib/server.ts'),deep=await load('lib/deep-research-server.ts'),stages=await load('lib/archive-research.ts'),exec=await load('lib/research-execution.ts'),flags=await load('lib/feature-flags.ts'),budget=await load('lib/token-budget.ts'),{researchPhases}=await load('lib/deep-research.ts');
let passed=0;const check=(name,condition)=>{assert.ok(condition,name);passed++};
const caught=run=>{try{run()}catch(e){return e}return null};

// 합성 자료. 실제 브랜드·고객 정보가 아니다. 입력 자료 3개는 앞선 단계가 보관한 출처(<조사 id>-<단계>-<순번> 형태)다.
const at='2026-09-18T00:00:00.000Z',now=new Date().toISOString(),NEW_URL='https://community.example.com/thread/7',FABRICATED='https://fabricated.example.org/x';
const REUSED='출처 번호 충돌(입력 자료 번호를 다른 URL로 재사용)로 어느 근거인지 가릴 수 없어 뺐습니다.',SHARED='출처 번호 충돌(새 출처 여러 개가 같은 번호를 씀)로 어느 근거인지 가릴 수 없어 뺐습니다.';
const GHOST='실제 조사 자료와 일치하지 않는 근거입니다.',INVENTED='수리 응답에 원래 없던 출처라 뺐습니다.',LOST='형식·근거 검증에서 뺀 항목';
const input=(suffix,category,url,origin='research')=>({id:'prev-'+suffix,brandId:'rp-brand',researchId:'prev',title:suffix+' 자료',category,origin,status:'candidate',url,content:suffix+' 관찰 근거',scope:'공식 원문',observedAt:at,createdAt:at,version:1});
const inputs=[input('channel-0','channel','https://social.example.com/brand'),input('customer-1','customer','https://reviews.example.com/place/1'),input('customer-2','customer','https://reviews.example.com/place/2')];
const declare=(s,url=s.url)=>({id:s.id,title:s.title,category:s.category,url,content:s.content,scope:s.scope,observedAt:at});
const browse=sourceId=>({sourceId,method:'browser',tool:'test-browser',scope:'읽기'});
// 원래 응답: channel-0·customer-1은 같은 URL로 재선언, customer-2는 다른 URL로 재선언하고 고객 관찰·핵심 주장·실험 과제·접근 기록·진단 근거가 customer-2를 인용한다.
const original=()=>({
 sources:[declare(inputs[0]),declare(inputs[1]),declare(inputs[2],NEW_URL),{id:'new-a',title:'메뉴 페이지',category:'product',url:'https://brand.example.com/menu',content:'메뉴 구성',scope:'공식 원문',observedAt:at}],
 phases:researchPhases.map(phase=>({phase,summary:phase+' 검토'})),
 access:[browse('prev-customer-2'),browse('new-a'),browse('prev-channel-0')],
 cases:[],
 customerSignals:[{sourceId:'prev-customer-2',kind:'barrier',observation:'배달 대기 불만',implication:'대기 안내'},{sourceId:'prev-customer-1',kind:'motivation',observation:'도우 식감 칭찬',implication:'식감 강조'}],
 competitors:[],
 review:{claims:[{claim:'대기 시간이 장벽',sourceIds:['prev-customer-2'],counterEvidence:'주말만일 수 있음',nextCheck:'평일 비교'},{claim:'식감이 선택 이유',sourceIds:['prev-customer-1'],counterEvidence:'가격 요인',nextCheck:'한 변수 실험'}],followups:[],unresolved:[]},
 diagnosis:{summary:'진단',positioning:'p',audience:'a',needs:'n',strengths:'s',gaps:'g',limitations:'l',questions:[],sourceIds:['prev-channel-0','prev-customer-1','prev-customer-2','new-a'],opportunities:[{title:'대기 안내',hypothesis:'h',action:'a',metric:'m',sourceIds:['prev-customer-2']},{title:'식감 소재',hypothesis:'h',action:'a',metric:'m',sourceIds:['prev-customer-1','new-a']}]}
});
const edit=(x,change)=>{change(x);return x};
// 모의 수리 응답: 다른 URL 자료를 새 번호 new-1로 다시 선언하고 그 자료를 인용한 곳만 new-1로 고친다.
const repaired=()=>edit(original(),x=>{x.sources[2]={...x.sources[2],id:'new-1'};x.access[0].sourceId='new-1';x.customerSignals[0].sourceId='new-1';x.review.claims[0].sourceIds=['new-1'];x.diagnosis.sourceIds[2]='new-1';x.diagnosis.opportunities[0].sourceIds=['new-1']});
const research={id:'rs',brandId:'rp-brand',createdAt:'2026-09-20T00:00:00.000Z',plan:{objective:'검증',businessType:'service',lookbackDays:30,targetCases:0,targetCompetitors:0,maxFollowups:2,questions:[],channels:[]}};
const parse=(x,existing=inputs)=>deep.parseDeepReport(x,research,existing);
const cited=out=>JSON.stringify({report:out.report,diagnosis:out.diagnosis});
const conflictDrops=(out,reason)=>out.salvage.dropped.filter(d=>d.reason===reason).map(d=>d.section+'#'+d.index).join();
const substance=out=>Object.entries(out.salvage.kept).reduce((n,[k,v])=>k==='sources'?n:n+v,0);

// 1) 같은 URL 재선언: 뺀 항목이 아니고 재선언 수로만 남는다. 인용은 입력 자료로 이어진다.
const off=parse(original());
check('same-URL re-declarations of input sources are not dropped items',!off.salvage.dropped.some(d=>['prev-channel-0','prev-customer-1'].includes(d.id)));
check('same-URL re-declarations are counted separately',off.salvage.redeclared===2);
check('citations of re-declared input sources stay linked to the stored input',off.report.customerSignals.length===1&&off.report.customerSignals[0].sourceId==='prev-customer-1'&&off.report.review.claims[0].sourceIds[0]==='prev-customer-1'&&['prev-channel-0','prev-customer-1'].every(id=>off.diagnosis.sourceIds.includes(id))&&off.report.access.some(a=>a.sourceId==='prev-channel-0'));
check('re-declared input sources are not stored again',JSON.stringify(off.sources.map(s=>s.url))==='["https://brand.example.com/menu"]');
const onlyRedeclared=parse(edit(original(),x=>{x.sources[2]=declare(inputs[2])}));
check('a report whose only issue is re-declaration drops nothing and keeps every item',onlyRedeclared.salvage.dropped.length===0&&onlyRedeclared.salvage.redeclared===3&&onlyRedeclared.report.customerSignals.length===2&&onlyRedeclared.diagnosis.opportunities.length===2);
check('re-declaration alone adds no lost-evidence quality issue',!onlyRedeclared.report.quality.issues.some(s=>s.startsWith(LOST))&&!onlyRedeclared.conflicts.length);
check('a clean report has no re-declaration count (salvage shape unchanged)',!('redeclared' in parse(edit(original(),x=>{x.sources.splice(0,3)})).salvage));

// 2) 다른 URL 재선언(입력 자료 번호 충돌): 근거를 옮겨 붙이지 않고 빼며, 사유가 충돌 원인을 말한다.
check('an input id re-declared with another URL drops its declaration and every citation with the cause in the reason',conflictDrops(off,REUSED)==='sources#2,access#0,customerSignals#0,review.claims#0,diagnosis.sourceIds#2,diagnosis.opportunities#0');
check('no kept item points at the conflicting id or its new URL',!cited(off).includes('prev-customer-2')&&!off.sources.some(s=>s.url===NEW_URL));
// 수리 요청에는 입력 자료의 제목·내용 발췌도 싣는다. 모델이 인용마다 입력 자료 근거인지 새 URL 근거인지 가려낼 수 있어야 한다(조사 출처는 원래 조사 입력에 원문으로 이미 보냈다).
const CONFLICT_INPUT={id:'prev-customer-2',reason:REUSED,inputUrl:'https://reviews.example.com/place/2',inputTitle:'customer-2 자료',inputExcerpt:'customer-2 관찰 근거',newUrls:[NEW_URL]};
check('the parser reports the conflict with the input URL, title, excerpt and the new URL for a repair request',JSON.stringify(off.conflicts)===JSON.stringify([CONFLICT_INPUT]));
const twin=parse(edit(original(),x=>{x.sources.splice(2,1,{...x.sources[3],id:'new-b',url:'https://one.example.com/a'},{...x.sources[3],id:'new-b',url:'https://two.example.com/b'});x.access[0].sourceId='new-b';x.customerSignals[0].sourceId='new-b';x.review.claims[0].sourceIds=['new-b'];x.diagnosis.sourceIds[2]='new-b';x.diagnosis.opportunities[0].sourceIds=['new-b']}));
check('two new sources sharing an id are dropped with their own cause',conflictDrops(twin,SHARED).startsWith('sources#2,sources#3,access#0')&&!cited(twin).includes('new-b'));
check('a new-source conflict is reported without an input URL',JSON.stringify(twin.conflicts)===JSON.stringify([{id:'new-b',reason:SHARED,newUrls:['https://one.example.com/a','https://two.example.com/b']}]));
const quiet=parse(edit(original(),x=>{x.access[0].sourceId='prev-customer-1';x.customerSignals.shift();x.review.claims.shift();x.diagnosis.sourceIds.splice(2,1);x.diagnosis.opportunities.shift()}));
check('a conflict that drops no real item (only the declaration) is not a repair candidate',conflictDrops(quiet,REUSED)==='sources#2'&&!quiet.conflicts.length);
// 사용자 제공 자료(업로드·직접 입력)는 모델 입력에서 가렸다. 그 번호의 충돌은 수리 대상이 아니다: 가린 자리표시 URL이 새 출처로 저장되거나 사용자 자료의 근거가 그리로 옮겨지지 않게, 지금처럼 빼기만 한다.
const manual=[inputs[0],inputs[1],{...inputs[2],origin:'manual'}],onManual=parse(original(),manual);
check('a conflict on a user-provided input is never a repair target (its URL was masked for the model)',!onManual.conflicts.length&&conflictDrops(onManual,REUSED)===conflictDrops(off,REUSED));
// URL 없는 입력 자료(업로드 등)를 URL 없이 다시 적은 것도 같은 자료의 재선언이다(새 출처는 URL이 필수라 다른 뜻이 없다). 다른 실제 URL로 다시 쓰면 여전히 충돌이다.
const upload={...input('upload-3','customer',''),origin:'upload'},withUpload=[...inputs,upload],askUpload=x=>x.customerSignals.push({sourceId:upload.id,kind:'question',observation:'업로드 설문 질문',implication:'확인'});
const bare=parse(edit(original(),x=>{x.sources.push(declare(upload));askUpload(x)}),withUpload);
check('re-declaring a URL-less input without a URL is a re-declaration, not a conflict',bare.salvage.redeclared===3&&!bare.salvage.dropped.some(d=>d.id===upload.id||d.section==='customerSignals'&&d.index===2)&&bare.report.customerSignals.some(s=>s.sourceId===upload.id)&&!bare.conflicts.some(c=>c.id===upload.id));
const bareShadow=parse(edit(original(),x=>{x.sources.push(declare(upload,'https://elsewhere.example.com/u'));askUpload(x)}),withUpload);
check('a URL-less input re-declared with a real URL is still a conflict',bareShadow.salvage.dropped.some(d=>d.section==='customerSignals'&&d.index===2&&d.reason===REUSED)&&!cited(bareShadow).includes(upload.id));
// 재선언은 뺀 항목이 아니므로 출처 최대 개수(40)와 뼈대 한도(80)에 세지 않는다. 한도를 넘은 새 출처는 원래 위치 기준으로 뺀다.
const many=n=>edit(original(),x=>{x.sources[2]=declare(inputs[2]);for(let i=0;i<n;i++){x.sources.push({...x.sources[3],id:'n'+i,url:'https://brand.example.com/p'+i});x.access.push(browse('n'+i))}});
const forty=parse(many(39));
check('re-declarations do not count toward the 40-source maximum',forty.sources.length===40&&!forty.salvage.dropped.length&&forty.salvage.redeclared===3);
const fortyOne=parse(many(40));
check('the 41st new source is still dropped at its own position',JSON.stringify(fortyOne.salvage.dropped.filter(d=>d.section==='sources'))===JSON.stringify([{section:'sources',index:43,id:'n39',reason:'최대 40개를 넘어 뺐습니다.'}])&&fortyOne.sources.length===40);
check('re-declarations do not count toward the 80-source size limit',caught(()=>parse(many(77)))===null);

// 3) 지어낸 근거(없는 번호)는 여전히 빠진다.
const ghost=parse(edit(original(),x=>{x.customerSignals.push({sourceId:'ghost-9',kind:'question',observation:'지어낸 관찰',implication:'함의'})}));
check('a citation of an id that exists nowhere is still dropped',ghost.salvage.dropped.some(d=>d.section==='customerSignals'&&d.index===2&&d.reason===GHOST)&&!cited(ghost).includes('ghost-9'));

// 4) 수리 응답 선택: 같은 검증기를 다시 통과하고, 원래보다 실질 항목을 덜 살리면 원래 결과를 쓴다. 뼈대 오류 원문은 수리 결과만 남는다.
const ORIGINAL=JSON.stringify(original()),REPAIRED=JSON.stringify(repaired());
const better=deep.parseRepairedText(REPAIRED,ORIGINAL,research,inputs);
check('a better repair keeps every real item and links the new URL to its new id',better.salvage.dropped.length===0&&better.report.customerSignals.length===2&&better.report.review.claims.length===2&&better.diagnosis.opportunities.length===2&&better.sources.some(s=>s.url===NEW_URL&&better.report.customerSignals[0].sourceId===s.id));
const WORSE=JSON.stringify(edit(repaired(),x=>{x.customerSignals=[];x.review.claims=[];x.diagnosis.opportunities.shift();x.diagnosis.sourceIds.splice(2,1);x.access.shift();x.sources.splice(2,1)}));
const worse=deep.parseRepairedText(WORSE,ORIGINAL,research,inputs);
check('a repair that keeps fewer real items loses to the original result',substance(worse)===substance(off)&&worse.report.customerSignals.length===1&&conflictDrops(worse,REUSED)===conflictDrops(off,REUSED));
check('a repair that fails validation falls back to the original result',deep.parseRepairedText('수리하지 못했습니다',ORIGINAL,research,inputs).report.customerSignals.length===1);
const SHAPE_BROKEN=JSON.stringify(edit(original(),x=>{x.phases[0]=null}));
const shapeFail=caught(()=>deep.parseRepairedText('수리하지 못했습니다',SHAPE_BROKEN,research,inputs));
check('when both fail the repair error is thrown (shape repair behaviour unchanged)',shapeFail instanceof deep.DeepReportShapeError&&shapeFail.message==='조사 응답 형식을 확인하지 못했습니다. 기록을 유지했으며 새 조사로 이어갈 수 있습니다.');
check('a shape repair still uses the repaired result',deep.parseRepairedText(REPAIRED,SHAPE_BROKEN,research,inputs).report.customerSignals.length===2);
const invent=x=>{x.sources.push({...x.sources[3],id:'new-9',url:FABRICATED});x.access.push(browse('new-9'));x.customerSignals.push({sourceId:'new-9',kind:'question',observation:'지어낸 관찰',implication:'함의'},{sourceId:'ghost-9',kind:'question',observation:'지어낸 관찰',implication:'함의'})};
const inventedShape=deep.parseRepairedText(JSON.stringify(edit(repaired(),invent)),SHAPE_BROKEN,research,inputs);
check('a shape repair cannot add a source that was not in the original response nor cite a missing id',inventedShape.salvage.dropped.some(d=>d.section==='sources'&&d.id==='new-9'&&d.reason===INVENTED)&&inventedShape.salvage.dropped.some(d=>d.reason===GHOST)&&!inventedShape.sources.some(s=>s.url===FABRICATED)&&!cited(inventedShape).includes('ghost-9')&&inventedShape.report.customerSignals.length===2);

// 4-1) 번호 수리 응답은 원래 응답과 대조한다. 원래와 다른 곳은 (a) 충돌 번호로 선언한 출처의 번호만 새 번호로 바꾼 것(URL은 그 충돌의 newUrls, 그 밖의 값 그대로)과
// (b) 충돌 번호 인용을 같은 충돌의 새 번호로 옮긴 것뿐이어야 한다. 그 밖(관찰값 변경, 원소 추가·삭제, 다른 출처로 옮긴 인용)이 하나라도 있으면 원래 결과를 쓴다.
// 충돌 번호에 남은 인용은 수리 뒤에도 원래 사유로 빠진다(입력 자료나 남은 출처로 이어 붙이지 않는다). 수리로 살아나는 것은 새 번호로 옮긴 인용뿐이다.
const repairOf=(change,base=ORIGINAL,from=repaired)=>deep.parseRepairedText(JSON.stringify(edit(from(),change)),base,research,inputs);
const isOriginal=out=>substance(out)===substance(off)&&conflictDrops(out,REUSED)===conflictDrops(off,REUSED)&&!out.sources.some(s=>s.url===NEW_URL);
const inventedConflict=repairOf(invent);
check('a numbering repair that adds a source or a citation is rejected as a whole',isOriginal(inventedConflict)&&!inventedConflict.sources.some(s=>s.url===FABRICATED));
const fabricated=repairOf(x=>{x.customerSignals.push({sourceId:'prev-customer-1',kind:'complaint',observation:'가격이 비싸다는 불만 다수',implication:'가격 조정'})});
check('a numbering repair that adds an observation citing a valid input is rejected (P1)',isOriginal(fabricated)&&!cited(fabricated).includes('가격이 비싸다'));
const rebound=repairOf(x=>{x.sources.splice(2,1);x.access.shift();x.customerSignals[0].sourceId='prev-customer-1';x.review.claims[0].sourceIds=['prev-customer-1'];x.diagnosis.sourceIds.splice(2,1);x.diagnosis.opportunities[0].sourceIds=['prev-customer-1']},ORIGINAL,original);
check('a numbering repair that moves conflicting citations onto another input is rejected (B)',isOriginal(rebound)&&!rebound.report.customerSignals.some(s=>s.observation==='배달 대기 불만')&&!rebound.diagnosis.opportunities.some(o=>o.title==='대기 안내'));
const elsewhere=repairOf(x=>{x.customerSignals[0].sourceId='prev-channel-0';x.review.claims[0].sourceIds=['prev-channel-0'];x.diagnosis.opportunities[0].sourceIds=['prev-channel-0']});
check('moving conflicting citations to an unrelated input is rejected even beside a valid re-numbering (P2)',isOriginal(elsewhere)&&!elsewhere.diagnosis.opportunities.some(o=>o.title==='대기 안내'));
const lazy=repairOf(x=>{x.sources.splice(2,1)},ORIGINAL,original);
check('deleting only the conflicting declaration does not bind its citations to the input (SEC-1 a)',isOriginal(lazy)&&!cited(lazy).includes('prev-customer-2'));
const clip={id:'v1',sourceId:'new-a',account:'@brand',channel:'instagram',relationship:'own',format:'video',publishedAt:at,observedAt:at,distribution:'organic',views:10,likes:1,comments:0,shares:0,durationSeconds:30,viewing:'full',viewedRanges:[{start:0,end:10}],timeline:[{second:1,observation:'첫 장면'}],hook:'h',message:'m',proof:'p',cta:'c',friction:'f',hypothesis:'hy',alternative:'al'};
const WITH_CLIP=JSON.stringify(edit(original(),x=>{x.cases=[clip]})),MISMATCH='전체 시청 기록이 영상 길이와 다릅니다.';
check('the original drops a clip whose full viewing does not match its length',parse(JSON.parse(WITH_CLIP)).salvage.dropped.some(d=>d.section==='cases'&&d.reason===MISMATCH));
const retimed=repairOf(x=>{x.cases=[{...clip,durationSeconds:10}]},WITH_CLIP);
check('a numbering repair that changes an observed value to pass validation is rejected (A)',!retimed.report.cases.length&&retimed.salvage.dropped.some(d=>d.section==='cases'&&d.reason===MISMATCH)&&retimed.report.customerSignals.length===1&&!retimed.sources.some(s=>s.url===NEW_URL));
const trade=repairOf(x=>{x.customerSignals=[];x.review.unresolved=Array.from({length:8},(_,i)=>'확인 필요 '+i)});
check('a repair that loses a real item cannot win with free-text unresolved items (H2)',isOriginal(trade)&&trade.report.customerSignals.length===1&&!trade.report.review.unresolved.length);
// 번호만 바꾼 수리라도 원래 결과가 살린 항목을 잃으면 쓰지 않는다: 새 번호가 다른 새 출처(new-c)와 같은 URL이면 new-c와 그 고객 관찰 2개가 빠진다. 합계는 늘어도 원래 결과를 쓴다.
const DUP=JSON.stringify(edit(original(),x=>{x.sources.push({...x.sources[3],id:'new-c',url:NEW_URL});x.access.push(browse('new-c'));x.customerSignals.push(...[1,2].map(i=>({sourceId:'new-c',kind:'question',observation:'커뮤니티 질문 '+i,implication:'확인'})))}));
const dupBefore=parse(JSON.parse(DUP)),dupRepair=repairOf(()=>{},DUP,()=>edit(JSON.parse(DUP),x=>{x.sources[2].id='new-1';x.access[0].sourceId='new-1';x.customerSignals[0].sourceId='new-1';x.review.claims[0].sourceIds=['new-1'];x.diagnosis.sourceIds[2]='new-1';x.diagnosis.opportunities[0].sourceIds=['new-1']}));
check('a re-numbering that loses items the original kept is not used even with more items in total (H2)',dupBefore.report.customerSignals.length===3&&substance(dupRepair)===substance(dupBefore)&&dupRepair.report.customerSignals.length===3);
check('a numbering repair whose new sources would exceed the archive room falls back to the original (L4)',isOriginal(deep.parseRepairedText(REPAIRED,ORIGINAL,research,inputs,{room:1})));
check('a numbering repair is not accepted unchecked when the original no longer validates',caught(()=>deep.parseRepairedText(REPAIRED,SHAPE_BROKEN,research,inputs,{conflict:true})) instanceof deep.DeepReportShapeError);
// 새 출처끼리 같은 번호(new-b 두 URL). 접근 기록이 둘 다 new-b를 가리킨다.
const TWIN=JSON.stringify(edit(original(),x=>{x.sources.splice(2,1,{...x.sources[3],id:'new-b',url:'https://one.example.com/a'},{...x.sources[3],id:'new-b',url:'https://two.example.com/b'});x.access[0].sourceId='new-b';x.customerSignals[0].sourceId='new-b';x.review.claims[0].sourceIds=['new-b'];x.diagnosis.sourceIds[2]='new-b';x.diagnosis.opportunities[0].sourceIds=['new-b'];x.access.push(browse('new-b'))}));
const twinOf=change=>repairOf(change,TWIN,()=>JSON.parse(TWIN)),ONE='https://one.example.com/a',TWO='https://two.example.com/b';
const oneLeft=twinOf(x=>{x.sources.splice(3,1)});
check('deleting one of two declarations sharing an id does not bind its citations to the other URL (SEC-1 b)',!oneLeft.sources.some(s=>s.url===ONE)&&oneLeft.report.customerSignals.length===1&&conflictDrops(oneLeft,SHARED).startsWith('sources#2,sources#3'));
const partly=twinOf(x=>{x.sources[3].id='new-2';x.access[3].sourceId='new-2';x.review.claims[0].sourceIds=['new-2']}),two=partly.sources.find(s=>s.url===TWO);
check('citations left on a conflicting id stay dropped after a re-numbering; only moved ones revive (SEC-1 carried)',!!two&&partly.report.review.claims.some(c=>c.sourceIds.includes(two.id))&&!partly.sources.some(s=>s.url===ONE)&&!partly.report.customerSignals.some(s=>s.observation==='배달 대기 불만')&&partly.salvage.dropped.some(d=>d.section==='customerSignals'&&d.reason===SHARED));
const split=twinOf(x=>{x.sources[2].id='new-1';x.sources[3].id='new-2';x.access[0].sourceId='new-1';x.access[3].sourceId='new-2';x.customerSignals[0].sourceId='new-1';x.review.claims[0].sourceIds=['new-2'];x.diagnosis.sourceIds[2]='new-1';x.diagnosis.opportunities[0].sourceIds=['new-1']});
check('a full re-numbering of a shared id revives every moved citation on its own URL',!split.salvage.dropped.length&&JSON.stringify(split.sources.map(s=>s.url).sort())===JSON.stringify(['https://brand.example.com/menu',ONE,TWO].sort()));

// 5) 지시문: 입력 자료는 이미 보관된 출처이고, 결과 sources에는 새 출처만, 입력 자료는 번호 그대로 인용, 새 번호는 입력 번호와 겹치지 않게.
const rule=deep.deepInstructions;
check('the deep research prompt says input sources are already stored and must not be re-declared',rule.includes('입력 sources의 자료는 이미 보관된 출처입니다')&&rule.includes('결과 sources에는 이번에 새로 확인한 출처만')&&rule.includes('다시 선언하지 말고 그 id를 그대로 인용')&&rule.includes('입력 자료 id와 겹치지 않는 새 값(예: new-1)'));
check('the deep research prompt keeps its security and author-privacy rules',rule.split('\n').find(l=>l.startsWith('보안:')).includes(stages.authorPrivacy)&&['게시','결제','인증정보 노출'].every(w=>rule.includes(w)));
check('stage research prompts say input sources are already stored',['identity','customer','channel'].every(s=>stages.archiveResearchInstructions(s,'deep').includes('입력 sources는 이미 보관된 출처'))&&!stages.archiveResearchInstructions('customer','classify').includes('입력 sources는 이미 보관된 출처'));

// 6) 실행 경로(모의 HERMES). 대화형 심층 조사는 단계 1개(investigation)다: start → advance(제출) → advance(결과 처리).
const brand={id:'rp-brand',name:'가상피자',short:'GP',category:'PIZZA',color:'#224466',bg:'#eef2f6',description:'합성 소개(미확인).',audience:'가상동 주민(가설)',tone:'명료한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:'합성 메모.'};
async function setup(owner,repairTurn){
 sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:HERMES,key:'mock-only'})),'HERMES',now);
 await server.recordStatement(owner,'brand',brand.id,brand).run();
 for(const s of inputs)await server.recordStatement(owner,'brand_source',s.id,s,brand.id).run();
 if(repairTurn)await flags.setFeatureFlag(owner,{flag:'a7_repair_turn',enabled:true},{id:owner,email:null});
}
async function start(owner,id,output){nextOutput=output;await exec.executeResearch(owner,{action:'start',id,brandId:brand.id});await exec.executeResearch(owner,{action:'advance',id})}
async function step(owner,id,action='advance'){const res=await exec.executeResearch(owner,{action,id});return {body:await res.json(),saved:await server.readRecord(owner,'brand_research',id)}}
const row=(owner,kind,id)=>{const r=sql.prepare('SELECT data,parent_id FROM records WHERE id=? AND owner=? AND kind=?').get(`${owner}:${kind}:${id}`,owner,kind);return r?{...JSON.parse(r.data),parent:r.parent_id}:undefined};
const usageOf=(owner,runId)=>row(owner,'provider_usage','hermes:'+runId);
const repairPosts=()=>posts.filter(p=>p.repair).length;
const stored=owner=>sql.prepare("SELECT json_extract(data,'$.url') u FROM records WHERE owner=? AND kind='brand_source'").all(owner).map(r=>r.u).sort();
const kept=saved=>[saved.report.access.length,saved.report.customerSignals.length,saved.report.review.claims.length];

// 6a) 스위치 꺼짐: 수리 없이 완료. 재선언은 뺀 항목이 아니고, 충돌 인용은 원인을 말하는 사유로 빠진다.
{
 const owner='ev-off',id='ev-off-1';await setup(owner,false);
 await start(owner,id,ORIGINAL);const before=posts.length;
 const {body,saved}=await step(owner,id);
 check('switch off: the research completes with the safe exclusion and sends no repair',saved.status==='completed'&&posts.length===before&&!('repair' in saved.steps[0])&&!row(owner,'hermes_submission',id+'-investigation:repair'));
 check('switch off: re-declarations are counted, not dropped, and returned to the screen',saved.salvage.redeclared===2&&body.salvage.redeclared===2&&!saved.salvage.dropped.some(d=>d.id==='prev-channel-0'||d.id==='prev-customer-1'));
 check('switch off: items citing the conflicting id are dropped with the cause',conflictDrops(saved,REUSED)==='sources#2,access#0,customerSignals#0,review.claims#0,diagnosis.sourceIds#2,diagnosis.opportunities#0'&&!JSON.stringify(saved.report).includes('prev-customer-2'));
 check('switch off: only the genuinely new source is stored',JSON.stringify(stored(owner))===JSON.stringify([...inputs.map(s=>s.url),'https://brand.example.com/menu'].sort()));
}

// 6b) 스위치 켬 + 충돌로 실질 항목이 빠짐 → 같은 경로(고정 제출 id, 예산 가드)로 번호 수리 1회. 수리 응답이 실질 항목을 모두 살린다.
{
 const owner='ev-on',id='ev-on-1',stepId=id+'-investigation';await setup(owner,true);
 await start(owner,id,ORIGINAL);repairOutput=REPAIRED;
 const originalRun=(await server.readRecord(owner,'brand_research',id)).steps[0].providerId,before=posts.length,repairsBefore=repairPosts();
 let {body,saved}=await step(owner,id);
 const sub=row(owner,'hermes_submission',stepId+':repair'),request=sub&&JSON.parse(sub.body),payload=request&&JSON.parse(request.input);
 check('switch on: a conflict that drops real items sends exactly one repair under the fixed id',!!sub&&posts.length===before+1&&repairPosts()===repairsBefore+1&&posts.at(-1).key===sub.key);
 check('the repair names each conflicting id with its cause, input URL, title, excerpt and new URL',JSON.stringify(payload.conflicts)===JSON.stringify([CONFLICT_INPUT])&&payload.errors.length===1&&payload.errors[0].includes('prev-customer-2')&&payload.original===ORIGINAL&&JSON.stringify([...payload.allowedSourceIds].sort())===JSON.stringify(inputs.map(s=>s.id).sort()));
 check('the repair tells the model to re-declare with a new id and keep the security rules',/새 id/.test(request.instructions)&&/conflicts/.test(request.instructions)&&/새 조사/.test(request.instructions)&&['게시','댓글','메시지','결제','계정/보안 설정 변경','인증정보 노출'].every(w=>request.instructions.includes(w)));
 check('the repair says only ids may change and citations left on a conflicting id stay excluded',request.instructions.includes('원소를 추가·삭제·재배열하지 말고')&&request.instructions.includes('충돌 id에 남은 인용은')&&!request.instructions.includes('입력 자료를 근거로 쓴 인용은 원래 id를 그대로 두고, 입력 자료는 결과 sources에 다시 선언하지 마세요'));
 const reservation=row(owner,'token_reservation',stepId+':repair');
 check('the conflict repair passed the token budget guard',!!reservation&&reservation.kind==='research'&&reservation.submissionId===stepId+':repair');
 check('while repairing nothing is stored yet and the note names the numbering repair',saved.status==='running'&&saved.steps[0].repair?.status==='sent'&&saved.steps[0].repair.kind==='conflict'&&/번호/.test(saved.error)&&/수리/.test(saved.error)&&body.error===saved.error&&!row(owner,'brand_diagnostic',id)&&stored(owner).length===3);
 check('the original run is closed as usable output, not invalid',usageOf(owner,originalRun).domainOutcome==='completed');
 ({body,saved}=await step(owner,id));
 const newId=`${id}-e2-0`;
 check('after the repair every real item is kept and nothing is dropped',saved.status==='completed'&&JSON.stringify(kept(saved))==='[3,2,2]'&&saved.salvage.dropped.length===0&&saved.salvage.redeclared===2&&row(owner,'brand_diagnostic',id).opportunities.length===2&&row(owner,'brand_diagnostic',id).sourceIds.length===4);
 check('the new URL is stored as its own candidate source and cited by its new id only',stored(owner).includes(NEW_URL)&&row(owner,'brand_source',newId)?.url===NEW_URL&&row(owner,'brand_source',newId).status==='candidate'&&saved.report.customerSignals[0].sourceId===newId&&saved.report.customerSignals[1].sourceId==='prev-customer-1');
 check('the repaired report is no longer held back for lost evidence',!saved.report.quality.issues.some(s=>s.startsWith(LOST)));
 check('the repair run is in the ledger with the repair role and the reservation is settled',usageOf(owner,byKey.get(sub.key)).role==='investigation_repair'&&!row(owner,'token_reservation',stepId+':repair')&&saved.tokens===20);
 check('no raw result is kept and no further submission is made',saved.steps[0].rawResult===undefined&&posts.length===before+1);
}

// 6c) 수리 응답이 원래보다 나쁘면(실질 항목 감소) 원래 결과를 쓴다. 검증을 통과하지 못한 수리 응답도 원래 결과로 끝난다(실패로 만들지 않는다).
for(const [label,output] of [['keeps fewer items',WORSE],['is not JSON','수리하지 못했습니다']]){
 const owner='ev-worse-'+label.length,id=owner+'-1';await setup(owner,true);
 await start(owner,id,ORIGINAL);repairOutput=output;
 await step(owner,id);const {saved}=await step(owner,id);
 check(`a repair that ${label} leaves the original salvaged result`,saved.status==='completed'&&JSON.stringify(kept(saved))==='[2,1,1]'&&conflictDrops(saved,REUSED).startsWith('sources#2,access#0')&&row(owner,'brand_diagnostic',id).opportunities.length===1&&repairPosts()>0);
}

// 6d) 수리 턴은 조사당 1회다. 뼈대 오류 수리와 한도를 나눠 쓴다.
{
 const owner='ev-shape-first',id='ev-shape-first-1';await setup(owner,true);
 await start(owner,id,SHAPE_BROKEN);repairOutput=ORIGINAL;const before=repairPosts();
 let {saved}=await step(owner,id);
 check('a shape error takes the one repair turn',repairPosts()===before+1&&saved.steps[0].repair?.status==='sent'&&!saved.steps[0].repair.kind);
 ({saved}=await step(owner,id));
 check('conflicts in the shape repair response do not trigger a second repair',repairPosts()===before+1&&saved.status==='completed'&&conflictDrops(saved,REUSED).startsWith('sources#2')&&saved.salvage.redeclared===2);
}
{
 const owner='ev-twice',id='ev-twice-1';await setup(owner,true);
 await start(owner,id,ORIGINAL);repairOutput=ORIGINAL;const before=repairPosts();
 await step(owner,id);const {saved}=await step(owner,id);await step(owner,id,'recover');
 check('a conflict repair that still conflicts completes without a second repair',repairPosts()===before+1&&saved.status==='completed'&&conflictDrops(saved,REUSED).startsWith('sources#2'));
}

// 6e) 번호 수리 응답이 출처·인용을 더하거나 관찰값을 바꾸면 수리 전체를 쓰지 않고 원래 구제 결과를 저장한다.
for(const [label,change] of [['adds an invented source and a missing-id citation',invent],['changes nothing but adds an observation',x=>{x.customerSignals.push({sourceId:'prev-customer-1',kind:'complaint',observation:'가격이 비싸다는 불만 다수',implication:'가격 조정'})}]]){
 const owner='ev-invent-'+label.length,id=owner+'-1';await setup(owner,true);
 await start(owner,id,ORIGINAL);repairOutput=JSON.stringify(edit(repaired(),change));
 await step(owner,id);const {saved}=await step(owner,id);
 check(`a numbering repair that ${label} leaves the original salvaged result`,saved.status==='completed'&&JSON.stringify(kept(saved))==='[2,1,1]'&&!stored(owner).includes(FABRICATED)&&!stored(owner).includes(NEW_URL)&&!JSON.stringify(saved.report).includes('가격이 비싸다')&&conflictDrops(saved,REUSED).startsWith('sources#2,access#0'));
}

// 6f) 수리를 보내지 못하거나 수리가 결과 없이 끝나면 지금의 안전한 제외 결과 그대로 완료한다(예산 가드 409, 입력 상한, HERMES 실행 실패, 복구 중 확정 거절).
{
 const owner='ev-budget',id='ev-budget-1';await setup(owner,true);
 await start(owner,id,ORIGINAL);
 await budget.setTokenBudget(server.database(),owner,{scope:'workspace',monthlyTokens:1},{id:owner,email:null});
 const before=posts.length,originalRun=(await server.readRecord(owner,'brand_research',id)).steps[0].providerId;
 const {saved}=await step(owner,id);
 check('a budget-blocked conflict repair sends nothing and completes with the safe exclusion',posts.length===before&&saved.status==='completed'&&!saved.error&&saved.steps[0].repair?.status==='blocked'&&/토큰 예산 초과/.test(saved.steps[0].repair.reason)&&JSON.stringify(kept(saved))==='[2,1,1]'&&!!row(owner,'brand_diagnostic',id));
 check('the blocked conflict repair keeps the original run linked and completed',saved.steps[0].providerId===originalRun&&usageOf(owner,originalRun).domainOutcome==='completed'&&saved.steps[0].rawResult===undefined);
}
{
 const owner='ev-large',id='ev-large-1';await setup(owner,true);
 await start(owner,id,JSON.stringify(edit(original(),x=>{x.notes='가'.repeat(62000)})));const before=posts.length;
 const {saved}=await step(owner,id);
 check('over the repair input cap the conflict repair is skipped and the safe result is kept',posts.length===before&&saved.status==='completed'&&saved.steps[0].repair?.status==='skipped'&&JSON.stringify(kept(saved))==='[2,1,1]');
}
{
 const owner='ev-failed',id='ev-failed-1';await setup(owner,true);
 await start(owner,id,ORIGINAL);repairOutput=REPAIRED;repairStatus='failed';
 await step(owner,id);const {saved}=await step(owner,id);repairStatus='completed';
 const repairRun=byKey.get(row(owner,'hermes_submission',id+'-investigation:repair').key);
 check('a repair run that fails on HERMES leaves the original salvaged result',saved.status==='completed'&&!saved.error&&JSON.stringify(kept(saved))==='[2,1,1]'&&!!row(owner,'brand_diagnostic',id)&&saved.steps[0].rawResult===undefined);
 check('the failed repair run is recorded as a provider failure',usageOf(owner,repairRun).domainOutcome==='provider_failed');
}
{
 const owner='ev-recover',id='ev-recover-1';await setup(owner,true);
 await start(owner,id,ORIGINAL);repairOutput=REPAIRED;postMode='lost';
 let {saved}=await step(owner,id);
 check('a lost conflict repair acceptance waits for recovery',saved.status==='uncertain'&&saved.steps[0].repair?.status==='sent');
 const originalRun=byKey.get(row(owner,'hermes_submission',id+'-investigation').key);
 check('the lost repair acceptance left a repair reservation',!!row(owner,'token_reservation',id+'-investigation:repair'));
 postMode='reject';({saved}=await step(owner,id,'recover'));postMode='ok';
 check('a definitive rejection while recovering keeps the original salvaged result',saved.status==='completed'&&saved.steps[0].repair?.status==='blocked'&&JSON.stringify(kept(saved))==='[2,1,1]'&&!!row(owner,'brand_diagnostic',id));
 // L1: 거절된 수리는 실행이 없다. 단계는 원래 실행을 다시 가리키고, 첫 시도(응답 유실)가 만든 수리 예약은 풀린다.
 check('the rejected repair relinks the original run and releases its reservation',saved.steps[0].providerId===originalRun&&!row(owner,'token_reservation',id+'-investigation:repair'));
}
{
 // 3·L3: 번호 수리 중 중지하면 수리 실행만 멈추고, 이미 검증을 통과한 원래 결과를 저장해 완료한다(스위치를 끈 것과 같은 결과).
 const owner='ev-cancel',id='ev-cancel-1';await setup(owner,true);
 await start(owner,id,ORIGINAL);repairOutput=REPAIRED;repairStatus='running';
 await step(owner,id);let {saved}=await step(owner,id);repairStatus='completed';
 check('the numbering repair is still running before the stop request',saved.status==='running'&&saved.steps[0].repair?.status==='sent');
 const repairRun=byKey.get(row(owner,'hermes_submission',id+'-investigation:repair').key);
 ({saved}=await step(owner,id,'cancel'));
 check('stopping during a numbering repair keeps the original salvaged result',saved.status==='completed'&&!saved.error&&JSON.stringify(kept(saved))==='[2,1,1]'&&!!row(owner,'brand_diagnostic',id)&&saved.steps[0].rawResult===undefined&&!stored(owner).includes(NEW_URL));
 check('the stopped repair run is closed as cancelled',usageOf(owner,repairRun).domainOutcome==='cancelled');
}
{
 // M1: 복구 중 원래 결과 저장이 일시 오류로 실패하면 조사 기록을 바꾸지 않는다(원래 응답 보존, 다음 복구로 완료).
 const owner='ev-flaky',id='ev-flaky-1';await setup(owner,true);
 await start(owner,id,ORIGINAL);repairOutput=REPAIRED;postMode='lost';
 await step(owner,id);
 postMode='reject';failDiagnostic=1;let {saved}=await step(owner,id,'recover');
 check('a failed save while keeping the original leaves the step unfinished with its raw result',saved.status==='uncertain'&&saved.steps[0].status!=='completed'&&saved.steps[0].rawResult===ORIGINAL&&saved.steps[0].repair?.status==='sent'&&!row(owner,'brand_diagnostic',id));
 ({saved}=await step(owner,id,'recover'));postMode='ok';
 check('the next recovery keeps the original salvaged result',saved.status==='completed'&&saved.steps[0].repair?.status==='blocked'&&JSON.stringify(kept(saved))==='[2,1,1]'&&!!row(owner,'brand_diagnostic',id));
}
{
 const owner='ev-clean',id='ev-clean-1';await setup(owner,true);
 await start(owner,id,JSON.stringify(edit(original(),x=>{x.sources[2]=declare(inputs[2])})));const before=posts.length;
 const {saved}=await step(owner,id);
 check('re-declaration without a conflict never triggers a repair',posts.length===before&&saved.status==='completed'&&!('repair' in saved.steps[0])&&saved.salvage.dropped.length===0&&saved.salvage.redeclared===3);
}

// 7) 화면: '뺀 항목'에서 같은 URL 재선언을 빼고, 있으면 '기존 자료 재선언 N건(인용 유지)'을 따로 한 줄로 보인다.
const context=createContext({console}),cache=new Map(),stub=names=>Object.fromEntries(names.map(n=>[n,()=>null]));
const packages={react:React,'react/jsx-runtime':jsxRuntime,'@/components/ui/button':stub(['Button']),'lucide-react':stub(['ExternalLink','RefreshCw','Search','TriangleAlert'])};
const synthetic=name=>{const ns=packages[name],keys=Object.keys(ns);return new SyntheticModule(keys,function(){for(const k of keys)this.setExport(k,ns[k])},{context,identifier:name})};
function moduleFor(path){if(cache.has(path))return cache.get(path);const m=packages[path]?synthetic(path):new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{fileName:path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText,{context,identifier:path});cache.set(path,m);return m}
const local=(spec,from)=>{const base=spec.startsWith('@/')?resolve(spec.slice(2)):resolve(dirname(from),spec);for(const ext of ['.ts','.tsx'])if(existsSync(base+ext))return base+ext;throw new Error('cannot resolve '+spec)};
async function loadUi(path){const m=moduleFor(resolve(path));if(m.status==='unlinked')await m.link((spec,ref)=>moduleFor(packages[spec]?spec:local(spec,ref.identifier)));if(m.status!=='evaluated')await m.evaluate();return m.namespace}
const {SalvageNote}=await loadUi('app/deep-research-panel.tsx');
const view=salvage=>renderToStaticMarkup(React.createElement(SalvageNote,{salvage})).replace(/<!-- -->/g,'');
const both=view({dropped:[{section:'customerSignals',index:0,reason:REUSED}],kept:{sources:1},redeclared:11});
check('the note counts only real drops and shows re-declarations on their own line',both.includes('살린 출처 1 · 뺀 항목 1')&&both.includes('기존 자료 재선언 11건(인용 유지)')&&both.includes('고객 관찰 1번째 · '+REUSED));
const onlyRe=view({dropped:[],kept:{sources:0},redeclared:2});
check('re-declarations alone show just their line, not an empty dropped list',onlyRe.includes('기존 자료 재선언 2건(인용 유지)')&&!onlyRe.includes('뺀 항목'));
check('no drops and no re-declarations render nothing',view({dropped:[],kept:{}})===''&&view(undefined)==='');
check('drops without re-declarations keep the previous note',view({dropped:[{section:'sources',index:0,reason:GHOST}],kept:{sources:0}}).includes('뺀 항목 1')&&!view({dropped:[{section:'sources',index:0,reason:GHOST}],kept:{sources:0}}).includes('재선언'));

check('no external destination was called',external.length===0);
console.log(JSON.stringify({passed}));

// 결정 인박스 v2(GLOBAL-PLAN X1): 홈 안건 집계가 기존 성장 출처 외에 작업물 검토 대기·발행 승인/접수 대기·회의/연속 실행 확인 대기·자료 요청 열림을 '결정 대기'로,
// 브리프 확인 질문·회의 확인할 사실을 '질문'으로 모은다. 보관 캠페인·다른 상태·캠페인 없는 기록은 빠진다. 화면 순수 규칙(탭 필터·미루기·자판·순차 일괄 승인)도 함께 검사한다.
// 근거: mocked(메모리 SQLite, 합성 기록). 모델·외부 호출 0회.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const rt=testRuntime(async()=>{throw new Error('외부 호출 없음')});
const s=await rt.load('lib/server.ts'),m=await rt.load('lib/agenda-server.ts'),c=await rt.load('lib/agenda-client.ts'),t=await rt.load('lib/agenda-types.ts');
const owner='inbox-owner',actor={owner,id:owner,email:null,role:'owner'},now=Date.parse('2026-11-09T03:00:00.000Z'),before='2026-11-01T00:00:00.000Z';
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const put=(kind,id,data,parent='')=>s.recordStatement(owner,kind,id,data,parent).run();
// 캠페인 2개: 운영 중(c1, 지점 있음)·보관(c2). 지점 이름은 '어디'에 보인다.
await put('campaign','c1',{id:'c1',title:'가을 캠페인',version:3,brandId:'ofd',storeId:'st1',status:'approved',startDate:'2026-11-01',endDate:'2026-12-31',updatedAt:before});
await put('campaign','c2',{id:'c2',title:'보관 캠페인',version:1,brandId:'ofd',archivedAt:before,updatedAt:before});
await put('store','st1',{id:'st1',brandId:'ofd',name:'성수 지점',status:'active'},'ofd');
// 작업물: 검토 대기(현재 브리프)·검토 대기(이전 브리프 버전)·승인 완료·보관 캠페인의 검토 대기.
await put('artifact','a1',{id:'a1',campaignId:'c1',campaignVersion:3,role:'strategy',title:'브랜드 방향 v2',content:'…',status:'review',version:2,origin:'ai',createdAt:before},'c1');
await put('artifact','a2',{id:'a2',campaignId:'c1',campaignVersion:2,role:'content',title:'이전 브리프 카피',content:'…',status:'review',version:1,origin:'ai',createdAt:before},'c1');
await put('artifact','a3',{id:'a3',campaignId:'c1',campaignVersion:3,role:'cmo',title:'승인됨',content:'…',status:'approved',version:1,origin:'ai',createdAt:before},'c1');
await put('artifact','a4',{id:'a4',campaignId:'c2',campaignVersion:1,role:'cmo',title:'보관 캠페인 작업물',content:'…',status:'review',version:1,origin:'ai',createdAt:before},'c2');
// 발행: 초안(비용 3,000원)·승인됨(접수 대기)·AI 카피 초안(행 안 승인 제외)·게시됨.
const pub=(id,extra)=>({id,campaignId:'c1',campaignVersion:3,creativeId:'cr1',creativeVersion:1,pngHash:'a'.repeat(64),factRefs:[],caption:'대표 메뉴 안내\n\n주문할 때 코드',mediaUrl:'',mediaMode:'auto',scheduledAt:'2026-11-12T03:00:00.000Z',plannedCostKRW:0,version:1,status:'draft',createdAt:before,...extra});
await put('execution_publication','p1',pub('p1',{plannedCostKRW:3000}),'c1');
await put('execution_publication','p2',pub('p2',{status:'approved',channelId:'ig-main',version:2}),'c1');
await put('execution_publication','p3',pub('p3',{copy:{artifactId:'a3',artifactVersion:1,index:0,text:'카피',aiGenerated:true}}),'c1');
await put('execution_publication','p4',pub('p4',{status:'published',version:4}),'c1');
// 회의: 접수 불확실 단계가 있는 진행 중 회의·종합 질문이 있는 끝난 회의.
await put('team_meeting','m1',{id:'m1',campaignId:'c1',campaignVersion:3,agenda:'약점 검토',status:'running',steps:[{id:'m1:discussion:cmo',role:'cmo',phase:'discussion',status:'uncertain'}],createdAt:before,updatedAt:before},'c1');
await put('team_meeting','m2',{id:'m2',campaignId:'c1',campaignVersion:3,agenda:'개선안',status:'completed',steps:[{id:'m2:synthesis',role:'cmo',phase:'synthesis',status:'completed',output:{decisions:'…',disagreements:'…',questions:'실제 제품 가격 확인',tasks:[]}}],createdAt:before,updatedAt:before},'c1');
// 연속 실행: 품질 검수 지적으로 멈춤(needs_review).
await put('campaign_sequence','c1',{campaignId:'c1',campaignVersion:3,status:'needs_review',startedAt:before,updatedAt:before,error:'독립 품질 검수에서 수정 또는 자료 확인이 필요합니다.',fixes:[{role:'content',fix:'가격 확인'},{role:'growth',fix:'채널 근거'}]},'c1');
// 자료 요청: 캠페인 범위 열림·닫힘·브랜드 범위(캠페인 없음).
await put('data_request','d1',{id:'d1',brandId:'ofd',storeId:'st1',campaignId:'c1',status:'open',factKey:'price',label:'판매 가격',text:'실제 판매 가격 확인',assignee:'매장 담당',version:1,createdAt:before,updatedAt:before},'ofd');
await put('data_request','d2',{id:'d2',brandId:'ofd',campaignId:'c1',status:'closed',factKey:null,label:'닫힘',text:'…',version:2,createdAt:before,updatedAt:before},'ofd');
await put('data_request','d3',{id:'d3',brandId:'ofd',status:'open',factKey:null,label:'브랜드 범위',text:'…',version:1,createdAt:before,updatedAt:before},'ofd');
// 브리프 초안: 기존 캠페인 수정 초안(질문 2개, 미저장)·저장된 초안(질문 있어도 제외).
await put('brief_draft','b1',{id:'b1',status:'completed',campaignId:'c1',input:{},result:{summary:'…',suggestions:[],questions:[{field:'kpi',question:'목표 지표는 무엇인가요?',why:'…'},{field:'budgetPlan',question:'예산 상한은?',why:'…'}],assumptions:[],contextUsed:[]},createdAt:before,updatedAt:before,model:'m'});
await put('brief_draft','b2',{id:'b2',status:'completed',campaignId:'c1',savedCampaignId:'c1',input:{},result:{summary:'…',suggestions:[],questions:[{field:'kpi',question:'저장됨',why:'…'}],assumptions:[],contextUsed:[]},createdAt:before,updatedAt:before,model:'m'});
// 기존 성장 출처 하나(확대 제안)도 그대로 남는지 본다.
await put('growth_expansion','x1',{id:'x1',campaignId:'c1',status:'proposed',version:1,input:{title:'확대 제안'}},'c1');

const agenda=await m.agenda(actor,now);
const byId=Object.fromEntries(agenda.items.map(i=>[i.id,i]));
check(agenda.counts.decision===9,`결정 대기 9건(작업물 2·발행 3·회의 1·연속 실행 1·자료 요청 1·확대 제안 1): ${agenda.counts.decision}`);
check(agenda.counts.question===2&&agenda.tabs.ask===2,'질문 2건(브리프·회의)');
check(agenda.tabs.decide===9&&agenda.tabs.notify===0,'탭 합계: 결정 9·알림 0');
check(agenda.total===11&&agenda.items.length===11,'항목 11건');
const a1=byId['artifact:a1'];
check(a1&&a1.kind==='decision'&&a1.source==='artifact'&&a1.title==='브랜드 전략 작업물 검토 대기'&&a1.detail==='브랜드 방향 v2'&&a1.ctab==='outputs','작업물 검토 대기 행');
check(a1.action?.type==='review_artifact'&&a1.action.recordId==='a1'&&a1.action.version===2&&a1.action.role==='strategy','현재 브리프 작업물은 행 안 승인·수정 요청 동작이 있다');
check(a1.where.includes('Old Ferry Donut')&&a1.where.includes('성수 지점'),`어디: 브랜드·지점 이름 ${JSON.stringify(a1.where)}`);
check(byId['artifact:a2']&&!byId['artifact:a2'].action,'이전 브리프 버전의 검토 대기는 보이되 행 안 승인은 없다(서버 409와 같은 조건)');
check(!byId['artifact:a3']&&!byId['artifact:a4'],'승인 완료·보관 캠페인 작업물은 빠진다');
const p1=byId['publication:p1'];
check(p1&&p1.title==='발행 승인 대기'&&p1.cost===3000&&p1.due==='2026-11-12T03:00:00.000Z'&&p1.section==='execute'&&p1.ctab==='execution'&&p1.detail==='대표 메뉴 안내','발행 승인 대기 행: 비용·예약·캡션 첫 줄');
check(p1.action?.type==='approve_publication'&&p1.action.version===1&&p1.action.aiCopy===false&&p1.action.codedPng===false,'초안 발행은 행 안 승인 동작이 있다');
check(byId['publication:p2']?.title==='승인한 발행 접수 대기'&&!byId['publication:p2'].action&&byId['publication:p2'].where.includes('계정 ig-main'),'승인된 발행은 접수 대기(열기만)·계정 표시');
check(byId['publication:p3']?.action?.aiCopy===true&&!c.approvable(byId['publication:p3']),'AI 카피 발행은 일괄 승인 대상이 아니다');
check(!byId['publication:p4'],'게시된 발행은 빠진다');
check(byId['meeting:m1']?.title==='회의 진행 확인 대기'&&byId['meeting:m1'].ctab==='meeting','접수 불확실 단계가 있는 회의');
check(byId['meeting-question:m2']?.kind==='question'&&byId['meeting-question:m2'].detail==='실제 제품 가격 확인','끝난 회의의 확인할 사실은 질문');
check(byId['sequence:c1']?.title==='연속 실행 검수 확인 대기'&&byId['sequence:c1'].detail==='수정 요청 2건','연속 실행 needs_review');
const d1=byId['data_request:d1'];
check(d1&&d1.title==='자료 요청 열림'&&d1.detail==='판매 가격'&&d1.section==='prepare'&&d1.where.includes('담당 매장 담당'),'자료 요청 열림 행');
check(!byId['data_request:d2']&&!byId['data_request:d3'],'닫힌 요청·캠페인 없는 브랜드 범위 요청은 빠진다');
check(byId['brief-question:b1']?.title==='브리프 확인 질문 2개'&&byId['brief-question:b1'].detail==='목표 지표는 무엇인가요?','브리프 확인 질문');
check(!byId['brief-question:b2'],'저장된 초안의 질문은 빠진다');
check(byId['growth_expansion:x1']?.kind==='decision','기존 성장 출처(확대 제안)는 그대로');
// 정렬: 결정 → 질문. 결정 안에서는 기한 있는 것(발행 예약)이 먼저다.
check(agenda.items.findIndex(i=>i.kind==='question')>agenda.items.findLastIndex(i=>i.kind==='decision'),'질문은 결정 뒤에 온다');
check(agenda.items[0].id==='publication:p1'||agenda.items[0].id==='publication:p2','기한(예약 시각) 있는 결정이 먼저');
// 기록 형식이 깨져도 집계는 멈추지 않는다.
await s.database().prepare("INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)").bind(`${owner}:artifact:broken`,owner,'artifact','c1','{not json',before).run();
await put('artifact','a5',{id:'a5',campaignId:'c1',role:'quality',status:'review',version:'x',title:7},'c1');
const again=await m.agenda(actor,now);
check(again.total===12&&again.items.find(i=>i.id==='artifact:a5')&&!again.items.find(i=>i.id==='artifact:a5').action,'깨진 JSON은 건너뛰고 형식이 이상한 작업물은 열기만 한다');
// 화면 순수 규칙: 탭 필터·미루기·자판·순차 일괄 승인.
check(t.agendaTabOf('overdue')==='decide'&&t.agendaTabOf('question')==='ask'&&t.agendaTabOf('signal')==='notify'&&t.agendaTabOf('upcoming')==='notify','종류 → 탭');
const store=new Map(),storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
const snoozed=c.snooze({},'artifact:a1',now);c.writeSnoozes(storage,snoozed);
check(c.readSnoozes(storage,now)['artifact:a1']&&!Object.keys(c.readSnoozes(storage,now+c.SNOOZE_MS+1)).length,'미루기는 24시간 뒤 풀린다');
check(c.visibleItems(agenda.items,'decide',snoozed).length===8&&c.visibleItems(agenda.items,'ask',{}).length===2&&c.visibleItems(agenda.items,null,{}).length===11,'탭 필터와 미루기 적용');
check(Object.keys(c.readSnoozes({getItem(){throw new Error('blocked')}},now)).length===0&&Object.keys(c.readSnoozes(undefined,now)).length===0,'저장소 오류·없음은 미루기 없음');
check(c.inboxKey('j')==='next'&&c.inboxKey('K')==='prev'&&c.inboxKey('a')==='approve'&&c.inboxKey('r')==='changes'&&c.inboxKey('h')==='snooze'&&c.inboxKey(' ')==='open'&&c.inboxKey('x')===null,'자판 뜻');
check(c.moveIndex(-1,1,3)===0&&c.moveIndex(-1,-1,3)===2&&c.moveIndex(2,1,3)===2&&c.moveIndex(0,-1,3)===0&&c.moveIndex(0,1,0)===-1,'행 이동 경계');
const batch=agenda.items.filter(c.approvable);
check(batch.length===2&&c.costSum(batch)===3000,`일괄 승인 대상 2건(작업물·초안 발행), 비용 합계 3,000원: ${batch.map(i=>i.id)}`);
const calls=[];const results=await c.runSequentially(batch,async i=>{calls.push(i.id);if(i.id==='artifact:a1')throw new Error('작업물이 수정됐습니다.')});
const failed=results.find(r=>r.id==='artifact:a1'),okRes=results.find(r=>r.id==='publication:p1');
check(calls.length===2&&failed?.ok===false&&failed.message==='작업물이 수정됐습니다.'&&okRes?.ok===true,`한 건이 실패해도 다음 건을 계속하고 건별 결과를 남긴다: ${JSON.stringify({calls,results})}`);
check(c.batchSummary(results)==='1건을 승인했습니다. 1건은 처리하지 못했습니다.','일괄 결과 요약 문장');
console.log(JSON.stringify({passed}));

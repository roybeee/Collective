// 레인 X-G: 홈 '오늘의 안건'에 캠페인 밖 출처를 더한다. 알림 = 이번 달 크레딧 알림(높은 단계 하나)·카카오 재동의 안내(new)·최근 7일 GEO 측정 완료/실패,
// 결정 = 승인 대기 플레이스 초안·광고 제안(어디 = 브랜드·지점). 범위 역할은 배정 브랜드·지점 안의 항목만, 요금·재동의는 받지 않는다. 범위 없는 역할의 기존 항목은 그대로다.
// 근거: mocked(메모리 SQLite, 합성 기록, 로컬 인증 헤더). 모델·외부 호출 0회.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const rt=testRuntime(async()=>{throw new Error('외부 호출 없음')});
const s=await rt.load('lib/server.ts'),m=await rt.load('lib/agenda-server.ts'),w=await rt.load('lib/agenda-workspace-sources.ts'),route=await rt.load('app/api/agenda/route.ts');
const owner='ws-owner',actor={owner,id:owner,email:null,role:'owner'},now=Date.parse('2026-11-09T03:00:00.000Z'),before='2026-11-01T00:00:00.000Z';
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const put=(kind,id,data,parent='')=>s.recordStatement(owner,kind,id,data,parent).run();
await put('campaign','c1',{id:'c1',title:'가을 캠페인',version:3,brandId:'ofd',storeId:'s1',status:'approved',updatedAt:before});
await put('campaign','c2',{id:'c2',title:'다른 브랜드',version:1,brandId:'oda',status:'approved',updatedAt:before});
await put('store','s1',{id:'s1',brandId:'ofd',name:'성수 지점',status:'active'},'ofd');
await put('store','s2',{id:'s2',brandId:'oda',name:'강남 지점',status:'active'},'oda');
// 크레딧 알림: 이번 달 80%·100%(100%만 보임), 지난달 100%(빠짐).
await put('billing_alert','2026-11-80',{id:'2026-11-80',month:'2026-11',level:80,kind:'signal',title:'크레딧 80% 사용',detail:'이번 달 크레딧의 80%를 썼습니다.',createdAt:before});
await put('billing_alert','2026-11-100',{id:'2026-11-100',month:'2026-11',level:100,kind:'signal',title:'크레딧 모두 사용',detail:'이번 달 크레딧을 모두 썼습니다.',createdAt:before});
await put('billing_alert','2026-10-100',{id:'2026-10-100',month:'2026-10',level:100,kind:'signal',title:'지난달',detail:'…',createdAt:before});
// 재동의 안내: new(보임)·acknowledged(빠짐).
await put('kakao_reconsent_notice','reconsent:ofd:2026-11-09',{id:'reconsent:ofd:2026-11-09',brandId:'ofd',campaignId:null,version:1,status:'new',detection:{kind:'kakao_reconsent',title:'카카오 마케팅 수신 재동의 확인 3명',detail:'23개월 경과 2명, 2년 만료(전송 차단) 1명.',dueBy:'2026-11-30',recipientHashes:[]},detectedAt:before,updatedAt:before},'ofd');
await put('kakao_reconsent_notice','reconsent:ofd:2026-11-01',{id:'reconsent:ofd:2026-11-01',brandId:'ofd',status:'acknowledged',detection:{title:'지난 안내',detail:'',dueBy:'2026-11-30'}},'ofd');
// GEO 측정: 완료(최근)·일부 실패(최근)·실행 중(빠짐)·오래된 완료(빠짐).
const job=(i,status)=>({id:`j${i}`,questionId:'q',questionText:'질문',locale:'ko',engine:'chatgpt',status});
await put('geo_run','g1',{id:'g1',brandId:'ofd',campaignId:'c1',status:'completed',jobs:[job(1,'completed'),job(2,'completed')],createdAt:before,updatedAt:'2026-11-08T00:00:00.000Z'},'ofd');
await put('geo_run','g2',{id:'g2',brandId:'ofd',campaignId:'c1',status:'completed',jobs:[job(1,'completed'),job(2,'failed')],createdAt:before,updatedAt:'2026-11-09T00:00:00.000Z'},'ofd');
await put('geo_run','g3',{id:'g3',brandId:'ofd',campaignId:'c1',status:'running',jobs:[job(1,'pending')],createdAt:before,updatedAt:'2026-11-09T00:00:00.000Z'},'ofd');
await put('geo_run','g4',{id:'g4',brandId:'ofd',campaignId:'c1',status:'completed',jobs:[job(1,'completed')],createdAt:before,updatedAt:'2026-10-01T00:00:00.000Z'},'ofd');
await put('geo_run','g5',{id:'g5',brandId:'ofd',campaignId:'c1',status:'cancelled',jobs:[job(1,'cancelled')],createdAt:before,updatedAt:'2026-11-09T00:00:00.000Z'},'ofd');
// 플레이스 초안: 승인 대기(s1·s2)·승인됨(빠짐).
const draft=(id,storeId,brandId,status,kind='review_reply')=>({id,storeId,brandId,kind,status,version:1,source:null,news:null,draft:{text:'소중한 후기를 남겨 주셔서 감사합니다.',template:'t',sentiment:'positive',style:'formal',edited:false,factRefs:[],voiceVersion:null},compliance:{issues:[],blocking:false,checkedAt:before,lexicon:'v'},history:[],createdAt:before,createdBy:owner,updatedAt:before});
await put('place_draft','pd1',draft('pd1','s1','ofd','draft'),'s1');
await put('place_draft','pd2',draft('pd2','s2','oda','draft','news_post'),'s2');
await put('place_draft','pd3',draft('pd3','s1','ofd','approved'),'s1');
// 광고 제안: 네이버 초안(브랜드 ofd)·당근 초안(지점 s1)·반려(빠짐).
const prop=(id,extra)=>({id,channel:'naver_ads',campaignId:'ncc-1',storeId:null,brandId:null,kind:'bid',riskTier:'T2',status:'draft',label:'추정·규칙 기반, 자동 적용 없음',target:{type:'keyword',ids:['k1'],names:['떡볶이']},diff:{before:{},after:{}},operation:{},rationale:{text:'',evidence:{}},createdAt:before,createdBy:owner,history:[],...extra});
await put('ads_proposal','ap1',prop('ap1',{brandId:'ofd'}),'');
await put('ads_proposal','ap2',prop('ap2',{channel:'daangn_ads',campaignId:'dg-9',kind:'budget',brandId:'ofd',storeId:'s1'}),'s1');
await put('ads_proposal','ap3',prop('ap3',{status:'rejected'}),'');

const all=await m.agenda(actor,now),by=id=>all.items.find(i=>i.id===id),ids=all.items.map(i=>i.id);
const bill=by('billing_alert:2026-11-100');
check(bill&&bill.kind==='signal'&&bill.source==='billing'&&bill.nav?.view==='settings'&&bill.nav.section==='usage'&&bill.campaignId==='','this month credit alert lands in 알림 and opens settings usage');
check(!ids.includes('billing_alert:2026-11-80')&&!ids.includes('billing_alert:2026-10-100'),'only the highest level of this month is shown');
const kakao=by('kakao_reconsent:reconsent:ofd:2026-11-09');
check(kakao&&kakao.kind==='signal'&&kakao.due==='2026-11-30'&&kakao.where.includes('Old Ferry Donut')&&kakao.nav?.section==='channels','new reconsent notice is a 알림 with brand and due date');
check(!ids.includes('kakao_reconsent:reconsent:ofd:2026-11-01'),'acknowledged reconsent notice is left out');
check(by('geo_run:g1')?.title==='AI 검색 노출 측정 완료'&&by('geo_run:g1').detail==='완료 2/2건'&&by('geo_run:g1').ctab===undefined&&by('geo_run:g1').section==='evidence'&&by('geo_run:g1').panel==='조건부 확장(GEO·해외·MMM)','completed GEO run is a 알림 that opens the growth evidence panel');
check(by('geo_run:g2')?.title==='AI 검색 노출 측정 일부 실패'&&by('geo_run:g2').detail==='완료 1/2건, 실패 1건','partial failure is named');
check(by('geo_run:g5')?.title==='AI 검색 노출 측정 실패','cancelled run is a failure');
check(!ids.includes('geo_run:g3')&&!ids.includes('geo_run:g4'),'running and older-than-7-days runs are left out');
const pd=by('place_draft:pd1');
check(pd&&pd.kind==='decision'&&pd.title==='플레이스 리뷰 답글 승인 대기'&&pd.where.join('|')==='Old Ferry Donut|성수 지점'&&pd.nav?.view==='stores'&&pd.nav.store==='s1'&&pd.nav.tab==='channels','place draft awaiting approval is a 결정 with brand·store');
check(by('place_draft:pd2')?.title==='플레이스 소식 승인 대기'&&!ids.includes('place_draft:pd3'),'news draft shown, approved draft left out');
const naver=by('ads_proposal:ap1'),daangn=by('ads_proposal:ap2');
check(naver?.title==='네이버 검색광고 제안 승인 대기'&&naver.detail==='입찰가 변경: 떡볶이'&&naver.where.includes('광고 캠페인 ncc-1')&&naver.kind==='decision','naver proposal draft is a 결정 with the ad campaign');
check(daangn?.title==='당근 광고 제안 승인 대기'&&daangn.where.join('|')==='Old Ferry Donut|성수 지점|광고 캠페인 dg-9'&&!ids.includes('ads_proposal:ap3'),'daangn proposal shows brand·store, rejected proposal left out');
check(all.tabs.notify>=5&&all.tabs.decide>=4,`tabs count the new sources ${JSON.stringify(all.tabs)}`);
// 순수 함수 경계: 형식이 다르면 건너뛴다.
check(w.placeDraftItem({id:'x',status:'draft'},{brand:x=>x,store:x=>x||''})===null&&w.adsProposalItem({status:'draft'},{brand:x=>x,store:x=>x||''})===null&&w.billingAlertItems([{id:'a',month:'2026-11',level:50}],'2026-11').length===0,'malformed records are skipped');

// 범위 역할: 브랜드 매니저(ofd)는 ofd 캠페인·초안·제안만, 요금·재동의 없음. 점포 매니저(s1)는 s1 초안·당근 제안(s1)만(브랜드 단위 네이버 제안은 지점이 없어 publish 불가).
const bm=await m.agenda(actor,now,{role:'brand_manager',brandIds:['ofd'],storeIds:[]}),bmIds=bm.items.map(i=>i.id);
check(bmIds.includes('place_draft:pd1')&&!bmIds.includes('place_draft:pd2')&&bmIds.includes('ads_proposal:ap1')&&bmIds.includes('ads_proposal:ap2'),'brand manager sees only the assigned brand drafts and proposals');
check(!bmIds.some(i=>i.startsWith('billing_alert:')||i.startsWith('kakao_reconsent:')),'brand manager gets no workspace-wide billing or reconsent items');
check(bmIds.includes('geo_run:g1')&&!bm.items.some(i=>i.campaignId==='c2'),'brand manager keeps campaign items of the assigned brand only');
const sm=await m.agenda(actor,now,{role:'store_manager',brandIds:['ofd'],storeIds:['s1']}),smIds=sm.items.map(i=>i.id);
check(smIds.includes('place_draft:pd1')&&smIds.includes('ads_proposal:ap2')&&!smIds.includes('ads_proposal:ap1')&&!smIds.includes('place_draft:pd2'),'store manager sees only the assigned store items');
const rv=await m.agenda(actor,now,{role:'reviewer',brandIds:['ofd'],storeIds:[]}),rvIds=rv.items.map(i=>i.id);
check(!rvIds.some(i=>i.startsWith('place_draft:')||i.startsWith('ads_proposal:')||i.startsWith('billing_alert:')),'reviewer gets no publish or billing items');
// 범위 없는 역할(직원 포함)은 주체를 넘겨도 같은 목록이다.
const member=await m.agenda(actor,now,{role:'member',brandIds:[],storeIds:[]});
check(JSON.stringify(member.items.map(i=>i.id))===JSON.stringify(ids),'unscoped principal sees the same agenda');
// 경로: 로그인 헤더로 GET하면 대표 범위 목록이 온다.
const r=await route.GET(new Request('https://agency.test/api/agenda',{headers:{'oai-authenticated-user-id':owner}}));const body=await r.json();
check(r.status===200&&body.items.some(i=>i.id==='place_draft:pd1'),`route returns the agenda with new sources (${r.status})`);
console.log(JSON.stringify({passed}));

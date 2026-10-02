import {test,expect,type Browser,type Locator,type Page,type TestInfo} from '@playwright/test';
import {appendFileSync,mkdirSync,readFileSync} from 'node:fs';
import {seedTask1,seedTask2,seedTask3,seedTask4,seedTask5,seedTask6,seedTask7,seedTask8,taskContext} from './helpers/ux-task-seeds';
// UX-PLAN-3 Q0·10.5 과업 하네스: 핵심 8과제를 홈(/)에서 실제 사용자처럼 수행하고 성공·클릭 수·입력 칸 수·소요 시간을 잰다.
// 측정 구간에서는 page.goto를 쓰지 않는다(시작 page.goto('/')만). 준비 데이터는 e2e/helpers/ux-task-seeds.ts(API·로컬 D1 fixture)로 넣고 측정에 넣지 않는다.
// 같은 8과제의 키보드만 판은 e2e/ux-keyboard-tasks.spec.ts다.
// 클릭 수는 tests/ux-tasks.json 예산 이하여야 한다(래칫). 결과는 annotation과 e2e/artifacts/ux-tasks.jsonl에 남긴다.
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출·광고비 지출 없음.
const budget=JSON.parse(readFileSync('tests/ux-tasks.json','utf8')) as {version:number;tasks:Record<string,{name:string;clicks:Record<string,number>;baseline:unknown}>};
// 측정기: click·check·press는 클릭 1회, fill·selectOption은 입력 칸 1개. 시간은 첫 측정 동작부터 done()까지.
function meter(page:Page){
 let clicks=0,fields=0,start=0;const path:string[]=[],begin=()=>{if(!start)start=Date.now()};
 return {
  click:async(l:Locator,name:string)=>{begin();await l.click();clicks++;path.push(name)},
  // 이미 선택된 칸(미리 채운 기본값)은 사람이 누르지 않으므로 세지 않는다.
  check:async(l:Locator,name:string)=>{begin();if(await l.isChecked()){path.push(`${name}(미리 선택됨)`);return}await l.check();clicks++;path.push(name)},
  press:async(key:string)=>{begin();await page.keyboard.press(key);clicks++;path.push(`[${key}]`)},
  fill:async(l:Locator,value:string)=>{begin();await l.fill(value);fields++},
  select:async(l:Locator,value:string|{label:string})=>{begin();await l.selectOption(value);fields++},
  done:()=>({clicks,fields,ms:Date.now()-start,path}),
 };
}
type Meter=ReturnType<typeof meter>;
async function setup(browser:Browser,info:TestInfo,n:number){
 const t=await taskContext(browser,info,'tasks',n);
 return {...t,m:meter(t.page)};
}
// 기록·예산 확인. 클릭 수는 예산 이하(래칫).
function report(info:TestInfo,n:number,m:Meter){
 const {clicks,fields,ms,path}=m.done(),name=budget.tasks[n].name,line=JSON.stringify({task:n,name,clicks,fields,ms,project:info.project.name,path});
 info.annotations.push({type:'ux-task',description:line});mkdirSync('e2e/artifacts',{recursive:true});appendFileSync('e2e/artifacts/ux-tasks.jsonl',line+'\n');
 expect(clicks,`과업 ${n} 클릭 수 예산 초과: ${path.join(' → ')}`).toBeLessThanOrEqual(budget.tasks[n].clicks[info.project.name]);
}
// 홈의 최근 캠페인 표에서 캠페인을 연다(사이드바·목록을 거치지 않는 최단 경로).
const openCampaign=(page:Page,m:Meter,title:string)=>m.click(page.getByRole('button',{name:title+' 열기',exact:true}),title+' 열기');
const agendaRow=(page:Page,title:string)=>page.getByRole('region',{name:'오늘의 안건',exact:true}).getByRole('button',{name:new RegExp(title)}).first();
// 성장 탭 접기 패널. 안건 행이 이미 그 패널을 열어 두었으면 사용자는 누르지 않는다(그때는 세지 않는다).
async function openPanel(page:Page,m:Meter,text:string){
 const summary=page.locator('summary').filter({hasText:new RegExp(`^${text}$`)});await expect(summary).toBeVisible();
 if(!await summary.evaluate(e=>(e.parentElement as HTMLDetailsElement).open))await m.click(summary,text);
}

test('과업 1: 오늘 안건 처리',async({browser},info)=>{
 const {owner,context,page,post,get,m}=await setup(browser,info,1);
 try{
  const {campaignId}=await seedTask1({owner,post},info.project.name);
  await page.goto('/');const agenda=page.getByRole('region',{name:'오늘의 안건',exact:true});
  await m.click(agenda.getByRole('button',{name:'최근 7일 유료 주문 증가 내가 맡기',exact:true}),'최근 7일 유료 주문 증가 내가 맡기');
  await expect(agenda.getByRole('status')).toContainText('1건을 맡았습니다.');
  const {signals}=await get(`/api/growth/detections?campaignId=${campaignId}`) as {signals:{status:string;detection:{title:string}}[]};
  expect(signals.find(s=>s.detection.title==='최근 7일 유료 주문 증가')?.status).toBe('acknowledged');
  report(info,1,m);
 }finally{await context.close()}
});

test('과업 2: 상품·오퍼·미션 만들기',async({browser},info)=>{
 const {owner,context,page,post,get,m}=await setup(browser,info,2);
 try{
  const {campaignId,title}=await seedTask2({owner,post},info.project.name);
  await page.goto('/');
  await openCampaign(page,m,title);await m.click(page.getByRole('tab',{name:'성장·판매',exact:true}),'성장·판매');
  const panel=page.getByRole('region',{name:'판매 기본 기록',exact:true}),saved=panel.getByRole('status').filter({hasText:'서버에 저장했습니다.'});
  // 상품: 근거·니즈가 있으면 빈 첫 단계(상품)에서 열리고, 확정 사실이 하나면 미리 연결된다.
  await expect(panel.getByRole('navigation',{name:'성장 작업 단계'}).getByRole('button',{name:'상품',exact:true})).toHaveAttribute('aria-pressed','true');
  await m.fill(panel.getByLabel('SKU',{exact:true}),'T2-SKU');await m.fill(panel.getByLabel('상품명',{exact:true}),'과업 상품');await m.fill(panel.getByLabel('판매 단가 (원)',{exact:true}),'12000');
  await m.check(panel.getByRole('checkbox',{name:/^과업 상품: 근거/}),'확정 사실 연결');
  const advanced=panel.getByRole('status').filter({hasText:/서버에 저장했습니다\. 이어서/});
  await m.click(panel.getByRole('button',{name:'저장하고 다음: 판매 오퍼',exact:true}),'저장하고 다음: 판매 오퍼');await expect(advanced).toBeVisible();
  // 오퍼: 하나뿐인 상품·니즈가 미리 연결되고 단가는 상품 판매가로 채워진다.
  await expect(panel.getByRole('combobox',{name:'연결 상품',exact:true})).toHaveValue(/.+/);await expect(panel.getByLabel('오퍼 단가 (원)',{exact:true})).toHaveValue('12000');
  await m.fill(panel.getByLabel('오퍼명',{exact:true}),'과업 오퍼');
  await m.click(panel.getByRole('button',{name:'저장하고 다음: 판매 미션',exact:true}),'저장하고 다음: 판매 미션');await expect(advanced).toContainText('판매 오퍼를');
  // 미션: 하나뿐인 오퍼가 미리 연결된다.
  await expect(panel.getByRole('combobox',{name:'연결 판매 오퍼',exact:true})).toHaveValue(/.+/);
  await m.fill(panel.getByLabel('미션 제목',{exact:true}),'과업 미션');
  await m.click(panel.getByRole('button',{name:'판매 미션 저장',exact:true}),'판매 미션 저장');await expect(saved).toBeVisible();
  const v=await get(`/api/growth?campaignId=${campaignId}`) as {catalogs:{id:string;input:{sku:string}}[];offers:{id:string;input:{catalogId:string;title:string}}[];missions:{input:{offerId:string;title:string}}[]};
  const catalog=v.catalogs.find(c=>c.input.sku==='T2-SKU'),offer=v.offers.find(o=>o.input.title==='과업 오퍼');
  expect(catalog).toBeTruthy();expect(offer?.input.catalogId).toBe(catalog!.id);expect(v.missions.find(x=>x.input.title==='과업 미션')?.input.offerId).toBe(offer!.id);
  report(info,2,m);
 }finally{await context.close()}
});

test('과업 3: 고객 문의 기한 처리',async({browser},info)=>{
 const {owner,context,page,post,get,m}=await setup(browser,info,3);
 try{
  const {campaignId,id}=await seedTask3({owner,post},info.project.name);
  await page.goto('/');
  await m.click(agendaRow(page,'고객 문의 약속 기한 초과'),'안건: 고객 문의 약속 기한 초과');
  await openPanel(page,m,'고객 문의·약속 기한');
  const panel=page.getByRole('region',{name:'고객 문의 처리',exact:true});
  // 안건에서 온 문의는 처리 기록 칸이 이미 열려 있다.
  await expect(panel.getByRole('combobox',{name:'처리 종류',exact:true})).toBeVisible();
  await m.select(panel.getByRole('combobox',{name:'처리 종류',exact:true}),'resolve');await m.select(panel.getByRole('combobox',{name:'해결 방법',exact:true}),'shipped');await m.fill(panel.getByRole('textbox',{name:'처리 증빙 ID',exact:true}),'ship-1');
  await m.click(panel.getByRole('button',{name:'처리 저장',exact:true}),'처리 저장');
  await expect(panel.getByRole('status').filter({hasText:'처리를 기록했습니다'})).toBeVisible();await expect(panel).toContainText('미해결 0건, 기한 초과 0건');
  const {tickets}=await get(`/api/growth/cs?campaignId=${campaignId}`) as {tickets:{id:string;status:string}[]};
  expect(tickets.find(t=>t.id===id)?.status).toBe('resolved');
  report(info,3,m);
 }finally{await context.close()}
});

test('과업 4: 확대 제안 승인',async({browser},info)=>{
 const {owner,context,page,post,get,m}=await setup(browser,info,4);
 try{
  const {campaignId,id}=await seedTask4({owner,post},info.project.name);
  await page.goto('/');
  await m.click(agendaRow(page,'확대 제안 승인 대기'),'안건: 확대 제안 승인 대기');
  await openPanel(page,m,'검증된 확대·예산 예약');
  const panel=page.getByRole('region',{name:'검증된 확대',exact:true});
  // 활성 위임이 하나뿐이면 미리 골라져 있다.
  await expect(panel.getByRole('combobox',{name:'예약에 쓸 활성 위임',exact:true})).toHaveValue('x-auth');
  await m.click(panel.getByRole('button',{name:`${id} 소유자 승인·예약`,exact:true}),`${id} 소유자 승인·예약`);
  await expect(panel.getByRole('status').filter({hasText:'확대 예산을 예약했습니다'})).toBeVisible();await expect(panel).toContainText('확대 예약 200원, 원장 reserved');
  const {proposals}=await get(`/api/growth/expansion?campaignId=${campaignId}`) as {proposals:{id:string;status:string;commitment?:{status:string}}[]};
  const p=proposals.find(x=>x.id===id);expect(p?.status).toBe('reserved');expect(p?.commitment?.status).toBe('reserved');
  report(info,4,m);
 }finally{await context.close()}
});

test('과업 5: Meta 준비 점검',async({browser},info)=>{
 const {owner,context,page,post,get,m}=await setup(browser,info,5);
 try{
  const {campaignId,title}=await seedTask5({owner,post},info.project.name);
  await page.goto('/');
  await openCampaign(page,m,title);await m.click(page.getByRole('tab',{name:'Meta 광고 준비',exact:true}),'Meta 광고 준비');
  const panel=page.getByRole('region',{name:'Meta 광고 준비'});
  // 네 단계가 한 화면에 모두 보여 단계 이동 없이 채운다.
  await m.fill(panel.getByLabel('상품·오퍼',{exact:true}),'합성 상품 1개');await m.fill(panel.getByLabel('판매가 (원)',{exact:true}),'12000');await m.fill(panel.getByLabel('상품 원가 (원)',{exact:true}),'4000');await m.fill(panel.getByLabel('건당 변동비 (원)',{exact:true}),'2000');
  await m.fill(panel.getByLabel('총 광고 예산 (원)',{exact:true}),'60000');
  await m.check(panel.getByRole('checkbox',{name:'재고·제공 가능 수량 확인',exact:true}),'재고·제공 가능 수량 확인');
  await m.click(panel.getByRole('button',{name:'준비 계획 저장',exact:true}),'준비 계획 저장');
  await expect(panel.getByRole('status')).toContainText('준비 계획을 저장했습니다');
  const v=await get(`/api/meta-ads?campaignId=${campaignId}`) as {plan:{input:{price:number;totalBudget:number;checks:{inventory:boolean}}}|null};
  expect(v.plan?.input.checks.inventory).toBe(true);expect(v.plan?.input.price).toBe(12000);expect(v.plan?.input.totalBudget).toBe(60000);
  report(info,5,m);
 }finally{await context.close()}
});

test('과업 6: 발행 승인',async({browser},info)=>{
 const {owner,context,page,post,get,m}=await setup(browser,info,6);
 try{
  const {campaignId,id}=await seedTask6({owner,post},info.project.name);
  await page.goto('/');
  await m.click(agendaRow(page,'상세페이지 수정안 승인 대기'),'안건: 상세페이지 수정안 승인 대기');
  await openPanel(page,m,'상세페이지 수정안·적용 확인');
  const panel=page.getByRole('region',{name:'상세페이지 수정안',exact:true});
  await m.click(panel.getByRole('button',{name:`${id} 승인`,exact:true}),`${id} 승인`);
  await expect(panel.getByRole('status').filter({hasText:'페이지는 아직 바뀌지 않았습니다'})).toBeVisible();
  const {proposals}=await get(`/api/growth/landing?campaignId=${campaignId}`) as {proposals:{id:string;status:string}[]};
  expect(proposals.find(p=>p.id===id)?.status).toBe('approved');
  report(info,6,m);
 }finally{await context.close()}
});

test('과업 7: 주간 성과 확인',async({browser},info)=>{
 const {owner,context,page,post,m}=await setup(browser,info,7);
 try{
  // 직전 주와 최근 7일(오늘 포함) 성과 기록 두 건.
  const {title,day}=await seedTask7({owner,post},info.project.name);
  await page.goto('/');
  await openCampaign(page,m,title);await m.click(page.getByRole('tab',{name:'성과',exact:true}),'성과');
  const row=page.getByRole('region',{name:'기간별 성과 비교',exact:true}).getByRole('row').filter({hasText:`${day(6)} ~ ${day(0)}`});
  await expect(row).toBeVisible();await expect(row).toContainText('538,000원');
  report(info,7,m);
 }finally{await context.close()}
});

test('과업 8: 전역 중단과 재개',async({browser},info)=>{
 const {owner,context,page,post,get,mobile,m}=await setup(browser,info,8);
 try{
  await seedTask8({owner,post},info.project.name);
  await page.goto('/');
  if(mobile)await m.click(page.locator('[data-sidebar="trigger"]').first(),'사이드바 열기');
  await m.click(page.getByRole('button',{name:'연결 및 설정',exact:true}),'연결 및 설정');
  // 모바일 사이드바는 메뉴를 눌러도 열린 채로 남으면 사용자가 닫아야 한다(그때만 센다).
  // 메뉴는 고르면 스스로 닫힌다(닫히는 동작을 잠시 기다린다). 그래도 남아 있으면 사람이 닫는다.
  const sheet=page.locator('[data-sidebar="sidebar"][data-mobile="true"]');if(mobile){await sheet.waitFor({state:'hidden',timeout:1500}).catch(()=>{});if(await sheet.isVisible())await m.press('Escape');}
  const panel=page.getByRole('region',{name:'전역 실행 중단',exact:true}),reason=panel.getByRole('textbox',{name:'중단·재개 사유',exact:true});
  await m.fill(reason,'외부 집행 경로 점검');await m.click(panel.getByRole('button',{name:'모든 신규 실행 중단',exact:true}),'모든 신규 실행 중단');
  await expect(panel.getByRole('status')).toContainText('중단 요청을 기록했습니다.');
  expect((await get('/api/growth/stop')).state.status).toBe('stopped');
  await m.fill(reason,'점검 완료');await m.click(panel.getByRole('button',{name:'소유자로서 실행 재개',exact:true}),'소유자로서 실행 재개');
  await expect(panel.getByRole('status')).toContainText('재개 요청을 기록했습니다.');
  const v=await get('/api/growth/stop');expect(v.state.status).toBe('running');expect(v.state.version).toBe(2);
  report(info,8,m);
 }finally{await context.close()}
});

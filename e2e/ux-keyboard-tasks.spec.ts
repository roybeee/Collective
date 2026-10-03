import {test,expect,type Locator,type Page,type TestInfo} from '@playwright/test';
import {seedTask1,seedTask2,seedTask3,seedTask4,seedTask5,seedTask6,seedTask7,seedTask8,taskContext} from './helpers/ux-task-seeds';
// UX-PLAN-3 ⑨ 접근성: 정의된 핵심 8과제(tests/ux-tasks.json, e2e/ux-tasks.spec.ts와 같은 과제·준비 데이터·성공 조건)를 키보드만으로 수행한다.
// 시작 page.goto('/') 뒤에는 page.keyboard(Tab·Shift+Tab·Enter·Space·Escape·화살표·글자 입력·/ 바로 가기)만 쓴다. 마우스·locator.click/check/fill 없음. locator는 초점 확인·대기에만 쓴다.
// 과제별 키 수(글자 입력 제외)를 annotation에 남기고, 측정값+50% 상한으로 회귀를 잡는다.
// 모바일(390×844)도 8과제 모두 돈다(휴대폰·태블릿에 하드웨어 키보드를 붙인 경우, 평가 10회차 ⑧·⑨). 모바일은 모바일 배치의 입구를 쓴다:
//  바로 가기는 머리 띠의 '검색' 버튼을 Tab·Enter로 열고(과제 2·5·7), 과제 8은 메뉴 버튼으로 사이드바 시트를 열어 Escape로 닫혔다가 다시 열고 '연결 및 설정'을 고른다.
// 두 화면 모두 키를 누를 때마다 초점이 body로 빠지지 않고, 화면 안에 있으며, 고정·sticky 띠에 가려지지 않는지 본다(WCAG 2.4.7·2.4.11).
// 이 검사가 처음 찾은 결함(2026-10-02): 저장 중 잠기거나 목록에서 빠진 버튼의 초점이 body로 떨어짐(8과제 중 7과제, lib/ui/focus-keeper.ts),
//  모바일 메뉴 시트를 Escape로 닫으면 초점이 body로 떨어짐·메뉴로 화면을 옮기면 새 제목이 초점을 못 받음(components/ui/sidebar.tsx·app/workspace.tsx),
//  데스크톱 캠페인 탭 줄·섹션 칩과 설정 바로가기 밑에 초점이 숨음(app/globals.css --sticky-top).
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출·광고비 지출 없음.
// 측정(2026-10-02, 데스크톱): 1=10 2=69 3=22 4=21 5=63 6=23 7=13 8=16. 상한은 측정값+50%(올림).
// 측정(2026-10-02, 모바일): 1=11 2=72 3=23 4=22 5=66 6=24 7=16 8=34(메뉴 시트 열기·Escape 닫기·다시 열기 포함).
const ceiling:Record<'desktop'|'mobile',Record<number,number>>={desktop:{1:15,2:104,3:33,4:32,5:95,6:35,7:20,8:24},mobile:{1:17,2:108,3:35,4:33,5:99,6:36,7:24,8:51}};
const describe=(e:Element|null)=>{if(!e)return '(없음)';const h=e as HTMLElement,name=(h.getAttribute('aria-label')||(h as HTMLInputElement).labels?.[0]?.textContent||h.textContent||'').replace(/\s+/g,' ').trim().slice(0,50);return `${h.tagName.toLowerCase()}${h.getAttribute('role')?'['+h.getAttribute('role')+']':''} ${name}`};
// 초점이 보이는가: body로 빠짐, 화면 밖, 고정·sticky 요소(머리 띠·탭 줄·알림)에 가운데가 가림을 찾는다. 문제가 없으면 빈 문자열.
const focusProblem=()=>{
 const e=document.activeElement as HTMLElement|null;if(!e||e===document.body||e===document.documentElement)return '초점이 body로 빠짐';
 const r=e.getBoundingClientRect();if(r.width<1&&r.height<1)return '';
 const l=Math.max(r.left,0),t=Math.max(r.top,0),ri=Math.min(r.right,innerWidth),b=Math.min(r.bottom,innerHeight);if(ri-l<1||b-t<1)return `화면 밖(${Math.round(r.left)},${Math.round(r.top)})`;
 const hit=document.elementFromPoint((l+ri)/2,(t+b)/2);if(!hit||hit===e||e.contains(hit)||hit.contains(e))return '';
 for(let p:Element|null=hit;p;p=p.parentElement){const pos=getComputedStyle(p).position;if((pos==='fixed'||pos==='sticky')&&!p.contains(e))return `${p.tagName.toLowerCase()}.${String(p.className).split(' ')[0]}에 가림`}
 return '';
};
function keyboard(page:Page){
 let keys=0,typed=0;const trail:string[]=[],hidden:string[]=[];
 // 끝이 있는 전환·애니메이션(건너뛰기 링크가 내려오는 0.15초, 닫히는 시트·대화상자 덮개 등)이 끝난 뒤의 자리를 본다. 도는 표시(무한 반복)는 기다리지 않는다.
 const settle=()=>page.evaluate(()=>Promise.race([Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().endTime!==Infinity).map(a=>a.finished.catch(()=>{}))),new Promise(done=>setTimeout(done,1000))]));
 // 초점이 body에 있다가 누른 키(첫 / 등)는 빠진 것이 아니다. 화면을 옮기거나 저장한 뒤 초점이 새 자리(패널 제목 등)로 가는 데 몇 프레임 걸리므로 2초까지 기다린 뒤 판정한다.
 let wasBody=true;
 const state=async()=>await page.evaluate(`[(${describe.toString()})(document.activeElement),(${focusProblem.toString()})()]`) as [string,string];
 const press=async(key:string)=>{await page.keyboard.press(key);keys++;await settle();let [at,problem]=await state();
  if(problem.includes('body')){if(wasBody)problem='';else{await page.waitForFunction(()=>document.activeElement&&document.activeElement!==document.body,undefined,{timeout:2000}).catch(()=>{});await settle();[at,problem]=await state()}}
  wasBody=at.startsWith('body');trail.push(`[${key}] → ${at}`);if(problem)hidden.push(`[${key}] → ${at}: ${problem}`)};
 const focused=(l:Locator)=>l.evaluate(e=>e===document.activeElement).catch(()=>false);
 return {
  press,
  type:async(text:string)=>{await page.keyboard.type(text);typed+=text.length},
  // 목표가 보일 때까지 기다린 뒤 Tab(또는 Shift+Tab)으로 초점을 옮긴다.
  tabTo:async(l:Locator,back=false,limit=200)=>{await expect(l).toBeVisible();for(let i=0;i<limit;i++){if(await focused(l))return;await press(back?'Shift+Tab':'Tab')}throw new Error(`Tab으로 닿지 못했습니다.\n${trail.slice(-30).join('\n')}`)},
  focused,
  trail,
  hidden,
  done:()=>({keys,typed}),
 };
}
type Keys=ReturnType<typeof keyboard>;
async function setup(browser:import('@playwright/test').Browser,info:TestInfo,n:number){
 const t=await taskContext(browser,info,'kbdtasks',n);
 return {...t,k:keyboard(t.page)};
}
function report(info:TestInfo,n:number,k:Keys,mobile:boolean){
 const {keys,typed}=k.done(),limit=ceiling[mobile?'mobile':'desktop'][n];info.annotations.push({type:'ux-keyboard-task',description:JSON.stringify({task:n,mobile,keys,typed,ceiling:limit})});
 expect(k.hidden,`과업 ${n} 초점이 보이지 않은 키:\n${k.trail.join('\n')}`).toEqual([]);
 expect(keys,`과업 ${n} 키 수 상한 초과:\n${k.trail.join('\n')}`).toBeLessThanOrEqual(limit);
}
// 본문으로 건너뛰기 링크로 사이드바를 건너뛴다(첫 Tab이 그 링크다).
async function skipToMain(page:Page,k:Keys){await expect(page.getByRole('heading',{level:1})).toBeVisible();await k.tabTo(page.getByRole('link',{name:'본문으로 건너뛰기'}));await k.press('Enter')}
// 캠페인 상세 탭 줄: 현재 탭으로 초점을 옮긴 뒤 화살표로 원하는 탭까지 간다(초점이 가면 선택된다).
// 탭을 고르면 그 탭 내용이 그려지느라 초점 이동이 늦게 보일 수 있다(CI 모바일). 다음 키를 누르기 전에 초점이 다음 탭으로 옮겨진 것을 확인해야 목표 탭을 지나치지 않는다.
async function goTab(page:Page,k:Keys,name:string){
 const tabs=page.getByRole('tablist').first();await k.tabTo(tabs.getByRole('tab',{selected:true}));
 const target=tabs.getByRole('tab',{name,exact:true}),activeTab=()=>page.evaluate(()=>document.activeElement?.getAttribute('role')==='tab'?document.activeElement.id:'');
 for(let i=0;i<15&&!await k.focused(target);i++){const before=await activeTab();await k.press('ArrowRight');await expect.poll(activeTab,{timeout:3000}).not.toBe(before)}
 await expect(target,k.trail.slice(-20).join('\n')).toHaveAttribute('aria-selected','true');
}
// 기본 선택(native select): 화살표로 값을 바꾼다.
async function choose(k:Keys,l:Locator,value:string){await k.tabTo(l);for(let i=0;i<20&&await l.inputValue()!==value;i++)await k.press('ArrowDown');await expect(l).toHaveValue(value)}
// 바로 가기를 연다. 데스크톱은 / 단축키, 모바일은 머리 띠의 '검색' 버튼(Tab·Enter).
async function openPalette(page:Page,k:Keys,mobile:boolean){
 await expect(page.getByRole('heading',{level:1})).toBeVisible();
 if(mobile){await k.tabTo(page.getByRole('button',{name:'검색',exact:true}));await k.press('Enter')}else await k.press('/');
 await expect(page.getByRole('dialog',{name:'바로 가기'})).toBeVisible();
}
// 바로 가기에서 캠페인 이름을 쳐서 연다. 열린 캠페인 제목이 초점을 받는다.
async function openCampaign(page:Page,k:Keys,title:string,mobile:boolean){
 await openPalette(page,k,mobile);await k.type(title);
 const option=page.getByRole('option',{name:title,exact:true});await expect(option).toBeVisible();for(let i=0;i<10&&await option.getAttribute('aria-selected')!=='true';i++)await k.press('ArrowDown');
 await k.press('Enter');await expect(page.getByRole('heading',{level:1,name:title})).toBeFocused();
}
const agendaRow=(page:Page,title:string)=>page.getByRole('region',{name:'오늘의 안건',exact:true}).getByRole('button',{name:new RegExp(title)}).first();

test('키보드 과업 1: 오늘 안건 처리',async({browser},info)=>{
 const {owner,context,page,post,get,k,mobile}=await setup(browser,info,1);
 try{
  const {campaignId}=await seedTask1({owner,post},info.project.name);
  await page.goto('/');const agenda=page.getByRole('region',{name:'오늘의 안건',exact:true});
  await skipToMain(page,k);await k.tabTo(agenda.getByRole('button',{name:'최근 7일 유료 주문 증가 내가 맡기',exact:true}));await k.press('Enter');
  await expect(agenda.getByRole('status')).toContainText('1건을 맡았습니다.');
  const {signals}=await get(`/api/growth/detections?campaignId=${campaignId}`) as {signals:{status:string;detection:{title:string}}[]};
  expect(signals.find(s=>s.detection.title==='최근 7일 유료 주문 증가')?.status).toBe('acknowledged');
  report(info,1,k,mobile);
 }finally{await context.close()}
});

test('키보드 과업 2: 상품·오퍼·미션 만들기',async({browser},info)=>{
 const {owner,context,page,post,get,k,mobile}=await setup(browser,info,2);
 try{
  const {campaignId,title}=await seedTask2({owner,post},info.project.name);
  await page.goto('/');
  await openCampaign(page,k,title,mobile);
  await goTab(page,k,'성장·판매');
  const panel=page.getByRole('region',{name:'판매 기본 기록',exact:true}),saved=panel.getByRole('status').filter({hasText:'서버에 저장했습니다.'}),advanced=panel.getByRole('status').filter({hasText:/서버에 저장했습니다\. 이어서/});
  await expect(panel.getByRole('navigation',{name:'성장 작업 단계'}).getByRole('button',{name:'상품',exact:true})).toHaveAttribute('aria-pressed','true');
  await k.tabTo(panel.getByLabel('SKU',{exact:true}));await k.type('T2-SKU');
  await k.tabTo(panel.getByLabel('상품명',{exact:true}));await k.type('과업 상품');
  await k.tabTo(panel.getByLabel('판매 단가 (원)',{exact:true}));await k.type('12000');
  const fact=panel.getByRole('checkbox',{name:/^과업 상품: 근거/});await k.tabTo(fact);if(!await fact.isChecked())await k.press('Space');await expect(fact).toBeChecked();
  await k.tabTo(panel.getByRole('button',{name:'저장하고 다음: 판매 오퍼',exact:true}));await k.press('Enter');await expect(advanced).toBeVisible();
  await expect(panel.getByRole('combobox',{name:'연결 상품',exact:true})).toHaveValue(/.+/);await expect(panel.getByLabel('오퍼 단가 (원)',{exact:true})).toHaveValue('12000');
  await k.tabTo(panel.getByLabel('오퍼명',{exact:true}));await k.type('과업 오퍼');
  await k.tabTo(panel.getByRole('button',{name:'저장하고 다음: 판매 미션',exact:true}));await k.press('Enter');await expect(advanced).toContainText('판매 오퍼를');
  await expect(panel.getByRole('combobox',{name:'연결 판매 오퍼',exact:true})).toHaveValue(/.+/);
  await k.tabTo(panel.getByLabel('미션 제목',{exact:true}));await k.type('과업 미션');
  await k.tabTo(panel.getByRole('button',{name:'판매 미션 저장',exact:true}));await k.press('Enter');await expect(saved).toBeVisible();
  const v=await get(`/api/growth?campaignId=${campaignId}`) as {catalogs:{id:string;input:{sku:string}}[];offers:{id:string;input:{catalogId:string;title:string}}[];missions:{input:{offerId:string;title:string}}[]};
  const catalog=v.catalogs.find(c=>c.input.sku==='T2-SKU'),offer=v.offers.find(o=>o.input.title==='과업 오퍼');
  expect(catalog).toBeTruthy();expect(offer?.input.catalogId).toBe(catalog!.id);expect(v.missions.find(x=>x.input.title==='과업 미션')?.input.offerId).toBe(offer!.id);
  report(info,2,k,mobile);
 }finally{await context.close()}
});

test('키보드 과업 3: 고객 문의 기한 처리',async({browser},info)=>{
 const {owner,context,page,post,get,k,mobile}=await setup(browser,info,3);
 try{
  const {campaignId,id}=await seedTask3({owner,post},info.project.name);
  await page.goto('/');
  await skipToMain(page,k);await k.tabTo(agendaRow(page,'고객 문의 약속 기한 초과'));await k.press('Enter');
  const panel=page.getByRole('region',{name:'고객 문의 처리',exact:true});
  await choose(k,panel.getByRole('combobox',{name:'처리 종류',exact:true}),'resolve');
  await choose(k,panel.getByRole('combobox',{name:'해결 방법',exact:true}),'shipped');
  await k.tabTo(panel.getByRole('textbox',{name:'처리 증빙 ID',exact:true}));await k.type('ship-1');
  await k.tabTo(panel.getByRole('button',{name:'처리 저장',exact:true}));await k.press('Enter');
  await expect(panel.getByRole('status').filter({hasText:'처리를 기록했습니다'})).toBeVisible();await expect(panel).toContainText('미해결 0건, 기한 초과 0건');
  const {tickets}=await get(`/api/growth/cs?campaignId=${campaignId}`) as {tickets:{id:string;status:string}[]};
  expect(tickets.find(t=>t.id===id)?.status).toBe('resolved');
  report(info,3,k,mobile);
 }finally{await context.close()}
});

test('키보드 과업 4: 확대 제안 승인',async({browser},info)=>{
 const {owner,context,page,post,get,k,mobile}=await setup(browser,info,4);
 try{
  const {campaignId,id}=await seedTask4({owner,post},info.project.name);
  await page.goto('/');
  await skipToMain(page,k);await k.tabTo(agendaRow(page,'확대 제안 승인 대기'));await k.press('Enter');
  const panel=page.getByRole('region',{name:'검증된 확대',exact:true});
  await expect(panel.getByRole('combobox',{name:'예약에 쓸 활성 위임',exact:true})).toHaveValue('x-auth');
  await k.tabTo(panel.getByRole('button',{name:`${id} 소유자 승인·예약`,exact:true}));await k.press('Enter');
  await expect(panel.getByRole('status').filter({hasText:'확대 예산을 예약했습니다'})).toBeVisible();await expect(panel).toContainText('확대 예약 200원, 원장 reserved');
  const {proposals}=await get(`/api/growth/expansion?campaignId=${campaignId}`) as {proposals:{id:string;status:string;commitment?:{status:string}}[]};
  const p=proposals.find(x=>x.id===id);expect(p?.status).toBe('reserved');expect(p?.commitment?.status).toBe('reserved');
  report(info,4,k,mobile);
 }finally{await context.close()}
});

test('키보드 과업 5: Meta 준비 점검',async({browser},info)=>{
 const {owner,context,page,post,get,k,mobile}=await setup(browser,info,5);
 try{
  const {campaignId,title}=await seedTask5({owner,post},info.project.name);
  await page.goto('/');
  await openCampaign(page,k,title,mobile);
  await goTab(page,k,'Meta 광고 준비');
  const panel=page.getByRole('region',{name:'Meta 광고 준비'});
  for(const [label,value] of [['상품·오퍼','합성 상품 1개'],['판매가 (원)','12000'],['상품 원가 (원)','4000'],['건당 변동비 (원)','2000'],['총 광고 예산 (원)','60000']]){await k.tabTo(panel.getByLabel(label,{exact:true}));await k.type(value)}
  const stock=panel.getByRole('checkbox',{name:'재고·제공 가능 수량 확인',exact:true});await k.tabTo(stock);await k.press('Space');await expect(stock).toBeChecked();
  await k.tabTo(panel.getByRole('button',{name:'준비 계획 저장',exact:true}));await k.press('Enter');
  await expect(panel.getByRole('status')).toContainText('준비 계획을 저장했습니다');
  const v=await get(`/api/meta-ads?campaignId=${campaignId}`) as {plan:{input:{price:number;totalBudget:number;checks:{inventory:boolean}}}|null};
  expect(v.plan?.input.checks.inventory).toBe(true);expect(v.plan?.input.price).toBe(12000);expect(v.plan?.input.totalBudget).toBe(60000);
  report(info,5,k,mobile);
 }finally{await context.close()}
});

test('키보드 과업 6: 발행 승인',async({browser},info)=>{
 const {owner,context,page,post,get,k,mobile}=await setup(browser,info,6);
 try{
  const {campaignId,id}=await seedTask6({owner,post},info.project.name);
  await page.goto('/');
  await skipToMain(page,k);await k.tabTo(agendaRow(page,'상세페이지 수정안 승인 대기'));await k.press('Enter');
  const panel=page.getByRole('region',{name:'상세페이지 수정안',exact:true});
  await k.tabTo(panel.getByRole('button',{name:`${id} 승인`,exact:true}));await k.press('Enter');
  await expect(panel.getByRole('status').filter({hasText:'페이지는 아직 바뀌지 않았습니다'})).toBeVisible();
  const {proposals}=await get(`/api/growth/landing?campaignId=${campaignId}`) as {proposals:{id:string;status:string}[]};
  expect(proposals.find(p=>p.id===id)?.status).toBe('approved');
  report(info,6,k,mobile);
 }finally{await context.close()}
});

test('키보드 과업 7: 주간 성과 확인',async({browser},info)=>{
 const {owner,context,page,post,k,mobile}=await setup(browser,info,7);
 try{
  const {title,day}=await seedTask7({owner,post},info.project.name);
  await page.goto('/');
  await openCampaign(page,k,title,mobile);
  await goTab(page,k,'성과');
  const row=page.getByRole('region',{name:'기간별 성과 비교',exact:true}).getByRole('row').filter({hasText:`${day(6)} ~ ${day(0)}`});
  await expect(row).toBeVisible();await expect(row).toContainText('538,000원');
  report(info,7,k,mobile);
 }finally{await context.close()}
});

test('키보드 과업 8: 전역 중단과 재개',async({browser},info)=>{
 const {owner,context,page,post,get,k,mobile}=await setup(browser,info,8);
 try{
  await seedTask8({owner,post},info.project.name);
  await page.goto('/');await expect(page.getByRole('heading',{level:1})).toBeVisible();
  if(mobile){
   // 모바일: 머리 띠 메뉴 버튼으로 사이드바 시트를 연다. Escape로 닫으면 초점이 메뉴 버튼으로 돌아오고, 다시 열어 '연결 및 설정'을 고르면 새 화면 제목이 초점을 받는다.
   const menu=page.locator('.topbar [data-slot=sidebar-trigger]'),sheet=page.locator('[data-sidebar="sidebar"][data-mobile="true"]');
   await k.tabTo(menu);await k.press('Enter');await expect(sheet).toBeVisible();await expect.poll(()=>sheet.evaluate(s=>s.contains(document.activeElement))).toBe(true);
   await k.press('Escape');await expect(sheet).toBeHidden();await expect(menu).toBeFocused();
   await k.press('Enter');await expect(sheet).toBeVisible();await k.tabTo(sheet.getByRole('button',{name:'연결 및 설정',exact:true}));await k.press('Enter');
   await expect(sheet).toBeHidden();await expect(page.getByRole('heading',{level:1,name:'연결 및 설정'})).toBeFocused();
  }else{
   // / 바로 가기에서 '연결 및 설정'을 고른다.
   await k.press('/');await expect(page.getByRole('dialog',{name:'바로 가기'})).toBeVisible();await k.type('연결 및 설정');await expect(page.getByRole('option',{name:'연결 및 설정'}).first()).toBeVisible();await k.press('Enter');
  }
  const panel=page.getByRole('region',{name:'전역 실행 중단',exact:true}),reason=panel.getByRole('textbox',{name:'중단·재개 사유',exact:true});
  await k.tabTo(reason);await k.type('외부 집행 경로 점검');await k.tabTo(panel.getByRole('button',{name:'모든 신규 실행 중단',exact:true}));await k.press('Enter');
  await expect(panel.getByRole('status')).toContainText('중단 요청을 기록했습니다.');
  expect((await get('/api/growth/stop')).state.status).toBe('stopped');
  // 사유 칸에 남은 앞 사유는 Ctrl+A로 골라 덮어쓴다.
  await k.tabTo(reason,true);await k.press('Control+a');await k.type('점검 완료');await k.tabTo(panel.getByRole('button',{name:'소유자로서 실행 재개',exact:true}));await k.press('Enter');
  await expect(panel.getByRole('status')).toContainText('재개 요청을 기록했습니다.');
  const v=await get('/api/growth/stop');expect(v.state.status).toBe('running');expect(v.state.version).toBe(2);
  report(info,8,k,mobile);
 }finally{await context.close()}
});

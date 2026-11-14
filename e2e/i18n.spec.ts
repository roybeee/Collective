import {test,expect,type Page} from '@playwright/test';
import {taskContext} from './helpers/ux-task-seeds';
// GLOBAL-PLAN G6 1단계(모바일·데스크톱): 설정 > 팀·권한의 언어 선택(헤더 인증 E2E에는 계정 메뉴가 없어 같은 선택이 있는 설정에서 연다)으로
// English를 고르면 사이드바·화면 제목·오늘의 안건·확인 대화상자가 영어가 되고 html[lang]=en이며 새로고침 뒤에도 남는다. 日本語는 일본어 메뉴, 한국어로 되돌리면 원래 문구다.
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음(승인 카드는 취소한다).
const agenda=(page:Page,name:string)=>page.getByRole('region',{name,exact:true});
async function choose(page:Page,group:string,option:string){
 await page.goto('/?view=settings&section=team');
 const radios=page.getByRole('radiogroup',{name:group,exact:true});await expect(radios).toBeVisible();
 await radios.getByRole('radio',{name:option,exact:true}).click();
}
test('언어 전환: 영어·일본어·한국어, 새로고침 유지, 확인 대화상자',async({browser},info)=>{
 test.setTimeout(90_000);
 const {context,page,post}=await taskContext(browser,info,'i18n',1),desktop=(page.viewportSize()?.width??1280)>=768;
 try{
  const {id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title:`언어 검증 ${info.project.name}`,goal:'언어 전환'}}) as {id:string};
  await post('/api/action',{action:'save_artifact',campaignId,role:'strategy',title:'언어 검증 초안',content:'## 방향\n합성 본문'});
  // 시작은 한국어(저장값 없음): lang=ko, 기존 문구 그대로.
  await page.goto('/');await expect(agenda(page,'오늘의 안건')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang','ko');
  await expect(page.getByRole('heading',{level:1})).toHaveText('워크스페이스');

  // 1) English: 설정 팀·권한에서 고르면 새로고침 없이 바뀐다.
  await choose(page,'언어','English');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.getByRole('radiogroup',{name:'Language',exact:true})).toBeVisible();
  await expect(page.getByRole('tab',{name:'Team·permissions'})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('locale'))).toBe('en');
  // 새로고침(홈으로 다시 열기) 뒤에도 영어: 사이드바·제목·안건.
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  const inbox=agenda(page,'Today’s agenda');await expect(inbox).toBeVisible();
  await expect(page.getByRole('heading',{level:1})).toHaveText('Workspace');
  await expect(page.getByRole('button',{name:'Search',exact:true})).toBeVisible();
  if(desktop){const menu=page.getByRole('navigation',{name:'Main menu'});await expect(menu.getByRole('button',{name:'Campaigns'})).toBeVisible();await expect(menu.getByRole('button',{name:'Brand archive'})).toBeVisible()}
  await expect(page.getByRole('button',{name:'Create HERMES draft'})).toBeVisible();
  // 결정 탭 → 승인 카드: 이름표(What·Where·Undo)와 버튼이 영어. 승인하지 않고 취소한다.
  await inbox.getByRole('radio',{name:/^Decide/}).click();
  await inbox.getByRole('button',{name:'Approve',exact:true}).first().click();
  const card=page.getByRole('alertdialog');await expect(card).toBeVisible();
  await expect(card).toContainText('approve this version?');
  for(const term of ['What','Where','Undo'])await expect(card.getByText(term,{exact:true}).first()).toBeVisible();
  await expect(card.getByRole('button',{name:'Request changes',exact:true})).toBeVisible();
  await card.getByRole('button',{name:'Cancel',exact:true}).click();await expect(card).toBeHidden();

  // 2) 日本語: 일본어 메뉴·제목·안건.
  await choose(page,'Language','日本語');
  await expect(page.locator('html')).toHaveAttribute('lang','ja');
  await page.goto('/');await expect(agenda(page,'今日の議題')).toBeVisible();
  await expect(page.getByRole('heading',{level:1})).toHaveText('ワークスペース');
  if(desktop)await expect(page.getByRole('navigation',{name:'メインメニュー'}).getByRole('button',{name:'キャンペーン'})).toBeVisible();

  // 3) 한국어로 되돌리면 원래 문구와 lang=ko.
  await choose(page,'言語','한국어');
  await expect(page.locator('html')).toHaveAttribute('lang','ko');
  await page.goto('/');await expect(agenda(page,'오늘의 안건')).toBeVisible();
  await expect(page.getByRole('heading',{level:1})).toHaveText('워크스페이스');
  if(desktop)await expect(page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'캠페인'})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('locale'))).toBe('ko');
 }finally{await context.close()}
});

// GLOBAL-PLAN G6 2단계(모바일·데스크톱): 캠페인 상세 틀·탭과 제작·발행 탭이 영어·일본어로 바뀌고, 한국어는 이전 문구 그대로다(QA 2026-11-09 D7).
// 저장된 언어(localStorage locale)로 연다. 캠페인 이름·작업물 본문(사용자 자료)은 번역하지 않는다. Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음.
const HANGUL=/[가-힣]/;
async function openTab(page:Page,name:string|RegExp){const tab=page.getByRole('tab',{name,exact:typeof name==='string'}).first();await tab.click();await expect(tab).toHaveAttribute('aria-selected','true')}
test('캠페인 상세 탭·제작·발행: 영어·일본어 머리말, 한국어 그대로',async({browser},info)=>{
 test.setTimeout(120_000);
 const {context,page,post}=await taskContext(browser,info,'i18n2',1);
 try{
  const title=`언어 상세 ${info.project.name}`;
  const {id}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title,goal:'상세 화면 언어 확인'}}) as {id:string};
  await post('/api/action',{action:'save_artifact',campaignId:id,role:'strategy',title:'상세 언어 초안',content:'## 방향\n합성 본문'});
  const open=async(locale:string,ctab='')=>{await page.goto('/');await page.evaluate(l=>localStorage.setItem('locale',l),locale);await page.goto(`/?view=campaigns&campaign=${id}${ctab?`&ctab=${ctab}`:''}`);await expect(page.locator('html')).toHaveAttribute('lang',locale);await expect(page.getByRole('heading',{level:1,name:title})).toBeVisible()};

  // English: 이동 경로·탭·브리프·AI 팀·작업물·성과·이력·팀 회의·제작·발행
  await open('en');
  await expect(page.getByRole('navigation',{name:'Breadcrumb'}).getByRole('button',{name:'Campaign list'})).toBeVisible();
  const tabs=page.getByRole('tablist').first();
  for(const name of ['Brief','Team meeting','AI team','Growth & sales','Meta ads prep','Production & publishing','Performance','History'])await expect(tabs.getByRole('tab',{name,exact:true})).toBeVisible();
  await expect(tabs.getByRole('tab',{name:/^Deliverables/})).toBeVisible();
  expect(HANGUL.test(await tabs.innerText())).toBe(false);
  await expect(page.getByText('Campaign goal',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Edit brief'})).toBeVisible();
  await openTab(page,'AI team');await expect(page.getByRole('heading',{name:'8 areas of expertise, one goal'})).toBeVisible();
  await openTab(page,/^Deliverables/);await expect(page.getByRole('heading',{name:'Deliverables to review',exact:true})).toBeVisible();
  await openTab(page,'Performance');await expect(page.getByRole('heading',{name:'Measured results',exact:true})).toBeVisible();
  await openTab(page,'History');await expect(page.getByRole('heading',{name:'Compare deliverable versions',exact:true})).toBeVisible();
  await openTab(page,'Team meeting');await expect(page.getByRole('heading',{name:"From each other's opinions to a better execution plan."})).toBeVisible();
  await openTab(page,'Production & publishing');
  await expect(page.getByRole('heading',{level:2,name:'Production & publishing',exact:true})).toBeVisible();
  await expect(page.getByText(/^Confirmed brand facts → PNG production/)).toBeVisible();

  // 日本語: 탭과 제작·발행 머리말
  await open('ja','execution');
  await expect(page.getByRole('tablist').first().getByRole('tab',{name:'ブリーフ',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{level:2,name:'制作・公開',exact:true})).toBeVisible();

  // 한국어: 이전 문구 그대로
  await open('ko');
  for(const name of ['브리프','팀 회의','AI 팀','제작·발행','성과','이력'])await expect(page.getByRole('tablist').first().getByRole('tab',{name,exact:true})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'이동 경로'}).getByRole('button',{name:'캠페인 목록'})).toBeVisible();
  await expect(page.getByText('캠페인 목표',{exact:true})).toBeVisible();
 }finally{await context.close()}
});

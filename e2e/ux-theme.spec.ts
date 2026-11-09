import {test,expect,type Page} from '@playwright/test';
// GLOBAL-PLAN X5 다크 모드: 머리 띠 테마 버튼으로 다크를 고르면 html.dark가 붙고, 새로고침 뒤에도 남고(lib/ui/theme.ts localStorage), 홈 본문에 흰 상자(rgb(255,255,255))가 없다.
// 기본값은 시스템 설정이라 OS가 다크면 저장값 없이도 다크다. 라이트 모드의 axe·대비는 e2e/ux-budget.spec.ts가 본다.
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음.
const WHITE='rgb(255, 255, 255)';
// 본문 안에서 흰 배경으로 그려진 요소(이미지 제외). 작업물 미리보기 PNG는 그려진 그대로라 img는 세지 않는다.
const whiteBoxes=(page:Page)=>page.evaluate((white)=>[...document.querySelectorAll('#main-content, #main-content *, [data-slot=sidebar] *')].filter(el=>{
 if(el.tagName==='IMG')return false;const r=el.getBoundingClientRect();if(r.width<8||r.height<8)return false;
 return getComputedStyle(el).backgroundColor===white;
}).map(el=>`${el.tagName.toLowerCase()}.${[...el.classList].slice(0,3).join('.')}`).slice(0,12),WHITE);
const themeButton=(page:Page)=>page.getByRole('button',{name:/^화면 테마:/});
async function chooseTheme(page:Page,mode:'system'|'light'|'dark'){
 const button=themeButton(page);await expect(button).toBeVisible();
 for(let i=0;i<3&&await button.getAttribute('data-theme-mode')!==mode;i++)await button.click();
 await expect(button).toHaveAttribute('data-theme-mode',mode);
}

test('테마 버튼으로 다크 전환·새로고침 유지·홈 본문에 흰 상자 없음',async({browser},info)=>{
 const owner=`theme-${info.project.name}-${Date.now()}`;
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,colorScheme:'light',extraHTTPHeaders:{'oai-authenticated-user-id':owner}});
 const page=await context.newPage();
 try{
  await page.goto('/');await page.getByRole('region',{name:'오늘의 안건',exact:true}).waitFor();
  // 시작은 시스템(라이트 OS) → 라이트 화면. 버튼 접근 이름이 현재 값과 다음 값을 말한다.
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  await expect(themeButton(page)).toHaveAccessibleName(/시스템.*라이트/);
  const box=await themeButton(page).boundingBox();expect(box,'테마 버튼 크기').toBeTruthy();
  if((page.viewportSize()?.width??1280)<768){expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44)}
  // 1) 다크 선택 → html.dark, 본문 배경이 흰색이 아니다.
  await chooseTheme(page,'dark');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).not.toBe(WHITE);
  expect(await whiteBoxes(page),'다크 홈 본문의 흰 상자').toEqual([]);
  for(const sel of ['.workspace-main','.agenda-card','.agenda-list .agenda-row-main','[data-slot=sidebar-inner]']){
   const el=page.locator(sel).first();if(await el.count()===0)continue;
   expect(await el.evaluate(e=>getComputedStyle(e).backgroundColor),sel).not.toBe(WHITE);
  }
  // 2) 새로고침 뒤에도 다크(localStorage theme=dark).
  await page.reload();await page.getByRole('region',{name:'오늘의 안건',exact:true}).waitFor();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  expect(await page.evaluate(()=>localStorage.getItem('theme'))).toBe('dark');
  await expect(themeButton(page)).toHaveAccessibleName(/다크.*시스템/);
  // 3) 설정 화면도 흰 상자 없음(설정 카드·바로가기 띠는 카드·배경 토큰).
  await page.goto('/?view=settings');await page.getByRole('navigation',{name:/설정/}).first().waitFor().catch(()=>{});await page.waitForLoadState('networkidle').catch(()=>{});
  expect(await whiteBoxes(page),'다크 설정 화면의 흰 상자').toEqual([]);
  // 4) 라이트로 되돌리면 .dark가 빠지고 본문이 흰색이다.
  await chooseTheme(page,'light');
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe(WHITE);
 }finally{await context.close()}
});

test('시스템 설정이 다크면 저장값 없이 다크로 열린다',async({browser},info)=>{
 const owner=`theme-sys-${info.project.name}-${Date.now()}`;
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,colorScheme:'dark',extraHTTPHeaders:{'oai-authenticated-user-id':owner}});
 const page=await context.newPage();
 try{
  await page.goto('/');await page.getByRole('region',{name:'오늘의 안건',exact:true}).waitFor();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(themeButton(page)).toHaveAttribute('data-theme-mode','system');
  expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).not.toBe(WHITE);
 }finally{await context.close()}
});

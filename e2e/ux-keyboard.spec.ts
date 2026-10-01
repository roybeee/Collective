import {test,expect,type Page} from '@playwright/test';
// UX-PLAN-3 Q9 키보드만으로 핵심 과제 8개: 마우스 클릭 없이 Tab·Enter·화살표·단축키만 쓴다.
// 1 캠페인 화면 이동(g c) 2 캠페인 열기 3 상세 탭 이동(화살표) 4 시장 근거 저장 5 다음 단계 6 이동 경로로 목록 복귀 7 바로 가기로 설정 이동 8 새 캠페인 대화상자 열고 Esc로 닫기.
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음. 데스크톱만(모바일은 키보드 단축키 대상이 아님).
const focusedName=(page:Page)=>page.evaluate(()=>{const e=document.activeElement as HTMLElement|null;if(!e)return '';return (e.getAttribute('aria-label')||(e as HTMLInputElement).labels?.[0]?.textContent||e.textContent||'').replace(/\s+/g,' ').trim()});
async function tabTo(page:Page,match:RegExp,limit=80){for(let i=0;i<limit;i++){if(match.test(await focusedName(page)))return;await page.keyboard.press('Tab')}throw new Error(`Tab으로 ${match} 에 닿지 못했습니다. 마지막 초점: ${await focusedName(page)}`)}
test('키보드만으로 핵심 과제 8개',async({browser},info)=>{
 test.skip((info.project.use.viewport?.width??1280)<768,'데스크톱 키보드 과제');
 const owner=`kbd-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  await page.request.get('/api/workspace');const title='키보드 과제 캠페인';
  await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title,goal:'키보드 확인'}}});
  await page.goto('/');await expect(page.getByRole('heading',{level:1})).toBeVisible();
  // 1) g c 로 캠페인 화면
  await page.keyboard.press('g');await page.keyboard.press('c');await expect(page).toHaveURL(/view=campaigns/);
  // 2) Tab으로 캠페인 열기 버튼 → Enter. 페이지 제목으로 초점이 간다.
  await tabTo(page,new RegExp('^'+title));await page.keyboard.press('Enter');
  const heading=page.getByRole('heading',{level:1,name:title});await expect(heading).toBeFocused();
  // 3) 탭 줄에서 화살표로 성장·판매까지
  await expect(page.getByRole('tab',{name:'브리프',exact:true})).toBeVisible();await expect(heading).toBeFocused();
  await tabTo(page,/^브리프$/);
  for(const name of ['팀 회의','AI 팀','작업물','성장·판매']){await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:new RegExp('^'+name)})).toHaveAttribute('aria-selected','true')}
  await expect(page.getByRole('tab',{name:'성장·판매',exact:true})).toHaveAttribute('aria-selected','true');
  // 4) 시장 근거 칸을 Tab으로 채우고 Enter로 저장
  const panel=page.getByRole('region',{name:'성장2 판매 워크스페이스',exact:true});await expect(panel.getByLabel('근거 제목',{exact:true})).toBeVisible();
  await tabTo(page,/^근거 제목/);await page.keyboard.type('키보드로 쓴 근거');
  await tabTo(page,/^공개 출처 URL/);await page.keyboard.type('https://example.com/kbd');
  await tabTo(page,/^근거 유효기한/);await page.keyboard.type('01012099');
  await tabTo(page,/^관측 요약/);await page.keyboard.type('저녁 문의가 늘었다.');
  await tabTo(page,/^시장 근거 저장$/);await page.keyboard.press('Enter');
  await expect(panel.getByRole('status')).toHaveText('서버에 저장했습니다.');
  // 5) 다음 단계 버튼
  await tabTo(page,/^다음 단계: 고객·기회 만들기/);await page.keyboard.press('Enter');
  await expect(panel.getByRole('button',{name:'고객·기회',exact:true})).toHaveAttribute('aria-pressed','true');
  // 6) 이동 경로로 목록 복귀(Shift+Tab으로 위로)
  for(let i=0;i<120&&!/^캠페인 목록$/.test(await focusedName(page));i++)await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');await expect(page).not.toHaveURL(/campaign=/);await expect(page.getByRole('heading',{level:1,name:'캠페인'})).toBeVisible();
  // 7) 바로 가기로 설정 이동
  await page.keyboard.press('Control+k');await expect(page.getByRole('dialog',{name:'바로 가기'})).toBeVisible();await page.keyboard.type('연결 및 설정');await expect(page.getByRole('option',{name:'연결 및 설정'}).first()).toBeVisible();await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation',{name:'설정 바로가기',exact:true})).toBeVisible();
  // 8) 새 캠페인 대화상자를 키보드로 열고 Esc로 닫기
  await page.keyboard.press('g');await page.keyboard.press('c');await expect(page).toHaveURL(/view=campaigns/);
  await tabTo(page,/^새 캠페인$/);await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog').first();await expect(dialog).toBeVisible();await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
  info.annotations.push({type:'keyboard-tasks',description:'8/8'});
 }finally{await context.close()}
});

// UX-PLAN-3 Q9 5점 조건: 대화상자 초점(열면 안으로, 닫으면 연 버튼으로)과 200% 확대(1280px 화면의 CSS 너비 640px)에서 가로 넘침 0.
test('대화상자 초점 복귀와 200% 확대 넘침',async({browser},info)=>{
 test.skip((info.project.use.viewport?.width??1280)<768,'데스크톱 확대 검사');
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:{width:640,height:450},extraHTTPHeaders:{'oai-authenticated-user-id':`zoom-${Date.now()}`}}),page=await context.newPage();
 try{
  await page.request.get('/api/workspace');const {id}=await (await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title:'확대 확인',goal:'확대'}}})).json();
  for(const path of ['/','/?view=campaigns',`/?view=campaigns&campaign=${id}`,`/?view=campaigns&campaign=${id}&ctab=growth`,`/?view=campaigns&campaign=${id}&ctab=meta-ads`,'/?view=learning','/?view=brands','/?view=stores','/?view=settings']){
   await page.goto(path);await page.waitForLoadState('networkidle');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth),`${path} 200% overflow`).toBeLessThanOrEqual(1);
  }
  // 320px(가장 좁은 휴대폰) 재배치에서도 가로 넘침 0(UX-PLAN-3 Q8 5점 조건).
  await page.setViewportSize({width:320,height:640});
  for(const path of ['/','/?view=campaigns',`/?view=campaigns&campaign=${id}&ctab=growth`,'/?view=settings']){await page.goto(path);await page.waitForLoadState('networkidle');expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth),`${path} 320px overflow`).toBeLessThanOrEqual(1)}
  await page.setViewportSize({width:1280,height:900});await page.goto('/?view=campaigns');
  const trigger=page.getByRole('button',{name:'새 캠페인',exact:true}).first();await expect(trigger).toBeEnabled();await trigger.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog').first();await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(d=>d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
 }finally{await context.close()}
});

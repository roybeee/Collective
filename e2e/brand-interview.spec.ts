import {test,expect} from '@playwright/test';
test.use({launchOptions:{args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']}});
test('인터뷰 질문, 파일 드롭, 녹음, 저장·재접속·확정',async({browser},testInfo)=>{
 const context=await browser.newContext({baseURL:testInfo.project.use.baseURL,viewport:testInfo.project.use.viewport,permissions:['microphone'],extraHTTPHeaders:{'oai-authenticated-user-id':'interview-'+testInfo.project.name+'-'+Date.now()}});
 const page=await context.newPage();await page.request.get('/api/workspace');await page.goto('/?view=brands&brand=oda');
 await page.getByRole('tab',{name:'브랜드 인터뷰',exact:true}).click();
 const panel=page.locator('.interview-studio');await expect(panel.getByText('0 / 8 섹션 기록')).toBeVisible();
 await panel.getByLabel('업종별 질문지',{exact:true}).selectOption('restaurant');await expect(panel.locator('.interview-industry-question')).toContainText('음식점');
 await panel.getByLabel('인터뷰 제목',{exact:true}).fill('현장 인터뷰 테스트');
 await panel.getByLabel('브랜드의 시작과 약속 · 답변').fill('직장인이 매일 부담 없이 먹는 화덕피자를 만들고 싶었습니다.');
 await panel.getByRole('button',{name:'변경 내용 저장',exact:true}).click();await expect(panel.getByText('1 / 8 섹션 기록')).toBeVisible();
 await panel.getByRole('button',{name:'다음 질문',exact:true}).click();await panel.getByLabel('상품·가격·선택 이유 · 답변').fill('마리나라 피자를 추천합니다. 가격은 점주 확인이 필요합니다.');
 await panel.getByLabel('업종별 질문지',{exact:true}).selectOption('cafe');await expect(panel.locator('.interview-industry-question')).toContainText('원두·제빵');await expect(panel.getByLabel('상품·가격·선택 이유 · 답변')).toHaveValue(/마리나라/);
 // Switching archive tabs keeps the unsaved conversation mounted.
 await page.getByRole('tab',{name:'현황·진단',exact:true}).click();await page.getByRole('tab',{name:'브랜드 인터뷰',exact:true}).click();await expect(panel.getByLabel('상품·가격·선택 이유 · 답변')).toHaveValue(/마리나라/);
 const transfer=await page.evaluateHandle(()=>{const dt=new DataTransfer();dt.items.add(new File(['평일 점심 신규 고객을 늘리고 싶습니다.'],'인터뷰.txt',{type:'text/plain'}));return dt});
 await panel.locator('.interview-drop').dispatchEvent('drop',{dataTransfer:transfer});await expect(panel.getByRole('link',{name:'인터뷰.txt',exact:true})).toBeVisible();
 await panel.getByRole('checkbox',{name:/참여자에게 녹음/}).check();await panel.getByRole('button',{name:'녹음 시작',exact:true}).click();await expect(panel.getByRole('button',{name:'녹음 종료',exact:true})).toBeVisible();
 await expect(panel.locator('.interview-recorder strong')).not.toHaveText('00:00');await panel.getByRole('button',{name:'녹음 종료',exact:true}).click();await expect(panel.locator('audio')).toBeVisible();
 await panel.getByRole('button',{name:'녹음 원본 보관',exact:true}).click();await expect(panel.getByRole('button',{name:'음성 전사',exact:true})).toBeVisible();
 await page.reload();await page.getByRole('tab',{name:'브랜드 인터뷰',exact:true}).click();await expect(panel.getByLabel('인터뷰 제목',{exact:true})).toHaveValue('현장 인터뷰 테스트');await expect(panel.getByText('2 / 8 섹션 기록')).toBeVisible();
 await page.screenshot({path:'e2e/artifacts/'+testInfo.project.name+'-brand-interview.png',fullPage:true});
 const list=await (await page.request.get('/api/archive/interview?brandId=oda')).json();const s=list.interviews[0];expect(s.interview.industry).toBe('cafe');await expect(panel.getByLabel('업종별 질문지',{exact:true})).toHaveValue('cafe');expect(s.interview.attachments).toHaveLength(2);
 expect((await page.request.post('/api/archive',{data:{action:'review_source',brandId:'oda',id:s.id,version:s.version,status:'confirmed'}})).status()).toBe(200);
 await page.reload();await page.getByRole('tab',{name:'브랜드 인터뷰',exact:true}).click();await expect(panel.getByRole('button',{name:'인터뷰를 바탕으로 캠페인 작성'})).toBeEnabled();await context.close();
});

// 브랜드 자동 학습(에픽 G1): 홈 시작하기 카드의 'URL 한 줄 → 브랜드 초안(후보) → 첫 캠페인 템플릿'. 로컬 빌드(wrangler --local, 실제 D1)·실제 Chromium.
// 인증은 oai-authenticated-user-id 헤더(mocked, legacy 모드에서는 소유자). 스위치 brand_autolearn은 기능 스위치 API로 켠다.
// 서버 가져오기는 사설 주소를 막으므로(page.route로는 서버 fetch를 가로채지 못한다) 같은 서버의 테스트 고정물 /api/brand-learn/sample(합성 브랜드)을 읽는다. 외부 호출 없음.
import {test,expect} from '@playwright/test';

test('URL 한 줄로 브랜드 후보를 만들고 사실 원장 후보로 저장한 뒤 템플릿으로 캠페인 초안을 연다',async({browser},info)=>{
 test.setTimeout(90_000);
 const {baseURL,viewport}=info.project.use;
 const context=await browser.newContext({baseURL,viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`e2e-autolearn-${info.project.name}-${Date.now()}`}});
 const page=await context.newPage();
 await page.request.get('/api/workspace');
 // 스위치가 꺼진 동안 쓰기는 409다.
 const off=await page.request.post('/api/brand-learn',{data:{action:'preview',brandId:'ofd',url:`${baseURL}/api/brand-learn/sample`}});
 expect(off.status()).toBe(409);
 expect((await page.request.post('/api/feature-flags',{data:{action:'set',flag:'brand_autolearn',enabled:true}})).status()).toBe(200);

 await page.goto('/');
 // 도구는 진입 줄을 누른 뒤에만 내려받는다(홈 첫 로딩 JS 예산).
 await page.getByRole('button',{name:/URL 한 줄로 브랜드 초안/}).click();
 const card=page.locator('[aria-label="브랜드 초안 만들기"]');
 await expect(card).toBeVisible();
 const brandId=await card.getByLabel('학습할 브랜드').inputValue();
 await card.getByLabel('URL 또는 매장명').fill(`${baseURL}/api/brand-learn/sample`);
 const previewed=page.waitForResponse(r=>r.url().endsWith('/api/brand-learn')&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='preview');
 await card.getByRole('button',{name:'브랜드 초안 만들기',exact:true}).click();
 expect((await previewed).status()).toBe(200);
 const candidates=card.getByRole('region',{name:'브랜드 초안 후보'});
 await expect(candidates).toBeVisible();
 await expect(candidates).toContainText('가상 분식 연구소');
 await expect(candidates).toContainText('5건');
 await expect(candidates.getByRole('link',{name:'대표 이미지 주소 열기'})).toHaveAttribute('href',`${baseURL}/images/sample-logo.png`);
 const chips=candidates.getByRole('list',{name:'색 후보'}).getByRole('listitem');
 await expect(chips).toHaveCount(5);
 await expect(chips.first()).toContainText('#c2410c');
 await expect(candidates).toContainText('해요체');
 await page.screenshot({path:`e2e/artifacts/${info.project.name}-brand-autolearn-candidates.png`,fullPage:true});

 const saved=page.waitForResponse(r=>r.url().endsWith('/api/brand-learn')&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='save_candidates');
 await candidates.getByRole('button',{name:'후보로 저장',exact:true}).click();
 const saveBody=await (await saved).json() as {imported:number};
 expect(saveBody.imported).toBe(5);
 await expect(candidates).toContainText('확인 후보 5건 저장');
 await expect(candidates.getByRole('button',{name:'후보로 저장',exact:true})).toBeDisabled();

 // 사실 원장(브랜드 아카이브 확인 사실 탭)에 '확인 후보'로만 보인다(확정 아님).
 await page.goto(`/?view=brands&brand=${brandId}&tab=facts`);
 const facts=page.locator('.artifact-list');
 await expect(facts).toContainText('서울특별시 가상구 가상로 123, 1층');
 await expect(facts).toContainText('02-000-0000');
 await expect(facts.locator('li',{hasText:'가상로 123'})).toContainText('확인 후보');
 await expect(facts.locator('li',{hasText:'가상로 123'})).not.toContainText('확인 사실');
 const factRows=await page.request.get(`/api/brand-facts?brandId=${brandId}`).then(r=>r.json()) as {facts:{status:string;source:string}[]};
 expect(factRows.facts.filter(f=>f.source.includes('브랜드 자동 학습')).every(f=>f.status==='candidate')).toBe(true);
 await page.screenshot({path:`e2e/artifacts/${info.project.name}-brand-autolearn-facts.png`,fullPage:true});

 // 템플릿 버튼은 기존 브리프 저장 경로로 캠페인 초안을 만들고 그 캠페인을 연다. 목표에 템플릿 문장과 [확인 필요]가 미리 채워져 있다.
 await page.goto('/');
 await page.getByRole('button',{name:/URL 한 줄로 브랜드 초안/}).click();
 const created=page.waitForResponse(r=>r.url().endsWith('/api/brand-learn')&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='create_from_template');
 await page.locator('[aria-label="브랜드 초안 만들기"]').getByRole('button',{name:'신메뉴 출시',exact:true}).click();
 const campaign=await (await created).json() as {id:string};
 expect(typeof campaign.id).toBe('string');
 await expect(page).toHaveURL(new RegExp(`campaign=${campaign.id}`));
 const goal=page.locator('.brief-detail h2').first();
 await expect(goal).toContainText('신메뉴');
 await expect(goal).toContainText('[확인 필요]');
 await page.screenshot({path:`e2e/artifacts/${info.project.name}-brand-autolearn-template.png`,fullPage:true});
 await context.close();
});

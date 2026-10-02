import {test,expect} from '@playwright/test';
// UX-PLAN-3 Q3: 서버가 저장을 거절하면 공용 연결(components/app/field-error-bridge.tsx)이 메시지가 가리키는 칸에 aria-invalid·사유·초점을 준다. 폼마다 고치지 않는다.
// Real local D1/API/Chromium. 지점 저장 응답만 400으로 바꾼다(mocked). 인증 헤더 mocked. 외부 호출 없음.
test('서버 검증 오류가 공용 폼의 해당 칸에 붙는다',async({browser},info)=>{
 const owner=`form-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  await page.request.get('/api/workspace');
  await page.route('**/api/stores',r=>r.request().method()==='POST'?r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'지점 이름 입력을 확인해 주세요.'})}):r.continue());
  await page.goto('/?view=stores');await page.getByRole('button',{name:'새 지점',exact:true}).first().click();
  const dialog=page.getByRole('dialog',{name:'지점 등록'}),name=dialog.locator('label:has(> span:text-is("지점 이름 *")) textarea');
  await name.fill('합성 지점');await dialog.getByLabel('주소와 주요 상권 *',{exact:true}).fill('합성 주소');await dialog.getByLabel('늘리고 싶은 매출과 고객 행동 *',{exact:true}).fill('저녁 주문');
  await dialog.getByRole('button',{name:'지점 저장',exact:true}).click();
  await expect(name).toHaveAttribute('aria-invalid','true');await expect(name).toBeFocused();await expect(name).toHaveAttribute('aria-description','지점 이름 입력을 확인해 주세요.');
  // 칸 아래 사유는 CSS 생성 문구(대체 문구 "")라 브라우저 접근성 트리의 칸 이름에 섞이지 않는다(Chrome 실제 트리로 확인).
  const cdp=await context.newCDPSession(page);await cdp.send('Accessibility.enable');const {root:doc}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true}) as {root:{nodeId:number}};
  const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:doc.nodeId,selector:'textarea[aria-invalid=true]'}) as {nodeId:number};
  const {nodes}=await cdp.send('Accessibility.getPartialAXTree',{nodeId,fetchRelatives:false}) as {nodes:{name?:{value?:string};description?:{value?:string}}[]};
  expect(nodes[0]?.name?.value).toBe('지점 이름 *');expect(nodes[0]?.description?.value).toBe('지점 이름 입력을 확인해 주세요.');
  await expect(dialog.locator('[data-field-error="지점 이름 입력을 확인해 주세요."]')).toHaveCount(1);
  await name.fill('합성 지점 2');await expect(name).not.toHaveAttribute('aria-invalid','true');await expect(dialog.locator('[data-field-error]')).toHaveCount(0);
 }finally{await context.close()}
});

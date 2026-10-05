// Real browser/local D1; fixture auth. No provider calls or production writes.
import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

test('수집 OFF에서도 보존 계획과 실제 검증 자료 화면을 사용할 수 있다',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`closeout-${randomUUID()}`}});
 const page=await context.newPage();
 try{
  await page.request.get('/api/workspace');
  await page.goto('/?view=research&tab=sources');
  await expect(page.getByRole('button',{name:'보존 처리 열기',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'보존 처리 열기',exact:true}).click();
  await expect(page.getByText('자동 보존 처리: 꺼짐',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'삭제 계획 확인',exact:true}).click();
  await expect(page.getByText('처리 대상 0건',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'확인한 계획 적용',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'실제 검증 자료 열기',exact:true}).click();
  await expect(page.getByText('유효 정답 0 / 50개',{exact:true})).toBeVisible();
  await expect(page.getByText('평가자 제출 0 / 3명',{exact:true})).toBeVisible();
  await page.reload();
  const state=await page.request.get('/api/product-research?view=retention');
  expect((await state.json()).automaticDeletion).toBe(false);
 }finally{await context.close()}
});

test('사람 정답 증빙을 연속 저장해도 이전 자료를 보존한다',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`evidence-${randomUUID()}`}});
 const page=await context.newPage();
 try{
  await page.request.get('/api/workspace');
  await page.goto('/?view=research&tab=sources');
  await page.getByRole('button',{name:'실제 검증 자료 열기',exact:true}).click();
  await page.getByRole('combobox',{name:'등록할 자료',exact:true}).selectOption('groundTruth');
  const fill=async(id:string)=>{
   for(const [label,value] of Object.entries({'정답 기록 번호':id,'정확한 상품 SKU':`sku-${id}`,'상품명':`검수 상품 ${id}`,'선정 당시 시각':'2025-01-01T09:00','관측 시작':'2025-01-02','관측 종료':'2025-02-01','사전에 정한 성공·대조 기준':'관측기간 종료 후 사전 순매출 기준 충족 여부','기준 확정 시각':'2025-01-01T09:00','정답 검수자':'실제 담당자 테스트','검수 시각':'2025-02-03T09:00','정답 증빙 주소':'https://example.com/actual-evidence','정답 증빙 파일 SHA-256':'a'.repeat(64)}))await page.getByLabel(label,{exact:true}).fill(value);
   await page.getByRole('combobox',{name:'판정 근거',exact:true}).selectOption('human');
   await page.getByRole('button',{name:'검증 자료 저장',exact:true}).click();
   await expect(page.getByRole('status').filter({hasText:'1건을 저장했습니다.'})).toBeVisible();
  };
  await fill('human-one');
  await expect(page.getByText('유효 정답 1 / 50개',{exact:true})).toBeVisible();
  await fill('human-two');
  await expect(page.getByText('유효 정답 2 / 50개',{exact:true})).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:'실제 검증 자료 열기',exact:true}).click();
  await expect(page.getByText('유효 정답 2 / 50개',{exact:true})).toBeVisible();
  await page.getByRole('combobox',{name:'등록할 자료',exact:true}).selectOption('groundTruth');
  await expect(page.getByText('human-one',{exact:true})).toBeVisible();
  await expect(page.getByText('human-two',{exact:true})).toBeVisible();
 }finally{await context.close()}
});

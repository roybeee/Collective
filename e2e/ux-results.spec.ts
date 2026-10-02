import {test,expect} from '@playwright/test';
// UX-PLAN-3 7차원: 성과 기록이 2개 이상이면 기간별 표와 순매출 추세로 비교하고, 계산식 안내는 한 번만 보인다.
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음.
test('성과 탭은 기간별 표·추세를 보이고 계산식 안내를 반복하지 않는다',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`results-${info.project.name}-${Date.now()}`}}),page=await context.newPage();
 try{
  await page.request.get('/api/workspace');
  const {id:campaignId}=await (await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title:'성과 비교',goal:'비교'}}})).json();
  const day=(n:number)=>new Date(Date.now()-n*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
  for(const [i,rev] of [[0,412000],[1,538000]] as const){const r=await page.request.post('/api/action',{data:{action:'save_metric',campaignId,schemaVersion:2,periodStart:day(20-i*7),periodEnd:day(14-i*7),scope:'전체 주문',source:'POS 정산서',definition:'KST 순매출',method:'export',revenue:rev,orders:20+i,variableCosts:100000,adSpend:30000,productionCost:0}});expect(r.status(),await r.text()).toBe(200)}
  await page.goto(`/?view=campaigns&campaign=${campaignId}&ctab=results`);
  const summary=page.getByRole('region',{name:'기간별 성과 비교',exact:true});
  await expect(summary.getByRole('table',{name:'기간별 성과'}).getByRole('row')).toHaveCount((page.viewportSize()?.width??1280)<768?2:3);
  await expect(summary).toContainText('기간별 순매출 추세');
  await expect(page.getByText(/^광고·제작비 차감 후 공헌이익 = 순매출/)).toHaveCount(1);
 }finally{await context.close()}
});

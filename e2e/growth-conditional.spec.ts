import {test,expect} from '@playwright/test';
// Real local D1/API/Chromium. No external call; nothing is launched or allocated.
test('조건부 확장: 구조화 데이터·AI 인용 관측·해외 파일럿 준비·MMM 미실행',async({browser},info)=>{
 const owner=`cond-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'조건부 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'조건부'}});
  const title=`조건부 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'조건부'}});
  const g=(action:string,id:string,input:unknown)=>post('/api/growth',{action,id,input,campaignId,campaignVersion:1,expectedVersion:0});
  await g('save_catalog','c-cat',{sku:'C-SKU',title:'상품',price:12000,unitCost:4000,variableCost:1000,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송',refunds:'반품',rightsConfirmed:true,factIds:[],validUntil:'2099-01-01'});
  await g('save_offer','c-offer',{title:'매운 세트',catalogId:'c-cat',catalogVersion:1,needId:'',price:12000,quantity:1,landingUrl:'https://example.com/set',purchaseReason:'이유',priceApproved:true});
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:/^조건부 확장\(GEO·해외·MMM\)$/}).click();const panel=page.getByRole('region',{name:'조건부 확장 검토',exact:true});await expect(panel).toBeVisible({timeout:5000});
  await expect(panel.getByRole('textbox',{name:'매운 세트 JSON-LD',exact:true})).toHaveValue(/"priceCurrency": "KRW"/);await expect(panel).toContainText('MMM 타당성실행하지 않음');
  const local=new Date(Date.now()-60000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  await panel.getByRole('combobox',{name:'AI 답변 서비스',exact:true}).selectOption('perplexity');await panel.getByRole('textbox',{name:'질문',exact:true}).fill('매운 세트 추천');await panel.getByLabel('관측 시각',{exact:true}).fill(local);await panel.getByLabel('우리 페이지 인용됨').check();await panel.getByRole('textbox',{name:'인용 URL',exact:true}).fill('https://example.com/set');
  await panel.getByRole('button',{name:'관측 기록',exact:true}).click();await expect(panel).toContainText('AI 답변 관측 1회, 인용 1회');
  await panel.getByRole('textbox',{name:'국가 코드',exact:true}).fill('jp');await panel.getByRole('textbox',{name:'현지 통화',exact:true}).fill('jpy');await panel.getByRole('combobox',{name:'오퍼',exact:true}).selectOption('c-offer');
  await panel.getByRole('spinbutton',{name:'현지 가격',exact:true}).fill('1500');await panel.getByRole('spinbutton',{name:'환율(원/현지 1단위)',exact:true}).fill('9');await panel.getByRole('spinbutton',{name:'도착 원가(원)',exact:true}).fill('8000');await panel.getByRole('spinbutton',{name:'예상 반품률(0~1)',exact:true}).fill('0.05');
  await panel.getByRole('button',{name:'파일럿 준비 저장',exact:true}).click();await expect(panel).toContainText('JP, c-offer, 준비 안 됨, 단위 공헌이익 4,825원');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});

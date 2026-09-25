// J2 AI 심사 보정 라벨 여정(블라인드): 소유자 로그인 → 품질 콘솔 → 라벨 불러오기 → 기준별 점수 → 저장 → 다음 항목.
// 로컬 빌드와 dispatcher 로그인 헤더(mocked auth, quality-console.spec.ts와 같은 방식). 라벨 대기열·저장 API는 page.route로 모의한다(mocked):
// 로컬 E2E에는 평가 HERMES 연결이 없어 실제 평가 출력을 만들 수 없기 때문이다. 서버 응답의 블라인드(run·케이스·variant 미포함)는 tests/judge-labels.test.mjs가 본다.
// 여기서는 화면이 응답의 허용 필드만 그리는지 본다: 모의 응답에 run id·케이스 id·variant·모델을 일부러 섞어도 화면(DOM)과 저장 요청에 나오지 않아야 한다.
import {test,expect,type Page} from '@playwright/test';

const isMobile=(page:Page)=>(page.viewportSize()?.width??1280)<768;
const SECRET=['run-SECRET-7f3a','case-SECRET-19b2','candidate','mock-secret-model'];
const criteria=[
 {id:'evidence_linkage',label:'근거 연결',definition:'합성 정의: 근거와 결론의 연결',anchors:['1점 앵커','2점 앵커','3점 앵커','4점 앵커','5점 앵커']},
 {id:'causal_overreach',label:'인과 절제',definition:'합성 정의: 원인 단정 절제',anchors:['1점','2점','3점','4점','5점']},
];
const item=(itemId:string,output:string)=>({itemId,role:'insight',roleName:'인사이트',criteria:['evidence_linkage','causal_overreach'],output,labels:[],runId:SECRET[0],caseId:SECRET[1],variant:SECRET[2],model:SECRET[3]});
const queue={rubricVersion:'judge-rubric-v1',criteria,counts:{items:5,labeled:3},runId:SECRET[0],items:[item('L0a1b2c3d4e','## 합성 인사이트 A\n포장 고객은 저녁 시간대가 많다(가설).'),item('L9f8e7d6c5b','## 합성 인사이트 B\n첫 방문 고객 재방문 동기(가설).')]};

test('소유자는 블라인드 항목에 기준별 점수를 매기고 run·variant를 보지 않는다',async({browser},testInfo)=>{
 const owner=`e2e-judge-${testInfo.project.name}-${Date.now()}`;
 const context=await browser.newContext({baseURL:testInfo.project.use.baseURL,viewport:testInfo.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}});
 const page=await context.newPage();
 const posted:Record<string,unknown>[]=[];
 await page.route(url=>url.pathname==='/api/eval',async route=>{
  const request=route.request();
  if(request.method()==='GET'&&new URL(request.url()).searchParams.get('labels')==='queue')return route.fulfill({json:queue});
  if(request.method()!=='POST')return route.continue();
  const body=request.postDataJSON() as Record<string,unknown>;posted.push(body);
  return route.fulfill({json:{itemId:body.itemId,use:body.use,scores:body.scores,labeledAt:new Date().toISOString()}});
 });
 await page.request.get('/api/workspace');
 await page.goto('/');
 if(isMobile(page))await page.getByRole('button',{name:'Toggle Sidebar'}).click();
 await page.getByRole('button',{name:'품질 콘솔',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'품질 콘솔'});
 await sheet.getByRole('button',{name:'라벨 불러오기',exact:true}).click();
 const article=sheet.getByRole('article',{name:'라벨 항목'});
 await expect(article.getByText('항목 L0a1b2c3d4e · 인사이트')).toBeVisible();
 await expect(article.getByText('포장 고객은 저녁 시간대가 많다',{exact:false})).toBeVisible();
 await expect(sheet.getByText('라벨 3/5건',{exact:false})).toBeVisible();
 const html=await sheet.innerHTML();
 for(const secret of SECRET)expect(html,`화면에 ${secret}이(가) 보이면 안 됩니다`).not.toContain(secret);

 const save=article.getByRole('button',{name:'라벨 저장',exact:true});
 await expect(save).toBeDisabled();
 await article.getByRole('radiogroup',{name:'근거 연결 점수'}).getByLabel('4').check();
 await expect(save).toBeDisabled();
 await article.getByRole('radiogroup',{name:'인과 절제 점수'}).getByLabel('해당없음').check();
 await save.click();
 await expect(sheet.getByRole('article',{name:'라벨 항목'}).getByText('항목 L9f8e7d6c5b · 인사이트')).toBeVisible();
 expect(posted).toEqual([{action:'save_label',itemId:'L0a1b2c3d4e',use:'measure',scores:{evidence_linkage:4,causal_overreach:'na'}}]);
 expect(JSON.stringify(posted)).not.toMatch(/SECRET|candidate|runId|caseId|variant/);

 await sheet.getByRole('button',{name:'건너뛰기',exact:true}).click();
 await expect(sheet.getByText('이 목록의 라벨을 모두 저장했습니다',{exact:false})).toBeVisible();
 await context.close();
});

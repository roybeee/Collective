import {test,expect} from '@playwright/test';
// GEO 관측 프로토콜 v2 화면(app/geo-protocol-v2.tsx). /api/geo 응답은 page.route로 모의한다(mocked HERMES: 실제 HERMES·AI 엔진 호출 없음, 측정 시작 없음).
// 확인: 'N회 중 k회'·판정어·운영 기준 표시, 처방 0(엔티티 부재)이 백로그 맨 앞, 비교 질문 유형, 변경 기록 저장 요청과 +14·+42일 재관측 표시, 가로 넘침 없음.
// 재관측 날짜는 date 명령으로 계산했다: 2026-11-10 +14일 = 2026-11-24, +42일 = 2026-12-22(반영일은 오늘 이전이어야 한다: 입력 max).
const at='2026-11-09T03:00:00.000Z';
const verdict=(group:string,engine:string,n:number,k:number,v:string,level:string,timePoints:number,spanDays:number)=>({group,engine,n,k,count:`${n}회 중 ${k}회`,timePoints,spanDays,verdict:v,level,previous:null,rule:'운영 기준'});
const entity={id:'entity-absent',kind:'entity_absent',engines:['perplexity'],waiting:false,text:'처방 0(엔티티 부재): 브랜드 이름으로 물어도 답변에 나오지 않습니다. 다른 처방보다 먼저 공식 정보 페이지 1곳(확정 사실만)·지도 등록 정보·이름 표기 통일을 한 묶음으로 정비하고, 변경 기록을 남겨 다시 관측하세요.'};
function view(campaignId:string,changes:unknown[]){
 const q=(id:string,text:string,intent:string)=>({id,text,locale:'ko',intent,engines:['perplexity'],active:true,brandId:'ofd',version:1,origin:'manual',basis:[],createdAt:at,updatedAt:at,updatedBy:'e2e'});
 return {campaignId,brandId:'ofd',brandName:'합성 브랜드',questions:[q('gq-e2ebrand01','합성 브랜드 영업시간','brand'),q('gq-e2ecomp001','합성 브랜드 경쟁점 비교','comparison')],starters:[],runs:[],active:null,observations:[],
  report:{label:'관찰 기록 · 노출 보장 아님',week:'2026-11-09',previousWeek:'2026-11-02',engines:[],topDomains:[],observations:3,exposureGuaranteed:false,backlog:[entity,{id:'json-ld',kind:'json_ld',link:'json_ld_generator',text:'JSON-LD 구조화 데이터 미확인'}],
   protocol:2,rules:{label:'운영 기준',dominant:'2/3',contested:'1/3',minGapDays:7,windowDays:28,maxRepeats:3},
   verdicts:[verdict('brand','perplexity',3,0,'absent','absent',2,7),verdict('comparison','perplexity',3,1,'pending','behind',1,0)],
   entity:{absent:true,engines:['perplexity'],preliminary:false,waiting:false},citationMix:{official:1,platform:2,third_party:0,unclassified:1},contextMix:{positive:1,neutral:0,negative:0}},
  site:{jsonLd:'unknown',llmsTxt:'unknown',version:0},plan:{questions:2,engines:1,jobs:6,perJobTokens:15000,totalTokens:90000,basis:'input',samples:0,repeats:3},
  target:{officialUrls:[],competitors:['경쟁점']},llmsTxt:'# 합성 브랜드\n',canEdit:true,limit:30,maxJobs:50,
  protocol:2,intents:['brand','category','local','comparison'],groups:['category','comparison','brand'],changeKinds:['entity_basics','faq','page','listing','other'],changeBases:['published','indexed'],changes,rechecksDue:[]};
}
test('GEO 프로토콜 v2: N회 중 k회·판정어·처방 0·변경 기록과 재관측 예약(모의 HERMES)',async({browser},info)=>{
 const owner=`geo2-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const title=`GEO v2 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title,goal:'GEO v2'}});
  let changes:unknown[]=[];const sent:Record<string,unknown>[]=[];
  await page.route('**/api/geo**',async route=>{
   const req=route.request();
   if(req.method()==='GET')return route.fulfill({json:view(campaignId,changes)});
   const body=req.postDataJSON() as Record<string,unknown>;sent.push(body);
   if(body.action==='save_change'){const input=body.input as Record<string,string>;const row={...input,id:'gchg-e2e0000001',brandId:'ofd',campaignId,questionIds:[],rechecks:[{offset:14,dueOn:'2026-11-24',status:'scheduled'},{offset:42,dueOn:'2026-12-22',status:'scheduled'}],createdAt:at,createdBy:'e2e'};changes=[row];return route.fulfill({json:row})}
   return route.fulfill({status:400,json:{error:'모의 경로에서 지원하지 않는 작업입니다.'}});
  });
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:/^조건부 확장\(GEO·해외·MMM\)$/}).click();
  await page.locator('summary').filter({hasText:/^AI 검색 노출 자동 추적$/}).click();
  const geo=page.getByRole('region',{name:'AI 검색 노출 자동 추적',exact:true});await expect(geo).toBeVisible({timeout:10000});
  const v2=geo.getByRole('group',{name:'관측 프로토콜 v2',exact:true});await expect(v2).toBeVisible();
  await expect(v2).toContainText('3회 중 0회');await expect(v2).toContainText('부재, 운영 기준');await expect(v2).toContainText('판정 보류, 운영 기준');
  await expect(v2).toContainText('판정 기준(운영 기준)');await expect(v2).toContainText('질문×엔진마다 3회 반복 측정합니다');
  await expect(v2).toContainText('편집 플랫폼 2');await expect(v2).toContainText('긍정 1');
  await expect(geo.locator('li').filter({hasText:'처방 0(엔티티 부재)'}).first()).toBeVisible();
  const backlog=await geo.locator('h5:text-is("개선 백로그") + ul > li').allTextContents();expect(backlog[0]).toContain('처방 0(엔티티 부재)');
  await expect(geo.getByRole('combobox',{name:'유형',exact:true}).locator('option',{hasText:'비교'})).toHaveCount(1);
  await v2.getByRole('textbox',{name:'변경 요약',exact:true}).fill('공식 정보 페이지 게시');await v2.getByLabel('반영일(게시·색인 확인일)',{exact:true}).fill('2026-11-10');
  await v2.getByRole('button',{name:'변경 기록',exact:true}).click();
  await expect(geo).toContainText('변경을 기록하고 재관측을 예약했습니다.');
  const saved=sent.find(b=>b.action==='save_change');expect(saved?.input).toMatchObject({kind:'entity_basics',summary:'공식 정보 페이지 게시',appliedOn:'2026-11-10',appliedBasis:'published'});
  await expect(v2).toContainText('+14일 2026-11-24 예약');await expect(v2).toContainText('+42일 2026-12-22 예약');
  expect(sent.some(b=>b.action==='start_run')).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});

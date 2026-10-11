// 실제 로컬 D1·HTTP·UI, 인증만 legacy 소유자 헤더로 모의한다. 외부 발신·광고 집행 없음.
import {test, expect, type Page, type Locator, type Response} from '@playwright/test';

test.use({screenshot:'only-on-failure',video:'retain-on-failure'});

class StoreGrowthPage {
  readonly panel: Locator;
  readonly weekly: Locator;
  constructor(readonly page: Page) {
    this.panel=page.getByRole('region',{name:'점포 성장 운영',exact:true});
    this.weekly=this.panel.getByRole('region',{name:'주간 판단',exact:true});
  }
  async open(storeId: string) {
    await this.page.goto(`/?view=stores&brand=oda&store=${encodeURIComponent(storeId)}&tab=growth`);
    await expect(this.panel.getByRole('button',{name:'점포 기준 저장',exact:true})).toBeEnabled();
  }
  field(name: string) {return this.panel.getByRole('textbox',{name,exact:true}).or(this.panel.getByRole('spinbutton',{name,exact:true})).or(this.panel.getByRole('combobox',{name,exact:true}));}
  async action(action: string, name: string) {
    const received=this.page.waitForResponse((r: Response)=>r.url().endsWith('/api/store-growth')&&r.request().method()==='POST'&&r.request().postDataJSON()?.action===action);
    await this.panel.getByRole('button',{name,exact:true}).click();
    const response=await received;
    expect(await response.text()).not.toContain('"error"');
    expect(response.status()).toBe(200);
    await expect(this.panel.getByRole('button',{name:'점포 기준 저장',exact:true})).toBeEnabled();
    return response;
  }
  async saveProfile() {
    await expect(this.field('가게 콘셉트')).toHaveValue('포장 분식');
    await this.field('상권·활동 지역 (쉼표 구분)').fill('서울 성동구');
    for(const [label,value] of Object.entries({'객단가 (원)':'12000','주문당 변동비 (원)':'4000','하루 추가 주문 수용량 (건)':'10','사장 시간 가치 (원/시간)':'20000','예상 사장 작업 시간 (분)':'30','월 마케팅 예산 (원)':'500000','이번 계획 광고비 (원)':'0','제작·협찬비 (원)':'0','할인·혜택 비용 (원)':'0','기간 소프트웨어 비용 (원)':'0','계획 운영 기간 (일)':'7'})) await this.field(label).fill(value);
    await this.action('save_profile','점포 기준 저장');
  }
  async selectCandidate() {
    const article=this.panel.getByRole('article').filter({has:this.page.getByRole('link',{name:'레뷰 지역·매장 체험단',exact:true})});
    await expect(article).toContainText('견적 미확인');
    const response=this.page.waitForResponse(r=>r.url().endsWith('/api/store-growth')&&r.request().postDataJSON()?.action==='select_candidate');
    await article.getByRole('button',{name:'검토 후보로 선택',exact:true}).click();
    expect((await response).status()).toBe(200);
    await expect(article).toContainText('선택됨');
    await expect(this.field('선택한 후보')).toContainText('레뷰 지역·매장 체험단');
    await this.field('선택한 후보').selectOption({label:'레뷰 지역·매장 체험단'});
  }
  async recordTime(task: string, baseline?: string) {
    await this.field('실제 수행한 작업').fill(task);
    await this.field('실제 소요 시간 (분)').fill('30');
    await this.field('이전 방식의 동일 과제 시간 (분, 선택)').fill(baseline||'');
    await this.action('add_time','작업 시간 기록');
    await expect(this.panel.getByText(new RegExp(`${task}[, ·]+30분`))).toBeVisible();
  }
}

test('점포 기준 → 공개 후보 선택 → 과제·실행 연결 → 실제 시간 기록이 재조회에도 보존된다',async({browser},info)=>{
  test.setTimeout(90_000);
  const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`e2e-growth-${info.project.name}-${Date.now()}`}});
  const page=await context.newPage();
  try {
    expect((await page.request.get('/api/workspace')).status()).toBe(200);
    const createStore=async(name:string)=>{
      const response=await page.request.post('/api/stores',{data:{action:'save_store',brandId:'oda',data:{name,address:'서울 성동구 성수동 테스트 주소',tradeArea:'residential',goal:'평일 포장 주문 증가',menu:'포장 분식'}}});
      expect(response.status()).toBe(200);return (await response.json()).id as string;
    };
    const storeId=await createStore('성장 운영 실측 점포');
    const otherStoreId=await createStore('다른 점포');
    const createCampaign=async(id:string,title:string)=>{
      const response=await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'oda',storeId:id,title,goal:'실제 포장 주문 추적',budget:0}}});
      expect(response.status()).toBe(200);return (await response.json()).id as string;
    };
    const campaignId=await createCampaign(storeId,'성장 실행');
    const otherCampaignId=await createCampaign(otherStoreId,'다른 점포 실행');
    const ui=new StoreGrowthPage(page);
    await ui.open(storeId);await ui.saveProfile();
    const read=async()=>{const response=await page.request.get(`/api/store-growth?storeId=${storeId}`);expect(response.status()).toBe(200);return response.json();};
    let view=await read();
    expect(view.candidates.length).toBeGreaterThanOrEqual(6);
    expect(view.candidates.every((c:{url:string})=>c.url.startsWith('https://'))).toBe(true);
    await ui.selectCandidate();
    await ui.field('다음 확인·촬영·브리프 과제').fill('방문 가능 일정과 견적 확인');
    await ui.action('create_task','점포 할 일 만들기');
    await expect(ui.panel.getByRole('listitem').filter({hasText:'할 일: 방문 가능 일정과 견적 확인'})).toBeVisible();
    await expect(ui.panel.getByRole('button',{name:'과제 완료 기록',exact:true})).toBeDisabled();
    await ui.field('완료 확인 근거').fill('공식 방문 일정 안내와 견적 요청 조건을 확인했습니다.');
    await ui.action('complete_task','과제 완료 기록');
    await expect(ui.panel.getByText('완료: 방문 가능 일정과 견적 확인',{exact:true})).toBeVisible();
    await ui.field('점포 캠페인').selectOption(campaignId);
    await ui.action('link_execution','기존 실행 연결');
    await expect(ui.panel.getByText(/연결 근거 최신/)).toBeVisible();
    await expect(ui.panel.getByText('완료: 방문 가능 일정과 견적 확인',{exact:true})).toBeVisible();
    view=await read();
    const candidate=view.candidates.find((c:{status:string})=>c.status==='shortlisted');
    expect(view.links).toHaveLength(1);expect(view.links[0].campaignId).toBe(campaignId);
    const cross=await page.request.post('/api/store-growth',{data:{action:'link_execution',storeId,candidateId:candidate.id,campaignId:otherCampaignId,version:0}});
    expect(cross.status()).toBe(409);
    const stale=await page.request.post('/api/store-growth',{data:{action:'select_candidate',storeId,id:candidate.id,version:0,status:'rejected'}});
    expect(stale.status()).toBe(409);
    const invalid=await page.request.post('/api/store-growth',{data:{action:'add_candidate',storeId,candidate:{...candidate,url:'https://127.0.0.1/private',publicBusinessEvidence:'공개 협업 소개'}}});
    expect(invalid.status()).toBe(400);
    await ui.recordTime('견적 비교','45');
    await expect(ui.weekly).toContainText('15분');
    await ui.recordTime('촬영 준비');
    await expect(ui.weekly).toContainText('판단 보류');
    await page.reload();
    await expect(ui.field('객단가 (원)')).toHaveValue('12000');
    await expect(ui.panel.getByText('완료: 방문 가능 일정과 견적 확인',{exact:true})).toBeVisible();
    await expect(ui.panel.getByText(/견적 비교[, ·]+30분/)).toBeVisible();
    await expect(ui.panel.getByText(/촬영 준비[, ·]+30분/)).toBeVisible();
    await expect(ui.panel.getByText(/연결 근거 최신/)).toBeVisible();
    view=await read();expect(view.timeEntries).toHaveLength(2);expect(view.weekly.decision).toBe('hold');
    expect(view.timeEntries.find((t:{task:string})=>t.task==='촬영 준비').baselineMinutes).toBeNull();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    expect(overflow).toBe(false);
    await page.screenshot({path:`e2e/artifacts/${info.project.name}-store-growth.png`,fullPage:true});
  } finally {await context.close();}
});

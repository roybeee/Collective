// G4 공유 링크 여정(docs/SHARE-LINKS.ko.md): 대표가 스위치를 켜고 끝난 주 보고서를 동결 → 고객 보고서 탭 동결본에서 공유 링크 만들기 → 로그인 없는 새 브라우저 문맥(인증 헤더 없음)에서 공개 화면을 읽음
// → 취소 → 같은 주소가 404. 작업물 검토자 링크: 공개 화면에서 수정 요청은 메시지가 없으면 거부되고, 메시지를 적으면 전달되며 대표의 캠페인 이력에 외부 검토자 이벤트가 남는다.
// 로컬 빌드(wrangler --local, 실제 D1 시뮬레이터)·실제 Chromium·실제 API(모의 없음). 인증만 로그인 헤더(mocked auth). 모델·외부 호출 없음.
import {test,expect,type Browser,type TestInfo} from '@playwright/test';

const DAY=86400000;
const koreaToday=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
const addDays=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*DAY).toISOString().slice(0,10);
const mondayIndex=(t:number)=>(new Date(t).getUTCDay()+6)%7;
function isoWeek(date:string){
 const t=Date.parse(date+'T00:00:00Z'),thursday=t+(3-mondayIndex(t))*DAY,year=new Date(thursday).getUTCFullYear(),jan4=Date.UTC(year,0,4),week1=jan4-mondayIndex(jan4)*DAY;
 return `${year}-W${String(Math.floor((thursday-week1)/(7*DAY))+1).padStart(2,'0')}`;
}
const lastSunday=addDays(koreaToday(),-(mondayIndex(Date.parse(koreaToday()+'T00:00:00Z'))+1)),WEEK=isoWeek(lastSunday);

async function openOwner(browser:Browser,testInfo:TestInfo){
 const {baseURL,viewport}=testInfo.project.use;
 const context=await browser.newContext({baseURL,viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`e2e-g4-${testInfo.project.name}-${Date.now()}`}});
 const page=await context.newPage();
 await page.request.get('/api/workspace');
 for(const flag of ['share_links','a8_customer_report'])expect((await page.request.post('/api/feature-flags',{data:{action:'set',flag,enabled:true}})).status()).toBe(200);
 return {context,page};
}
// 로그인 헤더가 없는 새 문맥: 공개 화면만 열 수 있어야 한다.
async function openGuest(browser:Browser,testInfo:TestInfo){
 const {baseURL,viewport}=testInfo.project.use;
 const context=await browser.newContext({baseURL,viewport});
 return {context,page:await context.newPage()};
}

test('대표가 동결 보고서의 공유 링크를 만들면 로그인 없이 읽히고, 취소하면 같은 주소가 닫힌다',async({browser},testInfo)=>{
 const {context,page}=await openOwner(browser,testInfo);
 const storeName='G4 공유 지점';
 const saved=await page.request.post('/api/stores',{data:{action:'save_store',brandId:'oda',data:{name:storeName,address:'서울 성수동 테스트 주소',tradeArea:'residential',goal:'주간 결산 공유'}}});
 expect(saved.status()).toBe(200);
 const {id:storeId}=await saved.json() as {id:string};
 // 끝난 주를 실제로 동결한다(빈 장부라도 확인 값은 서버 미리보기의 값을 그대로 보낸다).
 const preview=await page.request.get(`/api/customer-reports?storeId=${encodeURIComponent(storeId)}&week=${WEEK}`);
 expect(preview.status()).toBe(200);
 const {confirm}=await preview.json() as {confirm:Record<string,unknown>};
 const frozen=await page.request.post('/api/customer-reports',{data:{action:'freeze',storeId,week:WEEK,confirmed:true,expected:confirm}});
 expect(frozen.status()).toBe(200);

 await page.goto(`/?view=stores&brand=oda&store=${encodeURIComponent(storeId)}&tab=report`);
 const entry=page.getByRole('article',{name:`동결본 ${WEEK} v1`});
 const card=entry.getByRole('region',{name:`공유 링크 ${WEEK} v1`});
 await expect(card.getByText('아직 만든 공유 링크가 없습니다.')).toBeVisible();
 await card.getByRole('textbox',{name:'받는 사람',exact:true}).fill('점주님');
 await card.getByRole('button',{name:'공유 링크 만들기',exact:true}).click();
 const address=card.getByRole('textbox',{name:'공유 주소',exact:true});
 await expect(address).toBeVisible();
 const url=await address.inputValue();
 expect(url).toMatch(/\/share\/[a-f0-9]{64}$/);
 await expect(card.getByRole('list',{name:'공유 링크 목록'})).toContainText('점주님');
 await expect(card.getByRole('list',{name:'공유 링크 목록'})).toContainText('조회 0회');
 await page.screenshot({path:`e2e/artifacts/${testInfo.project.name}-share-links-owner.png`,fullPage:true});

 const guest=await openGuest(browser,testInfo);
 expect((await guest.page.request.get('/api/workspace')).status()).toBe(401);
 const opened=await guest.page.goto(url);
 expect(opened?.status()).toBe(200);
 expect(opened?.headers()['content-security-policy']).toContain("default-src 'none'");
 expect(opened?.headers()['x-robots-tag']).toContain('noindex');
 await expect(guest.page.getByRole('heading',{level:1})).toHaveText(`${storeName} · ${WEEK}`);
 await expect(guest.page.getByRole('heading',{name:'장부',exact:true})).toBeVisible();
 await expect(guest.page.getByText('COLLECTIVE 보고서 · 읽기 전용',{exact:false})).toBeVisible();
 await expect(guest.page.getByText('만료일',{exact:false})).toBeVisible();
 await expect(guest.page.locator('body')).not.toContainText('성수동');
 await guest.page.screenshot({path:`e2e/artifacts/${testInfo.project.name}-share-links-public.png`,fullPage:true});

 await page.reload();
 await expect(card.getByRole('list',{name:'공유 링크 목록'})).toContainText('조회 1회');
 await card.getByRole('button',{name:'점주님 링크 취소',exact:true}).click();
 await expect(card.getByRole('list',{name:'공유 링크 목록'})).toContainText('취소함');
 const closed=await guest.page.goto(url);
 expect(closed?.status()).toBe(404);
 await expect(guest.page.getByRole('heading',{level:1})).toHaveText('링크를 찾을 수 없습니다');
 await guest.context.close();
 await context.close();
});

test('외부 검토자는 로그인 없이 작업물을 읽고, 수정 요청은 메시지가 있어야 전달되며 대표 이력에 남는다',async({browser},testInfo)=>{
 const {context,page}=await openOwner(browser,testInfo);
 const campaign=await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'oda',title:'G4 검토 캠페인',goal:'외부 검토자 승인 링크를 확인합니다.'}}});
 expect(campaign.status()).toBe(200);
 const {id:campaignId}=await campaign.json() as {id:string};
 const artifact=await page.request.post('/api/action',{data:{action:'save_artifact',campaignId,role:'cmo',title:'실행 브리프 초안',content:'## 목표\n평일 방문을 늘리는 실행 브리프입니다.\n\n## 범위\n점포 1곳, 4주.'}});
 expect(artifact.status()).toBe(200);
 const {id:artifactId}=await artifact.json() as {id:string};
 const link=await page.request.post('/api/share',{data:{action:'create',scope:{kind:'artifact',id:artifactId},label:'e2e 검토자',days:7}});
 expect(link.status()).toBe(200);
 const {token}=await link.json() as {token:string};

 const guest=await openGuest(browser,testInfo);
 const opened=await guest.page.goto(`/share/${token}`);
 expect(opened?.status()).toBe(200);
 await expect(guest.page.getByRole('heading',{level:1})).toHaveText('실행 브리프 초안');
 await expect(guest.page.getByText('총괄 파트너 작업물 · v1 · 직접 작성',{exact:false})).toBeVisible();
 await expect(guest.page.getByText('AI 표시',{exact:false})).toBeVisible();
 await expect(guest.page.getByRole('article',{name:'작업물 본문'})).toContainText('평일 방문을 늘리는 실행 브리프입니다.');
 // 메시지 없는 수정 요청은 서버가 거부하고 같은 화면에 이유를 보인다.
 await guest.page.getByRole('radio',{name:'수정 요청'}).check();
 await guest.page.getByRole('button',{name:'보내기',exact:true}).click();
 await expect(guest.page.getByRole('alert')).toContainText('메시지를 적어야 합니다');
 await guest.page.getByRole('radio',{name:'수정 요청'}).check();
 await guest.page.getByRole('textbox',{name:/수정 요청 메시지/}).fill('범위를 2곳으로 넓혀 주세요.');
 await guest.page.getByRole('button',{name:'보내기',exact:true}).click();
 await expect(guest.page.getByRole('status')).toContainText('수정 요청을 담당자에게 전달했습니다.');
 await expect(guest.page.getByRole('list',{name:'남긴 결정'})).toContainText('수정 요청');
 await guest.page.screenshot({path:`e2e/artifacts/${testInfo.project.name}-share-links-reviewer.png`,fullPage:true});
 await guest.context.close();

 const detail=await page.request.get(`/api/campaigns/${campaignId}`);
 expect(detail.status()).toBe(200);
 const {events,artifacts}=await detail.json() as {events:{message:string}[];artifacts:{id:string;status:string}[]};
 expect(events.some(e=>e.message.startsWith('외부 검토자 e2e 검토자 · 실행 브리프 초안 v1 수정 요청'))).toBe(true);
 expect(artifacts.find(a=>a.id===artifactId)?.status).toBe('review');
 const list=await page.request.get(`/api/share?kind=artifact&id=${encodeURIComponent(artifactId)}`);
 const {links}=await list.json() as {links:{decisions:{revision?:{noteLength:number}};viewCount:number}[]};
 expect(links[0].decisions.revision?.noteLength).toBe(16);
 await context.close();
});

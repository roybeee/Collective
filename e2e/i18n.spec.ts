import {test,expect,type Page} from '@playwright/test';
import {taskContext} from './helpers/ux-task-seeds';
// GLOBAL-PLAN G6 1단계(모바일·데스크톱): 설정 > 팀·권한의 언어 선택(헤더 인증 E2E에는 계정 메뉴가 없어 같은 선택이 있는 설정에서 연다)으로
// English를 고르면 사이드바·화면 제목·오늘의 안건·확인 대화상자가 영어가 되고 html[lang]=en이며 새로고침 뒤에도 남는다. 日本語는 일본어 메뉴, 한국어로 되돌리면 원래 문구다.
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음(승인 카드는 취소한다).
const agenda=(page:Page,name:string)=>page.getByRole('region',{name,exact:true});
async function choose(page:Page,group:string,option:string){
 await page.goto('/?view=settings&section=team');
 const radios=page.getByRole('radiogroup',{name:group,exact:true});await expect(radios).toBeVisible();
 await radios.getByRole('radio',{name:option,exact:true}).click();
}
test('언어 전환: 영어·일본어·한국어, 새로고침 유지, 확인 대화상자',async({browser},info)=>{
 test.setTimeout(90_000);
 const {context,page,post}=await taskContext(browser,info,'i18n',1),desktop=(page.viewportSize()?.width??1280)>=768;
 try{
  const {id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title:`언어 검증 ${info.project.name}`,goal:'언어 전환'}}) as {id:string};
  await post('/api/action',{action:'save_artifact',campaignId,role:'strategy',title:'언어 검증 초안',content:'## 방향\n합성 본문'});
  // 시작은 한국어(저장값 없음): lang=ko, 기존 문구 그대로.
  await page.goto('/');await expect(agenda(page,'오늘의 안건')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang','ko');
  await expect(page.getByRole('heading',{level:1})).toHaveText('워크스페이스');

  // 1) English: 설정 팀·권한에서 고르면 새로고침 없이 바뀐다.
  await choose(page,'언어','English');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.getByRole('radiogroup',{name:'Language',exact:true})).toBeVisible();
  await expect(page.getByRole('tab',{name:'Team·permissions'})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('locale'))).toBe('en');
  // 새로고침(홈으로 다시 열기) 뒤에도 영어: 사이드바·제목·안건.
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  const inbox=agenda(page,'Today’s agenda');await expect(inbox).toBeVisible();
  await expect(page.getByRole('heading',{level:1})).toHaveText('Workspace');
  await expect(page.getByRole('button',{name:'Search',exact:true})).toBeVisible();
  if(desktop){const menu=page.getByRole('navigation',{name:'Main menu'});await expect(menu.getByRole('button',{name:'Campaigns'})).toBeVisible();await expect(menu.getByRole('button',{name:'Brand archive'})).toBeVisible()}
  await expect(page.getByRole('button',{name:'Create HERMES draft'})).toBeVisible();
  // 결정 탭 → 승인 카드: 이름표(What·Where·Undo)와 버튼이 영어. 승인하지 않고 취소한다.
  await inbox.getByRole('radio',{name:/^Decide/}).click();
  await inbox.getByRole('button',{name:'Approve',exact:true}).first().click();
  const card=page.getByRole('alertdialog');await expect(card).toBeVisible();
  await expect(card).toContainText('approve this version?');
  for(const term of ['What','Where','Undo'])await expect(card.getByText(term,{exact:true}).first()).toBeVisible();
  await expect(card.getByRole('button',{name:'Request changes',exact:true})).toBeVisible();
  await card.getByRole('button',{name:'Cancel',exact:true}).click();await expect(card).toBeHidden();

  // 2) 日本語: 일본어 메뉴·제목·안건.
  await choose(page,'Language','日本語');
  await expect(page.locator('html')).toHaveAttribute('lang','ja');
  await page.goto('/');await expect(agenda(page,'今日の議題')).toBeVisible();
  await expect(page.getByRole('heading',{level:1})).toHaveText('ワークスペース');
  if(desktop)await expect(page.getByRole('navigation',{name:'メインメニュー'}).getByRole('button',{name:'キャンペーン'})).toBeVisible();

  // 3) 한국어로 되돌리면 원래 문구와 lang=ko.
  await choose(page,'言語','한국어');
  await expect(page.locator('html')).toHaveAttribute('lang','ko');
  await page.goto('/');await expect(agenda(page,'오늘의 안건')).toBeVisible();
  await expect(page.getByRole('heading',{level:1})).toHaveText('워크스페이스');
  if(desktop)await expect(page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'캠페인'})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('locale'))).toBe('ko');
 }finally{await context.close()}
});

// GLOBAL-PLAN G6 2단계(모바일·데스크톱): 캠페인 상세 틀·탭과 제작·발행 탭이 영어·일본어로 바뀌고, 한국어는 이전 문구 그대로다(QA 2026-11-09 D7).
// 저장된 언어(localStorage locale)로 연다. 캠페인 이름·작업물 본문(사용자 자료)은 번역하지 않는다. Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음.
const HANGUL=/[가-힣]/;
async function openTab(page:Page,name:string|RegExp){const tab=page.getByRole('tab',{name,exact:typeof name==='string'}).first();await tab.click();await expect(tab).toHaveAttribute('aria-selected','true')}
test('캠페인 상세 탭·제작·발행: 영어·일본어 머리말, 한국어 그대로',async({browser},info)=>{
 test.setTimeout(120_000);
 const {context,page,post}=await taskContext(browser,info,'i18n2',1);
 try{
  const title=`언어 상세 ${info.project.name}`;
  const {id}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title,goal:'상세 화면 언어 확인'}}) as {id:string};
  await post('/api/action',{action:'save_artifact',campaignId:id,role:'strategy',title:'상세 언어 초안',content:'## 방향\n합성 본문'});
  const open=async(locale:string,ctab='')=>{await page.goto('/');await page.evaluate(l=>localStorage.setItem('locale',l),locale);await page.goto(`/?view=campaigns&campaign=${id}${ctab?`&ctab=${ctab}`:''}`);await expect(page.locator('html')).toHaveAttribute('lang',locale);await expect(page.getByRole('heading',{level:1,name:title})).toBeVisible()};

  // English: 이동 경로·탭·브리프·AI 팀·작업물·성과·이력·팀 회의·제작·발행
  await open('en');
  await expect(page.getByRole('navigation',{name:'Breadcrumb'}).getByRole('button',{name:'Campaign list'})).toBeVisible();
  const tabs=page.getByRole('tablist').first();
  for(const name of ['Brief','Team meeting','AI team','Growth & sales','Meta ads prep','Production & publishing','Performance','History'])await expect(tabs.getByRole('tab',{name,exact:true})).toBeVisible();
  await expect(tabs.getByRole('tab',{name:/^Deliverables/})).toBeVisible();
  expect(HANGUL.test(await tabs.innerText())).toBe(false);
  await expect(page.getByText('Campaign goal',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Edit brief'})).toBeVisible();
  await openTab(page,'AI team');await expect(page.getByRole('heading',{name:'8 areas of expertise, one goal'})).toBeVisible();
  await openTab(page,/^Deliverables/);await expect(page.getByRole('heading',{name:'Deliverables to review',exact:true})).toBeVisible();
  await openTab(page,'Performance');await expect(page.getByRole('heading',{name:'Measured results',exact:true})).toBeVisible();
  await openTab(page,'History');await expect(page.getByRole('heading',{name:'Compare deliverable versions',exact:true})).toBeVisible();
  await openTab(page,'Team meeting');await expect(page.getByRole('heading',{name:"From each other's opinions to a better execution plan."})).toBeVisible();
  await openTab(page,'Production & publishing');
  await expect(page.getByRole('heading',{level:2,name:'Production & publishing',exact:true})).toBeVisible();
  await expect(page.getByText(/^Confirmed brand facts → PNG production/)).toBeVisible();

  // 日本語: 탭과 제작·발행 머리말
  await open('ja','execution');
  await expect(page.getByRole('tablist').first().getByRole('tab',{name:'ブリーフ',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{level:2,name:'制作・公開',exact:true})).toBeVisible();

  // 한국어: 이전 문구 그대로
  await open('ko');
  for(const name of ['브리프','팀 회의','AI 팀','제작·발행','성과','이력'])await expect(page.getByRole('tablist').first().getByRole('tab',{name,exact:true})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'이동 경로'}).getByRole('button',{name:'캠페인 목록'})).toBeVisible();
  await expect(page.getByText('캠페인 목표',{exact:true})).toBeVisible();
 }finally{await context.close()}
});

// GLOBAL-PLAN G6 3단계(모바일·데스크톱, QA 2026-11-15 N2): 영어·일본어에서 작업물 대화상자의 신뢰 UI(규정 점검·출처 배지·수정 사유·검토자 링크)·안건 제목·카카오·플레이스 초안·광고 제안 카드 틀에 한글이 남지 않는다.
// 한글 비율은 그 영역 글자에서 시드한 사용자 자료(캠페인·작업물·지점 이름, 리뷰·제안 문장, 초안 문장)를 뺀 값이다. 한국어는 이전 문구 그대로다. Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음.
const hangulRatio=(loc:ReturnType<Page['locator']>,exclude:readonly string[]=[])=>loc.evaluate((el,ex)=>{let text=(el as HTMLElement).innerText;for(const x of ex)text=text.split(x).join('');const letters=text.replace(/\s/g,'').length,h=(text.match(/[가-힣]/g)??[]).length;return letters?h/letters:1},[...exclude].sort((a,b)=>b.length-a.length));
// 한글이 남은 줄을 실패 메시지에 싣는다(무엇이 번역되지 않았는지 바로 보이게).
const hangulLines=(loc:ReturnType<Page['locator']>,exclude:readonly string[]=[])=>loc.evaluate((el,ex)=>{let text=(el as HTMLElement).innerText;for(const x of ex)text=text.split(x).join('');return text.split('\n').filter(l=>/[가-힣]/.test(l)).slice(0,6).join(' | ')},[...exclude].sort((a,b)=>b.length-a.length));
const expectChrome=async(loc:ReturnType<Page['locator']>,label:string,exclude:readonly string[]=[],limit=0.02)=>{const r=await hangulRatio(loc,exclude);expect(r,`${label} Hangul ratio ${r.toFixed(3)}: ${r>=limit?await hangulLines(loc,exclude):''}`).toBeLessThan(limit)};
const phase3={
 en:{agenda:'Today’s agenda',decide:/^Decide/,artifactRow:'Content studio deliverable awaiting review',placeRow:'Place review reply awaiting approval',compliance:'Compliance check',recheck:'Check again',reasons:'Reasons for changes',origin:'Added manually',place:'Place review replies & news drafts',ads:'Naver search ads proposals',kakao:'Kakao Business Message (dealer)',reviewer:'Reviewer links'},
 ja:{agenda:'今日の議題',decide:/^決定/,artifactRow:'コンテンツスタジオの作業物がレビュー待ち',placeRow:'プレイスのレビュー返信が承認待ち',compliance:'規定チェック',recheck:'再チェック',reasons:'修正依頼の理由',origin:'直接登録',place:'プレイスのレビュー返信・お知らせ下書き',ads:'Naver検索広告の提案',kakao:'カカオビジネスメッセージ(ディーラー)',reviewer:'レビュアーリンク'},
 ko:{agenda:'오늘의 안건',decide:/^결정/,artifactRow:'콘텐츠 스튜디오 작업물 검토 대기',placeRow:'플레이스 리뷰 답글 승인 대기',compliance:'규정 점검',recheck:'다시 점검',reasons:'수정 요청 사유',origin:'직접 등록',place:'플레이스 리뷰 답글·소식 초안',ads:'네이버 검색광고 제안',kakao:'카카오 비즈메시지(딜러)',reviewer:'검토자 링크'},
} as const;
test('신뢰 UI·안건 제목·설정 카드: 영어·일본어에 한국어 틀이 없고 한국어는 그대로',async({browser},info)=>{
 test.setTimeout(240_000);
 const {context,page,post}=await taskContext(browser,info,'i18n3',1);
 try{
  for(const flag of ['share_links','place_drafts'])expect((await page.request.post('/api/feature-flags',{data:{action:'set',flag,enabled:true}})).status()).toBe(200);
  const title=`언어 신뢰 ${info.project.name}`,artifactTitle=`신뢰 초안 ${info.project.name}`,storeName=`언어 지점 ${info.project.name}`,review='음식이 맛있고 친절했어요. 또 올게요.',rationale='E2E 다시 켜기 제안';
  const {id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title,goal:'신뢰 화면 언어'}}) as {id:string};
  await post('/api/action',{action:'save_artifact',campaignId,role:'content',title:artifactTitle,content:'## 카피\n합성 본문'});
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:storeName,address:'합성 주소',tradeArea:'residential',goal:'언어'}}) as {id:string};
  await post('/api/place-drafts',{action:'create',kind:'review_reply',storeId,sourceText:review,rating:5});
  const seeded=await post('/api/ads-proposals',{action:'create',kind:'resume',campaignId:'e2e-ncc-1',operation:{op:'set_user_lock',target:'keyword',ids:['nkw-e2e-1'],userLock:false},rationale}) as {proposal:{id:string}};
  const day=(n:number)=>new Date(Date.now()-n*86_400_000).toISOString().slice(0,10);
  await post('/api/action',{action:'save_metric',campaignId,schemaVersion:2,periodStart:day(13),periodEnd:day(7),scope:'전체 주문',source:'POS 정산서',definition:'KST 순매출',method:'export',revenue:412000,orders:20,variableCosts:100000,adSpend:30000,productionCost:0});
  const user=[title,artifactTitle,storeName,review,rationale,'합성 본문'];
  for(const locale of ['en','ja','ko'] as const){
   const n=phase3[locale],translated=locale!=='ko';
   await page.goto('/');await page.evaluate(l=>localStorage.setItem('locale',l),locale);
   await page.goto('/');await expect(page.locator('html')).toHaveAttribute('lang',locale);
   // 안건 제목(서버 titleKey): 작업물 검토·플레이스 초안 행의 제목 글자
   const inbox=agenda(page,n.agenda);await expect(inbox).toBeVisible();
   await inbox.getByRole('radio',{name:n.decide}).click();
   for(const row of [n.artifactRow,n.placeRow]){const b=inbox.locator('[data-inbox-row] b').filter({hasText:row}).first();await expect(b,`${locale} agenda ${row}`).toHaveText(row);if(translated)expect(await hangulRatio(b)).toBe(0)}
   // 작업물 대화상자: 규정 점검 패널·출처 배지·수정 사유 칩·검토자 링크 카드
   await page.goto(`/?view=campaigns&campaign=${campaignId}&ctab=outputs`);
   const item=page.locator('.artifact-item').filter({hasText:artifactTitle});await expect(item).toBeVisible({timeout:30_000});
   await expect(item.locator('.origin-badge')).toHaveText(n.origin);
   await item.locator('.artifact-row').click();
   const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
   const panel=dialog.getByRole('region',{name:n.compliance,exact:true});await expect(panel).toBeVisible();
   await expect(panel.getByRole('button',{name:n.recheck,exact:true})).toBeVisible();
   await expect(panel.locator('.meta-line').first()).toBeVisible();
   const reasons=dialog.getByRole('group',{name:n.reasons,exact:true});await expect(reasons).toBeVisible();
   const share=dialog.getByRole('region',{name:`${n.reviewer} ${artifactTitle}`});await expect(share).toBeVisible();
   if(translated)for(const [label,region] of [['compliance',panel],['reasons',reasons],['reviewer links',share]] as const)await expectChrome(region,`${locale} ${label}`,user);
   await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
   // 광고 제안 카드(캠페인 성과 탭)
   await page.goto(`/?view=campaigns&campaign=${campaignId}&ctab=results`);
   const ads=page.getByRole('region',{name:n.ads,exact:true});await expect(ads).toBeVisible({timeout:30_000});
   await expect(ads.locator(`[data-proposal="${seeded.proposal.id}"]`)).toContainText(rationale);
   if(translated)await expectChrome(ads,`${locale} ads card`,user);
   // 플레이스 초안 카드(점포 마케팅 > 지점 > 채널 점검). 초안 문장(규칙으로 만든 답글)은 사용자 자료로 뺀다.
   await page.goto(`/?view=stores&brand=ofd&store=${encodeURIComponent(storeId)}&tab=channels`);
   const place=page.getByRole('region',{name:n.place,exact:true});await expect(place).toBeVisible({timeout:30_000});
   await expect(place.locator('[data-place-draft]').first()).toBeVisible();
   const listing=await (await page.request.get('/api/place-drafts?storeId='+encodeURIComponent(storeId))).json() as {drafts:{draft:{text:string}}[]};
   const draft=[...listing.drafts.flatMap(d=>d.draft.text.split('\n')),...await place.locator('[data-place-draft] ul li').allInnerTexts()];
   if(translated)await expectChrome(place,`${locale} place card`,[...user,...draft]);
   // 카카오 카드(설정 > 채널 연결)
   await page.goto('/?view=settings&section=channels');
   const kakao=page.locator('[data-channel="kakao"]');await expect(kakao).toBeVisible({timeout:30_000});await expect(kakao).toContainText(n.kakao);
   if(translated)await expectChrome(kakao,`${locale} kakao card`,user);
  }
 }finally{await context.close()}
});

import {test,expect} from '@playwright/test';
// UX-PLAN-3 10.3 사람 개입 최소화: 안건에서 바로 '내가 맡기'(한 번 클릭), 저장 뒤 다음 단계, 작성하던 초안 이어 쓰기, 직전 미션 값 채우기.
// Real local D1/API/Chromium. 주문은 실제 점포 운영 API로 만든다. 인증 헤더 mocked. 외부 호출 없음.
test('안건 한 번 클릭 처리·다음 단계·초안 이어 쓰기·직전 값 채우기',async({browser},info)=>{
 const owner=`ease-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'쉬운 사용 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'안건'}});
  const title=`쉬운 사용 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'안건'}});
  const day=(n:number)=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);
  const order=(n:number,no:string)=>post('/api/store-operations',{action:'save_order',storeId,data:{source:'direct',orderNumber:no,orderDate:day(n),mode:'delivery',status:'paid',paidAmount:10000,refundAmount:0,channel:'unknown',campaignId,attributionEvidence:'운영자 확인'}});
  for(let i=0;i<14;i++)await order(i%7,'R'+i);for(let i=0;i<21;i++)await order(7+i,'B'+i);
  await post('/api/growth/detections',{action:'detect',campaignId,campaignVersion:1});
  // 1) 홈 안건에서 한 번 클릭으로 담당을 맡는다(기본값: 담당=로그인 계정, 다음 행동=신호 제목, 기한=권장일).
  await page.goto('/');const agenda=page.getByRole('region',{name:'오늘의 안건',exact:true});
  const quick=agenda.getByRole('button',{name:'최근 7일 유료 주문 증가 내가 맡기',exact:true});await expect(quick).toBeVisible();
  await quick.click();info.annotations.push({type:'clicks:signal-triage',description:'1'});
  await expect(agenda.getByRole('status')).toContainText('1건을 맡았습니다.');
  await expect(agenda.getByRole('button',{name:'최근 7일 유료 주문 증가 내가 맡기',exact:true})).toHaveCount(0);
  const detections=await (await page.request.get(`/api/growth/detections?campaignId=${campaignId}`)).json() as {signals:{status:string;detection:{title:string};triage:{assignee:string;nextAction:string;dueBy:string}|null}[]};
  const acknowledged=detections.signals.find(s=>s.detection.title==='최근 7일 유료 주문 증가');
  expect(acknowledged?.status).toBe('acknowledged');expect(acknowledged?.triage?.nextAction).toContain('최근 7일 유료 주문 증가');expect(acknowledged?.triage?.dueBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // 2) 저장 뒤 다음 단계로 바로 간다.
  await page.goto(`/?view=campaigns&campaign=${campaignId}&ctab=growth`);
  const panel=page.getByRole('region',{name:'성장2 판매 워크스페이스',exact:true});await expect(panel.getByRole('navigation',{name:'성장 작업 단계'})).toBeVisible();
  await panel.getByLabel('근거 제목',{exact:true}).fill('동네 저녁 수요 관찰');await panel.getByLabel('공개 출처 URL',{exact:true}).fill('https://example.com/evidence');await panel.getByLabel('근거 유효기한',{exact:true}).fill('2099-01-01');await panel.getByLabel('관측 요약',{exact:true}).fill('저녁 시간 주문 문의가 늘었다.');
  // 서버 검증 오류는 그 칸에 붙고 초점이 그 칸으로 간다(UX-PLAN-3 Q3). 고치면 표시가 사라진다.
  const url=panel.getByLabel('공개 출처 URL',{exact:true});await url.fill('http://example.com/evidence');
  await panel.getByRole('button',{name:'시장 근거 저장',exact:true}).click();
  await expect(url).toHaveAttribute('aria-invalid','true');await expect(url).toBeFocused();await expect(url).toHaveAccessibleDescription(/HTTPS URL/);
  await url.fill('https://example.com/evidence');await expect(url).not.toHaveAttribute('aria-invalid','true');
  await panel.getByRole('button',{name:'시장 근거 저장',exact:true}).click();await expect(panel.getByRole('status')).toHaveText('서버에 저장했습니다.');
  await panel.getByRole('button',{name:'다음 단계: 고객·기회 만들기 →',exact:true}).click();
  await expect(panel.getByRole('button',{name:'고객·기회',exact:true})).toHaveAttribute('aria-pressed','true');
  // 3) 작성하던 새 기록은 새로고침 뒤에도 이어 쓴다(이 브라우저에만 보관).
  const needTitle=panel.getByLabel('니즈 가설 제목',{exact:true});await needTitle.fill('퇴근길 1인 가구 저녁');
  page.once('dialog',d=>void d.accept());await page.reload();
  await page.getByRole('button',{name:'고객·기회',exact:true}).click();
  await panel.getByRole('button',{name:'이어 쓰기',exact:true}).click();await expect(needTitle).toHaveValue('퇴근길 1인 가구 저녁');
  // 4) 직전 미션의 담당·채널·중단 기준을 한 번에 채운다.
  page.once('dialog',d=>void d.accept());await panel.getByRole('button',{name:'판매 미션',exact:true}).click();
  await panel.getByLabel('미션 제목',{exact:true}).fill('첫 미션');await panel.getByLabel('실행 담당 역할',{exact:true}).fill('매장 매니저');await panel.getByLabel('중단 기준',{exact:true}).fill('손실 한도 도달');
  await panel.getByRole('button',{name:'판매 미션 저장',exact:true}).click();await expect(panel.getByRole('status')).toHaveText('서버에 저장했습니다.');
  await panel.getByRole('button',{name:'새 판매 미션',exact:true}).click();
  await panel.getByRole('button',{name:'직전 미션의 담당·채널·중단 기준 채우기',exact:true}).click();
  await expect(panel.getByLabel('실행 담당 역할',{exact:true})).toHaveValue('매장 매니저');await expect(panel.getByRole('textbox',{name:'중단 기준',exact:true})).toHaveValue('손실 한도 도달');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});

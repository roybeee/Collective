// 실제 로컬 Chromium/D1/R2와 인증 fixture. 네이버 화면·업로드 실행은 호출하지 않는다.
import {test,expect} from '@playwright/test';

test('요일별 익일 시간 변경안은 사람이 읽는 내용으로 승인되고 보존된다',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`weekly-${info.project.name}-${Date.now()}`}});
 const page=await context.newPage();
 const post=async(url:string,data:Record<string,unknown>)=>{const r=await page.request.post(url,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
 try{
  await page.request.get('/api/workspace');await post('/api/feature-flags',{action:'set',flag:'store_browser_execution',enabled:true});
  const store=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'요일별 합성 매장',address:'합성 주소',tradeArea:'residential',goal:'요일별 시간 확인'}});
  const registered=await post('/api/store-browser',{action:'register_device',label:'요일별 테스트 컴퓨터',profileId:'u0'});
  await post('/api/store-browser',{action:'save_binding',storeId:store.id,naverPlaceId:'10001',managerBusinessId:'20002',managerUrl:'https://new.smartplace.naver.com/bizes/place/20002',publicUrl:'https://place.naver.com/restaurant/10001/home',deviceId:registered.device.id,profileId:'u0'});
  await page.goto(`/?view=stores&brand=ofd&store=${encodeURIComponent(store.id)}&tab=channels`);
  const panel=page.getByRole('region',{name:'네이버 매장 관리',exact:true});await expect(panel).toBeVisible();
  await expect(panel.getByText('실행 프로그램·브라우저·로그인 상태 확인 전입니다.',{exact:true})).toBeVisible();
  await panel.getByText('요일별 영업시간 관리',{exact:true}).click();
  for(const prefix of ['현재','변경']){
   for(const day of ['월요일','화요일','수요일','목요일','금요일','토요일','일요일'])await panel.getByRole('combobox',{name:`${prefix} ${day} 상태`,exact:true}).selectOption(day==='월요일'?'open':'closed');
   await panel.getByLabel(`${prefix} 월요일 1 시작`,{exact:true}).fill('20:00');
   await panel.getByLabel(`${prefix} 월요일 1 종료`,{exact:true}).fill(prefix==='현재'?'02:00':'03:00');
   await panel.getByRole('group',{name:prefix,exact:true}).getByRole('checkbox',{name:'다음 날 종료',exact:true}).check();
  }
  await panel.getByRole('button',{name:'요일별 변경안 저장',exact:true}).click();
  await expect(panel.getByText('월요일: 20:00–다음 날 03:00',{exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'위 내용으로 변경 승인',exact:true}).click();await page.reload();
  await expect(panel.getByText('공개 화면 확인 전',{exact:true})).toBeVisible();
  const listing=await (await page.request.get('/api/store-browser?storeId='+store.id)).json();
  expect(listing.jobs[0].type).toBe('change_weekly_hours');expect(listing.jobs[0].status).toBe('approved');expect(listing.jobs[0].afterSchedule.mon.intervals[0]).toEqual({start:'20:00',end:'03:00',endsNextDay:true});
  expect(listing.jobs[0].submissionStartedAt).toBeUndefined();expect(await panel.innerText()).not.toContain('"intervals"');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 }finally{await context.close()}
});

test('사진 원본 삭제·점포 보관·기능 OFF 이후에도 사용 권리를 회수한다',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`photo-revoke-${info.project.name}-${Date.now()}`}}),page=await context.newPage();
 const post=async(url:string,data:Record<string,unknown>)=>{const r=await page.request.post(url,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
 try{
  await page.request.get('/api/workspace');await post('/api/feature-flags',{action:'set',flag:'store_browser_execution',enabled:true});
  const store=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'권리 회수 합성 매장',address:'합성 주소',tradeArea:'residential',goal:'사진 권리 회수'}});
  const upload=await page.request.post('/api/archive/file',{multipart:{brandId:'ofd',title:'회수할 합성 사진',content:'권리 회수 테스트용 합성 이미지',file:{name:'rights-photo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64')}}});
  expect(upload.status(),await upload.text()).toBe(200);const source=await upload.json();await post('/api/archive',{action:'review_source',brandId:'ofd',id:source.id,version:1,status:'confirmed'});
  const rights=(await post('/api/store-browser',{action:'save_photo_rights',storeId:store.id,sourceId:source.id,sourceVersion:2,permission:'owned',evidence:'직접 만든 합성 이미지',validUntil:new Date(Date.now()+7*24*60*60*1000).toISOString()})).rights;
  await page.goto(`/?view=stores&brand=ofd&store=${encodeURIComponent(store.id)}&tab=channels`);const panel=page.getByRole('region',{name:'네이버 매장 관리',exact:true});await expect(panel.getByRole('button',{name:'사진 사용 권리 회수',exact:true})).toBeVisible();
  await post('/api/archive',{action:'delete_source_file',brandId:'ofd',id:source.id,version:2});await post('/api/stores',{action:'archive_store',storeId:store.id,version:1});await post('/api/feature-flags',{action:'set',flag:'store_browser_execution',enabled:false});
  await page.reload();await expect(page.getByText('보관한 점포의 네이버 관리',{exact:true})).toBeVisible();await page.getByText('보관한 점포의 네이버 관리',{exact:true}).click();await page.getByText('권리 회수 합성 매장',{exact:true}).click();await expect(panel.getByText('새 작업이 꺼져 있습니다.',{exact:false})).toBeVisible();await expect(panel.getByText('사진 원본 조회 불가',{exact:true})).toBeVisible();
  await expect(panel.getByRole('button',{name:'컴퓨터 저장',exact:true})).toHaveCount(0);await expect(panel.getByRole('button',{name:'변경안 만들기',exact:true})).toHaveCount(0);
  const revoked=page.waitForResponse(r=>r.url().endsWith('/api/store-browser')&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='revoke_photo_rights');
  await panel.getByRole('button',{name:'사진 사용 권리 회수',exact:true}).click();const response=await revoked;expect(response.status(),await response.text()).toBe(200);await expect(panel.getByText('회수됨',{exact:true})).toBeVisible();
  const listing=await (await page.request.get('/api/store-browser?storeId='+store.id)).json();expect(listing.enabled).toBe(false);expect(listing.photoSources).toHaveLength(0);expect(listing.photoRights.find((r:{id:string})=>r.id===rights.id).status).toBe('revoked');expect(listing.photoRights[0].version).toBe(rights.version+1);
  await expect(panel.getByRole('button',{name:'사진 사용 권리 회수',exact:true})).toHaveCount(0);
 }finally{await context.close()}
});

test('아카이브 사진의 권리를 기록하고 파일을 고정한 업로드안을 승인한다',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`photo-${info.project.name}-${Date.now()}`}});
 const page=await context.newPage();
 const post=async(url:string,data:Record<string,unknown>)=>{const r=await page.request.post(url,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
 try{
  await page.request.get('/api/workspace');await post('/api/feature-flags',{action:'set',flag:'store_browser_execution',enabled:true});
  const store=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'사진 합성 매장',address:'합성 주소',tradeArea:'residential',goal:'사진 확인'}});
  const registered=await post('/api/store-browser',{action:'register_device',label:'사진 테스트 컴퓨터',profileId:'u0'});
  await post('/api/store-browser',{action:'save_binding',storeId:store.id,naverPlaceId:'10001',managerBusinessId:'20002',managerUrl:'https://new.smartplace.naver.com/bizes/place/20002',deviceId:registered.device.id,profileId:'u0'});
  const upload=await page.request.post('/api/archive/file',{multipart:{brandId:'ofd',title:'합성 매장 사진 원본',content:'합성 이미지 fixture',file:{name:'fixture-photo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64')}}});
  expect(upload.status(),await upload.text()).toBe(200);const source=await upload.json();
  await post('/api/archive',{action:'review_source',brandId:'ofd',id:source.id,version:1,status:'confirmed'});
  await page.goto(`/?view=stores&brand=ofd&store=${encodeURIComponent(store.id)}&tab=channels`);
  const panel=page.getByRole('region',{name:'네이버 매장 관리',exact:true});await expect(panel).toBeVisible();await panel.getByText('매장 사진 업로드',{exact:true}).click();
  await panel.getByRole('combobox',{name:'아카이브 사진 원본',exact:true}).selectOption(source.id);
  await panel.getByRole('textbox',{name:'사용 권리 근거',exact:true}).fill('테스트를 위해 직접 만든 합성 이미지');
  const expires=new Date(Date.now()+7*24*60*60*1000).toISOString().slice(0,10);await panel.getByLabel('사용 권리 유효기간',{exact:true}).fill(expires);
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/store-browser')&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='save_photo_rights');
  await panel.getByRole('button',{name:'사진 사용 권리 저장',exact:true}).click();const response=await saved;expect(response.status(),await response.text()).toBe(200);await expect(panel.getByText('선택한 사진의 사용 권리가 기록되었습니다.',{exact:false})).toBeVisible();
  await panel.getByRole('button',{name:'사진 업로드 변경안 저장',exact:true}).click();await expect(panel.getByText('승인 대기',{exact:false})).toBeVisible();
  await panel.getByRole('button',{name:'위 내용으로 변경 승인',exact:true}).click();await page.reload();
  const listing=await (await page.request.get('/api/store-browser?storeId='+store.id)).json();expect(listing.jobs[0].type).toBe('upload_photo');expect(listing.jobs[0].status).toBe('approved');expect(listing.jobs[0].photo.sourceId).toBe(source.id);expect(listing.jobs[0].photo.sha256).toMatch(/^[a-f0-9]{64}$/);expect(listing.jobs[0].submissionStartedAt).toBeUndefined();
  await expect(panel.getByText('공개 화면 확인 전',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 }finally{await context.close()}
});

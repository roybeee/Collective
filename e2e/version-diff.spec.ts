import {test,expect} from '@playwright/test';
// X8 어절 단위 버전 비교. Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음.
// 이력 탭에서 두 버전의 추가·삭제 어절이 보이고(색만이 아니라 '추가'·'삭제' 글자 포함), 일부만 받아 새 버전을 저장하고, 이전 버전으로 되돌리면 새 버전이 생긴다(이력은 그대로).
const V1='봄 신메뉴 딸기 도넛 출시. 매장에서 만나 보세요.';
const V2='봄 한정 신메뉴 딸기 도넛 출시. 지금 매장에서 만나 보세요!';
test('이력 탭에서 어절 비교, 부분 수락, 되돌리기가 새 버전을 만든다',async({browser},info)=>{
 test.setTimeout(90_000);
 const owner=`diff-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(data:unknown)=>{const r=await page.request.post('/api/action',{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
  await page.request.get('/api/workspace');
  const {id}=await post({action:'save_campaign',data:{brandId:'ofd',title:'버전 비교 '+info.project.name,goal:'버전 비교 확인',budget:0}});
  const first=await post({action:'save_artifact',campaignId:id,role:'strategy',title:'전략 초안',content:V1});
  await post({action:'save_artifact',id:first.id,campaignId:id,version:1,role:'strategy',title:'전략 초안',content:V2});
  await page.goto(`/?view=campaigns&campaign=${id}&ctab=history`);
  const diff=page.getByRole('group',{name:'버전 비교',exact:true});
  await expect(diff).toBeVisible({timeout:15_000});
  await expect(diff.locator('ins')).toHaveText(['추가: 한정','추가: 지금','추가: 보세요!']);
  await expect(diff.locator('del')).toHaveText(['삭제: 보세요.']);
  await expect(page.getByText('바뀐 부분 3곳',{exact:true})).toBeVisible();
  // 나란히 보기: 왼쪽은 삭제만, 오른쪽은 추가만 보인다.
  await page.getByRole('radio',{name:'나란히 보기',exact:true}).click();
  await expect(diff.getByRole('region',{name:'이전 버전 v1',exact:true}).locator('del')).toHaveCount(1);
  await expect(diff.getByRole('region',{name:'비교할 버전 v2',exact:true}).locator('ins')).toHaveCount(3);
  await page.getByRole('radio',{name:'한 줄로 보기',exact:true}).click();
  // 부분 수락: 첫 바뀐 부분('한정')만 받아 새 버전으로 저장한다.
  const hunks=page.getByRole('list',{name:'바뀐 부분',exact:true});
  await expect(hunks.getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('button',{name:'고른 부분 넣어 새 버전 저장',exact:true})).toBeDisabled();
  await hunks.getByRole('listitem').first().getByRole('button',{name:'이 부분 받기',exact:true}).click();
  const merged='봄 한정 신메뉴 딸기 도넛 출시. 매장에서 만나 보세요.';
  await expect(page.getByRole('region',{name:'합친 글',exact:true}).locator('.vd-text')).toHaveText(merged);
  await page.getByRole('button',{name:'고른 부분 넣어 새 버전 저장',exact:true}).click();
  const dialog=page.getByRole('alertdialog');await expect(dialog).toContainText('새 버전 v3');
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/action')&&r.request().postDataJSON()?.action==='save_artifact');
  await dialog.getByRole('button',{name:'새 버전으로 저장',exact:true}).click();expect((await saved).status()).toBe(200);
  await expect(page.getByText('고른 부분을 넣은 새 버전을 저장했습니다.',{exact:true})).toBeVisible();
  let detail=await(await page.request.get('/api/campaigns/'+id)).json();
  const current=detail.artifacts.find((a:{id:string})=>a.id===first.id);
  expect(current).toMatchObject({version:3,content:merged,status:'review'});
  expect(detail.history.map((h:{version:number;content:string})=>[h.version,h.content]).toSorted()).toEqual([[1,V1],[2,V2]]);
  // 되돌리기: 이전 버전 v1을 골라 되돌리면 v4가 v1 내용으로 생기고, 이력의 v1·v2·v3는 그대로다.
  const leftSelect=page.getByRole('combobox',{name:'이전 버전',exact:true});
  await expect(leftSelect.locator('option',{hasText:/^브랜드 전략 v3/})).toHaveCount(1);
  const v1Option=await leftSelect.locator('option',{hasText:/^브랜드 전략 v1/}).getAttribute('value');
  await leftSelect.selectOption(v1Option!);
  const revert=page.getByRole('button',{name:'이 버전으로 되돌리기',exact:true});await expect(revert).toBeEnabled();
  await revert.click();
  const revertDialog=page.getByRole('alertdialog');await expect(revertDialog).toContainText('새 버전 v4');
  await revertDialog.getByRole('button',{name:'새 버전으로 되돌리기',exact:true}).click();
  await expect(page.getByText('이전 버전 내용으로 새 버전을 저장했습니다.',{exact:true})).toBeVisible();
  detail=await(await page.request.get('/api/campaigns/'+id)).json();
  expect(detail.artifacts.find((a:{id:string})=>a.id===first.id)).toMatchObject({version:4,content:V1});
  expect(detail.history.map((h:{version:number;content:string})=>[h.version,h.content]).toSorted()).toEqual([[1,V1],[2,V2],[3,merged]]);
  // 고른 이전 버전이 현재 버전이면 되돌리기는 이유와 함께 막힌다.
  const currentOption=await leftSelect.locator('option',{hasText:/^브랜드 전략 v4/}).getAttribute('value');
  await leftSelect.selectOption(currentOption!);
  await expect(page.getByRole('button',{name:'이 버전으로 되돌리기',exact:true})).toBeDisabled();
  await page.screenshot({path:`e2e/artifacts/${info.project.name}-version-diff.png`,fullPage:true});
 }finally{await context.close()}
});

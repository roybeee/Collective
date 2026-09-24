// security-ops-12(PR 6c): 업로드 자료의 본문 출처와 원본 파일 삭제. 로컬 빌드(wrangler --local, 실제 D1/R2 시뮬레이터)에서 확인한다.
// 인증은 smoke.spec.ts와 같이 oai-authenticated-user-id 헤더를 붙여 재현한다(mocked auth, legacy 모드에서는 소유자=관리자). 외부 호출 없음.
// TXT·MD·CSV·JSON은 서버가 업로드 바이트에서 본문을 다시 읽고(브라우저가 보낸 content 무시), 이미지·PDF·DOCX는 자료 상세·목록 행·후보 일괄 검토에 '브라우저 추출(서버 미검증)'으로 표시한다.
// '원본 파일 삭제'는 자료 기록·추출 텍스트·검토 상태를 남기고 원본 다운로드만 404로 닫는다.
import {test, expect} from '@playwright/test';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

test('업로드 텍스트는 서버가 다시 읽어 표시하고 원본 파일만 삭제한다', async ({browser}, testInfo) => {
  test.setTimeout(60_000);
  const {baseURL, viewport} = testInfo.project.use;
  const context = await browser.newContext({baseURL, viewport, extraHTTPHeaders: {'oai-authenticated-user-id': `e2e-upload-${testInfo.project.name}-${Date.now()}`}});
  const page = await context.newPage();
  await page.request.get('/api/workspace');
  const detailOf = async (id: string) => (await page.request.get(`/api/archive?brandId=ofd&sourceId=${encodeURIComponent(id)}`)).json();

  // 브라우저가 content·extraction을 꾸며 보내도 텍스트 형식은 서버가 바이트에서 읽은 본문과 '서버 추출' 출처로 저장된다.
  const forged = await page.request.post('/api/archive/file', {multipart: {brandId: 'ofd', title: '위조 본문 검증', content: '브라우저가 꾸민 본문', extraction: '서버 추출 · 텍스트 추출 완료', file: {name: 'forged.txt', mimeType: 'text/plain', buffer: Buffer.from('서버가 읽은 실제 본문', 'utf8')}}});
  expect(forged.status()).toBe(200);
  const forgedDetail = await detailOf((await forged.json()).id);
  expect(forgedDetail.content).toBe('서버가 읽은 실제 본문');
  expect(forgedDetail.extraction).toBe('서버 추출 · 텍스트 추출 완료');

  // 서버가 해석하지 않는 이미지는 브라우저 추출값에 '서버 미검증' 출처가 붙는다.
  const imageTitle = `이미지 출처 검증 ${testInfo.project.name}`;
  const image = await page.request.post('/api/archive/file', {multipart: {brandId: 'ofd', title: imageTitle, extraction: '이미지 원본 보관 · 내용 메모 필요', file: {name: 'poster.png', mimeType: 'image/png', buffer: Buffer.concat([Buffer.from(PNG_SIGNATURE), Buffer.from('e2e')])}}});
  expect(image.status()).toBe(200);
  expect((await detailOf((await image.json()).id)).extraction).toBe('브라우저 추출(서버 미검증) · 이미지 원본 보관 · 내용 메모 필요');
  const pdfTitle = `PDF 출처 검증 ${testInfo.project.name}`;
  const pdf = await page.request.post('/api/archive/file', {multipart: {brandId: 'ofd', title: pdfTitle, content: 'E2E PDF 본문 텍스트', extraction: '텍스트 추출 완료', extractionScope: 'PDF 1/1페이지 텍스트', scope: '대표 제공 자료', file: {name: 'brief.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n1 0 obj\n', 'utf8')}}});
  expect(pdf.status()).toBe(200);

  // 화면 업로드: TXT 원문과 추가 메모.
  await page.goto('/?view=brands&brand=ofd&tab=sources');
  await expect(page.getByRole('tab', {name: /^자료 아카이브/})).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', {name: '자료 추가', exact: true}).click();
  const add = page.getByRole('dialog', {name: '브랜드 자료 추가'});
  const fileInput = add.locator('input[type="file"]');
  await expect(fileInput).toBeEnabled();
  const fileName = `e2e-upload-${testInfo.project.name}.txt`, body = 'E2E 업로드 원문: 평일 오후 방문 이유를 확인한다.', memo = 'E2E 추가 메모';
  await fileInput.setInputFiles({name: fileName, mimeType: 'text/plain', buffer: Buffer.from(body, 'utf8')});
  await add.getByLabel('추가 메모').fill(memo);
  const uploaded = page.waitForResponse(r => r.url().endsWith('/api/archive/file') && r.request().method() === 'POST');
  await add.getByRole('button', {name: '자료 보관'}).click();
  const response = await uploaded;
  expect(response.status()).toBe(200);
  const {id} = await response.json() as {id: string};
  await expect(add).toBeHidden();

  const item = (text: string) => page.locator('.archive-source-list button', {hasText: text});
  const detail = page.getByRole('dialog', {name: fileName, exact: true});
  await item(fileName).click();
  await expect(detail.getByText('추출 출처: 서버 추출 · 텍스트 추출 완료', {exact: true})).toBeVisible();
  await expect(detail.locator('pre')).toContainText(body);
  await expect(detail.locator('pre')).toContainText(memo);
  await expect(detail.getByRole('link', {name: `원본 다운로드 · ${fileName}`})).toBeVisible();
  await page.screenshot({path: `e2e/artifacts/${testInfo.project.name}-upload-server-extraction.png`, fullPage: true});

  // 원본 파일 삭제(관리자): 확인 창을 수락하면 레코드는 남고 원본 다운로드만 닫힌다.
  page.once('dialog', d => void d.accept());
  const deleted = page.waitForResponse(r => r.url().endsWith('/api/archive') && r.request().method() === 'POST' && r.request().postDataJSON()?.action === 'delete_source_file');
  await detail.getByRole('button', {name: '원본 파일 삭제', exact: true}).click();
  const deletion = await deleted;
  expect(deletion.status()).toBe(200);
  expect((await deletion.json()).cleanupPending).toBe(false);
  await expect(detail).toBeHidden();

  const download = await page.request.get(`/api/archive/file?id=${encodeURIComponent(id)}`);
  expect(download.status()).toBe(404);
  expect((await download.json()).error).toContain('원본 파일이 삭제됐습니다');
  const kept = await detailOf(id);
  expect(kept.status).toBe('candidate');
  expect(kept.content).toContain(body);
  expect(kept.fileDeletedAt).toBeTruthy();
  expect(kept.objectKey).toBeUndefined();
  expect(kept.fileCleanupKey).toBeUndefined();
  expect(kept.fileCleanupPending).toBeUndefined();

  await item(fileName).click();
  await expect(detail.getByText(/^원본 파일 삭제됨 · \d{4}-\d{2}-\d{2}$/)).toBeVisible();
  await expect(detail.getByRole('link', {name: /원본 다운로드/})).toHaveCount(0);
  await expect(detail.getByRole('button', {name: '원본 파일 삭제', exact: true})).toHaveCount(0);
  await expect(detail.locator('pre')).toContainText(body);
  await page.screenshot({path: `e2e/artifacts/${testInfo.project.name}-upload-file-deleted.png`, fullPage: true});
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();

  await item(imageTitle).click();
  const imageDetail = page.getByRole('dialog', {name: imageTitle, exact: true});
  await expect(imageDetail.getByText('추출 출처: 브라우저 추출(서버 미검증) · 이미지 원본 보관 · 내용 메모 필요', {exact: true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(imageDetail).toBeHidden();

  // 목록 행과 후보 일괄 검토에도 같은 출처 표시가 보인다. 서버 미검증 추출을 표시 없이 한꺼번에 확정하지 않게 한다.
  await expect(item(imageTitle)).toContainText('브라우저 추출(서버 미검증) · 이미지 원본 보관 · 내용 메모 필요');
  await expect(item(pdfTitle)).toContainText('브라우저 추출(서버 미검증) · 텍스트 추출 완료');
  await page.getByRole('button', {name: '후보 일괄 검토'}).click();
  const bulk = page.getByRole('dialog', {name: '후보 자료 일괄 검토'});
  await expect(bulk.locator('label', {hasText: imageTitle})).toContainText('브라우저 추출(서버 미검증) · 이미지 원본 보관 · 내용 메모 필요');
  await expect(bulk.locator('label', {hasText: pdfTitle})).toContainText('브라우저 추출(서버 미검증) · 텍스트 추출 완료');
  await page.screenshot({path: `e2e/artifacts/${testInfo.project.name}-upload-bulk-review-origin.png`, fullPage: true});
  await page.keyboard.press('Escape');
  await expect(bulk).toBeHidden();
  await context.close();
});

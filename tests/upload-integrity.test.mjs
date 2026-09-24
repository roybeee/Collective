// 업로드 무결성(security-ops-12): 텍스트 형식은 서버가 업로드 바이트에서 본문을 다시 추출하고, PDF·DOCX·이미지는 '브라우저 추출(서버 미검증)'으로 표시한다.
// 원본 파일 삭제(관리자 전용)는 자료 레코드를 남기고 R2 원본만 지운다. 네트워크·외부 API를 쓰지 않는다(모의 BUCKET).
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('network disabled in upload integrity test')});
const blobs=new Map(),deletes=[];let failDelete=false;
rt.env.BUCKET={put:async(k,stream)=>blobs.set(k,new Uint8Array(await new Response(stream).arrayBuffer())),get:async k=>blobs.has(k)?{body:blobs.get(k)}:null,delete:async k=>{deletes.push(k);if(failDelete){const e=new Error('r2 unavailable for '+k);e.name='R2Error';throw e}blobs.delete(k)}};
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const server=await rt.load('lib/server.ts'),archive=await rt.load('app/api/archive/route.ts'),files=await rt.load('app/api/archive/file/route.ts'),stores=await rt.load('app/api/stores/route.ts');
const {serverExtract}=await rt.load('lib/archive-upload-server.ts'),{uploadExtractionLabel}=await rt.load('lib/archive-upload.ts'),{sourceSummary}=await rt.load('lib/archive.ts');
const owner='workspace',admin='a'.repeat(64),member='b'.repeat(64);
await server.seedBrands(owner);
for(const [id,role,token] of [['admin','admin',admin],['member','member',member]]){
 rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',owner,role,'active',Date.now());
 rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());
}
let passed=0;const check=(name,value)=>{assert.ok(value,name);passed++};
const headers=token=>({cookie:'__Host-collective_session='+token,origin:'https://app.test'});
const read=id=>server.readRecord(owner,'brand_source',id);
async function upload(name,bytes,fields={},token=member){
 const form=new FormData();form.set('brandId','oda');form.set('file',new File([bytes],name));for(const [k,v] of Object.entries(fields))form.set(k,v);
 const r=await files.POST(new Request('https://app.test/api/archive/file',{method:'POST',headers:headers(token),body:form}));return {status:r.status,...await r.json()};
}
const call=async(token,data)=>{const r=await archive.POST(new Request('https://app.test/api/archive',{method:'POST',headers:{...headers(token),'content-type':'application/json'},body:JSON.stringify(data)}));return {status:r.status,...await r.json()}};
const download=async(id,token=admin)=>{const r=await files.GET(new Request('https://app.test/api/archive/file?id='+id,{headers:headers(token)}));return {status:r.status,body:r.headers.get('content-type')?.includes('json')?await r.json():await r.text()}};
const detail=async id=>(await archive.GET(new Request('https://app.test/api/archive?brandId=oda&sourceId='+id,{headers:headers(admin)}))).json();
const list=async()=>(await archive.GET(new Request('https://app.test/api/archive?brandId=oda',{headers:headers(admin)}))).json();
const utf8=s=>new TextEncoder().encode(s);
const decisions=()=>rt.sql.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='review_decision'").get().n;
const revision=()=>JSON.parse(rt.sql.prepare("SELECT data FROM records WHERE kind='brand_archive_state' AND parent_id='oda'").get()?.data||'{"revision":0}').revision;

// (1) 텍스트 형식: 서버가 바이트에서 다시 추출하고 브라우저가 보낸 본문·추출 상태는 쓰지 않는다. 사용자 메모와 범위는 따로 받아 붙인다.
let r=await upload('brief.txt',utf8('실제 파일 본문 · 가격 5000원'),{content:'브라우저가 바꾼 본문',extraction:'텍스트 추출 완료',extractionScope:'브라우저 범위',scope:'대표 제공 자료',note:'매장 메모'});
let s=await read(r.id);
check('text upload content is recomputed from the uploaded bytes, not the browser value',r.status===200&&s.content.startsWith('실제 파일 본문 · 가격 5000원')&&!s.content.includes('브라우저가 바꾼 본문'));
check('user memo is appended under its own label',s.content==='실제 파일 본문 · 가격 5000원\n[사용자 메모]\n매장 메모');
check('text extraction is marked as server extraction',s.extraction==='서버 추출 · 텍스트 추출 완료');
check('text scope comes from the server plus the user scope',s.scope==='업로드 원문 텍스트 · 대표 제공 자료'&&!s.scope.includes('브라우저 범위'));
const bomText=await upload('bom.md',new Uint8Array([0xef,0xbb,0xbf,...utf8('# 제목')]));
check('UTF-8 BOM is accepted and stripped',bomText.status===200&&(await read(bomText.id)).content==='# 제목');
const long=await upload('long.txt',utf8('가'.repeat(80001)),{content:'짧은 위조 본문'});s=await read(long.id);
check('long text keeps the same 80,000 character limit and says it is partial',long.status===200&&s.content.length===80000&&s.extraction==='서버 추출 · 앞부분 80,000자 추출'&&s.scope.startsWith('업로드 원문 텍스트 · 뒷부분 미포함'));
check('server extracted records carry the server-only extraction origin',(await read(r.id)).extractedBy==='server'&&s.extractedBy==='server');
// 배포 전에 열린 탭(이전 번들)은 note·extractionScope 없이 메모를 content 끝에, 추출 범위를 scope 앞에 합쳐 보낸다. 메모를 잃지 않고 범위도 겹치지 않는다.
r=await upload('legacy.txt',utf8('서버가 읽은 본문'),{content:'브라우저 본문\n[사용자 메모]\n옛 탭 메모',extraction:'텍스트 추출 완료',scope:'업로드 원문 텍스트 · 대표 제공 자료'});s=await read(r.id);
check('memo from a tab opened before deployment is kept under its label',r.status===200&&s.content==='서버가 읽은 본문\n[사용자 메모]\n옛 탭 메모'&&s.scope==='업로드 원문 텍스트 · 대표 제공 자료');

// (2) UTF-8이 아니어도 거부하지 않는다(lib/file-signature.ts 인코딩 비제한 정책). BOM이 있는 UTF-16은 서버가 읽고, 그 밖(CP949 CSV 등)은 원본만 보관한다.
let before=blobs.size;r=await upload('sales.csv',new Uint8Array([0xc7,0xd1,0xb1,0xdb,0x2c,0x31,0x0a]),{content:'깨진 브라우저 본문',extraction:'텍스트 추출 완료',extractionScope:'업로드 원문 텍스트'});s=await read(r.id);
check('non-UTF-8 text (CP949 CSV) is stored as original only',r.status===200&&blobs.size===before+1&&s.objectKey&&blobs.has(s.objectKey));
check('non-UTF-8 text keeps no browser text and says the server could not extract it',s.content===''&&s.extraction==='서버 추출 불가 · UTF-8 아님 · 원본만 보관'&&s.scope.startsWith('인코딩 미지원 · 원문 확인 필요')&&s.extractedBy==='server');
r=await upload('memo.txt',new Uint8Array([0xff,0xfe,0x41,0x00,0x5c,0xd5]),{content:'브라우저 본문'});s=await read(r.id);
check('UTF-16 LE with BOM is server extracted',r.status===200&&s.content==='A한'&&s.extraction==='서버 추출 · 텍스트 추출 완료');
r=await upload('memo-be.md',new Uint8Array([0xfe,0xff,0x00,0x41,0xd5,0x5c]));s=await read(r.id);
check('UTF-16 BE with BOM is server extracted',r.status===200&&s.content==='A한'&&s.extraction==='서버 추출 · 텍스트 추출 완료');

// (3) JSON: 구문이 맞으면 그대로, 깨졌으면 보관하되 '형식 확인 필요'로 표시한다.
r=await upload('data.json',utf8('{"매출":1200}'));s=await read(r.id);
check('valid JSON is server extracted without a format warning',r.status===200&&s.extraction==='서버 추출 · 텍스트 추출 완료'&&s.content==='{"매출":1200}');
r=await upload('broken.json',utf8('{"매출":'),{content:'{"매출":1}'});s=await read(r.id);
check('unparseable JSON is stored but marked for format review',r.status===200&&s.extraction==='서버 추출 · 텍스트 추출 완료 · JSON 구문 오류 · 형식 확인 필요'&&s.content==='{"매출":');
// 1MB를 넘는 JSON은 구문을 확인하지 않는다(전체 파싱은 객체가 입력의 수십 배로 불어나 Workers 메모리 한도에 닿는다). 깨진 JSON이어도 '구문 오류'가 아니라 '확인 생략'이다.
r=await upload('big.json',utf8('{"a":"'+'x'.repeat(1_000_001)));s=await read(r.id);
check('JSON over 1MB is stored without a syntax check and says so',r.status===200&&s.extraction==='서버 추출 · 앞부분 80,000자 추출 · JSON 구문 확인 생략(1MB 초과) · 형식 확인 필요');

// (4) 서버가 추출하지 않는 형식은 브라우저 추출값을 쓰되 출처를 붙인다.
r=await upload('scan.pdf',utf8('%PDF-1.7\n1 0 obj\n'),{content:'PDF 본문 텍스트',extraction:'텍스트 추출 완료',extractionScope:'PDF 1/1페이지 텍스트',scope:'대표 제공 자료',note:'표지 메모'});const pdf=r.id;s=await read(pdf);
check('PDF keeps the browser text but marks it as unverified browser extraction',r.status===200&&s.extraction==='브라우저 추출(서버 미검증) · 텍스트 추출 완료'&&s.content==='PDF 본문 텍스트\n[사용자 메모]\n표지 메모'&&s.scope==='PDF 1/1페이지 텍스트 · 대표 제공 자료');
r=await upload('photo.png',new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13]),{extraction:'이미지 원본 보관 · 내용 메모 필요'});
check('image upload is marked as browser-side handling',r.status===200&&(await read(r.id)).extraction==='브라우저 추출(서버 미검증) · 이미지 원본 보관 · 내용 메모 필요');
r=await upload('spoof.pdf',utf8('%PDF-1.7\n'),{extraction:'서버 추출 · 텍스트 추출 완료'});
check('a browser cannot claim server extraction',(await read(r.id)).extraction.startsWith('브라우저 추출(서버 미검증) · ')&&(await read(r.id)).extractedBy==='browser');

// (5) 화면 표시: 서버·브라우저 출처가 붙은 값은 그대로, 표시 이전 업로드(모두 브라우저 추출)는 브라우저 추출로 보인다.
check('pure extractor returns null for formats the server does not parse',serverExtract('a.pdf',utf8('%PDF-'))===null&&serverExtract('a.docx',new Uint8Array([0x50,0x4b,3,4]))===null&&serverExtract('a.png',new Uint8Array([0x89]))===null);
check('screen label shows server extraction as stored',uploadExtractionLabel(await read(bomText.id))==='서버 추출 · 텍스트 추출 완료');
check('screen label keeps the unverified browser marker',uploadExtractionLabel(await read(pdf))==='브라우저 추출(서버 미검증) · 텍스트 추출 완료');
check('legacy uploads without an origin are labelled as browser extraction',uploadExtractionLabel({origin:'upload',extraction:'텍스트 추출 완료'})==='브라우저 추출(서버 미검증) · 텍스트 추출 완료'&&uploadExtractionLabel({origin:'manual'})==='');
// 이전 업로드의 추출 상태는 브라우저가 보낸 임의 문자열이다. '서버 추출 · '로 시작해도 서버 검증으로 보지 않는다.
check('legacy record claiming server extraction is still labelled browser',uploadExtractionLabel({origin:'upload',extraction:'서버 추출 · 텍스트 추출 완료'})==='브라우저 추출(서버 미검증) · 서버 추출 · 텍스트 추출 완료');
// 목록 행·일괄 검토는 자료 요약(sourceSummary)으로 같은 표시를 쓴다. 레거시 레코드도 목록에서 브라우저 추출로 보인다.
const legacyId='legacy-upload';await server.recordStatement(owner,'brand_source',legacyId,{id:legacyId,brandId:'oda',title:'이전 업로드',category:'other',origin:'upload',status:'candidate',url:'',content:'이전 본문',scope:'업로드 원문 텍스트',observedAt:new Date().toISOString(),createdAt:new Date().toISOString(),version:1,fileName:'old.txt',extraction:'서버 추출 · 텍스트 추출 완료'},'oda').run();
const rows=(await list()).sources;
check('source list rows carry the extraction origin for the list and bulk review labels',uploadExtractionLabel(rows.find(x=>x.id===legacyId)).startsWith('브라우저 추출(서버 미검증) · ')&&uploadExtractionLabel(rows.find(x=>x.id===bomText.id))==='서버 추출 · 텍스트 추출 완료'&&uploadExtractionLabel(rows.find(x=>x.id===pdf))==='브라우저 추출(서버 미검증) · 텍스트 추출 완료');

// (6) 사용 제외는 되돌릴 수 있으므로 원본을 지우지 않는다.
const excludedBefore=deletes.length;await call(admin,{action:'review_source',brandId:'oda',id:pdf,version:1,status:'excluded'});
check('excluding a source keeps its original file',deletes.length===excludedBefore&&(await download(pdf)).status===200);

// (7) 원본 파일 삭제: 관리자 전용, 레코드·추출 텍스트·검토 상태는 남기고 objectKey만 지운다.
s=await read(pdf);const key=s.objectKey,version=s.version,rev=revision(),decided=decisions();
r=await call(member,{action:'delete_source_file',brandId:'oda',id:pdf,version});
check('member cannot delete an original file (403) and nothing changes',r.status===403&&(await read(pdf)).objectKey===key&&blobs.has(key)&&!deletes.includes(key));
check('stale version is rejected with 409',(await call(admin,{action:'delete_source_file',brandId:'oda',id:pdf,version:version-1})).status===409&&blobs.has(key));
check('another brand cannot target the source',(await call(admin,{action:'delete_source_file',brandId:'ofd',id:pdf,version})).status===404);
r=await call(admin,{action:'delete_source_file',brandId:'oda',id:pdf,version});s=await read(pdf);
check('admin deletes the original file and the R2 object',r.status===200&&deletes.includes(key)&&!blobs.has(key)&&r.cleanupPending===false);
check('source record stays with content and review status',s.content.startsWith('PDF 본문 텍스트')&&s.status==='excluded'&&s.fileName==='scan.pdf');
check('objectKey removed and deletion time and actor recorded',!('objectKey' in s)&&!('fileCleanupKey' in s)&&Number.isFinite(Date.parse(s.fileDeletedAt))&&s.fileDeletedBy?.id==='admin'&&s.version===version+1);
check('file deletion writes no review decision and leaves the archive revision alone',decisions()===decided&&revision()===rev);
let d=await download(pdf);
check('original download answers 404 with a deleted notice',d.status===404&&d.body.error.includes('원본 파일이 삭제됐습니다'));
const shown=await detail(pdf),row=(await list()).sources.find(x=>x.id===pdf);
check('detail shows the deletion but no storage key',shown.fileDeletedAt===s.fileDeletedAt&&!('objectKey' in shown)&&!('fileCleanupKey' in shown)&&!JSON.stringify(shown).includes(key));
check('source list reports no file after deletion',row&&row.hasFile===false&&!JSON.stringify(row).includes(key));
check('a source without an original file cannot be targeted',(await call(admin,{action:'delete_source_file',brandId:'oda',id:(await call(admin,{action:'add_source',brandId:'oda',data:{title:'직접 입력',content:'메모'}})).id,version:1})).status===404);

// (8) R2 삭제가 실패해도 응답은 성공이고, 키는 레코드(fileCleanupKey)에 남아 같은 요청으로 재시도한다. 로그에는 오류 이름만 남긴다.
r=await upload('keep.txt',utf8('정리 재시도 자료'));const retry=r.id;s=await read(retry);const retryKey=s.objectKey;
const logged=[],originalError=console.error;console.error=(...args)=>logged.push(args);failDelete=true;
try{r=await call(admin,{action:'delete_source_file',brandId:'oda',id:retry,version:s.version})}finally{console.error=originalError;failDelete=false}
s=await read(retry);
check('R2 failure still answers success and says cleanup is pending',r.status===200&&r.cleanupPending===true&&!('objectKey' in s)&&s.fileDeletedAt);
check('failed object stays in the retry list on the record',s.fileCleanupKey===retryKey&&blobs.has(retryKey));
check('failure log carries only the error name',logged.length===1&&logged[0][0]==='archive_object_cleanup_failed'&&logged[0][1]==='R2Error'&&!JSON.stringify(logged).includes(retryKey)&&!JSON.stringify(logged).includes('unavailable'));
check('pending cleanup is visible to the screen without the key',(await detail(retry)).fileCleanupPending===true&&!JSON.stringify(await detail(retry)).includes(retryKey));
const pendingRow=(await list()).sources.find(x=>x.id===retry);
check('source list shows pending cleanup without the key',pendingRow?.fileCleanupPending===true&&!JSON.stringify(pendingRow).includes(retryKey));
check('source summary itself drops the cleanup key',!('fileCleanupKey' in sourceSummary(s))&&sourceSummary(s).fileCleanupPending===true);
// 지점 API(/api/stores)도 같은 자료 요약을 쓴다. 지점 보고서가 이 자료를 근거로 참조해도 저장소 키는 나가지 않는다.
await server.recordStatement(owner,'store','store-1',{id:'store-1',brandId:'oda',name:'테스트 지점',version:1},'oda').run();
await server.recordStatement(owner,'store_report','report-1',{id:'report-1',storeId:'store-1',sourceIds:[retry]},'store-1').run();
const storeResponse=await stores.GET(new Request('https://app.test/api/stores?storeId=store-1',{headers:headers(member)})),storeBody=await storeResponse.text();
check('store API source summaries never carry the cleanup key',storeResponse.status===200&&JSON.parse(storeBody).sources.some(x=>x.id===retry)&&!storeBody.includes(retryKey));
check('download is already closed while cleanup is pending',(await download(retry)).status===404);
r=await call(admin,{action:'delete_source_file',brandId:'oda',id:retry});s=await read(retry);
check('repeating the action retries only the R2 delete and clears the retry entry',r.status===200&&r.cleanupPending===false&&!blobs.has(retryKey)&&!('fileCleanupKey' in s)&&deletes.filter(k=>k===retryKey).length===2);
check('repeating after cleanup is a no-op success',(await call(admin,{action:'delete_source_file',brandId:'oda',id:retry})).status===200&&deletes.filter(k=>k===retryKey).length===2);

// (9) 원본 키는 업로드 라우트가 만든 'archive/<uuid>/<자료 id>' 형식일 때만 R2에서 지운다. 다른 형식(공개 미디어 등)이나 다른 자료의 키는 건드리지 않고 정리 대기로 남긴다.
for(const [label,badKey] of [['public media key','media/abc.png'],['another source key','archive/'+'0'.repeat(8)+'-0000-0000-0000-'+'0'.repeat(12)+'/other-source']]){
 r=await upload('guard.txt',utf8('키 형식 확인'));const guard=await read(r.id);blobs.set(badKey,new Uint8Array([1]));await server.recordStatement(owner,'brand_source',guard.id,{...guard,objectKey:badKey},'oda').run();
 const guardLogs=[],keepError=console.error;console.error=(...args)=>guardLogs.push(args);
 try{r=await call(admin,{action:'delete_source_file',brandId:'oda',id:guard.id,version:guard.version})}finally{console.error=keepError}
 s=await read(guard.id);
 check(label+' is never passed to R2 delete and stays pending',r.status===200&&r.cleanupPending===true&&!deletes.includes(badKey)&&blobs.has(badKey)&&s.fileCleanupKey===badKey&&guardLogs.some(l=>l[0]==='archive_object_cleanup_failed'&&l[1]==='InvalidKey')&&!JSON.stringify(guardLogs).includes(badKey));
}

// (10) 입력만 보는 검증(확장자·시그니처·본문 추출)은 워크스페이스 잠금 전에 한다. 잠금이 잡혀 있어도 잘못된 파일은 400이고, 정상 파일은 여전히 409다.
rt.sql.prepare('INSERT INTO mutation_locks(owner,token,expires_at) VALUES(?,?,?)').run(owner,'held-by-other',Date.now()+60000);
try{
 check('bad file is rejected before the workspace lock',(await upload('disguised.pdf',new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))).status===400);
 check('valid upload still waits for the workspace lock',(await upload('ok.txt',utf8('본문'))).status===409);
}finally{rt.sql.prepare('DELETE FROM mutation_locks WHERE owner=?').run(owner)}

console.log(JSON.stringify({passed}));

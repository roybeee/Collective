// 앱 자체 공개 미디어(/media/<sha256>.png)와 비공개 소재 다운로드(/api/execution/asset)의 경계 테스트.
// 실제 SQLite, 모의 R2. 네트워크 호출은 없어야 한다(fetch는 호출되면 실패로 센다).
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {testRuntime} from './helpers/runtime.mjs';

function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
const signature=Buffer.from([137,80,78,71,13,10,26,10]),ihdr=Buffer.alloc(13);
ihdr.writeUInt32BE(1080,0);ihdr.writeUInt32BE(1080,4);ihdr[8]=8;ihdr[9]=2;
function fixture(fill){const pixels=Buffer.alloc((1080*3+1)*1080,fill);for(let row=0;row<1080;row++)pixels[row*(1080*3+1)]=0;return new Uint8Array(Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]))}

let fetchCalls=0,failPublicRecord=false;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('network disabled in test')},{beforeRun(statement){if(failPublicRecord&&statement.values.includes('public_media'))throw new Error('simulated D1 write failure')}});
const objects=new Map(),ops=[];
const bucket={
 put:async(key,value)=>{ops.push('put '+key);objects.set(key,new Uint8Array(value));return {key}},
 get:async key=>{ops.push('get '+key);const bytes=objects.get(key);return bytes?{key,size:bytes.length,httpEtag:'"etag"',body:new Response(bytes.slice()).body,arrayBuffer:async()=>bytes.slice().buffer}:null},
 head:async key=>{ops.push('head '+key);const bytes=objects.get(key);return bytes?{key,size:bytes.length,httpEtag:'"etag"'}:null},
 delete:async key=>{ops.push('delete '+key);objects.delete(key)},
};
rt.env.BUCKET=bucket;
const queries=[],prepare=rt.env.DB.prepare;rt.env.DB.prepare=query=>{queries.push(query);return prepare(query)};

const server=await rt.load('lib/server.ts'),media=await rt.load('lib/execution-media.ts');
const route=await rt.load('app/media/[file]/route.ts'),asset=await rt.load('app/api/execution/asset/route.ts');
let passed=0;const failures=[];function check(label,value){if(value)passed++;else failures.push(label)}
async function status(promise){try{await promise;return 200}catch(e){return e?.status||500}}
const origin='https://app.test',owner='owner',stranger='stranger';
const png=fixture(0),otherPng=fixture(255),thirdPng=fixture(128);
const hash=await media.sha256(png),otherHash=await media.sha256(otherPng),thirdHash=await media.sha256(thirdPng);
const ownUrl=h=>`${origin}/media/${h}.png`,publicKey=h=>'public/'+h+'.png';
async function creative(who,id,bytes,pngHash=null){
 await server.recordStatement(who,'campaign','c-'+who,{id:'c-'+who,brandId:'oda',title:'ODA',version:1}).run();
 const objectKey=await media.storePng(who,id,bytes);
 await server.recordStatement(who,'execution_creative',id,{id,campaignId:'c-'+who,campaignVersion:1,brandId:'oda',version:1,factRefs:[],caption:'',pngHash:pngHash||await media.sha256(bytes),objectKey,createdAt:new Date().toISOString()},'c-'+who).run();
 return objectKey;
}
const serve=(file,method='GET',headers={})=>route[method](new Request(origin+'/media/'+encodeURIComponent(file),{method,headers}),{params:Promise.resolve({file})});
const readPublic=async(who,h)=>(await server.readRecord(who,'public_media',h));
// 제공 판정은 발행 상태로 한다(SEC-1). 참조로 쓰는 발행 레코드를 상태와 함께 둔다.
const pub=(who,id,status='approved')=>server.recordStatement(who,'execution_publication',id,{id,campaignId:'c-'+who,status},'c-'+who).run();
for(const id of ['p1','p2','p4','p5','p6'])await pub(owner,id);await pub(stranger,'sp1');

await creative(owner,'cr1',png);
// 비공개 원본이 해시와 다르게 저장된 소재(변조 시나리오)
await creative(owner,'cr-bad',png,otherHash);
await creative(owner,'cr3',thirdPng);

// isOwnMediaUrl: 앱 자체 /media/<소문자 sha256>.png만, 같은 origin만
check('own url recognised',media.isOwnMediaUrl(ownUrl(hash),origin));
check('origin with trailing slash accepted',media.isOwnMediaUrl(ownUrl(hash),origin+'/'));
check('other host rejected',!media.isOwnMediaUrl(`https://evil.test/media/${hash}.png`,origin));
check('http downgrade rejected',!media.isOwnMediaUrl(`http://app.test/media/${hash}.png`,origin));
check('port mismatch rejected',!media.isOwnMediaUrl(`https://app.test:8443/media/${hash}.png`,origin));
check('userinfo rejected',!media.isOwnMediaUrl(`https://user:pw@app.test/media/${hash}.png`,origin));
check('query rejected',!media.isOwnMediaUrl(ownUrl(hash)+'?v=1',origin));
check('fragment rejected',!media.isOwnMediaUrl(ownUrl(hash)+'#x',origin));
check('uppercase hash rejected',!media.isOwnMediaUrl(`${origin}/media/${hash.toUpperCase()}.png`,origin));
check('double extension rejected',!media.isOwnMediaUrl(ownUrl(hash)+'.png',origin));
check('nested path rejected',!media.isOwnMediaUrl(`${origin}/x/media/${hash}.png`,origin));
check('encoded traversal rejected',!media.isOwnMediaUrl(`${origin}/media/..%2F${hash}.png`,origin));
check('invalid url rejected',!media.isOwnMediaUrl('not a url',origin)&&!media.isOwnMediaUrl(ownUrl(hash),'not an origin'));

// mediaUrl: 앱 주소 허용 확장, 외부 호스트(Cloudinary·R2)는 그대로 허용
check('own url accepted with origin',media.mediaUrl(ownUrl(hash),hash,origin)===ownUrl(hash));
check('own url for other hash rejected',await status((async()=>media.mediaUrl(ownUrl(otherHash),hash,origin))())===400);
check('own url without origin is not trusted',await status((async()=>media.mediaUrl(ownUrl(hash),hash))())===400);
check('cloudinary still accepted',media.mediaUrl(`https://res.cloudinary.com/oda/image/upload/${hash}.png`,hash,origin)===`https://res.cloudinary.com/oda/image/upload/${hash}.png`);
check('r2.dev still accepted without origin',media.mediaUrl(`https://pub-1.r2.dev/${hash}.png`,hash)===`https://pub-1.r2.dev/${hash}.png`);
check('arbitrary host rejected',await status((async()=>media.mediaUrl(`https://example.com/${hash}.png`,hash,origin))())===400);

// 공개 라우트: 게시 전에는 형식이 맞아도 404
check('unpublished hash 404',(await serve(hash+'.png')).status===404);

// publishPublicMedia 입력·소유자 경계
check('invalid hash rejected',await status(media.publishPublicMedia(owner,'ABC','p1',origin))===400);
check('non-https origin rejected',await status(media.publishPublicMedia(owner,hash,'p1','http://app.test'))===503);
check('missing publication id rejected',await status(media.publishPublicMedia(owner,hash,'',origin))===400);
check('other owner cannot publish by hash',await status(media.publishPublicMedia(stranger,hash,'sp0',origin))===404);
check('unknown hash has no source',await status(media.publishPublicMedia(owner,'0'.repeat(64),'p1',origin))===404);
rt.env.BUCKET=undefined;
check('missing bucket blocks publish',await status(media.publishPublicMedia(owner,hash,'p1',origin))===503);
rt.env.BUCKET=bucket;
check('tampered private source rejected',await status(media.publishPublicMedia(owner,otherHash,'p-bad',origin))===409&&!objects.has(publicKey(otherHash)));
check('rejections leave no public object or record',!objects.has(publicKey(hash))&&await status(readPublic(owner,hash))===404);

// 정상 게시: 공개 키로 1회 복사, 레코드 {owner,publicationIds,createdAt}, 절대 URL 반환
const url=await media.publishPublicMedia(owner,hash,'p1',origin);
const record=await readPublic(owner,hash);
check('absolute own url returned',url===ownUrl(hash));
check('public copy is byte-identical',Buffer.from(objects.get(publicKey(hash))).equals(Buffer.from(png)));
check('record keeps owner, reference and creation time',record.owner===owner&&JSON.stringify(record.publicationIds)==='["p1"]'&&Number.isFinite(Date.parse(record.createdAt)));
const putsOf=h=>ops.filter(o=>o==='put '+publicKey(h)).length;
check('other owner cannot reference an existing public object',await status(media.publishPublicMedia(stranger,hash,'sp0',origin))===404&&await status(readPublic(stranger,hash))===404);
check('republish same publication is idempotent',await media.publishPublicMedia(owner,hash,'p1',origin+'/')===url&&putsOf(hash)===1&&JSON.stringify((await readPublic(owner,hash)).publicationIds)==='["p1"]');
await media.publishPublicMedia(owner,hash,'p2',origin);
check('second publication adds reference without rewrite',putsOf(hash)===1&&JSON.stringify((await readPublic(owner,hash)).publicationIds)==='["p1","p2"]'&&(await readPublic(owner,hash)).createdAt===record.createdAt);
objects.set(publicKey(hash),otherPng);
check('existing public object is hash-verified',await status(media.publishPublicMedia(owner,hash,'p3',origin))===409&&putsOf(hash)===1);
objects.set(publicKey(hash),png);
check('no reference added on verification failure',JSON.stringify((await readPublic(owner,hash)).publicationIds)==='["p1","p2"]');

// 레코드 저장 실패 보상: 이번 호출이 만든 공개 객체만 지운다
failPublicRecord=true;
check('record failure surfaces',await status(media.publishPublicMedia(owner,thirdHash,'p9',origin))===500);
check('object created by failed call removed',!objects.has(publicKey(thirdHash)));
check('pre-existing object kept on record failure',await status(media.publishPublicMedia(owner,hash,'p4',origin))===500&&objects.has(publicKey(hash)));
failPublicRecord=false;

// storePngThen: 레코드 저장이 실패하면 방금 쓴 비공개 PNG를 지운다(exec-loop-12)
const before=[...objects.keys()].length;let savedKey='';
check('failed save rethrows',await status(media.storePngThen(owner,'orphan',png,async key=>{savedKey=key;throw new server.ApiError(409,'저장 실패')}))===409);
check('orphan private png removed',savedKey.endsWith('/orphan.png')&&!objects.has(savedKey)&&[...objects.keys()].length===before);
const kept=await media.storePngThen(owner,'kept',png,async key=>({key}));
check('successful save keeps object and returns result',objects.has(kept.key)&&kept.key.endsWith('/kept.png'));
rt.env.BUCKET=undefined;let saveCalled=false;
check('missing bucket stops before save',await status(media.storePngThen(owner,'none',png,async()=>{saveCalled=true}))===503&&!saveCalled);
rt.env.BUCKET=bucket;

// verifyMedia: 앱 주소는 자기 자신을 fetch하지 않고 R2 공개 객체를 검증한다
await media.verifyMedia(ownUrl(hash),hash,origin);
check('own media verified without network',fetchCalls===0);
check('own media missing public object rejected',await status(media.verifyMedia(ownUrl(thirdHash),thirdHash,origin))===409&&fetchCalls===0);
check('own media url without origin rejected',await status(media.verifyMedia(ownUrl(hash),hash))===400&&fetchCalls===0);

// 공개 라우트
const response=await serve(hash+'.png');
check('published media 200',response.status===200);
check('png content type',response.headers.get('content-type')==='image/png');
// SEC-3: 공개를 멈출 수 있는 자원이라 짧게 캐시하고 내용 해시 ETag로 재검증한다.
check('short revalidated public cache',response.headers.get('cache-control')==='public, max-age=300, must-revalidate'&&!response.headers.get('cache-control').includes('immutable'));
check('content hash etag',response.headers.get('etag')===`"${hash}"`);
const revalidated=await serve(hash+'.png','GET',{'if-none-match':`"${hash}"`});
check('matching etag revalidates with 304 and no body',revalidated.status===304&&(await revalidated.text())==='');
check('nosniff header',response.headers.get('x-content-type-options')==='nosniff');
check('csp default-src none',response.headers.get('content-security-policy')==="default-src 'none'");
check('body is the stored png',Buffer.from(await response.arrayBuffer()).equals(Buffer.from(png)));
const head=await serve(hash+'.png','HEAD');
check('HEAD 200 with headers and no body',head.status===200&&head.headers.get('content-type')==='image/png'&&head.headers.get('content-length')===String(png.length)&&(await head.text())==='');
rt.env.AUTH_MODE='email';
check('served without login in email mode',(await serve(hash+'.png','GET',{cookie:''})).status===200);
rt.env.AUTH_MODE='legacy';
check('route exposes only GET and HEAD',JSON.stringify(Object.keys(route).sort())==='["GET","HEAD"]');

const opsBefore=ops.length;
const malformed=[hash+'.PNG',hash.toUpperCase()+'.png',hash+'.png.png',hash.slice(1)+'.png',hash+'0.png','../'+hash+'.png','..%2F'+hash+'.png','..\\'+hash+'.png',hash+'.png/','public/'+hash+'.png',hash+'.jpg',hash,'',' '+hash+'.png'];
const malformedStatuses=await Promise.all(malformed.map(async file=>(await serve(file)).status));
check('malformed names 404',malformedStatuses.every(s=>s===404));
check('malformed names never touch storage',ops.length===opsBefore);
const missing=await serve('f'.repeat(64)+'.png');
check('404 is uncacheable and bodyless of detail',missing.status===404&&missing.headers.get('cache-control')==='no-store'&&!(await missing.text()).includes('f'.repeat(8)));
const queriesBefore=queries.length;
await serve('e'.repeat(64)+'.png');
check('unknown hash answered without database lookup',queries.length===queriesBefore);

objects.set(publicKey(thirdHash),thirdPng);
check('object without record 404',(await serve(thirdHash+'.png')).status===404&&(await serve(thirdHash+'.png','HEAD')).status===404);
objects.delete(publicKey(thirdHash));
rt.env.BUCKET=undefined;
check('missing bucket 404',(await serve(hash+'.png')).status===404);
rt.env.BUCKET=bucket;

// 다른 워크스페이스가 같은 PNG를 게시하면 공개 객체를 공유한다. 참조가 모두 사라질 때만 지운다.
await creative(stranger,'scr1',png);
check('second owner reuses verified object',await media.publishPublicMedia(stranger,hash,'sp1',origin)===url&&putsOf(hash)===1);
check('invalid retire hash rejected',await status(media.retirePublicMedia(owner,'nothex','p1'))===400);
await media.retirePublicMedia(owner,hash,'p1');
check('retire removes one reference',JSON.stringify((await readPublic(owner,hash)).publicationIds)==='["p2"]'&&objects.has(publicKey(hash)));
await media.retirePublicMedia(owner,hash,'unknown');
check('retire of unknown publication is harmless',JSON.stringify((await readPublic(owner,hash)).publicationIds)==='["p2"]');
await media.retirePublicMedia(owner,hash,'p2');
check('owner references reach zero but shared object kept',JSON.stringify((await readPublic(owner,hash)).publicationIds)==='[]'&&objects.has(publicKey(hash)));
check('served while another owner references it',(await serve(hash+'.png')).status===200);
await media.retirePublicMedia(stranger,hash,'sp1');
check('last reference deletes public object',!objects.has(publicKey(hash)));
check('retired media 404',(await serve(hash+'.png')).status===404);
objects.set(publicKey(hash),png);
check('zero-reference record 404 even if object lingers',(await serve(hash+'.png')).status===404&&(await serve(hash+'.png','HEAD')).status===404);
await media.retirePublicMedia(owner,hash,'p2');
check('retire again cleans lingering object',!objects.has(publicKey(hash)));
await media.retirePublicMedia(owner,thirdHash,'p9');
check('retire without record is harmless',!objects.has(publicKey(thirdHash)));
check('republish after retirement restores media',await media.publishPublicMedia(owner,hash,'p5',origin)===url&&(await serve(hash+'.png')).status===200);
// SEC-1: 참조 해제가 실패해 참조가 남아도 취소·실패한 발행의 PNG는 제공하지 않는다(fail-closed).
await pub(owner,'p5','cancelled');
check('cancelled publication with a lingering reference is not served',(await serve(hash+'.png')).status===404&&(await serve(hash+'.png','HEAD')).status===404&&(await readPublic(owner,hash)).publicationIds.includes('p5'));
check('lingering reference does not revalidate',(await serve(hash+'.png','GET',{'if-none-match':`"${hash}"`})).status===404);
await media.publishPublicMedia(owner,hash,'p6',origin);
check('another live publication keeps serving',(await serve(hash+'.png')).status===200);
await media.retirePublicMedia(owner,hash,'p6');
check('retire drops lingering references of stopped publications and deletes the object',JSON.stringify((await readPublic(owner,hash)).publicationIds)==='[]'&&!objects.has(publicKey(hash))&&(await serve(hash+'.png')).status===404);
// SEC-2: 인증 없는 판정 조회는 (owner,parent_id) 인덱스를 탄다. 참조 행은 참조가 0이 되면 지운다.
const servedQuery=queries.findLast(q=>q.includes('AS served'));
const plan=rt.sql.prepare('EXPLAIN QUERY PLAN '+servedQuery).all(...Array.from(servedQuery.matchAll(/\?/g),()=>'x')).map(r=>r.detail);
check('public lookup uses the owner-parent index without scanning records',plan.some(d=>d.includes('idx_records_owner_parent'))&&!plan.some(d=>/^SCAN (?!j\b)/.test(d)));
const refRows=()=>rt.sql.prepare("SELECT count(*) AS n FROM records WHERE kind='public_media_ref' AND parent_id=?").get(hash).n;
check('reference row removed when no reference remains',refRows()===0);
await pub(owner,'p7');await media.publishPublicMedia(owner,hash,'p7',origin);
check('reference row written on publish',refRows()===1&&(await serve(hash+'.png')).status===200);
await pub(owner,'p7','cancelled');await media.retirePublicMedia(owner,hash,'p7');
check('reference row dropped on last retire',refRows()===0&&!objects.has(publicKey(hash)));
check('no network used',fetchCalls===0);

// /api/execution/asset: 소유자·캠페인·저장소 경계(eng-hygiene-5 ①)
const download=(id,who=owner)=>asset.GET(new Request('https://app.test/api/execution/asset?id='+id,{headers:{'oai-authenticated-user-id':who}}));
const own=await download('cr1');
check('owner downloads private png',own.status===200&&own.headers.get('cache-control')==='private, no-store'&&Buffer.from(await own.arrayBuffer()).equals(Buffer.from(png)));
check('other owner gets 404',(await download('cr1',stranger)).status===404);
check('unauthenticated request rejected',(await asset.GET(new Request('https://app.test/api/execution/asset?id=cr1'))).status===401);
rt.env.BUCKET=undefined;
check('missing bucket gets 404',(await download('cr1')).status===404);
rt.env.BUCKET=bucket;
rt.sql.prepare("DELETE FROM records WHERE owner=? AND kind='campaign' AND id=?").run(owner,`${owner}:campaign:c-${owner}`);
check('deleted campaign gets 404',(await download('cr1')).status===404);

console.log(JSON.stringify({passed,failed:failures.length,failures,evidence:'real SQLite; mocked R2; no network'}));
assert.deepEqual(failures,[]);

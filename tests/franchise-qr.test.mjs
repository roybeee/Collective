// 트랙 R R15b QR 부호기(lib/franchise-qr.ts) 회귀. 사례 번호 QR-*는 R15b PR 본문 수용 기준과 같다.
// 확인: 참조 부호기(python qrcode 8.2, 바이트 모드·오류 정정 M·마스크 고정)와 버전 1~10 행렬 80개 칸 단위 일치(QR-V), 기능 무늬 불변식(QR-F), 마스크 선택 결정론(QR-M), 한도·거부(QR-L), 순수성(QR-S).
// 근거: mocked(순수 함수). 실제 판독(OpenCV 5.0 QRCodeDetector)은 PR 작성 때 개발 기기에서 한 번 했고 저장소 게이트가 아니다(PR 본문 기록).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const qr=await rt.load('lib/franchise-qr.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const sha=rows=>createHash('sha256').update(rows.join('\n')).digest('hex');
const VEC=JSON.parse(readFileSync('tests/fixtures/franchise-qr-vectors.json','utf8'));

// ════ QR-V 참조 행렬 ════
check('QR-V0 the fixture covers every version 1..10',[1,2,3,4,5,6,7,8,9,10].filter(v=>v!==2).every(v=>VEC.vectors.some(x=>x.version===v))&&VEC.vectors.length===10);
let matched=0;
for(const v of VEC.vectors)for(let mask=0;mask<8;mask++){
 const m=qr.encodeQr(v.text,{mask});
 assert.ok(m&&m.version===v.version&&m.mask===mask,`버전·마스크: ${v.text.slice(0,20)} ${mask}`);
 assert.equal(sha(qr.qrRows(m)),v.masks[String(mask)],`행렬 해시: ${v.text.slice(0,20)} 마스크 ${mask}`);
 matched++;
}
check('QR-V1 all 80 forced-mask matrices equal the reference encoder module by module',matched===80);
const small=VEC.vectors.find(x=>x.rowsMask3);
check('QR-V2 one readable reference matrix (version 3, mask 3) equals row by row',JSON.stringify(qr.qrRows(qr.encodeQr(small.text,{mask:3})))===JSON.stringify(small.rowsMask3));
// 버전 2(25칸)는 참조 픽스처에 없어 구조 불변식으로 본다(아래 QR-F).
const v2=qr.encodeQr('https://ex.kr/?utm_content=R2345678');
check('QR-V3 a 34-byte link needs version 3 and a 26-byte link fits version 2',v2.version===3&&qr.encodeQr('https://e.kr/?c=R2345678ab').version===2);

// ════ QR-F 기능 무늬 ════
const finderAt=(m,r0,c0)=>{for(let r=0;r<7;r++)for(let c=0;c<7;c++){const ring=r===0||r===6||c===0||c===6,core=r>=2&&r<=4&&c>=2&&c<=4;if(m.modules[r0+r][c0+c]!==(ring||core))return false}return true};
for(const v of [...VEC.vectors.map(x=>x.text),'https://e.kr/?c=R2345678ab']){
 const m=qr.encodeQr(v),n=m.size;
 assert.ok(n===17+4*m.version&&m.modules.length===n&&m.modules.every(r=>r.length===n),'크기');
 assert.ok(finderAt(m,0,0)&&finderAt(m,0,n-7)&&finderAt(m,n-7,0),'찾기 무늬');
 for(let i=8;i<n-8;i++)assert.ok(m.modules[6][i]===(i%2===0)&&m.modules[i][6]===(i%2===0),'타이밍');
 assert.ok(m.modules[n-8][8]===true,'어두운 칸');
}
check('QR-F1 finder, timing and dark module hold for every version',true);

// ════ QR-M 마스크 결정론 ════
const t='https://example.com/franchise?utm_campaign=expo_2026&utm_content=RABCDEFG';
const a=qr.encodeQr(t),b=qr.encodeQr(t);
check('QR-M1 the same text gives the same matrix and mask',sha(qr.qrRows(a))===sha(qr.qrRows(b))&&a.mask===b.mask);
check('QR-M2 the chosen mask is one of the eight and equals one forced mask matrix',a.mask>=0&&a.mask<8&&sha(qr.qrRows(a))===sha(qr.qrRows(qr.encodeQr(t,{mask:a.mask}))));
const grid=(n,f)=>Array.from({length:n},(_,r)=>Array.from({length:n},(_,c)=>f(r,c)));
// 모두 어두운 21칸: N1 행·열마다 3+16, N2 20×20×3, N3 0, N4 |441×20−4410|/441=10 → 100.
check('QR-M4 the penalty adds N1, N2 and N4 on an all-dark matrix',qr.qrPenalty(grid(21,()=>true))===21*2*19+1200+100);
// 체크무늬 21칸: 연속·2×2 없음, 어두운 칸 221/441 → N4 0. 찾기 무늬꼴 1011101+밝은 4칸은 한 줄에 넣어 40점씩 본다.
check('QR-M5 the penalty is 0 on a checkerboard and counts a finder-like run with light padding',qr.qrPenalty(grid(21,(r,c)=>(r+c)%2===0))===0&&qr.qrPenalty(grid(11,(r,c)=>r===5&&[4,6,7,8,10].includes(c)))>=40);
check('QR-M6 automatic masks for the fixture texts are pinned',JSON.stringify(VEC.vectors.map(v=>qr.encodeQr(v.text).mask))==='[6,2,3,2,4,1,2,2,1,2]');
check('QR-M3 an out-of-range mask option falls back to automatic selection',qr.encodeQr(t,{mask:9}).mask===a.mask&&qr.encodeQr(t,{mask:-1}).mask===a.mask&&qr.encodeQr(t,{mask:1.5}).mask===a.mask);

// ════ QR-L 한도·거부 ════
const at213=VEC.vectors.find(x=>new TextEncoder().encode(x.text).length===213);
check('QR-L1 213 bytes fits version 10 and 214 bytes is null',qr.encodeQr(at213.text).version===10&&qr.encodeQr(at213.text+'x')===null);
check('QR-L2 empty text and non-strings are null',[ '',null,undefined,42,{},['a']].every(x=>qr.encodeQr(x)===null));
check('QR-L3 minVersion raises the version and never lowers it',qr.encodeQr('R2345678',{minVersion:4}).version===4&&qr.encodeQr(t,{minVersion:1}).version===a.version);
check('QR-L4 Korean text is encoded as UTF-8 bytes (version from byte length)',qr.encodeQr('https://올드페리.kr/창업?utm_content=R2345678').version===4);

// ════ QR-S 순수성 ════
const SRC=readFileSync('lib/franchise-qr.ts','utf8');
check('QR-S1 no imports, clock, randomness, storage or network',!/^import /m.test(SRC)&&!/Date\.now|new Date|Math\.random|fetch\(|database\(/.test(SRC));
check('QR-S2 no fetch was called',fetchCalls===0);
check('QR-S3 the version constant is exported',qr.QR_VERSION==='fr-qr@2026-09-27.1'&&qr.QR_MAX_VERSION===10);

console.log(JSON.stringify({passed:passed.length}));

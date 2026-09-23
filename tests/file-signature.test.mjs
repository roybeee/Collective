// 업로드 원본의 확장자와 실제 내용(매직 바이트)이 맞는지 판정하는 순수 모듈 테스트. 네트워크·저장소를 쓰지 않는다.
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw new Error('network disabled in test')});
const {fileSignatureProblem}=await load('lib/file-signature.ts');
let passed=0;
const ok=(name,file,bytes)=>{assert.equal(fileSignatureProblem(file,bytes),'',name);passed++};
const bad=(name,file,bytes,pattern)=>{const problem=fileSignatureProblem(file,bytes);assert.match(problem,pattern,name+' → '+JSON.stringify(problem));passed++};
const bytes=(...parts)=>new Uint8Array(parts.flatMap(p=>typeof p==='string'?[...Buffer.from(p,'latin1')]:p));
const mismatch=/확장자와 실제 내용이 다릅니다/;

const pdf=bytes('%PDF-1.7\n1 0 obj\n'),png=bytes([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a],'\0\0\0\rIHDR'),jpeg=bytes([0xff,0xd8,0xff,0xe0],'\0\x10JFIF'),webp=bytes('RIFF',[0x24,0,0,0],'WEBPVP8 ');
const docx=zipSync({'[Content_Types].xml':strToU8('<Types/>'),'word/document.xml':strToU8('<w:document/>')});
ok('PDF signature accepted',"brief.pdf",pdf);
ok('PNG signature accepted','shot.png',png);
ok('JPEG signature accepted for jpg and jpeg','photo.jpg',jpeg);ok('JPEG signature accepted for jpeg','photo.jpeg',jpeg);
ok('WebP RIFF container accepted','banner.webp',webp);
ok('extension match is case-insensitive','SCAN.PDF',pdf);
// PDF 뷰어처럼 앞 1024바이트 안의 헤더를 인정한다(BOM·공백·메일 게이트웨이 헤더가 붙은 스캔 PDF).
ok('PDF header after a short prefix accepted','scan.pdf',bytes([0xef,0xbb,0xbf],'%PDF-1.4\n'));
ok('PDF header ending exactly at byte 1024 accepted','scan.pdf',bytes(' '.repeat(1019),'%PDF-1.4\n'));
bad('PDF header starting past the first 1024 bytes rejected','scan.pdf',bytes(' '.repeat(1020),'%PDF-1.4\n'),mismatch);
ok('DOCX zip with word/document.xml accepted','plan.docx',docx);
bad('PNG disguised as PDF rejected','brief.pdf',png,mismatch);
bad('PDF disguised as PNG rejected','shot.png',pdf,mismatch);
bad('PNG disguised as JPEG rejected','photo.jpg',png,mismatch);
bad('RIFF audio disguised as WebP rejected','banner.webp',bytes('RIFF',[0x24,0,0,0],'WAVEfmt '),mismatch);
bad('PDF disguised as DOCX rejected','plan.docx',pdf,mismatch);
bad('zip without word/document.xml is not DOCX','plan.docx',zipSync({'notes.txt':strToU8('hello')}),mismatch);
bad('entry name hidden in file data does not count','plan.docx',zipSync({'notes.txt':strToU8('word/document.xml')},{level:0}),mismatch);
bad('truncated zip header rejected','plan.docx',bytes('PK',[3,4]),mismatch);
bad('empty binary rejected','brief.pdf',new Uint8Array(0),mismatch);
ok('Korean UTF-8 text accepted','notes.txt',new TextEncoder().encode('브랜드 가격 5000원'));
ok('UTF-8 BOM accepted','data.csv',bytes([0xef,0xbb,0xbf],'name,price\n'));
ok('markdown and JSON use the same UTF-8 check','readme.md',new TextEncoder().encode('# 제목'));ok('JSON text accepted','data.json',new TextEncoder().encode('{"a":1}'));
// 텍스트 확장자는 인코딩을 제한하지 않는다(한국어 엑셀 CSV는 CP949, 메모장 '유니코드'는 UTF-16). 알려진 이진 형식만 거부한다.
ok('CP949 CSV accepted','data.csv',bytes([0xc7,0xd1,0xb1,0xdb],',5000\n'));
ok('UTF-16 text accepted','notes.txt',bytes([0xff,0xfe,0x41,0x00,0x42,0x00]));
bad('binary image renamed to txt rejected','notes.txt',png,mismatch);
bad('PDF renamed to csv rejected','data.csv',pdf,mismatch);
bad('DOCX renamed to md rejected','notes.md',docx,mismatch);
bad('JPEG renamed to json rejected','data.json',jpeg,mismatch);
bad('WebP renamed to txt rejected','notes.txt',webp,mismatch);
bad('unsupported extension rejected','tool.exe',bytes('MZ'),/형식/);

console.log(JSON.stringify({passed}));

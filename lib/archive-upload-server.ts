// 업로드 자료의 본문 출처를 서버가 정한다(security-ops-12). 브라우저 추출(lib/archive-upload.ts)은 화면 미리보기용이고 서버는 그 값을 믿지 않는다.
// TXT·MD·CSV·JSON: 업로드 바이트를 UTF-8(또는 BOM이 있는 UTF-16)로 다시 읽어 content를 만든다(브라우저 content 무시). 그 밖의 인코딩(CP949 CSV 등)은 거부하지 않고 원본만 보관한다(lib/file-signature.ts의 인코딩 비제한 정책).
// JSON 구문 오류는 보관하되 '형식 확인 필요'로 표시한다. PDF·DOCX·이미지: 서버가 해석하지 않으므로 브라우저 값을 쓰고 추출 상태 앞에 '브라우저 추출(서버 미검증)'을 붙인다.
// 추출 출처는 서버만 쓰는 extractedBy('server'|'browser')에 남긴다. 화면 표시(uploadExtractionLabel)는 추출 상태 문자열이 아니라 이 필드로 판정한다.
import {str} from './server';
export const CONTENT_MAX=80000,JSON_CHECK_MAX=1_000_000;
const SERVER='서버 추출',BROWSER='브라우저 추출(서버 미검증)',MEMO='\n[사용자 메모]\n';
const parses=(text:string)=>{try{JSON.parse(text);return true}catch{return false}};
// 앞 바이트가 UTF-16 BOM이면 UTF-16으로, 아니면 UTF-8(BOM 포함)로 읽는다. FF·FE는 UTF-8에 나올 수 없어 순서가 겹치지 않는다. 읽지 못하면 null.
function decodeText(bytes:Uint8Array){
 const utf16=bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':'';
 try{return new TextDecoder(utf16||'utf-8',{fatal:true}).decode(bytes)}catch{return null}
}
export function serverExtract(name:string,bytes:Uint8Array):{content:string;extraction:string;scope:string}|null{
 const extension=name.toLowerCase().split('.').pop()||'';
 if(!['txt','md','csv','json'].includes(extension))return null;
 const raw=decodeText(bytes);
 // 읽지 못한 인코딩도 원본은 보관한다. 브라우저 본문(깨진 글자일 수 있음)은 쓰지 않으므로 본문이 비고, 메모 없이는 확정할 수 없다.
 if(raw===null)return {content:'',extraction:'서버 추출 불가 · UTF-8 아님 · 원본만 보관',scope:'인코딩 미지원 · 원문 확인 필요. 엑셀 CSV는 "CSV UTF-8"로 다시 저장해 추가하세요'};
 // JSON 구문 확인은 1MB 이하만 한다. 큰 JSON 전체를 파싱하면 객체가 입력의 수십 배로 불어나 Workers 메모리 한도에 닿을 수 있다.
 const partial=raw.length>CONTENT_MAX,syntax=extension!=='json'?'':bytes.length>JSON_CHECK_MAX?' · JSON 구문 확인 생략(1MB 초과) · 형식 확인 필요':parses(raw)?'':' · JSON 구문 오류 · 형식 확인 필요';
 return {content:raw.slice(0,CONTENT_MAX),extraction:`${SERVER} · ${partial?'앞부분 80,000자 추출':'텍스트 추출 완료'}${syntax}`,scope:'업로드 원문 텍스트'+(partial?' · 뒷부분 미포함':'')};
}
// 저장할 본문·추출 상태·확인 범위·추출 출처. 폼 필드: content·extraction·extractionScope(브라우저 추출값), note(사용자 메모), scope(사용자가 적은 범위·한계).
// 배포 전에 열린 탭(이전 번들)은 note·extractionScope 없이 메모를 content 끝 '[사용자 메모]' 아래에, 추출 범위를 scope 앞에 합쳐 보낸다. 서버 추출 형식에서는 그 메모를 되살리고 범위 중복을 뺀다(multipart 전송은 줄바꿈을 CRLF로 바꾼다).
export function uploadFields(name:string,bytes:Uint8Array,form:FormData){
 const text=(key:string)=>{const v=form.get(key);return typeof v==='string'?v.trim():''};
 const server=serverExtract(name,bytes),legacy=!!server&&!form.has('note')&&!form.has('extractionScope'),sent=String(form.get('content')??'').replace(/\r\n/g,'\n'),at=legacy?sent.lastIndexOf(MEMO):-1;
 const base=server||{content:text('content'),extraction:`${BROWSER} · ${str(text('extraction')||'원본만 보관','추출 상태',1000)}`,scope:text('extractionScope')};
 const note=at>=0?sent.slice(at+MEMO.length).trim():text('note'),scope=legacy?text('scope').replace(/^업로드 원문 텍스트( · 뒷부분 미포함)?( · |$)/,''):text('scope');
 return {content:(base.content+(note?MEMO+note:'')).slice(0,CONTENT_MAX),extraction:base.extraction,scope:[base.scope,scope].filter(Boolean).join(' · ')||'업로드 원본 · 추출 범위 확인 필요',extractedBy:(server?'server':'browser') as 'server'|'browser'};
}

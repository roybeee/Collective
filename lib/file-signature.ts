// 업로드 원본의 확장자와 실제 내용(매직 바이트)이 맞는지 서버에서 확인한다. 순수 함수이며 파일을 해석하거나 압축을 풀지 않는다.
// 통과하면 빈 문자열, 아니면 사용자에게 보여 줄 사유를 돌려준다.
const starts=(b:Uint8Array,signature:number[],at=0)=>b.length>=at+signature.length&&signature.every((x,i)=>b[at+i]===x);
const ascii=(s:string)=>Array.from(s,c=>c.charCodeAt(0));
const jpeg=(b:Uint8Array)=>starts(b,[0xff,0xd8,0xff]);
// PDF 뷰어(Acrobat·pdf.js)처럼 앞 1024바이트 안에서 시작하는 헤더를 인정한다(BOM·공백·메일 게이트웨이 헤더가 붙은 파일).
const pdf=(b:Uint8Array)=>{const head=b.subarray(0,1024),header=ascii('%PDF-');for(let at=0;at+header.length<=head.length;at++)if(starts(head,header,at))return true;return false};
const signatures=new Map<string,(b:Uint8Array)=>boolean>([
 ['pdf',pdf],
 ['png',b=>starts(b,[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])],
 ['jpg',jpeg],['jpeg',jpeg],
 ['webp',b=>starts(b,ascii('RIFF'))&&starts(b,ascii('WEBP'),8)],
 ['docx',b=>starts(b,[0x50,0x4b,0x03,0x04])&&zipHasEntry(b,'word/document.xml')],
]);
const textExtensions=new Set(['txt','md','csv','json']);
// 텍스트 확장자는 인코딩(CP949 CSV·UTF-16 등)을 제한하지 않고, 위 이진 형식으로 시작하는 파일만 거부한다.
const binaryStarts=[ascii('%PDF-'),[0x89,0x50,0x4e,0x47],[0xff,0xd8,0xff],[0x50,0x4b,0x03,0x04],ascii('RIFF')];

// ZIP 끝의 중앙 디렉터리에서 항목 이름만 읽는다. 파일 데이터 안의 같은 문자열은 항목으로 세지 않는다.
function zipHasEntry(b:Uint8Array,entry:string){
 const view=new DataView(b.buffer,b.byteOffset,b.byteLength),decoder=new TextDecoder();
 for(let end=b.length-22;end>=Math.max(0,b.length-22-0xffff);end--){
  if(view.getUint32(end,true)!==0x06054b50)continue;
  let at=view.getUint32(end+16,true);
  for(let left=view.getUint16(end+10,true);left>0&&at+46<=b.length&&view.getUint32(at,true)===0x02014b50;left--){
   const length=view.getUint16(at+28,true);
   if(at+46+length<=b.length&&decoder.decode(b.subarray(at+46,at+46+length))===entry)return true;
   at+=46+length+view.getUint16(at+30,true)+view.getUint16(at+32,true);
  }
  return false;
 }
 return false;
}

export function fileSignatureProblem(name:string,bytes:Uint8Array){
 const extension=name.toLowerCase().split('.').pop()||'';
 const mismatch='파일 확장자와 실제 내용이 다릅니다. 원본 파일을 다시 선택하세요.';
 if(textExtensions.has(extension))return binaryStarts.some(signature=>starts(bytes,signature))?mismatch:'';
 const matches=signatures.get(extension);
 if(!matches)return '지원하지 않는 파일 형식입니다.';
 return matches(bytes)?'':mismatch;
}

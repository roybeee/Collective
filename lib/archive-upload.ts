export async function extractArchiveFile(file:File):Promise<{content:string;extraction:string;scope:string}>{
 const name=file.name.toLowerCase();const max=80000;
 if(/\.(txt|md|csv|json)$/.test(name)){const raw=await file.text();return {content:raw.slice(0,max),extraction:raw.length>max?'앞부분 80,000자 추출':'텍스트 추출 완료',scope:'업로드 원문 텍스트'+(raw.length>max?' · 뒷부분 미포함':'')}}
 if(name.endsWith('.pdf')){
  const pdfjs=await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc=`/vendor/archive-pdf.worker-${pdfjs.version}.mjs`;
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),useSystemFonts:true});
  try{const pdf=await task.promise;let content='',pages=0;for(let i=1;i<=Math.min(pdf.numPages,80)&&content.length<max;i++){const page=await pdf.getPage(i);const text=await page.getTextContent();content+=`\n[페이지 ${i}]\n`+text.items.map(x=>'str' in x?x.str:'').join(' ');pages=i;page.cleanup()}
   const partial=pages<pdf.numPages||content.length>max;const hasText=content.replace(/\[페이지 \d+\]/g,'').trim().length>20;
   return {content:hasText?content.slice(0,max):'',extraction:hasText?(partial?'일부 텍스트 추출':'텍스트 추출 완료'):'OCR 필요 · 원본만 보관',scope:`PDF ${pages}/${pdf.numPages}페이지 텍스트 · 이미지/표 구조·시각 자료는 미해석${partial?' · 일부 내용 미포함':''}`};
  }finally{await task.destroy()}
 }
 if(name.endsWith('.docx')){
  const {unzipSync,strFromU8}=await import('fflate');const files=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:e=>e.name==='word/document.xml'&&e.originalSize<8*1024*1024});const xml=files['word/document.xml'];if(!xml)throw new Error('DOCX 본문을 추출하지 못했습니다. 텍스트 자료로 추가해 주세요.');
  const doc=new DOMParser().parseFromString(strFromU8(xml),'application/xml');const paragraphs=Array.from(doc.getElementsByTagName('w:p')).map(p=>Array.from(p.getElementsByTagName('w:t')).map(t=>t.textContent||'').join(''));const raw=paragraphs.join('\n');return {content:raw.slice(0,max),extraction:raw.length>max?'일부 텍스트 추출':'텍스트 추출 완료',scope:'DOCX 본문 텍스트 · 이미지·도형·머리말 미해석'+(raw.length>max?' · 뒷부분 미포함':'')};
 }
 return {content:'',extraction:'이미지 원본 보관 · 내용 메모 필요',scope:'이미지 자동 해석 미실행. 원본 확인 후 관찰 내용을 텍스트로 추가하세요.'};
}

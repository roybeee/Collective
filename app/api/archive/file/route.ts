import {ApiError,identity,secureMutation,str,json,failure,database,readRecord,listRecords,recordStatement,acquireLock,releaseLock,runtime} from '@/lib/server';
import type {Brand} from '@/lib/agency';
import type {ArchiveSource} from '@/lib/archive';
import {archiveState,stateWrite,assertArchiveIdle,makeSource,removeArchiveObject,type SourceFileDeletion} from '@/lib/archive-server';
import {fileSignatureProblem} from '@/lib/file-signature';
import {uploadFields} from '@/lib/archive-upload-server';
export async function GET(req:Request){try{const owner=await identity(req);const s=await readRecord<ArchiveSource&SourceFileDeletion>(owner,'brand_source',str(new URL(req.url).searchParams.get('id'),'자료',100,true));if(s.fileDeletedAt)throw new ApiError(404,'원본 파일이 삭제됐습니다. 자료 기록과 추출 텍스트는 남아 있습니다.');if(!s.objectKey||!runtime.BUCKET)throw new ApiError(404,'원본 파일을 찾을 수 없습니다.');const object=await runtime.BUCKET.get(s.objectKey);if(!object)throw new ApiError(404,'원본 파일을 찾을 수 없습니다.');return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(s.fileName||'document'),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}})}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='',newKey='';try{owner=await identity(req);secureMutation(req);if(!runtime.BUCKET)throw new ApiError(503,'파일 보관함을 준비 중입니다. 텍스트 자료 추가를 이용해 주세요.');if(Number(req.headers.get('content-length')||0)>10*1024*1024)throw new ApiError(413,'파일은 8MB 이하로 올려 주세요.');
 const reader=req.body?.getReader();if(!reader)throw new ApiError(400,'파일을 선택하세요.');const chunks:Uint8Array[]=[];let size=0;for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>10*1024*1024){await reader.cancel();throw new ApiError(413,'파일은 8MB 이하로 올려 주세요.');}chunks.push(item.value)}const payload=new Uint8Array(size);let offset=0;for(const chunk of chunks){payload.set(chunk,offset);offset+=chunk.length}const form=await new Response(payload,{headers:req.headers}).formData(),file=form.get('file');if(!file||typeof file==='string'||file.size>8*1024*1024||!file.size)throw new ApiError(400,'8MB 이하의 원본 파일을 선택하세요.');
 const brandId=str(form.get('brandId'),'브랜드',100,true);await readRecord<Brand>(owner,'brand',brandId);
 // 입력만 보는 검증(확장자·시그니처·본문 추출)은 워크스페이스 잠금 전에 해, 느리거나 실패해도 잠금을 잡고 있지 않게 한다.
 const name=file.name.replace(/[\x00-\x1f/\\]/g,'_').slice(0,200);if(!/\.(pdf|docx|txt|md|csv|json|png|jpg|jpeg|webp)$/i.test(name))throw new ApiError(400,'PDF, DOCX, TXT, MD, CSV, JSON 또는 이미지 파일을 선택하세요.');const bytes=new Uint8Array(await file.arrayBuffer()),problem=fileSignatureProblem(name,bytes);if(problem)throw new ApiError(400,problem);
 // 텍스트 형식은 서버가 바이트에서 본문을 다시 추출하고, 나머지는 브라우저 추출값에 '서버 미검증' 출처를 붙인다(lib/archive-upload-server.ts).
 const fields=uploadFields(name,bytes,form);
 lock=await acquireLock(owner);await assertArchiveIdle(owner,brandId);const state=await archiveState(owner,brandId);if((await listRecords<ArchiveSource>(owner,'brand_source',brandId)).length>=200)throw new ApiError(400,'브랜드당 자료 200개까지 보관할 수 있습니다.');
 const s=makeSource(brandId,{title:form.get('title')||name,content:fields.content,category:form.get('category')||undefined,fileName:name,scope:fields.scope},'upload');
 s.fileName=name;s.fileSize=file.size;s.extraction=fields.extraction;s.extractedBy=fields.extractedBy;s.objectKey='archive/'+crypto.randomUUID()+'/'+s.id;newKey=s.objectKey;
 await runtime.BUCKET.put(s.objectKey,file.stream(),{httpMetadata:{contentType:'application/octet-stream'}});
 await database().batch([recordStatement(owner,'brand_source',s.id,s,brandId),stateWrite(owner,brandId,state.revision+1)]);newKey='';return json({id:s.id});
}catch(e){if(newKey)await removeArchiveObject(newKey);return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}

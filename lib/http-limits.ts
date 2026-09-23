export class HttpBodyError extends Error {
 constructor(public status:number,message:string){super(message)}
}

type BodySource=Pick<Request|Response,'body'|'headers'>;

// Bound bytes while receiving them; Content-Length alone cannot bound a stream.
export async function readBoundedText(source:BodySource,maxBytes:number):Promise<string>{
 if(!Number.isSafeInteger(maxBytes)||maxBytes<=0)throw new RangeError('A positive byte limit is required.');
 const reader=source.body?.getReader();
 if(!reader)return '';
 const declared=Number(source.headers.get('content-length'));
 const decoder=new TextDecoder();
 let bytes=0,text='';
 try{
  if(Number.isFinite(declared)&&declared>maxBytes){
   await reader.cancel().catch(()=>undefined);
   throw new HttpBodyError(413,'입력 내용이 너무 큽니다.');
  }
  for(;;){
   const chunk=await reader.read();
   if(chunk.done)break;
   bytes+=chunk.value.byteLength;
   if(bytes>maxBytes){
    await reader.cancel().catch(()=>undefined);
    throw new HttpBodyError(413,'입력 내용이 너무 큽니다.');
   }
   text+=decoder.decode(chunk.value,{stream:true});
  }
  return text+decoder.decode();
 }catch(error){
  if(error instanceof HttpBodyError)throw error;
  throw new HttpBodyError(400,'입력 내용을 읽지 못했습니다. 다시 전송해 주세요.');
 }finally{reader.releaseLock()}
}

export async function readBoundedJson<T=unknown>(source:BodySource,maxBytes:number):Promise<T>{
 const text=await readBoundedText(source,maxBytes);
 try{return JSON.parse(text) as T}catch{throw new HttpBodyError(400,'입력 형식을 확인해 주세요.')}
}

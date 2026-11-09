// X6 채널 미리보기의 글자 수·바이트 계산(순수 모듈, 화면·서버·테스트 공용). 의존성 없음.
// 문자 메시지는 이동통신사 관행대로 EUC-KR 기준으로 센다: ASCII 1바이트, 그 밖의 글자(한글·한자·기호) 2바이트.
// EUC-KR로 보낼 수 없는 글자(이모지 등 기본 다국어 평면 밖·딩뱃·변형 선택자·결합자)는 2바이트로 세고 unsupported로 따로 알린다(발송 시스템이 '?'로 바꾸거나 거절할 수 있다).

export type PreviewChannel='instagram'|'threads'|'blog'|'sms';
export type MessageKind='SMS'|'LMS'|'over';
export type ByteCount={bytes:number;unsupported:number};
export type PreviewCounter={used:number;limit:number;unit:'자'|'바이트';over:boolean;label:string;kind?:MessageKind};

export const SMS_BYTES=90,LMS_BYTES=2000;
export const CHANNEL_CHAR_LIMITS:Readonly<Record<'instagram'|'threads',number>>={instagram:2200,threads:500};
// Instagram 피드는 캡션 앞 125자 뒤를 '더 보기'로 접는다.
export const INSTAGRAM_FOLD=125;

const isUnsupported=(cp:number)=>cp>0xffff||(cp>=0x2600&&cp<=0x27bf)||(cp>=0xfe00&&cp<=0xfe0f)||cp===0x200d;
export function eucKrBytes(text:string):ByteCount{
 return Array.from(text).reduce<ByteCount>((acc,ch)=>{
  const cp=ch.codePointAt(0)??0;
  return {bytes:acc.bytes+(cp<=0x7f?1:2),unsupported:acc.unsupported+(isUnsupported(cp)?1:0)};
 },{bytes:0,unsupported:0});
}
export const messageKind=(bytes:number):MessageKind=>bytes<=SMS_BYTES?'SMS':bytes<=LMS_BYTES?'LMS':'over';
// 화면에 보이는 글자 수(코드 포인트 단위). 이모지 하나가 2자로 세지지 않게 한다.
export const charCount=(text:string)=>Array.from(text).length;

const num=(n:number)=>n.toLocaleString('ko-KR');
export function previewCounter(channel:PreviewChannel,text:string):PreviewCounter|null{
 if(channel==='blog')return null;
 if(channel==='sms'){
  const {bytes}=eucKrBytes(text),kind=messageKind(bytes),limit=kind==='SMS'?SMS_BYTES:LMS_BYTES;
  return {used:bytes,limit,unit:'바이트',over:kind==='over',kind,label:`${num(bytes)}/${num(limit)}바이트, ${kind==='over'?'LMS 한도 초과':kind}`};
 }
 const used=charCount(text),limit=CHANNEL_CHAR_LIMITS[channel];
 return {used,limit,unit:'자',over:used>limit,label:`${num(used)}/${num(limit)}자`};
}
// 발행 계정(channelId)에서 미리보기 채널을 고른다(lib/execution-publisher-server.ts directChannelId 형식). Instagram 직접 게시와 Buffer 경로는 Instagram에 게시한다.
export function previewChannelFor(channelId:string|undefined):'instagram'|'threads'{
 return /^threads:\d+$/.test(channelId??'')?'threads':'instagram';
}
// Instagram 접기: 앞 125자(코드 포인트)만 보이고 나머지는 '더 보기'로 편다.
export function foldCaption(text:string,limit=INSTAGRAM_FOLD):{shown:string;folded:boolean}{
 const chars=Array.from(text);
 return chars.length>limit?{shown:chars.slice(0,limit).join('').trimEnd(),folded:true}:{shown:text,folded:false};
}
// 해시태그(#낱말)를 따로 칠하도록 글을 조각으로 나눈다. 글자·숫자·밑줄을 태그 글자로 본다.
export type CaptionPart={text:string;tag:boolean};
const TAG=/^#[\p{L}\p{N}_]+$/u;
export function captionParts(text:string):CaptionPart[]{
 return text.split(/(#[\p{L}\p{N}_]+)/u).filter(Boolean).map(part=>({text:part,tag:TAG.test(part)}));
}
// 표시 줄(AI 생성물·가상인물)은 접기와 상관없이 늘 보이도록 본문에서 떼어 낸다. 본문에 없던 표시 줄도 그대로 돌려준다.
export function splitDisclosure(text:string,lines:string|readonly string[]|null|undefined):{body:string;disclosure:string[]}{
 const wanted=(typeof lines==='string'?[lines]:lines??[]).flatMap(l=>l.split('\n')).map(l=>l.trim()).filter(Boolean);
 const body=text.split('\n').filter(l=>!wanted.includes(l.trim())).join('\n').replace(/\n{3,}/g,'\n\n').trim();
 return {body,disclosure:[...new Set(wanted)]};
}
// 문자 메시지의 광고성 표시: 첫 줄 '(광고)' 머리말과 080 수신거부 줄.
export function messageMarks(text:string):{adPrefix:boolean;optOut:string|null}{
 const lines=text.split('\n').map(l=>l.trim());
 return {adPrefix:(lines.find(Boolean)??'').startsWith('(광고)'),optOut:lines.find(l=>/080[-\s]?\d{3,4}[-\s]?\d{4}/.test(l))??null};
}

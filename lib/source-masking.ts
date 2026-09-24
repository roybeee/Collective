import {maskText,type PiiFinding,type PiiFieldFinding} from './pii-scan';
import {inputMaskingRecord,type InputMasking} from './ai-context';
import type {ArchiveSource} from './archive';

// 브랜드 자료의 모델 입력 가림(docs/DATA-PROCESSING.ko.md 4.4 ③ DP-3, 레인 B 후속). 순수 모듈: 서버·네트워크에 의존하지 않는다.
// 사용자가 넣은 자료(origin 'upload' 파일 추출문, 'manual' 직접 입력)의 본문·제목(업로드는 파일 이름)·확인 범위·URL은 모델 입력으로 나가기 직전에 lib/pii-scan.ts maskText로 가린다.
// 조사가 공개 웹에서 모은 자료(origin 'research')는 가리지 않는다(작성자 식별정보는 조사 지시문 authorPrivacy가 다룬다). origin이 없는 옛 기록은 사용자 자료로 보고 가린다.
// 저장 레코드(brand_source)·화면·다운로드는 원문 그대로다. 가릴 탐지가 없으면 원문 문자열 그대로다(제출 바이트 불변).
// DP-4: 탐지한 값은 돌려주지 않는다. 가림 기록(필드·종류·건수, 허용 값이라 보낸 탐지는 allowed:true)은 돌려주며, 실행부가 모델 입력 밖의 실행 기록에 남긴다.
// origin이 없는 값: 옛 기록과, 레코드가 지워진 회의 스냅샷 자료(lib/archive-server.ts maskedArchiveSnapshot).
type Origin={origin?:ArchiveSource['origin']};
type SourceText=Origin&Pick<ArchiveSource,'content'>;
type SourceFields=SourceText&Pick<ArchiveSource,'title'|'scope'|'url'>;
type Masked={text:string;findings:PiiFinding[];allowed:PiiFinding[]};
export type ModelSourceText={title:string;scope:string;url:string;content:string;excerpt:boolean};
export const userProvidedSource=(source:Origin)=>source.origin!=='research';
// allow: 가리지 않는 허용 값(제작 경로와 같은 확정 사실 값·지점 주소·사업장 유선 번호, lib/archive-server.ts sourceMaskAllow).
export function modelSourceContent(source:SourceText,allow:readonly unknown[]=[]):string{
 return userProvidedSource(source)?maskText(source.content,{allow}).text:source.content;
}
// 앞부분 창 가림(DP3-B-03): 본문(최대 80,000자) 전체 대신 상한 근처의 앞부분만 가린다. 가린 창이 상한+여유분보다 짧으면(자리표시로 줄어든 경우) 창을 두 배로 넓힌다.
// 탐지는 창 끝에서 여유분(WINDOW_MARGIN)보다 가까운 곳만 본문 전체 가림과 달라질 수 있고, 자리표시는 원문보다 많아야 1.34배 길어 그 차이가 상한 안으로 들어오지 않는다.
// 그래서 결과는 본문 전체를 가린 뒤 자른 것과 같다(경계에 걸친 번호는 자르기 전에 가린다). 예외는 길이 제한이 없는 패턴이 창 끝에 수백 자 걸친 경우(이메일 앞부분만 수백 자인 문자열 등)뿐이다.
// 가림 기록 건수는 가린 창 기준이다(보낸 본문 뒤 여유분의 탐지가 함께 셀 수 있다).
const WINDOW_MARGIN=256;
function maskPrefix(content:string,size:number,limit:number,allow:readonly unknown[]):{masked:Masked;size:number}{
 const masked=maskText(content.slice(0,size),{allow});
 return masked.text.length>=limit+WINDOW_MARGIN||size>=content.length?{masked,size}:maskPrefix(content,Math.min(content.length,size*2),limit,allow);
}
// 모델 입력의 자료 본문과 잘림 표시, 가림 기록(종류·건수, 값 없음). 상한은 기존 입력과 같고, excerpt는 실제로 보낸 가린 본문이 잘렸는지를 뜻한다(자리표시로 길이가 달라진다).
export function modelSourceExcerpt(source:SourceText,limit:number,allow:readonly unknown[]=[]):{content:string;excerpt:boolean;findings:PiiFinding[];allowed:PiiFinding[]}{
 const content=source.content;
 if(!userProvidedSource(source))return {content:content.slice(0,limit),excerpt:content.length>limit,findings:[],allowed:[]};
 const {masked,size}=maskPrefix(content,Math.min(content.length,limit+2*WINDOW_MARGIN),limit,allow);
 return {content:masked.text.slice(0,limit),excerpt:masked.text.length>limit||size<content.length,findings:masked.findings,allowed:masked.allowed};
}
// 자료 목록의 모델 입력 필드(제목·확인 범위·URL·본문 발췌)와 가림 기록. 기록 필드는 모델 입력 경로 '<prefix>.<순번>.<필드>'이고, 가린 탐지 뒤에 허용 탐지(allowed:true)가 온다.
// 문자열이 아닌 필드(옛 기록의 빈 값)는 그대로 둔다.
const TEXT_FIELDS=['title','scope','url'] as const;
const keep=(text:string):Masked=>({text,findings:[],allowed:[]});
export function modelSources(sources:readonly SourceFields[],limit:number,allow:readonly unknown[],prefix:string):{texts:ModelSourceText[];masking:InputMasking[]}{
 const each=sources.map((s,i)=>{
  const [title,scope,url]=TEXT_FIELDS.map(k=>userProvidedSource(s)&&typeof s[k]==='string'?maskText(s[k],{allow}):keep(s[k]));
  const body=modelSourceExcerpt(s,limit,allow),parts=[['title',title],['scope',scope],['url',url],['content',body]] as const;
  const at=(pick:(m:Masked|typeof body)=>PiiFinding[]):PiiFieldFinding[]=>parts.flatMap(([k,m])=>pick(m).map(f=>({field:`${prefix}.${i}.${k}`,...f})));
  return {text:{title:title.text,scope:scope.text,url:url.text,content:body.content,excerpt:body.excerpt},findings:at(m=>m.findings),allowed:at(m=>m.allowed)};
 });
 return {texts:each.map(e=>e.text),masking:inputMaskingRecord({findings:each.flatMap(e=>e.findings),allowed:each.flatMap(e=>e.allowed)})};
}

// 트랙 R 결정 34(대표 결정 2026-09-27): R2 다음 개선은 승인 화면의 사람 확인이다. 규칙 보강은 멈춘다.
// 모집 자료(R15a) 승인·내보내기 화면이 대기기간·계약·가맹금·정보공개서 관련 문장을 강조해 보이고, 승인자는 '대기기간 우회 문장 없음'을 확인한다.
// 이 모듈은 강조할 후보 문장만 찾는다(순수 함수, 막지 않는다). 확인이 없으면 승인·내보내기가 409다(lib/franchise-assets.ts waitReviewIssue, 서버 강제).
// 후보 수를 확인 입력에 싣게 해서, 승인자가 본 후보 목록과 서버가 계산한 목록이 같은 원문·같은 판에서 나왔는지 대조한다. 감사에는 판·후보 수만 남기고 문장 원문은 남기지 않는다.
// 후보는 낱말로 고른 것이라 우회 문장이 아닌 문장도 많다. COLLECTIVE 휴리스틱 · 법률 자문 아님.

export const WAIT_REVIEW_VERSION='fr-wait-review@2026-09-27.1';
// 강조 후보 낱말: 대기기간·문서·계약 행위·돈·때. 대소문자와 띄어쓰기 변형을 받는다.
const CUE=new RegExp([
 '대기\\s?기간','숙려','검토\\s?기간','정보\\s?공개서','공개서','정공서','계약서\\s?(?:초\\s?)?안','FDD','[Dd]isclosure','[Ww]aiting',
 '계약','체결','서명','사인','도장','[Cc]ontract','[Ss]ign',
 '가맹금','가맹비','가입비','계약금','예약금','보증금','예치금','선점','홀딩','입금','결제','선납','송금','[Dd]eposit',
 'D\\s?[+-]\\s?\\d','\\d+\\s?(?:영업\\s?)?일\\s?(?:뒤|후|만에|째|이내|안에|이면)','이틀','사흘','나흘','당일','현장','즉시','바로',
].join('|'));
export type WaitReviewCandidate={readonly line:number;readonly start:number;readonly end:number};
// 원문 오프셋(UTF-16)으로 돌려준다. 문장은 줄바꿈과 문장부호(. ? !) 뒤에서 끊는다. 앞뒤 공백은 뺀다.
export function waitReviewCandidates(body:unknown):WaitReviewCandidate[]{
 if(typeof body!=='string')return [];
 const out:WaitReviewCandidate[]=[];
 let offset=0;
 body.split('\n').forEach((text,line)=>{
  for(const m of text.matchAll(/[^.?!]+[.?!]*/g)){
   const raw=m[0],lead=raw.length-raw.trimStart().length,trimmed=raw.trim();
   if(trimmed&&CUE.test(trimmed.normalize('NFKC'))){const start=offset+m.index!+lead;out.push({line,start,end:start+trimmed.length})}
  }
  offset+=text.length+1;
 });
 return out;
}
export type WaitReviewSummary={readonly version:string;readonly candidates:number};
export const waitReviewSummary=(body:unknown):WaitReviewSummary=>({version:WAIT_REVIEW_VERSION,candidates:waitReviewCandidates(body).length});

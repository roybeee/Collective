// 작업물 본문의 가벼운 판정·표시 도구. 홈·목록 화면이 lib/role-output.ts 전체(실천 지침·카피 팩·정규화)를 싣지 않도록 따로 둔다(UX-PLAN-3 Q7).
// lib/role-output.ts가 같은 이름으로 다시 내보낸다. 동작은 옮기기 전과 같다.
import type {Artifact} from './agency';
// A narrow guard for known nonanswers, not a factual accuracy or quality judgment.
export function isQuestionOnly(content:string){
 const text=content.trim();
 if(text.length>2500)return false;
 // '없다'는 작업·요청·과업이 바로 주어일 때만 본다('요청하신 작업이 없습니다'). '… 과업이 확인되지 않은 상태에서 … 단정할 수 없습니다'는 재질문이 아니다(R3 기준선 MAPDAL 크리에이티브).
 return /(?:작업|요청|과업)[\s\S]{0,35}(?:명시되지|지정되지|주어지지)|(?:작업|요청|과업)이\s?(?:없습니다|없어요)/.test(text)
  ||/(?:원하시는|수행할|진행할|어떤)[\s\S]{0,35}(?:작업|업무)[\s\S]{0,50}(?:선택해|지정해|알려\s?주|말씀해)/.test(text)
  ||/(?:what (?:task|would you like)|please (?:specify|choose) (?:the |a )?task)/i.test(text);
}
export type IdLabels=Record<string,string>;
const idWrap=(core:string)=>'`?(?:[\\w.]{0,40}id\\s{0,3}[=:]\\s{0,3})?'+core+'(?:\\s{0,3}[,/·]?\\s{0,3}(?:version|v)\\s{0,3}[=:]?\\s{0,3}\\d+)?`?';
const escapeRegex=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// 알려진 식별자: 바로 앞의 같은 출처 이름(예: '브랜드 자료 id=…')까지 라벨 하나로 합친다. 짧은 ID는 일반 단어와 겹칠 수 있어 제외한다.
function labelKnownIds(text:string,labels:IdLabels){
 return Object.entries(labels).filter(([id])=>id.length>=20).sort((a,b)=>b[0].length-a[0].length).reduce((out,[id,label])=>{
  const stem=label.replace(/\s(?:v\d+|#\d+)$/,''),last=stem.split(' ').pop()!;
  const pattern=new RegExp(`(?:(?<![가-힣A-Za-z0-9])(?:${escapeRegex(stem)}|${escapeRegex(last)})\\s{0,3}(\\()?\\s{0,3})?${idWrap(escapeRegex(id))}(\\s{0,3}\\))?`,'gi');
  return out.replace(pattern,(_,open?:string,close?:string)=>label+(open&&!close?'(':'')+(close&&!open?')':''));
 },text);
}
// URL 안의 식별자는 출처 주소이므로 그대로 둔다. 입력에 없는 UUID는 다른 출처로 둔갑시키지 않고 '내부 참조'로 둔다.
export function scrubInternalIds(text:string,labels:IdLabels={}){
 return text.split(/(https?:\/\/[^\s)>\]]+)/).map((part,i)=>i%2?part:labelKnownIds(part,labels)
  .replace(new RegExp(idWrap(`(?:meeting-)?${uuid}(?:-[a-z0-9]{1,12}){0,3}`),'gi'),'내부 참조')
  .replace(new RegExp(idWrap('ai-[0-9a-f]{32}'),'gi'),'이전 작업물')
  .replace(/`?(?:(?:(?:브랜드\s?)?아카이브\s?|brandArchive\.?|archive\s?)revision\s?[=:]?\s?\d+|\brevision\s?[=:]\s?\d+)`?/gi,'브랜드 자료')
  .replace(/(이전 작업물|브랜드 자료|내부 참조)(?:\s{0,3}[(/·,]?\s{0,3}\1\s{0,3}\)?)+/g,'$1')
  // 모음으로 끝나는 치환어 뒤에 남은 받침용 조사를 맞춘다.
  .replace(/(브랜드 자료|내부 참조)(과|을|은)(?=[\s,.)\]]|$)/g,(_,word:string,particle:string)=>word+({과:'와',을:'를',은:'는'} as Record<string,string>)[particle])).join('');
}
export function artifactUsable(a:Artifact,campaignVersion:number){
 return ['review','approved'].includes(a.status)&&(!a.campaignVersion||a.campaignVersion===campaignVersion)&&!!a.content.trim()&&!isQuestionOnly(a.content);
}

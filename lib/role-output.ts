import {roles,type Artifact} from './agency';
import {practices} from './practice';

export const ROLE_OUTPUT_VERSION='role-output-v1';
// 저장된 계약에만 붙는 실행 스냅샷: factRefs(입력에 쓴 확정·거절 사실), idLabels(입력 식별자→ref 라벨), claimGuard(저장 전 광고 표현 검사 목록).
export type RoleOutputContract={version:string;role:string;contextTruncated?:boolean;sections:{id:string;title:string}[];factRefs?:{id:string;version:number;status?:'confirmed'|'rejected'}[];idLabels?:Record<string,string>;claimGuard?:{prohibited:string[];unverified:string[]}};
export function roleOutputContract(role:string):RoleOutputContract {
 return {version:ROLE_OUTPUT_VERSION,role,sections:practices[role].outputs.map((title,index)=>({id:`output_${index+1}`,title}))};
}
// A narrow guard for known nonanswers, not a factual accuracy or quality judgment.
export function isQuestionOnly(content:string){
 const text=content.trim();
 if(text.length>2500)return false;
 return /(?:작업|요청|과업)[\s\S]{0,35}(?:명시되지|지정되지|주어지지|없습니다|없어요)/.test(text)
  ||/(?:원하시는|수행할|진행할|어떤)[\s\S]{0,35}(?:작업|업무)[\s\S]{0,50}(?:선택해|지정해|알려\s?주|말씀해)/.test(text)
  ||/(?:what (?:task|would you like)|please (?:specify|choose) (?:the |a )?task)/i.test(text);
}
// 형식을 바꾼 재질문: 번호 선택지+선택 요청, 또는 입력을 받으면 작성하겠다는 보류. 2,500자 제한은 섹션 단위다.
// 고르게 하는 대상이 산출물·작업 방향일 때만 재질문이다. 고객 투표·퀴즈 문안과 사실 확인 요청은 제외한다.
const workObject=/작업|업무|과업|방향|전략|산출물|옵션|선택지|초안|작성|진행/,workOption=/작업|업무|과업|방향|전략|산출물|옵션|초안/;
const chooseAll=/(?:지정|선택|골라)\s?(?:해\s?)?주(?:세요|시면|십시오)|말씀해\s?주(?:세요|시면)|알려\s?주시면|번호[^\n]{0,12}주(?:세요|시면)/g;
const deferAll=/(?:알려|말씀해|지정해|선택해|정해)\s?주시면\s?(?:바로|즉시|해당\s?방향으로)?\s?(?:전체\s?산출물을\s?)?(?:작성|진행|시작)(?:하겠|해\s?드리겠|할게)/g;
// 요청 문장 바로 앞 같은 문장 안의 목적어(최대 40자).
const objectBefore=(text:string,index:number)=>text.slice(Math.max(0,index-40),index).split(/[.!?\n]/).pop()!;
function sentenceAt(text:string,index:number){
 const start=Math.max(...['.','!','?','\n'].map(c=>text.lastIndexOf(c,index-1)))+1,end=/[.!?\n]/.exec(text.slice(index));
 return text.slice(start,end?index+end.index+1:text.length).trim();
}
function asksInsteadOfWriting(text:string){
 if(text.length>2500)return false;
 if(isQuestionOnly(text))return true;
 const numbered=/(?:^|[\s:])(?:1[.)]|①)\s*\S[\s\S]*?(?:^|[\s:])(?:2[.)]|②)\s*\S/m.test(text);
 const framing=/(?:다음|아래|위)\s?(?:중|선택지|항목)|중(?:에서)?\s?(?:하나|한\s?가지|무엇|어느)|한\s?가지만|원하시는|번호/.test(text);
 if(numbered&&framing&&[...text.matchAll(chooseAll)].some(m=>workObject.test(objectBefore(text,m.index))||workOption.test(text.slice(m.index+m[0].length,m.index+m[0].length+40))))return true;
 // 사실 확인을 기다리는 보류 문장은 짧은 섹션의 대부분을 차지할 때만 재질문으로 본다.
 return [...text.matchAll(deferAll)].some(m=>workObject.test(objectBefore(text,m.index))||text.length<300&&sentenceAt(text,m.index).length*2>text.length);
}
// 제목 줄로 나눈 섹션. 제목과 본문이 붙으면 좁은 재질문 정규식이 오탐하므로 본문만 검사한다.
function sectionsOf(text:string){
 const parts=text.split(/^#{1,6}[ \t]+(.*)$/m);
 return [{title:'',body:parts[0]},...Array.from({length:(parts.length-1)/2},(_,i)=>({title:parts[2*i+1].trim(),body:parts[2*i+2]}))].map(s=>({...s,body:s.body.trim()})).filter(s=>s.body);
}
const bodyLines=(sections:{body:string}[])=>sections.flatMap(s=>s.body.split('\n')).map(x=>x.trim()).filter(x=>x&&!/^#{1,6}\s/.test(x));
const placeholderLine=(x:string)=>/자료\s?필요/.test(x);
// '자료 필요'로 시작하는 줄만 있는 항목은 조건부 초안 없이 자료 요청만 남긴 항목이다.
const placeholderOnly=(x:string)=>/^[-*\s]*[\[(【]?\s?자료\s?필요/.test(x);
// 재작성 결과의 반영 위치 절은 요청 문장을 인용하기 쉬워 재질문 검사에서 뺀다.
const reaskExempt=new Set(['수정 요청 반영 위치']);
export type SubstanceProblem='reask'|'short'|'placeholder';
// Minimum substance, not a quality judgment. 재질문은 섹션 과반이 재질문이거나 나머지 본문이 최소량 미만일 때만 실패로 본다.
export function substanceProblem(text:string,minChars=250):SubstanceProblem|null{
 const sections=sectionsOf(text),checked=sections.filter(s=>!reaskExempt.has(s.title)),asks=checked.filter(s=>asksInsteadOfWriting(s.body));
 if(asks.length&&(asks.length*2>checked.length||bodyLines(sections.filter(s=>!asks.includes(s))).join('\n').length<minChars))return 'reask';
 const lines=bodyLines(sections);
 if(lines.join('\n').length<minChars)return 'short';
 if(lines.filter(placeholderLine).length/lines.length>0.8||sections.filter(s=>bodyLines([s]).every(placeholderOnly)).length*2>sections.length)return 'placeholder';
 return null;
}
const substanceMessages:Record<SubstanceProblem,string>={reask:'담당 과업 대신 선택지를 제시하거나 재질문했습니다. 조건부 초안과 확인 계획으로 다시 작성하세요.',short:'본문이 250자 미만인 빈 초안입니다. 필수 산출물을 실제 초안으로 작성하세요.',placeholder:"'자료 필요' 줄이나 '자료 필요'만 있는 항목이 대부분이라 실질 초안이 없습니다. 가능한 조건부 초안을 먼저 작성하세요."};
export function substantiveIssue(text:string):string|null{
 const problem=substanceProblem(text);
 return problem&&substanceMessages[problem];
}
// 실행 입력의 내부 식별자 → 입력에 붙인 ref 라벨. 저장 본문에서 식별자를 알려진 출처 이름으로 바꾸는 데 쓴다.
export type IdLabels=Record<string,string>;
export function idLabels({campaign,archive,artifacts=[]}:{campaign?:{id:string;version:number};archive?:{confirmedSources?:{id?:unknown}[];observations?:{id?:unknown}[];confirmedDiagnosis?:{id?:unknown}|null};artifacts?:{id:string;role:string;version:number}[]}):IdLabels{
 const labels:IdLabels={},set=(id:unknown,label:string)=>{if(typeof id==='string'&&id)labels[id]=label};
 archive?.confirmedSources?.forEach((s,i)=>set(s.id,`브랜드 자료 #${i+1}`));
 archive?.observations?.forEach((o,i)=>set(o.id,`채널 관찰 #${i+1}`));
 set(archive?.confirmedDiagnosis?.id,'브랜드 진단');
 for(const a of artifacts)set(a.id,`${roles.find(r=>r.id===a.role)?.name||a.role} v${a.version}`);
 if(campaign)set(campaign.id,`브리프 v${campaign.version}`);
 return labels;
}
// 산출물 본문에 새어 나온 내부 식별자를 사람이 읽는 출처 표현으로 바꾼다. 수량자는 모델 출력 길이에 대해 선형 시간이 되도록 상한을 둔다.
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
// 입력 출처에 인용용 ref 라벨을 붙인다. 원래 식별자는 다른 기능이 쓰므로 유지한다.
export function labelArchive<T extends {confirmedSources?:object[]}>(archive:T):T{
 return {...archive,...(archive.confirmedSources?{confirmedSources:archive.confirmedSources.map((s,i)=>({ref:`브랜드 자료 #${i+1}`,...s}))}:{})};
}
function outputError(message:string):never {throw new Error(`작업물 수정 필요: ${message}`)}
export function parseRoleOutput(content:string,role:string,contract?:RoleOutputContract){
 if(!content.trim())return outputError('본문이 비어 있습니다.');
 if(isQuestionOnly(content))return outputError('담당 과업 대신 작업 선택을 요청했습니다.');
 if(!contract||role==='quality')return content;
 let raw:unknown;try{raw=JSON.parse(content.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''))}catch{return outputError('필수 산출물 JSON 형식이 아닙니다.');}
 if(!raw||typeof raw!=='object')return outputError('결과 객체가 필요합니다.');
 const result=raw as Record<string,unknown>;
 if(result.contractVersion!==contract.version||result.role!==role)return outputError('담당 또는 산출물 계약 버전이 일치하지 않습니다.');
 if(!Array.isArray(result.sections)||result.sections.length!==contract.sections.length)return outputError('필수 산출물 항목이 누락되거나 중복되었습니다.');
 const sections=result.sections as Record<string,unknown>[];
 const rendered=contract.sections.map(required=>{
  const matches=sections.filter(s=>s&&typeof s==='object'&&s.id===required.id);
  if(matches.length!==1)return outputError(`${required.id} (${required.title}) 항목이 필요합니다.`);
  const body=matches[0].content;
  if(typeof body!=='string'||!body.trim()||isQuestionOnly(body))return outputError(`${required.id} 항목에 실제 초안 또는 자료 필요·확인 계획을 작성하세요.`);
  return `## ${required.title}\n\n${body.trim()}`;
 }).join('\n\n')+(typeof result.changes==='string'&&result.changes.trim()?`\n\n## 수정 요청 반영 위치\n\n${result.changes.trim()}`:'');
 if(rendered.length>40000)return outputError('산출물이 40,000자 저장 한도를 초과했습니다. 요약해서 다시 작성하세요.');
 return rendered;
}
export function artifactUsable(a:Artifact,campaignVersion:number){
 return ['review','approved'].includes(a.status)&&(!a.campaignVersion||a.campaignVersion===campaignVersion)&&!!a.content.trim()&&!isQuestionOnly(a.content);
}
export function upstreamContext(artifacts:Artifact[],role:string,campaignVersion:number){
 const index=roles.findIndex(r=>r.id===role);
 return roles.slice(0,index).flatMap(prior=>{
  const a=artifacts.filter(a=>a.role===prior.id&&artifactUsable(a,campaignVersion)).sort((a,b)=>b.version-a.version||b.createdAt?.localeCompare(a.createdAt))[0];
  return a?[{ref:`${prior.name} v${a.version}`,version:a.version,role:a.role,title:a.title,content:a.content.slice(0,role==='quality'?24000:6000),excerpt:a.content.length>(role==='quality'?24000:6000),originalLength:a.content.length}]:[];
 });
}

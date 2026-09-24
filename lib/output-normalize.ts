// 사람이 보는 역할 산출물의 결정론적 정규화(품질 기준선 v1). 원 응답(raw)은 바꾸지 않고 렌더한 본문에만 적용한다.
// (1) 알려진 입력 스키마 경로 → 한국어 라벨. 루트 목록은 internal_id_exposure 채점기(lib/graders/structure.ts SCHEMA_PATH)와 같고 storeContext를 더했다.
//     라벨은 화면 이름이다: campaign.*는 브리프 화면 필드 이름(lib/brief.ts questionFields·planFields), evidence.*는 지시문·화면 용어(확정 사실·후보 사실·거절된 사실·상시 지시·사실 원장).
//     지시문은 경로를 '확정 사실(evidence.facts.confirmed)'처럼 부르므로 모델이 이 형식을 따라 쓴다. 경로만 든 괄호는 괄호째 지우고('(경로, 설명)'은 경로와 쉼표만) 같은 이름이 겹치지 않게 한다.
//     모르는 경로·인덱스([0])·대입(=값)은 바꾸지 않고 채점기가 잡게 둔다. URL(스킴 없는 도메인/경로 포함)·코드 블록 안은 건드리지 않는다. 인라인 코드는 알려진 경로 하나만 든 것만 라벨로 바꾼다.
// (2) 계약 섹션 본문 안의 #·## 제목 줄 → ###(heading_nesting 채점기와 같은 /^#{1,2}\s/ 기준). 계약 제목은 렌더러가 붙이므로 본문에 없다.
// 정규화로 가린 결함은 예방된 것이 아니다. 건수는 평가 결과(lib/eval-server.ts)·운영 작업물(outputNormalization)에 남고, 정규화 전 판정은 lib/graders PREVENTION_GRADERS가 낸다.
import {questionFields,planFields} from './brief';
export type OutputNormalization={schemaPaths:number;headings:number};
// 화면 필드 이름의 ' · '·' / ' 구분은 붙여 쓴다(예: '고객의 이용 장애물 · 인사이트' → '고객의 이용 장애물·인사이트').
const uiName=(s:string)=>s.replace(/\s+([·/])\s+/g,'$1');
const fieldLabels=(fields:Record<string,string>,keys:string[])=>Object.fromEntries(keys.map(k=>[k,uiName(fields[k])]));
const plan=fieldLabels(planFields,Object.keys(planFields));
const campaign={goal:'캠페인 목표',plan:'캠페인 계획',...fieldLabels(questionFields,Object.keys(questionFields).filter(k=>!(k in planFields)))};
const store={store:'지점 정보',channels:'지점 채널',operations:'지점 운영 요약',experiments:'지점 실험 기록',measurements:'지점 측정 기록',researchDraft:'지점 조사 초안'};
const archive={confirmedSources:'확인된 브랜드 자료',observations:'채널 관찰 기록',confirmedDiagnosis:'브랜드 진단',notice:'브랜드 자료 안내',storeMarketing:'지점 정보'};
const prefixed=(prefix:string,labels:Record<string,string>)=>Object.fromEntries(Object.entries(labels).map(([k,v])=>[`${prefix}.${k}`,v]));
export const SCHEMA_PATH_LABELS:Readonly<Record<string,string>>={
 ...prefixed('campaign',campaign),...prefixed('campaign.plan',plan),
 'evidence.facts':'사실 원장','evidence.facts.confirmed':'확정 사실','evidence.facts.candidate':'후보 사실','evidence.facts.prohibited':'거절된 사실','evidence.directives':'상시 지시',
 ...prefixed('brandArchive',archive),...prefixed('archive',archive),...prefixed('brandArchive.storeMarketing',store),...prefixed('archive.storeMarketing',store),...prefixed('storeContext',store),
};
const ROOTS='campaign|brandArchive|archive|evidence|artifact|artifacts|stores|products|operations|budgetPlan|learning|snapshot|storeContext';
const PATH_SRC=`(?:${ROOTS})(?:\\.(?:[A-Za-z_]\\w*|\\d+))+`;
// 경로 뒤 한글 세 자까지 함께 잡아 붙은 조사를 라벨의 받침에 맞춘다. 이·가·나는 뒤에 한글이 이어지면(이며·이다 등) 조사로 보지 않는다.
const PATH=new RegExp(`(?<![\\w/.])${PATH_SRC}([가-힣]{0,3})`,'g');
// 붙은 단어 바로 뒤('라벨(경로)', '라벨 (경로)')의 경로 괄호. 경로 뒤가 ')'면 괄호째, ','면 경로와 쉼표만 지운다.
const PAREN=new RegExp(`(?<=[가-힣A-Za-z0-9\\])])( ?)\\(\\s*(${PATH_SRC})\\s*(\\)|,\\s*)`,'g');
const PARTICLE=/^(?:이라는|이라고|이라서|이랑|이란|이라|으로|이나|라는|라고|라서|랑|란|라|로|은|는|을|를|과|와|(?:이|가|나)(?![가-힣]))/;
const PAIRS=[['은','는'],['이','가'],['을','를'],['과','와'],['이나','나'],['으로','로'],['이랑','랑'],['이라는','라는'],['이라고','라고'],['이라서','라서'],['이란','란'],['이라','라']];
function particleFor(label:string,particle:string){
 const code=label.charCodeAt(label.length-1)-0xac00,pair=PAIRS.find(p=>p.includes(particle));
 if(code<0||code>11171||!pair)return particle;
 const jong=code%28;
 return pair[0]==='으로'?(jong&&jong!==8?'으로':'로'):pair[jong?0:1];
}
// 산문 조각 하나(URL·인라인 코드 제외)의 경로 치환. 인덱스([0])·대입(=값)이 뒤따르면 디버그 표기라 두고 채점기가 잡게 한다.
// 뒤 문맥은 12자만 본다(조사 3자+경계 1자, 대입 앞 공백). 모델 출력 길이에 대해 선형 시간이다.
function labelProse(text:string){
 let count=0;
 const bare=text.replace(PAREN,(match:string,space:string,path:string,close:string)=>{
  if(!SCHEMA_PATH_LABELS[path])return match;
  count++;
  return close===')'?'':space+'(';
 });
 const out=bare.replace(PATH,(match:string,tail:string,offset:number)=>{
  const path=match.slice(0,match.length-tail.length),label=SCHEMA_PATH_LABELS[path],start=offset+path.length,next=bare.slice(start,start+12);
  if(!label||/^\s*=|^\[/.test(next))return match;
  count++;
  const particle=PARTICLE.exec(next)?.[0];
  return label+(particle?particleFor(label,particle)+tail.slice(particle.length):tail);
 });
 return {text:out,count};
}
// 건드리지 않는 조각: 인라인 코드, 스킴 있는 URL, 스킴 없는 도메인/경로(mapdal.kr/event?ref=…). 스키마 루트로 시작하는 점 표기는 도메인으로 보지 않는다.
const INLINE=new RegExp(`(\`[^\`\\n]*\`|https?:\\/\\/[^\\s)>\\]]+|(?<![\\w@.-])(?!(?:${ROOTS})\\.)(?:[A-Za-z0-9-]+\\.)+[A-Za-z]{2,}(?::\\d+)?\\/[^\\s)>\\]]*)`);
// 홑 백틱 코드만 본다(``·``` 코드는 그대로 둔다).
const CODE_SPAN=/(?<!`)`([^`\n]+)`(?!`)/g;
// 코드 울타리: 여는 줄의 문자(` 또는 ~)와 길이를 기억해 같은 문자·같거나 긴 길이의 빈 울타리 줄에서만 닫는다. 같은 줄에 백틱이 더 있는 ```코드```는 울타리가 아니다.
const FENCE=/^\s{0,3}(`{3,}|~{3,})(.*)$/;
// 줄 단위 변환. 코드 울타리 안의 줄은 그대로 둔다.
function mapProseLines(text:string,line:(l:string)=>string){
 let open='';
 return text.split('\n').map(l=>{
  const fence=FENCE.exec(l);
  if(open){if(fence&&fence[1][0]===open[0]&&fence[1].length>=open.length&&!fence[2].trim())open='';return l}
  if(fence&&!(fence[1][0]==='`'&&fence[2].includes('`'))){open=fence[1];return l}
  return line(l);
 }).join('\n');
}
export function labelSchemaPaths(text:string){
 let count=0;
 const out=mapProseLines(text,l=>l.replace(CODE_SPAN,(span:string,inner:string)=>SCHEMA_PATH_LABELS[inner.trim()]?inner.trim():span).split(INLINE).map((part,i)=>{if(i%2)return part;const r=labelProse(part);count+=r.count;return r.text}).join(''));
 return {text:out,count};
}
const TOP_HEADING=/^#{1,2}(?=\s)/;
export function lowerBodyHeadings(text:string){
 let count=0;
 const out=mapProseLines(text,l=>{if(!TOP_HEADING.test(l))return l;count++;return l.replace(TOP_HEADING,'###')});
 return {text:out,count};
}
// 계약 섹션 본문·'수정 요청 반영 위치' 본문에 쓴다.
export function normalizeSectionBody(text:string):{text:string;normalization:OutputNormalization}{
 const headings=lowerBodyHeadings(text),paths=labelSchemaPaths(headings.text);
 return {text:paths.text,normalization:{schemaPaths:paths.count,headings:headings.count}};
}
// 품질 검수 JSON: 경로만 바꾼다(제목은 qualityMarkdown이 만든다). JSON 원문 텍스트가 아니라 문자열 값마다 풀어서 정규화하고 다시 인코딩한다.
// 원문 텍스트에 걸면 \n·\t 이스케이프 바로 뒤, 같은 줄 URL 뒤, 두 문자열에 걸친 백틱 사이의 경로를 놓친다. 경로가 없는 문자열과 JSON 바깥 형식(울타리·들여쓰기)은 바이트 그대로다.
// JSON 객체가 아니면 바꾸지 않는다(계약 실행의 parseStandaloneQuality가 형식 오류로 돌려보낸다).
const JSON_STRING=/"(?:[^"\\\n]|\\.)*"/g;
export function normalizeQualityOutput(text:string):{text:string;normalization:OutputNormalization}{
 let parsed:unknown;try{parsed=JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''))}catch{}
 if(!parsed||typeof parsed!=='object')return {text,normalization:NO_NORMALIZATION};
 let count=0;
 const out=text.replace(JSON_STRING,(literal:string)=>{
  let value:unknown;try{value=JSON.parse(literal)}catch{return literal}
  if(typeof value!=='string')return literal;
  const r=labelSchemaPaths(value);
  if(!r.count)return literal;
  count+=r.count;
  return JSON.stringify(r.text);
 });
 return {text:out,normalization:{schemaPaths:count,headings:0}};
}
export const addNormalization=(a:OutputNormalization,b:OutputNormalization):OutputNormalization=>({schemaPaths:a.schemaPaths+b.schemaPaths,headings:a.headings+b.headings});
export const NO_NORMALIZATION:OutputNormalization={schemaPaths:0,headings:0};

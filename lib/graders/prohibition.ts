import {type Block} from './text';
import {prohibitiveLabel} from './negation';

// 금지·보류 맥락 제외(content.ts unsupported_claim_term·ledger.ts fact_conflict 공용, R3 기준선에서 content.ts로부터 옮김).
// 금지·보류 맥락(prohibitiveLabel)은 대상이 아니다: 그런 제목 아래(다음 같은 수준 이상 제목 전까지), 그런 라벨·인라인 라벨의 블록,
// 머리칸이 금지·보류인 표의 행(나머지 머리칸이 분류·보조 칸이 아니면 금지 칸만). '금지 또는 보류 표현' 표·목록은 규칙이지 카피 사용이 아니다.
const headingLevel=(line:string)=>/^(#{1,6})\s/.exec(line)?.[1].length||0;
const cellsOf=(row:string)=>row.trim().split('|');
// 금지 열: 머리칸이 금지 맥락이거나 금지·보류의 사유 칸('보류 사유', '제외 이유')이다. 표 전체가 금지 목록인 것은 나머지 머리칸이 모두 분류·보조 칸일 때뿐이다
// ('| 구분 | 사용하지 않을 표현 | 이유 |'). '| 안 | 문구 | 보류 사유 |', '| 채널 | 내용 | 금지 |'처럼 다른 열이 있으면 금지 열만 비우고 나머지 칸은 채점한다.
const TABLE_AUX=/^(?:유형|구분|분류|항목|범주|이유|사유|근거|조치|처리|기준|예시|비고|표현|번호)$/;
function bannedColumns(header:string){
 const cells=cellsOf(header),banned=cells.flatMap((c,i)=>c.trim()&&prohibitiveLabel(c.replace(/\s?(?:사유|이유)\s*$/,''))?[i]:[]);
 return {all:banned.length>0&&cells.every((c,i)=>!c.trim()||banned.includes(i)||TABLE_AUX.test(c.trim())),cols:banned};
}
// level: 금지 맥락 제목의 수준(0이면 없음). banned: 둘러싼 라벨(가장 가까운 라벨 줄)이 금지 맥락인지. table: 지금 표의 금지 열.
type Scope={level:number;banned:boolean;table:ReturnType<typeof bannedColumns>|null;out:Block[]};
export function outsideProhibition(list:Block[]):Block[]{
 return list.reduce<Scope>((acc,b)=>{
  const h=headingLevel(b.line),row=b.line.trim().startsWith('|'),own=b.isLabel&&prohibitiveLabel(b.label);
  const open=h&&acc.level&&h<=acc.level?0:acc.level,level=h&&!open&&own?h:open;
  const banned=b.isLabel?own:acc.banned,table=row?acc.table||bannedColumns(b.line):null;
  if(level||banned||b.inline&&prohibitiveLabel(b.inline)||table?.all)return {level,banned,table,out:acc.out};
  const line=table?.cols.length?cellsOf(b.line).map((c,i)=>table.cols.includes(i)?'':c).join('|'):b.line;
  return {level,banned,table,out:[...acc.out,{...b,line}]};
 },{level:0,banned:false,table:null,out:[]}).out;
}
// '다음 표현은 … 사용하지 않는다'처럼 금지를 여는 리드 문장 아래 인용만 있는 줄(빈 줄 허용)은 금지 목록이라 뺀다. 제목·산문 줄이 오면 끝난다(R3 기준선 MAPDAL 개선본 실측).
const BAN_LEAD=/(?:다음|아래)\s?(?:표현|문구|카피|단어|어휘)(?:은|는|을|를)?[^.\n]{0,40}(?:(?:사용하|쓰|넣)지\s?않(?:는다|습니다|음)|금지(?:한다|합니다|함)?)[.。]?\s*$/;
// 목록 항목 끝 마침표('- ‘24시간 운영’, ‘24시간 보안요원 상주’.')도 인용만 있는 줄이다(R3 기준선 S6 실측).
const QUOTES_ONLY=/^\s*(?:[-*•]\s*)?(?:[“‘"「『][^”’"」』\n]{1,60}[”’"」』]\s*[,，·/]?\s*)+[.。]?\s*$/;
export function withoutBannedLists(text:string){
 let open=false;
 return text.split('\n').map(line=>{
  if(open&&(QUOTES_ONLY.test(line)||!line.trim()))return QUOTES_ONLY.test(line)?'':line;
  open=BAN_LEAD.test(line.trim());
  return line;
 }).join('\n');
}

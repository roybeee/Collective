// 홈 '오늘의 안건'(UX-PLAN P5·결정 2). 소유자의 모든 캠페인에서 기한 초과·결정 대기·새 신호·다가오는 기한을 한 목록으로 모은다.
// 읽기 전용 집계이며 외부 호출·자동 집행이 없다. 보관한 캠페인은 빼고, 항목마다 열 캠페인 탭·성장 섹션을 함께 돌려준다.
import type {Campaign} from './agency';
import {database,type Actor} from './server';
export type AgendaKind='overdue'|'decision'|'signal'|'upcoming';
export type AgendaItem={id:string;kind:AgendaKind;title:string;detail:string;campaignId:string;campaignTitle:string;due:string|null;section:'decide'|'execute'|'observe'|'prepare'|'evidence'|'learn'};
const DAY=86400000;
const kindFilter="kind IN ('growth_cs_ticket','growth_detected_signal','growth_expansion','growth_landing_revision','growth_collaboration','growth_mission')";
type Row={kind:string;data:string};
const text=(v:unknown,max=80)=>typeof v==='string'?v.slice(0,max):'';
export async function agenda(who:Actor,now=Date.now()){
 const campaigns=(await database().prepare("SELECT data FROM records WHERE owner=? AND kind='campaign' LIMIT 2000").bind(who.owner).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as Campaign&{archivedAt?:string|null}).filter(c=>!c.archivedAt);
 const byId=new Map(campaigns.map(c=>[c.id,c]));
 const rows=(await database().prepare(`SELECT kind,data FROM records WHERE owner=? AND ${kindFilter} LIMIT 20000`).bind(who.owner).all<Row>()).results;
 const items:AgendaItem[]=[];
 for(const r of rows){
  let d:Record<string,unknown>;try{d=JSON.parse(r.data) as Record<string,unknown>}catch{continue}
  const c=byId.get(String(d.campaignId??''));if(!c)continue;
  const base={campaignId:c.id,campaignTitle:c.title};const id=`${r.kind}:${String(d.id??'')}`;
  const input=(d.input??{}) as Record<string,unknown>;
  if(r.kind==='growth_cs_ticket'&&d.status==='open'){
   const due=typeof input.promisedBy==='string'?input.promisedBy:null,t=due?Date.parse(due):NaN;
   if(Number.isFinite(t)&&t<now)items.push({...base,id,kind:'overdue',title:'고객 문의 약속 기한 초과',detail:text(input.summary)||text(input.type),due,section:'observe'});
   else if(Number.isFinite(t)&&t<now+DAY)items.push({...base,id,kind:'upcoming',title:'고객 문의 약속 기한 임박',detail:text(input.summary)||text(input.type),due,section:'observe'});
  }
  if(r.kind==='growth_detected_signal'&&d.status==='new')items.push({...base,id,kind:'signal',title:text(d.title)||'새 감지 신호',detail:text(d.reason)||text(d.kind),due:null,section:'evidence'});
  if(r.kind==='growth_expansion'&&d.status==='proposed')items.push({...base,id,kind:'decision',title:'확대 제안 승인 대기',detail:text(input.title)||text(input.reason),due:null,section:'decide'});
  if(r.kind==='growth_landing_revision'&&(d.status==='draft'||d.status==='approved'))items.push({...base,id,kind:'decision',title:d.status==='draft'?'상세페이지 수정안 승인 대기':'승인한 상세페이지 적용 확인 대기',detail:text(input.title)||text(input.summary),due:null,section:'execute'});
  if(r.kind==='growth_collaboration'){const receipts=Array.isArray(d.receipts)?d.receipts as {stage?:string}[]:[];if(receipts.at(-1)?.stage==='delivered')items.push({...base,id,kind:'decision',title:'협업 콘텐츠 승인 대기',detail:text(input.partnerName)||text(input.title),due:null,section:'execute'});}
  if(r.kind==='growth_mission'&&!['closed','cancelled','completed','done'].includes(String(d.status??''))){
   const due=typeof input.deadline==='string'&&input.deadline?input.deadline:null,t=due?Date.parse(due.length===10?`${due}T23:59:59+09:00`:due):NaN;
   if(Number.isFinite(t)&&t<now)items.push({...base,id,kind:'overdue',title:'판매 미션 기한 지남',detail:text(input.title),due,section:'execute'});
   else if(Number.isFinite(t)&&t<now+3*DAY)items.push({...base,id,kind:'upcoming',title:'판매 미션 기한 3일 이내',detail:text(input.title),due,section:'execute'});
  }
 }
 const order:Record<AgendaKind,number>={overdue:0,decision:1,signal:2,upcoming:3};
 items.sort((a,b)=>order[a.kind]-order[b.kind]||(a.due??'9').localeCompare(b.due??'9')||a.campaignTitle.localeCompare(b.campaignTitle));
 const counts={overdue:0,decision:0,signal:0,upcoming:0} as Record<AgendaKind,number>;for(const i of items)counts[i.kind]++;
 return {items:items.slice(0,50),counts,total:items.length,generatedAt:new Date(now).toISOString()};
}
export type Agenda=Awaited<ReturnType<typeof agenda>>;

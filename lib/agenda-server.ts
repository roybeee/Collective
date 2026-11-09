// 홈 '오늘의 안건'(UX-PLAN P5·결정 2, GLOBAL-PLAN X1 결정 인박스 v2). 소유자의 모든 캠페인에서 기한 초과·결정 대기·질문·새 신호·다가오는 기한을 한 목록으로 모은다.
// 결정 대기는 성장 기록(확대 제안·상세페이지·협업) 외에 작업물 검토·발행 승인·회의/연속 실행 확인·자료 요청 열림을 함께 센다(lib/agenda-sources.ts).
// 읽기 전용 집계이며 외부 호출·자동 집행이 없다. 보관한 캠페인은 빼고, 항목마다 열 캠페인 탭·성장 섹션을 함께 돌려준다.
import {brandDefaults,type Campaign} from './agency';
import {database,type Actor} from './server';
import {artifactItem,briefQuestionItem,dataRequestItem,meetingItems,publicationItem,sequenceItem,type Names,type SourceCampaign} from './agenda-sources';
import {agendaTabOf,type Agenda,type AgendaCounts,type AgendaItem,type AgendaKind,type AgendaTab} from './agenda-types';
import {adsProposalItem,billingAlertItems,geoRunItem,placeDraftItem,reconsentItem} from './agenda-workspace-sources';
import {can,isScoped,type AccessPrincipal} from './access';
export type {Agenda,AgendaAction,AgendaItem,AgendaKind,AgendaQuick,AgendaTab} from './agenda-types';
const kstDay=(t:number)=>new Date(t+9*3600000).toISOString().slice(0,10);
const DAY=86400000;
const growthKinds=['growth_cs_ticket','growth_detected_signal','growth_expansion','growth_landing_revision','growth_collaboration','growth_mission'];
const inboxKinds=['artifact','execution_publication','team_meeting','campaign_sequence','data_request','brief_draft','geo_run'];
// 캠페인에 묶이지 않는 출처(lib/agenda-workspace-sources.ts). 요금 알림은 워크스페이스, 재동의 안내·플레이스 초안·광고 제안은 브랜드·지점 범위다.
const workspaceKinds=['billing_alert','kakao_reconsent_notice','place_draft','ads_proposal'];
const kindFilter=`kind IN (${[...growthKinds,...inboxKinds].map(k=>`'${k}'`).join(',')})`;
type Row={kind:string;data:string};
const text=(v:unknown,max=80)=>typeof v==='string'?v.slice(0,max):'';
const parse=(data:string)=>{try{return JSON.parse(data) as Record<string,unknown>}catch{return null}};
// 브랜드·지점 이름: 저장된 브랜드 기록이 없으면 기본 브랜드 목록(lib/agency.ts)에서 찾고, 그래도 없으면 id를 그대로 보인다.
async function names(owner:string):Promise<Names>{
 const rows=(await database().prepare("SELECT kind,data FROM records WHERE owner=? AND kind IN ('brand','store') LIMIT 4000").bind(owner).all<Row>()).results;
 const brand=new Map(brandDefaults.map(b=>[b.id,b.name])),store=new Map<string,string>();
 for(const r of rows){const d=parse(r.data);if(!d||typeof d.id!=='string')continue;if(r.kind==='brand'&&typeof d.name==='string')brand.set(d.id,d.name);if(r.kind==='store'&&typeof d.name==='string')store.set(d.id,d.name)}
 return {brand:id=>brand.get(id)??id,store:id=>id?store.get(id)??id:''};
}
function growthItems(kind:string,d:Record<string,unknown>,c:Campaign,now:number):AgendaItem[]{
 const base={campaignId:c.id,campaignTitle:c.title,source:'growth' as const};const id=`${kind}:${String(d.id??'')}`;
 const input=(d.input??{}) as Record<string,unknown>;
 if(kind==='growth_cs_ticket'&&d.status==='open'){
  const due=typeof input.promisedBy==='string'?input.promisedBy:null,t=due?Date.parse(due):NaN;
  if(Number.isFinite(t)&&t<now)return [{...base,id,kind:'overdue',title:'고객 문의 약속 기한 초과',detail:text(input.summary)||text(input.type),due,section:'observe',panel:'고객 문의·약속 기한'}];
  if(Number.isFinite(t)&&t<now+DAY)return [{...base,id,kind:'upcoming',title:'고객 문의 약속 기한 임박',detail:text(input.summary)||text(input.type),due,section:'observe',panel:'고객 문의·약속 기한'}];
 }
 if(kind==='growth_detected_signal'&&d.status==='new'){
  // 감지 기록은 detection 안에 제목·설명·권장 기한을 둔다(lib/growth-detection.ts). 이전 형식(맨 위 title)도 읽는다.
  const det=(d.detection??{}) as Record<string,unknown>,title=text(det.title)||text(d.title)||'새 감지 신호',suggested=typeof det.dueBy==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(det.dueBy)&&det.dueBy>=kstDay(now)?det.dueBy:kstDay(now+3*DAY);
  return [{...base,id,kind:'signal',title,detail:text(det.detail)||text(d.reason)||text(det.kind)||text(d.kind),due:null,section:'evidence',panel:'자사 장부 감지 신호',
   quick:typeof d.id==='string'&&Number.isSafeInteger(d.version)?{type:'acknowledge_signal',recordId:d.id,version:Number(d.version),campaignVersion:c.version,nextAction:`${title}: 원인을 확인하고 일일 결정에 기록`.slice(0,500),dueBy:suggested}:undefined}];
 }
 if(kind==='growth_expansion'&&d.status==='proposed')return [{...base,id,kind:'decision',title:'확대 제안 승인 대기',detail:text(input.title)||text(input.reason),due:null,section:'decide',panel:'검증된 확대·예산 예약'}];
 if(kind==='growth_landing_revision'&&(d.status==='draft'||d.status==='approved'))return [{...base,id,kind:'decision',title:d.status==='draft'?'상세페이지 수정안 승인 대기':'승인한 상세페이지 적용 확인 대기',detail:text(input.title)||text(input.summary),due:null,section:'execute',panel:'상세페이지 수정안·적용 확인'}];
 if(kind==='growth_collaboration'){const receipts=Array.isArray(d.receipts)?d.receipts as {stage?:string}[]:[];if(receipts.at(-1)?.stage==='delivered')return [{...base,id,kind:'decision',title:'협업 콘텐츠 승인 대기',detail:text(input.partnerName)||text(input.title),due:null,section:'execute',panel:'크리에이터·파트너 협업'}];}
 if(kind==='growth_mission'&&!['closed','cancelled','completed','done'].includes(String(d.status??''))){
  const due=typeof input.deadline==='string'&&input.deadline?input.deadline:null,t=due?Date.parse(due.length===10?`${due}T23:59:59+09:00`:due):NaN;
  if(Number.isFinite(t)&&t<now)return [{...base,id,kind:'overdue',title:'판매 미션 기한 지남',detail:text(input.title),due,section:'execute'}];
  if(Number.isFinite(t)&&t<now+3*DAY)return [{...base,id,kind:'upcoming',title:'판매 미션 기한 3일 이내',detail:text(input.title),due,section:'execute'}];
 }
 return [];
}
// 인박스 출처(작업물·발행·회의·연속 실행·자료 요청·브리프 질문)는 기록 종류별 순수 함수에 맡긴다. 캠페인 연결 키는 종류마다 다르다(brief_draft는 campaignId, campaign_sequence는 캠페인 행).
function inboxItems(kind:string,d:Record<string,unknown>,c:SourceCampaign,who:Names,now:number):AgendaItem[]{
 if(kind==='geo_run'){const i=geoRunItem(d,c,who,now);return i?[i]:[]}
 if(kind==='artifact'){const i=artifactItem(d,c,who);return i?[i]:[]}
 if(kind==='execution_publication'){const i=publicationItem(d,c,who);return i?[i]:[]}
 if(kind==='team_meeting')return meetingItems(d,c,who);
 if(kind==='campaign_sequence'){const i=sequenceItem(d,c,who);return i?[i]:[]}
 if(kind==='data_request'){const i=dataRequestItem(d,c,who);return i?[i]:[]}
 if(kind==='brief_draft'){const i=briefQuestionItem(d,c,who);return i?[i]:[]}
 return [];
}
const order:Record<AgendaKind,number>={overdue:0,decision:1,question:2,signal:3,upcoming:4};
// 범위 역할 거르기(G7, lib/access.ts). 범위 없는 역할(대표·관리자·직원)은 이전과 같이 모두 본다. 범위 역할은 볼 수 있는 캠페인의 항목과,
// 배정 브랜드·지점 안에서 처리할 수 있는 플레이스 초안·광고 제안만 본다. 요금 알림(사용량)·카카오 재동의(고객 발송)는 워크스페이스 전체 권한이라 범위 역할에게 없다.
function workspaceItems(kind:string,d:Record<string,unknown>,label:Names,principal:AccessPrincipal|null):AgendaItem[]{
 const scoped=!!principal&&isScoped(principal),allowed=(i:AgendaItem|null,action:'publish'|'send_customer')=>i&&(!scoped||can(principal!,action,{brandId:i.brandId??null,storeId:i.storeId??null}))?[i]:[];
 if(kind==='kakao_reconsent_notice')return allowed(reconsentItem(d,label),'send_customer');
 if(kind==='place_draft')return allowed(placeDraftItem(d,label),'publish');
 if(kind==='ads_proposal')return allowed(adsProposalItem(d,label),'publish');
 return [];
}
export async function agenda(who:Actor,now=Date.now(),principal:AccessPrincipal|null=null):Promise<Agenda>{
 const scoped=!!principal&&isScoped(principal);
 const campaigns=(await database().prepare("SELECT data FROM records WHERE owner=? AND kind='campaign' LIMIT 2000").bind(who.owner).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as Campaign&{archivedAt?:string|null}).filter(c=>!c.archivedAt&&(!scoped||can(principal!,'read_campaign',{brandId:c.brandId,storeId:c.storeId??null})));
 const byId=new Map(campaigns.map(c=>[c.id,c]));
 const [rows,wide,label]=await Promise.all([database().prepare(`SELECT kind,data FROM records WHERE owner=? AND ${kindFilter} LIMIT 20000`).bind(who.owner).all<Row>().then(r=>r.results),
  database().prepare(`SELECT kind,data FROM records WHERE owner=? AND kind IN (${workspaceKinds.map(k=>`'${k}'`).join(',')}) LIMIT 5000`).bind(who.owner).all<Row>().then(r=>r.results),names(who.owner)]);
 const items:AgendaItem[]=[];
 for(const r of rows){
  const d=parse(r.data);if(!d)continue;
  const c=byId.get(String(d.campaignId??''));if(!c)continue;
  items.push(...(growthKinds.includes(r.kind)?growthItems(r.kind,d,c,now):inboxItems(r.kind,d,{id:c.id,title:c.title,version:c.version,brandId:c.brandId,storeId:c.storeId},label,now)));
 }
 const alerts:Record<string,unknown>[]=[];
 for(const r of wide){const d=parse(r.data);if(!d)continue;if(r.kind==='billing_alert')alerts.push(d);else items.push(...workspaceItems(r.kind,d,label,principal))}
 if(!principal||can(principal,'view_usage'))items.push(...billingAlertItems(alerts,kstDay(now).slice(0,7)));
 items.sort((a,b)=>order[a.kind]-order[b.kind]||(a.due??'9').localeCompare(b.due??'9')||a.campaignTitle.localeCompare(b.campaignTitle)||a.title.localeCompare(b.title));
 const counts:AgendaCounts={overdue:0,decision:0,question:0,signal:0,upcoming:0},tabs:Record<AgendaTab,number>={decide:0,ask:0,notify:0};
 for(const i of items){counts[i.kind]++;tabs[agendaTabOf(i.kind)]++}
 return {items:items.slice(0,50),counts,tabs,total:items.length,generatedAt:new Date(now).toISOString()};
}

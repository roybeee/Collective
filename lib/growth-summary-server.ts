// 성장·판매 탭 요약(UX-PLAN P4). 접힌 패널의 건수 배지와 확인이 필요한 패널 표시만 돌려준다. 상세는 패널을 열 때 읽는다.
// 읽기 전용, 외부 호출 없음. 캠페인 범위는 data.campaignId 또는 parent_id로 판정한다.
import type {Campaign} from './agency';
import {database,type Actor} from './server';
// 패널 키 → 대표 기록 종류. 읽기 전용 패널(손익)과 계정 단위 패널(일일 루프·판매처 조회)은 건수를 내지 않는다.
export const summaryKinds:Record<string,string[]>={
 authority:['growth_authority'],demand:['growth_demand'],demandEvidence:['growth_demand_evidence'],collaboration:['growth_collaboration'],
 journey:['growth_journey'],landing:['growth_landing_revision'],experiment:['growth_experiment'],expansion:['growth_expansion'],
 optimization:['growth_optimization'],conditional:['growth_geo_observation','growth_overseas_pilot'],detection:['growth_detected_signal'],
 decisions:['growth_decision'],lessonApplications:['growth_lesson_application'],execution:['growth_commitment'],
 publicationObservation:['growth_publication_link'],sourcing:['growth_sourcing_candidate'],bundle:['growth_bundle'],reorder:['growth_reorder_review'],
 targets:['growth_target'],consumer:['growth_customer'],operations:['growth_order_line'],cs:['growth_cs_ticket'],
 returnReasons:['growth_return_reason'],causeLinks:['growth_cause_link'],
};
// 기록 종류 목록은 SQL에 그대로 적어 레코드 종류 레지스트리 검사가 읽게 한다. summaryKinds와 같은 목록인지는 단위 테스트가 확인한다.
export const summaryKindFilter="kind IN ('growth_authority','growth_demand','growth_demand_evidence','growth_collaboration','growth_journey','growth_landing_revision','growth_experiment','growth_expansion','growth_optimization','growth_geo_observation','growth_overseas_pilot','growth_detected_signal','growth_decision','growth_lesson_application','growth_commitment','growth_publication_link','growth_sourcing_candidate','growth_bundle','growth_reorder_review','growth_target','growth_customer','growth_order_line','growth_cs_ticket','growth_return_reason','growth_cause_link')";
type Row={kind:string;data:string};
export async function growthSummary(who:Actor,c:Campaign,now=Date.now()){
 const rows=(await database().prepare(`SELECT kind,data FROM records WHERE owner=? AND ${summaryKindFilter} AND (json_extract(data,'$.campaignId')=? OR parent_id=?) LIMIT 20000`).bind(who.owner,c.id,c.id).all<Row>()).results;
 const byKind=new Map<string,Record<string,unknown>[]>();
 for(const r of rows){let d:Record<string,unknown>;try{d=JSON.parse(r.data) as Record<string,unknown>}catch{continue}if(d.campaignId!==undefined&&d.campaignId!==c.id)continue;const list=byKind.get(r.kind)??[];list.push(d);byKind.set(r.kind,list);}
 const counts:Record<string,number>={};
 for(const [key,kinds] of Object.entries(summaryKinds))counts[key]=kinds.reduce((n,k)=>n+(byKind.get(k)?.length??0),0);
 const tickets=byKind.get('growth_cs_ticket')??[];
 const overdue=tickets.filter(t=>t.status==='open'&&typeof (t.input as {promisedBy?:unknown})?.promisedBy==='string'&&Date.parse((t.input as {promisedBy:string}).promisedBy)<now).length;
 const newSignals=(byKind.get('growth_detected_signal')??[]).filter(s=>s.status==='new').length;
 const proposed=(byKind.get('growth_expansion')??[]).filter(e=>e.status==='proposed').length;
 const attention:Record<string,string>={};
 if(overdue)attention.cs=`기한 초과 ${overdue}건`;
 if(newSignals)attention.detection=`새 신호 ${newSignals}건`;
 if(proposed)attention.expansion=`승인 대기 ${proposed}건`;
 return {campaignId:c.id,counts,attention};
}
export type GrowthSummary=Awaited<ReturnType<typeof growthSummary>>;

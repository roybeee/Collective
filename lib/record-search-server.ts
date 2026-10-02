// 바로 가기(/) 기록 찾기(UX-PLAN-3 1차원 '전역 검색: 캠페인·브랜드·기록'). 소유자의 성장 기록 제목에서 찾는다.
// 읽기 전용이며 외부 호출이 없다. 보관한 캠페인의 기록은 빼고, 결과마다 열 캠페인과 성장 탭 위치(단계 또는 접기 패널)를 함께 돌려준다.
import type {Campaign} from './agency';
import {database,type Actor} from './server';
export type RecordHit={id:string;kind:string;label:string;title:string;campaignId:string;campaignTitle:string;step?:'signal'|'need'|'catalog'|'offer'|'mission';panel?:string};
// 종류별 이름·제목 필드·여는 위치. 판매 기본 기록 5단계는 단계로, 나머지는 성장 탭 접기 패널 제목으로 연다.
const kinds:Record<string,{label:string;title:(d:Record<string,unknown>,input:Record<string,unknown>)=>unknown;step?:RecordHit['step'];panel?:string}>={
 growth_signal:{label:'시장 근거',title:(_,i)=>i.title,step:'signal'},
 growth_need:{label:'고객·기회',title:(_,i)=>i.title,step:'need'},
 growth_catalog:{label:'상품',title:(_,i)=>i.title||i.sku,step:'catalog'},
 growth_offer:{label:'판매 오퍼',title:(_,i)=>i.title,step:'offer'},
 growth_mission:{label:'판매 미션',title:(_,i)=>i.title,step:'mission'},
 growth_cs_ticket:{label:'고객 문의',title:(_,i)=>i.summary||i.type,panel:'고객 문의·약속 기한'},
 growth_expansion:{label:'확대 제안',title:(_,i)=>i.title||i.reason,panel:'검증된 확대·예산 예약'},
 growth_landing_revision:{label:'상세페이지 수정안',title:(_,i)=>i.title||i.summary,panel:'상세페이지 수정안·적용 확인'},
 growth_collaboration:{label:'협업',title:(_,i)=>i.partnerName||i.title,panel:'크리에이터·파트너 협업'},
 growth_bundle:{label:'번들',title:(_,i)=>i.title,panel:'여러 상품 번들'},
 growth_experiment:{label:'판매 실험',title:(_,i)=>i.title,panel:'판매 실험·사전등록·분석'},
 growth_lesson:{label:'운영 교훈',title:(_,i)=>i.title||i.lesson,panel:'일일 결정·운영 교훈'},
 growth_detected_signal:{label:'감지 신호',title:d=>(d.detection as Record<string,unknown>|undefined)?.title||d.title,panel:'자사 장부 감지 신호'},
};
// 기록 종류 검사(tests/record-kinds.test.mjs)가 읽을 수 있게 SQL 목록을 글자 그대로 둔다. kinds 키와 같아야 한다(tests/record-search-route.test.mjs).
export const searchKindFilter="kind IN ('growth_signal','growth_need','growth_catalog','growth_offer','growth_mission','growth_cs_ticket','growth_expansion','growth_landing_revision','growth_collaboration','growth_bundle','growth_experiment','growth_lesson','growth_detected_signal')";
export const searchKinds=Object.keys(kinds);
const norm=(v:string)=>v.normalize('NFC').toLowerCase().replace(/\s+/g,' ').trim();
export async function searchRecords(who:Actor,query:string,limit=20){
 const q=norm(query).slice(0,80);if(q.length<2)return {query:q,hits:[] as RecordHit[]};
 const campaigns=(await database().prepare("SELECT data FROM records WHERE owner=? AND kind='campaign' LIMIT 2000").bind(who.owner).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as Campaign&{archivedAt?:string|null}).filter(c=>!c.archivedAt);
 const byId=new Map(campaigns.map(c=>[c.id,c]));
 const rows=(await database().prepare(`SELECT kind,data FROM records WHERE owner=? AND ${searchKindFilter} ORDER BY updated_at DESC LIMIT 5000`).bind(who.owner).all<{kind:string;data:string}>()).results;
 const hits:RecordHit[]=[];
 for(const r of rows){
  let d:Record<string,unknown>;try{d=JSON.parse(r.data) as Record<string,unknown>}catch{continue}
  const c=byId.get(String(d.campaignId??''));if(!c)continue;
  const spec=kinds[r.kind],input=(d.input??{}) as Record<string,unknown>,raw=spec.title(d,input),title=typeof raw==='string'?raw.slice(0,80):'';
  if(!title||!norm(title).includes(q))continue;
  hits.push({id:`${r.kind}:${String(d.id??'')}`,kind:r.kind,label:spec.label,title,campaignId:c.id,campaignTitle:c.title,...(spec.step?{step:spec.step}:{}),...(spec.panel?{panel:spec.panel}:{})});
  if(hits.length>=limit)break;
 }
 return {query:q,hits};
}

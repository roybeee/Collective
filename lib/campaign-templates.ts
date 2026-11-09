// 첫 캠페인 템플릿 3개(에픽 G1): 신메뉴 출시 · 비수기 프로모션 · 리뷰 이벤트. 순수 모듈(모델·서버 없음).
// 브랜드 사실(이름·업종·지점 수)만으로 브리프 초안 입력(lib/brief.ts BriefInput)을 만든다. 가격·수치·효능·순위 같은 주장은 지어내지 않고
// '[확인 필요]'(lib/campaign-policy.ts claimPolicy와 같은 표지)로 자리만 남긴다. 보호 항목(baseline·target·operations·owner·learning)은 사용자가 적는 칸이라 비워 둔다.
// 저장은 기존 브리프 저장 경로(app/api/action save_campaign → validateCampaign)를 그대로 쓴다(app/api/brand-learn create_from_template).
import {emptyPlan,protectedFields,type BriefInput,type BriefKey,type CampaignPlan} from './brief';

export type TemplateId='new_menu'|'off_season'|'review_event';
export type CampaignTemplate={id:TemplateId;name:string;summary:string};
export const campaignTemplates:readonly CampaignTemplate[]=[
 {id:'new_menu',name:'신메뉴 출시',summary:'신메뉴를 처음 알리고 첫 주문을 만드는 30일 계획'},
 {id:'off_season',name:'비수기 프로모션',summary:'방문이 줄어드는 시기에 재방문 이유를 만드는 30일 계획'},
 {id:'review_event',name:'리뷰 이벤트',summary:'실제 방문 고객의 후기를 모으는 30일 계획(광고 표시·보상 조건 확인)'},
];
export const isTemplateId=(v:unknown):v is TemplateId=>campaignTemplates.some(t=>t.id===v);
// 템플릿 입력: 브랜드 이름·업종·지점 수(모르면 null). 확정 사실 수는 안내문에만 쓴다.
export type TemplateBrandContext={brandId:string;name:string;category:string;storeCount:number|null;confirmedFactCount:number};
export const CHECK='[확인 필요]';
const stores=(c:TemplateBrandContext)=>c.storeCount===null?`지점 ${CHECK}`:c.storeCount===0?'지점 미등록':`등록 지점 ${c.storeCount}곳`;
const kpiDefinitionNote='분모·단위·기준 기간을 적어야 한다. 조회수·QR 조회는 실제 이용이 아니다.';
const plan30='1주: 준비(사실 확정·소재 제작·추적 코드 준비) → 2~3주: 실행(한 변수만 비교) → 4주: 회고(결과·배운 점 기록, 확대·수정·중단 결정)';
type Fill=Partial<Record<BriefKey,string>>&{goal:string};
const fills:Record<TemplateId,(c:TemplateBrandContext)=>Fill>={
 new_menu:c=>({
  title:`${c.name} 신메뉴 출시`,
  goal:`${c.name}의 신메뉴(${CHECK} 메뉴 이름)를 처음 알리고 출시 첫 30일 동안 첫 주문을 만듭니다.`,
  audience:`${c.name}(${c.category||`업종 ${CHECK}`})의 기존 방문 고객과 매장 인근 신규 고객 (검증할 가설)`,
  channels:'Instagram, 네이버 플레이스, 매장 안내',
  stores:stores(c),
  products:`신메뉴 ${CHECK} (이름·가격·구성은 확정 사실로 등록한 뒤 씁니다)`,
  constraints:`가격·원산지·효능·순위 표현은 확정 사실이 없으면 쓰지 않고 ${CHECK}로 둡니다.`,
  behavior:'신메뉴를 처음 주문한다',
  kpi:`신메뉴 첫 주문 수 = 기간 안 신메뉴가 포함된 주문 건수(POS·장부 기준). ${kpiDefinitionNote}`,
  barrier:`${CHECK} 고객이 새 메뉴를 고르지 않는 이유(맛 예측 불가·가격·익숙한 메뉴 선호)는 가설이다.`,
  message:`'${c.name}이(가) 새로 내놓은 ${CHECK} 메뉴' 한 줄 소개와 매장에서 바로 주문하는 행동 유도`,
  journey:'게시물·플레이스 노출 → 메뉴 사진·소개 확인 → 매장 방문 또는 포장 주문 → 재주문',
  deliverables:'소개 게시물 1종, 매장 안내 1종, 플레이스 메뉴 등록(사실 확정 뒤)',
  hypothesis:'신메뉴 소개가 보이면 첫 주문이 늘어난다(인과는 비교로 확인)',
  experiment:'한 변수만 바꾼다: 소개 문구 A/B(사진은 같게). 채널·기간은 같게 둔다.',
  tracking:'신메뉴 주문 건수(POS·장부), 게시물 도달·저장, 플레이스 조회. 수집 담당과 주기는 운영 준비에서 정한다.',
  decision:`확대·수정·중단 기준은 기준값 확보 뒤 정한다(${CHECK}). 수치 없이 성공을 단정하지 않는다.`,
  schedule:plan30,
  budgetPlan:'예산 확정 뒤 소재 제작·노출에 조건부 배분',
 }),
 off_season:c=>({
  title:`${c.name} 비수기 프로모션`,
  goal:`${c.name}의 방문이 줄어드는 시기(${CHECK} 기간)에 기존 고객의 재방문 이유를 만들어 30일 동안 재방문을 늘립니다.`,
  audience:`최근 방문했지만 다시 오지 않은 ${c.name} 고객 (검증할 가설)`,
  channels:'매장 안내, 네이버 플레이스, 기존 고객 채널',
  stores:stores(c),
  products:`${CHECK} 프로모션 대상 메뉴·구성 (가격·조건은 확정 사실로 등록한 뒤 씁니다)`,
  constraints:`할인·무료·인기 같은 표현은 확정 사실이 없으면 쓰지 않습니다. 보상 조건은 ${CHECK}.`,
  behavior:'한 번 더 방문한다',
  kpi:`30일 재방문율 = 첫 구매 후 30일 이내 두 번째 유료 구매 고객 수 ÷ 첫 구매 후 30일 관찰이 끝난 코호트의 고객 수. ${kpiDefinitionNote}`,
  barrier:`${CHECK} 비수기에 발길이 줄어드는 이유(날씨·일정·대안 매장)는 가설이다.`,
  message:'다시 올 이유 한 가지(새 구성·시간대 제안)와 방문 행동 유도',
  journey:'매장 안내·채널 노출 → 재방문 이유 확인 → 재방문 → 다음 방문 약속',
  deliverables:'매장 안내 1종, 고객 채널 메시지 1종(광고 메시지면 맨 앞에 (광고) 표시)',
  hypothesis:'재방문 이유를 제시하면 비수기 재방문이 늘어난다(인과는 비교로 확인)',
  experiment:'한 변수만 바꾼다: 제안 시간대 A/B(구성은 같게).',
  tracking:'재방문 고객 수(고객 식별이 있을 때만), 기간별 방문 수, 메시지 반응. 고객 식별이 없으면 재방문율을 계산한 척하지 않는다.',
  decision:`확대·수정·중단 기준은 기준값 확보 뒤 정한다(${CHECK}).`,
  schedule:plan30,
  budgetPlan:'예산 확정 뒤 안내물·메시지 발송에 조건부 배분',
 }),
 review_event:c=>({
  title:`${c.name} 리뷰 이벤트`,
  goal:`${c.name}을(를) 실제로 방문한 고객의 후기를 30일 동안 모아 다음 고객이 참고할 근거를 만듭니다.`,
  audience:`${c.name} 매장 방문 고객 (후기는 실제 방문 고객만)`,
  channels:'네이버 플레이스, Instagram, 매장 안내',
  stores:stores(c),
  products:`${CHECK} 후기 대상 메뉴·방문 경험`,
  constraints:`후기 작성 보상이 있으면 그 사실을 후기와 같은 곳에 표시합니다(#광고 또는 보상 표시). 보상 내용은 ${CHECK}. 직원·지인 후기와 예시 후기는 만들지 않습니다.`,
  behavior:'방문 뒤 실제 경험을 후기로 남긴다',
  kpi:`기간 안 새로 남긴 실제 방문 후기 수(플레이스·Instagram 태그). ${kpiDefinitionNote}`,
  barrier:`${CHECK} 고객이 후기를 남기지 않는 이유(절차·시간·보상 부재)는 가설이다.`,
  message:'방문 경험을 그대로 남겨 달라는 요청과 보상 조건 표시',
  journey:'매장 안내 확인 → 방문·식사 → 후기 작성 → 후기 확인·답글',
  deliverables:'매장 안내 1종, 후기 요청 게시물 1종(보상 표시 포함)',
  hypothesis:'방문 직후 안내가 보이면 실제 후기가 늘어난다(인과는 비교로 확인)',
  experiment:'한 변수만 바꾼다: 요청 시점 A/B(식사 중 안내 vs 결제 때 안내).',
  tracking:'새 후기 수와 작성일, 보상 지급 건수, 안내 노출 수. 후기 작성자의 식별정보는 기록하지 않는다.',
  decision:`확대·수정·중단 기준은 기준값 확보 뒤 정한다(${CHECK}).`,
  schedule:plan30,
  budgetPlan:'예산 확정 뒤 보상·안내물에 조건부 배분',
 }),
};
const PLAN_KEYS=new Set(Object.keys(emptyPlan()));
// 템플릿 → 브리프 초안 입력. 보호 항목은 비어 있고(사용자가 적는다) 예산·시작/종료일도 비운다.
export function templateBriefInput(id:TemplateId,c:TemplateBrandContext):BriefInput{
 const fill=fills[id](c),plan:CampaignPlan={...emptyPlan()};
 const top:Record<string,string>={};
 for(const [k,v] of Object.entries(fill)){
  if(protectedFields.has(k as BriefKey)||!v)continue;
  if(PLAN_KEYS.has(k))plan[k as keyof CampaignPlan]=v;else top[k]=v;
 }
 return {brandId:c.brandId,title:top.title??'',goal:top.goal??'',audience:top.audience??'',channels:top.channels??'',stores:top.stores??'',products:top.products??'',budget:null,startDate:'',endDate:'',constraints:top.constraints??'',sources:`템플릿 '${campaignTemplates.find(t=>t.id===id)!.name}'에서 시작한 초안. 확정 사실 ${c.confirmedFactCount}건 등록 상태. ${CHECK} 표시는 대표가 확인한 뒤 채웁니다.`,plan};
}

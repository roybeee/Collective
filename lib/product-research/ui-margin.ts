// 상품 리서치 후보 상세의 손익 시뮬레이터(순수 모듈, 화면 전용). 분석 모듈(analytics/*)과 따로 둔다: 화면에서 입력을 바꿀 때마다 바로 다시 계산하는 단순 산수다.
// 원칙: 입력이 비었거나 숫자가 아니면 null(0으로 채우지 않는다). 금액은 원, 비율은 %(0~100)로 받는다.
// 계산(주문 1건 기준, 반품은 기대값으로 나눈다)
//  - 남는 비율 = 1 − 반품률
//  - 순매출 = 판매가 × 남는 비율 (반품된 주문은 환불)
//  - 채널 수수료 = 순매출 × 수수료율
//  - 상품 원가 = 원가 × 남는 비율 (반품 상품은 다시 판다고 본다)
//  - 배송비 = 배송비 × (1 + 반품률) (반품은 돌아오는 배송비가 한 번 더 든다)
//  - 공헌이익 = 순매출 − 수수료 − 상품 원가 − 배송비 − 포장비 (광고비 차감 전)
//  - 광고비 차감 후 공헌이익 = 공헌이익 − 광고비/주문
//  - 마진율 = 광고비 차감 후 공헌이익 ÷ 순매출
//  - 손익분기 ROAS = 순매출 ÷ 공헌이익 (광고비가 공헌이익과 같아지는 매출/광고비). 공헌이익이 0 이하면 어떤 ROAS로도 남지 않아 null.

export type MarginInput={price:number|null;cost:number|null;shipping:number|null;packaging:number|null;feePct:number|null;adPerOrder:number|null;returnPct:number|null};
export type MarginResult={netRevenue:number;fee:number;goods:number;shipping:number;contribution:number;afterAds:number;marginPct:number|null;breakevenRoas:number|null};

// 채널별 수수료율 기본값. 계약·등급·카테고리마다 다르므로 화면은 이 값을 칸에 채우기만 하고 운영자가 실제 요율로 고친다.
export type MarginChannel={id:string;label:string;feePct:number|null};
export const MARGIN_CHANNELS:readonly MarginChannel[]=[
 {id:'own_mall',label:'자사몰(결제 수수료)',feePct:3.5},
 {id:'smartstore',label:'네이버 스마트스토어',feePct:6},
 {id:'coupang',label:'쿠팡 마켓플레이스',feePct:10.8},
 {id:'custom',label:'직접 입력',feePct:null},
];

// 화면 입력 문자열 → 숫자. 빈 칸·숫자 아님·음수는 null. 쉼표는 지운다(1,200 → 1200).
export function marginNumber(value:string|number|null|undefined):number|null{
 if(value===null||value===undefined)return null;
 const text=String(value).replace(/,/g,'').trim();
 if(!text)return null;
 const n=Number(text);
 return Number.isFinite(n)&&n>=0?n:null;
}

// 필수: 판매가(0 초과)와 원가. 나머지 비용 칸이 비면 그 비용을 0으로 보지 않고 결과를 내지 않는다(모르는 값은 0이 아니다).
export function computeMargin(input:MarginInput):MarginResult|null{
 const {price,cost,shipping,packaging,feePct,adPerOrder,returnPct}=input;
 if(price===null||price<=0||cost===null||shipping===null||packaging===null||feePct===null||adPerOrder===null||returnPct===null)return null;
 if(feePct>100||returnPct>=100)return null;
 const kept=1-returnPct/100,netRevenue=price*kept,fee=netRevenue*feePct/100,goods=cost*kept,ship=shipping*(1+returnPct/100);
 const contribution=netRevenue-fee-goods-ship-packaging,afterAds=contribution-adPerOrder;
 return {
  netRevenue:round(netRevenue),fee:round(fee),goods:round(goods),shipping:round(ship),
  contribution:round(contribution),afterAds:round(afterAds),
  marginPct:netRevenue>0?Math.round(afterAds/netRevenue*1000)/10:null,
  breakevenRoas:contribution>0?Math.round(netRevenue/contribution*100)/100:null,
 };
}
const round=(n:number)=>Math.round(n);

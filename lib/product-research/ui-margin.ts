// 상품 리서치 후보 상세의 손익 시뮬레이터(순수 모듈, 화면용 감싸개). 계산식과 수수료표는 analytics/profit.ts 하나다(평가 1회차 M5: 손익 계산 단일화).
// 이 파일은 화면 단위만 바꾼다: 금액은 원(정수 반올림), 비율은 %(0~100). 입력이 비었거나 숫자가 아니면 null(0으로 채우지 않는다).
// 계산(주문 1건 기준, analytics/profit.ts simulateProfit 그대로)
//  - 순매출 = 판매가 × (1 − 반품률) (반품된 주문은 환불)
//  - 채널 수수료 = 순매출 × 수수료율
//  - 상품 원가 = 원가 (반품 상품은 다시 팔지 못한다고 본다: 식품 기준 보수 가정)
//  - 배송비 = 배송비 × (1 + 반품률) (반품은 회수 배송비가 한 번 더 든다)
//  - 공헌이익 = 순매출 − 수수료 − 상품 원가 − 배송비 − 포장비 (광고비 차감 전)
//  - 광고비 차감 후 공헌이익 = 공헌이익 − 광고비/주문
//  - 마진율 = 광고비 차감 후 공헌이익 ÷ 판매가
//  - 손익분기 ROAS = 판매가 ÷ 공헌이익. 공헌이익이 0 이하면 어떤 ROAS로도 남지 않아 null.
import {CHANNEL_FEES,simulateProfit,type Channel,type ProfitAssumption} from './analytics/profit';

export type MarginInput={price:number|null;cost:number|null;shipping:number|null;packaging:number|null;feePct:number|null;adPerOrder:number|null;returnPct:number|null};
// assumptions: 확인 전 가정값으로 계산한 칸(화면이 '가정값' 표시를 붙인다). 빈 배열이면 모두 운영자가 확인한 값이다.
export type MarginResult={netRevenue:number;fee:number;goods:number;shipping:number;contribution:number;afterAds:number;marginPct:number|null;breakevenRoas:number|null;assumptions:MarginField[];hasAssumptions:boolean};
export type MarginField='feePct'|'shipping'|'returnPct'|'adPerOrder'|'packaging'|'price'|'cost';

// 채널별 수수료율 기본값 = analytics/profit.ts CHANNEL_FEES(모두 확인 전 가정값). 화면은 이 값을 칸에 채우기만 하고 운영자가 실제 요율로 고친다.
export type MarginChannel={id:string;label:string;feePct:number|null;channel:Channel|null;assumption:boolean};
const pct=(c:Channel)=>Math.round(CHANNEL_FEES[c].feeRate*10000)/100;
export const MARGIN_CHANNELS:readonly MarginChannel[]=[
 {id:'own_mall',label:CHANNEL_FEES.own_mall.label,feePct:pct('own_mall'),channel:'own_mall',assumption:CHANNEL_FEES.own_mall.assumption},
 {id:'smartstore',label:CHANNEL_FEES.naver_smartstore.label,feePct:pct('naver_smartstore'),channel:'naver_smartstore',assumption:CHANNEL_FEES.naver_smartstore.assumption},
 {id:'coupang',label:CHANNEL_FEES.coupang.label,feePct:pct('coupang'),channel:'coupang',assumption:CHANNEL_FEES.coupang.assumption},
 {id:'musinsa',label:CHANNEL_FEES.musinsa.label,feePct:pct('musinsa'),channel:'musinsa',assumption:CHANNEL_FEES.musinsa.assumption},
 {id:'oliveyoung',label:CHANNEL_FEES.oliveyoung.label,feePct:pct('oliveyoung'),channel:'oliveyoung',assumption:CHANNEL_FEES.oliveyoung.assumption},
 {id:'custom',label:'직접 입력',feePct:null,channel:null,assumption:false},
];
// 화면이 칸을 미리 채울 때 쓰는 가정값(사실 아님). 이 값 그대로 계산하면 결과에 '가정값' 표시가 붙는다.
export const MARGIN_DEFAULTS={shipping:3000,returnPct:3,adPerOrder:0} as const;
export const MARGIN_FIELD_LABEL:Record<MarginField,string>={feePct:'수수료율',shipping:'배송비',returnPct:'반품률',adPerOrder:'주문당 광고비',packaging:'포장비',price:'판매가',cost:'원가'};

// 화면 입력 문자열 → 숫자. 빈 칸·숫자 아님·음수는 null. 쉼표는 지운다(1,200 → 1200).
export function marginNumber(value:string|number|null|undefined):number|null{
 if(value===null||value===undefined)return null;
 const text=String(value).replace(/,/g,'').trim();
 if(!text)return null;
 const n=Number(text);
 return Number.isFinite(n)&&n>=0?n:null;
}

// 칸 값이 아직 가정값(미리 채운 기본값·채널 가정 수수료)인지. 화면은 운영자가 고치지 않은 칸을 assumed로 넘긴다.
export function assumedFields(form:{channel:string;feePct:number|null;shipping:number|null;returnPct:number|null;adPerOrder:number|null}):MarginField[]{
 const out:MarginField[]=[],ch=MARGIN_CHANNELS.find(c=>c.id===form.channel);
 if(ch&&ch.assumption&&ch.feePct!==null&&form.feePct===ch.feePct)out.push('feePct');
 if(form.shipping===MARGIN_DEFAULTS.shipping)out.push('shipping');
 if(form.returnPct===MARGIN_DEFAULTS.returnPct)out.push('returnPct');
 if(form.adPerOrder===MARGIN_DEFAULTS.adPerOrder)out.push('adPerOrder');
 return out;
}

const FIELD_OF:Partial<Record<ProfitAssumption,MarginField>>={fee:'feePct',return_rate:'returnPct',ad_cost:'adPerOrder',shipping:'shipping',packaging:'packaging',price:'price'};
// 필수: 판매가(0 초과)와 모든 비용 칸. 칸이 비면 그 비용을 0으로 보지 않고 결과를 내지 않는다(모르는 값은 0이 아니다).
export function computeMargin(input:MarginInput,assumed:readonly MarginField[]=[]):MarginResult|null{
 const {price,cost,shipping,packaging,feePct,adPerOrder,returnPct}=input;
 if(price===null||price<=0||cost===null||shipping===null||packaging===null||feePct===null||adPerOrder===null||returnPct===null)return null;
 if(feePct>=100||returnPct>=100)return null;
 // 수수료는 화면 칸의 값을 확인값으로 넘긴다(채널 가정 여부는 assumed가 말한다).
 const r=simulateProfit({price,unitCost:cost,shipping,packaging,channel:'own_mall',feeRate:feePct/100,returnRate:returnPct/100,adCostPerOrder:adPerOrder});
 if(r.revenue===null||r.fee===null||r.contributionBeforeAds===null||r.contribution===null||!r.costs)return null;
 const fields=[...new Set([...assumed,...(r.assumptions??[]).map(a=>FIELD_OF[a]).filter((x):x is MarginField=>!!x&&x!=='feePct')])];
 return {
  netRevenue:round(r.revenue),fee:round(r.fee),goods:round(r.costs.goods),shipping:round(r.costs.shipping),
  contribution:round(r.contributionBeforeAds),afterAds:round(r.contribution),
  marginPct:r.marginPct===null?null:Math.round(r.marginPct*1000)/10,
  breakevenRoas:r.breakevenRoas,assumptions:fields,hasAssumptions:fields.length>0,
 };
}
const round=(n:number)=>Math.round(n);

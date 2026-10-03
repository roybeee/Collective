// 손익 시뮬레이터(순수). 계획 ⑥: 판매가 − (원가·배송·포장·채널 수수료·반품·광고) = 주문 1건(1개)당 공헌이익.
// 모르는 입력은 0으로 채우지 않는다. 필수 값(판매가·원가·배송·포장)이 하나라도 null이면 공헌이익도 null이다.
// 부가세는 따로 떼지 않는다(판매가·원가 모두 부가세 포함 금액으로 넣는다는 가정). 정산 주기·카드 할부 비용도 넣지 않았다.
import type {CandidateInput} from '@/lib/growth-sourcing';

export type Channel='naver_smartstore'|'coupang'|'own_mall'|'musinsa'|'oliveyoung';
// 채널 수수료표. **모두 확인 전 가정값이다(사실 아님).** 계약·카테고리·결제 수단·프로모션에 따라 달라진다.
// 고칠 때: 판매자 센터 수수료 안내 화면이나 계약서로 확인하고 verifiedAt·근거를 함께 적는다. 확인 전에는 assumption:true를 유지한다.
export const CHANNEL_FEES:Record<Channel,{label:string;feeRate:number;assumption:boolean;verifiedAt:string|null;basis:string}>={
 naver_smartstore:{label:'네이버 스마트스토어',feeRate:0.0563,assumption:true,verifiedAt:null,basis:'가정: 네이버페이 주문관리 수수료(결제 수단별 약 2~3.7%) + 네이버쇼핑 매출연동 2%. 쇼핑 유입이 아니면 연동 수수료가 빠진다'},
 coupang:{label:'쿠팡(마켓플레이스)',feeRate:0.108,assumption:true,verifiedAt:null,basis:'가정: 식품 카테고리 판매 수수료 약 10~11%. 로켓그로스 물류비는 별도라 shipping에 넣는다'},
 own_mall:{label:'자사몰',feeRate:0.033,assumption:true,verifiedAt:null,basis:'가정: PG 카드 결제 수수료 약 3.3%. 호스팅·월 이용료는 고정비라 넣지 않는다'},
 musinsa:{label:'무신사',feeRate:0.28,assumption:true,verifiedAt:null,basis:'가정: 입점 판매 수수료 약 25~30%. 입점 계약 조건으로 확인 필요'},
 oliveyoung:{label:'올리브영',feeRate:0.33,assumption:true,verifiedAt:null,basis:'가정: 입점(특약매입·위탁) 수수료 약 30~35%. 거래 형태별로 크게 달라 확인 필요'},
};
export type ProfitInput={price:number|null;unitCost:number|null;shipping:number|null;packaging:number|null;channel:Channel;
 // 주문 1건당 광고비. 생략(undefined)은 '광고 없음(0)' 가정, null은 미확인(공헌이익 null).
 adCostPerOrder?:number|null;
 // 반품률 0~1. 생략은 0 가정, null은 미확인.
 returnRate?:number|null;
 // 수수료율을 확인했으면 덮어쓴다(가정표보다 우선).
 feeRate?:number|null};
// assumptions(추가 필드): 확인 전 가정값으로 계산한 입력(화면이 '가정값' 표시를 붙인다). costs(추가 필드): 주문 1건 비용 줄(상품 원가·배송(반품 회수 포함)·포장).
export type ProfitAssumption='fee'|'return_rate'|'ad_cost'|'shipping'|'packaging'|'price'|'channel';
export type ProfitResult={channel:Channel;feeRate:number;feeAssumption:boolean;revenue:number|null;fee:number|null;contributionBeforeAds:number|null;contribution:number|null;marginPct:number|null;breakevenRoas:number|null;missing:string[];notes:string[];
 assumptions?:ProfitAssumption[];costs?:{goods:number;shipping:number;packaging:number}|null};
// 소싱 견적만 있고 판매 쪽 값이 없을 때 쓰는 기본 가정값(사실 아님, 운영자가 고칠 값). 이 값을 쓴 계산은 assumptions에 남는다.
export const PROFIT_DEFAULTS={channel:'naver_smartstore' as Channel,shippingPerOrder:3000,packaging:300,returnRate:0.03,adCostPerOrder:0,editable:true};
const r2=(v:number)=>Math.round(v*100)/100;

export function simulateProfit(input:ProfitInput,assumed:readonly ProfitAssumption[]=[]):ProfitResult{
 const spec=CHANNEL_FEES[input.channel],missing:string[]=[],notes:string[]=[],assumptions=new Set<ProfitAssumption>(assumed);
 const feeOverride=typeof input.feeRate==='number'&&input.feeRate>=0&&input.feeRate<1;
 const feeRate=feeOverride?input.feeRate as number:spec.feeRate,feeAssumption=!feeOverride&&spec.assumption;
 if(feeAssumption){notes.push(`${spec.label} 수수료 ${(feeRate*100).toFixed(2)}%는 확인 전 가정값입니다.`);assumptions.add('fee')}
 const req:[keyof ProfitInput,string][]=[['price','판매가'],['unitCost','단위 원가'],['shipping','배송비'],['packaging','포장비']];
 for(const [k,label] of req){const v=input[k];if(typeof v!=='number'||!Number.isFinite(v)||v<0)missing.push(label)}
 let r:number|null=0;
 if(input.returnRate===undefined){notes.push('반품률을 넣지 않아 0으로 가정했습니다.');assumptions.add('return_rate')}
 else if(input.returnRate===null||!(input.returnRate>=0&&input.returnRate<1)){r=null;missing.push('반품률')}
 else r=input.returnRate;
 let ad:number|null=0;
 if(input.adCostPerOrder===undefined){notes.push('광고비를 넣지 않아 광고 없는 판매로 계산했습니다.');assumptions.add('ad_cost')}
 else if(input.adCostPerOrder===null||!(input.adCostPerOrder>=0)){ad=null;missing.push('주문당 광고비')}
 else ad=input.adCostPerOrder;
 const base={channel:input.channel,feeRate,feeAssumption,missing,notes,assumptions:[...assumptions].sort()};
 if(missing.some(m=>m!=='주문당 광고비')||r===null)return {...base,revenue:null,fee:null,contributionBeforeAds:null,contribution:null,marginPct:null,breakevenRoas:null,costs:null};
 const price=input.price as number,revenue=price*(1-r),fee=revenue*feeRate;
 // 반품 1건은 회수 배송비(편도 배송비와 같다고 가정)를 더 쓰고 상품은 재판매하지 못한다고 본다(식품 기준 보수 가정).
 const cba=revenue-fee-(input.unitCost as number)-(input.shipping as number)-(input.packaging as number)-r*(input.shipping as number);
 const contribution=ad===null?null:cba-ad;
 const breakevenRoas=cba>0?r2(price/cba):null;
 if(cba<=0)notes.push('광고 전 공헌이익이 0 이하라 어떤 광고 효율(ROAS)로도 남지 않습니다.');
 return {...base,revenue:r2(revenue),fee:r2(fee),contributionBeforeAds:r2(cba),contribution:contribution===null?null:r2(contribution),marginPct:contribution===null||price<=0?null:Math.round(contribution/price*10000)/10000,breakevenRoas,
  costs:{goods:r2(input.unitCost as number),shipping:r2((input.shipping as number)*(1+r)),packaging:r2(input.packaging as number)}};
}

// 성장2 소싱 후보(견적) → 시뮬레이터 입력. 고정 배송비·추가비(통관·검사 등)는 주문 수량(없으면 MOQ)에 나눠 단위 원가에 얹는다.
// 견적 세금 기준이 '별도'면 부가세 10%를 더하고, '미확인'이면 그대로 두되 notes에 남긴다. 판매 배송비·포장비는 견적에 없으므로 따로 받는다.
export function profitInputFromCandidate(c:Pick<CandidateInput,'unitCost'|'moq'|'shippingCost'|'extraCost'|'taxBasis'|'unit'>,opts:{price:number|null;channel:Channel;shippingPerOrder:number|null;packaging:number|null;orderQuantity?:number|null;adCostPerOrder?:number|null;returnRate?:number|null}):{input:ProfitInput;notes:string[]}{
 const notes:string[]=[];let unitCost:number|null=null;
 const qty=opts.orderQuantity!=null?Math.max(opts.orderQuantity,c.moq??1):c.moq;
 const fixed=c.shippingCost===null||c.extraCost===null?null:c.shippingCost+c.extraCost;
 if(c.unitCost===null)notes.push('단위 원가 미확인');
 else if(fixed===null)notes.push('견적 고정 배송비·추가비 미확인');
 else if(qty===null||qty<=0){if(fixed===0)unitCost=c.unitCost;else notes.push('MOQ·주문 수량 미확인이라 고정비를 나눌 수 없음')}
 else unitCost=c.unitCost+fixed/qty;
 if(unitCost!==null&&c.taxBasis==='excluded'){unitCost*=1.1;notes.push('견적이 부가세 별도라 10%를 더했습니다.')}
 if(c.taxBasis==='unknown')notes.push('견적 세금 기준 미확인');
 if(c.unit==='pack')notes.push('견적 단위가 묶음(pack)입니다. 판매 단위와 같은지 확인하세요.');
 if(c.unit==='unknown')notes.push('견적 수량 단위 미확인');
 return {input:{price:opts.price,unitCost:unitCost===null?null:r2(unitCost),shipping:opts.shippingPerOrder,packaging:opts.packaging,channel:opts.channel,adCostPerOrder:opts.adCostPerOrder,returnRate:opts.returnRate},notes};
}

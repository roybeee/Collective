// 비용·사용량 미터(벤치마크 P11) 순수 모듈. 이번 달(한국 시간) 토큰 누계와 월 상한(lib/token-budget.ts tokenBudgetSummary)에서 미터 상태를 정한다.
// 누계 = 보고 토큰(used) + 진행 중 예약(inProgress). 80% 이상은 주의, 100% 이상은 상한 도달이다. 상한이 없으면 '상한 미설정'이고 비율을 꾸미지 않는다.
// 크레딧·원화 환산은 lib/billing.ts의 자리 표시 가격(1크레딧 = 1,000토큰, 충전 상품 단가)을 쓴다. 가격은 대표 확정 전이라 화면이 '추정'을 함께 적는다.
import {CREDIT_PACKS,TOKENS_PER_CREDIT,creditsForTokens,priceWithVat} from './billing';

export const METER_WARN_RATIO=0.8;
export const METER_OVER_RATIO=1;
export type MeterState='ok'|'warn'|'over'|'unset'|'unknown';
export type MeterLine={limit:number|null;used:number;inProgress:number};
export type MeterView={state:MeterState;total:number;limit:number|null;percent:number|null};
export function meterOf(line:MeterLine|null|undefined):MeterView{
 if(!line||!Number.isFinite(line.used)||!Number.isFinite(line.inProgress))return {state:'unknown',total:0,limit:null,percent:null};
 const total=Math.max(0,line.used)+Math.max(0,line.inProgress);
 if(line.limit===null||!(line.limit>0))return {state:'unset',total,limit:null,percent:null};
 const ratio=total/line.limit,percent=Math.floor(ratio*100);
 return {state:ratio>=METER_OVER_RATIO?'over':ratio>=METER_WARN_RATIO?'warn':'ok',total,limit:line.limit,percent};
}
// 막대 너비(0~100). 상한을 넘어도 100에서 멈춘다.
export const meterWidth=(v:MeterView)=>v.percent===null?0:Math.min(100,Math.max(0,v.percent));
// 크레딧당 원화(부가세 포함) 추정: 가장 작은 충전 상품의 단가. 상품이 없으면 null.
export function krwPerCredit():number|null{
 const pack=[...CREDIT_PACKS].sort((a,b)=>a.credits-b.credits)[0];
 return pack&&pack.credits>0?priceWithVat(pack.supplyKrw).totalKrw/pack.credits:null;
}
// 토큰 추정 → 크레딧·원화 추정. 원화는 10원 단위로 올린다(추정임을 드러내고 1원 단위 정밀도를 꾸미지 않는다).
export function tokenCost(tokens:number):{credits:number;krw:number|null}{
 const credits=creditsForTokens(Math.max(0,Math.round(tokens))),per=krwPerCredit();
 return {credits,krw:per===null?null:Math.ceil(credits*per/10)*10};
}
export {TOKENS_PER_CREDIT};

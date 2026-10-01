import {Note} from '@/components/app/note';
import styles from './growth-panel.module.css';

export type GrowthBusinessView={status:string;period:{from:string;to:string};records:number|null;orders:number|null;netRevenue:number|null;contributionBeforeMarketing:number|null;contribution:null;cash:null;reason:string};
const money=(n:number|null)=>n===null?'미확인':`${n.toLocaleString('ko-KR')}원`;
export function GrowthBusinessOverview({business}:{business:GrowthBusinessView}){
 return <section className={styles.business} aria-label="성장 사업 지표"><h3>주문 장부에서 확인한 결과</h3><p>{business.period.from} ~ {business.period.to} · 캠페인 연결 주문</p><dl className={styles.businessGrid}>{[
  ['장부 순매출',money(business.netRevenue)],['광고·제작비 차감 전 공헌이익',money(business.contributionBeforeMarketing)],['총 공헌이익',money(business.contribution)],['수령 현금',money(business.cash)],
 ].map(([title,value])=><div key={title}><dt>{title}</dt><dd>{value}</dd></div>)}</dl><p className={styles.note}>{business.reason}</p><Note className={styles.note}>장부 대사와 증분 효과는 아직 확인하지 않았습니다. 기록된 주문이 0건인 경우에도 전체 판매가 0건이었다고 단정하지 않습니다.</Note></section>;
}

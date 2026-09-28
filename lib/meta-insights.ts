import {parseCsv} from './order-import';

export const metaInsightColumns=['date','account_id','campaign_id','ad_id','spend','impressions','clicks','purchases','purchase_value'] as const;
export const metaInsightTemplate=metaInsightColumns.join(',')+'\n';
export const metaAttributions=['7d_click_1d_view','1d_click','7d_click'] as const;
export type MetaAttribution=typeof metaAttributions[number];
export type MetaInsightRow={date:string;accountId:string;externalCampaignId:string;adId:string;spendMinor:number;impressions:number;clicks:number;purchases:number|null;purchaseValueMinor:number|null};
export type MetaInsightInput={since:string;until:string;accountId:string;externalCampaignId:string;attribution:MetaAttribution;currency:'KRW';timeZone:'Asia/Seoul';rows:MetaInsightRow[]};
export type MetaInsightReport=MetaInsightInput & {id:string;campaignId:string;brandId:string;campaignVersion:number;version:number;source:'manual'|'meta_api';collectedAt:string;updatedBy:string;digest:string};
export class MetaInsightError extends Error {}
export function metaId(v:unknown,label:string){if(typeof v!=='string'||!/^\d{1,30}$/.test(v))throw new MetaInsightError(`${label}은 숫자 ID로 입력하세요.`);return v}
export function metaDate(v:unknown){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw new MetaInsightError('날짜는 실제 날짜 YYYY-MM-DD로 입력하세요.');return v}
export function metaWindow(input:Record<string,unknown>){const since=metaDate(input.since),until=metaDate(input.until);if(until<since||Date.parse(until)-Date.parse(since)>30*86400000)throw new MetaInsightError('조회 기간은 시작일을 포함해 최대 31일입니다.');return {since,until}}
export function metaNumber(v:unknown,label:string,money=false,optional=false):number|null{
 if(optional&&(v===''||v===undefined||v===null))return null;
 if(typeof v!=='string'||!(money?/^\d{1,10}(\.\d{1,2})?$/:/^\d{1,12}$/).test(v))throw new MetaInsightError(`${label}: 0 이상의 ${money?'금액(소수 둘째 자리까지)':'정수'}을 입력하세요.`);
 const n=money?Number(v.split('.')[0])*100+Number((v.split('.')[1]??'').padEnd(2,'0')):Number(v);
 if(!Number.isSafeInteger(n)||n>1e12)throw new MetaInsightError(`${label}: 허용 범위를 초과했습니다.`);return n;
}
export function parseMetaInsightImport(input:Record<string,unknown>):MetaInsightInput{
 const window=metaWindow(input),accountId=metaId(input.accountId,'광고 계정'),externalCampaignId=metaId(input.externalCampaignId,'Meta 캠페인');
 if(!metaAttributions.includes(input.attribution as MetaAttribution))throw new MetaInsightError('전환 인정 기간을 선택하세요.');
 if(input.currency!=='KRW'||input.timeZone!=='Asia/Seoul')throw new MetaInsightError('현재 원화·서울 시간 광고 계정만 지원합니다.');
 if(typeof input.csv!=='string')throw new MetaInsightError('CSV 파일을 선택하세요.');
 const csv=parseCsv(input.csv);
 if(csv.headers.length!==metaInsightColumns.length||metaInsightColumns.some((x,i)=>csv.headers[i]!==x))throw new MetaInsightError('제공된 양식의 열 순서를 유지하세요. 고객 정보나 추가 열은 가져올 수 없습니다.');
 if(!csv.rows.length)throw new MetaInsightError('가져올 성과 행이 없습니다.');
 const keys=new Set<string>();
 const rows=csv.rows.map((cells,i)=>{
  const [day,account,campaign,ad,spend,impressions,clicks,purchases,value]=cells,date=metaDate(day);
  if(date<window.since||date>window.until||account!==accountId||campaign!==externalCampaignId)throw new MetaInsightError(`${i+2}행: 날짜·광고 계정·캠페인이 선택한 범위와 다릅니다.`);
  const adId=metaId(ad,'광고'),key=date+':'+adId;if(keys.has(key))throw new MetaInsightError(`${i+2}행: 같은 날짜의 광고가 중복되었습니다. 연령·노출 위치별 분류를 해제하세요.`);keys.add(key);
  return {date,accountId,externalCampaignId,adId,spendMinor:metaNumber(spend,'광고비',true)!,impressions:metaNumber(impressions,'노출')!,clicks:metaNumber(clicks,'클릭')!,purchases:metaNumber(purchases,'구매',false,true),purchaseValueMinor:metaNumber(value,'구매 금액',true,true)};
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.adId.localeCompare(b.adId));
 return {...window,accountId,externalCampaignId,attribution:input.attribution as MetaAttribution,currency:'KRW',timeZone:'Asia/Seoul',rows};
}
// Missing conversions stay unknown. Meta's attributed value is never an order-ledger total.
export function summarizeMetaInsights(rows:MetaInsightRow[]){
 const sum=(key:keyof Pick<MetaInsightRow,'spendMinor'|'impressions'|'clicks'|'purchases'|'purchaseValueMinor'>)=>rows.some(r=>r[key]===null)?null:rows.reduce((n,r)=>n+(r[key]??0),0);
 const spendMinor=sum('spendMinor')!,purchaseValueMinor=sum('purchaseValueMinor');
 return {spendMinor,impressions:sum('impressions')!,clicks:sum('clicks')!,purchases:rows.length?sum('purchases'):null,purchaseValueMinor:rows.length?purchaseValueMinor:null,reportedRoas:spendMinor>0&&purchaseValueMinor!==null?purchaseValueMinor/spendMinor:null,actualRevenue:null,incrementalRevenue:null};
}

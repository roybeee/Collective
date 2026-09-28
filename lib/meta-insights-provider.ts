import {readBoundedJson} from './http-limits';
import {metaId,metaInsightColumns,metaWindow,parseMetaInsightImport,type MetaAttribution} from './meta-insights';
export const META_READ_API_VERSION='v26.0';
export class MetaReadError extends Error {constructor(public code:'auth'|'permission'|'rate_limit'|'unavailable'|'format',message:string){super(message)}}
type ObjectValue=Record<string,unknown>;
const object=(v:unknown):ObjectValue=>v&&typeof v==='object'&&!Array.isArray(v)?v as ObjectValue:{};
// Only fixed-host GETs. Never follow provider next URLs or return its error text.
function client(token:string){const signal=AbortSignal.timeout(35000);return async(path:string,params:Record<string,string>)=>{
 const url=new URL(`https://graph.facebook.com/${META_READ_API_VERSION}/${path}`);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
 let response:Response;try{response=await fetch(url.toString(),{method:'GET',headers:{Authorization:`Bearer ${token}`},redirect:'manual',signal})}catch{throw new MetaReadError('unavailable','Meta 응답을 받지 못했습니다. 잠시 후 다시 수집하세요. 기존 성과는 유지됩니다.')}
 let payload:ObjectValue;try{payload=object(await readBoundedJson(response,300000))}catch{throw new MetaReadError('format','Meta 응답이 너무 크거나 형식이 다릅니다. 기간을 줄여 다시 수집하세요.')}
 const code=object(payload.error).code;
 if(response.status===401||code===190)throw new MetaReadError('auth','연결 토큰이 만료되었거나 유효하지 않습니다. 읽기 권한 토큰으로 다시 연결하세요.');
 if(response.status===429||[4,17,32,613,80004].includes(Number(code)))throw new MetaReadError('rate_limit','Meta 조회 한도에 도달했습니다. 잠시 후 다시 수집하세요.');
 if(response.status===403||[10,200].includes(Number(code)))throw new MetaReadError('permission','이 광고 계정의 ads_read 권한을 확인한 뒤 다시 연결하세요.');
 if(!response.ok||payload.error)throw new MetaReadError('unavailable','Meta 조회에 실패했습니다. 계정과 권한을 확인하세요.');
 return payload;
}}
async function account(read:ReturnType<typeof client>,id:string){const a=await read('act_'+metaId(id,'광고 계정'),{fields:'account_id,currency,timezone_name,account_status'});if(a.account_id!==id||a.currency!=='KRW'||a.timezone_name!=='Asia/Seoul')throw new MetaReadError('format','계정 ID를 확인하세요. 현재 원화·서울 시간 광고 계정만 지원합니다.');return {accountId:id,currency:'KRW' as const,timeZone:'Asia/Seoul' as const,accountStatus:typeof a.account_status==='number'?a.account_status:null}}
export async function verifyMetaRead(token:string,accountId:string){const read=client(token),a=await account(read,accountId);const probe=await read('act_'+accountId+'/insights',{fields:'account_id',date_preset:'yesterday',limit:'1'});if(!Array.isArray(probe.data))throw new MetaReadError('format','광고 성과 읽기 권한을 확인하지 못했습니다.');return a}
export async function collectMetaRead(token:string,input:{accountId:string;externalCampaignId:string;since:string;until:string;attribution:MetaAttribution}){
 const window=metaWindow(input),read=client(token),a=await account(read,input.accountId),campaignId=metaId(input.externalCampaignId,'Meta 캠페인');
 const campaign=await read(campaignId,{fields:'id,account_id'});if(campaign.id!==campaignId||campaign.account_id!==a.accountId)throw new MetaReadError('permission','연결한 광고 계정의 캠페인이 아닙니다.');
 const attribution=input.attribution==='7d_click_1d_view'?['7d_click','1d_view']:[input.attribution];
 const params:Record<string,string>={fields:'account_id,campaign_id,ad_id,date_start,date_stop,spend,impressions,clicks,actions,action_values',time_range:JSON.stringify(window),level:'ad',time_increment:'1',action_report_time:'impression',action_attribution_windows:JSON.stringify(attribution),limit:'100'};
 const rows:string[][]=[],seen=new Set<string>();let after='';
 for(let page=0;page<6;page++){
  const payload=await read(campaignId+'/insights',{...params,...(after?{after}:{})});
  if(!Array.isArray(payload.data))throw new MetaReadError('format','성과 응답 형식을 확인하지 못했습니다.');
  for(const item of payload.data){const r=object(item);if(r.date_start!==r.date_stop)throw new MetaReadError('format','일별 성과만 가져올 수 있습니다.');
   const action=(v:unknown)=>{if(v===undefined)return '';if(!Array.isArray(v))throw new MetaReadError('format','전환 응답 형식이 다릅니다.');const hits=v.map(object).filter(x=>x.action_type==='omni_purchase');if(hits.length>1)throw new MetaReadError('format','중복 전환 응답입니다.');return hits.length?hits[0].value:''};
   const values=[r.date_start,r.account_id,r.campaign_id,r.ad_id,r.spend,r.impressions,r.clicks,action(r.actions),action(r.action_values)];
   if(values.some(v=>typeof v!=='string'||/[\n\r,]/.test(v)))throw new MetaReadError('format','성과 응답에 예상하지 못한 값이 있습니다.');rows.push(values as string[]);
  }
  if(rows.length>500)throw new MetaReadError('format','성과가 500행을 초과합니다. 조회 기간을 줄여 주세요.');
  const paging=object(payload.paging);if(!paging.next){if(!rows.length)return {...window,...a,externalCampaignId:campaignId,attribution:input.attribution,rows:[]};return parseMetaInsightImport({...input,...a,csv:metaInsightColumns.join(',')+'\n'+rows.map(r=>r.join(',')).join('\n')})}
  const cursor=object(paging.cursors).after;if(typeof cursor!=='string'||!cursor||cursor.length>2000||seen.has(cursor))throw new MetaReadError('format','다음 성과 페이지를 확인하지 못했습니다. 다시 수집하세요.');seen.add(cursor);after=cursor;
 }
 throw new MetaReadError('format','성과 페이지가 너무 많습니다. 조회 기간을 줄여 주세요.');
}

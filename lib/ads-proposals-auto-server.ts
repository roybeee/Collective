// C4·C8 후속: 광고 제안 주간 자동 생성(워커 큐 'ads_proposal_auto'). 스위치 scheduled_runs와 채널 스위치(naver_ads_write·daangn_ads)가 함께 켜진 채널만 돈다.
// 연결된 광고 계정(channel_credential의 지점·브랜드·워크스페이스 단위)마다 KST 주 1회, 캠페인 최대 5개에 결정론 규칙(lib/ads-proposals.ts·ads-proposals-daangn.ts)을 돌려 초안 제안만 만든다.
// 외부 호출은 읽기(GET)뿐이다. 승인·반영은 하지 않는다. 만든 초안은 기존 출처(lib/agenda-workspace-sources.ts adsProposalItem)로 오늘의 안건 '결정' 탭에 승인 대기로 보인다.
// 실행 기록 kind ads_proposal_auto_run(id=채널:브랜드:지점:주)이 멱등 키다. 같은 주 두 번째 tick은 읽기만 하고 끝난다.
import {ApiError,listRecords,readRecord,recordStatement,stamp,type Actor} from './server';
import {isEnabled} from './feature-flags';
import {loadCredential,loadExternalCredential} from './channel-credentials';
import {call} from './connectors/naver-ads';
import {daangnReader,listCampaigns,type DaangnAdsCredential,type DaangnDeps} from './connectors/daangn-ads';
import {generateProposals} from './ads-proposals-server';
import type {NaverAdsCredential} from './connectors/types';
import type {ProposalChannel} from './ads-proposals';

export const AUTO_CAMPAIGNS_PER_ACCOUNT=5,AUTO_ACCOUNTS_PER_TICK=3;
const BY='ads_proposal_auto';
type Unit={brandId:string|null;storeId:string|null};
export type AdsProposalAutoRun={id:string;channel:ProposalChannel;brandId:string|null;storeId:string|null;week:string;campaigns:string[];created:number;skipped:number;errors:string[];createdAt:string};

// KST 기준 이번 주 월요일 날짜(주 키).
export function kstWeek(now:number){
 const local=new Date(now+9*3600000),day=local.getUTCDay(),monday=new Date(local.getTime()-((day+6)%7)*86400000);
 return monday.toISOString().slice(0,10);
}
const flagOf:Record<ProposalChannel,'naver_ads_write'|'daangn_ads'>={naver_ads:'naver_ads_write',daangn_ads:'daangn_ads'};
const on=(owner:string,flag:string)=>isEnabled(owner,flag as Parameters<typeof isEnabled>[1]).catch(()=>false);
export async function autoChannels(owner:string):Promise<ProposalChannel[]>{
 if(!await on(owner,'scheduled_runs'))return [];
 const out:ProposalChannel[]=[];
 for(const c of ['naver_ads','daangn_ads'] as const)if(await on(owner,flagOf[c]))out.push(c);
 return out;
}
// 워커 순환에 넣을 큐. 켜진 채널이 없으면 undefined(순환에 큐 이름이 나타나지 않는다).
export async function adsProposalAutoQueue(owner:string):Promise<((owner:string)=>Promise<{status:string}>)|undefined>{
 if(!(await autoChannels(owner)).length)return undefined;
 return async current=>current===owner?runAdsProposalAuto(owner):{status:'idle'};
}
async function accounts(owner:string,channel:ProposalChannel):Promise<Unit[]>{
 const rows=await listRecords<{channel?:string;brandId?:string;storeId?:string}>(owner,'channel_credential');
 return rows.filter(r=>r.channel===channel).map(r=>({brandId:r.brandId??null,storeId:r.storeId??null}));
}
const runId=(channel:ProposalChannel,u:Unit,week:string)=>`${channel}:${u.brandId??'-'}:${u.storeId??'-'}:${week}`;
async function existing(owner:string,id:string){try{return await readRecord<AdsProposalAutoRun>(owner,'ads_proposal_auto_run',id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
// 캠페인 목록(읽기만). 네이버는 /ncc/campaigns, 당근은 캠페인 목록 GET.
async function campaignIds(owner:string,channel:ProposalChannel,u:Unit,deps?:DaangnDeps):Promise<string[]>{
 if(channel==='naver_ads'){
  const {credential}=await loadCredential(owner,'naver_ads',u);
  const raw=await call(credential as NaverAdsCredential,'/ncc/campaigns');
  return (Array.isArray(raw)?raw:[]).flatMap(c=>typeof (c as {nccCampaignId?:unknown}).nccCampaignId==='string'?[String((c as {nccCampaignId:string}).nccCampaignId)]:[]).slice(0,AUTO_CAMPAIGNS_PER_ACCOUNT);
 }
 const hit=await loadExternalCredential<DaangnAdsCredential>(owner,'daangn_ads',u);
 if(!hit)return [];
 return (await listCampaigns(daangnReader(hit.credential,deps),hit.credential)).map(c=>c.id).slice(0,AUTO_CAMPAIGNS_PER_ACCOUNT);
}
// 한 tick에 계정 최대 3개. 계정마다 실행 기록 1행을 남긴다(오류도 기록, 다음 주에 다시 돈다).
export async function runAdsProposalAuto(owner:string,now=Date.now(),deps?:DaangnDeps):Promise<{status:string;runs:AdsProposalAutoRun[]}>{
 const channels=await autoChannels(owner),week=kstWeek(now),runs:AdsProposalAutoRun[]=[];
 const system:Actor={owner,id:BY,email:null,role:'owner'};
 for(const channel of channels){
  for(const u of await accounts(owner,channel)){
   if(runs.length>=AUTO_ACCOUNTS_PER_TICK)break;
   const id=runId(channel,u,week);
   if(await existing(owner,id))continue;
   const run:AdsProposalAutoRun={id,channel,brandId:u.brandId,storeId:u.storeId,week,campaigns:[],created:0,skipped:0,errors:[],createdAt:stamp()};
   let next=run;
   try{
    const ids=await campaignIds(owner,channel,u,deps);
    for(const campaignId of ids){
     try{
      const r=await generateProposals(system,{campaignId,brandId:u.brandId,storeId:u.storeId,...(channel==='daangn_ads'?{channel}:{})},now,deps);
      next={...next,campaigns:[...next.campaigns,campaignId],created:next.created+r.created.length,skipped:next.skipped+r.skipped};
     }catch(e){next={...next,errors:[...next.errors,`${campaignId}: ${e instanceof Error?e.message.slice(0,200):'오류'}`]}}
    }
   }catch(e){next={...next,errors:[...next.errors,e instanceof Error?e.message.slice(0,200):'캠페인 목록을 읽지 못했습니다.']}}
   await recordStatement(owner,'ads_proposal_auto_run',id,next).run();
   runs.push(next);
  }
 }
 return {status:runs.length?'processed':'idle',runs};
}

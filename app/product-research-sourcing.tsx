'use client';
// 후보 상세의 소싱 연결과 손익 시뮬레이터(평가 1회차 ⑥).
// 소싱 연결: 캠페인 고르기 → 그 캠페인의 소싱 후보(GET /api/growth/sourcing?campaignId=…) → link_sourcing / unlink_sourcing. 연결하면 재계산이 견적 원가·MOQ·납기로 수익성·실행 가능성을 계산한다.
// 손익 시뮬레이터: 미리 채운 기본값과 채널 수수료는 '가정값', 연결한 견적에서 온 원가는 '소싱 견적'으로 표시한다(lib/product-research/ui-margin.ts). 저장하지 않는다.
import {useCallback,useEffect,useState} from 'react';
import {Link2,Unlink} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {askConfirm} from '@/components/app/confirm-dialog';
import {MetaLine} from '@/components/app/meta-line';
import {StatList} from '@/components/app/stat-list';
import {count,date,money} from '@/lib/format';
import type {CandidateInput} from '@/lib/growth-sourcing';
import {profitInputFromCandidate} from '@/lib/product-research/analytics/profit';
import {MARGIN_CHANNELS,MARGIN_DEFAULTS,MARGIN_FIELD_LABEL,assumedFields,computeMargin,marginNumber,type MarginField} from '@/lib/product-research/ui-margin';
import {editReason,type Act,type Product,type View} from './product-research-shared';
import s from './product-research.module.css';

type Candidate={id:string;version:number;input:CandidateInput};
type Catalog={id:string;input?:{title?:string;sku?:string}};
type Loaded={state:'loading'}|{state:'ok';candidates:Candidate[];catalogs:Catalog[]}|{state:'error';error:string};
async function readSourcing(campaignId:string):Promise<Loaded>{
 try{
  const r=await fetch(`/api/growth/sourcing?campaignId=${encodeURIComponent(campaignId)}`,{credentials:'same-origin'});
  const d=await r.json().catch(()=>({})) as {candidates?:unknown;catalogs?:unknown;error?:unknown};
  if(!r.ok||!Array.isArray(d.candidates))return {state:'error',error:typeof d.error==='string'?d.error:'소싱 후보를 불러오지 못했습니다.'};
  return {state:'ok',candidates:d.candidates as Candidate[],catalogs:Array.isArray(d.catalogs)?d.catalogs as Catalog[]:[]};
 }catch(e){return {state:'error',error:(e as Error).message||'소싱 후보를 불러오지 못했습니다.'}}
}
const candidateName=(c:Candidate,catalogs:readonly Catalog[])=>{const cat=catalogs.find(x=>x.id===c.input.catalogId)?.input;return `${c.input.supplierCode}${cat?.title?` (${cat.title})`:''}`};

// 소싱 연결과 손익 시뮬레이터를 함께 둔다(연결한 견적 원가를 시뮬레이터가 '소싱 견적'으로 받는다).
export function SourcingAndMargin({view,product,act,busy}:{view:View;product:Product;act:Act;busy:boolean}){
 const [cache,setCache]=useState<Record<string,Loaded>>({});
 const load=useCallback((campaignId:string)=>{setCache(c=>({...c,[campaignId]:{state:'loading'}}));void readSourcing(campaignId).then(r=>setCache(c=>({...c,[campaignId]:r})))},[]);
 const link=product.sourcing??null;
 // 연결한 캠페인의 후보는 열 때 한 번 읽는다(결과가 오기 전에는 '불러오는 중'으로 본다).
 const linkedCampaign=link?.campaignId??null;
 useEffect(()=>{if(!linkedCampaign)return;let live=true;void readSourcing(linkedCampaign).then(r=>{if(live)setCache(c=>({...c,[linkedCampaign]:r}))});return()=>{live=false}},[linkedCampaign]);
 const linked:Loaded|undefined=link?cache[link.campaignId]??{state:'loading'}:undefined;
 const quote=link&&linked?.state==='ok'?linked.candidates.find(c=>c.id===link.candidateId)??null:null;
 return <>
  <SourcingLink view={view} product={product} act={act} busy={busy} cache={cache} load={load} quote={quote} linkedState={linked}/>
  <MarginSimulator key={quote?`${quote.id}:${quote.version}`:'none'} product={product} quote={quote}/>
 </>;
}

function SourcingLink({view,product,act,busy,cache,load,quote,linkedState}:{view:View;product:Product;act:Act;busy:boolean;cache:Record<string,Loaded>;load:(id:string)=>void;quote:Candidate|null;linkedState:Loaded|undefined}){
 const link=product.sourcing??null;
 const [campaignId,setCampaignId]=useState(''),[candidateId,setCandidateId]=useState('');
 const picked=campaignId?cache[campaignId]:undefined,candidates=picked?.state==='ok'?picked.candidates:[];
 const campaign=(id:string)=>view.campaigns.find(c=>c.id===id)?.title??'캠페인 미확인';
 const pickCampaign=(id:string)=>{setCampaignId(id);setCandidateId('');if(id&&cache[id]?.state!=='ok')load(id)};
 const why=!view.canEdit?editReason:!view.campaigns.length?'연결할 캠페인이 없습니다. 캠페인을 먼저 만드세요.':!campaignId?'소싱 후보가 있는 캠페인을 먼저 고르세요.':picked?.state==='loading'?'소싱 후보를 불러오고 있습니다.':picked?.state==='error'?picked.error:!candidates.length?'이 캠페인에 소싱 후보가 없습니다. 캠페인 성장 탭에서 공급 견적을 먼저 저장하세요.':!candidateId?'연결할 소싱 후보를 고르세요.':link?.candidateId===candidateId?'이미 연결한 소싱 후보입니다.':'';
 const save=()=>{if(why)return;void act({action:'link_sourcing',productId:product.id,campaignId,candidateId},'소싱 후보를 연결했습니다.','다시 계산한 수익성과 실행 가능성에 견적 원가·MOQ·납기를 썼습니다.').then(r=>{if(r.ok){setCampaignId('');setCandidateId('')}})};
 async function unlink(){
  const ok=await askConfirm({title:'소싱 후보 연결을 해제할까요?',impact:'수익성과 실행 가능성이 견적 없이 다시 계산돼 미확인으로 돌아갈 수 있습니다. 소싱 후보 자체는 캠페인에 그대로 남습니다.',undo:'같은 후보를 다시 고르면 다시 연결됩니다.',confirmLabel:'연결 해제',danger:true});
  if(ok)await act({action:'unlink_sourcing',productId:product.id},'소싱 후보 연결을 해제했습니다.');
 }
 const profit=product.score?.subScores.find(x=>x.key==='profitability'),feasible=product.score?.subScores.find(x=>x.key==='feasibility');
 const unlinkWhy=!view.canEdit?editReason:'';
 return <section className={s.block} aria-labelledby="pr-sourcing-title"><h3 id="pr-sourcing-title" className={s.subtitle}>소싱 견적 연결</h3>
  {link?<div className={s.linkBox} role="note" aria-label="연결한 소싱 견적">
   <p><b>연결한 소싱 견적</b> <MetaLine items={[campaign(link.campaignId),quote&&linkedState?.state==='ok'?candidateName(quote,linkedState.catalogs):`후보 ${link.candidateId}`,`판 ${link.candidateVersion}`]}/></p>
   {quote?<StatList className={s.stats} label="견적 요약" items={[['단위 원가',money(quote.input.unitCost)],['MOQ',count(quote.input.moq,'개')],['납기',count(quote.input.leadDays,'일')],['견적 유효기한',date(quote.input.validUntil)]]}/>
    :linkedState?.state==='error'?<p className={s.muted}>견적을 불러오지 못했습니다: {linkedState.error}</p>:linkedState?.state==='loading'?<p className={s.muted}>견적을 불러오고 있습니다.</p>:<p className={s.muted}>연결한 후보를 캠페인에서 찾지 못했습니다. 지워졌다면 연결을 해제하세요.</p>}
   {quote&&quote.version!==link.candidateVersion&&<p className={s.muted}>캠페인의 견적이 판 {quote.version}으로 바뀌었습니다. 다시 계산하면 최신 판을 씁니다.</p>}
   <p className={s.reason}>수익성 {profit?.value==null?'미확인':`${Math.round(profit.value)}/100`}: {profit?.reason||'아직 계산 전입니다.'} 실행 가능성 {feasible?.value==null?'미확인':`${Math.round(feasible.value)}/100`}.</p>
   <p className={s.muted}>수익성과 실행 가능성은 이 견적의 원가, MOQ, 납기로 계산합니다.</p>
   <Button type="button" variant="ghost" size="sm" className="danger-action" disabled={busy||!!unlinkWhy} disabledReason={unlinkWhy} onClick={()=>void unlink()}><Unlink/>연결 해제</Button>
  </div>:<p className={s.muted}>소싱 견적을 연결하지 않아 수익성은 가정값으로만 볼 수 있습니다. 성장2 캠페인의 공급 견적을 고르면 점수에 씁니다.</p>}
  <div className={s.formGrid}>
   <label className="field"><span>캠페인</span><NativeSelect aria-label="소싱 후보를 찾을 캠페인" value={campaignId} disabled={!view.canEdit} onChange={e=>pickCampaign(e.target.value)}><NativeSelectOption value="">캠페인 고르기</NativeSelectOption>{view.campaigns.map(c=><NativeSelectOption key={c.id} value={c.id}>{c.title}</NativeSelectOption>)}</NativeSelect></label>
   <label className="field"><span>소싱 후보</span><NativeSelect aria-label="연결할 소싱 후보" value={candidateId} disabled={!view.canEdit||!candidates.length} onChange={e=>setCandidateId(e.target.value)}><NativeSelectOption value="">{picked?.state==='loading'?'불러오는 중':'소싱 후보 고르기'}</NativeSelectOption>{candidates.map(c=><NativeSelectOption key={c.id} value={c.id}>{`${candidateName(c,picked?.state==='ok'?picked.catalogs:[])}, 원가 ${money(c.input.unitCost)}, MOQ ${count(c.input.moq,'개')}`}</NativeSelectOption>)}</NativeSelect></label>
  </div>
  <Button type="button" variant="outline" disabled={busy||!!why} disabledReason={why} onClick={save}><Link2/>{link?'다른 소싱 후보로 바꿔 연결':'소싱 후보 연결'}</Button>
 </section>;
}

// 손익 시뮬레이터: 입력을 바꾸면 바로 다시 계산한다. 가정값 칸과 소싱 견적 칸에 표시를 붙인다.
function MarginSimulator({product,quote}:{product:Product;quote:Candidate|null}){
 const smart=MARGIN_CHANNELS.find(c=>c.id==='smartstore');
 const [f,setF]=useState({price:product.priceBand.min===null?'':String(product.priceBand.min),cost:'',shipping:String(MARGIN_DEFAULTS.shipping),packaging:'',channel:'smartstore',feePct:String(smart?.feePct??''),adPerOrder:String(MARGIN_DEFAULTS.adPerOrder),returnPct:String(MARGIN_DEFAULTS.returnPct)});
 const [costEdited,setCostEdited]=useState(false);
 // 견적 → 주문 1건 원가(고정 배송비·추가비를 MOQ로 나누고, 부가세 별도면 10%를 더한다: analytics/profit.ts profitInputFromCandidate).
 const fromQuote=quote?profitInputFromCandidate(quote.input,{price:marginNumber(f.price),channel:'own_mall',shippingPerOrder:null,packaging:null}):null;
 const quoteCost=fromQuote?.input.unitCost??null,useQuote=!costEdited&&quoteCost!==null;
 const cost=useQuote?String(Math.round(quoteCost)):f.cost;
 const set=(k:keyof typeof f)=>(e:{target:{value:string}})=>{if(k==='cost')setCostEdited(true);setF(x=>({...x,[k]:e.target.value}))};
 const pickChannel=(id:string)=>{const c=MARGIN_CHANNELS.find(x=>x.id===id);setF(x=>({...x,channel:id,feePct:c?.feePct==null?x.feePct:String(c.feePct)}))};
 const nums={price:marginNumber(f.price),cost:marginNumber(cost),shipping:marginNumber(f.shipping),packaging:marginNumber(f.packaging),feePct:marginNumber(f.feePct),adPerOrder:marginNumber(f.adPerOrder),returnPct:marginNumber(f.returnPct)};
 const assumed=assumedFields({channel:f.channel,feePct:nums.feePct,shipping:nums.shipping,returnPct:nums.returnPct,adPerOrder:nums.adPerOrder});
 const r=computeMargin(nums,assumed);
 const tag=(k:MarginField)=>k==='cost'&&useQuote?<span className={s.quoteTag}>소싱 견적</span>:assumed.includes(k)?<span className={s.assumeTag}>가정값</span>:null;
 const field=(k:'price'|'cost'|'shipping'|'packaging'|'adPerOrder',label:string)=><label className="field"><span>{label}{tag(k)}</span><Input type="number" min={0} inputMode="numeric" value={k==='cost'?cost:f[k]} onChange={set(k)}/></label>;
 return <section className={s.block} aria-labelledby="pr-margin-title"><h3 id="pr-margin-title" className={s.subtitle}>손익 시뮬레이터</h3>
  <p className={s.muted}>{"주문 1건 기준입니다. '가정값' 칸은 미리 채운 기본값이라 실제 값으로 고치세요."}</p>
  <div className={s.formGrid}>
   {field('price','판매가(원)')}{field('cost','원가(원)')}{field('shipping','배송비(원)')}{field('packaging','포장비(원)')}
   <label className="field"><span>채널</span><NativeSelect value={f.channel} onChange={e=>pickChannel(e.target.value)}>{MARGIN_CHANNELS.map(c=><NativeSelectOption key={c.id} value={c.id}>{c.label}</NativeSelectOption>)}</NativeSelect></label>
   <label className="field"><span>채널 수수료율(%){tag('feePct')}</span><Input type="number" min={0} max={100} step="0.1" inputMode="decimal" value={f.feePct} onChange={set('feePct')}/></label>
   {field('adPerOrder','광고비/주문(원)')}
   <label className="field"><span>반품률(%){tag('returnPct')}</span><Input type="number" min={0} max={99} step="0.1" inputMode="decimal" value={f.returnPct} onChange={set('returnPct')}/></label>
  </div>
  {fromQuote&&fromQuote.notes.length>0&&<ul className={s.notes} aria-label="견적 원가 계산 메모">{fromQuote.notes.map(x=><li key={x}>{x}</li>)}</ul>}
  <div aria-live="polite">{r?<>
   <StatList className={s.stats} label="손익 계산 결과" items={[['순매출(반품 제외)',money(r.netRevenue)],['채널 수수료',money(r.fee)],['공헌이익',money(r.contribution)],['광고비 차감 후 공헌이익',money(r.afterAds)],['마진율',r.marginPct===null?'미확인':`${r.marginPct}%`],['손익분기 ROAS',r.breakevenRoas===null?'남는 공헌이익이 없어 계산 불가':`${r.breakevenRoas}배`]]}/>
   {r.hasAssumptions?<p className={s.muted}>가정값으로 계산한 칸: {r.assumptions.map(k=>MARGIN_FIELD_LABEL[k]).join(', ')}. 결과도 가정입니다.</p>:<p className={s.muted}>모든 칸을 운영자가 확인한 값으로 계산했습니다.</p>}
  </>:<p className={s.muted}>판매가, 원가, 배송비, 포장비, 수수료율, 광고비, 반품률을 모두 채우면 계산합니다. 모르는 값은 0으로 채우지 않습니다.</p>}</div>
 </section>;
}

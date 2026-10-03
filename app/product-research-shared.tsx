'use client';
// 상품 리서치 화면(app/product-research-*.tsx)이 함께 쓰는 이름표, 응답 읽기, 결정 상자. 서버 계약은 lib/product-research/api.ts와 types.ts가 정본이다.
// 화면 원칙(UX-PLAN-3): 모르는 값은 '미확인'(0 아님), 막힌 버튼은 이유를 보인다, 성공 알림은 notifySaved, 위험 결정은 확인 대화상자(영향과 되돌림 문장).
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {Segmented} from '@/components/app/segmented';
import {MetaLine} from '@/components/app/meta-line';
import {askConfirm} from '@/components/app/confirm-dialog';
import {dateTime,josa,shortId} from '@/lib/format';
import {cssVars} from '@/lib/ui/css-vars';
import type {Saved} from '@/lib/ui/notify';
import type {ResearchRequest,ResearchViewResponse,CredentialKey} from '@/lib/product-research/api';
import type {AccessMethod,DecisionStatus,MetricKey,RegulatoryClass,ScoreCard,Series,SourceId,SubScoreKey,Temperature} from '@/lib/product-research/types';
import {SOURCES} from '@/lib/product-research/sources';
import {categorySpec} from '@/lib/product-research/categories';
import s from './product-research.module.css';

// 화면 응답. series·snapshots는 계약(ProductResearchView)에 아직 없는 값이라 있으면 쓰고 없으면 안내만 보인다(보고서의 계약 빈 곳).
export type SnapshotRef={id:string;sourceId:SourceId;fetchedAt:string;status?:'ok'|'partial'|'failed'};
export type View=ResearchViewResponse&{series?:Series[];snapshots?:SnapshotRef[]};
export type Product=View['products'][number];
// 가져오기 거절의 행 오류. 계약은 {error}만 정한다. 서버가 issues(또는 errors)로 행 번호를 주면 그대로 보인다.
export type RowIssue={row:number|null;field?:string;message:string};
export type ActResult={ok:true}|{ok:false;error:string;issues:RowIssue[]};
export type Act=(request:ResearchRequest,message:Saved,description?:string)=>Promise<ActResult>;

export const tierLabels:Record<ScoreCard['tier'],string>={adopt:'도입 검토',watch:'관찰',needs_data:'자료 보강',reject:'제외'};
const tierStatus:Record<ScoreCard['tier'],string>={adopt:'status-approved',watch:'status-running',needs_data:s.warn,reject:'status-outdated'};
export const decisionLabels:Record<DecisionStatus,string>={approved:'승인',hold:'보류',rejected:'제외'};
const decisionStatus:Record<DecisionStatus,string>={approved:'status-approved',hold:s.warn,rejected:'status-revision'};
export const temperatureLabels:Record<Temperature,string>={ambient:'상온',chilled:'냉장',frozen:'냉동',unknown:'미확인'};
export const methodLabels:Record<AccessMethod,string>={api:'공식 API',licensed:'계약 데이터',manual:'운영자 가져오기',internal:'내부'};
export const regulatoryLabels:Record<RegulatoryClass,string>={food:'식품',health_functional_food:'건강기능식품',cosmetics:'화장품',functional_cosmetics:'기능성 화장품',kc_electrical:'KC 전기용품',kc_children:'KC 어린이제품',general:'일반'};
export const subScoreLabels:Record<SubScoreKey,string>={demand:'수요 규모',momentum:'성장 모멘텀',durability:'지속성',competition:'경쟁 강도',profitability:'수익성',feasibility:'실행 가능성',content:'콘텐츠성',brand_fit:'브랜드 적합성',risk:'리스크'};
export const metricLabels:Record<MetricKey,string>={search_volume_month:'월간 검색수',search_volume_pc:'PC 검색수',search_volume_mobile:'모바일 검색수',search_trend:'검색 추세(상대값)',shopping_click_trend:'쇼핑 클릭 추세(상대값)',ad_competition:'광고 경쟁 지수',product_count:'상품 수',seller_count:'판매처 수',price_min:'최저가',price_median:'가격 중앙값',video_views:'영상 조회수',video_view_velocity:'하루 조회수 증가',video_count:'관련 영상 수',rank:'랭킹 순위',review_count:'리뷰 수',rating:'평점',sales_estimate:'판매 추정(월)',own_orders:'자사 주문 수',own_revenue:'자사 순매출'};
export const snapshotStatusLabels:Record<'ok'|'partial'|'failed',string>={ok:'정상',partial:'일부만 받음',failed:'실패'};

// 출처 자격증명 입력 칸. 이름은 서버 검증(lib/product-research/credentials.ts)의 입력 키와 같다.
export type CredentialField={name:string;label:string;secret:boolean;optional?:boolean};
export const credentialForms:Record<CredentialKey,{label:string;fields:readonly CredentialField[]}>={
 naver_searchad:{label:'네이버 검색광고',fields:[{name:'apiKey',label:'네이버 검색광고 API 키',secret:true},{name:'secretKey',label:'비밀키',secret:true},{name:'customerId',label:'고객 ID',secret:false}]},
 naver_developers:{label:'네이버 개발자센터',fields:[{name:'clientId',label:'네이버 개발자 Client ID',secret:false},{name:'clientSecret',label:'Client Secret',secret:true}]},
 youtube:{label:'YouTube',fields:[{name:'apiKey',label:'YouTube API 키',secret:true}]},
 coupang_partners:{label:'쿠팡 파트너스',fields:[{name:'accessKey',label:'쿠팡 파트너스 Access 키',secret:true},{name:'secretKey',label:'Secret 키',secret:true}]},
 licensed:{label:'계약 데이터',fields:[{name:'vendor',label:'계약 데이터 공급사',secret:false},{name:'apiKey',label:'공급사 키(계약 뒤)',secret:true,optional:true}]},
};

export const score=(card:ScoreCard|null|undefined)=>card?.total==null?'미확인':String(Math.round(card.total));
export const scoreSort=(card:ScoreCard|null|undefined)=>card?.total==null?-1:card.total;
export const confidence=(card:ScoreCard|null|undefined)=>card?`${Math.round(card.confidence*100)}%`:'미확인';
export const subValue=(card:ScoreCard|null|undefined,key:SubScoreKey)=>card?.subScores.find(x=>x.key===key)?.value??null;
export const categoryLabel=(id:string|null)=>categorySpec(id)?.label??'미분류';
export const sourceLabel=(view:View,id:SourceId)=>view.sources.find(x=>x.id===id)?.label??SOURCES.find(x=>x.id===id)?.label??id;
// 근거 스냅샷 ID → '출처 이름 수집 시각'. 화면 응답에 스냅샷 목록이 없으면 가져오기 기록에서 찾고, 그래도 없으면 ID 끝자리만 보인다.
export function evidenceLabel(view:View,id:string){
 const snap=view.snapshots?.find(x=>x.id===id);
 if(snap)return `${sourceLabel(view,snap.sourceId)} ${dateTime(snap.fetchedAt)}`;
 const imported=view.imports.find(x=>x.snapshotId===id);
 if(imported)return `${sourceLabel(view,imported.sourceId)} ${dateTime(imported.importedAt)}`;
 return `스냅샷 ${shortId(id)}`;
}
// 오늘(한국시간) yyyy-mm-dd.
export const koreaToday=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
export const editReason='대표·관리자만 바꿀 수 있습니다.';

export function TierBadge({card}:{card:ScoreCard|null}){return card?<span className={'status '+tierStatus[card.tier]}>{tierLabels[card.tier]}</span>:<span className="status status-outdated">점수표 없음</span>}
export function DecisionBadge({product}:{product:Product}){const d=product.decision;return d?<span className={'status '+decisionStatus[d.status]}>{decisionLabels[d.status]}</span>:<span className="status">결정 전</span>}
// 0~100 막대(수요·하위 점수). 값을 모르면 막대 없이 '미확인'.
export function Meter({value,label}:{value:number|null;label:string}){
 return <span className={s.meterRow}><span className={s.meterLabel}>{label}</span>{value===null?<span className={s.unknown}>미확인</span>:<><span className={s.meter} aria-hidden="true"><span className={s.meterFill+' fill-w'} ref={cssVars({'--fill':`${Math.max(0,Math.min(100,value))}%`})}/></span><b className={s.meterValue}>{Math.round(value)}</b></>}</span>;
}

const decisionMessages:Record<DecisionStatus,Saved>={approved:'승인을 기록했습니다.',hold:'보류를 기록했습니다.',rejected:'제외를 기록했습니다.'};
// 결정 상자: 승인·보류·제외와 한 문장 사유. 승인·제외는 영향을 묻고 기록한다. 승인한 후보는 캠페인의 시장 근거로 넘길 수 있다(발주·가격 승인 없음).
export function DecisionBox({view,product,act,busy,compact=false}:{view:View;product:Product;act:Act;busy:boolean;compact?:boolean}){
 const decision=product.decision,card=product.score;
 const [status,setStatus]=useState<DecisionStatus>(decision?.status??'hold'),[reason,setReason]=useState(''),[campaignId,setCampaignId]=useState('');
 const brief=view.briefs.filter(b=>b.productIds.includes(product.id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]??null;
 const blocked=status==='approved'&&card?.blocked?`선정 금지 후보입니다: ${card.blocked.reason}`:'';
 const why=!view.canEdit?editReason:!card?'점수표가 아직 없습니다. 출처와 가져오기 탭에서 점수를 다시 계산하세요.':blocked?blocked:!reason.trim()?'사유를 한 문장으로 쓰세요.':'';
 async function submit(){
  if(!card||why)return;
  if(status!=='hold'){
   const ok=await askConfirm(status==='approved'
    ?{title:`${josa(product.name,'을/를')} 승인할까요?`,impact:'승인하면 이 후보를 캠페인의 시장 근거로 넘길 수 있습니다. 발주·결제·가격 승인은 일어나지 않습니다.',undo:'다시 결정하면 새 결정이 기록되고 이번 결정은 이력으로 남습니다.',confirmLabel:'승인 기록'}
    :{title:`${josa(product.name,'을/를')} 제외할까요?`,impact:'제외하면 주간 리포트의 제외 목록에 남고 선정 위원회 추천에서 빠집니다.',undo:'다시 결정하면 새 결정이 기록되고 이번 결정은 이력으로 남습니다.',confirmLabel:'제외 기록',danger:true});
   if(!ok)return;
  }
  const r=await act({action:'decide',productId:product.id,scoreCardId:card.id,briefId:brief?.id??null,status,reason:reason.trim()},decisionMessages[status],brief?'최신 선정 메모를 함께 연결했습니다.':undefined);
  if(r.ok)setReason('');
 }
 const campaign=view.campaigns.find(c=>c.id===campaignId);
 const handoffWhy=!view.canEdit?editReason:!campaign?'넘길 캠페인을 먼저 고르세요.':'';
 async function handoff(){
  if(!decision||!campaign||handoffWhy)return;
  const ok=await askConfirm({title:`${campaign.title} 캠페인에 시장 근거로 넘길까요?`,impact:'이 캠페인 성장 탭에 시장 근거 초안이 생깁니다. 발주·결제·가격 승인은 일어나지 않습니다.',undo:'넘긴 근거는 그 캠페인 성장 탭에서 사람이 정리합니다.',confirmLabel:'시장 근거로 넘기기'});
  if(!ok)return;
  await act({action:'handoff',decisionId:decision.id,campaignId:campaign.id,campaignVersion:campaign.version},'시장 근거로 넘겼습니다.','캠페인 성장 탭에서 확인하세요.');
 }
 return <div className={compact?s.decisionCompact:s.decision}>
  {decision&&<p className={s.muted}><MetaLine items={[`지금 결정: ${decisionLabels[decision.status]}`,dateTime(decision.decidedAt),decision.decidedBy.email??'결정한 사람 미확인']}/><br/>사유: {decision.reason}</p>}
  <Segmented label={`${product.name} 결정`} value={status} onChange={setStatus} disabled={!view.canEdit} options={[{value:'approved',label:'승인'},{value:'hold',label:'보류'},{value:'rejected',label:'제외'}]}/>
  <label className="field"><span>사유(한 문장)</span><Input aria-label={`${product.name} 결정 사유`} value={reason} maxLength={200} disabled={!view.canEdit} placeholder="예: 상온 보관이고 검색 추세가 12주째 오릅니다." onChange={e=>setReason(e.target.value)}/></label>
  <Button type="button" disabled={busy||!!why} disabledReason={why} onClick={()=>void submit()}>결정 기록</Button>
  {decision?.status==='approved'&&(decision.handoff
   ?<p className={s.muted}>캠페인 시장 근거로 넘겼습니다(캠페인 {shortId(decision.handoff.campaignId)}).</p>
   :<div className={s.handoff}><label className="field"><span>시장 근거로 넘길 캠페인</span><NativeSelect aria-label="시장 근거로 넘길 캠페인" value={campaignId} onChange={e=>setCampaignId(e.target.value)}><NativeSelectOption value="">캠페인 고르기</NativeSelectOption>{view.campaigns.map(c=><NativeSelectOption key={c.id} value={c.id}>{c.title}</NativeSelectOption>)}</NativeSelect></label><Button type="button" variant="outline" disabled={busy||!!handoffWhy} disabledReason={handoffWhy} onClick={()=>void handoff()}>시장 근거로 넘기기</Button></div>)}
 </div>;
}

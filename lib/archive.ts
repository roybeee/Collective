export const archiveCategories={brand:'브랜드·정체성',product:'제품·가격',customer:'고객·니즈',market:'시장·경쟁',channel:'채널·콘텐츠',performance:'성과·매출',operations:'운영·제약',other:'미분류'} as const;
export type ArchiveCategory=keyof typeof archiveCategories;
export type ArchiveSource={id:string;brandId:string;title:string;category:ArchiveCategory;origin:'manual'|'upload'|'research';status:'candidate'|'confirmed'|'excluded';url:string;content:string;observedAt:string;createdAt:string;version:number;scope:string;fileName?:string;fileSize?:number;objectKey?:string;extraction?:string;researchId?:string};
export type ArchiveSourceSummary=Omit<ArchiveSource,'content'|'objectKey'>&{excerpt:string;characters:number;hasFile:boolean};
export type BrandIntake={website:string;socialLinks:string;market:string;clientNeed:string;competitors:string};
export type ArchiveState={id:string;revision:number;updatedAt:string};
export const metricFields={posts:'기간 내 게시물',followers:'종료 시점 팔로워',reach:'도달한 계정 수',impressions:'노출 수',views:'재생/조회 수',shares:'공유 횟수',saves:'저장 횟수',clicks:'링크 클릭 수',sessions:'사이트 세션',keyEventSessions:'핵심 행동 발생 세션',orders:'구매/이용 완료 수',revenue:'매출 (원)',adSpend:'광고비 (원)',variableCosts:'변동비 (원)',productionCost:'제작비 (원)',averageViewPercentage:'평균 시청 비율 (%)'} as const;
export type MetricField=keyof typeof metricFields;
export type ChannelObservation={id:string;brandId:string;channel:string;account:string;periodStart:string;periodEnd:string;observedAt:string;source:string;scope:'organic'|'paid'|'all';method:'export'|'manual'|'public';definition:string;values:Record<MetricField,number|null>;createdAt:string;version:number};
export type Diagnostic={researchQuality?:import('./deep-research').DeepReport['quality'];id:string;brandId:string;researchId:string;archiveRevision:number;status:'candidate'|'confirmed';summary:string;positioning:string;audience:string;needs:string;strengths:string;gaps:string;opportunities:{title:string;hypothesis:string;action:string;metric:string;sourceIds:string[]}[];questions:string[];sourceIds:string[];limitations:string;createdAt:string};
export type ResearchStage='investigation'|'identity'|'customer'|'channel'|'diagnosis';
export const researchStages:Record<ResearchStage,string>={investigation:'심층 온보딩 조사',identity:'브랜드·제품 이해',customer:'고객·시장·경쟁 조사',channel:'채널·콘텐츠 진단',diagnosis:'종합 진단·전략 과제'};
export type BrandResearch={execution?:'server'|'interactive';lastCheckedAt?:string;activity?:string;activityAt?:string;retryAt?:string;retryCount?:number;protocol?:string;plan?:import('./deep-research').ResearchPlan;access?:import('./deep-research').ResearchAccess;report?:import('./deep-research').DeepReport;previousResearchId?:string;id:string;brandId:string;mode:'deep'|'classify';status:'running'|'uncertain'|'completed'|'failed'|'cancelled';steps:{id:string;stage:ResearchStage;status:'pending'|'running'|'uncertain'|'completed'|'failed';sourceIds?:string[];providerId?:string;rawResult?:string;summary?:string;limitations?:string}[];model:string;stopRequested:boolean;error?:string;createdAt:string;updatedAt:string;snapshot:{brand:unknown;observations:ChannelObservation[]};tokens:number};
export type PublicResearch=Omit<BrandResearch,'snapshot'|'steps'>&{steps:Omit<BrandResearch['steps'][number],'providerId'>[]};
export type ArchiveData={sources:ArchiveSourceSummary[];observations:ChannelObservation[];diagnostics:Diagnostic[];research:PublicResearch[];state:ArchiveState;storageReady:boolean};
export const researchActive=(r:Pick<BrandResearch,'status'>)=>r.status==='running'||r.status==='uncertain';
export function publicResearch(r:BrandResearch):PublicResearch{const{snapshot:_,steps,...rest}=r;return {...rest,steps:steps.map(({providerId:__,...x})=>x)}}
export function sourceSummary(s:ArchiveSource):ArchiveSourceSummary{const{objectKey,content,...rest}=s;return {...rest,excerpt:content.slice(0,260),characters:content.length,hasFile:!!objectKey}}
export function classifySource(title:string,content:string):ArchiveCategory{
 const t=(title+' '+content.slice(0,4000)).toLowerCase();
 const rules:[ArchiveCategory,RegExp][]=[['performance',/매출|광고비|roas|전환율|손익/],['product',/제품|메뉴|가격|성분|상품/],['customer',/인터뷰|고객|페르소나|니즈/],['channel',/인스타|틱톡|유튜브|sns|콘텐츠/],['market',/시장|경쟁|트렌드/],['operations',/운영|재고|영업시간|수용량/],['brand',/브랜드|로고|톤앤매너|비전/]];
 return rules.find(([,r])=>r.test(t))?.[0]||'other';
}
export function dashboardMetrics(o?:ChannelObservation){
 const v=o?.values;const value=(key:MetricField)=>v?.[key]??null;
 const rate=(n:MetricField,d:MetricField)=>value(n)!==null&&value(d)!==null&&value(d)!>0?value(n)!/value(d)!*100:null;
 const moneyKeys:MetricField[]=['revenue','variableCosts','adSpend','productionCost'];
 const unavailable=(n:MetricField,d:MetricField)=>value(n)!==null&&value(d)===0?'분모 0 · 계산 불가':'미수집';
 const contribution=moneyKeys.every(k=>value(k)!==null)?value('revenue')!-value('variableCosts')!-value('adSpend')!-value('productionCost')!:null;
 return [{id:'reach',label:'도달',value:value('reach'),unit:'계정',formula:'기간 내 도달 계정. 채널 간 합산하지 않습니다.'},
 {id:'share',label:'공유 / 도달',value:rate('shares','reach'),unit:'%',unavailable:unavailable('shares','reach'),formula:'공유 횟수 ÷ 도달 계정 × 100. 반복 공유를 포함할 수 있습니다.'},
 {id:'save',label:'저장 / 도달',value:rate('saves','reach'),unit:'%',unavailable:unavailable('saves','reach'),formula:'저장 횟수 ÷ 도달 계정 × 100.'},
 {id:'retention',label:'평균 시청 비율',value:value('averageViewPercentage'),unit:'%',formula:'플랫폼에서 내보낸 평균 시청 비율. 반복 재생 정의를 확인하세요.'},
 {id:'ctr',label:'링크 클릭률',value:rate('clicks','impressions'),unit:'%',unavailable:unavailable('clicks','impressions'),formula:'동일 범위 링크 클릭 ÷ 노출 × 100. YouTube 썸네일 CTR과 다른 지표입니다.'},
 {id:'conversion',label:'핵심 행동 세션율',value:rate('keyEventSessions','sessions'),unit:'%',unavailable:unavailable('keyEventSessions','sessions'),formula:'핵심 행동이 발생한 세션 ÷ 전체 세션 × 100. 이벤트 횟수가 아닙니다.'},
 {id:'revenue',label:'기록된 매출',value:value('revenue'),unit:'원',formula:'선택 기간의 기록 매출. 캠페인 순증 매출을 뜻하지 않습니다.'},
 {id:'contribution',label:'기록 비용 차감 잔액',value:contribution,unit:'원',formula:'매출 − 변동비 − 광고비 − 제작비. 제외 고정비가 있으면 영업이익이 아닙니다.'}];
}
export function comparablePrevious(current:ChannelObservation,all:ChannelObservation[]){
 if(current.method==='public')return undefined;
 const duration=Date.parse(current.periodEnd)-Date.parse(current.periodStart);
 return all.filter(x=>x.id!==current.id&&x.channel===current.channel&&x.account===current.account&&x.scope===current.scope&&x.method===current.method&&x.definition===current.definition&&x.periodEnd<current.periodStart&&Date.parse(x.periodEnd)-Date.parse(x.periodStart)===duration).sort((a,b)=>b.periodEnd.localeCompare(a.periodEnd))[0];
}
export const metricReferences=[{title:'Instagram Insights · Meta',url:'https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api'},{title:'YouTube Analytics 지표 정의',url:'https://developers.google.com/youtube/analytics/metrics'},{title:'GA4 Data API 지표 정의',url:'https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema'},{title:'TikTok 공개 영상 통계',url:'https://developers.tiktok.com/docs/en/tiktok-api-v2-video-object'}];

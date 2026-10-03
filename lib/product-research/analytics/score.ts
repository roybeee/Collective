// 점수표 w1(순수·결정형). 계획 4.2: 하위 점수 9개, 결측은 0이 아니라 null, 가중치는 판 번호로 고정하고 백테스트 결과로만 바꾼다.
// 모델(LLM)은 이 점수를 설명할 뿐 바꾸지 않는다. 같은 입력이면 inputDigest·총점·분류가 늘 같다.
import type {ScoreCard,Series,SourceId,SubScore,SubScoreKey,Temperature} from '../types';
import {SUB_SCORES} from '../types';
import {calibrateTrend,currentVolume} from './calibrate';
import {assessCompetition,competitionInputFromSeries,type CompetitionResult} from './competition';
import {groupDigits} from './format';
import {digestOf,shortId} from './hash';
import {simulateProfit,type ProfitInput,type ProfitResult} from './profit';
import {assessRisk,type RiskInput,type RiskLevel,type RiskResult} from './risk';
import {DAY_MS,latestValue,sliceAsOf,timeOf,videoViewVelocity} from './series';
import {analyzeTrend,theilSen,type TrendResult} from './trend';

// 가중치 판. 합은 1이다. w1 근거: 계획 ④의 정답('앞으로 오를 상품')을 직접 겨냥하는 모멘텀·지속성에 0.4를 두고,
// 수요·수익성·경쟁·실행 가능성은 '팔 만한가'를 본다. 브랜드 적합성은 대부분 비어 있어(사람·모델 판정) 작게 둔다.
// 바꿀 때는 새 판(w2…)을 만들고 같은 정답셋으로 백테스트해 기준선 대비 결과를 남긴다. 기존 판은 고치지 않는다.
export const WEIGHT_SETS:Record<string,Record<SubScoreKey,number>>={
 w1:{demand:0.12,momentum:0.25,durability:0.18,competition:0.1,profitability:0.1,feasibility:0.08,content:0.07,brand_fit:0.05,risk:0.05},
};
export const TIER_RULES={adoptTotal:70,adoptConfidence:0.6,watchTotal:50,needsDataConfidence:0.4,fullDiversitySources:3};

export type ScoreInput={
 productId:string;asOf:string;
 // 상품 키워드 묶음의 30일 검색량 합(보정값). keywords는 사람이 읽는 이름.
 demand:{monthlyVolume:number|null;keywords:string[];evidence:string[]}|null;
 trend:TrendResult|null;
 // 플랫폼 순위: 지금·4주 전(1이 최상)과 최근 12주 ln(순위) 주당 기울기(점 4개 이상일 때, 음수=상승).
 rank:{current:number|null;previous:number|null;slope:number|null;evidence:string[]}|null;
 // 영상: 최근 14일 하루 조회수 증가, 4~6주 전 같은 값, 관련 영상 수.
 video:{velocity:number|null;previousVelocity:number|null;videoCount:number|null;evidence:string[]}|null;
 competition:CompetitionResult|null;
 profit:ProfitResult|null;
 feasibility:{moq:number|null;leadDays:number|null;needsCertification:boolean|null;temperature:Temperature}|null;
 // 브랜드 적합성 0~100: 대표·MD 또는 모델 판정. 없으면 null.
 brandFit:{value:number;by:string;evidence:string[]}|null;
 risk:RiskResult;
 sources:SourceId[];
};
const clamp=(v:number)=>Math.max(0,Math.min(100,v));
const r1=(v:number)=>Math.round(v*10)/10;
const uniq=(xs:readonly string[])=>[...new Set(xs)].sort();
const sub=(key:SubScoreKey,value:number|null,evidence:readonly string[],reason:string):SubScore=>({key,value:value===null?null:r1(clamp(value)),evidence:uniq(evidence),reason});
// 출처마다 다른 단위를 tanh로 0~100에 맞춘다(출처별 표준화). scale은 '눈에 띄는 변화' 한 단위다.
const squash=(x:number,scale:number)=>50+50*Math.tanh(x/scale);

function demandScore(i:ScoreInput):SubScore{
 const v=i.demand?.monthlyVolume??null;
 if(v===null||!(v>=0))return sub('demand',null,[],'검색량 기준점(검색광고)이 없어 수요 규모를 판단하지 않았습니다.');
 // 로그 척도: 월 100회=0, 1만 회=50, 100만 회=100.
 return sub('demand',(Math.log10(Math.max(v,1))-2)/4*100,i.demand!.evidence,`키워드 묶음(${i.demand!.keywords.join('·')}) 30일 검색량이 약 ${groupDigits(Math.round(v))}회입니다.`);
}
function momentumScore(i:ScoreInput):SubScore{
 const parts:{v:number;w:number;why:string}[]=[],ev:string[]=[];const t=i.trend;
 // 계절 상품의 최근 순위·영상 변화는 계절 주기의 한 구간이라 앞날을 말해 주지 않는다. 계절 상품은 작년 패턴으로만 본다.
 const seasonal=t?.durability==='seasonal'&&t.seasonalOutlook!==null&&t.seasonalOutlook>0;
 if(t&&t.slope12!==null){
  let signal=t.slope12,why=`검색 추세 주당 ${(t.slope12Pct!*100).toFixed(1)}%`;
  // 계절 상품: 기대 변화 = 작년 같은 시기 이후 12주 변화(주당 환산) + 1년 사이 수준 변화(주당 환산). 기준 시점 이전 자료만 쓴다.
  if(seasonal){signal=Math.log(t.seasonalOutlook!)/12+(t.yoy!==null&&t.yoy>0?Math.log(t.yoy)/52:0);why=`작년 이 시기 이후 12주 ${((t.seasonalOutlook!-1)*100).toFixed(0)}%(계절 보정)`}
  // 반짝 유행: 급등 주를 뺀 바탕 추세만 모멘텀으로 본다.
  else if(t.durability==='fad'){signal=t.preSpikeSlope??0;why=`급등 주를 뺀 바탕 추세 주당 ${((Math.exp(signal)-1)*100).toFixed(1)}%`}
  parts.push({v:squash(signal,0.04),w:0.6,why});ev.push(...t.evidence.slice(-12));
 }
 if(!seasonal&&i.rank&&(i.rank.slope!==null||(i.rank.current!==null&&i.rank.previous!==null&&i.rank.current>0&&i.rank.previous>0))){
  // 순위는 ln(순위)의 12주 Theil–Sen 기울기(4주 환산, 음수=상승)를 쓴다. 점이 모자라면 4주 전과 지금 두 점을 쓴다.
  const g=i.rank.slope!==null?-i.rank.slope*4:Math.log((i.rank.previous as number)/(i.rank.current as number));
  parts.push({v:squash(g,0.5),w:0.25,why:`순위 ${i.rank.previous??'?'}위→${i.rank.current}위`});ev.push(...i.rank.evidence);
 }
 if(!seasonal&&i.video&&i.video.velocity!==null&&i.video.previousVelocity!==null){
  const g=Math.log((i.video.velocity+1)/(i.video.previousVelocity+1));parts.push({v:squash(g,0.7),w:0.15,why:`영상 조회 증가 속도 ${g>=0?'상승':'하락'}`});ev.push(...i.video.evidence);
 }
 if(!parts.length)return sub('momentum',null,[],'추세·순위·영상 시계열이 없어 모멘텀을 판단하지 않았습니다.');
 const w=parts.reduce((s,p)=>s+p.w,0);
 return sub('momentum',parts.reduce((s,p)=>s+p.v*p.w,0)/w,ev,`${parts.map(p=>p.why).join(', ')}를 출처별로 표준화해 합쳤습니다.`);
}
function durabilityScore(i:ScoreInput):SubScore{
 const t=i.trend;if(!t||!t.durability)return sub('durability',null,[],'추세 이력이 4주 미만이라 지속성을 판단하지 않았습니다.');
 let v={steady:70,rising:75,seasonal:60,declining:30,fad:15}[t.durability];
 if(t.durability==='fad'&&t.spiking)v=20;
 if(t.durability==='seasonal'&&t.seasonalOutlook!==null)v=t.seasonalOutlook>=1.2?72:t.seasonalOutlook<=0.8?40:60;
 // 이력이 짧으면 판단을 중간(50) 쪽으로 당긴다.
 if(t.weeks<26)v=50+(v-50)*t.weeks/26;
 return sub('durability',v,t.evidence.slice(-12),t.reasons[0]??'');
}
function competitionScore(i:ScoreInput):SubScore{
 const c=i.competition;if(!c||c.score===null)return sub('competition',null,c?.evidence??[],'판매처·상품 수·광고 경쟁 자료가 없어 경쟁을 판단하지 않았습니다.');
 return sub('competition',100-c.score,c.evidence,`경쟁 강도 ${c.score.toFixed(0)}/100(${c.reasons.slice(0,3).join(', ')})을 뒤집은 값입니다.`);
}
function profitabilityScore(i:ScoreInput):SubScore{
 const p=i.profit;if(!p||p.marginPct===null)return sub('profitability',null,[],`원가·배송 자료가 없어 수익성은 미확인입니다${p?.missing.length?`(${p.missing.join('·')} 없음)`:''}.`);
 // 공헌이익률 -5%=0, 40%=100.
 return sub('profitability',(p.marginPct+0.05)/0.45*100,[],`예상 공헌이익률 ${(p.marginPct*100).toFixed(1)}%${p.breakevenRoas!==null?`, 손익분기 ROAS ${p.breakevenRoas.toFixed(2)}`:''}${p.feeAssumption?'(수수료 가정값)':''}.`);
}
function feasibilityScore(i:ScoreInput):SubScore{
 const f=i.feasibility;if(!f||(f.moq===null&&f.leadDays===null&&f.needsCertification===null&&f.temperature==='unknown'))return sub('feasibility',null,[],'MOQ·납기·인증·보관 온도 자료가 없어 실행 가능성을 판단하지 않았습니다.');
 let v=60;const why:string[]=[];
 if(f.moq!==null){const d=f.moq<=100?10:f.moq<=500?0:f.moq<=2000?-10:-20;v+=d;why.push(`MOQ ${groupDigits(f.moq)}개`)}
 if(f.leadDays!==null){const d=f.leadDays<=7?10:f.leadDays<=21?0:f.leadDays<=45?-10:-20;v+=d;why.push(`납기 ${f.leadDays}일`)}
 if(f.needsCertification){v-=25;why.push('인증 필요')}
 // 대표 결정 D1: 상온 우선.
 const temp={ambient:15,chilled:-15,frozen:-25,unknown:-5}[f.temperature];v+=temp;why.push({ambient:'상온(D1 우선)',chilled:'냉장',frozen:'냉동',unknown:'보관 온도 미확인'}[f.temperature]);
 return sub('feasibility',v,[],`${why.join(', ')} 기준입니다.`);
}
function contentScore(i:ScoreInput):SubScore{
 const vd=i.video;const parts:number[]=[],why:string[]=[];
 if(vd?.videoCount!=null){parts.push(Math.log10(vd.videoCount+1)/3*100);why.push(`관련 영상 ${groupDigits(vd.videoCount)}개`)}
 if(vd?.velocity!=null){parts.push(Math.log10(vd.velocity+1)/4*100);why.push(`하루 조회 증가 약 ${groupDigits(Math.round(vd.velocity))}회`)}
 if(!parts.length)return sub('content',null,[],'영상 자료가 없어 콘텐츠성을 판단하지 않았습니다.');
 return sub('content',parts.reduce((a,b)=>a+b,0)/parts.length,vd!.evidence,`${why.join(', ')}입니다.`);
}
function brandFitScore(i:ScoreInput):SubScore{
 const b=i.brandFit;if(!b||!Number.isFinite(b.value))return sub('brand_fit',null,[],'브랜드 적합성 판정이 아직 없습니다.');
 return sub('brand_fit',b.value,b.evidence,`${b.by} 판정 ${r1(clamp(b.value))}점입니다.`);
}
const RISK_SCORE:Record<RiskLevel,number>={low:90,medium:60,high:25,blocked:0};
function riskScore(i:ScoreInput):SubScore{
 const top=i.risk.items.filter(x=>x.level===i.risk.level);
 return sub('risk',RISK_SCORE[i.risk.level],[],`리스크 ${({low:'낮음',medium:'보통',high:'높음',blocked:'선정 금지'})[i.risk.level]}${top.length&&i.risk.level!=='low'?`: ${top[0].reason}`:''}`);
}

export function scoreCard(input:ScoreInput,opts:{weightsVersion?:string;computedAt:string}):ScoreCard{
 const version=opts.weightsVersion??'w1',W=WEIGHT_SETS[version];
 if(!W)throw new Error(`unknown weights version: ${version}`);
 const subs=[demandScore(input),momentumScore(input),durabilityScore(input),competitionScore(input),profitabilityScore(input),feasibilityScore(input),contentScore(input),brandFitScore(input),riskScore(input)];
 const byKey=new Map(subs.map(s=>[s.key,s])),present=subs.filter(s=>s.value!==null);
 // 결측은 빼고 가중 평균한다. 수요·모멘텀 둘 다 없으면 '팔릴지'를 말할 근거가 없어 총점을 내지 않는다.
 const wsum=present.reduce((s,x)=>s+W[x.key],0);
 const core=byKey.get('demand')!.value===null&&byKey.get('momentum')!.value===null;
 const total=core||wsum<=0?null:r1(present.reduce((s,x)=>s+(x.value as number)*W[x.key],0)/wsum);
 const coverage=SUB_SCORES.reduce((s,k)=>s+(byKey.get(k)!.value!==null?W[k]:0),0)/SUB_SCORES.reduce((s,k)=>s+W[k],0);
 const diversity=Math.min(1,new Set(input.sources).size/TIER_RULES.fullDiversitySources);
 const confidence=Math.round(coverage*diversity*1000)/1000;
 const blocked=input.risk.blocked?{rule:input.risk.blocked.rule,reason:input.risk.blocked.reason}:null;
 const R=TIER_RULES;
 const tier:ScoreCard['tier']=blocked?'reject':total===null?'needs_data':total>=R.adoptTotal&&confidence>=R.adoptConfidence?'adopt':total>=R.watchTotal?'watch':confidence<R.needsDataConfidence?'needs_data':'reject';
 const inputDigest=digestOf(input);
 return {id:shortId('prs',{productId:input.productId,version,inputDigest}),productId:input.productId,weightsVersion:version,computedAt:opts.computedAt,subScores:SUB_SCORES.map(k=>byKey.get(k)!),total,confidence,missing:SUB_SCORES.filter(k=>byKey.get(k)!.value===null),blocked,tier,inputDigest};
}

// 상품 하나의 시계열 묶음. keywordKeys 첫 번째가 대표 키워드(추세·경쟁 기준)다.
export type ProductBundle={
 productId:string;keywords:string[];keywordKeys:string[];listingKeys:string[];series:Series[];
 profit:ProfitInput|null;feasibility:ScoreInput['feasibility'];risk:RiskInput;brandFit:ScoreInput['brandFit'];
};
const meanIn=(pts:readonly {at:string;value:number|null}[],from:number,to:number)=>{const vs=pts.filter(p=>p.value!==null&&timeOf(p.at)>from&&timeOf(p.at)<=to).map(p=>p.value as number);return vs.length?vs.reduce((a,b)=>a+b,0)/vs.length:null};
// 기준 시점 asOf의 점수 입력. 모든 시계열을 먼저 sliceAsOf로 자른다: 이 함수 안에서는 asOf 뒤의 점을 볼 수 없다(미래 정보 차단).
export function buildScoreInput(b:ProductBundle,asOf:string):ScoreInput{
 const T=timeOf(asOf),frozen=b.series.map(s=>sliceAsOf(s,asOf)).filter(s=>s.points.some(p=>p.value!==null));
 const find=(key:string,metric:string)=>frozen.find(s=>s.subjectKey===key&&s.metric===metric)??null;
 const primary=b.keywordKeys[0];
 const trendSeries=primary?find(primary,'search_trend'):null;
 const trend=trendSeries?analyzeTrend(trendSeries.points):null;
 // 수요: 키워드마다 데이터랩 상대값을 검색광고 30일 실측으로 보정한 현재 30일 검색량을 더한다. 추세가 없으면 45일 안의 실측을 그대로 쓴다.
 const vols:number[]=[],dEv:string[]=[];
 for(const k of b.keywordKeys){
  const rel=find(k,'search_trend'),anc=find(k,'search_volume_month');if(!anc)continue;
  const cal=rel?calibrateTrend(rel.points,anc.points):null,cur=currentVolume(cal);
  if(cur!==null&&cal&&rel){vols.push(cur);dEv.push(cal.anchor.snapshotId,rel.points[rel.points.length-1].snapshotId);continue}
  const last=latestValue(anc.points);if(last&&T-timeOf(last.at)<=45*DAY_MS){vols.push(last.value as number);dEv.push(last.snapshotId)}
 }
 const volume=vols.length?vols.reduce((a,c)=>a+c,0):null;
 // 순위: 지금(최근 값)과 28일 전에 가장 가까운 과거 값.
 let rank:ScoreInput['rank']=null;
 for(const k of b.listingKeys){
  const s=find(k,'rank');if(!s)continue;const ok=s.points.filter(p=>p.value!==null&&(p.value as number)>0),cur=ok[ok.length-1],prev=[...ok].reverse().find(p=>timeOf(p.at)<=timeOf(cur.at)-28*DAY_MS)??null;
  const recent=ok.filter(p=>timeOf(p.at)>T-12*7*DAY_MS),ts=recent.length>=4?theilSen(recent.map(p=>(timeOf(p.at)-T)/(7*DAY_MS)),recent.map(p=>Math.log(p.value as number))):null;
  rank={current:cur.value,previous:prev?prev.value:null,slope:ts?ts.slope:null,evidence:[cur.snapshotId,...(prev?[prev.snapshotId]:[])]};break;
 }
 // 영상: 대표 키워드로 추적하는 영상 묶음의 누적 조회수 → 하루 증가 속도.
 let video:ScoreInput['video']=null;
 if(primary){const views=find(primary,'video_views'),count=find(primary,'video_count');
  if(views||count){const vel=views?videoViewVelocity(views.points):[],cp=count?latestValue(count.points):null,ev=[...vel.slice(-3).map(p=>p.snapshotId),...(cp?[cp.snapshotId]:[])];
   video={velocity:meanIn(vel,T-14*DAY_MS,T),previousVelocity:meanIn(vel,T-42*DAY_MS,T-28*DAY_MS),videoCount:cp?cp.value:null,evidence:ev}}}
 const compIn=primary?competitionInputFromSeries(frozen,primary,asOf):null;
 const competition=compIn&&(compIn.sellerCount!==null||compIn.productCount!==null||compIn.adCompetition!==null||compIn.listings.length)?assessCompetition(compIn):null;
 return {productId:b.productId,asOf,demand:volume===null?null:{monthlyVolume:Math.round(volume),keywords:[...b.keywords],evidence:uniq(dEv)},trend,rank,video,competition,
  profit:b.profit?simulateProfit(b.profit):null,feasibility:b.feasibility,brandFit:b.brandFit,risk:assessRisk(b.risk),sources:uniq(frozen.map(s=>s.sourceId)) as SourceId[]};
}
export const scoreBundle=(b:ProductBundle,asOf:string,opts:{weightsVersion?:string;computedAt:string})=>scoreCard(buildScoreInput(b,asOf),opts);

// 트랙 R R6a 모집 퍼널·채널 CPL·계약당 비용·speed-to-lead·주간 보고 순수 모듈. 계산만 한다: 저장·API·화면·kind·스위치·권한은 R6b(서버)·R6c(화면)가 맡는다.
// 모듈은 시계·난수·조회·모델을 쓰지 않는다(LLM 호출 0). 현재 시각(asOf)·리드·코드 장부·비용 행·거부 시도·증빙 완결 여부는 모두 인자로 받는다.
// 귀속·비용 기간 합계는 R5 순수 함수(attributeLead·spendInWindow·alignedWindow·receivedAtOf)를 수정 없이 부른다(R5 명세 2.4·2.5·2.7.4의 R6 규칙).
// 작은 표본(H12·DP-10): 1~4건 칸은 억제하고(0은 보인다), 비율은 분모 20 미만이면 숨긴다. 1~4건 채널은 한 줄로 합친다. 보완 억제(합계에서 역산 막기)는 하지 않는다.
// 대표 결정 36(2026-09-27, DP-10 예외): 계약 건수(코호트 계약과 같은 값인 코호트 '계약' 단계 칸·보고 주 계약·계약 리드·증빙 완결)는 1건부터 보이고, 계약당 비용은 계약 20건 전에도 '지출 합계 / 계약 N건'과 '표본 부족'을 함께 보인다.
// 모든 보고에 귀속≠증분과 'COLLECTIVE 휴리스틱 · 법률 자문 아님'을 붙인다. 예상매출·수익·회수기간은 만들지 않는다(설계 원칙 8).
import {GATE_DISCLAIMER,type LeadStage} from './franchise-gates';
import {isDate,isInstant,parseInstant,toKstDate,addDays,FRANCHISE_RULES,type FranchiseRule} from './franchise-rules';
import {RECRUITMENT_CHANNELS,RECRUITMENT_CHANNEL_LABELS,RECRUITMENT_ATTRIBUTION_NOTE,PLATFORM_REPORTED_NOTE,NO_PRORATION_NOTE,RECRUITMENT_VERSION,attributeLead,receivedAtOf,spendInWindow,alignedWindow,
 type CodeBook,type LeadCodes,type LeadAttribution,type SpendRow,type PlatformMetrics} from './franchise-recruitment';
import {STAGE_LABELS,stageOrder,csvFile} from './franchise';

// ── 버전·기준·고정 문구 ──
export const REPORT_VERSION='fr-report@2026-09-27.3';
export const REPORT_SCHEMA='collective.recruitment-report.v1';
export const RATIO_MIN_N=20,SUPPRESS_BELOW=5,COHORT_MATURE_DAYS=90,RULE_STALE_DAYS=180,COHORT_MONTHS=6;
export const SUPPRESSED_LABEL='5건 미만';
export const SMALL_SAMPLE_LABEL='표본 부족';
export const SMALL_CHANNELS_KEY='_small',SMALL_CHANNELS_LABEL='5건 미만 채널 합침';
export const PROVIDER_TIME_LABEL='제공처 시각',SERVER_TIME_LABEL='서버 접수 시각';
export const STL_REFERENCE_NOTE='speed-to-lead 1시간은 미국 참고치입니다(한국 공개 통계를 찾지 못했습니다). 목표가 아니고, 목표는 첫 4주 실측 뒤 정합니다.';
export const CONTRACT_SHOWN_NOTE='계약 건수와 계약당 비용은 1건부터 그대로 적습니다(대표 결정 36, DP-10 예외: 본부가 이미 아는 자기 계약). 확정본을 밖으로 보내면 계약 상대를 특정할 수 있으니, 내려받은 파일은 내려받은 사람이 관리합니다.';
export const QUALIFIED_NOTE='적격 리드당 비용은 비워 둡니다. 적격 기준 버전을 적용한 사람의 적격 판정 기록이 아직 없습니다(적격 점수는 보드 정렬용이라 쓰지 않습니다).';
export const REPORT_NOTES:readonly string[]=Object.freeze([
 RECRUITMENT_ATTRIBUTION_NOTE,
 '자동 판정 아님: 리드 원장·모집 비용·코드 장부를 정해진 규칙으로 모은 집계입니다. 채널의 좋고 나쁨이나 원인을 판정하지 않으며, 판단은 대표가 합니다. 모델 호출은 0건입니다.',
 `작은 표본: 분모가 ${RATIO_MIN_N}건 미만인 비율과 CPL·계약당 비용은 숨기고 '${SMALL_SAMPLE_LABEL}'으로 적습니다.`,
 `1~4건 칸은 '${SUPPRESSED_LABEL}'으로 억제하고, 1~4건 채널은 한 줄로 합칩니다(DP-10). 0건은 그대로 적습니다. 계약 칸은 억제하지 않습니다(대표 결정 36).`,
 CONTRACT_SHOWN_NOTE,
 `${PLATFORM_REPORTED_NOTE}: 광고 계정이 보고한 노출·클릭·양식 제출은 따로 적고 CPL 계산에 쓰지 않습니다.`,
 NO_PRORATION_NOTE,
 '단계·첫 연락·계약은 집계 시점(asOf)의 리드 기록 기준입니다. 계약당 비용은 문의 월 코호트이고, 문의 월 말일부터 90일이 지나기 전 코호트는 미성숙입니다.',
]);

// ── 주(KST ISO 주, 월~일). 날짜 문자열만 다룬다 ──
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/,DAY_MS=864e5;
const dayMs=(date:string)=>Date.parse(date+'T00:00:00Z'),mondayIndex=(t:number)=>(new Date(t).getUTCDay()+6)%7;
const week1Monday=(year:number)=>{const jan4=Date.UTC(year,0,4);return jan4-mondayIndex(jan4)*DAY_MS};
export function isoWeekOfDate(date:string):string{
 if(!DATE_RE.test(date)||!isDate(date))throw new RangeError('report_date');
 const t=dayMs(date),thursday=t+(3-mondayIndex(t))*DAY_MS,year=new Date(thursday).getUTCFullYear();
 return `${year}-W${String(Math.floor((thursday-week1Monday(year))/(7*DAY_MS))+1).padStart(2,'0')}`;
}
export type ReportWeek={week:string;from:string;to:string;timeZone:'Asia/Seoul'};
export function reportWeek(week:string):ReportWeek|null{
 const m=typeof week==='string'?/^(\d{4})-W(\d{2})$/.exec(week):null;
 if(!m||Number(m[2])<1)return null;
 const from=new Date(week1Monday(Number(m[1]))+(Number(m[2])-1)*7*DAY_MS).toISOString().slice(0,10);
 return isoWeekOfDate(from)===week?{week,from,to:addDays(from,6),timeZone:'Asia/Seoul'}:null;
}
const monthEnd=(month:string)=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
const monthShift=(month:string,n:number)=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-1+n,1)).toISOString().slice(0,7);

// ── 칸·비율 ──
export type Cell={n:number|null;suppressed:boolean};
export type RateState='shown'|'small_sample'|'suppressed'|'none';
export type Rate={value:number|null;state:RateState};
export const cell=(n:number):Cell=>n>0&&n<SUPPRESS_BELOW?{n:null,suppressed:true}:{n,suppressed:false};
// 계약 칸(대표 결정 36): 억제하지 않는다.
export const contractCell=(n:number):Cell=>({n,suppressed:false});
// 계약 단계 비율: 분모 20 미만은 숨기지만(그대로), 분자 1~4건은 억제하지 않는다(분자가 보이는 계약 칸이다).
function contractRate(num:number,den:number):Rate{return den>0&&den>=RATIO_MIN_N?{value:round(num/den,4),state:'shown'}:rate(num,den)}
const round=(x:number,digits:number)=>{const f=10**digits;return Math.round(x*f)/f};
export function rate(num:number,den:number):Rate{
 if(den<=0)return {value:null,state:'none'};
 if(den<RATIO_MIN_N)return {value:null,state:'small_sample'};
 if(num>0&&num<SUPPRESS_BELOW)return {value:null,state:'suppressed'};
 return {value:round(num/den,4),state:'shown'};
}
// 금액 비율(CPL·계약당 비용): 분모 20 미만은 나누지 않는다. 계약당 비용만 예외로 20 미만에도 나누고 지출 합계·계약 수와 '표본 부족'을 함께 둔다(small_sample_shown, 대표 결정 36).
export type CostState='shown'|'no_spend'|'no_leads'|'no_contracts'|'straddling'|'small_sample'|'small_sample_shown';
export type Cost={value:number|null;state:CostState;spend?:number;contracts?:number};
function costOf(spend:number|null,den:number,state:'known'|'no_spend'|'straddling',zero:'no_leads'|'no_contracts'):Cost{
 if(state!=='known')return {value:null,state};
 if(spend===null)return {value:null,state:'no_spend'};
 if(den<=0)return {value:null,state:zero};
 if(den<RATIO_MIN_N)return zero==='no_contracts'?{value:Math.round(spend/den),state:'small_sample_shown',spend,contracts:den}:{value:null,state:'small_sample'};
 return {value:Math.round(spend/den),state:'shown'};
}

// ── 입력 ──
export type ReportLeadInput={id:string;brandId:string;stage:string;closedFrom:string|null;createdAt:string;receivedAt?:string;receivedPrecision?:'time'|'day';importId?:string;
 firstContactAt:string|null;contractedAt:string|null;codes?:readonly {code:string;at:string;source?:'manual'|'import'}[];codeStrikes?:readonly {code:string;at:string}[];
 imports?:readonly {importId:string;channel:string;eventId:string|null;merged:boolean}[]};
export type ReportSpendRow=SpendRow&{platform?:PlatformMetrics|null};
export type ReportInput={brandId:string;week:string;asOf:string;leads:readonly unknown[];book:CodeBook;spend:readonly unknown[];blockedAttempts:readonly unknown[];contractEvidence:readonly unknown[];rules?:readonly FranchiseRule[]};
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const str=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
const leadOk=(l:unknown):l is ReportLeadInput=>isRecord(l)&&str(l.id)&&str(l.brandId)&&str(l.stage)&&isInstant(l.createdAt)&&(l.firstContactAt===null||l.firstContactAt===undefined||isInstant(l.firstContactAt))&&(l.contractedAt===null||l.contractedAt===undefined||isInstant(l.contractedAt));
// 가져온 리드는 리드를 만든 가져오기(병합 아님)의 채널로 제공처 파일 기준 귀속을 받는다(R5 명세 2.7.3, 서버 importOf와 같다).
export function reportLeadCodes(l:ReportLeadInput):LeadCodes{
 const imp=l.importId?(l.imports??[]).find(x=>x.importId===l.importId&&!x.merged):undefined;
 return {brandId:l.brandId,receivedAt:receivedAtOf(l),codes:(l.codes??[]).map(c=>({code:c.code,at:c.at,source:c.source})),strikes:(l.codeStrikes??[]).map(s=>({code:s.code,at:s.at})),
  import:imp?{importId:imp.importId,channel:imp.channel,eventId:imp.eventId??null}:null};
}
type Lead={l:ReportLeadInput;received:string;receivedDate:string;attribution:LeadAttribution;imported:boolean};
const kstDateOf=(at:string)=>isInstant(at)?toKstDate(at):'';
const reached=(l:ReportLeadInput)=>stageOrder(l.stage==='closed'?(l.closedFrom??'inquiry'):l.stage);

// ── 유입(보고 주 접수) ──
export type ChannelInflow={key:string;label:string;channels:string[];channelLabels:string[];merged:boolean;code:Cell;file:Cell;total:Cell};
// 코드·파일 둘 중 한쪽이 1~4건이면 두 칸을 모두 억제한다(줄 합계에서 빼서 역산하지 못하게).
function splitCells(code:number,file:number){const small=(n:number)=>n>0&&n<SUPPRESS_BELOW;return small(code)||small(file)?{code:{n:null,suppressed:true},file:{n:null,suppressed:true}}:{code:cell(code),file:cell(file)}}
function inflowChannels(week:readonly Lead[]):ChannelInflow[]{
 const counts=RECRUITMENT_CHANNELS.map(c=>{const mine=week.filter(x=>x.attribution.state==='attributed'&&x.attribution.channel===c.key);const code=mine.filter(x=>x.attribution.state==='attributed'&&x.attribution.basis==='code').length;return {key:c.key,label:c.label,code,file:mine.length-code}}).filter(c=>c.code+c.file>0);
 const big=counts.filter(c=>c.code+c.file>=SUPPRESS_BELOW),small=counts.filter(c=>c.code+c.file<SUPPRESS_BELOW);
 const rows:ChannelInflow[]=big.map(c=>({key:c.key,label:c.label,channels:[c.key],channelLabels:[c.label],merged:false,...splitCells(c.code,c.file),total:cell(c.code+c.file)}));
 if(!small.length)return rows;
 const code=small.reduce((s,c)=>s+c.code,0),file=small.reduce((s,c)=>s+c.file,0);
 return [...rows,{key:SMALL_CHANNELS_KEY,label:SMALL_CHANNELS_LABEL,channels:small.map(c=>c.key),channelLabels:small.map(c=>c.label),merged:true,...splitCells(code,file),total:cell(code+file)}];
}
function inflowOf(week:readonly Lead[]){
 const n=(f:(x:Lead)=>boolean)=>week.filter(f).length,att=(x:Lead)=>x.attribution;
 const code=n(x=>att(x).state==='attributed'&&(att(x) as {basis:string}).basis==='code'),file=n(x=>att(x).state==='attributed'&&(att(x) as {basis:string}).basis==='import');
 const flag=(k:'retroactive'|'late')=>n(x=>{const a=att(x);return a.state==='attributed'&&a.basis==='code'&&a[k]});
 return {total:cell(week.length),manual:cell(n(x=>!x.imported)),imported:cell(n(x=>x.imported)),code:cell(code),file:cell(file),unattributed:cell(n(x=>att(x).state==='unattributed')),conflict:cell(n(x=>att(x).state==='conflict')),
  retroactive:cell(flag('retroactive')),late:cell(flag('late')),attributedRate:rate(code+file,week.length),channels:inflowChannels(week)};
}

// ── 비용(보고 주 창) ──
export type ChannelCost={key:string;label:string;spend:number|null;spendRows:number;straddling:number;aligned:{from:string;to:string}|null;leads:Cell;leadsCode:Cell;cpl:Cost;cplCode:Cost};
export type PlatformRow={key:string;label:string;impressions:number|null;clicks:number|null;formSubmits:number|null;note:string};
const sumKnown=(xs:readonly (number|null|undefined)[])=>xs.some(x=>typeof x==='number')?xs.reduce<number>((s,x)=>s+(typeof x==='number'?x:0),0):null;
function costOf_(week:readonly Lead[],spend:readonly ReportSpendRow[],w:ReportWeek,asOf:string){
 const win=spendInWindow(spend,w.from,w.to,{asOf}),keys=RECRUITMENT_CHANNELS.map(c=>c.key);
 const leadsOf=(ch:string,codeOnly:boolean)=>week.filter(x=>x.attribution.state==='attributed'&&x.attribution.channel===ch&&(!codeOnly||x.attribution.basis==='code')).length;
 const channels:ChannelCost[]=keys.filter(k=>win.byChannel[k]||leadsOf(k,false)>0).map(k=>{
  const s=win.byChannel[k],straddling=s?.straddlingCount??0,state=straddling>0?'straddling' as const:'known' as const,total=s?s.total:null,all=leadsOf(k,false),codeOnly=leadsOf(k,true);
  const aligned=straddling>0?alignedWindow(spend,k,w.from,w.to,{asOf}):null;
  return {key:k,label:RECRUITMENT_CHANNEL_LABELS[k],spend:total,spendRows:s?.rowCount??0,straddling,aligned:aligned?{from:aligned.from,to:aligned.to}:null,leads:cell(all),leadsCode:cell(codeOnly),cpl:costOf(total,all,state,'no_leads'),cplCode:costOf(total,codeOnly,state,'no_leads')};
 });
 const included=new Set(win.included.map(r=>r.id)),rows=spend.filter(r=>included.has(r.id));
 const platform:PlatformRow[]=keys.flatMap(k=>{const mine=rows.filter(r=>r.channel===k).map(r=>r.platform??null);
  const row={key:k,label:RECRUITMENT_CHANNEL_LABELS[k],impressions:sumKnown(mine.map(p=>p?.impressions)),clicks:sumKnown(mine.map(p=>p?.clicks)),formSubmits:sumKnown(mine.map(p=>p?.formSubmits)),note:PLATFORM_REPORTED_NOTE};
  return row.impressions===null&&row.clicks===null&&row.formSubmits===null?[]:[row]});
 return {window:{from:w.from,to:w.to},totalSpend:win.included.reduce((s,r)=>s+r.amountExVat,0),straddlingRows:win.straddling.length,channels,platform,qualified:{value:null,note:QUALIFIED_NOTE}};
}

// ── speed-to-lead(보고 주 접수) ──
export type SpeedGroup={basis:'server'|'provider';label:string;received:Cell;contacted:Cell;uncontacted:Cell;excludedNegative:number;medianMinutes:number|null;medianState:'shown'|'suppressed'|'none';contactedRate:Rate};
const median=(xs:readonly number[])=>{const s=[...xs].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2};
function speedGroup(basis:'server'|'provider',leads:readonly Lead[],asOfMs:number):SpeedGroup{
 const contacted:number[]=[];let uncontacted=0,negative=0;
 for(const x of leads){
  const first=x.l.firstContactAt,t=first&&isInstant(first)?parseInstant(first):null;
  if(t===null||t>asOfMs){uncontacted++;continue}
  const minutes=(t-parseInstant(x.received))/6e4;
  if(minutes<0){negative++;continue}
  contacted.push(minutes);
 }
 const shown=contacted.length>=SUPPRESS_BELOW;
 return {basis,label:basis==='server'?SERVER_TIME_LABEL:PROVIDER_TIME_LABEL,received:cell(leads.length),contacted:cell(contacted.length),uncontacted:cell(uncontacted),excludedNegative:negative,
  medianMinutes:shown?round(median(contacted),1):null,medianState:shown?'shown':contacted.length?'suppressed':'none',contactedRate:rate(contacted.length,contacted.length+uncontacted)};
}
function speedOf(week:readonly Lead[],asOfMs:number){
 const provider=week.filter(x=>x.imported),dayOnly=provider.filter(x=>x.l.receivedPrecision==='day');
 return {groups:[speedGroup('server',week.filter(x=>!x.imported),asOfMs),speedGroup('provider',provider.filter(x=>x.l.receivedPrecision!=='day'),asOfMs)],excludedDayPrecision:cell(dayOnly.length),referenceNote:STL_REFERENCE_NOTE};
}

// ── 문의 월 코호트·계약당 비용 ──
export const FUNNEL_STAGES:readonly LeadStage[]=Object.freeze(['contacted','consulted','briefing','disclosed','draft_provided','contracted','fee_escrowed','opened'] as LeadStage[]);
export type CohortStage={stage:LeadStage;label:string;reached:Cell;rate:Rate};
export type Cohort={month:string;from:string;to:string;mature:boolean;size:Cell;stages:CohortStage[];closed:Cell;contracts:Cell;spend:number|null;spendState:'known'|'no_spend'|'straddling';costPerContract:Cost};
function cohortOf(month:string,leads:readonly Lead[],spend:readonly ReportSpendRow[],asOf:string):Cohort{
 const from=month+'-01',to=monthEnd(month),mine=leads.filter(x=>x.receivedDate>=from&&x.receivedDate<=to);
 const stages=FUNNEL_STAGES.map(s=>{const n=mine.filter(x=>reached(x.l)>=stageOrder(s)).length,c=s==='contracted';return {stage:s,label:STAGE_LABELS[s],reached:c?contractCell(n):cell(n),rate:c?contractRate(n,mine.length):rate(n,mine.length)}});
 const contracts=mine.filter(x=>reached(x.l)>=stageOrder('contracted')).length,win=spendInWindow(spend,from,to,{asOf}),chans=Object.values(win.byChannel);
 const spendState=win.straddling.length?'straddling' as const:chans.length?'known' as const:'no_spend' as const,total=chans.length?chans.reduce((s,c)=>s+c.total,0):null;
 return {month,from,to,mature:addDays(to,COHORT_MATURE_DAYS)<=toKstDate(asOf),size:cell(mine.length),stages,closed:cell(mine.filter(x=>x.l.stage==='closed').length),contracts:contractCell(contracts),
  spend:total,spendState,costPerContract:costOf(total,contracts,spendState,'no_contracts')};
}

// ── 법정 게이트·규칙 신선도 ──
function gatesOf(leads:readonly Lead[],w:ReportWeek,blocked:readonly unknown[],evidence:readonly unknown[]){
 const contracted=leads.filter(x=>x.l.contractedAt),ids=new Set(contracted.map(x=>x.l.id));
 const complete=new Set(evidence.filter((e):e is {leadId:string;complete:boolean}=>isRecord(e)&&str(e.leadId)&&e.complete===true).map(e=>e.leadId).filter(id=>ids.has(id)));
 const inWeek=(at:unknown)=>typeof at==='string'&&isInstant(at)&&kstDateOf(at)>=w.from&&kstDateOf(at)<=w.to;
 return {contractsInWeek:contractCell(contracted.filter(x=>inWeek(x.l.contractedAt)).length),blockedAttempts:blocked.filter(b=>isRecord(b)&&inWeek(b.at)).length,contracted:contractCell(contracted.length),evidenceComplete:contractCell(complete.size)};
}
function rulesOf(rules:readonly FranchiseRule[],asOf:string){
 const live=rules.filter(r=>isRecord(r)&&r.status!=='proposed'),cutoff=parseInstant(asOf)-RULE_STALE_DAYS*DAY_MS;
 const stale=live.filter(r=>!isInstant(r.verifiedAt)||parseInstant(r.verifiedAt)<cutoff).map(r=>r.id).sort();
 return {checked:live.length,stale:stale.length,staleIds:stale};
}

// ── 보고서 ──
export type RecruitmentReport=ReturnType<typeof buildRecruitmentReport>;
function leadsOf(input:ReportInput,asOfMs:number){
 const all=(Array.isArray(input.leads)?input.leads:[]).filter(leadOk);
 const mine=all.filter(l=>l.brandId===input.brandId),live=mine.filter(l=>parseInstant(l.createdAt)<=asOfMs);
 const leads:Lead[]=live.map(l=>{const received=receivedAtOf(l);return {l,received,receivedDate:kstDateOf(received),attribution:attributeLead(reportLeadCodes(l),input.book,{asOf:input.asOf}),imported:!!l.importId}}).filter(x=>x.receivedDate);
 return {leads,excluded:{otherBrand:all.length-mine.length,afterAsOf:mine.length-live.length}};
}
export function buildRecruitmentReport(input:ReportInput){
 const w=reportWeek(input?.week);
 if(!w||!isInstant(input.asOf)||w.from>toKstDate(input.asOf))throw new RangeError('report_input');
 const asOfMs=parseInstant(input.asOf),{leads,excluded}=leadsOf(input,asOfMs);
 const spend=(Array.isArray(input.spend)?input.spend:[]).filter((r):r is ReportSpendRow=>isRecord(r)&&str(r.id)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const week=leads.filter(x=>x.receivedDate>=w.from&&x.receivedDate<=w.to),last=w.to.slice(0,7);
 return {schema:REPORT_SCHEMA,version:REPORT_VERSION,recruitmentVersion:RECRUITMENT_VERSION,brandId:input.brandId,period:w,asOf:input.asOf,notes:[...REPORT_NOTES],disclaimer:GATE_DISCLAIMER,
  thresholds:{ratioMinN:RATIO_MIN_N,suppressBelow:SUPPRESS_BELOW,cohortMatureDays:COHORT_MATURE_DAYS,ruleStaleDays:RULE_STALE_DAYS},excluded,
  inflow:inflowOf(week),cost:costOf_(week,spend,w,input.asOf),speedToLead:speedOf(week,asOfMs),
  cohorts:Array.from({length:COHORT_MONTHS},(_,i)=>cohortOf(monthShift(last,i-COHORT_MONTHS+1),leads,spend,input.asOf)),
  gates:gatesOf(leads,w,Array.isArray(input.blockedAttempts)?input.blockedAttempts:[],Array.isArray(input.contractEvidence)?input.contractEvidence:[]),
  rules:rulesOf(Array.isArray(input.rules)?input.rules:FRANCHISE_RULES,input.asOf)};
}
// 확정 대조용 원문: asOf만 뺀 보고서 JSON(키 순서는 빌더가 고정한다). 서버가 SHA-256을 낸다. 같은 데이터를 뒤에 다시 계산해도 같다.
export function reportDigestSource(r:RecruitmentReport):string{return JSON.stringify(r,(key,value)=>key==='asOf'?undefined:value)}

// ── 내보내기(Markdown·CSV). 보고서 값만 쓴다 ──
const won=(n:number)=>String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,',')+'원';
// 화면(app/franchise-report-panel.tsx)과 Markdown·CSV가 같은 표기를 쓴다.
export const cellText=(c:Cell)=>c.suppressed?SUPPRESSED_LABEL:String(c.n);
const RATE_TEXT:Readonly<Record<RateState,string>>={shown:'',small_sample:`${SMALL_SAMPLE_LABEL}(n<${RATIO_MIN_N})`,suppressed:SUPPRESSED_LABEL,none:'-'};
export const rateText=(r:Rate)=>r.state==='shown'&&r.value!==null?`${round(r.value*100,1)}%`:RATE_TEXT[r.state];
const COST_TEXT:Readonly<Record<CostState,string>>={shown:'',no_spend:'비용 모름',no_leads:'리드 0건',no_contracts:'계약 0건',straddling:'비용 기간 불일치',small_sample:`${SMALL_SAMPLE_LABEL}(n<${RATIO_MIN_N})`,small_sample_shown:`${SMALL_SAMPLE_LABEL}(n<${RATIO_MIN_N})`};
export function costText(c:Cost):string{
 if(c.state==='shown'&&c.value!==null)return won(c.value);
 if(c.state==='small_sample_shown'&&c.value!==null&&typeof c.spend==='number'&&typeof c.contracts==='number')return `${won(c.value)} (지출 합계 ${won(c.spend)} / 계약 ${c.contracts}건 · ${COST_TEXT.small_sample_shown})`;
 return COST_TEXT[c.state];
}
export const moneyText=(n:number|null)=>n===null?'비용 모름':won(n);
const num=(n:number|null)=>n===null?'모름':String(n);
type Row=[section:string,item:string,metric:string,value:string];
function reportRows(r:RecruitmentReport):Row[]{
 const i=r.inflow,c=r.cost,g=r.gates;
 return [
  ...([['total','전체'],['manual','수기 등록'],['imported','가져온 리드'],['code','코드 귀속'],['file','제공처 파일 기준'],['unattributed','유입 미확인'],['conflict','점포 코드와 같은 값'],['retroactive','소급 등록 코드'],['late','접수 72시간 뒤 입력']] as const).map(([k,label]):Row=>['유입',label,'리드',cellText(i[k])]),
  ['유입','귀속 비율','(코드+파일)/전체',rateText(i.attributedRate)],
  ...i.channels.flatMap((ch):Row[]=>[['유입 채널',ch.label,'코드 귀속',cellText(ch.code)],['유입 채널',ch.label,'제공처 파일 기준',cellText(ch.file)],['유입 채널',ch.label,'합계',cellText(ch.total)]]),
  ['비용',`${c.window.from}~${c.window.to}`,'주 안 비용 합계',won(c.totalSpend)],['비용',`${c.window.from}~${c.window.to}`,'걸친 비용 행',String(c.straddlingRows)],
  ...c.channels.flatMap((ch):Row[]=>[['채널 CPL',ch.label,'비용',moneyText(ch.spend)],['채널 CPL',ch.label,'리드(코드+파일)',cellText(ch.leads)],['채널 CPL',ch.label,'CPL(코드+파일)',costText(ch.cpl)],['채널 CPL',ch.label,'CPL(코드만)',costText(ch.cplCode)],
   ...(ch.aligned?[['채널 CPL',ch.label,'정렬 창',`${ch.aligned.from}~${ch.aligned.to}`] as Row]:[])]),
  ['채널 CPL','적격 리드당 비용','값','비움'],
  ...c.platform.flatMap((p):Row[]=>[['플랫폼 보고',p.label,'노출',num(p.impressions)],['플랫폼 보고',p.label,'클릭',num(p.clicks)],['플랫폼 보고',p.label,'양식 제출',num(p.formSubmits)]]),
  ...r.speedToLead.groups.flatMap((s):Row[]=>[['speed-to-lead',s.label,'접수',cellText(s.received)],['speed-to-lead',s.label,'첫 연락',cellText(s.contacted)],['speed-to-lead',s.label,'미응대',cellText(s.uncontacted)],
   ['speed-to-lead',s.label,'중앙값(분)',s.medianState==='shown'?String(s.medianMinutes):s.medianState==='suppressed'?SUPPRESSED_LABEL:'-'],['speed-to-lead',s.label,'첫 연락 비율',rateText(s.contactedRate)]]),
  ['speed-to-lead','제공처 시각','날짜만 있어 제외',cellText(r.speedToLead.excludedDayPrecision)],
  ...r.cohorts.flatMap((k):Row[]=>[['코호트',k.month,'문의',cellText(k.size)],['코호트',k.month,'성숙',k.mature?'성숙':'미성숙'],...k.stages.map((s):Row=>['코호트',k.month,s.label,`${cellText(s.reached)} (${rateText(s.rate)})`]),
   ['코호트',k.month,'종결',cellText(k.closed)],['코호트',k.month,'비용',k.spendState==='straddling'?'비용 기간 불일치':moneyText(k.spend)],['코호트',k.month,'계약',cellText(k.contracts)],['코호트',k.month,'계약당 비용',costText(k.costPerContract)]]),
  ['법정 게이트','보고 주','계약',cellText(g.contractsInWeek)],['법정 게이트','보고 주','서버 거부 시도',String(g.blockedAttempts)],['법정 게이트','전체','계약 리드',cellText(g.contracted)],['법정 게이트','전체','증빙 완결',cellText(g.evidenceComplete)],
  ['규칙 신선도',`${RULE_STALE_DAYS}일`,'확인 시각이 지난 규칙',`${r.rules.stale} / ${r.rules.checked}`],
 ];
}
const mdCell=(s:string)=>s.replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ');
export function reportMarkdown(r:RecruitmentReport):string{
 const head=[`# 가맹 모집 주간 보고 ${r.period.week}`,'',`- 기간: ${r.period.from} ~ ${r.period.to} (Asia/Seoul)`,`- 판: ${r.version} · 귀속 ${r.recruitmentVersion}`,`- ${r.disclaimer}`,'',...r.notes.map(n=>`- ${n}`),`- ${QUALIFIED_NOTE}`,`- ${STL_REFERENCE_NOTE}`,''];
 const rows=reportRows(r).map(([a,b,c,d])=>`| ${mdCell(a)} | ${mdCell(b)} | ${mdCell(c)} | ${mdCell(d)} |`);
 return [...head,'| 구역 | 항목 | 지표 | 값 |','|---|---|---|---|',...rows,''].join('\n');
}
export function reportCsv(r:RecruitmentReport):string{
 return csvFile(['구역','항목','지표','값'],[['보고',r.period.week,'면책',r.disclaimer],...r.notes.map((n,i)=>['보고',`문구 ${i+1}`,'고정 문구',n]),...reportRows(r)]);
}
export function reportFileName(r:Pick<RecruitmentReport,'brandId'|'period'>,format:'md'|'csv'|'json'):string{
 return `recruitment-report-${String(r.brandId).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,80)}-${r.period.week}.${format}`;
}

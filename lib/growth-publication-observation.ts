import type {Campaign} from './agency';
import type {Publication} from './execution';
import type {ViralExperiment} from './learning';
import type {MeasurementDraft,MeasurementSource} from './measurement-collection';
import {sourceView,armDraftView,STOP_REASONS} from './measurement-status';
import {channelNameForConnector} from './channels';
export type MeasurementObservation={status:'observed'|'historical'|'held';value:{denominator:number|null;numerator:number|null}|null;window:{from:string;to:string}|null;fetchedAt:string|null;definition:string;limitations:string[];source:{id:string;pending:boolean;lastFetchedAt:string|null;lastError:ReturnType<typeof sourceView>['lastError'];stopped:boolean}|null;reasons:string[]};
const count=(x:unknown)=>x===null||(typeof x==='number'&&Number.isSafeInteger(x)&&x>=0);
const instant=(x:unknown)=>typeof x==='string'&&Number.isFinite(Date.parse(x));
function day(x:unknown){if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x))return false;const n=Date.parse(x+'T00:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===x}
export function assessPublicationMeasurement({campaign:c,publication:p,experiment:e,source:s,draft:d}:{campaign:Campaign;publication:Publication|null;experiment:ViralExperiment|null;source:MeasurementSource|null;draft:MeasurementDraft|null},now=Date.now()):MeasurementObservation{
 const sv=s?sourceView(s,false):null,reasons:string[]=[];
 const source=s&&sv&&s.id===`${p?.experimentId}:${p?.arm}`?{id:s.id,pending:s.pending===true,lastFetchedAt:instant(sv.lastFetchedAt)?sv.lastFetchedAt:null,lastError:sv.lastError,stopped:s.stopped===true}:null;
 const entry=p?.arm?d?.arms?.[p.arm]:undefined,v=entry?armDraftView(entry):null;
 const ended=s?.stopped===true&&s.stoppedReason===STOP_REASONS.ended,historical=ended||e?.status==='evaluated';
 const today=new Date(now).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
 const publicationMatches=!!p&&p.campaignId===c.id&&p.status==='published';
 if(!publicationMatches)reasons.push('게시 완료 근거가 없습니다.');
 const experimentMatches=!!e&&e.id===p?.experimentId&&e.campaignId===c.id&&e.brandId===c.brandId&&e.channel===channelNameForConnector('instagram')&&e.metric==='share_rate'&&['running','evaluated'].includes(e.status);
 if(!experimentMatches)reasons.push('게시와 실험·채널·측정 지표의 연결을 확인하세요.');
 const sourceMatches=!!s&&s.id===`${p?.experimentId}:${p?.arm}`&&s.publicationId===p?.id&&s.experimentId===e?.id&&s.arm===p?.arm&&s.channel==='instagram'&&!!p?.media?.mediaId&&s.target===p.media.mediaId;
 if(!sourceMatches)reasons.push('정확한 게시물 수집 대상 근거가 없습니다.');
 if(!s||s.pending||sv?.lastError||s.stoppedFor==='reauth'||(s.failures??0)>0||(s.stopped&&!ended))reasons.push('현재 수집이 대기·실패·중단 상태입니다.');
 const draftMatches=!!d&&d.id===e?.id&&d.experimentId===e?.id&&d.channel==='instagram'&&!!entry&&entry.target===p?.media?.mediaId;
 if(!draftMatches)reasons.push('게시물에 대응하는 명시적 측정 초안이 없습니다.');
 const scope=entry?.credential;
 const validScope=!!scope&&(scope.level==='store'||scope.level==='brand');
 const scopeMatches=validScope&&!!scope&&scope.brandId===c.brandId&&(scope.level!=='store'||scope.storeId===c.storeId);
 if(!scopeMatches)reasons.push('측정한 브랜드·지점 범위가 미확인이거나 다릅니다.');
 if(!v?.value||!count(v.value.denominator)||!count(v.value.numerator)||!instant(v.fetchedAt)||Date.parse(v.fetchedAt!)>now||!instant(s?.lastFetchedAt)||Date.parse(s!.lastFetchedAt)>now||!v.window||!day(v.window.from)||!day(v.window.to)||v.window.from>v.window.to||v.window.to>today||!s?.window||v.window.from!==s.window.from||v.window.to!==s.window.to||(!ended&&v.fetchedAt!==s.lastFetchedAt))reasons.push('측정 수치·기간·성공 시각의 무결성을 확인하세요.');
 return {status:reasons.length?'held':historical?'historical':'observed',value:reasons.length?null:{denominator:v!.value!.denominator,numerator:v!.value!.numerator},window:reasons.length?null:v!.window,fetchedAt:reasons.length?null:v!.fetchedAt,definition:'Instagram 게시 이후 누적 도달 수(분모)와 공유 횟수(분자).',limitations:['선택한 주문 집계 기간과 측정 기간은 다릅니다.','전환율·증분 효과·인과 효과를 계산하지 않습니다.'],source:publicationMatches&&experimentMatches&&sourceMatches&&draftMatches&&scopeMatches?source:null,reasons};
}

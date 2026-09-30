import {scanText} from './pii-scan';
// Channel-independent planning. A ready mission is never external execution authority.
export class GrowthMissionError extends Error {}
export type MissionInput={title:string;offerId:string;offerVersion:number;assignee:string;deadline:string;nextAction:string;channel:'storefront'|'organic'|'meta'|'manual';budget:number|null;lossLimit:number|null;stopRule:string;fulfillmentOwner:string};
export type MissionReceipt={status:'unknown'|'failed'|'observed';reference:string;note:string;recordedAt:string;recordedBy:string};
export type MissionState='draft'|'staged'|'unknown'|'failed'|'observed'|'cancelled';
export function growthText(v:unknown,label:string,max=500,required=false){
 if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)||(required&&!v.trim()))throw new GrowthMissionError(`${label} 입력을 확인하세요.`);
 if(scanText(v).length)throw new GrowthMissionError(`${label}에 직접 식별정보를 넣을 수 없습니다.`);
 return v.trim();
}
export function growthDay(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new GrowthMissionError('기한을 실제 날짜로 입력하세요.');
 return Date.parse(value+'T00:00:00+09:00')+86400000;
}
export function emptyMissionInput():MissionInput{return {title:'',offerId:'',offerVersion:0,assignee:'',deadline:'',nextAction:'',channel:'manual',budget:null,lossLimit:null,stopRule:'',fulfillmentOwner:''}}
export function parseMissionInput(value:unknown):MissionInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new GrowthMissionError('판매 미션 형식을 확인하세요.');
 const b=value as Record<string,unknown>;
 const text=Object.fromEntries(['title','offerId','assignee','deadline','nextAction','stopRule','fulfillmentOwner'].map(k=>[k,growthText(b[k],k,500,k==='title')]));
 if(text.deadline)growthDay(text.deadline);
 if(!['storefront','organic','meta','manual'].includes(String(b.channel)))throw new GrowthMissionError('판매 채널을 확인하세요.');
 if(!Number.isSafeInteger(b.offerVersion)||Number(b.offerVersion)<0)throw new GrowthMissionError('오퍼 버전을 확인하세요.');
 for(const k of ['budget','lossLimit'])if(b[k]!==null&&(typeof b[k]!=='number'||!Number.isSafeInteger(b[k])||Number(b[k])<0||Number(b[k])>1e12))throw new GrowthMissionError('예산·손실 한도는 원 단위 정수로 입력하세요.');
 if(b.budget!==null&&b.lossLimit!==null&&Number(b.lossLimit)>Number(b.budget))throw new GrowthMissionError('손실 한도는 총예산 이하여야 합니다.');
 return {...text,channel:b.channel,offerVersion:b.offerVersion,budget:b.budget,lossLimit:b.lossLimit} as MissionInput;
}
export function missionReadiness(input:MissionInput,upstream:string[],now=Date.now()){
 const labels={offerId:'판매 오퍼',assignee:'실행 담당',deadline:'실행 기한',nextAction:'다음 행동',stopRule:'중단 기준',fulfillmentOwner:'배송·반품 담당'};
 const missing=[...upstream,...Object.entries(labels).filter(([k])=>!input[k as keyof MissionInput]).map(([,label])=>label)];
 if(input.deadline&&growthDay(input.deadline)<=now)missing.push('실행 기한 경과');
 if(input.budget===null)missing.push('탐색 예산 한도');
 if(input.lossLimit===null)missing.push('탐색 손실 한도');
 return {missing:[...new Set(missing)],mayExecute:false as const};
}

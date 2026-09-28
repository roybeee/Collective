export type MetaCapiState='queued'|'sending'|'unknown'|'accepted'|'rejected'|'blocked';
export type MetaPixelEnvelope={datasetId:string;eventId:string;eventName:'Purchase';value:number;currency:'KRW';expiresAt:number};
export type MetaCapiPublic={enabled:boolean;connection:{datasetId:string;origin:string;version:number;connected:boolean}|null;operations:{id:string;state:MetaCapiState;attempts:number;version:number;updatedAt:string;reason:string;nextAttemptAt:number}[]};
// Call only in the purchaser's browser after its consent manager confirms advertising measurement.
// The storefront server obtains a fresh envelope; never embed a COLLECTIVE credential in browser code.
export function dispatchMetaPurchasePixel(envelope:MetaPixelEnvelope,fbq:(...args:unknown[])=>void,advertisingConsent:boolean,now=Date.now()){
 if(!advertisingConsent||envelope.expiresAt<=now||envelope.expiresAt>now+300000||!/^\d{5,30}$/.test(envelope.datasetId)||!/^purchase_[A-Za-z0-9_-]+$/.test(envelope.eventId)||envelope.eventName!=='Purchase'||envelope.currency!=='KRW'||!Number.isSafeInteger(envelope.value)||envelope.value<=0)return false;
 fbq('trackSingle',envelope.datasetId,'Purchase',{value:envelope.value,currency:envelope.currency},{eventID:envelope.eventId});return true;
}

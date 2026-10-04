import {deliveryUuid} from './growth-consumer-delivery';
export type CsSourceInput={id:string;customerId:string;sourceKey:string;externalOrderId:string;sourceDigest:string;receivedAt:string;status:'open'|'closed'|'withdrawn';category:'product_question'|'other'};
export type CsSource=CsSourceInput&{brandId:string;campaignId:string;storeId:string;version:number;erased?:boolean;provider:{tenantId:string;storeId:string};order:{id:string;version:number;linkId:string;linkRevision:number};customerVersion:number;ticketVersion:number;updatedAt:string};
export function parseCsSource(x:unknown):CsSourceInput{
 if(!x||typeof x!=='object'||Array.isArray(x))throw new Error('invalid_source');const r=x as CsSourceInput;
 if(Object.keys(r).sort().join(',')!=='category,customerId,externalOrderId,id,receivedAt,sourceDigest,sourceKey,status'||!deliveryUuid(r.id)||!deliveryUuid(r.customerId)||typeof r.sourceKey!=='string'||!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(r.sourceKey)||typeof r.externalOrderId!=='string'||!/^MD-\d{8}-[A-F0-9]{6}$/.test(r.externalOrderId)||typeof r.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(r.sourceDigest)||!['open','closed','withdrawn'].includes(r.status)||!['product_question','other'].includes(r.category)||typeof r.receivedAt!=='string'||!Number.isFinite(Date.parse(r.receivedAt))||Date.parse(r.receivedAt)>Date.now()+60000)throw new Error('invalid_source');return {...r};
}

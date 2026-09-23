import type {ChannelKey,Store,StoreMeasurement} from './store-marketing';

export const diagnosisCatalog=[
 {key:'customer',title:'고객과 이용 상황',prompt:'누가 어떤 상황에서 구매하나요?',hint:'관찰한 시간·장소, 고객이 말한 방문 이유, 우선 고객을 기록하세요.'},
 {key:'offer',title:'상품과 남는 이익',prompt:'무엇을 얼마에 팔고 얼마를 남기나요?',hint:'대표 메뉴나 2인·포장 구성의 양·총액·원가·혜택 비용을 확인하세요.'},
 {key:'access',title:'입구와 주문 경로',prompt:'처음 온 고객이 찾고 주문할 수 있나요?',hint:'정확한 동호수·입구 사진·실제 보행 동선·모바일 주문 수신을 확인하세요.'},
 {key:'capacity',title:'제공 가능한 주문량',prompt:'약속한 시간에 제공할 수 있나요?',hint:'홀·포장·배달을 합친 피크 주문량, 준비 시간, 품절·지연 시 조치를 정하세요.'},
 {key:'tracking',title:'구매 성과 확인',prompt:'어디서 온 주문인지 확인할 수 있나요?',hint:'주문번호·쿠폰·POS 출처와 추적할 수 없는 범위를 기록하세요.'},
 {key:'retention',title:'다시 방문할 이유',prompt:'첫 구매 다음에는 무엇을 제안하나요?',hint:'첫 구매 상황별 다음 제안과 재구매 관찰 방법을 정하세요.'},
] as const;
export type DiagnosisKey=typeof diagnosisCatalog[number]['key'];
export type StoreDiagnostic={id:string;storeId:string;key:DiagnosisKey;status:'unknown'|'todo'|'done';observation:string;evidence:string;checkedAt:string;nextAction:string;assignee:string;storeVersion:number;version:number;updatedAt:string};
export const orderSources={pos:'POS',naver:'네이버 주문',daangn:'당근 주문',baemin:'배달의민족',coupang:'쿠팡이츠',yogiyo:'요기요',ddangyo:'땡겨요',direct:'직접 주문',other:'기타'} as const;
export const orderModes={hall:'홀',pickup:'포장',delivery:'배달',group:'단체'} as const;
export const orderStates={paid:'결제 완료',cancelled:'취소',refunded:'전액 환불'} as const;
export const orderCostFields={foodCost:'식재료 원가',packagingCost:'포장 원가',fees:'결제·플랫폼 수수료',deliveryCost:'매장 부담 배달비',benefitCost:'증정·기타 변동비'} as const;
// A4 주문 CSV 가져오기가 더하는 선택 필드: importId(가져오기 기록)·discountAmount(할인액, 결제액과 별도)·trackingCodes(행에서 읽은 코드)·newCustomer(신규 여부)·codeAttribution(코드 자동 귀속 사본).
export type CodeAttribution={codeId:string;code:string;arm?:string;publicationId?:string;conflictCodeIds:string[]};
export type StoreOrder={campaignId?:string;creativeId?:string;importId?:string;discountAmount?:number;trackingCodes?:string[];newCustomer?:boolean;codeAttribution?:CodeAttribution;id:string;storeId:string;source:keyof typeof orderSources;orderNumber:string;orderDate:string;mode:keyof typeof orderModes;status:keyof typeof orderStates;paidAmount:number;refundAmount:number;costs:Record<keyof typeof orderCostFields,number|null>;channel:ChannelKey|'unknown';experimentId:string;attributionEvidence:string;note:string;version:number;createdAt:string;updatedAt:string};
export type StoreSpend={id:string;storeId:string;date:string;channel:ChannelKey;experimentId:string;adSpend:number;productionCost:number;source:string;version:number;createdAt:string;updatedAt:string};
export type LedgerSnapshot={capturedAt:string;orderRefs:{id:string;version:number}[];spendRefs:{id:string;version:number}[];costsConfirmed:boolean};
export type StoreOperations={diagnostics:StoreDiagnostic[];orders:StoreOrder[];spend:StoreSpend[];from:string;to:string};
export const emptyOperations:StoreOperations={diagnostics:[],orders:[],spend:[],from:'',to:''};
export function koreaToday(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'})}
export function recentPeriod(){const to=koreaToday();const d=new Date(to+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-29);return {from:d.toISOString().slice(0,10),to}}
export function diagnosisStatus(record:StoreDiagnostic|undefined,store:Store){return !record?'unknown':record.storeVersion!==store.version?'stale':record.status}
export function orderContribution(order:StoreOrder){return Object.values(order.costs).some(x=>x===null)?null:order.paidAmount-order.refundAmount-Object.values(order.costs).reduce<number>((n,v)=>n+(v??0),0)}
export function ledgerSummary(orders:StoreOrder[],spend:StoreSpend[]){
 const paid=orders.filter(o=>o.status==='paid'&&(o.paidAmount===0||o.refundAmount<o.paidAmount)),known=orders.filter(o=>orderContribution(o)!==null);
 const variableCosts=known.reduce((sum,o)=>sum+Object.values(o.costs).reduce<number>((n,v)=>n+(v??0),0),0);
 const netRevenue=orders.reduce((sum,o)=>sum+o.paidAmount-o.refundAmount,0),adSpend=spend.reduce((n,s)=>n+s.adSpend,0),productionCost=spend.reduce((n,s)=>n+s.productionCost,0);
 return {records:orders.length,orders:paid.length,cancelled:orders.filter(o=>o.status==='cancelled').length,refunded:orders.filter(o=>o.status==='refunded').length,netRevenue,knownCosts:known.length,variableCosts:known.length===orders.length?variableCosts:null,contribution:known.length===orders.length?netRevenue-variableCosts:null,adSpend,productionCost,recordedBalance:known.length===orders.length?netRevenue-variableCosts-adSpend-productionCost:null,attributed:paid.filter(o=>o.channel!=='unknown'||!!o.campaignId||!!o.creativeId).length};
}
export function ledgerSnapshot(orders:StoreOrder[],spend:StoreSpend[],costsConfirmed:boolean):LedgerSnapshot{return {capturedAt:new Date().toISOString(),orderRefs:orders.map(o=>({id:o.id,version:o.version})).sort((a,b)=>a.id.localeCompare(b.id)),spendRefs:spend.map(s=>({id:s.id,version:s.version})).sort((a,b)=>a.id.localeCompare(b.id)),costsConfirmed}}
export function ledgerChanged(snapshot:LedgerSnapshot,orders:StoreOrder[],spend:StoreSpend[]){const now=ledgerSnapshot(orders,spend,snapshot.costsConfirmed);return JSON.stringify(snapshot.orderRefs)!==JSON.stringify(now.orderRefs)||JSON.stringify(snapshot.spendRefs)!==JSON.stringify(now.spendRefs)}
export function ledgerValues(orders:StoreOrder[],spend:StoreSpend[],costsConfirmed:boolean):Partial<StoreMeasurement['values']>{const s=ledgerSummary(orders,spend);return {orders:s.orders,revenue:s.netRevenue,variableCosts:s.variableCosts,adSpend:costsConfirmed?s.adSpend:null,productionCost:costsConfirmed?s.productionCost:null}}

// Quoted fields, escaped quotes, BOM and CRLF are supported; imports are atomic server-side.
export function parseOrderCsv(text:string){
 if(text.length>150000)throw new Error('CSV는 150KB 이하로 나누어 주세요.');
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,afterQuote=false;
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else{quoted=false;afterQuote=true}}else cell+=c;continue}
  if(c==='"'){if(cell||afterQuote)throw new Error('CSV 따옴표 형식을 확인하세요.');quoted=true}
  else if(c===','){row.push(cell);cell='';afterQuote=false}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';afterQuote=false}
  else{if(afterQuote)throw new Error('CSV 닫는 따옴표 뒤의 구분자를 확인하세요.');cell+=c}
 }
 if(quoted)throw new Error('CSV 따옴표가 닫히지 않았습니다.');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
 const headers=rows.shift()?.map(x=>x.trim())||[];
 const required=['source','orderNumber','orderDate','mode','status','paidAmount','refundAmount'];
 const allowed=[...required,...Object.keys(orderCostFields),'channel','experimentId','campaignId','creativeId','attributionEvidence','note'];
 if(required.some(k=>!headers.includes(k))||headers.some(k=>!allowed.includes(k))||new Set(headers).size!==headers.length)throw new Error('제공된 양식의 열 이름을 유지해 주세요.');
 if(!rows.length||rows.length>200)throw new Error('한 번에 1~200개 주문을 가져올 수 있습니다.');
 return rows.map((cells,index)=>{if(cells.length!==headers.length)throw new Error(`${index+2}행의 열 수를 확인하세요.`);return Object.fromEntries(headers.map((key,i)=>[key,cells[i].trim()]))});
}
export const orderCsvTemplate='source,orderNumber,orderDate,mode,status,paidAmount,refundAmount,foodCost,packagingCost,fees,deliveryCost,benefitCost,channel,experimentId,campaignId,creativeId,attributionEvidence,note\n';

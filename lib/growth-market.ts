import {scanText} from './pii-scan';

export type SignalInput={title:string;sourceUrl:string;observedAt:string;expiresAt:string;sourceType:'market'|'customer'|'competitor'|'operations';summary:string;sampleSize:number|null};
export type NeedInput={title:string;situation:string;desiredOutcome:string;alternative:string;barrier:string;counterEvidence:string;signalIds:string[];deadline:string;nextAction:string;assignee:string};
type Clock=Date|string|number;
export class GrowthMarketError extends Error {
 constructor(message:string){super(message);this.name='GrowthMarketError';}
}
const fail=(message:string):never=>{throw new GrowthMarketError(message);};
function record(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return fail('입력 형식을 확인하세요.');
 return value as Record<string,unknown>;
}
function text(value:unknown,label:string,max=2000,required=false):string{
 if(typeof value!=='string')return fail(`${label}은 문자열이어야 합니다.`);
 const clean=value.trim();
 if(clean.length>max||(required&&!clean))return fail(`${label}의 길이를 확인하세요.`);
 if(scanText(clean).length)return fail(`${label}에 직접 식별정보를 넣을 수 없습니다.`);
 return clean;
}
function clock(value:Clock):number{
 const result=new Date(value).getTime();
 if(!Number.isFinite(result))return fail('현재 시각을 확인하세요.');
 return result;
}
// Date.parse normalizes impossible calendar days; compare the calendar first.
function dateTime(value:unknown,label:string,allowDate=true):{text:string;time:number}{
 if(typeof value!=='string')return fail(`${label} 날짜를 확인하세요.`);
 const match=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
 if(!match||(!allowDate&&!match[4]))return fail(`${label} 날짜 형식을 확인하세요.`);
 const [,year,month,day,hour,minute,second,,zone]=match;
 const calendar=new Date(`${year}-${month}-${day}T00:00:00Z`);
 if(!Number.isFinite(calendar.getTime())||calendar.toISOString().slice(0,10)!==`${year}-${month}-${day}`)return fail(`${label}에 실제 달력 날짜를 입력하세요.`);
 if(hour&&(Number(hour)>23||Number(minute)>59||Number(second)>59))return fail(`${label} 시각을 확인하세요.`);
 if(zone&&zone!=='Z'&&(Number(zone.slice(1,3))>14||Number(zone.slice(4))>59||(Number(zone.slice(1,3))===14&&Number(zone.slice(4))!==0)))return fail(`${label} 시간대를 확인하세요.`);
 const time=Date.parse(hour?value:`${value}T23:59:59.999+09:00`);
 if(!Number.isFinite(time))return fail(`${label} 날짜를 확인하세요.`);
 return {text:value,time};
}
function sourceUrl(value:unknown):string{
 const raw=text(value,'출처 URL',2000,true);
 let url:URL;
 try{url=new URL(raw);}catch{return fail('공개 HTTPS 출처 URL을 입력하세요.');}
 const host=url.hostname.toLowerCase();
 // Records only: no DNS resolution or remote fetch. Disallow IP literals entirely.
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||raw.includes('?')||raw.includes('#')||url.port||host.endsWith('.')||!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)||/\.(?:local|internal|localhost|lan|home|test|invalid|onion)$/.test(host))return fail('인증정보·쿼리·내부 주소가 없는 공개 HTTPS URL을 입력하세요.');
 let decoded:string;
 try{decoded=decodeURIComponent(url.pathname);}catch{return fail('출처 URL의 인코딩을 확인하세요.');}
 if(scanText(decoded).length)return fail('출처 URL에 직접 식별정보를 넣을 수 없습니다.');
 return url.toString();
}
function parseSignal(value:unknown,now:number):SignalInput{
 const input=record(value),observed=dateTime(input.observedAt,'관측일',false),expires=dateTime(input.expiresAt,'유효기한');
 if(observed.time>now)return fail('관측일은 미래일 수 없습니다.');
 if(expires.time<=observed.time)return fail('유효기한은 관측일 이후여야 합니다.');
 if(!['market','customer','competitor','operations'].includes(String(input.sourceType)))return fail('신호 유형을 확인하세요.');
 if(input.sampleSize!==null&&(!Number.isSafeInteger(input.sampleSize)||(input.sampleSize as number)<0||(input.sampleSize as number)>100000000))return fail('표본 수는 0 이상 1억 이하 정수 또는 미확인이어야 합니다.');
 return {title:text(input.title,'제목',200,true),sourceUrl:sourceUrl(input.sourceUrl),observedAt:observed.text,expiresAt:expires.text,sourceType:input.sourceType as SignalInput['sourceType'],summary:text(input.summary,'관측 요약',4000,true),sampleSize:input.sampleSize as number|null};
}
export function parseSignalInput(value:unknown):SignalInput{return parseSignal(value,Date.now());}
export function parseNeedInput(value:unknown):NeedInput{
 const input=record(value);
 if(!Array.isArray(input.signalIds)||input.signalIds.length>30||input.signalIds.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))||new Set(input.signalIds).size!==input.signalIds.length)return fail('연결 신호 ID를 확인하세요.');
 const deadline=input.deadline===''?'':dateTime(input.deadline,'니즈 기한').text;
 return {title:text(input.title,'제목',200,true),situation:text(input.situation,'발생 상황'),desiredOutcome:text(input.desiredOutcome,'원하는 결과'),alternative:text(input.alternative,'현재 대안'),barrier:text(input.barrier,'장애물'),counterEvidence:text(input.counterEvidence,'반례'),signalIds:[...input.signalIds],deadline,nextAction:text(input.nextAction,'다음 행동'),assignee:text(input.assignee,'담당 역할',200)};
}
export function signalEvidence(signal:SignalInput,now:Clock):{status:'usable'|'expired'|'insufficient';reason:string}{
 const at=clock(now);
 try{
  const parsed=parseSignal(signal,at);
  if(dateTime(parsed.expiresAt,'유효기한').time<=at)return {status:'expired',reason:'출처 유효기한이 지났습니다.'};
  if(dateTime(parsed.observedAt,'관측일',false).time>at)return {status:'insufficient',reason:'평가 시점 이후의 관측입니다.'};
  if(parsed.sourceType==='customer'&&(parsed.sampleSize===null||parsed.sampleSize<20))return {status:'insufficient',reason:'고객 표본이 20개 미만이거나 미확인입니다.'};
  return {status:'usable',reason:'가설 검토에 사용할 수 있는 출처입니다. 수요 검증을 의미하지 않습니다.'};
 }catch(error){if(!(error instanceof GrowthMarketError))throw error;return {status:'insufficient',reason:'출처 입력이 유효하지 않습니다.'};}
}
const NEED_FIELDS:ReadonlyArray<readonly[keyof NeedInput,string]>=[['title','제목'],['situation','발생 상황'],['desiredOutcome','원하는 결과'],['alternative','현재 대안'],['barrier','장애물'],['counterEvidence','반례'],['nextAction','다음 행동'],['assignee','담당 역할']];
export function needReadiness(input:NeedInput,signals:Array<{id:string;input:SignalInput;evidence?:ReturnType<typeof signalEvidence>}>,now:Clock):{missing:string[];evidenceLevel:'hypothesis'}{
 const at=clock(now);
 const fields=NEED_FIELDS.filter(([key])=>!String(input[key]??'').trim()).map(([,label])=>`${label} 입력 필요`);
 const deadline=(()=>{try{return dateTime(input.deadline,'니즈 기한').time>at?[]:['니즈 기한 경과'];}catch{return ['니즈 기한 입력 필요'];}})();
 const evidence=input.signalIds.length?input.signalIds.flatMap(id=>{
  const source=signals.find(signal=>signal.id===id);
  if(!source)return ['연결한 출처 누락'];
  const result=source.evidence??signalEvidence(source.input,now);
  return result.status==='usable'?[]:[result.reason];
 }):['출처 연결 필요'];
 return {missing:[...fields,...deadline,...evidence],evidenceLevel:'hypothesis'};
}
export function emptySignalInput():SignalInput{return {title:'',sourceUrl:'',observedAt:'',expiresAt:'',sourceType:'market',summary:'',sampleSize:null};}
export function emptyNeedInput():NeedInput{return {title:'',situation:'',desiredOutcome:'',alternative:'',barrier:'',counterEvidence:'',signalIds:[],deadline:'',nextAction:'',assignee:''};}

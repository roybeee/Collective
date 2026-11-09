// 테스트용 모의 딜러(C6). 스크립트대로 시도 결과를 돌려주고 호출 수를 센다. 네트워크 없음.
// 같은 객체가 BizMessageProvider(전송 파이프라인 테스트)와 ContractConnector(lib/connectors/contract-test.ts 5 시나리오 하네스) 둘 다를 구현한다.
// 전송 스크립트의 키는 멱등 키(idempotencyKey)이고, 계약 하네스의 키는 작업 id(op.id)다. 스크립트가 끝나면 마지막 결과를 반복하고, 없는 키는 예외(thrown)다.
import type {ContractConnector,ContractOperation} from '../connectors/contract-test';
import type {ConnectorCapability} from '../connectors/types';
import {immediateDeps,resultStatus,runSend,toSendResult} from './dealer-outcome';
import {kakaoCapabilities} from './registry-descriptor';
import type {AlimtalkRequest,BizMessageProvider,BrandMessageRequest,DealerAttempt,MessageResult,VerifyResult} from './types';

export type MockScript=Readonly<Record<string,readonly DealerAttempt[]>>;
export type MockOptions={script?:MockScript;results?:Readonly<Record<string,{status:string;costKrw?:number|null}>>;verify?:VerifyResult;capabilities?:readonly ConnectorCapability[]};
export type MockDealer=BizMessageProvider&ContractConnector&{calls():Record<string,number>;sent():readonly {key:string;type:'alimtalk'|'brand';to:string}[]};

export function mockDealer(options:MockOptions={}):MockDealer{
 const script=options.script??{},calls:Record<string,number>={},sent:{key:string;type:'alimtalk'|'brand';to:string}[]=[];
 const step=(key:string):DealerAttempt=>{
  calls[key]=(calls[key]??0)+1;
  const steps=script[key]??[{kind:'thrown'}];
  return steps[Math.min(calls[key],steps.length)-1];
 };
 const send=async(type:'alimtalk'|'brand',key:string,to:string)=>{
  const run=await runSend(`mock:${type}`,async()=>{sent.push({key,type,to});return step(key)},immediateDeps);
  return toSendResult(run);
 };
 return {
  name:'mock',
  capabilities:options.capabilities??kakaoCapabilities,
  calls:()=>({...calls}),
  sent:()=>[...sent],
  sendAlimtalk:(r:AlimtalkRequest)=>send('alimtalk',r.idempotencyKey,r.to),
  sendBrandMessage:(r:BrandMessageRequest)=>send('brand',r.idempotencyKey,r.to),
  async getResult(messageId:string):Promise<MessageResult>{
   const r=options.results?.[messageId];
   calls[`result:${messageId}`]=(calls[`result:${messageId}`]??0)+1;
   return r?{messageId,status:resultStatus(r.status),detail:r.status,costKrw:r.costKrw??null}:{messageId,status:'unknown',detail:'모의 딜러에 결과가 없습니다.',costKrw:null};
  },
  async verify(){return options.verify??{ok:true,account:'mock-sender',detail:'모의 딜러'}},
  async execute(op:ContractOperation){return step(op.id)},
 };
}

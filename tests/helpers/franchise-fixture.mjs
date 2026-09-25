// 트랙 R 가맹 리드 스위트(franchise-pipeline·franchise-contacts·franchise-model-boundary) 공용 합성 픽스처.
// 모의 런타임(scripts/eval/runtime.mjs)에 시계를 옮길 수 있는 Date를 넣는다. 세션은 먼 미래까지 유효하게 넣어 시계를 옮겨도 로그인이 유지된다.
// 값은 모두 합성이다(이름 김가상·이테스트, 전화 010-0000-0xxx, 이메일 *@example.com, 계정 *@test.invalid). 외부 네트워크 호출은 0회다.
import {createHash} from 'node:crypto';
import {moduleRuntime} from '../../scripts/eval/runtime.mjs';

export const NAME='김가상',PHONE='010-0000-0101',PHONE_DIGITS='01000000101',EMAIL='lead.one@example.com',MEMO='오후 통화 선호 가상메모',REGION='가상시 가상구';
export const DAY=86400000,HOUR=3600000;
export const DISCLAIMER='COLLECTIVE 휴리스틱 · 법률 자문 아님';
export const plain=x=>JSON.parse(JSON.stringify(x));
export const sha64=text=>createHash('sha256').update(String(text)).digest('hex');
// 시계를 옮기는 Date: 인자 없는 생성자와 Date.now()에 offset을 더한다. Date.UTC·Date.parse는 그대로다.
export function shiftClock(){
 const state={offset:0};
 class ShiftDate extends Date{constructor(...args){super(...(args.length?args:[Date.now()+state.offset]))}static now(){return Date.now()+state.offset}}
 return {ShiftDate,set:ms=>{state.offset=ms},get:()=>state.offset,now:()=>Date.now()+state.offset,iso:(deltaMs=0)=>new Date(Date.now()+state.offset+deltaMs).toISOString()};
}
export async function franchiseFixture(){
 const clock=shiftClock(),calls=[];
 const rt=moduleRuntime(async url=>{calls.push(String(url));throw new Error('외부 호출 금지')},{},{Date:clock.ShiftDate});
 const {sql,env,load}=rt;
 const server=await load('lib/server.ts'),route=await load('app/api/franchise/route.ts'),flagRoute=await load('app/api/feature-flags/route.ts');
 const flags=await load('lib/feature-flags.ts'),lib=await load('lib/franchise.ts'),fcrypto=await load('lib/franchise-crypto.ts');
 const brand=(owner,id)=>server.recordStatement(owner,'brand',id,{id,name:'가상 브랜드 '+id,short:'GV',category:'SYNTHETIC',color:'#224466',bg:'#eef2f6'}).run();
 const far=()=>Date.now()+100*365*DAY;
 const signIn=(id,role,createdAt,workspace)=>{
  const token=createHash('sha256').update('fr-session:'+id).digest('hex');
  sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',workspace,role,'active',createdAt);
  sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,far(),Date.now());
  return {cookie:'__Host-collective_session='+token,origin:'https://agency.test',id};
 };
 let seq=0;
 const requestId=()=>'rq-'+(++seq)+'-'+createHash('sha256').update(String(seq)).digest('hex').slice(0,12);
 const opts={resetRate:true};
 const headersOf=s=>Object.fromEntries(Object.entries(s).filter(([k])=>k!=='id'));
 const call=async res=>({status:res.status,body:await res.json()});
 // 요청 제한(분당 60)은 스위트가 쉽게 넘기므로 기본으로 매 요청 전에 창을 비운다. 요청 제한 검사만 resetRate=false로 둔다.
 const post=async(session,input)=>{
  if(opts.resetRate)sql.prepare("DELETE FROM records WHERE kind='execution_rate'").run();
  const bodyOf={requestId:requestId(),...input};
  return call(await route.POST(new Request('https://agency.test/api/franchise',{method:'POST',headers:{'content-type':'application/json',...headersOf(session)},body:JSON.stringify(bodyOf)})));
 };
 const get=async(session,query)=>call(await route.GET(new Request('https://agency.test/api/franchise?'+query,{headers:headersOf(session)})));
 const setFlag=async(session,enabled)=>call(await flagRoute.POST(new Request('https://agency.test/api/feature-flags',{method:'POST',headers:{'content-type':'application/json',...headersOf(session)},body:JSON.stringify({action:'set',flag:'r_franchise',enabled})})));
 const counts=()=>Object.fromEntries(sql.prepare("SELECT kind,COUNT(*) n FROM records WHERE kind LIKE 'franchise_%' GROUP BY kind").all().map(r=>[r.kind,Number(r.n)]));
 const total=()=>Number(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind LIKE 'franchise_%'").get().n);
 const rows=(kind,where='',...binds)=>sql.prepare(`SELECT data FROM records WHERE kind=? ${where}`).all(kind,...binds).map(r=>JSON.parse(r.data));
 const leadRow=id=>JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='franchise_lead' AND json_extract(data,'$.id')=?").get(id).data);
 const profile=(session,brandId,p,version)=>post(session,{action:'save_profile',brandId,version,profile:{branch:'A',forecastInputs:{sme:true,storesAtFyEnd:3,fiscalYearEnd:null},holidays:null,storageLabels:[],eligibility:null,...p}});
 let phoneSeq=200;
 const nextPhone=()=>'010-0000-0'+String(++phoneSeq).padStart(3,'0');
 const createLead=(session,brandId,extra={})=>post(session,{action:'create_lead',brandId,contact:{name:'이테스트',phone:nextPhone()},task:{region:'',budgetBand:'unknown',timingBand:'unknown',sourceChannel:'walk_in'},basis:{type:'inquiry_response'},...extra});
 return {rt,sql,env,load,server,route,flags,lib,fcrypto,clock,calls,brand,signIn,post,get,setFlag,counts,total,rows,leadRow,profile,createLead,nextPhone,opts,requestId};
}
// 콘솔 출력을 모은다(값 노출 검사용). 원래 출력도 그대로 낸다.
export function captureConsole(){
 const logged=[];
 for(const k of ['log','info','warn','error','debug']){const orig=console[k].bind(console);console[k]=(...a)=>{logged.push(a.map(x=>typeof x==='string'?x:(()=>{try{return JSON.stringify(x)}catch{return String(x)}})()).join(' '));orig(...a)}}
 return logged;
}

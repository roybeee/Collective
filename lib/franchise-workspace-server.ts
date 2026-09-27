// 트랙 R R6d 워크스페이스 할 일 서버: /api/workspace가 호출 한 줄로 부른다(app/api/workspace/route.ts, 레인 A 파일. LANES 공유 파일 행).
// 스위치 r_franchise가 꺼져 있으면 빈 객체를 돌려줘 워크스페이스 응답이 이전과 바이트가 같다. 켜져 있으면 브랜드별 건수를 lib/franchise-workspace.ts로 세어
// {franchiseTasks:{items:[{task,count,brandId}],ruleVersion,disclaimer}}를 더한다. 리드 id·가명 코드·이름·연락처는 응답에 없다.
// 볼 수 있는 리드만 센다(직원은 본인 담당·미배정, lib/franchise.ts canSeeLead). 계약 게이트 요약은 lib/franchise-server.ts gateSummaries(R6b 주간 보고와 같은 판정)를 쓴다.
// 모델 경계(DP-10): 모델 경로가 이 모듈에 닿지 않는다(tests/franchise-model-boundary.test.mjs FORBIDDEN). 외부·모델 호출이 없다(LLM 0). COLLECTIVE 휴리스틱 · 법률 자문 아님.
import {listRecords,stamp} from './server';
import {isEnabled} from './feature-flags';
import {canSeeLead,isAdminRole,type LeadRecord,type Who} from './franchise';
import {gateSummaries} from './franchise-server';
import {codeBook} from './franchise-recruitment-server';
import {attributeLead} from './franchise-recruitment';
import {reportLeadCodes} from './franchise-report';
import type {VersionLite} from './franchise-facts';
import type {FranchiseWorkspaceTasks} from './franchise-tasks';
import {gateCandidate,brandTaskCounts,buildWorkspaceTasks,type TaskGate,type AssetVersionLite,type BrandTaskCounts} from './franchise-workspace';

type Viewer=Who&{owner:string};
type VersionRow=VersionLite&Record<string,unknown>;
type ProfileRow={brandId?:string;forecastInputs?:{fiscalYearEnd?:string|null}|null};

async function gatesOf(owner:string,brandId:string,leads:readonly LeadRecord[],now:string):Promise<Map<string,TaskGate>>{
 const summaries=await gateSummaries(owner,brandId,leads.filter(gateCandidate),now),out=new Map<string,TaskGate>();
 for(const [id,g] of summaries){const at=(g.window as {at?:unknown}).at;out.set(id,{windowAt:typeof at==='string'?at:null,complete:g.complete})}
 return out;
}
// H10 분자: 코드 귀속(basis code) 리드 수를 '<자료 id>:<판>'별로 센다. 볼 수 있는 리드가 아니라 브랜드의 모든 리드를 센다(자료가 닿은 사람 수).
async function attributedByAsset(owner:string,leads:readonly LeadRecord[],now:string){
 const out=new Map<string,number>();
 if(!leads.some(l=>(l.codes??[]).length))return out;
 const book=await codeBook(owner,leads.flatMap(l=>(l.codes??[]).map(c=>c.code)));
 for(const l of leads){
  const a=attributeLead(reportLeadCodes(l),book,{asOf:now});
  if(a.state==='attributed'&&a.basis==='code'&&a.assetRef){const key=`${a.assetRef.id}:${a.assetRef.version}`;out.set(key,(out.get(key)??0)+1)}
 }
 return out;
}
async function computeTasks(who:Viewer,now:string):Promise<FranchiseWorkspaceTasks>{
 const admin=isAdminRole(who.role);
 const [leads,versions,profiles,assets]=await Promise.all([listRecords<LeadRecord>(who.owner,'franchise_lead'),admin?listRecords<VersionRow>(who.owner,'franchise_disclosure_version'):Promise.resolve([]),
  admin?listRecords<ProfileRow>(who.owner,'franchise_profile'):Promise.resolve([]),listRecords<AssetVersionLite>(who.owner,'recruitment_asset')]);
 const brands=[...new Set([...leads.map(l=>l.brandId),...versions.map(v=>v.brandId),...assets.map(a=>a.brandId)])].filter((b):b is string=>typeof b==='string'&&b!=='').sort();
 const attributed=await attributedByAsset(who.owner,leads,now),rows:BrandTaskCounts[]=[];
 for(const brandId of brands){
  const mine=leads.filter(l=>l.brandId===brandId),visible=mine.filter(l=>canSeeLead(who,l)),profile=profiles.find(p=>p.brandId===brandId);
  const registration={brandId,versions:versions.filter(v=>v.brandId===brandId).map(v=>({id:v.id,brandId:v.brandId,label:v.label,registeredAt:v.registeredAt??null,validFrom:v.validFrom,validUntil:v.validUntil,status:v.status==='retired'?'retired' as const:'active' as const})),fiscalYearEnd:profile?.forecastInputs?.fiscalYearEnd??null};
  rows.push(brandTaskCounts({brandId,leads:visible,gates:await gatesOf(who.owner,brandId,visible,now),registration,assets,attributed,admin},now));
 }
 return buildWorkspaceTasks(rows);
}
// 워크스페이스 응답에 펼쳐 넣는다. 가맹 할 일을 세다가 실패해도 워크스페이스 응답은 막지 않는다(서버 기록에 사유만 남기고 할 일을 싣지 않는다).
export async function franchiseWorkspaceTasks(who:Viewer,now:string=stamp()):Promise<{franchiseTasks?:FranchiseWorkspaceTasks}>{
 try{
  if(!await isEnabled(who.owner,'r_franchise'))return {};
  return {franchiseTasks:await computeTasks(who,now)};
 }catch(error){
  console.error('franchise workspace tasks failed:',error instanceof Error?error.message:'unknown');
  return {};
 }
}

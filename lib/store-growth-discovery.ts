import {ApiError,database,listRecords,stamp} from './server';
import {scanText} from './pii-scan';
import {candidateKey,type LocalPartnerCandidate} from './store-growth';
import type {ArchiveSource} from './archive';
import type {StoreReport} from './store-marketing';

export type DiscoveredLocalPartner={name:string;kind:LocalPartnerCandidate['kind'];url:string;regions:string[];concepts:string[];audiences:string[];dayparts:string[];sourceIds:string[];publicBusinessEvidence:string;checkedAt:string};
function fail(message:string):never{throw new ApiError(422,message)}
function safeText(value:unknown,max=2000){
 if(typeof value!=='string'||!value.trim()||value.length>max)fail('공개 사업 후보 문자열 형식을 확인하세요.');
 const text=value.trim().normalize('NFKC');let decoded=text;
 for(let i=0;i<3;i++){try{const next=decodeURIComponent(decoded);if(next===decoded)break;decoded=next}catch{break}}
 decoded=decoded.replace(/[\u200B-\u200D\u2060\uFEFF]/g,'');
 if(scanText(decoded).length||/(?:bearer\s+\S+|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*\S+|\bsk-(?:proj-)?[\w-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(decoded))fail('공개 사업 후보에 개인 식별정보나 비밀을 저장할 수 없습니다.');
 return text;
}
function url(value:unknown){
 const text=safeText(value);let parsed:URL;
 try{parsed=new URL(text)}catch{return fail('공개 사업 후보 주소를 확인하세요.')}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||/^(localhost|127\.|0\.|\[|10\.|192\.168\.|169\.254\.)/.test(parsed.hostname))fail('공개 사업 후보 주소를 확인하세요.');
 return parsed.href;
}
function tags(value:unknown){
 if(!Array.isArray(value)||value.length>20)fail('공개 사업 후보 목록 형식을 확인하세요.');
 return [...new Set(value.map(v=>safeText(v,100)))];
}
export function parseLocalPartners(value:unknown,sources:ArchiveSource[],reportIds:string[],today:string):DiscoveredLocalPartner[]{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>10)fail('공개 사업 후보는 최대 10개입니다.');
 return value.map(raw=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('공개 사업 후보 형식을 확인하세요.');
  const v=raw as Record<string,unknown>,sourceIds=tags(v.sourceIds);
  const cited=sources.filter(s=>sourceIds.includes(s.id)&&reportIds.includes(s.id)&&s.status!=='excluded');
  if(!sourceIds.length||cited.length!==sourceIds.length)fail('공개 사업 후보에 보고서와 연결된 실제 근거가 필요합니다.');
  const name=safeText(v.name,150),kind=v.kind as LocalPartnerCandidate['kind'],address=url(v.url),proof=safeText(v.publicBusinessEvidence);
  if(!['creator','media','platform','community','partner'].includes(kind))fail('공개 사업 후보 종류를 확인하세요.');
  if(!cited.some(s=>{try{return url(s.url)===address}catch{return false}}))fail('공개 사업 후보 주소와 인용 자료 주소가 일치해야 합니다.');
  const evidence=cited.map(s=>s.content??'').join('\n').normalize('NFKC');
  if(!evidence.includes(name))fail('공개 사업 후보 이름은 인용 원문과 일치해야 합니다.');
  if(!evidence.includes(proof)||!/(광고|협업|협찬|제휴|체험단|비즈니스|business|collaborat|partnership)/i.test(proof))fail('공개 사업 협업 모집 원문 근거가 필요합니다.');
  const regions=tags(v.regions),concepts=tags(v.concepts),audiences=tags(v.audiences),dayparts=tags(v.dayparts);
  if(regions.some(region=>!evidence.includes(region)))fail('후보 지역은 공개 원문의 지역 근거와 일치해야 합니다.');
  if([...concepts,...audiences,...dayparts].some(tag=>!evidence.includes(tag)))fail('후보 적합성은 공개 원문에 확인된 표현만 기록하세요.');
  if(v.localReach!==undefined&&v.localReach!==null||v.quote!==undefined&&v.quote!==null)fail('공개 발굴에서 비공개 도달·견적을 추정할 수 없습니다.');
  const days=cited.map(s=>s.observedAt?.slice(0,10)??'');
  if(days.some(day=>!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day||day>today))fail('공개 사업 근거 확인일을 확인하세요.');
  return {name,kind,url:address,regions,concepts,audiences,dayparts,sourceIds,publicBusinessEvidence:proof,checkedAt:days.sort()[0]};
 });
}
export async function discoveryCandidates(items:DiscoveredLocalPartner[],storeId:string,existing:LocalPartnerCandidate[],reportId:string):Promise<LocalPartnerCandidate[]>{
 const seen=new Set(existing.filter(c=>c.storeId===storeId).map(candidateKey)),result:LocalPartnerCandidate[]=[];
 for(const item of items){
  const key=candidateKey(item);if(seen.has(key))continue;seen.add(key);
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${storeId}:${key}`));
  const id='discovery-'+Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('');
  // 공개 확인일로부터 재확인 기간을 잡으며 실제 지역 도달·비용·권한은 채우지 않는다.
  const expiresAt=new Date(Date.parse(item.checkedAt+'T00:00:00Z')+30*86400000).toISOString().slice(0,10);
  result.push({id,storeId,name:item.name,kind:item.kind,url:item.url,regions:item.regions,concepts:item.concepts,audiences:item.audiences,dayparts:item.dayparts,evidenceUrl:item.url,evidenceSummary:`${item.publicBusinessEvidence}\n조사 ${reportId} / 자료 ${item.sourceIds.join(', ')}`,publicBusinessEvidence:item.publicBusinessEvidence,checkedAt:item.checkedAt,expiresAt,localReach:null,localReachEvidence:'',quote:null,rights:'unknown',disclosure:'unknown',tracking:'unknown',status:'research',version:1});
 }
 return result;
}
export async function storeDiscoveryWrites(owner:string,report:StoreReport){
 const existing=await listRecords<LocalPartnerCandidate>(owner,'store_growth_candidate',report.storeId);
 const candidates=await discoveryCandidates(report.localPartners??[],report.storeId,existing,report.id);
 // 조사와 점주 편집은 서로 다른 잠금을 쓴다. 기존 후보는 같은 원자 배치에서도 절대로 덮어쓰지 않는다.
 return candidates.map(c=>database().prepare("INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM records WHERE owner=? AND kind='store_growth_candidate' AND parent_id=? AND lower(rtrim(json_extract(data,'$.url'),'/'))=lower(rtrim(?,'/'))) ON CONFLICT(id) DO NOTHING").bind(`${owner}:store_growth_candidate:${c.id}`,owner,'store_growth_candidate',report.storeId,JSON.stringify(c),stamp(),owner,report.storeId,c.url));
}

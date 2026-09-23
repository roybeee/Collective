import type {Brand} from './agency';
import type {ArchiveSource,ArchiveState,Diagnostic} from './archive';
import type {CampaignDirective} from './campaign-directives';
import {scopedBrandFacts,evidenceFactRefs,type BrandFact,type EvidenceFactRef} from './brand-facts';

// 역할·회의·브리프 초안이 같은 근거를 받도록 만드는 단일 컨텍스트. 서버 모듈을 가져오지 않아 화면에서도 규칙 함수를 쓸 수 있다.
// directives.author: 지시 작성자 구분. 상시 지시는 사실 근거가 아니며 AI 지시문이 권한 한계를 함께 전달한다(campaign-policy directivePolicy).
export type DirectiveInput={text:string;author:'관리자'|'직원'};
export type EvidenceContext={facts:{confirmed:unknown[];prohibited:unknown[];candidate:unknown[]};directives:DirectiveInput[];brandIntro:{text:string;verification:'unverified'};sources:{confirmed:number;excludedCandidates:number;diagnosis:'included'|'stale'|'none'};factRefs?:EvidenceFactRef[]};
export type AiBrand={identity:Pick<Brand,'name'|'short'|'category'|'color'|'tone'|'audience'|'constraints'>;brandIntro:{text:string;verification:'unverified';useInCopy:false};intake?:Brand['intake']};
export type AdoptedDiagnostic=Diagnostic&{brandBasis?:string;confirmedBy?:{id:string;email:string|null};confirmedAt?:string};
// brandArchiveContext가 AI에 전달하는 확정 자료 수의 한도.
export const CONTEXT_SOURCE_LIMIT=20;

// 브랜드 소개(description)와 메모(knowledge)는 대표 대화 기반의 미확인 소개다. 정체성 필드와 분리해 사실로 쓰이지 않게 한다.
export function aiBrand(brand:Brand):AiBrand{
 const {name,short,category,color,tone,audience,constraints}=brand;
 const text=[brand.description&&'소개: '+brand.description,brand.knowledge&&'브랜드 메모: '+brand.knowledge].filter(Boolean).join('\n');
 return {identity:{name,short,category,color,tone,audience,constraints},brandIntro:{text,verification:'unverified',useInCopy:false},...(brand.intake?{intake:brand.intake}:{})};
}

// 진단 채택 시점의 브랜드 기본 정보 지문. 채택 뒤 브랜드 소개·의뢰가 바뀌면 진단을 다시 확인하게 한다.
export function brandBasis(brand:Brand){
 let hash=0x811c9dc5;
 for(const ch of JSON.stringify([brand.name,brand.category,brand.description,brand.audience,brand.tone,brand.constraints,brand.knowledge,brand.intake??null])){hash^=ch.codePointAt(0)!;hash=Math.imul(hash,0x01000193)>>>0}
 return hash.toString(16).padStart(8,'0');
}

// 근거 집합 상태: confirmed(모두 확정·진단 이후 그대로), pending(일부 검토 대기), changed(제외·삭제·진단 이후 추가), empty(근거 없음).
// 자료 본문은 수정되지 않으므로 존재·상태·생성 시점으로 판단한다.
export function diagnosisBasis(d:Pick<Diagnostic,'sourceIds'|'createdAt'>,sources:Pick<ArchiveSource,'id'|'status'|'createdAt'>[]){
 if(!d.sourceIds.length)return 'empty' as const;
 const byId=new Map(sources.map(s=>[s.id,s])),basis=d.sourceIds.map(id=>byId.get(id));
 if(basis.some(s=>!s||s.status==='excluded'||Date.parse(s.createdAt)>Date.parse(d.createdAt)))return 'changed' as const;
 return basis.every(s=>s!.status==='confirmed')?'confirmed' as const:'pending' as const;
}

// AI 입력에 들어가는 채택 진단. 이 규칙 이전에 채택된 진단(brandBasis 없음)은 기존 revision 일치 규칙을 유지한다.
export function diagnosisIncluded(d:AdoptedDiagnostic,sources:Pick<ArchiveSource,'id'|'status'|'createdAt'>[],brand:Brand,revision:number){
 if(d.status!=='confirmed')return false;
 if(!d.brandBasis)return d.archiveRevision===revision;
 return d.brandBasis===brandBasis(brand)&&diagnosisBasis(d,sources)==='confirmed';
}

// AI 입력 후보는 가장 최근에 채택한 진단 하나다. 그 진단이 근거·브랜드 변경으로 빠지면 이전에 채택한 진단으로 조용히 돌아가지 않는다.
export function latestAdopted<T extends AdoptedDiagnostic>(diagnostics:T[]):T|undefined{
 return diagnostics.filter(d=>d.status==='confirmed').sort((a,b)=>String(b.confirmedAt||b.createdAt).localeCompare(String(a.confirmedAt||a.createdAt)))[0];
}

const scope=(f:BrandFact)=>f.storeId?'지점':'브랜드';
const confirmedItem=(f:BrandFact)=>({key:f.key,value:f.value,source:f.source,verifiedAt:f.verifiedAt,validUntil:f.validUntil,scope:scope(f)});
const prohibitedItem=(f:BrandFact)=>({key:f.key,value:f.value,scope:scope(f),use:'광고 금지 표현: 확인 전까지 광고 문구·제작 지시·가설의 전제로 쓰지 않습니다.'});
const candidateItem=(f:BrandFact)=>({key:f.key,value:f.value,scope:scope(f),use:f.status==='confirmed'?'미확인(확인 근거·유효기한 재확인 필요): 쓰려면 [확인 필요]로 표시합니다.':'미확인 후보: 쓰려면 [확인 필요]로 표시합니다.'});

async function rows<T>(db:D1Database,owner:string,kind:string,parentId:string){
 const result=await db.prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC').bind(owner,kind,parentId).all<{data:string}>();
 return result.results.map(r=>JSON.parse(r.data) as T);
}
async function record<T>(db:D1Database,owner:string,kind:string,id:string){
 const row=await db.prepare('SELECT data FROM records WHERE id=? AND owner=? AND kind=?').bind(`${owner}:${kind}:${id}`,owner,kind).first<{data:string}>();
 return row?JSON.parse(row.data) as T:null;
}

// 캠페인의 브랜드·지점 범위로 거른 사실·상시 지시·미확인 소개·근거 자료 상태. factRefs는 작업물에 저장해 사실 변경을 감지한다.
export async function evidenceContext(db:D1Database,owner:string,campaign:{id:string;brandId:string;stores?:unknown;storeId?:string}):Promise<EvidenceContext>{
 const storeId=campaign.storeId||undefined;
 const [brand,facts,sources,diagnostics,states,directives]=await Promise.all([
  record<Brand>(db,owner,'brand',campaign.brandId),
  rows<BrandFact>(db,owner,'brand_fact',campaign.brandId),
  rows<ArchiveSource>(db,owner,'brand_source',campaign.brandId),
  rows<AdoptedDiagnostic>(db,owner,'brand_diagnostic',campaign.brandId),
  rows<ArchiveState>(db,owner,'brand_archive_state',campaign.brandId),
  campaign.id?rows<CampaignDirective>(db,owner,'campaign_directive',campaign.id):Promise.resolve([] as CampaignDirective[]),
 ]);
 const scoped=scopedBrandFacts(facts,campaign.brandId,storeId),inScope=sources.filter(s=>!s.storeId||s.storeId===storeId);
 const adopted=latestAdopted(diagnostics),revision=states[0]?.revision??0;
 const diagnosis=!adopted?'none':brand&&diagnosisIncluded(adopted,sources,brand,revision)?'included':'stale';
 return {
  facts:{confirmed:scoped.confirmed.map(confirmedItem),prohibited:scoped.prohibited.map(prohibitedItem),candidate:scoped.candidate.map(candidateItem)},
  directives:[...directives].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(d=>({text:d.text,author:d.createdBy?.role==='member'?'직원' as const:'관리자' as const})),
  brandIntro:{text:brand?aiBrand(brand).brandIntro.text:'',verification:'unverified'},
  sources:{confirmed:Math.min(CONTEXT_SOURCE_LIMIT,inScope.filter(s=>s.status==='confirmed').length),excludedCandidates:inScope.filter(s=>s.status==='candidate').length,diagnosis},
  factRefs:evidenceFactRefs(scoped),
 };
}

// 작업물을 저장하는 시점의 사실 스냅샷. 실행 중에 사실이 바뀌었는지(factsChanged) 판정한다.
export async function currentFactRefs(db:D1Database,owner:string,campaign:{brandId:string;storeId?:string}){
 return evidenceFactRefs(scopedBrandFacts(await rows<BrandFact>(db,owner,'brand_fact',campaign.brandId),campaign.brandId,campaign.storeId||undefined));
}

// 캠페인 상세 화면의 'AI 팀에 전달되는 근거' 요약.
export function evidenceSummary(e:EvidenceContext){
 return {confirmedFacts:e.facts.confirmed.length,prohibitedFacts:e.facts.prohibited.length,candidateFacts:e.facts.candidate.length,directives:e.directives.length,confirmedSources:e.sources.confirmed,excludedCandidates:e.sources.excludedCandidates,diagnosis:e.sources.diagnosis};
}
export type EvidenceSummary=ReturnType<typeof evidenceSummary>;

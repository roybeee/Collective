// 트랙 R R1b 서버 보조: 브랜드의 가맹 문맥(가맹 프로필·정보공개서 버전)을 레코드에서 직접 읽는다.
// 모델 경계: lib/franchise.ts·lib/franchise-server.ts·lib/franchise-crypto.ts를 import하지 않는다(lib/brand-facts-server.ts·lib/execution-server.ts가 이 모듈을 쓴다).
import {ApiError,readRecord,listRecords} from './server';
import type {BrandFact} from './brand-facts';
import {franchiseItem} from './fact-catalog';
import {versionStates,type VersionLite} from './franchise-facts';

type ProfileRow={brandId?:string;branch?:string;forecastInputs?:{fiscalYearEnd?:string|null}|null};
type VersionRow=VersionLite&Record<string,unknown>;
export type FranchiseContext={profile:{branch:string;fiscalYearEnd:string|null}|null;versions:VersionLite[]};
async function optionalProfile(owner:string,brandId:string){try{return await readRecord<ProfileRow>(owner,'franchise_profile',brandId)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
// 판정에 쓰는 필드만 옮긴다(sha256·보관 위치 라벨·이력은 싣지 않는다).
export async function loadFranchiseContext(owner:string,brandId:string):Promise<FranchiseContext>{
 const [profile,rows]=await Promise.all([optionalProfile(owner,brandId),listRecords<VersionRow>(owner,'franchise_disclosure_version',brandId)]);
 const versions=rows.filter(v=>v.brandId===brandId).map(v=>({id:v.id,brandId:v.brandId,label:v.label,registeredAt:v.registeredAt??null,validFrom:v.validFrom,validUntil:v.validUntil,status:v.status==='retired'?'retired' as const:'active' as const})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 return {profile:profile&&profile.brandId===brandId?{branch:String(profile.branch??''),fiscalYearEnd:profile.forecastInputs?.fiscalYearEnd??null}:null,versions};
}
// 가맹 문맥: 가맹 프로필이나 정보공개서 버전이 하나라도 있는 브랜드. 없으면 모든 가맹 판정을 건너뛴다(비가맹 브랜드 응답·캡션 불변).
export const hasFranchiseContext=(fr:FranchiseContext)=>!!fr.profile||fr.versions.length>0;
// 확정 disclosure 가맹 사실 중 근거가 없거나 근거 버전이 현재 등록 버전이 아닌 사실(새 버전으로 옮길 대상).
export function staleFranchiseFactIds(facts:readonly BrandFact[],fr:FranchiseContext,now:string):string[]{
 const states=versionStates(fr.versions,now);
 return facts.filter(f=>f.status==='confirmed'&&!!franchiseItem(f.key)?.disclosure&&(!f.sourceRef||states[f.sourceRef.disclosureVersionId]!=='current')).map(f=>f.id);
}

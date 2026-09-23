import type {Brand} from './agency';

// 기본 브랜드 결정. 워크스페이스 목표 한 줄 입력과 바이럴 학습 화면이 같은 규칙을 쓰고, 각 화면은 자기 활동 목록만 넘긴다.
// 기억한 선택(있고 아직 존재할 때) → 활동 시각이 가장 늦은 기존 브랜드 → 첫 브랜드. 입력 배열은 바꾸지 않는다.
export type BrandActivity={brandId:string;at:string};
export function defaultBrandId(brands:readonly Pick<Brand,'id'>[],activity:readonly BrandActivity[],remembered=''){
 const known=new Set(brands.map(b=>b.id));
 if(remembered&&known.has(remembered))return remembered;
 const latest=activity.filter(x=>known.has(x.brandId)&&!Number.isNaN(Date.parse(x.at))).reduce<{brandId:string;at:number}|null>((best,x)=>!best||Date.parse(x.at)>best.at?{brandId:x.brandId,at:Date.parse(x.at)}:best,null);
 return latest?.brandId||brands[0]?.id||'';
}

const escapeRegex=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// 영문 약칭은 3자 이상, 한글 등은 2자 이상일 때만 찾는다('MD' 같은 일반 약어 오탐 방지). 영숫자 경계로 부분 단어를 제외한다.
function mentions(text:string,term:string){const t=term.trim().toLowerCase();if(t.length<(/^[\x20-\x7e]+$/.test(t)?3:2))return false;return new RegExp(`(?<![a-z0-9])${escapeRegex(t)}(?![a-z0-9])`).test(text)}
// 목표 문장에 선택하지 않은 다른 브랜드의 이름·약칭이 있으면 그 브랜드들을 돌려준다.
export function otherBrandMentions<T extends Pick<Brand,'id'|'name'|'short'>>(text:string,brands:readonly T[],selectedId:string){
 const lower=text.toLowerCase();
 return brands.filter(b=>b.id!==selectedId&&(mentions(lower,b.name)||mentions(lower,b.short)));
}
// 목표 한 줄 입력의 자동 초안: 목표가 있고 다른 브랜드 이름이 없을 때만 다이얼로그가 열리자마자 HERMES에 요청한다.
// 다른 브랜드 이름이 있으면 다이얼로그만 열어 사용자가 브랜드를 확인한 뒤 요청하게 한다.
export function canAutoDraft(goal:string,brands:readonly Pick<Brand,'id'|'name'|'short'>[],brandId:string){return !!goal.trim()&&otherBrandMentions(goal,brands,brandId).length===0}

// 워크스페이스 화면 상태 ↔ URL 쿼리(?view=&campaign=&brand=&store=&tab=). 새로고침·링크 공유·뒤로가기 때 같은 화면을 복원한다.
// 허용하지 않은 화면·형식이 틀린 id·모르는 쿼리는 버린다. 존재 확인은 데이터를 불러온 뒤 reconcileNav로 한다.
export const navViews=['overview','learning','campaigns','brands','stores','agents','assets','results','settings'] as const;
export type NavView=typeof navViews[number];
// 학습 화면의 탭(app/learning-panel.tsx). 링크가 규칙 탭 등을 바로 열 수 있게 허용 목록만 받는다.
export const learningTabs=['cases','experiments','rules','jobs'] as const;
export type LearningTab=typeof learningTabs[number];
// 점포 마케팅 지점 탭(app/store-marketing-panel.tsx)과 브랜드 아카이브 탭(app/brand-archive.tsx). '주문 장부 열기'는 주문 장부 탭을, 설정 기능표 링크는 확인 사실 탭을 연다.
export const storeTabs=['diagnosis','ledger','channels','experiments','research'] as const;
export type StoreTab=typeof storeTabs[number];
export const brandTabs=['overview','sources','facts','intake','research'] as const;
export type BrandTab=typeof brandTabs[number];
export type NavTab=LearningTab|StoreTab|BrandTab;
export type NavState={view:NavView;campaign?:string;brand?:string;store?:string;tab?:NavTab};
type NavInput={view?:string|null;campaign?:string|null;brand?:string|null;store?:string|null;tab?:string|null};
// 서버 id 형식(UUID·시드 id·브랜드 번호 [a-zA-Z0-9_-], 최대 100자)만 받는다.
const idPattern=/^[A-Za-z0-9_-]{1,100}$/;
const validId=(value:string|null|undefined)=>typeof value==='string'&&idPattern.test(value)?value:undefined;
const isView=(value:string|null|undefined):value is NavView=>(navViews as readonly string[]).includes(value as string);
const viewTabs:Partial<Record<NavView,readonly NavTab[]>>={learning:learningTabs,stores:storeTabs,brands:brandTabs};
const tabOf=(view:NavView,value:string|null|undefined)=>viewTabs[view]?.find(tab=>tab===value);
export const isLearningTab=(value:unknown):value is LearningTab=>(learningTabs as readonly unknown[]).includes(value);
// brand는 브랜드 아카이브·점포 마케팅·학습에서만, store는 점포 마케팅에서만, tab은 탭이 있는 화면(학습·점포 마케팅·브랜드 아카이브)에서 그 화면의 허용 목록 값만 의미가 있다.
export function normalizeNav(input:NavInput):NavState{
 const view=isView(input.view)?input.view:'overview',campaign=validId(input.campaign);
 const brand=view==='brands'||view==='stores'||view==='learning'?validId(input.brand):undefined,store=view==='stores'?validId(input.store):undefined,tab=tabOf(view,input.tab);
 return {view,...(campaign?{campaign}:{}),...(brand?{brand}:{}),...(store?{store}:{}),...(tab?{tab}:{})};
}
export function parseNav(search:string):NavState{
 const params=new URLSearchParams(search);
 return normalizeNav({view:params.get('view'),campaign:params.get('campaign'),brand:params.get('brand'),store:params.get('store'),tab:params.get('tab')});
}
// 기본 화면(워크스페이스)만 있으면 빈 문자열이라 주소가 '/'로 남는다.
export function serializeNav(state:NavInput):string{
 const nav=normalizeNav(state),entries=Object.entries({view:nav.view,campaign:nav.campaign,brand:nav.brand,store:nav.store,tab:nav.tab}).filter((entry):entry is [string,string]=>!!entry[1]);
 return entries.length===1&&nav.view==='overview'?'':'?'+new URLSearchParams(entries).toString();
}
export function withCampaign(state:NavState,id:string|null):NavState{
 return normalizeNav({...state,campaign:id});
}
// 불러온 데이터에 없는 id: 캠페인은 캠페인 목록으로, 브랜드는 같은 화면의 전체 목록으로(학습 탭만 유지, 지점·아카이브 탭은 그 브랜드의 것이라 버린다). 바뀌지 않으면 같은 객체를 돌려준다.
export function reconcileNav(state:NavState,known:{campaigns:string[];brands:string[]}):NavState{
 if(state.campaign&&!known.campaigns.includes(state.campaign))return {view:'campaigns'};
 if(state.brand&&!known.brands.includes(state.brand))return {view:state.view,...(state.campaign?{campaign:state.campaign}:{}),...(state.tab&&state.view==='learning'?{tab:state.tab}:{})};
 return state;
}
// 워크스페이스 밖 컴포넌트(토스트·캠페인 상세)에서 주소로 화면을 옮긴다. 워크스페이스는 주소 변경(popstate)을 따라 화면을 바꾼다. 브라우저에서만 부른다.
export function pushNav(state:NavInput){history.pushState(null,'',location.pathname+serializeNav(state));window.dispatchEvent(new PopStateEvent('popstate'))}

// 워크스페이스 화면 상태 ↔ URL 쿼리(?view=&campaign=&brand=&store=). 새로고침·링크 공유·뒤로가기 때 같은 화면을 복원한다.
// 허용하지 않은 화면·형식이 틀린 id·모르는 쿼리는 버린다. 존재 확인은 데이터를 불러온 뒤 reconcileNav로 한다.
export const navViews=['overview','learning','campaigns','brands','stores','agents','assets','results','settings'] as const;
export type NavView=typeof navViews[number];
export type NavState={view:NavView;campaign?:string;brand?:string;store?:string};
type NavInput={view?:string|null;campaign?:string|null;brand?:string|null;store?:string|null};
// 서버 id 형식(UUID·시드 id·브랜드 번호 [a-zA-Z0-9_-], 최대 100자)만 받는다.
const idPattern=/^[A-Za-z0-9_-]{1,100}$/;
const validId=(value:string|null|undefined)=>typeof value==='string'&&idPattern.test(value)?value:undefined;
const isView=(value:string|null|undefined):value is NavView=>(navViews as readonly string[]).includes(value as string);
// brand는 브랜드 아카이브·점포 마케팅에서만, store는 점포 마케팅에서만 의미가 있다.
export function normalizeNav(input:NavInput):NavState{
 const view=isView(input.view)?input.view:'overview',campaign=validId(input.campaign);
 const brand=view==='brands'||view==='stores'?validId(input.brand):undefined,store=view==='stores'?validId(input.store):undefined;
 return {view,...(campaign?{campaign}:{}),...(brand?{brand}:{}),...(store?{store}:{})};
}
export function parseNav(search:string):NavState{
 const params=new URLSearchParams(search);
 return normalizeNav({view:params.get('view'),campaign:params.get('campaign'),brand:params.get('brand'),store:params.get('store')});
}
// 기본 화면(워크스페이스)만 있으면 빈 문자열이라 주소가 '/'로 남는다.
export function serializeNav(state:NavInput):string{
 const nav=normalizeNav(state),entries=Object.entries({view:nav.view,campaign:nav.campaign,brand:nav.brand,store:nav.store}).filter((entry):entry is [string,string]=>!!entry[1]);
 return entries.length===1&&nav.view==='overview'?'':'?'+new URLSearchParams(entries).toString();
}
export function withCampaign(state:NavState,id:string|null):NavState{
 return normalizeNav({...state,campaign:id});
}
// 불러온 데이터에 없는 id: 캠페인은 캠페인 목록으로, 브랜드는 같은 화면의 전체 목록으로. 바뀌지 않으면 같은 객체를 돌려준다.
export function reconcileNav(state:NavState,known:{campaigns:string[];brands:string[]}):NavState{
 if(state.campaign&&!known.campaigns.includes(state.campaign))return {view:'campaigns'};
 if(state.brand&&!known.brands.includes(state.brand))return state.campaign?{view:state.view,campaign:state.campaign}:{view:state.view};
 return state;
}

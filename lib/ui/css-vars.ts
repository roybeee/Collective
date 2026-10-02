// 데이터에서 온 색·폭을 CSS 변수로 넘긴다(UX-PLAN-3 3차원: 인라인 style 0). 모양은 CSS 클래스(.tint·.tint-text·.fill-w)가 정하고 값만 변수로 준다.
export const cssVars=(vars:Record<string,string|number|null|undefined>)=>(el:HTMLElement|null)=>{if(!el)return;for(const [k,v] of Object.entries(vars)){if(v==null||v==='')el.style.removeProperty(k);else el.style.setProperty(k,String(v));}};

// 화면·탭을 내려받는 동안 보이는 골격(UX-PLAN-3 Q2). 문장 대신 자리 모양을 보여 주고, 화면 읽기 프로그램에는 '불러오고 있습니다.'를 알린다.
// 가벼운 표시 전용 부품이라 홈 첫 로딩 예산에 영향이 거의 없다.
export function ScreenSkeleton({label='불러오고 있습니다.',rows=3}:{label?:string;rows?:number}){
 return <div role="status" aria-live="polite" className="screen-skeleton"><span className="sr-only">{label}</span>
  <div className="screen-skeleton-bar is-title"/>
  {Array.from({length:rows},(_,i)=><div key={i} className="screen-skeleton-bar"/>)}
 </div>;
}

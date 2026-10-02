import {cn} from '@/lib/utils';
// 숫자 요약을 가운뎃점으로 이어 붙이지 않고 '이름·값' 정의 목록으로 보인다(UX-PLAN-3 7차원). 화면 읽기 프로그램은 이름과 값을 짝으로 읽는다.
export function StatList({items,className,label}:{items:readonly (readonly [string,React.ReactNode])[];className?:string;label?:string}){
 return <dl className={cn('stat-list',className)} aria-label={label}>{items.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

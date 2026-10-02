import {cn} from '@/lib/utils';
// 한 줄 메타 정보(UX-PLAN-3 7차원). 여러 사실을 가운뎃점으로 이어 붙이지 않고 항목으로 나눈다. 빈 항목(null·false·'')은 뺀다.
// 화면에서는 항목 사이에 옅은 세로선을 긋는다. 쉼표는 글자 크기 0으로 두어 화면 읽기·접근 이름·복사 글자가 'a, b'가 된다
// (sr-only처럼 절대 위치로 숨기면 접근 이름이 'a , b'로 빈칸이 낀다).
export function MetaLine({items,className,label}:{items:readonly React.ReactNode[];className?:string;label?:string}){
 const list=items.filter(x=>x!==null&&x!==undefined&&x!==false&&x!=='');
 return <span className={cn('meta-line',className)} aria-label={label}>{list.map((x,i)=><span key={i}>{i>0&&<span className="meta-sep">, </span>}{x}</span>)}</span>;
}

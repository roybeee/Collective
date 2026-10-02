import {cn} from '@/lib/utils';
// 한 줄 메타 정보(UX-PLAN-3 7차원). 여러 사실을 가운뎃점으로 이어 붙이지 않고 항목으로 나눈다. 빈 항목(null·false·'')은 뺀다.
// 화면에서는 항목 사이에 옅은 세로선을 긋고, 줄이 넘치면 항목 단위로 넘긴다. 화면 읽기 프로그램과 복사한 글자는 쉼표로 나뉜다.
export function MetaLine({items,className,label}:{items:readonly React.ReactNode[];className?:string;label?:string}){
 const list=items.filter(x=>x!==null&&x!==undefined&&x!==false&&x!=='');
 return <span className={cn('meta-line',className)} aria-label={label}>{list.map((x,i)=><span key={i}>{i>0&&<span className="sr-only">, </span>}{x}</span>)}</span>;
}

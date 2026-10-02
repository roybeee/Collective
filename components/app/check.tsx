import * as React from 'react';
import {cn} from '@/lib/utils';
// 공용 체크박스(UX-PLAN-3 6차원 '모든 입력이 공용 필드'). 브라우저 기본 체크박스를 그대로 써서 폼 값·키보드·화면 읽기 동작은 같고,
// 크기·색·초점 표시만 토큰으로 통일한다(globals.css .ui-check).
export function CheckInput({className,...props}:Omit<React.ComponentProps<'input'>,'type'>){
 return <input type="checkbox" data-slot="check" className={cn('ui-check',className)} {...props}/>;
}

import * as React from 'react';
import {cn} from '@/lib/utils';
// 카드·목록 행·글자 링크처럼 영역 전체를 누르는 버튼(UX-PLAN-3 Q2 공용 부품). 모양은 각 카드 클래스가 정한다.
// 이 부품은 초점 고리·비활성 표시·data-slot을 통일한다(globals.css .card-button). type은 넘긴 값을 그대로 쓴다(폼 제출 동작을 바꾸지 않는다).
export function CardButton({className,...props}:React.ComponentProps<'button'>){
 return <button data-slot="card-button" className={cn('card-button',className)} {...props}/>;
}

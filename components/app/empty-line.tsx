'use client';
import {useRef,type ReactNode} from 'react';
import {Button} from '@/components/ui/button';
// 목록이 비었을 때 한 줄 안내와 다음 행동(UX-PLAN-3 12차원: 빈 상태가 다음 행동을 보인다).
// first를 주면 '첫 ○○ 쓰기' 버튼이 가까운 쓰기 폼의 첫 칸으로 이동한다. 폼이 '새 ○○' 버튼 뒤에 열리면 그 버튼을 먼저 누른다.
// 쓸 수 없으면(권한 없음) first를 비워 안내만 보인다. 폼이 없는 목록은 next 문장으로 다음 행동을 적는다.
const fieldSelector='form :is(input,textarea,select):not([type=hidden]):not(:disabled)';
export function EmptyLine({children,first,next,className}:{children:ReactNode;first?:string;next?:string;className?:string}){
 const ref=useRef<HTMLParagraphElement>(null);
 // 찾는 범위는 이 안내가 든 패널(section·region·details)부터 바깥으로 세 단계까지다. 목록과 폼이 나란한 2열 배치도 찾고, 그 밖의 이웃 패널 폼은 건드리지 않는다.
 function near<T>(pick:(box:HTMLElement)=>T|null){
  const scope='section,[role=region],details';let box:HTMLElement|null|undefined=ref.current?.parentElement?.closest<HTMLElement>(scope)??ref.current?.parentElement;
  // 목록만 든 작은 section이면 바깥 패널까지 세 단계 넓힌다.
  for(let i=0;box&&i<3;i++,box=box.parentElement?.closest<HTMLElement>(scope)){const hit=pick(box);if(hit)return hit;}
  return null;
 }
 function focusField(){const f=near(box=>box.querySelector<HTMLElement>(fieldSelector));if(!f)return false;f.scrollIntoView({block:'center'});f.focus({preventScroll:true});return true;}
 function go(){
  if(focusField())return;
  const open=near(box=>[...box.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].find(b=>b.textContent?.trim().startsWith('새 '))??null);
  if(!open)return;open.click();
  let tries=0;const wait=()=>{if(!focusField()&&++tries<20)setTimeout(wait,50)};setTimeout(wait,0);
 }
 return <p ref={ref} className={className?`empty-line ${className}`:'empty-line'}>{children}{next&&<> {next}</>}{first&&<> <Button type="button" variant="link" size="fit" className="empty-line-go" onClick={go}>첫 {first} 쓰기</Button></>}</p>;
}

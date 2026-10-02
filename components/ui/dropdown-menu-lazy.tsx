"use client"
// 드롭다운(radix menu·floating-ui)을 처음 그릴 때 내려받는 같은 모양의 부품(홈 첫 로딩 JS 예산, UX-PLAN-3 ⑩).
// 하위 부품은 Root가 그려진 뒤(모듈을 받은 뒤)에만 쓰이므로 받아 둔 모듈을 그대로 쓴다. fallback은 받는 동안 트리거 자리를 지킨다.
import {lazy,Suspense,type ComponentProps,type ReactNode} from "react"
type M=typeof import("./dropdown-menu")
let mod:M|null=null
export const loadDropdownMenu=()=>import("./dropdown-menu").then(m=>(mod=m))
const Root=lazy(()=>loadDropdownMenu().then(m=>({default:m.DropdownMenu})))
function DropdownMenu({fallback=null,...props}:ComponentProps<M["DropdownMenu"]>&{fallback?:ReactNode}){return <Suspense fallback={fallback}><Root {...props}/></Suspense>}
const DropdownMenuTrigger=(props:ComponentProps<M["DropdownMenuTrigger"]>)=>mod&&<mod.DropdownMenuTrigger {...props}/>
const DropdownMenuContent=(props:ComponentProps<M["DropdownMenuContent"]>)=>mod&&<mod.DropdownMenuContent {...props}/>
const DropdownMenuItem=(props:ComponentProps<M["DropdownMenuItem"]>)=>mod&&<mod.DropdownMenuItem {...props}/>
export {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem}

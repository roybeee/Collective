"use client"
// 사이드바 메뉴 단추의 접힘 툴팁. 툴팁(radix tooltip·floating-ui)은 tooltip을 넘긴 단추에만 쓰이므로 그때 내려받는다(홈 첫 로딩 JS 예산, UX-PLAN-3 ⑩).
import type {ComponentProps,ReactElement} from "react"
import {Tooltip,TooltipContent,TooltipProvider,TooltipTrigger} from "@/components/ui/tooltip"
export default function SidebarTooltip({button,...content}:{button:ReactElement}&ComponentProps<typeof TooltipContent>){return <TooltipProvider delayDuration={0}><Tooltip><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipContent {...content}/></Tooltip></TooltipProvider>}

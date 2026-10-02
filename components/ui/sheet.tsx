"use client"
// 시트 부품. 구현(sheet-parts, radix Dialog의 포커스 가두기·스크롤 잠금 등)은 시트를 처음 열 때 내려받는다(홈 첫 로딩 JS 예산, UX-PLAN-3 ⑩).
// 닫힌 시트는 내용을 그리지 않으므로 처음 열기 전에는 아무것도 그리지 않는다. open을 넘기지 않는(트리거로 여는) 시트는 바로 내려받는다.
// 하위 부품은 Root가 그려진 뒤(모듈을 받은 뒤)에만 쓰이므로 받아 둔 모듈을 그대로 쓴다.
import * as React from "react"

import { cn } from "@/lib/utils"

type M = typeof import("./sheet-parts")
let parts: M | null = null
const loadSheet = () => import("./sheet-parts").then((m) => (parts = m))
const Root = React.lazy(() => loadSheet().then((m) => ({ default: m.Sheet })))

function Sheet(props: React.ComponentProps<M["Sheet"]>) {
  const [opened, setOpened] = React.useState(props.open !== false || !!props.defaultOpen)
  if (props.open && !opened) setOpened(true)
  if (!opened) return null
  return (
    <React.Suspense fallback={null}>
      <Root {...props} />
    </React.Suspense>
  )
}

const SheetTrigger = (props: React.ComponentProps<M["SheetTrigger"]>) => parts && <parts.SheetTrigger {...props} />
const SheetClose = (props: React.ComponentProps<M["SheetClose"]>) => parts && <parts.SheetClose {...props} />
const SheetContent = (props: React.ComponentProps<M["SheetContent"]>) => parts && <parts.SheetContent {...props} />
const SheetTitle = (props: React.ComponentProps<M["SheetTitle"]>) => parts && <parts.SheetTitle {...props} />
const SheetDescription = (props: React.ComponentProps<M["SheetDescription"]>) => parts && <parts.SheetDescription {...props} />

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}

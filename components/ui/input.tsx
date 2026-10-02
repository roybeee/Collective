import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  // 숫자 칸에 1,000 이상의 값이 들어 있으면 아래에 천 단위 쉼표 값을 보인다(UX-PLAN-3 6차원 '금액 입력 보조'). 화면 읽기는 칸의 값을 그대로 읽는다.
  // 보조 글자는 빈 요소의 ::after(data-hint)로 그린다. 칸을 감싼 label의 글자·접근 이름에 섞이지 않게 한다.
  const amount = type === "number" && props.value !== undefined && props.value !== "" ? Number(props.value) : NaN
  // 날짜 칸은 브라우저 언어에 따라 mm/dd/yyyy로 보일 수 있어, 값이 있으면 아래에 한국어 날짜를 같이 보인다(UX-PLAN-3 6차원 '날짜 입력 보조').
  const day = (type === "date" || type === "datetime-local") && typeof props.value === "string" ? koreanDate(props.value, type === "datetime-local") : ""
  const input = (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
  if (day) return (
    <>
      {input}
      <span className="num-hint" aria-hidden="true" data-hint={day}/>
    </>
  )
  if (!Number.isFinite(amount) || Math.abs(amount) < 1000) return input
  return (
    <>
      {input}
      <span className="num-hint" aria-hidden="true" data-hint={amount.toLocaleString("ko-KR")}/>
    </>
  )
}

// '2026-10-02' → '2026년 10월 2일 (금)', '2026-10-02T16:27' → '… 오후 4:27'. 형식이 다르면 빈 문자열.
function koreanDate(value: string, withTime: boolean) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value)
  if (!m) return ""
  const [, y, mo, d, h, mi] = m
  const week = "일월화수목금토"[new Date(Date.UTC(+y, +mo - 1, +d)).getUTCDay()]
  const date = `${+y}년 ${+mo}월 ${+d}일 (${week})`
  if (!withTime || h === undefined) return date
  const hour = +h
  return `${date} ${hour < 12 ? "오전" : "오후"} ${hour % 12 || 12}:${mi}`
}

export { Input, koreanDate }

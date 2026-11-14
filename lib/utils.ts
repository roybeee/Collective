import { clsx, type ClassValue } from "clsx";
import { createTailwindMerge } from "tailwind-merge";
import { twMergeConfig } from "./tw-merge-config";

// 기본 twMerge 대신 소스에 나오는 클래스 그룹만 담은 설정을 쓴다(홈 첫 로딩 JS를 줄인다, UX-PLAN-3 11.26).
// 소스의 모든 클래스 조합에서 결과가 기본과 같다는 확인: tests/tw-merge-config.test.mjs.
const twMerge = createTailwindMerge(twMergeConfig);

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// 화면 언어 구독(GLOBAL-PLAN G6). lib/i18n.ts의 저장소를 useSyncExternalStore로 읽어 언어가 바뀌면 다시 그린다.
// 서버 렌더와 첫 그림은 한국어(스냅샷 0)이고, 저장된 언어가 있으면 첫 구독 때 사전을 받아 바꾼다(lib/ui/theme.ts와 같은 방식).
import {useSyncExternalStore} from 'react';
import {currentLocale,localeVersion,subscribeLocale,t,type Locale} from './i18n';
const serverVersion=()=>0;
/** 문구 함수 t를 돌려주고, 언어가 바뀌면 이 부품을 다시 그린다. */
export function useT():typeof t{useSyncExternalStore(subscribeLocale,localeVersion,serverVersion);return t}
/** 지금 언어. 언어가 바뀌면 다시 그린다. */
export function useLocale():Locale{useSyncExternalStore(subscribeLocale,localeVersion,serverVersion);return currentLocale()}

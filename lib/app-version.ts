// Vite가 서버·클라이언트 번들에 같은 값을 주입한다. 개발 실행에는 주입이 없다.
declare const __COLLECTIVE_BUILD_ID__:string;
// 커밋된 소스 트리 해시는 GitHub 커밋과, 같은 파일을 게시하는 Sites 커밋에서 동일하다.
// 커밋 SHA는 두 저장소가 서로 다르므로 트리만이 "무엇이 배포됐는가"를 식별한다.
declare const __COLLECTIVE_SOURCE_TREE__:string;
export const APP_BUILD=typeof __COLLECTIVE_BUILD_ID__==='undefined'?'development':__COLLECTIVE_BUILD_ID__;
// 40자 16진수가 아니면 신원을 주장하지 않는다. 'dirty'·'unknown'을 트리로 통과시키지 않는다.
export function sourceTree(value:unknown){return typeof value==='string'&&/^[0-9a-f]{40}$/.test(value)?value:'unknown'}
export const APP_TREE=sourceTree(typeof __COLLECTIVE_SOURCE_TREE__==='undefined'?undefined:__COLLECTIVE_SOURCE_TREE__);

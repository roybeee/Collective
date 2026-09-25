import {moduleRuntime} from '../../scripts/eval/runtime.mjs';

// 테스트 모의 런타임: 실제 Date·webcrypto를 쓰는 scripts/eval/runtime.mjs moduleRuntime이다(합성 케이스 생성기와 같은 구현).
export function testRuntime(fetch, hooks = {}) {
 return moduleRuntime(fetch, hooks);
}

// 열 때 내려받는 화면(명령 팔레트·확인 대화상자 본문·행 안 동작·설정·언어 선택)의 한국어 원본을 등록한다(GLOBAL-PLAN G6 1단계).
// 그 화면 파일만 `import '@/lib/i18n/lazy'`로 가져온다. 홈 첫 로딩 부품이 가져오면 ko-lazy.ts가 홈 청크에 실린다(tests/i18n-coverage.test.mjs가 막는다).
import {koLazy} from './ko-lazy';
import {registerKorean} from '../i18n';
registerKorean(koLazy);

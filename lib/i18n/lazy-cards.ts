// 화면 구역 'cards'의 한국어 원본을 등록한다(GLOBAL-PLAN G6). 그 구역 문구를 쓰는 화면 파일만 `import '@/lib/i18n/lazy-cards'`로 가져온다.
import {koCards} from './ko-cards';
import {registerKorean} from '../i18n';
registerKorean(koCards);

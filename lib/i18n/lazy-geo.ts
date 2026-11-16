// 화면 구역 'geo'의 한국어 원본을 등록한다(GLOBAL-PLAN G6). 그 구역 문구를 쓰는 화면 파일만 `import '@/lib/i18n/lazy-geo'`로 가져온다.
import {koGeo} from './ko-geo';
import {registerKorean} from '../i18n';
registerKorean(koGeo);

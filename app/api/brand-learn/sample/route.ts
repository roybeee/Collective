import {BRAND_LEARN_SAMPLE_HTML} from '@/lib/brand-learn-sample';
// 테스트 전용 고정물(test fixture). 합성 브랜드 HTML을 그대로 돌려준다. 저장·인증·외부 호출 없음. 브랜드 자동 학습 E2E가 자기 서버의 이 주소를 읽는다(lib/brand-learn-sample.ts).
export function GET(){return new Response(BRAND_LEARN_SAMPLE_HTML,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Collective-Fixture':'brand-learn-sample'}})}

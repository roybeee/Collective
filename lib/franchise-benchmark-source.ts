// 트랙 R R7a: 공정위 공개 벤치마크 값을 브랜드 사실로 확정하지 못하게 하는 판정(순수 모듈, import 없음).
// 브랜드 사실 저장(lib/brand-facts-server.ts)이 호출 1줄로 쓴다. 모델 경로가 닿는 파일이라 벤치마크 적재·보기 모듈(lib/franchise-benchmark*.ts)과 떨어뜨려 둔다.
// 벤치마크 값은 타 브랜드의 공개 수치이고 자사 예상매출 근거가 아니다(docs/FRANCHISE-RECRUITMENT-PLAN.ko.md R7 절, 원칙 7). COLLECTIVE 휴리스틱 · 법률 자문 아님.

// 벤치마크 화면이 보여 주는 참조 표기(franchise_benchmark:<적재 id>)와 공정위 가맹정보 통계 API 주소·서비스 이름.
const BENCHMARK_SOURCE=/franchise_benchmark:|apis\.data\.go\.kr\/1130000\/Fftc|FftcBrand/i;
export const BENCHMARK_FACT_BLOCKED='공정위 공개 벤치마크 값은 브랜드 사실로 확정할 수 없습니다. 타 브랜드 공개 수치이며 자사 예상매출 근거가 아님. 정보공개서 버전에 묶인 자사 사실만 확정합니다.';
export const isBenchmarkSource=(source:string)=>BENCHMARK_SOURCE.test(source);

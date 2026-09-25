import type {BrandFact} from './brand-facts';
import {franchiseItem} from './fact-catalog';
import {FRANCHISE_FACT_MESSAGES} from './franchise-facts';

// 사실 카드에 넣을 수 있는지 판정한다. 문제가 없으면 null, 있으면 사용자에게 보일 문구를 돌려준다.
// 서버(confirmedFactContext·resolveFacts)가 최종 판정하고, 이 검사는 브라우저가 PNG를 만들기 전에 같은 조건을 먼저 막는다.
export function factCardIssue(brandId:string,facts:BrandFact[],now=Date.now()):string|null{
 if(!facts.length||facts.length>4)return '카드에 넣을 사실을 1~4개 선택하세요.';
 if(facts.some(f=>f.brandId!==brandId||f.status!=='confirmed'||!f.source.trim()||!f.value.trim()||!f.key.trim()||!Number.isFinite(Date.parse(f.verifiedAt))||Date.parse(f.verifiedAt)>now||!(Date.parse(f.validUntil)>now)))return '동일 브랜드의 유효한 확인 사실만 이미지에 사용할 수 있습니다.';
 const stores=new Set(facts.flatMap(f=>f.storeId?[f.storeId]:[]));
 if(stores.size>1||new Set(facts.map(f=>f.key)).size!==facts.length)return '서로 다른 지점 또는 중복 항목의 사실을 한 카드에 넣을 수 없습니다.';
 // 트랙 R H6: 정보공개서 근거가 있는 수익 항목(평균매출·직영점 매출·공헌이익·월 매출·수익률)은 카드에 쓰지 않는다. 화면은 key를 라벨로 바꿔 넘기므로 라벨·별칭도 받는다.
 if(facts.some(f=>!!f.sourceRef&&franchiseItem(f.key)?.adUse===false))return FRANCHISE_FACT_MESSAGES.revenueNoAd;
 return null;
}

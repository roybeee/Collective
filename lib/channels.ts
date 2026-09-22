// 학습 루프와 점포 마케팅이 공유하는 단일 채널 레지스트리.
// 키는 기존 레코드에 저장된 표시명 그대로다. 기존 viral_case/learning_rule의
// channel 값을 그대로 쓰기 위한 것이므로 키 문자열을 바꾸면 과거 데이터가 끊긴다.
// import가 없는 순수 데이터 모듈로 유지한다 (lib/learning.ts도 리프 모듈).
export type ChannelProfile = {
 // ruleApplies가 캠페인 채널 문구와 대조할 소문자 별칭.
 aliases: string[];
 // 원본 게시물 호스트를 특정할 수 있는 채널만 채운다. 없으면 공개 URL 검사만 한다.
 hosts?: string[];
 // lib/store-marketing.ts channelCatalog의 key. 점포 실험 → 학습 규칙 승격에 쓴다.
 storeKey?: string;
 // 사용자가 바이럴 사례로 직접 등록할 수 있는 채널인지.
 caseEligible: boolean;
};

export const channelRegistry: Record<string, ChannelProfile> = {
 Instagram: {aliases: ['instagram', '인스타그램', '인스타', '릴스'], hosts: ['instagram.com'], caseEligible: true},
 YouTube: {aliases: ['youtube', '유튜브', '쇼츠'], hosts: ['youtube.com'], caseEligible: true},
 TikTok: {aliases: ['tiktok', '틱톡'], hosts: ['tiktok.com'], caseEligible: true},
 Reddit: {aliases: ['reddit', '레딧'], hosts: ['reddit.com', 'redd.it'], caseEligible: true},
 '네이버 플레이스': {aliases: ['네이버 플레이스', '네이버플레이스', 'naver place', 'naver_place'], storeKey: 'naver_place', caseEligible: true},
 '네이버 검색광고': {aliases: ['네이버 검색광고', '네이버검색광고', '파워링크', 'naver_ads'], storeKey: 'naver_ads', caseEligible: true},
 블로그: {aliases: ['블로그', '네이버 블로그', 'blog'], storeKey: 'blog', caseEligible: true},
 '지역 맛집 페이지': {aliases: ['지역 맛집 페이지', '맛집 페이지', '지역 맛집', 'local_creator'], storeKey: 'local_creator', caseEligible: true},
 'SNS · 숏폼': {aliases: ['sns · 숏폼', '숏폼'], storeKey: 'social', caseEligible: true},
 당근: {aliases: ['당근', '당근마켓', 'daangn'], storeKey: 'daangn', caseEligible: true},
 '카카오맵 · 구글 지도': {aliases: ['카카오맵 · 구글 지도', '카카오맵', '구글 지도', 'google maps'], storeKey: 'maps', caseEligible: true},
 // 아래는 전환 채널이라 공개 게시물 사례가 없다. 점포 실험 승격 경로로만 규칙이 된다.
 '예약 · 포장 · 배달': {aliases: ['예약 · 포장 · 배달', '예약', '포장', '배달'], storeKey: 'orders', caseEligible: false},
 '카카오톡 · 재방문': {aliases: ['카카오톡 · 재방문', '카카오톡', '알림톡', '재방문'], storeKey: 'retention', caseEligible: false},
 '지역 제휴 · 커뮤니티': {aliases: ['지역 제휴 · 커뮤니티', '지역 제휴', '커뮤니티'], storeKey: 'partnership', caseEligible: false},
 '매장 · 오프라인 안내': {aliases: ['매장 · 오프라인 안내', '오프라인 안내', '매장 안내'], storeKey: 'offline', caseEligible: false},
};

// 알 수 없는 채널은 이름 자체를 별칭으로 취급한다. 과거 레코드 호환용.
export function channelAliases(name: string): string[] {
 return channelRegistry[name]?.aliases ?? [name.toLowerCase()];
}

export function channelHosts(name: string): string[] | undefined {
 return channelRegistry[name]?.hosts;
}

// channelCatalog의 key → 학습 규칙이 저장하는 표시명.
export function storeChannelName(storeKey: string): string | undefined {
 return Object.keys(channelRegistry).find(name => channelRegistry[name].storeKey === storeKey);
}

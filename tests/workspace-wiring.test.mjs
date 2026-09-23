// 화면 연결 고정(PR 5a 리뷰 반영). 계산은 lib/*.ts 스위트가, 실제 여정은 e2e/navigation.spec.ts가 확인한다.
// 여기서는 화면이 그 계산을 실제로 쓰는지(원문 검사, tests/campaign-store-link.test.mjs와 같은 방식)만 본다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=file=>readFileSync(file,'utf8');
const workspace=source('app/workspace.tsx'),detail=source('app/campaign-detail-panel.tsx'),brief=source('app/campaign-brief.tsx'),stores=source('app/store-marketing-panel.tsx'),learning=source('app/learning-panel.tsx');
let passed=0;const check=(name,fn)=>{try{fn();passed++}catch(error){console.error('FAIL:',name);throw error}};

// 상세: 폴링 tick마다 다시 읽지 않되(부모 data 객체 의존 금지), 캠페인 레코드(버전·수정 시각·상태·지점)가 바뀌면 다시 읽는다.
check('campaign detail refetches when the campaign record changes, not on every parent reload',()=>{assert.match(detail,/\},\[id,c\.version,c\.updatedAt,c\.status,c\.storeId\]\);/);assert.doesNotMatch(detail,/\[id,props\.data\]/)});

// 작업물 카드 미리보기: 첫 비제목 문단, 내부 식별자 제거.
check('asset cards use artifactPreview',()=>{assert.ok(workspace.includes('<p>{artifactPreview(a.content)}</p>'));assert.ok(!workspace.includes("a.content.replace(/[#*]/g,'')"))});

// 캠페인 목록 진행 막대: 사용 가능한 역할 수 / 역할 수.
check('campaign progress counts usable roles out of all roles',()=>{assert.ok(workspace.includes('usableRoleCount(c,data.artifacts)'));assert.ok(workspace.includes('count/roles.length*100'));assert.ok(!workspace.includes('count/8'))});

// 진행 중 캠페인 설명과 샘플 표시는 lib/workspace-metrics.ts 정의에서 만든다.
check('the in-progress card note comes from the metrics definition',()=>{assert.ok(workspace.includes('activeCampaignNote'));assert.ok(!workspace.includes('초안·승인 제외'))});
check('the seed sample campaign is labelled apart',()=>{assert.ok(workspace.includes('metrics.sampleCampaigns'));assert.ok(workspace.includes('isSampleCampaign(c)'))});

// 상단 연결 상태: 불러오기 전·실패 때 '기획 모드'로 단정하지 않는다.
check('the mode pill waits for the workspace before claiming a mode',()=>assert.ok(workspace.includes("!loaded?(error?'연결 상태 확인 불가':'연결 확인 중')")));

// 목표에 다른 브랜드 이름이 있으면 HERMES 초안을 자동으로 요청하지 않는다.
check('the brief dialog auto-starts only when the goal names no other brand',()=>{assert.match(brief,/else if\(autoStart&&canAutoDraft\(goal,brands,startBrand\)&&!edit\)void generate\(next\);/);assert.doesNotMatch(brief,/else if\(autoStart&&goal\.trim\(\)&&!edit\)/)});
check('the workspace composer warns before opening and only auto-drafts a matching goal',()=>{assert.ok(workspace.includes('otherBrandMentions(brief,data.brands,brandId)'));assert.ok(workspace.includes('setAutoDraft(canAutoDraft(brief,data.brands,brandId))'))});

// 점포 마케팅의 지점 선택은 주소(?store=)와 연결된다.
check('the store panel receives and reports the store in the address',()=>{assert.ok(workspace.includes('initialStoreId={route.store}'));assert.ok(workspace.includes('onScopeChange='));assert.match(stores,/initialStoreId\?:string/);assert.ok((stores.match(/scope\.current\?\.\(/g)||[]).length>=4)});

// 비동기 뒤 캠페인을 열 때 그 사이 이동한 화면을 덮어쓰지 않는다. 늦게 도착한 옛 응답이 새 데이터를 덮지 않는다.
check('opening a campaign applies to the latest route',()=>assert.match(workspace,/function setSelectedId\(id:string\|null\)\{setRoute\(r=>/));
check('an older workspace response never replaces a newer one',()=>assert.match(workspace,/const seq=\+\+reloadSeq\.current\.started/));

// 기본 브랜드는 처음 불러올 때 한 번 정하고 이후 활동 변화로 바뀌지 않는다.
check('the default brand is fixed once when data arrives',()=>{assert.ok(workspace.includes('setBrandId(b=>'));assert.ok(learning.includes('setPicked(p=>'));assert.ok(!learning.includes('recentBrandId'))});

// loop-7·loop-11: 학습 화면 링크(?view=learning&brand=&tab=)로 브랜드·탭을 연다. 링크 브랜드는 직접 고른 것처럼 기억하고,
// 화면에서 고른 브랜드·탭은 주소에 남겨(replace) 새로고침 때 링크 값이 사용자의 선택을 덮지 않는다(점포 마케팅의 ?brand=&store=와 같은 방식).
check('the learning view receives the linked brand and tab and reports changes',()=>{assert.ok(workspace.includes('initialBrandId={route.brand}'));assert.ok(workspace.includes('initialTab={route.tab}'));assert.ok(workspace.includes('onScopeChange={setLearningScope}'));assert.match(workspace,/function setLearningScope\(brand:string,tab:string\)\{const next=normalizeNav\([^)]*\);replaceUrl\.current=serializeNav\(next\);setRoute\(r=>r\.view==='learning'\?/)});
check('the learning panel starts from the linked brand and tab',()=>{assert.ok(learning.includes('useState<string|null>(()=>initialBrandId??storedBrand())'));assert.ok(learning.includes("useState<string>(initialTab??'cases')"));assert.ok(learning.includes('rememberBrand(initialBrandId)'))});
check('the learning panel follows a new link while open',()=>assert.match(learning,/if\(link\.brand!==initialBrandId\|\|link\.tab!==initialTab\)\{setLink\(/));
check('brand and tab changes in the learning panel are reported',()=>{assert.ok(learning.includes('onScopeChange?.(id,tab)'));assert.ok(learning.includes("onScopeChange?.(initialBrandId??'',t)"));assert.ok(!learning.includes('onScopeChange?.(brandId,t)'))});
// loop-11: 만료 임박 규칙 알림은 학습 화면 밖(워크스페이스 첫 화면)에도 보이고 규칙 탭으로 바로 간다.
check('the overview shows the expiring rule alert with a link to the rules tab',()=>{assert.ok(workspace.includes('<ExpiringRulesAlert'));assert.ok(workspace.includes("navigate({view:'learning',brand,tab:'rules'})"));assert.ok(learning.includes("fetch('/api/learning?only=expiring')"))});
console.log(JSON.stringify({passed},null,2));

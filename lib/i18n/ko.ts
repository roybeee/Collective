// 화면 문구 원본(GLOBAL-PLAN G6 1단계). 한국어가 기준이며 이 파일은 홈 첫 로딩에 그대로 실린다(홈이 그리는 문구만 둔다).
// 열 때 내려받는 화면(명령 팔레트·확인 대화상자 본문·행 안 동작·설정)의 한국어 원본은 ko-lazy.ts에 있고 그 화면 청크에 실린다.
// 영어(en.ts)·일본어(ja.ts)는 두 파일의 키를 모두 가져야 한다(tests/i18n-coverage.test.mjs).
// 값의 {name}은 t(key,{name})로 채운다. 복수형 규칙은 두지 않는다(숫자는 '{n}건'처럼 단위와 함께 쓴다). 키 추가 방법은 docs/I18N.ko.md.
export const ko={
 // 사이드바 메뉴와 화면 설명(app/workspace.tsx)
 'nav.overview':'워크스페이스','nav.learning':'바이럴 학습','nav.campaigns':'캠페인','nav.brands':'브랜드 아카이브','nav.stores':'점포 마케팅','nav.agents':'AI 팀','nav.assets':'작업물','nav.results':'성과 분석','nav.research':'상품 리서치','nav.franchise':'가맹 모집','nav.settings':'연결 및 설정',
 'desc.overview':'브랜드의 다음 성장을, 함께 만듭니다.','desc.learning':'발견한 성공 이유를 실험하고, 다음 제작에 반영합니다.','desc.campaigns':'목표에서 실행안까지, 모든 캠페인을 한곳에서.','desc.brands':'브랜드 이해부터 근거 조사, 진단과 전략까지.','desc.stores':'지점별 상권 진단에서 실제 방문·구매와 재방문까지.','desc.agents':'서로 다른 전문성으로, 하나의 성장을 만듭니다.','desc.assets':'전략, 카피, 제작안. 팀이 만든 결과를 검토하세요.','desc.results':'실제 매출과 비용으로 다음 결정을 내립니다.','desc.research':'시장 지표로 후보를 찾고, 근거와 함께 선정합니다.','desc.franchise':'가맹 문의부터 계약까지, 절차를 지키며 관리합니다.','desc.settings':'AI 팀이 일할 수 있도록 연결을 관리합니다.',
 // 셸(사이드바·머리 띠·화면 제목)
 'shell.skip':'본문으로 건너뛰기','shell.sidebar':'사이드바','shell.home':'COLLECTIVE 홈','shell.workspaceKind':'마케팅 워크스페이스','shell.mainMenu':'주 메뉴','shell.menu':'메뉴','shell.myBrands':'내 브랜드','shell.qualityConsole':'품질 콘솔',
 'shell.search':'검색','shell.searchTitle':'화면·캠페인·기록 검색(/)','shell.connUnknown':'연결 상태 확인 불가','shell.connChecking':'연결 확인 중','shell.connAi':'AI 연결됨','shell.connPlanning':'기획 모드','shell.preview':'(미리보기)',
 'shell.workspaceEyebrow':'{name} 워크스페이스','shell.newBrand':'새 브랜드','shell.recordMetric':'성과 기록','shell.newCampaign':'새 캠페인','shell.needCampaign':'캠페인을 먼저 만드세요.','shell.retry':'다시 시도','shell.loadingWorkspace':'워크스페이스를 불러오고 있습니다.',
 // 테마 버튼(components/app/theme-toggle.tsx)
 'theme.system':'시스템','theme.light':'라이트','theme.dark':'다크','theme.label':'화면 테마: {current}. 누르면 {next}',
 // 새 캠페인 브리프 카드(홈)
 'brief.step':'1단계 브리프','brief.headline1':'어떤 성장을','brief.headline2':'만들고 싶으신가요','brief.lead':'목표 한 줄이면, HERMES가 첫 캠페인 초안을 채웁니다.','brief.goalLabel':'캠페인 목표','brief.placeholder':'예: {brand}의 평일 방문을 늘리는 캠페인을 기획해줘.','brief.ourBrand':'우리 브랜드','brief.brandLabel':'캠페인 브랜드',
 'brief.fillRequired':'필수 칸을 먼저 채우세요.','brief.loading':'불러오는 중입니다.','brief.draft':'HERMES 초안 만들기','brief.conflict':'목표에 다른 브랜드({names}) 이름이 있습니다. 선택한 브랜드는 {brand}입니다. 브랜드를 확인한 뒤 초안 화면에서 HERMES에 요청하세요.','brief.unselected':'미선택',
 // 홈 지표 타일
 'stats.active':'진행 중 캠페인','stats.countUnit':'개','stats.itemUnit':'건','stats.activeNote':'실제 캠페인 {total}개 중','stats.sampleNote':'(샘플 {n}개는 따로 셈)','stats.review':'검토할 작업','stats.needsWork':'보완 필요 {n}건 제외','stats.reviewNote':'결과물을 검토하고 결정하세요',
 'stats.next':'다음 할 일','stats.nextBlocked':'실패한 실행·보완 작업을 먼저 확인하세요','stats.nextClear':'지금 막힌 실행이 없습니다','stats.brands':'브랜드','stats.brandsNote':'브랜드 아카이브에서 근거를 관리합니다',
 // 오늘의 안건(app/agenda-panel.tsx)
 'agenda.eyebrow':'오늘','agenda.title':'오늘의 안건','agenda.tab.all':'전체','agenda.tab.decide':'결정','agenda.tab.ask':'질문','agenda.tab.notify':'알림','agenda.tabsLabel':'안건 탭','agenda.tabCount':'{tab} {n}건',
 'agenda.emptyNext.all':'새 기한·승인 요청·질문·감지 신호가 생기면 여기에 모입니다.','agenda.emptyNext.decide':'작업물·발행·회의·자료 요청의 승인이 필요하면 여기에 모입니다.','agenda.emptyNext.ask':'브리프 확인 질문과 회의의 확인할 사실이 생기면 여기에 모입니다.','agenda.emptyNext.notify':'새 감지 신호와 다가오는 기한이 생기면 여기에 모입니다.',
 'agenda.loadFailed':'안건을 불러오지 못했습니다.','agenda.assignee':'담당자','agenda.ackFailed':'맡지 못했습니다.','agenda.ackDone':'{n}건을 맡았습니다.','agenda.ackSomeFailed':' {n}건은 처리하지 못했습니다({list}).','agenda.snoozed':"'{title}'을 이 기기에서 24시간 미뤘습니다.",
 'agenda.approveSelectedTitle':'선택한 {n}건을 승인할까요?','agenda.batchReversible':'작업물 승인은 이력에 남고 새 판을 저장하면 다시 검토합니다. 발행 승인은 접수 전까지 취소할 수 있습니다.','agenda.batchImpact':'한 건씩 차례로 승인합니다. 한 건이 실패해도 다음 건은 계속하고 건별 결과를 아래에 남깁니다.','agenda.batchUndo':'승인 기록은 각 캠페인 이력에 남습니다.','agenda.approveSelected':'선택 승인',
 'agenda.summary':'안건 요약','agenda.batchResults':'일괄 승인 결과','agenda.resultFailed':'실패, {message}','agenda.loading':'안건을 모으고 있습니다.','agenda.reload':'다시 불러오기','agenda.emptySnoozed':'미룬 {n}건 외에 지금 처리할 안건이 없습니다.','agenda.empty':'지금 처리할 안건이 없습니다.','agenda.list':'안건 목록',
 'agenda.ackLabel':'{title} 내가 맡기','agenda.ackUntil':'내가 맡기({date}까지)','agenda.ackAll':'새 신호 {n}건 모두 내가 맡기','agenda.approveSelectedCount':'선택 승인 {n}건','agenda.withCost':' (비용 {amount})','agenda.refreshLabel':'안건 새로고침','agenda.refresh':'새로고침',
 'agenda.keys':'자판','agenda.keyMove':'이동','agenda.keyRow':'행 안 동작','agenda.topOnly':'상위 {shown}건만 보입니다(전체 {total}건).',
 // 결정 인박스 행(components/app/inbox-row.tsx). 행 안 동작 문장은 ko-lazy.ts
 'inbox.kind.overdue':'기한 초과','inbox.kind.decision':'결정 대기','inbox.kind.question':'질문','inbox.kind.signal':'새 신호','inbox.kind.upcoming':'다가오는 기한',
 'inbox.select':'{title} 선택','inbox.cost':'비용 {amount}','inbox.approve':'승인','inbox.requestChanges':'수정 요청','inbox.snooze':'미루기','inbox.changesField':'수정 요청 내용 (필수)','inbox.writeFirst':'수정 요청 내용을 먼저 적으세요.','inbox.send':'수정 요청 보내기','inbox.close':'닫기',
 'inbox.failed':'처리하지 못했습니다.',
 // 확인 대화상자 이름표(components/app/confirm-dialog.tsx). 대화상자 본문 문구는 ko-lazy.ts
 'confirm.what':'무엇','confirm.where':'어디','confirm.when':'언제','confirm.cost':'비용','confirm.reversible':'되돌림','confirm.changesPlaceholder':'무엇을 어떻게 바꿔야 하는지 적어 주세요.',
 // 빈 상태(components/app/empty-line.tsx)
 'empty.first':'첫 {thing} 쓰기',
 // 범위 역할 거절 이유(app/agenda-panel.tsx, 레인 X-G)
 'access.deniedApprove':'이 브랜드의 승인 권한이 없습니다.','access.deniedPublish':'이 브랜드의 발행 권한이 없습니다.',
} as const;
export type HomeKey=keyof typeof ko;
// 열 때 내려받는 화면 구역(ko-lazy.ts 공통, ko-<구역>.ts)과 서버 안건 문장(ko-agenda.ts, 화면에 등록하지 않는다)의 키. 형식만 가져오므로 홈 청크에 사전이 실리지 않는다.
export type MessageKey=HomeKey|keyof typeof import('./ko-lazy').koLazy|keyof typeof import('./ko-campaign').koCampaign|keyof typeof import('./ko-exec').koExec|keyof typeof import('./ko-settings').koSettings|keyof typeof import('./ko-trust').koTrust|keyof typeof import('./ko-cards').koCards|keyof typeof import('./ko-agenda').koAgenda;

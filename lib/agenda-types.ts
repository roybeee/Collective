// 홈 '오늘의 안건' 항목 형식(서버 lib/agenda-server.ts가 만들고 화면 app/agenda-panel.tsx가 그린다). 선언만 둔다(브라우저 번들에 들어간다).
// 결정 인박스 v2(GLOBAL-PLAN X1): 탭 결정(기한 초과·결정 대기)/질문/알림(새 신호·다가오는 기한), 어디(브랜드·지점·계정)·비용·행 안 동작(action)을 함께 돌려준다.
import type {CampaignTab} from './nav-state';
export type AgendaKind='overdue'|'decision'|'question'|'signal'|'upcoming';
export type AgendaTab='decide'|'ask'|'notify';
export const agendaTabs:{tab:AgendaTab;label:string;kinds:AgendaKind[]}[]=[{tab:'decide',label:'결정',kinds:['overdue','decision']},{tab:'ask',label:'질문',kinds:['question']},{tab:'notify',label:'알림',kinds:['signal','upcoming']}];
export const agendaTabOf=(kind:AgendaKind):AgendaTab=>agendaTabs.find(t=>t.kinds.includes(kind))?.tab??'decide';
// quick: 안건 행에서 바로 처리할 수 있는 동작(UX-PLAN-3 10.3). 기본값을 채워 두고 사람은 확인만 한다. 외부 실행은 없다.
export type AgendaQuick={type:'acknowledge_signal';recordId:string;version:number;campaignVersion:number;nextAction:string;dueBy:string};
// action: 기존 API로 행 안에서 승인·수정 요청할 수 있는 결정. review_artifact → POST /api/action, approve_publication → POST /api/execution(관리자).
export type AgendaAction=
 |{type:'review_artifact';recordId:string;version:number;role:string}
 |{type:'approve_publication';recordId:string;version:number;aiCopy:boolean;codedPng:boolean};
export type AgendaSource='growth'|'artifact'|'publication'|'meeting'|'sequence'|'data_request'|'brief';
// panel: 행을 누르면 바로 열 성장 탭 접기 패널의 제목(components/app/lazy-panel.tsx). ctab: 성장 탭이 아닌 출처가 열 캠페인 탭(없으면 성장 섹션으로 이동).
// where: 브랜드·지점·계정처럼 '어디'를 적는 조각(문장 아님). cost: 예정 비용(원, 없으면 null).
export type AgendaItem={id:string;kind:AgendaKind;source?:AgendaSource;title:string;detail:string;campaignId:string;campaignTitle:string;where?:string[];due:string|null;cost?:number|null;section:'decide'|'execute'|'observe'|'prepare'|'evidence'|'learn';panel?:string;ctab?:CampaignTab;quick?:AgendaQuick;action?:AgendaAction};
export type AgendaCounts=Record<AgendaKind,number>;
export type Agenda={items:AgendaItem[];counts:AgendaCounts;tabs:Record<AgendaTab,number>;total:number;generatedAt:string};

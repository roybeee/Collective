'use client';
// 연결 및 설정의 섹션 탭(X-F). 한 화면에 모든 카드를 쌓지 않고 연결(AI·작업자), 채널 연결, 자동화 규칙, 사용량·비용, 팀·권한, 기능표로 나눈다.
// 탭은 주소(?view=settings&section=)에 남는다(lib/nav-state.ts settingsTabOf). 옛 카드 id(settings-ai 등)로 온 링크는 그 카드가 든 탭을 연 뒤 카드로 스크롤한다.
// 데스크톱은 왼쪽 세로 목록(위아래 화살표), 휴대폰은 위쪽 가로 목록(좌우 화살표)이다. 탭 내용은 고른 탭만 그린다(Radix Tabs).
// 채널 연결·자동화 규칙 카드는 그 탭을 열 때 내려받는다(설정 화면 첫 로딩을 가볍게 둔다).
import {lazy,Suspense,useEffect,useState,type ReactNode} from 'react';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {ScreenSkeleton} from '@/components/app/screen-skeleton';
import {StatList} from '@/components/app/stat-list';
import {Note} from '@/components/app/note';
import {useIsMobile} from '@/hooks/use-mobile';
import {parseNav,pushNav,serializeNav,settingsTabOf,settingsTabs,type SettingsTab} from '@/lib/nav-state';
import type {WorkspaceData} from '@/lib/client';
import {accountRoleLabels,useAccount} from './account-context';

const SettingsChannels=lazy(()=>import('./settings-channels').then(m=>({default:m.SettingsChannels})));
const AutonomyPanel=lazy(()=>import('./autonomy-panel').then(m=>({default:m.AutonomyPanel})));
export const settingsTabLabels:Record<SettingsTab,string>={connect:'연결(AI·작업자)',channels:'채널 연결',automation:'자동화 규칙',usage:'사용량·비용',team:'팀·권한',features:'기능표'};
const currentTab=():SettingsTab=>typeof window==='undefined'?'connect':parseNav(window.location.search).section??'connect';

// 카드 id(settings-ai 등)나 탭 값으로 설정 안의 자리를 연다. 카드가 이미 화면에 있으면 바로 스크롤하고, 없으면 그 탭을 연 뒤 카드가 그려지면 스크롤한다.
export function openSettingsSection(section:string){
 const card=section.startsWith('settings-')?section:null,now=card&&document.getElementById(card);
 if(now){now.scrollIntoView({behavior:'smooth',block:'start'});return}
 pushNav({view:'settings',section});
 if(!card)return;
 // 탭의 다른 카드가 늦게 그려지면(lazy) 자리가 밀리므로 찾은 뒤에도 잠시 다시 맞춘다.
 let tries=0,settle=0;const find=()=>{const el=document.getElementById(card);if(el){el.scrollIntoView({block:'start'});if(++settle<10)window.setTimeout(find,150);return}if(++tries<40)window.setTimeout(find,50)};window.setTimeout(find,0);
}

// 탭을 바꾸면 주소만 바꾼다(뒤로 가기 기록을 늘리지 않음). 워크스페이스가 주소를 다시 읽도록 popstate를 보낸다.
function useSettingsTab():[SettingsTab,(next:string)=>void]{
 const [tab,setTab]=useState<SettingsTab>(currentTab);
 useEffect(()=>{const sync=()=>setTab(currentTab());window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync)},[]);
 const choose=(next:string)=>{const section=settingsTabOf(next);if(!section)return;setTab(section);history.replaceState(null,'',location.pathname+serializeNav({...parseNav(location.search),section}));window.dispatchEvent(new PopStateEvent('popstate'))};
 return [tab,choose];
}

// 팀과 권한: 역할별로 바꿀 수 있는 것. 판정은 서버가 한다(lib/server.ts requireAdminActor·requireOwnerActor).
const roleRules:readonly (readonly [string,string])[]=[
 ['대표(소유자)','모든 연결과 해제, 기능 스위치, 카카오 딜러 연결, POS 연결 설정'],
 ['관리자','AI 팀·채널 연결, 광고 제안 승인과 반영, 수신동의 원장, 예약 실행'],
 ['직원','캠페인 작업과 조회. 연결·스위치·승인은 바꿀 수 없습니다'],
];
function TeamCard(){
 const account=useAccount();
 return <section className="settings-card" aria-labelledby="settings-team-title"><h2 id="settings-team-title">팀·권한</h2>
  <p>내 역할에 따라 바꿀 수 있는 설정이 다릅니다.</p>
  <StatList label="내 계정" items={[['로그인 계정',account?.email??(account?'워크스페이스 소유자':'확인하지 못함')],['역할',account?accountRoleLabels[account.role]:'확인하지 못함']]}/>
  <StatList label="역할별 권한" items={roleRules}/>
  <Note>팀원 초대와 역할 변경은 화면 위 계정 메뉴의 ‘팀 계정 관리’에서 합니다. 대표·관리자에게만 보입니다.</Note>
 </section>;
}

const loading=<ScreenSkeleton label="카드를 불러오고 있습니다." rows={3}/>;
export function SettingsShell({data,reload,connect,channels,usage,features}:{data:WorkspaceData;reload:()=>Promise<void>;connect:ReactNode;channels:ReactNode;usage:ReactNode;features:ReactNode}){
 const [tab,choose]=useSettingsTab(),mobile=useIsMobile();
 const body:Record<SettingsTab,ReactNode>={
  connect,
  channels:<><Suspense fallback={loading}><SettingsChannels brands={data.brands} campaigns={data.campaigns} reload={reload}/></Suspense>{channels}</>,
  automation:<section className="settings-card" aria-labelledby="settings-automation-title"><h2 id="settings-automation-title">자동화 규칙</h2><p>행동별 자율성과 예약 실행을 정합니다.</p><Suspense fallback={loading}><AutonomyPanel/></Suspense></section>,
  usage,team:<TeamCard/>,features,
 };
 return <Tabs value={tab} onValueChange={choose} orientation={mobile?'horizontal':'vertical'} className="settings-tabs">
  <nav className="settings-nav" aria-label="설정 바로가기"><TabsList aria-label="설정 섹션">{settingsTabs.map(t=><TabsTrigger key={t} value={t}>{settingsTabLabels[t]}</TabsTrigger>)}</TabsList></nav>
  {settingsTabs.map(t=><TabsContent key={t} value={t} className="settings-layout" data-section={t}>{body[t]}</TabsContent>)}
 </Tabs>;
}

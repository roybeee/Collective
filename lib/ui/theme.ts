// 화면 테마(GLOBAL-PLAN X5). next-themes 대신 쓰는 작은 구현이다: 홈 첫 로딩 예산(tests/ux-budget.json homeJsGzKB)을 지키려고 공급자 없이 html.dark 클래스와 localStorage 'theme' 한 값만 다룬다.
// 저장 값은 next-themes와 같은 키·값('system'|'light'|'dark')이라 이전에 저장된 선택이 그대로 이어진다.
export type ThemeMode='system'|'light'|'dark';
export const THEME_KEY='theme';
const DARK_QUERY='(prefers-color-scheme: dark)';
// 첫 그림 전에 html에 .dark를 붙인다(깜빡임 방지). 고정 문자열이며 사용자 값이 없다. 저장소를 못 쓰면 시스템 설정을 따른다.
export const THEME_BOOT_SCRIPT=`(function(){var d=false;try{var t=localStorage.getItem('${THEME_KEY}');d=t==='dark'||(t!=='light'&&matchMedia('${DARK_QUERY}').matches)}catch(e){}document.documentElement.classList.toggle('dark',d)})()`;
const listeners=new Set<()=>void>();
const systemDark=()=>typeof matchMedia==='function'&&matchMedia(DARK_QUERY).matches;
export function readTheme():ThemeMode{try{const v=localStorage.getItem(THEME_KEY);return v==='light'||v==='dark'?v:'system'}catch{return 'system'}}
export function applyTheme(mode:ThemeMode){document.documentElement.classList.toggle('dark',mode==='dark'||(mode==='system'&&systemDark()))}
export function setTheme(mode:ThemeMode){try{localStorage.setItem(THEME_KEY,mode)}catch{/* 사생활 보호 모드 등: 이번 화면에만 적용 */}applyTheme(mode);listeners.forEach(l=>l())}
// useSyncExternalStore 구독: 버튼 변경·OS 설정 변경(시스템일 때)·다른 탭의 저장을 모두 반영한다.
export function subscribeTheme(listener:()=>void){
 listeners.add(listener);
 const query=typeof matchMedia==='function'?matchMedia(DARK_QUERY):null;
 const onSystem=()=>{if(readTheme()==='system')applyTheme('system');listener()};
 const onStorage=(e:StorageEvent)=>{if(e.key===THEME_KEY){applyTheme(readTheme());listener()}};
 query?.addEventListener('change',onSystem);window.addEventListener('storage',onStorage);
 return()=>{listeners.delete(listener);query?.removeEventListener('change',onSystem);window.removeEventListener('storage',onStorage)};
}

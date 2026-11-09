// 라이트·다크 색 토큰 대비 게이트(GLOBAL-PLAN X5). app/globals.css의 :root(팔레트·의미 토큰)와 .dark를 읽어 var()를 풀고 hex·oklch를 sRGB로 바꿔 WCAG 2.x 대비를 잰다.
// 글자 쌍은 4.5:1(AA 본문), 위험색 면·버튼 글자는 3:1(큰 글자·UI 구성요소 기준, 아래 표의 min). 두 테마 모두 통과해야 한다. 표는 PR 보고용으로 stdout에 찍는다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync('app/globals.css','utf8');

// 블록 안의 --토큰: 값 쌍을 읽는다. 선택자별 블록이 여러 개면 모두 합친다(:root는 팔레트 줄과 의미 토큰 블록 두 개).
const declsOf=selector=>{
 const out={};const re=new RegExp(`(^|\\n)${selector.replace('.','\\.')}\\s*\\{([^}]*)\\}`,'g');
 for(const m of css.matchAll(re))for(const d of m[2].replace(/\/\*[\s\S]*?\*\//g,'').split(';')){const i=d.indexOf(':');if(i<0)continue;const k=d.slice(0,i).trim(),v=d.slice(i+1).trim();if(k.startsWith('--'))out[k.slice(2)]=v}
 return out;
};
const light=declsOf(':root'),dark={...light,...declsOf('.dark')};
assert.ok(Object.keys(declsOf('.dark')).length>40,'.dark 토큰 블록이 있어야 한다');

const resolve=(tokens,value,depth=0)=>{
 assert.ok(depth<10,`토큰 참조가 너무 깊다: ${value}`);
 const m=value.match(/^var\(--([a-z0-9-]+)\)$/);
 if(!m)return value;
 assert.ok(tokens[m[1]]!==undefined,`정의되지 않은 토큰 --${m[1]}`);
 return resolve(tokens,tokens[m[1]],depth+1);
};
const clamp01=x=>Math.min(1,Math.max(0,x));
const oklchToLinear=(L,C,h)=>{
 const a=C*Math.cos(h*Math.PI/180),b=C*Math.sin(h*Math.PI/180);
 const l_=L+0.3963377774*a+0.2158037573*b,m_=L-0.1055613458*a-0.0638541728*b,s_=L-0.0894841775*a-1.2914855480*b;
 const l=l_**3,m=m_**3,s=s_**3;
 return [4.0767416621*l-3.3077115913*m+0.2309699292*s,-1.2684380046*l+2.6097574011*m-0.3413193965*s,-0.0041960863*l-0.7034186147*m+1.7076147010*s].map(clamp01);
};
const srgbToLinear=c=>{c/=255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4};
// 색 문자열 → [선형 r,g,b, alpha]. hex(3·6자리)와 oklch(L C h [/ A%])만 쓴다.
const parse=value=>{
 let m=value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
 if(m){let h=m[1];if(h.length===3)h=[...h].map(c=>c+c).join('');return [...[0,2,4].map(i=>srgbToLinear(parseInt(h.slice(i,i+2),16))),1]}
 m=value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/);
 assert.ok(m,`해석할 수 없는 색: ${value}`);
 const alpha=m[4]===undefined?1:Number(m[4])/(m[5]?100:1);
 return [...oklchToLinear(Number(m[1]),Number(m[2]),Number(m[3])),alpha];
};
const over=(fg,bg)=>fg[3]>=1?fg:[0,1,2].map(i=>fg[i]*fg[3]+bg[i]*(1-fg[3])).concat(1);
const luminance=([r,g,b])=>0.2126*r+0.7152*g+0.0722*b;
const ratio=(fg,bg)=>{const l1=luminance(fg),l2=luminance(bg);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)};
const contrast=(tokens,fgName,bgName)=>{
 const bg=over(parse(resolve(tokens,`var(--${bgName})`)),parse(resolve(tokens,'var(--background)')));
 const fg=over(parse(resolve(tokens,`var(--${fgName})`)),bg);
 return ratio(fg,bg);
};

// [글자 토큰, 배경 토큰, 최소 대비, 쓰이는 곳]. 3:1은 큰 글자(18.66px 굵게·24px) 또는 UI 구성요소·위험색 면에만 쓴다.
const pairs=[
 ['foreground','background',4.5,'본문'],
 ['card-foreground','card',4.5,'카드'],
 ['popover-foreground','popover',4.5,'팝오버·대화상자'],
 ['muted-foreground','muted',4.5,'흐린 설명 글자'],
 ['primary-foreground','primary',4.5,'기본 버튼'],
 ['secondary-foreground','secondary',4.5,'보조 버튼'],
 ['accent-foreground','accent',4.5,'강조 면'],
 ['sidebar-foreground','sidebar',4.5,'사이드바'],
 ['destructive','background',3,'위험색 면(UI 구성요소 3:1)'],
 ['destructive-foreground','red-38',3,'위험 확인 버튼 글자(.confirm-danger, 굵은 버튼 글자 3:1)'],
 // 팔레트 쌍: 화면 CSS가 가장 많이 쓰는 글자↔면 조합.
 ['neutral-17','background',4.5,'body 글자'],
 ['neutral-17','card',4.5,'카드 제목·숫자'],
 ['green-44','background',4.5,'보조 글자(.why-disabled·.stat-list dt 등)'],
 ['green-44','neutral-97',4.5,'회색 면 위 보조 글자(.safety-scope·.agenda-counts)'],
 ['green-32','neutral-97',4.5,'회색 면 위 글자(.agenda-counts li·.archive-suggestion)'],
 ['green-23','card',4.5,'설정 바로가기 글자(.settings-nav a)'],
 ['red-38','background',4.5,'칸 오류·삭제 버튼 글자'],
 ['red-36','neutral-97',4.5,'안건 지연 글자(.agenda-counts overdue)'],
 ['red-33','red-97',4.5,'삭제 버튼 hover'],
 ['yellow-35','neutral-97',4.5,'결정 필요 글자(.agenda-counts decision·.quality-partial)'],
 ['blue-44','neutral-97',4.5,'진행 중 배지(.status-running)'],
 ['orange-44','neutral-97',4.5,'다음 할 일 단계(.next-tasks .step)'],
 ['olive-42','neutral-97',4.5,'완료 단계 글자(.step.done)'],
 ['olive-35','olive-95',4.5,'좋은 태그(.learning-tag.good·.store-tag.done)'],
 ['green-23','olive-91',4.5,'라임 버튼 글자(.lime-button)'],
 ['neutral-17','olive-91',4.5,'로고·시작 버튼 글자(.logo-mark·.auth-primary)'],
 ['primary-foreground','neutral-17',4.5,'어두운 카드 글자(.brief-card·.learning-command·.goal-workbench)'],
 ['green-77','neutral-17',4.5,'어두운 카드 보조 글자(.learning-meta·.generate-row p)'],
 ['red-80','neutral-17',4.5,'어두운 브리프 카드 오류 글자(.brief-composer .form-error)'],
 ['neutral-90','neutral-17',4.5,'어두운 카드 비활성 이유(.why-disabled)'],
 ['olive-91','neutral-17',3,'어두운 카드 강조 제목(.brief-card h2>span, 20px+ 굵게)'],
];
let passed=0;const rows=[];const failures=[];
for(const [fg,bg,min,where] of pairs){
 const l=contrast(light,fg,bg),d=contrast(dark,fg,bg);
 rows.push(`${`${fg}/${bg}`.padEnd(34)} ${String(min).padStart(4)}  light ${l.toFixed(2).padStart(6)}  dark ${d.toFixed(2).padStart(6)}  ${where}`);
 for(const [theme,r] of [['light',l],['dark',d]]){if(r>=min)passed++;else failures.push(`${theme} ${fg}/${bg} ${r.toFixed(2)} < ${min} (${where})`)}
}
console.log(['토큰 쌍                              최소  라이트   다크', ...rows].join('\n'));
assert.deepEqual(failures,[],`대비 미달:\n${failures.join('\n')}`);
// 다크 배경은 순수 검정이 아니고(0.145), 모든 라이트 의미 토큰에 다크 짝이 있다.
const darkOnly=declsOf('.dark');
assert.ok(darkOnly.background.startsWith('oklch(0.145'),'다크 배경은 oklch(0.145 …)');passed++;
const semantic=Object.keys(declsOf(':root')).filter(k=>!/^[a-z]+-\d+(-\d+)?$/.test(k)&&k!=='radius');
const missing=semantic.filter(k=>darkOnly[k]===undefined);
assert.deepEqual(missing,[],`다크 짝이 없는 의미 토큰: ${missing.join(', ')}`);passed++;
console.log(JSON.stringify({passed}));

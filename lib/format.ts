// 화면 표시 형식(UX-PLAN P2). 통화·날짜·기간·건수를 한 벌로 맞춘다. 값이 없으면 0으로 바꾸지 않고 '미확인'을 쓴다.
// 시각은 서울 시간(KST)으로 보이고, 원본 ISO 문자열·밀리초·영문 enum은 화면에 내지 않는다.
const KST='Asia/Seoul';
export const UNKNOWN='미확인';
const number=new Intl.NumberFormat('ko-KR');
const parts=(date:Date)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:KST,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value])) as Record<string,string>;
const valid=(value:unknown):Date|null=>{if(value===null||value===undefined||value==='')return null;const d=value instanceof Date?value:new Date(String(value));return Number.isFinite(d.getTime())?d:null};
/** 19800 → '19,800원'. null·NaN은 '미확인'. */
export function money(value:number|null|undefined,empty=UNKNOWN){return typeof value==='number'&&Number.isFinite(value)?`${number.format(value)}원`:empty}
/** 1234 → '1,234'. */
export function count(value:number|null|undefined,unit='',empty=UNKNOWN){return typeof value==='number'&&Number.isFinite(value)?`${number.format(value)}${unit}`:empty}
/** 분자/분모를 함께: '3/12건'. 분모를 모르면 '3건(전체 미확인)'. */
export function ratioOf(part:number|null|undefined,total:number|null|undefined,unit='건'){if(typeof part!=='number')return UNKNOWN;return typeof total==='number'?`${number.format(part)}/${number.format(total)}${unit}`:`${number.format(part)}${unit}(전체 ${UNKNOWN})`}
/** ISO → '2026-10-01 14:30'(KST). */
export function dateTime(value:unknown,empty=UNKNOWN){const d=valid(value);if(!d)return empty;const p=parts(d);return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`}
/** ISO 또는 'YYYY-MM-DD' → '2026-10-01'(KST). 날짜만 있는 값은 그대로 둔다(시간대 이동 없음). */
export function date(value:unknown,empty=UNKNOWN){if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return value;const d=valid(value);if(!d)return empty;const p=parts(d);return `${p.year}-${p.month}-${p.day}`}
/** 밀리초 → '850ms 미만은 1초 미만', '3초', '2분 5초', '1시간 4분'. */
export function duration(ms:number|null|undefined,empty=UNKNOWN){if(typeof ms!=='number'||!Number.isFinite(ms)||ms<0)return empty;if(ms<1000)return '1초 미만';const s=Math.round(ms/1000);if(s<60)return `${s}초`;const m=Math.floor(s/60),r=s%60;if(m<60)return r?`${m}분 ${r}초`:`${m}분`;const h=Math.floor(m/60),mm=m%60;return mm?`${h}시간 ${mm}분`:`${h}시간`}
/** 비율 0~1 → '12.5%'. */
export function percent(value:number|null|undefined,digits=1,empty=UNKNOWN){return typeof value==='number'&&Number.isFinite(value)?`${(value*100).toFixed(digits).replace(/\.0+$/,'')}%`:empty}
/** 내부 ID를 짧게: 'landing-3f9a2c1b' → '…3f9a2c'. 전체 값은 title·복사 버튼으로만 준다. */
export function shortId(id:string){return id.length<=10?id:`…${id.slice(-6)}`}
/** datetime-local 입력 값(KST 벽시계) ↔ ISO. 브라우저 시간대와 무관하게 서울 시간으로 해석한다. */
export function toLocalInput(value:unknown){const d=valid(value);if(!d)return '';const p=parts(d);return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`}
export function fromLocalInput(value:string){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return '';return new Date(`${value}:00+09:00`).toISOString()}
/** 글자만 쓰는 자리(CSV·aria-label·title·선택지·알림)에서 여러 사실을 잇는다. 빈 값은 빼고 쉼표로 잇는다(가운뎃점 연결 대신, UX-PLAN-3 7차원). */
export function metaText(items:readonly unknown[]){return items.filter(x=>x!==null&&x!==undefined&&x!==false&&x!=='').map(String).join(', ')}

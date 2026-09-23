// 조사 도구 위험 등급(security-ops-1). HERMES 도구 이름만 보고 read·interact·dangerous로 나누고, 표에 없는 이름은 unknown으로 둔다.
// unknown은 읽기로 추측하지 않는다(화면·정책에서 interact 이상). 이름 조각이 위험·상호작용 단어면 그 등급으로 올려 잡는다.
// 목록 판정일 뿐이다. browser_cdp·browser_dialog는 서버 pre_tool_call 훅이 호출을 막아도 목록에는 남는다(docs/SECURITY-BOUNDARIES.ko.md). 훅이 실제로 걸렸는지는 이 모듈이 알 수 없다.
import type {ResearchAccess} from './deep-research';
export type ToolRisk='read'|'interact'|'dangerous'|'unknown';
// unresolved: 도구 목록이 비어 등급을 매길 수 없는 도구셋 이름. invalid: 형식 밖이라 등급을 매기지 않은 도구 이름 수. block 정책은 둘 다 막는다.
export type ToolRiskGroups={read:string[];interact:string[];dangerous:string[];unknown:string[];unresolved?:string[];invalid?:number};
export type RiskedResearchAccess=ResearchAccess&{toolRisk?:ToolRiskGroups;dangerousAdvertised?:boolean};
export type ToolPolicy='warn'|'block';
const table:Record<string,Exclude<ToolRisk,'unknown'>>={
 browser_navigate:'read',browser_snapshot:'read',browser_get_images:'read',browser_vision:'read',browser_back:'read',web_search:'read',web_extract:'read',x_search:'read',vision_analyze:'read',video_analyze:'read',
 browser_click:'interact',browser_type:'interact',browser_press:'interact',browser_scroll:'interact',
 // 원시 CDP·대화상자 승인·페이지 JS 평가(browser_console expression)·브라우저 코드 실행·터미널·서버 파일·코드 실행·데스크톱 제어·하위 에이전트·예약 작업·외부 메시지
 browser_cdp:'dangerous',browser_dialog:'dangerous',browser_console:'dangerous',browser_exec:'dangerous',terminal:'dangerous',process_manage:'dangerous',read_terminal:'dangerous',close_terminal:'dangerous',execute_code:'dangerous',read_file:'dangerous',write_file:'dangerous',patch:'dangerous',search_files:'dangerous',computer_use:'dangerous',delegate_task:'dangerous',cronjob_manage:'dangerous',skill_manage:'dangerous',setup_mcp:'dangerous',send_message:'dangerous',ha_call_service:'dangerous',
};
const dangerousWords=new Set(['cdp','dialog','console','eval','evaluate','exec','execute','javascript','js','script','code','python','repl','sandbox','run','sql','terminal','shell','bash','ssh','process','command','file','files','write','patch','delete','upload','create','http','request','fetch','cron','cronjob','send','publish','payment','purchase','checkout','admin','install','computer','delegate']);
const interactWords=new Set(['click','type','press','scroll','fill','select','hover','drag','drop','keyboard','mouse','tap','submit','input','focus','hold']);
const rank:Record<ToolRisk,number>={read:0,interact:1,unknown:2,dangerous:3};
export const riskRank=(risk:ToolRisk)=>rank[risk];
export function classifyTool(name:string):ToolRisk{
 const key=name.toLowerCase();if(Object.hasOwn(table,key))return table[key];
 const words=key.split(/[^a-z0-9]+/);return words.some(w=>dangerousWords.has(w))?'dangerous':words.some(w=>interactWords.has(w))?'interact':'unknown';
}
// 등급마다 앞의 limit개만 남긴다. 위험 도구가 하나라도 있으면 dangerous는 비지 않는다.
export function groupToolRisk(names:string[],limit=100):ToolRiskGroups{
 const groups:ToolRiskGroups={read:[],interact:[],dangerous:[],unknown:[]};
 for(const name of new Set(names)){const list=groups[classifyTool(name)];if(list.length<limit)list.push(name)}
 return groups;
}
const validName=(t:unknown):t is string=>typeof t==='string'&&/^[\w:.-]{1,120}$/.test(t);
// 켜진 도구셋(enabled·configured)의 도구 이름으로 등급을 매긴다. 도구가 풀리지 않은 도구셋은 이름으로 등급을 매기되 unresolved로도 남기고,
// 형식 밖 도구 이름은 버리지 않고 invalid로 센다(block 정책이 목록 미확인으로 막는다).
export function toolsetRisk(enabled:Record<string,unknown>[]):ToolRiskGroups{
 const lists=enabled.map(x=>Array.isArray(x.tools)?x.tools as unknown[]:[]),unresolved=enabled.filter((x,i)=>!lists[i].some(validName));
 return {...groupToolRisk(enabled.flatMap((x,i)=>{const tools=lists[i].filter(validName);return tools.length?tools:[x.name].filter(validName)})),unresolved:[...new Set(unresolved.map(x=>validName(x.name)?x.name:'(이름 형식 밖)'))].slice(0,100),invalid:lists.flat().filter(t=>!validName(t)).length};
}
export const toolPolicy=(value:unknown):ToolPolicy=>typeof value==='string'&&value.trim().toLowerCase()==='block'?'block':'warn';
export function toolRiskView(access:RiskedResearchAccess){
 const r=access.toolRisk;if(!r)return {summary:'목록만으로 확인 불가',warning:null};
 return {summary:`읽기 ${r.read.length} · 상호작용 ${r.interact.length} · 위험 ${r.dangerous.length} · 미분류 ${r.unknown.length}${r.unknown.length?'(상호작용 이상으로 취급)':''}${r.unresolved?.length?` · 도구 목록 미확인 도구셋 ${r.unresolved.length}`:''}${r.invalid?` · 형식 밖 이름 ${r.invalid}`:''}`,warning:r.dangerous.length?`위험 도구가 목록에 있습니다: ${r.dangerous.join(' · ')}. 서버 훅으로 차단하도록 설치했는지 확인 필요 — 운영 확인 항목`:null};
}
// RESEARCH_TOOL_POLICY=block일 때만 막는다. 목록을 읽지 못했거나, 도구가 풀리지 않은 도구셋이 있거나, 형식 밖 도구 이름이 있으면
// 위험 도구가 없다고 볼 수 없어 막는다(fail-closed). 기본(warn)은 막지 않는다. unknown(표에 없고 위험 단어도 없는 이름)은 block도 막지 않는다(문서의 한계).
export function toolPolicyViolation(access:RiskedResearchAccess,policy:ToolPolicy){
 if(policy!=='block')return null;
 const r=access.toolRisk;
 if(!r)return '도구 목록을 확인하지 못해 위험 도구 여부를 판단할 수 없습니다. RESEARCH_TOOL_POLICY=block이라 조사를 시작하지 않습니다.';
 if(r.dangerous.length)return `위험 도구가 목록에 있어 조사를 시작하지 않습니다(RESEARCH_TOOL_POLICY=block): ${r.dangerous.join(' · ')}. 서버 훅으로 호출을 막아도 목록에는 남으므로, 이 정책은 위험 도구를 끈 HERMES에서만 쓰세요.`;
 if(r.unresolved?.length)return `도구 목록을 확인하지 못한 도구셋이 있어 위험 도구 여부를 판단할 수 없습니다(RESEARCH_TOOL_POLICY=block): ${r.unresolved.join(' · ')}. 조사를 시작하지 않습니다.`;
 return r.invalid?`형식 밖 도구 이름 ${r.invalid}개는 등급을 매길 수 없어 도구 목록을 확인하지 못했습니다(RESEARCH_TOOL_POLICY=block). 조사를 시작하지 않습니다.`:null;
}

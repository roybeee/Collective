import {substanceProblem,scrubInternalIds,parseRoleOutput,strictContractJson,roleOutputContract} from '../role-output';
import {COPY_PACK_PROFILE} from '../copy-pack';
import {parseMeetingStep,DISCUSSION_MIN_CHARS,type MeetingStep} from '../meetings';
import {verdict,type Grader,type EvalItem} from './types';
import {isText,bodyOf,fieldText,proseFields,withoutUrls,contractTitles,placeholderOnly,sectionsOf,excerpt,itemContract} from './text';

// 구조 채점기: 재질문·실질 분량·계약 형식·제목 수준·내부 식별자. 재질문이 fail이어도 내용 채점기와 달리 계속 채점한다(thin_section 제외).
const ROLE_MIN_CHARS=250,SECTION_MIN_CHARS=150;
const substanceTarget=(item:EvalItem)=>item.kind==='discussion'?{text:fieldText(item),min:DISCUSSION_MIN_CHARS}:{text:bodyOf(item),min:ROLE_MIN_CHARS};

// 재질문 판정은 섹션 비례 규칙(substanceProblem 'reask')만 쓴다. 그 규칙이 섹션마다 isQuestionOnly를 적용한다.
// isQuestionOnly를 본문 전체(2,500자 이하)에 단독 적용하면 '…요청…없습니다' 같은 평범한 문장 하나로 fail이 되고 내용 채점기까지 가린다.
export const questionOnly:Grader={id:'question_only',grade(item){
 if(!isText(item)||item.role==='quality')return verdict('not_applicable');
 const {text,min}=substanceTarget(item);
 return substanceProblem(text,min)==='reask'?verdict('fail','substanceProblem=reask'):verdict('pass');
}};

// 제목·표 구분선·'자료 필요'로 시작하는 줄을 뺀 글자 수. PR 2의 '자료 필요가 들어간 줄 80%' 비율 규칙은 쓰지 않는다(한 줄 섹션의 인라인 태그 오탐).
const substantiveChars=(lines:string[])=>lines.map(x=>x.trim()).filter(x=>x&&!/^#{1,6}\s/.test(x)&&!placeholderOnly(x)&&!/^\|[-:\s|]+\|$/.test(x)).join('\n').length;
// 렌더본의 계약 섹션: 계약 제목 사이 구간. 하위 ### 제목은 같은 섹션에 속한다.
function contractSections(text:string,titles:string[]){
 const lines=text.split('\n'),starts=lines.flatMap((l,i)=>{const t=/^##\s+(.+)$/.exec(l)?.[1]?.trim();return t&&titles.includes(t)?[{i,title:t}]:[]});
 return starts.map((s,k)=>({title:s.title,body:lines.slice(s.i+1,k+1<starts.length?starts[k+1].i:lines.length)}));
}
export const thinSection:Grader={id:'thin_section',content:true,grade(item){
 if(!isText(item))return verdict('not_applicable');
 const {text,min}=substanceTarget(item),total=substantiveChars(text.split('\n'));
 if(total<min)return verdict('fail',`전체 실질 ${total}자 < ${min}`);
 const sections=sectionsOf(text),empty=sections.filter(s=>s.body.split('\n').map(x=>x.trim()).filter(Boolean).every(placeholderOnly));
 if(empty.length*2>sections.length)return verdict('fail',`자료 필요만 있는 섹션 ${empty.length}/${sections.length}`);
 if(!item.contract||item.kind!=='role'||item.role==='quality')return verdict('pass');
 const counts=contractSections(text,contractTitles(item.role||'')).map(s=>({title:s.title,n:substantiveChars(s.body)})),thin=counts.filter(s=>s.n<SECTION_MIN_CHARS);
 return thin.length?verdict('fail',thin.map(s=>`계약 섹션 실질 ${s.n}자 < ${SECTION_MIN_CHARS}`)):verdict('pass',counts.map(s=>`${s.n}자`).join('/'));
}};

// 회의 발언: parseMeetingStep으로 4필드·respondsTo를 검사한다. 실질 분량 오류는 question_only·thin_section이 맡으므로 형식 통과로 본다.
function discussionContract(item:EvalItem){
 if(!item.fields)return verdict('fail','발언 JSON 없음');
 const meeting=item.meetingId||'eval-meeting',role=item.role||'unknown';
 const step:MeetingStep={id:`${meeting}:discussion:${role}`,role,phase:'discussion',status:'running'};
 const previous:MeetingStep[]=[...(item.priorRoles||[]).map(r=>({id:`${meeting}:discussion:${r}`,role:r,phase:'discussion' as const,status:'completed' as const})),step];
 try{parseMeetingStep(JSON.stringify(item.fields),step,previous);return verdict('pass')}
 catch(error){const message=(error as Error).message;return message.startsWith('회의 발언 수정 필요')?verdict('pass','형식 통과(실질은 별도 채점)'):verdict('fail',message)}
}
// 기대 계약(A3-4): 평가 맥락에 출력 프로필 'copy-pack-v2'가 있으면 원문 버전과 무관하게 그 계약으로 읽는다(운영 poll은 저장 계약으로 읽는다).
// 그래서 v2로 요청했는데 v1로 답한 원문은 운영처럼 계약 버전 불일치로 fail이다. 콘텐츠 밖 역할은 프로필을 무시하므로(roleOutputContract) v1 계약 그대로다.
// 프로필이 없으면 원문의 contractVersion으로 고른다(itemContract, 이전과 같다).
const expectedContract=(item:EvalItem,outputProfile?:string|null)=>outputProfile===COPY_PACK_PROFILE?roleOutputContract(item.role||'',{copyPack:true}):itemContract(item);
export const contractJson:Grader={id:'contract_json',grade(item,ctx){
 if(item.kind==='discussion')return discussionContract(item);
 if(item.kind!=='role'||item.role==='quality'||!item.contract)return verdict('not_applicable','계약 이전(legacy) 실행 또는 계약 밖 산출물');
 const role=item.role||'';
 if(item.raw){if(!strictContractJson(item.raw))return verdict('fail','원문이 JSON 형식이 아님(운영은 끝 여분 괄호만 떼고 읽음)');try{parseRoleOutput(item.raw,role,expectedContract(item,ctx.outputProfile));return verdict('pass')}catch(error){return verdict('fail',(error as Error).message)}}
 const titles=contractTitles(role),found=(item.text||'').split('\n').flatMap(l=>{const t=/^##\s+(.+)$/.exec(l)?.[1]?.trim();return t&&titles.includes(t)?[t]:[]});
 return found.join('\u0000')===titles.join('\u0000')?verdict('pass','렌더본 약식(원 JSON 없음)'):verdict('fail','계약 제목 누락·중복·순서 오류');
}};

// 계약 섹션은 앱이 '## 제목'으로 렌더한다. 본문이 #·## 제목을 다시 쓰면 섹션 경계가 깨진다. ### 이하는 허용한다.
export const headingNesting:Grader={id:'heading_nesting',grade(item){
 if(item.kind!=='role'||item.role==='quality')return verdict('not_applicable');
 const lines=bodyOf(item).split('\n'),top=(l:string)=>/^#{1,2}\s/.test(l);
 if(!item.contract){const bad=lines.flatMap((l,i)=>top(l)?[`L${i+1}`]:[]);return bad.length?verdict('fail',`legacy 본문 안 #·## 제목 ${bad.join(',')}`):verdict('pass')}
 const allowed=new Set([...contractTitles(item.role||''),'수정 요청 반영 위치']),isContract=(l:string)=>/^##\s/.test(l)&&allowed.has(l.replace(/^##\s+/,'').trim());
 const outside=lines.flatMap((l,i)=>top(l)&&!isContract(l)?[`L${i+1}`]:[]);
 const empty=lines.flatMap((l,i)=>isContract(l)&&top(lines.slice(i+1).find(x=>x.trim())||'')?[`L${i+1}`]:[]);
 return outside.length||empty.length?verdict('fail',[outside.length?`계약 밖 제목 ${outside.join(',')}`:'',empty.length?`빈 계약 섹션 ${empty.join(',')}`:''].filter(Boolean)):verdict('pass');
}};

// 내부 식별자: scrubInternalIds 치환 대상(UUID·ai- 작업물 ID·revision 번호) + 입력 스키마 경로 + 디버그 key=value. URL 안의 값은 제외한다.
export const SCHEMA_PATH=/(?<![\w/.])(?:campaign|brandArchive|archive|evidence|artifact|artifacts|stores|products|operations|budgetPlan|learning|snapshot)\.[A-Za-z_][\w.]*/g;
export const DEBUG_VALUE=/(?<![\w/])[a-z][A-Za-z]{2,40}\s?=\s?(?:\[\]|null|true|false|\d[\w:.-]*|[0-9a-f-]{8,})/g;
export const internalIdExposure:Grader={id:'internal_id_exposure',grade(item){
 if(!isText(item))return verdict('not_applicable');
 const text=item.kind==='discussion'?proseFields(item).join('\n'):bodyOf(item),plain=withoutUrls(text);
 const paths=[...new Set(plain.match(SCHEMA_PATH)||[])],values=[...new Set(plain.match(DEBUG_VALUE)||[])];
 const hits=[scrubInternalIds(text)!==text?'내부 식별자':'',paths.length?`스키마 경로 ${paths.length}종(${excerpt(paths.join(','),60)})`:'',values.length?`디버그 값 ${values.length}종`:''].filter(Boolean);
 return hits.length?verdict('fail',hits):verdict('pass');
}};

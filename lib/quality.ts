export const qualityCriteria={evidence:'근거',brand:'브랜드·상품',execution:'제작·실행',economics:'예산·운영',measurement:'측정·실험'} as const;
export type CheckStatus='pass'|'revise'|'needs_data';
export type QualityCheck={criterion:string;status:CheckStatus;location:string;finding:string;fix:string};
export type TaskCheck={role:string;status:CheckStatus;location:string;finding:string;fix:string};
export type QualityReview={verdict:'ready_for_review'|'revise'|'needs_data';summary:string;findings:string;checks?:QualityCheck[];taskChecks?:TaskCheck[];reportedVerdict?:string;gateIssues?:string[]};
export const qualityContract=`검수는 JSON으로 반환하세요. 기존 verdict/summary/findings에 checks와 taskChecks를 추가합니다. checks는 evidence,brand,execution,economics,measurement 각 기준을 정확히 한 번씩 포함합니다. 형태: {"criterion":"evidence","status":"pass|revise|needs_data","location":"실제 후보의 역할/작업물 ID 또는 제목/문단","finding":"대조한 내용과 판단 근거","fix":"수정/자료 요청 또는 해당 없음"}. 해당 없는 기준도 이유와 검토 위치를 적어 pass로 남기세요. taskChecks는 합의한 tasks의 모든 role을 정확히 한 번씩 포함하며 같은 형식에서 criterion 대신 role을 씁니다. 합의 tasks가 없으면 빈 배열입니다. 단순 통과 문구만 쓰지 마세요. 미충족 항목이 있으면 ready_for_review를 쓰지 마세요. 일부 원문만 받은 경우 누락된 부분은 검증했다고 하지 마세요.`;
const nonempty=(x:unknown):x is string=>typeof x==='string'&&!!x.trim()&&x.length<=5000;
function checks(raw:unknown,key:'criterion'|'role'){
 if(!Array.isArray(raw))return [];
 return raw.slice(0,20).filter(x=>x&&typeof x==='object'&&nonempty(x[key])&&['pass','revise','needs_data'].includes(x.status)&&nonempty(x.location)&&nonempty(x.finding)&&nonempty(x.fix)).map(x=>({[key]:x[key].trim(),status:x.status,location:x.location.trim(),finding:x.finding.trim(),fix:x.fix.trim()}));
}
// Only tightens a verdict; structural validation never proves the underlying facts.
export function enforceQuality(review:QualityReview,raw:any,taskRoles:string[],invalidatedRoles:string[]=[]):QualityReview{
 const c=checks(raw?.checks,'criterion') as QualityCheck[],t=checks(raw?.taskChecks,'role') as TaskCheck[];
 const issues:string[]=[];
 const criteria=Object.keys(qualityCriteria);
 if(!Array.isArray(raw?.checks)||raw.checks.length!==c.length||c.length!==criteria.length||criteria.some(k=>c.filter(x=>x.criterion===k).length!==1))issues.push('필수 5개 기준의 검수 위치·판단 근거·수정 요청이 누락되거나 중복됐습니다.');
 if(!Array.isArray(raw?.taskChecks)||raw.taskChecks.length!==t.length||t.length!==taskRoles.length||taskRoles.some(r=>t.filter(x=>x.role===r).length!==1))issues.push('합의 과제별 완료 검토가 누락되거나 담당자가 일치하지 않습니다.');
 if(invalidatedRoles.length)issues.push(`변경에 맞춰 다시 작성할 후속 작업: ${invalidatedRoles.join(', ')}`);
 const needsData=[...c,...t].some(x=>x.status==='needs_data')||review.verdict==='needs_data';
 const revise=issues.length>0||[...c,...t].some(x=>x.status==='revise')||review.verdict==='revise';
 return {...review,reportedVerdict:review.verdict,verdict:needsData?'needs_data':revise?'revise':'ready_for_review',checks:c,taskChecks:t,gateIssues:issues};
}
// 이 검수가 확인하지 않은 것을 산출물에 명시한다. 구조 검사를 법적 검토로 오해하면 책임 소재가 뒤바뀐다.
export const qualityScopeNotice='검수 범위: 이 검수는 근거·브랜드·실행·경제성·측정 5개 기준의 구조 확인이며, 표시·광고 규제, 권리 사용 범위, 개인정보 처리에 대한 법적 검토는 포함하지 않습니다.';
export function qualityMarkdown(q:QualityReview){
 const state={pass:'통과',revise:'수정 필요',needs_data:'자료 필요'};
 const blocks=[`## ${q.summary}`,q.findings];
 if(q.checks?.length)blocks.push('## 기준별 검수\n'+q.checks.map(x=>`### ${qualityCriteria[x.criterion as keyof typeof qualityCriteria]||x.criterion} · ${state[x.status]}\n- 위치: ${x.location}\n- 근거: ${x.finding}\n- 다음 조치: ${x.fix}`).join('\n\n'));
 if(q.taskChecks?.length)blocks.push('## 과제별 확인\n'+q.taskChecks.map(x=>`- ${x.role} · ${state[x.status]} · ${x.location}\n  ${x.finding}\n  다음 조치: ${x.fix}`).join('\n'));
 if(q.gateIssues?.length)blocks.push('## 추가 확인 필요\n'+q.gateIssues.map(x=>'- '+x).join('\n'));
 blocks.push(`판정: ${{ready_for_review:'사용자 검토 준비',revise:'수정 필요',needs_data:'자료 필요'}[q.verdict]}\n최종 승인은 사용자가 진행합니다.\n${qualityScopeNotice}`);
 return blocks.join('\n\n');
}
export function parseStandaloneQuality(text:string):QualityReview{
 let x:any;try{x=JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''))}catch{}
 if(!x||!['ready_for_review','revise','needs_data'].includes(x.verdict)||!nonempty(x.summary)||!nonempty(x.findings))return enforceQuality({verdict:'revise',summary:'검수 양식 보완 필요',findings:text.slice(0,20000)},null,[]);
 return enforceQuality({verdict:x.verdict,summary:x.summary,findings:x.findings},x,[]);
}

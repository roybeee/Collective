// 앱 내보내기 파일을 채점 항목(EvalItem)으로 나눈다. 네트워크·파일 쓰기 없음.
// 캠페인 내보내기: '# 제목' / '목표: …' / '예산: …' / 브리프 '## 섹션' / 작업물 '## <역할명> · <캠페인 제목>'(app/panels.tsx 내려받기).
// 회의 내보내기: '# 팀 회의' / 안건 / '## <역할명> · 의견 교환' 아래 발언 JSON(lib/meetings.ts meetingMarkdown).
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const roleByName=roles=>new Map(roles.map(r=>[r.name,r.id]));
// 계약 실행 여부: 지정값이 없으면 계약 제목이 '## 제목'으로 하나라도 있으면 계약 렌더본으로 본다.
export function detectContract(text,titles){return titles.some(t=>new RegExp(`^##\\s+${escape(t)}\\s*$`,'m').test(text))}

export function parseCampaignExport(text,{roles,titlesFor,contract={}}){
 const lines=text.split('\n'),title=(lines[0]||'').replace(/^#\s+/,'').trim(),names=roleByName(roles);
 const roleHead=new RegExp(`^## (.+?) · ${escape(title)}\\s*$`);
 const heads=lines.flatMap((l,i)=>{const m=roleHead.exec(l);return m&&names.has(m[1])?[{i,role:names.get(m[1])}]:[]});
 const goal=lines.findIndex(l=>l.startsWith('목표:')),budget=lines.findIndex(l=>l.startsWith('예산:'));
 const briefStart=Math.max(goal,budget)+1,briefEnd=heads[0]?.i??lines.length;
 const items=[];
 if(goal>=0)items.push({id:'brief_goal',kind:'input',role:'brief',text:lines[goal].replace(/^목표:\s*/,'')});
 const brief=lines.slice(briefStart,briefEnd).join('\n').trim();
 if(brief)items.push({id:'brief_plan',kind:'brief',role:'brief',text:brief});
 heads.forEach((h,k)=>{
  const body=lines.slice(h.i+1,k+1<heads.length?heads[k+1].i:lines.length).join('\n').replace(/^\n+/,'').trimEnd();
  items.push({id:'role_'+h.role,kind:'role',role:h.role,contract:contract[h.role]??detectContract(body,titlesFor(h.role)),text:body});
 });
 return items;
}

// 발언 JSON은 섹션 안 첫 '{' 줄부터 마지막 '}' 줄까지다. 파싱하지 못하면 fields 없이 본문만 넘겨 contract_json이 fail로 판정한다.
function discussionFields(body){
 const lines=body.split('\n'),start=lines.findIndex(l=>l.trim().startsWith('{')),end=lines.map(l=>l.trim()).lastIndexOf('}');
 if(start<0||end<start)return undefined;
 try{const x=JSON.parse(lines.slice(start,end+1).join('\n'));return x&&typeof x==='object'&&!Array.isArray(x)?x:undefined}catch{return undefined}
}
const meetingIdOf=fields=>(Array.isArray(fields?.respondsTo)?fields.respondsTo:[]).map(v=>/^(.+):discussion:[a-z]+$/.exec(String(v))?.[1]).find(Boolean);
export function parseMeetingExport(text,{roles}){
 const lines=text.split('\n'),names=roleByName(roles),head=/^## (.+?) · 의견 교환\s*$/;
 const heads=lines.flatMap((l,i)=>{const m=head.exec(l);return m&&names.has(m[1])?[{i,role:names.get(m[1])}]:[]});
 const firstSection=lines.findIndex((l,i)=>i>0&&l.startsWith('## '));
 const agenda=lines.slice(1,firstSection<0?lines.length:firstSection).join('\n').split(/\n\s*\n/).map(p=>p.trim()).find(Boolean);
 const discussions=heads.map((h,k)=>{
  const body=lines.slice(h.i+1,k+1<heads.length?heads[k+1].i:lines.length).join('\n').trim(),fields=discussionFields(body);
  return {id:'discussion_'+h.role,kind:'discussion',role:h.role,...(fields?{fields}:{text:body})};
 });
 const meetingId=discussions.map(d=>meetingIdOf(d.fields)).find(Boolean);
 return [...(agenda?[{id:'meeting_agenda',kind:'input',role:'agenda',text:agenda}]:[]),...discussions.map((d,k)=>({...d,priorRoles:discussions.slice(0,k).filter(p=>p.fields).map(p=>p.role),...(meetingId?{meetingId}:{})}))];
}

// 사용량 원장 CSV: run·input_tokens 열만 쓴다. 호출 1건이 input_budget 채점 항목 1건이다.
export function parseUsageCsv(text){
 const [header,...rows]=text.trim().split('\n'),keys=header.split(',').map(k=>k.trim());
 const run=keys.indexOf('run'),tokens=keys.indexOf('input_tokens');
 if(run<0||tokens<0)throw new Error('사용량 CSV에 run, input_tokens 열이 필요합니다.');
 return rows.map(r=>r.split(',')).map(cols=>{const n=Number(cols[tokens]);return {id:'call_'+cols[run].trim(),kind:'call',role:cols[run].trim(),inputTokens:cols[tokens]?.trim()&&Number.isFinite(n)?n:null}});
}

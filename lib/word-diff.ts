// X8 어절 단위 비교(순수 모듈, 의존성 없음). 글을 어절(공백이 아닌 덩어리)과 공백 조각으로 나눠 LCS로 비교하고,
// 붙어 있는 같은 종류 조각을 합친다. 화면(components/app/version-diff.tsx)은 바뀐 덩어리(hunk)마다 '이 부분 받기'로 일부만 받아들인다.
// 큰 글은 앞뒤 공통 부분을 먼저 떼고, 남은 가운데가 LCS 표 한도(MAX_CELLS)를 넘으면 가운데 전체를 한 덩어리 교체로 본다(정확도보다 응답성을 지킨다).

export type DiffOp={type:'equal'|'insert'|'delete';text:string};
export type DiffSegment={kind:'equal';text:string}|{kind:'change';id:number;removed:string;added:string};
export const MAX_CELLS=4_000_000;

export const tokenize=(text:string)=>text.match(/\s+|\S+/g)??[];
const isSpace=(text:string)=>/^\s+$/.test(text);

// 함수 안에서만 쓰는 새 배열에 담는다(입력 조각은 바꾸지 않는다). 같은 종류가 이어지면 새 조각으로 합친다.
function merge(ops:readonly DiffOp[]):DiffOp[]{
 const out:DiffOp[]=[];
 for(const op of ops){
  if(!op.text)continue;
  const last=out[out.length-1];
  if(last&&last.type===op.type)out[out.length-1]={type:op.type,text:last.text+op.text};else out.push({...op});
 }
 return out;
}
function lcsOps(a:readonly string[],b:readonly string[]):DiffOp[]{
 const n=a.length,m=b.length;
 if(!n||!m)return [...a.map(text=>({type:'delete' as const,text})),...b.map(text=>({type:'insert' as const,text}))];
 if(n*m>MAX_CELLS)return [{type:'delete',text:a.join('')},{type:'insert',text:b.join('')}];
 // 뒤에서부터 채운 LCS 길이 표(행 우선 평탄 배열). 앞에서부터 따라가며 조각을 고른다.
 const w=m+1,table=new Uint32Array((n+1)*w);
 for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)table[i*w+j]=a[i]===b[j]?table[(i+1)*w+j+1]+1:Math.max(table[(i+1)*w+j],table[i*w+j+1]);
 const ops:DiffOp[]=[];let i=0,j=0;
 while(i<n&&j<m){
  if(a[i]===b[j]){ops.push({type:'equal',text:a[i]});i++;j++}
  else if(table[(i+1)*w+j]>=table[i*w+j+1]){ops.push({type:'delete',text:a[i]});i++}
  else{ops.push({type:'insert',text:b[j]});j++}
 }
 return [...ops,...a.slice(i).map(text=>({type:'delete' as const,text})),...b.slice(j).map(text=>({type:'insert' as const,text}))];
}
// 원문 a → 새 글 b의 조각 목록. 같은 종류가 이어지면 하나로 합친다.
export function diffOps(a:string,b:string):DiffOp[]{
 const x=tokenize(a),y=tokenize(b);
 let start=0;while(start<x.length&&start<y.length&&x[start]===y[start])start++;
 let end=0;while(end<x.length-start&&end<y.length-start&&x[x.length-1-end]===y[y.length-1-end])end++;
 const middle=lcsOps(x.slice(start,x.length-end),y.slice(start,y.length-end));
 return merge([{type:'equal',text:x.slice(0,start).join('')},...middle,{type:'equal',text:x.slice(x.length-end).join('')}]);
}
// 화면용 덩어리: 붙어 있는 삭제·추가는 한 교체 덩어리가 된다. 두 바뀐 덩어리 사이의 공백뿐인 같은 조각은 덩어리 안으로 넣는다('가 나'→'다 라'가 한 덩어리).
export function wordDiff(a:string,b:string):DiffSegment[]{
 const ops=diffOps(a,b);
 const absorbed=ops.map((op,i)=>op.type==='equal'&&isSpace(op.text)&&i>0&&i<ops.length-1&&ops[i-1].type!=='equal'&&ops[i+1].type!=='equal'?[{type:'delete' as const,text:op.text},{type:'insert' as const,text:op.text}]:[op]).flat();
 const list:DiffSegment[]=[];let removed='',added='',open=false;
 const close=()=>{if(open)list.push({kind:'change',id:list.length,removed,added});removed='';added='';open=false};
 for(const op of absorbed){
  if(op.type==='equal'){close();list.push({kind:'equal',text:op.text});continue}
  open=true;if(op.type==='delete')removed+=op.text;else added+=op.text;
 }
 close();
 let id=0;
 return list.map(s=>s.kind==='change'?{...s,id:id++}:s);
}
export const changeCount=(segments:readonly DiffSegment[])=>segments.filter(s=>s.kind==='change').length;
// 부분 수락: 고른 덩어리는 새 글(added), 나머지는 원문(removed)을 쓴다. 모두 고르면 b, 하나도 안 고르면 a와 같다.
export function applyChanges(segments:readonly DiffSegment[],accepted:ReadonlySet<number>|readonly number[]):string{
 const chosen=accepted instanceof Set?accepted:new Set(accepted as readonly number[]);
 return segments.map(s=>s.kind==='equal'?s.text:chosen.has(s.id)?s.added:s.removed).join('');
}

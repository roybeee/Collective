// 서버 기록을 사람이 읽는 항목 목록으로 보인다(UX-PLAN P3: 충돌 화면의 JSON 원문 대체). 값은 바꾸지 않고 형식만 맞춘다.
// 시각처럼 보이는 문자열은 KST로, 빈 값은 '미확인'으로, 배열·객체는 한 줄 요약으로 보인다. 키 이름은 labels가 있으면 한국어로 바꾼다.
import {dateTime,UNKNOWN} from '@/lib/format';
const iso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
function show(value:unknown):string{
 if(value===null||value===undefined||value==='')return UNKNOWN;
 if(typeof value==='boolean')return value?'예':'아니오';
 if(typeof value==='number')return new Intl.NumberFormat('ko-KR').format(value);
 if(typeof value==='string')return iso.test(value)?dateTime(value):value;
 if(Array.isArray(value))return value.length?value.map(show).join(', '):'없음';
 return Object.entries(value as Record<string,unknown>).map(([k,v])=>`${k}: ${show(v)}`).join(' · ');
}
export function RecordView({value,labels={},label}:{value:unknown;labels?:Record<string,string>;label:string}){
 if(!value||typeof value!=='object'||Array.isArray(value))return <p>{show(value)}</p>;
 return <dl className="record-view" aria-label={label}>{Object.entries(value as Record<string,unknown>).map(([k,v])=><div key={k}><dt>{labels[k]??k}</dt><dd>{show(v)}</dd></div>)}</dl>;
}

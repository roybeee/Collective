// 서버 검증 오류(400·422의 {error})를 입력 칸에 붙인다(UX-PLAN-3 Q3). 서버 메시지는 '<항목 이름> 입력을 확인해 주세요.' 꼴이라
// 화면 항목 이름(괄호 설명을 뺀 것)이나 그 마지막 낱말이 메시지에 있으면 그 칸으로 본다. 가장 길게 맞는 칸을 고르고, 없으면 null(폼 위 오류로만 보인다).
export type FieldLabel={key:string;label:string};
const names=(label:string)=>{const full=label.replace(/\([^)]*\)/g,'').replace(/\s+/g,' ').trim(),last=full.split(' ').pop()??'';return [...new Set([full,last])].filter(n=>n.length>=2)};
export function fieldForError(message:string,fields:readonly FieldLabel[]):string|null{
 let best:{key:string;length:number}|null=null;
 for(const field of fields)for(const name of names(field.label))if(message.includes(name)&&(!best||name.length>best.length))best={key:field.key,length:name.length};
 return best?.key??null;
}

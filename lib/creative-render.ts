import type {Brand} from './agency';
import type {BrandFact} from './brand-facts';
import {factCardIssue} from './fact-eligibility';
import {FRANCHISE_FACT_MESSAGES} from './franchise-facts';

const SIZE=1080;
const FONT='"Apple SD Gothic Neo", "Malgun Gothic", Arial, sans-serif';

function wrapText(context:CanvasRenderingContext2D,text:string,width:number){
 const lines:string[]=[];
 for(const paragraph of text.split(/\r?\n/)){
  let line='';
  for(const character of Array.from(paragraph)){
   if(context.measureText(character).width>width)throw new Error('표시할 수 없는 문자가 있습니다. 사실 내용을 확인하세요.');
   if(line&&context.measureText(line+character).width>width){lines.push(line);line=character}else line+=character;
  }
  lines.push(line);
 }
 return lines;
}

function fitText(context:CanvasRenderingContext2D,text:string,width:number,height:number,maxSize:number,minSize:number,weight=500){
 for(let size=maxSize;size>=minSize;size--){
  context.font=`${weight} ${size}px ${FONT}`;
  const lines=wrapText(context,text,width),lineHeight=Math.ceil(size*1.5);
  if(lines.length*lineHeight<=height)return {lines,lineHeight,size,weight};
 }
 throw new Error('사실 내용이 카드 한 장에 들어가지 않습니다. 사실을 적게 선택하거나 원문을 별도 카드로 나누세요.');
}

function drawText(context:CanvasRenderingContext2D,layout:ReturnType<typeof fitText>,x:number,y:number){
 context.font=`${layout.weight} ${layout.size}px ${FONT}`;
 for(const [index,line] of layout.lines.entries())context.fillText(line,x,y+index*layout.lineHeight);
}

// 카드에 그릴 텍스트 묶음과 자리(순수). 브랜드 이름 → 사실마다 항목·내용 → (가맹 사실이면) 정보공개서 각주. 각주가 없으면 이전 레이아웃과 같다.
// box: 사실 칸 높이(왼쪽 색 막대). 각주는 사실 칸 아래 y=1012부터 폭 936·높이 56px 안에 18~22px로 맞춘다(트랙 R R1b).
export type CardTextBlock={role:'brand'|'key'|'value'|'footnote';text:string;x:number;y:number;width:number;height:number;maxSize:number;minSize:number;weight:number;box?:number};
export function cardTextBlocks(brand:Pick<Brand,'name'>,facts:readonly Pick<BrandFact,'key'|'value'>[],footnote:readonly string[]=[]):CardTextBlock[]{
 const gap=24,top=250,bottom=1000,boxHeight=Math.floor((bottom-top-gap*(facts.length-1))/facts.length),keyHeight=Math.min(70,boxHeight/3);
 return [
  {role:'brand',text:brand.name,x:72,y:64,width:936,height:144,maxSize:64,minSize:32,weight:700},
  ...facts.flatMap((f,index):CardTextBlock[]=>{const y=top+index*(boxHeight+gap);return [{role:'key',text:f.key,x:98,y,width:864,height:keyHeight,maxSize:25,minSize:18,weight:700,box:boxHeight},{role:'value',text:f.value,x:98,y:y+keyHeight+16,width:864,height:boxHeight-keyHeight-32,maxSize:38,minSize:18,weight:500}]}),
  ...(footnote.length?[{role:'footnote' as const,text:footnote.join('\n'),x:72,y:1012,width:936,height:56,maxSize:22,minSize:18,weight:500}]:[]),
 ];
}

export async function renderFactCard(brand:Brand,facts:BrandFact[],footnote:string[]=[]):Promise<string>{
 if(typeof document==='undefined')throw new Error('이미지 제작은 브라우저에서 실행하세요.');
 const issue=factCardIssue(brand.id,facts);if(issue)throw new Error(issue);
 if(document.fonts)await document.fonts.ready;
 const canvas=document.createElement('canvas');canvas.width=SIZE;canvas.height=SIZE;
 const context=canvas.getContext('2d');if(!context)throw new Error('이미지 제작 기능을 사용할 수 없습니다.');
 const color=/^#[a-f\d]{6}$/i.test(brand.color)?brand.color:'#273953';
 context.fillStyle='#ffffff';context.fillRect(0,0,SIZE,SIZE);
 context.fillStyle=color;context.fillRect(0,0,SIZE,24);
 context.textBaseline='top';context.fillStyle='#172018';
 const blocks=cardTextBlocks(brand,facts,footnote),fit=(b:CardTextBlock)=>fitText(context,b.text,b.width,b.height,b.maxSize,b.minSize,b.weight);
 drawText(context,fit(blocks[0]),blocks[0].x,blocks[0].y);
 const pairs=facts.map((_,index)=>[blocks[1+2*index],blocks[2+2*index]] as const);
 const layouts=pairs.map(([key,value])=>({key:fit(key),value:fit(value)}));
 const note=blocks.find(b=>b.role==='footnote');
 let noteLayout:ReturnType<typeof fitText>|null=null;
 if(note){try{noteLayout=fit(note)}catch{throw new Error(FRANCHISE_FACT_MESSAGES.footnoteTooLong)}}
 for(const [index,fact] of facts.entries()){
  const [key,value]=pairs[index],layout=layouts[index];
  context.fillStyle=color;context.fillRect(72,key.y,5,key.box??0);
  context.fillStyle='#172018';drawText(context,layout.key,key.x,key.y);
  drawText(context,layout.value,value.x,value.y);
  if(!fact.value)throw new Error('빈 사실은 이미지로 제작할 수 없습니다.');
 }
 if(note&&noteLayout){context.fillStyle='#172018';drawText(context,noteLayout,note.x,note.y)}
 const png=canvas.toDataURL('image/png');
 if(!png.startsWith('data:image/png;base64,'))throw new Error('PNG 파일을 만들지 못했습니다.');
 return png;
}

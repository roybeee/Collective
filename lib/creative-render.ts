import type {Brand} from './agency';
import type {BrandFact} from './brand-facts';
import {factCardIssue} from './fact-eligibility';

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

export async function renderFactCard(brand:Brand,facts:BrandFact[]):Promise<string>{
 if(typeof document==='undefined')throw new Error('이미지 제작은 브라우저에서 실행하세요.');
 const issue=factCardIssue(brand.id,facts);if(issue)throw new Error(issue);
 if(document.fonts)await document.fonts.ready;
 const canvas=document.createElement('canvas');canvas.width=SIZE;canvas.height=SIZE;
 const context=canvas.getContext('2d');if(!context)throw new Error('이미지 제작 기능을 사용할 수 없습니다.');
 const color=/^#[a-f\d]{6}$/i.test(brand.color)?brand.color:'#273953';
 context.fillStyle='#ffffff';context.fillRect(0,0,SIZE,SIZE);
 context.fillStyle=color;context.fillRect(0,0,SIZE,24);
 context.textBaseline='top';context.fillStyle='#172018';
 drawText(context,fitText(context,brand.name,936,144,64,32,700),72,64);
 const gap=24,top=250,bottom=1000,boxHeight=Math.floor((bottom-top-gap*(facts.length-1))/facts.length);
 const layouts=facts.map(f=>({key:fitText(context,f.key,864,Math.min(70,boxHeight/3),25,18,700),value:fitText(context,f.value,864,boxHeight-Math.min(70,boxHeight/3)-32,38,18)}));
 for(const [index,fact] of facts.entries()){
  const y=top+index*(boxHeight+gap),layout=layouts[index];
  context.fillStyle=color;context.fillRect(72,y,5,boxHeight);
  context.fillStyle='#172018';drawText(context,layout.key,98,y);
  drawText(context,layout.value,98,y+Math.min(70,boxHeight/3)+16);
  if(!fact.value)throw new Error('빈 사실은 이미지로 제작할 수 없습니다.');
 }
 const png=canvas.toDataURL('image/png');
 if(!png.startsWith('data:image/png;base64,'))throw new Error('PNG 파일을 만들지 못했습니다.');
 return png;
}

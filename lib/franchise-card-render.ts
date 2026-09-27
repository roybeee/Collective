// 트랙 R R15b 모집 카드 묶음 PNG 렌더러(브라우저 전용). 승인·내보낸 카드 묶음 원문을 카드마다 1080×1350 또는 1080×1920 PNG로 그리고 내려받는다.
// 자리(글 상자·QR)는 순수 모듈 lib/franchise-cards.ts cardLayout이 정하고, 여기서는 글자 크기만 줄여 맞춘다. 기존 렌더러(lib/creative-render.ts)는 고치지 않는다.
// 그리는 글은 원문의 카드 글·표지와 브랜드 이름·카드 번호뿐이다(원문에 없는 문장을 더하지 않는다). 생성형 이미지·모델 호출·외부 호출이 없다.
// 증빙은 원문 해시(recruitment_asset bodyHash)다. PNG 바이트는 브라우저·글꼴에 따라 달라질 수 있어 증빙으로 쓰지 않는다.
import {parseCards,cardLayout,cardFileName,CARD_SIZES,CARD_SIZE_KEYS,type Card,type CardBlock,type CardSize} from './franchise-cards';
import {encodeQr} from './franchise-qr';

// 화면은 이 모듈만 import한다(판정 모듈을 직접 부르지 않는다). 규격 목록만 다시 내보낸다.
export {CARD_SIZES,CARD_SIZE_KEYS,type CardSize};
const FONT='"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", Arial, sans-serif';
const INK='#172018';
type Fit={lines:string[];size:number;lineHeight:number};

function wrap(ctx:CanvasRenderingContext2D,text:string,width:number):string[]{
 const out:string[]=[];
 for(const paragraph of text.split('\n')){
  let line='';
  for(const ch of Array.from(paragraph)){
   if(line&&ctx.measureText(line+ch).width>width){out.push(line);line=ch.trim()?ch:''}else line+=ch;
  }
  out.push(line);
 }
 return out;
}
function fit(ctx:CanvasRenderingContext2D,b:CardBlock):Fit{
 for(let size=b.maxSize;size>=b.minSize;size--){
  ctx.font=`${b.weight} ${size}px ${FONT}`;
  const lines=wrap(ctx,b.text,b.width),lineHeight=Math.ceil(size*1.5);
  if(lines.length*lineHeight<=b.height&&lines.every(l=>ctx.measureText(l).width<=b.width))return {lines,size,lineHeight};
 }
 throw new Error('카드 글이 카드 한 장에 들어가지 않습니다. 글을 줄이거나 카드를 나누세요.');
}
function draw(ctx:CanvasRenderingContext2D,b:CardBlock){
 const f=fit(ctx,b);
 ctx.font=`${b.weight} ${f.size}px ${FONT}`;ctx.textAlign=b.align;ctx.fillStyle=INK;
 const x=b.align==='right'?b.x+b.width:b.x;
 f.lines.forEach((line,i)=>ctx.fillText(line,x,b.y+i*f.lineHeight));
}
function drawQr(ctx:CanvasRenderingContext2D,url:string,box:{x:number;y:number;size:number}){
 const m=encodeQr(url);
 if(!m)throw new Error('QR을 만들 수 없습니다. 링크를 확인하세요.');
 // 가장자리 여백 4칸을 두고 칸 크기를 정수 픽셀로 맞춘다(흐림 없음).
 const cells=m.size+8,unit=Math.floor(box.size/cells),side=unit*cells,x0=box.x+Math.floor((box.size-side)/2),y0=box.y+Math.floor((box.size-side)/2);
 if(unit<2)throw new Error('QR이 너무 작습니다.');
 ctx.fillStyle='#ffffff';ctx.fillRect(x0,y0,side,side);ctx.fillStyle='#000000';
 for(let r=0;r<m.size;r++)for(let c=0;c<m.size;c++)if(m.modules[r][c])ctx.fillRect(x0+(c+4)*unit,y0+(r+4)*unit,unit,unit);
}
export async function renderCardPng(size:CardSize,card:Card,total:number,brand:{name:string;color?:string}):Promise<string>{
 if(typeof document==='undefined')throw new Error('이미지 제작은 브라우저에서 실행하세요.');
 if(document.fonts)await document.fonts.ready;
 const layout=cardLayout(size,card,total,brand.name),canvas=document.createElement('canvas');
 canvas.width=layout.width;canvas.height=layout.height;
 const ctx=canvas.getContext('2d');
 if(!ctx)throw new Error('이미지 제작 기능을 사용할 수 없습니다.');
 const color=typeof brand.color==='string'&&/^#[a-f\d]{6}$/i.test(brand.color)?brand.color:'#273953';
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,layout.width,layout.height);
 ctx.fillStyle=color;ctx.fillRect(0,0,layout.width,24);
 ctx.textBaseline='top';
 for(const b of layout.blocks)draw(ctx,b);
 if(layout.qr&&card.qr)drawQr(ctx,card.qr,layout.qr);
 const png=canvas.toDataURL('image/png');
 if(!png.startsWith('data:image/png;base64,'))throw new Error('PNG 파일을 만들지 못했습니다.');
 return png;
}
// 원문 전체를 카드마다 그린 뒤(하나라도 실패하면 아무것도 내려받지 않는다) 차례로 내려받는다. 내려받은 장 수를 돌려준다.
export async function downloadCardBundle(body:string,meta:{assetId:string;version:number;size:CardSize;brand:{name:string;color?:string}}):Promise<number>{
 const {cards,ok}=parseCards(body);
 if(!ok||!cards.length)throw new Error('카드 묶음 원문을 읽지 못했습니다.');
 const pngs:string[]=[];
 for(const card of cards)pngs.push(await renderCardPng(meta.size,card,cards.length,meta.brand));
 pngs.forEach((png,i)=>{const a=document.createElement('a');a.href=png;a.download=cardFileName(meta.assetId,meta.version,meta.size,i+1);a.click()});
 return pngs.length;
}

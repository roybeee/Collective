// 트랙 R R15b QR 부호기(순수). 모집 카드 묶음의 유입 코드 링크를 QR 행렬로 바꾼다. 저장소에 QR 부호기가 없어 의존성을 더하는 대신 표준(ISO/IEC 18004) 부분 구현을 둔다(PR 리뷰 포인트).
// 범위: 바이트 모드(UTF-8), 오류 정정 M(약 15% 복원), 버전 1~10(21~57칸, 최대 213바이트). 모자라면 null이다(카드 쪽이 링크 길이를 먼저 막는다).
// 마스크는 표준 벌점(N1 3·N2 3·N3 40·N4 10)이 가장 작은 것을 고른다(같으면 번호가 작은 것). 같은 입력은 늘 같은 행렬이다. 시계·난수·외부 호출이 없다.
// 근거: tests/franchise-qr.test.mjs가 참조 부호기(python qrcode 8.x)로 만든 행렬과 칸 단위로 대조한다(tests/fixtures/franchise-qr-vectors.json). 결과는 COLLECTIVE 구현이고 인쇄 전 사람이 한 번 찍어 본다.

export const QR_VERSION='fr-qr@2026-09-27.1';
export const QR_MAX_VERSION=10;
// 버전별 [데이터 코드워드 수, 블록당 오류 정정 코드워드 수, [블록 수, 블록당 데이터 코드워드 수][]] (오류 정정 M).
const BLOCKS:readonly (readonly [number,number,readonly (readonly [number,number])[]])[]=[
 [16,10,[[1,16]]],[28,16,[[1,28]]],[44,26,[[1,44]]],[64,18,[[2,32]]],[86,24,[[2,43]]],
 [108,16,[[4,27]]],[124,18,[[4,31]]],[154,22,[[2,38],[2,39]]],[182,22,[[3,36],[2,37]]],[216,26,[[4,43],[1,44]]],
];
const ALIGN:readonly (readonly number[])[]=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
// 남는 비트 수(버전 2~6은 7비트). 값은 0이고 남은 칸은 밝게 둔다(placeData).
const REMAINDER=[0,7,7,7,7,7,0,0,0,0];
export type QrMatrix={version:number;mask:number;size:number;modules:boolean[][]};

// ── GF(256), 원시 다항식 0x11D ──
const EXP=new Uint8Array(512),LOG=new Uint8Array(256);
for(let i=0,x=1;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&0x100)x^=0x11d}
for(let i=255;i<512;i++)EXP[i]=EXP[i-255];
const mul=(a:number,b:number)=>a&&b?EXP[LOG[a]+LOG[b]]:0;
function generator(degree:number):number[]{
 let g=[1];
 for(let i=0;i<degree;i++){const next=new Array(g.length+1).fill(0);g.forEach((c,j)=>{next[j]^=c;next[j+1]^=mul(c,EXP[i])});g=next}
 return g;
}
function ecCodewords(data:readonly number[],degree:number):number[]{
 const g=generator(degree),rem=[...data,...new Array(degree).fill(0)];
 for(let i=0;i<data.length;i++){const c=rem[i];if(c)for(let j=0;j<g.length;j++)rem[i+j]^=mul(g[j],c)}
 return rem.slice(data.length);
}

// ── 데이터 비트열 ──
function codewords(bytes:Uint8Array,version:number):number[]|null{
 const [total]=BLOCKS[version-1],countBits=version<10?8:16,bits:number[]=[];
 const put=(value:number,n:number)=>{for(let i=n-1;i>=0;i--)bits.push((value>>>i)&1)};
 if(bytes.length>=1<<countBits)return null;
 put(0b0100,4);put(bytes.length,countBits);for(const b of bytes)put(b,8);
 const capacity=total*8;
 if(bits.length>capacity)return null;
 put(0,Math.min(4,capacity-bits.length));
 while(bits.length%8)bits.push(0);
 const out:number[]=[];
 for(let i=0;i<bits.length;i+=8)out.push(bits.slice(i,i+8).reduce((a,b)=>a*2+b,0));
 for(let pad=0;out.length<total;pad++)out.push(pad%2?0x11:0xec);
 return out;
}
function interleave(data:readonly number[],version:number):number[]{
 const [,ecLen,groups]=BLOCKS[version-1],blocks:number[][]=[];
 let at=0;
 for(const [count,len] of groups)for(let i=0;i<count;i++){blocks.push(data.slice(at,at+len));at+=len}
 const ecs=blocks.map(b=>ecCodewords(b,ecLen)),out:number[]=[],maxLen=Math.max(...blocks.map(b=>b.length));
 for(let i=0;i<maxLen;i++)for(const b of blocks)if(i<b.length)out.push(b[i]);
 for(let i=0;i<ecLen;i++)for(const e of ecs)out.push(e[i]);
 return out;
}

// ── 행렬 ──
type Grid={size:number;dark:boolean[][];fixed:boolean[][]};
function blank(version:number):Grid{
 const size=17+4*version,row=()=>new Array<boolean>(size).fill(false);
 return {size,dark:Array.from({length:size},row),fixed:Array.from({length:size},row)};
}
const set=(g:Grid,r:number,c:number,dark:boolean)=>{g.dark[r][c]=dark;g.fixed[r][c]=true};
function finder(g:Grid,r0:number,c0:number){
 for(let r=-1;r<=7;r++)for(let c=-1;c<=7;c++){
  const y=r0+r,x=c0+c;
  if(y<0||x<0||y>=g.size||x>=g.size)continue;
  const inRing=r>=0&&r<=6&&c>=0&&c<=6&&(r===0||r===6||c===0||c===6),inCore=r>=2&&r<=4&&c>=2&&c<=4;
  set(g,y,x,inRing||inCore);
 }
}
function functionPatterns(g:Grid,version:number){
 finder(g,0,0);finder(g,0,g.size-7);finder(g,g.size-7,0);
 for(let i=8;i<g.size-8;i++){set(g,6,i,i%2===0);set(g,i,6,i%2===0)}
 // 정렬 무늬는 세 찾기 무늬 모서리만 건너뛴다(6행·6열 가운데 자리는 타이밍 줄 위에 그린다).
 const pos=ALIGN[version-1],last=pos.length-1;
 for(const [i,r] of pos.entries())for(const [j,c] of pos.entries()){
  if((i===0&&j===0)||(i===0&&j===last)||(i===last&&j===0))continue;
  for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)set(g,r+y,c+x,Math.max(Math.abs(y),Math.abs(x))!==1);
 }
 // 형식 정보 자리(값은 마스크를 고른 뒤 쓴다)와 어두운 칸 하나.
 for(let i=0;i<9;i++){if(!g.fixed[8][i])set(g,8,i,false);if(!g.fixed[i][8])set(g,i,8,false)}
 for(let i=0;i<8;i++){set(g,8,g.size-1-i,false);set(g,g.size-1-i,8,false)}
 set(g,g.size-8,8,true);
 if(version>=7){
  const bits=versionBits(version);
  for(let i=0;i<18;i++){const dark=((bits>>>i)&1)===1,a=Math.floor(i/3),b=g.size-11+i%3;set(g,a,b,dark);set(g,b,a,dark)}
 }
}
function bch(value:number,poly:number,degree:number):number{
 let v=value<<degree;
 const top=Math.floor(Math.log2(poly));
 for(let i=Math.floor(Math.log2(v));i>=top;i--)if((v>>>i)&1)v^=poly<<(i-top);
 return (value<<degree)|v;
}
const versionBits=(version:number)=>bch(version,0x1f25,12);
// 오류 정정 M은 형식 비트 00이다.
const formatBits=(mask:number)=>bch(mask,0x537,10)^0x5412;
function placeData(g:Grid,data:readonly number[],version:number){
 const bits:number[]=[];
 for(const b of data)for(let i=7;i>=0;i--)bits.push((b>>>i)&1);
 for(let i=0;i<REMAINDER[version-1];i++)bits.push(0);
 let at=0,upward=true;
 for(let right=g.size-1;right>=1;right-=2){
  if(right===6)right=5;
  for(let k=0;k<g.size;k++){
   const r=upward?g.size-1-k:k;
   for(const c of [right,right-1])if(!g.fixed[r][c]){g.dark[r][c]=at<bits.length?bits[at]===1:false;at++}
  }
  upward=!upward;
 }
}
const MASKS:readonly ((r:number,c:number)=>boolean)[]=[
 (r,c)=>(r+c)%2===0,(r)=>r%2===0,(_r,c)=>c%3===0,(r,c)=>(r+c)%3===0,
 (r,c)=>(Math.floor(r/2)+Math.floor(c/3))%2===0,(r,c)=>(r*c)%2+(r*c)%3===0,(r,c)=>((r*c)%2+(r*c)%3)%2===0,(r,c)=>((r+c)%2+(r*c)%3)%2===0,
];
function masked(g:Grid,mask:number):boolean[][]{
 const out=g.dark.map((row,r)=>row.map((d,c)=>g.fixed[r][c]?d:d!==MASKS[mask](r,c)));
 const bits=formatBits(mask),size=g.size;
 for(let i=0;i<15;i++){
  const dark=((bits>>>i)&1)===1;
  // 왼쪽 위(세로 줄 8열과 가로 줄 8행), 그다음 오른쪽 위·왼쪽 아래.
  if(i<6)out[i][8]=dark;else if(i<8)out[i+1][8]=dark;else out[size-15+i][8]=dark;
  if(i<8)out[8][size-1-i]=dark;else if(i<9)out[8][15-i]=dark;else out[8][14-i]=dark;
 }
 out[size-8][8]=true;
 return out;
}
// 표준 벌점(테스트용으로 export). N3는 1:1:3:1:1 무늬 양쪽 중 한쪽에 밝은 칸 4개(행렬 밖은 밝은 칸)가 붙은 경우다.
export function qrPenalty(m:readonly boolean[][]):number{
 const n=m.length;
 let score=0,dark=0;
 const line=(get:(i:number)=>boolean)=>{
  let s=0,run=1;
  for(let i=1;i<n;i++){if(get(i)===get(i-1))run++;else{if(run>=5)s+=3+run-5;run=1}}
  if(run>=5)s+=3+run-5;
  const at=(i:number)=>i>=0&&i<n&&get(i);
  for(let i=-4;i<n;i++){
   const core=at(i)&&!at(i+1)&&at(i+2)&&at(i+3)&&at(i+4)&&!at(i+5)&&at(i+6);
   if(!core)continue;
   const lightBefore=[1,2,3,4].every(k=>!at(i-k)),lightAfter=[7,8,9,10].every(k=>!at(i+k));
   if(lightBefore||lightAfter)s+=40;
  }
  return s;
 };
 for(let r=0;r<n;r++){score+=line(c=>m[r][c]);score+=line(c=>m[c][r])}
 for(let r=0;r<n-1;r++)for(let c=0;c<n-1;c++){const v=m[r][c];if(v===m[r][c+1]&&v===m[r+1][c]&&v===m[r+1][c+1])score+=3}
 for(const row of m)for(const v of row)if(v)dark++;
 score+=Math.floor(Math.abs(dark*20-n*n*10)/(n*n))*10;
 return score;
}

// 문자열을 UTF-8 바이트로 부호화한다. 들어가는 가장 작은 버전(1~10)을 고르고, 마스크를 넘기지 않으면 벌점이 가장 작은 것을 고른다. 모자라거나 문자열이 아니면 null.
export function encodeQr(text:unknown,opts:{mask?:number;minVersion?:number}={}):QrMatrix|null{
 if(typeof text!=='string'||!text)return null;
 const bytes=new TextEncoder().encode(text),min=Number.isInteger(opts.minVersion)?Math.max(1,opts.minVersion as number):1;
 for(let version=min;version<=QR_MAX_VERSION;version++){
  const data=codewords(bytes,version);
  if(!data)continue;
  const g=blank(version);
  functionPatterns(g,version);
  placeData(g,interleave(data,version),version);
  const masks=Number.isInteger(opts.mask)&&(opts.mask as number)>=0&&(opts.mask as number)<8?[opts.mask as number]:[0,1,2,3,4,5,6,7];
  let best:{mask:number;modules:boolean[][];score:number}|null=null;
  for(const mask of masks){const modules=masked(g,mask),score=qrPenalty(modules);if(!best||score<best.score)best={mask,modules,score}}
  return best?{version,mask:best.mask,size:g.size,modules:best.modules}:null;
 }
 return null;
}
// 테스트·대조용: 행렬을 '1'·'0' 줄로 적는다.
export const qrRows=(m:QrMatrix)=>m.modules.map(row=>row.map(v=>v?'1':'0').join(''));

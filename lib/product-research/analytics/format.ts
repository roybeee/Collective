// 숫자 표기(순수). 런타임 로캘(Intl)에 따라 결과가 달라지지 않게 쉼표 묶음을 직접 만든다. citation-check.ts가 같은 표기를 거꾸로 읽는다.
export function groupDigits(n:number,decimals=0):string{
 if(!Number.isFinite(n))return '미확인';
 const neg=n<0,fixed=Math.abs(n).toFixed(decimals),[int,frac]=fixed.split('.');
 const grouped=int.replace(/\B(?=(\d{3})+(?!\d))/g,',');
 return (neg?'-':'')+grouped+(frac&&/[1-9]/.test(frac)?'.'+frac.replace(/0+$/,''):'');
}
// 관측값 그대로(반올림 없이) 적는다. 정수가 아니면 소수 둘째 자리까지만 보여 주되, 채점기는 ±1%로 받는다.
export const koNumber=(n:number)=>Number.isInteger(n)?groupDigits(n):groupDigits(n,2);
export const koWon=(n:number)=>`${groupDigits(Math.round(n))}원`;
export const koPct=(ratio:number,decimals=1)=>`${ratio>=0?'+':''}${(ratio*100).toFixed(decimals)}%`;

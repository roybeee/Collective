import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export async function probeBrowser(config,run=promisify(execFile)) {
 const args=['repl','--host',config.host,config.host==='local'?'--account':'--profile',config.host==='local'?config.account:config.profile,"console.log('COLLECTIVE_BROWSER_HEALTH='+JSON.stringify({connected:Array.isArray(await listBrowserTabs())}))"];
 try {const {stdout}=await run('aside',args,{timeout:30000,maxBuffer:1024*1024,env:{PATH:process.env.PATH,HOME:process.env.HOME}});const lines=stdout.split('\n').filter(x=>x.startsWith('COLLECTIVE_BROWSER_HEALTH='));return lines.length===1&&JSON.parse(lines[0].slice('COLLECTIVE_BROWSER_HEALTH='.length)).connected?'ready':'offline';}
 catch{return 'offline';}
}
export async function reportHealth(origin,token,health,request=fetch) {
 const response=await request(`${origin}/api/store-browser/worker`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'report_health',...health})});
 if(!response.ok){const error=new Error('worker health request failed');error.status=response.status;throw error;}
}

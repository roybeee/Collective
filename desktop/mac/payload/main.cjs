const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const { SITE, allowedNavigation, externalLink } = require('./policy.cjs');
let mainWindow;
app.setName('COLLECTIVE');
app.enableSandbox();
const preferences = {
  nodeIntegration: false, contextIsolation: true, sandbox: true,
  webSecurity: true, allowRunningInsecureContent: false,
  partition: 'persist:collective', backgroundThrottling: false,
};
async function offerExternal(url) {
  if (!externalLink(url)) return;
  const host = new URL(url).hostname;
  const result = await dialog.showMessageBox({type:'question',title:'외부 링크',
    message:`${host} 링크를 기본 브라우저에서 여시겠습니까?`,
    buttons:['취소','브라우저에서 열기'],defaultId:0,cancelId:0});
  if (result.response === 1) await shell.openExternal(url);
}
function protect(contents) {
  const guard = (event, url) => {
    if (!allowedNavigation(url)) { event.preventDefault(); void offerExternal(url); }
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.setWindowOpenHandler(({url}) => {
    if (!allowedNavigation(url)) { void offerExternal(url); return {action:'deny'}; }
    return {action:'allow',overrideBrowserWindowOptions:{width:600,height:780,webPreferences:preferences}};
  });
}
async function loadHome() {
  try { await mainWindow.loadURL(SITE); }
  catch { /* did-fail-load presents recovery */ }
}
function createWindow() {
  mainWindow = new BrowserWindow({title:'COLLECTIVE',width:1440,height:960,
    minWidth:900,minHeight:640,backgroundColor:'#f6f7f8',webPreferences:preferences});
  mainWindow.webContents.on('did-fail-load', async (_event, code, _description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    const r = await dialog.showMessageBox(mainWindow,{type:'warning',title:'연결 확인',
      message:'COLLECTIVE에 연결하지 못했습니다.',
      detail:'인터넷 연결을 확인해 주세요. 로그인 오류가 보이면 메뉴의 “다시 로그인”을 이용하세요.',
      buttons:['다시 시도','브라우저에서 열기','닫기'],defaultId:0,cancelId:2});
    if (r.response === 0) void loadHome();
    else if (r.response === 1) void shell.openExternal(SITE);
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  void loadHome();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow) createWindow();
    else { if(mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  });
  app.on('web-contents-created', (_event, contents) => protect(contents));
  app.whenReady().then(() => {
    const s = session.fromPartition('persist:collective');
    s.setPermissionRequestHandler((_contents,_permission,callback) => callback(false));
    s.setPermissionCheckHandler(() => false);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {label:'COLLECTIVE',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},
        {role:'unhide'},{type:'separator'},{role:'quit'}]},
      {label:'편집',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},
        {role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
      {label:'보기',submenu:[{label:'홈',accelerator:'CmdOrCtrl+Shift+H',click:()=>{if(!mainWindow)createWindow();else void loadHome();}},
        {role:'reload'},{role:'forceReload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},
        {role:'togglefullscreen'}]},
      {label:'계정',submenu:[{label:'다시 로그인',click:()=>{
        if(!mainWindow) createWindow();
        void mainWindow.loadURL(SITE+'/signin-with-chatgpt').catch(()=>{});
      }},{label:'브라우저에서 열기',click:()=>void shell.openExternal(SITE)}]},
      {label:'윈도우',submenu:[{role:'minimize'},{role:'zoom'},{role:'front'}]},
    ]));
    createWindow();
    app.on('activate', () => {if(!mainWindow)createWindow();});
  });
  app.on('window-all-closed', () => {if(process.platform!=='darwin') app.quit();});
}

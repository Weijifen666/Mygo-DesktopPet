const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, safeStorage, screen, shell } = require('electron');
const { fork, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { AwarenessPolicy } = require('./awareness-policy.cjs');
const localTts = require('./tts-client.cjs');

function voiceDeploymentReady() {
  try {
    try {
      const config=JSON.parse(fs.readFileSync(path.join(__dirname,'tts/cosy-production.json'),'utf8'));
      const bank=JSON.parse(fs.readFileSync(path.join(__dirname,'tts/widget-bank/manifest.json'),'utf8'));
      if(bank.status==='completed' && bank.voice_revision===config.revision && Object.keys(bank.rows || {}).length===836)return true;
    } catch {}
    const cosy=path.join(__dirname,'experiments/cosy-desktop-deployment.json');
    if(fs.existsSync(cosy))return JSON.parse(fs.readFileSync(cosy,'utf8')).status==='deployed';
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'experiments/full-deployment.json'), 'utf8')).status === 'deployed';
  } catch { return false; }
}
function voiceDeploymentRevision(){
  try{return 'cosy-'+JSON.parse(fs.readFileSync(path.join(__dirname,'tts/cosy-production.json'),'utf8')).revision;}
  catch{return 'full-v1';}
}

const CLOSED_SIZE = { width: 420, height: 480 };
const OPEN_SIZE = { width: 760, height: 520 };
const POSITION_FILE = 'window-position.json';
const SECRET_FILE = 'agent-secret.json';
const SETTINGS_FILE = 'desktop-settings.json';
const CHARACTER_NAMES = new Set(['高松灯', '千早爱音', '要乐奈', '长崎爽世', '椎名立希']);
const IGNORED_APPLICATIONS = new Set([
  'electron', 'explorer', 'lockapp', 'searchhost', 'shellexperiencehost',
  'startmenuexperiencehost', 'textinputhost', 'applicationframehost',
]);

let mainWindow;
let tray;
let agentProcess;
let clickThrough = false;
let autoIgnoringMouse = false;
let chatOpen = false;
let quitting = false;
let saveTimer;
let requestId = 0;
let dragState = null;
let awarenessEnabled = false;
let awarenessProcess = null;
let awarenessBuffer = '';
let awarenessRequestPending = false;
let currentCharacter = '高松灯';
const awarenessPolicy = new AwarenessPolicy();
const pendingAgentRequests = new Map();

function userDataPath(file) {
  return path.join(app.getPath('userData'), file);
}

function defaultPosition(size = CLOSED_SIZE) {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - size.width - 20,
    y: workArea.y + workArea.height - size.height - 20,
  };
}

function loadPosition() {
  try {
    const saved = JSON.parse(fs.readFileSync(userDataPath(POSITION_FILE), 'utf8'));
    const visible = screen.getAllDisplays().some(({ workArea }) =>
      saved.x < workArea.x + workArea.width - 80 &&
      saved.x + CLOSED_SIZE.width > workArea.x + 80 &&
      saved.y < workArea.y + workArea.height - 40 &&
      saved.y + CLOSED_SIZE.height > workArea.y + 40
    );
    return visible ? saved : defaultPosition();
  } catch {
    return defaultPosition();
  }
}

function savePosition() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { x, y } = mainWindow.getBounds();
  fs.writeFileSync(userDataPath(POSITION_FILE), JSON.stringify({ x, y }));
}

function queuePositionSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePosition, 250);
}

function readApiKey() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return '';
    const { encryptedApiKey } = JSON.parse(fs.readFileSync(userDataPath(SECRET_FILE), 'utf8'));
    return safeStorage.decryptString(Buffer.from(encryptedApiKey, 'base64'));
  } catch {
    return '';
  }
}

function writeApiKey(apiKey) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用');
  const encryptedApiKey = safeStorage.encryptString(apiKey).toString('base64');
  fs.writeFileSync(userDataPath(SECRET_FILE), JSON.stringify({ encryptedApiKey }));
}

function loadSettings() {
  try {
    const settings = JSON.parse(fs.readFileSync(userDataPath(SETTINGS_FILE), 'utf8'));
    awarenessEnabled = settings.awarenessEnabled === true;
  } catch {
    awarenessEnabled = false;
  }
}

function saveSettings() {
  fs.writeFileSync(userDataPath(SETTINGS_FILE), JSON.stringify({ awarenessEnabled }, null, 2));
}

function startAgentService() {
  agentProcess = fork(path.join(__dirname, 'agent-service.cjs'), [], {
    env: { ...process.env, MYGO_AGENT_DATA_DIR: app.getPath('userData') },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  agentProcess.on('message', (message) => {
    if (!message || message.type !== 'response') return;
    const pending = pendingAgentRequests.get(message.id);
    if (!pending) return;
    pendingAgentRequests.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error || 'Agent 服务请求失败'));
  });
  agentProcess.on('exit', () => {
    agentProcess = null;
    for (const pending of pendingAgentRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Agent 服务已停止'));
    }
    pendingAgentRequests.clear();
    if (!quitting) setTimeout(startAgentService, 1000);
  });
  const apiKey = readApiKey();
  if (apiKey) agentProcess.send({ type: 'configure', apiKey });
}

function callAgent(type, payload = {}, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    if (!agentProcess?.connected) return reject(new Error('Agent 服务尚未就绪'));
    const id = ++requestId;
    const timer = setTimeout(() => {
      pendingAgentRequests.delete(id);
      reject(new Error('Agent 响应超时'));
    }, timeoutMs);
    pendingAgentRequests.set(id, { resolve, reject, timer });
    agentProcess.send({ type, id, ...payload });
  });
}

function applyMouseMode() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setIgnoreMouseEvents(clickThrough || autoIgnoringMouse, { forward: true });
}

function setClickThrough(enabled) {
  clickThrough = enabled;
  applyMouseMode();
  updateTrayMenu();
}

function sendAwarenessState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('awareness:state', awarenessEnabled);
}

function stopAwarenessMonitor() {
  if (awarenessProcess) awarenessProcess.kill();
  awarenessProcess = null;
  awarenessBuffer = '';
  awarenessRequestPending = false;
  awarenessPolicy.reset();
}

async function considerAwarenessReaction(application) {
  const normalized = String(application || '').trim().toLowerCase();
  if (!awarenessEnabled || !mainWindow?.isVisible() || IGNORED_APPLICATIONS.has(normalized)) {
    awarenessPolicy.observe('', Date.now());
    return;
  }
  const now = Date.now();
  if (awarenessRequestPending || !awarenessPolicy.observe(application, now)) return;
  awarenessPolicy.markReaction(now);
  awarenessRequestPending = true;
  try {
    const result = await callAgent('observe', { character: currentCharacter, application }, 70000);
    if (awarenessEnabled && mainWindow?.isVisible() && currentCharacter === result.character) {
      mainWindow.webContents.send('awareness:reaction', result);
    }
  } catch {
    // Awareness is deliberately quiet when the API key or network is unavailable.
  } finally {
    awarenessRequestPending = false;
  }
}

function startAwarenessMonitor() {
  if (!awarenessEnabled || awarenessProcess || !mainWindow?.isVisible()) return;
  awarenessPolicy.reset();
  awarenessProcess = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'foreground-app.ps1'),
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  awarenessProcess.stdout.setEncoding('utf8');
  awarenessProcess.stdout.on('data', (chunk) => {
    awarenessBuffer += chunk;
    const lines = awarenessBuffer.split(/\r?\n/);
    awarenessBuffer = lines.pop() || '';
    for (const line of lines) considerAwarenessReaction(line);
  });
  awarenessProcess.on('exit', () => {
    awarenessProcess = null;
    awarenessBuffer = '';
    if (!quitting && awarenessEnabled && mainWindow?.isVisible()) {
      setTimeout(startAwarenessMonitor, 5000);
    }
  });
}

function setAwarenessEnabled(enabled) {
  awarenessEnabled = Boolean(enabled);
  saveSettings();
  if (awarenessEnabled) startAwarenessMonitor();
  else stopAwarenessMonitor();
  sendAwarenessState();
  updateTrayMenu();
  return awarenessEnabled;
}

function setChatOpen(open) {
  if (!mainWindow || mainWindow.isDestroyed() || chatOpen === open) return;
  if (open && clickThrough) setClickThrough(false);
  const oldBounds = mainWindow.getBounds();
  const size = open ? OPEN_SIZE : CLOSED_SIZE;
  const nextBounds = {
    x: oldBounds.x + oldBounds.width - size.width,
    y: oldBounds.y + oldBounds.height - size.height,
    ...size,
  };
  const { workArea } = screen.getDisplayNearestPoint({ x: oldBounds.x, y: oldBounds.y });
  nextBounds.x = Math.max(workArea.x, Math.min(nextBounds.x, workArea.x + workArea.width - size.width));
  nextBounds.y = Math.max(workArea.y, Math.min(nextBounds.y, workArea.y + workArea.height - size.height));
  mainWindow.setBounds(nextBounds, true);
  chatOpen = open;
  mainWindow.webContents.send('chat:state', open);
  updateTrayMenu();
}

function resetPosition() {
  const size = chatOpen ? OPEN_SIZE : CLOSED_SIZE;
  const { x, y } = defaultPosition(size);
  mainWindow.setPosition(x, y);
  mainWindow.show();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: mainWindow?.isVisible() ? '隐藏桌宠' : '显示桌宠',
      click: () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show(),
    },
    { label: chatOpen ? '关闭聊天' : '打开聊天', click: () => setChatOpen(!chatOpen) },
    {
      label: '点击穿透', type: 'checkbox', checked: clickThrough,
      click: ({ checked }) => setClickThrough(checked),
    },
    {
      label: '始终置顶', type: 'checkbox', checked: mainWindow?.isAlwaysOnTop() ?? true,
      click: ({ checked }) => mainWindow.setAlwaysOnTop(checked, 'floating'),
    },
    {
      label: '桌面感知（仅前台应用名）', type: 'checkbox', checked: awarenessEnabled,
      click: ({ checked }) => setAwarenessEnabled(checked),
    },
    { label: '重置到右下角', click: resetPosition },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
}

function registerIpc() {
  ipcMain.handle('tts:synthesize', (_event, payload) => localTts.synthesize(payload));
  ipcMain.on('tts:cancel', () => localTts.cancel());
  ipcMain.handle('window:begin-drag', () => {
    if (dragState?.timer) clearInterval(dragState.timer);
    dragState = {
      cursor: screen.getCursorScreenPoint(),
      bounds: mainWindow.getBounds(),
    };
    dragState.timer = setInterval(() => {
      if (!dragState || !mainWindow || mainWindow.isDestroyed()) return;
      const cursor = screen.getCursorScreenPoint();
      const x = dragState.bounds.x + cursor.x - dragState.cursor.x;
      const y = dragState.bounds.y + cursor.y - dragState.cursor.y;
      const current = mainWindow.getBounds();
      if (current.x !== x || current.y !== y) mainWindow.setPosition(x, y);
    }, 16);
    return dragState.bounds;
  });
  ipcMain.on('window:end-drag', () => {
    if (dragState?.timer) clearInterval(dragState.timer);
    dragState = null;
  });
  ipcMain.on('window:move-to', (_event, { x, y }) => {
    if (Number.isFinite(x) && Number.isFinite(y)) mainWindow.setPosition(Math.round(x), Math.round(y));
  });
  ipcMain.on('window:set-auto-ignore', (_event, ignored) => {
    autoIgnoringMouse = Boolean(ignored);
    applyMouseMode();
  });
  ipcMain.on('window:hide', () => mainWindow?.hide());
  ipcMain.on('chat:set-open', (_event, open) => setChatOpen(Boolean(open)));
  ipcMain.on('character:set', (_event, character) => {
    const nextCharacter = String(character || '');
    if (CHARACTER_NAMES.has(nextCharacter)) {
      localTts.cancel();
      currentCharacter = nextCharacter;
    }
  });
  ipcMain.handle('awareness:status', () => ({ enabled: awarenessEnabled }));
  ipcMain.handle('awareness:set', (_event, enabled) => ({ enabled: setAwarenessEnabled(enabled) }));
  ipcMain.handle('agent:status', (_event, character) => callAgent('status', { character }));
  ipcMain.handle('agent:history', (_event, character) => callAgent('history', { character }));
  ipcMain.handle('agent:chat', (_event, payload) => {
    const text = String(payload?.text || '').trim().slice(0, 4000);
    const character = String(payload?.character || '高松灯').slice(0, 20);
    if (!text) throw new Error('消息不能为空');
    return callAgent('chat', { text, character, deferDelivery:payload?.deferDelivery===true });
  });
  for(const type of ['reply-delivered','reply-discarded'])ipcMain.handle('agent:'+type,(_event,payload)=>{
    return callAgent(type,{replyId:String(payload?.replyId || '').slice(0,80),character:String(payload?.character || '').slice(0,20)});
  });
  ipcMain.handle('agent:widget-speech', (_event, payload) => {
    const text = String(payload?.text || '').trim().slice(0, 500);
    const character = String(payload?.character || '高松灯').slice(0, 20);
    if (!text) throw new Error('台词不能为空');
    return callAgent('widget-speech', { text, character });
  });
  ipcMain.handle('agent:save-key', (_event, value) => {
    const apiKey = String(value || '').trim();
    if (apiKey.length < 16) throw new Error('API Key 格式不正确');
    writeApiKey(apiKey);
    agentProcess?.send({ type: 'configure', apiKey });
    return { configured: true };
  });
  ipcMain.handle('agent:clear-memory', (_event, character) => callAgent('clear', { character }));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    ...loadPosition(), ...CLOSED_SIZE,
    minWidth: CLOSED_SIZE.width, minHeight: CLOSED_SIZE.height,
    maxWidth: OPEN_SIZE.width, maxHeight: OPEN_SIZE.height,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, skipTaskbar: true, alwaysOnTop: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: voiceDeploymentReady() ? ['--mygo-voice-deployment-ready','--mygo-voice-revision='+voiceDeploymentRevision()] : [],
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      autoplayPolicy:'no-user-gesture-required',
    },
  });
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.loadFile(path.join(__dirname, 'desktop.html'));
  if(process.env.MYGO_DESKTOP_TEST!=='1' && fs.existsSync(path.join(__dirname,'tts/cosy-production.json'))){
    mainWindow.webContents.once('did-finish-load',async()=>{
      const report=path.join(__dirname,'experiments/cosy-desktop-ready.json');
      try{
        const ready=await mainWindow.webContents.executeJavaScript(`(async()=>{
          await window.mygoFixedReady;
          const deadline=Date.now()+90000;
          while(!document.getElementById('live2d') && Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
          const manifest=await (await fetch('./tts/widget-bank/manifest.json')).json();
          return {canvas:!!document.getElementById('live2d'),voiceEnabled,revision:manifest.voice_revision,
            fixedAudioCount:Object.keys(manifest.rows).length,selectedRoleReady:window.mygoWidgetBank.readyCount};
        })()`);
        fs.writeFileSync(report,JSON.stringify({status:ready.canvas&&ready.selectedRoleReady>0?'ready':'failed',pid:process.pid,
          userData:app.getPath('userData'),...ready,checkedUnix:Date.now()/1000},null,2));
      }catch(error){fs.writeFileSync(report,JSON.stringify({status:'failed',pid:process.pid,error:error.message},null,2));}
    });
  }
  mainWindow.once('ready-to-show', () => { if(process.env.MYGO_DESKTOP_TEST!=='1')mainWindow.showInactive(); });
  mainWindow.on('move', queuePositionSave);
  mainWindow.on('show', () => {
    updateTrayMenu();
    sendAwarenessState();
    startAwarenessMonitor();
  });
  mainWindow.on('hide', () => {
    localTts.cancel();
    mainWindow.webContents.send('tts:stop');
    updateTrayMenu();
    stopAwarenessMonitor();
  });
  mainWindow.on('close', savePosition);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://github.com/')) shell.openExternal(url);
    return { action: 'deny' };
  });
  tray = new Tray(path.join(__dirname, 'assets', 'favicon.ico'));
  tray.setToolTip('MyGO!!!!! 桌宠');
  tray.on('click', () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show());
  updateTrayMenu();
  globalShortcut.register('CommandOrControl+Alt+M', () => setClickThrough(!clickThrough));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => mainWindow?.show());
  app.whenReady().then(() => {
    loadSettings();
    registerIpc();
    startAgentService();
    createWindow();
  });
  app.on('before-quit', () => {
    quitting = true;
    savePosition();
    stopAwarenessMonitor();
    agentProcess?.kill();
    localTts.cancel();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {});
}

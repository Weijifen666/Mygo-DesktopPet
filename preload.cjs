const { contextBridge, ipcRenderer } = require('electron');
const voiceDeploymentReady = process.argv.includes('--mygo-voice-deployment-ready');
contextBridge.exposeInMainWorld('mygoTts', {
  deploymentReady: voiceDeploymentReady,
  deploymentRevision:process.argv.find(arg=>arg.startsWith('--mygo-voice-revision='))?.split('=')[1] || 'full-v1',
  synthesize: (text, character, speechStyle = 'neutral', speechDelivery) => ipcRenderer.invoke('tts:synthesize', { text, character, speechStyle, speechDelivery }),
  cancel: () => ipcRenderer.send('tts:cancel'),
  onStop: (callback) => ipcRenderer.on('tts:stop', () => callback()),
});

contextBridge.exposeInMainWorld('mygoDesktop', {
  beginDrag: () => ipcRenderer.invoke('window:begin-drag'),
  dragFrame: () => ipcRenderer.send('window:drag-frame'),
  endDrag: () => ipcRenderer.send('window:end-drag'),
  moveTo: (x, y) => ipcRenderer.send('window:move-to', { x, y }),
  setAutoIgnore: (ignored) => ipcRenderer.send('window:set-auto-ignore', ignored),
  hide: () => ipcRenderer.send('window:hide'),
  setChatOpen: (open) => ipcRenderer.send('chat:set-open', open),
  setCharacter: (character) => ipcRenderer.send('character:set', character),
  getAwareness: () => ipcRenderer.invoke('awareness:status'),
  setAwareness: (enabled) => ipcRenderer.invoke('awareness:set', enabled),
  onAwarenessState: (callback) => ipcRenderer.on('awareness:state', (_event, enabled) => callback(enabled)),
  onAwarenessReaction: (callback) => ipcRenderer.on('awareness:reaction', (_event, result) => callback(result)),
  onChatState: (callback) => ipcRenderer.on('chat:state', (_event, open) => callback(open)),
});

contextBridge.exposeInMainWorld('mygoAgent', {
  status: (character) => ipcRenderer.invoke('agent:status', character),
  history: (character) => ipcRenderer.invoke('agent:history', character),
  chat: (text, character, deferDelivery=false) => ipcRenderer.invoke('agent:chat', { text, character, deferDelivery }),
  confirmDelivery:(replyId,character)=>ipcRenderer.invoke('agent:reply-delivered',{replyId,character}),
  discardReply:(replyId,character)=>ipcRenderer.invoke('agent:reply-discarded',{replyId,character}),
  widgetSpeech: (text, character) => ipcRenderer.invoke('agent:widget-speech', { text, character }),
  saveApiKey: (apiKey) => ipcRenderer.invoke('agent:save-key', apiKey),
  clearMemory: (character) => ipcRenderer.invoke('agent:clear-memory', character),
});

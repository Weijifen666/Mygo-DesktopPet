const characterNames = ['高松灯', '千早爱音', '要乐奈', '长崎爽世', '椎名立希'];
localStorage.removeItem('waifu-display');
const body = document.body;
const chatToggle = document.getElementById('chat-toggle');
const settings = document.getElementById('settings');
const apiKey = document.getElementById('api-key');
const saveKey = document.getElementById('save-key');
const agentStatus = document.getElementById('agent-status');
const messages = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendMessage = document.getElementById('send-message');
const voiceToggle = document.getElementById('voice-toggle');
const quickVoiceToggle = document.getElementById('quick-voice-toggle');
const voiceStatus = document.getElementById('voice-status');
let voiceStatusTimer;
function showVoiceStatus(message, duration = 8000) {
  clearTimeout(voiceStatusTimer);
  voiceStatus.textContent = message;
  voiceStatus.hidden = !message;
  if (duration && message) voiceStatusTimer = setTimeout(() => { voiceStatus.hidden = true; }, duration);
}
const awarenessToggle = document.getElementById('awareness-toggle');
const hidePet = document.getElementById('hide-pet');
const quickComposeToggle = document.getElementById('quick-compose-toggle');
const quickForm = document.getElementById('quick-form');
const quickInput = document.getElementById('quick-input');
const quickSend = document.getElementById('quick-send');
const characterReply = document.getElementById('character-reply');
const characterReplyText = document.getElementById('character-reply-text');
let chatOpen = false;
let historyLoadedCharacter = null;
let busy = false;
let voiceEnabled = localStorage.getItem('voiceEnabled') === 'true';
if (window.mygoTts?.deploymentReady && localStorage.getItem('voiceDeployment') !== window.mygoTts.deploymentRevision) {
  voiceEnabled = true;
  localStorage.setItem('voiceEnabled', 'true');
  localStorage.setItem('voiceDeployment', window.mygoTts.deploymentRevision);
}
let modelDragging = false;
let lastAutoIgnore = false;
let mouseFramePending = false;
let latestMouseEvent = null;
let sessionExpiresAt = 0;
const canvasAlphaReadable = new WeakMap();

function getCurrentCharacter() {
  const modelId = Number.parseInt(localStorage.getItem('modelId') || '0', 10);
  return characterNames[modelId] || characterNames[0];
}

function updateVoiceButton() {
  voiceToggle.textContent = voiceEnabled ? '🔊' : '🔇';
  voiceToggle.title = voiceEnabled ? '关闭语音' : '开启语音';
  voiceToggle.setAttribute('aria-label', voiceToggle.title);
  quickVoiceToggle.setAttribute('aria-pressed', String(voiceEnabled));
  quickVoiceToggle.title = voiceEnabled ? '关闭语音' : '开启语音';
  quickVoiceToggle.setAttribute('aria-label', quickVoiceToggle.title);
}

let voiceGeneration = 0;
let voiceAudio;
let voiceUrl;
function stopVoice() {
  voiceGeneration += 1;
  window.mygoTts.cancel();
  voiceAudio?.pause();
  voiceAudio = null;
  window.mygoWidgetBank?.stop();
  if (voiceUrl) URL.revokeObjectURL(voiceUrl);
  voiceUrl = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
window.mygoTts.onStop(stopVoice);

async function speak(text, japanese = '', character = getCurrentCharacter(), speechStyle = 'neutral', speechDelivery) {
  stopVoice();
  if (!voiceEnabled) return;
  const generation = voiceGeneration;
  if (japanese) {
    try {
      showVoiceStatus('正在合成日语语音…', 0);
      const result = await window.mygoTts.synthesize(japanese, character, speechStyle, speechDelivery);
      if (generation !== voiceGeneration || !voiceEnabled || character !== getCurrentCharacter()) return;
      const bytes = Uint8Array.from(atob(result.audio), (c) => c.charCodeAt(0));
      voiceUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      voiceAudio = new Audio(voiceUrl);
      voiceToggle.title = result.experimental ? '实验角色语音，待试听校对' : '关闭语音';
      quickVoiceToggle.title = voiceToggle.title;
      await voiceAudio.play();
      showVoiceStatus('正在播放角色日语', 2500);
      return;
    } catch (error) {
      if (generation !== voiceGeneration || !voiceEnabled || character !== getCurrentCharacter()) return;
      voiceToggle.title = '本地角色语音未就绪，尝试系统日语语音';
      showVoiceStatus(`角色语音播放失败：${error.message}`);
    }
  }
  if (!voiceEnabled || !japanese || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(japanese);
  utterance.lang = 'ja-JP';
  utterance.rate = 0.95;
  const voices = speechSynthesis.getVoices();
  const japaneseVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith('ja'));
  if (!japaneseVoice) {
    voiceToggle.title = '本地角色语音未就绪；系统没有可用的日语语音';
    quickVoiceToggle.title = voiceToggle.title;
    return;
  }
  utterance.voice = japaneseVoice;
  speechSynthesis.speak(utterance);
}

async function deliverReply(result,character,generation,publish) {
  if(generation!==voiceGeneration || character!==getCurrentCharacter())return false;
  if(!voiceEnabled){publish();return true;}
  if(!result.japanese)throw new Error('这次回复没有有效的日语语音台词，请重试。');
  showVoiceStatus('正在准备角色语音…',0);
  const audio=await window.mygoTts.synthesize(result.japanese,character,result.speechStyle || 'neutral',result.speechDelivery);
  if(generation!==voiceGeneration || !voiceEnabled || character!==getCurrentCharacter())return false;
  const buffer=await window.mygoWidgetBank.prepareSpeech(audio.audio);
  if(generation!==voiceGeneration || !voiceEnabled || character!==getCurrentCharacter())return false;
  return window.mygoWidgetBank.playBuffer(buffer,()=>{
    // The complete WAV has been decoded. Publish text in the same synchronous
    // turn as starting its audio, rather than exposing a reply before synthesis.
    publish();showVoiceStatus('正在播放角色日语',2500);
  });
}

async function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  localStorage.setItem('voiceEnabled', String(voiceEnabled));
  updateVoiceButton();
  if (voiceEnabled) {
    await speak('语音已开启', '声を出すね。');
    if (!voiceEnabled) return;
    const retry = () => scheduleWidgetSpeech(document.getElementById('waifu-tips'), true);
    if (voiceAudio && !voiceAudio.paused) voiceAudio.addEventListener('ended', retry, { once: true });
    else retry();
  } else {
    stopVoice();
    showVoiceStatus('语音已关闭', 2500);
  }
}

let widgetVoiceTimer;
let widgetVoicePending = false;
let lastWidgetVoiceAt = 0;
let lastWidgetVoiceKey = '';
function replyOwnsBubble() {
  return busy || Boolean(window.mygoWidgetBank?.replyPlaying);
}
function hideCharacterReply() {
  characterReply.hidden = true;
  body.classList.remove('agent-reply-visible');
}
window.addEventListener('mygo:widget-before-line',event=>{
  // A complete conversational reply owns its text and audio until it ends.
  if(replyOwnsBubble()) { event.preventDefault(); return; }
  // Keep the finished reply visible until the user explicitly clicks a line.
  if(!event.detail?.explicitClick && !characterReply.hidden) { event.preventDefault(); return; }
  // Hover/idle tips must wait for the entire fixed line as well as chat speech.
  if(!event.detail?.explicitClick && (busy || window.mygoWidgetBank?.playing || (voiceAudio && !voiceAudio.paused)))event.preventDefault();
});
window.addEventListener('click',event=>{
  if(event.target?.closest?.('#live2d')){
    if(replyOwnsBubble()) { event.preventDefault(); event.stopPropagation(); return; }
    // An explicit model click wins over a higher-priority welcome/hover tip.
    sessionStorage.removeItem('waifu-text');
    stopVoice();
  }
},true);
window.addEventListener('mygo:widget-line',event=>{
  if(replyOwnsBubble())return;
  // Stop the old voice at the same event that updates the bubble, even on rapid clicks.
  if(getCurrentCharacter()!==observedCharacter)void syncSelectedCharacter();
  hideCharacterReply();
  stopVoice();
  if(!voiceEnabled)return;
  const source=String(event.detail?.source || '').trim();
  const index=Number(event.detail?.characterIndex);
  if(characterNames[index]!==getCurrentCharacter())return;
  const hit=window.mygoWidgetBank?.play(index,source,()=>showVoiceStatus('正在播放角色日语',2000));
  lastWidgetVoiceKey=JSON.stringify([getCurrentCharacter(),source]);lastWidgetVoiceAt=Date.now();
  if(!hit)showVoiceStatus('这句固定台词的语音正在准备，稍后再试。');
});
window.mygoFixedReady=window.mygoWidgetBank?.preloadAll(Number.parseInt(localStorage.getItem('modelId') || '0',10));
function scheduleWidgetSpeech(tips, force = false) {
  if (!tips) return;
    clearTimeout(widgetVoiceTimer);
    widgetVoiceTimer = setTimeout(async () => {
      if (!voiceEnabled || busy || widgetVoicePending || window.mygoWidgetBank?.playing || (voiceAudio && !voiceAudio.paused)) return;
      const source = tips.textContent.trim();
      const character = getCurrentCharacter();
      const key = JSON.stringify([character, source]);
      if (!source || (!force && (key === lastWidgetVoiceKey || Date.now() - lastWidgetVoiceAt < 20000))) return;
      const index=characterNames.indexOf(character);
      if(window.mygoWidgetBank?.play(index,source,()=>showVoiceStatus('正在播放角色日语',2000))){
        lastWidgetVoiceKey=key;lastWidgetVoiceAt=Date.now();return;
      }
      if(window.mygoWidgetBank?.isFixed(index,source)){showVoiceStatus('这句固定台词的语音正在准备，稍后再试。');return;}
      const generation = voiceGeneration;
      widgetVoicePending = true;
      lastWidgetVoiceAt = Date.now();
      try {
        showVoiceStatus('正在生成角色日语台词…', 0);
        const result = await window.mygoAgent.widgetSpeech(source, character);
        if (!voiceEnabled || busy || generation !== voiceGeneration || character !== getCurrentCharacter() || tips.textContent.trim() !== source) return;
        lastWidgetVoiceKey = key;
        await speak(source, result.japanese, character, result.speechStyle);
      } catch (error) {
        if (voiceEnabled && generation === voiceGeneration) {
          lastWidgetVoiceAt = 0;
          voiceToggle.title = '自动台词语音需要日语生成服务和本地语音服务';
          quickVoiceToggle.title = voiceToggle.title;
          showVoiceStatus(`自动台词语音：${error.message}`);
        }
      } finally {
        widgetVoicePending = false;
      }
    }, 250);
}
function observeWidgetSpeech(tips) {
  const observer = new MutationObserver(() => scheduleWidgetSpeech(tips));
  observer.observe(tips, { childList: true, characterData: true, subtree: true });
  scheduleWidgetSpeech(tips);
}
const widgetMountObserver = new MutationObserver(() => {
  const tips = document.getElementById('waifu-tips');
  if (!tips) return;
  widgetMountObserver.disconnect();
  observeWidgetSpeech(tips);
});
widgetMountObserver.observe(document.body, { childList: true, subtree: true });

function updateAwarenessButton(enabled) {
  awarenessToggle.setAttribute('aria-pressed', String(enabled));
  awarenessToggle.title = enabled ? '关闭桌面感知（仅识别前台应用名）' : '开启桌面感知（仅识别前台应用名）';
  awarenessToggle.setAttribute('aria-label', awarenessToggle.title);
}

function showCharacterReply(text) {
  characterReplyText.textContent = text;
  characterReply.hidden = false;
  body.classList.add('agent-reply-visible');
  characterReply.scrollTop = 0;
}

function setQuickComposerOpen(open) {
  quickForm.hidden = !open;
  quickComposeToggle.setAttribute('aria-pressed', String(open));
  quickComposeToggle.title = open ? '关闭输入' : '输入对话';
  quickComposeToggle.setAttribute('aria-label', quickComposeToggle.title);
  if (open) quickInput.focus();
}

function mountDesktopTools() {
  const controls = document.getElementById('quick-controls');
  const toolbar = document.getElementById('waifu-tool');
  if (!controls || !toolbar) return;
  for (const button of [...controls.children]) toolbar.appendChild(button);
  controls.remove();
}

function addMessage(role, text) {
  const item = document.createElement('div');
  item.className = `message ${role}`;
  item.textContent = text;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}

async function refreshStatus(character = getCurrentCharacter()) {
  try {
    const status = await window.mygoAgent.status(character);
    sessionExpiresAt = Number(status.expiresAt) || 0;
    agentStatus.textContent = status.configured ? `${status.character} · DeepSeek` : `${status.character} · 需要 API Key`;
    if (!status.configured) settings.hidden = false;
    return status;
  } catch (error) {
    agentStatus.textContent = '本地服务未就绪';
    return { configured: false, error };
  }
}

async function loadHistory(force = false) {
  const character = getCurrentCharacter();
  if (!force && historyLoadedCharacter === character) return;
  try {
    const result = await window.mygoAgent.history(character);
    if (getCurrentCharacter() !== character) return;
    messages.replaceChildren();
    for (const message of result.history) addMessage(message.role === 'user' ? 'user' : 'assistant', message.content);
    historyLoadedCharacter = character;
    sessionExpiresAt = Number(result.expiresAt) || 0;
  } catch (error) {
    messages.replaceChildren();
    addMessage('system', error.message);
  }
}

async function setChatOpen(open) {
  chatOpen = open;
  body.classList.toggle('chat-open', open);
  window.mygoDesktop.setChatOpen(open);
  if (open) {
    await Promise.all([refreshStatus(), loadHistory()]);
    chatInput.focus();
  }
}

chatToggle.addEventListener('click', () => setChatOpen(true));
document.getElementById('chat-close').addEventListener('click', () => setChatOpen(false));
voiceToggle.addEventListener('click', toggleVoice);
quickVoiceToggle.addEventListener('click', toggleVoice);
hidePet.addEventListener('click', () => window.mygoDesktop.hide());
awarenessToggle.addEventListener('click', async () => {
  awarenessToggle.disabled = true;
  try {
    const enabled = awarenessToggle.getAttribute('aria-pressed') !== 'true';
    const result = await window.mygoDesktop.setAwareness(enabled);
    updateAwarenessButton(result.enabled);
    if (result.enabled) showCharacterReply('我会留意你正在使用哪个应用。不会看窗口内容，也不会读取按键。');
  } finally {
    awarenessToggle.disabled = false;
  }
});
quickComposeToggle.addEventListener('click', () => setQuickComposerOpen(quickForm.hidden));
characterReply.addEventListener('click', () => {
  hideCharacterReply();
});
window.mygoDesktop.onChatState((open) => {
  chatOpen = open;
  body.classList.toggle('chat-open', open);
  if (open) Promise.all([refreshStatus(), loadHistory()]);
});
window.mygoDesktop.onAwarenessState(updateAwarenessButton);
window.mygoDesktop.onAwarenessReaction(async (result) => {
  if (result?.character !== getCurrentCharacter() || !result?.answer) return;
  if(busy)return;
  stopVoice();const generation=voiceGeneration;
  try{await deliverReply(result,result.character,generation,()=>showCharacterReply(result.answer));}
  catch(error){if(generation===voiceGeneration)showVoiceStatus(error.message);}
});
document.getElementById('settings-toggle').addEventListener('click', () => {
  settings.hidden = !settings.hidden;
  if (!settings.hidden) apiKey.focus();
});

saveKey.addEventListener('click', async () => {
  const value = apiKey.value.trim();
  if (!value) return;
  saveKey.disabled = true;
  try {
    await window.mygoAgent.saveApiKey(value);
    apiKey.value = '';
    settings.hidden = true;
    addMessage('system', 'DeepSeek 已连接');
    await refreshStatus();
    if (voiceEnabled) scheduleWidgetSpeech(document.getElementById('waifu-tips'), true);
  } catch (error) {
    addMessage('system', error.message);
  } finally {
    saveKey.disabled = false;
  }
});

document.getElementById('clear-memory').addEventListener('click', async () => {
  const character = getCurrentCharacter();
  if (!window.confirm(`清空${character}的本地对话和长期记忆？`)) return;
  try {
    await window.mygoAgent.clearMemory(character);
    messages.replaceChildren();
    addMessage('system', `${character}的本地记忆已清空`);
  } catch (error) {
    addMessage('system', error.message);
  }
});

async function sendConversation(text, source) {
  if (!text || busy) return;
  stopVoice();
  const generation=voiceGeneration;
  busy = true;
  sendMessage.disabled = true;
  quickSend.disabled = true;
  addMessage('user', text);
  agentStatus.textContent = '正在思考...';
  showCharacterReply('……');
  const character = getCurrentCharacter();
  let result,published=false;
  try {
    result = await window.mygoAgent.chat(text, character,voiceEnabled);
    if (character !== getCurrentCharacter() || generation!==voiceGeneration) return;
    agentStatus.textContent=voiceEnabled?'正在准备语音…':'回复就绪';
    await deliverReply(result,character,generation,()=>{
      addMessage('assistant',result.answer);showCharacterReply(result.answer);
      published=true;
      if(result.replyId)window.mygoAgent.confirmDelivery(result.replyId,character).catch(()=>{});
    });
  } catch (error) {
    if (character !== getCurrentCharacter() || generation!==voiceGeneration) return;
    addMessage('system', error.message);
    showCharacterReply(error.message);
  } finally {
    if(result?.replyId && !published)await window.mygoAgent.discardReply(result.replyId,character).catch(()=>{});
    busy = false;
    sendMessage.disabled = false;
    quickSend.disabled = false;
    await refreshStatus(getCurrentCharacter());
    if (source === 'full') chatInput.focus();
  }
}

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text || busy) return;
  chatInput.value = '';
  sendConversation(text, 'full');
});

quickForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = quickInput.value.trim();
  if (!text || busy) return;
  quickInput.value = '';
  setQuickComposerOpen(false);
  sendConversation(text, 'quick');
});

chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

quickInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    quickForm.requestSubmit();
  }
});

function attachModelDragging(canvas) {
  if (canvas.dataset.desktopDrag === 'ready') return;
  canvas.dataset.desktopDrag = 'ready';
  let drag = null;
  let suppressClick = false;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || chatOpen) return;
    modelDragging = true;
    drag = { pointerId: event.pointerId, distance: 0, moved: false };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('dragging');
    window.mygoDesktop.beginDrag().catch(() => {
      if (drag?.pointerId === event.pointerId) drag = null;
      modelDragging = false;
      canvas.classList.remove('dragging');
    });
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.distance += Math.abs(event.movementX) + Math.abs(event.movementY);
    if (drag.distance > 5) drag.moved = true;
  });
  const finishDrag = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    suppressClick = drag.moved;
    drag = null;
    modelDragging = false;
    window.mygoDesktop.endDrag();
    canvas.classList.remove('dragging');
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', finishDrag);
  canvas.addEventListener('pointercancel', finishDrag);
  canvas.addEventListener('click', (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

const observer = new MutationObserver(() => {
  const canvas = document.getElementById('live2d');
  if (canvas) attachModelDragging(canvas);
  mountDesktopTools();
  for (const id of ['model-selection-panel', 'texture-selection-panel']) {
    const panel = document.getElementById(id);
    if (panel && panel.parentElement !== document.body) document.body.appendChild(panel);
  }
});
observer.observe(document.body, { childList: true, subtree: true });

function canvasPixelIsOpaque(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return false;
  try {
    const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
    if (!gl) return true;
    const alphaState = canvasAlphaReadable.get(canvas);
    if (!alphaState?.readable && (!alphaState || Date.now() - alphaState.checkedAt >= 1000)) {
      let foundVisiblePixel = false;
      const probe = new Uint8Array(4);
      for (let row = 1; row < 8 && !foundVisiblePixel; row += 1) {
        for (let column = 1; column < 8; column += 1) {
          gl.readPixels(
            Math.floor(canvas.width * column / 8),
            Math.floor(canvas.height * row / 8),
            1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe
          );
          if (probe[3] > 12) {
            foundVisiblePixel = true;
            break;
          }
        }
      }
      canvasAlphaReadable.set(canvas, { readable: foundVisiblePixel, checkedAt: Date.now() });
    }
    if (!canvasAlphaReadable.get(canvas)?.readable) {
      const relativeX = (clientX - rect.left) / rect.width * 400;
      const relativeY = (clientY - rect.top) / rect.height * 400;
      return relativeX >= 70 && relativeX <= 345 && relativeY >= 35 && relativeY <= 400;
    }
    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor((clientX - rect.left) * canvas.width / rect.width)));
    const y = Math.max(0, Math.min(canvas.height - 1, canvas.height - 1 - Math.floor((clientY - rect.top) * canvas.height / rect.height)));
    const pixel = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return pixel[3] > 12;
  } catch {
    return true;
  }
}

function updateMousePassthrough(event) {
  if (modelDragging) {
    if (lastAutoIgnore) {
      lastAutoIgnore = false;
      window.mygoDesktop.setAutoIgnore(false);
    }
    return;
  }
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const controls = target?.closest('#quick-form, #character-reply, #chat-panel, #waifu-tool, #model-selection-panel, #texture-selection-panel');
  const canvas = document.getElementById('live2d');
  const interactive = Boolean(controls) || Boolean(canvas && canvasPixelIsOpaque(canvas, event.clientX, event.clientY));
  const ignored = !interactive;
  if (ignored === lastAutoIgnore) return;
  lastAutoIgnore = ignored;
  window.mygoDesktop.setAutoIgnore(ignored);
}

window.addEventListener('mousemove', (event) => {
  latestMouseEvent = event;
  if (mouseFramePending) return;
  mouseFramePending = true;
  requestAnimationFrame(() => {
    mouseFramePending = false;
    if (latestMouseEvent) updateMousePassthrough(latestMouseEvent);
  });
});
window.addEventListener('mouseleave', () => {
  if (modelDragging || lastAutoIgnore) return;
  lastAutoIgnore = true;
  window.mygoDesktop.setAutoIgnore(true);
});

let observedCharacter = getCurrentCharacter();
async function syncSelectedCharacter() {
  const character = getCurrentCharacter();
  if (character === observedCharacter) return;
  stopVoice();
  observedCharacter = character;
  window.mygoWidgetBank?.loadRole(characterNames.indexOf(character));
  window.mygoDesktop.setCharacter(character);
  historyLoadedCharacter = null;
  messages.replaceChildren();
  characterReply.hidden = true;
  body.classList.remove('agent-reply-visible');
  await refreshStatus(character);
  if (chatOpen) await loadHistory(true);
}
setInterval(syncSelectedCharacter, 500);
setInterval(async () => {
  await syncSelectedCharacter();
  if (sessionExpiresAt && Date.now() >= sessionExpiresAt) {
    messages.replaceChildren();
    characterReply.hidden = true;
    body.classList.remove('agent-reply-visible');
    historyLoadedCharacter = null;
  }
  if (chatOpen && !busy) await loadHistory(true);
}, 60 * 1000);
updateVoiceButton();
window.mygoDesktop.setCharacter(observedCharacter);
window.mygoDesktop.getAwareness().then(({ enabled }) => updateAwarenessButton(enabled));

const CHARACTERS = Object.freeze({ 高松灯: 'tomori', 千早爱音: 'anon', 要乐奈: 'rana', 长崎爽世: 'soyo', 长崎素世: 'soyo', 椎名立希: 'taki' });
const {normalizeSpokenNames}=require('./speech-pronunciation.cjs');
let active;
function cancel() { active?.abort(); active = null; }
async function synthesize(payload) {
  const character = CHARACTERS[payload?.character];
  const text = normalizeSpokenNames(payload?.text || '').trim();
  const emotion = ['neutral','quiet','gentle','plain','excited'].includes(payload?.speechStyle) ? payload.speechStyle : 'neutral';
  if (!character || !text || text.length > 300) throw new Error('语音参数无效');
  cancel();
  const controller = new AbortController();
  active = controller;
  // Complete longer local replies and queued synthesis; explicit clicks still abort immediately.
  const timer = setTimeout(() => controller.abort(), 300000);
  try {
    const response = await fetch('http://127.0.0.1:9881/synthesize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character, text, emotion, speechDelivery:payload?.speechDelivery, speed: 1, checkContent:true }), signal: controller.signal,
    });
    if (!response.ok) throw new Error('本地角色语音未就绪');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 16 * 1024 * 1024 || buffer.subarray(0, 4).toString() !== 'RIFF') throw new Error('语音格式无效');
    return { audio: buffer.toString('base64'), experimental:response.headers?.get('X-Voice-Mode') === 'experimental' };
  } finally {
    clearTimeout(timer);
    if (active === controller) active = null;
  }
}
module.exports = { synthesize, cancel, CHARACTERS };

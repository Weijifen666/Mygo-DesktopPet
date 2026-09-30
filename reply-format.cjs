function parseReply(raw) {
  try {
    const data = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (typeof data.answer === 'string' && data.answer.trim()) {
      const japanese = typeof data.japanese === 'string' ? data.japanese.trim() : '';
      const result = { answer: data.answer.trim(), japanese: japanese.length <= 300 && /[\u3040-\u30ff]/.test(japanese) ? japanese : '' };
      if (['neutral','quiet','gentle','plain','excited'].includes(data.speechStyle)) result.speechStyle = data.speechStyle;
      if(data.speechDelivery && typeof data.speechDelivery==='object' && !Array.isArray(data.speechDelivery))result.speechDelivery=data.speechDelivery;
      return result;
    }
  } catch {}
  return { answer: String(raw).trim(), japanese: '' };
}
module.exports = { parseReply };

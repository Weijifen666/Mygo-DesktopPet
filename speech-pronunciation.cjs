// One shared dictionary supplies spoken names without changing Chinese bubbles.
const pronunciations=require('./tts/pronunciations.json');
function normalizeSpokenNames(text){
  let result=String(text);
  for(const [name,reading] of Object.entries(pronunciations).sort((a,b)=>b[0].length-a[0].length)){
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    result=result.replace(new RegExp('(?<![A-Za-z0-9_])'+escaped+'(?![A-Za-z0-9_])','gi'),reading);
  }
  return result;
}
module.exports={normalizeSpokenNames};

const KEYS=['pitch','variation','energy','pace','pauses'];
const EMOTIONS=['neutral','joy','sad','worried','frustrated','tender','surprised'];
const deliveryInstruction='另加 speechDelivery 对象：{emotion,intensity,pitch,variation,energy,pace,pauses}。emotion 只能为 neutral、joy、sad、worried、frustrated、tender、surprised；intensity 为 low、medium、high。其余五项均是 0/1/2 的整数，分别代表该角色自身音高低/常/高、音高变化小/中/大、力度轻/中/强、语速慢/中/快、停顿短/中/长。根据整段前后文、用户情绪、回答目的和人物关系决定，不能只看感叹号；开心不一定高音，安慰也不一定悲伤。灯日常小心轻声，真正高昂时才提高力度与变化；素世区分柔和甜声和自然直说；乐奈保持平直简短，除非语境明确；其他角色也按上下文变化。字段是合成指令，不要写进日语正文。';
function normalizeDelivery(value,style='neutral',character='',text=''){
  const defaults={pitch:1,variation:1,energy:1,pace:1,pauses:1,emotion:'neutral',intensity:'medium'};
  if(style==='quiet'||character==='高松灯'&&style==='neutral')Object.assign(defaults,{pitch:0,variation:0,energy:0,pace:0,pauses:1,intensity:'low'});
  if(style==='gentle')Object.assign(defaults,{energy:0,variation:1,emotion:'tender',intensity:'low'});
  if(style==='plain')Object.assign(defaults,{pitch:0,variation:0});
  if(style==='excited')Object.assign(defaults,{pitch:2,variation:2,energy:2,pace:2,pauses:0,emotion:'joy',intensity:'high'});
  if(character==='要乐奈'&&style!=='excited')Object.assign(defaults,{variation:0,pitch:1});
  if(value&&typeof value==='object'){
    for(const key of KEYS)if(Number.isInteger(value[key])&&value[key]>=0&&value[key]<=2)defaults[key]=value[key];
    if(EMOTIONS.includes(value.emotion))defaults.emotion=value.emotion;
    if(['low','medium','high'].includes(value.intensity))defaults.intensity=value.intensity;
  }
  return defaults;
}
module.exports={KEYS,EMOTIONS,deliveryInstruction,normalizeDelivery};

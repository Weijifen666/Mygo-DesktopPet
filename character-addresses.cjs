// Role-dependent vocatives supported by recurring local recording transcripts.
// Individual ASR spellings remain unreviewed; evidence clips are exported separately.
const {normalizeSpokenNames}=require('./speech-pronunciation.cjs');
const addresses = Object.freeze({
  高松灯: {anon:'あのんちゃん',rana:'らーなちゃん',soyo:'そよちゃん',taki:'たきちゃん'},
  千早爱音: {tomori:'ともりん',rana:'らーなちゃん',soyo:'そよりん',taki:'りっきー'},
  要乐奈: {tomori:'ともり',anon:'あのん',soyo:'そよ',taki:'りっきー'},
  长崎爽世: {tomori:'ともりちゃん',anon:'あのんちゃん',rana:'らーなちゃん',taki:'たきちゃん'},
  椎名立希: {tomori:'ともり',anon:'あのん',rana:'らーな',soyo:'そよ'},
});
const aliases={
  tomori:'高松燈|高松灯|燈ちゃん|灯ちゃん|トモリン|ともりん|トモリ|ともり',
  anon:'千早愛音|愛音|アノン|あのん|アノちゃん|あのちゃん',
  rana:'要楽奈|楽奈|ラーナ|ラナ|らーな|らなちゃん',
  soyo:'長崎そよ|爽世|素世|ソヨリン|そよりん|ソヨ|そよ',
  taki:'椎名立希|立希|リッキー|りっきー|タキ|たき',
};
function normalizeAddresses(text,character) {
  if(character==='长崎素世')character='长崎爽世';
  let result=normalizeSpokenNames(text);
  result=result.replace(/三角\s*初華|三角\s*初华/g,'みすみういか').replace(/初華|初华/g,'ういか');
  result=result.replace(/三角(?:同学|同學|さん)/g,'みすみさん');
  if(character==='长崎爽世'){
    result=result.replace(/(?:若[葉叶]\s*睦|小睦)(?:ちゃん|チャン|さん)?|睦(?:ちゃん|子米酱|子米醬)|(?:むつ|ムツ)(?:ちゃん|チャン)|(?:むつみ|ムツミ)(?:ちゃん|チャン)?/g,'むつみちゃん');
    result=result.replace(/(?<!\p{Script=Han})睦(?=$|[、。！？!?「」『』]|は|が|を|に|の|と|も|へ|って)/gu,'むつみちゃん');
    result=result.replace(/爽世世|素世世|\bsoyosoyo\b|\bsoyorin\b/gi,'そよりん');
    result=result.replace(/(?:そよそよ|ソヨソヨ)(?=[」』]|って(?:呼|いう|言う|あだ名|名前)|という(?:あだ名|名前)|と呼)/g,'そよりん');
  }
  if(character==='椎名立希'){
    result=result.replace(/海鈴|海玲|海铃|うみりん|ウミリン|\bumilin\b|\bumirin\b|\bumiri\b/gi,'うみり');
    result=result.replace(/三角(?:同学|同學|さん)?(?=って|は|が|と|に|も|[、。！？]|$)/g,'みすみさん');
    result=result.replace(/野良猫|ノラネコ/g,'のらねこ');
    result=result.replace(/狸希/g,'りっきー');
    result=result.replace(/(?:たぬき|タヌキ)(?=[」』]|って(?:呼|いう|言う|あだ名|名前)|という(?:あだ名|名前)|と呼)/g,'りっきー');
  }
  if(character!=='椎名立希')result=result.replace(/海鈴|海玲|海铃/g,'うみり');
  for (const [target,name] of Object.entries(addresses[character] || {})) {
    result=result.replace(new RegExp('(?:'+aliases[target]+')(?:ちゃん|さん|くん|りん)?(?=$|[\\s、。！？!?…「」『』]|は|が|を|に|の|と|も|へ|って|なん|だけ|なら|で)','g'),name);
  }
  return result;
}
function addressInstruction(character) {
  if(character==='长崎素世')character='长崎爽世';
  const labels={tomori:'高松灯',anon:'千早爱音',rana:'要乐奈',soyo:'长崎爽世',taki:'椎名立希'};
  const extra=character==='椎名立希'?'立希称呼乐奈也可以按语境使用绰号「のらねこ」（野良猫），例如无奈或吐槽她跑掉时；朗读字段使用假名读法，不强制每句使用绰号。立希复述自己的外号「狸希」时固定使用「りっきー」（Rikii），与爱音的称呼一致，不能按字面翻译成「たぬき」或按汉字猜读。':
    character==='长崎爽世'?'素世复述爱音给自己的外号「爽世世」或「素世世」时，日语固定为「そよりん」（soyorin），不是「そよそよ」（soyosoyo）。只在提及这个外号时使用，不改变日常第一人称自称。素世称呼若叶睦／小睦时使用「むつみちゃん」（Mutsumi-chan），完整读出「み」，不能缩成「むつちゃん」。':'';
  return '角色称呼：'+Object.entries(addresses[character] || {}).map(([role,name])=>labels[role]+'→「'+name+'」').join('；')+'。请保留这些日语读法；不要按汉字猜读名字，不要为所有角色使用相同昵称。Afterglow 是乐队名称，日语朗读字段写「アフターグロウ」，连贯地读整个名称，不能拼读英文字母。'+extra;
}
module.exports={addresses,normalizeAddresses,addressInstruction};

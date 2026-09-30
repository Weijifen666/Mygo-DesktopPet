// Local request stub checks routing and history; it does not assess generated persona quality.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { japaneseStyles } = require('./character-voice-style.cjs');
const { addresses, normalizeAddresses } = require('./character-addresses.cjs');
async function main() {
  const aliases={tomori:'高松灯',anon:'愛音',rana:'楽奈',soyo:'素世',taki:'立希'};
  assert.equal(normalizeAddresses('あのちゃん、ありがとう。','高松灯'),'あのんちゃん、ありがとう。');
  assert.equal(normalizeAddresses('野良猫、こっちに来て。','椎名立希'),'のらねこ、こっちに来て。');
  assert.equal(normalizeAddresses('「そよそよ」って呼ばないで。','长崎爽世'),'「そよりん」って呼ばないで。');
  assert.equal(normalizeAddresses('「爽世世」と呼ぶの？','长崎素世'),'「そよりん」と呼ぶの？');
  assert.equal(normalizeAddresses('そよそよって呼ばないで。','长崎爽世'),'そよりんって呼ばないで。');
  assert.equal(normalizeAddresses('風がそよそよと吹いている。','长崎爽世'),'風がそよそよと吹いている。');
  assert.equal(normalizeAddresses('「たぬき」って呼ばないで。','椎名立希'),'「りっきー」って呼ばないで。');
  assert.equal(normalizeAddresses('私の名前は狸希でもない！','椎名立希'),'私の名前はりっきーでもない！');
  assert.equal(normalizeAddresses('公園にたぬきがいた。','椎名立希'),'公園にたぬきがいた。');
  assert.equal(normalizeAddresses('海鈴と三角さんって仲良かった？','椎名立希'),'うみりとみすみさんって仲良かった？');
  assert.equal(normalizeAddresses('Umilin、ありがとう。','椎名立希'),'うみり、ありがとう。');
  assert.equal(normalizeAddresses('うみりん、三角形は？','椎名立希'),'うみり、三角形は？');
  assert.equal(normalizeAddresses('三角形を描く。','椎名立希'),'三角形を描く。');
  assert.equal(normalizeAddresses('今日はむつちゃんのピアノの日。','长崎素世'),'今日はむつみちゃんのピアノの日。');
  assert.equal(normalizeAddresses('小睦、ムツミちゃん、むつみちゃん。','长崎爽世'),'むつみちゃん、むつみちゃん、むつみちゃん。');
  assert.equal(normalizeAddresses('若葉睦ちゃん、睦のピアノ。和睦。','长崎爽世'),'むつみちゃん、むつみちゃんのピアノ。和睦。');
  for(const speaker of Object.keys(japaneseStyles)){
    assert.equal(normalizeAddresses('Afterglowのライブ。AFTERGLOWも好き。',speaker),'アフターグロウのライブ。アフターグロウも好き。');
    assert.equal(normalizeAddresses('afterglowing',speaker),'afterglowing');
    assert.equal(normalizeAddresses('MyGO!!!!!、Ave Mujica、ANON TOKYO、CC BY-SA、QRコード。',speaker),'マイゴ、アヴェムジカ、アノントーキョー、クリエイティブ・コモンズ、表示・継承、二次元コード。');
  }
  for(const [speaker,targets] of Object.entries(addresses)) {
    for(const [target,name] of Object.entries(targets)) {
      assert.equal(normalizeAddresses(`${aliases[target]}ちゃん、お茶を飲もう。`,speaker),`${name}、お茶を飲もう。`);
      assert.equal(normalizeAddresses(`${name}、お茶を飲もう。`,speaker),`${name}、お茶を飲もう。`);
    }
    const ordinary='そよ風で灯りが揺れる。わからないこともある。';
    assert.equal(normalizeAddresses(ordinary,speaker),ordinary);
  }
  const testRoot = path.join(__dirname, 'experiments');
  fs.mkdirSync(testRoot, { recursive: true });
  const folder = fs.mkdtempSync(path.join(testRoot, 'test-dialogue-'));
  const processStub = new EventEmitter();
  processStub.env = { MYGO_AGENT_DATA_DIR: folder };
  const responses = new Map();
  processStub.send = message => responses.get(message.id)?.(message);
  let calls = [];
  let malformedReplies=0;
  let englishReplies=0;
  const source = path.join(__dirname, 'agent-service.cjs');
  const context = vm.createContext({ require:createRequire(source), __dirname, process:processStub,
    console, setTimeout, clearTimeout, AbortController,
    fetch:async (_url, options) => {
      const payload = JSON.parse(options.body);
      calls.push(payload);
      if(malformedReplies>0){malformedReplies--;return {ok:true,json:async()=>({choices:[{message:{content:'先休息一下吧。'}}]})};}
      if(englishReplies>0){englishReplies--;return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({answer:'一起享受音乐吧。',japanese:'musicを一緒に楽しもう。'})}}]})};}
      return { ok:true, json:async()=>({choices:[{message:{content:JSON.stringify({answer:'一起休息吧。',japanese:'一緒に休もう。'})}}]}) };
    },
  });
  function send(type, extra={}) {
    const id = responses.size + 1;
    return new Promise(resolve=>{ responses.set(id, resolve); processStub.emit('message', {id,type,...extra}); });
  }
  try {
    vm.runInContext(fs.readFileSync(source, 'utf8'), context, {filename:source});
    processStub.emit('message',{type:'configure',apiKey:'local-request-stub'});
    for (const character of Object.keys(japaneseStyles)) {
      const chat = await send('chat',{character,text:'今天很累。'});
      assert.equal(chat.ok,true);
      assert.equal(chat.result.japanese,'一緒に休もう。');
      assert.ok(calls.at(-1).messages[0].content.includes(japaneseStyles[character]));
      const history = (await send('history',{character})).result.history;
      assert.equal(history.length,2);
      const before = calls.length;
      const first = await send('widget-speech',{character,text:'休息一下吧。'});
      assert.equal(first.ok,true);
      assert.equal(calls.at(-1).tools,undefined);
      await send('widget-speech',{character,text:'休息一下吧。'});
      assert.equal(calls.length,before+1);
      assert.deepEqual((await send('history',{character})).result.history,history);
    }
    assert.equal(calls.length,10); // Identical source line is cached separately for each character.
    for(const character of Object.keys(japaneseStyles)){
      const before=(await send('history',{character})).result.history;
      const delayed=await send('chat',{character,text:'这句要等语音好了再出现。',deferDelivery:true});
      assert.ok(delayed.result.replyId);
      assert.ok(delayed.result.speechDelivery);
      let history=(await send('history',{character})).result.history;
      assert.equal(history.length,before.length+1); // User question only while voice is pending.
      assert.ok(calls.at(-1).messages.some(m=>m.role==='user'&&m.content==='今天很累。'));
      assert.ok(calls.at(-1).messages[0].content.includes('speechDelivery'));
      assert.equal((await send('reply-delivered',{character,replyId:delayed.result.replyId})).result.delivered,true);
      history=(await send('history',{character})).result.history;
      assert.equal(history.length,before.length+2);
      assert.equal((await send('reply-delivered',{character,replyId:delayed.result.replyId})).result.delivered,false);
      const cancelled=await send('chat',{character,text:'取消这次语音。',deferDelivery:true});
      await send('reply-discarded',{character,replyId:cancelled.result.replyId});
      assert.equal((await send('reply-delivered',{character,replyId:cancelled.result.replyId})).result.delivered,false);
      assert.equal((await send('history',{character})).result.history.length,history.length+1);
    }
    const beforeRepair=calls.length;
    malformedReplies=1;
    const repaired=await send('chat',{character:'高松灯',text:'请用日语回答。',deferDelivery:true});
    assert.equal(repaired.ok,true);assert.equal(repaired.result.japanese,'一緒に休もう。');
    assert.equal(calls.length,beforeRepair+2);
    assert.equal(calls.at(-1).response_format.type,'json_object');
    await send('reply-discarded',{character:'高松灯',replyId:repaired.result.replyId});
    for(const character of Object.keys(japaneseStyles)){
      for(const type of ['chat','widget-speech','observe']){
        englishReplies=1;const before=calls.length;
        const fixed=await send(type,{character,text:'英文朗读检查。',application:'UnknownMusicApp'});
        assert.equal(fixed.ok,true);assert.equal(calls.length,before+2);
        assert.ok(!/[A-Za-z]/.test(fixed.result.japanese));
        assert.ok(calls.at(-1).messages.at(-1).content.includes('拉丁字母'));
      }
    }
    console.log('Five-role context, JSON repair, delivery instructions, deferred history commit and cancelled-reply suppression: ok');
  } finally {
    fs.rmSync(folder,{recursive:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

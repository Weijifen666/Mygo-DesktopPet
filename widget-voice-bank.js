// Fixed widget speech is decoded ahead of clicks. This path never calls an LLM or TTS.
(() => {
  const roles=['tomori','anon','rana','soyo','taki'];
  // Keep the model's native rate in decoded caches; all five roles stay resident.
  const context=new AudioContext({sampleRate:24000});
  const buffers=new Map();
  let rows=[];
  let active;
  let role;
  let loading;
  let readyCount=0;
  let fixed=new Set();
  let revision;
  const roleLoads=new Map();
  const key=(r,s)=>JSON.stringify([r,s.trim()]);
  function removeLeadingSilence(buffer){
    const samples=buffer.getChannelData(0);let first=0;
    while(first<samples.length && Math.abs(samples[first])<.0003)first++;
    const start=Math.max(0,first-Math.round(buffer.sampleRate*.03));
    if(start<buffer.sampleRate*.04 || first===samples.length)return buffer;
    const trimmed=context.createBuffer(buffer.numberOfChannels,buffer.length-start,buffer.sampleRate);
    for(let i=0;i<buffer.numberOfChannels;i++)trimmed.copyToChannel(buffer.getChannelData(i).subarray(start),i);
    return trimmed;
  }
  async function loadRole(index,force=false,background=false) {
    const requested=roles[index] || roles[0];
    if(!background)role=requested;
    if(roleLoads.has(requested) && !force)return roleLoads.get(requested);
    loading=(async()=>{
      if(!fixed.size){const catalog=await fetch('./tts/widget-bank/catalog.json');const data=await catalog.json();fixed=new Set(data.rows.map(r=>key(r.role,r.source)));}
      const response=await fetch('./tts/widget-bank/manifest.json',{cache:'no-store'});
      if(!response.ok)throw new Error('Fixed voice bank has not finished building');
      const manifest=await response.json();
      if(revision!==manifest.voice_revision){buffers.clear();revision=manifest.voice_revision;}
      const selectedRows=Object.values(manifest.rows || {}).filter(row=>row.role===requested);
      rows=selectedRows;
      let next=0;
      await Promise.all(Array.from({length:6},async()=>{
        while(next<selectedRows.length){
          const row=selectedRows[next++];
          if(buffers.get(key(requested,row.source))?.row.file===row.file)continue;
          if(!/^[a-z0-9/-]+\.wav$/.test(row.file) || row.file.includes('..'))continue;
          const audio=await fetch('./tts/widget-bank/'+row.file);
          if(!audio.ok)continue;
          const buffer=removeLeadingSilence(await context.decodeAudioData(await audio.arrayBuffer()));
          buffers.set(key(requested,row.source),{buffer,row});
        }
      }));
    })().catch(()=>{});
    roleLoads.set(requested,loading);
    return loading;
  }
  function stop(){if(active){try{active.stop();}catch{}active.disconnect();active=null;}}
  function playBuffer(buffer,onStart,row) {
    stop();
    const node=context.createBufferSource();node.buffer=buffer;node.connect(context.destination);active=node;
    node.mygoReply=!row;
    node.mygoRow=row;
    node.onended=()=>{if(active===node){active=null;node.disconnect();}};
    const start=()=>{if(active!==node)return;node.start();onStart?.(row);};
    if(context.state==='running')start();else context.resume().then(start).catch(stop);
    return true;
  }
  function play(index,source,onStart) {
    const requested=roles[index] || roles[0];
    const item=buffers.get(key(requested,source));
    if(!item)return false;
    return playBuffer(item.buffer,onStart,item.row);
  }
  async function prepareSpeech(base64) {
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    const buffer=removeLeadingSilence(await context.decodeAudioData(bytes.buffer));
    if(context.state!=='running')await context.resume();
    return buffer;
  }
  async function preloadAll(index=0){await loadRole(index);for(let i=0;i<roles.length;i++)if(i!==index)await loadRole(i,false,true);}
  window.mygoWidgetBank={loadRole,preloadAll,prepareSpeech,playBuffer,play,stop,isFixed:(index,source)=>fixed.has(key(roles[index]||roles[0],source)),get playing(){return !!active;},get activeSource(){return active?.mygoRow?.source;},get replyPlaying(){return !!active?.mygoReply;},get readyCount(){return [...buffers.values()].filter(v=>v.row.role===role).length;}};
  setInterval(()=>{if(role)loadRole(roles.indexOf(role),true);},20000);
})();

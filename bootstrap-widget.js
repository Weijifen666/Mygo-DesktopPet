// Decode the fixed voice bank before making the clickable model visible.
// All role switches then use already prepared audio, without synthesis on click.
(async()=>{
  await window.mygoFixedReady;
  const script=document.createElement('script');
  script.src='./autoload.js?width_limit=0&preload=IDLE';
  document.body.appendChild(script);
})();

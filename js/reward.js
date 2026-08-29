(function(){
  'use strict';
  const mask=document.getElementById('rewardMask'),
        fab=document.getElementById('rewardFab'),
        close=document.getElementById('rewardClose'),
        toast=document.getElementById('rewardToast'),
        inputZone=document.getElementById('rewardInputZone'),
        celebrate=document.getElementById('rewardCelebrate'),
        celeContent=document.getElementById('rewardCeleContent'),
        celeAmount=document.getElementById('rewardCeleAmount'),
        celeRank=document.getElementById('rewardCeleRank'),
        amt=document.getElementById('rewardAmt'),
        confirm=document.getElementById('rewardConfirm'),
        soft=document.getElementById('rewardSoft'),
        celeClose=document.getElementById('rewardCeleClose'),
        cv=document.getElementById('rewardFw'),
        card=document.querySelector('.reward-card');

  if(!fab||!mask) return;

  function resetForm(){
    if(inputZone) inputZone.style.display='block';
    if(celebrate) celebrate.style.display='none';
    if(amt) amt.value='';
  }
  function open(){ mask.style.display='flex'; resetForm(); }
  function closeModal(){ mask.style.display='none'; }
  function showToast(){
    if(!toast) return;
    toast.classList.add('show');
    setTimeout(()=>toast.classList.remove('show'),3000);
  }

  fab.onclick=open;
  close.onclick=closeModal;
  mask.onclick=e=>{if(e.target===mask) closeModal();};
  document.querySelectorAll('.reward-open-link').forEach(a=>a.onclick=e=>{e.preventDefault();open();});

  if(confirm){
    confirm.onclick=()=>{
      const v=parseFloat(amt.value);
      if(!v||v<=0){ amt.style.borderColor='#e24b4a'; amt.focus(); return; }
      amt.style.borderColor='';
      celebrate.style.display='flex';
      celeAmount.innerHTML='¥ <span>'+v+'</span><small>元</small>';
      celeRank.textContent=128+Math.floor(Math.random()*17);
      celeContent.style.animation='none';
      void celeContent.offsetWidth;
      celeContent.style.animation='';
      startFw();
    };
  }
  if(amt) amt.oninput=()=>amt.style.borderColor='';
  if(soft) soft.onclick=()=>{ closeModal(); showToast(); };
  if(celeClose) celeClose.onclick=closeModal;

  /* 烟花 */
  let ctx=cv?cv.getContext('2d'):null, parts=[], raf=null, startT=0;
  function resize(){ if(cv&&card){ cv.width=card.clientWidth; cv.height=card.clientHeight; } }
  function burst(x,y,hueBase){
    for(let i=0;i<70;i++){
      const a=Math.PI*2*i/70, sp=2+Math.random()*3.6;
      parts.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1,hue:hueBase+Math.random()*50,g:.055});
    }
  }
  function tick(){
    if(!ctx||!cv) return;
    ctx.fillStyle='rgba(28,22,46,0.22)'; ctx.fillRect(0,0,cv.width,cv.height);
    parts.forEach(p=>{
      p.x+=p.vx; p.y+=p.vy; p.vy+=p.g; p.vx*=0.99; p.life-=0.013;
      ctx.globalAlpha=Math.max(p.life,0);
      ctx.fillStyle='hsl('+p.hue+',90%,62%)';
      ctx.beginPath(); ctx.arc(p.x,p.y,2.3,0,7); ctx.fill();
    });
    ctx.globalAlpha=1; parts=parts.filter(p=>p.life>0);
    const el=performance.now()-startT;
    if(el<3000 && Math.random()<0.12){
      const hue=Math.random()<0.5?30:320+Math.random()*40;
      burst(40+Math.random()*(cv.width-80), 40+Math.random()*(cv.height*0.5), hue);
    }
    if(parts.length||el<3000){ raf=requestAnimationFrame(tick); }
  }
  function startFw(){
    if(!cv||!ctx) return;
    cancelAnimationFrame(raf); resize(); parts=[]; startT=performance.now();
    burst(cv.width/2,cv.height*0.35,30);
    setTimeout(()=>burst(cv.width*0.25,cv.height*0.28,350),400);
    setTimeout(()=>burst(cv.width*0.75,cv.height*0.3,40),800);
    raf=requestAnimationFrame(tick);
  }
})();

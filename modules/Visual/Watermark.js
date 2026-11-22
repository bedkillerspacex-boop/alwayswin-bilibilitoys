const sevenImg=new Image();
let sevenTimer=0;
let sevenGlowSprite=null;
let sevenGlowSize=0;
function loadSeven(){
  const src=document.documentElement?.getAttribute('data-solstice-seven')||'';
  if(src&&sevenImg.src!==src){
    sevenImg.src=src;
  }
}
sevenImg.addEventListener('load',()=>{
  if(sevenTimer){clearInterval(sevenTimer);sevenTimer=0;}
});
loadSeven();
sevenTimer=setInterval(loadSeven,500);

const awImg=new Image();
let awTimer=0;
let awTintCanvas=null;
let awTintKey='';
function loadAlwaysWin(){
  const src=document.documentElement?.getAttribute('data-solstice-alwayswin')||'';
  if(src&&awImg.src!==src){
    awImg.src=src;
  }
}
awImg.addEventListener('load',()=>{
  if(awTimer){clearInterval(awTimer);awTimer=0;}
  awTintKey='';
});
loadAlwaysWin();
awTimer=setInterval(loadAlwaysWin,500);

function tintedAlwaysWin(w,h,c){
  const key=`${w}x${h}:${c[0]},${c[1]},${c[2]}`;
  if(awTintCanvas&&awTintKey===key) return awTintCanvas;
  if(!awTintCanvas) awTintCanvas=document.createElement('canvas');
  awTintCanvas.width=w;
  awTintCanvas.height=h;
  const g=awTintCanvas.getContext('2d');
  g.clearRect(0,0,w,h);
  g.drawImage(awImg,0,0,w,h);
  g.globalCompositeOperation='source-in';
  g.fillStyle=rgb(c,1);
  g.fillRect(0,0,w,h);
  g.globalCompositeOperation='source-over';
  awTintKey=key;
  return awTintCanvas;
}

function sevenGlow(width){
  const radius=width*.525;
  const thickness=100;
  const outer=radius+thickness;
  const size=Math.ceil(outer*2+2);
  if(sevenGlowSprite&&sevenGlowSize===size){
    return sevenGlowSprite;
  }
  const canvas=document.createElement('canvas');
  canvas.width=size;
  canvas.height=size;
  const g=canvas.getContext('2d');
  const center=size/2;
  const edge=radius/outer;
  const gradient=g.createRadialGradient(center,center,0,center,center,outer);
  gradient.addColorStop(0,'rgba(255,0,0,.36)');
  gradient.addColorStop(edge,'rgba(255,0,0,.36)');
  gradient.addColorStop(edge+.1*(1-edge),'rgba(255,0,0,.28)');
  gradient.addColorStop(edge+.25*(1-edge),'rgba(255,0,0,.16)');
  gradient.addColorStop(edge+.5*(1-edge),'rgba(255,0,0,.06)');
  gradient.addColorStop(edge+.75*(1-edge),'rgba(255,0,0,.015)');
  gradient.addColorStop(1,'rgba(255,0,0,0)');
  g.fillStyle=gradient;
  g.beginPath();
  g.arc(center,center,outer,0,Math.PI*2);
  g.fill();
  sevenGlowSprite=canvas;
  sevenGlowSize=size;
  return canvas;
}

function drawWatermark(dt){
  ctx.save(); ctx.scale(K,K);
  const wm=getMod('Watermark');
  wm.anim=clamp(animate(wm.on?1:0,wm.anim,dt*10),0,1);
  if(wm.anim<0.01){ ctx.restore(); return; }
  const layout=hudElement('Watermark',20,20,200,45);
  hudApplyScale(layout);
  const px=lerp(layout.x-220,layout.x,wm.anim), py=lerp(layout.y-220,layout.y,wm.anim);

  const stS=wm.settings.find(s=>s.n==='Style');
  const style=stS?(stS.vals[stS.v]||'AlwaysWin'):'AlwaysWin';

  if(style==='7 Days'){
    if(sevenImg.complete&&sevenImg.naturalWidth){
      const w=Math.max(1,Math.round(sevenImg.naturalWidth/10));
      const h=Math.max(1,Math.round(sevenImg.naturalHeight/10));
      hudSetSize('Watermark',w,h);
      if(wmGlow()){
        const glow=sevenGlow(w);
        const size=glow.width;
        ctx.globalAlpha=wm.anim;
        ctx.drawImage(glow,px+w/2-size/2,py+h/2-size/2,size,size);
        ctx.globalAlpha=1;
      }
      ctx.globalAlpha=wm.anim;
      ctx.drawImage(sevenImg,px,py,w,h);
      ctx.globalAlpha=1;
    }else{
      loadSeven();
      drawSevenDaysWatermark(px,py,layout,wm.anim);
    }
    ctx.restore();
    return;
  }

  const glowS=wm.settings.find(s=>s.n==='Glow');
  const glow=glowS?glowS.v===1:true;
  const text='alwayswin', size=45;
  const hasIcon=awImg.complete&&awImg.naturalWidth>0&&awImg.naturalHeight>0;
  const iconH=hasIcon?Math.round(size*0.92):0;
  const iconW=hasIcon?Math.max(1,Math.round(iconH*(awImg.naturalWidth/awImg.naturalHeight))):0;
  const iconGap=hasIcon?10:0;
  const iconC=themed(0);
  const chars=[]; let x=px+iconW+iconGap;
  setFont(size,true);
  for(let i=0;i<text.length;i++){
    const ch=text[i], c=themed((i+1)*100);
    chars.push({ch,x,c,w:tw(ch,size,true)});
    x+=tw(ch,size,true);
  }
  /* 一整块光晕精灵盖在字下面，替代每个字一次 shadowBlur */
  if(glow){
    const perfWm=window.SolsticePerf;
    const mid=chars.length?chars[Math.floor(chars.length/2)].c:[255,255,255];
    if(perfWm) perfWm.glow(px-8,py-6,(x-px)+16,size+12,mid,size*0.5,0.75*wm.anim);
    else {
      ctx.save();
      ctx.shadowColor=rgb(mid,0.85*wm.anim); ctx.shadowBlur=size/3;
      ctx.fillStyle=rgb(mid,0.9); ctx.fillText(text,px,py);
      ctx.restore();
    }
  }
  if(hasIcon){
    const iy=py+Math.round((size-iconH)/2);
    const tinted=tintedAlwaysWin(iconW,iconH,iconC);
    const perfWm=window.SolsticePerf;
    if(glow&&!perfWm){
      ctx.save();
      ctx.shadowColor=rgb(iconC,0.85*wm.anim); ctx.shadowBlur=size/3;
      ctx.globalAlpha=wm.anim;
      ctx.drawImage(tinted,px,iy,iconW,iconH);
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha=0.925*wm.anim;
    const shadowTint=tintedAlwaysWin(iconW,iconH,[Math.round(iconC[0]*0.25),Math.round(iconC[1]*0.25),Math.round(iconC[2]*0.25)]);
    ctx.drawImage(shadowTint,px+3.25,iy+3.25,iconW,iconH);
    ctx.globalAlpha=wm.anim;
    ctx.drawImage(tinted,px,iy,iconW,iconH);
    ctx.restore();
  }
  hudSetSize('Watermark',x-px,size);
  if(!(window.SolsticePerf&&window.SolsticePerf.fps<40)){
    for(const q of chars){
      ctx.fillStyle=rgb([q.c[0]*0.25,q.c[1]*0.25,q.c[2]*0.25],0.925);
      ctx.fillText(q.ch,q.x+3.25,py+3.25);
    }
  }
  for(const q of chars){
    ctx.fillStyle=rgb(q.c,1);
    ctx.fillText(q.ch,q.x,py);
  }
  ctx.restore();
}
function wmGlow(){const s=getMod('Watermark').settings.find(x=>x.n==='Glow');return s?s.v===1:true;}

/* 7 Days 风格：纯 canvas 复刻的白色铭牌，不依赖任何外部图片资源 */
function drawSevenDaysWatermark(px,py,layout,a){
  const label='7DAYS';
  const size=30;
  setFont(size,true);
  const textW=tw(label,size,true);
  const padX=13, padY=7;
  const w=Math.ceil(textW+padX*2), h=Math.ceil(size+padY*2);

  hudSetSize('Watermark',w,h);

  const perf7=window.SolsticePerf;
  if(perf7) perf7.glow(px-4,py-2,w+8,h+8,[0,0,0],14,0.5*a);
  fillRR(px,py,w,h,4,[247,247,249],0.95*a,CORNER_TOP|CORNER_BOTTOM);

  /* 左侧红色竖条 + 底部下划线 */
  fillRR(px+padX,py+padY+2,3,size-4,1,[232,58,72],a,CORNER_TOP|CORNER_BOTTOM);
  fillRR(px+padX,py+h-6,textW*0.32,2,0,[232,58,72],a,0);

  text(px+padX+9,py+padY-1,label,[20,20,24],a,false,true,size);

  /* 右上角的细描边，避免大白块糊成一片 */
  ctx.save();
  ctx.strokeStyle=`rgba(12,12,16,${(0.12*a).toFixed(3)})`;
  ctx.lineWidth=1;
  rrPath(px+0.5,py+0.5,w-1,h-1,4,CORNER_TOP|CORNER_BOTTOM);
  ctx.stroke();
  ctx.restore();
}

register({
  name:"Watermark",
  desc:"Displays a watermark on the screen",
  cat:"Visual",
  nm:{l:"watermark",ls:"water mark",n:"Watermark",ns:"Watermark"},
  disp:"Style",
  settings:[
    {t:"e",n:"Style",d:"The style of the watermark.",v:0,vals:["AlwaysWin","7 Days"]},
    {t:"b",n:"Glow",d:"Enables glow",v:1}
  ],
  renderOrder:2,
  onRender:drawWatermark,
  defaultOn:true,
  onEnable(){}
});

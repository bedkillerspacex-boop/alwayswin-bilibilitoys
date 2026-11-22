const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
const lerp=(a,b,t)=>a+t*(b-a);
const animate=(target,cur,speed)=>{speed=clamp(speed,0,1);return cur+(target-cur)*speed;};
class Ease{
  constructor(){this.p=0;}
  outExpo(){return 1-Math.pow(2,-8*this.p);}
  outBack(){const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(this.p-1,3)+c1*Math.pow(this.p-1,2);}
  outElastic(){const t=(this.p-1)*(this.p-1);return 1-t*t*Math.cos(this.p*Math.PI*2.25);}
  inc(v){this.p+=v;if(this.p>=1)this.p=1;}
  dec(v){this.p-=v;if(this.p<=0)this.p=0;}
}

const rgb=(c,a=1)=>`rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${clamp(a,0,1)})`;
const lerpC=(a,b,t)=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)];
function hsv2rgb(h,s,v){
  const i=Math.floor(h*6),f=h*6-i,p=v*(1-s),q=v*(1-f*s),t=v*(1-(1-f)*s);
  let r,g,b;
  switch(i%6){case 0:r=v;g=t;b=p;break;case 1:r=q;g=v;b=p;break;case 2:r=p;g=v;b=t;break;
    case 3:r=p;g=q;b=v;break;case 4:r=t;g=p;b=v;break;default:r=v;g=p;b=q;}
  return [r*255,g*255,b*255];
}
function rgb2hsv(r,g,b){
  r/=255;g/=255;b/=255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
  let h=0;
  if(d){ if(mx===r) h=((g-b)/d+(g<b?6:0)); else if(mx===g) h=(b-r)/d+2; else h=(r-g)/d+4; }
  return [h/6, mx?d/mx:0, mx];
}
const CATS=["Combat","Movement","Player","Visual","Misc"];
const RAW_MODULES=[];
function register(def){RAW_MODULES.push(def);}
let MODS=[],BY_NAME={},BY_CAT=[],RENDER_MODS=[];
const norm=x=>x.toLowerCase().replace(/[\s_]/g,'');

function buildModules(){
  MODS=RAW_MODULES.map(m=>({
    name:m.name, desc:m.desc, cat:m.cat, nm:m.nm, disp:m.disp,
    on:false, cAnim:0, cScale:0, showSettings:false, animList:0, key:m.key||0,
    settings:[{t:'b',n:'Visible',d:'Whether the module is visible in the Arraylist',v:1,bs:1,
               sliderEase:0,enumSlide:0,enumExtended:false,isDragging:false,vis:true}]
      .concat((m.settings||[]).map(s=>({...s,bs:s.t==='b'?s.v:0,sliderEase:0,enumSlide:0,enumExtended:false,isDragging:false,vis:true}))),
    anim:0, onEnable:m.onEnable||function(){}, onRender:m.onRender||null, renderOrder:m.renderOrder||0,
    defaultOn:!!m.defaultOn, onInit:m.onInit||null
  }));
  BY_NAME={};
  MODS.forEach(m=>{ BY_NAME[m.name]=m; BY_NAME[norm(m.name)]=m; if(m.nm&&m.nm.n){BY_NAME[m.nm.n]=m;BY_NAME[norm(m.nm.n)]=m;} });
  BY_CAT=CATS.map(c=>MODS.filter(m=>m.cat===c));
  RENDER_MODS=MODS.filter(m=>m.onRender).sort((x,y)=>x.renderOrder-y.renderOrder);
  MODS.forEach(m=>{ if(m.defaultOn){m.on=true;m.animList=1;m.cScale=1;} if(m.onInit) m.onInit(m); });
}

function setModuleOn(mod,enabled){
  if(!mod) return;
  const next=Boolean(enabled);
  if(mod.on===next) return;
  mod.on=next;
  document.dispatchEvent(new CustomEvent('solstice:module-toggle',{detail:{name:mod.name,enabled:next}}));
}

const getMod=n=>BY_NAME[n];
let NOW_MS=0;

const measureCache=new Map();
const clearMeasure=()=>measureCache.clear();
if(document.fonts){
  document.fonts.addEventListener('loadingdone',clearMeasure);
  document.fonts.ready.then(clearMeasure);
  setTimeout(clearMeasure,200);
  setTimeout(clearMeasure,600);
  setTimeout(clearMeasure,1500);
}
function setFont(px,bold,icons){
  ctx.font = icons? `400 ${px}px "Tenacity Icons", monospace`
                  : `${bold?'700':'400'} ${px}px "${uiFont()}", system-ui, sans-serif`;
  ctx.textBaseline='top';
}
function tw(str,px,bold,icons){
  const k=(icons?'i':(bold?'b':'r'))+px+'|'+(icons?'':uiFont())+'|'+str;
  let v=measureCache.get(k);
  if(v===undefined){setFont(px,bold,icons);v=ctx.measureText(str).width;measureCache.set(k,v);}
  return v;
}
const TH=18;
function text(x,y,str,color,alpha,shadow,bold,px,icons){
  if(alpha<=0.002||!str) return;
  setFont(px,bold,icons);
  if(shadow){
    ctx.fillStyle=rgb([color[0]*0.25,color[1]*0.25,color[2]*0.25],alpha*1);
    ctx.fillText(str,x+1,y+1);
  }
  ctx.fillStyle=rgb(color,alpha);
  ctx.fillText(str,x,y);
}

const CORNER_TOP=1,CORNER_BOTTOM=2;
function rrPath(x,y,w,h,r,flags){
  if(w<0){x+=w;w=-w;} if(h<0){y+=h;h=-h;}
  r=Math.min(r,w/2,h/2);
  const tl=(flags&CORNER_TOP)?r:0, tr=(flags&CORNER_TOP)?r:0;
  const br=(flags&CORNER_BOTTOM)?r:0, bl=(flags&CORNER_BOTTOM)?r:0;
  ctx.beginPath();
  ctx.moveTo(x+tl,y);
  ctx.lineTo(x+w-tr,y); if(tr) ctx.quadraticCurveTo(x+w,y,x+w,y+tr);
  ctx.lineTo(x+w,y+h-br); if(br) ctx.quadraticCurveTo(x+w,y+h,x+w-br,y+h);
  ctx.lineTo(x+bl,y+h); if(bl) ctx.quadraticCurveTo(x,y+h,x,y+h-bl);
  ctx.lineTo(x,y+tl); if(tl) ctx.quadraticCurveTo(x,y,x+tl,y);
  ctx.closePath();
}
function fillRR(x,y,w,h,r,color,alpha,flags){
  if(alpha<=0.002||w<=0||h<=0) return;
  rrPath(x,y,w,h,r,flags||0);
  ctx.fillStyle=rgb(color,alpha); ctx.fill();
}
function fillGradRR(x,y,w,h,r,c1,c2,alpha,flags){
  if(alpha<=0.002||w<=0||h<=0) return;
  rrPath(x,y,w,h,r,flags||0);
  const g=ctx.createLinearGradient(x,y,x+w,y+h);
  g.addColorStop(0,rgb(c1,alpha)); g.addColorStop(1,rgb(c2,alpha));
  ctx.fillStyle=g; ctx.fill();
}
function gradFade(x,y,w,h,c1,c2,a1,a2){
  if(h<=0) return;
  const g=ctx.createLinearGradient(0,y,0,y+h);
  g.addColorStop(0,rgb(c1,a2)); g.addColorStop(1,rgb(c1,a1));
  ctx.fillStyle=g; ctx.fillRect(x,y,w,h);
}
function glowRect(x,y,w,h,r,color,alpha,blur){
  ctx.save();
  ctx.shadowColor=rgb(color,alpha); ctx.shadowBlur=blur;
  fillRR(x,y,w,h,r,[0,0,0],0.001,0);
  ctx.restore();
}

const canvas=document.getElementById('hud');
const ctx=canvas.getContext('2d');
let W=0,H=0,DPR=1,CX=0,CY=0,K=1;
const bgImg=document.getElementById('bg');

const S={
  open:true,
  ease:new Ease(),
  anim:1,
  inScale:0.996,
  wheel:0,
  mx:0,my:0,
  down:[false,false,false],
  clicked:[false,false,false],
  cats:[],
  dragCat:null, dragOff:{x:0,y:0},
  dragSetting:null,
  picker:null, pickerDrag:null,
  tooltip:'', tipAlpha:1, clickAnim:1, bindBool:null, binding:null,
  hintKilled:false,
  hudEditor:false,
  isMobile:(typeof navigator!=='undefined'&&(navigator.maxTouchPoints>0&&typeof matchMedia==='function'&&matchMedia('(pointer: coarse)').matches))||/Android|iPhone|iPad|iPod|Mobile/i.test(typeof navigator!=='undefined'?navigator.userAgent:''),
  isTouch:false,
  touchTap:false,
  touchLongPress:false
};

const HUD_LAYOUT_KEY='solstice.hud.layout';
const HUD_ELEMENTS={};
let HUD_LAYOUT={};
try{
  HUD_LAYOUT=JSON.parse(localStorage.getItem(HUD_LAYOUT_KEY)||'{}')||{};
}catch{
  HUD_LAYOUT={};
}

function hudElement(name,defX,defY,w,h){
  const stored=HUD_LAYOUT[name]||{};
  const x=Number(stored.x),y=Number(stored.y),sc=Number(stored.scale);
  const element={
    x:Number.isFinite(x)?x:defX,
    y:Number.isFinite(y)?y:defY,
    w,h,
    scale:Number.isFinite(sc)&&sc>0?clamp(sc,0.4,3):1
  };
  HUD_ELEMENTS[name]=element;
  return element;
}

function hudApplyScale(element){
  const sc=element&&Number.isFinite(element.scale)&&element.scale>0?element.scale:1;
  if(sc!==1){
    ctx.translate(element.x,element.y);
    ctx.scale(sc,sc);
    ctx.translate(-element.x,-element.y);
  }
  return sc;
}

function hudSetSize(name,w,h){
  const element=HUD_ELEMENTS[name];
  if(element){element.w=w;element.h=h;}
}

function hudSave(){
  try{
    localStorage.setItem(HUD_LAYOUT_KEY,JSON.stringify(HUD_LAYOUT));
  }catch{

  }
}

const CAT_W=200, CAT_H=30, CAT_GAP=40;

function resetCats(){
  S.cats=[];
  const cx=W/2, startX=cx-(CATS.length*(CAT_W+CAT_GAP))/2;
  for(let i=0;i<CATS.length;i++){
    S.cats.push({
      x:Math.round((startX+i*(CAT_W+CAT_GAP))/2)*2,
      y:Math.round((CAT_GAP*2)/2)*2,
      extended:true, wasExtended:true, dragging:false,
      yOffset:0, scrollEase:0
    });
  }
}
function resize(){
  DPR=Math.min(window.devicePixelRatio||1,2);
  W=window.innerWidth; H=window.innerHeight;
  canvas.width=Math.floor(W*DPR); canvas.height=Math.floor(H*DPR);
  canvas.style.width=W+'px'; canvas.style.height=H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
  CX=W/2; CY=H/2;
  K=Math.min(1,W/1680);
  resetCats();
}
window.addEventListener('resize',resize);

const inside=(px,py,r)=>px>=r.x&&py>=r.y&&px<r.w&&py<r.h;
const T=30;

function settingsHeight(mod){
  let h=0;
  for(const st of mod.settings){
    if(!st.vis) continue;
    h+=T;
    if(st.t==='e'&&st.enumSlide>0.001) h+=T*st.vals.length*st.enumSlide;
  }
  return h;
}

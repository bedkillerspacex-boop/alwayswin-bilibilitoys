let touchState=null;

function clearTouchState(){
  if(!touchState) return;
  if(touchState.timer) clearTimeout(touchState.timer);
  touchState=null;
}

canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{
  e.preventDefault();
  S.mx=e.clientX; S.my=e.clientY;
  if(e.pointerType==='touch'){
    S.isTouch=true;
    clearTouchState();
    const id=e.pointerId;
    const state={
      id,
      startX:e.clientX,
      startY:e.clientY,
      lastY:e.clientY,
      moved:false,
      longPressed:false,
      timer:0
    };
    state.timer=setTimeout(()=>{
      if(touchState&&touchState.id===id&&!touchState.moved){
        touchState.longPressed=true;
        S.touchLongPress=true;
      }
    },420);
    touchState=state;
    S.down[0]=true; S.clicked[0]=true;
  }else{
    S.isTouch=false;
    const b=e.button===2?1:(e.button===1?2:0);
    S.down[b]=true; S.clicked[b]=true;
  }
  try{canvas.setPointerCapture(e.pointerId);}catch(_){}
});
window.addEventListener('pointermove',e=>{
  S.mx=e.clientX; S.my=e.clientY;
  if(touchState&&e.pointerId===touchState.id){
    if(!touchState.moved&&Math.hypot(e.clientX-touchState.startX,e.clientY-touchState.startY)>10){
      touchState.moved=true;
      if(touchState.timer){ clearTimeout(touchState.timer); touchState.timer=0; }
    }
    if(touchState.moved&&!S.dragSetting&&!S.pickerDrag&&!S.dragCat){
      const dy=e.clientY-touchState.lastY;
      if(Math.abs(dy)>=10){
        S.wheel=dy>0?-1:1;
        touchState.lastY=e.clientY;
      }
    }
  }
});
window.addEventListener('pointerup',e=>{
  if(touchState&&e.pointerId===touchState.id){
    if(!touchState.moved&&!touchState.longPressed){
      S.touchTap=true;
    }
    clearTouchState();
    S.down[0]=false; S.pickerDrag=null;
    return;
  }
  const b=e.button===2?1:(e.button===1?2:0);
  S.down[b]=false; S.pickerDrag=null;
});
window.addEventListener('pointercancel',e=>{
  if(touchState&&e.pointerId===touchState.id){
    clearTouchState();
  }
  S.down=[false,false,false]; S.pickerDrag=null;
});
canvas.addEventListener('wheel',e=>{
  e.preventDefault();
  const d=e.deltaY;
  S.wheel=d>0?1:(d<0?-1:0);
},{passive:false});

const MODIFIER_CODES=new Set(['ShiftLeft','ShiftRight','ControlLeft','ControlRight','AltLeft','AltRight','MetaLeft','MetaRight']);
let pendingModifierBind=null;

function applyKeyBind(bind){
  if(!bind) return;
  const keys=window.SolsticeKeys;
  if(keys&&keys.hasReservedModifier(bind)){
    console.warn('[Solstice] Ctrl / Alt / Win combos are browser hotkeys - bind a plain key, Shift combo or Mouse4 / Mouse5.');
    return;
  }
  if(S.binding){ S.binding.key=bind; window.Solstice?.saveModuleBind?.(S.binding); S.binding=null; }
  else if(S.bindBool){ S.bindBool.key=bind; S.bindBool=null; }
}

window.addEventListener('keydown',e=>{
  if(document.getElementById('solstice-root')&&!document.documentElement.hasAttribute('data-solstice-open')) return;
  if(e.key==='Insert'){
    e.preventDefault();
    if(!S.binding&&!S.bindBool){ S.open=!S.open; S.wheel=0; killHint(); }
    return;
  }
  if(e.key==='Escape'||((S.binding||S.bindBool)&&(e.key==='Backspace'||e.key==='Delete'))){
    if(S.binding){ e.preventDefault(); e.stopImmediatePropagation(); S.binding.key=0; window.Solstice?.saveModuleBind?.(S.binding); S.binding=null; pendingModifierBind=null; return; }
    if(S.bindBool){ e.preventDefault(); e.stopImmediatePropagation(); S.bindBool.key=0; S.bindBool=null; pendingModifierBind=null; return; }
    if(e.key==='Escape'){
      e.preventDefault();
      if(S.picker){ S.picker=null; return; }
      if(S.open){ S.open=false; return; }
    }
  }
  if(!S.binding&&!S.bindBool) return;
  if(e.repeat) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const code=e.code||e.key;
  if(MODIFIER_CODES.has(code)){
    pendingModifierBind=(code==='ShiftLeft'||code==='ShiftRight')?code:null;
    return;
  }
  pendingModifierBind=null;
  const keys=window.SolsticeKeys;
  const bind=keys?keys.bindFromEvent(e):code;
  applyKeyBind(bind);
},true);

window.addEventListener('keyup',e=>{
  if(!S.binding&&!S.bindBool) return;
  if(pendingModifierBind&&(e.code===pendingModifierBind||e.key==='Shift')){
    e.preventDefault();
    e.stopImmediatePropagation();
    const bind=pendingModifierBind;
    pendingModifierBind=null;
    applyKeyBind(bind);
  }
},true);

window.addEventListener('mousedown',e=>{
  if(!S.binding&&!S.bindBool) return;
  const keys=window.SolsticeKeys;
  const bind=keys?keys.mouseBindFromEvent(e):'';
  if(!bind) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  pendingModifierBind=null;
  applyKeyBind(bind);
},true);
window.addEventListener('blur',()=>{ S.down=[false,false,false]; S.dragSetting=null; });

function killHint(){
  if(S.hintKilled) return;
  S.hintKilled=true;
  const h=document.getElementById('hint');
  if(h) h.classList.add('gone');
}
const hintEl=document.getElementById('hint');
if(hintEl){
  hintEl.addEventListener('click',()=>{ if(matchMedia('(pointer:coarse)').matches){ S.open=!S.open; } });
  setTimeout(killHint,11000);
}

let lastTs=0;
let lastVisualDrawAt=0;

/* 单个模块抛错绝不能带走整个渲染循环 */
function renderModule(mod,dt){
  ctx.save();
  try{
    mod.onRender(dt);
  }catch(error){
    if(!mod.__renderErrorLogged){
      mod.__renderErrorLogged=true;
      console.warn(`[AlwaysWin] ${mod.name} render failed`,error);
    }
  }finally{
    ctx.restore();
  }
}

function frame(ts){
  try{
    NOW_MS=ts;
    let dt=(ts-lastTs)/1000; lastTs=ts;
    if(!isFinite(dt)||dt<=0) dt=0.016;
    dt=Math.min(dt,0.05);

    /* 性能探针：自适应画质 + 主题色每帧缓存 */
    const perf=window.SolsticePerf;
    if(perf){ perf.tick(ts,dt); perf.beginFrame(); }

    const e=S.ease;
    if(S.open) e.inc(dt*18/10); else e.dec(dt*2*18/10);

    const animMode=(getMod('ClickGui').settings.find(s=>s.n==='Animation')||{v:1}).v;
    let inScale=animMode===1?(S.open?e.outElastic():e.outBack()):clamp(e.outExpo(),0,0.996);
    if(e.p>=1) inScale=0.996;
    S.anim=lerp(0,1,e.outExpo());
    S.inScale=inScale;

    const clickGui=getMod('ClickGui');
    if(clickGui) clickGui.on=S.open;

    const hudCfg=window.SolsticeHudSettings;
    const minInterval=(!S.open&&!S.hudEditor&&e.p<=0.001&&hudCfg&&hudCfg.active)
      ?(1000/Math.max(15,hudCfg.maxFps||60))
      :0;

    if(!document.hidden&&(minInterval<=0||ts-lastVisualDrawAt>=minInterval-1)){
      const visualDt=minInterval>0&&lastVisualDrawAt>0?Math.min(0.1,(ts-lastVisualDrawAt)/1000):dt;
      lastVisualDrawAt=ts;
      ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,W,H);
      for(const m of RENDER_MODS) renderModule(m,visualDt);
    }

    S.clicked=[false,false,false];
    S.touchTap=false;
    S.touchLongPress=false;
    S.wheel=0;
    if(!S.down[0]&&!S.down[2]) S.dragSetting=null;
    MODS.forEach(m=>{m.__clicked=false;});
  }catch(error){
    console.error('[Solstice] frame error',error);
  }finally{
    requestAnimationFrame(frame);
  }
}

buildModules();
resize();
requestAnimationFrame(frame);

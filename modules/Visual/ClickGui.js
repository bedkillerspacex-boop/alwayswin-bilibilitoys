function drawDim(a,s){
  if(a<=0.0005) return;
  ctx.fillStyle=`rgba(0,0,0,${0.38*a})`;
  ctx.fillRect(0,0,W,H);
  const c=themed(0);
  const firstH=lerp(H,H-H/3,s);
  gradFade(0,firstH,W,H-firstH,c,c,0.4*s,0);
}

function drawClickGui(dt){
  const a=S.anim, s=Math.max(0.0001,S.inScale*K);
  const cg=getMod('ClickGui'); if(cg) cg.on=S.open;
  if(bgImg&&cg) bgImg.style.filter=`blur(${(a*((cg.settings.find(x=>x.n==='Blur Strength')||{v:7}).v)).toFixed(2)}px)`;
  if(a<=0.0001) return;
  drawDim(a,S.inScale);

  const styleS=cg?cg.settings.find(x=>x.n==='Style'):null;
  const styleName=styleS?(styleS.vals[styleS.v]||'Sol'):'Sol';
  if(styleName==='Fatality'&&typeof drawFatalityClickGui==='function'){
    drawFatalityClickGui(a,dt);
    return;
  }

  const isOpen=S.open;
  const gmx=CX+(S.mx-CX)/s, gmy=CY+(S.my-CY)/s;
  let tooltip='';

  ctx.save();
  ctx.translate(CX,CY); ctx.scale(s,s); ctx.translate(-CX,-CY);

  for(let i=0;i<CATS.length;i++){
    const cp=S.cats[i], mods=BY_CAT[i];
    if(cp.dragging){
      if(S.down[0]){
        const g=S.dragGrab;
        cp.x=clamp(g.x+(S.mx-g.sx)/s, CX-CX/s, CX+(W-CX)/s-CAT_W);
        cp.y=clamp(g.y+(S.my-g.sy)/s, CY-CY/s, CY+(H-CY)/s-CAT_H);
      } else {
        cp.x=Math.round(cp.x); cp.y=Math.round(cp.y);
        cp.dragging=false; S.dragCat=null;
      }
    }
    let contentH=CAT_H;
    for(const m of mods) contentH+=T+m.cAnim*settingsHeight(m);

    const catRect={x:cp.x,y:cp.y,w:cp.x+CAT_W,h:cp.y+CAT_H};
    const catWindow={x:cp.x,y:cp.y,w:cp.x+CAT_W,h:cp.y+(-cp.yOffset)+contentH};

    if(isOpen&&cp.extended&&S.wheel!==0&&inside(gmx,gmy,catWindow)){
      cp.scrollEase+=S.wheel*CAT_H;
      cp.scrollEase=clamp(cp.scrollEase,0,Math.max(0,contentH-T*2));
      S.wheel=0;
    }
    if(!cp.extended){ cp.scrollEase=contentH-CAT_H; cp.wasExtended=false; }
    else if(!cp.wasExtended){ cp.scrollEase=0; cp.wasExtended=true; }
    cp.yOffset=animate(cp.scrollEase,cp.yOffset,dt*10.5);

    ctx.save();
    ctx.beginPath();
    ctx.rect(catRect.x,catRect.h+1.5,CAT_W,Math.max(0,H*2-(catRect.h+1.5)));
    ctx.clip();

    let moduleY=-cp.yOffset;
    let modIndex=0;
    for(const mod of mods){
      const endMod=(modIndex===mods.length-1);
      const radius=endMod?15*(1-mod.cAnim):0;
      const modTop=catRect.y+CAT_H+moduleY;
      const modRect={x:cp.x,y:modTop,w:cp.x+CAT_W,h:modTop+T};
      mod.cAnim=clamp(animate(mod.showSettings?1:0,mod.cAnim,dt*12.5),0,1);

      if(mod.cAnim>0.001){
        if(S.isMobile){
          moduleY=lerp(moduleY,moduleY+T,mod.cAnim);
          let bRect={x:cp.x,y:catRect.y+CAT_H+moduleY,w:cp.x+CAT_W,h:catRect.y+CAT_H+moduleY+T};
          bRect.y=Math.floor(bRect.y);
          if(bRect.y<modRect.y) bRect.y=modRect.y;
          if(bRect.y>catRect.y+0.5){
            const endBind=(mod.settings.filter(s=>s.vis).length===0)&&endMod;
            const rb=endBind?15:0;
            fillRR(bRect.x,bRect.y,bRect.w-bRect.x,bRect.h-bRect.y,rb,[30,30,30],a,CORNER_BOTTOM);
            if(inside(gmx,gmy,bRect)&&isOpen&&cp.extended){
              tooltip='Add or remove a quick toggle button on the game page.';
              if(S.clicked[0]&&!S.picker&&mod.showSettings){
                window.SolsticeMobile?.toggleShortcut?.(mod);
              }
            }
            const on=Boolean(window.SolsticeMobile?.hasShortcut?.(mod.name));
            const cY=bRect.y+((bRect.h-bRect.y)-TH)/2;
            const rgbC=themed(moduleY*2);
            text(bRect.x+PAD,cY,'Page Shortcut',on?[255,255,255]:[180,180,180],a,true,false,16);
            if(on){
              fillGradRR(bRect.w-PAD-14,bRect.y+T*0.28,14,T*0.44,4,rgbC,rgbC,a,0);
            } else {
              fillRR(bRect.w-PAD-14,bRect.y+T*0.28,14,T*0.44,4,[60,60,60],a,0);
            }
          }
        }
        let sIndex=0;
        const ST=mod.settings;
        for(const st of ST){
          if(!st.vis){ st.sliderEase=0; st.enumSlide=0; sIndex++; continue; }
          const endSetting=(sIndex===ST.length-1);
          const setPad=endSetting?(-2*a):0;
          const r2=endMod?(((sIndex===ST.length-1)?15:15*(1-mod.cAnim))):0;
          const rgbC=themed(moduleY*2);

          if(st.t==='b'){
            moduleY=lerp(moduleY,moduleY+T,mod.cAnim);
            let rect={x:cp.x,y:catRect.y+CAT_H+moduleY+setPad,w:cp.x+CAT_W,h:catRect.y+CAT_H+moduleY+T};
            rect.y=Math.floor(rect.y);
            if(rect.y<modRect.y) rect.y=modRect.y;
            if(rect.y>catRect.y+0.5){
              fillRR(rect.x,rect.y,rect.w-rect.x,rect.h-rect.y,r2,[30,30,30],a,CORNER_BOTTOM);
              if(inside(gmx,gmy,rect)&&isOpen&&cp.extended){
                tooltip=st.d;
                if(S.clicked[0]&&!S.picker&&mod.showSettings) st.v=st.v?0:1;
                if(S.clicked[2]&&!S.picker) { S.bindBool=st; }
              }
              st.bs=animate(st.v?1:0,st.bs,dt*10);
              const cY=rect.y+((rect.h-rect.y)-TH)/2;
              const bRect={x:rect.w-23.5,y:cY-2.5,w:rect.w-5,h:cY+17.5};
              const gx2=(bRect.x+bRect.w)/2, gy2=(bRect.y+bRect.h)/2;
              const sc=lerpC([15,15,15],rgbC,st.bs);
              const grd=ctx.createRadialGradient(gx2,gy2,2,gx2,gy2,13);
              grd.addColorStop(0,rgb(sc,0.55*a*mod.cAnim));
              grd.addColorStop(1,rgb(sc,0));
              ctx.fillStyle=grd;
              ctx.beginPath(); ctx.arc(gx2,gy2,13,0,Math.PI*2); ctx.fill();

              if(st.bs>0.01){
                const topY=Math.max(bRect.y,modRect.h);
                ctx.save();
                ctx.beginPath();
                ctx.rect(bRect.x,topY,(bRect.w-bRect.x)*st.bs,bRect.h-topY);
                ctx.clip();
                const cs=1.3*a, ox=gx2-4*a, oy=gy2-1*a;
                ctx.strokeStyle=rgb(rgbC,mod.cAnim*a);
                ctx.lineWidth=1;
                ctx.beginPath(); ctx.moveTo(ox,oy); ctx.lineTo(ox+3*cs,oy+3*cs); ctx.lineTo(ox+7*cs,oy-3*cs); ctx.stroke();
                ctx.restore();
              }
              text(rect.x+5,cY,st.n,[255,255,255],a,true,false,18);
            }
          }
          else if(st.t==='n'){
            moduleY=lerp(moduleY,moduleY+T,mod.cAnim);
            let bg={x:cp.x,y:catRect.y+CAT_H+moduleY,w:cp.x+CAT_W,h:catRect.y+CAT_H+moduleY+T};
            bg.y=Math.floor(bg.y);
            if(bg.y<modRect.y) bg.y=modRect.y;
            let rect={x:cp.x+7,y:bg.y,w:cp.x+CAT_W-7,h:bg.h};
            rect.y=Math.floor(rect.y);
            if(rect.y<modRect.y) rect.y=modRect.y;
            if(bg.y>catRect.y+0.5){
              fillRR(bg.x,bg.y,bg.w-bg.x,bg.h-bg.y,r2,[30,30,30],a,CORNER_BOTTOM);
              const span=rect.w-rect.x;
              const sliderPos=((st.v-st.min)/((st.max-st.min)||1))*span;
              st.sliderEase=clamp(animate(sliderPos,st.sliderEase,dt*10),0,span);
              if(inside(gmx,gmy,rect)&&isOpen&&cp.extended){
                tooltip=st.d;
                if(S.down[0]||S.down[2]) S.dragSetting=st;
              }
              if(S.dragSetting===st&&S.down[0]&&isOpen){
                const nv=((gmx-rect.x)/span)*(st.max-st.min)+st.min;
                st.v=clamp(nv,st.min,st.max);
                st.v=Math.round(st.v/st.step)*st.step;
              }
              else if(S.dragSetting===st&&S.down[2]&&isOpen){
                const rnd=(getMod('ClickGui').settings.find(x=>x.n==='Midclick Rounding')||{v:1}).v;
                let nv=((gmx-rect.x)/span)*(st.max-st.min)+st.min;
                nv=Math.round(nv/rnd)*rnd;
                st.v=clamp(nv,st.min,st.max);
              }
              const over=inside(gmx,gmy,rect);
              S.clickAnim=animate((S.down[0]&&over)?0.6:1,S.clickAnim,dt*10);
              const sbMinY=rect.h-(rect.h-rect.y)/8;
              const sbMaxY=rect.h;
              const barY=sbMaxY-4;
              const sliderRect={x:rect.x,y:barY-4.5,w:rect.x+(st.sliderEase),h:sbMaxY-6.5};
              fillRR(sliderRect.x,sliderRect.y,sliderRect.w-sliderRect.x,sliderRect.h-sliderRect.y,15,rgbC,a,3);
              let cpx=sliderRect.w-2.25;
              if(st.v<=st.min+0.83) cpx=sliderRect.w+2.25;
              const cpy=(sliderRect.y+sliderRect.h)/2;
              ctx.fillStyle=rgb(rgbC,a);
              ctx.beginPath(); ctx.arc(cpx,cpy,5.5*S.clickAnim*a,0,Math.PI*2); ctx.fill();
              ctx.save();
              ctx.shadowColor=rgb(rgbC,0.9*a); ctx.shadowBlur=12;
              fillRR(sliderRect.x,sliderRect.y,sliderRect.w-sliderRect.x,sliderRect.h-sliderRect.y,15,rgbC,a*0.55,3);
              ctx.restore();

              const val=st.v.toFixed(2);
              text(bg.w-5-tw(val,18),bg.y+2.5,val,[170,170,170],a,true,false,18);
              text(bg.x+5,bg.y+2.5,st.n,[255,255,255],a,true,false,18);
            }
          }
          else if(st.t==='c'){
            moduleY=lerp(moduleY,moduleY+T,mod.cAnim);
            let rect={x:cp.x,y:catRect.y+CAT_H+moduleY+setPad,w:cp.x+CAT_W,h:catRect.y+CAT_H+moduleY+T};
            rect.y=Math.floor(rect.y);
            if(rect.y<modRect.y) rect.y=modRect.y;
            if(rect.y>catRect.y+0.5){
              fillRR(rect.x,rect.y,rect.w-rect.x,rect.h-rect.y,0,[30,30,30],a,0);
              if(inside(gmx,gmy,rect)&&isOpen&&cp.extended){
                tooltip=st.d;
                if(S.clicked[0]&&!S.picker&&mod.showSettings){
                  const [h0,s0,v0]=rgb2hsv(st.v[0],st.v[1],st.v[2]);
                  S.picker={st:h0,s:s0,v:v0,target:st,justOpened:true};
                }
              }
              const cY=rect.y+((rect.h-rect.y)-TH)/2;
              text(rect.x+5,cY,st.n,[255,255,255],a,true,false,18);
              fillRR(rect.w-20,rect.y+5,15,(rect.h-rect.y)-10,0,st.v,a,0);
            }
          }
          else if(st.t==='e'){
            moduleY=lerp(moduleY,moduleY+T,mod.cAnim);
            let rect={x:cp.x,y:catRect.y+CAT_H+moduleY+setPad,w:cp.x+CAT_W,h:catRect.y+CAT_H+moduleY+T};
            rect.y=Math.floor(rect.y);
            if(rect.y<modRect.y) rect.y=modRect.y;

            st.enumSlide=clamp(animate((st.enumExtended&&mod.showSettings)?1:0,st.enumSlide,dt*10),0,1);
            if(st.enumSlide>0.001){
              for(let j=0;j<st.vals.length;j++){
                moduleY=lerp(moduleY,moduleY+T,st.enumSlide);
                const r2r={x:cp.x,y:catRect.y+CAT_H+moduleY+setPad,w:cp.x+CAT_W,h:catRect.y+CAT_H+moduleY+T};
                if(r2r.y>catRect.y+0.5){
                  fillRR(r2r.x,r2r.y,r2r.w-r2r.x,r2r.h-r2r.y,r2,[20,20,20],a,CORNER_BOTTOM);
                  if(st.v===j) fillRR(r2r.x,r2r.y,1.5,T,rgbC,a,0);
                  if(inside(gmx,gmy,r2r)&&S.clicked[0]&&isOpen&&!S.picker&&mod.showSettings) st.v=j;
                  const cy2=r2r.y+((r2r.h-r2r.y)-TH)/2;
                  text(r2r.x+5,cy2,st.vals[j],[255,255,255],a,true,false,18);
                }
              }
            }
            if(rect.y>catRect.y+0.5){
              fillRR(rect.x,rect.y,rect.w-rect.x,rect.h-rect.y,r2,[30,30,30],a,CORNER_BOTTOM);
              if(inside(gmx,gmy,rect)&&isOpen&&cp.extended){
                tooltip=st.d;
                if(S.clicked[0]&&!S.picker&&mod.showSettings) st.v=(st.v+1)%st.vals.length;
                else if(S.clicked[1]&&!S.picker&&mod.showSettings) st.enumExtended=!st.enumExtended;
              }
              const cY=rect.y+((rect.h-rect.y)-TH)/2;
              const val=st.vals[st.v]||'';
              text(rect.w-5-tw(val,18),cY,val,[170,170,170],a,true,false,18);
              text(rect.x+5,cY,st.n,[255,255,255],a,true,false,18);
            }
          }
          sIndex++;
        }
      }

      if(modRect.y>catRect.y+0.5){
        const c1=themed(moduleY*2);
        fillRR(modRect.x,modRect.y,CAT_W,T,radius,[40,40,40],a,CORNER_BOTTOM);

        mod.cScale=clamp(animate(mod.on?1:0,mod.cScale,dt*10),0,1);
        if(mod.cScale>0){
          const c2=themed(modRect.y+CAT_W);
          fillGradRR(modRect.x,modRect.y,CAT_W,T,radius,c1,c2,a*mod.cScale,CORNER_BOTTOM);
        }
        const nm2=modName(mod);
        const cRectCentreX=modRect.x+((CAT_W)-tw(nm2,18,false))/2;
        const cRectCentreY=modRect.y+((T)-TH)/2;
        const col=mod.on?[255,255,255]:[180,180,180];
        text(cRectCentreX,cRectCentreY,nm2,col,a,true,false,18);

        if(inside(gmx,gmy,modRect)&&cp.extended&&isOpen){
          if(inside(gmx,gmy,catWindow)) tooltip=mod.desc;
          if(S.isTouch){
            if(S.touchTap&&!S.picker){
              if(mod.name==='ClickGui'){ S.open=!S.open; }
              else setModuleOn(mod,!mod.on);
            } else if(S.touchLongPress&&!S.picker){
              mod.showSettings=!mod.showSettings;
            }
          } else if(S.clicked[0]&&!S.picker){
            if(mod.name==='ClickGui'){ S.open=!S.open; }
            else setModuleOn(mod,!mod.on);
          } else if(S.clicked[1]&&!S.picker){
            mod.showSettings=!mod.showSettings;
          } else if(S.clicked[2]&&!S.picker){
            if(S.isMobile) window.SolsticeMobile?.toggleShortcut?.(mod);
            else S.binding=mod;
          }
        }
      }
      if(modRect.y>catRect.y-T){
        gradFade(modRect.x,modRect.h,CAT_W,10*mod.cAnim*a,[0,0,0],[0,0,0],0.55*a,0);
      }
      moduleY+=T;
      modIndex++;
    }
    ctx.restore();

    if(inside(gmx,gmy,catRect)&&S.clicked[1]) cp.extended=!cp.extended;

    catRect.h+=1.5;
    fillRR(catRect.x,catRect.y,CAT_W,catRect.h-catRect.y+1.5,15,[24,24,24],a,CORNER_TOP);

    const lower=(namingStyle()===0||namingStyle()===1);
    const catName=lower?CATS[i].toLowerCase():CATS[i];
    const cRectCentreY=catRect.y+((catRect.h-catRect.y)-TH)/2;
    const cRectCentreX=catRect.x+((CAT_W)-tw(catName,20.7,true))/2;

    const ICONS={Combat:'c',Movement:'f',Visual:'d',Player:'e',Misc:'a'};
    text(catRect.x+10,cRectCentreY,ICONS[CATS[i]]||'B',[255,255,255],a,true,false,20.7,true);
    text(cRectCentreX,cRectCentreY,catName,[255,255,255],a,true,true,20.7);

    if(!cp.dragging&&inside(gmx,gmy,catRect)&&S.clicked[0]&&isOpen){
      cp.dragging=true; S.dragCat=i;
      S.dragGrab={x:catRect.x,y:catRect.y,sx:S.mx,sy:S.my};
    }
  }

  if(tooltip){
    S.tipAlpha=animate((S.down[0]||S.down[2])?0:1,S.tipAlpha,dt*10);
    const th2=tw(tooltip,14.4,false)*0+14.4;
    const textW=tw(tooltip,14.4,false);
    const pad=2.5, off=8;
    let tr={x:gmx+off-pad,y:gmy+th2/2-th2-pad,w:gmx+off+textW+pad*2,h:gmy+th2/2+pad};
    const ccx=(tr.x+tr.w)/2, ccy=(tr.y+tr.h)/2;
    tr={x:ccx-(ccx-tr.x)*S.tipAlpha,y:ccy-(ccy-tr.y)*S.tipAlpha,
        w:ccx+(tr.w-ccx)*S.tipAlpha,h:ccy+(tr.h-ccy)*S.tipAlpha};
    fillRR(tr.x,tr.y,tr.w-tr.x,tr.h-tr.y,0,[20,20,20],a*S.tipAlpha,0);
    text(tr.x+pad,tr.y+pad,tooltip,[255,255,255],a*S.tipAlpha,true,false,14.4*S.tipAlpha);
  } else {
    S.tipAlpha=1;
  }
  if(S.binding||S.bindBool){
    const tip="Currently binding "+(S.binding?modName(S.binding):S.bindBool.n)+"... Press ESC to unbind.";
    const textW=tw(tip,14.4,false);
    const pad=2.5, off=8;
    fillRR(gmx+off-pad,gmy+7.2-14.4-pad,textW+5,14.4+5,0,[20,20,20],a,0);
    text(gmx+off-pad+pad,gmy+7.2-14.4-pad+pad,tip,[255,255,255],a,true,false,14.4);
  }

  drawPicker(a,dt);
  ctx.restore();
}

function drawPicker(a,dt){
  const p=S.picker; if(!p) return;
  const ww=400, wh=400;
  const wx=CX-ww/2, wy=Math.min(CY,H-wh-10);
  const gmx=CX+(S.mx-CX)/Math.max(0.0001,(S.inScale*K)), gmy=CY+(S.my-CY)/Math.max(0.0001,(S.inScale*K));

  fillRR(wx,wy,ww,wh,2,[15,15,15],1,0);
  fillRR(wx,wy,ww,30,2,[28,28,28],1,1);
  setFont(14,false);
  ctx.fillStyle='rgba(255,255,255,0.92)';
  ctx.fillText('Color Picker',wx+10,wy+8);
  ctx.fillStyle='rgba(255,255,255,0.55)';
  ctx.fillText('×',wx+ww-20,wy+7);

  const sx=wx+10, sy=wy+40, sw=ww-20, sh=280;
  const base=hsv2rgb(p.st,1,1);
  ctx.fillStyle=rgb(base,1); ctx.fillRect(sx,sy,sw,sh);
  let g=ctx.createLinearGradient(sx,0,sx+sw,0);
  g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=g; ctx.fillRect(sx,sy,sw,sh);
  g=ctx.createLinearGradient(0,sy,0,sy+sh);
  g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(0,0,0,1)');
  ctx.fillStyle=g; ctx.fillRect(sx,sy,sw,sh);
  ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.arc(sx+p.s*sw,sy+(1-p.v)*sh,5,0,Math.PI*2); ctx.stroke();

  const hy=sy+sh+14, hh=16;
  for(let i=0;i<sw;i++){
    ctx.fillStyle=rgb(hsv2rgb(i/sw,1,1),1);
    ctx.fillRect(sx+i,hy,1,hh);
  }
  ctx.strokeStyle='rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.arc(sx+p.st*sw,hy+hh/2,5,0,Math.PI*2); ctx.stroke();

  const col=hsv2rgb(p.st,p.s,p.v);
  fillRR(wx+10,hy+hh+14,44,26,2,col,1,0);
  setFont(13,false);
  ctx.fillStyle='rgba(255,255,255,0.75)';
  const hex='#'+col.map(x=>Math.round(x).toString(16).padStart(2,'0')).join('').toUpperCase();
  ctx.fillText(hex,wx+64,hy+hh+18);

  const btn={x:wx+ww-84,y:hy+hh+14,w:wx+ww-10,h:hy+hh+40};
  const over=inside(gmx,gmy,btn);
  fillRR(btn.x,btn.y,btn.w-btn.x,btn.h-btn.y,3,[over?70:54,over?70:54,over?70:54],1,0);
  ctx.fillStyle='rgba(255,255,255,0.9)';
  ctx.fillText('Close',btn.x+18,btn.y+6);

  const inSV=inside(gmx,gmy,{x:sx,y:sy,w:sx+sw,h:sy+sh});
  const inHue=inside(gmx,gmy,{x:sx,y:hy,w:sx+sw,h:hy+hh});
  if(S.down[0]&&inSV){ p.s=clamp((gmx-sx)/sw,0,1); p.v=clamp(1-(gmy-sy)/sh,0,1); }
  if(S.down[0]&&inHue){ p.st=clamp((gmx-sx)/sw,0,1); }
  if(S.pickerDrag==='sv'&&S.down[0]){ p.s=clamp((gmx-sx)/sw,0,1); p.v=clamp(1-(gmy-sy)/sh,0,1); }
  if(S.pickerDrag==='hue'&&S.down[0]){ p.st=clamp((gmx-sx)/sw,0,1); }
  if(S.clicked[0]&&inSV) S.pickerDrag='sv';
  if(S.clicked[0]&&inHue) S.pickerDrag='hue';
  if(S.clicked[0]&&over){ S.picker=null; S.pickerDrag=null; }
  if(!p.justOpened&&S.clicked[0]&&!inside(gmx,gmy,{x:wx,y:wy,w:wx+ww,h:wy+wh})&&!inSV&&!inHue){
    S.picker=null; S.pickerDrag=null;
  }
  p.justOpened=false;
  const rgbv=hsv2rgb(p.st,p.s,p.v);
  p.target.v=[Math.round(rgbv[0]),Math.round(rgbv[1]),Math.round(rgbv[2]),255];
}

register({
  name:"ClickGui",
  desc:"A customizable GUI for toggling modules.",
  cat:"Visual",
  nm:{l:"clickgui",ls:"click gui",n:"ClickGui",ns:"Click Gui"},
  disp:"Style",
  settings:[
    {t:"e",n:"Style",d:"The style of the ClickGui.",v:0,vals:["Sol","Fatality"]},
    {t:"e",n:"Animation",d:"The animation of the ClickGui.",v:1,vals:["Zoom","Bounce"]},
    {t:"n",n:"Blur Strength",d:"The strength of the blur.",v:7.0,min:0.0,max:20.0,step:0.1},
    {t:"n",n:"Midclick Rounding",d:"The value to round to when middle-clicking a NumberSetting.",v:1.0,min:0.01,max:1.0,step:0.01}
  ],
  key:45,
  renderOrder:0,
  onRender:drawClickGui,
  onEnable(){}
});

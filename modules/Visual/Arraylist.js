function modVisible(m){return m.settings[0].v===1;}
function alSet(n){const c=getMod('Arraylist');return c.settings.find(s=>s.n===n);}
function modDisplayText(m){
  if(!m.disp) return '';
  const s=m.settings.find(x=>x.n===m.disp);
  let v='';
  if(s&&s.t==='e') v=s.vals[s.v]||'';
  if(namingStyle()<=1) v=v.toLowerCase();
  return v;
}

function drawArrayList(dt){
  const cfg=getMod('Arraylist');
  for(const m of MODS) m.animList=clamp(animate(m.on?1:0,m.animList,dt*12),0,1);
  if(!cfg.on) return;
  const dispS=alSet('Display'), visS=alSet('Visibility'), rmS=alSet('Render Mode'),
        glS=alSet('Glow'), gstS=alSet('Glow Strength');
  const mode=dispS?(dispS.vals[dispS.v]||'Split'):'Split';
  const bound=visS?visS.vals[visS.v]==='Bound':false;
  const renderMode=rmS?rmS.v===1:true;
  const glow=glS?glS.v===1:true;
  const glowStrength=(gstS?gstS.v:1)*100;
  const FS=25;
  ctx.save(); ctx.scale(K,K);
  const AW=W/K, gmx=S.mx/K, gmy=S.my/K;
  const layout=hudElement('Arraylist',Math.max(0,AW-220),5,210,120);
  const sc=hudApplyScale(layout);
  const lmx=layout.x+(gmx-layout.x)/sc, lmy=layout.y+(gmy-layout.y)/sc;
  const rightEdge=layout.x+layout.w;

  const list=MODS.filter(m=>modVisible(m)&&(!bound||m.key!==0));
  const prepared=list.map(m=>{
    const name=modName(m);
    const dTxt=renderMode?modDisplayText(m):'';
    const disp=dTxt?(' '+dTxt):'';
    return {m,name,disp,w:tw(name,FS,true)+(disp?tw(disp,FS,true):0)};
  }).sort((a,b)=>b.w-a.w);

  let y=layout.y, rows=[], maxRowW=0;
  for(const p of prepared){
    const m=p.m;
    if(m.animList<0.01) continue;
    const color=themed(y*2);
    const nameW=tw(p.name,FS,true), suffW=p.disp?tw(p.disp,FS,true):0;
    const totalW=nameW+suffW+16;
    if(totalW>maxRowW) maxRowW=totalW;
    let tx=rightEdge-10;
    if(mode==='Bar'||mode==='Split') tx-=7;
    tx=lerp(rightEdge+14,tx-nameW-suffW,m.animList);
    rows.push({m,name:p.name,suff:p.disp,color,tx,nameW,suffW,y,anim:m.animList,
      rect:{x:tx-3,y:y,w:tx+nameW+suffW+4,h:y+FS}});
    y+=FS*m.animList;
  }
  const totalH=Math.max(FS,y-layout.y);
  hudSetSize('Arraylist',Math.max(120,Math.ceil(maxRowW)),Math.ceil(totalH));

  const perfRow=window.SolsticePerf;

  for(const r of rows){
    const rect=r.rect;
    if(mode==='Outline') fillRR(rect.x,rect.y,rect.w-rect.x,rect.h-rect.y,0,[0,0,0],0.4*r.anim,0);

    /* 投影/发光都用预烘焙光晕精灵，彻底不再碰 ctx.shadowBlur */
    if(glow&&mode!=='Bar'){
      const blur=Math.min(22,Math.max(6,glowStrength*0.18));
      if(perfRow) perfRow.glow(r.tx-8,r.y-5,r.nameW+r.suffW+16,FS+10,r.color,blur,0.55*r.anim);
      else {
        ctx.save(); ctx.shadowColor=rgb(r.color,0.5*r.anim); ctx.shadowBlur=blur;
        ctx.fillStyle=rgb(r.color,r.anim); ctx.fillText(r.name,r.tx,r.y); ctx.restore();
      }
    }

    setFont(FS,true);
    ctx.fillStyle=rgb(r.color,r.anim);
    ctx.fillText(r.name,r.tx,r.y);
    if(r.suff){ ctx.fillStyle=rgb([229,229,229],r.anim); ctx.fillText(r.suff,r.tx+r.nameW,r.y); }

    if(mode==='Split'){
      const lx=rect.w+2, ly=r.y+4, lh=FS-6;
      if(glow&&perfRow) perfRow.glow(lx-4,ly-3,4+lh*0.4,lh+6,r.color,10,0.6*r.anim);
      fillRR(lx,ly,4,lh,3,r.color,r.anim,0);
    } else if(mode==='Bar'){
      ctx.save(); ctx.fillStyle=rgb(r.color,r.anim);
      ctx.fillRect(rect.w-2,r.y,4,FS); ctx.restore();
    }

    if(lmx>=rect.x&&lmx<=rect.w&&lmy>=r.y&&lmy<r.y+FS){
      fillRR(rect.x,rect.y,rect.w-rect.x,FS,0,[255,255,255],0.1,0);
      if(S.clicked[0]&&!S.picker&&!r.m.__clicked){ setModuleOn(r.m,!r.m.on); r.m.__clicked=true; }
    }
  }

  if(mode==='Outline'&&rows.length){
    ctx.lineWidth=2;
    for(let i=0;i<rows.length;i++){
      const r=rows[i], R=r.rect.w+2, L=r.rect.x, T2=r.y, B=r.rect.h;
      ctx.strokeStyle=rgb(r.color,r.anim);
      ctx.beginPath();
      ctx.moveTo(R,T2); ctx.lineTo(R,B);
      const nx=rows[i+1];
      if(!nx||nx.rect.x>=L) { ctx.moveTo(L,T2); ctx.lineTo(L,B); }
      if(i===0){ ctx.moveTo(L,T2); ctx.lineTo(R,T2); }
      if(!nx){ ctx.moveTo(L,B); ctx.lineTo(R,B); }
      else if(nx.rect.x-L>2){ ctx.moveTo(L,B); ctx.lineTo(nx.rect.x-1,B); }
      ctx.stroke();
    }
  }
  ctx.restore();
}

register({
  name:"Arraylist",
  desc:"Displays a list of modules",
  cat:"Visual",
  nm:{l:"arraylist",ls:"array list",n:"Arraylist",ns:"Array List"},
  disp:"Display",
  settings:[
    {t:"n",n:"Blur Strength",d:"The strength of the blur.",v:0.0,min:0.0,max:10.0,step:0.1},
    {t:"e",n:"Display",d:"Outline style",v:2,vals:["Outline","Bar","Split","None"]},
    {t:"e",n:"Visibility",d:"Module visibility",v:0,vals:["All","Bound"]},
    {t:"b",n:"Render Mode",d:"Renders the module mode next to the module name",v:1},
    {t:"b",n:"Glow",d:"Enables glow",v:1},
    {t:"n",n:"Glow Strength",d:"The strength of the glow",v:1.0,min:0.5,max:1.0,step:0.1}
  ],
  renderOrder:1,
  onRender:drawArrayList,
  defaultOn:true,
  onEnable(){}
});

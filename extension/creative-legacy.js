(() => {
  'use strict';

  if (window.__solsticeCreativeLegacy) {
    return;
  }

  const CLASS_SOURCE = "class CreativeScreen extends ContainerScreen{constructor(t){super(t,\"tab_items\",195,136,null),this.tab=0,this.scroll=0,this.search=\"\",this.items=[],this.trash=null;const e=t.player.inv;for(let t=0;t<9;t++)this.slots.push({x:9+18*t,y:112,get:()=>e.slots[t],set:s=>{e.slots[t]=s},group:\"hotbar\"});for(let t=0;t<5;t++)for(let e=0;e<9;e++){const s=9*t+e;this.slots.push({x:9+18*e,y:18+18*t,creative:!0,get:()=>{const t=this.items[9*this.scroll+s];return null==t?null:\"object\"==typeof t?{...t,count:1}:{id:t,count:1}},set:()=>{}})}this.trashSlot={x:173,y:112,trash:!0,get:()=>null,set:()=>{}},this.slots.push(this.trashSlot),this.itemSlots=this.slots;const s=[\"slot_helmet\",\"slot_chestplate\",\"slot_leggings\",\"slot_boots\"];this.invSlots=[...[0,1,2,3].map(t=>({x:54+54*Math.floor(t/2),y:6+t%2*27,armorSlot:t,emptyIcon:s[t],max:1,group:\"armor\",get:()=>e.slots[36+t],set:s=>{e.slots[36+t]=s},accept:e=>!!ITEMS[e.id]&&ITEMS[e.id].armor&&ITEMS[e.id].armor.slot===t})),{x:35,y:20,emptyIcon:\"slot_shield\",group:\"offhand\",get:()=>e.slots[40],set:t=>{e.slots[40]=t}},...Array.from({length:27},(t,s)=>({x:9+s%9*18,y:54+18*Math.floor(s/9),group:\"main\",get:()=>e.slots[9+s],set:t=>{e.slots[9+s]=t}})),...this.itemSlots.filter(t=>\"hotbar\"===t.group),this.trashSlot],this.setTab(0)}tabs(){return[...CREATIVE_TABS.slice(0,10),{name:\"搜索物品\",icon:\"compass_search\",search:!0},{name:\"生存模式物品栏\",inv:!0},...CREATIVE_TABS.slice(10)]}setTab(t){this.tab=t,this.scroll=0;const e=this.tabs();if(this.slots=e[t].inv?this.invSlots:this.itemSlots,e[t].inv)return this.bg=\"tab_inventory\",this.items=[],void this.game.ui.hideInput();if(e[t].search){this.bg=\"tab_item_search\";const t=this.search.trim().toLowerCase(),e=ITEMS.filter(t=>t&&!(BLOCKS[t.id]&&BLOCKS[t.id].noItem)).map(t=>t.id),s=t?CREATIVE_TABS.flatMap(t=>t.items.filter(t=>\"object\"==typeof t).map(t=>{const{key:e,...s}=t;return{id:item(e),count:1,dmg:0,...s}})):[],text=t=>{const e=ITEMS[t.id]||ITEMS[t];return((\"function\"==typeof netItemLines&&\"object\"==typeof t?netItemLines(t,[{text:e.cn,color:\"#FFFFFF\"}]):[{text:e.cn}]).map(t=>t.text).join(\" \")+\" \"+e.key+\" \"+(t.e?t.e.map(t=>t[0]).join(\" \"):\"\")+\" \"+(t.pot||\"\")).toLowerCase()};this.items=[...e,...s].filter(e=>!t||text(e).includes(t));const i=this.game.ui;void 0!==this.x&&i.showInput(this.x+82,this.y+6,89,10,this.search,()=>{},{onInput:t=>{this.search=t,this.setTab(this.tab)},onEsc:()=>i.close(),max:30})}else this.bg=\"tab_items\",this.items=e[t].items.map(t=>{if(\"object\"!=typeof t)return item(t);const{key:e,...s}=t;return{id:item(e),...s}}),this.game.ui.hideInput()}layout(){super.layout(),this.tabs()[this.tab].search&&this.setTab(this.tab)}maxScroll(){return Math.max(0,Math.ceil(this.items.length/9)-5)}wheel(t,e){this.scroll=clamp(this.scroll+Math.sign(e),0,this.maxScroll())}tabLayout(){const t=this.tabs();if(this._tl&&this._tl.n===t.length)return this._tl;const e=[],s=[];let i=1,o=0;for(let n=12;n<t.length;n++)(t[n].newPage&&o>0||10===o)&&(i++,o=0),e[n]=i,s[n]=o++;return this._tl={n:t.length,page:e,slot:s,pages:t.length>12?i+1:1}}pages(){return this.tabLayout().pages}tabPage(t){return 10===t||11===t?-1:t<10?0:this.tabLayout().page[t]}tabShown(t){const e=this.tabPage(t);return e<0||e===(this.page||0)}tabSlot(t){return t<10?t:this.tabLayout().slot[t]}tabCol(t){return 10===t||11===t?6:this.tabSlot(t)%5}tabTop(t){return 10===t||11!==t&&this.tabSlot(t)<5}tabRect(t){const e=this.tabCol(t);return{x:this.x+(6===e?167:27*e),y:this.tabTop(t)?this.y-28:this.y+132,w:26,h:30}}tabSprite(t,e){return\"tab_\"+(this.tabTop(t)?\"top\":\"bottom\")+(e?\"_selected_\":\"_unselected_\")+(this.tabCol(t)+1)}pageBtn(t){return{x:this.x+(t<0?136:152),y:this.y-24,w:15,h:18}}setPage(t){const e=this.pages();if((t=clamp(t,0,e-1))===(this.page||0))return;this.page=t;const s=this.tabs();if(!s[this.tab].search&&!s[this.tab].inv){const e=s.findIndex((e,s)=>this.tabPage(s)===t);e>=0&&this.setTab(e)}}draw(t){t.dim(.6);const e=t.ctx,s=this.tabs(),i=this.tabShown(this.tab);for(let e=0;e<s.length;e++)if(e!==this.tab&&this.tabShown(e)){const s=this.tabRect(e);t.sprite(this.tabSprite(e,!1),s.x,s.y)}if(e.drawImage(t.img[this.bg],0,0,195,136,this.x,this.y,195,136),i){const e=this.tabRect(this.tab);t.sprite(this.tabSprite(this.tab,!0),e.x,e.y)}for(let e=0;e<s.length;e++){if(!this.tabShown(e))continue;const i=this.tabRect(e),o=s[e],n=!o.search&&!o.inv&&o.iconStack||{id:o.search?item(\"book\"):o.inv?item(\"chest\"):item(o.icon),count:1};t.drawItem(n,i.x+5,i.y+(this.tabTop(e)?9:7))}if(this.pages()>1){const s=this.page||0;for(const i of[-1,1]){const o=this.pageBtn(i),n=i<0?s>0:s<this.pages()-1,r=n&&t.hit(o);t.nine(n?r?\"button_hl\":\"button\":\"button_dis\",o.x,o.y,o.w,o.h,3),Font.center(e,i<0?\"<\":\">\",o.x+o.w/2+1,o.y+5,n?\"#FFFFFF\":\"#A0A0A0\")}Font.center(e,s+1+\" / \"+this.pages(),this.x+151,this.y-37,\"#FFFFFF\")}s[this.tab].inv||Font.draw(e,s[this.tab].name,this.x+8,this.y+6,\"#404040\",!1);const o=this.maxScroll(),n=this.y+18+(o?Math.round(this.scroll/o*79):0);if(s[this.tab].inv){const s=this.game.renderer.playerPreview(this.game,t,this.x+73,this.y+6,32,43);s&&(e.imageSmoothingEnabled=!0,e.drawImage(s,this.x+73,this.y+6,32,43),e.imageSmoothingEnabled=!1)}else t.sprite(o?\"scroller\":\"scroller_disabled\",this.x+175,n);t.ctx.fillStyle=\"#8b8b8b\",t.ctx.fillRect(this.x+173,this.y+112,16,16),Font.center(e,\"X\",this.x+181,this.y+116,\"#FF5555\"),this.drawSlots(t);for(let e=0;e<s.length;e++)this.tabShown(e)&&t.hit(this.tabRect(e))&&t.tooltip([{text:s[e].name}],t.mouse.x,t.mouse.y);if(this.pages()>1)for(const e of[-1,1]){const s=(this.page||0)+e;s>=0&&s<this.pages()&&t.hit(this.pageBtn(e))&&t.tooltip([{text:e<0?\"上一页\":\"下一页\"},{text:0===s?\"基础物品\":\"模组物品\",color:\"#AAAAAA\"}],t.mouse.x,t.mouse.y)}}drawSlots(t){const e=this.slotAt(t.mouse.x,t.mouse.y);for(const s of this.slots)s.trash||(!s.get()&&s.emptyIcon&&(t.ctx.globalAlpha=.6,t.sprite(s.emptyIcon,this.x+s.x,this.y+s.y),t.ctx.globalAlpha=1),t.drawItem(s.get(),this.x+s.x,this.y+s.y),s===e&&(t.ctx.fillStyle=\"rgba(255,255,255,0.5)\",t.ctx.fillRect(this.x+s.x,this.y+s.y,16,16)));e&&e.get()&&!t.cursor&&t.tooltip(t.tipLines(e.get()),t.mouse.x,t.mouse.y)}mouseDown(t,e,s,i,o){const n=this.tabs();if(this.pages()>1)for(const i of[-1,1])if(t.hit(this.pageBtn(i),e,s)){const t=this.page||0;return this.setPage(t+i),void((this.page||0)!==t&&Sound.click())}for(let i=0;i<n.length;i++)if(this.tabShown(i)&&t.hit(this.tabRect(i),e,s))return this.setTab(i),void Sound.click();if(!n[this.tab].inv&&e>=this.x+175&&e<this.x+187&&s>=this.y+18&&s<this.y+130)return this.scrolling=!0,void this.mouseMove(t,e,s);const r=this.slotAt(e,s);if(r&&r.trash)t.cursor?t.cursor=null:o&&this.game.player.inv.slots.fill(null,0,36);else{if(r&&r.creative){const e=r.get();if(t.cursor)return void(t.cursor=null);if(!e)return;if(o){const t=this.game.player.inv,s=t.slots.findIndex((t,e)=>e<9&&!t);return void(t.slots[s>=0?s:t.sel]={...e,count:maxStack(e.id),dmg:0})}return void(t.cursor={...e,count:2===i?1:maxStack(e.id),dmg:0})}r&&1===i&&r.get()?t.cursor={...r.get(),count:maxStack(r.get().id)}:super.mouseDown(t,e,s,i,o)}}mouseMove(t,e,s){if(this.scrolling&&t.mouse.down){const t=this.maxScroll();return void(this.scroll=clamp(Math.round((s-this.y-25)/79*t),0,t))}super.mouseMove(t,e,s)}mouseUp(t,e,s,i){this.scrolling=!1,super.mouseUp(t,e,s,i)}quickMove(t){if(this.tabs()[this.tab].inv)return super.quickMove(t);\"hotbar\"===t.group&&t.set(null)}outside(t,e){return super.outside(t,e)&&e>this.y-28&&e<this.y+164}key(t,e){return!(!this.tabs()[this.tab].search||document.activeElement!==t.input)||super.key(t,e)}}";
  const TABS_SOURCE = "const CREATIVE_TABS=[[\"building_blocks\",\"建筑方块\",\"bricks\"],[\"colored_blocks\",\"染色方块\",\"cyan_wool\"],[\"natural_blocks\",\"自然方块\",\"grass_block\"],[\"functional_blocks\",\"功能方块\",\"oak_sign\"],[\"redstone_blocks\",\"红石方块\",\"redstone\"],[\"tools_and_utilities\",\"工具与实用物品\",\"diamond_pickaxe\"],[\"combat\",\"战斗用品\",\"netherite_sword\"],[\"food_and_drinks\",\"食物与饮品\",\"golden_apple\"],[\"ingredients\",\"原材料\",\"iron_ingot\"],[\"spawn_eggs\",\"刷怪蛋\",\"pig_spawn_egg\"]].map(([e,o,s])=>({id:e,name:o,icon:s,get items(){return creativeTabItems(e)}}));function creativeTabItems(e){const o=creativeTabItems.cache||(creativeTabItems.cache={});return o[e]||(o[e]=(self.ITEM_DATA||[]).filter(o=>o.tab===e&&void 0!==ITEM_KEY[o.key]).flatMap(e=>/^(potion|splash_potion|lingering_potion|tipped_arrow)$/.test(e.key)&&\"undefined\"!=typeof POTIONS?Object.keys(POTIONS).filter(o=>\"tipped_arrow\"!==e.key||POTIONS[o].length).map(o=>({key:e.key,pot:o})):[e.key])),o[e]}";
  let installingClass = false;

  function installTabs() {
    if (Array.isArray(window.CREATIVE_TABS)) {
      return true;
    }

    try {
      window.eval(`(() => {
        ${TABS_SOURCE}
        window.CREATIVE_TABS = CREATIVE_TABS;
        window.creativeTabItems = creativeTabItems;
      })();`);

      return Array.isArray(window.CREATIVE_TABS);
    } catch {
      return false;
    }
  }

  function installClass() {
    if (window.__solsticeCreativeLegacy || installingClass) {
      return;
    }

    try {
      if (window.eval('typeof ContainerScreen') !== 'function') {
        return;
      }

      if (window.eval('typeof ITEM_DATA') === 'undefined') {
        return;
      }

      if (!installTabs()) {
        return;
      }

      if (typeof window.CreativeScreen === 'function') {
        window.__solsticeCreativeLegacy = true;
        return;
      }

      installingClass = true;

      window.eval(`(() => {
        if (typeof ITEM_KEY !== 'undefined') window.ITEM_KEY = ITEM_KEY;
        if (typeof ITEMS !== 'undefined') window.ITEMS = ITEMS;
        if (typeof UI !== 'undefined') window.UI = UI;
        if (typeof ITEM_DATA !== 'undefined') window.ITEM_DATA = ITEM_DATA;
        if (typeof defItem === 'function') window.defItem = defItem;
        if (typeof maxStack === 'function') window.maxStack = maxStack;
        if (typeof BLOCKS !== 'undefined') window.BLOCKS = BLOCKS;

        window.CreativeScreen = (${CLASS_SOURCE});
      })();`);

      if (typeof window.CreativeScreen === 'function') {
        window.__solsticeCreativeLegacy = true;
      }
    } catch {

    } finally {
      installingClass = false;
    }
  }

  installTabs();
  installClass();
  setInterval(installClass, 100);
})();

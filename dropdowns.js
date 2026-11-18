/* Visual enhancement: the original select remains the source of truth for forms and app.js. */
(()=>{
  const enhanced=new WeakSet();const menus=new WeakMap();let opened=null;
  function close(w){if(!w)return;w.classList.remove('is-open');const m=menus.get(w);if(m){m.hidden=true;m.style.visibility='hidden';}w.querySelector('.styled-select-trigger').setAttribute('aria-expanded','false');if(opened===w)opened=null;}
  function enhance(select){
    if(enhanced.has(select)||select.closest('.styled-select')||select.multiple||select.size>1)return;
    enhanced.add(select);
    const wrapper=document.createElement('span');wrapper.className='styled-select';
    select.parentNode.insertBefore(wrapper,select);wrapper.append(select);select.classList.add('native-select');
    const trigger=document.createElement('button');trigger.type='button';trigger.className='styled-select-trigger';trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
    const title=document.createElement('span');title.className='styled-select-current';const chevron=document.createElement('span');chevron.className='styled-select-chevron';chevron.setAttribute('aria-hidden','true');trigger.append(title,chevron);
    const menu=document.createElement('div');menu.className='styled-select-menu';menu.setAttribute('role','listbox');menu.hidden=true;
    wrapper.append(trigger);document.body.append(menu);menus.set(wrapper,menu);
    if(select.id==='registryFaction'){wrapper.classList.add('registry-faction-select');for(const opt of select.options){if(opt.value==='commandant')opt.textContent='ВК';}}
    function positionMenu(){if(opened!==wrapper)return;const r=trigger.getBoundingClientRect();const spaceBelow=window.innerHeight-r.bottom;const above=spaceBelow<190&&r.top>spaceBelow;const available=Math.max(100,above?r.top-12:window.innerHeight-r.bottom-12);menu.style.position='fixed';menu.style.left=Math.max(8,r.left)+'px';menu.style.width=Math.min(Math.max(r.width,select.id==='registryFaction'?220:0),window.innerWidth-16)+'px';menu.style.right='auto';menu.style.maxHeight=Math.min(250,available)+'px';menu.style.top=above?'auto':Math.min(window.innerHeight-20,r.bottom+6)+'px';menu.style.bottom=above?(window.innerHeight-r.top+6)+'px':'auto';menu.style.zIndex='99999';menu.style.visibility='visible';}

    function sync(){title.textContent=select.selectedOptions[0]?.textContent||'Выберите значение';trigger.disabled=select.disabled;for(const btn of menu.children)btn.setAttribute('aria-selected',String(btn.dataset.value===select.value));}
    function rebuild(){menu.replaceChildren();for(const option of select.options){const btn=document.createElement('button');btn.type='button';btn.className='styled-select-option';btn.setAttribute('role','option');btn.textContent=option.textContent;btn.dataset.value=option.value;btn.disabled=option.disabled;btn.addEventListener('pointerdown',e=>{e.preventDefault();});btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();select.value=option.value;close(wrapper);select.dispatchEvent(new Event('change',{bubbles:true}));sync();});menu.append(btn);}sync();}
    trigger.addEventListener('click',()=>{if(select.disabled)return;const wasOpen=opened===wrapper;close(opened);if(!wasOpen){rebuild();menu.hidden=false;wrapper.classList.add('is-open');trigger.setAttribute('aria-expanded','true');opened=wrapper;positionMenu();}});
    trigger.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(opened!==wrapper)trigger.click();const options=[...menu.querySelectorAll('button:not(:disabled)')];const current=options.findIndex(x=>x.dataset.value===select.value);options[Math.max(0,current)]?.focus();}if(e.key==='Escape')close(wrapper);});
    menu.addEventListener('keydown',e=>{if(e.key==='Escape'){close(wrapper);trigger.focus();}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const options=[...menu.querySelectorAll('button:not(:disabled)')];const i=options.indexOf(document.activeElement);options[(i+(e.key==='ArrowDown'?1:-1)+options.length)%options.length]?.focus();}});
    select.addEventListener('change',sync);
    new MutationObserver(rebuild).observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','selected']});
    rebuild();
  }
  function openedMenuContains(target){return !!(opened&&menus.get(opened)?.contains(target)) || !!document.querySelector('.styled-select-menu:not([hidden])')?.contains(target);}
  window.addEventListener('resize',()=>{if(opened)close(opened);});
  window.addEventListener('scroll',()=>{if(opened)positionOpenedMenu();},true);
  function positionOpenedMenu(){if(!opened)return;const trigger=opened.querySelector('.styled-select-trigger');const menu=menus.get(opened);if(!trigger||!menu)return;const r=trigger.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight){close(opened);return;}const below=innerHeight-r.bottom;const up=below<190&&r.top>below;menu.style.left=Math.max(8,r.left)+'px';menu.style.width=Math.min(Math.max(r.width,220),innerWidth-16)+'px';menu.style.top=up?'auto':r.bottom+6+'px';menu.style.bottom=up?(innerHeight-r.top+6)+'px':'auto';}
  document.addEventListener('click',e=>{if(opened&&!opened.contains(e.target)&&!openedMenuContains(e.target))close(opened);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&opened){const w=opened;close(w);w.querySelector('.styled-select-trigger').focus();}});
  function scan(){document.querySelectorAll('select').forEach(enhance);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan);else scan();
  new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
})();

/* A4 pagination shared by ВС РО, ВК, ГК РО and ФСВНГ. */
(()=>{
 const source=()=>document.getElementById('paper');
 const bodyId=()=>window.currentFaction==='gk'?'gkOutBody':'outBody';
 const isGK=()=>window.currentFaction==='gk';
 const pageHeight=1123;
 let scheduled=0, pages=[], urls=[];
 const measureHost=document.createElement('div');measureHost.id='paginationMeasure';
 // Layout measurements and PNG rendering use real A4-sized DOM nodes.
 // Keep them outside the visible page, never below the login or registry.
 Object.assign(measureHost.style,{
  position:'absolute',left:'-100000px',top:'0',width:'794px',
  pointerEvents:'none',zIndex:'-1'
 });
 document.addEventListener('DOMContentLoaded',()=>document.body.appendChild(measureHost));
 function clonePage(){
  const node=source().cloneNode(true);node.removeAttribute('id');
  node.classList.add('a4-page');
  node.style.cssText='height:1123px!important;min-height:1123px!important;max-height:1123px!important;overflow:hidden!important;';
  return node;
 }
 function footerElements(page){return isGK()?[page.querySelector('.gk-sign-row')]:[...page.querySelectorAll('.signature-section,.seal-container')];}
 function bodyElement(page){return page.querySelector(isGK()?'.gk-body':'.bodytext');}
 function fit(page){
  // Only measure real document content. Measuring the A4 element itself
  // always returns 1123px and incorrectly makes every page appear full.
  const pageRect=page.getBoundingClientRect();
  const bottomLimit=pageRect.top+1123-70; // reserve bottom A4 margin
  let bottom=pageRect.top;
  const active=isGK()?page.querySelector('.gk-document'):page;
  if(!active)return true;
  const nodes=[...active.querySelectorAll('*')];
  for(const el of nodes){
   const style=getComputedStyle(el);
   if(style.display==='none'||style.visibility==='hidden'||!el.getClientRects().length)continue;
   // Text and image leaves, plus layout elements with no element children.
   // Do not count an A4-sized wrapper as overflowing content.
   if(el===page||el.classList.contains('a4-page'))continue;
   const rect=el.getBoundingClientRect();
   if(rect.height && rect.width)bottom=Math.max(bottom,rect.bottom);
  }
  return bottom <= bottomLimit+0.5;
 }
 function build(){
  if(!source()||!document.body.contains(measureHost))return;
  measureHost.replaceChildren();
  const original=source(); const text=(original.querySelector('#'+bodyId())?.textContent||'');
  const tokens=text.match(/\S+\s*|\s+/g)||[''];
  const make=(first)=>{
   const p=clonePage(),b=bodyElement(p);
   b.textContent='';b.style.minHeight='0';
   if(!first){
    if(isGK())p.querySelector('.gk-top')?.remove();
    else p.querySelectorAll('.doc-heading,.meta,.document-subtitle').forEach(n=>n.remove());
   }
   footerElements(p).forEach(n=>n?.remove());
   measureHost.appendChild(p);return {p,b};
  };
  const built=[];let current=make(true);built.push(current.p);
  let pos=0;
  while(pos<tokens.length){
   let lo=1,hi=tokens.length-pos,best=0;
   while(lo<=hi){const mid=(lo+hi)>>1;current.b.textContent=tokens.slice(pos,pos+mid).join('');
    if(fit(current.p)){best=mid;lo=mid+1;}else hi=mid-1;
   }
   if(!best){
    if(current.b.textContent==='' && built.length>1){ // a single exceptionally long token: split into characters
      const word=tokens[pos],chars=[...word];let left=0,right=chars.length,keep=0;
      while(left<=right){const m=(left+right)>>1;current.b.textContent=chars.slice(0,m).join('');if(fit(current.p)){keep=m;left=m+1;}else right=m-1;}
      if(!keep)break;
      tokens[pos]=chars.slice(keep).join('');if(!tokens[pos])pos++;
    }else if(built.length===1 && current.b.textContent===''){
      // Very large heading: keep the first token and continue.
      current.b.textContent=tokens[pos++];
    }
    if(built.length>100)break;
    current=make(false);built.push(current.p);continue;
   }
   current.b.textContent=tokens.slice(pos,pos+best).join('');pos+=best;
   if(pos<tokens.length){current=make(false);built.push(current.p);}
  }
  // Footer is kept together and flows to a new A4 sheet when necessary.
  const footer=footerElements(original).map(n=>n?.cloneNode(true)).filter(Boolean);
  for(const node of footer)current.p.appendChild(node);
  if(!fit(current.p)){
   footer.forEach(n=>n.remove());current=make(false);built.push(current.p);
   footer.forEach(n=>current.p.appendChild(n));
  }
  // Show page previews, preserving original live DOM for editing and draft logic.
  pages=built.map(p=>p.cloneNode(true));
  const host=document.getElementById('a4Pages');
  if(host){host.replaceChildren();pages.forEach((p,i)=>{
   const wrapper=document.createElement('div');wrapper.className='a4-preview-item';
   const label=document.createElement('div');label.className='a4-page-label';label.textContent=`Страница ${i+1} из ${pages.length}`;
   const scale=document.createElement('div');scale.className='a4-preview-scale';scale.appendChild(p);
   wrapper.append(label,scale);host.appendChild(wrapper);
  });scalePreviews();}
 }
 function scalePreviews(){const host=document.getElementById('a4Pages');if(!host)return;
  const width=host.clientWidth||794,scale=Math.min(1,width/794);
  host.querySelectorAll('.a4-preview-scale').forEach(n=>{n.style.height=`${Math.ceil(1123*scale)}px`;n.firstElementChild.style.transform=`scale(${scale})`;});
 }
 function refresh(){clearTimeout(scheduled);scheduled=setTimeout(build,120);}
 async function render(){
  clearTimeout(scheduled);
  await document.fonts.ready;
  build();
  const blobs=[];
  for(let i=0;i<pages.length;i++){
   const node=pages[i].cloneNode(true);
   measureHost.appendChild(node);
   try{
    // A missing signature is normal. Remove empty image elements entirely.
    for(const img of [...node.querySelectorAll('img')]){
     const src=(img.getAttribute('src')||'').trim();
     if(!src){img.remove();continue;}
     if(!img.complete){
      await new Promise((resolve,reject)=>{
       const timeout=setTimeout(()=>reject(new Error('Изображение не загрузилось: '+src)),10000);
       img.addEventListener('load',()=>{clearTimeout(timeout);resolve();},{once:true});
       img.addEventListener('error',()=>{clearTimeout(timeout);reject(new Error('Изображение недоступно: '+src));},{once:true});
      });
     }
     if(!img.naturalWidth)throw new Error('Изображение недоступно: '+src);
    }
    let blob=null, primaryError=null;
    if(window.htmlToImage){
     try{
      blob=await window.htmlToImage.toBlob(node,{
       pixelRatio:1,backgroundColor:'#ffffff',cacheBust:false,
       // Fonts are system fonts; avoiding external font discovery prevents
       // html-to-image from treating a stylesheet fetch as an image error.
       skipFonts:true,
       filter:el=>!(el instanceof HTMLImageElement)||!!el.getAttribute('src')
      });
     }catch(e){primaryError=e;console.warn('html-to-image failed; trying canvas renderer',e);}
    }
    if(!blob && window.html2canvas){
     const canvas=await window.html2canvas(node,{
      backgroundColor:'#ffffff',scale:1,useCORS:true,allowTaint:false,
      logging:false,width:794,height:1123,windowWidth:1200,
      onclone:doc=>{doc.querySelectorAll('img:not([src])').forEach(el=>el.remove());}
     });
     blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    }
    if(!blob){
     const detail=primaryError instanceof Error?primaryError.message:String(primaryError||'неизвестная ошибка');
     throw new Error('Не удалось сформировать PNG. '+detail);
    }
    blobs.push(blob);
   }catch(e){
    throw new Error('Страница '+(i+1)+': '+(e?.message||String(e)));
   }finally{node.remove();}
  }
  return blobs;
 }

 function init(){
  const original=document.getElementById('paperMobileScaler');if(!original)return;
  const host=document.createElement('div');host.id='a4Pages';original.after(host);original.style.display='none';
  const observe=new MutationObserver(refresh);observe.observe(source(),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','src','style']});
  window.addEventListener('resize',scalePreviews);refresh();
 }
 document.addEventListener('DOMContentLoaded',init);
 window.A4Pages={render,refresh,count:()=>pages.length};
})();

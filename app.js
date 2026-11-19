(() => {
'use strict';
const $ = id => document.getElementById(id);
const cfg = window.APP_CONFIG || {};
const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(cfg.supabaseUrl || '') && !String(cfg.supabaseAnonKey).startsWith('PASTE_');
const client = configured && window.supabase ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
let session = null, profile = null, registryFaction = 'army', orders = [], profiles = [];
let activeDraftId = null, drafts = [];
const staticEmail = id => `static-${id}@army-docymenti.netlify.app`;
const validStatic = id => /^[0-9]{1,30}$/.test(id);
const labelFaction = f => ({army:'ВС РО',commandant:'Военный комиссариат',gk:'Гарнизонная комендатура',fsvng:'Федеральная служба войск национальной гвардии'})[f] || f;
// UI-only access control. Supabase RLS/RPC remains the security boundary.
const allowedFactions = () => {
  if (!session || !profile) return [];
  if (profile.role === 'admin') return ['army', 'commandant', 'gk', 'fsvng'];
  return [...[profile.faction, profile.additional_faction].filter(f => ['army','commandant'].includes(f)), ...(profile.gk_access ? ['gk'] : []), ...(profile.fsvng_access || profile.faction==='fsvng' ? ['fsvng'] : [])];
};
window.canUseFaction = faction => allowedFactions().includes(faction);
function updateFactionUI(){
  const allowed = allowedFactions();
  const switcher = document.querySelector('.faction-switch');
  if (switcher) switcher.style.display = allowed.length ? 'flex' : 'none';
  document.querySelectorAll('.faction-btn').forEach(button => {
    const visible = allowed.includes(button.dataset.faction);
    button.classList.toggle('hidden', !visible);
    button.hidden = !visible;
    button.disabled = !visible;
  });
  if (allowed.length && !allowed.includes(window.currentFaction)) window.setFaction(allowed[0]);
}

const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const showMsg = (msg, id='appMessage') => { notify(msg); };
const errorText = err => err?.message || err?.error_description || err?.details || (typeof err === 'string' ? err : JSON.stringify(err)) || 'Неизвестная ошибка';
function showPage(page) {
  if (!session && ['editor','drafts','admin'].includes(page)) page = 'registry';
  for (const id of ['editor','registry','drafts','account','admin']) $(id === 'editor' ? 'editorPage' : id+'Page').classList.toggle('hidden',id!==page);
  document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('active',b.dataset.page===page));
  if (page==='registry') loadOrders();
  if (page==='drafts') loadDrafts();
  if (page==='account') { renderAccount(); if(session) loadAccountStats(); else showAuthView('login'); }
  if (page==='admin') loadAdmin();
}
function updateAuthUI(){
  $('loginBtn').textContent = session ? `Кабинет: ${[profile?.first_name,profile?.last_name].filter(Boolean).join(' ') || profile?.username || 'Пользователь'}${profile?.character_static ? ' · '+profile.character_static : ''}` : 'Войти';
  $('logoutBtn').classList.toggle('hidden',!session);
  $('adminNav').classList.toggle('hidden',profile?.role!=='admin');
  $('publishBtn').disabled = !session || !client;
  $('nextPublishBtn').disabled = !session || !client;
  $('saveDraftBtn').disabled = !session || !client;
  $('draftsNav').classList.toggle('hidden',!session);
  $('editorNav').classList.toggle('hidden',!session);
  if (!session && !$('editorPage').classList.contains('hidden')) showPage('registry');
  $('publishHint').textContent = !client ? 'Сначала настройте подключение к Supabase.' : !session ? 'Для публикации войдите в аккаунт.' : profile?.role==='admin' ? 'Администратор может публиковать во всех подразделениях.' : `Доступные подразделения: ${allowedFactions().map(labelFaction).join(', ')}.`;
  updateFactionUI();
}
async function refreshUser(){
  if (!client) return updateAuthUI();
  const previousUser=session?.user?.id;
  const {data:{session:s}} = await client.auth.getSession(); session=s;
  if (previousUser !== session?.user?.id) setActiveDraft(null);
  profile=null;
  if (session){ const {data,error}=await client.from('profiles').select('*').eq('id',session.user.id).single(); if(error) showMsg(errorText(error)); else profile=data; }
  updateAuthUI();
}
function showAuthView(view){
  $('loginForm').classList.toggle('hidden',view!=='login');
  $('registerForm').classList.toggle('hidden',view!=='register');
  $('recoveryForm').classList.toggle('hidden',view!=='recovery');
  $('authMessage').textContent='';
}
async function login(){
  if(!client) return showMsg('Не настроен Supabase. Заполните config.js.','authMessage');
  const staticId=$('authStaticLogin').value.trim(), password=$('authPassword').value;
  if(!validStatic(staticId) || !password) return showMsg('Введите числовой статик и пароль.','authMessage');
  const email=staticEmail(staticId);
  const {error}=await client.auth.signInWithPassword({email,password});
  if(error) return showMsg(errorText(error),'authMessage');
  await refreshUser(); showMsg('Вход выполнен.'); renderAccount(); showPage('editor');
}
async function register(){
  if(!client) return showMsg('Не настроен Supabase.','authMessage');
  const faction=$('authFaction').value, password=$('registerPassword').value;
  const first_name=$('authFirstName').value.trim(),last_name=$('authLastName').value.trim(),character_static=$('authStatic').value.trim(),department=$('authDepartment').value.trim();
  if(password!==$('registerPasswordConfirm').value) return showMsg('Пароли не совпадают.','authMessage');
  if(!first_name || !last_name || !character_static || !department) return showMsg('Заполните имя, фамилию, статик и подразделение.','authMessage');
  if(first_name.length>60 || last_name.length>60 || character_static.length>30 || department.length>80) return showMsg('Слишком длинное значение в данных персонажа.','authMessage');
  if(password.length<8) return showMsg('Пароль должен содержать минимум 8 символов.','authMessage');
  if(!validStatic(character_static)) return showMsg('Статик должен содержать только цифры (до 30).','authMessage');
  const email=staticEmail(character_static);
  const {data,error}=await client.auth.signUp({email,password,options:{data:{faction: ['gk','fsvng'].includes(faction)?'army':faction,requested_faction:faction,first_name,last_name,character_static,department}}});
  if(error) return showMsg(errorText(error),'authMessage');
  await refreshUser();
  if(!data.session) showAuthView('login');
  showMsg(data.session ? 'Аккаунт создан. Вы вошли.' : 'Аккаунт создан. Для входа используйте статик и пароль. Проверьте настройку Confirm email в Supabase.');
  if(data.session) showPage('editor');
}
function renderAccount(){
  $('authForms').classList.toggle('hidden',!!session);
  $('accountInfo').classList.toggle('hidden',!session);
  if(!session) { $('accountInfo').replaceChildren(); return; }
  $('accountInfo').innerHTML=`
    <div class="account-overview"><div><h2 style="margin:0 0 6px">${safe(profile?.username || 'Пользователь')}</h2>
      <p class="muted" style="margin:0">${safe(allowedFactions().map(labelFaction).join(', '))} · ${profile?.role==='admin'?'Администратор':'Пользователь'}</p></div></div>
    <div class="account-stats">
      <div class="account-stat"><strong id="myPublishedCount">—</strong><span>Опубликовано приказов</span></div>
      <div class="account-stat"><strong id="myDraftCount">—</strong><span>Мои черновики</span></div>
    </div>
    <p><b>Имя и фамилия:</b> ${safe([profile?.first_name,profile?.last_name].filter(Boolean).join(' ') || 'Не указаны')}</p>
    <p><b>Статик:</b> ${safe(profile?.character_static || 'Не указан')}</p>
    <p><b>Подразделение:</b> ${safe(profile?.department || 'Не указано')}</p>

    <div class="account-rename">
      <button class="primary" type="button" id="editPersonalDataBtn">Изменить личные данные</button>
      <p class="muted small">Изменение имени, фамилии или подразделения требует выбора причины. Никнейм не изменяется.</p>
    </div>`;
  $('editPersonalDataBtn').addEventListener('click',openPersonalDataDialog);
}
async function loadAccountStats(){
  if(!session || !client) return;
  const uid=session.user.id;
  const [published,draftCount]=await Promise.all([
    client.from('orders').select('id',{count:'exact',head:true}).eq('author_id',uid).eq('status','published'),
    client.from('order_drafts').select('id',{count:'exact',head:true}).eq('user_id',uid)
  ]);
  if(!session || session.user.id!==uid) return;
  if($('myPublishedCount')) $('myPublishedCount').textContent=published.error?'—':String(published.count ?? 0);
  if($('myDraftCount')) $('myDraftCount').textContent=draftCount.error?'—':String(draftCount.count ?? 0);
  if(published.error || draftCount.error) showMsg('Не удалось загрузить статистику: '+errorText(published.error || draftCount.error));
}
function openPersonalDataDialog(){
  if(!session || !profile) return;
  $('editFirstName').value=profile.first_name||'';
  $('editLastName').value=profile.last_name||'';
  $('editDepartment').value=profile.department||'';
  $('editReason').value='';
  $('personalDataDialog').classList.remove('hidden');
  $('editFirstName').focus();
}
function closePersonalDataDialog(){ $('personalDataDialog').classList.add('hidden'); }
async function savePersonalData(){
  if(!session || !profile || !client) return;
  const first_name=$('editFirstName').value.trim();
  const last_name=$('editLastName').value.trim();
  const department=$('editDepartment').value.trim();
  const reason=$('editReason').value;
  if(!first_name || !last_name) return showMsg('Укажите имя и фамилию.');
  if(first_name.length>60 || last_name.length>60 || department.length>80) return showMsg('Превышена допустимая длина поля.');
  if(!['dismissal','name_change','transfer','demotion'].includes(reason)) return showMsg('Выберите причину изменения.');
  if(first_name===(profile.first_name||'') && last_name===(profile.last_name||'') && department===(profile.department||'')) return showMsg('Данные не изменились.');
  const button=$('savePersonalDataBtn');button.disabled=true;
  try {
    const {error}=await client.rpc('update_my_personal_data',{
      p_first_name:first_name,p_last_name:last_name,p_department:department,p_reason:reason
    });
    if(error) throw error;
    profile.first_name=first_name;profile.last_name=last_name;profile.department=department;
    closePersonalDataDialog();renderAccount();loadAccountStats();showMsg('Личные данные сохранены. Причина изменения зарегистрирована.');
  }catch(e){showMsg('Ошибка изменения данных: '+errorText(e));}
  finally{if(button.isConnected)button.disabled=false;}
}
$('cancelPersonalDataBtn').addEventListener('click',closePersonalDataDialog);
$('savePersonalDataBtn').addEventListener('click',savePersonalData);
$('personalDataDialog').addEventListener('click',e=>{if(e.target===$('personalDataDialog'))closePersonalDataDialog();});

const REGISTRY_PAGE_SIZE = 20;
let registryPage = 0;
let registryTotal = 0;
let registryRequest = 0;
let registryTimer = null;
const registrySorts = {
  number_desc: ['number', false], number_asc: ['number', true],
  date_desc: ['document_date', false], date_asc: ['document_date', true],
  created_desc: ['created_at', false], created_asc: ['created_at', true]
};
function registrySafeSearch(value){
  // Ограничиваем специальные символы PostgREST, чтобы пользовательский текст
  // не мог изменять синтаксис серверного фильтра .or().
  return value.trim().replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 100);
}
function updateRegistryPagination(){
  const totalPages = Math.max(1, Math.ceil(registryTotal / REGISTRY_PAGE_SIZE));
  $('registryPageInfo').textContent = registryTotal
    ? `Страница ${registryPage + 1} из ${totalPages} · Найдено приказов: ${registryTotal}`
    : 'Приказы не найдены';
  $('registryPrev').disabled = registryPage <= 0;
  $('registryNext').disabled = registryPage + 1 >= totalPages;
}
function resetRegistryAndLoad(){ registryPage=0; loadOrders(); }
async function loadOrders(){
  const request = ++registryRequest;
  if(!client){ $('registryBody').innerHTML='<tr><td colspan="5">Настройте Supabase в config.js.</td></tr>'; return; }
  $('registryBody').innerHTML='<tr><td colspan="5">Загрузка приказов…</td></tr>';
  $('registryPrev').disabled = true; $('registryNext').disabled = true;
  const q = registrySafeSearch($('orderSearch').value);
  const author = registrySafeSearch($('orderAuthor').value);
  const date = $('orderDate').value;
  const [column, ascending] = registrySorts[$('orderSort').value] || registrySorts.number_desc;
  let query = client.from('orders')
    .select('id,number,title,document_date,author_name,author_id,image_path,created_at', {count:'exact'})
    .eq('faction',registryFaction).eq('status','published');
  if(q){
    if(/^\d+$/.test(q) && Number.isSafeInteger(Number(q))){
      query=query.or(`number.eq.${Number(q)},title.ilike.%${q}%`);
    } else query=query.ilike('title',`%${q}%`);
  }
  if(author) query=query.ilike('author_name',`%${author}%`);
  if(date) query=query.eq('document_date',date);
  query=query.order(column,{ascending}).order('id',{ascending:true})
    .range(registryPage * REGISTRY_PAGE_SIZE,(registryPage+1)*REGISTRY_PAGE_SIZE-1);
  const {data,error,count}=await query;
  if(request!==registryRequest) return;
  if(error){
    $('registryBody').innerHTML='<tr><td colspan="5">Ошибка загрузки приказов.</td></tr>';
    $('registryPageInfo').textContent='Не удалось загрузить реестр';
    showMsg(errorText(error)); return;
  }
  registryTotal=count ?? 0;
  // Если после удаления последней записи текущая страница опустела.
  if(registryPage>0 && registryPage*REGISTRY_PAGE_SIZE>=registryTotal){
    registryPage=Math.max(0,Math.ceil(registryTotal/REGISTRY_PAGE_SIZE)-1);
    return loadOrders();
  }
  orders=data||[];
  renderOrders(); updateRegistryPagination();
}
function renderOrders(){
  $('registryBody').innerHTML=orders.map(o=>{
    const url=client.storage.from('order-images').getPublicUrl(o.image_path).data.publicUrl;
    return `<tr><td>${o.number}</td><td>${safe(o.title)}</td><td>${safe(o.document_date)}</td><td>${safe(o.author_name)}</td><td><button type="button" class="secondary small-btn" data-view-order="${safe(o.id)}">Просмотр</button> · <a href="${safe(url)}" target="_blank" rel="noopener noreferrer">Открыть PNG</a> · <a href="${safe(url)}" download="prikaz-${o.number}.png" target="_blank" rel="noopener noreferrer">Скачать</a>${profile?.role==='admin'?` <button class="secondary small-btn danger" data-delete="${o.id}">Удалить</button>`:''}</td></tr>`;
  }).join('') || '<tr><td colspan="5">Приказы не найдены.</td></tr>';
}

async function publish(){
  if(!session || !profile) return showMsg('Войдите в аккаунт.');
  if(!client) return showMsg('Не настроен Supabase.');
  const faction=window.currentFaction;
  if(!allowedFactions().includes(faction)) return showMsg('Нельзя публиковать в чужом подразделении.');
  const title=$('docTitle').value.trim();
  // Если дата не задана, используем сегодняшнюю локальную дату.
  const now = new Date();
  const date = $('docDate').value || [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
  if (!$('docDate').value) { $('docDate').value=date; window.updateDocument(); }
  if(!title || title==='Название документа') return showMsg('Укажите название приказа.');
  const button=$('publishBtn');button.disabled=true;
  let created=null;
  let stage='Подготовка PNG';
  try{
    if(!window.htmlToImage) throw new Error('Библиотека экспорта PNG не загружена.');
    // Сначала проверяем рендеринг, чтобы не занимать номер при ошибке изображения.
    await document.fonts.ready;
    try {
      const preview=await window.htmlToImage.toBlob($('paper'),{pixelRatio:2,backgroundColor:'#ffffff',cacheBust:false,filter:node=>!(node instanceof HTMLImageElement && !node.getAttribute('src'))});
      if(!preview) throw new Error('Библиотека вернула пустой PNG');
    } catch(e) { throw new Error('Не удалось сформировать PNG до резервирования: '+(e?.message || e?.type || String(e))); }
    stage='Резервирование номера';
    const {data,error}=await client.rpc(faction==='gk'?'reserve_gk_order':faction==='fsvng'?'reserve_fsvng_order':'reserve_order',{p_faction:faction,p_title:title,p_document_date:date});
    if(error) throw error;
    created=Array.isArray(data) ? data[0] : data;
    if(!created?.id || !created?.image_path || !Number.isInteger(created?.number)) throw new Error('Сервер вернул неполные данные резервирования приказа.');
    $('docNumber').value=String(created.number).padStart(3,'0');window.updateDocument();
    stage='Формирование PNG с номером';
    const blob=await window.htmlToImage.toBlob($('paper'),{pixelRatio:2,backgroundColor:'#ffffff',cacheBust:false,filter:node=>!(node instanceof HTMLImageElement && !node.getAttribute('src'))});
    if(!blob) throw new Error('Не удалось сформировать PNG.');
    stage='Загрузка PNG в Storage';
    const {error:uploadError}=await client.storage.from('order-images').upload(created.image_path,blob,{contentType:'image/png',upsert:false});
    if(uploadError) throw uploadError;
    stage='Завершение публикации';
    const {error:finalError}=await client.rpc('publish_order',{p_order_id:created.id});
    if(finalError) throw finalError;
    if(activeDraftId){
      const publishedDraftId=activeDraftId; setActiveDraft(null);
      const {error:draftCleanupError}=await client.from('order_drafts').delete().eq('id',publishedDraftId).eq('user_id',session.user.id);
      if(draftCleanupError) console.warn('Не удалось удалить опубликованный черновик:',draftCleanupError);
    }
    showMsg(`Приказ № ${created.number} опубликован в реестре «${labelFaction(faction)}».`);
    registryFaction=faction; $('registryFaction').value=faction;
    closePublishDialog();
    showPublishedDialog(created, title, blob);
  }catch(err){console.error('Ошибка публикации на этапе '+stage,err);showMsg('Ошибка публикации ('+stage+'): '+(err instanceof Event ? 'Сбой загрузки ресурса изображения (проверьте герб или подпись)' : errorText(err))+(created?' Номер был зарезервирован; неопубликованная запись не отображается в реестре.':''));}
  finally{button.disabled=false;updateAuthUI();}
}

// Публикация в два шага: сначала подтверждение, затем запись в реестр.
function closePublishDialog(){
  $('publishDialog').classList.add('hidden');
  document.body.classList.remove('publish-dialog-open');
}
let publishedPngUrl = null;
function showPublishedDialog(order, title, blob){
  if(publishedPngUrl) URL.revokeObjectURL(publishedPngUrl);
  // Используем именно тот PNG, который был успешно загружен в реестр.
  publishedPngUrl=URL.createObjectURL(blob);
  $('publishedDialogText').textContent=`Приказ № ${order.number} «${title}» внесён в реестр.`;
  $('publishedReadyMessage').textContent='PNG готов к скачиванию';
  $('publishedPreviewImage').src=publishedPngUrl;
  $('publishedDownloadBtn').href=publishedPngUrl;
  $('publishedDownloadBtn').download=`prikaz-${order.number}.png`;
  $('publishedDialog').classList.remove('hidden');
  document.body.classList.add('publish-dialog-open');
  $('publishedDownloadBtn').focus();
}
function closePublishedDialog(){
  $('publishedDialog').classList.add('hidden');
  document.body.classList.remove('publish-dialog-open');
  $('publishedPreviewImage').removeAttribute('src');
  $('publishedDownloadBtn').removeAttribute('href');
  if(publishedPngUrl){ URL.revokeObjectURL(publishedPngUrl); publishedPngUrl=null; }
}
$('nextPublishBtn').addEventListener('click',()=>{
  if(!session || !profile || !client) return showMsg('Для публикации войдите в аккаунт.');
  if(!allowedFactions().includes(window.currentFaction)) return showMsg('Нет доступа к выбранному подразделению.');
  const title=$('docTitle').value.trim();
  if(!title || title==='Название документа') return showMsg('Сначала укажите название приказа.');
  $('publishDialog').classList.remove('hidden');
  document.body.classList.add('publish-dialog-open');
  $('cancelPublishBtn').focus();
});
$('cancelPublishBtn').addEventListener('click',closePublishDialog);
$('publishDialog').addEventListener('click',e=>{if(e.target===$('publishDialog') && !$('publishBtn').disabled)closePublishDialog();});
$('publishedCloseBtn').addEventListener('click',closePublishedDialog);
$('publishedRegistryBtn').addEventListener('click',()=>{closePublishedDialog();showPage('registry');});
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  if(!$('publishedDialog').classList.contains('hidden'))closePublishedDialog();
  else if(!$('publishDialog').classList.contains('hidden') && !$('publishBtn').disabled)closePublishDialog();
});

async function deleteOrder(id){
  if(profile?.role!=='admin' || !confirm('Удалить приказ из реестра и его PNG?')) return;
  const {error}=await client.rpc('admin_delete_order',{p_order_id:id});
  if(error) showMsg(errorText(error)); else {showMsg('Приказ удалён из реестра.');loadOrders();}
}
async function loadAdmin(){
  if(profile?.role!=='admin'){ $('adminBody').innerHTML='<tr><td colspan="4">Доступ запрещён.</td></tr>';return; }
  const [p,h]=await Promise.all([client.from('profiles').select('id,username,first_name,last_name,character_static,faction,additional_faction,gk_access,requested_gk,fsvng_access,role').order('created_at',{ascending:false}).limit(200),client.from('order_history').select('created_at,action,actor_name,order_number,faction').order('created_at',{ascending:false}).limit(100)]);
  if(p.error) showMsg(errorText(p.error)); else profiles=p.data||[];
  $('adminBody').innerHTML=profiles.map(u=>{
    const access=new Set([u.faction,u.additional_faction,u.gk_access?'gk':null,u.fsvng_access?'fsvng':null].filter(Boolean));
    const choices=[['army','ВС РО'],['commandant','ВК'],['gk','ГК РО'],['fsvng','ФСВНГ']];
    const checks=choices.map(([key,name])=>`<label class="admin-group-option"><input type="checkbox" data-group="${key}" ${access.has(key)?'checked':''}><span>${name}</span></label>`).join('');
    return `<tr><td><strong>${safe([u.first_name,u.last_name].filter(Boolean).join(' ') || 'Имя и фамилия не указаны')}</strong>${u.character_static?`<div style="margin-top:5px;opacity:.7;font-size:12px">Статик: ${safe(u.character_static)}</div>`:''}</td><td><details class="admin-group-picker" data-group-picker="${u.id}"><summary>Подразделения <span class="admin-group-count">${access.size} выбрано</span></summary><div class="admin-group-options">${checks}</div></details></td><td>${u.role==='admin'?'Администратор':'Пользователь'}</td><td><button class="secondary small-btn" data-save-user="${u.id}">Сохранить группы</button></td></tr>`;
  }).join('');
  await loadResetRequests();
  $('historyBody').innerHTML=h.error?`<tr><td colspan="4">${safe(errorText(h.error))}</td></tr>`:(h.data||[]).map(e=>`<tr><td>${safe(new Date(e.created_at).toLocaleString('ru-RU'))}</td><td>${safe(e.actor_name)}</td><td>${safe(e.action)}</td><td>${safe(labelFaction(e.faction))} №${safe(e.order_number)}</td></tr>`).join('')||'<tr><td colspan="4">Нет событий.</td></tr>';
}
async function resetApi(body){
  const headers={'Content-Type':'application/json','apikey':cfg.supabaseAnonKey};
  if(session?.access_token) headers.Authorization=`Bearer ${session.access_token}`;
  const response=await fetch(`${cfg.supabaseUrl.replace(/\/$/,'')}/functions/v1/password-recovery`,{method:'POST',headers,body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error||`Ошибка сервера ${response.status}`);
  return data;
}
async function requestPasswordReset(){
  const staticId=$('recoveryStatic').value.trim();
  if(!validStatic(staticId)) return showMsg('Введите корректный статик.');
  try {await resetApi({action:'request',static_id:staticId});showMsg('Если аккаунт существует, заявка отправлена администратору.');}
  catch(e){showMsg(errorText(e));}
}
async function applyPasswordReset(){
  const staticId=$('recoveryStatic').value.trim(), code=$('recoveryCode').value.trim();
  const password=$('recoveryNewPassword').value;
  if(!validStatic(staticId)|| !/^\d{8}$/.test(code)) return showMsg('Введите статик и восьмизначный временный код.');
  if(password.length<8||password!==$('recoveryConfirmPassword').value) return showMsg('Пароль должен быть не короче 8 символов; оба ввода должны совпадать.');
  try {await resetApi({action:'redeem',static_id:staticId,code,new_password:password});
    $('authStaticLogin').value=staticId;$('authPassword').value='';$('recoveryCode').value='';$('recoveryNewPassword').value='';$('recoveryConfirmPassword').value='';
    showAuthView('login');showMsg('Пароль изменён. Войдите по статику и новому паролю.');
  }catch(e){showMsg(errorText(e));}
}
async function loadResetRequests(){
  if(profile?.role!=='admin') return;
  try{
    const data=await resetApi({action:'list'});
    $('resetRequestsBody').innerHTML=(data.requests||[]).map(r=>`<tr><td>${safe(r.static_id)}</td><td>${safe(r.name)}</td><td>${safe(new Date(r.requested_at).toLocaleString('ru-RU'))}</td><td><button class="secondary small-btn" data-generate-reset="${safe(r.user_id)}">Сгенерировать код</button></td></tr>`).join('')||'<tr><td colspan="4">Нет ожидающих заявок</td></tr>';
  }catch(e){$('resetRequestsBody').innerHTML=`<tr><td colspan="4">${safe(errorText(e))}</td></tr>`;}
}
async function generateResetCode(id){
  if(!confirm('Сгенерировать новый временный код? Предыдущий код этого пользователя перестанет действовать.'))return;
  try{const data=await resetApi({action:'generate',user_id:id});
    $('generatedResetDigits').textContent=data.code;
    $('generatedResetCode').classList.remove('hidden');
    showMsg('Код создан. Передайте его пользователю безопасным способом.');
  }catch(e){showMsg(errorText(e));}
}
async function saveUser(id){
  const current=profiles.find(u=>u.id===id);
  const picker=document.querySelector(`[data-group-picker="${id}"]`);
  if(!current || !picker) return showMsg('Пользователь не найден.');
  const selected=[...picker.querySelectorAll('input[data-group]:checked')].map(el=>el.dataset.group);
  if(!selected.length) return showMsg('Выберите хотя бы одно подразделение.');
  // The existing database stores army/VK in faction + additional_faction,
  // and GK/FSVNG in dedicated access flags.
  const standard=selected.filter(x=>x==='army'||x==='commandant');
  let faction=standard.includes(current.faction)?current.faction:(standard[0]||selected[0]);
  const additional_faction=standard.find(x=>x!==faction)||null;
  const gk_access=selected.includes('gk');
  const fsvng_access=selected.includes('fsvng');
  const {error}=await client.from('profiles').update({faction,additional_faction,gk_access,fsvng_access}).eq('id',id);
  if(error) showMsg(errorText(error)); else {showMsg('Доступ к подразделениям обновлён.');loadAdmin();}
}

function setActiveDraft(id){
  activeDraftId=id;
  $('activeDraftLabel').textContent=id?'Редактируется сохранённый черновик':'Новый документ';
  $('newDraftBtn').classList.toggle('hidden',!id);
  $('saveDraftBtn').textContent=id?'Обновить черновик':'Сохранить черновик';
}
async function loadDrafts(){
  if(!client || !session){$('draftsBody').innerHTML='<tr><td colspan="4">Войдите в аккаунт.</td></tr>';return;}
  $('draftsMessage').textContent='';
  const {data,error}=await client.from('order_drafts').select('id,title,faction,updated_at').eq('user_id',session.user.id).order('updated_at',{ascending:false}).limit(100);
  if(error){$('draftsMessage').textContent='Ошибка загрузки: '+errorText(error)+' Проверьте, выполнен ли файл drafts_migration.sql в Supabase.';return;}
  drafts=data||[];
  $('draftsBody').innerHTML=drafts.map(d=>`<tr><td>${safe(d.title)}</td><td>${safe(labelFaction(d.faction))}</td><td>${safe(new Date(d.updated_at).toLocaleString('ru-RU'))}</td><td><button type="button" class="secondary small-btn" data-open-draft="${safe(d.id)}">Открыть</button> <button type="button" class="secondary small-btn danger" data-remove-draft="${safe(d.id)}">Удалить</button></td></tr>`).join('')||'<tr><td colspan="4">Черновиков пока нет.</td></tr>';
}
async function saveDraft(){
  if(!session || !client) return showMsg('Для сохранения черновика войдите в аккаунт.');
  const editor=window.draftEditor;
  if(!editor) return showMsg('Редактор ещё не загружен. Обновите страницу.');
  const payload=editor.snapshot();
  if(!allowedFactions().includes(payload.faction)) return showMsg('Нельзя сохранять черновик другого подразделения.');
  const title=payload.values.docTitle.trim()||payload.values.docHeading.trim()||'Без названия';
  const data={user_id:session.user.id,faction:payload.faction,title,content:payload};
  if(activeDraftId) data.id=activeDraftId;
  const btn=$('saveDraftBtn');btn.disabled=true;
  try{
    const {data:stored,error}=await client.from('order_drafts').upsert(data,{onConflict:'id'}).select('id').single();
    if(error) throw error;
    setActiveDraft(stored.id);
    showMsg('Черновик сохранён в вашем аккаунте.');
  }catch(e){showMsg('Ошибка сохранения черновика: '+errorText(e)+' Проверьте SQL-миграцию и размер PNG-подписей.');}
  finally{btn.disabled=false;}
}
async function openDraft(id){
  if(!session) return;
  const {data,error}=await client.from('order_drafts').select('id,content').eq('id',id).eq('user_id',session.user.id).single();
  if(error){$('draftsMessage').textContent=errorText(error);return;}
  try{window.draftEditor.restore(data.content);setActiveDraft(data.id);showPage('editor');showMsg('Черновик открыт для редактирования.');}
  catch(e){$('draftsMessage').textContent='Не удалось открыть черновик: '+errorText(e);}
}
async function removeDraft(id){
  if(!session || !confirm('Удалить этот черновик без возможности восстановления?'))return;
  const {error}=await client.from('order_drafts').delete().eq('id',id).eq('user_id',session.user.id);
  if(error){$('draftsMessage').textContent=errorText(error);return;}
  if(activeDraftId===id)setActiveDraft(null);
  await loadDrafts();$('draftsMessage').textContent='Черновик удалён.';
}
$('saveDraftBtn').addEventListener('click',saveDraft);
$('newDraftBtn').addEventListener('click',()=>{window.draftEditor.reset();setActiveDraft(null);showMsg('Создан новый документ.');});
$('refreshDraftsBtn').addEventListener('click',loadDrafts);
$('draftsBody').addEventListener('click',e=>{const open=e.target.closest('[data-open-draft]');const remove=e.target.closest('[data-remove-draft]');if(open)openDraft(open.dataset.openDraft);else if(remove)removeDraft(remove.dataset.removeDraft);});
setActiveDraft(null);

document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));
$('loginBtn').addEventListener('click',()=>showPage('account'));
$('logoutBtn').addEventListener('click',async()=>{if(client)await client.auth.signOut();session=null;profile=null;updateAuthUI();showPage('account');});
$('signInBtn').addEventListener('click',login);$('legacyLoginBtn').addEventListener('click',async()=>{const email=$('legacyEmail').value.trim(),password=$('authPassword').value;if(!email||!password)return showMsg('Введите почту старого аккаунта и пароль.');const {error}=await client.auth.signInWithPassword({email,password});if(error)return showMsg(errorText(error));await refreshUser();renderAccount();showPage('editor');});$('signUpBtn').addEventListener('click',register);
$('goRegisterBtn').addEventListener('click',()=>showAuthView('register'));
$('goLoginBtn').addEventListener('click',()=>showAuthView('login'));
$('forgotPasswordBtn').addEventListener('click',()=>{$('recoveryStatic').value=$('authStaticLogin').value.trim();showAuthView('recovery');});
$('recoveryBackBtn').addEventListener('click',()=>showAuthView('login'));
$('requestResetBtn').addEventListener('click',requestPasswordReset);
$('applyResetBtn').addEventListener('click',applyPasswordReset);
$('copyResetCodeBtn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('generatedResetDigits').textContent);showMsg('Код скопирован.');}catch(e){showMsg('Скопируйте код вручную.');}});
$('resetRequestsBody').addEventListener('click',e=>{const b=e.target.closest('[data-generate-reset]');if(b)generateResetCode(b.dataset.generateReset);});
$('publishBtn').addEventListener('click',publish);
$('registryFaction').addEventListener('change',e=>{registryFaction=e.target.value;resetRegistryAndLoad();});
['orderSearch','orderAuthor'].forEach(id=>$(id).addEventListener('input',()=>{
  clearTimeout(registryTimer);
  registryTimer=setTimeout(resetRegistryAndLoad,350);
}));
$('orderDate').addEventListener('change',resetRegistryAndLoad);
$('orderSort').addEventListener('change',resetRegistryAndLoad);
$('clearFilters').addEventListener('click',()=>{
  clearTimeout(registryTimer);
  ['orderSearch','orderDate','orderAuthor'].forEach(id=>$(id).value='');
  $('orderSort').value='number_desc'; resetRegistryAndLoad();
});
$('registryPrev').addEventListener('click',()=>{if(registryPage>0){registryPage--;loadOrders();}});
$('registryNext').addEventListener('click',()=>{if((registryPage+1)*REGISTRY_PAGE_SIZE<registryTotal){registryPage++;loadOrders();}});
$('registryBody').addEventListener('click',e=>{const view=e.target.closest('[data-view-order]');if(view){viewOrder(view.dataset.viewOrder);return;}const id=e.target.dataset.delete;if(id)deleteOrder(id);});
function viewOrder(id){
  const o=orders.find(item=>String(item.id)===String(id));
  if(!o) return showMsg('Приказ не найден. Обновите реестр.');
  const url=client.storage.from('order-images').getPublicUrl(o.image_path).data.publicUrl;
  $('orderViewerTitle').textContent=`Приказ № ${o.number} — ${o.title}`;
  $('orderViewerMeta').textContent=`Дата: ${o.document_date} · Автор: ${o.author_name} · Подразделение: ${labelFaction(registryFaction)}`;
  $('orderViewerImage').src=url;
  $('orderViewerImage').alt=`Приказ № ${o.number}`;
  $('orderViewerOpen').href=url;
  $('orderViewerDownload').href=url;
  $('orderViewerDownload').download=`prikaz-${o.number}.png`;
  $('orderViewer').classList.remove('hidden');
  document.body.classList.add('viewer-open');
  $('orderViewerClose').focus();
}
function closeOrderViewer(){ $('orderViewer').classList.add('hidden');$('orderViewerImage').removeAttribute('src');document.body.classList.remove('viewer-open'); }
$('orderViewerClose').addEventListener('click',closeOrderViewer);
$('orderViewer').addEventListener('click',e=>{if(e.target===$('orderViewer'))closeOrderViewer();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('orderViewer').classList.contains('hidden'))closeOrderViewer();});
$('orderViewerImage').addEventListener('error',()=>{if(!$('orderViewer').classList.contains('hidden'))showMsg('Не удалось загрузить PNG приказа.');});
$('adminBody').addEventListener('click',e=>{
  const save=e.target.closest('[data-save-user]');
  if(save) saveUser(save.dataset.saveUser);
});
showPage('registry');
if(client){
  client.auth.onAuthStateChange(()=>{setTimeout(()=>refreshUser().then(()=>{if(!$('accountPage').classList.contains('hidden'))renderAccount();}),0);});
  refreshUser().then(()=>{if(session)showPage('editor');});
}else updateAuthUI();
})();

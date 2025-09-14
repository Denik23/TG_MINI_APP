/* ===================== Mini App: Zubr Forms (Sheets CRUD + iframe) ===================== */

/* --- Безопасный доступ к Telegram.WebApp (стаб вне Телеграма) --- */
const tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : {
  colorScheme: (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light',
  onEvent(){},
  showAlert: (msg) => alert(msg),
  showPopup: ({title = 'Info', message = ''} = {}) => alert(`${title}\n\n${message}`),
  showToast: ({text} = {}) => console.log(text || 'toast'),
  HapticFeedback: { impactOccurred(){} },
  initDataUnsafe: { user: { id: new URLSearchParams(location.search).get('tgid') || '' } },
  openLink: (url) => window.open(url, '_blank'),
  ready(){},
};

/* ---------- Константы (оставь свои) ---------- */
const ADMIN_ID = '226674400';
const API_URL  = 'https://script.google.com/macros/s/AKfycbxYLWsMRGFerrJZQy-oI_QbfFDwgcyyxHfNFaCVQH2CQ0g6v_nPOCuUe-IuFsYg9ZGQ/exec';

/* ---------- Состояние ---------- */
let forms = [];
let isLoading = false;

/* ---------- Утилиты ---------- */
const getUserId = () =>
  String(tg.initDataUnsafe?.user?.id || new URLSearchParams(location.search).get('tgid') || '');
const isAdmin = () => getUserId() === ADMIN_ID;

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

/* ---------- Тема без перезагрузки ---------- */
function applyTheme(scheme) {
  document.documentElement.setAttribute('data-theme', scheme || tg.colorScheme || (
    (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'
  ));
}

/* ---------- API (ретраи без setTimeout-капкана) ---------- */
async function fetchWithTimeout(url, ms = 10000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function loadForms(maxRetries = 3) {
  if (isLoading) return;
  isLoading = true;

  try {
    // Показ лоадера
    appLoader?.removeAttribute('aria-hidden');
    appLoader && (appLoader.innerHTML = '<div style="color:white;font-size:16px;">⏳ Загружаем данные...</div>');

    let attempt = 0, lastErr = null;
    while (attempt < maxRetries) {
      try {
        const res  = await fetchWithTimeout(`${API_URL}?action=list`, 10000);
        const text = await res.text();
        let json; try { json = JSON.parse(text); } catch { throw new Error(`Bad JSON: ${text}`); }
        if (!json.ok) throw new Error(json.error || 'load error');
        forms = Array.isArray(json.data) ? json.data : [];
        lastErr = null;
        break; // успех
      } catch (e) {
        lastErr = e;
        attempt++;
        if (attempt < maxRetries) {
          console.warn(`Повторная попытка загрузки (${attempt}/${maxRetries - 1})…`, e);
          await sleep(1000);
        }
      }
    }
    if (lastErr) {
      forms = [];
      tg.showAlert?.('Ошибка загрузки форм: ' + lastErr.message);
    }
  } finally {
    isLoading = false;
    render();
    appLoader?.setAttribute('aria-hidden', 'true');
  }
}

async function saveFormRemote(form) {
  const userId = getUserId();
  const qs = new URLSearchParams({
    action: 'save',
    userId,
    id: form.id || '',
    title: form.title || '',
    desc: form.desc || '',
    baseUrl: form.baseUrl || ''
  });
  const res  = await fetch(`${API_URL}?${qs.toString()}`);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`Bad JSON: ${text}`); }
  if (!json.ok) throw new Error(json.error || 'save error');
}

async function deleteFormRemote(id) {
  const userId = getUserId();
  const qs = new URLSearchParams({ action: 'delete', userId, id });
  const res  = await fetch(`${API_URL}?${qs.toString()}`);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`Bad JSON: ${text}`); }
  if (!json.ok) throw new Error(json.error || 'delete error');
}

/* ---------- Глобальные ссылки на элементы (заполняются в init) ---------- */
let appLoader, list, search, addBtn, sheet, frame, loader, sheetTitle, backBtn;
let modal, modalTitle, modalClose, modalSave, modalCancel, fldId, fldTitle, fldDesc, fldBaseUrl;

/* ---------- Рендер списка ---------- */
function render() {
  if (!list) return;
  const q = (search?.value || '').trim().toLowerCase();
  list.innerHTML = '';
  const data = forms.filter(f =>
    (f.title || '').toLowerCase().includes(q) ||
    (f.desc  || '').toLowerCase().includes(q)
  );

  if (!data.length) {
    list.innerHTML = '<div class="card">Ничего не найдено</div>';
    return;
  }

  data.forEach(f => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-title">${f.title}</div>
      <div class="card-actions">
        <div class="actions-left">
          <button class="btn btn-primary">Открыть</button>
          <button class="btn btn-ghost">Подробнее</button>
        </div>
        ${isAdmin() ? `
        <div class="actions-right">
          <button class="btn btn-ghost btn-sm" title="Редактировать">✏️</button>
          <button class="btn btn-danger btn-sm" title="Удалить">🗑️</button>
        </div>` : ''}
      </div>`;

    const [openBtn, moreBtn, editBtn, delBtn] = card.querySelectorAll('button');

    openBtn.onclick = () => openForm(f);
    moreBtn.onclick = () => tg.showPopup?.({
      title: f.title,
      message: (f.desc || 'Описание отсутствует') + `\n\nID: ${f.id || '—'}`,
      buttons: [{ id:'ok', type:'close', text:'OK' }]
    });

    if (isAdmin()) {
      editBtn.onclick = () => openModalForEdit(f);
      delBtn.onclick  = () => deleteForm(f);
    }
    list.appendChild(card);
  });
}

/* ---------- Модалка ---------- */
function openModalForCreate() {
  if (!modal) return;
  modalTitle && (modalTitle.textContent = 'Добавить форму');
  fldId && (fldId.value = '');
  fldTitle && (fldTitle.value = '');
  fldDesc && (fldDesc.value = '');
  fldBaseUrl && (fldBaseUrl.value = '');
  modal.classList.remove('hidden');
}
function openModalForEdit(f) {
  if (!modal) return;
  modalTitle && (modalTitle.textContent = 'Редактировать форму');
  fldId && (fldId.value = f.id || '');
  fldTitle && (fldTitle.value = f.title || '');
  fldDesc && (fldDesc.value = f.desc || '');
  fldBaseUrl && (fldBaseUrl.value = f.baseUrl || '');
  modal.classList.remove('hidden');
}
function closeModal() { modal?.classList.add('hidden'); }

async function onModalSave() {
  const form = {
    id: (fldId?.value || '').trim(),
    title: (fldTitle?.value || '').trim(),
    desc: (fldDesc?.value || '').trim(),
    baseUrl: (fldBaseUrl?.value || '').trim()
  };
  if (!form.title) return tg.showAlert?.('Введите название формы');
  if (!form.baseUrl.includes('entry.') || !form.baseUrl.endsWith('='))
    return tg.showAlert?.('Вставьте предзаполненную ссылку Google Forms с entry.XXXX и на конце "="' );

  try {
    await saveFormRemote(form);
    closeModal();
    await loadForms();
    tg.showToast?.({ text: 'Сохранено', duration: 1400 });
  } catch (e) {
    tg.showAlert?.('Ошибка сохранения: ' + e.message);
  }
}

/* ---------- Удаление ---------- */
function deleteForm(f) {
  tg.showPopup?.({
    title: 'Удалить форму?',
    message: `«${f.title}» будет удалена.`,
    buttons: [
      { id:'cancel', type:'cancel', text:'Отмена' },
      { id:'ok',     type:'destructive', text:'Удалить' }
    ]
  }, async (btnId) => {
    if (btnId === 'ok') {
      try {
        await deleteFormRemote(f.id);
        await loadForms();
        tg.showToast?.({ text: 'Удалено', duration: 1400 });
      } catch (e) {
        tg.showAlert?.('Ошибка удаления: ' + e.message);
      }
    }
  });
}

/* ---------- Открыть форму (с анти-мерцанием) ---------- */
function openForm(form) {
  const uid = getUserId();
  if (!uid) return tg.showAlert?.('Не удалось получить Telegram ID. Откройте мини-апп из Telegram или добавьте ?tgid=ID для теста.');
  if (!form.baseUrl) return tg.showAlert?.('Ссылка не указана.');

  let url = form.baseUrl;

  // Google Forms
  if (url.includes("docs.google.com/forms")) {
    if (!url.endsWith('=')) return tg.showAlert?.('baseUrl для формы должен заканчиваться "=".');
    url = `${url}${encodeURIComponent(uid)}&embedded=true`;
  }
  // Google Slides
  else if (url.includes("docs.google.com/presentation")) {
    if (url.includes("/pub?")) url = url.replace("/pub?", "/embed?");
    if (!url.includes("/embed?")) url = url.replace(/\/d\/e\/[^/]+/, "$&/embed");
  }

  sheetTitle && (sheetTitle.textContent = form.title || 'Документ');
  showSheet(url);
}

function showSheet(url) {
  tg.HapticFeedback?.impactOccurred('light');

  sheet?.classList.remove('hidden');
  loader?.removeAttribute('aria-hidden');
  if (frame) frame.src = 'about:blank';
  requestAnimationFrame(() => sheet?.classList.add('open'));

  const fallback = setTimeout(() => {
    try { tg.openLink?.(url); } catch { window.open(url, '_blank'); }
  }, 4500);

  if (frame) {
    frame.onload = () => {
      clearTimeout(fallback);
      loader?.setAttribute('aria-hidden', 'true');
    };
    // небольшая задержка — помогает iOS WebView не «мигать»
    setTimeout(() => { frame.src = url; }, 150);
  }
}

function closeSheet() {
  sheet?.classList.remove('open');
  setTimeout(() => {
    if (frame) frame.src = 'about:blank';
    loader?.setAttribute('aria-hidden', 'true');
    sheet?.classList.add('hidden');
  }, 250);
}

/* ---------- Скрывать клавиатуру вне полей ---------- */
const blurIfOutsideField = (e) => {
  const isField = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
  if (isField) return;

  const el = document.activeElement;
  if (el && el.matches?.('input, textarea, select, [contenteditable="true"]')) {
    el.blur();
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      const dummy = document.createElement('input');
      Object.assign(dummy.style, { position:'fixed', top:'-1000px', opacity:'0', pointerEvents:'none' });
      document.body.appendChild(dummy);
      dummy.focus();
      setTimeout(() => { dummy.blur(); dummy.remove(); window.scrollTo(0,0); }, 0);
    } else {
      setTimeout(() => window.scrollTo(0,0), 0);
    }
  }
};

/* ---------- Инициализация (строго после DOM) ---------- */
function init() {
  // Тема
  applyTheme();
  tg.onEvent('themeChanged', () => applyTheme(tg.colorScheme));

  // DOM-refs (после DOMContentLoaded они существуют)
  appLoader   = document.getElementById('appLoader');
  list        = document.getElementById('list');
  search      = document.getElementById('searchInput');
  addBtn      = document.getElementById('addBtn');

  sheet       = document.getElementById('sheet');
  frame       = document.getElementById('formFrame');
  loader      = document.getElementById('loader');
  sheetTitle  = document.getElementById('sheetTitle');
  backBtn     = document.getElementById('backBtn');

  modal       = document.getElementById('formModal');
  modalTitle  = document.getElementById('modalTitle');
  modalClose  = document.getElementById('modalClose');
  modalSave   = document.getElementById('modalSave');
  modalCancel = document.getElementById('modalCancel');
  fldId       = document.getElementById('fldId');
  fldTitle    = document.getElementById('fldTitle');
  fldDesc     = document.getElementById('fldDesc');
  fldBaseUrl  = document.getElementById('fldBaseUrl');

  // Вешаем обработчики безопасно
  backBtn?.addEventListener('click', closeSheet);
  search?.addEventListener('input', render);
  addBtn && (addBtn.hidden = !isAdmin());
  addBtn?.addEventListener('click', openModalForCreate);
  modalClose?.addEventListener('click', closeModal);
  modalCancel?.addEventListener('click', closeModal);
  modalSave?.addEventListener('click', onModalSave);

  document.addEventListener('touchstart', blurIfOutsideField, { passive:true, capture:true });
  document.addEventListener('mousedown',  blurIfOutsideField, true);

  // Клик по фону модалки снимает фокус
  modal?.addEventListener('click', (e) => {
    if (e.target?.id === 'formModal') {
      if (document.activeElement && 'blur' in document.activeElement) {
        document.activeElement.blur();
      }
    }
  });

  // Telegram ready после DOM — меньше глюков на iOS
  tg.ready();

  // Стартовая загрузка
  loadForms();
}

window.addEventListener('DOMContentLoaded', init);

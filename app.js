/* ===================== Mini App: Zubr Forms (Sheets CRUD + iframe) ===================== */
const tg = window.Telegram.WebApp;
window.addEventListener('DOMContentLoaded', () => tg.ready());

/* ---------- Тема ---------- */
(function setTheme() {
  const scheme = tg.colorScheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', scheme);
})();
tg.onEvent('themeChanged', () => {
  document.documentElement.setAttribute('data-theme', tg.colorScheme);
});

/* ---------- Константы ---------- */
const ADMIN_ID = '226674400';                                
const API_URL  = 'https://script.google.com/macros/s/AKfycbxYLWsMRGFerrJZQy-oI_QbfFDwgcyyxHfNFaCVQH2CQ0g6v_nPOCuUe-IuFsYg9ZGQ/exec';
const appLoader  = document.getElementById('appLoader');

/* ---------- Состояние ---------- */
let forms = [];
let isLoading = false;

/* ---------- Helpers ---------- */
const getUserId = () =>
  String(tg.initDataUnsafe?.user?.id || new URLSearchParams(location.search).get('tgid') || '');
const isAdmin = () => getUserId() === ADMIN_ID;

/* ---------- API ---------- */
async function loadForms(retries = 3) {
  if (isLoading) return;
  isLoading = true;

  appLoader?.removeAttribute('aria-hidden');
  appLoader.innerHTML = '<div style="color:white;font-size:16px;">⏳ Загружаем данные...</div>';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // увеличено время ожидания

  try {
    const res = await fetch(`${API_URL}?action=list`, { signal: controller.signal });
    clearTimeout(timeoutId);

    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'load error');
    forms = Array.isArray(json.data) ? json.data : [];

  } catch (e) {
    clearTimeout(timeoutId);
    if (retries > 0) {
      console.warn(`Повторная попытка... осталось ${retries}`);
      return setTimeout(() => loadForms(retries - 1), 1000);
    }
    forms = [];
    tg.showAlert?.('Ошибка загрузки форм: ' + e.message);

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
  const res = await fetch(`${API_URL}?${qs.toString()}`);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`Bad JSON: ${text}`); }
  if (!json.ok) throw new Error(json.error || 'save error');
}

async function deleteFormRemote(id) {
  const userId = getUserId();
  const qs = new URLSearchParams({ action: 'delete', userId, id });
  const res = await fetch(`${API_URL}?${qs.toString()}`);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`Bad JSON: ${text}`); }
  if (!json.ok) throw new Error(json.error || 'delete error');
}

/* ---------- UI refs ---------- */
const list        = document.getElementById('list');
const search      = document.getElementById('searchInput');
const addBtn      = document.getElementById('addBtn');

const sheet       = document.getElementById('sheet');
const frame       = document.getElementById('formFrame');
const loader      = document.getElementById('loader');
const sheetTitle  = document.getElementById('sheetTitle');
document.getElementById('backBtn').addEventListener('click', closeSheet);

const modal       = document.getElementById('formModal');
const modalTitle  = document.getElementById('modalTitle');
const modalClose  = document.getElementById('modalClose');
const modalSave   = document.getElementById('modalSave');
const modalCancel = document.getElementById('modalCancel');
const fldId       = document.getElementById('fldId');
const fldTitle    = document.getElementById('fldTitle');
const fldDesc     = document.getElementById('fldDesc');
const fldBaseUrl  = document.getElementById('fldBaseUrl');

/* ---------- Инициализация ---------- */
if (isAdmin()) addBtn.hidden = false;
loadForms();
search.addEventListener('input', render);
addBtn.addEventListener('click', () => openModalForCreate());
modalClose.addEventListener('click', closeModal);
modalCancel.addEventListener('click', closeModal);
modalSave.addEventListener('click', onModalSave);

/* ---------- Рендер списка ---------- */
function render() {
  const q = (search.value || '').trim().toLowerCase();
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
  modalTitle.textContent = 'Добавить форму';
  fldId.value = '';
  fldTitle.value = '';
  fldDesc.value = '';
  fldBaseUrl.value = '';
  modal.classList.remove('hidden');
}
function openModalForEdit(f) {
  modalTitle.textContent = 'Редактировать форму';
  fldId.value = f.id || '';
  fldTitle.value = f.title || '';
  fldDesc.value = f.desc || '';
  fldBaseUrl.value = f.baseUrl || '';
  modal.classList.remove('hidden');
}
function closeModal() { modal.classList.add('hidden'); }

async function onModalSave() {
  const form = {
    id: (fldId.value || '').trim(),
    title: (fldTitle.value || '').trim(),
    desc: (fldDesc.value || '').trim(),
    baseUrl: (fldBaseUrl.value || '').trim()
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

/* ---------- Открыть форму ---------- */
function openForm(form) {
  const uid = getUserId();
  if (!uid) {
    tg.showAlert?.('Не удалось получить Telegram ID.');
    return;
  }

  if (!form.baseUrl) {
    tg.showAlert?.('Ссылка не указана.');
    return;
  }

  let url = form.baseUrl;

  if (url.includes("docs.google.com/forms")) {
    if (!url.endsWith('=')) {
      tg.showAlert?.('baseUrl для формы должен заканчиваться "=".');
      return;
    }
    url = `${url}${encodeURIComponent(uid)}&embedded=true`;
  }
  else if (url.includes("docs.google.com/presentation")) {
    if (url.includes("/pub?")) url = url.replace("/pub?", "/embed?");
    if (!url.includes("/embed?")) url = url.replace(/\/d\/e\/[^/]+/, "$&/embed");
  }

  sheetTitle.textContent = form.title || 'Документ';
  showSheet(url);
}

function showSheet(url) {
  tg.HapticFeedback?.impactOccurred('light');

  sheet.classList.remove('hidden');
  loader.removeAttribute('aria-hidden');
  frame.src = 'about:blank';
  requestAnimationFrame(() => sheet.classList.add('open'));

  const fallback = setTimeout(() => {
    try { tg.openLink?.(url); } catch { window.open(url, '_blank'); }
  }, 4500);

  frame.onload = () => {
    clearTimeout(fallback);
    loader.setAttribute('aria-hidden', 'true');
  };

  // задержка для плавности
  setTimeout(() => {
    frame.src = url;
  }, 150);
}

function closeSheet() {
  sheet.classList.remove('open');
  setTimeout(() => {
    frame.src = 'about:blank';
    loader.setAttribute('aria-hidden', 'true');
    sheet.classList.add('hidden');
  }, 250);
}

/* ---------- Скрывать клавиатуру ---------- */
const blurIfOutsideField = (e) => {
  const isField = e.target.closest('input, textarea, select, [contenteditable="true"]');
  if (isField) return;

  const el = document.activeElement;
  if (el && el.matches('input, textarea, select, [contenteditable="true"]')) {
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
document.addEventListener('touchstart', blurIfOutsideField, { passive:true, capture:true });
document.addEventListener('mousedown',  blurIfOutsideField, true);

modal.addEventListener('click', (e) => {
  if (e.target.id === 'formModal') {
    if (document.activeElement && 'blur' in document.activeElement) {
      document.activeElement.blur();
    }
  }
});

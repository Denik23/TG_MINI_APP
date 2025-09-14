/* ===================== Mini App: Zubr Forms (read-only + iframe) ===================== */

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

/* ---------- Константы ---------- */
const API_URL = 'https://script.google.com/macros/s/AKfycbxYLWsMRGFerrJZQy-oI_QbfFDwgcyyxHfNFaCVQH2CQ0g6v_nPOCuUe-IuFsYg9ZGQ/exec';

/* ---------- Состояние ---------- */
let forms = [];
let isLoading = false;

/* ---------- Утилиты ---------- */
const getUserId = () =>
  String(tg.initDataUnsafe?.user?.id || new URLSearchParams(location.search).get('tgid') || '');

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

/* ---------- Глобальные ссылки на элементы (заполняются в init) ---------- */
let appLoader, list, search, sheet, frame, loader, sheetTitle, backBtn;

/* ---------- Рендер списка (только просмотр) ---------- */
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
      </div>`;

    const [openBtn, moreBtn] = card.querySelectorAll('button');

    openBtn.onclick = () => openForm(f);
    moreBtn.onclick = () => tg.showPopup?.({
      title: f.title,
      message: (f.desc || 'Описание отсутствует') + `\n\nID: ${f.id || '—'}`,
      buttons: [{ id:'ok', type:'close', text:'OK' }]
    });

    // Клик по карточке тоже открывает
    card.addEventListener('click', (e) => {
      if (e.target.tagName.toLowerCase() === 'button') return;
      openForm(f);
    });

    list.appendChild(card);
  });
}

async function loadStats(maxRetries = 2) {
  // Пытаемся получить stats; при ошибке оставим нули
  let attempt = 0, lastErr = null;
  while (attempt < maxRetries) {
    try {
      const res  = await fetchWithTimeout(`${API_URL}?action=stats`, 10000);
      const text = await res.text();
      const json = JSON.parse(text);
      if (!json.ok) throw new Error(json.error || 'stats error');
      const d = json.data || {};
      stats.submitted = Number(d.submitted || 0);
      stats.processed = Number(d.processed || 0);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e; attempt++; await sleep(600);
    }
  }
  if (lastErr) { stats.submitted = 0; stats.processed = 0; }
  renderStats();
}

function renderStats() {
  const pending = Math.max(0, (stats.submitted|0) - (stats.processed|0));
  statSubmittedEl && (statSubmittedEl.textContent = String(stats.submitted|0));
  statProcessedEl && (statProcessedEl.textContent = String(stats.processed|0));
  statPendingEl   && (statPendingEl.textContent   = String(pending));
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
  // Тема + обновление цвета шапки Telegram под фон
  applyTheme();
  tg.onEvent?.('themeChanged', () => {
    applyTheme(tg.colorScheme);
    tg.setHeaderColor?.('bg_color');
  });

  // DOM-refs
  appLoader  = document.getElementById('appLoader');
  list       = document.getElementById('list');
  search     = document.getElementById('searchInput');

  // Статистика
  statSubmittedEl = document.getElementById('statSubmitted');
  statProcessedEl = document.getElementById('statProcessed');
  statPendingEl   = document.getElementById('statPending');

  // Просмотр формы
  sheet      = document.getElementById('sheet');
  frame      = document.getElementById('formFrame');
  loader     = document.getElementById('loader');
  sheetTitle = document.getElementById('sheetTitle');
  backBtn    = document.getElementById('backBtn');

  // Обработчики
  backBtn?.addEventListener('click', closeSheet);
  search?.addEventListener('input', render);

  document.addEventListener('touchstart', blurIfOutsideField, { passive: true, capture: true });
  document.addEventListener('mousedown',  blurIfOutsideField, true);

  // Рассчитываем высоты для "липких" поиска и статистики
  const headerEl  = document.querySelector('.app-header');
  const toolbarEl = document.querySelector('.toolbar');
  const setHeights = () => {
    const hh = (headerEl?.offsetHeight  || 56);
    const th = (toolbarEl?.offsetHeight || 56);
    document.documentElement.style.setProperty('--header-h',  hh + 'px');
    document.documentElement.style.setProperty('--toolbar-h', th + 'px');
  };
  setHeights();
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(setHeights);
    headerEl  && ro.observe(headerEl);
    toolbarEl && ro.observe(toolbarEl);
  }
  window.addEventListener('resize', setHeights);

  // Telegram WebApp: готовность и авто-разворачивание на весь экран
  tg.ready?.();
  tg.setHeaderColor?.('bg_color');       // шапка Telegram сливается с фоном
  tg.expand?.();                          // сразу на весь экран
  tg.disableVerticalSwipes?.();           // убираем "полулист", где поддерживается
  tg.onEvent?.('viewportChanged', () => { // страховка + обновляем высоты
    if (!tg.isExpanded) tg.expand?.();
    setHeights();
  });

  // Стартовая загрузка
  loadForms();
  loadStats?.(); // если функция добавлена — подтянет цифры; иначе просто пропустится
}

window.addEventListener('DOMContentLoaded', init);





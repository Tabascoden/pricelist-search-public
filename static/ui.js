const $ = (id) => document.getElementById(id);

const API_CANDIDATES = [
  // предпочитаем явные API-роуты, но поддержим и /search
  (q, smart, limit) => `/api/search?q=${encodeURIComponent(q)}&smart=${smart ? '1' : '0'}&limit=${limit}`,
  (q, smart, limit) => `/search?q=${encodeURIComponent(q)}&smart=${smart ? '1' : '0'}&limit=${limit}`,
  (q, smart, limit) => `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  (q, smart, limit) => `/search?q=${encodeURIComponent(q)}&limit=${limit}`,
];

function normalizeItem(x) {
  // максимально “терпеливое” приведение полей под разные прайсы/форматы
  const name =
    x.name ?? x.title ?? x.product_name ?? x.item_name ?? x.nomenclature ?? x.n ?? '-';

  const supplier =
    x.supplier ?? x.vendor ?? x.brand ?? x.source ?? x.list ?? x.pricelist ?? x.s ?? '-';

  const unit =
    x.unit ?? x.uom ?? x.measure ?? x.measure_unit ?? x.ed ?? x.units ?? '-';

  const priceRaw =
    x.unit_price ?? x.price ?? x.cost ?? x.value ?? x.p ?? null;

  const price =
    (priceRaw === null || priceRaw === undefined || priceRaw === '') ? '-' : String(priceRaw);

  const scoreRaw =
    x.score ?? x.similarity ?? x.rank ?? x.match ?? null;

  const score =
    (scoreRaw === null || scoreRaw === undefined || scoreRaw === '') ? '-' : String(scoreRaw);

  return { name, supplier, unit, price, score, _raw: x };
}

function fmtScore(s) {
  if (s === '-' || s === null) return '-';
  const n = Number(s);
  if (Number.isFinite(n)) return n.toFixed(3);
  return String(s);
}

function fmtPrice(p) {
  if (p === '-' || p === null) return '-';
  const n = Number(p);
  if (Number.isFinite(n)) {
    const rounded = Math.round(n);
    return rounded.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  return String(p);
}

function setStatus(text) {
  $('status').textContent = text;
}

function setHint(text) {
  $('hint').textContent = text || '';
}

function renderRows(items) {
  const rows = $('rows');
  rows.innerHTML = '';

  if (!items.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="5" class="empty">Ничего не найдено</td>`;
    rows.appendChild(tr);
    return;
  }

  for (const it of items) {
    const tr = document.createElement('tr');
    tr.className = 'row';
    tr.innerHTML = `
      <td class="colScore">${fmtScore(it.score)}</td>
      <td class="colName">
        <div class="name">${escapeHtml(it.name)}</div>
        <div class="mini">
          <button class="miniBtn" data-action="copy-name">копировать</button>
          <button class="miniBtn" data-action="copy-json">json</button>
        </div>
      </td>
      <td>${escapeHtml(it.supplier)}</td>
      <td>${escapeHtml(it.unit)}</td>
      <td class="colPrice">${fmtPrice(it.price)}</td>
    `;

    tr.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('button');
      if (btn) {
        e.stopPropagation();
        const a = btn.dataset.action;
        if (a === 'copy-name') copyText(it.name);
        if (a === 'copy-json') copyText(JSON.stringify(it._raw, null, 2));
        return;
      }
    });

    rows.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function tryFetchJson(url) {
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    // иногда сервер отдаёт text/html, но JSON внутри — пробуем всё равно
    const t = await r.text();
    try { return JSON.parse(t); } catch { throw new Error('Not JSON'); }
  }
  return await r.json();
}

async function search() {
  const q = $('q').value.trim();
  const smart = $('smart').checked;
  const limit = Number($('limit').value) || 50;

  if (!q) {
    setHint('Введите запрос');
    return;
  }

  setStatus('поиск…');
  setHint('');
  $('count').textContent = '';
  const showRaw = $('showRaw').checked;

  let data = null;
  let lastErr = null;

  for (const mk of API_CANDIDATES) {
    const url = mk(q, smart, limit);
    try {
      data = await tryFetchJson(url);
      setHint(`endpoint: ${url}`);
      break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!data) {
    setStatus('ошибка');
    setHint(`Не смог получить JSON (последняя ошибка: ${String(lastErr)})`);
    renderRows([]);
    return;
  }

  // поддержим разные форматы ответа:
  // 1) {items:[...]}  2) {results:[...]}  3) просто [...]
  const arr = Array.isArray(data) ? data
    : (Array.isArray(data.items) ? data.items
      : (Array.isArray(data.results) ? data.results : []));

  const normalized = arr.map(normalizeItem);

  $('count').textContent = `Найдено: ${normalized.length}`;
  setStatus('готов');

  renderRows(normalized);

  if (showRaw) {
    $('rawBox').classList.remove('hidden');
    $('raw').textContent = JSON.stringify(data, null, 2);
  } else {
    $('rawBox').classList.add('hidden');
    $('raw').textContent = '';
  }
}

function clearAll() {
  $('q').value = '';
  $('count').textContent = '';
  setHint('');
  setStatus('готов');
  $('rows').innerHTML = `<tr><td colspan="5" class="empty">Введите запрос и нажмите “Искать”</td></tr>`;
  $('rawBox').classList.add('hidden');
  $('raw').textContent = '';
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    setHint('Скопировано ✅');
    setTimeout(() => setHint(''), 900);
  } catch {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    setHint('Скопировано ✅');
    setTimeout(() => setHint(''), 900);
  }
}

function wire() {
  $('btnSearch').addEventListener('click', search);
  $('btnClear').addEventListener('click', clearAll);

  $('showRaw').addEventListener('change', () => {
    if ($('showRaw').checked) search();
    else {
      $('rawBox').classList.add('hidden');
      $('raw').textContent = '';
    }
  });

  $('btnCopyRaw').addEventListener('click', () => copyText($('raw').textContent || ''));

  $('q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') search();
    if (e.key === 'Escape') clearAll();
  });
}

wire();

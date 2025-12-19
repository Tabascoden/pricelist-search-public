// static/tenders_demo.js
(() => {
  const LS_PROJECTS = "tenders_demo_projects_v1";

  const nowISO = () => new Date().toISOString();

  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const fmtNum = (v, digits = 4) => {
    if (v === null || v === undefined || v === "") return "";
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(n);
  };

  // ---------------- Storage helpers ----------------
  function loadProjects() {
    const raw = localStorage.getItem(LS_PROJECTS);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    // seed
    const seed = [
      { id: 22, title: "Закупка (демо)", created_at: nowISO() },
      { id: 23, title: "Тендер на неделю", created_at: nowISO() },
    ];
    localStorage.setItem(LS_PROJECTS, JSON.stringify(seed));
    return seed;
  }

  function saveProjects(projects) {
    localStorage.setItem(LS_PROJECTS, JSON.stringify(projects));
  }

  function itemsKey(projectId) {
    return `tenders_demo_items_${projectId}_v1`;
  }

  function loadItems(projectId) {
    const raw = localStorage.getItem(itemsKey(projectId));
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    // seed items for that project
    const seed = [
      {
        id: 1,
        row_no: 1,
        name: "Томаты свежие",
        qty: 10,
        unit: "кг",
        baseline: null,
        alternatives: [],
      },
      {
        id: 2,
        row_no: 2,
        name: "Сыр сулугуни",
        qty: 5,
        unit: "кг",
        baseline: null,
        alternatives: [],
      },
      {
        id: 3,
        row_no: 3,
        name: "Лук репчатый",
        qty: 8,
        unit: "кг",
        baseline: null,
        alternatives: [],
      },
    ];
    localStorage.setItem(itemsKey(projectId), JSON.stringify(seed));
    return seed;
  }

  function saveItems(projectId, items) {
    localStorage.setItem(itemsKey(projectId), JSON.stringify(items));
  }

  // ---------------- Demo data generation ----------------
  const SUPPLIERS = ["Поставщик А", "Поставщик Б", "Поставщик В", "Поставщик Г"];
  const PRODUCT_BANK = [
    "Помидоры сливовидные",
    "Томаты тепличные",
    "Томатная паста (не подходит)",
    "Сулугуни 45%",
    "Сулугуни копченый",
    "Лук репчатый",
    "Лук красный",
    "Томаты черри",
    "Сыр моцарелла (альтернатива)",
    "Томаты консервированные (не подходит)",
  ];

  function pseudoScore(query, name) {
    const q = String(query || "").toLowerCase();
    const n = String(name || "").toLowerCase();
    if (!q) return 0.32;
    if (n.includes(q.split(" ")[0])) return 0.68;
    // простая эвристика
    const common = q.split(" ").filter((t) => t && n.includes(t)).length;
    return Math.min(0.85, 0.22 + common * 0.18);
  }

  function genCandidates(query, count = 10) {
    const res = [];
    for (let i = 0; i < count; i++) {
      const supplier = SUPPLIERS[i % SUPPLIERS.length];
      const name = PRODUCT_BANK[(i + Math.floor(Math.random() * 3)) % PRODUCT_BANK.length];
      const ppu = Math.round((80 + Math.random() * 220) * 100) / 100;
      const qty = 1;
      const price = Math.round(ppu * qty * 100) / 100;
      const score = Math.round(pseudoScore(query, name) * 100) / 100;
      res.push({
        supplier,
        item_name: name,
        price_per_unit: ppu,
        price,
        score,
      });
    }
    // сортировка: score desc, ppu asc
    res.sort((a, b) => (b.score - a.score) || (a.price_per_unit - b.price_per_unit));
    return res;
  }

  function genAutoAlternatives(sourceLabel, basisText, count = 6) {
    // делаем вид, что это “авто” подбор
    const baseQuery = `${sourceLabel}:${basisText}`;
    const arr = genCandidates(baseQuery, count).map((x) => ({ ...x, _source: sourceLabel }));
    // убираем очевидно “не подходит” только для вида
    return arr.filter((x) => !String(x.item_name).toLowerCase().includes("не подходит"));
  }

  // ---------------- List page ----------------
  function initListPage() {
    const form = document.getElementById("tender-create-form");
    const input = document.getElementById("tender-title");
    const wrap = document.getElementById("tender-projects");
    if (!form || !wrap) return;

    function render() {
      const projects = loadProjects();
      if (!projects.length) {
        wrap.innerHTML = `<div class="sub">Проектов пока нет.</div>`;
        return;
      }

      const rows = projects
        .slice()
        .sort((a, b) => (b.id - a.id))
        .map((p) => {
          const created = p.created_at ? new Date(p.created_at).toLocaleString("ru-RU") : "";
          const items = loadItems(p.id);
          const baselineCount = items.filter((it) => !!it.baseline).length;

          return `
            <tr>
              <td>${esc(p.id)}</td>
              <td>
                <div><b>${esc(p.title || "")}</b></div>
                <div class="muted">Демо: ${baselineCount}/${items.length} эталонов</div>
              </td>
              <td>${esc(created)}</td>
              <td>${esc(items.length)}</td>
              <td>
                <div class="tender-actions">
                  <a class="btn" href="/tenders/${p.id}">Открыть</a>
                  <button class="btn danger" data-action="delete" data-id="${esc(p.id)}">Удалить</button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("");

      wrap.innerHTML = `
        <div class="tableWrap">
          <table class="tender-table">
            <tr>
              <th>ID</th>
              <th>Название</th>
              <th>Создан</th>
              <th>Позиций</th>
              <th>Действия</th>
            </tr>
            ${rows}
          </table>
        </div>
      `;

      wrap.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = Number(btn.dataset.id);
          if (!Number.isFinite(id)) return;
          if (!confirm(`Удалить тендер #${id}? (Демо: удалится только в браузере)`)) return;

          const projects = loadProjects().filter((x) => x.id !== id);
          saveProjects(projects);
          localStorage.removeItem(itemsKey(id));
          render();
        });
      });
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const title = (input?.value || "").trim() || "Тендер";
      const projects = loadProjects();
      const maxId = projects.reduce((m, x) => Math.max(m, x.id), 0);
      const id = maxId + 1;

      projects.push({ id, title, created_at: nowISO() });
      saveProjects(projects);

      // пустые items для нового проекта
      saveItems(id, []);
      window.location.href = `/tenders/${id}`;
    });

    render();
  }

  // ---------------- Project page ----------------
  function initProjectPage() {
    const root = document.getElementById("tender-project");
    const itemsWrap = document.getElementById("tender-items");
    if (!root || !itemsWrap) return;

    const projectId = Number(root.dataset.projectId);
    if (!Number.isFinite(projectId)) return;

    // top buttons
    const btnAutopick = document.getElementById("tender-autopick");
    const btnExport = document.getElementById("tender-export");

    // modal elements
    const modal = document.getElementById("tender-modal");
    const modalClose = document.getElementById("tender-modal-close");
    const modalTitle = document.getElementById("tender-modal-title");
    const modalSubtitle = document.getElementById("tender-modal-subtitle");

    const searchInput = document.getElementById("tender-search-input");
    const searchBasis = document.getElementById("tender-search-basis");
    const basisHint = document.getElementById("tender-basis-hint");
    const btnSearch = document.getElementById("tender-search-btn");
    const btnReset = document.getElementById("tender-search-reset");

    const baselinePill = document.getElementById("tender-baseline-pill");
    const baselineBox = document.getElementById("tender-baseline-box");
    const candidatesWrap = document.getElementById("tender-candidates");
    const altsWrap = document.getElementById("tender-alternatives");
    const searchMode = document.getElementById("tender-search-mode");
    const altsMode = document.getElementById("tender-alts-mode");

    let items = loadItems(projectId);
    if (!items.length) {
      // если новый проект — заполним минимумом, чтобы было что смотреть
      items = [
        { id: 1, row_no: 1, name: "Позиция 1 (пример)", qty: 1, unit: "шт", baseline: null, alternatives: [] },
      ];
      saveItems(projectId, items);
    }

    let currentItemId = null;

    const openModal = () => modal?.classList.remove("hidden");
    const closeModal = () => modal?.classList.add("hidden");

    modalClose?.addEventListener("click", closeModal);
    modal?.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    function getItem(itemId) {
      return items.find((x) => x.id === itemId) || null;
    }

    function renderItems() {
      const rows = items
        .slice()
        .sort((a, b) => (a.row_no ?? a.id) - (b.row_no ?? b.id))
        .map((it) => {
          const hasBaseline = !!it.baseline;
          return `
            <tr>
              <td>${esc(it.row_no ?? "")}</td>
              <td><b>${esc(it.name)}</b></td>
              <td>${esc(fmtNum(it.qty, 3))}</td>
              <td>${esc(it.unit)}</td>

              <td>${hasBaseline ? esc(it.baseline.supplier) : `<span class="muted">—</span>`}</td>
              <td>${hasBaseline ? esc(it.baseline.item_name) : `<span class="muted">не выбран</span>`}</td>
              <td>${hasBaseline ? esc(fmtNum(it.baseline.price_per_unit)) : ""}</td>
              <td>${hasBaseline ? esc(fmtNum(it.baseline.score, 2)) : ""}</td>

              <td>
                ${hasBaseline ? `<span class="tag">Эталон</span>` : `<span class="muted">нет эталона</span>`}
              </td>
              <td>
                <div class="tender-row-actions">
                  <button class="btn" data-action="variants" data-id="${esc(it.id)}">Варианты</button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("");

      itemsWrap.innerHTML = `
        <div class="tableWrap">
          <table class="tender-table">
            <tr>
              <th>№</th>
              <th>Позиция закупки</th>
              <th>Кол-во</th>
              <th>Ед.</th>
              <th>Эталон: Поставщик</th>
              <th>Эталон: Товар</th>
              <th>Цена/ед</th>
              <th>Score</th>
              <th>Статус</th>
              <th></th>
            </tr>
            ${rows}
          </table>
        </div>
      `;

      itemsWrap.querySelectorAll('button[data-action="variants"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = Number(btn.dataset.id);
          if (!Number.isFinite(id)) return;
          openVariants(id);
        });
      });
    }

    function renderBaselineBox(item) {
      if (!item.baseline) {
        baselinePill.style.display = "none";
        baselineBox.innerHTML = `<div class="empty">Эталон ещё не выбран. Найдите кандидатов и нажмите “Сделать эталоном”.</div>`;
        return;
      }
      baselinePill.style.display = "inline-flex";
      const b = item.baseline;
      baselineBox.innerHTML = `
        <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
          <div>
            <div><b>${esc(b.supplier)}</b></div>
            <div>${esc(b.item_name)}</div>
            <div class="muted">Цена/ед: <b>${esc(fmtNum(b.price_per_unit))}</b> · score: ${esc(fmtNum(b.score, 2))}</div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn" id="baseline-clear">Снять эталон</button>
          </div>
        </div>
      `;
      baselineBox.querySelector("#baseline-clear")?.addEventListener("click", () => {
        item.baseline = null;
        item.alternatives = [];
        saveItems(projectId, items);
        openVariants(item.id); // re-render modal
        renderItems();
      });
    }

    function renderCandidatesTable(candidates, item) {
      if (!candidates.length) {
        candidatesWrap.innerHTML = `<div class="muted">Ничего не найдено. Попробуйте ручной поиск.</div>`;
        return;
      }
      const rows = candidates
        .map((o, idx) => {
          return `
            <tr>
              <td>${esc(o.supplier)}</td>
              <td>${esc(o.item_name)}</td>
              <td>${esc(fmtNum(o.price))}</td>
              <td><b>${esc(fmtNum(o.price_per_unit))}</b></td>
              <td>${esc(fmtNum(o.score, 2))}</td>
              <td>
                <div class="tender-row-actions">
                  <button class="btn primary" data-action="make-baseline" data-idx="${idx}">Сделать эталоном</button>
                  <button class="btn" data-action="add-alt" data-idx="${idx}">Добавить как альтернативу</button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("");

      candidatesWrap.innerHTML = `
        <div class="tableWrap">
          <table class="tender-table">
            <tr>
              <th>Поставщик</th>
              <th>Товар</th>
              <th>Цена</th>
              <th>Цена/ед</th>
              <th>Score</th>
              <th></th>
            </tr>
            ${rows}
          </table>
        </div>
      `;

      candidatesWrap.querySelectorAll('button[data-action="make-baseline"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.idx);
          const chosen = candidates[idx];
          if (!chosen) return;

          // ставим эталон
          item.baseline = {
            supplier: chosen.supplier,
            item_name: chosen.item_name,
            price_per_unit: chosen.price_per_unit,
            price: chosen.price,
            score: chosen.score,
          };

          // после выбора эталона — пересчитываем авто-альтернативы по эталону
          const basisText = `${item.baseline.supplier} / ${item.baseline.item_name}`;
          item.alternatives = genAutoAlternatives("Эталон", basisText, 6);

          saveItems(projectId, items);
          openVariants(item.id); // обновляем модалку
          renderItems(); // обновляем таблицу позиций
        });
      });

      candidatesWrap.querySelectorAll('button[data-action="add-alt"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.idx);
          const chosen = candidates[idx];
          if (!chosen) return;

          const key = `${chosen.supplier}__${chosen.item_name}`;
          const exists = (item.alternatives || []).some((a) => `${a.supplier}__${a.item_name}` === key);
          if (!exists) {
            item.alternatives = item.alternatives || [];
            item.alternatives.push({ ...chosen, _source: "Ручная добавка" });
            saveItems(projectId, items);
            renderAlternatives(item);
          }
        });
      });
    }

    function renderAlternatives(item) {
      const alts = item.alternatives || [];
      if (!alts.length) {
        altsWrap.innerHTML = `<div class="muted">Пока нет альтернатив. Они появятся после автоподбора или выбора эталона.</div>`;
        return;
      }
      const rows = alts
        .map((a) => {
          return `
            <tr>
              <td>${esc(a.supplier)}</td>
              <td>${esc(a.item_name)}</td>
              <td>${esc(fmtNum(a.price))}</td>
              <td><b>${esc(fmtNum(a.price_per_unit))}</b></td>
              <td>${esc(fmtNum(a.score, 2))}</td>
              <td class="muted">${esc(a._source || "")}</td>
            </tr>
          `;
        })
        .join("");

      altsWrap.innerHTML = `
        <div class="tableWrap">
          <table class="tender-table">
            <tr>
              <th>Поставщик</th>
              <th>Товар</th>
              <th>Цена</th>
              <th>Цена/ед</th>
              <th>Score</th>
              <th>Источник</th>
            </tr>
            ${rows}
          </table>
        </div>
      `;
    }

    function resolveBasis(item) {
      const manual = (searchInput?.value || "").trim();
      if (manual) {
        basisHint.textContent = "Используем ручной запрос.";
        return { mode: "manual", text: manual };
      }
      const basis = searchBasis?.value || "row";
      if (basis === "baseline") {
        if (!item.baseline) {
          basisHint.textContent = "Эталона нет — переключитесь на “По строке закупки”.";
          return { mode: "row", text: item.name };
        }
        basisHint.textContent = "Ищем по эталону (после выбора эталона это основной сценарий).";
        return { mode: "baseline", text: `${item.baseline.supplier} ${item.baseline.item_name}` };
      }
      basisHint.textContent = "Ищем по строке закупки (первичный подбор альтернатив).";
      return { mode: "row", text: item.name };
    }

    function openVariants(itemId) {
      currentItemId = itemId;
      const item = getItem(itemId);
      if (!item) return;

      modalTitle.textContent = `Варианты поставщиков`;
      modalSubtitle.textContent = `Позиция: ${item.row_no}. ${item.name} · ${fmtNum(item.qty, 3)} ${item.unit}`;

      // basis select: если есть эталон — по умолчанию baseline, иначе row
      if (item.baseline) {
        searchBasis.value = "baseline";
      } else {
        searchBasis.value = "row";
      }

      // baseline box
      renderBaselineBox(item);

      // candidates (по умолчанию — без ручного запроса)
      if (searchInput) searchInput.value = "";
      const basis = resolveBasis(item);

      // подписи режимов
      searchMode.textContent = basis.mode === "manual"
        ? " · режим: ручной поиск"
        : basis.mode === "baseline"
          ? " · режим: поиск по эталону"
          : " · режим: поиск по строке закупки";

      // кандидаты
      const candidates = genCandidates(basis.text, 12);
      renderCandidatesTable(candidates, item);

      // альтернативы (авто): сначала по строке, после эталона — по эталону
      if (!item.baseline) {
        item.alternatives = genAutoAlternatives("Строка", item.name, 6);
        altsMode.textContent = " · авто-альтернативы по строке закупки";
      } else {
        const basisText = `${item.baseline.supplier} / ${item.baseline.item_name}`;
        item.alternatives = genAutoAlternatives("Эталон", basisText, 6);
        altsMode.textContent = " · авто-альтернативы по эталону";
      }
      saveItems(projectId, items);
      renderAlternatives(item);

      openModal();
      modal.setAttribute("aria-hidden", "false");
    }

    // Search buttons
    btnSearch?.addEventListener("click", () => {
      const item = getItem(currentItemId);
      if (!item) return;
      const basis = resolveBasis(item);

      searchMode.textContent = basis.mode === "manual"
        ? " · режим: ручной поиск"
        : basis.mode === "baseline"
          ? " · режим: поиск по эталону"
          : " · режим: поиск по строке закупки";

      const candidates = genCandidates(basis.text, 12);
      renderCandidatesTable(candidates, item);
    });

    btnReset?.addEventListener("click", () => {
      if (searchInput) searchInput.value = "";
      const item = getItem(currentItemId);
      if (!item) return;

      // вернуть “дефолт” основы
      searchBasis.value = item.baseline ? "baseline" : "row";
      const basis = resolveBasis(item);

      searchMode.textContent = item.baseline
        ? " · режим: поиск по эталону"
        : " · режим: поиск по строке закупки";

      const candidates = genCandidates(basis.text, 12);
      renderCandidatesTable(candidates, item);
    });

    // Autopick demo
    btnAutopick?.addEventListener("click", () => {
      if (!confirm("Запустить автоподбор? (Демо: проставит эталон для строк без эталона)")) return;

      items.forEach((it) => {
        if (it.baseline) return;
        // “авто”: берём топ-кандидата по строке закупки
        const best = genCandidates(it.name, 12)[0];
        if (!best) return;

        it.baseline = {
          supplier: best.supplier,
          item_name: best.item_name,
          price_per_unit: best.price_per_unit,
          price: best.price,
          score: best.score,
        };

        // после автоподбора — авто-альтернативы по эталону
        const basisText = `${it.baseline.supplier} / ${it.baseline.item_name}`;
        it.alternatives = genAutoAlternatives("Эталон", basisText, 6);
      });

      saveItems(projectId, items);
      renderItems();
      alert("Готово (демо). Эталоны проставлены для строк без эталона.");
    });

    btnExport?.addEventListener("click", () => {
      alert("В демо экспорт не реализован. Здесь только визуализация UX/логики.");
    });

    renderItems();
  }

  document.addEventListener("DOMContentLoaded", () => {
    initListPage();
    initProjectPage();
  });
})();

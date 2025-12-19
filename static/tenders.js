async function api(url, opts = {}) {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${r.status}`);
  }
  return data;
}

// -------- /tenders list --------
document.addEventListener("DOMContentLoaded", () => {
  const btnCreate = document.getElementById("btn-create");
  if (btnCreate) {
    btnCreate.addEventListener("click", async () => {
      const title = (document.getElementById("t-title")?.value || "").trim();
      try {
        const res = await api("/api/tenders", {
          method: "POST",
          body: JSON.stringify({ title }),
        });
        window.location.href = `/tenders/${res.project.id}`;
      } catch (e) {
        alert(e.message);
      }
    });
  }

  // -------- project page handlers --------
  const btnUpload = document.getElementById("btn-upload");
  if (btnUpload) {
    btnUpload.addEventListener("click", async () => {
      const pid = btnUpload.dataset.project;
      const fileInput = document.getElementById("file");
      const status = document.getElementById("upload-status");
      const f = fileInput?.files?.[0];
      if (!f) return alert("Выберите файл .xlsx");

      const form = new FormData();
      form.append("file", f);

      status.textContent = "Загрузка...";
      try {
        const r = await fetch(`/api/tenders/${pid}/upload`, { method: "POST", body: form });
        const data = await r.json();
        if (!r.ok || data.ok === false) throw new Error(data.error || "Ошибка загрузки");
        status.textContent = `Загружено строк: ${data.inserted}. Обновляю...`;
        window.location.reload();
      } catch (e) {
        status.textContent = "";
        alert(e.message);
      }
    });
  }

  const btnAutopick = document.getElementById("btn-autopick");
  if (btnAutopick) {
    btnAutopick.addEventListener("click", async () => {
      const pid = btnAutopick.dataset.project;
      btnAutopick.disabled = true;
      btnAutopick.textContent = "Автоподбор...";
      try {
        const res = await api(`/api/tenders/${pid}/autopick`, { method: "POST" });
        alert(`Выбрано строк: ${res.selected} из ${res.items}`);
        window.location.reload();
      } catch (e) {
        alert(e.message);
      } finally {
        btnAutopick.disabled = false;
        btnAutopick.textContent = "Автоподбор лучших по всем строкам";
      }
    });
  }

  const btnExport = document.getElementById("btn-export");
  if (btnExport) {
    btnExport.addEventListener("click", async () => {
      const pid = btnExport.dataset.project;
      btnExport.disabled = true;
      btnExport.textContent = "Готовлю XLSX...";
      try {
        const r = await fetch(`/api/tenders/${pid}/export`);
        if (!r.ok) throw new Error("Ошибка выгрузки");
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `tender_${pid}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        alert(e.message);
      } finally {
        btnExport.disabled = false;
        btnExport.textContent = "Экспорт XLSX";
      }
    });
  }

  // offers modal
  const modal = document.getElementById("offers-modal");
  const modalClose = document.getElementById("modal-close");
  const offersBody = document.getElementById("offers-body");
  const offersTitle = document.getElementById("offers-title");

  function openModal() { modal?.classList.remove("hidden"); }
  function closeModal() { modal?.classList.add("hidden"); }

  modalClose?.addEventListener("click", closeModal);
  modal?.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  document.querySelectorAll(".btn-offers").forEach(btn => {
    btn.addEventListener("click", async () => {
      const pid = btn.dataset.project;
      const itemId = btn.dataset.item;
      const tr = document.querySelector(`tr[data-item="${itemId}"]`);
      const itemName = tr?.children?.[1]?.textContent || "";

      offersTitle.textContent = itemName;
      offersBody.innerHTML = "Загрузка вариантов...";
      openModal();

      try {
        const res = await api(`/api/tenders/${pid}/items/${itemId}/offers?limit=30`);
        const offers = res.offers || [];
        if (!offers.length) {
          offersBody.innerHTML = "<div class='muted'>Нет подходящих вариантов. Проверьте импорт прайсов/нормализацию.</div>";
          return;
        }

        offersBody.innerHTML = `
          <table class="table">
            <thead>
              <tr>
                <th>Поставщик</th>
                <th>Товар</th>
                <th>Цена</th>
                <th>Цена/баз.ед</th>
                <th>Score</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${offers.map(o => `
                <tr>
                  <td>${o.supplier_name}</td>
                  <td>${o.item_name}</td>
                  <td>${o.price ?? ""}</td>
                  <td><b>${o.price_per_unit ?? ""}</b></td>
                  <td class="muted">${(o.score ?? 0).toFixed(2)}</td>
                  <td><button class="btn btn-ghost pick" data-sid="${o.supplier_item_id}">Выбрать</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `;

        offersBody.querySelectorAll(".pick").forEach(pickBtn => {
          pickBtn.addEventListener("click", async () => {
            const sid = pickBtn.dataset.sid;
            try {
              const sel = await api(`/api/tenders/${pid}/items/${itemId}/select`, {
                method: "POST",
                body: JSON.stringify({ supplier_item_id: sid }),
              });

              // обновить строку таблицы без reload
              const chosen = tr.querySelector(".chosen");
              chosen.textContent = `${sel.selected.supplier_name} · ${sel.selected.item_name} · ${sel.selected.price_per_unit} / баз. ед (score ${Number(sel.selected.score).toFixed(2)})`;
              closeModal();
            } catch (e) {
              alert(e.message);
            }
          });
        });

      } catch (e) {
        offersBody.innerHTML = "";
        alert(e.message);
      }
    });
  });
});

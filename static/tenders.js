(function(){
  function formatDate(val){
    try{ return new Date(val).toLocaleString('ru-RU'); }catch(e){ return val || ''; }
  }
  function formatNum(val){
    if(val === null || val === undefined || val === '') return '';
    const num = Number(val);
    if(Number.isNaN(num)) return val;
    return num.toLocaleString('ru-RU');
  }
  function qs(sel){ return document.querySelector(sel); }

  async function loadProjects(){
    const wrap = qs('#tender-projects');
    if(!wrap) return;
    wrap.innerHTML = 'Загрузка...';
    try {
      const resp = await fetch('/api/tenders');
      const data = await resp.json();
      const items = data.projects || [];
      if(!items.length){ wrap.innerHTML = '<div class="sub">Проектов пока нет.</div>'; return; }
      let html = '<div class="tableWrap"><table><tr><th>ID</th><th>Название</th><th>Создан</th><th>Позиций</th><th></th></tr>';
      for(const p of items){
        html += `<tr><td>${p.id}</td><td>${p.title||''}</td><td>${formatDate(p.created_at)}</td><td>${p.items_count||0}</td><td><a class="btn" href="/tenders/${p.id}">Открыть</a></td></tr>`;
      }
      html += '</table></div>';
      wrap.innerHTML = html;
    } catch(err){
      wrap.innerHTML = `<div class="sub">Ошибка загрузки: ${err}</div>`;
    }
  }

  async function createProject(e){
    e.preventDefault();
    const inp = qs('#tender-title');
    const title = inp ? inp.value.trim() : '';
    try{
      const resp = await fetch('/api/tenders', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({title})
      });
      const data = await resp.json();
      if(!resp.ok || !data.ok){
        alert(data.error || 'Ошибка создания проекта');
        return;
      }
      if(data.project){ window.location = `/tenders/${data.project.id}`; }
    }catch(err){
      alert('Ошибка создания: ' + err);
    }
  }

  async function loadProject(){
    const holder = qs('#tender-project');
    if(!holder) return;
    const projectId = holder.dataset.projectId;
    const wrap = qs('#tender-items');
    wrap.innerHTML = 'Загрузка...';
    try{
      const resp = await fetch(`/api/tenders/${projectId}`);
      const data = await resp.json();
      if(!resp.ok || !data.ok){ wrap.innerHTML = data.error || 'Ошибка'; return; }
      renderProject(data.project);
    }catch(err){
      wrap.innerHTML = 'Ошибка загрузки: ' + err;
    }
  }

  function renderProject(project){
    const wrap = qs('#tender-items');
    if(!wrap) return;
    const items = project.items || [];
    if(!items.length){
      wrap.innerHTML = '<div class="sub">Загрузите XLSX с позициями.</div>';
      return;
    }
    let html = '<div class="tender-row tender-head"><div>Позиция</div><div>Кол-во</div><div>Ед.</div><div>Выбранное предложение</div><div></div></div>';
    for(const item of items){
      const offer = item.supplier_name ? item : null;
      const selectedText = offer ? `
        <div class="tender-offer">
          <strong>${offer.supplier_name||''}</strong>
          <div>${offer.item_name||''}</div>
          <div>Цена/ед.: ${formatNum(offer.price_per_unit)}${offer.base_unit ? ' / ' + offer.base_unit : ''}</div>
          <div>Score: ${Number(offer.score ?? 0).toFixed(2)}</div>
          <div class="tender-tag">${offer.chosen_at ? 'Выбрано' : 'Авто'}</div>
        </div>` : '<div class="sub">Пока не выбрано</div>';
      const qtyText = item.qty != null ? formatNum(item.qty) : '';
      html += `<div class="tender-row" data-item-id="${item.id}">
        <div>${item.name_raw || item.name_input || ''}</div>
        <div>${qtyText}</div>
        <div>${item.unit_raw || item.unit_input || ''}</div>
        <div>${selectedText}</div>
        <div><button class="btn" data-action="offers" data-item="${item.id}" data-name="${(item.name_raw||item.name_input||'').replace(/"/g,'&quot;')}">Подобрать</button></div>
      </div>`;
    }
    wrap.innerHTML = html;
  }

  async function uploadXlsx(){
    const fileInput = qs('#tender-upload');
    if(!fileInput || !fileInput.files.length){ alert('Выберите XLSX'); return; }
    const projectId = qs('#tender-project').dataset.projectId;
    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    try{
      const resp = await fetch(`/api/tenders/${projectId}/upload`, {method:'POST', body: fd});
      const data = await resp.json();
      if(!resp.ok || !data.ok){
        alert(data.error || 'Ошибка загрузки');
        return;
      }
      loadProject();
    }catch(err){ alert('Ошибка: ' + err); }
  }

  async function autopick(){
    const projectId = qs('#tender-project').dataset.projectId;
    try{
      const resp = await fetch(`/api/tenders/${projectId}/autopick`, {method:'POST'});
      const data = await resp.json();
      if(!resp.ok || !data.ok){ alert(data.error || 'Ошибка автоподбора'); return; }
      loadProject();
    }catch(err){ alert('Ошибка автоподбора: ' + err); }
  }

  function exportFile(){
    const holder = qs('#tender-project');
    if(!holder) return;
    const projectId = holder.dataset.projectId;
    window.location = `/api/tenders/${projectId}/export`;
  }

  function closeModal(){
    const modal = qs('#tender-modal');
    if(modal) modal.classList.add('hidden');
  }

  async function openOffers(itemId, name){
    const modal = qs('#tender-modal');
    const title = qs('#tender-modal-title');
    const content = qs('#tender-modal-content');
    const projectId = qs('#tender-project').dataset.projectId;
    if(title) title.textContent = 'Предложения: ' + (name||'');
    content.innerHTML = 'Загрузка...';
    modal.classList.remove('hidden');
    try{
      const resp = await fetch(`/api/tenders/${projectId}/items/${itemId}/offers?limit=30`);
      const data = await resp.json();
      if(!resp.ok || !data.ok){ content.innerHTML = data.error || 'Ошибка'; return; }
      const offers = data.offers || [];
      if(!offers.length){ content.innerHTML = '<div class="sub">Нет предложений</div>'; return; }
      let html = '<table class="tender-offers-table"><tr><th>Поставщик</th><th>Товар</th><th>Цена/ед.</th><th>Score</th><th></th></tr>';
      for(const o of offers){
        html += `<tr><td>${o.supplier_name||''}</td><td>${o.item_name||''}</td><td>${formatNum(o.price_per_unit)}${o.base_unit? ' / '+o.base_unit:''}</td><td>${Number(o.score ?? 0).toFixed(2)}</td><td><button class="btn" data-action="select-offer" data-item="${itemId}" data-supplier-item="${o.supplier_item_id}">Выбрать</button></td></tr>`;
      }
      html += '</table>';
      content.innerHTML = html;
    }catch(err){ content.innerHTML = 'Ошибка загрузки: ' + err; }
  }

  async function selectOffer(itemId, supplierItemId){
    const projectId = qs('#tender-project').dataset.projectId;
    try{
      const resp = await fetch(`/api/tenders/${projectId}/items/${itemId}/select`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({supplier_item_id: supplierItemId})
      });
      const data = await resp.json();
      if(!resp.ok || !data.ok){ alert(data.error || 'Ошибка выбора'); return; }
      closeModal();
      loadProject();
    }catch(err){ alert('Ошибка выбора: ' + err); }
  }

  document.addEventListener('click', (e)=>{
    const target = e.target;
    if(target.matches('#tender-upload-btn')){ uploadXlsx(); }
    if(target.matches('#tender-autopick')){ autopick(); }
    if(target.matches('#tender-export')){ exportFile(); }
    if(target.matches('#tender-modal-close')){ closeModal(); }
    if(target.dataset && target.dataset.action === 'offers'){
      openOffers(target.dataset.item, target.dataset.name || '');
    }
    if(target.dataset && target.dataset.action === 'select-offer'){
      selectOffer(target.dataset.item, target.dataset.supplierItem);
    }
  });

  if(window.tenderPage){
    const form = qs('#tender-create-form');
    if(form) form.addEventListener('submit', createProject);
    loadProjects();
  }

  if(window.tenderProjectPage){
    const upload = qs('#tender-upload');
    if(upload){ upload.addEventListener('change', ()=>{}); }
    loadProject();
  }
})();

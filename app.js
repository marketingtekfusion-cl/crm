// ============================================================
// CONFIG — actualizar estos 3 valores según tu deployment
// ============================================================
const CONFIG = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzRK6jd2ZYUmUL2_qqbmvwspeX_J01IPoUnx25oQTpD1qghr4tn8fTBZ8LVKk_9NhFF/exec',
  DASHBOARD_PASSWORD: 'tekfusion2026',
  // Debe coincidir EXACTO con CONFIG.WRITE_TOKEN en Code.gs
  WRITE_TOKEN: 'tekfusion2026'
};

const ESTADOS = ['Nuevo', 'Contactado', 'Cotizado', 'Ganado', 'Perdido'];

const state = {
  rows: [],
  filteredEstado: '',
  searchTerm: '',
  charts: {}
};

// ============================================================
// LOCK SCREEN — usa style.display directo (no [hidden]) para
// evitar que una regla CSS con ID le gane en especificidad.
// ============================================================
function initLock() {
  const lockScreen = document.getElementById('lockScreen');
  const app = document.getElementById('app');
  const input = document.getElementById('lockInput');
  const btn = document.getElementById('lockBtn');
  const error = document.getElementById('lockError');

  error.style.display = 'none';

  function tryUnlock() {
    if (input.value === CONFIG.DASHBOARD_PASSWORD) {
      lockScreen.style.display = 'none';
      app.style.display = 'block';
      boot();
    } else {
      error.style.display = 'block';
    }
  }

  btn.addEventListener('click', tryUnlock);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
}

// ============================================================
// NAV — activar botones ANTES de intentar dibujar nada, así
// la navegación nunca queda bloqueada por un error de render.
// ============================================================
function initNav() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
    });
  });

  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('detailModal').addEventListener('click', e => {
    if (e.target.id === 'detailModal') closeModal();
  });
  document.getElementById('printBtn').addEventListener('click', () => window.print());

  document.getElementById('crmSearch').addEventListener('input', e => {
    state.searchTerm = e.target.value.toLowerCase();
    safeRender(renderCrmAccordion);
  });
  document.getElementById('crmFilterEstado').addEventListener('change', e => {
    state.filteredEstado = e.target.value;
    safeRender(renderCrmAccordion);
  });
}

// ============================================================
// BOOT
// ============================================================
async function boot() {
  try {
    const res = await fetch(CONFIG.APPS_SCRIPT_URL);
    const data = await res.json();
    if (!data.ok) throw new Error('Respuesta inválida del backend');
    state.rows = data.rows;
    document.getElementById('lastUpdated').textContent =
      'Actualizado ' + new Date(data.generatedAt).toLocaleString('es-CL');
  } catch (err) {
    document.getElementById('lastUpdated').textContent = 'Error al cargar datos';
    console.error(err);
  }

  safeRender(renderKPIs);
  safeRender(renderPipelineChart);
  safeRender(renderProductoChart);
  safeRender(renderTendenciaChart);
  safeRender(renderCrmAccordion);
  safeRender(renderProximos);
  safeRender(renderInforme);
}

function safeRender(fn) {
  try { fn(); } catch (err) { console.error('Error en ' + fn.name, err); }
}

// ============================================================
// HELPERS
// ============================================================
function pct(part, total) {
  if (!total) return '0%';
  return Math.round((part / total) * 100) + '%';
}

function bucketProducto(motivo) {
  const m = (motivo || '').toLowerCase();
  if (m.includes('hdpe') || m.includes('tuber')) return 'Tuberías HDPE';
  if (m.includes('asahi') || m.includes('válvula') || m.includes('valvula')) return 'Válvulas ASAHI';
  if (m.includes('geocelda') || m.includes('tekcell') || m.includes('geosint')) return 'Geoceldas / Tekcell';
  return 'Otros';
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return String(dateStr);
  return d.toLocaleDateString('es-CL');
}

function toDateInputValue(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  return d.toISOString().slice(0, 10);
}

// ============================================================
// KPIs
// ============================================================
function renderKPIs() {
  const rows = state.rows;
  const total = rows.length;

  const now = new Date();
  const esteMes = rows.filter(r => {
    const d = new Date(r['date']);
    return !isNaN(d) && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const cerrados = rows.filter(r => r['Estado'] === 'Ganado' || r['Estado'] === 'Perdido').length;
  const ganados = rows.filter(r => r['Estado'] === 'Ganado').length;

  const vencidos = rows.filter(r => isOverdue(r['Fecha próximo contacto']) && r['Estado'] !== 'Ganado' && r['Estado'] !== 'Perdido').length;

  document.getElementById('kpiTotal').textContent = total;
  document.getElementById('kpiMes').textContent = esteMes;
  document.getElementById('kpiCierre').textContent = pct(ganados, cerrados);
  document.getElementById('kpiVencidos').textContent = vencidos;
}

// ============================================================
// CHARTS
// ============================================================
function renderPipelineChart() {
  const counts = ESTADOS.map(e => state.rows.filter(r => r['Estado'] === e).length);
  const ctx = document.getElementById('chartPipeline');
  if (state.charts.pipeline) state.charts.pipeline.destroy();
  state.charts.pipeline = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ESTADOS,
      datasets: [{
        data: counts,
        backgroundColor: ['#1F4E5F', '#3C7E92', '#F2A900', '#2F8F5B', '#C23B22'],
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

function renderProductoChart() {
  const buckets = {};
  state.rows.forEach(r => {
    const b = bucketProducto(r['Motivo consulta']);
    buckets[b] = (buckets[b] || 0) + 1;
  });
  const ctx = document.getElementById('chartProducto');
  if (state.charts.producto) state.charts.producto.destroy();
  state.charts.producto = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(buckets),
      datasets: [{
        data: Object.values(buckets),
        backgroundColor: ['#1F4E5F', '#F2A900', '#2F8F5B', '#9AA9AD']
      }]
    },
    options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } } }
  });
}

function renderTendenciaChart() {
  const weekMap = {};
  state.rows.forEach(r => {
    const d = new Date(r['date']);
    if (isNaN(d)) return;
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    weekMap[key] = (weekMap[key] || 0) + 1;
  });
  const keys = Object.keys(weekMap).sort();
  const ctx = document.getElementById('chartTendencia');
  if (state.charts.tendencia) state.charts.tendencia.destroy();
  state.charts.tendencia = new Chart(ctx, {
    type: 'line',
    data: {
      labels: keys.map(k => fmtDate(k)),
      datasets: [{
        data: keys.map(k => weekMap[k]),
        borderColor: '#1F4E5F',
        backgroundColor: 'rgba(31,78,95,.08)',
        fill: true,
        tension: .3,
        pointRadius: 2
      }]
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });
}

// ============================================================
// CRM — acordeón editable, agrupado por Estado
// ============================================================
function matchesFilters(r) {
  if (state.filteredEstado && r['Estado'] !== state.filteredEstado) return false;
  if (state.searchTerm) {
    const haystack = [r['Nombre'], r['Empresa'], r['Motivo consulta']].join(' ').toLowerCase();
    if (!haystack.includes(state.searchTerm)) return false;
  }
  return true;
}

function renderCrmAccordion() {
  const container = document.getElementById('crmAccordion');
  container.innerHTML = '';

  ESTADOS.forEach(estado => {
    const group = state.rows.filter(r => (r['Estado'] || 'Nuevo') === estado).filter(matchesFilters);
    if (group.length === 0 && state.filteredEstado && state.filteredEstado !== estado) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'accordion-group';

    const header = document.createElement('div');
    header.className = 'accordion-header';
    header.innerHTML = `<span><span class="badge badge-${estado}">${estado}</span></span><span class="count">${group.length} lead${group.length === 1 ? '' : 's'}<span class="chev">▸</span></span>`;
    header.addEventListener('click', () => groupEl.classList.toggle('open'));

    const body = document.createElement('div');
    body.className = 'accordion-body';

    if (group.length === 0) {
      body.innerHTML = '<p class="view-intro" style="padding:14px 18px;">Sin leads en este estado.</p>';
    } else {
      group.slice(0, 200).forEach(r => body.appendChild(renderLeadRow(r)));
    }

    groupEl.appendChild(header);
    groupEl.appendChild(body);
    container.appendChild(groupEl);
  });
}

function renderLeadRow(r) {
  const row = document.createElement('div');
  row.className = 'lead-row';

  const estadoSelect = document.createElement('select');
  ESTADOS.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e; opt.textContent = e;
    if ((r['Estado'] || 'Nuevo') === e) opt.selected = true;
    estadoSelect.appendChild(opt);
  });
  estadoSelect.addEventListener('change', () => {
    saveField(r, 'Estado', estadoSelect.value, row);
  });

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = toDateInputValue(r['Fecha próximo contacto']);
  dateInput.addEventListener('change', () => {
    saveField(r, 'Fecha próximo contacto', dateInput.value, row);
  });

  const detailBtn = document.createElement('button');
  detailBtn.className = 'btn-detail';
  detailBtn.textContent = 'Ver detalle';
  detailBtn.addEventListener('click', () => openModal(r));

  row.innerHTML = `
    <div><div class="name">${escapeHtml(r['Nombre'] || 'Sin nombre')}</div><div class="company">${escapeHtml(r['Empresa'] || '')}</div></div>
    <div>${escapeHtml((r['Motivo consulta'] || '').slice(0, 60))}${(r['Motivo consulta'] || '').length > 60 ? '…' : ''}</div>
    <div></div>
    <div></div>
  `;
  row.children[2].appendChild(estadoSelect);
  row.children[3].appendChild(dateInput);
  row.appendChild(detailBtn);

  return row;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================
// PRÓXIMOS CONTACTOS
// ============================================================
function renderProximos() {
  const container = document.getElementById('proximosList');
  container.innerHTML = '';

  const rows = state.rows
    .filter(r => r['Fecha próximo contacto'])
    .filter(r => r['Estado'] !== 'Ganado' && r['Estado'] !== 'Perdido')
    .sort((a, b) => new Date(a['Fecha próximo contacto']) - new Date(b['Fecha próximo contacto']));

  if (rows.length === 0) {
    container.innerHTML = '<p class="view-intro">No hay contactos agendados todavía.</p>';
    return;
  }

  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'lead-row';
    const overdue = isOverdue(r['Fecha próximo contacto']);
    row.innerHTML = `
      <div><div class="name">${escapeHtml(r['Nombre'] || 'Sin nombre')}</div><div class="company">${escapeHtml(r['Empresa'] || '')}</div></div>
      <div>${escapeHtml((r['Motivo consulta'] || '').slice(0, 60))}</div>
      <div class="${overdue ? 'overdue' : ''}">${overdue ? '⚠ Vencido: ' : ''}${fmtDate(r['Fecha próximo contacto'])}</div>
      <div><span class="badge badge-${r['Estado'] || 'Nuevo'}">${r['Estado'] || 'Nuevo'}</span></div>
    `;
    const btn = document.createElement('button');
    btn.className = 'btn-detail';
    btn.textContent = 'Ver detalle';
    btn.addEventListener('click', () => openModal(r));
    row.appendChild(btn);
    container.appendChild(row);
  });
}

// ============================================================
// INFORMES (imprimible)
// ============================================================
function renderInforme() {
  const container = document.getElementById('informeContent');
  const total = state.rows.length;
  const rowsHtml = ESTADOS.map(e => {
    const n = state.rows.filter(r => r['Estado'] === e).length;
    return `<tr><td>${e}</td><td>${n}</td><td>${pct(n, total)}</td></tr>`;
  }).join('');

  container.innerHTML = `
    <table style="width:100%; border-collapse:collapse; margin-top:16px;">
      <thead><tr><th style="text-align:left; padding:8px 0; border-bottom:1px solid #D6DFE1;">Etapa</th><th style="text-align:left; padding:8px 0; border-bottom:1px solid #D6DFE1;">Leads</th><th style="text-align:left; padding:8px 0; border-bottom:1px solid #D6DFE1;">% del total</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <p style="margin-top:16px; color:#62767D; font-size:12px;">Generado ${new Date().toLocaleString('es-CL')} · ${total} leads totales</p>
  `;
}

// ============================================================
// MODAL — detalle y edición completa
// ============================================================
let modalRow = null;
const MODAL_FIELDS = [
  { key: 'Nombre', editable: true },
  { key: 'Empresa', editable: true },
  { key: 'Correo electrónico', editable: true },
  { key: 'Teléfono', editable: true },
  { key: 'Motivo consulta', editable: false },
  { key: 'Comentario o mensaje', editable: false, textarea: true },
  { key: 'Motivo pérdida (solo si corresponde)', editable: true },
  { key: 'Detalle pérdida', editable: true, textarea: true }
];

function openModal(row) {
  modalRow = row;
  const body = document.getElementById('modalBody');
  body.innerHTML = '';

  MODAL_FIELDS.forEach(f => {
    const wrap = document.createElement('div');
    wrap.className = 'field-row' + (f.editable ? '' : ' readonly');
    const label = document.createElement('label');
    label.textContent = f.key;
    const input = document.createElement(f.textarea ? 'textarea' : 'input');
    input.value = row[f.key] || '';
    input.dataset.field = f.key;
    if (!f.editable) input.readOnly = true;
    wrap.appendChild(label);
    wrap.appendChild(input);
    body.appendChild(wrap);
  });

  document.getElementById('modalStatus').textContent = '';
  document.getElementById('detailModal').classList.add('open');
}

function closeModal() {
  document.getElementById('detailModal').classList.remove('open');
  modalRow = null;
}

document.addEventListener('DOMContentLoaded', () => {
  initLock();
  initNav();

  document.getElementById('modalSave').addEventListener('click', async () => {
    if (!modalRow) return;
    const status = document.getElementById('modalStatus');
    status.textContent = 'Guardando…';

    const inputs = document.querySelectorAll('#modalBody [data-field]');
    let allOk = true;
    for (const input of inputs) {
      if (input.readOnly) continue;
      const field = input.dataset.field;
      if (input.value === (modalRow[field] || '')) continue; // sin cambios
      const ok = await saveField(modalRow, field, input.value, null);
      if (!ok) allOk = false;
    }
    status.textContent = allOk ? 'Guardado ✓' : 'Hubo un error al guardar algunos campos';
    if (allOk) {
      safeRender(renderCrmAccordion);
      safeRender(renderProximos);
      setTimeout(closeModal, 700);
    }
  });
});

// ============================================================
// GUARDAR CAMBIO — POST al Apps Script
// ============================================================
async function saveField(row, field, value, rowEl) {
  try {
    const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({
        token: CONFIG.WRITE_TOKEN,
        row: row._row,
        field: field,
        value: value,
        expectedEmail: row['Correo electrónico']
      })
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('Error al guardar', data.error);
      if (rowEl) rowEl.style.outline = '2px solid #C23B22';
      if (data.error === 'row_changed') {
        alert('Esta fila cambió en el Sheet desde que se cargó el dashboard. Recarga la página antes de seguir editando.');
      }
      return false;
    }
    row[field] = value; // reflejar en memoria
    if (field === 'Estado') safeRender(renderKPIs);
    return true;
  } catch (err) {
    console.error(err);
    if (rowEl) rowEl.style.outline = '2px solid #C23B22';
    return false;
  }
}

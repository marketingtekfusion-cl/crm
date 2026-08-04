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
const RESPONSABLES = ['Anita', 'Tere', 'Cristián', 'Alejandro', 'Ricardo', 'Igor'];
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
const ARCHIVE_AFTER_DAYS = 14; // días como "Nuevo" sin contactar antes de archivarse

const state = {
  rows: [],
  filteredEstado: '',
  searchTerm: '',
  charts: {},
  knownEmails: new Set(), // para detectar leads nuevos entre refrescos
  openGroups: new Set(), // qué grupos del acordeón del CRM están expandidos
  highlightEmails: null, // set de emails a mostrar en exclusiva (venidos del aviso de leads nuevos)
  sortOrder: 'asc', // 'asc' = más antiguo primero, 'desc' = más nuevo primero
  openArchiveMonths: new Set(),
  undoStack: [],
  resumenRange: { type: 'todos', from: null, to: null }
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

  document.getElementById('sortToggle').addEventListener('click', () => {
    state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
    const btn = document.getElementById('sortToggle');
    btn.textContent = state.sortOrder === 'asc'
      ? 'Fecha ingreso: más antiguo primero ↓'
      : 'Fecha ingreso: más nuevo primero ↑';
    safeRender(renderCrmAccordion);
  });

  document.getElementById('resumenRango').addEventListener('change', e => {
    const custom = e.target.value === 'custom';
    document.getElementById('resumenDesde').style.display = custom ? 'inline-block' : 'none';
    document.getElementById('resumenHastaLabel').style.display = custom ? 'inline' : 'none';
    document.getElementById('resumenHasta').style.display = custom ? 'inline-block' : 'none';
    state.resumenRange.type = e.target.value;
    renderResumen();
  });
  document.getElementById('resumenDesde').addEventListener('change', e => {
    state.resumenRange.from = e.target.value;
    renderResumen();
  });
  document.getElementById('resumenHasta').addEventListener('change', e => {
    state.resumenRange.to = e.target.value;
    renderResumen();
  });
}

function renderResumen() {
  safeRender(renderPipelineChart);
  safeRender(renderProductoChart);
  safeRender(renderTendenciaChart);
  safeRender(renderLineaEstadoChart);
}

function getResumenRows() {
  const range = state.resumenRange;
  if (range.type === 'todos') return state.rows;

  let from, to;
  const now = new Date();
  now.setHours(23, 59, 59, 999);

  if (range.type === 'custom') {
    from = range.from ? parseDate(range.from) : null;
    to = range.to ? endOfDay(parseDate(range.to)) : now;
  } else {
    const days = Number(range.type);
    from = new Date();
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);
    to = now;
  }

  return state.rows.filter(r => {
    const d = parseDate(r['date']);
    if (isNaN(d)) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

// ============================================================
// BOOT + AUTO-REFRESH (cada 5 min mientras el dashboard está abierto)
// ============================================================
async function boot() {
  await loadData({ isFirstLoad: true });
  renderAll();
  setInterval(() => loadData({ isFirstLoad: false }).then(renderAll), REFRESH_INTERVAL_MS);
}

async function loadData({ isFirstLoad }) {
  try {
    const res = await fetch(CONFIG.APPS_SCRIPT_URL);
    const data = await res.json();
    if (!data.ok) throw new Error('Respuesta inválida del backend');

    if (!isFirstLoad) {
      const previousEmails = state.knownEmails;
      const newRows = data.rows.filter(r => !previousEmails.has(r['Correo electrónico'] || r['_row']));
      if (newRows.length > 0) {
        showNewLeadsBanner(newRows.length, newRows.map(r => r['Correo electrónico'] || r['_row']));
      }
    }

    state.rows = data.rows;
    state.knownEmails = new Set(data.rows.map(r => r['Correo electrónico'] || r['_row']));
    document.getElementById('lastUpdated').textContent =
      'Actualizado ' + new Date(data.generatedAt).toLocaleString('es-CL');
  } catch (err) {
    document.getElementById('lastUpdated').textContent = 'Error al cargar datos';
    console.error(err);
  }
}

function renderAll() {
  safeRender(renderKPIs);
  safeRender(renderPipelineChart);
  safeRender(renderProductoChart);
  safeRender(renderTendenciaChart);
  safeRender(renderLineaEstadoChart);
  safeRender(renderCrmAccordion);
  safeRender(renderProximos);
  safeRender(renderInforme);
}

function showNewLeadsBanner(count, emails) {
  const banner = document.getElementById('newLeadsBanner');
  const text = document.getElementById('newLeadsText');
  text.textContent = count === 1
    ? '📥 Llegó 1 lead nuevo desde que abriste el dashboard. Clic para verlo →'
    : `📥 Llegaron ${count} leads nuevos desde que abriste el dashboard. Clic para verlos →`;
  banner.style.display = 'flex';
  banner.dataset.emails = JSON.stringify(emails || []);
}

function goToNewLeads() {
  const banner = document.getElementById('newLeadsBanner');
  const emails = JSON.parse(banner.dataset.emails || '[]');
  if (emails.length === 0) return;

  state.highlightEmails = new Set(emails);
  state.searchTerm = '';
  state.filteredEstado = '';
  document.getElementById('crmSearch').value = '';
  document.getElementById('crmFilterEstado').value = '';

  // abrir los grupos donde están esos leads
  state.rows.forEach(r => {
    const key = r['Correo electrónico'] || r['_row'];
    if (state.highlightEmails.has(key)) state.openGroups.add(r['Estado'] || 'Nuevo');
  });

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelector('.tab-btn[data-view="crm"]').classList.add('active');
  document.getElementById('view-crm').classList.add('active');

  safeRender(renderCrmAccordion);
  banner.style.display = 'none';
  document.getElementById('highlightBanner').style.display = 'flex';

  const firstHighlighted = document.querySelector('.lead-row.highlighted');
  if (firstHighlighted) firstHighlighted.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

// Convierte valores de fecha de forma segura. Un string "YYYY-MM-DD" (como los
// que entrega un <input type="date">) JavaScript lo interpreta por defecto como
// medianoche UTC, lo que en Chile (UTC-3/-4) lo corre un día hacia atrás al
// mostrarlo. Acá lo forzamos a interpretarse en hora LOCAL para evitar ese
// desfase. Cualquier otro formato (fecha+hora ISO, objetos Date, etc.) sigue
// el comportamiento normal de JS.
function parseDate(value) {
  if (!value) return new Date(NaN);
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(value);
}

function endOfDay(d) {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}

function daysSince(dateStr) {
  const d = parseDate(dateStr);
  if (isNaN(d)) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.floor((today - d) / 86400000);
}

function isArchived(r) {
  return (r['Estado'] || 'Nuevo') === 'Nuevo' && daysSince(r['date']) > ARCHIVE_AFTER_DAYS;
}

// Estado "visible" en el dashboard: igual al Estado real del Sheet, salvo que
// sea un "Nuevo" olvidado hace más de ARCHIVE_AFTER_DAYS días, en cuyo caso
// se agrupa aparte como "Archivado" (esto es solo de vista, no toca el Sheet).
function effectiveEstado(r) {
  return isArchived(r) ? 'Archivado' : (r['Estado'] || 'Nuevo');
}

function sortByDate(rows) {
  const copy = rows.slice();
  copy.sort((a, b) => {
    const da = parseDate(a['date']), db = parseDate(b['date']);
    const diff = da - db;
    return state.sortOrder === 'desc' ? -diff : diff;
  });
  return copy;
}

function monthLabel(dateStr) {
  const d = parseDate(dateStr);
  if (isNaN(d)) return 'Sin fecha';
  const label = d.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function monthKey(dateStr) {
  const d = parseDate(dateStr);
  if (isNaN(d)) return '0000-00';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  const d = parseDate(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = parseDate(dateStr);
  if (isNaN(d)) return String(dateStr);
  return d.toLocaleDateString('es-CL');
}

function toDateInputValue(dateStr) {
  if (!dateStr) return '';
  const d = parseDate(dateStr);
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
    const d = parseDate(r['date']);
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
  const rows = getResumenRows();
  const counts = ESTADOS.map(e => rows.filter(r => r['Estado'] === e).length);
  const ctx = document.getElementById('chartPipeline');
  if (state.charts.pipeline) state.charts.pipeline.destroy();
  state.charts.pipeline = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ESTADOS,
      datasets: [{
        data: counts,
        backgroundColor: ['#044A92', '#1D6FB8', '#ED6801', '#2F8F5B', '#B3261E'],
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
  const rows = getResumenRows();
  const buckets = {};
  rows.forEach(r => {
    const b = bucketProducto(r['Motivo consulta']);
    buckets[b] = (buckets[b] || 0) + 1;
  });
  const total = rows.length;
  const ctx = document.getElementById('chartProducto');
  if (state.charts.producto) state.charts.producto.destroy();
  state.charts.producto = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(buckets),
      datasets: [{
        data: Object.values(buckets),
        backgroundColor: ['#044A92', '#ED6801', '#2F8F5B', '#9AA9AD']
      }]
    },
    options: {
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 12,
            font: { size: 11 },
            generateLabels: chart => {
              const data = chart.data;
              return data.labels.map((label, i) => {
                const value = data.datasets[0].data[i];
                return {
                  text: `${label}  ${pct(value, total)}`,
                  fillStyle: data.datasets[0].backgroundColor[i],
                  index: i
                };
              });
            }
          }
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: ${ctx.parsed} (${pct(ctx.parsed, total)})`
          }
        }
      }
    }
  });
}

function renderTendenciaChart() {
  const rows = getResumenRows();
  const weekMap = {};
  rows.forEach(r => {
    const d = parseDate(r['date']);
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
        borderColor: '#044A92',
        backgroundColor: 'rgba(4,74,146,.08)',
        fill: true,
        tension: .3,
        pointRadius: 2
      }]
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });
}

function renderLineaEstadoChart() {
  const rows = getResumenRows();
  const lineas = ['Tuberías HDPE', 'Válvulas ASAHI', 'Geoceldas / Tekcell', 'Otros'];
  const colores = { Nuevo: '#044A92', Contactado: '#1D6FB8', Cotizado: '#ED6801', Ganado: '#2F8F5B', Perdido: '#B3261E' };

  const datasets = ESTADOS.map(estado => ({
    label: estado,
    backgroundColor: colores[estado],
    data: lineas.map(linea => rows.filter(r => bucketProducto(r['Motivo consulta']) === linea && r['Estado'] === estado).length)
  }));

  const ctx = document.getElementById('chartLinea');
  if (state.charts.linea) state.charts.linea.destroy();
  state.charts.linea = new Chart(ctx, {
    type: 'bar',
    data: { labels: lineas, datasets },
    options: {
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }
      }
    }
  });
}

// ============================================================
// CRM — acordeón editable, agrupado por Estado
// ============================================================
function matchesFilters(r) {
  if (state.highlightEmails) {
    const key = r['Correo electrónico'] || r['_row'];
    return state.highlightEmails.has(key);
  }
  if (state.filteredEstado && effectiveEstado(r) !== state.filteredEstado) return false;
  if (state.searchTerm) {
    const haystack = [r['Nombre'], r['Empresa'], r['Motivo consulta']].join(' ').toLowerCase();
    if (!haystack.includes(state.searchTerm)) return false;
  }
  return true;
}

function renderCrmAccordion() {
  const container = document.getElementById('crmAccordion');
  container.innerHTML = '';

  const displayGroups = ESTADOS.concat(['Archivado']);

  displayGroups.forEach(estado => {
    const group = sortByDate(state.rows.filter(r => effectiveEstado(r) === estado).filter(matchesFilters));
    if (group.length === 0 && state.filteredEstado && state.filteredEstado !== estado) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'accordion-group';
    if (state.openGroups.has(estado)) groupEl.classList.add('open');

    const header = document.createElement('div');
    header.className = 'accordion-header';
    header.innerHTML = `<span><span class="badge badge-${estado}">${estado}</span></span><span class="count">${group.length} lead${group.length === 1 ? '' : 's'}<span class="chev">▸</span></span>`;
    header.addEventListener('click', () => {
      groupEl.classList.toggle('open');
      if (groupEl.classList.contains('open')) state.openGroups.add(estado);
      else state.openGroups.delete(estado);
    });

    const body = document.createElement('div');
    body.className = 'accordion-body';

    if (group.length === 0) {
      body.innerHTML = '<p class="view-intro" style="padding:14px 18px;">Sin leads en este estado.</p>';
    } else if (estado === 'Archivado') {
      const note = document.createElement('p');
      note.className = 'view-intro';
      note.style.padding = '14px 18px 0';
      note.textContent = `Archivado: leads que llevan más de ${ARCHIVE_AFTER_DAYS} días marcados como "Nuevo" sin haber sido contactados.`;
      body.appendChild(note);
      body.appendChild(renderArchivedByMonth(group));
    } else {
      group.forEach(r => body.appendChild(renderLeadRow(r)));
    }

    groupEl.appendChild(header);
    groupEl.appendChild(body);
    container.appendChild(groupEl);
  });
}

function renderArchivedByMonth(rows) {
  const wrap = document.createElement('div');
  wrap.className = 'archive-months';

  const byMonth = {};
  rows.forEach(r => {
    const key = monthKey(r['date']);
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(r);
  });

  const keys = Object.keys(byMonth).sort((a, b) => state.sortOrder === 'desc' ? (a < b ? 1 : -1) : (a > b ? 1 : -1));

  keys.forEach(key => {
    const monthRows = byMonth[key];
    const monthEl = document.createElement('div');
    monthEl.className = 'accordion-group month-group';
    if (state.openArchiveMonths.has(key)) monthEl.classList.add('open');

    const header = document.createElement('div');
    header.className = 'accordion-header';
    header.innerHTML = `<span>${monthLabel(monthRows[0]['date'])}</span><span class="count">${monthRows.length} lead${monthRows.length === 1 ? '' : 's'}<span class="chev">▸</span></span>`;
    header.addEventListener('click', () => {
      monthEl.classList.toggle('open');
      if (monthEl.classList.contains('open')) state.openArchiveMonths.add(key);
      else state.openArchiveMonths.delete(key);
    });

    const body = document.createElement('div');
    body.className = 'accordion-body';
    monthRows.forEach(r => body.appendChild(renderLeadRow(r)));

    monthEl.appendChild(header);
    monthEl.appendChild(body);
    wrap.appendChild(monthEl);
  });

  return wrap;
}

function renderLeadRow(r) {
  const row = document.createElement('div');
  row.className = 'lead-row';
  const key = r['Correo electrónico'] || r['_row'];
  if (state.highlightEmails && state.highlightEmails.has(key)) row.classList.add('highlighted');

  const info = document.createElement('div');
  info.className = 'lead-row-info';
  info.innerHTML = `
    <span class="name">${escapeHtml(r['Nombre'] || 'Sin nombre')}</span>
    <span class="company">${escapeHtml(r['Empresa'] || '')}</span>
    <span class="motivo">${escapeHtml(r['Motivo consulta'] || '')}</span>
    <span class="fecha-ingreso">${fmtDate(r['date'])}</span>
  `;

  const controls = document.createElement('div');
  controls.className = 'lead-row-controls';

  const respWrap = document.createElement('div');
  respWrap.innerHTML = '<span class="cell-label">Responsable</span>';
  const respSelect = document.createElement('select');
  const blankOpt = document.createElement('option');
  blankOpt.value = ''; blankOpt.textContent = 'Sin asignar';
  respSelect.appendChild(blankOpt);
  RESPONSABLES.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    if ((r['Responsable'] || '') === name) opt.selected = true;
    respSelect.appendChild(opt);
  });
  respSelect.addEventListener('change', () => saveField(r, 'Responsable', respSelect.value, row));
  respWrap.appendChild(respSelect);

  const estadoWrap = document.createElement('div');
  estadoWrap.innerHTML = '<span class="cell-label">Estado</span>';
  const estadoSelect = document.createElement('select');
  ESTADOS.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e; opt.textContent = e;
    if ((r['Estado'] || 'Nuevo') === e) opt.selected = true;
    estadoSelect.appendChild(opt);
  });
  estadoSelect.addEventListener('change', () => saveField(r, 'Estado', estadoSelect.value, row));
  estadoWrap.appendChild(estadoSelect);

  const dateWrap = document.createElement('div');
  dateWrap.innerHTML = '<span class="cell-label">Próximo contacto</span>';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = toDateInputValue(r['Fecha próximo contacto']);
  dateInput.title = 'Próxima vez que hay que contactar a este lead';
  dateInput.addEventListener('change', () => {
    const val = dateInput.value;
    if (val) {
      const m = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const year = m ? Number(m[1]) : NaN;
      if (!m || year < 2020 || year > 2100) {
        dateInput.style.outline = '2px solid #B3261E';
        return; // fecha incompleta o con año imposible: no se manda a guardar
      }
    }
    dateInput.style.outline = '';
    saveField(r, 'Fecha próximo contacto', val, row);
  });
  dateWrap.appendChild(dateInput);

  const detailBtn = document.createElement('button');
  detailBtn.className = 'btn-detail';
  detailBtn.textContent = 'Ver detalle';
  detailBtn.addEventListener('click', () => openModal(r));

  controls.appendChild(respWrap);
  controls.appendChild(estadoWrap);
  controls.appendChild(dateWrap);
  controls.appendChild(detailBtn);

  row.appendChild(info);
  row.appendChild(controls);

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
    .slice()
    .filter(r => r['Fecha próximo contacto'])
    .filter(r => r['Estado'] !== 'Ganado' && r['Estado'] !== 'Perdido')
    .sort((a, b) => parseDate(a['Fecha próximo contacto']) - parseDate(b['Fecha próximo contacto']));

  if (rows.length === 0) {
    container.innerHTML = '<p class="view-intro">No hay contactos agendados todavía.</p>';
    return;
  }

  const headerEl = document.createElement('div');
  headerEl.className = 'list-header simple-row';
  headerEl.innerHTML = '<span>Contacto</span><span>Motivo consulta</span><span>Próximo contacto</span><span>Estado</span><span></span>';
  container.appendChild(headerEl);

  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'simple-row';
    const overdue = isOverdue(r['Fecha próximo contacto']);
    row.innerHTML = `
      <div><div class="name">${escapeHtml(r['Nombre'] || 'Sin nombre')}</div><div class="company">${escapeHtml(r['Empresa'] || '')}${r['Responsable'] ? ' · <span class="responsable">' + escapeHtml(r['Responsable']) + '</span>' : ''}</div></div>
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
  { key: 'date', label: 'Fecha de ingreso', editable: false, formatDate: true },
  { key: 'Nombre', editable: true },
  { key: 'Empresa', editable: true },
  { key: 'Responsable', editable: true, select: RESPONSABLES },
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
    label.textContent = f.label || f.key;
    const input = document.createElement(f.select ? 'select' : (f.textarea ? 'textarea' : 'input'));
    if (f.select) {
      const blank = document.createElement('option');
      blank.value = ''; blank.textContent = 'Sin asignar';
      input.appendChild(blank);
      f.select.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if ((row[f.key] || '') === opt) o.selected = true;
        input.appendChild(o);
      });
    } else {
      input.value = f.formatDate ? fmtDate(row[f.key]) : (row[f.key] || '');
    }
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

  document.getElementById('newLeadsBanner').addEventListener('click', goToNewLeads);
  document.getElementById('newLeadsDismiss').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('newLeadsBanner').style.display = 'none';
  });

  document.getElementById('highlightClear').addEventListener('click', () => {
    state.highlightEmails = null;
    document.getElementById('highlightBanner').style.display = 'none';
    safeRender(renderCrmAccordion);
  });

  document.getElementById('refreshBtn').addEventListener('click', async () => {
    const btn = document.getElementById('refreshBtn');
    btn.disabled = true;
    btn.textContent = '↻ Actualizando…';
    await loadData({ isFirstLoad: false });
    renderAll();
    btn.disabled = false;
    btn.textContent = '↻ Actualizar';
  });

  document.getElementById('undoBtn').addEventListener('click', async () => {
    const action = state.undoStack.pop();
    if (!action) return;
    updateUndoButton();
    const ok = await saveField(action.row, action.field, action.oldValue, null, false);
    if (ok) {
      safeRender(renderKPIs);
      safeRender(renderCrmAccordion);
      safeRender(renderProximos);
      safeRender(renderInforme);
    } else {
      // si falló, lo devolvemos a la pila para no perder el registro
      state.undoStack.push(action);
      updateUndoButton();
    }
  });

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
async function saveField(row, field, value, rowEl, recordUndo = true) {
  const oldValue = row[field] || '';
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
      if (rowEl) rowEl.style.outline = '2px solid #B3261E';
      if (data.error === 'row_changed') {
        alert('Esta fila cambió en el Sheet desde que se cargó el dashboard. Recarga la página antes de seguir editando.');
      } else if (data.error === 'column_not_found') {
        alert(`No se pudo guardar "${field}": esa columna todavía no existe en el Sheet. Agrégala con ese nombre exacto y vuelve a intentar.`);
      } else if (data.error === 'invalid_date') {
        alert('Esa fecha no parece válida (año fuera de rango). Revisa el campo e intenta de nuevo.');
      } else if (data.error === 'unauthorized') {
        alert('No se pudo guardar: la clave de escritura no coincide entre el dashboard y Apps Script (WRITE_TOKEN).');
      } else {
        alert(`No se pudo guardar "${field}". Error: ${data.error || 'desconocido'}`);
      }
      return false;
    }
    row[field] = value; // reflejar en memoria
    if (recordUndo && oldValue !== value) {
      state.undoStack.push({ row, field, oldValue, newValue: value });
      if (state.undoStack.length > 20) state.undoStack.shift();
      updateUndoButton();
    }
    if (field === 'Estado') {
      safeRender(renderKPIs);
      safeRender(renderCrmAccordion);
      safeRender(renderProximos);
      safeRender(renderInforme);
    }
    if (field === 'Fecha próximo contacto') {
      safeRender(renderKPIs);
      safeRender(renderProximos);
    }
    return true;
  } catch (err) {
    console.error(err);
    if (rowEl) rowEl.style.outline = '2px solid #B3261E';
    alert(`No se pudo guardar "${field}": problema de conexión. Revisa tu internet e intenta de nuevo.`);
    return false;
  }
}

function updateUndoButton() {
  const btn = document.getElementById('undoBtn');
  if (!btn) return;
  const last = state.undoStack[state.undoStack.length - 1];
  btn.disabled = !last;
  btn.title = last ? `Deshacer: ${last.field} de ${last.row['Nombre'] || 'lead'} (${last.oldValue || 'vacío'} → ${last.newValue || 'vacío'})` : 'Nada que deshacer';
}

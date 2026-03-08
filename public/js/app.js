
// ===== AUTH =====
let currentUser = null;

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (res.status === 401) {
      window.location.replace('/login.html');
      return false;
    }
    const user = await res.json();
    currentUser = user;
    renderUserBar();
    if (user.rol === 'admin') {
      document.getElementById('navAdmin').style.display = 'flex';
    }
    return true;
  } catch (e) {
    window.location.replace('/login.html');
    return false;
  }
}

function renderUserBar() {
  if (!currentUser) return;
  const initial = currentUser.nombre.charAt(0).toUpperCase();
  const isAdmin = currentUser.rol === 'admin';
  document.getElementById('sidebarUser').innerHTML =
    '<div class="user-avatar">' + initial + '</div>' +
    '<div class="user-info">' +
    '<div class="user-name">' + currentUser.nombre + '</div>' +
    '<div class="user-rol">' + (isAdmin ? '★ Administrador' : 'Profe') + '</div>' +
    '</div>';
}

async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

// ===== ADMIN PANEL =====
async function renderAdminPanel() {
  const container = document.getElementById('adminContent');
  container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text2)">Cargando...</div>';
  try {
    const res = await fetch('/api/admin/usuarios');
    if (!res.ok) return;
    const usuarios = await res.json();

    const tableRows = usuarios.map(u => {
      const isMe = currentUser && u.id === currentUser.id;
      const meLabel = isMe ? '<span class="you-badge">Vos</span>' : '';
      return '<tr>' +
        '<td><strong>' + u.nombre + '</strong>' + meLabel + '</td>' +
        '<td style="color:var(--text2)">' + u.email + '</td>' +
        '<td><span class="rol-badge rol-' + u.rol + '">' + u.rol + '</span></td>' +
        '<td>' + u.total_clases + '</td>' +
        '<td>' + new Date(u.created_at).toLocaleDateString('es-AR') + '</td>' +
        '<td>' +
        (!isMe ? (
          '<button class="btn-icon" title="' + (u.rol === 'admin' ? 'Quitar admin' : 'Hacer admin') + '" onclick="toggleRol(\'' + u.id + '\',\'' + u.rol + '\')">' +
          (u.rol === 'admin' ? '↓' : '↑') + '</button> ' +
          '<button class="btn-icon" title="Eliminar" onclick="confirmDeleteUser(\'' + u.id + '\',\'' + u.nombre + '\')">&#10005;</button>'
        ) : '') +
        '</td></tr>';
    }).join('');

    const mobileCards = usuarios.map(u => {
      const isMe = currentUser && u.id === currentUser.id;
      return '<div class="admin-card">' +
        '<div class="admin-card-header">' +
        '<div><div style="font-weight:600">' + u.nombre + (isMe ? ' <span class="you-badge">Vos</span>' : '') + '</div>' +
        '<div style="font-size:.78rem;color:var(--text2);margin-top:.15rem">' + u.email + '</div></div>' +
        '<span class="rol-badge rol-' + u.rol + '">' + u.rol + '</span>' +
        '</div>' +
        '<div style="font-size:.8rem;color:var(--text2)">' + u.total_clases + ' clases · Desde ' + new Date(u.created_at).toLocaleDateString('es-AR') + '</div>' +
        (!isMe ? '<div class="admin-card-actions">' +
          '<button class="btn-secondary btn-sm" style="flex:1" onclick="toggleRol(\'' + u.id + '\',\'' + u.rol + '\')">' +
          (u.rol === 'admin' ? '↓ Quitar admin' : '↑ Hacer admin') + '</button>' +
          '<button class="btn-danger btn-sm" onclick="confirmDeleteUser(\'' + u.id + '\',\'' + u.nombre + '\')">&#10005; Eliminar</button>' +
          '</div>' : '') +
        '</div>';
    }).join('');

    container.innerHTML =
      '<div class="admin-table-wrap"><table class="admin-table">' +
      '<thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Clases</th><th>Registro</th><th>T&C</th><th></th></tr></thead>' +
      '<tbody>' + tableRows + '</tbody></table></div>' +
      '<div class="admin-cards">' + mobileCards + '</div>';
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><p>Error cargando usuarios</p></div>';
  }
}

async function toggleRol(userId, currentRol) {
  const newRol = currentRol === 'admin' ? 'profe' : 'admin';
  try {
    await fetch('/api/admin/usuarios/' + userId + '/rol', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rol: newRol })
    });
    showToast('Rol actualizado', 'success');
    renderAdminPanel();
  } catch (e) { showToast('Error', 'error'); }
}

function confirmDeleteUser(userId, nombre) {
  document.getElementById('confirmMsg').textContent = 'Eliminar a ' + nombre + ' y todas sus clases?';
  document.getElementById('confirmBtn').onclick = () => deleteUser(userId);
  document.getElementById('modalConfirm').classList.add('open');
}

async function deleteUser(userId) {
  closeModal('modalConfirm');
  try {
    await fetch('/api/admin/usuarios/' + userId, { method: 'DELETE', credentials: 'same-origin' });
    showToast('Usuario eliminado', 'success');
    renderAdminPanel();
  } catch (e) { showToast('Error', 'error'); }
}


let data = { clases: [] };
let currentClaseId = null;
let selectedColor = '#FF6B6B';
let selectedTipo = 'cuatrimestral';
let asistenciaTemp = {};
const API = '/api';
const NOTA_APROBACION = 6;

document.addEventListener('DOMContentLoaded', async () => {
  const authed = await checkAuth();
  if (!authed) return;
  const today = new Date();
  const el = document.getElementById('fechaHoy');
  if (el) el.textContent = today.toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const sf = document.getElementById('sesionFecha');
  if (sf) sf.value = today.toISOString().split('T')[0];
  document.querySelectorAll('.color-opt').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.color-opt').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      selectedColor = el.dataset.color;
    });
  });
  await loadData();
});

async function loadData() {
  try {
    const res = await fetch(API + '/data');
    data = await res.json();
    renderAll();
  } catch (e) { showToast('Error conectando al servidor', 'error'); }
}

function renderAll() {
  renderSidebar(); renderDashboard(); renderClasesList();
  if (currentClaseId) renderClaseDetail(currentClaseId);
}

// ===== SIDEBAR =====
function renderSidebar() {
  const container = document.getElementById('sidebarClases');
  if (!data.clases.length) { container.innerHTML = '<div style="padding:.6rem .8rem;font-size:.78rem;color:var(--text2)">Sin clases aun</div>'; return; }
  container.innerHTML = data.clases.map(c =>
    '<div class="sidebar-clase-item' + (currentClaseId === c.id ? ' active' : '') + '" onclick="openClase(\'' + c.id + '\')">' +
    '<span class="clase-dot" style="background:' + (c.color || '#7C6FFF') + '"></span>' +
    '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + c.nombre + '</span>' +
    '</div>'
  ).join('');
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('open');
}

// ===== VIEWS =====
function showView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  // Close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
  if (view === 'admin') renderAdminPanel();
}

function openClase(id) {
  currentClaseId = id;
  renderClaseDetail(id); renderSidebar(); showView('clase-detail');
}

// ===== DASHBOARD =====
function renderDashboard() {
  const tC = data.clases.length;
  const tA = data.clases.reduce((s, c) => s + c.alumnos.length, 0);
  const tS = data.clases.reduce((s, c) => s + c.sesiones.length, 0);
  const tH = data.clases.reduce((s, c) => s + c.sesiones.reduce((h, ses) => h + (parseFloat(ses.horas) || 0), 0), 0);
  document.getElementById('statsGlobal').innerHTML =
    statCard('#7C6FFF', 'Total Clases', tC, 'materias activas') +
    statCard('#4ECDC4', 'Alumnos', tA, 'en total') +
    statCard('#F4A261', 'Sesiones dadas', tS, 'registradas') +
    statCard('#DDA0DD', 'Horas totales', tH.toFixed(1), 'dictadas');

  const resumen = document.getElementById('resumenClases');
  if (!data.clases.length) { resumen.innerHTML = '<p style="color:var(--text2);font-size:.85rem;text-align:center;padding:1rem">No hay clases cargadas.</p>'; }
  else resumen.innerHTML = data.clases.map(c => {
    const pct = c.totalSesiones ? Math.round((c.sesiones.length / c.totalSesiones) * 100) : 0;
    return '<div class="resumen-item" onclick="openClase(\'' + c.id + '\')">' +
      '<span class="resumen-dot" style="background:' + (c.color || '#7C6FFF') + '"></span>' +
      '<span class="resumen-name">' + c.nombre + '</span>' +
      '<div class="resumen-stats"><span>' + c.alumnos.length + ' alumnos</span><span>' + pct + '% avance</span></div></div>';
  }).join('');

  const dias = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
  const todayIdx = new Date().getDay();
  const proximas = document.getElementById('proximasClases');
  const cCD = data.clases.filter(c => c.dias && c.dias.length);
  if (!cCD.length) { proximas.innerHTML = '<p style="color:var(--text2);font-size:.83rem;text-align:center;padding:1rem">Configura dias de clase.</p>'; return; }
  let items = [];
  for (let i = 0; i <= 6; i++) {
    const dName = dias[(todayIdx + i) % 7];
    cCD.forEach(c => { if (c.dias.includes(dName)) items.push({ clase: c, dia: dName, esHoy: i === 0 }); });
    if (items.length >= 5) break;
  }
  proximas.innerHTML = items.slice(0, 5).map(it =>
    '<div class="proxima-item"><div class="proxima-dia" style="color:' + it.clase.color + '">' + (it.esHoy ? 'HOY' : it.dia) + '</div>' +
    '<div><div style="font-size:.86rem;font-weight:500">' + it.clase.nombre + '</div>' +
    '<div style="font-size:.76rem;color:var(--text2)">' + (it.clase.horas || '?') + 'h semanales</div></div></div>'
  ).join('');
}

function statCard(color, label, value, sub) {
  return '<div class="stat-card" style="--accent-color:' + color + '"><div class="stat-label">' + label + '</div><div class="stat-value">' + value + '</div><div class="stat-sub">' + sub + '</div></div>';
}

// ===== CLASES LIST =====
function renderClasesList() {
  const grid = document.getElementById('clasesGrid');
  if (!data.clases.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📚</div><h3 style="margin-bottom:.4rem">Sin clases aun</h3><p>Crea tu primera clase para empezar</p><br><button class="btn-primary" onclick="openModalClase()">+ Nueva Clase</button></div>';
    return;
  }
  grid.innerHTML = data.clases.map(c => {
    const pct = c.totalSesiones ? Math.round((c.sesiones.length / c.totalSesiones) * 100) : 0;
    const prom = calcPromedio(c);
    const tipo = c.tipo || 'cuatrimestral';
    return '<div class="clase-card" style="--clase-color:' + (c.color || '#7C6FFF') + '" onclick="openClase(\'' + c.id + '\')">' +
      '<div class="clase-card-top"><div class="clase-card-name">' + c.nombre + '</div>' +
      '<span class="tipo-badge tipo-' + tipo + '">' + (tipo === 'anual' ? 'Anual' : 'Cuatrim.') + '</span></div>' +
      '<div class="clase-card-meta">' + (c.dias && c.dias.length ? c.dias.join(', ') : 'Sin dias') + ' &middot; ' + (c.horas || 0) + 'h/sem</div>' +
      '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%;background:' + (c.color || '#7C6FFF') + '"></div></div>' +
      '<div style="font-size:.72rem;color:var(--text2);margin:.35rem 0 .9rem">' + c.sesiones.length + '/' + (c.totalSesiones || '?') + ' sesiones (' + pct + '%)</div>' +
      '<div class="clase-card-stats">' +
      '<div class="clase-stat"><div class="clase-stat-val" style="color:' + (c.color || '#7C6FFF') + '">' + c.alumnos.length + '</div><div class="clase-stat-lbl">Alumnos</div></div>' +
      '<div class="clase-stat"><div class="clase-stat-val">' + (prom || '-') + '</div><div class="clase-stat-lbl">Promedio</div></div>' +
      '</div></div>';
  }).join('');
}

// ===== CLASE DETAIL =====
function renderClaseDetail(id) {
  const clase = data.clases.find(c => c.id === id);
  if (!clase) return;
  document.getElementById('detailNombre').textContent = clase.nombre;
  const tipo = clase.tipo || 'cuatrimestral';
  document.getElementById('detailSubtitle').textContent =
    (tipo === 'anual' ? 'Anual · 6 notas' : 'Cuatrimestral · 3 notas') + ' · ' +
    (clase.dias && clase.dias.length ? clase.dias.join(', ') : 'Sin dias') + ' · ' + (clase.horas || 0) + 'h/sem';
  document.getElementById('btnEditClase').onclick = () => openModalClase(id);
  document.getElementById('btnDeleteClase').onclick = () => confirmDelete('clase', id);

  const pct = clase.totalSesiones ? Math.round((clase.sesiones.length / clase.totalSesiones) * 100) : 0;
  const horas = clase.sesiones.reduce((s, ses) => s + (parseFloat(ses.horas) || 0), 0);
  const avg = calcAvgAsistAlumnos(clase);
  const aprobados = calcAprobados(clase);

  document.getElementById('statsClase').innerHTML =
    '<div class="stat-card" style="--accent-color:' + clase.color + '"><div class="stat-label">Avance del programa</div><div class="stat-value">' + pct + '%</div><div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%;background:' + clase.color + '"></div></div><div class="stat-sub">' + clase.sesiones.length + '/' + (clase.totalSesiones || '?') + ' sesiones</div></div>' +
    '<div class="stat-card" style="--accent-color:#4ECDC4"><div class="stat-label">Asist. promedio alumnos</div><div class="stat-value">' + avg + '%</div><div class="progress-bar"><div class="progress-fill" style="width:' + avg + '%;background:#4ECDC4"></div></div><div class="stat-sub">' + clase.alumnos.length + ' alumnos</div></div>' +
    '<div class="stat-card" style="--accent-color:#96CEB4"><div class="stat-label">Aprobados (prom >= 6)</div><div class="stat-value">' + aprobados.ok + '</div><div class="stat-sub">de ' + aprobados.total + ' con notas</div></div>' +
    '<div class="stat-card" style="--accent-color:#F4A261"><div class="stat-label">Horas dictadas</div><div class="stat-value">' + horas.toFixed(1) + '</div><div class="stat-sub">horas registradas</div></div>';

  renderTabAlumnos(clase);
  renderTabSesiones(clase);
  renderTabAsistencia(clase);
}

// ===== TAB ALUMNOS =====
function getNotasCount(clase) {
  return (clase.tipo || 'cuatrimestral') === 'anual' ? 6 : 3;
}

function renderTabAlumnos(clase) {
  const n = getNotasCount(clase);
  // Build table header
  let thNotas = '';
  for (let i = 1; i <= n; i++) thNotas += '<th>Nota ' + i + '</th>';
  document.getElementById('theadAlumnos').innerHTML =
    '<tr><th>Nombre</th>' + thNotas + '<th>Promedio</th><th>Asistencia</th><th></th></tr>';

  const tbody = document.getElementById('tbodyAlumnos');
  const cards = document.getElementById('alumnosCards');

  if (!clase.alumnos.length) {
    tbody.innerHTML = '<tr><td colspan="' + (n + 4) + '" style="text-align:center;padding:2rem;color:var(--text2)">No hay alumnos cargados</td></tr>';
    cards.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><p>No hay alumnos cargados</p></div>';
    return;
  }

  const totSes = clase.sesiones.length || 1;

  tbody.innerHTML = clase.alumnos.map(a => {
    const notas = getNotas(a, n);
    const prom = calcPromedioAlumno(a, n);
    const ap = Math.round((a.asistencias || 0) / totSes * 100);
    const ac = ap >= 75 ? '#4ECDC4' : ap >= 50 ? '#FFEAA7' : '#FF6B6B';
    let tds = '';
    for (let i = 1; i <= n; i++) {
      const v = a['nota' + i];
      tds += '<td>' + notaBadge(v) + '</td>';
    }
    const promBadge = prom !== null ? '<span class="nota-badge ' + (parseFloat(prom) >= NOTA_APROBACION ? 'nota-ok' : 'nota-mal') + '">' + prom + '</span>' : '<span class="nota-empty">-</span>';
    return '<tr><td><strong>' + a.nombre + '</strong>' + (a.obs ? '<div style="font-size:.73rem;color:var(--text2)">' + a.obs + '</div>' : '') + '</td>' +
      tds + '<td>' + promBadge + '</td>' +
      '<td><div class="asist-bar"><div class="progress-bar" style="flex:1"><div class="progress-fill" style="width:' + ap + '%;background:' + ac + '"></div></div><span class="asist-pct" style="color:' + ac + '">' + ap + '%</span></div><div style="font-size:.7rem;color:var(--text2)">' + (a.asistencias || 0) + '/' + clase.sesiones.length + '</div></td>' +
      '<td><button class="btn-icon" onclick="openModalAlumno(\'' + a.id + '\')">&#9998;</button> <button class="btn-icon" onclick="confirmDelete(\'alumno\',\'' + a.id + '\')">&#10005;</button></td></tr>';
  }).join('');

  // Mobile cards
  cards.innerHTML = clase.alumnos.map(a => {
    const notas = getNotas(a, n);
    const prom = calcPromedioAlumno(a, n);
    const ap = Math.round((a.asistencias || 0) / totSes * 100);
    const ac = ap >= 75 ? '#4ECDC4' : ap >= 50 ? '#FFEAA7' : '#FF6B6B';
    const promBadge = prom !== null ? '<span class="nota-badge ' + (parseFloat(prom) >= NOTA_APROBACION ? 'nota-ok' : 'nota-mal') + '">' + prom + '</span>' : '<span style="color:var(--text2);font-size:.85rem">Sin notas</span>';
    let notasHtml = '';
    for (let i = 1; i <= n; i++) {
      const v = a['nota' + i];
      notasHtml += '<span class="alumno-card-nota">N' + i + ': ' + (v !== null && v !== undefined && v !== '' ? v : '-') + '</span>';
    }
    return '<div class="alumno-card">' +
      '<div class="alumno-card-header"><div class="alumno-card-name">' + a.nombre + '</div>' + promBadge + '</div>' +
      '<div class="alumno-card-notas">' + notasHtml + '</div>' +
      '<div class="alumno-card-asist"><div class="progress-bar" style="flex:1"><div class="progress-fill" style="width:' + ap + '%;background:' + ac + '"></div></div><span style="font-size:.78rem;color:' + ac + ';font-weight:600">' + ap + '%</span></div>' +
      (a.obs ? '<div style="font-size:.75rem;color:var(--text2);margin-top:.5rem">' + a.obs + '</div>' : '') +
      '<div class="alumno-card-actions">' +
      '<button class="btn-secondary btn-sm" style="flex:1" onclick="openModalAlumno(\'' + a.id + '\')">✎ Editar</button>' +
      '<button class="btn-danger btn-sm" onclick="confirmDelete(\'alumno\',\'' + a.id + '\')">✕</button>' +
      '</div></div>';
  }).join('');
}

function notaBadge(v) {
  if (v === null || v === undefined || v === '') return '<span class="nota-empty">-</span>';
  const n = parseFloat(v);
  return '<span class="nota-badge ' + (n >= NOTA_APROBACION ? 'nota-ok' : 'nota-mal') + '">' + v + '</span>';
}

function getNotas(alumno, n) {
  const arr = [];
  for (let i = 1; i <= n; i++) arr.push(alumno['nota' + i]);
  return arr;
}

function calcPromedioAlumno(alumno, n) {
  const ns = [];
  for (let i = 1; i <= n; i++) {
    const v = alumno['nota' + i];
    if (v !== null && v !== undefined && v !== '') ns.push(parseFloat(v));
  }
  if (!ns.length) return null;
  return (ns.reduce((s, v) => s + v, 0) / ns.length).toFixed(1);
}

function filterAlumnos() {
  const q = document.getElementById('searchAlumno').value.toLowerCase();
  document.querySelectorAll('#tbodyAlumnos tr').forEach(tr => {
    const n = tr.querySelector('td strong');
    if (n) tr.style.display = n.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
  document.querySelectorAll('.alumno-card').forEach((card, i) => {
    const clase = data.clases.find(c => c.id === currentClaseId);
    if (clase && clase.alumnos[i]) {
      card.style.display = clase.alumnos[i].nombre.toLowerCase().includes(q) ? '' : 'none';
    }
  });
}

// ===== TAB SESIONES =====
function renderTabSesiones(clase) {
  const tH = clase.sesiones.reduce((s, ses) => s + (parseFloat(ses.horas) || 0), 0);
  document.getElementById('sesionesInfo').textContent = clase.sesiones.length + ' sesiones · ' + tH.toFixed(1) + 'h totales';
  const lista = document.getElementById('listaSesiones');
  if (!clase.sesiones.length) { lista.innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><p>No hay sesiones registradas</p></div>'; return; }
  const sorted = [...clase.sesiones].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  lista.innerHTML = sorted.map(ses =>
    '<div class="sesion-item"><div class="sesion-fecha">' + formatFecha(ses.fecha) + '</div>' +
    '<div class="sesion-tema">' + (ses.tema || '<span style="color:var(--text2)">Sin tema</span>') +
    (ses.obs ? '<div style="font-size:.73rem;color:var(--text2)">' + ses.obs + '</div>' : '') + '</div>' +
    '<span class="sesion-horas">' + (ses.horas || 0) + 'h</span>' +
    '<button class="btn-icon" onclick="deleteSesion(\'' + ses.id + '\')">&#10005;</button></div>'
  ).join('');
}

// ===== TAB ASISTENCIA =====
function renderTabAsistencia(clase) {
  const lista = document.getElementById('asistenciaSesionesLista');
  if (!clase.sesiones.length) {
    lista.innerHTML = '<p style="font-size:.8rem;color:var(--text2)">Sin sesiones</p>';
    document.getElementById('asistenciaPanel').innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><p>Primero registra una sesion</p></div>';
    return;
  }
  const sorted = [...clase.sesiones].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  lista.innerHTML = sorted.map(ses => {
    const total = clase.alumnos.length;
    const presentes = ses.asistencia ? Object.values(ses.asistencia).filter(v => v).length : null;
    const badge = presentes !== null
      ? '<span style="font-size:.7rem;color:' + (presentes === total ? 'var(--success)' : 'var(--text2)') + '">' + presentes + '/' + total + ' pres.</span>'
      : '<span style="font-size:.7rem;color:var(--text2)">Sin tomar</span>';
    return '<div class="sesion-selector-item" id="sesItem-' + ses.id + '" onclick="selectSesionAsistencia(\'' + ses.id + '\')">' +
      '<span class="sesion-selector-fecha">' + formatFecha(ses.fecha) + '</span>' +
      '<span class="sesion-selector-tema">' + (ses.tema || 'Sin tema') + '</span>' + badge + '</div>';
  }).join('');
}

function selectSesionAsistencia(sesionId) {
  const clase = data.clases.find(c => c.id === currentClaseId);
  const sesion = clase.sesiones.find(s => s.id === sesionId);
  if (!sesion) return;
  document.querySelectorAll('.sesion-selector-item').forEach(el => el.classList.remove('active'));
  const item = document.getElementById('sesItem-' + sesionId);
  if (item) item.classList.add('active');
  if (!asistenciaTemp[sesionId]) {
    asistenciaTemp[sesionId] = sesion.asistencia ? Object.assign({}, sesion.asistencia) : {};
    clase.alumnos.forEach(a => { if (!(a.id in asistenciaTemp[sesionId])) asistenciaTemp[sesionId][a.id] = false; });
  }
  renderPanelAsistencia(clase, sesion, asistenciaTemp[sesionId]);
}

function renderPanelAsistencia(clase, sesion, estado) {
  const panel = document.getElementById('asistenciaPanel');
  const presentes = Object.values(estado).filter(v => v).length;
  const total = clase.alumnos.length;
  if (!total) { panel.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><p>No hay alumnos en esta clase</p></div>'; return; }
  const pct = total ? Math.round(presentes / total * 100) : 0;
  const rows = clase.alumnos.map(a => {
    const presente = estado[a.id] === true;
    const totSes = clase.sesiones.length;
    const ap = totSes ? Math.round((a.asistencias || 0) / totSes * 100) : 0;
    return '<div class="asistencia-alumno-row" id="row-' + a.id + '">' +
      '<div><div class="asistencia-alumno-nombre">' + a.nombre + '</div>' +
      '<div class="asistencia-alumno-stats">Asistencia: ' + ap + '% (' + (a.asistencias || 0) + '/' + totSes + ')</div></div>' +
      '<button class="toggle-asist ' + (presente ? 'presente' : 'ausente') + '" id="btn-' + a.id +
      '" onclick="toggleAsistencia(\'' + sesion.id + '\',\'' + a.id + '\')">'+
      (presente ? '&#10003; Presente' : '&#10007; Ausente') + '</button></div>';
  }).join('');
  panel.innerHTML =
    '<div class="card" style="padding:0;overflow:hidden">' +
    '<div style="padding:.9rem 1rem;border-bottom:1px solid var(--border)">' +
    '<div style="font-family:Syne,sans-serif;font-weight:700;font-size:.95rem">' + formatFechaLarga(sesion.fecha) + '</div>' +
    (sesion.tema ? '<div style="font-size:.8rem;color:var(--text2);margin-top:.15rem">' + sesion.tema + '</div>' : '') + '</div>' +
    '<div class="asist-resumen-bar">' +
    '<div><span class="asist-resumen-num" id="presentesCount">' + presentes + '</span>' +
    '<span style="color:var(--text2);font-size:.8rem"> / ' + total + ' pres.</span></div>' +
    '<div style="flex:1;margin:0 .6rem"><div class="progress-bar" style="margin:0"><div class="progress-fill" id="presentesBarra" style="width:' + pct + '%;background:var(--success)"></div></div></div>' +
    '<button class="marcar-todos-btn" onclick="marcarTodos(\'' + sesion.id + '\')">&#10003; Todos</button></div>' +
    '<div id="listaAlumnosAsist">' + rows + '</div>' +
    '<div style="padding:.9rem 1rem;border-top:1px solid var(--border)">' +
    '<button class="guardar-asist-btn" onclick="guardarAsistencia(\'' + sesion.id + '\')">&#128190; Guardar Asistencia</button></div></div>';
}

function toggleAsistencia(sesionId, alumnoId) {
  const clase = data.clases.find(c => c.id === currentClaseId);
  if (!asistenciaTemp[sesionId]) {
    const s = clase.sesiones.find(s => s.id === sesionId);
    asistenciaTemp[sesionId] = s.asistencia ? Object.assign({}, s.asistencia) : {};
    clase.alumnos.forEach(a => { if (!(a.id in asistenciaTemp[sesionId])) asistenciaTemp[sesionId][a.id] = false; });
  }
  asistenciaTemp[sesionId][alumnoId] = !asistenciaTemp[sesionId][alumnoId];
  const presente = asistenciaTemp[sesionId][alumnoId];
  const btn = document.getElementById('btn-' + alumnoId);
  if (btn) { btn.className = 'toggle-asist ' + (presente ? 'presente' : 'ausente'); btn.innerHTML = presente ? '&#10003; Presente' : '&#10007; Ausente'; }
  const total = clase.alumnos.length;
  const pres = Object.values(asistenciaTemp[sesionId]).filter(v => v).length;
  const ct = document.getElementById('presentesCount'); if (ct) ct.textContent = pres;
  const br = document.getElementById('presentesBarra'); if (br) br.style.width = (total ? Math.round(pres / total * 100) : 0) + '%';
}

function marcarTodos(sesionId) {
  const clase = data.clases.find(c => c.id === currentClaseId);
  if (!asistenciaTemp[sesionId]) { asistenciaTemp[sesionId] = {}; clase.alumnos.forEach(a => { asistenciaTemp[sesionId][a.id] = false; }); }
  const todos = clase.alumnos.every(a => asistenciaTemp[sesionId][a.id] === true);
  clase.alumnos.forEach(a => {
    asistenciaTemp[sesionId][a.id] = !todos;
    const btn = document.getElementById('btn-' + a.id);
    if (btn) { btn.className = 'toggle-asist ' + (!todos ? 'presente' : 'ausente'); btn.innerHTML = !todos ? '&#10003; Presente' : '&#10007; Ausente'; }
  });
  const pres = todos ? 0 : clase.alumnos.length;
  const ct = document.getElementById('presentesCount'); if (ct) ct.textContent = pres;
  const br = document.getElementById('presentesBarra'); if (br) br.style.width = (clase.alumnos.length ? Math.round(pres / clase.alumnos.length * 100) : 0) + '%';
}

async function guardarAsistencia(sesionId) {
  const clase = data.clases.find(c => c.id === currentClaseId);
  const sesion = clase.sesiones.find(s => s.id === sesionId);
  const asistencia = asistenciaTemp[sesionId] || sesion.asistencia || {};
  try {
    await fetch(API + '/clases/' + currentClaseId + '/sesiones/' + sesionId + '/asistencia', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asistencia })
    });
    sesion.asistencia = asistencia;
    clase.alumnos.forEach(a => { let cnt = 0; clase.sesiones.forEach(ses => { if (ses.asistencia && ses.asistencia[a.id] === true) cnt++; }); a.asistencias = cnt; });
    delete asistenciaTemp[sesionId];
    showToast('Asistencia guardada', 'success');
    renderTabAsistencia(clase); renderTabAlumnos(clase); selectSesionAsistencia(sesionId);
  } catch (e) { showToast('Error guardando asistencia', 'error'); }
}

// ===== TABS =====
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === 'tab-' + tab));
}

// ===== MODAL CLASE =====
function selectTipo(tipo) {
  selectedTipo = tipo;
  document.querySelectorAll('.tipo-btn').forEach(b => b.classList.toggle('active', b.dataset.tipo === tipo));
}

function openModalClase(id) {
  id = id || null;
  document.getElementById('modalClaseTitle').textContent = id ? 'Editar Clase' : 'Nueva Clase';
  document.getElementById('claseId').value = id || '';
  ['claseNombre', 'claseHoras', 'claseTotalSesiones', 'claseDesc'].forEach(f => document.getElementById(f).value = '');
  document.querySelectorAll('#diasCheck input').forEach(i => i.checked = false);
  selectedColor = '#FF6B6B';
  selectedTipo = 'cuatrimestral';
  document.querySelectorAll('.color-opt').forEach(e => e.classList.toggle('selected', e.dataset.color === selectedColor));
  document.querySelectorAll('.tipo-btn').forEach(b => b.classList.toggle('active', b.dataset.tipo === 'cuatrimestral'));
  if (id) {
    const c = data.clases.find(c => c.id === id);
    if (c) {
      document.getElementById('claseNombre').value = c.nombre;
      document.getElementById('claseHoras').value = c.horas || '';
      document.getElementById('claseTotalSesiones').value = c.totalSesiones || '';
      document.getElementById('claseDesc').value = c.desc || '';
      if (c.dias) document.querySelectorAll('#diasCheck input').forEach(i => { if (c.dias.includes(i.value)) i.checked = true; });
      if (c.color) { selectedColor = c.color; document.querySelectorAll('.color-opt').forEach(e => e.classList.toggle('selected', e.dataset.color === c.color)); }
      if (c.tipo) { selectedTipo = c.tipo; document.querySelectorAll('.tipo-btn').forEach(b => b.classList.toggle('active', b.dataset.tipo === c.tipo)); }
    }
  }
  document.getElementById('modalClase').classList.add('open');
}

async function saveClase() {
  const nombre = document.getElementById('claseNombre').value.trim();
  if (!nombre) { showToast('El nombre es requerido', 'error'); return; }
  const dias = [...document.querySelectorAll('#diasCheck input:checked')].map(i => i.value);
  const body = {
    nombre, tipo: selectedTipo,
    horas: parseFloat(document.getElementById('claseHoras').value) || 0,
    totalSesiones: parseInt(document.getElementById('claseTotalSesiones').value) || 0,
    desc: document.getElementById('claseDesc').value, dias, color: selectedColor
  };
  const id = document.getElementById('claseId').value;
  try {
    if (id) {
      const res = await fetch(API + '/clases/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
      const updated = await res.json();
      const idx = data.clases.findIndex(c => c.id === id);
      if (idx !== -1) data.clases[idx] = Object.assign({}, data.clases[idx], updated);
      showToast('Clase actualizada', 'success');
    } else {
      const res = await fetch(API + '/clases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
      data.clases.push(await res.json());
      showToast('Clase creada', 'success');
    }
    closeModal('modalClase'); renderAll();
  } catch (e) { showToast('Error guardando', 'error'); }
}

// ===== MODAL ALUMNO =====
function openModalAlumno(id) {
  id = id || null;
  const clase = data.clases.find(c => c.id === currentClaseId);
  const n = getNotasCount(clase);
  document.getElementById('modalAlumnoTitle').textContent = id ? 'Editar Alumno' : 'Agregar Alumno';
  document.getElementById('alumnoId').value = id || '';
  document.getElementById('alumnoNombre').value = '';
  document.getElementById('alumnoObs').value = '';

  // Build dynamic notas form
  const container = document.getElementById('notasContainer');
  let html = '<div class="notas-grid' + (n === 6 ? ' seis' : '') + '">';
  for (let i = 1; i <= n; i++) {
    html += '<div class="form-group"><label>Nota ' + i + '</label><input type="number" id="alumnoNota' + i + '" min="0" max="10" step="0.1" placeholder="0-10"></div>';
  }
  html += '</div>';
  container.innerHTML = html;

  if (id) {
    const a = clase && clase.alumnos.find(a => a.id === id);
    if (a) {
      document.getElementById('alumnoNombre').value = a.nombre;
      document.getElementById('alumnoObs').value = a.obs || '';
      for (let i = 1; i <= n; i++) {
        const el = document.getElementById('alumnoNota' + i);
        if (el) el.value = a['nota' + i] != null ? a['nota' + i] : '';
      }
    }
  }
  document.getElementById('modalAlumno').classList.add('open');
}

async function saveAlumno() {
  const nombre = document.getElementById('alumnoNombre').value.trim();
  if (!nombre) { showToast('El nombre es requerido', 'error'); return; }
  const clase = data.clases.find(c => c.id === currentClaseId);
  const n = getNotasCount(clase);
  const body = { nombre, obs: document.getElementById('alumnoObs').value };
  for (let i = 1; i <= 6; i++) {
    const el = document.getElementById('alumnoNota' + i);
    body['nota' + i] = (el && el.value !== '') ? parseFloat(el.value) : null;
  }
  const id = document.getElementById('alumnoId').value;
  try {
    if (id) {
      await fetch(API + '/clases/' + currentClaseId + '/alumnos/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
      const idx = clase.alumnos.findIndex(a => a.id === id);
      if (idx !== -1) clase.alumnos[idx] = Object.assign({}, clase.alumnos[idx], body);
      showToast('Alumno actualizado', 'success');
    } else {
      const res = await fetch(API + '/clases/' + currentClaseId + '/alumnos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
      clase.alumnos.push(await res.json());
      showToast('Alumno agregado', 'success');
    }
    closeModal('modalAlumno'); renderClaseDetail(currentClaseId);
  } catch (e) { showToast('Error guardando', 'error'); }
}

// ===== SESION =====
function openModalSesion() {
  document.getElementById('sesionFecha').value = new Date().toISOString().split('T')[0];
  ['sesionTema', 'sesionHoras', 'sesionObs'].forEach(f => document.getElementById(f).value = '');
  document.getElementById('modalSesion').classList.add('open');
}

async function saveSesion() {
  const fecha = document.getElementById('sesionFecha').value;
  if (!fecha) { showToast('La fecha es requerida', 'error'); return; }
  const body = { fecha, tema: document.getElementById('sesionTema').value, horas: parseFloat(document.getElementById('sesionHoras').value) || 0, obs: document.getElementById('sesionObs').value };
  try {
    const res = await fetch(API + '/clases/' + currentClaseId + '/sesiones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    data.clases.find(c => c.id === currentClaseId).sesiones.push(await res.json());
    closeModal('modalSesion'); renderClaseDetail(currentClaseId); renderDashboard();
    showToast('Sesion registrada', 'success');
  } catch (e) { showToast('Error guardando', 'error'); }
}

async function deleteSesion(sesionId) {
  try {
    await fetch(API + '/clases/' + currentClaseId + '/sesiones/' + sesionId, { method: 'DELETE', credentials: 'same-origin' });
    const clase = data.clases.find(c => c.id === currentClaseId);
    clase.sesiones = clase.sesiones.filter(s => s.id !== sesionId);
    delete asistenciaTemp[sesionId];
    renderClaseDetail(currentClaseId); showToast('Sesion eliminada', 'success');
  } catch (e) { showToast('Error', 'error'); }
}

// ===== CONFIRM DELETE =====
function confirmDelete(type, id) {
  document.getElementById('confirmMsg').textContent = type === 'clase' ? 'Eliminar esta clase y todos sus datos?' : 'Eliminar este alumno?';
  document.getElementById('confirmBtn').onclick = () => doDelete(type, id);
  document.getElementById('modalConfirm').classList.add('open');
}

async function doDelete(type, id) {
  closeModal('modalConfirm');
  try {
    if (type === 'clase') {
      await fetch(API + '/clases/' + id, { method: 'DELETE', credentials: 'same-origin' });
      data.clases = data.clases.filter(c => c.id !== id);
      currentClaseId = null; showToast('Clase eliminada', 'success'); showView('clases'); renderAll();
    } else {
      await fetch(API + '/clases/' + currentClaseId + '/alumnos/' + id, { method: 'DELETE', credentials: 'same-origin' });
      const clase = data.clases.find(c => c.id === currentClaseId);
      clase.alumnos = clase.alumnos.filter(a => a.id !== id);
      renderClaseDetail(currentClaseId); showToast('Alumno eliminado', 'success');
    }
  } catch (e) { showToast('Error eliminando', 'error'); }
}

function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('click', e => { if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open'); });

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show ' + (type || 'success');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ===== HELPERS =====
function calcPromedio(clase) {
  const n = getNotasCount(clase);
  const proms = clase.alumnos.map(a => calcPromedioAlumno(a, n)).filter(p => p !== null);
  if (!proms.length) return null;
  return (proms.reduce((s, p) => s + parseFloat(p), 0) / proms.length).toFixed(1);
}

function calcAprobados(clase) {
  const n = getNotasCount(clase);
  let ok = 0, total = 0;
  clase.alumnos.forEach(a => {
    const p = calcPromedioAlumno(a, n);
    if (p !== null) { total++; if (parseFloat(p) >= NOTA_APROBACION) ok++; }
  });
  return { ok, total };
}

function calcAvgAsistAlumnos(clase) {
  if (!clase.alumnos.length || !clase.sesiones.length) return 0;
  return Math.round(clase.alumnos.reduce((s, a) => s + ((a.asistencias || 0) / clase.sesiones.length), 0) / clase.alumnos.length * 100);
}

function formatFecha(str) {
  if (!str) return '';
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}

function formatFechaLarga(str) {
  if (!str) return '';
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
}

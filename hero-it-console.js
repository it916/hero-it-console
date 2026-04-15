const atSign = '@';
// ── Google OAuth ──────────────────────────────────────────────
const ALLOWED_EMAIL = 'it' + atSign + 'heroinsuranceusa.com';

function handleGoogleLogin(response) {
  try {
    // Decode JWT payload
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    const email = payload.email || '';
    const nombre = payload.name || '';
    const picture = payload.picture || '';

    if (email.toLowerCase() !== ALLOWED_EMAIL.toLowerCase()) {
      const errEl = document.getElementById('login-error');
      errEl.style.display = 'block';
      errEl.textContent = 'Acceso denegado. Esta consola es exclusiva para ' + ALLOWED_EMAIL + '. Iniciaste sesión como: ' + email;
      return;
    }

    // Store session
    sessionStorage.setItem('hero_auth', JSON.stringify({ email, nombre, picture, ts: Date.now() }));
    showApp(nombre, picture);
  } catch(e) {
    document.getElementById('login-error').style.display = 'block';
    document.getElementById('login-error').textContent = 'Error al verificar identidad: ' + e.message;
  }
}

function showApp(nombre, picture) {
  document.getElementById('login-screen').style.display = 'none';
  const appEl = document.getElementById('app-content');
  appEl.style.display = 'flex';
  appEl.style.width = '100%';
  appEl.style.minHeight = '100vh';
  appEl.style.flexDirection = 'row';
  const userLabel = document.querySelector('.user-label');
  if (userLabel) userLabel.textContent = nombre + ' · IT Admin';
  addLog('Sesión iniciada como ' + nombre, 'success');
  // Start background services
  requestNotificationPermission();
  startPolling();
  loadDashboardCounters();
  checkSystemStatus();
}

function checkExistingSession() {
  try {
    const stored = sessionStorage.getItem('hero_auth');
    if (!stored) return false;
    const { email, nombre, picture, ts } = JSON.parse(stored);
    // Session valid for 8 hours
    if (Date.now() - ts > 8 * 60 * 60 * 1000) {
      sessionStorage.removeItem('hero_auth');
      return false;
    }
    if (email.toLowerCase() !== ALLOWED_EMAIL.toLowerCase()) return false;
    showApp(nombre, picture);
    return true;
  } catch(e) { return false; }
}

// ── Logs globales ─────────────────────────────────────────────
const sessionLogs = [];
let sessionActionCount = 0;

// ── Navegación ────────────────────────────────────────────────
const pageLabels = {
  'dashboard': 'Dashboard',
  'reset': 'Reset de Contraseña',
  'usuarios': 'Usuarios Workspace',
  'logs': 'Historial de Logs',
  'config': 'Configuración',
  'solicitudes': 'Solicitudes de Alta',
  'tickets': 'Tickets de Soporte',
  'auditoria': 'Auditoría',
  'crear-usuario': 'Crear Usuario'
};

// ── Sidebar móvil ─────────────────────────────────────────────
function toggleSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const isOpen   = sidebar.classList.contains('open');
  if (isOpen) {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  } else {
    sidebar.classList.add('open');
    overlay.classList.add('show');
  }
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('show');
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick') && n.getAttribute('onclick').includes("'" + id + "'")) {
      n.classList.add('active');
    }
  });
  document.getElementById('current-section-label').textContent = pageLabels[id] || id;

  // Cerrar sidebar en móvil al navegar
  closeSidebar();

  // Auto-cargar datos al navegar
  const autoLoad = {
    'usuarios':     () => loadUsers(),
    'tickets':      () => loadTickets(),
    'solicitudes':  () => loadSolicitudes(),
    'auditoria':    () => loadAudit(),
    'dispositivos': () => loadDevices(),
    'zoho':         () => loadZohoDevices(),
    'offboarding':  () => { if (!window._workspaceUsers) loadUsers(); renderOffboardingSteps(); },
    'licencias':    () => loadLicencias(),
    'logs':         () => renderSessionLogs(),
  };
  if (autoLoad[id]) autoLoad[id]();

  return false;
}

// ── Reloj ─────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const opts = { timeZone: 'America/New_York', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit' };
  document.getElementById('clock').textContent =
    now.toLocaleTimeString('es-MX', opts) + ' ET';
}
setInterval(updateClock, 1000);
updateClock();

// ── Worker URL ────────────────────────────────────────────────
const WORKER_URL = 'https://hero-email-worker.broad-fire-d2d6.workers.dev';

// ── Panel de estado del ecosistema ───────────────────────────
async function checkSystemStatus() {
  const btn = document.getElementById('btn-check-status');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }

  const setStatus = (svc, state, detail) => {
    const dot = document.getElementById('dot-' + svc);
    const det = document.getElementById('detail-' + svc);
    if (dot) { dot.className = 'status-dot ' + state; }
    if (det) { det.textContent = detail; }
  };

  // Mark all as loading
  ['worker','google','zoho','resend'].forEach(s => setStatus(s, 'loading', 'Verificando...'));

  // 1. Worker ping
  try {
    const t0 = Date.now();
    const r = await fetch(WORKER_URL + '/audit?limit=1');
    if (r.ok) setStatus('worker', 'ok', 'Online · ' + (Date.now()-t0) + 'ms');
    else setStatus('worker', 'error', 'Error ' + r.status);
  } catch { setStatus('worker', 'error', 'Sin respuesta'); }

  // 2. Google Workspace
  try {
    const t0 = Date.now();
    const r = await fetch(WORKER_URL + '/users');
    const d = await r.json();
    if (r.ok && d.users) setStatus('google', 'ok', d.users.length + ' usuarios · ' + (Date.now()-t0) + 'ms');
    else setStatus('google', 'error', d.error || 'Error');
  } catch { setStatus('google', 'error', 'Sin respuesta'); }

  // 3. Zoho Assist
  try {
    const t0 = Date.now();
    const r = await fetch(WORKER_URL + '/zoho/devices');
    const d = await r.json();
    if (r.ok) setStatus('zoho', 'ok', d.devices.length + ' dispositivos · ' + (Date.now()-t0) + 'ms');
    else setStatus('zoho', 'error', d.error || 'Error');
  } catch { setStatus('zoho', 'error', 'Sin respuesta'); }

  // 4. Resend — test via Worker general email endpoint availability
  try {
    // We just check that worker responds to POST /  without crashing
    const r = await fetch(WORKER_URL + '/ticket?limit=1');
    if (r.ok) setStatus('resend', 'ok', 'Activo vía Worker');
    else setStatus('resend', 'error', 'Error ' + r.status);
  } catch { setStatus('resend', 'error', 'Sin respuesta'); }

  if (btn) { btn.disabled = false; btn.innerHTML = '↺ Verificar'; }
  addLog('Verificación de estado completada', 'info');
}

async function loadDashboardCounters() {
  try {
    // Tickets abiertos
    const tResp = await fetch(WORKER_URL + '/ticket');
    if (tResp.ok) {
      const tData = await tResp.json();
      const open = (tData.tickets || []).filter(t => t.estado === 'abierto').length;
      const el = document.getElementById('stat-tickets-open');
      if (el) { el.textContent = open; el.style.color = open > 0 ? 'var(--hero-danger)' : 'var(--hero-success)'; }
    }
  } catch {}
  try {
    // Solicitudes pendientes
    const sResp = await fetch(WORKER_URL + '/alta-agente');
    if (sResp.ok) {
      const sData = await sResp.json();
      const pending = (sData.solicitudes || []).filter(s => s.estado === 'pendiente').length;
      const el = document.getElementById('stat-solicitudes-pending');
      if (el) { el.textContent = pending; el.style.color = pending > 0 ? 'var(--hero-warning)' : 'var(--hero-success)'; }
    }
  } catch {}
  try {
    // Dispositivos
    const dResp = await fetch(WORKER_URL + '/device');
    if (dResp.ok) {
      const dData = await dResp.json();
      const el = document.getElementById('stat-devices-count');
      if (el) { el.textContent = (dData.devices || []).length; el.style.color = 'var(--hero-primary)'; }
    }
  } catch {}
}

// ── Búsqueda global ───────────────────────────────────────────
let searchDebounce = null;

function openGlobalSearch() {
  document.getElementById('global-search-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('global-search-input').focus(), 50);
}
function closeGlobalSearch() {
  document.getElementById('global-search-overlay').style.display = 'none';
  document.getElementById('global-search-input').value = '';
  document.getElementById('global-search-results').innerHTML = '';
}
function onGlobalSearch() {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(runGlobalSearch, 300);
}
async function runGlobalSearch() {
  const q = document.getElementById('global-search-input').value.trim().toLowerCase();
  const results = document.getElementById('global-search-results');
  if (q.length < 2) { results.innerHTML = ''; return; }
  results.innerHTML = '<div style="text-align:center;padding:20px;"><span class="spinner"></span></div>';
  const found = [];
  try {
    const r = await fetch(WORKER_URL + '/ticket');
    if (r.ok) {
      const d = await r.json();
      (d.tickets || []).forEach(t => {
        if ((t.asunto||'').toLowerCase().includes(q) || (t.nombre||'').toLowerCase().includes(q) || (t.descripcion||'').toLowerCase().includes(q))
          found.push({ type:'🎫 Ticket', title: t.ticketId + ' — ' + t.asunto, sub: t.nombre + ' · ' + t.estado, action: "showPage('tickets')" });
      });
    }
  } catch {}
  try {
    const r = await fetch(WORKER_URL + '/alta-agente');
    if (r.ok) {
      const d = await r.json();
      (d.solicitudes || []).forEach(s => {
        if ((s.nombre||'').toLowerCase().includes(q) || (s.apellido||'').toLowerCase().includes(q) || (s.correo||'').toLowerCase().includes(q))
          found.push({ type:'📥 Solicitud', title: s.nombre + ' ' + s.apellido, sub: s.correo + ' · ' + s.estado, action: "showPage('solicitudes')" });
      });
    }
  } catch {}
  try {
    const r = await fetch(WORKER_URL + '/device');
    if (r.ok) {
      const d = await r.json();
      (d.devices || []).forEach(dev => {
        if ((dev.nombre||'').toLowerCase().includes(q) || (dev.usuario||'').toLowerCase().includes(q))
          found.push({ type:'💻 Dispositivo', title: dev.nombre, sub: (dev.usuario||'Sin usuario') + ' · ' + dev.estado, action: "showPage('dispositivos')" });
      });
    }
  } catch {}
  if (window._workspaceUsers) {
    window._workspaceUsers.forEach(u => {
      if ((u.nombre||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q))
        found.push({ type:'👤 Usuario', title: u.nombre, sub: u.email + ' · ' + u.estado, action: "showPage('usuarios')" });
    });
  }
  if (!found.length) {
    results.innerHTML = '<div style="text-align:center;padding:24px;color:var(--hero-text-muted);font-size:13px;">Sin resultados para "' + q + '"</div>';
    return;
  }
  results.innerHTML = found.map(f =>
    '<div onclick="' + f.action + ';closeGlobalSearch()" style="display:flex;align-items:flex-start;gap:10px;padding:12px 16px;cursor:pointer;border-bottom:1px solid var(--hero-border);transition:background 0.15s;" onmouseover="this.style.background=\'var(--hero-bg)\'" onmouseout="this.style.background=\'\'"> '
    + '<span style="font-size:11px;padding:2px 8px;background:var(--hero-bg);border:1px solid var(--hero-border);border-radius:20px;color:var(--hero-text-muted);white-space:nowrap;flex-shrink:0;">' + f.type + '</span>'
    + '<div><div style="font-size:13px;font-weight:600;color:var(--hero-text-primary);">' + f.title + '</div>'
    + '<div style="font-size:11px;color:var(--hero-text-muted);margin-top:2px;">' + f.sub + '</div></div></div>'
  ).join('');
}

// ── Notificaciones push ───────────────────────────────────────
let notifInterval = null;
let lastTicketCount = -1;
let lastSolicitudCount = -1;

async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') await Notification.requestPermission();
}
function sendPushNotification(title, body, onClick) {
  if (Notification.permission !== 'granted') return;
  const n = new Notification(title, { body, icon: 'https://i.ibb.co/tMRCCW07/Hero-Nuevo-Circulo-1.png' });
  if (onClick) n.onclick = onClick;
}
function updateTabBadge(total) {
  document.title = total > 0 ? '(' + total + ') Hero IT Console' : 'Hero IT Console';
}
async function pollForUpdates() {
  try {
    const [tResp, sResp] = await Promise.all([fetch(WORKER_URL + '/ticket'), fetch(WORKER_URL + '/alta-agente')]);
    const tData = tResp.ok ? await tResp.json() : { tickets: [] };
    const sData = sResp.ok ? await sResp.json() : { solicitudes: [] };
    const openTickets      = (tData.tickets     || []).filter(t => t.estado === 'abierto').length;
    const pendingSolicitud = (sData.solicitudes  || []).filter(s => s.estado === 'pendiente').length;
    if (lastTicketCount >= 0 && openTickets > lastTicketCount) {
      sendPushNotification('Nuevo ticket de soporte', (openTickets - lastTicketCount) + ' ticket(s) nuevo(s)', () => { window.focus(); showPage('tickets'); });
    }
    if (lastSolicitudCount >= 0 && pendingSolicitud > lastSolicitudCount) {
      sendPushNotification('Nueva solicitud de alta', (pendingSolicitud - lastSolicitudCount) + ' solicitud(es) pendiente(s)', () => { window.focus(); showPage('solicitudes'); });
    }
    lastTicketCount    = openTickets;
    lastSolicitudCount = pendingSolicitud;
    updateTabBadge(openTickets + pendingSolicitud);
    const elT = document.getElementById('stat-tickets-open');
    const elS = document.getElementById('stat-solicitudes-pending');
    if (elT) { elT.textContent = openTickets;      elT.style.color = openTickets > 0      ? 'var(--hero-danger)'  : 'var(--hero-success)'; }
    if (elS) { elS.textContent = pendingSolicitud; elS.style.color = pendingSolicitud > 0 ? 'var(--hero-warning)' : 'var(--hero-success)'; }
  } catch {}
}
function startPolling() {
  if (notifInterval) return;
  pollForUpdates();
  notifInterval = setInterval(pollForUpdates, 60000);
}

async function auditLog(tipo, descripcion, detalle = null) {
  try {
    await fetch(WORKER_URL + '/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, descripcion, detalle, usuario: 'Fernando Romero' })
    });
  } catch(e) { console.warn('auditLog error:', e.message); }
}
async function sendViaResend({ to, subject, html, text }) {
  const resp = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, html, text })
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.message || result.error || 'Error del Worker');
  return result;
}

// ── Log helper ────────────────────────────────────────────────
function addLog(message, type = 'info', consoleId = null) {
  const now = new Date();
  const t = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  sessionLogs.push({ time: t, message, type });
  sessionActionCount++;
  document.getElementById('stat-logs').textContent = sessionActionCount;
  const line = `<div class="log-line"><span class="log-time">${t}</span><span class="log-msg ${type}">${message}</span></div>`;
  const fullLog = document.getElementById('log-full');
  if (fullLog.querySelector('.log-empty')) fullLog.innerHTML = '';
  fullLog.insertAdjacentHTML('beforeend', line);
  fullLog.scrollTop = fullLog.scrollHeight;
  const dashLog = document.getElementById('log-dashboard');
  if (dashLog.querySelector('.log-empty')) dashLog.innerHTML = '';
  dashLog.insertAdjacentHTML('beforeend', line);
  dashLog.scrollTop = dashLog.scrollHeight;
  if (consoleId) {
    const specific = document.getElementById(consoleId);
    if (specific) {
      if (specific.querySelector('.log-empty')) specific.innerHTML = '';
      specific.insertAdjacentHTML('beforeend', line);
      specific.scrollTop = specific.scrollHeight;
    }
  }
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}


// ── Last updated indicator ────────────────────────────────
function setLastUpdated(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const now = new Date().toLocaleString('es-MX', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  el.textContent = 'Actualizado: ' + now + ' ET';
}

// ── Clear form ────────────────────────────────────────────────
function clearForm(prefix) {
  ['nombre','email','password','email-personal'].forEach(f => {
    const el = document.getElementById(prefix + '-' + f);
    if (el) el.value = '';
  });
}

function clearAllLogs() {
  ['log-full','log-dashboard','log-emp','log-agt','log-rst'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div class="log-empty"><div class="log-empty-icon">🗑</div><div class="log-empty-text">Logs limpiados</div></div>';
  });
  sessionLogs.length = 0;
}

// ── Validar formulario ────────────────────────────────────────
function validateForm(prefix) {
  const nombre = document.getElementById(prefix + '-nombre').value.trim();
  const email  = document.getElementById(prefix + '-email').value.trim();
  const pers   = document.getElementById(prefix + '-email-personal').value.trim();
  if (!nombre) { showToast('Falta el nombre del usuario'); return false; }
  if (!email)  { showToast('Falta el email corporativo'); return false; }
  if (!pers)   { showToast('Falta el email personal'); return false; }
  return { nombre, email, pers };
}

// ── Verificar API key ─────────────────────────────────────────
function checkApiKey() {
  return true; // API Key vive segura en el Worker
}

// ── Reset Password — integrado con Workspace ─────────────────
let rstSelectedUser = null;

function filterResetUsers() {
  const q = document.getElementById('rst-search').value.toLowerCase();
  const sug = document.getElementById('rst-suggestions');
  if (!q || q.length < 2 || !window._workspaceUsers) { sug.style.display = 'none'; return; }
  const matches = window._workspaceUsers.filter(u =>
    (u.nombre||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q)
  ).slice(0, 8);
  if (!matches.length) { sug.style.display = 'none'; return; }
  sug.style.display = 'block';
  sug.innerHTML = matches.map(u =>
    '<div onclick="selectResetUser(\'' + u.email + '\',\'' + u.nombre + '\',\'' + u.estado + '\')" '
    + 'style="padding:10px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--hero-border);" '
    + 'onmouseover="this.style.background=\'var(--hero-bg)\'" onmouseout="this.style.background=\'\'">'
    + '<div style="font-weight:600;color:var(--hero-text-primary);">' + u.nombre + '</div>'
    + '<div style="font-size:11px;color:var(--hero-text-muted);">' + u.email + ' · ' + u.estado + '</div></div>'
  ).join('');
}

function selectResetUser(email, nombre, estado) {
  rstSelectedUser = { email, nombre, estado };
  document.getElementById('rst-search').value = nombre;
  document.getElementById('rst-suggestions').style.display = 'none';
  document.getElementById('rst-sel-nombre').textContent = nombre;
  document.getElementById('rst-sel-email').textContent  = email;
  document.getElementById('rst-sel-estado').textContent = 'Estado: ' + estado;
  document.getElementById('rst-selected').style.display = 'block';
  addLog('Usuario seleccionado: ' + email, 'info', 'log-rst');
}

function clearResetUser() {
  rstSelectedUser = null;
  document.getElementById('rst-search').value = '';
  document.getElementById('rst-selected').style.display = 'none';
  document.getElementById('rst-new-password').value = '';
}

function generateResetPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#*$';
  let pwd = upper[Math.floor(Math.random()*upper.length)]
    + lower[Math.floor(Math.random()*lower.length)]
    + digits[Math.floor(Math.random()*digits.length)]
    + special[Math.floor(Math.random()*special.length)];
  const all = upper + lower + digits + special;
  for (let i = 0; i < 8; i++) pwd += all[Math.floor(Math.random()*all.length)];
  pwd = pwd.split('').sort(() => Math.random()-0.5).join('');
  document.getElementById('rst-new-password').value = pwd;
  navigator.clipboard?.writeText(pwd).catch(()=>{});
  showToast('Contraseña generada y copiada');
}

async function executeReset() {
  if (!rstSelectedUser) { showToast('Selecciona un usuario primero'); return; }
  const password = document.getElementById('rst-new-password').value.trim();
  if (!password) { showToast('Genera o escribe una contraseña temporal'); return; }

  const btn = document.getElementById('btn-exec-reset');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Reseteando...';
  addLog('Reseteando contraseña de ' + rstSelectedUser.email + '...', 'warn', 'log-rst');

  try {
    // 1. Reset en Workspace
    const resp = await fetch(WORKER_URL + '/user-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: rstSelectedUser.email, action: 'reset', newPassword: password })
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Error en Workspace');
    addLog('Contraseña reseteada en Workspace', 'success', 'log-rst');

    // 2. Enviar email de notificación al correo corporativo
    await sendViaResend({
      to: rstSelectedUser.email,
      subject: 'Restablecimiento de contraseña - Hero Insurance USA',
      html: buildEmailReset(rstSelectedUser.nombre, rstSelectedUser.email, password),
      text: 'Hola ' + rstSelectedUser.nombre + ', tu contraseña ha sido restablecida. Nueva contraseña temporal: ' + password,
    });
    addLog('Email de notificación enviado a ' + rstSelectedUser.email, 'success', 'log-rst');

    auditLog('reset', 'Contraseña reseteada: ' + rstSelectedUser.nombre, rstSelectedUser.email);
    showToast('Contraseña reseteada y usuario notificado');
    clearResetUser();
  } catch(err) {
    addLog('Error: ' + err.message, 'error', 'log-rst');
    showToast('Error: ' + err.message);
  }

  btn.disabled = false;
  btn.innerHTML = '🔑 Resetear contraseña en Workspace y notificar';
}


// ── Config ────────────────────────────────────────────────────
function saveConfig() {
  // El API Key ya no se guarda aquí — vive seguro en el Worker
}

async function testConexion() {
  addLog('Enviando email de prueba via Worker...', 'info');
  try {
    const resp = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'onboarding' + atSign + 'resend.dev',
        to: 'it' + atSign + 'heroinsuranceusa.com',
        subject: 'Hero IT Console - Conexion verificada',
        html: '<p><strong>Conexion con Resend verificada correctamente.</strong> El sistema esta listo para enviar emails.</p>',
        text: 'Conexion con Resend verificada. El sistema esta listo.'
      })
    });
    const result = await resp.json();
    const ts = new Date().toLocaleTimeString('es-MX');
    document.getElementById('cfg-last-test').textContent = ts;
    if (resp.ok) {
      addLog('Conexion exitosa - revisa tu correo it' + atSign + 'heroinsuranceusa.com', 'success');
      showToast('Conexion exitosa - revisa tu correo');
      document.getElementById('global-status').textContent = 'RESEND OK';
      document.getElementById('global-status').style.color = 'var(--hero-success)';
    } else {
      addLog('Error ' + resp.status + ': ' + (result.message || result.error || JSON.stringify(result)), 'error');
      showToast('Error: ' + (result.message || result.error || resp.status));
    }
  } catch (e) {
    addLog('Error de red: ' + e.message, 'error');
    showToast('Error de conexion');
  }
}

// ── Email templates ───────────────────────────────────────────
function buildEmailEmpleado(nombre, email, password) {
  var t=['https://i.imgur.com/CcVDV8K.png|Gather Town|Oficina virtual.|https://app.v2.gather.town/app/hero-insurance-usa-2e9e375c-6dcb-40c4-b607-d0791d5dfb78','https://cdn-1.webcatalog.io/catalog/fathom-video/fathom-video-icon-filled-256.png|Fathom|Graba reuniones.|https://fathom.video','https://i.imgur.com/7d0c77c.png|Scribe|Guias automaticas.|https://scribehow.com','https://img.icons8.com/color/1200/express-vpn.jpg|ExpressVPN|Conexion segura.|https://www.expressvpn.com','https://i.imgur.com/4WZmKFm.png|ClickUp|Gestion de tareas.|https://app.clickup.com'].map(function(x){var p=x.split('|');return '<table cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:8px"><tr><td width="48" valign="top" style="padding-right:12px"><img src="'+p[0]+'" width="40" height="40" style="width:40px;height:40px;border-radius:10px;display:block"/></td><td valign="top"><p style="margin:0 0 2px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#1a202c">'+p[1]+'</p><p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#718096">'+p[2]+'</p></td></tr></table>';}).join('');
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#f0f4f8"><table cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td style="padding:32px 16px"><table cellspacing="0" cellpadding="0" border="0" width="600" align="center" style="background:#fff;border-radius:16px;overflow:hidden"><tr><td style="background:linear-gradient(135deg,#0065F3,#19CDEB);padding:36px 40px;text-align:center"><img src="https://i.imgur.com/mZDIi6V.png" width="160" style="display:block;margin:0 auto 16px"/><h1 style="margin:0;font-family:Arial,sans-serif;font-size:26px;font-weight:900;color:#fff">Bienvenido, '+nombre+'!</h1></td></tr><tr><td style="padding:32px 40px;background:#fff"><p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:14px;color:#2d3748">Hola <strong>'+nombre+'</strong>, aqui estan tus credenciales de acceso:</p><div style="background:#f7faff;border-radius:12px;border:1px solid #e2eaf8;margin-bottom:20px"><div style="padding:12px 20px;background:#eef4ff;border-radius:12px 12px 0 0;font-family:Arial,sans-serif;font-size:11px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#0065F3">Cuenta Corporativa</div><div style="padding:16px 20px"><div style="padding:12px;background:#fff;border-radius:8px;border:1px solid #dde8ff;margin-bottom:10px"><p style="margin:0 0 3px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#8fa6cc">Correo corporativo</p><p style="margin:0;font-family:Courier New,monospace;font-size:14px;font-weight:700;color:#0065F3">'+email+'</p></div><div style="padding:12px;background:#fff8e6;border-radius:8px;border:1px solid #f5d87a"><p style="margin:0 0 3px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#b08a00">Contrasena Temporal</p><p style="margin:0;font-family:Courier New,monospace;font-size:14px;font-weight:700;color:#7a5f00">'+(password||'(asignada al iniciar sesion)')+'</p></div></div></div><div style="background:#f7faff;border-radius:12px;border:1px solid #e2eaf8;margin-bottom:20px"><div style="padding:12px 20px;background:#eef4ff;border-radius:12px 12px 0 0;font-family:Arial,sans-serif;font-size:11px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#0065F3">Herramientas</div><div style="padding:16px 20px">'+t+'</div></div><div style="background:#fff8f8;border-radius:12px;border:1px solid #ffd4d4;padding:14px 20px;margin-bottom:20px"><p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#cc3333">Seguridad</p><ul style="margin:0;padding:0 0 0 16px;font-family:Arial,sans-serif;font-size:13px;color:#4a5568;line-height:1.8"><li>Tu cuenta es personal</li><li>No compartas tu contrasena</li><li>La informacion es confidencial</li></ul></div><div style="background:linear-gradient(135deg,#eef4ff,#e6f7ff);border-radius:12px;border:1px solid #c5deff;padding:18px 20px"><p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#1a202c">Tienes algun inconveniente?</p><p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:12px;color:#4a5568">Nuestro equipo de IT esta disponible.</p><a href="https://forms.gle/8dkvmbgAFwqVx2Mj9" style="display:inline-block;padding:10px 20px;background:#0065F3;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:700;text-decoration:none;border-radius:8px">Solicitar soporte IT</a></div></td></tr><tr><td style="padding:14px 40px 20px;background:#f0f4f8;text-align:center"><p style="margin:0;font-family:Arial,sans-serif;font-size:10px;color:#a0aec0">CONFIDENTIALITY NOTICE: This email is intended solely for the addressee.</p></td></tr></table></td></tr></table></body></html>';
}

function buildEmailAgente(nombre, email, password) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#f0f4f8"><table cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td style="padding:32px 16px"><table cellspacing="0" cellpadding="0" border="0" width="600" align="center" style="background:#fff;border-radius:16px;overflow:hidden"><tr><td style="background:linear-gradient(135deg,#0065F3,#19CDEB);padding:36px 40px;text-align:center"><img src="https://i.imgur.com/mZDIi6V.png" width="160" style="display:block;margin:0 auto 16px"/><h1 style="margin:0;font-family:Arial,sans-serif;font-size:26px;font-weight:900;color:#fff">Bienvenido, '+nombre+'!</h1></td></tr><tr><td style="padding:32px 40px;background:#fff"><p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:14px;color:#2d3748">Hola <strong>'+nombre+'</strong>, aqui estan tus credenciales de acceso:</p><div style="background:#f7faff;border-radius:12px;border:1px solid #e2eaf8;margin-bottom:20px"><div style="padding:12px 20px;background:#eef4ff;border-radius:12px 12px 0 0;font-family:Arial,sans-serif;font-size:11px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#0065F3">Cuenta Corporativa</div><div style="padding:16px 20px"><div style="padding:12px;background:#fff;border-radius:8px;border:1px solid #dde8ff;margin-bottom:10px"><p style="margin:0 0 3px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#8fa6cc">Correo corporativo</p><p style="margin:0;font-family:Courier New,monospace;font-size:14px;font-weight:700;color:#0065F3">'+email+'</p></div><div style="padding:12px;background:#fff8e6;border-radius:8px;border:1px solid #f5d87a"><p style="margin:0 0 3px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#b08a00">Contrasena Temporal</p><p style="margin:0;font-family:Courier New,monospace;font-size:14px;font-weight:700;color:#7a5f00">'+(password||'(asignada al iniciar sesion)')+'</p></div></div></div><div style="background:#fff8f8;border-radius:12px;border:1px solid #ffd4d4;padding:14px 20px;margin-bottom:20px"><p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#cc3333">Seguridad</p><ul style="margin:0;padding:0 0 0 16px;font-family:Arial,sans-serif;font-size:13px;color:#4a5568;line-height:1.8"><li>Tu cuenta es personal</li><li>No compartas tu contrasena</li><li>La informacion es confidencial</li></ul></div><div style="background:linear-gradient(135deg,#eef4ff,#e6f7ff);border-radius:12px;border:1px solid #c5deff;padding:18px 20px"><p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#1a202c">Tienes algun inconveniente?</p><p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:12px;color:#4a5568">Nuestro equipo de IT esta disponible.</p><a href="https://forms.gle/8dkvmbgAFwqVx2Mj9" style="display:inline-block;padding:10px 20px;background:#0065F3;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:700;text-decoration:none;border-radius:8px">Solicitar soporte IT</a></div></td></tr><tr><td style="padding:14px 40px 20px;background:#f0f4f8;text-align:center"><p style="margin:0;font-family:Arial,sans-serif;font-size:10px;color:#a0aec0">CONFIDENTIALITY NOTICE: This email is intended solely for the addressee.</p></td></tr></table></td></tr></table></body></html>';
}

function buildEmailReset(nombre, emailCorp, password) {
  var now = new Date();
  var fecha = now.toLocaleDateString('es-ES', { timeZone:'America/New_York', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
  return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><style>body{margin:0;padding:0;background:#f0f4f8;font-family:Arial,sans-serif;}</style></head><body style="margin:0;padding:0;background:#f0f4f8;">'
  + '<table cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f0f4f8;"><tr><td style="padding:32px 16px;">'
  + '<table cellspacing="0" cellpadding="0" border="0" width="600" align="center" style="background:#fff;border-radius:16px;overflow:hidden;">'
  + '<tr><td style="background:linear-gradient(135deg,#0A1628,#0065F3);padding:36px 40px;text-align:center;">'
  + '<img src="https://i.imgur.com/mZDIi6V.png" width="160" style="display:block;margin:0 auto 20px;"/>'
  + '<h1 style="margin:0;font-size:24px;font-weight:900;color:#fff;">Restablecimiento de Contrasena</h1>'
  + '<p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.75);">Se ha generado una nueva contrasena temporal.</p></td></tr>'
  + '<tr><td style="padding:36px 40px;">'
  + '<p style="margin:0 0 20px;font-size:15px;color:#2d3748;">Hola <strong>' + nombre + '</strong>, hemos procesado el restablecimiento de tu contrasena.</p>'
  + '<div style="background:#fff8e6;border-radius:12px;border:1px solid #f5d87a;border-left:4px solid #f0b429;padding:14px 18px;margin-bottom:20px;">'
  + '<p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#b08a00;text-transform:uppercase;letter-spacing:1px;">Aviso de seguridad</p>'
  + '<p style="margin:0;font-size:13px;color:#7a5f00;">Si no solicitaste este cambio, contacta de inmediato al equipo de IT.</p></div>'
  + '<div style="background:#f7faff;border-radius:12px;border:1px solid #e2eaf8;margin-bottom:20px;">'
  + '<div style="padding:12px 20px;background:#eef4ff;border-radius:12px 12px 0 0;font-size:11px;font-weight:900;letter-spacing:2px;color:#0065F3;text-transform:uppercase;">Nuevas credenciales</div>'
  + '<div style="padding:18px 20px;">'
  + '<div style="padding:12px;background:#fff;border-radius:8px;border:1px solid #dde8ff;margin-bottom:10px;">'
  + '<div style="font-size:10px;font-weight:700;color:#8fa6cc;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Correo corporativo</div>'
  + '<div style="font-family:monospace;font-size:14px;font-weight:700;color:#0065F3;">' + emailCorp + '</div></div>'
  + '<div style="padding:12px;background:#f0fff4;border-radius:8px;border:1px solid #9ae6b4;">'
  + '<div style="font-size:10px;font-weight:700;color:#276749;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Nueva contrasena temporal</div>'
  + '<div style="font-family:monospace;font-size:14px;font-weight:700;color:#22543d;">' + (password || 'Se te asignara una contrasena al iniciar sesion') + '</div></div>'
  + '</div></div>'
  + '<div style="background:#eef4ff;border-radius:12px;border:1px solid #c5deff;padding:18px 20px;margin-bottom:20px;">'
  + '<p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#1a202c;">Necesitas ayuda?</p>'
  + '<p style="margin:0 0 10px;font-size:12px;color:#4a5568;">Si no reconoces esta solicitud, contacta al equipo de IT de inmediato.</p>'
  + '<a href="https://forms.gle/8dkvmbgAFwqVx2Mj9" style="display:inline-block;padding:10px 20px;background:#0065F3;color:#fff;font-size:12px;font-weight:700;text-decoration:none;border-radius:8px;">Contactar soporte IT</a></div>'
  + '<div style="text-align:center;padding:12px;background:#f7faff;border-radius:10px;border:1px solid #e2eaf8;">'
  + '<p style="margin:0;font-family:monospace;font-size:11px;color:#a0aec0;">Solicitud procesada el ' + fecha + ' (ET)</p></div>'
  + '</td></tr>'
  + '<tr><td style="padding:14px 40px;background:#f0f4f8;text-align:center;">'
  + '<p style="margin:0;font-size:10px;color:#a0aec0;">CONFIDENTIALITY NOTICE: This email is intended solely for the addressee. If you are not the intended recipient, please notify the sender immediately.</p>'
  + '</td></tr></table></td></tr></table></body></html>';
}

// ── Gestión de usuarios Workspace ────────────────────────────
let currentUserEmail = null;

function openUserModal(email, nombre) {
  currentUserEmail = email;
  document.getElementById('um-email').textContent = email;
  document.getElementById('um-nombre').textContent = nombre;
  document.getElementById('um-new-password').value = '';
  document.getElementById('user-modal').style.display = 'block';
}

function closeUserModal() {
  document.getElementById('user-modal').style.display = 'none';
  currentUserEmail = null;
}

function generateUserPassword() {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower   = 'abcdefghjkmnpqrstuvwxyz';
  const digits  = '23456789';
  const special = '!@#*$';
  // Guarantee at least one of each type
  let pwd = '';
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += lower[Math.floor(Math.random() * lower.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  pwd += special[Math.floor(Math.random() * special.length)];
  // Fill remaining 8 chars from all pools
  const all = upper + lower + digits + special;
  for (let i = 0; i < 8; i++) pwd += all[Math.floor(Math.random() * all.length)];
  // Shuffle
  pwd = pwd.split('').sort(() => Math.random() - 0.5).join('');
  document.getElementById('um-new-password').value = pwd;
  // Copy to clipboard silently
  navigator.clipboard?.writeText(pwd).catch(() => {});
  showToast('Contraseña generada y copiada al portapapeles');
}

async function userAction(action) {
  if (!currentUserEmail) return;
  const email  = currentUserEmail;
  const nombre = document.getElementById('um-nombre').textContent;

  const labels = { reset: 'resetear contraseña', suspend: 'suspender', restore: 'restaurar' };
  const newPassword = action === 'reset' ? document.getElementById('um-new-password').value.trim() : null;

  if (action === 'reset' && !newPassword) {
    showToast('Ingresa o genera una contraseña temporal primero'); return;
  }

  addLog('Ejecutando ' + labels[action] + ' para ' + email + '...', 'info');

  try {
    const resp = await fetch(WORKER_URL + '/user-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, action, newPassword })
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Error');

    const msgs = {
      reset:   'Contraseña reseteada para ' + nombre,
      suspend: 'Cuenta suspendida: ' + nombre,
      restore: 'Cuenta restaurada: ' + nombre,
    };
    addLog(msgs[action], 'success');
    auditLog('usuario', msgs[action], email);

    // #1 — Enviar email de notificación al usuario cuando se resetea su contraseña
    if (action === 'reset' && newPassword) {
      try {
        await sendViaResend({
          to: email,
          subject: 'Restablecimiento de contraseña - Hero Insurance USA',
          html: buildEmailReset(nombre, email, newPassword),
          text: 'Hola ' + nombre + ', tu contraseña ha sido restablecida. Correo: ' + email + ' / Nueva contraseña temporal: ' + newPassword,
        });
        addLog('Email de reset enviado a ' + email, 'success');
      } catch(emailErr) {
        addLog('Contraseña reseteada pero email falló: ' + emailErr.message, 'warn');
      }
    }

    showToast(msgs[action]);
    closeUserModal();
    loadUsers();
  } catch (err) {
    addLog('Error: ' + err.message, 'error');
    showToast('Error: ' + err.message);
  }
}

async function confirmDeleteUser() {
  if (!currentUserEmail) return;
  const email = currentUserEmail;
  const nombre = document.getElementById('um-nombre').textContent;

  if (!confirm('¿Estás seguro de que deseas eliminar permanentemente a ' + nombre + ' (' + email + ')?\n\nEsta acción no se puede deshacer.')) return;

  addLog('Eliminando usuario ' + email + '...', 'warn');
  try {
    const resp = await fetch(WORKER_URL + '/user-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, action: 'delete' })
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Error al eliminar');

    addLog('Usuario eliminado: ' + nombre + ' (' + email + ')', 'warn');
    auditLog('usuario', 'Usuario eliminado de Workspace: ' + nombre, email);
    showToast('Usuario eliminado');
    closeUserModal();
    loadUsers();
  } catch (err) {
    addLog('Error: ' + err.message, 'error');
    showToast('Error: ' + err.message);
  }
}

// ── Módulo Auditoría ──────────────────────────────────────────
let allAuditEntradas = [];

const AUDIT_TIPO_COLOR = {
  email:   'var(--hero-primary)',
  reset:   'var(--hero-warning)',
  usuario: 'var(--hero-primary-dark)',
  ticket:  'var(--hero-success)',
};
const AUDIT_TIPO_ICON = {
  email: '✉️', reset: '🔑', usuario: '👤', ticket: '🎫',
};

async function loadAudit() {
  const btn = document.getElementById('btn-load-audit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const tipo = document.getElementById('audit-filter-tipo').value;
    const q    = document.getElementById('audit-search').value.trim();
    let endpoint = WORKER_URL + '/audit?limit=500';
    if (tipo) endpoint += '&tipo=' + tipo;
    if (q)    endpoint += '&q=' + encodeURIComponent(q);

    const resp = await fetch(endpoint);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    allAuditEntradas = data.entradas || [];
    renderAudit(allAuditEntradas, data.total);
    setLastUpdated('audit-last-updated');
  } catch(err) {
    document.getElementById('audit-body').innerHTML =
      '<div style="text-align:center;padding:32px;color:var(--hero-error);font-family:var(--mono);font-size:12px;">Error: ' + err.message + '</div>';
  }
  btn.disabled = false;
  btn.innerHTML = '↺ Actualizar';
}

function searchAudit() {
  clearTimeout(window._auditSearchTimeout);
  window._auditSearchTimeout = setTimeout(loadAudit, 400);
}

function renderAudit(entradas, total) {
  const count = document.getElementById('audit-count');
  count.textContent = entradas.length + (total > entradas.length ? ' de ' + total : '') + ' entrada' + (entradas.length !== 1 ? 's' : '');

  const body = document.getElementById('audit-body');
  if (!entradas.length) {
    body.innerHTML = '<div class="log-empty"><div class="log-empty-icon">📭</div><div class="log-empty-text">Sin entradas con estos filtros</div></div>';
    return;
  }

  body.innerHTML = entradas.map(e => {
    const fecha = new Date(e.fecha).toLocaleString('es-MX', {
      timeZone: 'America/New_York', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const color = AUDIT_TIPO_COLOR[e.tipo] || 'var(--hero-text-body)';
    const icon  = AUDIT_TIPO_ICON[e.tipo] || '●';
    return '<div style="display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--hero-border-card);">'
      + '<span style="font-size:14px;flex-shrink:0;margin-top:2px;">' + icon + '</span>'
      + '<div style="flex:1;min-width:0;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">'
      + '<span style="font-size:13px;color:var(--hero-text-primary);font-weight:500;">' + e.descripcion + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;color:var(--hero-text-muted);flex-shrink:0;">' + fecha + ' ET</span>'
      + '</div>'
      + (e.detalle ? '<div style="font-family:var(--mono);font-size:11px;color:var(--hero-text-muted);margin-top:3px;">' + e.detalle + '</div>' : '')
      + '<span style="font-family:var(--mono);font-size:10px;padding:1px 7px;border-radius:10px;background:rgba(0,0,0,0.06);color:' + color + ';margin-top:4px;display:inline-block;">' + e.tipo + '</span>'
      + '</div>'
      + '</div>';
  }).join('');
}

function exportAuditCSV() {
  if (!allAuditEntradas.length) { showToast('Carga el historial primero'); return; }
  const header = 'Fecha ET,Tipo,Descripcion,Detalle,Usuario';
  const rows = allAuditEntradas.map(e => {
    const fecha = new Date(e.fecha).toLocaleString('es-MX', { timeZone:'America/New_York' });
    return [fecha, e.tipo, e.descripcion, e.detalle || '', e.usuario || '']
      .map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',');
  });
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'hero-auditoria-' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  showToast('CSV exportado');
}

// ── Módulo Tickets de Soporte ─────────────────────────────────
let allTickets = [];
let currentTicketId = null;
let ticketView = 'kanban';

const PRIORIDAD_COLOR = {
  Baja:    { color: '#22a06b', bg: 'rgba(34,160,107,0.12)' },
  Media:   { color: '#e8a317', bg: 'rgba(232,163,23,0.12)'  },
  Alta:    { color: '#e8a317', bg: 'rgba(232,163,23,0.12)'  },
  Urgente: { color: '#d64545', bg: 'rgba(214,69,69,0.12)'   },
};

const QUICK_REPLIES = {
  revisando: 'Hola, hemos recibido tu ticket y estamos revisando el problema. Te contactaremos pronto con una solución.',
  info:      'Hola, para poder ayudarte necesitamos información adicional. ¿Podrías indicarnos...?',
  resuelto:  'Hola, hemos resuelto el problema reportado. Por favor verifica que todo funcione correctamente. Si el problema persiste, no dudes en contactarnos.',
  remoto:    'Hola, para resolver este problema necesitamos conectarnos remotamente a tu equipo via Zoho Assist. ¿Cuándo tienes disponibilidad?',
};

function setTicketView(view) {
  ticketView = view;
  document.getElementById('tickets-kanban').style.display = view === 'kanban' ? 'grid' : 'none';
  document.getElementById('tickets-list').style.display   = view === 'list'   ? 'block' : 'none';
  document.getElementById('btn-view-kanban').style.background = view === 'kanban' ? 'var(--hero-primary)' : 'transparent';
  document.getElementById('btn-view-kanban').style.color      = view === 'kanban' ? '#fff' : 'var(--hero-text-muted)';
  document.getElementById('btn-view-list').style.background   = view === 'list'   ? 'var(--hero-primary)' : 'transparent';
  document.getElementById('btn-view-list').style.color        = view === 'list'   ? '#fff' : 'var(--hero-text-muted)';
  filterTickets();
}

function getElapsedTime(fechaStr) {
  const diff = Date.now() - new Date(fechaStr).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(h / 24);
  if (d > 0)  return d + 'd';
  if (h > 0)  return h + 'h';
  return Math.floor(diff / 60000) + 'm';
}

function getElapsedColor(fechaStr, estado) {
  if (estado === 'resuelto') return 'var(--hero-success)';
  const h = (Date.now() - new Date(fechaStr).getTime()) / 3600000;
  if (h > 24) return 'var(--hero-danger)';
  if (h > 8)  return '#e8a317';
  return 'var(--hero-text-muted)';
}

async function loadTickets() {
  const btn = document.getElementById('btn-load-tickets');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  try {
    const resp = await fetch(WORKER_URL + '/ticket');
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    allTickets = data.tickets || [];
    filterTickets();
    setLastUpdated('tickets-last-updated');
    addLog('Tickets cargados: ' + allTickets.length, 'info');
  } catch(err) {
    addLog('Error cargando tickets: ' + err.message, 'error');
  }
  if (btn) { btn.disabled = false; btn.innerHTML = '↺ Actualizar'; }
}

function filterTickets() {
  const prioridad  = document.getElementById('ticket-filter-prioridad')?.value || '';
  const categoria  = document.getElementById('ticket-filter-categoria')?.value  || '';
  const q          = document.getElementById('ticket-search')?.value.toLowerCase() || '';
  let filtered = allTickets;
  if (prioridad) filtered = filtered.filter(t => t.prioridad === prioridad);
  if (categoria) filtered = filtered.filter(t => t.categoria === categoria);
  if (q)         filtered = filtered.filter(t =>
    (t.asunto||'').toLowerCase().includes(q) || (t.nombre||'').toLowerCase().includes(q)
  );
  const count = document.getElementById('tickets-count');
  if (count) count.textContent = filtered.length + ' ticket' + (filtered.length !== 1 ? 's' : '');

  if (ticketView === 'kanban') renderKanban(filtered);
  else renderTicketList(filtered);
}

function renderKanban(tickets) {
  const cols = { 'abierto': [], 'en progreso': [], 'resuelto': [] };
  tickets.forEach(t => { if (cols[t.estado] !== undefined) cols[t.estado].push(t); });

  Object.entries(cols).forEach(([estado, items]) => {
    const key = estado.replace(' ', '-');
    const countEl = document.getElementById('count-' + key);
    const cardsEl = document.getElementById('cards-' + key);
    if (countEl) countEl.textContent = items.length;
    if (!cardsEl) return;
    if (!items.length) {
      cardsEl.innerHTML = '<div style="text-align:center;padding:20px;font-size:11px;color:var(--hero-text-muted);opacity:0.6;">Sin tickets</div>';
      return;
    }
    cardsEl.innerHTML = items.map(t => {
      const pc = PRIORIDAD_COLOR[t.prioridad] || PRIORIDAD_COLOR.Media;
      const elapsed = getElapsedTime(t.fecha);
      const elColor = getElapsedColor(t.fecha, t.estado);
      return '<div class="kanban-card" style="--card-pcolor:' + pc.color + ';" onclick="openTicketModal(\'' + t.id + '\')">' 
        + '<div class="kanban-card-title">' + t.asunto + '</div>'
        + '<div class="kanban-card-meta">' + t.nombre + ' · ' + t.categoria + '</div>'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">'
        + '<span style="font-size:10px;padding:2px 7px;border-radius:20px;background:' + pc.bg + ';color:' + pc.color + ';font-weight:600;">' + t.prioridad + '</span>'
        + '<span class="kanban-card-time" style="color:' + elColor + ';">⏱ ' + elapsed + '</span>'
        + '</div></div>';
    }).join('');
  });
}

function renderTicketList(tickets) {
  const container = document.getElementById('tickets-list');
  if (!tickets.length) {
    container.innerHTML = '<div class="info-box" style="text-align:center;padding:40px;"><div style="font-size:32px;opacity:0.3;margin-bottom:12px;">📭</div><div style="font-size:12px;color:var(--hero-text-muted);">Sin tickets</div></div>';
    return;
  }
  const estadoColor = { 'abierto': '#d64545', 'en progreso': '#e8a317', 'resuelto': '#22a06b' };
  container.innerHTML = tickets.map(t => {
    const pc = PRIORIDAD_COLOR[t.prioridad] || PRIORIDAD_COLOR.Media;
    const elapsed = getElapsedTime(t.fecha);
    const elColor = getElapsedColor(t.fecha, t.estado);
    return '<div class="action-card" style="margin-bottom:10px;cursor:pointer;--card-color:' + (estadoColor[t.estado]||'var(--hero-border)') + ';" onclick="openTicketModal(\'' + t.id + '\'">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      + '<span style="font-family:var(--mono);font-size:11px;color:var(--hero-primary);">' + t.ticketId + '</span>'
      + '<span style="font-size:10px;padding:2px 7px;border-radius:20px;background:' + pc.bg + ';color:' + pc.color + ';font-weight:600;">' + t.prioridad + '</span>'
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      + '<span style="font-size:10px;color:' + elColor + ';font-family:var(--mono);">⏱ ' + elapsed + '</span>'
      + '<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(0,0,0,0.05);color:' + (estadoColor[t.estado]||'#444') + ';">' + t.estado + '</span>'
      + '</div></div>'
      + '<div style="font-size:13px;font-weight:600;color:var(--hero-text-primary);margin-bottom:3px;">' + t.asunto + '</div>'
      + '<div style="font-size:12px;color:var(--hero-text-muted);">' + t.nombre + ' · ' + t.categoria + '</div>'
      + '</div>';
  }).join('');
}

function openTicketModal(id) {
  const t = allTickets.find(x => x.id === id);
  if (!t) return;
  currentTicketId = id;
  document.getElementById('modal-ticket-id').textContent = t.ticketId;
  document.getElementById('modal-asunto').textContent    = t.asunto;
  document.getElementById('modal-nombre').textContent    = t.nombre;
  document.getElementById('modal-email').textContent     = t.email;
  document.getElementById('modal-categoria').textContent = t.categoria;
  const fecha = new Date(t.fecha).toLocaleString('es-MX', { timeZone:'America/New_York', year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  document.getElementById('modal-fecha').textContent = fecha + ' ET';
  const elEl = document.getElementById('modal-elapsed');
  elEl.textContent = '⏱ Abierto hace ' + getElapsedTime(t.fecha);
  elEl.style.color = getElapsedColor(t.fecha, t.estado);
  document.getElementById('modal-descripcion').textContent = t.descripcion;
  document.getElementById('modal-estado').value    = t.estado;
  document.getElementById('modal-prioridad').value = t.prioridad;
  document.getElementById('modal-respuesta').value = '';

  // Historial
  const hist = t.historial || [];
  const histBox = document.getElementById('modal-historial-box');
  if (hist.length) {
    histBox.style.display = 'block';
    document.getElementById('modal-historial').innerHTML = hist.map(h => {
      const f = new Date(h.fecha).toLocaleString('es-MX', { timeZone:'America/New_York', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
      if (h.tipo === 'estado')    return '<div style="font-size:12px;color:var(--hero-text-muted);padding:4px 0;border-bottom:1px solid var(--hero-border);">📋 Estado: <strong>' + h.de + '</strong> → <strong>' + h.a + '</strong> · <span style="font-family:var(--mono);font-size:10px;">' + f + '</span></div>';
      if (h.tipo === 'respuesta') return '<div style="font-size:12px;color:var(--hero-text-muted);padding:4px 0;border-bottom:1px solid var(--hero-border);">💬 Respuesta enviada · <span style="font-family:var(--mono);font-size:10px;">' + f + '</span></div>';
      return '';
    }).join('');
  } else {
    histBox.style.display = 'none';
  }

  document.getElementById('ticket-modal').style.display = 'block';
}

function closeTicketModal() {
  document.getElementById('ticket-modal').style.display = 'none';
  currentTicketId = null;
}

function setQuickReply(key) {
  const ta = document.getElementById('modal-respuesta');
  ta.value = QUICK_REPLIES[key] || '';
  ta.focus();
}

async function guardarTicket() {
  if (!currentTicketId) return;
  const btn = document.getElementById('btn-guardar-ticket');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Guardando...';
  try {
    const estado    = document.getElementById('modal-estado').value;
    const prioridad = document.getElementById('modal-prioridad').value;
    const respuesta = document.getElementById('modal-respuesta').value.trim();
    const resp = await fetch(WORKER_URL + '/ticket/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: currentTicketId, estado, prioridad, respuesta: respuesta || null })
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Error');
    const t = allTickets.find(x => x.id === currentTicketId);
    auditLog('ticket', 'Ticket ' + (t ? t.ticketId : '') + ' actualizado → ' + estado, respuesta ? 'Respuesta enviada' : null);
    showToast(respuesta ? 'Respuesta enviada al usuario' : 'Ticket actualizado');
    closeTicketModal();
    loadTickets();
  } catch(err) {
    addLog('Error: ' + err.message, 'error');
    showToast('Error: ' + err.message);
  }
  btn.disabled = false;
  btn.innerHTML = '💾 Guardar y notificar usuario';
}

// ── Módulo Solicitudes de Alta ────────────────────────────────
let allSolicitudes = [];
let solFilter = 'all';
let solModalData = null;

function setSolFilter(filter) {
  solFilter = filter;
  document.querySelectorAll('.sol-filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === filter);
  });
  renderSolicitudes();
}

async function loadSolicitudes() {
  const btn = document.getElementById('btn-load-sol');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  try {
    const resp = await fetch(WORKER_URL + '/alta-agente');
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    allSolicitudes = data.solicitudes || [];
    updateSolStats();
    renderSolicitudes();
  } catch(err) {
    document.getElementById('sol-list').innerHTML =
      '<div class="info-box" style="text-align:center;padding:32px;border-color:rgba(214,69,69,0.3);">'
      + '<div style="color:var(--hero-danger);font-size:12px;">Error: ' + err.message + '</div></div>';
  }
  if (btn) { btn.disabled = false; btn.innerHTML = '↺ Actualizar'; }
}

function updateSolStats() {
  const total   = allSolicitudes.length;
  const pending = allSolicitudes.filter(s => s.estado === 'pendiente').length;
  const done    = total - pending;
  const elT = document.getElementById('sol-stat-total');
  const elP = document.getElementById('sol-stat-pending');
  const elD = document.getElementById('sol-stat-done');
  if (elT) elT.textContent = total;
  if (elP) elP.textContent = pending;
  if (elD) elD.textContent = done;
}

function renderSolicitudes() {
  const q = (document.getElementById('sol-search')?.value || '').toLowerCase();
  let filtered = allSolicitudes;
  if (solFilter !== 'all') filtered = filtered.filter(s => s.estado === solFilter);
  if (q) filtered = filtered.filter(s =>
    (s.nombre||'').toLowerCase().includes(q) ||
    (s.apellido||'').toLowerCase().includes(q) ||
    (s.correo||'').toLowerCase().includes(q) ||
    (s.solicitanteNombre||'').toLowerCase().includes(q)
  );

  const countEl = document.getElementById('sol-count');
  if (countEl) countEl.textContent = filtered.length + ' resultado' + (filtered.length !== 1 ? 's' : '');

  const container = document.getElementById('sol-list');
  if (!filtered.length) {
    container.innerHTML = '<div class="info-box" style="text-align:center;padding:40px;">'
      + '<div style="font-size:32px;opacity:0.3;margin-bottom:12px;">📭</div>'
      + '<div style="font-size:12px;color:var(--hero-text-muted);">Sin solicitudes con estos filtros</div></div>';
    return;
  }

  container.innerHTML = filtered.map(s => {
    const fecha = new Date(s.fecha).toLocaleString('es-MX', {
      timeZone:'America/New_York', year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
    });
    const isPending = s.estado === 'pendiente';
    const estadoColor = isPending ? 'var(--hero-warning)' : 'var(--hero-success)';
    const estadoBg    = isPending ? 'rgba(232,163,23,0.1)' : 'rgba(34,160,107,0.1)';

    // Elapsed time
    const elapsed = getElapsedTime(s.fecha);
    const elColor = getElapsedColor(s.fecha, isPending ? 'abierto' : 'resuelto');

    return '<div class="action-card" style="margin-bottom:12px;--card-color:' + (isPending ? 'var(--hero-warning)' : 'var(--hero-success)') + ';">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">'
      + '<div>'
      + '<div style="font-size:15px;font-weight:600;color:var(--hero-text-primary);">' + s.nombre + ' ' + s.apellido + '</div>'
      + '<div style="font-family:var(--mono);font-size:11px;color:var(--hero-primary);margin-top:2px;">' + s.correo + '</div>'
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      + '<span style="font-family:var(--mono);font-size:10px;color:' + elColor + ';">⏱ ' + elapsed + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;padding:3px 10px;border-radius:20px;background:' + estadoBg + ';color:' + estadoColor + ';">' + s.estado + '</span>'
      + '</div>'
      + '</div>'
      + '<div style="font-size:12px;color:var(--hero-text-body);margin-bottom:6px;">'
      + '<span style="color:var(--hero-text-muted);">Solicitado por: </span>'
      + '<strong>' + (s.solicitanteNombre || 'No especificado') + '</strong>'
      + (s.solicitanteEmail ? ' <span style="font-family:var(--mono);font-size:11px;color:var(--hero-primary);">(' + s.solicitanteEmail + ')</span>' : '')
      + '</div>'
      + '<div style="display:flex;gap:16px;font-size:12px;color:var(--hero-text-muted);margin-bottom:14px;">'
      + '<span>📞 ' + s.telefono + '</span>'
      + '<span>🕐 ' + fecha + ' ET</span>'
      + '</div>'
      + (isPending
        ? '<div style="display:flex;gap:8px;">'
          + '<button class="btn btn-primary" onclick="openSolModal(\'' + s.id + '\')" style="font-size:12px;flex:1;">➕ Crear usuario</button>'
          + '<button class="btn btn-secondary" onclick="rechazarSolicitud(\'' + s.id + '\',\'' + (s.solicitanteEmail||'') + '\',\'' + (s.solicitanteNombre||'') + '\',\'' + s.nombre + ' ' + s.apellido + '\')" style="font-size:12px;">✗ Rechazar</button>'
          + '<button class="btn btn-secondary" onclick="resolverSolicitud(\'' + s.id + '\',\'procesada\')" style="font-size:12px;">✓ Marcar procesada</button>'
          + '</div>'
        : '')
      + '</div>';
  }).join('');
}

async function resolverSolicitud(id, estado) {
  try {
    await fetch(WORKER_URL + '/alta-agente/resolver', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estado })
    });
    showToast('Solicitud marcada como ' + estado);
    auditLog('solicitud', 'Solicitud marcada como ' + estado, id);
    loadSolicitudes();
  } catch(err) { showToast('Error: ' + err.message); }
}

async function rechazarSolicitud(id, solEmail, solNombre, agente) {
  if (!confirm('¿Rechazar la solicitud de alta para ' + agente + '?\n\nSe notificará al solicitante.')) return;
  try {
    await fetch(WORKER_URL + '/alta-agente/resolver', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estado: 'rechazada' })
    });
    // Notify solicitante if email available
    if (solEmail) {
      await sendViaResend({
        to: solEmail,
        subject: 'Solicitud de alta no procesada — ' + agente,
        html: '<div style="font-family:Trebuchet MS,Arial,sans-serif;max-width:600px;background:#f0f4f8;padding:32px 16px;">'
          + '<div style="background:#fff;border-radius:16px;overflow:hidden;">'
          + '<div style="background:linear-gradient(135deg,#06a3b6,#048395);padding:24px 32px;">'
          + '<img src="https://i.ibb.co/tMRCCW07/Hero-Nuevo-Circulo-1.png" width="48" style="border-radius:50%;display:block;margin:0 auto 12px;"/>'
          + '<h2 style="color:#fff;margin:0;text-align:center;font-size:18px;">Solicitud no procesada</h2></div>'
          + '<div style="padding:24px 32px;">'
          + '<p style="font-size:14px;color:#444;">Hola <strong>' + (solNombre||'') + '</strong>, la solicitud de alta para <strong>' + agente + '</strong> no pudo ser procesada en este momento.</p>'
          + '<p style="font-size:13px;color:#777;">Si tienes dudas, comunícate con el equipo de IT.</p>'
          + '</div></div></div>',
        text: 'La solicitud de alta para ' + agente + ' no pudo ser procesada.'
      });
    }
    showToast('Solicitud rechazada' + (solEmail ? ' — solicitante notificado' : ''));
    auditLog('solicitud', 'Solicitud rechazada: ' + agente, solEmail || 'sin email');
    loadSolicitudes();
  } catch(err) { showToast('Error: ' + err.message); }
}

// ── Modal crear usuario desde solicitud ──────────────────────
function openSolModal(id) {
  const s = allSolicitudes.find(x => x.id === id);
  if (!s) return;
  solModalData = s;
  document.getElementById('sol-modal-nombre').textContent = s.nombre + ' ' + s.apellido;
  document.getElementById('sol-modal-solicitante').textContent = s.solicitanteNombre || 'No especificado';
  document.getElementById('sol-modal-solicitante-email').textContent = s.solicitanteEmail || '';
  document.getElementById('sm-nombre').value   = s.nombre;
  document.getElementById('sm-apellido').value = s.apellido;
  // Suggest email
  const sugerido = (s.nombre.charAt(0) + s.apellido).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s/g,'');
  document.getElementById('sm-email-user').value = sugerido;
  document.getElementById('sm-email-preview').textContent = sugerido + '@heroinsuranceusa.com';
  document.getElementById('sm-password').value = '';
  document.getElementById('sol-modal').style.display = 'block';
}

function closeSolModal() {
  document.getElementById('sol-modal').style.display = 'none';
  solModalData = null;
}

function previewSolEmail() {
  const user = document.getElementById('sm-email-user').value.trim();
  const prev = document.getElementById('sm-email-preview');
  if (prev) prev.textContent = user ? user + '@heroinsuranceusa.com' : '';
}

function generateSolPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#*$';
  let pwd = upper[Math.floor(Math.random()*upper.length)]
    + lower[Math.floor(Math.random()*lower.length)]
    + digits[Math.floor(Math.random()*digits.length)]
    + special[Math.floor(Math.random()*special.length)];
  const all = upper + lower + digits + special;
  for (let i = 0; i < 8; i++) pwd += all[Math.floor(Math.random()*all.length)];
  pwd = pwd.split('').sort(() => Math.random()-0.5).join('');
  document.getElementById('sm-password').value = pwd;
  navigator.clipboard?.writeText(pwd).catch(()=>{});
  showToast('Contraseña generada y copiada');
}

async function crearUsuarioDesdeModal() {
  if (!solModalData) return;
  const nombre   = document.getElementById('sm-nombre').value.trim();
  const apellido = document.getElementById('sm-apellido').value.trim();
  const emailUser= document.getElementById('sm-email-user').value.trim();
  const password = document.getElementById('sm-password').value.trim();

  if (!nombre || !apellido || !emailUser || !password) {
    showToast('Completa todos los campos'); return;
  }

  const email = emailUser + '@heroinsuranceusa.com';
  const btn   = document.getElementById('btn-sm-crear');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Creando...';

  try {
    // Create user in Workspace
    const resp = await fetch(WORKER_URL + '/create-user', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre, apellido, email, password,
        solicitanteEmail: solModalData.solicitanteEmail || null,
        solicitanteNombre: solModalData.solicitanteNombre || null,
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error al crear usuario');

    // Mark solicitud as processed
    await resolverSolicitud(solModalData.id, 'procesada');

    // Send onboarding email
    await sendViaResend({
      to: solModalData.correo,
      subject: 'Bienvenido(a) a Hero Insurance USA - Acceso de Agente',
      html: buildEmailAgente(nombre + ' ' + apellido, email, password),
      text: 'Bienvenido ' + nombre + '. Tu correo: ' + email,
    });

    addLog('Usuario creado: ' + email, 'success');
    auditLog('usuario', 'Usuario creado desde solicitud: ' + nombre + ' ' + apellido, email);
    showToast('Usuario creado y solicitante notificado');
    closeSolModal();
    loadSolicitudes();
  } catch(err) {
    showToast('Error: ' + err.message);
    addLog('Error: ' + err.message, 'error');
  }
  btn.disabled = false;
  btn.innerHTML = '✓ Crear usuario y notificar';
}

function procesarAlta(id, nombre, apellido, correo, solicitanteEmail, solicitanteNombre) {
  openSolModal(id);
}

// ── Módulo Crear Usuario ──────────────────────────────────────
let nuevoUsuario = null;

function previewEmail() {
  const user = document.getElementById('new-email-user').value.trim();
  const nombre = document.getElementById('new-nombre').value.trim();
  const apellido = document.getElementById('new-apellido').value.trim();
  const preview = document.getElementById('new-preview');
  if (user || nombre) {
    preview.innerHTML =
      '<span style="color:var(--hero-text-body)">Email: </span><span style="color:var(--hero-primary)">' + (user || '...') + atSign + 'heroinsuranceusa.com</span><br>' +
      '<span style="color:var(--hero-text-body)">Nombre: </span><span style="color:var(--hero-text-primary)">' + (nombre || '—') + ' ' + (apellido || '') + '</span>';
  }
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const special = '!@#*';
  let pwd = '';
  for (let i = 0; i < 10; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  pwd += special[Math.floor(Math.random() * special.length)];
  pwd += Math.floor(Math.random() * 90 + 10);
  document.getElementById('new-password').value = pwd;
}

async function crearUsuario() {
  const nombre   = document.getElementById('new-nombre').value.trim();
  const apellido = document.getElementById('new-apellido').value.trim();
  const emailUser = document.getElementById('new-email-user').value.trim();
  const password  = document.getElementById('new-password').value.trim();
  const emailPers = document.getElementById('new-email-personal').value.trim();

  if (!nombre || !apellido) { showToast('Falta nombre o apellido'); return; }
  if (!emailUser) { showToast('Falta el usuario del email'); return; }
  if (!password)  { showToast('Falta la contraseña temporal'); return; }

  const emailCorp = emailUser + atSign + 'heroinsuranceusa.com';
  const btn = document.getElementById('btn-crear-usuario');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Creando...';
  addLog('Creando usuario ' + emailCorp + ' en Workspace...', 'info', 'log-new');

  try {
    const resp = await fetch(WORKER_URL + '/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre, apellido, email: emailCorp, password,
        solicitanteEmail: window._altaSolicitanteEmail || null,
        solicitanteNombre: window._altaSolicitanteNombre || null,
      })
    });
    const result = await resp.json();

    if (!resp.ok) throw new Error(result.error || 'Error al crear usuario');

    nuevoUsuario = { nombre: nombre + ' ' + apellido, email: emailCorp, password, emailPersonal: emailPers };

    addLog('Usuario creado: ' + emailCorp, 'success', 'log-new');
    auditLog('usuario', 'Usuario creado en Workspace: ' + nombre + ' ' + apellido, emailCorp);
    showToast('Usuario creado en Workspace');

    // Si viene de una solicitud de alta, marcarla como procesada
    if (window._altaId) {
      await resolverSolicitud(window._altaId, 'procesada');
      window._altaId = null;
    }

    const statusBox = document.getElementById('new-status-box');
    statusBox.style.display = 'block';
    document.getElementById('new-status').innerHTML =
      '<span style="color:var(--hero-success); font-family:var(--mono); font-size:12px;">Usuario creado correctamente</span><br>' +
      '<span style="font-family:var(--mono); font-size:11px; color:var(--hero-text-body);">' + emailCorp + '</span>';

    // Mostrar opciones de onboarding si hay email personal
    if (emailPers) {
      document.getElementById('new-onboarding-box').style.display = 'block';
    }

  } catch (err) {
    addLog('Error: ' + err.message, 'error', 'log-new');
    showToast('Error al crear usuario');
  }

  btn.disabled = false;
  btn.innerHTML = '➕ Crear usuario en Workspace';
}

async function sendOnboardingNuevo(tipo) {
  if (!nuevoUsuario) return;
  const btnId = tipo === 'empleado' ? 'btn-ob-emp' : 'btn-ob-agt';
  const btn = document.getElementById(btnId);
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Enviando...';

  addLog('Enviando onboarding ' + tipo + ' a ' + nuevoUsuario.emailPersonal, 'info', 'log-new');

  try {
    const htmlBody = tipo === 'empleado'
      ? buildEmailEmpleado(nuevoUsuario.nombre, nuevoUsuario.email, nuevoUsuario.password)
      : buildEmailAgente(nuevoUsuario.nombre, nuevoUsuario.email, nuevoUsuario.password);
    const asunto = tipo === 'empleado'
      ? 'Bienvenido(a) a Hero Insurance USA - Informacion de acceso'
      : 'Bienvenido(a) a Hero Insurance USA - Acceso de Agente';

    await sendViaResend({ to: nuevoUsuario.emailPersonal, subject: asunto, html: htmlBody,
      text: 'Bienvenido ' + nuevoUsuario.nombre + '. Correo: ' + nuevoUsuario.email });

    addLog('Onboarding enviado a ' + nuevoUsuario.emailPersonal, 'success', 'log-new');
    showToast('Email de onboarding enviado');
    document.getElementById('new-onboarding-box').style.display = 'none';
    resetCrearUsuario();

  } catch (err) {
    addLog('Error enviando onboarding: ' + err.message, 'error', 'log-new');
    showToast('Error al enviar onboarding');
  }
  btn.disabled = false;
  btn.innerHTML = tipo === 'empleado' ? '👤 Enviar como Empleado' : '🤝 Enviar como Agente';
}

function skipOnboarding() {
  document.getElementById('new-onboarding-box').style.display = 'none';
  resetCrearUsuario();
  addLog('Onboarding omitido', 'warn', 'log-new');
}

function resetCrearUsuario() {
  ['new-nombre','new-apellido','new-email-user','new-password','new-email-personal'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('new-preview').innerHTML = 'Completa el formulario para ver la vista previa';
  document.getElementById('new-status-box').style.display = 'none';
  nuevoUsuario = null;
}

// ── Módulo Usuarios Workspace ─────────────────────────────────
let allUsers = [];

async function loadUsers() {
  const btn = document.getElementById('btn-load-users');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Cargando...';
  document.getElementById('usr-count').textContent = '';
  addLog('Consultando usuarios de Google Workspace...', 'info');

  try {
    const resp = await fetch(WORKER_URL + '/users');
    const data = await resp.json();

    if (!resp.ok) throw new Error(data.error || 'Error del Worker');

    allUsers = data.users || [];
    window._workspaceUsers = allUsers; // cache for global search
    addLog('Usuarios cargados: ' + allUsers.length, 'success');
    renderUsers(allUsers);

  } catch (err) {
    addLog('Error al cargar usuarios: ' + err.message, 'error');
    showToast('Error al cargar usuarios');
    document.getElementById('usr-tbody').innerHTML =
      '<tr><td colspan="6" style="padding:32px;text-align:center;color:var(--hero-error);font-family:var(--mono);font-size:12px;">Error: ' + err.message + '</td></tr>';
  }

  btn.disabled = false;
  btn.innerHTML = '↺ Cargar usuarios';
}

function renderUsers(users) {
  const tbody = document.getElementById('usr-tbody');
  document.getElementById('usr-count').textContent = users.length + ' usuario' + (users.length !== 1 ? 's' : '');

  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:32px;text-align:center;color:var(--hero-text-muted);font-family:var(--mono);font-size:12px;">Sin resultados</td></tr>';
    return;
  }

  tbody.innerHTML = users.map((u, i) => {
    const estadoColor = u.estado === 'activo' ? 'var(--hero-success)' : 'var(--hero-error)';
    const estadoBg    = u.estado === 'activo' ? 'rgba(34,160,107,0.1)' : 'rgba(214,69,69,0.1)';
    const creado      = u.creado ? new Date(u.creado).toLocaleDateString('es-MX', { year:'numeric', month:'short', day:'numeric' }) : '—';
    const login       = u.ultimoLogin && u.ultimoLogin !== '1970-01-01T00:00:00.000Z'
      ? new Date(u.ultimoLogin).toLocaleDateString('es-MX', { year:'numeric', month:'short', day:'numeric' })
      : 'Nunca';
    const rowBg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';

    return '<tr style="border-bottom:1px solid var(--hero-border-card);background:' + rowBg + ';">' +
      '<td style="padding:10px 16px;color:var(--hero-text-primary);">' + u.nombre + '</td>' +
      '<td style="padding:10px 16px;font-family:var(--mono);font-size:12px;color:var(--hero-primary);">' + u.email + '</td>' +
      '<td style="padding:10px 16px;">' +
        '<span style="font-family:var(--mono);font-size:10px;padding:3px 8px;border-radius:20px;background:' + estadoBg + ';color:' + estadoColor + ';">' + u.estado + '</span>' +
      '</td>' +
      '<td style="padding:10px 16px;font-family:var(--mono);font-size:11px;color:var(--hero-text-body);">' + creado + '</td>' +
      '<td style="padding:10px 16px;font-family:var(--mono);font-size:11px;color:var(--hero-text-body);">' + login + '</td>' +
      '<td style="padding:10px 16px;text-align:center;">' +
        '<div style="display:flex;gap:6px;justify-content:center;">' +
        '<button onclick="copyEmail(\'' + u.email + '\')" style="background:transparent;border:1px solid var(--hero-border-card);color:var(--hero-text-body);padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;" title="Copiar email">📋</button>' +
        '<button onclick="openUserModal(\'' + u.email + '\',\'' + u.nombre + '\')" style="background:rgba(0,101,243,0.1);border:1px solid rgba(0,101,243,0.3);color:var(--hero-primary);padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;" title="Gestionar">⚙️</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function filterUsers() {
  const q = document.getElementById('usr-search').value.toLowerCase();
  if (!allUsers.length) return;
  const filtered = allUsers.filter(u =>
    u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  );
  renderUsers(filtered);
}

function copyEmail(email) {
  navigator.clipboard.writeText(email).then(() => {
    showToast('Email copiado: ' + email);
  }).catch(() => {
    showToast('No se pudo copiar');
  });
}

// ── Módulo Dispositivos ───────────────────────────────────────
let allDevices = [];
let currentDeviceId = null;
let currentDevice = null;
let editingDeviceId = null;

const DEV_ESTADO_COLOR = {
  'activo':        'var(--hero-success)',
  'en reparación': 'var(--hero-warning)',
  'dado de baja':  'var(--hero-error)',
};
const DEV_TIPO_ICON = { laptop: '💻', desktop: '🖥️', 'teléfono': '📱' };
const INT_TIPO_COLOR = {
  'Instalación de software': 'var(--hero-primary)',
  'Reparación o diagnóstico': 'var(--hero-warning)',
  'Soporte remoto': 'var(--hero-primary-dark)',
};

async function loadDevices() {
  try {
    const resp = await fetch(WORKER_URL + '/device');
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    allDevices = data.devices || [];
    filterDevices();
    setLastUpdated('devices-last-updated');
  } catch(err) {
    document.getElementById('dev-grid').innerHTML =
      '<div class="info-box" style="text-align:center;padding:32px;grid-column:1/-1;border-color:rgba(214,69,69,0.3);"><div style="color:var(--hero-error);font-family:var(--mono);font-size:12px;">Error: ' + err.message + '</div></div>';
  }
}

function filterDevices() {
  const q      = document.getElementById('dev-search').value.toLowerCase();
  const estado = document.getElementById('dev-filter-estado').value;
  const tipo   = document.getElementById('dev-filter-tipo').value;
  let filtered = allDevices;
  if (estado) filtered = filtered.filter(d => d.estado === estado);
  if (tipo)   filtered = filtered.filter(d => d.tipo === tipo);
  if (q)      filtered = filtered.filter(d =>
    d.nombre.toLowerCase().includes(q) || (d.usuario || '').toLowerCase().includes(q)
  );
  renderDeviceGrid(filtered);
}

function renderDeviceGrid(devices) {
  document.getElementById('dev-count').textContent = devices.length + ' dispositivo' + (devices.length !== 1 ? 's' : '');
  const grid = document.getElementById('dev-grid');
  if (!devices.length) {
    grid.innerHTML = '<div class="info-box" style="text-align:center;padding:40px;grid-column:1/-1;"><div style="font-size:32px;opacity:0.3;margin-bottom:12px;">💻</div><div style="font-family:var(--mono);font-size:12px;color:var(--hero-text-muted);">Sin dispositivos con estos filtros</div></div>';
    return;
  }
  grid.innerHTML = devices.map(d => {
    const eColor = DEV_ESTADO_COLOR[d.estado] || 'var(--hero-text-body)';
    const icon   = DEV_TIPO_ICON[d.tipo] || '💻';
    const intCount = (d.intervenciones || []).length;
    return '<div class="action-card" style="cursor:pointer;" onclick="openDeviceDetail(\'' + d.id + '\')">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">'
      + '<span style="font-size:24px;">' + icon + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(0,0,0,0.06);color:' + eColor + ';">' + d.estado + '</span>'
      + '</div>'
      + '<div style="font-size:14px;font-weight:600;color:var(--hero-text-primary);margin-bottom:3px;">' + d.nombre + '</div>'
      + '<div style="font-size:12px;color:var(--hero-text-body);margin-bottom:8px;">' + (d.usuario || 'Sin usuario asignado') + '</div>'
      + '<div style="display:flex;gap:12px;font-size:11px;color:var(--hero-text-muted);">'
      + '<span>' + (d.so || 'SO no especificado') + '</span>'
      + '<span style="margin-left:auto;">' + intCount + ' intervenci' + (intCount !== 1 ? 'ones' : 'ón') + '</span>'
      + '</div>'
      + '<div style="margin-top:8px;display:flex;gap:6px;">'
      + (d.gcpw ? '<span style="font-family:var(--mono);font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(25,205,235,0.1);color:var(--hero-primary);">GCPW</span>' : '')
      + '<span style="font-family:var(--mono);font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.05);color:var(--hero-text-muted);">' + d.tipo + '</span>'
      + '</div>'
      + '</div>';
  }).join('');
}

async function openDeviceDetail(id) {
  const device = allDevices.find(d => d.id === id);
  if (!device) return;
  currentDeviceId = id;
  currentDevice = device;

  document.getElementById('dev-list-view').style.display = 'none';
  document.getElementById('dev-detail-view').style.display = 'block';
  document.getElementById('dev-detail-title').textContent = (DEV_TIPO_ICON[device.tipo] || '💻') + '  ' + device.nombre;

  // Info
  const eColor = DEV_ESTADO_COLOR[device.estado] || 'var(--hero-text-body)';
  document.getElementById('dev-detail-info').innerHTML =
    '<div style="display:grid;gap:6px;">'
    + row('Usuario', device.usuario || '—')
    + row('Tipo', device.tipo)
    + row('Sistema operativo', device.so || '—')
    + row('GCPW', device.gcpw ? '<span style="color:var(--hero-primary);">✓ Activado</span>' : '<span style="color:var(--hero-text-muted);">✗ No activado</span>')
    + row('Estado', '<span style="color:' + eColor + ';">' + device.estado + '</span>')
    + '</div>';

  // Apps
  const apps = device.apps || [];
  document.getElementById('dev-detail-apps').innerHTML = apps.length
    ? '<div style="display:flex;flex-wrap:wrap;gap:6px;">' + apps.map(a =>
        '<span style="font-size:12px;padding:4px 10px;background:rgba(255,255,255,0.05);border:1px solid var(--hero-border-card);border-radius:6px;color:var(--hero-text-body);">' + a + '</span>'
      ).join('') + '</div>'
    : '<span style="color:var(--hero-text-muted);font-size:12px;">Sin aplicaciones registradas</span>';

  renderHistorial(device.intervenciones || []);
}

function row(label, val) {
  return '<div style="display:flex;gap:8px;align-items:baseline;">'
    + '<span style="font-size:11px;color:var(--hero-text-muted);min-width:130px;">' + label + '</span>'
    + '<span style="font-size:13px;color:var(--hero-text-primary);">' + val + '</span>'
    + '</div>';
}

function renderHistorial(intervenciones) {
  const el = document.getElementById('dev-historial');
  if (!intervenciones.length) {
    el.innerHTML = '<div class="log-empty"><div class="log-empty-icon">📋</div><div class="log-empty-text">Sin intervenciones registradas</div></div>';
    return;
  }
  el.innerHTML = intervenciones.map(i => {
    const fecha = new Date(i.fecha).toLocaleString('es-MX', {
      timeZone:'America/New_York', month:'short', day:'numeric',
      year:'numeric', hour:'2-digit', minute:'2-digit'
    });
    const color = INT_TIPO_COLOR[i.tipo] || 'var(--hero-text-body)';
    return '<div style="padding:12px 0;border-bottom:1px solid var(--hero-border-card);">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">'
      + '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(0,0,0,0.06);color:' + color + ';">' + i.tipo + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;color:var(--hero-text-muted);">' + fecha + ' ET</span>'
      + '</div>'
      + '<div style="font-size:13px;color:var(--hero-text-primary);font-weight:500;margin-bottom:2px;">' + i.descripcion + '</div>'
      + (i.notas ? '<div style="font-size:12px;color:var(--hero-text-body);line-height:1.5;">' + i.notas + '</div>' : '')
      + '</div>';
  }).join('');
}

function closeDeviceDetail() {
  document.getElementById('dev-detail-view').style.display = 'none';
  document.getElementById('dev-list-view').style.display = 'block';
  currentDeviceId = null;
  currentDevice = null;
}

async function registrarIntervencion() {
  if (!currentDeviceId) return;
  const tipo        = document.getElementById('int-tipo').value;
  const descripcion = document.getElementById('int-descripcion').value.trim();
  const notas       = document.getElementById('int-notas').value.trim();
  if (!descripcion) { showToast('Escribe una descripción de la intervención'); return; }

  const btn = document.getElementById('btn-int');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Guardando...';

  try {
    const resp = await fetch(WORKER_URL + '/device/intervencion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: currentDeviceId, tipo, descripcion, notas })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');

    // Update local device
    currentDevice.intervenciones = currentDevice.intervenciones || [];
    currentDevice.intervenciones.unshift(data.intervencion);
    renderHistorial(currentDevice.intervenciones);

    // Update allDevices
    const idx = allDevices.findIndex(d => d.id === currentDeviceId);
    if (idx >= 0) allDevices[idx] = currentDevice;

    document.getElementById('int-descripcion').value = '';
    document.getElementById('int-notas').value = '';
    showToast('Intervención registrada');
    auditLog('dispositivo', tipo + ' en ' + currentDevice.nombre, descripcion);
  } catch(err) {
    showToast('Error: ' + err.message);
  }
  btn.disabled = false;
  btn.innerHTML = '✓ Registrar intervención';
}

// ── Formulario nuevo/editar ───────────────────────────────────
function showDeviceForm(device = null) {
  editingDeviceId = device ? device.id : null;
  document.getElementById('dev-modal-title').textContent = device ? 'Editar dispositivo' : 'Nuevo dispositivo';
  document.getElementById('dev-f-nombre').value  = device ? device.nombre  : '';
  document.getElementById('dev-f-tipo').value    = device ? device.tipo    : 'laptop';
  document.getElementById('dev-f-usuario').value = device ? device.usuario : '';
  document.getElementById('dev-f-so').value      = device ? device.so      : '';
  document.getElementById('dev-f-estado').value  = device ? device.estado  : 'activo';
  document.getElementById('dev-f-gcpw').checked  = device ? device.gcpw    : false;
  document.getElementById('dev-f-apps').value    = device ? (device.apps || []).join('\n') : '';
  document.getElementById('dev-modal').style.display = 'block';
}

function showEditDevice() {
  if (currentDevice) showDeviceForm(currentDevice);
}

function closeDeviceModal() {
  document.getElementById('dev-modal').style.display = 'none';
  editingDeviceId = null;
}

async function saveDevice() {
  const nombre  = document.getElementById('dev-f-nombre').value.trim();
  const tipo    = document.getElementById('dev-f-tipo').value;
  const usuario = document.getElementById('dev-f-usuario').value.trim();
  const so      = document.getElementById('dev-f-so').value.trim();
  const estado  = document.getElementById('dev-f-estado').value;
  const gcpw    = document.getElementById('dev-f-gcpw').checked;
  const appsRaw = document.getElementById('dev-f-apps').value;
  const apps    = appsRaw.split('\n').map(a => a.trim()).filter(Boolean);

  if (!nombre) { showToast('El nombre del dispositivo es obligatorio'); return; }

  const btn = document.getElementById('btn-dev-save');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Guardando...';

  try {
    const endpoint = editingDeviceId ? '/device/update' : '/device';
    const body = editingDeviceId
      ? { id: editingDeviceId, nombre, tipo, usuario, so, gcpw, apps, estado }
      : { nombre, tipo, usuario, so, gcpw, apps, estado };

    const resp = await fetch(WORKER_URL + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');

    showToast(editingDeviceId ? 'Dispositivo actualizado' : 'Dispositivo agregado');
    auditLog('dispositivo', (editingDeviceId ? 'Dispositivo actualizado: ' : 'Dispositivo agregado: ') + nombre, tipo + ' · ' + usuario);
    closeDeviceModal();
    await loadDevices();

    // If editing, refresh detail view
    if (editingDeviceId && currentDeviceId === editingDeviceId) {
      const updated = allDevices.find(d => d.id === editingDeviceId);
      if (updated) { currentDevice = updated; openDeviceDetail(editingDeviceId); }
    }
  } catch(err) {
    showToast('Error: ' + err.message);
  }
  btn.disabled = false;
  btn.innerHTML = '💾 Guardar dispositivo';
}

// ── Exportar reporte CSV ──────────────────────────────────────
function exportDeviceReport() {
  if (!currentDevice) return;
  const d = currentDevice;
  const fecha = new Date(d.fecha).toLocaleDateString('es-MX', { timeZone:'America/New_York' });

  let csv = 'REPORTE DE DISPOSITIVO\n';
  csv += '"Campo","Valor"\n';
  csv += '"Nombre","' + d.nombre + '"\n';
  csv += '"Tipo","' + d.tipo + '"\n';
  csv += '"Usuario asignado","' + (d.usuario || '') + '"\n';
  csv += '"Sistema operativo","' + (d.so || '') + '"\n';
  csv += '"GCPW","' + (d.gcpw ? 'Activado' : 'No activado') + '"\n';
  csv += '"Estado","' + d.estado + '"\n';
  csv += '"Fecha de registro","' + fecha + '"\n';
  csv += '"Aplicaciones instaladas","' + (d.apps || []).join(', ') + '"\n\n';

  csv += 'HISTORIAL DE INTERVENCIONES\n';
  csv += '"Fecha","Tipo","Descripcion","Notas"\n';
  (d.intervenciones || []).forEach(i => {
    const f = new Date(i.fecha).toLocaleString('es-MX', { timeZone:'America/New_York' });
    csv += '"' + f + '","' + i.tipo + '","' + i.descripcion.replace(/"/g,'""') + '","' + (i.notas || '').replace(/"/g,'""') + '"\n';
  });

  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'reporte-' + d.nombre.replace(/\s/g,'-') + '-' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  showToast('Reporte exportado');
}

// ── Módulo Zoho Assist ────────────────────────────────────────
let allZohoDevices = [];

async function loadZohoDevices() {
  const grid = document.getElementById('zoho-grid');
  grid.innerHTML = '<div class="info-box" style="text-align:center;padding:40px;grid-column:1/-1;"><span class="spinner"></span></div>';
  try {
    const resp = await fetch(WORKER_URL + '/zoho/devices');
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    allZohoDevices = Array.isArray(data.devices) ? data.devices : [];
    filterZohoDevices();
    setLastUpdated('zoho-last-updated');
    addLog('Zoho Assist: ' + allZohoDevices.length + ' dispositivos cargados', 'info');
  } catch(err) {
    grid.innerHTML = '<div class="info-box" style="text-align:center;padding:32px;grid-column:1/-1;border-color:rgba(214,69,69,0.3);"><div style="color:var(--hero-error);font-family:var(--mono);font-size:12px;">Error: ' + err.message + '</div></div>';
    addLog('Error Zoho: ' + err.message, 'error');
  }
}

function filterZohoDevices() {
  const q      = document.getElementById('zoho-search').value.toLowerCase();
  const status = document.getElementById('zoho-filter-status').value;
  let filtered = allZohoDevices;
  if (status) filtered = filtered.filter(d => (d.status || d.computer_status || '').toLowerCase() === status);
  if (q)      filtered = filtered.filter(d =>
    (d.computer_name || d.name || '').toLowerCase().includes(q) ||
    (d.group_name || '').toLowerCase().includes(q)
  );
  renderZohoGrid(filtered);
}

function renderZohoGrid(devices) {
  const grid = document.getElementById('zoho-grid');
  document.getElementById('zoho-count').textContent = devices.length + ' dispositivo' + (devices.length !== 1 ? 's' : '');

  if (!devices.length) {
    grid.innerHTML = '<div class="info-box" style="text-align:center;padding:40px;grid-column:1/-1;"><div style="font-size:32px;opacity:0.3;margin-bottom:12px;">📭</div><div style="font-family:var(--mono);font-size:12px;color:var(--hero-text-muted);">Sin dispositivos</div></div>';
    return;
  }

  grid.innerHTML = devices.map(d => {
    const name     = d.computer_name || d.name || 'Sin nombre';
    const status   = (d.status || d.computer_status || 'offline').toLowerCase();
    const isOnline = status === 'online' || status === 'active';
    const group    = d.group_name || d.group || '';
    const os       = d.os_type || d.operating_system || '';
    const id       = d.computer_id || d.id || '';
    const dotColor = isOnline ? 'var(--hero-success)' : 'var(--hero-text-muted)';
    const dotGlow  = isOnline ? '0 0 6px var(--hero-success)' : 'none';

    return '<div class="action-card" style="--card-color:' + (isOnline ? 'var(--hero-success)' : 'var(--hero-border-card)') + ';">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      + '<div style="width:8px;height:8px;border-radius:50%;background:' + dotColor + ';box-shadow:' + dotGlow + ';flex-shrink:0;"></div>'
      + '<div style="font-size:14px;font-weight:600;color:var(--hero-text-primary);">' + name + '</div>'
      + '</div>'
      + '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(0,0,0,0.06);color:' + dotColor + ';">' + (isOnline ? 'online' : 'offline') + '</span>'
      + '</div>'
      + (group ? '<div style="font-size:12px;color:var(--hero-text-muted);margin-bottom:4px;">📁 ' + group + '</div>' : '')
      + (os    ? '<div style="font-size:12px;color:var(--hero-text-body);margin-bottom:12px;">' + os + '</div>' : '<div style="margin-bottom:12px;"></div>')
      + (isOnline && id
          ? '<button onclick="startZohoSession(\'' + id + '\',\'' + name + '\')" class="btn btn-primary" style="width:100%;font-size:12px;">🖥️ Iniciar sesión remota</button>'
          : '<button class="btn btn-secondary" disabled style="width:100%;font-size:12px;opacity:0.4;">Dispositivo offline</button>'
        )
      + '</div>';
  }).join('');
}

async function startZohoSession(computerId, name) {
  addLog('Abriendo Zoho Assist para ' + name + '...', 'info');
  // Open Zoho Assist portal directly — the user must be logged in to Zoho
  const url = 'https://assist.zoho.com/portal/it265/app/home#/unattended/devices?computer_id=' + computerId;
  window.open(url, '_blank');
  auditLog('zoho', 'Sesion remota iniciada: ' + name, computerId);
  showToast('Abriendo Zoho Assist → ' + name);
}
// ── Render session logs on demand ───────────────────────────
function renderSessionLogs() {
  const body = document.getElementById('log-body');
  if (!body) return;
  if (!sessionLogs.length) {
    body.innerHTML = '<div class="log-empty"><div class="log-empty-icon">📋</div><div class="log-empty-text">Sin actividad en esta sesión</div></div>';
    return;
  }
  body.innerHTML = sessionLogs.map(l =>
    '<div class="log-line"><span class="log-time">' + l.time + '</span>' +
    '<span class="log-msg ' + l.type + '">' + l.msg + '</span></div>'
  ).join('');
  body.scrollTop = body.scrollHeight;
}

// ── Init ──────────────────────────────────────────────────────
(function init() {
  // Check existing session first
  if (!checkExistingSession()) {
    // Show login screen - already visible by default
    addLog('Hero IT Console cargado. Esperando autenticación...', 'info');
  } else {
    addLog('Hero IT Console iniciado. Fernando Romero - IT Admin', 'info');
    addLog('Sistema listo. Worker conectado a Resend.', 'success');
  }
})();

// ── Módulo Offboarding ────────────────────────────────────────
const OB_STEPS = [
  { id: 'suspend',    label: 'Suspender cuenta de Google Workspace',       icon: '🔒', auto: true  },
  { id: 'sessions',  label: 'Revocar todas las sesiones activas',           icon: '🚫', auto: false },
  { id: 'groups',    label: 'Remover de Google Groups y carpetas Drive',    icon: '📁', auto: false },
  { id: 'shared',    label: 'Cambiar contraseñas de cuentas compartidas',   icon: '🔑', auto: false },
  { id: 'zoho',      label: 'Revocar acceso a Zoho Assist',                icon: '🖥️', auto: false },
  { id: 'external',  label: 'Revocar accesos a sistemas externos (carriers, ClickUp, etc.)', icon: '🌐', auto: false },
  { id: 'equipment', label: 'Gestionar devolución de equipos',              icon: '💻', auto: false },
  { id: 'record',    label: 'Registrar baja en sistema de RR.HH.',          icon: '📋', auto: false },
];

let obSelectedUser = null;
let obStepStatus   = {};
let editingLicId   = null;

function renderOffboardingSteps() {
  OB_STEPS.forEach(s => { if (!obStepStatus[s.id]) obStepStatus[s.id] = 'pending'; });
  const container = document.getElementById('ob-steps');
  if (!container) return;
  container.innerHTML = OB_STEPS.map(s => {
    const st    = obStepStatus[s.id];
    const isDone = st === 'done';
    const bgColor = isDone ? 'var(--hero-success-bg)' : 'var(--hero-bg)';
    const border  = isDone ? 'rgba(34,160,107,0.3)' : 'var(--hero-border)';
    return '<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:' + bgColor + ';border:1px solid ' + border + ';border-radius:var(--hero-radius-sm);transition:all 0.2s;">'
      + '<span style="font-size:16px;flex-shrink:0;">' + s.icon + '</span>'
      + '<div style="flex:1;">'
      + '<div style="font-size:13px;font-weight:' + (isDone ? '600' : '400') + ';color:' + (isDone ? 'var(--hero-success)' : 'var(--hero-text-primary)') + ';text-decoration:' + (isDone ? 'line-through' : 'none') + ';">' + s.label + '</div>'
      + (s.auto ? '<div style="font-size:10px;color:var(--hero-primary);margin-top:2px;">Automático via API</div>' : '')
      + '</div>'
      + '<button onclick="toggleObStep(\'' + s.id + '\')" style="background:' + (isDone ? 'var(--hero-success)' : 'transparent') + ';border:1px solid ' + (isDone ? 'var(--hero-success)' : 'var(--hero-border)') + ';color:' + (isDone ? '#fff' : 'var(--hero-text-muted)') + ';width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:14px;flex-shrink:0;">'
      + (isDone ? '✓' : '') + '</button>'
      + '</div>';
  }).join('');
  // Update progress
  const done = Object.values(obStepStatus).filter(v => v === 'done').length;
  const el = document.getElementById('ob-progress-label');
  if (el) el.textContent = done + ' / ' + OB_STEPS.length + ' completados';
}

function toggleObStep(id) {
  obStepStatus[id] = obStepStatus[id] === 'done' ? 'pending' : 'done';
  renderOffboardingSteps();
}

function filterOffboardingUsers() {
  const q = document.getElementById('ob-search').value.toLowerCase();
  const suggestions = document.getElementById('ob-user-suggestions');
  if (!q || q.length < 2 || !window._workspaceUsers) { suggestions.style.display = 'none'; return; }
  const matches = window._workspaceUsers.filter(u =>
    (u.nombre||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q)
  ).slice(0, 8);
  if (!matches.length) { suggestions.style.display = 'none'; return; }
  suggestions.style.display = 'block';
  suggestions.innerHTML = matches.map(u =>
    '<div onclick="selectOffboardingUser(\'' + u.email + '\',\'' + u.nombre + '\')" style="padding:10px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--hero-border);" onmouseover="this.style.background=\'var(--hero-bg)\'" onmouseout="this.style.background=\'\'">'
    + '<div style="font-weight:600;color:var(--hero-text-primary);">' + u.nombre + '</div>'
    + '<div style="font-size:11px;color:var(--hero-text-muted);">' + u.email + '</div></div>'
  ).join('');
}

function selectOffboardingUser(email, nombre) {
  obSelectedUser = { email, nombre };
  document.getElementById('ob-search').value = nombre;
  document.getElementById('ob-user-suggestions').style.display = 'none';
  document.getElementById('ob-user-name').textContent = nombre;
  document.getElementById('ob-user-email').textContent = email;
  document.getElementById('ob-selected-user').style.display = 'block';
  obStepStatus = {};
  renderOffboardingSteps();
}

function clearOffboardingUser() {
  obSelectedUser = null;
  obStepStatus   = {};
  document.getElementById('ob-search').value = '';
  document.getElementById('ob-selected-user').style.display = 'none';
  renderOffboardingSteps();
}

function resetOffboarding() {
  clearOffboardingUser();
  document.getElementById('ob-notas').value = '';
}

async function executeOffboarding() {
  if (!obSelectedUser) { showToast('Selecciona un usuario primero'); return; }
  const notas = document.getElementById('ob-notas').value.trim();
  const tipo  = document.getElementById('ob-tipo').value;
  const btn   = document.getElementById('btn-ob-execute');
  const done  = Object.values(obStepStatus).filter(v => v === 'done').length;

  if (!confirm('¿Confirmas el offboarding de ' + obSelectedUser.nombre + '?\n\nEsto suspenderá su cuenta de Google Workspace y quedará registrado en Auditoría.')) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Ejecutando...';

  // Step 1: Auto-suspend Workspace account
  try {
    const r = await fetch(WORKER_URL + '/user-action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: obSelectedUser.email, action: 'suspend' })
    });
    if (r.ok) {
      obStepStatus['suspend'] = 'done';
      addLog('Cuenta suspendida: ' + obSelectedUser.email, 'success');
    }
  } catch(e) { addLog('Error al suspender cuenta: ' + e.message, 'error'); }

  renderOffboardingSteps();

  // Register in audit
  const detail = 'Tipo: ' + tipo + ' | Pasos completados: ' + (done + 1) + '/' + OB_STEPS.length + (notas ? ' | ' + notas : '');
  auditLog('offboarding', 'Offboarding ejecutado: ' + obSelectedUser.nombre, detail);
  addLog('Offboarding registrado en auditoría', 'success');
  showToast('Offboarding ejecutado. Cuenta suspendida.');

  btn.disabled = false;
  btn.innerHTML = '🚪 Ejecutar offboarding';
}

// ── Módulo Licencias & Software ───────────────────────────────
let allLicencias = [];

async function loadLicencias() {
  try {
    const r = await fetch(WORKER_URL + '/licencia');
    const d = await r.json();
    allLicencias = d.licencias || [];
    renderLicencias();
  } catch(e) {
    document.getElementById('lic-grid').innerHTML = '<div class="info-box" style="text-align:center;padding:32px;grid-column:1/-1;"><div style="color:var(--hero-danger);font-size:12px;">Error: ' + e.message + '</div></div>';
  }
}

function renderLicencias() {
  const grid = document.getElementById('lic-grid');
  const count = document.getElementById('lic-count');
  if (count) count.textContent = allLicencias.length + ' licencia' + (allLicencias.length !== 1 ? 's' : '');
  if (!allLicencias.length) {
    grid.innerHTML = '<div class="info-box" style="text-align:center;padding:40px;grid-column:1/-1;"><div style="font-size:32px;opacity:0.3;margin-bottom:12px;">🔑</div><div style="font-family:var(--mono);font-size:12px;color:var(--hero-text-muted);">Sin licencias registradas. Agrega la primera con el botón ➕</div></div>';
    return;
  }
  const today = new Date();
  grid.innerHTML = allLicencias.map(l => {
    const estadoColor = { activa: 'var(--hero-success)', trial: 'var(--hero-warning)', vencida: 'var(--hero-danger)', cancelada: 'var(--hero-text-muted)' }[l.estado] || 'var(--hero-text-muted)';
    // Days until expiry
    let expiryBadge = '';
    if (l.vencimiento) {
      const days = Math.ceil((new Date(l.vencimiento) - today) / 86400000);
      if (days < 0)  expiryBadge = '<span style="font-size:10px;color:var(--hero-danger);font-weight:700;">VENCIDA</span>';
      else if (days <= 30) expiryBadge = '<span style="font-size:10px;color:var(--hero-warning);font-weight:700;">Vence en ' + days + ' días</span>';
      else expiryBadge = '<span style="font-size:10px;color:var(--hero-text-muted);">Vence ' + new Date(l.vencimiento).toLocaleDateString('es-MX') + '</span>';
    }
    return '<div class="action-card" style="--card-color:' + estadoColor + ';">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">'
      + '<div style="font-size:15px;font-weight:700;color:var(--hero-text-primary);">' + l.nombre + '</div>'
      + '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(0,0,0,0.05);color:' + estadoColor + ';">' + l.estado + '</span>'
      + '</div>'
      + (l.plan ? '<div style="font-size:12px;color:var(--hero-text-muted);margin-bottom:4px;">Plan: ' + l.plan + '</div>' : '')
      + '<div style="display:flex;gap:16px;font-size:12px;color:var(--hero-text-muted);margin-bottom:10px;">'
      + (l.costo > 0 ? '<span>💵 $' + Number(l.costo).toFixed(2) + '/mes</span>' : '')
      + (l.usuarios > 0 ? '<span>👤 ' + l.usuarios + ' usuarios</span>' : '')
      + '</div>'
      + (expiryBadge ? '<div style="margin-bottom:10px;">' + expiryBadge + '</div>' : '')
      + (l.notas ? '<div style="font-size:11px;color:var(--hero-text-muted);margin-bottom:12px;">' + l.notas + '</div>' : '')
      + '<div style="display:flex;gap:8px;">'
      + '<button onclick="editLicencia(\'' + l.id + '\')" class="btn btn-secondary" style="flex:1;font-size:12px;">✏️ Editar</button>'
      + '<button onclick="deleteLicencia(\'' + l.id + '\',\'' + l.nombre + '\')" class="btn btn-danger" style="font-size:12px;padding:8px 10px;">🗑</button>'
      + '</div></div>';
  }).join('');
}

function showLicenciaForm(lic = null) {
  editingLicId = lic ? lic.id : null;
  document.getElementById('lic-modal-title').textContent    = lic ? 'Editar licencia' : 'Nueva licencia';
  document.getElementById('lic-f-nombre').value             = lic ? lic.nombre         : '';
  document.getElementById('lic-f-plan').value               = lic ? lic.plan           : '';
  document.getElementById('lic-f-tipo-sub').value           = lic ? (lic.tipoSub||'mensual') : 'mensual';
  document.getElementById('lic-f-costo').value              = lic ? lic.costo          : '';
  document.getElementById('lic-f-usuarios').value           = lic ? lic.usuarios       : '';
  document.getElementById('lic-f-vencimiento').value        = lic ? (lic.vencimiento||'') : '';
  document.getElementById('lic-f-estado').value             = lic ? lic.estado         : 'activa';
  document.getElementById('lic-f-cred-usuario').value       = lic ? (lic.credUsuario||'') : '';
  document.getElementById('lic-f-cred-password').value      = lic ? (lic.credPassword||'') : '';
  document.getElementById('lic-f-codigo').value             = lic ? (lic.codigoLicencia||'') : '';
  document.getElementById('lic-f-notas').value              = lic ? lic.notas          : '';
  // Reset password visibility
  const pwd = document.getElementById('lic-f-cred-password');
  if (pwd) pwd.type = 'password';
  document.getElementById('lic-modal').style.display = 'block';
}

function toggleLicPassword() {
  const input = document.getElementById('lic-f-cred-password');
  const btn   = document.getElementById('btn-toggle-lic-pwd');
  if (input.type === 'password') { input.type = 'text';     btn.textContent = '🙈'; }
  else                           { input.type = 'password'; btn.textContent = '👁';  }
}

function verCredenciales(id) {
  const l = allLicencias.find(x => x.id === id);
  if (!l) return;
  let msg = l.nombre + '\n\n';
  if (l.credUsuario)    msg += 'Usuario: ' + l.credUsuario + '\n';
  if (l.credPassword)   msg += 'Contraseña: ' + l.credPassword + '\n';
  if (l.codigoLicencia) msg += 'Código: ' + l.codigoLicencia + '\n';
  alert(msg);
  // Copy to clipboard
  const text = (l.credUsuario ? 'Usuario: ' + l.credUsuario + '\n' : '')
    + (l.credPassword ? 'Contrasena: ' + l.credPassword + '\n' : '')
    + (l.codigoLicencia ? 'Codigo: ' + l.codigoLicencia : '');
  navigator.clipboard?.writeText(text).catch(()=>{});
  showToast('Credenciales copiadas al portapapeles');
}

function editLicencia(id) {
  const lic = allLicencias.find(l => l.id === id);
  if (lic) showLicenciaForm(lic);
}
function closeLicenciaModal() {
  document.getElementById('lic-modal').style.display = 'none';
  editingLicId = null;
}
async function saveLicencia() {
  const nombre = document.getElementById('lic-f-nombre').value.trim();
  if (!nombre) { showToast('El nombre es obligatorio'); return; }
  const btn = document.getElementById('btn-lic-save');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const r = await fetch(WORKER_URL + '/licencia', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingLicId || undefined,
        nombre,
        plan:        document.getElementById('lic-f-plan').value.trim(),
        costo:       parseFloat(document.getElementById('lic-f-costo').value) || 0,
        usuarios:    parseInt(document.getElementById('lic-f-usuarios').value) || 0,
        vencimiento: document.getElementById('lic-f-vencimiento').value || null,
        estado:      document.getElementById('lic-f-estado').value,
        notas:       document.getElementById('lic-f-notas').value.trim(),
      })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Error');
    showToast(editingLicId ? 'Licencia actualizada' : 'Licencia agregada');
    auditLog('licencia', (editingLicId ? 'Licencia actualizada: ' : 'Licencia agregada: ') + nombre);
    closeLicenciaModal();
    loadLicencias();
  } catch(e) { showToast('Error: ' + e.message); }
  btn.disabled = false; btn.innerHTML = '💾 Guardar';
}
async function deleteLicencia(id, nombre) {
  if (!confirm('¿Eliminar la licencia de ' + nombre + '?')) return;
  try {
    await fetch(WORKER_URL + '/licencia/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    showToast('Licencia eliminada');
    auditLog('licencia', 'Licencia eliminada: ' + nombre);
    loadLicencias();
  } catch(e) { showToast('Error: ' + e.message); }
}

// ── Integración Office Manager App ───────────────────────────
// Lee Firestore del Office Manager App (solo lectura, no modifica nada)
const OM_PROJECT = 'office-manager-app-b82c1';
const OM_API_URL = 'https://firestore.googleapis.com/v1/projects/' + OM_PROJECT + '/databases/(default)/documents/';

async function loadOfficeStatus() {
  const card = document.getElementById('office-status-card');
  if (!card) return;
  try {
    const r = await fetch(OM_API_URL + 'asistencia');
    const d = await r.json();
    if (!d.documents) { card.innerHTML = '<div style="font-size:12px;color:var(--hero-text-muted);text-align:center;padding:16px;">Sin datos de asistencia hoy</div>'; return; }
    const today = new Date().toLocaleDateString('es-MX', { timeZone: 'America/New_York' });
    const hoy = d.documents.filter(doc => {
      const f = doc.fields;
      return f && f.fecha && f.fecha.stringValue && f.fecha.stringValue.startsWith(today);
    });
    if (!hoy.length) { card.innerHTML = '<div style="font-size:12px;color:var(--hero-text-muted);text-align:center;padding:16px;">Sin registros hoy (' + today + ')</div>'; return; }
    card.innerHTML = hoy.map(doc => {
      const f = doc.fields;
      const nombre  = f.nombre?.stringValue || 'Desconocido';
      const entrada = f.entrada?.stringValue || '—';
      const salida  = f.salida?.stringValue  || 'Activo';
      const isActive = !f.salida?.stringValue;
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--hero-border);">'
        + '<div style="display:flex;align-items:center;gap:8px;">'
        + '<div style="width:6px;height:6px;border-radius:50%;background:' + (isActive ? 'var(--hero-success)' : 'var(--hero-text-muted)') + ';flex-shrink:0;"></div>'
        + '<span style="font-size:13px;color:var(--hero-text-primary);">' + nombre + '</span></div>'
        + '<div style="font-family:var(--mono);font-size:11px;color:var(--hero-text-muted);">' + entrada + (isActive ? ' →' : ' → ' + salida) + '</div>'
        + '</div>';
    }).join('');
  } catch(e) {
    card.innerHTML = '<div style="font-size:12px;color:var(--hero-text-muted);text-align:center;padding:16px;">No se pudo cargar (verifica acceso Firestore)</div>';
  }
}

// ── Reporte mensual IT ────────────────────────────────────────
async function generateMonthlyReport() {
  const monthInput = document.getElementById('report-month').value;
  if (!monthInput) { showToast('Selecciona un mes primero'); return; }

  const [year, month] = monthInput.split('-').map(Number);
  const label = new Date(year, month - 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });

  showToast('Generando reporte de ' + label + '...');

  let csv = 'REPORTE MENSUAL IT — HERO INSURANCE USA\n';
  csv += '"Mes","' + label.toUpperCase() + '"\n';
  csv += '"Generado","' + new Date().toLocaleString('es-MX', { timeZone: 'America/New_York' }) + ' ET"\n\n';

  try {
    // Tickets del mes
    const tResp = await fetch(WORKER_URL + '/ticket');
    if (tResp.ok) {
      const tData = await tResp.json();
      const tickets = (tData.tickets || []).filter(t => {
        const d = new Date(t.fecha);
        return d.getFullYear() === year && d.getMonth() + 1 === month;
      });
      csv += 'TICKETS DE SOPORTE\n';
      csv += '"ID","Asunto","Usuario","Categoría","Prioridad","Estado","Fecha"\n';
      tickets.forEach(t => {
        const f = new Date(t.fecha).toLocaleDateString('es-MX', { timeZone: 'America/New_York' });
        csv += [t.ticketId, t.asunto, t.nombre, t.categoria, t.prioridad, t.estado, f].map(v => '"' + String(v||'').replace(/"/g,'""') + '"').join(',') + '\n';
      });
      csv += '"Total tickets","' + tickets.length + '"\n';
      csv += '"Resueltos","' + tickets.filter(t => t.estado === 'resuelto').length + '"\n\n';
    }
  } catch {}

  try {
    // Auditoría del mes
    const aResp = await fetch(WORKER_URL + '/audit?limit=500');
    if (aResp.ok) {
      const aData = await aResp.json();
      const entradas = (aData.entradas || []).filter(e => {
        const d = new Date(e.fecha);
        return d.getFullYear() === year && d.getMonth() + 1 === month;
      });
      csv += 'AUDITORÍA DE ACCIONES\n';
      csv += '"Fecha","Tipo","Descripción","Detalle"\n';
      entradas.forEach(e => {
        const f = new Date(e.fecha).toLocaleString('es-MX', { timeZone: 'America/New_York' });
        csv += [f, e.tipo, e.descripcion, e.detalle||''].map(v => '"' + String(v||'').replace(/"/g,'""') + '"').join(',') + '\n';
      });
      csv += '"Total acciones","' + entradas.length + '"\n\n';
    }
  } catch {}

  try {
    // Dispositivos con intervenciones del mes
    const dResp = await fetch(WORKER_URL + '/device');
    if (dResp.ok) {
      const dData = await dResp.json();
      const intervencionesMes = [];
      (dData.devices || []).forEach(dev => {
        (dev.intervenciones || []).forEach(i => {
          const d = new Date(i.fecha);
          if (d.getFullYear() === year && d.getMonth() + 1 === month) {
            intervencionesMes.push({ dispositivo: dev.nombre, usuario: dev.usuario, ...i });
          }
        });
      });
      csv += 'INTERVENCIONES DE DISPOSITIVOS\n';
      csv += '"Dispositivo","Usuario","Tipo","Descripción","Fecha"\n';
      intervencionesMes.forEach(i => {
        const f = new Date(i.fecha).toLocaleDateString('es-MX', { timeZone: 'America/New_York' });
        csv += [i.dispositivo, i.usuario||'', i.tipo, i.descripcion, f].map(v => '"' + String(v||'').replace(/"/g,'""') + '"').join(',') + '\n';
      });
      csv += '"Total intervenciones","' + intervencionesMes.length + '"\n\n';
    }
  } catch {}

  // Download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'reporte-IT-' + monthInput + '.csv';
  a.click();
  showToast('Reporte generado');
  auditLog('reporte', 'Reporte mensual generado: ' + label);
}

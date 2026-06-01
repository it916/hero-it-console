const atSign = '@';
// ── Google OAuth ──────────────────────────────────────────────
const ALLOWED_EMAIL = 'it' + atSign + 'heroinsuranceusa.com';

async function handleGoogleLogin(response) {
  const errEl = document.getElementById('login-error');
  try {
    // Decode JWT payload
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    const email = payload.email || '';
    const nombre = payload.name || '';
    const picture = payload.picture || '';

    if (email.toLowerCase() !== ALLOWED_EMAIL.toLowerCase()) {
      errEl.style.display = 'block';
      errEl.textContent = 'Acceso denegado. Esta consola es exclusiva para ' + ALLOWED_EMAIL + '. Iniciaste sesión como: ' + email;
      return;
    }

    // Intercambia el ID token de Google por un pase de sesión del Worker.
    const resp = await fetch(WORKER_URL + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const data = await resp.json();
    if (!resp.ok || !data.token) {
      errEl.style.display = 'block';
      errEl.textContent = 'No se pudo iniciar sesión: ' + (data.error || ('error ' + resp.status));
      return;
    }

    // Store session
    HERO_TOKEN = data.token;
    sessionStorage.setItem('hero_token', data.token);
    sessionStorage.setItem('hero_auth', JSON.stringify({ email, nombre, picture, ts: Date.now() }));
    showApp(nombre, picture);
  } catch(e) {
    errEl.style.display = 'block';
    errEl.textContent = 'Error al verificar identidad: ' + e.message;
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
  applyStoredTheme();
  // Start background services
  requestNotificationPermission();
  startPolling();
  loadDashboardCounters();
  checkSystemStatus();
}

function checkExistingSession() {
  try {
    const stored = sessionStorage.getItem('hero_auth');
    const token  = sessionStorage.getItem('hero_token');
    if (!stored || !token) return false;
    const { email, nombre, picture, ts } = JSON.parse(stored);
    // Session valid for 8 hours
    if (Date.now() - ts > 8 * 60 * 60 * 1000) {
      sessionStorage.removeItem('hero_auth');
      sessionStorage.removeItem('hero_token');
      return false;
    }
    if (email.toLowerCase() !== ALLOWED_EMAIL.toLowerCase()) return false;
    HERO_TOKEN = token;
    showApp(nombre, picture);
    return true;
  } catch(e) { return false; }
}

// ── Tema claro / oscuro ──────────────────────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  const newTheme = isDark ? 'light' : 'dark';
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('hero_theme', newTheme);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = newTheme === 'dark' ? '🌙' : '☀️';
}

function applyStoredTheme() {
  const stored = localStorage.getItem('hero_theme') || 'light';
  document.documentElement.setAttribute('data-theme', stored);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = stored === 'dark' ? '🌙' : '☀️';
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
  'solicitudes': 'Solicitudes',
  'tickets': 'Tickets de Soporte',
  'auditoria': 'Auditoría',
  'crear-usuario': 'Crear Usuario',
  'onboarding': 'Enviar Onboarding'
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

// ── Pase de sesión + fetch autenticado ───────────────────────
// El pase lo emite el Worker al iniciar sesión (ver handleGoogleLogin) y se
// reenvía en cada llamada de administración. authFetch lo adjunta solo.
let HERO_TOKEN = sessionStorage.getItem('hero_token') || null;

async function authFetch(url, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (HERO_TOKEN) headers['Authorization'] = 'Bearer ' + HERO_TOKEN;
  const resp = await fetch(url, Object.assign({}, opts, { headers }));
  if (resp.status === 401) handleAuthExpired();
  return resp;
}

// Si el Worker rechaza el pase (expiró o es inválido), cerramos sesión y
// volvemos a la pantalla de login.
function handleAuthExpired() {
  if (!HERO_TOKEN) return;
  HERO_TOKEN = null;
  sessionStorage.removeItem('hero_token');
  sessionStorage.removeItem('hero_auth');
  if (notifInterval) { clearInterval(notifInterval); notifInterval = null; }
  const login = document.getElementById('login-screen');
  const app   = document.getElementById('app-content');
  if (login) login.style.display = 'flex';
  if (app)   app.style.display = 'none';
  try { showToast('Tu sesión expiró. Vuelve a iniciar sesión.'); } catch (_) {}
}

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
    const r = await authFetch(WORKER_URL + '/audit?limit=1');
    if (r.ok) setStatus('worker', 'ok', 'Online · ' + (Date.now()-t0) + 'ms');
    else setStatus('worker', 'error', 'Error ' + r.status);
  } catch { setStatus('worker', 'error', 'Sin respuesta'); }

  // 2. Google Workspace
  try {
    const t0 = Date.now();
    const r = await authFetch(WORKER_URL + '/users');
    const d = await r.json();
    if (r.ok && d.users) setStatus('google', 'ok', d.users.length + ' usuarios · ' + (Date.now()-t0) + 'ms');
    else setStatus('google', 'error', d.error || 'Error');
  } catch { setStatus('google', 'error', 'Sin respuesta'); }

  // 3. Zoho Assist
  try {
    const t0 = Date.now();
    const r = await authFetch(WORKER_URL + '/zoho/devices');
    const d = await r.json();
    if (r.ok) setStatus('zoho', 'ok', d.devices.length + ' dispositivos · ' + (Date.now()-t0) + 'ms');
    else setStatus('zoho', 'error', d.error || 'Error');
  } catch { setStatus('zoho', 'error', 'Sin respuesta'); }

  // 4. Resend — test via Worker general email endpoint availability
  try {
    // We just check that worker responds to POST /  without crashing
    const r = await authFetch(WORKER_URL + '/ticket?limit=1');
    if (r.ok) setStatus('resend', 'ok', 'Activo vía Worker');
    else setStatus('resend', 'error', 'Error ' + r.status);
  } catch { setStatus('resend', 'error', 'Sin respuesta'); }

  if (btn) { btn.disabled = false; btn.innerHTML = '↺ Verificar'; }
  addLog('Verificación de estado completada', 'info');
}

async function loadDashboardCounters() {
  try {
    // Tickets abiertos
    const tResp = await authFetch(WORKER_URL + '/ticket');
    if (tResp.ok) {
      const tData = await tResp.json();
      const open = (tData.tickets || []).filter(t => t.estado === 'abierto').length;
      const el = document.getElementById('stat-tickets-open');
      if (el) { el.textContent = open; el.style.color = open > 0 ? 'var(--hero-danger)' : 'var(--hero-success)'; }
    }
  } catch {}
  try {
    // Solicitudes pendientes
    const sResp = await authFetch(WORKER_URL + '/alta-agente');
    if (sResp.ok) {
      const sData = await sResp.json();
      const pending = (sData.solicitudes || []).filter(s => s.estado === 'pendiente').length;
      const el = document.getElementById('stat-solicitudes-pending');
      if (el) { el.textContent = pending; el.style.color = pending > 0 ? 'var(--hero-warning)' : 'var(--hero-success)'; }
    }
  } catch {}
  try {
    // Dispositivos
    const dResp = await authFetch(WORKER_URL + '/device');
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
    const r = await authFetch(WORKER_URL + '/ticket');
    if (r.ok) {
      const d = await r.json();
      (d.tickets || []).forEach(t => {
        if ((t.asunto||'').toLowerCase().includes(q) || (t.nombre||'').toLowerCase().includes(q) || (t.descripcion||'').toLowerCase().includes(q))
          found.push({ type:'🎫 Ticket', title: t.ticketId + ' — ' + t.asunto, sub: t.nombre + ' · ' + t.estado, action: "showPage('tickets')" });
      });
    }
  } catch {}
  try {
    const r = await authFetch(WORKER_URL + '/alta-agente');
    if (r.ok) {
      const d = await r.json();
      (d.solicitudes || []).forEach(s => {
        if ((s.nombre||'').toLowerCase().includes(q) || (s.apellido||'').toLowerCase().includes(q) || (s.correo||'').toLowerCase().includes(q))
          found.push({ type:'📥 Solicitud', title: s.nombre + ' ' + s.apellido, sub: s.correo + ' · ' + s.estado, action: "showPage('solicitudes')" });
      });
    }
  } catch {}
  try {
    const r = await authFetch(WORKER_URL + '/device');
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
    results.innerHTML = '<div style="text-align:center;padding:24px;color:var(--hero-text-muted);font-size:13px;">Sin resultados para "' + escHtml(q) + '"</div>';
    return;
  }
  results.innerHTML = found.map(f =>
    '<div onclick="' + f.action + ';closeGlobalSearch()" style="display:flex;align-items:flex-start;gap:10px;padding:12px 16px;cursor:pointer;border-bottom:1px solid var(--hero-border);transition:background 0.15s;" onmouseover="this.style.background=\'var(--hero-bg)\'" onmouseout="this.style.background=\'\'"> '
    + '<span style="font-size:11px;padding:2px 8px;background:var(--hero-bg);border:1px solid var(--hero-border);border-radius:20px;color:var(--hero-text-muted);white-space:nowrap;flex-shrink:0;">' + f.type + '</span>'
    + '<div><div style="font-size:13px;font-weight:600;color:var(--hero-text-primary);">' + escHtml(f.title) + '</div>'
    + '<div style="font-size:11px;color:var(--hero-text-muted);margin-top:2px;">' + escHtml(f.sub) + '</div></div></div>'
  ).join('');
}

// ── Notificaciones push ───────────────────────────────────────
let notifInterval = null;
// Conteos persistidos en localStorage para que tickets/solicitudes que
// lleguen mientras la Console está cerrada generen notificación al reabrir.
// La primera vez que cargas la Console (sin valor guardado) usa -1, lo que
// suprime la notif inicial (evita spam de "tienes N pendientes" al primer login).
const _LS_TICKETS = 'hero_lastTicketCount';
const _LS_SOL     = 'hero_lastSolicitudCount';
let lastTicketCount    = parseInt(localStorage.getItem(_LS_TICKETS) || '-1', 10);
let lastSolicitudCount = parseInt(localStorage.getItem(_LS_SOL)     || '-1', 10);
let isFirstPoll = true;

async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') await Notification.requestPermission();
}

// ── Centro de notificaciones ──────────────────────────────────
let notifList = []; // { id, tipo, titulo, cuerpo, fecha, leida, action }

function addNotif(tipo, titulo, cuerpo, action) {
  const notif = {
    id:     Date.now(),
    tipo,   // 'ticket' | 'solicitud' | 'info'
    titulo,
    cuerpo,
    fecha:  new Date(),
    leida:  false,
    action,
  };
  notifList.unshift(notif);
  if (notifList.length > 50) notifList = notifList.slice(0, 50);
  renderNotifPanel();
  // Also send browser push if permitted
  sendPushNotification(titulo, cuerpo, action);
}

function renderNotifPanel() {
  const unread = notifList.filter(n => !n.leida).length;
  const badge  = document.getElementById('notif-badge');
  const list   = document.getElementById('notif-list');
  const empty  = document.getElementById('notif-empty');

  // Badge
  if (badge) {
    badge.style.display = unread > 0 ? 'block' : 'none';
    badge.textContent   = unread > 9 ? '9+' : unread;
  }

  if (!list) return;

  if (!notifList.length) {
    list.innerHTML = '<div id="notif-empty" style="padding:32px;text-align:center;font-size:12px;color:var(--hero-text-muted);"><div style="font-size:28px;margin-bottom:8px;opacity:0.4;">🔔</div>Sin notificaciones nuevas</div>';
    return;
  }

  const iconos = { ticket: '🎫', solicitud: '📥', info: 'ℹ️' };
  const colores = { ticket: 'var(--hero-danger)', solicitud: 'var(--hero-warning)', info: 'var(--hero-primary)' };

  list.innerHTML = notifList.map(n => {
    const tiempo = getElapsedTime(n.fecha.toISOString ? n.fecha.toISOString() : n.fecha);
    const bg     = n.leida ? 'transparent' : 'var(--hero-primary-light)';
    return '<div onclick="clickNotif(' + n.id + ')" style="display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-bottom:1px solid var(--hero-border);cursor:pointer;background:' + bg + ';transition:background 0.15s;" onmouseover="this.style.background=\'var(--hero-bg)\'" onmouseout="this.style.background=\'' + bg + '\'">'
      + '<div style="width:32px;height:32px;border-radius:50%;background:' + colores[n.tipo] + '20;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;">' + (iconos[n.tipo] || '🔔') + '</div>'
      + '<div style="flex:1;min-width:0;">'
      + '<div style="font-size:12px;font-weight:' + (n.leida ? '400' : '700') + ';color:var(--hero-text-primary);margin-bottom:2px;">' + n.titulo + '</div>'
      + '<div style="font-size:11px;color:var(--hero-text-muted);line-height:1.4;">' + n.cuerpo + '</div>'
      + '<div style="font-size:10px;color:var(--hero-text-subtle);margin-top:4px;font-family:var(--mono);">Hace ' + tiempo + '</div>'
      + '</div>'
      + (!n.leida ? '<div style="width:7px;height:7px;border-radius:50%;background:var(--hero-primary);flex-shrink:0;margin-top:4px;"></div>' : '')
      + '</div>';
  }).join('');
}

function clickNotif(id) {
  const n = notifList.find(x => x.id === id);
  if (!n) return;
  n.leida = true;
  renderNotifPanel();
  closeNotifPanel();
  if (n.action) n.action();
}

function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  const isOpen = panel.style.display === 'block';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    // Mark all as read when opening
    setTimeout(() => {
      notifList.forEach(n => n.leida = true);
      renderNotifPanel();
    }, 2000);
  }
}

function closeNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (panel) panel.style.display = 'none';
}

function clearNotifs() {
  notifList = [];
  renderNotifPanel();
  closeNotifPanel();
}

// Close panel when clicking outside
document.addEventListener('click', function(e) {
  const panel = document.getElementById('notif-panel');
  const btn   = document.getElementById('btn-notif');
  if (panel && panel.style.display === 'block' && !panel.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
    closeNotifPanel();
  }
});

function sendPushNotification(title, body, onClick) {
  if (Notification.permission !== 'granted') return;
  const n = new Notification(title, { body, icon: 'https://i.ibb.co/PvS31B1z/shield-low.png' });
  if (onClick) n.onclick = function() { window.focus(); onClick(); };
}

function updateTabBadge(total) {
  document.title = total > 0 ? '(' + total + ') Hero IT Console' : 'Hero IT Console';
}

async function pollForUpdates() {
  try {
    const [tResp, sResp] = await Promise.all([
      authFetch(WORKER_URL + '/ticket'),
      authFetch(WORKER_URL + '/alta-agente')
    ]);
    const tData = tResp.ok ? await tResp.json() : { tickets: [] };
    const sData = sResp.ok ? await sResp.json() : { solicitudes: [] };

    const openTickets      = (tData.tickets    || []).filter(t => t.estado === 'abierto').length;
    const pendingSolicitud = (sData.solicitudes || []).filter(s => s.estado === 'pendiente').length;

    if (lastTicketCount >= 0 && openTickets > lastTicketCount) {
      const diff = openTickets - lastTicketCount;
      const sufijo = diff > 1 ? 's' : '';
      addNotif('ticket',
        diff + ' ticket' + sufijo + ' nuevo' + sufijo,
        isFirstPoll
          ? 'Llegaron ' + diff + ' ticket' + sufijo + ' desde tu última visita'
          : 'Se ' + (diff > 1 ? 'abrieron' : 'abrió') + ' ' + diff + ' ticket' + sufijo + ' de soporte',
        function() { showPage('tickets'); }
      );
    }
    if (lastSolicitudCount >= 0 && pendingSolicitud > lastSolicitudCount) {
      const diff = pendingSolicitud - lastSolicitudCount;
      const plural = diff > 1 ? 'es' : '';
      addNotif('solicitud',
        diff + ' solicitud' + plural + ' de alta/baja',
        isFirstPoll
          ? 'Llegaron ' + diff + ' solicitud' + plural + ' desde tu última visita'
          : 'Nueva' + (diff > 1 ? 's' : '') + ' solicitud' + plural + ' pendiente' + plural + ' de procesar',
        function() { showPage('solicitudes'); }
      );
    }

    lastTicketCount    = openTickets;
    lastSolicitudCount = pendingSolicitud;
    localStorage.setItem(_LS_TICKETS, String(openTickets));
    localStorage.setItem(_LS_SOL,     String(pendingSolicitud));
    isFirstPoll = false;
    updateTabBadge(openTickets + pendingSolicitud);

    const elT = document.getElementById('stat-tickets-open');
    const elS = document.getElementById('stat-solicitudes-pending');
    if (elT) { elT.textContent = openTickets;      elT.style.color = openTickets > 0      ? 'var(--hero-danger)'  : 'var(--hero-success)'; }
    if (elS) { elS.textContent = pendingSolicitud; elS.style.color = pendingSolicitud > 0 ? 'var(--hero-warning)' : 'var(--hero-success)'; }
  } catch(e) { console.warn('pollForUpdates:', e.message); }
}

function startPolling() {
  if (notifInterval) return;
  pollForUpdates();
  notifInterval = setInterval(pollForUpdates, 60000);
}

async function auditLog(tipo, descripcion, detalle = null) {
  try {
    await authFetch(WORKER_URL + '/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, descripcion, detalle, usuario: 'Fernando Romero' })
    });
  } catch(e) { console.warn('auditLog error:', e.message); }
}
async function sendViaResend({ to, subject, html, text }) {
  const resp = await authFetch(WORKER_URL, {
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
  const line = `<div class="log-line"><span class="log-time">${t}</span><span class="log-msg ${type}">${escHtml(message)}</span></div>`;
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

// ── Escape HTML ───────────────────────────────────────────────
// Para insertar de forma segura texto con innerHTML. Los formularios públicos
// (tickets y solicitudes) son la fuente principal de datos no confiables.
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Para valores que se interpolan dentro de un atributo HTML que contiene
// una cadena JS, ej: onclick="fn('${escJs(s)}')". Combina escape JS (\, ',
// newlines) con escape de atributo HTML (&, ", <, >). escHtml por sí solo
// NO es seguro acá porque el HTML decodifica antes que JS parsee — un valor
// con apóstrofe terminaría la cadena JS y permitiría inyección.
function escJs(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}

// ── Persistencia de preferencias UI (filtros, vistas) ─────────
// localStorage es sincrónico y barato; un try/catch cubre el caso de modo
// privado o cuota llena (raro en SPA tan pequeña pero no rompe la app).
function persistState(key, value) {
  try { localStorage.setItem('hero_' + key, JSON.stringify(value)); } catch (_) {}
}
function restoreState(key, defaultValue) {
  try {
    const v = localStorage.getItem('hero_' + key);
    return v == null ? defaultValue : JSON.parse(v);
  } catch (_) { return defaultValue; }
}

// ── Confirm modal estilizado (reemplazo de window.confirm) ───
// Devuelve Promise<boolean>. Mantiene branding + soporta:
//   destructive: true     → botón rojo
//   mustType: 'string'    → input obligatorio (acciones críticas tipo
//                            offboarding/suspender — patrón "type to confirm")
// El modal se crea on-demand y se reutiliza. ESC y focus trap los hereda
// del sistema A11y global (installModalA11y vuelve a query'ar en cada ESC).
function heroConfirm(opts) {
  return new Promise(resolve => {
    let modal = document.getElementById('confirm-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'confirm-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'cf-title');
      modal.setAttribute('data-close-fn', '__heroConfirmCancel');
      modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(26,39,51,0.5);z-index:200;overflow-y:auto;padding:24px;';
      modal.innerHTML =
          '<div style="background:#ffffff;border:1px solid var(--hero-border);border-radius:14px;max-width:440px;margin:60px auto;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,0.18);">'
        +   '<div id="cf-title" style="font-size:16px;font-weight:700;color:var(--hero-text-primary);margin-bottom:8px;"></div>'
        +   '<div id="cf-body" style="font-size:13px;color:var(--hero-text-body);line-height:1.6;margin-bottom:16px;white-space:pre-line;"></div>'
        +   '<div id="cf-type-wrap" style="display:none;margin-bottom:16px;">'
        +     '<label id="cf-type-label" for="cf-type-input" style="display:block;font-size:11px;color:var(--hero-text-muted);margin-bottom:6px;"></label>'
        +     '<input id="cf-type-input" class="form-input" autocomplete="off" autocapitalize="off" spellcheck="false" style="width:100%;"/>'
        +   '</div>'
        +   '<div style="display:flex;gap:8px;justify-content:flex-end;">'
        +     '<button id="cf-cancel" class="btn btn-secondary" style="font-size:13px;">Cancelar</button>'
        +     '<button id="cf-ok" class="btn btn-primary" style="font-size:13px;">Confirmar</button>'
        +   '</div>'
        + '</div>';
      document.body.appendChild(modal);
      if (typeof _setupModalA11y === 'function') _setupModalA11y(modal);
    }

    const titleEl  = document.getElementById('cf-title');
    const bodyEl   = document.getElementById('cf-body');
    const btnOk    = document.getElementById('cf-ok');
    const btnCancel= document.getElementById('cf-cancel');
    const typeWrap = document.getElementById('cf-type-wrap');
    const typeLbl  = document.getElementById('cf-type-label');
    const typeInp  = document.getElementById('cf-type-input');

    titleEl.textContent = opts.title || '¿Confirmar?';
    bodyEl.textContent  = opts.body || '';
    btnOk.textContent   = opts.confirmText || 'Confirmar';
    btnCancel.textContent = opts.cancelText || 'Cancelar';
    btnOk.className = opts.destructive ? 'btn btn-danger' : 'btn btn-primary';

    if (opts.mustType) {
      typeWrap.style.display = 'block';
      typeLbl.textContent = 'Para confirmar, escribe: ' + opts.mustType;
      typeInp.value = '';
      btnOk.disabled = true;
      typeInp.oninput = () => { btnOk.disabled = typeInp.value.trim() !== opts.mustType; };
    } else {
      typeWrap.style.display = 'none';
      btnOk.disabled = false;
      typeInp.oninput = null;
    }

    const close = (val) => {
      modal.style.display = 'none';
      btnOk.onclick = null;
      btnCancel.onclick = null;
      typeInp.oninput = null;
      delete window.__heroConfirmCancel;
      resolve(val);
    };
    btnOk.onclick = () => close(true);
    btnCancel.onclick = () => close(false);
    // ESC global (instalado por installModalA11y) llama data-close-fn
    window.__heroConfirmCancel = () => close(false);

    modal.style.display = 'block';
  });
}

// ── Empty state con CTA opcional ──────────────────────────────
// Usado cuando una colección está legítimamente vacía (no por error).
function renderEmpty(el, opts) {
  if (!el) return;
  const icon    = opts.icon || '📭';
  const message = opts.message || 'Sin datos';
  const ctaText = opts.ctaText || '';
  const ctaFn   = opts.ctaFn || null;
  el.innerHTML =
      '<div class="info-box" style="text-align:center;padding:40px;grid-column:1/-1;">'
    +   '<div style="font-size:36px;opacity:0.35;margin-bottom:14px;">' + escHtml(icon) + '</div>'
    +   '<div style="font-size:13px;color:var(--hero-text-muted);margin-bottom:' + (ctaText ? '16px' : '0') + ';">' + escHtml(message) + '</div>'
    +   (ctaText ? '<button class="btn btn-secondary" data-empty-cta style="font-size:12px;">' + escHtml(ctaText) + '</button>' : '')
    + '</div>';
  if (ctaFn) {
    const btn = el.querySelector('[data-empty-cta]');
    if (btn) btn.addEventListener('click', () => { try { ctaFn(); } catch (_) {} });
  }
}

// ── Loading skeleton (shimmer rectangles) ─────────────────────
// Reemplaza spinners genéricos durante el fetch. Tipos:
//   'list' (default) — filas horizontales para tablas/listas
//   'card' — bloques más altos para grids/kanban
//   'stat' — chips compactos para el dashboard
function renderSkeleton(el, opts) {
  if (!el) return;
  const rows = (opts && opts.rows) || 4;
  const cls = opts && opts.type === 'card' ? 'skel-card'
            : opts && opts.type === 'stat' ? 'skel-stat'
            : 'skel-row';
  el.innerHTML = Array(rows).fill(0).map(() => '<div class="skel ' + cls + '"></div>').join('');
}

// ── Error state renderer con botón Reintentar ─────────────────
// Reemplaza el patrón "innerHTML = 'Error: ' + msg" — el usuario sí ve qué
// falló y puede reintentar sin navegar fuera de la página.
function renderError(el, err, retryFn) {
  if (!el) return;
  const msg = (err && err.message) || String(err || 'Error desconocido');
  el.innerHTML =
      '<div style="text-align:center;padding:32px;">'
    +   '<div style="font-size:32px;opacity:0.4;margin-bottom:12px;">⚠️</div>'
    +   '<div style="font-family:var(--mono);font-size:12px;color:var(--hero-danger);margin-bottom:14px;">' + escHtml(msg) + '</div>'
    +   (retryFn ? '<button class="btn btn-secondary" data-retry style="font-size:12px;">↺ Reintentar</button>' : '')
    + '</div>';
  if (retryFn) {
    const btn = el.querySelector('[data-retry]');
    if (btn) btn.addEventListener('click', () => { try { retryFn(); } catch (_) {} });
  }
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
    '<div onclick="selectResetUser(\'' + escJs(u.email) + '\',\'' + escJs(u.nombre) + '\',\'' + escJs(u.estado) + '\')" '
    + 'style="padding:10px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--hero-border);" '
    + 'onmouseover="this.style.background=\'var(--hero-bg)\'" onmouseout="this.style.background=\'\'">'
    + '<div style="font-weight:600;color:var(--hero-text-primary);">' + escHtml(u.nombre) + '</div>'
    + '<div style="font-size:11px;color:var(--hero-text-muted);">' + escHtml(u.email) + ' · ' + escHtml(u.estado) + '</div></div>'
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
    const resp = await authFetch(WORKER_URL + '/user-action', {
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
    const resp = await authFetch(WORKER_URL, {
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
function buildEmailEmpleado(nombre, email, password, lang) {
  return buildOnboardingEmail(nombre, email, password, 'empleado', lang);
}

function buildEmailAgente(nombre, email, password, lang) {
  return buildOnboardingEmail(nombre, email, password, 'agente', lang);
}

// Asunto y texto plano del correo de onboarding según idioma (es | en).
function onboardingSubject(tipo, lang) {
  var en = (lang === 'en');
  if (tipo === 'empleado')
    return en ? 'Welcome to Hero Insurance USA - Account access information'
              : 'Bienvenido(a) a Hero Insurance USA - Informacion de acceso';
  return en ? 'Welcome to Hero Insurance USA - Agent access'
            : 'Bienvenido(a) a Hero Insurance USA - Acceso de Agente';
}

function onboardingText(nombre, email, lang) {
  return (lang === 'en')
    ? 'Welcome ' + nombre + '. Email: ' + email
    : 'Bienvenido ' + nombre + '. Correo: ' + email;
}

function buildOnboardingEmail(nombre, email, password, tipo, lang) {
  lang = (lang === 'en') ? 'en' : 'es';
  var P    = '#06a3b6';
  var P2   = '#048395';
  var LOGO = 'https://i.ibb.co/PvS31B1z/shield-low.png';
  var SOPORTE_URL = 'https://it916.github.io/hero-it-console/soporte.html';

  // Textos del correo en español (es) e inglés (en). Cada idioma incluye sus 4 pasos de inicio de sesión.
  var STR = {
    es: {
      htmlLang:    'es',
      role:        (tipo === 'empleado' ? 'Empleado' : 'Agente'),
      welcome:     '&iexcl;Bienvenido al equipo, ' + nombre + '!',
      welcomeSub:  'Tu cuenta corporativa ha sido creada y est&aacute; lista para usar.',
      credsTitle:  '&#128274; Tus credenciales de acceso',
      corpEmail:   'Correo corporativo',
      tempPass:    'Contrase&ntilde;a temporal',
      passFallback:'(se asignar&aacute; al iniciar sesi&oacute;n)',
      passNote:    'Deber&aacute;s cambiarla al iniciar sesi&oacute;n por primera vez.',
      stepsTitle:  '&#128204; C&oacute;mo iniciar sesi&oacute;n',
      secTitle:    '&#128274; Pol&iacute;ticas de seguridad',
      secItems: [
        'Tu cuenta es personal e intransferible',
        'Nunca compartas tu contrase&ntilde;a con nadie',
        'La informaci&oacute;n de clientes es estrictamente confidencial',
        'Reporta cualquier actividad sospechosa a IT de inmediato'
      ],
      supportQ:    '&iquest;Tienes alg&uacute;n problema para acceder?',
      supportSub:  'El equipo de IT est&aacute; disponible para ayudarte.',
      supportBtn:  'Abrir ticket de soporte &rarr;',
      steps: [
        ['1', '&#128187;', 'Abre Google Chrome',
         'Te recomendamos usar Google Chrome como navegador principal. Si no lo tienes instalado, desc&aacute;rgalo desde <a href="https://www.google.com/chrome" style="color:' + P + ';font-weight:700;">google.com/chrome</a>.'],
        ['2', '&#128274;', 'Inicia sesi&oacute;n con tus credenciales',
         'Ve a <a href="https://mail.google.com" style="color:' + P + ';font-weight:700;">mail.google.com</a> e ingresa tu correo corporativo y la contrase&ntilde;a temporal. Google te pedir&aacute; que la cambies de inmediato &mdash; elige una contrase&ntilde;a segura que no hayas usado antes.'],
        ['3', '&#128241;', 'Activa la verificaci&oacute;n en dos pasos',
         'Es obligatorio proteger tu cuenta corporativa. Ve a <a href="https://myaccount.google.com/security" style="color:' + P + ';font-weight:700;">myaccount.google.com</a> &rarr; Seguridad &rarr; Verificaci&oacute;n en dos pasos y sigue los pasos.'],
        ['4', '&#128100;', 'Completa tu perfil de Google',
         'Agrega tu foto de perfil en <a href="https://myaccount.google.com" style="color:' + P + ';font-weight:700;">myaccount.google.com</a> para que el equipo pueda identificarte f&aacute;cilmente en las comunicaciones.']
      ]
    },
    en: {
      htmlLang:    'en',
      role:        (tipo === 'empleado' ? 'Employee' : 'Agent'),
      welcome:     'Welcome to the team, ' + nombre + '!',
      welcomeSub:  'Your corporate account has been created and is ready to use.',
      credsTitle:  '&#128274; Your access credentials',
      corpEmail:   'Corporate email',
      tempPass:    'Temporary password',
      passFallback:'(will be set at first sign-in)',
      passNote:    'You will be asked to change it the first time you sign in.',
      stepsTitle:  '&#128204; How to sign in',
      secTitle:    '&#128274; Security policies',
      secItems: [
        'Your account is personal and non-transferable',
        'Never share your password with anyone',
        'Client information is strictly confidential',
        'Report any suspicious activity to IT immediately'
      ],
      supportQ:    'Having trouble signing in?',
      supportSub:  'The IT team is here to help.',
      supportBtn:  'Open a support ticket &rarr;',
      steps: [
        ['1', '&#128187;', 'Open Google Chrome',
         'We recommend using Google Chrome as your main browser. If you do not have it installed, download it from <a href="https://www.google.com/chrome" style="color:' + P + ';font-weight:700;">google.com/chrome</a>.'],
        ['2', '&#128274;', 'Sign in with your credentials',
         'Go to <a href="https://mail.google.com" style="color:' + P + ';font-weight:700;">mail.google.com</a> and enter your corporate email and the temporary password. Google will ask you to change it right away &mdash; choose a strong password you have not used before.'],
        ['3', '&#128241;', 'Turn on 2-step verification',
         'Protecting your corporate account is mandatory. Go to <a href="https://myaccount.google.com/security" style="color:' + P + ';font-weight:700;">myaccount.google.com</a> &rarr; Security &rarr; 2-Step Verification and follow the steps.'],
        ['4', '&#128100;', 'Complete your Google profile',
         'Add your profile photo at <a href="https://myaccount.google.com" style="color:' + P + ';font-weight:700;">myaccount.google.com</a> so the team can easily identify you in communications.']
      ]
    }
  };
  var t = STR[lang];

  var pasosHtml = t.steps.map(function(p) {
    return '<table cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:14px;">'
      + '<tr valign="top">'
      + '<td width="44" style="padding-right:12px;padding-top:2px;">'
      + '<div style="width:36px;height:36px;background:linear-gradient(135deg,' + P + ',' + P2 + ');border-radius:50%;text-align:center;line-height:36px;font-size:16px;">' + p[1] + '</div>'
      + '</td>'
      + '<td valign="top">'
      + '<p style="margin:0 0 3px;font-family:Trebuchet MS,Arial,sans-serif;font-size:13px;font-weight:700;color:#1a1a1a;">' + p[0] + '. ' + p[2] + '</p>'
      + '<p style="margin:0;font-family:Trebuchet MS,Arial,sans-serif;font-size:12px;color:#666;line-height:1.6;">' + p[3] + '</p>'
      + '</td>'
      + '</tr>'
      + '</table>';
  }).join('');

  return '<!DOCTYPE html><html lang="' + t.htmlLang + '"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>'
    + '<body style="margin:0;padding:0;background:#f0f4f8;font-family:Trebuchet MS,Arial,sans-serif;">'
    + '<table cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f0f4f8;"><tr><td style="padding:32px 16px;">'
    + '<table cellspacing="0" cellpadding="0" border="0" width="600" align="center" style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 32px rgba(6,163,182,0.12);">'

    // ── Header ────────────────────────────────────────────────────────────
    + '<tr><td style="background:linear-gradient(135deg,' + P + ' 0%,' + P2 + ' 60%,#036070 100%);padding:0;">'
    + '<table cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td style="height:4px;background:linear-gradient(90deg,rgba(255,255,255,0.1),rgba(255,255,255,0.4),rgba(255,255,255,0.1));"></td></tr></table>'
    + '<table cellspacing="0" cellpadding="0" border="0" width="100%"><tr valign="middle"><td style="padding:32px 40px 28px;">'
    + '<table cellspacing="0" cellpadding="0" border="0" width="100%"><tr valign="middle">'
    + '<td width="80" style="padding-right:20px;">'
    + '<img src="' + LOGO + '" width="64" height="64" style="width:64px;height:64px;display:block;border-radius:50%;border:3px solid rgba(255,255,255,0.4);box-shadow:0 4px 20px rgba(0,0,0,0.2);"/>'
    + '</td>'
    + '<td valign="middle">'
    + '<div style="font-family:Trebuchet MS,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.7);margin-bottom:6px;">Hero Insurance USA &nbsp;&bull;&nbsp; ' + t.role + '</div>'
    + '<h1 style="margin:0 0 5px;font-family:Trebuchet MS,Arial,sans-serif;font-size:24px;font-weight:700;color:#fff;line-height:1.2;">' + t.welcome + '</h1>'
    + '<p style="margin:0;font-family:Trebuchet MS,Arial,sans-serif;font-size:13px;color:rgba(255,255,255,0.8);">' + t.welcomeSub + '</p>'
    + '</td>'
    + '</tr></table>'
    + '</td></tr></table>'
    + '</td></tr>'

    // ── Body ──────────────────────────────────────────────────────────────
    + '<tr><td style="padding:32px 40px;">'

    // Credentials
    + '<div style="background:linear-gradient(135deg,#f0f8fa,#e8f4f6);border-radius:14px;border:1px solid #c8e8ec;padding:20px;margin-bottom:24px;">'
    + '<p style="margin:0 0 14px;font-family:Trebuchet MS,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:' + P + ';">' + t.credsTitle + '</p>'
    + '<div style="background:#fff;border-radius:8px;border:1px solid #d8e1ea;padding:12px 16px;margin-bottom:10px;">'
    + '<p style="margin:0 0 3px;font-family:Trebuchet MS,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#7a8494;">' + t.corpEmail + '</p>'
    + '<p style="margin:0;font-family:Courier New,monospace;font-size:14px;font-weight:700;color:' + P + ';">' + email + '</p>'
    + '</div>'
    + '<div style="background:#fffbf0;border-radius:8px;border:1px solid #f0d080;padding:12px 16px;">'
    + '<p style="margin:0 0 3px;font-family:Trebuchet MS,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#b08a00;">' + t.tempPass + '</p>'
    + '<p style="margin:0;font-family:Courier New,monospace;font-size:16px;font-weight:700;color:#7a5f00;letter-spacing:2px;">' + (password || t.passFallback) + '</p>'
    + '<p style="margin:6px 0 0;font-family:Trebuchet MS,Arial,sans-serif;font-size:11px;color:#b08a00;">' + t.passNote + '</p>'
    + '</div></div>'

    // Pasos de inicio de sesión + políticas: solo para empleados.
    // El correo de agente va directo de credenciales al botón de soporte.
    + (tipo === 'agente' ? '' : (
        // Steps
        '<div style="margin-bottom:24px;">'
      + '<p style="margin:0 0 16px;font-family:Trebuchet MS,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:' + P + ';">' + t.stepsTitle + '</p>'
      + pasosHtml
      + '</div>'
        // Security
      + '<div style="background:#fff5f5;border-radius:10px;border:1px solid #ffd4d4;padding:16px 20px;margin-bottom:24px;">'
      + '<p style="margin:0 0 8px;font-family:Trebuchet MS,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#c0392b;">' + t.secTitle + '</p>'
      + '<ul style="margin:0;padding:0 0 0 16px;font-family:Trebuchet MS,Arial,sans-serif;font-size:13px;color:#4a5568;line-height:1.9;">'
      + t.secItems.map(function(s){ return '<li>' + s + '</li>'; }).join('')
      + '</ul></div>'
      ))

    // Support
    + '<div style="background:linear-gradient(135deg,#f0f8fa,#e8f4f6);border-radius:10px;border:1px solid #c8e8ec;padding:18px 20px;text-align:center;">'
    + '<p style="margin:0 0 4px;font-family:Trebuchet MS,Arial,sans-serif;font-size:14px;font-weight:700;color:#1a1a1a;">' + t.supportQ + '</p>'
    + '<p style="margin:0 0 14px;font-family:Trebuchet MS,Arial,sans-serif;font-size:12px;color:#777;">' + t.supportSub + '</p>'
    + '<a href="' + SOPORTE_URL + '" style="display:inline-block;padding:10px 24px;background:' + P + ';color:#fff;font-family:Trebuchet MS,Arial,sans-serif;font-size:13px;font-weight:700;text-decoration:none;border-radius:8px;">' + t.supportBtn + '</a>'
    + '</div>'

    + '</td></tr>'

    // ── Footer ────────────────────────────────────────────────────────────
    + '<tr><td style="padding:16px 40px;background:#f0f4f8;text-align:center;border-top:1px solid #e8e8e8;">'
    + '<p style="margin:0;font-family:Trebuchet MS,Arial,sans-serif;font-size:11px;color:#aaa;">Hero Insurance USA &bull; IT Department &bull; <a href="mailto:it@heroinsuranceusa.com" style="color:' + P + ';text-decoration:none;">it&#64;heroinsuranceusa.com</a></p>'
    + '<p style="margin:4px 0 0;font-family:Trebuchet MS,Arial,sans-serif;font-size:10px;color:#ccc;">CONFIDENTIALITY NOTICE: This email is intended solely for the addressee.</p>'
    + '</td></tr>'

    + '</table></td></tr></table></body></html>';
}

function buildEmailReset(nombre, emailCorp, password) {
  var now = new Date();
  var fecha = now.toLocaleDateString('es-ES', { timeZone:'America/New_York', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
  return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><style>body{margin:0;padding:0;background:#f0f4f8;font-family:Arial,sans-serif;}</style></head><body style="margin:0;padding:0;background:#f0f4f8;">'
  + '<table cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f0f4f8;"><tr><td style="padding:32px 16px;">'
  + '<table cellspacing="0" cellpadding="0" border="0" width="600" align="center" style="background:#fff;border-radius:16px;overflow:hidden;">'
  + '<tr><td style="background:linear-gradient(135deg,#06a3b6,#048395);padding:36px 40px;text-align:center;">'
  + '<img src="https://i.ibb.co/Gr4mzLv/Nuevo-Logo-Cuadrado-compress.png" width="120" style="display:block;margin:0 auto 20px;"/>'
  + '<h1 style="margin:0;font-size:24px;font-weight:900;color:#fff;">Restablecimiento de Contrasena</h1>'
  + '<p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.75);">Se ha generado una nueva contrasena temporal.</p></td></tr>'
  + '<tr><td style="padding:36px 40px;">'
  + '<p style="margin:0 0 20px;font-size:15px;color:#2d3748;">Hola <strong>' + nombre + '</strong>, hemos procesado el restablecimiento de tu contrasena.</p>'
  + '<div style="background:#fff8e6;border-radius:12px;border:1px solid #f5d87a;border-left:4px solid #f0b429;padding:14px 18px;margin-bottom:20px;">'
  + '<p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#b08a00;text-transform:uppercase;letter-spacing:1px;">Aviso de seguridad</p>'
  + '<p style="margin:0;font-size:13px;color:#7a5f00;">Si no solicitaste este cambio, contacta de inmediato al equipo de IT.</p></div>'
  + '<div style="background:#f7faff;border-radius:12px;border:1px solid #e2eaf8;margin-bottom:20px;">'
  + '<div style="padding:12px 20px;background:#eef4ff;border-radius:12px 12px 0 0;font-size:11px;font-weight:900;letter-spacing:2px;color:#06a3b6;text-transform:uppercase;">Nuevas credenciales</div>'
  + '<div style="padding:18px 20px;">'
  + '<div style="padding:12px;background:#fff;border-radius:8px;border:1px solid #dde8ff;margin-bottom:10px;">'
  + '<div style="font-size:10px;font-weight:700;color:#8fa6cc;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Correo corporativo</div>'
  + '<div style="font-family:monospace;font-size:14px;font-weight:700;color:#06a3b6;">' + emailCorp + '</div></div>'
  + '<div style="padding:12px;background:#f0fff4;border-radius:8px;border:1px solid #9ae6b4;">'
  + '<div style="font-size:10px;font-weight:700;color:#276749;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Nueva contrasena temporal</div>'
  + '<div style="font-family:monospace;font-size:14px;font-weight:700;color:#22543d;">' + (password || 'Se te asignara una contrasena al iniciar sesion') + '</div></div>'
  + '</div></div>'
  + '<div style="background:#eef4ff;border-radius:12px;border:1px solid #c5deff;padding:18px 20px;margin-bottom:20px;">'
  + '<p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#1a202c;">Necesitas ayuda?</p>'
  + '<p style="margin:0 0 10px;font-size:12px;color:#4a5568;">Si no reconoces esta solicitud, contacta al equipo de IT de inmediato.</p>'
  + '<a href="https://forms.gle/8dkvmbgAFwqVx2Mj9" style="display:inline-block;padding:10px 20px;background:#06a3b6;color:#fff;font-size:12px;font-weight:700;text-decoration:none;border-radius:8px;">Contactar soporte IT</a></div>'
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
    const resp = await authFetch(WORKER_URL + '/user-action', {
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
  renderSkeleton(document.getElementById('audit-body'), { rows: 6 });
  try {
    const tipo = document.getElementById('audit-filter-tipo').value;
    const q    = document.getElementById('audit-search').value.trim();
    let endpoint = WORKER_URL + '/audit?limit=500';
    if (tipo) endpoint += '&tipo=' + tipo;
    if (q)    endpoint += '&q=' + encodeURIComponent(q);

    const resp = await authFetch(endpoint);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    allAuditEntradas = data.entradas || [];
    renderAudit(allAuditEntradas, data.total);
    setLastUpdated('audit-last-updated');
  } catch(err) {
    renderError(document.getElementById('audit-body'), err, loadAudit);
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
      + '<span style="font-size:13px;color:var(--hero-text-primary);font-weight:500;">' + escHtml(e.descripcion) + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;color:var(--hero-text-muted);flex-shrink:0;">' + fecha + ' ET</span>'
      + '</div>'
      + (e.detalle ? '<div style="font-family:var(--mono);font-size:11px;color:var(--hero-text-muted);margin-top:3px;">' + escHtml(e.detalle) + '</div>' : '')
      + '<span style="font-family:var(--mono);font-size:10px;padding:1px 7px;border-radius:10px;background:rgba(0,0,0,0.06);color:' + color + ';margin-top:4px;display:inline-block;">' + escHtml(e.tipo) + '</span>'
      + '</div>'
      + '</div>';
  }).join('');
}

// Anti CSV-injection: si una celda empieza con = + - @ \t o \r, Excel/Sheets
// la trata como fórmula al abrir. Prefijamos con apostrofe (queda invisible
// al usuario) para que el contenido se vea como texto literal.
function csvCell(v) {
  const s = String(v == null ? '' : v);
  const needsEscape = /^[=+\-@\t\r]/.test(s);
  return '"' + (needsEscape ? "'" : '') + s.replace(/"/g, '""') + '"';
}

function exportAuditCSV() {
  if (!allAuditEntradas.length) { showToast('Carga el historial primero'); return; }
  const header = 'Fecha ET,Tipo,Descripcion,Detalle,Usuario';
  const rows = allAuditEntradas.map(e => {
    const fecha = new Date(e.fecha).toLocaleString('es-MX', { timeZone:'America/New_York' });
    return [fecha, e.tipo, e.descripcion, e.detalle || '', e.usuario || ''].map(csvCell).join(',');
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
  persistState('ticket_view', view);
  document.getElementById('tickets-kanban').style.display = view === 'kanban' ? 'grid' : 'none';
  document.getElementById('tickets-list').style.display   = view === 'list'   ? 'block' : 'none';
  document.getElementById('btn-view-kanban').style.background = view === 'kanban' ? 'var(--hero-primary-hover)' : 'transparent';
  document.getElementById('btn-view-kanban').style.color      = view === 'kanban' ? '#fff' : 'var(--hero-text-muted)';
  document.getElementById('btn-view-list').style.background   = view === 'list'   ? 'var(--hero-primary-hover)' : 'transparent';
  document.getElementById('btn-view-list').style.color        = view === 'list'   ? '#fff' : 'var(--hero-text-muted)';
  filterTickets();
}

// Tabs mobile en kanban: muestra sólo la columna activa cuando width < 900px.
// En desktop no afecta nada (las 3 columnas se ven siempre).
function setKanbanTab(estado) {
  document.querySelectorAll('#tickets-kanban .kanban-col').forEach(col => {
    col.classList.toggle('mobile-active', col.dataset.estado === estado);
  });
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
  // Restaurar preferencias UI guardadas (vista kanban/lista, filtros prioridad/categoría)
  const prioSel = document.getElementById('ticket-filter-prioridad');
  const catSel  = document.getElementById('ticket-filter-categoria');
  if (prioSel) prioSel.value = restoreState('ticket_filter_prioridad', '');
  if (catSel)  catSel.value  = restoreState('ticket_filter_categoria', '');
  const savedView = restoreState('ticket_view', 'kanban');
  if (savedView !== ticketView) setTicketView(savedView);

  // Skeleton mientras carga — el render real lo reemplaza al llegar la respuesta
  if (ticketView === 'kanban') {
    ['cards-abierto', 'cards-en-progreso', 'cards-resuelto'].forEach(id =>
      renderSkeleton(document.getElementById(id), { type: 'card', rows: 2 })
    );
  } else {
    renderSkeleton(document.getElementById('tickets-list'), { rows: 5 });
  }

  const btn = document.getElementById('btn-load-tickets');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  try {
    const resp = await authFetch(WORKER_URL + '/ticket');
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
  // Persistimos las selects (no la búsqueda — esa es per-sesión).
  persistState('ticket_filter_prioridad', prioridad);
  persistState('ticket_filter_categoria', categoria);
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
        + '<div class="kanban-card-title">' + escHtml(t.asunto) + '</div>'
        + '<div class="kanban-card-meta">' + escHtml(t.nombre) + ' · ' + escHtml(t.categoria) + '</div>'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">'
        + '<span style="font-size:10px;padding:2px 7px;border-radius:20px;background:' + pc.bg + ';color:' + pc.color + ';font-weight:600;">' + escHtml(t.prioridad) + '</span>'
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
    return '<div class="action-card" style="margin-bottom:10px;cursor:pointer;--card-color:' + (estadoColor[t.estado]||'var(--hero-border)') + ';" onclick="openTicketModal(\'' + t.id + '\')">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      + '<span style="font-family:var(--mono);font-size:11px;color:var(--hero-primary);">' + escHtml(t.ticketId) + '</span>'
      + '<span style="font-size:10px;padding:2px 7px;border-radius:20px;background:' + pc.bg + ';color:' + pc.color + ';font-weight:600;">' + escHtml(t.prioridad) + '</span>'
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      + '<span style="font-size:10px;color:' + elColor + ';font-family:var(--mono);">⏱ ' + elapsed + '</span>'
      + '<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(0,0,0,0.05);color:' + (estadoColor[t.estado]||'#444') + ';">' + escHtml(t.estado) + '</span>'
      + '</div></div>'
      + '<div style="font-size:13px;font-weight:600;color:var(--hero-text-primary);margin-bottom:3px;">' + escHtml(t.asunto) + '</div>'
      + '<div style="font-size:12px;color:var(--hero-text-muted);">' + escHtml(t.nombre) + ' · ' + escHtml(t.categoria) + '</div>'
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
    const resp = await authFetch(WORKER_URL + '/ticket/update', {
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

// ── Módulo Solicitudes ────────────────────────────────────────
let allSolicitudes = [];
let solFilter = 'all';
let solModalData = null;

function setSolFilter(filter) {
  solFilter = filter;
  persistState('sol_filter', filter);
  document.querySelectorAll('.sol-filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === filter);
  });
  renderSolicitudes();
}

async function loadSolicitudes() {
  // Restaurar filtro guardado (Todas / Pendientes / Procesadas)
  const savedFilter = restoreState('sol_filter', 'all');
  if (savedFilter !== solFilter) {
    solFilter = savedFilter;
    document.querySelectorAll('.sol-filter-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.filter === solFilter);
    });
  }
  renderSkeleton(document.getElementById('sol-list'), { type: 'card', rows: 3 });
  const btn = document.getElementById('btn-load-sol');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  try {
    const resp = await authFetch(WORKER_URL + '/alta-agente');
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
  const auth    = allSolicitudes.filter(s => s.estado === 'autorizada').length;
  // El contador "done" del Console agrupa autorizadas+procesadas como "no pendientes"
  // (los autorizadores ya autorizaron — el procesamiento por IT puede seguir abierto).
  const done    = total - pending;
  const elT = document.getElementById('sol-stat-total');
  const elP = document.getElementById('sol-stat-pending');
  const elA = document.getElementById('sol-stat-auth');
  const elD = document.getElementById('sol-stat-done');
  if (elT) elT.textContent = total;
  if (elP) elP.textContent = pending;
  if (elA) elA.textContent = auth;
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
    (s.correoPersonal||'').toLowerCase().includes(q) ||
    (s.correoEliminar||'').toLowerCase().includes(q) ||
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
    const isPending    = s.estado === 'pendiente';
    const isAuthorized = s.estado === 'autorizada';
    const isOpen       = isPending || isAuthorized; // estados accionables por IT
    let estadoColor, estadoBg;
    if (isPending)         { estadoColor = 'var(--hero-warning)'; estadoBg = 'rgba(232,163,23,0.1)'; }
    else if (isAuthorized) { estadoColor = 'var(--hero-primary)'; estadoBg = 'rgba(6,163,182,0.12)'; }
    else                   { estadoColor = 'var(--hero-success)'; estadoBg = 'rgba(34,160,107,0.1)'; }

    const elapsed = getElapsedTime(s.fecha);
    const elColor = getElapsedColor(s.fecha, isOpen ? 'abierto' : 'resuelto');

    // Schema unificado: por defecto trata las solicitudes viejas como ALTA de agente.
    const isBaja        = s.tipoSolicitud === 'baja';
    const tipoPersona   = s.tipoPersona === 'empleado' ? 'empleado' : 'agente';
    const tipoLabel     = isBaja ? 'BAJA' : 'ALTA';
    const tipoColor     = isBaja ? 'var(--hero-danger)' : 'var(--hero-primary)';
    const tipoBg        = isBaja ? 'rgba(214,69,69,0.1)' : 'rgba(6,163,182,0.1)';
    let cardColor;
    if (isPending)         cardColor = isBaja ? 'var(--hero-danger)' : 'var(--hero-warning)';
    else if (isAuthorized) cardColor = 'var(--hero-primary)';
    else                   cardColor = 'var(--hero-success)';
    const personaColor  = tipoPersona === 'empleado' ? '#8b5cf6' : '#06a3b6';
    const personaBg     = tipoPersona === 'empleado' ? 'rgba(139,92,246,0.1)' : 'rgba(6,163,182,0.1)';

    // Bloque "Autorizada por X el Y" cuando aplica
    const autorizadaHtml = (isAuthorized || s.autorizadaPor)
      ? '<div style="background:rgba(6,163,182,0.06);border-left:3px solid var(--hero-primary);padding:8px 12px;border-radius:6px;margin:0 0 10px;font-size:12px;color:var(--hero-text-body);">'
        + '<span style="color:var(--hero-primary);font-weight:600;">✓ Autorizada</span>'
        + (s.autorizadaPor ? ' por <strong>' + escHtml(s.autorizadaPor) + '</strong>' : '')
        + (s.autorizadaFecha
            ? ' · <span style="color:var(--hero-text-muted);">' + new Date(s.autorizadaFecha).toLocaleString('es-MX', { timeZone:'America/New_York', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) + ' ET</span>'
            : '')
        + '</div>'
      : '';

    const titulo = isBaja ? (s.nombre || '') : ((s.nombre || '') + ' ' + (s.apellido || ''));
    const correoMostrar = isBaja
      ? (s.correoEliminar || '')
      : (s.correoPersonal || s.correo || '');
    const correoLabel = isBaja ? 'Correo a eliminar' : 'Correo personal';

    // Datos de empleado (cargo/área) si aplica
    const cargoAreaHtml = (tipoPersona === 'empleado' && (s.cargo || s.area))
      ? '<div style="display:flex;gap:14px;font-size:12px;color:var(--hero-text-muted);margin-bottom:6px;">'
        + (s.cargo ? '<span><strong style="color:var(--hero-text-body);">Cargo:</strong> ' + escHtml(s.cargo) + '</span>' : '')
        + (s.area  ? '<span><strong style="color:var(--hero-text-body);">Área:</strong> '   + escHtml(s.area)  + '</span>' : '')
        + '</div>'
      : '';

    // Bloque específico por tipo
    const detalleBloque = isBaja
      ? '<div style="background:rgba(214,69,69,0.06);border-left:3px solid var(--hero-danger);padding:10px 12px;border-radius:6px;margin:8px 0 12px;">'
        + '<div style="font-size:10px;font-weight:700;letter-spacing:2px;color:var(--hero-danger);text-transform:uppercase;margin-bottom:4px;">Motivo</div>'
        + '<div style="font-size:12px;color:var(--hero-text-body);line-height:1.5;">' + escHtml(s.motivo || '—') + '</div>'
        + (s.detalle ? '<div style="font-size:12px;color:var(--hero-text-muted);margin-top:6px;"><strong>Detalle:</strong> ' + escHtml(s.detalle) + '</div>' : '')
        + '</div>'
      : '<div style="display:flex;gap:16px;font-size:12px;color:var(--hero-text-muted);margin-bottom:14px;">'
        + (s.telefono       ? '<span>📞 ' + escHtml(s.telefono) + '</span>' : '')
        + (s.fechaRequerida ? '<span>📅 Requerida: ' + escHtml(s.fechaRequerida) + '</span>' : '')
        + '</div>';

    // Botonera: distinta según tipo
    const escAttr = v => String(v == null ? '' : v).replace(/'/g, '\\\'').replace(/"/g, '&quot;');
    const safeSolEmail  = escAttr(s.solicitanteEmail);
    const safeSolNombre = escAttr(s.solicitanteNombre);
    const safeTitulo    = escAttr(titulo);
    const safeCorreoEl  = escAttr(s.correoEliminar);

    let acciones = '';
    if (isOpen) {
      if (isBaja) {
        acciones = '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
          + '<button class="btn btn-primary" onclick="suspenderDesdeSolicitud(\'' + s.id + '\',\'' + safeCorreoEl + '\',\'' + safeTitulo + '\')" style="font-size:12px;flex:1;background:linear-gradient(135deg,#c0392b,#e67e22);">🔒 Suspender cuenta</button>'
          + '<button class="btn btn-secondary" onclick="rechazarSolicitud(\'' + s.id + '\',\'' + safeSolEmail + '\',\'' + safeSolNombre + '\',\'' + safeTitulo + '\',\'baja\')" style="font-size:12px;">✗ Rechazar</button>'
          + '<button class="btn btn-secondary" onclick="resolverSolicitud(\'' + s.id + '\',\'procesada\')" style="font-size:12px;">✓ Marcar procesada</button>'
          + '</div>';
      } else {
        acciones = '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
          + '<button class="btn btn-primary" onclick="openSolModal(\'' + s.id + '\')" style="font-size:12px;flex:1;">➕ Crear usuario</button>'
          + '<button class="btn btn-secondary" onclick="rechazarSolicitud(\'' + s.id + '\',\'' + safeSolEmail + '\',\'' + safeSolNombre + '\',\'' + safeTitulo + '\',\'alta\')" style="font-size:12px;">✗ Rechazar</button>'
          + '<button class="btn btn-secondary" onclick="resolverSolicitud(\'' + s.id + '\',\'procesada\')" style="font-size:12px;">✓ Marcar procesada</button>'
          + '</div>';
      }
    }

    return '<div class="action-card" style="margin-bottom:12px;--card-color:' + cardColor + ';">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;gap:10px;">'
      +   '<div style="min-width:0;flex:1;">'
      +     '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap;">'
      +       '<span style="font-family:var(--mono);font-size:9px;font-weight:700;padding:2px 8px;border-radius:12px;background:' + tipoBg + ';color:' + tipoColor + ';letter-spacing:1px;">' + tipoLabel + '</span>'
      +       '<span style="font-family:var(--mono);font-size:9px;font-weight:700;padding:2px 8px;border-radius:12px;background:' + personaBg + ';color:' + personaColor + ';letter-spacing:1px;">' + tipoPersona.toUpperCase() + '</span>'
      +     '</div>'
      +     '<div style="font-size:15px;font-weight:600;color:var(--hero-text-primary);">' + escHtml(titulo) + '</div>'
      +     (correoMostrar
              ? '<div style="font-family:var(--mono);font-size:11px;color:' + (isBaja ? 'var(--hero-danger)' : 'var(--hero-primary)') + ';margin-top:2px;"><span style="color:var(--hero-text-muted);">' + correoLabel + ':</span> ' + escHtml(correoMostrar) + '</div>'
              : '')
      +   '</div>'
      +   '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">'
      +     '<span style="font-family:var(--mono);font-size:10px;color:' + elColor + ';">⏱ ' + elapsed + '</span>'
      +     '<span style="font-family:var(--mono);font-size:10px;padding:3px 10px;border-radius:20px;background:' + estadoBg + ';color:' + estadoColor + ';">' + escHtml(s.estado) + '</span>'
      +   '</div>'
      + '</div>'
      + cargoAreaHtml
      + '<div style="font-size:12px;color:var(--hero-text-body);margin-bottom:6px;">'
      +   '<span style="color:var(--hero-text-muted);">Solicitado por: </span>'
      +   '<strong>' + escHtml(s.solicitanteNombre || 'No especificado') + '</strong>'
      +   (s.solicitanteEmail ? ' <span style="font-family:var(--mono);font-size:11px;color:var(--hero-primary);">(' + escHtml(s.solicitanteEmail) + ')</span>' : '')
      + '</div>'
      + autorizadaHtml
      + detalleBloque
      + '<div style="font-size:11px;color:var(--hero-text-muted);margin-bottom:' + (isOpen ? '14px' : '0') + ';">🕐 ' + fecha + ' ET</div>'
      + acciones
      + '</div>';
  }).join('');
}

async function resolverSolicitud(id, estado) {
  try {
    await authFetch(WORKER_URL + '/alta-agente/resolver', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estado })
    });
    showToast('Solicitud marcada como ' + estado);
    auditLog('solicitud', 'Solicitud marcada como ' + estado, id);
    loadSolicitudes();
  } catch(err) { showToast('Error: ' + err.message); }
}

async function rechazarSolicitud(id, solEmail, solNombre, persona, tipo) {
  const tipoLabel = tipo === 'baja' ? 'baja' : 'alta';
  if (!(await heroConfirm({
    title: '¿Rechazar solicitud?',
    body: 'Vas a rechazar la solicitud de ' + tipoLabel + ' para ' + persona + '. Se notificará al solicitante.',
    confirmText: 'Rechazar', destructive: true,
  }))) return;
  try {
    await authFetch(WORKER_URL + '/alta-agente/resolver', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estado: 'rechazada' })
    });
    if (solEmail) {
      await sendViaResend({
        to: solEmail,
        subject: 'Solicitud de ' + tipoLabel + ' no procesada — ' + persona,
        html: '<div style="font-family:Trebuchet MS,Arial,sans-serif;max-width:600px;background:#f0f4f8;padding:32px 16px;">'
          + '<div style="background:#fff;border-radius:16px;overflow:hidden;">'
          + '<div style="background:linear-gradient(135deg,#06a3b6,#048395);padding:24px 32px;">'
          + '<img src="https://i.ibb.co/Gr4mzLv/Nuevo-Logo-Cuadrado-compress.png" width="120" style="display:block;margin:0 auto 12px;"/>'
          + '<h2 style="color:#fff;margin:0;text-align:center;font-size:18px;">Solicitud no procesada</h2></div>'
          + '<div style="padding:24px 32px;">'
          + '<p style="font-size:14px;color:#444;">Hola <strong>' + (solNombre||'') + '</strong>, la solicitud de ' + tipoLabel + ' para <strong>' + persona + '</strong> no pudo ser procesada en este momento.</p>'
          + '<p style="font-size:13px;color:#777;">Si tienes dudas, comunícate con el equipo de IT.</p>'
          + '</div></div></div>',
        text: 'La solicitud de ' + tipoLabel + ' para ' + persona + ' no pudo ser procesada.'
      });
    }
    showToast('Solicitud rechazada' + (solEmail ? ' — solicitante notificado' : ''));
    auditLog('solicitud', 'Solicitud rechazada (' + tipoLabel + '): ' + persona, solEmail || 'sin email');
    loadSolicitudes();
  } catch(err) { showToast('Error: ' + err.message); }
}

// ── Suspender cuenta desde solicitud de BAJA ─────────────────
// PROC-IT-001: nunca eliminar — sólo suspender. Eliminación es paso manual posterior.
async function suspenderDesdeSolicitud(id, correoEliminar, persona) {
  if (!correoEliminar) {
    showToast('La solicitud no tiene correo a eliminar');
    return;
  }
  if (!(await heroConfirm({
    title: '¿Suspender cuenta de Workspace?',
    body: 'PROC-IT-001: la cuenta ' + correoEliminar + ' se marcará como suspendida en Google Workspace '
        + '(la eliminación definitiva es un paso manual posterior). La solicitud quedará marcada como procesada.',
    confirmText: 'Suspender', destructive: true, mustType: correoEliminar,
  }))) return;
  try {
    const resp = await authFetch(WORKER_URL + '/user-action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: correoEliminar, action: 'suspend' })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error al suspender');
    await authFetch(WORKER_URL + '/alta-agente/resolver', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estado: 'procesada' })
    });
    showToast('Cuenta suspendida: ' + correoEliminar);
    auditLog('solicitud', 'Cuenta suspendida desde solicitud de baja: ' + persona, correoEliminar);
    loadSolicitudes();
  } catch(err) {
    showToast('Error: ' + err.message);
    auditLog('solicitud', 'Error al suspender cuenta: ' + err.message, correoEliminar);
  }
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
    const resp = await authFetch(WORKER_URL + '/create-user', {
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

    // Send onboarding email (al correo personal indicado en la solicitud)
    const lang = document.getElementById('sm-lang').value;
    const destinoPersonal = solModalData.correoPersonal || solModalData.correo;
    if (destinoPersonal) {
      await sendViaResend({
        to: destinoPersonal,
        subject: onboardingSubject('agente', lang),
        html: buildEmailAgente(nombre + ' ' + apellido, email, password, lang),
        text: onboardingText(nombre, email, lang),
      });
    }

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
    const resp = await authFetch(WORKER_URL + '/create-user', {
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
    const lang = document.getElementById('new-lang').value;
    const htmlBody = tipo === 'empleado'
      ? buildEmailEmpleado(nuevoUsuario.nombre, nuevoUsuario.email, nuevoUsuario.password, lang)
      : buildEmailAgente(nuevoUsuario.nombre, nuevoUsuario.email, nuevoUsuario.password, lang);
    const asunto = onboardingSubject(tipo, lang);

    await sendViaResend({ to: nuevoUsuario.emailPersonal, subject: asunto, html: htmlBody,
      text: onboardingText(nuevoUsuario.nombre, nuevoUsuario.email, lang) });

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

// ── Página Enviar Onboarding (standalone) ────────────────────
// Reenvía el correo de bienvenida empleado/agente SIN crear la cuenta.
// Reusa las plantillas buildEmailEmpleado/buildEmailAgente.
function onbTogglePassword() {
  const on = document.getElementById('onb-incluir-pass').checked;
  document.getElementById('onb-pass-group').style.display = on ? 'block' : 'none';
  onbPreview();
}

function onbGenPassword() {
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
  document.getElementById('onb-password').value = pwd;
  navigator.clipboard?.writeText(pwd).catch(()=>{});
  showToast('Contraseña generada y copiada');
  onbPreview();
}

function onbPreview() {
  const prev = document.getElementById('onb-preview');
  if (!prev) return;
  const nombre   = document.getElementById('onb-nombre').value.trim();
  const tipo     = document.getElementById('onb-tipo').value;
  const lang     = document.getElementById('onb-lang').value;
  const user     = document.getElementById('onb-email-user').value.trim();
  const personal = document.getElementById('onb-email-personal').value.trim();
  const incluir  = document.getElementById('onb-incluir-pass').checked;
  const pass     = document.getElementById('onb-password').value.trim();
  const corp     = user ? user + atSign + 'heroinsuranceusa.com' : '—';
  prev.innerHTML =
      'Tipo: <strong>' + (tipo === 'empleado' ? 'Empleado' : 'Agente') + '</strong><br>'
    + 'Idioma: <strong>' + (lang === 'en' ? 'Inglés' : 'Español') + '</strong><br>'
    + 'Para: <strong>' + (nombre || '—') + '</strong><br>'
    + 'Cuenta: ' + corp + '<br>'
    + 'Enviar a: ' + (personal || '—') + '<br>'
    + 'Contraseña: ' + (incluir ? (pass || '(genera una con ⚡)') : 'no se incluye en el correo');
}

async function enviarOnboarding() {
  const nombre   = document.getElementById('onb-nombre').value.trim();
  const tipo     = document.getElementById('onb-tipo').value;
  const user     = document.getElementById('onb-email-user').value.trim();
  const personal = document.getElementById('onb-email-personal').value.trim();
  const incluir  = document.getElementById('onb-incluir-pass').checked;
  const pass     = incluir ? document.getElementById('onb-password').value.trim() : '';

  if (!nombre)   { showToast('Falta el nombre completo'); return; }
  if (!user)     { showToast('Falta el usuario del correo corporativo'); return; }
  if (!personal) { showToast('Falta el correo personal (destino)'); return; }
  if (incluir && !pass) { showToast('Marcaste incluir contraseña pero está vacía'); return; }

  const emailCorp = user + atSign + 'heroinsuranceusa.com';
  const btn = document.getElementById('btn-onb-enviar');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Enviando...';
  addLog('Enviando onboarding ' + tipo + ' a ' + personal + '...', 'info', 'log-onb');

  try {
    const lang = document.getElementById('onb-lang').value;
    const html = tipo === 'empleado'
      ? buildEmailEmpleado(nombre, emailCorp, pass, lang)
      : buildEmailAgente(nombre, emailCorp, pass, lang);
    const asunto = onboardingSubject(tipo, lang);

    await sendViaResend({
      to: personal, subject: asunto, html,
      text: onboardingText(nombre, emailCorp, lang),
    });

    addLog('Onboarding enviado a ' + personal, 'success', 'log-onb');
    showToast('Correo de onboarding enviado');
    auditLog('usuario', 'Onboarding (' + tipo + ') enviado a ' + nombre, emailCorp + ' → ' + personal);
  } catch (err) {
    addLog('Error enviando onboarding: ' + err.message, 'error', 'log-onb');
    showToast('Error al enviar: ' + err.message);
  }
  btn.disabled = false;
  btn.innerHTML = '✉️ Enviar correo de onboarding';
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
    const resp = await authFetch(WORKER_URL + '/users');
    const data = await resp.json();

    if (!resp.ok) throw new Error(data.error || 'Error del Worker');

    allUsers = data.users || [];
    window._workspaceUsers = allUsers; // cache for global search
    addLog('Usuarios cargados: ' + allUsers.length, 'success');
    populateOuFilter(allUsers);
    renderUsers(allUsers);

  } catch (err) {
    addLog('Error al cargar usuarios: ' + err.message, 'error');
    showToast('Error al cargar usuarios');
    // usr-tbody es un <tbody>: necesitamos un <tr> en lugar del <div> de renderError.
    const tbody = document.getElementById('usr-tbody');
    tbody.innerHTML =
        '<tr><td colspan="7" style="padding:32px;text-align:center;">'
      +   '<div style="font-size:32px;opacity:0.4;margin-bottom:12px;">⚠️</div>'
      +   '<div style="font-family:var(--mono);font-size:12px;color:var(--hero-danger);margin-bottom:14px;">' + escHtml(err.message) + '</div>'
      +   '<button class="btn btn-secondary" id="usr-retry" style="font-size:12px;">↺ Reintentar</button>'
      + '</td></tr>';
    const retryBtn = document.getElementById('usr-retry');
    if (retryBtn) retryBtn.addEventListener('click', loadUsers);
  }

  btn.disabled = false;
  btn.innerHTML = '↺ Cargar usuarios';
}

function renderUsers(users) {
  const tbody = document.getElementById('usr-tbody');
  document.getElementById('usr-count').textContent = users.length + ' usuario' + (users.length !== 1 ? 's' : '');

  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding:32px;text-align:center;color:var(--hero-text-muted);font-family:var(--mono);font-size:12px;">Sin resultados</td></tr>';
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
    const ouLabel = !u.orgUnitPath || u.orgUnitPath === '/' ? '—' : u.orgUnitPath.replace(/^\//, '');

    return '<tr style="border-bottom:1px solid var(--hero-border-card);background:' + rowBg + ';">' +
      '<td style="padding:10px 16px;color:var(--hero-text-primary);">' + escHtml(u.nombre) + '</td>' +
      '<td style="padding:10px 16px;font-family:var(--mono);font-size:12px;color:var(--hero-primary);">' + escHtml(u.email) + '</td>' +
      '<td style="padding:10px 16px;font-family:var(--mono);font-size:11px;color:var(--hero-text-body);">' + escHtml(ouLabel) + '</td>' +
      '<td style="padding:10px 16px;">' +
        '<span style="font-family:var(--mono);font-size:10px;padding:3px 8px;border-radius:20px;background:' + estadoBg + ';color:' + estadoColor + ';">' + escHtml(u.estado) + '</span>' +
      '</td>' +
      '<td style="padding:10px 16px;font-family:var(--mono);font-size:11px;color:var(--hero-text-body);">' + creado + '</td>' +
      '<td style="padding:10px 16px;font-family:var(--mono);font-size:11px;color:var(--hero-text-body);">' + login + '</td>' +
      '<td style="padding:10px 16px;text-align:center;">' +
        '<div style="display:flex;gap:6px;justify-content:center;">' +
        '<button onclick="copyEmail(\'' + escJs(u.email) + '\')" style="background:transparent;border:1px solid var(--hero-border-card);color:var(--hero-text-body);padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;" title="Copiar email">📋</button>' +
        '<button onclick="openUserModal(\'' + escJs(u.email) + '\',\'' + escJs(u.nombre) + '\')" style="background:rgba(6,163,182,0.1);border:1px solid rgba(6,163,182,0.3);color:var(--hero-primary);padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;" title="Gestionar">⚙️</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function populateOuFilter(users) {
  const sel = document.getElementById('usr-filter-ou');
  if (!sel) return;
  const prev = sel.value;
  const ous = Array.from(new Set(users.map(u => u.orgUnitPath || '/'))).sort();
  sel.innerHTML = '<option value="">OU: Todas</option>' +
    ous.map(ou => {
      const label = ou === '/' ? '/ (raíz)' : ou;
      return '<option value="' + ou.replace(/"/g, '&quot;') + '">' + label + '</option>';
    }).join('');
  if (prev && ous.includes(prev)) sel.value = prev;
}

function filterUsers() {
  const q = document.getElementById('usr-search').value.toLowerCase();
  const ou = document.getElementById('usr-filter-ou')?.value || '';
  if (!allUsers.length) return;
  const filtered = allUsers.filter(u => {
    const matchText = u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchOu = !ou || (u.orgUnitPath || '/') === ou;
    return matchText && matchOu;
  });
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
  renderSkeleton(document.getElementById('dev-grid'), { type: 'card', rows: 4 });
  try {
    const resp = await authFetch(WORKER_URL + '/device');
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    allDevices = data.devices || [];
    filterDevices();
    setLastUpdated('devices-last-updated');
  } catch(err) {
    renderError(document.getElementById('dev-grid'), err, loadDevices);
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
    return '<div class="action-card" style="cursor:pointer;" onclick="openDeviceDetail(\'' + escJs(d.id) + '\')">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">'
      + '<span style="font-size:24px;">' + icon + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(0,0,0,0.06);color:' + eColor + ';">' + escHtml(d.estado) + '</span>'
      + '</div>'
      + '<div style="font-size:14px;font-weight:600;color:var(--hero-text-primary);margin-bottom:3px;">' + escHtml(d.nombre) + '</div>'
      + '<div style="font-size:12px;color:var(--hero-text-body);margin-bottom:8px;">' + escHtml(d.usuario || 'Sin usuario asignado') + '</div>'
      + '<div style="display:flex;gap:12px;font-size:11px;color:var(--hero-text-muted);">'
      + '<span>' + escHtml(d.so || 'SO no especificado') + '</span>'
      + '<span style="margin-left:auto;">' + intCount + ' intervenci' + (intCount !== 1 ? 'ones' : 'ón') + '</span>'
      + '</div>'
      + '<div style="margin-top:8px;display:flex;gap:6px;">'
      + (d.gcpw ? '<span style="font-family:var(--mono);font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(25,205,235,0.1);color:var(--hero-primary);">GCPW</span>' : '')
      + '<span style="font-family:var(--mono);font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.05);color:var(--hero-text-muted);">' + escHtml(d.tipo) + '</span>'
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

  // Info — row() inyecta su segundo argumento como HTML, así que valores
  // venidos del backend deben ir pre-escapados con escHtml.
  const eColor = DEV_ESTADO_COLOR[device.estado] || 'var(--hero-text-body)';
  document.getElementById('dev-detail-info').innerHTML =
    '<div style="display:grid;gap:6px;">'
    + row('Usuario', escHtml(device.usuario || '—'))
    + row('Tipo', escHtml(device.tipo))
    + row('Sistema operativo', escHtml(device.so || '—'))
    + row('GCPW', device.gcpw ? '<span style="color:var(--hero-primary);">✓ Activado</span>' : '<span style="color:var(--hero-text-muted);">✗ No activado</span>')
    + row('Estado', '<span style="color:' + eColor + ';">' + escHtml(device.estado) + '</span>')
    + '</div>';

  // Apps
  const apps = device.apps || [];
  document.getElementById('dev-detail-apps').innerHTML = apps.length
    ? '<div style="display:flex;flex-wrap:wrap;gap:6px;">' + apps.map(a =>
        '<span style="font-size:12px;padding:4px 10px;background:rgba(255,255,255,0.05);border:1px solid var(--hero-border-card);border-radius:6px;color:var(--hero-text-body);">' + escHtml(a) + '</span>'
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
      + '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(0,0,0,0.06);color:' + color + ';">' + escHtml(i.tipo) + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;color:var(--hero-text-muted);">' + fecha + ' ET</span>'
      + '</div>'
      + '<div style="font-size:13px;color:var(--hero-text-primary);font-weight:500;margin-bottom:2px;">' + escHtml(i.descripcion) + '</div>'
      + (i.notas ? '<div style="font-size:12px;color:var(--hero-text-body);line-height:1.5;">' + escHtml(i.notas) + '</div>' : '')
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
    const resp = await authFetch(WORKER_URL + '/device/intervencion', {
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

    const resp = await authFetch(WORKER_URL + endpoint, {
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
    csv += [f, i.tipo, i.descripcion, i.notas || ''].map(csvCell).join(',') + '\n';
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
    const resp = await authFetch(WORKER_URL + '/zoho/devices');
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    allZohoDevices = Array.isArray(data.devices) ? data.devices : [];
    filterZohoDevices();
    setLastUpdated('zoho-last-updated');
    addLog('Zoho Assist: ' + allZohoDevices.length + ' dispositivos cargados', 'info');
  } catch(err) {
    renderError(grid, err, loadZohoDevices);
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
      + '<div style="font-size:14px;font-weight:600;color:var(--hero-text-primary);">' + escHtml(name) + '</div>'
      + '</div>'
      + '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(0,0,0,0.06);color:' + dotColor + ';">' + (isOnline ? 'online' : 'offline') + '</span>'
      + '</div>'
      + (group ? '<div style="font-size:12px;color:var(--hero-text-muted);margin-bottom:4px;">📁 ' + escHtml(group) + '</div>' : '')
      + (os    ? '<div style="font-size:12px;color:var(--hero-text-body);margin-bottom:12px;">' + escHtml(os) + '</div>' : '<div style="margin-bottom:12px;"></div>')
      + (isOnline && id
          ? '<button onclick="startZohoSession(\'' + escJs(id) + '\',\'' + escJs(name) + '\')" class="btn btn-primary" style="width:100%;font-size:12px;">🖥️ Iniciar sesión remota</button>'
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
    '<span class="log-msg ' + l.type + '">' + l.message + '</span></div>'
  ).join('');
  body.scrollTop = body.scrollHeight;
}

// ── A11y: foco y teclado para modales ────────────────────────
// Detecta automáticamente cuando un [role="dialog"][aria-modal="true"]
// cambia entre display:none y display:block via MutationObserver. Al abrir:
// guarda lastFocus, mueve foco al primer focusable y atrapa Tab. Al cerrar:
// restaura lastFocus. ESC global cierra cualquier dialog visible llamando
// a data-close-fn. Esto evita refactorizar cada función openXxx existente.
function _isModalVisible(modal) {
  const display = modal.style.display || getComputedStyle(modal).display;
  return display !== 'none';
}
function _getFocusables(container) {
  const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll(sel))
    .filter(el => el.offsetParent !== null || el === document.activeElement);
}
function _setupModalA11y(modal) {
  let lastFocus = null;
  let trapHandler = null;
  let wasVisible = _isModalVisible(modal);

  const onVisible = () => {
    lastFocus = document.activeElement;
    const focusables = _getFocusables(modal);
    if (focusables.length) setTimeout(() => { try { focusables[0].focus(); } catch (_) {} }, 0);
    trapHandler = (e) => {
      if (e.key !== 'Tab') return;
      const f = _getFocusables(modal);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    modal.addEventListener('keydown', trapHandler);
  };
  const onHidden = () => {
    if (trapHandler) { modal.removeEventListener('keydown', trapHandler); trapHandler = null; }
    if (lastFocus && typeof lastFocus.focus === 'function') { try { lastFocus.focus(); } catch (_) {} }
    lastFocus = null;
  };

  new MutationObserver(() => {
    const visible = _isModalVisible(modal);
    if (visible && !wasVisible) onVisible();
    else if (!visible && wasVisible) onHidden();
    wasVisible = visible;
  }).observe(modal, { attributes: true, attributeFilter: ['style', 'class'] });
}
function installModalA11y() {
  document.querySelectorAll('[role="dialog"][aria-modal="true"]').forEach(_setupModalA11y);
  // ESC re-querea cada vez para capturar modales agregados dinámicamente
  // (ej: heroConfirm que se crea on-demand).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modals = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
    const visible = Array.from(modals).find(_isModalVisible);
    if (!visible) return;
    const fnName = visible.getAttribute('data-close-fn');
    if (fnName && typeof window[fnName] === 'function') window[fnName]();
    else visible.style.display = 'none';
  });
}

// ── Init ──────────────────────────────────────────────────────
(function init() {
  installModalA11y();
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
    '<div onclick="selectOffboardingUser(\'' + escJs(u.email) + '\',\'' + escJs(u.nombre) + '\')" style="padding:10px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--hero-border);" onmouseover="this.style.background=\'var(--hero-bg)\'" onmouseout="this.style.background=\'\'">'
    + '<div style="font-weight:600;color:var(--hero-text-primary);">' + escHtml(u.nombre) + '</div>'
    + '<div style="font-size:11px;color:var(--hero-text-muted);">' + escHtml(u.email) + '</div></div>'
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

  if (!(await heroConfirm({
    title: '¿Ejecutar offboarding?',
    body: obSelectedUser.nombre + ' (' + obSelectedUser.email + '). Esto suspenderá su cuenta de Google Workspace y quedará registrado en Auditoría.',
    confirmText: 'Ejecutar offboarding', destructive: true, mustType: obSelectedUser.email,
  }))) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Ejecutando...';

  // Step 1: Auto-suspend Workspace account
  try {
    const r = await authFetch(WORKER_URL + '/user-action', {
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
  renderSkeleton(document.getElementById('lic-grid'), { type: 'card', rows: 4 });
  try {
    const r = await authFetch(WORKER_URL + '/licencia');
    const d = await r.json();
    allLicencias = d.licencias || [];
    renderLicencias();
  } catch(e) {
    renderError(document.getElementById('lic-grid'), e, loadLicencias);
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
      + '<div style="font-size:15px;font-weight:700;color:var(--hero-text-primary);">' + escHtml(l.nombre) + '</div>'
      + '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(0,0,0,0.05);color:' + estadoColor + ';">' + escHtml(l.estado) + '</span>'
      + '</div>'
      + (l.plan ? '<div style="font-size:12px;color:var(--hero-text-muted);margin-bottom:4px;">Plan: ' + escHtml(l.plan) + '</div>' : '')
      + '<div style="display:flex;gap:16px;font-size:12px;color:var(--hero-text-muted);margin-bottom:10px;">'
      + (l.costo > 0 ? '<span>💵 $' + Number(l.costo).toFixed(2) + '/mes</span>' : '')
      + (l.usuarios > 0 ? '<span>👤 ' + l.usuarios + ' usuarios</span>' : '')
      + '</div>'
      + (expiryBadge ? '<div style="margin-bottom:10px;">' + expiryBadge + '</div>' : '')
      + (l.notas ? '<div style="font-size:11px;color:var(--hero-text-muted);margin-bottom:12px;">' + escHtml(l.notas) + '</div>' : '')
      + ((l.credUsuario || l.credPassword || l.codigoLicencia)
        ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">'
          + (l.credUsuario || l.credPassword ? '<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(6,163,182,0.08);color:var(--hero-primary);">🔐 Credenciales</span>' : '')
          + (l.codigoLicencia ? '<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(6,163,182,0.08);color:var(--hero-primary);">🔑 Código</span>' : '')
          + '</div>'
        : '')
      + '<div style="display:flex;gap:8px;">'
      + '<button onclick="editLicencia(\'' + escJs(l.id) + '\')" class="btn btn-secondary" style="flex:1;font-size:12px;">✏️ Editar</button>'
      + ((l.credUsuario || l.credPassword || l.codigoLicencia)
        ? '<button onclick="verCredenciales(\'' + escJs(l.id) + '\')" class="btn btn-secondary" style="font-size:12px;padding:8px 12px;" title="Ver credenciales">🔐</button>'
        : '')
      + '<button onclick="deleteLicencia(\'' + escJs(l.id) + '\',\'' + escJs(l.nombre) + '\')" class="btn btn-danger" style="font-size:12px;padding:8px 10px;">🗑</button>'
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

  const rows = [
    l.credUsuario    ? ['👤 Usuario',          l.credUsuario,    false] : null,
    l.credPassword   ? ['🔑 Contraseña',        l.credPassword,   true]  : null,
    l.codigoLicencia ? ['🔐 Código de licencia', l.codigoLicencia, false] : null,
  ].filter(Boolean);

  if (!rows.length) { showToast('Esta licencia no tiene credenciales guardadas'); return; }

  const rowsHtml = rows.map(function(row) {
    const label = row[0], value = row[1], isPassword = row[2];
    // escHtml cubre comillas, < > & ' — el browser decodifica entidades al
    // leer dataset.val, así que toggleCredVal y el copiado recuperan el valor
    // original sin entidades residuales.
    const safeAttr = escHtml(value);
    return '<div style="margin-bottom:14px;">'
      + '<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--hero-primary);margin-bottom:5px;">' + label + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      + '<code data-val="' + safeAttr + '" style="flex:1;background:var(--hero-bg);border:1px solid var(--hero-border);border-radius:6px;padding:8px 12px;font-family:var(--mono);font-size:13px;color:var(--hero-text-primary);display:block;overflow-wrap:anywhere;">'
      + (isPassword ? '••••••••' : escHtml(value))
      + '</code>'
      + (isPassword
        ? '<button data-val="' + safeAttr + '" onclick="toggleCredVal(this)" style="background:transparent;border:1px solid var(--hero-border);border-radius:6px;padding:6px 10px;cursor:pointer;font-size:14px;color:var(--hero-text-muted);">👁</button>'
        : '')
      + '<button data-val="' + safeAttr + '" onclick="navigator.clipboard.writeText(this.dataset.val);showToast(\'Copiado ✓\')" style="background:transparent;border:1px solid var(--hero-border);border-radius:6px;padding:6px 10px;cursor:pointer;font-size:14px;color:var(--hero-text-muted);">📋</button>'
      + '</div></div>';
  }).join('');

  // Create modal if doesn't exist
  let modal = document.getElementById('cred-view-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'cred-view-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(26,39,51,0.5);z-index:200;overflow-y:auto;padding:24px;';
    modal.innerHTML =
      '<div style="background:#ffffff;border:1px solid rgba(6,163,182,0.3);border-radius:16px;max-width:460px;margin:0 auto;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.2);">'
      + '<div style="background:linear-gradient(135deg,#06a3b6,#048395);padding:18px 24px;display:flex;justify-content:space-between;align-items:center;">'
      + '<div id="cred-modal-title" style="font-size:15px;font-weight:700;color:#fff;"></div>'
      + '<button onclick="document.getElementById(\'cred-view-modal\').style.display=\'none\'" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:30px;height:30px;border-radius:6px;cursor:pointer;font-size:16px;">✕</button>'
      + '</div>'
      + '<div id="cred-modal-body" style="padding:20px 24px;"></div>'
      + '<div style="padding:0 24px 20px;display:flex;gap:8px;">'
      + '<button onclick="copyAllCreds()" class="btn btn-primary" style="flex:1;font-size:12px;">📋 Copiar todo</button>'
      + '<button onclick="document.getElementById(\'cred-view-modal\').style.display=\'none\'" class="btn btn-secondary" style="font-size:12px;">Cerrar</button>'
      + '</div></div>';
    document.body.appendChild(modal);
  }

  modal._licId = id;
  document.getElementById('cred-modal-title').textContent = '🔐 ' + l.nombre;
  document.getElementById('cred-modal-body').innerHTML = rowsHtml;
  modal.style.display = 'block';
}

function toggleCredVal(btn) {
  const code = btn.previousElementSibling;
  const val  = btn.dataset.val;
  if (code.textContent === '••••••••') {
    code.textContent = val;
    btn.textContent  = '🙈';
  } else {
    code.textContent = '••••••••';
    btn.textContent  = '👁';
  }
}

function copyAllCreds() {
  const modal = document.getElementById('cred-view-modal');
  const l = allLicencias.find(x => x.id === modal._licId);
  if (!l) return;
  const text = [
    l.credUsuario    ? 'Usuario: '    + l.credUsuario    : '',
    l.credPassword   ? 'Contrasena: ' + l.credPassword   : '',
    l.codigoLicencia ? 'Codigo: '     + l.codigoLicencia : '',
  ].filter(Boolean).join('\n');
  navigator.clipboard.writeText(text).catch(()=>{});
  showToast('Credenciales copiadas ✓');
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
    const r = await authFetch(WORKER_URL + '/licencia', {
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
  if (!(await heroConfirm({
    title: '¿Eliminar licencia?',
    body: 'Vas a eliminar "' + nombre + '". Esta acción no se puede deshacer.',
    confirmText: 'Eliminar', destructive: true,
  }))) return;
  try {
    await authFetch(WORKER_URL + '/licencia/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
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
        + '<span style="font-size:13px;color:var(--hero-text-primary);">' + escHtml(nombre) + '</span></div>'
        + '<div style="font-family:var(--mono);font-size:11px;color:var(--hero-text-muted);">' + escHtml(entrada) + (isActive ? ' →' : ' → ' + escHtml(salida)) + '</div>'
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
    const tResp = await authFetch(WORKER_URL + '/ticket');
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
        csv += [t.ticketId, t.asunto, t.nombre, t.categoria, t.prioridad, t.estado, f].map(csvCell).join(',') + '\n';
      });
      csv += '"Total tickets","' + tickets.length + '"\n';
      csv += '"Resueltos","' + tickets.filter(t => t.estado === 'resuelto').length + '"\n\n';
    }
  } catch {}

  try {
    // Auditoría del mes
    const aResp = await authFetch(WORKER_URL + '/audit?limit=500');
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
        csv += [f, e.tipo, e.descripcion, e.detalle||''].map(csvCell).join(',') + '\n';
      });
      csv += '"Total acciones","' + entradas.length + '"\n\n';
    }
  } catch {}

  try {
    // Dispositivos con intervenciones del mes
    const dResp = await authFetch(WORKER_URL + '/device');
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
        csv += [i.dispositivo, i.usuario||'', i.tipo, i.descripcion, f].map(csvCell).join(',') + '\n';
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

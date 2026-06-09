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
  loadHome();
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
  if (btn) btn.innerHTML = '<iconify-icon icon="tabler:' + (newTheme === 'dark' ? 'moon' : 'sun') + '"></iconify-icon>';
}

function applyStoredTheme() {
  const stored = localStorage.getItem('hero_theme') || 'light';
  document.documentElement.setAttribute('data-theme', stored);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.innerHTML = '<iconify-icon icon="tabler:' + (stored === 'dark' ? 'moon' : 'sun') + '"></iconify-icon>';
}

// ── Logs globales ─────────────────────────────────────────────
const sessionLogs = [];
let sessionActionCount = 0;

// ── Navegación ────────────────────────────────────────────────
const pageLabels = {
  'dashboard': 'Home',
  'reset': 'Reset de Contraseña',
  'usuarios': 'Usuarios Workspace',
  'logs': 'Historial de Logs',
  'config': 'Configuración',
  'solicitudes': 'Solicitudes',
  'tickets': 'Soporte · Tickets',
  'auditoria': 'Auditoría',
  'crear-usuario': 'Crear Usuario',
  'onboarding': 'Enviar Onboarding',
  'kb': 'Soporte · Knowledge Base',
  'dispositivos': 'Soporte · Dispositivos',
  'licencias': 'Soporte · Licencias'
};

// Las 4 sub-páginas del módulo Soporte comparten una sola entrada del sidebar
// (la de Tickets, que es el tab default). Cuando navegamos a cualquiera de ellas
// queremos que ese nav-item quede resaltado.
const SOPORTE_TABS = ['tickets', 'kb', 'dispositivos', 'licencias'];

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
  // Back-compat: 'mi-dia' se fusionó dentro de 'dashboard' (Home).
  if (id === 'mi-dia') id = 'dashboard';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');
  // Para resaltar el sidebar: las 4 sub-páginas de Soporte mapean al item 'tickets'.
  const sidebarId = SOPORTE_TABS.includes(id) ? 'tickets' : id;
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick') && n.getAttribute('onclick').includes("'" + sidebarId + "'")) {
      n.classList.add('active');
    }
  });
  document.getElementById('current-section-label').textContent = pageLabels[id] || id;

  // Cerrar sidebar en móvil al navegar
  closeSidebar();

  // Auto-cargar datos al navegar
  const autoLoad = {
    'dashboard':    () => loadHome(),
    'usuarios':     () => loadUsers(),
    'tickets':      () => loadTickets(),
    'solicitudes':  () => loadSolicitudes(),
    'auditoria':    () => loadAudit(),
    'dispositivos': () => loadDevices(),
    'offboarding':  () => { if (!window._workspaceUsers) loadUsers(); renderOffboardingSteps(); },
    'licencias':    () => loadLicencias(),
    'kb':           () => loadKb(),
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
let _clockInterval = setInterval(updateClock, 1000);
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
  if (resp.status === 401) {
    handleAuthExpired();
  } else if (resp.status >= 500) {
    // 5xx implica fallo del Worker — antes se ignoraban silenciosamente.
    // No mostramos toast en cada poll para no spamear; solo addLog que queda
    // visible en el panel Logs si Fernando entra a investigar.
    addLog('Worker ' + resp.status + ' en ' + (typeof url === 'string' ? url.replace(WORKER_URL, '') : '?'), 'warn');
  }
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
  if (_clockInterval) { clearInterval(_clockInterval); _clockInterval = null; }
  const login = document.getElementById('login-screen');
  const app   = document.getElementById('app-content');
  if (login) login.style.display = 'flex';
  if (app)   app.style.display = 'none';
  try { showToast('Tu sesión expiró. Vuelve a iniciar sesión.'); } catch (_) {}
}

// ── Panel de estado del ecosistema ───────────────────────────
async function checkSystemStatus() {
  const btn = document.getElementById('btn-check-status');
  if (btn) { btn.disabled = true; btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring>'; }

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
  results.innerHTML = '<div style="text-align:center;padding:20px;"><l-line-spinner size="24" stroke="2" speed="1" color="#06a3b6"></l-line-spinner></div>';
  const found = [];
  try {
    const r = await authFetch(WORKER_URL + '/ticket');
    if (r.ok) {
      const d = await r.json();
      (d.tickets || []).forEach(t => {
        if ((t.asunto||'').toLowerCase().includes(q) || (t.nombre||'').toLowerCase().includes(q) || (t.descripcion||'').toLowerCase().includes(q))
          found.push({ type:'<iconify-icon icon="tabler:ticket"></iconify-icon> Ticket', title: t.ticketId + ' — ' + t.asunto, sub: t.nombre + ' · ' + t.estado, action: "showPage('tickets')" });
      });
    }
  } catch {}
  try {
    const r = await authFetch(WORKER_URL + '/alta-agente');
    if (r.ok) {
      const d = await r.json();
      (d.solicitudes || []).forEach(s => {
        if ((s.nombre||'').toLowerCase().includes(q) || (s.apellido||'').toLowerCase().includes(q) || (s.correo||'').toLowerCase().includes(q))
          found.push({ type:'<iconify-icon icon="tabler:inbox"></iconify-icon> Solicitud', title: s.nombre + ' ' + s.apellido, sub: s.correo + ' · ' + s.estado, action: "showPage('solicitudes')" });
      });
    }
  } catch {}
  try {
    const r = await authFetch(WORKER_URL + '/device');
    if (r.ok) {
      const d = await r.json();
      (d.devices || []).forEach(dev => {
        if ((dev.nombre||'').toLowerCase().includes(q) || (dev.usuario||'').toLowerCase().includes(q))
          found.push({ type:'<iconify-icon icon="tabler:device-desktop"></iconify-icon> Dispositivo', title: dev.nombre, sub: (dev.usuario||'Sin usuario') + ' · ' + dev.estado, action: "showPage('dispositivos')" });
      });
    }
  } catch {}
  if (window._workspaceUsers) {
    window._workspaceUsers.forEach(u => {
      if ((u.nombre||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q))
        found.push({ type:'<iconify-icon icon="tabler:user"></iconify-icon> Usuario', title: u.nombre, sub: u.email + ' · ' + u.estado, action: "showPage('usuarios')" });
    });
  }
  // Licencias — útil para "¿dónde guardé el password de X?"
  if (typeof allLicencias !== 'undefined' && Array.isArray(allLicencias)) {
    allLicencias.forEach(l => {
      const blob = (l.nombre + ' ' + (l.plan||'') + ' ' + (l.notas||'')).toLowerCase();
      if (blob.includes(q))
        found.push({ type:'<iconify-icon icon="tabler:license"></iconify-icon> Licencia', title: l.nombre, sub: (l.plan || 'sin plan') + ' · ' + (l.estado || 'activa'), action: "showPage('licencias')" });
    });
  }
  // Auditoría — buscar en descripción/detalle de entradas recientes
  if (typeof allAuditEntradas !== 'undefined' && Array.isArray(allAuditEntradas)) {
    allAuditEntradas.slice(0, 200).forEach(e => {
      const blob = ((e.descripcion||'') + ' ' + (e.detalle||'')).toLowerCase();
      if (blob.includes(q))
        found.push({ type:'<iconify-icon icon="tabler:files"></iconify-icon> Auditoría', title: e.descripcion || '(sin descripción)', sub: (e.tipo || '') + ' · ' + (e.usuario || ''), action: "showPage('auditoria')" });
    });
  }
  // Knowledge base — busca en título, contenido y tags
  if (typeof allKb !== 'undefined' && Array.isArray(allKb)) {
    allKb.forEach(a => {
      const blob = (a.titulo + ' ' + (a.contenido || '') + ' ' + (a.tags || []).join(' ')).toLowerCase();
      if (blob.includes(q))
        found.push({ type:'<iconify-icon icon="tabler:book-2"></iconify-icon> KB', title: a.titulo, sub: (a.tags || []).slice(0, 3).join(', ') || 'sin tags', action: "showPage('kb')" });
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
    list.innerHTML = '<div id="notif-empty" style="padding:32px;text-align:center;font-size:12px;color:var(--hero-text-muted);"><div style="font-size:28px;margin-bottom:8px;opacity:0.4;"><iconify-icon icon="tabler:bell-off"></iconify-icon></div>Sin notificaciones nuevas</div>';
    return;
  }

  const iconos = {
    ticket:    '<iconify-icon icon="tabler:ticket"></iconify-icon>',
    solicitud: '<iconify-icon icon="tabler:inbox"></iconify-icon>',
    info:      '<iconify-icon icon="tabler:info-circle"></iconify-icon>'
  };
  const colores = { ticket: 'var(--hero-danger)', solicitud: 'var(--hero-warning)', info: 'var(--hero-primary)' };

  list.innerHTML = notifList.map(n => {
    const tiempo = getElapsedTime(n.fecha.toISOString ? n.fecha.toISOString() : n.fecha);
    const bg     = n.leida ? 'transparent' : 'var(--hero-primary-light)';
    return '<div onclick="clickNotif(' + n.id + ')" style="display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-bottom:1px solid var(--hero-border);cursor:pointer;background:' + bg + ';transition:background 0.15s;" onmouseover="this.style.background=\'var(--hero-bg)\'" onmouseout="this.style.background=\'' + bg + '\'">'
      + '<div style="width:32px;height:32px;border-radius:50%;background:' + colores[n.tipo] + '20;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;color:' + colores[n.tipo] + ';">' + (iconos[n.tipo] || '<iconify-icon icon="tabler:bell"></iconify-icon>') + '</div>'
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
  document.title = total > 0 ? '(' + total + ') IT CONSOLE - HERO' : 'IT CONSOLE - HERO';
}

async function pollForUpdates() {
  try {
    // Una sola llamada cada 60s en lugar de listar /ticket + /alta-agente
    // completos. Los counts vienen de KV metadata (sin N+1).
    const resp = await authFetch(WORKER_URL + '/stats');
    if (!resp.ok) return;
    const d = await resp.json();
    const openTickets      = d.tickets.open      || 0;
    const pendingSolicitud = d.solicitudes.pending || 0;

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
  } catch(e) { addLog('pollForUpdates: ' + e.message, 'warn'); }
}

// Polling con Page Visibility: cuando la pestaña no es visible (background tab,
// minimizada, otro escritorio), pausamos el setInterval para no consumir cuota
// KV de Cloudflare. Al volver, hacemos un poll inmediato + reanudamos.
// Intervalo subido a 2 min (cache del backend es 2 min, alineado).
const POLL_INTERVAL_MS = 2 * 60 * 1000;
function startPolling() {
  if (notifInterval) return;
  pollForUpdates();
  notifInterval = setInterval(pollForUpdates, POLL_INTERVAL_MS);

  // Pausar cuando la pestaña pierde visibilidad
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (notifInterval) { clearInterval(notifInterval); notifInterval = null; }
    } else {
      if (!notifInterval) {
        pollForUpdates();
        notifInterval = setInterval(pollForUpdates, POLL_INTERVAL_MS);
      }
    }
  });
}

async function auditLog(tipo, descripcion, detalle = null) {
  try {
    // Toma el nombre real del usuario logueado en lugar de hardcodear "Fernando
    // Romero" — si en algún momento entra otra persona, queda registrado bien.
    let usuario = 'Sistema';
    try {
      const auth = JSON.parse(sessionStorage.getItem('hero_auth') || '{}');
      if (auth.nombre) usuario = auth.nombre;
    } catch (_) {}
    await authFetch(WORKER_URL + '/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, descripcion, detalle, usuario })
    });
  } catch(e) { addLog('auditLog error: ' + e.message, 'warn'); }
}
async function sendViaResend({ to, subject, html, text }) {
  const resp = await authFetch(WORKER_URL + '/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, html, text })
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.message || result.error || 'Error del Worker');
  return result;
}

// ── Log helper ────────────────────────────────────────────────
const SESSION_LOGS_MAX = 500;
function addLog(message, type = 'info', consoleId = null) {
  const now = new Date();
  const t = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  sessionLogs.push({ time: t, message, type });
  // Cap a últimos 500 — sin esto, una sesión larga acumula sin fin y deja
  // pesado el panel Logs cuando se renderiza por completo.
  if (sessionLogs.length > SESSION_LOGS_MAX) sessionLogs.splice(0, sessionLogs.length - SESSION_LOGS_MAX);
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

// ── Toast (con cola) ──────────────────────────────────────────
// Antes showToast sobreescribía el mensaje anterior si llegaban dos en sucesión.
// Ahora encolamos: el segundo espera a que el primero termine (3.2s) y luego
// se muestra. La cola se vacía sola.
const _toastQueue = [];
let _toastShowing = false;
function showToast(msg) {
  _toastQueue.push(String(msg == null ? '' : msg));
  if (!_toastShowing) _drainToast();
}
function _drainToast() {
  if (!_toastQueue.length) { _toastShowing = false; return; }
  _toastShowing = true;
  const t = document.getElementById('toast');
  const msg = _toastQueue.shift();
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => {
    t.classList.remove('show');
    // Pequeño gap entre toasts para que el cambio sea visible
    setTimeout(_drainToast, 200);
  }, 3200);
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
  const icon    = opts.icon || '<iconify-icon icon="tabler:mailbox"></iconify-icon>';
  const message = opts.message || 'Sin datos';
  const ctaText = opts.ctaText || '';
  const ctaFn   = opts.ctaFn || null;
  el.innerHTML =
      '<div class="info-box" style="text-align:center;padding:40px;grid-column:1/-1;">'
    +   '<div style="font-size:36px;opacity:0.35;margin-bottom:14px;">' + icon + '</div>'
    +   '<div style="font-size:13px;color:var(--hero-text-muted);margin-bottom:' + (ctaText ? '16px' : '0') + ';">' + escHtml(message) + '</div>'
    +   (ctaText ? '<button class="btn btn-secondary" data-empty-cta style="font-size:12px;">' + ctaText + '</button>' : '')
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
    +   '<div style="font-size:32px;opacity:0.4;margin-bottom:12px;color:var(--hero-warning);"><iconify-icon icon="tabler:alert-triangle"></iconify-icon></div>'
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
    if (el) el.innerHTML = '<div class="log-empty"><div class="log-empty-icon"><iconify-icon icon="tabler:trash"></iconify-icon></div><div class="log-empty-text">Logs limpiados</div></div>';
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

// Genera una contraseña fuerte de 12 chars (1 mayúscula, 1 minúscula, 1 dígito,
// 1 especial + 8 random). Sin caracteres ambiguos (0/O/I/l/1). Usa
// crypto.getRandomValues — Math.random no es criptográficamente seguro.
function _generateStrongPassword() {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower   = 'abcdefghjkmnpqrstuvwxyz';
  const digits  = '23456789';
  const special = '!@#*$';
  const all     = upper + lower + digits + special;
  const rand = (max) => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % max;
  };
  let pwd = upper[rand(upper.length)]
          + lower[rand(lower.length)]
          + digits[rand(digits.length)]
          + special[rand(special.length)];
  for (let i = 0; i < 8; i++) pwd += all[rand(all.length)];
  // Fisher-Yates shuffle para que los 4 primeros chars no estén siempre en orden U-L-D-S
  const arr = pwd.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

function generateResetPassword() {
  const pwd = _generateStrongPassword();
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
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Reseteando...';
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
  btn.innerHTML = '<iconify-icon icon="tabler:key"></iconify-icon> Resetear contraseña en Workspace y notificar';
}


// ── Config ────────────────────────────────────────────────────
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
  const pwd = _generateStrongPassword();
  document.getElementById('um-new-password').value = pwd;
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
  email: '<iconify-icon icon="tabler:mail"></iconify-icon>',
  reset: '<iconify-icon icon="tabler:key"></iconify-icon>',
  usuario: '<iconify-icon icon="tabler:user"></iconify-icon>',
  ticket: '<iconify-icon icon="tabler:ticket"></iconify-icon>',
};

async function loadAudit() {
  const btn = document.getElementById('btn-load-audit');
  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring>';
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
    body.innerHTML = '<div class="log-empty"><div class="log-empty-icon"><iconify-icon icon="tabler:mailbox"></iconify-icon></div><div class="log-empty-text">Sin entradas con estos filtros</div></div>';
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

// Convierte una fila (array) en línea CSV escapando cada celda con csvCell.
function csvRow(arr) { return arr.map(csvCell).join(',') + '\n'; }

// Descarga un CSV con BOM UTF-8 (necesario para que Excel Windows interprete
// bien los caracteres acentuados como á, ñ, ó). Sheets también lo acepta sin
// problema. Devuelve la URL revocable para que el caller pueda cleanup.
function downloadCsv(csv, filename) {
  const BOM = String.fromCharCode(0xFEFF);
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportAuditCSV() {
  if (!allAuditEntradas.length) { showToast('Carga el historial primero'); return; }

  // Aplicar los filtros visibles (tipo + búsqueda) al export para que coincida
  // con lo que el usuario ve en pantalla.
  const tipo = (document.getElementById('audit-filter-tipo') || {}).value || '';
  const q    = ((document.getElementById('audit-search') || {}).value || '').toLowerCase();
  let entradas = allAuditEntradas;
  if (tipo) entradas = entradas.filter(e => e.tipo === tipo);
  if (q)    entradas = entradas.filter(e =>
    (e.descripcion || '').toLowerCase().includes(q) ||
    (e.detalle     || '').toLowerCase().includes(q) ||
    (e.usuario     || '').toLowerCase().includes(q)
  );

  let csv = csvRow(['Fecha ET', 'Tipo', 'Descripcion', 'Detalle', 'Usuario']);
  entradas.forEach(e => {
    const fecha = new Date(e.fecha).toLocaleString('es-MX', { timeZone: 'America/New_York' });
    csv += csvRow([fecha, e.tipo, e.descripcion, e.detalle || '', e.usuario || '']);
  });
  csv += csvRow(['Total', entradas.length]);

  const suffix = tipo ? '-' + tipo : '';
  downloadCsv(csv, 'hero-auditoria-' + new Date().toISOString().slice(0, 10) + suffix + '.csv');
  showToast('CSV exportado (' + entradas.length + ' entradas)');
}

// ── Módulo "Home" — cola priorizada + lanzador ────────────────
// Vista consolidada: tickets prioritarios abiertos + solicitudes que esperan
// a IT + licencias por vencer. Una sola página para que Fernando entre y sepa
// qué hacer primero sin navegar 3 secciones distintas.
async function loadHome() {
  // Saludo dinámico según la hora ET
  const hET = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
  const h = parseInt(hET, 10);
  const saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const auth = (() => { try { return JSON.parse(sessionStorage.getItem('hero_auth') || '{}'); } catch { return {}; } })();
  const nombre = (auth.nombre || '').split(' ')[0] || 'Fernando';
  const saludoEl = document.getElementById('home-saludo');
  if (saludoEl) saludoEl.textContent = saludo + ', ' + nombre + ' — esto necesita tu atención ahora.';

  // Skeletons en las 3 secciones mientras carga
  renderSkeleton(document.getElementById('md-tickets'), { type: 'card', rows: 2 });
  renderSkeleton(document.getElementById('md-sols'),    { type: 'card', rows: 2 });
  renderSkeleton(document.getElementById('md-lics'),    { type: 'card', rows: 2 });

  let tickets = [], sols = [], lics = [];
  try {
    const [t, s, l] = await Promise.all([
      authFetch(WORKER_URL + '/ticket'),
      authFetch(WORKER_URL + '/alta-agente'),
      authFetch(WORKER_URL + '/licencia'),
    ]);
    if (t.ok) tickets = (await t.json()).tickets || [];
    if (s.ok) sols    = (await s.json()).solicitudes || [];
    if (l.ok) lics    = (await l.json()).licencias || [];
  } catch (e) {
    addLog('Home: error cargando datos: ' + e.message, 'warn');
  }

  // 1. Tickets prioritarios — abiertos con Urgente o Alta, viejos primero
  const PRIO_WEIGHT = { Urgente: 3, Alta: 2, Media: 1, Baja: 0 };
  const ticketsPri = tickets
    .filter(t => t.estado === 'abierto' && (PRIO_WEIGHT[t.prioridad] || 0) >= 2)
    .sort((a, b) => {
      const dw = (PRIO_WEIGHT[b.prioridad] || 0) - (PRIO_WEIGHT[a.prioridad] || 0);
      return dw !== 0 ? dw : new Date(a.fecha) - new Date(b.fecha);
    });

  // 2. Solicitudes que esperan a IT — pendiente o autorizada (autorizada =
  //    alguien aprobó pero IT aún no creó/eliminó la cuenta)
  const solsAccion = sols
    .filter(s => s.estado === 'pendiente' || s.estado === 'autorizada')
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  // 3. Licencias que vencen dentro de 30 días (o ya vencidas)
  const today = Date.now();
  const licsVencer = lics
    .filter(l => l.vencimiento && (new Date(l.vencimiento).getTime() - today) < 30 * 86400000)
    .sort((a, b) => new Date(a.vencimiento) - new Date(b.vencimiento));

  // Stats
  const setStat = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  setStat('home-stat-tickets', ticketsPri.length);
  setStat('home-stat-sols',    solsAccion.length);
  setStat('home-stat-lics',    licsVencer.length);

  // Render cada sección (con empty state propio)
  _renderHomeTickets(ticketsPri);
  _renderHomeSols(solsAccion);
  _renderHomeLics(licsVencer);
}

function _renderHomeTickets(items) {
  const el = document.getElementById('md-tickets');
  if (!items.length) {
    renderEmpty(el, { icon: '<iconify-icon icon="tabler:circle-check" style="color:var(--hero-success);"></iconify-icon>', message: 'Sin tickets prioritarios abiertos. Buen trabajo.' });
    return;
  }
  el.innerHTML = items.map(t => {
    const prioColor = (PRIORIDAD_COLOR && PRIORIDAD_COLOR[t.prioridad]) || { color: 'var(--hero-warning)', bg: 'rgba(232,163,23,0.12)' };
    const elapsed = getElapsedTime(t.fecha);
    const elColor = getElapsedColor(t.fecha, t.estado);
    return '<div class="action-card" style="cursor:pointer;padding:14px;" onclick="showPage(\'tickets\');setTimeout(() => openTicketModal(\'' + escJs(t.id) + '\'), 200)">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px;">'
      +   '<div style="min-width:0;flex:1;">'
      +     '<div style="font-family:var(--mono);font-size:10px;color:var(--hero-text-muted);margin-bottom:2px;">' + escHtml(t.ticketId || '') + '</div>'
      +     '<div style="font-size:13px;font-weight:600;color:var(--hero-text-primary);">' + escHtml(t.asunto) + '</div>'
      +     '<div style="font-size:11px;color:var(--hero-text-muted);margin-top:2px;">' + escHtml(t.nombre || '') + ' · ' + escHtml(t.categoria || '') + '</div>'
      +   '</div>'
      +   '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">'
      +     '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:12px;background:' + prioColor.bg + ';color:' + prioColor.color + ';">' + escHtml(t.prioridad) + '</span>'
      +     '<span style="font-family:var(--mono);font-size:10px;color:' + elColor + ';">⏱ ' + elapsed + '</span>'
      +   '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}

function _renderHomeSols(items) {
  const el = document.getElementById('md-sols');
  if (!items.length) {
    renderEmpty(el, { icon: '<iconify-icon icon="tabler:circle-check" style="color:var(--hero-success);"></iconify-icon>', message: 'No hay solicitudes esperando acción.' });
    return;
  }
  el.innerHTML = items.map(s => {
    const isBaja = s.tipoSolicitud === 'baja';
    const tipoLabel = isBaja ? 'BAJA' : 'ALTA';
    const tipoColor = isBaja ? 'var(--hero-danger)' : 'var(--hero-primary-text)';
    const tipoBg    = isBaja ? 'rgba(214,69,69,0.10)' : 'rgba(6,163,182,0.10)';
    const titulo    = isBaja ? (s.nombre || '') : ((s.nombre || '') + ' ' + (s.apellido || '')).trim();
    const estadoBadge = s.estado === 'autorizada'
      ? '<iconify-icon icon="tabler:check"></iconify-icon> Autorizada'
      : '<iconify-icon icon="tabler:hourglass"></iconify-icon> Pendiente';
    const estadoColor = s.estado === 'autorizada' ? 'var(--hero-primary-text)' : 'var(--hero-warning)';
    const elapsed = getElapsedTime(s.fecha);
    return '<div class="action-card" style="cursor:pointer;padding:14px;" onclick="showPage(\'solicitudes\')">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">'
      +   '<div style="min-width:0;flex:1;">'
      +     '<span style="font-family:var(--mono);font-size:9px;font-weight:700;padding:2px 8px;border-radius:12px;background:' + tipoBg + ';color:' + tipoColor + ';letter-spacing:1px;">' + tipoLabel + '</span>'
      +     '<div style="font-size:13px;font-weight:600;color:var(--hero-text-primary);margin-top:4px;">' + escHtml(titulo) + '</div>'
      +     '<div style="font-size:11px;color:var(--hero-text-muted);margin-top:2px;">por ' + escHtml(s.solicitanteNombre || '?') + '</div>'
      +   '</div>'
      +   '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">'
      +     '<span style="font-family:var(--mono);font-size:10px;color:' + estadoColor + ';">' + estadoBadge + '</span>'
      +     '<span style="font-family:var(--mono);font-size:10px;color:var(--hero-text-muted);">⏱ ' + elapsed + '</span>'
      +   '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}

function _renderHomeLics(items) {
  const el = document.getElementById('md-lics');
  if (!items.length) {
    renderEmpty(el, { icon: '<iconify-icon icon="tabler:circle-check" style="color:var(--hero-success);"></iconify-icon>', message: 'Ninguna licencia vence en los próximos 30 días.' });
    return;
  }
  const today = Date.now();
  el.innerHTML = items.map(l => {
    const days = Math.ceil((new Date(l.vencimiento).getTime() - today) / 86400000);
    const badgeColor = days < 0 ? 'var(--hero-danger)' : days <= 7 ? 'var(--hero-danger)' : 'var(--hero-warning)';
    const badgeText  = days < 0 ? 'VENCIDA' : days === 0 ? 'VENCE HOY' : days === 1 ? 'Vence mañana' : 'Vence en ' + days + ' días';
    return '<div class="action-card" style="cursor:pointer;padding:14px;" onclick="showPage(\'licencias\')">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">'
      +   '<div style="min-width:0;flex:1;">'
      +     '<div style="font-size:13px;font-weight:600;color:var(--hero-text-primary);">' + escHtml(l.nombre) + '</div>'
      +     '<div style="font-size:11px;color:var(--hero-text-muted);margin-top:2px;">' + escHtml(l.plan || 'sin plan') + (l.costo > 0 ? ' · $' + Number(l.costo).toFixed(2) + '/mes' : '') + '</div>'
      +   '</div>'
      +   '<span style="font-family:var(--mono);font-size:10px;font-weight:700;color:' + badgeColor + ';">' + badgeText + '</span>'
      + '</div>'
      + '</div>';
  }).join('');
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

// Plantillas de casos recurrentes. Cada una carga una respuesta lista para
// enviar al usuario + muestra un checklist de diagnóstico (sólo informativo,
// no se envía) para que Fernando no se olvide de los pasos típicos.
const TICKET_TEMPLATES = [
  {
    id: 'vpn', icon: '<iconify-icon icon="tabler:shield-lock"></iconify-icon>', nombre: 'VPN no conecta',
    respuesta: 'Hola, recibimos tu reporte sobre la VPN.\n\nProbemos lo siguiente en orden:\n1. Desconecta el cliente VPN completamente.\n2. Reinicia tu router (60 segundos sin corriente).\n3. Vuelve a conectar la VPN.\n\nSi sigue sin funcionar, dinos el mensaje exacto que te aparece al intentar conectar (una captura sería ideal).',
    checklist: [
      'Verificar credenciales del usuario',
      'Revisar estado del servidor VPN (down? rebooting?)',
      'Confirmar que no hay bloqueo geo/IP por país',
      'Probar desde otra red (hotspot móvil) para descartar el ISP',
    ],
  },
  {
    id: 'outlook', icon: '<iconify-icon icon="tabler:mail"></iconify-icon>', nombre: 'Outlook lento o no abre',
    respuesta: 'Hola, recibimos tu reporte de Outlook.\n\nPor favor probá esto en orden:\n1. Cerrá Outlook completamente.\n2. Abrelo manteniendo presionada la tecla Ctrl (modo seguro).\n3. Si abre rápido en modo seguro, hay un complemento que lo ralentiza.\n\nContame cómo te fue y, si seguís con problemas, agendamos un soporte remoto.',
    checklist: [
      '¿Funciona en modo seguro?',
      'Tamaño del PST/OST (si pasa 20 GB pesa)',
      'Add-ins instalados (deshabilitar uno por uno)',
      'Caché de auto-complete corrupta (limpiar con archivo .NK2 o cmd:/cleanautocompletecache)',
    ],
  },
  {
    id: 'pwd', icon: '<iconify-icon icon="tabler:key"></iconify-icon>', nombre: 'Contraseña olvidada',
    respuesta: 'Hola, recibimos tu solicitud de reset de contraseña.\n\nEn unos minutos te envío una contraseña temporal a este mismo correo. Al ingresar con ella el sistema te va a pedir que la cambies por una nueva tuya.\n\nNo la compartas con nadie ni la guardes en texto plano.',
    checklist: [
      'Confirmar identidad del usuario (foto + correo conocido)',
      'Generar nueva pwd desde Reset Password',
      'Forzar cambio en próximo login (default ON)',
      'Registrar la acción en Auditoría (se hace solo al usar el módulo)',
    ],
  },
  {
    id: 'wifi', icon: '<iconify-icon icon="tabler:wifi"></iconify-icon>', nombre: 'Wifi débil o inestable',
    respuesta: 'Hola, recibimos tu reporte de problemas con el Wifi.\n\nPara diagnosticarlo necesito un par de datos:\n1. ¿En qué piso/oficina estás?\n2. ¿El problema es solo en tu equipo o también pasa con el celular en la misma red?\n3. ¿Hay momentos del día puntuales donde es peor?\n\nCon esa info vemos si es el equipo, el AP o la red en general.',
    checklist: [
      'Speedtest en cable vs wifi (descarta el ISP)',
      'Signal strength y canal del AP más cercano',
      'Probar con cable ethernet directo',
      'Considerar reubicación del AP si el área tiene mucho concreto',
    ],
  },
  {
    id: 'printer', icon: '<iconify-icon icon="tabler:printer"></iconify-icon>', nombre: 'Impresora no funciona',
    respuesta: 'Hola, recibimos tu reporte de la impresora.\n\nProbemos esto:\n1. Confirmá que la impresora esté encendida y conectada a la red.\n2. Revisá que no haya papel atascado ni tóner agotado.\n3. Avisame qué impresora es (modelo) y qué mensaje te aparece — con eso reinicio el spooler desde mi equipo.',
    checklist: [
      'Modelo + ubicación de la impresora',
      'Estado de la cola de impresión (vaciar si está colgada)',
      'Reinstalar driver si el ping al IP de la impresora no responde',
      'Verificar contadores de tóner/tinta',
    ],
  },
  {
    id: 'lentitud', icon: '<iconify-icon icon="tabler:hourglass-low"></iconify-icon>', nombre: 'Equipo lento en general',
    respuesta: 'Hola, recibimos tu reporte de lentitud.\n\nVamos a hacer un primer diagnóstico:\n1. Reiniciá el equipo (no apagar/encender, sino Reiniciar desde el menú).\n2. Después del reinicio, esperá 5 minutos sin tocar nada y proba de nuevo.\n3. Si sigue lento, agendá un soporte remoto y revisamos juntos.',
    checklist: [
      'Memoria RAM ocupada (Task Manager → Memoria)',
      'Disco al 100% (revisar antivirus o búsqueda de Windows indexando)',
      'Procesos consumidores: Chrome/Teams/Antivirus',
      'Espacio en C: (<10% libre = lento)',
      'Considerar limpieza de archivos temporales + reinicio',
    ],
  },
  {
    id: 'office', icon: '<iconify-icon icon="tabler:file-text"></iconify-icon>', nombre: 'Office no activa / sale "Producto sin licencia"',
    respuesta: 'Hola, recibimos tu reporte de activación de Office.\n\nLo más rápido es:\n1. Cerrá todas las apps de Office.\n2. Abrí Word.\n3. Archivo → Cuenta → "Iniciar sesión" con tu correo @heroinsuranceusa.com\n4. Si ya estás logueado, click en "Actualizar licencia".\n\nSi sigue sin activar, agendamos remoto.',
    checklist: [
      'Confirmar que la cuenta de Workspace tenga licencia Office asignada',
      'Verificar que el equipo no esté con otra cuenta vieja loggeada',
      'Limpiar credenciales en Administrador de Credenciales de Windows',
      'Último recurso: desinstalar + reinstalar Office desde portal',
    ],
  },
];

function toggleTicketTemplates() {
  const panel = document.getElementById('ticket-templates-panel');
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  panel.innerHTML = '<div style="font-size:10px;color:var(--hero-text-muted);margin-bottom:8px;letter-spacing:1px;text-transform:uppercase;">Elige una plantilla — carga respuesta + checklist</div>'
    + TICKET_TEMPLATES.map(t =>
        '<button onclick="loadTicketTemplate(\'' + escJs(t.id) + '\')" class="btn btn-secondary" style="font-size:11px;padding:5px 10px;margin:2px;">'
        + escHtml(t.icon + ' ' + t.nombre)
        + '</button>'
      ).join('');
  panel.style.display = 'block';
}

function loadTicketTemplate(id) {
  const t = TICKET_TEMPLATES.find(x => x.id === id);
  if (!t) return;
  document.getElementById('modal-respuesta').value = t.respuesta;
  const cl = document.getElementById('ticket-checklist');
  cl.innerHTML = '<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--hero-primary-text);margin-bottom:6px;">Checklist de diagnóstico · ' + escHtml(t.nombre) + '</div>'
    + '<ul style="margin:0;padding-left:18px;font-size:12px;color:var(--hero-text-body);line-height:1.7;">'
    + t.checklist.map(c => '<li>' + escHtml(c) + '</li>').join('')
    + '</ul>';
  cl.style.display = 'block';
  document.getElementById('ticket-templates-panel').style.display = 'none';
  showToast('Plantilla "' + t.nombre + '" cargada');
}

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
  if (btn) { btn.disabled = true; btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring>'; }
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
    container.innerHTML = '<div class="info-box" style="text-align:center;padding:40px;"><div style="font-size:32px;opacity:0.3;margin-bottom:12px;"><iconify-icon icon="tabler:mailbox"></iconify-icon></div><div style="font-size:12px;color:var(--hero-text-muted);">Sin tickets</div></div>';
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
  // Reset paneles de plantilla al abrir cada ticket
  const tplPanel = document.getElementById('ticket-templates-panel');
  if (tplPanel) tplPanel.style.display = 'none';
  const tplCheck = document.getElementById('ticket-checklist');
  if (tplCheck) tplCheck.style.display = 'none';

  // Historial
  const hist = t.historial || [];
  const histBox = document.getElementById('modal-historial-box');
  if (hist.length) {
    histBox.style.display = 'block';
    document.getElementById('modal-historial').innerHTML = hist.map(h => {
      const f = new Date(h.fecha).toLocaleString('es-MX', { timeZone:'America/New_York', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
      if (h.tipo === 'estado')    return '<div style="font-size:12px;color:var(--hero-text-muted);padding:4px 0;border-bottom:1px solid var(--hero-border);"><iconify-icon icon="tabler:clipboard-list"></iconify-icon> Estado: <strong>' + h.de + '</strong> → <strong>' + h.a + '</strong> · <span style="font-family:var(--mono);font-size:10px;">' + f + '</span></div>';
      if (h.tipo === 'respuesta') return '<div style="font-size:12px;color:var(--hero-text-muted);padding:4px 0;border-bottom:1px solid var(--hero-border);"><iconify-icon icon="tabler:message-circle"></iconify-icon> Respuesta enviada · <span style="font-family:var(--mono);font-size:10px;">' + f + '</span></div>';
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
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Guardando...';
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
  btn.innerHTML = '<iconify-icon icon="tabler:device-floppy"></iconify-icon> Guardar y notificar usuario';
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
  if (btn) { btn.disabled = true; btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring>'; }
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
      + '<div style="font-size:32px;opacity:0.3;margin-bottom:12px;"><iconify-icon icon="tabler:mailbox"></iconify-icon></div>'
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
        + '<span style="color:var(--hero-primary);font-weight:600;"><iconify-icon icon="tabler:check"></iconify-icon> Autorizada</span>'
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
        + (s.telefono       ? '<span><iconify-icon icon="tabler:phone"></iconify-icon> ' + escHtml(s.telefono) + '</span>' : '')
        + (s.fechaRequerida ? '<span><iconify-icon icon="tabler:calendar"></iconify-icon> Requerida: ' + escHtml(s.fechaRequerida) + '</span>' : '')
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
          + '<button class="btn btn-primary" onclick="suspenderDesdeSolicitud(\'' + s.id + '\',\'' + safeCorreoEl + '\',\'' + safeTitulo + '\')" style="font-size:12px;flex:1;background:linear-gradient(135deg,#c0392b,#e67e22);"><iconify-icon icon="tabler:lock"></iconify-icon> Suspender cuenta</button>'
          + '<button class="btn btn-secondary" onclick="rechazarSolicitud(\'' + s.id + '\',\'' + safeSolEmail + '\',\'' + safeSolNombre + '\',\'' + safeTitulo + '\',\'baja\')" style="font-size:12px;"><iconify-icon icon="tabler:x"></iconify-icon> Rechazar</button>'
          + '<button class="btn btn-secondary" onclick="resolverSolicitud(\'' + s.id + '\',\'procesada\')" style="font-size:12px;"><iconify-icon icon="tabler:check"></iconify-icon> Marcar procesada</button>'
          + '</div>';
      } else {
        acciones = '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
          + '<button class="btn btn-primary" onclick="openSolModal(\'' + s.id + '\')" style="font-size:12px;flex:1;"><iconify-icon icon="tabler:user-plus"></iconify-icon> Crear usuario</button>'
          + '<button class="btn btn-secondary" onclick="rechazarSolicitud(\'' + s.id + '\',\'' + safeSolEmail + '\',\'' + safeSolNombre + '\',\'' + safeTitulo + '\',\'alta\')" style="font-size:12px;"><iconify-icon icon="tabler:x"></iconify-icon> Rechazar</button>'
          + '<button class="btn btn-secondary" onclick="resolverSolicitud(\'' + s.id + '\',\'procesada\')" style="font-size:12px;"><iconify-icon icon="tabler:check"></iconify-icon> Marcar procesada</button>'
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
      + '<div style="font-size:11px;color:var(--hero-text-muted);margin-bottom:' + (isOpen ? '14px' : '0') + ';"><iconify-icon icon="tabler:clock"></iconify-icon> ' + fecha + ' ET</div>'
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
  // Suggest email — quita diacríticos combinables (U+0300–U+036F) usando
  // escapes unicode para que el archivo no dependa de su codificación.
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
  const pwd = _generateStrongPassword();
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
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Creando...';

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
  btn.innerHTML = '<iconify-icon icon="tabler:check"></iconify-icon> Crear usuario y notificar';
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
  document.getElementById('new-password').value = _generateStrongPassword();
}

async function crearUsuario() {
  const nombre   = document.getElementById('new-nombre').value.trim();
  const apellido = document.getElementById('new-apellido').value.trim();
  const emailUser = document.getElementById('new-email-user').value.trim();
  const password  = document.getElementById('new-password').value.trim();
  const emailPers = document.getElementById('new-email-personal').value.trim();
  const tipo      = document.getElementById('new-tipo').value;
  const lang      = document.getElementById('new-lang-up').value;
  const autoSend  = document.getElementById('new-auto-send').checked;

  if (!nombre || !apellido) { showToast('Falta nombre o apellido'); return; }
  if (!emailUser) { showToast('Falta el usuario del email'); return; }
  if (!password)  { showToast('Falta la contraseña temporal'); return; }

  const emailCorp = emailUser + atSign + 'heroinsuranceusa.com';
  const btn = document.getElementById('btn-crear-usuario');
  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Creando...';
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

    // Si el usuario optó por auto-send y hay email personal, mandamos el
    // onboarding inmediatamente en lugar de pedirle un segundo click.
    if (autoSend && emailPers) {
      addLog('Enviando onboarding ' + tipo + ' (' + lang + ') a ' + emailPers + '...', 'info', 'log-new');
      try {
        const htmlBody = tipo === 'empleado'
          ? buildEmailEmpleado(nuevoUsuario.nombre, emailCorp, password, lang)
          : buildEmailAgente(nuevoUsuario.nombre, emailCorp, password, lang);
        await sendViaResend({
          to: emailPers,
          subject: onboardingSubject(tipo, lang),
          html: htmlBody,
          text: onboardingText(nuevoUsuario.nombre, emailCorp, lang),
        });
        addLog('Onboarding enviado a ' + emailPers, 'success', 'log-new');
        auditLog('onboarding', 'Onboarding ' + tipo + ' enviado a ' + emailPers, emailCorp);
        showToast('Usuario creado y onboarding enviado');
        resetCrearUsuario();
      } catch (mailErr) {
        addLog('Usuario creado pero onboarding falló: ' + mailErr.message, 'warn', 'log-new');
        showToast('Usuario creado, pero el onboarding falló — usa el panel manual abajo');
        // Caer al panel manual para que Fernando pueda reintentar
        document.getElementById('new-onboarding-box').style.display = 'block';
      }
    } else {
      showToast('Usuario creado en Workspace');
      // Sin auto-send (o sin email personal): mostrar el panel manual para
      // que Fernando decida si manda onboarding o no, y de qué tipo.
      if (emailPers) document.getElementById('new-onboarding-box').style.display = 'block';
    }

  } catch (err) {
    addLog('Error: ' + err.message, 'error', 'log-new');
    showToast('Error al crear usuario');
  }

  btn.disabled = false;
  btn.innerHTML = '<iconify-icon icon="tabler:sparkles"></iconify-icon> Crear usuario y enviar onboarding';
}

async function sendOnboardingNuevo(tipo) {
  if (!nuevoUsuario) return;
  const btnId = tipo === 'empleado' ? 'btn-ob-emp' : 'btn-ob-agt';
  const btn = document.getElementById(btnId);
  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Enviando...';

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
  btn.innerHTML = tipo === 'empleado'
    ? '<iconify-icon icon="tabler:user"></iconify-icon> Enviar como Empleado'
    : '<iconify-icon icon="tabler:briefcase"></iconify-icon> Enviar como Agente';
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
    + 'Contraseña: ' + (incluir ? (pass || '(usa el botón generar)') : 'no se incluye en el correo');
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
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Enviando...';
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
  btn.innerHTML = '<iconify-icon icon="tabler:send"></iconify-icon> Enviar correo de onboarding';
}

// ── Módulo Usuarios Workspace ─────────────────────────────────
let allUsers = [];

async function loadUsers() {
  const btn = document.getElementById('btn-load-users');
  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Cargando...';
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
        '<tr><td colspan="8" style="padding:32px;text-align:center;">'
      +   '<div style="font-size:32px;opacity:0.4;margin-bottom:12px;color:var(--hero-warning);"><iconify-icon icon="tabler:alert-triangle"></iconify-icon></div>'
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
    tbody.innerHTML = '<tr><td colspan="8" style="padding:32px;text-align:center;color:var(--hero-text-muted);font-family:var(--mono);font-size:12px;">Sin resultados</td></tr>';
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
    // 2FA: check verde si está enrolado, warning rojo si no. Si está enforced por
    // política pero el usuario aún no se enroló (mfaEnforced && !mfaEnrolled),
    // se muestra igual como faltante.
    const mfaLabel = u.mfaEnrolled
      ? '<iconify-icon icon="tabler:check"></iconify-icon>'
      : '<iconify-icon icon="tabler:alert-triangle"></iconify-icon>';
    const mfaColor = u.mfaEnrolled ? 'var(--hero-success)' : 'var(--hero-danger)';
    const mfaBg    = u.mfaEnrolled ? 'rgba(34,160,107,0.1)' : 'rgba(214,69,69,0.1)';
    const mfaTitle = u.mfaEnrolled ? '2FA activado' : (u.mfaEnforced ? '2FA obligatorio pero sin enrolar' : '2FA no activado');

    return '<tr style="border-bottom:1px solid var(--hero-border-card);background:' + rowBg + ';">' +
      '<td style="padding:10px 16px;color:var(--hero-text-primary);">' + escHtml(u.nombre) + '</td>' +
      '<td style="padding:10px 16px;font-family:var(--mono);font-size:12px;color:var(--hero-primary);">' + escHtml(u.email) + '</td>' +
      '<td style="padding:10px 16px;font-family:var(--mono);font-size:11px;color:var(--hero-text-body);">' + escHtml(ouLabel) + '</td>' +
      '<td style="padding:10px 16px;">' +
        '<span style="font-family:var(--mono);font-size:10px;padding:3px 8px;border-radius:20px;background:' + estadoBg + ';color:' + estadoColor + ';">' + escHtml(u.estado) + '</span>' +
      '</td>' +
      '<td style="padding:10px 16px;text-align:center;" title="' + mfaTitle + '">' +
        '<span style="font-family:var(--mono);font-size:12px;font-weight:700;padding:3px 8px;border-radius:20px;background:' + mfaBg + ';color:' + mfaColor + ';">' + mfaLabel + '</span>' +
      '</td>' +
      '<td style="padding:10px 16px;font-family:var(--mono);font-size:11px;color:var(--hero-text-body);">' + creado + '</td>' +
      '<td style="padding:10px 16px;font-family:var(--mono);font-size:11px;color:var(--hero-text-body);">' + login + '</td>' +
      '<td style="padding:10px 16px;text-align:center;">' +
        '<div style="display:flex;gap:6px;justify-content:center;">' +
        '<button onclick="copyEmail(\'' + escJs(u.email) + '\')" style="background:transparent;border:1px solid var(--hero-border-card);color:var(--hero-text-body);padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;" title="Copiar email"><iconify-icon icon="tabler:copy"></iconify-icon></button>' +
        '<button onclick="openUserModal(\'' + escJs(u.email) + '\',\'' + escJs(u.nombre) + '\')" style="background:rgba(6,163,182,0.1);border:1px solid rgba(6,163,182,0.3);color:var(--hero-primary);padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;" title="Gestionar"><iconify-icon icon="tabler:settings"></iconify-icon></button>' +
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
  const mfa = document.getElementById('usr-filter-mfa')?.value || '';
  if (!allUsers.length) return;
  const filtered = allUsers.filter(u => {
    const matchText = u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchOu = !ou || (u.orgUnitPath || '/') === ou;
    const matchMfa = !mfa || (mfa === 'si' ? u.mfaEnrolled : !u.mfaEnrolled);
    return matchText && matchOu && matchMfa;
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
const DEV_TIPO_ICON = {
  laptop:    '<iconify-icon icon="tabler:device-laptop"></iconify-icon>',
  desktop:   '<iconify-icon icon="tabler:device-desktop"></iconify-icon>',
  'teléfono': '<iconify-icon icon="tabler:device-mobile"></iconify-icon>'
};
const DEV_FALLBACK_ICON = '<iconify-icon icon="tabler:device-desktop"></iconify-icon>';
const INT_TIPO_COLOR = {
  'Instalación de software': 'var(--hero-primary)',
  'Reparación o diagnóstico': 'var(--hero-warning)',
  'Soporte remoto': 'var(--hero-primary-dark)',
};

async function loadDevices(forceFresh = false) {
  renderSkeleton(document.getElementById('dev-grid'), { type: 'card', rows: 4 });
  try {
    const url = WORKER_URL + '/device?withZoho=1' + (forceFresh ? '&fresh=1' : '');
    const resp = await authFetch(url);
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
  const conn   = document.getElementById('dev-filter-conn').value;
  const estado = document.getElementById('dev-filter-estado').value;
  const tipo   = document.getElementById('dev-filter-tipo').value;
  let filtered = allDevices;
  if (conn)   filtered = filtered.filter(d => (d.zohoStatus || '').toLowerCase() === conn);
  if (estado) filtered = filtered.filter(d => d.estado === estado);
  if (tipo)   filtered = filtered.filter(d => d.tipo === tipo);
  if (q)      filtered = filtered.filter(d =>
    d.nombre.toLowerCase().includes(q) || (d.usuario || '').toLowerCase().includes(q)
  );
  renderDeviceGrid(filtered);
}

function renderDeviceGrid(devices) {
  const total   = devices.length;
  const onlines = devices.filter(d => d.zohoStatus === 'online').length;
  document.getElementById('dev-count').textContent =
    total + ' dispositivo' + (total !== 1 ? 's' : '') +
    ' · ' + onlines + ' online';
  const grid = document.getElementById('dev-grid');
  if (!devices.length) {
    grid.innerHTML = '<div class="info-box" style="text-align:center;padding:40px;grid-column:1/-1;"><div style="font-size:32px;opacity:0.3;margin-bottom:12px;"><iconify-icon icon="tabler:device-desktop"></iconify-icon></div><div style="font-family:var(--mono);font-size:12px;color:var(--hero-text-muted);">Sin dispositivos con estos filtros</div></div>';
    return;
  }
  grid.innerHTML = devices.map(d => {
    const eColor   = DEV_ESTADO_COLOR[d.estado] || 'var(--hero-text-body)';
    const icon     = DEV_TIPO_ICON[d.tipo] || DEV_FALLBACK_ICON;
    const intCount = (d.intervenciones || []).length;
    const isOnline = (d.zohoStatus || '').toLowerCase() === 'online';
    const dotColor = isOnline ? 'var(--hero-success)' : 'var(--hero-text-muted)';
    const dotGlow  = isOnline ? '0 0 6px var(--hero-success)' : 'none';
    const soDisplay = d.so || d.zohoLiveOs || 'SO no especificado';
    const lc = deviceLifecycle(d);
    return '<div class="action-card" style="cursor:pointer;--card-color:' + (isOnline ? 'var(--hero-success)' : 'var(--hero-border-card)') + ';" onclick="openDeviceDetail(\'' + escJs(d.id) + '\')">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">'
      +   '<div style="display:flex;align-items:center;gap:8px;">'
      +     '<div style="width:8px;height:8px;border-radius:50%;background:' + dotColor + ';box-shadow:' + dotGlow + ';flex-shrink:0;" title="' + (isOnline ? 'Online' : 'Offline') + '"></div>'
      +     '<span style="font-size:22px;">' + icon + '</span>'
      +   '</div>'
      +   '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(0,0,0,0.06);color:' + eColor + ';">' + escHtml(d.estado) + '</span>'
      + '</div>'
      + '<div style="font-size:14px;font-weight:600;color:var(--hero-text-primary);margin-bottom:3px;">' + escHtml(d.nombre) + '</div>'
      + '<div style="font-size:12px;color:var(--hero-text-body);margin-bottom:8px;">' + escHtml(d.usuario || 'Sin usuario asignado') + '</div>'
      + '<div style="display:flex;gap:12px;font-size:11px;color:var(--hero-text-muted);">'
      +   '<span>' + escHtml(soDisplay) + '</span>'
      +   '<span style="margin-left:auto;">' + intCount + ' interv.</span>'
      + '</div>'
      + '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">'
      + (d.gcpw ? '<span style="font-family:var(--mono);font-size:9px;padding:2px 6px;border-radius:4px;background:var(--hero-primary-light);color:var(--hero-primary-text);">GCPW</span>' : '')
      + '<span style="font-family:var(--mono);font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,0.05);color:var(--hero-text-muted);">' + escHtml(d.tipo) + '</span>'
      + (lc.renovarSoon
          ? '<span style="font-family:var(--mono);font-size:9px;padding:2px 6px;border-radius:4px;background:' + lc.badgeBg + ';color:' + lc.badgeColor + ';">' + lc.badgeText + '</span>'
          : '')
      + '</div>'
      + (isOnline && d.zohoId
          ? '<button onclick="event.stopPropagation();startZohoSession(\'' + escJs(d.zohoId) + '\',\'' + escJs(d.nombre) + '\')" class="btn btn-primary" style="width:100%;font-size:12px;margin-top:10px;"><iconify-icon icon="tabler:screen-share"></iconify-icon> Conectar (Zoho)</button>'
          : '')
      + '</div>';
  }).join('');
}

// Calcula info de lifecycle de un dispositivo basado en fechaCompra +
// vidaUtilAnios. Devuelve siempre el mismo shape para que callers no tengan
// que chequear undefined a mano.
function deviceLifecycle(d) {
  if (!d.fechaCompra || !d.vidaUtilAnios) {
    return { hasData: false, renovarSoon: false };
  }
  const compra = new Date(d.fechaCompra);
  const renovar = new Date(compra);
  renovar.setFullYear(renovar.getFullYear() + Number(d.vidaUtilAnios));
  const daysToRenew = Math.ceil((renovar.getTime() - Date.now()) / 86400000);
  const monthsToRenew = Math.round(daysToRenew / 30);
  const renovarSoon = daysToRenew <= 180; // 6 meses
  const overdue     = daysToRenew < 0;
  const badgeColor  = overdue ? '#fff'                : (daysToRenew <= 60 ? '#fff' : 'var(--hero-warning)');
  const badgeBg     = overdue ? 'var(--hero-danger)'  : (daysToRenew <= 60 ? 'var(--hero-warning)' : 'rgba(232,163,23,0.15)');
  const badgeText   = overdue
    ? 'RENOVAR (vencido)'
    : daysToRenew <= 30 ? 'Renovar en ' + daysToRenew + 'd'
    : 'Renovar en ' + monthsToRenew + ' mes' + (monthsToRenew !== 1 ? 'es' : '');
  return {
    hasData: true, renovarSoon, overdue,
    daysToRenew, monthsToRenew, renovar,
    badgeColor, badgeBg, badgeText,
  };
}

async function openDeviceDetail(id) {
  const device = allDevices.find(d => d.id === id);
  if (!device) return;
  currentDeviceId = id;
  currentDevice = device;

  document.getElementById('dev-list-view').style.display = 'none';
  document.getElementById('dev-detail-view').style.display = 'block';
  const isOnline = (device.zohoStatus || '').toLowerCase() === 'online';
  const dotColor = isOnline ? 'var(--hero-success)' : 'var(--hero-text-muted)';
  const dotGlow  = isOnline ? '0 0 6px var(--hero-success)' : 'none';
  document.getElementById('dev-detail-title').innerHTML =
      '<div style="display:inline-flex;align-items:center;gap:10px;">'
    +   '<div style="width:10px;height:10px;border-radius:50%;background:' + dotColor + ';box-shadow:' + dotGlow + ';"></div>'
    +   '<span>' + (DEV_TIPO_ICON[device.tipo] || DEV_FALLBACK_ICON) + '  ' + escHtml(device.nombre) + '</span>'
    +   '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(0,0,0,0.06);color:' + dotColor + ';">' + (isOnline ? 'online' : 'offline') + '</span>'
    + '</div>';

  // Info — row() inyecta su segundo argumento como HTML, así que valores
  // venidos del backend deben ir pre-escapados con escHtml.
  const eColor = DEV_ESTADO_COLOR[device.estado] || 'var(--hero-text-body)';
  const lc = deviceLifecycle(device);
  const lifecycleRows = lc.hasData
    ? row('Comprado', escHtml(new Date(device.fechaCompra).toLocaleDateString('es-MX', { year:'numeric', month:'short', day:'numeric' })))
    + row('Vida útil', escHtml(device.vidaUtilAnios + ' año' + (device.vidaUtilAnios !== 1 ? 's' : '')))
    + row('Renovar antes de', '<span style="color:' + (lc.overdue ? 'var(--hero-danger)' : (lc.renovarSoon ? 'var(--hero-warning)' : 'var(--hero-text-primary)')) + ';font-weight:' + (lc.renovarSoon ? '600' : '400') + ';">'
        + escHtml(lc.renovar.toLocaleDateString('es-MX', { year:'numeric', month:'short', day:'numeric' }))
        + ' <span style="font-size:11px;color:var(--hero-text-muted);">(' + escHtml(lc.badgeText) + ')</span></span>')
    + (device.costoOriginal ? row('Costo original', '$' + Number(device.costoOriginal).toFixed(2) + ' USD') : '')
    : row('Lifecycle', '<span style="color:var(--hero-text-muted);font-size:11px;">Sin datos de compra · click editar para agregar fecha y vida útil</span>');

  // Filas live de Zoho (no editables; vienen de la API)
  const liveRows = device.zohoId
    ? row('Estado conexión', '<span style="color:' + dotColor + ';"><iconify-icon icon="tabler:circle-filled"></iconify-icon> ' + (isOnline ? 'Online' : 'Offline') + '</span>')
      + (device.zohoLiveOs ? row('SO detectado', escHtml(device.zohoLiveOs)) : '')
      + (device.zohoIp     ? row('IP',            '<span style="font-family:var(--mono);">' + escHtml(device.zohoIp) + '</span>') : '')
      + (device.zohoGroup  ? row('Grupo Zoho',    escHtml(device.zohoGroup)) : '')
    : '';

  document.getElementById('dev-detail-info').innerHTML =
    '<div style="display:grid;gap:6px;">'
    + liveRows
    + row('Usuario', escHtml(device.usuario || '—'))
    + row('Tipo', escHtml(device.tipo))
    + row('SO (registrado)', escHtml(device.so || '—'))
    + row('GCPW', device.gcpw ? '<span style="color:var(--hero-primary);"><iconify-icon icon="tabler:check"></iconify-icon> Activado</span>' : '<span style="color:var(--hero-text-muted);"><iconify-icon icon="tabler:x"></iconify-icon> No activado</span>')
    + row('Estado IT', '<span style="color:' + eColor + ';">' + escHtml(device.estado) + '</span>')
    + lifecycleRows
    + '</div>'
    + (isOnline && device.zohoId
        ? '<button onclick="startZohoSession(\'' + escJs(device.zohoId) + '\',\'' + escJs(device.nombre) + '\')" class="btn btn-primary" style="width:100%;margin-top:14px;"><iconify-icon icon="tabler:screen-share"></iconify-icon> Iniciar sesión remota (Zoho)</button>'
        : '');

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
    el.innerHTML = '<div class="log-empty"><div class="log-empty-icon"><iconify-icon icon="tabler:clipboard-list"></iconify-icon></div><div class="log-empty-text">Sin intervenciones registradas</div></div>';
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
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Guardando...';

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
  btn.innerHTML = '<iconify-icon icon="tabler:check"></iconify-icon> Registrar intervención';
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
  document.getElementById('dev-f-fecha-compra').value = device ? (device.fechaCompra || '') : '';
  document.getElementById('dev-f-vida-util').value    = device && device.vidaUtilAnios != null ? device.vidaUtilAnios : 4;
  document.getElementById('dev-f-costo').value        = device && device.costoOriginal != null ? device.costoOriginal : '';
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
  const fechaCompra   = document.getElementById('dev-f-fecha-compra').value || null;
  const vidaUtilRaw   = document.getElementById('dev-f-vida-util').value;
  const vidaUtilAnios = vidaUtilRaw ? Math.max(1, Math.min(15, parseInt(vidaUtilRaw, 10) || 4)) : null;
  const costoRaw      = document.getElementById('dev-f-costo').value;
  const costoOriginal = costoRaw ? Number(costoRaw) : null;

  if (!nombre) { showToast('El nombre del dispositivo es obligatorio'); return; }

  const btn = document.getElementById('btn-dev-save');
  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Guardando...';

  try {
    const endpoint = editingDeviceId ? '/device/update' : '/device';
    const body = editingDeviceId
      ? { id: editingDeviceId, nombre, tipo, usuario, so, gcpw, apps, estado, fechaCompra, vidaUtilAnios, costoOriginal }
      : { nombre, tipo, usuario, so, gcpw, apps, estado, fechaCompra, vidaUtilAnios, costoOriginal };

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
    // forzar fresh para reflejar la edición sin esperar el cache de 60s
    await loadDevices(true);

    // If editing, refresh detail view
    if (editingDeviceId && currentDeviceId === editingDeviceId) {
      const updated = allDevices.find(d => d.id === editingDeviceId);
      if (updated) { currentDevice = updated; openDeviceDetail(editingDeviceId); }
    }
  } catch(err) {
    showToast('Error: ' + err.message);
  }
  btn.disabled = false;
  btn.innerHTML = '<iconify-icon icon="tabler:device-floppy"></iconify-icon> Guardar dispositivo';
}

// ── Exportar reporte CSV ──────────────────────────────────────
function exportDeviceReport() {
  if (!currentDevice) return;
  const d = currentDevice;
  const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('es-MX', { timeZone: 'America/New_York', year:'numeric', month:'short', day:'numeric' }) : '';
  const fmtDateTime = ts => ts ? new Date(ts).toLocaleString('es-MX', { timeZone: 'America/New_York' }) : '';

  // Sección 1: Info del equipo
  let csv = csvRow(['REPORTE DE DISPOSITIVO']);
  csv += csvRow(['Generado', fmtDateTime(Date.now()) + ' ET']);
  csv += csvRow([]);
  csv += csvRow(['Campo', 'Valor']);
  csv += csvRow(['ID',                  d.id || '']);
  csv += csvRow(['Nombre / Hostname',   d.nombre || '']);
  csv += csvRow(['Tipo',                d.tipo || '']);
  csv += csvRow(['Usuario asignado',    d.usuario || '']);
  csv += csvRow(['SO (registrado)',     d.so || '']);
  csv += csvRow(['GCPW',                d.gcpw ? 'Activado' : 'No activado']);
  csv += csvRow(['Estado IT',           d.estado || '']);
  csv += csvRow(['Fecha de registro',   fmtDate(d.fecha)]);

  // Lifecycle (si hay datos)
  if (d.fechaCompra || d.vidaUtilAnios != null || d.costoOriginal != null) {
    csv += csvRow([]);
    csv += csvRow(['LIFECYCLE / RENOVACIÓN']);
    csv += csvRow(['Fecha de compra',     fmtDate(d.fechaCompra)]);
    csv += csvRow(['Vida útil (años)',    d.vidaUtilAnios != null ? d.vidaUtilAnios : '']);
    csv += csvRow(['Costo original (USD)', d.costoOriginal != null ? Number(d.costoOriginal).toFixed(2) : '']);
    // Renovación calculada
    if (d.fechaCompra && d.vidaUtilAnios) {
      const renovar = new Date(d.fechaCompra);
      renovar.setFullYear(renovar.getFullYear() + Number(d.vidaUtilAnios));
      const days = Math.ceil((renovar.getTime() - Date.now()) / 86400000);
      csv += csvRow(['Fecha de renovación', fmtDate(renovar.toISOString())]);
      csv += csvRow(['Días restantes',      days]);
    }
  }

  // Zoho live data (si está vinculado)
  if (d.zohoId) {
    csv += csvRow([]);
    csv += csvRow(['ESTADO ZOHO ASSIST (live)']);
    csv += csvRow(['Zoho ID',         d.zohoId]);
    csv += csvRow(['Conexión',        (d.zohoStatus || 'offline').toUpperCase()]);
    csv += csvRow(['SO detectado',    d.zohoLiveOs || '']);
    csv += csvRow(['IP',              d.zohoIp || '']);
    csv += csvRow(['Grupo Zoho',      d.zohoGroup || '']);
  }

  // Apps instaladas
  csv += csvRow([]);
  csv += csvRow(['APLICACIONES INSTALADAS']);
  const apps = d.apps || [];
  if (apps.length) {
    apps.forEach(a => { csv += csvRow([a]); });
    csv += csvRow(['Total', apps.length]);
  } else {
    csv += csvRow(['(sin aplicaciones registradas)']);
  }

  // Intervenciones
  csv += csvRow([]);
  csv += csvRow(['HISTORIAL DE INTERVENCIONES']);
  const ints = d.intervenciones || [];
  if (ints.length) {
    csv += csvRow(['Fecha ET', 'Tipo', 'Descripción', 'Notas']);
    ints.forEach(i => {
      csv += csvRow([fmtDateTime(i.fecha), i.tipo, i.descripcion, i.notas || '']);
    });
    csv += csvRow(['Total intervenciones', ints.length]);
  } else {
    csv += csvRow(['(sin intervenciones registradas)']);
  }

  const safeName = (d.nombre || 'dispositivo').replace(/[^a-zA-Z0-9\-]/g, '-').replace(/-+/g, '-');
  downloadCsv(csv, 'reporte-' + safeName + '-' + new Date().toISOString().slice(0, 10) + '.csv');
  showToast('Reporte exportado');
}

// ── Sesión remota Zoho ────────────────────────────────────────
// Llama al Worker → API oficial de Zoho v2 → devuelve technician_uri.
// Abre la pestaña inmediatamente al click (evita bloqueo de popup) y la
// redirige cuando llega la URL real desde el backend.
async function startZohoSession(computerId, name) {
  const popup = window.open('about:blank', '_blank');
  if (popup) {
    try {
      popup.document.write(
        '<title>Iniciando sesión Zoho...</title>'
        + '<div style="font-family:Trebuchet MS,Arial,sans-serif;text-align:center;padding:60px 20px;color:#444;">'
        +   '<div style="font-size:18px;font-weight:600;color:#06a3b6;margin-bottom:10px;">Iniciando sesión Zoho Assist</div>'
        +   '<div style="font-size:13px;color:#777;">Conectando con <strong>' + name.replace(/[<>]/g,'') + '</strong>...</div>'
        + '</div>'
      );
    } catch(_) {}
  }
  addLog('Iniciando sesión Zoho para ' + name + '...', 'info');
  showToast('Conectando con ' + name + '...');
  try {
    const resp = await authFetch(WORKER_URL + '/zoho/session/' + encodeURIComponent(computerId));
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error al iniciar sesión');
    if (!data.sessionUrl) throw new Error('Zoho no devolvió URL de sesión');
    if (popup) popup.location.href = data.sessionUrl;
    else window.open(data.sessionUrl, '_blank');
    auditLog('zoho', 'Sesion remota iniciada: ' + name, computerId);
    addLog('Sesión Zoho lista', 'info');
  } catch(err) {
    if (popup) try { popup.close(); } catch(_) {}
    showToast('Error Zoho: ' + err.message);
    addLog('Error sesión Zoho: ' + err.message, 'error');
  }
}
// ── Render session logs on demand ───────────────────────────
function renderSessionLogs() {
  const body = document.getElementById('log-body');
  if (!body) return;
  if (!sessionLogs.length) {
    body.innerHTML = '<div class="log-empty"><div class="log-empty-icon"><iconify-icon icon="tabler:clipboard-list"></iconify-icon></div><div class="log-empty-text">Sin actividad en esta sesión</div></div>';
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

// ── Atajos de teclado ─────────────────────────────────────────
// "/" foco al buscador, "?" muestra cheatsheet, "g X" navega entre páginas.
// Se desactivan cuando hay foco en un input editable o un modal abierto,
// para no interferir con el usuario tipeando.
function _shortcutsHelp() {
  let modal = document.getElementById('shortcuts-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'shortcuts-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Atajos de teclado');
    modal.setAttribute('data-close-fn', '__shortcutsClose');
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(26,39,51,0.5);z-index:200;overflow-y:auto;padding:24px;';
    modal.innerHTML =
        '<div style="background:#fff;border:1px solid var(--hero-border);border-radius:14px;max-width:440px;margin:60px auto;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,0.18);">'
      +   '<div style="font-size:16px;font-weight:700;color:var(--hero-text-primary);margin-bottom:14px;">⌨️ Atajos de teclado</div>'
      +   '<div style="display:grid;grid-template-columns:auto 1fr;gap:10px 16px;font-size:13px;align-items:center;">'
      +     '<kbd>/</kbd><span>Buscador global</span>'
      +     '<kbd>g h</kbd><span>Home</span>'
      +     '<kbd>g s</kbd><span>Solicitudes</span>'
      +     '<kbd>g u</kbd><span>Usuarios</span>'
      +     '<kbd>g t</kbd><span>Soporte · Tickets</span>'
      +     '<kbd>g k</kbd><span>Soporte · Knowledge Base</span>'
      +     '<kbd>g d</kbd><span>Soporte · Dispositivos</span>'
      +     '<kbd>g l</kbd><span>Soporte · Licencias</span>'
      +     '<kbd>g a</kbd><span>Auditoría</span>'
      +     '<kbd>g r</kbd><span>Reset contraseña</span>'
      +     '<kbd>Esc</kbd><span>Cerrar modal</span>'
      +     '<kbd>?</kbd><span>Mostrar este panel</span>'
      +   '</div>'
      +   '<div style="display:flex;justify-content:flex-end;margin-top:18px;">'
      +     '<button id="shortcuts-close" class="btn btn-secondary" style="font-size:13px;">Cerrar</button>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(modal);
    const style = document.createElement('style');
    style.textContent = '#shortcuts-modal kbd { font-family: var(--mono); background: var(--hero-bg-page); border: 1px solid var(--hero-border-card); border-radius: 4px; padding: 2px 8px; font-size: 11px; color: var(--hero-text-primary); display: inline-block; min-width: 30px; text-align: center; }';
    document.head.appendChild(style);
    if (typeof _setupModalA11y === 'function') _setupModalA11y(modal);
    const close = () => { modal.style.display = 'none'; };
    window.__shortcutsClose = close;
    modal.querySelector('#shortcuts-close').onclick = close;
  }
  modal.style.display = 'block';
}

function installKeyboardShortcuts() {
  let lastG = 0;
  document.addEventListener('keydown', (e) => {
    // No interferir si está escribiendo en un input editable
    const tag = (e.target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
    // No interferir si hay un dialog abierto (Esc lo maneja installModalA11y)
    const modalOpen = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some(_isModalVisible);
    if (modalOpen) return;
    // "?" sin modificadores → cheatsheet
    if (e.key === '?') { e.preventDefault(); _shortcutsHelp(); return; }
    // "/" sin modificadores → buscador
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openGlobalSearch(); return; }
    // "g" inicia combo
    if (e.key === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      lastG = Date.now();
      return;
    }
    if (lastG && Date.now() - lastG < 800) {
      // g m mantiene Home por memoria muscular (era 'Mi día'). g d ahora es
      // Dispositivos (sub-tab de Soporte). Home usa g h.
      const map = { h:'dashboard', m:'dashboard', t:'tickets', s:'solicitudes', u:'usuarios', l:'licencias', a:'auditoria', r:'reset', k:'kb', d:'dispositivos' };
      if (map[e.key]) {
        e.preventDefault();
        showPage(map[e.key]);
        lastG = 0;
      }
    }
  });
}

// ── Init ──────────────────────────────────────────────────────
(function init() {
  installModalA11y();
  installKeyboardShortcuts();
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
  { id: 'suspend',    label: 'Suspender cuenta de Google Workspace',       icon: '<iconify-icon icon="tabler:lock"></iconify-icon>', auto: true  },
  { id: 'sessions',  label: 'Revocar todas las sesiones activas',           icon: '<iconify-icon icon="tabler:ban"></iconify-icon>', auto: false },
  { id: 'groups',    label: 'Remover de Google Groups y carpetas Drive',    icon: '<iconify-icon icon="tabler:folder"></iconify-icon>', auto: false },
  { id: 'shared',    label: 'Cambiar contraseñas de cuentas compartidas',   icon: '<iconify-icon icon="tabler:key"></iconify-icon>', auto: false },
  { id: 'zoho',      label: 'Revocar acceso a Zoho Assist',                icon: '<iconify-icon icon="tabler:screen-share"></iconify-icon>', auto: false },
  { id: 'external',  label: 'Revocar accesos a sistemas externos (carriers, ClickUp, etc.)', icon: '<iconify-icon icon="tabler:world"></iconify-icon>', auto: false },
  { id: 'equipment', label: 'Gestionar devolución de equipos',              icon: '<iconify-icon icon="tabler:device-desktop"></iconify-icon>', auto: false },
  { id: 'record',    label: 'Registrar baja en sistema de RR.HH.',          icon: '<iconify-icon icon="tabler:clipboard-list"></iconify-icon>', auto: false },
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
      + (isDone ? '<iconify-icon icon="tabler:check"></iconify-icon>' : '') + '</button>'
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
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Ejecutando...';

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
  btn.innerHTML = '<iconify-icon icon="tabler:door-exit"></iconify-icon> Ejecutar offboarding';
}

// ── Módulo Knowledge Base ─────────────────────────────────────
let allKb = [];
let editingKbId = null;
let _kbOrigenTicket = null;

async function loadKb() {
  renderSkeleton(document.getElementById('kb-grid'), { type: 'card', rows: 3 });
  try {
    const r = await authFetch(WORKER_URL + '/kb');
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Error');
    allKb = d.articulos || [];
    filterKb();
  } catch (e) {
    renderError(document.getElementById('kb-grid'), e, loadKb);
  }
}

function filterKb() {
  const q = (document.getElementById('kb-search').value || '').toLowerCase();
  let list = allKb;
  if (q) {
    list = allKb.filter(a => {
      const blob = (a.titulo + ' ' + (a.contenido || '') + ' ' + (a.tags || []).join(' ')).toLowerCase();
      return blob.includes(q);
    });
  }
  document.getElementById('kb-count').textContent = list.length + ' artículo' + (list.length !== 1 ? 's' : '');
  renderKb(list);
}

function renderKb(items) {
  const grid = document.getElementById('kb-grid');
  if (!items.length) {
    renderEmpty(grid, {
      icon: '<iconify-icon icon="tabler:book-2"></iconify-icon>',
      message: allKb.length ? 'Sin resultados con ese filtro.' : 'Aún no hay artículos. Crea el primero o conviértelo desde un ticket resuelto.',
      ctaText: allKb.length ? '' : '<iconify-icon icon="tabler:plus"></iconify-icon> Crear primer artículo',
      ctaFn: allKb.length ? null : () => showKbForm(),
    });
    return;
  }
  grid.innerHTML = items.map(a => {
    const preview = (a.contenido || '').slice(0, 160) + (a.contenido && a.contenido.length > 160 ? '…' : '');
    const fecha = a.fecha ? new Date(a.fecha).toLocaleDateString('es-MX', { year:'numeric', month:'short', day:'numeric' }) : '';
    const tagsHtml = (a.tags || []).slice(0, 4).map(t =>
      '<span style="font-size:10px;padding:2px 8px;border-radius:12px;background:var(--hero-primary-light);color:var(--hero-primary-text);">' + escHtml(t) + '</span>'
    ).join(' ');
    return '<div class="action-card" style="cursor:pointer;" onclick="openKbArticle(\'' + escJs(a.id) + '\')">'
      + '<div style="font-size:14px;font-weight:700;color:var(--hero-text-primary);margin-bottom:6px;">' + escHtml(a.titulo) + '</div>'
      + (tagsHtml ? '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">' + tagsHtml + '</div>' : '')
      + '<div style="font-size:12px;color:var(--hero-text-body);line-height:1.5;margin-bottom:10px;white-space:pre-wrap;">' + escHtml(preview) + '</div>'
      + '<div style="font-size:10px;color:var(--hero-text-muted);font-family:var(--mono);">' + (fecha ? '<iconify-icon icon="tabler:calendar"></iconify-icon> ' + fecha : '') + (a.ticketOrigen ? ' · <iconify-icon icon="tabler:ticket"></iconify-icon> ' + escHtml(a.ticketOrigen) : '') + '</div>'
      + '</div>';
  }).join('');
}

function openKbArticle(id) {
  const a = allKb.find(x => x.id === id);
  if (!a) return;
  showKbForm(a);
}

function showKbForm(articulo) {
  editingKbId = articulo ? articulo.id : null;
  document.getElementById('kb-modal-title').textContent = articulo ? 'Editar artículo' : 'Nuevo artículo';
  document.getElementById('kb-f-titulo').value    = articulo ? articulo.titulo    : '';
  document.getElementById('kb-f-contenido').value = articulo ? articulo.contenido : '';
  document.getElementById('kb-f-tags').value      = articulo ? (articulo.tags || []).join(', ') : '';
  document.getElementById('btn-kb-del').style.display = articulo ? 'inline-block' : 'none';
  const origenEl = document.getElementById('kb-f-origen');
  if (articulo && articulo.ticketOrigen) {
    origenEl.style.display = 'block';
    origenEl.textContent = 'Generado desde ticket ' + articulo.ticketOrigen;
  } else if (_kbOrigenTicket) {
    origenEl.style.display = 'block';
    origenEl.textContent = 'Se vinculará al ticket ' + _kbOrigenTicket;
  } else {
    origenEl.style.display = 'none';
  }
  document.getElementById('kb-modal').style.display = 'block';
}

function closeKbModal() {
  document.getElementById('kb-modal').style.display = 'none';
  editingKbId = null;
  _kbOrigenTicket = null;
}

async function saveKb() {
  const titulo    = document.getElementById('kb-f-titulo').value.trim();
  const contenido = document.getElementById('kb-f-contenido').value.trim();
  const tags      = document.getElementById('kb-f-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  if (!titulo) { showToast('Falta el título'); return; }
  if (!contenido) { showToast('Falta el contenido'); return; }
  const btn = document.getElementById('btn-kb-save');
  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Guardando...';
  try {
    if (editingKbId) {
      const r = await authFetch(WORKER_URL + '/kb/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingKbId, titulo, contenido, tags }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Error');
      // Actualizamos en memoria con el artículo que devolvió el server.
      // Evita el re-fetch que pegaba contra cache_kb_list (KV list es
      // eventually consistent: el PUT recién hecho puede no aparecer
      // todavía y la lista vacía/parcial quedaba cacheada 60s).
      if (d.articulo) {
        const idx = allKb.findIndex(x => x.id === editingKbId);
        if (idx >= 0) allKb[idx] = d.articulo;
      }
      showToast('Artículo actualizado');
      auditLog('kb', 'KB actualizado: ' + titulo);
    } else {
      const r = await authFetch(WORKER_URL + '/kb', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo, contenido, tags, ticketOrigen: _kbOrigenTicket || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Error');
      if (d.articulo) allKb.unshift(d.articulo);
      showToast('Artículo creado');
      auditLog('kb', 'KB creado: ' + titulo, _kbOrigenTicket ? 'desde ' + _kbOrigenTicket : null);
    }
    closeKbModal();
    filterKb();
  } catch (e) {
    showToast('Error: ' + e.message);
  }
  btn.disabled = false;
  btn.innerHTML = '<iconify-icon icon="tabler:device-floppy"></iconify-icon> Guardar artículo';
}

async function deleteKbCurrent() {
  if (!editingKbId) return;
  const a = allKb.find(x => x.id === editingKbId);
  if (!(await heroConfirm({
    title: '¿Eliminar artículo?',
    body: 'Vas a eliminar "' + (a ? a.titulo : 'este artículo') + '". Esta acción no se puede deshacer.',
    confirmText: 'Eliminar', destructive: true,
  }))) return;
  try {
    const r = await authFetch(WORKER_URL + '/kb/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editingKbId }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Error');
    showToast('Artículo eliminado');
    auditLog('kb', 'KB eliminado: ' + (a ? a.titulo : editingKbId));
    const removedId = editingKbId;
    closeKbModal();
    allKb = allKb.filter(x => x.id !== removedId);
    filterKb();
  } catch (e) { showToast('Error: ' + e.message); }
}

// Botón "Guardar como artículo KB" del modal de ticket → pre-llena el form
// con asunto + descripción + respuesta del ticket actual. Util para capturar
// la solución de un caso recurrente sin re-escribirla.
function guardarComoKb() {
  if (!currentTicketId) return;
  const t = allTickets.find(x => x.id === currentTicketId);
  if (!t) return;
  const respuesta = (document.getElementById('modal-respuesta').value || '').trim();
  const contenidoSugerido =
      'PROBLEMA\n' + (t.descripcion || '') + '\n\n'
    + 'CATEGORÍA: ' + (t.categoria || '—') + '\n'
    + 'PRIORIDAD: ' + (t.prioridad || '—') + '\n\n'
    + 'SOLUCIÓN\n' + (respuesta || '(escribe la solución aquí)');
  _kbOrigenTicket = t.ticketId || t.id;
  // Cerrar modal de ticket primero — heroConfirm/KB modal abre encima
  closeTicketModal();
  // Pre-llenar el form de KB con datos del ticket
  showKbForm();
  document.getElementById('kb-f-titulo').value = (t.asunto || '').slice(0, 120);
  document.getElementById('kb-f-contenido').value = contenidoSugerido;
  document.getElementById('kb-f-tags').value = (t.categoria || '').toLowerCase();
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
    grid.innerHTML = '<div class="info-box" style="text-align:center;padding:40px;grid-column:1/-1;"><div style="font-size:32px;opacity:0.3;margin-bottom:12px;"><iconify-icon icon="tabler:license"></iconify-icon></div><div style="font-family:var(--mono);font-size:12px;color:var(--hero-text-muted);">Sin licencias registradas. Agrega la primera con el botón Nueva licencia.</div></div>';
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
      + (l.costo > 0 ? '<span><iconify-icon icon="tabler:cash"></iconify-icon> $' + Number(l.costo).toFixed(2) + '/mes</span>' : '')
      + (l.usuarios > 0 ? '<span><iconify-icon icon="tabler:user"></iconify-icon> ' + l.usuarios + ' usuarios</span>' : '')
      + '</div>'
      + (expiryBadge ? '<div style="margin-bottom:10px;">' + expiryBadge + '</div>' : '')
      + (l.notas ? '<div style="font-size:11px;color:var(--hero-text-muted);margin-bottom:12px;">' + escHtml(l.notas) + '</div>' : '')
      + ((l.credUsuario || l.credPassword || l.codigoLicencia)
        ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">'
          + (l.credUsuario || l.credPassword ? '<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(6,163,182,0.08);color:var(--hero-primary);"><iconify-icon icon="tabler:lock"></iconify-icon> Credenciales</span>' : '')
          + (l.codigoLicencia ? '<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(6,163,182,0.08);color:var(--hero-primary);"><iconify-icon icon="tabler:key"></iconify-icon> Código</span>' : '')
          + '</div>'
        : '')
      + '<div style="display:flex;gap:8px;">'
      + '<button onclick="editLicencia(\'' + escJs(l.id) + '\')" class="btn btn-secondary" style="flex:1;font-size:12px;"><iconify-icon icon="tabler:pencil"></iconify-icon> Editar</button>'
      + ((l.credUsuario || l.credPassword || l.codigoLicencia)
        ? '<button onclick="verCredenciales(\'' + escJs(l.id) + '\')" class="btn btn-secondary" style="font-size:12px;padding:8px 12px;" title="Ver credenciales"><iconify-icon icon="tabler:lock"></iconify-icon></button>'
        : '')
      + '<button onclick="deleteLicencia(\'' + escJs(l.id) + '\',\'' + escJs(l.nombre) + '\')" class="btn btn-danger" style="font-size:12px;padding:8px 10px;"><iconify-icon icon="tabler:trash"></iconify-icon></button>'
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
  if (input.type === 'password') { input.type = 'text';     btn.innerHTML = '<iconify-icon icon="tabler:eye-off"></iconify-icon>'; }
  else                           { input.type = 'password'; btn.innerHTML = '<iconify-icon icon="tabler:eye"></iconify-icon>';  }
}

function verCredenciales(id) {
  const l = allLicencias.find(x => x.id === id);
  if (!l) return;

  const rows = [
    l.credUsuario    ? ['<iconify-icon icon="tabler:user"></iconify-icon> Usuario',          l.credUsuario,    false] : null,
    l.credPassword   ? ['<iconify-icon icon="tabler:key"></iconify-icon> Contraseña',        l.credPassword,   true]  : null,
    l.codigoLicencia ? ['<iconify-icon icon="tabler:lock-square"></iconify-icon> Código de licencia', l.codigoLicencia, false] : null,
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
        ? '<button data-val="' + safeAttr + '" onclick="toggleCredVal(this)" style="background:transparent;border:1px solid var(--hero-border);border-radius:6px;padding:6px 10px;cursor:pointer;font-size:14px;color:var(--hero-text-muted);"><iconify-icon icon="tabler:eye"></iconify-icon></button>'
        : '')
      + '<button data-val="' + safeAttr + '" onclick="navigator.clipboard.writeText(this.dataset.val);showToast(\'Copiado\')" style="background:transparent;border:1px solid var(--hero-border);border-radius:6px;padding:6px 10px;cursor:pointer;font-size:14px;color:var(--hero-text-muted);"><iconify-icon icon="tabler:copy"></iconify-icon></button>'
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
      + '<button onclick="document.getElementById(\'cred-view-modal\').style.display=\'none\'" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:30px;height:30px;border-radius:6px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;"><iconify-icon icon="tabler:x"></iconify-icon></button>'
      + '</div>'
      + '<div id="cred-modal-body" style="padding:20px 24px;"></div>'
      + '<div style="padding:0 24px 20px;display:flex;gap:8px;">'
      + '<button onclick="copyAllCreds()" class="btn btn-primary" style="flex:1;font-size:12px;"><iconify-icon icon="tabler:copy"></iconify-icon> Copiar todo</button>'
      + '<button onclick="document.getElementById(\'cred-view-modal\').style.display=\'none\'" class="btn btn-secondary" style="font-size:12px;">Cerrar</button>'
      + '</div></div>';
    document.body.appendChild(modal);
  }

  modal._licId = id;
  document.getElementById('cred-modal-title').innerHTML = '<iconify-icon icon="tabler:lock"></iconify-icon> ' + escHtml(l.nombre);
  document.getElementById('cred-modal-body').innerHTML = rowsHtml;
  modal.style.display = 'block';
}

function toggleCredVal(btn) {
  const code = btn.previousElementSibling;
  const val  = btn.dataset.val;
  if (code.textContent === '••••••••') {
    code.textContent = val;
    btn.innerHTML    = '<iconify-icon icon="tabler:eye-off"></iconify-icon>';
  } else {
    code.textContent = '••••••••';
    btn.innerHTML    = '<iconify-icon icon="tabler:eye"></iconify-icon>';
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
  showToast('Credenciales copiadas');
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
  btn.disabled = true; btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring>';
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
  btn.disabled = false; btn.innerHTML = '<iconify-icon icon="tabler:device-floppy"></iconify-icon> Guardar';
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
// Genera un CSV con todas las secciones operativas del mes seleccionado:
// resumen ejecutivo + tickets + solicitudes + intervenciones + auditoría +
// licencias activas + KB. Si una sección falla (Worker/red), el resto sigue.
async function generateMonthlyReport() {
  const monthInput = document.getElementById('report-month').value;
  if (!monthInput) { showToast('Selecciona un mes primero'); return; }

  const [year, month] = monthInput.split('-').map(Number);
  const label = new Date(year, month - 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('es-MX', { timeZone: 'America/New_York', year:'numeric', month:'short', day:'numeric' }) : '';
  const fmtDateTime = ts => ts ? new Date(ts).toLocaleString('es-MX', { timeZone: 'America/New_York' }) : '';
  const inMonth = ts => {
    if (!ts) return false;
    const d = new Date(ts);
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  };

  showToast('Generando reporte de ' + label + '...');

  // Buffer para resumen ejecutivo: lo armamos al final con counts reales
  // pero lo concatenamos al inicio del CSV final.
  const summary = {};
  let sections = '';

  // ── Tickets ──────────────────────────────────────────────────
  try {
    const tResp = await authFetch(WORKER_URL + '/ticket');
    if (tResp.ok) {
      const tData = await tResp.json();
      const tickets = (tData.tickets || []).filter(t => inMonth(t.fecha));
      const resueltos = tickets.filter(t => t.estado === 'resuelto').length;
      summary.tickets = { total: tickets.length, resueltos };

      sections += csvRow(['TICKETS DE SOPORTE']);
      sections += csvRow(['ID', 'Asunto', 'Usuario', 'Email', 'Categoría', 'Prioridad', 'Estado', 'Fecha creación', 'Fecha respuesta']);
      tickets.forEach(t => {
        sections += csvRow([
          t.ticketId || t.id || '',
          t.asunto || '',
          t.nombre || '',
          t.email || '',
          t.categoria || '',
          t.prioridad || '',
          t.estado || '',
          fmtDate(t.fecha),
          fmtDate(t.fechaRespuesta),
        ]);
      });
      sections += csvRow(['Total tickets', tickets.length]);
      sections += csvRow(['Resueltos', resueltos]);

      // Breakdown por categoría
      const porCat = {};
      tickets.forEach(t => { porCat[t.categoria || '(sin categoría)'] = (porCat[t.categoria || '(sin categoría)'] || 0) + 1; });
      Object.keys(porCat).sort().forEach(k => sections += csvRow(['  por categoría · ' + k, porCat[k]]));

      // Breakdown por prioridad
      const porPri = {};
      tickets.forEach(t => { porPri[t.prioridad || 'Media'] = (porPri[t.prioridad || 'Media'] || 0) + 1; });
      ['Urgente', 'Alta', 'Media', 'Baja'].forEach(k => { if (porPri[k]) sections += csvRow(['  por prioridad · ' + k, porPri[k]]); });
      sections += csvRow([]);
    }
  } catch (e) {
    sections += csvRow(['TICKETS DE SOPORTE — error al cargar']);
    sections += csvRow([]);
  }

  // ── Solicitudes (altas/bajas) ────────────────────────────────
  try {
    const sResp = await authFetch(WORKER_URL + '/alta-agente');
    if (sResp.ok) {
      const sData = await sResp.json();
      const sols = (sData.solicitudes || []).filter(s => inMonth(s.fecha));
      const altas = sols.filter(s => (s.tipoSolicitud || 'alta') === 'alta').length;
      const bajas = sols.filter(s => s.tipoSolicitud === 'baja').length;
      const procesadas = sols.filter(s => s.estado === 'procesada').length;
      summary.solicitudes = { total: sols.length, altas, bajas, procesadas };

      sections += csvRow(['SOLICITUDES DE CUENTA (ALTAS / BAJAS)']);
      sections += csvRow(['Tipo', 'Persona', 'Correo', 'Solicitante', 'Estado', 'Fecha solicitud', 'Autorizada por', 'Fecha autorización']);
      sols.forEach(s => {
        const tipo = (s.tipoSolicitud === 'baja' ? 'BAJA' : 'ALTA') + ' / ' + (s.tipoPersona === 'empleado' ? 'empleado' : 'agente');
        const persona = s.tipoSolicitud === 'baja'
          ? (s.nombre || '')
          : ((s.nombre || '') + ' ' + (s.apellido || '')).trim();
        const correo = s.tipoSolicitud === 'baja' ? (s.correoEliminar || '') : (s.correoPersonal || s.correo || '');
        sections += csvRow([
          tipo,
          persona,
          correo,
          s.solicitanteNombre || '',
          s.estado || 'pendiente',
          fmtDate(s.fecha),
          s.autorizadaPor || '',
          fmtDate(s.autorizadaFecha),
        ]);
      });
      sections += csvRow(['Total solicitudes', sols.length]);
      sections += csvRow(['  Altas', altas]);
      sections += csvRow(['  Bajas', bajas]);
      sections += csvRow(['  Procesadas', procesadas]);
      sections += csvRow([]);
    }
  } catch (e) {
    sections += csvRow(['SOLICITUDES — error al cargar']);
    sections += csvRow([]);
  }

  // ── Intervenciones de dispositivos ───────────────────────────
  try {
    const dResp = await authFetch(WORKER_URL + '/device?withZoho=1');
    if (dResp.ok) {
      const dData = await dResp.json();
      const devices = dData.devices || [];
      const intervencionesMes = [];
      devices.forEach(dev => {
        (dev.intervenciones || []).forEach(i => {
          if (inMonth(i.fecha)) {
            intervencionesMes.push({ dispositivo: dev.nombre, usuario: dev.usuario || '', ...i });
          }
        });
      });
      summary.intervenciones = { total: intervencionesMes.length, devicesActivos: devices.filter(d => d.estado === 'activo').length };

      sections += csvRow(['INTERVENCIONES DE DISPOSITIVOS']);
      sections += csvRow(['Dispositivo', 'Usuario', 'Tipo', 'Descripción', 'Notas', 'Fecha']);
      intervencionesMes.forEach(i => {
        sections += csvRow([i.dispositivo, i.usuario, i.tipo, i.descripcion, i.notas || '', fmtDateTime(i.fecha)]);
      });
      sections += csvRow(['Total intervenciones', intervencionesMes.length]);

      // Por tipo
      const porTipo = {};
      intervencionesMes.forEach(i => { porTipo[i.tipo || '(sin tipo)'] = (porTipo[i.tipo || '(sin tipo)'] || 0) + 1; });
      Object.keys(porTipo).sort().forEach(k => sections += csvRow(['  ' + k, porTipo[k]]));
      sections += csvRow([]);
    }
  } catch (e) {
    sections += csvRow(['INTERVENCIONES — error al cargar']);
    sections += csvRow([]);
  }

  // ── Auditoría ────────────────────────────────────────────────
  try {
    const aResp = await authFetch(WORKER_URL + '/audit?limit=1000');
    if (aResp.ok) {
      const aData = await aResp.json();
      const entradas = (aData.entradas || []).filter(e => inMonth(e.fecha));
      summary.audit = { total: entradas.length };

      sections += csvRow(['AUDITORÍA DE ACCIONES']);
      sections += csvRow(['Fecha ET', 'Tipo', 'Descripción', 'Detalle', 'Usuario']);
      entradas.forEach(e => {
        sections += csvRow([fmtDateTime(e.fecha), e.tipo, e.descripcion, e.detalle || '', e.usuario || '']);
      });
      sections += csvRow(['Total acciones', entradas.length]);

      const porTipo = {};
      entradas.forEach(e => { porTipo[e.tipo || '(sin tipo)'] = (porTipo[e.tipo || '(sin tipo)'] || 0) + 1; });
      Object.keys(porTipo).sort().forEach(k => sections += csvRow(['  ' + k, porTipo[k]]));
      sections += csvRow([]);
    }
  } catch (e) {
    sections += csvRow(['AUDITORÍA — error al cargar']);
    sections += csvRow([]);
  }

  // ── Licencias activas + próximas a vencer ────────────────────
  try {
    const lResp = await authFetch(WORKER_URL + '/licencia');
    if (lResp.ok) {
      const lData = await lResp.json();
      const lics = lData.licencias || [];
      const proximas = lics.filter(l => {
        if (!l.vencimiento) return false;
        const v = new Date(l.vencimiento);
        // Vence dentro del mes o anteriores
        const endOfMonth = new Date(year, month, 0);
        return v <= endOfMonth;
      });
      const costoMensual = lics
        .filter(l => l.estado === 'activa' && Number(l.costo) > 0)
        .reduce((acc, l) => {
          const c = Number(l.costo) || 0;
          if (l.tipoSub === 'anual') return acc + c / 12;
          if (l.tipoSub === 'único' || l.tipoSub === 'gratis') return acc;
          return acc + c;
        }, 0);
      summary.licencias = { total: lics.length, proximas: proximas.length, costoMensual };

      sections += csvRow(['LICENCIAS Y SOFTWARE']);
      sections += csvRow(['Nombre', 'Plan', 'Tipo suscripción', 'Costo', 'Usuarios', 'Vencimiento', 'Estado']);
      lics.forEach(l => {
        sections += csvRow([
          l.nombre || '',
          l.plan || '',
          l.tipoSub || '',
          l.costo != null ? '$' + Number(l.costo).toFixed(2) : '',
          l.usuarios || 0,
          fmtDate(l.vencimiento),
          l.estado || '',
        ]);
      });
      sections += csvRow(['Total licencias', lics.length]);
      sections += csvRow(['Costo mensual estimado (activas)', '$' + costoMensual.toFixed(2)]);
      if (proximas.length) {
        sections += csvRow(['Licencias vencidas o por vencer hasta fin del mes', proximas.length]);
      }
      sections += csvRow([]);
    }
  } catch (e) {
    sections += csvRow(['LICENCIAS — error al cargar']);
    sections += csvRow([]);
  }

  // ── Knowledge Base (artículos creados en el mes) ─────────────
  try {
    const kResp = await authFetch(WORKER_URL + '/kb');
    if (kResp.ok) {
      const kData = await kResp.json();
      const articulos = (kData.articulos || []).filter(a => inMonth(a.fecha));
      summary.kb = { total: articulos.length };

      sections += csvRow(['KNOWLEDGE BASE — artículos creados en el mes']);
      sections += csvRow(['Título', 'Tags', 'Ticket origen', 'Fecha creación']);
      articulos.forEach(a => {
        sections += csvRow([
          a.titulo || '',
          (a.tags || []).join(', '),
          a.ticketOrigen || '',
          fmtDate(a.fecha),
        ]);
      });
      sections += csvRow(['Total artículos nuevos', articulos.length]);
      sections += csvRow([]);
    }
  } catch (e) {
    sections += csvRow(['KB — error al cargar']);
    sections += csvRow([]);
  }

  // ── Header + resumen ejecutivo ───────────────────────────────
  let header = csvRow(['REPORTE MENSUAL IT — HERO INSURANCE USA']);
  header += csvRow(['Mes', label.toUpperCase()]);
  header += csvRow(['Generado', fmtDateTime(Date.now()) + ' ET']);
  header += csvRow([]);
  header += csvRow(['RESUMEN EJECUTIVO']);
  if (summary.tickets)      header += csvRow(['Tickets de soporte', summary.tickets.total + ' (' + summary.tickets.resueltos + ' resueltos)']);
  if (summary.solicitudes)  header += csvRow(['Solicitudes', summary.solicitudes.total + ' (' + summary.solicitudes.altas + ' altas, ' + summary.solicitudes.bajas + ' bajas, ' + summary.solicitudes.procesadas + ' procesadas)']);
  if (summary.intervenciones) header += csvRow(['Intervenciones de dispositivos', summary.intervenciones.total]);
  if (summary.audit)        header += csvRow(['Acciones auditadas', summary.audit.total]);
  if (summary.licencias)    header += csvRow(['Licencias registradas', summary.licencias.total + ' · costo mensual ~$' + summary.licencias.costoMensual.toFixed(2)]);
  if (summary.kb)           header += csvRow(['Artículos KB nuevos', summary.kb.total]);
  header += csvRow([]);

  const csv = header + sections;

  downloadCsv(csv, 'reporte-IT-' + monthInput + '.csv');
  showToast('Reporte de ' + label + ' generado');
  auditLog('reporte', 'Reporte mensual generado: ' + label,
    'Tickets: ' + (summary.tickets?.total || 0)
    + ' · Solicitudes: ' + (summary.solicitudes?.total || 0)
    + ' · Intervenciones: ' + (summary.intervenciones?.total || 0));
}

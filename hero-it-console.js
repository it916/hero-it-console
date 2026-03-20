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
  appEl.style.overflow = 'hidden';
  appEl.style.flexDirection = 'row';
  // Update sidebar user label
  const userLabel = document.querySelector('.user-label');
  if (userLabel) userLabel.textContent = nombre + ' · IT Admin';
  addLog('Sesión iniciada como ' + nombre, 'success');
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

// ── Auditoría persistente ─────────────────────────────────────
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

// ── Reset Password ────────────────────────────────────────────
async function sendReset() {
  const data = validateForm('rst');
  if (!data) return;
  if (!checkApiKey()) return;

  const password = document.getElementById('rst-password').value.trim();
  const btn = document.getElementById('btn-send-rst');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Enviando...';
  addLog('Iniciando Reset Password para ' + data.nombre, 'warn', 'log-rst');

  try {
    await sendViaResend({
      to: data.pers,
      subject: 'Restablecimiento de Contrasena - Hero Insurance USA',
      html: buildEmailReset(data.nombre, data.email, password),
      text: 'Hola ' + data.nombre + ', tu contrasena ha sido restablecida. Correo: ' + data.email + ' / Nueva contrasena: ' + password
    });
    addLog('Reset enviado a ' + data.nombre + ' -> ' + data.pers, 'success', 'log-rst');
    auditLog('reset', 'Reset de contraseña enviado a ' + data.nombre, data.email + ' → ' + data.pers);
    showToast('Reset enviado a ' + data.nombre);
    clearForm('rst');
  } catch (err) {
    addLog('Error: ' + err.message, 'error', 'log-rst');
    showToast('Error al enviar reset. Revisa el log.');
  }
  btn.disabled = false;
  btn.innerHTML = 'Enviar reset de contrasena';
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
      document.getElementById('global-status').style.color = 'var(--green)';
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
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const special = '!@#*';
  let pwd = '';
  for (let i = 0; i < 10; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  pwd += special[Math.floor(Math.random() * special.length)];
  pwd += Math.floor(Math.random() * 90 + 10);
  document.getElementById('um-new-password').value = pwd;
}

async function userAction(action) {
  if (!currentUserEmail) return;
  const email = currentUserEmail;
  const nombre = document.getElementById('um-nombre').textContent;

  const labels = { reset: 'resetear contraseña', suspend: 'suspender', restore: 'restaurar' };
  const newPassword = action === 'reset' ? document.getElementById('um-new-password').value.trim() : null;

  if (action === 'reset' && !newPassword) {
    showToast('Ingresa una contraseña temporal primero'); return;
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
  email:   'var(--cyan)',
  reset:   'var(--amber)',
  usuario: 'var(--purple)',
  ticket:  'var(--green)',
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
  } catch(err) {
    document.getElementById('audit-body').innerHTML =
      '<div style="text-align:center;padding:32px;color:var(--red);font-family:var(--mono);font-size:12px;">Error: ' + err.message + '</div>';
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
    const color = AUDIT_TIPO_COLOR[e.tipo] || 'var(--text2)';
    const icon  = AUDIT_TIPO_ICON[e.tipo] || '●';
    return '<div style="display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border);">'
      + '<span style="font-size:14px;flex-shrink:0;margin-top:2px;">' + icon + '</span>'
      + '<div style="flex:1;min-width:0;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">'
      + '<span style="font-size:13px;color:var(--text);font-weight:500;">' + e.descripcion + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;color:var(--text3);flex-shrink:0;">' + fecha + ' ET</span>'
      + '</div>'
      + (e.detalle ? '<div style="font-family:var(--mono);font-size:11px;color:var(--text3);margin-top:3px;">' + e.detalle + '</div>' : '')
      + '<span style="font-family:var(--mono);font-size:10px;padding:1px 7px;border-radius:10px;background:rgba(0,0,0,0.2);color:' + color + ';margin-top:4px;display:inline-block;">' + e.tipo + '</span>'
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

const PRIORIDAD_COLOR = { Baja:'var(--green)', Media:'var(--amber)', Alta:'#f97316', Urgente:'var(--red)' };
const ESTADO_COLOR    = { 'abierto':'var(--red)', 'en progreso':'var(--amber)', 'resuelto':'var(--green)' };

async function loadTickets() {
  const btn = document.getElementById('btn-load-tickets');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Cargando...';
  try {
    const resp = await fetch(WORKER_URL + '/ticket');
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    allTickets = data.tickets || [];
    filterTickets();
    addLog('Tickets cargados: ' + allTickets.length, 'info');
  } catch(err) {
    document.getElementById('tickets-list').innerHTML =
      '<div class="info-box" style="text-align:center;padding:32px;border-color:rgba(245,101,101,0.3);"><div style="color:var(--red);font-family:var(--mono);font-size:12px;">Error: ' + err.message + '</div></div>';
  }
  btn.disabled = false;
  btn.innerHTML = '↺ Actualizar';
}

function filterTickets() {
  const estado    = document.getElementById('ticket-filter-estado').value;
  const prioridad = document.getElementById('ticket-filter-prioridad').value;
  let filtered = allTickets;
  if (estado)    filtered = filtered.filter(t => t.estado === estado);
  if (prioridad) filtered = filtered.filter(t => t.prioridad === prioridad);
  renderTickets(filtered);
}

function renderTickets(tickets) {
  document.getElementById('tickets-count').textContent = tickets.length + ' ticket' + (tickets.length !== 1 ? 's' : '');
  const container = document.getElementById('tickets-list');
  if (!tickets.length) {
    container.innerHTML = '<div class="info-box" style="text-align:center;padding:40px;"><div style="font-size:32px;opacity:0.3;margin-bottom:12px;">📭</div><div style="font-family:var(--mono);font-size:12px;color:var(--text3);">Sin tickets con estos filtros</div></div>';
    return;
  }
  container.innerHTML = tickets.map(t => {
    const fecha = new Date(t.fecha).toLocaleString('es-MX', { timeZone:'America/New_York', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    const pColor = PRIORIDAD_COLOR[t.prioridad] || 'var(--text2)';
    const eColor = ESTADO_COLOR[t.estado] || 'var(--text2)';
    const cardColor = t.estado === 'abierto' ? 'var(--red)' : t.estado === 'en progreso' ? 'var(--amber)' : 'var(--green)';
    return '<div class="action-card" style="margin-bottom:10px;cursor:pointer;--card-color:' + cardColor + ';" onclick="openTicketModal(\'' + t.id + '\')">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      + '<span style="font-family:var(--mono);font-size:11px;color:var(--cyan);">' + t.ticketId + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(0,0,0,0.2);color:' + pColor + ';">● ' + t.prioridad + '</span>'
      + '</div>'
      + '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(0,0,0,0.2);color:' + eColor + ';">' + t.estado + '</span>'
      + '</div>'
      + '<div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px;">' + t.asunto + '</div>'
      + '<div style="font-size:12px;color:var(--text2);margin-bottom:10px;">' + t.nombre + ' · ' + t.categoria + '</div>'
      + '<div style="display:flex;justify-content:space-between;align-items:center;">'
      + '<span style="font-size:12px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80%;">' + t.descripcion.substring(0,80) + (t.descripcion.length > 80 ? '...' : '') + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;color:var(--text3);flex-shrink:0;margin-left:8px;">' + fecha + ' ET</span>'
      + '</div>'
      + '</div>';
  }).join('');
}

function openTicketModal(id) {
  const t = allTickets.find(x => x.id === id);
  if (!t) return;
  currentTicketId = id;
  document.getElementById('modal-ticket-id').textContent = t.ticketId;
  document.getElementById('modal-asunto').textContent = t.asunto;
  document.getElementById('modal-nombre').textContent = t.nombre;
  document.getElementById('modal-email').textContent = t.email;
  document.getElementById('modal-categoria').textContent = t.categoria;
  const fecha = new Date(t.fecha).toLocaleString('es-MX', { timeZone:'America/New_York', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
  document.getElementById('modal-fecha').textContent = fecha + ' ET';
  document.getElementById('modal-descripcion').textContent = t.descripcion;
  document.getElementById('modal-estado').value = t.estado;
  document.getElementById('modal-prioridad').value = t.prioridad;
  document.getElementById('modal-respuesta').value = t.respuesta || '';
  document.getElementById('ticket-modal').style.display = 'block';
}

function closeTicketModal() {
  document.getElementById('ticket-modal').style.display = 'none';
  currentTicketId = null;
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
    addLog('Ticket actualizado: ' + currentTicketId, 'success');
    const t = allTickets.find(x => x.id === currentTicketId);
    auditLog('ticket', 'Ticket ' + (t ? t.ticketId : '') + ' actualizado — estado: ' + document.getElementById('modal-estado').value, respuesta ? 'Respuesta enviada a ' + (t ? t.email : '') : null);
    showToast(respuesta ? 'Respuesta enviada al usuario' : 'Ticket actualizado');
    closeTicketModal();
    loadTickets();
  } catch(err) {
    addLog('Error: ' + err.message, 'error');
    showToast('Error al guardar: ' + err.message);
  }
  btn.disabled = false;
  btn.innerHTML = '💾 Guardar y enviar respuesta';
}

// ── Módulo Solicitudes de Alta ────────────────────────────────
async function loadSolicitudes() {
  const btn = document.getElementById('btn-load-sol');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Cargando...';

  try {
    const resp = await fetch(WORKER_URL + '/alta-agente');
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error del Worker');

    const solicitudes = data.solicitudes || [];
    document.getElementById('sol-count').textContent =
      solicitudes.length + ' solicitud' + (solicitudes.length !== 1 ? 'es' : '');

    const container = document.getElementById('sol-list');

    if (!solicitudes.length) {
      container.innerHTML = '<div class="info-box" style="text-align:center;padding:40px;">' +
        '<div style="font-size:32px;opacity:0.3;margin-bottom:12px;">📭</div>' +
        '<div style="font-family:var(--mono);font-size:12px;color:var(--text3);">Sin solicitudes pendientes</div></div>';
      return;
    }

    container.innerHTML = solicitudes.map(s => {
      const fecha = new Date(s.fecha).toLocaleString('es-MX', {
        timeZone: 'America/New_York', year:'numeric', month:'short',
        day:'numeric', hour:'2-digit', minute:'2-digit'
      });
      const estadoColor = s.estado === 'pendiente' ? 'var(--amber)' : 'var(--green)';
      const estadoBg    = s.estado === 'pendiente' ? 'rgba(240,180,41,0.1)' : 'rgba(34,216,122,0.1)';

      return '<div class="action-card" style="margin-bottom:12px; --card-color:' +
        (s.estado === 'pendiente' ? 'var(--amber)' : 'var(--green)') + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">' +
          '<div>' +
            '<div style="font-size:14px;font-weight:600;color:var(--text);">' + s.nombre + ' ' + s.apellido + '</div>' +
            '<div style="font-family:var(--mono);font-size:11px;color:var(--cyan);margin-top:2px;">' + s.correo + '</div>' +
          '</div>' +
          '<span style="font-family:var(--mono);font-size:10px;padding:3px 10px;border-radius:20px;background:' + estadoBg + ';color:' + estadoColor + ';">' + s.estado + '</span>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text2);margin-bottom:8px;">' +
          '<span style="color:var(--text3);">Solicitado por: </span>' +
          '<strong style="color:var(--text);">' + (s.solicitanteNombre || 'No especificado') + '</strong>' +
          (s.solicitanteEmail ? ' &nbsp;<span style="font-family:var(--mono);font-size:11px;color:var(--cyan);">(' + s.solicitanteEmail + ')</span>' : '') +
        '</div>' +
        '<div style="display:flex;gap:16px;font-size:12px;color:var(--text2);margin-bottom:14px;">' +
          '<span>📞 ' + s.telefono + '</span>' +
          '<span>🕐 ' + fecha + ' ET</span>' +
        '</div>' +
        (s.estado === 'pendiente' ?
          '<div style="display:flex;gap:8px;">' +
            '<button class="btn btn-primary" onclick="procesarAlta(\'' + s.id + '\',\'' + s.nombre + '\',\'' + s.apellido + '\',\'' + s.correo + '\',\'' + (s.solicitanteEmail||'') + '\',\'' + (s.solicitanteNombre||'') + '\')" style="font-size:12px;">➕ Crear usuario</button>' +
            '<button class="btn btn-secondary" onclick="resolverSolicitud(\'' + s.id + '\', \'procesada\')" style="font-size:12px;">✓ Marcar procesada</button>' +
          '</div>'
        : '') +
      '</div>';
    }).join('');

  } catch (err) {
    document.getElementById('sol-list').innerHTML =
      '<div class="info-box" style="text-align:center;padding:32px;border-color:rgba(245,101,101,0.3);">' +
      '<div style="color:var(--red);font-family:var(--mono);font-size:12px;">Error: ' + err.message + '</div></div>';
  }

  btn.disabled = false;
  btn.innerHTML = '↺ Actualizar';
}

async function resolverSolicitud(id, estado) {
  try {
    await fetch(WORKER_URL + '/alta-agente/resolver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estado })
    });
    showToast('Solicitud marcada como ' + estado);
    loadSolicitudes();
  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

function procesarAlta(id, nombre, apellido, correo, solicitanteEmail, solicitanteNombre) {
  // Pre-llenar el formulario de Crear Usuario con los datos de la solicitud
  showPage('crear-usuario');
  document.getElementById('new-nombre').value = nombre;
  document.getElementById('new-apellido').value = apellido;
  document.getElementById('new-email-personal').value = correo;
  // Sugerir email corporativo
  const sugerido = (nombre.charAt(0) + apellido).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s/g,'');
  document.getElementById('new-email-user').value = sugerido;
  previewEmail();
  showToast('Datos cargados desde solicitud de alta');
  // Guardar datos para usar al crear el usuario
  window._altaId = id;
  window._altaSolicitanteEmail = solicitanteEmail || null;
  window._altaSolicitanteNombre = solicitanteNombre || null;
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
      '<span style="color:var(--text2)">Email: </span><span style="color:var(--cyan)">' + (user || '...') + atSign + 'heroinsuranceusa.com</span><br>' +
      '<span style="color:var(--text2)">Nombre: </span><span style="color:var(--text)">' + (nombre || '—') + ' ' + (apellido || '') + '</span>';
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
      '<span style="color:var(--green); font-family:var(--mono); font-size:12px;">Usuario creado correctamente</span><br>' +
      '<span style="font-family:var(--mono); font-size:11px; color:var(--text2);">' + emailCorp + '</span>';

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
    addLog('Usuarios cargados: ' + allUsers.length, 'success');
    renderUsers(allUsers);

  } catch (err) {
    addLog('Error al cargar usuarios: ' + err.message, 'error');
    showToast('Error al cargar usuarios');
    document.getElementById('usr-tbody').innerHTML =
      '<tr><td colspan="6" style="padding:32px;text-align:center;color:var(--red);font-family:var(--mono);font-size:12px;">Error: ' + err.message + '</td></tr>';
  }

  btn.disabled = false;
  btn.innerHTML = '↺ Cargar usuarios';
}

function renderUsers(users) {
  const tbody = document.getElementById('usr-tbody');
  document.getElementById('usr-count').textContent = users.length + ' usuario' + (users.length !== 1 ? 's' : '');

  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:32px;text-align:center;color:var(--text3);font-family:var(--mono);font-size:12px;">Sin resultados</td></tr>';
    return;
  }

  tbody.innerHTML = users.map((u, i) => {
    const estadoColor = u.estado === 'activo' ? 'var(--green)' : 'var(--red)';
    const estadoBg    = u.estado === 'activo' ? 'rgba(34,216,122,0.1)' : 'rgba(245,101,101,0.1)';
    const creado      = u.creado ? new Date(u.creado).toLocaleDateString('es-MX', { year:'numeric', month:'short', day:'numeric' }) : '—';
    const login       = u.ultimoLogin && u.ultimoLogin !== '1970-01-01T00:00:00.000Z'
      ? new Date(u.ultimoLogin).toLocaleDateString('es-MX', { year:'numeric', month:'short', day:'numeric' })
      : 'Nunca';
    const rowBg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';

    return '<tr style="border-bottom:1px solid var(--border);background:' + rowBg + ';">' +
      '<td style="padding:10px 16px;color:var(--text);">' + u.nombre + '</td>' +
      '<td style="padding:10px 16px;font-family:var(--mono);font-size:12px;color:var(--cyan);">' + u.email + '</td>' +
      '<td style="padding:10px 16px;">' +
        '<span style="font-family:var(--mono);font-size:10px;padding:3px 8px;border-radius:20px;background:' + estadoBg + ';color:' + estadoColor + ';">' + u.estado + '</span>' +
      '</td>' +
      '<td style="padding:10px 16px;font-family:var(--mono);font-size:11px;color:var(--text2);">' + creado + '</td>' +
      '<td style="padding:10px 16px;font-family:var(--mono);font-size:11px;color:var(--text2);">' + login + '</td>' +
      '<td style="padding:10px 16px;text-align:center;">' +
        '<div style="display:flex;gap:6px;justify-content:center;">' +
        '<button onclick="copyEmail(\'' + u.email + '\')" style="background:transparent;border:1px solid var(--border);color:var(--text2);padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;" title="Copiar email">📋</button>' +
        '<button onclick="openUserModal(\'' + u.email + '\',\'' + u.nombre + '\')" style="background:rgba(0,101,243,0.1);border:1px solid rgba(0,101,243,0.3);color:var(--cyan);padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;" title="Gestionar">⚙️</button>' +
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

// ── Módulo Dispositivos ───────────────────────────────────────
let allDevices = [];
let currentDeviceId = null;
let currentDevice = null;
let editingDeviceId = null;

const DEV_ESTADO_COLOR = {
  'activo':        'var(--green)',
  'en reparación': 'var(--amber)',
  'dado de baja':  'var(--red)',
};
const DEV_TIPO_ICON = { laptop: '💻', desktop: '🖥️', 'teléfono': '📱' };
const INT_TIPO_COLOR = {
  'Instalación de software': 'var(--cyan)',
  'Reparación o diagnóstico': 'var(--amber)',
  'Soporte remoto': 'var(--purple)',
};

async function loadDevices() {
  try {
    const resp = await fetch(WORKER_URL + '/device');
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    allDevices = data.devices || [];
    filterDevices();
  } catch(err) {
    document.getElementById('dev-grid').innerHTML =
      '<div class="info-box" style="text-align:center;padding:32px;grid-column:1/-1;border-color:rgba(245,101,101,0.3);"><div style="color:var(--red);font-family:var(--mono);font-size:12px;">Error: ' + err.message + '</div></div>';
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
    grid.innerHTML = '<div class="info-box" style="text-align:center;padding:40px;grid-column:1/-1;"><div style="font-size:32px;opacity:0.3;margin-bottom:12px;">💻</div><div style="font-family:var(--mono);font-size:12px;color:var(--text3);">Sin dispositivos con estos filtros</div></div>';
    return;
  }
  grid.innerHTML = devices.map(d => {
    const eColor = DEV_ESTADO_COLOR[d.estado] || 'var(--text2)';
    const icon   = DEV_TIPO_ICON[d.tipo] || '💻';
    const intCount = (d.intervenciones || []).length;
    return '<div class="action-card" style="cursor:pointer;" onclick="openDeviceDetail(\'' + d.id + '\')">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">'
      + '<span style="font-size:24px;">' + icon + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(0,0,0,0.2);color:' + eColor + ';">' + d.estado + '</span>'
      + '</div>'
      + '<div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:3px;">' + d.nombre + '</div>'
      + '<div style="font-size:12px;color:var(--text2);margin-bottom:8px;">' + (d.usuario || 'Sin usuario asignado') + '</div>'
      + '<div style="display:flex;gap:12px;font-size:11px;color:var(--text3);">'
      + '<span>' + (d.so || 'SO no especificado') + '</span>'
      + '<span style="margin-left:auto;">' + intCount + ' intervenci' + (intCount !== 1 ? 'ones' : 'ón') + '</span>'
      + '</div>'
      + '<div style="margin-top:8px;display:flex;gap:6px;">'
      + (d.gcpw ? '<span style="font-family:var(--mono);font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(25,205,235,0.1);color:var(--cyan);">GCPW</span>' : '')
      + '<span style="font-family:var(--mono);font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.05);color:var(--text3);">' + d.tipo + '</span>'
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
  const eColor = DEV_ESTADO_COLOR[device.estado] || 'var(--text2)';
  document.getElementById('dev-detail-info').innerHTML =
    '<div style="display:grid;gap:6px;">'
    + row('Usuario', device.usuario || '—')
    + row('Tipo', device.tipo)
    + row('Sistema operativo', device.so || '—')
    + row('GCPW', device.gcpw ? '<span style="color:var(--cyan);">✓ Activado</span>' : '<span style="color:var(--text3);">✗ No activado</span>')
    + row('Estado', '<span style="color:' + eColor + ';">' + device.estado + '</span>')
    + '</div>';

  // Apps
  const apps = device.apps || [];
  document.getElementById('dev-detail-apps').innerHTML = apps.length
    ? '<div style="display:flex;flex-wrap:wrap;gap:6px;">' + apps.map(a =>
        '<span style="font-size:12px;padding:4px 10px;background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:6px;color:var(--text2);">' + a + '</span>'
      ).join('') + '</div>'
    : '<span style="color:var(--text3);font-size:12px;">Sin aplicaciones registradas</span>';

  renderHistorial(device.intervenciones || []);
}

function row(label, val) {
  return '<div style="display:flex;gap:8px;align-items:baseline;">'
    + '<span style="font-size:11px;color:var(--text3);min-width:130px;">' + label + '</span>'
    + '<span style="font-size:13px;color:var(--text);">' + val + '</span>'
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
    const color = INT_TIPO_COLOR[i.tipo] || 'var(--text2)';
    return '<div style="padding:12px 0;border-bottom:1px solid var(--border);">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">'
      + '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(0,0,0,0.2);color:' + color + ';">' + i.tipo + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;color:var(--text3);">' + fecha + ' ET</span>'
      + '</div>'
      + '<div style="font-size:13px;color:var(--text);font-weight:500;margin-bottom:2px;">' + i.descripcion + '</div>'
      + (i.notas ? '<div style="font-size:12px;color:var(--text2);line-height:1.5;">' + i.notas + '</div>' : '')
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

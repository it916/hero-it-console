// ═══════════════════════════════════════════════════════════════
//  Hero IT Console — Cloudflare Worker v5
//  POST /              → Enviar email via Resend
//  GET  /users         → Listar usuarios Google Workspace
//  POST /create-user   → Crear usuario en Google Workspace
//  POST /solicitud-cuenta → Recibir solicitud de alta o baja (nuevo schema)
//  POST /alta-agente   → Alias retro-compatible de /solicitud-cuenta
//  GET  /alta-agente   → Listar solicitudes
//  POST /alta-agente/resolver
//  POST /ticket        → Crear ticket de soporte
//  GET  /ticket        → Listar tickets
//  POST /ticket/update → Actualizar estado/prioridad/respuesta
//  POST /audit         → Guardar entrada de auditoría
//  GET  /audit         → Listar entradas de auditoría
// ═══════════════════════════════════════════════════════════════

// Orígenes legítimos del Console + formularios públicos (todos en
// it916.github.io: hero-it-console, alta-agentes, soporte.html).
// Hero Hub (módulo Finanzas) también consume este Worker — endpoint
// /finanzas/send-report — con su propia auth (Firebase ID token).
const ALLOWED_ORIGINS = [
  'https://it916.github.io',
  'https://it.heroinsuranceusa.com',  // subdominio futuro
  'https://hub.heroinsuranceusa.com', // Hero Hub (Finanzas)
];

export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get('Origin') || '';
    // Localhost (Live Server / `npx serve`) se permite con cualquier puerto:
    // útil para probar /finanzas/send-report desde el Hub en desarrollo.
    // El gate de seguridad real es el Firebase ID token + lista de emails.
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin);
    const corsOrigin = (ALLOWED_ORIGINS.includes(requestOrigin) || isLocalhost)
      ? requestOrigin
      : ALLOWED_ORIGINS[0];
    const cors = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const path = url.pathname;

    // ── POST /auth/login — intercambia el ID token de Google por un pase de sesión ──
    // El Console manda el `credential` (ID token JWT) que Google le dio al iniciar
    // sesión. Lo verificamos contra Google y, si el email es el autorizado, emitimos
    // un pase firmado con HMAC (válido 8 h) que el Console reenvía en cada llamada.
    if (request.method === 'POST' && path === '/auth/login') {
      try {
        const { credential } = await request.json();
        if (!credential) return json({ error: 'Falta credential' }, 400, cors);
        const claims = await verifyGoogleIdToken(credential);
        const email = (claims.email || '').toLowerCase();
        if (email !== ALLOWED_EMAIL) return json({ error: 'Acceso denegado' }, 403, cors);
        const token = await mintSession(env, email);
        return json({ token, email, nombre: claims.name || '' }, 200, cors);
      } catch (err) {
        logError('auth_login_failed', err);
        // Mensaje genérico al cliente — los detalles quedan en logError para debug.
        return json({ error: 'No se pudo verificar la sesión' }, 401, cors);
      }
    }

    // ── POST /finanzas/send-report — envío de reporte de comisión a broker ──
    // Consumido por el Hero Hub (módulo Finanzas). No usa el pase HMAC del
    // Console; trae su propia auth via Firebase ID token verificado contra
    // las JWKs públicas de Google (función `verifyFirebaseIdToken`). El email
    // del usuario debe estar en `FINANZAS_EMAILS`. Por eso va ANTES del gate
    // del Console.
    if (request.method === 'POST' && path === '/finanzas/send-report') {
      if (bodyTooLarge(request)) return json({ error: 'Body demasiado grande' }, 413, cors);
      const ip = clientIp(request);
      // 30/min por IP: envíos manuales en serie son normales; ráfagas mayores
      // sugieren bug o abuso. El endpoint además valida el ID token, así que
      // el rate-limit es defensa en profundidad.
      if (!(await rateLimit(env, 'finanzas-email', ip, 30, 60))) {
        return json({ error: 'Demasiados envíos. Espera un minuto.' }, 429, cors);
      }
      try {
        const body = await request.json();
        const { idToken, ingreso, payout, broker } = body || {};
        if (!idToken) return json({ error: 'Falta idToken' }, 400, cors);
        if (!broker || !broker.email) return json({ error: 'Falta broker.email' }, 400, cors);
        if (!ingreso || !payout) return json({ error: 'Falta ingreso o payout' }, 400, cors);

        let claims;
        try {
          claims = await verifyFirebaseIdToken(idToken, env);
        } catch (err) {
          logError('finanzas_token_invalid', err);
          return json({ error: 'Token inválido o expirado' }, 401, cors);
        }
        const userEmail = String(claims.email || '').toLowerCase();
        if (!FINANZAS_EMAILS.has(userEmail)) {
          return json({ error: 'No autorizado para enviar reportes de Finanzas' }, 403, cors);
        }

        const subjectMes = ingreso.mes || ingreso.fecha || '';
        const subject = 'Reporte de comisión — ' + (ingreso.descripcionDeposito || 'Hero Insurance') + (subjectMes ? ' — ' + subjectMes : '');
        const html = renderFinanzasEmail({ ingreso, payout, broker, sender: claims.name || userEmail });
        const text = 'Reporte de comisión\n\n'
          + 'Comisión: ' + (ingreso.descripcionDeposito || '—') + '\n'
          + 'Fecha: ' + (ingreso.fecha || '—') + '\n'
          + (ingreso.tipoPago ? 'Tipo: ' + ingreso.tipoPago + '\n' : '')
          + (ingreso.categoria ? 'Categoría: ' + ingreso.categoria + '\n' : '')
          + 'Monto total: ' + formatUSD(ingreso.monto) + '\n\n'
          + 'Tu payout: ' + formatUSD(payout.saldo) + '\n'
          + (payout.reporteFile ? 'Archivo: ' + payout.reporteFile + '\n' : '')
          + '\nEnviado por ' + (claims.name || userEmail) + ' · Hero Insurance USA';

        const resendResp = await sendResend(env, {
          from: 'Hero Finanzas <financesupport@heroinsuranceusa.com>',
          to: [broker.email],
          reply_to: 'financesupport@heroinsuranceusa.com',
          subject,
          html,
          text,
        }, { event: 'finanzas_report', to: broker.email, by: userEmail });

        if (!resendResp) return json({ error: 'No se pudo contactar a Resend' }, 502, cors);
        if (!resendResp.ok) {
          let msg = 'Resend rechazó el envío (' + resendResp.status + ')';
          try { const d = await resendResp.clone().json(); msg = d.message || d.error || msg; } catch (_) {}
          return json({ error: msg }, resendResp.status, cors);
        }
        const result = await resendResp.json().catch(() => ({}));
        return json({ ok: true, id: result.id || null }, 200, cors);
      } catch (err) {
        logError('handler_failed', err, { path, method: request.method });
        return json({ error: 'Error interno del servidor' }, 500, cors);
      }
    }

    // ── POST /finanzas/send-consolidated-report — envío de reporte consolidado ──
    // Consumido por el Hero Hub (módulo Finanzas → Reportes de Pago). Recibe el
    // HTML del cuerpo del email + el PDF ya generado client-side en base64, y
    // los envía via Resend como attachment. Misma auth que /finanzas/send-report
    // (Firebase ID token + whitelist FINANZAS_EMAILS). Body más grande que el
    // otro handler porque incluye el PDF base64 (típico 100-300 KB).
    if (request.method === 'POST' && path === '/finanzas/send-consolidated-report') {
      // 20MB: PDF base64 típico ronda 100-500KB con JPEG; margen amplio por si
      // el reporte tiene muchos ingresos o el user sube el scale. Cloudflare
      // Workers acepta hasta 100MB, así que hay techo suficiente.
      if (bodyTooLarge(request, 20 * 1024 * 1024)) return json({ error: 'Body demasiado grande (>20MB)' }, 413, cors);
      const ip = clientIp(request);
      // 15/min por IP: los reportes consolidados son eventos menos frecuentes
      // que los individuales — un usuario típicamente manda 5-15 al día en batch.
      if (!(await rateLimit(env, 'finanzas-consolidated', ip, 15, 60))) {
        return json({ error: 'Demasiados envíos. Espera un minuto.' }, 429, cors);
      }
      try {
        const body = await request.json();
        const { idToken, emailTo, subject, htmlBody, pdfBase64, filename, reporte } = body || {};
        if (!idToken) return json({ error: 'Falta idToken' }, 400, cors);
        if (!emailTo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo)) {
          return json({ error: 'emailTo inválido o ausente' }, 400, cors);
        }
        if (!subject || !htmlBody || !pdfBase64 || !filename) {
          return json({ error: 'Payload incompleto (subject/htmlBody/pdfBase64/filename)' }, 400, cors);
        }

        let claims;
        try {
          claims = await verifyFirebaseIdToken(idToken, env);
        } catch (err) {
          logError('finanzas_consolidated_token_invalid', err);
          return json({ error: 'Token inválido o expirado' }, 401, cors);
        }
        const userEmail = String(claims.email || '').toLowerCase();
        if (!FINANZAS_EMAILS.has(userEmail)) {
          return json({ error: 'No autorizado para enviar reportes de Finanzas' }, 403, cors);
        }

        // Texto plano de fallback para clientes que no rendean HTML.
        const numero = reporte?.numeroReporte || '';
        const destinatario = reporte?.destinatarioNombre || '';
        const totalPayout = Number(reporte?.totalPayout) || 0;
        const text = 'Reporte de pago consolidado ' + numero + '\n\n'
          + 'Destinatario: ' + destinatario + '\n'
          + 'Total: ' + formatUSD(totalPayout) + '\n\n'
          + 'El detalle completo está en el PDF adjunto.\n\n'
          + 'Enviado por ' + (claims.name || userEmail) + ' · Hero Insurance USA';

        const resendResp = await sendResend(env, {
          from: 'Hero Finanzas <financesupport@heroinsuranceusa.com>',
          to: [emailTo],
          reply_to: 'financesupport@heroinsuranceusa.com',
          subject,
          html: htmlBody,
          text,
          attachments: [
            { filename, content: pdfBase64 }
          ],
        }, { event: 'finanzas_consolidated_report', to: emailTo, by: userEmail, numero });

        if (!resendResp) return json({ error: 'No se pudo contactar a Resend' }, 502, cors);
        if (!resendResp.ok) {
          let msg = 'Resend rechazó el envío (' + resendResp.status + ')';
          try { const d = await resendResp.clone().json(); msg = d.message || d.error || msg; } catch (_) {}
          return json({ error: msg }, resendResp.status, cors);
        }
        const result = await resendResp.json().catch(() => ({}));
        return json({ ok: true, id: result.id || null }, 200, cors);
      } catch (err) {
        logError('handler_failed', err, { path, method: request.method });
        return json({ error: 'Error interno del servidor' }, 500, cors);
      }
    }

    // ── POST /auth/hub-login — Hero Hub intercambia Firebase ID token por HERO_TOKEN ──
    // El Hub autentica con Firebase; para consumir los endpoints privados del Console
    // necesita el mismo pase HMAC que emite /auth/login para la SPA legacy. Este
    // endpoint valida el Firebase ID token, chequea whitelist IT_EMAILS y devuelve
    // un HERO_TOKEN idéntico al que ya conocen el gate y `authFetch`. Va ANTES del
    // gate central porque tiene su propia auth.
    if (request.method === 'POST' && path === '/auth/hub-login') {
      if (bodyTooLarge(request)) return json({ error: 'Body demasiado grande' }, 413, cors);
      const ip = clientIp(request);
      if (!(await rateLimit(env, 'hub-login', ip, 20, 60))) {
        return json({ error: 'Demasiados intentos. Espera un minuto.' }, 429, cors);
      }
      try {
        const { idToken } = await request.json();
        if (!idToken) return json({ error: 'Falta idToken' }, 400, cors);
        let claims;
        try {
          claims = await verifyFirebaseIdToken(idToken, env);
        } catch (err) {
          logError('hub_login_token_invalid', err);
          return json({ error: 'Token inválido o expirado' }, 401, cors);
        }
        const userEmail = String(claims.email || '').toLowerCase();
        if (!IT_EMAILS.has(userEmail)) {
          return json({ error: 'No autorizado para IT Console' }, 403, cors);
        }
        // NOTA: mintSession emite un HERO_TOKEN con `email` en el payload y
        // verifySession lo rechaza si `email !== ALLOWED_EMAIL`. Como IT_EMAILS
        // = { 'it@...' } y ALLOWED_EMAIL = 'it@...', coincide. Si en el futuro
        // se expande IT_EMAILS, hay que ajustar también verifySession.
        const token = await mintSession(env, userEmail);
        return json({
          token,
          email: userEmail,
          nombre: claims.name || '',
          exp_sec: SESSION_TTL_SEC,
        }, 200, cors);
      } catch (err) {
        logError('hub_login_failed', err, { path, method: request.method });
        return json({ error: 'Error interno del servidor' }, 500, cors);
      }
    }

    // ── Gate de autorización ──────────────────────────────────
    // Todo es privado salvo las rutas públicas (formularios y links de email).
    // Las privadas exigen un pase de sesión válido (Authorization: Bearer …).
    const isPublicRoute =
         (request.method === 'POST' && path === '/ticket')
      || (request.method === 'POST' && path === '/solicitud-cuenta')
      || (request.method === 'POST' && path === '/alta-agente')
      || (request.method === 'GET'  && path === '/solicitud-cuenta/autorizar');
    if (!isPublicRoute) {
      const authedEmail = await requireAuth(request, env);
      if (!authedEmail) return json({ error: 'No autorizado' }, 401, cors);
    }

    // ── GET /zoho/debug — ver respuesta raw de Zoho ───────────
    if (request.method === 'GET' && path === '/zoho/debug') {
      try {
        const token = await getZohoToken(env);
        // Get user info to find correct department ID
        const resp = await fetch('https://assist.zoho.com/api/v2/user', {
          headers: { 'Authorization': 'Zoho-oauthtoken ' + token }
        });
        const text = await resp.text();
        return new Response(text, { status: resp.status, headers: { ...cors, 'Content-Type': 'application/json' } });
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── GET /zoho/devices — listar dispositivos Zoho Assist ───
    // Mantenido por back-compat. Para la vista nueva de Dispositivos unificada,
    // usar GET /device?withZoho=1 (mergea live data Zoho + metadata KV).
    if (request.method === 'GET' && path === '/zoho/devices') {
      try {
        const noCache = url.searchParams.get('fresh') === '1';
        const { devices, fromCache } = await fetchZohoDevicesData(env, { fresh: noCache });
        return json({ devices, cached: fromCache }, 200, cors);
      } catch (err) {
        logError('handler_failed', err, { path, method: request.method });
        return json({ error: err.message || 'Error interno del servidor' }, 500, cors);
      }
    }

    // ── GET /zoho/session/:id — iniciar sesión remota ─────────
    // Llama a la API oficial de Zoho Assist v2 para abrir una sesión de
    // acceso desatendido. Devuelve `technician_uri`: la URL que el técnico
    // abre para conectarse al equipo (NO depende de un portal hardcodeado).
    // Ref: https://www.zoho.com/assist/api/unattendedsession.html
    if (request.method === 'GET' && path.startsWith('/zoho/session/')) {
      try {
        const computerId = path.replace('/zoho/session/', '');
        if (!computerId) return json({ error: 'Falta computerId' }, 400, cors);
        const token = await getZohoToken(env);
        const apiUrl = 'https://assist.zoho.com/api/v2/unattended/'
                     + encodeURIComponent(computerId)
                     + '/connect?department_id=' + encodeURIComponent(env.ZOHO_DEPARTMENT_ID);
        const resp = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': 'Zoho-oauthtoken ' + token,
            'Content-Type': 'application/json',
            'x-com-zoho-assist-department-id': env.ZOHO_DEPARTMENT_ID
          }
        });
        const text = await resp.text();
        let data;
        try { data = JSON.parse(text); }
        catch (e) { return json({ error: 'Respuesta no JSON de Zoho: ' + text.substring(0, 200) }, 500, cors); }
        if (!resp.ok) {
          logError('zoho_session_failed', new Error('status ' + resp.status), { computerId, body: text.substring(0, 300) });
          return json({ error: data.message || data.error || 'Error al iniciar sesión Zoho' }, resp.status, cors);
        }
        const sessionUrl = data.representation?.technician_uri || '';
        if (!sessionUrl) {
          logError('zoho_session_no_uri', new Error('no technician_uri'), { computerId, data: JSON.stringify(data).substring(0, 300) });
          return json({ error: 'Zoho no devolvió URL de técnico (verificá que el dispositivo siga registrado)' }, 502, cors);
        }
        return json({ sessionUrl }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── GET /stats — counts ligeros para el polling del dashboard ─
    // Cache 2 min en KV (1 get vs 3 list). Las mutaciones de ticket/solicitud/
    // device invalidan 'cache_stats' para que el dashboard refleje cambios YA.
    // `?fresh=1` fuerza bypass.
    // El cálculo subyacente usa list() + metadata sin get()s. Las entradas
    // pre-deploy sin metadata requieren un get() — el endpoint
    // /admin/backfill-metadata las migra de una sola pasada (correr una vez).
    if (request.method === 'GET' && path === '/stats') {
      try {
        const noCache = url.searchParams.get('fresh') === '1';
        if (!noCache) {
          const cached = await env.HERO_KV.get('cache_stats');
          if (cached) {
            try {
              const data = JSON.parse(cached);
              return json({ ...data, cached: true }, 200, cors);
            } catch (_) { /* cache corrupta, refetch */ }
          }
        }
        const [tickets, solicitudes, devices] = await Promise.all([
          env.HERO_KV.list({ prefix: 'ticket_' }),
          env.HERO_KV.list({ prefix: 'alta_' }),
          env.HERO_KV.list({ prefix: 'device_' }),
        ]);
        const countByEstado = async (keys, target) => {
          let count = 0; const legacy = [];
          for (const k of keys) {
            if (k.metadata && k.metadata.estado !== undefined) {
              if (k.metadata.estado === target) count++;
            } else { legacy.push(k.name); }
          }
          if (legacy.length) {
            const estados = await Promise.all(legacy.map(async name => {
              try { const v = await env.HERO_KV.get(name); return v ? JSON.parse(v).estado : null; }
              catch { return null; }
            }));
            count += estados.filter(e => e === target).length;
          }
          return { count, legacy: legacy.length };
        };
        const t = await countByEstado(tickets.keys, 'abierto');
        const s = await countByEstado(solicitudes.keys, 'pendiente');
        const stats = {
          tickets:     { open: t.count, total: tickets.keys.length,     legacy: t.legacy },
          solicitudes: { pending: s.count, total: solicitudes.keys.length, legacy: s.legacy },
          devices:     { total: devices.keys.length },
        };
        try { await env.HERO_KV.put('cache_stats', JSON.stringify(stats), { expirationTtl: 120 }); }
        catch (e) { logError('stats_cache_write_failed', e); }
        return json(stats, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── POST /admin/backfill-metadata ─────────────────────────
    // Re-puts toda entrada que no tenga metadata para que los list() futuros
    // sean baratos. Idempotente: las entradas que ya tienen metadata se saltean.
    // Correr una vez después del deploy. Privado (Bearer auth).
    if (request.method === 'POST' && path === '/admin/backfill-metadata') {
      try {
        const SUMMARIZERS = {
          'ticket_': summarizeTicket,
          'alta_':   summarizeSolicitud,
          'device_': summarizeDevice,
          'lic_':    summarizeLicencia,
          'audit_':  summarizeAudit,
          'kb_':     summarizeKb,
        };
        const stats = {};
        for (const prefix of Object.keys(SUMMARIZERS)) {
          let migrated = 0, skipped = 0;
          let cursor = undefined;
          do {
            const list = await env.HERO_KV.list({ prefix, cursor });
            for (const k of list.keys) {
              if (k.metadata && Object.keys(k.metadata).length > 0) { skipped++; continue; }
              const v = await env.HERO_KV.get(k.name);
              if (!v) continue;
              try {
                const parsed = JSON.parse(v);
                await env.HERO_KV.put(k.name, v, { metadata: SUMMARIZERS[prefix](parsed) });
                migrated++;
              } catch (e) { logError('backfill_key_failed', e, { key: k.name }); }
            }
            cursor = list.list_complete ? null : list.cursor;
          } while (cursor);
          stats[prefix] = { migrated, skipped };
        }
        logEvent('backfill_metadata_complete', { stats });
        return json({ ok: true, stats }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }


    // ── POST /licencia — crear/actualizar ─────────────────────
    if (request.method === 'POST' && path === '/licencia') {
      try {
        const { id, nombre, plan, tipoSub, costo, usuarios, vencimiento, estado, notas,
                credUsuario, credPassword, codigoLicencia } = await request.json();
        if (!nombre) return json({ error: 'Falta el nombre' }, 400, cors);
        const licId = id || 'lic_' + Date.now();
        const lic = {
          id: licId, nombre,
          plan:           plan           || '',
          tipoSub:        tipoSub        || 'mensual',
          costo:          costo          || 0,
          usuarios:       usuarios       || 0,
          vencimiento:    vencimiento    || null,
          estado:         estado         || 'activa',
          notas:          notas          || '',
          credUsuario:    credUsuario    || '',
          credPassword:   credPassword   || '',
          codigoLicencia: codigoLicencia || '',
          fecha: new Date().toISOString(),
        };
        await env.HERO_KV.put(licId, JSON.stringify(lic), { metadata: summarizeLicencia(lic) });
        await invalidateCaches(env, 'cache_lic_list');
        return json({ ok: true, id: licId }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── GET /licencia — listar ─────────────────────────────────
    if (request.method === 'GET' && path === '/licencia') {
      try {
        const hasCursor = url.searchParams.get('cursor') != null;
        const data = await withListCache(env, 'cache_lic_list', 60, hasCursor, async () => {
          const list = await env.HERO_KV.list({ prefix: 'lic_', ...paginationParams(url) });
          const items = await Promise.all(list.keys.map(async k => {
            const v = await env.HERO_KV.get(k.name); return v ? JSON.parse(v) : null;
          }));
          return {
            licencias: items.filter(Boolean).sort((a, b) => a.nombre.localeCompare(b.nombre)),
            ...listMeta(list)
          };
        });
        return json(data, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── POST /licencia/delete ──────────────────────────────────
    if (request.method === 'POST' && path === '/licencia/delete') {
      try {
        const { id } = await request.json();
        await env.HERO_KV.delete(id);
        await invalidateCaches(env, 'cache_lic_list');
        return json({ ok: true }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── POST /kb — crear entrada del Toolbox (mantiene prefijo kb_ por compat) ─
    if (request.method === 'POST' && path === '/kb') {
      return dedupByBody(request, env, async () => {
      try {
        const { titulo, contenido, tags, ticketOrigen, tipo, lenguaje } = await request.json();
        if (!titulo || !contenido) return json({ error: 'Faltan campos: titulo, contenido' }, 400, cors);
        const TIPOS_VALIDOS = ['script', 'comando', 'tip', 'proceso'];
        const tipoFinal = TIPOS_VALIDOS.includes(tipo) ? tipo : 'proceso';
        const id = 'kb_' + Date.now();
        const articulo = {
          id, titulo, contenido,
          tags: Array.isArray(tags) ? tags : [],
          ticketOrigen: ticketOrigen || null,
          tipo: tipoFinal,
          lenguaje: tipoFinal === 'script' ? (lenguaje || 'otro') : null,
          fecha: new Date().toISOString(),
        };
        await env.HERO_KV.put(id, JSON.stringify(articulo), { metadata: summarizeKb(articulo) });
        await invalidateCaches(env, 'cache_kb_list');
        return json({ ok: true, id, articulo }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
      }, 'kb');
    }

    // ── GET /kb — listar artículos ────────────────────────────
    if (request.method === 'GET' && path === '/kb') {
      try {
        const hasCursor = url.searchParams.get('cursor') != null;
        const data = await withListCache(env, 'cache_kb_list', 60, hasCursor, async () => {
          const list = await env.HERO_KV.list({ prefix: 'kb_', ...paginationParams(url) });
          const items = await Promise.all(list.keys.map(async k => {
            const v = await env.HERO_KV.get(k.name); return v ? JSON.parse(v) : null;
          }));
          return {
            articulos: items.filter(Boolean).sort((a, b) => new Date(b.fecha) - new Date(a.fecha)),
            ...listMeta(list)
          };
        });
        return json(data, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── POST /kb/update — actualizar entrada del Toolbox ──────
    if (request.method === 'POST' && path === '/kb/update') {
      try {
        const { id, titulo, contenido, tags, tipo, lenguaje } = await request.json();
        if (!id) return json({ error: 'Falta id' }, 400, cors);
        const v = await env.HERO_KV.get(id);
        if (!v) return json({ error: 'Entrada no encontrada' }, 404, cors);
        const a = JSON.parse(v);
        const TIPOS_VALIDOS = ['script', 'comando', 'tip', 'proceso'];
        if (titulo    !== undefined) a.titulo = titulo;
        if (contenido !== undefined) a.contenido = contenido;
        if (tags      !== undefined) a.tags = Array.isArray(tags) ? tags : [];
        if (tipo      !== undefined && TIPOS_VALIDOS.includes(tipo)) a.tipo = tipo;
        if (lenguaje  !== undefined) a.lenguaje = a.tipo === 'script' ? (lenguaje || 'otro') : null;
        a.actualizado = new Date().toISOString();
        await env.HERO_KV.put(id, JSON.stringify(a), { metadata: summarizeKb(a) });
        await invalidateCaches(env, 'cache_kb_list');
        return json({ ok: true, articulo: a }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── POST /kb/delete ───────────────────────────────────────
    if (request.method === 'POST' && path === '/kb/delete') {
      try {
        const { id } = await request.json();
        if (!id) return json({ error: 'Falta id' }, 400, cors);
        await env.HERO_KV.delete(id);
        await invalidateCaches(env, 'cache_kb_list');
        return json({ ok: true }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── GET /config/authorizers ───────────────────────────────
    // Lista de autorizadores que pueden aprobar altas/bajas. La fuente de verdad
    // es KV 'config_authorizers'; si está vacía, retornamos el fallback hardcoded
    // para que el sistema siga funcionando sin haber sido configurado.
    if (request.method === 'GET' && path === '/config/authorizers') {
      try {
        const list = await getAuthorizerList(env);
        return json({ authorizers: list, isDefault: list === AUTHORIZER_LIST_DEFAULT }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── POST /config/authorizers ──────────────────────────────
    // Reemplaza la lista completa. Se valida que cada entry tenga email y nombre.
    // Lista vacía => borrar la key y volver al fallback hardcoded.
    if (request.method === 'POST' && path === '/config/authorizers') {
      try {
        const { authorizers } = await request.json();
        if (!Array.isArray(authorizers)) return json({ error: 'authorizers debe ser un array' }, 400, cors);
        const clean = authorizers
          .map(a => ({ email: String(a.email || '').trim().toLowerCase(), nombre: String(a.nombre || '').trim() }))
          .filter(a => a.email && a.nombre && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email));
        if (clean.length === 0) {
          await env.HERO_KV.delete('config_authorizers');
          return json({ ok: true, count: 0, usingDefault: true }, 200, cors);
        }
        await env.HERO_KV.put('config_authorizers', JSON.stringify(clean));
        return json({ ok: true, count: clean.length, authorizers: clean }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── GET /users ────────────────────────────────────────────
    // Cache de 60s en KV: el dashboard recarga cada 60s + cada vista que pida
    // usuarios golpeaba Admin API. Reduce quota y latencia (200-500ms ahorrados
    // en cache hit). El cliente puede forzar refresh con ?fresh=1.
    if (request.method === 'GET' && path === '/users') {
      try {
        const noCache = url.searchParams.get('fresh') === '1';
        if (!noCache) {
          const cached = await env.HERO_KV.get('cache_users');
          if (cached) {
            try { return json({ users: JSON.parse(cached), cached: true }, 200, cors); }
            catch (_) { /* cache corrupta, refetch */ }
          }
        }
        const token = await getGoogleToken(env);
        // projection=full trae `organizations`, `phones`, `aliases`,
        // `thumbnailPhotoUrl` y campos custom — sin esto solo veríamos
        // los básicos. El costo es un JSON más grande, despreciable para
        // ~20 usuarios internos.
        const resp = await fetch(
          'https://admin.googleapis.com/admin/directory/v1/users?domain=heroinsuranceusa.com&maxResults=200&orderBy=email&projection=full',
          { headers: { 'Authorization': 'Bearer ' + token } }
        );
        const data = await resp.json();
        if (!resp.ok) return json({ error: data.error?.message || 'Error Google API' }, resp.status, cors);
        const users = (data.users || []).map(u => {
          // La primera org es la "primaria" en la mayoría de dominios;
          // si hay varias, cae al primer registro.
          const org = Array.isArray(u.organizations) && u.organizations.length
            ? (u.organizations.find(o => o.primary) || u.organizations[0])
            : null;
          return {
            nombre: u.name?.fullName || '', email: u.primaryEmail || '',
            estado: u.suspended ? 'suspendido' : 'activo',
            suspensionReason: u.suspensionReason || '',
            creado: u.creationTime || '', ultimoLogin: u.lastLoginTime || '',
            orgUnitPath: u.orgUnitPath || '/',
            // Admin SDK reporta si el usuario tiene 2FA activado (`isEnrolledIn2Sv`)
            // y si está forzado a usarlo por política (`isEnforcedIn2Sv`).
            mfaEnrolled: !!u.isEnrolledIn2Sv,
            mfaEnforced: !!u.isEnforcedIn2Sv,
            // Enriquecimiento: campos que ya venían en el JSON de projection=full
            // pero que no estábamos exponiendo. Habilitan la nueva vista de tabla
            // enriquecida del IT Console.
            cargo:         org?.title || '',
            departamento:  org?.department || '',
            aliases:       Array.isArray(u.aliases) ? u.aliases : [],
            isAdmin:          !!u.isAdmin,
            isDelegatedAdmin: !!u.isDelegatedAdmin,
            changePasswordAtNextLogin: !!u.changePasswordAtNextLogin,
          };
        });
        try { await env.HERO_KV.put('cache_users', JSON.stringify(users), { expirationTtl: 60 }); }
        catch (e) { logError('users_cache_write_failed', e); }
        return json({ users }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── POST /create-user ─────────────────────────────────────
    if (request.method === 'POST' && path === '/create-user') {
      return dedupByBody(request, env, async () => {
      try {
        const { nombre, apellido, email, password, solicitanteEmail, solicitanteNombre } = await request.json();
        if (!nombre || !apellido || !email || !password)
          return json({ error: 'Faltan campos requeridos' }, 400, cors);
        const token = await getGoogleToken(env);
        const resp = await fetch('https://admin.googleapis.com/admin/directory/v1/users', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: { givenName: nombre, familyName: apellido },
            primaryEmail: email, password, changePasswordAtNextLogin: true,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) return json({ error: data.error?.message || 'Error al crear usuario' }, resp.status, cors);

        // Invalidar cache de /users — el nuevo usuario debe aparecer ya.
        try { await env.HERO_KV.delete('cache_users'); } catch (_) {}

        // Notificación al solicitante si viene de una alta
        if (solicitanteEmail) {
          await sendResend(env, {
              from: 'Fernando Romero <it@heroinsuranceusa.com>',
              to: [solicitanteEmail],
              subject: 'Tu solicitud fue procesada: ' + nombre + ' ' + apellido,
              html: '<div style="font-family:Arial,sans-serif;max-width:600px;background:#f0f4f8;padding:32px 16px;">'
                + '<div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.1);">'
                + '<div style="background:linear-gradient(135deg,#06a3b6,#048395);padding:32px 40px;text-align:center;">'
                + '<img src="https://i.ibb.co/Gr4mzLv/Nuevo-Logo-Cuadrado-compress.png" width="120" style="display:block;margin:0 auto 16px;"/>'
                + '<h1 style="color:#fff;margin:0;font-size:22px;font-weight:900;">Solicitud procesada</h1>'
                + '<p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px;">El agente ha sido dado de alta en el sistema.</p></div>'
                + '<div style="padding:32px 40px;">'
                + '<p style="font-size:15px;color:#2d3748;">Hola <strong>' + (solicitanteNombre || '') + '</strong>, tu solicitud de alta ha sido procesada.</p>'
                + '<div style="background:#f7faff;border-radius:12px;border:1px solid #e2eaf8;padding:20px;margin:20px 0;">'
                + '<p style="margin:0 0 8px;font-size:11px;font-weight:900;letter-spacing:2px;color:#06a3b6;text-transform:uppercase;">Agente dado de alta</p>'
                + '<p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#1a202c;">' + nombre + ' ' + apellido + '</p>'
                + '<p style="margin:0;font-family:monospace;font-size:13px;color:#06a3b6;">' + email + '</p>'
                + '</div>'
                + '<p style="font-size:13px;color:#4a5568;line-height:1.6;">El agente recibirá sus credenciales de acceso por separado. Si tienes alguna pregunta, contacta al equipo de IT.</p>'
                + '</div>'
                + '<div style="padding:14px 40px;background:#f0f4f8;text-align:center;"><p style="margin:0;font-size:10px;color:#a0aec0;">CONFIDENTIALITY NOTICE: This email is intended solely for the addressee.</p></div>'
                + '</div></div>',
              text: 'Hola ' + (solicitanteNombre || '') + ', la solicitud de alta para ' + nombre + ' ' + apellido + ' (' + email + ') fue procesada correctamente.',
          }, { event: 'create_user_notif_solicitante' });
        }

        return json({ ok: true, email: data.primaryEmail }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
      }, 'create-user');
    }

    // ── GET /solicitud-cuenta/autorizar ───────────────────────
    // Endpoint público que recibe el click desde el botón del email.
    // Verifica HMAC, marca la solicitud como autorizada (registrando quién y
    // cuándo). Idempotente: si ya está autorizada o procesada, muestra el
    // estado actual en lugar de error.
    // Mitigación de race condition: el check `sol.estado === 'autorizada'`
    // (más abajo) captura el caso común de dos autorizadores clickeando casi
    // simultáneamente. Queda una ventana TOCTOU mínima (~ms) entre el read y
    // el write; el peor caso es un email "[AUTORIZADA]" duplicado a IT, sin
    // pérdida de datos. KV no soporta CAS; aceptamos esta ventana.
    if (request.method === 'GET' && path === '/solicitud-cuenta/autorizar') {
      const heroCyan   = 'linear-gradient(135deg,#06a3b6,#048395)';
      const heroAmber  = 'linear-gradient(135deg,#d97706,#f59e0b)';
      const heroRed    = 'linear-gradient(135deg,#c0392b,#a52917)';
      const ip = clientIp(request);
      // 20/min: clicks legítimos del autorizador (incluyendo redirects + recargas)
      // entran holgados; bloquea brute-force de la firma HMAC.
      if (!(await rateLimit(env, 'autorizar', ip, 20, 60))) {
        logEvent('rate_limited', { scope: 'autorizar', ip });
        return htmlResponse(buildAuthorizePage({
          titulo: 'Demasiados intentos', icono: '⏳', color: heroAmber,
          mensaje: 'Has hecho muchos intentos. Espera un minuto y vuelve a intentar.'
        }), 429, cors);
      }
      try {
        const id  = url.searchParams.get('id')  || '';
        const by  = (url.searchParams.get('by')  || '').toLowerCase();
        const sig = url.searchParams.get('sig') || '';
        const exp = url.searchParams.get('exp') || '';

        if (!id || !by || !sig || !exp) {
          return htmlResponse(buildAuthorizePage({
            titulo: 'Link inválido', icono: '⚠️', color: heroAmber,
            mensaje: 'El enlace está incompleto o es de una versión anterior. Pide a IT que reenvíe la solicitud.'
          }), 400, cors);
        }
        // Defensa en profundidad: el id debe corresponder a una solicitud de
        // alta/baja. Si AUTH_HMAC_SECRET llegara a reusarse a futuro, un id
        // con otro prefijo no podría ser autorizado por este endpoint.
        if (!id.startsWith('alta_')) {
          return htmlResponse(buildAuthorizePage({
            titulo: 'Link inválido', icono: '⚠️', color: heroAmber,
            mensaje: 'El enlace no apunta a una solicitud válida.'
          }), 400, cors);
        }

        // Si el link expiró, mensaje claro antes de revelar otros detalles.
        const expNum = parseInt(exp, 10);
        if (!expNum || expNum * 1000 < Date.now()) {
          return htmlResponse(buildAuthorizePage({
            titulo: 'Link expirado', icono: '⏳', color: heroAmber,
            mensaje: 'Este link de autorización ya no es válido (los links caducan a los 7 días). Pide a IT que reenvíe la solicitud.'
          }), 410, cors);
        }

        const authorizerObj = await findAuthorizerByEmail(env, by);
        if (!authorizerObj) {
          return htmlResponse(buildAuthorizePage({
            titulo: 'No autorizado', icono: '🔒', color: heroRed,
            mensaje: 'Este correo no figura como autorizador de solicitudes. Si crees que es un error, contacta a IT.'
          }), 403, cors);
        }

        const ok = await verifyAuth(env, id, by, sig, exp);
        if (!ok) {
          return htmlResponse(buildAuthorizePage({
            titulo: 'Link no válido', icono: '🔒', color: heroRed,
            mensaje: 'No se pudo verificar la firma del enlace. Si crees que es un error, contacta a IT.'
          }), 403, cors);
        }

        const raw = await env.HERO_KV.get(id);
        if (!raw) {
          return htmlResponse(buildAuthorizePage({
            titulo: 'Solicitud no encontrada', icono: '🔍', color: heroAmber,
            mensaje: 'La solicitud ya no existe en el sistema. Es posible que haya sido archivada.'
          }), 404, cors);
        }
        const sol = JSON.parse(raw);

        const tipoLabel = sol.tipoSolicitud === 'baja' ? 'baja' : 'alta';
        const persona   = sol.tipoSolicitud === 'baja'
          ? (sol.nombre || '')
          : ((sol.nombre || '') + ' ' + (sol.apellido || '')).trim();
        const correoSol = sol.tipoSolicitud === 'baja'
          ? (sol.correoEliminar || '')
          : (sol.correoPersonal || sol.correo || '');

        const detalleBase =
            '<strong>' + esc(tipoLabel.toUpperCase()) + '</strong> · ' + esc(persona)
          + (correoSol ? '<br/><span style="font-family:monospace;color:#06a3b6;">' + esc(correoSol) + '</span>' : '')
          + (sol.solicitanteNombre ? '<br/><span style="color:#777;">Solicitado por: ' + esc(sol.solicitanteNombre) + '</span>' : '');

        // Estados terminales: nada que hacer.
        if (sol.estado === 'rechazada') {
          return htmlResponse(buildAuthorizePage({
            titulo: 'Solicitud rechazada', icono: '✗', color: heroRed,
            mensaje: 'Esta solicitud ya fue rechazada y no se puede autorizar.',
            detalle: detalleBase
          }), 200, cors);
        }
        if (sol.estado === 'procesada') {
          return htmlResponse(buildAuthorizePage({
            titulo: 'Solicitud ya procesada', icono: '✓', color: heroCyan,
            mensaje: 'Esta solicitud ya fue completada por IT. No se requiere ninguna acción adicional.',
            detalle: detalleBase
          }), 200, cors);
        }

        // Ya autorizada: mostrar quién + cuándo, sin re-escribir KV.
        if (sol.estado === 'autorizada') {
          const yaPor = sol.autorizadaEmail || sol.autorizadaPor || 'otro autorizador';
          const fechaAut = sol.autorizadaFecha
            ? new Date(sol.autorizadaFecha).toLocaleString('es-MX', {
                timeZone: 'America/New_York', day:'2-digit', month:'short',
                year:'numeric', hour:'2-digit', minute:'2-digit'
              }) + ' ET'
            : '';
          const mismoUsuario = yaPor.toLowerCase() === by;
          const mensaje = mismoUsuario
            ? 'Ya habías autorizado esta solicitud anteriormente. IT ya recibió la notificación.'
            : 'Esta solicitud ya fue autorizada por <strong>' + esc(sol.autorizadaPor || yaPor) + '</strong>'
              + (fechaAut ? ' el <strong>' + esc(fechaAut) + '</strong>' : '')
              + '. No se requiere ninguna acción adicional.';
          return htmlResponse(buildAuthorizePage({
            titulo: 'Solicitud ya autorizada', icono: '✓', color: heroCyan,
            mensaje: mensaje, detalle: detalleBase
          }), 200, cors);
        }

        // Pendiente → autorizar
        const nombreAut = authorizerObj.nombre;
        sol.estado = 'autorizada';
        sol.autorizadaPor   = nombreAut;
        sol.autorizadaEmail = by;
        sol.autorizadaFecha = new Date().toISOString();
        await env.HERO_KV.put(id, JSON.stringify(sol), { metadata: summarizeSolicitud(sol) });
        await invalidateCaches(env, 'cache_solicitudes_list', 'cache_stats');

        // Notifica a IT que la solicitud fue autorizada (no a los otros autorizadores
        // para no spamearlos — la Console refleja el estado).
        await sendResend(env, {
          from: 'Fernando Romero <it@heroinsuranceusa.com>',
          to:   ['it@heroinsuranceusa.com'],
          subject: '[AUTORIZADA] Solicitud de ' + tipoLabel + ': ' + persona,
          text: 'Autorizada por: ' + nombreAut + ' <' + by + '>\n'
            + 'Tipo: ' + tipoLabel.toUpperCase() + '\n'
            + 'Persona: ' + persona + '\n'
            + (correoSol ? 'Correo: ' + correoSol + '\n' : '')
            + 'ID: ' + id,
        }, { event: 'autorizar_notif_it', id });

        // Fase C — Notificación al solicitante: la solicitud fue autorizada
        // y IT procederá en breve. En try/catch: si Resend falla, el estado
        // 'autorizada' ya se guardó en KV y no revertimos por un email.
        if (sol.solicitanteEmail) {
          try {
            const isAltaAut = sol.tipoSolicitud !== 'baja';
            const headerGradAut = isAltaAut
              ? 'linear-gradient(135deg,#06a3b6,#048395)'
              : 'linear-gradient(135deg,#c0392b,#a52917)';
            const ackAutHtml =
                '<div style="font-family:Trebuchet MS,Arial,sans-serif;max-width:620px;background:#f0f4f8;padding:32px 16px;">'
              + '<div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">'
              + '<div style="background:' + headerGradAut + ';padding:28px 40px;text-align:center;">'
              +   '<img src="https://i.ibb.co/Gr4mzLv/Nuevo-Logo-Cuadrado-compress.png" width="120" style="display:block;margin:0 auto 14px;"/>'
              +   '<div style="display:inline-block;background:rgba(255,255,255,0.2);color:#fff;font-weight:700;font-size:11px;letter-spacing:3px;padding:5px 14px;border-radius:20px;margin-bottom:10px;">AUTORIZADA</div>'
              +   '<h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">Tu solicitud fue autorizada</h1>'
              + '</div>'
              + '<div style="padding:28px 40px;">'
              +   '<p style="margin:0 0 18px;font-size:14px;color:#4a5568;">Hola <strong>' + esc(sol.solicitanteNombre || '') + '</strong>, tu solicitud de ' + tipoLabel + ' para <strong>' + esc(persona) + '</strong> fue autorizada.</p>'
              +   '<div style="background:#f7faff;border-radius:10px;border:1px solid #d8e1ea;padding:18px;margin:0 0 22px;">'
              +     '<p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:2px;color:#06a3b6;text-transform:uppercase;">Autorizada por</p>'
              +     '<p style="margin:0 0 10px;font-size:14px;color:#1a202c;">' + esc(nombreAut) + '</p>'
              +     '<p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:2px;color:#06a3b6;text-transform:uppercase;">Referencia</p>'
              +     '<p style="margin:0;font-family:monospace;font-size:13px;color:#06a3b6;">' + esc(id) + '</p>'
              +   '</div>'
              +   '<p style="margin:0 0 12px;font-size:13px;color:#4a5568;line-height:1.6;">El equipo de IT ya recibió la notificación y procederá con el ' + tipoLabel + ' en breve. Recibirás una confirmación final cuando esté completa.</p>'
              +   '<p style="margin:0;font-size:12px;color:#999;line-height:1.5;">Dudas: <a href="mailto:it@heroinsuranceusa.com" style="color:#06a3b6;">it@heroinsuranceusa.com</a></p>'
              + '</div>'
              + '<div style="padding:12px 40px;background:#f0f4f8;text-align:center;"><p style="margin:0;font-size:10px;color:#aaa;">CONFIDENTIALITY NOTICE · Hero Insurance USA · IT Department</p></div>'
              + '</div></div>';
            await sendResend(env, {
              from: 'Hero IT · Solicitudes <it@heroinsuranceusa.com>',
              to:   [sol.solicitanteEmail],
              subject: 'Tu solicitud de ' + tipoLabel + ' fue autorizada — Ref. ' + id,
              html: ackAutHtml,
              text: 'Tu solicitud de ' + tipoLabel + ' para ' + persona + ' fue autorizada por ' + nombreAut + '.\n\n'
                  + 'IT procederá con el proceso en breve; recibirás una confirmación final cuando esté completa.\n\n'
                  + 'Referencia: ' + id + '\nDudas: it@heroinsuranceusa.com',
            }, { event: 'autorizar_notif_solicitante', id, solicitante: sol.solicitanteEmail });
          } catch (notifErr) {
            logError('autorizar_notif_solicitante_failed', notifErr, { id });
          }
        }

        return htmlResponse(buildAuthorizePage({
          titulo: 'Solicitud autorizada', icono: '✓', color: heroCyan,
          mensaje: '¡Gracias, <strong>' + esc(nombreAut) + '</strong>! IT recibió la notificación y procederá con la solicitud.',
          detalle: detalleBase
        }), 200, cors);
      } catch (err) {
        logError('autorizar_failed', err, { path });
        return htmlResponse(buildAuthorizePage({
          titulo: 'Error', icono: '⚠️', color: heroRed,
          mensaje: 'Ocurrió un error al procesar la autorización. Si el problema persiste, contacta a IT.'
        }), 500, cors);
      }
    }

    // ── POST /solicitud-cuenta (y alias /alta-agente) ─────────
    // Acepta solicitudes de ALTA y BAJA de cuentas corporativas.
    // tipoSolicitud: 'alta' (default) o 'baja'.
    // tipoPersona:   'agente' (default) o 'empleado' — sólo empleado requiere cargo/area.
    if (request.method === 'POST' && (path === '/solicitud-cuenta' || path === '/alta-agente')) {
      if (bodyTooLarge(request)) return json({ error: 'Body demasiado grande' }, 413, cors);
      const ip = clientIp(request);
      // 5/min: una solicitud de alta/baja real es rara; cualquiera con esa
      // tasa probablemente está probando o spameando a los 3 autorizadores.
      if (!(await rateLimit(env, 'solicitud-cuenta', ip, 5, 60))) {
        logEvent('rate_limited', { scope: 'solicitud-cuenta', ip });
        return json({ error: 'Demasiadas solicitudes. Espera un minuto.' }, 429, cors);
      }
      return dedupByBody(request, env, async () => {
      try {
        const body = await request.json();
        const tipoSolicitud = body.tipoSolicitud === 'baja' ? 'baja' : 'alta';
        const tipoPersona   = body.tipoPersona === 'empleado' ? 'empleado' : 'agente';
        const fechaRequerida = body.fechaRequerida || null;

        const solicitanteNombre = body.solicitanteNombre || 'No especificado';
        const solicitanteEmail  = body.solicitanteEmail  || null;

        let solicitud, subject, bloqueHtml, textoPlano;

        if (tipoSolicitud === 'alta') {
          const nombre   = body.nombre;
          const apellido = body.apellido;
          // Acepta correoPersonal (nuevo) o correo (back-compat)
          const correoPersonal = body.correoPersonal || body.correo;
          const telefono = body.telefono;
          const cargo    = body.cargo || '';
          const area     = body.area  || '';
          if (!nombre || !apellido || !correoPersonal || !telefono)
            return json({ error: 'Faltan campos requeridos (alta): nombre, apellido, correoPersonal, telefono' }, 400, cors);
          if (tipoPersona === 'empleado' && (!cargo || !area))
            return json({ error: 'Faltan campos requeridos (alta empleado): cargo, area' }, 400, cors);

          const id = 'alta_' + Date.now();
          solicitud = {
            id, tipoSolicitud: 'alta', tipoPersona, fechaRequerida,
            nombre, apellido, correoPersonal, telefono, cargo, area,
            // back-compat: algunos lectores antiguos esperan `correo`
            correo: correoPersonal,
            solicitanteNombre, solicitanteEmail,
            fecha: new Date().toISOString(), estado: 'pendiente'
          };
          const personaLabel = tipoPersona === 'empleado' ? 'empleado' : 'agente';
          subject = '[ALTA] Solicitud de alta de cuenta (' + personaLabel + '): ' + nombre + ' ' + apellido;
          bloqueHtml =
              '<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#06a3b6;text-transform:uppercase;">' + esc(personaLabel) + ' a dar de alta</p>'
            + '<p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#1a202c;">' + esc(nombre) + ' ' + esc(apellido) + '</p>'
            + (cargo ? '<p style="margin:0 0 4px;font-size:13px;color:#4a5568;"><strong>Cargo:</strong> ' + esc(cargo) + '</p>' : '')
            + (area  ? '<p style="margin:0 0 4px;font-size:13px;color:#4a5568;"><strong>Área:</strong> '  + esc(area)  + '</p>' : '')
            + '<p style="margin:0 0 10px;font-size:13px;color:#4a5568;"><strong>Correo personal:</strong> <span style="font-family:monospace;color:#06a3b6;">' + esc(correoPersonal) + '</span></p>'
            + '<p style="margin:0 0 4px;font-size:13px;color:#4a5568;"><strong>Teléfono:</strong> ' + esc(telefono) + '</p>'
            + (fechaRequerida ? '<p style="margin:0;font-size:13px;color:#4a5568;"><strong>Fecha requerida:</strong> ' + esc(fechaRequerida) + '</p>' : '');
          textoPlano = 'Solicitud de ALTA (' + personaLabel + '): ' + nombre + ' ' + apellido
            + (cargo ? '\nCargo: ' + cargo : '')
            + (area  ? '\nArea: '  + area  : '')
            + '\nCorreo personal: ' + correoPersonal
            + '\nTelefono: ' + telefono
            + (fechaRequerida ? '\nFecha requerida: ' + fechaRequerida : '')
            + '\nSolicitado por: ' + solicitanteNombre + (solicitanteEmail ? ' <' + solicitanteEmail + '>' : '');
        } else {
          // baja
          const nombre = body.nombre;
          let correoEliminar = (body.correoEliminar || '').trim();
          const motivo = body.motivo;
          if (!nombre || !correoEliminar || !motivo)
            return json({ error: 'Faltan campos requeridos (baja): nombre, correoEliminar, motivo' }, 400, cors);
          if (correoEliminar.indexOf('@') === -1) correoEliminar = correoEliminar + '@heroinsuranceusa.com';
          const cargo   = body.cargo   || '';
          const area    = body.area    || '';
          const detalle = body.detalle || '';

          const id = 'alta_' + Date.now();
          solicitud = {
            id, tipoSolicitud: 'baja', tipoPersona, fechaRequerida,
            nombre, correoEliminar, motivo, cargo, area, detalle,
            solicitanteNombre, solicitanteEmail,
            fecha: new Date().toISOString(), estado: 'pendiente'
          };
          const personaLabel = tipoPersona === 'empleado' ? 'empleado' : 'agente';
          subject = '[BAJA] Solicitud de baja de cuenta (' + personaLabel + '): ' + nombre;
          bloqueHtml =
              '<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#c0392b;text-transform:uppercase;">Cuenta a dar de baja (' + esc(personaLabel) + ')</p>'
            + '<p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#1a202c;">' + esc(nombre) + '</p>'
            + '<p style="margin:0 0 10px;font-size:13px;color:#4a5568;"><strong>Correo a eliminar:</strong> <span style="font-family:monospace;color:#c0392b;">' + esc(correoEliminar) + '</span></p>'
            + (cargo ? '<p style="margin:0 0 4px;font-size:13px;color:#4a5568;"><strong>Cargo:</strong> ' + esc(cargo) + '</p>' : '')
            + (area  ? '<p style="margin:0 0 4px;font-size:13px;color:#4a5568;"><strong>Área:</strong> '  + esc(area)  + '</p>' : '')
            + (fechaRequerida ? '<p style="margin:0 0 10px;font-size:13px;color:#4a5568;"><strong>Fecha requerida:</strong> ' + esc(fechaRequerida) + '</p>' : '')
            + '<div style="background:#fdedec;border-left:3px solid #c0392b;padding:12px 14px;border-radius:6px;margin:12px 0 0;">'
            +   '<p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:2px;color:#c0392b;text-transform:uppercase;">Motivo</p>'
            +   '<p style="margin:0;font-size:13px;color:#444;line-height:1.6;">' + esc(motivo).split('\n').join('<br/>') + '</p>'
            + '</div>'
            + (detalle
                ? '<p style="margin:12px 0 0;font-size:13px;color:#4a5568;line-height:1.6;"><strong>Detalle:</strong> ' + esc(detalle).split('\n').join('<br/>') + '</p>'
                : '');
          textoPlano = 'Solicitud de BAJA (' + personaLabel + '): ' + nombre + ' (' + correoEliminar + ')'
            + '\nMotivo: ' + motivo
            + (cargo   ? '\nCargo: '   + cargo   : '')
            + (area    ? '\nArea: '    + area    : '')
            + (detalle ? '\nDetalle: ' + detalle : '')
            + (fechaRequerida ? '\nFecha requerida: ' + fechaRequerida : '')
            + '\nSolicitado por: ' + solicitanteNombre + (solicitanteEmail ? ' <' + solicitanteEmail + '>' : '');
        }

        await env.HERO_KV.put(solicitud.id, JSON.stringify(solicitud), { metadata: summarizeSolicitud(solicitud) });
        await invalidateCaches(env, 'cache_solicitudes_list', 'cache_stats');

        // Cada autorizador recibe un correo personalizado con su propio link firmado (HMAC).
        // Cuando el primero hace click, la solicitud queda como autorizada; los demás
        // ven una página "ya autorizada por X" al clickar.
        const AUTHORIZERS = await getAuthorizerList(env);
        const isAlta     = tipoSolicitud === 'alta';
        const badgeText  = isAlta ? 'ALTA' : 'BAJA';
        const headerGrad = isAlta
          ? 'linear-gradient(135deg,#06a3b6,#048395)'
          : 'linear-gradient(135deg,#c0392b,#a52917)';
        const btnColor   = isAlta ? '#06a3b6' : '#c0392b';
        const workerBase = url.origin;

        const buildEmailFor = (auth, link) =>
            '<div style="font-family:Trebuchet MS,Arial,sans-serif;max-width:620px;background:#f0f4f8;padding:32px 16px;">'
          + '<div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">'
          + '<div style="background:' + headerGrad + ';padding:28px 40px;text-align:center;">'
          +   '<img src="https://i.ibb.co/Gr4mzLv/Nuevo-Logo-Cuadrado-compress.png" width="120" style="display:block;margin:0 auto 14px;"/>'
          +   '<div style="display:inline-block;background:rgba(255,255,255,0.2);color:#fff;font-weight:700;font-size:11px;letter-spacing:3px;padding:5px 14px;border-radius:20px;margin-bottom:10px;">' + badgeText + '</div>'
          +   '<h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">Nueva solicitud de ' + (isAlta ? 'alta' : 'baja') + ' de cuenta</h1>'
          +   '<p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">Procedimiento PROC-IT-001</p>'
          + '</div>'
          + '<div style="padding:28px 40px;">'
          +   '<p style="margin:0 0 16px;font-size:13px;color:#4a5568;">Hola <strong>' + esc(auth.nombre) + '</strong>,</p>'
          +   '<div style="background:#f7faff;border-radius:10px;border:1px solid #d8e1ea;padding:18px;margin:0 0 18px;">'
          +     bloqueHtml
          +   '</div>'
          +   '<div style="background:#f0f4f8;border-radius:10px;padding:14px 16px;margin:0 0 22px;">'
          +     '<p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:2px;color:#777;text-transform:uppercase;">Solicitado por</p>'
          +     '<p style="margin:0;font-size:13px;color:#1a202c;">' + esc(solicitanteNombre)
          +       (solicitanteEmail ? ' <span style="color:#06a3b6;font-family:monospace;">&lt;' + esc(solicitanteEmail) + '&gt;</span>' : '')
          +     '</p>'
          +   '</div>'
          +   '<div style="text-align:center;margin:0 0 22px;">'
          +     '<a href="' + link + '" style="display:inline-block;background:' + btnColor + ';color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:14px 32px;border-radius:30px;letter-spacing:0.5px;box-shadow:0 4px 14px rgba(0,0,0,0.15);">✓ Autorizar solicitud</a>'
          +     '<p style="margin:10px 0 0;font-size:11px;color:#999;">Basta con que <strong>uno</strong> de los autorizadores haga click.</p>'
          +   '</div>'
          +   '<p style="font-size:12px;color:#999;line-height:1.6;margin:0;text-align:center;">Si el botón no funciona, copia este enlace en tu navegador:<br/><span style="font-family:monospace;font-size:11px;color:#06a3b6;word-break:break-all;">' + link + '</span></p>'
          + '</div>'
          + '<div style="padding:12px 40px;background:#f0f4f8;text-align:center;"><p style="margin:0;font-size:10px;color:#aaa;">CONFIDENTIALITY NOTICE · Hero Insurance USA · IT Department</p></div>'
          + '</div></div>';

        // Genera y envía un email por autorizador en paralelo. No bloqueamos
        // el response del Worker si Resend tarda — usamos waitUntil-like await
        // pero capturamos errores individuales para no fallar todo.
        // Los links expiran a los 7 días. Después de eso, hay que reenviar
        // la solicitud desde el Console. Esto evita que un email reenviado /
        // archivado siga siendo válido indefinidamente.
        const linkExp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
        const sends = AUTHORIZERS.map(async auth => {
          let link;
          try {
            const sig = await signAuth(env, solicitud.id, auth.email, linkExp);
            link = workerBase + '/solicitud-cuenta/autorizar'
              + '?id=' + encodeURIComponent(solicitud.id)
              + '&by=' + encodeURIComponent(auth.email)
              + '&exp=' + linkExp
              + '&sig=' + encodeURIComponent(sig);
          } catch (e) {
            // Si falta el secret, mandamos un email sin botón (fallback) y dejamos rastro.
            link = '';
          }
          const html = link
            ? buildEmailFor(auth, link)
            : buildEmailFor(auth, '#').replace('✓ Autorizar solicitud', 'Autoriza desde la Hero IT Console');
          return sendResend(env, {
            from: 'Fernando Romero <it@heroinsuranceusa.com>',
            to:   [auth.email],
            subject: subject,
            html:    html,
            text:    textoPlano + '\n\nAutorizar: ' + (link || '(usa la Hero IT Console)'),
          }, { event: 'solicitud_cuenta_to_autorizador', autorizador: auth.email, id: solicitud.id });
        });
        await Promise.all(sends);

        // Email de confirmación al solicitante (Fase B).
        // Le da certeza inmediata de que el form llegó + un ID de referencia +
        // qué esperar del proceso. Va en su propio try/catch: si Resend falla
        // o el destinatario rebota, la solicitud ya está guardada y los
        // autorizadores ya fueron notificados — no bloqueamos el response.
        if (solicitanteEmail) {
          try {
            const isAltaAck = tipoSolicitud === 'alta';
            const personaFull = isAltaAck
              ? ((body.nombre || '') + ' ' + (body.apellido || '')).trim()
              : (body.nombre || '');
            const correoAck = isAltaAck
              ? (body.correoPersonal || body.correo || '')
              : (body.correoEliminar || '');
            const ackHtml =
                '<div style="font-family:Trebuchet MS,Arial,sans-serif;max-width:620px;background:#f0f4f8;padding:32px 16px;">'
              + '<div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">'
              + '<div style="background:' + headerGrad + ';padding:28px 40px;text-align:center;">'
              +   '<img src="https://i.ibb.co/Gr4mzLv/Nuevo-Logo-Cuadrado-compress.png" width="120" style="display:block;margin:0 auto 14px;"/>'
              +   '<div style="display:inline-block;background:rgba(255,255,255,0.2);color:#fff;font-weight:700;font-size:11px;letter-spacing:3px;padding:5px 14px;border-radius:20px;margin-bottom:10px;">' + badgeText + '</div>'
              +   '<h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">Recibimos tu solicitud</h1>'
              +   '<p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">Procedimiento PROC-IT-001</p>'
              + '</div>'
              + '<div style="padding:28px 40px;">'
              +   '<p style="margin:0 0 18px;font-size:14px;color:#4a5568;">Hola <strong>' + esc(solicitanteNombre) + '</strong>, tu solicitud fue recibida correctamente y está en proceso de autorización.</p>'
              +   '<div style="background:#f7faff;border-radius:10px;border:1px solid #d8e1ea;padding:18px;margin:0 0 22px;">'
              +     '<p style="margin:0 0 6px;font-size:10px;font-weight:700;letter-spacing:2px;color:#06a3b6;text-transform:uppercase;">Referencia · ' + esc(solicitud.id) + '</p>'
              +     '<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#777;text-transform:uppercase;">Tipo</p>'
              +     '<p style="margin:0 0 10px;font-size:14px;color:#1a202c;">' + esc(tipoLabel.toUpperCase()) + ' · ' + esc(tipoPersona === 'empleado' ? 'empleado' : 'agente') + '</p>'
              +     (personaFull ? '<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#777;text-transform:uppercase;">Persona</p><p style="margin:0 0 10px;font-size:14px;color:#1a202c;">' + esc(personaFull) + '</p>' : '')
              +     (correoAck ? '<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#777;text-transform:uppercase;">' + (isAltaAck ? 'Correo personal' : 'Correo a desactivar') + '</p><p style="margin:0 0 10px;font-family:monospace;font-size:13px;color:#06a3b6;">' + esc(correoAck) + '</p>' : '')
              +     (fechaRequerida ? '<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#777;text-transform:uppercase;">Fecha requerida</p><p style="margin:0;font-size:14px;color:#1a202c;">' + esc(fechaRequerida) + '</p>' : '')
              +   '</div>'
              +   '<p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:2.5px;color:#06a3b6;text-transform:uppercase;">Qué sigue</p>'
              +   '<ol style="margin:0 0 22px;padding:0 0 0 20px;font-size:13px;color:#4a5568;line-height:1.7;">'
              +     '<li>Los <strong>autorizadores</strong> (dirección) reciben tu solicitud por email. Basta con que uno la apruebe.</li>'
              +     '<li>Cuando se autoriza, el equipo de IT es notificado y procede con el ' + (isAltaAck ? 'alta' : 'baja') + '.</li>'
              +     '<li>Al completarse, ' + (isAltaAck ? 'las credenciales llegan al correo personal indicado y ' : '') + 'te enviamos una confirmación final.</li>'
              +   '</ol>'
              +   '<p style="margin:0;font-size:12px;color:#999;line-height:1.5;">Si tienes dudas o quieres cancelar la solicitud, contacta al equipo de IT: <a href="mailto:it@heroinsuranceusa.com" style="color:#06a3b6;">it@heroinsuranceusa.com</a></p>'
              + '</div>'
              + '<div style="padding:12px 40px;background:#f0f4f8;text-align:center;"><p style="margin:0;font-size:10px;color:#aaa;">CONFIDENTIALITY NOTICE · Hero Insurance USA · IT Department</p></div>'
              + '</div></div>';
            const ackText = 'Recibimos tu solicitud de ' + tipoLabel + '.\n\n'
              + 'Referencia: ' + solicitud.id + '\n'
              + 'Tipo: ' + tipoLabel.toUpperCase() + ' (' + tipoPersona + ')\n'
              + (personaFull ? 'Persona: ' + personaFull + '\n' : '')
              + (correoAck ? (isAltaAck ? 'Correo personal: ' : 'Correo a desactivar: ') + correoAck + '\n' : '')
              + (fechaRequerida ? 'Fecha requerida: ' + fechaRequerida + '\n' : '')
              + '\nQué sigue:\n'
              + '1. Los autorizadores reciben tu solicitud por email.\n'
              + '2. Cuando se autoriza, IT procede con el ' + (isAltaAck ? 'alta' : 'baja') + '.\n'
              + '3. Al completarse, te enviamos una confirmación final.\n'
              + '\nDudas: it@heroinsuranceusa.com';
            await sendResend(env, {
              from: 'Hero IT · Solicitudes <it@heroinsuranceusa.com>',
              to:   [solicitanteEmail],
              subject: 'Recibimos tu solicitud de ' + tipoLabel + ' — Ref. ' + solicitud.id,
              html: ackHtml,
              text: ackText,
            }, { event: 'solicitud_cuenta_ack_solicitante', id: solicitud.id, solicitante: solicitanteEmail });
          } catch (ackErr) {
            // No propagamos el error: la solicitud ya está creada y los
            // autorizadores ya recibieron el email — el ack al solicitante
            // es un extra, no crítico.
            logError('solicitud_cuenta_ack_failed', ackErr, { id: solicitud.id, solicitante: solicitanteEmail });
          }
        }

        return json({ ok: true, id: solicitud.id, tipoSolicitud }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
      }, 'solicitud-cuenta');
    }

    // ── POST /solicitud-cuenta/reenviar ───────────────────────
    // Reenvía los emails de autorización a los 3 autorizadores con links
    // HMAC nuevos (nuevo `exp`, 7 días adelante). Usado desde el IT Console
    // cuando los links originales expiraron o se perdieron en spam.
    // Solo procesa si la solicitud está en estado 'pendiente' — si ya fue
    // autorizada/rechazada/procesada, el reenvío no tiene sentido.
    // Auth: HERO_TOKEN heredado del gate central; rate limit propio.
    if (request.method === 'POST' && path === '/solicitud-cuenta/reenviar') {
      const ip = clientIp(request);
      if (!(await rateLimit(env, 'solicitud-reenviar', ip, 5, 60))) {
        return json({ error: 'Demasiados reenvíos. Espera un minuto.' }, 429, cors);
      }
      try {
        const { id } = await request.json();
        if (!id || !id.startsWith('alta_')) {
          return json({ error: 'ID de solicitud inválido' }, 400, cors);
        }
        const raw = await env.HERO_KV.get(id);
        if (!raw) return json({ error: 'Solicitud no encontrada' }, 404, cors);
        const solicitud = JSON.parse(raw);
        if (solicitud.estado !== 'pendiente') {
          return json({
            error: 'Solo se pueden reenviar solicitudes pendientes (estado actual: ' + solicitud.estado + ')'
          }, 409, cors);
        }

        // Reconstruye subject / bloqueHtml / textoPlano desde la solicitud
        // guardada. Duplica la lógica de POST /solicitud-cuenta original
        // para no acoplar los dos handlers vía refactor riesgoso.
        const isAlta = solicitud.tipoSolicitud === 'alta';
        const tipoPersona = solicitud.tipoPersona || 'agente';
        const personaLabel = tipoPersona === 'empleado' ? 'empleado' : 'agente';
        const solicitanteNombre = solicitud.solicitanteNombre || 'No especificado';
        const solicitanteEmail  = solicitud.solicitanteEmail || null;
        const fechaRequerida    = solicitud.fechaRequerida || null;

        let subject, bloqueHtml, textoPlano;
        if (isAlta) {
          const { nombre = '', apellido = '', correoPersonal, correo, telefono = '', cargo = '', area = '' } = solicitud;
          const correoPers = correoPersonal || correo || '';
          subject = '[ALTA · Reenvío] Solicitud de alta de cuenta (' + personaLabel + '): ' + nombre + ' ' + apellido;
          bloqueHtml =
              '<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#06a3b6;text-transform:uppercase;">' + esc(personaLabel) + ' a dar de alta</p>'
            + '<p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#1a202c;">' + esc(nombre) + ' ' + esc(apellido) + '</p>'
            + (cargo ? '<p style="margin:0 0 4px;font-size:13px;color:#4a5568;"><strong>Cargo:</strong> ' + esc(cargo) + '</p>' : '')
            + (area  ? '<p style="margin:0 0 4px;font-size:13px;color:#4a5568;"><strong>Área:</strong> '  + esc(area)  + '</p>' : '')
            + '<p style="margin:0 0 10px;font-size:13px;color:#4a5568;"><strong>Correo personal:</strong> <span style="font-family:monospace;color:#06a3b6;">' + esc(correoPers) + '</span></p>'
            + '<p style="margin:0 0 4px;font-size:13px;color:#4a5568;"><strong>Teléfono:</strong> ' + esc(telefono) + '</p>'
            + (fechaRequerida ? '<p style="margin:0;font-size:13px;color:#4a5568;"><strong>Fecha requerida:</strong> ' + esc(fechaRequerida) + '</p>' : '');
          textoPlano = '[REENVÍO] Solicitud de ALTA (' + personaLabel + '): ' + nombre + ' ' + apellido
            + (cargo ? '\nCargo: ' + cargo : '')
            + (area  ? '\nArea: '  + area  : '')
            + '\nCorreo personal: ' + correoPers
            + '\nTelefono: ' + telefono
            + (fechaRequerida ? '\nFecha requerida: ' + fechaRequerida : '')
            + '\nSolicitado por: ' + solicitanteNombre + (solicitanteEmail ? ' <' + solicitanteEmail + '>' : '');
        } else {
          const { nombre = '', correoEliminar = '', motivo = '', cargo = '', area = '', detalle = '' } = solicitud;
          subject = '[BAJA · Reenvío] Solicitud de baja de cuenta (' + personaLabel + '): ' + nombre;
          bloqueHtml =
              '<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#c0392b;text-transform:uppercase;">Cuenta a dar de baja (' + esc(personaLabel) + ')</p>'
            + '<p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#1a202c;">' + esc(nombre) + '</p>'
            + '<p style="margin:0 0 10px;font-size:13px;color:#4a5568;"><strong>Correo a eliminar:</strong> <span style="font-family:monospace;color:#c0392b;">' + esc(correoEliminar) + '</span></p>'
            + (cargo ? '<p style="margin:0 0 4px;font-size:13px;color:#4a5568;"><strong>Cargo:</strong> ' + esc(cargo) + '</p>' : '')
            + (area  ? '<p style="margin:0 0 4px;font-size:13px;color:#4a5568;"><strong>Área:</strong> '  + esc(area)  + '</p>' : '')
            + (fechaRequerida ? '<p style="margin:0 0 10px;font-size:13px;color:#4a5568;"><strong>Fecha requerida:</strong> ' + esc(fechaRequerida) + '</p>' : '')
            + '<div style="background:#fdedec;border-left:3px solid #c0392b;padding:12px 14px;border-radius:6px;margin:12px 0 0;">'
            +   '<p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:2px;color:#c0392b;text-transform:uppercase;">Motivo</p>'
            +   '<p style="margin:0;font-size:13px;color:#444;line-height:1.6;">' + esc(motivo).split('\n').join('<br/>') + '</p>'
            + '</div>'
            + (detalle
                ? '<p style="margin:12px 0 0;font-size:13px;color:#4a5568;line-height:1.6;"><strong>Detalle:</strong> ' + esc(detalle).split('\n').join('<br/>') + '</p>'
                : '');
          textoPlano = '[REENVÍO] Solicitud de BAJA (' + personaLabel + '): ' + nombre + ' (' + correoEliminar + ')'
            + '\nMotivo: ' + motivo
            + (cargo   ? '\nCargo: '   + cargo   : '')
            + (area    ? '\nArea: '    + area    : '')
            + (detalle ? '\nDetalle: ' + detalle : '')
            + (fechaRequerida ? '\nFecha requerida: ' + fechaRequerida : '')
            + '\nSolicitado por: ' + solicitanteNombre + (solicitanteEmail ? ' <' + solicitanteEmail + '>' : '');
        }

        const AUTHORIZERS = await getAuthorizerList(env);
        const badgeText  = isAlta ? 'ALTA' : 'BAJA';
        const headerGrad = isAlta
          ? 'linear-gradient(135deg,#06a3b6,#048395)'
          : 'linear-gradient(135deg,#c0392b,#a52917)';
        const btnColor = isAlta ? '#06a3b6' : '#c0392b';
        const workerBase = url.origin;

        // Banner "REENVÍO" adicional en el email para que el autorizador
        // sepa que es la 2da (o Nth) vez que llega — no un duplicado por bug.
        const buildEmailFor = (auth, link) =>
            '<div style="font-family:Trebuchet MS,Arial,sans-serif;max-width:620px;background:#f0f4f8;padding:32px 16px;">'
          + '<div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">'
          + '<div style="background:' + headerGrad + ';padding:28px 40px;text-align:center;">'
          +   '<img src="https://i.ibb.co/Gr4mzLv/Nuevo-Logo-Cuadrado-compress.png" width="120" style="display:block;margin:0 auto 14px;"/>'
          +   '<div style="display:inline-block;background:rgba(255,255,255,0.2);color:#fff;font-weight:700;font-size:11px;letter-spacing:3px;padding:5px 14px;border-radius:20px;margin-bottom:10px;">' + badgeText + ' · REENVÍO</div>'
          +   '<h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">Recordatorio: solicitud de ' + (isAlta ? 'alta' : 'baja') + ' de cuenta</h1>'
          +   '<p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">Procedimiento PROC-IT-001</p>'
          + '</div>'
          + '<div style="padding:28px 40px;">'
          +   '<div style="background:rgba(232,163,23,0.10);border-left:3px solid #e8a317;padding:12px 14px;border-radius:6px;margin:0 0 18px;">'
          +     '<p style="margin:0;font-size:13px;color:#8a5f0f;line-height:1.5;">Esta solicitud sigue <strong>pendiente</strong> de tu autorización. Los links anteriores pueden haber expirado — este link es nuevo y tiene 7 días de validez.</p>'
          +   '</div>'
          +   '<p style="margin:0 0 16px;font-size:13px;color:#4a5568;">Hola <strong>' + esc(auth.nombre) + '</strong>,</p>'
          +   '<div style="background:#f7faff;border-radius:10px;border:1px solid #d8e1ea;padding:18px;margin:0 0 18px;">'
          +     bloqueHtml
          +   '</div>'
          +   '<div style="background:#f0f4f8;border-radius:10px;padding:14px 16px;margin:0 0 22px;">'
          +     '<p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:2px;color:#777;text-transform:uppercase;">Solicitado por</p>'
          +     '<p style="margin:0;font-size:13px;color:#1a202c;">' + esc(solicitanteNombre)
          +       (solicitanteEmail ? ' <span style="color:#06a3b6;font-family:monospace;">&lt;' + esc(solicitanteEmail) + '&gt;</span>' : '')
          +     '</p>'
          +   '</div>'
          +   '<div style="text-align:center;margin:0 0 22px;">'
          +     '<a href="' + link + '" style="display:inline-block;background:' + btnColor + ';color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:14px 32px;border-radius:30px;letter-spacing:0.5px;box-shadow:0 4px 14px rgba(0,0,0,0.15);">✓ Autorizar solicitud</a>'
          +     '<p style="margin:10px 0 0;font-size:11px;color:#999;">Basta con que <strong>uno</strong> de los autorizadores haga click.</p>'
          +   '</div>'
          +   '<p style="font-size:12px;color:#999;line-height:1.6;margin:0;text-align:center;">Si el botón no funciona, copia este enlace en tu navegador:<br/><span style="font-family:monospace;font-size:11px;color:#06a3b6;word-break:break-all;">' + link + '</span></p>'
          + '</div>'
          + '<div style="padding:12px 40px;background:#f0f4f8;text-align:center;"><p style="margin:0;font-size:10px;color:#aaa;">CONFIDENTIALITY NOTICE · Hero Insurance USA · IT Department</p></div>'
          + '</div></div>';

        const linkExp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
        const sends = AUTHORIZERS.map(async auth => {
          let link;
          try {
            const sig = await signAuth(env, solicitud.id, auth.email, linkExp);
            link = workerBase + '/solicitud-cuenta/autorizar'
              + '?id=' + encodeURIComponent(solicitud.id)
              + '&by=' + encodeURIComponent(auth.email)
              + '&exp=' + linkExp
              + '&sig=' + encodeURIComponent(sig);
          } catch (e) {
            link = '';
          }
          const html = link
            ? buildEmailFor(auth, link)
            : buildEmailFor(auth, '#').replace('✓ Autorizar solicitud', 'Autoriza desde la Hero IT Console');
          return sendResend(env, {
            from: 'Fernando Romero <it@heroinsuranceusa.com>',
            to:   [auth.email],
            subject: subject,
            html:    html,
            text:    textoPlano + '\n\nAutorizar: ' + (link || '(usa la Hero IT Console)'),
          }, { event: 'solicitud_cuenta_reenviada_autorizador', autorizador: auth.email, id: solicitud.id });
        });
        await Promise.all(sends);

        // Marcar en el KV que hubo un reenvío + cuándo expira el nuevo link,
        // para poder mostrarlo en el Console y auditar.
        solicitud.reenviosCount = (solicitud.reenviosCount || 0) + 1;
        solicitud.ultimoReenvio = new Date().toISOString();
        solicitud.linkExpiresAt = new Date(linkExp * 1000).toISOString();
        await env.HERO_KV.put(solicitud.id, JSON.stringify(solicitud), { metadata: summarizeSolicitud(solicitud) });
        await invalidateCaches(env, 'cache_solicitudes_list', 'cache_stats');

        return json({
          ok: true,
          id: solicitud.id,
          autorizadores: AUTHORIZERS.length,
          expiraEn: solicitud.linkExpiresAt,
        }, 200, cors);
      } catch (err) {
        logError('solicitud_reenviar_failed', err, { path });
        return json({ error: 'Error interno del servidor' }, 500, cors);
      }
    }

    // ── GET /alta-agente ──────────────────────────────────────
    if (request.method === 'GET' && path === '/alta-agente') {
      try {
        const hasCursor = url.searchParams.get('cursor') != null;
        const data = await withListCache(env, 'cache_solicitudes_list', 60, hasCursor, async () => {
          const list = await env.HERO_KV.list({ prefix: 'alta_', ...paginationParams(url) });
          const items = await Promise.all(list.keys.map(async k => {
            const v = await env.HERO_KV.get(k.name); return v ? JSON.parse(v) : null;
          }));
          return {
            solicitudes: items.filter(Boolean).sort((a, b) => new Date(b.fecha) - new Date(a.fecha)),
            ...listMeta(list)
          };
        });
        return json(data, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── POST /alta-agente/resolver ────────────────────────────
    // Marca una solicitud como 'procesada' o 'rechazada'. Acepta opcionalmente
    // `motivo` (incluido en la notificación al solicitante si es rechazo) y
    // `skipSolicitanteNotif` (usado por crearUsuarioDesdeModal en el Hub para
    // evitar duplicar el email — /create-user ya notifica al solicitante en
    // el caso de altas procesadas).
    if (request.method === 'POST' && path === '/alta-agente/resolver') {
      try {
        const { id, estado, motivo, skipSolicitanteNotif } = await request.json();
        const val = await env.HERO_KV.get(id);
        if (!val) return json({ error: 'No encontrada' }, 404, cors);
        const item = JSON.parse(val);
        const nuevoEstado = estado || 'procesada';
        item.estado = nuevoEstado;
        if (nuevoEstado === 'rechazada' && motivo) item.motivoRechazo = motivo;
        if (nuevoEstado === 'rechazada') item.fechaRechazo = new Date().toISOString();
        if (nuevoEstado === 'procesada') item.fechaProcesada = new Date().toISOString();
        await env.HERO_KV.put(id, JSON.stringify(item), { metadata: summarizeSolicitud(item) });
        await invalidateCaches(env, 'cache_solicitudes_list', 'cache_stats');

        // Fase C — Notificación al solicitante del cambio de estado.
        // En try/catch: si Resend falla, el estado ya está guardado en KV y no
        // revertimos por un email. skipSolicitanteNotif se usa cuando otro
        // handler (ej. /create-user) ya se encargó de notificar.
        if (item.solicitanteEmail && !skipSolicitanteNotif && (nuevoEstado === 'procesada' || nuevoEstado === 'rechazada')) {
          try {
            const isAltaRes  = item.tipoSolicitud !== 'baja';
            const tipoLabelRes = isAltaRes ? 'alta' : 'baja';
            const personaRes = isAltaRes
              ? ((item.nombre || '') + ' ' + (item.apellido || '')).trim()
              : (item.nombre || '');
            const correoRes = isAltaRes
              ? (item.correoPersonal || item.correo || '')
              : (item.correoEliminar || '');
            const esRechazo = nuevoEstado === 'rechazada';
            const headerGradRes = esRechazo
              ? 'linear-gradient(135deg,#c0392b,#a52917)'
              : 'linear-gradient(135deg,#22a06b,#0f8054)';
            const badgeTextRes = esRechazo ? 'RECHAZADA' : 'PROCESADA';
            const tituloRes = esRechazo ? 'Tu solicitud fue rechazada' : 'Tu solicitud fue procesada';
            const cuerpoRes = esRechazo
              ? 'tu solicitud de ' + tipoLabelRes + ' para <strong>' + esc(personaRes) + '</strong> no pudo ser procesada.'
              : (isAltaRes
                  ? 'la cuenta corporativa de <strong>' + esc(personaRes) + '</strong> fue creada en Google Workspace. Las credenciales iniciales ya fueron enviadas al correo personal indicado.'
                  : 'la cuenta <strong>' + esc(correoRes) + '</strong> fue suspendida en Google Workspace.');
            const motivoBlock = (esRechazo && motivo)
              ? '<div style="background:#fdedec;border-left:3px solid #c0392b;padding:12px 14px;border-radius:6px;margin:12px 0;">'
                + '<p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:2px;color:#c0392b;text-transform:uppercase;">Motivo</p>'
                + '<p style="margin:0;font-size:13px;color:#444;line-height:1.6;">' + esc(motivo).split('\n').join('<br/>') + '</p>'
                + '</div>'
              : '';
            const resHtml =
                '<div style="font-family:Trebuchet MS,Arial,sans-serif;max-width:620px;background:#f0f4f8;padding:32px 16px;">'
              + '<div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">'
              + '<div style="background:' + headerGradRes + ';padding:28px 40px;text-align:center;">'
              +   '<img src="https://i.ibb.co/Gr4mzLv/Nuevo-Logo-Cuadrado-compress.png" width="120" style="display:block;margin:0 auto 14px;"/>'
              +   '<div style="display:inline-block;background:rgba(255,255,255,0.2);color:#fff;font-weight:700;font-size:11px;letter-spacing:3px;padding:5px 14px;border-radius:20px;margin-bottom:10px;">' + badgeTextRes + '</div>'
              +   '<h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">' + tituloRes + '</h1>'
              + '</div>'
              + '<div style="padding:28px 40px;">'
              +   '<p style="margin:0 0 18px;font-size:14px;color:#4a5568;">Hola <strong>' + esc(item.solicitanteNombre || '') + '</strong>, ' + cuerpoRes + '</p>'
              +   motivoBlock
              +   '<div style="background:#f7faff;border-radius:10px;border:1px solid #d8e1ea;padding:14px 16px;margin:0 0 22px;">'
              +     '<p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:2px;color:#06a3b6;text-transform:uppercase;">Referencia</p>'
              +     '<p style="margin:0;font-family:monospace;font-size:13px;color:#06a3b6;">' + esc(id) + '</p>'
              +   '</div>'
              +   '<p style="margin:0;font-size:12px;color:#999;line-height:1.5;">' + (esRechazo ? 'Si crees que es un error o quieres consultar el motivo, contacta al equipo de IT.' : 'Si tienes dudas, contacta al equipo de IT.') + ' <a href="mailto:it@heroinsuranceusa.com" style="color:#06a3b6;">it@heroinsuranceusa.com</a></p>'
              + '</div>'
              + '<div style="padding:12px 40px;background:#f0f4f8;text-align:center;"><p style="margin:0;font-size:10px;color:#aaa;">CONFIDENTIALITY NOTICE · Hero Insurance USA · IT Department</p></div>'
              + '</div></div>';
            const resText = tituloRes + '\n\n'
              + 'Hola ' + (item.solicitanteNombre || '') + ',\n'
              + (esRechazo
                  ? 'Tu solicitud de ' + tipoLabelRes + ' para ' + personaRes + ' no pudo ser procesada.'
                  : (isAltaRes
                      ? 'La cuenta corporativa de ' + personaRes + ' fue creada. Las credenciales iniciales ya fueron enviadas al correo personal indicado.'
                      : 'La cuenta ' + correoRes + ' fue suspendida en Google Workspace.'))
              + (esRechazo && motivo ? '\n\nMotivo: ' + motivo : '')
              + '\n\nReferencia: ' + id
              + '\nDudas: it@heroinsuranceusa.com';
            await sendResend(env, {
              from: 'Hero IT · Solicitudes <it@heroinsuranceusa.com>',
              to:   [item.solicitanteEmail],
              subject: (esRechazo ? 'Tu solicitud de ' + tipoLabelRes + ' fue rechazada' : 'Tu solicitud de ' + tipoLabelRes + ' fue procesada') + ' — Ref. ' + id,
              html: resHtml,
              text: resText,
            }, { event: 'resolver_notif_solicitante', id, estado: nuevoEstado, solicitante: item.solicitanteEmail });
          } catch (notifErr) {
            logError('resolver_notif_solicitante_failed', notifErr, { id, estado: nuevoEstado });
          }
        }

        return json({ ok: true }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── POST /ticket — crear ticket ───────────────────────────
    if (request.method === 'POST' && path === '/ticket') {
      if (bodyTooLarge(request)) return json({ error: 'Body demasiado grande' }, 413, cors);
      const ip = clientIp(request);
      if (!(await rateLimit(env, 'ticket', ip, 10, 60))) {
        logEvent('rate_limited', { scope: 'ticket', ip });
        return json({ error: 'Demasiadas solicitudes. Espera un minuto.' }, 429, cors);
      }
      return dedupByBody(request, env, async () => {
      try {
        const { nombre, email, categoria, prioridad, asunto, descripcion } = await request.json();
        if (!nombre || !email || !categoria || !asunto || !descripcion)
          return json({ error: 'Faltan campos requeridos' }, 400, cors);

        const num = Date.now().toString().slice(-6);
        const id = 'ticket_' + Date.now();
        const ticketId = 'HIT-' + num;
        const ticket = {
          id, ticketId, nombre, email, categoria, prioridad: prioridad || 'Media',
          asunto, descripcion, estado: 'abierto',
          fecha: new Date().toISOString(), respuesta: null, fechaRespuesta: null,
        };
        await env.HERO_KV.put(id, JSON.stringify(ticket), { metadata: summarizeTicket(ticket) });
        await invalidateCaches(env, 'cache_tickets_list', 'cache_stats');

        // Colores por prioridad
        const colores = { Baja:'#22d87a', Media:'#f0b429', Alta:'#f97316', Urgente:'#f56565' };
        const color = colores[prioridad] || '#f0b429';

        // Email a IT
        await sendResend(env, {
            from: 'Hero IT Console <it@heroinsuranceusa.com>',
            to: ['it@heroinsuranceusa.com'],
            subject: '[' + ticketId + '] ' + asunto,
            html: '<div style="font-family:Arial,sans-serif;max-width:600px;">'
              + '<div style="background:linear-gradient(135deg,#06a3b6,#048395);padding:24px;border-radius:12px 12px 0 0;">'
              + '<h2 style="color:#fff;margin:0;font-size:18px;">Nuevo Ticket de Soporte</h2>'
              + '<p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:13px;">' + ticketId + '</p></div>'
              + '<div style="background:#f7faff;padding:24px;border:1px solid #e2eaf8;border-top:none;border-radius:0 0 12px 12px;">'
              + '<p><strong>De:</strong> ' + esc(nombre) + ' (' + esc(email) + ')</p>'
              + '<p><strong>Categoría:</strong> ' + esc(categoria) + '</p>'
              + '<p><strong>Prioridad:</strong> <span style="color:' + color + ';font-weight:700;">' + esc(prioridad) + '</span></p>'
              + '<p><strong>Asunto:</strong> ' + esc(asunto) + '</p>'
              + '<hr style="border:none;border-top:1px solid #e2eaf8;margin:16px 0;"/>'
              + '<p style="color:#4a5568;line-height:1.7;">' + esc(descripcion).split('\n').join('<br/>') + '</p>'
              + '</div></div>',
            text: '[' + ticketId + '] ' + asunto + '\nDe: ' + nombre + ' (' + email + ')\nCategoria: ' + categoria + '\nPrioridad: ' + prioridad + '\n\n' + descripcion,
        }, { event: 'ticket_notif_it', ticketId });

        // Email de confirmación al usuario
        await sendResend(env, {
            from: 'Fernando Romero <it@heroinsuranceusa.com>',
            to: [email],
            subject: 'Recibimos tu solicitud [' + ticketId + ']',
            html: '<div style="font-family:Arial,sans-serif;max-width:600px;background:#f0f4f8;padding:32px 16px;">'
              + '<div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.1);">'
              + '<div style="background:linear-gradient(135deg,#06a3b6,#048395);padding:32px 40px;text-align:center;">'
              + '<img src="https://i.ibb.co/Gr4mzLv/Nuevo-Logo-Cuadrado-compress.png" width="120" style="display:block;margin:0 auto 16px;"/>'
              + '<h1 style="color:#fff;margin:0;font-size:22px;font-weight:900;">Ticket recibido</h1>'
              + '<p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px;">Tu solicitud ha sido registrada correctamente.</p></div>'
              + '<div style="padding:32px 40px;">'
              + '<p style="font-size:15px;color:#2d3748;">Hola <strong>' + esc(nombre) + '</strong>, hemos recibido tu solicitud de soporte.</p>'
              + '<div style="background:#f7faff;border-radius:12px;border:1px solid #e2eaf8;padding:20px;margin:20px 0;">'
              + '<p style="margin:0 0 8px;font-size:11px;font-weight:900;letter-spacing:2px;color:#06a3b6;text-transform:uppercase;">Detalles del ticket</p>'
              + '<p style="margin:0 0 6px;font-family:monospace;font-size:16px;font-weight:700;color:#06a3b6;">' + ticketId + '</p>'
              + '<p style="margin:0 0 4px;font-size:13px;color:#4a5568;"><strong>Asunto:</strong> ' + esc(asunto) + '</p>'
              + '<p style="margin:0 0 4px;font-size:13px;color:#4a5568;"><strong>Categoría:</strong> ' + esc(categoria) + '</p>'
              + '<p style="margin:0;font-size:13px;"><strong>Prioridad:</strong> <span style="color:' + color + ';font-weight:700;">' + esc(prioridad) + '</span></p>'
              + '</div>'
              + '<p style="font-size:13px;color:#4a5568;line-height:1.6;">Nuestro equipo de IT revisará tu solicitud y te contactará pronto.</p>'
              + '</div>'
              + '<div style="padding:14px 40px;background:#f0f4f8;text-align:center;">'
              + '<p style="margin:0;font-size:10px;color:#a0aec0;">CONFIDENTIALITY NOTICE: This email is intended solely for the addressee.</p>'
              + '</div></div></div>',
            text: 'Hola ' + nombre + ', recibimos tu ticket ' + ticketId + '.\nAsunto: ' + asunto + '\nCategoria: ' + categoria + '\nPrioridad: ' + prioridad + '\nNuestro equipo te contactara pronto.',
        }, { event: 'ticket_notif_user', ticketId });

        return json({ ok: true, id, ticketId }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
      }, 'ticket');
    }

    // ── GET /ticket — listar tickets ──────────────────────────
    if (request.method === 'GET' && path === '/ticket') {
      try {
        const hasCursor = url.searchParams.get('cursor') != null;
        const data = await withListCache(env, 'cache_tickets_list', 60, hasCursor, async () => {
          const list = await env.HERO_KV.list({ prefix: 'ticket_', ...paginationParams(url) });
          const items = await Promise.all(list.keys.map(async k => {
            const v = await env.HERO_KV.get(k.name); return v ? JSON.parse(v) : null;
          }));
          return {
            tickets: items.filter(Boolean).sort((a, b) => new Date(b.fecha) - new Date(a.fecha)),
            ...listMeta(list)
          };
        });
        return json(data, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── POST /ticket/update — actualizar ticket ───────────────
    if (request.method === 'POST' && path === '/ticket/update') {
      try {
        const { id, estado, prioridad, respuesta } = await request.json();
        const val = await env.HERO_KV.get(id);
        if (!val) return json({ error: 'Ticket no encontrado' }, 404, cors);
        const ticket = JSON.parse(val);
        const estadoAnterior = ticket.estado;
        if (estado)    ticket.estado = estado;
        if (prioridad) ticket.prioridad = prioridad;
        if (!ticket.historial) ticket.historial = [];

        const estadoColores = { 'abierto':'#d64545', 'en progreso':'#e8a317', 'resuelto':'#22a06b' };
        const buildEmail = (titulo, subtitulo, bodyHtml) =>
          '<div style="font-family:Trebuchet MS,Arial,sans-serif;max-width:600px;background:#f0f4f8;padding:32px 16px;">'
          + '<div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">'
          + '<div style="background:linear-gradient(135deg,#06a3b6,#048395);padding:28px 40px;text-align:center;">'
          + '<img src="https://i.ibb.co/Gr4mzLv/Nuevo-Logo-Cuadrado-compress.png" width="120" style="display:block;margin:0 auto 14px;"/>'
          + '<h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">' + titulo + '</h1>'
          + '<p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">' + subtitulo + '</p></div>'
          + '<div style="padding:28px 40px;">' + bodyHtml + '</div>'
          + '<div style="padding:12px 40px;background:#f0f4f8;text-align:center;"><p style="margin:0;font-size:10px;color:#aaa;">CONFIDENTIALITY NOTICE · Hero Insurance USA · IT Department</p></div>'
          + '</div></div>';

        const ticketInfo = '<div style="background:#f7faff;border-radius:10px;border:1px solid #d8e1ea;padding:16px;margin:16px 0;">'
          + '<p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#06a3b6;">Ticket</p>'
          + '<p style="margin:0;font-family:monospace;font-size:15px;font-weight:700;color:#06a3b6;">' + ticket.ticketId + '</p>'
          + '<p style="margin:4px 0 0;font-size:13px;color:#444;">' + esc(ticket.asunto) + '</p></div>';

        // Notify on status change
        if (estado && estado !== estadoAnterior) {
          ticket.historial.push({ tipo: 'estado', de: estadoAnterior, a: estado, fecha: new Date().toISOString() });
          const statusMsgs = buildStatusMsgs(estado, ticket, ticketInfo);
          if (statusMsgs[estado]) {
            const msg = statusMsgs[estado];
            await sendResend(env, {
              from: 'Fernando Romero <it' + '@' + 'heroinsuranceusa.com>',
              to: [ticket.email],
              subject: '[' + ticket.ticketId + '] ' + msg.titulo,
              html: buildEmail(msg.titulo, ticket.ticketId + ' · ' + esc(ticket.asunto), msg.body),
              text: msg.titulo + ' - ' + ticket.ticketId,
            }, { event: 'ticket_status_change', ticketId: ticket.ticketId, estado });
          }
        }

        // Send reply if included
        if (respuesta) {
          ticket.respuesta = respuesta;
          ticket.fechaRespuesta = new Date().toISOString();
          ticket.historial.push({ tipo: 'respuesta', fecha: new Date().toISOString() });
          const replyBody = '<p style="font-size:14px;color:#444;">Hola <strong>' + esc(ticket.nombre) + '</strong>, el equipo IT respondió tu solicitud.</p>'
            + ticketInfo
            + '<div style="background:#f7faff;border-radius:10px;border:1px solid #d8e1ea;padding:16px;margin:16px 0;">'
            + '<p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#06a3b6;">Respuesta</p>'
            + '<p style="margin:0;font-size:13px;color:#444;line-height:1.7;">' + esc(respuesta).split('\n').join('<br/>') + '</p></div>'
            + '<p style="font-size:13px;color:#777;">Estado: <strong style="color:' + (estadoColores[ticket.estado]||'#444') + ';">' + ticket.estado + '</strong></p>';
          await sendResend(env, {
            from: 'Fernando Romero <it' + '@' + 'heroinsuranceusa.com>',
            to: [ticket.email],
            subject: 'Re: [' + ticket.ticketId + '] ' + ticket.asunto,
            html: buildEmail('Respuesta a tu ticket', ticket.ticketId + ' · ' + esc(ticket.asunto), replyBody),
            text: 'Respuesta: ' + respuesta,
          }, { event: 'ticket_reply', ticketId: ticket.ticketId });
        }
        await env.HERO_KV.put(id, JSON.stringify(ticket), { metadata: summarizeTicket(ticket) });
        await invalidateCaches(env, 'cache_tickets_list', 'cache_stats');
        return json({ ok: true }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── POST /user-action — gestionar usuario ─────────────────
    if (request.method === 'POST' && path === '/user-action') {
      try {
        const { email, action, newPassword } = await request.json();
        if (!email || !action) return json({ error: 'Faltan campos: email, action' }, 400, cors);

        const token = await getGoogleToken(env);
        const userUrl = 'https://admin.googleapis.com/admin/directory/v1/users/' + encodeURIComponent(email);

        // PROC-IT-001: solo suspender — el borrado permanente no está permitido
        // desde la Console (se hace manualmente en Google Admin si hiciera falta).
        let body = {};
        if      (action === 'reset')   body = { password: newPassword, changePasswordAtNextLogin: true };
        else if (action === 'suspend') body = { suspended: true };
        else if (action === 'restore') body = { suspended: false };
        else return json({ error: 'Acción no permitida: ' + action }, 400, cors);

        const resp = await fetch(userUrl, {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (!resp.ok) return json({ error: data.error?.message || 'Error' }, resp.status, cors);

        // Invalidar cache de /users — el estado cambió (suspendido/activo/password).
        try { await env.HERO_KV.delete('cache_users'); } catch (_) {}

        return json({ ok: true }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── POST /audit — guardar entrada ─────────────────────────
    // TTL 180 días: auditoría es el namespace de mayor crecimiento (cada acción
    // del Console escribe una entrada). Sin TTL, list() se vuelve cada vez más
    // caro. Entradas viejas pre-TTL no se purgan automáticamente.
    if (request.method === 'POST' && path === '/audit') {
      try {
        const { tipo, descripcion, detalle, usuario } = await request.json();
        if (!tipo || !descripcion) return json({ error: 'Faltan campos: tipo, descripcion' }, 400, cors);
        const id = 'audit_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
        const entrada = {
          id, tipo, descripcion,
          detalle: detalle || null,
          usuario: usuario || 'Fernando Romero',
          fecha: new Date().toISOString(),
        };
        await env.HERO_KV.put(id, JSON.stringify(entrada), {
          metadata: summarizeAudit(entrada),
          expirationTtl: 180 * 86400,
        });
        return json({ ok: true, id }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── GET /audit — listar entradas ──────────────────────────
    // Optimización: pre-filtra por metadata.tipo ANTES de hacer get() en cada
    // entrada (antes hacíamos N get()s y luego filtrábamos en memoria). El ID
    // `audit_<timestamp>_<rand>` está naturalmente ordenable: ordenamos los
    // keys por name DESC para tener los más recientes primero y limitamos el
    // fetch al tamaño que vamos a devolver.
    if (request.method === 'GET' && path === '/audit') {
      try {
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const tipo = url.searchParams.get('tipo') || '';
        const limit = parseInt(url.searchParams.get('limit') || '200', 10);
        const list = await env.HERO_KV.list({ prefix: 'audit_', ...paginationParams(url) });

        // Más nuevos primero (audit_<timestamp>_<rand> → orden lex DESC == fecha DESC)
        let keys = list.keys.slice().sort((a, b) => b.name.localeCompare(a.name));

        // Pre-filtro por metadata.tipo: las entradas legacy sin metadata pasan
        // (se filtran después con get()) para no perder históricos.
        if (tipo) {
          keys = keys.filter(k => {
            if (k.metadata && k.metadata.tipo !== undefined) return k.metadata.tipo === tipo;
            return true;
          });
        }

        // Si hay búsqueda libre `q`, traemos hasta 3x el limit para que el
        // filtro en memoria tenga material; si no, traemos solo el limit.
        const fetchCount = Math.min(keys.length, q ? limit * 3 : limit);
        const items = await Promise.all(keys.slice(0, fetchCount).map(async k => {
          const v = await env.HERO_KV.get(k.name); return v ? JSON.parse(v) : null;
        }));

        let entradas = items.filter(Boolean);
        if (tipo) entradas = entradas.filter(e => e.tipo === tipo); // redundante para legacy
        if (q)    entradas = entradas.filter(e =>
          (e.descripcion || '').toLowerCase().includes(q) ||
          (e.detalle     || '').toLowerCase().includes(q) ||
          (e.usuario     || '').toLowerCase().includes(q)
        );
        return json({ entradas: entradas.slice(0, limit), total: entradas.length, ...listMeta(list) }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

// ── POST /device — crear dispositivo ──────────────────────
    if (request.method === 'POST' && path === '/device') {
      try {
        const { nombre, tipo, usuario, so, gcpw, apps, estado,
                fechaCompra, vidaUtilAnios, costoOriginal, zohoId } = await request.json();
        if (!nombre || !tipo) return json({ error: 'Faltan campos: nombre, tipo' }, 400, cors);
        const id = 'device_' + Date.now();
        const device = {
          id, nombre, tipo,
          usuario: usuario || '',
          so: so || '',
          gcpw: gcpw || false,
          apps: apps || [],
          estado: estado || 'activo',
          fechaCompra:   fechaCompra   || null,
          vidaUtilAnios: vidaUtilAnios != null ? Number(vidaUtilAnios) : 4,
          costoOriginal: costoOriginal != null ? Number(costoOriginal) : null,
          zohoId: zohoId || null,
          fecha: new Date().toISOString(),
          intervenciones: [],
        };
        await env.HERO_KV.put(id, JSON.stringify(device), { metadata: summarizeDevice(device) });
        await invalidateCaches(env, 'cache_stats');
        return json({ ok: true, id }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── GET /device — listar dispositivos ─────────────────────
    // Si viene `?withZoho=1`, mergea: lista los devices Zoho live y para cada
    // uno busca su KV record (por zohoId o por nombre normalizado). Si no
    // existe, lo auto-crea con defaults; si existe pero sin zohoId, lo linkea.
    // Resultado: cada device de Zoho tiene siempre un id KV estable + metadata
    // (usuario, fechaCompra, intervenciones, etc.) + live data (status, ip, os).
    if (request.method === 'GET' && path === '/device') {
      try {
        const withZoho = url.searchParams.get('withZoho') === '1';
        const list = await env.HERO_KV.list({ prefix: 'device_', ...paginationParams(url) });
        const items = await Promise.all(list.keys.map(async k => {
          const v = await env.HERO_KV.get(k.name); return v ? JSON.parse(v) : null;
        }));
        const kvDevices = items.filter(Boolean);

        if (!withZoho) {
          return json({
            devices: kvDevices.sort((a, b) => new Date(b.fecha) - new Date(a.fecha)),
            ...listMeta(list)
          }, 200, cors);
        }

        // ── Merge con Zoho ───────────────────────────────────
        const fresh = url.searchParams.get('fresh') === '1';
        const { devices: zohoDevices } = await fetchZohoDevicesData(env, { fresh });
        const normName = s => (s || '').toLowerCase().trim();
        const kvByZohoId = {};
        const kvByName   = {};
        for (const d of kvDevices) {
          if (d.zohoId) kvByZohoId[d.zohoId] = d;
          if (d.nombre) kvByName[normName(d.nombre)] = d;
        }

        const merged = [];
        let kvMutated = false;
        for (const z of zohoDevices) {
          let kv = (z.id && kvByZohoId[z.id]) || kvByName[normName(z.name)];
          if (!kv) {
            // Auto-create con defaults
            const newId = 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            kv = {
              id: newId, nombre: z.name, tipo: 'laptop',
              usuario: '', so: z.os || '', gcpw: false, apps: [],
              estado: 'activo',
              fechaCompra: null, vidaUtilAnios: 4, costoOriginal: null,
              zohoId: z.id || null,
              fecha: new Date().toISOString(),
              intervenciones: [],
            };
            await env.HERO_KV.put(newId, JSON.stringify(kv), { metadata: summarizeDevice(kv) });
            kvMutated = true;
          } else if (!kv.zohoId && z.id) {
            // Auto-link existing por nombre — persistir el zohoId
            kv.zohoId = z.id;
            await env.HERO_KV.put(kv.id, JSON.stringify(kv), { metadata: summarizeDevice(kv) });
            kvMutated = true;
          }
          merged.push({
            ...kv,
            // Live data (no se persiste, viene de Zoho cada vez):
            zohoStatus: z.status || 'offline',
            zohoLiveOs: z.os || '',
            zohoIp:     z.ip   || '',
            zohoGroup:  z.group || '',
          });
        }

        // Orden: online primero, luego alfabético
        merged.sort((a, b) => {
          const aOn = (a.zohoStatus === 'online') ? 0 : 1;
          const bOn = (b.zohoStatus === 'online') ? 0 : 1;
          if (aOn !== bOn) return aOn - bOn;
          return (a.nombre || '').localeCompare(b.nombre || '');
        });

        if (kvMutated) await invalidateCaches(env, 'cache_stats');
        return json({ devices: merged }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── GET /device/:id — obtener dispositivo ─────────────────
    if (request.method === 'GET' && path.startsWith('/device/')) {
      try {
        const id = path.replace('/device/', '');
        const v = await env.HERO_KV.get(id);
        if (!v) return json({ error: 'Dispositivo no encontrado' }, 404, cors);
        return json({ device: JSON.parse(v) }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── POST /device/update — actualizar dispositivo ──────────
    if (request.method === 'POST' && path === '/device/update') {
      try {
        const { id, nombre, tipo, usuario, so, gcpw, apps, estado,
                fechaCompra, vidaUtilAnios, costoOriginal, zohoId } = await request.json();
        const v = await env.HERO_KV.get(id);
        if (!v) return json({ error: 'Dispositivo no encontrado' }, 404, cors);
        const device = JSON.parse(v);
        if (nombre !== undefined) device.nombre  = nombre;
        if (tipo    !== undefined) device.tipo    = tipo;
        if (usuario !== undefined) device.usuario = usuario;
        if (so      !== undefined) device.so      = so;
        if (gcpw    !== undefined) device.gcpw    = gcpw;
        if (apps    !== undefined) device.apps    = apps;
        if (estado  !== undefined) device.estado  = estado;
        if (fechaCompra   !== undefined) device.fechaCompra   = fechaCompra;
        if (vidaUtilAnios !== undefined) device.vidaUtilAnios = vidaUtilAnios != null ? Number(vidaUtilAnios) : null;
        if (costoOriginal !== undefined) device.costoOriginal = costoOriginal != null ? Number(costoOriginal) : null;
        if (zohoId        !== undefined) device.zohoId        = zohoId || null;
        await env.HERO_KV.put(id, JSON.stringify(device), { metadata: summarizeDevice(device) });
        return json({ ok: true }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }

    // ── POST /device/intervencion — registrar intervención ────
    if (request.method === 'POST' && path === '/device/intervencion') {
      try {
        const { id, tipo, descripcion, notas } = await request.json();
        if (!id || !tipo || !descripcion) return json({ error: 'Faltan campos' }, 400, cors);
        // Lista blanca: alineada con el <select> del Console. Evita que un cliente
        // autenticado escriba basura arbitraria al historial de intervenciones.
        const TIPOS_VALIDOS = ['Instalación de software', 'Reparación o diagnóstico', 'Soporte remoto'];
        if (!TIPOS_VALIDOS.includes(tipo)) {
          return json({ error: 'Tipo de intervención no válido' }, 400, cors);
        }
        const v = await env.HERO_KV.get(id);
        if (!v) return json({ error: 'Dispositivo no encontrado' }, 404, cors);
        const device = JSON.parse(v);
        const intervencion = {
          iid: 'int_' + Date.now(),
          tipo, descripcion,
          notas: notas || '',
          fecha: new Date().toISOString(),
        };
        device.intervenciones = device.intervenciones || [];
        device.intervenciones.unshift(intervencion);
        await env.HERO_KV.put(id, JSON.stringify(device), { metadata: summarizeDevice(device) });
        return json({ ok: true, intervencion }, 200, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
    }


    // ── POST /email/onboarding → email de onboarding a destinos externos ──
    // Endpoint dedicado para el caso de uso legítimo de mandar credenciales
    // al correo PERSONAL del empleado recién creado (@gmail, @yahoo, etc.),
    // que por diseño está fuera del dominio corporativo. Va detrás del gate
    // del HERO_TOKEN (misma auth que /email), pero con rate limit propio y
    // sin la restricción del dominio del `to`. El `from` sigue restringido
    // a @heroinsuranceusa.com para que no se pueda spoofear la identidad.
    if (request.method === 'POST' && path === '/email/onboarding') {
      const ip = clientIp(request);
      if (!(await rateLimit(env, 'email-onboarding', ip, 10, 60))) {
        return json({ error: 'Demasiados envíos de onboarding. Espera un minuto.' }, 429, cors);
      }
      return dedupByBody(request, env, async () => {
      try {
        const { to, subject, html, text, from } = await request.json();
        if (!to || !subject || !html) return json({ error: 'Faltan campos: to, subject, html' }, 400, cors);
        const allowedFrom = /@heroinsuranceusa\.com\s*>?\s*$/i;
        const fromVal = from || 'Fernando Romero <it@heroinsuranceusa.com>';
        if (!allowedFrom.test(fromVal)) {
          return json({ error: 'From fuera de dominio @heroinsuranceusa.com' }, 400, cors);
        }
        const toList = Array.isArray(to) ? to : [to];
        const resendResp = await sendResend(env, {
          from: fromVal,
          to: toList,
          subject, html, text: text || '',
        }, { event: 'onboarding_email', dest: toList.join(',') });
        if (!resendResp) return json({ error: 'No se pudo enviar el correo' }, 502, cors);
        const result = await resendResp.json();
        return json(result, resendResp.status, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
      }, 'email-onboarding');
    }

    // ── POST /email → email via Resend ────────────────────────
    // Path explícito (antes era POST / catch-all — footgun: cualquier POST a
    // ruta no reconocida disparaba un envío). Restringimos `to` y `from` al
    // dominio corporativo para que un bug en el frontend no pueda
    // accidentalmente mandar a destinos externos desde la dirección de IT.
    // Para el caso legítimo de mandar a correos personales externos (onboarding
    // de empleados nuevos), usar POST /email/onboarding — ese sí acepta destino
    // externo con rate limit propio.
    // dedupByBody evita doble envío en doble-click del botón "Enviar Onboarding".
    if (request.method === 'POST' && path === '/email') {
      return dedupByBody(request, env, async () => {
      try {
        const { to, subject, html, text, from } = await request.json();
        if (!to || !subject || !html) return json({ error: 'Faltan campos: to, subject, html' }, 400, cors);
        const allowedDomain = /@heroinsuranceusa\.com\s*>?\s*$/i;
        const toList = Array.isArray(to) ? to : [to];
        if (!toList.every(addr => allowedDomain.test(String(addr)))) {
          return json({ error: 'Destino fuera de dominio @heroinsuranceusa.com' }, 400, cors);
        }
        const fromVal = from || 'Fernando Romero <it@heroinsuranceusa.com>';
        if (!allowedDomain.test(fromVal)) {
          return json({ error: 'From fuera de dominio @heroinsuranceusa.com' }, 400, cors);
        }
        const resendResp = await sendResend(env, {
          from: fromVal,
          to: toList,
          subject, html, text: text || '',
        }, { event: 'generic_email_post' });
        if (!resendResp) return json({ error: 'No se pudo enviar el correo' }, 502, cors);
        const result = await resendResp.json();
        return json(result, resendResp.status, cors);
      } catch (err) { logError('handler_failed', err, { path, method: request.method }); return json({ error: 'Error interno del servidor' }, 500, cors); }
      }, 'email');
    }

    return json({ error: 'Ruta no encontrada' }, 404, cors);
  },

  // ── Cron diario: recordatorios de licencias por vencer ──────
  // Dispara una vez al día (cron trigger en wrangler.toml). Revisa cada
  // licencia con `vencimiento` y, si el día actual coincide con 30/7/1/0
  // días antes del vencimiento, manda un email a IT — una sola vez por
  // (licencia, período) usando marcas en KV con TTL 32 días.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runLicenciaReminders(env));
  }
};

async function runLicenciaReminders(env) {
  try {
    const list = await env.HERO_KV.list({ prefix: 'lic_' });
    const lics = await Promise.all(list.keys.map(async k => {
      try { const v = await env.HERO_KV.get(k.name); return v ? JSON.parse(v) : null; }
      catch { return null; }
    }));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const PERIODS = [30, 7, 1, 0];
    let sent = 0, skipped = 0;
    for (const lic of lics.filter(Boolean)) {
      if (!lic.vencimiento) continue;
      const v = new Date(lic.vencimiento);
      v.setUTCHours(0, 0, 0, 0);
      const days = Math.round((v - today) / 86400000);
      if (!PERIODS.includes(days)) continue;
      const warnKey = 'cron_lic_warned_' + lic.id + '_' + days;
      const already = await env.HERO_KV.get(warnKey);
      if (already) { skipped++; continue; }
      const urgency = days === 0 ? 'VENCE HOY'
                    : days === 1 ? 'Vence mañana'
                    : 'Vence en ' + days + ' días';
      const resp = await sendResend(env, {
        from: 'Hero IT Console <it@heroinsuranceusa.com>',
        to:   ['it@heroinsuranceusa.com'],
        subject: '[' + urgency.toUpperCase() + '] Licencia: ' + lic.nombre,
        html: buildLicReminderEmail(lic, days, urgency),
        text: lic.nombre + ' — ' + urgency + ' (vence el ' + lic.vencimiento + ').'
            + (lic.plan ? '\nPlan: ' + lic.plan : '')
            + (lic.costo > 0 ? '\nCosto: $' + lic.costo + '/mes (' + (lic.tipoSub || 'mensual') + ')' : ''),
      }, { event: 'cron_lic_reminder', lic: lic.id, days });
      if (resp && resp.ok) {
        await env.HERO_KV.put(warnKey, '1', { expirationTtl: 32 * 86400 });
        sent++;
      }
    }
    logEvent('cron_lic_reminders_done', { sent, skipped, day: today.toISOString().slice(0, 10) });
  } catch (err) {
    logError('cron_lic_reminders_failed', err);
  }
}

function buildLicReminderEmail(lic, days, urgency) {
  const urgencyColor = days === 0 || days === 1 ? '#d64545'
                     : days <= 7 ? '#e8a317'
                     : '#06a3b6';
  return '<div style="font-family:Trebuchet MS,Arial,sans-serif;max-width:560px;background:#f0f4f8;padding:24px;">'
    + '<div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">'
    + '<div style="background:linear-gradient(135deg,#06a3b6,#048395);padding:24px 32px;text-align:center;">'
    +   '<img src="https://i.ibb.co/Gr4mzLv/Nuevo-Logo-Cuadrado-compress.png" width="80" style="display:block;margin:0 auto 12px;"/>'
    +   '<div style="display:inline-block;background:' + urgencyColor + ';color:#fff;font-weight:700;font-size:11px;letter-spacing:2px;padding:5px 14px;border-radius:20px;">' + esc(urgency.toUpperCase()) + '</div>'
    +   '<h1 style="color:#fff;margin:10px 0 0;font-size:18px;">Recordatorio de licencia</h1>'
    + '</div>'
    + '<div style="padding:28px 32px;">'
    +   '<div style="font-size:16px;font-weight:700;color:#1a202c;margin-bottom:6px;">' + esc(lic.nombre) + '</div>'
    +   (lic.plan ? '<div style="font-size:13px;color:#777;margin-bottom:14px;">Plan: ' + esc(lic.plan) + '</div>' : '')
    +   '<div style="background:#f7faff;border-radius:8px;padding:14px 16px;margin:14px 0;">'
    +     '<div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#06a3b6;text-transform:uppercase;margin-bottom:6px;">Vencimiento</div>'
    +     '<div style="font-size:14px;color:#1a202c;font-weight:600;">' + esc(lic.vencimiento) + '</div>'
    +   '</div>'
    +   (lic.costo > 0 ? '<div style="font-size:13px;color:#444;">💵 Costo: $' + lic.costo + '/mes (' + esc(lic.tipoSub || 'mensual') + ')</div>' : '')
    +   (lic.usuarios > 0 ? '<div style="font-size:13px;color:#444;margin-top:4px;">👤 ' + esc(String(lic.usuarios)) + ' usuarios</div>' : '')
    +   '<p style="font-size:13px;color:#666;line-height:1.6;margin-top:18px;">Revisa en la Hero IT Console si toca renovar o cancelar.</p>'
    + '</div>'
    + '<div style="padding:12px 32px;background:#f0f4f8;text-align:center;"><p style="margin:0;font-size:10px;color:#aaa;">Hero IT Console · Recordatorio automático</p></div>'
    + '</div></div>';
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

// ── Observabilidad ────────────────────────────────────────────
// Logs estructurados (JSON line) que Cloudflare conserva 24 h en tail logs.
// Útil para post-mortem sin tener que reproducir el fallo en producción.
function logEvent(event, data = {}) {
  try { console.log(JSON.stringify({ event, ts: Date.now(), ...data })); } catch (_) {}
}
function logError(event, err, ctx = {}) {
  try {
    console.error(JSON.stringify({
      event, ts: Date.now(),
      msg: err && err.message, stack: err && err.stack ? String(err.stack).slice(0, 500) : '',
      ...ctx
    }));
  } catch (_) {}
}

// ── Resend con chequeo de error ───────────────────────────────
// Si Resend devuelve 429/500 o la key vencó, antes el mail se perdía sin que
// nadie se enterara. Ahora loggeamos a Cloudflare tail logs y dejamos rastro
// en KV `audit_` para que aparezca en la página Auditoría del Console.
async function sendResend(env, payload, ctx = {}) {
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      let bodyText = '';
      try { bodyText = (await resp.clone().text()).slice(0, 500); } catch (_) {}
      const toStr = Array.isArray(payload.to) ? payload.to.join(',') : (payload.to || '');
      logError('resend_send_failed', new Error('status ' + resp.status), {
        ...ctx, status: resp.status, body: bodyText, to: toStr, subject: payload.subject
      });
      try {
        const auditId = 'audit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        await env.HERO_KV.put(auditId, JSON.stringify({
          id: auditId, tipo: 'error',
          descripcion: 'Email no enviado: ' + (payload.subject || '(sin subject)'),
          detalle: 'Resend ' + resp.status + ' → ' + toStr + (ctx.event ? ' · ' + ctx.event : ''),
          fecha: new Date().toISOString(), usuario: 'system',
        }));
      } catch (_) { /* mejor perder el audit que romper la respuesta al cliente */ }
    }
    return resp;
  } catch (err) {
    logError('resend_send_threw', err, { ...ctx, subject: payload && payload.subject });
    return null;
  }
}

// ── Paginación para list endpoints ────────────────────────────
// KV.list() corta en 1000 keys; si hay más, devuelve cursor + list_complete:false.
// Estos helpers permiten que los GET endpoints acepten ?cursor= para iterar.
// Backwards-compat: si el cliente no manda cursor, recibe la primera página
// como antes; ahora la respuesta incluye `cursor` y `complete` para que el
// frontend pueda pedir más cuando escale.
function paginationParams(url) {
  return { cursor: url.searchParams.get('cursor') || undefined };
}
function listMeta(list) {
  return { cursor: list.list_complete ? null : list.cursor, complete: list.list_complete };
}

// ── Cache helpers para list endpoints ─────────────────────────
// Solo cacheamos la primera página (sin cursor): si el cliente está paginando,
// va directo a KV. Las mutaciones llaman a invalidateCaches() con las keys
// afectadas para que el siguiente GET refleje el cambio sin esperar TTL.
async function withListCache(env, cacheKey, ttl, hasCursor, computeFn) {
  if (!hasCursor) {
    try {
      const cached = await env.HERO_KV.get(cacheKey);
      if (cached) {
        try { return JSON.parse(cached); } catch (_) { /* cache corrupta, refetch */ }
      }
    } catch (_) {}
  }
  const data = await computeFn();
  if (!hasCursor) {
    try { await env.HERO_KV.put(cacheKey, JSON.stringify(data), { expirationTtl: ttl }); }
    catch (e) { logError('cache_write_failed', e, { cacheKey }); }
  }
  return data;
}
async function invalidateCaches(env, ...keys) {
  return Promise.all(keys.map(k => env.HERO_KV.delete(k).catch(() => {})));
}

// ── Anti-abuso para endpoints públicos ────────────────────────
function clientIp(request) {
  return request.headers.get('CF-Connecting-IP')
      || request.headers.get('X-Forwarded-For')
      || '_unknown';
}
function bodyTooLarge(request, maxBytes = 10240) {
  const len = parseInt(request.headers.get('Content-Length') || '0', 10);
  return len > maxBytes;
}
// Rate-limit por IP usando KV. Eventually-consistent: bajo carga concurrente
// puede dejar pasar 1-2 extra, suficiente para mitigar abuso (no es WAF).
async function rateLimit(env, scope, ip, maxPerWindow, windowSec) {
  const key = 'rl_' + scope + '_' + ip;
  let count = 0;
  try { count = parseInt((await env.HERO_KV.get(key)) || '0', 10); } catch (_) {}
  if (count >= maxPerWindow) return false;
  try {
    await env.HERO_KV.put(key, String(count + 1), { expirationTtl: windowSec });
  } catch (_) { /* mejor permitir que bloquear si KV falla */ }
  return true;
}

// ── Metadata para list() sin N+1 ──────────────────────────────
// KV permite hasta 1024 bytes de metadata por key. La guardamos al hacer put
// con los campos que el endpoint /stats (y futuros listados ligeros) necesitan
// para contar/filtrar sin tener que hacer get() por entrada. Los renders del
// frontend siguen usando los listados completos, pero el polling del dashboard
// (cada 60s) ahora solo necesita /stats que NO hace get()s.
function summarizeTicket(t) {
  return {
    ticketId: t.ticketId || '',
    estado: t.estado || 'abierto',
    prioridad: t.prioridad || 'Media',
    categoria: t.categoria || '',
    fecha: t.fecha || '',
  };
}
function summarizeSolicitud(s) {
  return {
    tipoSolicitud: s.tipoSolicitud || 'alta',
    tipoPersona: s.tipoPersona || 'agente',
    estado: s.estado || 'pendiente',
    fecha: s.fecha || '',
  };
}
function summarizeDevice(d) {
  return {
    estado: d.estado || '',
    tipo: d.tipo || '',
  };
}
function summarizeLicencia(l) {
  return {
    estado: l.estado || 'activa',
    vencimiento: l.vencimiento || null,
  };
}
function summarizeAudit(e) {
  return {
    tipo: e.tipo || '',
    fecha: e.fecha || '',
  };
}
function summarizeKb(a) {
  return {
    titulo: (a.titulo || '').slice(0, 120),
    tags: Array.isArray(a.tags) ? a.tags.slice(0, 5) : [],
    fecha: a.fecha || '',
  };
}

// ── Idempotencia por hash del body ───────────────────────────
// Evita duplicados en reintentos de red: si llega un POST con exactamente el
// mismo body dentro de la ventana, devolvemos la respuesta original cacheada
// en KV (sólo si fue 2xx) en lugar de re-ejecutar el handler. Esto previene
// dobles tickets, dobles emails a autorizadores y usuarios Workspace duplicados.
async function dedupByBody(request, env, fn, scope = '', ttlSec = 60) {
  let bodyText = '';
  try { bodyText = await request.clone().text(); } catch (_) { /* sin body */ }
  if (!bodyText) return fn();
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bodyText));
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  const cacheKey = 'dedup_' + scope + '_' + hashHex;
  const cached = await env.HERO_KV.get(cacheKey);
  if (cached) {
    try {
      const c = JSON.parse(cached);
      return new Response(c.body, { status: c.status, headers: c.headers });
    } catch (_) { /* cache corrupta, fall through */ }
  }
  const resp = await fn();
  if (resp.status >= 200 && resp.status < 300) {
    try {
      const respBody = await resp.clone().text();
      const headers = {};
      resp.headers.forEach((v, k) => { headers[k] = v; });
      await env.HERO_KV.put(cacheKey, JSON.stringify({
        status: resp.status, body: respBody, headers
      }), { expirationTtl: ttlSec });
    } catch (_) { /* no bloqueamos la respuesta si falla el cache */ }
  }
  return resp;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── HMAC para links de autorización por email ────────────────
// Firma determinista: mismo id + email + secret => mismo token.
// Permite que el endpoint /solicitud-cuenta/autorizar verifique quién es
// el autorizador sin necesidad de sesión.
async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Firma HMAC sobre `id|email|exp`. El `exp` (epoch seconds) viene como parte
// del link en la URL; la firma lo cubre para que no se pueda extender desde
// fuera. Sin exp el link ya no se acepta (decisión consciente: cortar links
// viejos sin caducidad — eran perpetuos mientras el secret no rotara).
async function signAuth(env, id, email, exp) {
  if (!env.AUTH_HMAC_SECRET) throw new Error('Falta AUTH_HMAC_SECRET');
  return hmacSign(env.AUTH_HMAC_SECRET, id + '|' + email.toLowerCase() + '|' + exp);
}

async function verifyAuth(env, id, email, sig, exp) {
  if (!sig || !email || !id || !exp) return false;
  const expNum = parseInt(exp, 10);
  if (!expNum) return false;
  const expected = await signAuth(env, id, email, expNum);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// ── Autenticación del Console (pase de sesión) ───────────────
// Solo este email puede usar la consola de administración.
const ALLOWED_EMAIL   = 'it@heroinsuranceusa.com';
// Client ID público de Google OAuth (el mismo que usa index.html).
const GOOGLE_CLIENT_ID = '264842910230-gcae4mfdma2sbh4gfrtlickfndrnt5as.apps.googleusercontent.com';
const SESSION_TTL_SEC  = 8 * 60 * 60; // 8 horas

// Verifica el ID token de Google usando el endpoint oficial tokeninfo.
// Devuelve los claims (email, name, …) o lanza error si el token no es válido.
async function verifyGoogleIdToken(credential) {
  const resp = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!resp.ok) throw new Error('Token rechazado por Google');
  const claims = await resp.json();
  // Defensa en profundidad: además de la audiencia (aud), confirmamos que el
  // token fue emitido por Google y no por otro IdP que pudiera compartir
  // formato. Google acepta ambas variantes del issuer.
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') {
    throw new Error('Issuer inválido');
  }
  if (claims.aud !== GOOGLE_CLIENT_ID) throw new Error('Audiencia inválida');
  if (claims.email_verified !== 'true' && claims.email_verified !== true) throw new Error('Email no verificado');
  return claims;
}

// Encoding/decoding base64url para el pase de sesión. Antes usaba el patrón
// btoa(unescape(encodeURIComponent(str))) — `escape`/`unescape` están
// deprecados desde ES5. TextEncoder/TextDecoder son la API moderna y manejan
// UTF-8 correctamente.
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(b64) {
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Emite un pase de sesión firmado: payloadBase64.firmaHMAC
async function mintSession(env, email) {
  if (!env.AUTH_HMAC_SECRET) throw new Error('Falta AUTH_HMAC_SECRET');
  const payload = b64urlEncode(JSON.stringify({
    email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  }));
  const sig = await hmacSign(env.AUTH_HMAC_SECRET, 'session.' + payload);
  return payload + '.' + sig;
}

// Valida un pase de sesión. Devuelve el email si es válido y no expiró, o null.
async function verifySession(env, token) {
  if (!token || !env.AUTH_HMAC_SECRET) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig        = token.slice(dot + 1);
  const expected   = await hmacSign(env.AUTH_HMAC_SECRET, 'session.' + payloadB64);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  let data;
  try { data = JSON.parse(b64urlDecode(payloadB64)); } catch { return null; }
  if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
  if ((data.email || '').toLowerCase() !== ALLOWED_EMAIL) return null;
  return data.email;
}

// Lee el pase del header Authorization y lo valida.
async function requireAuth(request, env) {
  try {
    const h = request.headers.get('Authorization') || '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (!token) return null;
    return await verifySession(env, token);
  } catch { return null; }
}

function htmlResponse(html, status = 200, cors = {}) {
  return new Response(html, {
    status, headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// Lista de autorizadores — usada por el POST (envío de emails) y por
// el GET /solicitud-cuenta/autorizar (para resolver email → nombre).
// Fuente de verdad: KV key 'config_authorizers' (editable desde Console).
// Fallback: la lista hardcoded. Si KV está vacío/corrupto, sigue funcionando.
const AUTHORIZER_LIST_DEFAULT = [
  { email: 'jgutierrez@heroinsuranceusa.com',  nombre: 'Jesús Gutiérrez' },
  { email: 'contracting@heroinsuranceusa.com', nombre: 'Anny Medina' },
  { email: 'hr@heroinsuranceusa.com',          nombre: 'Aurys Rodríguez' },
];
async function getAuthorizerList(env) {
  try {
    const stored = await env.HERO_KV.get('config_authorizers');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter(a => a && a.email && a.nombre);
      }
    }
  } catch (_) { /* fallback al hardcoded */ }
  return AUTHORIZER_LIST_DEFAULT;
}
async function findAuthorizerByEmail(env, email) {
  const list = await getAuthorizerList(env);
  const e = (email || '').toLowerCase();
  return list.find(a => a.email.toLowerCase() === e) || null;
}

function buildAuthorizePage({ titulo, mensaje, detalle, color, icono }) {
  return '<!DOCTYPE html><html lang="es"><head>'
    + '<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>'
    + '<title>' + esc(titulo) + ' · Hero IT</title>'
    + '<style>'
    +   'body{margin:0;font-family:Trebuchet MS,Arial,sans-serif;background:#f0f4f8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}'
    +   '.card{background:#fff;border-radius:18px;max-width:520px;width:100%;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.10);}'
    +   '.head{padding:32px 32px 26px;text-align:center;color:#fff;background:' + color + ';}'
    +   '.logo{width:100px;height:auto;display:block;margin:0 auto 14px;}'
    +   '.icon{font-size:48px;line-height:1;margin-bottom:8px;}'
    +   '.title{margin:0;font-size:22px;font-weight:700;letter-spacing:-0.5px;}'
    +   '.body{padding:30px 36px 36px;text-align:center;}'
    +   '.msg{font-size:15px;color:#1a202c;margin:0 0 14px;line-height:1.55;}'
    +   '.detalle{font-size:13px;color:#4a5568;line-height:1.6;margin:0;background:#f7faff;border:1px solid #e3eaf2;border-radius:10px;padding:14px 16px;text-align:left;}'
    +   '.footer{padding:14px 16px;background:#f0f4f8;text-align:center;font-size:10px;color:#aaa;}'
    + '</style></head><body>'
    + '<div class="card">'
    +   '<div class="head">'
    +     '<img class="logo" src="https://i.ibb.co/Gr4mzLv/Nuevo-Logo-Cuadrado-compress.png" alt="Hero Insurance USA"/>'
    +     '<div class="icon">' + icono + '</div>'
    +     '<h1 class="title">' + esc(titulo) + '</h1>'
    +   '</div>'
    +   '<div class="body"><p class="msg">' + mensaje + '</p>'
    +     (detalle ? '<div class="detalle">' + detalle + '</div>' : '')
    +   '</div>'
    +   '<div class="footer">CONFIDENTIALITY NOTICE · Hero Insurance USA · IT Department</div>'
    + '</div></body></html>';
}


function buildStatusMsgs(estado, ticket, ticketInfo) {
  const nom = esc(ticket.nombre);
  const res = ticket.respuesta || '';
  const resHtml = res ? '<div style="background:#f7faff;border-radius:10px;border:1px solid #d8e1ea;padding:16px;margin:16px 0;">'
    + '<p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#06a3b6;">Resolucion</p>'
    + '<p style="margin:0;font-size:13px;color:#444;line-height:1.7;">' + esc(res).split('\n').join('<br/>') + '</p></div>' : '';
  return {
    'en progreso': {
      titulo: 'Estamos atendiendo tu caso',
      body: '<p style="font-size:14px;color:#444;">Hola <strong>' + nom + '</strong>, tu ticket esta siendo atendido.</p>'
        + ticketInfo
        + '<p style="font-size:13px;color:#777;">Recibiras una respuesta pronto.</p>',
    },
    'resuelto': {
      titulo: 'Tu ticket fue resuelto',
      body: '<p style="font-size:14px;color:#444;">Hola <strong>' + nom + '</strong>, hemos resuelto tu solicitud.</p>'
        + ticketInfo + resHtml
        + '<p style="font-size:13px;color:#777;">Si el problema persiste, abre un nuevo ticket.</p>',
    },
    'abierto': {
      titulo: 'Tu ticket fue reabierto',
      body: '<p style="font-size:14px;color:#444;">Hola <strong>' + nom + '</strong>, tu ticket ha sido reabierto.</p>'
        + ticketInfo,
    },
  };
}

// Fetch + normalize Zoho devices con cache KV de 60s. Compartido por
// GET /zoho/devices (back-compat) y el merge en GET /device?withZoho=1.
async function fetchZohoDevicesData(env, { fresh = false } = {}) {
  if (!fresh) {
    const cached = await env.HERO_KV.get('cache_zoho_devices');
    if (cached) {
      try { return { devices: JSON.parse(cached), fromCache: true }; }
      catch (_) { /* cache corrupta, refetch */ }
    }
  }
  const token = await getZohoToken(env);
  const resp = await fetch('https://assist.zoho.com/api/v2/devices', {
    headers: {
      'Authorization': 'Zoho-oauthtoken ' + token,
      'Content-Type': 'application/json',
      'x-com-zoho-assist-department-id': env.ZOHO_DEPARTMENT_ID
    }
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error('Respuesta no JSON de Zoho: ' + text.substring(0, 200)); }
  if (!resp.ok) throw new Error(data.message || data.error || 'Error Zoho API');
  const computers = data.representation?.computers || data.computers || data || [];
  const devices = computers.map(c => ({
    id:     c.resource_id || c.urs_key || '',
    name:   c.display_name || c.device_info?.name || c.device_info?.device_name || 'Sin nombre',
    status: c.device_info?.status || 'offline',
    os:     c.platform_details?.os_name || '',
    group:  c.group_name || '',
    ip:     c.device_info?.public_ip_address || c.device_info?.private_ip_address || '',
  }));
  try { await env.HERO_KV.put('cache_zoho_devices', JSON.stringify(devices), { expirationTtl: 60 }); }
  catch (e) { logError('zoho_devices_cache_write_failed', e); }
  return { devices, fromCache: false };
}

// Cache de tokens OAuth en KV. Los tokens duran 1h; cacheamos ~55min para
// margen. Evita firmar JWT RS256 + round-trip a Google/Zoho en cada request
// del dashboard (~200-400 ms ahorrados por endpoint).
async function getCachedToken(env, cacheKey) {
  try {
    const raw = await env.HERO_KV.get(cacheKey);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (c && c.token && c.exp > Math.floor(Date.now() / 1000) + 60) return c.token;
  } catch (_) {}
  return null;
}
async function setCachedToken(env, cacheKey, token, expiresInSec) {
  const ttl = Math.max(60, (expiresInSec || 3600) - 300); // margen de 5 min
  try {
    await env.HERO_KV.put(cacheKey, JSON.stringify({
      token, exp: Math.floor(Date.now() / 1000) + ttl
    }), { expirationTtl: ttl });
  } catch (e) { logError('token_cache_write_failed', e, { cacheKey }); }
}

async function getZohoToken(env) {
  const cached = await getCachedToken(env, 'cache_zoho_token');
  if (cached) return cached;
  const resp = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: env.ZOHO_REFRESH_TOKEN,
      client_id:     env.ZOHO_CLIENT_ID,
      client_secret: env.ZOHO_CLIENT_SECRET,
      grant_type:    'refresh_token'
    }).toString()
  });
  const data = await resp.json();
  if (!data.access_token) {
    logError('zoho_token_failed', new Error('no access_token'), { status: resp.status });
    throw new Error('Zoho token fallido: ' + JSON.stringify(data));
  }
  await setCachedToken(env, 'cache_zoho_token', data.access_token, data.expires_in);
  return data.access_token;
}

async function getGoogleToken(env) {
  const cached = await getCachedToken(env, 'cache_google_token');
  if (cached) return cached;
  const clientEmail = env.GOOGLE_CLIENT_EMAIL;
  const privateKey  = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const adminEmail  = env.GOOGLE_ADMIN_EMAIL;
  const scope = 'https://www.googleapis.com/auth/admin.directory.user';
  const now = Math.floor(Date.now() / 1000);
  const b64 = obj => btoa(JSON.stringify(obj)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const signingInput = b64({ alg:'RS256', typ:'JWT' }) + '.' + b64({
    iss: clientEmail, sub: adminEmail, scope,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  });
  const keyData = privateKey.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\s/g,'');
  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey.buffer, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
  const b64sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + signingInput + '.' + b64sig,
  });
  const tokenData = await tokenResp.json();
  if (!tokenData.access_token) {
    logError('google_token_failed', new Error('no access_token'), { status: tokenResp.status });
    throw new Error('Token fallido: ' + JSON.stringify(tokenData));
  }
  await setCachedToken(env, 'cache_google_token', tokenData.access_token, tokenData.expires_in);
  return tokenData.access_token;
}

// ═══════════════════════════════════════════════════════════════
//  Finanzas (Hero Hub) — auth con Firebase ID token + email template
// ═══════════════════════════════════════════════════════════════

// Emails autorizados a disparar /finanzas/send-report. Coincide con el rol
// `finanzas` del Hub + admin. Si cambian los miembros del equipo de Finanzas
// hay que actualizar acá y redeployar el Worker.
const FINANZAS_EMAILS = new Set([
  'it@heroinsuranceusa.com',
  'financesupport@heroinsuranceusa.com',
  'finance@heroinsuranceusa.com',
  'samortiz@heroinsuranceusa.com',
  'brokersupport@heroinsuranceusa.com',
]);

// Emails autorizados a intercambiar Firebase ID token del Hub por HERO_TOKEN
// via POST /auth/hub-login. Solo it@ por ahora — coincide con ALLOWED_EMAIL.
// Si se expande, hay que modificar también verifySession() (que compara
// data.email vs ALLOWED_EMAIL) para aceptar la lista completa.
const IT_EMAILS = new Set([
  'it@heroinsuranceusa.com',
]);

// Verifica un Firebase ID token (JWT RS256) contra las JWKs públicas de Google.
// Devuelve los claims o lanza. Cachea las JWKs en KV con TTL 1h — Google rota
// las keys ~cada día, y un kid no cacheado fuerza refetch.
async function verifyFirebaseIdToken(idToken, env) {
  if (!idToken || typeof idToken !== 'string') throw new Error('idToken vacío');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Formato JWT inválido');
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Falta FIREBASE_PROJECT_ID');

  let header, payload;
  try {
    header  = JSON.parse(b64urlDecode(parts[0]));
    payload = JSON.parse(b64urlDecode(parts[1]));
  } catch { throw new Error('JWT corrupto'); }

  if (header.alg !== 'RS256') throw new Error('Algoritmo inválido');
  if (!header.kid) throw new Error('Sin kid');

  const jwk = await getFirebaseJwk(env, header.kid);
  if (!jwk) throw new Error('kid no encontrado en JWKs');

  const key = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify']
  );
  const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const sig = b64urlToBytes(parts[2]);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
  if (!valid) throw new Error('Firma inválida');

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) throw new Error('Token expirado');
  if (payload.iat && payload.iat > now + 300) throw new Error('Token del futuro');
  if (payload.aud !== projectId) throw new Error('aud inválido');
  if (payload.iss !== 'https://securetoken.google.com/' + projectId) throw new Error('iss inválido');
  if (!payload.sub) throw new Error('Sin sub');
  if (!payload.email) throw new Error('Sin email');

  return payload;
}

// Lookup en cache + refetch on miss. Si el cache está vacío o no contiene el
// kid pedido, refresca contra Google y reintenta.
async function getFirebaseJwk(env, kid) {
  const cacheKey = 'firebase_jwks_v1';
  let jwks = null;
  try {
    const cached = await env.HERO_KV.get(cacheKey);
    if (cached) jwks = JSON.parse(cached);
  } catch (_) {}
  let found = jwks && Array.isArray(jwks.keys) && jwks.keys.find(k => k.kid === kid);
  if (found) return found;

  const resp = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!resp.ok) throw new Error('No se pudieron cargar JWKs de Google');
  jwks = await resp.json();
  try { await env.HERO_KV.put(cacheKey, JSON.stringify(jwks), { expirationTtl: 3600 }); } catch (_) {}
  return (jwks.keys || []).find(k => k.kid === kid) || null;
}

// base64url → Uint8Array (bytes crudos, no UTF-8). `b64urlDecode` ya existente
// devuelve string, lo cual corrompe firmas binarias.
function b64urlToBytes(b64) {
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function formatUSD(n) {
  const num = Number(n);
  if (!isFinite(num)) return '$0.00';
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Email branded Hero Light (cyan #06a3b6) con el resumen del payout para el
// broker. Sin adjuntos — el archivo del reporte se menciona como referencia.
function renderFinanzasEmail({ ingreso, payout, broker, sender }) {
  const monto = formatUSD(ingreso.monto);
  const saldo = formatUSD(payout.saldo);
  const fecha = ingreso.fecha || '';
  const mes   = ingreso.mes || '';
  const desc  = ingreso.descripcionDeposito || 'Hero Insurance';
  return ''
    + '<div style="font-family:Trebuchet MS,Arial,sans-serif;max-width:620px;background:#f0f4f8;padding:32px 16px;">'
    + '<div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">'
    + '<div style="background:linear-gradient(135deg,#06a3b6,#048395);padding:28px 40px;text-align:center;">'
    +   '<img src="https://i.ibb.co/Gr4mzLv/Nuevo-Logo-Cuadrado-compress.png" width="120" style="display:block;margin:0 auto 14px;" alt="Hero Insurance USA"/>'
    +   '<div style="display:inline-block;background:rgba(255,255,255,0.2);color:#fff;font-weight:700;font-size:11px;letter-spacing:3px;padding:5px 14px;border-radius:20px;margin-bottom:10px;">REPORTE DE COMISIÓN</div>'
    +   '<h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">' + esc(desc) + '</h1>'
    +   (mes ? '<p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">' + esc(mes) + '</p>' : '')
    + '</div>'
    + '<div style="padding:28px 40px;">'
    +   '<p style="margin:0 0 18px;font-size:14px;color:#4a5568;">Hola <strong>' + esc(broker.nombre || broker.email) + '</strong>,</p>'
    +   '<p style="margin:0 0 18px;font-size:13px;color:#4a5568;line-height:1.6;">Te compartimos el detalle del payout correspondiente a tu participación en esta comisión.</p>'
    +   '<div style="background:#f7faff;border-radius:10px;border:1px solid #d8e1ea;padding:18px;margin:0 0 14px;">'
    +     '<p style="margin:0 0 6px;font-size:10px;font-weight:700;letter-spacing:2px;color:#06a3b6;text-transform:uppercase;">Detalle de la comisión</p>'
    +     (fecha ? '<p style="margin:0 0 4px;font-size:13px;color:#4a5568;"><strong>Fecha:</strong> ' + esc(fecha) + '</p>' : '')
    +     (ingreso.tipoPago ? '<p style="margin:0 0 4px;font-size:13px;color:#4a5568;"><strong>Tipo de pago:</strong> ' + esc(ingreso.tipoPago) + '</p>' : '')
    +     (ingreso.categoria ? '<p style="margin:0 0 4px;font-size:13px;color:#4a5568;"><strong>Categoría:</strong> ' + esc(ingreso.categoria) + '</p>' : '')
    +     '<p style="margin:0;font-size:13px;color:#4a5568;"><strong>Monto total recibido por Hero:</strong> ' + esc(monto) + '</p>'
    +   '</div>'
    +   '<div style="background:#e0f7fa;border-left:4px solid #06a3b6;border-radius:10px;padding:18px;margin:0 0 22px;">'
    +     '<p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:2px;color:#06a3b6;text-transform:uppercase;">Tu payout</p>'
    +     '<p style="margin:0;font-size:28px;font-weight:700;color:#048395;letter-spacing:-0.5px;">' + esc(saldo) + '</p>'
    +     (payout.reporteFile ? '<p style="margin:10px 0 0;font-size:12px;color:#4a5568;"><strong>Archivo de reporte:</strong> <span style="font-family:monospace;color:#06a3b6;">' + esc(payout.reporteFile) + '</span></p>' : '')
    +   '</div>'
    +   '<p style="font-size:12px;color:#999;line-height:1.6;margin:0;">Cualquier consulta, responde a este correo y el equipo de Finanzas te atiende a la brevedad.</p>'
    + '</div>'
    + '<div style="padding:12px 40px;background:#f0f4f8;text-align:center;">'
    +   '<p style="margin:0;font-size:10px;color:#aaa;">CONFIDENTIALITY NOTICE · Hero Insurance USA · Finanzas</p>'
    +   '<p style="margin:4px 0 0;font-size:10px;color:#aaa;">Enviado por ' + esc(sender) + '</p>'
    + '</div>'
    + '</div></div>';
}

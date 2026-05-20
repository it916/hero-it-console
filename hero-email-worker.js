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

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const path = url.pathname;

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
      } catch(err) { return json({ error: err.message }, 500, cors); }
    }

    // ── GET /zoho/devices — listar dispositivos Zoho Assist ───
    if (request.method === 'GET' && path === '/zoho/devices') {
      try {
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
        catch(e) { return json({ error: 'Respuesta no JSON: ' + text.substring(0, 200) }, 500, cors); }
        if (!resp.ok) return json({ error: data.message || data.error || 'Error Zoho API' }, resp.status, cors);
        const computers = data.representation?.computers || data.computers || data || [];
        const devices = computers.map(c => ({
          id:     c.resource_id || c.urs_key || '',
          name:   c.display_name || c.device_info?.name || c.device_info?.device_name || 'Sin nombre',
          status: c.device_info?.status || 'offline',
          os:     c.platform_details?.os_name || '',
          group:  c.group_name || '',
          ip:     c.device_info?.public_ip_address || c.device_info?.private_ip_address || '',
        }));
        return json({ devices }, 200, cors);
      } catch(err) { return json({ error: err.message }, 500, cors); }
    }

    // ── GET /zoho/session/:id — iniciar sesión remota ─────────
    if (request.method === 'GET' && path.startsWith('/zoho/session/')) {
      try {
        const computerId = path.replace('/zoho/session/', '');
        const sessionUrl = 'https://assist.zoho.com/portal/it265/app/home#/unattended/devices?computer_id=' + computerId;
        return json({ sessionUrl }, 200, cors);
      } catch(err) { return json({ error: err.message }, 500, cors); }
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
        await env.HERO_KV.put(licId, JSON.stringify(lic));
        return json({ ok: true, id: licId }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

    // ── GET /licencia — listar ─────────────────────────────────
    if (request.method === 'GET' && path === '/licencia') {
      try {
        const list = await env.HERO_KV.list({ prefix: 'lic_' });
        const items = await Promise.all(list.keys.map(async k => {
          const v = await env.HERO_KV.get(k.name); return v ? JSON.parse(v) : null;
        }));
        return json({ licencias: items.filter(Boolean).sort((a,b) => a.nombre.localeCompare(b.nombre)) }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

    // ── POST /licencia/delete ──────────────────────────────────
    if (request.method === 'POST' && path === '/licencia/delete') {
      try {
        const { id } = await request.json();
        await env.HERO_KV.delete(id);
        return json({ ok: true }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

    // ── GET /users ────────────────────────────────────────────
    if (request.method === 'GET' && path === '/users') {
      try {
        const token = await getGoogleToken(env);
        const resp = await fetch(
          'https://admin.googleapis.com/admin/directory/v1/users?domain=heroinsuranceusa.com&maxResults=200&orderBy=email',
          { headers: { 'Authorization': 'Bearer ' + token } }
        );
        const data = await resp.json();
        if (!resp.ok) return json({ error: data.error?.message || 'Error Google API' }, resp.status, cors);
        const users = (data.users || []).map(u => ({
          nombre: u.name?.fullName || '', email: u.primaryEmail || '',
          estado: u.suspended ? 'suspendido' : 'activo',
          creado: u.creationTime || '', ultimoLogin: u.lastLoginTime || '',
        }));
        return json({ users }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

    // ── POST /create-user ─────────────────────────────────────
    if (request.method === 'POST' && path === '/create-user') {
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

        // Notificación al solicitante si viene de una alta
        if (solicitanteEmail) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
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
            }),
          });
        }

        return json({ ok: true, email: data.primaryEmail }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

    // ── GET /solicitud-cuenta/autorizar ───────────────────────
    // Endpoint público que recibe el click desde el botón del email.
    // Verifica HMAC, marca la solicitud como autorizada (registrando quién y
    // cuándo). Idempotente: si ya está autorizada o procesada, muestra el
    // estado actual en lugar de error.
    if (request.method === 'GET' && path === '/solicitud-cuenta/autorizar') {
      const heroCyan   = 'linear-gradient(135deg,#06a3b6,#048395)';
      const heroAmber  = 'linear-gradient(135deg,#d97706,#f59e0b)';
      const heroRed    = 'linear-gradient(135deg,#c0392b,#a52917)';
      try {
        const id  = url.searchParams.get('id')  || '';
        const by  = (url.searchParams.get('by')  || '').toLowerCase();
        const sig = url.searchParams.get('sig') || '';

        if (!id || !by || !sig) {
          return htmlResponse(buildAuthorizePage({
            titulo: 'Link inválido', icono: '⚠️', color: heroAmber,
            mensaje: 'El enlace está incompleto. Vuelve al correo original y haz click en el botón <strong>Autorizar solicitud</strong>.'
          }), 400, cors);
        }

        const authorizerObj = AUTHORIZER_BY_EMAIL(by);
        if (!authorizerObj) {
          return htmlResponse(buildAuthorizePage({
            titulo: 'No autorizado', icono: '🔒', color: heroRed,
            mensaje: 'Este correo no figura como autorizador de solicitudes. Si crees que es un error, contacta a IT.'
          }), 403, cors);
        }

        const ok = await verifyAuth(env, id, by, sig);
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
        await env.HERO_KV.put(id, JSON.stringify(sol));

        // Notifica a IT que la solicitud fue autorizada (no a los otros autorizadores
        // para no spamearlos — la Console refleja el estado).
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Fernando Romero <it@heroinsuranceusa.com>',
              to:   ['it@heroinsuranceusa.com'],
              subject: '[AUTORIZADA] Solicitud de ' + tipoLabel + ': ' + persona,
              text: 'Autorizada por: ' + nombreAut + ' <' + by + '>\n'
                + 'Tipo: ' + tipoLabel.toUpperCase() + '\n'
                + 'Persona: ' + persona + '\n'
                + (correoSol ? 'Correo: ' + correoSol + '\n' : '')
                + 'ID: ' + id,
            }),
          });
        } catch (_) { /* notificación best-effort */ }

        return htmlResponse(buildAuthorizePage({
          titulo: 'Solicitud autorizada', icono: '✓', color: heroCyan,
          mensaje: '¡Gracias, <strong>' + esc(nombreAut) + '</strong>! IT recibió la notificación y procederá con la solicitud.',
          detalle: detalleBase
        }), 200, cors);
      } catch (err) {
        return htmlResponse(buildAuthorizePage({
          titulo: 'Error', icono: '⚠️', color: heroRed,
          mensaje: 'Ocurrió un error al procesar la autorización: ' + esc(err.message)
        }), 500, cors);
      }
    }

    // ── POST /solicitud-cuenta (y alias /alta-agente) ─────────
    // Acepta solicitudes de ALTA y BAJA de cuentas corporativas.
    // tipoSolicitud: 'alta' (default) o 'baja'.
    // tipoPersona:   'agente' (default) o 'empleado' — sólo empleado requiere cargo/area.
    if (request.method === 'POST' && (path === '/solicitud-cuenta' || path === '/alta-agente')) {
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

        await env.HERO_KV.put(solicitud.id, JSON.stringify(solicitud));

        // Cada autorizador recibe un correo personalizado con su propio link firmado (HMAC).
        // Cuando el primero hace click, la solicitud queda como autorizada; los demás
        // ven una página "ya autorizada por X" al clickar.
        const AUTHORIZERS = AUTHORIZER_LIST;
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
        const sends = AUTHORIZERS.map(async auth => {
          let link;
          try {
            const sig = await signAuth(env, solicitud.id, auth.email);
            link = workerBase + '/solicitud-cuenta/autorizar'
              + '?id=' + encodeURIComponent(solicitud.id)
              + '&by=' + encodeURIComponent(auth.email)
              + '&sig=' + encodeURIComponent(sig);
          } catch (e) {
            // Si falta el secret, mandamos un email sin botón (fallback) y dejamos rastro.
            link = '';
          }
          const html = link
            ? buildEmailFor(auth, link)
            : buildEmailFor(auth, '#').replace('✓ Autorizar solicitud', 'Autoriza desde la Hero IT Console');
          return fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Fernando Romero <it@heroinsuranceusa.com>',
              to:   [auth.email],
              cc:   ['it@heroinsuranceusa.com'],
              subject: subject,
              html:    html,
              text:    textoPlano + '\n\nAutorizar: ' + (link || '(usa la Hero IT Console)'),
            }),
          }).catch(() => null);
        });
        await Promise.all(sends);

        return json({ ok: true, id: solicitud.id, tipoSolicitud }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

    // ── GET /alta-agente ──────────────────────────────────────
    if (request.method === 'GET' && path === '/alta-agente') {
      try {
        const list = await env.HERO_KV.list({ prefix: 'alta_' });
        const items = await Promise.all(list.keys.map(async k => {
          const v = await env.HERO_KV.get(k.name); return v ? JSON.parse(v) : null;
        }));
        return json({ solicitudes: items.filter(Boolean).sort((a,b) => new Date(b.fecha) - new Date(a.fecha)) }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

    // ── POST /alta-agente/resolver ────────────────────────────
    if (request.method === 'POST' && path === '/alta-agente/resolver') {
      try {
        const { id, estado } = await request.json();
        const val = await env.HERO_KV.get(id);
        if (!val) return json({ error: 'No encontrada' }, 404, cors);
        const item = JSON.parse(val);
        item.estado = estado || 'procesada';
        await env.HERO_KV.put(id, JSON.stringify(item));
        return json({ ok: true }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

    // ── POST /ticket — crear ticket ───────────────────────────
    if (request.method === 'POST' && path === '/ticket') {
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
        await env.HERO_KV.put(id, JSON.stringify(ticket));

        // Colores por prioridad
        const colores = { Baja:'#22d87a', Media:'#f0b429', Alta:'#f97316', Urgente:'#f56565' };
        const color = colores[prioridad] || '#f0b429';

        // Email a IT
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Hero IT Console <it@heroinsuranceusa.com>',
            to: ['it@heroinsuranceusa.com'],
            subject: '[' + ticketId + '] ' + asunto,
            html: '<div style="font-family:Arial,sans-serif;max-width:600px;">'
              + '<div style="background:linear-gradient(135deg,#06a3b6,#048395);padding:24px;border-radius:12px 12px 0 0;">'
              + '<h2 style="color:#fff;margin:0;font-size:18px;">Nuevo Ticket de Soporte</h2>'
              + '<p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:13px;">' + ticketId + '</p></div>'
              + '<div style="background:#f7faff;padding:24px;border:1px solid #e2eaf8;border-top:none;border-radius:0 0 12px 12px;">'
              + '<p><strong>De:</strong> ' + nombre + ' (' + email + ')</p>'
              + '<p><strong>Categoría:</strong> ' + categoria + '</p>'
              + '<p><strong>Prioridad:</strong> <span style="color:' + color + ';font-weight:700;">' + prioridad + '</span></p>'
              + '<p><strong>Asunto:</strong> ' + asunto + '</p>'
              + '<hr style="border:none;border-top:1px solid #e2eaf8;margin:16px 0;"/>'
              + '<p style="color:#4a5568;line-height:1.7;">' + descripcion.split('\n').join('<br/>') + '</p>'
              + '</div></div>',
            text: '[' + ticketId + '] ' + asunto + '\nDe: ' + nombre + ' (' + email + ')\nCategoria: ' + categoria + '\nPrioridad: ' + prioridad + '\n\n' + descripcion,
          }),
        });

        // Email de confirmación al usuario
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
              + '<p style="font-size:15px;color:#2d3748;">Hola <strong>' + nombre + '</strong>, hemos recibido tu solicitud de soporte.</p>'
              + '<div style="background:#f7faff;border-radius:12px;border:1px solid #e2eaf8;padding:20px;margin:20px 0;">'
              + '<p style="margin:0 0 8px;font-size:11px;font-weight:900;letter-spacing:2px;color:#06a3b6;text-transform:uppercase;">Detalles del ticket</p>'
              + '<p style="margin:0 0 6px;font-family:monospace;font-size:16px;font-weight:700;color:#06a3b6;">' + ticketId + '</p>'
              + '<p style="margin:0 0 4px;font-size:13px;color:#4a5568;"><strong>Asunto:</strong> ' + asunto + '</p>'
              + '<p style="margin:0 0 4px;font-size:13px;color:#4a5568;"><strong>Categoría:</strong> ' + categoria + '</p>'
              + '<p style="margin:0;font-size:13px;"><strong>Prioridad:</strong> <span style="color:' + color + ';font-weight:700;">' + prioridad + '</span></p>'
              + '</div>'
              + '<p style="font-size:13px;color:#4a5568;line-height:1.6;">Nuestro equipo de IT revisará tu solicitud y te contactará pronto.</p>'
              + '</div>'
              + '<div style="padding:14px 40px;background:#f0f4f8;text-align:center;">'
              + '<p style="margin:0;font-size:10px;color:#a0aec0;">CONFIDENTIALITY NOTICE: This email is intended solely for the addressee.</p>'
              + '</div></div></div>',
            text: 'Hola ' + nombre + ', recibimos tu ticket ' + ticketId + '.\nAsunto: ' + asunto + '\nCategoria: ' + categoria + '\nPrioridad: ' + prioridad + '\nNuestro equipo te contactara pronto.',
          }),
        });

        return json({ ok: true, id, ticketId }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

    // ── GET /ticket — listar tickets ──────────────────────────
    if (request.method === 'GET' && path === '/ticket') {
      try {
        const list = await env.HERO_KV.list({ prefix: 'ticket_' });
        const items = await Promise.all(list.keys.map(async k => {
          const v = await env.HERO_KV.get(k.name); return v ? JSON.parse(v) : null;
        }));
        return json({
          tickets: items.filter(Boolean).sort((a,b) => new Date(b.fecha) - new Date(a.fecha))
        }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
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
          + '<p style="margin:4px 0 0;font-size:13px;color:#444;">' + ticket.asunto + '</p></div>';

        // Notify on status change
        if (estado && estado !== estadoAnterior) {
          ticket.historial.push({ tipo: 'estado', de: estadoAnterior, a: estado, fecha: new Date().toISOString() });
          const statusMsgs = buildStatusMsgs(estado, ticket, ticketInfo);
          if (statusMsgs[estado]) {
            const msg = statusMsgs[estado];
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: 'Fernando Romero <it' + '@' + 'heroinsuranceusa.com>',
                to: [ticket.email],
                subject: '[' + ticket.ticketId + '] ' + msg.titulo,
                html: buildEmail(msg.titulo, ticket.ticketId + ' · ' + ticket.asunto, msg.body),
                text: msg.titulo + ' - ' + ticket.ticketId,
              }),
            });
          }
        }

        // Send reply if included
        if (respuesta) {
          ticket.respuesta = respuesta;
          ticket.fechaRespuesta = new Date().toISOString();
          ticket.historial.push({ tipo: 'respuesta', fecha: new Date().toISOString() });
          const replyBody = '<p style="font-size:14px;color:#444;">Hola <strong>' + ticket.nombre + '</strong>, el equipo IT respondió tu solicitud.</p>'
            + ticketInfo
            + '<div style="background:#f7faff;border-radius:10px;border:1px solid #d8e1ea;padding:16px;margin:16px 0;">'
            + '<p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#06a3b6;">Respuesta</p>'
            + '<p style="margin:0;font-size:13px;color:#444;line-height:1.7;">' + respuesta.split('\n').join('<br/>') + '</p></div>'
            + '<p style="font-size:13px;color:#777;">Estado: <strong style="color:' + (estadoColores[ticket.estado]||'#444') + ';">' + ticket.estado + '</strong></p>';
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Fernando Romero <it' + '@' + 'heroinsuranceusa.com>',
              to: [ticket.email],
              subject: 'Re: [' + ticket.ticketId + '] ' + ticket.asunto,
              html: buildEmail('Respuesta a tu ticket', ticket.ticketId + ' · ' + ticket.asunto, replyBody),
              text: 'Respuesta: ' + respuesta,
            }),
          });
        }
        await env.HERO_KV.put(id, JSON.stringify(ticket));
        return json({ ok: true }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

    // ── POST /user-action — gestionar usuario ─────────────────
    if (request.method === 'POST' && path === '/user-action') {
      try {
        const { email, action, newPassword } = await request.json();
        if (!email || !action) return json({ error: 'Faltan campos: email, action' }, 400, cors);

        const token = await getGoogleToken(env);
        const userUrl = 'https://admin.googleapis.com/admin/directory/v1/users/' + encodeURIComponent(email);

        let body = {};
        if (action === 'reset')    body = { password: newPassword, changePasswordAtNextLogin: true };
        if (action === 'suspend')  body = { suspended: true };
        if (action === 'restore')  body = { suspended: false };
        if (action === 'delete') {
          const resp = await fetch(userUrl, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token },
          });
          if (resp.status === 204 || resp.ok) return json({ ok: true }, 200, cors);
          const err = await resp.json();
          return json({ error: err.error?.message || 'Error al eliminar' }, resp.status, cors);
        }

        const resp = await fetch(userUrl, {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (!resp.ok) return json({ error: data.error?.message || 'Error' }, resp.status, cors);
        return json({ ok: true }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

    // ── POST /audit — guardar entrada ─────────────────────────
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
        await env.HERO_KV.put(id, JSON.stringify(entrada));
        return json({ ok: true, id }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

    // ── GET /audit — listar entradas ──────────────────────────
    if (request.method === 'GET' && path === '/audit') {
      try {
        const q = url.searchParams.get('q') || '';
        const tipo = url.searchParams.get('tipo') || '';
        const limit = parseInt(url.searchParams.get('limit') || '200');
        const list = await env.HERO_KV.list({ prefix: 'audit_' });
        const items = await Promise.all(list.keys.map(async k => {
          const v = await env.HERO_KV.get(k.name); return v ? JSON.parse(v) : null;
        }));
        let entradas = items.filter(Boolean)
          .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        if (tipo) entradas = entradas.filter(e => e.tipo === tipo);
        if (q)    entradas = entradas.filter(e =>
          e.descripcion.toLowerCase().includes(q.toLowerCase()) ||
          (e.detalle || '').toLowerCase().includes(q.toLowerCase()) ||
          (e.usuario || '').toLowerCase().includes(q.toLowerCase())
        );
        return json({ entradas: entradas.slice(0, limit), total: entradas.length }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

// ── POST /device — crear dispositivo ──────────────────────
    if (request.method === 'POST' && path === '/device') {
      try {
        const { nombre, tipo, usuario, so, gcpw, apps, estado } = await request.json();
        if (!nombre || !tipo) return json({ error: 'Faltan campos: nombre, tipo' }, 400, cors);
        const id = 'device_' + Date.now();
        const device = {
          id, nombre, tipo,
          usuario: usuario || '',
          so: so || '',
          gcpw: gcpw || false,
          apps: apps || [],
          estado: estado || 'activo',
          fecha: new Date().toISOString(),
          intervenciones: [],
        };
        await env.HERO_KV.put(id, JSON.stringify(device));
        return json({ ok: true, id }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

    // ── GET /device — listar dispositivos ─────────────────────
    if (request.method === 'GET' && path === '/device') {
      try {
        const list = await env.HERO_KV.list({ prefix: 'device_' });
        const items = await Promise.all(list.keys.map(async k => {
          const v = await env.HERO_KV.get(k.name); return v ? JSON.parse(v) : null;
        }));
        return json({
          devices: items.filter(Boolean).sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
        }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

    // ── GET /device/:id — obtener dispositivo ─────────────────
    if (request.method === 'GET' && path.startsWith('/device/')) {
      try {
        const id = path.replace('/device/', '');
        const v = await env.HERO_KV.get(id);
        if (!v) return json({ error: 'Dispositivo no encontrado' }, 404, cors);
        return json({ device: JSON.parse(v) }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

    // ── POST /device/update — actualizar dispositivo ──────────
    if (request.method === 'POST' && path === '/device/update') {
      try {
        const { id, nombre, tipo, usuario, so, gcpw, apps, estado } = await request.json();
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
        await env.HERO_KV.put(id, JSON.stringify(device));
        return json({ ok: true }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

    // ── POST /device/intervencion — registrar intervención ────
    if (request.method === 'POST' && path === '/device/intervencion') {
      try {
        const { id, tipo, descripcion, notas } = await request.json();
        if (!id || !tipo || !descripcion) return json({ error: 'Faltan campos' }, 400, cors);
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
        await env.HERO_KV.put(id, JSON.stringify(device));
        return json({ ok: true, intervencion }, 200, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }


    // ── POST / → email via Resend ─────────────────────────────
    if (request.method === 'POST') {
      try {
        const { to, subject, html, text, from } = await request.json();
        if (!to || !subject || !html) return json({ error: 'Faltan campos: to, subject, html' }, 400, cors);
        const resendResp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: from || 'Fernando Romero <it@heroinsuranceusa.com>',
            to: Array.isArray(to) ? to : [to],
            subject, html, text: text || '',
          }),
        });
        const result = await resendResp.json();
        return json(result, resendResp.status, cors);
      } catch (err) { return json({ error: err.message }, 500, cors); }
    }

    return json({ error: 'Ruta no encontrada' }, 404, cors);
  }
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...headers, 'Content-Type': 'application/json' }
  });
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

async function signAuth(env, id, email) {
  if (!env.AUTH_HMAC_SECRET) throw new Error('Falta AUTH_HMAC_SECRET');
  return hmacSign(env.AUTH_HMAC_SECRET, id + '|' + email.toLowerCase());
}

async function verifyAuth(env, id, email, sig) {
  if (!sig || !email || !id) return false;
  const expected = await signAuth(env, id, email);
  // Comparación constante simple — los strings son cortos
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

function htmlResponse(html, status = 200, cors = {}) {
  return new Response(html, {
    status, headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// Lista única de autorizadores — usada por el POST (envío de emails) y por
// el GET /solicitud-cuenta/autorizar (para resolver email → nombre).
const AUTHORIZER_LIST = [
  { email: 'jgutierrez@heroinsuranceusa.com',  nombre: 'Jesús Gutiérrez' },
  { email: 'contracting@heroinsuranceusa.com', nombre: 'Anny Medina' },
  { email: 'hr@heroinsuranceusa.com',          nombre: 'Aurys Rodríguez' },
];
function AUTHORIZER_BY_EMAIL(email) {
  const e = (email || '').toLowerCase();
  return AUTHORIZER_LIST.find(a => a.email.toLowerCase() === e) || null;
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
  const nom = ticket.nombre;
  const res = ticket.respuesta || '';
  const resHtml = res ? '<div style="background:#f7faff;border-radius:10px;border:1px solid #d8e1ea;padding:16px;margin:16px 0;">'
    + '<p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#06a3b6;">Resolucion</p>'
    + '<p style="margin:0;font-size:13px;color:#444;line-height:1.7;">' + res.split('\n').join('<br/>') + '</p></div>' : '';
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

async function getZohoToken(env) {
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
  if (!data.access_token) throw new Error('Zoho token fallido: ' + JSON.stringify(data));
  return data.access_token;
}

async function getGoogleToken(env) {
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
  if (!tokenData.access_token) throw new Error('Token fallido: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

// /api/notifyReminders.mjs
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const token = url.searchParams.get('token');
    if (!token || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    }

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

    // 1) Siguiente kickoff
    const nowISO = new Date().toISOString();
    const { data: nextGs } = await supabase
      .from('games').select('*')
      .gt('start_time', nowISO).order('start_time').limit(1);
    const next = nextGs?.[0];
    if (!next) return res.json({ ok: true, msg: 'No hay próximos juegos.' });

    const tKick = new Date(next.start_time).getTime();
    const diffHours = (tKick - Date.now()) / 36e5;
    if (diffHours > 3) {
      return res.json({ ok: true, msg: `Faltan ${diffHours.toFixed(2)}h; no es hora de recordar.` });
    }

    // Semana del juego
    const week = next.week;

    // 2) Jugadores sin pick
    const { data: players } = await supabase.from('standings').select('user_id');
    const ids = players?.map(p => p.user_id) || [];

    const { data: picksW } = await supabase.from('picks').select('user_id').eq('week', week);
    const already = new Set((picksW || []).map(x => x.user_id));
    const pending = ids.filter(id => !already.has(id));

    if (!pending.length) return res.json({ ok: true, msg: 'Todos ya tienen pick.' });

    // 3) Emails
    const { data: profs } = await supabase.from('profiles').select('id,email').in('id', pending);
    const emails = (profs || []).map(p => p.email).filter(Boolean);

    // 4) Enviar con Resend (si está configurado)
    if (process.env.RESEND_API_KEY) {
      const base = process.env.SITE_URL || process.env.VERCEL_URL || '';
      const autopickInfo = `${base}/`; // link a tu sitio

      const sendOne = async (to) => {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM || 'survivor@yourdomain.com',
            to,
            subject: 'Recordatorio: elige tu pick (faltan ~3h)',
            html: `
              <p>¡Hey! Falta poco para el kickoff de la semana ${week}.</p>
              <p>Aún no has elegido tu pick. Entra a la liga y elige ahora:</p>
              <p><a href="${autopickInfo}" target="_blank">Abrir Survivor</a></p>
              <p>Si no eliges, aplicaremos el auto-pick al favorito más fuerte disponible.</p>`
          })
        });
      };
      await Promise.all(emails.map(sendOne));
    } else {
      console.log('REMINDER (solo log, sin RESEND):', emails);
    }

    return res.json({ ok: true, reminded: emails.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

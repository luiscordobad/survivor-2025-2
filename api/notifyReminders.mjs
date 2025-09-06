// api/notifyReminders.mjs
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const token = url.searchParams.get('token');
    if (!token || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ ok:false, error:'UNAUTHORIZED' });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // siguiente juego
    const nowISO = new Date().toISOString();
    const { data: nextGs } = await supabase
      .from('games').select('*').gt('start_time', nowISO).order('start_time').limit(1);
    const next = nextGs?.[0];
    if (!next) return res.json({ ok:true, msg:'No hay próximos juegos' });

    const diffHours = (new Date(next.start_time).getTime() - Date.now()) / 36e5;
    if (diffHours > 3) return res.json({ ok:true, msg:`Faltan ${diffHours.toFixed(2)}h` });

    const week = next.week;

    // jugadores sin pick
    const { data: st } = await supabase.from('standings').select('user_id');
    const allIds = st?.map(x=>x.user_id) || [];
    const { data: pks } = await supabase.from('picks').select('user_id').eq('week', week);
    const already = new Set((pks||[]).map(x=>x.user_id));
    const pending = allIds.filter(id=>!already.has(id));
    if (!pending.length) return res.json({ ok:true, msg:'Todos tienen pick' });

    const { data: profs } = await supabase.from('profiles').select('id,email').in('id', pending);
    const emails = (profs||[]).map(p=>p.email).filter(Boolean);

    if (process.env.RESEND_API_KEY) {
      const base = process.env.SITE_URL || `https://${req.headers.host}`;
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
            subject: `Recordatorio: faltan ~3h para kickoff (W${week})`,
            html: `<p>¡Hey! Falta poco para el kickoff de la semana ${week}.</p>
                   <p>Aún no has elegido tu pick. Entra a la liga:</p>
                   <p><a href="${base}" target="_blank">${base}</a></p>
                   <p>Si no eliges, aplicaremos auto-pick al favorito más fuerte disponible.</p>`
          })
        });
      };
      await Promise.all(emails.map(sendOne));
    } else {
      console.log('Recordatorios (sin RESEND, solo log):', emails);
    }

    return res.json({ ok:true, reminded: emails.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok:false, error: err.message });
  }
}

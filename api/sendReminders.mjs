import fetch from 'node-fetch';
import { DateTime } from 'luxon';
import { supa } from './_supabase.mjs';
function guard(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const token = url.searchParams.get('token') || req.headers['x-cron-token'];
  if (process.env.CRON_TOKEN && token !== process.env.CRON_TOKEN) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

const hoursBefore = 3;
export default async function handler(req, res) {
  if (!guard(req, res)) return;
  try {
    const now = DateTime.utc();
    const until = now.plus({ hours: hoursBefore + 1 });
    const { data: games } = await supa.from('games').select('*').gte('start_time', now.toISO()).lte('start_time', until.toISO()).eq('season', 2025).eq('status', 'scheduled');
    if (!games?.length) return res.status(200).json({ ok: true, msg: 'no games soon' });
    const weeks = [...new Set(games.map(g => g.week))];
    const { data: members } = await supa.from('league_members').select('user_id');
    for (const w of weeks) {
      for (const m of members || []) {
        const { data: pick } = await supa.from('picks').select('id').eq('user_id', m.user_id).eq('week', w).maybeSingle();
        if (pick) continue;
        const { data: prof } = await supa.from('profiles').select('email, display_name').eq('id', m.user_id).maybeSingle();
        if (!prof?.email) continue;
        await sendEmail(prof.email, `Recordatorio Survivor W${w}`, `Hola ${prof.display_name},\n\nTienes pendiente tu pick para la Semana ${w}. Entra a la app y elige antes del kickoff.\n\nSi no eliges, haremos autopick del favorito más fuerte disponible.\n`);
      }
    }
    res.status(200).json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
async function sendEmail(to, subject, text) {
  if (process.env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', { method:'POST', headers:{ 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json' }, body: JSON.stringify({ from: process.env.EMAIL_FROM || 'Survivor <no-reply@survivor.app>', to, subject, text }) });
  } else { console.log('Email mock →', { to, subject }); }
}

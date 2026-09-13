import fetch from 'node-fetch';
import { DateTime } from 'luxon';
import { supa } from './_supabase.mjs';
import { sendPush } from './_push.mjs';

const SEASON = Number(process.env.SEASON || '2026');
const LEAGUE_NAME = process.env.VITE_LEAGUE_NAME || 'Survivor 2026';

function guard(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const token = url.searchParams.get('token') || req.headers['x-cron-token'];
  if (process.env.CRON_TOKEN && token !== process.env.CRON_TOKEN) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

function emailShell({ title, greeting, body, ctaText, ctaUrl, footnote }) {
  return `
  <div style="background:#0a0d14;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#12161f;border:1px solid #262d3a;border-radius:16px;overflow:hidden;">
      <div style="background:#22c55e;padding:18px 24px;">
        <span style="color:#04150a;font-weight:800;font-size:15px;">🏈 ${LEAGUE_NAME}</span>
      </div>
      <div style="padding:24px;color:#eef1f6;">
        <h1 style="margin:0 0 12px;font-size:18px;">${title}</h1>
        <p style="margin:0 0 16px;color:#c2c8d6;font-size:14px;line-height:1.6;">${greeting}</p>
        <div style="color:#eef1f6;font-size:14px;line-height:1.6;">${body}</div>
        ${ctaUrl ? `
        <div style="margin-top:22px;">
          <a href="${ctaUrl}" style="display:inline-block;background:#22c55e;color:#04150a;font-weight:700;font-size:14px;padding:10px 20px;border-radius:10px;text-decoration:none;">${ctaText || 'Abrir la app'}</a>
        </div>` : ''}
        ${footnote ? `<p style="margin-top:20px;color:#8b93a7;font-size:12px;">${footnote}</p>` : ''}
      </div>
    </div>
  </div>`;
}

const hoursBefore = 3;
export default async function handler(req, res) {
  if (!guard(req, res)) return;
  try {
    const base = process.env.SITE_URL || process.env.VITE_SITE_URL || `https://${req.headers.host}`;
    const now = DateTime.utc();
    const until = now.plus({ hours: hoursBefore + 1 });
    const { data: games } = await supa.from('games').select('*').gte('start_time', now.toISO()).lte('start_time', until.toISO()).eq('season', SEASON).eq('status', 'scheduled');
    if (!games?.length) return res.status(200).json({ ok: true, msg: 'no games soon' });
    const weeks = [...new Set(games.map(g => g.week))];
    const { data: members } = await supa.from('profiles').select('id').eq('season', SEASON);
    let sent = 0;
    for (const w of weeks) {
      const nextKickoff = games.filter(g => g.week === w).sort((a, b) => new Date(a.start_time) - new Date(b.start_time))[0];
      const kickoffLocal = nextKickoff ? DateTime.fromISO(nextKickoff.start_time).setZone('America/Mexico_City').toFormat("cccc d 'de' LLLL, HH:mm") : null;
      for (const m of members || []) {
        const { data: pick } = await supa.from('picks').select('id').eq('user_id', m.id).eq('week', w).eq('season', SEASON).maybeSingle();
        if (pick) continue;
        const { data: prof } = await supa.from('profiles').select('email, display_name, notify_email').eq('id', m.id).maybeSingle();

        if (prof?.email && prof.notify_email !== false) {
          const html = emailShell({
            title: `⏰ Falta poco para cerrar la Semana ${w}`,
            greeting: `Hola ${prof.display_name || ''},`,
            body: `Todavía no eliges tu pick para la <b>Semana ${w}</b>${kickoffLocal ? ` y el próximo kickoff es el <b>${kickoffLocal}</b> (hora CDMX)` : ''}. Entra a la app y elige tu equipo antes de que cierre.`,
            ctaText: 'Hacer mi pick',
            ctaUrl: base,
            footnote: 'Si no eliges a tiempo, el sistema puede asignarte automáticamente el favorito más fuerte disponible que no hayas usado.',
          });
          const text = `Hola ${prof.display_name || ''},\n\nTodavía no eliges tu pick para la Semana ${w}${kickoffLocal ? ` (próximo kickoff: ${kickoffLocal} hora CDMX)` : ''}.\nEntra aquí: ${base}\n\nSi no eliges a tiempo, se puede aplicar autopick del favorito más fuerte disponible.`;
          await sendEmail(prof.email, `⏰ Falta poco para cerrar la Semana ${w} — ${LEAGUE_NAME}`, text, html);
          sent++;
        }

        const pushed = await sendPush(m.id, {
          title: `⏰ Falta poco para cerrar la Semana ${w}`,
          body: `Aún no eliges tu pick${kickoffLocal ? ` — kickoff ${kickoffLocal} (CDMX)` : ''}.`,
          url: base,
        });
        sent += pushed;
      }
    }
    res.status(200).json({ ok: true, sent });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
async function sendEmail(to, subject, text, html) {
  if (process.env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || 'Survivor <no-reply@survivor.app>', to, subject, text, html }),
    });
  } else { console.log('Email mock →', { to, subject }); }
}

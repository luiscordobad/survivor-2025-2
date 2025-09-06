// /api/syncScores.mjs
import fetch from 'node-fetch';
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

const SCORE_API_BASE =
  process.env.SCORE_API_BASE ||
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

// Mapea múltiples formatos de ESPN a nuestros enums
function mapStatus(ev) {
  const t = ev?.status?.type || {};
  if (t.name) {
    const map = {
      STATUS_SCHEDULED: 'scheduled',
      STATUS_IN_PROGRESS: 'in_progress',
      STATUS_FINAL: 'final',
      STATUS_POSTPONED: 'postponed',
      STATUS_CANCELED: 'canceled'
    };
    return map[t.name] || 'scheduled';
  }
  if (t.state) {
    const map = { pre: 'scheduled', in: 'in_progress', post: 'final' };
    return map[t.state] || 'scheduled';
  }
  return 'scheduled';
}

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  try {
    // Cubrimos antier, ayer, hoy, mañana (4 días) para capturar TNF, viernes, sábado, domingo y MNF
    const offsets = [-2, -1, 0, 1];
    let updated = 0;

    for (const off of offsets) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + off);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      const ymd = `${y}${m}${day}`;

      const r = await fetch(`${SCORE_API_BASE}?dates=${ymd}`);
      if (!r.ok) continue;

      const data = await r.json();
      const events = data?.events || [];

      for (const ev of events) {
        const comp = ev?.competitions?.[0];
        const home = comp?.competitors?.find(c => c.homeAway === 'home');
        const away = comp?.competitors?.find(c => c.homeAway === 'away');

        // status + scores
        const status = mapStatus(ev);
        const hs = Number(home?.score ?? (home?.scoreDisplay ?? '')) || null;
        const as = Number(away?.score ?? (away?.scoreDisplay ?? '')) || null;

        // winner (si final y distinto)
        const getAbbr = (c) => (c?.team?.abbreviation || c?.team?.abbrev || '').toUpperCase();
        let winner = null;
        if (status === 'final' && hs != null && as != null && hs !== as) {
          winner = hs > as ? getAbbr(home) : getAbbr(away);
        }

        // period/clock (si lo manda ESPN)
        const t = ev?.status?.type || {};
        const period = Number(t.period ?? null) || null;
        const clock  = t.displayClock || null;

        // Actualiza en DB
        const { error } = await supa.from('games').update({
          status,
          home_score: hs,
          away_score: as,
          winner_team: winner,
          period,
          clock
        }).eq('id', ev.id);

        if (!error) {
          updated++;

          // Si terminó, evalúa picks para ese juego
          if (status === 'final') {
            try {
              const proto = req.headers['x-forwarded-proto'] || 'https';
              await fetch(`${proto}://${req.headers.host}/api/evalGame?token=${process.env.CRON_TOKEN}&id=${ev.id}`);
            } catch {}
          }
        }
      }
    }

    res.status(200).json({ ok: true, updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}



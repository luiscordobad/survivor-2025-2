import fetch from 'node-fetch';
import { supa } from './_supabase.mjs';
import { DateTime } from 'luxon';

function guard(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const token = url.searchParams.get('token') || req.headers['x-cron-token'];
  if (process.env.CRON_TOKEN && token !== process.env.CRON_TOKEN) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

const SCORE_API_BASE = process.env.SCORE_API_BASE || 'https://site.api.espn.com/apis/v2/sports/football/nfl/scoreboard';
// Ajusta si cambia el primer partido de 2025:
const KICKOFF = DateTime.fromISO('2025-09-04', { zone: 'UTC' });

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  try {
    const now = DateTime.utc();
    const start = now.minus({ days: 3 });
    const end = now.plus({ days: 10 });

    let totalEvents = 0;

    for (let d = start; d <= end; d = d.plus({ days: 1 })) {
      const ymd = d.toFormat('yyyyLLdd');
      const url = `${SCORE_API_BASE}?dates=${ymd}`;
      const r = await fetch(url);
      if (!r.ok) continue;
      const data = await r.json();
      const events = data?.events || [];
      totalEvents += events.length;

      for (const ev of events) {
        const id = ev.id;
        const comp = ev.competitions?.[0];
        if (!comp) continue;

        const start_time = comp.date; // ISO
        const dt = DateTime.fromISO(start_time).toUTC();

        // Calcula semana relativa al kickoff (W1 = kickoff week)
        let week = Math.floor(dt.diff(KICKOFF, 'weeks').weeks) + 1;
        if (week < 1) week = 1;  // por si capturamos días previos

        const home = comp.competitors?.find(c => c.homeAway === 'home');
        const away = comp.competitors?.find(c => c.homeAway === 'away');

        const statusType = ev.status?.type?.name || 'STATUS_SCHEDULED';
        const statusMap = {
          'STATUS_SCHEDULED': 'scheduled',
          'STATUS_IN_PROGRESS': 'in_progress',
          'STATUS_FINAL': 'final',
          'STATUS_POSTPONED': 'postponed',
          'STATUS_CANCELED': 'canceled'
        };
        const status = statusMap[statusType] || 'scheduled';

        const home_team = (home?.team?.abbreviation || '').toUpperCase();
        const away_team = (away?.team?.abbreviation || '').toUpperCase();

        if (home_team) await supa.from('teams').upsert({
          id: home_team,
          name: home?.team?.displayName,
          city: home?.team?.location,
          logo_url: home?.team?.logo
        }, { onConflict: 'id' });

        if (away_team) await supa.from('teams').upsert({
          id: away_team,
          name: away?.team?.displayName,
          city: away?.team?.location,
          logo_url: away?.team?.logo
        }, { onConflict: 'id' });

        const hs = Number(home?.score) || null;
        const as = Number(away?.score) || null;

        let winner = null;
        if (status === 'final' && hs != null && as != null && hs !== as) {
          winner = hs > as ? home_team : away_team;
        }

        await supa.from('games').upsert({
          id,
          week,
          season: 2025,
          start_time,
          home_team,
          away_team,
          status,
          home_score: hs,
          away_score: as,
          winner_team: winner
        }, { onConflict: 'id' });

        // Si terminó, evalúa picks
        if (status === 'final') {
          try {
            await fetch(`${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/evalGame?token=${process.env.CRON_TOKEN}&id=${id}`);
          } catch {}
        }
      }
    }

    res.status(200).json({ ok: true, scanned_days: end.diff(start, 'days').days + 1, events: totalEvents });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

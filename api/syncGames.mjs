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

const SCORE_API_BASE = process.env.SCORE_API_BASE || 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const KICKOFF = DateTime.fromISO('2025-09-04', { zone: 'UTC' }); // Semana 1

function mapStatus(ev) {
  const t = ev?.status?.type || {};
  // ESPN a veces usa "name" (STATUS_FINAL) y otras "state" (pre, in, post)
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
    // ventana: 3 días atrás a 10 días adelante (cubre TNF, viernes, sábado, domingo, MNF, Londres, Thanksgiving, etc.)
    const now = DateTime.utc();
    const start = now.minus({ days: 3 });
    const end = now.plus({ days: 10 });

    let totalEvents = 0;
    const days = [];

    for (let d = start; d <= end; d = d.plus({ days: 1 })) {
      days.push(d.toFormat('yyyyLLdd'));
    }

    for (const ymd of days) {
      const url = `${SCORE_API_BASE}?dates=${ymd}`;
      const r = await fetch(url);
      if (!r.ok) continue;
      const data = await r.json();
      const events = data?.events || [];
      totalEvents += events.length;

      for (const ev of events) {
        const comp = ev?.competitions?.[0];
        if (!comp) continue;

        const start_time = comp.date; // ISO
        const dt = DateTime.fromISO(start_time).toUTC();
        let week = Math.floor(dt.diff(KICKOFF, 'weeks').weeks) + 1;
        if (week < 1) week = 1;

        const home = comp.competitors?.find(c => c.homeAway === 'home');
        const away = comp.competitors?.find(c => c.homeAway === 'away');

        const status = mapStatus(ev);

        const getAbbr = (c) => (c?.team?.abbreviation || c?.team?.abbrev || '').toUpperCase();
        const home_team = getAbbr(home);
        const away_team = getAbbr(away);

        // upsert teams
        const putTeam = async (c) => {
          if (!c) return;
          const id = getAbbr(c);
          if (!id) return;
          await supa.from('teams').upsert({
            id,
            name: c.team?.displayName || c.team?.shortDisplayName || id,
            city: c.team?.location || '',
            logo_url: (Array.isArray(c.team?.logos) && c.team.logos[0]?.href) || c.team?.logo || null
          }, { onConflict: 'id' });
        };
        await putTeam(home);
        await putTeam(away);

        const hs = Number(home?.score ?? (home?.scoreDisplay ?? '')) || null;
        const as = Number(away?.score ?? (away?.scoreDisplay ?? '')) || null;

        let winner = null;
        if (status === 'final' && hs != null && as != null && hs !== as) {
          winner = hs > as ? home_team : away_team;
        }

        await supa.from('games').upsert({
          id: ev.id,
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

        if (status === 'final') {
          try {
            await fetch(`${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/evalGame?token=${process.env.CRON_TOKEN}&id=${ev.id}`);
          } catch {}
        }
      }
    }

    res.status(200).json({ ok: true, scanned_days: days.length, events: totalEvents });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

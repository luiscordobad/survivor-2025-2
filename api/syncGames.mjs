// api/syncGames.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY;
const CRON_TOKEN   = process.env.CRON_TOKEN || process.env.VITE_CRON_TOKEN;
const SEASON       = Number(process.env.SEASON || '2025');

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// Helpers
async function fetchJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'SurvivorSync/1.0', 'Accept':'application/json' }});
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}
const U = (s) => String(s || '').toUpperCase().trim();

function asYMD(iso) {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function loadScoreboard(yyyymmdd) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${yyyymmdd}`;
  return fetchJSON(url);
}

function mapStatus(es) {
  const t = (es?.status?.type?.name || '').toUpperCase();
  if (t.includes('FINAL')) return 'final';
  if (t.includes('IN') || t.includes('LIVE')) return 'in_progress';
  if (t.includes('POST')) return 'final';
  return 'scheduled';
}

/**
 * Estrategia simple (la que te funcionaba):
 * - Si pasas ?week=N: toma los juegos de esa semana en tu BD para obtener las fechas (YMD) y consulta scoreboard por día.
 * - Si la semana NO tiene juegos aún (sembrado en blanco), usa un arreglo de YMDs conocido (Jue..Lun de la semana 1 o actualiza a las fechas reales).
 */
async function syncGamesWeek(week) {
  // 1) Intentar derivar fechas del propio calendario local
  const { data: myGames } = await sb
    .from('games')
    .select('start_time')
    .eq('season', SEASON)
    .eq('week', week);

  let ymds = [...new Set((myGames || []).map(g => asYMD(g.start_time)))];

  // 2) Si no hay fechas locales, usa un set de días “base” (ajústalo según necesites)
  if (ymds.length === 0) {
    // Para W1 2025 (ajústalo si quieres otras semanas semilla)
    ymds = ['20250904','20250905','20250906','20250907','20250908']; // Thu..Mon apertura 2025
  }

  let upserts = 0;

  for (const ymd of ymds) {
    const sbJson = await loadScoreboard(ymd);
    for (const ev of (sbJson?.events || [])) {
      const cmp = ev?.competitions?.[0];
      const comps = cmp?.competitors || [];
      const home = comps.find(c => (c.homeAway || c.homeaway) === 'home');
      const away = comps.find(c => (c.homeAway || c.homeaway) === 'away');
      if (!home || !away) continue;

      const homeAbbr = U(home?.team?.abbreviation);
      const awayAbbr = U(away?.team?.abbreviation);
      const startIso = cmp?.date || ev?.date;
      if (!homeAbbr || !awayAbbr || !startIso) continue;

      const status = mapStatus(cmp || ev);
      const homeScore = home?.score != null ? Number(home.score) : null;
      const awayScore = away?.score != null ? Number(away.score) : null;

      // UPSERT por (id si viene) o por combinación (season, week, home, away, start_time)
      const row = {
        id: ev.id || null,
        season: SEASON,
        week,
        home_team: homeAbbr,
        away_team: awayAbbr,
        start_time: startIso,
        status,
        home_score: homeScore,
        away_score: awayScore
      };

      // Si hay id usamos id; si no, intentamos evitar duplicados buscando por llaves "naturales"
      if (row.id) {
        const { error } = await sb.from('games').upsert(row, { onConflict: 'id' });
        if (!error) upserts++;
      } else {
        const { data: exists } = await sb
          .from('games')
          .select('id')
          .eq('season', SEASON)
          .eq('week', week)
          .eq('home_team', homeAbbr)
          .eq('away_team', awayAbbr)
          .eq('start_time', startIso)
          .maybeSingle();
        if (!exists) {
          const { error } = await sb.from('games').insert(row);
          if (!error) upserts++;
        } else {
          const { error } = await sb.from('games').update(row).eq('id', exists.id);
          if (!error) upserts++;
        }
      }
    }
  }
  return { updated: upserts, weeks: [week] };
}

export default async function handler(req, res) {
  try {
    const { token, week } = req.query;
    if (!token || token !== CRON_TOKEN) return res.status(401).json({ ok:false, error:'bad token' });

    const wk = Number(week || '1');
    const r = await syncGamesWeek(wk);
    return res.json({ ok:true, action:'syncGames', ...r });
  } catch (e) {
    return res.status(500).json({ ok:false, error:e.message });
  }
}

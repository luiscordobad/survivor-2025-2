// api/syncGames.mjs
// Descubre el calendario NFL (partidos + marcadores) desde The Odds API.
// Antes usaba la API pública de ESPN, pero ESPN bloquea por IP a los
// servidores de Vercel/AWS (confirmado: la misma URL funciona desde un
// navegador normal pero no desde la función serverless). The Odds API sí
// acepta tráfico de servidor -- requiere ODDS_API_KEY (the-odds-api.com,
// tiene plan gratuito).
//
// A diferencia de ESPN, The Odds API no tiene concepto de "semana": el
// número de semana se calcula por fecha (ver _theoddsapi.mjs). Por eso este
// endpoint ya no recibe `week` -- sincroniza de una vez todo lo que The Odds
// API tiene visible (próximos partidos + los últimos 3 días).
import { createClient } from '@supabase/supabase-js';
import { abbrFor, weekForDate, fetchOddsApiJSON } from './_theoddsapi.mjs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.VITE_SUPABASE_SERVICE_KEY;
const CRON_TOKEN   = process.env.CRON_TOKEN || process.env.VITE_CRON_TOKEN;
const SEASON       = Number(process.env.SEASON || '2026');

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

function scoreFor(scores, teamName) {
  const row = (scores || []).find((s) => s.name === teamName);
  return row?.score != null ? Number(row.score) : null;
}

async function syncFromOddsApi() {
  // /odds trae próximos partidos (h2h es el market más barato, solo
  // necesitamos el calendario aquí; los spreads/ML los llena syncOdds.mjs).
  // /scores trae partidos en vivo/terminados de los últimos días.
  const [upcoming, recent] = await Promise.all([
    fetchOddsApiJSON('odds', { regions: 'us', markets: 'h2h', oddsFormat: 'american', dateFormat: 'iso' }),
    fetchOddsApiJSON('scores', { daysFrom: '3', dateFormat: 'iso' }).catch(() => []),
  ]);

  const byId = new Map();
  for (const ev of upcoming || []) byId.set(ev.id, { ...ev, _live: false });
  for (const ev of recent || []) byId.set(ev.id, { ...ev, _live: true });

  let upserts = 0;
  const weeksSeen = new Set();

  for (const ev of byId.values()) {
    if (!ev.home_team || !ev.away_team || !ev.commence_time) continue;

    const home_team = abbrFor(ev.home_team);
    const away_team = abbrFor(ev.away_team);
    const week = weekForDate(ev.commence_time, SEASON);
    weeksSeen.add(week);

    const row = {
      id: ev.id,
      season: SEASON,
      week,
      home_team,
      away_team,
      start_time: ev.commence_time,
      external_id: ev.id,
      updated_at: new Date().toISOString(),
    };

    if (ev._live) {
      row.home_score = scoreFor(ev.scores, ev.home_team);
      row.away_score = scoreFor(ev.scores, ev.away_team);
      row.status = ev.completed ? 'final' : (ev.scores ? 'in_progress' : 'scheduled');
    } else {
      // Viene solo de /odds (todavía no arranca): no pisar un estado o
      // marcador que ya hayamos guardado por otra vía.
      const { data: existing } = await sb
        .from('games')
        .select('status, home_score, away_score')
        .eq('id', ev.id)
        .maybeSingle();
      row.status = existing?.status || 'scheduled';
      row.home_score = existing?.home_score ?? null;
      row.away_score = existing?.away_score ?? null;
    }

    const { error } = await sb.from('games').upsert(row, { onConflict: 'id' });
    if (!error) upserts++;
  }

  return { updated: upserts, weeks: [...weeksSeen].sort((a, b) => a - b) };
}

export default async function handler(req, res) {
  try {
    const { token } = req.query;
    if (!token || token !== CRON_TOKEN) return res.status(401).json({ ok: false, error: 'bad token' });

    const r = await syncFromOddsApi();
    return res.json({ ok: true, action: 'syncGames', season: SEASON, ...r });
  } catch (e) {
    console.error('syncGames error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

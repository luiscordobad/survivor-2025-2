// api/control.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const CRON_TOKEN = process.env.CRON_TOKEN || process.env.VITE_CRON_TOKEN;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE);

// --- helpers -------------------------------------------------
async function fetchJson(url, opts = {}, tries = 3) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Survivor-2025 sync bot)',
    'Accept': 'application/json;charset=UTF-8',
    ...opts.headers,
  };
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { ...opts, headers });
    if (r.ok) return r.json();
    // reintentos ante 403/404/500 intermitentes
    await new Promise(res => setTimeout(res, 600 * (i + 1)));
  }
  // último intento: devuelve error “legible”
  const r = await fetch(url, { ...opts, headers });
  const txt = await r.text();
  throw new Error(`ESPN ${r.status} - ${url} - ${txt.slice(0, 200)}`);
}

function pickStatus(obj) {
  // intenta mapear bloque status en formatos distintos
  const st = obj?.status || obj?.competitions?.[0]?.status || obj?.header?.competitions?.[0]?.status;
  const type = st?.type || st;
  const state = type?.state || type?.name || st?.name;
  const completed = Boolean(type?.completed || type?.state === 'post' || type?.name?.toUpperCase?.().includes('FINAL'));
  return { raw: st || type || null, state: (state || '').toLowerCase(), completed };
}

function pickScores(obj) {
  // busca competidores con score en varios posibles layouts
  const comps =
    obj?.competitions?.[0]?.competitors ||
    obj?.header?.competitions?.[0]?.competitors ||
    obj?.competitors ||
    [];
  const mapByHome = {};
  comps.forEach(c => {
    const homeAway = c?.homeAway || c?.homeaway;
    const team = c?.team?.abbreviation || c?.team?.shortDisplayName || c?.team?.name;
    const score = c?.score != null ? Number(c.score) : (c?.linescores?.reduce?.((a, s) => a + Number(s.value || 0), 0) ?? null);
    if (homeAway && team != null) mapByHome[homeAway.toLowerCase()] = { team, score };
  });
  return {
    homeTeam: mapByHome.home?.team,
    awayTeam: mapByHome.away?.team,
    homeScore: mapByHome.home?.score ?? null,
    awayScore: mapByHome.away?.score ?? null,
  };
}

function yyyymmddFromISO(iso) {
  try {
    const d = new Date(iso);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  } catch {
    return null;
  }
}

// --- ESPN fallbacks -----------------------------------------
async function espnSummaryById(id) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`;
  return fetchJson(url);
}
async function espnCoreEvent(id) {
  const url = `https://site.api.espn.com/apis/core/v2/events/${id}`;
  return fetchJson(url);
}
async function espnScoreboardByDate(yyyymmdd) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${yyyymmdd}`;
  return fetchJson(url);
}

// --- DB helpers ----------------------------------------------
async function getGameRowById(game_id) {
  const { data, error } = await sb
    .from('games')
    .select('id, season, week, status, start_time, home_team, away_team')
    .eq('id', game_id)
    .single();
  if (error) throw error;
  return data;
}

async function updateGameScore(game_id, fields) {
  const { error } = await sb.from('games').update(fields).eq('id', game_id);
  if (error) throw error;
}

// --- actions --------------------------------------------------
async function syncScoresOne(game_id, force = false) {
  const g = await getGameRowById(game_id);
  // 1) summary?event=
  try {
    const j = await espnSummaryById(game_id);
    const st = pickStatus(j);
    const sc = pickScores(j);
    if (st.state || st.completed || (sc.homeScore != null && sc.awayScore != null)) {
      const fields = {};
      if (st.completed) fields.status = 'final';
      else if (st.state) fields.status = st.state.includes('in') ? 'in_progress' : (st.state.includes('post') ? 'final' : 'scheduled');
      if (sc.homeScore != null) fields.home_score = sc.homeScore;
      if (sc.awayScore != null) fields.away_score = sc.awayScore;
      if (Object.keys(fields).length) await updateGameScore(game_id, fields);
      return { updated: 1, source: 'summary' };
    }
  } catch (e) {
    // sigue al fallback
  }

  // 2) core/v2/events/{id}
  try {
    const j = await espnCoreEvent(game_id);
    const st = pickStatus(j);
    const sc = pickScores(j);
    if (st.state || st.completed || (sc.homeScore != null && sc.awayScore != null)) {
      const fields = {};
      if (st.completed) fields.status = 'final';
      else if (st.state) fields.status = st.state.includes('in') ? 'in_progress' : (st.state.includes('post') ? 'final' : 'scheduled');
      if (sc.homeScore != null) fields.home_score = sc.homeScore;
      if (sc.awayScore != null) fields.away_score = sc.awayScore;
      if (Object.keys(fields).length) await updateGameScore(game_id, fields);
      return { updated: 1, source: 'core' };
    }
  } catch (e) {
    // sigue al fallback
  }

  // 3) scoreboard?dates=YYYYMMDD  (usando fecha de start_time)
  const ymd = yyyymmddFromISO(g.start_time);
  if (ymd) {
    try {
      const j = await espnScoreboardByDate(ymd);
      const evt = (j?.events || []).find(x => String(x?.id) === String(game_id));
      if (evt) {
        const st = pickStatus(evt);
        const sc = pickScores(evt);
        const fields = {};
        if (st.completed) fields.status = 'final';
        else if (st.state) fields.status = st.state.includes('in') ? 'in_progress' : (st.state.includes('post') ? 'final' : 'scheduled');
        if (sc.homeScore != null) fields.home_score = sc.homeScore;
        if (sc.awayScore != null) fields.away_score = sc.awayScore;

        if (Object.keys(fields).length) {
          await updateGameScore(game_id, fields);
          return { updated: 1, source: 'scoreboard' };
        }
      }
    } catch (e) {
      // nada
    }
  }

  // 4) último recurso: si pasó mucho y sigue scheduled, marcar in_progress/final
  if (force) {
    const now = Date.now();
    const start = new Date(g.start_time).getTime();
    if (now > start + 1000 * 60 * 240) {
      await updateGameScore(game_id, { status: 'final' });
      return { updated: 1, source: 'forced-final' };
    } else if (now > start) {
      await updateGameScore(game_id, { status: 'in_progress' });
      return { updated: 1, source: 'forced-live' };
    }
  }

  return { updated: 0, source: 'none' };
}

async function syncScoresBatch(week) {
  const { data: games, error } = await sb
    .from('games')
    .select('id')
    .eq('season', 2025)
    .eq('week', week);
  if (error) throw error;
  let n = 0;
  for (const g of games || []) {
    const r = await syncScoresOne(g.id, false);
    n += r.updated ? 1 : 0;
  }
  return { updated: n, weeks: [week] };
}

async function syncAll() {
  // normalmente llamas games + scores + odds;
  // aquí nos importa sobre todo scores robusto
  const w = 1; // o detecta semanas activas dinámicamente si quieres
  const scores = await syncScoresBatch(w);
  return { ok: true, action: 'syncAll', scores };
}

// --- handler --------------------------------------------------
export default async function handler(req, res) {
  try {
    const { action, token, week, game_id, force } = req.query;
    if (!token || token !== CRON_TOKEN) {
      return res.status(401).json({ ok: false, error: 'bad token' });
    }

    if (action === 'syncScores') {
      if (game_id) {
        const r = await syncScoresOne(game_id, force === '1' || force === 'true');
        return res.json({ ok: true, action, ...r });
      } else if (week) {
        const r = await syncScoresBatch(Number(week));
        return res.json({ ok: true, action, ...r });
      } else {
        // si no pasas nada, intenta W1 por defecto
        const r = await syncScoresBatch(1);
        return res.json({ ok: true, action, ...r });
      }
    }

    if (action === 'syncAll') {
      const r = await syncAll();
      return res.json(r);
    }

    // deja el resto de acciones que ya tienes (syncGames, syncOdds, autopick, etc.)
    return res.json({ ok: true, action: action || 'noop' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

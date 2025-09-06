// api/backfillSeason.mjs
// Backfill NFL (ESPN) a "games" usando external_id (upsert por clave única)
// Robusto: si ?week= falla (HTTP 500 o vacío), cae a calendar + dates=YYYYMMDD

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON_KEY;
const CRON_TOKEN = process.env.CRON_TOKEN;

const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// Normalizador de abreviaciones a tus IDs
const TEAM_MAP = { JAX: "JAC", WSH: "WAS", LVR: "LV" };
const normTeam = (a) => TEAM_MAP[a] || a;

function parseEventToRow(event, season, week, seasonType) {
  const comp = (event.competitions || [])[0] || {};
  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");

  const homeId = normTeam(home?.team?.abbreviation || "");
  const awayId = normTeam(away?.team?.abbreviation || "");

  const home_score = home?.score != null ? Number(home.score) : null;
  const away_score = away?.score != null ? Number(away.score) : null;

  const state = event?.status?.type?.state || "pre";
  const status =
    state === "post" ? "final" : state === "in" ? "in_progress" : "scheduled";

  const venue = comp.venue || {};
  const venue_city = venue?.address?.city || null;

  const external_id = `${season}:${seasonType}:${week}:${event.id}`;

  return {
    external_id,
    season,
    week,
    start_time: event?.date || null,
    status,
    home_team: homeId,
    away_team: awayId,
    home_score,
    away_score,
    venue_city,
  };
}

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 SurvivorBot" } });
  if (!r.ok) throw new Error(`ESPN HTTP ${r.status} - ${url}`);
  return r.json();
}

// ------------- Calendar -------------
async function fetchCalendar(season, seasonType) {
  // Devuelve [{week: n, start: 'YYYYMMDD', end: 'YYYYMMDD'}, ...]
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/calendar?season=${season}&seasontype=${seasonType}`;
  const j = await fetchJSON(url);
  // j.weeks: [{number, startDate, endDate}, ...]
  const weeks = (j?.weeks || []).map((w) => ({
    week: Number(w.number),
    start: (w.startDate || "").replaceAll("-", ""), // YYYYMMDD
    end: (w.endDate || "").replaceAll("-", ""),
  }));
  return weeks;
}

// ------------- scoreboards -------------
async function fetchWeekByWeekParam(season, week, seasonType) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?season=${season}&seasontype=${seasonType}&week=${week}`;
  const j = await fetchJSON(url);
  const events = j?.events || [];
  return events;
}

function* datesRangeYYYYMMDD(start, end) {
  const toDate = (s) =>
    new Date(
      Number(s.slice(0, 4)),
      Number(s.slice(4, 6)) - 1,
      Number(s.slice(6, 8))
    );
  const pad2 = (x) => (x < 10 ? `0${x}` : `${x}`);
  const d0 = toDate(start);
  const d1 = toDate(end);
  for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    yield `${y}${m}${day}`;
  }
}

async function fetchWeekByDatesRange(season, week, seasonType, startYYYYMMDD, endYYYYMMDD) {
  const seen = new Set();
  const events = [];
  for (const d of datesRangeYYYYMMDD(startYYYYMMDD, endYYYYMMDD)) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${d}`;
    try {
      const j = await fetchJSON(url);
      const evs = j?.events || [];
      for (const ev of evs) {
        // Filtra solo NFL de esa temporada/phase aproximada (no es perfecto pero cambia muy poco)
        const id = ev?.id;
        if (!id || seen.has(id)) continue;
        // Acepta todo; el week lo ponemos nosotros (el de calendar), el season va por parámetro
        seen.add(id);
        events.push(ev);
      }
      await new Promise((r) => setTimeout(r, 80)); // pequeño respiro
    } catch {
      // si un día falla, seguimos con el siguiente
    }
  }
  return events;
}

// ------------- upsert -------------
async function upsertGames(rows) {
  if (!rows.length) return 0;
  const { error } = await sb.from("games").upsert(rows, {
    onConflict: "external_id",
  });
  if (error) throw error;
  return rows.length;
}

// ------------- handler -------------
export default async function handler(req, res) {
  try {
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ ok: false, error: "Missing SUPABASE envs" });
    }
    if (!CRON_TOKEN) {
      return res.status(500).json({ ok: false, error: "Missing CRON_TOKEN env" });
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");
    const season = Number(url.searchParams.get("season"));
    const playoffs = url.searchParams.get("playoffs") === "true";

    if (token !== CRON_TOKEN) {
      return res.status(401).json({ ok: false, error: "Bad token" });
    }
    if (!season || season < 2010 || season > 2025) {
      return res.status(400).json({ ok: false, error: "season inválido (2010–2025)" });
    }

    let total = 0;

    // Regular season (2)
    const regularWeeks = await fetchCalendar(season, 2);
    for (const { week, start, end } of regularWeeks) {
      let events = [];
      try {
        events = await fetchWeekByWeekParam(season, week, 2);
      } catch { /* 500 de ESPN, ignoramos */ }
      if (!events || events.length === 0) {
        // Fallback por rango de fechas
        events = await fetchWeekByDatesRange(season, week, 2, start, end);
      }
      const rows = (events || []).map((ev) => parseEventToRow(ev, season, week, 2));
      if (rows.length) total += await upsertGames(rows);
      await new Promise((r) => setTimeout(r, 120));
    }

    // Playoffs (3)
    if (playoffs) {
      const postWeeks = await fetchCalendar(season, 3);
      for (const { week, start, end } of postWeeks) {
        let events = [];
        try {
          events = await fetchWeekByWeekParam(season, week, 3);
        } catch { /* ignore */ }
        if (!events || events.length === 0) {
          events = await fetchWeekByDatesRange(season, week, 3, start, end);
        }
        const rows = (events || []).map((ev) => parseEventToRow(ev, season, week, 3));
        if (rows.length) total += await upsertGames(rows);
        await new Promise((r) => setTimeout(r, 120));
      }
    }

    return res.json({ ok: true, season, playoffs, upserted: total });
  } catch (e) {
    console.error("backfillSeason error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}


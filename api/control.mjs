// /api/control.mjs
export const config = { runtime: "edge" };

const OK = (body) =>
  new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
const ERR = (status, msg) =>
  new Response(JSON.stringify({ ok: false, error: msg }, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY =
  process.env.VITE_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
const CRON_TOKEN =
  process.env.VITE_CRON_TOKEN || process.env.CRON_TOKEN || "changeme";
const SEASON = Number(process.env.SEASON || "2025");
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing Supabase envs");
}

const sfetch = async (path, opts = {}) =>
  fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      ...(opts.headers || {}),
    },
  });

const espnScoreboard = async (week) => {
  // ESPN weekly scoreboard (regular season = seasontype=2)
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}`;
  const r = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error(`ESPN HTTP ${r.status} - ${url}`);
  return r.json();
};

function parseState(evt) {
  // evt.status.type.state in|pre|post
  const state = evt?.status?.type?.state || "pre";
  if (state === "pre") return "scheduled";
  if (state === "in") return "in_progress";
  return "final";
}

function parseTeams(evt) {
  const comp = evt?.competitions?.[0];
  const comps = comp?.competitors || [];
  const home = comps.find((c) => c.homeAway === "home");
  const away = comps.find((c) => c.homeAway === "away");
  const norm = (c) => c?.team?.abbreviation?.toUpperCase()?.trim();
  return {
    home: norm(home),
    away: norm(away),
    homeScore:
      home?.score != null && home?.score !== "" ? Number(home.score) : null,
    awayScore:
      away?.score != null && away?.score !== "" ? Number(away.score) : null,
    period: comp?.status?.period ?? null,
    clock: comp?.status?.displayClock ?? null,
    possession:
      comp?.situation?.possession?.toUpperCase?.() ||
      comp?.status?.type?.detail?.includes("ball")
        ? comp?.status?.type?.detail
        : null,
    redZone: comp?.situation?.isRedZone ?? null,
    startISO: evt?.date || null,
  };
}

async function syncScoresForWeek(week) {
  const data = await espnScoreboard(week);
  const events = data?.events || [];
  let updates = 0;

  for (const e of events) {
    const id = Number(e?.id); // coincide con games.id en tu DB (4017...)
    const state = parseState(e);
    const { home, away, homeScore, awayScore, period, clock, possession, redZone, startISO } =
      parseTeams(e);

    // PATCH por id
    const body = {
      status: state,
      season: SEASON,
      home_team: home,
      away_team: away,
      start_time: startISO,
      home_score: homeScore,
      away_score: awayScore,
      period,
      clock,
      possession,
      red_zone: redZone,
      updated_at: new Date().toISOString(),
    };

    const r = await sfetch(`/rest/v1/games?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("PATCH games error", r.status, t);
      continue;
    }
    updates++;
  }
  return { updated: updates, weeks: [week] };
}

async function weeksToSync() {
  // Buscar semanas con partidos no-finales para no pedir semanas cerradas
  const r = await sfetch(
    `/rest/v1/games?season=eq.${SEASON}&status=in.(scheduled,in_progress)&select=week`
  );
  if (!r.ok) return [1]; // fallback
  const rows = await r.json();
  const set = new Set(rows.map((x) => x.week));
  if (set.size === 0) {
    // fallback a próxima semana o la 1
    return [1];
  }
  return Array.from(set).sort((a, b) => a - b);
}

async function syncScoresAuto() {
  const weeks = await weeksToSync();
  let total = 0;
  for (const w of weeks) {
    const { updated } = await syncScoresForWeek(w);
    total += updated;
  }
  return { updated: total, weeks };
}

// Simple: refresca calendario básico (en caso de que agreguen/cambien fecha)
async function syncGamesBasic() {
  // Usamos las mismas llamadas de scoreboard para asegurar fecha/teams
  const weeks = await weeksToSync();
  let up = 0;
  for (const w of weeks) {
    const data = await espnScoreboard(w);
    const events = data?.events || [];
    for (const e of events) {
      const id = Number(e?.id);
      const { home, away, startISO } = parseTeams(e);
      const r = await sfetch(`/rest/v1/games?id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          season: SEASON,
          week: w,
          home_team: home,
          away_team: away,
          start_time: startISO,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("PATCH schedule error", r.status, t);
      } else up++;
    }
  }
  return { updated: up, weeks };
}

// Odds (si ya tienes otro endpoint, puedes omitirlo o dejarlo mínimo)
async function syncOddsBasic() {
  // Aquí solo devolvemos OK para no romper crons si aún no usas odds
  return { updated: 0 };
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token") || "";
    if (token !== CRON_TOKEN) return ERR(401, "bad token");

    const action = searchParams.get("action") || searchParams.get("a") || "";
    if (!action) {
      return OK({
        ok: true,
        message: "control ok",
        actions: ["syncGames", "syncScores", "syncOdds", "syncAll"],
      });
    }

    if (action === "syncGames") {
      const r = await syncGamesBasic();
      return OK({ ok: true, action, ...r });
    }
    if (action === "syncScores") {
      const r = await syncScoresAuto();
      return OK({ ok: true, action, ...r });
    }
    if (action === "syncOdds") {
      const r = await syncOddsBasic();
      return OK({ ok: true, action, ...r });
    }
    if (action === "syncAll") {
      const g = await syncGamesBasic();
      const s = await syncScoresAuto();
      const o = await syncOddsBasic();
      return OK({ ok: true, action, games: g, scores: s, odds: o });
    }

    return ERR(400, "unknown action");
  } catch (e) {
    console.error(e);
    return ERR(500, String(e?.message || e));
  }
}

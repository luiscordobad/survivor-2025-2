// api/control.mjs
import 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const okToken = (t) => t && t === process.env.CRON_TOKEN;

// -------- helpers comunes ----------
function winProbFromSpread(spreadForTeam) {
  if (spreadForTeam == null) return null;
  const k = 0.23;
  const p = 1 / (1 + Math.exp(-k * (-spreadForTeam)));
  return Math.round(p * 100);
}

// Escoge favorito "más fuerte" para un juego
function pickFavForGame(game, lastOdds) {
  if (!lastOdds) return null;
  const { spread_home, spread_away, ml_home, ml_away } = lastOdds;
  const homeFav =
    (spread_home ?? 0) < (spread_away ?? 0) ||
    (ml_home ?? 9999) < (ml_away ?? 9999);
  return homeFav ? game.home_team : game.away_team;
}

// -------- acciones ----------
async function doSyncNews(req, res, supabase) {
  const { team } = req.query || {};
  const ESPN_NEWS = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news';
  const TEAM_NEWS = (t) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=${encodeURIComponent(t.toLowerCase())}`;

  const url = team ? TEAM_NEWS(team) : ESPN_NEWS;
  const r = await fetch(url, { headers: { 'cache-control':'no-cache' }});
  if (!r.ok) return res.status(502).json({ ok:false, error:`ESPN HTTP ${r.status}` });
  const j = await r.json();

  const items = (j.articles || j.news || []).slice(0, 12).map(a => ({
    team_id: team || null,
    title: a.headline || a.title,
    url: a.links?.web?.href || a.links?.mobile?.href || a.link || '',
    source: (a.source?.name || a.source || 'ESPN'),
    published_at: a.published || a.lastModified || a.date || new Date().toISOString(),
  })).filter(x => x.title && x.url);

  if (!items.length) return res.json({ ok:true, inserted:0 });

  const { error } = await supabase.from('news').upsert(items, { onConflict: 'team_id,title,url' });
  if (error) return res.status(500).json({ ok:false, error:error.message });
  return res.json({ ok:true, inserted: items.length });
}

async function doCloseWeek(req, res, supabase) {
  const { week } = req.query || {};
  const W = Number(week);
  if (!W) return res.status(400).json({ ok:false, error:'Missing week' });

  // 1) juegos finales
  const { data: games, error: e1 } = await supabase
    .from('games')
    .select('id, home_team, away_team, home_score, away_score, status')
    .eq('week', W)
    .eq('status', 'final');
  if (e1) return res.status(500).json({ ok:false, error:e1.message });

  const winners = new Map();
  games.forEach(g => {
    const hs = g.home_score ?? 0, as = g.away_score ?? 0;
    if (hs === as) winners.set(g.id, 'push');
    else winners.set(g.id, hs > as ? g.home_team : g.away_team);
  });

  // 2) picks de la semana
  const { data: picks, error: e2 } = await supabase
    .from('picks')
    .select('id, user_id, game_id, team_id, result')
    .eq('week', W);
  if (e2) return res.status(500).json({ ok:false, error:e2.message });

  // 3) calificar
  const updates = [];
  const userDelta = {}; // user_id -> {wins, losses, pushes, livesDelta}
  for (const p of picks || []) {
    if (!winners.has(p.game_id)) continue;
    const win = winners.get(p.game_id);
    let result = 'pending';
    if (win === 'push') result = 'push';
    else if (win === p.team_id) result = 'win';
    else result = 'loss';
    if (p.result !== result) updates.push({ id: p.id, result });

    if (!userDelta[p.user_id]) userDelta[p.user_id] = { wins:0, losses:0, pushes:0, livesDelta:0 };
    if (result === 'win') userDelta[p.user_id].wins++;
    if (result === 'loss') { userDelta[p.user_id].losses++; userDelta[p.user_id].livesDelta -= 1; }
    if (result === 'push') userDelta[p.user_id].pushes++;
  }
  if (updates.length) {
    const { error: eU } = await supabase.from('picks').upsert(updates);
    if (eU) return res.status(500).json({ ok:false, error:eU.message });
  }

  // 4) standings (RPC opcional; si no las tienes, sustituye por UPDATEs directos)
  for (const [uid, d] of Object.entries(userDelta)) {
    if (d.livesDelta) {
      await supabase.rpc('increment_lives', { u_user_id: uid, delta: d.livesDelta });
    }
    if (d.wins || d.losses || d.pushes) {
      await supabase.rpc('add_results', { u_user_id: uid, w: d.wins||0, l: d.losses||0, pu: d.pushes||0 });
    }
  }

  return res.json({ ok:true, graded: updates.length, users: Object.keys(userDelta).length });
}

async function doAutopick(req, res, supabase) {
  const { week } = req.query || {};
  const W = Number(week);
  if (!W) return res.status(400).json({ ok:false, error:'Missing week' });

  // juegos de la semana
  const { data: gs } = await supabase.from('games').select('*').eq('week', W).order('start_time');
  if (!gs?.length) return res.json({ ok:true, picks:0 });

  // odds última por juego
  const ids = gs.map(g=>g.id);
  const { data: orows } = await supabase
    .from('odds')
    .select('game_id,spread_home,spread_away,ml_home,ml_away,fetched_at')
    .in('game_id', ids)
    .order('fetched_at', { ascending: false });
  const lastOdds = {};
  for (const r of orows || []) if (!lastOdds[r.game_id]) lastOdds[r.game_id] = r;

  // usuarios sin pick en la semana
  const { data: allUsers } = await supabase.from('standings').select('user_id');
  const { data: hasPick } = await supabase.from('picks').select('user_id').eq('week', W);
  const pickedIds = new Set((hasPick||[]).map(x=>x.user_id));
  const targets = (allUsers||[]).map(x=>x.user_id).filter(uid => !pickedIds.has(uid));
  if (!targets.length) return res.json({ ok:true, picks:0 });

  let inserted = 0;
  for (const uid of targets) {
    // equipos ya usados por ese usuario
    const { data: myPicks } = await supabase.from('picks').select('team_id').eq('user_id', uid);
    const used = new Set((myPicks||[]).map(x=>x.team_id));

    // escoge mejor favorito disponible
    let best = null;
    for (const g of gs) {
      // saltar si ya arrancó (rolling lock)
      if (new Date(g.start_time) <= new Date()) continue;
      const fav = pickFavForGame(g, lastOdds[g.id]);
      if (!fav || used.has(fav)) continue;

      // score: winProb + (kickoff más cercano)
      const lo = lastOdds[g.id];
      const spread = fav === g.home_team ? lo?.spread_home : lo?.spread_away;
      const wp = winProbFromSpread(spread) ?? 50;
      const kickoffSoonBonus = Math.max(0, 100 - Math.min(100, Math.floor((new Date(g.start_time) - Date.now())/60000))); // opcional
      const score = wp + kickoffSoonBonus/10;

      if (!best || score > best.score) best = { g, team: fav, score };
    }

    if (best) {
      const { error } = await supabase.from('picks').insert({
        user_id: uid, game_id: best.g.id, team_id: best.team, week: W, season: 2025, auto_pick: true
      });
      if (!error) inserted++;
    }
  }

  return res.json({ ok:true, picks: inserted });
}

async function doAutopickOne(req, res, supabase) {
  const { week, user_id } = req.query || {};
  const W = Number(week);
  if (!W || !user_id) return res.status(400).json({ ok:false, error:'Missing week/user_id' });

  const { data: gs } = await supabase.from('games').select('*').eq('week', W).order('start_time');
  if (!gs?.length) return res.json({ ok:false, error:'No games' });

  const ids = gs.map(g=>g.id);
  const { data: orows } = await supabase
    .from('odds')
    .select('game_id,spread_home,spread_away,ml_home,ml_away,fetched_at')
    .in('game_id', ids)
    .order('fetched_at', { ascending: false });
  const lastOdds = {};
  for (const r of orows || []) if (!lastOdds[r.game_id]) lastOdds[r.game_id] = r;

  const { data: myPicks } = await supabase.from('picks').select('team_id').eq('user_id', user_id);
  const used = new Set((myPicks||[]).map(x=>x.team_id));

  let best = null;
  for (const g of gs) {
    if (new Date(g.start_time) <= new Date()) continue;
    const fav = pickFavForGame(g, lastOdds[g.id]);
    if (!fav || used.has(fav)) continue;
    const lo = lastOdds[g.id];
    const spread = fav === g.home_team ? lo?.spread_home : lo?.spread_away;
    const wp = winProbFromSpread(spread) ?? 50;
    const score = wp;
    if (!best || score > best.score) best = { g, team: fav, score };
  }
  if (!best) return res.json({ ok:false, error:'No hay favorito disponible' });

  const { error } = await supabase.from('picks').insert({
    user_id, game_id: best.g.id, team_id: best.team, week: W, season: 2025, auto_pick: true
  });
  if (error) return res.status(500).json({ ok:false, error:error.message });
  return res.json({ ok:true, team: best.team, game_id: best.g.id });
}

// -------- handler principal ----------
export default async function handler(req, res) {
  try {
    const { action, token } = req.query || {};
    if (!okToken(token)) return res.status(401).json({ ok:false, error:'Bad token' });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    if (action === 'syncNews')   return await doSyncNews(req, res, supabase);
    if (action === 'closeWeek')  return await doCloseWeek(req, res, supabase);
    if (action === 'autopick')   return await doAutopick(req, res, supabase);
    if (action === 'autopickOne')return await doAutopickOne(req, res, supabase);

    return res.status(400).json({ ok:false, error:'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok:false, error:e.message });
  }
}

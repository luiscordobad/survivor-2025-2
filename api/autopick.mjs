import fetch from 'node-fetch';
import { DateTime } from 'luxon';
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

const ODDS_API_BASE = process.env.ODDS_API_BASE || 'https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds';
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const implied = (ml) => (ml < 0 ? (-ml) / ((-ml)+100) : 100 / (ml+100));
export default async function handler(req, res) {
  if (!guard(req, res)) return;
  try {
    const now = DateTime.utc();
    const in5 = now.plus({ minutes: 5 }).toISO();
    const { data: games } = await supa.from('games').select('*').gte('start_time', now.toISO()).lte('start_time', in5).eq('season', 2025).eq('status', 'scheduled');
    if (!games?.length) return res.status(200).json({ ok: true, msg: 'no upcoming locks' });
    for (const game of games) {
      const { data: members } = await supa.from('league_members').select('user_id');
      for (const m of members || []) {
        const { data: existing } = await supa.from('picks').select('id').eq('user_id', m.user_id).eq('week', game.week).maybeSingle();
        if (existing) continue;
        const { data: used } = await supa.from('user_used_teams').select('team_id').eq('user_id', m.user_id);
        const usedSet = new Set((used || []).map(u => u.team_id));
        const candidates = [game.home_team, game.away_team].filter(t => !usedSet.has(t));
        if (!candidates.length) continue;
        let choice = candidates.includes(game.home_team) ? game.home_team : candidates[0]; // fallback
        await supa.from('picks').insert({ user_id: m.user_id, game_id: game.id, team_id: choice, week: game.week, season: 2025, auto_pick: true });
      }
    }
    res.status(200).json({ ok: true, msg: 'autopick run' });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// api/syncNews.mjs
import 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const okToken = (t) => t && t === process.env.CRON_TOKEN;

const ESPN_NEWS = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news';
const TEAM_NEWS = (team) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=${encodeURIComponent(team.toLowerCase())}`;

export default async function handler(req, res) {
  try {
    const { token, team } = req.query || {};
    if (!okToken(token)) return res.status(401).json({ ok:false, error:'Bad token' });

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

    if (items.length === 0) return res.json({ ok:true, inserted:0 });

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
    // upsert "a lo bestia": usa índice único news_unique_recent (md5 título+url con team)
    const { error } = await supabase.from('news').upsert(items, { onConflict: 'team_id,title,url' });
    if (error) return res.status(500).json({ ok:false, error:error.message });

    return res.json({ ok:true, inserted: items.length });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
}

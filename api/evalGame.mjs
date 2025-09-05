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

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const id = req.query?.id || (req.url && new URL(req.url, `https://${req.headers.host}`).searchParams.get('id'));
  if (!id) return res.status(400).json({ error: 'game id required' });
  const { error } = await supa.rpc('eval_picks_for_game', { _game_id: id });
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ ok: true });
}

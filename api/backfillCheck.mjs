// api/backfillCheck.mjs
export default async function handler(req, res) {
  const ok = {
    hasURL: !!process.env.SUPABASE_URL,
    hasKey: !!(process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON_KEY),
    hasToken: !!process.env.CRON_TOKEN,
    node: process.version,
  };
  res.json({ ok: true, env: ok });
}

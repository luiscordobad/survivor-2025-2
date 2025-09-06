// /api/closeWeek.mjs
export const config = { runtime: "edge" };

async function json(res, code, body){ return new Response(JSON.stringify(body), { status: code, headers:{ "content-type":"application/json" } }); }

export default async function handler(req){
  try{
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token") || "";
    const week = Number(searchParams.get("week") || "0");
    if(!token || token !== (process.env.CRON_TOKEN||"")) return json(null, 401, { ok:false, error:"Bad token" });
    if(!week) return json(null, 400, { ok:false, error:"Missing week" });

    const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE || process.env.VITE_SUPABASE_SERVICE_ROLE;
    if(!SUPA_URL || !SUPA_KEY) return json(null, 500, { ok:false, error:"Supabase env missing" });

    // simple client (fetch)
    const up = async (path, method, body) => fetch(`${SUPA_URL}/rest/v1/${path}`, {
      method, headers:{ apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type":"application/json", Prefer:"return=representation" },
      body: body ? JSON.stringify(body) : undefined
    }).then(r=>r);

    // 1) lee todos los picks de la semana
    const pRes = await fetch(`${SUPA_URL}/rest/v1/picks?week=eq.${week}`, { headers:{ apikey: SUPA_KEY, Authorization:`Bearer ${SUPA_KEY}` }});
    const picks = await pRes.json();

    // 2) trae juegos (para resultados/márgenes)
    const ids = [...new Set(picks.map(p=>p.game_id).filter(Boolean))];
    const gRes = ids.length
      ? await fetch(`${SUPA_URL}/rest/v1/games?id=in.(${ids.join(",")})`, { headers:{ apikey: SUPA_KEY, Authorization:`Bearer ${SUPA_KEY}` }})
      : null;
    const games = gRes ? await gRes.json() : [];
    const byId = {}; games.forEach(g=>byId[g.id]=g);

    // 3) evalúa resultados
    const updates = [];
    for(const p of picks){
      const g = byId[p.game_id]; if(!g || g.status!=="final") continue;
      const isHome = p.team_id===g.home_team; const my = isHome ? g.home_score : g.away_score; const other = isHome ? g.away_score : g.home_score;
      const res = (my>other) ? "win" : (my<other) ? "loss" : "push";
      updates.push({ id:p.id, result:res, margin:(my??0)-(other??0) });
    }
    // batch update (simple: una por una)
    for(const u of updates){
      await up(`picks?id=eq.${u.id}`, "PATCH", { result:u.result, margin:u.margin });
    }

    // 4) recomputa standings (wins, losses, pushes, lives y margen sum)
    const allUsers = await fetch(`${SUPA_URL}/rest/v1/standings`, { headers:{ apikey: SUPA_KEY, Authorization:`Bearer ${SUPA_KEY}` } }).then(r=>r.json());
    for(const s of allUsers){
      const myPksRes = await fetch(`${SUPA_URL}/rest/v1/picks?user_id=eq.${s.user_id}`, { headers:{ apikey: SUPA_KEY, Authorization:`Bearer ${SUPA_KEY}` }});
      const myPicks = await myPksRes.json();
      let wins=0,losses=0,pushes=0, margin_sum=0, lives = s.lives||2;
      for(const p of myPicks){
        if(p.result==="win"){ wins++; }
        else if(p.result==="loss"){ losses++; lives = Math.max(0, lives - 1); }
        else if(p.result==="push"){ pushes++; }
        if(typeof p.margin==="number") margin_sum += p.margin;
      }
      await up(`standings?user_id=eq.${s.user_id}`, "PATCH", { wins, losses, pushes, margin_sum, lives });
    }

    return json(null, 200, { ok:true, updated: updates.length });
  }catch(e){
    return json(null, 500, { ok:false, error: String(e.message||e) });
  }
}

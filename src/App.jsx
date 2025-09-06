// src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { supabase } from "./lib/supabaseClient";
import Rules from "./Rules";

const TZ = import.meta.env.VITE_TZ || "America/Mexico_City";

/* =============== comunes =============== */
function Countdown({ iso }) {
  const [left, setLeft] = useState("");
  useEffect(() => {
    const id = setInterval(() => {
      const t = DateTime.fromISO(iso).setZone(TZ).diffNow(["days","hours","minutes","seconds"]).toObject();
      const d = Math.max(0, Math.floor(t.days||0));
      const h = Math.max(0, Math.floor(t.hours||0));
      const m = Math.max(0, Math.floor(t.minutes||0));
      const s = Math.max(0, Math.floor(t.seconds||0));
      setLeft(`${d}d ${h}h ${m}m ${s}s`);
    }, 1000);
    return () => clearInterval(id);
  }, [iso]);
  return <span>{left}</span>;
}
function downloadCSV(filename, rows) {
  const esc = (v) => (v == null ? "" : `"${String(v).replaceAll('"','""')}"`);
  const csv = rows.map(r => r.map(esc).join(",")).join("\n") + "\n";
  const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function useSession() {
  const [session, setSession] = useState(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  return session;
}

/* =============== login (email+password, magic, reset) =============== */
function Login() {
  const [tab, setTab] = useState("password"); // password | magic | reset
  const [busy, setBusy] = useState(false);
  // magic
  const [email, setEmail] = useState(""); const [sent, setSent] = useState(false);
  // password
  const [passEmail, setPassEmail] = useState(""); const [passPwd, setPassPwd] = useState("");
  const [isSignup, setIsSignup] = useState(false); const [displayName, setDisplayName] = useState("");
  // reset
  const [resetEmail, setResetEmail] = useState(""); const [newPwd, setNewPwd] = useState(""); const [resetInfo, setResetInfo] = useState("");

  useEffect(()=>{ if((window.location.hash||"").includes("type=recovery")) setTab("reset"); },[]);

  const magic = async (e)=>{ e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({ email, options:{ emailRedirectTo: import.meta.env.VITE_SITE_URL || window.location.origin } });
    if(!error) setSent(true); else alert(error.message);
  };
  const passwordAuth = async (e)=>{ e.preventDefault(); setBusy(true);
    try{
      if(isSignup){
        if(!displayName.trim()) throw new Error("Escribe tu nombre.");
        const { error } = await supabase.auth.signUp({
          email: passEmail, password: passPwd,
          options:{ emailRedirectTo: import.meta.env.VITE_SITE_URL || window.location.origin, data:{ display_name: displayName.trim() } }
        });
        if(error) throw error;
        localStorage.setItem("pendingDisplayName", displayName.trim());
        alert("Cuenta creada. Revisa tu correo para confirmar.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: passEmail, password: passPwd });
        if(error) throw error;
      }
    }catch(e){ alert(e.message); } finally{ setBusy(false); }
  };
  const sendReset = async (e)=>{ e.preventDefault(); setBusy(true);
    try{
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, { redirectTo: import.meta.env.VITE_SITE_URL || window.location.origin });
      if(error) throw error; setResetInfo("Enlace enviado, revisa tu correo.");
    }catch(e){ alert(e.message); } finally{ setBusy(false); }
  };
  const applyNew = async (e)=>{ e.preventDefault(); if(!newPwd || newPwd.length<6) return alert("Mínimo 6 caracteres.");
    setBusy(true);
    try{ const { error } = await supabase.auth.updateUser({ password: newPwd }); if(error) throw error;
      setResetInfo("Contraseña actualizada."); setTimeout(()=>setTab("password"), 1200);
    }catch(e){ alert(e.message); } finally{ setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-white">
      <div className="w-full max-w-md space-y-4 p-6 border rounded-2xl bg-white">
        <h1 className="text-3xl font-extrabold tracking-tight text-center">{import.meta.env.VITE_LEAGUE_NAME || "Survivor 2025"}</h1>
        <div className="flex gap-2 justify-center">
          <button className={`px-3 py-1 rounded border ${tab==="password"?"bg-black text-white":""}`} onClick={()=>setTab("password")}>Email + Password</button>
          <button className={`px-3 py-1 rounded border ${tab==="magic"?"bg-black text-white":""}`} onClick={()=>setTab("magic")}>Magic link</button>
          <button className={`px-3 py-1 rounded border ${tab==="reset"?"bg-black text-white":""}`} onClick={()=>setTab("reset")}>Olvidé mi contraseña</button>
        </div>

        {tab==="password" && (
          <form onSubmit={passwordAuth} className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm">{isSignup?"Crear cuenta":"Iniciar sesión"}</label>
              <button type="button" className="text-xs underline" onClick={()=>setIsSignup(!isSignup)}>{isSignup?"¿Ya tienes cuenta? Inicia sesión":"¿No tienes cuenta? Regístrate"}</button>
            </div>
            {isSignup && <input className="border w-full p-2 rounded-lg" placeholder="Tu nombre" value={displayName} onChange={e=>setDisplayName(e.target.value)}/>}
            <input type="email" className="border w-full p-2 rounded-lg" placeholder="email" value={passEmail} onChange={e=>setPassEmail(e.target.value)} required/>
            <input type="password" className="border w-full p-2 rounded-lg" placeholder="contraseña" value={passPwd} onChange={e=>setPassPwd(e.target.value)} required/>
            <button disabled={busy} className="bg-black text-white px-4 py-2 w-full rounded-lg disabled:opacity-60">{isSignup?"Crear cuenta":"Entrar"}</button>
          </form>
        )}

        {tab==="magic" && (
          <form onSubmit={magic} className="space-y-3">
            <input type="email" className="border w-full p-2 rounded-lg" placeholder="tu@email.com" value={email} onChange={e=>setEmail(e.target.value)} required/>
            <button className="bg-black text-white px-4 py-2 w-full rounded-lg">Enviar magic link</button>
            {sent && <p className="text-xs text-gray-600">Revisa tu correo.</p>}
          </form>
        )}

        {tab==="reset" && (window.location.hash.includes("type=recovery")
          ? <form onSubmit={applyNew} className="space-y-3">
              <input type="password" className="border w-full p-2 rounded-lg" placeholder="nueva contraseña" value={newPwd} onChange={e=>setNewPwd(e.target.value)} required/>
              <button disabled={busy} className="bg-black text-white px-4 py-2 w-full rounded-lg disabled:opacity-60">Guardar</button>
              {resetInfo && <p className="text-xs text-emerald-700">{resetInfo}</p>}
            </form>
          : <form onSubmit={sendReset} className="space-y-3">
              <input type="email" className="border w-full p-2 rounded-lg" placeholder="tu email" value={resetEmail} onChange={e=>setResetEmail(e.target.value)} required/>
              <button disabled={busy} className="bg-black text-white px-4 py-2 w-full rounded-lg disabled:opacity-60">Enviar enlace</button>
              {resetInfo && <p className="text-xs text-emerald-700">{resetInfo}</p>}
            </form>
        )}
      </div>
    </div>
  );
}

/* =============== shell tabs =============== */
function AppRoot() {
  const session = useSession();
  const [view, setView] = useState("game"); // game | assistant | standings | rules
  if (!session) return <Login/>;
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="w-full border-b bg-white sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-2">
          <button className={`text-sm px-3 py-1 rounded ${view==="game"?"bg-black text-white":"border"}`} onClick={()=>setView("game")}>Partidos</button>
          <button className={`text-sm px-3 py-1 rounded ${view==="assistant"?"bg-black text-white":"border"}`} onClick={()=>setView("assistant")}>Asistente</button>
          <button className={`text-sm px-3 py-1 rounded ${view==="standings"?"bg-black text-white":"border"}`} onClick={()=>setView("standings")}>Standings+</button>
          <button className={`text-sm px-3 py-1 rounded ${view==="rules"?"bg-black text-white":"border"}`} onClick={()=>setView("rules")}>Reglas</button>
        </div>
      </div>
      {view==="game"? <AppAuthed/> : view==="assistant"? <AssistantView/> : view==="standings"? <StandingsPlus/> : <Rules/>}
    </div>
  );
}
export default AppRoot;

/* =============== equipos (logos / datos) =============== */
function useTeamsMap() {
  const [map, setMap] = useState({});
  useEffect(()=>{ (async ()=>{
    const { data } = await supabase.from("teams").select("*");
    const m={}; (data||[]).forEach(t=>m[t.id]=t); setMap(m);
  })(); },[]);
  return map;
}
function TeamMini({ id }) {
  const map = useTeamsMap();
  const t = map[id] || {};
  const src = t.logo_url || `/teams/${id}.png`;
  return <span className="inline-flex items-center gap-1"><img src={src} alt={id} className="h-5 w-5 rounded-full object-contain"/><span className="font-mono font-semibold">{id}</span></span>;
}
function TeamChip({ id }) {
  const map = useTeamsMap();
  const t = map[id] || {};
  const src = t.logo_url || `/teams/${id}.png`;
  return <span className="inline-flex items-center gap-2"><img src={src} alt={id} className="h-6 w-6 rounded-full object-contain"/><span className="font-medium">{t.name || id}</span></span>;
}

/* =============== Partidos (principal) =============== */
function AppAuthed() {
  const [me, setMe] = useState(null);
  const [week, setWeek] = useState(()=> Number(localStorage.getItem("week")) || 1);
  const [games, setGames] = useState([]);
  const [oddsPairs, setOddsPairs] = useState({});
  const [picks, setPicks] = useState([]);
  const [standings, setStandings] = useState([]);
  const [leaguePicks, setLeaguePicks] = useState([]);
  const [userNames, setUserNames] = useState({});
  const [popularity, setPopularity] = useState([]);
  const [pendingPick, setPendingPick] = useState(null);
  const [statsFor, setStatsFor] = useState(null);
  const [dayFilter, setDayFilter] = useState(localStorage.getItem("dayFilter") || "ALL");
  const [teamQuery, setTeamQuery] = useState(localStorage.getItem("teamQuery") || "");
  const teamsMap = useTeamsMap();

  useEffect(()=>{ // init
    (async ()=>{
      const session = (await supabase.auth.getSession()).data.session;
      const email = session.user.email;
      let { data: prof } = await supabase.from("profiles").select("*").eq("email", email).single();
      if (!prof) {
        const pending = localStorage.getItem("pendingDisplayName");
        await supabase.from("profiles").insert({ id: session.user.id, email, display_name: pending || email.split("@")[0] });
        localStorage.removeItem("pendingDisplayName");
        prof = (await supabase.from("profiles").select("*").eq("email", email).single()).data;
      }
      setMe(prof);
      const { data: pk } = await supabase.from("picks").select("*").eq("user_id", session.user.id);
      setPicks(pk||[]);
      const { data: st } = await supabase.from("standings").select("*"); setStandings(st||[]);
      await loadGames(week); await loadLeaguePicks(week);
    })();
  },[]);
  useEffect(()=>{ loadGames(week); loadLeaguePicks(week); localStorage.setItem("week", String(week)); },[week]);
  useEffect(()=> localStorage.setItem("dayFilter", dayFilter), [dayFilter]);
  useEffect(()=> localStorage.setItem("teamQuery", teamQuery), [teamQuery]);

  useEffect(()=>{ // autorefresh si hay en vivo
    const anyLive = (games||[]).some(g=>g.status==="in_progress");
    if(!anyLive) return;
    const id = setInterval(()=>loadGames(week), 30000);
    return ()=>clearInterval(id);
  },[games, week]);

  async function loadGames(w){
    const { data: gs } = await supabase.from("games").select("*").eq("week", w).order("start_time");
    setGames(gs||[]);
    const ids = (gs||[]).map(g=>g.id);
    if(ids.length){
      const { data } = await supabase.from("odds").select("game_id,spread_home,spread_away,ml_home,ml_away,fetched_at").in("game_id", ids).order("fetched_at",{ascending:false});
      const by={}; for(const row of data||[]){ if(!by[row.game_id]) by[row.game_id]={last:row,prev:null}; else if(!by[row.game_id].prev) by[row.game_id].prev=row; }
      setOddsPairs(by);
    } else setOddsPairs({});
  }
  async function loadLeaguePicks(w){
    const { data: pks } = await supabase.from("picks").select("id,user_id,team_id,result,auto_pick,updated_at,week").eq("week", w);
    setLeaguePicks(pks||[]);
    const ids = [...new Set((pks||[]).map(x=>x.user_id))];
    if(ids.length){
      const { data: profs } = await supabase.from("profiles").select("id,display_name").in("id", ids);
      const m={}; (profs||[]).forEach(p=>m[p.id]=p.display_name); setUserNames(m);
    } else setUserNames({});
    const { data: total } = await supabase.from("standings").select("user_id");
    const counts={}; (pks||[]).forEach(x=>{ if(x.team_id) counts[x.team_id]=(counts[x.team_id]||0)+1; });
    const list = Object.entries(counts).map(([team_id,count])=>({team_id,count,pct: total?.length? Math.round((count*100)/total.length):0})).sort((a,b)=>b.count-a.count);
    setPopularity(list);
  }

  const myPickThisWeek = useMemo(()=> (picks||[]).find(p=>p.week===week), [picks, week]);
  const nextKickoffISO = useMemo(()=> (games||[]).find(g=>DateTime.fromISO(g.start_time)>DateTime.now())?.start_time || null, [games]);
  const showPickAlert = useMemo(()=> {
    if(myPickThisWeek || !nextKickoffISO) return false;
    const mins = DateTime.fromISO(nextKickoffISO).diffNow("minutes").minutes;
    return mins <= 90 && mins > 0;
  }, [myPickThisWeek, nextKickoffISO]);

  const popPct = (teamId)=> popularity.find(p=>p.team_id===teamId)?.pct ?? 0;
  const canPick = (g, team) => {
    const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
    if(locked) return { ok:false, reason:"LOCK" };
    const used = (picks||[]).some(p=>p.team_id===team && p.user_id=== (supabase.auth.getUser()?.data?.user?.id || ""));
    if(used && !(myPickThisWeek && myPickThisWeek.team_id===team)) return { ok:false, reason:"USED" };
    return { ok:true };
  };
  const confirmPick = (game, teamId) => {
    const c = canPick(game, teamId);
    if(!c.ok) return alert(c.reason==="LOCK"?"Cerrado por kickoff":"Ya usaste este equipo");
    setPendingPick({ game, teamId });
  };
  const doPick = async ()=>{
    if(!pendingPick) return;
    const { game, teamId } = pendingPick;
    const session = (await supabase.auth.getSession()).data.session;
    const exists = (await supabase.from("picks").select("*").eq("user_id", session.user.id).eq("week", week)).data?.[0];
    if(exists){
      const { error } = await supabase.from("picks").update({ team_id:teamId, game_id:game.id, updated_at:new Date().toISOString() }).eq("id", exists.id);
      if(error) return alert(error.message);
    } else {
      const { error } = await supabase.from("picks").insert({ user_id: session.user.id, game_id: game.id, team_id: teamId, week, season: 2025 });
      if(error) return alert(error.message);
    }
    const { data: pk } = await supabase.from("picks").select("*").eq("user_id", session.user.id);
    setPicks(pk||[]); setPendingPick(null);
  };

  const SITE = import.meta.env.VITE_SITE_URL || ""; const CRON_TOKEN = import.meta.env.VITE_CRON_TOKEN || "";
  const autopickMe = async ()=>{ try{
    const session = (await supabase.auth.getSession()).data.session;
    const url = `${SITE}/api/autopickOne?week=${week}&user_id=${encodeURIComponent(session.user.id)}&token=${encodeURIComponent(CRON_TOKEN)}`;
    const r = await fetch(url); const j = await r.json().catch(()=>({}));
    if(!r.ok || j.ok===false) throw new Error(j.error||"Error autopick");
    alert("Autopick aplicado para ti."); await loadLeaguePicks(week);
  }catch(e){ alert(e.message); } };
  const autopickLeague = async ()=>{ try{
    const url = `${SITE}/api/autopick?week=${week}&token=${encodeURIComponent(CRON_TOKEN)}`;
    const r = await fetch(url); const j = await r.json().catch(()=>({}));
    if(!r.ok || j.ok===false) throw new Error(j.error||"Error autopick liga");
    alert("Autopick aplicado a la liga."); await loadLeaguePicks(week);
  }catch(e){ alert(e.message); } };

  const ScoreStrip = ({ g })=>{
    const status = g.status || "scheduled";
    const score = (<div className="flex items-center gap-4">
      <div className="text-xl font-bold">{g.away_team} <span className="tabular-nums">{g.away_score??0}</span></div>
      <div className="text-gray-300">—</div>
      <div className="text-xl font-bold">{g.home_team} <span className="tabular-nums">{g.home_score??0}</span></div>
    </div>);
    if(status==="final") return (<div className="flex items-center justify-between">{score}<span className="text-xs px-2 py-0.5 rounded bg-gray-100">FINAL</span></div>);
    if(status==="in_progress") return (<div className="flex items-center justify-between">{score}
      <div className="text-xs flex items-center gap-2"><span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900">Q{g.period??""} {g.clock??""}</span>{g.possession&&<span className="px-2 py-0.5 rounded bg-gray-100">⬤ {g.possession}</span>}</div></div>);
    return (<div className="flex items-center justify-between">{score}<div className="text-xs"><span className="px-2 py-0.5 rounded bg-gray-100">Kickoff en <Countdown iso={g.start_time}/></span></div></div>);
  };
  const LiveQuickStats = ({ g })=>{
    if(g.status!=="in_progress") return null;
    const items=[]; if(g.down) items.push(`${g.down} & ${g.distance??"-"}`); if(g.yard_line) items.push(`En ${g.yard_line}`); if(g.red_zone) items.push("Red Zone");
    if(!items.length) return null;
    return <div className="mt-2 text-xs text-gray-700">{items.map((t,i)=><span key={i} className="mr-2 px-2 py-0.5 rounded bg-gray-50 border">{t}</span>)}</div>;
  };

  const TeamBox = ({ game, teamId })=>{
    const disabled = !canPick(game, teamId).ok;
    const selected = myPickThisWeek?.game_id===game.id && myPickThisWeek?.team_id===teamId;
    const pct = popPct(teamId);
    const { last } = oddsPairs[game.id] || {};
    const fav = last && (
      (teamId===game.home_team && ((last.spread_home??0)<(last.spread_away??0) || (last.ml_home??9999)<(last.ml_away??9999))) ||
      (teamId===game.away_team && ((last.spread_away??0)<(last.spread_home??0) || (last.ml_away??9999)<(last.ml_home??9999)))
    );
    return (
      <button onClick={()=>confirmPick(game, teamId)} disabled={disabled}
        className={["w-full text-left rounded-xl border transition px-4 py-3",
          selected?"border-emerald-500 bg-emerald-50":"border-gray-200 hover:bg-gray-50",
          disabled?"opacity-50 cursor-not-allowed":""
        ].join(" ")}>
        <div className="flex items-center justify-between">
          <TeamMini id={teamId}/>
          <div className="flex items-center gap-2">
            {fav && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900">Fav</span>}
            {pct<15 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800">DIF</span>}
          </div>
        </div>
      </button>
    );
  };

  const gamesByDay = useMemo(()=> {
    if(dayFilter==="ALL") return games;
    const map={ THU:4, FRI:5, SAT:6, SUN:7, MON:1 }; const want = map[dayFilter];
    return (games||[]).filter(g=>DateTime.fromISO(g.start_time).setZone(TZ).weekday===want);
  }, [games, dayFilter]);
  const gamesFiltered = useMemo(()=> {
    const q = teamQuery.trim().toLowerCase();
    if(!q) return gamesByDay;
    const match = (id)=> (id||"").toLowerCase().includes(q) || (teamsMap[id]?.name||"").toLowerCase().includes(q);
    return (gamesByDay||[]).filter(g=>match(g.away_team)||match(g.home_team));
  }, [gamesByDay, teamQuery, teamsMap]);

  // -------- Stats extendidas: temporada y splits local/visitante --------
  async function seasonRecord(teamId, season){
    const { data: played } = await supabase.from("games").select("*").eq("season", season).or(`home_team.eq.${teamId},away_team.eq.${teamId}`).order("start_time");
    let w=0,l=0; let diffs=[]; let last3=[];
    for(const g of played||[]){
      if(g.status!=="final") continue;
      const isHome = g.home_team===teamId; const my = isHome? g.home_score : g.away_score; const other = isHome? g.away_score : g.home_score;
      const diff = (my??0)-(other??0); diffs.push(diff);
      if(my>other) w++; else if(other>my) l++;
      last3.push(`${isHome?g.home_team:g.away_team} ${my}-${other} ${DateTime.fromISO(g.start_time).setZone(TZ).toFormat("dd LLL")}`);
      if(last3.length>3) last3.shift();
    }
    const avg = diffs.length ? (diffs.reduce((a,b)=>a+b,0)/diffs.length) : 0;
    return { w,l,last3, avgMargin: Number(avg.toFixed(1)) };
  }
  async function homeAwaySplits(teamId, season){
    const { data: played } = await supabase.from("games").select("*").eq("season", season).or(`home_team.eq.${teamId},away_team.eq.${teamId}`);
    let home={w:0,l:0,diffs:[]}, away={w:0,l:0,diffs:[]};
    for(const g of played||[]){
      if(g.status!=="final") continue;
      const isHome = g.home_team===teamId; const my = isHome? g.home_score : g.away_score; const other = isHome? g.away_score : g.home_score;
      const diff=(my??0)-(other??0);
      if(isHome){ if(my>other) home.w++; else if(other>my) home.l++; home.diffs.push(diff); }
      else { if(my>other) away.w++; else if(other>my) away.l++; away.diffs.push(diff); }
    }
    const avg = (arr)=> arr.length? Number((arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1)) : 0;
    return { home:{...home, avgMargin:avg(home.diffs)}, away:{...away, avgMargin:avg(away.diffs)} };
  }
  async function currentStreak(teamId, season){
    const { data: played } = await supabase.from("games").select("*").eq("season", season).or(`home_team.eq.${teamId},away_team.eq.${teamId}`).order("start_time");
    let streak=0, type=null;
    for(const g of (played||[]).filter(x=>x.status==="final").reverse()){
      const isHome = g.home_team===teamId; const my = isHome? g.home_score : g.away_score; const other = isHome? g.away_score : g.home_score;
      const win = (my??0)>(other??0);
      if(type===null){ type=win?"W":"L"; streak=1; }
      else if((win && type==="W") || (!win && type==="L")) streak++; else break;
    }
    return { streak, streakType: type||"" };
  }
  async function headToHeadRange(a,b,fromSeason,toSeason){
    const { data: gms } = await supabase.from("games").select("*")
      .or(`and(home_team.eq.${a},away_team.eq.${b}),and(home_team.eq.${b},away_team.eq.${a})`)
      .gte("season", fromSeason).lte("season", toSeason).order("start_time",{ascending:false});
    let aW=0,bW=0, rows=[];
    for(const g of gms||[]){
      if(g.status!=="final") continue;
      const aIsHome = g.home_team===a; const aScore = aIsHome? g.home_score : g.away_score; const bScore = aIsHome? g.away_score : g.home_score;
      if((aScore??0)>(bScore??0)) aW++; else if((bScore??0)>(aScore??0)) bW++;
      rows.push(`${g.season} · ${DateTime.fromISO(g.start_time).setZone(TZ).toFormat("dd LLL")} · ${g.away_team} ${g.away_score}-${g.home_score} ${g.home_team}`);
    }
    return { aW,bW,rows };
  }

  const [h2hFrom, setH2hFrom] = useState(2021);
  const [h2hTo, setH2hTo] = useState(2025);

  const openStats = async (g) => {
    setStatsFor({ game:g, loading:true });
    const [homeRec, awayRec, homeSpl, awaySpl, homeSt, awaySt, h2h] = await Promise.all([
      seasonRecord(g.home_team, 2025),
      seasonRecord(g.away_team, 2025),
      homeAwaySplits(g.home_team, 2025),
      homeAwaySplits(g.away_team, 2025),
      currentStreak(g.home_team, 2025),
      currentStreak(g.away_team, 2025),
      headToHeadRange(g.home_team, g.away_team, h2hFrom, h2hTo)
    ]);
    setStatsFor({ game:g, homeRec, awayRec, homeSpl, awaySpl, homeSt, awaySt, h2h });
  };
  const reloadH2H = async ()=>{
    if(!statsFor) return;
    const h2h = await headToHeadRange(statsFor.game.home_team, statsFor.game.away_team, h2hFrom, h2hTo);
    setStatsFor({ ...statsFor, h2h });
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{import.meta.env.VITE_LEAGUE_NAME || "2025"}</h1>
          <p className="text-sm text-gray-700">Hola, <b>{me?.display_name}</b> · Vidas: <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">{me?.lives}</span></p>
        </div>
        <button className="text-sm underline" onClick={()=>supabase.auth.signOut()}>Salir</button>
      </header>

      {showPickAlert && (
        <div className="mt-3 p-3 border-2 border-red-300 rounded-xl bg-red-50 text-red-900 text-sm">
          🔔 Aún no tienes pick en W{week}. El primer kickoff es en <b><Countdown iso={nextKickoffISO}/></b>.
        </div>
      )}

      {/* tools */}
      <section className="mt-4 grid md:grid-cols-3 gap-4">
        <div className="p-4 border rounded-2xl bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Semana</label>
              <select className="border p-1 rounded-lg" value={week} onChange={e=>setWeek(Number(e.target.value))}>
                {Array.from({length:18},(_,i)=>i+1).map(w=><option key={w} value={w}>W{w}</option>)}
              </select>
            </div>
            <div className="flex gap-1 text-xs">
              {["ALL","THU","FRI","SAT","SUN","MON"].map(d=>(
                <button key={d} className={`px-2 py-1 rounded border ${d===dayFilter?"bg-black text-white":""}`} onClick={()=>setDayFilter(d)}>{d}</button>
              ))}
            </div>
          </div>
          <input className="mt-3 border w-full p-2 rounded-lg" placeholder="Buscar equipo..." value={teamQuery} onChange={e=>setTeamQuery(e.target.value)}/>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="text-xs px-3 py-1 rounded border" onClick={()=>downloadCSV("mis_picks.csv",[["week","team_id","result","auto_pick","updated_at"],...(picks||[]).map(p=>[p.week,p.team_id,p.result,p.auto_pick,p.updated_at])])}>Exportar mis picks (CSV)</button>
            <button className="text-xs px-3 py-1 rounded border" onClick={()=>downloadCSV("standings.csv",[["player","lives","wins","losses","pushes","margin_sum"],...(standings||[]).map(s=>[s.display_name,s.lives,s.wins,s.losses,s.pushes,s.margin_sum])])}>Exportar standings (CSV)</button>
            <button className="text-xs px-3 py-1 rounded border" onClick={autopickMe}>Autopick para mí</button>
            {me?.role==="admin" && <button className="text-xs px-3 py-1 rounded border" onClick={autopickLeague}>Autopick (liga)</button>}
          </div>
        </div>

        <div className="md:col-span-2 p-4 border rounded-2xl bg-white">
          <h3 className="font-semibold">Resumen</h3>
          <p className="text-sm text-gray-600">Lock rolling por partido. “📊 Ver stats” ahora incluye <b>H2H por rango</b>, <b>margen promedio</b> y <b>rachas</b>. Chips de <b>Notas</b> si agregas algo en <code>teams.notes</code>.</p>
        </div>
      </section>

      {/* partidos */}
      <section className="mt-4 p-4 border rounded-2xl bg-white">
        <h2 className="font-semibold mb-3">Partidos W{week}</h2>
        <div className="space-y-3">
          {gamesFiltered.map(g=>{
            const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
            const local = DateTime.fromISO(g.start_time).setZone(TZ).toFormat("EEE dd LLL HH:mm");
            const homeNote = teamsMap[g.home_team]?.notes; const awayNote = teamsMap[g.away_team]?.notes;
            return (
              <div key={g.id} className={`p-4 border rounded-xl ${locked?"opacity-60":""}`}>
                <div className="flex items-center justify-between">
                  <div className="text-sm flex items-center gap-2 flex-wrap">
                    <TeamChip id={g.away_team}/><span className="mx-1 text-gray-400">@</span><TeamChip id={g.home_team}/>
                    {(awayNote||homeNote) && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-900">Notas</span>}
                  </div>
                  <div className="text-xs text-gray-600">Kickoff: <span className="px-1.5 py-0.5 rounded bg-gray-100">{local}</span> · Lock: <Countdown iso={g.start_time}/></div>
                </div>
                <div className="mt-3"><ScoreStrip g={g}/><LiveQuickStats g={g}/></div>
                <div className="mt-2 text-[11px] text-gray-600">
                  {awayNote && <span className="mr-2 px-2 py-0.5 bg-gray-50 border rounded">VIS: {awayNote}</span>}
                  {homeNote && <span className="mr-2 px-2 py-0.5 bg-gray-50 border rounded">LOC: {homeNote}</span>}
                </div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <TeamBox game={g} teamId={g.home_team}/>
                  <TeamBox game={g} teamId={g.away_team}/>
                  <button className="border rounded-xl px-4 py-3 hover:bg-gray-50 text-left" onClick={()=>openStats(g)}>📊 Ver stats</button>
                </div>
              </div>
            );
          })}
          {(!gamesFiltered || gamesFiltered.length===0) && <div className="text-sm text-gray-500">No hay partidos para este filtro o búsqueda.</div>}
        </div>
      </section>

      {/* picks liga / popularidad */}
      <section className="mt-6 grid md:grid-cols-2 gap-4">
        <LeaguePicks week={week}/>
        <Popularity popularity={popularity}/>
      </section>

      {/* confirmar */}
      {pendingPick && <ConfirmModal onCancel={()=>setPendingPick(null)} onConfirm={doPick}>¿Confirmas tu pick de <b>{pendingPick.teamId}</b> en W{week}?</ConfirmModal>}

      {/* stats modal */}
      {statsFor && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="w-full max-w-3xl bg-white rounded-2xl p-5 border">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">📊 Stats del juego</h3>
              <button className="text-sm underline" onClick={()=>setStatsFor(null)}>Cerrar</button>
            </div>

            {/* selects rango H2H */}
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span>H2H temporadas:</span>
              <select className="border p-1 rounded" value={h2hFrom} onChange={(e)=>setH2hFrom(Number(e.target.value))}>
                {Array.from({length:10},(_,k)=>2025-k).map(y=><option key={y} value={y}>{y}</option>)}
              </select>
              <span>a</span>
              <select className="border p-1 rounded" value={h2hTo} onChange={(e)=>setH2hTo(Number(e.target.value))}>
                {Array.from({length:10},(_,k)=>2025-k).map(y=><option key={y} value={y}>{y}</option>)}
              </select>
              <button className="px-2 py-1 border rounded" onClick={reloadH2H}>Actualizar</button>
            </div>

            <div className="mt-3 grid md:grid-cols-2 gap-4">
              <TeamStatsCard side="Visitante" team={statsFor.game.away_team} rec={statsFor.awayRec} spl={statsFor.awaySpl} st={statsFor.awaySt}/>
              <TeamStatsCard side="Local" team={statsFor.game.home_team} rec={statsFor.homeRec} spl={statsFor.homeSpl} st={statsFor.homeSt}/>
            </div>

            <div className="mt-4 p-3 border rounded-xl">
              <h4 className="font-semibold text-sm">Head-to-Head {h2hFrom}–{h2hTo}</h4>
              {!statsFor.h2h ? <div className="text-xs text-gray-500 mt-1">Cargando…</div> : (
                <div className="text-xs mt-1">
                  <div className="mb-1">Balance: {statsFor.game.home_team} {statsFor.h2h.aW} – {statsFor.game.away_team} {statsFor.h2h.bW}</div>
                  {(statsFor.h2h.rows||[]).length ? (statsFor.h2h.rows||[]).map((r,i)=><div key={i}>• {r}</div>) : "No hay historial disponible."}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {(!myPickThisWeek && nextKickoffISO) && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded-xl bg-black text-white text-sm shadow-lg">
          Recuerda elegir: kickoff en <Countdown iso={nextKickoffISO}/>
        </div>
      )}
    </div>
  );
}

/* =============== Auxiliares UI =============== */
function ConfirmModal({ children, onCancel, onConfirm }){
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="w-full max-w-sm bg-white rounded-2xl p-5 border">
        <h3 className="font-semibold text-lg">Confirmar</h3>
        <p className="mt-2 text-sm">{children}</p>
        <div className="mt-4 flex gap-2">
          <button className="px-4 py-2 rounded border" onClick={onCancel}>Cancelar</button>
          <button className="px-4 py-2 rounded bg-black text-white" onClick={onConfirm}>Confirmar</button>
        </div>
      </div>
    </div>
  );
}
function TeamStatsCard({ side, team, rec, spl, st }){
  return (
    <div className="p-3 border rounded-xl">
      <div className="text-sm font-semibold">{side}: {team}</div>
      {!rec ? <div className="text-xs text-gray-500 mt-2">Cargando…</div> : (
        <>
          <div className="mt-1 text-sm">Record 2025: <b>{rec.w}-{rec.l}</b></div>
          <div className="mt-1 text-sm">Margen promedio: <b>{rec.avgMargin>0?`+${rec.avgMargin}`:rec.avgMargin}</b></div>
          {spl && (
            <div className="mt-2 text-xs text-gray-700">
              <div className="mb-1 font-medium">Splits:</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 border rounded">
                  <div className="font-medium">Local</div>
                  <div>W-L: {spl.home.w}-{spl.home.l}</div>
                  <div>Margen: {spl.home.avgMargin>0?`+${spl.home.avgMargin}`:spl.home.avgMargin}</div>
                </div>
                <div className="p-2 border rounded">
                  <div className="font-medium">Visitante</div>
                  <div>W-L: {spl.away.w}-{spl.away.l}</div>
                  <div>Margen: {spl.away.avgMargin>0?`+${spl.away.avgMargin}`:spl.away.avgMargin}</div>
                </div>
              </div>
            </div>
          )}
          {st && <div className="mt-1 text-sm">Racha: <b>{st.streak || 0}{st.streak?st.streakType:""}</b></div>}
          <div className="mt-2 text-xs text-gray-600">
            Últimos 3: <br/>
            {(rec.last3||[]).map((x,i)=><div key={i}>• {x}</div>)}
            {(!rec.last3 || rec.last3.length===0) && "—"}
          </div>
        </>
      )}
    </div>
  );
}
function LeaguePicks({ week }){
  const [rows, setRows] = useState([]); const [names, setNames] = useState({});
  useEffect(()=>{ (async()=>{
    const { data: pks } = await supabase.from("picks").select("id,user_id,team_id,result,auto_pick,updated_at,week").eq("week", week);
    setRows(pks||[]);
    const ids = [...new Set((pks||[]).map(x=>x.user_id))];
    const { data: profs } = ids.length? await supabase.from("profiles").select("id,display_name").in("id", ids) : { data:[] };
    const m={}; (profs||[]).forEach(p=>m[p.id]=p.display_name); setNames(m);
  })(); },[week]);
  return (
    <div className="p-4 border rounded-2xl bg-white">
      <h2 className="font-semibold">Picks de la liga (W{week})</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm mt-3">
          <thead><tr className="text-left text-gray-500"><th>Jugador</th><th>Equipo</th><th>Resultado</th><th>Auto</th><th>Actualizado</th></tr></thead>
          <tbody>
            {(rows||[]).length ? rows.slice().sort((a,b)=>(names[a.user_id]||"").localeCompare(names[b.user_id]||"")).map((p,idx)=>(
              <tr key={idx} className="border-t">
                <td className="py-1.5">{names[p.user_id] || p.user_id.slice(0,6)}</td>
                <td><TeamMini id={p.team_id}/></td>
                <td><span className={p.result==="win"?"text-emerald-700 font-semibold":p.result==="loss"?"text-red-600 font-semibold":p.result==="push"?"text-gray-600":"text-gray-500"}>{p.result || "-"}</span></td>
                <td>{p.auto_pick?"Sí":"No"}</td>
                <td className="text-xs text-gray-500">{p.updated_at? DateTime.fromISO(p.updated_at).setZone(TZ).toFormat("dd LLL HH:mm") : "-"}</td>
              </tr>
            )): <tr><td className="py-2 text-gray-500" colSpan={5}>Aún no hay picks esta semana.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function Popularity({ popularity }){
  return (
    <div className="p-4 border rounded-2xl bg-white">
      <h2 className="font-semibold">Popularidad de equipos</h2>
      <p className="text-xs text-gray-600">Porcentaje de jugadores que pickearon ese equipo.</p>
      <div className="mt-3 space-y-2">
        {(popularity||[]).length ? popularity.map(row=>(
          <div key={row.team_id}>
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2"><TeamMini id={row.team_id}/><span className="text-gray-500">({row.count})</span></div>
              <span className="text-gray-700">{row.pct}%</span>
            </div>
            <div className="h-2 bg-gray-100 rounded mt-1"><div className="h-2 rounded bg-black" style={{width:`${row.pct}%`}}/></div>
          </div>
        )) : <div className="text-sm text-gray-500">No hay picks registrados esta semana.</div>}
      </div>
    </div>
  );
}

/* =============== Asistente (con botón Pick) =============== */
function AssistantView(){
  const [week, setWeek] = useState(()=> Number(localStorage.getItem("week")) || 1);
  const [games, setGames] = useState([]); const [oddsPairs, setOddsPairs] = useState({});
  const [picks, setPicks] = useState([]); const [popularity, setPopularity] = useState([]); const [teamsMap, setTeamsMap] = useState({});
  const [pending, setPending] = useState(null);

  useEffect(()=>{ (async ()=>{
    const { data: gs } = await supabase.from("games").select("*").eq("week", week).order("start_time");
    setGames(gs||[]);
    const ids=(gs||[]).map(g=>g.id);
    if(ids.length){
      const { data } = await supabase.from("odds").select("game_id,spread_home,spread_away,ml_home,ml_away,fetched_at").in("game_id", ids).order("fetched_at",{ascending:false});
      const by={}; for(const row of data||[]){ if(!by[row.game_id]) by[row.game_id]={last:row,prev:null}; else if(!by[row.game_id].prev) by[row.game_id].prev=row; } setOddsPairs(by);
    } else setOddsPairs({});
  })(); },[week]);
  useEffect(()=>{ (async ()=>{
    const sessionNow = (await supabase.auth.getSession()).data.session;
    const { data: pk } = await supabase.from("picks").select("*").eq("user_id", sessionNow.user.id); setPicks(pk||[]);
    const { data: pksW } = await supabase.from("picks").select("team_id").eq("week", week);
    const counts={}; (pksW||[]).forEach(x=>{ if(x.team_id) counts[x.team_id]=(counts[x.team_id]||0)+1; });
    const { data: total } = await supabase.from("standings").select("user_id");
    const list = Object.entries(counts).map(([team_id,count])=>({team_id,count,pct: total?.length? Math.round((count*100)/total.length) : 0}));
    setPopularity(list);
    const { data: ts } = await supabase.from("teams").select("*"); const map={}; (ts||[]).forEach(t=>map[t.id]=t); setTeamsMap(map);
  })(); },[week]);

  const used = new Set((picks||[]).map(p=>p.team_id));
  const popPct = (id)=> popularity.find(p=>p.team_id===id)?.pct ?? 0;
  const winProbFromSpread = (s)=>{ const x = -(s||0); return 1/(1+Math.exp(-0.23*x)); };

  const suggestions = useMemo(()=>{
    const rows=[];
    for(const g of games||[]){
      const last = oddsPairs[g.id]?.last; const now = DateTime.now(); const locked = DateTime.fromISO(g.start_time)<=now;
      const pack = (teamId)=>{ const spread = teamId===g.home_team ? last?.spread_home??0 : last?.spread_away??0;
        const wp = winProbFromSpread(spread); const pop = popPct(teamId)/100; const notUsed = !used.has(teamId); const unlocked = !locked;
        const score = (wp*(1-pop)) * (notUsed?1.05:0.85) * (unlocked?1.0:0.5);
        return { teamId, spread, wp, popPct:pop*100, notUsed, unlocked, score, game:g };
      };
      rows.push(pack(g.home_team), pack(g.away_team));
    }
    return rows.sort((a,b)=>b.score-a.score);
  },[games,oddsPairs,popularity,picks]);

  const doPick = async ()=>{
    if(!pending) return;
    const { game, teamId } = pending;
    const sessionNow = (await supabase.auth.getSession()).data.session;
    const exists = (await supabase.from("picks").select("*").eq("user_id", sessionNow.user.id).eq("week", week)).data?.[0];
    if(exists){
      const { error } = await supabase.from("picks").update({ team_id: teamId, game_id: game.id, updated_at: new Date().toISOString() }).eq("id", exists.id);
      if(error) return alert(error.message);
    } else {
      const { error } = await supabase.from("picks").insert({ user_id: sessionNow.user.id, game_id: game.id, team_id: teamId, week, season: 2025 });
      if(error) return alert(error.message);
    }
    setPending(null);
    const { data: pk } = await supabase.from("picks").select("*").eq("user_id", sessionNow.user.id);
    setPicks(pk||[]); alert("Pick guardado desde Asistente ✅");
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Asistente de picks</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Semana</label>
          <select className="border p-1 rounded-lg" value={week} onChange={(e)=>{localStorage.setItem("week",String(Number(e.target.value))); setWeek(Number(e.target.value));}}>
            {Array.from({length:18},(_,i)=>i+1).map(w=><option key={w} value={w}>W{w}</option>)}
          </select>
        </div>
      </header>
      <p className="text-sm text-gray-600 mt-2">Ordenamos por win% (spread), diferencial de popularidad y disponibilidad. Puedes “Pick” directo.</p>

      <div className="mt-4 grid md:grid-cols-2 gap-3">
        {suggestions.map((s,i)=>(
          <div key={i} className="p-3 border rounded-xl bg-white">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1">
                <img src={teamsMap[s.teamId]?.logo_url || `/teams/${s.teamId}.png`} alt={s.teamId} className="h-5 w-5 rounded-full object-contain"/>
                <span className="font-mono font-semibold">{s.teamId}</span>
              </span>
              <div className="text-xs flex gap-2">
                {s.spread!=null && <span className="px-2 py-0.5 rounded bg-gray-100">spread {s.spread>0?`+${s.spread}`:s.spread}</span>}
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900">win% {Math.round(s.wp*100)}%</span>
                <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">DIF {Math.round(100 - s.popPct)}%</span>
                {!s.notUsed && <span className="px-2 py-0.5 rounded bg-gray-200">usado</span>}
                {!s.unlocked && <span className="px-2 py-0.5 rounded bg-gray-200">lock</span>}
              </div>
            </div>
            <div className="mt-2 text-xs text-gray-600">
              {s.game.away_team} @ {s.game.home_team} · {DateTime.fromISO(s.game.start_time).setZone(TZ).toFormat("EEE dd LLL HH:mm")}
            </div>
            <div className="mt-3">
              <button className="px-3 py-1 rounded border" disabled={!s.unlocked} onClick={()=>setPending({game:s.game, teamId:s.teamId})}>Pick</button>
            </div>
          </div>
        ))}
        {suggestions.length===0 && <div className="text-sm text-gray-500">Sin datos para esta semana.</div>}
      </div>

      {pending && <ConfirmModal onCancel={()=>setPending(null)} onConfirm={doPick}>¿Usar <b>{pending.teamId}</b> como tu pick para W{week}?</ConfirmModal>}
    </div>
  );
}

/* =============== Standings+ =============== */
function StandingsPlus(){
  const [mode, setMode] = useState("global"); // global | conf | div
  const [standings, setStandings] = useState([]); const [teams, setTeams] = useState([]);
  useEffect(()=>{ (async()=>{ const {data:st}=await supabase.from("standings").select("*"); setStandings(st||[]);
    const {data:ts}=await supabase.from("teams").select("*"); setTeams(ts||[]); })(); },[]);
  const byConf = useMemo(()=>{ const m={}; for(const t of teams){ const c=t.conference||"N/A"; (m[c]=m[c]||[]).push(t);} return m; },[teams]);
  const byDiv = useMemo(()=>{ const m={}; for(const t of teams){ const k=`${t.conference||"N/A"} ${t.division||""}`.trim(); (m[k]=m[k]||[]).push(t);} return m; },[teams]);

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Standings+</h1>
        <div className="flex gap-2">
          <button className={`px-3 py-1 rounded border ${mode==="global"?"bg-black text-white":""}`} onClick={()=>setMode("global")}>Global</button>
          <button className={`px-3 py-1 rounded border ${mode==="conf"?"bg-black text-white":""}`} onClick={()=>setMode("conf")}>Por conferencia</button>
          <button className={`px-3 py-1 rounded border ${mode==="div"?"bg-black text-white":""}`} onClick={()=>setMode("div")}>Por división</button>
        </div>
      </header>

      {mode==="global" && (
        <div className="mt-4 p-4 border rounded-2xl bg-white">
          <h2 className="font-semibold">Tabla de supervivientes</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm mt-3">
              <thead><tr className="text-left text-gray-500"><th>Jugador</th><th>Vidas</th><th>W</th><th>L</th><th>Push</th><th>Margen</th></tr></thead>
              <tbody>
                {(standings||[]).map(s=>(
                  <tr key={s.user_id} className="border-t">
                    <td className="py-1.5">{s.display_name}</td>
                    <td>{s.lives}</td>
                    <td className="text-emerald-700 font-medium">{s.wins}</td>
                    <td className="text-red-600 font-medium">{s.losses}</td>
                    <td className="text-gray-600">{s.pushes}</td>
                    <td>{s.margin_sum}</td>
                  </tr>
                ))}
                {(!standings||standings.length===0) && <tr><td className="py-2 text-gray-500" colSpan={6}>Sin datos.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mode==="conf" && (
        <div className="mt-4 grid md:grid-cols-2 gap-4">
          {Object.entries(byConf).map(([conf,list])=>(
            <div key={conf} className="p-4 border rounded-2xl bg-white">
              <h2 className="font-semibold">{conf}</h2>
              <ul className="text-sm mt-2 space-y-1">{list.map(t=><li key={t.id}><TeamMini id={t.id}/> <span className="text-gray-500">· {t.division || "-"}</span></li>)}</ul>
            </div>
          ))}
        </div>
      )}

      {mode==="div" && (
        <div className="mt-4 grid md:grid-cols-2 gap-4">
          {Object.entries(byDiv).map(([div,list])=>(
            <div key={div} className="p-4 border rounded-2xl bg-white">
              <h2 className="font-semibold">{div}</h2>
              <ul className="text-sm mt-2 space-y-1">{list.map(t=><li key={t.id}><TeamMini id={t.id}/> <span className="text-gray-500">· {t.name}</span></li>)}</ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}









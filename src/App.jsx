// src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { supabase } from "./lib/supabaseClient";
import Rules from "./Rules";

/* ===== Config ===== */
const TZ = import.meta.env.VITE_TZ || "America/Mexico_City";
const SITE = import.meta.env.VITE_SITE_URL || "";
const CRON_TOKEN = import.meta.env.VITE_CRON_TOKEN || "";

/* ===== Utilidades ===== */
function Countdown({ iso }) {
  const [left, setLeft] = useState("");
  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => {
      const t = DateTime.fromISO(iso)
        .setZone(TZ)
        .diffNow(["days", "hours", "minutes", "seconds"])
        .toObject();
      const d = Math.max(0, Math.floor(t.days || 0));
      const h = Math.max(0, Math.floor(t.hours || 0));
      const m = Math.max(0, Math.floor(t.minutes || 0));
      const s = Math.max(0, Math.floor(t.seconds || 0));
      setLeft(`${d}d ${h}h ${m}m ${s}s`);
    }, 1000);
    return () => clearInterval(id);
  }, [iso]);
  return <span>{left}</span>;
}

function downloadCSV(filename, rows) {
  const esc = (v) => (v == null ? "" : `"${String(v).replaceAll('"', '""')}"`);
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* win% simple desde spread favorito */
const winProbFromSpread = (s) =>
  Math.round((1 / (1 + Math.exp(-0.23 * Math.max(0, s || 0)))) * 100);

/* ===== Sesión ===== */
function useSession() {
  const [session, setSession] = useState(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSession(s)
    );
    return () => sub.subscription.unsubscribe();
  }, []);
  return session;
}

/* ===== Login ===== */
function Login() {
  const [tab, setTab] = useState("password");
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const [passEmail, setPassEmail] = useState("");
  const [passPwd, setPassPwd] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [displayName, setDisplayName] = useState("");

  const [resetEmail, setResetEmail] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [resetInfo, setResetInfo] = useState("");

  useEffect(() => {
    if ((window.location.hash || "").includes("type=recovery")) setTab("reset");
  }, []);

  const magic = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: import.meta.env.VITE_SITE_URL || window.location.origin },
    });
    if (!error) setSent(true); else alert(error.message);
  };

  const passwordAuth = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email: passEmail, password: passPwd,
          options: {
            data: { display_name: displayName || passEmail.split("@")[0] },
            emailRedirectTo: import.meta.env.VITE_SITE_URL || window.location.origin,
          },
        });
        if (error) throw error;
        if (data.user) {
          await supabase.from("profiles").upsert({
            id: data.user.id,
            email: passEmail,
            display_name: displayName || passEmail.split("@")[0],
            lives: 2,
            is_admin: false,
          });
        }
        alert("Cuenta creada. Revisa tu correo para confirmar.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: passEmail, password: passPwd,
        });
        if (error) throw error;
      }
    } catch (e2) { alert(e2.message); } finally { setBusy(false); }
  };

  const sendReset = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: import.meta.env.VITE_SITE_URL || window.location.origin,
      });
      if (error) throw error;
      setResetInfo("Enlace enviado, revisa tu correo.");
    } catch (e2) { alert(e2.message); } finally { setBusy(false); }
  };
  const applyNew = async (e) => {
    e.preventDefault();
    if (!newPwd || newPwd.length < 6) return alert("Mínimo 6 caracteres.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPwd });
      if (error) throw error;
      setResetInfo("Contraseña actualizada."); setTimeout(()=>setTab("password"),1200);
    } catch (e2) { alert(e2.message); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-white">
      <div className="w-full max-w-md space-y-4 p-6 card">
        <h1 className="text-3xl font-extrabold tracking-tight text-center">
          {import.meta.env.VITE_LEAGUE_NAME || "Survivor 2025"}
        </h1>

        <div className="flex gap-2 justify-center">
          <button className={`btn ${tab==="password"?"primary":""}`} onClick={()=>setTab("password")}>Email + Password</button>
          <button className={`btn ${tab==="magic"?"primary":""}`} onClick={()=>setTab("magic")}>Magic link</button>
          <button className={`btn ${tab==="reset"?"primary":""}`} onClick={()=>setTab("reset")}>Olvidé mi contraseña</button>
        </div>

        {tab==="password" && (
          <form onSubmit={passwordAuth} className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm">{isSignup ? "Crear cuenta" : "Iniciar sesión"}</label>
              <button type="button" className="text-xs underline" onClick={()=>setIsSignup(!isSignup)}>
                {isSignup ? "¿Ya tienes cuenta? Inicia sesión" : "¿No tienes cuenta? Regístrate"}
              </button>
            </div>
            {isSignup && (
              <input className="input" placeholder="Nombre para mostrar"
                value={displayName} onChange={(e)=>setDisplayName(e.target.value)} />
            )}
            <input type="email" className="input" placeholder="email"
              value={passEmail} onChange={(e)=>setPassEmail(e.target.value)} required />
            <input type="password" className="input" placeholder="contraseña"
              value={passPwd} onChange={(e)=>setPassPwd(e.target.value)} required />
            <button disabled={busy} className="btn primary w-full">{isSignup?"Crear cuenta":"Entrar"}</button>
          </form>
        )}

        {tab==="magic" && (
          <form onSubmit={magic} className="space-y-3">
            <input type="email" className="input" placeholder="tu@email.com"
              value={email} onChange={(e)=>setEmail(e.target.value)} required />
            <button className="btn primary w-full">Enviar magic link</button>
            {sent && <p className="text-xs text-muted">Revisa tu correo.</p>}
          </form>
        )}

        {tab==="reset" && (window.location.hash.includes("type=recovery") ? (
          <form onSubmit={applyNew} className="space-y-3">
            <input type="password" className="input" placeholder="nueva contraseña"
              value={newPwd} onChange={(e)=>setNewPwd(e.target.value)} required />
            <button disabled={busy} className="btn primary w-full">Guardar</button>
            {resetInfo && <p className="text-xs text-emerald-700">{resetInfo}</p>}
          </form>
        ) : (
          <form onSubmit={sendReset} className="space-y-3">
            <input type="email" className="input" placeholder="tu email"
              value={resetEmail} onChange={(e)=>setResetEmail(e.target.value)} required />
            <button disabled={busy} className="btn primary w-full">Enviar enlace</button>
            {resetInfo && <p className="text-xs text-emerald-700">{resetInfo}</p>}
          </form>
        ))}
      </div>
    </div>
  );
}

/* ===== Root con tabs ===== */
function AppRoot() {
  const session = useSession();
  const [tab, setTab] = useState("games"); // games | assistant | nfl | news | rules
  if (!session) return <Login />;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="w-full border-b bg-white sticky top-0 z-50 safe-top">
        <div className="container flex items-center gap-2">
          {[
            ["games","Partidos"],
            ["assistant","Asistente"],
            ["nfl","NFL"],
            ["news","Noticias"],
            ["rules","Reglas"],
          ].map(([k,label])=>(
            <button key={k} className={`btn ${tab===k?"primary":""}`} onClick={()=>setTab(k)}>{label}</button>
          ))}
          <div style={{flex:1}} />
          <button className="text-sm underline" onClick={()=>supabase.auth.signOut()}>Salir</button>
        </div>
      </div>

      {tab==="games" && <AppAuthed session={session} />}
      {tab==="assistant" && <Assistant session={session} />}
      {tab==="nfl" && <NFLTab />}
      {tab==="news" && <NewsHub />}
      {tab==="rules" && <div className="container"><Rules/></div>}
    </div>
  );
}
export default AppRoot;

/* ===== Partidos + Liga ===== */
function AppAuthed({ session }) {
  const [me, setMe] = useState(null);
  const [week, setWeek] = useState(()=>Number(localStorage.getItem("week"))||1);

  const [teamsMap, setTeamsMap] = useState({});
  const [games, setGames] = useState([]);
  const [oddsPairs, setOddsPairs] = useState({});
  const [picks, setPicks] = useState([]);
  const [leaguePicks, setLeaguePicks] = useState([]);
  const [userNames, setUserNames] = useState({});
  const [popularity, setPopularity] = useState([]);
  const [standingsLeague, setStandingsLeague] = useState([]);

  const [pendingPick, setPendingPick] = useState(null);

  const [dayFilter, setDayFilter] = useState(localStorage.getItem("dayFilter")||"ALL");
  const [teamQuery, setTeamQuery] = useState(localStorage.getItem("teamQuery")||"");
  const searchRef = useRef(null);

  const loadTeams = async () => {
    const { data } = await supabase.from("teams").select("*");
    const m={}; (data||[]).forEach(t=>m[t.id]=t); setTeamsMap(m);
  };
  const loadGames = async (w) => {
    const { data: gs } = await supabase.from("games").select("*").eq("week",w).order("start_time");
    setGames(gs||[]);
    const ids=(gs||[]).map(g=>g.id);
    if(ids.length){
      const { data } = await supabase
        .from("odds")
        .select("game_id, spread_home, spread_away, ml_home, ml_away, fetched_at")
        .in("game_id", ids)
        .order("fetched_at",{ascending:false});
      const by={};
      for(const r of data||[]){
        if(!by[r.game_id]) by[r.game_id]={last:r, prev:null};
        else if(!by[r.game_id].prev) by[r.game_id].prev=r;
      } setOddsPairs(by);
    } else setOddsPairs({});
  };
  const loadPicksMine = async ()=> {
    const { data } = await supabase.from("picks").select("*").eq("user_id",session.user.id);
    setPicks(data||[]);
  };
  const loadLeaguePicks = async (w)=> {
    const { data: pks } = await supabase.from("picks")
      .select("id,user_id,team_id,result,auto_pick,updated_at,week").eq("week",w);
    setLeaguePicks(pks||[]);
    const ids=[...new Set((pks||[]).map(x=>x.user_id))];
    if(ids.length){
      const { data: profs } = await supabase.from("profiles").select("id,display_name").in("id",ids);
      const m={}; (profs||[]).forEach(p=>m[p.id]=p.display_name); setUserNames(m);
    } else setUserNames({});
    const { data: totalProfiles } = await supabase.from("profiles").select("id");
    const total = totalProfiles?.length || 1;
    const counts={};
    (pks||[]).forEach(x=>{ if(x.team_id) counts[x.team_id]=(counts[x.team_id]||0)+1; });
    const list = Object.entries(counts).map(([team_id, count])=>({
      team_id, count, pct: Math.round((count*100)/total)
    })).sort((a,b)=>b.count-a.count);
    setPopularity(list);
  };
  const loadLeagueStandings = async ()=>{
    const { data } = await supabase.from("standings").select("*").order("wins",{ascending:false});
    setStandingsLeague(data||[]);
  };

  const init = async ()=>{
    const email = session.user.email;
    let { data: prof } = await supabase.from("profiles").select("*").eq("email",email).single();
    if(!prof){
      await supabase.from("profiles").insert({ id:session.user.id, email, display_name: email.split("@")[0], lives:2 });
      const r = await supabase.from("profiles").select("*").eq("email",email).single();
      prof=r.data;
    }
    setMe(prof);
    await loadTeams();
    await loadPicksMine();
    await loadLeagueStandings();
    await loadGames(week);
    await loadLeaguePicks(week);
  };

  useEffect(()=>{init(); /* eslint-disable-next-line */},[]);
  useEffect(()=>{
    loadGames(week); loadLeaguePicks(week);
    localStorage.setItem("week",String(week));
    /* eslint-disable-next-line */
  },[week]);

  useEffect(()=>{
    const anyLive=(games||[]).some(g=>g.status==="in_progress");
    if(!anyLive) return;
    const id=setInterval(()=>{ loadGames(week); loadLeaguePicks(week); },30000);
    return ()=>clearInterval(id);
    // eslint-disable-next-line
  },[games,week]);

  useEffect(()=>localStorage.setItem("dayFilter",dayFilter),[dayFilter]);
  useEffect(()=>localStorage.setItem("teamQuery",teamQuery),[teamQuery]);

  const myPickThisWeek = useMemo(()=> (picks||[]).find(p=>p.week===week),[picks,week]);
  const nextKickoffISO = useMemo(()=>{
    const up=(games||[]).find(g=>DateTime.fromISO(g.start_time)>DateTime.now());
    return up?.start_time||null;
  },[games]);
  const showPickAlert = useMemo(()=>{
    if(myPickThisWeek || !nextKickoffISO) return false;
    const mins = DateTime.fromISO(nextKickoffISO).diffNow("minutes").minutes;
    return mins<=90 && mins>0;
  },[myPickThisWeek,nextKickoffISO]);

  const canPick=(g,team)=>{
    const locked = DateTime.fromISO(g.start_time)<=DateTime.now();
    if(locked) return {ok:false, reason:"LOCK"};
    const used=(picks||[]).some(p=>p.team_id===team && p.user_id===session.user.id);
    if(used && !(myPickThisWeek && myPickThisWeek.team_id===team))
      return {ok:false, reason:"USED"};
    return {ok:true};
  };
  const confirmPick=(game,teamId)=>{
    const c=canPick(game,teamId);
    if(!c.ok) return alert(c.reason==="LOCK"?"Cerrado por kickoff":"Ya usaste este equipo");
    setPendingPick({game,teamId});
  };
  const doPick = async ()=>{
    if(!pendingPick) return;
    const { game, teamId } = pendingPick;
    if(myPickThisWeek){
      const { error } = await supabase.from("picks")
        .update({ team_id:teamId, game_id:game.id, updated_at:new Date().toISOString() })
        .eq("id", myPickThisWeek.id);
      if(error) return alert(error.message);
    } else {
      const { error } = await supabase.from("picks")
        .insert({ user_id:session.user.id, game_id:game.id, team_id:teamId, week, season:2025 });
      if(error) return alert(error.message);
    }
    await loadPicksMine(); await loadLeaguePicks(week); setPendingPick(null);
  };

  const TeamMini=({id,strong})=>{
    const t=teamsMap[id]||{}; const src=t.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-1">
        <img src={src} alt={id} className="h-5 w-5 rounded-full object-contain"/>
        <span className={`font-mono ${strong?"font-bold":"font-semibold"}`}>{id}</span>
      </span>
    );
  };
  const TeamChip=({id})=>{
    const t=teamsMap[id]||{}; const src=t.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-2">
        <img src={src} alt={id} className="h-6 w-6 rounded-full object-contain"/>
        <span className="font-medium">{t.name||id}</span>
      </span>
    );
  };

  const gamesByDay = useMemo(()=>{
    if(dayFilter==="ALL") return games;
    const map={THU:4,FRI:5,SAT:6,SUN:7,MON:1}; const want=map[dayFilter];
    return (games||[]).filter(g=>DateTime.fromISO(g.start_time).setZone(TZ).weekday===want);
  },[games,dayFilter]);

  const gamesFiltered = useMemo(()=>{
    const q=teamQuery.trim().toLowerCase(); if(!q) return gamesByDay;
    const match=(id)=>{ const t=teamsMap[id]; return id.toLowerCase().includes(q) || (t?.name||"").toLowerCase().includes(q); };
    return (gamesByDay||[]).filter(g=>match(g.away_team)||match(g.home_team));
  },[gamesByDay,teamQuery,teamsMap]);

  const ScoreStrip=({g})=>{
    const score=(
      <div className="flex items-center gap-4">
        <div className="text-xl font-bold">{g.away_team} <span className="tabular-nums">{g.away_score??0}</span></div>
        <div className="text-muted">—</div>
        <div className="text-xl font-bold">{g.home_team} <span className="tabular-nums">{g.home_score??0}</span></div>
      </div>
    );
    if(g.status==="final") return <div className="flex items-center justify-between">{score}<span className="badge">FINAL</span></div>;
    if(g.status==="in_progress") return (
      <div className="flex items-center justify-between">
        {score}
        <div className="text-xs flex items-center gap-2">
          <span className="badge warn">Q{g.period??""} {g.clock??""}</span>
          {g.possession && <span className="badge">⬤ {g.possession}</span>}
        </div>
      </div>
    );
    return (
      <div className="flex items-center justify-between">
        {score}
        <span className="badge">Kickoff en <Countdown iso={g.start_time}/></span>
      </div>
    );
  };

  const TeamBox=({game,teamId})=>{
    const disabled=!canPick(game,teamId).ok;
    const selected = myPickThisWeek?.game_id===game.id && myPickThisWeek?.team_id===teamId;

    const { last } = oddsPairs[game.id] || {};
    let fav=false, spread=null, ml=null, favBy=0;
    if(last){
      if(teamId===game.home_team){
        spread=last.spread_home; ml=last.ml_home;
        fav=(last.spread_home??999)<(last.spread_away??999) || (last.ml_home??9999)<(last.ml_away??9999);
        favBy=Math.abs(last.spread_home||0);
      } else {
        spread=last.spread_away; ml=last.ml_away;
        fav=(last.spread_away??999)<(last.spread_home??999) || (last.ml_away??9999)<(last.ml_home??9999);
        favBy=Math.abs(last.spread_away||0);
      }
    }
    const pct = popularity.find(p=>p.team_id===teamId)?.pct ?? 0;
    const winPct = fav ? winProbFromSpread(favBy) : null;

    return (
      <button
        onClick={()=>confirmPick(game,teamId)} disabled={disabled}
        className={[
          "w-full text-left rounded-xl border transition px-4 py-3",
          selected?"border-emerald-500":"border-gray-200",
          disabled?"opacity-50 cursor-not-allowed":"hover:bg-gray-50",
        ].join(" ")}
      >
        <div className="flex items-center justify-between">
          <TeamMini id={teamId} strong />
          <div className="text-xs flex items-center gap-2">
            {fav && <span className="badge warn">Fav</span>}
            {pct<15 && <span className="badge info">DIF</span>}
          </div>
        </div>
        <div className="mt-1 text-xs text-muted flex items-center gap-3">
          {spread!=null && <span>Spread: {spread>0?`+${spread}`:spread}</span>}
          {ml!=null && <span>ML: {ml>0?`+${ml}`:ml}</span>}
          {winPct!=null && <span>Win%: {winPct}%</span>}
          <span>Liga: {pct}%</span>
        </div>
      </button>
    );
  };

  const autopickMe = async ()=>{
    try{
      if(!SITE || !CRON_TOKEN) throw new Error("Falta SITE o CRON_TOKEN");
      const url = `${SITE}/api/autopickOne?week=${week}&user_id=${encodeURIComponent(session.user.id)}&token=${encodeURIComponent(CRON_TOKEN)}`;
      const r=await fetch(url); const j=await r.json().catch(()=>({}));
      if(!r.ok||j.ok===false) throw new Error(j.error||"Error autopick");
      alert("Autopick aplicado.");
      await loadPicksMine(); await loadLeaguePicks(week);
    }catch(e){ alert(e.message); }
  };

  const nflStandings = useMemo(()=>{
    const rec={};
    (games||[]).filter(g=>g.status==="final").forEach(g=>{
      const ah=g.away_score||0, hh=g.home_score||0;
      const away=g.away_team, home=g.home_team;
      if(!rec[away]) rec[away]={w:0,l:0,t:0,diff:0};
      if(!rec[home]) rec[home]={w:0,l:0,t:0,diff:0};
      if(ah>hh){ rec[away].w++; rec[home].l++; } else if(hh>ah){ rec[home].w++; rec[away].l++; } else { rec[away].t++; rec[home].t++; }
      rec[away].diff += (ah-hh); rec[home].diff += (hh-ah);
    });
    const byConf={}, byDiv={};
    Object.entries(teamsMap).forEach(([id,t])=>{
      const r=rec[id]||{w:0,l:0,t:0,diff:0};
      (byConf[t.conference] ||= []).push({team:id, ...r});
      (byDiv[`${t.conference}-${t.division}`] ||= []).push({team:id, ...r});
    });
    const sorter=(a,b)=> b.w-a.w || (b.diff||0)-(a.diff||0);
    Object.keys(byConf).forEach(k=>byConf[k].sort(sorter));
    Object.keys(byDiv).forEach(k=>byDiv[k].sort(sorter));
    return { byConf, byDiv };
  },[games,teamsMap]);

  return (
    <div className="container">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {import.meta.env.VITE_LEAGUE_NAME || "2025"}
          </h1>
          <p className="text-sm text-muted">
            Hola, <b>{me?.display_name}</b> · Vidas: <span className="badge ok">{me?.lives ?? 0}</span>
          </p>
        </div>
      </header>

      {showPickAlert && (
        <div className="mt-3 p-3 border-2 border-red-300 rounded-xl bg-red-50 text-red-900 text-sm">
          🔔 Aún no tienes pick en W{week}. Kickoff en <b><Countdown iso={nextKickoffISO}/></b>.
        </div>
      )}

      {/* Toolbar */}
      <section className="mt-4 grid md:grid-cols-3 gap-4">
        <div className="card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted">Semana</label>
              <select className="input" style={{width:90}} value={week} onChange={(e)=>setWeek(Number(e.target.value))}>
                {Array.from({length:18},(_,i)=>i+1).map(w=><option key={w} value={w}>W{w}</option>)}
              </select>
            </div>
            <div className="flex gap-1 text-xs">
              {["ALL","THU","FRI","SAT","SUN","MON"].map(d=>(
                <button key={d} className={`btn ${dayFilter===d?"primary":""}`} onClick={()=>setDayFilter(d)}>{d}</button>
              ))}
            </div>
          </div>
          <input ref={searchRef} className="input mt-3" placeholder="Buscar equipo..."
            value={teamQuery} onChange={(e)=>setTeamQuery(e.target.value)} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn text-xs" onClick={()=>downloadCSV("mis_picks.csv",[
              ["week","team_id","result","auto_pick","updated_at"],
              ...(picks||[]).map(p=>[p.week,p.team_id,p.result,p.auto_pick,p.updated_at]),
            ])}>Exportar mis picks (CSV)</button>
            <button className="btn text-xs" onClick={()=>downloadCSV(`picks_w${week}.csv`,[
              ["player","team","result","auto","updated"],
              ...(leaguePicks||[]).map(x=>[
                userNames[x.user_id]||x.user_id.slice(0,6), x.team_id, x.result, x.auto_pick?"sí":"no", x.updated_at
              ])
            ])}>Exportar liga (CSV)</button>
            <button className="btn text-xs" onClick={autopickMe}>Autopick para mí</button>
          </div>
        </div>

        <div className="md:col-span-2 card">
          <h3 className="font-semibold">Resumen</h3>
          <p className="text-sm text-muted">
            Elige tu pick abajo. Verás momios (spread/ML), <b>Win%</b> estimado y etiqueta <b>DIF</b> si es poco popular.
          </p>
        </div>
      </section>

      {/* Partidos */}
      <section className="mt-4 card">
        <h2 className="font-semibold mb-3">Partidos W{week}</h2>
        <div className="space-y-3">
          {gamesFiltered.map((g)=>{
            const locked = DateTime.fromISO(g.start_time)<=DateTime.now();
            const local = DateTime.fromISO(g.start_time).setZone(TZ).toFormat("EEE dd LLL HH:mm");
            return (
              <div key={g.id} className={`p-4 border rounded-xl ${locked?"opacity-60":""}`}>
                <div className="flex items-center justify-between">
                  <div className="text-sm flex items-center gap-2 flex-wrap">
                    <TeamChip id={g.away_team}/><span className="mx-1 text-muted">@</span><TeamChip id={g.home_team}/>
                  </div>
                  <div className="text-xs text-muted">
                    Kickoff: <span className="badge">{local}</span> · Lock: <Countdown iso={g.start_time}/>
                  </div>
                </div>
                <div className="mt-3"><ScoreStrip g={g}/></div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TeamBox game={g} teamId={g.home_team}/>
                  <TeamBox game={g} teamId={g.away_team}/>
                </div>
              </div>
            );
          })}
          {(!gamesFiltered || gamesFiltered.length===0) && (
            <div className="text-sm text-muted">No hay partidos para este filtro o búsqueda.</div>
          )}
        </div>
      </section>

      {/* Liga: picks + popularidad */}
      <section className="mt-6 grid md:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="font-semibold">Picks de la liga (W{week})</h2>
          <div className="overflow-x-auto">
            <table className="table mt-3">
              <thead><tr><th>Jugador</th><th>Equipo</th><th>Resultado</th><th>Auto</th><th>Actualizado</th></tr></thead>
              <tbody>
                {(leaguePicks||[]).slice().sort((a,b)=>(userNames[a.user_id]||"").localeCompare(userNames[b.user_id]||""))
                  .map(p=>(
                  <tr key={p.id}>
                    <td>{userNames[p.user_id]||p.user_id.slice(0,6)}</td>
                    <td><TeamMini id={p.team_id}/></td>
                    <td>
                      <span className={
                        p.result==="win"?"text-emerald-700 font-semibold":
                        p.result==="loss"?"text-red-600 font-semibold":
                        p.result==="push"?"text-muted":"text-muted"
                      }>{p.result||"pending"}</span>
                    </td>
                    <td>{p.auto_pick?"Sí":"No"}</td>
                    <td className="text-xs text-muted">
                      {p.updated_at? DateTime.fromISO(p.updated_at).setZone(TZ).toFormat("dd LLL HH:mm"):"-"}
                    </td>
                  </tr>
                ))}
                {(!leaguePicks||leaguePicks.length===0) && <tr><td colSpan={5} className="text-muted">Aún no hay picks.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2 className="font-semibold">Popularidad de equipos</h2>
          <p className="text-xs text-muted">Porcentaje de jugadores que pickearon ese equipo.</p>
          <div className="mt-3 space-y-2">
            {(popularity||[]).map(row=>(
              <div key={row.team_id}>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2"><TeamMini id={row.team_id}/> <span className="text-muted">({row.count})</span></div>
                  <span>{row.pct}%</span>
                </div>
                <div className="progress mt-1"><div className="bar" style={{width:`${row.pct}%`}}/></div>
              </div>
            ))}
            {(!popularity||popularity.length===0) && <div className="text-sm text-muted">Aún no hay picks.</div>}
          </div>
        </div>
      </section>

      {/* Standings liga */}
      <section className="mt-6 card">
        <h2 className="font-semibold">Standings de la liga</h2>
        <div className="overflow-x-auto">
          <table className="table mt-3">
            <thead><tr><th>Jugador</th><th>Vidas</th><th>W</th><th>L</th><th>Push</th><th>Margen</th></tr></thead>
            <tbody>
              {(standingsLeague||[]).map(s=>(
                <tr key={s.user_id}>
                  <td>{s.display_name}</td><td>{s.lives}</td>
                  <td className="text-emerald-700 font-medium">{s.wins}</td>
                  <td className="text-red-600 font-medium">{s.losses}</td>
                  <td className="text-muted">{s.pushes}</td>
                  <td>{s.margin_sum}</td>
                </tr>
              ))}
              {(!standingsLeague||standingsLeague.length===0) && <tr><td colSpan={6} className="text-muted">Aún no hay standings.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal */}
      {pendingPick && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 card">
            <h3 className="font-semibold text-lg">Confirmar pick</h3>
            <p className="mt-2 text-sm">¿Confirmas tu pick de <b>{pendingPick.teamId}</b> en W{week}?</p>
            <div className="mt-4 flex gap-2">
              <button className="btn" onClick={()=>setPendingPick(null)}>Cancelar</button>
              <button className="btn primary" onClick={doPick}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {!myPickThisWeek && nextKickoffISO && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded-xl bg-black text-white text-sm shadow-lg safe-bottom">
          Recuerda elegir: <Countdown iso={nextKickoffISO}/>
        </div>
      )}
    </div>
  );
}

/* ===== Asistente (recomendaciones) ===== */
function Assistant({ session }) {
  const [week, setWeek] = useState(()=>Number(localStorage.getItem("week"))||1);
  const [teamsMap, setTeamsMap] = useState({});
  const [games, setGames] = useState([]);
  const [oddsPairs, setOddsPairs] = useState({});
  const [picks, setPicks] = useState([]);
  const [popularity, setPopularity] = useState([]);

  const loadTeams=async()=>{ const {data}=await supabase.from("teams").select("*"); const m={};(data||[]).forEach(t=>m[t.id]=t); setTeamsMap(m); };
  const loadGames=async(w)=>{ const {data}=await supabase.from("games").select("*").eq("week",w).order("start_time"); setGames(data||[]); const ids=(data||[]).map(g=>g.id);
    if(ids.length){ const {data:od}=await supabase.from("odds").select("game_id, spread_home, spread_away, ml_home, ml_away, fetched_at").in("game_id",ids).order("fetched_at",{ascending:false});
      const by={}; for(const r of od||[]){ if(!by[r.game_id]) by[r.game_id]={last:r,prev:null}; else if(!by[r.game_id].prev) by[r.game_id].prev=r; } setOddsPairs(by);
    } else setOddsPairs({}); };
  const loadPicksMine=async()=>{ const {data}=await supabase.from("picks").select("*").eq("user_id",session.user.id); setPicks(data||[]); };
  const loadPopularity=async(w)=>{ const {data:pks}=await supabase.from("picks").select("team_id").eq("week",w); const {data:all}=await supabase.from("profiles").select("id");
    const total=all?.length||1; const counts={}; (pks||[]).forEach(x=>{ if(x.team_id) counts[x.team_id]=(counts[x.team_id]||0)+1; });
    setPopularity(Object.entries(counts).map(([team_id,count])=>({team_id, pct:Math.round((count*100)/total), count})));
  };

  useEffect(()=>{ loadTeams(); loadPicksMine(); loadGames(week); loadPopularity(week); /* eslint-disable-next-line */ },[week]);

  const usedTeams=new Set((picks||[]).map(p=>p.team_id));
  const suggestions=useMemo(()=>{
    const rows=[];
    (games||[]).forEach(g=>{
      const o=oddsPairs[g.id]?.last; if(!o) return;
      [
        {team:g.home_team, spread:o.spread_home, ml:o.ml_home},
        {team:g.away_team, spread:o.spread_away, ml:o.ml_away},
      ].forEach(s=>{
        const fav=(s.spread??999)<0 || (s.ml??9999)<0;
        const win=fav?winProbFromSpread(Math.abs(s.spread||0)):50;
        const pop=popularity.find(p=>p.team_id===s.team)?.pct ?? 0;
        const used=usedTeams.has(s.team);
        const score=(win-pop)-(used?100:0);
        if(!used) rows.push({team:s.team, game:g, fav, win, pop, score});
      });
    });
    return rows.sort((a,b)=>b.score-a.score).slice(0,8);
  },[games,oddsPairs,popularity,usedTeams]);

  const pickQuick=async(teamId,gameId)=>{
    try{
      const { data:w }=await supabase.from("games").select("week").eq("id",gameId).single();
      const wk=w?.week||week;
      const { error }=await supabase.from("picks").insert({ user_id:session.user.id, game_id:gameId, team_id:teamId, week:wk, season:2025 });
      if(error) throw error;
      alert("Pick guardado.");
      await loadPicksMine();
    }catch(e){ alert(e.message); }
  };

  return (
    <div className="container">
      <h1 className="text-2xl font-extrabold tracking-tight">Asistente</h1>
      <div className="mt-3 card">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted">Semana</label>
          <select className="input" style={{width:90}} value={week} onChange={(e)=>setWeek(Number(e.target.value))}>
            {Array.from({length:18},(_,i)=>i+1).map(w=><option key={w} value={w}>W{w}</option>)}
          </select>
        </div>
        <p className="text-sm text-muted mt-2">Ordena picks sugeridos por win% alto, no-usado y bajo % de liga.</p>
      </div>

      <section className="mt-4 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {suggestions.map((s,i)=>(
          <div key={i} className="card">
            <div className="flex items-center justify-between">
              <div className="text-sm"><b>{s.team}</b> · W{week}</div>
              {s.fav&&<span className="badge warn">Fav</span>}
            </div>
            <div className="text-xs text-muted mt-1">Win {s.win}% · Liga {s.pop}%</div>
            <div className="mt-2 flex gap-2">
              <button className="btn primary" onClick={()=>pickQuick(s.team, s.game.id)}>Elegir por mí</button>
              <span className="text-xs text-muted self-center">({s.game.away_team}@{s.game.home_team})</span>
            </div>
          </div>
        ))}
        {suggestions.length===0 && <div className="text-sm text-muted">Sin sugerencias por ahora.</div>}
      </section>
    </div>
  );
}

/* ===== NFL Tab (standings neat) ===== */
function NFLTab() {
  const [teamsMap, setTeamsMap] = useState({});
  const [games, setGames] = useState([]);

  const loadTeams = async()=>{ const {data}=await supabase.from("teams").select("*"); const m={};(data||[]).forEach(t=>m[t.id]=t); setTeamsMap(m); };
  const loadAllGames = async()=>{ // toda la temporada para standings
    const { data } = await supabase.from("games").select("*").order("start_time");
    setGames(data||[]);
  };

  useEffect(()=>{ loadTeams(); loadAllGames(); },[]);

  const TeamMini=({id})=>{
    const t=teamsMap[id]||{}; const src=t.logo_url || `/teams/${id}.png`;
    return <span className="inline-flex items-center gap-1">
      <img src={src} alt={id} className="h-5 w-5 rounded-full object-contain"/><span className="font-mono font-semibold">{id}</span>
    </span>;
  };

  const standings = useMemo(()=>{
    const rec={};
    (games||[]).filter(g=>g.status==="final").forEach(g=>{
      const ah=g.away_score||0, hh=g.home_score||0;
      const away=g.away_team, home=g.home_team;
      if(!rec[away]) rec[away]={w:0,l:0,t:0,diff:0};
      if(!rec[home]) rec[home]={w:0,l:0,t:0,diff:0};
      if(ah>hh){ rec[away].w++; rec[home].l++; } else if(hh>ah){ rec[home].w++; rec[away].l++; } else { rec[away].t++; rec[home].t++; }
      rec[away].diff += (ah-hh); rec[home].diff += (hh-ah);
    });
    const byConf={}, byDiv={};
    Object.entries(teamsMap).forEach(([id,t])=>{
      const r=rec[id]||{w:0,l:0,t:0,diff:0};
      (byConf[t.conference] ||= []).push({team:id, ...r});
      (byDiv[`${t.conference}-${t.division}`] ||= []).push({team:id, ...r});
    });
    const sorter=(a,b)=> b.w-a.w || (b.diff||0)-(a.diff||0);
    Object.keys(byConf).forEach(k=>byConf[k].sort(sorter));
    Object.keys(byDiv).forEach(k=>byDiv[k].sort(sorter));
    return { byConf, byDiv };
  },[games,teamsMap]);

  return (
    <div className="container">
      <h1 className="text-2xl font-extrabold tracking-tight">NFL</h1>

      <section className="mt-4 grid md:grid-cols-2 gap-4">
        {["AFC","NFC"].map(conf=>(
          <div key={conf} className="card">
            <h2 className="font-semibold">{conf} · Standings</h2>
            <table className="table mt-3">
              <thead><tr><th>Equipo</th><th>W</th><th>L</th><th>T</th><th>Diff</th></tr></thead>
              <tbody>
                {(standings.byConf[conf]||[]).map(r=>(
                  <tr key={r.team}>
                    <td><TeamMini id={r.team}/></td>
                    <td>{r.w}</td><td>{r.l}</td><td>{r.t}</td><td>{r.diff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <section className="mt-4 card">
        <h2 className="font-semibold">Por División</h2>
        <div className="grid md:grid-cols-2 gap-3 mt-2">
          {Object.entries(standings.byDiv).map(([k,rows])=>{
            const [conf,div]=k.split("-");
            return (
              <div key={k}>
                <h3 className="text-sm font-semibold mb-1">{conf} - {div}</h3>
                <table className="table">
                  <thead><tr><th>Equipo</th><th>W</th><th>L</th><th>T</th><th>Diff</th></tr></thead>
                  <tbody>
                    {rows.map(r=>(
                      <tr key={r.team}>
                        <td><TeamMini id={r.team}/></td>
                        <td>{r.w}</td><td>{r.l}</td><td>{r.t}</td><td>{r.diff}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* ===== Noticias ===== */
function NewsHub() {
  const [team, setTeam] = useState("ALL");
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(false);

  const TEAMS = [
    "ALL","ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET",
    "GB","HOU","IND","JAX","KC","LV","LAC","LAR","MIA","MIN","NE","NO","NYG",
    "NYJ","PHI","PIT","SEA","SF","TB","TEN","WAS"
  ];

  const fetchNews = async()=>{
    setLoading(true);
    try{
      let url="https://site.api.espn.com/apis/site/v2/sports/football/nfl/news";
      if(team!=="ALL") url=`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.toLowerCase()}/news`;
      const r=await fetch(url,{mode:"cors"}); const j=await r.json().catch(()=>({}));
      const items=j?.articles||j?.feed||[]; setNews(items.slice(0,20));
    }catch{ setNews([]); } finally{ setLoading(false); }
  };
  useEffect(()=>{ fetchNews(); /* eslint-disable-next-line */ },[team]);

  return (
    <div className="container">
      <h1 className="text-2xl font-extrabold tracking-tight">Noticias</h1>
      <div className="mt-3 card">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted">Equipo</label>
          <select className="input" style={{width:140}} value={team} onChange={(e)=>setTeam(e.target.value)}>
            {TEAMS.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className="mt-4 grid md:grid-cols-2 gap-3">
        {loading && <div className="text-sm text-muted">Cargando…</div>}
        {!loading && news.map((n,i)=>(
          <a key={i} className="card" href={n.links?.web?.href||n.link} target="_blank" rel="noreferrer">
            <div className="flex gap-3">
              {n.images?.[0]?.url && <img src={n.images[0].url} alt="" style={{width:96,height:96,objectFit:"cover",borderRadius:12}}/>}
              <div>
                <h3 className="font-semibold">{n.headline||n.title}</h3>
                <p className="text-sm text-muted mt-1">{n.description||n.summary}</p>
                <p className="text-xs text-muted mt-1">{n.byline}</p>
              </div>
            </div>
          </a>
        ))}
        {!loading && news.length===0 && <div className="text-sm text-muted">No hay noticias.</div>}
      </div>
    </div>
  );
}

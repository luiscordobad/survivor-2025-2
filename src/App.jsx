// src/App.jsx
import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { supabase } from './lib/supabaseClient';
import Rules from './Rules';

const TZ = import.meta.env.VITE_TZ || 'America/Mexico_City';
const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || '')
  .split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
const isAdminEmail = (email) => ADMIN_EMAILS.includes((email||'').toLowerCase());

// CSV util
function downloadCSV(filename, rows) {
  const esc = v => v==null ? '' : `"${String(v).replaceAll('"','""')}"`;
  const csv = rows.map(r=>r.map(esc).join(',')).join('\n')+'\n';
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}

// ----- sesión -----
function useSession() {
  const [session, setSession] = useState(null);
  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>setSession(data.session));
    const {data:sub} = supabase.auth.onAuthStateChange((_e,s)=>setSession(s));
    return ()=>sub.subscription.unsubscribe();
  },[]);
  return session;
}

// ----- LOGIN -----
function Login() {
  const [tab, setTab] = useState('password'); // 'password' | 'magic' | 'reset'
  const [busy, setBusy] = useState(false);

  // magic
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  // password
  const [passEmail, setPassEmail] = useState('');
  const [passPwd, setPassPwd] = useState('');
  const [isSignup, setIsSignup] = useState(false);

  // reset
  const [resetEmail, setResetEmail] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [resetInfo, setResetInfo] = useState('');

  useEffect(()=>{ if ((window.location.hash||'').includes('type=recovery')) setTab('reset'); },[]);

  const sendMagic = async (e)=>{
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options:{ emailRedirectTo: import.meta.env.VITE_SITE_URL || window.location.origin }
    });
    if (!error) setSent(true); else alert(error.message);
  };

  const submitPasswordAuth = async (e)=>{
    e.preventDefault(); setBusy(true);
    try{
      if (isSignup) {
        const { error } = await supabase.auth.signUp({
          email: passEmail,
          password: passPwd,
          options:{ emailRedirectTo: import.meta.env.VITE_SITE_URL || window.location.origin }
        });
        if (error) throw error;
        alert('Cuenta creada. Revisa tu correo para confirmar.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: passEmail, password: passPwd });
        if (error) throw error;
      }
    }catch(err){ alert(err.message); } finally{ setBusy(false); }
  };

  const sendResetLink = async (e)=>{
    e.preventDefault(); setBusy(true);
    try{
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: import.meta.env.VITE_SITE_URL || window.location.origin
      });
      if (error) throw error;
      setResetInfo('Te enviamos un correo con el enlace de restablecimiento.');
    }catch(err){ alert(err.message); } finally{ setBusy(false); }
  };

  const applyNewPassword = async (e)=>{
    e.preventDefault(); if (!newPwd || newPwd.length<6) return alert('Mínimo 6 caracteres.');
    setBusy(true);
    try{
      const { error } = await supabase.auth.updateUser({ password: newPwd });
      if (error) throw error;
      setResetInfo('Contraseña actualizada. Ya puedes entrar.'); setTimeout(()=>setTab('password'),1200);
    }catch(err){ alert(err.message); } finally{ setBusy(false); }
  };

  const signInWithGoogle = async ()=>{
    try{
      await supabase.auth.signInWithOAuth({
        provider:'google',
        options:{ redirectTo: import.meta.env.VITE_SITE_URL || window.location.origin }
      });
    }catch(e){ alert(e.message); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <div className="max-w-md w-full space-y-4 p-6 rounded-2xl border bg-white shadow-sm">
        <h1 className="text-3xl font-extrabold tracking-tight text-center">
          {import.meta.env.VITE_LEAGUE_NAME || 'Survivor 2025'}
        </h1>

        <div className="flex gap-2 justify-center">
          <button className={`px-3 py-1 rounded border ${tab==='password'?'bg-black text-white':'hover:bg-gray-50'}`} onClick={()=>setTab('password')}>Email + Password</button>
          <button className={`px-3 py-1 rounded border ${tab==='magic'?'bg-black text-white':'hover:bg-gray-50'}`} onClick={()=>setTab('magic')}>Magic link</button>
          <button className={`px-3 py-1 rounded border ${tab==='reset'?'bg-black text-white':'hover:bg-gray-50'}`} onClick={()=>setTab('reset')}>Olvidé mi contraseña</button>
        </div>

        <div className="flex items-center gap-2">
          <div className="h-px bg-gray-200 flex-1" /><span className="text-xs text-gray-500">o</span><div className="h-px bg-gray-200 flex-1" />
        </div>
        <button onClick={signInWithGoogle} className="w-full border rounded-lg py-2 hover:bg-gray-50">Entrar con Google</button>

        {tab==='password' && (
          <form onSubmit={submitPasswordAuth} className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm">{isSignup?'Crear cuenta':'Iniciar sesión'}</label>
              <button type="button" className="text-xs underline" onClick={()=>setIsSignup(!isSignup)}>
                {isSignup?'¿Ya tienes cuenta? Inicia sesión':'¿No tienes cuenta? Regístrate'}
              </button>
            </div>
            <input type="email" className="border w-full p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/10" placeholder="email" value={passEmail} onChange={e=>setPassEmail(e.target.value)} required/>
            <input type="password" className="border w-full p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/10" placeholder="contraseña" value={passPwd} onChange={e=>setPassPwd(e.target.value)} required/>
            <button disabled={busy} className="bg-black text-white px-4 py-2 w-full rounded-lg hover:opacity-90 disabled:opacity-60">{isSignup?'Crear cuenta':'Entrar'}</button>
            <button type="button" className="text-xs underline" onClick={()=>setTab('reset')}>¿Olvidaste tu contraseña?</button>
          </form>
        )}

        {tab==='magic' && (
          <form onSubmit={sendMagic} className="space-y-3">
            <label className="text-sm block">Tu email</label>
            <input type="email" className="border w-full p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/10" placeholder="tu@email.com" value={email} onChange={e=>setEmail(e.target.value)} required/>
            <button className="bg-black text-white px-4 py-2 w-full rounded-lg hover:opacity-90">Enviar magic link</button>
            {sent && <p className="text-xs text-gray-600">Revisa tu correo y da clic al enlace.</p>}
          </form>
        )}

        {tab==='reset' && (
          <div className="space-y-4">
            {window.location.hash.includes('type=recovery') ? (
              <form onSubmit={applyNewPassword} className="space-y-3">
                <p className="text-sm text-gray-700">Define tu <b>nueva</b> contraseña:</p>
                <input type="password" className="border w-full p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/10" placeholder="nueva contraseña" value={newPwd} onChange={e=>setNewPwd(e.target.value)} required/>
                <button disabled={busy} className="bg-black text-white px-4 py-2 w-full rounded-lg hover:opacity-90 disabled:opacity-60">Guardar nueva contraseña</button>
                {resetInfo && <p className="text-xs text-emerald-700">{resetInfo}</p>}
              </form>
            ) : (
              <form onSubmit={sendResetLink} className="space-y-3">
                <p className="text-sm text-gray-700">Te enviaremos un enlace para restablecer tu contraseña.</p>
                <input type="email" className="border w-full p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/10" placeholder="tu email" value={resetEmail} onChange={e=>setResetEmail(e.target.value)} required/>
                <button disabled={busy} className="bg-black text-white px-4 py-2 w-full rounded-lg hover:opacity-90 disabled:opacity-60">Enviar enlace</button>
                {resetInfo && <p className="text-xs text-emerald-700">{resetInfo}</p>}
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ----- APP -----
export default function App() {
  const session = useSession();
  const [view, setView] = useState('game'); // 'game' | 'rules'
  if (!session) return <Login />;
  return (
    <div>
      <div className="w-full border-b bg-white/90 sticky top-0 z-50 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-2">
          <button className={`text-sm px-3 py-1 rounded ${view==='game'?'bg-black text-white':'hover:bg-gray-100'}`} onClick={()=>setView('game')}>Partidos</button>
          <button className={`text-sm px-3 py-1 rounded ${view==='rules'?'bg-black text-white':'hover:bg-gray-100'}`} onClick={()=>setView('rules')}>Reglas</button>
        </div>
      </div>
      {view==='game' ? <AppAuthed session={session}/> : <Rules/>}
    </div>
  );
}

function AppAuthed({ session }) {
  const [me, setMe] = useState(null);
  const [week, setWeek] = useState(()=>Number(localStorage.getItem('week'))||1);
  const [games, setGames] = useState([]);
  const [oddsByGame, setOddsByGame] = useState({});
  const [picks, setPicks] = useState([]);
  const [standings, setStandings] = useState([]);
  const [leaguePicks, setLeaguePicks] = useState([]);
  const [userNames, setUserNames] = useState({});
  const [popularity, setPopularity] = useState([]);
  const [popWeek, setPopWeek] = useState(week);
  const [usedTeams, setUsedTeams] = useState(new Set());

  // filtros
  const [dayFilter, setDayFilter] = useState(localStorage.getItem('dayFilter')||'ALL');
  const [teamQuery, setTeamQuery] = useState(localStorage.getItem('teamQuery')||'');

  // teams logos
  const [teamsMap, setTeamsMap] = useState({});
  const loadTeams = async ()=>{
    const { data: ts } = await supabase.from('teams').select('*');
    const map={}; (ts||[]).forEach(t=>{ map[t.id]=t; }); setTeamsMap(map);
  };
  const TeamBadge = ({ id })=>{
    const t=teamsMap[id]||{};
    return <span className="inline-flex items-center gap-2">{t.logo_url?<img src={t.logo_url} className="h-5 w-5 rounded-full" alt={id}/> : null}<span className="font-medium">{id}</span></span>;
  };

  // load
  const loadGames = async (w)=>{
    const { data: gs } = await supabase.from('games').select('*').eq('week',w).order('start_time');
    setGames(gs||[]);
  };
  const loadOdds = async ()=>{
    if (!games.length) { setOddsByGame({}); return; }
    const ids = games.map(g=>g.id);
    const { data } = await supabase.from('odds_latest').select('*').in('game_id', ids);
    const map={}; (data||[]).forEach(r=>{ map[r.game_id]=r; }); setOddsByGame(map);
  };
  const loadLeaguePicks = async (w)=>{
    const { data: pks } = await supabase.from('picks').select('user_id,team_id,result,auto_pick,updated_at').eq('week',w);
    setLeaguePicks(pks||[]);
    const ids=[...(new Set((pks||[]).map(x=>x.user_id)))];
    if (ids.length){
      const { data: profs } = await supabase.from('profiles').select('id,display_name').in('id',ids);
      const m={}; (profs||[]).forEach(p=>{ m[p.id]=p.display_name; }); setUserNames(m);
    } else setUserNames({});
    const { data: total } = await supabase.from('standings').select('user_id');
    const counts={}; (pks||[]).forEach(x=>{ if(x.team_id) counts[x.team_id]=(counts[x.team_id]||0)+1; });
    const list=Object.entries(counts).map(([team_id,count])=>({team_id,count,pct: total?.length?Math.round(count*100/total.length):0})).sort((a,b)=>b.count-a.count);
    setPopularity(list);
  };

  const init = async ()=>{
    const email=session.user.email;
    let { data: prof } = await supabase.from('profiles').select('*').eq('email',email).single();
    if (!prof){
      await supabase.from('profiles').insert({ id: session.user.id, email, display_name: email.split('@')[0] });
      const r = await supabase.from('profiles').select('*').eq('email',email).single(); prof=r.data;
    }
    setMe(prof);
    await loadTeams();
    const { data: pk } = await supabase.from('picks').select('*').eq('user_id',session.user.id);
    setPicks(pk||[]); setUsedTeams(new Set((pk||[]).map(x=>x.team_id)));
    const { data: st } = await supabase.from('standings').select('*'); setStandings(st||[]);
    await loadGames(week); await loadLeaguePicks(week);
  };

  useEffect(()=>{ init(); },[]);
  useEffect(()=>{ loadGames(week).then(loadOdds); loadLeaguePicks(week); setPopWeek(week); },[week]);
  useEffect(()=>{ const id=setInterval(()=>{ loadGames(week).then(loadOdds); loadLeaguePicks(week); },30000); return ()=>clearInterval(id); },[week]);

  useEffect(()=>localStorage.setItem('week',String(week)),[week]);
  useEffect(()=>localStorage.setItem('dayFilter',dayFilter),[dayFilter]);
  useEffect(()=>localStorage.setItem('teamQuery',teamQuery),[teamQuery]);

  const myPickThisWeek = useMemo(()=> (picks||[]).find(p=>p.week===week), [picks,week]);
  const nextKickoffISO = useMemo(()=>{
    const up = (games||[]).find(g=>DateTime.fromISO(g.start_time)>DateTime.now());
    return up?.start_time || null;
  },[games]);
  const showPickAlert = useMemo(()=>{
    if (myPickThisWeek || !nextKickoffISO) return false;
    const h = DateTime.fromISO(nextKickoffISO).diffNow('hours').hours;
    return h<=6 && h>0;
  },[myPickThisWeek,nextKickoffISO]);

  const canPick = (g,team)=>{
    const locked = DateTime.fromISO(g.start_time)<=DateTime.now();
    if (locked) return {ok:false, reason:'LOCK'};
    if (usedTeams.has(team) && !(myPickThisWeek && myPickThisWeek.team_id===team)) return {ok:false, reason:'USED'};
    return {ok:true};
  };
  const choose = async (g,team)=>{
    const c=canPick(g,team); if(!c.ok) return alert(c.reason==='LOCK'?'Cerrado por kickoff':'Ya usaste este equipo');
    if(!confirm(`¿Confirmas tu pick W${week} por ${team}?`)) return;
    if (myPickThisWeek){
      const { error } = await supabase.from('picks').update({ team_id:team, game_id:g.id, updated_at:new Date().toISOString() }).eq('id',myPickThisWeek.id);
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from('picks').insert({ user_id:session.user.id, game_id:g.id, team_id:team, week, season:2025 });
      if (error) return alert(error.message);
    }
    const { data: pk } = await supabase.from('picks').select('*').eq('user_id',session.user.id);
    setPicks(pk||[]); setUsedTeams(new Set((pk||[]).map(x=>x.team_id)));
  };

  const gamesByDay = useMemo(()=>{
    if (dayFilter==='ALL') return games;
    const map={THU:4,FRI:5,SAT:6,SUN:7,MON:1};
    const want=map[dayFilter]; return (games||[]).filter(g=>DateTime.fromISO(g.start_time).setZone(TZ).weekday===want);
  },[games,dayFilter]);
  const gamesFiltered = useMemo(()=>{
    const q=teamQuery.trim().toLowerCase(); if(!q) return gamesByDay;
    const match=(id)=>{ const t=teamsMap[id]; return id.toLowerCase().includes(q) || (t?.name||'').toLowerCase().includes(q); };
    return (gamesByDay||[]).filter(g=>match(g.away_team)||match(g.home_team));
  },[gamesByDay,teamQuery,teamsMap]);

  const chipDay = (iso)=>{
    const wd=DateTime.fromISO(iso).setZone(TZ).weekday;
    if (wd===4) return 'TNF'; if (wd===5) return 'Fri'; if (wd===6) return 'Sat';
    if (wd===7) return 'Sun'; if (wd===1) return 'MNF'; return '';
  };
  const chipVenue = (g)=>{
    const notes=(g.notes||'').toLowerCase(); const city=(g.venue_city||'').toLowerCase();
    if (notes.includes('thanksgiving')) return 'Thanksgiving';
    if (notes.includes('christmas')||notes.includes('navidad')) return 'Christmas';
    if (city.includes('london')) return 'London';
    if (city.includes('frankfurt')||city.includes('munich')) return 'Germany';
    if (g.neutral_site) return 'Neutral';
    return null;
  };

  const amAdmin = isAdminEmail(session.user.email);
  const callAdmin = async (path)=>{
    const base = import.meta.env.VITE_SITE_URL || window.location.origin;
    const url = `${base}${path}?token=${import.meta.env.VITE_ADMIN_TOKEN || 'DEV'}&week=${week}`;
    const r=await fetch(url); const j=await r.json(); alert(JSON.stringify(j,null,2));
  };

  return (
    <div className="min-h-screen p-4 md:p-6 bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between gap-4 py-3 sticky top-0 bg-gradient-to-b from-slate-50/95 to-white/95 backdrop-blur z-10">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">{import.meta.env.VITE_LEAGUE_NAME || 'Survivor 2025'}</h1>
            <p className="text-sm text-gray-600">Hola, <b>{me?.display_name}</b> · Vidas: <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">{me?.lives}</span></p>
          </div>
          <button className="text-sm underline hover:text-red-600" onClick={()=>supabase.auth.signOut()}>Salir</button>
        </header>

        {showPickAlert && (
          <div className="mt-2 mb-4 p-3 border rounded-xl bg-amber-50 text-amber-900">
            ⚠️ Aún no tienes pick en W{week}. El siguiente kickoff es en {nextKickoffISO && <Countdown iso={nextKickoffISO}/>}.
          </div>
        )}

        {/* Toolbar */}
        <section className="mt-4 grid gap-4">
          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <label className="text-xs text-gray-500">Semana</label>
                  <select className="border p-1 rounded-lg ml-2" value={week} onChange={e=>setWeek(Number(e.target.value))}>
                    {Array.from({length:18},(_,i)=>i+1).map(w=><option key={w} value={w}>W{w}</option>)}
                  </select>
                </div>
                <div className="hidden md:flex items-center gap-1 text-xs">
                  {['ALL','THU','FRI','SAT','SUN','MON'].map(d=>(
                    <button key={d} className={`px-2 py-1 rounded border ${dayFilter===d?'bg-black text-white':'hover:bg-gray-50'}`} onClick={()=>setDayFilter(d)}>{d}</button>
                  ))}
                </div>
              </div>

              <div className="flex-1 md:max-w-sm">
                <input className="border w-full p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/10" placeholder="Buscar equipo (abbr o nombre)..." value={teamQuery} onChange={e=>setTeamQuery(e.target.value)} />
              </div>

              <div className="flex items-center gap-2">
                <button className="text-xs px-3 py-1 rounded border hover:bg-gray-50"
                  onClick={()=>downloadCSV('mis_picks.csv', [['week','team_id','result','auto_pick','updated_at'], ...(picks||[]).map(p=>[p.week,p.team_id,p.result,p.auto_pick,p.updated_at])])}>
                  Exportar mis picks (CSV)
                </button>
                <button className="text-xs px-3 py-1 rounded border hover:bg-gray-50"
                  onClick={()=>downloadCSV('standings.csv', [['player','lives','wins','losses','pushes','margin_sum'], ...(standings||[]).map(s=>[s.display_name,s.lives,s.wins,s.losses,s.pushes,s.margin_sum])])}>
                  Exportar standings (CSV)
                </button>
                <button className="text-xs px-3 py-1 rounded border hover:bg-gray-50" onClick={()=>{ loadGames(week).then(loadOdds); loadLeaguePicks(week); }}>
                  Refrescar datos
                </button>
              </div>
            </div>

            {amAdmin && (
              <div className="p-3 mt-3 rounded-lg bg-gray-50 border text-sm flex flex-wrap items-center gap-2">
                <span className="font-medium mr-2">Admin:</span>
                <button className="px-3 py-1 rounded border hover:bg-gray-100" onClick={()=>callAdmin('/api/autopick')}>Auto-pick ahora (W{week})</button>
                <button className="px-3 py-1 rounded border hover:bg-gray-100" onClick={()=>callAdmin('/api/notifyReminders')}>Enviar recordatorios (≈3h)</button>
                <button className="px-3 py-1 rounded border hover:bg-gray-100" onClick={()=>callAdmin('/api/syncOdds')}>Sync odds ahora</button>
              </div>
            )}
          </div>
        </section>

        {/* Partidos */}
        <section className="mt-4 p-4 border rounded-2xl bg-white shadow-sm">
          <h2 className="font-semibold mb-3">Partidos W{week}</h2>
          <div className="space-y-3">
            {gamesFiltered.map(g=>{
              const local = DateTime.fromISO(g.start_time).setZone(TZ).toFormat('EEE dd LLL HH:mm');
              const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
              const chip = chipDay(g.start_time);
              const special = chipVenue(g);
              const odds = oddsByGame[g.id];
              return (
                <div key={g.id} className={`p-3 border rounded-xl ${locked?'opacity-60':'bg-white'} shadow-sm`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm flex items-center gap-2">
                        <TeamBadge id={g.away_team}/><span className="mx-1 text-gray-400">@</span><TeamBadge id={g.home_team}/>
                        {chip && <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800">{chip}</span>}
                        {special && <span className="text-[11px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-800">{special}</span>}
                        {locked && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">LOCK</span>}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">Kickoff: <span className="px-1.5 py-0.5 rounded bg-gray-100">{local}</span></div>
                      <div className="mt-1 text-xs text-gray-600">Lock en: <Countdown iso={g.start_time}/></div>

                      {/* Estado / marcador simple si está en progreso/final */}
                      <div className="mt-1 text-xs">
                        Estado:{' '}
                        <span className={
                          g.status==='in_progress' ? 'text-amber-700 font-medium' :
                          g.status==='final' ? 'text-emerald-700 font-medium' :
                          g.status==='postponed' ? 'text-gray-700 font-medium' : 'text-gray-700'
                        }>{g.status}</span>
                      </div>
                      {(g.status==='in_progress'||g.status==='final') && (
                        <div className="mt-1 text-sm font-mono">{g.away_team} {g.away_score??'-'} — {g.home_team} {g.home_score??'-'}</div>
                      )}
                      {g.status==='in_progress' && (<div className="mt-1 text-xs text-amber-800">{g.period?`Q${g.period}`:''} {g.clock||''}</div>)}

                      {/* ODDs */}
                      {odds && (
                        <div className="mt-2 text-xs">
                          <div className="inline-flex items-center gap-2 px-2 py-1 rounded bg-gray-50 border">
                            <span className="text-gray-600">Odds:</span>
                            <span className="font-mono">ML {g.home_team}: {odds.ml_home ?? '-'}</span>
                            <span className="font-mono">ML {g.away_team}: {odds.ml_away ?? '-'}</span>
                            <span className="font-mono">Spread {g.home_team}: {odds.spread_home ?? '-'}</span>
                            <span className="font-mono">Total: {odds.total ?? '-'}</span>
                            <span className="text-[11px] text-gray-500">({odds.book})</span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <button className="border px-3 py-1 rounded hover:bg-gray-100 disabled:opacity-40"
                        disabled={!canPick(g,g.away_team).ok} onClick={()=>choose(g,g.away_team)}
                        title={!canPick(g,g.away_team).ok ? (usedTeams.has(g.away_team)?'Equipo ya usado':'Bloqueado por kickoff') : 'Elegir visitante'}>
                        <TeamBadge id={g.away_team}/>
                      </button>
                      <button className="border px-3 py-1 rounded hover:bg-gray-100 disabled:opacity-40"
                        disabled={!canPick(g,g.home_team).ok} onClick={()=>choose(g,g.home_team)}
                        title={!canPick(g,g.home_team).ok ? (usedTeams.has(g.home_team)?'Equipo ya usado':'Bloqueado por kickoff') : 'Elegir local'}>
                        <TeamBadge id={g.home_team}/>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {(!gamesFiltered || gamesFiltered.length===0) && <div className="text-sm text-gray-500">No hay partidos para este filtro o búsqueda.</div>}
          </div>
        </section>

        {/* Liga: picks + popularidad */}
        <section className="mt-6 grid md:grid-cols-2 gap-4">
          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <h2 className="font-semibold">Picks de la liga (W{week})</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm mt-3">
                <thead><tr className="text-left text-gray-500"><th>Jugador</th><th>Equipo</th><th>Resultado</th><th>Auto</th><th>Actualizado</th></tr></thead>
                <tbody>
                  {(leaguePicks||[]).length>0 ? leaguePicks
                    .slice()
                    .sort((a,b)=>(userNames[a.user_id]||'').localeCompare(userNames[b.user_id]||''))
                    .map((p,idx)=>(
                      <tr key={idx} className="border-t">
                        <td className="py-1.5">{userNames[p.user_id] || p.user_id.slice(0,6)}</td>
                        <td><TeamBadge id={p.team_id}/></td>
                        <td><span className={
                          p.result==='win'?'text-emerald-700 font-semibold':
                          p.result==='loss'?'text-red-600 font-semibold':
                          p.result==='push'?'text-gray-600':'text-gray-500'
                        }>{p.result || '-'}</span></td>
                        <td>{p.auto_pick?'Sí':'No'}</td>
                        <td className="text-xs text-gray-500">{p.updated_at?DateTime.fromISO(p.updated_at).setZone(TZ).toFormat('dd LLL HH:mm'):'-'}</td>
                      </tr>
                    )) : <tr><td className="py-2 text-gray-500" colSpan={5}>Aún no hay picks esta semana.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Popularidad de equipos</h2>
              <select className="border p-1 rounded" value={popWeek} onChange={e=>{ const w=Number(e.target.value); setPopWeek(w); loadLeaguePicks(w); }}>
                {Array.from({length:18},(_,i)=>i+1).map(w=><option key={w} value={w}>W{w}</option>)}
              </select>
            </div>
            <p className="text-xs text-gray-600">Porcentaje de jugadores que pickearon ese equipo.</p>
            <div className="mt-3 space-y-2">
              {(popularity||[]).length>0 ? popularity.map(row=>(
                <div key={row.team_id}>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2"><TeamBadge id={row.team_id}/><span className="text-gray-500">({row.count})</span></div>
                    <span className="text-gray-700">{row.pct}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded mt-1"><div className="h-2 rounded bg-black" style={{width:`${row.pct}%`}}/></div>
                </div>
              )) : <div className="text-sm text-gray-500">No hay picks registrados esta semana.</div>}
            </div>
          </div>
        </section>

        {/* Standings + Historial */}
        <section className="mt-6 grid md:grid-cols-2 gap-4">
          <div className="p-4 border rounded-2xl bg-white shadow-sm">
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
                  {(!standings || standings.length===0) && <tr><td className="py-2 text-gray-500" colSpan={6}>Aún no hay standings.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <h2 className="font-semibold">Historial de tus picks</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm mt-3">
                <thead><tr className="text-left text-gray-500"><th>W</th><th>Equipo</th><th>Resultado</th></tr></thead>
                <tbody>
                  {(picks||[]).sort((a,b)=>a.week-b.week).map(p=>(
                    <tr key={p.id} className="border-t">
                      <td className="py-1.5">{p.week}</td>
                      <td><TeamBadge id={p.team_id}/></td>
                      <td><span className={
                        p.result==='win'?'text-emerald-700 font-semibold':
                        p.result==='loss'?'text-red-600 font-semibold':
                        p.result==='push'?'text-gray-600':'text-gray-500'
                      }>{p.result}</span></td>
                    </tr>
                  ))}
                  {(!picks || picks.length===0) && <tr><td className="py-2 text-gray-500" colSpan={3}>Aún no has hecho picks.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Countdown({ iso }) {
  const [left, setLeft] = useState('');
  useEffect(()=>{
    const id=setInterval(()=>{
      const t=DateTime.fromISO(iso).setZone(TZ).diffNow(['days','hours','minutes','seconds']).toObject();
      const d=Math.max(0,Math.floor(t.days||0));
      const h=Math.max(0,Math.floor(t.hours||0));
      const m=Math.max(0,Math.floor(t.minutes||0));
      const s=Math.max(0,Math.floor(t.seconds||0));
      setLeft(`${d}d ${h}h ${m}m ${s}s`);
    },1000); return ()=>clearInterval(id);
  },[iso]); return <span>{left}</span>;
}




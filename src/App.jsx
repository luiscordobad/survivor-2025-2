// src/App.jsx
import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { supabase } from './lib/supabaseClient';
import Rules from './Rules';

const TZ = import.meta.env.VITE_TZ || 'America/Mexico_City';

// -------------------- UTILIDADES --------------------
function Countdown({ iso }) {
  const [left, setLeft] = useState('');
  useEffect(() => {
    const id = setInterval(() => {
      const t = DateTime.fromISO(iso).setZone(TZ).diffNow(['days','hours','minutes','seconds']).toObject();
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
  const esc = v => v==null ? '' : `"${String(v).replaceAll('"','""')}"`;
  const csv = rows.map(r=>r.map(esc).join(',')).join('\n')+'\n';
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}

// -------------------- SESIÓN --------------------
function useSession() {
  const [session, setSession] = useState(null);
  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>setSession(data.session));
    const {data:sub} = supabase.auth.onAuthStateChange((_e,s)=>setSession(s));
    return ()=>sub.subscription.unsubscribe();
  },[]);
  return session;
}

// -------------------- LOGIN (Magic, Password, Reset, Google) --------------------
function Login() {
  const [tab, setTab] = useState('password'); // 'password' | 'magic' | 'reset'
  const [busy, setBusy] = useState(false);

  // Magic link
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  // Password
  const [passEmail, setPassEmail] = useState('');
  const [passPwd, setPassPwd] = useState('');
  const [isSignup, setIsSignup] = useState(false);

  // Reset
  const [resetEmail, setResetEmail] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [resetInfo, setResetInfo] = useState('');

  useEffect(()=>{
    if ((window.location.hash||'').includes('type=recovery')) setTab('reset');
  },[]);

  const sendMagic = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options:{ emailRedirectTo: import.meta.env.VITE_SITE_URL || window.location.origin }
    });
    if (!error) setSent(true); else alert(error.message);
  };

  const submitPasswordAuth = async (e) => {
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
    } catch(e){ alert(e.message); } finally { setBusy(false); }
  };

  const sendResetLink = async (e) => {
    e.preventDefault(); setBusy(true);
    try{
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: import.meta.env.VITE_SITE_URL || window.location.origin
      });
      if (error) throw error; setResetInfo('Enlace enviado, revisa tu correo.');
    } catch(e){ alert(e.message); } finally { setBusy(false); }
  };

  const applyNewPassword = async (e) => {
    e.preventDefault(); if (!newPwd || newPwd.length<6) return alert('Mínimo 6 caracteres.');
    setBusy(true);
    try{
      const { error } = await supabase.auth.updateUser({ password: newPwd });
      if (error) throw error; setResetInfo('Contraseña actualizada.');
      setTimeout(()=>setTab('password'), 1200);
    } catch(e){ alert(e.message); } finally { setBusy(false); }
  };

  const signInWithGoogle = async ()=>{
    await supabase.auth.signInWithOAuth({
      provider:'google',
      options:{ redirectTo: import.meta.env.VITE_SITE_URL || window.location.origin }
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-slate-50 to-white">
      <div className="w-full max-w-md space-y-4 p-6 border rounded-2xl bg-white shadow-sm">
        <h1 className="text-3xl font-extrabold tracking-tight text-center">{import.meta.env.VITE_LEAGUE_NAME || 'Survivor 2025'}</h1>

        <div className="flex gap-2 justify-center">
          <button className={`px-3 py-1 rounded border ${tab==='password'?'bg-black text-white':'hover:bg-gray-50'}`} onClick={()=>setTab('password')}>Email + Password</button>
          <button className={`px-3 py-1 rounded border ${tab==='magic'?'bg-black text-white':'hover:bg-gray-50'}`} onClick={()=>setTab('magic')}>Magic link</button>
          <button className={`px-3 py-1 rounded border ${tab==='reset'?'bg-black text-white':'hover:bg-gray-50'}`} onClick={()=>setTab('reset')}>Olvidé mi contraseña</button>
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
            <input type="email" className="border w-full p-2 rounded-lg" placeholder="email" value={passEmail} onChange={e=>setPassEmail(e.target.value)} required/>
            <input type="password" className="border w-full p-2 rounded-lg" placeholder="contraseña" value={passPwd} onChange={e=>setPassPwd(e.target.value)} required/>
            <button disabled={busy} className="bg-black text-white px-4 py-2 w-full rounded-lg disabled:opacity-60">{isSignup?'Crear cuenta':'Entrar'}</button>
          </form>
        )}

        {tab==='magic' && (
          <form onSubmit={sendMagic} className="space-y-3">
            <input type="email" className="border w-full p-2 rounded-lg" placeholder="tu@email.com" value={email} onChange={e=>setEmail(e.target.value)} required/>
            <button className="bg-black text-white px-4 py-2 w-full rounded-lg">Enviar magic link</button>
            {sent && <p className="text-xs text-gray-600">Revisa tu correo.</p>}
          </form>
        )}

        {tab==='reset' && (window.location.hash.includes('type=recovery')
          ? (<form onSubmit={applyNewPassword} className="space-y-3">
              <input type="password" className="border w-full p-2 rounded-lg" placeholder="nueva contraseña" value={newPwd} onChange={e=>setNewPwd(e.target.value)} required/>
              <button disabled={busy} className="bg-black text-white px-4 py-2 w-full rounded-lg disabled:opacity-60">Guardar</button>
              {resetInfo && <p className="text-xs text-emerald-700">{resetInfo}</p>}
            </form>)
          : (<form onSubmit={sendResetLink} className="space-y-3">
              <input type="email" className="border w-full p-2 rounded-lg" placeholder="tu email" value={resetEmail} onChange={e=>setResetEmail(e.target.value)} required/>
              <button disabled={busy} className="bg-black text-white px-4 py-2 w-full rounded-lg disabled:opacity-60">Enviar enlace</button>
              {resetInfo && <p className="text-xs text-emerald-700">{resetInfo}</p>}
            </form>)
        )}
      </div>
    </div>
  );
}

// -------------------- APP --------------------
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

// -------------------- AUTENTICADO --------------------
function AppAuthed({ session }) {
  const [me, setMe] = useState(null);
  const [week, setWeek] = useState(()=>Number(localStorage.getItem('week'))||1);

  const [games, setGames] = useState([]);
  const [oddsPairs, setOddsPairs] = useState({});
  const [picks, setPicks] = useState([]);
  const [standings, setStandings] = useState([]);

  const [leaguePicks, setLeaguePicks] = useState([]);
  const [userNames, setUserNames] = useState({});
  const [popularity, setPopularity] = useState([]);

  // --- TEAMS MAP (para logos) ---
  const [teamsMap, setTeamsMap] = useState({});
  const loadTeams = async ()=>{
    const { data: ts } = await supabase.from('teams').select('*');
    const map={}; (ts||[]).forEach(t=>{ map[t.id]=t; }); setTeamsMap(map);
  };

  const TeamMini = ({ id })=>{
    const t=teamsMap[id] || {};
    const src = t.logo_url || `/teams/${id}.png`; // fallback a /public/teams/ABR.png
    return (
      <span className="inline-flex items-center gap-1">
        <img src={src} alt={id} className="h-5 w-5 rounded-full object-contain"/>
        <span className="font-mono font-semibold">{id}</span>
      </span>
    );
  };
  const TeamChip = ({ id })=>{
    const t=teamsMap[id] || {};
    const src = t.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-2">
        <img src={src} alt={id} className="h-6 w-6 rounded-full object-contain"/>
        <span className="font-medium">{t.name || id}</span>
      </span>
    );
  };

  const loadGames = async (w)=>{
    const { data: gs } = await supabase.from('games').select('*').eq('week',w).order('start_time');
    setGames(gs||[]);
    const ids = (gs||[]).map(g=>g.id);
    if (ids.length){
      const { data } = await supabase
        .from('odds')
        .select('game_id, spread_home, spread_away, ml_home, ml_away, fetched_at')
        .in('game_id', ids)
        .order('fetched_at', { ascending:false });
      const by={};
      for (const row of (data||[])) {
        if (!by[row.game_id]) by[row.game_id] = { last: row, prev: null };
        else if (!by[row.game_id].prev) by[row.game_id].prev = row;
      }
      setOddsPairs(by);
    } else setOddsPairs({});
  };

  const loadLeaguePicks = async (w)=>{
    const { data: pks } = await supabase.from('picks').select('id,user_id,team_id,result,auto_pick,updated_at,week').eq('week',w);
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
    setPicks(pk||[]);
    const { data: st } = await supabase.from('standings').select('*'); setStandings(st||[]);
    await loadGames(week); await loadLeaguePicks(week);
  };

  useEffect(()=>{ init(); },[]);
  useEffect(()=>{ loadGames(week); loadLeaguePicks(week); },[week]);

  const myPickThisWeek = useMemo(()=> (picks||[]).find(p=>p.week===week), [picks,week]);

  const canPick = (g,team)=>{
    const locked = DateTime.fromISO(g.start_time)<=DateTime.now();
    if (locked) return {ok:false, reason:'LOCK'};
    const used = (picks||[]).some(p=>p.team_id===team && p.user_id===session.user.id);
    if (used && !(myPickThisWeek && myPickThisWeek.team_id===team)) return {ok:false, reason:'USED'};
    return {ok:true};
  };
  const upsertPick = async (g,team)=>{
    const c=canPick(g,team); if(!c.ok) return alert(c.reason==='LOCK'?'Cerrado por kickoff':'Ya usaste este equipo');
    if (myPickThisWeek) {
      const { error } = await supabase.from('picks').update({ team_id: team, game_id: g.id, updated_at: new Date().toISOString() }).eq('id', myPickThisWeek.id);
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from('picks').insert({ user_id: session.user.id, game_id: g.id, team_id: team, week, season: 2025 });
      if (error) return alert(error.message);
    }
    const { data: pk } = await supabase.from('picks').select('*').eq('user_id', session.user.id);
    setPicks(pk||[]);
  };

  const popPct = (teamId)=> popularity.find(p=>p.team_id===teamId)?.pct ?? 0;
  const chipDay = (iso)=>{
    const wd=DateTime.fromISO(iso).setZone(TZ).weekday;
    if (wd===4) return 'TNF'; if (wd===5) return 'Fri'; if (wd===6) return 'Sat';
    if (wd===7) return 'Sun'; if (wd===1) return 'MNF'; return '';
  };

  const TeamBox = ({ game, teamId })=>{
    const disabled = !canPick(game, teamId).ok;
    const selected = myPickThisWeek?.game_id===game.id && myPickThisWeek?.team_id===teamId;
    const pct = popPct(teamId);
    // favorito simple por spread/ml
    const { last } = oddsPairs[game.id] || {};
    const fav = last && (
      (teamId===game.home_team && ((last.spread_home ?? 0) < (last.spread_away ?? 0) || (last.ml_home ?? 9999) < (last.ml_away ?? 9999))) ||
      (teamId===game.away_team && ((last.spread_away ?? 0) < (last.spread_home ?? 0) || (last.ml_away ?? 9999) < (last.ml_home ?? 9999)))
    );

    return (
      <button
        onClick={()=>upsertPick(game, teamId)}
        disabled={disabled}
        className={[
          "w-full text-left rounded-2xl border transition",
          "px-4 py-3",
          selected ? "border-emerald-500 ring-2 ring-emerald-200 bg-emerald-50" : "border-gray-200 hover:bg-gray-50",
          disabled ? "opacity-50 cursor-not-allowed" : ""
        ].join(" ")}
      >
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

  const GameHeader = ({ g })=>{
    const local = DateTime.fromISO(g.start_time).setZone(TZ).toFormat('EEE dd LLL HH:mm');
    const chip = chipDay(g.start_time);
    return (
      <div>
        <div className="text-sm flex items-center gap-2 flex-wrap">
          <TeamChip id={g.away_team} />
          <span className="mx-1 text-gray-400">@</span>
          <TeamChip id={g.home_team} />
          {chip && <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800">{chip}</span>}
        </div>
        <div className="mt-1 text-xs text-gray-600">
          Kickoff: <span className="px-1.5 py-0.5 rounded bg-gray-100">{local}</span> · Lock en: <Countdown iso={g.start_time}/>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen p-4 md:p-6 bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between gap-4 py-3">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">{import.meta.env.VITE_LEAGUE_NAME || '2025'}</h1>
            <p className="text-sm text-gray-700">Hola, <b>{me?.display_name}</b> · Vidas: <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">{me?.lives}</span></p>
          </div>
          <button className="text-sm underline hover:text-red-600" onClick={()=>supabase.auth.signOut()}>Salir</button>
        </header>

        {/* Toolbar */}
        <section className="mt-4 grid gap-4">
          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <label className="text-xs text-gray-500 mr-2">Semana</label>
                <select className="border p-1 rounded-lg" value={week} onChange={e=>{ const w=Number(e.target.value); setWeek(w); localStorage.setItem('week', String(w)); }}>
                  {Array.from({length:18},(_,i)=>i+1).map(w=><option key={w} value={w}>W{w}</option>)}
                </select>
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
              </div>
            </div>
          </div>
        </section>

        {/* Partidos */}
        <section className="mt-4 p-4 border rounded-2xl bg-white shadow-sm">
          <h2 className="font-semibold mb-3">Partidos W{week}</h2>
          <div className="space-y-3">
            {games.map(g=>{
              const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
              return (
                <div key={g.id} className={`p-4 border rounded-xl ${locked? 'opacity-60':''} shadow-sm`}>
                  <GameHeader g={g}/>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <TeamBox game={g} teamId={g.home_team}/>
                    <TeamBox game={g} teamId={g.away_team}/>
                  </div>
                  <div className="mt-2 text-xs">
                    Estado:{' '}
                    <span className={
                      g.status==='in_progress' ? 'text-amber-700 font-medium' :
                      g.status==='final' ? 'text-emerald-700 font-medium' :
                      g.status==='postponed' ? 'text-gray-700 font-medium' : 'text-gray-700'
                    }>{g.status}</span>
                  </div>
                </div>
              );
            })}
            {(!games || games.length===0) && <div className="text-sm text-gray-500">No hay partidos para esta semana.</div>}
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
                        <td><TeamMini id={p.team_id}/></td>
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
            <h2 className="font-semibold">Popularidad de equipos</h2>
            <p className="text-xs text-gray-600">Porcentaje de jugadores que pickearon ese equipo.</p>
            <div className="mt-3 space-y-2">
              {(popularity||[]).length>0 ? popularity.map(row=>(
                <div key={row.team_id}>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2"><TeamMini id={row.team_id}/> <span className="text-gray-500">({row.count})</span></div>
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
                <thead>
                  <tr className="text-left text-gray-500">
                    <th>Jugador</th><th>Vidas</th><th>W</th><th>L</th><th>Push</th><th>Margen</th>
                  </tr>
                </thead>
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
                      <td><TeamMini id={p.team_id}/></td>
                      <td><span className={
                        p.result==='win'?'text-emerald-700 font-semibold':
                        p.result==='loss'?'text-red-600 font-semibold':
                        p.result==='push'?'text-gray-600':'text-gray-500'
                      }>{p.result || 'pending'}</span></td>
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








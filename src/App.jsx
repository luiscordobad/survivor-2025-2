// src/App.jsx
import { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabaseClient';
import { ensureLeagueMembership } from './lib/league';
import { DateTime } from 'luxon';

const TZ = import.meta.env.VITE_TZ || 'America/Mexico_City';

// Utilidad simple para exportar CSV
function downloadCSV(filename, rows) {
  const esc = (v) => (v == null ? '' : `"${String(v).replaceAll('"', '""')}"`);
  const csv = rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
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

/** ---------------- Login + Password/Google/Reset ---------------- */
function Login() {
  const [tab, setTab] = useState('magic'); // 'magic' | 'password' | 'reset'
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  // Password auth
  const [passEmail, setPassEmail] = useState('');
  const [passPwd, setPassPwd] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset
  const [resetEmail, setResetEmail] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [resetInfo, setResetInfo] = useState('');

  useEffect(() => {
    const hash = window.location.hash || '';
    if (hash.includes('type=recovery')) setTab('reset');
  }, []);

  const sendMagic = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: import.meta.env.VITE_SITE_URL || window.location.origin }
    });
    if (!error) setSent(true); else alert(error.message);
  };

  const submitPasswordAuth = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({
          email: passEmail,
          password: passPwd,
          options: { emailRedirectTo: import.meta.env.VITE_SITE_URL || window.location.origin }
        });
        if (error) throw error;
        alert('Cuenta creada. Revisa tu correo para confirmar.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: passEmail, password: passPwd });
        if (error) throw error;
      }
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  };

  const sendResetLink = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: (import.meta.env.VITE_SITE_URL || window.location.origin)
      });
      if (error) throw error;
      setResetInfo('Te enviamos un correo con el enlace para restablecer tu contraseña.');
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  };

  const applyNewPassword = async (e) => {
    e.preventDefault();
    if (!newPwd || newPwd.length < 6) return alert('Pon una contraseña de al menos 6 caracteres.');
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPwd });
      if (error) throw error;
      setResetInfo('Tu contraseña se actualizó. Ya puedes entrar con email y contraseña.');
      setTimeout(() => { setTab('password'); }, 1200);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  };

  const signInWithGoogle = async () => {
    try {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: import.meta.env.VITE_SITE_URL || window.location.origin }
      });
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <div className="max-w-md w-full space-y-4 p-6 rounded-2xl border bg-white shadow-sm">
        <h1 className="text-3xl font-extrabold tracking-tight text-center">Survivor 2025</h1>

        <div className="flex gap-2 justify-center">
          <button className={`px-3 py-1 rounded border ${tab==='magic'?'bg-black text-white':'hover:bg-gray-50'}`} onClick={() => setTab('magic')}>Magic link</button>
          <button className={`px-3 py-1 rounded border ${tab==='password'?'bg-black text-white':'hover:bg-gray-50'}`} onClick={() => setTab('password')}>Email + Password</button>
          <button className={`px-3 py-1 rounded border ${tab==='reset'?'bg-black text-white':'hover:bg-gray-50'}`} onClick={() => setTab('reset')}>Olvidé mi contraseña</button>
        </div>

        <div className="flex items-center gap-2">
          <div className="h-px bg-gray-200 flex-1" />
          <span className="text-xs text-gray-500">o</span>
          <div className="h-px bg-gray-200 flex-1" />
        </div>
        <button
          type="button"
          onClick={signInWithGoogle}
          className="w-full border rounded-lg py-2 hover:bg-gray-50 flex items-center justify-center gap-2"
          title="Entrar con Google"
        >
          <span className="font-medium">Entrar con Google</span>
        </button>

        {tab === 'magic' && (
          <form onSubmit={sendMagic} className="space-y-3">
            <label className="text-sm block">Tu email</label>
            <input type="email" className="border w-full p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/10"
              placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <button className="bg-black text-white px-4 py-2 w-full rounded-lg hover:opacity-90">Enviar magic link</button>
            {sent && <p className="text-xs text-gray-600">Revisa tu correo y da clic al enlace de acceso.</p>}
          </form>
        )}

        {tab === 'password' && (
          <form onSubmit={submitPasswordAuth} className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm">{isSignup ? 'Crear cuenta' : 'Iniciar sesión'}</label>
              <button type="button" className="text-xs underline" onClick={() => setIsSignup(!isSignup)}>
                {isSignup ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}
              </button>
            </div>
            <input type="email" className="border w-full p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/10"
              placeholder="email" value={passEmail} onChange={(e) => setPassEmail(e.target.value)} required />
            <input type="password" className="border w-full p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/10"
              placeholder="contraseña" value={passPwd} onChange={(e) => setPassPwd(e.target.value)} required />
            <button disabled={busy} className="bg-black text-white px-4 py-2 w-full rounded-lg hover:opacity-90 disabled:opacity-60">
              {isSignup ? 'Crear cuenta' : 'Entrar'}
            </button>
            <button type="button" className="text-xs underline" onClick={() => setTab('reset')}>¿Olvidaste tu contraseña?</button>
          </form>
        )}

        {tab === 'reset' && (
          <div className="space-y-4">
            {window.location.hash.includes('type=recovery') ? (
              <form onSubmit={applyNewPassword} className="space-y-3">
                <p className="text-sm text-gray-700">Define tu <b>nueva</b> contraseña:</p>
                <input type="password" className="border w-full p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/10"
                  placeholder="nueva contraseña" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} required />
                <button disabled={busy} className="bg-black text-white px-4 py-2 w-full rounded-lg hover:opacity-90 disabled:opacity-60">
                  Guardar nueva contraseña
                </button>
                {resetInfo && <p className="text-xs text-emerald-700">{resetInfo}</p>}
              </form>
            ) : (
              <form onSubmit={sendResetLink} className="space-y-3">
                <p className="text-sm text-gray-700">Te enviaremos un correo con un enlace para restablecer tu contraseña.</p>
                <input type="email" className="border w-full p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/10"
                  placeholder="tu email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} required />
                <button disabled={busy} className="bg-black text-white px-4 py-2 w-full rounded-lg hover:opacity-90 disabled:opacity-60">
                  Enviar enlace de restablecimiento
                </button>
                {resetInfo && <p className="text-xs text-emerald-700">{resetInfo}</p>}
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** ---------------- App autenticada ---------------- */
export default function App() {
  const session = useSession();
  if (!session) return <Login />;
  return <AppAuthed session={session} />;
}

function AppAuthed({ session }) {
  const [me, setMe] = useState(null);
  const [week, setWeek] = useState(() => Number(localStorage.getItem('week')) || 1);
  const [games, setGames] = useState([]);
  const [picks, setPicks] = useState([]);
  const [standings, setStandings] = useState([]);
  const [usedTeams, setUsedTeams] = useState(new Set());

  // FILTROS: día y búsqueda por equipo (persistentes)
  const [dayFilter, setDayFilter] = useState(localStorage.getItem('dayFilter') || 'ALL'); // ALL | THU | FRI | SAT | SUN | MON
  const [teamQuery, setTeamQuery] = useState(localStorage.getItem('teamQuery') || '');

  // Liga: picks de todos y popularidad por equipo (semana actual)
  const [leaguePicks, setLeaguePicks] = useState([]);        // [{user_id, team_id, result, auto_pick, updated_at}]
  const [userNames, setUserNames] = useState({});            // user_id -> display_name
  const [popularity, setPopularity] = useState([]);          // [{team_id, count, pct}]

  // Logos
  const [teamsMap, setTeamsMap] = useState({});
  const loadTeams = async () => {
    const { data: ts } = await supabase.from('teams').select('*');
    const map = {};
    (ts || []).forEach((t) => { map[t.id] = t; });
    setTeamsMap(map);
  };

  function TeamBadge({ id }) {
    const t = teamsMap[id] || {};
    return (
      <span className="inline-flex items-center gap-2">
        {t.logo_url ? (
          <img src={t.logo_url} alt={id} className="h-5 w-5 rounded-full" referrerPolicy="no-referrer" />
        ) : null}
        <span className="font-medium">{id}</span>
      </span>
    );
  }

  const loadGames = async (w) => {
    const { data: gs } = await supabase.from('games').select('*').eq('week', w).order('start_time');
    setGames(gs || []);
  };

  const loadLeaguePicks = async (w) => {
    // obtiene picks de la semana
    const { data: pks } = await supabase.from('picks')
      .select('user_id, team_id, result, auto_pick, updated_at')
      .eq('week', w);
    const arr = pks || [];
    setLeaguePicks(arr);

    // nombres de usuarios
    const ids = [...new Set(arr.map(x => x.user_id))];
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('id, display_name').in('id', ids);
      const map = {};
      (profs || []).forEach(p => { map[p.id] = p.display_name; });
      setUserNames(map);
    } else {
      setUserNames({});
    }

    // popularidad
    const counts = {};
    arr.forEach(x => {
      if (!x.team_id) return;
      counts[x.team_id] = (counts[x.team_id] || 0) + 1;
    });
    const totalPlayers = (await supabase.from('standings').select('user_id')).data?.length || 0;
    const list = Object.entries(counts).map(([team_id, count]) => ({
      team_id,
      count,
      pct: totalPlayers ? Math.round((count * 100) / totalPlayers) : 0
    })).sort((a, b) => b.count - a.count);
    setPopularity(list);
  };

  // Carga inicial + auto-membresía liga
  const load = async () => {
    const email = session.user.email;

    // Perfil (crear si no existe)
    let { data: prof } = await supabase.from('profiles').select('*').eq('email', email).single();
    if (!prof) {
      await supabase.from('profiles').insert({ id: session.user.id, email, display_name: email.split('@')[0] });
      const r = await supabase.from('profiles').select('*').eq('email', email).single();
      prof = r.data;
    }
    setMe(prof);

    try { await ensureLeagueMembership(session.user.id); } catch (e) { console.error(e); }

    await loadTeams();

    const { data: pk } = await supabase.from('picks').select('*').eq('user_id', session.user.id);
    setPicks(pk || []);
    setUsedTeams(new Set((pk || []).map((x) => x.team_id)));

    const { data: st } = await supabase.from('standings').select('*');
    setStandings(st || []);

    await loadGames(week);
    await loadLeaguePicks(week);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { loadGames(week); loadLeaguePicks(week); }, [week]);

  // Auto-refresh cada 30s (marcadores y picks de la semana)
  useEffect(() => {
    const id = setInterval(() => { loadGames(week); loadLeaguePicks(week); }, 30000);
    return () => clearInterval(id);
  }, [week]);

  // Persistencia de filtros
  useEffect(() => { localStorage.setItem('week', String(week)); }, [week]);
  useEffect(() => { localStorage.setItem('dayFilter', dayFilter); }, [dayFilter]);
  useEffect(() => { localStorage.setItem('teamQuery', teamQuery); }, [teamQuery]);

  // Extra: asegura membresía si cambia el estado de auth
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      if (s?.user) { try { await ensureLeagueMembership(s.user.id); } catch {} }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const myPickThisWeek = useMemo(() => (picks || []).find((p) => p.week === week), [picks, week]);

  const nextKickoffISO = useMemo(() => {
    const upcoming = (games || []).find(g => DateTime.fromISO(g.start_time) > DateTime.now());
    return upcoming?.start_time || null;
  }, [games]);

  const showPickAlert = useMemo(() => {
    if (myPickThisWeek || !nextKickoffISO) return false;
    const diff = DateTime.fromISO(nextKickoffISO).diffNow('hours').hours;
    return diff <= 6 && diff > 0;
  }, [myPickThisWeek, nextKickoffISO]);

  const canPick = (g, team) => {
    const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
    if (locked) return { ok: false, reason: 'LOCK' };
    if (usedTeams.has(team) && !(myPickThisWeek && myPickThisWeek.team_id === team))
      return { ok: false, reason: 'USED' };
    return { ok: true };
  };

  const choose = async (g, team) => {
    const c = canPick(g, team);
    if (!c.ok) return alert(c.reason === 'LOCK' ? 'Cerrado por kickoff' : 'Ya usaste este equipo');
    if (!confirm(`¿Confirmas tu pick de W${week} por ${team}?`)) return;

    if (myPickThisWeek) {
      const { error } = await supabase
        .from('picks')
        .update({ team_id: team, game_id: g.id, updated_at: new Date().toISOString() })
        .eq('id', myPickThisWeek.id);
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase
        .from('picks')
        .insert({ user_id: session.user.id, game_id: g.id, team_id: team, week, season: 2025 });
      if (error) return alert(error.message);
    }

    const { data: pk } = await supabase.from('picks').select('*').eq('user_id', session.user.id);
    setPicks(pk || []);
    setUsedTeams(new Set((pk || []).map((x) => x.team_id)));
  };

  // Filtro por día
  const gamesByDay = useMemo(() => {
    if (dayFilter === 'ALL') return games;
    const map = { THU: 4, FRI: 5, SAT: 6, SUN: 7, MON: 1 }; // 1=Mon ... 7=Sun
    const want = map[dayFilter];
    return (games || []).filter(g => DateTime.fromISO(g.start_time).setZone(TZ).weekday === want);
  }, [games, dayFilter]);

  // Filtro por equipo (abbr o nombre)
  const gamesFiltered = useMemo(() => {
    const q = teamQuery.trim().toLowerCase();
    if (!q) return gamesByDay;
    const match = (teamId) => {
      const t = teamsMap[teamId];
      return teamId.toLowerCase().includes(q) || (t?.name || '').toLowerCase().includes(q);
    };
    return (gamesByDay || []).filter(g => match(g.away_team) || match(g.home_team));
  }, [gamesByDay, teamQuery, teamsMap]);

  // Helpers UI
  const gameDayChip = (iso) => {
    const wd = DateTime.fromISO(iso).setZone(TZ).weekday; // 1 Mon ... 7 Sun
    if (wd === 4) return 'TNF';
    if (wd === 5) return 'Fri';
    if (wd === 6) return 'Sat';
    if (wd === 7) return 'Sun';
    if (wd === 1) return 'MNF';
    return '';
  };

  return (
    <div className="min-h-screen p-4 md:p-6 bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <header className="flex items-center justify-between gap-4 py-3 sticky top-0 bg-gradient-to-b from-slate-50/95 to-white/95 backdrop-blur z-10">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">
              {import.meta.env.VITE_LEAGUE_NAME || 'Survivor 2025'}
            </h1>
            <p className="text-sm text-gray-600">
              Hola, <b>{me?.display_name}</b> · Vidas:{' '}
              <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">{me?.lives}</span>
            </p>
          </div>
          <button className="text-sm underline hover:text-red-600" onClick={() => supabase.auth.signOut()}>
            Salir
          </button>
        </header>

        {/* Banner alerta pick */}
        {showPickAlert && (
          <div className="mt-2 mb-4 p-3 border rounded-xl bg-amber-50 text-amber-900">
            ⚠️ Aún no tienes pick en W{week}. El siguiente kickoff es en{' '}
            {nextKickoffISO && <Countdown iso={nextKickoffISO} />}.
          </div>
        )}

        {/* Toolbar */}
        <section className="mt-4 grid gap-4">
          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <label className="text-xs text-gray-500">Semana</label>
                  <select className="border p-1 rounded-lg ml-2" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
                    {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => <option key={w} value={w}>W{w}</option>)}
                  </select>
                </div>

                <div className="hidden md:flex items-center gap-1 text-xs">
                  {['ALL','THU','FRI','SAT','SUN','MON'].map(d => (
                    <button key={d} className={`px-2 py-1 rounded border ${dayFilter===d?'bg-black text-white':'hover:bg-gray-50'}`}
                      onClick={() => setDayFilter(d)} title={d==='ALL'?'Todos':'Filtrar por día'}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 md:max-w-sm">
                <input className="border w-full p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/10"
                  placeholder="Buscar equipo (abbr o nombre)..." value={teamQuery} onChange={(e) => setTeamQuery(e.target.value)} />
              </div>

              <div className="flex items-center gap-2">
                <button className="text-xs px-3 py-1 rounded border hover:bg-gray-50" onClick={() => downloadCSV('mis_picks.csv', [['week','team_id','result','auto_pick','updated_at'], ...(picks||[]).map(p=>[p.week,p.team_id,p.result,p.auto_pick,p.updated_at])])}>
                  Exportar mis picks (CSV)
                </button>
                <button className="text-xs px-3 py-1 rounded border hover:bg-gray-50" onClick={() => downloadCSV('standings.csv', [['player','lives','wins','losses','pushes','margin_sum'], ...(standings||[]).map(s=>[s.display_name,s.lives,s.wins,s.losses,s.pushes,s.margin_sum])])}>
                  Exportar standings (CSV)
                </button>
                <button className="text-xs px-3 py-1 rounded border hover:bg-gray-50" onClick={() => { loadGames(week); loadLeaguePicks(week); }}>
                  Refrescar datos
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Partidos */}
        <section className="mt-4 p-4 border rounded-2xl bg-white shadow-sm">
          <h2 className="font-semibold mb-3">Partidos W{week}</h2>
          <div className="space-y-3">
            {gamesFiltered.map((g) => {
              const local = DateTime.fromISO(g.start_time).setZone(TZ).toFormat('EEE dd LLL HH:mm');
              const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
              const chip = gameDayChip(g.start_time);

              return (
                <div key={g.id} className={`p-3 border rounded-xl ${locked ? 'opacity-60' : 'bg-white'} shadow-sm`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm flex items-center gap-2">
                        <TeamBadge id={g.away_team} />
                        <span className="mx-1 text-gray-400">@</span>
                        <TeamBadge id={g.home_team} />
                        {chip && <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800">{chip}</span>}
                        {locked && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">LOCK</span>}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">
                        Kickoff:{' '}<span className="px-1.5 py-0.5 rounded bg-gray-100">{local}</span>
                      </div>

                      <div className="mt-1 text-xs">
                        Estado:{' '}
                        <span className={
                          g.status === 'in_progress' ? 'text-amber-700 font-medium' :
                          g.status === 'final' ? 'text-emerald-700 font-medium' :
                          g.status === 'postponed' ? 'text-gray-700 font-medium' :
                          'text-gray-700'
                        }>
                          {g.status}
                        </span>
                      </div>

                      {(g.status === 'in_progress' || g.status === 'final') && (
                        <div className="mt-1 text-sm font-mono">
                          {g.away_team} {g.away_score ?? '-'} — {g.home_team} {g.home_score ?? '-'}
                        </div>
                      )}

                      {g.status === 'in_progress' && (
                        <div className="mt-1 text-xs text-amber-800">
                          {g.period ? `Q${g.period}` : ''} {g.clock || ''}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <button className="border px-3 py-1 rounded hover:bg-gray-100 disabled:opacity-40"
                        disabled={!canPick(g, g.away_team).ok}
                        onClick={() => choose(g, g.away_team)}
                        title={!canPick(g, g.away_team).ok ? (usedTeams.has(g.away_team) ? 'Equipo ya usado' : 'Bloqueado por kickoff') : 'Elegir visitante'}>
                        <span className="inline-flex items-center gap-2">
                          <TeamBadge id={g.away_team} />
                          {usedTeams.has(g.away_team) && !(myPickThisWeek && myPickThisWeek.team_id === g.away_team) && (
                            <span className="ml-1 text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">Used</span>
                          )}
                        </span>
                      </button>

                      <button className="border px-3 py-1 rounded hover:bg-gray-100 disabled:opacity-40"
                        disabled={!canPick(g, g.home_team).ok}
                        onClick={() => choose(g, g.home_team)}
                        title={!canPick(g, g.home_team).ok ? (usedTeams.has(g.home_team) ? 'Equipo ya usado' : 'Bloqueado por kickoff') : 'Elegir local'}>
                        <span className="inline-flex items-center gap-2">
                          <TeamBadge id={g.home_team} />
                          {usedTeams.has(g.home_team) && !(myPickThisWeek && myPickThisWeek.team_id === g.home_team) && (
                            <span className="ml-1 text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">Used</span>
                          )}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {(!gamesFiltered || gamesFiltered.length === 0) && (
              <div className="text-sm text-gray-500">No hay partidos para este filtro o búsqueda.</div>
            )}
          </div>
        </section>

        {/* Liga: Picks de todos + Popularidad */}
        <section className="mt-6 grid md:grid-cols-2 gap-4">
          {/* Picks de la liga */}
          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <h2 className="font-semibold">Picks de la liga (W{week})</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm mt-3">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th>Jugador</th>
                    <th>Equipo</th>
                    <th>Resultado</th>
                    <th>Auto</th>
                    <th>Actualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {(leaguePicks || []).length > 0 ? (
                    leaguePicks
                      .slice()
                      .sort((a, b) => (userNames[a.user_id] || '').localeCompare(userNames[b.user_id] || ''))
                      .map((p, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="py-1.5">{userNames[p.user_id] || p.user_id.slice(0, 6)}</td>
                          <td><TeamBadge id={p.team_id} /></td>
                          <td>
                            <span className={
                              p.result === 'win' ? 'text-emerald-700 font-semibold' :
                              p.result === 'loss' ? 'text-red-600 font-semibold' :
                              p.result === 'push' ? 'text-gray-600' : 'text-gray-500'
                            }>
                              {p.result || '-'}
                            </span>
                          </td>
                          <td>{p.auto_pick ? 'Sí' : 'No'}</td>
                          <td className="text-xs text-gray-500">{p.updated_at ? DateTime.fromISO(p.updated_at).setZone(TZ).toFormat('dd LLL HH:mm') : '-'}</td>
                        </tr>
                      ))
                  ) : (
                    <tr><td className="py-2 text-gray-500" colSpan={5}>Aún no hay picks esta semana.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Popularidad */}
          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <h2 className="font-semibold">Popularidad de equipos (W{week})</h2>
            <p className="text-xs text-gray-600">Porcentaje de jugadores que pickearon ese equipo esta semana.</p>
            <div className="mt-3 space-y-2">
              {(popularity || []).length > 0 ? (
                popularity.map((row) => (
                  <div key={row.team_id}>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <TeamBadge id={row.team_id} />
                        <span className="text-gray-500">({row.count})</span>
                      </div>
                      <span className="text-gray-700">{row.pct}%</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded mt-1">
                      <div className="h-2 rounded bg-black" style={{ width: `${row.pct}%` }} />
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-gray-500">No hay picks registrados esta semana.</div>
              )}
            </div>
          </div>
        </section>

        {/* Standings + Historial personal */}
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
                  {standings.map((s) => (
                    <tr key={s.user_id} className="border-t">
                      <td className="py-1.5">{s.display_name}</td>
                      <td>{s.lives}</td>
                      <td className="text-emerald-700 font-medium">{s.wins}</td>
                      <td className="text-red-600 font-medium">{s.losses}</td>
                      <td className="text-gray-600">{s.pushes}</td>
                      <td>{s.margin_sum}</td>
                    </tr>
                  ))}
                  {(!standings || standings.length === 0) && (
                    <tr><td className="py-2 text-gray-500" colSpan={6}>Aún no hay standings.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <h2 className="font-semibold">Historial de tus picks</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm mt-3">
                <thead>
                  <tr className="text-left text-gray-500"><th>W</th><th>Equipo</th><th>Resultado</th></tr>
                </thead>
                <tbody>
                  {(picks || []).sort((a, b) => a.week - b.week).map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="py-1.5">{p.week}</td>
                      <td><TeamBadge id={p.team_id} /></td>
                      <td>
                        <span className={
                          p.result === 'win' ? 'text-emerald-700 font-semibold' :
                          p.result === 'loss' ? 'text-red-600 font-semibold' :
                          p.result === 'push' ? 'text-gray-600' : 'text-gray-500'
                        }>
                          {p.result}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {(!picks || picks.length === 0) && (
                    <tr><td className="py-2 text-gray-500" colSpan={3}>Aún no has hecho picks.</td></tr>
                  )}
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



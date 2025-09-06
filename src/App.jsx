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

function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: import.meta.env.VITE_SITE_URL || window.location.origin }
    });
    if (!error) setSent(true);
    else alert(error.message);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <form onSubmit={send} className="max-w-sm w-full space-y-4 p-6 rounded-2xl border bg-white shadow-sm">
        <h1 className="text-3xl font-extrabold tracking-tight">Survivor 2025</h1>
        {sent ? (
          <p className="text-sm text-gray-600">Revisa tu correo y da clic al enlace de acceso.</p>
        ) : (
          <>
            <input
              type="email"
              className="border w-full p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/10"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button className="bg-black text-white px-4 py-2 w-full rounded-lg hover:opacity-90">
              Entrar
            </button>
          </>
        )}
      </form>
    </div>
  );
}

function Countdown({ iso }) {
  const [left, setLeft] = useState('');
  useEffect(() => {
    const id = setInterval(() => {
      const t = DateTime.fromISO(iso)
        .setZone(TZ)
        .diffNow(['days', 'hours', 'minutes', 'seconds'])
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

export default function App() {
  const session = useSession();
  if (!session) return <Login />;
  return <AppAuthed session={session} />;
}

function AppAuthed({ session }) {
  const [me, setMe] = useState(null);
  const [week, setWeek] = useState(1);
  const [games, setGames] = useState([]);
  const [picks, setPicks] = useState([]);
  const [standings, setStandings] = useState([]);
  const [usedTeams, setUsedTeams] = useState(new Set());

  // Filtro por día dentro de la semana
  const [dayFilter, setDayFilter] = useState('ALL'); // ALL | THU | FRI | SAT | SUN | MON

  // Logos: mapa id -> team
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
          <img
            src={t.logo_url}
            alt={id}
            className="h-5 w-5 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : null}
        <span className="font-medium">{id}</span>
      </span>
    );
  }

  const loadGames = async (w) => {
    const { data: gs } = await supabase
      .from('games')
      .select('*')
      .eq('week', w)
      .order('start_time');
    setGames(gs || []);
  };

  // Carga inicial + auto-membresía liga
  const load = async () => {
    const email = session.user.email;

    // Perfil (crear si no existe)
    let { data: prof } = await supabase.from('profiles').select('*').eq('email', email).single();
    if (!prof) {
      await supabase
        .from('profiles')
        .insert({ id: session.user.id, email, display_name: email.split('@')[0] });
      const r = await supabase.from('profiles').select('*').eq('email', email).single();
      prof = r.data;
    }
    setMe(prof);

    // Auto-membresía a la liga 2025
    try { await ensureLeagueMembership(session.user.id); } catch (e) { console.error(e); }

    // Logos de equipos
    await loadTeams();

    // Picks y standings
    const { data: pk } = await supabase.from('picks').select('*').eq('user_id', session.user.id);
    setPicks(pk || []);
    setUsedTeams(new Set((pk || []).map((x) => x.team_id)));

    const { data: st } = await supabase.from('standings').select('*');
    setStandings(st || []);

    await loadGames(week);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { loadGames(week); }, [week]);

  // (4) AUTO-ACTUALIZACIÓN: refresca partidos cada 30s
  useEffect(() => {
    const id = setInterval(() => { loadGames(week); }, 30000);
    return () => clearInterval(id);
  }, [week]);

  // Extra: asegura membresía si cambia el estado de auth
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      if (s?.user) { try { await ensureLeagueMembership(s.user.id); } catch {} }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const myPickThisWeek = useMemo(
    () => (picks || []).find((p) => p.week === week),
    [picks, week]
  );

  const nextKickoffISO = useMemo(() => {
    const upcoming = (games || []).find(g => DateTime.fromISO(g.start_time) > DateTime.now());
    return upcoming?.start_time || null;
  }, [games]);

  // Banner si no hay pick y falta poco (<= 6h)
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

    // Confirmación
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

  // Filtrado por día
  const gamesFiltered = useMemo(() => {
    if (dayFilter === 'ALL') return games;
    const map = { THU: 4, FRI: 5, SAT: 6, SUN: 7, MON: 1 }; // 1=Mon ... 7=Sun
    const want = map[dayFilter];
    return (games || []).filter(g => DateTime.fromISO(g.start_time).setZone(TZ).weekday === want);
  }, [games, dayFilter]);

  // Export CSV
  const exportMyPicksCSV = () => {
    const rows = [['week', 'team_id', 'result', 'auto_pick', 'updated_at']];
    (picks || []).forEach(p => rows.push([p.week, p.team_id, p.result, p.auto_pick, p.updated_at]));
    downloadCSV('mis_picks.csv', rows);
  };
  const exportStandingsCSV = () => {
    const rows = [['player', 'lives', 'wins', 'losses', 'pushes', 'margin_sum']];
    (standings || []).forEach(s => rows.push([s.display_name, s.lives, s.wins, s.losses, s.pushes, s.margin_sum]));
    downloadCSV('standings.csv', rows);
  };

  return (
    <div className="min-h-screen p-4 md:p-6 bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <header className="flex items-center justify-between gap-4 py-3">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">
              {import.meta.env.VITE_LEAGUE_NAME || 'Survivor 2025'}
            </h1>
            <p className="text-sm text-gray-600">
              Hola, <b>{me?.display_name}</b> · Vidas:{' '}
              <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                {me?.lives}
              </span>
            </p>
          </div>
          <button
            className="text-sm underline hover:text-red-600"
            onClick={() => supabase.auth.signOut()}
          >
            Salir
          </button>
        </header>

        {/* Banner de alerta si falta poco y no hay pick */}
        {showPickAlert && (
          <div className="mt-2 mb-4 p-3 border rounded-xl bg-amber-50 text-amber-900">
            ⚠️ Aún no tienes pick en W{week}. El siguiente kickoff es en{' '}
            {nextKickoffISO && <Countdown iso={nextKickoffISO} />}.
          </div>
        )}

        {/* Top widgets */}
        <section className="mt-4 grid md:grid-cols-3 gap-4">
          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Semana</h2>
              <select
                className="border p-1 rounded-lg"
                value={week}
                onChange={(e) => setWeek(Number(e.target.value))}
              >
                {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                  <option key={w} value={w}>W{w}</option>
                ))}
              </select>
            </div>

            {myPickThisWeek ? (
              <p className="mt-3 text-sm">
                Tu pick W{week}:{' '}
                <span className="inline-flex items-center gap-2">
                  <b>{myPickThisWeek.team_id}</b>
                  {teamsMap[myPickThisWeek.team_id]?.logo_url ? (
                    <img
                      src={teamsMap[myPickThisWeek.team_id].logo_url}
                      alt={myPickThisWeek.team_id}
                      className="h-4 w-4 rounded-full"
                      referrerPolicy="no-referrer"
                    />
                  ) : null}
                </span>{' '}
                {myPickThisWeek.auto_pick ? '(auto)' : ''} · Resultado:{' '}
                <span
                  className={
                    myPickThisWeek.result === 'win'
                      ? 'text-emerald-700 font-semibold'
                      : myPickThisWeek.result === 'loss'
                      ? 'text-red-600 font-semibold'
                      : myPickThisWeek.result === 'push'
                      ? 'text-gray-600'
                      : 'text-gray-500'
                  }
                >
                  {myPickThisWeek.result}
                </span>
              </p>
            ) : (
              <p className="mt-3 text-sm">Aún no eliges en W{week}</p>
            )}

            <div className="mt-3 flex items-center gap-2">
              <button className="text-xs px-3 py-1 rounded border hover:bg-gray-50" onClick={exportMyPicksCSV}>
                Exportar mis picks (CSV)
              </button>
              <button className="text-xs px-3 py-1 rounded border hover:bg-gray-50" onClick={exportStandingsCSV}>
                Exportar standings (CSV)
              </button>
              {/* Botón manual para recargar desde DB (no llama ESPN, solo refresca tabla) */}
              <button className="text-xs px-3 py-1 rounded border hover:bg-gray-50" onClick={() => loadGames(week)}>
                Refrescar marcadores
              </button>
            </div>

            <p className="text-xs mt-3 text-gray-600">
              Cuenta regresiva al siguiente lock:{' '}
              {games?.[0] && <Countdown iso={games[0].start_time} />}
            </p>
          </div>

          {/* Partidos */}
          <div className="p-4 border rounded-2xl bg-white shadow-sm md:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold mb-3">Partidos W{week}</h2>
              {/* Filtro por día */}
              <div className="flex gap-1 text-xs">
                {['ALL','THU','FRI','SAT','SUN','MON'].map(d => (
                  <button
                    key={d}
                    className={`px-2 py-1 rounded border ${dayFilter===d?'bg-black text-white':'hover:bg-gray-50'}`}
                    onClick={() => setDayFilter(d)}
                    title={d==='ALL'?'Todos':'Filtrar por día'}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {gamesFiltered.map((g) => {
                const local = DateTime.fromISO(g.start_time).setZone(TZ).toFormat('EEE dd LLL HH:mm');
                const locked = DateTime.fromISO(g.start_time) <= DateTime.now();

                return (
                  <div
                    key={g.id}
                    className={`p-3 border rounded-xl ${locked ? 'opacity-60' : 'bg-white'} shadow-sm`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm">
                          <TeamBadge id={g.away_team} />{' '}
                          <span className="mx-1 text-gray-400">@</span>{' '}
                          <TeamBadge id={g.home_team} />
                        </div>

                        <div className="mt-1 text-xs text-gray-600">
                          Kickoff:{' '}
                          <span className="px-1.5 py-0.5 rounded bg-gray-100">{local}</span>
                        </div>

                        {/* (3) Estado y marcador */}
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

                        {/* (3) Periodo / reloj si está en vivo */}
                        {g.status === 'in_progress' && (
                          <div className="mt-1 text-xs text-amber-800">
                            {g.period ? `Q${g.period}` : ''} {g.clock || ''}
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <button
                          className="border px-3 py-1 rounded hover:bg-gray-100 disabled:opacity-40"
                          disabled={!canPick(g, g.away_team).ok}
                          onClick={() => choose(g, g.away_team)}
                          title={!canPick(g, g.away_team).ok
                            ? (usedTeams.has(g.away_team) ? 'Equipo ya usado' : 'Bloqueado por kickoff')
                            : 'Elegir visitante'}
                        >
                          <span className="inline-flex items-center gap-2">
                            <TeamBadge id={g.away_team} />
                            {usedTeams.has(g.away_team) && !(myPickThisWeek && myPickThisWeek.team_id === g.away_team) && (
                              <span className="ml-1 text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                                Used
                              </span>
                            )}
                          </span>
                        </button>

                        <button
                          className="border px-3 py-1 rounded hover:bg-gray-100 disabled:opacity-40"
                          disabled={!canPick(g, g.home_team).ok}
                          onClick={() => choose(g, g.home_team)}
                          title={!canPick(g, g.home_team).ok
                            ? (usedTeams.has(g.home_team) ? 'Equipo ya usado' : 'Bloqueado por kickoff')
                            : 'Elegir local'}
                        >
                          <span className="inline-flex items-center gap-2">
                            <TeamBadge id={g.home_team} />
                            {usedTeams.has(g.home_team) && !(myPickThisWeek && myPickThisWeek.team_id === g.home_team) && (
                              <span className="ml-1 text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                                Used
                              </span>
                            )}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {(!gamesFiltered || gamesFiltered.length === 0) && (
                <div className="text-sm text-gray-500">No hay partidos para este filtro.</div>
              )}
            </div>
          </div>
        </section>

        {/* Bottom: standings + historial */}
        <section className="mt-6 grid md:grid-cols-2 gap-4">
          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <h2 className="font-semibold">Tabla de supervivientes</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm mt-3">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th>Jugador</th>
                    <th>Vidas</th>
                    <th>W</th>
                    <th>L</th>
                    <th>Push</th>
                    <th>Margen</th>
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
                    <tr>
                      <td className="py-2 text-gray-500" colSpan={6}>
                        Aún no hay standings.
                      </td>
                    </tr>
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
                  <tr className="text-left text-gray-500">
                    <th>W</th>
                    <th>Equipo</th>
                    <th>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {(picks || [])
                    .sort((a, b) => a.week - b.week)
                    .map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="py-1.5">{p.week}</td>
                        <td><TeamBadge id={p.team_id} /></td>
                        <td>
                          <span
                            className={
                              p.result === 'win'
                                ? 'text-emerald-700 font-semibold'
                                : p.result === 'loss'
                                ? 'text-red-600 font-semibold'
                                : p.result === 'push'
                                ? 'text-gray-600'
                                : 'text-gray-500'
                            }
                          >
                            {p.result}
                          </span>
                        </td>
                      </tr>
                    ))}
                  {(!picks || picks.length === 0) && (
                    <tr>
                      <td className="py-2 text-gray-500" colSpan={3}>
                        Aún no has hecho picks.
                      </td>
                    </tr>
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


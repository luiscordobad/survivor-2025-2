import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import { DateTime } from "luxon";

const TZ = import.meta.env.VITE_TZ || "America/Mexico_City";

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

function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          import.meta.env.VITE_SITE_URL || window.location.origin,
      },
    });
    if (!error) setSent(true);
    else alert(error.message);
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={send} className="max-w-sm w-full space-y-4">
        <h1 className="text-2xl font-bold">Survivor 2025</h1>
        {sent ? (
          <p>Revisa tu correo y da clic al enlace de acceso.</p>
        ) : (
          <>
            <input
              className="border w-full p-2"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="bg-black text-white px-4 py-2 w-full">
              Entrar
            </button>
          </>
        )}
      </form>
    </div>
  );
}

function Countdown({ iso }) {
  const [left, setLeft] = useState("");
  useEffect(() => {
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
  const [leaguePicks, setLeaguePicks] = useState([]);
  const [popularity, setPopularity] = useState({});
  const [odds, setOdds] = useState({});

  const load = async () => {
    const email = session.user.email;
    let { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .single();
    if (!prof) {
      await supabase
        .from("profiles")
        .insert({ id: session.user.id, email, display_name: email.split("@")[0] });
      const r = await supabase
        .from("profiles")
        .select("*")
        .eq("email", email)
        .single();
      prof = r.data;
    }
    setMe(prof);
    const { data: pk } = await supabase
      .from("picks")
      .select("*")
      .eq("user_id", session.user.id);
    setPicks(pk || []);
    setUsedTeams(new Set((pk || []).map((x) => x.team_id)));
    const { data: st } = await supabase.from("standings").select("*");
    setStandings(st || []);
    await loadGames(week);
  };

  const loadGames = async (w) => {
    const { data: gs } = await supabase
      .from("games")
      .select("*")
      .eq("week", w)
      .order("start_time");
    setGames(gs || []);
    const ids = (gs || []).map((g) => g.id);
    if (ids.length) {
      const { data: os } = await supabase
        .from("odds")
        .select("*")
        .in("game_id", ids)
        .order("fetched_at", { ascending: false });
      const map = {};
      (os || []).forEach((o) => {
        if (!map[o.game_id]) map[o.game_id] = o;
      });
      setOdds(map);
    }
  };

  const loadLeaguePicks = async (w) => {
    const { data } = await supabase
      .from("picks")
      .select("*, profiles(display_name)")
      .eq("week", w);
    setLeaguePicks(data || []);
    const counts = {};
    (data || []).forEach((p) => {
      counts[p.team_id] = (counts[p.team_id] || 0) + 1;
    });
    setPopularity(counts);
  };

  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    loadGames(week);
    loadLeaguePicks(week);
  }, [week]);

  const myPickThisWeek = useMemo(
    () => (picks || []).find((p) => p.week === week),
    [picks, week]
  );

  const canPick = (g, team) => {
    const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
    if (locked) return { ok: false, reason: "LOCK" };
    if (
      usedTeams.has(team) &&
      !(myPickThisWeek && myPickThisWeek.team_id === team)
    )
      return { ok: false, reason: "USED" };
    return { ok: true };
  };

  const upsertPick = async (g, team) => {
    const c = canPick(g, team);
    if (!c.ok)
      return alert(
        c.reason === "LOCK"
          ? "Cerrado por kickoff"
          : "Ya usaste este equipo"
      );
    if (myPickThisWeek) {
      const { error } = await supabase
        .from("picks")
        .update({
          team_id: team,
          game_id: g.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", myPickThisWeek.id);
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase
        .from("picks")
        .insert({
          user_id: session.user.id,
          game_id: g.id,
          team_id: team,
          week,
          season: 2025,
        });
      if (error) return alert(error.message);
    }
    const { data: pk } = await supabase
      .from("picks")
      .select("*")
      .eq("user_id", session.user.id);
    setPicks(pk || []);
    setUsedTeams(new Set((pk || []).map((x) => x.team_id)));
  };

  const TeamMini = ({ id }) => {
    return (
      <div className="flex items-center gap-1">
        <img
          src={`/teams/${id}.png`}
          alt={id}
          className="h-6 w-6 object-contain"
        />
        <span className="font-semibold">{id}</span>
      </div>
    );
  };

  const TeamBox = ({ game, teamId, last }) => {
    const disabled = !canPick(game, teamId).ok;
    const selected =
      myPickThisWeek?.game_id === game.id &&
      myPickThisWeek?.team_id === teamId;

    const pct = (popularity[teamId] || 0) / (standings.length || 1) * 100;
    const fav =
      last &&
      ((teamId === game.home_team && last.spread_home < last.spread_away) ||
        (teamId === game.away_team && last.spread_away < last.spread_home));

    return (
      <button
        onClick={() => upsertPick(game, teamId)}
        disabled={disabled}
        className={[
          "w-full text-left rounded-xl border transition",
          "px-4 py-3",
          "hover:bg-gray-50",
          selected
            ? "border-emerald-500 ring-2 ring-emerald-200 bg-emerald-50"
            : "border-gray-200",
          disabled ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        <div className="flex items-center justify-between">
          <TeamMini id={teamId} />
          <div className="flex items-center gap-2">
            {fav && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900">
                Fav
              </span>
            )}
            {pct < 15 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                DIF
              </span>
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">2025</h1>
          <p className="text-sm">
            Hola, <b>{me?.display_name}</b> ·{" "}
            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
              Vidas: {me?.lives}
            </span>
          </p>
        </div>
        <button
          className="text-sm underline"
          onClick={() => supabase.auth.signOut()}
        >
          Salir
        </button>
      </header>

      <section className="mt-4 grid md:grid-cols-3 gap-4">
        <div className="p-3 border rounded">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Semana</h2>
            <select
              className="border p-1"
              value={week}
              onChange={(e) => setWeek(Number(e.target.value))}
            >
              {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  W{w}
                </option>
              ))}
            </select>
          </div>
          {myPickThisWeek ? (
            <p className="mt-2">
              Tu pick W{week}: <b>{myPickThisWeek.team_id}</b>{" "}
              {myPickThisWeek.auto_pick ? "(auto)" : ""} · Resultado:{" "}
              {myPickThisWeek.result}
            </p>
          ) : (
            <p className="mt-2">Aún no eliges en W{week}</p>
          )}
          <p className="text-xs mt-1">
            Cuenta regresiva al siguiente lock:{" "}
            {games?.[0] && <Countdown iso={games[0].start_time} />}
          </p>
        </div>

        <div className="p-3 border rounded md:col-span-2">
          <h2 className="font-semibold mb-2">Partidos W{week}</h2>
          <div className="space-y-2">
            {games.map((g) => {
              const local = DateTime.fromISO(g.start_time)
                .setZone(TZ)
                .toFormat("EEE dd LLL HH:mm");
              const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
              const lastOdds = odds[g.id];
              return (
                <div
                  key={g.id}
                  className={`p-3 border rounded-lg ${
                    locked ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-sm font-semibold flex items-center gap-2">
                        <TeamMini id={g.away_team} /> @{" "}
                        <TeamMini id={g.home_team} />
                      </div>
                      <div className="text-xs text-gray-600">
                        Kickoff: {local}
                      </div>
                      <div className="text-xs text-gray-600">
                        Lock en: <Countdown iso={g.start_time} />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <TeamBox game={g} teamId={g.away_team} last={lastOdds} />
                    <TeamBox game={g} teamId={g.home_team} last={lastOdds} />
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    Estado: {g.status}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mt-6 grid md:grid-cols-2 gap-4">
        <div className="p-3 border rounded">
          <h2 className="font-semibold">Picks de la liga (W{week})</h2>
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-left">
                <th>Jugador</th>
                <th>Equipo</th>
                <th>Resultado</th>
                <th>Auto</th>
                <th>Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {leaguePicks.map((p) => (
                <tr key={p.id}>
                  <td>{p.profiles?.display_name}</td>
                  <td>
                    <TeamMini id={p.team_id} />
                  </td>
                  <td>{p.result}</td>
                  <td>{p.auto_pick ? "Sí" : "No"}</td>
                  <td>
                    {p.updated_at &&
                      DateTime.fromISO(p.updated_at)
                        .setZone(TZ)
                        .toFormat("dd LLL HH:mm")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-3 border rounded">
          <h2 className="font-semibold">Popularidad de equipos</h2>
          <p className="text-xs text-gray-600">
            Porcentaje de jugadores que pickearon ese equipo.
          </p>
          {Object.keys(popularity).map((tid) => {
            const pct =
              (popularity[tid] || 0) / (standings.length || 1) * 100;
            return (
              <div key={tid} className="flex items-center justify-between">
                <TeamMini id={tid} />
                <span className="text-sm font-semibold">{pct.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-6 grid md:grid-cols-2 gap-4">
        <div className="p-3 border rounded">
          <h2 className="font-semibold">Tabla de supervivientes</h2>
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-left">
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
                <tr key={s.user_id}>
                  <td>{s.display_name}</td>
                  <td>{s.lives}</td>
                  <td>{s.wins}</td>
                  <td>{s.losses}</td>
                  <td>{s.pushes}</td>
                  <td>{s.margin_sum}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-3 border rounded">
          <h2 className="font-semibold">Historial de tus picks</h2>
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-left">
                <th>W</th>
                <th>Equipo</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {(picks || [])
                .sort((a, b) => a.week - b.week)
                .map((p) => (
                  <tr key={p.id}>
                    <td>{p.week}</td>
                    <td>
                      <TeamMini id={p.team_id} />
                    </td>
                    <td>{p.result}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}








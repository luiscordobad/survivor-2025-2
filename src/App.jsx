// src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { supabase } from "./lib/supabaseClient";
import Rules from "./Rules";

const TZ = import.meta.env.VITE_TZ || "America/Mexico_City";
const SITE = import.meta.env.VITE_SITE_URL || "";
const CRON_TOKEN = import.meta.env.VITE_CRON_TOKEN || "";

/* ========================= Utilidades UI ========================= */
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
const cls = (...xs) => xs.filter(Boolean).join(" ");
const toLocal = (iso) =>
  DateTime.fromISO(iso).setZone(TZ).toFormat("EEE dd LLL HH:mm");

/* ========================= Sesión ========================= */
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

/* ========================= Login simple ========================= */
function Login() {
  const [tab, setTab] = useState("password"); // password | magic
  const [busy, setBusy] = useState(false);

  // Password
  const [passEmail, setPassEmail] = useState("");
  const [passPwd, setPassPwd] = useState("");
  const [isSignup, setIsSignup] = useState(false);

  // Magic
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const passwordAuth = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({
          email: passEmail,
          password: passPwd,
          options: {
            emailRedirectTo: SITE || window.location.origin,
          },
        });
        if (error) throw error;
        alert("Cuenta creada. Revisa tu correo para confirmar.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: passEmail,
          password: passPwd,
        });
        if (error) throw error;
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };
  const magic = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: SITE || window.location.origin },
    });
    if (!error) setSent(true);
    else alert(error.message);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-white">
      <div className="w-full max-w-md space-y-4 p-6 border rounded-2xl bg-white">
        <h1 className="text-3xl font-extrabold tracking-tight text-center">
          {import.meta.env.VITE_LEAGUE_NAME || "Survivor 2025"}
        </h1>

        <div className="flex gap-2 justify-center">
          <button
            className={cls(
              "px-3 py-1 rounded border",
              tab === "password" && "bg-black text-white"
            )}
            onClick={() => setTab("password")}
          >
            Email + Password
          </button>
          <button
            className={cls(
              "px-3 py-1 rounded border",
              tab === "magic" && "bg-black text-white"
            )}
            onClick={() => setTab("magic")}
          >
            Magic link
          </button>
        </div>

        {tab === "password" && (
          <form onSubmit={passwordAuth} className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm">
                {isSignup ? "Crear cuenta" : "Iniciar sesión"}
              </label>
              <button
                type="button"
                className="text-xs underline"
                onClick={() => setIsSignup(!isSignup)}
              >
                {isSignup
                  ? "¿Ya tienes cuenta? Inicia sesión"
                  : "¿No tienes cuenta? Regístrate"}
              </button>
            </div>
            <input
              type="email"
              className="border w-full p-2 rounded-lg"
              placeholder="email"
              value={passEmail}
              onChange={(e) => setPassEmail(e.target.value)}
              required
            />
            <input
              type="password"
              className="border w-full p-2 rounded-lg"
              placeholder="contraseña"
              value={passPwd}
              onChange={(e) => setPassPwd(e.target.value)}
              required
            />
            <button
              disabled={busy}
              className="bg-black text-white px-4 py-2 w-full rounded-lg disabled:opacity-60"
            >
              {isSignup ? "Crear cuenta" : "Entrar"}
            </button>
          </form>
        )}

        {tab === "magic" && (
          <form onSubmit={magic} className="space-y-3">
            <input
              type="email"
              className="border w-full p-2 rounded-lg"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button className="bg-black text-white px-4 py-2 w-full rounded-lg">
              Enviar magic link
            </button>
            {sent && <p className="text-xs text-gray-600">Revisa tu correo.</p>}
          </form>
        )}
      </div>
    </div>
  );
}

/* ========================= Root con Tabs ========================= */
function AppRoot() {
  const session = useSession();
  const [tab, setTab] = useState("games"); // games | assistant | news | rules
  if (!session) return <Login />;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Navbar */}
      <div className="w-full border-b bg-white sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center justify-between">
          <div className="flex gap-2">
            {[
              ["games", "Partidos"],
              ["assistant", "Asistente"],
              ["news", "Noticias"],
              ["rules", "Reglas"],
            ].map(([k, label]) => (
              <button
                key={k}
                className={cls(
                  "text-sm px-3 py-1 rounded border",
                  tab === k && "bg-black text-white"
                )}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="text-sm underline"
            onClick={() => supabase.auth.signOut()}
          >
            Salir
          </button>
        </div>
      </div>

      {tab === "games" && <AppAuthed session={session} />}
      {tab === "assistant" && <Assistant session={session} />}
      {tab === "news" && <NewsTab />}
      {tab === "rules" && <Rules />}
    </div>
  );
}
export default AppRoot;

/* ========================= AppAuthed (Partidos) ========================= */
function AppAuthed({ session }) {
  const [me, setMe] = useState(null);
  const [week, setWeek] = useState(
    () => Number(localStorage.getItem("week")) || 1
  );

  const [teamsMap, setTeamsMap] = useState({});
  const [games, setGames] = useState([]);
  const [oddsPairs, setOddsPairs] = useState({});
  const [picks, setPicks] = useState([]);
  const [leaguePicks, setLeaguePicks] = useState([]);
  const [userNames, setUserNames] = useState({});
  const [popularity, setPopularity] = useState([]);
  const [standings, setStandings] = useState([]);

  // filtros
  const [dayFilter, setDayFilter] = useState(
    localStorage.getItem("dayFilter") || "ALL"
  );
  const [teamQuery, setTeamQuery] = useState(
    localStorage.getItem("teamQuery") || ""
  );
  const searchRef = useRef(null);

  // confirmación
  const [pendingPick, setPendingPick] = useState(null); // { game, teamId }

  /* ---------- carga base ---------- */
  const loadTeams = async () => {
    const { data } = await supabase.from("teams").select("*");
    const m = {};
    (data || []).forEach((t) => (m[t.id] = t));
    setTeamsMap(m);
  };
  const TeamMini = ({ id }) => {
    const t = teamsMap[id] || {};
    const src = t.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-1">
        <img src={src} alt={id} className="h-5 w-5 rounded-full object-contain" />
        <span className="font-mono font-semibold">{id}</span>
      </span>
    );
  };
  const TeamChip = ({ id }) => {
    const t = teamsMap[id] || {};
    const src = t.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-2">
        <img src={src} alt={id} className="h-6 w-6 rounded-full object-contain" />
        <span className="font-medium">{t.name || id}</span>
      </span>
    );
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
      const { data } = await supabase
        .from("odds")
        .select(
          "game_id, spread_home, spread_away, ml_home, ml_away, fetched_at"
        )
        .in("game_id", ids)
        .order("fetched_at", { ascending: false });
      const by = {};
      for (const row of data || []) {
        if (!by[row.game_id]) by[row.game_id] = { last: row, prev: null };
        else if (!by[row.game_id].prev) by[row.game_id].prev = row;
      }
      setOddsPairs(by);
    } else {
      setOddsPairs({});
    }
  };

  const loadLeaguePicks = async (w) => {
    const { data: pks } = await supabase
      .from("picks")
      .select("id,user_id,team_id,result,auto_pick,updated_at,week,game_id")
      .eq("week", w);
    setLeaguePicks(pks || []);

    const ids = [...new Set((pks || []).map((x) => x.user_id))];
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,display_name")
        .in("id", ids);
      const m = {};
      (profs || []).forEach((p) => (m[p.id] = p.display_name));
      setUserNames(m);
    } else setUserNames({});

    const { data: total } = await supabase.from("profiles").select("id"); // todos los registrados
    const counts = {};
    (pks || []).forEach((x) => {
      if (x.team_id) counts[x.team_id] = (counts[x.team_id] || 0) + 1;
    });
    const list = Object.entries(counts)
      .map(([team_id, count]) => ({
        team_id,
        count,
        pct: total?.length ? Math.round((count * 100) / total.length) : 0,
      }))
      .sort((a, b) => b.count - a.count);
    setPopularity(list);
  };

  const loadStandings = async () => {
    const { data } = await supabase.from("standings").select("*");
    setStandings(data || []);
  };

  const initAll = async () => {
    const email = session.user.email;
    let { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .single();
    if (!prof) {
      await supabase.from("profiles").insert({
        id: session.user.id,
        email,
        display_name: email.split("@")[0],
      });
      const r = await supabase
        .from("profiles")
        .select("*")
        .eq("email", email)
        .single();
      prof = r.data;
    }
    setMe(prof);

    await loadTeams();

    const { data: pk } = await supabase
      .from("picks")
      .select("*")
      .eq("user_id", session.user.id);
    setPicks(pk || []);

    await loadGames(week);
    await loadLeaguePicks(week);
    await loadStandings();
  };

  useEffect(() => {
    initAll();
    // realtime picks — escucha cambios para refrescar
    const ch = supabase
      .channel("realtime-picks")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "picks" },
        () => {
          loadLeaguePicks(week);
          supabase
            .from("picks")
            .select("*")
            .eq("user_id", session.user.id)
            .then(({ data }) => setPicks(data || []));
        }
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadGames(week);
    loadLeaguePicks(week);
    localStorage.setItem("week", String(week));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  // auto-refresh si hay juegos en vivo
  useEffect(() => {
    const anyLive = (games || []).some((g) => g.status === "in_progress");
    if (!anyLive) return;
    const id = setInterval(() => loadGames(week), 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, week]);

  useEffect(() => localStorage.setItem("dayFilter", dayFilter), [dayFilter]);
  useEffect(() => localStorage.setItem("teamQuery", teamQuery), [teamQuery]);

  /* ---------- helpers ---------- */
  const myPickThisWeek = useMemo(
    () => (picks || []).find((p) => p.week === week),
    [picks, week]
  );

  const nextKickoffISO = useMemo(() => {
    const up = (games || []).find(
      (g) => DateTime.fromISO(g.start_time) > DateTime.now()
    );
    return up?.start_time || null;
  }, [games]);

  const showPickAlert = useMemo(() => {
    if (myPickThisWeek || !nextKickoffISO) return false;
    const mins = DateTime.fromISO(nextKickoffISO).diffNow("minutes").minutes;
    return mins <= 90 && mins > 0;
  }, [myPickThisWeek, nextKickoffISO]);

  const popPct = (teamId) =>
    popularity.find((p) => p.team_id === teamId)?.pct ?? 0;

  /** Regla de LOCK reforzada
   * - Si no hay pick: se puede escoger cualquier juego futuro.
   * - Si ya hay pick:
   *     - Si el juego pickeado ya **inició** o está **final**, NO puede cambiarse.
   *     - Si el juego pickeado no inició aún, se puede cambiar siempre que el nuevo juego tampoco haya iniciado.
   */
  const canPick = (g, team) => {
    const nowStarted = DateTime.fromISO(g.start_time) <= DateTime.now();
    if (nowStarted) return { ok: false, reason: "LOCK_GAME_STARTED" };

    // equipo ya usado esta temporada por mí
    const used = (picks || []).some(
      (p) => p.team_id === team && p.user_id === session.user.id && p.week !== week
    );
    if (used) return { ok: false, reason: "TEAM_USED" };

    if (!myPickThisWeek) return { ok: true };

    // tengo pick; ¿el juego pickeado ya inició?
    const pickedGame = (games || []).find((x) => x.id === myPickThisWeek.game_id);
    if (pickedGame) {
      const pickedStarted =
        DateTime.fromISO(pickedGame.start_time) <= DateTime.now();
      if (pickedStarted || pickedGame.status === "in_progress" || pickedGame.status === "final")
        return { ok: false, reason: "LOCK_ALREADY_STARTED" };
    }
    return { ok: true };
  };

  const confirmPick = (game, teamId) => {
    const c = canPick(game, teamId);
    if (!c.ok) {
      alert(
        {
          LOCK_GAME_STARTED:
            "Este partido ya está bloqueado (kickoff iniciado).",
          TEAM_USED: "Ya usaste este equipo en la temporada.",
          LOCK_ALREADY_STARTED:
            "No puedes cambiar tu pick: el partido previamente elegido ya inició/terminó.",
        }[c.reason] || "No permitido"
      );
      return;
    }
    setPendingPick({ game, teamId });
  };

  const doPick = async () => {
    if (!pendingPick) return;
    const { game, teamId } = pendingPick;

    // última validación antes de escribir
    const check = canPick(game, teamId);
    if (!check.ok) return alert("El pick ya no es válido (lock).");

    if (myPickThisWeek) {
      const { error } = await supabase
        .from("picks")
        .update({
          team_id: teamId,
          game_id: game.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", myPickThisWeek.id);
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from("picks").insert({
        user_id: session.user.id,
        game_id: game.id,
        team_id: teamId,
        week,
        season: 2025,
      });
      if (error) return alert(error.message);
    }
    // refresh
    const { data: pk } = await supabase
      .from("picks")
      .select("*")
      .eq("user_id", session.user.id);
    setPicks(pk || []);
    setPendingPick(null);
  };

  /* ---------- UI helpers ---------- */
  const ScoreStrip = ({ g }) => {
    const score = (
      <div className="flex items-center gap-4">
        <div className="text-xl font-bold">
          {g.away_team} <span className="tabular-nums">{g.away_score ?? 0}</span>
        </div>
        <div className="text-gray-300">—</div>
        <div className="text-xl font-bold">
          {g.home_team} <span className="tabular-nums">{g.home_score ?? 0}</span>
        </div>
      </div>
    );
    if (g.status === "final") {
      return (
        <div className="flex items-center justify-between">
          {score}
          <span className="text-xs px-2 py-0.5 rounded bg-gray-100">FINAL</span>
        </div>
      );
    }
    if (g.status === "in_progress") {
      return (
        <div className="flex items-center justify-between">
          {score}
          <div className="text-xs flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900">
              Q{g.period ?? ""} {g.clock ?? ""}
            </span>
            {g.possession && (
              <span className="px-2 py-0.5 rounded bg-gray-100">
                ⬤ {g.possession}
              </span>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-between">
        {score}
        <div className="text-xs">
          <span className="px-2 py-0.5 rounded bg-gray-100">
            Kickoff: {toLocal(g.start_time)}
          </span>
        </div>
      </div>
    );
  };

  const TeamBox = ({ game, teamId }) => {
    const allowed = canPick(game, teamId).ok;
    const selected =
      myPickThisWeek?.game_id === game.id && myPickThisWeek?.team_id === teamId;
    const pct = popPct(teamId);
    const { last } = oddsPairs[game.id] || {};
    const fav =
      last &&
      ((teamId === game.home_team &&
        ((last.spread_home ?? 0) < (last.spread_away ?? 0) ||
          (last.ml_home ?? 9999) < (last.ml_away ?? 9999))) ||
        (teamId === game.away_team &&
          ((last.spread_away ?? 0) < (last.spread_home ?? 0) ||
            (last.ml_away ?? 9999) < (last.ml_home ?? 9999))));

    return (
      <button
        onClick={() => confirmPick(game, teamId)}
        disabled={!allowed}
        className={cls(
          "w-full text-left rounded-xl border transition px-4 py-3",
          selected ? "border-emerald-500 bg-emerald-50" : "border-gray-200 hover:bg-gray-50",
          !allowed && "opacity-50 cursor-not-allowed"
        )}
      >
        <div className="flex items-center justify-between">
          <TeamMini id={teamId} />
          <div className="flex items-center gap-2">
            {fav && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900">
                Fav
              </span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100">
              Liga {pct}%
            </span>
          </div>
        </div>
      </button>
    );
  };

  /* ---------- filtros ---------- */
  const gamesByDay = useMemo(() => {
    if (dayFilter === "ALL") return games;
    const map = { THU: 4, FRI: 5, SAT: 6, SUN: 7, MON: 1 };
    const want = map[dayFilter];
    return (games || []).filter(
      (g) => DateTime.fromISO(g.start_time).setZone(TZ).weekday === want
    );
  }, [games, dayFilter]);

  const gamesFiltered = useMemo(() => {
    const q = teamQuery.trim().toLowerCase();
    if (!q) return gamesByDay;
    const match = (id) => {
      const t = teamsMap[id];
      return (
        id.toLowerCase().includes(q) ||
        (t?.name || "").toLowerCase().includes(q)
      );
    };
    return (gamesByDay || []).filter(
      (g) => match(g.away_team) || match(g.home_team)
    );
  }, [gamesByDay, teamQuery, teamsMap]);

  /* ========================= Render ========================= */
  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {import.meta.env.VITE_LEAGUE_NAME || "Survivor 2025"}
          </h1>
          <p className="text-sm text-gray-700">
            Hola, <b>{me?.display_name}</b> · Vidas:{" "}
            <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
              {me?.lives}
            </span>
          </p>
        </div>
      </header>

      {/* Alertas */}
      {showPickAlert && (
        <div className="mt-3 p-3 border-2 border-red-300 rounded-xl bg-red-50 text-red-900 text-sm">
          🔔 Aún no tienes pick en W{week}. Primer kickoff en{" "}
          <b>
            <Countdown iso={nextKickoffISO} />
          </b>
          .
        </div>
      )}

      {/* Toolbar */}
      <section className="mt-4 grid md:grid-cols-3 gap-4">
        <div className="p-4 border rounded-2xl bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Semana</label>
              <select
                className="border p-1 rounded-lg"
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
            <div className="flex gap-1 text-xs">
              {["ALL", "THU", "FRI", "SAT", "SUN", "MON"].map((d) => (
                <button
                  key={d}
                  className={cls(
                    "px-2 py-1 rounded border",
                    dayFilter === d && "bg-black text-white"
                  )}
                  onClick={() => setDayFilter(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <input
            ref={searchRef}
            className="mt-3 border w-full p-2 rounded-lg"
            placeholder="Buscar equipo..."
            value={teamQuery}
            onChange={(e) => setTeamQuery(e.target.value)}
          />
        </div>

        <div className="md:col-span-2 p-4 border rounded-2xl bg-white">
          <h3 className="font-semibold">Resumen</h3>
          <p className="text-sm text-gray-600">
            El lock es por partido (“rolling”). Puedes cambiar tu pick hasta el
            kickoff de tu partido; si tu pick ya arrancó o terminó, **no** se puede
            cambiar.
          </p>
        </div>
      </section>

      {/* Partidos */}
      <section className="mt-4 p-4 border rounded-2xl bg-white">
        <h2 className="font-semibold mb-3">Partidos W{week}</h2>
        <div className="space-y-3">
          {gamesFiltered.map((g) => (
            <div key={g.id} className="p-4 border rounded-xl">
              {/* encabezado */}
              <div className="flex items-center justify-between">
                <div className="text-sm flex items-center gap-2 flex-wrap">
                  <TeamChip id={g.away_team} />
                  <span className="mx-1 text-gray-400">@</span>
                  <TeamChip id={g.home_team} />
                </div>
                <div className="text-xs text-gray-600">
                  <span className="px-1.5 py-0.5 rounded bg-gray-100">
                    Kickoff: {toLocal(g.start_time)}
                  </span>{" "}
                  · Lock:&nbsp;
                  <Countdown iso={g.start_time} />
                </div>
              </div>

              {/* score + estado */}
              <div className="mt-3">
                <ScoreStrip g={g} />
              </div>

              {/* boxes */}
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TeamBox game={g} teamId={g.home_team} />
                <TeamBox game={g} teamId={g.away_team} />
              </div>
            </div>
          ))}
          {(!gamesFiltered || gamesFiltered.length === 0) && (
            <div className="text-sm text-gray-500">
              No hay partidos para este filtro o búsqueda.
            </div>
          )}
        </div>
      </section>

      {/* Liga: picks + popularidad */}
      <section className="mt-6 grid md:grid-cols-2 gap-4">
        <div className="p-4 border rounded-2xl bg-white">
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
                    .sort((a, b) =>
                      (userNames[a.user_id] || "").localeCompare(
                        userNames[b.user_id] || ""
                      )
                    )
                    .map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="py-1.5">
                          {userNames[p.user_id] || p.user_id.slice(0, 6)}
                        </td>
                        <td>
                          <TeamMini id={p.team_id} />
                        </td>
                        <td>
                          <span
                            className={cls(
                              p.result === "win" && "text-emerald-700 font-semibold",
                              p.result === "loss" && "text-red-600 font-semibold",
                              p.result === "push" && "text-gray-600",
                              !p.result && "text-gray-500"
                            )}
                          >
                            {p.result || "-"}
                          </span>
                        </td>
                        <td>{p.auto_pick ? "Sí" : "No"}</td>
                        <td className="text-xs text-gray-500">
                          {p.updated_at
                            ? DateTime.fromISO(p.updated_at)
                                .setZone(TZ)
                                .toFormat("dd LLL HH:mm")
                            : "-"}
                        </td>
                      </tr>
                    ))
                ) : (
                  <tr>
                    <td className="py-2 text-gray-500" colSpan={5}>
                      Aún no hay picks esta semana.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-4 border rounded-2xl bg-white">
          <h2 className="font-semibold">Popularidad de equipos</h2>
          <p className="text-xs text-gray-600">
            Porcentaje de jugadores que pickearon ese equipo.
          </p>
          <div className="mt-3 space-y-2">
            {(popularity || []).length > 0 ? (
              popularity.map((row) => (
                <div key={row.team_id}>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <TeamMini id={row.team_id} />{" "}
                      <span className="text-gray-500">({row.count})</span>
                    </div>
                    <span className="text-gray-700">{row.pct}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded mt-1">
                    <div
                      className="h-2 rounded bg-black"
                      style={{ width: `${row.pct}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-500">
                Sin picks registrados esta semana.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Standings + Historial */}
      <section className="mt-6 grid md:grid-cols-2 gap-4">
        <div className="p-4 border rounded-2xl bg-white">
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
                {(standings || []).length ? (
                  standings.map((s) => (
                    <tr key={s.user_id} className="border-t">
                      <td className="py-1.5">{s.display_name}</td>
                      <td>{s.lives}</td>
                      <td className="text-emerald-700 font-medium">{s.wins}</td>
                      <td className="text-red-600 font-medium">{s.losses}</td>
                      <td className="text-gray-600">{s.pushes}</td>
                      <td>{s.margin_sum}</td>
                    </tr>
                  ))
                ) : (
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

        <div className="p-4 border rounded-2xl bg-white">
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
                  .slice()
                  .sort((a, b) => a.week - b.week)
                  .map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="py-1.5">{p.week}</td>
                      <td>
                        <TeamMini id={p.team_id} />
                      </td>
                      <td>
                        <span
                          className={cls(
                            p.result === "win" && "text-emerald-700 font-semibold",
                            p.result === "loss" && "text-red-600 font-semibold",
                            p.result === "push" && "text-gray-600",
                            !p.result && "text-gray-500"
                          )}
                        >
                          {p.result || "pending"}
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

      {/* Modal confirmación */}
      {pendingPick && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 border">
            <h3 className="font-semibold text-lg">Confirmar pick</h3>
            <p className="mt-2 text-sm">
              ¿Confirmas tu pick de <b>{pendingPick.teamId}</b> en W{week}?
            </p>
            <div className="mt-4 flex gap-2">
              <button
                className="px-4 py-2 rounded border"
                onClick={() => setPendingPick(null)}
              >
                Cancelar
              </button>
              <button
                className="px-4 py-2 rounded bg-black text-white"
                onClick={doPick}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {!myPickThisWeek && nextKickoffISO && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded-xl bg-black text-white text-sm shadow-lg">
          Recuerda elegir: kickoff en <Countdown iso={nextKickoffISO} />
        </div>
      )}
    </div>
  );
}

/* ========================= Asistente (sugerencias + autopick) ========================= */
function Assistant({ session }) {
  const [week, setWeek] = useState(
    () => Number(localStorage.getItem("week")) || 1
  );
  const [teamsMap, setTeamsMap] = useState({});
  const [games, setGames] = useState([]);
  const [oddsPairs, setOddsPairs] = useState({});
  const [picks, setPicks] = useState([]);
  const [suggestions, setSuggestions] = useState([]);

  const loadTeams = async () => {
    const { data } = await supabase.from("teams").select("*");
    const m = {};
    (data || []).forEach((t) => (m[t.id] = t));
    setTeamsMap(m);
  };
  const TeamMini = ({ id }) => {
    const t = teamsMap[id] || {};
    const src = t.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-1">
        <img src={src} alt={id} className="h-5 w-5 rounded-full object-contain" />
        <span className="font-mono font-semibold">{id}</span>
      </span>
    );
  };

  const loadBasics = async () => {
    await loadTeams();
    const { data: gs } = await supabase
      .from("games")
      .select("*")
      .eq("week", week)
      .order("start_time");
    setGames(gs || []);

    const ids = (gs || []).map((g) => g.id);
    const { data: pk } = await supabase
      .from("picks")
      .select("*")
      .eq("user_id", session.user.id);
    setPicks(pk || []);

    if (ids.length) {
      const { data } = await supabase
        .from("odds")
        .select(
          "game_id, spread_home, spread_away, ml_home, ml_away, fetched_at"
        )
        .in("game_id", ids)
        .order("fetched_at", { ascending: false });
      const by = {};
      for (const row of data || []) {
        if (!by[row.game_id]) by[row.game_id] = { last: row, prev: null };
        else if (!by[row.game_id].prev) by[row.game_id].prev = row;
      }
      setOddsPairs(by);
    } else setOddsPairs({});
  };

  useEffect(() => {
    loadBasics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  useEffect(() => {
    // construir sugerencias
    const usedTeams = new Set((picks || []).map((x) => x.team_id));
    const list = [];
    for (const g of games || []) {
      const { last } = oddsPairs[g.id] || {};
      const score = (teamId) => {
        // metrica simple: moneyline más bajo -> mejor
        if (!last) return 0;
        const ml =
          teamId === g.home_team ? last.ml_home ?? 9999 : last.ml_away ?? 9999;
        return -ml; // más alto mejor (más favorito)
      };
      const a = g.away_team;
      const h = g.home_team;
      const aAllowed =
        DateTime.fromISO(g.start_time) > DateTime.now() && !usedTeams.has(a);
      const hAllowed =
        DateTime.fromISO(g.start_time) > DateTime.now() && !usedTeams.has(h);
      if (aAllowed) list.push({ game: g, teamId: a, s: score(a) });
      if (hAllowed) list.push({ game: g, teamId: h, s: score(h) });
    }
    list.sort((x, y) => y.s - x.s);
    setSuggestions(list.slice(0, 6));
  }, [games, oddsPairs, picks]);

  const autopickMe = async () => {
    try {
      const url = `${SITE}/api/autopickOne?week=${week}&user_id=${encodeURIComponent(
        session.user.id
      )}&token=${encodeURIComponent(CRON_TOKEN)}`;
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || "Error autopick");
      alert("Listo: se aplicó autopick para ti.");
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Asistente</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Semana</label>
          <select
            className="border p-1 rounded-lg"
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
      </div>

      <p className="text-sm text-gray-600 mt-2">
        Sugerencias basadas en momios (moneyline) y equipos no usados. Puedes
        aplicar Autopick para elegir al favorito más fuerte disponible.
      </p>

      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        {suggestions.map((s, idx) => (
          <div key={idx} className="p-3 border rounded-xl">
            <div className="flex items-center justify-between">
              <div className="text-sm flex items-center gap-2">
                <TeamMini id={s.teamId} />
                <span className="text-gray-400">en</span>
                <span className="font-mono">
                  {s.teamId === s.game.away_team
                    ? s.game.home_team
                    : s.game.away_team}
                </span>
              </div>
              <div className="text-xs text-gray-600">
                Kickoff: {toLocal(s.game.start_time)}
              </div>
            </div>
          </div>
        ))}
        {suggestions.length === 0 && (
          <div className="text-sm text-gray-500">No hay sugerencias.</div>
        )}
      </div>

      <div className="mt-4">
        <button className="px-4 py-2 rounded border" onClick={autopickMe}>
          Autopick para mí
        </button>
      </div>
    </div>
  );
}

/* ========================= Noticias ========================= */
function NewsTab() {
  const [q, setQ] = useState("");
  const [team, setTeam] = useState("");
  const open = () => {
    const term = (team || q || "NFL").trim();
    const url = `https://news.google.com/search?q=${encodeURIComponent(
      term + " NFL"
    )}&hl=es-419&gl=MX&ceid=MX:es-419`;
    window.open(url, "_blank", "noopener,noreferrer");
  };
  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-bold">Noticias</h1>
      <p className="text-sm text-gray-600 mt-2">
        Busca noticias por equipo o término (se abre Google News en una pestaña).
      </p>
      <div className="mt-4 grid sm:grid-cols-3 gap-2">
        <input
          className="border p-2 rounded-lg"
          placeholder="Equipo (e.g., DAL)"
          value={team}
          onChange={(e) => setTeam(e.target.value)}
        />
        <input
          className="border p-2 rounded-lg"
          placeholder="Búsqueda libre (opcional)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="px-4 py-2 rounded border" onClick={open}>
          Abrir noticias
        </button>
      </div>
    </div>
  );
}

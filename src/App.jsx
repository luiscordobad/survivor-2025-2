// src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { supabase } from "./lib/supabaseClient";
import Rules from "./Rules";

/* ========================= Config ========================= */
const TZ = import.meta.env.VITE_TZ || "America/Mexico_City";
const SITE = import.meta.env.VITE_SITE_URL || "";
const CRON_TOKEN = import.meta.env.VITE_CRON_TOKEN || "";
const LEAGUE = import.meta.env.VITE_LEAGUE_NAME || "Survivor 2025";
const SEASON = 2025;

/* ========================= Utils ========================= */
const clsx = (...xs) => xs.filter(Boolean).join(" ");
const toLocal = (iso) =>
  DateTime.fromISO(iso).setZone(TZ).toFormat("EEE dd LLL HH:mm");

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

function winProbFromSpread(spreadForTeam) {
  if (spreadForTeam == null) return null;
  const k = 0.23; // curva logística suave
  const p = 1 / (1 + Math.exp(-k * (-spreadForTeam)));
  return Math.round(p * 100);
}

/* ========================= Sesión/Login ========================= */
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
  const [tab, setTab] = useState("password"); // 'password' | 'magic'
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [signup, setSignup] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const doPassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (signup) {
        const { error } = await supabase.auth.signUp({
          email,
          password: pwd,
          options: { emailRedirectTo: SITE || window.location.origin },
        });
        if (error) throw error;
        alert("Cuenta creada. Revisa tu correo para confirmar.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: pwd,
        });
        if (error) throw error;
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doMagic = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: SITE || window.location.origin },
    });
    if (!error) setSent(true);
    else alert(error.message);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-6">
      <div className="w-full max-w-md border rounded-2xl p-6 bg-white">
        <h1 className="text-2xl font-extrabold text-center">{LEAGUE}</h1>
        <div className="mt-4 flex gap-2 justify-center">
          <button
            className={clsx(
              "px-3 py-1 rounded border",
              tab === "password" && "bg-black text-white"
            )}
            onClick={() => setTab("password")}
          >
            Email + Password
          </button>
          <button
            className={clsx(
              "px-3 py-1 rounded border",
              tab === "magic" && "bg-black text-white"
            )}
            onClick={() => setTab("magic")}
          >
            Magic link
          </button>
        </div>

        {tab === "password" && (
          <form onSubmit={doPassword} className="mt-4 space-y-3">
            <div className="text-sm flex justify-between">
              <span>{signup ? "Crear cuenta" : "Iniciar sesión"}</span>
              <button
                type="button"
                className="underline"
                onClick={() => setSignup(!signup)}
              >
                {signup ? "¿Ya tienes cuenta? Inicia" : "¿No tienes cuenta? Regístrate"}
              </button>
            </div>
            <input
              className="border p-2 w-full rounded-lg"
              placeholder="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              className="border p-2 w-full rounded-lg"
              placeholder="contraseña"
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              required
            />
            <button
              className="bg-black text-white w-full py-2 rounded-lg disabled:opacity-60"
              disabled={busy}
            >
              {signup ? "Crear cuenta" : "Entrar"}
            </button>
          </form>
        )}

        {tab === "magic" && (
          <form onSubmit={doMagic} className="mt-4 space-y-3">
            <input
              className="border p-2 w-full rounded-lg"
              placeholder="tu@email.com"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button className="bg-black text-white w-full py-2 rounded-lg">
              Enviar magic link
            </button>
            {sent && <p className="text-xs text-gray-500">Revisa tu correo.</p>}
          </form>
        )}
      </div>
    </div>
  );
}

/* ========================= Root con tabs ========================= */
export default function AppRoot() {
  const session = useSession();
  const [view, setView] = useState("game"); // game | assistant | news | standings | rules

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
  }, []);

  if (!session) return <Login />;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="w-full border-b bg-white sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-2">
          {["game", "assistant", "news", "standings", "rules"].map((t) => (
            <button
              key={t}
              className={clsx(
                "text-sm px-3 py-1 rounded",
                view === t ? "bg-black text-white" : "border"
              )}
              onClick={() => setView(t)}
            >
              {t === "game"
                ? "Partidos"
                : t === "assistant"
                ? "Asistente"
                : t === "news"
                ? "Noticias"
                : t === "standings"
                ? "Standings"
                : "Reglas"}
            </button>
          ))}
          <div className="ml-auto">
            <button className="text-sm underline" onClick={() => supabase.auth.signOut()}>
              Salir
            </button>
          </div>
        </div>
      </div>

      {view === "game" && <AppAuthed session={session} />}
      {view === "assistant" && <AssistantTab session={session} />}
      {view === "news" && <NewsTab />}
      {view === "standings" && <NFLStandingsTab />}
      {view === "rules" && <Rules />}
    </div>
  );
}

/* ========================= PARTIDOS ========================= */
function AppAuthed({ session }) {
  const [me, setMe] = useState(null);
  const [week, setWeek] = useState(() => Number(localStorage.getItem("week")) || 1);

  const [teamsMap, setTeamsMap] = useState({});
  const [games, setGames] = useState([]);
  const [oddsPairs, setOddsPairs] = useState({});
  const [picks, setPicks] = useState([]);
  const [standings, setStandings] = useState([]);

  const [leaguePicks, setLeaguePicks] = useState([]);
  const [userNames, setUserNames] = useState({});
  const [popularity, setPopularity] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [pendingPick, setPendingPick] = useState(null);

  const [dayFilter, setDayFilter] = useState(localStorage.getItem("dayFilter") || "ALL");
  const [teamQuery, setTeamQuery] = useState(localStorage.getItem("teamQuery") || "");
  const searchRef = useRef(null);

  // Realtime: picks/games/odds
  useEffect(() => {
    const ch = supabase
      .channel("realtime-app")
      .on("postgres_changes", { event: "*", schema: "public", table: "picks" }, () => {
        loadLeaguePicks(week);
        loadMyPicks();
        setLastUpdated(new Date().toISOString());
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "games" }, () => {
        loadGames(week);
        setLastUpdated(new Date().toISOString());
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "odds" }, () => {
        loadGames(week);
        setLastUpdated(new Date().toISOString());
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  /* ---------- loads ---------- */
  const loadTeams = async () => {
    const { data: ts } = await supabase.from("teams").select("*");
    const map = {};
    (ts || []).forEach((t) => (map[t.id] = t));
    setTeamsMap(map);
  };

  const loadGames = async (w) => {
    const { data: gs } = await supabase
      .from("games")
      .select("*")
      .eq("week", w)
      .eq("season", SEASON)
      .order("start_time");
    setGames(gs || []);

    const ids = (gs || []).map((g) => g.id);
    if (ids.length) {
      const { data } = await supabase
        .from("odds")
        .select("game_id,spread_home,spread_away,ml_home,ml_away,fetched_at")
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

  const loadMyPicks = async () => {
    const { data: pk } = await supabase
      .from("picks")
      .select("*")
      .eq("user_id", session.user.id)
      .eq("season", SEASON);
    setPicks(pk || []);
  };

  const loadLeaguePicks = async (w) => {
    const { data: pks } = await supabase
      .from("picks")
      .select("id,user_id,team_id,result,auto_pick,updated_at,week,season")
      .eq("week", w)
      .eq("season", SEASON);
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

    let totalPlayers = 0;
    try {
      const { count } = await supabase
        .from("profiles")
        .select("*", { count: "exact", head: true });
      totalPlayers = count || 0;
    } catch {
      const { data: std } = await supabase.from("standings").select("user_id");
      totalPlayers = std?.length || 0;
    }

    const counts = {};
    (pks || []).forEach((x) => {
      if (x.team_id) counts[x.team_id] = (counts[x.team_id] || 0) + 1;
    });
    const list = Object.entries(counts)
      .map(([team_id, count]) => ({
        team_id,
        count,
        pct: totalPlayers ? Math.round((count * 100) / totalPlayers) : 0,
      }))
      .sort((a, b) => b.count - a.count);
    setPopularity(list);
  };

  const loadStandings = async () => {
    const { data } = await supabase.from("standings").select("*");
    setStandings(data || []);
  };

  const initAll = async () => {
    // perfil
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
    await loadGames(week);
    await loadMyPicks();
    await loadLeaguePicks(week);
    await loadStandings();
    setLastUpdated(new Date().toISOString());
  };

  useEffect(() => {
    initAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadGames(week);
    loadLeaguePicks(week);
    localStorage.setItem("week", String(week));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  // Auto-refresh si hay juegos en vivo
  useEffect(() => {
    const anyLive = (games || []).some((g) => g.status === "in_progress");
    if (!anyLive) return;
    const id = setInterval(() => loadGames(week), 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, week]);

  useEffect(() => localStorage.setItem("dayFilter", dayFilter), [dayFilter]);
  useEffect(() => localStorage.setItem("teamQuery", teamQuery), [teamQuery]);

  /* ---------- helpers picks/alertas ---------- */
  const myPickThisWeek = useMemo(
    () => (picks || []).find((p) => p.week === week && p.season === SEASON),
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

  /** Lock reforzado:
   *  - Crear/cambiar pick solo si el juego NO ha iniciado.
   *  - Si ya tienes pick y ese partido ya inició/terminó -> no se puede cambiar.
   *  - Si tu pick aún no inicia, puedes cambiarlo a otro partido futuro.
   */
  const canPick = (g, team) => {
    const nowStarted = DateTime.fromISO(g.start_time) <= DateTime.now();
    if (nowStarted) return { ok: false, reason: "LOCK_GAME_STARTED" };

    const used = (picks || []).some(
      (p) => p.team_id === team && p.user_id === session.user.id && p.week !== week
    );
    if (used) return { ok: false, reason: "TEAM_USED" };

    if (!myPickThisWeek) return { ok: true };

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
          LOCK_GAME_STARTED: "Este partido ya está bloqueado (kickoff iniciado).",
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
        season: SEASON,
      });
      if (error) return alert(error.message);
    }
    await loadMyPicks();
    await loadLeaguePicks(week);
    const { data: st } = await supabase.from("standings").select("*");
    setStandings(st || []);
    setPendingPick(null);
  };

  /* ---------- UI helpers ---------- */
  const TeamMini = ({ id }) => {
    const logo = teamsMap[id]?.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-1">
        <img
          src={logo}
          alt={id}
          className="h-5 w-5 object-contain"
          onError={(e) => (e.currentTarget.style.visibility = "hidden")}
        />
        <span className="font-mono font-semibold">{id}</span>
      </span>
    );
  };

  const TeamChip = ({ id }) => {
    const t = teamsMap[id] || {};
    const logo = t.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-2">
        <img
          src={logo}
          alt={id}
          className="h-6 w-6 object-contain"
          onError={(e) => (e.currentTarget.style.visibility = "hidden")}
        />
        <span className="font-medium">{t.name || id}</span>
      </span>
    );
  };

  const ScoreStrip = ({ g }) => {
    const score = (
      <div className="flex items-center gap-4">
        <div className="text-lg font-bold">
          {g.away_team} <span className="tabular-nums">{g.away_score ?? 0}</span>
        </div>
        <div className="text-gray-300">—</div>
        <div className="text-lg font-bold">
          {g.home_team} <span className="tabular-nums">{g.home_score ?? 0}</span>
        </div>
      </div>
    );
    const liveBits = (
      <div className="text-xs flex items-center gap-2">
        {g.period != null && (
          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900">
            Q{g.period} {g.clock || ""}
          </span>
        )}
        {g.down != null && g.distance != null && (
          <span className="px-2 py-0.5 rounded bg-gray-100">
            {g.down}&amp;{g.distance}
          </span>
        )}
        {g.yard_line && (
          <span className="px-2 py-0.5 rounded bg-gray-100">@{g.yard_line}</span>
        )}
        {g.possession && (
          <span className="px-2 py-0.5 rounded bg-gray-100">⬤ {g.possession}</span>
        )}
        {g.red_zone && (
          <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800">
            Red Zone
          </span>
        )}
      </div>
    );

    if (g.status === "final")
      return (
        <div className="flex items-center justify-between">
          {score}
          <span className="text-xs px-2 py-0.5 rounded bg-gray-100">FINAL</span>
        </div>
      );
    if (g.status === "in_progress")
      return (
        <div className="flex items-center justify-between">
          {score}
          {liveBits}
        </div>
      );
    return (
      <div className="flex items-center justify-between">
        {score}
        <span className="text-xs px-2 py-0.5 rounded bg-gray-100">
          Kickoff en <Countdown iso={g.start_time} />
        </span>
      </div>
    );
  };

  const TeamBox = ({ game, teamId }) => {
    const allowed = canPick(game, teamId).ok;
    const selected =
      myPickThisWeek?.game_id === game.id && myPickThisWeek?.team_id === teamId;
    const { last } = oddsPairs[game.id] || {};
    const fav =
      last &&
      ((teamId === game.home_team &&
        ((last.spread_home ?? 0) < (last.spread_away ?? 0) ||
          (last.ml_home ?? 9999) < (last.ml_away ?? 9999))) ||
        (teamId === game.away_team &&
          ((last.spread_away ?? 0) < (last.spread_home ?? 0) ||
            (last.ml_away ?? 9999) < (last.ml_home ?? 9999))));
    const pct = popPct(teamId);
    return (
      <button
        onClick={() => confirmPick(game, teamId)}
        disabled={!allowed}
        className={clsx(
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
      return id.toLowerCase().includes(q) || (t?.name || "").toLowerCase().includes(q);
    };
    return (gamesByDay || []).filter(
      (g) => match(g.away_team) || match(g.home_team)
    );
  }, [gamesByDay, teamQuery, teamsMap]);

  /* ========================= Render ========================= */
  const nextKick = nextKickoffISO;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{LEAGUE}</h1>
          {lastUpdated && (
            <p className="text-xs text-gray-500">
              Actualizado: {DateTime.fromISO(lastUpdated).setZone(TZ).toFormat("dd LLL HH:mm:ss")}
            </p>
          )}
        </div>
        <div className="text-sm text-gray-700">
          Hola, <b>{me?.display_name}</b> · Vidas:{" "}
          <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
            {me?.lives}
          </span>
        </div>
      </header>

      {showPickAlert && (
        <div className="mt-3 p-3 border-2 border-red-300 rounded-xl bg-red-50 text-red-900 text-sm">
          🔔 Aún no tienes pick en W{week}. El primer kickoff es en{" "}
          <b>
            <Countdown iso={nextKick} />
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
                  className={clsx(
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

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="text-xs px-3 py-1 rounded border"
              onClick={() =>
                downloadCSV("mis_picks.csv", [
                  ["week", "team_id", "result", "auto_pick", "updated_at"],
                  ...(picks || []).map((p) => [
                    p.week,
                    p.team_id,
                    p.result,
                    p.auto_pick,
                    p.updated_at,
                  ]),
                ])
              }
            >
              Exportar mis picks (CSV)
            </button>
            <button
              className="text-xs px-3 py-1 rounded border"
              onClick={() =>
                downloadCSV("standings.csv", [
                  ["player", "lives", "wins", "losses", "pushes", "margin_sum"],
                  ...(standings || []).map((s) => [
                    s.display_name,
                    s.lives,
                    s.wins,
                    s.losses,
                    s.pushes,
                    s.margin_sum,
                  ]),
                ])
              }
            >
              Exportar standings (CSV)
            </button>
          </div>
        </div>

        <div className="md:col-span-2 p-4 border rounded-2xl bg-white">
          <h3 className="font-semibold">Resumen</h3>
          <p className="text-sm text-gray-600">
            Picks y popularidad se actualizan en tiempo real. Lock “rolling” por partido.
          </p>
        </div>
      </section>

      {/* Partidos */}
      <section className="mt-4 p-4 border rounded-2xl bg-white">
        <h2 className="font-semibold mb-3">Partidos W{week}</h2>
        <div className="space-y-3">
          {gamesFiltered.map((g) => {
            const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
            const { last } = oddsPairs[g.id] || {};
            const spreadHome = last?.spread_home ?? null;
            const spreadAway = last?.spread_away ?? null;
            const mlHome = last?.ml_home ?? null;
            const mlAway = last?.ml_away ?? null;
            const wpHome =
              winProbFromSpread(spreadHome) ?? null;
            const wpAway =
              winProbFromSpread(-spreadHome) ?? (wpHome != null ? 100 - wpHome : null);

            return (
              <div key={g.id} className={clsx("p-4 border rounded-xl", locked && "opacity-60")}>
                <div className="flex items-center justify-between">
                  <div className="text-sm flex items-center gap-2 flex-wrap">
                    <TeamChip id={g.away_team} />
                    <span className="mx-1 text-gray-400">@</span>
                    <TeamChip id={g.home_team} />
                  </div>
                  <div className="text-xs text-gray-600">
                    <span className="px-1.5 py-0.5 rounded bg-gray-100">
                      {toLocal(g.start_time)}
                    </span>{" "}
                    · Lock: <Countdown iso={g.start_time} />
                  </div>
                </div>

                <div className="mt-3">
                  <ScoreStrip g={g} />
                </div>

                <div className="mt-2 text-xs text-gray-700 flex gap-3 flex-wrap">
                  {spreadHome != null && (
                    <span className="px-2 py-0.5 rounded bg-gray-50 border">
                      Spread: {g.home_team} {spreadHome > 0 ? `+${spreadHome}` : spreadHome},{" "}
                      {g.away_team} {spreadAway > 0 ? `+${spreadAway}` : spreadAway}
                    </span>
                  )}
                  {mlHome != null && mlAway != null && (
                    <span className="px-2 py-0.5 rounded bg-gray-50 border">
                      ML: {g.home_team} {mlHome}, {g.away_team} {mlAway}
                    </span>
                  )}
                  {(wpHome != null || wpAway != null) && (
                    <span className="px-2 py-0.5 rounded bg-gray-50 border">
                      Win%: {g.home_team} {wpHome ?? "—"}% · {g.away_team} {wpAway ?? "—"}%
                    </span>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TeamBox game={g} teamId={g.home_team} />
                  <TeamBox game={g} teamId={g.away_team} />
                </div>
              </div>
            );
          })}
          {(!gamesFiltered || gamesFiltered.length === 0) && (
            <div className="text-sm text-gray-500">No hay partidos con este filtro/búsqueda.</div>
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
                      (userNames[a.user_id] || "").localeCompare(userNames[b.user_id] || "")
                    )
                    .map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="py-1.5">{userNames[p.user_id] || p.user_id.slice(0, 6)}</td>
                        <td>
                          <TeamMini id={p.team_id} />
                        </td>
                        <td>
                          <span
                            className={
                              p.result === "win"
                                ? "text-emerald-700 font-semibold"
                                : p.result === "loss"
                                ? "text-red-600 font-semibold"
                                : p.result === "push"
                                ? "text-gray-600"
                                : "text-gray-500"
                            }
                          >
                            {p.result || "-"}
                          </span>
                        </td>
                        <td>{p.auto_pick ? "Sí" : "No"}</td>
                        <td className="text-xs text-gray-500">
                          {p.updated_at
                            ? DateTime.fromISO(p.updated_at).setZone(TZ).toFormat("dd LLL HH:mm")
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
          <p className="text-xs text-gray-600">Porcentaje de jugadores que pickearon ese equipo.</p>
          <div className="mt-3 space-y-2">
            {(popularity || []).length > 0 ? (
              popularity.map((row) => (
                <div key={row.team_id}>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <TeamMini id={row.team_id} /> <span className="text-gray-500">({row.count})</span>
                    </div>
                    <span className="text-gray-700 text-base font-semibold">{row.pct}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded mt-1">
                    <div className="h-2 rounded bg-black" style={{ width: `${row.pct}%` }} />
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-500">Sin picks registrados.</div>
            )}
          </div>
        </div>
      </section>

      {/* Historial usuario */}
      <section className="mt-6">
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
                  .filter((p) => p.season === SEASON)
                  .sort((a, b) => a.week - b.week)
                  .map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="py-1.5">{p.week}</td>
                      <td>
                        <TeamMini id={p.team_id} />
                      </td>
                      <td>
                        <span
                          className={
                            p.result === "win"
                              ? "text-emerald-700 font-semibold"
                              : p.result === "loss"
                              ? "text-red-600 font-semibold"
                              : p.result === "push"
                              ? "text-gray-600"
                              : "text-gray-500"
                          }
                        >
                          {p.result || "pending"}
                        </span>
                      </td>
                    </tr>
                  ))}
                {(!picks || picks.length === 0) && (
                  <tr>
                    <td className="py-2 text-gray-500" colSpan={3}>
                      Sin picks aún.
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
              <button className="px-4 py-2 rounded border" onClick={() => setPendingPick(null)}>
                Cancelar
              </button>
              <button className="px-4 py-2 rounded bg-black text-white" onClick={doPick}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {!myPickThisWeek && nextKick && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded-xl bg-black text-white text-sm shadow-lg">
          Recuerda elegir: kickoff en <Countdown iso={nextKick} />
        </div>
      )}
    </div>
  );
}

/* ========================= Asistente de Picks ========================= */
function AssistantTab({ session }) {
  const [teams, setTeams] = useState({});
  const [games, setGames] = useState([]);
  const [odds, setOdds] = useState({});
  const [picks, setPicks] = useState([]);
  const [week, setWeek] = useState(() => Number(localStorage.getItem("week")) || 1);
  const [pop, setPop] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    localStorage.setItem("week", String(week));
  }, [week]);

  useEffect(() => {
    (async () => {
      const { data: ts } = await supabase.from("teams").select("*");
      const map = {};
      (ts || []).forEach((t) => (map[t.id] = t));
      setTeams(map);

      const { data: gs } = await supabase
        .from("games")
        .select("*")
        .eq("week", week)
        .eq("season", SEASON)
        .order("start_time");
      setGames(gs || []);

      const ids = (gs || []).map((g) => g.id);
      if (ids.length) {
        const { data } = await supabase
          .from("odds")
          .select("game_id,spread_home,spread_away,ml_home,ml_away,fetched_at")
          .in("game_id", ids)
          .order("fetched_at", { ascending: false });
        const by = {};
        for (const row of data || []) if (!by[row.game_id]) by[row.game_id] = row;
        setOdds(by);
      }

      const { data: pk } = await supabase
        .from("picks")
        .select("*")
        .eq("user_id", session.user.id)
        .eq("season", SEASON);
      setPicks(pk || []);

      const { data: lp } = await supabase
        .from("picks")
        .select("team_id")
        .eq("week", week)
        .eq("season", SEASON);
      const counts = {};
      (lp || []).forEach((p) => (counts[p.team_id] = (counts[p.team_id] || 0) + 1));
      let total = 0;
      try {
        const { count } = await supabase
          .from("profiles")
          .select("*", { count: "exact", head: true });
        total = count || 0;
      } catch {
        const { data: st } = await supabase.from("standings").select("user_id");
        total = st?.length || 0;
      }
      const list = Object.entries(counts).map(([team, count]) => ({
        team,
        pct: total ? Math.round((count * 100) / total) : 0,
      }));
      setPop(list);
    })();
  }, [week, session.user.id]);

  const used = new Set((picks || []).map((p) => p.team_id));
  const getPop = (team) => pop.find((x) => x.team === team)?.pct ?? 0;

  const rows = (games || [])
    .map((g) => {
      const o = odds[g.id] || {};
      const sHome = o.spread_home;
      const wpHome = winProbFromSpread(sHome) ?? 50;
      const wpAway = winProbFromSpread(-sHome) ?? 50;
      return [
        {
          game: g,
          team: g.home_team,
          vs: g.away_team,
          wp: wpHome,
          pop: getPop(g.home_team),
          used: used.has(g.home_team),
        },
        {
          game: g,
          team: g.away_team,
          vs: g.home_team,
          wp: wpAway,
          pop: getPop(g.away_team),
          used: used.has(g.away_team),
        },
      ];
    })
    .flat();

  const ranked = rows
    .map((r) => ({
      ...r,
      score: (r.wp || 50) + (100 - (r.pop || 0)) + (r.used ? -30 : 10),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const confirm = async (r) => {
    setBusy(true);
    try {
      // misma regla de lock: solo si no ha iniciado
      if (DateTime.fromISO(r.game.start_time) <= DateTime.now()) {
        throw new Error("El partido ya inició (lock).");
      }
      const { error } = await supabase.from("picks").insert({
        user_id: session.user.id,
        game_id: r.game.id,
        team_id: r.team,
        week,
        season: SEASON,
      });
      if (error) throw error;
      alert("Pick guardado");
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const TeamMiniSimple = ({ id }) => {
    const logo = teams[id]?.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-1">
        <img
          src={logo}
          alt={id}
          className="h-5 w-5 object-contain"
          onError={(e) => (e.currentTarget.style.visibility = "hidden")}
        />
        <span className="font-mono font-semibold">{id}</span>
      </span>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-extrabold">Asistente de picks</h1>
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
      </header>

      <p className="text-sm text-gray-600 mt-1">
        Ranking por Win% (spread), diferencial de popularidad y si te queda disponible.
      </p>

      <div className="mt-4 grid md:grid-cols-2 gap-3">
        {ranked.map((r, i) => (
          <div key={i} className="border rounded-xl p-3 bg-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TeamMiniSimple id={r.team} />
                <span className="text-xs text-gray-500">vs {r.vs}</span>
              </div>
              <span className="text-xs text-gray-500">W{r.game.week}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 text-sm">
              <div>
                <div className="text-xs text-gray-500">Win%</div>
                <div className="text-base font-bold">{r.wp ?? "—"}%</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Popularidad</div>
                <div className="text-base">{r.pop}%</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Disponible</div>
                <div className="text-base">{r.used ? "No" : "Sí"}</div>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                disabled={busy || r.used}
                className="px-3 py-1 rounded border disabled:opacity-50"
                onClick={() => confirm(r)}
              >
                Elegir
              </button>
              <span className="ml-auto text-xs text-gray-500">
                Score {Math.round(r.score)}
              </span>
            </div>
          </div>
        ))}
        {ranked.length === 0 && (
          <div className="text-sm text-gray-500">Sin sugerencias disponibles.</div>
        )}
      </div>
    </div>
  );
}

/* ========================= Noticias ========================= */
function NewsTab() {
  const [team, setTeam] = useState("");
  const [teams, setTeams] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async (t) => {
    setLoading(true);
    let q = supabase
      .from("news")
      .select("*")
      .order("published_at", { ascending: false })
      .limit(30);
    if (t) q = q.eq("team_id", t);
    const { data } = await q;
    setItems(data || []);
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      const { data: ts } = await supabase.from("teams").select("id,name").order("id");
      setTeams(ts || []);
      await load("");
    })();
  }, []);

  useEffect(() => {
    load(team);
  }, [team]);

  const syncNow = async (scopeTeam) => {
    const url = scopeTeam
      ? `${SITE}/api/control?action=syncNews&team=${encodeURIComponent(
          scopeTeam
        )}&token=${encodeURIComponent(CRON_TOKEN)}`
      : `${SITE}/api/control?action=syncNews&token=${encodeURIComponent(CRON_TOKEN)}`;
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) return alert(j.error || "Error sincronizando");
    await load(team);
    alert(`Noticias sincronizadas (${j.inserted || 0})`);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-extrabold">Noticias</h1>
        <div className="flex items-center gap-2">
          <select
            className="border p-1 rounded-lg"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
            <option value="">Generales</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} — {t.name}
              </option>
            ))}
          </select>
          <button className="text-xs px-2 py-1 rounded border" onClick={() => syncNow("")}>
            Sync general
          </button>
          {team && (
            <button className="text-xs px-2 py-1 rounded border" onClick={() => syncNow(team)}>
              Sync {team}
            </button>
          )}
        </div>
      </header>

      {loading && <p className="mt-3 text-sm text-gray-500">Cargando…</p>}

      <ul className="mt-4 space-y-3">
        {(items || []).map((n) => (
          <li key={n.id} className="p-3 border rounded-xl bg-white">
            <div className="text-xs text-gray-500 flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-gray-100">{n.team_id || "NFL"}</span>
              <span>{n.source || "ESPN"}</span>
              <span>
                ·{" "}
                {n.published_at
                  ? DateTime.fromISO(n.published_at).setZone(TZ).toFormat("dd LLL HH:mm")
                  : ""}
              </span>
            </div>
            <a href={n.url} target="_blank" rel="noreferrer" className="block mt-1 font-medium underline">
              {n.title}
            </a>
          </li>
        ))}
        {(items || []).length === 0 && !loading && (
          <p className="text-sm text-gray-500">Sin noticias.</p>
        )}
      </ul>
    </div>
  );
}

/* ========================= Standings NFL (Conferencia/División) ========================= */
function NFLStandingsTab() {
  const [teams, setTeams] = useState({});
  const [rows, setRows] = useState([]); // [{team_id, conf, div, w,l,t,pct,pf,pa,diff,streak}]
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // equipos
      const { data: ts } = await supabase.from("teams").select("id,name,conference,division,logo_url");
      const map = {};
      (ts || []).forEach((t) => (map[t.id] = t));
      setTeams(map);

      // intento 1: tabla/vista nfl_standings
      let tableOk = false;
      try {
        const { data: s1, error } = await supabase
          .from("nfl_standings")
          .select("*")
          .eq("season", SEASON);
        if (!error && s1 && s1.length) {
          tableOk = true;
          setRows(
            s1.map((r) => ({
              team_id: r.team_id,
              conf: r.conference || map[r.team_id]?.conference || "",
              div: r.division || map[r.team_id]?.division || "",
              w: r.w,
              l: r.l,
              t: r.t || 0,
              pct: r.pct,
              pf: r.pf ?? null,
              pa: r.pa ?? null,
              diff: (r.pf ?? 0) - (r.pa ?? 0),
              streak: r.streak || "",
            }))
          );
        }
      } catch {
        // noop
      }

      // intento 2: derivar desde games finalizados
      if (!tableOk) {
        const { data: gs } = await supabase
          .from("games")
          .select("home_team,away_team,home_score,away_score,status,season")
          .eq("season", SEASON);
        const agg = {};
        const ensure = (id) =>
          (agg[id] ||= {
            team_id: id,
            conf: map[id]?.conference || "",
            div: map[id]?.division || "",
            w: 0,
            l: 0,
            t: 0,
            pf: 0,
            pa: 0,
            streak: "",
            last5: [],
          });

        for (const g of gs || []) {
          if (g.status !== "final") continue;
          const h = ensure(g.home_team);
          const a = ensure(g.away_team);
          h.pf += g.home_score || 0;
          h.pa += g.away_score || 0;
          a.pf += g.away_score || 0;
          a.pa += g.home_score || 0;

          let hw = 0,
            aw = 0,
            tie = 0;
          if ((g.home_score || 0) > (g.away_score || 0)) hw = 1;
          else if ((g.home_score || 0) < (g.away_score || 0)) aw = 1;
          else tie = 1;
          h.w += hw;
          h.l += aw;
          h.t += tie;
          a.w += aw;
          a.l += hw;
          a.t += tie;

          h.last5.push(hw ? "W" : tie ? "T" : "L");
          a.last5.push(aw ? "W" : tie ? "T" : "L");
          h.last5 = h.last5.slice(-5);
          a.last5 = a.last5.slice(-5);
          h.streak = streakOf(h.last5);
          a.streak = streakOf(a.last5);
        }
        const list = Object.values(agg).map((r) => ({
          ...r,
          pct: r.w + r.l + r.t ? ((r.w + 0.5 * r.t) / (r.w + r.l + r.t)).toFixed(3) : "0.000",
          diff: (r.pf ?? 0) - (r.pa ?? 0),
        }));
        setRows(list);
      }
      setLoading(false);
    })();
  }, []);

  const groups = useMemo(() => {
    // { AFC: { East: [...], North: [...] }, NFC: { ... } }
    const byConf = {};
    for (const r of rows || []) {
      const c = r.conf || "Unknown";
      const d = r.div || "Other";
      byConf[c] ||= {};
      byConf[c][d] ||= [];
      byConf[c][d].push(r);
    }
    // ordenar por pct, diff
    for (const c of Object.keys(byConf)) {
      for (const d of Object.keys(byConf[c])) {
        byConf[c][d].sort((a, b) => {
          const pA = Number(a.pct);
          const pB = Number(b.pct);
          if (pB !== pA) return pB - pA;
          return (b.diff || 0) - (a.diff || 0);
        });
      }
    }
    return byConf;
  }, [rows]);

  const TeamMini = ({ id }) => {
    const logo = teams[id]?.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-1">
        <img
          src={logo}
          alt={id}
          className="h-5 w-5 object-contain"
          onError={(e) => (e.currentTarget.style.visibility = "hidden")}
        />
        <span className="font-mono font-semibold">{id}</span>
      </span>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-extrabold">Standings NFL {SEASON}</h1>
      {loading && <p className="text-sm text-gray-500 mt-2">Cargando standings…</p>}

      {!loading &&
        ["AFC", "NFC"].map((conf) => (
          <section key={conf} className="mt-6">
            <h2 className="font-bold text-lg mb-2">{conf}</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {["East", "North", "South", "West"].map((div) => (
                <div key={div} className="p-4 border rounded-2xl bg-white">
                  <h3 className="font-semibold mb-2">{div}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500">
                          <th>Equipo</th>
                          <th>W</th>
                          <th>L</th>
                          <th>T</th>
                          <th>Pct</th>
                          <th>Diff</th>
                          <th>Racha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(groups[conf]?.[div] || []).map((r) => (
                          <tr key={r.team_id} className="border-t">
                            <td className="py-1.5">
                              <TeamMini id={r.team_id} />
                            </td>
                            <td>{r.w}</td>
                            <td>{r.l}</td>
                            <td>{r.t || 0}</td>
                            <td>{String(r.pct).replace(/^0\./, ".")}</td>
                            <td>{r.diff ?? 0}</td>
                            <td className="text-xs text-gray-600">{r.streak || "-"}</td>
                          </tr>
                        ))}
                        {(groups[conf]?.[div] || []).length === 0 && (
                          <tr>
                            <td className="py-2 text-gray-500" colSpan={7}>
                              Sin datos.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

function streakOf(last5) {
  if (!last5 || last5.length === 0) return "";
  let cur = last5[last5.length - 1];
  let n = 0;
  for (let i = last5.length - 1; i >= 0; i--) {
    if (last5[i] === cur) n++;
    else break;
  }
  return `${cur}${n}`;
}

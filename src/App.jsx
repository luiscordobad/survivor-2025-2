// src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { supabase } from "./lib/supabaseClient";
import Rules from "./Rules";

/* ====== Config ====== */
const TZ = import.meta.env.VITE_TZ || "America/Mexico_City";
const SITE = import.meta.env.VITE_SITE_URL || "";
const CRON_TOKEN = import.meta.env.VITE_CRON_TOKEN || "";
const LEAGUE = import.meta.env.VITE_LEAGUE_NAME || "Survivor 2025";

/* ====== Utils ====== */
function clsx(...xs) {
  return xs.filter(Boolean).join(" ");
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
// Win prob aproximada desde spread (curva logística)
function winProbFromSpread(spreadForTeam) {
  if (spreadForTeam == null) return null;
  const k = 0.23; // pendiente aproximada
  const p = 1 / (1 + Math.exp(-k * (-spreadForTeam))); // spread negativo favorece al equipo
  return Math.round(p * 100);
}

/* ====== Sesión ====== */
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

/* ====== Login ====== */
function Login() {
  const [tab, setTab] = useState("password"); // password | magic
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
          options: {
            emailRedirectTo: SITE || window.location.origin,
          },
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

/* ====== App con tabs ====== */
export default function AppRoot() {
  const session = useSession();
  const [view, setView] = useState("game"); // game | rules

  if (!session) return <Login />;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="w-full border-b bg-white sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-2">
          <button
            className={clsx(
              "text-sm px-3 py-1 rounded",
              view === "game" ? "bg-black text-white" : "border"
            )}
            onClick={() => setView("game")}
          >
            Partidos
          </button>
          <button
            className={clsx(
              "text-sm px-3 py-1 rounded",
              view === "rules" ? "bg-black text-white" : "border"
            )}
            onClick={() => setView("rules")}
          >
            Reglas
          </button>
        </div>
      </div>
      {view === "game" ? <AppAuthed session={session} /> : <Rules />}
    </div>
  );
}

/* ====== AppAuthed ====== */
function AppAuthed({ session }) {
  const [me, setMe] = useState(null);
  const [week, setWeek] = useState(() => Number(localStorage.getItem("week")) || 1);

  const [games, setGames] = useState([]);
  const [teamsMap, setTeamsMap] = useState({});
  const [oddsPairs, setOddsPairs] = useState({});

  const [picks, setPicks] = useState([]);
  const [standings, setStandings] = useState([]);

  const [leaguePicks, setLeaguePicks] = useState([]);
  const [userNames, setUserNames] = useState({});
  const [popularity, setPopularity] = useState([]);

  const [pendingPick, setPendingPick] = useState(null); // {game, teamId}
  const [showStats, setShowStats] = useState(null); // {game}

  const [dayFilter, setDayFilter] = useState(localStorage.getItem("dayFilter") || "ALL");
  const [teamQuery, setTeamQuery] = useState(localStorage.getItem("teamQuery") || "");
  const searchRef = useRef(null);

  useEffect(() => {
    const anyLive = (games || []).some((g) => g.status === "in_progress");
    if (!anyLive) return;
    const id = setInterval(() => loadGames(week), 30000);
    return () => clearInterval(id);
  }, [games, week]);

  /* ---- Carga base ---- */
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
      .order("start_time");
    setGames(gs || []);

    const ids = (gs || []).map((g) => g.id);
    if (ids.length) {
      const { data } = await supabase
        .from("odds")
        .select("game_id, spread_home, spread_away, ml_home, ml_away, fetched_at")
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

  const loadLeaguePicks = async (w) => {
    const { data: pks } = await supabase
      .from("picks")
      .select("id,user_id,team_id,result,auto_pick,updated_at,week")
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

    const { data: total } = await supabase.from("standings").select("user_id");
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

    const { data: st } = await supabase.from("standings").select("*");
    setStandings(st || []);

    await loadGames(week);
    await loadLeaguePicks(week);
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
  useEffect(() => localStorage.setItem("dayFilter", dayFilter), [dayFilter]);
  useEffect(() => localStorage.setItem("teamQuery", teamQuery), [teamQuery]);

  /* ---- helpers ---- */
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

  const canPick = (g, team) => {
    const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
    if (locked) return { ok: false, reason: "LOCK" };
    const used = (picks || []).some(
      (p) => p.team_id === team && p.user_id === session.user.id
    );
    if (used && !(myPickThisWeek && myPickThisWeek.team_id === team))
      return { ok: false, reason: "USED" };
    return { ok: true };
  };

  const confirmPick = (game, teamId) => {
    const c = canPick(game, teamId);
    if (!c.ok)
      return alert(
        c.reason === "LOCK" ? "Cerrado por kickoff" : "Ya usaste este equipo"
      );
    setPendingPick({ game, teamId });
  };

  const doPick = async () => {
    if (!pendingPick) return;
    const { game, teamId } = pendingPick;
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
    const { data: pk } = await supabase
      .from("picks")
      .select("*")
      .eq("user_id", session.user.id);
    setPicks(pk || []);
    setPendingPick(null);
    await loadLeaguePicks(week);
  };

  const autopickMe = async () => {
    try {
      const url = `${SITE}/api/autopickOne?week=${week}&user_id=${encodeURIComponent(
        session.user.id
      )}&token=${encodeURIComponent(CRON_TOKEN)}`;
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || "Error autopick");
      alert("Autopick aplicado para ti.");
      const { data: pk } = await supabase
        .from("picks")
        .select("*")
        .eq("user_id", session.user.id);
      setPicks(pk || []);
      await loadLeaguePicks(week);
    } catch (e) {
      alert(e.message);
    }
  };
  const autopickLeague = async () => {
    try {
      const url = `${SITE}/api/autopick?week=${week}&token=${encodeURIComponent(
        CRON_TOKEN
      )}`;
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || "Error autopick liga");
      alert("Autopick aplicado a la liga.");
      await loadLeaguePicks(week);
    } catch (e) {
      alert(e.message);
    }
  };

  /* ---- UI helpers ---- */
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
    const status = g.status || "scheduled";
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
    if (status === "final")
      return (
        <div className="flex items-center justify-between">
          {score}
          <span className="text-xs px-2 py-0.5 rounded bg-gray-100">FINAL</span>
        </div>
      );
    if (status === "in_progress")
      return (
        <div className="flex items-center justify-between">
          {score}
          <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-900">
            En juego
          </span>
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
    const disabled = !canPick(game, teamId).ok;
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
        disabled={disabled}
        className={clsx(
          "w-full text-left rounded-xl border transition px-4 py-3",
          selected ? "border-emerald-500 bg-emerald-50" : "border-gray-200 hover:bg-gray-50",
          disabled && "opacity-50 cursor-not-allowed"
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

  /* ---- filtros ---- */
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

  /* ---- Stats Modal (H2H 2021–2025) ---- */
  const [h2h, setH2h] = useState(null);
  useEffect(() => {
    const loadH2H = async () => {
      if (!showStats) return;
      const g = showStats.game;
      const { data: finals } = await supabase
        .from("games")
        .select("home_team, away_team, home_score, away_score, season, status")
        .or(
          `and(home_team.eq.${g.home_team},away_team.eq.${g.away_team}),and(home_team.eq.${g.away_team},away_team.eq.${g.home_team})`
        )
        .gte("season", 2021)
        .lte("season", 2025)
        .eq("status", "final")
        .order("season", { ascending: false });

      const rows = finals || [];
      let aWins = 0,
        bWins = 0,
        marginSum = 0,
        lastWinner = null,
        streak = 0;
      for (const r of rows) {
        const diff =
          (r.home_team === g.home_team
            ? r.home_score - r.away_score
            : r.away_score - r.home_score) || 0;
        marginSum += diff;
        const winner =
          r.home_score == null || r.away_score == null
            ? null
            : r.home_score > r.away_score
            ? r.home_team
            : r.away_team;
        if (winner === g.home_team) {
          aWins++;
          if (lastWinner === g.home_team) streak++;
          else {
            lastWinner = g.home_team;
            streak = 1;
          }
        } else if (winner === g.away_team) {
          bWins++;
          if (lastWinner === g.away_team) streak++;
          else {
            lastWinner = g.away_team;
            streak = 1;
          }
        }
      }
      setH2h({
        games: rows.length,
        homeWins: aWins,
        awayWins: bWins,
        avgMargin: rows.length ? (marginSum / rows.length).toFixed(1) : "0.0",
        streak: lastWinner ? `${lastWinner} x${streak}` : "-",
      });
    };
    loadH2H();
  }, [showStats]);

  /* =================== Render =================== */
  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{LEAGUE}</h1>
          <p className="text-sm text-gray-700">
            Hola, <b>{me?.display_name}</b> · Vidas:{" "}
            <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
              {me?.lives}
            </span>
          </p>
        </div>
        <button className="text-sm underline" onClick={() => supabase.auth.signOut()}>
          Salir
        </button>
      </header>

      {/* Alertas */}
      {showPickAlert && (
        <div className="mt-3 p-3 border-2 border-red-300 rounded-xl bg-red-50 text-red-900 text-sm">
          🔔 Aún no tienes pick en W{week}. El primer kickoff es en{" "}
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

            <button className="text-xs px-3 py-1 rounded border" onClick={autopickMe}>
              Autopick para mí
            </button>
            {me?.role === "admin" && (
              <button className="text-xs px-3 py-1 rounded border" onClick={autopickLeague}>
                Autopick (liga)
              </button>
            )}
          </div>
        </div>

        <div className="md:col-span-2 p-4 border rounded-2xl bg-white">
          <h3 className="font-semibold">Resumen</h3>
          <p className="text-sm text-gray-600">
            Elige tu pick en los partidos de abajo. Puedes filtrar por día o
            buscar por equipo. El lock es “rolling” por partido.
          </p>
        </div>
      </section>

      {/* Partidos */}
      <section className="mt-4 p-4 border rounded-2xl bg-white">
        <h2 className="font-semibold mb-3">Partidos W{week}</h2>
        <div className="space-y-3">
          {gamesFiltered.map((g) => {
            const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
            const local = DateTime.fromISO(g.start_time)
              .setZone(TZ)
              .toFormat("EEE dd LLL HH:mm");
            const { last } = oddsPairs[g.id] || {};
            const spreadHome = last?.spread_home ?? null;
            const spreadAway = last?.spread_away ?? null;
            const mlHome = last?.ml_home ?? null;
            const mlAway = last?.ml_away ?? null;
            const wpHome =
              winProbFromSpread(spreadHome) ??
              (mlHome != null && mlAway != null
                ? Math.round(100 / (1 + Math.pow(10, (mlHome - mlAway) / 400)))
                : null);
            const wpAway =
              winProbFromSpread(-spreadHome) ??
              (mlHome != null && mlAway != null
                ? 100 - (wpHome ?? 50)
                : null);

            return (
              <div
                key={g.id}
                className={clsx("p-4 border rounded-xl", locked && "opacity-60")}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm flex items-center gap-2 flex-wrap">
                    <TeamChip id={g.away_team} />
                    <span className="mx-1 text-gray-400">@</span>
                    <TeamChip id={g.home_team} />
                  </div>
                  <div className="text-xs text-gray-600 flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-gray-100">{local}</span>
                    <button
                      className="text-xs underline"
                      onClick={() => setShowStats({ game: g })}
                    >
                      Stats
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <ScoreStrip g={g} />
                </div>

                {/* Odds + Win% */}
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
                      Win%: {g.home_team} {wpHome ?? "—"}% · {g.away_team}{" "}
                      {wpAway ?? "—"}%
                    </span>
                  )}
                </div>

                {/* Pick boxes */}
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TeamBox game={g} teamId={g.home_team} />
                  <TeamBox game={g} teamId={g.away_team} />
                </div>
              </div>
            );
          })}
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
                    <span className="text-gray-700 text-base font-semibold">
                      {row.pct}%
                    </span>
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
                No hay picks registrados esta semana.
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
                {(standings || []).map((s) => (
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
                      Aún no has hecho picks.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Modal pick */}
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

      {/* Modal Stats */}
      {showStats && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-full max-w-lg bg-white rounded-2xl p-5 border">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <TeamMini id={showStats.game.away_team} /> @{" "}
              <TeamMini id={showStats.game.home_team} />
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              Head-to-Head (2021–2025), promedio de margen y racha actual.
            </p>

            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded border bg-gray-50">
                <div className="text-xs text-gray-500">Partidos</div>
                <div className="text-xl font-bold">{h2h?.games ?? "—"}</div>
              </div>
              <div className="p-3 rounded border bg-gray-50">
                <div className="text-xs text-gray-500">Promedio margen</div>
                <div className="text-xl font-bold">{h2h?.avgMargin ?? "—"}</div>
              </div>
              <div className="p-3 rounded border bg-gray-50">
                <div className="text-xs text-gray-500">
                  Wins {showStats.game.home_team}
                </div>
                <div className="text-xl font-bold">{h2h?.homeWins ?? "—"}</div>
              </div>
              <div className="p-3 rounded border bg-gray-50">
                <div className="text-xs text-gray-500">
                  Wins {showStats.game.away_team}
                </div>
                <div className="text-xl font-bold">{h2h?.awayWins ?? "—"}</div>
              </div>
              <div className="col-span-2 p-3 rounded border bg-gray-50">
                <div className="text-xs text-gray-500">Racha</div>
                <div className="text-xl font-bold">{h2h?.streak ?? "—"}</div>
              </div>
            </div>

            <div className="mt-4 flex gap-2 justify-end">
              <button className="px-4 py-2 rounded border" onClick={() => setShowStats(null)}>
                Cerrar
              </button>
              <button
                className="px-4 py-2 rounded bg-black text-white"
                onClick={() => {
                  // Pick directo desde el modal para el equipo favorito (si existe)
                  const { last } = oddsPairs[showStats.game.id] || {};
                  if (!last) return alert("Sin odds disponibles.");
                  const isHomeFav =
                    (last.spread_home ?? 0) < (last.spread_away ?? 0) ||
                    (last.ml_home ?? 9999) < (last.ml_away ?? 9999);
                  const team = isHomeFav ? showStats.game.home_team : showStats.game.away_team;
                  confirmPick(showStats.game, team);
                  setShowStats(null);
                }}
              >
                Elegir por mí
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Aviso recordatorio */}
      {!myPickThisWeek && nextKickoffISO && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded-xl bg-black text-white text-sm shadow-lg">
          Recuerda elegir: kickoff en <Countdown iso={nextKickoffISO} />
        </div>
      )}
    </div>
  );
}











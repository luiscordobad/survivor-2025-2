// src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { supabase } from "./lib/supabaseClient";
import Rules from "./Rules";

/* ========================= Config ========================= */
const TZ = import.meta.env.VITE_TZ || "America/Mexico_City";
const SITE = import.meta.env.VITE_SITE_URL || "";
const CRON_TOKEN = import.meta.env.VITE_CRON_TOKEN || "";
const LEAGUE = import.meta.env.VITE_LEAGUE_NAME || "Maiztros Survivor 2025";
const SEASON = 2025;

/* ========================= Helpers ========================= */
const clsx = (...xs) => xs.filter(Boolean).join(" ");

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

function escCSV(v) {
  return v == null ? "" : `"${String(v).replaceAll('"', '""')}"`;
}
function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map(escCSV).join(",")).join("\n") + "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
// prob. de victoria simple a partir del spread (aprox.)
function winProbFromSpread(spreadForTeam) {
  if (spreadForTeam == null) return null;
  const k = 0.23; // curva logística suave
  const p = 1 / (1 + Math.exp(-k * (-spreadForTeam)));
  return Math.round(p * 100);
}

/* ========================= Sesión / Login ========================= */
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

/* ========================= Root / Tabs ========================= */
export default function AppRoot() {
  const session = useSession();
  const [view, setView] = useState("game"); // game | standings | assistant | news | rules

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
  }, []);

  if (!session) return <Login />;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="w-full border-b bg-white sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-2">
          {[
            ["game", "Partidos"],
            ["standings", "Standings"],
            ["assistant", "Asistente"],
            ["news", "Noticias"],
            ["rules", "Reglas"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={clsx(
                "text-sm px-3 py-1 rounded",
                view === key ? "bg-black text-white" : "border"
              )}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === "game" ? (
        <GamesTab />
      ) : view === "standings" ? (
        <StandingsTab />
      ) : view === "assistant" ? (
        <AssistantTab />
      ) : view === "news" ? (
        <NewsTab />
      ) : (
        <Rules />
      )}
    </div>
  );
}

/* ========================= Partidos ========================= */
function GamesTab() {
  const session = useSession();
  const [me, setMe] = useState(null);
  const [week, setWeek] = useState(() => Number(localStorage.getItem("week")) || 1);

  const [teams, setTeams] = useState({});
  const [games, setGames] = useState([]);
  const [oddsPairs, setOddsPairs] = useState({});
  const [picks, setPicks] = useState([]);
  const [leaguePicks, setLeaguePicks] = useState([]);
  const [userNames, setUserNames] = useState({});
  const [popularity, setPopularity] = useState([]);
  const [standings, setStandings] = useState([]);

  const [pendingPick, setPendingPick] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [dayFilter, setDayFilter] = useState(localStorage.getItem("dayFilter") || "ALL");
  const [q, setQ] = useState(localStorage.getItem("teamQuery") || "");

  // realtime
  useEffect(() => {
    const ch = supabase
      .channel("realtime-games")
      .on("postgres_changes", { event: "*", schema: "public", table: "picks" }, () => {
        loadMyPicks();
        loadLeaguePicks(week);
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

  /* ---------- Cargas ---------- */
  const loadTeams = async () => {
    const { data } = await supabase.from("teams").select("*");
    const map = {};
    (data || []).forEach((t) => (map[t.id] = t));
    setTeams(map);
  };
  const loadGames = async (w) => {
    const { data: gs } = await supabase
      .from("games")
      .select("*")
      .eq("season", SEASON)
      .eq("week", w)
      .order("start_time");
    setGames(gs || []);

    const ids = (gs || []).map((g) => g.id);
    if (ids.length) {
      const { data: odds } = await supabase
        .from("odds")
        .select("game_id,spread_home,spread_away,ml_home,ml_away,fetched_at")
        .in("game_id", ids)
        .order("fetched_at", { ascending: false });
      const by = {};
      for (const row of odds || []) {
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
      .eq("season", SEASON)
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

    let totalPlayers = 0;
    try {
      const { count } = await supabase
        .from("profiles")
        .select("*", { count: "exact", head: true });
      totalPlayers = count || 0;
    } catch {
      const { data: st } = await supabase.from("standings").select("user_id");
      totalPlayers = st?.length || 0;
    }
    const counts = {};
    (pks || []).forEach((x) => x.team_id && (counts[x.team_id] = (counts[x.team_id] || 0) + 1));
    const poplist = Object.entries(counts)
      .map(([team_id, count]) => ({
        team_id,
        count,
        pct: totalPlayers ? Math.round((count * 100) / totalPlayers) : 0,
      }))
      .sort((a, b) => b.count - a.count);
    setPopularity(poplist);
  };

  const init = async () => {
    const email = session.user.email;
    let { data: prof } = await supabase.from("profiles").select("*").eq("email", email).single();
    if (!prof) {
      await supabase.from("profiles").insert({
        id: session.user.id,
        email,
        display_name: email.split("@")[0],
      });
      const r = await supabase.from("profiles").select("*").eq("email", email).single();
      prof = r.data;
    }
    setMe(prof);

    await loadTeams();
    await loadGames(week);
    await loadMyPicks();
    await loadLeaguePicks(week);

    const { data: st } = await supabase.from("standings").select("*");
    setStandings(st || []);
    setLastUpdated(new Date().toISOString());
  };

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    loadGames(week);
    loadLeaguePicks(week);
    localStorage.setItem("week", String(week));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);
  useEffect(() => localStorage.setItem("dayFilter", dayFilter), [dayFilter]);
  useEffect(() => localStorage.setItem("teamQuery", q), [q]);

  /* ---------- Helpers ---------- */
  const myPickThisWeek = useMemo(
    () => (picks || []).find((p) => p.week === week && p.season === SEASON),
    [picks, week]
  );
  const nextKickoffISO = useMemo(() => {
    const up = (games || []).find((g) => DateTime.fromISO(g.start_time) > DateTime.now());
    return up?.start_time || null;
  }, [games]);
  const showPickAlert = useMemo(() => {
    if (myPickThisWeek || !nextKickoffISO) return false;
    const mins = DateTime.fromISO(nextKickoffISO).diffNow("minutes").minutes;
    return mins <= 90 && mins > 0;
  }, [myPickThisWeek, nextKickoffISO]);

  const popPct = (teamId) => popularity.find((p) => p.team_id === teamId)?.pct ?? 0;

  const canPick = (g, team) => {
    const locked = DateTime.fromISO(g.start_time) <= DateTime.now() || (g.status || "") === "final";
    if (locked) return { ok: false, reason: "LOCK" };
    const used = (picks || []).some((p) => p.team_id === team && p.user_id === session.user.id);
    if (used && !(myPickThisWeek && myPickThisWeek.team_id === team))
      return { ok: false, reason: "USED" };
    return { ok: true };
  };

  const confirmPick = (g, teamId) => {
    const c = canPick(g, teamId);
    if (!c.ok) return alert(c.reason === "LOCK" ? "Cerrado por kickoff" : "Ya usaste este equipo");
    setPendingPick({ g, teamId });
  };

  const doPick = async () => {
    if (!pendingPick) return;
    const { g, teamId } = pendingPick;

    if (myPickThisWeek) {
      const { error } = await supabase
        .from("picks")
        .update({ team_id: teamId, game_id: g.id, updated_at: new Date().toISOString() })
        .eq("id", myPickThisWeek.id);
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase
        .from("picks")
        .insert({ user_id: session.user.id, game_id: g.id, team_id: teamId, week, season: SEASON });
      if (error) return alert(error.message);
    }

    await loadMyPicks();
    await loadLeaguePicks(week);
    setPendingPick(null);
  };

  /* ---------- Acciones ---------- */
  const autopickMe = async () => {
    try {
      const url = `${SITE}/api/control?action=autopickOne&week=${week}&user_id=${encodeURIComponent(
        session.user.id
      )}&token=${encodeURIComponent(CRON_TOKEN)}`;
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || "Autopick falló");
      alert("Autopick aplicado.");
    } catch (e) {
      alert(e.message);
    }
  };

  /* ---------- UI helpers ---------- */
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
  const TeamChip = ({ id }) => {
    const t = teams[id] || {};
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
    if (status === "final") {
      return (
        <div className="flex items-center justify-between">
          {score}
          <span className="text-xs px-2 py-0.5 rounded bg-gray-100">FINAL</span>
        </div>
      );
    }
    if (status === "in_progress") {
      return (
        <div className="flex items-center justify-between">
          {score}
          <div className="text-xs flex items-center gap-2">
            {g.period != null && (
              <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900">
                Q{g.period} {g.clock || ""}
              </span>
            )}
            {g.possession && (
              <span className="px-2 py-0.5 rounded bg-gray-100">⬤ {g.possession}</span>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-between">
        {score}
        <span className="text-xs px-2 py-0.5 rounded bg-gray-100">
          Kickoff en <Countdown iso={g.start_time} />
        </span>
      </div>
    );
  };
  const TeamBox = ({ g, teamId }) => {
    const disabled = !canPick(g, teamId).ok;
    const selected = myPickThisWeek?.game_id === g.id && myPickThisWeek?.team_id === teamId;
    const { last } = oddsPairs[g.id] || {};
    const fav =
      last &&
      ((teamId === g.home_team &&
        ((last.spread_home ?? 0) < (last.spread_away ?? 0) ||
          (last.ml_home ?? 9999) < (last.ml_away ?? 9999))) ||
        (teamId === g.away_team &&
          ((last.spread_away ?? 0) < (last.spread_home ?? 0) ||
            (last.ml_away ?? 9999) < (last.ml_home ?? 9999))));
    const pct = popPct(teamId);
    return (
      <button
        onClick={() => confirmPick(g, teamId)}
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

  /* ---------- Filtros ---------- */
  const listByDay = useMemo(() => {
    if (dayFilter === "ALL") return games;
    const map = { THU: 4, FRI: 5, SAT: 6, SUN: 7, MON: 1 };
    const want = map[dayFilter];
    return (games || []).filter(
      (g) => DateTime.fromISO(g.start_time).setZone(TZ).weekday === want
    );
  }, [games, dayFilter]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return listByDay;
    const match = (id) => {
      const t = teams[id];
      return id.toLowerCase().includes(query) || (t?.name || "").toLowerCase().includes(query);
    };
    return (listByDay || []).filter((g) => match(g.away_team) || match(g.home_team));
  }, [listByDay, q, teams]);

  /* ---------- Render ---------- */
  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">{LEAGUE}</h1>
          {lastUpdated && (
            <p className="text-xs text-gray-500">
              Actualizado:{" "}
              {DateTime.fromISO(lastUpdated).setZone(TZ).toFormat("dd LLL HH:mm:ss")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-700">
            Hola, <b>{me?.display_name}</b> · Vidas:{" "}
            <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
              {me?.lives}
            </span>
          </p>
          <button className="text-sm underline" onClick={() => supabase.auth.signOut()}>
            Salir
          </button>
        </div>
      </header>

      {/* barra superior */}
      <section className="mt-4 grid md:grid-cols-[1fr,2fr] gap-4">
        <div className="p-3 md:p-4 border rounded-2xl bg-white">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Semana</span>
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

            <div className="ml-2 flex gap-1 text-xs">
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

            <input
              className="flex-1 md:flex-none md:w-56 border p-2 rounded-lg ml-auto"
              placeholder="Buscar equipo..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className="mt-3 flex gap-2">
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
          </div>
        </div>

        <div className="p-3 md:p-4 border rounded-2xl bg-white">
          <h3 className="font-semibold">Resumen</h3>
          <p className="text-sm text-gray-600">
            Elige tu pick en los partidos de abajo. Lock “rolling” por partido. El tablero se
            actualiza en tiempo real.
          </p>
        </div>
      </section>

      {/* alerta falta pick */}
      {showPickAlert && (
        <div className="mt-3 p-3 border-2 border-red-300 rounded-xl bg-red-50 text-red-900 text-sm">
          🔔 Aún no tienes pick en W{week}. Kickoff en <b><Countdown iso={nextKickoffISO} /></b>.
        </div>
      )}

      {/* Partidos */}
      <section className="mt-4 p-4 border rounded-2xl bg-white">
        <h2 className="font-semibold mb-3">Partidos W{week}</h2>
        <div className="space-y-3">
          {filtered.map((g) => {
            const local = DateTime.fromISO(g.start_time).setZone(TZ).toFormat("EEE dd LLL HH:mm");
            const locked =
              DateTime.fromISO(g.start_time) <= DateTime.now() || (g.status || "") === "final";
            const { last } = oddsPairs[g.id] || {};
            const wpHome = winProbFromSpread(last?.spread_home ?? null);
            const wpAway = wpHome != null ? 100 - wpHome : null;

            return (
              <div key={g.id} className={clsx("p-4 border rounded-xl", locked && "opacity-60")}>
                {/* encabezado: equipos + stats link */}
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-sm flex items-center gap-2 flex-wrap">
                    <TeamChip id={g.away_team} />
                    <span className="mx-1 text-gray-400">@</span>
                    <TeamChip id={g.home_team} />
                  </div>
                  <div className="text-xs flex items-center gap-3">
                    <span className="px-1.5 py-0.5 rounded bg-gray-100">{local}</span>
                    <a
                      href={`https://www.espn.com/nfl/game/_/gameId/${g.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-gray-700"
                    >
                      Stats
                    </a>
                  </div>
                </div>

                {/* marcador/estado */}
                <div className="mt-3">
                  <ScoreStrip g={g} />
                </div>

                {/* info momios / win% */}
                <div className="mt-2 text-xs text-gray-700 flex gap-3 flex-wrap">
                  {last?.spread_home != null && last?.spread_away != null && (
                    <span className="px-2 py-0.5 rounded bg-gray-50 border">
                      Spread: {g.home_team}{" "}
                      {last.spread_home > 0 ? `+${last.spread_home}` : last.spread_home},{" "}
                      {g.away_team} {last.spread_away > 0 ? `+${last.spread_away}` : last.spread_away}
                    </span>
                  )}
                  {last?.ml_home != null && last?.ml_away != null && (
                    <span className="px-2 py-0.5 rounded bg-gray-50 border">
                      ML: {g.home_team} {last.ml_home}, {g.away_team} {last.ml_away}
                    </span>
                  )}
                  {(wpHome != null || wpAway != null) && (
                    <span className="px-2 py-0.5 rounded bg-gray-50 border">
                      Win%: {g.home_team} {wpHome ?? "—"}% · {g.away_team} {wpAway ?? "—"}%
                    </span>
                  )}
                </div>

                {/* boxes de selección */}
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TeamBox g={g} teamId={g.home_team} />
                  <TeamBox g={g} teamId={g.away_team} />
                </div>
              </div>
            );
          })}
          {(!filtered || filtered.length === 0) && (
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
                {(leaguePicks || []).length ? (
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
                      Aún no hay picks.
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
            {(popularity || []).length ? (
              popularity.map((row) => (
                <div key={row.team_id}>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <TeamMini id={row.team_id} />
                      <span className="text-gray-500">({row.count})</span>
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

      {/* Historial propio */}
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

      {/* modal confirmación */}
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

      {/* aviso rápido */}
      {!myPickThisWeek && nextKickoffISO && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded-xl bg-black text-white text-sm shadow-lg">
          Recuerda elegir: kickoff en <Countdown iso={nextKickoffISO} />
        </div>
      )}
    </div>
  );
}

/* ========================= Standings (NFL) ========================= */
function StandingsTab() {
  const [teams, setTeams] = useState([]); // {id,name,conference,division}
  const [games, setGames] = useState([]); // season finals
  const [loading, setLoading] = useState(true);

  // realtime para refrescar cuando entran finales
  useEffect(() => {
    const ch = supabase
      .channel("realtime-standings")
      .on("postgres_changes", { event: "*", schema: "public", table: "games" }, () => {
        fetchData();
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: ts } = await supabase
      .from("teams")
      .select("id,name,conference,division,logo_url")
      .order("id");
    const { data: gs } = await supabase
      .from("games")
      .select("id,home_team,away_team,home_score,away_score,status,season")
      .eq("season", SEASON)
      .eq("status", "final");
    setTeams(ts || []);
    setGames(gs || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  // calcula W/L/T y diferencial por equipo
  const records = useMemo(() => {
    const rec = {};
    teams.forEach((t) => {
      rec[t.id] = { team: t.id, conf: t.conference, div: t.division, w: 0, l: 0, t: 0, diff: 0 };
    });
    (games || []).forEach((g) => {
      const hs = Number(g.home_score ?? 0);
      const as = Number(g.away_score ?? 0);
      if (!rec[g.home_team] || !rec[g.away_team]) return;
      if (hs === as) {
        rec[g.home_team].t += 1;
        rec[g.away_team].t += 1;
      } else if (hs > as) {
        rec[g.home_team].w += 1;
        rec[g.away_team].l += 1;
      } else {
        rec[g.away_team].w += 1;
        rec[g.home_team].l += 1;
      }
      rec[g.home_team].diff += hs - as;
      rec[g.away_team].diff += as - hs;
    });
    return rec;
  }, [games, teams]);

  // helpers UI
  const TeamMini = ({ id }) => {
    const t = teams.find((x) => x.id === id) || {};
    const logo = t.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-1">
        <img
          src={logo}
          alt={id}
          className="h-4 w-4 object-contain"
          onError={(e) => (e.currentTarget.style.visibility = "hidden")}
        />
        <span className="font-mono text-xs font-semibold">{id}</span>
      </span>
    );
  };

  const divisions = ["EAST", "NORTH", "SOUTH", "WEST"];
  const byConf = (conf) =>
    teams.filter((t) => t.conference === conf).sort((a, b) => a.id.localeCompare(b.id));

  const sortStand = (a, b) => {
    const ra = records[a.id] || {};
    const rb = records[b.id] || {};
    if ((rb.w || 0) !== (ra.w || 0)) return (rb.w || 0) - (ra.w || 0);
    if ((ra.l || 0) !== (rb.l || 0)) return (ra.l || 0) - (rb.l || 0);
    return (rb.diff || 0) - (ra.diff || 0);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Standings NFL ({SEASON})</h1>
      </header>

      {loading && <p className="mt-3 text-sm text-gray-500">Cargando…</p>}

      {/* por División */}
      <section className="mt-4 grid md:grid-cols-2 gap-4">
        <div className="p-4 border rounded-2xl bg-white">
          <h2 className="font-semibold">Standings por División ({SEASON}) — AFC</h2>
          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            {divisions.map((d) => {
              const rows = byConf("AFC")
                .filter((t) => t.division === d)
                .sort(sortStand);
              return (
                <div key={`AFC-${d}`} className="border rounded-xl p-3">
                  <div className="text-xs text-gray-500 mb-1">AFC — {d}</div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th>Equipo</th>
                        <th>W</th>
                        <th>L</th>
                        <th>T</th>
                        <th>Diff</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((t) => {
                        const r = records[t.id] || {};
                        return (
                          <tr key={t.id} className="border-t">
                            <td className="py-1.5">
                              <TeamMini id={t.id} />{" "}
                            </td>
                            <td>{r.w || 0}</td>
                            <td>{r.l || 0}</td>
                            <td>{r.t || 0}</td>
                            <td>{r.diff || 0}</td>
                          </tr>
                        );
                      })}
                      {rows.length === 0 && (
                        <tr>
                          <td className="py-1.5 text-gray-500" colSpan={5}>
                            Sin datos
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-4 border rounded-2xl bg-white">
          <h2 className="font-semibold">Standings por División ({SEASON}) — NFC</h2>
          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            {divisions.map((d) => {
              const rows = byConf("NFC")
                .filter((t) => t.division === d)
                .sort(sortStand);
              return (
                <div key={`NFC-${d}`} className="border rounded-xl p-3">
                  <div className="text-xs text-gray-500 mb-1">NFC — {d}</div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th>Equipo</th>
                        <th>W</th>
                        <th>L</th>
                        <th>T</th>
                        <th>Diff</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((t) => {
                        const r = records[t.id] || {};
                        return (
                          <tr key={t.id} className="border-t">
                            <td className="py-1.5">
                              <TeamMini id={t.id} />{" "}
                            </td>
                            <td>{r.w || 0}</td>
                            <td>{r.l || 0}</td>
                            <td>{r.t || 0}</td>
                            <td>{r.diff || 0}</td>
                          </tr>
                        );
                      })}
                      {rows.length === 0 && (
                        <tr>
                          <td className="py-1.5 text-gray-500" colSpan={5}>
                            Sin datos
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* por Conferencia */}
      <section className="mt-6 grid md:grid-cols-2 gap-4">
        {["AFC", "NFC"].map((conf) => {
          const rows = byConf(conf).sort(sortStand);
          return (
            <div key={conf} className="p-4 border rounded-2xl bg-white">
              <h2 className="font-semibold">Standings por Conferencia ({SEASON}) — {conf}</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th>Equipo</th>
                      <th>W</th>
                      <th>L</th>
                      <th>T</th>
                      <th>Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => {
                      const r = records[t.id] || {};
                      return (
                        <tr key={t.id} className="border-t">
                          <td className="py-1.5">
                            <TeamMini id={t.id} /> <span className="text-xs text-gray-500">({t.division})</span>
                          </td>
                          <td className="text-emerald-700 font-medium">{r.w || 0}</td>
                          <td className="text-red-600 font-medium">{r.l || 0}</td>
                          <td className="text-gray-600">{r.t || 0}</td>
                          <td>{r.diff || 0}</td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && (
                      <tr>
                        <td className="py-2 text-gray-500" colSpan={5}>
                          Sin datos
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

/* ========================= Asistente ========================= */
function AssistantTab() {
  const session = useSession();
  const [teams, setTeams] = useState({});
  const [games, setGames] = useState([]);
  const [odds, setOdds] = useState({});
  const [picks, setPicks] = useState([]);
  const [week, setWeek] = useState(() => Number(localStorage.getItem("week")) || 1);
  const [pop, setPop] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => localStorage.setItem("week", String(week)), [week]);

  useEffect(() => {
    (async () => {
      const { data: ts } = await supabase.from("teams").select("*");
      const map = {};
      (ts || []).forEach((t) => (map[t.id] = t));
      setTeams(map);

      const { data: gs } = await supabase
        .from("games")
        .select("*")
        .eq("season", SEASON)
        .eq("week", week)
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
        .eq("season", SEASON)
        .eq("week", week);
      const counts = {};
      (lp || []).forEach((p) => (counts[p.team_id] = (counts[p.team_id] || 0) + 1));
      let total = 0;
      try {
        const { count } = await supabase.from("profiles").select("*", { count: "exact", head: true });
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
      const wpAway = 100 - wpHome;
      return [
        { game: g, team: g.home_team, vs: g.away_team, wp: wpHome, pop: getPop(g.home_team), used: used.has(g.home_team) },
        { game: g, team: g.away_team, vs: g.home_team, wp: wpAway, pop: getPop(g.away_team), used: used.has(g.away_team) },
      ];
    })
    .flat();

  const ranked = rows
    .map((r) => ({ ...r, score: (r.wp || 50) + (100 - (r.pop || 0)) + (r.used ? -30 : 10) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const confirm = async (r) => {
    setBusy(true);
    try {
      const locked = DateTime.fromISO(r.game.start_time) <= DateTime.now() || (r.game.status || "") === "final";
      if (locked) throw new Error("Juego bloqueado por kickoff.");
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
              <span className="ml-auto text-xs text-gray-500">Score {Math.round(r.score)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ========================= Noticias ========================= */
function NewsTab() {
  const [team, setTeam] = useState(""); // "" = general
  const [teams, setTeams] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async (t) => {
    setLoading(true);
    let q = supabase.from("news").select("*").order("published_at", { ascending: false }).limit(30);
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
      ? `${SITE}/api/control?action=syncNews&team=${encodeURIComponent(scopeTeam)}&token=${encodeURIComponent(CRON_TOKEN)}`
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
          <select className="border p-1 rounded-lg" value={team} onChange={(e) => setTeam(e.target.value)}>
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
            <a
              href={n.url}
              target="_blank"
              rel="noreferrer"
              className="block mt-1 font-medium underline"
            >
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

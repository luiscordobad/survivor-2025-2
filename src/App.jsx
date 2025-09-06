// src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { supabase } from "./lib/supabaseClient";
import Rules from "./Rules";

const TZ = import.meta.env.VITE_TZ || "America/Mexico_City";

/* ========================= Utilidades ========================= */
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

/* ========================= Login ========================= */
function Login() {
  const [tab, setTab] = useState("password"); // 'password' | 'magic' | 'reset'
  const [busy, setBusy] = useState(false);

  // Magic
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  // Password
  const [passEmail, setPassEmail] = useState("");
  const [passPwd, setPassPwd] = useState("");
  const [isSignup, setIsSignup] = useState(false);

  // Reset
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
      options: {
        emailRedirectTo:
          import.meta.env.VITE_SITE_URL || window.location.origin,
      },
    });
    if (!error) setSent(true);
    else alert(error.message);
  };

  const passwordAuth = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({
          email: passEmail,
          password: passPwd,
          options: {
            emailRedirectTo:
              import.meta.env.VITE_SITE_URL || window.location.origin,
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

  const sendReset = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: import.meta.env.VITE_SITE_URL || window.location.origin,
      });
      if (error) throw error;
      setResetInfo("Enlace enviado, revisa tu correo.");
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const applyNew = async (e) => {
    e.preventDefault();
    if (!newPwd || newPwd.length < 6) return alert("Mínimo 6 caracteres.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPwd });
      if (error) throw error;
      setResetInfo("Contraseña actualizada.");
      setTimeout(() => setTab("password"), 1200);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const signGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo:
          import.meta.env.VITE_SITE_URL || window.location.origin,
      },
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-slate-50 to-white">
      <div className="w-full max-w-md space-y-4 p-6 border rounded-2xl bg-white shadow-sm">
        <h1 className="text-3xl font-extrabold tracking-tight text-center">
          {import.meta.env.VITE_LEAGUE_NAME || "Survivor 2025"}
        </h1>

        <div className="flex gap-2 justify-center">
          <button
            className={`px-3 py-1 rounded border ${
              tab === "password" ? "bg-black text-white" : "hover:bg-gray-50"
            }`}
            onClick={() => setTab("password")}
          >
            Email + Password
          </button>
          <button
            className={`px-3 py-1 rounded border ${
              tab === "magic" ? "bg-black text-white" : "hover:bg-gray-50"
            }`}
            onClick={() => setTab("magic")}
          >
            Magic link
          </button>
          <button
            className={`px-3 py-1 rounded border ${
              tab === "reset" ? "bg-black text-white" : "hover:bg-gray-50"
            }`}
            onClick={() => setTab("reset")}
          >
            Olvidé mi contraseña
          </button>
        </div>

        <button
          onClick={signGoogle}
          className="w-full border rounded-lg py-2 hover:bg-gray-50"
        >
          Entrar con Google
        </button>

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

        {tab === "reset" &&
          (window.location.hash.includes("type=recovery") ? (
            <form onSubmit={applyNew} className="space-y-3">
              <input
                type="password"
                className="border w-full p-2 rounded-lg"
                placeholder="nueva contraseña"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                required
              />
              <button
                disabled={busy}
                className="bg-black text-white px-4 py-2 w-full rounded-lg disabled:opacity-60"
              >
                Guardar
              </button>
              {resetInfo && (
                <p className="text-xs text-emerald-700">{resetInfo}</p>
              )}
            </form>
          ) : (
            <form onSubmit={sendReset} className="space-y-3">
              <input
                type="email"
                className="border w-full p-2 rounded-lg"
                placeholder="tu email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                required
              />
              <button
                disabled={busy}
                className="bg-black text-white px-4 py-2 w-full rounded-lg disabled:opacity-60"
              >
                Enviar enlace
              </button>
              {resetInfo && (
                <p className="text-xs text-emerald-700">{resetInfo}</p>
              )}
            </form>
          ))}
      </div>
    </div>
  );
}

/* ========================= App wrapper (tabs + tema) ========================= */
export default function App() {
  const session = useSession();
  const [view, setView] = useState("game"); // 'game' | 'rules'
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") || "light"
  );

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  if (!session) return <Login />;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 dark:text-slate-100">
      <div className="w-full border-b bg-white/90 dark:bg-slate-900/90 sticky top-0 z-50 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-2">
          <button
            className={`text-sm px-3 py-1 rounded ${
              view === "game" ? "bg-black text-white" : "hover:bg-gray-100"
            } dark:hover:bg-slate-800`}
            onClick={() => setView("game")}
          >
            Partidos
          </button>
          <button
            className={`text-sm px-3 py-1 rounded ${
              view === "rules" ? "bg-black text-white" : "hover:bg-gray-100"
            } dark:hover:bg-slate-800`}
            onClick={() => setView("rules")}
          >
            Reglas
          </button>

          <div className="ml-auto flex items-center gap-2">
            <button
              className="text-xs px-3 py-1 rounded border hover:bg-gray-50 dark:hover:bg-slate-800"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              title="Tema claro/oscuro"
            >
              {theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
            </button>
          </div>
        </div>
      </div>

      {view === "game" ? <AppAuthed session={session} /> : <Rules />}
    </div>
  );
}

/* ========================= AppAuthed ========================= */
function AppAuthed({ session }) {
  const [me, setMe] = useState(null);
  const [week, setWeek] = useState(() => Number(localStorage.getItem("week")) || 1);

  const [games, setGames] = useState([]);
  const [oddsPairs, setOddsPairs] = useState({});
  const [picks, setPicks] = useState([]);
  const [standings, setStandings] = useState([]);

  const [leaguePicks, setLeaguePicks] = useState([]);
  const [userNames, setUserNames] = useState({});
  const [popularity, setPopularity] = useState([]);

  // Equipos (logos)
  const [teamsMap, setTeamsMap] = useState({});

  // Confirmación pick
  const [pendingPick, setPendingPick] = useState(null); // {game, teamId}

  // Feed de actividad (lateral)
  const [activity, setActivity] = useState([]);

  // Filtros UX
  const [dayFilter, setDayFilter] = useState(localStorage.getItem("dayFilter") || "ALL");
  const [teamQuery, setTeamQuery] = useState(localStorage.getItem("teamQuery") || "");
  const searchRef = useRef(null);

  // Atajos
  useEffect(() => {
    const h = (e) => {
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "ArrowRight") {
        setWeek((w) => Math.min(18, w + 1));
      } else if (e.key === "ArrowLeft") {
        setWeek((w) => Math.max(1, w - 1));
      } else if (e.key.toLowerCase() === "g") {
        // scroll al siguiente partido desbloqueado
        const nxt = (games || []).find(
          (g) => DateTime.fromISO(g.start_time) > DateTime.now()
        );
        if (nxt) {
          const el = document.getElementById(`game-${nxt.id}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [games]);

  /* ---------- carga base ---------- */
  const loadTeams = async () => {
    const { data: ts } = await supabase.from("teams").select("*");
    const map = {};
    (ts || []).forEach((t) => {
      map[t.id] = t;
    });
    setTeamsMap(map);
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
    // odds
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

  const loadActivity = async () => {
    const { data } = await supabase
      .from("activity")
      .select("user_id,type,payload,created_at,profiles(display_name)")
      .order("created_at", { ascending: false })
      .limit(12);
    setActivity(data || []);
  };

  const init = async () => {
    const email = session.user.email;
    let { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .single();
    if (!prof) {
      await supabase
        .from("profiles")
        .insert({
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
    await loadActivity();
  };

  useEffect(() => {
    init();
  }, []);
  useEffect(() => {
    loadGames(week);
    loadLeaguePicks(week);
  }, [week]);

  useEffect(() => localStorage.setItem("week", String(week)), [week]);
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

  const chipDay = (iso) => {
    const wd = DateTime.fromISO(iso).setZone(TZ).weekday;
    if (wd === 4) return "TNF";
    if (wd === 5) return "Fri";
    if (wd === 6) return "Sat";
    if (wd === 7) return "Sun";
    if (wd === 1) return "MNF";
    return "";
  };

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
    // Recarga picks + actividad
    const { data: pk } = await supabase
      .from("picks")
      .select("*")
      .eq("user_id", session.user.id);
    setPicks(pk || []);
    // guarda actividad (simple, sin trigger)
    await supabase.from("activity").insert({
      user_id: session.user.id,
      type: "pick",
      payload: { week, team: teamId },
    });
    loadActivity();
    setPendingPick(null);
  };

  /* ---------- UI building blocks ---------- */
  const TeamBox = ({ game, teamId }) => {
    const disabled = !canPick(game, teamId).ok;
    const selected =
      myPickThisWeek?.game_id === game.id &&
      myPickThisWeek?.team_id === teamId;
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
        disabled={disabled}
        className={[
          "w-full text-left rounded-2xl border transition px-4 py-3",
          selected
            ? "border-emerald-500 ring-2 ring-emerald-200 bg-emerald-50"
            : "border-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800",
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

  const GameHeader = ({ g }) => {
    const local = DateTime.fromISO(g.start_time)
      .setZone(TZ)
      .toFormat("EEE dd LLL HH:mm");
    const chip = chipDay(g.start_time);
    const special = (() => {
      const notes = (g.notes || "").toLowerCase();
      const city = (g.venue_city || "").toLowerCase();
      if (notes.includes("thanksgiving")) return "🦃";
      if (notes.includes("christmas") || notes.includes("navidad")) return "🎄";
      if (city.includes("london")) return "🇬🇧";
      if (city.includes("frankfurt") || city.includes("munich")) return "🇩🇪";
      if (g.neutral_site) return "🏟️";
      return null;
    })();

    // ticker en vivo si está en progreso
    const live =
      g.status === "in_progress"
        ? `Q${g.period || ""} ${g.clock || ""} · ${g.away_team} ${
            g.away_score ?? ""
          }–${g.home_score ?? ""} ${g.home_team}`
        : null;

    return (
      <div>
        <div className="text-sm flex items-center gap-2 flex-wrap">
          <TeamChip id={g.away_team} />
          <span className="mx-1 text-gray-400">@</span>
          <TeamChip id={g.home_team} />
          {chip && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800">
              {chip}
            </span>
          )}
          {special && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-800">
              {special}
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          Kickoff:{" "}
          <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-800">
            {local}
          </span>{" "}
          · Lock en: <Countdown iso={g.start_time} />
        </div>
        {live && (
          <div className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
            {live}
          </div>
        )}
      </div>
    );
  };

  /* ---------- listado filtrado ---------- */
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
            {import.meta.env.VITE_LEAGUE_NAME || "2025"}
          </h1>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Hola, <b>{me?.display_name}</b> · Vidas:{" "}
            <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
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

      {/* Alertas */}
      {showPickAlert && (
        <div className="mt-3 p-3 border-2 border-red-300 rounded-xl bg-red-50 text-red-900 text-sm sticky top-12 z-10">
          🔔 Aún no tienes pick en W{week}. El primer kickoff es en{" "}
          <b>
            <Countdown iso={nextKickoffISO} />
          </b>
          .
        </div>
      )}

      {/* Toolbar + Activity */}
      <section className="mt-4 grid md:grid-cols-3 gap-4">
        <div className="p-4 border rounded-2xl bg-white shadow-sm dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 dark:text-gray-400">
                Semana
              </label>
              <select
                className="border p-1 rounded-lg dark:bg-slate-800"
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
                  className={`px-2 py-1 rounded border dark:border-slate-700 ${
                    dayFilter === d ? "bg-black text-white" : "hover:bg-gray-50 dark:hover:bg-slate-800"
                  }`}
                  onClick={() => setDayFilter(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <input
            id="searchTeam"
            ref={searchRef}
            className="mt-3 border w-full p-2 rounded-lg dark:bg-slate-800"
            placeholder="Buscar equipo..."
            value={teamQuery}
            onChange={(e) => setTeamQuery(e.target.value)}
          />

          <div className="mt-3 flex items-center gap-2">
            <button
              className="text-xs px-3 py-1 rounded border hover:bg-gray-50 dark:hover:bg-slate-800"
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
              className="text-xs px-3 py-1 rounded border hover:bg-gray-50 dark:hover:bg-slate-800"
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

        {/* Feed actividad */}
        <aside className="md:col-span-2 p-4 border rounded-2xl bg-white shadow-sm dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Actividad reciente</h3>
            <button
              className="text-xs px-2 py-1 rounded border hover:bg-gray-50 dark:hover:bg-slate-800"
              onClick={loadActivity}
            >
              Refrescar
            </button>
          </div>
          <div className="mt-2 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {(activity || []).map((a, i) => {
              const who = a.profiles?.display_name || a.user_id.slice(0, 6);
              const when = DateTime.fromISO(a.created_at)
                .setZone(TZ)
                .toRelative();
              return (
                <div
                  key={i}
                  className="text-xs p-2 border rounded-lg bg-gray-50 dark:bg-slate-800 dark:border-slate-700"
                >
                  <b>{who}</b> eligió <b>{a.payload?.team}</b> (W
                  {a.payload?.week}) · {when}
                </div>
              );
            })}
            {(!activity || activity.length === 0) && (
              <div className="text-xs text-gray-500">Sin actividad aún.</div>
            )}
          </div>
        </aside>
      </section>

      {/* Partidos */}
      <section className="mt-4 p-4 border rounded-2xl bg-white shadow-sm dark:bg-slate-900">
        <h2 className="font-semibold mb-3">Partidos W{week}</h2>
        <div className="space-y-3">
          {gamesFiltered.map((g) => {
            const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
            return (
              <div
                key={g.id}
                id={`game-${g.id}`}
                className={`p-4 border rounded-xl shadow-sm ${
                  locked ? "opacity-60" : ""
                }`}
              >
                <GameHeader g={g} />
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TeamBox game={g} teamId={g.home_team} />
                  <TeamBox game={g} teamId={g.away_team} />
                </div>
                <div className="mt-2 text-xs">
                  Estado:{" "}
                  <span
                    className={
                      g.status === "in_progress"
                        ? "text-amber-700 font-medium"
                        : g.status === "final"
                        ? "text-emerald-700 font-medium"
                        : g.status === "postponed"
                        ? "text-gray-700 font-medium"
                        : "text-gray-700"
                    }
                  >
                    {g.status}
                  </span>
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
        <div className="p-4 border rounded-2xl bg-white shadow-sm dark:bg-slate-900">
          <h2 className="font-semibold">Picks de la liga (W{week})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm mt-3">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400">
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
                    .map((p, idx) => (
                      <tr key={idx} className="border-t">
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
                        <td className="text-xs text-gray-500 dark:text-gray-400">
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

        <div className="p-4 border rounded-2xl bg-white shadow-sm dark:bg-slate-900">
          <h2 className="font-semibold">Popularidad de equipos</h2>
          <p className="text-xs text-gray-600 dark:text-gray-400">
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
                    <span className="text-gray-700 dark:text-gray-200">
                      {row.pct}%
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 dark:bg-slate-800 rounded mt-1">
                    <div
                      className="h-2 rounded bg-black dark:bg-white"
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
        <div className="p-4 border rounded-2xl bg-white shadow-sm dark:bg-slate-900">
          <h2 className="font-semibold">Tabla de supervivientes</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm mt-3">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400">
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

        <div className="p-4 border rounded-2xl bg-white shadow-sm dark:bg-slate-900">
          <h2 className="font-semibold">Historial de tus picks</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm mt-3">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400">
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

      {/* Modal confirmación */}
      {pendingPick && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl p-5 border shadow-xl">
            <h3 className="font-semibold text-lg">Confirmar pick</h3>
            <p className="mt-2 text-sm">
              ¿Confirmas tu pick de{" "}
              <b>{pendingPick.teamId}</b> en W{week}?
            </p>
            <div className="mt-4 flex gap-2">
              <button
                className="px-4 py-2 rounded border hover:bg-gray-50 dark:hover:bg-slate-800"
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
    </div>
  );
}








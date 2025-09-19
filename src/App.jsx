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

/* ========================= Utils ========================= */
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
  const k = 0.23;
  const p = 1 / (1 + Math.exp(-k * (-spreadForTeam)));
  return Math.round(p * 100);
}

function isLiveStatus(s) {
  const x = String(s || "").toLowerCase();
  return [
    "in_progress",
    "inprogress",
    "live",
    "ongoing",
    "playing",
    "active",
  ].includes(x);
}
function hasGameEnded(g) {
  const s = String(g?.status || "").toLowerCase();
  if (
    [
      "final",
      "completed",
      "complete",
      "closed",
      "postgame",
      "ended",
      "finished",
    ].includes(s)
  )
    return true;
  const periodOk = (g?.period ?? 0) >= 4;
  const clockStr = String(g?.clock || "").trim();
  const clockDone =
    clockStr === "0:00" ||
    clockStr === "00:00" ||
    clockStr === "" ||
    clockStr === "Final";
  if (periodOk && clockDone && !isLiveStatus(s)) return true;
  if (g?.start_time) {
    const hrs = DateTime.now().diff(DateTime.fromISO(g.start_time), "hours")
      .hours;
    const haveScores = g.home_score != null && g.away_score != null;
    if (hrs >= 3.5 && haveScores) return true;
  }
  return false;
}
function computePickResultFromGame(game, teamId) {
  if (!game || !hasGameEnded(game)) return "pending";
  const hs = Number(game.home_score ?? 0);
  const as = Number(game.away_score ?? 0);
  if (hs === as) return "push";
  const winner = hs > as ? game.home_team : game.away_team;
  return winner === teamId ? "win" : "loss";
}
function isPickFrozen(pick, gamesMap) {
  if (!pick) return false;
  const g = gamesMap[pick.game_id];
  if (!g) return false;
  if (pick.result && pick.result !== "pending") return true;
  return DateTime.fromISO(g.start_time) <= DateTime.now() || hasGameEnded(g);
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
  const [tab, setTab] = useState("password");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [signup, setSignup] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  // --- Recuperación de contraseña ---
  const [resetSent, setResetSent] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPwd1, setNewPwd1] = useState("");
  const [newPwd2, setNewPwd2] = useState("");
  const [updatingPwd, setUpdatingPwd] = useState(false);

  // Si el usuario llega desde el email de recuperación (?type=recovery en el hash)
  useEffect(() => {
    const hash = window.location.hash || "";
    if (hash.includes("type=recovery")) {
      setRecoveryMode(true);
      setTab("password");
    }
  }, []);

  // También escuchamos eventos de Supabase por si marca PASSWORD_RECOVERY
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryMode(true);
        setTab("password");
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const doPassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (signup) {
        const { error } = await supabase.auth.signUp({
          email,
          password: pwd,
          options: { emailRedirectTo: import.meta.env.VITE_SITE_URL || window.location.origin },
        });
        if (error) throw error;
        alert("Cuenta creada. Revisa tu correo para confirmar.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pwd });
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
      options: { emailRedirectTo: import.meta.env.VITE_SITE_URL || window.location.origin },
    });
    if (!error) setSent(true);
    else alert(error.message);
  };

  // Enviar correo de recuperación
  const sendReset = async () => {
    if (!email) return alert("Escribe tu email primero.");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: import.meta.env.VITE_SITE_URL || window.location.origin,
      });
      if (error) throw error;
      setResetSent(true);
    } catch (e) {
      alert(e.message);
    }
  };

  // Guardar nueva contraseña tras volver del link
  const setNewPassword = async (e) => {
    e?.preventDefault?.();
    if (!newPwd1 || newPwd1.length < 6) return alert("La nueva contraseña debe tener al menos 6 caracteres.");
    if (newPwd1 !== newPwd2) return alert("Las contraseñas no coinciden.");
    setUpdatingPwd(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPwd1 });
      if (error) throw error;
      alert("Contraseña actualizada ✅");
      setRecoveryMode(false);
      setNewPwd1(""); setNewPwd2("");
    } catch (e) {
      alert(e.message);
    } finally {
      setUpdatingPwd(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-6">
      <div className="w-full max-w-md border rounded-2xl p-6 bg-white card">
        <h1 className="text-2xl font-extrabold text-center">{LEAGUE}</h1>

        {/* Si estamos en modo recuperación, mostrar directamente el formulario para nueva contraseña */}
        {recoveryMode ? (
          <form onSubmit={setNewPassword} className="mt-4 space-y-3">
            <p className="text-sm text-gray-700">
              Ingresa tu nueva contraseña para tu cuenta.
            </p>
            <input
              className="border p-2 w-full rounded-lg"
              type="password"
              placeholder="Nueva contraseña"
              value={newPwd1}
              onChange={(e) => setNewPwd1(e.target.value)}
              required
            />
            <input
              className="border p-2 w-full rounded-lg"
              type="password"
              placeholder="Confirmar nueva contraseña"
              value={newPwd2}
              onChange={(e) => setNewPwd2(e.target.value)}
              required
            />
            <button className="bg-black text-white w-full py-2 rounded-lg disabled:opacity-60" disabled={updatingPwd}>
              Guardar contraseña
            </button>
            <button type="button" className="w-full py-2 rounded-lg border" onClick={() => setRecoveryMode(false)}>
              Volver
            </button>
          </form>
        ) : (
          <>
            <div className="mt-4 flex gap-2 justify-center">
              <button
                className={clsx("px-3 py-1 rounded border", tab === "password" && "bg-black text-white")}
                onClick={() => setTab("password")}
              >
                Email + Password
              </button>
              <button
                className={clsx("px-3 py-1 rounded border", tab === "magic" && "bg-black text-white")}
                onClick={() => setTab("magic")}
              >
                Magic link
              </button>
            </div>

            {tab === "password" && (
              <form onSubmit={doPassword} className="mt-4 space-y-3">
                <div className="text-sm flex justify-between">
                  <span>{signup ? "Crear cuenta" : "Iniciar sesión"}</span>
                  <button type="button" className="underline" onClick={() => setSignup(!signup)}>
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
                <button className="bg-black text-white w-full py-2 rounded-lg disabled:opacity-60" disabled={busy}>
                  {signup ? "Crear cuenta" : "Entrar"}
                </button>

                <div className="text-xs text-gray-600 flex items-center justify-between">
                  <span>¿Olvidaste tu contraseña?</span>
                  <button type="button" className="underline" onClick={sendReset}>
                    Recuperarla
                  </button>
                </div>
                {resetSent && <p className="text-xs text-emerald-700">Te envié un correo con el enlace para cambiarla.</p>}
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
                <button className="bg-black text-white w-full py-2 rounded-lg">Enviar magic link</button>
                {sent && <p className="text-xs text-gray-500">Revisa tu correo.</p>}
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}


/* ========================= Root con tabs ========================= */
export default function AppRoot() {
  const session = useSession();

  // Kill-switch de Service Worker para evitar pantalla blanca por caché vieja
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistrations?.()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => {});
    }
  }, []);

  const [view, setView] = useState("game"); // game | standings | assistant | news | rules
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
        <GamesTab session={session} />
      ) : view === "standings" ? (
        <StandingsTab />
      ) : view === "assistant" ? (
        <AssistantTab session={session} />
      ) : view === "news" ? (
        <NewsTab />
      ) : (
        <Rules />
      )}
    </div>
  );
}

/* -------- Autopick buttons (restaurar) -------- */
function AutoPickButtons({ week, session }) {
  const uid = session?.user?.id || null;

  const autopickMe = async () => {
    if (!uid) return alert("Iniciando sesión… intenta en unos segundos.");
    try {
      const url = `${SITE}/api/control?action=autopickOne&week=${week}&user_id=${encodeURIComponent(
        uid
      )}&token=${encodeURIComponent(CRON_TOKEN)}`;
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || "Error autopick");
      alert("Autopick aplicado para ti.");
    } catch (e) {
      alert(e.message);
    }
  };

  const autopickLeague = async () => {
    try {
      const url = `${SITE}/api/control?action=autopick&week=${week}&token=${encodeURIComponent(
        CRON_TOKEN
      )}`;
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false)
        throw new Error(j.error || "Error autopick liga");
      alert("Autopick de liga listo.");
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <>
      <button className="text-xs px-3 py-1 rounded border" onClick={autopickMe}>
        Autopick para mí
      </button>
      <button className="text-xs px-3 py-1 rounded border" onClick={autopickLeague}>
        Autopick (liga)
      </button>
    </>
  );
}


/* ========================= PARTIDOS ========================= */
/* ========================= PARTIDOS ========================= */
/* ========================= PARTIDOS ========================= */
/* ========================= PARTIDOS ========================= */
/* ========================= PARTIDOS ========================= */
/* ========================= PARTIDOS (GamesTab) ========================= */
function GamesTab({ session }) {
  const uid = session?.user?.id || null;

  // ---- Estado base ----
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
  const [pendingPick, setPendingPick] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [allGamesSeason, setAllGamesSeason] = useState([]);
  const [allPicksSeason, setAllPicksSeason] = useState([]);
  const [playerStandings, setPlayerStandings] = useState([]);

  const [resultBanner, setResultBanner] = useState(null);
  const [details, setDetails] = useState(null); // { game, odds, popHome, popAway }

  // ---- Datos del modal Detalles ----
  const [oddsHistory, setOddsHistory] = useState([]); // historial odds
  const [leaders, setLeaders] = useState([]);         // líderes
  const [notes, setNotes] = useState([]);             // comentarios
  const [newNote, setNewNote] = useState("");
  const [detailsTab, setDetailsTab] = useState("resumen"); // resumen | odds | leaders | notes

  // ---- Filtros / búsqueda ----
  const [dayFilter, setDayFilter] = useState(localStorage.getItem("dayFilter") || "ALL");
  const [teamQuery, setTeamQuery] = useState(localStorage.getItem("teamQuery") || "");
  const [statusFilter, setStatusFilter] = useState(localStorage.getItem("statusFilter") || "ALL"); // ALL|LIVE|FINAL|UPCOMING
  const searchRef = useRef(null);

  // ---- Favoritos + diferenciales ----
  const [onlyDiff, setOnlyDiff] = useState(() => localStorage.getItem("onlyDiff") === "1");
  const [diffCutoff, setDiffCutoff] = useState(() => Number(localStorage.getItem("diffCutoff") || 20));
  const [pinned, setPinned] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pinnedGames") || "[]"); } catch { return []; }
  });

  // ---- Clima / meta / tips (opcional) ----
  const [weatherMap, setWeatherMap] = useState({}); // game_id -> { temp_c, precip_mm, wind_kph, condition, updated_at }
  const [metaMap, setMetaMap] = useState({});       // game_id -> { stadium, city, tv }
  const [tipsMap, setTipsMap] = useState({});       // game_id -> [ { tip, kind } ]

  // ---- Detalles avanzados tipo ESPN ----
  const [betSplits, setBetSplits] = useState(null);       // tickets/money split
  const [teamStats, setTeamStats] = useState(null);       // comparativa temporada
  const [injuries, setInjuries] = useState([]);           // lesionados
  const [recentForm, setRecentForm] = useState({ home: [], away: [] });

  // ---- Realtime ----
  useEffect(() => {
    const ch = supabase
      .channel("realtime-app")
      .on("postgres_changes", { event: "*", schema: "public", table: "picks" }, (payload) => {
        const wk = payload.new?.week ?? payload.old?.week;
        const ssn = payload.new?.season ?? payload.old?.season;
        if (wk === week && ssn === SEASON) {
          loadMyPicks();
          loadLeaguePicks(week);
          setLastUpdated(new Date().toISOString());
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "games" }, (payload) => {
        const wk = payload.new?.week ?? payload.old?.week;
        const ssn = payload.new?.season ?? payload.old?.season;
        if (wk === week && ssn === SEASON) {
          loadGames(week);
          setLastUpdated(new Date().toISOString());
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "odds" }, () => {
        loadGames(week);
        setLastUpdated(new Date().toISOString());
      })
      .subscribe();
    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [week]);

  /* ---------- Cargas ---------- */
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
        .select("game_id, spread_home, spread_away, ml_home, ml_away, fetched_at")
        .in("game_id", ids)
        .order("fetched_at", { ascending: false });
      const by = {};
      for (const row of data || []) {
        if (!by[row.game_id]) by[row.game_id] = { last: row, prev: null };
        else if (!by[row.game_id].prev) by[row.game_id].prev = row;
      }
      setOddsPairs(by);
      // meta/clima/tips
      loadGameMetaWeather(ids);
      loadGameTips(ids);
    } else {
      setOddsPairs({}); setWeatherMap({}); setMetaMap({}); setTipsMap({});
    }
  };

  async function loadGameMetaWeather(ids) {
    try {
      const { data: metas } = await supabase
        .from("game_meta").select("game_id, stadium, city, tv").in("game_id", ids);
      const mm = {}; (metas || []).forEach(m => { mm[m.game_id] = { stadium: m.stadium, city: m.city, tv: m.tv }; });
      setMetaMap(mm);
    } catch {}
    try {
      const { data: ws } = await supabase
        .from("weather")
        .select("game_id, temp_c, precip_mm, wind_kph, condition, updated_at")
        .in("game_id", ids);
      const wm = {}; (ws || []).forEach(w => { wm[w.game_id] = w; });
      setWeatherMap(wm);
    } catch {}
  }

  async function loadGameTips(ids) {
    try {
      const { data: tps } = await supabase
        .from("game_tips")
        .select("game_id, tip, kind")
        .in("game_id", ids)
        .limit(200);
      const tm = {};
      (tps || []).forEach(t => {
        if (!tm[t.game_id]) tm[t.game_id] = [];
        tm[t.game_id].push({ tip: t.tip, kind: t.kind });
      });
      setTipsMap(tm);
    } catch {}
  }

  const loadMyPicks = async () => {
    if (!uid) return;
    const { data: pk } = await supabase.from("picks").select("*").eq("user_id", uid).eq("season", SEASON);
    setPicks(pk || []);
  };

  const loadLeaguePicks = async (w) => {
    const { data: pks } = await supabase
      .from("picks")
      .select("id,user_id,team_id,result,auto_pick,updated_at,week,season,game_id")
      .eq("week", w)
      .eq("season", SEASON);
    setLeaguePicks(pks || []);
    const ids = [...new Set((pks || []).map((x) => x.user_id))];
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id,display_name").in("id", ids);
      const m = {}; (profs || []).forEach((p) => (m[p.id] = p.display_name)); setUserNames(m);
    } else setUserNames({});

    let totalPlayers = 0;
    try {
      const { count } = await supabase.from("profiles").select("*", { count: "exact", head: true });
      totalPlayers = count || 0;
    } catch {
      const { data: std } = await supabase.from("standings").select("user_id");
      totalPlayers = std?.length || 0;
    }
    const counts = {};
    (pks || []).forEach((x) => { if (x.team_id) counts[x.team_id] = (counts[x.team_id] || 0) + 1; });
    const list = Object.entries(counts)
      .map(([team_id, count]) => ({ team_id, count, pct: totalPlayers ? Math.round((count * 100) / totalPlayers) : 0 }))
      .sort((a, b) => b.count - a.count);
    setPopularity(list);
  };

  const loadSeasonData = async () => {
    const { data: gs } = await supabase.from("games").select("*").eq("season", SEASON);
    setAllGamesSeason(gs || []);
    const { data: pks } = await supabase
      .from("picks")
      .select("id,user_id,team_id,game_id,week,season,result,updated_at")
      .eq("season", SEASON);
    setAllPicksSeason(pks || []);
  };

  const recomputePlayerStandings = (allPicks, allGames) => {
    const gm = {}; (allGames || []).forEach((g) => (gm[g.id] = g));
    const agg = new Map();
    (allPicks || []).forEach((p) => {
      const g = gm[p.game_id]; if (!g) return;
      const res = p.result && p.result !== "pending" ? p.result : computePickResultFromGame(g, p.team_id);
      if (res === "pending") return;
      const row = agg.get(p.user_id) || { w: 0, l: 0, t: 0 };
      if (res === "win") row.w++; else if (res === "loss") row.l++; else if (res === "push") row.t++;
      agg.set(p.user_id, row);
    });
    return [...agg.entries()]
      .map(([user_id, { w, l, t }]) => ({ user_id, w, l, t }))
      .sort((a, b) => b.w - a.w || a.l - b.l || b.t - a.t);
  };

  const initAll = async () => {
    if (!uid) return;
    const email = session.user.email;
    let { data: prof } = await supabase.from("profiles").select("*").eq("email", email).single();
    if (!prof) {
      await supabase.from("profiles").insert({
        id: uid, email, display_name: email.split("@")[0], lives: 2,
      });
      const r = await supabase.from("profiles").select("*").eq("email", email).single();
      prof = r.data;
    }
    setMe(prof);

    await loadTeams();
    await loadGames(week);
    await loadMyPicks();
    const { data: st } = await supabase.from("standings").select("*");
    setStandings(st || []);
    await loadLeaguePicks(week);
    await loadSeasonData();
    setLastUpdated(new Date().toISOString());
  };

  useEffect(() => { initAll(); /* eslint-disable-next-line */ }, [uid]);

  useEffect(() => {
    loadGames(week);
    loadLeaguePicks(week);
    localStorage.setItem("week", String(week));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  useEffect(() => localStorage.setItem("dayFilter", dayFilter), [dayFilter]);
  useEffect(() => localStorage.setItem("teamQuery", teamQuery), [teamQuery]);
  useEffect(() => localStorage.setItem("statusFilter", statusFilter), [statusFilter]);
  useEffect(() => localStorage.setItem("onlyDiff", onlyDiff ? "1" : "0"), [onlyDiff]);
  useEffect(() => localStorage.setItem("diffCutoff", String(diffCutoff)), [diffCutoff]);
  useEffect(() => localStorage.setItem("pinnedGames", JSON.stringify(pinned)), [pinned]);

  useEffect(() => {
    if (!allGamesSeason?.length || !allPicksSeason?.length) return;
    setPlayerStandings(recomputePlayerStandings(allPicksSeason, allGamesSeason));
  }, [allGamesSeason, allPicksSeason]);

  /* ---------- helpers picks ---------- */
  const myPickThisWeek = useMemo(
    () => (picks || []).find((p) => p.week === week && p.season === SEASON),
    [picks, week]
  );

  const gamesMap = useMemo(() => {
    const m = {}; (games || []).forEach((g) => (m[g.id] = g)); return m;
  }, [games]);

  const pickFrozen = useMemo(() => isPickFrozen(myPickThisWeek, gamesMap), [myPickThisWeek, gamesMap]);

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

  const canPick = (candidateGame, candidateTeam) => {
    if (!uid) return { ok: false, reason: "NOSESSION" };
    if ((me?.lives ?? 0) <= 0) return { ok: false, reason: "ELIMINATED" };
    if (pickFrozen) {
      const same = myPickThisWeek?.game_id === candidateGame.id && myPickThisWeek?.team_id === candidateTeam;
      if (!same) return { ok: false, reason: "FROZEN" };
    }
    if (DateTime.fromISO(candidateGame.start_time) <= DateTime.now()) return { ok: false, reason: "LOCK" };
    const used = (picks || []).some((p) => p.team_id === candidateTeam && p.user_id === uid);
    if (used && !(myPickThisWeek && myPickThisWeek.team_id === candidateTeam)) return { ok: false, reason: "USED" };
    return { ok: true };
  };

  const confirmPick = (game, teamId) => {
    const c = canPick(game, teamId);
    if (!c.ok) {
      const msg =
        c.reason === "ELIMINATED" ? "Estás eliminado 😵‍💫. Puedes ver cómo van los demás, pero ya no puedes pickear."
        : c.reason === "FROZEN" ? "Tu pick ya quedó congelado porque su partido ya inició/terminó."
        : c.reason === "LOCK" ? "Este partido ya está cerrado por kickoff."
        : c.reason === "NOSESSION" ? "Iniciando sesión… intenta de nuevo en unos segundos."
        : "Ya usaste este equipo antes.";
      return alert(msg);
    }
    setPendingPick({ game, teamId });
  };

  const doPick = async () => {
    if (!pendingPick || !uid) return;
    const { game, teamId } = pendingPick;
    if (myPickThisWeek) {
      const { error } = await supabase
        .from("picks")
        .update({ team_id: teamId, game_id: game.id, updated_at: new Date().toISOString() })
        .eq("id", myPickThisWeek.id);
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from("picks").insert({
        user_id: uid, game_id: game.id, team_id: teamId, week, season: SEASON,
      });
      if (error) return alert(error.message);
    }
    await loadMyPicks(); await loadLeaguePicks(week); await loadSeasonData();
    const { data: st } = await supabase.from("standings").select("*"); setStandings(st || []);
    setPendingPick(null); setLastUpdated(new Date().toISOString());
  };

  function derivedResultForPick(pick) {
    if (!pick) return "pending";
    if (pick?.result && pick.result !== "pending") return pick.result;
    const g = gamesMap[pick?.game_id]; if (!g) return "pending";
    return computePickResultFromGame(g, pick.team_id);
  }

  const bannerKey = (w, u) => `resultShown-W${w}-${u}`;
  const livesKey = (w, u) => `livesApplied-W${w}-${u}`;

  async function applyLivesIfNeeded(outcome) {
    if (outcome !== "loss" || !uid) return;
    const lk = livesKey(week, uid);
    if (localStorage.getItem(lk)) return;
    try {
      const { data: profNow } = await supabase.from("profiles").select("lives").eq("id", uid).single();
      const currentLives = profNow?.lives ?? me?.lives ?? 0;
      const newLives = Math.max(0, currentLives - 1);
      if (newLives !== currentLives) {
        await supabase.from("profiles").update({ lives: newLives }).eq("id", uid);
        setMe((m) => ({ ...m, lives: newLives }));
      }
    } catch (e) { console.warn("applyLivesIfNeeded error:", e.message); }
    finally { localStorage.setItem(lk, "1"); }
  }

  function funnyMsg(res) { if (res === "win") return "¡Ganaste esta semana! 🕺"; if (res === "loss") return "Perdiste esta semana 😬…"; return "Push… ni fu ni fa."; }
  async function onMyPickResolved(res) { setResultBanner({ type: res, msg: funnyMsg(res) }); if (res === "loss") await applyLivesIfNeeded(res); }

  async function settleMyPicksIfNeeded(currentWeek, gamesArr, myPicksArr) {
    const finals = {}; (gamesArr || []).forEach((g) => { if (hasGameEnded(g)) finals[g.id] = g; });
    const updates = []; let myResolvedResult = null;
    (myPicksArr || []).forEach((p) => {
      if (p.week !== currentWeek) return;
      const g = finals[p.game_id]; if (!g) return;
      const res = computePickResultFromGame(g, p.team_id);
      if ((!p.result || p.result === "pending") && res !== "pending") {
        updates.push({ id: p.id, result: res }); if (p.user_id === uid) myResolvedResult = res;
      }
    });
    if (updates.length) {
      for (const row of updates) {
        const { error } = await supabase.from("picks").update({ result: row.result }).eq("id", row.id);
        if (error) console.warn("settleMyPicksIfNeeded error:", error.message);
      }
    }
    if (myResolvedResult && uid) {
      const key = bannerKey(currentWeek, uid);
      if (!localStorage.getItem(key)) { await onMyPickResolved(myResolvedResult); localStorage.setItem(key, "1"); }
    }
  }

  async function settleLeaguePicksIfNeeded(currentWeek, gamesArr, leaguePicksArr) {
    const finals = {}; (gamesArr || []).forEach((g) => { if (hasGameEnded(g)) finals[g.id] = g; });
    const updates = [];
    (leaguePicksArr || []).forEach((p) => {
      if (p.week !== currentWeek) return;
      if (p.result && p.result !== "pending") return;
      const g = finals[p.game_id]; if (!g) return;
      const res = computePickResultFromGame(g, p.team_id);
      if (res !== "pending") updates.push({ id: p.id, result: res });
    });
    if (updates.length) {
      for (const row of updates) {
        const { error } = await supabase.from("picks").update({ result: row.result }).eq("id", row.id);
        if (error) console.warn("settleLeaguePicksIfNeeded error:", error.message);
      }
    }
  }

  useEffect(() => {
    if (!games?.length) return;
    if (picks?.length) settleMyPicksIfNeeded(week, games, picks);
    if (leaguePicks?.length) settleLeaguePicksIfNeeded(week, games, leaguePicks);
    (async () => {
      try {
        const url = `${SITE}/api/control?action=settleWeek&week=${week}&token=${encodeURIComponent(CRON_TOKEN)}`;
        await fetch(url);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, picks, leaguePicks, week, uid]);

  useEffect(() => {
    if (!myPickThisWeek || !uid) return;
    const res = derivedResultForPick(myPickThisWeek);
    if (res === "pending") return;
    const bk = bannerKey(week, uid);
    if (!localStorage.getItem(bk)) {
      setResultBanner({ type: res, msg: funnyMsg(res) });
      localStorage.setItem(bk, "1");
    }
    if (res === "loss") applyLivesIfNeeded(res);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPickThisWeek, gamesMap, week, uid]);

  // Auto-refresh si hay juegos en vivo
  useEffect(() => {
    if (!games?.length) return;
    const anyLive = (games || []).some((g) => isLiveStatus(g.status));
    if (!anyLive) return;
    const id = setInterval(() => { loadGames(week); }, 25_000);
    return () => clearInterval(id);
  }, [games, week]);

  /* ---------- UI helpers ---------- */
  const TeamMini = ({ id }) => {
    const logo = teamsMap[id]?.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-1">
        <img src={logo} alt={id} className="h-5 w-5 object-contain" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
        <span className="font-mono font-semibold">{id}</span>
      </span>
    );
  };

  const TeamChip = ({ id }) => {
    const t = teamsMap[id] || {};
    const logo = t.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-2">
        <img src={logo} alt={id} className="h-6 w-6 object-contain" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
        <span className="font-medium">{t.name || id}</span>
      </span>
    );
  };

  const ScoreStrip = ({ g }) => {
    const ended = hasGameEnded(g);
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
    if (ended) return (<div className="flex items-center justify-between">{score}<span className="badge">FINAL</span></div>);
    if (isLiveStatus(g.status))
      return (
        <div className="flex items-center justify-between">
          {score}
          <div className="text-xs flex items-center gap-2">
            {g.period != null && <span className="badge badge-warn">Q{g.period} {g.clock || ""}</span>}
            {g.down != null && g.distance != null && <span className="badge">@ {g.down}&amp;{g.distance}</span>}
            {g.possession && <span className="badge">⬤ {g.possession}</span>}
            {g.red_zone && <span className="badge badge-danger">Red Zone</span>}
          </div>
        </div>
      );
    return (
      <div className="flex items-center justify-between">
        {score}
        <span className="badge">Kickoff en&nbsp;<Countdown iso={g.start_time} /></span>
      </div>
    );
  };

  // Badges SNF/MNF/TNF/Playoffs
  function timeBadge(g) {
    const lt = DateTime.fromISO(g.start_time).setZone(TZ);
    const wd = lt.weekday; const hour = lt.hour;
    if (g.is_playoffs) return "Playoffs";
    if (wd === 1 && hour >= 19) return "MNF";
    if (wd === 5 && hour >= 19) return "TNF";
    if (wd === 7 && hour >= 19) return "SNF";
    return null;
  }

  // Rachas y H2H
  function teamStreak(teamId) {
    const gamesTeam = (allGamesSeason || [])
      .filter(x => x.home_team === teamId || x.away_team === teamId)
      .sort((a,b) => DateTime.fromISO(b.start_time) - DateTime.fromISO(a.start_time));
    let streak = 0, type = null;
    for (const g of gamesTeam) {
      if (!hasGameEnded(g)) continue;
      const res = computePickResultFromGame(g, teamId);
      if (res === "win") { if (type === "W" || type === null) { type = "W"; streak++; } else break; }
      else if (res === "loss") { if (type === "L" || type === null) { type = "L"; streak++; } else break; }
      else { if (type === null) continue; else break; }
    }
    return streak ? `${type}${streak}` : "—";
  }

  function lastMatchupsSummary(homeId, awayId, maxN = 5) {
    const relevant = (allGamesSeason || [])
      .filter(x =>
        (x.home_team === homeId && x.away_team === awayId) ||
        (x.home_team === awayId && x.away_team === homeId)
      )
      .sort((a,b) => DateTime.fromISO(b.start_time) - DateTime.fromISO(a.start_time))
      .slice(0, maxN);
    return relevant.map(g => {
      const h = g.home_team, a = g.away_team;
      const hs = g.home_score ?? 0, as = g.away_score ?? 0;
      const winner = hs === as ? "TIE" : (hs > as ? h : a);
      return { when: DateTime.fromISO(g.start_time).setZone(TZ).toFormat("dd LLL yyyy"), h, a, hs, as, winner };
    });
  }

  // Delta de spread
  function spreadDeltaFor(gameId, side /* 'home' | 'away' */) {
    const pair = oddsPairs[gameId];
    if (!pair?.last || !pair?.prev) return null;
    const last = side === "home" ? pair.last.spread_home : pair.last.spread_away;
    const prev = side === "home" ? pair.prev.spread_home : pair.prev.spread_away;
    if (last == null || prev == null) return null;
    const d = Number(last) - Number(prev);
    if (!isFinite(d) || d === 0) return 0;
    return Math.round(d * 10) / 10;
  }

  function togglePin(gameId) {
    setPinned((xs) => (xs.includes(gameId) ? xs.filter((id) => id !== gameId) : [...xs, gameId]));
  }

  async function copyGameLink(g) {
    const url = `${SITE}?week=${week}#game-${g.id}`;
    try { await navigator.clipboard.writeText(url); alert("Enlace copiado"); } catch { alert(url); }
  }

  function statusOf(g) {
    if (hasGameEnded(g)) return "FINAL";
    if (isLiveStatus(g.status)) return "LIVE";
    if (DateTime.fromISO(g.start_time) > DateTime.now()) return "UPCOMING";
    return "UPCOMING";
  }

  /* ---------- filtros ---------- */
  const gamesByDay = useMemo(() => {
    if (dayFilter === "ALL") return games;
    const map = { THU: 4, FRI: 5, SAT: 6, SUN: 7, MON: 1 };
    const want = map[dayFilter];
    return (games || []).filter((g) => DateTime.fromISO(g.start_time).setZone(TZ).weekday === want);
  }, [games, dayFilter]);

  const gamesFiltered = useMemo(() => {
    const q = teamQuery.trim().toLowerCase();
    let base = gamesByDay || [];
    if (q) {
      const match = (id) => {
        const t = teamsMap[id];
        return id.toLowerCase().includes(q) || (t?.name || "").toLowerCase().includes(q);
      };
      base = base.filter((g) => match(g.away_team) || match(g.home_team));
    }
    if (statusFilter !== "ALL") base = base.filter((g) => statusOf(g) === statusFilter);
    if (onlyDiff) {
      base = base.filter((g) => {
        const homePct = popPct(g.home_team);
        const awayPct = popPct(g.away_team);
        return homePct < diffCutoff || awayPct < diffCutoff;
      });
    }
    const setPins = new Set(pinned);
    return base.slice().sort((a, b) => {
      const ap = setPins.has(a.id) ? 1 : 0;
      const bp = setPins.has(b.id) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return DateTime.fromISO(a.start_time) - DateTime.fromISO(b.start_time);
    });
  }, [gamesByDay, teamQuery, teamsMap, statusFilter, onlyDiff, diffCutoff, pinned]);

  /* ---- Mini sparkline ---- */
  const Sparkline = ({ series }) => {
    if (!series?.length) return <div className="text-xs text-gray-400">Sin historial</div>;
    const w = 220, h = 60, p = 4;
    const xs = series.map((v, i) => ({ x: i, y: Number(v) }));
    const ys = xs.map((d) => d.y);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const xScale = (i) => (i / (xs.length - 1 || 1)) * (w - p * 2) + p;
    const yScale = (v) => (h - p) - ((v - minY) / (maxY - minY || 1)) * (h - p * 2);
    const d = xs.map((pt, i) => `${i === 0 ? "M" : "L"}${xScale(pt.x)},${yScale(pt.y)}`).join(" ");
    return (<svg width={w} height={h} className="block"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" /></svg>);
  };

  // Win% helper
  function winPctForTeam(game, teamId) {
    const pair = oddsPairs[game.id];
    if (!pair?.last) return null;
    const sp = teamId === game.home_team ? pair.last.spread_home : pair.last.spread_away;
    return sp != null ? winProbFromSpread(sp) : null;
  }

  /* ---- Cargar Detalles (ampliado tipo ESPN) ---- */
  async function openDetails(g) {
    const { last, prev } = oddsPairs[g.id] || {};
    const popHome = popPct(g.home_team);
    const popAway = popPct(g.away_team);
    setDetails({ game: g, odds: { last, prev }, popHome, popAway });
    setDetailsTab("resumen");

    // Historial odds
    const { data: oh } = await supabase
      .from("odds_history")
      .select("fetched_at, spread_home, spread_away, ml_home, ml_away")
      .eq("game_id", g.id)
      .order("fetched_at", { ascending: true })
      .limit(200);
    setOddsHistory(oh || []);

    // Líderes
    const { data: gl } = await supabase
      .from("game_leaders")
      .select("side, player, stat, value")
      .eq("game_id", g.id)
      .order("side").order("stat");
    setLeaders(gl || []);

    // Notas
    const { data: ns } = await supabase
      .from("game_notes")
      .select("id, user_id, note, created_at")
      .eq("game_id", g.id)
      .order("created_at", { ascending: false })
      .limit(100);
    setNotes(ns || []);

    // Betting splits
    try {
      const { data: bs } = await supabase
        .from("betting_splits")
        .select("tickets_home, tickets_away, money_home, money_away, updated_at")
        .eq("game_id", g.id)
        .single();
      setBetSplits(bs || null);
    } catch { setBetSplits(null); }

    // Team stats temporada
    try {
      const { data: stats } = await supabase
        .from("season_team_stats")
        .select("team_id, ppg, ypg, pass_ypg, rush_ypg, opp_ppg, opp_ypg, third_down, red_zone, to_diff, sacks")
        .in("team_id", [g.home_team, g.away_team]);
      const home = (stats || []).find(s => s.team_id === g.home_team) || {};
      const away = (stats || []).find(s => s.team_id === g.away_team) || {};
      setTeamStats({ home, away });
    } catch { setTeamStats(null); }

    // Lesiones
    try {
      const { data: inj } = await supabase
        .from("injuries")
        .select("team_id, player, status, note")
        .in("team_id", [g.home_team, g.away_team])
        .order("team_id");
      setInjuries(inj || []);
    } catch { setInjuries([]); }

    // Últimos 5
    try {
      const { data: recs } = await supabase
        .from("team_recent_games")
        .select("team_id, date, opp, is_home, result, score")
        .in("team_id", [g.home_team, g.away_team])
        .order("date", { ascending: false });
      const take5 = (t) => (recs || []).filter(r => r.team_id === t).slice(0, 5);
      setRecentForm({ home: take5(g.home_team), away: take5(g.away_team) });
    } catch { setRecentForm({ home: [], away: [] }); }
  }

  async function addNote() {
    if (!details || !newNote.trim() || !uid) return;
    const row = { game_id: details.game.id, user_id: uid, note: newNote.trim() };
    const { error, data } = await supabase.from("game_notes").insert(row).select("id,user_id,note,created_at").single();
    if (!error && data) { setNotes((xs) => [data, ...xs]); setNewNote(""); } else { alert(error?.message || "No se pudo guardar la nota."); }
  }

  /* ---- Botón de pick por equipo ---- */
  const TeamBox = ({ game, teamId }) => {
    const disabled = !canPick(game, teamId).ok;
    const selected = myPickThisWeek?.game_id === game.id && myPickThisWeek?.team_id === teamId;
    const { last } = oddsPairs[game.id] || {};
    const fav =
      last &&
      ((teamId === game.home_team &&
        (((last.spread_home ?? 0) < (last.spread_away ?? 0)) || (last.ml_home ?? 9999) < (last.ml_away ?? 9999))) ||
        (teamId === game.away_team &&
          (((last.spread_away ?? 0) < (last.spread_home ?? 0)) || (last.ml_away ?? 9999) < (last.ml_home ?? 9999))));
    const pct = popPct(teamId);
    const wp = winPctForTeam(game, teamId);
    const titleTxt = `${teamId} · Win% ${wp ?? "—"} · Popularidad ${pct}%`;

    return (
      <button
        title={titleTxt}
        onClick={() => confirmPick(game, teamId)}
        disabled={disabled}
        className={clsx(
          "w-full text-left rounded-xl border transition px-4 py-3",
          selected ? "border-emerald-500 bg-emerald-50 card" : "border-gray-200 hover:bg-gray-50 card",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <div className="flex items-center justify-between">
          <TeamMini id={teamId} />
          <div className="flex items-center gap-2">
            {fav && <span className="badge badge-warn">Fav</span>}
            {pct < 15 && <span className="badge">DIF</span>}
          </div>
        </div>
      </button>
    );
  };

  /* ========================= Standings helpers (W–L–T) ========================= */
  /** Devuelve nombre legible con prioridad: standings.display_name -> userNames -> id abreviado */
  const displayNameFor = (userId) => {
    const byStand = (standings || []).find(s => s.user_id === userId)?.display_name;
    if (byStand) return byStand;
    if (userNames[userId]) return userNames[userId];
    return userId?.slice(0, 6) || "—";
  };

  /** Win% con 1 decimal */
  const winPct = (w, l, t = 0) => {
    const gp = w + l + t;
    if (!gp) return "—";
    return `${((w / gp) * 100).toFixed(1)}%`;
  };

  /** Lista ordenada de standings de liga priorizando tabla standings y, si no, playerStandings */
  const leagueStandings = useMemo(() => {
    if ((standings || []).length) {
      return (standings || [])
        .map(s => ({
          user_id: s.user_id,
          name: s.display_name || displayNameFor(s.user_id),
          w: Number(s.wins ?? s.w ?? 0),
          l: Number(s.losses ?? s.l ?? 0),
          t: Number(s.pushes ?? s.t ?? 0),
          lives: Number(s.lives ?? 0)
        }))
        .sort((a, b) => b.w - a.w || a.l - b.l || b.t - a.t || a.name.localeCompare(b.name));
    }
    return (playerStandings || [])
      .map(r => ({
        user_id: r.user_id,
        name: displayNameFor(r.user_id),
        w: Number(r.w ?? 0),
        l: Number(r.l ?? 0),
        t: Number(r.t ?? 0),
        lives: (standings || []).find(s => s.user_id === r.user_id)?.lives ?? (me?.id === r.user_id ? me?.lives : undefined)
      }))
      .sort((a, b) => b.w - a.w || a.l - b.l || b.t - a.t || a.name.localeCompare(b.name));
  }, [standings, playerStandings, userNames, me?.id, me?.lives]);

  /* ========================= Render ========================= */
  const nextKick = nextKickoffISO;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">{/* container */}
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{LEAGUE}</h1>
          {lastUpdated && (
            <p className="text-xs text-gray-500">
              Actualizado: {DateTime.fromISO(lastUpdated).setZone(TZ).toFormat("dd LLL HH:mm:ss")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-700">
            Hola, <b>{me?.display_name}</b> · Vidas:{" "}
            <span
              className={clsx(
                "inline-block px-2 py-0.5 rounded",
                (me?.lives ?? 0) > 0 ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
              )}
            >
              {me?.lives ?? 0}
            </span>
          </p>
          <button className="text-sm underline" onClick={() => supabase.auth.signOut()}>Salir</button>
        </div>
      </header>

      {(me?.lives ?? 0) <= 0 && (
        <div className="mt-3 p-3 border-2 border-rose-300 rounded-xl bg-rose-50 text-rose-900 text-sm">
          Estás <b>eliminado</b> 😵‍💫 — puedes seguir chismoseando la liga, pero ya no puedes pickear.
        </div>
      )}

      {showPickAlert && (me?.lives ?? 0) > 0 && (
        <div className="mt-3 p-3 border-2 border-amber-300 rounded-xl bg-amber-50 text-amber-900 text-sm">
          🔔 Aún no tienes pick en W{week}. El primer kickoff es en <b><Countdown iso={nextKick} /></b>.
        </div>
      )}

      {/* Toolbar */}
      <section className="mt-4 grid md:grid-cols-3 gap-4">
        <div className="p-4 border rounded-2xl bg-white card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Semana</label>
              <select className="border p-1 rounded-lg" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
                {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                  <option key={w} value={w}>W{w}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-1 text-xs">
              {["ALL", "THU", "FRI", "SAT", "SUN", "MON"].map((d) => (
                <button
                  key={d}
                  className={clsx("px-2 py-1 rounded border", dayFilter === d && "bg-black text-white")}
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

          {/* Estado */}
          <div className="mt-3 flex gap-1 text-xs">
            {["ALL","LIVE","FINAL","UPCOMING"].map(s => (
              <button
                key={s}
                className={clsx("px-2 py-1 rounded border", statusFilter === s && "bg-black text-white")}
                onClick={() => setStatusFilter(s)}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Diferenciales */}
          <div className="mt-3 flex items-center gap-3 text-xs">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
              Solo diferenciales
            </label>
            <div className="inline-flex items-center gap-1">
              <span>umbral:</span>
              <input
                type="number"
                className="border rounded px-2 py-1 w-16"
                min={1} max={49}
                value={diffCutoff}
                onChange={(e) => setDiffCutoff(Math.max(1, Math.min(49, Number(e.target.value) || 20)))}
              />
              <span>%</span>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="text-xs px-3 py-1 rounded border"
              onClick={() =>
                downloadCSV("mis_picks.csv", [
                  ["week", "team_id", "result", "auto_pick", "updated_at"],
                  ...(picks || []).map((p) => [p.week, p.team_id, p.result, p.auto_pick, p.updated_at]),
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
                  ...(standings || []).map((s) => [s.display_name, s.lives, s.wins, s.losses, s.pushes, s.margin_sum]),
                ])
              }
            >
              Exportar standings (CSV)
            </button>
            <AutoPickButtons week={week} session={session} />
          </div>
        </div>

        <div className="md:col-span-2 p-4 border rounded-2xl bg-white card">
          <h3 className="font-semibold">Resumen</h3>
          <p className="text-sm text-gray-600">
            Elige tu pick en los partidos de abajo. Lock “rolling” por partido. Win/Loss se marca automáticamente cuando
            el juego es FINAL. Usa los filtros para LIVE/FINAL/UPCOMING y el switch de diferenciales.
          </p>
        </div>
      </section>

      {/* Partidos */}
      <section className="mt-4 p-4 border rounded-2xl bg-white card">
        <h2 className="font-semibold mb-3">Partidos W{week}</h2>
        <div className="space-y-3">
          {gamesFiltered.map((g) => {
            const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
            const local = DateTime.fromISO(g.start_time).setZone(TZ).toFormat("EEE dd LLL HH:mm");
            const { last } = oddsPairs[g.id] || {};
            const spreadHome = last?.spread_home ?? null;
            const spreadAway = last?.spread_away ?? null;
            const mlHome = last?.ml_home ?? null;
            const mlAway = last?.ml_away ?? null;
            const wpHome = winProbFromSpread(spreadHome) ?? null;
            const wpAway = winProbFromSpread(-spreadHome) ?? (wpHome != null ? 100 - wpHome : null);

            const badge = timeBadge(g);
            const w = weatherMap[g.id];
            const m = metaMap[g.id];
            const tps = tipsMap[g.id] || [];

            const h2h = lastMatchupsSummary(g.home_team, g.away_team, 3);
            const stHome = teamStreak(g.home_team);
            const stAway = teamStreak(g.away_team);

            const lpForGame = (leaguePicks || []).filter(p => p.game_id === g.id);
            const whoPickedHome = lpForGame.filter(p => p.team_id === g.home_team).map(p => userNames[p.user_id] || p.user_id.slice(0,6));
            const whoPickedAway = lpForGame.filter(p => p.team_id === g.away_team).map(p => userNames[p.user_id] || p.user_id.slice(0,6));

            return (
              <div id={`game-${g.id}`} key={g.id} className={clsx("p-4 border rounded-xl card", locked && "opacity-60")}>
                <div className="flex items-center justify-between">
                  <div className="text-sm flex items-center gap-2 flex-wrap">
                    <TeamChip id={g.away_team} />
                    <span className="mx-1 text-gray-400">@</span>
                    <TeamChip id={g.home_team} />
                    {badge && <span className="badge">{badge}</span>}
                  </div>
                  <div className="text-xs text-gray-600 flex items-center gap-2">
                    <a
                      href={`https://www.espn.com/nfl/game/_/gameId/${g.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-gray-500"
                    >
                      Stats
                    </a>
                    <button className="underline text-gray-700" onClick={() => openDetails(g)}>Detalles</button>
                    <button className="px-2 py-0.5 rounded border" onClick={() => copyGameLink(g)}>Copiar link</button>
                    <button
                      className={clsx("px-2 py-0.5 rounded border", pinned.includes(g.id) && "bg-black text-white")}
                      onClick={() => togglePin(g.id)}
                      title={pinned.includes(g.id) ? "Desfijar" : "Fijar"}
                    >
                      {pinned.includes(g.id) ? "★ Pin" : "☆ Pin"}
                    </button>
                    <span className="badge">{local}</span>
                  </div>
                </div>

                <div className="mt-3"><ScoreStrip g={g} /></div>

                {(m || w) && (
                  <div className="mt-2 text-xs text-gray-700 flex items-center gap-2 flex-wrap">
                    {m && (
                      <span className="badge">
                        {m.stadium ? `${m.stadium}` : "Estadio —"}{m.city ? ` · ${m.city}` : ""}{m.tv ? ` · TV: ${m.tv}` : ""}
                      </span>
                    )}
                    {w && (
                      <>
                        <span className="badge">🌡️ {w.temp_c != null ? `${w.temp_c}°C` : "—"}</span>
                        <span className="badge">🌧️ {w.precip_mm != null ? `${w.precip_mm} mm` : "—"}</span>
                        <span className="badge">💨 {w.wind_kph != null ? `${w.wind_kph} kph` : "—"}</span>
                        {w.condition && <span className="badge">{w.condition}</span>}
                      </>
                    )}
                  </div>
                )}

                <div className="mt-2 text-xs text-gray-700 flex items-center gap-3 flex-wrap">
                  {spreadHome != null && (
                    <span className="badge">
                      Spread: {g.home_team} {spreadHome > 0 ? `+${spreadHome}` : spreadHome}, {g.away_team} {spreadAway > 0 ? `+${spreadAway}` : spreadAway}
                    </span>
                  )}
                  {mlHome != null && mlAway != null && (
                    <span className="badge">ML: {g.home_team} {mlHome}, {g.away_team} {mlAway}</span>
                  )}
                  {(wpHome != null || wpAway != null) && (
                    <span className="badge">Win%: {g.home_team} {wpHome ?? "—"}% · {g.away_team} {wpAway ?? "—"}%</span>
                  )}
                  {(() => {
                    const dHome = spreadDeltaFor(g.id, "home");
                    const dAway = spreadDeltaFor(g.id, "away");
                    if (dHome == null && dAway == null) return null;
                    const pill = (label, d) => (
                      <span className={clsx("badge", d > 0 ? "badge-warn" : d < 0 ? "badge" : "badge")}>
                        {label}: {d > 0 ? "↑" : d < 0 ? "↓" : "→"} {d ? Math.abs(d) : 0}
                      </span>
                    );
                    return (<>{dHome != null && pill(`${g.home_team}`, dHome)}{dAway != null && pill(`${g.away_team}`, dAway)}</>);
                  })()}
                </div>

                {(tps.length || true) && (
                  <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {(tps || []).slice(0,3).map((t,i) => (
                      <div key={i} className="p-2 border rounded-lg text-xs text-gray-700 bg-white">
                        <span className="font-semibold">{t.kind ? `${t.kind}: ` : ""}</span>{t.tip}
                      </div>
                    ))}
                    <div className="p-2 border rounded-lg text-xs text-gray-700 bg-white">
                      <span className="font-semibold">Racha: </span>
                      {g.home_team} {stHome}, {g.away_team} {stAway}
                    </div>
                    {h2h.length > 0 && (
                      <div className="p-2 border rounded-lg text-xs text-gray-700 bg-white">
                        <span className="font-semibold">H2H: </span>
                        {h2h.map((r,ix) => (
                          <span key={ix} className="mr-2">{r.when}: {r.a} {r.as}–{r.hs} {r.h} ({r.winner})</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {lpForGame.length > 0 && (
                  <div className="mt-3 text-xs text-gray-700 flex gap-3 flex-wrap">
                    <div className="inline-flex items-center gap-2">
                      <span className="badge">{g.home_team}</span>
                      <span className="text-gray-600">{whoPickedHome.slice(0,6).join(", ")}{whoPickedHome.length > 6 ? "…" : ""}</span>
                    </div>
                    <div className="inline-flex items-center gap-2">
                      <span className="badge">{g.away_team}</span>
                      <span className="text-gray-600">{whoPickedAway.slice(0,6).join(", ")}{whoPickedAway.length > 6 ? "…" : ""}</span>
                    </div>
                  </div>
                )}

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

      {/* Picks + popularidad */}
      <section className="mt-6 grid md-grid-cols-2 md:grid-cols-2 gap-4">
        <div className="p-4 border rounded-2xl bg-white card">
          <h2 className="font-semibold">Picks de la liga (W{week})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm mt-3 table-minimal">
              <thead>
                <tr>
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
                    .sort((a, b) => (userNames[a.user_id] || "").localeCompare(userNames[b.user_id] || ""))
                    .map((p) => {
                      const shownRes = derivedResultForPick(p);
                      return (
                        <tr key={p.id}>
                          <td>{userNames[p.user_id] || p.user_id.slice(0, 6)}</td>
                          <td><TeamMini id={p.team_id} /></td>
                          <td>
                            <span className={
                              shownRes === "win" ? "text-emerald-700 font-semibold"
                              : shownRes === "loss" ? "text-red-600 font-semibold"
                              : shownRes === "push" ? "text-gray-600" : "text-gray-500"
                            }>
                              {shownRes}
                            </span>
                          </td>
                          <td>{p.auto_pick ? "Sí" : "No"}</td>
                          <td className="text-xs text-gray-500">
                            {p.updated_at ? DateTime.fromISO(p.updated_at).setZone(TZ).toFormat("dd LLL HH:mm") : "-"}
                          </td>
                        </tr>
                      );
                    })
                ) : (
                  <tr><td className="py-2 text-gray-500" colSpan={5}>Aún no hay picks esta semana.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-4 border rounded-2xl bg-white card">
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
                  <div className="progressbar mt-1"><div style={{ width: `${row.pct}%` }} /></div>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-500">Sin picks registrados.</div>
            )}
          </div>
        </div>
      </section>

      {/* Standings de la liga (W–L–T) */}
      <section className="mt-6">
        <div className="p-4 border rounded-2xl bg-white card">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-semibold">Standings de la liga (temporada)</h2>
            <p className="text-xs text-gray-500">
              Ranking por victorias, luego derrotas, luego empates.
            </p>
          </div>

          {(!leagueStandings || leagueStandings.length === 0) ? (
            <div className="text-sm text-gray-500 mt-2">Aún no hay resultados para mostrar.</div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm table-minimal">
                <thead>
                  <tr>
                    <th className="w-10">#</th>
                    <th>Jugador</th>
                    <th className="text-right">W</th>
                    <th className="text-right">L</th>
                    <th className="text-right">T</th>
                    <th className="text-right">Win%</th>
                    <th className="text-right">Vidas</th>
                  </tr>
                </thead>
                <tbody>
                  {leagueStandings.map((row, idx) => (
                    <tr key={row.user_id ?? idx}>
                      <td className="text-gray-500">{idx + 1}</td>
                      <td className="whitespace-nowrap">
                        <span className={clsx(
                          "inline-flex items-center gap-2",
                          (row.user_id === uid) && "font-semibold"
                        )}>
                          {(row.user_id === uid) && <span className="badge">Tú</span>}
                          <span>{row.name}</span>
                        </span>
                      </td>
                      <td className="text-right font-mono">{row.w}</td>
                      <td className="text-right font-mono">{row.l}</td>
                      <td className="text-right font-mono">{row.t}</td>
                      <td className="text-right font-mono">{winPct(row.w, row.l, row.t)}</td>
                      <td className="text-right">
                        <span className={clsx(
                          "inline-block min-w-[2rem] text-center px-2 py-0.5 rounded",
                          (row.lives ?? 0) > 0 ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                        )}>
                          {row.lives ?? "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Grid compacta: top 6 con barra de progreso de Win% (útil en móvil) */}
              <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {leagueStandings.slice(0, 6).map((row) => {
                  const pctNum = (() => {
                    const gp = row.w + row.l + row.t;
                    return gp ? Math.round((row.w / gp) * 100) : 0;
                  })();
                  return (
                    <div key={`mini-${row.user_id}`} className="p-3 border rounded-xl">
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate">{row.name}</span>
                        <span className="font-mono">{row.w}-{row.l}{row.t ? `-${row.t}` : ""}</span>
                      </div>
                      <div className="progressbar mt-1">
                        <div style={{ width: `${pctNum}%` }} />
                      </div>
                      <div className="text-right text-xs text-gray-600 mt-1">{pctNum}%</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Historial de usuario */}
      <section className="mt-6">
        <div className="p-4 border rounded-2xl bg-white card">
          <h2 className="font-semibold">Historial de tus picks</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm mt-3 table-minimal">
              <thead>
                <tr>
                  <th>W</th>
                  <th>Equipo</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {(picks || [])
                  .filter((p) => p.season === SEASON)
                  .sort((a, b) => a.week - b.week)
                  .map((p) => {
                    const shownRes = derivedResultForPick(p);
                    return (
                      <tr key={p.id}>
                        <td>{p.week}</td>
                        <td><TeamMini id={p.team_id} /></td>
                        <td>
                          <span className={
                            shownRes === "win" ? "text-emerald-700 font-semibold"
                            : shownRes === "loss" ? "text-red-600 font-semibold"
                            : shownRes === "push" ? "text-gray-600" : "text-gray-500"
                          }>
                            {shownRes}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                {(!picks || picks.length === 0) && (
                  <tr><td className="py-2 text-gray-500" colSpan={3}>Sin picks aún.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Modal pick */}
      {pendingPick && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 border card">
            <h3 className="font-semibold text-lg">Confirmar pick</h3>
            <p className="mt-2 text-sm">¿Confirmas tu pick de <b>{pendingPick.teamId}</b> en W{week}?</p>
            <div className="mt-4 flex gap-2">
              <button className="px-4 py-2 rounded border" onClick={() => setPendingPick(null)}>Cancelar</button>
              <button className="px-4 py-2 rounded bg-black text-white" onClick={doPick}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* Banner resultado */}
      {resultBanner && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60]">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 border card text-center">
            <h3 className="font-semibold text-lg">
              {resultBanner.type === "win" ? "¡Victoria!" : resultBanner.type === "loss" ? "Derrota" : "Push"}
            </h3>
            <p className="mt-2 text-sm">{resultBanner.msg}</p>
            <button className="mt-4 px-4 py-2 rounded bg-black text-white" onClick={() => setResultBanner(null)}>Cerrar</button>
          </div>
        </div>
      )}

      {!myPickThisWeek && nextKick && (me?.lives ?? 0) > 0 && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded-xl bg-black text-white text-sm shadow-lg">
          Recuerda elegir: kickoff en <Countdown iso={nextKick} />
        </div>
      )}

      {/* Modal Detalles de Juego */}
      {details && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[70]">
          <div className="w-full max-w-6xl bg-white rounded-2xl p-5 border card overflow-y-auto max-h-[90vh]">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-xl">
                  {details.game.away_team} @ {details.game.home_team}
                </h3>
                <p className="text-sm text-gray-600">
                  {DateTime.fromISO(details.game.start_time).setZone(TZ).toFormat("EEE dd LLL HH:mm")}
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href={`https://www.espn.com/nfl/game/_/gameId/${details.game.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1 rounded border text-sm"
                >
                  Ver en ESPN
                </a>
                <button
                  className="px-3 py-1 rounded border text-sm"
                  onClick={() => setDetails(null)}
                >
                  Cerrar
                </button>
              </div>
            </div>

            {/* GRID principal */}
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Columna izquierda */}
              <div className="space-y-4">
                {/* Probabilidades & Popularidad */}
                <div className="p-4 border rounded-xl bg-white">
                  <div className="text-sm font-semibold mb-3">Probabilidades & Popularidad</div>
                  {(() => {
                    const last = details.odds?.last;
                    const spreadHome = last?.spread_home ?? null;
                    const wpHome = winProbFromSpread(spreadHome);
                    const wpAway = winProbFromSpread(-spreadHome) ?? (wpHome != null ? 100 - wpHome : null);
                    const Row = ({ label, pct, pop }) => (
                      <div className="mb-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-mono">{label}</span>
                          <span className="text-gray-500">Pick pop: <b>{pop}%</b></span>
                        </div>
                        <div className="progressbar mt-1"><div style={{ width: `${pct ?? 0}%` }} /></div>
                        <div className="text-right text-xs text-gray-600">{pct != null ? `${pct}%` : "—"}</div>
                      </div>
                    );
                    return (
                      <>
                        <Row label={details.game.home_team} pct={wpHome} pop={details.popHome ?? 0} />
                        <Row label={details.game.away_team} pct={wpAway} pop={details.popAway ?? 0} />
                      </>
                    );
                  })()}
                </div>

                {/* Mercado + histórico */}
                <div className="p-4 border rounded-xl bg-white">
                  <div className="text-sm font-semibold mb-3">Mercado</div>
                  {(() => {
                    const { last, prev } = details.odds || {};
                    const Line = ({ tHome, tAway, lh, la, ph, pa }) => (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-500 text-xs">
                            <th className="text-left w-24">Tipo</th>
                            <th className="text-left">{tHome}</th>
                            <th className="text-left">{tAway}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="py-1 text-gray-500">Actual</td>
                            <td className="py-1 font-mono">{lh ?? "—"}</td>
                            <td className="py-1 font-mono">{la ?? "—"}</td>
                          </tr>
                          <tr>
                            <td className="py-1 text-gray-500">Previo</td>
                            <td className="py-1 font-mono">{ph ?? "—"}</td>
                            <td className="py-1 font-mono">{pa ?? "—"}</td>
                          </tr>
                        </tbody>
                      </table>
                    );
                    const fmt = (v) => (v != null ? (v > 0 ? `+${v}` : v) : null);
                    return (
                      <Line
                        tHome={details.game.home_team}
                        tAway={details.game.away_team}
                        lh={last?.spread_home != null ? `${fmt(last.spread_home)} | ML ${last?.ml_home ?? "—"}` : null}
                        la={last?.spread_away != null ? `${fmt(last.spread_away)} | ML ${last?.ml_away ?? "—"}` : null}
                        ph={prev?.spread_home != null ? `${fmt(prev.spread_home)} | ML ${prev?.ml_home ?? "—"}` : null}
                        pa={prev?.spread_away != null ? `${fmt(prev.spread_away)} | ML ${prev?.ml_away ?? "—"}` : null}
                      />
                    );
                  })()}

                  <div className="mt-3 text-xs text-gray-500">Histórico:</div>
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <div>
                      <div className="text-xs font-semibold mb-1">Spread Home</div>
                      <Sparkline series={(oddsHistory || []).map(r => r.spread_home).filter(v => v != null)} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold mb-1">Moneyline Home</div>
                      <Sparkline series={(oddsHistory || []).map(r => r.ml_home).filter(v => v != null)} />
                    </div>
                  </div>
                </div>

                {/* Últimos 5 */}
                <div className="p-4 border rounded-xl bg-white">
                  <div className="text-sm font-semibold mb-3">Últimos 5</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    {["home","away"].map(side => {
                      const rows = (recentForm?.[side] || []);
                      const label = side === "home" ? details.game.home_team : details.game.away_team;
                      return (
                        <div key={side}>
                          <div className="font-semibold mb-1">{label}</div>
                          <div className="space-y-1">
                            {rows.length ? rows.map((r, i) => (
                              <div key={i} className="flex items-center justify-between">
                                <span className="text-gray-600">{DateTime.fromISO(r.date).setZone(TZ).toFormat("dd LLL")}</span>
                                <span className="font-mono">{r.result}</span>
                                <span className="text-gray-700">{r.opp}</span>
                                <span className="font-mono">{r.score}</span>
                              </div>
                            )) : <div className="text-xs text-gray-500">Sin datos.</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Columna central */}
              <div className="space-y-4">
                {/* Líderes */}
                <div className="p-4 border rounded-2xl bg-white">
                  <div className="text-sm font-semibold mb-3">Líderes</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {["home","away"].map(side => {
                      const rows = (leaders || []).filter(x => x.side === side);
                      const label = side === "home" ? details.game.home_team : details.game.away_team;
                      return (
                        <div key={side}>
                          <div className="font-semibold mb-1">{label}</div>
                          {rows.length ? (
                            <ul className="text-sm space-y-1">
                              {rows.map((r, i) => (
                                <li key={i} className="flex justify-between">
                                  <span className="text-gray-700">{r.player} · {r.stat}</span>
                                  <span className="font-mono">{r.value}</span>
                                </li>
                              ))}
                            </ul>
                          ) : <p className="text-xs text-gray-500">Sin datos de líderes.</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Comparativa temporada */}
                <div className="p-4 border rounded-2xl bg-white">
                  <div className="text-sm font-semibold mb-3">Comparativa de equipos (temporada)</div>
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500">
                      <tr>
                        <th className="text-left">Métrica</th>
                        <th className="text-left">{details.game.home_team}</th>
                        <th className="text-left">{details.game.away_team}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["PPG","ppg"],["Yds/G","ypg"],["Pass Y/G","pass_ypg"],["Rush Y/G","rush_ypg"],
                        ["Opp PPG","opp_ppg"],["Opp Y/G","opp_ypg"],["3rd down %","third_down"],
                        ["Red zone %","red_zone"],["TO Diff","to_diff"],["Sacks","sacks"],
                      ].map(([label,key]) => (
                        <tr key={key}>
                          <td className="py-1 text-gray-600">{label}</td>
                          <td className="py-1 font-mono">{teamStats?.home?.[key] ?? "—"}</td>
                          <td className="py-1 font-mono">{teamStats?.away?.[key] ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-gray-500">Fuente: <code>season_team_stats</code>.</p>
                </div>
              </div>

              {/* Columna derecha */}
              <div className="space-y-4">
                {/* Sede & Clima */}
                <div className="p-4 border rounded-2xl bg-white">
                  <div className="text-sm font-semibold mb-3">Sede & Clima</div>
                  <div className="space-y-1 text-sm">
                    <div>🏟️ {metaMap[details.game.id]?.stadium ?? "—"}</div>
                    <div>📍 {metaMap[details.game.id]?.city ?? "—"}</div>
                    <div>📺 {metaMap[details.game.id]?.tv ?? "—"}</div>
                    <div className="h-px bg-gray-200 my-2" />
                    <div>🌡️ Temp: {weatherMap[details.game.id]?.temp_c ?? "—"}°C</div>
                    <div>🌧️ Lluvia: {weatherMap[details.game.id]?.precip_mm ?? "—"} mm</div>
                    <div>💨 Viento: {weatherMap[details.game.id]?.wind_kph ?? "—"} kph</div>
                    <div>{weatherMap[details.game.id]?.condition ?? ""}</div>
                  </div>
                </div>

                {/* Betting splits */}
                <div className="p-4 border rounded-2xl bg-white">
                  <div className="text-sm font-semibold mb-3">Betting Splits</div>
                  <div className="text-xs text-gray-500 mb-1">Tickets</div>
                  <div className="progressbar mb-2">
                    {(() => {
                      const th = betSplits?.tickets_home ?? 0;
                      const ta = betSplits?.tickets_away ?? 0;
                      const total = th + ta || 1;
                      const pctH = Math.round((th * 100) / total);
                      return <div style={{ width: `${pctH}%` }} title={`${details.game.home_team} ${pctH}%`} />;
                    })()}
                  </div>
                  <div className="text-xs text-gray-500 mb-1">Dinero</div>
                  <div className="progressbar">
                    {(() => {
                      const mh = betSplits?.money_home ?? 0;
                      const ma = betSplits?.money_away ?? 0;
                      const total = mh + ma || 1;
                      const pctH = Math.round((mh * 100) / total);
                      return <div style={{ width: `${pctH}%` }} title={`${details.game.home_team} ${pctH}%`} />;
                    })()}
                  </div>
                  <p className="mt-2 text-xs text-gray-500">Fuente: <code>betting_splits</code>.</p>
                </div>

                {/* Lesiones */}
                <div className="p-4 border rounded-2xl bg-white">
                  <div className="text-sm font-semibold mb-3">Lesionados</div>
                  {["home","away"].map(side => {
                    const team = side === "home" ? details.game.home_team : details.game.away_team;
                    const rows = (injuries || []).filter(i => i.team_id === team);
                    return (
                      <div key={side} className="mb-3">
                        <div className="font-semibold text-xs mb-1">{team}</div>
                        {rows.length ? rows.slice(0,5).map((r,i) => (
                          <div key={i} className="text-sm flex items-center justify-between">
                            <span>{r.player}</span>
                            <span className="text-gray-600">{r.status}</span>
                          </div>
                        )) : <p className="text-xs text-gray-500">Sin datos.</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Comentarios */}
            <div className="mt-4 p-4 border rounded-xl bg-white">
              <div className="text-sm font-semibold mb-2">Comentarios del juego</div>
              <div className="flex gap-2">
                <input
                  className="border rounded-lg p-2 w-full"
                  placeholder="Escribe una nota (visible para la liga)…"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                />
                <button className="px-3 py-2 rounded bg-black text-white text-sm" onClick={addNote}>
                  Guardar
                </button>
              </div>
              <div className="mt-3 space-y-2 max-h-64 overflow-auto">
                {(notes || []).map((n) => (
                  <div key={n.id} className="p-2 border rounded-lg">
                    <div className="text-xs text-gray-500">
                      {userNames[n.user_id] || n.user_id.slice(0, 6)} ·{" "}
                      {DateTime.fromISO(n.created_at).setZone(TZ).toFormat("dd LLL HH:mm")}
                    </div>
                    <div className="text-sm mt-1">{n.note}</div>
                  </div>
                ))}
                {(!notes || notes.length === 0) && <div className="text-xs text-gray-500">Sin comentarios.</div>}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  ); // end return
} // end GamesTab


	  

/* ========================= Standings NFL ========================= */
/* ========================= Standings NFL ========================= */
function StandingsTab() {
  const [rows, setRows] = useState([]); // calculadas desde games

  useEffect(() => {
    (async () => {
      // Traemos teams (para conferencia/división) y todos los juegos de la temporada
      const { data: teams } = await supabase
        .from("teams")
        .select("id, conference, division, name, logo_url");
      const { data: games } = await supabase
        .from("games")
        .select("id, start_time, season, home_team, away_team, home_score, away_score, status, period, clock")
        .eq("season", SEASON);

      setRows(buildStandings(teams || [], games || []));
    })();
  }, []);

  // ---- Helpers de cálculo ----
  function pctStr(w, l, t) {
    const g = w + l + t;
    if (!g) return ".000";
    const pct = (w + 0.5 * t) / g;
    if (pct === 1) return "1.000";
    return "." + String(Math.round(pct * 1000)).padStart(3, "0");
  }

  function buildStandings(teams, games) {
    // mapa base por equipo
    const base = {};
    teams.forEach((t) => {
      base[t.id] = {
        team_id: t.id,
        name: t.name,
        conference: t.conference,
        division: t.division,
        w: 0, l: 0, t: 0,
        pf: 0, pa: 0,
        home_w: 0, home_l: 0, home_t: 0,
        away_w: 0, away_l: 0, away_t: 0,
        diff: 0,
        results: [] // para racha en orden cronológico
      };
    });

    // ordenar juegos por fecha para rachas consistentes
    const sortedGames = (games || []).slice().sort((a,b)=> new Date(a.start_time)-new Date(b.start_time));

    for (const g of sortedGames) {
      // contamos solo juegos terminados (igual que hasGameEnded)
      if (!hasGameEnded(g)) continue;

      const hs = Number(g.home_score ?? 0);
      const as = Number(g.away_score ?? 0);
      const H = base[g.home_team], A = base[g.away_team];
      if (!H || !A) continue;

      // puntos
      H.pf += hs; H.pa += as;
      A.pf += as; A.pa += hs;

      // diff
      H.diff += hs - as;
      A.diff += as - hs;

      // resultado
      if (hs === as) {
        H.t++; A.t++;
        H.home_t++; A.away_t++;
        H.results.push("T"); A.results.push("T");
      } else if (hs > as) {
        H.w++; A.l++;
        H.home_w++; A.away_l++;
        H.results.push("W"); A.results.push("L");
      } else {
        H.l++; A.w++;
        H.home_l++; A.away_w++;
        H.results.push("L"); A.results.push("W");
      }
    }

    // convertir a lista y ordenar dentro de cada división
    const list = Object.values(base);
    // agrupamos por conferencia/división
    const groups = {};
    for (const r of list) {
      const key = `${r.conference}__${r.division}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    // orden: % desc, diff desc, PF desc, nombre asc
    const sorter = (a,b) => {
      const pa = (a.w + 0.5*a.t) / Math.max(1, a.w+a.l+a.t);
      const pb = (b.w + 0.5*b.t) / Math.max(1, b.w+b.l+b.t);
      return (pb - pa) || (b.diff - a.diff) || (b.pf - a.pf) || (a.team_id.localeCompare(b.team_id));
    };
    Object.values(groups).forEach(arr => arr.sort(sorter));

    // devolvemos en estructura por conferencia para render
    const AFC = ["East","North","South","West"].map(div => ({
      conference: "AFC",
      division: div,
      list: groups[`AFC__${div}`] || []
    }));
    const NFC = ["East","North","South","West"].map(div => ({
      conference: "NFC",
      division: div,
      list: groups[`NFC__${div}`] || []
    }));
    return { AFC, NFC };
  }

  function streakStr(r) {
    // r.results es un array en orden cronológico; contamos desde el final
    const arr = r.results || [];
    if (!arr.length) return "-";
    const last = arr[arr.length - 1];
    let n = 1;
    for (let i = arr.length - 2; i >= 0; i--) {
      if (arr[i] !== last) break;
      n++;
    }
    if (last === "W") return `W${n}`;
    if (last === "L") return `L${n}`;
    return `T${n}`;
  }

  const colHeader = (
    <thead>
      <tr>
        <th>Equipo</th>
        <th>W</th>
        <th>L</th>
        <th>T</th>
        <th>%</th>
        <th>PF</th>
        <th>PC</th>
        <th>Loc.</th>
        <th>Vis.</th>
        <th>Rach.</th>
      </tr>
    </thead>
  );

  const DivisionTable = ({ title, list }) => (
    <div className="p-4 border rounded-2xl bg-white card">
      <h3 className="font-semibold mb-2">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-minimal">
          {colHeader}
          <tbody>
            {list.map((r) => (
              <tr key={r.team_id}>
                <td className="font-mono">{r.team_id}</td>
                <td className="text-emerald-700 font-medium">{r.w}</td>
                <td className="text-red-600 font-medium">{r.l}</td>
                <td className="text-gray-600">{r.t}</td>
                <td className="font-mono">{pctStr(r.w, r.l, r.t)}</td>
                <td>{r.pf}</td>
                <td>{r.pa}</td>
                <td>{`${r.home_w}-${r.home_l}${r.home_t ? `-${r.home_t}` : ""}`}</td>
                <td>{`${r.away_w}-${r.away_l}${r.away_t ? `-${r.away_t}` : ""}`}</td>
                <td>{streakStr(r)}</td>
              </tr>
            ))}
            {!list.length && (
              <tr><td className="py-2 text-gray-500" colSpan={10}>Sin datos aún.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  // si aún no hay rows, mensaje mínimo
  if (!rows || !rows.AFC) {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-6">
        <h1 className="text-2xl font-extrabold mb-3">Standings NFL</h1>
        <p className="text-sm text-gray-500">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-extrabold mb-3">Standings NFL</h1>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Columna izquierda: AFC */}
        <div className="grid gap-4">
          {rows.AFC.map((g, idx) => (
            <DivisionTable key={`AFC-${idx}`} title={`AFC — ${g.division}`} list={g.list} />
          ))}
        </div>

        {/* Columna derecha: NFC */}
        <div className="grid gap-4">
          {rows.NFC.map((g, idx) => (
            <DivisionTable key={`NFC-${idx}`} title={`NFC — ${g.division}`} list={g.list} />
          ))}
        </div>
      </div>
    </div>
  );
}


/* ========================= Asistente de Picks ========================= */
/* ========================= Asistente de Picks ========================= */
function AssistantTab({ session }) {
  const uid = session?.user?.id || null;

  const [week, setWeek] = useState(() => Number(localStorage.getItem("week")) || 1);
  const [me, setMe] = useState(null);

  const [teamsMap, setTeamsMap] = useState({});
  const [games, setGames] = useState([]);
  const [oddsPairs, setOddsPairs] = useState({});
  const [leaguePicks, setLeaguePicks] = useState([]);
  const [myPick, setMyPick] = useState(null);

  const [pendingPick, setPendingPick] = useState(null);

  // ---------- Carga de datos ----------
  useEffect(() => {
    (async () => {
      const email = session?.user?.email;
      if (!email || !uid) return;

      const { data: prof } = await supabase.from("profiles").select("*").eq("id", uid).single();
      setMe(prof || null);

      const { data: ts } = await supabase.from("teams").select("id,name,logo_url");
      const map = {}; (ts || []).forEach((t) => (map[t.id] = t));
      setTeamsMap(map);

      await loadGamesA(week);

      const { data: myPicks } = await supabase
        .from("picks")
        .select("*")
        .eq("user_id", uid)
        .eq("season", SEASON)
        .eq("week", week)
        .limit(1);
      setMyPick(myPicks?.[0] || null);

      await loadLeaguePicksA(week);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, week]);

  const loadGamesA = async (w) => {
    const { data: gs } = await supabase
      .from("games")
      .select("*")
      .eq("season", SEASON)
      .eq("week", w)
      .order("start_time");
    setGames(gs || []);
    const ids = (gs || []).map((g) => g.id);
    if (!ids.length) { setOddsPairs({}); return; }
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
  };

  const loadLeaguePicksA = async (w) => {
    const { data: pks } = await supabase
      .from("picks")
      .select("user_id, team_id")
      .eq("season", SEASON)
      .eq("week", w);
    setLeaguePicks(pks || []);
  };

  // ---------- Helpers ----------
  const gamesMap = useMemo(() => {
    const m = {}; (games || []).forEach((g) => (m[g.id] = g)); return m;
  }, [games]);

  const mySeasonTeams = useMemo(() => {
    return new Set((leaguePicks || []).filter(p => p.user_id === uid).map(p => p.team_id));
  }, [leaguePicks, uid]);

  function popPct(teamId) {
    // Popularidad = % de jugadores que pickearon ese equipo esta semana
    const counts = {};
    (leaguePicks || []).forEach((p) => { if (p.team_id) counts[p.team_id] = (counts[p.team_id] || 0) + 1; });
    let totalPlayers = 0;
    // aproximación: jugadores que han pickeado o total de perfiles si disponible
    totalPlayers = new Set((leaguePicks || []).map(p=>p.user_id)).size;
    if (!totalPlayers) return 0;
    const count = counts[teamId] || 0;
    return Math.round((count * 100) / totalPlayers);
  }

  const pickFrozen = useMemo(() => {
    if (!myPick) return false;
    const g = gamesMap[myPick.game_id];
    if (!g) return false;
    if (myPick.result && myPick.result !== "pending") return true;
    return DateTime.fromISO(g.start_time) <= DateTime.now() || hasGameEnded(g);
  }, [myPick, gamesMap]);

  const canPick = (game, teamId) => {
    if (!uid) return { ok: false, reason: "NOSESSION" };
    if ((me?.lives ?? 0) <= 0) return { ok: false, reason: "ELIMINATED" };
    if (pickFrozen) {
      const same = myPick?.game_id === game.id && myPick?.team_id === teamId;
      if (!same) return { ok: false, reason: "FROZEN" };
    }
    if (DateTime.fromISO(game.start_time) <= DateTime.now()) return { ok: false, reason: "LOCK" };
    return { ok: true };
  };

  // Puntuar todas las opciones (equipo por juego)
  const scored = useMemo(() => {
    const rows = [];
    (games || []).forEach((g) => {
      const { last } = oddsPairs[g.id] || {};
      const spreadH = last?.spread_home ?? null;
      const mlH = last?.ml_home ?? null;
      const mlA = last?.ml_away ?? null;

      const wpHome = winProbFromSpread(spreadH);                  // ~prob ganar home
      const wpAway = wpHome != null ? Math.max(0, 100 - wpHome) : null;

      const addRow = (teamId, wp, fav) => {
        const pct = popPct(teamId);
        const used = mySeasonTeams.has(teamId);
        const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
        rows.push({
          game: g,
          teamId,
          wp: wp ?? null,
          fav,
          pop: pct,
          used,
          locked,
          diffScore: (wp != null ? wp : 0) - pct,       // alto => buen valor diferencial
          safetyScore: (wp != null ? wp : 0) - (pct / 4)  // prioriza win% pero castiga mucha popularidad
        });
      };

      const favHome = (mlH != null && mlA != null) ? mlH < mlA : (spreadH != null ? spreadH < 0 : false);
      addRow(g.home_team, wpHome, favHome);

      const favAway = (mlH != null && mlA != null) ? mlA < mlH : (spreadH != null ? spreadH > 0 : false);
      addRow(g.away_team, wpAway, favAway);
    });
    return rows;
  }, [games, oddsPairs, leaguePicks, mySeasonTeams]);

  // Listas finales
  const safePicks = useMemo(() => {
    // Criterio: win% >= 60, no usado, no locked, orden por safetyScore, tomar top 3
    return scored
      .filter(r => !r.locked && !r.used && (r.wp ?? 0) >= 60)
      .sort((a,b) => (b.safetyScore - a.safetyScore) || (b.wp - a.wp))
      .slice(0, 3);
  }, [scored]);

  const differentialPicks = useMemo(() => {
    // Criterio: pop <= 25, win% >= 50 (o >=48 si hay pocos), no usado, no locked
    let list = scored
      .filter(r => !r.locked && !r.used && ((r.wp ?? 0) >= 50) && r.pop <= 25)
      .sort((a,b)=> (b.diffScore - a.diffScore) || (b.wp - a.wp))
      .slice(0, 6);
    if (list.length < 5) {
      // rellena con opciones de buen valor aunque pop hasta 35 o wp >=48
      const extra = scored
        .filter(r => !r.locked && !r.used && ((r.wp ?? 0) >= 48) && r.pop <= 35)
        .sort((a,b)=> (b.diffScore - a.diffScore) || (b.wp - a.wp));
      const set = new Set(list.map(x=>`${x.game.id}_${x.teamId}`));
      for (const r of extra) { if (set.size >= 6) break; if (!set.has(`${r.game.id}_${r.teamId}`)) { list.push(r); set.add(`${r.game.id}_${r.teamId}`);} }
    }
    return list.slice(0,6);
  }, [scored]);

  const trapPicks = useMemo(() => {
    // Criterio: favorito muy popular (>=35%) con win% no tan alto (<=58) => posibles "trampas"
    return scored
      .filter(r => r.fav && (r.wp ?? 0) <= 58 && r.pop >= 35)
      .sort((a,b)=> (b.pop - a.pop) || ((a.wp ?? 0) - (b.wp ?? 0)))
      .slice(0, 3);
  }, [scored]);

  // ---------- UI ----------
  const TeamMini = ({ id }) => {
    const logo = teamsMap[id]?.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-1">
        <img src={logo} alt={id} className="h-5 w-5 object-contain" onError={(e)=> (e.currentTarget.style.visibility = "hidden")} />
        <span className="font-mono font-semibold">{id}</span>
      </span>
    );
  };

  const CardRow = ({ rec }) => {
    if (!rec) return null;
    const disqUsed = mySeasonTeams.has(rec.teamId);
    const lock = DateTime.fromISO(rec.game.start_time) <= DateTime.now();
    const c = canPick(rec.game, rec.teamId);
    const disabled = !c.ok || disqUsed || lock;

    return (
      <div className="p-3 border rounded-xl bg-white card">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-semibold flex items-center gap-2">
              <TeamMini id={rec.teamId} />
              <span className="text-xs text-gray-500">
                vs {rec.game.home_team === rec.teamId ? rec.game.away_team : rec.game.home_team}
              </span>
            </div>
            <div className="text-xs text-gray-600 mt-1">
              Win% ~ {rec.wp ?? "—"}% · Popularidad {rec.pop}% {disqUsed ? "· (ya usado)" : ""} {lock ? "· (bloqueado)" : ""}
            </div>
          </div>
          <button
            className={clsx("px-3 py-1 rounded border text-sm", disabled ? "opacity-50 cursor-not-allowed" : "bg-black text-white")}
            disabled={disabled}
            onClick={() => setPendingPick({ game: rec.game, teamId: rec.teamId })}
          >
            Pickear
          </button>
        </div>
      </div>
    );
  };

  const doPick = async () => {
    if (!pendingPick || !uid) return;
    const { game, teamId } = pendingPick;
    try {
      if (myPick) {
        const { error } = await supabase.from("picks")
          .update({ team_id: teamId, game_id: game.id, updated_at: new Date().toISOString() })
          .eq("id", myPick.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("picks").insert({
          user_id: uid, game_id: game.id, team_id: teamId, week, season: SEASON,
        });
        if (error) throw error;
      }
      const { data: myPicks } = await supabase
        .from("picks").select("*")
        .eq("user_id", uid).eq("season", SEASON).eq("week", week).limit(1);
      setMyPick(myPicks?.[0] || null);
      await loadLeaguePicksA(week);
      await loadGamesA(week);
      setPendingPick(null);
      alert("Pick guardado ✔️");
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Asistente</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Semana</label>
          <select className="border p-1 rounded-lg" value={week} onChange={(e)=> setWeek(Number(e.target.value))}>
            {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (<option key={w} value={w}>W{w}</option>))}
          </select>
        </div>
      </div>

      {(me?.lives ?? 0) <= 0 && (
        <div className="mt-3 p-3 border-2 border-rose-300 rounded-xl bg-rose-50 text-rose-900 text-sm">
          Estás <b>eliminado</b> 😵‍💫 — puedes seguir viendo recomendaciones, pero ya no puedes pickear.
        </div>
      )}

      <div className="mt-4 grid gap-4">
        {/* Seguras (top 3) */}
        <div className="p-4 border rounded-2xl bg-white card">
          <h3 className="font-semibold mb-2">Recomendaciones seguras</h3>
          {safePicks.length ? (
            <div className="space-y-2">
              {safePicks.map((r, i) => (<CardRow key={`safe-${i}`} rec={r} />))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">Aún no hay datos suficientes.</p>
          )}
        </div>

        {/* Diferenciales (5-6) */}
        <div className="p-4 border rounded-2xl bg-white card">
          <h3 className="font-semibold mb-2">Recomendaciones diferenciales</h3>
          {differentialPicks.length ? (
            <div className="space-y-2">
              {differentialPicks.map((r, i) => (<CardRow key={`diff-${i}`} rec={r} />))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">Sin diferenciales claros por ahora.</p>
          )}
        </div>

        {/* Trampas (2-3) */}
        <div className="p-4 border rounded-2xl bg-white card">
          <h3 className="font-semibold mb-2">Candidatos trampa (para evitar)</h3>
          {trapPicks.length ? (
            <div className="space-y-2">
              {trapPicks.map((r, i) => (
                <div key={`trap-${i}`} className="p-3 border rounded-xl bg-white">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <TeamMini id={r.teamId} />
                      <span className="text-xs text-gray-500">
                        vs {r.game.home_team === r.teamId ? r.game.away_team : r.game.home_team}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600">
                      Fav · Win% ~ {r.wp ?? "—"}% · Pop {r.pop}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">Nada alarmante por ahora.</p>
          )}
        </div>
      </div>

      {/* Modal confirmar pick */}
      {pendingPick && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 border card">
            <h3 className="font-semibold text-lg">Confirmar pick</h3>
            <p className="mt-2 text-sm">¿Confirmas tu pick de <b>{pendingPick.teamId}</b> en W{week}?</p>
            <div className="mt-4 flex gap-2">
              <button className="px-4 py-2 rounded border" onClick={() => setPendingPick(null)}>Cancelar</button>
              <button className="px-4 py-2 rounded bg-black text-white" onClick={doPick}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/* ========================= Noticias ========================= */
function NewsTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // ---- helpers locales (sin imports nuevos)
  const RSS_FEEDS = [
    { source: "ESPN NFL", url: "https://api.rss2json.com/v1/api.json?rss_url=https://www.espn.com/espn/rss/nfl/news" },
    { source: "NFL.com", url: "https://api.rss2json.com/v1/api.json?rss_url=https://www.nfl.com/rss/rsslanding?searchString=home" },
    { source: "The Athletic (NFL)", url: "https://api.rss2json.com/v1/api.json?rss_url=https://theathletic.com/league/nfl/feed/" },
  ];

  function parseRssJson(json, fallbackSource) {
    if (!json || !json.items) return [];
    return (json.items || []).map((it) => ({
      id: it.guid || it.link || it.pubDate || Math.random().toString(36).slice(2),
      title: it.title || "",
      url: it.link || it.url || "#",
      source: (json.feed && json.feed.title) || fallbackSource || "News",
      published_at: it.pubDate || it.pubdate || it.date || null,
      summary: it.description || it.content || "",
    }));
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);

      // 1) Intento Supabase
      let rows = [];
      try {
        const { data, error } = await supabase
          .from("news")
          .select("id,title,url,source,published_at,summary,team_id")
          .order("published_at", { ascending: false })
          .limit(30);
        if (error) throw error;
        rows = data || [];
      } catch {
        // tabla puede no existir o no hay permisos
      }

      // 2) Fallback RSS si vacío
      if (!rows || rows.length === 0) {
        try {
          const results = await Promise.allSettled(
            RSS_FEEDS.map(f =>
              fetch(f.url, { headers: { "Accept": "application/json" } })
                .then(r => r.json())
                .then(j => parseRssJson(j, f.source))
            )
          );
          const merged = results.flatMap(r => (r.status === "fulfilled" ? r.value : []));
          const withTs = merged.map(x => ({ ...x, _ts: x.published_at ? Date.parse(x.published_at) : 0 }));
          withTs.sort((a, b) => b._ts - a._ts);
          rows = withTs.slice(0, 30).map(({ _ts, ...rest }) => rest);
        } catch (e) {
          setErr("No se pudieron cargar noticias desde las fuentes públicas.");
          rows = [];
        }
      }

      setItems(rows);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-extrabold mb-3">Noticias NFL</h1>

      {loading && <p className="text-sm text-gray-500">Cargando…</p>}

      {!loading && err && (
        <div className="p-4 border rounded-2xl bg-white card text-sm text-red-600">
          {err}
        </div>
      )}

      {!loading && items.length === 0 && !err && (
        <div className="p-4 border rounded-2xl bg-white card text-sm text-gray-600">
          No hay noticias cargadas aún. 
        </div>
      )}

      <div className="grid gap-3">
        {items.map((n) => (
          <a key={n.id} href={n.url} target="_blank" rel="noreferrer" className="p-4 border rounded-2xl bg-white card hover:bg-gray-50 transition">
            <div className="text-sm text-gray-500">
              {n.source || "—"} · {n.published_at ? DateTime.fromISO(n.published_at).setZone(TZ).toFormat("dd LLL HH:mm") : ""}
            </div>
            <div className="font-semibold">{n.title}</div>
            {n.summary && <div className="text-sm text-gray-600 mt-1 line-clamp-2" dangerouslySetInnerHTML={{ __html: n.summary }} />}
          </a>
        ))}
      </div>
    </div>
  );
}

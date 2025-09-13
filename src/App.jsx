
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

/* ========================= PARTIDOS ========================= */
function GamesTab({ session }) {
  const uid = session?.user?.id || null;

  const [me, setMe] = useState(null);
  const [week, setWeek] = useState(
    () => Number(localStorage.getItem("week")) || 1
  );

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

  const [dayFilter, setDayFilter] = useState(
    localStorage.getItem("dayFilter") || "ALL"
  );
  const [teamQuery, setTeamQuery] = useState(
    localStorage.getItem("teamQuery") || ""
  );
  const searchRef = useRef(null);

  // realtime
  useEffect(() => {
    const ch = supabase
      .channel("realtime-app")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "picks" },
        (payload) => {
          const wk = payload.new?.week ?? payload.old?.week;
          const ssn = payload.new?.season ?? payload.old?.season;
          if (wk === week && ssn === SEASON) {
            loadMyPicks();
            loadLeaguePicks(week);
            setLastUpdated(new Date().toISOString());
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "games" },
        (payload) => {
          const wk = payload.new?.week ?? payload.old?.week;
          const ssn = payload.new?.season ?? payload.old?.season;
          if (wk === week && ssn === SEASON) {
            loadGames(week);
            setLastUpdated(new Date().toISOString());
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "odds" },
        () => {
          loadGames(week);
          setLastUpdated(new Date().toISOString());
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [week]);

  /* ---------- cargas ---------- */
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

  const loadMyPicks = async () => {
    if (!uid) return;
    const { data: pk } = await supabase
      .from("picks")
      .select("*")
      .eq("user_id", uid)
      .eq("season", SEASON);
    setPicks(pk || []);
  };

  const loadLeaguePicks = async (w) => {
    const { data: pks } = await supabase
      .from("picks")
      .select(
        "id,user_id,team_id,result,auto_pick,updated_at,week,season,game_id"
      )
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

  const loadSeasonData = async () => {
    const { data: gs } = await supabase
      .from("games")
      .select("*")
      .eq("season", SEASON);
    setAllGamesSeason(gs || []);
    const { data: pks } = await supabase
      .from("picks")
      .select(
        "id,user_id,team_id,game_id,week,season,result,updated_at"
      )
      .eq("season", SEASON);
    setAllPicksSeason(pks || []);
  };

  const recomputePlayerStandings = (allPicks, allGames) => {
    const gm = {};
    (allGames || []).forEach((g) => (gm[g.id] = g));
    const agg = new Map();
    (allPicks || []).forEach((p) => {
      const g = gm[p.game_id];
      if (!g) return;
      const res =
        p.result && p.result !== "pending"
          ? p.result
          : computePickResultFromGame(g, p.team_id);
      if (res === "pending") return;
      const row = agg.get(p.user_id) || { w: 0, l: 0, t: 0 };
      if (res === "win") row.w++;
      else if (res === "loss") row.l++;
      else if (res === "push") row.t++;
      agg.set(p.user_id, row);
    });
    return [...agg.entries()]
      .map(([user_id, { w, l, t }]) => ({ user_id, w, l, t }))
      .sort((a, b) => b.w - a.w || a.l - b.l || b.t - a.t);
  };

  const initAll = async () => {
    if (!uid) return; // espera a la sesión
    const email = session.user.email;
    let { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .single();
    if (!prof) {
      await supabase.from("profiles").insert({
        id: uid,
        email,
        display_name: email.split("@")[0],
        lives: 2,
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
    const { data: st } = await supabase.from("standings").select("*");
    setStandings(st || []);
    await loadLeaguePicks(week);
    await loadSeasonData();
    setLastUpdated(new Date().toISOString());
  };

  useEffect(() => {
    initAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    loadGames(week);
    loadLeaguePicks(week);
    localStorage.setItem("week", String(week));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  useEffect(() => localStorage.setItem("dayFilter", dayFilter), [dayFilter]);
  useEffect(() => localStorage.setItem("teamQuery", teamQuery), [teamQuery]);

  useEffect(() => {
    if (!allGamesSeason?.length || !allPicksSeason?.length) return;
    setPlayerStandings(
      recomputePlayerStandings(allPicksSeason, allGamesSeason)
    );
  }, [allGamesSeason, allPicksSeason]);

  /* ---------- helpers picks ---------- */
  const myPickThisWeek = useMemo(
    () => (picks || []).find((p) => p.week === week && p.season === SEASON),
    [picks, week]
  );

  const gamesMap = useMemo(() => {
    const m = {};
    (games || []).forEach((g) => (m[g.id] = g));
    return m;
  }, [games]);

  const pickFrozen = useMemo(
    () => isPickFrozen(myPickThisWeek, gamesMap),
    [myPickThisWeek, gamesMap]
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

  const canPick = (candidateGame, candidateTeam) => {
    if (!uid) return { ok: false, reason: "NOSESSION" };
    if ((me?.lives ?? 0) <= 0) return { ok: false, reason: "ELIMINATED" };
    if (pickFrozen) {
      const same =
        myPickThisWeek?.game_id === candidateGame.id &&
        myPickThisWeek?.team_id === candidateTeam;
      if (!same) return { ok: false, reason: "FROZEN" };
    }
    if (DateTime.fromISO(candidateGame.start_time) <= DateTime.now())
      return { ok: false, reason: "LOCK" };
    const used = (picks || []).some(
      (p) => p.team_id === candidateTeam && p.user_id === uid
    );
    if (used && !(myPickThisWeek && myPickThisWeek.team_id === candidateTeam))
      return { ok: false, reason: "USED" };
    return { ok: true };
  };

  const confirmPick = (game, teamId) => {
    const c = canPick(game, teamId);
    if (!c.ok) {
      const msg =
        c.reason === "ELIMINATED"
          ? "Estás eliminado 😵‍💫. Puedes ver cómo van los demás, pero ya no puedes pickear."
          : c.reason === "FROZEN"
          ? "Tu pick ya quedó congelado porque su partido ya inició/terminó."
          : c.reason === "LOCK"
          ? "Este partido ya está cerrado por kickoff."
          : c.reason === "NOSESSION"
          ? "Iniciando sesión… intenta de nuevo en unos segundos."
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
        .update({
          team_id: teamId,
          game_id: game.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", myPickThisWeek.id);
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from("picks").insert({
        user_id: uid,
        game_id: game.id,
        team_id: teamId,
        week,
        season: SEASON,
      });
      if (error) return alert(error.message);
    }
    await loadMyPicks();
    await loadLeaguePicks(week);
    await loadSeasonData();
    const { data: st } = await supabase.from("standings").select("*");
    setStandings(st || []);
    setPendingPick(null);
    setLastUpdated(new Date().toISOString());
  };

  function derivedResultForPick(pick) {
    if (!pick) return "pending";
    if (pick?.result && pick.result !== "pending") return pick.result;
    const g = gamesMap[pick?.game_id];
    if (!g) return "pending";
    return computePickResultFromGame(g, pick.team_id);
  }

  const bannerKey = (w, u) => `resultShown-W${w}-${u}`;
  const livesKey = (w, u) => `livesApplied-W${w}-${u}`;

  async function applyLivesIfNeeded(outcome) {
    if (outcome !== "loss" || !uid) return;
    const lk = livesKey(week, uid);
    if (localStorage.getItem(lk)) return;
    try {
      const { data: profNow } = await supabase
        .from("profiles")
        .select("lives")
        .eq("id", uid)
        .single();
      const currentLives = profNow?.lives ?? me?.lives ?? 0;
      const newLives = Math.max(0, currentLives - 1);
      if (newLives !== currentLives) {
        await supabase
          .from("profiles")
          .update({ lives: newLives })
          .eq("id", uid);
        setMe((m) => ({ ...m, lives: newLives }));
      }
    } catch (e) {
      console.warn("applyLivesIfNeeded error:", e.message);
    } finally {
      localStorage.setItem(lk, "1");
    }
  }

  function funnyMsg(res) {
    if (res === "win")
      return "¡Ganaste esta semana! 🕺 Te luciste. A ver si así te invita a cenar la suerte.";
    if (res === "loss")
      return "Perdiste esta semana 😬… te falló la bola mágica. ¡A levantarse que aún hay NFL!";
    return "Push… ni fu ni fa. Como pedir tacos y que te den ensalada. 🥗";
  }
  async function onMyPickResolved(res) {
    setResultBanner({ type: res, msg: funnyMsg(res) });
    if (res === "loss") await applyLivesIfNeeded(res);
  }

  async function settleMyPicksIfNeeded(currentWeek, gamesArr, myPicksArr) {
    const finals = {};
    (gamesArr || []).forEach((g) => {
      if (hasGameEnded(g)) finals[g.id] = g;
    });
    const updates = [];
    let myResolvedResult = null;
    (myPicksArr || []).forEach((p) => {
      if (p.week !== currentWeek) return;
      const g = finals[p.game_id];
      if (!g) return;
      const res = computePickResultFromGame(g, p.team_id);
      if ((!p.result || p.result === "pending") && res !== "pending") {
        updates.push({ id: p.id, result: res });
        if (p.user_id === uid) myResolvedResult = res;
      }
    });
    if (updates.length) {
      for (const row of updates) {
        const { error } = await supabase
          .from("picks")
          .update({ result: row.result })
          .eq("id", row.id);
        if (error)
          console.warn("settleMyPicksIfNeeded error:", error.message);
      }
    }
    if (myResolvedResult && uid) {
      const key = bannerKey(currentWeek, uid);
      if (!localStorage.getItem(key)) {
        await onMyPickResolved(myResolvedResult);
        localStorage.setItem(key, "1");
      }
    }
  }

  async function settleLeaguePicksIfNeeded(
    currentWeek,
    gamesArr,
    leaguePicksArr
  ) {
    const finals = {};
    (gamesArr || []).forEach((g) => {
      if (hasGameEnded(g)) finals[g.id] = g;
    });
    const updates = [];
    (leaguePicksArr || []).forEach((p) => {
      if (p.week !== currentWeek) return;
      if (p.result && p.result !== "pending") return;
      const g = finals[p.game_id];
      if (!g) return;
      const res = computePickResultFromGame(g, p.team_id);
      if (res !== "pending") updates.push({ id: p.id, result: res });
    });
    if (updates.length) {
      for (const row of updates) {
        const { error } = await supabase
          .from("picks")
          .update({ result: row.result })
          .eq("id", row.id);
        if (error)
          console.warn("settleLeaguePicksIfNeeded error:", error.message);
      }
    }
  }

  useEffect(() => {
    if (!games?.length) return;
    if (picks?.length) settleMyPicksIfNeeded(week, games, picks);
    if (leaguePicks?.length) settleLeaguePicksIfNeeded(week, games, leaguePicks);
    ((async () => {
		try {
    // si tu /api/syncScores acepta GET, basta así:
	     const url = `${SITE}/api/syncScores?week=${week}&token=${encodeURIComponent(CRON_TOKEN)}`;
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
    const ended = hasGameEnded(g);
    const score = (
      <div className="flex items-center gap-4">
        <div className="text-lg font-bold">
          {g.away_team}{" "}
          <span className="tabular-nums">{g.away_score ?? 0}</span>
        </div>
        <div className="text-gray-300">—</div>
        <div className="text-lg font-bold">
          {g.home_team}{" "}
          <span className="tabular-nums">{g.home_score ?? 0}</span>
        </div>
      </div>
    );
    if (ended)
      return (
        <div className="flex items-center justify-between">
          {score}
          <span className="badge">FINAL</span>
        </div>
      );
    if (isLiveStatus(g.status))
      return (
        <div className="flex items-center justify-between">
          {score}
          <div className="text-xs flex items-center gap-2">
            {g.period != null && (
              <span className="badge badge-warn">
                Q{g.period} {g.clock || ""}
              </span>
            )}
            {g.down != null && g.distance != null && (
              <span className="badge">
                @ {g.down}&amp;{g.distance}
              </span>
            )}
            {g.possession && <span className="badge">⬤ {g.possession}</span>}
            {g.red_zone && (
              <span className="badge badge-danger">Red Zone</span>
            )}
          </div>
        </div>
      );
    return (
      <div className="flex items-center justify-between">
        {score}
        <span className="badge">
          Kickoff en&nbsp;<Countdown iso={g.start_time} />
        </span>
      </div>
    );
  };

  const TeamBox = ({ game, teamId }) => {
    const disabled = !canPick(game, teamId).ok;
    const selected =
      myPickThisWeek?.game_id === game.id &&
      myPickThisWeek?.team_id === teamId;
    const { last } = oddsPairs[game.id] || {};
    const fav =
      last &&
      ((teamId === game.home_team &&
        (((last.spread_home ?? 0) < (last.spread_away ?? 0)) ||
          (last.ml_home ?? 9999) < (last.ml_away ?? 9999))) ||
        (teamId === game.away_team &&
          (((last.spread_away ?? 0) < (last.spread_home ?? 0)) ||
            (last.ml_away ?? 9999) < (last.ml_home ?? 9999))));
    const pct = popPct(teamId);
    return (
      <button
        onClick={() => confirmPick(game, teamId)}
        disabled={disabled}
        className={clsx(
          "w-full text-left rounded-xl border transition px-4 py-3",
          selected
            ? "border-emerald-500 bg-emerald-50 card"
            : "border-gray-200 hover:bg-gray-50 card",
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
  const nextKick = nextKickoffISO;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{LEAGUE}</h1>
          {lastUpdated && (
            <p className="text-xs text-gray-500">
              Actualizado:{" "}
              {DateTime.fromISO(lastUpdated)
                .setZone(TZ)
                .toFormat("dd LLL HH:mm:ss")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-700">
            Hola, <b>{me?.display_name}</b> · Vidas:{" "}
            <span
              className={clsx(
                "inline-block px-2 py-0.5 rounded",
                (me?.lives ?? 0) > 0
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-rose-100 text-rose-800"
              )}
            >
              {me?.lives ?? 0}
            </span>
          </p>
          <button
            className="text-sm underline"
            onClick={() => supabase.auth.signOut()}
          >
            Salir
          </button>
        </div>
      </header>

      {(me?.lives ?? 0) <= 0 && (
        <div className="mt-3 p-3 border-2 border-rose-300 rounded-xl bg-rose-50 text-rose-900 text-sm">
          Estás <b>eliminado</b> 😵‍💫 — puedes seguir chismoseando la liga, pero
          ya no puedes pickear.
        </div>
      )}

      {showPickAlert && (me?.lives ?? 0) > 0 && (
        <div className="mt-3 p-3 border-2 border-amber-300 rounded-xl bg-amber-50 text-amber-900 text-sm">
          🔔 Aún no tienes pick en W{week}. El primer kickoff es en{" "}
          <b>
            <Countdown iso={nextKick} />
          </b>
          .
        </div>
      )}

      {/* Toolbar */}
      <section className="mt-4 grid md:grid-cols-3 gap-4">
        <div className="p-4 border rounded-2xl bg-white card">
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
                  [
                    "player",
                    "lives",
                    "wins",
                    "losses",
                    "pushes",
                    "margin_sum",
                  ],
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
            <AutoPickButtons week={week} session={session} />
          </div>
        </div>

        <div className="md:col-span-2 p-4 border rounded-2xl bg-white card">
          <h3 className="font-semibold">Resumen</h3>
          <p className="text-sm text-gray-600">
            Elige tu pick en los partidos de abajo. Lock “rolling” por partido.
            Win/Loss se marca automáticamente cuando el juego es FINAL.
          </p>
        </div>
      </section>

      {/* Partidos */}
      <section className="mt-4 p-4 border rounded-2xl bg-white card">
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
            const wpHome = winProbFromSpread(spreadHome) ?? null;
            const wpAway =
              winProbFromSpread(-spreadHome) ??
              (wpHome != null ? 100 - wpHome : null);

            return (
              <div
                key={g.id}
                className={clsx(
                  "p-4 border rounded-xl card",
                  locked && "opacity-60"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm flex items-center gap-2 flex-wrap">
                    <TeamChip id={g.away_team} />
                    <span className="mx-1 text-gray-400">@</span>
                    <TeamChip id={g.home_team} />
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
                    <span className="badge">{local}</span>
                  </div>
                </div>

                <div className="mt-3">
                  <ScoreStrip g={g} />
                </div>

                <div className="mt-2 text-xs text-gray-700 flex gap-3 flex-wrap">
                  {spreadHome != null && (
                    <span className="badge">
                      Spread: {g.home_team}{" "}
                      {spreadHome > 0 ? `+${spreadHome}` : spreadHome},&nbsp;
                      {g.away_team}{" "}
                      {spreadAway > 0 ? `+${spreadAway}` : spreadAway}
                    </span>
                  )}
                  {mlHome != null && mlAway != null && (
                    <span className="badge">
                      ML: {g.home_team} {mlHome}, {g.away_team} {mlAway}
                    </span>
                  )}
                  {(wpHome != null || wpAway != null) && (
                    <span className="badge">
                      Win%: {g.home_team} {wpHome ?? "—"}% · {g.away_team}{" "}
                      {wpAway ?? "—"}%
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
            <div className="text-sm text-gray-500">
              No hay partidos con este filtro/búsqueda.
            </div>
          )}
        </div>
      </section>

      {/* Picks + popularidad */}
      <section className="mt-6 grid md:grid-cols-2 gap-4">
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
                    .sort((a, b) =>
                      (userNames[a.user_id] || "").localeCompare(
                        userNames[b.user_id] || ""
                      )
                    )
                    .map((p) => {
                      const shownRes = derivedResultForPick(p);
                      return (
                        <tr key={p.id}>
                          <td>{userNames[p.user_id] || p.user_id.slice(0, 6)}</td>
                          <td>
                            <TeamMini id={p.team_id} />
                          </td>
                          <td>
                            <span
                              className={
                                shownRes === "win"
                                  ? "text-emerald-700 font-semibold"
                                  : shownRes === "loss"
                                  ? "text-red-600 font-semibold"
                                  : shownRes === "push"
                                  ? "text-gray-600"
                                  : "text-gray-500"
                              }
                            >
                              {shownRes}
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
                      );
                    })
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

        <div className="p-4 border rounded-2xl bg-white card">
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
                  <div className="progressbar mt-1">
                    <div style={{ width: `${row.pct}%` }} />
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-500">Sin picks registrados.</div>
            )}
          </div>
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
                        <td>
                          <TeamMini id={p.team_id} />
                        </td>
                        <td>
                          <span
                            className={
                              shownRes === "win"
                                ? "text-emerald-700 font-semibold"
                                : shownRes === "loss"
                                ? "text-red-600 font-semibold"
                                : shownRes === "push"
                                ? "text-gray-600"
                                : "text-gray-500"
                            }
                          >
                            {shownRes}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
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

      {/* Standings jugadores */}
      <section className="mt-6">
        <div className="p-4 border rounded-2xl bg-white card">
          <h2 className="font-semibold">Standings de jugadores (2025)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm mt-3 table-minimal">
              <thead>
                <tr>
                  <th>Jugador</th>
                  <th>W</th>
                  <th>L</th>
                  <th>T</th>
                </tr>
              </thead>
              <tbody>
                {(playerStandings || []).length ? (
                  playerStandings.map((r) => (
                    <tr key={r.user_id}>
                      <td>{userNames[r.user_id] || r.user_id.slice(0, 6)}</td>
                      <td className="text-emerald-700 font-medium">{r.w}</td>
                      <td className="text-red-600 font-medium">{r.l}</td>
                      <td className="text-gray-600">{r.t}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-2 text-gray-500" colSpan={4}>
                      Sin resultados aún.
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
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 border card">
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

      {/* Banner resultado */}
      {resultBanner && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60]">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 border card text-center">
            <h3 className="font-semibold text-lg">
              {resultBanner.type === "win"
                ? "¡Victoria!"
                : resultBanner.type === "loss"
                ? "Derrota"
                : "Push"}
            </h3>
            <p className="mt-2 text-sm">{resultBanner.msg}</p>
            <button
              className="mt-4 px-4 py-2 rounded bg-black text-white"
              onClick={() => setResultBanner(null)}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {!myPickThisWeek && nextKick && (me?.lives ?? 0) > 0 && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded-xl bg-black text-white text-sm shadow-lg">
          Recuerda elegir: kickoff en <Countdown iso={nextKick} />
        </div>
      )}
    </div>
  );
}

/* -------- Autopick buttons -------- */
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
      <button
        className="text-xs px-3 py-1 rounded border"
        onClick={autopickLeague}
      >
        Autopick (liga)
      </button>
    </>
  );
}

/* ========================= Standings NFL ========================= */
function StandingsTab() {
  const [rows, setRows] = useState([]);
  const [fallback, setFallback] = useState([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("nfl_standings")
        .select("conference, division, team_id, w, l, t, diff")
        .order("conference")
        .order("division")
        .order("team_id");
      setRows(data || []);
    })();
  }, []);

  useEffect(() => {
    if (rows && rows.length) return;
    (async () => {
      const { data: teams } = await supabase
        .from("teams")
        .select("id,conference,division");
      const { data: games } = await supabase
        .from("games")
        .select(
          "home_team,away_team,home_score,away_score,status,season,start_time,period,clock"
        )
        .eq("season", SEASON);

      const by = {};
      teams?.forEach((t) => {
        by[t.id] = {
          team_id: t.id,
          conference: t.conference,
          division: t.division,
          w: 0,
          l: 0,
          t_: 0,
          diff: 0,
        };
      });

      (games || []).forEach((g) => {
        if (!hasGameEnded(g)) return;
        const hs = Number(g.home_score ?? 0),
          as = Number(g.away_score ?? 0);
        if (hs === as) {
          by[g.home_team].t_++;
          by[g.away_team].t_++;
        } else if (hs > as) {
          by[g.home_team].w++;
          by[g.away_team].l++;
        } else {
          by[g.away_team].w++;
          by[g.home_team].l++;
        }
        by[g.home_team].diff += hs - as;
        by[g.away_team].diff += as - hs;
      });

      const list = Object.values(by).map((r) => ({
        conference: r.conference,
        division: r.division,
        team_id: r.team_id,
        w: r.w,
        l: r.l,
        t: r.t_,
        diff: r.diff,
      }));
      setFallback(list);
    })();
  }, [rows]);

  const dataToUse = rows?.length ? rows : fallback;

  const groups = useMemo(() => {
    const out = {};
    (dataToUse || []).forEach((r) => {
      const key = `${r.conference}__${r.division}`;
      if (!out[key])
        out[key] = { conference: r.conference, division: r.division, list: [] };
      out[key].list.push(r);
    });
    return Object.values(out);
  }, [dataToUse]);

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-extrabold mb-3">Standings NFL</h1>
      {(!dataToUse || dataToUse.length === 0) && (
        <p className="text-sm text-gray-500">Sin datos todavía.</p>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {groups.map((g, idx) => (
          <div key={idx} className="p-4 border rounded-2xl bg-white card">
            <h3 className="font-semibold mb-2">
              {g.conference} — {g.division}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-minimal">
                <thead>
                  <tr>
                    <th>Equipo</th>
                    <th>W</th>
                    <th>L</th>
                    <th>T</th>
                    <th>Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {g.list.map((r) => (
                    <tr key={r.team_id}>
                      <td className="font-mono">{r.team_id}</td>
                      <td className="text-emerald-700 font-medium">{r.w}</td>
                      <td className="text-red-600 font-medium">{r.l}</td>
                      <td className="text-gray-600">{r.t}</td>
                      <td>{r.diff}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  const [popularity, setPopularity] = useState([]);

  const [pendingPick, setPendingPick] = useState(null);

  // Cargas
  useEffect(() => {
    (async () => {
      const email = session?.user?.email;
      if (!email || !uid) return;

      // perfil
      const { data: prof } = await supabase.from("profiles").select("*").eq("id", uid).single();
      setMe(prof || null);

      // teams
      const { data: ts } = await supabase.from("teams").select("*");
      const map = {}; (ts || []).forEach((t) => (map[t.id] = t));
      setTeamsMap(map);

      // juegos + odds
      await loadGamesA(week);

      // pick mío
      const { data: myPicks } = await supabase
        .from("picks")
        .select("*")
        .eq("user_id", uid)
        .eq("season", SEASON)
        .eq("week", week)
        .limit(1);
      setMyPick(myPicks?.[0] || null);

      // picks de liga (para popularidad)
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
    const counts = {};
    (pks || []).forEach((p) => { if (p.team_id) counts[p.team_id] = (counts[p.team_id] || 0) + 1; });
    // aproximamos total por número de perfiles (si existe) o por jugadores con pick
    let totalPlayers = 0;
    try {
      const { count } = await supabase.from("profiles").select("*", { count: "exact", head: true });
      totalPlayers = count || 0;
    } catch { totalPlayers = new Set((pks || []).map(p => p.user_id)).size; }
    const list = Object.entries(counts)
      .map(([team_id, count]) => ({ team_id, count, pct: totalPlayers ? Math.round((count * 100) / totalPlayers) : 0 }))
      .sort((a, b) => b.count - a.count);
    setPopularity(list);
  };

  // Helpers
  const gamesMap = useMemo(() => {
    const m = {}; (games || []).forEach((g) => (m[g.id] = g)); return m;
  }, [games]);

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
    // no repetir equipo en la temporada
    // (traemos todos mis picks de temporada para validar)
    return { ok: true };
  };

  const mySeasonTeams = useMemo(() => {
    // construimos a partir de leaguePicks cuando user_id === uid (rápido y suficiente)
    return new Set((leaguePicks || []).filter(p => p.user_id === uid).map(p => p.team_id));
  }, [leaguePicks, uid]);

  function popPct(teamId) {
    return popularity.find((p) => p.team_id === teamId)?.pct ?? 0;
  }

  // Modelos de recomendación (sencillos y explicables)
  const scored = useMemo(() => {
    const rows = [];
    (games || []).forEach((g) => {
      const { last } = oddsPairs[g.id] || {};
      const spreadH = last?.spread_home ?? null;
      const mlH = last?.ml_home ?? null;
      const mlA = last?.ml_away ?? null;

      const wpHome = winProbFromSpread(spreadH);
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
          diffScore: (wp != null ? wp : 0) - pct, // prob ganar - popularidad
          riskScore: (wp != null ? 100 - wp : 100) + pct, // menor es mejor seguro
          used,
          locked,
        });
      };

      // home
      const favHome = (mlH != null && mlA != null) ? mlH < mlA : (spreadH != null ? spreadH < 0 : false);
      addRow(g.home_team, wpHome, favHome);
      // away
      const favAway = (mlH != null && mlA != null) ? mlA < mlH : (spreadH != null ? spreadH > 0 : false);
      addRow(g.away_team, wpAway, favAway);
    });
    return rows;
  }, [games, oddsPairs, popularity, mySeasonTeams]);

  const bestSafe = useMemo(() => {
    // alto wp, no usado, no locked
    return scored
      .filter(r => !r.locked && !r.used)
      .sort((a, b) => (b.wp ?? -1) - (a.wp ?? -1))
      [0] || null;
  }, [scored]);

  const bestDifferential = useMemo(() => {
    // buena prob pero poco popular (alta diffScore), no usado, no locked
    return scored
      .filter(r => !r.locked && !r.used && (r.wp ?? 0) >= 50)
      .sort((a, b) => (b.diffScore) - (a.diffScore))
      [0] || null;
  }, [scored]);

  const trapGames = useMemo(() => {
    // favoritos muy populares pero wp no tan alto
    return scored
      .filter(r => r.fav && (r.wp ?? 0) <= 58 && popPct(r.teamId) >= 35)
      .sort((a, b) => (b.wp ?? 0) - (a.wp ?? 0))
      .slice(0, 3);
  }, [scored]);

  // UI helpers
  const TeamMini = ({ id }) => {
    const logo = teamsMap[id]?.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-1">
        <img src={logo} alt={id} className="h-5 w-5 object-contain" onError={(e)=> (e.currentTarget.style.visibility = "hidden")} />
        <span className="font-mono font-semibold">{id}</span>
      </span>
    );
  };

  const PickButton = ({ rec }) => {
    if (!rec) return null;
    const disqUsed = mySeasonTeams.has(rec.teamId);
    const lock = DateTime.fromISO(rec.game.start_time) <= DateTime.now();
    const c = canPick(rec.game, rec.teamId);
    const disabled = !c.ok || disqUsed || lock;

    const explain =
      `Win% ~ ${rec.wp ?? "—"}% · Popularidad ${popPct(rec.teamId)}%` +
      (disqUsed ? " · (ya usaste este equipo)" : "") +
      (lock ? " · (bloqueado por kickoff)" : "");

    return (
      <div className="p-3 border rounded-xl bg-white card">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-semibold flex items-center gap-2">
              <TeamMini id={rec.teamId} />
              <span className="text-xs text-gray-500">vs {rec.game.home_team === rec.teamId ? rec.game.away_team : rec.game.home_team}</span>
            </div>
            <div className="text-xs text-gray-600 mt-1">{explain}</div>
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
      // refrescar estado local
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
        <div className="p-4 border rounded-2xl bg-white card">
          <h3 className="font-semibold mb-2">Recomendación segura</h3>
          {bestSafe ? <PickButton rec={bestSafe} /> : <p className="text-sm text-gray-500">Aún no hay datos suficientes.</p>}
        </div>

        <div className="p-4 border rounded-2xl bg-white card">
          <h3 className="font-semibold mb-2">Recomendación diferencial</h3>
          {bestDifferential ? <PickButton rec={bestDifferential} /> : <p className="text-sm text-gray-500">Sin diferenciales claros por ahora.</p>}
        </div>

        <div className="p-4 border rounded-2xl bg-white card">
          <h3 className="font-semibold mb-2">Candidatos trampa (para evitar)</h3>
          {trapGames?.length ? (
            <div className="space-y-2">
              {trapGames.map((r, i) => (
                <div key={i} className="p-3 border rounded-xl bg-white">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <TeamMini id={r.teamId} />
                      <span className="text-xs text-gray-500">vs {r.game.home_team === r.teamId ? r.game.away_team : r.game.home_team}</span>
                    </div>
                    <div className="text-xs text-gray-600">Win% ~ {r.wp ?? "—"}% · Pop {popPct(r.teamId)}%</div>
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
            <p className="mt-2 text-sm">
              ¿Confirmas tu pick de <b>{pendingPick.teamId}</b> en W{week}?
            </p>
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

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Intento 1: tabla `news` si existe
      let rows = [];
      try {
        const { data } = await supabase
          .from("news")
          .select("id,title,url,source,published_at,summary,team_id")
          .order("published_at", { ascending: false })
          .limit(30);
        rows = data || [];
      } catch { /* tabla puede no existir */ }

      setItems(rows);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-extrabold mb-3">Noticias NFL</h1>
      {loading && <p className="text-sm text-gray-500">Cargando…</p>}
      {!loading && items.length === 0 && (
        <div className="p-4 border rounded-2xl bg-white card text-sm text-gray-600">
          No hay noticias cargadas aún. (Si quieres, podemos conectar una tabla <code>news</code> en Supabase con <em>title,url,source,published_at,summary</em>).
        </div>
      )}

      <div className="grid gap-3">
        {items.map((n) => (
          <a key={n.id} href={n.url} target="_blank" rel="noreferrer" className="p-4 border rounded-2xl bg-white card hover:bg-gray-50 transition">
            <div className="text-sm text-gray-500">{n.source || "—"} · {n.published_at ? DateTime.fromISO(n.published_at).setZone(TZ).toFormat("dd LLL HH:mm") : ""}</div>
            <div className="font-semibold">{n.title}</div>
            {n.summary && <div className="text-sm text-gray-600 mt-1 line-clamp-2">{n.summary}</div>}
          </a>
        ))}
      </div>
    </div>
  );
}

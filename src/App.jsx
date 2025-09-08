// src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { supabase } from "./lib/supabaseClient";
import Rules from "./Rules";
import "./styles.css";

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

// Win% estimado desde spread (logística ligera)
function winProbFromSpread(spreadForTeam) {
  if (spreadForTeam == null) return null;
  const k = 0.23;
  const p = 1 / (1 + Math.exp(-k * (-spreadForTeam)));
  return Math.round(p * 100);
}

/* ---------- Normalización y heurísticas de estado ---------- */
// ¿Ya empezó?
function hasGameStarted(g) {
  if (!g?.start_time) return false;
  return DateTime.fromISO(g.start_time) <= DateTime.now();
}

// ¿Está marcado "en vivo" por el feed?
function isLiveStatus(s) {
  const x = String(s || "").toLowerCase();
  return ["in_progress", "inprogress", "live", "ongoing", "playing", "active"].includes(x);
}

// ¿Terminó? (status + heurísticas robustas)
function hasGameEnded(g) {
  const s = String(g?.status || "").toLowerCase();
  if (["final", "completed", "complete", "closed", "postgame", "ended", "finished"].includes(s)) {
    return true;
  }

  // Final por periodo y reloj
  const periodOk = (g?.period ?? 0) >= 4;
  const clockStr = String(g?.clock || "").trim();
  const clockDone = clockStr === "0:00" || clockStr === "00:00" || clockStr === "" || clockStr === "Final";
  if (periodOk && clockDone && !isLiveStatus(s)) return true;

  // Heurística de respaldo: si han pasado ≥3.5h desde kickoff y hay scores, lo damos por finalizado
  if (g?.start_time) {
    const hrs = DateTime.now().diff(DateTime.fromISO(g.start_time), "hours").hours;
    const haveScores = g.home_score != null && g.away_score != null;
    if (hrs >= 3.5 && haveScores) return true;
  }
  return false;
}

// Decide WIN/LOSS/PUSH para un teamId dado el juego
function computePickResultFromGame(game, teamId) {
  if (!game || !hasGameEnded(game)) return "pending";
  const hs = Number(game.home_score ?? 0);
  const as = Number(game.away_score ?? 0);
  if (hs === as) return "push";
  const winner = hs > as ? game.home_team : game.away_team;
  return winner === teamId ? "win" : "loss";
}

// Un pick queda "congelado" si su juego ya empezó/terminó, o ya tiene resultado
function isPickFrozen(pick, gamesMap) {
  if (!pick) return false;
  const g = gamesMap[pick.game_id];
  if (!g) return false;
  if (pick.result && pick.result !== "pending") return true;
  return hasGameStarted(g) || hasGameEnded(g);
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
      <div className="w-full max-w-md card p-6">
        <h1 className="text-2xl font-extrabold text-center">{LEAGUE}</h1>
        <div className="mt-4 flex gap-2 justify-center">
          <button className={clsx("seg", tab === "password" && "seg-active")} onClick={() => setTab("password")}>
            Email + Password
          </button>
          <button className={clsx("seg", tab === "magic" && "seg-active")} onClick={() => setTab("magic")}>
            Magic link
          </button>
        </div>

        {tab === "password" && (
          <form onSubmit={doPassword} className="mt-4 space-y-3">
            <div className="text-sm flex justify-between">
              <span className="text-slate-700">{signup ? "Crear cuenta" : "Iniciar sesión"}</span>
              <button type="button" className="underline text-slate-700" onClick={() => setSignup(!signup)}>
                {signup ? "¿Ya tienes cuenta? Inicia" : "¿No tienes cuenta? Regístrate"}
              </button>
            </div>
            <input className="input w-full" placeholder="tu@email.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input className="input w-full" placeholder="contraseña" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} required />
            <button className="btn-primary w-full py-2 rounded-lg disabled:opacity-60" disabled={busy}>
              {signup ? "Crear cuenta" : "Entrar"}
            </button>
          </form>
        )}

        {tab === "magic" && (
          <form onSubmit={doMagic} className="mt-4 space-y-3">
            <input className="input w-full" placeholder="tu@email.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <button className="btn-primary w-full py-2 rounded-lg">Enviar magic link</button>
            {sent && <p className="kicker">Revisa tu correo.</p>}
          </form>
        )}
      </div>
    </div>
  );
}

/* ========================= Root con tabs ========================= */
export default function AppRoot() {
  const session = useSession();
  const [view, setView] = useState("game"); // game | standings | assistant | news | rules

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
  }, []);

  if (!session) return <Login />;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="sticky-nav">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-2">
          {[
            ["game", "Partidos"],
            ["standings", "Standings"],
            ["assistant", "Asistente"],
            ["news", "Noticias"],
            ["rules", "Reglas"],
          ].map(([key, label]) => (
            <button key={key} className={clsx("seg", view === key && "seg-active")} onClick={() => setView(key)}>
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

/* ========================= PARTIDOS ========================= */
function GamesTab() {
  const session = useSession();
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

  // NUEVO: data de toda la temporada para standings de jugadores
  const [allGamesSeason, setAllGamesSeason] = useState([]);
  const [allPicksSeason, setAllPicksSeason] = useState([]);
  const [playerStandings, setPlayerStandings] = useState([]);

  const [dayFilter, setDayFilter] = useState(localStorage.getItem("dayFilter") || "ALL");
  const [teamQuery, setTeamQuery] = useState(localStorage.getItem("teamQuery") || "");
  const searchRef = useRef(null);

  // realtime: picks, games, odds
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
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  /* ---------- Cargas base ---------- */
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
      .select("id,user_id,team_id,result,auto_pick,updated_at,week,season,game_id")
      .eq("week", w)
      .eq("season", SEASON);
    setLeaguePicks(pks || []);

    const ids = [...new Set((pks || []).map((x) => x.user_id))];
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id,display_name").in("id", ids);
      const m = {};
      (profs || []).forEach((p) => (m[p.id] = p.display_name));
      setUserNames(m);
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

  // Cargar temporada completa para standings de jugadores
  const loadSeasonData = async () => {
    const { data: gs } = await supabase
      .from("games")
      .select("*")
      .eq("season", SEASON);
    setAllGamesSeason(gs || []);

    const { data: pks } = await supabase
      .from("picks")
      .select("id,user_id,team_id,game_id,week,season,result,updated_at")
      .eq("season", SEASON);
    setAllPicksSeason(pks || []);
  };

  // Recalcular standings de jugadores
  const recomputePlayerStandings = (allPicks, allGames) => {
    const gamesMap = {};
    (allGames || []).forEach((g) => (gamesMap[g.id] = g));

    const agg = new Map(); // user_id -> {w,l,t}
    (allPicks || []).forEach((p) => {
      const g = gamesMap[p.game_id];
      if (!g) return;
      const res = p.result && p.result !== "pending" ? p.result : computePickResultFromGame(g, p.team_id);
      if (res === "pending") return;

      const row = agg.get(p.user_id) || { w: 0, l: 0, t: 0 };
      if (res === "win") row.w++;
      else if (res === "loss") row.l++;
      else if (res === "push") row.t++;
      agg.set(p.user_id, row);
    });

    return [...agg.entries()]
      .map(([user_id, { w, l, t }]) => ({ user_id, w, l, t }))
      .sort((a, b) => (b.w - a.w) || (a.l - b.l) || (b.t - a.t));
  };

  const initAll = async () => {
    // perfil
    const email = session.user.email;
    let { data: prof } = await supabase.from("profiles").select("*").eq("email", email).single();
    if (!prof) {
      await supabase.from("profiles").insert({ id: session.user.id, email, display_name: email.split("@")[0] });
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

  useEffect(() => {
    if (!session) return;
    initAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    loadGames(week);
    loadLeaguePicks(week);
    localStorage.setItem("week", String(week));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  useEffect(() => localStorage.setItem("dayFilter", dayFilter), [dayFilter]);
  useEffect(() => localStorage.setItem("teamQuery", teamQuery), [teamQuery]);

  // Recalcula standings de jugadores cada vez que cambien juegos o picks de temporada
  useEffect(() => {
    if (!allGamesSeason?.length || !allPicksSeason?.length) return;
    setPlayerStandings(recomputePlayerStandings(allPicksSeason, allGamesSeason));
  }, [allGamesSeason, allPicksSeason]);

  /* ---------- Helpers picks/alertas ---------- */
  const myPickThisWeek = useMemo(
    () => (picks || []).find((p) => p.week === week && p.season === SEASON),
    [picks, week]
  );

  const gamesMap = useMemo(() => {
    const m = {};
    (games || []).forEach((g) => (m[g.id] = g));
    return m;
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

  // Reglas para poder pickear (incluye FROZEN)
  const canPick = (candidateGame, candidateTeam) => {
    if (pickFrozen) {
      const same =
        myPickThisWeek?.game_id === candidateGame.id &&
        myPickThisWeek?.team_id === candidateTeam;
      if (!same) return { ok: false, reason: "FROZEN" };
    }

    // Lock por kickoff del partido candidato
    const lockedCandidate = DateTime.fromISO(candidateGame.start_time) <= DateTime.now();
    if (lockedCandidate) return { ok: false, reason: "LOCK" };

    // No repetir equipos ya usados en la temporada
    const used = (picks || []).some((p) => p.team_id === candidateTeam && p.user_id === session.user.id);
    if (used && !(myPickThisWeek && myPickThisWeek.team_id === candidateTeam)) {
      return { ok: false, reason: "USED" };
    }
    return { ok: true };
  };

  const confirmPick = (game, teamId) => {
    const c = canPick(game, teamId);
    if (!c.ok) {
      const msg =
        c.reason === "FROZEN"
          ? "Tu pick de esta semana ya quedó congelado porque su partido ya inició/terminó."
          : c.reason === "LOCK"
          ? "Este partido ya está cerrado por kickoff."
          : "Ya usaste este equipo antes.";
      return alert(msg);
    }
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
        season: SEASON,
      });
      if (error) return alert(error.message);
    }

    await loadMyPicks();
    await loadLeaguePicks(week);
    await loadSeasonData(); // para standings de jugadores
    const { data: st } = await supabase.from("standings").select("*");
    setStandings(st || []);
    setPendingPick(null);
    setLastUpdated(new Date().toISOString());
  };

  // Derivar resultado mostrado aunque DB aún no lo guarde
  function derivedResultForPick(pick) {
    if (!pick) return "pending";
    if (pick?.result && pick.result !== "pending") return pick.result;
    const g = gamesMap[pick?.game_id];
    if (!g) return "pending";
    return computePickResultFromGame(g, pick.team_id);
  }

  // Asentar automáticamente MIS picks cuando queden "final"
  async function settleMyPicksIfNeeded(currentWeek, gamesArr, myPicksArr) {
    const finals = {};
    (gamesArr || []).forEach((g) => {
      if (hasGameEnded(g)) finals[g.id] = g;
    });
    const updates = [];
    (myPicksArr || []).forEach((p) => {
      if (p.week !== currentWeek) return;
      if (p.result && p.result !== "pending") return;
      const g = finals[p.game_id];
      if (!g) return;
      const res = computePickResultFromGame(g, p.team_id);
      if (res !== "pending") updates.push({ id: p.id, result: res });
    });
    if (updates.length) {
      for (const row of updates) {
        const { error } = await supabase.from("picks").update({ result: row.result }).eq("id", row.id);
        if (error) console.warn("settleMyPicksIfNeeded error:", error.message);
      }
    }
  }

  // Asentar picks de la LIGA (best-effort; si RLS no deja, se ignora)
  async function settleLeaguePicksIfNeeded(currentWeek, gamesArr, leaguePicksArr) {
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
        const { error } = await supabase.from("picks").update({ result: row.result }).eq("id", row.id);
        if (error) console.warn("settleLeaguePicksIfNeeded error:", error.message);
      }
    }
  }

  // Al cambiar juegos/picks, reflejar resultados y best-effort al backend
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
  }, [games, picks, leaguePicks, week]);

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
    const status = String(g.status || "scheduled").toLowerCase();
    const ended = hasGameEnded(g);
    const live = isLiveStatus(status);

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

    if (ended) {
      return (
        <div className="flex items-center justify-between">
          {score}
          <span className="badge">FINAL</span>
        </div>
      );
    }
    if (live) {
      return (
        <div className="flex items-center justify-between">
          {score}
          <div className="kicker flex items-center gap-2">
            {g.period != null && <span className="badge badge-warn">Q{g.period} {g.clock || ""}</span>}
            {g.down != null && g.distance != null && <span className="badge">@ {g.down}&amp;{g.distance}</span>}
            {g.possession && <span className="badge">⬤ {g.possession}</span>}
            {g.red_zone && <span className="badge badge-danger">Red Zone</span>}
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-between">
        {score}
        <span className="badge">Kickoff en&nbsp;<Countdown iso={g.start_time} /></span>
      </div>
    );
  };

  const TeamBox = ({ game, teamId }) => {
    const disabled = !canPick(game, teamId).ok;
    const selected = myPickThisWeek?.game_id === game.id && myPickThisWeek?.team_id === teamId;
    const { last } = oddsPairs[game.id] || {};
    const fav =
      last &&
      ((teamId === game.home_team && ((last.spread_home ?? 0) < (last.spread_away ?? 0) || (last.ml_home ?? 9999) < (last.ml_away ?? 9999))) ||
        (teamId === game.away_team && ((last.spread_away ?? 0) < (last.spread_home ?? 0) || (last.ml_away ?? 9999) < (last.ml_home ?? 9999))));
    const pct = popPct(teamId);

    return (
      <button
        onClick={() => confirmPick(game, teamId)}
        disabled={disabled}
        className={clsx(
          "w-full text-left rounded-xl border transition px-4 py-3",
          selected ? "border-emerald-500 bg-emerald-50 card" : "border-slate-200 hover:bg-slate-50 card",
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

  /* ---------- Filtros ---------- */
  const gamesByDay = useMemo(() => {
    if (dayFilter === "ALL") return games;
    const map = { THU: 4, FRI: 5, SAT: 6, SUN: 7, MON: 1 };
    const want = map[dayFilter];
    return (games || []).filter((g) => DateTime.fromISO(g.start_time).setZone(TZ).weekday === want);
  }, [games, dayFilter]);

  const gamesFiltered = useMemo(() => {
    const q = teamQuery.trim().toLowerCase();
    if (!q) return gamesByDay;
    const match = (id) => {
      const t = teamsMap[id];
      return id.toLowerCase().includes(q) || (t?.name || "").toLowerCase().includes(q);
    };
    return (gamesByDay || []).filter((g) => match(g.away_team) || match(g.home_team));
  }, [gamesByDay, teamQuery, teamsMap]);

  /* ========================= Render ========================= */
  const nextKick = nextKickoffISO;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{LEAGUE}</h1>
          {lastUpdated && (
            <p className="kicker">
              Actualizado:&nbsp;{DateTime.fromISO(lastUpdated).setZone(TZ).toFormat("dd LLL HH:mm:ss")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-slate-700">
            Hola, <b>{me?.display_name}</b> · Vidas:{" "}
            <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">{me?.lives}</span>
          </p>
          <button className="btn-ghost text-sm" onClick={() => supabase.auth.signOut()}>
            Salir
          </button>
        </div>
      </header>

      {showPickAlert && (
        <div className="mt-3 border-2 border-amber-300 rounded-xl bg-amber-50 text-amber-900 text-sm px-3 py-2">
          🔔 Aún no tienes pick en W{week}. El primer kickoff es en <b><Countdown iso={nextKick} /></b>.
        </div>
      )}

      {/* Toolbar */}
      <section className="mt-4 grid md:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="kicker">Semana</label>
              <select className="select" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
                {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                  <option key={w} value={w}>W{w}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-1 text-xs">
              {["ALL", "THU", "FRI", "SAT", "SUN", "MON"].map((d) => (
                <button key={d} className={clsx("seg", dayFilter === d && "seg-active")} onClick={() => setDayFilter(d)}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          <input ref={searchRef} className="input w-full mt-3" placeholder="Buscar equipo…" value={teamQuery} onChange={(e) => setTeamQuery(e.target.value)} />

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="btn text-xs"
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
              className="btn text-xs"
              onClick={() =>
                downloadCSV("standings.csv", [
                  ["player", "lives", "wins", "losses", "pushes", "margin_sum"],
                  ...(standings || []).map((s) => [s.display_name, s.lives, s.wins, s.losses, s.pushes, s.margin_sum]),
                ])
              }
            >
              Exportar standings (CSV)
            </button>
            <AutoPickButtons week={week} />
          </div>
        </div>

        <div className="md:col-span-2 card p-4">
          <h3 className="font-semibold">Resumen</h3>
          <p className="text-sm text-slate-600">
            Elige tu pick en los partidos de abajo. Lock “rolling” por partido. Win/Loss se marca automáticamente cuando el juego es FINAL.
          </p>
        </div>
      </section>

      {/* Partidos */}
      <section className="mt-4 card p-4">
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

            return (
              <div key={g.id} className={clsx("p-4 card", locked && "opacity-60")}>
                <div className="flex items-center justify-between">
                  <div className="text-sm flex items-center gap-2 flex-wrap">
                    <TeamChip id={g.away_team} />
                    <span className="mx-1 text-gray-400">@</span>
                    <TeamChip id={g.home_team} />
                  </div>
                  <div className="kicker flex items-center gap-2">
                    <a href={`https://www.espn.com/nfl/game/_/gameId/${g.id}`} target="_blank" rel="noreferrer" className="underline">
                      Stats
                    </a>
                    <span className="badge">{local}</span>
                  </div>
                </div>

                <div className="mt-3"><ScoreStrip g={g} /></div>

                <div className="mt-2 kicker flex gap-3 flex-wrap">
                  {spreadHome != null && (
                    <span className="badge">
                      Spread: {g.home_team} {spreadHome > 0 ? `+${spreadHome}` : spreadHome},&nbsp;{g.away_team} {spreadAway > 0 ? `+${spreadAway}` : spreadAway}
                    </span>
                  )}
                  {mlHome != null && mlAway != null && (
                    <span className="badge">ML: {g.home_team} {mlHome}, {g.away_team} {mlAway}</span>
                  )}
                  {(wpHome != null || wpAway != null) && (
                    <span className="badge">Win%: {g.home_team} {wpHome ?? "—"}% · {g.away_team} {wpAway ?? "—"}%</span>
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
            <div className="text-sm text-slate-500">No hay partidos con este filtro/búsqueda.</div>
          )}
        </div>
      </section>

      {/* Liga: picks + popularidad */}
      <section className="mt-6 grid md:grid-cols-2 gap-4">
        <div className="card p-4">
          <h2 className="font-semibold">Picks de la liga (W{week})</h2>
          <div className="overflow-x-auto">
            <table className="w-full mt-3 table-minimal">
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
                            <span
                              className={
                                shownRes === "win"
                                  ? "text-emerald-700 font-semibold"
                                  : shownRes === "loss"
                                  ? "text-rose-600 font-semibold"
                                  : shownRes === "push"
                                  ? "text-slate-600"
                                  : "text-slate-500"
                              }
                            >
                              {shownRes}
                            </span>
                          </td>
                          <td>{p.auto_pick ? "Sí" : "No"}</td>
                          <td className="kicker">
                            {p.updated_at ? DateTime.fromISO(p.updated_at).setZone(TZ).toFormat("dd LLL HH:mm") : "-"}
                          </td>
                        </tr>
                      );
                    })
                ) : (
                  <tr>
                    <td className="py-2 text-slate-500" colSpan={5}>Aún no hay picks esta semana.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-4">
          <h2 className="font-semibold">Popularidad de equipos</h2>
          <p className="kicker">Porcentaje de jugadores que pickearon ese equipo.</p>
          <div className="mt-3 space-y-2">
            {(popularity || []).length > 0 ? (
              popularity.map((row) => (
                <div key={row.team_id}>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <TeamMini id={row.team_id} /> <span className="text-slate-500">({row.count})</span>
                    </div>
                    <span className="text-slate-700 text-base font-semibold">{row.pct}%</span>
                  </div>
                  <div className="progressbar mt-1"><div style={{ width: `${row.pct}%` }} /></div>
                </div>
              ))
            ) : (
              <div className="text-sm text-slate-500">Sin picks registrados.</div>
            )}
          </div>
        </div>
      </section>

      {/* Historial usuario */}
      <section className="mt-6">
        <div className="card p-4">
          <h2 className="font-semibold">Historial de tus picks</h2>
          <div className="overflow-x-auto">
            <table className="w-full mt-3 table-minimal">
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
                          <span
                            className={
                              shownRes === "win"
                                ? "text-emerald-700 font-semibold"
                                : shownRes === "loss"
                                ? "text-rose-600 font-semibold"
                                : shownRes === "push"
                                ? "text-slate-600"
                                : "text-slate-500"
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
                    <td className="py-2 text-slate-500" colSpan={3}>Sin picks aún.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* NUEVO: Standings de jugadores (W/L/T) temporada */}
      <section className="mt-6">
        <div className="card p-4">
          <h2 className="font-semibold">Standings de jugadores (2025)</h2>
          <div className="overflow-x-auto">
            <table className="w-full mt-3 table-minimal">
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
                      <td className="text-rose-600 font-medium">{r.l}</td>
                      <td className="text-slate-600">{r.t}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-2 text-slate-500" colSpan={4}>Sin resultados aún.</td>
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
          <div className="w-full max-w-sm card p-5">
            <h3 className="font-semibold text-lg">Confirmar pick</h3>
            <p className="mt-2 text-sm">¿Confirmas tu pick de <b>{pendingPick.teamId}</b> en W{week}?</p>
            <div className="mt-4 flex gap-2">
              <button className="btn" onClick={() => setPendingPick(null)}>Cancelar</button>
              <button className="btn-primary" onClick={doPick}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {!myPickThisWeek && nextKick && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm shadow-lg">
          Recuerda elegir: kickoff en <Countdown iso={nextKick} />
        </div>
      )}
    </div>
  );
}

/* -------- Autopick buttons -------- */
function AutoPickButtons({ week }) {
  const session = useSession();

  const autopickMe = async () => {
    try {
      const url = `${SITE}/api/control?action=autopickOne&week=${week}&user_id=${encodeURIComponent(
        session.user.id
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
      const url = `${SITE}/api/control?action=autopick&week=${week}&token=${encodeURIComponent(CRON_TOKEN)}`;
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || "Error autopick liga");
      alert("Autopick de liga listo.");
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <>
      <button className="btn text-xs" onClick={autopickMe}>Autopick para mí</button>
      <button className="btn text-xs" onClick={autopickLeague}>Autopick (liga)</button>
    </>
  );
}

/* ========================= Standings NFL (con fallback) ========================= */
function StandingsTab() {
  const [rows, setRows] = useState([]);
  const [fallback, setFallback] = useState([]);

  // Intentar vista materializada
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

  // Fallback: calcular desde games final + teams
  useEffect(() => {
    if (rows && rows.length) return;
    (async () => {
      const { data: teams } = await supabase.from("teams").select("id,conference,division");
      const { data: games } = await supabase
        .from("games")
        .select("home_team,away_team,home_score,away_score,status,season,start_time,period,clock")
        .eq("season", SEASON);

      const by = {};
      teams?.forEach((t) => {
        by[t.id] = { team_id: t.id, conference: t.conference, division: t.division, w: 0, l: 0, t_: 0, diff: 0 };
      });

      (games || []).forEach((g) => {
        if (!hasGameEnded(g)) return;
        const hs = Number(g.home_score ?? 0);
        const as = Number(g.away_score ?? 0);
        if (hs === as) {
          by[g.home_team].t_++; by[g.away_team].t_++;
        } else if (hs > as) {
          by[g.home_team].w++; by[g.away_team].l++;
        } else {
          by[g.away_team].w++; by[g.home_team].l++;
        }
        by[g.home_team].diff += (hs - as);
        by[g.away_team].diff += (as - hs);
      });

      const list = Object.values(by).map((r) => ({
        conference: r.conference, division: r.division, team_id: r.team_id, w: r.w, l: r.l, t: r.t_, diff: r.diff,
      }));
      setFallback(list);
    })();
  }, [rows]);

  const dataToUse = rows?.length ? rows : fallback;

  const groups = useMemo(() => {
    const out = {};
    (dataToUse || []).forEach((r) => {
      const key = `${r.conference}__${r.division}`;
      if (!out[key]) out[key] = { conference: r.conference, division: r.division, list: [] };
      out[key].list.push(r);
    });
    return Object.values(out);
  }, [dataToUse]);

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-extrabold mb-3">Standings NFL</h1>
      {(!dataToUse || dataToUse.length === 0) && (
        <p className="text-sm text-slate-500">Sin datos todavía.</p>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {groups.map((g, idx) => (
          <div key={idx} className="card p-4">
            <h3 className="font-semibold mb-2">
              {g.conference} — {g.division}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full table-minimal">
                <thead>
                  <tr>
                    <th>Equipo</th><th>W</th><th>L</th><th>T</th><th>Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {g.list
                    .sort((a,b)=> (b.w - a.w) || (a.l - b.l) || (b.diff - a.diff))
                    .map((r) => (
                      <tr key={r.team_id}>
                        <td className="font-mono">{r.team_id}</td>
                        <td className="text-emerald-700 font-medium">{r.w}</td>
                        <td className="text-rose-600 font-medium">{r.l}</td>
                        <td className="text-slate-600">{r.t}</td>
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

/* ========================= Asistente de Picks (mismas reglas) ========================= */
function AssistantTab() {
  const session = useSession();
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

      const { data: pk } = await supabase.from("picks").select("*").eq("user_id", session.user.id).eq("season", SEASON);
      setPicks(pk || []);

      const { data: lp } = await supabase.from("picks").select("team_id").eq("week", week).eq("season", SEASON);
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
      const list = Object.entries(counts).map(([team, count]) => ({ team, pct: total ? Math.round((count * 100) / total) : 0 }));
      setPop(list);
    })();
  }, [week, session?.user?.id]);

  const used = new Set((picks || []).map((p) => p.team_id));
  const getPop = (team) => pop.find((x) => x.team === team)?.pct ?? 0;

  const myPickThisWeek = (picks || []).find((p) => p.week === week && p.season === SEASON);

  const gamesMap = useMemo(() => {
    const m = {}; (games || []).forEach((g)=> m[g.id]=g); return m;
  }, [games]);

  const pickFrozen = isPickFrozen(myPickThisWeek, gamesMap);

  // Solo FUTUROS para recomendar
  const rows = (games || [])
    .filter((g)=> DateTime.fromISO(g.start_time) > DateTime.now())
    .flatMap((g) => {
      const o = odds[g.id] || {};
      const sHome = o.spread_home;
      const wpHome = winProbFromSpread(sHome) ?? 50;
      const wpAway = winProbFromSpread(-sHome) ?? 50;
      return [
        { game: g, team: g.home_team, vs: g.away_team, wp: wpHome, pop: getPop(g.home_team), used: used.has(g.home_team) },
        { game: g, team: g.away_team, vs: g.home_team, wp: wpAway, pop: getPop(g.away_team), used: used.has(g.away_team) },
      ];
    });

  const ranked = rows
    .map((r) => ({ ...r, score: (r.wp || 50) + (100 - (r.pop || 0)) + (r.used ? -30 : 10) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const confirm = async (r) => {
    if (pickFrozen) return alert("Tu pick de esta semana ya quedó congelado.");
    setBusy(true);
    try {
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

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-extrabold">Asistente</h1>
        <div className="flex items-center gap-2">
          <label className="kicker">Semana</label>
          <select className="select" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
            {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>W{w}</option>
            ))}
          </select>
        </div>
      </header>

      <p className="text-sm text-slate-600 mt-1">
        Ranking por Win% (spread), diferencial de popularidad y si te queda disponible.
      </p>

      <div className="mt-4 grid md:grid-cols-2 gap-3">
        {ranked.map((r, i) => (
          <div key={i} className="card p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TeamMiniSimple teams={teams} id={r.team} />
                <span className="kicker">vs {r.vs}</span>
              </div>
              <span className="kicker">W{r.game.week}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 text-sm">
              <div>
                <div className="kicker">Win%</div>
                <div className="text-base font-bold">{r.wp ?? "—"}%</div>
              </div>
              <div>
                <div className="kicker">Popularidad</div>
                <div className="text-base">{r.pop}%</div>
              </div>
              <div>
                <div className="kicker">Disponible</div>
                <div className="text-base">{r.used ? "No" : "Sí"}</div>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <button disabled={busy || r.used || pickFrozen} className="btn disabled:opacity-50" onClick={() => confirm(r)}>
                Elegir
              </button>
              <span className="ml-auto kicker">Score {Math.round(r.score)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TeamMiniSimple({ teams, id }) {
  const logo = teams[id]?.logo_url || `/teams/${id}.png`;
  return (
    <span className="inline-flex items-center gap-1">
      <img src={logo} alt={id} className="h-5 w-5 object-contain" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
      <span className="font-mono font-semibold">{id}</span>
    </span>
  );
}

/* ========================= Noticias (auto-sync si vacío) ========================= */
function NewsTab() {
  const [team, setTeam] = useState(""); // "" = general
  const [teams, setTeams] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const didAutoSync = useRef(false);

  const load = async (t) => {
    setLoading(true);
    let q = supabase.from("news").select("*").order("published_at", { ascending: false }).limit(30);
    if (t) q = q.eq("team_id", t);
    const { data } = await q;
    setItems(data || []);
    setLoading(false);
    return data || [];
  };

  const syncNow = async (scopeTeam) => {
    const url = scopeTeam
      ? `${SITE}/api/control?action=syncNews&team=${encodeURIComponent(scopeTeam)}&token=${encodeURIComponent(CRON_TOKEN)}`
      : `${SITE}/api/control?action=syncNews&token=${encodeURIComponent(CRON_TOKEN)}`;
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) return alert(j.error || "Error sincronizando");
    await load(team);
    if (scopeTeam) alert(`Noticias sincronizadas (${j.inserted || 0})`);
  };

  useEffect(() => {
    (async () => {
      const { data: ts } = await supabase.from("teams").select("id,name").order("id");
      setTeams(ts || []);
      const first = await load("");
      if (!didAutoSync.current && (!first || first.length === 0)) {
        didAutoSync.current = true;
        try { await syncNow(""); } catch {}
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(team); /* eslint-disable-line */ }, [team]);

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-extrabold">Noticias</h1>
        <div className="flex items-center gap-2">
          <select className="select" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">Generales</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.id} — {t.name}</option>
            ))}
          </select>
          <button className="btn text-xs" onClick={() => syncNow("")}>Sync general</button>
          {team && <button className="btn text-xs" onClick={() => syncNow(team)}>Sync {team}</button>}
        </div>
      </header>

      {loading && <p className="mt-3 kicker">Cargando…</p>}

      <ul className="mt-4 space-y-3">
        {(items || []).map((n) => (
          <li key={n.id} className="card p-3">
            <div className="kicker flex items-center gap-2">
              {n.team_id ? <span className="badge">{n.team_id}</span> : <span className="badge">NFL</span>}
              <span>{n.source || "ESPN"}</span>
              <span>· {n.published_at ? DateTime.fromISO(n.published_at).setZone(TZ).toFormat("dd LLL HH:mm") : ""}</span>
            </div>
            <a href={n.url} target="_blank" rel="noreferrer" className="block mt-1 font-medium underline">
              {n.title}
            </a>
          </li>
        ))}
        {(items || []).length === 0 && !loading && <p className="text-sm text-slate-500">Sin noticias.</p>}
      </ul>
    </div>
  );
}

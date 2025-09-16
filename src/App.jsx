/* ========================= PARTIDOS ========================= */
function GamesTab({ session }) {
  const uid = session?.user?.id || null;

  // Estado principal
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

  // Detalles modal
  const [oddsHistory, setOddsHistory] = useState([]); // [{fetched_at, spread_home, spread_away, ml_home, ml_away}]
  const [leaders, setLeaders] = useState([]);         // [{side, player, stat, value}]
  const [notes, setNotes] = useState([]);             // game_notes
  const [newNote, setNewNote] = useState("");
  const [detailsTab, setDetailsTab] = useState("resumen"); // resumen|odds|leaders|notes

  // Filtros/búsqueda
  const [dayFilter, setDayFilter] = useState(localStorage.getItem("dayFilter") || "ALL");
  const [teamQuery, setTeamQuery] = useState(localStorage.getItem("teamQuery") || "");
  const [statusFilter, setStatusFilter] = useState(localStorage.getItem("statusFilter") || "ALL"); // ALL|LIVE|FINAL|UPCOMING
  const searchRef = useRef(null);

  // NUEVO: favoritos y diferenciales
  const [onlyDiff, setOnlyDiff] = useState(() => localStorage.getItem("onlyDiff") === "1");
  const [diffCutoff, setDiffCutoff] = useState(() => Number(localStorage.getItem("diffCutoff") || 20));
  const [pinned, setPinned] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pinnedGames") || "[]"); } catch { return []; }
  });

  // NUEVO: clima/meta/tips
  const [weatherMap, setWeatherMap] = useState({}); // game_id -> { temp_c, precip_mm, wind_kph, condition, updated_at }
  const [metaMap, setMetaMap] = useState({});       // game_id -> { stadium, city, tv }
  const [tipsMap, setTipsMap] = useState({});       // game_id -> [ { tip, kind } ]

  // Realtime
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
    return () => { supabase.removeChannel(ch); };
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
      setOddsPairs({});
      setWeatherMap({});
      setMetaMap({});
      setTipsMap({});
    }
  };

  async function loadGameMetaWeather(ids) {
    try {
      const { data: metas } = await supabase
        .from("game_meta")
        .select("game_id, stadium, city, tv")
        .in("game_id", ids);
      const mm = {};
      (metas || []).forEach(m => { mm[m.game_id] = { stadium: m.stadium, city: m.city, tv: m.tv }; });
      setMetaMap(mm);
    } catch {}

    try {
      const { data: ws } = await supabase
        .from("weather")
        .select("game_id, temp_c, precip_mm, wind_kph, condition, updated_at")
        .in("game_id", ids);
      const wm = {};
      (ws || []).forEach(w => { wm[w.game_id] = w; });
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
    const gm = {};
    (allGames || []).forEach((g) => (gm[g.id] = g));
    const agg = new Map();
    (allPicks || []).forEach((p) => {
      const g = gm[p.game_id];
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
      .sort((a, b) => b.w - a.w || a.l - b.l || b.t - a.t);
  };

  // Init completo del tab
  const initAll = async () => {
    if (!uid) return;
    const email = session.user.email;
    let { data: prof } = await supabase.from("profiles").select("*").eq("email", email).single();
    if (!prof) {
      await supabase.from("profiles").insert({
        id: uid,
        email,
        display_name: email.split("@")[0],
        lives: 2,
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

  // Efectos de ciclo de vida
  useEffect(() => { initAll(); /* eslint-disable-next-line */ }, [uid]);

  useEffect(() => {
    loadGames(week);
    loadLeaguePicks(week);
    localStorage.setItem("week", String(week));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  // Persistencia de filtros
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

  // Auto-refresh mientras haya juegos en vivo
  useEffect(() => {
    if (!games?.length) return;
    const anyLive = (games || []).some((g) => isLiveStatus(g.status));
    if (!anyLive) return;
    const id = setInterval(() => { loadGames(week); }, 25_000);
    return () => clearInterval(id);
  }, [games, week]);
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
        .update({ team_id: teamId, game_id: game.id, updated_at: new Date().toISOString() })
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
      const { data: profNow } = await supabase.from("profiles").select("lives").eq("id", uid).single();
      const currentLives = profNow?.lives ?? me?.lives ?? 0;
      const newLives = Math.max(0, currentLives - 1);
      if (newLives !== currentLives) {
        await supabase.from("profiles").update({ lives: newLives }).eq("id", uid);
        setMe((m) => ({ ...m, lives: newLives }));
      }
    } catch (e) {
      console.warn("applyLivesIfNeeded error:", e.message);
    } finally {
      localStorage.setItem(lk, "1");
    }
  }

  function funnyMsg(res) {
    if (res === "win") return "¡Ganaste esta semana! 🕺";
    if (res === "loss") return "Perdiste esta semana 😬…";
    return "Push… ni fu ni fa.";
  }
  async function onMyPickResolved(res) {
    setResultBanner({ type: res, msg: funnyMsg(res) });
    if (res === "loss") await applyLivesIfNeeded(res);
  }

  async function settleMyPicksIfNeeded(currentWeek, gamesArr, myPicksArr) {
    const finals = {};
    (gamesArr || []).forEach((g) => { if (hasGameEnded(g)) finals[g.id] = g; });
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
        const { error } = await supabase.from("picks").update({ result: row.result }).eq("id", row.id);
        if (error) console.warn("settleMyPicksIfNeeded error:", error.message);
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

  async function settleLeaguePicksIfNeeded(currentWeek, gamesArr, leaguePicksArr) {
    const finals = {};
    (gamesArr || []).forEach((g) => { if (hasGameEnded(g)) finals[g.id] = g; });
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

  // Triggers de settlement y banner
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

  // Badges especiales
  function timeBadge(g) {
    const lt = DateTime.fromISO(g.start_time).setZone(TZ);
    const wd = lt.weekday; // 1=Mon..7=Sun
    const hour = lt.hour;
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
      if (res === "win") {
        if (type === "W" || type === null) { type = "W"; streak++; } else break;
      } else if (res === "loss") {
        if (type === "L" || type === null) { type = "L"; streak++; } else break;
      } else {
        if (type === null) continue; else break;
      }
    }
    if (!streak) return "—";
    return `${type}${streak}`;
  }

  function lastMatchupsSummary(homeId, awayId, maxN = 3) {
    const relevant = (allGamesSeason || [])
      .filter(x =>
        (x.home_team === homeId && x.away_team === awayId) ||
        (x.home_team === awayId && x.away_team === homeId)
      )
      .sort((a,b) => DateTime.fromISO(b.start_time) - DateTime.fromISO(a.start_time))
      .slice(0, maxN);
    if (!relevant.length) return [];
    return relevant.map(g => {
      const h = g.home_team, a = g.away_team;
      const hs = g.home_score ?? 0, as = g.away_score ?? 0;
      const winner = hs === as ? "TIE" : (hs > as ? h : a);
      return { when: DateTime.fromISO(g.start_time).setZone(TZ).toFormat("dd LLL yyyy"), h, a, hs, as, winner };
    });
  }

  // Deltas de spread
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

  // Favoritos
  function togglePin(gameId) {
    setPinned((xs) => (xs.includes(gameId) ? xs.filter((id) => id !== gameId) : [...xs, gameId]));
  }

  // Copiar link directo al juego
  async function copyGameLink(g) {
    const url = `${SITE}?week=${week}#game-${g.id}`;
    try { await navigator.clipboard.writeText(url); alert("Enlace copiado"); }
    catch { alert(url); }
  }

  // Estado textual
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
    if (statusFilter !== "ALL") {
      base = base.filter((g) => statusOf(g) === statusFilter);
    }
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

  /* ========== Detalles: sparkline + fetch de modal ========== */
  const Sparkline = ({ series }) => {
    if (!series?.length) return <div className="text-xs text-gray-400">Sin historial</div>;
    const w = 220, h = 60, p = 4;
    const xs = series.map((v, i) => ({ x: i, y: Number(v) }));
    const ys = xs.map((d) => d.y);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const xScale = (i) => (i / (xs.length - 1 || 1)) * (w - p * 2) + p;
    const yScale = (v) => (h - p) - ((v - minY) / (maxY - minY || 1)) * (h - p * 2);
    const d = xs.map((pt, i) => `${i === 0 ? "M" : "L"}${xScale(pt.x)},${yScale(pt.y)}`).join(" ");
    return (
      <svg width={w} height={h} className="block">
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  };

  async function openDetails(g) {
    const { last, prev } = oddsPairs[g.id] || {};
    const popHome = popPct(g.home_team);
    const popAway = popPct(g.away_team);
    setDetails({ game: g, odds: { last, prev }, popHome, popAway });
    setDetailsTab("resumen");

    const { data: oh } = await supabase
      .from("odds_history")
      .select("fetched_at, spread_home, spread_away, ml_home, ml_away")
      .eq("game_id", g.id)
      .order("fetched_at", { ascending: true })
      .limit(200);
    setOddsHistory(oh || []);

    const { data: gl } = await supabase
      .from("game_leaders")
      .select("side, player, stat, value")
      .eq("game_id", g.id)
      .order("side")
      .order("stat");
    setLeaders(gl || []);

    const { data: ns } = await supabase
      .from("game_notes")
      .select("id, user_id, note, created_at")
      .eq("game_id", g.id)
      .order("created_at", { ascending: false })
      .limit(100);
    setNotes(ns || []);
  }

  async function addNote() {
    if (!details || !newNote.trim() || !uid) return;
    const row = { game_id: details.game.id, user_id: uid, note: newNote.trim() };
    const { error, data } = await supabase.from("game_notes").insert(row).select("id,user_id,note,created_at").single();
    if (!error && data) {
      setNotes((xs) => [data, ...xs]);
      setNewNote("");
    } else {
      alert(error?.message || "No se pudo guardar la nota.");
    }
  }

  // Win% helper por equipo
  function winPctForTeam(game, teamId) {
    const pair = oddsPairs[game.id];
    if (!pair?.last) return null;
    const sp = teamId === game.home_team ? pair.last.spread_home : pair.last.spread_away;
    return sp != null ? winProbFromSpread(sp) : null;
  }

  // === Botón de pick por equipo (TeamBox)
  const TeamBox = ({ game, teamId }) => {
    const disabled = !canPick(game, teamId).ok;
    const selected = myPickThisWeek?.game_id === game.id && myPickThisWeek?.team_id === teamId;
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
          selected ? "border-emerald-500 bg-emerald-50 card" : "border-gray-200 hover:bg-gray-50 card",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <div className="flex items-center justify-between">
          <TeamMini id={teamId} />
          <div className="flex items-center gap-2">
            {fav && <span className="badge badge-warn">Fav</span>}
            {pct < 15 && <span className="badge">DIF</span>}
            <span className="badge">{pct}%</span>
          </div>
        </div>
      </button>
    );
  };
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

          {/* Estado: ALL/LIVE/FINAL/UPCOMING */}
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

          {/* Diferenciales + umbral */}
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

            // H2H y rachas
            const h2h = lastMatchupsSummary(g.home_team, g.away_team, 3);
            const stHome = teamStreak(g.home_team);
            const stAway = teamStreak(g.away_team);

            // Picks del juego (liga)
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

                <div className="mt-3">
                  <ScoreStrip g={g} />
                </div>

                {/* Meta + Clima */}
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

                {/* Odds + Win% + deltas */}
                <div className="mt-2 text-xs text-gray-700 flex items-center gap-3 flex-wrap">
                  {spreadHome != null && (
                    <span className="badge">
                      Spread: {g.home_team} {spreadHome > 0 ? `+${spreadHome}` : spreadHome}, {g.away_team} {spreadAway > 0 ? `+${spreadAway}` : spreadAway}
                    </span>
                  )}
                  {mlHome != null && mlAway != null && (
                    <span className="badge">
                      ML: {g.home_team} {mlHome}, {g.away_team} {mlAway}
                    </span>
                  )}
                  {(wpHome != null || wpAway != null) && (
                    <span className="badge">
                      Win%: {g.home_team} {wpHome ?? "—"}% · {g.away_team} {wpAway ?? "—"}%
                    </span>
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
                    return (
                      <>
                        {dHome != null && pill(`${g.home_team}`, dHome)}
                        {dAway != null && pill(`${g.away_team}`, dAway)}
                      </>
                    );
                  })()}
                </div>

                {/* Tip cards */}
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
                          <span key={ix} className="mr-2">
                            {r.when}: {r.a} {r.as}–{r.hs} {r.h} ({r.winner})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Picks rápidos por juego */}
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

                {/* Botones pick */}
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
                            <span
                              className={
                                shownRes === "win" ? "text-emerald-700 font-semibold"
                                  : shownRes === "loss" ? "text-red-600 font-semibold"
                                  : shownRes === "push" ? "text-gray-600" : "text-gray-500"
                              }
                            >
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
                          <span
                            className={
                              shownRes === "win" ? "text-emerald-700 font-semibold"
                                : shownRes === "loss" ? "text-red-600 font-semibold"
                                : shownRes === "push" ? "text-gray-600" : "text-gray-500"
                            }
                          >
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
          <div className="w-full max-w-3xl bg-white rounded-2xl p-5 border card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-lg">
                  {details.game.away_team} @ {details.game.home_team}
                </h3>
                <p className="text-sm text-gray-600">
                  {DateTime.fromISO(details.game.start_time).setZone(TZ).toFormat("EEE dd LLL HH:mm")}
                </p>
              </div>
              <button className="px-3 py-1 rounded border text-sm" onClick={() => setDetails(null)}>Cerrar</button>
            </div>

            {/* Tabs */}
            <div className="mt-3 flex gap-2 text-sm">
              {[
                ["resumen","Resumen"],
                ["odds","Odds"],
                ["leaders","Líderes"],
                ["notes","Comentarios"],
              ].map(([k, label]) => (
                <button
                  key={k}
                  className={clsx("px-3 py-1 rounded border", detailsTab === k && "bg-black text-white")}
                  onClick={() => setDetailsTab(k)}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Contenido */}
            {detailsTab === "resumen" && (
              <div className="mt-4 grid md:grid-cols-3 gap-3">
                <div className="p-3 border rounded-xl bg-white">
                  <div className="text-sm font-semibold mb-2">Win % (aprox.)</div>
                  {(() => {
                    const last = details.odds?.last;
                    const spreadHome = last?.spread_home ?? null;
                    const wpHome = winProbFromSpread(spreadHome);
                    const wpAway = winProbFromSpread(-spreadHome) ?? (wpHome != null ? 100 - wpHome : null);
                    return (
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-mono">{details.game.home_team}</span>
                          <b>{wpHome != null ? `${wpHome}%` : "—"}</b>
                        </div>
                        <div className="progressbar"><div style={{ width: `${wpHome ?? 0}%` }} /></div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono">{details.game.away_team}</span>
                          <b>{wpAway != null ? `${wpAway}%` : "—"}</b>
                        </div>
                        <div className="progressbar"><div style={{ width: `${wpAway ?? 0}%` }} /></div>
                      </div>
                    );
                  })()}
                  <p className="mt-2 text-xs text-gray-500">Estimación a partir del spread. Ilustrativo.</p>
                </div>

                <div className="p-3 border rounded-xl bg-white">
                  <div className="text-sm font-semibold mb-2">Odds</div>
                  {(() => {
                    const { last, prev } = details.odds || {};
                    const Row = ({ label, h, a }) => (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600 w-20">{label}</span>
                        <span className="font-mono">{details.game.home_team} {h ?? "—"}</span>
                        <span className="font-mono">{details.game.away_team} {a ?? "—"}</span>
                      </div>
                    );
                    return (
                      <>
                        <Row
                          label="Spread"
                          h={last?.spread_home != null ? (last.spread_home > 0 ? `+${last.spread_home}` : last.spread_home) : null}
                          a={last?.spread_away != null ? (last.spread_away > 0 ? `+${last.spread_away}` : last.spread_away) : null}
                        />
                        <Row label="ML" h={last?.ml_home} a={last?.ml_away} />
                        <div className="h-px bg-gray-200 my-2" />
                        <div className="text-xs text-gray-500 mb-1">Previo</div>
                        <Row
                          label="Spread"
                          h={prev?.spread_home != null ? (prev.spread_home > 0 ? `+${prev.spread_home}` : prev.spread_home) : null}
                          a={prev?.spread_away != null ? (prev.spread_away > 0 ? `+${prev.spread_away}` : prev.spread_away) : null}
                        />
                        <Row label="ML" h={prev?.ml_home} a={prev?.ml_away} />
                      </>
                    );
                  })()}
                </div>

                <div className="p-3 border rounded-xl bg-white">
                  <div className="text-sm font-semibold mb-2">Popularidad de picks</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-mono">{details.game.home_team}</span>
                      <b>{details.popHome}%</b>
                    </div>
                    <div className="progressbar"><div style={{ width: `${details.popHome}%` }} /></div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono">{details.game.away_team}</span>
                      <b>{details.popAway}%</b>
                    </div>
                    <div className="progressbar"><div style={{ width: `${details.popAway}%` }} /></div>
                  </div>
                </div>
              </div>
            )}

            {detailsTab === "odds" && (
              <div className="mt-4 grid md:grid-cols-2 gap-4">
                <div className="p-3 border rounded-xl bg-white">
                  <div className="text-sm font-semibold mb-2">Histórico Spread (home)</div>
                  <Sparkline series={(oddsHistory || []).map((r) => r.spread_home).filter((v) => v != null)} />
                </div>
                <div className="p-3 border rounded-xl bg-white">
                  <div className="text-sm font-semibold mb-2">Histórico Moneyline (home)</div>
                  <Sparkline series={(oddsHistory || []).map((r) => r.ml_home).filter((v) => v != null)} />
                </div>
                <div className="p-3 border rounded-xl bg-white">
                  <div className="text-sm font-semibold mb-2">Histórico Spread (away)</div>
                  <Sparkline series={(oddsHistory || []).map((r) => r.spread_away).filter((v) => v != null)} />
                </div>
                <div className="p-3 border rounded-xl bg-white">
                  <div className="text-sm font-semibold mb-2">Histórico Moneyline (away)</div>
                  <Sparkline series={(oddsHistory || []).map((r) => r.ml_away).filter((v) => v != null)} />
                </div>
              </div>
            )}

            {detailsTab === "leaders" && (
              <div className="mt-4">
                <div className="grid md:grid-cols-2 gap-4">
                  {["home", "away"].map((side) => {
                    const rows = (leaders || []).filter((x) => x.side === side);
                    return (
                      <div key={side} className="p-3 border rounded-xl bg-white">
                        <h4 className="font-semibold text-sm mb-2">{side === "home" ? details.game.home_team : details.game.away_team}</h4>
                        {rows.length ? (
                          <ul className="text-sm space-y-1">
                            {rows.map((r, i) => (
                              <li key={i} className="flex justify-between">
                                <span className="text-gray-700">{r.player} · {r.stat}</span>
                                <span className="font-mono">{r.value}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-gray-500">Sin datos de líderes.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-gray-500">Fuente: tabla <code>game_leaders</code> (vía tu cron).</p>
              </div>
            )}

            {detailsTab === "notes" && (
              <div className="mt-4">
                <div className="p-3 border rounded-xl bg-white">
                  <div className="text-sm font-semibold mb-2">Comentarios del juego</div>
                  <div className="flex gap-2">
                    <input
                      className="border rounded-lg p-2 w-full"
                      placeholder="Escribe una nota (visible para la liga)…"
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                    />
                    <button className="px-3 py-2 rounded bg-black text-white text-sm" onClick={addNote}>Guardar</button>
                  </div>
                  <div className="mt-3 space-y-2 max-h-64 overflow-auto">
                    {(notes || []).map((n) => (
                      <div key={n.id} className="p-2 border rounded-lg">
                        <div className="text-xs text-gray-500">
                          {userNames[n.user_id] || n.user_id.slice(0, 6)} · {DateTime.fromISO(n.created_at).setZone(TZ).toFormat("dd LLL HH:mm")}
                        </div>
                        <div className="text-sm">{n.note}</div>
                      </div>
                    ))}
                    {!notes?.length && <div className="text-xs text-gray-500">Aún no hay notas.</div>}
                  </div>
                </div>
                <p className="mt-2 text-xs text-gray-500">Se guarda en <code>game_notes</code>.</p>
              </div>
            )}

            {/* Footer acciones rápidas */}
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={`https://www.espn.com/nfl/game/_/gameId/${details.game.id}`}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1 rounded border text-sm"
              >
                Ver ficha en ESPN
              </a>
              <a
                href={`https://www.espn.com/nfl/team/_/name/${details.game.home_team.toLowerCase()}`}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1 rounded border text-sm"
              >
                Página {details.game.home_team}
              </a>
              <a
                href={`https://www.espn.com/nfl/team/_/name/${details.game.away_team.toLowerCase()}`}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1 rounded border text-sm"
              >
                Página {details.game.away_team}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AppAuthed({ session }) {
  const [me, setMe] = useState(null);
  const [week, setWeek] = useState(()=>Number(localStorage.getItem('week'))||1);
  const [games, setGames] = useState([]);
  const [oddsPairs, setOddsPairs] = useState({}); // { game_id: {last, prev} }
  const [picks, setPicks] = useState([]);
  const [standings, setStandings] = useState([]);
  const [leaguePicks, setLeaguePicks] = useState([]);
  const [userNames, setUserNames] = useState({});
  const [popularity, setPopularity] = useState([]);
  const [popWeek, setPopWeek] = useState(week);
  const [usedTeams, setUsedTeams] = useState(new Set());
  const [adminMsg, setAdminMsg] = useState('');

  const [dayFilter, setDayFilter] = useState(localStorage.getItem('dayFilter')||'ALL');
  const [teamQuery, setTeamQuery] = useState(localStorage.getItem('teamQuery')||'');

  // teams (para logos y nombres completos)
  const [teamsMap, setTeamsMap] = useState({});
  const loadTeams = async ()=>{
    const { data: ts } = await supabase.from('teams').select('*');
    const map={}; (ts||[]).forEach(t=>{ map[t.id]=t; }); setTeamsMap(map);
  };
  const teamName = (id)=> teamsMap[id]?.name || id; // nombre completo
  const TeamChip = ({ id, small=false })=>{
    const t=teamsMap[id]||{};
    return (
      <span className="inline-flex items-center gap-2">
        {t.logo_url ? <img src={t.logo_url} className={small?'h-5 w-5 rounded-full':'h-6 w-6 rounded-full'} alt={id}/> : null}
        <span className="font-medium">{t.name || id}</span>
      </span>
    );
  };
  const TeamMini = ({ id })=>{
    const t=teamsMap[id]||{};
    return (
      <span className="inline-flex items-center gap-1">
        {t.logo_url ? <img src={t.logo_url} className="h-4 w-4 rounded-full" alt={id}/> : null}
        <span className="font-mono">{id}</span>
      </span>
    );
  };

  // cargas
  const loadGames = async (w)=>{
    const { data: gs } = await supabase.from('games').select('*').eq('week',w).order('start_time');
    setGames(gs||[]);
  };
  const loadOddsPairs = async ()=>{
    if (!games.length) { setOddsPairs({}); return; }
    const ids = games.map(g=>g.id);
    const { data } = await supabase
      .from('odds')
      .select('game_id, spread_home, spread_away, ml_home, ml_away, total, book, fetched_at')
      .in('game_id', ids)
      .order('fetched_at', { ascending:false });
    const by = {};
    for (const row of (data||[])) {
      if (!by[row.game_id]) by[row.game_id] = { last: row, prev: null };
      else if (!by[row.game_id].prev) by[row.game_id].prev = row;
    }
    setOddsPairs(by);
  };
  const loadLeaguePicks = async (w)=>{
    const { data: pks } = await supabase.from('picks').select('id,user_id,team_id,result,auto_pick,updated_at,week').eq('week',w);
    setLeaguePicks(pks||[]);
    const ids=[...(new Set((pks||[]).map(x=>x.user_id)))];
    if (ids.length){
      const { data: profs } = await supabase.from('profiles').select('id,display_name').in('id',ids);
      const m={}; (profs||[]).forEach(p=>{ m[p.id]=p.display_name; }); setUserNames(m);
    } else setUserNames({});
    const { data: total } = await supabase.from('standings').select('user_id');
    const counts={}; (pks||[]).forEach(x=>{ if(x.team_id) counts[x.team_id]=(counts[x.team_id]||0)+1; });
    const list=Object.entries(counts).map(([team_id,count])=>({team_id,count,pct: total?.length?Math.round(count*100/total.length):0})).sort((a,b)=>b.count-a.count);
    setPopularity(list);
  };

  const init = async ()=>{
    const email=session.user.email;
    let { data: prof } = await supabase.from('profiles').select('*').eq('email',email).single();
    if (!prof){
      await supabase.from('profiles').insert({ id: session.user.id, email, display_name: email.split('@')[0] });
      const r = await supabase.from('profiles').select('*').eq('email',email).single(); prof=r.data;
    }
    setMe(prof);
    await loadTeams();
    const { data: pk } = await supabase.from('picks').select('*').eq('user_id',session.user.id);
    setPicks(pk||[]); setUsedTeams(new Set((pk||[]).map(x=>x.team_id)));
    const { data: st } = await supabase.from('standings').select('*'); setStandings(st||[]);
    await loadGames(week); await loadLeaguePicks(week);
  };

  useEffect(()=>{ init(); },[]);
  useEffect(()=>{ loadGames(week).then(loadOddsPairs); loadLeaguePicks(week); setPopWeek(week); },[week]);
  useEffect(()=>{ const id=setInterval(()=>{ loadGames(week).then(loadOddsPairs); loadLeaguePicks(week); },30000); return ()=>clearInterval(id); },[week]);

  useEffect(()=>localStorage.setItem('week',String(week)),[week]);
  useEffect(()=>localStorage.setItem('dayFilter',dayFilter),[dayFilter]);
  useEffect(()=>localStorage.setItem('teamQuery',teamQuery),[teamQuery]);

  const myPickThisWeek = useMemo(()=> (picks||[]).find(p=>p.week===week), [picks,week]);

  const nextKickoffISO = useMemo(()=>{
    const up = (games||[]).find(g=>DateTime.fromISO(g.start_time)>DateTime.now());
    return up?.start_time || null;
  },[games]);
  const showPickAlert = useMemo(()=>{
    if (myPickThisWeek || !nextKickoffISO) return false;
    const mins = DateTime.fromISO(nextKickoffISO).diffNow('minutes').minutes;
    return mins<=90 && mins>0;
  },[myPickThisWeek,nextKickoffISO]);

  // helpers odds y permisos
  const favFromOdds = (g, last) => {
    if (!last) return { fav:null, basis:null };
    if (last.spread_home != null && last.spread_away != null) {
      if (last.spread_home < last.spread_away) return { fav:g.home_team, basis:`Spread ${last.spread_home}` };
      if (last.spread_away < last.spread_home) return { fav:g.away_team, basis:`Spread ${last.spread_away}` };
    }
    if (last.ml_home != null && last.ml_away != null) {
      if (last.ml_home < last.ml_away) return { fav:g.home_team, basis:`ML ${last.ml_home}` };
      if (last.ml_away < last.ml_home) return { fav:g.away_team, basis:`ML ${last.ml_away}` };
    }
    return { fav:null, basis:null };
  };
  const logisticP = (spread) => {
    if (spread == null) return null;
    const k = 0.23;
    const p = 1 / (1 + Math.exp(-(-k * spread)));
    return Math.round(p * 100);
  };
  const canPick = (g,team)=>{
    const locked = DateTime.fromISO(g.start_time)<=DateTime.now();
    if (locked) return {ok:false, reason:'LOCK'};
    if (usedTeams.has(team) && !(myPickThisWeek && myPickThisWeek.team_id===team)) return {ok:false, reason:'USED'};
    return {ok:true};
  };
  const upsertPick = async (g,team)=>{
    if (!team) return;
    const c=canPick(g,team); if(!c.ok) return alert(c.reason==='LOCK'?'Cerrado por kickoff':'Ya usaste este equipo');
    if (myPickThisWeek){
      const { error } = await supabase.from('picks').update({ team_id:team, game_id:g.id, updated_at:new Date().toISOString() }).eq('id',myPickThisWeek.id);
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from('picks').insert({ user_id:session.user.id, game_id:g.id, team_id:team, week, season:2025 });
      if (error) return alert(error.message);
    }
    const { data: pk } = await supabase.from('picks').select('*').eq('user_id',session.user.id);
    setPicks(pk||[]); setUsedTeams(new Set((pk||[]).map(x=>x.team_id)));
  };

  const popPct = (teamId)=> popularity.find(p=>p.team_id===teamId)?.pct ?? 0;
  const isDiff = (teamId)=> popPct(teamId) < 15;

  // Filtros
  const gamesByDay = useMemo(()=>{
    if (dayFilter==='ALL') return games;
    const map={THU:4,FRI:5,SAT:6,SUN:7,MON:1};
    const want=map[dayFilter]; return (games||[]).filter(g=>DateTime.fromISO(g.start_time).setZone(TZ).weekday===want);
  },[games,dayFilter]);
  const gamesFiltered = useMemo(()=>{
    const q=teamQuery.trim().toLowerCase(); if(!q) return gamesByDay;
    const match=(id)=>{ const t=teamsMap[id]; return id.toLowerCase().includes(q) || (t?.name||'').toLowerCase().includes(q); };
    return (gamesByDay||[]).filter(g=>match(g.away_team)||match(g.home_team));
  },[gamesByDay,teamQuery,teamsMap]);

  const chipDay = (iso)=>{
    const wd=DateTime.fromISO(iso).setZone(TZ).weekday;
    if (wd===4) return 'TNF'; if (wd===5) return 'Fri'; if (wd===6) return 'Sat';
    if (wd===7) return 'Sun'; if (wd===1) return 'MNF'; return '';
  };

  // ============ UI: Tarjetas de selección (boxes) ============
  const TeamBox = ({ game, teamId, last })=>{
    const disabled = !canPick(game, teamId).ok;
    const selected = myPickThisWeek?.game_id===game.id && myPickThisWeek?.team_id===teamId;
    const isHome = teamId===game.home_team;
    const wp = logisticP(isHome ? last?.spread_home : (last?.spread_away!=null ? -last.spread_away : null));
    const pct = popPct(teamId);
    const fav = favFromOdds(game,last).fav === teamId;

    return (
      <button
        onClick={()=>upsertPick(game, teamId)}
        disabled={disabled}
        className={`w-full text-left p-3 rounded-xl border transition
          ${selected ? 'border-emerald-500 ring-2 ring-emerald-200 bg-emerald-50' : 'hover:bg-gray-50'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <div className="flex items-center gap-3">
          <TeamMini id={teamId}/>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{teamId}</span>
              {fav && <span className="text-[10px] px-1.5 rounded bg-amber-100 text-amber-900">Fav</span>}
              {pct<15 && <span className="text-[10px] px-1.5 rounded bg-indigo-100 text-indigo-800">DIF</span>}
            </div>
            <div className="text-[11px] text-gray-600">
              Liga: <b>{pct}%</b>{wp!=null ? <> · Win <b>{wp}%</b></> : null}
            </div>
          </div>
        </div>
      </button>
    );
  };

  // ======= Encabezado juego (nombres completos + logos pequeños) =======
  const GameHeader = ({ g })=>{
    const local = DateTime.fromISO(g.start_time).setZone(TZ).toFormat('EEE dd LLL HH:mm');
    const chip = chipDay(g.start_time);
    const special = (()=>{
      const notes=(g.notes||'').toLowerCase(); const city=(g.venue_city||'').toLowerCase();
      if (notes.includes('thanksgiving')) return 'Thanksgiving';
      if (notes.includes('christmas')||notes.includes('navidad')) return 'Christmas';
      if (city.includes('london')) return 'London';
      if (city.includes('frankfurt')||city.includes('munich')) return 'Germany';
      if (g.neutral_site) return 'Neutral';
      return null;
    })();

    return (
      <div>
        <div className="text-sm flex items-center gap-2 flex-wrap">
          <TeamChip id={g.away_team} />
          <span className="mx-1 text-gray-400">@</span>
          <TeamChip id={g.home_team} />
          {chip && <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800">{chip}</span>}
          {special && <span className="text-[11px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-800">{special}</span>}
        </div>
        <div className="mt-1 text-xs text-gray-600">
          Kickoff: <span className="px-1.5 py-0.5 rounded bg-gray-100">{local}</span> · Lock en: <Countdown iso={g.start_time}/>
        </div>
      </div>
    );
  };

  // ========= Top 3 (se mantiene) =========
  const top3 = useMemo(()=>{
    const rows = [];
    for (const g of (games||[])) {
      const { last } = oddsPairs[g.id] || {};
      const wpHome = logisticP(last?.spread_home);
      const wpAway = (last?.spread_away!=null) ? logisticP(-last.spread_away) : null;
      const h = { team:g.home_team, available: !usedTeams.has(g.home_team), wp: wpHome, pct: popPct(g.home_team), g };
      const a = { team:g.away_team, available: !usedTeams.has(g.away_team), wp: wpAway, pct: popPct(g.away_team), g };
      [h,a].forEach(r=>{
        if (!r.available || r.wp==null) return;
        const score = r.wp - r.pct * 0.6;
        rows.push({ ...r, score });
      });
    }
    return rows.sort((x,y)=>y.score-x.score).slice(0,3);
  },[games,oddsPairs,usedTeams,popularity]);

  // zona admin
  const amAdmin = isAdminEmail(session.user.email);
  const callAdmin = async (path, extra='')=>{
    const base = import.meta.env.VITE_SITE_URL || window.location.origin;
    try {
      const url = `${base}${path}?token=${import.meta.env.VITE_ADMIN_TOKEN || 'DEV'}&week=${week}${extra}`;
      const r=await fetch(url); const j=await r.json();
      setAdminMsg(`${path}: ${j.ok ? 'OK' : 'ERROR'} ${j.inserted!=null ? `· inserted=${j.inserted}`:''}`);
      setTimeout(()=>setAdminMsg(''), 4000);
    } catch(e){
      setAdminMsg(`${path}: ERROR ${e.message}`);
      setTimeout(()=>setAdminMsg(''), 4000);
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-6 bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between gap-4 py-3 sticky top-0 bg-gradient-to-b from-slate-50/95 to-white/95 backdrop-blur z-10">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">{import.meta.env.VITE_LEAGUE_NAME || 'Survivor 2025'}</h1>
            <p className="text-sm text-gray-600">Hola, <b>{me?.display_name}</b> · Vidas: <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">{me?.lives}</span></p>
          </div>
          <button className="text-sm underline hover:text-red-600" onClick={()=>supabase.auth.signOut()}>Salir</button>
        </header>

        {adminMsg && (
          <div className="mt-2 mb-2 p-2 rounded-lg border bg-indigo-50 text-indigo-900">
            {adminMsg}
          </div>
        )}

        {showPickAlert && (
          <div className="mt-2 mb-4 p-4 border-2 border-red-300 rounded-xl bg-red-50 text-red-900 text-sm">
            🔔 Aún no tienes pick en W{week}. El primer kickoff es en <b><Countdown iso={nextKickoffISO}/></b>.
          </div>
        )}

        {/* Toolbar */}
        <section className="mt-4 grid gap-4">
          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <label className="text-xs text-gray-500">Semana</label>
                  <select className="border p-1 rounded-lg ml-2" value={week} onChange={e=>setWeek(Number(e.target.value))}>
                    {Array.from({length:18},(_,i)=>i+1).map(w=><option key={w} value={w}>W{w}</option>)}
                  </select>
                </div>
                <div className="hidden md:flex items-center gap-1 text-xs">
                  {['ALL','THU','FRI','SAT','SUN','MON'].map(d=>(
                    <button key={d} className={`px-2 py-1 rounded border ${dayFilter===d?'bg-black text-white':'hover:bg-gray-50'}`} onClick={()=>setDayFilter(d)}>{d}</button>
                  ))}
                </div>
              </div>

              <div className="flex-1 md:max-w-sm">
                <input className="border w-full p-2 rounded-lg" placeholder="Buscar equipo..." value={teamQuery} onChange={e=>setTeamQuery(e.target.value)} />
              </div>

              <div className="flex items-center gap-2">
                <button className="text-xs px-3 py-1 rounded border hover:bg-gray-50"
                  onClick={()=>downloadCSV('mis_picks.csv', [['week','team_id','result','auto_pick','updated_at'], ...(picks||[]).map(p=>[p.week,p.team_id,p.result,p.auto_pick,p.updated_at])])}>
                  Exportar mis picks (CSV)
                </button>
                <button className="text-xs px-3 py-1 rounded border hover:bg-gray-50"
                  onClick={()=>downloadCSV('standings.csv', [['player','lives','wins','losses','pushes','margin_sum'], ...(standings||[]).map(s=>[s.display_name,s.lives,s.wins,s.losses,s.pushes,s.margin_sum])])}>
                  Exportar standings (CSV)
                </button>
                <button className="text-xs px-3 py-1 rounded border hover:bg-gray-50" onClick={()=>{ loadGames(week).then(loadOddsPairs); loadLeaguePicks(week); }}>
                  Refrescar datos
                </button>
              </div>
            </div>

            {/* Top 3 */}
            <div className="mt-3 p-3 rounded-lg bg-gray-50 border">
              <h3 className="font-medium">Top 3 sugerencias (win% y diferencial)</h3>
              <div className="mt-2 grid sm:grid-cols-3 gap-2">
                {top3.map((r,idx)=>(
                  <div key={idx} className="p-2 border rounded bg-white text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium"><TeamMini id={r.team}/> {teamName(r.team)}</span>
                      <span className="text-xs text-gray-500">Score {Math.round(r.score)}</span>
                    </div>
                    <div className="text-xs text-gray-600">Win%: <b>{r.wp}%</b> · Liga: <b>{r.pct}%</b> {r.pct<15 && <span className="ml-1 px-1 rounded bg-indigo-100 text-indigo-800">DIF</span>}</div>
                    <button className="mt-2 w-full border rounded px-2 py-1 hover:bg-gray-50" onClick={()=>upsertPick(r.g, r.team)}>Elegir</button>
                  </div>
                ))}
                {top3.length===0 && <div className="text-xs text-gray-500">No hay sugerencias disponibles.</div>}
              </div>

              {isAdminEmail(session.user.email) && (
                <div className="p-3 mt-3 rounded-lg bg-gray-50 border text-sm flex flex-wrap items-center gap-2">
                  <span className="font-medium mr-2">Admin:</span>
                  <button className="px-3 py-1 rounded border hover:bg-gray-100" onClick={()=>callAdmin('/api/autopick')}>Auto-pick global (W{week})</button>
                  <button className="px-3 py-1 rounded border hover:bg-gray-100" onClick={()=>callAdmin('/api/notifyReminders')}>Recordatorios (~3h)</button>
                  <button className="px-3 py-1 rounded border hover:bg-gray-100" onClick={()=>callAdmin('/api/syncOdds')}>Sync odds</button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Partidos */}
        <section className="mt-4 p-4 border rounded-2xl bg-white shadow-sm">
          <h2 className="font-semibold mb-3">Partidos W{week}</h2>
          <div className="space-y-3">
            {gamesFiltered.map(g=>{
              const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
              const { last, prev } = oddsPairs[g.id] || {};
              const { fav, basis } = favFromOdds(g, last);
              const wpHome = logisticP(last?.spread_home);
              const wpAway = (last?.spread_away!=null) ? logisticP(-last.spread_away) : null;
              const spreadMoved = prev?.spread_home!=null && last?.spread_home!=null
                ? (last.spread_home - prev.spread_home) : null;
              const arrow = spreadMoved==null ? '' : (spreadMoved<0 ? '↑' : (spreadMoved>0 ? '↓' : '→'));

              return (
                <div key={g.id} className={`p-4 border rounded-xl ${locked?'opacity-60':'bg-white'} shadow-sm`}>
                  {/* Encabezado con nombres completos */}
                  <GameHeader g={g} />

                  {/* Odds visibles */}
                  {last && (
                    <div className="mt-2 text-xs">
                      <div className="inline-flex items-center gap-2 px-2 py-1 rounded bg-gray-50 border">
                        <span className="text-gray-600">Odds:</span>
                        <span className="font-mono">ML {g.home_team}: {last.ml_home ?? '-'}</span>
                        <span className="font-mono">ML {g.away_team}: {last.ml_away ?? '-'}</span>
                        <span className="font-mono">Spread {g.home_team}: {last.spread_home ?? '-'}</span>
                        {arrow && <span title="Movimiento de spread (home) vs previo">{arrow}</span>}
                        <span className="font-mono">Total: {last.total ?? '-'}</span>
                        <span className="text-[11px] text-gray-500">({last.book})</span>
                      </div>
                      <div className="mt-1 text-[11px] text-gray-700">
                        Win% {g.home_team}: <b>{wpHome ?? '-' }%</b> · Win% {g.away_team}: <b>{wpAway ?? '-' }%</b>
                        {fav && <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">FAVORITO: {fav} ({basis})</span>}
                      </div>
                    </div>
                  )}

                  {/* Boxes de selección */}
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <TeamBox game={g} teamId={g.home_team} last={last}/>
                    <TeamBox game={g} teamId={g.away_team} last={last}/>
                  </div>

                  {/* marcador simple */}
                  <div className="mt-2 text-xs">
                    Estado:{' '}
                    <span className={
                      g.status==='in_progress' ? 'text-amber-700 font-medium' :
                      g.status==='final' ? 'text-emerald-700 font-medium' :
                      g.status==='postponed' ? 'text-gray-700 font-medium' : 'text-gray-700'
                    }>{g.status}</span>
                    {(g.status==='in_progress'||g.status==='final') && (
                      <span className="ml-2 font-mono">{g.away_team} {g.away_score??'-'} — {g.home_team} {g.home_score??'-'}</span>
                    )}
                  </div>
                </div>
              );
            })}
            {(!gamesFiltered || gamesFiltered.length===0) && <div className="text-sm text-gray-500">No hay partidos para este filtro o búsqueda.</div>}
          </div>
        </section>

        {/* Liga: picks + popularidad */}
        <section className="mt-6 grid md:grid-cols-2 gap-4">
          {/* Picks con LOGO */}
          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <h2 className="font-semibold">Picks de la liga (W{week})</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm mt-3">
                <thead><tr className="text-left text-gray-500"><th>Jugador</th><th>Equipo</th><th>Resultado</th><th>Auto</th><th>Actualizado</th></tr></thead>
                <tbody>
                  {(leaguePicks||[]).length>0 ? leaguePicks
                    .slice()
                    .sort((a,b)=>(userNames[a.user_id]||'').localeCompare(userNames[b.user_id]||''))
                    .map((p,idx)=>(
                      <tr key={idx} className="border-t">
                        <td className="py-1.5">{userNames[p.user_id] || p.user_id.slice(0,6)}</td>
                        <td><TeamMini id={p.team_id}/> {teamName(p.team_id)}</td>
                        <td><span className={
                          p.result==='win'?'text-emerald-700 font-semibold':
                          p.result==='loss'?'text-red-600 font-semibold':
                          p.result==='push'?'text-gray-600':'text-gray-500'
                        }>{p.result || '-'}</span></td>
                        <td>{p.auto_pick?'Sí':'No'}</td>
                        <td className="text-xs text-gray-500">{p.updated_at?DateTime.fromISO(p.updated_at).setZone(TZ).toFormat('dd LLL HH:mm'):'-'}</td>
                      </tr>
                    )) : <tr><td className="py-2 text-gray-500" colSpan={5}>Aún no hay picks esta semana.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Popularidad con LOGO */}
          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Popularidad de equipos</h2>
              <select className="border p-1 rounded" value={popWeek} onChange={e=>{ const w=Number(e.target.value); setPopWeek(w); loadLeaguePicks(w); }}>
                {Array.from({length:18},(_,i)=>i+1).map(w=><option key={w} value={w}>W{w}</option>)}
              </select>
            </div>
            <p className="text-xs text-gray-600">Porcentaje de jugadores que pickearon ese equipo.</p>
            <div className="mt-3 space-y-2">
              {(popularity||[]).length>0 ? popularity.map(row=>(
                <div key={row.team_id}>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2"><TeamMini id={row.team_id}/> <span className="font-medium">{teamName(row.team_id)}</span> <span className="text-gray-500">({row.count})</span></div>
                    <span className="text-gray-700">{row.pct}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded mt-1"><div className="h-2 rounded bg-black" style={{width:`${row.pct}%`}}/></div>
                </div>
              )) : <div className="text-sm text-gray-500">No hay picks registrados esta semana.</div>}
            </div>
          </div>
        </section>

        {/* Standings + Historial */}
        <section className="mt-6 grid md:grid-cols-2 gap-4">
          {/* Standings con más detalle y LOGO del pick de la semana */}
          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <h2 className="font-semibold">Tabla de supervivientes</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm mt-3">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th>Jugador</th><th>Vidas</th><th>W</th><th>L</th><th>Push</th><th>Margen</th><th>Pick W{week}</th>
                  </tr>
                </thead>
                <tbody>
                  {(standings||[]).map(s=>{
                    const lp = leaguePicks.find(p=>p.user_id===s.user_id);
                    return (
                      <tr key={s.user_id} className="border-t">
                        <td className="py-1.5">{s.display_name}</td>
                        <td>{s.lives}</td>
                        <td className="text-emerald-700 font-medium">{s.wins}</td>
                        <td className="text-red-600 font-medium">{s.losses}</td>
                        <td className="text-gray-600">{s.pushes}</td>
                        <td>{s.margin_sum}</td>
                        <td>{lp?.team_id ? <><TeamMini id={lp.team_id}/> {teamName(lp.team_id)}</> : <span className="text-gray-400">—</span>}</td>
                      </tr>
                    );
                  })}
                  {(!standings || standings.length===0) && <tr><td className="py-2 text-gray-500" colSpan={7}>Aún no hay standings.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Historial con LOGO */}
          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <h2 className="font-semibold">Historial de tus picks</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm mt-3">
                <thead><tr className="text-left text-gray-500"><th>W</th><th>Equipo</th><th>Resultado</th></tr></thead>
                <tbody>
                  {(picks||[]).sort((a,b)=>a.week-b.week).map(p=>(
                    <tr key={p.id} className="border-t">
                      <td className="py-1.5">{p.week}</td>
                      <td><TeamMini id={p.team_id}/> {teamName(p.team_id)}</td>
                      <td><span className={
                        p.result==='win'?'text-emerald-700 font-semibold':
                        p.result==='loss'?'text-red-600 font-semibold':
                        p.result==='push'?'text-gray-600':'text-gray-500'
                      }>{p.result || 'pending'}</span></td>
                    </tr>
                  ))}
                  {(!picks || picks.length===0) && <tr><td className="py-2 text-gray-500" colSpan={3}>Aún no has hecho picks.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}







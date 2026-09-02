import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';

const BUSCAS = [
  { title: 'Assistidos recentes', kind: 'recentes', terms: [] },
  { title: 'Series atuais', kind: 'serie', terms: ['Lanterns', 'The Last of Us', 'The Boys', 'House of the Dragon', 'Stranger Things', 'Fallout'] },
  { title: 'Filmes em destaque', kind: 'filme', terms: ['Dune', 'Batman', 'Matrix', 'Interestelar', 'Avatar', 'Oppenheimer'] },
  { title: 'Para maratonar', kind: 'serie', terms: ['Breaking Bad', 'Dark', 'The Walking Dead', 'The Witcher', 'Better Call Saul', 'Peaky Blinders'] },
];

const RECENTS_KEY = 'discord-caseiro:cinema:recentes';

function agruparPorTemporada(episodes) {
  const grupos = new Map();
  for (const ep of episodes) {
    if (!grupos.has(ep.season)) grupos.set(ep.season, []);
    grupos.get(ep.season).push(ep);
  }
  return [...grupos.entries()].sort(([a], [b]) => a - b);
}

function lerRecentes() {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function salvarRecente(item) {
  try {
    const atuais = lerRecentes().filter((recent) => recent.key !== item.key);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify([{ ...item, watchedAt: Date.now() }, ...atuais].slice(0, 12)));
  } catch {
    // localStorage pode estar indisponivel em alguns contextos embarcados.
  }
}

function Card({ item, onClick, rank }) {
  return (
    <button className="cinema-card" onClick={onClick}>
      {rank ? <b className="cinema-rank">{rank}</b> : null}
      <span className="cinema-poster-wrap">
        {item.poster ? <img src={item.poster} alt="" loading="lazy" /> : <span className="cinema-poster-empty"><Icon name="film" size={30} /></span>}
      </span>
      <span className="cinema-card-info">
        <small>{item.isRecent ? 'Recente' : item.kind === 'filme' ? 'Filme' : 'Serie'}</small>
        <strong>{item.title}</strong>
        <em>{item.subtitle ?? item.years ?? item.cast ?? item.imdbId}</em>
      </span>
    </button>
  );
}

function Row({ title, items, onChoose, ranked = false }) {
  if (!items?.length) return null;
  return (
    <section className="cinema-row">
      <div className="cinema-row-head">
        <h3>{title}</h3>
        <span>{items.length} titulos</span>
      </div>
      <div className="cinema-row-track">
        {items.map((item, index) => <Card key={item.key ?? item.id} item={item} rank={ranked ? index + 1 : null} onClick={() => onChoose(item)} />)}
      </div>
    </section>
  );
}

export default function CinemaHome({ onClose, onErro }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('serie');
  const [tab, setTab] = useState('inicio');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [rows, setRows] = useState([]);
  const [recentes, setRecentes] = useState(() => lerRecentes());
  const [selected, setSelected] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [season, setSeason] = useState(null);
  const [player, setPlayer] = useState(null);
  const playerRef = useRef(null);
  const playerFrameRef = useRef(null);
  const [playerFullscreen, setPlayerFullscreen] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all(BUSCAS.filter((row) => row.kind !== 'recentes').map(async (row) => {
      const items = await Promise.all(row.terms.map((term) => api.watchSearch(term, row.kind).then((r) => r.results?.[0]).catch(() => null)));
      return { ...row, items: items.filter(Boolean) };
    })).then((list) => { if (alive) setRows(list); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      api.watchSearch(q, kind)
        .then((r) => { if (alive) setResults(r.results ?? []); })
        .catch((e) => { if (alive) onErro?.(e.message); })
        .finally(() => { if (alive) setLoading(false); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, kind, onErro]);

  useEffect(() => {
    if (!selected || selected.kind === 'filme' || selected.kind === 'recente') { setEpisodes([]); return undefined; }
    let alive = true;
    api.watchEpisodes(selected.imdbId)
      .then((r) => {
        if (!alive) return;
        setEpisodes(r.episodes ?? []);
        setSeason(r.episodes?.[0]?.season ?? null);
      })
      .catch((e) => { if (alive) onErro?.(e.message); });
    return () => { alive = false; };
  }, [selected, onErro]);

  const seasons = useMemo(() => agruparPorTemporada(episodes), [episodes]);
  const currentEpisodes = seasons.find(([s]) => s === season)?.[1] ?? [];
  const featured = results[0] ?? rows[0]?.items?.[0] ?? rows[1]?.items?.[0] ?? null;
  const hasSearch = query.trim().length >= 2;
  const visibleRows = rows.filter((row) => tab === 'inicio' || row.kind === tab);
  const tipoFixo = tab === 'serie' || tab === 'filme';

  function remember(media, source) {
    const item = {
      key: media.kind + ':' + (media.imdbId ?? source?.imdbId ?? media.title) + ':' + (media.season ?? '') + ':' + (media.episode ?? ''),
      id: media.imdbId ?? source?.id ?? media.title,
      kind: media.kind,
      title: media.title,
      subtitle: media.subtitle,
      poster: media.poster ?? source?.poster,
      imdbId: media.imdbId ?? source?.imdbId,
    };
    salvarRecente(item);
    setRecentes(lerRecentes());
  }

  async function playMovie(item) {
    const { media } = await api.watchPlayer({ kind: 'filme', imdbId: item.imdbId, title: item.title, poster: item.poster, subtitle: item.years ?? item.year ?? '' });
    remember({ ...media, kind: 'filme', imdbId: item.imdbId, poster: item.poster }, item);
    setPlayer(media);
  }

  async function playEpisode(ep) {
    const { media } = await api.watchPlayer({
      kind: 'serie', imdbId: selected.imdbId, season: ep.season, episode: ep.number,
      title: selected.title, poster: ep.poster ?? selected.poster,
      subtitle: 'T' + ep.season + ' E' + ep.number + ' - ' + ep.title,
    });
    remember({ ...media, kind: 'serie', imdbId: selected.imdbId, season: ep.season, episode: ep.number, poster: ep.poster ?? selected.poster }, selected);
    setPlayer(media);
  }

  async function alternarTelaCheia() {
    const frame = playerFrameRef.current;
    if (!frame) return;
    const sair = Boolean(document.fullscreenElement || playerFullscreen);
    if (sair) {
      await document.exitFullscreen().catch(() => {});
      const sairElectron = window.appDesktop?.telaCheia;
      if (sairElectron) await sairElectron(false).catch(() => {});
      setPlayerFullscreen(false);
      return;
    }

    // No Electron, o player abre em uma janela nativa fullscreen. Isso evita
    // que o site externo limite o iframe a uma caixa dentro do app.
    const abrirPlayer = window.appDesktop?.abrirPlayerTelaCheia;
    if (abrirPlayer) {
      // A janela principal continua viva quando fica escondida. Limpar o
      // iframe antes de abrir a copia fullscreen impede dois audios tocando.
      const srcOriginal = frame.src;
      frame.src = 'about:blank';
      const abriu = await abrirPlayer(player.url).catch(() => false);
      if (abriu) return;
      frame.src = srcOriginal;
    }

    // No navegador comum, inicia no mesmo gesto do clique para preservar a
    // permissao temporaria necessaria para o fullscreen do iframe.
    setPlayerFullscreen(true);
    await frame.requestFullscreen().catch(() => {});
  }

  useEffect(() => {
    const atualizar = () => setPlayerFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', atualizar);
    const cancelarElectron = window.appDesktop?.aoMudarTelaCheia?.(setPlayerFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', atualizar);
      cancelarElectron?.();
    };
  }, []);

  useEffect(() => {
    const restaurar = window.appDesktop?.aoFecharPlayerTelaCheia?.(() => {
      if (playerFrameRef.current && player?.url) playerFrameRef.current.src = player.url;
    });
    return () => restaurar?.();
  }, [player]);

  function mudarAba(novaTab) {
    setTab(novaTab);
    if (novaTab === 'serie' || novaTab === 'filme') setKind(novaTab);
  }

  function choose(item) {
    if (item.kind === 'filme') return playMovie(item).catch((e) => onErro?.(e.message));
    setSelected(item);
  }

  return (
    <section className="cinema-page cinema-streaming-page">
      <header className="cinema-page-top cinema-streaming-nav">
        <div className="cinema-brand"><strong>Orbit Cinema</strong><span>Streaming caseiro</span></div>
        <nav>
          <button className={tab === 'inicio' ? 'ativo' : ''} onClick={() => mudarAba('inicio')}>Inicio</button>
          <button className={tab === 'serie' ? 'ativo' : ''} onClick={() => mudarAba('serie')}>Series</button>
          <button className={tab === 'filme' ? 'ativo' : ''} onClick={() => mudarAba('filme')}>Filmes</button>
          <button className={tab === 'recentes' ? 'ativo' : ''} onClick={() => mudarAba('recentes')}>Assistidos recentes</button>
        </nav>
        <label className="cinema-top-search"><Icon name="search" size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar titulo, IMDb ou TMDb" /></label>
        <button className="cinema-back" onClick={onClose}><Icon name="arrow-right" size={14} style={{ transform: 'rotate(180deg)' }} /> Voltar</button>
      </header>
      <div className="cinema-home">
        {player ? (
          <section className={`cinema-player ${playerFullscreen ? 'cinema-player-fullscreen' : ''}`} ref={playerRef}>
            <div className="cinema-player-toolbar">
              <button className="cinema-back" onClick={() => setPlayer(null)}><Icon name="arrow-right" size={14} style={{ transform: 'rotate(180deg)' }} /> Voltar ao catalogo</button>
              <button className="cinema-fullscreen-btn" onClick={alternarTelaCheia} title={playerFullscreen ? 'Sair da tela cheia' : 'Abrir tela cheia'}><Icon name={'expand'} size={15} /> {playerFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}</button>
            </div>
            <iframe ref={playerFrameRef} src={player.url} title={player.title} allow="autoplay *; encrypted-media *; picture-in-picture *; fullscreen *; clipboard-write *" allowFullScreen />
            <strong>{player.title}</strong>
            <span>{player.subtitle}</span>
          </section>
        ) : selected ? (
          <section className="cinema-detail">
            <button className="cinema-back" onClick={() => setSelected(null)}><Icon name="arrow-right" size={14} style={{ transform: 'rotate(180deg)' }} /> Voltar</button>
            <div className="cinema-detail-head">
              {selected.poster && <img src={selected.poster} alt="" />}
              <span><small>{selected.kind === 'filme' ? 'Filme' : 'Serie'}</small><h2>{selected.title}</h2><p>{selected.subtitle ?? selected.years ?? selected.cast ?? selected.imdbId}</p></span>
            </div>
            <div className="cinema-seasons">{seasons.map(([s]) => <button key={s} className={s === season ? 'ativo' : ''} onClick={() => setSeason(s)}>Temporada {s}</button>)}</div>
            <div className="cinema-episodes">
              {currentEpisodes.map((ep) => (
                <button key={ep.id} onClick={() => playEpisode(ep).catch((e) => onErro?.(e.message))}>
                  {ep.poster ? <img src={ep.poster} alt="" loading="lazy" /> : <span />}
                  <span><strong>E{ep.number} - {ep.title}</strong><small>{ep.airdate ?? 'Episodio'}</small></span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <>
            <section className="cinema-hero" style={featured?.poster ? { backgroundImage: 'linear-gradient(90deg, rgba(0, 0, 0, .96), rgba(0, 0, 0, .64) 46%, rgba(0, 0, 0, .18)), url(' + featured.poster + ')' } : undefined}>
              <div className="cinema-hero-copy">
                <strong>ORBIT ORIGINAL</strong>
                <h2>{hasSearch ? 'Resultados para "' + query.trim() + '"' : featured?.title ?? 'Cinema sem entrar em call'}</h2>
                <p>{hasSearch ? 'Busca em tempo real no catalogo conectado ao seu servidor.' : 'Filmes, series e episodios em uma pagina propria, com historico recente e visual de streaming dentro do Orbit.'}</p>
                <div className="cinema-hero-actions">
                  {featured ? <button onClick={() => choose(featured)}><Icon name="play" size={18} /> Assistir</button> : null}
                  <button className="secundario" onClick={() => setTab('recentes')}><Icon name="clock" size={17} /> Recentes</button>
                </div>
              </div>
            </section>
            <div className="cinema-mobile-search">
              <label className="cinema-top-search"><Icon name="search" size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar titulo, IMDb ou TMDb" autoFocus /></label>
            </div>
            {!tipoFixo && <div className="cinema-kind"><button className={kind === 'serie' ? 'ativo' : ''} onClick={() => setKind('serie')}>Series</button><button className={kind === 'filme' ? 'ativo' : ''} onClick={() => setKind('filme')}>Filmes</button></div>}
            {tipoFixo && <div className="cinema-context"><Icon name={kind === 'filme' ? 'film' : 'tv'} size={14} /> Mostrando apenas {kind === 'filme' ? 'filmes' : 'series'}</div>}
            {hasSearch ? <Row title={loading ? 'Buscando...' : 'Resultados'} items={results} onChoose={choose} /> : null}
            {!hasSearch && tab === 'recentes' ? <Row title="Assistidos recentes" items={recentes.filter((item) => !tipoFixo || item.kind === kind).map((item) => ({ ...item, isRecent: true }))} onChoose={choose} /> : null}
            {!hasSearch && tab !== 'recentes' ? <Row title="Assistidos recentes" items={recentes.filter((item) => !tipoFixo || item.kind === kind).map((item) => ({ ...item, isRecent: true }))} onChoose={choose} /> : null}
            {!hasSearch && visibleRows.map((row, index) => <Row key={row.title} title={row.title} items={row.items} ranked={index === 0 && tab === 'inicio'} onChoose={choose} />)}
          </>
        )}
      </div>
    </section>
  );
}

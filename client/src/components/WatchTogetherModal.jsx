import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';

const HISTORICO_KEY = 'discord-caseiro-watch-history';
const RECOMENDADOS_SERIES = ['Lanterns', 'The Last of Us', 'Breaking Bad', 'The Boys'];
const RECOMENDADOS_FILMES = ['Dune', 'Batman', 'Interestelar', 'Matrix'];

function agruparPorTemporada(episodes) {
  const grupos = new Map();
  for (const ep of episodes) {
    if (!grupos.has(ep.season)) grupos.set(ep.season, []);
    grupos.get(ep.season).push(ep);
  }
  return [...grupos.entries()].sort(([a], [b]) => a - b);
}

function lerHistorico() {
  try {
    const lista = JSON.parse(localStorage.getItem(HISTORICO_KEY) ?? '[]');
    return Array.isArray(lista) ? lista.slice(0, 18) : [];
  } catch {
    return [];
  }
}

function salvarHistorico(item) {
  try {
    const atual = lerHistorico().filter((entrada) => entrada.id !== item.id);
    localStorage.setItem(HISTORICO_KEY, JSON.stringify([{ ...item, watchedAt: Date.now() }, ...atual].slice(0, 18)));
  } catch {}
}

function WatchCard({ item, destaque = false, onClick }) {
  return (
    <button className={'watch-card ' + (destaque ? 'destaque' : '')} onClick={onClick}>
      {item.poster ? <img src={item.poster} alt="" loading="lazy" /> : <span className="watch-poster-empty"><Icon name="film" size={30} /></span>}
      <span className="watch-card-meta">
        <small>{item.kind === 'filme' ? 'Filme' : 'Serie'}</small>
        <strong>{item.title}</strong>
        <em>{item.subtitle ?? item.years ?? item.cast ?? item.imdbId}</em>
      </span>
    </button>
  );
}

function WatchRow({ title, items, loading, emptyText, onSelect }) {
  if (!loading && (!items || items.length === 0)) {
    return (
      <section className="watch-row">
        <div className="watch-row-title"><strong>{title}</strong></div>
        <p className="hint">{emptyText}</p>
      </section>
    );
  }

  return (
    <section className="watch-row">
      <div className="watch-row-title"><strong>{title}</strong></div>
      <div className="watch-carousel">
        {loading && Array.from({ length: 5 }).map((_, i) => <span key={i} className="watch-skeleton" />)}
        {!loading && items.map((item, i) => (
          <WatchCard key={item.id ?? item.imdbId ?? i} item={item} destaque={i === 0} onClick={() => onSelect(item)} />
        ))}
      </div>
    </section>
  );
}

export default function WatchTogetherModal({ channelId, onClose, onStart, onErro }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('serie');
  const [tab, setTab] = useState('busca');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [season, setSeason] = useState(null);
  const [history, setHistory] = useState(() => lerHistorico());
  const [recomendadosSeries, setRecomendadosSeries] = useState([]);
  const [recomendadosFilmes, setRecomendadosFilmes] = useState([]);
  const [recomendadosLoading, setRecomendadosLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setRecomendadosLoading(true);
    Promise.all([
      Promise.all(RECOMENDADOS_SERIES.map((q) => api.watchSearch(q, 'serie').then((r) => r.results?.[0]).catch(() => null))),
      Promise.all(RECOMENDADOS_FILMES.map((q) => api.watchSearch(q, 'filme').then((r) => r.results?.[0]).catch(() => null))),
    ]).then(([series, filmes]) => {
      if (!alive) return;
      setRecomendadosSeries(series.filter(Boolean));
      setRecomendadosFilmes(filmes.filter(Boolean));
    }).finally(() => { if (alive) setRecomendadosLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      api.watchSearch(q, kind)
        .then(({ results: list }) => { if (alive) setResults(list ?? []); })
        .catch((e) => { if (alive) onErro?.(e.message); })
        .finally(() => { if (alive) setLoading(false); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, kind, onErro]);

  useEffect(() => {
    if (!selected || selected.kind !== 'serie') { setEpisodes([]); return undefined; }
    let alive = true;
    setEpisodesLoading(true);
    api.watchEpisodes(selected.imdbId)
      .then(({ episodes: list }) => {
        if (!alive) return;
        setEpisodes(list ?? []);
        setSeason(list?.[0]?.season ?? null);
      })
      .catch((e) => { if (alive) onErro?.(e.message); })
      .finally(() => { if (alive) setEpisodesLoading(false); });
    return () => { alive = false; };
  }, [selected, onErro]);

  const seasons = useMemo(() => agruparPorTemporada(episodes), [episodes]);
  const currentEpisodes = seasons.find(([s]) => s === season)?.[1] ?? [];
  const heroItem = selected ?? results[0] ?? recomendadosSeries[0] ?? recomendadosFilmes[0] ?? null;

  async function startEpisode(ep) {
    const itemHistorico = {
      id: selected.imdbId + ':' + ep.season + ':' + ep.number,
      kind: 'serie', imdbId: selected.imdbId, title: selected.title,
      poster: ep.poster ?? selected.poster,
      subtitle: 'T' + ep.season + ' E' + ep.number + ' - ' + ep.title,
    };
    const { media } = await api.watchPlayer({
      kind: 'serie', imdbId: selected.imdbId, season: ep.season, episode: ep.number,
      title: selected.title, poster: itemHistorico.poster, subtitle: itemHistorico.subtitle,
    });
    salvarHistorico(itemHistorico);
    setHistory(lerHistorico());
    await onStart(channelId, media);
    onClose();
  }

  async function startMovie(item = selected) {
    const itemHistorico = {
      id: item.imdbId ?? item.id,
      kind: 'filme', imdbId: item.imdbId, title: item.title, poster: item.poster,
      subtitle: item.years ?? item.year ?? '',
    };
    const { media } = await api.watchPlayer({
      kind: 'filme', imdbId: item.imdbId, title: item.title, poster: item.poster,
      subtitle: item.years ?? item.year ?? '',
    });
    salvarHistorico(itemHistorico);
    setHistory(lerHistorico());
    await onStart(channelId, media);
    onClose();
  }

  function selecionar(item) {
    if (item.kind === 'filme') return startMovie(item).catch((e) => onErro?.(e.message));
    setSelected(item);
  }

  return (
    <Modal title="Apps" onClose={onClose} wide>
      <div className="watch-modal watch-catalogo">
        <div className="watch-hero" style={heroItem?.poster ? { backgroundImage: 'linear-gradient(90deg, rgba(8, 10, 16, .95) 0%, rgba(8, 10, 16, .78) 46%, rgba(8, 10, 16, .18) 100%), url(' + heroItem.poster + ')' } : undefined}>
          <span className="watch-eyebrow">Cinema</span>
          <h2>{selected ? selected.title : query.trim().length >= 2 ? 'Resultados para "' + query.trim() + '"' : 'Escolha o que assistir'}</h2>
          <p>Pesquise filmes, series, animes e doramas pelo titulo, codigo TMDb ou IMDb.</p>
          <label className="watch-search grande">
            <Icon name="search" size={17} />
            <input value={query} onChange={(e) => { setQuery(e.target.value); setSelected(null); setTab('busca'); }} placeholder="Buscar filme ou serie" autoFocus />
          </label>
        </div>

        {!selected && (
          <>
            <div className="watch-tabs watch-main-tabs" role="tablist" aria-label="Catalogo">
              <button className={tab === 'busca' ? 'ativo' : ''} onClick={() => setTab('busca')}>Busca</button>
              <button className={tab === 'recomendados' ? 'ativo' : ''} onClick={() => setTab('recomendados')}>Recomendados</button>
              <button className={tab === 'assistidos' ? 'ativo' : ''} onClick={() => setTab('assistidos')}>Assistidos por ultimo</button>
            </div>

            <div className="watch-tabs watch-kind-tabs" role="tablist" aria-label="Tipo">
              <button className={kind === 'serie' ? 'ativo' : ''} onClick={() => setKind('serie')}>Series</button>
              <button className={kind === 'filme' ? 'ativo' : ''} onClick={() => setKind('filme')}>Filmes</button>
            </div>

            {tab === 'busca' && (
              <WatchRow
                title={query.trim().length >= 2 ? 'Resultados' : 'Comece pesquisando'}
                items={results}
                loading={loading}
                emptyText={query.trim().length >= 2 ? 'Nada encontrado.' : 'Digite o nome de algo para assistir.'}
                onSelect={selecionar}
              />
            )}

            {tab === 'recomendados' && (
              <>
                <WatchRow title="Series em destaque" items={recomendadosSeries} loading={recomendadosLoading} emptyText="Sem recomendacoes agora." onSelect={selecionar} />
                <WatchRow title="Filmes para abrir agora" items={recomendadosFilmes} loading={recomendadosLoading} emptyText="Sem filmes agora." onSelect={selecionar} />
              </>
            )}

            {tab === 'assistidos' && (
              <WatchRow title="Assistidos por ultimo" items={history} loading={false} emptyText="Quando voce iniciar algo, ele aparece aqui." onSelect={selecionar} />
            )}
          </>
        )}

        {selected && selected.kind === 'serie' && (
          <div className="watch-episodes watch-serie-view">
            <button className="watch-back" onClick={() => setSelected(null)}>
              <Icon name="arrow-right" size={14} style={{ transform: 'rotate(180deg)' }} /> Voltar
            </button>
            <div className="watch-title-row grande">
              {selected.poster && <img src={selected.poster} alt="" />}
              <span>
                <small>Serie</small>
                <strong>{selected.title}</strong>
                <em>{selected.years ?? selected.cast ?? selected.imdbId}</em>
              </span>
            </div>
            {episodesLoading ? <p className="hint">Carregando episodios...</p> : (
              <>
                <div className="watch-seasons">
                  {seasons.map(([s]) => <button key={s} className={s === season ? 'ativo' : ''} onClick={() => setSeason(s)}>Temporada {s}</button>)}
                </div>
                <div className="watch-episode-list">
                  {currentEpisodes.map((ep) => (
                    <button key={ep.id} className="watch-episode" onClick={() => startEpisode(ep).catch((e) => onErro?.(e.message))}>
                      {ep.poster ? <img src={ep.poster} alt="" loading="lazy" /> : <span />}
                      <span>
                        <strong>E{ep.number} - {ep.title}</strong>
                        <small>{ep.airdate ?? 'Episodio'}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

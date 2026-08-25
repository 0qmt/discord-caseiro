import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';

/**
 * Encaminhar uma mensagem pra outro canal ou pra uma conversa.
 *
 * Manda o texto e o anexo, não a mensagem original: encaminhar não é mover,
 * e a cópia passa a ser sua no destino. Também não leva a resposta que a
 * mensagem original citava - do outro lado aquele contexto não existe, e a
 * citação apontaria pro vazio.
 */
export default function EncaminharModal({ mensagem, guilds, dms, onEnviar, onClose }) {
  const [busca, setBusca] = useState('');
  const [enviando, setEnviando] = useState(null);
  const [enviados, setEnviados] = useState(() => new Set());
  const [erro, setErro] = useState(null);
  const [canais, setCanais] = useState(null);

  /*
   * A lista de servidores que o app carrega é só o resumo (nome e ícone) -
   * os canais só vêm no detalhe de cada um. Então busca aqui, na abertura:
   * é o único momento em que a lista completa é necessária, e assim o app
   * não carrega canal de servidor nenhum à toa no login.
   */
  useEffect(() => {
    let cancelado = false;
    Promise.all(guilds.map((g) => api.getGuild(g.id)
      .then(({ guild }) => (guild.channels ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => ({ id: c.id, nome: c.name, contexto: guild.name })))
      .catch(() => [])))
      .then((listas) => { if (!cancelado) setCanais(listas.flat()); });
    return () => { cancelado = true; };
  }, [guilds]);

  const termo = busca.trim().toLowerCase();

  const destinos = [
    ...(canais ?? []).map((c) => ({
      chave: `canal:${c.id}`,
      tipo: 'canal',
      id: c.id,
      nome: c.nome,
      contexto: c.contexto,
    })),
    ...dms.map((d) => ({
      chave: `dm:${d.id}`,
      tipo: 'dm',
      id: d.id,
      nome: d.otherUser?.username ?? 'conversa',
      contexto: 'Mensagem direta',
      user: d.otherUser,
    })),
  ].filter((d) => !termo
    || d.nome.toLowerCase().includes(termo)
    || d.contexto.toLowerCase().includes(termo));

  async function mandar(destino) {
    setEnviando(destino.chave);
    setErro(null);
    try {
      await onEnviar(destino, mensagem);
      setEnviados((prev) => new Set(prev).add(destino.chave));
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(null);
    }
  }

  const previa = mensagem.content?.trim()
    || (mensagem.attachment ? `anexo: ${mensagem.attachment.name ?? 'arquivo'}` : 'mensagem vazia');

  return (
    <Modal title="Encaminhar mensagem" onClose={onClose}>
      <div className="encaminhar-previa">
        <Avatar user={mensagem.author} size={28} className="small" />
        <div>
          <strong>{mensagem.author.username}</strong>
          <p>{previa}</p>
        </div>
      </div>

      <input
        placeholder="Procurar canal ou conversa"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        autoFocus
      />

      {erro && <div className="auth-error">{erro}</div>}

      <div className="encaminhar-lista">
        {canais === null && <p className="hint">Carregando canais...</p>}
        {canais !== null && destinos.length === 0 && <p className="hint">Nada com esse nome.</p>}
        {destinos.map((d) => {
          const jaFoi = enviados.has(d.chave);
          return (
            <button
              key={d.chave}
              className="encaminhar-item"
              disabled={enviando === d.chave || jaFoi}
              onClick={() => mandar(d)}
            >
              {d.tipo === 'dm'
                ? <Avatar user={d.user} size={26} className="small" />
                : <span className="encaminhar-hash"><Icon name="hash" size={15} /></span>}
              <span className="encaminhar-nome">
                <strong>{d.nome}</strong>
                <span className="hint small">{d.contexto}</span>
              </span>
              <span className="encaminhar-estado">
                {jaFoi ? <Icon name="check" size={15} /> : enviando === d.chave ? '...' : 'Enviar'}
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

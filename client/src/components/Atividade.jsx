import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';

/**
 * O que a pessoa está fazendo agora: jogando alguma coisa, ouvindo música, ou
 * um texto que ela mesma escreveu com /jogando.
 *
 * A atividade chega do servidor como objeto ({ tipo, nome, detalhe, desde,
 * imagem }); string ainda é aceita porque versão antiga do app de desktop
 * manda assim (ver `atividadeValida` no realtime.js).
 */

const VERBO = { jogo: 'Jogando', musica: 'Ouvindo' };

/**
 * "há 2h 15min", "há 5min", "agora".
 *
 * Sem segundos de propósito: um contador que muda a cada segundo na lista de
 * membros vira poluição visual e obriga a re-renderizar a lista inteira o
 * tempo todo, pra dizer uma coisa que ninguém lê nesse nível de precisão.
 */
export function tempoDecorrido(desde, agora = Date.now()) {
  if (!desde) return null;
  const minutos = Math.floor((agora - desde) / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos}min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `há ${horas}h ${resto}min` : `há ${horas}h`;
}

/**
 * Reconta o tempo de minuto em minuto.
 *
 * O intervalo é de 30s, e não 60s, pra que a virada de "agora" pra "há 1min"
 * não demore até um minuto inteiro pra aparecer - com passo igual ao da
 * unidade mostrada, o atraso no pior caso é a unidade toda.
 */
function useAgora(ativo) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return undefined;
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [ativo]);
  return agora;
}

/** Normaliza a atividade: string antiga ou objeto novo, sai sempre objeto. */
export function lerAtividade(bruta) {
  if (!bruta) return null;
  if (typeof bruta === 'string') return { tipo: 'custom', nome: bruta, detalhe: null, desde: null, imagem: null };
  return bruta;
}

/** Uma linha só, pra lista de membros e painel do usuário. */
export function AtividadeResumo({ atividade, className = '' }) {
  const a = lerAtividade(atividade);
  if (!a) return null;
  const verbo = VERBO[a.tipo];
  const texto = verbo ? `${verbo} ${a.nome}` : a.nome;
  const completo = a.detalhe ? `${texto} — ${a.detalhe}` : texto;
  return <span className={`atividade-resumo ${className}`} title={completo}>{completo}</span>;
}

/**
 * Cartão completo, com imagem e há quanto tempo - usado no perfil, onde tem
 * espaço pra mostrar de verdade em vez de espremer numa linha.
 */
export default function Atividade({ atividade }) {
  const a = lerAtividade(atividade);
  const agora = useAgora(Boolean(a?.desde));
  if (!a) return null;

  const decorrido = tempoDecorrido(a.desde, agora);
  const ehMusica = a.tipo === 'musica';

  return (
    <div className="atividade-cartao">
      <div className={`atividade-capa ${ehMusica ? 'musica' : ''}`}>
        {a.imagem
          ? <img src={a.imagem} alt="" />
          : <Icon name={ehMusica ? 'music' : 'monitor'} size={20} />}
      </div>
      <div className="atividade-texto">
        <span className="atividade-rotulo">{VERBO[a.tipo] ?? 'Status'}</span>
        <strong className="atividade-nome">{a.nome}</strong>
        {a.detalhe && <span className="atividade-detalhe">{a.detalhe}</span>}
        {decorrido && <span className="atividade-tempo">{decorrido}</span>}
      </div>
    </div>
  );
}

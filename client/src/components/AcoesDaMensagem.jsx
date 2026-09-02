import { EMOJIS_RAPIDOS } from '../lib/menuDeMensagem.jsx';
import Icon from './Icon.jsx';

/** Quantos emoji ficam soltos na barra antes do botão de abrir o resto. */
const ATALHOS = 3;

/**
 * A barra que aparece no canto da mensagem quando o mouse passa por cima.
 *
 * É um atalho pro menu de botão direito, não um menu paralelo: as três
 * reações mais usadas, responder, encaminhar e "..." pro resto. Tudo que
 * está aqui também está no menu completo - quem descobrir só um dos dois
 * caminhos não fica sem nada.
 *
 * Mora fora da tela principal para continuar sendo uma peça única do chat.
 */
export default function AcoesDaMensagem({
  message, onReagir, onResponder, onEncaminhar, onAbrirEmoji, onMais, className = '',
}) {
  return (
    <div className={`msg-acoes ${className}`}>
      {onReagir && EMOJIS_RAPIDOS.slice(0, ATALHOS).map((emoji) => (
        <button
          key={emoji}
          className="msg-acao-emoji"
          title={`Reagir com ${emoji}`}
          onClick={() => onReagir(message.id, emoji)}
        >
          {emoji}
        </button>
      ))}

      {onAbrirEmoji && (
        <button className="icon-btn" title="Reagir" onClick={onAbrirEmoji}>
          <Icon name="smile" />
        </button>
      )}

      {onResponder && (
        <button className="icon-btn" title="Responder" onClick={() => onResponder(message)}>
          <Icon name="reply" />
        </button>
      )}

      {onEncaminhar && (
        <button className="icon-btn" title="Encaminhar" onClick={() => onEncaminhar(message)}>
          <Icon name="arrow-right" />
        </button>
      )}

      <button className="icon-btn" title="Mais" onClick={onMais}>
        <Icon name="more" />
      </button>
    </div>
  );
}

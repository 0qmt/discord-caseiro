import Icon from '../components/Icon.jsx';

/**
 * Emoji de reação rápida. Uma lista só pro app inteiro: o balãozinho de
 * reação da mensagem e a fileira do topo do menu puxam daqui, senão as duas
 * ofereceriam emoji diferentes pra mesma coisa.
 */
export const EMOJIS_RAPIDOS = ['👍', '❤️', '😂', '🔥', '😮', '😢', '🎉', '👀'];

/** Quantos cabem na fileira do menu sem ela virar uma parede de emoji. */
const NO_MENU = 6;

/** Lê a mensagem em voz alta. Sem biblioteca: é a API do próprio navegador. */
function falar(texto) {
  const fala = window.speechSynthesis;
  if (!fala || !texto) return;
  // Cancela o que estiver falando: pedir duas mensagens seguidas deve trocar
  // a leitura, não enfileirar e obrigar a esperar a primeira acabar.
  fala.cancel();
  const pedido = new SpeechSynthesisUtterance(texto);
  pedido.lang = 'pt-BR';
  fala.speak(pedido);
}

const copiar = (texto) => navigator.clipboard?.writeText(texto).catch(() => {});

/**
 * Os itens do menu de botão direito de uma mensagem.
 *
 * Fica fora da tela principal para que menu, atalhos e chat compartilhem a
 * mesma fonte de ações e não saiam de sincronia.
 *
 * Cada ação é opcional: o que não recebe handler simplesmente não aparece,
 * em vez de aparecer desabilitado sem explicação.
 */
export function itensDeMensagem({
  message, meId, podeModerar = false, canalId,
  onReagir, onResponder, onEditar, onFixarMensagem, onApagar,
  onEncaminhar, onMarcarNaoLido, onDenunciar,
}) {
  const minha = message.author.id === meId;
  const itens = [];

  if (onReagir) {
    itens.push({
      tipo: 'reacoes',
      emojis: EMOJIS_RAPIDOS.slice(0, NO_MENU),
      onReagir: (emoji) => onReagir(message.id, emoji),
    });
  }

  if (onResponder) {
    itens.push({
      label: 'Responder',
      icone: <Icon name="reply" size={15} />,
      onClick: () => onResponder(message),
    });
  }

  if (onEncaminhar) {
    itens.push({
      label: 'Encaminhar',
      icone: <Icon name="arrow-right" size={15} />,
      onClick: () => onEncaminhar(message),
    });
  }

  if (onEditar) {
    itens.push({ label: 'Editar', icone: <Icon name="pencil" size={15} />, onClick: onEditar });
  }

  if (onFixarMensagem && podeModerar) {
    itens.push({
      label: message.pinnedAt ? 'Desafixar' : 'Fixar mensagem',
      icone: <Icon name="pin" size={15} />,
      onClick: () => onFixarMensagem(message.id, !message.pinnedAt),
    });
  }

  itens.push({ tipo: 'sep' });

  if (message.content) {
    itens.push({
      label: 'Copiar texto',
      icone: <Icon name="copy" size={15} />,
      onClick: () => copiar(message.content),
    });
    itens.push({
      label: 'Falar mensagem',
      icone: <Icon name="volume" size={15} />,
      onClick: () => falar(message.content),
    });
  }

  if (message.attachment) {
    itens.push({
      label: 'Copiar link do anexo',
      icone: <Icon name="link" size={15} />,
      onClick: () => copiar(new URL(message.attachment.url, window.location.origin).href),
    });
  }

  if (canalId) {
    itens.push({
      label: 'Copiar link da mensagem',
      icone: <Icon name="link" size={15} />,
      // Link que abre o app já pulando pra essa mensagem (ver App.jsx, que lê
      // o #hash na abertura).
      onClick: () => copiar(`${window.location.origin}/#msg-${canalId}-${message.id}`),
    });
  }

  if (onMarcarNaoLido && !minha) {
    itens.push({
      label: 'Marcar como não lido',
      icone: <Icon name="bell" size={15} />,
      onClick: () => onMarcarNaoLido(message),
    });
  }

  itens.push({
    label: 'Copiar ID',
    icone: <Icon name="hash" size={15} />,
    onClick: () => copiar(message.id),
  });

  if (onDenunciar && !minha) {
    itens.push({ tipo: 'sep' });
    itens.push({
      label: 'Denunciar mensagem',
      icone: <Icon name="alert-triangle" size={15} />,
      perigo: true,
      onClick: () => onDenunciar(message),
    });
  }

  if ((minha || podeModerar) && onApagar) {
    itens.push({ tipo: 'sep' });
    itens.push({
      label: 'Excluir mensagem',
      icone: <Icon name="trash" size={15} />,
      perigo: true,
      onClick: () => onApagar(message.id),
    });
  }

  return itens;
}

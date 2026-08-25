import Icon from '../components/Icon.jsx';
import { baixarImagem, copiarImagem, urlAbsoluta } from './imagem.js';

/**
 * Menu de botão direito de uma imagem.
 *
 * Um construtor só pra imagem no meio do chat e pra imagem aberta em tela
 * cheia: são as mesmas ações, e duas listas separadas sairiam de sincronia
 * no primeiro item novo.
 *
 * `onVer` só é passado pela imagem do chat - dentro do visualizador ela já
 * está aberta, e um "Ver imagem" que não faz nada seria só ruído.
 */
export function itensDeImagem({ src, nome, onVer }) {
  const itens = [{ tipo: 'titulo', label: nome ?? 'imagem' }];

  if (onVer) {
    itens.push({ label: 'Ver imagem', icone: <Icon name="expand" size={15} />, onClick: onVer });
    itens.push({ tipo: 'sep' });
  }

  itens.push({
    label: 'Copiar imagem',
    icone: <Icon name="copy" size={15} />,
    onClick: () => copiarImagem(src),
  });
  itens.push({
    label: 'Copiar link da imagem',
    icone: <Icon name="link" size={15} />,
    onClick: () => navigator.clipboard?.writeText(urlAbsoluta(src)).catch(() => {}),
  });
  itens.push({
    label: 'Salvar imagem',
    icone: <Icon name="file" size={15} />,
    onClick: () => baixarImagem(src, nome),
  });
  itens.push({ tipo: 'sep' });
  itens.push({
    label: 'Abrir em outra aba',
    icone: <Icon name="arrow-right" size={15} />,
    onClick: () => window.open(src, '_blank', 'noopener'),
  });

  return itens;
}

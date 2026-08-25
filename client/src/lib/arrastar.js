import { useCallback, useState } from 'react';

/**
 * Arrastar e soltar na barra lateral.
 *
 * Usa a API de drag nativa do navegador em vez de calcular posição do mouse
 * na mão: ela já dá o cancelamento com Esc, o comportamento certo ao soltar
 * fora da janela, e não trava se o mouse for solto num lugar que a página
 * nem estava escutando.
 *
 * O que está sendo arrastado fica guardado aqui em estado, e não só no
 * `dataTransfer`, porque durante o `dragover` o navegador PROÍBE ler os
 * dados (proteção contra páginas bisbilhotarem arquivo arrastado de fora).
 * Sem essa cópia não daria pra saber se o que vem chegando pode ser solto
 * ali, e portanto nem pra mostrar o destino.
 */

/**
 * A plaquinha que segue o cursor.
 *
 * O navegador só aceita como imagem de arrasto um elemento que esteja DE
 * FATO na página e visível - por isso ela é criada no body, fora da tela, e
 * removida no quadro seguinte (o navegador já tirou a foto a essa altura;
 * remover na hora deixaria o cursor sem imagem nenhuma).
 */
function plaquinha(rotulo, icone) {
  const el = document.createElement('div');
  el.className = 'arrasto-fantasma';
  el.textContent = icone ? `${icone} ${rotulo}` : rotulo;
  // -1000px em vez de display:none: escondido de verdade o navegador
  // ignora o elemento e não usa como imagem.
  el.style.cssText = 'position:fixed;top:-1000px;left:-1000px';
  document.body.appendChild(el);
  requestAnimationFrame(() => el.remove());
  return el;
}

export function useArrastar() {
  const [arrastando, setArrastando] = useState(null); // { tipo, ...dados }
  const [alvo, setAlvo] = useState(null);             // { chave, metade } | null

  const comecar = useCallback((carga) => (evento) => {
    evento.stopPropagation();
    setArrastando(carga);
    evento.dataTransfer.effectAllowed = 'move';
    // Firefox só inicia o arrasto se algum dado for setado.
    evento.dataTransfer.setData('text/plain', carga.id ?? '');
    if (carga.rotulo) {
      const el = plaquinha(carga.rotulo, carga.icone);
      // O deslocamento põe a plaquinha um pouco pra baixo e pra direita do
      // cursor, senão ela fica bem embaixo da seta e esconde o destino.
      evento.dataTransfer.setDragImage(el, 12, 12);
    }
  }, []);

  const terminar = useCallback(() => {
    setArrastando(null);
    setAlvo(null);
  }, []);

  /**
   * `aceita` diz se aquele ponto recebe o que está vindo. Devolve null
   * quando não aceita, e aí o ponto nem instala os handlers - soltar ali
   * simplesmente não faz nada, sem indicador nenhum piscando.
   *
   * `comMetade: true` liga o rastreio de qual METADE da linha o mouse está
   * sobrevoando (de cima ou de baixo) - é o que decide se o item cai antes
   * ou depois do alvo, igual ao Discord: uma barrinha em cima da linha
   * significa "vai ficar acima dela", embaixo significa "vai ficar abaixo".
   * Sem isso (zona do fim da lista, puxar pessoa pra call) não existe essa
   * ambiguidade, e o valor fica sempre 'depois'.
   */
  const soltarEm = useCallback((chave, aceita, aoSoltar, opts = {}) => {
    if (!arrastando || !aceita(arrastando)) return null;
    const comMetade = opts.comMetade ?? false;

    return {
      onDragOver: (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';

        let metade = 'depois';
        if (comMetade) {
          const caixa = e.currentTarget.getBoundingClientRect();
          metade = (e.clientY - caixa.top) < caixa.height / 2 ? 'antes' : 'depois';
        }
        setAlvo((atual) => (
          atual?.chave === chave && atual?.metade === metade ? atual : { chave, metade }
        ));
      },
      onDragLeave: () => setAlvo((atual) => (atual?.chave === chave ? null : atual)),
      onDrop: (e) => {
        e.preventDefault();
        e.stopPropagation();
        aoSoltar(arrastando, alvo?.chave === chave ? alvo.metade : 'depois');
        terminar();
      },
    };
  }, [arrastando, alvo, terminar]);

  /** Está pairando exatamente sobre este ponto? */
  const pairandoEm = useCallback((chave) => alvo?.chave === chave, [alvo]);

  /** Em qual metade daquele ponto o mouse está agora ('antes' | 'depois' | null). */
  const metadeEm = useCallback((chave) => (alvo?.chave === chave ? alvo.metade : null), [alvo]);

  return { arrastando, alvo, comecar, terminar, soltarEm, pairandoEm, metadeEm };
}

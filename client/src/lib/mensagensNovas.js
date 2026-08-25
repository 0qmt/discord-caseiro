import { useMemo, useRef } from 'react';

/**
 * Quais mensagens da lista acabaram de chegar - as únicas que devem animar.
 *
 * O histórico que já estava na tela não pode animar: se animasse, abrir um
 * canal faria as 50 mensagens antigas entrarem todas de uma vez, que é o
 * efeito "tudo entrando junto" - o jeito mais rápido de fazer uma interface
 * parecer barulhenta. Então a primeira leva de cada canal entra sem marca
 * nenhuma; dali pra frente, todo id inédito é uma chegada de verdade.
 *
 * `chave` é o que define "trocou de conversa" (id do canal ou da DM). Quando
 * ela muda, o registro zera e a leva seguinte volta a ser tratada como
 * histórico.
 *
 * Mora num ref, e não num state, porque isso é memória entre renders e não
 * dado de tela: virar state renderizaria tudo de novo a cada mensagem.
 *
 * As duas peles (clássica e Orbit) chamam esta mesma função pra não
 * divergirem no que conta como "nova".
 */
export function useMensagensNovas(mensagens, chave) {
  const registro = useRef({ chave: undefined, ids: new Set() });

  return useMemo(() => {
    if (registro.current.chave !== chave) {
      registro.current = { chave, ids: new Set(mensagens.map((m) => m.id)) };
      return new Set();
    }

    const recentes = new Set();
    for (const m of mensagens) {
      if (m.id && !registro.current.ids.has(m.id)) {
        registro.current.ids.add(m.id);
        recentes.add(m.id);
      }
    }
    return recentes;
  }, [mensagens, chave]);
}

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Classe "punch" transitória pra dar feedback visual imediato num clique -
 * ver a animação em styles.css (.punch). `disparar()` liga a classe por
 * `duracaoMs` e desliga sozinha; chamar de novo antes de acabar reinicia o
 * timer, então cliques rápidos em sequência não deixam a classe grudada.
 */
export function usePunch(duracaoMs = 260, classe = 'punch') {
  const [ativo, setAtivo] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const disparar = useCallback(() => {
    setAtivo(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAtivo(false), duracaoMs);
  }, [duracaoMs]);

  return [ativo ? classe : '', disparar];
}

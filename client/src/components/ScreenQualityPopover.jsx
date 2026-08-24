import { FPS_TELA, RESOLUCOES_TELA } from '../lib/voice.js';

/**
 * Ajuste de qualidade da tela já em transmissão: duas caixas independentes
 * (resolução e velocidade), cada uma aplica na hora. Um popover pequeno
 * ancorado perto da engrenagem — não é um modal de tela cheia, então nunca
 * cobre o vídeo que está sendo compartilhado.
 */
export default function ScreenQualityPopover({ resolucaoAtual, fpsAtual, onEscolher, onFechar }) {
  return (
    <>
      {/* Camada invisível só pra fechar ao clicar fora - sem escurecer nada. */}
      <div className="click-fora" onClick={onFechar} />

      <div className="qualidade-popover" role="dialog" aria-label="Qualidade da tela">
        <div className="qualidade-secao">
          <span className="qualidade-titulo">Qualidade</span>
          <div className="qualidade-opcoes">
            {RESOLUCOES_TELA.map((r) => (
              <button
                key={r.id}
                className={`qualidade-chip ${r.id === resolucaoAtual ? 'selecionada' : ''}`}
                onClick={() => onEscolher(r.id, null)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="qualidade-secao">
          <span className="qualidade-titulo">Velocidade</span>
          <div className="qualidade-opcoes">
            {FPS_TELA.map((f) => (
              <button
                key={f.id}
                className={`qualidade-chip ${f.id === fpsAtual ? 'selecionada' : ''}`}
                onClick={() => onEscolher(null, f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <p className="hint small">
          Qualidades maiores pesam mais na sua internet — principalmente se alguém
          precisar de relay (veja LIMITES-E-RISCOS.md quando a Etapa 6 chegar).
        </p>
      </div>
    </>
  );
}

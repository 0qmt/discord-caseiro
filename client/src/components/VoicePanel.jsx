import { useEffect, useState } from 'react';
import ScreenQualityPopover from './ScreenQualityPopover.jsx';
import Icon from './Icon.jsx';

export default function VoicePanel({ voice, channelName, actions }) {
  // Hooks não podem vir depois de um return condicional, então os guards de
  // "call inexistente" ficam depois deles.
  const [ajusteAberto, setAjusteAberto] = useState(false);

  // A tela pode parar de ser compartilhada por fora (barra do navegador,
  // "parar compartilhamento"), sem passar pelo nosso botão - fecha o
  // popover nesse caso também, senão ele reaparece sozinho na próxima vez.
  useEffect(() => {
    if (!voice.self.screen) setAjusteAberto(false);
  }, [voice.self.screen]);

  if (!voice.channelId && !voice.connecting && !voice.error) return null;

  const sozinho = voice.peers.length === 0;
  const conectado = voice.peers.some((p) => p.connectionState === 'connected');

  const falhou = Boolean(voice.error) && !voice.channelId;

  const situacao = falhou ? 'não deu pra entrar'
    : voice.connecting ? 'entrando...'
      : sozinho ? 'esperando alguém'
        : conectado ? 'conectado' : 'negociando...';

  const {
    muted, hasMic, camera, screen, deafened, telaResolucaoId, telaFpsId,
  } = voice.self;

  return (
    <div className="voice-panel">
      <div className="voice-info">
        <span className={`voice-situacao ${!falhou && (conectado || sozinho) ? 'on' : ''}`}>
          {situacao}
        </span>
        {voice.channelId && <span className="voice-canal">{channelName}</span>}
      </div>

      {voice.error && (
        <div className="voice-erro">
          <span>{voice.error}</span>
          <button className="icon-btn" title="Fechar" onClick={actions.clearError}><Icon name="x" size={14} /></button>
        </div>
      )}

      {voice.channelId && (
        <div className="voice-botoes">
          <button
            className={`voice-btn ${!hasMic ? 'sem-mic' : muted ? 'perigo' : 'ativo'}`}
            title={!hasMic ? 'Você entrou sem microfone — clique pra ativar' : muted ? 'Desmutar' : 'Mutar'}
            onClick={actions.toggleMute}
          >
            <Icon name={!hasMic ? 'mic-off' : muted ? 'mic-off' : 'mic'} />
          </button>

          <button
            className={`voice-btn ${deafened ? 'perigo' : 'ativo'}`}
            title={deafened ? 'Voltar a ouvir' : 'Ensurdecer (para de ouvir e muta você junto)'}
            onClick={actions.toggleDeafen}
          >
            <Icon name={deafened ? 'headphones-off' : 'headphones'} />
          </button>

          <button
            className={`voice-btn ${camera ? 'ativo' : ''}`}
            title={camera ? 'Desligar câmera' : 'Ligar câmera'}
            onClick={actions.toggleCamera}
          >
            <Icon name={camera ? 'camera' : 'camera-off'} />
          </button>

          <button
            className={`voice-btn ${screen ? 'ativo' : ''}`}
            title={screen ? 'Parar de compartilhar' : 'Compartilhar tela'}
            onClick={() => { setAjusteAberto(false); actions.toggleScreen(); }}
          >
            <Icon name="monitor" />
          </button>

          {screen && (
            <button
              className={`voice-btn ${ajusteAberto ? 'ativo' : ''}`}
              title="Ajustar qualidade da transmissão"
              onClick={() => setAjusteAberto((v) => !v)}
            >
              <Icon name="settings" />
            </button>
          )}

          <button className="voice-btn perigo" title="Sair da chamada" onClick={actions.leave}>
            <Icon name="power" />
          </button>
        </div>
      )}

      {screen && ajusteAberto && (
        <ScreenQualityPopover
          resolucaoAtual={telaResolucaoId}
          fpsAtual={telaFpsId}
          onEscolher={(resolucaoId, fpsId) => actions.mudarQualidadeTela(resolucaoId, fpsId)}
          onFechar={() => setAjusteAberto(false)}
        />
      )}
    </div>
  );
}

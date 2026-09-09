import { useState } from 'react';
import Avatar from './Avatar.jsx';
import UserPanel from './UserPanel.jsx';
import VoicePanel from './VoicePanel.jsx';
import Icon from './Icon.jsx';

/**
 * Agrupa canais por categoria, mantendo a ordem: primeiro os soltos (sem
 * categoria), depois cada categoria na sua posição.
 */
function agrupar(canais, categorias) {
  const soltos = canais.filter((c) => !c.categoryId);
  const grupos = (categorias ?? [])
    .map((cat) => ({ cat, canais: canais.filter((c) => c.categoryId === cat.id) }))
    // Categoria vazia continua aparecendo: é onde a pessoa arrasta canal pra
    // dentro, e some-la deixaria a tela "quebrada" logo depois de criar uma.
    .sort((a, b) => a.cat.position - b.cat.position);
  return { soltos, grupos };
}

/**
 * Barrinha fina mostrando onde o item vai cair - em cima ou embaixo da
 * linha que o mouse está sobrevoando, dependendo de que metade dela o
 * cursor está (ver `metadeEm` em lib/arrastar.js). É o mesmo indicador do
 * Discord: uma linha só, não um cartão fantasma cobrindo a linha real por
 * baixo - o cartão anterior nascia bem em cima do alvo e os dois liam como
 * uma coisa só, bagunçada.
 */
export function IndicadorDeSolte({ posicao = 'depois' }) {
  return <div className={`indicador-de-solte ${posicao === 'antes' ? 'em-cima' : 'em-baixo'}`} />;
}

export function LinhaDeVoz({
  participantes, falando, meId, onMenuDoParticipante,
  // Quem pode ser arrastado. Recebe o participante e decide - a própria
  // pessoa pode sempre; os outros exigem PERM.MOVER_MEMBROS.
  podeArrastar, aoArrastar, aoSoltarArrasto, previa,
}) {
  if (participantes.length === 0 && !previa) return null;
  return (
    <ul className="voice-members">
      {participantes.map((p) => {
        const arrastavel = podeArrastar?.(p) ?? false;
        return (
        <li
          key={p.socketId}
          className={`${falando.get(p.socketId) ? 'falando' : ''} ${p.state.screen ? 'compartilhando' : ''} ${arrastavel ? 'arrastavel' : ''}`}
          onContextMenu={onMenuDoParticipante?.(p)}
          draggable={arrastavel || undefined}
          onDragStart={arrastavel ? aoArrastar?.(p) : undefined}
          onDragEnd={arrastavel ? aoSoltarArrasto : undefined}
          title={arrastavel ? (p.user.id === meId ? 'Arraste pra trocar de canal' : 'Arraste pra mover de canal') : undefined}
        >
          <Avatar user={p.user} size={22} className="small" />
          <span className="voice-nome">{p.user.username}{p.user.id === meId && ' (voce)'}</span>
          {p.state.screen && (
            <span className="compartilhando-badge" title="compartilhando a tela">
              <Icon name="monitor" size={11} /> ao vivo
            </span>
          )}
          {p.state.camera && <Icon name="camera" size={13} title="câmera ligada" />}
          {p.state.deafened && <Icon name="headphones-off" size={13} title="não está ouvindo ninguém" />}
          {!p.state.hasMic && <Icon name="headphones" size={13} title="entrou só pra ouvir, sem microfone" />}
          {p.state.hasMic && p.state.muted && <Icon name="mic-off" size={13} title="mutado" />}
        </li>
        );
      })}
      {/* A pessoa que está sendo arrastada pra cá, no fim da lista - que é
          onde ela vai entrar se soltar agora. */}
      {previa && (
        <li className="voz-previa">
          <span className="voz-previa-bolinha" />
          <span className="voice-nome">{previa.rotulo}</span>
        </li>
      )}
    </ul>
  );
}

export default function ChannelSidebar({
  guild,
  activeChannelId,
  unreadByChannel,
  mentionByChannel = {},
  onSelectChannel,
  onCreateChannel,
  onOpenInvite,
  me,
  connected,
  onOpenSettings,
  onOpenProfile,
  voice,
  voiceRooms,
  voiceActions,
  voiceChannelName,
  callMaximizada,
  onToggleVoiceChannel,
  // menus de contexto e presença (montados pelo App)
  onMenuDoCanal,
  onMenuDaGuild,
  onMenuDaCategoria,
  onMenuDoParticipanteDeVoz,
  onAbrirMenuDeStatus,
  meuStatus,
  minhaAtividade,
  // arrastar: reordenar canal e puxar gente pra uma call
  podeOrdenarCanais = false,
  podeMoverNaCall = false,
  onReordenarCanais,
  onPuxarParaCall,
  onMoverParaFim,
  // O estado do arrasto vem de cima porque a lista de MEMBROS (outro
  // componente) também arrasta pra cá: se cada um tivesse o seu, a barra de
  // canais não enxergaria a pessoa vindo da lista e não aceitaria o solte.
  arrasto,
}) {
  const [colapsadas, setColapsadas] = useState(() => new Set());
  const canManage = guild?.role === 'owner' || guild?.role === 'admin';
  const textChannels = guild?.channels.filter((c) => c.type === 'text') ?? [];
  const voiceChannels = guild?.channels.filter((c) => c.type === 'voice') ?? [];

  /** Quem está falando, por socket, pra pintar a borda do avatar na lista. */
  const falando = new Map(voice.peers.map((p) => [p.socketId, p.speaking]));
  if (voice.socketId) falando.set(voice.socketId, voice.self.speaking);

  const alternarCategoria = (id) => setColapsadas((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /*
   * Soltar um canal em cima de outro troca os dois de lugar na lista e manda
   * a ordem inteira pro servidor. Só quem pode gerenciar canais arrasta - pra
   * quem não pode, o `draggable` nem é ligado, e a linha volta a se comportar
   * como texto normal em vez de fingir que dá pra mover.
   */
  const soltarCanal = (channel) => arrasto.soltarEm(
    `canal:${channel.id}`,
    (carga) => carga.tipo === 'canal' && carga.id !== channel.id && carga.channelType === channel.type,
    (carga, metade) => onReordenarCanais?.(carga.id, channel.id, metade),
    { comMetade: true },
  );

  /** Puxar alguém pra um canal de voz: participante de outra call ou membro da lista. */
  const soltarPessoa = (channel) => arrasto.soltarEm(
    `voz:${channel.id}`,
    (carga) => (carga.tipo === 'voz-participante' || carga.tipo === 'membro')
      && carga.channelId !== channel.id,
    (carga) => onPuxarParaCall?.(carga, channel),
  );

  /*
   * Zona depois do último canal de um tipo: solta ali (em qualquer ponto,
   * não só bem colado no último) e o canal vai pro fim daquele tipo. É o
   * "não precisa acertar a última vaga, qualquer área depois dela já serve".
   */
  const soltarNoFim = (tipo) => arrasto.soltarEm(
    `fim:${tipo}`,
    (carga) => carga.tipo === 'canal' && carga.channelType === tipo,
    (carga) => onMoverParaFim?.(carga.id, tipo),
  );

  // As zonas do fim só ganham altura ENQUANTO se arrasta um canal de
  // verdade - o resto do tempo ficam com altura zero (ver CSS), pra não
  // engordar o espaço entre as seções à toa.
  const arrastandoCanal = arrasto.arrastando?.tipo === 'canal';

  /*
   * O arrasto sai do BOTÃO, não da linha.
   *
   * `.channel-btn` tem flex:1 e cobre a linha inteira, então todo mousedown
   * cai nele - e o Chrome se recusa a iniciar o arrasto de um ancestral
   * quando o gesto começa dentro de um <button>. Com o draggable na linha, o
   * arrasto simplesmente nunca começava: era o "não consigo mudar a ordem
   * de nada".
   */
  const arrastavelDoCanal = (channel) => (podeOrdenarCanais ? {
    draggable: true,
    onDragStart: arrasto.comecar({
      tipo: 'canal',
      id: channel.id,
      channelType: channel.type,
      rotulo: channel.name,
      icone: channel.type === 'voice' ? '🔊' : '#',
    }),
    onDragEnd: arrasto.terminar,
  } : null);

  const renderCanalDeTexto = (channel) => (
    <div key={channel.id} className="linha-de-canal">
      {/* Barrinha mostrando em cima ou embaixo desta linha o item vai cair -
          fora do fluxo (ver CSS), não empurra a linha real pra baixo. */}
      {arrasto.pairandoEm(`canal:${channel.id}`) && (
        <IndicadorDeSolte posicao={arrasto.metadeEm(`canal:${channel.id}`)} />
      )}
      <div
        className={`channel-row ${channel.id === activeChannelId ? 'active' : ''} ${arrasto.arrastando?.id === channel.id ? 'sendo-arrastado' : ''}`}
        onContextMenu={onMenuDoCanal?.(channel)}
        {...soltarCanal(channel)}
      >
        <button
          className="channel-btn"
          onClick={() => onSelectChannel(channel.id)}
          {...arrastavelDoCanal(channel)}
        >
          <span className="hash">#</span>
          <span className="channel-label">{channel.name}</span>
          {mentionByChannel[channel.id] > 0 ? (
            <span className="badge small mention-badge" aria-label={`${mentionByChannel[channel.id]} menções`}>
              {mentionByChannel[channel.id]}
            </span>
          ) : unreadByChannel[channel.id] > 0 && channel.id !== activeChannelId && (
            <span className="badge small">{unreadByChannel[channel.id]}</span>
          )}
        </button>
      </div>
    </div>
  );

  const renderCanalDeVoz = (channel) => {
    const participantes = voiceRooms[channel.id] ?? [];
    const estouAqui = voice.channelId === channel.id;

    // Um canal de voz recebe duas coisas diferentes: outro canal de voz (pra
    // trocar de ordem) e uma pessoa (pra ser puxada pra cá). Qual dos dois
    // vale depende do que está sendo arrastado - por isso o `??`.
    const receber = soltarPessoa(channel) ?? soltarCanal(channel);

    const recebendoPessoa = arrasto.pairandoEm(`voz:${channel.id}`);

    return (
      <div key={channel.id} className="voice-channel linha-de-canal">
        {arrasto.pairandoEm(`canal:${channel.id}`) && (
          <IndicadorDeSolte posicao={arrasto.metadeEm(`canal:${channel.id}`)} />
        )}
        <div
          className={[
            'channel-row',
            estouAqui ? 'active' : '',
            estouAqui && callMaximizada ? 'em-foco' : '',
            recebendoPessoa ? 'recebendo-pessoa' : '',
            arrasto.arrastando?.id === channel.id ? 'sendo-arrastado' : '',
          ].filter(Boolean).join(' ')}
          onContextMenu={onMenuDoCanal?.(channel)}
          {...receber}
        >
          <button
            className="channel-btn"
            onClick={() => onToggleVoiceChannel(channel.id)}
            title={!estouAqui ? 'Entrar na chamada'
              : callMaximizada ? 'Minimizar a chamada' : 'Ver a chamada'}
            {...arrastavelDoCanal(channel)}
          >
            <span className="hash"><Icon name="volume" size={16} /></span>
            <span className="channel-label">{channel.name}</span>
            {participantes.length > 0 && (
              <span className="badge small">{participantes.length}</span>
            )}
          </button>
        </div>

        <LinhaDeVoz
          participantes={participantes}
          falando={falando}
          meId={me.id}
          onMenuDoParticipante={onMenuDoParticipanteDeVoz}
          // Mover a si mesmo vale sempre (é o mesmo que clicar no outro
          // canal); mover os outros exige a permissão.
          podeArrastar={(p) => p.user.id === me.id || podeMoverNaCall}
          aoArrastar={(p) => arrasto.comecar({
            tipo: 'voz-participante',
            id: p.socketId,
            userId: p.user.id,
            channelId: channel.id,
            rotulo: p.user.username,
            icone: '🔊',
          })}
          aoSoltarArrasto={arrasto.terminar}
          // Prévia: a pessoa aparece no fim da lista do canal de destino,
          // que é exatamente onde ela vai cair.
          previa={recebendoPessoa ? arrasto.arrastando : null}
        />
      </div>
    );
  };

  const { soltos: textoSoltos, grupos } = agrupar(textChannels, guild?.categories);

  return (
    <aside className="channel-sidebar">
      <header className="sidebar-head" onContextMenu={onMenuDaGuild}>
        <button className="guild-name-botao" title="Opções do servidor" onClick={onMenuDaGuild}>
          <span className="guild-name">{guild?.name ?? 'Nenhum servidor'}</span>
          <Icon name="chevron-down" size={15} />
        </button>
        {canManage && (
          <button className="icon-btn" title="Gerar convite" onClick={onOpenInvite}><Icon name="plus" /></button>
        )}
      </header>

      <div className="channel-scroll">
        <div className="channel-group">
          <div className="group-head">
            <span>Canais de texto</span>
            {canManage && (
              <button className="icon-btn" title="Novo canal de texto" onClick={() => onCreateChannel('text')}><Icon name="plus" /></button>
            )}
          </div>
          {textoSoltos.map(renderCanalDeTexto)}
        </div>

        {grupos.map(({ cat, canais }) => (
          <div className="channel-group" key={cat.id}>
            <div className="group-head" onContextMenu={onMenuDaCategoria?.(cat)}>
              <button className="group-toggle" onClick={() => alternarCategoria(cat.id)}>
                <span className={`group-seta ${colapsadas.has(cat.id) ? 'fechada' : ''}`}><Icon name="arrow-right" size={11} className="seta-baixo" /></span>
                {cat.name}
              </button>
              {canManage && (
                <button
                  className="icon-btn faint"
                  title="Novo canal aqui"
                  onClick={() => onCreateChannel('text', cat.id)}
                >
                  <Icon name="plus" />
                </button>
              )}
            </div>
            {!colapsadas.has(cat.id) && canais.map(renderCanalDeTexto)}
          </div>
        ))}

        {/*
          * Zona de soltar depois do último canal de texto: joga o canal aqui
          * pra ele virar o último, sem precisar acertar o pixel da última
          * vaga.
          *
          * Só existe no DOM enquanto se arrasta um canal (`arrastandoCanal`)
          * - não é só CSS escondendo com altura zero, porque o `gap` do
          * flex-column conta os DOIS lados de qualquer item, mesmo vazio:
          * um item de altura zero espremido entre "geral" e "CANAIS DE VOZ"
          * ainda somava 18px+18px de gap ao redor dele, dobrando o respiro
          * ali sempre, mesmo fora de qualquer arrasto - era o "espaço
          * desproporcional". Tirando o elemento do DOM por completo quando
          * ocioso, o gap volta a ser só o normal entre os dois vizinhos.
          */}
        {arrastandoCanal && (
          <div className="linha-de-canal">
            {arrasto.pairandoEm('fim:text') && <IndicadorDeSolte posicao="antes" />}
            <div className="zona-fim-canais" {...soltarNoFim('text')} />
          </div>
        )}

        <div className="channel-group">
          <div className="group-head">
            <span>Canais de voz</span>
            {canManage && (
              <button className="icon-btn" title="Novo canal de voz" onClick={() => onCreateChannel('voice')}><Icon name="plus" /></button>
            )}
          </div>
          {voiceChannels.map(renderCanalDeVoz)}
        </div>

        {/* Essa aqui pode crescer à vontade (`preenche`): é a última coisa da
            barra, então qualquer espaço vazio sobrando até o fim dela vira
            zona de soltar - exatamente o "não precisa chegar perto". Mesmo
            tratamento do de cima: só existe enquanto se arrasta um canal. */}
        {arrastandoCanal && (
          <div className="linha-de-canal preenche">
            {arrasto.pairandoEm('fim:voice') && <IndicadorDeSolte posicao="antes" />}
            <div className="zona-fim-canais" {...soltarNoFim('voice')} />
          </div>
        )}
      </div>

      <VoicePanel voice={voice} channelName={voiceChannelName} actions={voiceActions} />

      <UserPanel
        me={me}
        conectado={connected}
        status={meuStatus}
        atividade={minhaAtividade}
        onAbrirMenu={onAbrirMenuDeStatus}
        onAbrirPerfil={onOpenProfile}
        onAbrirConfiguracoes={onOpenSettings}
      />
    </aside>
  );
}

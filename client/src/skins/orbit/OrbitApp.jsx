import { useState } from 'react';
import Avatar from '../../components/Avatar.jsx';
import ChannelSidebar from '../../components/ChannelSidebar.jsx';
import ChatView from '../../components/ChatView.jsx';
import CinemaHome from '../../components/CinemaHome.jsx';
import DMSidebar from '../../components/DMSidebar.jsx';
import GuildBar from '../../components/GuildBar.jsx';
import MemberList from '../../components/MemberList.jsx';
import VoiceStage, { VoiceAudioSink } from '../../components/VoiceStage.jsx';

/**
 * Orbit é somente a composição visual oficial. Chat, barras laterais e
 * ações vêm dos componentes canônicos para não existir uma segunda versão
 * simplificada dos mesmos recursos.
 */
export default function OrbitApp({
  me,
  guilds,
  guild,
  activeGuildId,
  dmMode,
  dms,
  activeDm,
  activeDmId,
  onlineIds,
  activeChannel,
  messages,
  dmMessages,
  typingUsers,
  sendError,
  connected,
  voice,
  voiceActions,
  callMaximizada,
  voiceVotacoes,
  voiceWatch,
  voiceRooms,
  voiceChannelName,
  channelLoading,
  channelHasMore,
  onLoadMore,
  dmLoading,
  dmHasMore,
  onLoadMoreDm,
  unreadDmTotal,
  unreadByGuild,
  unreadByChannel,
  unreadByDm,
  mentionByGuild,
  mentionByChannel,
  onSelectGuild,
  onOpenDms,
  onSelectChannel,
  onSelectDm,
  onToggleVoiceChannel,
  onSend,
  onSendDm,
  onTyping,
  onNovaConversa,
  onCreateGuild,
  onJoinGuild,
  onCreateChannel,
  onOpenInvite,
  onOpenSettings,
  onOpenProfile,
  onMinimizarCall,
  onExpulsarDaCall,
  onVotarExpulsaoDaCall,
  telaAssistida,
  onAssistir,
  onPararDeAssistir,
  onOpenApps,
  onOpenCinema,
  cinemaAberto,
  onCloseCinema,
  onErroCinema,
  presencas,
  minhaAtividade,
  meuStatus,
  membrosVisiveis,
  onAlternarMembros,
  onPromote,
  onKick,
  podeChamarParaCall,
  podeModerarVoz,
  onChamarParaCall,
  onMenuDoMembro,
  onReportarBug,
  onMenuDoParticipanteDeVoz,
  naoLidasAoAbrir,
  onMenuDaGuild,
  onMenuDoCanal,
  onMenuDaCategoria,
  onAbrirMenuDeStatus,
  onReagir,
  onEditarMensagem,
  onApagarMensagem,
  onFixarMensagem,
  onEncaminhar,
  onMarcarNaoLido,
  onDenunciar,
  podeModerar,
  onRodarComando,
  inserirNoCampo,
  podeOrdenarCanais,
  podeMoverNaCall,
  onReordenarCanais,
  onPuxarParaCall,
  onMoverParaFim,
  arrasto,
  aoArrastarMembro,
}) {
  const [painelCanaisAberto, setPainelCanaisAberto] = useState(false);
  const semServidor = !dmMode && guilds.length === 0;
  const chamadaAberta = callMaximizada && Boolean(voice.channelId);

  return (
    <div
      className={[
        'orbit-shell',
        'app',
        membrosVisiveis && !dmMode && !chamadaAberta && !cinemaAberto ? '' : 'sem-membros',
        dmMode ? 'modo-dm' : '',
        chamadaAberta ? 'modo-chamada' : '',
        cinemaAberto ? 'modo-cinema' : '',
        painelCanaisAberto ? 'painel-canais-aberto' : '',
      ].filter(Boolean).join(' ')}
      data-theme="discord-dark"
    >
      <VoiceAudioSink voice={voice} />

      <GuildBar
        guilds={guilds}
        activeGuildId={activeGuildId}
        dmMode={dmMode}
        unreadDmTotal={unreadDmTotal}
        unreadByGuild={unreadByGuild}
        mentionByGuild={mentionByGuild}
        onSelect={(guildId) => { onSelectGuild(guildId); setPainelCanaisAberto(true); }}
        onOpenDms={() => { onOpenDms(); setPainelCanaisAberto(true); }}
        onCreate={onCreateGuild}
        onJoin={onJoinGuild}
        onOpenCinema={onOpenCinema}
        onReportarBug={onReportarBug}
      />

      {!cinemaAberto && (dmMode ? (
        <DMSidebar
          conversations={dms}
          activeDmId={activeDmId}
          unreadByDm={unreadByDm}
          onlineIds={onlineIds}
          onSelectDm={(dmId) => { onSelectDm(dmId); setPainelCanaisAberto(false); }}
          onNovaConversa={onNovaConversa}
          me={me}
          connected={connected}
          onOpenSettings={onOpenSettings}
          onOpenProfile={() => onOpenProfile(me.id)}
        />
      ) : (
        <ChannelSidebar
          guild={guild}
          activeChannelId={activeChannel?.id ?? null}
          unreadByChannel={unreadByChannel}
          mentionByChannel={mentionByChannel}
          onSelectChannel={(channelId) => { onSelectChannel(channelId); setPainelCanaisAberto(false); }}
          onCreateChannel={onCreateChannel}
          onOpenInvite={onOpenInvite}
          me={me}
          connected={connected}
          onOpenSettings={onOpenSettings}
          onOpenProfile={() => onOpenProfile(me.id)}
          voice={voice}
          voiceRooms={voiceRooms}
          voiceActions={voiceActions}
          voiceChannelName={voiceChannelName}
          callMaximizada={callMaximizada}
          onToggleVoiceChannel={onToggleVoiceChannel}
          onMenuDoCanal={onMenuDoCanal}
          onMenuDaGuild={onMenuDaGuild}
          onMenuDaCategoria={onMenuDaCategoria}
          onMenuDoParticipanteDeVoz={onMenuDoParticipanteDeVoz}
          onAbrirMenuDeStatus={onAbrirMenuDeStatus}
          meuStatus={meuStatus}
          minhaAtividade={minhaAtividade}
          podeOrdenarCanais={podeOrdenarCanais}
          podeMoverNaCall={podeMoverNaCall}
          onReordenarCanais={onReordenarCanais}
          onPuxarParaCall={onPuxarParaCall}
          onMoverParaFim={onMoverParaFim}
          arrasto={arrasto}
        />
      ))}

      {!cinemaAberto && (
        <button
          type="button"
          className="orbit-sidebar-scrim"
          aria-label="Fechar lista de canais"
          onClick={() => setPainelCanaisAberto(false)}
        />
      )}

      {membrosVisiveis && !dmMode && !cinemaAberto && !chamadaAberta && (
        <button
          type="button"
          className="orbit-members-scrim"
          aria-label="Fechar lista de membros"
          onClick={onAlternarMembros}
        />
      )}

      <div className="chat-column">
        {cinemaAberto ? (
          <CinemaHome onClose={onCloseCinema} onErro={onErroCinema} />
        ) : callMaximizada && voice.channelId ? (
          <VoiceStage
            voice={voice}
            me={me}
            channelName={voiceChannelName}
            onMinimizar={onMinimizarCall}
            podeExpulsar={podeMoverNaCall}
            votacoes={voiceVotacoes}
            onExpulsar={onExpulsarDaCall}
            onVotarExpulsao={onVotarExpulsaoDaCall}
            voiceActions={voiceActions}
            podeModerarVoz={podeModerarVoz}
            telaAssistida={telaAssistida}
            onAssistir={onAssistir}
            onPararDeAssistir={onPararDeAssistir}
            watchSession={voiceWatch}
            onOpenApps={onOpenApps}
            onStopWatch={async (sessionId) => {
              const resposta = await voiceActions.watchStop(voice.channelId, sessionId);
              if (resposta?.error) onErroCinema?.(resposta.error);
            }}
            onJoinWatch={(sessionId) => voiceActions.watchJoin(voice.channelId, sessionId)}
            onLeaveWatch={(sessionId) => voiceActions.watchLeave(voice.channelId, sessionId)}
            onProposeWatch={(sessionId, control) => voiceActions.watchProposeControl(voice.channelId, sessionId, control)}
            onVoteWatch={(proposalId, approve) => voiceActions.watchVoteControl(voice.channelId, proposalId, approve)}
          />
        ) : dmMode ? (
          activeDm ? (
            <ChatView
              channel={{ id: activeDm.id, name: activeDm.otherUser.username }}
              messages={dmMessages}
              loading={dmLoading}
              hasMore={dmHasMore}
              onLoadMore={onLoadMoreDm}
              onSend={onSendDm}
              onTyping={() => {}}
              typingUsers={[]}
              onOpenProfile={(author) => onOpenProfile(author.id)}
              error={sendError}
              meId={me.id}
              onReagir={onReagir}
              onEditarMensagem={onEditarMensagem}
              onApagarMensagem={onApagarMensagem}
              onEncaminhar={onEncaminhar}
              onDenunciar={onDenunciar}
              onRodarComando={onRodarComando}
              inserirNoCampo={inserirNoCampo}
              onAlternarCanais={() => setPainelCanaisAberto((aberto) => !aberto)}
              icon={<Avatar user={activeDm.otherUser} size={22} className="small" />}
              emptyMessage="Escolhe uma conversa na barra ao lado."
              placeholder={`Mensagem para ${activeDm.otherUser.username}`}
              beginningNote={<>Este é o começo da sua conversa com <strong>{activeDm.otherUser.username}</strong>.</>}
            />
          ) : (
            <main className="chat empty"><p>Escolhe uma conversa ou inicia uma nova.</p></main>
          )
        ) : semServidor ? (
          <main className="chat empty">
            <p>Você ainda não está em nenhum servidor.</p>
            <div className="empty-actions">
              <button className="primary" onClick={onCreateGuild}>Criar servidor</button>
              <button onClick={onJoinGuild}>Entrar com convite</button>
            </div>
          </main>
        ) : activeChannel ? (
          <ChatView
            channel={activeChannel}
            messages={messages}
            loading={channelLoading}
            hasMore={channelHasMore}
            onLoadMore={onLoadMore}
            onSend={onSend}
            onTyping={onTyping}
            typingUsers={typingUsers}
            onOpenProfile={(author) => onOpenProfile(author.id)}
            error={sendError}
            members={guild?.members}
            roles={guild?.roles}
            meId={me.id}
            onReagir={onReagir}
            onEditarMensagem={onEditarMensagem}
            onApagarMensagem={onApagarMensagem}
            onFixarMensagem={onFixarMensagem}
            onEncaminhar={onEncaminhar}
            onMarcarNaoLido={onMarcarNaoLido}
            onDenunciar={onDenunciar}
            podeModerar={podeModerar}
            onRodarComando={onRodarComando}
            onAlternarMembros={onAlternarMembros}
            membrosVisiveis={membrosVisiveis}
            inserirNoCampo={inserirNoCampo}
            onAlternarCanais={() => setPainelCanaisAberto((aberto) => !aberto)}
            naoLidasAoAbrir={naoLidasAoAbrir}
          />
        ) : (
          <main className="chat empty"><p>Escolhe um canal na barra ao lado.</p></main>
        )}
      </div>

      {!cinemaAberto && !dmMode && !(callMaximizada && voice.channelId) && (
        <MemberList
          guild={guild}
          presencas={presencas}
          meId={me.id}
          visivel={membrosVisiveis}
          onOpenProfile={(member) => onOpenProfile(member.id)}
          onPromote={onPromote}
          onKick={onKick}
          podeChamarParaCall={podeChamarParaCall}
          onChamarParaCall={onChamarParaCall}
          onMenuDoMembro={onMenuDoMembro}
          membroArrastavel={podeMoverNaCall || Boolean(voice.channelId)}
          aoArrastarMembro={aoArrastarMembro}
          aoSoltarMembro={arrasto?.terminar}
        />
      )}
    </div>
  );
}

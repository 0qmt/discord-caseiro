import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { corDoMembro, nomeExibido, PERM, temPermissao } from '../lib/cargos.js';
import { cropStyle } from '../lib/cropStyle.js';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import ImageCropModal from './ImageCropModal.jsx';
import SecaoCargos from './SecaoCargos.jsx';

const MAX_DESCRICAO = 300;

/* ============================== visão geral ============================== */

function SecaoPerfil({ guild, onSalvo, onErro }) {
  const [name, setName] = useState(guild.name);
  const [description, setDescription] = useState(guild.description ?? '');
  const [recortando, setRecortando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const mudou = name.trim() !== guild.name || description.trim() !== (guild.description ?? '');

  async function salvar(evento) {
    evento.preventDefault();
    setSalvando(true);
    try {
      const { guild: novo } = await api.updateGuild(guild.id, {
        name: name.trim(),
        description: description.trim(),
      });
      onSalvo(novo);
    } catch (err) {
      onErro(err.message);
    } finally {
      setSalvando(false);
    }
  }

  if (recortando) {
    return (
      <ImageCropModal
        title="Ícone do servidor"
        aspect={1}
        cropShape="round"
        output={{ width: 256, height: 256 }}
        hasCurrent={Boolean(guild.iconUrl)}
        currentPreview={(
          <div className="guild-icone-preview">
            {guild.iconUrl && <img src={guild.iconUrl} alt="" style={cropStyle(guild.iconCrop)} />}
          </div>
        )}
        onUpload={async (file, crop) => {
          const { guild: novo } = await api.uploadGuildIcon(guild.id, file, crop);
          onSalvo(novo);
          setRecortando(false);
        }}
        onRemove={async () => {
          const { guild: novo } = await api.deleteGuildIcon(guild.id);
          onSalvo(novo);
          setRecortando(false);
        }}
        onClose={() => setRecortando(false)}
      />
    );
  }

  return (
    <section className="settings-secao">
      <h2>Perfil do servidor</h2>
      <p className="settings-subtitulo">É assim que o servidor aparece pra quem entra pelo convite.</p>

      <form onSubmit={salvar}>
        <div className="guild-icone-campo">
          <button type="button" className="guild-icone-botao" onClick={() => setRecortando(true)} title="Trocar ícone">
            {guild.iconUrl
              ? <img key={guild.iconUrl} src={guild.iconUrl} alt="" style={cropStyle(guild.iconCrop)} />
              : <span>{name.trim()[0]?.toUpperCase() ?? '?'}</span>}
            <span className="trocar">Trocar</span>
          </button>
        </div>

        <label>
          Nome do servidor
          <input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={64} required />
        </label>

        <label>
          Descrição
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={MAX_DESCRICAO}
            rows={3}
            placeholder="Do que se trata esse servidor"
          />
        </label>
        <p className="hint small contador">{description.length}/{MAX_DESCRICAO}</p>

        <button className="primary" type="submit" disabled={salvando || !mudou}>
          {salvando ? 'Salvando...' : 'Salvar'}
        </button>
      </form>
    </section>
  );
}

/* ================================ membros ================================ */

const DURACOES = [
  { label: '60 segundos', minutos: 1 },
  { label: '5 minutos', minutos: 5 },
  { label: '1 hora', minutos: 60 },
  { label: '1 dia', minutos: 60 * 24 },
  { label: '1 semana', minutos: 60 * 24 * 7 },
];

function SecaoMembros({ guild, me, onErro, onConfirmar }) {
  const [busca, setBusca] = useState('');
  const euMembro = guild.members.find((m) => m.id === me.id);
  const souDono = guild.role === 'owner';
  const podeExpulsar = souDono || temPermissao(euMembro, guild, PERM.EXPULSAR);
  const podeBanir = souDono || temPermissao(euMembro, guild, PERM.BANIR);
  const podeCastigar = souDono || temPermissao(euMembro, guild, PERM.SILENCIAR_MEMBROS);

  const termo = busca.trim().toLowerCase();
  const lista = guild.members.filter((m) => !termo || nomeExibido(m).toLowerCase().includes(termo));

  const agir = (promessa) => promessa.catch((e) => onErro(e.message));

  return (
    <section className="settings-secao larga">
      <h2>Membros &mdash; {guild.members.length}</h2>
      <p className="settings-subtitulo">Cargo, castigo, expulsão e banimento, tudo num lugar só.</p>

      <input
        className="membros-busca"
        placeholder="Procurar alguém"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />

      <div className="membros-tabela">
        {lista.length === 0 && <p className="hint">Ninguém com esse nome.</p>}
        {lista.map((m) => {
          const souEu = m.id === me.id;
          const ehDono = m.role === 'owner';
          // O dono é intocável, e ninguém age sobre si mesmo por aqui.
          const mexivel = !ehDono && !souEu;
          const cor = corDoMembro(m, guild.roles);
          const castigado = m.timeoutUntil && m.timeoutUntil > Date.now();

          return (
            <div key={m.id} className="membro-linha">
              <Avatar user={m} size={32} className="small" />
              <div className="membro-linha-info">
                <strong style={cor ? { color: cor } : undefined}>
                  {nomeExibido(m)}{souEu && ' (você)'}
                </strong>
                <span className="hint small">
                  {ehDono ? 'dono' : m.role === 'admin' ? 'admin' : 'membro'}
                  {castigado && ' · de castigo'}
                </span>
              </div>

              <div className="membro-linha-acoes">
                {souDono && mexivel && (
                  <button
                    className="botao-fino"
                    onClick={() => agir(api.setMemberRole(guild.id, m.id, m.role === 'admin' ? 'member' : 'admin'))}
                  >
                    {m.role === 'admin' ? 'Rebaixar' : 'Promover'}
                  </button>
                )}

                {podeCastigar && mexivel && (
                  castigado ? (
                    <button className="botao-fino" onClick={() => agir(api.timeoutMember(guild.id, m.id, 0))}>
                      Tirar castigo
                    </button>
                  ) : (
                    <select
                      className="botao-fino"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) agir(api.timeoutMember(guild.id, m.id, Number(e.target.value)));
                        e.target.value = '';
                      }}
                    >
                      <option value="">Castigo...</option>
                      {DURACOES.map((d) => <option key={d.minutos} value={d.minutos}>{d.label}</option>)}
                    </select>
                  )
                )}

                {podeExpulsar && mexivel && (
                  <button
                    className="botao-fino perigo"
                    onClick={() => onConfirmar({
                      title: 'Expulsar do servidor',
                      message: `Expulsar ${nomeExibido(m)}? Dá pra voltar com um convite novo.`,
                      confirmLabel: 'Expulsar',
                      onConfirm: () => agir(api.removeMember(guild.id, m.id)),
                    })}
                  >
                    Expulsar
                  </button>
                )}

                {podeBanir && mexivel && (
                  <button
                    className="botao-fino perigo"
                    onClick={() => onConfirmar({
                      title: 'Banir do servidor',
                      message: `Banir ${nomeExibido(m)}? A pessoa sai e não consegue voltar nem com convite.`,
                      confirmLabel: 'Banir',
                      onConfirm: () => agir(api.banirMembro(guild.id, m.id, null)),
                    })}
                  >
                    Banir
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* =============================== convites ================================ */

const OPCOES_EXPIRACAO = [
  { label: '30 minutos', horas: 0.5 },
  { label: '1 hora', horas: 1 },
  { label: '6 horas', horas: 6 },
  { label: '12 horas', horas: 12 },
  { label: '1 dia', horas: 24 },
  { label: '7 dias', horas: 24 * 7 },
  { label: 'Nunca (fixo)', horas: null },
];

const OPCOES_USOS = [
  { label: 'Sem limite', usos: null },
  { label: '1 uso', usos: 1 },
  { label: '5 usos', usos: 5 },
  { label: '10 usos', usos: 10 },
  { label: '25 usos', usos: 25 },
  { label: '50 usos', usos: 50 },
];

function expiraEm(expiresAt) {
  if (!expiresAt) return 'nunca expira';
  const horas = (expiresAt - Date.now()) / 3600000;
  if (horas <= 0) return 'expirado';
  if (horas < 1) return `expira em ${Math.round(horas * 60)} min`;
  if (horas < 24) return `expira em ${Math.round(horas)}h`;
  return `expira em ${Math.round(horas / 24)}d`;
}

function SecaoConvites({ guild, onErro }) {
  const [invites, setInvites] = useState(null);
  const [gerando, setGerando] = useState(false);
  const [copiado, setCopiado] = useState(null);
  const [expiracao, setExpiracao] = useState(12);
  const [usos, setUsos] = useState(null);

  const carregar = () => api.listInvites(guild.id)
    .then(({ invites: l }) => setInvites(l))
    .catch((e) => onErro(e.message));

  useEffect(() => { carregar(); }, [guild.id]);

  async function gerar() {
    setGerando(true);
    try {
      await api.createInvite(guild.id, { maxUses: usos, expiresInHours: expiracao });
      await carregar();
    } catch (err) { onErro(err.message); } finally { setGerando(false); }
  }

  async function apagar(code) {
    try {
      await api.deleteInvite(guild.id, code);
      setInvites((prev) => prev.filter((i) => i.code !== code));
    } catch (err) { onErro(err.message); }
  }

  return (
    <section className="settings-secao larga">
      <h2>Convites</h2>
      <p className="settings-subtitulo">
        Cada código é uma porta de entrada. Um código fixo serve pro grupo de sempre;
        um que expira serve pra chamar alguém uma vez só.
      </p>

      <div className="convites-form">
        <label>
          Expira em
          <select
            value={expiracao ?? 'nunca'}
            onChange={(e) => setExpiracao(e.target.value === 'nunca' ? null : Number(e.target.value))}
          >
            {OPCOES_EXPIRACAO.map((o) => (
              <option key={o.label} value={o.horas ?? 'nunca'}>{o.label}</option>
            ))}
          </select>
        </label>
        <label>
          Usos máximos
          <select
            value={usos ?? 'sem-limite'}
            onChange={(e) => setUsos(e.target.value === 'sem-limite' ? null : Number(e.target.value))}
          >
            {OPCOES_USOS.map((o) => (
              <option key={o.label} value={o.usos ?? 'sem-limite'}>{o.label}</option>
            ))}
          </select>
        </label>
        <button className="primary" type="button" onClick={gerar} disabled={gerando}>
          {gerando ? 'Gerando...' : 'Gerar convite'}
        </button>
      </div>

      {invites === null && <p className="hint">Carregando...</p>}
      {invites?.length === 0 && <p className="hint">Nenhum convite ativo.</p>}

      <div className="convites-lista">
        {invites?.map((i) => (
          <div key={i.code} className="convite-item">
            <div className="convite-item-info">
              <span className="convite-item-code">{i.code}</span>
              <span className="hint small">
                {i.uses}{i.maxUses !== null ? `/${i.maxUses}` : ''} usos &middot; {expiraEm(i.expiresAt)}
              </span>
            </div>
            <div className="convite-item-acoes">
              <button
                className="icon-btn"
                title="Copiar código"
                onClick={() => {
                  navigator.clipboard?.writeText(i.code).catch(() => {});
                  setCopiado(i.code);
                  setTimeout(() => setCopiado(null), 1500);
                }}
              >
                <Icon name={copiado === i.code ? 'check' : 'copy'} size={15} />
              </button>
              <button className="icon-btn" title="Apagar convite" onClick={() => apagar(i.code)}>
                <Icon name="trash" size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ============================== banimentos =============================== */

function SecaoBanimentos({ guild, onErro }) {
  const [bans, setBans] = useState(null);

  const carregar = () => api.listBans(guild.id).then(({ bans: l }) => setBans(l)).catch((e) => onErro(e.message));
  useEffect(() => { carregar(); }, [guild.id]);

  async function desbanir(userId) {
    try {
      await api.desbanir(guild.id, userId);
      setBans((prev) => prev.filter((b) => b.userId !== userId));
    } catch (err) { onErro(err.message); }
  }

  return (
    <section className="settings-secao larga">
      <h2>Banimentos</h2>
      <p className="settings-subtitulo">
        Quem está aqui não entra nem com convite. Tirar o banimento libera a volta.
      </p>

      {bans === null && <p className="hint">Carregando...</p>}
      {bans?.length === 0 && <p className="hint">Ninguém banido.</p>}

      <div className="membros-tabela">
        {bans?.map((b) => (
          <div key={b.userId} className="membro-linha">
            <Avatar user={{ username: b.username }} size={32} className="small" />
            <div className="membro-linha-info">
              <strong>{b.username}</strong>
              <span className="hint small">
                {b.reason ? `"${b.reason}"` : 'sem motivo anotado'}
                {b.bannedBy && ` · por ${b.bannedBy}`}
              </span>
            </div>
            <div className="membro-linha-acoes">
              <button className="botao-fino" onClick={() => desbanir(b.userId)}>Tirar banimento</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ============================== auditoria ================================ */

/**
 * Texto de cada ação do histórico.
 *
 * O servidor manda um código (`membro.banido`), não uma frase pronta: assim a
 * escrita fica só aqui, e mudar o texto não exige mexer no banco nem migrar
 * linha nenhuma que já foi gravada.
 */
const FRASE = {
  'servidor.atualizado': (e) => `mudou ${e.detalhe ?? 'o servidor'}`,
  'servidor.icone': () => 'trocou o ícone do servidor',
  'canal.criado': (e) => `criou o canal ${e.alvo?.nome}`,
  'canal.atualizado': (e) => `mexeu no canal ${e.alvo?.nome}`,
  'canal.apagado': (e) => `apagou o canal ${e.alvo?.nome}`,
  'cargo.criado': (e) => `criou o cargo ${e.alvo?.nome}`,
  'cargo.atualizado': (e) => `mexeu no cargo ${e.alvo?.nome}`,
  'cargo.apagado': (e) => `apagou o cargo ${e.alvo?.nome}`,
  'membro.expulso': (e) => `expulsou ${e.alvo?.nome}`,
  'membro.banido': (e) => `baniu ${e.alvo?.nome}`,
  'membro.desbanido': (e) => `tirou o banimento de ${e.alvo?.nome}`,
  'membro.castigo': (e) => `deu castigo em ${e.alvo?.nome}`,
  'membro.cargo': (e) => `${e.detalhe} — ${e.alvo?.nome}`,
  'membro.apelido': (e) => `mudou o apelido de ${e.alvo?.nome}`,
  'convite.criado': () => 'criou um convite',
  'convite.apagado': (e) => `apagou o convite ${e.alvo?.nome}`,
};

const ICONE = {
  'membro.banido': 'ban', 'membro.desbanido': 'ban', 'membro.expulso': 'door-exit',
  'cargo.criado': 'tag', 'cargo.atualizado': 'tag', 'cargo.apagado': 'tag',
  'canal.criado': 'hash', 'canal.atualizado': 'hash', 'canal.apagado': 'hash',
  'convite.criado': 'link', 'convite.apagado': 'link',
};

const quando = (ts) => new Date(ts).toLocaleString('pt-BR', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
});

function SecaoAuditoria({ guild, onErro }) {
  const [entradas, setEntradas] = useState(null);

  useEffect(() => {
    api.auditoria(guild.id).then(({ entradas: l }) => setEntradas(l)).catch((e) => onErro(e.message));
  }, [guild.id]);

  return (
    <section className="settings-secao larga">
      <h2>Registro de auditoria</h2>
      <p className="settings-subtitulo">
        O que foi feito no servidor, do mais recente pro mais antigo. Fica guardado com o
        nome de quem agiu na hora, então continua legível mesmo depois que a pessoa sai.
      </p>

      {entradas === null && <p className="hint">Carregando...</p>}
      {entradas?.length === 0 && <p className="hint">Nada aconteceu ainda.</p>}

      <div className="auditoria-lista">
        {entradas?.map((e) => (
          <div key={e.id} className="auditoria-linha">
            <span className="auditoria-icone"><Icon name={ICONE[e.acao] ?? 'settings'} size={15} /></span>
            <div className="auditoria-texto">
              <span><strong>{e.ator.nome}</strong> {FRASE[e.acao]?.(e) ?? e.acao}</span>
              {e.detalhe && e.acao !== 'membro.cargo' && e.acao !== 'servidor.atualizado' && (
                <span className="hint small">{e.detalhe}</span>
              )}
            </div>
            <span className="auditoria-quando">{quando(e.createdAt)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ============================ excluir servidor =========================== */

function SecaoExcluir({ guild, onExcluido, onErro }) {
  const [confirmacao, setConfirmacao] = useState('');
  const [apagando, setApagando] = useState(false);

  // Digitar o nome exato é o mesmo pedido do Discord: obriga a ler o que se
  // está prestes a destruir, em vez de clicar em "ok" no automático.
  const confere = confirmacao.trim() === guild.name;

  async function excluir() {
    setApagando(true);
    try {
      await api.deleteGuild(guild.id);
      onExcluido();
    } catch (err) {
      onErro(err.message);
      setApagando(false);
    }
  }

  return (
    <section className="settings-secao">
      <h2>Excluir servidor</h2>
      <div className="zona-perigo">
        <p>
          Isso apaga <strong>{guild.name}</strong> pra sempre: todos os canais, todas as
          mensagens, os cargos e a lista de membros. Não tem como desfazer, e ninguém
          consegue recuperar depois &mdash; nem você.
        </p>
        <label>
          Digite <strong>{guild.name}</strong> pra confirmar
          <input
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            placeholder={guild.name}
            autoComplete="off"
          />
        </label>
        <button className="primary perigo" disabled={!confere || apagando} onClick={excluir}>
          {apagando ? 'Apagando...' : 'Excluir este servidor'}
        </button>
      </div>
    </section>
  );
}

/* ================================= tela ================================== */

/**
 * Configurações do servidor em tela cheia, no mesmo molde da tela de
 * configurações do usuário (ver SettingsScreen.jsx): menu à esquerda, seção à
 * direita, ESC pra sair.
 *
 * Cada seção só aparece pra quem tem a permissão dela - não adianta mostrar
 * "Banimentos" pra quem vai tomar 403 ao abrir.
 */
export default function GuildSettingsScreen({
  guild, me, onClose, onErro, onConfirmar, onGuildAtualizada, onGuildExcluida, abaInicial = 'perfil',
}) {
  const [aba, setAba] = useState(abaInicial);

  useEffect(() => {
    const aoTeclar = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onClose]);

  const euMembro = guild.members.find((m) => m.id === me.id);
  const souDono = guild.role === 'owner';
  const pode = (bit) => souDono || temPermissao(euMembro, guild, bit);

  const podeGerenciar = pode(PERM.GERENCIAR_SERVIDOR);
  const podeCargos = pode(PERM.GERENCIAR_CARGOS);
  const podeBanir = pode(PERM.BANIR);

  const secoes = [
    { id: 'perfil', label: 'Perfil do servidor', grupo: 'Servidor', visivel: podeGerenciar },
    { id: 'cargos', label: 'Cargos', grupo: 'Pessoas', visivel: podeCargos },
    { id: 'membros', label: 'Membros', grupo: 'Pessoas', visivel: true },
    { id: 'convites', label: 'Convites', grupo: 'Pessoas', visivel: pode(PERM.CRIAR_CONVITE) },
    { id: 'banimentos', label: 'Banimentos', grupo: 'Moderação', visivel: podeBanir },
    { id: 'auditoria', label: 'Registro de auditoria', grupo: 'Moderação', visivel: podeGerenciar },
  ].filter((s) => s.visivel);

  const grupos = [...new Set(secoes.map((s) => s.grupo))];
  // Se a aba salva virou invisível (perdeu o cargo, por exemplo), cai na primeira.
  const abaAtiva = secoes.some((s) => s.id === aba) || aba === 'excluir' ? aba : secoes[0]?.id;

  return (
    <div className="settings-screen">
      <nav className="settings-nav">
        <div className="settings-user">
          <div className="guild-icone-mini">
            {guild.iconUrl
              ? <img key={guild.iconUrl} src={guild.iconUrl} alt="" style={cropStyle(guild.iconCrop)} />
              : <span>{guild.name[0]?.toUpperCase()}</span>}
          </div>
          <div className="settings-user-info">
            <strong>{guild.name}</strong>
            <span>{guild.members.length} {guild.members.length === 1 ? 'membro' : 'membros'}</span>
          </div>
        </div>

        {grupos.map((grupo) => (
          <div className="settings-grupo" key={grupo}>
            <span className="settings-grupo-titulo">{grupo}</span>
            {secoes.filter((s) => s.grupo === grupo).map((s) => (
              <button
                key={s.id}
                className={`settings-item ${abaAtiva === s.id ? 'ativo' : ''}`}
                onClick={() => setAba(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        ))}

        {souDono && (
          <div className="settings-grupo">
            <button
              className={`settings-item perigo ${abaAtiva === 'excluir' ? 'ativo' : ''}`}
              onClick={() => setAba('excluir')}
            >
              Excluir servidor
            </button>
          </div>
        )}
      </nav>

      <div className="settings-conteudo">
        <button className="settings-fechar" onClick={onClose} title="Fechar (Esc)">
          <span className="settings-fechar-x"><Icon name="x" size={16} /></span>
          <span className="settings-fechar-dica">ESC</span>
        </button>

        {abaAtiva === 'perfil' && <SecaoPerfil guild={guild} onSalvo={onGuildAtualizada} onErro={onErro} />}
        {abaAtiva === 'cargos' && <SecaoCargos guild={guild} onErro={onErro} />}
        {abaAtiva === 'membros' && (
          <SecaoMembros guild={guild} me={me} onErro={onErro} onConfirmar={onConfirmar} />
        )}
        {abaAtiva === 'convites' && <SecaoConvites guild={guild} onErro={onErro} />}
        {abaAtiva === 'banimentos' && <SecaoBanimentos guild={guild} onErro={onErro} />}
        {abaAtiva === 'auditoria' && <SecaoAuditoria guild={guild} onErro={onErro} />}
        {abaAtiva === 'excluir' && (
          <SecaoExcluir guild={guild} onExcluido={onGuildExcluida} onErro={onErro} />
        )}
      </div>
    </div>
  );
}

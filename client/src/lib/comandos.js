/**
 * Comandos com barra.
 *
 * Cada comando recebe um contexto com o que precisa (o argumento cru, quem
 * sou eu, o canal aberto, as ações de voz, a API) e devolve uma de três
 * coisas:
 *
 *   { texto }    -> vira uma mensagem normal, enviada pro canal
 *   { aviso }    -> só aparece pra quem rodou, não vai pro servidor
 *   nada         -> o comando já fez o que tinha que fazer sozinho
 *
 * Manter isso como dado (e não como um switch gigante) é o que deixa o menu
 * de autocomplete e o /ajuda saírem de graça da mesma lista.
 */

const SHRUG = '¯\\_(ツ)_/¯';

export const COMANDOS = [
  {
    nome: 'shrug',
    descricao: 'Põe ¯\\_(ツ)_/¯ no fim da mensagem',
    exemplo: '/shrug [mensagem]',
    run: ({ argumento }) => ({ texto: argumento ? `${argumento} ${SHRUG}` : SHRUG }),
  },
  {
    nome: 'tableflip',
    descricao: 'Vira a mesa',
    exemplo: '/tableflip [mensagem]',
    run: ({ argumento }) => ({ texto: `${argumento ? `${argumento} ` : ''}(╯°□°)╯︵ ┻━┻` }),
  },
  {
    nome: 'unflip',
    descricao: 'Desvira a mesa',
    exemplo: '/unflip [mensagem]',
    run: ({ argumento }) => ({ texto: `${argumento ? `${argumento} ` : ''}┬─┬ ノ( ゜-゜ノ)` }),
  },
  {
    nome: 'me',
    descricao: 'Manda a mensagem em itálico, como uma ação',
    exemplo: '/me está com fome',
    run: ({ argumento }) => (argumento
      ? { texto: `*${argumento}*` }
      : { aviso: 'Escreve o que você está fazendo: /me está com fome' }),
  },
  {
    nome: 'spoiler',
    descricao: 'Esconde a mensagem atrás de um spoiler',
    exemplo: '/spoiler o vilão morre',
    run: ({ argumento }) => (argumento
      ? { texto: `||${argumento}||` }
      : { aviso: 'Escreve o que quer esconder: /spoiler texto' }),
  },
  {
    nome: 'apelido',
    descricao: 'Muda seu apelido neste servidor (vazio volta ao normal)',
    exemplo: '/apelido Joãozinho',
    run: async ({ argumento, guild, me, api }) => {
      if (!guild) return { aviso: 'Isso só funciona dentro de um servidor.' };
      await api.setNickname(guild.id, me.id, argumento);
      return { aviso: argumento ? `Seu apelido virou "${argumento}".` : 'Apelido removido.' };
    },
  },
  {
    nome: 'status',
    descricao: 'Muda seu status: online, ausente, ocupado ou invisivel',
    exemplo: '/status ocupado',
    opcoes: ['online', 'ausente', 'ocupado', 'invisivel'],
    run: ({ argumento, presenceActions }) => {
      const mapa = {
        online: 'online', ausente: 'idle', idle: 'idle',
        ocupado: 'dnd', dnd: 'dnd', invisivel: 'invisible', invisível: 'invisible',
      };
      const status = mapa[argumento.toLowerCase().trim()];
      if (!status) return { aviso: 'Status válidos: online, ausente, ocupado, invisivel.' };
      presenceActions.definir({ status });
      return { aviso: `Status alterado para ${argumento}.` };
    },
  },
  {
    nome: 'jogando',
    descricao: 'Define na mão o que aparece como sua atividade',
    exemplo: '/jogando Minecraft',
    run: ({ argumento, presenceActions }) => {
      presenceActions.definir({ activity: argumento || null, manual: true });
      return {
        aviso: argumento
          ? `Agora aparece "Jogando ${argumento}" pra todo mundo.`
          : 'Atividade limpa - volta a detectar sozinho.',
      };
    },
  },
  {
    nome: 'entrar',
    descricao: 'Entra no canal de voz pelo nome',
    exemplo: '/entrar Sala de voz',
    run: ({ argumento, guild, voiceActions }) => {
      if (!guild) return { aviso: 'Isso só funciona dentro de um servidor.' };
      const canais = guild.channels.filter((c) => c.type === 'voice');
      const alvo = argumento
        ? canais.find((c) => c.name.toLowerCase().includes(argumento.toLowerCase()))
        : canais[0];
      if (!alvo) return { aviso: `Não achei nenhum canal de voz com "${argumento}".` };
      voiceActions.join(alvo.id);
      return { aviso: `Entrando em ${alvo.name}...` };
    },
  },
  {
    nome: 'sair',
    descricao: 'Sai da chamada de voz',
    exemplo: '/sair',
    run: ({ voice, voiceActions }) => {
      if (!voice.channelId) return { aviso: 'Você não está em nenhuma chamada.' };
      voiceActions.leave();
      return { aviso: 'Você saiu da chamada.' };
    },
  },
  {
    nome: 'mudo',
    descricao: 'Liga/desliga seu microfone',
    exemplo: '/mudo',
    run: ({ voice, voiceActions }) => {
      if (!voice.channelId) return { aviso: 'Você não está em nenhuma chamada.' };
      voiceActions.toggleMute();
      return { aviso: voice.self.muted ? 'Microfone ligado.' : 'Microfone mutado.' };
    },
  },
  {
    nome: 'surdo',
    descricao: 'Liga/desliga o som de todo mundo pra você',
    exemplo: '/surdo',
    run: ({ voice, voiceActions }) => {
      if (!voice.channelId) return { aviso: 'Você não está em nenhuma chamada.' };
      voiceActions.toggleDeafen();
      return { aviso: voice.self.deafened ? 'Som religado.' : 'Você não ouve mais ninguém.' };
    },
  },
  {
    nome: 'convite',
    descricao: 'Cria um link de convite pro servidor',
    exemplo: '/convite',
    run: async ({ guild, api }) => {
      if (!guild) return { aviso: 'Isso só funciona dentro de um servidor.' };
      try {
        const { invite } = await api.createInvite(guild.id);
        return { aviso: `Convite criado: ${window.location.origin}/?convite=${invite.code} (código ${invite.code})` };
      } catch {
        return { aviso: 'Você não tem permissão pra criar convite aqui.' };
      }
    },
  },
  {
    nome: 'ajuda',
    descricao: 'Lista todos os comandos',
    exemplo: '/ajuda',
    run: () => ({
      aviso: COMANDOS.map((c) => `/${c.nome} — ${c.descricao}`).join('\n'),
    }),
  },
];

/** Índice por nome, pra não varrer a lista toda a cada tecla digitada. */
const PORNOME = new Map(COMANDOS.map((c) => [c.nome, c]));

/**
 * Lê o que está no campo e diz se é um comando.
 * Só conta quando a barra é o primeiro caractere - "e/ou" no meio do texto
 * não vira comando.
 */
export function lerComando(texto) {
  if (!texto.startsWith('/')) return null;
  const corpo = texto.slice(1);
  const espaco = corpo.indexOf(' ');
  const nome = (espaco === -1 ? corpo : corpo.slice(0, espaco)).toLowerCase();
  const argumento = espaco === -1 ? '' : corpo.slice(espaco + 1).trim();
  return { nome, argumento, completo: espaco !== -1, comando: PORNOME.get(nome) ?? null };
}

/** Sugestões pro menu de autocomplete enquanto a pessoa digita. */
export function sugestoes(texto) {
  const lido = lerComando(texto);
  // Depois do primeiro espaço a pessoa já está escrevendo o argumento; aí o
  // menu só atrapalharia.
  if (!lido || lido.completo) return [];
  return COMANDOS.filter((c) => c.nome.startsWith(lido.nome));
}

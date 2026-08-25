import { q } from '../db.js';
import { newId } from './ids.js';

/**
 * Registro de auditoria do servidor.
 *
 * As acoes ficam como constantes e nao como string solta em cada chamada
 * porque o cliente traduz por esse codigo: um erro de digitacao viraria uma
 * linha sem texto na tela, e sem nada quebrando pra avisar.
 */
export const ACAO = {
  SERVIDOR_ATUALIZADO: 'servidor.atualizado',
  SERVIDOR_ICONE: 'servidor.icone',
  CANAL_CRIADO: 'canal.criado',
  CANAL_ATUALIZADO: 'canal.atualizado',
  CANAL_APAGADO: 'canal.apagado',
  CARGO_CRIADO: 'cargo.criado',
  CARGO_ATUALIZADO: 'cargo.atualizado',
  CARGO_APAGADO: 'cargo.apagado',
  CARGO_DADO: 'cargo.dado',
  CARGO_TIRADO: 'cargo.tirado',
  MEMBRO_EXPULSO: 'membro.expulso',
  MEMBRO_BANIDO: 'membro.banido',
  MEMBRO_DESBANIDO: 'membro.desbanido',
  MEMBRO_CASTIGO: 'membro.castigo',
  MEMBRO_CARGO: 'membro.cargo',
  MEMBRO_APELIDO: 'membro.apelido',
  CONVITE_CRIADO: 'convite.criado',
  CONVITE_APAGADO: 'convite.apagado',
};

/**
 * Grava uma linha no historico.
 *
 * Nunca deixa uma falha aqui derrubar a acao em si: se por algum motivo o
 * registro nao entrar, o banimento (ou o que for) ja aconteceu e o certo e
 * seguir - o historico e um relato do que foi feito, nao um pre-requisito
 * pra fazer.
 */
export function registrar(guildId, ator, acao, { alvo, alvoLabel, detalhe } = {}) {
  try {
    q.run(
      `INSERT INTO audit_log
         (id, guild_id, actor_id, actor_label, acao, target_id, target_label, detalhe, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(), guildId,
      ator.id, ator.username ?? ator.id,
      acao,
      alvo ?? null, alvoLabel ?? null, detalhe ?? null,
      Date.now(),
    );
  } catch (err) {
    console.error('[auditoria] nao consegui registrar', acao, err.message);
  }
}

/** Ultimas acoes do servidor, da mais nova pra mais velha. */
export function listar(guildId, limite = 100) {
  return q.all(
    `SELECT id, actor_id, actor_label, acao, target_id, target_label, detalhe, created_at
       FROM audit_log
      WHERE guild_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
    guildId, limite,
  ).map((l) => ({
    id: l.id,
    acao: l.acao,
    ator: { id: l.actor_id, nome: l.actor_label },
    alvo: l.target_id ? { id: l.target_id, nome: l.target_label } : null,
    detalhe: l.detalhe,
    createdAt: l.created_at,
  }));
}

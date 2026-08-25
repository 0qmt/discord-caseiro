import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { q } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { getIo } from '../lib/bus.js';
import { newId } from '../lib/ids.js';
import { sniffImage } from '../lib/images.js';
import { dmMessageDto } from '../lib/serialize.js';

export const reportRoutes = Router();
reportRoutes.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxAttachmentBytes, files: 5 },
});

/**
 * "Dono" do deployment: quem criou o primeiro servidor daqui. Não existe
 * conceito de admin geral no app hoje, e criar um seria mais complicado do
 * que precisa - quem sobe o primeiro servidor é, na prática, quem administra
 * a instância inteira.
 */
function donoDoDeployment() {
  const row = q.get('SELECT owner_id FROM guilds ORDER BY created_at ASC LIMIT 1');
  return row?.owner_id ?? null;
}

function pastaDoReport(id) {
  const pasta = path.join(config.reportsDir, id);
  fs.mkdirSync(pasta, { recursive: true });
  return pasta;
}

/** Manda uma mensagem de DM (mesma regra do dm:send em realtime.js) e avisa os dois lados. */
function mandarDm({ dmChannelId, authorId, content, attachment }) {
  const message = {
    id: newId(),
    dm_channel_id: dmChannelId,
    author_id: authorId,
    content,
    created_at: Date.now(),
    attachment_url: attachment?.url ?? null,
    attachment_type: attachment?.type ?? null,
    attachment_name: attachment?.name ?? null,
    reply_to_id: null,
  };
  q.run(
    `INSERT INTO dm_messages (id, dm_channel_id, author_id, content, created_at, attachment_url, attachment_type, attachment_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    message.id, dmChannelId, authorId, content, message.created_at,
    message.attachment_url, message.attachment_type, message.attachment_name,
  );
  const author = q.get('SELECT id, username, handle, avatar_url, avatar_crop FROM users WHERE id = ?', authorId);
  const dto = dmMessageDto({
    ...message, username: author.username, handle: author.handle,
    avatar_url: author.avatar_url, avatar_crop: author.avatar_crop,
  });
  const dm = q.get('SELECT user_a_id, user_b_id FROM dm_channels WHERE id = ?', dmChannelId);
  for (const participanteId of [dm.user_a_id, dm.user_b_id]) {
    getIo()?.to(`user:${participanteId}`).emit('dm:new', { message: dto });
  }
}

/**
 * Reportar um bug: formulário com nome, o que acontece, o que devia
 * acontecer e como resolver (opcional), mais prints. Isso vira três coisas
 * ao mesmo tempo:
 *  1. um arquivo em disco (reports/<id>/report.md + as imagens do lado),
 *     pra eu (Claude) ler direto na próxima sessão e já saber o que
 *     consertar sem precisar que ninguém explique de novo;
 *  2. uma DM de verdade pro dono do servidor, com o texto formatado e os
 *     prints anexados (uma mensagem por imagem, já que dm_messages só
 *     guarda um anexo por linha);
 *  3. a resposta pro quem reportou, confirmando que foi.
 */
reportRoutes.post('/', upload.array('images', 5), (req, res) => {
  const titulo = String(req.body?.title ?? '').trim();
  const oQueAcontece = String(req.body?.whatHappens ?? '').trim();
  const oQueParou = String(req.body?.whatStopsWorking ?? '').trim();
  const comoResolver = String(req.body?.howToFix ?? '').trim();

  if (!titulo || titulo.length > 120) {
    return res.status(400).json({ error: 'título precisa ter de 1 a 120 caracteres' });
  }
  if (!oQueAcontece || !oQueParou) {
    return res.status(400).json({ error: '"o que acontece" e "o que deveria acontecer" são obrigatórios' });
  }

  const donoId = donoDoDeployment();
  if (!donoId) return res.status(500).json({ error: 'ainda não existe nenhum servidor pra identificar o dono' });

  const reportId = newId();
  const pasta = pastaDoReport(reportId);
  const imagens = [];

  for (const file of req.files ?? []) {
    const kind = sniffImage(file.buffer);
    if (!kind) continue; // ignora silenciosamente o que não é imagem de verdade
    const nome = `${crypto.randomBytes(6).toString('hex')}.${kind.ext}`;
    fs.writeFileSync(path.join(pasta, nome), file.buffer);
    fs.writeFileSync(path.join(config.uploadsDir, `report-${nome}`), file.buffer);
    imagens.push({ arquivo: nome, url: `/uploads/report-${nome}`, tipo: kind.ext === 'gif' ? 'gif' : 'image' });
  }

  const reporter = q.get('SELECT id, username, handle FROM users WHERE id = ?', req.user.id);
  const registro = {
    id: reportId,
    criadoEm: new Date().toISOString(),
    reportadoPor: { id: reporter.id, username: reporter.username, handle: reporter.handle },
    titulo,
    oQueAcontece,
    oQueDeveriaAcontecer: oQueParou,
    comoResolver: comoResolver || null,
    imagens: imagens.map((i) => i.arquivo),
  };
  fs.writeFileSync(path.join(pasta, 'report.json'), JSON.stringify(registro, null, 2));
  fs.writeFileSync(path.join(pasta, 'report.md'), `# ${titulo}

**Reportado por:** ${reporter.username} (${reporter.id})
**Quando:** ${registro.criadoEm}

## O que está acontecendo
${oQueAcontece}

## O que deveria acontecer / o que parou de funcionar
${oQueParou}

${comoResolver ? `## Como pode ser resolvido\n${comoResolver}\n\n` : ''}${imagens.length ? `## Prints\n${imagens.map((i) => `- ${i.arquivo}`).join('\n')}\n` : ''}`);

  // A DM só existe entre gente que divide servidor - dono e quem reporta
  // sempre dividem pelo menos o servidor dele, então isso nunca falha aqui.
  const [a, b] = [req.user.id, donoId].sort();
  let dm = q.get('SELECT * FROM dm_channels WHERE user_a_id = ? AND user_b_id = ?', a, b);
  if (!dm) {
    dm = { id: newId(), user_a_id: a, user_b_id: b, created_at: Date.now() };
    q.run('INSERT INTO dm_channels (id, user_a_id, user_b_id, created_at) VALUES (?, ?, ?, ?)', dm.id, a, b, dm.created_at);
  }

  if (req.user.id !== donoId) {
    const texto = `🚨 **Report: ${titulo}**\n\n**O que está acontecendo:** ${oQueAcontece}\n\n**O que deveria acontecer:** ${oQueParou}`
      + (comoResolver ? `\n\n**Como resolver:** ${comoResolver}` : '');
    mandarDm({ dmChannelId: dm.id, authorId: req.user.id, content: texto });
    for (const img of imagens) {
      mandarDm({ dmChannelId: dm.id, authorId: req.user.id, content: '', attachment: { url: img.url, type: img.tipo, name: img.arquivo } });
    }
  }

  res.status(201).json({ ok: true, reportId });
});

/** Erros do multer (arquivo grande demais) viram mensagem legivel. */
reportRoutes.use((err, _req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    const mb = Math.round(config.maxAttachmentBytes / (1024 * 1024));
    return res.status(413).json({ error: `arquivo passa de ${mb} MB` });
  }
  return next(err);
});

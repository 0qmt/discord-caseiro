import nodemailer from 'nodemailer';
import { config } from '../config.js';

/**
 * Um transportador só, reaproveitado - criar um novo por e-mail seria
 * reautenticar no Gmail toda vez, à toa.
 */
let transportador = null;

function pegarTransportador() {
  if (!config.email) return null;
  if (!transportador) {
    transportador = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: config.email.user, pass: config.email.senhaDeApp },
    });
  }
  return transportador;
}

/** true se o servidor está configurado pra mandar e-mail de verdade. */
export const emailConfigurado = () => Boolean(config.email);

/**
 * Código de redefinição de senha. Simples de propósito - texto puro, sem
 * HTML/imagem nenhuma, pra não cair em spam por causa de link/imagem
 * externa e pra ficar legível em qualquer cliente de e-mail.
 */
export async function mandarCodigoDeRedefinicao(destinatario, codigo) {
  const t = pegarTransportador();
  if (!t) throw new Error('e-mail nao configurado');

  await t.sendMail({
    from: `Discord Caseiro <${config.email.user}>`,
    to: destinatario,
    subject: `${codigo} é o seu código do Discord Caseiro`,
    text: `Seu código pra redefinir a senha é: ${codigo}\n\n`
      + 'Ele vale por 15 minutos. Se você não pediu isso, pode ignorar este e-mail.',
  });
}

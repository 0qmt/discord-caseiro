import fs from 'node:fs';
import path from 'node:path';
import { config, DATA_DIR } from '../config.js';

const ARQUIVO_ENDERECO = path.join(DATA_DIR, 'turn-endpoint.json');

/**
 * O túnel gratuito (Pinggy) que expõe o coturn do celular expira de hora em
 * hora e reconecta com um endereço novo - o watchdog do celular escreve o
 * endereço atual aqui toda vez que reconecta. Lemos na hora de cada
 * chamada, sem guardar em cache: o arquivo é sempre a fonte mais nova.
 */
function enderecoAtual() {
  try {
    const { host, port } = JSON.parse(fs.readFileSync(ARQUIVO_ENDERECO, 'utf8'));
    return host && port ? { host, port } : null;
  } catch {
    return null; // tunel ainda nao conectou nenhuma vez, ou caiu agora.
  }
}

/**
 * TURN self-hosted (coturn no proprio celular). Só TCP: o túnel gratuito só
 * encaminha TCP, e o coturn faz o relay de áudio/vídeo dentro dessa mesma
 * conexão (RFC 6062) - não precisa de nenhuma outra porta liberada.
 */
export function turnServers() {
  const endereco = enderecoAtual();
  if (!endereco) return [];
  const { username, password } = config.turn;
  return [
    { urls: `turn:${endereco.host}:${endereco.port}?transport=tcp`, username, credential: password },
  ];
}

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const endereco = require('./endereco.js');

const ARQUIVO = path.join(app.getPath('userData'), 'config.json');

/*
 * O app já vem apontado pro servidor de producao: e o dominio fixo do tunel
 * (nunca muda), entao um amigo que baixa o instalador so abre e usa, sem
 * digitar endereco nenhum. Quem hospeda o proprio servidor (ou testa em
 * dev) ainda troca em Arquivo > Trocar de servidor... a qualquer momento.
 */
const PADRAO = { serverUrl: 'https://registry-absinthe-dehydrate.ngrok-free.dev' };

function ler() {
  try {
    return { ...PADRAO, ...JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')) };
  } catch {
    return { ...PADRAO };
  }
}

function salvar(parcial) {
  const novo = { ...ler(), ...parcial };
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(novo, null, 2));
  return novo;
}

module.exports = { ler, salvar, ARQUIVO, ...endereco };

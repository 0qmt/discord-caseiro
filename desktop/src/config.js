const endereco = require('./endereco.js');

const SERVIDORES_PRODUCAO = Object.freeze([
  'http://192.168.0.56:3002',
  'https://discord-caseiro.duckdns.org:3001',
  'https://discordia.tail291b3e.ts.net',
]);

module.exports = { SERVIDORES_PRODUCAO, ...endereco };

import os from 'node:os';
import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { getIo } from '../lib/bus.js';

export const adminRoutes = Router();
adminRoutes.use(requireAuth);

const EMAIL_DONO_DO_PROJETO = 'yjoaoga@gmail.com';

function souDonoDoProjeto(user) {
  return String(user?.email ?? '').trim().toLowerCase() === EMAIL_DONO_DO_PROJETO;
}

/**
 * Node nao da % de CPU pronto - so os acumulados desde o boot. Comparando
 * duas leituras com um intervalo curto no meio da gente chega no uso real.
 */
function usoDeCpu() {
  return new Promise((resolve) => {
    const inicio = os.cpus();
    setTimeout(() => {
      const fim = os.cpus();
      let ociosoTotal = 0;
      let geralTotal = 0;
      for (let i = 0; i < inicio.length; i += 1) {
        const a = inicio[i].times;
        const b = fim[i].times;
        const ocioso = b.idle - a.idle;
        const geral = (b.user - a.user) + (b.nice - a.nice) + (b.sys - a.sys) + (b.irq - a.irq) + ocioso;
        ociosoTotal += ocioso;
        geralTotal += geral;
      }
      resolve(geralTotal === 0 ? 0 : Math.round((1 - ociosoTotal / geralTotal) * 100));
    }, 300);
  });
}

adminRoutes.get('/stats', async (req, res) => {
  if (!souDonoDoProjeto(req.user)) {
    return res.status(403).json({ error: 'so o dono do projeto ve isso' });
  }

  const memTotal = os.totalmem();
  const memFree = os.freemem();

  res.json({
    cpuPercent: await usoDeCpu(),
    cpuCount: os.cpus().length,
    memTotal,
    memUsed: memTotal - memFree,
    uptimeSeconds: os.uptime(),
  });
});

/**
 * Avisa todo mundo conectado pra reiniciar o app. No desktop novo isso fecha
 * e abre o processo de verdade; em navegador/desktop antigo cai no reload da
 * pagina. Quem esta numa chamada grava o estado antes e tenta voltar logo
 * depois (ver App.jsx).
 */
adminRoutes.post('/reload', (req, res) => {
  if (!souDonoDoProjeto(req.user)) {
    return res.status(403).json({ error: 'so o dono do projeto pode fazer isso' });
  }
  getIo()?.emit('app:reload');
  res.json({ ok: true });
});

import os from 'node:os';
import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { getIo } from '../lib/bus.js';

export const adminRoutes = Router();
adminRoutes.use(requireAuth);

/** So quem administra pelo menos um servidor ve a saude da maquina. */
function souDono(userId) {
  return q.get(
    "SELECT 1 FROM guild_members WHERE user_id = ? AND role = 'owner' LIMIT 1", userId,
  ) !== null;
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
  if (!souDono(req.user.id)) {
    return res.status(403).json({ error: 'so quem administra um servidor ve isso' });
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
 * Avisa todo mundo conectado pra recarregar a pagina - assim toda
 * atualizacao de codigo chega sem precisar pedir pra cada pessoa fechar e
 * abrir o app na mao. Quem esta numa chamada recarrega junto e volta pra
 * ela sozinho logo depois (ver App.jsx).
 */
adminRoutes.post('/reload', (req, res) => {
  if (!souDono(req.user.id)) {
    return res.status(403).json({ error: 'so quem administra um servidor pode fazer isso' });
  }
  getIo()?.emit('app:reload');
  res.json({ ok: true });
});

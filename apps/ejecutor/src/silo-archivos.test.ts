import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { discoReal } from './ciclo';

describe('eliminar: archivos del ejecutor del silo', () => {
  it('lista y borra silos/<slug>/ y tokens/<slug>.token; solo los del slug; rechaza una subcarpeta', async () => {
    const base = await mkdtemp(join(tmpdir(), 'silos-'));
    try {
      const silosDir = join(base, 'silos');
      const tokensDir = join(base, 'tokens');
      await mkdir(join(silosDir, 'kibou'), { recursive: true });
      await mkdir(join(silosDir, 'otro'), { recursive: true });
      await mkdir(tokensDir);
      for (const f of ['.env', 'docker-compose.yml', 'demo-cuentas.txt']) await writeFile(join(silosDir, 'kibou', f), 'x');
      await writeFile(join(tokensDir, 'kibou.token'), 't');
      await writeFile(join(tokensDir, 'otro.token'), 't');
      await writeFile(join(silosDir, 'otro', '.env'), 'x');
      const d = discoReal(join(base, 'bajas'), join(base, 'respaldos'), { silosDir, tokensDir });
      assert.deepEqual((await d.archivosSilo!('kibou'))?.sort(), ['silos/kibou/.env', 'silos/kibou/demo-cuentas.txt', 'silos/kibou/docker-compose.yml', 'tokens/kibou.token']);
      await d.borrarArchivosSilo!('kibou');
      assert.equal(await d.archivosSilo!('kibou'), null);
      assert.deepEqual(await readdir(silosDir), ['otro']);
      assert.deepEqual(await readdir(tokensDir), ['otro.token']);
      // Algo inesperado dentro: no se empieza a borrar.
      await mkdir(join(silosDir, 'otro', 'sub'));
      await assert.rejects(d.archivosSilo!('otro'), /solo se esperan archivos/);
      await rm(join(silosDir, 'otro', 'sub'), { recursive: true });
      await symlink(join(base, 'respaldos'), join(silosDir, 'enlace'), 'junction').catch(() => undefined);
      await assert.rejects(d.archivosSilo!('enlace'), /carpeta comun/).catch(() => undefined);
      // Sin silosDir el verbo no los conoce.
      assert.equal(discoReal(join(base, 'bajas'), join(base, 'respaldos')).archivosSilo, undefined);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

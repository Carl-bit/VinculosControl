import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hashManifiesto, jsonCanonico } from './hash';
import { completarDependencias, fase1Schema, formatearRut,manifiestoSchema, quitarModulo, reglasSchema, rutValido, validarModulos } from './index';

describe('modulos', () => {
  it('MATCH y PAGINA_PUBLICA requieren EQUIPO', () => {
    const r = validarModulos(['MATCH', 'PAGINA_PUBLICA']);
    assert.equal(r.ok, false);
    assert.deepEqual(r.faltan, [
      { modulo: 'MATCH', falta: 'EQUIPO' },
      { modulo: 'PAGINA_PUBLICA', falta: 'EQUIPO' },
    ]);
  });
  it('sin requisitos pendientes es valido (lista vacia = solo nucleo)', () => {
    assert.equal(validarModulos(['EQUIPO', 'MATCH']).ok, true);
    assert.equal(validarModulos([]).ok, true);
  });
  it('las dependencias se agregan solas y en orden canonico', () => {
    assert.deepEqual(completarDependencias(['PAGINA_PUBLICA', 'MATCH', 'AGENDA']), ['AGENDA', 'EQUIPO', 'MATCH', 'PAGINA_PUBLICA']);
  });
  it('no se quita un modulo requerido por otro activo', () => {
    assert.deepEqual(quitarModulo(['EQUIPO', 'MATCH', 'PAGINA_PUBLICA'], 'EQUIPO'), { ok: false, requeridoPor: ['MATCH', 'PAGINA_PUBLICA'] });
    assert.deepEqual(quitarModulo(['EQUIPO', 'MATCH'], 'MATCH'), { ok: true, modulos: ['EQUIPO'] });
  });
});

describe('reglas (CHECK del ERP)', () => {
  it('acepta un set valido', () => {
    assert.equal(reglasSchema.safeParse({ plazo_aviso_cancelacion_horas: 24, recordatorio_horas_antes: 48, horas_aprobacion_solicitud: 24 }).success, true);
  });
  it('recordatorio debe ser 0 o mayor que el aviso de cancelacion', () => {
    assert.equal(reglasSchema.safeParse({ plazo_aviso_cancelacion_horas: 48, recordatorio_horas_antes: 24 }).success, false);
    assert.equal(reglasSchema.safeParse({ plazo_aviso_cancelacion_horas: 48, recordatorio_horas_antes: 0 }).success, true);
  });
  it('rechaza rangos y columnas desconocidas', () => {
    assert.equal(reglasSchema.safeParse({ edad_minima_cuenta: 12 }).success, false);
    assert.equal(reglasSchema.safeParse({ columna_que_no_existe: 1 }).success, false);
  });
  it('sin reglas de cobros (MVP sin cobros ni finanzas)', () => {
    for (const k of ['modelo_cobro', 'penalizacion_cancelacion_porcentaje', 'comision_centro_porcentaje', 'bloquear_agenda_morosos'])
      assert.equal(reglasSchema.safeParse({ [k]: 0 }).success, false, k);
  });
});

describe('fase 1', () => {
  const base = {
    nombre_centro: 'Centro Kibou',
    contacto: { nombre: 'Ana Perez', correo: 'Ana@Kibou.cl', telefono: '' },
    comuna: 'Providencia',
    tamano_equipo: '6 a 15',
    modulos_interes: ['AGENDA', 'FICHAS'],
    sitio_existente: 'nuevo',
    estilo_preferido: 'moderno',
  };
  it('normaliza correo y telefono vacio', () => {
    const r = fase1Schema.parse(base);
    assert.equal(r.contacto.correo, 'ana@kibou.cl');
    assert.equal(r.contacto.telefono, undefined);
  });
  it('no acepta WHATSAPP ni modulos que no existen (COBROS salio del ERP)', () => {
    assert.equal(fase1Schema.safeParse({ ...base, modulos_interes: ['AGENDA', 'COBROS'] }).success, false);
    assert.equal(fase1Schema.safeParse({ ...base, modulos_interes: ['WHATSAPP'] }).success, false);
  });
  it('rechaza campos extra (nada fuera del contrato)', () => {
    assert.equal(fase1Schema.safeParse({ ...base, rut_paciente: '1-9' }).success, false);
  });
});

describe('manifiesto completo', () => {
  const m = {
    schema: 1,
    tipo_cliente: 'centro',
    centro: {
      id: 'kibou',
      nombre: 'Centro Kibou',
      razon_social: 'Kibou Psicologia SpA',
      rut: '76.086.428-5',
      tipo_entidad: 'spa',
      admin: { nombre: 'Ana Perez', correo: 'admin@kibou.cl' },
      responsable_datos: { nombre: 'Ana Perez', correo: 'direccion@kibou.cl' },
    },
    dominio: { tipo: 'subdominio', valor: 'kibou.vinculos.cl' },
    version: { canal: 'estable' },
    estilo: { tema: 'moderno' },
    modulos: ['FICHAS', 'AGENDA', 'EQUIPO', 'MATCH', 'PAGINA_PUBLICA'],
  };
  it('valida el ejemplo del contexto', () => {
    const r = manifiestoSchema.safeParse(m);
    assert.equal(r.success, true, JSON.stringify(!r.success && r.error.issues));
  });
  it('rechaza modulos sin requisito', () => {
    assert.equal(manifiestoSchema.safeParse({ ...m, modulos: ['MATCH'] }).success, false);
  });
  it('RUT con digito verificador', () => {
    assert.equal(rutValido('76.086.428-5'), true);
    assert.equal(rutValido('76.086.428-4'), false);
    assert.equal(rutValido('11.111.111-1'), true);
    assert.equal(rutValido('111111111'), true);
  });
  it('formatea el RUT mientras se escribe', () => {
    assert.equal(formatearRut('111111111'), '11.111.111-1');
    assert.equal(formatearRut('760864285'), '76.086.428-5');
    assert.equal(formatearRut('7.654.321-k'), '7.654.321-K');
    assert.equal(formatearRut('1'), '1');
    assert.equal(formatearRut('12'), '1-2');
    assert.equal(formatearRut('1k2'), '1-2');
    assert.equal(formatearRut('11.111.111-11'), '11.111.111-1');
  });

  it('canal demo y bloque demo: el canal demo exige el bloque; las cantidades tienen limites', () => {
    assert.equal(manifiestoSchema.safeParse({ ...m, version: { canal: 'demo' } }).success, false);
    assert.equal(manifiestoSchema.safeParse({ ...m, version: { canal: 'demo' }, demo: { cuentas_madre: 2, profesionales: 5, pacientes: 60 } }).success, true);
    assert.equal(manifiestoSchema.safeParse({ ...m, demo: { cuentas_madre: 4, profesionales: 5, pacientes: 60 } }).success, false);
    assert.equal(manifiestoSchema.safeParse({ ...m, demo: { cuentas_madre: 1, profesionales: 5, pacientes: 301 } }).success, false);
  });
});

describe('hash', () => {
  it('no depende del orden de las claves', () => {
    assert.equal(hashManifiesto({ a: 1, b: [1, { y: 2, x: 1 }] }), hashManifiesto({ b: [1, { x: 1, y: 2 }], a: 1 }));
    assert.equal(jsonCanonico({ b: 1, a: undefined }), '{"b":1}');
  });
  it('cambia si cambia un valor', () => {
    assert.notEqual(hashManifiesto({ a: 1 }), hashManifiesto({ a: 2 }));
  });
});

import { armarManifiesto, borradorCentroSchema, borradorDesdeFase1, datosCentroSchema, mezclarBorradorCentro, sugerirSlug, validarP0 } from './fase2';

describe('fase 2 y P0', () => {
  const centro = {
    nombre: 'Centro Kibou',
    razon_social: 'Kibou Psicologia SpA',
    rut: '76.086.428-5',
    tipo_entidad: 'spa' as const,
    admin: { nombre: 'Ana Perez', correo: 'admin@kibou.cl' },
    responsable_datos: { nombre: 'Ana Perez', correo: 'direccion@kibou.cl' },
  };
  const completo = {
    centro,
    dominio: { tipo: 'subdominio' as const, valor: 'kibou.vinculos.cl' },
    modulos: ['FICHAS' as const, 'AGENDA' as const, 'EQUIPO' as const],
    version: { canal: 'estable' as const },
    legal: { contrato_encargo: { version: '2026-11', firmado_en: '2026-11-20' } },
  };
  it('P0 ok con borrador completo, slug y contrato', () => {
    const r = validarP0(completo, 'kibou');
    assert.equal(r.ok, true, r.errores.join('; '));
    assert.equal(r.manifiesto?.centro.id, 'kibou');
  });
  it('P0 exige slug, contrato y modulos del MVP', () => {
    const r = validarP0({ ...completo, legal: undefined, modulos: ['AGENDA', 'WHATSAPP'] }, null);
    assert.equal(r.ok, false);
    assert.ok(r.errores.some((e) => e.includes('slug')));
    assert.ok(r.errores.some((e) => e.includes('contrato')));
    assert.ok(r.errores.some((e) => e.includes('WHATSAPP no se ofrece')));
  });
  it('el centro no puede enviar version, reglas ni legal', () => {
    assert.equal(borradorCentroSchema.safeParse({ reglas: { edad_minima_cuenta: 18 } }).success, false);
  });
  it('mezclar respeta lo del operador', () => {
    const m = mezclarBorradorCentro({ version: { canal: 'beta' }, modulos: ['AGENDA'] }, { modulos: ['FICHAS'] });
    assert.deepEqual(m, { version: { canal: 'beta' }, modulos: ['FICHAS'] });
  });
  it('datos del centro: valida RUT y dependencias', () => {
    const base = { centro, dominio: completo.dominio, modulos: ['EQUIPO', 'MATCH'] };
    assert.equal(datosCentroSchema.safeParse(base).success, true);
    assert.equal(datosCentroSchema.safeParse({ ...base, modulos: ['MATCH'] }).success, false);
    assert.equal(datosCentroSchema.safeParse({ ...base, centro: { ...centro, rut: '76.086.428-1' } }).success, false);
  });
  it('armar pone tema moderno y canal estable por defecto', () => {
    const m = armarManifiesto({ modulos: [] }, 'x') as { estilo: unknown; version: unknown };
    assert.deepEqual(m.estilo, { tema: 'moderno' });
    assert.deepEqual(m.version, { canal: 'estable' });
  });
  it('estilo: el tema del operador se conserva si el centro solo manda su color', () => {
    const m = mezclarBorradorCentro({ estilo: { tema: 'cuaderno' } }, { estilo: { marca: { principal: '#2E6E6E' } } });
    assert.deepEqual(m.estilo, { tema: 'cuaderno', marca: { principal: '#2E6E6E' } });
  });
  it('tema: solo los del ERP; la preferencia de fase 1 pasa si existe', () => {
    assert.equal(validarP0({ ...completo, estilo: { tema: 'cuaderno' } }, 'kibou').ok, true);
    assert.equal(manifiestoSchema.safeParse({ ...(armarManifiesto(completo, 'kibou') as object), estilo: { tema: 'editorial' } }).success, false);
    assert.deepEqual(borradorDesdeFase1({ estilo_preferido: 'cuaderno' }).estilo, { tema: 'cuaderno' });
    assert.equal(borradorDesdeFase1({ estilo_preferido: 'editorial' }).estilo, undefined);
  });
  it('sugiere slug desde el nombre', () => {
    assert.equal(sugerirSlug('Centro Kibou'), 'kibou');
    assert.equal(sugerirSlug('Espacio Raíz'), 'espacio-raiz');
    assert.equal(sugerirSlug('Centro de Psicología'), 'centro-nuevo');
  });
});

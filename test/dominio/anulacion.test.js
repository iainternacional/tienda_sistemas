const test = require('node:test');
const assert = require('node:assert');
const { anularRegistro } = require('../../src/dominio/anulacion.js');

const DATOS = { anuladoPor: 'Admin', anuladoFecha: '2026-09-14T10:00:00.000Z', anuladoMotivo: 'error de digitacion' };

test('anularRegistro marca el registro conservando los campos originales', () => {
  const original = { id: 'p1', usuarioId: 'u1', valor: 20000, estado: 'pendiente' };
  const anulado = anularRegistro(original, DATOS);
  assert.strictEqual(anulado.estado, 'anulado');
  assert.strictEqual(anulado.anuladoPor, 'Admin');
  assert.strictEqual(anulado.anuladoFecha, '2026-09-14T10:00:00.000Z');
  assert.strictEqual(anulado.anuladoMotivo, 'error de digitacion');
  assert.strictEqual(anulado.valor, 20000);
  assert.strictEqual(original.estado, 'pendiente');
});

test('anularRegistro recorta el motivo', () => {
  const anulado = anularRegistro({ id: 'p1', estado: 'pendiente' }, Object.assign({}, DATOS, { anuladoMotivo: '  se devolvio  ' }));
  assert.strictEqual(anulado.anuladoMotivo, 'se devolvio');
});

test('anularRegistro exige motivo', () => {
  assert.throws(() => anularRegistro({ id: 'p1', estado: 'pendiente' }, Object.assign({}, DATOS, { anuladoMotivo: '   ' })), /motivo/i);
});

test('anularRegistro rechaza anular dos veces', () => {
  assert.throws(() => anularRegistro({ id: 'p1', estado: 'anulado' }, DATOS), /ya esta anulad/i);
});

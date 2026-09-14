const test = require('node:test');
const assert = require('node:assert');
const { repartirEntre, crearGastoCompartido, cuotasDeGasto } = require('../../src/dominio/gastosCompartidos.js');

const BASE = {
  id: 'g1',
  motivo: 'cumpleanos',
  descripcion: 'Torta de Ana',
  valorTotal: 30000,
  participantes: ['u1', 'u2', 'u3'],
  fecha: '2026-09-14T10:00:00.000Z'
};

test('repartirEntre divide exacto cuando es divisible', () => {
  assert.deepStrictEqual(repartirEntre(30000, 3), [10000, 10000, 10000]);
});

test('repartirEntre distribuye el residuo entre los primeros', () => {
  assert.deepStrictEqual(repartirEntre(10000, 3), [3334, 3333, 3333]);
});

test('repartirEntre siempre suma el valor total', () => {
  [[10000, 3], [7, 4], [1, 3], [99999, 7]].forEach(function (caso) {
    const partes = repartirEntre(caso[0], caso[1]);
    assert.strictEqual(partes.length, caso[1]);
    assert.strictEqual(partes.reduce((a, b) => a + b, 0), caso[0]);
  });
});

test('repartirEntre rechaza cero participantes', () => {
  assert.throws(() => repartirEntre(10000, 0), /participante/i);
});

test('crearGastoCompartido guarda los participantes como texto separado por coma', () => {
  const gasto = crearGastoCompartido(BASE);
  assert.strictEqual(gasto.participantes, 'u1,u2,u3');
  assert.strictEqual(gasto.valorTotal, 30000);
  assert.strictEqual(gasto.motivo, 'cumpleanos');
  assert.strictEqual(gasto.estado, 'pendiente');
});

test('crearGastoCompartido rechaza un motivo desconocido', () => {
  assert.throws(() => crearGastoCompartido(Object.assign({}, BASE, { motivo: 'paseo' })), /motivo/i);
});

test('crearGastoCompartido exige al menos un participante', () => {
  assert.throws(() => crearGastoCompartido(Object.assign({}, BASE, { participantes: [] })), /participante/i);
});

test('crearGastoCompartido rechaza participantes repetidos', () => {
  assert.throws(() => crearGastoCompartido(Object.assign({}, BASE, { participantes: ['u1', 'u1'] })), /repetid/i);
});

test('crearGastoCompartido rechaza valor invalido', () => {
  assert.throws(() => crearGastoCompartido(Object.assign({}, BASE, { valorTotal: 0 })), /valor/i);
});

test('cuotasDeGasto genera una cuota por participante', () => {
  const cuotas = cuotasDeGasto(crearGastoCompartido(BASE));
  assert.strictEqual(cuotas.length, 3);
  assert.deepStrictEqual(cuotas.map(c => c.usuarioId), ['u1', 'u2', 'u3']);
  assert.deepStrictEqual(cuotas.map(c => c.valor), [10000, 10000, 10000]);
  assert.strictEqual(cuotas[0].gastoId, 'g1');
  assert.strictEqual(cuotas[0].descripcion, 'Torta de Ana');
});

test('cuotasDeGasto no genera nada para un gasto anulado', () => {
  const anulado = Object.assign({}, crearGastoCompartido(BASE), { estado: 'anulado' });
  assert.deepStrictEqual(cuotasDeGasto(anulado), []);
});

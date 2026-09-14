const test = require('node:test');
const assert = require('node:assert');
const { crearPago, esAbonoGeneral } = require('../../src/dominio/pagos.js');

const BASE = { id: 'pg1', usuarioId: 'u1', valor: 15000, aplicadoA: [], fecha: '2026-09-14T10:00:00.000Z' };

test('crearPago arma un abono general cuando no se aplica a nada', () => {
  const pago = crearPago(BASE);
  assert.strictEqual(pago.aplicadoA, '');
  assert.strictEqual(pago.valor, 15000);
  assert.strictEqual(pago.estado, 'pendiente');
  assert.strictEqual(esAbonoGeneral(pago), true);
});

test('crearPago guarda los ids aplicados separados por coma', () => {
  const pago = crearPago(Object.assign({}, BASE, { aplicadoA: ['t1', 't2'] }));
  assert.strictEqual(pago.aplicadoA, 't1,t2');
  assert.strictEqual(esAbonoGeneral(pago), false);
});

test('crearPago exige usuario', () => {
  assert.throws(() => crearPago(Object.assign({}, BASE, { usuarioId: '' })), /usuario/i);
});

test('crearPago rechaza valor invalido', () => {
  assert.throws(() => crearPago(Object.assign({}, BASE, { valor: 0 })), /valor/i);
  assert.throws(() => crearPago(Object.assign({}, BASE, { valor: 120.5 })), /valor/i);
});

test('esAbonoGeneral trata el texto vacio con espacios como general', () => {
  assert.strictEqual(esAbonoGeneral({ aplicadoA: '   ' }), true);
});

const test = require('node:test');
const assert = require('node:assert');
const { crearPerdida } = require('../../src/dominio/perdidas.js');

const PRODUCTO = { id: 'p1', nombre: 'Cafe', costo: 800, precioVenta: 1500, stockActual: 10, activo: true };
const BASE = { id: 'pe1', producto: PRODUCTO, cantidad: 2, motivo: 'se vencio', fecha: '2026-09-14T10:00:00.000Z' };

test('crearPerdida valora la perdida al costo del producto', () => {
  const perdida = crearPerdida(BASE);
  assert.strictEqual(perdida.valor, 1600);
  assert.strictEqual(perdida.productoId, 'p1');
  assert.strictEqual(perdida.productoNombre, 'Cafe');
  assert.strictEqual(perdida.cantidad, 2);
  assert.strictEqual(perdida.motivo, 'se vencio');
  assert.strictEqual(perdida.estado, 'pendiente');
});

test('crearPerdida exige motivo', () => {
  assert.throws(() => crearPerdida(Object.assign({}, BASE, { motivo: '   ' })), /motivo/i);
});

test('crearPerdida rechaza cantidad invalida', () => {
  assert.throws(() => crearPerdida(Object.assign({}, BASE, { cantidad: 0 })), /cantidad/i);
});

test('crearPerdida rechaza cuando no alcanza el stock', () => {
  assert.throws(() => crearPerdida(Object.assign({}, BASE, { cantidad: 11 })), /stock/i);
});

test('crearPerdida exige producto', () => {
  assert.throws(() => crearPerdida(Object.assign({}, BASE, { producto: null })), /producto/i);
});

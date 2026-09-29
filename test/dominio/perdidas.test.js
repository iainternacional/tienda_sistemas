const test = require('node:test');
const assert = require('node:assert');
const { crearPerdida } = require('../../src/dominio/perdidas.js');

const PRODUCTO = { id: 'p1', nombre: 'Cafe', costo: 800, precioVenta: 1500, stockActual: 10, activo: true };
const CONSUMO = {
  consumos: [{ loteId: 'l1', cantidad: 2, costoUnitario: 800 }],
  costoTotal: 1600,
  costoUnitarioPromedio: 800,
  lotesActualizados: []
};

const BASE = {
  id: 'pe1', producto: PRODUCTO, cantidad: 2, motivo: 'se vencio',
  fecha: '2026-09-14T10:00:00.000Z', consumo: CONSUMO
};

test('crearPerdida valora la perdida al costo real de los lotes consumidos', () => {
  const perdida = crearPerdida(BASE);
  assert.strictEqual(perdida.valor, 1600);
  assert.strictEqual(perdida.productoId, 'p1');
  assert.strictEqual(perdida.productoNombre, 'Cafe');
  assert.strictEqual(perdida.cantidad, 2);
  assert.strictEqual(perdida.motivo, 'se vencio');
  assert.strictEqual(perdida.estado, 'pendiente');
});

test('crearPerdida usa el costo exacto cuando la perdida cruza dos lotes', () => {
  const consumo = {
    consumos: [
      { loteId: 'viejo', cantidad: 1, costoUnitario: 2925 },
      { loteId: 'nuevo', cantidad: 2, costoUnitario: 3000 }
    ],
    costoTotal: 8925,
    costoUnitarioPromedio: 2975,
    lotesActualizados: []
  };
  const perdida = crearPerdida(Object.assign({}, BASE, { cantidad: 3, consumo: consumo }));
  assert.strictEqual(perdida.valor, 8925);
  assert.deepStrictEqual(JSON.parse(perdida.lotesConsumidos), consumo.consumos);
});

test('crearPerdida exige el consumo de lotes', () => {
  assert.throws(() => crearPerdida(Object.assign({}, BASE, { consumo: null })), /lote/i);
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

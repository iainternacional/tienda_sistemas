const test = require('node:test');
const assert = require('node:assert');
const { crearPerdida, estaCargada, perdidasSinCargar, seleccionarPerdidasACargar } = require('../../src/dominio/perdidas.js');

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

test('crearPerdida deja la perdida sin cargar a ningun gasto', () => {
  const perdida = crearPerdida(BASE);
  assert.strictEqual(perdida.gastoId, '');
  assert.strictEqual(estaCargada(perdida), false);
});

const REGISTROS = [
  { id: 'a', valor: 1000, estado: 'pendiente', gastoId: '' },
  { id: 'b', valor: 2500, estado: 'pendiente' },
  { id: 'c', valor: 4000, estado: 'anulado', gastoId: '' },
  { id: 'd', valor: 3000, estado: 'pendiente', gastoId: 'g1' }
];

test('perdidasSinCargar excluye las anuladas y las ya cargadas', () => {
  assert.deepStrictEqual(perdidasSinCargar(REGISTROS).map(p => p.id), ['a', 'b']);
});

test('seleccionarPerdidasACargar suma el costo de lo elegido', () => {
  const seleccion = seleccionarPerdidasACargar(REGISTROS, ['a', 'b']);
  assert.strictEqual(seleccion.total, 3500);
  assert.strictEqual(seleccion.perdidas.length, 2);
});

test('seleccionarPerdidasACargar exige al menos una perdida', () => {
  assert.throws(() => seleccionarPerdidasACargar(REGISTROS, []), /al menos una/i);
});

test('seleccionarPerdidasACargar rechaza una perdida inexistente', () => {
  assert.throws(() => seleccionarPerdidasACargar(REGISTROS, ['a', 'zzz']), /No se encontro/i);
});

test('seleccionarPerdidasACargar rechaza una perdida anulada', () => {
  assert.throws(() => seleccionarPerdidasACargar(REGISTROS, ['c']), /anulada/i);
});

test('seleccionarPerdidasACargar rechaza una perdida ya cargada', () => {
  assert.throws(() => seleccionarPerdidasACargar(REGISTROS, ['a', 'd']), /ya fue cargada/i);
});

test('seleccionarPerdidasACargar rechaza perdidas repetidas', () => {
  assert.throws(() => seleccionarPerdidasACargar(REGISTROS, ['a', 'a']), /repetidas/i);
});

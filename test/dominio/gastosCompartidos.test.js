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

const PRODUCTO = { id: 'p1', nombre: 'Gaseosa', precioVenta: 2500, stockActual: 10, activo: true };
const CONSUMO = {
  consumos: [{ loteId: 'l1', cantidad: 3, costoUnitario: 1800 }],
  costoTotal: 5400,
  costoUnitarioPromedio: 1800,
  lotesActualizados: []
};
const CON_PRODUCTO = Object.assign({}, BASE, {
  valorTotal: undefined, producto: PRODUCTO, cantidad: 3, consumo: CONSUMO
});

test('crearGastoCompartido sin producto deja los campos de producto vacios', () => {
  const gasto = crearGastoCompartido(BASE);
  assert.strictEqual(gasto.productoId, '');
  assert.strictEqual(gasto.productoNombre, '');
  assert.strictEqual(gasto.cantidad, '');
  assert.strictEqual(gasto.lotesConsumidos, '');
});

test('crearGastoCompartido con producto usa el costo de los lotes como valor total', () => {
  const gasto = crearGastoCompartido(CON_PRODUCTO);
  assert.strictEqual(gasto.valorTotal, 5400);
  assert.strictEqual(gasto.productoId, 'p1');
  assert.strictEqual(gasto.productoNombre, 'Gaseosa');
  assert.strictEqual(gasto.cantidad, 3);
  assert.deepStrictEqual(JSON.parse(gasto.lotesConsumidos), CONSUMO.consumos);
});

test('crearGastoCompartido con producto ignora el valor manual', () => {
  const gasto = crearGastoCompartido(Object.assign({}, CON_PRODUCTO, { valorTotal: 99999 }));
  assert.strictEqual(gasto.valorTotal, 5400);
});

test('crearGastoCompartido con producto exige el consumo de lotes', () => {
  assert.throws(() => crearGastoCompartido(Object.assign({}, CON_PRODUCTO, { consumo: null })), /lote/i);
});

test('crearGastoCompartido con producto rechaza cantidad invalida', () => {
  assert.throws(() => crearGastoCompartido(Object.assign({}, CON_PRODUCTO, { cantidad: 0 })), /cantidad/i);
});

test('crearGastoCompartido con producto rechaza cuando no alcanza el stock', () => {
  assert.throws(() => crearGastoCompartido(Object.assign({}, CON_PRODUCTO, { cantidad: 11 })), /stock/i);
});

test('cuotasDeGasto reparte el costo del producto entre los participantes', () => {
  const cuotas = cuotasDeGasto(crearGastoCompartido(CON_PRODUCTO));
  assert.deepStrictEqual(cuotas.map(c => c.valor), [1800, 1800, 1800]);
});

test('cuotasDeGasto no genera nada para un gasto anulado', () => {
  const anulado = Object.assign({}, crearGastoCompartido(BASE), { estado: 'anulado' });
  assert.deepStrictEqual(cuotasDeGasto(anulado), []);
});

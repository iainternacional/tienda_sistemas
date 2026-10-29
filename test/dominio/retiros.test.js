const test = require('node:test');
const assert = require('node:assert');
const { crearRetiro, retirosActivos, calcularDisponible } = require('../../src/dominio/retiros.js');

const BASE = {
  id: 'r1', valor: 30000, motivo: 'helados para todos',
  fecha: '2026-10-29T10:00:00.000Z', admin: 'u1', disponible: 50000
};

test('crearRetiro crea un retiro activo valido', () => {
  const retiro = crearRetiro(BASE);
  assert.strictEqual(retiro.id, 'r1');
  assert.strictEqual(retiro.valor, 30000);
  assert.strictEqual(retiro.motivo, 'helados para todos');
  assert.strictEqual(retiro.fecha, BASE.fecha);
  assert.strictEqual(retiro.admin, 'u1');
  assert.strictEqual(retiro.estado, 'activo');
});

test('crearRetiro rechaza valor 0, negativo o decimal', () => {
  [0, -5, 10.5].forEach(valor => {
    assert.throws(() => crearRetiro(Object.assign({}, BASE, { valor })), /valor/i);
  });
});

test('crearRetiro rechaza motivo vacio o solo espacios', () => {
  assert.throws(() => crearRetiro(Object.assign({}, BASE, { motivo: '   ' })), /motivo/i);
  assert.throws(() => crearRetiro(Object.assign({}, BASE, { motivo: '' })), /motivo/i);
});

test('crearRetiro permite retirar exactamente el disponible', () => {
  const retiro = crearRetiro(Object.assign({}, BASE, { valor: 50000 }));
  assert.strictEqual(retiro.valor, 50000);
});

test('crearRetiro rechaza un peso por encima del disponible', () => {
  assert.throws(() => crearRetiro(Object.assign({}, BASE, { valor: 50001 })), /disponible/i);
});

test('crearRetiro rechaza cualquier retiro si el disponible es negativo', () => {
  assert.throws(() => crearRetiro(Object.assign({}, BASE, { valor: 1, disponible: -2000 })), /disponible/i);
});

test('retirosActivos excluye los anulados', () => {
  const lista = [{ id: 'a', estado: 'activo' }, { id: 'b', estado: 'anulado' }];
  assert.deepStrictEqual(retirosActivos(lista).map(r => r.id), ['a']);
});

test('calcularDisponible resta perdidas y solo retiros activos', () => {
  const retiros = [
    { valor: 30000, estado: 'activo' },
    { valor: 99999, estado: 'anulado' }
  ];
  assert.strictEqual(calcularDisponible(100000, 20000, retiros), 50000);
});

test('calcularDisponible es negativo si las perdidas superan la ganancia', () => {
  assert.strictEqual(calcularDisponible(10000, 25000, []), -15000);
});

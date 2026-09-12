const test = require('node:test');
const assert = require('node:assert');
const { esEnteroPositivo, calcularValorTotal } = require('../../src/dominio/dinero.js');

test('esEnteroPositivo acepta enteros mayores a cero', () => {
  assert.strictEqual(esEnteroPositivo(1), true);
  assert.strictEqual(esEnteroPositivo(1500), true);
});

test('esEnteroPositivo rechaza cero, negativos, decimales y no numeros', () => {
  assert.strictEqual(esEnteroPositivo(0), false);
  assert.strictEqual(esEnteroPositivo(-5), false);
  assert.strictEqual(esEnteroPositivo(1.5), false);
  assert.strictEqual(esEnteroPositivo('1500'), false);
  assert.strictEqual(esEnteroPositivo(null), false);
  assert.strictEqual(esEnteroPositivo(undefined), false);
});

test('calcularValorTotal multiplica cantidad por valor unitario', () => {
  assert.strictEqual(calcularValorTotal(3, 1500), 4500);
});

test('calcularValorTotal rechaza cantidad invalida', () => {
  assert.throws(() => calcularValorTotal(0, 1500), /cantidad/i);
});

test('calcularValorTotal rechaza valor unitario invalido', () => {
  assert.throws(() => calcularValorTotal(2, 0), /valor unitario/i);
});

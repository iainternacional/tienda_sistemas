const test = require('node:test');
const assert = require('node:assert');
const { ESQUEMA } = require('../../src/datos/esquema.js');

test('ESQUEMA define la hoja Lotes con sus columnas en orden', () => {
  assert.deepStrictEqual(ESQUEMA.Lotes, [
    'id', 'productoId', 'fecha', 'cantidadInicial', 'cantidadRestante',
    'costoUnitario', 'estado', 'anuladoPor', 'anuladoFecha', 'anuladoMotivo'
  ]);
});

test('lotesConsumidos va al final de Transacciones', () => {
  const columnas = ESQUEMA.Transacciones;
  assert.strictEqual(columnas[columnas.length - 1], 'lotesConsumidos');
});

test('lotesConsumidos va al final de Perdidas', () => {
  const columnas = ESQUEMA.Perdidas;
  assert.strictEqual(columnas[columnas.length - 1], 'lotesConsumidos');
});

test('las columnas viejas de Transacciones conservan su posicion', () => {
  assert.strictEqual(ESQUEMA.Transacciones[0], 'id');
  assert.strictEqual(ESQUEMA.Transacciones[13], 'costoUnitario');
});

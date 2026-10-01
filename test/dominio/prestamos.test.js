const test = require('node:test');
const assert = require('node:assert');
const { crearPrestamo } = require('../../src/dominio/prestamos.js');

const BASE = { id: 'pr1', usuarioId: 'u1', valor: 20000, fecha: '2026-09-14T10:00:00.000Z' };

test('crearPrestamo arma el registro pendiente con concepto por defecto', () => {
  assert.deepStrictEqual(crearPrestamo(BASE), {
    id: 'pr1',
    usuarioId: 'u1',
    valor: 20000,
    fecha: '2026-09-14T10:00:00.000Z',
    estado: 'pendiente',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: '',
    concepto: 'Prestamo en efectivo'
  });
});

test('crearPrestamo acepta un concepto personalizado', () => {
  const prestamo = crearPrestamo(Object.assign({}, BASE, { concepto: 'Saldo anterior' }));
  assert.strictEqual(prestamo.concepto, 'Saldo anterior');
});

test('crearPrestamo ignora un concepto en blanco y usa el default', () => {
  const prestamo = crearPrestamo(Object.assign({}, BASE, { concepto: '   ' }));
  assert.strictEqual(prestamo.concepto, 'Prestamo en efectivo');
});

test('crearPrestamo exige id', () => {
  assert.throws(() => crearPrestamo(Object.assign({}, BASE, { id: '' })), /id/i);
});

test('crearPrestamo exige usuario', () => {
  assert.throws(() => crearPrestamo(Object.assign({}, BASE, { usuarioId: '' })), /usuario/i);
});

test('crearPrestamo rechaza valor cero o negativo', () => {
  assert.throws(() => crearPrestamo(Object.assign({}, BASE, { valor: 0 })), /valor/i);
  assert.throws(() => crearPrestamo(Object.assign({}, BASE, { valor: -5000 })), /valor/i);
});

test('crearPrestamo rechaza valor con decimales', () => {
  assert.throws(() => crearPrestamo(Object.assign({}, BASE, { valor: 1500.5 })), /valor/i);
});

const test = require('node:test');
const assert = require('node:assert');
const { calcularSaldoUsuario, desglosarSaldoUsuario } = require('../../src/dominio/saldo.js');

const TRANSACCIONES = [
  { id: 't1', usuarioId: 'u1', productoNombre: 'Cafe', cantidad: 2, valorTotal: 3000, fecha: '2026-09-10T10:00:00.000Z', estado: 'pendiente' },
  { id: 't2', usuarioId: 'u1', productoNombre: 'Galletas', cantidad: 1, valorTotal: 2000, fecha: '2026-09-11T10:00:00.000Z', estado: 'pendiente' },
  { id: 't3', usuarioId: 'u1', productoNombre: 'Gaseosa', cantidad: 1, valorTotal: 2500, fecha: '2026-09-09T10:00:00.000Z', estado: 'pagado' },
  { id: 't4', usuarioId: 'u1', productoNombre: 'Chocolate', cantidad: 1, valorTotal: 1800, fecha: '2026-09-08T10:00:00.000Z', estado: 'anulado' },
  { id: 't5', usuarioId: 'u2', productoNombre: 'Cafe', cantidad: 1, valorTotal: 1500, fecha: '2026-09-11T11:00:00.000Z', estado: 'pendiente' }
];

test('calcularSaldoUsuario suma solo las pendientes del usuario', () => {
  assert.strictEqual(calcularSaldoUsuario(TRANSACCIONES, 'u1'), 5000);
});

test('calcularSaldoUsuario ignora pagadas y anuladas', () => {
  const soloCerradas = TRANSACCIONES.filter(t => t.estado !== 'pendiente');
  assert.strictEqual(calcularSaldoUsuario(soloCerradas, 'u1'), 0);
});

test('calcularSaldoUsuario devuelve cero para un usuario sin movimientos', () => {
  assert.strictEqual(calcularSaldoUsuario(TRANSACCIONES, 'u9'), 0);
});

test('desglosarSaldoUsuario lista las pendientes de mas reciente a mas antigua', () => {
  const desglose = desglosarSaldoUsuario(TRANSACCIONES, 'u1');
  assert.deepStrictEqual(desglose.map(d => d.id), ['t2', 't1']);
  assert.deepStrictEqual(desglose[0], {
    id: 't2', fecha: '2026-09-11T10:00:00.000Z', concepto: 'Galletas', cantidad: 1, valorTotal: 2000
  });
});

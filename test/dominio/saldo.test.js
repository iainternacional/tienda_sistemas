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

const PRESTAMOS = [
  { id: 'pr1', usuarioId: 'u1', valor: 20000, fecha: '2026-09-12T10:00:00.000Z', estado: 'pendiente' },
  { id: 'pr2', usuarioId: 'u1', valor: 5000, fecha: '2026-09-07T10:00:00.000Z', estado: 'anulado' },
  { id: 'pr3', usuarioId: 'u2', valor: 9000, fecha: '2026-09-12T11:00:00.000Z', estado: 'pendiente' }
];

const GASTOS = [
  { id: 'g1', motivo: 'cumpleanos', descripcion: 'Torta de Ana', valorTotal: 30000, participantes: 'u1,u2,u3', fecha: '2026-09-13T10:00:00.000Z', estado: 'pendiente' },
  { id: 'g2', motivo: 'bienvenida', descripcion: 'Pedro', valorTotal: 12000, participantes: 'u1,u2', fecha: '2026-09-06T10:00:00.000Z', estado: 'anulado' }
];

const PAGOS = [
  { id: 'pg1', usuarioId: 'u1', valor: 4000, aplicadoA: '', fecha: '2026-09-13T12:00:00.000Z', estado: 'pendiente' },
  { id: 'pg2', usuarioId: 'u1', valor: 9999, aplicadoA: 't3', fecha: '2026-09-09T12:00:00.000Z', estado: 'pendiente' },
  { id: 'pg3', usuarioId: 'u1', valor: 1000, aplicadoA: '', fecha: '2026-09-05T12:00:00.000Z', estado: 'anulado' }
];

const MOVIMIENTOS = { transacciones: TRANSACCIONES, prestamos: PRESTAMOS, gastos: GASTOS, pagos: PAGOS };

test('calcularSaldoUsuario suma fiado, prestamos y cuotas, y resta abonos generales', () => {
  // fiado 3000 + 2000, prestamo 20000, cuota 10000, menos abono general 4000
  assert.strictEqual(calcularSaldoUsuario(MOVIMIENTOS, 'u1'), 31000);
});

test('calcularSaldoUsuario ignora anulados y pagos dirigidos', () => {
  // el prestamo pr2 y el gasto g2 estan anulados; pg2 es dirigido y pg3 anulado
  const soloAnulados = { transacciones: [], prestamos: [PRESTAMOS[1]], gastos: [GASTOS[1]], pagos: [PAGOS[1], PAGOS[2]] };
  assert.strictEqual(calcularSaldoUsuario(soloAnulados, 'u1'), 0);
});

test('calcularSaldoUsuario devuelve cero para un usuario sin movimientos', () => {
  assert.strictEqual(calcularSaldoUsuario(MOVIMIENTOS, 'u9'), 0);
});

test('calcularSaldoUsuario tolera colecciones ausentes', () => {
  assert.strictEqual(calcularSaldoUsuario({ transacciones: TRANSACCIONES }, 'u1'), 5000);
});

test('desglosarSaldoUsuario lista todo de mas reciente a mas antiguo', () => {
  // pg1 es del 13 a las 12:00 y g1 del 13 a las 10:00, asi que el abono va primero
  const desglose = desglosarSaldoUsuario(MOVIMIENTOS, 'u1');
  assert.deepStrictEqual(desglose.map(d => d.id), ['pg1', 'g1', 'pr1', 't2', 't1']);
});

test('desglosarSaldoUsuario marca el tipo de cada linea', () => {
  const porId = {};
  desglosarSaldoUsuario(MOVIMIENTOS, 'u1').forEach(d => { porId[d.id] = d; });
  assert.strictEqual(porId.t1.tipo, 'fiado');
  assert.strictEqual(porId.pr1.tipo, 'prestamo');
  assert.strictEqual(porId.g1.tipo, 'gasto');
  assert.strictEqual(porId.pg1.tipo, 'abono');
});

test('desglosarSaldoUsuario muestra el abono en negativo', () => {
  const abono = desglosarSaldoUsuario(MOVIMIENTOS, 'u1').find(d => d.tipo === 'abono');
  assert.strictEqual(abono.valorTotal, -4000);
});

test('desglosarSaldoUsuario describe la cuota del gasto', () => {
  const cuota = desglosarSaldoUsuario(MOVIMIENTOS, 'u1').find(d => d.tipo === 'gasto');
  assert.strictEqual(cuota.valorTotal, 10000);
  assert.strictEqual(cuota.concepto, 'Cumpleanos: Torta de Ana');
});

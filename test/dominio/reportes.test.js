const test = require('node:test');
const assert = require('node:assert');
const { reporteGanancia } = require('../../src/dominio/reportes.js');

const PRODUCTOS = [
  { id: 'p1', nombre: 'Cafe', costo: 900, precioVenta: 1500 },
  { id: 'p2', nombre: 'Galletas', costo: 1200, precioVenta: 2000 }
];

const TRANSACCIONES = [
  { id: 't1', productoId: 'p1', productoNombre: 'Cafe', cantidad: 2, valorUnitario: 1500, valorTotal: 3000, costoUnitario: 800, fecha: '2026-09-10T10:00:00.000Z', estado: 'pendiente' },
  { id: 't2', productoId: 'p2', productoNombre: 'Galletas', cantidad: 1, valorUnitario: 2000, valorTotal: 2000, costoUnitario: 1200, fecha: '2026-09-11T10:00:00.000Z', estado: 'pagado' },
  { id: 't3', productoId: 'p1', productoNombre: 'Cafe', cantidad: 5, valorUnitario: 1500, valorTotal: 7500, costoUnitario: 800, fecha: '2026-09-12T10:00:00.000Z', estado: 'anulado' },
  { id: 't4', productoId: 'p1', productoNombre: 'Cafe', cantidad: 1, valorUnitario: 1500, valorTotal: 1500, costoUnitario: '', fecha: '2026-09-13T10:00:00.000Z', estado: 'pendiente' }
];

test('reporteGanancia usa el costo guardado en la transaccion', () => {
  const reporte = reporteGanancia([TRANSACCIONES[0]], PRODUCTOS, '2026-09-01', '2026-09-30');
  assert.strictEqual(reporte.total, 1400);
  assert.strictEqual(reporte.estimado, false);
});

test('reporteGanancia ignora las anuladas', () => {
  const reporte = reporteGanancia(TRANSACCIONES, PRODUCTOS, '2026-09-12', '2026-09-12');
  assert.strictEqual(reporte.total, 0);
});

test('reporteGanancia cae al costo actual cuando la transaccion no lo guardo', () => {
  const reporte = reporteGanancia([TRANSACCIONES[3]], PRODUCTOS, '2026-09-01', '2026-09-30');
  assert.strictEqual(reporte.total, 600);
  assert.strictEqual(reporte.estimado, true);
});

test('reporteGanancia agrupa por producto', () => {
  const reporte = reporteGanancia(TRANSACCIONES, PRODUCTOS, '2026-09-01', '2026-09-30');
  assert.strictEqual(reporte.total, 2800);
  const cafe = reporte.porProducto.find(p => p.productoId === 'p1');
  assert.strictEqual(cafe.cantidad, 3);
  assert.strictEqual(cafe.ingresos, 4500);
  assert.strictEqual(cafe.ganancia, 2000);
});

test('reporteGanancia ordena de mayor a menor ganancia', () => {
  const reporte = reporteGanancia(TRANSACCIONES, PRODUCTOS, '2026-09-01', '2026-09-30');
  assert.deepStrictEqual(reporte.porProducto.map(p => p.productoId), ['p1', 'p2']);
});

test('reporteGanancia respeta el rango de fechas', () => {
  const reporte = reporteGanancia(TRANSACCIONES, PRODUCTOS, '2026-09-11', '2026-09-11');
  assert.strictEqual(reporte.total, 800);
});

const { reportePerdidas, reporteCartera, reporteGastosCompartidos } = require('../../src/dominio/reportes.js');

const PERDIDAS = [
  { id: 'pe1', productoNombre: 'Cafe', cantidad: 2, motivo: 'se vencio', valor: 1600, fecha: '2026-09-10T10:00:00.000Z', estado: 'pendiente' },
  { id: 'pe2', productoNombre: 'Galletas', cantidad: 1, motivo: 'se daño', valor: 1200, fecha: '2026-09-11T10:00:00.000Z', estado: 'pendiente' },
  { id: 'pe3', productoNombre: 'Cafe', cantidad: 5, motivo: 'error', valor: 4000, fecha: '2026-09-11T10:00:00.000Z', estado: 'anulado' }
];

test('reportePerdidas suma solo las no anuladas del rango', () => {
  const reporte = reportePerdidas(PERDIDAS, '2026-09-01', '2026-09-30');
  assert.strictEqual(reporte.total, 2800);
  assert.strictEqual(reporte.lineas.length, 2);
});

test('reportePerdidas respeta el rango de fechas', () => {
  assert.strictEqual(reportePerdidas(PERDIDAS, '2026-09-10', '2026-09-10').total, 1600);
});

const USUARIOS = [
  { id: 'u1', nombre: 'Ana', activo: true },
  { id: 'u2', nombre: 'Beto', activo: true },
  { id: 'u3', nombre: 'Inactivo', activo: false },
  { id: 'u4', nombre: 'Perdidas', activo: true, esPseudoUsuario: true }
];

test('reporteCartera suma el saldo de cada usuario activo', () => {
  const movimientos = {
    transacciones: [
      { id: 't1', usuarioId: 'u1', productoNombre: 'Cafe', cantidad: 1, valorTotal: 3000, fecha: '2026-09-10T10:00:00.000Z', estado: 'pendiente' },
      { id: 't2', usuarioId: 'u2', productoNombre: 'Cafe', cantidad: 1, valorTotal: 1500, fecha: '2026-09-10T10:00:00.000Z', estado: 'pendiente' }
    ],
    prestamos: [], gastos: [], pagos: []
  };
  const reporte = reporteCartera(movimientos, USUARIOS);
  assert.strictEqual(reporte.total, 4500);
  assert.deepStrictEqual(reporte.porUsuario.map(u => u.nombre), ['Ana', 'Beto']);
  assert.strictEqual(reporte.porUsuario[0].saldo, 3000);
});

test('reporteCartera omite a quien no debe nada', () => {
  const movimientos = { transacciones: [], prestamos: [], gastos: [], pagos: [] };
  assert.deepStrictEqual(reporteCartera(movimientos, USUARIOS).porUsuario, []);
});

test('reporteCartera excluye a los pseudo-usuarios aunque tengan movimientos', () => {
  const movimientos = {
    transacciones: [
      { id: 't1', usuarioId: 'u4', productoNombre: 'Cafe', cantidad: 1, valorTotal: 3000, fecha: '2026-09-10T10:00:00.000Z', estado: 'pendiente' }
    ],
    prestamos: [], gastos: [], pagos: []
  };
  const reporte = reporteCartera(movimientos, USUARIOS);
  assert.deepStrictEqual(reporte.porUsuario, []);
  assert.strictEqual(reporte.total, 0);
});

const GASTOS_REPORTE = [
  { id: 'g1', motivo: 'cumpleanos', descripcion: 'Ana', valorTotal: 30000, participantes: 'u1,u2,u3', fecha: '2026-09-13T10:00:00.000Z', estado: 'pendiente' },
  { id: 'g2', motivo: 'cumpleanos', descripcion: 'Beto', valorTotal: 20000, participantes: 'u1,u2', fecha: '2026-09-01T10:00:00.000Z', estado: 'pendiente' },
  { id: 'g3', motivo: 'bienvenida', descripcion: 'Pedro', valorTotal: 12000, participantes: 'u1,u2', fecha: '2026-09-05T10:00:00.000Z', estado: 'pendiente' },
  { id: 'g4', motivo: 'otro', descripcion: 'Anulado', valorTotal: 5000, participantes: 'u1', fecha: '2026-09-06T10:00:00.000Z', estado: 'anulado' }
];

test('reporteGastosCompartidos agrupa por motivo', () => {
  const grupos = reporteGastosCompartidos(GASTOS_REPORTE);
  assert.deepStrictEqual(grupos.map(g => g.motivo), ['cumpleanos', 'bienvenida']);
  assert.strictEqual(grupos[0].cantidad, 2);
  assert.strictEqual(grupos[0].total, 50000);
});

test('reporteGastosCompartidos detalla el valor por persona', () => {
  const grupos = reporteGastosCompartidos(GASTOS_REPORTE);
  const cumple = grupos[0].gastos.find(g => g.id === 'g1');
  assert.strictEqual(cumple.participantes, 3);
  assert.strictEqual(cumple.valorPorPersona, 10000);
});

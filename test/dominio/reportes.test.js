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

const test = require('node:test');
const assert = require('node:assert');
const { reporteGanancia, reporteInventario } = require('../../src/dominio/reportes.js');

const PRODUCTOS = [
  { id: 'p1', nombre: 'Cafe', costo: 900, precioVenta: 1500 },
  { id: 'p2', nombre: 'Galletas', costo: 1200, precioVenta: 2000 }
];

const TRANSACCIONES = [
  { id: 't1', usuarioId: 'u1', productoId: 'p1', productoNombre: 'Cafe', cantidad: 2, valorUnitario: 1500, valorTotal: 3000, costoUnitario: 800, fecha: '2026-09-10T10:00:00.000Z', estado: 'pendiente' },
  { id: 't2', usuarioId: 'u2', productoId: 'p2', productoNombre: 'Galletas', cantidad: 1, valorUnitario: 2000, valorTotal: 2000, costoUnitario: 1200, fecha: '2026-09-11T10:00:00.000Z', estado: 'pagado' },
  { id: 't3', usuarioId: 'u1', productoId: 'p1', productoNombre: 'Cafe', cantidad: 5, valorUnitario: 1500, valorTotal: 7500, costoUnitario: 800, fecha: '2026-09-12T10:00:00.000Z', estado: 'anulado' },
  { id: 't4', usuarioId: 'u2', productoId: 'p1', productoNombre: 'Cafe', cantidad: 1, valorUnitario: 1500, valorTotal: 1500, costoUnitario: '', fecha: '2026-09-13T10:00:00.000Z', estado: 'pendiente' }
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

test('reporteGanancia filtra por usuarioId cuando se pasa', () => {
  const reporte = reporteGanancia(TRANSACCIONES, PRODUCTOS, '2026-09-01', '2026-09-30', 'u1');
  assert.strictEqual(reporte.total, 1400);
  assert.deepStrictEqual(reporte.porProducto.map(p => p.productoId), ['p1']);
});

test('reporteGanancia sin usuarioId incluye a todos los usuarios', () => {
  const reporte = reporteGanancia(TRANSACCIONES, PRODUCTOS, '2026-09-01', '2026-09-30');
  assert.strictEqual(reporte.total, 2800);
});

const { reportePerdidas, reporteCartera, reporteGastosCompartidos, reporteComprasPorProducto } = require('../../src/dominio/reportes.js');

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

test('reporteCartera filtra por usuarioId cuando se pasa', () => {
  const movimientos = {
    transacciones: [
      { id: 't1', usuarioId: 'u1', productoNombre: 'Cafe', cantidad: 1, valorTotal: 3000, fecha: '2026-09-10T10:00:00.000Z', estado: 'pendiente' },
      { id: 't2', usuarioId: 'u2', productoNombre: 'Cafe', cantidad: 1, valorTotal: 1500, fecha: '2026-09-10T10:00:00.000Z', estado: 'pendiente' }
    ],
    prestamos: [], gastos: [], pagos: []
  };
  const reporte = reporteCartera(movimientos, USUARIOS, 'u2');
  assert.deepStrictEqual(reporte.porUsuario.map(u => u.nombre), ['Beto']);
  assert.strictEqual(reporte.total, 1500);
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

test('reporteGastosCompartidos incluye el producto cuando el gasto lo tiene', () => {
  const conProducto = GASTOS_REPORTE.map(function (g) {
    return g.id === 'g1' ? Object.assign({}, g, { productoNombre: 'Gaseosa', cantidad: 3 }) : g;
  });
  const grupos = reporteGastosCompartidos(conProducto);
  const cumple = grupos[0].gastos.find(g => g.id === 'g1');
  assert.strictEqual(cumple.productoNombre, 'Gaseosa');
  assert.strictEqual(cumple.cantidad, 3);
  const otro = grupos[1].gastos[0];
  assert.strictEqual(otro.productoNombre, '');
});

test('reporteInventario agrupa los lotes activos por producto, del mas viejo al mas nuevo', () => {
  const productos = [
    { id: 'p1', nombre: 'Quatro', activo: true },
    { id: 'p2', nombre: 'Cafe', activo: true }
  ];
  const lotes = [
    { id: 'l2', productoId: 'p1', fecha: '2026-09-20T10:00:00.000Z', cantidadInicial: 6, cantidadRestante: 6, costoUnitario: 3000, estado: 'activo' },
    { id: 'l1', productoId: 'p1', fecha: '2026-09-01T10:00:00.000Z', cantidadInicial: 3, cantidadRestante: 1, costoUnitario: 2925, estado: 'activo' },
    { id: 'l3', productoId: 'p2', fecha: '2026-09-05T10:00:00.000Z', cantidadInicial: 10, cantidadRestante: 4, costoUnitario: 800, estado: 'activo' }
  ];
  const reporte = reporteInventario(lotes, productos);

  assert.strictEqual(reporte.valorTotal, 24125);

  const quatro = reporte.porProducto[0];
  assert.strictEqual(quatro.nombre, 'Quatro');
  assert.strictEqual(quatro.cantidadTotal, 7);
  assert.strictEqual(quatro.valorTotal, 20925);
  assert.strictEqual(quatro.lotes[0].costoUnitario, 2925);
  assert.strictEqual(quatro.lotes[0].valor, 2925);
  assert.strictEqual(quatro.lotes[1].costoUnitario, 3000);

  const cafe = reporte.porProducto[1];
  assert.strictEqual(cafe.nombre, 'Cafe');
  assert.strictEqual(cafe.cantidadTotal, 4);
  assert.strictEqual(cafe.valorTotal, 3200);
});

test('reporteInventario ignora lotes anulados o agotados', () => {
  const productos = [{ id: 'p1', nombre: 'Quatro', activo: true }];
  const lotes = [
    { id: 'l1', productoId: 'p1', fecha: '2026-09-01T10:00:00.000Z', cantidadInicial: 3, cantidadRestante: 0, costoUnitario: 2925, estado: 'activo' },
    { id: 'l2', productoId: 'p1', fecha: '2026-09-02T10:00:00.000Z', cantidadInicial: 3, cantidadRestante: 3, costoUnitario: 2925, estado: 'anulado' }
  ];
  const reporte = reporteInventario(lotes, productos);
  assert.strictEqual(reporte.valorTotal, 0);
  assert.deepStrictEqual(reporte.porProducto, []);
});

test('reporteInventario no lista productos sin lotes', () => {
  const productos = [{ id: 'p1', nombre: 'Quatro', activo: true }];
  const reporte = reporteInventario([], productos);
  assert.strictEqual(reporte.valorTotal, 0);
  assert.deepStrictEqual(reporte.porProducto, []);
});

test('reporteComprasPorProducto agrupa por usuario, ignorando anuladas', () => {
  const reporte = reporteComprasPorProducto(TRANSACCIONES, USUARIOS, 'p1', '2026-09-01', '2026-09-30');
  assert.strictEqual(reporte.total.cantidad, 3);
  assert.strictEqual(reporte.total.valor, 4500);
  assert.deepStrictEqual(reporte.porUsuario.map(u => u.nombre), ['Ana', 'Beto']);
  assert.strictEqual(reporte.porUsuario[0].cantidad, 2);
  assert.strictEqual(reporte.porUsuario[0].valor, 3000);
});

test('reporteComprasPorProducto respeta el rango de fechas', () => {
  const reporte = reporteComprasPorProducto(TRANSACCIONES, USUARIOS, 'p1', '2026-09-13', '2026-09-13');
  assert.deepStrictEqual(reporte.porUsuario.map(u => u.nombre), ['Beto']);
  assert.strictEqual(reporte.total.cantidad, 1);
});

test('reporteComprasPorProducto ordena de mayor a menor cantidad', () => {
  const reporte = reporteComprasPorProducto(TRANSACCIONES, USUARIOS, 'p1', '2026-09-01', '2026-09-30');
  assert.deepStrictEqual(reporte.porUsuario.map(u => u.usuarioId), ['u1', 'u2']);
});

test('reporteComprasPorProducto sin productoId devuelve vacio', () => {
  const reporte = reporteComprasPorProducto(TRANSACCIONES, USUARIOS, '', '2026-09-01', '2026-09-30');
  assert.deepStrictEqual(reporte.porUsuario, []);
  assert.strictEqual(reporte.total.cantidad, 0);
});

test('reporteComprasPorProducto usa el id cuando no encuentra el nombre del usuario', () => {
  const transacciones = [{ id: 't9', usuarioId: 'ux', productoId: 'p1', cantidad: 1, valorTotal: 1500, fecha: '2026-09-10T10:00:00.000Z', estado: 'pendiente' }];
  const reporte = reporteComprasPorProducto(transacciones, USUARIOS, 'p1', '2026-09-01', '2026-09-30');
  assert.strictEqual(reporte.porUsuario[0].nombre, 'ux');
});

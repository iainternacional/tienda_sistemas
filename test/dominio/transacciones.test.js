const test = require('node:test');
const assert = require('node:assert');
const { crearTransaccionFiado, anularTransaccion, esActiva } = require('../../src/dominio/transacciones.js');

const PRODUCTO = {
  id: 'p1', nombre: 'Cafe', categoria: 'Bebidas',
  costo: 800, precioVenta: 1500, stockActual: 10, activo: true
};

function datosBase(cambios) {
  return Object.assign({
    id: 't1',
    usuarioId: 'u1',
    producto: PRODUCTO,
    cantidad: 2,
    fecha: '2026-09-12T10:00:00.000Z',
    origen: 'autoregistro'
  }, cambios || {});
}

test('crearTransaccionFiado arma la transaccion con el precio de venta del producto', () => {
  const transaccion = crearTransaccionFiado(datosBase());
  assert.strictEqual(transaccion.id, 't1');
  assert.strictEqual(transaccion.usuarioId, 'u1');
  assert.strictEqual(transaccion.productoId, 'p1');
  assert.strictEqual(transaccion.productoNombre, 'Cafe');
  assert.strictEqual(transaccion.cantidad, 2);
  assert.strictEqual(transaccion.valorUnitario, 1500);
  assert.strictEqual(transaccion.valorTotal, 3000);
  assert.strictEqual(transaccion.estado, 'pendiente');
  assert.strictEqual(transaccion.origen, 'autoregistro');
});

test('crearTransaccionFiado acepta origen admin', () => {
  assert.strictEqual(crearTransaccionFiado(datosBase({ origen: 'admin' })).origen, 'admin');
});

test('crearTransaccionFiado rechaza un origen desconocido', () => {
  assert.throws(() => crearTransaccionFiado(datosBase({ origen: 'otro' })), /origen/i);
});

test('crearTransaccionFiado rechaza cantidad invalida antes de mirar el stock', () => {
  assert.throws(() => crearTransaccionFiado(datosBase({ cantidad: 0 })), /cantidad/i);
});

test('crearTransaccionFiado rechaza cuando no alcanza el stock', () => {
  const producto = Object.assign({}, PRODUCTO, { stockActual: 1 });
  assert.throws(() => crearTransaccionFiado(datosBase({ producto: producto, cantidad: 2 })), /stock insuficiente/i);
});

test('crearTransaccionFiado exige usuario', () => {
  assert.throws(() => crearTransaccionFiado(datosBase({ usuarioId: '' })), /usuario/i);
});

test('esActiva distingue las anuladas', () => {
  assert.strictEqual(esActiva({ estado: 'pendiente' }), true);
  assert.strictEqual(esActiva({ estado: 'pagado' }), true);
  assert.strictEqual(esActiva({ estado: 'anulado' }), false);
});

test('anularTransaccion marca el registro conservando el original', () => {
  const original = crearTransaccionFiado(datosBase());
  const anulada = anularTransaccion(original, {
    anuladoPor: 'admin@ipuc.org.co',
    anuladoFecha: '2026-09-13T08:00:00.000Z',
    anuladoMotivo: 'Se lo cargue a la persona equivocada'
  });
  assert.strictEqual(anulada.estado, 'anulado');
  assert.strictEqual(anulada.anuladoPor, 'admin@ipuc.org.co');
  assert.strictEqual(anulada.anuladoMotivo, 'Se lo cargue a la persona equivocada');
  assert.strictEqual(anulada.valorTotal, 3000);
  assert.strictEqual(original.estado, 'pendiente');
});

test('anularTransaccion exige motivo', () => {
  const original = crearTransaccionFiado(datosBase());
  assert.throws(() => anularTransaccion(original, {
    anuladoPor: 'admin@ipuc.org.co', anuladoFecha: '2026-09-13T08:00:00.000Z', anuladoMotivo: '  '
  }), /motivo/i);
});

test('anularTransaccion rechaza anular dos veces', () => {
  const anulada = anularTransaccion(crearTransaccionFiado(datosBase()), {
    anuladoPor: 'admin@ipuc.org.co', anuladoFecha: '2026-09-13T08:00:00.000Z', anuladoMotivo: 'error'
  });
  assert.throws(() => anularTransaccion(anulada, {
    anuladoPor: 'admin@ipuc.org.co', anuladoFecha: '2026-09-14T08:00:00.000Z', anuladoMotivo: 'otra vez'
  }), /ya esta anulad/i);
});

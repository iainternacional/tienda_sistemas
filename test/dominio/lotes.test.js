const test = require('node:test');
const assert = require('node:assert');
const {
  crearLote,
  consumirDeLotes,
  devolverALotes,
  puedeAnularseLote,
  precioVigente,
  fijarPrecioEnLotesSinPrecio,
  asignarPrecioALotesConStock
} = require('../../src/dominio/lotes.js');

function lote(cambios) {
  return Object.assign({
    id: 'l1', productoId: 'p1', fecha: '2026-09-01T10:00:00.000Z',
    cantidadInicial: 3, cantidadRestante: 3, costoUnitario: 2925,
    estado: 'activo', anuladoPor: '', anuladoFecha: '', anuladoMotivo: ''
  }, cambios || {});
}

test('crearLote arranca con cantidadRestante igual a la cantidad comprada', () => {
  const nuevo = crearLote({
    id: 'l9', productoId: 'p1', fecha: '2026-09-21T10:00:00.000Z',
    cantidad: 6, costoUnitario: 3000
  });
  assert.strictEqual(nuevo.cantidadInicial, 6);
  assert.strictEqual(nuevo.cantidadRestante, 6);
  assert.strictEqual(nuevo.costoUnitario, 3000);
  assert.strictEqual(nuevo.estado, 'activo');
  assert.strictEqual(nuevo.anuladoMotivo, '');
});

test('crearLote rechaza cantidad o costo invalidos', () => {
  const base = { id: 'l9', productoId: 'p1', fecha: '2026-09-21T10:00:00.000Z', cantidad: 6, costoUnitario: 3000 };
  assert.throws(() => crearLote(Object.assign({}, base, { cantidad: 0 })), /cantidad/i);
  assert.throws(() => crearLote(Object.assign({}, base, { costoUnitario: 0 })), /costo/i);
  assert.throws(() => crearLote(Object.assign({}, base, { id: '' })), /id/i);
});

test('consumirDeLotes toma del lote mas antiguo primero', () => {
  const lotes = [
    lote({ id: 'nuevo', fecha: '2026-09-20T10:00:00.000Z', cantidadInicial: 6, cantidadRestante: 6, costoUnitario: 3000 }),
    lote({ id: 'viejo', fecha: '2026-09-01T10:00:00.000Z', cantidadInicial: 3, cantidadRestante: 3, costoUnitario: 2925 })
  ];
  const resultado = consumirDeLotes(lotes, 'p1', 2, 'Quatro');
  assert.deepStrictEqual(resultado.consumos, [{ loteId: 'viejo', cantidad: 2, costoUnitario: 2925, precioVenta: 0 }]);
  assert.strictEqual(resultado.costoTotal, 5850);
  assert.strictEqual(resultado.costoUnitarioPromedio, 2925);
  assert.strictEqual(resultado.lotesActualizados.length, 1);
  assert.strictEqual(resultado.lotesActualizados[0].id, 'viejo');
  assert.strictEqual(resultado.lotesActualizados[0].cantidadRestante, 1);
});

test('consumirDeLotes cruza al siguiente lote cuando el mas viejo no alcanza', () => {
  const lotes = [
    lote({ id: 'viejo', fecha: '2026-09-01T10:00:00.000Z', cantidadInicial: 3, cantidadRestante: 2, costoUnitario: 2925 }),
    lote({ id: 'nuevo', fecha: '2026-09-20T10:00:00.000Z', cantidadInicial: 6, cantidadRestante: 6, costoUnitario: 3000 })
  ];
  const resultado = consumirDeLotes(lotes, 'p1', 5, 'Quatro');
  assert.deepStrictEqual(resultado.consumos, [
    { loteId: 'viejo', cantidad: 2, costoUnitario: 2925, precioVenta: 0 },
    { loteId: 'nuevo', cantidad: 3, costoUnitario: 3000, precioVenta: 0 }
  ]);
  assert.strictEqual(resultado.costoTotal, 14850);
  assert.strictEqual(resultado.costoUnitarioPromedio, 2970);
  assert.strictEqual(resultado.lotesActualizados[0].cantidadRestante, 0);
  assert.strictEqual(resultado.lotesActualizados[1].cantidadRestante, 3);
});

test('consumirDeLotes redondea el costo unitario promedio a entero', () => {
  const lotes = [
    lote({ id: 'a', fecha: '2026-09-01T10:00:00.000Z', cantidadInicial: 1, cantidadRestante: 1, costoUnitario: 1000 }),
    lote({ id: 'b', fecha: '2026-09-02T10:00:00.000Z', cantidadInicial: 2, cantidadRestante: 2, costoUnitario: 1001 })
  ];
  const resultado = consumirDeLotes(lotes, 'p1', 3, 'Cafe');
  assert.strictEqual(resultado.costoTotal, 3002);
  assert.strictEqual(resultado.costoUnitarioPromedio, 1001);
  assert.ok(Number.isInteger(resultado.costoUnitarioPromedio));
});

test('consumirDeLotes ignora lotes de otro producto, anulados o agotados', () => {
  const lotes = [
    lote({ id: 'otroProducto', productoId: 'p2', fecha: '2026-09-01T10:00:00.000Z' }),
    lote({ id: 'anulado', fecha: '2026-09-02T10:00:00.000Z', estado: 'anulado' }),
    lote({ id: 'agotado', fecha: '2026-09-03T10:00:00.000Z', cantidadRestante: 0 }),
    lote({ id: 'bueno', fecha: '2026-09-04T10:00:00.000Z', cantidadInicial: 5, cantidadRestante: 5, costoUnitario: 1000 })
  ];
  const resultado = consumirDeLotes(lotes, 'p1', 2, 'Cafe');
  assert.deepStrictEqual(resultado.consumos, [{ loteId: 'bueno', cantidad: 2, costoUnitario: 1000, precioVenta: 0 }]);
});

test('consumirDeLotes rechaza sin tocar nada cuando no alcanza el stock', () => {
  const lotes = [lote({ cantidadInicial: 3, cantidadRestante: 3 })];
  assert.throws(() => consumirDeLotes(lotes, 'p1', 4, 'Quatro'), /stock insuficiente para quatro/i);
  assert.strictEqual(lotes[0].cantidadRestante, 3);
});

test('consumirDeLotes rechaza cantidad invalida', () => {
  const lotes = [lote()];
  assert.throws(() => consumirDeLotes(lotes, 'p1', 0, 'Quatro'), /cantidad/i);
});

test('consumirDeLotes no muta los lotes originales', () => {
  const original = lote({ cantidadInicial: 5, cantidadRestante: 5 });
  consumirDeLotes([original], 'p1', 2, 'Cafe');
  assert.strictEqual(original.cantidadRestante, 5);
});

test('devolverALotes suma de vuelta a los lotes de origen', () => {
  const lotes = [
    lote({ id: 'viejo', cantidadInicial: 3, cantidadRestante: 0 }),
    lote({ id: 'nuevo', cantidadInicial: 6, cantidadRestante: 3 })
  ];
  const devueltos = devolverALotes(lotes, [
    { loteId: 'viejo', cantidad: 2 },
    { loteId: 'nuevo', cantidad: 3 }
  ]);
  assert.strictEqual(devueltos.length, 2);
  assert.strictEqual(devueltos[0].cantidadRestante, 2);
  assert.strictEqual(devueltos[1].cantidadRestante, 6);
});

test('devolverALotes solo devuelve los lotes tocados', () => {
  const lotes = [lote({ id: 'a', cantidadRestante: 1 }), lote({ id: 'b', cantidadRestante: 1 })];
  const devueltos = devolverALotes(lotes, [{ loteId: 'b', cantidad: 2 }]);
  assert.strictEqual(devueltos.length, 1);
  assert.strictEqual(devueltos[0].id, 'b');
  assert.strictEqual(devueltos[0].cantidadRestante, 3);
});

test('devolverALotes ignora un lote que ya no existe', () => {
  const devueltos = devolverALotes([lote({ id: 'a' })], [{ loteId: 'fantasma', cantidad: 2 }]);
  assert.deepStrictEqual(devueltos, []);
});

test('devolverALotes no muta los lotes originales', () => {
  const original = lote({ id: 'a', cantidadRestante: 1 });
  devolverALotes([original], [{ loteId: 'a', cantidad: 2 }]);
  assert.strictEqual(original.cantidadRestante, 1);
});

test('puedeAnularseLote solo acepta lotes intactos', () => {
  assert.strictEqual(puedeAnularseLote(lote({ cantidadInicial: 3, cantidadRestante: 3 })), true);
  assert.strictEqual(puedeAnularseLote(lote({ cantidadInicial: 3, cantidadRestante: 2 })), false);
  assert.strictEqual(puedeAnularseLote(lote({ cantidadInicial: 3, cantidadRestante: 0 })), false);
});

test('crearLote guarda el precio de venta del lote', () => {
  const base = { id: 'l9', productoId: 'p1', fecha: '2026-10-09T10:00:00.000Z', cantidad: 6, costoUnitario: 3000 };
  assert.strictEqual(crearLote(Object.assign({}, base, { precioVenta: 3500 })).precioVenta, 3500);
  assert.strictEqual(crearLote(base).precioVenta, '');
  assert.throws(() => crearLote(Object.assign({}, base, { precioVenta: 0 })), /precio/i);
  assert.throws(() => crearLote(Object.assign({}, base, { precioVenta: 10.5 })), /precio/i);
});

test('consumirDeLotes cobra cada tramo al precio de su lote', () => {
  const lotes = [
    lote({ id: 'viejo', fecha: '2026-09-01T10:00:00.000Z', cantidadInicial: 3, cantidadRestante: 2, costoUnitario: 2000, precioVenta: 3000 }),
    lote({ id: 'nuevo', fecha: '2026-10-01T10:00:00.000Z', cantidadInicial: 6, cantidadRestante: 6, costoUnitario: 2500, precioVenta: 3500 })
  ];
  const resultado = consumirDeLotes(lotes, 'p1', 3, 'Cocacola', 3500);
  assert.deepStrictEqual(resultado.consumos, [
    { loteId: 'viejo', cantidad: 2, costoUnitario: 2000, precioVenta: 3000 },
    { loteId: 'nuevo', cantidad: 1, costoUnitario: 2500, precioVenta: 3500 }
  ]);
  assert.strictEqual(resultado.valorTotal, 9500);
});

test('consumirDeLotes usa el precio por defecto en lotes sin precio propio', () => {
  const lotes = [lote({ cantidadInicial: 3, cantidadRestante: 3, precioVenta: '' })];
  const resultado = consumirDeLotes(lotes, 'p1', 2, 'Cocacola', 3000);
  assert.strictEqual(resultado.consumos[0].precioVenta, 3000);
  assert.strictEqual(resultado.valorTotal, 6000);
});

test('precioVigente es el precio del lote que se vende primero', () => {
  const lotes = [
    lote({ id: 'nuevo', fecha: '2026-10-01T10:00:00.000Z', precioVenta: 3500 }),
    lote({ id: 'viejo', fecha: '2026-09-01T10:00:00.000Z', precioVenta: 3000 })
  ];
  assert.strictEqual(precioVigente(lotes, 'p1', 3500), 3000);
});

test('precioVigente pasa al lote siguiente cuando el viejo se agota', () => {
  const lotes = [
    lote({ id: 'viejo', fecha: '2026-09-01T10:00:00.000Z', cantidadRestante: 0, precioVenta: 3000 }),
    lote({ id: 'nuevo', fecha: '2026-10-01T10:00:00.000Z', precioVenta: 3500 })
  ];
  assert.strictEqual(precioVigente(lotes, 'p1', 3500), 3500);
});

test('precioVigente sin lotes con stock devuelve el precio del producto', () => {
  assert.strictEqual(precioVigente([], 'p1', 3200), 3200);
  assert.strictEqual(precioVigente([lote({ precioVenta: '' })], 'p1', 3200), 3200);
});

test('fijarPrecioEnLotesSinPrecio solo toca lotes con stock y sin precio', () => {
  const lotes = [
    lote({ id: 'sinPrecio', precioVenta: '' }),
    lote({ id: 'conPrecio', precioVenta: 2800 }),
    lote({ id: 'agotado', cantidadRestante: 0, precioVenta: '' }),
    lote({ id: 'otro', productoId: 'p2', precioVenta: '' })
  ];
  const fijados = fijarPrecioEnLotesSinPrecio(lotes, 'p1', 3000);
  assert.strictEqual(fijados.length, 1);
  assert.strictEqual(fijados[0].id, 'sinPrecio');
  assert.strictEqual(fijados[0].precioVenta, 3000);
  assert.strictEqual(lotes[0].precioVenta, '');
});

test('asignarPrecioALotesConStock cambia el precio de todo el inventario restante', () => {
  const lotes = [
    lote({ id: 'viejo', fecha: '2026-09-01T10:00:00.000Z', precioVenta: 3000 }),
    lote({ id: 'nuevo', fecha: '2026-10-01T10:00:00.000Z', precioVenta: 3500 }),
    lote({ id: 'igual', fecha: '2026-10-02T10:00:00.000Z', precioVenta: 4000 }),
    lote({ id: 'agotado', cantidadRestante: 0, precioVenta: 3000 })
  ];
  const cambiados = asignarPrecioALotesConStock(lotes, 'p1', 4000);
  assert.deepStrictEqual(cambiados.map(function (l) { return l.id; }), ['viejo', 'nuevo']);
  assert.ok(cambiados.every(function (l) { return l.precioVenta === 4000; }));
});

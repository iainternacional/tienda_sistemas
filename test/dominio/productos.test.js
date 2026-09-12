const test = require('node:test');
const assert = require('node:assert');
const {
  normalizarNombre,
  validarProductoNuevo,
  buscarProductoPorNombre,
  hayStockSuficiente,
  descontarStock
} = require('../../src/dominio/productos.js');

function productoDePrueba(cambios) {
  return Object.assign({
    id: 'p1',
    nombre: 'Cafe',
    categoria: 'Bebidas',
    costo: 800,
    precioVenta: 1500,
    stockActual: 10,
    activo: true
  }, cambios || {});
}

test('normalizarNombre quita tildes, espacios sobrantes y mayusculas', () => {
  assert.strictEqual(normalizarNombre('  Café  con   Leche '), 'cafe con leche');
});

test('validarProductoNuevo acepta un producto completo', () => {
  const resultado = validarProductoNuevo({
    nombre: 'Cafe', categoria: 'Bebidas', costo: 800, precioVenta: 1500, stockActual: 10
  });
  assert.deepStrictEqual(resultado, { valido: true, errores: [] });
});

test('validarProductoNuevo acepta stock inicial en cero', () => {
  const resultado = validarProductoNuevo({
    nombre: 'Cafe', categoria: 'Bebidas', costo: 800, precioVenta: 1500, stockActual: 0
  });
  assert.strictEqual(resultado.valido, true);
});

test('validarProductoNuevo reporta cada campo invalido', () => {
  const resultado = validarProductoNuevo({
    nombre: '   ', categoria: 'Bebidas', costo: 0, precioVenta: -1, stockActual: -5
  });
  assert.strictEqual(resultado.valido, false);
  assert.strictEqual(resultado.errores.length, 4);
});

test('buscarProductoPorNombre encuentra ignorando tildes y mayusculas', () => {
  const productos = [productoDePrueba({ id: 'p1', nombre: 'Café' })];
  assert.strictEqual(buscarProductoPorNombre(productos, 'CAFE').id, 'p1');
});

test('buscarProductoPorNombre devuelve null cuando no hay coincidencia', () => {
  assert.strictEqual(buscarProductoPorNombre([productoDePrueba()], 'Galletas'), null);
});

test('hayStockSuficiente compara contra el stock actual', () => {
  assert.strictEqual(hayStockSuficiente(productoDePrueba({ stockActual: 3 }), 3), true);
  assert.strictEqual(hayStockSuficiente(productoDePrueba({ stockActual: 3 }), 4), false);
});

test('descontarStock devuelve una copia con el stock reducido sin mutar el original', () => {
  const original = productoDePrueba({ stockActual: 10 });
  const resultado = descontarStock(original, 3);
  assert.strictEqual(resultado.stockActual, 7);
  assert.strictEqual(original.stockActual, 10);
});

test('descontarStock rechaza cantidades mayores al stock', () => {
  assert.throws(() => descontarStock(productoDePrueba({ stockActual: 2 }), 3), /stock insuficiente/i);
});

test('descontarStock rechaza cantidades invalidas', () => {
  assert.throws(() => descontarStock(productoDePrueba(), 0), /cantidad/i);
});

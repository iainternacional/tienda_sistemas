const test = require('node:test');
const assert = require('node:assert');
const { ESQUEMA, filaAObjeto, objetoAFila } = require('../../src/datos/esquema.js');
const { inicializarLibro, leerTodo, agregarFila, actualizarPorId } = require('../../src/datos/hoja.js');
const { crearLibroFalso } = require('../ayudas/libroFalso.js');

test('el esquema define una hoja por entidad', () => {
  assert.deepStrictEqual(Object.keys(ESQUEMA).sort(), [
    'GastosCompartidos', 'Pagos', 'Perdidas', 'Prestamos', 'Productos', 'Transacciones', 'Usuarios'
  ]);
  assert.strictEqual(ESQUEMA.Productos[0], 'id');
});

test('filaAObjeto convierte una fila usando los nombres de columna', () => {
  const objeto = filaAObjeto(['id', 'nombre'], ['p1', 'Cafe']);
  assert.deepStrictEqual(objeto, { id: 'p1', nombre: 'Cafe' });
});

test('objetoAFila respeta el orden de columnas y rellena faltantes con cadena vacia', () => {
  const fila = objetoAFila(['id', 'nombre', 'categoria'], { nombre: 'Cafe', id: 'p1' });
  assert.deepStrictEqual(fila, ['p1', 'Cafe', '']);
});

test('inicializarLibro crea las hojas faltantes con sus encabezados', () => {
  const libro = crearLibroFalso({});
  inicializarLibro(libro);
  assert.deepStrictEqual(libro.hojas.Productos.contenido[0], ESQUEMA.Productos);
  assert.deepStrictEqual(libro.hojas.Usuarios.contenido[0], ESQUEMA.Usuarios);
});

test('leerTodo devuelve lista vacia cuando la hoja solo tiene encabezados', () => {
  const libro = crearLibroFalso({ Productos: [ESQUEMA.Productos] });
  assert.deepStrictEqual(leerTodo(libro, 'Productos'), []);
});

test('agregarFila y leerTodo hacen ida y vuelta del objeto', () => {
  const libro = crearLibroFalso({ Productos: [ESQUEMA.Productos] });
  agregarFila(libro, 'Productos', {
    id: 'p1',
    nombre: 'Cafe',
    categoria: 'Bebidas',
    costo: 800,
    precioVenta: 1500,
    stockActual: 10,
    activo: true
  });
  const productos = leerTodo(libro, 'Productos');
  assert.strictEqual(productos.length, 1);
  assert.strictEqual(productos[0].nombre, 'Cafe');
  assert.strictEqual(productos[0].precioVenta, 1500);
});

test('actualizarPorId modifica solo las columnas indicadas', () => {
  const libro = crearLibroFalso({ Productos: [ESQUEMA.Productos] });
  agregarFila(libro, 'Productos', {
    id: 'p1', nombre: 'Cafe', categoria: 'Bebidas',
    costo: 800, precioVenta: 1500, stockActual: 10, activo: true
  });
  const resultado = actualizarPorId(libro, 'Productos', 'p1', { stockActual: 7 });
  assert.strictEqual(resultado, true);
  const productos = leerTodo(libro, 'Productos');
  assert.strictEqual(productos[0].stockActual, 7);
  assert.strictEqual(productos[0].nombre, 'Cafe');
});

test('actualizarPorId devuelve false cuando el id no existe', () => {
  const libro = crearLibroFalso({ Productos: [ESQUEMA.Productos] });
  assert.strictEqual(actualizarPorId(libro, 'Productos', 'inexistente', { stockActual: 1 }), false);
});

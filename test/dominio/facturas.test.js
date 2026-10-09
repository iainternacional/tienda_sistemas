const test = require('node:test');
const assert = require('node:assert');
const {
  sanearLineas, emparejarLineas, parsearRespuestaGemini,
  validarLineasParaConfirmar, crearIngresoInventario
} = require('../../src/dominio/facturas.js');

test('sanearLineas descarta lineas sin nombre, con cantidad o costo invalidos', () => {
  const crudas = [
    { nombre: 'Cafe', cantidad: 20, costoUnitario: 800 },
    { nombre: '  ', cantidad: 5, costoUnitario: 100 },
    { nombre: 'Te', cantidad: -1, costoUnitario: 100 },
    { nombre: 'Azucar', cantidad: 5, costoUnitario: 0 },
    { nombre: 'Sal', cantidad: 2.5, costoUnitario: 100 }
  ];
  const saneadas = sanearLineas(crudas);
  assert.strictEqual(saneadas.length, 1);
  assert.strictEqual(saneadas[0].nombre, 'Cafe');
  assert.strictEqual(saneadas[0].cantidad, 20);
  assert.strictEqual(saneadas[0].costoUnitario, 800);
});

test('sanearLineas recorta el nombre y devuelve arreglo vacio si no es arreglo', () => {
  assert.deepStrictEqual(sanearLineas('no es arreglo'), []);
  const saneadas = sanearLineas([{ nombre: '  Cafe  ', cantidad: 1, costoUnitario: 100 }]);
  assert.strictEqual(saneadas[0].nombre, 'Cafe');
});

const PRODUCTOS = [
  { id: 'p1', nombre: 'Cafe', alias: '', activo: true },
  { id: 'p2', nombre: 'Refresco', alias: 'gaseosa', activo: true }
];

test('emparejarLineas encuentra por nombre normalizado', () => {
  const [linea] = emparejarLineas([{ nombre: 'cafe', cantidad: 1, costoUnitario: 100 }], PRODUCTOS);
  assert.strictEqual(linea.productoId, 'p1');
  assert.strictEqual(linea.esNuevo, false);
});

test('emparejarLineas encuentra por alias normalizado', () => {
  const [linea] = emparejarLineas([{ nombre: 'Gaseosa', cantidad: 1, costoUnitario: 100 }], PRODUCTOS);
  assert.strictEqual(linea.productoId, 'p2');
  assert.strictEqual(linea.esNuevo, false);
});

test('emparejarLineas marca esNuevo cuando no hay coincidencia', () => {
  const [linea] = emparejarLineas([{ nombre: 'Chocolatina', cantidad: 1, costoUnitario: 100 }], PRODUCTOS);
  assert.strictEqual(linea.productoId, '');
  assert.strictEqual(linea.esNuevo, true);
});

test('parsearRespuestaGemini interpreta JSON limpio', () => {
  const lineas = parsearRespuestaGemini('{"lineas": [{"nombre": "Cafe", "cantidad": 20, "costoUnitario": 800}]}');
  assert.strictEqual(lineas.length, 1);
  assert.strictEqual(lineas[0].nombre, 'Cafe');
});

test('parsearRespuestaGemini quita el envoltorio de bloque de codigo', () => {
  const lineas = parsearRespuestaGemini('```json\n{"lineas": []}\n```');
  assert.deepStrictEqual(lineas, []);
});

test('parsearRespuestaGemini lanza si el JSON es invalido', () => {
  assert.throws(() => parsearRespuestaGemini('esto no es json'), /interpretar/i);
});

test('parsearRespuestaGemini lanza si falta el campo lineas', () => {
  assert.throws(() => parsearRespuestaGemini('{"otraCosa": []}'), /lineas/i);
});

const LINEA_EXISTENTE = { nombre: 'Cafe', cantidad: 10, costoUnitario: 800, productoId: 'p1', esNuevo: false };
const LINEA_NUEVA_OK = { nombre: 'Chocolatina', cantidad: 5, costoUnitario: 500, productoId: '', esNuevo: true, categoria: 'Snacks', precioVenta: 900 };

test('validarLineasParaConfirmar acepta lineas existentes y nuevas completas', () => {
  assert.doesNotThrow(() => validarLineasParaConfirmar([LINEA_EXISTENTE, LINEA_NUEVA_OK]));
});

test('validarLineasParaConfirmar exige categoria y precio de venta en linea nueva', () => {
  const incompleta = Object.assign({}, LINEA_NUEVA_OK, { categoria: '' });
  assert.throws(() => validarLineasParaConfirmar([incompleta]), /categoria/i);
});

test('validarLineasParaConfirmar rechaza cantidad invalida senalando la linea', () => {
  const invalida = Object.assign({}, LINEA_EXISTENTE, { cantidad: 0 });
  assert.throws(() => validarLineasParaConfirmar([invalida]), /cantidad/i);
});

test('validarLineasParaConfirmar acepta precio nuevo o vacio en linea existente', () => {
  assert.doesNotThrow(() => validarLineasParaConfirmar([Object.assign({}, LINEA_EXISTENTE, { precioVenta: 3500 })]));
  assert.doesNotThrow(() => validarLineasParaConfirmar([Object.assign({}, LINEA_EXISTENTE, { precioVenta: '' })]));
});

test('validarLineasParaConfirmar rechaza precio invalido en linea existente', () => {
  assert.throws(() => validarLineasParaConfirmar([Object.assign({}, LINEA_EXISTENTE, { precioVenta: 10.5 })]), /precio/i);
  assert.throws(() => validarLineasParaConfirmar([Object.assign({}, LINEA_EXISTENTE, { precioVenta: -100 })]), /precio/i);
});

test('validarLineasParaConfirmar exige al menos una linea', () => {
  assert.throws(() => validarLineasParaConfirmar([]), /al menos una linea/i);
});

test('crearIngresoInventario arma el registro con las lineas serializadas', () => {
  const ingreso = crearIngresoInventario({ id: 'i1', admin: 'Andres', lineas: [LINEA_EXISTENTE], fecha: '2026-09-16T10:00:00.000Z' });
  assert.strictEqual(ingreso.id, 'i1');
  assert.strictEqual(ingreso.admin, 'Andres');
  assert.strictEqual(ingreso.estado, 'pendiente');
  assert.deepStrictEqual(JSON.parse(ingreso.lineas), [LINEA_EXISTENTE]);
});

test('crearIngresoInventario exige id', () => {
  assert.throws(() => crearIngresoInventario({ admin: 'Andres', lineas: [LINEA_EXISTENTE], fecha: '2026-09-16T10:00:00.000Z' }), /id/i);
});

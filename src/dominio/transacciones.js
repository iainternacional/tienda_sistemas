if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
  var calcularValorTotal = dineroModulo.calcularValorTotal;
  var productosModulo = require('./productos.js');
  var hayStockSuficiente = productosModulo.hayStockSuficiente;
  var anulacionModulo = require('./anulacion.js');
  var anularRegistro = anulacionModulo.anularRegistro;
}

const ORIGENES_VALIDOS = ['autoregistro', 'admin'];

function crearTransaccionFiado(datos) {
  if (!datos.id) {
    throw new Error('Falta el id de la transaccion');
  }
  if (!datos.usuarioId) {
    throw new Error('Falta el usuario de la transaccion');
  }
  if (!datos.producto) {
    throw new Error('Falta el producto de la transaccion');
  }
  if (!datos.consumo || !datos.consumo.consumos) {
    throw new Error('Falta el consumo de lotes de la transaccion');
  }
  if (ORIGENES_VALIDOS.indexOf(datos.origen) === -1) {
    throw new Error('Origen invalido: ' + datos.origen);
  }
  if (!esEnteroPositivo(datos.cantidad)) {
    throw new Error('La cantidad debe ser un entero positivo');
  }
  if (!hayStockSuficiente(datos.producto, datos.cantidad)) {
    throw new Error('Stock insuficiente para ' + datos.producto.nombre);
  }
  const valorUnitario = datos.producto.precioVenta;
  return {
    id: datos.id,
    usuarioId: datos.usuarioId,
    productoId: datos.producto.id,
    productoNombre: datos.producto.nombre,
    cantidad: datos.cantidad,
    valorUnitario: valorUnitario,
    valorTotal: calcularValorTotal(datos.cantidad, valorUnitario),
    fecha: datos.fecha,
    origen: datos.origen,
    estado: 'pendiente',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: '',
    costoUnitario: datos.consumo.costoUnitarioPromedio,
    lotesConsumidos: JSON.stringify(datos.consumo.consumos)
  };
}

function validarLineasFiado(lineas) {
  if (!Array.isArray(lineas) || lineas.length === 0) {
    throw new Error('Debe haber al menos una linea para registrar');
  }
  lineas.forEach(function (linea, indice) {
    const numero = indice + 1;
    const productoId = String((linea && linea.productoId) || '').trim();
    if (productoId === '') {
      throw new Error('Linea ' + numero + ': falta el producto');
    }
    if (!esEnteroPositivo(Number(linea.cantidad))) {
      throw new Error('Linea ' + numero + ': la cantidad debe ser un entero positivo');
    }
  });
}

function esActiva(transaccion) {
  return transaccion.estado === 'pendiente' || transaccion.estado === 'pagado';
}

function anularTransaccion(transaccion, datos) {
  return anularRegistro(transaccion, datos);
}

if (typeof module !== 'undefined') {
  module.exports = { crearTransaccionFiado, anularTransaccion, esActiva, validarLineasFiado };
}

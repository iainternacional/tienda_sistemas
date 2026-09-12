if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
  var calcularValorTotal = dineroModulo.calcularValorTotal;
  var productosModulo = require('./productos.js');
  var hayStockSuficiente = productosModulo.hayStockSuficiente;
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
    anuladoMotivo: ''
  };
}

function esActiva(transaccion) {
  return transaccion.estado === 'pendiente' || transaccion.estado === 'pagado';
}

function anularTransaccion(transaccion, datos) {
  if (transaccion.estado === 'anulado') {
    throw new Error('La transaccion ya esta anulada');
  }
  if (!datos.anuladoMotivo || String(datos.anuladoMotivo).trim() === '') {
    throw new Error('Debe indicar el motivo de la anulacion');
  }
  return Object.assign({}, transaccion, {
    estado: 'anulado',
    anuladoPor: datos.anuladoPor,
    anuladoFecha: datos.anuladoFecha,
    anuladoMotivo: String(datos.anuladoMotivo).trim()
  });
}

if (typeof module !== 'undefined') {
  module.exports = { crearTransaccionFiado, anularTransaccion, esActiva };
}

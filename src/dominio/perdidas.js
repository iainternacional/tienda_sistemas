if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
  var productosModulo = require('./productos.js');
  var hayStockSuficiente = productosModulo.hayStockSuficiente;
}

function crearPerdida(datos) {
  if (!datos.id) {
    throw new Error('Falta el id de la perdida');
  }
  if (!datos.producto) {
    throw new Error('Falta el producto de la perdida');
  }
  if (!datos.consumo || !datos.consumo.consumos) {
    throw new Error('Falta el consumo de lotes de la perdida');
  }
  if (!datos.motivo || String(datos.motivo).trim() === '') {
    throw new Error('Debe indicar el motivo de la perdida');
  }
  if (!esEnteroPositivo(datos.cantidad)) {
    throw new Error('La cantidad debe ser un entero positivo');
  }
  if (!hayStockSuficiente(datos.producto, datos.cantidad)) {
    throw new Error('Stock insuficiente para ' + datos.producto.nombre);
  }
  return {
    id: datos.id,
    productoId: datos.producto.id,
    productoNombre: datos.producto.nombre,
    cantidad: datos.cantidad,
    motivo: String(datos.motivo).trim(),
    valor: datos.consumo.costoTotal,
    fecha: datos.fecha,
    estado: 'pendiente',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: '',
    lotesConsumidos: JSON.stringify(datos.consumo.consumos)
  };
}

if (typeof module !== 'undefined') {
  module.exports = { crearPerdida };
}

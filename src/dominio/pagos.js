if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
}

function crearPago(datos) {
  if (!datos.id) {
    throw new Error('Falta el id del pago');
  }
  if (!datos.usuarioId) {
    throw new Error('Falta el usuario del pago');
  }
  if (!esEnteroPositivo(datos.valor)) {
    throw new Error('El valor del pago debe ser un entero positivo');
  }
  return {
    id: datos.id,
    usuarioId: datos.usuarioId,
    valor: datos.valor,
    fecha: datos.fecha,
    aplicadoA: (datos.aplicadoA || []).join(','),
    estado: 'pendiente',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: ''
  };
}

function esAbonoGeneral(pago) {
  return String(pago.aplicadoA || '').trim() === '';
}

if (typeof module !== 'undefined') {
  module.exports = { crearPago, esAbonoGeneral };
}

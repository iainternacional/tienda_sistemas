if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
}

function crearPrestamo(datos) {
  if (!datos.id) {
    throw new Error('Falta el id del prestamo');
  }
  if (!datos.usuarioId) {
    throw new Error('Falta el usuario del prestamo');
  }
  if (!esEnteroPositivo(datos.valor)) {
    throw new Error('El valor del prestamo debe ser un entero positivo');
  }
  const concepto = String(datos.concepto || '').trim();
  return {
    id: datos.id,
    usuarioId: datos.usuarioId,
    valor: datos.valor,
    fecha: datos.fecha,
    estado: 'pendiente',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: '',
    concepto: concepto || 'Prestamo en efectivo'
  };
}

if (typeof module !== 'undefined') {
  module.exports = { crearPrestamo };
}

if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
}

function retirosActivos(retiros) {
  return (retiros || []).filter(function (retiro) {
    return retiro.estado !== 'anulado';
  });
}

function calcularDisponible(gananciaTotal, perdidasTotal, retiros) {
  const retirado = retirosActivos(retiros).reduce(function (suma, retiro) {
    return suma + retiro.valor;
  }, 0);
  return gananciaTotal - perdidasTotal - retirado;
}

function crearRetiro(datos) {
  if (!esEnteroPositivo(datos.valor)) {
    throw new Error('El valor del retiro debe ser un entero positivo');
  }
  const motivo = String(datos.motivo || '').trim();
  if (motivo === '') {
    throw new Error('Debe indicar el motivo del retiro');
  }
  if (datos.valor > datos.disponible) {
    throw new Error('El retiro supera el dinero disponible');
  }
  return {
    id: datos.id,
    valor: datos.valor,
    motivo: motivo,
    fecha: datos.fecha,
    admin: datos.admin,
    estado: 'activo'
  };
}

if (typeof module !== 'undefined') {
  module.exports = { crearRetiro, retirosActivos, calcularDisponible };
}

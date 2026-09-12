function pendientesDe(transacciones, usuarioId) {
  return transacciones.filter(function (transaccion) {
    return transaccion.usuarioId === usuarioId && transaccion.estado === 'pendiente';
  });
}

function calcularSaldoUsuario(transacciones, usuarioId) {
  return pendientesDe(transacciones, usuarioId).reduce(function (total, transaccion) {
    return total + transaccion.valorTotal;
  }, 0);
}

function desglosarSaldoUsuario(transacciones, usuarioId) {
  return pendientesDe(transacciones, usuarioId)
    .map(function (transaccion) {
      return {
        id: transaccion.id,
        fecha: transaccion.fecha,
        concepto: transaccion.productoNombre,
        cantidad: transaccion.cantidad,
        valorTotal: transaccion.valorTotal
      };
    })
    .sort(function (a, b) {
      return String(b.fecha).localeCompare(String(a.fecha));
    });
}

if (typeof module !== 'undefined') {
  module.exports = { calcularSaldoUsuario, desglosarSaldoUsuario };
}

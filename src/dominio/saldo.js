if (typeof require !== 'undefined') {
  var gastosModulo = require('./gastosCompartidos.js');
  var cuotasDeGasto = gastosModulo.cuotasDeGasto;
  var pagosModulo = require('./pagos.js');
  var esAbonoGeneral = pagosModulo.esAbonoGeneral;
}

function estaPendiente(registro) {
  return registro.estado === 'pendiente';
}

function lineasDeUsuario(movimientos, usuarioId) {
  const transacciones = movimientos.transacciones || [];
  const prestamos = movimientos.prestamos || [];
  const gastos = movimientos.gastos || [];
  const pagos = movimientos.pagos || [];
  const lineas = [];

  transacciones.forEach(function (transaccion) {
    if (transaccion.usuarioId === usuarioId && estaPendiente(transaccion)) {
      lineas.push({
        id: transaccion.id,
        fecha: transaccion.fecha,
        tipo: 'fiado',
        concepto: transaccion.productoNombre,
        cantidad: transaccion.cantidad,
        valorTotal: transaccion.valorTotal
      });
    }
  });

  prestamos.forEach(function (prestamo) {
    if (prestamo.usuarioId === usuarioId && estaPendiente(prestamo)) {
      lineas.push({
        id: prestamo.id,
        fecha: prestamo.fecha,
        tipo: 'prestamo',
        concepto: 'Prestamo en efectivo',
        cantidad: 1,
        valorTotal: prestamo.valor
      });
    }
  });

  gastos.forEach(function (gasto) {
    cuotasDeGasto(gasto).forEach(function (cuota) {
      if (cuota.usuarioId === usuarioId) {
        const titulo = cuota.motivo.charAt(0).toUpperCase() + cuota.motivo.slice(1);
        lineas.push({
          id: gasto.id,
          fecha: cuota.fecha,
          tipo: 'gasto',
          concepto: cuota.descripcion ? titulo + ': ' + cuota.descripcion : titulo,
          cantidad: 1,
          valorTotal: cuota.valor
        });
      }
    });
  });

  pagos.forEach(function (pago) {
    if (pago.usuarioId === usuarioId && estaPendiente(pago) && esAbonoGeneral(pago)) {
      lineas.push({
        id: pago.id,
        fecha: pago.fecha,
        tipo: 'abono',
        concepto: 'Abono',
        cantidad: 1,
        valorTotal: -pago.valor
      });
    }
  });

  return lineas;
}

function calcularSaldoUsuario(movimientos, usuarioId) {
  return lineasDeUsuario(movimientos, usuarioId).reduce(function (total, linea) {
    return total + linea.valorTotal;
  }, 0);
}

function desglosarSaldoUsuario(movimientos, usuarioId) {
  return lineasDeUsuario(movimientos, usuarioId).sort(function (a, b) {
    return String(b.fecha).localeCompare(String(a.fecha));
  });
}

if (typeof module !== 'undefined') {
  module.exports = { calcularSaldoUsuario, desglosarSaldoUsuario };
}

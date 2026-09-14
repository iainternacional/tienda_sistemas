if (typeof require !== 'undefined') {
  var saldoModulo = require('./saldo.js');
  var calcularSaldoUsuario = saldoModulo.calcularSaldoUsuario;
  var gastosModulo = require('./gastosCompartidos.js');
  var cuotasDeGasto = gastosModulo.cuotasDeGasto;
}

function dentroDelRango(fecha, desde, hasta) {
  const dia = String(fecha || '').slice(0, 10);
  if (dia === '') {
    return false;
  }
  if (desde && dia < String(desde).slice(0, 10)) {
    return false;
  }
  if (hasta && dia > String(hasta).slice(0, 10)) {
    return false;
  }
  return true;
}

function noAnulado(registro) {
  return registro.estado !== 'anulado';
}

function reporteGanancia(transacciones, productos, desde, hasta) {
  const costoActualPorId = {};
  (productos || []).forEach(function (producto) {
    costoActualPorId[producto.id] = producto.costo;
  });

  const acumulado = {};
  let estimado = false;

  (transacciones || [])
    .filter(function (transaccion) {
      return noAnulado(transaccion) && dentroDelRango(transaccion.fecha, desde, hasta);
    })
    .forEach(function (transaccion) {
      let costo = Number(transaccion.costoUnitario);
      if (!costo) {
        costo = Number(costoActualPorId[transaccion.productoId]) || 0;
        estimado = true;
      }
      const clave = transaccion.productoId;
      if (!acumulado[clave]) {
        acumulado[clave] = {
          productoId: clave,
          nombre: transaccion.productoNombre,
          cantidad: 0,
          ingresos: 0,
          costos: 0,
          ganancia: 0
        };
      }
      const fila = acumulado[clave];
      fila.cantidad += transaccion.cantidad;
      fila.ingresos += transaccion.valorTotal;
      fila.costos += costo * transaccion.cantidad;
      fila.ganancia = fila.ingresos - fila.costos;
    });

  const porProducto = Object.keys(acumulado)
    .map(function (clave) { return acumulado[clave]; })
    .sort(function (a, b) { return b.ganancia - a.ganancia; });

  return {
    total: porProducto.reduce(function (suma, fila) { return suma + fila.ganancia; }, 0),
    estimado: estimado,
    porProducto: porProducto
  };
}

function reportePerdidas(perdidas, desde, hasta) {
  const lineas = (perdidas || [])
    .filter(function (perdida) {
      return noAnulado(perdida) && dentroDelRango(perdida.fecha, desde, hasta);
    })
    .map(function (perdida) {
      return {
        id: perdida.id,
        fecha: perdida.fecha,
        producto: perdida.productoNombre,
        cantidad: perdida.cantidad,
        motivo: perdida.motivo,
        valor: perdida.valor
      };
    })
    .sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); });

  return {
    total: lineas.reduce(function (suma, linea) { return suma + linea.valor; }, 0),
    lineas: lineas
  };
}

function reporteCartera(movimientos, usuarios) {
  const porUsuario = (usuarios || [])
    .filter(function (usuario) {
      // los pseudo-usuarios existen solo para agregar reportes, no tienen saldo propio
      return usuario.activo === true && usuario.esPseudoUsuario !== true;
    })
    .map(function (usuario) {
      return {
        usuarioId: usuario.id,
        nombre: usuario.nombre,
        saldo: calcularSaldoUsuario(movimientos, usuario.id)
      };
    })
    .filter(function (fila) { return fila.saldo !== 0; })
    .sort(function (a, b) { return b.saldo - a.saldo; });

  return {
    total: porUsuario.reduce(function (suma, fila) { return suma + fila.saldo; }, 0),
    porUsuario: porUsuario
  };
}

function reporteGastosCompartidos(gastos) {
  const grupos = {};
  const orden = [];

  (gastos || [])
    .filter(noAnulado)
    .sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); })
    .forEach(function (gasto) {
      const cuotas = cuotasDeGasto(gasto);
      if (!grupos[gasto.motivo]) {
        grupos[gasto.motivo] = { motivo: gasto.motivo, cantidad: 0, total: 0, gastos: [] };
        orden.push(gasto.motivo);
      }
      const grupo = grupos[gasto.motivo];
      grupo.cantidad += 1;
      grupo.total += gasto.valorTotal;
      grupo.gastos.push({
        id: gasto.id,
        fecha: gasto.fecha,
        descripcion: gasto.descripcion,
        valorTotal: gasto.valorTotal,
        participantes: cuotas.length,
        valorPorPersona: cuotas.length > 0 ? cuotas[0].valor : 0
      });
    });

  return orden.map(function (motivo) { return grupos[motivo]; });
}

if (typeof module !== 'undefined') {
  module.exports = {
    reporteGanancia,
    reportePerdidas,
    reporteCartera,
    reporteGastosCompartidos,
    dentroDelRango,
    noAnulado
  };
}

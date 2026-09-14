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

if (typeof module !== 'undefined') {
  module.exports = { reporteGanancia, dentroDelRango, noAnulado };
}

if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
}

function crearLote(datos) {
  if (!datos.id) {
    throw new Error('Falta el id del lote');
  }
  if (!datos.productoId) {
    throw new Error('Falta el producto del lote');
  }
  if (!esEnteroPositivo(datos.cantidad)) {
    throw new Error('La cantidad debe ser un entero positivo');
  }
  if (!esEnteroPositivo(datos.costoUnitario)) {
    throw new Error('El costo unitario debe ser un entero positivo');
  }
  const tienePrecio = datos.precioVenta !== undefined && datos.precioVenta !== null && datos.precioVenta !== '';
  if (tienePrecio && !esEnteroPositivo(datos.precioVenta)) {
    throw new Error('El precio de venta del lote debe ser un entero positivo');
  }
  return {
    id: datos.id,
    productoId: datos.productoId,
    fecha: datos.fecha,
    cantidadInicial: datos.cantidad,
    cantidadRestante: datos.cantidad,
    costoUnitario: datos.costoUnitario,
    estado: 'activo',
    anuladoPor: '',
    anuladoFecha: '',
    anuladoMotivo: '',
    precioVenta: tienePrecio ? datos.precioVenta : ''
  };
}

// Un lote sin precio propio (creado antes de que existiera la columna) se vende
// al precio del producto.
function precioDeLote(lote, precioPorDefecto) {
  return Number(lote.precioVenta) || Number(precioPorDefecto) || 0;
}

function lotesDisponibles(lotes, productoId) {
  return (lotes || [])
    .filter(function (lote) {
      return lote.productoId === productoId
        && lote.estado === 'activo'
        && Number(lote.cantidadRestante) > 0;
    })
    .sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); });
}

function consumirDeLotes(lotes, productoId, cantidadRequerida, nombreProducto, precioPorDefecto) {
  if (!esEnteroPositivo(cantidadRequerida)) {
    throw new Error('La cantidad debe ser un entero positivo');
  }
  const disponibles = lotesDisponibles(lotes, productoId);
  const total = disponibles.reduce(function (suma, lote) {
    return suma + Number(lote.cantidadRestante);
  }, 0);
  if (total < cantidadRequerida) {
    throw new Error('Stock insuficiente para ' + nombreProducto);
  }
  const consumos = [];
  const lotesActualizados = [];
  let pendiente = cantidadRequerida;
  let costoTotal = 0;
  let valorTotal = 0;
  for (let i = 0; i < disponibles.length && pendiente > 0; i++) {
    const lote = disponibles[i];
    const disponible = Number(lote.cantidadRestante);
    const toma = pendiente < disponible ? pendiente : disponible;
    const costoUnitario = Number(lote.costoUnitario);
    const precioVenta = precioDeLote(lote, precioPorDefecto);
    consumos.push({ loteId: lote.id, cantidad: toma, costoUnitario: costoUnitario, precioVenta: precioVenta });
    lotesActualizados.push(Object.assign({}, lote, { cantidadRestante: disponible - toma }));
    costoTotal += toma * costoUnitario;
    valorTotal += toma * precioVenta;
    pendiente -= toma;
  }
  return {
    consumos: consumos,
    costoTotal: costoTotal,
    costoUnitarioPromedio: Math.round(costoTotal / cantidadRequerida),
    valorTotal: valorTotal,
    lotesActualizados: lotesActualizados
  };
}

// Precio que paga hoy el comprador: el del lote que se vende primero (FIFO).
function precioVigente(lotes, productoId, precioPorDefecto) {
  const disponibles = lotesDisponibles(lotes, productoId);
  if (disponibles.length === 0) {
    return Number(precioPorDefecto) || 0;
  }
  return precioDeLote(disponibles[0], precioPorDefecto);
}

// Antes de cambiar el precio del producto, congela el precio actual en los lotes
// que aun no tienen uno, para que sigan vendiendose a lo que valian.
function fijarPrecioEnLotesSinPrecio(lotes, productoId, precio) {
  return lotesDisponibles(lotes, productoId)
    .filter(function (lote) { return !Number(lote.precioVenta); })
    .map(function (lote) { return Object.assign({}, lote, { precioVenta: precio }); });
}

// Cambio manual de precio: aplica a todas las unidades que quedan en inventario.
function asignarPrecioALotesConStock(lotes, productoId, precio) {
  return lotesDisponibles(lotes, productoId)
    .filter(function (lote) { return Number(lote.precioVenta) !== precio; })
    .map(function (lote) { return Object.assign({}, lote, { precioVenta: precio }); });
}

function devolverALotes(lotes, lotesConsumidos) {
  const porId = {};
  (lotesConsumidos || []).forEach(function (consumo) {
    porId[consumo.loteId] = (porId[consumo.loteId] || 0) + Number(consumo.cantidad);
  });
  const actualizados = [];
  (lotes || []).forEach(function (lote) {
    if (porId[lote.id] === undefined) {
      return;
    }
    actualizados.push(Object.assign({}, lote, {
      cantidadRestante: Number(lote.cantidadRestante) + porId[lote.id]
    }));
  });
  return actualizados;
}

function puedeAnularseLote(lote) {
  return Number(lote.cantidadRestante) === Number(lote.cantidadInicial);
}

if (typeof module !== 'undefined') {
  module.exports = {
    crearLote,
    lotesDisponibles,
    consumirDeLotes,
    devolverALotes,
    puedeAnularseLote,
    precioVigente,
    fijarPrecioEnLotesSinPrecio,
    asignarPrecioALotesConStock
  };
}

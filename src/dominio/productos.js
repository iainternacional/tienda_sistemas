if (typeof require !== 'undefined') {
  var dineroModulo = require('./dinero.js');
  var esEnteroPositivo = dineroModulo.esEnteroPositivo;
}

function normalizarNombre(nombre) {
  return String(nombre === undefined || nombre === null ? '' : nombre)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function validarProductoNuevo(datos) {
  const errores = [];
  if (normalizarNombre(datos.nombre) === '') {
    errores.push('El nombre es obligatorio');
  }
  if (!esEnteroPositivo(datos.costo)) {
    errores.push('El costo debe ser un entero positivo');
  }
  if (!esEnteroPositivo(datos.precioVenta)) {
    errores.push('El precio de venta debe ser un entero positivo');
  }
  if (!Number.isInteger(datos.stockActual) || datos.stockActual < 0) {
    errores.push('El stock debe ser un entero mayor o igual a cero');
  }
  return { valido: errores.length === 0, errores: errores };
}

function buscarProductoPorNombre(productos, nombre) {
  const buscado = normalizarNombre(nombre);
  if (buscado === '') {
    return null;
  }
  for (let i = 0; i < productos.length; i++) {
    if (normalizarNombre(productos[i].nombre) === buscado) {
      return productos[i];
    }
  }
  return null;
}

function hayStockSuficiente(producto, cantidad) {
  return producto.stockActual >= cantidad;
}

function descontarStock(producto, cantidad) {
  if (!esEnteroPositivo(cantidad)) {
    throw new Error('La cantidad debe ser un entero positivo');
  }
  if (!hayStockSuficiente(producto, cantidad)) {
    throw new Error('Stock insuficiente para ' + producto.nombre);
  }
  return Object.assign({}, producto, { stockActual: producto.stockActual - cantidad });
}

if (typeof module !== 'undefined') {
  module.exports = {
    normalizarNombre,
    validarProductoNuevo,
    buscarProductoPorNombre,
    hayStockSuficiente,
    descontarStock
  };
}

function esEnteroPositivo(valor) {
  return typeof valor === 'number' && Number.isInteger(valor) && valor > 0;
}

function calcularValorTotal(cantidad, valorUnitario) {
  if (!esEnteroPositivo(cantidad)) {
    throw new Error('La cantidad debe ser un entero positivo');
  }
  if (!esEnteroPositivo(valorUnitario)) {
    throw new Error('El valor unitario debe ser un entero positivo');
  }
  return cantidad * valorUnitario;
}

if (typeof module !== 'undefined') {
  module.exports = { esEnteroPositivo, calcularValorTotal };
}

function doGet(e) {
  const vista = e && e.parameter && e.parameter.vista === 'admin' ? 'admin' : 'micuenta';
  const plantilla = HtmlService.createTemplateFromFile('web/' + vista);
  return plantilla.evaluate()
    .setTitle('Tienda Sistemas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function incluir(nombreArchivo) {
  return HtmlService.createHtmlOutputFromFile(nombreArchivo).getContent();
}

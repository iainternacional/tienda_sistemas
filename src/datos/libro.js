function obtenerLibro() {
  const id = PropertiesService.getScriptProperties().getProperty('ID_LIBRO');
  if (!id) {
    throw new Error('Falta configurar la propiedad de script ID_LIBRO');
  }
  return SpreadsheetApp.openById(id);
}

function hashConUtilities(texto) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return bytes.map(function (byte) {
    return ((byte & 0xff) + 0x100).toString(16).slice(1);
  }).join('');
}

function nuevoId() {
  return Utilities.getUuid();
}

function ahoraIso() {
  return new Date().toISOString();
}

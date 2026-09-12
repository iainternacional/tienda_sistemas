function hashClave(clave, salt, funcionHash) {
  return funcionHash(String(salt) + ':' + String(clave));
}

function verificarClave(clave, salt, hashEsperado, funcionHash) {
  if (!hashEsperado) {
    return false;
  }
  return hashClave(clave, salt, funcionHash) === hashEsperado;
}

function esUsuarioUtilizable(usuario) {
  return usuario.activo === true && usuario.esPseudoUsuario !== true;
}

function textoComparable(valor) {
  return String(valor === undefined || valor === null ? '' : valor).trim().toLowerCase();
}

function resolverUsuarioPorEmail(usuarios, email) {
  const buscado = textoComparable(email);
  if (buscado === '') {
    return null;
  }
  for (let i = 0; i < usuarios.length; i++) {
    const usuario = usuarios[i];
    if (esUsuarioUtilizable(usuario) && textoComparable(usuario.emailCorporativo) === buscado) {
      return usuario;
    }
  }
  return null;
}

function resolverUsuarioPorClave(usuarios, usuario, clave, funcionHash) {
  const buscado = textoComparable(usuario);
  if (buscado === '') {
    return null;
  }
  for (let i = 0; i < usuarios.length; i++) {
    const candidato = usuarios[i];
    if (esUsuarioUtilizable(candidato) && textoComparable(candidato.usuario) === buscado) {
      if (verificarClave(clave, candidato.salt, candidato.claveHash, funcionHash)) {
        return candidato;
      }
      return null;
    }
  }
  return null;
}

function esAdmin(usuario) {
  return !!usuario && usuario.rol === 'admin';
}

if (typeof module !== 'undefined') {
  module.exports = { hashClave, verificarClave, resolverUsuarioPorEmail, resolverUsuarioPorClave, esAdmin };
}

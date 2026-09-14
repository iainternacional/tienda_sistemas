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

function buscarUsuarioPorNombreDeUsuario(usuarios, usuario) {
  const buscado = textoComparable(usuario);
  if (buscado === '') {
    return null;
  }
  for (let i = 0; i < usuarios.length; i++) {
    if (textoComparable(usuarios[i].usuario) === buscado) {
      return usuarios[i];
    }
  }
  return null;
}

function validarUsuarioNuevo(datos) {
  const errores = [];
  const usuario = textoComparable(datos.usuario);
  const clave = String(datos.clave === undefined || datos.clave === null ? '' : datos.clave);
  if (textoComparable(datos.nombre) === '') {
    errores.push('El nombre es obligatorio');
  }
  if (usuario === '') {
    errores.push('El usuario es obligatorio');
  } else if (usuario.length < 3) {
    errores.push('El usuario debe tener al menos 3 caracteres');
  } else if (!/^[a-z0-9._-]+$/.test(usuario)) {
    errores.push('El usuario solo puede tener letras, numeros, punto, guion y guion bajo');
  }
  if (clave.length < 4) {
    errores.push('La clave debe tener al menos 4 caracteres');
  }
  return { valido: errores.length === 0, errores: errores };
}

function crearUsuarioComprador(datos, funcionHash) {
  const validacion = validarUsuarioNuevo(datos);
  if (!validacion.valido) {
    throw new Error(validacion.errores.join('. '));
  }
  return {
    id: datos.id,
    nombre: String(datos.nombre).trim(),
    area: String(datos.area === undefined || datos.area === null ? '' : datos.area).trim(),
    rol: 'comprador',
    tipoLogin: 'usuario_clave',
    emailCorporativo: '',
    usuario: textoComparable(datos.usuario),
    salt: datos.salt,
    claveHash: hashClave(datos.clave, datos.salt, funcionHash),
    esPseudoUsuario: false,
    activo: true
  };
}

function validarUsuarioCorporativoNuevo(datos) {
  const errores = [];
  const email = textoComparable(datos.email);
  if (textoComparable(datos.nombre) === '') {
    errores.push('El nombre es obligatorio');
  }
  if (email === '') {
    errores.push('El correo es obligatorio');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errores.push('El correo no tiene un formato valido');
  }
  return { valido: errores.length === 0, errores: errores };
}

function crearUsuarioCorporativo(datos) {
  const validacion = validarUsuarioCorporativoNuevo(datos);
  if (!validacion.valido) {
    throw new Error(validacion.errores.join('. '));
  }
  return {
    id: datos.id,
    nombre: String(datos.nombre).trim(),
    area: String(datos.area === undefined || datos.area === null ? '' : datos.area).trim(),
    rol: 'comprador',
    tipoLogin: 'google_corporativo',
    emailCorporativo: textoComparable(datos.email),
    usuario: '',
    salt: '',
    claveHash: '',
    esPseudoUsuario: false,
    activo: true
  };
}

function buscarUsuarioPorEmailCorporativo(usuarios, email) {
  const buscado = textoComparable(email);
  if (buscado === '') {
    return null;
  }
  for (let i = 0; i < usuarios.length; i++) {
    if (textoComparable(usuarios[i].emailCorporativo) === buscado) {
      return usuarios[i];
    }
  }
  return null;
}

if (typeof module !== 'undefined') {
  module.exports = {
    hashClave,
    verificarClave,
    resolverUsuarioPorEmail,
    resolverUsuarioPorClave,
    esAdmin,
    buscarUsuarioPorNombreDeUsuario,
    validarUsuarioNuevo,
    crearUsuarioComprador,
    validarUsuarioCorporativoNuevo,
    crearUsuarioCorporativo,
    buscarUsuarioPorEmailCorporativo
  };
}

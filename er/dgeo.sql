BEGIN;

CREATE SCHEMA dgeo;

CREATE TABLE dgeo.usuario(
  id SERIAL NOT NULL PRIMARY KEY,
  login VARCHAR(255) UNIQUE NOT NULL,
  nome VARCHAR(255) NOT NULL,
  nome_guerra VARCHAR(255) NOT NULL,
  tipo_posto_grad_id SMALLINT NOT NULL REFERENCES dominio.tipo_posto_grad (code),
  administrador BOOLEAN NOT NULL DEFAULT FALSE,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  uuid UUID NOT NULL UNIQUE
);

-- Perfil da pessoa POR MODULO (acervo e mapoteca sao separados). Quem e
-- administrador nao precisa de linha aqui: a flag global ja o autoriza em
-- qualquer modulo. Usuario sem linha para um modulo nao acessa aquele modulo.
CREATE TABLE dgeo.usuario_perfil(
  id SERIAL NOT NULL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES dgeo.usuario (id),
  modulo_id SMALLINT NOT NULL REFERENCES dominio.modulo (code),
  perfil_id SMALLINT NOT NULL REFERENCES dominio.tipo_perfil (code),
  UNIQUE (usuario_id, modulo_id)
);

COMMIT;
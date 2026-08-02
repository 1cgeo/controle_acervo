BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SCHEMA dgeo;

-- A pessoa. Desde 2026-08-02 o SCA e o DONO da identidade: ele guarda o hash da
-- senha e valida o login sozinho, sem o Auth Server externo que existia antes.
-- Por isso `senha` mora aqui e `uuid` ganhou default: ate a fusao esta tabela
-- era um ESPELHO, e todo uuid vinha importado de fora.
CREATE TABLE dgeo.usuario(
  id SERIAL NOT NULL PRIMARY KEY,
  login VARCHAR(255) UNIQUE NOT NULL,
  -- Hash bcrypt, NUNCA a senha. O valor entra por bcrypt.hash e so sai em
  -- bcrypt.compare: nenhuma rota devolve esta coluna, e o SQL de leitura de
  -- usuario a omite de proposito.
  --
  -- ANULAVEL, e isso e deliberado. "Pessoa cadastrada que ainda nao tem senha
  -- local" e um estado de VERDADE do sistema, nascido da fusao de 2026-08-02:
  -- quem veio do Auth Server so ganha hash quando o
  -- `scripts/copiar_usuarios_auth.js` rodar. O sistema inteiro o trata como
  -- caso proprio -- o login responde "procure um administrador" em vez de
  -- "senha invalida", e a tela de usuarios marca quem esta assim.
  --
  -- Nao ha caminho de escrita que produza nulo: `criaUsuario` sempre grava
  -- hash. Deixar NOT NULL aqui e anulavel na migracao faria `er/` e
  -- `migrations/` divergirem, e o `migrations/ensaiar_migracao.cjs` existe
  -- justamente para provar que os dois chegam ao mesmo schema.
  senha VARCHAR(255),
  nome VARCHAR(255) NOT NULL,
  nome_guerra VARCHAR(255) NOT NULL,
  tipo_posto_grad_id SMALLINT NOT NULL REFERENCES dominio.tipo_posto_grad (code),
  administrador BOOLEAN NOT NULL DEFAULT FALSE,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  uuid UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4()
);

-- Perfil da pessoa POR MODULO (acervo e mapoteca sao separados). Quem e
-- administrador nao precisa de linha aqui: a flag global ja o autoriza em
-- qualquer modulo. Usuario sem linha para um modulo nao acessa aquele modulo.
CREATE TABLE dgeo.usuario_perfil(
  id SERIAL NOT NULL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES dgeo.usuario (id) ON DELETE CASCADE,
  modulo_id SMALLINT NOT NULL REFERENCES dominio.modulo (code),
  perfil_id SMALLINT NOT NULL REFERENCES dominio.tipo_perfil (code),
  UNIQUE (usuario_id, modulo_id)
);

-- Historico de acesso: uma linha por login bem-sucedido. E o que alimenta a
-- tela #/acessos.
--
-- `cliente` e VARCHAR, e NAO uma tabela de dominio, porque a lista de clientes
-- e fechada e vive no Joi de `login/login_schema.js` (`sca_web`, `sca_qgis`):
-- a rota so grava o que ela mesma acabou de aceitar, entao valor fora da lista
-- nao tem por onde entrar. O Auth Server tinha uma `dgeo.aplicacao` com CRUD
-- proprio; ela nao veio na fusao porque este autenticador serve UM sistema, e
-- cadastrar aplicacao seria administrar um catalogo de um item so.
--
-- `usuario_id` e ANULAVEL de proposito: apagar a pessoa nao apaga a passagem
-- dela pelo sistema. Sem isso, ou o DELETE do usuario falharia na FK, ou a
-- contagem de acessos do mes mudaria retroativamente ao demitir alguem.
CREATE TABLE dgeo.login(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  usuario_id INTEGER REFERENCES dgeo.usuario (id) ON DELETE SET NULL,
  cliente VARCHAR(255) NOT NULL,
  data_login TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Toda consulta da tela de acessos recorta por data ('logins dos ultimos 30
-- dias', 'quem entrou hoje') antes de agrupar. Sem o indice, cada painel varre
-- a tabela inteira, que so cresce.
CREATE INDEX login_data_login_idx ON dgeo.login (data_login);

COMMIT;

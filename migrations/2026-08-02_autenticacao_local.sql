-- O SCA passa a ser o dono da IDENTIDADE. O Auth Server externo sai.
--
-- O PROBLEMA. Ate 2026-08-02 o SCA nao sabia validar uma senha: `dgeo.usuario`
-- era um ESPELHO, e todo login virava um POST no Auth Server
-- (https://github.com/1cgeo/auth_server), num processo e num banco separados.
-- Isso custava tres coisas: o SCA nao subia se o outro servico estivesse fora
-- do ar (main.js chamava verifyAuthServer antes de startServer), cadastrar
-- gente era um trabalho em DOIS sistemas (criar la, importar aqui), e "trocar a
-- minha senha" era uma tela que o SCA nao tinha e nunca poderia ter.
--
-- Ele era um servico compartilhado de verdade -- o SAP e o Gerenciador FME
-- tambem o consomem --, e por isso trazia um catalogo de APLICACOES com CRUD
-- proprio. Para o SCA esse catalogo nunca teve mais de duas linhas
-- ('sca_web' e 'sca_qgis'), e por decisao do chefe ele NAO veio na fusao:
-- administrar um catalogo de aplicacoes de um sistema so e cerimonia sem dono.
--
-- O QUE MUDA AQUI:
--   1. `dgeo.usuario.senha` guarda o hash bcrypt, e e ANULAVEL. Os hashes das
--      pessoas que ja existem sao copiados do banco do Auth Server DEPOIS, por
--      `scripts/copiar_usuarios_auth.js`, entao travar a coluna recusaria a
--      propria migracao. Ela SEGUE anulavel depois disso, e o `er/dgeo.sql` a
--      declara igual: "cadastrada e ainda sem senha local" e um estado de
--      verdade do sistema, tratado como caso proprio no login (que responde
--      "procure um administrador", e nao "senha invalida") e marcado na tela de
--      usuarios. Um `SET NOT NULL` aqui faria este caminho divergir do `er/`, e
--      o `ensaiar_migracao.cjs` existe para provar que os dois convergem.
--   2. `dgeo.usuario.uuid` ganha default. Ele nunca teve um porque TODO uuid
--      chegava importado de fora; agora o SCA cria gente.
--   3. `dgeo.login` guarda o historico de acesso, que alimenta a tela
--      #/acessos. E a `dgeo.login` do Auth Server sem `aplicacao_id`: no lugar
--      dele entra `cliente` VARCHAR, que e o mesmo campo que o POST /api/login
--      ja recebia e validava.
--   4. A FK de `dgeo.usuario_perfil` passa a ON DELETE CASCADE, para que
--      excluir um usuario nao esbarre no proprio perfil dele. As demais FKs
--      para `dgeo.usuario` continuam RESTRICT de proposito: quem ja catalogou
--      no acervo nao se apaga, se DESATIVA, e o servidor traduz esse 23503 numa
--      frase que diz isso.
--
-- Aditiva e idempotente, como toda migracao daqui: rodar duas vezes nao quebra.
--
-- Para desfazer: ALTER TABLE dgeo.usuario DROP COLUMN senha;
--                ALTER TABLE dgeo.usuario ALTER COLUMN uuid DROP DEFAULT;
--                DROP TABLE dgeo.login;

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. O hash da senha. Anulavel ate a copia dos hashes rodar (ver o cabecalho).
ALTER TABLE dgeo.usuario ADD COLUMN IF NOT EXISTS senha VARCHAR(255);

COMMENT ON COLUMN dgeo.usuario.senha IS
    'Hash bcrypt, nunca a senha. Nenhuma rota devolve esta coluna. Nula significa que a pessoa ainda nao tem senha local e nao consegue entrar.';

-- 2. Default do uuid, para o SCA poder criar usuario sem receber um de fora.
ALTER TABLE dgeo.usuario ALTER COLUMN uuid SET DEFAULT uuid_generate_v4();

-- 3. Historico de acesso.
CREATE TABLE IF NOT EXISTS dgeo.login(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  usuario_id INTEGER REFERENCES dgeo.usuario (id) ON DELETE SET NULL,
  cliente VARCHAR(255) NOT NULL,
  data_login TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_data_login_idx ON dgeo.login (data_login);

-- 4. Perfil cai junto com o usuario. A constraint nasceu sem acao referencial
-- (RESTRICT implicito) porque ninguem apagava usuario no SCA: quem criava gente
-- era o Auth Server. Recriar e a unica forma -- o PostgreSQL nao tem
-- ALTER CONSTRAINT que troque a acao de uma FK.
DO $$
DECLARE
  nome_constraint TEXT;
BEGIN
  SELECT con.conname INTO nome_constraint
  FROM pg_constraint AS con
  INNER JOIN pg_class AS rel ON rel.oid = con.conrelid
  INNER JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'dgeo'
    AND rel.relname = 'usuario_perfil'
    AND con.contype = 'f'
    AND con.confdeltype <> 'c'
    AND con.conkey = ARRAY[(
      SELECT attnum FROM pg_attribute
      WHERE attrelid = rel.oid AND attname = 'usuario_id'
    )]::SMALLINT[];

  IF nome_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE dgeo.usuario_perfil DROP CONSTRAINT %I', nome_constraint);
    ALTER TABLE dgeo.usuario_perfil
      ADD CONSTRAINT usuario_perfil_usuario_id_fkey
      FOREIGN KEY (usuario_id) REFERENCES dgeo.usuario (id) ON DELETE CASCADE;
  END IF;
END $$;

-- O usuario da aplicacao ja tem CRUD em todo o schema dgeo pelo er/permissao.sql,
-- mas aquele GRANT vale para as tabelas que existiam NA HORA em que ele rodou:
-- `ALL TABLES IN SCHEMA` nao alcanca tabela criada depois. Sem isto, o primeiro
-- login apos a migracao falha ao gravar o historico com "permission denied".
DO $$
DECLARE
  app_user TEXT;
BEGIN
  SELECT nspowner::regrole::text INTO app_user
  FROM pg_namespace WHERE nspname = 'dgeo';

  IF app_user IS NOT NULL THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON dgeo.login TO %I', app_user);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE dgeo.login_id_seq TO %I', app_user);
  END IF;
END $$;

UPDATE public.versao SET nome = '1.12.0' WHERE code = 1;

COMMIT;

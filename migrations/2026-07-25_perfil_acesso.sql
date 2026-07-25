-- Migração: perfil de acesso POR MÓDULO (acervo e mapoteca).
-- Até aqui o SCA só distinguia "administrador" de "usuário logado", e o corte
-- era por verbo HTTP: GET para qualquer logado, escrita só para admin. A partir
-- daqui existe nível dentro de cada módulo (consulta, operador, gerente), e o
-- administrador passa a ser a flag GLOBAL da plataforma, acima de qualquer
-- módulo. Acervo e mapoteca são módulos DISTINTOS: quem atende a mapoteca não
-- cataloga o acervo.
--
-- Aditiva e idempotente. Não altera coluna existente e NÃO concede perfil a
-- ninguém: administrador continua administrador, e a concessão aos demais é ato
-- explícito, feito na tela de usuários junto com o deploy.

BEGIN;

-- 1) Nível dentro do módulo. O administrador NÃO é um nível daqui.
CREATE TABLE IF NOT EXISTS dominio.tipo_perfil(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_perfil (code, nome) VALUES
  (1, 'Consulta'),
  (2, 'Operador'),
  (3, 'Gerente')
ON CONFLICT (code) DO NOTHING;

-- 2) Módulo funcional. Tabela, e não CHECK, para que absorver o orçamento (e
-- depois a produção) seja INSERT em vez de migração de constraint.
CREATE TABLE IF NOT EXISTS dominio.modulo(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  nome_abrev VARCHAR(255) UNIQUE NOT NULL
);

INSERT INTO dominio.modulo (code, nome, nome_abrev) VALUES
  (1, 'Controle do Acervo', 'acervo'),
  (2, 'Mapoteca', 'mapoteca')
ON CONFLICT (code) DO NOTHING;

-- 3) Perfil da pessoa por módulo.
CREATE TABLE IF NOT EXISTS dgeo.usuario_perfil(
  id SERIAL NOT NULL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES dgeo.usuario (id),
  modulo_id SMALLINT NOT NULL REFERENCES dominio.modulo (code),
  perfil_id SMALLINT NOT NULL REFERENCES dominio.tipo_perfil (code),
  UNIQUE (usuario_id, modulo_id)
);

-- 4) Backfill: NENHUM, de propósito.
-- Administrador não precisa de linha (a flag global já autoriza tudo). Para os
-- demais, conceder é ato explícito. ATENÇÃO ao deploy: hoje qualquer usuário
-- logado LÊ o acervo e IMPRIME na mapoteca; sem conceder perfil junto com o
-- deploy, essa gente perde acesso. Modelo da concessão:
--
--   INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
--   SELECT id, 1, 1 FROM dgeo.usuario WHERE login IN ('...')   -- consulta no acervo
--   ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id;
--
--   INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
--   SELECT id, 2, 2 FROM dgeo.usuario WHERE login IN ('...')   -- operador na mapoteca
--   ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id;

-- 5) versão do banco
UPDATE public.versao SET nome = '1.1.0' WHERE code = 1;

COMMIT;

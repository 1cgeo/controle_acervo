BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Necessária pelo EXCLUDE de `dgeo.efetivo_periodo`: o índice GiST não sabe
-- comparar UUID por igualdade sem ela, e é essa igualdade que restringe a não
-- sobreposição a UMA pessoa por vez.
CREATE EXTENSION IF NOT EXISTS btree_gist;

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

-- ---------------------------------------------------------------------------
-- Aproveitamento do efetivo: INTERVALO, e não retrato mensal (chefe, 2026-08-02)
-- ---------------------------------------------------------------------------
--
-- A subseção 6.1 do RPCMTec nasceu aqui como `rpcmtec.aproveitamento_mes`, uma
-- linha por pessoa por mês com um texto livre de atividades. Ela media a coisa
-- errada. O que se quer saber é QUANTO do efetivo esteve disponível para a
-- finalidade da Divisão, e por que o resto não esteve -- e isso é uma conta de
-- TEMPO, que texto livre não faz.
--
-- A prova está no próprio documento: até 2025 a 6.1 tinha quatro colunas
-- (Serviços, Funções Administrativas, Dias não apresentado), e em 2026 elas
-- viraram duas (Militar, Atividades). A tabela deixou de medir. E o número
-- continua sendo usado: o fechamento de 2025 registra "2º Sgt Barreto (17%,
-- funções fora da DGEO desde 06 MAR)", que é 2 meses de 12.
--
-- Retrato mensal não sabe dizer o que aconteceu no dia 06 de março. Intervalo
-- sabe, e o mês passa a ser CONSULTA em vez de dado.
--
-- O QUE SE PERDE, e por que está aceito: o congelamento do posto. A linha do mês
-- guardava o posto da época, e agora ele vem do cadastro de hoje. Decisão do
-- chefe em 2026-08-02: o que importa é a associação com a PESSOA, e a promoção
-- não muda quem esteve na Divisão em março.

-- Passagem pela DGEO. Uma linha por passagem, e a mesma pessoa pode ter várias:
-- quem sai e volta tem duas, com o intervalo entre elas dizendo que ela não
-- estava. `data_fim` NULA é "sem previsão de saída", e é o caso comum.
CREATE TABLE dgeo.efetivo_periodo(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_inicio DATE NOT NULL,
  data_fim DATE,
  observacao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT efetivo_periodo_fim_apos_inicio
    CHECK (data_fim IS NULL OR data_fim >= data_inicio),
  -- A NÃO SOBREPOSIÇÃO É DO BANCO, e não do código. Duas passagens da mesma
  -- pessoa que se cruzam nem entram, e a regra vale para a tela, para o CLI,
  -- para a carga e para o `psql` de quem vier depois. Validar isso na aplicação
  -- deixaria a garantia a um `INSERT` de distância de ser furada.
  --
  -- O `[]` fecha os dois lados: quem sai no dia 30 e volta no dia 30 é
  -- sobreposição, e não continuidade. Com `data_fim` nula o intervalo é aberto
  -- para cima, que é exatamente "ainda está aqui".
  CONSTRAINT efetivo_periodo_sem_sobreposicao
    EXCLUDE USING gist (
      usuario_uuid WITH =,
      daterange(data_inicio, data_fim, '[]') WITH &&
    )
);

COMMENT ON TABLE dgeo.efetivo_periodo IS
    'Passagem de uma pessoa pela DGEO. data_fim NULA é "sem previsão de saída". Intervalos da mesma pessoa não se sobrepõem, e quem garante é o banco.';

CREATE INDEX idx_efetivo_periodo_usuario ON dgeo.efetivo_periodo (usuario_uuid);
CREATE INDEX idx_efetivo_periodo_inicio ON dgeo.efetivo_periodo (data_inicio);

-- O que tira a pessoa do trabalho da Divisão sem tirá-la da Divisão: função
-- acumulada fora da DGEO, licença para tratamento de saúde, curso, férias,
-- missão. `percentual` é quanto daquele tempo o impedimento consome.
--
-- A DESCRIÇÃO É TEXTO LIVRE, sem catálogo de tipo (chefe, 2026-08-02). Um
-- catálogo obrigaria a classificar antes de escrever, e a lista de motivos não
-- fecha: "Chefe do S5", "LTSP", "Curso PCE-EECN" e "Fiscal administrativo" não
-- pertencem a uma taxonomia que caiba num domínio de cinco linhas.
--
-- IMPEDIMENTOS PODEM SE SOBREPOR, ao contrário das passagens, e é o caso real:
-- o 1º Ten Raul Magno estava em LTSP E chefiando o S5. Os percentuais somam, e a
-- soma é truncada em 100% na leitura -- recusar a sobreposição negaria o fato.
CREATE TABLE dgeo.impedimento(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  descricao VARCHAR(255) NOT NULL,
  percentual SMALLINT NOT NULL CHECK (percentual BETWEEN 1 AND 100),
  data_inicio DATE NOT NULL,
  data_fim DATE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT impedimento_fim_apos_inicio
    CHECK (data_fim IS NULL OR data_fim >= data_inicio)
);

COMMENT ON TABLE dgeo.impedimento IS
    'O que tira a pessoa do trabalho da Divisão sem tirá-la da Divisão. data_fim NULA é "sem previsão de término". Impedimentos da mesma pessoa PODEM se sobrepor, e os percentuais somam.';

CREATE INDEX idx_impedimento_usuario ON dgeo.impedimento (usuario_uuid);
CREATE INDEX idx_impedimento_inicio ON dgeo.impedimento (data_inicio);

COMMIT;

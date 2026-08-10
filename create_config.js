import { existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { Command } from 'commander';
import bcrypt from 'bcryptjs';
import pgPromise from 'pg-promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pgp = pgPromise();

// SEM `minify`. O `er/limites.sql` traz o WKT da área de suprimento quebrado em
// literais adjacentes, que o PostgreSQL só concatena quando há QUEBRA DE LINHA
// entre eles. O minify troca a quebra por um espaço, os literais deixam de se
// juntar e a instalação nova morria em "erro de sintaxe" no meio de uma
// coordenada. O `globalSetup` do Jest sempre leu o arquivo cru, e por isso a
// suíte de banco passava enquanto `npm run config` estava quebrado.
const readSqlFile = (file) => {
  const fullPath = join(__dirname, file);
  return new pgp.QueryFile(fullPath, { minify: false });
};

const verifyDotEnv = () => {
  return existsSync(join(__dirname, 'server', 'config.env'));
};

// As chaves `MICRO_DB_*` saem SEMPRE, e vazias quando a telemetria nao foi
// configurada. Chave ausente e chave vazia querem dizer a MESMA coisa para
// `server/src/config.js` (as cinco sao opcionais, e sem as cinco a segunda
// conexao nem e montada), mas o arquivo escrito com elas em branco ENSINA o que
// existe a quem for ligar a telemetria depois -- que e o mesmo papel do
// `.env.example`, num arquivo que ninguem le por engano.
//
// AS TRES `PRODUCAO_DB_*` SAEM PELA MESMA REGRA, e a ausencia delas custou caro:
// ate 2026-08-09 este arquivo nao as escrevia, entao toda instalacao nova pelo
// caminho documentado (`node create_config.js`) subia com o subsistema de
// permissao no banco de EDICAO desligado em silencio -- 503 nas tres rotas de
// `/api/gerencia_producao/banco_dados` e o pacote da atividade sem a secao de
// acesso, sem ninguem descobrir no boot. Escritas em branco, elas dizem que
// existem.
const createDotEnv = (port, dbServer, dbPort, dbName, dbUser, dbPassword, dbUserReadonly, dbPasswordReadonly, micro, producao) => {
  const secret = randomBytes(64).toString('hex');
  const m = micro || {};
  const p = producao || {};

  const env = `PORT=${port}
DB_SERVER=${dbServer}
DB_PORT=${dbPort}
DB_NAME=${dbName}
DB_USER=${dbUser}
DB_PASSWORD=${dbPassword}
DB_USER_READONLY=${dbUserReadonly || ''}
DB_PASSWORD_READONLY=${dbPasswordReadonly || ''}
MICRO_DB_SERVER=${m.server || ''}
MICRO_DB_PORT=${m.port || ''}
MICRO_DB_NAME=${m.name || ''}
MICRO_DB_USER=${m.user || ''}
MICRO_DB_PASSWORD=${m.password || ''}
PRODUCAO_DB_ADMIN_USER=${p.adminUser || ''}
PRODUCAO_DB_ADMIN_PASSWORD=${p.adminPassword || ''}
PRODUCAO_DB_HOSTS=${p.hosts || ''}
JWT_SECRET=${secret}`;

  writeFileSync(join(__dirname, 'server', 'config.env'), env);
};

const givePermission = async ({ dbUser, dbPassword, dbPort, dbServer, dbName, connection }) => {
  if (!connection) {
    const connectionString = `postgres://${dbUser}:${dbPassword}@${dbServer}:${dbPort}/${dbName}`;
    connection = pgp(connectionString);
  }
  await connection.none(readSqlFile('./er/permissao.sql'), [dbUser]);
};

// Cria (se necessário) o usuário somente leitura usado nas URIs de camada do
// QGIS e aplica os grants de leitura (er/permissao_readonly.sql)
const giveReadonlyPermission = async ({ dbUser, dbPassword, dbPort, dbServer, dbName, roUser, roPassword }) => {
  const connectionString = `postgres://${dbUser}:${dbPassword}@${dbServer}:${dbPort}/${dbName}`;
  const connection = pgp(connectionString);

  const exists = await connection.oneOrNone('SELECT 1 FROM pg_roles WHERE rolname = $1', [roUser]);
  if (!exists) {
    await connection.none('CREATE ROLE $1:name LOGIN PASSWORD $2', [roUser, roPassword]);
  } else {
    console.log(
      chalk.yellow(`O usuário ${roUser} já existe no PostgreSQL. A senha atual foi mantida. Garanta que a senha informada corresponde à do usuário.`)
    );
  }

  await connection.none(readSqlFile('./er/permissao_readonly.sql'), [roUser, dbUser]);
};

/**
 * Cria o PRIMEIRO administrador, com senha. O `uuid` sai do default da coluna.
 *
 * O codigo de posto/graduacao e conferido contra `dominio.tipo_posto_grad` LIDO
 * DO BANCO, dentro da mesma transacao que acabou de carregar o dominio. A lista
 * NAO se copia para ca: copia apodrece, e o dia em que um posto entrar no
 * dominio o instalador estaria mentindo. Sem a conferencia, o codigo errado
 * morreria numa violacao de chave estrangeira que nao diz qual era o valor
 * certo.
 */
const insertAdminUser = async (admin, connection) => {
  const { login, senha, nome, nomeGuerra, tipoPostoGradId } = admin;

  const posto = await connection.oneOrNone(
    'SELECT code FROM dominio.tipo_posto_grad WHERE code = $<tipoPostoGradId>',
    { tipoPostoGradId }
  );

  if (!posto) {
    const opcoes = await connection.any(
      'SELECT code, nome FROM dominio.tipo_posto_grad ORDER BY code'
    );
    throw new Error(
      `Posto/graduação ${tipoPostoGradId} não existe. Opções: ` +
        opcoes.map((o) => `${o.code}=${o.nome}`).join(', ')
    );
  }

  // Custo 10, o mesmo de server/src/login/senha.js. Divergir aqui produziria um
  // hash que o login aceita mas com outro custo, e ninguem perceberia.
  const hash = await bcrypt.hash(senha, 10);

  await connection.none(
    `INSERT INTO dgeo.usuario (login, senha, nome, nome_guerra, tipo_posto_grad_id, administrador, ativo) VALUES
    ($<login>, $<hash>, $<nome>, $<nomeGuerra>, $<tipoPostoGradId>, TRUE, TRUE)`,
    { login, hash, nome, nomeGuerra, tipoPostoGradId }
  );
};

/**
 * Grava a INSTITUICAO que opera esta instalacao.
 *
 * O `er/dgeo.sql` ja semeia a linha com o 1o CGEO, e esta funcao a SOBRESCREVE
 * com o que foi respondido. A semente existe para o banco nunca ficar sem
 * resposta (a tabela e de linha unica, e um `GET /api/instituicao` sem linha e
 * um 404 em toda tela); a pergunta existe para outro Centro instalar o sistema
 * sem editar codigo.
 *
 * O CODIGO DA UG e conferido contra `dominio.ug` LIDO DO BANCO, dentro da mesma
 * transacao que acabou de carregar o dominio, pela mesma razao do posto do
 * primeiro administrador: a lista nao se copia para ca, e sem a conferencia o
 * codigo errado morreria numa violacao de chave estrangeira que nao diz quais
 * eram os codigos validos.
 *
 * UG VAZIA E UM CAMINHO DE PRIMEIRA CLASSE: a instalacao que nao usa o modulo
 * orcamento nao tem Unidade Gestora, e a coluna e anulavel de proposito.
 *
 * `data_modificacao` FICA NULA: instalar nao e modificar. A coluna passa a ter
 * valor no primeiro `PUT /api/instituicao`, que e quando existe alguem para
 * responder por ela.
 */
const updateInstituicao = async (instituicao, connection) => {
  const { nome, sigla, ugCode } = instituicao;

  if (ugCode) {
    const ug = await connection.oneOrNone(
      'SELECT code FROM dominio.ug WHERE code = $<ugCode>',
      { ugCode }
    );

    if (!ug) {
      const opcoes = await connection.any(
        'SELECT code, nome FROM dominio.ug ORDER BY code'
      );
      throw new Error(
        `Unidade Gestora ${ugCode} não existe. Opções: ` +
          opcoes.map((o) => `${o.code}=${o.nome}`).join(', ')
      );
    }
  }

  await connection.none(
    `UPDATE dgeo.instituicao
        SET nome = $<nome>, sigla = $<sigla>, ug_code = $<ugCode>
      WHERE id = 1`,
    { nome, sigla, ugCode: ugCode || null }
  );
};

const createDatabase = async (dbUser, dbPassword, dbPort, dbServer, dbName, admin, instituicao) => {
  const maintenanceDb = pgp(`postgres://${dbUser}:${dbPassword}@${dbServer}:${dbPort}/postgres`);
  await maintenanceDb.none('CREATE DATABASE $1:name', [dbName]);

  const connectionString = `postgres://${dbUser}:${dbPassword}@${dbServer}:${dbPort}/${dbName}`;
  const db = pgp(connectionString);

  await db.tx(async (t) => {
    await t.none(readSqlFile('./er/versao.sql'));
    await t.none(readSqlFile('./er/dominio.sql'));
    await t.none(readSqlFile('./er/dgeo.sql'));
    // A auditoria nao tem chave estrangeira nenhuma, de proposito (o rastro
    // sobrevive ao registro e ao usuario apagados). Fica junto do schema da
    // identidade, de quem ela guarda o nome.
    await t.none(readSqlFile('./er/auditoria.sql'));
    // Antes de acervo: o filtro por municipio do acervo e do ponto de controle
    // consulta `limites`, que e tambem o primeiro arquivo com geometria.
    await t.none(readSqlFile('./er/limites.sql'));
    // Antes de mapoteca e de orcamento, que referenciam pit.meta. Depois de
    // dgeo, porque a meta guarda o usuario de cadastramento.
    await t.none(readSqlFile('./er/pit.sql'));
    await t.none(readSqlFile('./er/acervo.sql'));
    // Depois de acervo: o ponto_controle referencia acervo.lote e
    // acervo.volume_armazenamento, e acrescenta um CHECK em acervo.produto.
    await t.none(readSqlFile('./er/ponto_controle.sql'));
    await t.none(readSqlFile('./er/acompanhamento.sql'));
    await t.none(readSqlFile('./er/mapoteca.sql'));
    await t.none(readSqlFile('./er/orcamento.sql'));
    // Depois de dgeo, de onde vem a extensao btree_gist que o EXCLUDE das
    // tabelas de intervalo exige, e depois de dominio, que traz a linha do
    // modulo `equipamento`. Nao depende dos outros modulos: nenhuma chave
    // estrangeira sai dele para acervo, mapoteca, orcamento ou pit.
    await t.none(readSqlFile('./er/equipamento.sql'));
    // Depois de pit (o ano do campo aponta pit.exercicio), de acervo (o vinculo
    // opcional aponta acervo.versao) e de dgeo (o militar aponta dgeo.usuario).
    // Antes de rpcmtec, que le este schema para calcular a subsecao 2.5.
    await t.none(readSqlFile('./er/campo.sql'));
    // Depois de dgeo e de dominio, que a edicao referencia. O RPCMTec e da
    // Divisao inteira e nao depende dos tres modulos: ele os CONSULTA em tempo
    // de geracao, sem chave estrangeira para eles.
    await t.none(readSqlFile('./er/rpcmtec.sql'));
    // O CORE DE PRODUCAO, e a ordem entre os quatro nao e negociavel.
    //
    // `qgis` vem primeiro porque `producao` referencia o catalogo de estilo, de
    // menu, de modelo e de regra que o SAP Gerente carrega. `producao` vem
    // depois de `acervo` (a etapa, o bloco e a unidade de trabalho apontam
    // acervo.lote, e o relacionamento_versao aponta acervo.versao), depois de `dgeo` (toda
    // autoria e UUID de usuario) e depois de `dominio` (os 15 dominios novos).
    // `metadado` vem depois de `producao`, que ele referencia, e
    // `acompanhamento_producao` por ultimo, porque as funcoes dele leem as
    // tabelas dos tres.
    await t.none(readSqlFile('./er/qgis.sql'));
    await t.none(readSqlFile('./er/producao.sql'));
    await t.none(readSqlFile('./er/metadado.sql'));
    // NAO confundir com `er/acompanhamento.sql`, que ja foi aplicado acima e
    // que, apesar do nome, cria as views materializadas do ACERVO.
    await t.none(readSqlFile('./er/acompanhamento_producao.sql'));
    // `microcontrole` por ULTIMO entre os do core, e nao por sobra: ele
    // referencia `producao.subfase`, `acervo.lote` e `dgeo.usuario`, e NINGUEM
    // referencia ele. Sao as DUAS tabelas do banco principal (o perfil que diz o
    // que monitorar); as outras tres, a telemetria em si, moram num banco
    // SEPARADO instalado por `er_microcontrole/` -- ver `createMicroDatabase`
    // mais abaixo, e o cabecalho de `er/microcontrole.sql`.
    await t.none(readSqlFile('./er/microcontrole.sql'));
    await givePermission({ dbUser, connection: t });
    await insertAdminUser(admin, t);
    // DEPOIS do `er/dgeo.sql`, que criou a tabela e semeou a linha do 1o CGEO.
    // Na mesma transacao: um banco que subisse com o administrador certo e a
    // instituicao errada teria de ser corrigido por rota, e a rota e do
    // administrador que talvez nem consiga entrar ainda.
    await updateInstituicao(instituicao, t);
  });
};

/**
 * O BANCO DA TELEMETRIA, que e OUTRO banco e por isso tem instalacao PROPRIA.
 *
 * POR QUE ELE NAO ENTRA NA TRANSACAO DE `createDatabase`. Porque nao ha uma
 * transacao que abranja dois bancos: no PostgreSQL cada conexao transaciona
 * dentro do seu, e `CREATE DATABASE` nem sequer roda dentro de bloco. Se este
 * passo falhar, o banco do SAP ja esta criado e correto -- e isso e o
 * comportamento desejado, nao um acidente: **o servico sobe sem telemetria**, e
 * ligar a telemetria depois nao exige refazer nada. O contrario (derrubar a
 * instalacao inteira porque o outro servidor esta fora do ar) trocaria uma
 * degradacao tolerada por uma falha total.
 *
 * POR QUE ELE FICA AQUI, E NAO NUM SCRIPT A PARTE. Porque as chaves `MICRO_DB_*`
 * do `config.env` e o banco que elas apontam sao a MESMA decisao, tomada no
 * mesmo minuto por quem instala. Um script separado deixaria o par se desencontrar:
 * chave escrita apontando banco que ninguem criou, ou banco criado que chave
 * nenhuma alcanca. As perguntas sao opcionais, e responder "nao" e um caminho
 * de primeira classe.
 *
 * `--no-micro` (ou responder que nao) escreve as cinco chaves VAZIAS. Nesse
 * estado as cinco rotas de `/api/microcontrole` que leem o banco principal
 * funcionam, e as seis que leem a telemetria respondem 503 dizendo isso. Ver
 * `server/src/database/db.js`.
 */
const createMicroDatabase = async ({ microServer, microPort, microName, microUser, microPassword }) => {
  const maintenanceDb = pgp(
    `postgres://${microUser}:${microPassword}@${microServer}:${microPort}/postgres`
  );
  await maintenanceDb.none('CREATE DATABASE $1:name', [microName]);

  const db = pgp(
    `postgres://${microUser}:${microPassword}@${microServer}:${microPort}/${microName}`
  );

  await db.tx(async (t) => {
    await t.none(readSqlFile('./er_microcontrole/versao.sql'));
    await t.none(readSqlFile('./er_microcontrole/microcontrole.sql'));
    await t.none(readSqlFile('./er_microcontrole/permissao.sql'), [microUser]);
  });
};

const handleError = (error) => {
  if (error.message?.includes('permission denied to create database')) {
    console.log(
      chalk.red('O usuário informado não é superusuário. Sem permissão para criar bancos de dados.')
    );
  } else if (error.message?.includes('permission denied to create extension')) {
    console.log(
      chalk.red(
        'O usuário informado não é superusuário. Sem permissão para criar a extensão "postgis". Delete o banco de dados criado antes de executar a configuração novamente.'
      )
    );
  } else if (error.message?.includes('already exists')) {
    console.log(chalk.red('O banco já existe.'));
  } else if (error.message?.includes('password authentication failed')) {
    console.log(chalk.red('Senha inválida para o usuário'));
  } else {
    // NUNCA imprima o objeto de erro inteiro. O erro do pg-promise carrega
    // `query` e `values`, e as duas consultas que este arquivo monta levam a
    // senha do banco (a string de conexao) e a do administrador (o CREATE ROLE
    // do usuario somente leitura). Impresso no terminal, o segredo vai parar no
    // scrollback e no log do deploy.
    console.log(chalk.red(error.message));
    if (error.code) console.log(chalk.red(`codigo: ${error.code}`));
    if (error.detail) console.log(chalk.red(`detalhe: ${error.detail}`));
    if (error.hint) console.log(chalk.red(`dica: ${error.hint}`));
  }
  process.exit(1);
};

const validatePort = (value) => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return 'Informe um número de porta válido (1-65535)';
  }
  return true;
};

// A LISTA DE SERVIDORES DE EDICAO, conferida ANTES de virar linha do config.env.
//
// O ERRO QUE ELA PEGA e o de quem cola `servidor:porta/banco` inteiro, que e o
// formato do campo `configuracao_producao` e nao o desta chave: a lista e de
// SERVIDOR, com porta opcional. Sem a conferencia, o item errado nunca casaria
// com alvo nenhum e o sintoma seria 503 dizendo "o servidor nao esta na lista"
// com o servidor escrito na lista, que e o pior tipo de mensagem.
const validateHosts = (value) => {
  const itens = String(value || '')
    .split(',')
    .map((i) => i.trim())
    .filter(Boolean);

  if (!itens.length) return 'Informe ao menos um servidor';

  for (const item of itens) {
    if (item.includes('/')) {
      return `"${item}": a lista é de servidor, sem o nome do banco. Use servidor ou servidor:porta.`;
    }
    const partes = item.split(':');
    if (partes.length > 2) return `"${item}": formato inválido. Use servidor ou servidor:porta.`;
    if (partes.length === 2) {
      const validacao = validatePort(partes[1]);
      if (validacao !== true) return `"${item}": ${validacao}`;
    }
  }

  return true;
};

const getConfigFromUser = (options) => {
  const questions = [];

  if (!options.dbServer) {
    questions.push({
      type: 'input',
      name: 'dbServer',
      message: 'Qual o endereço de IP do servidor do banco de dados PostgreSQL?'
    });
  }
  if (!options.dbPort) {
    questions.push({
      type: 'input',
      name: 'dbPort',
      message: 'Qual a porta do servidor do banco de dados PostgreSQL?',
      default: 5432,
      validate: validatePort,
      filter: Number
    });
  }
  if (!options.dbUser) {
    questions.push({
      type: 'input',
      name: 'dbUser',
      message:
        'Qual o nome do usuário do PostgreSQL para interação com o SAP (já existente no banco de dados e ser superusuario)?'
    });
  }
  if (!options.dbPassword) {
    questions.push({
      type: 'password',
      name: 'dbPassword',
      mask: '*',
      message: 'Qual a senha do usuário do PostgreSQL para interação com o SAP?'
    });
  }
  if (!options.dbName) {
    questions.push({
      type: 'input',
      name: 'dbName',
      message: 'Qual o nome do banco de dados do SAP?',
      default: 'sca'
    });
  }
  if (!options.port) {
    questions.push({
      type: 'input',
      name: 'port',
      message: 'Qual a porta do servidor do SAP?',
      default: 3015,
      validate: validatePort,
      filter: Number
    });
  }
  // === undefined: com --no-db-create o commander entrega false, e !false
  // re-perguntaria interativamente, ignorando o flag explícito
  if (options.dbCreate === undefined) {
    questions.push({
      type: 'confirm',
      name: 'dbCreate',
      message: 'Deseja criar o banco de dados do SAP?',
      default: true
    });
  }
  // Habilitado se: usuário readonly passado por flag, ou --db-readonly,
  // ou resposta afirmativa na pergunta interativa
  const readonlyEnabled = (answers) => {
    if (options.dbUserReadonly) return true;
    if (options.dbReadonly !== undefined) return options.dbReadonly;
    return answers.dbReadonly;
  };

  if (options.dbReadonly === undefined && !options.dbUserReadonly) {
    questions.push({
      type: 'confirm',
      name: 'dbReadonly',
      message:
        'Deseja configurar um usuário do PostgreSQL somente leitura para as camadas do QGIS (recomendado: evita expor a credencial principal nas URIs das camadas)?',
      default: true
    });
  }
  if (!options.dbUserReadonly) {
    questions.push({
      type: 'input',
      name: 'dbUserReadonly',
      message: 'Qual o nome do usuário somente leitura (será criado caso não exista)?',
      default: 'sca_readonly',
      when: readonlyEnabled
    });
  }
  if (!options.dbPasswordReadonly) {
    questions.push({
      type: 'password',
      name: 'dbPasswordReadonly',
      mask: '*',
      message: 'Qual a senha do usuário somente leitura?',
      validate: (value) => (value ? true : 'Informe uma senha'),
      when: readonlyEnabled
    });
  }
  // --- O banco da TELEMETRIA (microcontrole) ---------------------------------
  //
  // OPCIONAL, e responder "nao" e um caminho de primeira classe: sem ele o
  // servico sobe, as cinco rotas de perfil de monitoramento funcionam e as seis
  // de telemetria respondem 503. Ver `createMicroDatabase` acima.
  const microEnabled = (answers) => {
    if (options.micro !== undefined) return options.micro;
    return answers.micro;
  };

  if (options.micro === undefined) {
    questions.push({
      type: 'confirm',
      name: 'micro',
      message:
        'Deseja configurar o banco de telemetria do microcontrole (outro banco, que guarda o que o plugin do QGIS captura enquanto a pessoa trabalha)?',
      default: false
    });
  }
  if (!options.microServer) {
    questions.push({
      type: 'input',
      name: 'microServer',
      message: 'Qual o endereço de IP do servidor PostgreSQL do banco de telemetria?',
      when: microEnabled,
      validate: (value) => (value ? true : 'Informe o endereço')
    });
  }
  if (!options.microPort) {
    questions.push({
      type: 'input',
      name: 'microPort',
      message: 'Qual a porta do servidor PostgreSQL do banco de telemetria?',
      default: 5432,
      when: microEnabled,
      validate: validatePort,
      filter: Number
    });
  }
  if (!options.microName) {
    questions.push({
      type: 'input',
      name: 'microName',
      message: 'Qual o nome do banco de telemetria?',
      default: 'sca_microcontrole',
      when: microEnabled
    });
  }
  if (!options.microUser) {
    questions.push({
      type: 'input',
      name: 'microUser',
      message:
        'Qual o usuário do PostgreSQL do banco de telemetria (superusuário, se este script for criá-lo: a extensão postgis exige)?',
      when: microEnabled,
      validate: (value) => (value ? true : 'Informe o usuário')
    });
  }
  if (!options.microPassword) {
    questions.push({
      type: 'password',
      name: 'microPassword',
      mask: '*',
      message: 'Qual a senha do usuário do banco de telemetria?',
      when: microEnabled,
      validate: (value) => (value ? true : 'Informe uma senha')
    });
  }
  if (options.microCreate === undefined) {
    questions.push({
      type: 'confirm',
      name: 'microCreate',
      message: 'Deseja criar o banco de telemetria agora (responda não se ele já existe)?',
      default: true,
      when: microEnabled
    });
  }
  // --- Administracao dos bancos de EDICAO (login temporario da producao) -----
  //
  // OPCIONAL, e responder "nao" e um caminho de primeira classe: sem as tres
  // chaves o servico sobe inteiro, e o que responde 503 sao as tres rotas de
  // `/api/gerencia_producao/banco_dados`. Este script NAO cria banco nenhum aqui
  // -- os bancos de edicao ja existem, e sao de outra instalacao -- e por isso
  // nao ha pergunta de "criar agora".
  //
  // A LISTA DE SERVIDORES NAO E ACESSORIO. O endereco do banco de edicao vem do
  // DADO (`producao.dado_producao.configuracao_producao`), digitado por um
  // gerente do modulo pela tela; sem a lista, quem digita aquele campo escolheria
  // para qual servidor o SAP manda o par de superusuario abaixo. Por isso as tres
  // valem juntas ou nenhuma, e `server/src/config.js` recusa o boot com meia
  // configuracao.
  const producaoEnabled = (answers) => {
    if (options.producaoDb !== undefined) return options.producaoDb;
    return answers.producaoDb;
  };

  if (options.producaoDb === undefined) {
    questions.push({
      type: 'confirm',
      name: 'producaoDb',
      message:
        'Deseja configurar o acesso administrativo aos bancos de EDIÇÃO (o que cria e revoga o usuário temporário do operador no PostGIS de produção)?',
      default: false
    });
  }
  if (!options.producaoDbHosts) {
    questions.push({
      type: 'input',
      name: 'producaoDbHosts',
      message:
        'Quais servidores PostgreSQL de edição esta instalação pode alcançar (separados por vírgula, no formato servidor ou servidor:porta)?',
      when: producaoEnabled,
      validate: validateHosts
    });
  }
  if (!options.producaoDbAdminUser) {
    questions.push({
      type: 'input',
      name: 'producaoDbAdminUser',
      message:
        'Qual o usuário superusuário do PostgreSQL nos bancos de edição (é com ele que o SAP cria o papel temporário e concede permissão camada a camada)?',
      when: producaoEnabled,
      validate: (value) => (value ? true : 'Informe o usuário')
    });
  }
  if (!options.producaoDbAdminPassword) {
    questions.push({
      type: 'password',
      name: 'producaoDbAdminPassword',
      mask: '*',
      message: 'Qual a senha desse superusuário dos bancos de edição?',
      when: producaoEnabled,
      validate: (value) => (value ? true : 'Informe uma senha')
    });
  }

  // O primeiro administrador so faz sentido quando o banco esta sendo CRIADO:
  // com --no-db-create ele ja existe na base que se esta reaproveitando.
  const criaBanco = (answers) => {
    if (options.dbCreate !== undefined) return options.dbCreate;
    return answers.dbCreate;
  };

  if (!options.adminLogin) {
    questions.push({
      type: 'input',
      name: 'adminLogin',
      message: 'Qual o login do primeiro administrador do SAP?',
      when: criaBanco,
      validate: (value) => (value ? true : 'Informe um login')
    });
  }
  if (!options.adminSenha) {
    questions.push({
      type: 'password',
      name: 'adminSenha',
      mask: '*',
      message: 'Qual a senha do primeiro administrador do SAP?',
      when: criaBanco,
      validate: (value) => (value ? true : 'Informe uma senha')
    });
    // A confirmacao existe porque a senha vai MASCARADA e este e o unico
    // caminho de entrada no sistema recem-instalado: um erro de digitacao aqui
    // so apareceria no primeiro login, sem ninguem para resetar a senha.
    questions.push({
      type: 'password',
      name: 'adminSenhaConfirmacao',
      mask: '*',
      message: 'Repita a senha do primeiro administrador:',
      when: (answers) => criaBanco(answers) && !options.adminSenha,
      validate: (value, answers) =>
        value === answers.adminSenha ? true : 'As senhas não conferem'
    });
  }
  if (!options.adminNome) {
    questions.push({
      type: 'input',
      name: 'adminNome',
      message: 'Qual o nome completo do primeiro administrador?',
      when: criaBanco,
      validate: (value) => (value ? true : 'Informe o nome')
    });
  }
  if (!options.adminNomeGuerra) {
    questions.push({
      type: 'input',
      name: 'adminNomeGuerra',
      message: 'Qual o nome de guerra do primeiro administrador?',
      when: criaBanco,
      validate: (value) => (value ? true : 'Informe o nome de guerra')
    });
  }
  if (!options.adminPostoGrad) {
    questions.push({
      type: 'input',
      name: 'adminPostoGrad',
      message:
        'Qual o código do posto/graduação do primeiro administrador (1=Civil, 13=Capitão, 16=Coronel; a lista completa está em er/dominio.sql)?',
      default: 1,
      when: criaBanco,
      filter: Number,
      validate: (value) =>
        Number.isInteger(value) && value > 0
          ? true
          : 'Informe um código inteiro positivo'
    });
  }

  // --- A INSTITUICAO que opera esta instalacao -------------------------------
  //
  // AS TRES PERGUNTAS SO VALEM COM CRIACAO DE BANCO, pela mesma razao do
  // primeiro administrador: com `--no-db-create` a linha ja existe na base que
  // se esta reaproveitando, e sobrescreve-la aqui trocaria o Centro de uma
  // instalacao em uso sem ninguem ter pedido. Trocar depois e pela tela, com
  // `PUT /api/instituicao`, que e do administrador e fica no rastro.
  //
  // O 1o CGEO E O PADRAO, e nao a unica resposta: quem instala em outro Centro
  // digita os tres e nao edita uma linha de codigo. Era exatamente isso que o
  // `e_1cgeo` de `limites.area_suprimento` impedia.
  //
  // ELA E DADO, E NAO CHAVE DE `config.env`: mora no banco justamente para poder
  // ser trocada pela tela sem reiniciar o servico. Por isso nenhuma das tres
  // aparece em `.env.example`.
  if (!options.omNome) {
    questions.push({
      type: 'input',
      name: 'omNome',
      message: 'Qual o nome por extenso da OM que opera esta instalação?',
      default: '1º Centro de Geoinformação',
      when: criaBanco,
      validate: (value) => (value ? true : 'Informe o nome por extenso')
    });
  }
  if (!options.omSigla) {
    questions.push({
      type: 'input',
      name: 'omSigla',
      message: 'Qual a sigla dessa OM (aparece em cabeçalho e em nome de arquivo)?',
      default: '1º CGEO',
      when: criaBanco,
      validate: (value) => (value ? true : 'Informe a sigla')
    });
  }
  if (!options.omUg) {
    questions.push({
      type: 'input',
      name: 'omUg',
      message:
        'Qual o código da Unidade Gestora dessa OM (a lista está em er/dominio.sql; deixe em branco se a instalação não usa o módulo orçamento)?',
      default: '160382',
      when: criaBanco
    });
  }

  return { questions };
};

const createConfig = async (options) => {
  try {
    console.log(chalk.blue('Sistema de Apoio à Produção (SAP)'));
    console.log(chalk.blue('Criação do arquivo de configuração'));

    if (!options.overwriteEnv) {
      const exists = verifyDotEnv();
      if (exists) {
        throw new Error(
          'Arquivo config.env já existe, apague antes de iniciar a configuração.'
        );
      }
    }

    const { questions } = getConfigFromUser(options);
    const {
      port,
      dbServer,
      dbPort,
      dbName,
      dbUser,
      dbPassword,
      dbCreate,
      dbUserReadonly,
      dbPasswordReadonly,
      adminLogin,
      adminSenha,
      adminNome,
      adminNomeGuerra,
      adminPostoGrad,
      omNome,
      omSigla,
      omUg,
      micro,
      microServer,
      microPort,
      microName,
      microUser,
      microPassword,
      microCreate,
      producaoDb,
      producaoDbHosts,
      producaoDbAdminUser,
      producaoDbAdminPassword
    } = { ...options, ...(await inquirer.prompt(questions)) };

    // As perguntas interativas passam por `validatePort`; as FLAGS nao passavam
    // por nada, entao `--port abc` escrevia PORT=abc no config.env e o servico
    // so reclamava no boot seguinte, longe de quem digitou.
    for (const [nome, valor] of [['--port', port], ['--db-port', dbPort]]) {
      const validacao = validatePort(valor);
      if (validacao !== true) throw new Error(`${nome}: ${validacao}`);
    }

    // As CINCO chaves da telemetria valem juntas ou nenhuma. Metade delas
    // escreveria um `config.env` que o `server/src/config.js` recusa no boot
    // (`Joi.and`), e o erro apareceria no deploy, longe de quem digitou.
    const microFields = { microServer, microPort, microName, microUser, microPassword };
    const microConfigured = Object.values(microFields).every(Boolean);
    if (micro || Object.values(microFields).some(Boolean)) {
      const faltando = Object.entries(microFields)
        .filter(([, v]) => !v)
        .map(([k]) => k);
      if (faltando.length) {
        throw new Error(
          `Dados do banco de telemetria incompletos: ${faltando.join(', ')}. As cinco chaves valem juntas ou nenhuma.`
        );
      }
      const validacao = validatePort(microPort);
      if (validacao !== true) throw new Error(`--micro-port: ${validacao}`);
    }

    // AS TRES CHAVES DO BANCO DE EDICAO valem juntas ou nenhuma, pela mesma
    // regra das cinco acima e pelo motivo mais duro: credencial de superusuario
    // sem lista de servidores e justamente o defeito que a lista fecha. Metade
    // delas escreveria um `config.env` que o `server/src/config.js` recusa no
    // boot (`Joi.and`), e o erro apareceria no deploy, longe de quem digitou.
    const producaoFields = { producaoDbAdminUser, producaoDbAdminPassword, producaoDbHosts };
    const producaoConfigured = Object.values(producaoFields).every(Boolean);
    if (producaoDb || Object.values(producaoFields).some(Boolean)) {
      const faltando = Object.entries(producaoFields)
        .filter(([, v]) => !v)
        .map(([k]) => k);
      if (faltando.length) {
        throw new Error(
          `Dados do acesso administrativo aos bancos de edição incompletos: ${faltando.join(', ')}. As três chaves valem juntas ou nenhuma.`
        );
      }
      const validacao = validateHosts(producaoDbHosts);
      if (validacao !== true) throw new Error(`--producao-db-hosts: ${validacao}`);
    }

    const readonlyConfigured = Boolean(dbUserReadonly && dbPasswordReadonly);

    if (dbCreate) {
      const admin = {
        login: adminLogin,
        senha: adminSenha,
        nome: adminNome,
        nomeGuerra: adminNomeGuerra,
        tipoPostoGradId: Number(adminPostoGrad)
      };

      // Falha ANTES de criar o banco. Descobrir que falta o nome de guerra
      // depois do CREATE DATABASE deixaria uma base pela metade, e a proxima
      // tentativa esbarraria em "o banco ja existe".
      //
      // O NaN entra na lista porque `Number(undefined)` e NaN, e nao undefined:
      // sem ele, o posto ausente passava por aqui e morria depois, no banco ja
      // criado, com a mensagem "Posto/graduacao NaN nao existe".
      const faltando = Object.entries(admin)
        .filter(
          ([, v]) =>
            v === undefined || v === null || v === '' || Number.isNaN(v)
        )
        .map(([k]) => k);
      if (faltando.length) {
        throw new Error(
          `Dados do primeiro administrador incompletos: ${faltando.join(', ')}`
        );
      }

      // A INSTITUICAO, pela mesma regra e pelo mesmo motivo: falhar ANTES do
      // CREATE DATABASE. A UG fica de fora da conferencia porque VAZIO e um
      // valor legitimo dela -- a instalacao que nao usa o orcamento nao tem UG.
      const instituicao = {
        nome: omNome,
        sigla: omSigla,
        ugCode: omUg ? String(omUg).trim() : null
      };

      const faltandoOm = ['nome', 'sigla'].filter(
        (k) => instituicao[k] === undefined || instituicao[k] === null || instituicao[k] === ''
      );
      if (faltandoOm.length) {
        throw new Error(
          `Dados da instituição incompletos: ${faltandoOm.join(', ')}`
        );
      }

      await createDatabase(dbUser, dbPassword, dbPort, dbServer, dbName, admin, instituicao);

      console.log(
        chalk.blue('Banco de dados do Sistema de Apoio à Produção (SAP) criado com sucesso!')
      );
      console.log(
        chalk.blue(`Administrador ${adminLogin} criado. É com ele que se entra no sistema pela primeira vez.`)
      );
      console.log(
        chalk.blue(`Instituição desta instalação: ${instituicao.sigla} (${instituicao.nome})${instituicao.ugCode ? `, UG ${instituicao.ugCode}` : ', sem Unidade Gestora'}. Ela se altera pela tela, com PUT /api/instituicao.`)
      );
    } else {
      await givePermission({ dbUser, dbPassword, dbPort, dbServer, dbName });

      console.log(chalk.blue(`Permissão ao usuário ${dbUser} adicionada com sucesso`));
    }

    if (readonlyConfigured) {
      await giveReadonlyPermission({
        dbUser,
        dbPassword,
        dbPort,
        dbServer,
        dbName,
        roUser: dbUserReadonly,
        roPassword: dbPasswordReadonly
      });

      console.log(
        chalk.blue(`Usuário somente leitura ${dbUserReadonly} configurado com sucesso (camadas QGIS)`)
      );
    }

    // DEPOIS do banco principal, e a ordem importa: se a telemetria falhar, o
    // que ja foi feito continua valendo e a mensagem diz exatamente o que
    // faltou. Ver o cabecalho de `createMicroDatabase`.
    if (microConfigured && microCreate) {
      await createMicroDatabase({ microServer, microPort, microName, microUser, microPassword });

      console.log(
        chalk.blue(`Banco de telemetria do microcontrole (${microName}) criado com sucesso!`)
      );
    } else if (microConfigured) {
      console.log(
        chalk.blue(`Banco de telemetria do microcontrole (${microName}) apontado sem ser criado. Garanta que ele já tem o schema de er_microcontrole/.`)
      );
    } else {
      console.log(
        chalk.yellow('Sem banco de telemetria: as rotas de microcontrole que leem telemetria vão responder 503. O restante do serviço sobe normalmente.')
      );
    }

    if (producaoConfigured) {
      console.log(
        chalk.blue(`Acesso administrativo aos bancos de edição configurado. O SAP só vai discar para os servidores listados em PRODUCAO_DB_HOSTS, e o cadastro de dado de produção que apontar outro servidor responde 503.`)
      );
    } else {
      console.log(
        chalk.yellow('Sem acesso administrativo aos bancos de edição: as três rotas de /api/gerencia_producao/banco_dados vão responder 503 e o pacote da atividade sai sem a seção de acesso. O restante do serviço sobe normalmente.')
      );
    }

    createDotEnv(
      port,
      dbServer,
      dbPort,
      dbName,
      dbUser,
      dbPassword,
      readonlyConfigured ? dbUserReadonly : '',
      readonlyConfigured ? dbPasswordReadonly : '',
      microConfigured
        ? {
            server: microServer,
            port: microPort,
            name: microName,
            user: microUser,
            password: microPassword
          }
        : null,
      producaoConfigured
        ? {
            adminUser: producaoDbAdminUser,
            adminPassword: producaoDbAdminPassword,
            hosts: producaoDbHosts
          }
        : null
    );

    console.log(chalk.blue('Arquivo de configuração (config.env) criado com sucesso!'));
  } catch (e) {
    handleError(e);
  } finally {
    pgp.end();
  }
};

const program = new Command();

program
  .option('--db-server <value>', 'Endereço de IP do servidor do banco de dados PostgreSQL')
  .option('--db-port <value>', 'Porta do servidor do banco de dados PostgreSQL')
  .option('--db-user <value>', 'Usuário do PostgreSQL para interação com o SAP')
  .option('--db-password <value>', 'Senha do usuário do PostgreSQL para interação com o SAP')
  .option('--db-name <value>', 'Nome do banco de dados do SAP')
  .option('--port <value>', 'Porta do servidor do SAP')
  .option('--db-create', 'Criar banco de dados do SAP')
  .option('--no-db-create', 'Não criar banco de dados do SAP')
  .option('--db-readonly', 'Configurar usuário somente leitura para as camadas QGIS')
  .option('--no-db-readonly', 'Não configurar usuário somente leitura')
  .option('--db-user-readonly <value>', 'Usuário do PostgreSQL somente leitura (criado caso não exista)')
  .option('--db-password-readonly <value>', 'Senha do usuário somente leitura')
  // Primeiro administrador do SAP. So valem com criacao de banco: sem ela a
  // pessoa ja existe na base que se esta reaproveitando.
  .option('--admin-login <value>', 'Login do primeiro administrador do SAP')
  .option('--admin-senha <value>', 'Senha do primeiro administrador do SAP')
  .option('--admin-nome <value>', 'Nome completo do primeiro administrador')
  .option('--admin-nome-guerra <value>', 'Nome de guerra do primeiro administrador')
  .option('--admin-posto-grad <value>', 'Código do posto/graduação do primeiro administrador (dominio.tipo_posto_grad)')
  // A INSTITUICAO que opera esta instalacao. So vale com criacao de banco, pela
  // mesma razao das flags do administrador: sem ela a linha ja existe na base
  // que se esta reaproveitando, e trocar o Centro de uma instalacao em uso e ato
  // de administrador, pela tela, com rastro.
  .option('--om-nome <value>', 'Nome por extenso da OM que opera esta instalação (padrão: 1º Centro de Geoinformação)')
  .option('--om-sigla <value>', 'Sigla da OM que opera esta instalação (padrão: 1º CGEO)')
  .option('--om-ug <value>', 'Código da Unidade Gestora da OM (dominio.ug; vazio se a instalação não usa o módulo orçamento)')
  // O banco da TELEMETRIA (microcontrole). Opcional, e as cinco chaves valem
  // juntas ou nenhuma: sem elas o serviço sobe e as seis rotas de telemetria
  // respondem 503.
  .option('--micro', 'Configurar o banco de telemetria do microcontrole')
  .option('--no-micro', 'Não configurar o banco de telemetria do microcontrole')
  .option('--micro-server <value>', 'Endereço do servidor PostgreSQL do banco de telemetria')
  .option('--micro-port <value>', 'Porta do servidor PostgreSQL do banco de telemetria')
  .option('--micro-name <value>', 'Nome do banco de telemetria')
  .option('--micro-user <value>', 'Usuário do PostgreSQL do banco de telemetria')
  .option('--micro-password <value>', 'Senha do usuário do banco de telemetria')
  .option('--micro-create', 'Criar o banco de telemetria (aplica er_microcontrole/)')
  .option('--no-micro-create', 'Não criar o banco de telemetria (ele já existe)')
  // O acesso administrativo aos bancos de EDICAO. Opcional, e as tres chaves
  // valem juntas ou nenhuma: sem elas o servico sobe e as tres rotas de
  // /api/gerencia_producao/banco_dados respondem 503.
  .option('--producao-db', 'Configurar o acesso administrativo aos bancos de edição da produção')
  .option('--no-producao-db', 'Não configurar o acesso administrativo aos bancos de edição')
  .option('--producao-db-admin-user <value>', 'Usuário superusuário do PostgreSQL nos bancos de edição')
  .option('--producao-db-admin-password <value>', 'Senha do superusuário dos bancos de edição')
  .option('--producao-db-hosts <value>', 'Servidores de banco de edição que esta instalação pode alcançar (servidor ou servidor:porta, separados por vírgula)')
  .option('--overwrite-env', 'Sobrescrever arquivo de configuração');

program.parse(process.argv);
const options = program.opts();
await createConfig(options);
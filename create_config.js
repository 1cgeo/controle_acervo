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

const createDotEnv = (port, dbServer, dbPort, dbName, dbUser, dbPassword, dbUserReadonly, dbPasswordReadonly) => {
  const secret = randomBytes(64).toString('hex');

  const env = `PORT=${port}
DB_SERVER=${dbServer}
DB_PORT=${dbPort}
DB_NAME=${dbName}
DB_USER=${dbUser}
DB_PASSWORD=${dbPassword}
DB_USER_READONLY=${dbUserReadonly || ''}
DB_PASSWORD_READONLY=${dbPasswordReadonly || ''}
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

const createDatabase = async (dbUser, dbPassword, dbPort, dbServer, dbName, admin) => {
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
    // Depois de dgeo e de dominio, que a edicao referencia. O RPCMTec e da
    // Divisao inteira e nao depende dos tres modulos: ele os CONSULTA em tempo
    // de geracao, sem chave estrangeira para eles.
    await t.none(readSqlFile('./er/rpcmtec.sql'));
    await givePermission({ dbUser, connection: t });
    await insertAdminUser(admin, t);
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
        'Qual o nome do usuário do PostgreSQL para interação com o SCA (já existente no banco de dados e ser superusuario)?'
    });
  }
  if (!options.dbPassword) {
    questions.push({
      type: 'password',
      name: 'dbPassword',
      mask: '*',
      message: 'Qual a senha do usuário do PostgreSQL para interação com o SCA?'
    });
  }
  if (!options.dbName) {
    questions.push({
      type: 'input',
      name: 'dbName',
      message: 'Qual o nome do banco de dados do SCA?',
      default: 'sca'
    });
  }
  if (!options.port) {
    questions.push({
      type: 'input',
      name: 'port',
      message: 'Qual a porta do servidor do SCA?',
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
      message: 'Deseja criar o banco de dados do SCA?',
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
      message: 'Qual o login do primeiro administrador do SCA?',
      when: criaBanco,
      validate: (value) => (value ? true : 'Informe um login')
    });
  }
  if (!options.adminSenha) {
    questions.push({
      type: 'password',
      name: 'adminSenha',
      mask: '*',
      message: 'Qual a senha do primeiro administrador do SCA?',
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

  return { questions };
};

const createConfig = async (options) => {
  try {
    console.log(chalk.blue('Sistema de Controle do Acervo'));
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
      adminPostoGrad
    } = { ...options, ...(await inquirer.prompt(questions)) };

    // As perguntas interativas passam por `validatePort`; as FLAGS nao passavam
    // por nada, entao `--port abc` escrevia PORT=abc no config.env e o servico
    // so reclamava no boot seguinte, longe de quem digitou.
    for (const [nome, valor] of [['--port', port], ['--db-port', dbPort]]) {
      const validacao = validatePort(valor);
      if (validacao !== true) throw new Error(`${nome}: ${validacao}`);
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

      await createDatabase(dbUser, dbPassword, dbPort, dbServer, dbName, admin);

      console.log(
        chalk.blue('Banco de dados do Sistema de Controle do Acervo criado com sucesso!')
      );
      console.log(
        chalk.blue(`Administrador ${adminLogin} criado. É com ele que se entra no sistema pela primeira vez.`)
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

    createDotEnv(
      port,
      dbServer,
      dbPort,
      dbName,
      dbUser,
      dbPassword,
      readonlyConfigured ? dbUserReadonly : '',
      readonlyConfigured ? dbPasswordReadonly : ''
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
  .option('--db-user <value>', 'Usuário do PostgreSQL para interação com o SCA')
  .option('--db-password <value>', 'Senha do usuário do PostgreSQL para interação com o SCA')
  .option('--db-name <value>', 'Nome do banco de dados do SCA')
  .option('--port <value>', 'Porta do servidor do SCA')
  .option('--db-create', 'Criar banco de dados do SCA')
  .option('--no-db-create', 'Não criar banco de dados do SCA')
  .option('--db-readonly', 'Configurar usuário somente leitura para as camadas QGIS')
  .option('--no-db-readonly', 'Não configurar usuário somente leitura')
  .option('--db-user-readonly <value>', 'Usuário do PostgreSQL somente leitura (criado caso não exista)')
  .option('--db-password-readonly <value>', 'Senha do usuário somente leitura')
  // Primeiro administrador do SCA. So valem com criacao de banco: sem ela a
  // pessoa ja existe na base que se esta reaproveitando.
  .option('--admin-login <value>', 'Login do primeiro administrador do SCA')
  .option('--admin-senha <value>', 'Senha do primeiro administrador do SCA')
  .option('--admin-nome <value>', 'Nome completo do primeiro administrador')
  .option('--admin-nome-guerra <value>', 'Nome de guerra do primeiro administrador')
  .option('--admin-posto-grad <value>', 'Código do posto/graduação do primeiro administrador (dominio.tipo_posto_grad)')
  .option('--overwrite-env', 'Sobrescrever arquivo de configuração');

program.parse(process.argv);
const options = program.opts();
await createConfig(options);
import { existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { Command } from 'commander';
import axios from 'axios';
import pgPromise from 'pg-promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pgp = pgPromise();

const readSqlFile = (file) => {
  const fullPath = join(__dirname, file);
  return new pgp.QueryFile(fullPath, { minify: true });
};

const verifyDotEnv = () => {
  return existsSync(join(__dirname, 'server', 'config.env'));
};

const verifyAuthServer = async (authServer) => {
  if (!authServer.startsWith('http://') && !authServer.startsWith('https://')) {
    throw new Error('Servidor deve iniciar com http:// ou https://');
  }
  try {
    const response = await axios.get(`${authServer}/api`);
    const wrongServer =
      !response ||
      response.status !== 200 ||
      !('data' in response) ||
      response.data.message !== 'Serviço de autenticação operacional';

    if (wrongServer) {
      throw new Error();
    }
  } catch {
    throw new Error('Erro ao se comunicar com o servidor de autenticação');
  }
};

const getAuthUserData = async (servidor, token, uuid) => {
  const server = `${servidor}/api/usuarios/${uuid}`;

  try {
    const config = {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      }
    };
    const response = await axios.get(server, config);

    if (
      !('status' in response) ||
      response.status !== 200 ||
      !('data' in response) ||
      !('dados' in response.data)
    ) {
      throw new Error();
    }
    return response.data.dados;
  } catch {
    throw new Error('Erro ao se comunicar com o servidor de autenticação');
  }
};

const verifyLoginAuthServer = async (servidor, usuario, senha) => {
  const server = `${servidor}/api/login`;

  try {
    const response = await axios.post(server, {
      usuario,
      senha,
      aplicacao: 'sca_web'
    });
    if (
      !response ||
      !('status' in response) ||
      response.status !== 201 ||
      !('data' in response) ||
      !('dados' in response.data) ||
      !('success' in response.data) ||
      !('token' in response.data.dados) ||
      !('uuid' in response.data.dados)
    ) {
      throw new Error();
    }

    const authenticated = response.data.success || false;
    const authUserUUID = response.data.dados.uuid;
    const token = response.data.dados.token;

    const authUserData = await getAuthUserData(servidor, token, authUserUUID);
    return { authenticated, authUserData };
  } catch {
    throw new Error('Erro ao se comunicar com o servidor de autenticação');
  }
};

const createDotEnv = (port, dbServer, dbPort, dbName, dbUser, dbPassword, authServer) => {
  const secret = randomBytes(64).toString('hex');

  const env = `PORT=${port}
DB_SERVER=${dbServer}
DB_PORT=${dbPort}
DB_NAME=${dbName}
DB_USER=${dbUser}
DB_PASSWORD=${dbPassword}
JWT_SECRET=${secret}
AUTH_SERVER=${authServer}`;

  writeFileSync(join(__dirname, 'server', 'config.env'), env);
};

const givePermission = async ({ dbUser, dbPassword, dbPort, dbServer, dbName, connection }) => {
  if (!connection) {
    const connectionString = `postgres://${dbUser}:${dbPassword}@${dbServer}:${dbPort}/${dbName}`;
    connection = pgp(connectionString);
  }
  await connection.none(readSqlFile('./er/permissao.sql'), [dbUser]);
};

const insertAdminUser = async (authUserData, connection) => {
  const {
    login,
    nome,
    nome_guerra: nomeGuerra,
    tipo_posto_grad_id: tpgId,
    uuid
  } = authUserData;

  await connection.none(
    `INSERT INTO dgeo.usuario (login, nome, nome_guerra, tipo_posto_grad_id, administrador, ativo, uuid) VALUES
    ($<login>, $<nome>, $<nomeGuerra>, $<tpgId>, TRUE, TRUE, $<uuid>)`,
    { login, nome, nomeGuerra, tpgId, uuid }
  );
};

const createMaterializedViews = async (dbUser, dbPassword, dbPort, dbServer, dbName) => {
  const connectionString = `postgres://${dbUser}:${dbPassword}@${dbServer}:${dbPort}/${dbName}`;
  const db = pgp(connectionString);

  console.log(chalk.blue('Criando views materializadas...'));

  try {
    await db.none('SELECT acervo.criar_views_materializadas()');
    console.log(chalk.green('Views materializadas criadas com sucesso!'));
  } catch (error) {
    console.log(chalk.yellow(`Aviso: Erro ao criar views materializadas: ${error.message}`));
    console.log(chalk.yellow('As views podem ser criadas posteriormente via API'));
  }
};

const createDatabase = async (dbUser, dbPassword, dbPort, dbServer, dbName, authUserData) => {
  const maintenanceDb = pgp(`postgres://${dbUser}:${dbPassword}@${dbServer}:${dbPort}/postgres`);
  await maintenanceDb.none('CREATE DATABASE $1:name', [dbName]);

  const connectionString = `postgres://${dbUser}:${dbPassword}@${dbServer}:${dbPort}/${dbName}`;
  const db = pgp(connectionString);

  await db.tx(async (t) => {
    await t.none(readSqlFile('./er/versao.sql'));
    await t.none(readSqlFile('./er/dominio.sql'));
    await t.none(readSqlFile('./er/dgeo.sql'));
    await t.none(readSqlFile('./er/acervo.sql'));
    await t.none(readSqlFile('./er/acompanhamento.sql'));
    await t.none(readSqlFile('./er/mapoteca.sql'));
    await givePermission({ dbUser, connection: t });
    await insertAdminUser(authUserData, t);
  });

  await createMaterializedViews(dbUser, dbPassword, dbPort, dbServer, dbName);
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
    console.log(chalk.red(error.message));
    console.log('-------------------------------------------------');
    console.log(error);
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
  if (!options.dbCreate) {
    questions.push({
      type: 'confirm',
      name: 'dbCreate',
      message: 'Deseja criar o banco de dados do SCA?',
      default: true
    });
  }
  if (!options.authServerRaw) {
    questions.push({
      type: 'input',
      name: 'authServerRaw',
      message: 'Qual a URL do serviço de autenticação (iniciar com http:// ou https://)?'
    });
  }
  if (!options.authUser) {
    questions.push({
      type: 'input',
      name: 'authUser',
      message:
        'Qual o nome do usuário já existente Serviço de Autenticação que será administrador do SCA?'
    });
  }
  if (!options.authPassword) {
    questions.push({
      type: 'password',
      name: 'authPassword',
      mask: '*',
      message:
        'Qual a senha do usuário já existente Serviço de Autenticação que será administrador do SCA?'
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
      authServerRaw,
      authUser,
      authPassword
    } = { ...options, ...(await inquirer.prompt(questions)) };

    const authServer = authServerRaw.endsWith('/')
      ? authServerRaw.slice(0, -1)
      : authServerRaw;

    await verifyAuthServer(authServer);

    const { authenticated, authUserData } = await verifyLoginAuthServer(
      authServer,
      authUser,
      authPassword
    );

    if (!authenticated) {
      throw new Error('Usuário ou senha inválida no Serviço de Autenticação.');
    }

    if (dbCreate) {
      await createDatabase(dbUser, dbPassword, dbPort, dbServer, dbName, authUserData);

      console.log(
        chalk.blue('Banco de dados do Sistema de Controle do Acervo criado com sucesso!')
      );
    } else {
      await givePermission({ dbUser, dbPassword, dbPort, dbServer, dbName });

      console.log(chalk.blue(`Permissão ao usuário ${dbUser} adicionada com sucesso`));
    }

    createDotEnv(port, dbServer, dbPort, dbName, dbUser, dbPassword, authServer);

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
  .option('--auth-server-raw <value>', 'URL do serviço de autenticação (iniciar com http:// ou https://)')
  .option('--auth-user <value>', 'Usuário administrador do Serviço de Autenticação')
  .option('--auth-password <value>', 'Senha do usuário administrador do Serviço de Autenticação')
  .option('--overwrite-env', 'Sobrescrever arquivo de configuração');

program.parse(process.argv);
const options = program.opts();
await createConfig(options);

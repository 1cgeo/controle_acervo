"use strict";

const fs = require("fs");
const inquirer = require("inquirer");
const colors = require("colors"); // colors for console
colors.enable();

const pgtools = require("pgtools");
const path = require("path");
const promise = require("bluebird");
const crypto = require("crypto");
const axios = require("axios");

const pgp = require("pg-promise")({
  promiseLib: promise
});

const { Command } = require('commander')
const program = new Command()

const readSqlFile = file => {
  const fullPath = path.join(__dirname, file);
  return new pgp.QueryFile(fullPath, { minify: true });
};

const verifyDotEnv = () => {
  return fs.existsSync(path.join(__dirname, "server", "config.env"));
};

const verifyAuthServer = async authServer => {
  if (!authServer.startsWith("http://") && !authServer.startsWith("https://")) {
    throw new Error("Servidor deve iniciar com http:// ou https://");
  }
  try {
    const response = await axios.get(`${authServer}/api`);
    const wrongServer =
      !response ||
      response.status !== 200 ||
      !("data" in response) ||
      response.data.message !== "Serviço de autenticação operacional";

    if (wrongServer) {
      throw new Error();
    }
  } catch (e) {
    throw new Error("Erro ao se comunicar com o servidor de autenticação");
  }
};

const getAuthUserData = async (servidor, token, uuid) => {
  const server = `${servidor}/api/usuarios/${uuid}`;

  try {
    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    };
    const response = await axios.get(server, config);

    if (
      !("status" in response) ||
      response.status !== 200 ||
      !("data" in response) ||
      !("dados" in response.data)
    ) {
      throw new Error();
    }
    return response.data.dados;
  } catch (e) {
    throw new Error("Erro ao se comunicar com o servidor de autenticação");
  }
};

const verifyLoginAuthServer = async (servidor, usuario, senha) => {
  const server = `${servidor}/api/login`;

  try {
    const response = await axios.post(server, {
      usuario,
      senha,
      aplicacao: "sca_web"
    });
    if (
      !response ||
      !("status" in response) ||
      response.status !== 201 ||
      !("data" in response) ||
      !("dados" in response.data) ||
      !("success" in response.data) ||
      !("token" in response.data.dados) ||
      !("uuid" in response.data.dados)
    ) {
      throw new Error("");
    }

    const authenticated = response.data.success || false;
    const authUserUUID = response.data.dados.uuid;
    const token = response.data.dados.token;

    const authUserData = await getAuthUserData(servidor, token, authUserUUID);
    return { authenticated, authUserData };
  } catch (e) {
    throw new Error("Erro ao se comunicar com o servidor de autenticação");
  }
};

const createDotEnv = (
  port,
  dbServer,
  dbPort,
  dbName,
  dbUser,
  dbPassword,
  authServer
) => {
  const secret = crypto.randomBytes(64).toString("hex");

  const env = `PORT=${port}
DB_SERVER=${dbServer}
DB_PORT=${dbPort}
DB_NAME=${dbName}
DB_USER=${dbUser}
DB_PASSWORD=${dbPassword}
JWT_SECRET=${secret}
AUTH_SERVER=${authServer}`;

  fs.writeFileSync(path.join(__dirname, "server", "config.env"), env);
};

const givePermission = async ({
  dbUser,
  dbPassword,
  dbPort,
  dbServer,
  dbName,
  connection
}) => {
  if (!connection) {
    const connectionString = `postgres://${dbUser}:${dbPassword}@${dbServer}:${dbPort}/${dbName}`;

    connection = pgp(connectionString);
  }
  await connection.none(readSqlFile("./er/permissao.sql"), [dbUser]);
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
  
  console.log("Criando views materializadas...".blue);
  
  try {
    await db.none(`SELECT acervo.criar_views_materializadas()`);
    console.log("Views materializadas criadas com sucesso!".green);
  } catch (error) {
    console.log(`Aviso: Erro ao criar views materializadas: ${error.message}`.yellow);
    console.log("As views podem ser criadas posteriormente via API".yellow);
  }
};

const createDatabase = async (
  dbUser,
  dbPassword,
  dbPort,
  dbServer,
  dbName,
  authUserData
) => {
  const config = {
    user: dbUser,
    password: dbPassword,
    port: dbPort,
    host: dbServer
  };

  await pgtools.createdb(config, dbName);

  const connectionString = `postgres://${dbUser}:${dbPassword}@${dbServer}:${dbPort}/${dbName}`;

  const db = pgp(connectionString);
  await db.tx(async t => {
    await t.none(readSqlFile("./er/versao.sql"));
    await t.none(readSqlFile("./er/dominio.sql"));
    await t.none(readSqlFile("./er/dgeo.sql"));
    await t.none(readSqlFile("./er/acervo.sql"));
    await t.none(readSqlFile("./er/acompanhamento.sql"));
    await givePermission({ dbUser, connection: t });
    await insertAdminUser(authUserData, t);
  });

  await createMaterializedViews(dbUser, dbPassword, dbPort, dbServer, dbName);
};

const handleError = error => {
  if (
    error.message ===
    "Postgres error. Cause: permission denied to create database"
  ) {
    console.log(
      "O usuário informado não é superusuário. Sem permissão para criar bancos de dados."
        .red
    );
  } else if (
    error.message === 'permission denied to create extension "postgis"'
  ) {
    console.log(
      "O usuário informado não é superusuário. Sem permissão para criar a extensão 'postgis'. Delete o banco de dados criado antes de executar a configuração novamente."
        .red
    );
  } else if (
    error.message.startsWith("Attempted to create a duplicate database")
  ) {
    console.log("O banco já existe.".red);
  } else if (
    error.message.startsWith("password authentication failed for user")
  ) {
    console.log("Senha inválida para o usuário".red);
  } else {
    console.log(error.message.red);
    console.log("-------------------------------------------------");
    console.log(error);
  }
  process.exit(0);
};

const getConfigFromUser = options => {
  const questions = []
  
  if (!options.dbServer) {
    questions.push({
      type: 'input',
      name: 'dbServer',
      message: 'Qual o endereço de IP do servidor do banco de dados PostgreSQL?',
    })
  }
  if (!options.dbPort) {
    questions.push({
      type: 'input',
      name: 'dbPort',
      message: 'Qual a porta do servidor do banco de dados PostgreSQL?',
      default: 5432
    })
  }
  if (!options.dbUser) {
    questions.push({
      type: 'input',
      name: 'dbUser',
      message: 'Qual o nome do usuário do PostgreSQL para interação com o SCA (já existente no banco de dados e ser superusuario)?',
    })
  }
  if (!options.dbPassword) {
    questions.push({
      type: 'password',
      name: 'dbPassword',
      mask: '*',
      message: 'Qual a senha do usuário do PostgreSQL para interação com o SCA?', 
    })
  }
  if (!options.dbName) {
    questions.push({
      type: 'input',
      name: 'dbName',
      message: 'Qual o nome do banco de dados do SCA?',
      default: 'sca'
    })
  }
  if (!options.port) {
    questions.push({
      type: 'input',
      name: 'port',
      message: 'Qual a porta do servidor do SCA?',
      default: 3015
    })
  }
  if (!options.dbCreate) {
    questions.push({
      type: 'confirm',
      name: 'dbCreate',
      message: 'Deseja criar o banco de dados do SCA?',
      default: true
    })
  }
  if (!options.authServerRaw) {
    questions.push({
      type: 'input',
      name: 'authServerRaw',
      message:
        'Qual a URL do serviço de autenticação (iniciar com http:// ou https://)?',
    })
  }
  if (!options.authUser) {
    questions.push({
      type: 'input',
      name: 'authUser',
      message: 'Qual o nome do usuário já existente Serviço de Autenticação que será administrador do SCA?',
    })
  }
  if (!options.authPassword) {
    questions.push({
      type: 'password',
      name: 'authPassword',
      mask: '*',
      message: 'Qual a senha do usuário já existente Serviço de Autenticação que será administrador do SCA?',
    })
  }
  
  return { questions }
}

const createConfig = async (options) => {
  try {
    console.log("Sistema de Controle do Acervo".blue);
    console.log("Criação do arquivo de configuração".blue);

    if (!options.overwriteEnv) {
      const exists = verifyDotEnv()
      if (exists) {
        throw new Error(
          'Arquivo config.env já existe, apague antes de iniciar a configuração.'
        )
      }
    }

    let { questions } = getConfigFromUser(options)
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
    } = await inquirer.prompt(questions).then(async userAnswers => {
      const answers = { ...options, ...userAnswers }
      return answers
    })

    const authServer = authServerRaw.endsWith("/")
      ? authServerRaw.slice(0, -1)
      : authServerRaw;

    await verifyAuthServer(authServer);

    const { authenticated, authUserData } = await verifyLoginAuthServer(
      authServer,
      authUser,
      authPassword
    );

    if (!authenticated) {
      throw new Error("Usuário ou senha inválida no Serviço de Autenticação.");
    }

    if (dbCreate) {
      await createDatabase(
        dbUser,
        dbPassword,
        dbPort,
        dbServer,
        dbName,
        authUserData
      );

      console.log(
        "Banco de dados do Sistema de Controle do Acervo criado com sucesso!"
          .blue
      );
    } else {
      await givePermission({ dbUser, dbPassword, dbPort, dbServer, dbName });

      console.log(`Permissão ao usuário ${dbUser} adicionada com sucesso`.blue);
    }

    createDotEnv(
      port,
      dbServer,
      dbPort,
      dbName,
      dbUser,
      dbPassword,
      authServer
    );

    console.log(
      "Arquivo de configuração (config.env) criado com sucesso!".blue
    );
  } catch (e) {
    handleError(e);
  }
};

program
  .option('-dbServer, --db-server <type>', 'Endereço de IP do servidor do banco de dados PostgreSQL')
  .option('-dbPort, --db-port <type>', 'Porta do servidor do banco de dados PostgreSQL')
  .option('-dbUser, --db-user <type>', 'Usuário do PostgreSQL para interação com o SCA (já existente no banco de dados e ser superusuario)')
  .option('-dbPassword, --db-password <type>', 'Senha do usuário do PostgreSQL para interação com o SCA')
  .option('-dbName, --db-name <type>', 'Nome do banco de dados do SCA')
  .option('-port, --port <type>', 'Porta do servidor do SCA')
  .option('-dbCreate, --db-create', 'Criar banco de dados do SCA')
  .option('--no-db-create', 'Não criar banco de dados do SCA')
  .option('-authServerRaw, --auth-server-raw <type>', 'URL do serviço de autenticação (iniciar com http:// ou https://)')
  .option('-authUser, --auth-user <type>', 'Nome do usuário já existente Serviço de Autenticação que será administrador do SCA')
  .option('-authPassword, --auth-password <type>', 'Senha do usuário já existente Serviço de Autenticação que será administrador do SCA')
  .option('-overwriteEnv, --overwrite-env', 'Sobrescrever arquivo de configuração')
  

program.parse(process.argv)
const options = program.opts()
createConfig(options)

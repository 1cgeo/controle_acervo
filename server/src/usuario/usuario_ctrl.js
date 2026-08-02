"use strict";

const { db } = require("../database");

const { AppError, httpCode, preserveOmitted } = require("../utils");

const { loginCtrl, senha: senhaUtils } = require("../login");

const controller = {};

// Codigos de erro do PostgreSQL que esta feature traduz para frase de gente.
// Erro cru de banco vira 500 e esconde a causa, que aqui e sempre uma das duas
// abaixo. Mesmo padrao do `isUniqueViolation` do modulo orcamento.
const PG_UNIQUE_VIOLATION = "23505";
const PG_FOREIGN_KEY_VIOLATION = "23503";

const ehCodigo = (err, code) =>
  typeof err === "object" && err !== null && err.code === code;

controller.getUsuarios = async () => {
  // `perfis` vem como mapa modulo -> nivel ({ acervo: 1, mapoteca: 2 }), e nao
  // como coluna por modulo, para a tela nao mudar quando surgir outro modulo.
  //
  // `senha_definida` e um BOOLEANO derivado, nunca o hash: a coluna `senha` nao
  // sai desta feature por rota nenhuma. Ele existe porque a fusao de 2026-08-02
  // deixou `dgeo.usuario.senha` anulavel e quem a preenche e o
  // `scripts/copiar_usuarios_auth.js`, rodado por fora, uma vez. Sem esta
  // coluna, quem ficasse de fora da copia so apareceria ao reclamar que nao
  // consegue entrar.
  return db.conn.any(`
  SELECT u.uuid, u.login, u.nome, u.tipo_posto_grad_id, tpg.nome_abrev AS tipo_posto_grad, u.nome_guerra, u.administrador, u.ativo,
    (u.senha IS NOT NULL) AS senha_definida,
    COALESCE((
      SELECT json_object_agg(m.nome_abrev, up.perfil_id)
      FROM dgeo.usuario_perfil AS up
      INNER JOIN dominio.modulo AS m ON m.code = up.modulo_id
      WHERE up.usuario_id = u.id
    ), '{}'::json) AS perfis
  FROM dgeo.usuario AS u
  INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
  ORDER BY u.nome
  `);
};

controller.getModulos = async () => {
  return db.conn.any(
    "SELECT code, nome, nome_abrev FROM dominio.modulo ORDER BY code"
  );
};

controller.getPerfis = async () => {
  return db.conn.any(
    "SELECT code, nome FROM dominio.tipo_perfil ORDER BY code"
  );
};

// Catalogo do formulario de usuario. NAO e verifyAdmin como os dois de cima: a
// tela de "meu perfil" tambem escolhe posto/graduacao, e quem a usa e qualquer
// pessoa logada.
controller.getPostosGrad = async () => {
  return db.conn.any(
    "SELECT code, nome, nome_abrev FROM dominio.tipo_posto_grad ORDER BY code"
  );
};

// Grava o perfil do usuario em cada modulo informado. Nivel nulo REMOVE a linha,
// que e como se tira o acesso da pessoa aquele modulo (sem linha, sem acesso).
const gravaPerfis = async (t, usuarioId, perfis) => {
  if (!perfis) return;

  const modulos = await t.any("SELECT code, nome_abrev FROM dominio.modulo");
  const porNome = {};
  modulos.forEach(m => { porNome[m.nome_abrev] = m.code; });

  for (const [nomeModulo, nivel] of Object.entries(perfis)) {
    const moduloId = porNome[nomeModulo];
    if (!moduloId) {
      throw new AppError(`Módulo desconhecido: ${nomeModulo}`, httpCode.BadRequest);
    }
    if (nivel === null) {
      await t.none(
        "DELETE FROM dgeo.usuario_perfil WHERE usuario_id = $<usuarioId> AND modulo_id = $<moduloId>",
        { usuarioId, moduloId }
      );
    } else {
      await t.none(
        `INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
         VALUES ($<usuarioId>, $<moduloId>, $<nivel>)
         ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id`,
        { usuarioId, moduloId, nivel }
      );
    }
  }
};

// Garante que a alteração não deixa o sistema sem nenhum administrador ativo
// (lockout operacional — só recuperável via SQL direto no banco)
const verificaUltimoAdmin = async (t, uuidsAlterados) => {
  const adminsRestantes = await t.one(
    `SELECT COUNT(*) AS n FROM dgeo.usuario
     WHERE administrador IS TRUE AND ativo IS TRUE
       AND uuid NOT IN ($<uuidsAlterados:csv>)`,
    { uuidsAlterados }
  );
  return parseInt(adminsRestantes.n, 10);
};

/**
 * Cria a pessoa NO SCA, com senha.
 *
 * Substitui, desde 2026-08-02, o par importar/sincronizar: ate ali o SCA nao
 * criava ninguem, so espelhava quem o Auth Server ja tinha
 * (`GET /usuarios/servico_autenticacao` mais `PUT /usuarios/sincronizar`), e
 * cadastrar gente era um trabalho em DOIS sistemas.
 *
 * O `uuid` nasce do default da coluna e NAO e aceito no corpo. O Auth Server
 * permitia informa-lo porque precisava casar com o uuid que os sistemas
 * clientes ja tinham importado; aqui nao existe esse "ja tinham". O unico
 * caminho legitimo de uuid vindo de fora e o `scripts/copiar_usuarios_auth.js`,
 * que escreve direto no banco, na migracao.
 */
controller.criaUsuario = async dados => {
  return db.conn.tx(async t => {
    const hash = await senhaUtils.gerarHash(dados.senha);

    let usuario;
    try {
      usuario = await t.one(
        `INSERT INTO dgeo.usuario
           (login, senha, nome, nome_guerra, tipo_posto_grad_id, administrador, ativo)
         VALUES
           ($<login>, $<hash>, $<nome>, $<nome_guerra>, $<tipo_posto_grad_id>, $<administrador>, $<ativo>)
         RETURNING id, uuid`,
        { ...dados, hash }
      );
    } catch (err) {
      if (ehCodigo(err, PG_UNIQUE_VIOLATION)) {
        throw new AppError(
          `Já existe um usuário com o login ${dados.login}`,
          httpCode.BadRequest
        );
      }
      throw err;
    }

    // Criar a pessoa NAO libera modulo nenhum: sem linha em usuario_perfil ela
    // entra e nao ve nada. Conceder e ato explicito, aqui ou na tela de perfis.
    await gravaPerfis(t, usuario.id, dados.perfis);

    return { uuid: usuario.uuid };
  });
};

/**
 * Atualiza o cadastro da pessoa.
 *
 * `administrador` e `ativo` sao OBRIGATORIOS e os campos de identidade (login,
 * nome, nome_guerra, tipo_posto_grad_id) sao OPCIONAIS, com omissao valendo
 * "nao mexe". Nao e capricho: os botoes de alternar da tela de usuarios chamam
 * esta rota com os dois booleanos e nada mais, desde antes de esta feature
 * saber editar cadastro. Torna-los obrigatorios quebraria aqueles botoes, e dar
 * `default` aos demais apagaria o nome de quem so foi ativado -- que e
 * exatamente o defeito que o `preserveOmitted` existe para matar.
 */
controller.atualizaUsuario = async (uuid, body) => {
  return db.conn.tx(async t => {
    if (!body.administrador || !body.ativo) {
      const outrosAdmins = await verificaUltimoAdmin(t, [uuid]);
      const alvo = await t.oneOrNone(
        `SELECT administrador, ativo FROM dgeo.usuario WHERE uuid = $<uuid>`,
        { uuid }
      );
      if (alvo && alvo.administrador && alvo.ativo && outrosAdmins === 0) {
        throw new AppError(
          "Operação bloqueada: este é o último administrador ativo do sistema",
          httpCode.BadRequest
        );
      }
    }

    await preserveOmitted(t, {
      schema: "dgeo",
      table: "usuario",
      idColumn: "uuid",
      id: uuid,
      fields: ["login", "nome", "nome_guerra", "tipo_posto_grad_id"],
      body
    });

    let result;
    try {
      result = await t.result(
        `UPDATE dgeo.usuario SET
           login = $<login>, nome = $<nome>, nome_guerra = $<nome_guerra>,
           tipo_posto_grad_id = $<tipo_posto_grad_id>,
           administrador = $<administrador>, ativo = $<ativo>
         WHERE uuid = $<uuid>`,
        { ...body, uuid }
      );
    } catch (err) {
      if (ehCodigo(err, PG_UNIQUE_VIOLATION)) {
        throw new AppError(
          `Já existe um usuário com o login ${body.login}`,
          httpCode.BadRequest
        );
      }
      throw err;
    }

    if (!result.rowCount || result.rowCount !== 1) {
      throw new AppError("Usuário não encontrado", httpCode.BadRequest);
    }

    if (body.perfis) {
      const { id } = await t.one("SELECT id FROM dgeo.usuario WHERE uuid = $<uuid>", { uuid });
      await gravaPerfis(t, id, body.perfis);
    }
  });
};

controller.atualizaUsuarioLista = async usuarios => {
  return db.conn.tx(async t => {
    // Verificar se todos os uuids existem (antes: inexistentes eram ignorados em silêncio)
    const existentes = await t.any(
      `SELECT uuid FROM dgeo.usuario WHERE uuid IN ($<uuids:csv>)`,
      { uuids: usuarios.map(u => u.uuid) }
    );

    if (existentes.length !== usuarios.length) {
      const achados = existentes.map(e => e.uuid);
      const faltantes = usuarios.map(u => u.uuid).filter(u => !achados.includes(u));
      throw new AppError(
        `Usuários não encontrados: ${faltantes.join(", ")}`,
        httpCode.BadRequest
      );
    }

    // Bloquear se a lista desativar/rebaixar todos os admins ativos restantes
    const manteraAdmin = usuarios.some(u => u.administrador && u.ativo);
    if (!manteraAdmin) {
      const outrosAdmins = await verificaUltimoAdmin(t, usuarios.map(u => u.uuid));
      if (outrosAdmins === 0) {
        throw new AppError(
          "Operação bloqueada: a alteração deixaria o sistema sem administradores ativos",
          httpCode.BadRequest
        );
      }
    }

    const cs = new db.pgp.helpers.ColumnSet(["?uuid", "ativo", "administrador"]);

    const query =
      db.pgp.helpers.update(
        usuarios.map(u => ({ uuid: u.uuid, ativo: u.ativo, administrador: u.administrador })),
        cs,
        { table: "usuario", schema: "dgeo" },
        {
          tableAlias: "X",
          valueAlias: "Y"
        }
      ) + " WHERE Y.uuid::uuid = X.uuid";

    await t.none(query);

    // Perfil por modulo de quem veio com ele no corpo (o resto fica como esta)
    for (const u of usuarios.filter(x => x.perfis)) {
      const { id } = await t.one("SELECT id FROM dgeo.usuario WHERE uuid = $<uuid>", { uuid: u.uuid });
      await gravaPerfis(t, id, u.perfis);
    }
  });
};

/**
 * Exclui a pessoa.
 *
 * NA PRATICA quase sempre falha, e esta certo assim: `dgeo.usuario.uuid` e
 * referenciado por dezenas de tabelas dos tres modulos
 * (`acervo.versao.usuario_criacao_uuid`, `rpcmtec.edicao.usuario_cadastramento_uuid`,
 * `mapoteca.pedido.usuario_id`, ...), e quem ja trabalhou no sistema nao se
 * apaga: se DESATIVA. Apagar reescreveria a autoria do que a pessoa cadastrou.
 *
 * A rota existe para o cadastro errado, feito ha cinco minutos, que ainda nao
 * encostou em nada. O 23503 vira uma frase que diz o que fazer, em vez do 500
 * cru que a FK produziria. So `dgeo.usuario_perfil` cai junto, por CASCADE:
 * perfil sem dono nao e historico de nada.
 */
controller.deletaUsuario = async uuid => {
  return db.conn.tx(async t => {
    const alvo = await t.oneOrNone(
      "SELECT administrador, ativo FROM dgeo.usuario WHERE uuid = $<uuid>",
      { uuid }
    );
    if (!alvo) {
      throw new AppError("Usuário não encontrado", httpCode.NotFound);
    }

    if (alvo.administrador && alvo.ativo) {
      const outrosAdmins = await verificaUltimoAdmin(t, [uuid]);
      if (outrosAdmins === 0) {
        throw new AppError(
          "Operação bloqueada: este é o último administrador ativo do sistema",
          httpCode.BadRequest
        );
      }
    }

    try {
      await t.none("DELETE FROM dgeo.usuario WHERE uuid = $<uuid>", { uuid });
    } catch (err) {
      if (ehCodigo(err, PG_FOREIGN_KEY_VIOLATION)) {
        throw new AppError(
          "Usuário já possui registros no sistema e não pode ser excluído. Desative-o.",
          httpCode.BadRequest
        );
      }
      throw err;
    }
  });
};

/**
 * Reseta a senha de uma ou mais pessoas: a senha passa a ser o proprio LOGIN.
 *
 * E a convencao do Auth Server, mantida de proposito -- ela e o que obriga a
 * troca no primeiro acesso, porque uma senha que a pessoa nao escolheu e que
 * qualquer um adivinha nao serve para mais nada.
 *
 * DIVERGE do original num ponto: la o reset recusava administrador
 * (`GET_NON_ADMIN_USERS`). Aqui vale para qualquer um, porque no SCA o
 * administrador e GLOBAL e unico, e recusar bloquearia justamente a conta que
 * nao tem outro caminho de recuperacao. Nao ha escalada de privilegio nisso:
 * quem chama esta rota ja e administrador e ja passa em todo modulo.
 */
controller.resetaSenhas = async uuids => {
  return db.conn.tx(async t => {
    const usuarios = await t.any(
      "SELECT id, login, uuid FROM dgeo.usuario WHERE uuid IN ($<uuids:csv>)",
      { uuids }
    );

    const naoAchados = uuids.filter(u => !usuarios.some(x => x.uuid === u));
    if (naoAchados.length) {
      throw new AppError(
        `Usuários não encontrados: ${naoAchados.join(", ")}`,
        httpCode.BadRequest
      );
    }

    for (const { id, login } of usuarios) {
      const hash = await senhaUtils.gerarHash(login);
      await t.none(
        "UPDATE dgeo.usuario SET senha = $<hash> WHERE id = $<id>",
        { id, hash }
      );
    }

    return { total: usuarios.length };
  });
};

// ---------------------------------------------------------------------------
// O PROPRIO cadastro (tela #/perfil). Guarda `verifyLogin`, e nao verifyAdmin:
// e o unico caminho pelo qual alguem troca a propria senha, e ate 2026-08-02 o
// SCA nao tinha nenhum, porque a senha vivia no Auth Server.
// ---------------------------------------------------------------------------

controller.getPerfilProprio = async uuid => {
  const usuario = await db.conn.oneOrNone(
    `SELECT u.uuid, u.login, u.nome, u.nome_guerra, u.tipo_posto_grad_id,
            tpg.nome_abrev AS tipo_posto_grad, u.administrador, u.ativo
     FROM dgeo.usuario AS u
     INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
     WHERE u.uuid = $<uuid>`,
    { uuid }
  );

  if (!usuario) {
    throw new AppError("Usuário não encontrado", httpCode.NotFound);
  }

  return usuario;
};

/**
 * A pessoa corrige os PROPRIOS dados. Nao alcanca `login`, `administrador`,
 * `ativo` nem perfil: quem muda quem a pessoa E, e o que ela pode, e o
 * administrador. Sem essa separacao, "editar meu perfil" viraria o caminho para
 * se promover.
 */
controller.atualizaPerfilProprio = async (uuid, dados) => {
  const result = await db.conn.result(
    `UPDATE dgeo.usuario
     SET nome = $<nome>, nome_guerra = $<nome_guerra>, tipo_posto_grad_id = $<tipo_posto_grad_id>
     WHERE uuid = $<uuid>`,
    { ...dados, uuid }
  );

  if (!result.rowCount || result.rowCount !== 1) {
    throw new AppError("Usuário não encontrado", httpCode.NotFound);
  }
};

/**
 * Troca a propria senha, exigindo a VIGENTE.
 *
 * A conferencia sai de `loginCtrl.conferirSenha`, e nao de um bcrypt.compare
 * escrito aqui: ha um caminho unico de conferencia de senha no sistema, que e o
 * mesmo do login. E exigir a senha atual e o que impede uma sessao esquecida
 * aberta de virar uma conta tomada -- sem isso o token sozinho bastaria para
 * trocar a senha e expulsar o dono.
 */
controller.atualizaSenhaPropria = async (uuid, senhaAtual, senhaNova) => {
  await loginCtrl.conferirSenha(uuid, senhaAtual);

  const hash = await senhaUtils.gerarHash(senhaNova);

  const result = await db.conn.result(
    "UPDATE dgeo.usuario SET senha = $<hash> WHERE uuid = $<uuid> AND ativo IS TRUE",
    { uuid, hash }
  );

  if (!result.rowCount || result.rowCount !== 1) {
    throw new AppError("Usuário não encontrado ou inativo", httpCode.NotFound);
  }
};

module.exports = controller;

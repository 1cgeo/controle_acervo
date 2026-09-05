"use strict";

const { db } = require("../database");

const { AppError, httpCode, preserveOmitted } = require("../utils");

const { loginCtrl, senha: senhaUtils } = require("../login");

// A rastreabilidade desta feature nao e um detalhe de implementacao: promover
// alguem a administrador global e conceder perfil num modulo sao os dois atos
// que mudam o que TODAS as outras escritas do sistema podem fazer. Ver
// auditoria/mapa/plataforma.js.
const { auditoriaCtrl } = require("../auditoria");

const controller = {};

// Codigos de erro do PostgreSQL que esta feature traduz para frase de gente.
// Erro cru de banco vira 500 e esconde a causa, que aqui e sempre uma das tres
// abaixo. Mesmo padrao do `isUniqueViolation` do modulo orcamento.
const PG_UNIQUE_VIOLATION = "23505";
const PG_FOREIGN_KEY_VIOLATION = "23503";
// O impasse e o preco ACEITO da trava do ultimo administrador (ver
// `verificaUltimoAdmin`). Aceitar o preco nao e motivo para entrega-lo como
// "Erro no servidor": e a unica das tres em que tentar de novo resolve, e quem
// le a mensagem precisa saber disso.
const PG_DEADLOCK_DETECTED = "40P01";

const ehCodigo = (err, code) =>
  typeof err === "object" && err !== null && err.code === code;

controller.getUsuarios = async () => {
  // `perfis` vem como mapa modulo -> nivel ({ acervo: 1, mapoteca: 2 }), e nao
  // como coluna por modulo, para a tela nao mudar quando surgir outro modulo.
  //
  // `senha_definida` e um BOOLEANO derivado, nunca o hash: a coluna `senha` nao
  // sai desta feature por rota nenhuma. Ela e anulavel, e sem esta marca quem
  // esta sem senha so apareceria ao reclamar que nao consegue entrar.
  //
  // `na_dgeo_desde` sai do periodo ABERTO de `dgeo.efetivo_periodo`, que e
  // "esta na Divisao e sem previsao de saida". A subconsulta escalar e segura
  // porque o EXCLUDE da tabela proibe intervalos sobrepostos da mesma pessoa:
  // dois periodos abertos se cruzariam, entao no maximo um existe.
  //
  // `ultimo_acesso` sai de `dgeo.login` SEM recorte de data: a tela de acessos
  // pergunta "quem entrou hoje", e sem esta coluna o ultimo acesso de quem nao
  // entrou hoje nao apareceria em lugar nenhum.
  //
  // `tem_registro` responde uma pergunta da TELA: mostrar ou nao o botao
  // "Excluir". Ele e VERDADEIRO quando a pessoa ja tem login, passagem ou
  // impedimento gravado. FALSO nao promete que o DELETE passa: dezenas de
  // tabelas dos módulos tambem apontam para o uuid, e a recusa final e do
  // banco (23503), traduzida em `deletaUsuario`.
  //
  // A ORDEM e a HIERARQUIA, a mesma de `efetivo_ctrl` (posto decrescente,
  // depois nome de guerra). Por nome completo, a lista misturava coronel e
  // soldado em ordem alfabetica de um nome que a tela nem usa como identidade.
  return db.conn.any(`
  SELECT u.uuid, u.login, u.nome, u.tipo_posto_grad_id, tpg.nome_abrev AS tipo_posto_grad, u.nome_guerra, u.administrador, u.ativo,
    (u.senha IS NOT NULL) AS senha_definida,
    (
      SELECT ep.data_inicio
      FROM dgeo.efetivo_periodo AS ep
      WHERE ep.usuario_uuid = u.uuid AND ep.data_fim IS NULL
    ) AS na_dgeo_desde,
    (
      SELECT MAX(l.data_login)
      FROM dgeo.login AS l
      WHERE l.usuario_id = u.id
    ) AS ultimo_acesso,
    (
      EXISTS (SELECT 1 FROM dgeo.login AS l WHERE l.usuario_id = u.id)
      OR EXISTS (SELECT 1 FROM dgeo.efetivo_periodo AS ep WHERE ep.usuario_uuid = u.uuid)
      OR EXISTS (SELECT 1 FROM dgeo.impedimento AS i WHERE i.usuario_uuid = u.uuid)
    ) AS tem_registro,
    COALESCE((
      SELECT json_object_agg(m.nome_abrev, up.perfil_id)
      FROM dgeo.usuario_perfil AS up
      INNER JOIN dominio.modulo AS m ON m.code = up.modulo_id
      WHERE up.usuario_id = u.id
    ), '{}'::json) AS perfis
  FROM dgeo.usuario AS u
  INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
  ORDER BY u.tipo_posto_grad_id DESC, u.nome_guerra
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

/**
 * Grava o perfil do usuario em cada modulo informado. Nivel nulo REMOVE a linha,
 * que e como se tira o acesso da pessoa aquele modulo (sem linha, sem acesso).
 *
 * O VALOR ANTERIOR E LIDO ANTES DE CADA RAMO. Um `RETURNING` nao serviria: o
 * upsert devolve o valor NOVO e o DELETE nao devolve nada, entao nos dois
 * caminhos o valor antigo era destruido sem nunca ser lido. Sem esta leitura o
 * rastro diria "o perfil mudou" sem dizer de que para que -- e "de operador para
 * gerente" e a unica coisa que se quer saber de uma concessao.
 *
 * A funcao e INCREMENTAL: so os modulos presentes em `perfis` sao tocados. A
 * ausencia de um modulo NAO e revogacao, e por isso nao vira evento nenhum.
 *
 * `autorUuid` e QUEM CONCEDE, e nunca o alvo -- o alvo entra por `usuarioId`.
 * Ele desce por parametro desde a rota, atravessando `criaUsuario`,
 * `atualizaUsuario` e `atualizaUsuarioLista`, porque esta funcao e a unica que
 * escreve `dgeo.usuario_perfil`.
 */
const gravaPerfis = async (t, usuarioId, perfis, autorUuid, contexto) => {
  if (!perfis) return;

  // ORDER BY code: a ordem do modulo e semantica (acervo, mapoteca, orcamento,
  // pit, efetivo, equipamento), e sem ele o Postgres nao promete ordem nenhuma.
  const modulos = await t.any(
    "SELECT code, nome_abrev FROM dominio.modulo ORDER BY code"
  );
  // SEM PROTOTIPO, e nao um `{}`. O nome do modulo vem do CORPO da requisicao, e
  // num objeto comum `porNome['constructor']` devolve a funcao herdada -- ou
  // seja, um valor VERDADEIRO. A recusa logo abaixo passava batido, e o valor
  // seguia para o SQL como `modulo_id`, onde virava 500 ("invalid input syntax
  // for type smallint") no lugar do 400 que diz qual modulo nao existe. O Joi
  // nao cobre: `Joi.object().pattern(Joi.string(), ...)` poda `__proto__` mas
  // aceita `constructor` como chave qualquer.
  const porNome = Object.create(null);
  modulos.forEach(m => { porNome[m.nome_abrev] = m.code; });

  for (const [nomeModulo, nivel] of Object.entries(perfis)) {
    const moduloId = porNome[nomeModulo];
    if (!moduloId) {
      throw new AppError(`Módulo desconhecido: ${nomeModulo}`, httpCode.BadRequest);
    }

    const antes = await t.oneOrNone(
      `SELECT * FROM dgeo.usuario_perfil
       WHERE usuario_id = $<usuarioId> AND modulo_id = $<moduloId>`,
      { usuarioId, moduloId }
    );

    if (nivel === null) {
      // Revogar o que a pessoa nao tem e um nao-evento: sem linha nao havia
      // acesso para tirar. Registra-lo encheria a ficha de revogacoes que nunca
      // aconteceram, porque a tela manda o mapa inteiro de modulos.
      if (!antes) continue;

      await t.none(
        "DELETE FROM dgeo.usuario_perfil WHERE usuario_id = $<usuarioId> AND modulo_id = $<moduloId>",
        { usuarioId, moduloId }
      );

      await auditoriaCtrl.registrar(t, {
        tabela: "dgeo.usuario_perfil",
        registroId: antes.id,
        operacao: "D",
        antes,
        usuarioUuid: autorUuid,
        contexto
      });
      continue;
    }

    const depois = await t.one(
      `INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
       VALUES ($<usuarioId>, $<moduloId>, $<nivel>)
       ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id
       RETURNING *`,
      { usuarioId, moduloId, nivel }
    );

    // O upsert roda SEMPRE (o estado gravado nao muda com esta condicao), mas o
    // evento so nasce quando o nivel mudou de verdade: a tela reenvia o mapa
    // inteiro de perfis a cada "Salvar", e sem isto cada salvamento deixaria uma
    // linha de historico por modulo, com o diff vazio dentro.
    if (antes && String(antes.perfil_id) === String(depois.perfil_id)) continue;

    await auditoriaCtrl.registrar(t, {
      tabela: "dgeo.usuario_perfil",
      registroId: depois.id,
      operacao: antes ? "U" : "I",
      antes,
      depois,
      usuarioUuid: autorUuid,
      contexto
    });
  }
};

// Garante que a alteração não deixa o sistema sem nenhum administrador ativo
// (lockout operacional, só recuperável via SQL direto no banco)
//
// `FOR UPDATE`, E ELE E A TRAVA INTEIRA. Sem ele a conta era um `SELECT` sem
// lock seguido de um `UPDATE`, e duas requisições simultâneas passavam as duas:
// com A e B os dois últimos administradores, "rebaixar A" e "rebaixar B"
// disparados juntos leem, cada um, o OUTRO ainda administrador (em READ
// COMMITTED nenhum enxerga a mudança que o outro ainda não confirmou), os dois
// contam 1 e os dois gravam. O sistema termina sem administrador nenhum, que é
// exatamente o lockout que esta função existe para impedir -- e o único conserto
// é `psql`. Com o lock, o segundo espera o primeiro confirmar e o Postgres
// REAVALIA a linha travada: A já não é administrador, sai da contagem, e a
// segunda requisição é recusada com a frase certa.
//
// CONTA AS LINHAS EM JS, e não por `COUNT(*)`: o Postgres recusa `FOR UPDATE`
// junto de função de agregação. Não custa nada -- em 2026-08-06 havia 5
// administradores em 28 contas, e a lista ainda exclui os que estão mudando.
//
// O PREÇO ACEITO É O IMPASSE (40P01) no caso simétrico, e ele é o lado bom da
// troca: duas requisições que travem os administradores em ordens opostas fazem
// o Postgres abortar UMA delas, que responde erro e não grava nada. Erro que se
// resolve tentando de novo é melhor do que um sistema sem administrador.
//
// E ELE SAI COMO 409, e não como 500. O `deadlock detected` sobe cru do driver,
// o `errorHandler` o trata como erro interno e o `sendJsonAndLog` mascara a
// mensagem ("Erro no servidor") e zera o campo `error` -- que é o comportamento
// certo para 500 e o errado para este caso. Quem rebaixou dois colegas ao mesmo
// tempo ficava sem saber se gravou, e só descobria reabrindo a tela. É a única
// falha desta função em que TENTAR DE NOVO é a resposta, então a frase tem de
// dizer isso.
const verificaUltimoAdmin = async (t, uuidsAlterados) => {
  let adminsRestantes;
  try {
    adminsRestantes = await t.any(
      `SELECT id FROM dgeo.usuario
       WHERE administrador IS TRUE AND ativo IS TRUE
         AND uuid NOT IN ($<uuidsAlterados:csv>)
       FOR UPDATE`,
      { uuidsAlterados }
    );
  } catch (err) {
    if (ehCodigo(err, PG_DEADLOCK_DETECTED)) {
      throw new AppError(
        "Outra alteração de administrador está em andamento. Tente novamente.",
        httpCode.Conflict
      );
    }
    throw err;
  }
  return adminsRestantes.length;
};

/**
 * Cria a pessoa NO SCA, com senha.
 *
 * O `uuid` nasce do default da coluna e NAO e aceito no corpo. O unico caminho
 * legitimo de uuid vindo de fora e o `scripts/copiar_usuarios_auth.js`, que
 * escreve direto no banco, na migracao.
 */
controller.criaUsuario = async (dados, autorUuid, contexto) => {
  return db.conn.tx(async t => {
    const hash = await senhaUtils.gerarHash(dados.senha);

    let usuario;
    try {
      // RETURNING *, e nao `id, uuid`: a linha gravada e o `dados_depois` do
      // rastro, e o que se audita e o que o BANCO gravou, nunca o que o corpo da
      // requisicao pediu.
      //
      // O hash vem junto de proposito. Excluir a coluna aqui criaria uma SEGUNDA
      // regra de segredo ao lado do `omitir` do mapa, mais fraca porque valeria
      // so neste SELECT; e a chave sumiria do JSON, quando o que se quer dizer e
      // "existe e nao se guarda". Com ela presente e nula, `campos_alterados`
      // registra que a senha nasceu definida neste cadastro.
      usuario = await t.one(
        `INSERT INTO dgeo.usuario
           (login, senha, nome, nome_guerra, tipo_posto_grad_id, administrador, ativo)
         VALUES
           ($<login>, $<hash>, $<nome>, $<nome_guerra>, $<tipo_posto_grad_id>, $<administrador>, $<ativo>)
         RETURNING *`,
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

    await auditoriaCtrl.registrar(t, {
      tabela: "dgeo.usuario",
      registroId: usuario.uuid,
      operacao: "I",
      depois: usuario,
      usuarioUuid: autorUuid,
      contexto
    });

    // Criar a pessoa NAO libera modulo nenhum: sem linha em usuario_perfil ela
    // entra e nao ve nada. Conceder e ato explicito, aqui ou na tela de perfis.
    await gravaPerfis(t, usuario.id, dados.perfis, autorUuid, contexto);

    // A rota continua devolvendo so o uuid: o RETURNING * e do rastro, e nao do
    // contrato da resposta.
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
controller.atualizaUsuario = async (uuid, body, autorUuid, contexto) => {
  return db.conn.tx(async t => {
    // A linha INTEIRA, no lugar do `SELECT administrador, ativo`: e a mesma ida
    // ao banco, serve a trava do ultimo administrador, traz o `id` que o perfil
    // precisa e vira o `dados_antes` do rastro. Ela tambem produz o 404, que
    // antes so existia depois do UPDATE, como 400.
    const antes = await auditoriaCtrl.lerAntes(
      t, "dgeo.usuario", uuid, "Usuário", "uuid"
    );

    if (!body.administrador || !body.ativo) {
      if (antes.administrador && antes.ativo) {
        const outrosAdmins = await verificaUltimoAdmin(t, [uuid]);
        if (outrosAdmins === 0) {
          throw new AppError(
            "Operação bloqueada: este é o último administrador ativo do sistema",
            httpCode.BadRequest
          );
        }
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

    let depois;
    try {
      // `t.one` com RETURNING *, no lugar do `t.result` e da contagem de linhas:
      // o `lerAntes` ja garantiu a linha DENTRO desta transacao, e a linha
      // devolvida e o `dados_depois`. Ler o resultado de novo seria uma terceira
      // ida ao banco para buscar o que o UPDATE ja tem na mao.
      depois = await t.one(
        `UPDATE dgeo.usuario SET
           login = $<login>, nome = $<nome>, nome_guerra = $<nome_guerra>,
           tipo_posto_grad_id = $<tipo_posto_grad_id>,
           administrador = $<administrador>, ativo = $<ativo>
         WHERE uuid = $<uuid>
         RETURNING *`,
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

    await auditoriaCtrl.registrar(t, {
      tabela: "dgeo.usuario",
      registroId: uuid,
      operacao: "U",
      antes,
      depois,
      usuarioUuid: autorUuid,
      contexto
    });

    if (body.perfis) {
      // `antes.id` no lugar do `SELECT id`: a linha ja foi lida.
      await gravaPerfis(t, antes.id, body.perfis, autorUuid, contexto);
    }
  });
};

controller.atualizaUsuarioLista = async (usuarios, autorUuid, contexto) => {
  return db.conn.tx(async t => {
    // Verificar se todos os uuids existem (antes: inexistentes eram ignorados em silêncio)
    //
    // SELECT *, e nao `SELECT uuid`: as linhas inteiras sao o `dados_antes` de
    // cada evento, pela MESMA ida ao banco. Aqui nao entra o `lerAntes` por
    // usuario porque esta consulta unica ja traz tudo, e porque ela e a que
    // produz a mensagem com TODOS os uuids faltantes de uma vez -- o `lerAntes`
    // pararia no primeiro, e quem manda uma lista de 30 descobriria um erro por
    // tentativa.
    const existentes = await t.any(
      `SELECT * FROM dgeo.usuario WHERE uuid IN ($<uuids:csv>)`,
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

    // O estado resultante dos MESMOS uuids, numa consulta so. O UPDATE em massa
    // do pg-promise nao devolve linha, e um SELECT por usuario seria N idas ao
    // banco para o que cabe numa.
    const depoisPorUuid = new Map(
      (await t.any(
        `SELECT * FROM dgeo.usuario WHERE uuid IN ($<uuids:csv>)`,
        { uuids: usuarios.map(u => u.uuid) }
      )).map(linha => [linha.uuid, linha])
    );

    const antesPorUuid = new Map(existentes.map(linha => [linha.uuid, linha]));

    // UM EVENTO POR USUARIO, e nao um pelo lote: a ficha de cada pessoa tem de
    // mostrar o que aconteceu com ela. Quem diz que os N foram o mesmo ato e o
    // `lote_id` do contexto, que o middleware gera UM por requisicao.
    for (const u of usuarios) {
      const antes = antesPorUuid.get(u.uuid);
      const depois = depoisPorUuid.get(u.uuid);

      await auditoriaCtrl.registrar(t, {
        tabela: "dgeo.usuario",
        registroId: u.uuid,
        operacao: "U",
        antes,
        depois,
        usuarioUuid: autorUuid,
        contexto
      });

      // Perfil por modulo de quem veio com ele no corpo (o resto fica como esta)
      if (u.perfis) {
        await gravaPerfis(t, antes.id, u.perfis, autorUuid, contexto);
      }
    }
  });
};

/**
 * Exclui a pessoa.
 *
 * NA PRATICA quase sempre falha, e esta certo assim: `dgeo.usuario.uuid` e
 * referenciado por dezenas de tabelas dos módulos
 * (`acervo.versao.usuario_criacao_uuid`, `rpcmtec.edicao.usuario_cadastramento_uuid`,
 * `mapoteca.pedido.usuario_id`, ...), e quem ja trabalhou no sistema nao se
 * apaga: se DESATIVA. Apagar reescreveria a autoria do que a pessoa cadastrou.
 *
 * A rota existe para o cadastro errado, feito ha cinco minutos, que ainda nao
 * encostou em nada. O 23503 vira uma frase que diz o que fazer, em vez do 500
 * cru que a FK produziria. So `dgeo.usuario_perfil` cai junto, por CASCADE:
 * perfil sem dono nao e historico de nada.
 */
controller.deletaUsuario = async (uuid, autorUuid, contexto) => {
  return db.conn.tx(async t => {
    // A linha INTEIRA no lugar do `SELECT administrador, ativo`, pela mesma ida
    // ao banco e com o mesmo 404: numa exclusao o `dados_antes` e o unico
    // registro do que existiu, e os dois campos que a trava le sao dois dos
    // sete que se perdem.
    const antes = await auditoriaCtrl.lerAntes(
      t, "dgeo.usuario", uuid, "Usuário", "uuid"
    );

    if (antes.administrador && antes.ativo) {
      const outrosAdmins = await verificaUltimoAdmin(t, [uuid]);
      if (outrosAdmins === 0) {
        throw new AppError(
          "Operação bloqueada: este é o último administrador ativo do sistema",
          httpCode.BadRequest
        );
      }
    }

    // O perfil cai por CASCADE, sem DELETE explicito, e por isso passaria em
    // branco: "a pessoa era gerente do orcamento quando foi apagada" e
    // justamente o que se procura depois. Os eventos entram ANTES da exclusao do
    // dono porque o agregado de `usuario_perfil` resolve `usuario_id -> uuid`
    // pela propria `dgeo.usuario`, e depois do DELETE nao haveria o que resolver.
    const perfis = await t.any(
      "SELECT * FROM dgeo.usuario_perfil WHERE usuario_id = $<id>",
      { id: antes.id }
    );
    for (const perfil of perfis) {
      await auditoriaCtrl.registrar(t, {
        tabela: "dgeo.usuario_perfil",
        registroId: perfil.id,
        operacao: "D",
        antes: perfil,
        usuarioUuid: autorUuid,
        contexto
      });
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

    await auditoriaCtrl.registrar(t, {
      tabela: "dgeo.usuario",
      registroId: uuid,
      operacao: "D",
      antes,
      usuarioUuid: autorUuid,
      contexto
    });
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
controller.resetaSenhas = async (uuids, autorUuid, contexto) => {
  return db.conn.tx(async t => {
    // SELECT *, e nao `id, login, uuid`: a linha inteira e o `dados_antes`, e e
    // ela que faz o diff sair como ['senha'] em vez de "mudou alguma coisa". O
    // hash nao chega ao rastro -- o `omitir` do mapa o anula nos dois lados,
    // depois do diff.
    const usuarios = await t.any(
      "SELECT * FROM dgeo.usuario WHERE uuid IN ($<uuids:csv>)",
      { uuids }
    );

    const naoAchados = uuids.filter(u => !usuarios.some(x => x.uuid === u));
    if (naoAchados.length) {
      throw new AppError(
        `Usuários não encontrados: ${naoAchados.join(", ")}`,
        httpCode.BadRequest
      );
    }

    for (const antes of usuarios) {
      const hash = await senhaUtils.gerarHash(antes.login);
      const depois = await t.one(
        "UPDATE dgeo.usuario SET senha = $<hash> WHERE id = $<id> RETURNING *",
        { id: antes.id, hash }
      );

      // UM EVENTO POR ALVO, e nao um pelo lote: resetar a senha e um ato por
      // pessoa, e a ficha de cada uma tem de mostra-lo. O que diz que os N foram
      // o mesmo ato e o `lote_id` do contexto, um por REQUISICAO.
      await auditoriaCtrl.registrar(t, {
        tabela: "dgeo.usuario",
        registroId: antes.uuid,
        operacao: "U",
        antes,
        depois,
        usuarioUuid: autorUuid,
        contexto
      });
    }

    return { total: usuarios.length };
  });
};

// ---------------------------------------------------------------------------
// O PROPRIO cadastro (tela #/perfil). Guarda `verifyLogin`, e nao `verifyAdmin`:
// e o unico caminho pelo qual alguem troca a propria senha.
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
controller.atualizaPerfilProprio = async (uuid, dados, contexto) => {
  // Ganhou transacao para poder auditar: o rastro tem de cair JUNTO com a
  // mudanca que ele descreve, ou nao cair.
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, "dgeo.usuario", uuid, "Usuário", "uuid"
    );

    const depois = await t.one(
      `UPDATE dgeo.usuario
       SET nome = $<nome>, nome_guerra = $<nome_guerra>, tipo_posto_grad_id = $<tipo_posto_grad_id>
       WHERE uuid = $<uuid>
       RETURNING *`,
      { ...dados, uuid }
    );

    // O autor E o alvo, e e isso que separa na tela "corrigi o meu cadastro" de
    // "o administrador mexeu no meu cadastro": aqui `usuario_uuid` e
    // `entidade_id` sao a mesma pessoa.
    await auditoriaCtrl.registrar(t, {
      tabela: "dgeo.usuario",
      registroId: uuid,
      operacao: "U",
      antes,
      depois,
      usuarioUuid: uuid,
      contexto
    });
  });
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
controller.atualizaSenhaPropria = async (uuid, senhaAtual, senhaNova, contexto) => {
  // Uma transacao SO, onde antes eram duas conexoes independentes (a conferencia
  // e o UPDATE). Entre as duas cabia a mudanca de outra requisicao: a segunda
  // gravaria por cima com a autorizacao que a primeira acabara de conceder. A
  // auditoria e o que obrigou a olhar, e o conserto vale por si.
  return db.conn.tx(async t => {
    await loginCtrl.conferirSenha(uuid, senhaAtual, t);

    const antes = await auditoriaCtrl.lerAntes(
      t, "dgeo.usuario", uuid, "Usuário", "uuid"
    );

    const hash = await senhaUtils.gerarHash(senhaNova);

    const depois = await t.oneOrNone(
      `UPDATE dgeo.usuario SET senha = $<hash>
       WHERE uuid = $<uuid> AND ativo IS TRUE
       RETURNING *`,
      { uuid, hash }
    );

    if (!depois) {
      throw new AppError("Usuário não encontrado ou inativo", httpCode.NotFound);
    }

    // O evento diz QUEM trocou, QUANDO e por qual porta. Os dois valores saem
    // nulos pelo `omitir` do mapa, e e o `campos_alterados: ['senha']` que
    // carrega a informacao toda -- guardar o hash so criaria uma segunda copia
    // da credencial.
    await auditoriaCtrl.registrar(t, {
      tabela: "dgeo.usuario",
      registroId: uuid,
      operacao: "U",
      antes,
      depois,
      usuarioUuid: uuid,
      contexto
    });
  });
};

module.exports = controller;

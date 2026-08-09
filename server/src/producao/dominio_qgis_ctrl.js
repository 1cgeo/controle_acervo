'use strict'

// Os DOMÍNIOS do cadastro da produção e o CATÁLOGO do QGIS.
//
// Atravessou do `server/src/projeto/projeto_ctrl.js` do SAP 2.3.5. As traduções
// que valem para o arquivo inteiro:
//
//   db.sapConn        -> db.conn
//   schema `dgeo`     -> schema `qgis`, para as nove tabelas de catálogo. Lá o
//                        mesmo nome carregava a PESSOA e a configuração da
//                        FERRAMENTA; aqui `dgeo` é gente (ver `er/qgis.sql`).
//   schema `macrocontrole` -> `producao`, nas tabelas de perfil que impedem a
//                        exclusão de um item ainda em uso.
//   usuario_id INTEGER -> usuario_uuid UUID em tudo que é PESSOA. O `owner` das
//                        tabelas do `qgis` continua VARCHAR(255) e continua
//                        sendo o texto "posto + nome de guerra", porque quem o
//                        LÊ é o plugin do QGIS.
//
// O QUE NÃO ATRAVESSOU, e a ausência é a regra:
//
//   `disableTriggers`  não existe aqui. Onde o SAP desligava gatilho para
//                      escrever, este arquivo escreve direto: os gatilhos do
//                      banco do SCA cuidam do cache sozinhos.
//   `checkFMEConnection` e `validadeParameters` não existem. O SAP batia no
//                      servidor FME ANTES de gravar a URL, e recusava o
//                      cadastro se ele não respondesse. Aqui a URL se grava sem
//                      essa prova: ver o comentário do gerenciador do FME.

const { db } = require('../database')

const auditoriaCtrl = require('../auditoria/auditoria_ctrl')

const { AppError, httpCode } = require('../utils')

const controller = {}

// --- Erros do banco que viram resposta amigável ------------------------------

const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'

/**
 * Traduz o erro do PostgreSQL para o 4xx que diz o que fazer.
 *
 * Mesma mecânica do `equipamento_ctrl.js`. Aqui só DOIS códigos são alcançáveis
 * por um pedido bem formado:
 *
 *   23505 - o UNIQUE de `nome` (oito dos nove catálogos) ou o de `url`
 *   23503 - a chave estrangeira: um `grupo_estilo_id` que não existe na
 *           gravação, ou alguém ainda apontando para a linha na exclusão
 *
 * O 500 cru citaria o nome da restrição ('unique_menus'), que não ajuda quem
 * acabou de publicar o catálogo pelo SAP Gerente.
 */
const traduzirErro = (err, mensagens) => {
  if (!err || !err.code) return err
  const frase = mensagens && mensagens[err.code]
  if (!frase) return err
  return new AppError(frase, httpCode.Conflict, err)
}

const comTraducao = async (promessa, mensagens) => {
  try {
    return await promessa()
  } catch (err) {
    throw traduzirErro(err, mensagens)
  }
}

// --- Normalização do corpo ---------------------------------------------------

/**
 * O opcional AUSENTE vira null antes da consulta.
 *
 * Sem isto, uma linha válida que omite um campo derruba o pg-promise com
 * "Property doesn't exist", que chega como 500 onde não houve erro nenhum.
 */
const normaliza = (colunas, dados) => {
  const saida = {}
  for (const coluna of colunas) {
    saida[coluna] = dados[coluna] !== undefined ? dados[coluna] : null
  }
  return saida
}

// --- O autor do catálogo ------------------------------------------------------

/**
 * O texto que vai para a coluna `owner`: 'Cap Silva'.
 *
 * O SAP montava isto com `getUsuarioNomeById(usuarioId)`. Aqui a pessoa é
 * IDENTIFICADA POR UUID (o `usuario_id INTEGER` não atravessou), mas o valor
 * GRAVADO continua sendo o mesmo texto, e não a chave: `owner` é VARCHAR(255)
 * lida PELO NOME pelo plugin do QGIS e pelo SAP Gerente, que são clientes
 * compilados fora deste repositório. Ver `er/qgis.sql`.
 *
 * Lê dentro da transação `t` da escrita, e não fora: o valor entra na mesma
 * linha que ele descreve.
 */
const autorDe = async (t, usuarioUuid) => {
  const usuario = await t.oneOrNone(
    `SELECT pg.nome_abrev || ' ' || u.nome_guerra AS posto_nome
       FROM dgeo.usuario AS u
       INNER JOIN dominio.tipo_posto_grad AS pg ON pg.code = u.tipo_posto_grad_id
      WHERE u.uuid = $<usuarioUuid>`,
    { usuarioUuid }
  )

  if (!usuario) {
    throw new AppError(
      'Usuário do token não encontrado para registrar o autor do catálogo',
      httpCode.NotFound
    )
  }

  return usuario.posto_nome
}

// --- Os nove catálogos do QGIS ------------------------------------------------

// UMA DESCRIÇÃO POR CATÁLOGO, e não trinta e seis funções copiadas.
//
// Os nove se comportam igual: listar tudo, gravar uma leva, atualizar uma leva e
// apagar por lista de ids. O que muda entre eles é a TABELA, as COLUNAS, se há
// coluna de autor, quem impede a exclusão e o que dizer quando o UNIQUE reclama.
// Copiar as quatro funções nove vezes daria 36 lugares para divergir no dia em
// que a auditoria mudar de assinatura.
//
// `autor: true` quer dizer as duas colunas que o plugin do QGIS lê: `owner` e
// `update_time`. `group_styles` e `gerenciador_fme` não as têm no DDL, e por
// isso são os dois `false`.
//
// `associacoes` é o que o SAP conferia ANTES de apagar. A chave estrangeira já
// impediria a exclusão sozinha (23503), mas com uma mensagem que cita o nome da
// constraint: a conferência prévia existe para dizer QUAL cadastro segura a
// linha, que é o que a pessoa precisa desfazer primeiro.
const CATALOGOS = {
  grupoEstilos: {
    tabela: 'qgis.group_styles',
    rotulo: 'Grupo de estilos',
    colunas: ['nome'],
    autor: false,
    // O SAP não ordenava nada, e a lista chegava na ordem física da tabela, que
    // muda sozinha depois de um UPDATE. Ordenar é de graça e faz a tela do SAP
    // Gerente parar de reordenar-se sem que ninguém tenha mexido.
    select: 'SELECT id, nome FROM qgis.group_styles ORDER BY nome',
    associacoes: [
      {
        tabela: 'producao.perfil_estilo',
        coluna: 'grupo_estilo_id',
        mensagem: 'O grupo de estilos possui perfil de estilos associados'
      },
      {
        tabela: 'qgis.layer_styles',
        coluna: 'grupo_estilo_id',
        mensagem: 'O grupo de estilos possui estilos associados'
      }
    ],
    erros: {
      [UNIQUE_VIOLATION]: 'Já existe um grupo de estilos com este nome'
    }
  },

  estilos: {
    tabela: 'qgis.layer_styles',
    rotulo: 'Estilo',
    colunas: [
      'f_table_schema',
      'f_table_name',
      'f_geometry_column',
      'grupo_estilo_id',
      'styleqml',
      'stylesld',
      'ui'
    ],
    autor: true,
    // `gs.nome AS stylename` é do SAP, e o apelido fica: é assim que o SAP
    // Gerente lê o nome do grupo na tela de estilos. Trocá-lo por `grupo` seria
    // mais claro aqui e uma coluna vazia lá.
    select: `SELECT ls.id, ls.grupo_estilo_id, ls.f_table_schema, ls.f_table_name,
                    ls.f_geometry_column, gs.nome AS stylename, ls.styleqml,
                    ls.stylesld, ls.ui, ls.owner, ls.update_time
               FROM qgis.layer_styles AS ls
               INNER JOIN qgis.group_styles AS gs ON gs.id = ls.grupo_estilo_id
              ORDER BY gs.nome, ls.f_table_schema, ls.f_table_name`,
    associacoes: [],
    erros: {
      // O UNIQUE é (f_table_schema, f_table_name, grupo_estilo_id), e não o
      // nome: o mesmo estilo publicado duas vezes no mesmo grupo.
      [UNIQUE_VIOLATION]:
        'Já existe um estilo para esta camada neste grupo de estilos',
      [FK_VIOLATION]: 'O grupo de estilos informado não existe'
    }
  },

  regras: {
    tabela: 'qgis.layer_rules',
    rotulo: 'Regra',
    colunas: ['nome', 'regra'],
    autor: true,
    select: `SELECT id, nome, regra, owner, update_time
               FROM qgis.layer_rules ORDER BY nome`,
    associacoes: [
      {
        tabela: 'producao.perfil_regras',
        coluna: 'layer_rules_id',
        mensagem: 'O grupo de regras possui perfil de regras associadas'
      }
    ],
    erros: {
      [UNIQUE_VIOLATION]: 'Já existe uma regra com este nome'
    }
  },

  menus: {
    tabela: 'qgis.qgis_menus',
    rotulo: 'Menu',
    colunas: ['nome', 'definicao_menu'],
    autor: true,
    select: `SELECT id, nome, definicao_menu, owner, update_time
               FROM qgis.qgis_menus ORDER BY nome`,
    associacoes: [
      // O SAP NÃO conferia esta, e a exclusão de um menu em uso morria com o
      // 23503 cru. `producao.perfil_menu` existe no DDL daqui, e a pergunta que
      // ela responde é a mesma das outras.
      {
        tabela: 'producao.perfil_menu',
        coluna: 'menu_id',
        mensagem: 'O menu possui perfis associados'
      }
    ],
    erros: {
      [UNIQUE_VIOLATION]: 'Já existe um menu com este nome'
    }
  },

  modelos: {
    tabela: 'qgis.qgis_models',
    rotulo: 'Modelo do QGIS',
    colunas: ['nome', 'descricao', 'model_xml'],
    autor: true,
    select: `SELECT id, nome, descricao, model_xml, owner, update_time
               FROM qgis.qgis_models ORDER BY nome`,
    associacoes: [
      {
        tabela: 'producao.perfil_model_qgis',
        coluna: 'qgis_model_id',
        mensagem: 'O modelo possui perfis associados'
      }
    ],
    erros: {
      [UNIQUE_VIOLATION]: 'Já existe um modelo do QGIS com este nome'
    }
  },

  alias: {
    tabela: 'qgis.layer_alias',
    rotulo: 'Alias',
    colunas: ['nome', 'definicao_alias'],
    autor: true,
    // SEM `owner` e SEM `update_time` na resposta, embora as duas colunas
    // existam e sejam escritas: é o SELECT do SAP, e a tela de alias do SAP
    // Gerente não mostra as duas.
    select: `SELECT id, nome, definicao_alias
               FROM qgis.layer_alias ORDER BY nome`,
    associacoes: [
      // Também não conferida no SAP, e `producao.perfil_alias` existe aqui.
      {
        tabela: 'producao.perfil_alias',
        coluna: 'alias_id',
        mensagem: 'O alias possui perfis associados'
      }
    ],
    erros: {
      [UNIQUE_VIOLATION]: 'Já existe um alias com este nome'
    }
  },

  temas: {
    tabela: 'qgis.qgis_themes',
    rotulo: 'Tema',
    colunas: ['nome', 'definicao_tema'],
    autor: true,
    select: `SELECT id, nome, definicao_tema, owner, update_time
               FROM qgis.qgis_themes ORDER BY nome`,
    associacoes: [
      {
        tabela: 'producao.perfil_tema',
        coluna: 'tema_id',
        mensagem: 'O tema possui perfis associados'
      }
    ],
    erros: {
      [UNIQUE_VIOLATION]: 'Já existe um tema com este nome'
    }
  },

  workflows: {
    tabela: 'qgis.workflow_dsgtools',
    rotulo: 'Workflow do DSGTools',
    colunas: ['nome', 'descricao', 'workflow_json'],
    autor: true,
    select: `SELECT id, nome, descricao, workflow_json, owner, update_time
               FROM qgis.workflow_dsgtools ORDER BY nome`,
    associacoes: [
      {
        tabela: 'producao.perfil_workflow_dsgtools',
        coluna: 'workflow_dsgtools_id',
        mensagem: 'O workflow possui perfis associados'
      }
    ],
    erros: {
      [UNIQUE_VIOLATION]: 'Já existe um workflow do DSGTools com este nome'
    }
  },

  gerenciadorFme: {
    tabela: 'qgis.gerenciador_fme',
    rotulo: 'Servidor do Gerenciador do FME',
    colunas: ['url'],
    autor: false,
    select: 'SELECT id, url FROM qgis.gerenciador_fme ORDER BY url',
    associacoes: [
      {
        tabela: 'producao.perfil_fme',
        coluna: 'gerenciador_fme_id',
        mensagem: 'O servidor possui rotinas do FME associadas em perfil_fme'
      }
    ],
    erros: {
      [UNIQUE_VIOLATION]: 'Este servidor do Gerenciador do FME já está cadastrado'
    }
  }
}

// --- A montagem do SQL --------------------------------------------------------

// IDENTIFICADOR DE BANCO, conferido UMA VEZ no carregamento do módulo.
//
// Nada aqui vem da requisição: tabela e coluna saem de `CATALOGOS`, que é
// código. Mas o SQL abaixo INTERPOLA esses nomes (o pg-promise parametriza
// valor, nunca identificador), e a conferência é a diferença entre "confio que
// ninguém vai colar uma variável aqui" e provar que não colaram. Falha ALTO, no
// boot: erro de digitação num nome de coluna vira exceção no `require`, e não um
// 500 no dia em que alguém publicar o catálogo.
const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/

const conferirIdentificador = (valor, papel) => {
  const texto = String(valor)
  if (!IDENTIFICADOR.test(texto)) {
    throw new Error(`Catálogo do QGIS: ${papel} inválido: "${texto}"`)
  }
  return texto
}

for (const [chave, cat] of Object.entries(CATALOGOS)) {
  const [schema, nome] = cat.tabela.split('.')
  conferirIdentificador(schema, `schema de ${chave}`)
  conferirIdentificador(nome, `tabela de ${chave}`)
  for (const coluna of cat.colunas) conferirIdentificador(coluna, `coluna de ${chave}`)
  for (const assoc of cat.associacoes) {
    const [s, n] = assoc.tabela.split('.')
    conferirIdentificador(s, `schema associado de ${chave}`)
    conferirIdentificador(n, `tabela associada de ${chave}`)
    conferirIdentificador(assoc.coluna, `coluna associada de ${chave}`)
  }
}

// --- As quatro operações, iguais para os nove ---------------------------------

/**
 * Quem ainda aponta para as linhas que se quer apagar.
 *
 * UMA consulta por associação, com a lista inteira de ids: perguntar uma vez por
 * id daria N consultas para responder "alguém usa alguma destas".
 */
const conferirAssociacoes = async (t, cat, ids) => {
  for (const assoc of cat.associacoes) {
    const emUso = await t.oneOrNone(
      `SELECT 1 FROM ${assoc.tabela}
        WHERE ${assoc.coluna} IN ($<ids:csv>) LIMIT 1`,
      { ids }
    )
    if (emUso) {
      throw new AppError(assoc.mensagem, httpCode.BadRequest)
    }
  }
}

/**
 * As quatro funções de um catálogo.
 *
 * A GRAVAÇÃO É LINHA A LINHA, e o SAP fazia em bloco com
 * `db.pgp.helpers.insert(array)`. A troca é pela AUDITORIA: um único INSERT de
 * 40 estilos devolve 40 linhas mas não dá onde pendurar 40 eventos com o estado
 * de cada uma, e `auditoria.evento` é por REGISTRO. O `RETURNING *` de cada
 * linha é o que vai para `dados_depois`, e o `contexto.loteId` (um por
 * requisição) reagrupa a publicação inteira numa tela só.
 *
 * O CUSTO É REAL e foi pesado: publicar um grupo de estilos é dezenas de linhas
 * de dezenas de KB, e agora são dezenas de idas ao banco dentro da MESMA
 * transação em vez de uma. Escrita sem rastro não é opção nesta casa, e o
 * catálogo se publica uma vez por campanha, não por minuto.
 */
const operacoesDe = chave => {
  const cat = CATALOGOS[chave]

  const listar = () => db.conn.any(cat.select)

  const gravar = (linhas, usuarioUuid, contexto) =>
    comTraducao(
      () =>
        db.conn.tx(async t => {
          const owner = cat.autor ? await autorDe(t, usuarioUuid) : null

          const colunas = cat.autor ? [...cat.colunas, 'owner'] : cat.colunas
          const nomes = colunas.join(', ')
          const marcadores = colunas.map(c => `$<${c}>`).join(', ')

          const criados = []
          for (const linha of linhas) {
            const valores = normaliza(cat.colunas, linha)
            if (cat.autor) valores.owner = owner

            // `update_time` NÃO entra no INSERT: a coluna tem
            // `DEFAULT now()` no DDL, e repeti-la aqui daria dois lugares
            // decidindo o mesmo instante.
            const criado = await t.one(
              `INSERT INTO ${cat.tabela} (${nomes}) VALUES (${marcadores}) RETURNING *`,
              valores
            )

            await auditoriaCtrl.registrar(t, {
              tabela: cat.tabela,
              registroId: criado.id,
              operacao: 'I',
              depois: criado,
              usuarioUuid,
              contexto
            })

            criados.push({ id: criado.id })
          }

          return criados
        }),
      cat.erros
    )

  const atualizar = (linhas, usuarioUuid, contexto) =>
    comTraducao(
      () =>
        db.conn.tx(async t => {
          const owner = cat.autor ? await autorDe(t, usuarioUuid) : null

          const atribuicoes = cat.colunas.map(c => `${c} = $<${c}>`)
          if (cat.autor) {
            // Aqui `update_time` ENTRA, e por isso o INSERT não precisou dele:
            // o DEFAULT só vale na criação, e o plugin do QGIS usa esta coluna
            // para saber se o catálogo que ele tem em disco envelheceu.
            atribuicoes.push('owner = $<owner>', 'update_time = NOW()')
          }
          const set = atribuicoes.join(', ')

          for (const linha of linhas) {
            // `lerAntes` faz as DUAS coisas numa consulta: guarda o estado
            // anterior para o rastro e lança o 404 quando o id não existe.
            //
            // O SAP respondia 400 ("O id informado não corresponde a...") para
            // id inexistente, e aqui é 404: id que não existe é recurso que não
            // existe, e a leitura do estado anterior já ia ao banco de qualquer
            // jeito.
            const antes = await auditoriaCtrl.lerAntes(t, cat.tabela, linha.id, cat.rotulo)

            const valores = { ...normaliza(cat.colunas, linha), id: linha.id }
            if (cat.autor) valores.owner = owner

            const depois = await t.one(
              `UPDATE ${cat.tabela} SET ${set} WHERE id = $<id> RETURNING *`,
              valores
            )

            await auditoriaCtrl.registrar(t, {
              tabela: cat.tabela,
              registroId: linha.id,
              operacao: 'U',
              antes,
              depois,
              usuarioUuid,
              contexto
            })
          }
        }),
      cat.erros
    )

  const deletar = (ids, usuarioUuid, contexto) =>
    comTraducao(
      () =>
        db.conn.tx(async t => {
          // A conferência das associações vem ANTES de apagar qualquer uma: com
          // ela no meio do laço, as primeiras linhas já teriam sido apagadas
          // quando a quinta esbarrasse num perfil. A transação desfaria tudo,
          // mas a mensagem falaria de uma linha e o pedido era sobre todas.
          await conferirAssociacoes(t, cat, ids)

          for (const id of ids) {
            const antes = await auditoriaCtrl.lerAntes(t, cat.tabela, id, cat.rotulo)

            await t.none(`DELETE FROM ${cat.tabela} WHERE id = $<id>`, { id })

            await auditoriaCtrl.registrar(t, {
              tabela: cat.tabela,
              registroId: id,
              operacao: 'D',
              antes,
              usuarioUuid,
              contexto
            })
          }
        }),
      {
        // Na exclusão o 23503 é a associação que a conferência acima não cobre
        // (uma chave estrangeira nova que ninguém declarou em `associacoes`).
        [FK_VIOLATION]:
          'Não é possível remover: existe cadastro que ainda aponta para este registro'
      }
    )

  return { listar, gravar, atualizar, deletar }
}

controller.grupoEstilos = operacoesDe('grupoEstilos')
controller.estilos = operacoesDe('estilos')
controller.regras = operacoesDe('regras')
controller.menus = operacoesDe('menus')
controller.modelos = operacoesDe('modelos')
controller.alias = operacoesDe('alias')
controller.temas = operacoesDe('temas')
controller.workflows = operacoesDe('workflows')
controller.gerenciadorFme = operacoesDe('gerenciadorFme')

// --- Os domínios --------------------------------------------------------------

// TREZE LISTAS DE `code, nome`, cada uma na própria rota, e isto PARECE defeito
// ao lado do `GET /equipamento/dominio`, que devolve as cinco de lá numa
// resposta só. É deliberado: as rotas abaixo são as do SAP 2.3.5, uma a uma, e
// quem as chama é o SAP Gerente, que pede a lista que a aba aberta precisa. A
// tela de fluxo de produção não carrega o catálogo de insumos.
//
// `ORDER BY code` em todas. O SAP não ordenava nada, e a ordem física de uma
// tabela semeada é estável até o primeiro UPDATE.
// O nome da tabela é interpolado, e por isso passa pela mesma conferência dos
// catálogos -- e ela roda AQUI, no carregamento do módulo, e não dentro da
// função devolvida: erro de digitação vira exceção no boot, e não um 500 na
// primeira vez que alguém abrir a aba.
const listaDominio = tabela => {
  const nome = conferirIdentificador(tabela, 'tabela de domínio')
  return () => db.conn.any(`SELECT code, nome FROM dominio.${nome} ORDER BY code`)
}

controller.dominio = {
  // O SAP lia `dominio.status`, que NÃO atravessou. Quem responde aqui é
  // `dominio.tipo_status_execucao` (1 Não iniciado, 2 Em execução, 3 Concluído,
  // 4 Concluído parcialmente, 5 Pausado), que é a mesma pergunta com o nome que
  // o SCA já usava. A ROTA continua `/status` porque é o caminho que o SAP
  // Gerente chama.
  status: listaDominio('tipo_status_execucao'),

  tipoRotina: listaDominio('tipo_rotina'),
  tipoCriacaoUnidadeTrabalho: listaDominio('tipo_criacao_unidade_trabalho'),
  tipoControleQualidade: listaDominio('tipo_controle_qualidade'),

  // `tipo_fase` tem uma terceira coluna, `cor`, e ela NÃO sai aqui: o SELECT é
  // o do SAP. Quem usa a cor são as funções do schema `acompanhamento`, que a
  // injetam no estilo das views que o QGIS abre, e não esta lista.
  tipoFase: listaDominio('tipo_fase'),

  // BUG DA ORIGEM, CORRIGIDO. No SAP, `getTipoPreRequisito` lia
  // `metadado.tipo_palavra_chave`: a rota se chama pré-requisito e devolvia a
  // lista de palavras-chave do metadado, que é outro assunto inteiro. Quem
  // responde aqui é `dominio.tipo_pre_requisito` (1 Região concluída, 2 Região
  // não estar em execução), que é o domínio que `producao.pre_requisito_subfase`
  // referencia de verdade.
  tipoPreRequisito: listaDominio('tipo_pre_requisito'),

  tipoEtapa: listaDominio('tipo_etapa'),
  tipoExibicao: listaDominio('tipo_exibicao'),

  // SÃO DOIS CODES, e não três: 'Operadores no mesmo turno' (o 3) foi removido
  // em 2026-08-09 junto com `dominio.tipo_turno`. Ver `er/dominio.sql`.
  tipoRestricao: listaDominio('tipo_restricao'),

  tipoInsumo: listaDominio('tipo_insumo'),
  tipoDadoProducao: listaDominio('tipo_dado_producao'),
  tipoEstrategiaAssociacao: listaDominio('tipo_estrategia_associacao'),

  // A ÚNICA COM COLUNA REPETIDA, e é contrato: o SAP devolvia
  // `nome AS tipo_perfil_dificuldade`, e é por esse nome que o SAP Gerente lê o
  // rótulo. `nome` sai junto para esta lista ter a mesma forma das outras doze.
  tipoPerfilDificuldade: () =>
    db.conn.any(
      `SELECT code, nome, nome AS tipo_perfil_dificuldade
         FROM dominio.tipo_perfil_dificuldade ORDER BY code`
    )
}

module.exports = controller

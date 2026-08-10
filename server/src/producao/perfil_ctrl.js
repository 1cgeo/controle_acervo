'use strict'

// OS PERFIS DE CONFIGURAÇÃO DA SUBFASE NO LOTE, e a cópia de configuração entre
// lotes.
//
// "PERFIL" AQUI É PERFIL DO QGIS, e nunca autorização -- ver o cabeçalho de
// `perfil_schema.js`.
//
// SÃO DOZE GRUPOS COM A MESMA FORMA, e por isso há uma fábrica: cada grupo é
// uma tabela `(alguma coisa do schema qgis, subfase, lote)` com as quatro
// colunas de auditoria do SCA. Escrever doze vezes o mesmo INSERT, o mesmo
// UPDATE, o mesmo DELETE e o mesmo par de eventos de rastro seria doze lugares
// para a próxima correção esquecer um.
//
// TODA ESCRITA É EM MASSA, porque é assim que a tela do SAP Gerente trabalha: o
// corpo traz um array e a transação é uma só. O rastro, porém, é UM EVENTO POR
// LINHA: `contexto.loteId` já agrupa a operação numa tela só, e um evento único
// para vinte linhas não responderia "quem tirou este menu desta subfase".

const { db } = require('../database')

const auditoriaCtrl = require('../auditoria/auditoria_ctrl')

const { AppError, httpCode } = require('../utils')

const controller = {}

// --- Identificadores interpolados no SQL -------------------------------------

// Os nomes de tabela e de coluna deste arquivo são CONSTANTES DE CÓDIGO, e nada
// aqui vem do corpo da requisição. A conferência é a mesma que
// `auditoria/auditoria_ctrl.js` faz pelo mesmo motivo: confiar em "o chamador
// não faria isso" é exatamente o que produz injeção, e o custo é uma expressão
// regular avaliada uma vez no carregamento do módulo.
const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/

const identificador = (valor, papel) => {
  const texto = String(valor)
  if (!IDENTIFICADOR.test(texto)) {
    throw new Error(`Perfil de configuração: ${papel} inválido: "${texto}"`)
  }
  return texto
}

const alvoDe = tabela => {
  const [schema, nome] = String(tabela).split('.')
  return `${identificador(schema, 'schema')}.${identificador(nome, 'tabela')}`
}

// --- Erros do banco que viram resposta amigável ------------------------------

const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'

const traduzirErro = (err, mensagens) => {
  if (!err || !err.code) return err
  const frase = mensagens[err.code]
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

// --- A fábrica dos doze grupos -----------------------------------------------

/**
 * O corpo da linha reduzido às colunas que a tabela tem.
 *
 * O opcional AUSENTE vira null antes da consulta: sem isto, um corpo válido que
 * omite um campo anulável derruba o pg-promise com "Property doesn't exist", que
 * chega como 500 onde não houve erro nenhum.
 */
const valoresDe = (colunas, linha, normalizar) => {
  const base = normalizar ? normalizar(linha) : linha
  const saida = {}
  for (const coluna of colunas) {
    saida[coluna] = base[coluna] !== undefined ? base[coluna] : null
  }
  return saida
}

// AS QUATRO COLUNAS DE AUDITORIA SÃO PREENCHIDAS AQUI, e não por gatilho: as
// doze tabelas têm `data_cadastramento`, `usuario_cadastramento_uuid`,
// `data_modificacao` e `usuario_modificacao_uuid`, e a primeira tem DEFAULT
// mas a segunda é NOT NULL sem default.
const sqlInserir = (tabela, colunas) => {
  const cols = colunas.map(c => identificador(c, 'coluna'))
  return `INSERT INTO ${alvoDe(tabela)}
            (${cols.join(', ')}, usuario_cadastramento_uuid)
          VALUES
            (${cols.map(c => `$<${c}>`).join(', ')}, $<usuarioCadastramentoUuid>)
          RETURNING *`
}

const sqlAtualizar = (tabela, colunas) => {
  const cols = colunas.map(c => identificador(c, 'coluna'))
  return `UPDATE ${alvoDe(tabela)} SET
            ${cols.map(c => `${c} = $<${c}>`).join(', ')},
            data_modificacao = CURRENT_TIMESTAMP,
            usuario_modificacao_uuid = $<usuarioModificacaoUuid>
          WHERE id = $<id>
          RETURNING *`
}

const sqlApagar = tabela => `DELETE FROM ${alvoDe(tabela)} WHERE id = $<id>`

/**
 * As quatro operações de um grupo de perfil.
 *
 * @param {object} grupo
 * @param {string} grupo.tabela - 'producao.perfil_menu'
 * @param {string} grupo.rotulo - como o erro e o 404 chamam o registro
 * @param {string} grupo.select - o SQL da listagem, inteiro
 * @param {string[]} grupo.colunas - as colunas graváveis, subfase e lote inclusive
 * @param {Function} [grupo.normalizar] - conserto de tipo antes de gravar
 * @param {string} [grupo.apontado] - o que a chave estrangeira do grupo aponta
 */
const crudDePerfil = ({ tabela, rotulo, select, colunas, normalizar, apontado }) => {
  const inserir = sqlInserir(tabela, colunas)
  const atualizar = sqlAtualizar(tabela, colunas)
  const apagar = sqlApagar(tabela)

  const erros = {
    // O UNIQUE das doze tabelas é sempre (o item apontado, subfase, lote). O 500
    // cru citaria o nome da restrição, que não diz nada a quem acabou de montar
    // a tela.
    [UNIQUE_VIOLATION]:
      `Já existe ${rotulo} igual a este para a mesma subfase do mesmo lote`,
    [FK_VIOLATION]:
      `${rotulo}: a subfase, o lote${apontado ? ` ou ${apontado}` : ''} informado não existe`
  }

  return {
    tabela,

    listar: async () => db.conn.any(select),

    criar: async (linhas, usuarioUuid, contexto) =>
      comTraducao(
        () =>
          db.conn.tx(async t => {
            const ids = []
            for (const linha of linhas) {
              const criado = await t.one(inserir, {
                ...valoresDe(colunas, linha, normalizar),
                usuarioCadastramentoUuid: usuarioUuid
              })

              await auditoriaCtrl.registrar(t, {
                tabela,
                registroId: criado.id,
                operacao: 'I',
                depois: criado,
                usuarioUuid,
                contexto
              })

              ids.push(criado.id)
            }
            return { ids }
          }),
        erros
      ),

    atualizar: async (linhas, usuarioUuid, contexto) =>
      comTraducao(
        () =>
          db.conn.tx(async t => {
            for (const linha of linhas) {
              // `lerAntes` faz as DUAS coisas numa consulta: guarda o estado
              // anterior para o rastro e lança o 404 quando o id não existe. É
              // ele que substitui o `SELECT id ... WHERE id IN (...)` que o SAP
              // roda antes de cada UPDATE em massa.
              const antes = await auditoriaCtrl.lerAntes(t, tabela, linha.id, rotulo)

              const depois = await t.one(atualizar, {
                ...valoresDe(colunas, linha, normalizar),
                usuarioModificacaoUuid: usuarioUuid,
                id: linha.id
              })

              await auditoriaCtrl.registrar(t, {
                tabela,
                registroId: linha.id,
                operacao: 'U',
                antes,
                depois,
                usuarioUuid,
                contexto
              })
            }
          }),
        erros
      ),

    deletar: async (ids, usuarioUuid, contexto) =>
      comTraducao(
        () =>
          db.conn.tx(async t => {
            for (const id of ids) {
              const antes = await auditoriaCtrl.lerAntes(t, tabela, id, rotulo)

              await t.none(apagar, { id })

              await auditoriaCtrl.registrar(t, {
                tabela,
                registroId: id,
                operacao: 'D',
                antes,
                usuarioUuid,
                contexto
              })
            }
          }),
        erros
      )
  }
}

// --- Os doze grupos ----------------------------------------------------------
//
// TODA LISTAGEM DEVOLVE `subfase` E `lote` PELO NOME, e o SAP fazia isso em
// apenas alguns grupos. A tela é uma grade de "esta configuração, nesta subfase,
// neste lote": sem os dois nomes, cada linha mostra dois números que o operador
// não tem como ler, e cada tela precisaria de duas chamadas a mais.
//
// A ORDENAÇÃO É EXPLÍCITA em todas, e o SAP não tinha nenhuma. Sem `ORDER BY` a
// ordem das linhas é a que o Postgres achar melhor no dia, e a grade se
// reembaralha a cada F5.

const SUBFASE_E_LOTE = alias => `
  INNER JOIN producao.subfase AS s ON s.id = ${alias}.subfase_id
  INNER JOIN acervo.lote AS l ON l.id = ${alias}.lote_id`

// 1. As rotinas FME.
//
// NÃO JUNTA `qgis.gerenciador_fme`, e a omissão é deliberada: a coluna `url` de
// lá é o ENDEREÇO do servidor FME da instalação, e a grade não precisa dele para
// desenhar a linha (ela mostra o servidor pelo id, como no SAP). Quem quer o
// catálogo de servidores tem a rota própria dele.
controller.fme = crudDePerfil({
  tabela: 'producao.perfil_fme',
  rotulo: 'um perfil FME',
  apontado: 'o gerenciador FME',
  colunas: [
    'gerenciador_fme_id',
    'rotina',
    'requisito_finalizacao',
    'tipo_rotina_id',
    'ordem',
    'subfase_id',
    'lote_id'
  ],
  // A COLUNA É `VARCHAR(255)` e o Joi aceita texto ou número, porque o schema do
  // SAP declara inteiro sobre uma coluna de texto. Aqui a ambiguidade acaba: o
  // que vai ao banco é sempre texto.
  normalizar: linha => ({
    ...linha,
    rotina: linha.rotina === null || linha.rotina === undefined
      ? null
      : String(linha.rotina)
  }),
  select: `
    SELECT pf.id, pf.gerenciador_fme_id, pf.rotina, pf.requisito_finalizacao,
           pf.tipo_rotina_id, tr.nome AS tipo_rotina, pf.ordem,
           pf.subfase_id, s.nome AS subfase, pf.lote_id, l.nome AS lote
      FROM producao.perfil_fme AS pf
      INNER JOIN dominio.tipo_rotina AS tr ON tr.code = pf.tipo_rotina_id
      ${SUBFASE_E_LOTE('pf')}
     ORDER BY l.nome, s.nome, pf.ordem, pf.id`
})

// 2. O menu customizado do QGIS.
controller.menu = crudDePerfil({
  tabela: 'producao.perfil_menu',
  rotulo: 'um perfil de menu',
  apontado: 'o menu',
  colunas: ['menu_id', 'menu_revisao', 'subfase_id', 'lote_id'],
  select: `
    SELECT pm.id, pm.menu_id, qm.nome, qm.definicao_menu, pm.menu_revisao,
           pm.subfase_id, s.nome AS subfase, pm.lote_id, l.nome AS lote
      FROM producao.perfil_menu AS pm
      INNER JOIN qgis.qgis_menus AS qm ON qm.id = pm.menu_id
      ${SUBFASE_E_LOTE('pm')}
     ORDER BY l.nome, s.nome, qm.nome, pm.id`
})

// 3. Quanto da linhagem o operador vê.
controller.linhagem = crudDePerfil({
  tabela: 'producao.perfil_linhagem',
  rotulo: 'um perfil de linhagem',
  apontado: 'o tipo de exibição',
  colunas: ['tipo_exibicao_id', 'subfase_id', 'lote_id'],
  select: `
    SELECT pl.id, pl.tipo_exibicao_id, te.nome AS tipo_exibicao,
           pl.subfase_id, s.nome AS subfase, pl.lote_id, l.nome AS lote
      FROM producao.perfil_linhagem AS pl
      INNER JOIN dominio.tipo_exibicao AS te ON te.code = pl.tipo_exibicao_id
      ${SUBFASE_E_LOTE('pl')}
     ORDER BY l.nome, s.nome, pl.id`
})

// 4. Os modelos de processamento do QGIS, na ordem em que rodam.
controller.modelo = crudDePerfil({
  tabela: 'producao.perfil_model_qgis',
  rotulo: 'um perfil de modelo QGIS',
  apontado: 'o modelo',
  colunas: [
    'qgis_model_id',
    'parametros',
    'requisito_finalizacao',
    'tipo_rotina_id',
    'ordem',
    'subfase_id',
    'lote_id'
  ],
  select: `
    SELECT pmq.id, pmq.qgis_model_id, qm.nome, qm.descricao, pmq.parametros,
           pmq.requisito_finalizacao, pmq.tipo_rotina_id, tr.nome AS tipo_rotina,
           pmq.ordem, pmq.subfase_id, s.nome AS subfase,
           pmq.lote_id, l.nome AS lote
      FROM producao.perfil_model_qgis AS pmq
      INNER JOIN qgis.qgis_models AS qm ON qm.id = pmq.qgis_model_id
      INNER JOIN dominio.tipo_rotina AS tr ON tr.code = pmq.tipo_rotina_id
      ${SUBFASE_E_LOTE('pmq')}
     ORDER BY l.nome, s.nome, pmq.ordem, pmq.id`
})

// 5. As regras de atributo que o DSGTools cobra.
controller.regras = crudDePerfil({
  tabela: 'producao.perfil_regras',
  rotulo: 'um perfil de regras',
  apontado: 'a regra',
  colunas: ['layer_rules_id', 'subfase_id', 'lote_id'],
  select: `
    SELECT pr.id, pr.layer_rules_id, lr.nome,
           pr.subfase_id, s.nome AS subfase, pr.lote_id, l.nome AS lote
      FROM producao.perfil_regras AS pr
      INNER JOIN qgis.layer_rules AS lr ON lr.id = pr.layer_rules_id
      ${SUBFASE_E_LOTE('pr')}
     ORDER BY l.nome, s.nome, lr.nome, pr.id`
})

// 6. O GRUPO de estilos. A TABELA É SINGULAR (`perfil_estilo`) e o caminho da
//    rota é plural (`/configuracao/perfil_estilos`): os dois vêm do SAP.
controller.estilos = crudDePerfil({
  tabela: 'producao.perfil_estilo',
  rotulo: 'um perfil de estilos',
  apontado: 'o grupo de estilos',
  colunas: ['grupo_estilo_id', 'subfase_id', 'lote_id'],
  select: `
    SELECT pe.id, pe.grupo_estilo_id, gs.nome,
           pe.subfase_id, s.nome AS subfase, pe.lote_id, l.nome AS lote
      FROM producao.perfil_estilo AS pe
      INNER JOIN qgis.group_styles AS gs ON gs.id = pe.grupo_estilo_id
      ${SUBFASE_E_LOTE('pe')}
     ORDER BY l.nome, s.nome, gs.nome, pe.id`
})

// 7. O que o operador confirma à mão antes de finalizar.
controller.requisitoFinalizacao = crudDePerfil({
  tabela: 'producao.perfil_requisito_finalizacao',
  rotulo: 'um requisito de finalização',
  colunas: ['descricao', 'ordem', 'subfase_id', 'lote_id'],
  select: `
    SELECT prf.id, prf.descricao, prf.ordem,
           prf.subfase_id, s.nome AS subfase, prf.lote_id, l.nome AS lote
      FROM producao.perfil_requisito_finalizacao AS prf
      ${SUBFASE_E_LOTE('prf')}
     ORDER BY l.nome, s.nome, prf.ordem, prf.id`
})

// 8. O apelido dos campos das camadas.
controller.alias = crudDePerfil({
  tabela: 'producao.perfil_alias',
  rotulo: 'um perfil de alias',
  apontado: 'o alias',
  colunas: ['alias_id', 'subfase_id', 'lote_id'],
  select: `
    SELECT pa.id, pa.alias_id, la.nome,
           pa.subfase_id, s.nome AS subfase, pa.lote_id, l.nome AS lote
      FROM producao.perfil_alias AS pa
      INNER JOIN qgis.layer_alias AS la ON la.id = pa.alias_id
      ${SUBFASE_E_LOTE('pa')}
     ORDER BY l.nome, s.nome, la.nome, pa.id`
})

// 9. O tema de camadas. Tabela SINGULAR (`perfil_tema`), caminho plural.
controller.temas = crudDePerfil({
  tabela: 'producao.perfil_tema',
  rotulo: 'um perfil de tema',
  apontado: 'o tema',
  colunas: ['tema_id', 'subfase_id', 'lote_id'],
  select: `
    SELECT pt.id, pt.tema_id, qt.nome AS tema, qt.definicao_tema,
           pt.subfase_id, s.nome AS subfase, pt.lote_id, l.nome AS lote
      FROM producao.perfil_tema AS pt
      INNER JOIN qgis.qgis_themes AS qt ON qt.id = pt.tema_id
      ${SUBFASE_E_LOTE('pt')}
     ORDER BY l.nome, s.nome, qt.nome, pt.id`
})

// 10. Como as ferramentas do DSGTools nascem configuradas.
//
// O `id` SAI NA LISTA, e no SAP não saía. Sem ele a tela não tem como montar o
// corpo do PUT nem do DELETE, que são justamente por id: era defeito de lá.
controller.configuracaoQgis = crudDePerfil({
  tabela: 'producao.perfil_configuracao_qgis',
  rotulo: 'um perfil de configuração do QGIS',
  apontado: 'o tipo de configuração',
  colunas: ['tipo_configuracao_id', 'parametros', 'subfase_id', 'lote_id'],
  select: `
    SELECT pcq.id, pcq.tipo_configuracao_id, tc.nome AS tipo_configuracao,
           pcq.parametros, pcq.subfase_id, s.nome AS subfase,
           pcq.lote_id, l.nome AS lote
      FROM producao.perfil_configuracao_qgis AS pcq
      INNER JOIN dominio.tipo_configuracao AS tc ON tc.code = pcq.tipo_configuracao_id
      ${SUBFASE_E_LOTE('pcq')}
     ORDER BY l.nome, s.nome, tc.nome, pcq.id`
})

// 11. O workflow do DSGTools.
//
// `workflow_json` SAI NA LISTA porque saía no SAP, e o plugin o consome daqui.
controller.workflowDsgtools = crudDePerfil({
  tabela: 'producao.perfil_workflow_dsgtools',
  rotulo: 'um perfil de workflow DSGTools',
  apontado: 'o workflow',
  colunas: [
    'workflow_dsgtools_id',
    'requisito_finalizacao',
    'subfase_id',
    'lote_id'
  ],
  select: `
    SELECT pwd.id, pwd.workflow_dsgtools_id, pwd.requisito_finalizacao,
           wd.nome, wd.descricao, wd.workflow_json, wd.owner, wd.update_time,
           pwd.subfase_id, s.nome AS subfase, pwd.lote_id, l.nome AS lote
      FROM producao.perfil_workflow_dsgtools AS pwd
      INNER JOIN qgis.workflow_dsgtools AS wd ON wd.id = pwd.workflow_dsgtools_id
      ${SUBFASE_E_LOTE('pwd')}
     ORDER BY l.nome, s.nome, wd.nome, pwd.id`
})

// 12. Que dificuldade entregar a esta pessoa, nesta subfase deste lote.
//
// A TABELA É `producao.habilitacao_dificuldade`, e não `perfil_*`: no SCA
// "perfil" já quer dizer autorização, e esta tabela fala de PESSOAS. O caminho
// da rota continua `/configuracao/perfil_dificuldade_operador` porque é ele que
// o SAP Gerente chama.
//
// A PESSOA É UUID, e não o `usuario_id` INTEGER do SAP.
controller.dificuldadeOperador = crudDePerfil({
  tabela: 'producao.habilitacao_dificuldade',
  rotulo: 'uma habilitação por dificuldade',
  apontado: 'o usuário',
  colunas: [
    'usuario_uuid',
    'subfase_id',
    'lote_id',
    'tipo_perfil_dificuldade_id'
  ],
  select: `
    SELECT hd.id, hd.usuario_uuid, u.nome AS usuario_nome,
           u.nome_guerra AS usuario_nome_guerra, pg.nome_abrev AS usuario_posto,
           hd.tipo_perfil_dificuldade_id, tpd.nome AS tipo_perfil_dificuldade,
           hd.subfase_id, s.nome AS subfase, hd.lote_id, l.nome AS lote
      FROM producao.habilitacao_dificuldade AS hd
      INNER JOIN dgeo.usuario AS u ON u.uuid = hd.usuario_uuid
      LEFT JOIN dominio.tipo_posto_grad AS pg ON pg.code = u.tipo_posto_grad_id
      INNER JOIN dominio.tipo_perfil_dificuldade AS tpd
        ON tpd.code = hd.tipo_perfil_dificuldade_id
      ${SUBFASE_E_LOTE('hd')}
     ORDER BY l.nome, s.nome, u.nome_guerra, hd.id`
})

// --- A cópia de configuração entre lotes -------------------------------------

// O QUE A CÓPIA COPIA, na ordem em que o SAP copia. Cada entrada é o
// interruptor do corpo, a tabela e as colunas que atravessam SEM o `lote_id`,
// que é justamente o que muda.
//
// AQUI A LISTA É DADO, e não escondê-la num `forEach` seria escrever onze
// INSERTs quase idênticos: o CONTRATO desta operação é um único caminho
// (`POST /configuracao/lote/copiar`), declarado no arquivo de rota, e não onze.
const GRUPOS_COPIAVEIS = [
  { flag: 'copiar_estilo', tabela: 'producao.perfil_estilo', colunas: ['grupo_estilo_id', 'subfase_id'] },
  { flag: 'copiar_menu', tabela: 'producao.perfil_menu', colunas: ['menu_id', 'menu_revisao', 'subfase_id'] },
  { flag: 'copiar_regra', tabela: 'producao.perfil_regras', colunas: ['layer_rules_id', 'subfase_id'] },
  { flag: 'copiar_modelo', tabela: 'producao.perfil_model_qgis', colunas: ['qgis_model_id', 'parametros', 'requisito_finalizacao', 'tipo_rotina_id', 'ordem', 'subfase_id'] },
  { flag: 'copiar_workflow', tabela: 'producao.perfil_workflow_dsgtools', colunas: ['workflow_dsgtools_id', 'requisito_finalizacao', 'subfase_id'] },
  { flag: 'copiar_alias', tabela: 'producao.perfil_alias', colunas: ['alias_id', 'subfase_id'] },
  { flag: 'copiar_linhagem', tabela: 'producao.perfil_linhagem', colunas: ['tipo_exibicao_id', 'subfase_id'] },
  { flag: 'copiar_finalizacao', tabela: 'producao.perfil_requisito_finalizacao', colunas: ['descricao', 'ordem', 'subfase_id'] },
  { flag: 'copiar_tema', tabela: 'producao.perfil_tema', colunas: ['tema_id', 'subfase_id'] },
  { flag: 'copiar_fme', tabela: 'producao.perfil_fme', colunas: ['gerenciador_fme_id', 'rotina', 'requisito_finalizacao', 'tipo_rotina_id', 'ordem', 'subfase_id'] },
  { flag: 'copiar_configuracao_qgis', tabela: 'producao.perfil_configuracao_qgis', colunas: ['tipo_configuracao_id', 'parametros', 'subfase_id'] },
  // O DÉCIMO SEGUNDO GANHOU DESTINO EM 2026-08-09, quando o microcontrole
  // atravessou por decisão do chefe. Ele ficou de fora até então porque
  // `microcontrole.perfil_monitoramento` não existia em banco nenhum, e a rota
  // devolvia o grupo numa lista `nao_copiado` em vez de fingir que copiara.
  //
  // ELE ENTRA NA MESMA LISTA E PELA MESMA FÁBRICA, sem caso especial, e é isso
  // que prova que a tabela nasceu com a forma certa: (alguma coisa, subfase,
  // lote) mais as quatro colunas de auditoria, como os onze de `producao`. O
  // schema é outro, e o `alvoDe` já qualifica schema e tabela.
  //
  // A LISTA `nao_copiado` NÃO SAIU DA RESPOSTA, e continua no contrato: hoje ela
  // sai sempre vazia, e é ela que dá lugar ao próximo grupo que entrar no corpo
  // antes de ter destino. Tirá-la obrigaria o SAP Gerente a mudar junto.
  { flag: 'copiar_monitoramento', tabela: 'microcontrole.perfil_monitoramento', colunas: ['tipo_monitoramento_id', 'subfase_id'] }
]

// NENHUM INTERRUPTOR SEM DESTINO, desde 2026-08-09. O mecanismo fica: ele custa
// um objeto vazio e é o que impede a próxima chave aceita-e-ignorada de mentir
// para a tela.
const GRUPOS_SEM_DESTINO = {}

const sqlCopiar = (tabela, colunas) => {
  const cols = colunas.map(c => identificador(c, 'coluna'))
  return `INSERT INTO ${alvoDe(tabela)}
            (${cols.join(', ')}, lote_id, usuario_cadastramento_uuid)
          SELECT ${cols.map(c => `o.${c}`).join(', ')},
                 $<destino>, $<usuarioUuid>
            FROM ${alvoDe(tabela)} AS o
           WHERE o.lote_id = $<origem>
          RETURNING *`
}

// --- A trava da linha de produção --------------------------------------------
//
// O QUE ELA IMPEDE. Cada linha das doze tabelas de perfil é (alguma coisa,
// `subfase_id`, `lote_id`), e quem a lê é a sessão do QGIS pela ETAPA da
// atividade, que traz o par (subfase, lote). Copiar a configuração de um lote
// para outro que não executa aquelas subfases grava dezenas de linhas que
// sessão nenhuma lê, e a tela responde "copiado com sucesso".
//
// A CHAVE ESTRANGEIRA NÃO PEGA ISSO, e o comentário desta seção prometia que
// pegaria até 2026-08-09. `sqlCopiar` copia `o.subfase_id` verbatim: o id
// continua existindo em `producao.subfase`, e a FK fica satisfeita. Não há
// recusa nenhuma, e o defeito só aparece quando alguém abre o QGIS e não
// encontra o menu que a tela jurou ter copiado.
//
// COMO A TRAVA VOLTOU, já que o modelo mudou. No SAP 2.3.5 ela era uma
// igualdade: `macrocontrole.lote.linha_producao_id` dos dois lotes tinha de
// bater. Aqui o lote é `acervo.lote`, que NÃO tem linha de produção e não vai
// ter -- é justamente o fato de um lote atravessar linhas que a decisão do chefe
// de 2026-08-09 reconheceu (`er/producao.sql`, `docs/decisoes.md`). A linha de
// produção de um lote é DERIVADA das etapas dele (etapa -> subfase -> fase ->
// linha_producao), que é o mesmo caminho de
// `acompanhamento.linhas_producao_do_lote`.
//
// ENTÃO A COBRANÇA É SOBRE O QUE VAI SER COPIADO, e não sobre os dois lotes
// inteiros: toda subfase que aparece na configuração da ORIGEM tem de pertencer
// a uma linha de produção que o DESTINO executa. Um destino que executa mais
// linhas que a origem passa, e é correto que passe -- tudo o que se copiou tem
// quem leia. Ressuscitar a igualdade do SAP recusaria esse caso, que o desenho
// de hoje considera normal.

const sqlSubfasesDaOrigem = grupo =>
  `SELECT o.subfase_id FROM ${alvoDe(grupo.tabela)} AS o WHERE o.lote_id = $<origem>`

const sqlLinhasEstranhas = grupos => `
  SELECT DISTINCT lp.nome AS linha_producao, s.nome AS subfase
    FROM (${grupos.map(sqlSubfasesDaOrigem).join(' UNION ')}) AS copiada
   INNER JOIN producao.subfase AS s ON s.id = copiada.subfase_id
   INNER JOIN producao.fase AS f ON f.id = s.fase_id
   INNER JOIN producao.linha_producao AS lp ON lp.id = f.linha_producao_id
   WHERE f.linha_producao_id NOT IN (
     SELECT f_destino.linha_producao_id
       FROM producao.etapa AS e_destino
      INNER JOIN producao.subfase AS s_destino ON s_destino.id = e_destino.subfase_id
      INNER JOIN producao.fase AS f_destino ON f_destino.id = s_destino.fase_id
      WHERE e_destino.lote_id = $<destino>
   )
   ORDER BY lp.nome, s.nome`

const SQL_LINHAS_DO_LOTE = `
  SELECT DISTINCT f.linha_producao_id
    FROM producao.etapa AS e
   INNER JOIN producao.subfase AS s ON s.id = e.subfase_id
   INNER JOIN producao.fase AS f ON f.id = s.fase_id
   WHERE e.lote_id = $<loteId>`

// Quantas subfases o erro cita antes de resumir. A recusa tem de dizer O QUE
// está errado, e uma lista de sessenta subfases numa caixa de mensagem não diz
// nada a mais que as cinco primeiras mais a contagem.
const SUBFASES_NO_ERRO = 5

/**
 * Recusa a cópia quando a configuração da origem aponta subfase que o destino
 * não executa.
 *
 * A CONSULTA DE LINHAS DO DESTINO SÓ RODA NO CAMINHO DA RECUSA, e ela existe
 * para a mensagem: "o destino não executa esta linha" e "o destino não tem etapa
 * nenhuma cadastrada" pedem providências diferentes de quem está na tela.
 */
const exigirMesmaLinhaProducao = async (t, grupos, origem, destino) => {
  // NENHUM GRUPO MARCADO, NADA A COBRAR: a cópia não vai gravar linha nenhuma.
  // Os grupos sem `subfase_id` ficariam de fora do UNION e derrubariam a
  // consulta; hoje as doze têm a coluna, e o filtro é o que impede a próxima
  // tabela de forma diferente de entrar calada.
  const comSubfase = grupos.filter(g => g.colunas.includes('subfase_id'))
  if (comSubfase.length === 0) return

  const estranhas = await t.any(sqlLinhasEstranhas(comSubfase), { origem, destino })
  if (estranhas.length === 0) return

  const linhasDoDestino = await t.any(SQL_LINHAS_DO_LOTE, { loteId: destino })

  if (linhasDoDestino.length === 0) {
    throw new AppError(
      'O lote de destino não tem etapa cadastrada em subfase nenhuma, e por isso ' +
        'não executa linha de produção alguma. Cadastre as etapas dele antes de ' +
        'copiar a configuração, senão nada do que for copiado será lido pelo QGIS',
      httpCode.BadRequest
    )
  }

  const citadas = estranhas
    .slice(0, SUBFASES_NO_ERRO)
    .map(l => `${l.subfase} (linha de produção ${l.linha_producao})`)
    .join('; ')

  const resto = estranhas.length - Math.min(estranhas.length, SUBFASES_NO_ERRO)

  throw new AppError(
    'A configuração do lote de origem aponta subfases de linha de produção que o ' +
      `lote de destino não executa: ${citadas}${resto > 0 ? ` e mais ${resto}` : ''}. ` +
      'A configuração copiada não seria lida por sessão nenhuma do QGIS. Copie ' +
      'apenas entre lotes que executem a mesma linha de produção',
    httpCode.BadRequest
  )
}

const ERROS_COPIA = {
  [UNIQUE_VIOLATION]:
    'O lote de destino já tem parte desta configuração. Apague o que está repetido antes de copiar, ou desmarque o grupo',
  [FK_VIOLATION]: 'Lote de origem ou de destino inexistente'
}

/**
 * Copia a configuração de um lote inteiro para outro, num ato só.
 *
 * É UMA TRANSAÇÃO SÓ, e é o ponto da rota: copiar onze grupos em onze
 * requisições deixaria o lote meio configurado quando a sexta falhasse.
 *
 * SÃO TRÊS CONFERÊNCIAS: que os lotes sejam diferentes, que os dois existam e
 * que a configuração copiada aponte subfases de linha de produção que o destino
 * EXECUTE. A terceira é a trava do SAP recuperada em 2026-08-09, e o bloco
 * "A trava da linha de produção" acima explica por que ela deixou de ser a
 * igualdade de `linha_producao_id` que a origem cobrava.
 *
 * ESTE COMENTÁRIO PROMETIA O QUE NÃO ACONTECIA: dizia que copiar entre linhas
 * diferentes daria "erro de chave estrangeira na subfase". Não dá. `sqlCopiar`
 * leva `o.subfase_id` verbatim, o id existe em `producao.subfase` e a FK fica
 * satisfeita -- a cópia entrava calada e a tela dizia "copiado com sucesso".
 *
 * UM EVENTO DE AUDITORIA POR LINHA CRIADA. São dezenas de linhas num ato só, e
 * é exatamente por isso: sem uma por linha, a ficha do lote de destino não
 * explicaria de onde veio cada menu que ninguém cadastrou ali.
 */
controller.copiarConfiguracaoLote = async (dados, usuarioUuid, contexto) => {
  const origem = dados.lote_id_origem
  const destino = dados.lote_id_destino

  if (origem === destino) {
    throw new AppError(
      'O lote de origem e o de destino são o mesmo',
      httpCode.BadRequest
    )
  }

  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const lotes = await t.any(
          'SELECT id FROM acervo.lote WHERE id IN ($<origem>, $<destino>)',
          { origem, destino }
        )
        if (lotes.length < 2) {
          throw new AppError(
            'Lote de origem ou de destino inexistente',
            httpCode.BadRequest
          )
        }

        const marcados = GRUPOS_COPIAVEIS.filter(grupo => dados[grupo.flag])

        // ANTES DE COPIAR QUALQUER LINHA, e dentro da mesma transação: a recusa
        // que chegasse depois do primeiro INSERT dependeria do ROLLBACK para não
        // deixar metade da configuração no destino.
        await exigirMesmaLinhaProducao(t, marcados, origem, destino)

        const copiado = {}

        for (const grupo of marcados) {
          const criadas = await t.any(sqlCopiar(grupo.tabela, grupo.colunas), {
            origem,
            destino,
            usuarioUuid
          })

          for (const linha of criadas) {
            await auditoriaCtrl.registrar(t, {
              tabela: grupo.tabela,
              registroId: linha.id,
              operacao: 'I',
              depois: linha,
              usuarioUuid,
              contexto,
              motivo: `Cópia da configuração do lote ${origem}`
            })
          }

          copiado[grupo.flag] = criadas.length
        }

        const naoCopiado = Object.keys(GRUPOS_SEM_DESTINO)
          .filter(flag => dados[flag])
          .map(flag => GRUPOS_SEM_DESTINO[flag])

        return { copiado, nao_copiado: naoCopiado }
      }),
    ERROS_COPIA
  )
}

module.exports = controller

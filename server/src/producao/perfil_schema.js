'use strict'

// O CONTRATO DOS PERFIS DE CONFIGURAÇÃO DA SUBFASE NO LOTE.
//
// "PERFIL" AQUI É PERFIL DO QGIS, e nunca autorização. Quem autoriza é
// `dominio.tipo_perfil` (1 consulta, 2 operador, 3 gerente), lido pelo
// `verifyPerfil` a cada requisição. Estas onze tabelas respondem outra pergunta:
// "quando alguém abrir a subfase X do lote Y, que menu, tema, estilo, regra,
// modelo e atalho o QGIS carrega". A ambiguidade foi resolvida do outro lado,
// renomeando o `perfil_producao` do SAP para `producao.habilitacao` -- ver
// `er/producao.sql`.
//
// O FORMATO DO CORPO É O DO SAP 2.3.5, e é preservado de propósito: quem consome
// estas rotas é o SAP Gerente, que já as chama com estes nomes de chave. Por isso
// os nomes são irregulares (`perfil_fme_ids` mas `perfis_alias_ids`;
// `perfis_temas` mas `perfil_workflow_dsgtools`): eles não são escolha nossa, e
// uniformizá-los quebraria o cliente sem avisar.
//
// AS TRÊS DIVERGÊNCIAS EM RELAÇÃO AO SAP, e por que cada uma:
//
//   1. `usuario_id` (INTEGER) virou `usuario_uuid` (UUID) em
//      `perfil_dificuldade_operador`. Não é opção: no SCA toda coluna de pessoa
//      é `usuario_uuid UUID REFERENCES dgeo.usuario (uuid)`, e a coluna
//      `usuario_id` não existe em `producao.habilitacao_dificuldade`.
//   2. `rotina` do perfil FME aceita TEXTO e número. O Joi do SAP declara
//      `Joi.number().integer()`, mas a coluna é `VARCHAR(255)` nos DOIS bancos:
//      o schema de lá está errado em relação ao DDL de lá. Aceitar os dois
//      preserva o que o SAP Gerente manda hoje sem mentir sobre a coluna, e o
//      controlador grava sempre como texto.
//   3. `.unique('id')` em TODA atualização. O SAP o tem em quatro dos doze
//      grupos, e a ausência nos outros oito é descuido: dois objetos com o mesmo
//      `id` no mesmo corpo são dois UPDATEs na mesma linha, e o segundo apaga o
//      primeiro em silêncio.

const Joi = require('joi')

const models = {}

// `.strict()` em todo número, como no SAP: sem ele a string '3' vira 3, e um
// corpo com aspas sobrando grava sem ninguém perceber.
const inteiro = () => Joi.number().integer().strict()

// SUBFASE E LOTE ESTÃO NAS DOZE TABELAS, e são a identidade delas: a mesma
// subfase é configurada diferente em lotes diferentes, e é por isso que existem
// onze tabelas de perfil em vez de uma.
//
// `lote_id` aponta `acervo.lote (id)`, que é BIGINT. Não existe
// `producao.lote` nem `producao.lote_linha` neste banco (ver `docs/decisoes.md`,
// "O core de produção, na 3.0.0").
const localizacao = {
  subfase_id: inteiro().required(),
  lote_id: inteiro().required()
}

/**
 * Os três schemas de um grupo, que têm sempre a mesma forma.
 *
 * @param {string} chaveLista - a chave do array no corpo do POST e do PUT
 * @param {string} chaveIds - a chave do array de ids no corpo do DELETE
 * @param {object} campos - as colunas próprias do grupo, sem subfase nem lote
 */
const grupoDePerfil = (chaveLista, chaveIds, campos) => ({
  criar: Joi.object().keys({
    [chaveLista]: Joi.array()
      .items(Joi.object().keys({ ...campos, ...localizacao }))
      .required()
      .min(1)
  }),
  atualizar: Joi.object().keys({
    [chaveLista]: Joi.array()
      .items(
        Joi.object().keys({
          id: inteiro().required(),
          ...campos,
          ...localizacao
        })
      )
      .unique('id')
      .required()
      .min(1)
  }),
  ids: Joi.object().keys({
    [chaveIds]: Joi.array()
      .items(inteiro().required())
      .unique()
      .required()
      .min(1)
  })
})

// --- Os doze grupos ----------------------------------------------------------

models.grupos = {
  // 1. As rotinas FME. `requisito_finalizacao` TRUE faz a rotina BARRAR a
  //    finalização quando acusa erro; FALSE a deixa informativa.
  fme: grupoDePerfil('perfis_fme', 'perfil_fme_ids', {
    gerenciador_fme_id: inteiro().required(),
    // TEXTO OU NÚMERO, e o controlador grava texto. Ver a nota 2 do cabeçalho.
    rotina: Joi.alternatives()
      .try(Joi.string().trim().max(255), inteiro())
      .required()
      .messages({
        'alternatives.types': 'A rotina deve ser um texto de até 255 caracteres'
      }),
    requisito_finalizacao: Joi.boolean().strict().required(),
    tipo_rotina_id: inteiro().required(),
    ordem: inteiro().required()
  }),

  // 2. O menu customizado. `menu_revisao` marca o menu que só aparece nas etapas
  //    de revisão, e é por isso que o mesmo lote pode ter dois menus para a
  //    mesma subfase.
  menu: grupoDePerfil('perfis_menu', 'perfil_menu_ids', {
    menu_id: inteiro().required(),
    menu_revisao: Joi.boolean().strict().required()
  }),

  // 3. Quanto da linhagem o operador vê. É o único grupo cujo UNIQUE no banco é
  //    só (subfase, lote): a resposta é uma só por subfase de lote.
  linhagem: grupoDePerfil('perfis_linhagem', 'perfil_linhagem_ids', {
    tipo_exibicao_id: inteiro().required()
  }),

  // 4. Os modelos de processamento do QGIS, na ordem em que rodam.
  //    `parametros` é TEXT anulável no DDL, e por isso aceita null e vazio nos
  //    dois sentidos -- no SAP a criação aceitava e a atualização não, sobre a
  //    mesma coluna.
  modelo: grupoDePerfil('perfis_modelo', 'perfil_modelo_ids', {
    qgis_model_id: inteiro().required(),
    parametros: Joi.string().required().allow(null, ''),
    requisito_finalizacao: Joi.boolean().strict().required(),
    tipo_rotina_id: inteiro().required(),
    ordem: inteiro().required()
  }),

  // 5. As regras de atributo que o DSGTools cobra.
  regras: grupoDePerfil('perfis_regras', 'perfil_regras_ids', {
    layer_rules_id: inteiro().required()
  }),

  // 6. O GRUPO de estilos, e não o estilo camada a camada.
  estilos: grupoDePerfil('perfis_estilos', 'perfil_estilos_ids', {
    grupo_estilo_id: inteiro().required()
  }),

  // 7. O que o operador confirma à mão antes de finalizar. Texto puro, na ordem
  //    em que aparece. `descricao` é VARCHAR(255) no DDL.
  requisitoFinalizacao: grupoDePerfil('perfis_requisito', 'perfil_requisito_ids', {
    descricao: Joi.string().max(255).required(),
    ordem: inteiro().required()
  }),

  // 8. O apelido dos campos das camadas.
  alias: grupoDePerfil('perfis_alias', 'perfis_alias_ids', {
    alias_id: inteiro().required()
  }),

  // 9. O tema de camadas.
  temas: grupoDePerfil('perfis_temas', 'perfil_temas_ids', {
    tema_id: inteiro().required()
  }),

  // 10. Como as ferramentas do DSGTools nascem configuradas.
  configuracaoQgis: grupoDePerfil(
    'perfis_configuracao_qgis',
    'perfis_configuracao_qgis_ids',
    {
      tipo_configuracao_id: inteiro().required(),
      parametros: Joi.string().required().allow(null, '')
    }
  ),

  // 11. O workflow do DSGTools. A chave do array é SINGULAR
  //     (`perfil_workflow_dsgtools`), e é assim que o SAP Gerente a manda.
  workflowDsgtools: grupoDePerfil(
    'perfil_workflow_dsgtools',
    'perfil_workflow_dsgtools_ids',
    {
      workflow_dsgtools_id: inteiro().required(),
      requisito_finalizacao: Joi.boolean().strict().required()
    }
  ),

  // 12. QUE DIFICULDADE ENTREGAR A ESTA PESSOA, nesta subfase deste lote.
  //     A TABELA É `producao.habilitacao_dificuldade` (era
  //     `macrocontrole.perfil_dificuldade_operador` no SAP), e o CAMINHO da rota
  //     continua o de lá porque o SAP Gerente o consome.
  //
  //     ISTO NÃO CONCEDE ACESSO A NADA: quem barra escrita é o perfil do módulo
  //     `producao` em `dgeo.usuario_perfil`. Esta linha só diz que trabalho a
  //     distribuição pode entregar a quem já está autorizado a operar.
  dificuldadeOperador: grupoDePerfil(
    'perfis_dificuldade_operador',
    'perfis_dificuldade_operador_ids',
    {
      // UUID, e não o `usuario_id` INTEGER do SAP. Ver a nota 1 do cabeçalho.
      usuario_uuid: Joi.string().uuid().required(),
      tipo_perfil_dificuldade_id: inteiro().required()
    }
  )
}

// --- A cópia de configuração entre lotes -------------------------------------

// DOZE INTERRUPTORES, um por grupo copiável, e todos obrigatórios: o SAP Gerente
// manda os doze, e um default silencioso aqui faria a tela copiar o que não
// pediu.
//
// `copiar_monitoramento` COPIA DESDE 2026-08-09, e até ali era a exceção: o
// schema `microcontrole` não existia neste banco, a chave era aceita para não
// quebrar o SAP Gerente, e a rota devolvia o grupo em `nao_copiado` em vez de
// fingir que copiara. O microcontrole atravessou por decisão do chefe, a tabela
// `microcontrole.perfil_monitoramento` nasceu com a mesma forma dos onze de
// `producao`, e o interruptor entrou na lista da fábrica sem caso especial.
//
// NÃO HÁ `copiar_linha_producao` nem coisa parecida: o SAP conferia que os dois
// lotes eram da MESMA linha de produção, e `acervo.lote` não tem linha nenhuma
// (a `producao.lote_linha` foi removida em 2026-08-09). O controlador confere o
// que sobrou: que os dois lotes existem e que são diferentes.
models.configuracaoLoteCopiar = Joi.object().keys({
  lote_id_origem: inteiro().required(),
  lote_id_destino: inteiro().required(),
  copiar_estilo: Joi.boolean().strict().required(),
  copiar_menu: Joi.boolean().strict().required(),
  copiar_regra: Joi.boolean().strict().required(),
  copiar_modelo: Joi.boolean().strict().required(),
  copiar_workflow: Joi.boolean().strict().required(),
  copiar_alias: Joi.boolean().strict().required(),
  copiar_linhagem: Joi.boolean().strict().required(),
  copiar_finalizacao: Joi.boolean().strict().required(),
  copiar_tema: Joi.boolean().strict().required(),
  copiar_fme: Joi.boolean().strict().required(),
  copiar_configuracao_qgis: Joi.boolean().strict().required(),
  copiar_monitoramento: Joi.boolean().strict().required()
})

module.exports = models

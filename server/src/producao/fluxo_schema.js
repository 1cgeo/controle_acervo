'use strict'

// Contrato de entrada do FLUXO da produção: linha de produção, fase, subfase,
// etapa e camadas. Atravessou do `projeto_schema.js` do SAP 2.3.5 em 2026-08-09.
//
// O QUE MUDOU DE LÁ PARA CÁ, e por quê:
//
//   `tipo_produto_id` -> `subtipo_produto_id`. O `dominio.tipo_produto` do SAP é,
//   code a code, o `dominio.subtipo_produto` daqui, e o `tipo_produto` do SCA é
//   outra coisa, mais grossa. Ver o comentário de `producao.linha_producao` em
//   `er/producao.sql`.
//
//   `lote_id` é o `acervo.lote (id)`, que é BIGINT. Não existe lote de produção
//   neste banco, e não existe tabela que case lote com linha de produção.
//
//   A REGRA DE APONTAMENTO ESPELHA O CHECK DO BANCO, e não a do SAP. Ver o bloco
//   sobre `propriedades_camada`, mais abaixo, que é a divergência mais
//   importante deste arquivo.

const Joi = require('joi')

const { TIPO_ETAPA, TIPO_RESTRICAO, TIPO_PRE_REQUISITO } = require('../utils/domain_constants')

const models = {}

// --- O que cada tipo de controle de qualidade SIGNIFICA em etapas -------------

/**
 * O PADRÃO DE ETAPAS de `POST /etapas/padrao`, por código de
 * `dominio.tipo_controle_qualidade`.
 *
 * MORA NO SCHEMA, e não no controlador, de propósito: é ele que diz o que o
 * campo `tipo_controle_qualidade_id` do corpo QUER DIZER, e é dele que sai o
 * `.valid()` que recusa o código desconhecido com 400 em vez de deixá-lo chegar
 * ao banco. Declará-lo aqui é o que impede a lista de códigos aceitos e a lista
 * de códigos implementados divergirem: são a MESMA.
 *
 * NÃO HÁ `TIPO_CONTROLE_QUALIDADE` EM `utils/domain_constants.js`, e a ausência
 * é deliberada e está escrita lá: o domínio é argumento de rotina de criação em
 * massa, nenhuma coluna aponta para ele e nenhum SQL compara código com literal.
 * Os códigos abaixo NÃO entram em consulta nenhuma: eles são chave de despacho
 * em JavaScript, e o controlador ainda confere o código contra
 * `dominio.tipo_controle_qualidade` antes de usá-los.
 *
 * A ORDEM DO ARRAY `etapas` É A COLUNA `ordem`, começando em 1. É por isso que
 * `TIPO_ETAPA.EXECUCAO` é sempre o PRIMEIRO elemento dos três padrões: o CHECK
 * `etapa_execucao_e_primeira` do DDL recusa Execução com ordem diferente de 1, e
 * uma revisão antes do trabalho revisaria o nada.
 *
 * `restricoes` aponta os elementos de `etapas` por ÍNDICE (`de` e `para`), e não
 * por tipo: no padrão 3 as duas restrições partem da mesma Execução, e nomear
 * por tipo perderia a distinção entre "quem executou não revisa" (1 -> 2) e
 * "quem executou é quem corrige" (1 -> 3).
 */
const PADRAO_CONTROLE_QUALIDADE = {
  // 1 - Sem controle de qualidade nas subfases
  1: {
    etapas: [TIPO_ETAPA.EXECUCAO],
    restricoes: []
  },
  // 2 - Uma Revisão/Correção em todas as subfases
  2: {
    etapas: [TIPO_ETAPA.EXECUCAO, TIPO_ETAPA.REVISAO_CORRECAO],
    restricoes: [{ tipo: TIPO_RESTRICAO.OPERADORES_DISTINTOS, de: 0, para: 1 }]
  },
  // 3 - Uma Revisão em todas as subfases (Execução, Revisão e Correção)
  3: {
    etapas: [TIPO_ETAPA.EXECUCAO, TIPO_ETAPA.REVISAO, TIPO_ETAPA.CORRECAO],
    restricoes: [
      // Quem executou não revisa.
      { tipo: TIPO_RESTRICAO.OPERADORES_DISTINTOS, de: 0, para: 1 },
      // Quem executou é quem corrige.
      { tipo: TIPO_RESTRICAO.OPERADORES_IGUAIS, de: 0, para: 2 }
    ]
  }
}

models.PADRAO_CONTROLE_QUALIDADE = PADRAO_CONTROLE_QUALIDADE

const CODIGOS_CONTROLE_QUALIDADE = Object.keys(PADRAO_CONTROLE_QUALIDADE).map(Number)

// --- Peças comuns ------------------------------------------------------------

// `id` de tabela SERIAL. `.positive()` porque SERIAL começa em 1, e um `/0` é
// erro de quem chamou, não um 404 depois de ir ao banco.
//
// `.strict()` PELO MESMO MOTIVO DOS IRMÃOS, e ele faltava aqui até 2026-08-09.
// Sem ele o Joi CONVERTE, e `{"camadas_ids": ["7"]}` era aceito em
// `DELETE /configuracao/camadas` enquanto o mesmo corpo levava 400 em
// `DELETE /grupo_estilos` -- e quem manda os dois é o mesmo SAP Gerente. A
// justificativa está escrita em `perfil_schema.js`: a string '3' vira 3 e um
// corpo com aspas sobrando grava sem ninguém perceber, até o dia em que chega
// '3a' e a rota quebra num lugar que nunca foi tocado.
const idSerial = () => Joi.number().integer().strict().positive()

// O lote é `acervo.lote (id)`, BIGSERIAL. Continua sendo inteiro positivo: o
// JavaScript representa exatamente até 2^53, e o acervo tem 102 lotes.
const idLote = () => Joi.number().integer().positive()

const nome = (max = 255) => Joi.string().trim().max(max)

// --- Parâmetros e consultas --------------------------------------------------

models.loteIdParams = Joi.object().keys({
  lote_id: idLote().required()
})

// `?status=ativo` estreita para as linhas de produção DISPONÍVEIS. Qualquer
// outro valor (inclusive 'inativo') não estreita nada, que é o comportamento do
// SAP: lá o controlador recebia `req.query.status === 'ativo'`, um booleano.
models.ativoQuery = Joi.object().keys({
  status: Joi.string().valid('ativo', 'inativo')
})

models.subfasesLoteQuery = Joi.object().keys({
  // CSV, e não array repetido na query: é a forma que o SAP usa e a que o
  // `subfase_ids=3,7,9` da barra de endereço produz sem ambiguidade.
  subfase_ids: Joi.string()
    .pattern(/^\d+(,\d+)*$/)
    .messages({
      'string.pattern.base':
        'subfase_ids deve ser uma lista de números inteiros separados por vírgula (ex.: 3,7,9)'
    }),
  // A geometria das unidades de trabalho é cara e só interessa a quem vai CLONAR
  // o molde de um lote noutro, então é opt-in.
  incluir_geom: Joi.boolean().default(false)
})

// --- Linha de produção -------------------------------------------------------

// UMA SUBFASE de uma fase nova. `ordem` é a posição dela dentro da fase.
const subfaseNova = Joi.object().keys({
  nome: nome().required(),
  ordem: Joi.number().integer().required()
})

// O pré-requisito ESPACIAL entre duas subfases da MESMA linha, declarado por
// NOME porque as subfases ainda não têm id quando o corpo é escrito.
const preRequisitoSubfase = Joi.object().keys({
  subfase_anterior: nome().required(),
  subfase_posterior: nome().required(),
  tipo_pre_requisito_id: Joi.number().integer().positive().required()
})

const faseNova = Joi.object().keys({
  tipo_fase_id: Joi.number().integer().positive().required(),
  ordem: Joi.number().integer().required(),
  subfases: Joi.array()
    .items(subfaseNova)
    // A UNIQUE do DDL é (nome, fase_id). Duas subfases com o mesmo nome na mesma
    // fase morreriam com 23505 no meio da transação, depois de metade da linha
    // de produção já ter sido inserida.
    .unique('nome')
    .required()
    .min(1),
  pre_requisito_subfase: Joi.array().items(preRequisitoSubfase)
})

/**
 * COMO UMA CAMADA SE COMPORTA NUMA SUBFASE (`producao.propriedades_camada`).
 *
 * A REGRA DE APONTAMENTO É TUDO OU NADA, e ela espelha, campo a campo, o CHECK
 * `propriedades_camada_apontamento_completo` do DDL: `camada_apontamento` TRUE
 * exige os dois atributos, e FALSE exige que os dois estejam ausentes ou nulos.
 * Camada de apontamento sem eles não tem onde registrar o apontamento, e camada
 * comum com eles preenchidos afirma o que ela não é.
 *
 * O JOI COBRA ANTES DO BANCO porque o CHECK chega como 500 com o nome da
 * restrição em inglês, que não diz a quem digitou o que fazer. Aqui a recusa é
 * 400, no campo certo, com a frase em português.
 *
 * `atributo_filtro_subfase` FICA DE FORA DA REGRA, e é a divergência
 * deliberada em relação ao SAP. Lá o `when` do `projeto_schema.js` o exigia
 * junto do apontamento e o PROIBIA fora dele. O CHECK do banco não o menciona:
 * ele é o atributo que filtra a camada POR SUBFASE, e serve à camada incomum
 * tanto quanto à de apontamento. Um Joi que recusasse o que o banco aceita
 * bloquearia um caso legítimo sem que nada no DDL explicasse por quê.
 */
const propriedadesCamadaNova = Joi.object()
  .keys({
    schema: nome().required(),
    camada: nome().required(),
    // Por NOME, como o pré-requisito, e pelo mesmo motivo: a subfase ainda não
    // tem id.
    subfase: nome().required(),
    camada_incomum: Joi.boolean().default(false),
    atributo_filtro_subfase: nome().allow(null),
    camada_apontamento: Joi.boolean().required(),
    atributo_situacao_correcao: Joi.when('camada_apontamento', {
      // `is: true` cru também casaria com a chave AUSENTE, porque o Joi compila
      // o literal sem `.required()`. Com ela explícita, "não declarou
      // apontamento" cai no `otherwise`, e é o `camada_apontamento` obrigatório
      // acima que cobra a declaração.
      is: Joi.any().valid(true).required(),
      then: nome().required().messages({
        'any.required':
          'Camada de apontamento exige "atributo_situacao_correcao": sem ele não há onde gravar a situação da correção'
      }),
      otherwise: Joi.any().valid(null).messages({
        'any.only':
          '"atributo_situacao_correcao" só existe em camada de apontamento (camada_apontamento verdadeiro)'
      })
    }),
    atributo_justificativa_apontamento: Joi.when('camada_apontamento', {
      is: Joi.any().valid(true).required(),
      then: nome().required().messages({
        'any.required':
          'Camada de apontamento exige "atributo_justificativa_apontamento": sem ele o apontamento não se justifica'
      }),
      otherwise: Joi.any().valid(null).messages({
        'any.only':
          '"atributo_justificativa_apontamento" só existe em camada de apontamento (camada_apontamento verdadeiro)'
      })
    })
  })

models.propriedadesCamadaNova = propriedadesCamadaNova

/**
 * Confere as referências POR NOME dentro do próprio corpo.
 *
 * O corpo declara subfases pelo nome e as referencia pelo nome em dois lugares
 * (`pre_requisito_subfase` e `propriedades_camadas`). O SAP resolvia isso com um
 * mapa `nome -> id` montado durante a inserção, e o mapa tinha DOIS buracos que
 * só apareciam depois de metade da linha de produção estar gravada:
 *
 *   - duas fases com uma subfase de mesmo nome sobrescreviam a entrada do mapa,
 *     e o pré-requisito ia parar na subfase errada, sem erro nenhum;
 *   - um nome que não existisse virava `undefined` no mapa, e o INSERT morria
 *     com "null value in column subfase_anterior_id", que não diz qual nome
 *     estava errado.
 *
 * Aqui os dois viram 400 antes de a transação abrir, e a mensagem cita o nome.
 */
const conferirReferenciasPorNome = (linha, helpers) => {
  const declaradas = new Set()

  for (const fase of linha.fases || []) {
    for (const subfase of fase.subfases || []) {
      if (declaradas.has(subfase.nome)) {
        return helpers.error('fluxo.subfaseRepetida', { nome: subfase.nome })
      }
      declaradas.add(subfase.nome)
    }
  }

  // O GRAFO DOS PRE-REQUISITOS, montado enquanto se confere nome a nome. Ele é
  // COMPLETO para esta linha de produção: `producao.pre_requisito_subfase` não
  // tem outra porta de escrita, e este corpo só referencia subfases declaradas
  // aqui (o laço acima cobra isso).
  const pares = new Set()
  const posterioresDe = new Map()
  const grauDeEntrada = new Map()
  for (const nome of declaradas) {
    posterioresDe.set(nome, [])
    grauDeEntrada.set(nome, 0)
  }

  for (const fase of linha.fases || []) {
    for (const pre of fase.pre_requisito_subfase || []) {
      for (const alvo of [pre.subfase_anterior, pre.subfase_posterior]) {
        if (!declaradas.has(alvo)) {
          return helpers.error('fluxo.subfaseDesconhecida', { nome: alvo })
        }
      }
      if (pre.subfase_anterior === pre.subfase_posterior) {
        return helpers.error('fluxo.preRequisitoDeSiMesma', {
          nome: pre.subfase_anterior
        })
      }

      // O MESMO PAR DUAS VEZES morreria na UNIQUE (subfase_anterior_id,
      // subfase_posterior_id) NO MEIO da transação, e o 23505 de lá cairia na
      // tradução da linha de produção -- a recusa diria "já existe uma linha de
      // produção com este nome", que fala de outra coisa. Os pré-requisitos são
      // declarados POR FASE, e nada impede duas fases citarem o mesmo par.
      // O separador continua sendo o NUL, mas ESCAPADO: escrito como byte, ele
      // torna o arquivo binario para o git e para toda varredura de texto.
      const chave = `${pre.subfase_anterior}\u0000${pre.subfase_posterior}`
      if (pares.has(chave)) {
        return helpers.error('fluxo.preRequisitoRepetido', {
          anterior: pre.subfase_anterior,
          posterior: pre.subfase_posterior
        })
      }
      pares.add(chave)

      // SO O TIPO 1 ENTRA NO GRAFO. O tipo 2 ('Regiao nao estar em execucao')
      // bloqueia apenas enquanto a outra esta EM EXECUCAO (situacao 2, ver
      // `distribuicao/sql/calcula_fila.sql`), e um ciclo dele e exclusao mutua,
      // nao impasse: com as duas Nao iniciadas, uma comeca e a outra espera a
      // vez. O banco aceita as duas direcoes, e o Joi nao pode recusar o que o
      // banco aceita.
      if (pre.tipo_pre_requisito_id === TIPO_PRE_REQUISITO.REGIAO_CONCLUIDA) {
        posterioresDe.get(pre.subfase_anterior).push(pre.subfase_posterior)
        grauDeEntrada.set(
          pre.subfase_posterior,
          grauDeEntrada.get(pre.subfase_posterior) + 1
        )
      }
    }
  }

  // CICLO É RECUSADO, e o `A não é pré-requisito de A` acima só pegava o laço de
  // um passo. O par (A antes de B, B antes de A) entra sem erro nenhum e o
  // estrago aparece longe: o gatilho
  // `a_relacionamento_pre_requisito_subfase` materializa os dois sentidos em
  // `producao.relacionamento_ut`, e o `filtro2` de
  // `distribuicao/sql/calcula_fila.sql` exclui a atividade cuja unidade
  // dependente ainda não está pronta. Com o ciclo, cada uma das duas espera a
  // outra para sempre: a fila simplesmente nunca entrega aquelas unidades, sem
  // erro, sem log e sem nada na tela.
  //
  // KAHN, e não uma busca em profundidade: o que sobra depois de remover todos
  // os nós sem dependência pendente é o ciclo MAIS o que depende dele (com
  // A->B, B->A e B->C, sobra C também), e é isso que a mensagem cita: quem
  // for depurar procura o ciclo entre os nomes citados, e não em todos eles.
  const fila = [...declaradas].filter(nome => grauDeEntrada.get(nome) === 0)
  let ordenadas = 0
  while (fila.length > 0) {
    const atual = fila.shift()
    ordenadas += 1
    for (const posterior of posterioresDe.get(atual)) {
      grauDeEntrada.set(posterior, grauDeEntrada.get(posterior) - 1)
      if (grauDeEntrada.get(posterior) === 0) fila.push(posterior)
    }
  }
  if (ordenadas < declaradas.size) {
    const noCiclo = [...declaradas].filter(nome => grauDeEntrada.get(nome) > 0)
    return helpers.error('fluxo.preRequisitoCiclico', {
      nomes: noCiclo.join(', ')
    })
  }

  for (const prop of linha.propriedades_camadas || []) {
    if (!declaradas.has(prop.subfase)) {
      return helpers.error('fluxo.subfaseDesconhecida', { nome: prop.subfase })
    }
  }

  return linha
}

// A LINHA DE PRODUÇÃO INTEIRA num corpo só: a linha, as fases, as subfases, os
// pré-requisitos entre elas e as propriedades de camada. É assim no SAP, e é o
// que faz sentido: uma linha de produção sem fase não produz nada, e criar as
// quatro coisas em quatro requisições deixaria o cadastro pela metade quando a
// segunda falhasse.
models.linhaProducao = Joi.object().keys({
  linha_producao: Joi.object()
    .keys({
      nome: nome().required(),
      nome_abrev: nome().required(),
      descricao: Joi.string().allow(null, ''),
      subtipo_produto_id: Joi.number().integer().positive().required(),
      fases: Joi.array()
        .items(faseNova)
        // UNIQUE (linha_producao_id, ordem) no DDL.
        .unique('ordem')
        .required()
        .min(1),
      propriedades_camadas: Joi.array()
        .items(propriedadesCamadaNova)
        // UNIQUE (camada_id, subfase_id) no DDL. Aqui a camada ainda é o par
        // (schema, nome), então a comparação é nos três.
        .unique(
          (a, b) =>
            a.schema === b.schema && a.camada === b.camada && a.subfase === b.subfase
        )
    })
    .custom(conferirReferenciasPorNome)
    .messages({
      'fluxo.subfaseRepetida':
        'A subfase "{{#nome}}" está declarada duas vezes: o pré-requisito e a propriedade de camada referenciam a subfase pelo NOME, e com nome repetido não há como saber de qual delas se fala',
      'fluxo.subfaseDesconhecida':
        'A subfase "{{#nome}}" é referenciada mas não está declarada em nenhuma fase desta linha de produção',
      'fluxo.preRequisitoDeSiMesma':
        'A subfase "{{#nome}}" não pode ser pré-requisito de si mesma',
      'fluxo.preRequisitoRepetido':
        'O pré-requisito de "{{#anterior}}" para "{{#posterior}}" está declarado duas vezes: cada par de subfases tem uma linha só em producao.pre_requisito_subfase',
      'fluxo.preRequisitoCiclico':
        'Os pré-requisitos entre estas subfases formam um ciclo: {{#nomes}}. Uma subfase que espera outra que espera a primeira nunca é distribuída, e a fila fica parada sem acusar erro'
    })
    .required()
})

// A ATUALIZAÇÃO SÓ MEXE EM `disponivel`, e é o que o SAP também faz. Linha
// indisponível não aparece para quem cadastra lote novo e continua valendo para
// os lotes que já a usam: é aposentadoria, e não exclusão. Renomear uma linha ou
// trocar o subtipo dela mudaria o significado das fases e etapas já gravadas.
models.linhaProducaoAtualizacao = Joi.object().keys({
  linhas_producao: Joi.array()
    .items(
      Joi.object().keys({
        id: idSerial().required(),
        disponivel: Joi.boolean().required()
      })
    )
    .unique('id')
    .required()
    .min(1)
})

// --- Etapas padrão -----------------------------------------------------------

// O `padrao_cq` do SAP, com o nome do domínio que ele lê. `.valid()` sai da
// tabela de padrões acima: a lista de códigos ACEITOS e a de códigos
// IMPLEMENTADOS são a mesma, e não duas que envelhecem em separado.
models.etapasPadrao = Joi.object().keys({
  tipo_controle_qualidade_id: Joi.number()
    .integer()
    .valid(...CODIGOS_CONTROLE_QUALIDADE)
    .required()
    .messages({
      'any.only':
        'Tipo de controle de qualidade inválido: são {{#valids}} (1 sem controle, 2 uma Revisão/Correção, 3 uma Revisão e uma Correção)'
    }),
  // A FASE, e não a subfase: o padrão se aplica a TODAS as subfases da fase de
  // uma vez, que é o que o `criaEtapasPadrao` do SAP faz. Uma subfase por
  // requisição transformaria o cadastro de uma fase de sete subfases em sete
  // chamadas, cada uma podendo falhar no meio.
  fase_id: idSerial().required(),
  lote_id: idLote().required()
})

// --- Camadas -----------------------------------------------------------------

// SEM `.required()` NO ITEM, ao contrário do SAP. Lá o item era
// `Joi.number().integer().strict().required()`, e o `.required()` dentro de um
// `items` não quer dizer "o item é obrigatório": quer dizer "o array TEM de
// conter pelo menos um item que case com este". A consequência é que a lista
// vazia recusava por `array.includesRequiredUnknowns` -- uma mensagem sobre
// itens desconhecidos -- em vez de pelo `.min(1)` que está escrito logo ao lado
// e é a regra que se quis dizer. Sem ele, quem manda `[]` lê que a lista precisa
// de pelo menos um item.
models.camadasIds = Joi.object().keys({
  camadas_ids: Joi.array().items(idSerial()).unique().required().min(1)
})

models.camadas = Joi.object().keys({
  camadas: Joi.array()
    .items(
      Joi.object().keys({
        schema: nome().required(),
        nome: nome().required()
      })
    )
    // UNIQUE (schema, nome) no DDL: o par repetido no MESMO corpo morreria com
    // 23505 no meio da inserção em massa.
    .unique((a, b) => a.schema === b.schema && a.nome === b.nome)
    .required()
    .min(1)
})

models.camadasAtualizacao = Joi.object().keys({
  camadas: Joi.array()
    .items(
      Joi.object().keys({
        id: idSerial().required(),
        schema: nome().required(),
        nome: nome().required()
      })
    )
    .unique('id')
    .unique((a, b) => a.schema === b.schema && a.nome === b.nome)
    .required()
    .min(1)
})

module.exports = models

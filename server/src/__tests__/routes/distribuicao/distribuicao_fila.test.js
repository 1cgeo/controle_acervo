'use strict'

// AS QUATRO CONSULTAS DE FILA, lidas de arquivo e formatadas de verdade.
//
// POR QUE UM TESTE SEM BANCO PARA SQL. As quatro decidem qual atividade cada
// pessoa recebe, e sao a regra de negocio mais densa do sistema. Elas nao cabem
// numa template string por isso, e a consequencia de morarem em arquivo e que
// um erro de digitacao no NOME de um arquivo, um `$<param>` que ninguem passa ou
// um SQL que o `pg-minify` nao consegue ler so apareceriam na primeira
// requisicao de producao -- o `require` do modulo passa limpo, porque o
// `QueryFile` so le o disco quando alguem o usa.
//
// O QUE ELE PROVA, e nao e pouco:
//
//   1 os cinco arquivos existem e o minificador os le sem erro
//   2 a formatacao nao deixa NENHUM `$<...>` para tras, que e como um parametro
//     esquecido chega ao PostgreSQL
//   3 a chave de gente e o UUID, e nao o `usuario_id` inteiro do SAP
//   4 as tabelas de distribuicao tem o nome do SCA (`habilitacao*`), e nao o do
//     SAP (`perfil_producao*`)
//   5 a coluna de situacao e `tipo_situacao_atividade_id`
//   6 o `tipo_restricao_id = 3` do SAP nao voltou
//
// O que ele NAO prova e o resultado das consultas: isso e trabalho do pacote de
// banco, com dado semeado.

jest.mock('../../../database', () => ({ db: { pgp: require('pg-promise')() } }))

const pgp = require('pg-promise')()
const consultas = require('../../../distribuicao/consultas_fila')

const AS_QUATRO = [
  'calculaFilaPrioritaria',
  'calculaFilaPrioritariaGrupo',
  'calculaFilaPausada',
  'calculaFila'
]

const formatar = (consulta, parametros) => pgp.as.format(consulta, parametros)

describe('As consultas de fila carregam de arquivo e se formatam', () => {
  it.each(AS_QUATRO)('%s le do disco sem erro de minificacao', nome => {
    expect(consultas[nome].error).toBeUndefined()
    expect(formatar(consultas[nome], { usuarioUuid: 'uuid-qualquer' }).length)
      .toBeGreaterThan(500)
  })

  it('retornaDadosProducao le do disco sem erro de minificacao', () => {
    expect(consultas.retornaDadosProducao.error).toBeUndefined()
    expect(formatar(consultas.retornaDadosProducao, { atividadeId: 1 }).length)
      .toBeGreaterThan(500)
  })

  // `$<algumaCoisa>` que sobra e parametro que ninguem passou: o PostgreSQL
  // recebe o texto cru e responde erro de sintaxe, na primeira requisicao real.
  it.each(AS_QUATRO)('%s nao deixa parametro por preencher', nome => {
    expect(formatar(consultas[nome], { usuarioUuid: 'uuid-qualquer' }))
      .not.toMatch(/\$<[^>]+>/)
  })

  it('retornaDadosProducao nao deixa parametro por preencher', () => {
    expect(formatar(consultas.retornaDadosProducao, { atividadeId: 7 }))
      .not.toMatch(/\$<[^>]+>/)
  })
})

describe('A travessia do SAP 2.3.5 chegou inteira ao schema do SCA', () => {
  const todas = () => [
    ...AS_QUATRO.map(n => formatar(consultas[n], { usuarioUuid: 'uuid' })),
    formatar(consultas.retornaDadosProducao, { atividadeId: 1 })
  ]

  // `macrocontrole` e o schema do SAP. Nenhuma linha dele existe neste banco.
  it('nenhuma consulta cita o schema macrocontrole', () => {
    for (const sql of todas()) expect(sql).not.toMatch(/macrocontrole\./)
  })

  // O SAP chamava as tabelas de distribuicao de `perfil_producao*`. No SCA
  // "perfil" ja quer dizer AUTORIZACAO (dominio.tipo_perfil, lido pelo
  // verifyPerfil), e por isso elas viraram `habilitacao*`. As duas palavras no
  // mesmo banco fariam toda leitura de codigo ter de adivinhar qual das duas.
  it('nenhuma consulta cita as tabelas perfil_producao do SAP', () => {
    for (const sql of todas()) {
      expect(sql).not.toMatch(/perfil_producao/)
      expect(sql).not.toMatch(/perfil_bloco_operador/)
      expect(sql).not.toMatch(/perfil_dificuldade_operador/)
    }
  })

  it('a fila normal cobra habilitacao de etapa, de usuario e de bloco', () => {
    const sql = formatar(consultas.calculaFila, { usuarioUuid: 'uuid' })
    expect(sql).toMatch(/producao\.habilitacao_etapa/)
    expect(sql).toMatch(/producao\.habilitacao_usuario/)
    expect(sql).toMatch(/producao\.habilitacao_bloco/)
    expect(sql).toMatch(/producao\.habilitacao_dificuldade/)
  })

  // `dominio.tipo_situacao` do SAP virou `dominio.tipo_situacao_atividade`
  // porque aqui o `dominio` serve sete modulos e "situacao" sozinho nao diz
  // situacao DE QUE.
  it.each(AS_QUATRO)('%s usa tipo_situacao_atividade_id', nome => {
    const sql = formatar(consultas[nome], { usuarioUuid: 'uuid' })
    expect(sql).toMatch(/tipo_situacao_atividade_id/)
    expect(sql).not.toMatch(/[^_]tipo_situacao_id/)
  })

  // Gente e UUID no SCA inteiro. Um `usuario_id` sobrevivente compararia o UUID
  // do token com um inteiro e o PostgreSQL recusaria a comparacao -- ou, pior,
  // casaria com a coluna errada de outra tabela.
  it.each(AS_QUATRO)('%s identifica a pessoa por usuario_uuid', nome => {
    const sql = formatar(consultas[nome], { usuarioUuid: 'uuid' })
    expect(sql).toMatch(/usuario_uuid/)
    expect(sql).not.toMatch(/usuario_id/)
  })

  // O code 3 de `dominio.tipo_restricao` ('Operadores no mesmo turno') saiu com
  // `dgeo.usuario.tipo_turno_id`, que nao atravessou: das 98 linhas de
  // `restricao_etapa` medidas no dump de 2026-08-09, ZERO eram do tipo 3.
  // Ressuscita-lo aqui compararia com um code que a chave estrangeira recusa.
  it('a fila normal nao tem o tipo_restricao 3 nem o turno do SAP', () => {
    const sql = formatar(consultas.calculaFila, { usuarioUuid: 'uuid' })
    expect(sql).not.toMatch(/tipo_turno/)
    expect(sql).not.toMatch(/tipo_restricao_id = 3/)
    // Os dois que ficaram continuam la.
    expect(sql).toMatch(/tipo_restricao_id = 1/)
    expect(sql).toMatch(/tipo_restricao_id = 2/)
  })

  // O `HAVING` e o que impede a fila de entregar uma etapa cuja anterior ainda
  // esta viva. Sem ele as quatro consultas continuam rodando e devolvendo
  // atividade -- a errada.
  it.each(AS_QUATRO)('%s mantem o HAVING da etapa anterior', nome => {
    expect(formatar(consultas[nome], { usuarioUuid: 'uuid' }))
      .toMatch(/HAVING MIN\(situacao_ant\) IS NULL OR every\(situacao_ant IN \(4\)\)/)
  })

  // O lote e o do ACERVO, e nao um lote de producao: `producao.lote` nao existe,
  // e `producao.lote_linha` foi removida antes de chegar a banco nenhum.
  it('o cabecalho do pacote le o lote e o projeto do acervo', () => {
    const sql = formatar(consultas.retornaDadosProducao, { atividadeId: 1 })
    expect(sql).toMatch(/acervo\.lote/)
    expect(sql).toMatch(/acervo\.projeto/)
    expect(sql).not.toMatch(/producao\.lote/)
    // A escala do lote nao tem sucessor: ela e da FOLHA (acervo.produto).
    expect(sql).not.toMatch(/denominador_escala/)
  })

  // O `tipo_produto` do SAP e o SUBTIPO daqui, e ele sai da LINHA DE PRODUCAO --
  // nao do produto do lote, porque um lote do acervo atravessa linhas.
  it('o subtipo de produto sai da linha de producao', () => {
    const sql = formatar(consultas.retornaDadosProducao, { atividadeId: 1 })
    expect(sql).toMatch(/producao\.linha_producao/)
    expect(sql).toMatch(/dominio\.subtipo_produto/)
  })
})

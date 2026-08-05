'use strict'

// `GET /api/produtos/folha` e a UNICA rota da feature que nao toca o banco: a
// folha existe no Sistema Cartografico Nacional esteja ou nao catalogada aqui, e
// quem vai cadastrar um produto precisa da geometria ANTES de o produto existir.
// Por isso o teste exercita o controlador DIRETO, sem montar o app de teste, e
// fica no pacote rapido.
//
// CUIDADO AO EDITAR ESTE CABECALHO: a regra do `jest.config.js` decide o pacote
// LENDO O FONTE, com a expressao /helpers\/(db|app)/. Ela nao distingue codigo
// de comentario, entao citar o caminho do ajudante de app aqui, ainda que so em
// prosa, joga este arquivo para o pacote de banco, onde ele espera um PostgreSQL
// que nao usa. Aconteceu na primeira versao deste arquivo.
//
// O que ele guarda nao e a aritmetica (isso e `unit/utils/scn.test.js`), e sim a
// POLITICA: sao tres jeitos de "nao deu" e so um deles e erro do cliente.

const produtoCtrl = require('../../produto/produto_ctrl')

// SÃO DOIS AJUDANTES, e não um que devolve `{ dados, erro }`.
//
// Aquele engolia a exceção nos dois caminhos: o caso que compara duas respostas
// passava com as duas `undefined`, ou seja, exatamente quando o controlador
// quebrava dos dois lados. Aqui o caminho bom deixa a exceção subir, e só quem
// ESPERA recusa a captura.
const folha = (query) => produtoCtrl.getFolha(query)

const recusaDe = async (query) => {
  try {
    await produtoCtrl.getFolha(query)
  } catch (erro) {
    return erro
  }
  throw new Error(
    `getFolha aceitou ${JSON.stringify(query)}, e o caso exige recusa`
  )
}

describe('getFolha', () => {
  it('resolve a folha pelo INOM, com geometria, MI e escala', async () => {
    const dados = await folha({ inom: 'SF-22-Y-D-II-4-NE' })

    expect(dados).toEqual({
      inom: 'SF-22-Y-D-II-4-NE',
      mi: '2757-4-NE',
      sem_mi: false,
      motivo_sem_mi: null,
      tipo_escala_id: 1,
      geom: 'SRID=4674;POLYGON((-51.625 -23.375, -51.5 -23.375, -51.5 -23.25, -51.625 -23.25, -51.625 -23.375))',
      bbox: { xmin: -51.625, ymin: -23.375, xmax: -51.5, ymax: -23.25 }
    })
  })

  it('resolve a mesma folha pelo MI, e devolve o INOM canonico', async () => {
    const porMi = await folha({ mi: '2757-4-NE' })
    const porInom = await folha({ inom: 'SF-22-Y-D-II-4-NE' })

    // O INOM canônico ANTES da comparação: sem ele, duas respostas vazias
    // satisfariam o `toEqual` e o caso passaria justamente quando não resolve.
    expect(porMi.inom).toBe('SF-22-Y-D-II-4-NE')
    expect(porMi).toEqual(porInom)
  })

  it('normaliza o INOM sujo em vez de recusar', async () => {
    const dados = await folha({ inom: 'sf 22 y d ii 4 ne' })
    expect(dados.inom).toBe('SF-22-Y-D-II-4-NE')
  })

  // 200, e nao 404: "esta folha nao tem MI" e resposta. Tratar como falha seria
  // afirmar que toda folha do SCN tem MI, que e falso.
  it('folha sem MI responde com sucesso, dizendo por que nao tem', async () => {
    const dados = await folha({ inom: 'SF-32-Y-D' })

    expect(dados.mi).toBeNull()
    expect(dados.sem_mi).toBe(true)
    expect(dados.motivo_sem_mi).toMatch(/território nacional/)
    expect(dados.geom).toContain('SRID=4674;POLYGON')
  })

  // O campo sai SEMPRE, e nao so no caso negativo: um campo que aparece so
  // quando e verdadeiro obriga quem consome a distinguir "nao tem MI" de
  // "esqueci de olhar", e as duas coisas se leem como `undefined`.
  it('sem_mi sai na resposta tambem quando a folha TEM MI', async () => {
    const dados = await folha({ inom: 'SF-22-Y-D-II' })
    expect(dados.sem_mi).toBe(false)
    expect(dados.motivo_sem_mi).toBeNull()
  })

  it('folha de 1:500.000 vem sem tipo_escala_id, porque o SCA nao tem esse dominio', async () => {
    const dados = await folha({ inom: 'SF-22-Y' })
    expect(dados.tipo_escala_id).toBeNull()
    expect(dados.geom).toContain('SRID=4674;POLYGON')
  })

  it('INOM fora da gramatica e 400, e a mensagem ensina o formato', async () => {
    const erro = await recusaDe({ inom: 'SF-22-Y-D-II-9' })

    expect(erro.statusCode).toBe(400)
    expect(erro.message).toContain('SF-22-Y-D-II-4-NE')
  })

  it('MI que o Mapa Indice nao tem e 404, e a mensagem manda usar o INOM', async () => {
    const erro = await recusaDe({ mi: '9999' })

    expect(erro.statusCode).toBe(404)
    expect(erro.message).toContain('inom')
  })

  // O MI da folha de fronteira sem numero emitido tambem cai no 404, e nao num
  // INOM inventado: o caminho de volta obedece a mesma exclusao da ida.
  it('MI de folha excluida do Mapa Indice e 404', async () => {
    // A folha de 100k tem MI 64, e por composicao '64-1' pareceria um MI
    // legitimo. O quadrante NA-19-X-C-VI-1 consta da lista de exclusao, entao
    // esse MI nao existe e a rota nao pode devolver folha para ele.
    expect((await folha({ inom: 'NA-19-X-C-VI' })).mi).toBe('64')
    expect((await folha({ inom: 'NA-19-X-C-VI-1' })).sem_mi).toBe(true)

    const erro = await recusaDe({ mi: '64-1' })
    expect(erro.statusCode).toBe(404)
  })

  it('a dica de escala alcanca a folha de 250k que o MI nu esconde', async () => {
    const semDica = await folha({ mi: '1' })
    const comDica = await folha({ mi: '1', tipo_escala_id: 4 })

    expect(semDica.tipo_escala_id).toBe(3)
    expect(semDica.inom).toBe('NB-20-Z-B-V')
    expect(comDica.tipo_escala_id).toBe(4)
    expect(comDica.inom).toBe('NB-20-Z-B')
  })
})

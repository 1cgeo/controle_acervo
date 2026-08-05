'use strict'

// Auditoria dos invariantes lógicos do acervo.
//
// Estes testes rodam TODAS as consultas contra o PostGIS de teste (a contagem
// sai do próprio INVARIANTES, e não de um número escrito aqui). É o ponto: os
// invariantes vieram de um script do vault, onde nunca foram exercitados por
// teste nenhum, e onde uma coluna renomeada os quebraria em silêncio na próxima
// execução. Aqui, um `git mv` no schema derruba a suíte.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')
const { createProduto, createVersao, createArquivo, createVolume } = require('../helpers/fixtures')
const { INVARIANTES } = require('../../acervo/invariantes')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const auditar = (qs = '') =>
  request(app)
    .get('/api/acervo/auditoria' + qs)
    .set('Authorization', generateAdminToken())

// O perfil do `test_user` no acervo, trocado por um teste e devolvido por ele.
//
// A semente o cria como CONSULTA (setup.js), e o `cleanTestData` o devolve a
// consulta -- mas o afterEach roda DEPOIS, e um teste que deixasse o perfil
// alterado no meio do arquivo mudaria o que os seguintes podem. Devolver aqui
// mesmo torna o caso legível sem depender da ordem da limpeza.
const comPerfilNoAcervo = async (perfilId, fn) => {
  const { db } = require('../../database')
  const trocar = (p) => db.conn.none(
    `UPDATE dgeo.usuario_perfil SET perfil_id = $<p>
      WHERE modulo_id = 1
        AND usuario_id = (SELECT id FROM dgeo.usuario WHERE uuid = $<uuid>)`,
    { p, uuid: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22' }
  )
  await trocar(perfilId)
  try {
    return await fn()
  } finally {
    await trocar(1)
  }
}

describe('GET /api/acervo/auditoria', () => {
  it('should reject an anonymous request and a consulta profile', async () => {
    const semToken = await request(app).get('/api/acervo/auditoria')
    expect(semToken.status).toBe(401)

    // O `test_user` da semente é CONSULTA no acervo.
    const comum = await request(app)
      .get('/api/acervo/auditoria')
      .set('Authorization', generateUserToken())
    expect(comum.status).toBe(403)
  })

  // A GUARDA DA ROTA É `verifyPerfil('gerente')`, E NÃO `verifyAdmin`.
  //
  // Todo o resto deste arquivo entra com token de administrador, que passa em
  // qualquer módulo pela flag global. Com isso, trocar a rota para `verifyAdmin`
  // amanhã não quebraria teste nenhum, e o gerente perderia a tela em silêncio.
  // É a mesma classe de defeito do 403 da mapoteca: o usuário da semente tinha
  // perfil demais, e por isso o caso real nunca aparecia.
  //
  // Os dois lados, porque um só não separa gerente de administrador: operador é
  // recusado, gerente entra.
  it('should refuse an operador and accept a gerente who is NOT an administrator', async () => {
    const chamar = () => request(app)
      .get('/api/acervo/auditoria?codigos=2c&amostra=0')
      .set('Authorization', generateUserToken())

    const operador = await comPerfilNoAcervo(2, chamar)
    expect(operador.status).toBe(403)

    const gerente = await comPerfilNoAcervo(3, chamar)
    expect(gerente.status).toBe(200)
    expect(gerente.body.dados[0].codigo).toBe('2c')
  })

  // O teste que justifica ter trazido os invariantes para cá: cada um roda
  // contra o banco de verdade. SQL que não casa mais com o schema falha AQUI,
  // e não em produção seis meses depois.
  it('should run every invariant against the real database', async () => {
    const res = await auditar()

    expect(res.status).toBe(200)
    expect(res.body.dados).toHaveLength(INVARIANTES.length)

    const quebrados = res.body.dados.filter(d => d.erro)
    expect(quebrados.map(d => `${d.codigo}: ${d.erro}`)).toEqual([])
  })

  it('should return codigo, severidade, titulo and total for each', async () => {
    const res = await auditar()

    for (const d of res.body.dados) {
      expect(typeof d.codigo).toBe('string')
      expect(['DEFECT', 'REVISAR', 'INFO']).toContain(d.severidade)
      expect(typeof d.titulo).toBe('string')
      expect(typeof d.total).toBe('number')
    }
  })

  it('should filter by severidade', async () => {
    const res = await auditar('?severidade=DEFECT')

    expect(res.status).toBe(200)
    // A VARIANCIA vem primeiro: `[].every(...)` e verdadeiro, e `0 < N` tambem,
    // entao um filtro que devolvesse NADA (o modo de falhar mais provavel)
    // passaria nas duas linhas seguintes.
    expect(res.body.dados.length).toBeGreaterThan(0)
    expect(res.body.dados.every(d => d.severidade === 'DEFECT')).toBe(true)
    expect(res.body.dados.length).toBeLessThan(INVARIANTES.length)
  })

  it('should filter by codigos', async () => {
    const res = await auditar('?codigos=2c,4a')

    expect(res.status).toBe(200)
    expect(res.body.dados.map(d => d.codigo).sort()).toEqual(['2c', '4a'])
  })

  // Código inventado que devolvesse 200 com lista vazia se leria como "nada a
  // auditar", que é o oposto de "você pediu um invariante que não existe".
  it('should reject an unknown codigo instead of returning nothing', async () => {
    const res = await auditar('?codigos=9z')
    expect(res.status).toBe(400)
  })

  it('should reject an unknown severidade', async () => {
    const res = await auditar('?severidade=GRAVE')
    expect(res.status).toBe(400)
  })

  // 2c = produto SEM nenhuma versão (órfão). É o invariante mais fácil de
  // provocar, e prova que a auditoria enxerga dado de verdade.
  it('should actually catch a defect (2c: produto sem versao)', async () => {
    const limpo = await auditar('?codigos=2c')
    const antes = limpo.body.dados[0].total

    const orfao = await createProduto({ mi: '9999-1', inom: 'ORFAO-TESTE' })

    const depois = await auditar('?codigos=2c')
    expect(depois.body.dados[0].total).toBe(antes + 1)
    expect(depois.body.dados[0].amostra.map(r => Number(r.id))).toContain(Number(orfao.id))
  })

  // 3c (data_edicao < data_criacao) NAO consegue ser provocado: acervo.versao
  // tem CHECK (data_edicao >= data_criacao). Descobrimos isso ao trazer os
  // invariantes do vault, tentando violar um deles pela primeira vez. O
  // invariante fica como rede caso a constraint caia numa migração, e este
  // teste documenta por que ele vive em zero.
  it('cannot be violated: the database itself refuses an inverted date pair (3c)', async () => {
    const p = await createProduto({ mi: '9999-2' })

    await expect(
      createVersao(p.id, {
        data_criacao: '2026-06-15T12:00:00-03:00',
        data_edicao: '2026-05-01T12:00:00-03:00'
      })
    ).rejects.toThrow(/versao_check/)

    const res = await auditar('?codigos=3c')
    expect(res.body.dados[0].total).toBe(0)
  })

  it('should cap the amostra and say when it truncated', async () => {
    for (let i = 0; i < 4; i++) await createProduto({ mi: `8888-${i}`, inom: `TRUNC-${i}` })

    const res = await auditar('?codigos=2c&amostra=2')
    const d = res.body.dados[0]

    expect(d.total).toBeGreaterThanOrEqual(4)
    expect(d.amostra).toHaveLength(2)
    expect(d.truncada).toBe(true)
  })

  it('should allow amostra=0 for the count alone', async () => {
    await createProduto({ mi: '7777-1', inom: 'SO-CONTAGEM' })

    const res = await auditar('?codigos=2c&amostra=0')
    expect(res.body.dados[0].total).toBeGreaterThan(0)
    expect(res.body.dados[0].amostra).toEqual([])
  })

  // 7a com layout_origem. O par de testes prova a exceção nos DOIS sentidos: o
  // mesmo arquivo, com o mesmo nome fora do padrão, conta num volume comum e não
  // conta num volume que guarda o layout do fornecedor. Um teste só do lado que
  // isenta passaria com o filtro escrito ao contrário.
  it('should count an off-pattern name on an ordinary volume (7a)', async () => {
    const antes = (await auditar('?codigos=7a')).body.dados[0].total

    const comum = await createVolume({
      nome: 'Volume Comum 7a',
      volume: '/data/comum-7a',
      layout_origem: false
    })
    const p = await createProduto({ mi: '5555-1', inom: 'PADRAO-COMUM' })
    const v = await createVersao(p.id)
    await createArquivo(v.id, {
      volume_armazenamento_id: comum.id,
      nome_arquivo: 'LOTE_1/IMAGENS/Ortoimagem_MI 5555-1',
      extensao: 'img'
    })

    expect((await auditar('?codigos=7a')).body.dados[0].total).toBe(antes + 1)
  })

  // O caso do Convênio RS: o .img do ERDAS guarda dentro de si o nome do .ige,
  // então renomear quebra o produto. O volume declara que guarda o layout de
  // origem e o invariante para de acusar. Ver
  // migrations/2026-07-31_volume_layout_origem.sql.
  it('should exempt a volume that keeps the supplier layout (7a)', async () => {
    const antes = (await auditar('?codigos=7a')).body.dados[0].total

    const origem = await createVolume({
      nome: 'Entregas Convenio',
      volume: '/data/entregas-convenio',
      layout_origem: true
    })
    const p = await createProduto({ mi: '5555-2', inom: 'LAYOUT-ORIGEM' })
    const v = await createVersao(p.id)
    await createArquivo(v.id, {
      volume_armazenamento_id: origem.id,
      nome_arquivo: 'LOTE_1/IMAGENS/Ortoimagem_MI 5555-2',
      extensao: 'img'
    })

    expect((await auditar('?codigos=7a')).body.dados[0].total).toBe(antes)
  })

  // A auditoria é leitura. Se algum invariante tentasse escrever, a transação
  // READ ONLY o derrubaria, e o teste acima ("nenhum quebrado") acusaria.
  it('should not change the data it audits', async () => {
    const p = await createProduto({ mi: '6666-1' })
    const v = await createVersao(p.id)
    await createArquivo(v.id)

    const antes = await request(app)
      .get(`/api/acervo/produto/${p.id}`)
      .set('Authorization', generateAdminToken())

    await auditar()

    const depois = await request(app)
      .get(`/api/acervo/produto/${p.id}`)
      .set('Authorization', generateAdminToken())

    expect(depois.body.dados).toEqual(antes.body.dados)
  })

  // ---- P4 x tileserver -----------------------------------------------------
  //
  // O par que prova o filtro `tipo_arquivo_id <> 9` de 4a, 4f e 4g nos dois
  // sentidos. Sem ele os três acusavam DEFECT em todo tileserver do acervo, e
  // era DEFECT impossível de zerar: `er/acervo.sql` EXIGE por CHECK que o
  // tileserver tenha checksum, tamanho_mb e volume nulos.
  describe('tileserver nao e defeito de arquivo (4a, 4f, 4g)', () => {
    const tileserver = async versaoId =>
      createArquivo(versaoId, {
        tipo_arquivo_id: 9,
        nome_arquivo: 'https://tiles.exemplo.mil.br/carta/2757-1-NE',
        extensao: null,
        tamanho_mb: null,
        checksum: null,
        volume_armazenamento_id: null
      })

    it('should not count a tileserver row on 4a, 4f or 4g', async () => {
      const antes = (await auditar('?codigos=4a,4f,4g&amostra=0')).body.dados
      const p = await createProduto({ mi: '4444-1', inom: 'TILESERVER-OK' })
      const v = await createVersao(p.id)
      await tileserver(v.id)

      const depois = (await auditar('?codigos=4a,4f,4g&amostra=0')).body.dados
      expect(depois.map(d => d.total)).toEqual(antes.map(d => d.total))
    })

    // O lado positivo de 4a e 4g NÃO é provocável: o CHECK de acervo.arquivo
    // recusa checksum ou volume nulos fora do tileserver. Depois do filtro os
    // dois vivem em zero, como o 3c, e este teste é o que documenta por quê --
    // senão o próximo a ler acharia que a auditoria parou de olhar.
    it('cannot be violated: the database refuses a non-tileserver file without checksum or volume (4a, 4g)', async () => {
      const p = await createProduto({ mi: '4444-2' })
      const v = await createVersao(p.id)

      await expect(createArquivo(v.id, { checksum: null })).rejects.toThrow()
      await expect(createArquivo(v.id, { volume_armazenamento_id: null })).rejects.toThrow()

      const res = await auditar('?codigos=4a,4g&amostra=0')
      expect(res.body.dados.map(d => d.total)).toEqual([0, 0])
    })

    // O 4f, ao contrário, CONTINUA provocável: o CHECK só exige tamanho_mb NOT
    // NULL, e zero passa por ele. É o que separa o filtro novo de ter cegado o
    // invariante.
    it('should still catch a real zero-sized file (4f)', async () => {
      const antes = (await auditar('?codigos=4f&amostra=0')).body.dados[0].total
      const p = await createProduto({ mi: '4444-3' })
      const v = await createVersao(p.id)
      const a = await createArquivo(v.id, { tamanho_mb: 0 })

      const res = await auditar('?codigos=4f')
      expect(res.body.dados[0].total).toBe(antes + 1)
      expect(res.body.dados[0].amostra.map(r => Number(r.id))).toContain(Number(a.id))
    })
  })

  // ---- 3i: a serie de edicao ------------------------------------------------
  describe('serie de edicao incoerente (3i)', () => {
    // Registro Histórico (tipo 2) porque ele aceita 'Nª Edição' sem exigir a
    // versão sequencial anterior: o 3i não olha tipo_versao_id, e provocá-lo por
    // aqui não obriga o teste a satisfazer a máquina de sequência do Regular.
    const edicao = (produtoId, ordinal, dia, extras = {}) =>
      createVersao(produtoId, {
        tipo_versao_id: 2,
        versao: `${ordinal}ª Edição`,
        data_criacao: dia,
        data_edicao: dia,
        ...extras
      })

    it('should catch a 2nd edition dated before the 1st', async () => {
      const antes = (await auditar('?codigos=3i&amostra=0')).body.dados[0].total
      const p = await createProduto({ mi: '3333-1', inom: 'SERIE-INVERTIDA' })
      await edicao(p.id, 1, '2026-01-15T12:00:00-03:00')
      const segunda = await edicao(p.id, 2, '2025-06-01T12:00:00-03:00')

      const res = await auditar('?codigos=3i')
      expect(res.body.dados[0].total).toBe(antes + 1)
      expect(res.body.dados[0].amostra.map(r => Number(r.versao_id))).toContain(Number(segunda.id))
    })

    it('should not flag a correctly ordered series', async () => {
      const antes = (await auditar('?codigos=3i&amostra=0')).body.dados[0].total
      const p = await createProduto({ mi: '3333-2', inom: 'SERIE-OK' })
      await edicao(p.id, 1, '2025-06-01T12:00:00-03:00')
      await edicao(p.id, 2, '2026-01-15T12:00:00-03:00')

      expect((await auditar('?codigos=3i&amostra=0')).body.dados[0].total).toBe(antes)
    })

    // Duas edições no MESMO dia não são incoerência: data de versão é dia de
    // calendário, e a hora só existe porque a coluna é timestamp.
    it('should not flag two editions on the same day', async () => {
      const antes = (await auditar('?codigos=3i&amostra=0')).body.dados[0].total
      const p = await createProduto({ mi: '3333-3', inom: 'SERIE-MESMO-DIA' })
      await edicao(p.id, 1, '2026-01-15T18:00:00-03:00')
      await edicao(p.id, 2, '2026-01-15T09:00:00-03:00')

      expect((await auditar('?codigos=3i&amostra=0')).body.dados[0].total).toBe(antes)
    })

    // O produto civil abrange T34-700 (2) e ET-RDG (12) nas versões: são DUAS
    // séries de edição no mesmo registro. Sem a partição por subtipo, este caso
    // (legítimo) viraria DEFECT.
    it('should not compare editions of different subtipos in the same produto', async () => {
      const antes = (await auditar('?codigos=3i&amostra=0')).body.dados[0].total
      const p = await createProduto({ mi: '3333-4', inom: 'SERIE-SUBTIPO', tipo_produto_id: 2 })
      await edicao(p.id, 1, '2026-01-15T12:00:00-03:00', { subtipo_produto_id: 2 })
      await edicao(p.id, 2, '2025-06-01T12:00:00-03:00', { subtipo_produto_id: 12 })

      expect((await auditar('?codigos=3i&amostra=0')).body.dados[0].total).toBe(antes)
    })

    // O auto-join produz uma linha por PAR (maior, menor). Sem o `distinct on`,
    // uma 1ª Edição com a data errada acusa uma vez para cada edição posterior:
    // UM registro errado vira três ocorrências num invariante cuja regra é dar
    // zero, e "3 ocorrência(s) de DEFECT" na tela passa a significar outra coisa.
    it('should count the VERSION once, not one row per pair', async () => {
      const antes = (await auditar('?codigos=3i&amostra=0')).body.dados[0].total
      const p = await createProduto({ mi: '3333-5', inom: 'SERIE-UM-ERRO' })
      // A 1ª é a errada: datada DEPOIS de todas as seguintes.
      await edicao(p.id, 1, '2026-07-01T12:00:00-03:00')
      const segunda = await edicao(p.id, 2, '2025-01-10T12:00:00-03:00')
      const terceira = await edicao(p.id, 3, '2025-02-10T12:00:00-03:00')
      const quarta = await edicao(p.id, 4, '2025-03-10T12:00:00-03:00')

      const res = await auditar('?codigos=3i')
      // Três versões saem de ordem (2ª, 3ª e 4ª), e cada uma aparece UMA vez --
      // e não 1 + 2 + 3 = 6, que é o que o par produziria.
      expect(res.body.dados[0].total).toBe(antes + 3)

      const ids = res.body.dados[0].amostra.map(r => Number(r.versao_id))
      for (const v of [segunda, terceira, quarta]) {
        expect(ids.filter(id => id === Number(v.id))).toHaveLength(1)
      }
    })

    // A linha que sobra tem de trazer o PIOR infrator, e não uma menor qualquer:
    // é a data mais tardia entre as edições anteriores que explica por que a
    // série saiu de ordem.
    it('should report the worst offender as the smaller edition', async () => {
      const p = await createProduto({ mi: '3333-6', inom: 'SERIE-PIOR' })
      await edicao(p.id, 1, '2020-01-01T12:00:00-03:00')
      await edicao(p.id, 2, '2026-07-01T12:00:00-03:00')
      const terceira = await edicao(p.id, 3, '2025-01-01T12:00:00-03:00')

      const res = await auditar('?codigos=3i')
      const linha = res.body.dados[0].amostra
        .find(r => Number(r.versao_id) === Number(terceira.id))

      // A 1ª também é anterior à 3ª em ordinal, mas quem a atropela é a 2ª.
      expect(linha.versao_menor).toBe('2ª Edição')
    })
  })

  // ---- 3j: a promessa vencida ----------------------------------------------
  describe('versao Planejada vencida (3j)', () => {
    const planejada = (produtoId, dia) =>
      createVersao(produtoId, {
        tipo_versao_id: 3,
        versao: '1-DSG',
        data_criacao: dia,
        data_edicao: dia
      })

    it('should catch a planned version whose date has passed with no file', async () => {
      const antes = (await auditar('?codigos=3j&amostra=0')).body.dados[0].total
      const p = await createProduto({ mi: '2222-1', inom: 'PLANEJADA-VENCIDA' })
      const v = await planejada(p.id, '2025-06-01T12:00:00-03:00')

      const res = await auditar('?codigos=3j')
      expect(res.body.dados[0].total).toBe(antes + 1)
      expect(res.body.dados[0].amostra.map(r => Number(r.versao_id))).toContain(Number(v.id))
    })

    // O caso que decidiu a forma deste invariante: dar arquivo a uma Planejada é
    // o caminho de conclusão de POST /api/arquivo/upload-web/arquivos, que NÃO
    // muda o tipo da versão de propósito. Um invariante escrito como "Planejada
    // com arquivo" acusaria toda folha concluída pela web, e nunca zeraria.
    it('should NOT flag a planned version that already received its file', async () => {
      const antes = (await auditar('?codigos=3j&amostra=0')).body.dados[0].total
      const p = await createProduto({ mi: '2222-2', inom: 'PLANEJADA-CONCLUIDA' })
      const v = await planejada(p.id, '2025-06-01T12:00:00-03:00')
      await createArquivo(v.id, { extensao: 'tif' })

      expect((await auditar('?codigos=3j&amostra=0')).body.dados[0].total).toBe(antes)
    })

    it('should NOT flag a planned version still in the future', async () => {
      const antes = (await auditar('?codigos=3j&amostra=0')).body.dados[0].total
      const p = await createProduto({ mi: '2222-3', inom: 'PLANEJADA-NO-PRAZO' })
      await planejada(p.id, '2027-12-01T12:00:00-03:00')

      expect((await auditar('?codigos=3j&amostra=0')).body.dados[0].total).toBe(antes)
    })
  })

  // ---- 4h: o par raster/PDF -------------------------------------------------
  describe('par raster/PDF da carta (4h)', () => {
    const carta = mi => createProduto({ mi, tipo_produto_id: 3, inom: `PAR-${mi}` })

    it('should catch a chart delivered with the raster but no PDF', async () => {
      const antes = (await auditar('?codigos=4h&amostra=0')).body.dados[0].total
      const p = await carta('1111-1')
      const v = await createVersao(p.id, { subtipo_produto_id: 3 })
      await createArquivo(v.id, { extensao: 'tif', tipo_arquivo_id: 1 })

      const res = await auditar('?codigos=4h')
      expect(res.body.dados[0].total).toBe(antes + 1)
      const achado = res.body.dados[0].amostra.find(r => Number(r.versao_id) === Number(v.id))
      expect(achado.falta).toBe('falta o PDF')
    })

    it('should catch a chart delivered with the PDF but no raster', async () => {
      const antes = (await auditar('?codigos=4h&amostra=0')).body.dados[0].total
      const p = await carta('1111-2')
      const v = await createVersao(p.id, { subtipo_produto_id: 3 })
      await createArquivo(v.id, { extensao: 'pdf', tipo_arquivo_id: 1 })

      const res = await auditar('?codigos=4h')
      expect(res.body.dados[0].total).toBe(antes + 1)
      const achado = res.body.dados[0].amostra.find(r => Number(r.versao_id) === Number(v.id))
      expect(achado.falta).toBe('falta o raster (tif/tiff)')
    })

    it('should not flag a complete pair', async () => {
      const antes = (await auditar('?codigos=4h&amostra=0')).body.dados[0].total
      const p = await carta('1111-3')
      const v = await createVersao(p.id, { subtipo_produto_id: 3 })
      await createArquivo(v.id, { extensao: 'tif', tipo_arquivo_id: 1 })
      await createArquivo(v.id, { extensao: 'pdf', tipo_arquivo_id: 2 })

      expect((await auditar('?codigos=4h&amostra=0')).body.dados[0].total).toBe(antes)
    })

    // Um PDF cadastrado como Documentos(6) não é o PDF da carta, e contá-lo
    // faria a falta desaparecer -- que é o modo de falhar deste invariante.
    it('should not let a PDF filed as Documentos hide the missing chart PDF', async () => {
      const antes = (await auditar('?codigos=4h&amostra=0')).body.dados[0].total
      const p = await carta('1111-4')
      const v = await createVersao(p.id, { subtipo_produto_id: 3 })
      await createArquivo(v.id, { extensao: 'tif', tipo_arquivo_id: 1 })
      await createArquivo(v.id, { extensao: 'pdf', tipo_arquivo_id: 6 })

      expect((await auditar('?codigos=4h&amostra=0')).body.dados[0].total).toBe(antes + 1)
    })
  })

  // ---- 2e: a rede do define_produto ----------------------------------------
  //
  // Vive em zero, como o 3c: o gatilho acervo.validate_version já recusa na
  // escrita. O teste prova a recusa E a contagem, para que o dia em que o
  // gatilho cair numa migração seja o dia em que a auditoria passa a acusar.
  it('cannot be violated: the trigger refuses a define_produto subtipo in a foreign produto (2e)', async () => {
    const p = await createProduto({ mi: '1010-1', tipo_produto_id: 2, subtipo_produto_id: null })

    await expect(createVersao(p.id, { subtipo_produto_id: 24 })).rejects.toThrow(/produto proprio/)

    const res = await auditar('?codigos=2e&amostra=0')
    expect(res.body.dados[0].total).toBe(0)
  })
})

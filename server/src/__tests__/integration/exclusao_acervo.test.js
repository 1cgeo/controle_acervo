'use strict'

// A LACUNA QUE ESTE ARQUIVO FECHA.
//
// Excluir no acervo nao apaga: move para LAPIDE. O arquivo vira uma linha em
// `acervo.arquivo_deletado` com as suas 21 colunas copiadas, e os downloads dele
// viram `acervo.download_deletado` apontando para essa lapide. E o registro de
// que aquele byte existiu, e e o que responde "quem baixou o que, antes de ser
// excluido".
//
// Esse mesmo bloco de ~55 linhas estava copiado em TRES lugares (deleteArquivos,
// deleteVersoes e deleteProdutos), e so o primeiro tinha teste -- por uma rota,
// que provava a contagem e nao as colunas. Os outros dois nunca rodaram em teste
// nenhum.
//
// O QUE ESTE ARQUIVO PRECISA PROVAR, e a razao de ele vir ANTES da limpeza:
//
//   1. TODA coluna e copiada. Sao 21, e o modo de falhar e nao dar erro: a
//      lapide nasce com um campo nulo e ninguem descobre ate precisar dele.
//   2. Cada download vai para a lapide do SEU arquivo. Este e o invariante que
//      uma insercao em LOTE pode inverter em silencio: se o vinculo passar a
//      depender da ORDEM em que o banco devolve os ids, dois arquivos trocam de
//      downloads e as contagens continuam batendo. Por isso cada arquivo aqui
//      tem uma quantidade DIFERENTE de downloads, de usuarios DIFERENTES.
//   3. Os tres caminhos fazem a MESMA coisa. E o que autoriza extrair um helper
//      unico: se divergissem, a extracao seria mudanca de comportamento.

const { db } = require('../../database')
const { conn, cleanTestData, closeConnection } = require('../helpers/db')
const { ADMIN_UUID, USER_UUID } = require('../helpers/auth')
const { createProduto, createVersao, createArquivo } = require('../helpers/fixtures')

const arquivoCtrl = require('../../arquivo/arquivo_ctrl')
const produtoCtrl = require('../../produto/produto_ctrl')

const MOTIVO = 'teste de exclusao'
const EXCLUIDO = 3 // dominio.tipo_status_arquivo: STATUS_ARQUIVO.EXCLUIDO

// Os controllers leem `db.conn` no momento da chamada; quem o cria e o
// createConn. Mesma razao do integration/orcamento.test.js.
beforeAll(async () => {
  await db.createConn()
})

afterEach(async () => {
  await cleanTestData()
})

afterAll(async () => {
  await closeConnection()
})

const baixar = (arquivoId, usuarioUuid) => conn.none(
  `INSERT INTO acervo.download (arquivo_id, usuario_uuid, status, data_download)
   VALUES ($1, $2, 'completed', NOW())`,
  [arquivoId, usuarioUuid]
)

/**
 * Um produto, uma versao, tres arquivos com QUANTIDADES DIFERENTES de download:
 * a[0] tem 1 (admin), a[1] tem 2 (admin e user), a[2] tem 0.
 *
 * As quantidades sao distintas de proposito: e o que faz uma troca de vinculo
 * aparecer. Com um download em cada, trocar dois arquivos passaria despercebido.
 */
const cenario = async () => {
  const produto = await createProduto()
  const versao = await createVersao(produto.id)
  const arquivos = []
  for (let i = 0; i < 3; i++) {
    arquivos.push(await createArquivo(versao.id, {
      nome: `Arquivo ${i}`,
      nome_arquivo: `arquivo_${i}.tif`
    }))
  }
  await baixar(arquivos[0].id, ADMIN_UUID)
  await baixar(arquivos[1].id, ADMIN_UUID)
  await baixar(arquivos[1].id, USER_UUID)
  return { produto, versao, arquivos }
}

/** Downloads da lapide daquele arquivo, achada pelo uuid (que e unico). */
const downloadsDaLapide = async (uuidArquivo) => conn.any(
  `SELECT dd.usuario_uuid
     FROM acervo.download_deletado dd
     JOIN acervo.arquivo_deletado ad ON ad.id = dd.arquivo_deletado_id
    WHERE ad.uuid_arquivo = $1
    ORDER BY dd.usuario_uuid`,
  [uuidArquivo]
)

const lapideDe = async (uuidArquivo) => conn.one(
  'SELECT * FROM acervo.arquivo_deletado WHERE uuid_arquivo = $1',
  [uuidArquivo]
)

// ---------------------------------------------------------------------------
// O contrato da lapide, provado uma vez pelo caminho mais simples
// ---------------------------------------------------------------------------
describe('deleteArquivos: o arquivo vira lapide', () => {
  it('copia TODAS as colunas do arquivo para a lapide', async () => {
    const { arquivos } = await cenario()
    const original = arquivos[2]

    await arquivoCtrl.deleteArquivos([original.id], MOTIVO, ADMIN_UUID)
    const lapide = await lapideDe(original.uuid_arquivo)

    expect(lapide.nome).toBe(original.nome)
    expect(lapide.nome_arquivo).toBe(original.nome_arquivo)
    expect(Number(lapide.versao_id)).toBe(Number(original.versao_id))
    expect(lapide.tipo_arquivo_id).toBe(original.tipo_arquivo_id)
    expect(Number(lapide.volume_armazenamento_id)).toBe(Number(original.volume_armazenamento_id))
    expect(lapide.extensao).toBe(original.extensao)
    expect(lapide.tamanho_mb).toBeCloseTo(original.tamanho_mb, 3)
    expect(lapide.checksum).toBe(original.checksum)
    expect(lapide.metadado).toEqual(original.metadado)
    expect(lapide.situacao_carregamento_id).toBe(original.situacao_carregamento_id)
    expect(lapide.descricao).toBe(original.descricao)
    expect(lapide.crs_original).toBe(original.crs_original)
    expect(lapide.usuario_cadastramento_uuid).toBe(original.usuario_cadastramento_uuid)
    expect(new Date(lapide.data_cadastramento).getTime())
      .toBe(new Date(original.data_cadastramento).getTime())
  })

  it('grava motivo, status EXCLUIDO e a autoria do delete', async () => {
    const { arquivos } = await cenario()

    await arquivoCtrl.deleteArquivos([arquivos[2].id], MOTIVO, USER_UUID)
    const lapide = await lapideDe(arquivos[2].uuid_arquivo)

    expect(lapide.motivo_exclusao).toBe(MOTIVO)
    // O status da lapide NAO e o do arquivo: ele passa a EXCLUIDO.
    expect(lapide.tipo_status_id).toBe(EXCLUIDO)
    expect(lapide.usuario_delete_uuid).toBe(USER_UUID)
    expect(lapide.data_delete).not.toBeNull()
  })

  // O invariante que a insercao em lote pode inverter.
  it('cada download vai para a lapide do SEU arquivo', async () => {
    const { arquivos } = await cenario()

    await arquivoCtrl.deleteArquivos(
      arquivos.map(a => a.id), MOTIVO, ADMIN_UUID
    )

    expect((await downloadsDaLapide(arquivos[0].uuid_arquivo)).map(d => d.usuario_uuid))
      .toEqual([ADMIN_UUID])
    expect((await downloadsDaLapide(arquivos[1].uuid_arquivo)).map(d => d.usuario_uuid))
      .toEqual([ADMIN_UUID, USER_UUID].sort())
    expect(await downloadsDaLapide(arquivos[2].uuid_arquivo)).toHaveLength(0)
  })

  it('apaga o arquivo e o download originais', async () => {
    const { arquivos } = await cenario()

    await arquivoCtrl.deleteArquivos(arquivos.map(a => a.id), MOTIVO, ADMIN_UUID)

    const vivos = await conn.one('SELECT COUNT(*)::int n FROM acervo.arquivo')
    const downloads = await conn.one('SELECT COUNT(*)::int n FROM acervo.download')
    expect(vivos.n).toBe(0)
    expect(downloads.n).toBe(0)
  })

  // A transacao e uma so: um id inexistente no meio do lote nao pode deixar
  // meia exclusao gravada.
  it('id inexistente aborta o lote inteiro, sem lapide nenhuma', async () => {
    const { arquivos } = await cenario()

    await expect(
      arquivoCtrl.deleteArquivos([arquivos[0].id, 999999], MOTIVO, ADMIN_UUID)
    ).rejects.toMatchObject({ statusCode: 404 })

    const lapides = await conn.one('SELECT COUNT(*)::int n FROM acervo.arquivo_deletado')
    const vivos = await conn.one('SELECT COUNT(*)::int n FROM acervo.arquivo')
    expect(lapides.n).toBe(0)
    expect(vivos.n).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Os outros dois caminhos: mesma lapide, alcance diferente
// ---------------------------------------------------------------------------
describe('deleteVersoes: arquiva os arquivos da versao', () => {
  // A versao so pode sair se NAO for a unica do produto, entao o cenario aqui
  // precisa de duas.
  //
  // E o ALVO tem de ser a MAIS NOVA. O `deleteVersoes` recusa apagar a '1-DSG'
  // enquanto existir a '2-DSG', pela regra de sequencia X-SIGLA: a posterior
  // depende da anterior. Escrevi ao contrario na primeira versao deste teste e
  // o controller me corrigiu -- o caso real e apagar a edicao recem-cadastrada
  // que saiu errada, nunca a base de que as outras descendem.
  const cenarioDuasVersoes = async () => {
    const produto = await createProduto()
    const sobrevivente = await createVersao(produto.id, { versao: '1-DSG' })
    const alvo = await createVersao(produto.id, { versao: '2-DSG' })
    const arquivos = []
    for (let i = 0; i < 3; i++) {
      arquivos.push(await createArquivo(alvo.id, {
        nome: `Arquivo ${i}`, nome_arquivo: `arquivo_${i}.tif`
      }))
    }
    await baixar(arquivos[0].id, ADMIN_UUID)
    await baixar(arquivos[1].id, ADMIN_UUID)
    await baixar(arquivos[1].id, USER_UUID)
    return { produto, alvo, sobrevivente, arquivos }
  }

  it('cada download vai para a lapide do SEU arquivo', async () => {
    const { alvo, arquivos } = await cenarioDuasVersoes()

    await produtoCtrl.deleteVersoes([alvo.id], MOTIVO, ADMIN_UUID)

    expect((await downloadsDaLapide(arquivos[0].uuid_arquivo)).map(d => d.usuario_uuid))
      .toEqual([ADMIN_UUID])
    expect((await downloadsDaLapide(arquivos[1].uuid_arquivo)).map(d => d.usuario_uuid))
      .toEqual([ADMIN_UUID, USER_UUID].sort())
    expect(await downloadsDaLapide(arquivos[2].uuid_arquivo)).toHaveLength(0)
  })

  it('a lapide guarda o motivo, e a versao some', async () => {
    const { alvo, sobrevivente, arquivos } = await cenarioDuasVersoes()

    await produtoCtrl.deleteVersoes([alvo.id], MOTIVO, ADMIN_UUID)

    const lapide = await lapideDe(arquivos[0].uuid_arquivo)
    expect(lapide.motivo_exclusao).toBe(MOTIVO)
    expect(lapide.tipo_status_id).toBe(EXCLUIDO)
    // arquivo_deletado.versao_id e ON DELETE SET NULL: apagada a versao, a
    // lapide perde o vinculo. E o comportamento real, e vale fixar.
    expect(lapide.versao_id).toBeNull()

    const versoes = await conn.any('SELECT id FROM acervo.versao')
    expect(versoes.map(v => Number(v.id))).toEqual([Number(sobrevivente.id)])
  })

  it('recusa apagar a UNICA versao do produto', async () => {
    const { versao } = await cenario()

    await expect(
      produtoCtrl.deleteVersoes([versao.id], MOTIVO, ADMIN_UUID)
    ).rejects.toMatchObject({ statusCode: 400 })

    const lapides = await conn.one('SELECT COUNT(*)::int n FROM acervo.arquivo_deletado')
    expect(lapides.n).toBe(0)
  })
})

describe('deleteProdutos: arquiva os arquivos de todas as versoes', () => {
  it('cada download vai para a lapide do SEU arquivo, atravessando as versoes', async () => {
    const produto = await createProduto()
    const v1 = await createVersao(produto.id, { versao: '1-DSG' })
    const v2 = await createVersao(produto.id, { versao: '2-DSG' })
    const a1 = await createArquivo(v1.id, { nome_arquivo: 'v1.tif' })
    const a2 = await createArquivo(v2.id, { nome_arquivo: 'v2.tif' })
    await baixar(a1.id, ADMIN_UUID)
    await baixar(a2.id, ADMIN_UUID)
    await baixar(a2.id, USER_UUID)

    await produtoCtrl.deleteProdutos([produto.id], MOTIVO, ADMIN_UUID)

    expect((await downloadsDaLapide(a1.uuid_arquivo)).map(d => d.usuario_uuid))
      .toEqual([ADMIN_UUID])
    expect((await downloadsDaLapide(a2.uuid_arquivo)).map(d => d.usuario_uuid))
      .toEqual([ADMIN_UUID, USER_UUID].sort())

    const produtos = await conn.one('SELECT COUNT(*)::int n FROM acervo.produto')
    const versoes = await conn.one('SELECT COUNT(*)::int n FROM acervo.versao')
    const vivos = await conn.one('SELECT COUNT(*)::int n FROM acervo.arquivo')
    expect(produtos.n).toBe(0)
    expect(versoes.n).toBe(0)
    expect(vivos.n).toBe(0)
  })

  it('grava motivo e autoria em todas as lapides', async () => {
    const { produto, arquivos } = await cenario()

    await produtoCtrl.deleteProdutos([produto.id], MOTIVO, USER_UUID)

    for (const a of arquivos) {
      const lapide = await lapideDe(a.uuid_arquivo)
      expect(lapide.motivo_exclusao).toBe(MOTIVO)
      expect(lapide.tipo_status_id).toBe(EXCLUIDO)
      expect(lapide.usuario_delete_uuid).toBe(USER_UUID)
    }
  })
})

'use strict'

/**
 * `GET /api/gerencia/arquivos_incorretos`: a lista do que o acervo sabe estar
 * errado.
 *
 * A resposta une DUAS tabelas com sequências de id próprias: `acervo.arquivo`
 * (erro de carregamento) e `acervo.arquivo_deletado` (erro na exclusão). O
 * mesmo número existe nas duas apontando arquivos DIFERENTES.
 *
 * Por isso a `origem` é obrigatória na resposta, e é o que este arquivo protege.
 * Sem ela, a tela mostra um número cru; colado no cartão "Atualizar checksum",
 * um id de excluído manda o servidor reler e gravar OUTRO arquivo, vivo. A rota
 * de checksum não tem como recusar, porque aquele id existe de verdade em
 * `acervo.arquivo`. O defeito é silencioso e escreve no alvo errado.
 */

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken } = require('../helpers/auth')
const { createFullProduct, createArquivo } = require('../helpers/fixtures')
const { domainConstants: { STATUS_ARQUIVO } } = require('../../utils')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const token = () => generateAdminToken()

const listar = () => request(app)
  .get('/api/gerencia/arquivos_incorretos')
  .set('Authorization', token())

/** Move um arquivo vivo para a lápide, com a exclusão marcada como falha. */
const excluirComErro = async (arquivoId) => {
  await conn.none(`
    INSERT INTO acervo.arquivo_deletado (
      uuid_arquivo, nome, nome_arquivo, motivo_exclusao, versao_id, tipo_arquivo_id,
      volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado,
      tipo_status_id, situacao_carregamento_id, descricao, crs_original,
      data_cadastramento, usuario_cadastramento_uuid, data_delete, usuario_delete_uuid
    )
    SELECT
      uuid_arquivo, nome, nome_arquivo, 'teste de erro na exclusão', versao_id,
      tipo_arquivo_id, volume_armazenamento_id, extensao, tamanho_mb, checksum,
      metadado, $<status>, situacao_carregamento_id, descricao, crs_original,
      data_cadastramento, usuario_cadastramento_uuid, now(), usuario_cadastramento_uuid
    FROM acervo.arquivo WHERE id = $<id>
  `, { id: arquivoId, status: STATUS_ARQUIVO.ERRO_EXCLUSAO })
  await conn.none('DELETE FROM acervo.arquivo WHERE id = $1', [arquivoId])
}

describe('Arquivos com problema - a origem de cada id', () => {
  it('devolve a ORIGEM de cada linha, e não só o id', async () => {
    const { versao } = await createFullProduct()
    await createArquivo(versao.id, { tipo_status_id: STATUS_ARQUIVO.ERRO_CARREGAMENTO })
    const paraExcluir = await createArquivo(versao.id)
    await excluirComErro(paraExcluir.id)

    const res = await listar()
    expect(res.status).toBe(200)
    expect(res.body.dados).toHaveLength(2)

    // O campo existe em TODA linha: é ele que diz de que tabela o id veio.
    for (const linha of res.body.dados) {
      expect(['arquivo', 'arquivo_deletado']).toContain(linha.origem)
    }
    expect(res.body.dados.map(l => l.origem).sort())
      .toEqual(['arquivo', 'arquivo_deletado'])
  })

  it('o mesmo NÚMERO nas duas tabelas sai distinguível', async () => {
    // É a colisão que o id cru escondia. Aqui ela é forçada: um arquivo vivo e
    // um excluído com o MESMO id, que é o pior caso e o que o operador não
    // consegue perceber olhando a tela antiga.
    const { versao } = await createFullProduct()
    const vivo = await createArquivo(versao.id, {
      nome: 'O vivo',
      tipo_status_id: STATUS_ARQUIVO.ERRO_CARREGAMENTO
    })
    const outro = await createArquivo(versao.id, { nome: 'O excluído' })
    await excluirComErro(outro.id)
    // Força o id da lápide a colidir com o do arquivo vivo. Casa pelo
    // `uuid_arquivo`, e não pelo id: a lápide recebe id PRÓPRIO, da sequência
    // dela, e não herda o do arquivo que a originou. Essa independência entre as
    // duas sequências é justamente o que torna o id cru ambíguo na tela.
    await conn.none(
      'UPDATE acervo.arquivo_deletado SET id = $<novo> WHERE uuid_arquivo = $<uuid>',
      { novo: vivo.id, uuid: outro.uuid_arquivo }
    )

    const res = await listar()
    const porOrigem = Object.fromEntries(res.body.dados.map(l => [l.origem, l]))

    expect(porOrigem.arquivo.id).toBe(porOrigem.arquivo_deletado.id)
    expect(porOrigem.arquivo.nome).toBe('O vivo')
    expect(porOrigem.arquivo_deletado.nome).toBe('O excluído')
  })

  it('exige perfil de gerente', async () => {
    const res = await request(app).get('/api/gerencia/arquivos_incorretos')
    expect(res.status).toBe(401)
  })
})

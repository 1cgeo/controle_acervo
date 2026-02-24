'use strict'

const { v4: uuidv4 } = require('uuid')
const { conn } = require('./db')
const { ADMIN_UUID } = require('./auth')

/**
 * Creates a produto record in the database.
 * Returns the created row.
 */
const createProduto = async (overrides = {}) => {
  const defaults = {
    nome: 'Produto Teste',
    mi: 'MI-2345',
    inom: 'INOM-TEST',
    tipo_escala_id: 1,
    denominador_escala_especial: null,
    tipo_produto_id: 1,
    descricao: 'Produto criado para testes',
    usuario_cadastramento_uuid: ADMIN_UUID,
    geom: 'SRID=4674;POLYGON((-50 -15, -49 -15, -49 -14, -50 -14, -50 -15))'
  }
  const data = { ...defaults, ...overrides }

  return conn.one(`
    INSERT INTO acervo.produto
      (nome, mi, inom, tipo_escala_id, denominador_escala_especial, tipo_produto_id, descricao, usuario_cadastramento_uuid, geom)
    VALUES
      ($<nome>, $<mi>, $<inom>, $<tipo_escala_id>, $<denominador_escala_especial>, $<tipo_produto_id>, $<descricao>, $<usuario_cadastramento_uuid>, ST_GeomFromEWKT($<geom>))
    RETURNING *
  `, data)
}

/**
 * Creates a versao record in the database.
 * Requires an existing produto_id.
 */
const createVersao = async (produtoId, overrides = {}) => {
  const defaults = {
    uuid_versao: uuidv4(),
    nome: 'Versao Teste',
    versao: '1-DSG',
    tipo_versao_id: 1,
    subtipo_produto_id: 1,
    produto_id: produtoId,
    lote_id: null,
    metadado: null,
    descricao: 'Versao de teste',
    orgao_produtor: 'DSG',
    palavras_chave: ['teste', 'acervo'],
    data_criacao: new Date().toISOString(),
    data_edicao: new Date().toISOString(),
    usuario_cadastramento_uuid: ADMIN_UUID
  }
  const data = { ...defaults, ...overrides }

  return conn.one(`
    INSERT INTO acervo.versao
      (uuid_versao, nome, versao, tipo_versao_id, subtipo_produto_id, produto_id, lote_id, metadado, descricao, orgao_produtor, palavras_chave, data_criacao, data_edicao, usuario_cadastramento_uuid)
    VALUES
      ($<uuid_versao>, $<nome>, $<versao>, $<tipo_versao_id>, $<subtipo_produto_id>, $<produto_id>, $<lote_id>, $<metadado>, $<descricao>, $<orgao_produtor>, $<palavras_chave>, $<data_criacao>, $<data_edicao>, $<usuario_cadastramento_uuid>)
    RETURNING *
  `, data)
}

/**
 * Creates an arquivo record in the database.
 * Requires an existing versao_id.
 */
const createArquivo = async (versaoId, overrides = {}) => {
  const defaults = {
    uuid_arquivo: uuidv4(),
    nome: 'Arquivo Teste',
    nome_arquivo: 'arquivo_teste.tif',
    versao_id: versaoId,
    tipo_arquivo_id: 1,
    volume_armazenamento_id: 1,
    extensao: '.tif',
    tamanho_mb: 150.5,
    checksum: uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, ''),
    metadado: null,
    tipo_status_id: 1,
    situacao_carregamento_id: 1,
    descricao: 'Arquivo de teste',
    crs_original: 'EPSG:4674',
    usuario_cadastramento_uuid: ADMIN_UUID
  }
  const data = { ...defaults, ...overrides }

  return conn.one(`
    INSERT INTO acervo.arquivo
      (uuid_arquivo, nome, nome_arquivo, versao_id, tipo_arquivo_id, volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado, tipo_status_id, situacao_carregamento_id, descricao, crs_original, usuario_cadastramento_uuid)
    VALUES
      ($<uuid_arquivo>, $<nome>, $<nome_arquivo>, $<versao_id>, $<tipo_arquivo_id>, $<volume_armazenamento_id>, $<extensao>, $<tamanho_mb>, $<checksum>, $<metadado>, $<tipo_status_id>, $<situacao_carregamento_id>, $<descricao>, $<crs_original>, $<usuario_cadastramento_uuid>)
    RETURNING *
  `, data)
}

/**
 * Creates a projeto record in the database.
 */
const createProjeto = async (overrides = {}) => {
  const defaults = {
    nome: 'Projeto Teste',
    descricao: 'Projeto criado para testes',
    data_inicio: new Date().toISOString().split('T')[0],
    data_fim: null,
    status_execucao_id: 1,
    usuario_cadastramento_uuid: ADMIN_UUID
  }
  const data = { ...defaults, ...overrides }

  return conn.one(`
    INSERT INTO acervo.projeto
      (nome, descricao, data_inicio, data_fim, status_execucao_id, usuario_cadastramento_uuid)
    VALUES
      ($<nome>, $<descricao>, $<data_inicio>, $<data_fim>, $<status_execucao_id>, $<usuario_cadastramento_uuid>)
    RETURNING *
  `, data)
}

/**
 * Creates a lote record in the database.
 * Requires an existing projeto_id.
 */
const createLote = async (projetoId, overrides = {}) => {
  const defaults = {
    projeto_id: projetoId,
    pit: 'PIT-001',
    nome: 'Lote Teste',
    descricao: 'Lote de teste',
    data_inicio: new Date().toISOString().split('T')[0],
    data_fim: null,
    status_execucao_id: 1,
    usuario_cadastramento_uuid: ADMIN_UUID
  }
  const data = { ...defaults, ...overrides }

  return conn.one(`
    INSERT INTO acervo.lote
      (projeto_id, pit, nome, descricao, data_inicio, data_fim, status_execucao_id, usuario_cadastramento_uuid)
    VALUES
      ($<projeto_id>, $<pit>, $<nome>, $<descricao>, $<data_inicio>, $<data_fim>, $<status_execucao_id>, $<usuario_cadastramento_uuid>)
    RETURNING *
  `, data)
}

/**
 * Creates a volume_armazenamento record.
 */
const createVolume = async (overrides = {}) => {
  const defaults = {
    nome: 'Volume Extra',
    volume: '/data/extra',
    capacidade_gb: 500
  }
  const data = { ...defaults, ...overrides }

  return conn.one(`
    INSERT INTO acervo.volume_armazenamento (nome, volume, capacidade_gb)
    VALUES ($<nome>, $<volume>, $<capacidade_gb>)
    RETURNING *
  `, data)
}

/**
 * Creates a full product chain: produto -> versao -> arquivo.
 * Returns all three records.
 */
const createFullProduct = async (opts = {}) => {
  const produto = await createProduto(opts.produto)
  const versao = await createVersao(produto.id, opts.versao)
  const arquivo = await createArquivo(versao.id, opts.arquivo)
  return { produto, versao, arquivo }
}

module.exports = {
  createProduto,
  createVersao,
  createArquivo,
  createProjeto,
  createLote,
  createVolume,
  createFullProduct
}

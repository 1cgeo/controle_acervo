'use strict'

// O que este arquivo guarda, e o que ele deixou de fingir que guardava.
//
// As regras aqui sao CONDICIONAIS (`Joi.when`) e ESPELHOS DO BANCO. As duas
// classes falham em silencio: a condicional invertida aceita o corpo errado, e
// o espelho desalinhado deixa o erro estourar no trigger, ja dentro da
// transacao, com mensagem do PostgreSQL em vez de 400 dizendo o campo.
//
// Ate 2026-08-01 os casos afirmavam so `expect(error).toBeDefined()`, o que
// passava mesmo se a regra do titulo fosse removida (bastava o fixture falhar
// por outro campo). Agora cada recusa prova o CAMPO e a REGRA, pelo helper
// __tests__/helpers/joi.js.

const arquivoSchema = require('../../../arquivo/arquivo_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

describe('Schemas de arquivo', () => {
  describe('arquivoAtualizacao', () => {
    const valido = {
      id: 1,
      nome: 'arquivo_1',
      tipo_arquivo_id: 1,
      volume_armazenamento_id: 1,
      metadado: {},
      tipo_status_id: 1,
      situacao_carregamento_id: 1,
      descricao: ''
    }

    it('aceita a atualizacao completa', () => {
      aceita(arquivoSchema.arquivoAtualizacao.validate(valido))
    })

    it('metadado tem de ser objeto: ele vai para uma coluna JSONB', () => {
      recusaPor(
        arquivoSchema.arquivoAtualizacao.validate({ ...valido, metadado: 'not-object' }),
        'metadado',
        'object.base'
      )
    })

    // A coluna e VARCHAR(10). Sem o teto aqui, o valor longo so seria recusado
    // pelo PostgreSQL, dentro da transacao de atualizacao.
    it('recusa crs_original acima de 10 caracteres, que e a largura da coluna', () => {
      aceita(arquivoSchema.arquivoAtualizacao.validate({ ...valido, crs_original: 'EPSG:4674' }))
      recusaPor(
        arquivoSchema.arquivoAtualizacao.validate({ ...valido, crs_original: 'EPSG:467412345' }),
        'crs_original',
        'string.max'
      )
    })

    // O CONDICIONAL: Tileserver (tipo 9) e uma URL, nao um arquivo em disco, e
    // por isso NAO tem volume. Invertida, esta regra deixaria um tileserver
    // apontar para um volume (caminho que nunca existe) ou obrigaria um .tif a
    // nao ter volume nenhum, e o download nao acharia o arquivo.
    describe('volume x tipo de arquivo', () => {
      it('tileserver (tipo 9) aceita volume nulo', () => {
        aceita(arquivoSchema.arquivoAtualizacao.validate({
          ...valido, tipo_arquivo_id: 9, volume_armazenamento_id: null
        }))
      })

      it('tileserver (tipo 9) RECUSA volume preenchido', () => {
        recusaPor(
          arquivoSchema.arquivoAtualizacao.validate({
            ...valido, tipo_arquivo_id: 9, volume_armazenamento_id: 1
          }),
          'volume_armazenamento_id',
          'any.only'
        )
      })

      it('arquivo comum RECUSA volume nulo', () => {
        recusaPor(
          arquivoSchema.arquivoAtualizacao.validate({
            ...valido, tipo_arquivo_id: 1, volume_armazenamento_id: null
          }),
          'volume_armazenamento_id',
          'number.base'
        )
      })
    })
  })

  // Exclusao em lote: mesma regra de procedencia do produto. A linha vai para
  // acervo.arquivo_deletado, e o motivo e o que a torna auditavel.
  describe('arquivoIds (exclusao em lote)', () => {
    it('aceita a lista com motivo', () => {
      aceita(arquivoSchema.arquivoIds.validate({
        arquivo_ids: [1, 2], motivo_exclusao: 'Substituicao'
      }))
    })

    it('exige o motivo da exclusao', () => {
      recusaPor(
        arquivoSchema.arquivoIds.validate({ arquivo_ids: [1] }),
        'motivo_exclusao',
        'any.required'
      )
    })

    it('recusa lista vazia', () => {
      recusaPor(
        arquivoSchema.arquivoIds.validate({ arquivo_ids: [], motivo_exclusao: 'm' }),
        'arquivo_ids',
        'array.includesRequiredUnknowns'
      )
    })

    it('recusa id repetido, que tentaria excluir duas vezes o mesmo arquivo', () => {
      recusaPor(
        arquivoSchema.arquivoIds.validate({ arquivo_ids: [1, 1], motivo_exclusao: 'm' }),
        'arquivo_ids.1',
        'array.unique'
      )
    })
  })

  // O MESMO condicional do tileserver, agora na criacao. Extensao, tamanho e
  // checksum descrevem um arquivo em disco; uma URL nao tem nenhum dos tres.
  describe('prepareAddFiles', () => {
    const arquivo = {
      nome: 'test',
      nome_arquivo: 'test_file',
      tipo_arquivo_id: 1,
      extensao: 'gpkg',
      tamanho_mb: 50,
      checksum: 'abc123',
      versao_id: 1
    }

    it('aceita o arquivo comum completo', () => {
      aceita(arquivoSchema.prepareAddFiles.validate({ arquivos: [arquivo] }))
    })

    it('tileserver aceita extensao, tamanho e checksum nulos', () => {
      aceita(arquivoSchema.prepareAddFiles.validate({
        arquivos: [{
          nome: 'tiles',
          nome_arquivo: 'https://tiles.example.com',
          tipo_arquivo_id: 9,
          extensao: null,
          tamanho_mb: null,
          checksum: null,
          versao_id: 1
        }]
      }))
    })

    it.each(['extensao', 'tamanho_mb', 'checksum'])(
      'arquivo comum exige %s',
      (campo) => {
        const { [campo]: _fora, ...sem } = arquivo
        recusaPor(
          arquivoSchema.prepareAddFiles.validate({ arquivos: [sem] }),
          `arquivos.0.${campo}`,
          'any.required'
        )
      }
    )

    it('exige versao_id: o arquivo pertence a uma versao, nunca solto', () => {
      const { versao_id: _fora, ...sem } = arquivo
      recusaPor(
        arquivoSchema.prepareAddFiles.validate({ arquivos: [sem] }),
        'arquivos.0.versao_id',
        'any.required'
      )
    })

    it('aceita uuid_arquivo e metadado opcionais', () => {
      aceita(arquivoSchema.prepareAddFiles.validate({
        arquivos: [{
          ...arquivo,
          uuid_arquivo: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          metadado: null
        }]
      }))
    })
  })

  // O session_uuid e a chave da sessao de upload aberta. Texto que nao e uuid
  // viraria busca que nunca casa: o cliente receberia 404 ("sessao nao existe")
  // onde o certo e 400 ("voce mandou lixo").
  describe('confirmUpload e cancelUpload', () => {
    it.each(['confirmUpload', 'cancelUpload'])('%s aceita uuid', (rota) => {
      aceita(arquivoSchema[rota].validate({
        session_uuid: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
      }))
    })

    it.each(['confirmUpload', 'cancelUpload'])('%s recusa o que nao e uuid', (rota) => {
      recusaPor(
        arquivoSchema[rota].validate({ session_uuid: 'not-uuid' }),
        'session_uuid',
        'string.guid'
      )
    })
  })

  // ESPELHO DO TRIGGER acervo.validate_version. O formato do rotulo de versao e
  // validado no banco; o schema repete a regra para o erro sair como 400 com o
  // campo, e nao como excecao do PostgreSQL no meio da transacao.
  describe('prepareAddVersion', () => {
    const valido = {
      versoes: [{
        produto_id: 1,
        versao: {
          uuid_versao: null,
          versao: '1-DSG',
          nome: 'Versao teste',
          tipo_versao_id: 1,
          subtipo_produto_id: 1,
          lote_id: null,
          metadado: null,
          descricao: '',
          orgao_produtor: 'DSG',
          palavras_chave: [],
          data_criacao: '2024-01-01T00:00:00.000Z',
          data_edicao: '2024-01-01T00:00:00.000Z'
        },
        arquivos: [{
          nome: 'test',
          nome_arquivo: 'test_file',
          tipo_arquivo_id: 1,
          extensao: 'gpkg',
          tamanho_mb: 50,
          checksum: 'abc123'
        }]
      }]
    }

    const com = (mudanca) => {
      const copia = JSON.parse(JSON.stringify(valido))
      Object.assign(copia.versoes[0].versao, mudanca)
      return copia
    }

    it('aceita o formato corrente (1-DSG)', () => {
      aceita(arquivoSchema.prepareAddVersion.validate(valido))
    })

    it('recusa formato que o trigger do banco nao aceita (1.0.0)', () => {
      recusaPor(
        arquivoSchema.prepareAddVersion.validate(com({ versao: '1.0.0' })),
        'versoes.0.versao.versao'
      )
    })

    // O trigger aceita "Xª Edição" nas DUAS familias, e nao so na historica: as
    // cartas do acervo legado sao cadastradas como versao Regular usando esse
    // formato. O schema espelha o trigger, e nao uma versao idealizada dele.
    it('aceita o formato legado na versao historica (tipo 2)', () => {
      aceita(arquivoSchema.prepareAddVersion.validate(
        com({ tipo_versao_id: 2, versao: '2ª Edição' })
      ))
    })

    it('aceita o formato legado tambem na versao Regular (acervo legado)', () => {
      aceita(arquivoSchema.prepareAddVersion.validate(com({ versao: '2ª Edição' })))
    })

    it('exige produto_id: a versao pende de um produto', () => {
      const semProduto = JSON.parse(JSON.stringify(valido))
      delete semProduto.versoes[0].produto_id
      recusaPor(
        arquivoSchema.prepareAddVersion.validate(semProduto),
        'versoes.0.produto_id',
        'any.required'
      )
    })
  })

  describe('prepareAddProduct', () => {
    const valido = {
      produtos: [{
        produto: {
          nome: 'Carta Teste',
          mi: 'MI-001',
          inom: 'SF-22',
          tipo_escala_id: 2,
          denominador_escala_especial: null,
          tipo_produto_id: 1,
          descricao: '',
          geom: 'SRID=4674;POLYGON((-50 -25, -49 -25, -49 -24, -50 -24, -50 -25))'
        },
        versoes: [{
          uuid_versao: null,
          versao: '1-DSG',
          nome: 'Versao 1',
          tipo_versao_id: 1,
          subtipo_produto_id: 1,
          lote_id: null,
          metadado: null,
          descricao: '',
          orgao_produtor: 'DSG',
          palavras_chave: [],
          data_criacao: '2024-01-01T00:00:00.000Z',
          data_edicao: '2024-01-01T00:00:00.000Z',
          arquivos: [{
            nome: 'arquivo1',
            nome_arquivo: 'arquivo1.gpkg',
            tipo_arquivo_id: 1,
            extensao: 'gpkg',
            tamanho_mb: 100,
            checksum: 'hash123'
          }]
        }]
      }]
    }

    it('aceita produto com versao e arquivo, numa chamada so', () => {
      aceita(arquivoSchema.prepareAddProduct.validate(valido))
    })

    it('exige geom no produto', () => {
      const semGeom = JSON.parse(JSON.stringify(valido))
      delete semGeom.produtos[0].produto.geom
      recusaPor(
        arquivoSchema.prepareAddProduct.validate(semGeom),
        'produtos.0.produto.geom',
        'any.required'
      )
    })
  })

  // Envio pelo NAVEGADOR. O contrato do arquivo e o unico que muda em relacao
  // ao prepare-upload do plugin, e a arvore de produto e de versao e a MESMA
  // (as duas saem das fabricas `produtoComVersoes` e `versaoDeProduto`): o que
  // estes casos guardam e justamente a diferenca.
  // O envio pelo NAVEGADOR e uma requisicao so, e o cliente declara MENOS do que
  // no caminho do plugin. Cada recusa aqui fecha um modo de falhar diferente.
  describe('uploadWeb (produto e versao)', () => {
    const arquivoWeb = {
      nome: 'Carta',
      tipo_arquivo_id: 1,
      situacao_carregamento_id: 1
    }

    const versao = (arquivos) => ({
      produto_id: 7,
      versao: {
        versao: '1-DSG',
        nome: null,
        tipo_versao_id: 1,
        subtipo_produto_id: 2,
        orgao_produtor: '1º CGEO',
        data_criacao: '2026-07-01',
        data_edicao: '2026-08-01'
      },
      arquivos: [arquivos]
    })

    const produto = (arquivos) => ({
      produto: {
        nome: 'Folha',
        mi: '2757-1-NE',
        inom: 'SF-22-Y-D-II-1-NE',
        tipo_escala_id: 1,
        denominador_escala_especial: null,
        tipo_produto_id: 2,
        subtipo_produto_id: null,
        descricao: '',
        geom: 'SRID=4674;POLYGON((-51 -23, -50 -23, -50 -22, -51 -22, -51 -23))'
      },
      versao: versao(arquivos).versao,
      arquivos: [arquivos]
    })

    it('aceita o arquivo so com o rotulo e o tipo: o resto o servidor deriva', () => {
      aceita(arquivoSchema.uploadWebVersao.validate(versao(arquivoWeb)))
      aceita(arquivoSchema.uploadWebProduto.validate(produto(arquivoWeb)))
    })

    // O nome fisico sai de `acervo.nome_arquivo_padrao`, a mesma funcao que o
    // invariante 7a audita. Aceito do cliente, cada envio pela web criava uma
    // linha de DEFECT no 7a -- medido em 2026-08-02, com `carta_ensaio` onde o
    // padrao pedia `CT_s12_2757-1-NE_1dsg`.
    it('RECUSA nome_arquivo declarado pelo cliente', () => {
      for (const [nome, montar] of [['versao', versao], ['produto', produto]]) {
        const r = arquivoSchema[nome === 'versao' ? 'uploadWebVersao' : 'uploadWebProduto']
          .validate(montar({ ...arquivoWeb, nome_arquivo: 'nome_que_eu_quero' }))
        expect(r.error).toBeDefined()
        expect(r.error.details[0].message).toContain('nome_arquivo_padrao')
      }
    })

    // A extensao sai do nome do arquivo que subiu. Declarada, poderia dizer
    // `tif` num PDF, e o acervo prometeria um formato que nao tem.
    it('RECUSA extensao declarada pelo cliente', () => {
      const r = arquivoSchema.uploadWebVersao.validate(
        versao({ ...arquivoWeb, extensao: 'tif' })
      )
      expect(r.error).toBeDefined()
      expect(r.error.details[0].message).toContain('nome do arquivo enviado')
    })

    it('RECUSA checksum e tamanho_mb, que o servidor mede ao gravar', () => {
      const comChecksum = arquivoSchema.uploadWebVersao.validate(
        versao({ ...arquivoWeb, checksum: 'a'.repeat(64) })
      )
      expect(comChecksum.error).toBeDefined()
      expect(comChecksum.error.details[0].message).toContain('checksum é medido pelo servidor')

      const comTamanho = arquivoSchema.uploadWebVersao.validate(
        versao({ ...arquivoWeb, tamanho_mb: 12 })
      )
      expect(comTamanho.error).toBeDefined()
      expect(comTamanho.error.details[0].message).toContain('tamanho é medido pelo servidor')
    })

    it('RECUSA tileserver, que e URL e nao tem byte para enviar', () => {
      recusaPor(
        arquivoSchema.uploadWebVersao.validate(versao({ ...arquivoWeb, tipo_arquivo_id: 9 })),
        'arquivos.0.tipo_arquivo_id',
        'any.invalid'
      )
    })

    it('exige ao menos um arquivo: e o arquivo que define a versao Regular', () => {
      recusaPor(
        arquivoSchema.uploadWebVersao.validate({ ...versao(arquivoWeb), arquivos: [] }),
        'arquivos',
        'array.min'
      )
    })

    it('exige geom no produto novo', () => {
      const corpo = produto(arquivoWeb)
      delete corpo.produto.geom
      recusaPor(arquivoSchema.uploadWebProduto.validate(corpo), 'produto.geom', 'any.required')
    })

    // As datas seguem sendo dia de calendario aqui tambem: este schema tinha o
    // mesmo defeito de fuso que o de produto, e corrigir um so nao adiantaria.
    it('a data de versao volta como a string original', () => {
      const { value, error } = arquivoSchema.uploadWebVersao.validate(versao(arquivoWeb))
      expect(error).toBeUndefined()
      expect(value.versao.data_edicao).toBe('2026-08-01')
    })
  })
})

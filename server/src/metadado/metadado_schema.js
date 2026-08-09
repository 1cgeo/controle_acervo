'use strict'

// CONTRATO DE ENTRADA DO MODULO METADADO.
//
// VEIO DO SAP 2.3.5 (`server/src/metadados/metadados_schema.js`), na travessia
// de 2026-08-09, com TRES trocas que acompanham `er/metadado.sql` e nao sao
// cosmeticas:
//
//   1. `produto_id` virou `versao_id`. O produto do SAP e a VERSAO do acervo, e
//      metadado descreve uma EDICAO especifica: a mesma folha reeditada em outro
//      ano tem outro resumo, outra data de criacao e outro responsavel.
//   2. `lote_id` continua `lote_id`, e aponta `acervo.lote`.
//   3. `metadado.usuario.usuario_sap_id` (SERIAL) virou `usuario_uuid` (UUID),
//      que e como todo o SCA aponta gente.
//
// O `.xor('versao_id', 'lote_id')` de sete schemas ESPELHA o CHECK do banco, e
// os dois existem de proposito: o Joi devolve 400 com a frase que diz o que
// fazer, e o CHECK e o que impede a linha errada de entrar por qualquer outra
// porta. Perder um dos dois nao e simplificacao.
//
// `data_criacao` E STRING, e nao `Joi.date().iso().raw()`. A regra da casa vale
// para DIA DE CALENDARIO; este campo nao e um: a ficha ET-PCDG imprime as vezes
// um ano ('2019'), as vezes um intervalo ('2019-2021'), e a coluna e VARCHAR
// pelo mesmo motivo. Guardar DATE obrigaria a inventar mes e dia.

const Joi = require('joi')

const models = {}

// --- Parametros de caminho ---------------------------------------------------

// O `:uuid` das rotas de produto e o `acervo.versao.uuid_versao`. Sem prender a
// versao 4 do UUID: e a convencao da casa (`produto_schema.js`,
// `arquivo_schema.js`), e o acervo tem versao carregada de fora.
models.uuidParams = Joi.object().keys({
  uuid: Joi.string().uuid().required()
})

models.loteIdParams = Joi.object().keys({
  loteId: Joi.number().integer().required()
})

// --- Organizacao (os cinco CGEO) ---------------------------------------------

// Nao ha POST nem DELETE: a tabela e semeada por `er/metadado.sql` com os cinco
// Centros, e o que a tela edita e o CONTATO de cada um (endereco postal,
// telefone e site publico), que o XML publica como produtor e distribuidor.
models.organizacao = Joi.object().keys({
  organizacoes: Joi.array()
    .items(
      Joi.object().keys({
        code: Joi.number().integer().strict().required(),
        nome: Joi.string().required(),
        sigla: Joi.string().allow(null, ''),
        endereco: Joi.string().allow(null, ''),
        telefone: Joi.string().allow(null, ''),
        site: Joi.string().allow(null, '')
      })
    )
    .unique('code')
    .required()
    .min(1)
})

// --- Usuario do metadado -----------------------------------------------------
//
// NAO E UMA CONTA. `dgeo.usuario` responde "quem entra no sistema"; esta tabela
// responde "que nome, que funcao e que OM saem impressos no XML" para a mesma
// pessoa. Por isso nao ha UNIQUE em `usuario_uuid`: a mesma pessoa assina como
// duas funcoes diferentes em produtos de anos diferentes, e o metadado antigo
// tem de continuar dizendo o que dizia.

const usuarioCorpo = {
  usuario_uuid: Joi.string().uuid().required(),
  nome: Joi.string().required(),
  funcao: Joi.string().required(),
  organizacao_id: Joi.number().integer().strict().required()
}

models.usuario = Joi.object().keys({
  usuario: Joi.array()
    .items(Joi.object().keys(usuarioCorpo))
    .required()
    .min(1)
})

models.usuarioAtualizacao = Joi.object().keys({
  usuario: Joi.array()
    .items(
      Joi.object().keys({
        id: Joi.number().integer().strict().required(),
        ...usuarioCorpo
      })
    )
    .unique('id')
    .required()
    .min(1)
})

models.usuarioIds = Joi.object().keys({
  usuarios_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
})

// --- Informacoes do produto (o bloco de identificacao do XML) -----------------

const informacoesProdutoCorpo = {
  versao_id: Joi.number().integer().strict(),
  lote_id: Joi.number().integer().strict(),
  resumo: Joi.string().required(),
  proposito: Joi.string().allow('').required(),
  creditos: Joi.string().allow('').required(),
  informacoes_complementares: Joi.string().allow('').required(),
  limitacao_acesso_id: Joi.number().integer().strict().required(),
  limitacao_uso_id: Joi.number().integer().strict().required(),
  restricao_uso_id: Joi.number().integer().strict().required(),
  grau_sigilo_id: Joi.number().integer().strict().required(),
  organizacao_responsavel_id: Joi.number().integer().strict().required(),
  organizacao_distribuicao_id: Joi.number().integer().strict().required(),
  datum_vertical_id: Joi.number().integer().strict().required(),
  especificacao_id: Joi.number().integer().strict().required(),
  responsavel_produto_id: Joi.number().integer().strict().required(),
  declaracao_linhagem: Joi.string().allow('').required(),
  projeto_bdgex: Joi.string().required()
}

models.informacoesProduto = Joi.object().keys({
  informacoes_produto: Joi.array()
    .items(Joi.object().keys(informacoesProdutoCorpo).xor('versao_id', 'lote_id'))
    // `.required().min(1)` ENTROU AQUI, e a origem nao tinha: sem ele um corpo
    // `{}` passava pelo Joi e o controller estourava adiante, com 500 onde
    // cabia um 400 dizendo o que faltou.
    .required()
    .min(1)
})

models.informacoesProdutoAtualizacao = Joi.object().keys({
  informacoes_produto: Joi.array()
    .items(
      Joi.object()
        .keys({
          id: Joi.number().integer().strict().required(),
          ...informacoesProdutoCorpo
        })
        .xor('versao_id', 'lote_id')
    )
    .unique('id')
    .required()
    .min(1)
})

models.informacoesProdutoIds = Joi.object().keys({
  informacoes_produto_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
})

// --- Responsavel por fase ----------------------------------------------------
//
// `usuario_id` aponta `metadado.usuario` (a identidade PUBLICADA), e nao
// `dgeo.usuario`: por isso continua INTEGER, e nao virou uuid na travessia.
// `fase_id` aponta `producao.fase`.

const responsavelFaseCorpo = {
  usuario_id: Joi.number().integer().strict().required(),
  fase_id: Joi.number().integer().strict().required(),
  versao_id: Joi.number().integer().strict(),
  lote_id: Joi.number().integer().strict()
}

models.responsavelFaseProduto = Joi.object().keys({
  responsavel_fase_produto: Joi.array()
    .items(Joi.object().keys(responsavelFaseCorpo).xor('versao_id', 'lote_id'))
    .required()
    .min(1)
})

models.responsavelFaseProdutoAtualizacao = Joi.object().keys({
  responsavel_fase_produto: Joi.array()
    .items(
      Joi.object()
        .keys({
          id: Joi.number().integer().strict().required(),
          ...responsavelFaseCorpo
        })
        .xor('versao_id', 'lote_id')
    )
    .unique('id')
    .required()
    .min(1)
})

models.responsavelFaseProdutoIds = Joi.object().keys({
  responsavel_fase_produto_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
})

// --- Palavra-chave -----------------------------------------------------------
//
// A UNICA TABELA DO SCHEMA SEM O XOR, e a ausencia e a regra: nao existe
// palavra-chave de lote. Toponimo e descricao sao por FOLHA, e herdar a palavra
// chave do lote faria toda folha se descrever pelo mesmo lugar. Por isso
// `versao_id` e obrigatorio aqui e nao aceita `lote_id`.

const palavraChaveCorpo = {
  nome: Joi.string().required(),
  tipo_palavra_chave_id: Joi.number().integer().strict().required(),
  versao_id: Joi.number().integer().strict().required()
}

models.palavraChaveProduto = Joi.object().keys({
  palavras_chave_produto: Joi.array()
    .items(Joi.object().keys(palavraChaveCorpo))
    .required()
    .min(1)
})

models.palavraChaveProdutoAtualizacao = Joi.object().keys({
  palavras_chave_produto: Joi.array()
    .items(
      Joi.object().keys({
        id: Joi.number().integer().strict().required(),
        ...palavraChaveCorpo
      })
    )
    .unique('id')
    .required()
    .min(1)
})

models.palavraChaveProdutoIds = Joi.object().keys({
  palavras_chave_produto_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
})

// --- Creditos QPT ------------------------------------------------------------
//
// `qpt` e o XML de composicao de impressao do QGIS, guardado inteiro: o credito
// da moldura nao e uma lista de nomes, e um LAYOUT, e quem o desenha e o QGIS.

models.creditosQpt = Joi.object().keys({
  creditos_qpt: Joi.array()
    .items(
      Joi.object().keys({
        nome: Joi.string().required(),
        qpt: Joi.string().required()
      })
    )
    .required()
    .min(1)
})

models.creditosQptAtualizacao = Joi.object().keys({
  creditos_qpt: Joi.array()
    .items(
      Joi.object().keys({
        id: Joi.number().integer().strict().required(),
        nome: Joi.string().required(),
        qpt: Joi.string().required()
      })
    )
    .unique('id')
    .required()
    .min(1)
})

models.creditosQptIds = Joi.object().keys({
  creditos_qpt_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
})

// --- Informacoes de edicao (quase toda a ficha ET-PCDG) ----------------------

// `quadro_fases` ACEITA OBJETO OU ARRAY, e a origem so aceitava objeto. A
// coluna e JSON e o leitor do JSON de edicao ja trata as duas formas (array
// direto ou `{fases: [...]}`): recusar na porta o que a leitura aceita seria
// contrato mentindo para os dois lados.
const quadroFases = Joi.alternatives()
  .try(Joi.array(), Joi.object())
  .required()

// A licenca e presa aos DOIS valores que o plugin de edicao aceita. Um terceiro
// valor entraria calado no banco e sairia como licenca invalida no produto.
const licencaProduto = Joi.string()
  .valid('CC-BY-SA 4.0', 'CC-BY-NC-SA 4.0')
  .allow('', null)

const informacoesEdicaoCorpo = {
  versao_id: Joi.number().integer().strict(),
  lote_id: Joi.number().integer().strict(),
  pec_planimetrico: Joi.string().required(),
  pec_altimetrico: Joi.string().required(),
  origem_dados_altimetricos: Joi.string().required(),
  territorio_internacional: Joi.boolean().required(),
  acesso_restrito: Joi.boolean().required(),
  carta_militar: Joi.boolean().required(),
  data_criacao: Joi.string().required(),
  creditos_id: Joi.number().integer().strict().allow(null),
  epsg_mde: Joi.string().required(),
  caminho_mde: Joi.string().required(),
  dados_terceiro: Joi.array().items(Joi.string()).required(),
  quadro_fases: quadroFases,
  tipo_produto: Joi.string().allow('', null),
  versao_produto: Joi.string().allow('', null),
  licenca_produto: licencaProduto,
  observacoes: Joi.array().items(Joi.string()).allow(null),
  dpi: Joi.number().integer().strict().allow(null)
}

models.informacoesEdicao = Joi.object().keys({
  informacoes_edicao: Joi.array()
    .items(Joi.object().keys(informacoesEdicaoCorpo).xor('versao_id', 'lote_id'))
    .required()
    .min(1)
})

models.informacoesEdicaoAtualizacao = Joi.object().keys({
  informacoes_edicao: Joi.array()
    .items(
      Joi.object()
        .keys({
          id: Joi.number().integer().strict().required(),
          ...informacoesEdicaoCorpo
        })
        .xor('versao_id', 'lote_id')
    )
    .unique('id')
    .required()
    .min(1)
})

models.informacoesEdicaoIds = Joi.object().keys({
  informacoes_edicao_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
})

// --- Imagens da carta ortoimagem ---------------------------------------------

const imagensCorpo = {
  versao_id: Joi.number().integer().strict(),
  lote_id: Joi.number().integer().strict(),
  caminho_imagem: Joi.string().required(),
  caminho_estilo: Joi.string().allow('', null),
  epsg: Joi.string().required()
}

models.imagensCartaOrtoimagem = Joi.object().keys({
  imagens_carta_ortoimagem: Joi.array()
    .items(Joi.object().keys(imagensCorpo).xor('versao_id', 'lote_id'))
    .required()
    .min(1)
})

models.imagensCartaOrtoimagemAtualizacao = Joi.object().keys({
  imagens_carta_ortoimagem: Joi.array()
    .items(
      Joi.object()
        .keys({ id: Joi.number().integer().strict().required(), ...imagensCorpo })
        .xor('versao_id', 'lote_id')
    )
    .unique('id')
    .required()
    .min(1)
})

models.imagensCartaOrtoimagemIds = Joi.object().keys({
  imagens_carta_ortoimagem_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
})

// --- Classes complementares da ortoimagem ------------------------------------
//
// O CATALOGO de listas de classes vetoriais desenhadas sobre a ortoimagem. Os
// nomes sao camadas da EDGV e por isso sao texto solto: eles nao tem chave
// estrangeira nenhuma para apontar neste banco.

models.classesComplementaresOrto = Joi.object().keys({
  classes_complementares_orto: Joi.array()
    .items(
      Joi.object().keys({
        nome: Joi.string().required(),
        classes: Joi.array().items(Joi.string()).required().min(1)
      })
    )
    .required()
    .min(1)
})

models.classesComplementaresOrtoAtualizacao = Joi.object().keys({
  classes_complementares_orto: Joi.array()
    .items(
      Joi.object().keys({
        id: Joi.number().integer().strict().required(),
        nome: Joi.string().required(),
        classes: Joi.array().items(Joi.string()).required().min(1)
      })
    )
    .unique('id')
    .required()
    .min(1)
})

models.classesComplementaresOrtoIds = Joi.object().keys({
  classes_complementares_orto_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
})

// --- Perfil de classes complementares ----------------------------------------
//
// "perfil" aqui e heranca do SAP e NAO tem relacao com `dominio.tipo_perfil`:
// e a escolha de qual lista do catalogo vale para qual versao ou lote.

const perfilClassesCorpo = {
  versao_id: Joi.number().integer().strict(),
  lote_id: Joi.number().integer().strict(),
  classes_complementares_orto_id: Joi.number().integer().strict().required()
}

models.perfilClassesComplementaresOrto = Joi.object().keys({
  perfil_classes_complementares_orto: Joi.array()
    .items(Joi.object().keys(perfilClassesCorpo).xor('versao_id', 'lote_id'))
    .required()
    .min(1)
})

models.perfilClassesComplementaresOrtoAtualizacao = Joi.object().keys({
  perfil_classes_complementares_orto: Joi.array()
    .items(
      Joi.object()
        .keys({ id: Joi.number().integer().strict().required(), ...perfilClassesCorpo })
        .xor('versao_id', 'lote_id')
    )
    .unique('id')
    .required()
    .min(1)
})

models.perfilClassesComplementaresOrtoIds = Joi.object().keys({
  perfil_classes_complementares_orto_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
})

// --- Sensores da carta ortoimagem --------------------------------------------

const sensorCorpo = {
  versao_id: Joi.number().integer().strict(),
  lote_id: Joi.number().integer().strict(),
  tipo: Joi.string().required(),
  plataforma: Joi.string().required(),
  nome: Joi.string().required(),
  resolucao: Joi.string().required(),
  bandas: Joi.string().required(),
  nivel_produto: Joi.string().required()
}

models.sensorCartaOrtoimagem = Joi.object().keys({
  sensor_carta_ortoimagem: Joi.array()
    .items(Joi.object().keys(sensorCorpo).xor('versao_id', 'lote_id'))
    .required()
    .min(1)
})

models.sensorCartaOrtoimagemAtualizacao = Joi.object().keys({
  sensor_carta_ortoimagem: Joi.array()
    .items(
      Joi.object()
        .keys({ id: Joi.number().integer().strict().required(), ...sensorCorpo })
        .xor('versao_id', 'lote_id')
    )
    .unique('id')
    .required()
    .min(1)
})

models.sensorCartaOrtoimagemIds = Joi.object().keys({
  sensor_carta_ortoimagem_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
})

module.exports = models

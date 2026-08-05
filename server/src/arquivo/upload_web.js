'use strict'

// Envio de arquivo pelo NAVEGADOR: metadados e bytes numa requisição só.
//
// POR QUE UMA CHAMADA, E NÃO O TRIO prepare/PUT/confirm. O par
// prepare-upload/confirm-upload existe para o PLUGIN, e a sessão entre eles
// cobre uma janela real: ali o servidor reserva o destino, o cliente copia os
// bytes por SMB por conta própria, e volta depois para confirmar. Aqui os bytes
// vêm DENTRO da requisição -- não há janela entre reservar e gravar, e portanto
// não há o que a sessão cobrir. Com sessão, todo envio abandonado vira linha
// pendurada em `upload_session` e `.parcial` no volume.
//
// O que se perde: reenviar SÓ o arquivo que falhou. Com uma chamada, a queda no
// meio custa o envio inteiro. É aceitável porque o teto do caminho web é de
// poucos GB (`UPLOAD_WEB_MAX_GB`); acima disso o caminho continua sendo o
// plugin, que copia direto para o volume.
//
// O NOME FÍSICO NÃO VEM DO CLIENTE. Ele sai de `acervo.nome_arquivo_padrao`, a
// mesma função que o invariante `7a` usa para auditar: auditor e escritor são a
// mesma regra. Deixar o cliente nomear produz uma linha de DEFECT no `7a` a
// cada envio.
//
// ORDEM DAS PARTES DO MULTIPART: o campo `dados` tem de vir ANTES dos arquivos.
// O destino de cada byte sai dos metadados, e eles são lidos enquanto o corpo
// ainda está chegando: arquivo que chegasse antes não teria para onde ir. O
// `FormData` preserva a ordem do `append`, então quem envia controla isso; parte
// fora de ordem é recusada com a razão, e não ignorada.

const multer = require('multer')
const fs = require('fs')
const fsPromises = require('fs').promises
const path = require('path')
const crypto = require('crypto')
const { Transform, pipeline } = require('stream')
const { promisify } = require('util')

const pipelineAsync = promisify(pipeline)

const { db } = require('../database')
const config = require('../config')
const {
  AppError,
  httpCode,
  logger,
  domainConstants: { TIPO_ARQUIVO }
} = require('../utils')
const { conferirIdentidadeLivre } = require('../utils/identidade_produto')

const { caminhoNoVolume, motivoCaminhoInseguro } = require('../utils/caminho_volume')
const arquivoSchema = require('./arquivo_schema')

/** Sufixo do arquivo AINDA INCOMPLETO. Ver `promoverArquivos`. */
const SUFIXO_PARCIAL = '.parcial'

/** Blocos de 8 MB: o destino é um share, e ali o custo é de rede. */
const BLOCO_ESCRITA = 8 * 1024 * 1024

const tetoEmBytes = () => Number(config.UPLOAD_WEB_MAX_GB) * 1024 * 1024 * 1024

const mensagemDeTeto = () =>
  `Arquivo maior que o teto de ${config.UPLOAD_WEB_MAX_GB} GB do envio pelo navegador. ` +
  'Arquivo desse tamanho entra pelo plugin do QGIS, que copia direto para o volume ' +
  'sem passar pelo servidor.'

/**
 * Extensão do arquivo que subiu, sem o ponto e em minúsculas.
 *
 * Sai do NOME DO ARQUIVO enviado, e não de um campo do corpo: quem declara a
 * extensão declara o que o byte é, e o byte já veio. Declarada, ela poderia
 * dizer `tif` num PDF, e o acervo passaria a prometer um formato que não tem.
 */
const extensaoDe = (nomeOriginal) => {
  const ext = path.extname(nomeOriginal || '').replace(/^\./, '').toLowerCase()
  return ext || null
}

/**
 * O plano do envio: onde cada arquivo vai parar, e sob que nome.
 *
 * Roda UMA vez, quando a primeira parte de arquivo chega, e antes de qualquer
 * byte tocar o disco. Tudo que se recusa sem ler byte se recusa aqui: produto
 * inexistente, versão repetida, sequência de versão, volume sem primário, nome
 * padrão não computável e colisão de nome físico.
 */
const construirPlano = async (dados, contexto) => {
  const { tipo } = contexto

  return db.conn.task(async t => {
    // ---- de onde saem os metadados do produto e da versão ----
    let produto
    let versao

    let versaoExistenteId = null

    if (tipo === 'arquivos') {
      // Versão e produto já estão gravados: aqui só se acrescenta arquivo.
      // Os apelidos são obrigatórios: `subtipo_produto_id` existe nas DUAS
      // tabelas, e sem separá-los o do produto (quase sempre NULL) sobrescreve o
      // da versão no objeto da linha. O nome padrão sairia NULL, e a rota
      // recusaria o envio dizendo que o metadado está fora do padrão -- com o
      // metadado inteiro correto.
      const linha = await t.oneOrNone(
        `SELECT v.id AS versao_id, v.versao AS versao_rotulo,
                v.subtipo_produto_id AS versao_subtipo, v.tipo_versao_id,
                p.id, p.nome, p.mi, p.inom, p.tipo_produto_id,
                p.subtipo_produto_id AS produto_subtipo,
                p.tipo_escala_id, p.denominador_escala_especial
         FROM acervo.versao v
         JOIN acervo.produto p ON p.id = v.produto_id
         WHERE v.id = $1`,
        [dados.versao_id]
      )
      if (!linha) {
        throw new AppError(`Versão ${dados.versao_id} não encontrada`, httpCode.NotFound)
      }

      versaoExistenteId = Number(linha.versao_id)
      produto = { ...linha, subtipo_produto_id: linha.produto_subtipo }
      // O nome padrão precisa do rótulo e do subtipo DA VERSÃO, e os dois vêm do
      // banco: a rota não os aceita do cliente, para não editar o que não é dela.
      versao = { versao: linha.versao_rotulo, subtipo_produto_id: linha.versao_subtipo }
    } else if (tipo === 'versao') {
      produto = await t.oneOrNone(
        `SELECT id, nome, mi, inom, tipo_produto_id, subtipo_produto_id,
                tipo_escala_id, denominador_escala_especial
         FROM acervo.produto WHERE id = $1`,
        [dados.produto_id]
      )
      if (!produto) {
        throw new AppError(`Produto ${dados.produto_id} não encontrado`, httpCode.NotFound)
      }
      versao = dados.versao

      const repetida = await t.oneOrNone(
        'SELECT id FROM acervo.versao WHERE produto_id = $1 AND versao = $2',
        [produto.id, versao.versao]
      )
      if (repetida) {
        throw new AppError(
          `Já existe a versão "${versao.versao}" para o produto ${produto.id}`,
          httpCode.Conflict
        )
      }
    } else {
      produto = dados.produto
      versao = dados.versao

      // Identidade do produto: espelha `unique_produto_identidade` com erro
      // legível, em vez de deixar o índice estourar depois dos bytes. A regra
      // mora em `utils/identidade_produto.js` porque vale para TODO caminho de
      // cadastro, e não só para este.
      await conferirIdentidadeLivre(t, produto)
    }

    // ---- volume ----
    //
    // Não vem do cliente. No `catalogar/product` ele vem, porque lá o arquivo já
    // está em algum volume e o cliente diz em qual; aqui o servidor é quem
    // escolhe para onde copiar, e essa escolha é do acervo.
    //
    // Acrescentando arquivo a uma versão que já tem outros, o volume é o DELES, e
    // não o primário do tipo: o primário pode ter mudado depois, e a versão
    // ficaria partida entre dois volumes. Isso importa mais do que parece --
    // a unicidade de nome físico é POR VOLUME, então metade da versão num volume
    // e metade noutro deixa de ser protegida contra colisão de nome.
    let volume = null

    if (versaoExistenteId !== null) {
      const volumes = await t.any(
        `SELECT DISTINCT va.id, va.nome, va.volume
         FROM acervo.arquivo a
         JOIN acervo.volume_armazenamento va ON va.id = a.volume_armazenamento_id
         WHERE a.versao_id = $1`,
        [versaoExistenteId]
      )
      if (volumes.length > 1) {
        throw new AppError(
          `Os arquivos desta versão estão espalhados por ${volumes.length} volumes ` +
          `(${volumes.map(v => v.nome).join(', ')}). Junte-os antes de acrescentar outro: ` +
          'a unicidade do nome físico vale por volume.',
          httpCode.Conflict
        )
      }
      if (volumes.length === 1) volume = volumes[0]
    }

    if (!volume) {
      volume = await t.oneOrNone(
        `SELECT va.id, va.nome, va.volume
         FROM acervo.volume_tipo_produto vtp
         JOIN acervo.volume_armazenamento va ON va.id = vtp.volume_armazenamento_id
         WHERE vtp.tipo_produto_id = $1 AND vtp.primario = TRUE`,
        [produto.tipo_produto_id]
      )
    }

    if (!volume) {
      throw new AppError(
        `Não existe volume primário cadastrado para o tipo de produto ${produto.tipo_produto_id}`,
        httpCode.BadRequest
      )
    }

    // ---- o nome físico, derivado dos metadados ----
    const { nome_padrao: nomePadrao } = await t.one(
      // Os casts sao obrigatorios: a funcao e declarada com `smallint` e
      // `varchar`, o driver manda `integer` e `unknown`, e o Postgres nao resolve
      // a sobrecarga sozinho ("nenhuma funcao corresponde com o nome e os tipos").
      `SELECT acervo.nome_arquivo_padrao(
         $1::smallint, $2::smallint, $3::varchar, $4::varchar, $5::varchar,
         $6::smallint, $7::integer, $8::varchar
       ) AS nome_padrao`,
      [
        produto.tipo_produto_id,
        versao.subtipo_produto_id,
        produto.mi ?? null,
        produto.inom ?? null,
        produto.nome ?? null,
        produto.tipo_escala_id,
        produto.denominador_escala_especial ?? null,
        versao.versao
      ]
    )

    // NULL não é "sem nome": é metadado que não descreve uma folha. Gravar assim
    // criaria de saída uma linha do invariante 7b, e um arquivo que a rota de
    // renome não conseguiria consertar depois.
    if (!nomePadrao) {
      throw new AppError(
        'O nome físico padrão não é computável com estes metadados: o rótulo da versão ' +
        `("${versao.versao}") ou a identificação do produto (MI, INOM ou nome) está fora ` +
        'do padrão. Corrija antes de enviar os arquivos; é o mesmo que o invariante 7b cobra.',
        httpCode.BadRequest
      )
    }

    const motivo = motivoCaminhoInseguro(`${nomePadrao}.ext`)
    if (motivo) {
      throw new AppError(
        `O nome físico derivado dos metadados ${motivo}: "${nomePadrao}"`,
        httpCode.BadRequest
      )
    }

    return {
      tipo,
      produto,
      versao,
      versaoExistenteId,
      arquivos: dados.arquivos,
      volume,
      nomePadrao,
      // Extensões já usadas nesta requisição, para a segunda ocorrência não
      // sobrescrever a primeira em silêncio. Ver `destinoDoArquivo`.
      extensoesUsadas: new Map(),
      gravados: []
    }
  })
}

/**
 * O destino deste arquivo, e as recusas que dependem dele.
 *
 * O nome é o mesmo para todos os arquivos da versão, e quem os distingue é a
 * EXTENSÃO -- é assim que `acervo.nome_arquivo_padrao` foi desenhada (ela não
 * recebe `tipo_arquivo_id`) e é assim que a unicidade física está declarada no
 * banco, sobre `(volume, nome_arquivo, extensao)`.
 *
 * Consequência que a tela precisa dizer: dois arquivos da MESMA versão com a
 * MESMA extensão não cabem no padrão. Aqui isso é recusa, e não um sufixo
 * inventado: um `_2` faria este código nomear diferente do que o `renomear-padrao`
 * e o invariante `7a` esperam, e a próxima auditoria acusaria o que acabou de ser
 * gravado.
 */
const destinoDoArquivo = async (plano, indice, nomeOriginal) => {
  const declarado = plano.arquivos[indice]
  if (!declarado) {
    throw new AppError(
      `Chegou um arquivo a mais do que os ${plano.arquivos.length} descritos no campo "dados".`,
      httpCode.BadRequest
    )
  }

  const extensao = extensaoDe(nomeOriginal)
  if (!extensao) {
    throw new AppError(
      `O arquivo "${nomeOriginal}" não tem extensão, e é ela que distingue os arquivos ` +
      'de uma mesma versão no volume.',
      httpCode.BadRequest
    )
  }

  const jaUsada = plano.extensoesUsadas.get(extensao)
  if (jaUsada !== undefined) {
    throw new AppError(
      `Dois arquivos desta versão têm a extensão "${extensao}" ("${jaUsada}" e ` +
      `"${nomeOriginal}"). O nome físico padrão é um só por versão, e quem separa os ` +
      'arquivos é a extensão, então os dois receberiam o mesmo nome. Envie um deles ' +
      'noutra versão, ou converta um dos formatos.',
      httpCode.Conflict
    )
  }
  plano.extensoesUsadas.set(extensao, nomeOriginal)

  const livre = await db.conn.oneOrNone(
    `SELECT id FROM acervo.arquivo
     WHERE volume_armazenamento_id = $1 AND lower(nome_arquivo) = lower($2)
       AND lower(extensao) = lower($3) LIMIT 1`,
    [plano.volume.id, plano.nomePadrao, extensao]
  )
  if (livre) {
    throw new AppError(
      `Já existe no volume ${plano.volume.nome} um arquivo "${plano.nomePadrao}.${extensao}" ` +
      `(id ${livre.id}). O nome físico é derivado dos metadados, então isto quer dizer que ` +
      'esta versão deste produto já tem um arquivo deste formato.',
      httpCode.Conflict
    )
  }

  const destino = caminhoNoVolume(plano.volume.volume, `${plano.nomePadrao}.${extensao}`)
  return { declarado, extensao, destino, caminhoParcial: destino + SUFIXO_PARCIAL }
}

/**
 * Storage do multer que grava no `.parcial` e MEDE no mesmo passo.
 *
 * `diskStorage` não serve: ele grava e devolve o caminho, e o SHA-256 exigiria
 * ler o arquivo DE NOVO -- a segunda leitura que a catalogação in-place existiu
 * para remover. Aqui o byte passa pelo processo uma vez só, e o mesmo fluxo que
 * escreve alimenta o hash.
 *
 * O hash entra por um `Transform` no MEIO do cano, e não por um `on('data')` ao
 * lado do `pipe`: com dois consumidores do mesmo fluxo, a ordem entre "entrar em
 * modo fluente" e "conectar o pipe" passa a importar, e um pedaço perdido daria
 * checksum errado sem erro nenhum.
 */
const storageNoVolume = {
  _handleFile (req, file, cb) {
    planoDaRequisicao(req)
      .then(async (plano) => {
        const indice = req._indiceArquivoWeb || 0
        req._indiceArquivoWeb = indice + 1

        const { declarado, extensao, destino, caminhoParcial } =
          await destinoDoArquivo(plano, indice, file.originalname)

        // `file.path` é o que o multer passa para `_removeFile` ao abortar
        // (teto estourado, conexão caída). Sem ele, o `.parcial` do envio
        // interrompido ficaria no volume.
        file.path = caminhoParcial

        const hash = crypto.createHash('sha256')
        let bytes = 0
        const medidor = new Transform({
          transform (pedaco, _codificacao, proximo) {
            hash.update(pedaco)
            bytes += pedaco.length
            proximo(null, pedaco)
          }
        })

        // A subpasta é legítima e `createWriteStream` não a cria. `flags: 'w'`
        // trunca: `.parcial` de tentativa anterior é sobrescrito, nunca
        // continuado -- retomada parcial exigiria saber que os bytes já
        // gravados são os mesmos deste envio, e ninguém sabe disso.
        await fsPromises.mkdir(path.dirname(caminhoParcial), { recursive: true })
        const saida = fs.createWriteStream(caminhoParcial, {
          flags: 'w',
          highWaterMark: BLOCO_ESCRITA
        })
        await pipelineAsync(file.stream, medidor, saida)

        // O teto do multer TRUNCA o fluxo em vez de derrubá-lo: o busboy para de
        // emitir e marca `truncated`. Sem esta checagem o `pipeline` terminaria
        // normalmente, e o arquivo entraria no acervo pela metade -- com um
        // checksum calculado sobre a metade, portanto "válido" para sempre. É o
        // pior modo de falhar que este caminho tem, porque nada depois o acusa.
        if (file.stream.truncated) {
          throw new AppError(mensagemDeTeto(), httpCode.BadRequest)
        }

        const medida = {
          declarado,
          extensao,
          destino,
          caminhoParcial,
          nome_arquivo: plano.nomePadrao,
          checksum: hash.digest('hex'),
          bytes,
          tamanho_mb: bytes / (1024 * 1024)
        }
        plano.gravados.push(medida)
        cb(null, medida)
      })
      .catch(cb)
  },

  _removeFile (req, file, cb) {
    const caminho = file.path
    delete file.path
    // Ausente não é erro: o abort pode ter acontecido antes de a escrita começar.
    fs.unlink(caminho, erro => cb(erro && erro.code !== 'ENOENT' ? erro : null))
  }
}

/**
 * Lê e valida o campo `dados`, e monta o plano. Memorizado por requisição.
 *
 * A validação do corpo NÃO passa pelo `schemaValidation` da rota: ele roda antes
 * do multer, e antes do multer o corpo multipart ainda não foi parseado. Por
 * isso o Joi é chamado aqui, com o mesmo schema, assim que o campo existe.
 */
const planoDaRequisicao = (req) => {
  if (req._planoWeb) return req._planoWeb

  req._planoWeb = (async () => {
    const bruto = req.body && req.body.dados
    if (!bruto) {
      throw new AppError(
        'O campo "dados" não chegou antes dos arquivos. Ele descreve o produto, a versão ' +
        'e os arquivos, e é dele que sai o destino de cada byte: mande-o como a PRIMEIRA ' +
        'parte do multipart.',
        httpCode.BadRequest
      )
    }

    let json
    try {
      json = JSON.parse(bruto)
    } catch {
      throw new AppError('O campo "dados" não é um JSON válido', httpCode.BadRequest)
    }

    const schema = {
      versao: arquivoSchema.uploadWebVersao,
      produto: arquivoSchema.uploadWebProduto,
      arquivos: arquivoSchema.uploadWebArquivos
    }[req._tipoEnvioWeb]

    const { error, value } = schema.validate(json, { abortEarly: false, stripUnknown: true })
    if (error) {
      throw new AppError(
        `Campo "dados" inválido: ${error.details.map(d => d.message).join('; ')}`,
        httpCode.BadRequest
      )
    }

    return construirPlano(value, { tipo: req._tipoEnvioWeb })
  })()

  return req._planoWeb
}

/**
 * Recebe o multipart. `dados` no campo de texto, arquivos no campo "arquivos".
 *
 * O multer é construído A CADA requisição porque o teto é lido do config na
 * hora: congelado no `require`, o ajuste em produção (e o teste) passaria a
 * mentir. O objeto é barato.
 */
const receberMultipart = (tipo) => (req, res, next) => {
  req._tipoEnvioWeb = tipo

  const middleware = multer({
    storage: storageNoVolume,
    limits: { fileSize: tetoEmBytes(), files: 50 }
  }).array('arquivos', 50)

  middleware(req, res, erro => {
    if (!erro) return next()
    if (erro instanceof multer.MulterError) {
      const mensagem =
        erro.code === 'LIMIT_FILE_SIZE'
          ? mensagemDeTeto()
          : `Erro no envio do arquivo: ${erro.message}`
      return next(new AppError(mensagem, httpCode.BadRequest, erro))
    }
    return next(erro)
  })
}

/** Recusa antes de receber o corpo, quando o navegador declara o tamanho. */
const conferirTamanhoDeclarado = (req, res, next) => {
  const declarado = Number(req.headers['content-length'])
  const teto = tetoEmBytes()
  // A folga cobre o envelope do multipart (cabeçalho de cada parte,
  // delimitadores) e o campo `dados`, que viajam junto e não são do arquivo.
  if (Number.isFinite(declarado) && declarado > teto + 1024 * 1024) {
    return next(new AppError(
      `${mensagemDeTeto()} Recebido: ${(declarado / (1024 ** 3)).toFixed(2)} GB.`,
      httpCode.BadRequest
    ))
  }
  return next()
}

const uploadWebVersao = [conferirTamanhoDeclarado, receberMultipart('versao')]
const uploadWebProduto = [conferirTamanhoDeclarado, receberMultipart('produto')]
const uploadWebArquivos = [conferirTamanhoDeclarado, receberMultipart('arquivos')]

/**
 * Apaga os `.parcial` que este envio deixou.
 *
 * Só os `.parcial`: arquivo já promovido ao nome definitivo saiu do domínio
 * desta função. Falha ao apagar vira log, nunca erro da requisição -- o envio já
 * falhou por outro motivo, e derrubá-lo de novo por causa de um temporário
 * teimoso só esconderia a causa real.
 */
const limparParciais = async (plano, contexto = {}) => {
  if (!plano || !plano.gravados) return
  for (const g of plano.gravados) {
    try {
      await fsPromises.unlink(g.caminhoParcial)
    } catch (erro) {
      if (erro.code === 'ENOENT') continue
      logger.warn('Não foi possível apagar arquivo parcial de upload web', {
        ...contexto, caminho: g.caminhoParcial, erro: erro.message
      })
    }
  }
}

// Só o que `arquivo_route.js` consome. Saíram daqui `extensaoDe` e
// `SUFIXO_PARCIAL`, que nunca tiveram chamador fora deste arquivo, e o
// reexporte de `TIPO_ARQUIVO`, que é constante de domínio: quem precisa dela a
// importa de `utils/domain_constants`, e não deste módulo de upload.
module.exports = {
  uploadWebVersao,
  uploadWebProduto,
  uploadWebArquivos,
  planoDaRequisicao,
  limparParciais
}

// Path: ponto_controle\upload_ctrl.js
'use strict'

const fs = require('fs').promises
const fsClassic = require('fs')
const path = require('path')
const crypto = require('crypto')

const { db } = require('../database')
const {
  AppError,
  httpCode,
  domainConstants: { TIPO_PRODUTO }
} = require('../utils')

const controller = {}

/**
 * `tipo_situacao` 3 = Aprovado, e o valor sai do DDL, nunca do nome do campo.
 * Ver `er/ponto_controle.sql`: 1 Nao medido, 2 Aguardando revisao, 3 Aprovado,
 * 4 Reprovado. Trocar 3 por 4 aqui deixaria entrar exatamente o oposto, e sem
 * erro nenhum.
 */
const SITUACAO_APROVADO = 3

const OPERACAO = 'importar_missao'

// Colunas que a importação NUNCA aceita do cliente. O id é a chave local, o
// cod_ponto e a posição vêm fora de `atributos`, e as de auditoria são do
// servidor.
const NAO_VEM_DO_CLIENTE = new Set([
  'id',
  'cod_ponto',
  'lote_id',
  'geom',
  'data_cadastramento',
  'usuario_cadastramento_uuid',
  'data_modificacao',
  'usuario_modificacao_uuid'
])

/**
 * SHA-256 e tamanho real do arquivo, por streaming.
 *
 * Igual ao de arquivo_ctrl.js, e por streaming pela mesma razão: um RINEX de
 * missão passa de centenas de MB, e ler tudo em memória derrubaria o processo.
 *
 * @param {string} caminho
 * @returns {Promise<{checksum:string, tamanhoMb:number}>}
 */
const checksumDoArquivo = caminho => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    let bytes = 0
    const fluxo = fsClassic.createReadStream(caminho)
    fluxo.on('data', pedaco => {
      hash.update(pedaco)
      bytes += pedaco.length
    })
    fluxo.on('end', () =>
      resolve({ checksum: hash.digest('hex'), tamanhoMb: bytes / (1024 * 1024) })
    )
    fluxo.on('error', reject)
  })
}

// Lê do BANCO quais colunas ponto_controle.ponto tem hoje. Ler daqui, e não de
// uma lista no código, é o que faz um campo novo do plugin aparecer sozinho
// depois da migração, e o que permite RELATAR a coluna que o arquivo trouxe e a
// tabela não tem, em vez de descartá-la em silêncio.
const colunasDoPonto = async connection => {
  const linhas = await connection.any(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'ponto_controle' AND table_name = 'ponto'`
  )
  return new Set(linhas.map(l => l.column_name))
}

/**
 * O volume primário do ponto de controle.
 *
 * Sai de acervo.volume_tipo_produto pelo tipo_produto 10, que é a mesma
 * infraestrutura do resto do acervo. O tipo 10 não pode virar acervo.produto (o
 * CHECK barra), mas continua servindo para dizer ONDE o arquivo mora.
 */
const volumeDoPontoControle = async connection => {
  const volume = await connection.oneOrNone(
    `SELECT vtp.volume_armazenamento_id, va.volume, va.capacidade_gb
     FROM acervo.volume_tipo_produto AS vtp
     INNER JOIN acervo.volume_armazenamento AS va
       ON va.id = vtp.volume_armazenamento_id
     WHERE vtp.tipo_produto_id = $<tipo> AND vtp.primario IS TRUE`,
    { tipo: TIPO_PRODUTO.PONTO_CONTROLE }
  )
  if (!volume) {
    throw new AppError(
      'Não existe volume primário cadastrado para ponto de controle (tipo de produto 10)',
      httpCode.BadRequest
    )
  }
  return volume
}

/**
 * FASE 1. Confere a missão inteira, reserva a sessão e devolve, por arquivo,
 * PARA ONDE copiá-lo.
 *
 * Nada entra em ponto_controle.ponto aqui. O que este passo grava são as
 * tabelas temporárias, exatamente como o prepare-upload do acervo: quem importa
 * recebe o session_uuid e os caminhos, transfere os arquivos ao volume, e só
 * então chama o confirm.
 *
 * A divisão em duas fases existe porque a missão pesa. Uma de 100 pontos passa
 * de 300 MB, e recusar no fim de uma transferência longa por um cod_ponto
 * repetido é o pior momento possível para descobrir isso.
 */
controller.prepararMissao = async (
  { lote_id: loteId, substituir, pontos },
  usuarioUuid
) => {
  return db.conn.tx(async t => {
    const lote = await t.oneOrNone(
      'SELECT id FROM acervo.lote WHERE id = $<loteId>',
      { loteId }
    )
    if (!lote) {
      throw new AppError(`Lote ${loteId} não existe`, httpCode.BadRequest)
    }

    // O volume só é exigido quando há arquivo. Missão que traz apenas as
    // coordenadas (ponto planejado, ainda sem documentação) é caso legítimo, e
    // pedir volume para gravar duas casas decimais seria acoplamento à toa.
    const temArquivo = pontos.some(p => p.arquivos && p.arquivos.length > 0)
    const volume = temArquivo ? await volumeDoPontoControle(t) : null

    const colunas = await colunasDoPonto(t)

    const tiposArquivo = new Map(
      (await t.any(
        'SELECT code, nome, maximo_por_ponto FROM ponto_controle.tipo_arquivo'
      )).map(x => [x.code, x])
    )

    const relatorio = {
      pontos_novos: [],
      pontos_substituidos: [],
      recusados: [],
      colunas_ignoradas: new Set()
    }

    // Conferências que NÃO dependem do banco vêm antes de qualquer INSERT: um
    // cod_ponto repetido dentro do próprio arquivo é erro de quem gerou o
    // pacote, e recusar a missão inteira é mais honesto do que importar metade.
    const codigos = pontos.map(p => p.cod_ponto)
    const repetido = codigos.find((c, i) => codigos.indexOf(c) !== i)
    if (repetido) {
      throw new AppError(
        `O pacote traz o ponto ${repetido} mais de uma vez`,
        httpCode.BadRequest
      )
    }

    const sessao = await t.one(
      `INSERT INTO ponto_controle.upload_session
         (operation_type, lote_id, substituir, usuario_uuid)
       VALUES ($<operacao>, $<loteId>, $<substituir>, $<usuarioUuid>)
       RETURNING id, uuid_session`,
      { operacao: OPERACAO, loteId, substituir, usuarioUuid }
    )

    const arquivosInfo = []
    // Dois pontos da mesma missão podem ter arquivo de mesmo nome (foto_1.jpg).
    // O caminho leva o cod_ponto justamente por isso; esta chave é o que prova
    // que a regra bastou.
    const caminhosUsados = new Set()

    for (const entrada of pontos) {
      const {
        cod_ponto: codPonto,
        latitude,
        longitude,
        atributos,
        arquivos
      } = entrada

      const aceitos = {}
      for (const [chave, valor] of Object.entries(atributos)) {
        if (NAO_VEM_DO_CLIENTE.has(chave)) continue
        if (!colunas.has(chave)) {
          relatorio.colunas_ignoradas.add(chave)
          continue
        }
        aceitos[chave] = valor
      }

      // SÓ PONTO APROVADO ENTRA NO ACERVO (chefe, 2026-07-29).
      //
      // O acervo é o que a tropa consulta para AJUSTAR trabalho, e ponto não
      // revisado ali é pior do que ponto nenhum: quem consulta não distingue
      // "medido" de "conferido" e usa mesmo assim. A revisão é do fluxo de
      // campo, e acontece antes, no plugin.
      //
      // Recusa o PONTO e segue, em vez de derrubar a missão: missão com mistura
      // é caso normal, e a parte aprovada dela é acervo legítimo. O motivo volta
      // em `recusados`, que é como quem importa fica sabendo.
      if (Number(aceitos.tipo_situacao) !== SITUACAO_APROVADO) {
        relatorio.recusados.push({
          cod_ponto: codPonto,
          motivo: 'só ponto APROVADO entra no acervo; revise antes de importar'
        })
        continue
      }

      const existente = await t.oneOrNone(
        'SELECT id FROM ponto_controle.ponto WHERE cod_ponto = $<codPonto>',
        { codPonto }
      )

      if (existente && !substituir) {
        relatorio.recusados.push({
          cod_ponto: codPonto,
          motivo: 'já existe no acervo; envie substituir=true para sobrescrever'
        })
        continue
      }

      // Quantos arquivos de cada tipo o ponto pode ter. A coluna
      // `maximo_por_ponto` existe no domínio desde o começo; é aqui que ela
      // passa a valer, e não numa conferência manual depois da importação.
      const porTipo = new Map()
      for (const arquivo of arquivos) {
        const tipo = tiposArquivo.get(arquivo.tipo_arquivo_id)
        if (!tipo) {
          throw new AppError(
            `Tipo de arquivo ${arquivo.tipo_arquivo_id} não existe (ponto ${codPonto})`,
            httpCode.BadRequest
          )
        }
        porTipo.set(tipo.code, (porTipo.get(tipo.code) || 0) + 1)
      }
      for (const [code, quantos] of porTipo) {
        const tipo = tiposArquivo.get(code)
        if (tipo.maximo_por_ponto !== null && quantos > tipo.maximo_por_ponto) {
          throw new AppError(
            `O ponto ${codPonto} traz ${quantos} arquivos de "${tipo.nome}", e o máximo é ${tipo.maximo_por_ponto}`,
            httpCode.BadRequest
          )
        }
      }

      const checksums = arquivos.map(a => a.checksum)
      const checksumRepetido = checksums.find((c, i) => checksums.indexOf(c) !== i)
      if (checksumRepetido) {
        throw new AppError(
          `O ponto ${codPonto} traz o mesmo arquivo duas vezes (checksum ${checksumRepetido.slice(0, 12)}…)`,
          httpCode.BadRequest
        )
      }

      const pontoTemp = await t.one(
        `INSERT INTO ponto_controle.upload_ponto_temp
           (session_id, cod_ponto, latitude, longitude, atributos, ponto_id)
         VALUES ($<sessionId>, $<codPonto>, $<latitude>, $<longitude>,
                 $<atributos>, $<pontoId>)
         RETURNING id`,
        {
          sessionId: sessao.id,
          codPonto,
          latitude,
          longitude,
          atributos: aceitos,
          pontoId: existente ? existente.id : null
        }
      )

      for (const arquivo of arquivos) {
        // Uma pasta por ponto. Sem isso, `foto_1.jpg` de dois pontos ocuparia o
        // mesmo caminho e um sobrescreveria o outro em silêncio no volume.
        const nomeFisico = arquivo.extensao
          ? `${arquivo.nome_arquivo}.${arquivo.extensao}`
          : arquivo.nome_arquivo
        const destino = path.join(volume.volume, codPonto, nomeFisico)

        if (caminhosUsados.has(destino)) {
          throw new AppError(
            `Dois arquivos do ponto ${codPonto} iriam para o mesmo caminho: ${destino}`,
            httpCode.BadRequest
          )
        }
        caminhosUsados.add(destino)

        await t.none(
          `INSERT INTO ponto_controle.upload_arquivo_temp
             (session_id, ponto_temp_id, tipo_arquivo_id, nome_arquivo, extensao,
              destination_path, volume_armazenamento_id, tamanho_mb,
              expected_checksum, metadado)
           VALUES ($<sessionId>, $<pontoTempId>, $<tipo_arquivo_id>,
                   $<nome_arquivo>, $<extensao>, $<destino>, $<volumeId>,
                   $<tamanho_mb>, $<checksum>, $<metadado>)`,
          {
            sessionId: sessao.id,
            pontoTempId: pontoTemp.id,
            destino,
            volumeId: volume.volume_armazenamento_id,
            extensao: null,
            tamanho_mb: null,
            metadado: null,
            ...arquivo
          }
        )

        arquivosInfo.push({
          cod_ponto: codPonto,
          tipo_arquivo_id: arquivo.tipo_arquivo_id,
          nome_arquivo: arquivo.nome_arquivo,
          extensao: arquivo.extensao || null,
          checksum: arquivo.checksum,
          destination_path: destino
        })
      }

      if (existente) relatorio.pontos_substituidos.push(codPonto)
      else relatorio.pontos_novos.push(codPonto)
    }

    // Espaço no volume. A conta usa o tamanho DECLARADO, que é só uma
    // estimativa; o tamanho real entra no confirm, medido no disco.
    const declarado = pontos
      .flatMap(p => p.arquivos || [])
      .reduce((soma, a) => soma + (a.tamanho_mb || 0), 0)
    if (volume && declarado > 0) {
      const espaco = await t.one(
        `SELECT (va.capacidade_gb - COALESCE(SUM(a.tamanho_mb), 0) / 1024)
                  AS disponivel_gb
         FROM acervo.volume_armazenamento AS va
         LEFT JOIN ponto_controle.arquivo AS a
           ON a.volume_armazenamento_id = va.id
         WHERE va.id = $<volumeId>
         GROUP BY va.id, va.capacidade_gb`,
        { volumeId: volume.volume_armazenamento_id }
      )
      const precisaGb = declarado / 1024
      if (Number(espaco.disponivel_gb) < precisaGb) {
        throw new AppError(
          `Espaço insuficiente no volume ${volume.volume}. Necessário: ${precisaGb.toFixed(2)} GB, disponível: ${Number(espaco.disponivel_gb).toFixed(2)} GB`,
          httpCode.BadRequest
        )
      }
    }

    relatorio.colunas_ignoradas = [...relatorio.colunas_ignoradas].sort()

    return {
      session_uuid: sessao.uuid_session,
      operation_type: OPERACAO,
      volume: volume ? volume.volume : null,
      ...relatorio,
      arquivos: arquivosInfo
    }
  })
}

/**
 * FASE 2. Lê cada arquivo NO VOLUME, confere o checksum e só então grava.
 *
 * É aqui que a importação para de acreditar no que o cliente disse. O checksum
 * que veio no manifesto é uma AFIRMAÇÃO; o que vale é o SHA-256 recalculado
 * sobre o arquivo que chegou. O tamanho gravado é o medido, e não o declarado.
 *
 * DUAS TRANSAÇÕES, e não uma. A primeira confere e GRAVA o diagnóstico arquivo
 * por arquivo; a segunda grava os pontos. Fazer tudo numa só custou caro: o
 * rollback levava junto o `error_message` de cada arquivo, e quem importou
 * ficava com uma sessão 'pending' sem nenhuma pista de qual arquivo faltou.
 *
 * Falha de conferência NÃO vira exceção, pelo mesmo motivo do confirm-upload do
 * acervo: ela é um RESULTADO da importação, e o relatório por arquivo é a parte
 * útil da resposta. A rota devolve success=false com ele.
 *
 * Um arquivo que falta ou que não bate derruba a missão inteira, e não só ele:
 * ponto de controle com metade das fotos é pior do que ponto nenhum, porque
 * parece completo na tela.
 */
controller.confirmarMissao = async (sessionUuid, usuarioUuid) => {
  // --- Transação 1: conferir no destino e gravar o diagnóstico ---------------
  const conferencia = await db.conn.tx(async t => {
    const sessao = await t.oneOrNone(
      `SELECT * FROM ponto_controle.upload_session
       WHERE uuid_session = $<sessionUuid> AND status = 'pending'`,
      { sessionUuid }
    )
    if (!sessao) {
      throw new AppError(
        'Sessão de importação não encontrada ou já processada',
        httpCode.NotFound
      )
    }
    if (sessao.usuario_uuid !== usuarioUuid) {
      throw new AppError(
        'Usuário não autorizado para esta sessão de importação',
        httpCode.Forbidden
      )
    }

    const arquivosTemp = await t.any(
      'SELECT * FROM ponto_controle.upload_arquivo_temp WHERE session_id = $<id>',
      { id: sessao.id }
    )

    if (new Date(sessao.expiration_time) < new Date()) {
      await t.none(
        `UPDATE ponto_controle.upload_session
         SET status = 'failed', error_message = 'Sessão expirada',
             completed_at = NOW()
         WHERE id = $<id>`,
        { id: sessao.id }
      )
      return { sessao, expirada: true, problemas: [], medidos: new Map(), arquivosTemp }
    }

    const problemas = []
    const medidos = new Map()

    for (const arquivo of arquivosTemp) {
      let erro = null
      try {
        await fs.access(arquivo.destination_path)
        const { checksum, tamanhoMb } = await checksumDoArquivo(
          arquivo.destination_path
        )
        if (checksum !== arquivo.expected_checksum) {
          erro = `Checksum não confere para ${arquivo.destination_path}`
        } else {
          medidos.set(String(arquivo.id), tamanhoMb)
        }
      } catch (e) {
        erro = `Arquivo não encontrado no volume: ${arquivo.destination_path}`
      }

      await t.none(
        `UPDATE ponto_controle.upload_arquivo_temp
         SET status = $<status>, error_message = $<erro>,
             tamanho_mb = COALESCE($<tamanho>, tamanho_mb)
         WHERE id = $<id>`,
        {
          id: arquivo.id,
          status: erro ? 'failed' : 'completed',
          erro,
          tamanho: medidos.has(String(arquivo.id))
            ? medidos.get(String(arquivo.id))
            : null
        }
      )

      if (erro) {
        problemas.push({
          nome_arquivo: arquivo.nome_arquivo,
          destination_path: arquivo.destination_path,
          erro
        })
      }
    }

    if (problemas.length > 0) {
      await t.none(
        `UPDATE ponto_controle.upload_session
         SET status = 'failed', error_message = $<mensagem>, completed_at = NOW()
         WHERE id = $<id>`,
        {
          id: sessao.id,
          mensagem: `${problemas.length} arquivo(s) não passaram na conferência`
        }
      )
    }

    return { sessao, expirada: false, problemas, medidos, arquivosTemp }
  })

  const relatorioVazio = motivo => ({
    session_uuid: sessionUuid,
    status: 'failed',
    error_message: motivo,
    problemas: conferencia.problemas,
    inseridos: [],
    substituidos: [],
    arquivos_novos: 0,
    arquivos_repetidos: 0
  })

  if (conferencia.expirada) return relatorioVazio('Sessão expirada')
  if (conferencia.problemas.length > 0) {
    return relatorioVazio(
      `${conferencia.problemas.length} arquivo(s) não passaram na conferência`
    )
  }

  // --- Transação 2: gravar os pontos ----------------------------------------
  const { sessao, medidos, arquivosTemp } = conferencia

  try {
    return await db.conn.tx(async t => {
      const pontosTemp = await t.any(
        `SELECT * FROM ponto_controle.upload_ponto_temp
         WHERE session_id = $<id> ORDER BY cod_ponto`,
        { id: sessao.id }
      )
      if (pontosTemp.length === 0) {
        throw new AppError(
          'Nenhum ponto encontrado para esta sessão',
          httpCode.BadRequest
        )
      }

      const relatorio = {
        session_uuid: sessionUuid,
        status: 'completed',
        error_message: null,
        problemas: [],
        inseridos: [],
        substituidos: [],
        arquivos_novos: 0,
        arquivos_repetidos: 0,
        // Caminho que ficou no volume sem linha no banco depois de uma
        // substituição. Quem opera decide se apaga; o servidor não apaga byte
        // sozinho.
        arquivos_orfaos: []
      }

      // id do volume -> pasta raiz. Serve para reconstruir o caminho do arquivo
      // que sai do banco numa substituição.
      const volumes = new Map(
        (await t.any('SELECT id, volume FROM acervo.volume_armazenamento'))
          .map(v => [String(v.id), v.volume])
      )

      for (const pontoTemp of pontosTemp) {
        const aceitos = pontoTemp.atributos || {}
        const campos = Object.keys(aceitos)
        const valores = {
          codPonto: pontoTemp.cod_ponto,
          loteId: sessao.lote_id,
          usuarioUuid,
          ...aceitos,
          // A posicao vem DEPOIS do espalhamento, e nunca antes. O `atributos`
          // costuma trazer as colunas `latitude` e `longitude` do plugin, que
          // sao REAL; se elas vierem por ultimo, a GEOMETRIA nasce com o valor
          // de float4. Medido no canario de 2026-07-29: a latitude entrou com
          // -28.63516511111111 e a geometria ficou -28.635164, 12 cm de erro
          // num ponto de apoio de campo.
          latitude: pontoTemp.latitude,
          longitude: pontoTemp.longitude
        }

        // Reconfere a existência AGORA, e não o que o prepare viu: entre as duas
        // fases pode ter passado um dia, e outra importação pode ter criado o
        // mesmo cod_ponto.
        const existente = await t.oneOrNone(
          'SELECT id FROM ponto_controle.ponto WHERE cod_ponto = $<codPonto>',
          { codPonto: pontoTemp.cod_ponto }
        )

        if (existente && !sessao.substituir) {
          throw new AppError(
            `O ponto ${pontoTemp.cod_ponto} passou a existir depois do preparo; reenvie a missão`,
            httpCode.Conflict
          )
        }

        let pontoId
        if (existente) {
          const atribuicoes = campos.map(c => `${c} = $<${c}>`).join(', ')
          await t.none(
            `UPDATE ponto_controle.ponto SET
               lote_id = $<loteId>${campos.length > 0 ? ', ' + atribuicoes : ''},
               geom = ST_SetSRID(ST_MakePoint($<longitude>, $<latitude>), 4674),
               data_modificacao = NOW(), usuario_modificacao_uuid = $<usuarioUuid>
             WHERE cod_ponto = $<codPonto>`,
            valores
          )
          pontoId = existente.id
          relatorio.substituidos.push(pontoTemp.cod_ponto)

          // Substituir o ponto substitui TAMBÉM os arquivos dele. Sem isto a
          // linha velha e a nova conviveriam apontando para o MESMO caminho no
          // volume, porque o caminho sai do nome do arquivo. O checksum antigo
          // viraria mentira: descreveria bytes que já foram sobrescritos.
          // Também estouraria o `maximo_por_ponto`, que só conta o que vem no
          // manifesto.
          const antigos = await t.any(
            `DELETE FROM ponto_controle.arquivo
             WHERE ponto_id = $<pontoId>
             RETURNING nome_arquivo, extensao, volume_armazenamento_id`,
            { pontoId }
          )
          const novosCaminhos = new Set(
            arquivosTemp
              .filter(a => String(a.ponto_temp_id) === String(pontoTemp.id))
              .map(a => a.destination_path)
          )
          for (const antigo of antigos) {
            const volume = volumes.get(String(antigo.volume_armazenamento_id))
            if (!volume) continue
            const nomeFisico = antigo.extensao
              ? `${antigo.nome_arquivo}.${antigo.extensao}`
              : antigo.nome_arquivo
            const caminho = path.join(volume, pontoTemp.cod_ponto, nomeFisico)
            // O arquivo que mantém o nome é sobrescrito pelo novo, e continua
            // válido. Só sobra órfão quando o nome mudou.
            if (!novosCaminhos.has(caminho)) relatorio.arquivos_orfaos.push(caminho)
          }
        } else {
          const nomes = [
            'cod_ponto',
            'lote_id',
            'usuario_cadastramento_uuid',
            ...campos
          ]
          const marcadores = [
            '$<codPonto>',
            '$<loteId>',
            '$<usuarioUuid>',
            ...campos.map(c => `$<${c}>`)
          ]
          const inserido = await t.one(
            `INSERT INTO ponto_controle.ponto (${nomes.join(', ')}, geom)
             VALUES (${marcadores.join(', ')},
                     ST_SetSRID(ST_MakePoint($<longitude>, $<latitude>), 4674))
             RETURNING id`,
            valores
          )
          pontoId = inserido.id
          relatorio.inseridos.push(pontoTemp.cod_ponto)
        }

        await t.none(
          `UPDATE ponto_controle.upload_ponto_temp
           SET ponto_id = $<pontoId>, status = 'completed' WHERE id = $<id>`,
          { pontoId, id: pontoTemp.id }
        )

        const doPonto = arquivosTemp.filter(
          a => String(a.ponto_temp_id) === String(pontoTemp.id)
        )
        for (const arquivo of doPonto) {
          const gravado = await t.oneOrNone(
            `INSERT INTO ponto_controle.arquivo
               (ponto_id, tipo_arquivo_id, nome_arquivo, extensao, tamanho_mb,
                checksum, volume_armazenamento_id, metadado,
                usuario_cadastramento_uuid)
             VALUES ($<pontoId>, $<tipoArquivoId>, $<nomeArquivo>, $<extensao>,
                     $<tamanhoMb>, $<checksum>, $<volumeId>, $<metadado>,
                     $<usuarioUuid>)
             ON CONFLICT (checksum, ponto_id) DO NOTHING
             RETURNING id`,
            {
              pontoId,
              tipoArquivoId: arquivo.tipo_arquivo_id,
              nomeArquivo: arquivo.nome_arquivo,
              extensao: arquivo.extensao,
              // O tamanho MEDIDO no volume, e não o que o manifesto declarou.
              tamanhoMb: medidos.get(String(arquivo.id)),
              checksum: arquivo.expected_checksum,
              volumeId: arquivo.volume_armazenamento_id,
              metadado: arquivo.metadado,
              usuarioUuid
            }
          )
          if (gravado) relatorio.arquivos_novos += 1
          else relatorio.arquivos_repetidos += 1
        }
      }

      await t.none(
        `UPDATE ponto_controle.upload_session
         SET status = 'completed', completed_at = NOW() WHERE id = $<id>`,
        { id: sessao.id }
      )

      return relatorio
    })
  } catch (erro) {
    // A gravação caiu e foi desfeita. A sessão fica 'failed' FORA da transação
    // que caiu, senão o rollback apagaria justamente o motivo.
    await db.conn.none(
      `UPDATE ponto_controle.upload_session
       SET status = 'failed', error_message = $<mensagem>, completed_at = NOW()
       WHERE id = $<id> AND status = 'pending'`,
      { id: sessao.id, mensagem: erro.message }
    )
    throw erro
  }
}

/** Sessões de importação, para quem precisa retomar ou entender o que parou. */
controller.getSessoes = async () => {
  return db.conn.any(
    `SELECT s.uuid_session, s.status, s.lote_id, l.nome AS lote, s.substituir,
            s.created_at, s.expiration_time, s.completed_at, s.error_message,
            u.nome_guerra AS usuario,
            (SELECT COUNT(*)::int FROM ponto_controle.upload_ponto_temp p
              WHERE p.session_id = s.id) AS pontos,
            (SELECT COUNT(*)::int FROM ponto_controle.upload_arquivo_temp a
              WHERE a.session_id = s.id) AS arquivos,
            (SELECT COUNT(*)::int FROM ponto_controle.upload_arquivo_temp a
              WHERE a.session_id = s.id AND a.status = 'failed') AS arquivos_com_erro
     FROM ponto_controle.upload_session AS s
     INNER JOIN acervo.lote AS l ON l.id = s.lote_id
     LEFT JOIN dgeo.usuario AS u ON u.uuid = s.usuario_uuid
     ORDER BY s.created_at DESC`
  )
}

controller.cancelarSessao = async (sessionUuid, usuarioUuid) => {
  return db.conn.tx(async t => {
    const sessao = await t.oneOrNone(
      `SELECT * FROM ponto_controle.upload_session
       WHERE uuid_session = $<sessionUuid> AND status = 'pending'`,
      { sessionUuid }
    )
    if (!sessao) {
      throw new AppError(
        'Sessão de importação não encontrada ou já processada',
        httpCode.NotFound
      )
    }

    if (sessao.usuario_uuid !== usuarioUuid) {
      const usuario = await t.oneOrNone(
        'SELECT administrador FROM dgeo.usuario WHERE uuid = $<usuarioUuid>',
        { usuarioUuid }
      )
      if (!usuario || !usuario.administrador) {
        throw new AppError(
          'Apenas quem criou a sessão ou um administrador pode cancelá-la',
          httpCode.Forbidden
        )
      }
    }

    await t.none(
      `UPDATE ponto_controle.upload_session
       SET status = 'cancelled', error_message = 'Cancelada pelo usuário',
           completed_at = NOW()
       WHERE id = $<id>`,
      { id: sessao.id }
    )
    await t.none(
      `UPDATE ponto_controle.upload_arquivo_temp
       SET status = 'cancelled' WHERE session_id = $<id> AND status = 'pending'`,
      { id: sessao.id }
    )
    await t.none(
      `UPDATE ponto_controle.upload_ponto_temp
       SET status = 'cancelled' WHERE session_id = $<id> AND status = 'pending'`,
      { id: sessao.id }
    )
  })
}

module.exports = controller

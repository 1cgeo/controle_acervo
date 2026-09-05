"use strict";
const fs = require('fs').promises;
const fsClassic = require('fs');
const { caminhoNoVolume, motivoCaminhoInseguro } = require('../utils/caminho_volume');
const { arquivarArquivos } = require('./arquivo_deletado');
const { sessaoQueReservou } = require('./nome_fisico');
const { assertEspacoNoVolume } = require('../utils/arquivos_do_acervo');
const crypto = require('crypto');
const { db } = require("../database");
const { AppError, httpCode, preserveOmitted, logger, domainConstants: { STATUS_ARQUIVO, TIPO_ARQUIVO, TIPO_VERSAO, SITUACAO_CARREGAMENTO } } = require("../utils");
const { auditoriaCtrl } = require("../auditoria");
const miniaturaVarredura = require('../utils/miniatura_varredura');
const { v4: uuidv4 } = require('uuid');

// Blocos de 8 MB, e não os 64 KB padrão do Node: o acervo mora num volume SMB,
// e ali o custo por leitura é de rede, não de disco. Vale cerca de 11% sobre o
// padrão, e não uma ordem de grandeza: a maior parte da variação de velocidade
// numa carga grande é contenção do share, não o buffer.
const BLOCO_LEITURA = 8 * 1024 * 1024;

// O INSERT do arquivo na tabela principal, um so para os cinco pontos que
// gravam arquivo: o catalogo de produto que ja esta no volume e os quatro
// caminhos do confirm-upload (arquivo avulso, versao nova, produto novo e o
// slot reaproveitado). Sao dezesseis colunas, e acrescentar uma em quatro dos
// cinco pontos e o modo de falhar que nao da erro: o arquivo entra sem o campo
// e a falta so aparece depois, no relatorio.
const SQL_INSERT_ARQUIVO = `INSERT INTO acervo.arquivo(
  uuid_arquivo, nome, nome_arquivo, versao_id, tipo_arquivo_id,
  volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado,
  tipo_status_id, situacao_carregamento_id, descricao, crs_original,
  usuario_cadastramento_uuid, data_cadastramento
) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
RETURNING *`;

/**
 * Grava o evento de CRIACAO de um arquivo do acervo.
 *
 * Existe porque os cinco pontos que inserem arquivo (a catalogacao in-place, o
 * envio pela web e os quatro caminhos do confirm-upload) precisariam do MESMO
 * bloco de sete linhas. E a mesma razao pela qual `SQL_INSERT_ARQUIVO` e um so:
 * acrescentar um campo em quatro dos cinco pontos e o modo de falhar que nao da
 * erro.
 *
 * O `produtoId` vem PRONTO de quem chama, e nunca da funcao `agregado` do mapa:
 * quem grava arquivo acabou de criar (ou de ler) a versao e ja sabe o produto,
 * e deixar o mapa resolver custaria um SELECT por arquivo numa carga de lote.
 */
/**
 * Dispara a miniatura das versoes, em segundo plano.
 *
 * Chame SEMPRE depois do commit e NUNCA com `await`. Renderizar custa segundos e
 * roda um processo externo: dentro da transacao prenderia linhas do acervo, e
 * aguardado aqui faria quem enviou o arquivo esperar a imagem ficar pronta.
 *
 * Existe como funcao, e nao como tres chamadas soltas, pela mesma razao do
 * `SQL_INSERT_ARQUIVO`: sao TRES os pontos de entrada de arquivo no acervo (o
 * envio pela web, a catalogacao in-place e o confirm-upload, este ultimo com
 * quatro caminhos internos). Nao ha varredura automatica atras deles, entao
 * esquecer um ponto e o modo de falhar que nao da erro: a versao entra no
 * acervo e a ficha dela fica sem imagem, calada.
 *
 * @param {Array<number|string>} versaoIds
 */
const dispararMiniatura = (versaoIds) => {
  const ids = (versaoIds || []).filter(Boolean);
  if (!ids.length) return;

  miniaturaVarredura
    .gerarParaVersoes(ids)
    .catch(error => logger.error('Falha ao gerar miniatura apos o cadastro', { error }));
};

const registrarArquivoCriado = async (t, arquivo, { produtoId, usuarioUuid, contexto }) => {
  await auditoriaCtrl.registrar(t, {
    tabela: 'acervo.arquivo',
    registroId: arquivo.id,
    operacao: 'I',
    depois: arquivo,
    usuarioUuid,
    contexto,
    entidadeId: produtoId
  });
};

/**
 * Calcula checksum SHA-256 via streaming, sem carregar o arquivo inteiro em memória.
 * Retorna { checksum, fileSizeMB }.
 */
function calculateChecksumStream(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let fileSize = 0;
    const stream = fsClassic.createReadStream(filePath, { highWaterMark: BLOCO_LEITURA });
    stream.on('data', (chunk) => {
      hash.update(chunk);
      fileSize += chunk.length;
    });
    stream.on('end', () => {
      resolve({
        checksum: hash.digest('hex'),
        fileSizeMB: fileSize / (1024 * 1024)
      });
    });
    stream.on('error', reject);
  });
}

/**
 * A mensagem de "não cabe", igual nas quatro portas de envio.
 *
 * A conta em si vive em `utils/arquivos_do_acervo.js`, porque ela soma
 * `acervo.arquivo` E `ponto_controle.arquivo`: as duas gravam no MESMO volume e
 * disputam a MESMA capacidade. Enquanto a conta daqui olhava só a primeira, um
 * volume com 90 GB de ponto de controle dentro se anunciava vazio para o
 * `prepare-upload` e enchia o disco durante a cópia por SMB.
 */
const erroDeEspaco = (volumeId) => (necessarioGb, disponivelGb) =>
  new AppError(
    `Espaço insuficiente no volume de armazenamento ${volumeId}. `
    + `Necessário: ${necessarioGb.toFixed(2)}GB, Disponível: ${disponivelGb.toFixed(2)}GB`,
    httpCode.BadRequest
  );

/**
 * Garante que o nome físico (volume + nome_arquivo + extensao) ainda está
 * livre. O caminho de download é reconstruído como
 *   <volume>/<nome_arquivo>.<extensao>
 * portanto dois arquivos com o mesmo trio sobrescreveriam um ao outro no
 * volume. Recusar aqui (no prepare) evita corrupção silenciosa do acervo.
 *
 * @param {object} t            tarefa/transação pg-promise
 * @param {number} volumeId     volume_armazenamento_id (null para Tileserver, ignorado)
 * @param {string} nomeArquivo  nome físico sem extensão
 * @param {string} extensao     extensão sem o ponto
 * @param {Set<string>} usados  chaves já reservadas neste mesmo lote
 */
async function assertNomeFisicoLivre(t, volumeId, nomeArquivo, extensao, usados) {
  // Tileserver não tem arquivo físico em volume
  if (volumeId === null || volumeId === undefined) return;

  // A comparação IGNORA CAIXA, e é o banco quem manda: além do índice único
  // `unique_nome_fisico_por_volume`, o schema tem
  // `unique_nome_fisico_por_volume_ci`, sobre `lower(nome_arquivo)` e
  // `lower(extensao)`. Ele existe porque o SMB do volume não distingue caixa, e
  // "CT_s02_2834-1_ed1.tif" e "ct_s02_2834-1_ed1.TIF" disputam UM arquivo no
  // disco. Comparando com caixa, esta guarda deixava passar o par que o índice
  // recusa depois: o cliente copiava os bytes e só tomava o erro cru do banco no
  // confirm-upload, em vez do 409 que diz qual arquivo colidiu.
  const chave = `${volumeId}/${nomeArquivo}.${extensao}`.toLowerCase();

  if (usados && usados.has(chave)) {
    throw new AppError(
      `Dois arquivos deste envio resolvem para o mesmo nome físico "${nomeArquivo}.${extensao}" no volume ${volumeId}. ` +
      `Os nomes físicos devem ser únicos no volume.`,
      httpCode.Conflict
    );
  }

  const existente = await t.oneOrNone(
    `SELECT id FROM acervo.arquivo
     WHERE volume_armazenamento_id = $1
       AND lower(nome_arquivo) = lower($2) AND lower(extensao) = lower($3)
     LIMIT 1`,
    [volumeId, nomeArquivo, extensao]
  );
  if (existente) {
    throw new AppError(
      `Já existe um arquivo com o nome físico "${nomeArquivo}.${extensao}" no volume ${volumeId} ` +
      `(arquivo id ${existente.id}). Os nomes físicos devem ser únicos para não sobrescrever o acervo.`,
      httpCode.Conflict
    );
  }

  // E as SESSÕES AINDA ABERTAS. Sem isto o prepare-upload não reserva coisa
  // nenhuma: a linha de `acervo.arquivo` só nasce no confirm, então duas
  // sessões preparadas na mesma hora recebiam o MESMO `destination_path` e o
  // segundo SMB sobrescrevia o primeiro em silêncio. Ver `nome_fisico.js`.
  const reservado = await sessaoQueReservou(t, volumeId, nomeArquivo, extensao);
  if (reservado) {
    throw new AppError(
      `O nome físico "${nomeArquivo}.${extensao}" no volume ${volumeId} já foi reservado ` +
      `pela sessão de envio ${reservado}, que continua aberta. Aguarde a conclusão dela ` +
      'ou cancele-a antes de preparar este envio.',
      httpCode.Conflict
    );
  }

  if (usados) usados.add(chave);
}

/**
 * Recusa produto cuja identidade já exista, no banco ou dentro do próprio lote.
 *
 * A mesma MI/INOM pode gerar produtos distintos por TIPO (a Carta Topográfica e
 * o CDGV da mesma folha são produtos separados) e também por SUBTIPO, quando
 * ele exige produto próprio (`define_produto`): a Carta Topográfica Militar
 * coexiste com a civil na mesma folha. Logo a unicidade é por
 * (INOM, tipo_produto_id, subtipo_produto_id).
 *
 * Compartilhada entre o prepare-upload/product e o catalogar/product: as duas
 * rotas criam produto, e identidade que valesse numa e não na outra deixaria a
 * porta aberta pela rota mais nova.
 */
async function assertIdentidadeProdutoLivre(t, produtos) {
  const inomKeys = produtos
    .filter(p => p.produto.inom !== null && p.produto.inom !== '')
    .map(p => `${p.produto.inom}|${p.produto.tipo_produto_id}|${p.produto.subtipo_produto_id ?? ''}`);
  const uniqueInomKeys = [...new Set(inomKeys)];

  if (inomKeys.length !== uniqueInomKeys.length) {
    throw new AppError('Existem produtos com mesmo INOM, tipo e subtipo duplicados na solicitação', httpCode.BadRequest);
  }

  for (const item of produtos) {
    if (item.produto.inom) {
      const existingProduct = await t.oneOrNone(
        'SELECT id FROM acervo.produto WHERE inom = $1 AND tipo_produto_id = $2 AND subtipo_produto_id IS NOT DISTINCT FROM $3',
        [item.produto.inom, item.produto.tipo_produto_id, item.produto.subtipo_produto_id ?? null]
      );

      if (existingProduct) {
        throw new AppError(`Já existe um produto do mesmo tipo e subtipo com o INOM ${item.produto.inom}`, httpCode.Conflict);
      }
    }
  }
}

/**
 * Espelha o trigger acervo.validate_version: como os produtos são novos,
 * versão "N-SIGLA" com N > 1 exige a versão anterior dentro do próprio
 * payload (exceto registros históricos). Também valida duplicatas.
 *
 * Não toca o banco de propósito: é regra sobre o payload, e por isso roda antes
 * de qualquer leitura de volume na catalogação in-place.
 */
function assertSequenciaVersoes(produtos) {
  for (const item of produtos) {
    const versoesProduto = item.versoes.map(v => v.versao);
    const versaoDuplicada = versoesProduto.filter((v, i) => versoesProduto.indexOf(v) !== i);
    if (versaoDuplicada.length > 0) {
      throw new AppError(`O produto ${item.produto.inom || item.produto.nome} contém versões duplicadas: ${[...new Set(versaoDuplicada)].join(', ')}`, httpCode.BadRequest);
    }

    for (const versao of item.versoes) {
      const match = /^([0-9]+)-([A-Z]{1,5})$/.exec(versao.versao);
      if (!match || versao.tipo_versao_id === TIPO_VERSAO.REGISTRO_HISTORICO) {
        continue;
      }

      const numero = parseInt(match[1], 10);
      if (numero <= 1) {
        continue;
      }

      const versaoAnterior = `${numero - 1}-${match[2]}`;
      if (!versoesProduto.includes(versaoAnterior)) {
        throw new AppError(`Não existe a versão anterior ${versaoAnterior} para o produto ${item.produto.inom || item.produto.nome} na solicitação`, httpCode.BadRequest);
      }
    }
  }
}

/**
 * Recusa nome fisico que sairia da raiz do volume.
 *
 * Roda em TODO prepare que monta um caminho a partir de `nome_arquivo` vindo do
 * cliente, e nao so no envio pela web. `path.join` nao protege contra `..` (ver
 * utils/caminho_volume.js), e o `destination_path` que o prepare grava e o
 * caminho que o confirm-upload ABRE para ler e conferir. Sem esta chamada o
 * corpo da requisicao escolhe qualquer caminho da maquina.
 */
function assertCaminhoSeguro(nomeArquivo) {
  const motivo = motivoCaminhoInseguro(nomeArquivo);
  if (motivo) {
    throw new AppError(`O caminho "${nomeArquivo}" ${motivo}.`, httpCode.BadRequest);
  }
}

// ---------------------------------------------------------------------------
// O RASCUNHO DO ENVIO DO PLUGIN
//
// Ele vive inteiro em `acervo.upload_session.payload`, um JSONB, e nao mais em
// tres tabelas espelho de `acervo.produto`, `acervo.versao` e `acervo.arquivo`.
// A razao esta no cabecalho da tabela, em `er/acervo.sql`: espelho obriga toda
// coluna nova da tabela real a ser duplicada no rascunho.
//
// Os tres montadores abaixo sao a UNICA declaracao dos campos do rascunho. Os
// quatro caminhos do prepare passam por eles, e por isso nao ha como um ganhar
// um campo e os outros nao.
// ---------------------------------------------------------------------------

/**
 * Um arquivo do rascunho.
 *
 * `status` e `error_message` nascem aqui, e nao sao enfeite: e neles que o
 * confirm escreve o desfecho de CADA arquivo, e e deles que a tela de uploads
 * com problema le qual arquivo falhou. Sem eles a tela diria so que a sessao
 * falhou.
 *
 * `vinculo` e o que amarra o arquivo ao destino, e muda por operacao:
 * `{ versao_id }` em `add_files` e `replace_files`, nada nas outras duas (la o
 * arquivo ja mora dentro da versao do rascunho).
 */
const arquivoDoRascunho = (arquivo, destinationPath, volumeId, vinculo = {}) => ({
  nome: arquivo.nome,
  nome_arquivo: arquivo.nome_arquivo,
  destination_path: destinationPath,
  tipo_arquivo_id: arquivo.tipo_arquivo_id,
  volume_armazenamento_id: volumeId,
  extensao: arquivo.extensao ?? null,
  tamanho_mb: arquivo.tamanho_mb ?? null,
  expected_checksum: arquivo.checksum ?? null,
  metadado: arquivo.metadado || {},
  situacao_carregamento_id: arquivo.situacao_carregamento_id || SITUACAO_CARREGAMENTO.NAO_CARREGADO,
  descricao: arquivo.descricao || '',
  crs_original: arquivo.crs_original || null,
  status: 'pending',
  error_message: null,
  ...vinculo
});

/**
 * Uma versao do rascunho, com a lista de arquivos dela dentro.
 *
 * As datas entram como o cliente as mandou, em texto. O Joi as valida com
 * `Joi.date().iso().raw()`, e o `.raw()` existe justamente para AAAA-MM-DD nao
 * virar instante UTC e recuar um dia. Converter aqui refaria aquele defeito.
 *
 * `vinculo` e `{ produto_id }` em `add_version` (o produto ja existe) e vazio em
 * `add_product` (o produto tambem e do rascunho, e a versao mora dentro dele).
 */
const versaoDoRascunho = (versao, vinculo = {}) => ({
  uuid_versao: versao.uuid_versao || uuidv4(),
  versao: versao.versao,
  nome: versao.nome ?? null,
  tipo_versao_id: versao.tipo_versao_id,
  subtipo_produto_id: versao.subtipo_produto_id,
  lote_id: versao.lote_id ?? null,
  metadado: versao.metadado || {},
  descricao: versao.descricao || '',
  orgao_produtor: versao.orgao_produtor,
  palavras_chave: versao.palavras_chave || [],
  data_criacao: versao.data_criacao,
  data_edicao: versao.data_edicao,
  // O VINCULO COM O PIT atravessa o envio. Sem as duas aqui, a meta escolhida no
  // formulario morre entre o preparo e a finalizacao: o schema aceita, o
  // rascunho nao guarda, e a versao final nasce fora da conta do plano.
  meta_pit_id: versao.meta_pit_id ?? null,
  data_prevista: versao.data_prevista ?? null,
  ...vinculo,
  arquivos: []
});

/** Um produto do rascunho, com as versoes dele dentro. */
const produtoDoRascunho = (produto) => ({
  nome: produto.nome ?? null,
  mi: produto.mi ?? null,
  inom: produto.inom ?? null,
  tipo_escala_id: produto.tipo_escala_id,
  denominador_escala_especial: produto.denominador_escala_especial ?? null,
  tipo_produto_id: produto.tipo_produto_id,
  // Subtipo que define a identidade do produto (ex.: 24 = Carta Topografica
  // Militar); nulo = produto comum.
  subtipo_produto_id: produto.subtipo_produto_id ?? null,
  descricao: produto.descricao || '',
  geom: produto.geom,
  versoes: []
});

/**
 * Todo arquivo do rascunho, em ordem, seja qual for a operacao.
 *
 * Devolve os objetos VIVOS do payload, e nao copias: quem marca um arquivo como
 * falho escreve direto na arvore, e o UPDATE final grava o payload inteiro de
 * uma vez. Era isso ou um UPDATE por arquivo, que e o que o desenho de tres
 * tabelas fazia.
 */
const arquivosDoRascunho = (payload) => {
  if (!payload) return [];
  if (Array.isArray(payload.arquivos)) return payload.arquivos;
  if (Array.isArray(payload.versoes)) {
    return payload.versoes.flatMap(v => v.arquivos || []);
  }
  if (Array.isArray(payload.produtos)) {
    return payload.produtos.flatMap(p =>
      (p.versoes || []).flatMap(v => v.arquivos || [])
    );
  }
  return [];
};

/**
 * O `error_message` com que o `confirm-upload` fecha a sessao VENCIDA.
 *
 * Constante, e nao literal repetido, porque ela e LIDA: o `renovarUpload` a usa
 * para separar a sessao que so perdeu o prazo (rascunho intacto, bytes no lugar,
 * checksum nunca conferido) daquela que falhou por checksum ou por erro de
 * gravacao, que nao se renova. Duas copias da frase divergiriam e a renovacao
 * pararia de achar a sessao, em silencio.
 */
const MSG_SESSAO_VENCIDA = 'Sessão de envio expirada; renove a sessão e confirme de novo';

const controller = {};

controller.atualizaArquivo = async (arquivo, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    try {
      arquivo.data_modificacao = new Date();
      arquivo.usuario_modificacao_uuid = usuarioUuid;

      // SUBSTITUI o `SELECT tipo_arquivo_id` que existia para o 404 e para a
      // guarda do Tileserver: a linha inteira sai pela mesma ida ao banco.
      const arquivoAtual = await auditoriaCtrl.lerAntes(t, 'acervo.arquivo', arquivo.id, 'Arquivo');

      // Os CHECKs de acervo.arquivo exigem nome_arquivo URL e
      // extensao/tamanho_mb/checksum NULL para Tileserver (e o inverso para os
      // demais tipos); como este UPDATE não altera esses campos, cruzar a
      // fronteira do tipo Tileserver sempre violaria um CHECK
      const eraTileserver = Number(arquivoAtual.tipo_arquivo_id) === TIPO_ARQUIVO.TILESERVER;
      const seraTileserver = arquivo.tipo_arquivo_id === TIPO_ARQUIVO.TILESERVER;
      if (eraTileserver !== seraTileserver) {
        throw new AppError(
          'Não é possível alterar o tipo de um arquivo de/para Tileserver. Exclua o arquivo e cadastre novamente com o tipo correto.',
          httpCode.BadRequest
        );
      }

      // crs_original é o único campo opcional deste PUT e o def:null abaixo
      // apagava o CRS gravado de quem simplesmente não mandou a chave. Ausente
      // agora preserva; null explícito ainda limpa.
      await preserveOmitted(t, {
        table: 'arquivo',
        id: arquivo.id,
        fields: ['crs_original'],
        body: arquivo
      });

      const colunasArquivo = [
        'nome', 'tipo_arquivo_id', 'volume_armazenamento_id',
        'metadado', 'tipo_status_id', 'situacao_carregamento_id', 'descricao', 
        { name: 'crs_original', def: null }, 'data_modificacao', 'usuario_modificacao_uuid'
      ];

      const cs = new db.pgp.helpers.ColumnSet(colunasArquivo, { table: { table: 'arquivo', schema: 'acervo' } });
      const query = db.pgp.helpers.update(arquivo, cs) + ' WHERE id = $1 RETURNING *';

      const depois = await t.oneOrNone(query, [arquivo.id]);

      if (!depois) {
        throw new AppError('Arquivo não encontrado', httpCode.NotFound);
      }

      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.arquivo',
        registroId: arquivo.id,
        operacao: 'U',
        antes: arquivoAtual,
        depois,
        usuarioUuid,
        contexto
      });

    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(`Erro ao atualizar arquivo: ${error.message}`, httpCode.InternalError, error);
    }
  });
};

/**
 * Recalcula checksum e tamanho a partir do arquivo que ESTÁ no volume, e grava.
 *
 * Existe para a recompressão sem perda do acervo: o GeoTIFF é reescrito com
 * COMPRESS=DEFLATE, o pixel continua idêntico, mas o SHA-256 do arquivo muda.
 * Sem isto o plugin recusa o download (valida checksum depois de copiar) e
 * gerencia.verificarConsistencia marca ERRO_CARREGAMENTO.
 *
 * O cliente NÃO declara checksum nem tamanho. Ele só aponta quais ids releu.
 * Quem mede é o servidor, lendo o byte no volume. É a diferença entre esta rota
 * e um UPDATE manual no banco.
 *
 * Não substitui prepareReplaceFiles: aquele troca o ARQUIVO (id e uuid novos,
 * linha antiga para arquivo_deletado). Este preserva id, uuid e histórico de
 * download, porque o arquivo é o mesmo, só mudou o empacotamento.
 */
controller.atualizarChecksum = async (arquivoIds, motivo, usuarioUuid, contexto) => {
  // `a.*` no lugar da lista de colunas, mais o `produto_id` da versão: as
  // colunas eram exatamente as que a medição usa, e as demais viram o
  // `dados_antes` de cada arquivo pela MESMA ida ao banco. O `produto_id` entra
  // aqui pela mesma razão: o agregado dono sai desta consulta, e não de um
  // SELECT por arquivo no momento de auditar.
  const arquivos = await db.conn.any(`
    SELECT a.*, v.volume, ver.produto_id
    FROM acervo.arquivo a
    JOIN acervo.volume_armazenamento v ON a.volume_armazenamento_id = v.id
    JOIN acervo.versao ver ON ver.id = a.versao_id
    WHERE a.id IN ($<ids:csv>)
  `, { ids: arquivoIds });

  if (arquivos.length !== arquivoIds.length) {
    const achados = new Set(arquivos.map(a => Number(a.id)));
    throw new AppError(
      `Arquivos não encontrados ou sem volume: ${arquivoIds.filter(i => !achados.has(Number(i))).join(', ')}`,
      httpCode.NotFound
    );
  }

  const tileserver = arquivos.filter(a => Number(a.tipo_arquivo_id) === TIPO_ARQUIVO.TILESERVER);
  if (tileserver.length > 0) {
    throw new AppError(
      `Arquivo Tileserver não tem arquivo físico no volume: ${tileserver.map(a => a.id).join(', ')}`,
      httpCode.BadRequest
    );
  }

  // Leitura e hash FORA da transação: o cálculo é longo e seguraria a conexão
  // aberta o tempo todo. Mesmo motivo de gerencia_ctrl.verificarConsistencia.
  // Qualquer arquivo ausente aborta ANTES de gravar qualquer linha.
  const medidos = [];
  for (const a of arquivos) {
    const filePath = caminhoNoVolume(a.volume, `${a.nome_arquivo}.${a.extensao}`);
    try {
      await fs.access(filePath);
    } catch (error) {
      throw new AppError(
        `Arquivo ${a.id} (${a.nome_arquivo}.${a.extensao}) não existe no volume. Nada foi alterado.`,
        httpCode.BadRequest
      );
    }
    const { checksum, fileSizeMB } = await calculateChecksumStream(filePath);
    // `volume` e `produto_id` vieram do JOIN e não são colunas de
    // `acervo.arquivo`: fora do `dados_antes`, que descreve a LINHA.
    const { volume, produto_id: produtoId, ...linhaArquivo } = a;
    medidos.push({
      id: a.id,
      nome_arquivo: a.nome_arquivo,
      extensao: a.extensao,
      checksum_anterior: a.checksum,
      checksum_novo: checksum,
      tamanho_mb_anterior: Number(a.tamanho_mb),
      tamanho_mb_novo: fileSizeMB,
      alterado: checksum !== a.checksum,
      antes: linhaArquivo,
      produto_id: produtoId
    });
  }

  const alterados = medidos.filter(m => m.alterado);

  if (alterados.length > 0) {
    const data_modificacao = new Date();
    await db.conn.tx(async t => {
      for (const m of alterados) {
        const depois = await t.one(`
          UPDATE acervo.arquivo
          SET checksum = $<checksum>, tamanho_mb = $<tamanho_mb>,
              data_modificacao = $<data_modificacao>,
              usuario_modificacao_uuid = $<usuarioUuid>
          WHERE id = $<id>
          RETURNING *
        `, {
          checksum: m.checksum_novo,
          tamanho_mb: m.tamanho_mb_novo,
          data_modificacao,
          usuarioUuid,
          id: m.id
        });

        // O caso mais barato do plano: o `checksum_anterior`, o novo e os dois
        // tamanhos já estavam montados em memória e só iam para o LOG (que
        // roda 14 dias) e para a resposta HTTP (que ninguém guarda). O `motivo`
        // é obrigatório nesta rota e também não era gravado em lugar nenhum.
        await auditoriaCtrl.registrar(t, {
          tabela: 'acervo.arquivo',
          registroId: m.id,
          operacao: 'U',
          antes: m.antes,
          depois,
          usuarioUuid,
          contexto,
          motivo,
          entidadeId: m.produto_id
        });
      }
    });
  }

  logger.info('Checksum de arquivo atualizado por releitura do volume', {
    usuarioUuid,
    motivo,
    solicitados: arquivoIds.length,
    alterados: alterados.length,
    detalhe: alterados.map(m => ({
      id: m.id,
      de: m.checksum_anterior,
      para: m.checksum_novo,
      mb_de: m.tamanho_mb_anterior,
      mb_para: m.tamanho_mb_novo
    }))
  });

  return {
    solicitados: arquivoIds.length,
    alterados: alterados.length,
    inalterados: medidos.length - alterados.length,
    economia_mb: alterados.reduce((s, m) => s + (m.tamanho_mb_anterior - m.tamanho_mb_novo), 0),
    // A RESPOSTA não muda: `antes` e `produto_id` existem só para o rastro, e
    // devolvê-los faria a rota passar a expor a linha inteira do arquivo.
    arquivos: medidos.map(({ antes, produto_id: _produtoId, ...publico }) => publico)
  };
};

controller.deleteArquivos = async (arquivoIds, motivo_exclusao, usuarioUuid, contexto) => {
  const data_delete = new Date();
  const usuario_delete_uuid = usuarioUuid;

  return db.conn.tx(async t => {
    try {
      // Verificar se todos os IDs de arquivo existem
      const existingFiles = await t.any(
        `SELECT id FROM acervo.arquivo WHERE id IN ($1:csv)`,
        [arquivoIds]
      );

      if (existingFiles.length !== arquivoIds.length) {
        // BIGSERIAL retorna como string no driver, normalizar para número
        const existingIds = existingFiles.map(f => Number(f.id));
        const missingIds = arquivoIds.filter(id => !existingIds.includes(parseInt(id)));
        throw new AppError(`Os seguintes arquivos não foram encontrados: ${missingIds.join(', ')}`, httpCode.NotFound);
      }

      // O evento de exclusão de cada arquivo nasce DENTRO do arquivar, a partir
      // da própria lápide: os dados não passam por aqui.
      await arquivarArquivos(t, arquivoIds, {
        motivo: motivo_exclusao,
        dataDelete: data_delete,
        usuarioDeleteUuid: usuario_delete_uuid,
        contexto
      });

    } catch (error) {
      // Se não for um AppError, cria um
      if (!(error instanceof AppError)) {
        throw new AppError(`Erro ao deletar arquivos: ${error.message}`, httpCode.InternalError, error);
      }
      throw error;
    }
  });
};

controller.prepareAddFiles = async (requestData, usuarioUuid) => {
  return db.conn.tx(async t => {
    try {
      const { arquivos } = requestData;
      
      const versao_ids = [...new Set(arquivos.map(a => a.versao_id))];
      
      const versoes = await t.any(
        `SELECT v.id, v.produto_id, p.tipo_produto_id
         FROM acervo.versao v
         JOIN acervo.produto p ON v.produto_id = p.id
         WHERE v.id IN ($1:csv)`,
        [versao_ids]
      );
      
      if (versoes.length !== versao_ids.length) {
        const foundIds = versoes.map(v => Number(v.id));
        const missingIds = versao_ids.filter(id => !foundIds.includes(id));
        throw new AppError(`Versões não encontradas com IDs: ${missingIds.join(', ')}`, httpCode.NotFound);
      }
      
      // Criar mapeamento de versões
      const versaoMap = {};
      versoes.forEach(v => {
        versaoMap[v.id] = v;
      });
      
      const productTypes = [...new Set(versoes.map(v => v.tipo_produto_id))];
      const volumeTypes = await t.any(
        `SELECT vtp.tipo_produto_id, vtp.volume_armazenamento_id, va.volume, va.capacidade_gb
         FROM acervo.volume_tipo_produto vtp
         JOIN acervo.volume_armazenamento va ON va.id = vtp.volume_armazenamento_id
         WHERE vtp.tipo_produto_id IN ($1:csv) AND vtp.primario = TRUE`,
        [productTypes]
      );
      
      const volumeByProductType = {};
      volumeTypes.forEach(vt => {
        volumeByProductType[vt.tipo_produto_id] = vt;
      });
      
      for (const pt of productTypes) {
        if (!volumeByProductType[pt]) {
          throw new AppError(`Não existe volume primário cadastrado para o tipo de produto ${pt}`, httpCode.BadRequest);
        }
      }
      
      for (const arquivo of arquivos) {
        // A chave fisica e (volume, nome_arquivo, extensao); arquivos irmaos de uma
        // mesma versao (ex.: .tif principal + .pdf + .json de edicao) compartilham
        // nome_arquivo e so diferem na extensao. Por isso o check inclui extensao
        // (IS NOT DISTINCT FROM trata o NULL do Tileserver como igualdade).
        const arquivoExistente = await t.oneOrNone(
          `SELECT id FROM acervo.arquivo
           WHERE nome_arquivo = $1 AND extensao IS NOT DISTINCT FROM $2 AND versao_id = $3`,
          [arquivo.nome_arquivo, arquivo.extensao, arquivo.versao_id]
        );

        if (arquivoExistente) {
          throw new AppError(`Arquivo ${arquivo.nome_arquivo}.${arquivo.extensao} já existe para a versão ${arquivo.versao_id}`, httpCode.Conflict);
        }

        // Espelha a UNIQUE unique_file_per_version (checksum, versao_id):
        // sem este check a duplicata só estouraria no confirm, após a
        // transferência dos arquivos
        if (arquivo.checksum) {
          const checksumExistente = await t.oneOrNone(
            `SELECT id FROM acervo.arquivo
             WHERE checksum = $1 AND versao_id = $2`,
            [arquivo.checksum, arquivo.versao_id]
          );

          if (checksumExistente) {
            throw new AppError(`Já existe arquivo com o mesmo checksum para a versão ${arquivo.versao_id} (${arquivo.nome_arquivo})`, httpCode.Conflict);
          }
        }
      }

      // Duplicatas de checksum dentro do próprio payload
      const chavesChecksum = arquivos.filter(a => a.checksum).map(a => `${a.checksum}|${a.versao_id}`);
      const checksumDuplicado = chavesChecksum.filter((c, i) => chavesChecksum.indexOf(c) !== i);
      if (checksumDuplicado.length > 0) {
        throw new AppError('A requisição contém arquivos com checksum duplicado para a mesma versão', httpCode.BadRequest);
      }

      const spaceNeededByVolume = {};
      for (const arquivo of arquivos) {
        const versao = versoes.find(v => Number(v.id) === Number(arquivo.versao_id));
        const volume = volumeByProductType[versao.tipo_produto_id];
        
        if (!spaceNeededByVolume[volume.volume_armazenamento_id]) {
          spaceNeededByVolume[volume.volume_armazenamento_id] = 0;
        }
        spaceNeededByVolume[volume.volume_armazenamento_id] += arquivo.tamanho_mb || 0;
      }
      
      for (const [volumeId, space] of Object.entries(spaceNeededByVolume)) {
        await assertEspacoNoVolume(t, volumeId, space / 1024, erroDeEspaco(volumeId));
      }
      
      const arquivosInfo = [];
      const nomesFisicosUsados = new Set();
      const rascunho = [];

      for (const arquivo of arquivos) {
        const versao = versoes.find(v => Number(v.id) === Number(arquivo.versao_id));
        const volume = volumeByProductType[versao.tipo_produto_id];
        const isTileserver = arquivo.tipo_arquivo_id === TIPO_ARQUIVO.TILESERVER;
        // O nome vem do cliente e vira `destination_path`, que o confirm-upload
        // abre para ler. `caminhoNoVolume` é `path.join` puro e NÃO barra `..`,
        // então sem esta linha o corpo da requisição escolhe qualquer caminho da
        // máquina. As rotas irmãs (`prepararVersao`, `prepararProduto`) a chamam
        // com a MESMA condição.
        if (!isTileserver) assertCaminhoSeguro(arquivo.nome_arquivo);
        // Tileserver é uma URL. Não tem arquivo físico, volume nem extensão
        const destinationPath = isTileserver
          ? arquivo.nome_arquivo
          : caminhoNoVolume(volume.volume, `${arquivo.nome_arquivo}.${arquivo.extensao}`);

        // Impede colisão de nome físico no volume (sobrescrita silenciosa)
        await assertNomeFisicoLivre(
          t,
          isTileserver ? null : volume.volume_armazenamento_id,
          arquivo.nome_arquivo, arquivo.extensao, nomesFisicosUsados
        );

        rascunho.push(arquivoDoRascunho(
          arquivo,
          destinationPath,
          isTileserver ? null : volume.volume_armazenamento_id,
          { versao_id: arquivo.versao_id }
        ));

        arquivosInfo.push({
          uuid_arquivo: arquivo.uuid_arquivo || null,
          nome: arquivo.nome,
          nome_arquivo: arquivo.nome_arquivo,
          tipo_arquivo_id: arquivo.tipo_arquivo_id,
          versao_id: arquivo.versao_id,
          destination_path: destinationPath,
          checksum: arquivo.checksum
        });
      }

      // A sessao nasce DEPOIS do rascunho estar pronto: com o envio inteiro num
      // documento so, nao ha id de sessao a distribuir por linha filha.
      const { uuid_session } = await t.one(
        `INSERT INTO acervo.upload_session(usuario_uuid, operation_type, payload)
         VALUES ($1, $2, $3) RETURNING uuid_session`,
        [usuarioUuid, 'add_files', { arquivos: rascunho }]
      );

      return {
        session_uuid: uuid_session,
        operation_type: 'add_files',
        arquivos: arquivosInfo
      };
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw new AppError(`Erro ao preparar upload de arquivos: ${error.message}`, httpCode.InternalError, error);
      }
      throw error;
    }
  });
};

/**
 * Prepara a SUBSTITUICAO de conteudo de arquivos em versoes EXISTENTES, sem criar
 * nova versao. Difere do prepareAddFiles em dois pontos: (1) NAO aplica os checks
 * de colisao contra o acervo -- substituir o arquivo que ja ocupa o slot
 * (versao_id, nome_arquivo, extensao) e justamente o objetivo, e um irmao de mesmo
 * nome_arquivo (ex.: o .json) deve coexistir; (2) o destination_path e o mesmo do
 * arquivo atual, entao a transferencia sobrescreve o fisico no lugar (sem orfao).
 * A troca em si (soft-delete do antigo + insert do novo) acontece atomicamente no
 * confirm-upload (processReplaceFiles). A unicidade (checksum, versao_id) segue
 * garantida pela constraint do banco no INSERT do confirm.
 */
controller.prepareReplaceFiles = async (requestData, usuarioUuid) => {
  return db.conn.tx(async t => {
    try {
      const { arquivos } = requestData;

      // Verifica se todas as versoes existem e pega o tipo de produto de cada
      const versao_ids = [...new Set(arquivos.map(a => a.versao_id))];
      const versoes = await t.any(
        `SELECT v.id, v.produto_id, p.tipo_produto_id
         FROM acervo.versao v
         JOIN acervo.produto p ON v.produto_id = p.id
         WHERE v.id IN ($1:csv)`,
        [versao_ids]
      );
      if (versoes.length !== versao_ids.length) {
        const foundIds = versoes.map(v => Number(v.id));
        const missingIds = versao_ids.filter(id => !foundIds.includes(id));
        throw new AppError(`Versões não encontradas com IDs: ${missingIds.join(', ')}`, httpCode.NotFound);
      }

      // Volume primario por tipo de produto
      const productTypes = [...new Set(versoes.map(v => v.tipo_produto_id))];
      const volumeTypes = await t.any(
        `SELECT vtp.tipo_produto_id, vtp.volume_armazenamento_id, va.volume, va.capacidade_gb
         FROM acervo.volume_tipo_produto vtp
         JOIN acervo.volume_armazenamento va ON va.id = vtp.volume_armazenamento_id
         WHERE vtp.tipo_produto_id IN ($1:csv) AND vtp.primario = TRUE`,
        [productTypes]
      );
      const volumeByProductType = {};
      volumeTypes.forEach(vt => { volumeByProductType[vt.tipo_produto_id] = vt; });
      for (const pt of productTypes) {
        if (!volumeByProductType[pt]) {
          throw new AppError(`Não existe volume primário cadastrado para o tipo de produto ${pt}`, httpCode.BadRequest);
        }
      }

      // Duplicatas de checksum dentro do proprio payload (mesma versao)
      const chavesChecksum = arquivos.filter(a => a.checksum).map(a => `${a.checksum}|${a.versao_id}`);
      if (chavesChecksum.some((c, i) => chavesChecksum.indexOf(c) !== i)) {
        throw new AppError('A requisição contém arquivos com checksum duplicado para a mesma versão', httpCode.BadRequest);
      }

      const arquivosInfo = [];
      const nomesFisicosUsados = new Set();
      const rascunho = [];
      for (const arquivo of arquivos) {
        const versao = versoes.find(v => Number(v.id) === Number(arquivo.versao_id));
        const volume = volumeByProductType[versao.tipo_produto_id];
        const isTileserver = arquivo.tipo_arquivo_id === TIPO_ARQUIVO.TILESERVER;
        // Mesma razao do prepareAddFiles: o nome vem do cliente e vira o caminho
        // que o confirm-upload abre.
        if (!isTileserver) assertCaminhoSeguro(arquivo.nome_arquivo);
        const destinationPath = isTileserver
          ? arquivo.nome_arquivo
          : caminhoNoVolume(volume.volume, `${arquivo.nome_arquivo}.${arquivo.extensao}`);

        // So impede que DOIS arquivos DESTE envio resolvam para o mesmo nome fisico.
        // (Nao checamos o acervo: substituir o slot existente e o objetivo.)
        if (!isTileserver) {
          const chave = `${volume.volume_armazenamento_id}/${arquivo.nome_arquivo}.${arquivo.extensao}`;
          if (nomesFisicosUsados.has(chave)) {
            throw new AppError(`Dois arquivos deste envio resolvem para o mesmo nome físico "${arquivo.nome_arquivo}.${arquivo.extensao}" no volume ${volume.volume_armazenamento_id}.`, httpCode.Conflict);
          }
          nomesFisicosUsados.add(chave);
        }

        rascunho.push(arquivoDoRascunho(
          arquivo,
          destinationPath,
          isTileserver ? null : volume.volume_armazenamento_id,
          { versao_id: arquivo.versao_id }
        ));

        arquivosInfo.push({
          uuid_arquivo: arquivo.uuid_arquivo || null,
          nome: arquivo.nome,
          nome_arquivo: arquivo.nome_arquivo,
          tipo_arquivo_id: arquivo.tipo_arquivo_id,
          versao_id: arquivo.versao_id,
          destination_path: destinationPath,
          checksum: arquivo.checksum
        });
      }

      const { uuid_session } = await t.one(
        `INSERT INTO acervo.upload_session(usuario_uuid, operation_type, payload)
         VALUES ($1, $2, $3) RETURNING uuid_session`,
        [usuarioUuid, 'replace_files', { arquivos: rascunho }]
      );

      return {
        session_uuid: uuid_session,
        operation_type: 'replace_files',
        arquivos: arquivosInfo
      };
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw new AppError(`Erro ao preparar substituição de arquivos: ${error.message}`, httpCode.InternalError, error);
      }
      throw error;
    }
  });
};

/**
 * Reserva o destino de uma versao nova em produto que ja existe.
 *
 * E o caminho do PLUGIN: o cliente declara `checksum` e `tamanho_mb`, copia os
 * arquivos por SMB e chama o confirm-upload, que confere o que ele declarou. O
 * navegador NAO passa por aqui -- ele manda metadados e bytes numa requisicao
 * so, em `upload_web.js`, onde nao ha janela entre reservar e gravar e portanto
 * nao ha sessao a cobrir.
 *
 * Duas copias desta validacao (produto existe, versao inedita, sequencia de
 * versao, volume primario do tipo, nome fisico livre) divergiriam na primeira
 * regra nova, e a que ficasse para tras seria a porta aberta.
 */
const prepararVersao = async (requestData, usuarioUuid) => {
  return db.conn.tx(async t => {
    try {
      const { versoes } = requestData;
      
      const produto_ids = [...new Set(versoes.map(v => v.produto_id))];
      
      const produtos = await t.any(
        'SELECT id, tipo_produto_id FROM acervo.produto WHERE id IN ($1:csv)',
        [produto_ids]
      );
      
      if (produtos.length !== produto_ids.length) {
        const foundIds = produtos.map(p => Number(p.id));
        const missingIds = produto_ids.filter(id => !foundIds.includes(parseInt(id)));
        throw new AppError(`Produtos não encontrados com IDs: ${missingIds.join(', ')}`, httpCode.NotFound);
      }
      
      const produtoMap = {};
      produtos.forEach(p => {
        produtoMap[p.id] = p;
      });
      
      for (const item of versoes) {
        const versaoExistente = await t.oneOrNone(
          'SELECT id FROM acervo.versao WHERE produto_id = $1 AND versao = $2 AND subtipo_produto_id = $3',
          [item.produto_id, item.versao.versao, item.versao.subtipo_produto_id]
        );

        if (versaoExistente) {
          throw new AppError(`Já existe uma versão com o nome "${item.versao.versao}" (subtipo ${item.versao.subtipo_produto_id}) para o produto ${item.produto_id}`, httpCode.Conflict);
        }
      }

      // Espelha o trigger acervo.validate_version: versão "N-SIGLA" com N > 1
      // exige a versão anterior (exceto registros históricos). Sem este check a
      // falha só estouraria no confirm, após a transferência dos arquivos
      for (const item of versoes) {
        const match = /^([0-9]+)-([A-Z]{1,5})$/.exec(item.versao.versao);
        if (!match || item.versao.tipo_versao_id === TIPO_VERSAO.REGISTRO_HISTORICO) {
          continue;
        }

        const numero = parseInt(match[1], 10);
        if (numero <= 1) {
          continue;
        }

        const versaoAnterior = `${numero - 1}-${match[2]}`;
        const anteriorNoPayload = versoes.some(v =>
          v.produto_id === item.produto_id && v.versao.versao === versaoAnterior
        );

        if (!anteriorNoPayload) {
          const anterior = await t.oneOrNone(
            'SELECT id FROM acervo.versao WHERE produto_id = $1 AND versao = $2',
            [item.produto_id, versaoAnterior]
          );

          if (!anterior) {
            throw new AppError(`Não existe a versão anterior ${versaoAnterior} para o produto ${item.produto_id}`, httpCode.BadRequest);
          }
        }
      }

      const productTypes = [...new Set(produtos.map(p => p.tipo_produto_id))];
      const volumeTypes = await t.any(
        `SELECT vtp.tipo_produto_id, vtp.volume_armazenamento_id, va.volume, va.capacidade_gb
         FROM acervo.volume_tipo_produto vtp
         JOIN acervo.volume_armazenamento va ON va.id = vtp.volume_armazenamento_id
         WHERE vtp.tipo_produto_id IN ($1:csv) AND vtp.primario = TRUE`,
        [productTypes]
      );
      
      const volumeByProductType = {};
      volumeTypes.forEach(vt => {
        volumeByProductType[vt.tipo_produto_id] = vt;
      });
      
      for (const pt of productTypes) {
        if (!volumeByProductType[pt]) {
          throw new AppError(`Não existe volume primário cadastrado para o tipo de produto ${pt}`, httpCode.BadRequest);
        }
      }
      
      const spaceNeededByVolume = {};
      for (const item of versoes) {
        const produto = produtoMap[item.produto_id];
        const volume = volumeByProductType[produto.tipo_produto_id];
        
        if (!spaceNeededByVolume[volume.volume_armazenamento_id]) {
          spaceNeededByVolume[volume.volume_armazenamento_id] = 0;
        }
        
        for (const arquivo of item.arquivos) {
          spaceNeededByVolume[volume.volume_armazenamento_id] += arquivo.tamanho_mb || 0;
        }
      }
      
      for (const [volumeId, space] of Object.entries(spaceNeededByVolume)) {
        await assertEspacoNoVolume(t, volumeId, space / 1024, erroDeEspaco(volumeId));
      }
      
      const result = [];
      const nomesFisicosUsados = new Set();
      const rascunho = [];

      for (const item of versoes) {
        const produto = produtoMap[item.produto_id];
        const volume = volumeByProductType[produto.tipo_produto_id];

        const versaoRascunho = versaoDoRascunho(item.versao, { produto_id: item.produto_id });
        rascunho.push(versaoRascunho);

        const arquivosInfo = [];

        for (const arquivo of item.arquivos) {
          const isTileserver = arquivo.tipo_arquivo_id === TIPO_ARQUIVO.TILESERVER;
          // SÓ fora do Tileserver, como no prepareAddFiles. O `nome_arquivo` do
          // Tileserver é uma URL (`https://.../x`), e o `//` dela é um segmento
          // vazio para o `motivoCaminhoInseguro`: sem esta guarda, TODA sessão
          // com um Tileserver era recusada com 400 dizendo que o caminho sairia
          // da raiz do volume, e esta é justamente a rota que o schema aponta
          // para cadastrá-lo.
          if (!isTileserver) assertCaminhoSeguro(arquivo.nome_arquivo);
          // Tileserver é uma URL. Não tem arquivo físico, volume nem extensão
          const destinationPath = isTileserver
            ? arquivo.nome_arquivo
            : caminhoNoVolume(volume.volume, `${arquivo.nome_arquivo}.${arquivo.extensao}`);

          // Impede colisão de nome físico no volume (sobrescrita silenciosa)
          await assertNomeFisicoLivre(
            t,
            isTileserver ? null : volume.volume_armazenamento_id,
            arquivo.nome_arquivo, arquivo.extensao, nomesFisicosUsados
          );

          versaoRascunho.arquivos.push(arquivoDoRascunho(
            arquivo,
            destinationPath,
            isTileserver ? null : volume.volume_armazenamento_id
          ));

          arquivosInfo.push({
            uuid_arquivo: arquivo.uuid_arquivo || null,
            nome: arquivo.nome,
            nome_arquivo: arquivo.nome_arquivo,
            tipo_arquivo_id: arquivo.tipo_arquivo_id,
            destination_path: destinationPath,
            checksum: arquivo.checksum
          });
        }

        result.push({
          produto_id: item.produto_id,
          versao_info: item.versao,
          arquivos: arquivosInfo
        });
      }

      const { uuid_session } = await t.one(
        `INSERT INTO acervo.upload_session(usuario_uuid, operation_type, payload)
         VALUES ($1, $2, $3) RETURNING uuid_session`,
        [usuarioUuid, 'add_version', { versoes: rascunho }]
      );

      return {
        session_uuid: uuid_session,
        operation_type: 'add_version',
        versoes: result
      };
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw new AppError(`Erro ao preparar upload de versão: ${error.message}`, httpCode.InternalError, error);
      }
      throw error;
    }
  });
};

controller.prepareAddVersion = prepararVersao;

/**
 * Reserva o destino de um produto NOVO, com suas versoes e arquivos.
 *
 * Caminho do PLUGIN, irmao de `prepararVersao`; ver o cabecalho de la.
 */
const prepararProduto = async (requestData, usuarioUuid) => {
  return db.conn.tx(async t => {
    try {
      const { produtos } = requestData;

      await assertIdentidadeProdutoLivre(t, produtos);
      assertSequenciaVersoes(produtos);

      const productTypes = [...new Set(produtos.map(p => p.produto.tipo_produto_id))];
      const volumeTypes = await t.any(
        `SELECT vtp.tipo_produto_id, vtp.volume_armazenamento_id, va.volume, va.capacidade_gb
         FROM acervo.volume_tipo_produto vtp
         JOIN acervo.volume_armazenamento va ON va.id = vtp.volume_armazenamento_id
         WHERE vtp.tipo_produto_id IN ($1:csv) AND vtp.primario = TRUE`,
        [productTypes]
      );
      
      const volumeByProductType = {};
      volumeTypes.forEach(vt => {
        volumeByProductType[vt.tipo_produto_id] = vt;
      });
      
      for (const pt of productTypes) {
        if (!volumeByProductType[pt]) {
          throw new AppError(`Não existe volume primário cadastrado para o tipo de produto ${pt}`, httpCode.BadRequest);
        }
      }
      
      const spaceNeededByVolume = {};
      for (const item of produtos) {
        const volume = volumeByProductType[item.produto.tipo_produto_id];
        
        if (!spaceNeededByVolume[volume.volume_armazenamento_id]) {
          spaceNeededByVolume[volume.volume_armazenamento_id] = 0;
        }
        
        for (const versao of item.versoes) {
          for (const arquivo of versao.arquivos) {
            spaceNeededByVolume[volume.volume_armazenamento_id] += arquivo.tamanho_mb || 0;
          }
        }
      }
      
      for (const [volumeId, space] of Object.entries(spaceNeededByVolume)) {
        await assertEspacoNoVolume(t, volumeId, space / 1024, erroDeEspaco(volumeId));
      }
      
      const result = [];
      const nomesFisicosUsados = new Set();
      const rascunho = [];

      for (const item of produtos) {
        const volume = volumeByProductType[item.produto.tipo_produto_id];

        const produtoRascunho = produtoDoRascunho(item.produto);
        rascunho.push(produtoRascunho);

        const versoesInfo = [];

        for (const versao of item.versoes) {
          const versaoRascunho = versaoDoRascunho(versao);
          produtoRascunho.versoes.push(versaoRascunho);

          const arquivosInfo = [];

          for (const arquivo of versao.arquivos) {
            const isTileserver = arquivo.tipo_arquivo_id === TIPO_ARQUIVO.TILESERVER;
            // Mesma guarda do prepareAddFiles e do prepararVersao: a URL do
            // Tileserver tem `//`, que o `motivoCaminhoInseguro` lê como
            // segmento vazio e recusa.
            if (!isTileserver) assertCaminhoSeguro(arquivo.nome_arquivo);
          // Tileserver é uma URL. Não tem arquivo físico, volume nem extensão
          const destinationPath = isTileserver
            ? arquivo.nome_arquivo
            : caminhoNoVolume(volume.volume, `${arquivo.nome_arquivo}.${arquivo.extensao}`);

            // Impede colisão de nome físico no volume (sobrescrita silenciosa)
            await assertNomeFisicoLivre(
              t,
              isTileserver ? null : volume.volume_armazenamento_id,
              arquivo.nome_arquivo, arquivo.extensao, nomesFisicosUsados
            );

            versaoRascunho.arquivos.push(arquivoDoRascunho(
              arquivo,
              destinationPath,
              isTileserver ? null : volume.volume_armazenamento_id
            ));

            arquivosInfo.push({
              uuid_arquivo: arquivo.uuid_arquivo || null,
              nome: arquivo.nome,
              nome_arquivo: arquivo.nome_arquivo,
              tipo_arquivo_id: arquivo.tipo_arquivo_id,
              destination_path: destinationPath,
              checksum: arquivo.checksum
            });
          }

          versoesInfo.push({
            versao_info: versao,
            arquivos: arquivosInfo
          });
        }
        
        result.push({
          produto_info: item.produto,
          versoes: versoesInfo
        });
      }

      const { uuid_session } = await t.one(
        `INSERT INTO acervo.upload_session(usuario_uuid, operation_type, payload)
         VALUES ($1, $2, $3) RETURNING uuid_session`,
        [usuarioUuid, 'add_product', { produtos: rascunho }]
      );

      return {
        session_uuid: uuid_session,
        operation_type: 'add_product',
        produtos: result
      };
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw new AppError(`Erro ao preparar upload de produto: ${error.message}`, httpCode.InternalError, error);
      }
      throw error;
    }
  });
};

controller.prepareAddProduct = prepararProduto;

/**
 * Fecha o envio pelo NAVEGADOR: promove os bytes e cadastra, numa transacao.
 *
 * TRES CASOS, e o `plano.tipo` os separa:
 *
 *   'produto'  - produto novo, com a primeira versao e os arquivos dela.
 *   'versao'   - versao nova, com arquivos, em produto que ja existe.
 *   'arquivos' - arquivos numa versao que ja existe. E o que completa a versao
 *                PLANEJADA, que nasce sem arquivo de proposito e o recebe nesta
 *                MESMA versao quando a producao termina.
 *
 * Os bytes ja estao gravados e MEDIDOS quando esta funcao comeca: quem os
 * escreveu foi o storage de `upload_web.js`, no mesmo passo em que calculou o
 * SHA-256. Aqui so falta o registro e a promocao ao nome definitivo.
 *
 * A ORDEM E BANCO PRIMEIRO, DISCO DEPOIS, DENTRO DA MESMA TRANSACAO -- e e a
 * mesma do `renomearPadrao`, pela mesma razao. Quem arbitra a colisao de nome
 * fisico sao os indices `unique_nome_fisico_por_volume{,_ci}`: deixando o INSERT
 * ir primeiro, a colisao e recusada com o disco ainda intacto. So depois de o
 * banco aceitar e que o byte assume o nome definitivo, e se o `rename` falhar o
 * ROLLBACK desfaz o registro -- nada muda.
 *
 * O rename e o que torna a escrita ATOMICA: o acervo so ve o arquivo quando ele
 * esta inteiro. Conexao cortada no meio deixa um `.parcial`, que a limpeza apaga,
 * e nunca um arquivo truncado com o nome que o acervo considera valido.
 *
 * Se o rename falhar no meio de varios arquivos, os que ja foram promovidos
 * VOLTAM ao `.parcial` antes de a transacao abortar: sem isso ficariam bytes com
 * nome definitivo e nenhuma linha apontando para eles, que e lixo que nenhuma
 * auditoria reconhece (o 7c so ve o que tem lapide).
 */
controller.enviarWeb = async (plano, usuarioUuid, contexto) => {
  const gravados = plano.gravados;

  if (gravados.length !== plano.arquivos.length) {
    throw new AppError(
      `Chegaram ${gravados.length} arquivo(s), e o campo "dados" descreve ` +
      `${plano.arquivos.length}. Mande um arquivo para cada descricao, na mesma ordem.`,
      httpCode.BadRequest
    );
  }

  const promovidos = [];

  try {
    const resultado = await db.conn.tx(async t => {
      let produtoId;
      let versaoId;

      if (plano.tipo === 'arquivos') {
        // Produto e versao ja existem, e a rota so acrescenta arquivo.
        // Reinseri-los seria editar o que ela nao e dona -- por isso o corpo
        // dela nem os aceita.
        produtoId = plano.produto.id;
        versaoId = plano.versaoExistenteId;
      } else {
        produtoId = plano.tipo === 'versao'
          ? plano.produto.id
          : await inserirProdutoDoEnvio(t, plano.produto, usuarioUuid, contexto);

        versaoId = await inserirVersaoDoEnvio(t, plano.versao, produtoId, usuarioUuid, contexto);
      }

      // ---- arquivos: registro ANTES do disco ----
      for (const g of gravados) {
        const criado = await t.one(SQL_INSERT_ARQUIVO, [
          g.declarado.nome,
          g.nome_arquivo,
          versaoId,
          g.declarado.tipo_arquivo_id,
          plano.volume.id,
          g.extensao,
          g.tamanho_mb,
          g.checksum,
          g.declarado.metadado || {},
          // Mesmo status dos outros caminhos que gravam arquivo: o byte acabou
          // de ser escrito e conferido pelo proprio servidor.
          STATUS_ARQUIVO.CARREGADO,
          g.declarado.situacao_carregamento_id || SITUACAO_CARREGAMENTO.NAO_CARREGADO,
          g.declarado.descricao || '',
          g.declarado.crs_original || null,
          usuarioUuid
        ]);

        await registrarArquivoCriado(t, criado, { produtoId, usuarioUuid, contexto });
      }

      // ---- promocao dos bytes, ja com o banco de acordo ----
      for (const g of gravados) {
        await fs.rename(g.caminhoParcial, g.destino);
        promovidos.push(g);
      }

      logger.info('Envio web concluido', {
        tipo: plano.tipo,
        produto_id: produtoId,
        versao_id: versaoId,
        arquivos: gravados.length,
        nome_arquivo: plano.nomePadrao,
        volume: plano.volume.nome,
        usuario_uuid: usuarioUuid
      });

      return {
        produto_id: Number(produtoId),
        versao_id: Number(versaoId),
        nome_arquivo: plano.nomePadrao,
        volume: plano.volume.nome,
        arquivos: gravados.map(g => ({
          nome: g.declarado.nome,
          nome_arquivo: g.nome_arquivo,
          extensao: g.extensao,
          checksum: g.checksum,
          tamanho_mb: g.tamanho_mb
        }))
      };
    });

    // Miniatura depois do commit e sem esperar. Ver o comentario longo no fim de
    // `confirmUpload`: renderizar custa segundos e roda processo externo, entao
    // nao pode entrar na transacao nem segurar a resposta de quem enviou.
    dispararMiniatura([resultado.versao_id]);

    return resultado;
  } catch (erro) {
    // Desfaz a promocao dos que ja tinham mudado de nome. A transacao ja abortou
    // sozinha; o disco nao tem rollback, entao ele e desfeito aqui.
    for (const g of promovidos) {
      await fs.rename(g.destino, g.caminhoParcial).catch(() => {});
    }
    throw erro;
  }
};

/** O produto que nasce junto com o envio (caso 'produto'). */
const inserirProdutoDoEnvio = async (t, p, usuarioUuid, contexto) => {
  const { id } = await t.one(
    `INSERT INTO acervo.produto(
      nome, mi, inom, tipo_escala_id, denominador_escala_especial, tipo_produto_id,
      subtipo_produto_id, descricao, geom, data_cadastramento, usuario_cadastramento_uuid
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ST_GeomFromEWKT($9), CURRENT_TIMESTAMP, $10)
    RETURNING id`,
    [p.nome, p.mi, p.inom, p.tipo_escala_id, p.denominador_escala_especial ?? null,
      p.tipo_produto_id, p.subtipo_produto_id ?? null, p.descricao || '', p.geom, usuarioUuid]
  );

  await auditoriaCtrl.registrar(t, {
    tabela: 'acervo.produto',
    registroId: id,
    operacao: 'I',
    // Relido, e não `RETURNING *`: a geometria precisa sair em EWKT, e quem
    // sabe fazer isso é o `lerDepois`.
    depois: await auditoriaCtrl.lerDepois(t, 'acervo.produto', id),
    usuarioUuid,
    contexto
  });

  return id;
};

/**
 * A versao do envio.
 *
 * O gatilho `acervo.validate_version` arbitra formato, sequencia e a coerencia
 * produto/subtipo. O formulario o espelha para dar a frase certa antes do envio,
 * mas quem decide continua sendo ele.
 */
const inserirVersaoDoEnvio = async (t, v, produtoId, usuarioUuid, contexto) => {
  const criada = await t.one(
    // `meta_pit_id` e `data_prevista` GRAVAM aqui desde 2026-08-05, e
    // `demanda_extra_id` desde 2026-09-05. Antes o schema nem os aceitava, e o
    // que o formulário escolhia era descartado em silêncio: a versão nascia
    // pronta e fora da conta do PIT (ou do Extra-PIT). A exclusão entre a meta e
    // a demanda é do CHECK `versao_plano_ou_excecao`, espelhado no `.oxor` de
    // `versaoWeb`.
    `INSERT INTO acervo.versao(
      uuid_versao, versao, nome, tipo_versao_id, subtipo_produto_id, produto_id,
      lote_id, metadado, descricao, orgao_produtor, palavras_chave, data_criacao,
      data_edicao, meta_pit_id, demanda_extra_id, data_prevista,
      usuario_cadastramento_uuid, data_cadastramento
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP)
    RETURNING *`,
    [
      v.uuid_versao || uuidv4(), v.versao, v.nome, v.tipo_versao_id,
      v.subtipo_produto_id, produtoId, v.lote_id ?? null, v.metadado || {},
      v.descricao || '', v.orgao_produtor, v.palavras_chave || [],
      v.data_criacao, v.data_edicao,
      v.meta_pit_id ?? null, v.demanda_extra_id ?? null, v.data_prevista ?? null,
      usuarioUuid
    ]
  );

  await auditoriaCtrl.registrar(t, {
    tabela: 'acervo.versao',
    registroId: criada.id,
    operacao: 'I',
    depois: criada,
    usuarioUuid,
    contexto
  });

  return criada.id;
};



// Catalogacao de produto que JA ESTA no volume, sem transferir nem renomear.
//
// POR QUE NAO E O prepare-upload/product + confirm-upload. Aquele par existe
// para cobrir a janela entre reservar o destino e COPIAR os bytes: sessao de 24
// horas, checksum declarado pelo cliente, quatro tabelas temporarias e uma
// revalidacao. Num volume `layout_origem` o produto ja esta no lugar (entrega de
// convenio, tipicamente grande demais para duplicar), e cada peca daquele par
// cobra por um trabalho que nao acontece:
//
//   1. O confirm-upload le o arquivo INTEIRO para conferir o checksum que o
//      cliente declarou. Mas para declarar aquele checksum o cliente ja tinha
//      lido o arquivo inteiro, pelo mesmo share. Sao duas varreduras do mesmo
//      byte para provar uma copia que nao houve. Aqui o servidor le UMA vez e
//      grava o que ele mesmo mediu, como o /atualizar-checksum ja fazia.
//   2. La a releitura roda DENTRO da transacao, que numa entrega grande fica
//      aberta por horas. Aqui a leitura acontece FORA de transacao nenhuma, e a
//      transacao abre so para os INSERTs.
//   3. La o espaco livre e conferido contra a capacidade do volume. Os bytes
//      catalogados ja estao no disco: o que falta e o REGISTRO. Num volume
//      quase cheio aquela conta recusaria um cadastro que nao ocupa nada.
//   4. La o volume sai de volume_tipo_produto.primario. Aqui o volume e dado de
//      ENTRADA, porque e onde o arquivo ja esta.
//
// O que NAO afrouxa: a unicidade fisica (volume, nome_arquivo, extensao), a
// identidade do produto, a sequencia de versao, os indices unicos do banco e a
// existencia do arquivo.
controller.catalogarProduto = async (requestData, usuarioUuid, contexto) => {
  const { volume_armazenamento_id: volumeId, produtos } = requestData;

  // ---- Fase 1: tudo que se recusa SEM ler um byte ----
  //
  // Vem antes da leitura de proposito: descobrir no arquivo 900 que o INOM do
  // primeiro ja existia custaria horas de leitura para nada.
  const { volume, plano } = await db.conn.task(async t => {
    const volume = await t.oneOrNone(
      `SELECT id, nome, volume, layout_origem
       FROM acervo.volume_armazenamento WHERE id = $1`,
      [volumeId]
    );

    if (!volume) {
      throw new AppError(`Volume de armazenamento ${volumeId} não encontrado`, httpCode.NotFound);
    }

    // A porta que impede esta rota de virar atalho para pular o confirm-upload
    // no acervo comum. Catalogar sem ler byte so e correto onde o byte JA esta,
    // e isso quem declara e o admin, ao marcar o volume.
    if (!volume.layout_origem) {
      throw new AppError(
        `O volume ${volumeId} (${volume.nome}) não guarda o layout de origem. ` +
        `A catalogação in-place só existe para volume marcado com layout_origem, ` +
        `onde o produto já está gravado. Para transferir arquivos, use o prepare-upload.`,
        httpCode.BadRequest
      );
    }

    await assertIdentidadeProdutoLivre(t, produtos);
    assertSequenciaVersoes(produtos);

    const nomesFisicosUsados = new Set();
    const plano = [];

    for (const item of produtos) {
      for (const versao of item.versoes) {
        for (const arquivo of versao.arquivos) {
          const motivo = motivoCaminhoInseguro(arquivo.nome_arquivo);
          if (motivo) {
            throw new AppError(
              `O caminho "${arquivo.nome_arquivo}" ${motivo}.`,
              httpCode.BadRequest
            );
          }

          await assertNomeFisicoLivre(
            t, volumeId, arquivo.nome_arquivo, arquivo.extensao, nomesFisicosUsados
          );

          plano.push({
            arquivo,
            caminho: caminhoNoVolume(volume.volume, `${arquivo.nome_arquivo}.${arquivo.extensao}`)
          });
        }
      }
    }

    return { volume, plano };
  });

  // ---- Fase 2: a unica leitura dos bytes, FORA de transacao ----
  //
  // O `stat` separado do stream existe para dar erro legivel: sem ele, uma
  // subpasta apontada por engano viraria um EISDIR cru do stream.
  const medidas = new Map();
  const inicio = Date.now();
  let totalMb = 0;

  for (const { arquivo, caminho } of plano) {
    let info;
    try {
      info = await fs.stat(caminho);
    } catch (error) {
      throw new AppError(
        `Arquivo não encontrado no volume: ${arquivo.nome_arquivo}.${arquivo.extensao}. ` +
        `A catalogação não copia nada, então o arquivo precisa já estar no volume.`,
        httpCode.NotFound,
        error
      );
    }

    if (!info.isFile()) {
      throw new AppError(
        `O caminho ${arquivo.nome_arquivo}.${arquivo.extensao} não é um arquivo no volume`,
        httpCode.BadRequest
      );
    }

    const { checksum, fileSizeMB } = await calculateChecksumStream(caminho);
    medidas.set(arquivo, { checksum, tamanho_mb: fileSizeMB });
    totalMb += fileSizeMB;
  }

  const segundosLeitura = (Date.now() - inicio) / 1000;

  logger.info('Leitura do volume concluída para catalogação in-place', {
    volume_armazenamento_id: volumeId,
    arquivos: plano.length,
    total_mb: Number(totalMb.toFixed(2)),
    segundos: Number(segundosLeitura.toFixed(1)),
    usuario_uuid: usuarioUuid
  });

  // ---- Fase 3: transacao curta, so INSERT ----
  return db.conn.tx(async t => {
    try {
      // A fase 1 conferiu com o banco de minutos (ou horas) atras. Reconferir
      // aqui troca uma violacao crua de indice unico por um 409 que diz qual
      // arquivo colidiu; os indices parciais continuam sendo a rede embaixo.
      const nomesFisicosUsados = new Set();
      const resultado = [];

      for (const item of produtos) {
        const { id: produtoId } = await t.one(
          `INSERT INTO acervo.produto(
            nome, mi, inom, tipo_escala_id, denominador_escala_especial, tipo_produto_id,
            subtipo_produto_id, descricao, data_cadastramento, usuario_cadastramento_uuid, geom
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, $9, ST_GeomFromEWKT($10))
          RETURNING id`,
          [
            item.produto.nome,
            item.produto.mi,
            item.produto.inom,
            item.produto.tipo_escala_id,
            item.produto.denominador_escala_especial,
            item.produto.tipo_produto_id,
            item.produto.subtipo_produto_id ?? null,
            item.produto.descricao || '',
            usuarioUuid,
            item.produto.geom
          ]
        );

        await auditoriaCtrl.registrar(t, {
          tabela: 'acervo.produto',
          registroId: produtoId,
          operacao: 'I',
          depois: await auditoriaCtrl.lerDepois(t, 'acervo.produto', produtoId),
          usuarioUuid,
          contexto
        });

        const versoesResultado = [];

        for (const versao of item.versoes) {
          const versaoCriada = await t.one(
            // Mesmo trio do outro caminho de envio: ver `inserirVersaoDoEnvio`.
            // Os dois leem o MESMO `versaoWeb`, entao o que um aceita o outro
            // tem de gravar -- e o que nao se grava aqui volta a ser descarte
            // mudo, que e o defeito que esta linha veio fechar.
            `INSERT INTO acervo.versao(
              uuid_versao, versao, nome, tipo_versao_id, subtipo_produto_id, produto_id,
              lote_id, metadado, descricao, orgao_produtor, palavras_chave, data_criacao,
              data_edicao, meta_pit_id, demanda_extra_id, data_prevista,
              usuario_cadastramento_uuid, data_cadastramento
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP)
            RETURNING *`,
            [
              versao.uuid_versao || uuidv4(),
              versao.versao,
              versao.nome,
              versao.tipo_versao_id,
              versao.subtipo_produto_id,
              produtoId,
              versao.lote_id,
              versao.metadado || {},
              versao.descricao || '',
              versao.orgao_produtor,
              versao.palavras_chave || [],
              versao.data_criacao,
              versao.data_edicao,
              versao.meta_pit_id ?? null,
              versao.demanda_extra_id ?? null,
              versao.data_prevista ?? null,
              usuarioUuid
            ]
          );

          const versaoId = versaoCriada.id;

          await auditoriaCtrl.registrar(t, {
            tabela: 'acervo.versao',
            registroId: versaoId,
            operacao: 'I',
            depois: versaoCriada,
            usuarioUuid,
            contexto
          });

          const arquivosResultado = [];

          for (const arquivo of versao.arquivos) {
            await assertNomeFisicoLivre(
              t, volumeId, arquivo.nome_arquivo, arquivo.extensao, nomesFisicosUsados
            );

            const medida = medidas.get(arquivo);

            const arquivoCriado = await t.one(
              SQL_INSERT_ARQUIVO,
              [
                arquivo.nome,
                arquivo.nome_arquivo,
                versaoId,
                arquivo.tipo_arquivo_id,
                volumeId,
                arquivo.extensao,
                medida.tamanho_mb,
                medida.checksum,
                arquivo.metadado || {},
                STATUS_ARQUIVO.CARREGADO,
                arquivo.situacao_carregamento_id || SITUACAO_CARREGAMENTO.NAO_CARREGADO,
                arquivo.descricao || '',
                arquivo.crs_original || null,
                usuarioUuid
              ]
            );

            await registrarArquivoCriado(t, arquivoCriado, { produtoId, usuarioUuid, contexto });

            arquivosResultado.push({
              arquivo_id: arquivoCriado.id,
              nome_arquivo: arquivo.nome_arquivo,
              extensao: arquivo.extensao,
              checksum: medida.checksum,
              tamanho_mb: medida.tamanho_mb
            });
          }

          versoesResultado.push({
            versao_id: versaoId,
            versao: versao.versao,
            arquivos: arquivosResultado
          });
        }

        resultado.push({
          produto_id: produtoId,
          mi: item.produto.mi,
          inom: item.produto.inom,
          versoes: versoesResultado
        });
      }

      return {
        volume: { id: volume.id, nome: volume.nome },
        produtos: resultado,
        total_arquivos: plano.length,
        total_mb: totalMb,
        segundos_leitura: segundosLeitura
      };
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw new AppError(`Erro ao catalogar produto no volume: ${error.message}`, httpCode.InternalError, error);
      }
      throw error;
    }
  }).then(resultado => {
    // Miniatura depois do commit e sem esperar, como nos outros dois pontos de
    // entrada. Aqui a lista pode ser LONGA: a catalogacao in-place varre um
    // volume inteiro. A geracao e sequencial de proposito (uma versao por vez,
    // dentro de `gerarParaVersoes`), senao uma catalogacao de lote dispararia
    // centenas de processos externos de uma vez.
    dispararMiniatura(
      (resultado?.produtos || []).flatMap(p => (p.versoes || []).map(v => v.versao_id))
    );

    return resultado;
  });
};

/**
 * As sessoes de envio que FALHARAM, com o detalhe de qual arquivo caiu.
 *
 * Uma consulta so, e nao uma por sessao mais uma por produto: o rascunho inteiro
 * vem no `payload`, e o unico dado que ele nao tem e o NOME do produto que ja
 * existe no acervo (caso `add_version`), lido em bloco no fim.
 *
 * So sessao `failed` chega aqui. Sessao confirmada e sessao cancelada morrem no
 * ato, entao a tabela nao guarda o que deu certo.
 *
 * O OPERADOR VE AS DELE, e o gerente ve as da area. A consulta nao filtrava por
 * usuario nenhum e a rota pede so perfil `operador`: qualquer operador do acervo
 * via o nome de quem enviou e o RASCUNHO INTEIRO do envio alheio (nome de
 * arquivo, produto, versao). Pela regua do sistema, "ver tudo da area" e do
 * GERENTE. Subir o piso da rota resolveria pelo lado errado: o operador precisa
 * das dele, que sao justamente as que ele tem de consertar.
 *
 * @param {string|null} usuarioUuid  null (gerente/administrador) traz todas
 */
controller.getProblemUploads = async (usuarioUuid = null) => {
  return db.conn.task(async t => {
    const failedSessions = await t.any(
      `SELECT us.uuid_session, us.operation_type, us.status,
              us.error_message, us.created_at, us.completed_at, us.payload,
              u.nome as usuario_nome
       FROM acervo.upload_session us
       JOIN dgeo.usuario u ON us.usuario_uuid = u.uuid
       WHERE us.status = 'failed'
         AND ($<usuarioUuid> IS NULL OR us.usuario_uuid = $<usuarioUuid>)
       ORDER BY us.created_at DESC
       LIMIT 50`,
      { usuarioUuid }
    );

    // O nome do produto de todas as sessoes `add_version` de uma vez.
    const produtoIds = failedSessions
      .filter(s => s.operation_type === 'add_version')
      .flatMap(s => ((s.payload || {}).versoes || []).map(v => v.produto_id))
      .filter(id => id != null);

    const nomeDoProduto = new Map();
    if (produtoIds.length > 0) {
      const linhas = await t.any(
        'SELECT id, nome FROM acervo.produto WHERE id IN ($<ids:csv>)',
        { ids: [...new Set(produtoIds.map(Number))] }
      );
      for (const p of linhas) nomeDoProduto.set(String(p.id), p.nome);
    }

    /** So os arquivos que falharam, no formato que a tela do plugin le. */
    const falhos = (arquivos) => (arquivos || [])
      .filter(a => a.status === 'failed')
      .map(a => ({
        nome: a.nome,
        nome_arquivo: a.nome_arquivo,
        error_message: a.error_message
      }));

    return failedSessions.map(session => {
      const payload = session.payload || {};

      const sessionDetails = {
        session_uuid: session.uuid_session,
        operation_type: session.operation_type,
        status: session.status,
        error_message: session.error_message,
        created_at: session.created_at,
        completed_at: session.completed_at,
        usuario_nome: session.usuario_nome
      };

      switch (session.operation_type) {
        // `replace_files` entra JUNTO de `add_files`: as duas gravam o
        // `versao_id` no proprio arquivo do rascunho, e sem este caso a sessao
        // de substituicao que falhava aparecia na tela sem dizer QUAL arquivo
        // falhou.
        case 'replace_files':
        case 'add_files': {
          const porVersao = new Map();

          for (const arquivo of (payload.arquivos || [])) {
            if (arquivo.status !== 'failed' || arquivo.versao_id == null) continue;
            const chave = String(arquivo.versao_id);
            if (!porVersao.has(chave)) porVersao.set(chave, []);
            porVersao.get(chave).push({
              nome: arquivo.nome,
              nome_arquivo: arquivo.nome_arquivo,
              error_message: arquivo.error_message
            });
          }

          sessionDetails.versoes_com_problema = [...porVersao.entries()].map(
            ([versaoId, arquivos]) => ({
              versao_id: parseInt(versaoId, 10),
              arquivos_com_problema: arquivos
            })
          );
          break;
        }

        case 'add_version':
          sessionDetails.versoes_com_problema = (payload.versoes || []).map(versao => ({
            produto_id: versao.produto_id,
            produto_nome: nomeDoProduto.get(String(versao.produto_id)) || null,
            versao_info: {
              versao: versao.versao,
              nome: versao.nome
            },
            arquivos_com_problema: falhos(versao.arquivos)
          }));
          break;

        case 'add_product':
          sessionDetails.produtos_com_problema = (payload.produtos || []).map(produto => ({
            produto_info: {
              nome: produto.nome,
              inom: produto.inom,
              mi: produto.mi
            },
            versoes_com_problema: (produto.versoes || []).map(versao => ({
              versao_info: {
                versao: versao.versao,
                nome: versao.nome
              },
              arquivos_com_problema: falhos(versao.arquivos)
            }))
          }));
          break;
      }

      return sessionDetails;
    });
  });
};

/** O desfecho de UM arquivo, como o cliente o lê. */
const resumoDoArquivo = (a) => ({
  nome: a.nome,
  nome_arquivo: a.nome_arquivo,
  status: a.status,
  error_message: a.error_message
});

/**
 * Os arquivos de `add_files` e `replace_files`, agrupados pela versão de destino.
 *
 * É a forma da resposta nas duas operações, e também a do `detalhes` quando elas
 * falham. Sai do rascunho, e não de uma releitura: o rascunho é onde o confirm
 * acabou de escrever o desfecho de cada arquivo.
 */
const porVersaoDeDestino = (payload) => {
  const grupos = new Map();
  for (const arquivo of (payload.arquivos || [])) {
    // O `versao_id` sai como TEXTO, e nao como o numero que o rascunho guarda.
    // E o que o corpo do confirm sempre respondeu: antes ele vinha de um SELECT,
    // e o driver devolve BIGINT em texto. Os caminhos `add_version` e
    // `add_product` continuam assim, porque o id deles vem do INSERT. Deixar
    // este virar numero faria a MESMA rota responder dois tipos para o mesmo
    // campo, dependendo da operacao.
    const chave = String(arquivo.versao_id);
    if (!grupos.has(chave)) {
      grupos.set(chave, { versao_id: chave, files: [] });
    }
    grupos.get(chave).files.push(resumoDoArquivo(arquivo));
  }
  return [...grupos.values()];
};

/**
 * O detalhe da FALHA, na forma que cada operação comporta.
 *
 * Em `add_version` e `add_product` não há id de acervo a citar (nada foi criado),
 * então o que identifica o grupo é o rótulo que a pessoa digitou: a edição da
 * versão e o nome do produto. O desenho antigo respondia aqui o id da linha
 * temporária, que não apontava para registro nenhum.
 */
const detalhesDaFalha = (payload) => {
  if (payload.arquivos) return porVersaoDeDestino(payload);

  if (payload.versoes) {
    return payload.versoes.map(v => ({
      produto_id: v.produto_id,
      versao: v.versao,
      files: (v.arquivos || []).map(resumoDoArquivo)
    }));
  }

  if (payload.produtos) {
    return payload.produtos.flatMap(p => (p.versoes || []).map(v => ({
      produto: p.nome || p.mi || p.inom,
      versao: v.versao,
      files: (v.arquivos || []).map(resumoDoArquivo)
    })));
  }

  return [];
};

// O confirm-upload é onde o evento do caminho do PLUGIN nasce.
//
// O `prepare-upload` e o `cancel-upload` NÃO auditam, e é deliberado: sessão que
// não virou arquivo não mudou o acervo. Ela vive só em `acervo.upload_session`,
// que é efêmera por natureza, e registrar a reserva como se fosse cadastro faria
// a trilha contar duas vezes o que aconteceu uma. É aqui que a linha entra em
// `acervo.produto`, `acervo.versao` e `acervo.arquivo`, e é aqui que o rastro
// começa.
//
// A SESSÃO MORRE AQUI, na MESMA transação que cria as linhas reais. Depois do
// confirm ela não serve para nada: o histórico do que entrou já está em
// `auditoria.evento`, que é append-only. Ou as linhas nascem e a sessão some
// juntas, ou nenhuma das duas coisas acontece. Mantê-la transformava a tabela em
// arquivo morto -- 2.555 sessões `completed` em produção em 06/08/2026, a mais
// antiga de 10/06/2026, nenhuma delas lida por nada.
controller.confirmUpload = async (sessionUuid, usuarioUuid, contexto) => {
  // Falha de processamento precisa ser persistida fora da transação:
  // o rollback desfaria um UPDATE de status feito dentro dela
  let processingFailure = null;

  // As versões que de fato ganharam arquivo, para a miniatura depois do commit.
  // Sai dos `process*`, que são quem grava, e não do corpo da resposta: aquele
  // não devolve nada em caso de falha.
  const versoesParaMiniatura = [];

  return db.conn.tx(async t => {
    try {
      const session = await t.oneOrNone(
        `SELECT * FROM acervo.upload_session WHERE uuid_session = $1 AND status = 'pending'`,
        [sessionUuid]
      );

      if (!session) {
        throw new AppError('Sessão de upload não encontrada ou já processada', httpCode.NotFound);
      }

      if (session.usuario_uuid !== usuarioUuid) {
        throw new AppError('Usuário não autorizado para esta sessão de upload', httpCode.Forbidden);
      }

      // A EXPIRAÇÃO VALE AQUI, na hora do uso, e não só quando alguém limpa.
      // NÃO HÁ AGENDADOR: a `cleanup_expired_uploads()` só roda quando um
      // administrador aperta o botão, então a sessão vencida continua `pending`
      // por dias. Sem esta guarda o confirm aceitava um destino reservado
      // semanas antes, e o `destination_path` daquela reserva pode ter sido
      // reocupado desde então: o `upload-web` e os outros `prepare` não olham
      // sessão pendente ao escolher o nome físico (ver `assertNomeFisicoLivre`),
      // então o destino pode ter sido tomado por outro caminho. É a mesma regra
      // do `confirmDownload` ao lado e do `ponto_controle/upload_ctrl.js`.
      //
      // A sessão vira `failed` DENTRO da transação, e o `processingFailure`
      // regrava fora dela: a exceção abaixo aborta esta transação e desfaria o
      // UPDATE.
      if (new Date(session.expiration_time) < new Date()) {
        // O RASCUNHO VAI JUNTO, com cada arquivo marcado. A tela de "uploads com
        // problema" existe para mostrar QUAL arquivo falhou, e não só que a
        // sessão falhou: sem esta marcação ela listava a sessão vencida com a
        // lista de arquivos VAZIA (todos ainda `pending`), e quem a abrisse não
        // saberia o que estava sendo enviado. É a mesma gravação que o ramo do
        // checksum divergente já faz logo abaixo.
        const rascunho = session.payload || {};
        for (const arquivo of arquivosDoRascunho(rascunho)) {
          arquivo.status = 'failed';
          arquivo.error_message = 'Sessão de envio expirada';
        }

        processingFailure = {
          sessionId: session.id,
          message: MSG_SESSAO_VENCIDA,
          payload: rascunho
        };
        // A MENSAGEM CITA A SAIDA. Ate 2026-09-05 ela mandava refazer o
        // prepare-upload e transferir tudo de novo, que para centenas de GB ja
        // copiadas e o pior conselho possivel. Renovar devolve o prazo sem mexer
        // no rascunho nem nos bytes.
        throw new AppError(
          'Sessão de upload expirada. Renove a sessão em '
          + 'POST /api/arquivo/renovar-upload e confirme de novo; '
          + 'os arquivos já copiados continuam valendo.',
          httpCode.BadRequest
        );
      }

      const payload = session.payload || {};
      // Os objetos são os do PRÓPRIO `payload`: marcar um arquivo como falho
      // escreve na árvore, e o UPDATE do fim grava tudo de uma vez. Era isto ou
      // um UPDATE por arquivo, que é o que o desenho de três tabelas fazia.
      const arquivos = arquivosDoRascunho(payload);

      if (arquivos.length === 0) {
        throw new AppError('Nenhum arquivo encontrado para esta sessão', httpCode.BadRequest);
      }

      let allValid = true;

      for (const arquivo of arquivos) {
        const filePath = arquivo.destination_path;
        const isTileserver = arquivo.tipo_arquivo_id === TIPO_ARQUIVO.TILESERVER;

        // O CHECKSUM É DECLARADO PELO CLIENTE, e por isso o arquivo é relido
        // aqui. Neste caminho quem copia os bytes é o plugin, por SMB, e o
        // servidor não os viu passar: a releitura é a única coisa que prova que
        // a cópia chegou inteira. O envio pelo NAVEGADOR não passa por aqui --
        // lá o checksum sai do mesmo passo que grava o byte, e reler seria
        // refazer o custo que a catalogação in-place documenta ter removido
        // (362 GB relidos no LOTE_1 do Convênio RS, de 1h20 a 3h).
        try {
          if (isTileserver) {
            // Tileserver é uma URL. Não há arquivo físico para validar
            arquivo.status = 'completed';
            arquivo.error_message = null;
          } else {
            await fs.access(filePath);

            // Validate checksum via streaming (sem carregar arquivo inteiro em memória)
            const { checksum: calculatedChecksum, fileSizeMB } = await calculateChecksumStream(filePath);

            if (calculatedChecksum !== arquivo.expected_checksum) {
              throw new AppError(
                `Falha na validação do checksum para ${arquivo.nome}`,
                httpCode.BadRequest
              );
            }

            // O tamanho MEDIDO substitui o declarado, e é ele que segue para
            // `acervo.arquivo`: quem grava o número é quem leu o arquivo.
            arquivo.tamanho_mb = fileSizeMB;
            arquivo.status = 'completed';
            arquivo.error_message = null;
          }
        } catch (error) {
          allValid = false;
          arquivo.status = 'failed';
          arquivo.error_message = error instanceof AppError
            ? error.message
            : `Arquivo não encontrado: ${filePath}`;
        }
      }

      if (allValid) {
        try {
          // O QUE OS `process*` CRIARAM DE VERDADE, em `add_version` e
          // `add_product`: cada item traz o id REAL que o INSERT devolveu, mais
          // os arquivos daquela versão. O corpo da resposta sai daqui.
          let criadas = [];

          switch (session.operation_type) {
            case 'add_files':
              versoesParaMiniatura.push(...await processAddFiles(t, session, payload, contexto));
              break;
            case 'replace_files':
              versoesParaMiniatura.push(...await processReplaceFiles(t, session, payload, contexto));
              break;
            case 'add_version':
              criadas = await processAddVersion(t, session, payload, contexto);
              versoesParaMiniatura.push(...criadas.map(c => c.versao_id));
              break;
            case 'add_product':
              criadas = await processAddProduct(t, session, payload, contexto);
              versoesParaMiniatura.push(...criadas.map(c => c.versao_id));
              break;
          }

          // A SESSÃO SOME, na mesma transação dos INSERTs acima.
          await t.none('DELETE FROM acervo.upload_session WHERE id = $1', [session.id]);

          let result;
          switch (session.operation_type) {
            case 'replace_files':
            case 'add_files':
              result = {
                session_uuid: sessionUuid,
                operation_type: session.operation_type,
                status: 'completed',
                versoes: porVersaoDeDestino(payload)
              };
              break;

            // O `versao_id` daqui é o id de `acervo.versao`, e o `produto_id` é
            // o id de `acervo.produto`. Ele vem do INSERT que os `process*`
            // acabaram de fazer, e nunca de um id de linha do rascunho: aquele
            // cabia na mesma faixa do id real, e quem gravasse a resposta
            // guardava um ponteiro para outra versão do acervo, ou para nenhuma.
            case 'add_version':
              result = {
                session_uuid: sessionUuid,
                operation_type: session.operation_type,
                status: 'completed',
                versoes: criadas.map(c => ({
                  produto_id: c.produto_id,
                  versao_id: c.versao_id,
                  files: c.files
                }))
              };
              break;

            case 'add_product': {
              // Reagrupa por produto sem voltar ao banco. Todo produto do
              // `prepare` tem ao menos uma versão (o schema exige `min(1)`),
              // então nenhum produto se perde no agrupamento. A chave é a
              // POSIÇÃO do produto no rascunho, que é o que dois produtos de
              // mesmo nome ainda distingue.
              const porProduto = new Map();
              for (const c of criadas) {
                if (!porProduto.has(c.produto_indice)) {
                  porProduto.set(c.produto_indice, { produto_id: c.produto_id, versoes: [] });
                }
                porProduto.get(c.produto_indice).versoes.push({
                  versao_id: c.versao_id,
                  files: c.files
                });
              }

              result = {
                session_uuid: sessionUuid,
                operation_type: session.operation_type,
                status: 'completed',
                produtos: [...porProduto.values()]
              };
              break;
            }
          }

          return result;
        } catch (error) {
          processingFailure = { sessionId: session.id, message: error.message };

          throw error;
        }
      } else {
        // O RASCUNHO VOLTA PARA O BANCO com o desfecho de cada arquivo dentro.
        // É dele que a tela de uploads com problema lê QUAL arquivo falhou, e
        // sem esta gravação ela só saberia que a sessão falhou.
        await t.none(
          `UPDATE acervo.upload_session
              SET status = 'failed',
                  error_message = 'Um ou mais arquivos falharam na validação',
                  completed_at = NOW(),
                  payload = $2
            WHERE id = $1`,
          [session.id, payload]
        );

        return {
          session_uuid: sessionUuid,
          operation_type: session.operation_type,
          status: 'failed',
          error_message: 'Um ou mais arquivos falharam na validação',
          detalhes: detalhesDaFalha(payload)
        };
      }
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw new AppError(`Erro ao confirmar upload: ${error.message}`, httpCode.InternalError, error);
      }
      throw error;
    }
  }).catch(async error => {
    if (processingFailure) {
      // `payload` só vem no ramo da expiração, que é o único que marca arquivo
      // aqui fora; nos outros o `COALESCE` deixa o rascunho como estava.
      await db.conn.none(
        `UPDATE acervo.upload_session
         SET status = 'failed', error_message = $1, completed_at = NOW(),
             payload = COALESCE($3, payload)
         WHERE id = $2`,
        [processingFailure.message, processingFailure.sessionId,
         processingFailure.payload || null]
      ).catch(() => {});
    }

    throw error;
  }).then(resultado => {
    // MINIATURA, DEPOIS DO COMMIT E SEM ESPERAR.
    //
    // Ela não pode entrar na transação acima: renderizar custa segundos e roda
    // um processo externo, e a transação já segura linhas do acervo. Também não
    // pode ser aguardada aqui, senão quem enviou o arquivo espera a renderização
    // para receber a confirmação. Sem esta chamada, versão nova só ganharia
    // miniatura quando alguém varresse a fila à mão.
    //
    // O `.catch` é obrigatório: esta promessa não volta para o caminho da
    // requisição, então uma rejeição solta derrubaria o processo.
    //
    // A lista vem dos `process*`, e não do corpo da resposta. Lê-la da resposta
    // acertava o caminho ERRADO: `detalhes` só existe quando a sessão FALHA.
    // A miniatura disparava na falha e nunca no sucesso.
    dispararMiniatura(versoesParaMiniatura);

    return resultado;
  });
};

/**
 * O produto dono de cada versão citada, numa consulta só.
 *
 * Os quatro `process*` gravam arquivo em lote, e deixar o mapa de auditoria
 * resolver o agregado custaria um SELECT por arquivo. Aqui a resolução acontece
 * uma vez para o lote inteiro.
 */
async function produtoPorVersao(t, versaoIds) {
  const ids = [...new Set(versaoIds.map(Number))].filter(Number.isFinite);
  if (ids.length === 0) return new Map();
  const linhas = await t.any(
    'SELECT id, produto_id FROM acervo.versao WHERE id IN ($<ids:csv>)',
    { ids }
  );
  return new Map(linhas.map(v => [String(v.id), v.produto_id]));
}

/**
 * Os parâmetros do INSERT em `acervo.arquivo`, a partir do arquivo do rascunho.
 *
 * Um lugar só para os quatro `process*`, porque a lista divergindo entre eles é
 * o defeito que o rascunho em documento veio tirar. O `versaoId` entra à parte:
 * em `add_files` e `replace_files` ele já está no arquivo, e nas outras duas ele
 * só existe depois do INSERT da versão.
 */
const parametrosDoArquivo = (arquivo, versaoId, usuarioUuid) => ([
  arquivo.nome,
  arquivo.nome_arquivo,
  versaoId,
  arquivo.tipo_arquivo_id,
  arquivo.volume_armazenamento_id,
  arquivo.extensao,
  arquivo.tamanho_mb,
  arquivo.expected_checksum,
  arquivo.metadado,
  STATUS_ARQUIVO.CARREGADO, // tipo_status_id
  arquivo.situacao_carregamento_id,
  arquivo.descricao,
  arquivo.crs_original,
  usuarioUuid
]);

/** Os parâmetros do INSERT em `acervo.versao`, a partir da versão do rascunho. */
const parametrosDaVersao = (versao, produtoId, usuarioUuid) => ([
  versao.uuid_versao,
  versao.versao,
  versao.nome,
  versao.tipo_versao_id,
  versao.subtipo_produto_id,
  produtoId,
  versao.lote_id,
  versao.metadado,
  versao.descricao,
  versao.orgao_produtor,
  versao.palavras_chave || [],
  versao.data_criacao,
  versao.data_edicao,
  versao.meta_pit_id,
  versao.data_prevista,
  usuarioUuid
]);

const SQL_INSERT_VERSAO = `INSERT INTO acervo.versao(
  uuid_versao, versao, nome, tipo_versao_id, subtipo_produto_id, produto_id,
  lote_id, metadado, descricao, orgao_produtor, palavras_chave, data_criacao, data_edicao,
  meta_pit_id, data_prevista, usuario_cadastramento_uuid, data_cadastramento
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP)
RETURNING *`;

// Helper function for Scenario 1: Process add_files to main tables
async function processAddFiles(t, session, payload, contexto) {
  try {
    const arquivos = payload.arquivos || [];

    const versaoIds = [...new Set(arquivos.map(a => a.versao_id))];
    const donos = await produtoPorVersao(t, versaoIds);

    for (const arquivo of arquivos) {
      const criado = await t.one(
        SQL_INSERT_ARQUIVO,
        parametrosDoArquivo(arquivo, arquivo.versao_id, session.usuario_uuid)
      );

      // O usuário é o DONO DA SESSÃO, e não quem chamou o confirm: a sessão só
      // pode ser confirmada por quem a abriu, e é dele o cadastro.
      await registrarArquivoCriado(t, criado, {
        produtoId: donos.get(String(arquivo.versao_id)),
        usuarioUuid: session.usuario_uuid,
        contexto
      });
    }

    return versaoIds;
  } catch (error) {
    throw new AppError(`Erro ao processar arquivos: ${error.message}`, httpCode.InternalError, error);
  }
}

// Processa replace_files: para cada arquivo do envio, dentro da MESMA transacao do
// confirm, faz soft-delete do arquivo que ocupa o slot (versao_id, nome_arquivo,
// extensao) -- se houver -- e insere o novo. Atomico: sem meio-termo entre apagar
// e recadastrar. Se o slot estiver vazio (upsert), apenas insere.
async function processReplaceFiles(t, session, payload, contexto) {
  try {
    const arquivos = payload.arquivos || [];

    const motivo = 'Substituído por nova versão do mesmo arquivo (replace-files)';
    const donos = await produtoPorVersao(t, arquivos.map(a => a.versao_id));

    for (const arquivo of arquivos) {
      const produtoId = donos.get(String(arquivo.versao_id));
      // Arquivo que ocupa o slot atualmente (se houver)
      const atual = await t.oneOrNone(
        `SELECT * FROM acervo.arquivo
         WHERE versao_id = $1 AND nome_arquivo = $2 AND extensao = $3`,
        [arquivo.versao_id, arquivo.nome_arquivo, arquivo.extensao]
      );

      if (atual) {
        // Move o antigo para arquivo_deletado (auditoria), espelhando deleteArquivos
        const { id: arquivoDeletadoId } = await t.one(
          `INSERT INTO acervo.arquivo_deletado (
            uuid_arquivo, nome, nome_arquivo, motivo_exclusao, versao_id, tipo_arquivo_id,
            volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado,
            tipo_status_id, situacao_carregamento_id, descricao, crs_original,
            data_cadastramento, usuario_cadastramento_uuid, data_modificacao,
            usuario_modificacao_uuid, data_delete, usuario_delete_uuid
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
          RETURNING id`,
          [
            atual.uuid_arquivo, atual.nome, atual.nome_arquivo, motivo, atual.versao_id, atual.tipo_arquivo_id,
            atual.volume_armazenamento_id, atual.extensao, atual.tamanho_mb, atual.checksum, atual.metadado,
            STATUS_ARQUIVO.EXCLUIDO, atual.situacao_carregamento_id, atual.descricao, atual.crs_original,
            atual.data_cadastramento, atual.usuario_cadastramento_uuid, atual.data_modificacao,
            atual.usuario_modificacao_uuid, new Date(), session.usuario_uuid
          ]
        );
        await t.none(
          `INSERT INTO acervo.download_deletado (arquivo_deletado_id, usuario_uuid, data_download)
           SELECT $1, d.usuario_uuid, d.data_download
           FROM acervo.download d WHERE d.arquivo_id = $2`,
          [arquivoDeletadoId, atual.id]
        );
        await t.none('DELETE FROM acervo.download WHERE arquivo_id = $1', [atual.id]);
        await t.none('DELETE FROM acervo.arquivo WHERE id = $1', [atual.id]);

        // A substituição é uma EXCLUSÃO seguida de uma criação, e o rastro diz
        // as duas: sem o evento de exclusão, o arquivo antigo desapareceria da
        // ficha do produto sem que nada dissesse por quê. Este caminho tem
        // lápide própria (ele não passa por `arquivarArquivos`), e por isso o
        // evento é escrito aqui -- o `atual` já é a linha inteira.
        await auditoriaCtrl.registrar(t, {
          tabela: 'acervo.arquivo',
          registroId: atual.id,
          operacao: 'D',
          antes: atual,
          usuarioUuid: session.usuario_uuid,
          contexto,
          motivo,
          entidadeId: produtoId
        });
      }

      // Insere o novo arquivo no mesmo slot
      const criado = await t.one(
        SQL_INSERT_ARQUIVO,
        parametrosDoArquivo(arquivo, arquivo.versao_id, session.usuario_uuid)
      );

      await registrarArquivoCriado(t, criado, {
        produtoId,
        usuarioUuid: session.usuario_uuid,
        contexto
      });
    }

    return [...donos.keys()].map(Number);
  } catch (error) {
    throw new AppError(`Erro ao substituir arquivos: ${error.message}`, httpCode.InternalError, error);
  }
}

// Helper function for Scenario 2: Process add_version to main tables
//
// Devolve `[{ versao_id, produto_id, files }]`, e nao so a lista de ids: quem
// monta a resposta do confirm precisa do id REAL da versao e do desfecho dos
// arquivos DAQUELA versao. Nenhum id de rascunho sai daqui, e e de proposito: o
// desenho antigo respondia o id da linha temporaria, que nao aponta para versao
// nenhuma do acervo.
async function processAddVersion(t, session, payload, contexto) {
  try {
    const criadas = [];

    for (const versaoRascunho of (payload.versoes || [])) {
      const versaoCriada = await t.one(
        SQL_INSERT_VERSAO,
        parametrosDaVersao(versaoRascunho, versaoRascunho.produto_id, session.usuario_uuid)
      );

      const versaoId = versaoCriada.id;
      criadas.push({
        versao_id: versaoId,
        produto_id: versaoRascunho.produto_id,
        files: (versaoRascunho.arquivos || []).map(resumoDoArquivo)
      });

      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.versao',
        registroId: versaoId,
        operacao: 'I',
        depois: versaoCriada,
        usuarioUuid: session.usuario_uuid,
        contexto
      });

      for (const arquivo of (versaoRascunho.arquivos || [])) {
        const criado = await t.one(
          SQL_INSERT_ARQUIVO,
          parametrosDoArquivo(arquivo, versaoId, session.usuario_uuid)
        );

        await registrarArquivoCriado(t, criado, {
          produtoId: versaoRascunho.produto_id,
          usuarioUuid: session.usuario_uuid,
          contexto
        });
      }
    }

    return criadas;
  } catch (error) {
    throw new AppError(`Erro ao processar versões: ${error.message}`, httpCode.InternalError, error);
  }
}

// Helper function for Scenario 3: Process add_product to main tables
//
// Devolve `[{ produto_indice, produto_id, versao_id, files }]`, uma entrada por
// VERSAO criada, pela mesma razao do `processAddVersion`. O `produto_indice` e a
// POSICAO do produto no rascunho, e serve so para reagrupar a resposta: dois
// produtos de mesmo nome continuam distintos, e nenhum id de rascunho vaza para
// o cliente.
async function processAddProduct(t, session, payload, contexto) {
  try {
    const criadas = [];
    const produtos = payload.produtos || [];

    for (let indice = 0; indice < produtos.length; indice += 1) {
      const produtoRascunho = produtos[indice];

      const { id: produtoId } = await t.one(
        `INSERT INTO acervo.produto(
          nome, mi, inom, tipo_escala_id, denominador_escala_especial, tipo_produto_id,
          subtipo_produto_id, descricao, data_cadastramento, usuario_cadastramento_uuid, geom
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, $9, ST_GeomFromEWKT($10))
        RETURNING id`,
        [
          produtoRascunho.nome,
          produtoRascunho.mi,
          produtoRascunho.inom,
          produtoRascunho.tipo_escala_id,
          produtoRascunho.denominador_escala_especial,
          produtoRascunho.tipo_produto_id,
          produtoRascunho.subtipo_produto_id ?? null,
          produtoRascunho.descricao,
          session.usuario_uuid,
          produtoRascunho.geom
        ]
      );

      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.produto',
        registroId: produtoId,
        operacao: 'I',
        depois: await auditoriaCtrl.lerDepois(t, 'acervo.produto', produtoId),
        usuarioUuid: session.usuario_uuid,
        contexto
      });

      for (const versaoRascunho of (produtoRascunho.versoes || [])) {
        const versaoCriada = await t.one(
          SQL_INSERT_VERSAO,
          parametrosDaVersao(versaoRascunho, produtoId, session.usuario_uuid)
        );

        const versaoId = versaoCriada.id;
        criadas.push({
          produto_indice: indice,
          produto_id: produtoId,
          versao_id: versaoId,
          files: (versaoRascunho.arquivos || []).map(resumoDoArquivo)
        });

        await auditoriaCtrl.registrar(t, {
          tabela: 'acervo.versao',
          registroId: versaoId,
          operacao: 'I',
          depois: versaoCriada,
          usuarioUuid: session.usuario_uuid,
          contexto
        });

        for (const arquivo of (versaoRascunho.arquivos || [])) {
          const criado = await t.one(
            SQL_INSERT_ARQUIVO,
            parametrosDoArquivo(arquivo, versaoId, session.usuario_uuid)
          );

          await registrarArquivoCriado(t, criado, {
            produtoId,
            usuarioUuid: session.usuario_uuid,
            contexto
          });
        }
      }
    }

    return criadas;
  } catch (error) {
    throw new AppError(`Erro ao processar produtos: ${error.message}`, httpCode.InternalError, error);
  }
}

/**
 * As sessoes de envio, do mais novo para o mais velho.
 *
 * Mesmo recorte de `getProblemUploads`: o operador ve as DELE, o gerente e o
 * administrador veem todas.
 *
 * @param {string|null} usuarioUuid  null (gerente/administrador) traz todas
 */
controller.getUploadSessions = async (usuarioUuid = null) => {
  return db.conn.any(
    `SELECT us.id, us.uuid_session, us.operation_type, us.status,
            us.error_message, us.created_at, us.expiration_time, us.completed_at,
            u.nome AS usuario_nome
     FROM acervo.upload_session us
     JOIN dgeo.usuario u ON us.usuario_uuid = u.uuid
     WHERE ($<usuarioUuid> IS NULL OR us.usuario_uuid = $<usuarioUuid>)
     ORDER BY us.created_at DESC
     LIMIT 100`,
    { usuarioUuid }
  );
};

/**
 * Cancela a sessao de upload do PLUGIN.
 *
 * A SESSAO E APAGADA, pela mesma razao do confirm: cancelar e uma finalizacao, e
 * a sessao cancelada nao e lida por nada. A tela de uploads com problema mostra
 * so `failed`, e "a pessoa desistiu" nao e problema a investigar. Ate 06/08/2026
 * ela virava `cancelled` e ficava para sempre.
 *
 * Nao toca em disco, e isso e correto: nesta sessao quem copia os bytes e o
 * cliente, por SMB, e o servidor nunca escreveu nada que lhe caiba apagar. O
 * envio pelo NAVEGADOR nao passa por aqui (ele nao usa sessao), e o `.parcial`
 * dele e limpo na propria requisicao que falhou.
 *
 * Arquivo ja copiado para o nome definitivo NAO se apaga: cancelar registra que
 * a sessao nao vai virar cadastro, e nao autoriza destruir byte que pode ser o
 * de outra sessao ou de um confirm anterior. O byte que o cliente copiou e nunca
 * confirmou fica orfao no volume, e HOJE NINGUEM O RECOLHE: e defeito conhecido,
 * e nao efeito desta funcao.
 */
controller.cancelUpload = async (sessionUuid, usuarioUuid) => {
  return db.conn.tx(async t => {
    const session = await t.oneOrNone(
      `SELECT * FROM acervo.upload_session WHERE uuid_session = $1 AND status = 'pending'`,
      [sessionUuid]
    );

    if (!session) {
      throw new AppError('Sessão de upload não encontrada ou já processada', httpCode.NotFound);
    }

    // Verificar se o usuário é o dono da sessão ou admin
    if (session.usuario_uuid !== usuarioUuid) {
      // Verificar se é admin
      const usuario = await t.oneOrNone(
        'SELECT administrador FROM dgeo.usuario WHERE uuid = $1',
        [usuarioUuid]
      );
      if (!usuario || !usuario.administrador) {
        throw new AppError('Apenas o criador da sessão ou um administrador pode cancelá-la', httpCode.Forbidden);
      }
    }

    await t.none('DELETE FROM acervo.upload_session WHERE id = $1', [session.id]);

    // Nao ha `.parcial` a apagar aqui. Ele so existe no envio pelo NAVEGADOR, e
    // aquele caminho nao usa sessao: metadados e bytes vao numa requisicao so, e
    // a limpeza do parcial acontece na propria requisicao que falhou. A sessao
    // cobre o caminho do PLUGIN, onde quem copia os bytes e o cliente e o
    // servidor nunca escreveu nada para limpar.
  });
};

/**
 * Devolve 24 horas de prazo a uma sessao de envio, sem mexer no rascunho.
 *
 * A SAIDA que faltava ao lado da guarda de expiracao do `confirmUpload`. O prazo
 * e de 24 horas contadas do `prepare-upload`, e quem copia os bytes neste
 * caminho e o plugin, por SMB: uma carga de centenas de GB atravessa o prazo com
 * facilidade (o proprio codigo registra um lote de 362 GB que levou de 1h20 a 3h
 * em condicao boa). Ate 2026-09-05 o unico caminho depois do vencimento era
 * refazer o prepare-upload e TRANSFERIR TUDO DE NOVO, jogando fora byte que ja
 * estava no lugar certo e deixando o que fora copiado orfao no volume, que hoje
 * ninguem recolhe.
 *
 * DUAS SESSOES SE RENOVAM, e a segunda e o caso comum:
 *
 *   1. a `pending` ainda aberta, renovada antes de o prazo acabar;
 *   2. a `failed` que o `confirm-upload` fechou POR VENCIMENTO, reconhecida pelo
 *      `MSG_SESSAO_VENCIDA` que ele mesmo gravou. Sem ela a rota 404 justamente
 *      no caso que a criou: quem descobre o vencimento e o confirm, e o confirm
 *      fecha a sessao antes de responder o 400 que manda renovar.
 *
 * A que falhou por CHECKSUM (ou por erro de gravacao) NAO se renova: ali o
 * problema e o byte, e nao o relogio. Renovar so devolveria o mesmo diagnostico.
 *
 * O QUE ELA NAO FAZ, e e deliberado: nao reconfere se o `destination_path`
 * reservado continua livre. Renovar devolve o PRAZO; quem confere o destino
 * continua sendo o `confirm-upload`, que rele cada arquivo e casa o checksum
 * declarado. Destino que mudou de dono se descobre la, com a mensagem de sempre.
 *
 * NAO AUDITA, pela mesma regra do `prepare-upload` e do `cancel-upload`: sessao
 * que nao virou arquivo nao mudou o acervo, `acervo.upload_session` nao tem
 * entrada em `auditoria/mapa/acervo.js`, e a trilha do que entrou nasce no
 * `confirm-upload`.
 *
 * @param {string} sessionUuid
 * @param {string} usuarioUuid - o dono, tirado do TOKEN
 * @returns {Promise<{session_uuid:string, expiration_time:Date}>}
 */
controller.renovarUpload = async (sessionUuid, usuarioUuid) => {
  return db.conn.tx(async t => {
    const session = await t.oneOrNone(
      `SELECT id, uuid_session, usuario_uuid, payload FROM acervo.upload_session
        WHERE uuid_session = $1
          AND (status = 'pending' OR (status = 'failed' AND error_message = $2))`,
      [sessionUuid, MSG_SESSAO_VENCIDA]
    );

    if (!session) {
      throw new AppError(
        'Sessão de upload não encontrada, já processada ou fechada por outro motivo',
        httpCode.NotFound
      );
    }

    // O mesmo recorte do `cancelUpload` ao lado: o dono, ou o administrador
    // global. Gerente do acervo NAO entra: renovar prazo de sessao alheia e
    // mexer no envio de outra pessoa, e nao ler o que ela esta fazendo.
    if (session.usuario_uuid !== usuarioUuid) {
      const usuario = await t.oneOrNone(
        'SELECT administrador FROM dgeo.usuario WHERE uuid = $1',
        [usuarioUuid]
      );
      if (!usuario || !usuario.administrador) {
        throw new AppError(
          'Apenas o criador da sessão ou um administrador pode renová-la',
          httpCode.Forbidden
        );
      }
    }

    // O RASCUNHO VOLTA A `pending`, arquivo por arquivo. A sessao fechada por
    // vencimento carrega cada arquivo marcado como falho (e o que faz a tela de
    // uploads com problema dizer o que estava sendo enviado); renovada, ela sai
    // daquela tela e volta para a lista de sessoes abertas, e um arquivo `failed`
    // dentro de uma sessao `pending` seria estado que nao se le. O desfecho real
    // de cada arquivo e reescrito pelo proximo confirm, que rele todos.
    const payload = session.payload || {};
    for (const arquivo of arquivosDoRascunho(payload)) {
      arquivo.status = 'pending';
      arquivo.error_message = null;
    }

    // NOW() do BANCO, e nao um Date do Node: `expiration_time` e comparada com o
    // relogio do servidor de banco em `cleanup_expired_uploads()`, e o default da
    // coluna e `CURRENT_TIMESTAMP + INTERVAL '24 hours'`. Sao as mesmas 24 horas
    // que o `prepare-upload` concede, contadas de agora.
    const renovada = await t.one(
      `UPDATE acervo.upload_session
          SET expiration_time = NOW() + INTERVAL '24 hours',
              status = 'pending',
              error_message = NULL,
              completed_at = NULL,
              payload = $2
        WHERE id = $1
        RETURNING uuid_session, expiration_time`,
      [session.id, payload]
    );

    return {
      session_uuid: renovada.uuid_session,
      expiration_time: renovada.expiration_time
    };
  });
};

/**
 * Fecha e apaga as sessoes de envio vencidas.
 *
 * ROTA PROPRIA, e nao mais carona na limpeza de DOWNLOAD. Ate 06/08/2026 esta
 * limpeza rodava de dentro de `POST /api/acervo/cleanup-expired-downloads`, e
 * quem quisesse limpar upload tinha de saber que a rota de download tambem fazia
 * isso. Sao dois assuntos, e a sessao de envio mora aqui, ao lado do
 * prepare-upload e do confirm-upload que a criam e a consomem.
 *
 * O NUMERO VEM DA FUNCAO DO BANCO, e nao de uma contagem feita antes de
 * chama-la: contar antes conferia a aritmetica do JavaScript, e a funcao podia
 * parar de escrever sem ninguem notar.
 *
 * @returns {Promise<{fechadas:number, apagadas:number}>}
 */
controller.cleanupExpiredUploads = async (usuarioUuid = null, contexto = null) => {
  return db.conn.tx(async t => {
    const { fechadas, apagadas } = await t.one(
      'SELECT fechadas, apagadas FROM acervo.cleanup_expired_uploads()'
    );

    const resultado = { fechadas, apagadas };

    // Toda execucao tem uma pessoa por tras, e "rodei e nao havia nada" e
    // informacao de auditoria legitima.
    if (usuarioUuid || fechadas > 0 || apagadas > 0) {
      await auditoriaCtrl.registrarOperacao(t, {
        tabela: 'acervo.upload_expirado',
        resultado,
        usuarioUuid,
        contexto
      });
    }

    return resultado;
  });
};

/**
 * Renomeia o arquivo físico para o padrão derivado dos metadados.
 *
 * O nome NÃO vem do cliente: sai de `acervo.nome_arquivo_padrao`, a mesma função
 * que o invariante 7a usa para auditar. Auditor e escritor são a mesma regra.
 *
 * Ordem por arquivo, e ela importa. O UPDATE vai ANTES do disco, dentro da
 * transação: os índices únicos `unique_nome_fisico_por_volume{,_ci}` recusam a
 * colisão ali, com o disco ainda intacto. Só depois de o banco aceitar é que o
 * byte se move. Falhando o rename, o ROLLBACK desfaz tudo e nada mudou.
 *
 * `fs.rename` do Node sobrescreve em silêncio no Windows (libuv usa MoveFileEx com
 * MOVEFILE_REPLACE_EXISTING). Por isso o destino é conferido antes: sobrescrever é
 * o único modo de falha irreversível desta operação, e nenhuma auditoria posterior
 * o detecta.
 *
 * Idempotente. Reexecutar é seguro: cada arquivo é reclassificado pelo estado real
 * (o que está no banco e o que está no disco), nunca por um log da execução
 * anterior. Interrupção no meio não deixa estado que a próxima chamada não resolva.
 */
controller.renomearPadrao = async (arquivoIds, limite, dryRun, motivo, usuarioUuid, contexto) => {
  // Sessão de upload aberta congela um destination_path e a transferência
  // sobrescreve o físico no lugar. Renomear por baixo dela perde bytes.
  const abertas = await db.conn.one(
    `SELECT count(*)::int AS n FROM acervo.upload_session
     WHERE status NOT IN ('completed', 'failed', 'cancelled')`
  );
  if (abertas.n > 0 && !dryRun) {
    throw new AppError(
      `Há ${abertas.n} sessão(ões) de upload aberta(s). Renomear agora sobrescreveria os bytes que elas vão gravar. Espere fechar ou cancele.`,
      httpCode.Conflict
    );
  }

  const filtro = arquivoIds && arquivoIds.length ? 'AND a.id IN ($<ids:csv>)' : '';
  // O `p.id AS produto_id` entra para o rastro: o agregado dono já sai desta
  // consulta, então auditar não custa um SELECT por arquivo num lote de 5.000.
  const divergentes = await db.conn.any(`
    SELECT a.id, a.nome_arquivo, a.extensao, vol.volume, p.id AS produto_id,
           acervo.nome_arquivo_padrao(p.tipo_produto_id, v.subtipo_produto_id, p.mi,
             p.inom, p.nome, p.tipo_escala_id, p.denominador_escala_especial,
             v.versao) AS esperado
    FROM acervo.arquivo a
    JOIN acervo.versao v ON v.id = a.versao_id
    JOIN acervo.produto p ON p.id = v.produto_id
    JOIN acervo.volume_armazenamento vol ON vol.id = a.volume_armazenamento_id
    WHERE a.tipo_arquivo_id <> ${TIPO_ARQUIVO.TILESERVER}
      -- Volume que guarda o layout do fornecedor fica de fora, e o motivo e
      -- irreversivel: renomear um .img do ERDAS quebra a referencia interna ao
      -- .ige, onde estao todos os pixels. O invariante 7a aplica o MESMO filtro.
      -- Ver migrations/2026-07-31_volume_layout_origem.sql.
      AND NOT vol.layout_origem
      AND a.nome_arquivo IS DISTINCT FROM acervo.nome_arquivo_padrao(
        p.tipo_produto_id, v.subtipo_produto_id, p.mi, p.inom, p.nome,
        p.tipo_escala_id, p.denominador_escala_especial, v.versao)
      ${filtro}
    ORDER BY a.id`, { ids: arquivoIds });

  // Nome não computável é defeito de metadado, não de arquivo. Renomear para NULL
  // destruiria a única pista de onde o byte está. Aborta e nomeia os culpados: o
  // invariante 7b lista todos.
  const semNome = divergentes.filter(d => d.esperado === null);
  if (semNome.length > 0) {
    throw new AppError(
      `${semNome.length} arquivo(s) sem nome padrão computável (rótulo de versão ou nome de produto fora do padrão). Conserte os metadados primeiro; veja o invariante 7b. Ids: ${semNome.slice(0, 20).map(d => d.id).join(', ')}`,
      httpCode.BadRequest
    );
  }

  const lote = divergentes.slice(0, limite);
  const resultado = {
    dry_run: dryRun,
    divergentes_total: divergentes.length,
    nesta_chamada: lote.length,
    restantes: Math.max(0, divergentes.length - lote.length),
    renomeados: 0,
    so_banco: 0,
    falhas: 0,
    detalhe: []
  };

  if (dryRun) {
    resultado.amostra = lote.slice(0, 20).map(d => ({
      id: d.id,
      de: `${d.nome_arquivo}.${d.extensao}`,
      para: `${d.esperado}.${d.extensao}`
    }));
    return resultado;
  }

  for (const d of lote) {
    const atual = caminhoNoVolume(d.volume, `${d.nome_arquivo}.${d.extensao}`);
    const alvo = caminhoNoVolume(d.volume, `${d.esperado}.${d.extensao}`);
    let renomeou = false;
    try {
      const temAtual = await fs.access(atual).then(() => true).catch(() => false);
      const temAlvo = await fs.access(alvo).then(() => true).catch(() => false);

      if (!temAtual && !temAlvo) {
        throw new Error('nem o nome atual nem o alvo existem no volume');
      }
      if (temAtual && temAlvo) {
        // Os dois existem: renomear apagaria um. Nunca decide sozinho.
        throw new Error('o nome alvo JÁ EXISTE no volume e é outro arquivo');
      }

      await db.conn.tx(async t => {
        // UMA TRANSAÇÃO POR ARQUIVO, e é correto assim: não existe transação do
        // lote, e o rollback de um arquivo não pode desfazer os que já
        // renomearam no disco. O evento é por arquivo, DENTRO da transação
        // daquele arquivo, e quem amarra os N é o `loteId` do contexto -- um por
        // requisição. Assim a tela mostra uma linha ("Renomeou 4.812 arquivos")
        // que abre nos eventos individuais, e o arquivo que falhou não deixa
        // rastro de uma mudança que não aconteceu.
        const antes = await auditoriaCtrl.lerAntes(t, 'acervo.arquivo', d.id, 'Arquivo');

        // O banco decide primeiro. Colisão estoura aqui, com o disco intacto.
        const depois = await t.oneOrNone(
          `UPDATE acervo.arquivo
           SET nome_arquivo = $<esperado>, data_modificacao = NOW(),
               usuario_modificacao_uuid = $<usuarioUuid>
           WHERE id = $<id> AND nome_arquivo = $<atual>
           RETURNING *`,
          { esperado: d.esperado, usuarioUuid, id: d.id, atual: d.nome_arquivo }
        );
        if (!depois) {
          throw new Error('UPDATE afetou 0 linha(s); outro processo mexeu neste arquivo');
        }

        await auditoriaCtrl.registrar(t, {
          tabela: 'acervo.arquivo',
          registroId: d.id,
          operacao: 'U',
          antes,
          depois,
          usuarioUuid,
          contexto,
          motivo,
          entidadeId: d.produto_id
        });

        if (temAtual) {
          await fs.rename(atual, alvo);
          renomeou = true;
        }
      });

      resultado.renomeados++;
      if (!renomeou) resultado.so_banco++;
    } catch (erro) {
      // A transação já reverteu o banco. Falta desfazer o disco, se moveu.
      if (renomeou) {
        try {
          await fs.rename(alvo, atual);
        } catch (e2) {
          logger.error('Renome revertido no banco mas NAO no disco', {
            arquivo_id: d.id, de: atual, para: alvo, erro: e2.message
          });
        }
      }
      resultado.falhas++;
      resultado.detalhe.push({
        id: d.id,
        de: `${d.nome_arquivo}.${d.extensao}`,
        para: `${d.esperado}.${d.extensao}`,
        erro: erro.message
      });
      // Falha em série é sinal de causa comum (volume caiu, permissão): parar cedo
      // vale mais que insistir 5.000 vezes no mesmo erro.
      if (resultado.falhas >= 20) {
        resultado.interrompido = 'teto de 20 falhas atingido';
        break;
      }
    }
  }

  logger.info('Renome para o nome padrão', {
    usuarioUuid, motivo,
    divergentes: divergentes.length,
    renomeados: resultado.renomeados,
    falhas: resultado.falhas
  });

  return resultado;
};

/**
 * Corrige o NOME FISICO gravado (`nome_arquivo`, e a extensao quando vem), sem
 * tocar em disco.
 *
 * A DIFERENCA PARA O `renomearPadrao`, e ela e o desenho inteiro: la o CATALOGO
 * manda e o byte se move; aqui o DISCO manda e o catalogo se corrige. O caso que
 * pede isto e o volume com `layout_origem`, onde os arquivos sao do fornecedor e
 * foram catalogados onde estao: renomear um `.img` do ERDAS quebraria a
 * referencia interna ao `.ige`, entao a unica ponta que pode ceder e a nossa.
 *
 * O CLIENTE PROPOE, O SERVIDOR VE. O nome alvo nao e computavel a partir de
 * metadado nenhum, ele e uma entrada de diretorio. Por isso a rota nao acredita
 * no corpo: ela le o diretorio e compara os nomes CARACTERE A CARACTERE.
 *
 * A comparacao exata e o ponto, e nao um detalhe de implementacao. `fs.access`
 * responderia "existe" para os dois nomes no Windows e para um so no Linux, o
 * que faria o mesmo conserto passar numa maquina e reprovar noutra. `readdir`
 * devolve o nome REAL, e a comparacao em JavaScript distingue caixa em qualquer
 * plataforma. Foi esse ponto cego que deixou 62 arquivos catalogados com o nome
 * errado por 26 dias: quem conferiu, conferiu pelo SMB do Windows.
 *
 * As cinco recusas, e cada uma existe por um modo de errar:
 *   1. o nome ATUAL ainda existe no volume -> o pedido e um renome, e esta rota
 *      nao move byte. Aceitar aqui faria a linha apontar para OUTRO arquivo.
 *   2. o nome ALVO nao existe no volume -> o cliente errou o nome, e gravar
 *      trocaria um caminho quebrado por outro.
 *   3. o tamanho no disco nao bate com o gravado -> nao e o arquivo que
 *      catalogamos.
 *   4. o sha256 nao bate (quando `conferir_checksum`) -> idem, com prova forte.
 *   5. o trio (volume, nome, extensao) ja e de outro arquivo -> colisao, que os
 *      indices unicos tambem barrariam, mas aqui a mensagem diz com QUEM.
 *
 * NAO MEXE em `tipo_status_id` de proposito. Quem marcou os arquivos com erro
 * foi a verificacao do acervo, e e ela que tem de tirar a marca: a ferramenta
 * que escreve nao se declara certa sozinha.
 */
controller.corrigirNomeFisico = async (arquivos, conferirChecksum, dryRun, motivo, usuarioUuid, contexto) => {
  const ids = arquivos.map(a => a.id);
  const registros = await db.conn.any(`
    SELECT a.id, a.nome_arquivo, a.extensao, a.checksum, a.tamanho_mb,
           a.tipo_arquivo_id, a.volume_armazenamento_id,
           vol.volume, p.id AS produto_id
    FROM acervo.arquivo a
    JOIN acervo.versao v ON v.id = a.versao_id
    JOIN acervo.produto p ON p.id = v.produto_id
    LEFT JOIN acervo.volume_armazenamento vol ON vol.id = a.volume_armazenamento_id
    WHERE a.id IN ($<ids:csv>)`, { ids });

  const porId = new Map(registros.map(r => [Number(r.id), r]));

  const resultado = {
    dry_run: dryRun,
    conferir_checksum: conferirChecksum,
    pedidos: arquivos.length,
    corrigidos: 0,
    sem_mudanca: 0,
    falhas: 0,
    detalhe: []
  };

  // Cache de listagem por diretorio: um lote inteiro costuma cair na MESMA
  // pasta, e ler o diretorio uma vez por arquivo custaria centenas de idas ao
  // volume de rede para responder a mesma pergunta.
  const cacheDir = new Map();
  const listar = async (dir) => {
    if (!cacheDir.has(dir)) {
      try {
        cacheDir.set(dir, new Set(await fs.readdir(dir)));
      } catch (e) {
        cacheDir.set(dir, null);
      }
    }
    return cacheDir.get(dir);
  };

  // O separador depende do VOLUME, não da plataforma de quem chama: em Windows
  // o `caminhoNoVolume` devolve UNC com contrabarra, em Linux o caminho POSIX
  // do ponto de montagem. Cortar pelos dois cobre os dois sem perguntar onde
  // este processo roda.
  const CONTRABARRA = '\\';
  const partirCaminho = (caminho) => {
    const corte = Math.max(caminho.lastIndexOf('/'), caminho.lastIndexOf(CONTRABARRA));
    return { dir: caminho.slice(0, corte), base: caminho.slice(corte + 1) };
  };

  for (const pedido of arquivos) {
    const item = { id: pedido.id, status: null, motivo: null };
    const reg = porId.get(Number(pedido.id));

    const recusar = (razao) => {
      item.status = 'falha';
      item.motivo = razao;
      resultado.falhas++;
      resultado.detalhe.push(item);
    };

    if (!reg) { recusar('arquivo não encontrado no acervo'); continue; }

    const extensaoNova = pedido.extensao === undefined ? reg.extensao : pedido.extensao;
    item.de = `${reg.nome_arquivo}.${reg.extensao}`;
    item.para = `${pedido.nome_arquivo}.${extensaoNova}`;

    if (Number(reg.tipo_arquivo_id) === TIPO_ARQUIVO.TILESERVER) {
      recusar('Tileserver não tem arquivo físico no volume; o nome dele é uma URL'); continue;
    }
    if (!reg.volume) {
      recusar('arquivo sem volume de armazenamento registrado'); continue;
    }
    const inseguro = motivoCaminhoInseguro(pedido.nome_arquivo);
    if (inseguro) { recusar(`nome_arquivo ${inseguro}`); continue; }
    if (typeof extensaoNova !== 'string' || extensaoNova === '' ||
        extensaoNova.includes('/') || extensaoNova.includes('\\') ||
        extensaoNova.split('.').includes('..')) {
      recusar('extensão inválida (não pode ser vazia nem conter separador de caminho)'); continue;
    }

    if (pedido.nome_arquivo === reg.nome_arquivo && extensaoNova === reg.extensao) {
      item.status = 'sem_mudanca';
      item.motivo = 'o nome gravado já é este';
      resultado.sem_mudanca++;
      resultado.detalhe.push(item);
      continue;
    }

    const caminhoAtual = caminhoNoVolume(reg.volume, `${reg.nome_arquivo}.${reg.extensao}`);
    const caminhoAlvo = caminhoNoVolume(reg.volume, `${pedido.nome_arquivo}.${extensaoNova}`);
    const atual = partirCaminho(caminhoAtual);
    const alvo = partirCaminho(caminhoAlvo);

    const dirAlvo = await listar(alvo.dir);
    if (dirAlvo === null) { recusar('a pasta do nome novo não abriu no volume'); continue; }
    if (!dirAlvo.has(alvo.base)) {
      recusar('o nome novo NÃO existe no volume (comparação exata, caixa inclusa)'); continue;
    }

    const dirAtual = await listar(atual.dir);
    if (dirAtual !== null && dirAtual.has(atual.base)) {
      recusar('o nome atual EXISTE no volume: isto seria renomear, e esta rota não move byte'); continue;
    }

    // O colidente se procura no banco antes de tentar gravar: o índice único
    // barraria igual, mas com uma mensagem que não diz com quem colidiu.
    const colisao = await db.conn.oneOrNone(`
      SELECT id FROM acervo.arquivo
      WHERE volume_armazenamento_id = $<volumeId> AND nome_arquivo = $<nome>
        AND extensao = $<ext> AND id <> $<id>`,
    { volumeId: reg.volume_armazenamento_id, nome: pedido.nome_arquivo, ext: extensaoNova, id: reg.id });
    if (colisao) { recusar(`o nome novo já é do arquivo ${colisao.id} neste volume`); continue; }

    let medido;
    try {
      medido = await fs.stat(caminhoAlvo);
    } catch (e) {
      recusar('não consegui medir o arquivo no nome novo'); continue;
    }
    const mbDisco = medido.size / (1024 * 1024);
    const mbGravado = Number(reg.tamanho_mb);
    // Um centésimo de MB: `tamanho_mb` é gravado como ponto flutuante a partir
    // do mesmo cálculo, então a diferença legítima é de arredondamento.
    if (Math.abs(mbDisco - mbGravado) > 0.01) {
      recusar(`tamanho no volume (${mbDisco.toFixed(4)} MB) difere do gravado (${mbGravado.toFixed(4)} MB)`);
      continue;
    }
    item.tamanho_mb = Number(mbDisco.toFixed(4));

    if (conferirChecksum) {
      try {
        const { checksum } = await calculateChecksumStream(caminhoAlvo);
        if (checksum !== reg.checksum) {
          recusar('o sha256 do arquivo no nome novo difere do gravado'); continue;
        }
        item.checksum_conferido = true;
      } catch (e) {
        recusar('não consegui ler o arquivo no nome novo para o sha256'); continue;
      }
    }

    if (dryRun) {
      item.status = 'corrigiria';
      resultado.corrigidos++;
      resultado.detalhe.push(item);
      continue;
    }

    try {
      await db.conn.tx(async t => {
        const antes = await auditoriaCtrl.lerAntes(t, 'acervo.arquivo', reg.id, 'Arquivo');
        const depois = await t.oneOrNone(`
          UPDATE acervo.arquivo
          SET nome_arquivo = $<nome>, extensao = $<ext>, data_modificacao = NOW(),
              usuario_modificacao_uuid = $<usuarioUuid>
          WHERE id = $<id> AND nome_arquivo = $<atual> AND extensao = $<extAtual>
          RETURNING *`,
        {
          nome: pedido.nome_arquivo, ext: extensaoNova, usuarioUuid, id: reg.id,
          atual: reg.nome_arquivo, extAtual: reg.extensao
        });
        if (!depois) {
          throw new Error('UPDATE afetou 0 linha(s); outro processo mexeu neste arquivo');
        }
        await auditoriaCtrl.registrar(t, {
          tabela: 'acervo.arquivo',
          registroId: reg.id,
          operacao: 'U',
          antes,
          depois,
          usuarioUuid,
          contexto,
          motivo,
          entidadeId: reg.produto_id
        });
      });
      item.status = 'corrigido';
      resultado.corrigidos++;
      resultado.detalhe.push(item);
    } catch (erro) {
      recusar(`falha ao gravar: ${erro.message}`);
    }
  }

  logger.info('Correção de nome físico', {
    usuarioUuid, motivo, dryRun,
    pedidos: arquivos.length,
    corrigidos: resultado.corrigidos,
    falhas: resultado.falhas
  });

  return resultado;
};

module.exports = controller;

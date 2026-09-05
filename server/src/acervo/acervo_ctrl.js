"use strict";
const archiver = require('archiver');
const crypto = require('crypto');
const { caminhoNoVolume } = require('../utils/caminho_volume');
// A normalização de MI/INOM era uma cópia de três linhas aqui e outra igual em
// `integracao/integracao_ctrl.js`, e as duas só tiravam caixa e espaço: quem
// pedia a folha `0155` não achava a que está gravada como `155`, sem erro
// nenhum, só um "Não mapeado" falso. Hoje é `utils/mi.js`, o mesmo normalizador
// do `mapoteca_cli`.
const { normalizarIdentificador } = require('../utils/mi');
const miniaturaVarredura = require('../utils/miniatura_varredura');
const { normalizarImagem } = require('../utils/miniatura');
const { SQL_GRAVAR } = require('../utils/miniatura_fila');
const { temValor } = require('../utils/lista_schema');
const { Readable } = require('stream');
const { db } = require("../database");
const invariantes = require("./invariantes");
const { AppError, httpCode, domainConstants: { TIPO_ESCALA, TIPO_ARQUIVO, TIPO_PRODUTO, TIPO_VERSAO, STATUS_ARQUIVO } } = require("../utils");
const { auditoriaCtrl } = require("../auditoria");

const {
  DB_USER,
  DB_PASSWORD,
  DB_SERVER,
  DB_PORT,
  DB_NAME,
  DB_USER_READONLY,
  DB_PASSWORD_READONLY
} = require('../config')

const controller = {};

controller.getProdutosLayer = async () => {
  return db.conn.task(async t => {
    const query = `
      SELECT 
          mv.matviewname,
          tp.nome AS tipo_produto,
          tp.code AS tipo_produto_id,
          te.nome AS tipo_escala,
          te.code AS tipo_escala_id
      FROM pg_matviews mv
      JOIN dominio.tipo_produto tp 
          ON SUBSTRING(mv.matviewname FROM 'mv_produto_(\\d+)_') = tp.code::text
      JOIN dominio.tipo_escala te 
          ON SUBSTRING(mv.matviewname FROM '_([^_]+)$') = te.code::text
      WHERE mv.schemaname = 'acervo' 
        AND mv.matviewname LIKE 'mv_produto_%'
      ORDER BY tp.code, te.code;
    `;
    
    const views = await t.any(query);
    
    const banco_dados = {
      nome_db: DB_NAME,
      servidor: DB_SERVER,
      porta: DB_PORT,
      login: DB_USER_READONLY || DB_USER,
      senha: DB_PASSWORD_READONLY || DB_PASSWORD,
      schema: 'acervo'
    };

    const resultWithCounts = await Promise.all(views.map(async view => {
      const countQuery = `
        SELECT COUNT(*) AS quantidade_produtos
        FROM acervo.${view.matviewname};
      `;
      const countResult = await t.one(countQuery);
      
      return {
        matviewname: view.matviewname,
        tipo_produto: view.tipo_produto,
        tipo_produto_id: view.tipo_produto_id,
        tipo_escala: view.tipo_escala,
        tipo_escala_id: view.tipo_escala_id,
        quantidade_produtos: parseInt(countResult.quantidade_produtos),
        banco_dados: banco_dados
      };
    }));

    return resultWithCounts;
  });
};

controller.getVersaoById = async (versaoId) => {
  const versao = await db.conn.oneOrNone(`
    SELECT
      -- BIGINT chega como STRING no driver, e o PUT /produtos/versao exige
      -- número estrito: sem o cast, reenviar o que esta leitura devolve tomava
      -- 400 em "id". O cast estoura (alto e claro) se o id passar de int4, o que
      -- não acontece na ordem de grandeza do acervo.
      v.id::integer AS id,
      v.uuid_versao,
      v.versao,
      -- nome é a chave que o PUT /produtos/versao exige. Antes esta leitura só
      -- devolvia o apelido nome_versao, então quem lia e reenviava perdia o
      -- campo (o nome_versao era descartado pelo stripUnknown e o nome chegava
      -- ausente). O apelido continua sendo devolvido porque consumidores antigos
      -- leem por ele; o canônico é nome.
      v.nome,
      v.nome AS nome_versao,
      v.tipo_versao_id,
      v.subtipo_produto_id,
      v.produto_id::integer AS produto_id,
      v.lote_id,
      v.meta_pit_id,
      v.demanda_extra_id,
      v.metadado,
      v.descricao,
      v.orgao_produtor,
      v.palavras_chave,
      v.data_criacao,
      v.data_edicao
    FROM acervo.versao v
    WHERE v.id = $1
  `, [versaoId]);

  if (!versao) {
    throw new AppError('Versão não encontrada', httpCode.NotFound);
  }

  return versao;
};

controller.getProdutoById = async (produtoId) => {
  const produto = await db.conn.oneOrNone(`
    SELECT
      -- Mesma razão do GET de versão: BIGINT vira string no driver e o PUT
      -- /produtos/produto exige número estrito
      p.id::integer AS id,
      p.nome,
      p.mi,
      p.inom,
      p.tipo_escala_id,
      p.denominador_escala_especial,
      p.tipo_produto_id,
      -- Identidade do produto (24 = Carta Topográfica Militar, NULL = civil).
      -- Ficava de fora desta leitura enquanto o PUT /produtos/produto a aceitava:
      -- reenviar o que o GET devolvia apagava a identidade sem erro nenhum.
      p.subtipo_produto_id,
      p.descricao,
      -- EWKT, e não a coluna crua: o PUT reescreve com ST_GeomFromEWKT, que não
      -- aceita o hex EWKB que o driver devolveria para a coluna crua
      ST_AsEWKT(p.geom) AS geom
    FROM acervo.produto p
    WHERE p.id = $1
  `, [produtoId]);

  if (!produto) {
    throw new AppError('Produto não encontrado', httpCode.NotFound);
  }

  return produto;
};

/**
 * Metadado da miniatura de uma versao, SEM o binario.
 *
 * Existe separado da leitura do conteudo porque e ele que decide o 304: a
 * revalidacao do navegador precisa comparar a etiqueta, e nao trazer os 55 KB
 * de imagem para depois joga-los fora.
 */
controller.getMiniaturaMeta = async versaoId => {
  return db.conn.oneOrNone(
    `SELECT versao_id, formato, largura, altura, erro,
            length(conteudo) AS bytes,
            data_geracao
     FROM acervo.miniatura_versao
     WHERE versao_id = $1`,
    [versaoId]
  );
};

controller.getMiniaturaConteudo = async versaoId => {
  const linha = await db.conn.oneOrNone(
    `SELECT conteudo FROM acervo.miniatura_versao WHERE versao_id = $1`,
    [versaoId]
  );
  return linha ? linha.conteudo : null;
};

/**
 * Assinatura REAL dos primeiros bytes.
 *
 * A extensao e o mimetype declarado vem os dois do cliente e nao provam nada: o
 * multer ja os conferiu, e essa conferencia so barra o engano, nunca a mentira.
 * O que decide e o byte.
 */
const ASSINATURAS_IMAGEM = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] }
];

const ehImagem = buffer => {
  if (!buffer || buffer.length < 12) return false;
  if (ASSINATURAS_IMAGEM.some(a => a.bytes.every((b, i) => buffer[i] === b))) {
    return true;
  }
  // WEBP e RIFF....WEBP: a marca esta no byte 8, e nao no comeco.
  return (
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  );
};

/**
 * Grava a miniatura FORNECIDA de uma versao.
 *
 * O caminho normal da miniatura e a GERACAO, renderizando um arquivo da versao
 * (`utils/miniatura_varredura`). Ele nao alcanca Modelo 3D nem Panoramica 360,
 * cujos arquivos sao `.3dtiles`, `.db` e `.zip`: nenhum se renderiza, e por isso
 * esses produtos ficavam sem imagem na ficha. Aqui a imagem vem de fora.
 *
 * PASSA PELO MESMO `normalizarImagem` DA RENDERIZADA, que e o `finalizar` do
 * `utils/miniatura`. Guardar o byte enviado como veio deixaria a tabela com dois
 * padroes de imagem, um por caminho de entrada, e a ficha mostraria tamanhos e
 * formatos diferentes sem que nada acusasse.
 *
 * `arquivo_id` FICA NULO e o `checksum_origem` e o sha256 da IMAGEM ENVIADA, e
 * nao de um arquivo do acervo. E a diferenca que distingue a linha fornecida da
 * gerada, e ela tem consequencia: a varredura so escolhe versao que TEM arquivo
 * renderizavel, entao ela nunca disputa esta linha. Se um dia a versao ganhar um
 * PDF, a varredura passa a gerar por cima, e e o desfecho certo -- o dado do
 * proprio produto vence a captura de tela.
 *
 * O `erro` sai NULO de proposito: gravar imagem apaga a linha de erro que uma
 * tentativa de geracao anterior tenha deixado.
 */
controller.enviarMiniatura = async (versaoId, arquivo, usuarioUuid, contexto) => {
  if (!ehImagem(arquivo.buffer)) {
    throw new AppError(
      'O arquivo enviado nao e uma imagem PNG, JPEG, GIF ou WEBP',
      httpCode.BadRequest
    );
  }

  const versao = await db.conn.oneOrNone(
    `SELECT v.id, v.versao, p.nome AS produto
     FROM acervo.versao v
     JOIN acervo.produto p ON p.id = v.produto_id
     WHERE v.id = $1`,
    [versaoId]
  );

  if (!versao) {
    throw new AppError('Versao nao encontrada', httpCode.NotFound);
  }

  let imagem;
  try {
    imagem = await normalizarImagem(arquivo.buffer);
  } catch (erro) {
    throw new AppError(
      `Nao foi possivel processar a imagem: ${erro.message}`,
      httpCode.BadRequest,
      erro
    );
  }

  const checksum = crypto
    .createHash('sha256')
    .update(arquivo.buffer)
    .digest('hex');

  await db.conn.none(SQL_GRAVAR, [
    versaoId,
    null,
    checksum,
    imagem.formato,
    imagem.largura,
    imagem.altura,
    imagem.conteudo,
    null
  ]);

  // SEM AUDITORIA, e a ausencia e deliberada. `auditoria.evento` cobre as
  // tabelas do mapa, que sao as que tem ficha e historico; `miniatura_versao` e
  // CACHE DERIVADO, e a varredura ja regrava linha ali sem registrar nada. Uma
  // entrada aqui e nenhuma na varredura daria um historico que mente por
  // omissao. Quem quiser saber de onde veio a imagem le o `arquivo_id`: nulo e
  // fornecida, preenchido e gerada daquele arquivo.

  return {
    versao_id: Number(versaoId),
    produto: versao.produto,
    versao: versao.versao,
    formato: imagem.formato,
    largura: imagem.largura,
    altura: imagem.altura,
    bytes: imagem.conteudo.length,
    checksum_origem: checksum
  };
};

controller.getProdutoDetailedById = async produtoId => {
  return db.conn.task(async t => {
    // Primeiro, obter informações básicas do produto
    const produto = await t.oneOrNone(`
      SELECT
        p.id,
        p.nome,
        p.mi,
        p.inom,
        p.tipo_escala_id,
        te.nome AS escala,
        p.denominador_escala_especial,
        p.tipo_produto_id,
        -- Identidade do produto pelo subtipo: mesma razão do GET simples acima
        p.subtipo_produto_id,
        p.descricao,
        p.data_cadastramento,
        u1.nome AS usuario_cadastramento,
        p.data_modificacao,
        u2.nome AS usuario_modificacao,
        ST_AsEWKT(p.geom) AS geom
      FROM acervo.produto p
      INNER JOIN dominio.tipo_escala AS te ON te.code = p.tipo_escala_id
      LEFT JOIN dgeo.usuario AS u1 ON u1.uuid = p.usuario_cadastramento_uuid
      LEFT JOIN dgeo.usuario AS u2 ON u2.uuid = p.usuario_modificacao_uuid
      WHERE p.id = $1
    `, [produtoId]);

    if (!produto) {
      throw new AppError('Produto não encontrado', httpCode.NotFound);
    }

    // Obter todas as versões do produto com seus relacionamentos e arquivos
    const versoes = await t.any(`
      SELECT
        v.id AS versao_id,
        v.produto_id,
        v.uuid_versao,
        v.versao,
        -- nome é a chave que o PUT /produtos/versao exige; nome_versao fica
        -- por compatibilidade com quem já lê esta tela detalhada
        v.nome,
        v.nome as nome_versao,
        v.tipo_versao_id,
        v.subtipo_produto_id,
        v.lote_id,
        v.meta_pit_id,
        v.demanda_extra_id,
        v.metadado AS versao_metadado,
        v.descricao AS versao_descricao,
        v.data_criacao AS versao_data_criacao,
        v.data_edicao AS versao_data_edicao,
        v.data_cadastramento AS versao_data_cadastramento,
        v.usuario_cadastramento_uuid AS versao_usuario_cadastramento_uuid,
        v.data_modificacao AS versao_data_modificacao,
        v.usuario_modificacao_uuid AS versao_usuario_modificacao_uuid,
        v.orgao_produtor,
        v.palavras_chave,
        l.nome AS lote_nome,
        l.pit AS lote_pit,
        pr.nome AS projeto_nome,
        -- A ficha mostra a imagem da carta. O indicador vem AQUI para a tela
        -- saber, antes de pedir, se ha imagem: sem ele, toda versao sem
        -- miniatura (produto vetorial, arquivo que falhou) custaria um 404 por
        -- versao aberta. O teste de nulidade nao le o BYTEA, so o cabecalho da
        -- linha, entao o indicador nao arrasta a imagem para esta resposta.
        -- Largura e altura viajam junto para a tela reservar o espaco e nao
        -- pular quando a imagem chega.
        (mini.conteudo IS NOT NULL) AS tem_miniatura,
        mini.largura AS miniatura_largura,
        mini.altura AS miniatura_altura
      FROM acervo.versao v
      LEFT JOIN acervo.lote l ON v.lote_id = l.id
      LEFT JOIN acervo.projeto pr ON l.projeto_id = pr.id
      LEFT JOIN acervo.miniatura_versao mini ON mini.versao_id = v.id
      WHERE v.produto_id = $1
      -- Da MAIS RECENTE para a mais antiga. Sem ordem, a ficha devolvia as
      -- versões na ordem física da tabela, e a busca já promete o contrário: o
      -- cartão mostra a última edição, e quem abre a ficha espera encontrá-la no
      -- topo, com as anteriores abaixo. Ordenar aqui, e não na tela, é o que faz
      -- valer para todo mundo que lê esta rota (inclusive o plugin).
      -- NULLS LAST porque versão sem data de edição é registro incompleto, e não
      -- a mais nova; o desempate por id mantém estável quando a data empata.
      ORDER BY v.data_edicao DESC NULLS LAST, v.id DESC
    `, [produtoId]);

    // Para cada versão, obter seus relacionamentos e arquivos
    for (const versao of versoes) {
      // Obter relacionamentos
      // O id da versão relacionada, sozinho, não diz nada a quem lê a ficha:
      // "Insumo da versão 4712" manda a pessoa procurar o que é 4712. Daí os
      // JOINs, que trazem o rótulo da versão e o produto dono dela, para a tela
      // poder escrever "Insumo: 2823-1-SE, 1ª Edição" e ainda ligar para lá.
      versao.relacionamentos = await t.any(`
        SELECT
          vr.id,
          CASE WHEN vr.versao_id_1 = $1 THEN vr.versao_id_2 ELSE vr.versao_id_1 END AS versao_relacionada_id,
          vr.tipo_relacionamento_id,
          tr.nome AS tipo_relacionamento,
          vrel.versao AS versao_relacionada,
          vrel.produto_id AS produto_relacionado_id,
          COALESCE(NULLIF(BTRIM(prel.nome), ''), prel.mi, prel.inom) AS produto_relacionado
        FROM acervo.versao_relacionamento vr
        LEFT JOIN dominio.tipo_relacionamento tr ON vr.tipo_relacionamento_id = tr.code
        LEFT JOIN acervo.versao vrel
          ON vrel.id = CASE WHEN vr.versao_id_1 = $1 THEN vr.versao_id_2 ELSE vr.versao_id_1 END
        LEFT JOIN acervo.produto prel ON prel.id = vrel.produto_id
        WHERE vr.versao_id_1 = $1 OR vr.versao_id_2 = $1
        ORDER BY tr.nome, vrel.versao
      `, [versao.versao_id]);

      // Obter arquivos
      versao.arquivos = await t.any(`
        SELECT 
          a.id,
          a.uuid_arquivo,
          a.nome,
          a.nome_arquivo,
          a.tipo_arquivo_id,
          a.volume_armazenamento_id,
          a.extensao,
          a.tamanho_mb,
          a.checksum,
          a.metadado,
          a.tipo_status_id,
          a.situacao_carregamento_id,
          a.descricao,
          a.crs_original,
          a.data_cadastramento,
          a.usuario_cadastramento_uuid,
          a.data_modificacao,
          a.usuario_modificacao_uuid,
          ta.nome AS tipo_arquivo
        FROM acervo.arquivo a
        LEFT JOIN dominio.tipo_arquivo ta ON a.tipo_arquivo_id = ta.code
        WHERE a.versao_id = $1
      `, [versao.versao_id]);
    }

    // Combinar os resultados
    produto.versoes = versoes;

    return produto;
  });
};

/**
 * Um arquivo do acervo, pronto para stream pelo navegador.
 *
 * Este é o caminho WEB, e é diferente do par prepare/confirm-download que o
 * plugin do QGIS usa. Lá o servidor devolve o CAMINHO do volume e o plugin copia
 * do share por conta, o que só funciona em máquina que monta o share. Aqui o
 * servidor lê o volume e faz stream: o navegador nunca vê caminho de rede.
 *
 * Identifica pelo uuid_arquivo, e não pelo id: a URL do download aparece no log,
 * no histórico do navegador e em link colado num DIEx, e o inteiro sequencial
 * convida a varrer o acervo trocando o número.
 *
 * @param {string} uuidArquivo
 * @returns {Promise<{arquivo_id:number, caminho:string, nome:string, checksum:string, tamanho_mb:number}>}
 */
controller.getArquivoParaDownload = async (uuidArquivo) => {
  const arquivo = await db.conn.oneOrNone(
    `SELECT a.id, a.nome, a.nome_arquivo, a.extensao, a.checksum, a.tamanho_mb,
            a.tipo_arquivo_id, a.tipo_status_id, ta.nome AS tipo_arquivo,
            v.volume
     FROM acervo.arquivo AS a
     LEFT JOIN dominio.tipo_arquivo AS ta ON ta.code = a.tipo_arquivo_id
     LEFT JOIN acervo.volume_armazenamento AS v ON v.id = a.volume_armazenamento_id
     WHERE a.uuid_arquivo = $<uuidArquivo>`,
    { uuidArquivo }
  );

  if (!arquivo) {
    throw new AppError("Arquivo não encontrado", httpCode.NotFound);
  }

  // Tileserver (tipo 9) é uma URL de serviço, sem byte em volume nenhum.
  if (arquivo.tipo_arquivo_id === TIPO_ARQUIVO.TILESERVER) {
    throw new AppError(
      `O arquivo "${arquivo.nome}" é do tipo Tileserver (uma URL de serviço) e não tem arquivo físico para baixar`,
      httpCode.BadRequest
    );
  }

  // Status de erro significa que o carregamento ou a exclusão falhou, então o
  // byte no volume pode estar truncado. Entregar isso é pior que recusar: o
  // arquivo chega com o nome certo e o conteúdo pela metade. Mesma regra do
  // prepareDownload do plugin.
  if (arquivo.tipo_status_id !== STATUS_ARQUIVO.CARREGADO) {
    throw new AppError(
      `O arquivo "${arquivo.nome}" está com status de erro e não pode ser baixado`,
      httpCode.BadRequest
    );
  }

  if (!arquivo.volume) {
    throw new AppError(
      `O arquivo "${arquivo.nome}" não tem volume de armazenamento registrado`,
      httpCode.BadRequest
    );
  }

  // O nome físico é DERIVADO do cadastro: <volume>/<nome_arquivo>.<extensao>. É
  // a mesma montagem do prepareDownload e do confirm-upload, e a razão pela qual
  // o trio (volume, nome_arquivo, extensao) tem índice único no banco.
  const nome = arquivo.extensao
    ? `${arquivo.nome_arquivo}.${arquivo.extensao}`
    : arquivo.nome_arquivo;

  return {
    arquivo_id: Number(arquivo.id),
    caminho: caminhoNoVolume(arquivo.volume, nome),
    nome,
    checksum: arquivo.checksum,
    tamanho_mb: arquivo.tamanho_mb
  };
};

/**
 * Registra no banco o desfecho REAL de um download pelo navegador.
 *
 * Uma linha por entrega, escrita DEPOIS que o último byte saiu, e não antes: a
 * intenção de baixar não é download, e a tabela acervo.download é o que responde
 * "quem levou o quê" (a pergunta da LAI e da auditoria).
 *
 * Retomada gera duas linhas, uma por pedaço entregue. É deliberado: cada linha
 * conta uma transferência que de fato aconteceu.
 *
 * @param {number} arquivoId
 * @param {string} usuarioUuid
 * @param {{sucesso:boolean, erro?:string}} desfecho
 */
controller.registrarDownloadWeb = async (arquivoId, usuarioUuid, { sucesso, erro }) => {
  return db.conn.none(
    `INSERT INTO acervo.download (arquivo_id, usuario_uuid, status, error_message)
     VALUES ($<arquivoId>, $<usuarioUuid>, $<status>, $<erro>)`,
    {
      arquivoId,
      usuarioUuid,
      status: sucesso ? "completed" : "failed",
      erro: erro || null
    }
  );
};

controller.prepareDownload = async (arquivosIds, usuarioUuid) => {
  const cs = new db.pgp.helpers.ColumnSet([
    "arquivo_id",
    "usuario_uuid",
    { name: "data_download", mod: ":raw", init: () => "NOW()" },
    { name: "status", init: () => "pending" },
    { name: "download_token", mod: ":raw", init: () => "uuid_generate_v4()" },
    { name: "expiration_time", mod: ":raw", init: () => "NOW() + INTERVAL '24 hours'" }
  ]);

  const usuario = await db.conn.oneOrNone(
    "SELECT uuid FROM dgeo.usuario WHERE uuid = $<uuid>",
    { uuid: usuarioUuid }
  );

  if (!usuario) {
    throw new AppError("Usuário não encontrado", httpCode.NotFound);
  }

  const existingArquivos = await db.conn.any(
    `SELECT id, nome, nome_arquivo, extensao, checksum, tipo_arquivo_id, tipo_status_id FROM acervo.arquivo WHERE id IN ($<arquivosIds:csv>)`,
    { arquivosIds }
  );

  if (existingArquivos.length !== arquivosIds.length) {
    throw new AppError("Um ou mais IDs de arquivo não existem", httpCode.NotFound);
  }

  // Arquivos com erro de carregamento/exclusão não são baixáveis
  const comErro = existingArquivos.filter(a => a.tipo_status_id !== STATUS_ARQUIVO.CARREGADO);
  if (comErro.length > 0) {
    throw new AppError(
      `Os seguintes arquivos estão com status de erro e não podem ser baixados: ${comErro.map(a => a.nome).join(', ')}`,
      httpCode.BadRequest
    );
  }

  // Tileserver (tipo 9) é uma URL, sem arquivo físico em volume. Não é baixável.
  // Sem esta checagem seriam criados registros de download órfãos (sem token retornado).
  const tileserver = existingArquivos.filter(a => a.tipo_arquivo_id === TIPO_ARQUIVO.TILESERVER);
  if (tileserver.length > 0) {
    throw new AppError(
      `Os seguintes arquivos são do tipo Tileserver (URL) e não possuem arquivo físico para download: ${tileserver.map(a => a.nome).join(', ')}`,
      httpCode.BadRequest
    );
  }

  const downloads = arquivosIds.map(id => ({
    arquivo_id: id,
    usuario_uuid: usuario.uuid
  }));

  const query = db.pgp.helpers.insert(downloads, cs, {
    table: "download",
    schema: "acervo"
  });

  const result = await db.conn.query(query + " RETURNING download_token");
  
  const downloadTokens = result.map(row => row.download_token);

  const filePaths = await db.conn.any(
    `
    SELECT
      a.id AS arquivo_id,
      a.nome,
      a.nome_arquivo,
      a.extensao,
      a.checksum,
      a.tamanho_mb,
      CONCAT(v.volume, '/', a.nome_arquivo, '.', a.extensao) AS file_path,
      d.download_token
    FROM
      acervo.arquivo AS a
      INNER JOIN acervo.volume_armazenamento AS v ON a.volume_armazenamento_id = v.id
      INNER JOIN acervo.download AS d ON a.id = d.arquivo_id
    WHERE
      a.id IN ($<arquivosIds:csv>)
      AND d.download_token IN ($<downloadTokens:csv>)
    `,
    { arquivosIds, downloadTokens }
  );

  return filePaths.map(file => ({
    arquivo_id: file.arquivo_id,
    nome: file.nome,
    download_path: file.file_path,
    checksum: file.checksum,
    tamanho_mb: file.tamanho_mb,
    download_token: file.download_token
  }));
};

// O DONO DO TOKEN FECHA O PROPRIO DOWNLOAD, e ninguem mais.
//
// O controlador nao recebia `usuarioUuid` e casava so por `download_token`:
// qualquer conta com perfil `consulta` no acervo que conhecesse um token
// pendente de outra pessoa podia fecha-lo como `completed` ou `failed`, e o dono
// recebia depois "Download nao encontrado, ja processado ou com token expirado"
// sem entender por que. As duas rotas irmas ja conferiam o dono (`confirmUpload`
// e `cancelUpload`), e a assimetria era gratuita.
//
// O `acervo_cli` e o plugin continuam funcionando: os dois preparam e confirmam
// com a MESMA sessao, e o token so sai no corpo do `prepare-download` de quem
// pediu.
controller.confirmDownload = async (downloadConfirmations, usuarioUuid) => {
  return db.conn.tx(async t => {
    const results = [];

    for (const confirmation of downloadConfirmations) {
      const { download_token, success, error_message } = confirmation;
      
      // A EXPIRAÇÃO VALE AQUI, na hora do uso, e não só quando alguém limpa.
      // Não há agendamento que feche o token vencido, então a regra mora onde
      // ele é gasto. Mesmo padrão de `ponto_controle/upload_ctrl.js`. A limpeza
      // é ARRUMAÇÃO: ela troca o status e tira o vencido das contagens.
      const download = await t.oneOrNone(
        `SELECT d.id, d.arquivo_id, a.nome
         FROM acervo.download d
         JOIN acervo.arquivo a ON d.arquivo_id = a.id
         WHERE d.download_token = $1 AND d.status = 'pending'
           AND d.usuario_uuid = $2
           AND (d.expiration_time IS NULL OR d.expiration_time > NOW())`,
        [download_token, usuarioUuid]
      );
      
      if (!download) {
        results.push({
          download_token,
          status: 'error',
          // Em português, como toda mensagem de erro do sistema. Hoje o plugin
          // não mostra este campo (ele monta a própria frase a partir de
          // `status === 'error'`), e o texto existe para quem lê o corpo da
          // resposta, inclusive o `acervo_cli`.
          message: 'Download não encontrado, já processado, de outro usuário '
            + 'ou com token expirado'
        });
        continue;
      }
      
      await t.none(
        `UPDATE acervo.download 
         SET status = $1, 
             error_message = $2
         WHERE download_token = $3`,
        [success ? 'completed' : 'failed', error_message || null, download_token]
      );
      
      results.push({
        download_token,
        arquivo_id: download.arquivo_id,
        nome: download.nome,
        status: success ? 'completed' : 'failed'
      });
    }
    
    return results;
  });
};

controller.prepareDownloadByProdutos = async (produtosIds, tiposArquivo, usuarioUuid) => {
  const usuario = await db.conn.oneOrNone(
    "SELECT uuid FROM dgeo.usuario WHERE uuid = $<usuarioUuid>",
    { usuarioUuid }
  );

  if (!usuario) {
    throw new AppError("Usuário não encontrado", httpCode.NotFound);
  }

  const newestVersionsWithFiles = await db.conn.any(
    `
    WITH newest_versions AS (
      SELECT DISTINCT ON (v.produto_id) v.produto_id, v.id AS versao_id
      FROM acervo.versao v
      WHERE v.produto_id IN ($<produtosIds:csv>)
      ORDER BY v.produto_id, v.data_edicao DESC, v.id DESC
    )
    SELECT a.id AS arquivo_id, a.nome, a.nome_arquivo, a.extensao, a.checksum, a.tamanho_mb, va.volume
    FROM newest_versions nv
    JOIN acervo.arquivo a ON a.versao_id = nv.versao_id
    JOIN acervo.volume_armazenamento va ON a.volume_armazenamento_id = va.id
    WHERE a.tipo_arquivo_id IN ($<tiposArquivo:csv>)
      AND a.tipo_status_id = $<statusCarregado>
    `,
    { produtosIds, tiposArquivo, statusCarregado: STATUS_ARQUIVO.CARREGADO }
  );

  if (newestVersionsWithFiles.length === 0) {
    throw new AppError("Nenhum arquivo encontrado para os produtos e tipos especificados", httpCode.NotFound);
  }

  const cs = new db.pgp.helpers.ColumnSet([
    "arquivo_id",
    "usuario_uuid",
    { name: "data_download", mod: ":raw", init: () => "NOW()" },
    { name: "status", init: () => "pending" },
    { name: "download_token", mod: ":raw", init: () => "uuid_generate_v4()" },
    { name: "expiration_time", mod: ":raw", init: () => "NOW() + INTERVAL '24 hours'" }
  ]);

  const downloads = newestVersionsWithFiles.map(file => ({
    arquivo_id: file.arquivo_id,
    usuario_uuid: usuario.uuid
  }));

  const query = db.pgp.helpers.insert(downloads, cs, {
    table: "download",
    schema: "acervo"
  });

  const result = await db.conn.query(query + " RETURNING arquivo_id, download_token");
  
  const tokenMap = {};
  result.forEach(row => {
    tokenMap[row.arquivo_id] = row.download_token;
  });

  const filePaths = newestVersionsWithFiles.map(file => ({
    arquivo_id: file.arquivo_id,
    nome: file.nome,
    download_path: `${file.volume}/${file.nome_arquivo}.${file.extensao}`,
    checksum: file.checksum,
    tamanho_mb: file.tamanho_mb,
    download_token: tokenMap[file.arquivo_id]
  }));

  return filePaths;
};

/**
 * Fecha o DOWNLOAD que expirou, e DIZ QUANTOS.
 *
 * Isto é ARRUMAÇÃO, e não a regra de expiração: download vencido já é recusado
 * no `confirmDownload`, tenha a limpeza rodado ou não.
 *
 * O UPDATE é daqui, e não a função do banco, para o `RETURNING` contar as linhas
 * que ele mesmo mexeu: "limpou" sem número é eco da chamada, e não medida.
 *
 * SÓ DOWNLOAD. Até 06/08/2026 ela chamava `acervo.cleanup_expired_uploads()` de
 * carona, e a limpeza do envio ficava escondida atrás de uma rota de download:
 * quem procurasse por ela não a acharia. A sessão de envio tem rota própria em
 * `POST /api/arquivo/cleanup-expired-uploads`.
 *
 * @param {string|null} usuarioUuid
 * @param {Object|null} contexto
 * @returns {Promise<{fechados:number}>}
 */
controller.cleanupExpiredDownloads = async (usuarioUuid = null, contexto = null) => {
  return db.conn.tx(async t => {
    const fechados = await t.any(`
      UPDATE acervo.download
         SET status = 'failed'
       WHERE status = 'pending'
         AND expiration_time IS NOT NULL
         AND expiration_time < NOW()
      RETURNING id
    `);

    const resultado = { fechados: fechados.length };

    // Toda execução tem uma pessoa por trás, e "rodei e não havia nada" é
    // informação de auditoria legítima.
    if (usuarioUuid || resultado.fechados > 0) {
      await auditoriaCtrl.registrarOperacao(t, {
        tabela: 'acervo.download_expirado',
        resultado,
        usuarioUuid,
        contexto
      });
    }

    return resultado;
  });
};

// As duas visões materializadas geram EVENTO DE OPERAÇÃO, e não linha a linha:
// não há par de linhas para comparar, e a pergunta que a ação produz na prática
// é "quem mandou rodar isso, e quando". A tela de Manutenção já descreve o que
// cada uma faz e o que NÃO faz; o rastro só acrescenta o autor.
//
// O `task` virou `tx` nas duas: o evento tem de cair JUNTO com a operação que
// ele descreve, e num `task` cada comando é uma transação própria -- o registro
// sobreviveria a uma falha da operação, afirmando que ela aconteceu.
/**
 * Varre a fila de miniaturas sob comando, e registra quem mandou.
 *
 * A varredura em si vive em `utils/miniatura_varredura`, junto da geração
 * automática que roda após o upload. Aqui ela ganha o RASTRO, pelo mesmo motivo
 * do refresh das views: não há par de linhas para comparar, e a pergunta que a
 * ação produz na prática é "quem mandou rodar isso, e quando".
 *
 * O registro fica FORA da renderização: gravar dentro da transação prenderia
 * linhas do acervo pelos segundos que cada arquivo custa. Aqui a operação já
 * terminou, e o evento só descreve o que ela fez.
 */
controller.varrerMiniaturas = async (usuarioUuid, contexto) => {
  const resultado = await miniaturaVarredura.varrerFila();

  return db.conn.tx(async t => {
    await auditoriaCtrl.registrarOperacao(t, {
      tabela: 'acervo.miniatura_versao',
      resultado,
      usuarioUuid,
      contexto
    });

    return resultado;
  });
};

controller.refreshAllMaterializedViews = async (usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    try {
      await t.any(`SELECT acervo.refresh_all_materialized_views()`);

      const resultado = {
        success: true,
        message: 'Todas as views materializadas foram atualizadas com sucesso'
      };

      await auditoriaCtrl.registrarOperacao(t, {
        tabela: 'acervo.mv_produto',
        resultado,
        usuarioUuid,
        contexto
      });

      return resultado;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Erro ao atualizar views materializadas: ${error.message}`, httpCode.InternalError, error);
    }
  });
};

controller.createMaterializedViews = async (usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    try {
      await t.any(`SELECT acervo.criar_views_materializadas()`);

      const resultado = {
        success: true,
        message: 'Views materializadas criadas com sucesso'
      };

      await auditoriaCtrl.registrarOperacao(t, {
        tabela: 'acervo.mv_produto',
        resultado,
        usuarioUuid,
        contexto
      });

      return resultado;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Erro ao criar views materializadas: ${error.message}`, httpCode.InternalError, error);
    }
  });
};

controller.getSituacaoGeralJSON = async (scaleOptions = {}) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Create a zip archive in memory
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks = [];
      
      archive.on('data', (chunk) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', (err) => reject(err));
      
      // A lista sai de SITUACAO_GERAL_ESCALAS, e não de uma cópia local: eram
      // três cópias do mesmo par (código do domínio, sufixo de arquivo) neste
      // arquivo, e escala nova entraria numa e não nas outras.
      const selectedScales = SITUACAO_GERAL_ESCALAS.filter(scale =>
        scaleOptions[scale.name] === true
      );

      // If no scales selected, use all scales
      const scalesToUse = selectedScales.length > 0 ? selectedScales : SITUACAO_GERAL_ESCALAS;
      
      for (const scale of scalesToUse) {
        const data = await generateGeoJSONForScale(scale.id);
        const jsonString = JSON.stringify(data, null, 2);
        
        // Create a readable stream from the JSON string
        const jsonStream = Readable.from(jsonString);
        
        archive.append(jsonStream, { name: `situacao-geral-ct-${scale.name}.geojson` });
      }
      
      archive.finalize();
      
    } catch (error) {
      reject(error);
    }
  });
};

// Exporta um ZIP de CSVs no mesmo padrão da planilha de referência da ASC
// (uma "aba" por escala+tipo: T250/O250/T100/O100/T50/O50/T25/O25), uma linha
// por versão (edição). Permite comparar o acervo com a planilha no mesmo formato.
controller.getPlanilhaCSV = async (scaleOptions = {}) => {
  return new Promise(async (resolve, reject) => {
    try {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks = [];
      archive.on('data', (c) => chunks.push(c));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', (e) => reject(e));

      // A MESMA lista da situação geral, só que da maior escala para a menor,
      // que é a ordem das abas da planilha de referência da ASC.
      const todasEscalas = [...SITUACAO_GERAL_ESCALAS].reverse();
      const selecionadas = todasEscalas.filter(e => scaleOptions[e.name] === true);
      const escalas = selecionadas.length > 0 ? selecionadas : todasEscalas;
      const tipos = [
        { id: TIPO_PRODUTO.CARTA_TOPOGRAFICA, prefix: 'T', label: 'C. Topo' },
        { id: TIPO_PRODUTO.CARTA_ORTOIMAGEM, prefix: 'O', label: 'C. Orto' }
      ];
      const COLS = ['Cont_Edicao', 'MI', 'INOM', 'Tipo_Produto', 'Subtipo', 'Nome', 'Orgao_Produtor', 'EPSG', 'Ano_Dados', 'Ano_Edicao', 'Versao', 'Lote', 'Tem_Arquivo'];
      const esc = (s) => {
        if (s == null) return '';
        const v = String(s);
        return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      };

      for (const e of escalas) {
        for (const t of tipos) {
          const rows = await db.conn.any(`
            SELECT
              substring(v.versao from '^([0-9]+)') AS cont_edicao,
              p.mi, p.inom,
              $<label> AS tipo_produto,
              sp.nome AS subtipo,
              v.nome,
              v.orgao_produtor,
              (SELECT a.crs_original FROM acervo.arquivo a
                 WHERE a.versao_id = v.id
                   AND a.tipo_arquivo_id = ${TIPO_ARQUIVO.ARQUIVO_PRINCIPAL} LIMIT 1) AS epsg,
              EXTRACT(YEAR FROM v.data_criacao)::int AS ano_dados,
              EXTRACT(YEAR FROM v.data_edicao)::int AS ano_edicao,
              v.versao,
              l.nome AS lote,
              (SELECT count(*) FROM acervo.arquivo a WHERE a.versao_id = v.id) AS tem_arquivo
            FROM acervo.versao v
            JOIN acervo.produto p ON p.id = v.produto_id
            JOIN dominio.subtipo_produto sp ON sp.code = v.subtipo_produto_id
            LEFT JOIN acervo.lote l ON l.id = v.lote_id
            WHERE p.tipo_escala_id = $<escId> AND p.tipo_produto_id = $<tipoId>
            ORDER BY p.mi, p.inom, EXTRACT(YEAR FROM v.data_edicao)
          `, { escId: e.id, tipoId: t.id, label: t.label });

          const linhas = [COLS.join(',')];
          for (const r of rows) {
            linhas.push([r.cont_edicao, r.mi, r.inom, r.tipo_produto, r.subtipo, r.nome,
              r.orgao_produtor, r.epsg, r.ano_dados, r.ano_edicao, r.versao, r.lote, r.tem_arquivo]
              .map(esc).join(','));
          }
          const csv = '﻿' + linhas.join('\r\n'); // BOM para abrir certo no Excel
          archive.append(Readable.from(csv), { name: `${t.prefix}${e.name}.csv` });
        }
      }
      archive.finalize();
    } catch (error) {
      reject(error);
    }
  });
};

// Escalas da carta topográfica sistemática e o sufixo usado nos arquivos do
// site de produtos. Exportado para a rota pública de integração mapear o nome
// de escala (ex.: '50k') para o code do domínio.
const SITUACAO_GERAL_ESCALAS = [
  { id: TIPO_ESCALA.ESCALA_25K, name: '25k' },
  { id: TIPO_ESCALA.ESCALA_50K, name: '50k' },
  { id: TIPO_ESCALA.ESCALA_100K, name: '100k' },
  { id: TIPO_ESCALA.ESCALA_250K, name: '250k' }
];
controller.SITUACAO_GERAL_ESCALAS = SITUACAO_GERAL_ESCALAS;


const situacaoEdicoes = (edicoes) => {
  if (edicoes.length === 0) return 'Não mapeado';
  if (edicoes.length === 1) return 'Concluído';
  return 'Múltiplas edições';
};

// Núcleo reutilizável da situação geral, usado pela rota ZIP (GET
// /api/acervo/situacao-geral) e pela rota pública de integração (GET
// /api/integracao/acervo/situacao_geral). Devolve, por escala, uma feature
// GeoJSON por célula da grade (MI), mesclando Carta Topográfica e Carta
// Ortoimagem da mesma MI (no SCA são produtos distintos). Formato de
// propriedades idêntico aos arquivos do site de produtos (1cgeo/produtos),
// com os anos de edição vindos de v.data_edicao (finalização).
//
// Só entra versão REGULAR. O Registro Histórico (tipo_versao_id = 2) documenta
// que uma edição existiu e por definição não tem arquivo: contá-lo pintava de
// "Concluído" folha que o acervo não entrega, e respondia "já temos" no
// roteamento de demanda para carta que ninguém pode baixar nem imprimir. Por
// isso o corte fica aqui, no núcleo, e vale para as duas rotas.
//   - incluirGeom: inclui a geometria (cara); a rota pública omite por padrão.
//   - filtroIds: Set de MI/INOM normalizados; quando presente, limita às folhas
//     pedidas (modo por identificador da skill consultar-produtos).
//   - intersecta: lista de geometrias GeoJSON (EPSG:4326) da área de interesse.
//     Quando presente, só entram as folhas cuja fração coberta pela área supera
//     `limiar`. O recorte roda no PostGIS, onde a grade já está indexada, e não
//     fora do sistema: uma segunda implementação do predicado espacial fica
//     livre para divergir desta.
controller.getSituacaoGeralCells = async (
  scaleId,
  { incluirGeom = true, filtroIds = null, intersecta = null, limiar = 0.01 } = {}
) => {
  const temArea = Array.isArray(intersecta) && intersecta.length > 0

  // ST_Collect + ST_UnaryUnion dissolve as partes sobrepostas da área: sem isso
  // a interseção contaria a mesma faixa duas vezes e inflaria a fração.
  //
  // GeoJSON é WGS84 por especificação (RFC 7946) e `acervo.produto.geom` é
  // SIRGAS 2000 (4674). A diferença é centimétrica aqui, mas SRID misturado o
  // PostGIS RECUSA com erro, então a transformação é obrigatória, não zelo.
  const alvoCte = temArea
    ? `alvo AS (
      SELECT ST_UnaryUnion(ST_Collect(
        ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(g::text), 4326), 4674)
      )) AS geom
      FROM jsonb_array_elements($<intersecta:json>::jsonb) AS g
    ),`
    : ''

  const filtroArea = temArea
    ? `AND EXISTS (
        SELECT 1 FROM alvo a
        WHERE ST_Intersects(p.geom, a.geom)
          AND ST_Area(ST_Intersection(p.geom, a.geom))
              / NULLIF(ST_Area(p.geom), 0) > $<limiar>
      )`
    : ''

  const celulas = await db.conn.any(`
    WITH ${alvoCte}
    produtos_escala AS (
      SELECT p.id, p.mi, p.inom, p.geom, p.tipo_produto_id
      FROM acervo.produto p
      WHERE p.tipo_escala_id = $<scaleId> AND p.mi IS NOT NULL
      ${filtroArea}
    ),
    edicoes AS (
      SELECT pe.mi,
             pe.tipo_produto_id,
             ARRAY_AGG(DISTINCT EXTRACT(YEAR FROM v.data_edicao)::int
                       ORDER BY EXTRACT(YEAR FROM v.data_edicao)::int DESC) AS anos,
             JSONB_AGG(JSONB_BUILD_OBJECT(
                         'versao', v.versao,
                         'ano', EXTRACT(YEAR FROM v.data_edicao)::int::text)
                       ORDER BY EXTRACT(YEAR FROM v.data_edicao)::int DESC, v.versao) AS versoes
      FROM produtos_escala pe
      JOIN acervo.versao v ON v.produto_id = pe.id
        AND v.tipo_versao_id = ${TIPO_VERSAO.REGULAR}
      GROUP BY pe.mi, pe.tipo_produto_id
    ),
    grade AS (
      SELECT DISTINCT ON (mi) mi, inom, geom
      FROM produtos_escala
      ORDER BY mi, id
    )
    SELECT
      g.mi AS "identificadorMI",
      g.inom AS "identificadorINOM",
      ${incluirGeom ? 'ST_AsGeoJSON(g.geom)::json AS geometry,' : ''}
      COALESCE(t.anos, ARRAY[]::int[]) AS "edicoes_topo",
      COALESCE(o.anos, ARRAY[]::int[]) AS "edicoes_orto",
      COALESCE(t.versoes, '[]'::jsonb) AS "versoes_topo",
      COALESCE(o.versoes, '[]'::jsonb) AS "versoes_orto"
    FROM grade g
    LEFT JOIN edicoes t ON t.mi = g.mi AND t.tipo_produto_id = ${TIPO_PRODUTO.CARTA_TOPOGRAFICA}
    LEFT JOIN edicoes o ON o.mi = g.mi AND o.tipo_produto_id = ${TIPO_PRODUTO.CARTA_ORTOIMAGEM}
    ORDER BY g.mi
  `, { scaleId, intersecta, limiar });

  // Construct GeoJSON features (chaves e tipos idênticos aos arquivos do site:
  // id sequencial como string, anos como strings em ordem decrescente)
  //
  // `edicoes_*` é o ano DISTINTO, e é o que o filtro de período e a legenda do
  // site contam. `versoes_*` é uma entrada por VERSÃO, com o rótulo do SCA
  // ("1ª Edição", "1-DSG") e o ano dela. Os dois convivem porque o rótulo não
  // se deduz da posição na lista: a folha 2823-1-SE pode ter "1-DSG" em 2021 e
  // "3ª Edição" em 1996, e contar de trás para frente inventaria "2" e "1".
  // Uma folha pode ter duas versões no MESMO ano quando a carta civil e a
  // militar coexistem (10 casos em 07/2026), e por isso `versoes_*` pode ser
  // mais longa que `edicoes_*`.
  return celulas
    .filter(c => !filtroIds ||
      filtroIds.has(normalizarIdentificador(c.identificadorMI)) ||
      filtroIds.has(normalizarIdentificador(c.identificadorINOM)))
    .map((celula, index) => {
      const edicoesTopo = celula.edicoes_topo.map(ano => ano.toString());
      const edicoesOrto = celula.edicoes_orto.map(ano => ano.toString());

      const feature = {
        type: "Feature",
        properties: {
          id: index.toString(),
          identificadorMI: celula.identificadorMI,
          situacao_topo: situacaoEdicoes(edicoesTopo),
          edicoes_topo: edicoesTopo,
          versoes_topo: celula.versoes_topo,
          situacao_orto: situacaoEdicoes(edicoesOrto),
          edicoes_orto: edicoesOrto,
          versoes_orto: celula.versoes_orto,
          identificadorINOM: celula.identificadorINOM
        }
      };
      if (incluirGeom) feature.geometry = celula.geometry;
      return feature;
    });
};

// Helper function to generate GeoJSON for a specific scale
// Formato idêntico ao consumido pelo site de produtos (1cgeo/produtos):
// uma feature por célula da grade (MI), mesclando os produtos de Carta
// Topográfica e Carta Ortoimagem da mesma MI (no SCA são produtos distintos)
async function generateGeoJSONForScale(scaleId) {
  const features = await controller.getSituacaoGeralCells(scaleId, { incluirGeom: true });
  const escala = SITUACAO_GERAL_ESCALAS.find(s => s.id === scaleId);

  return {
    type: "FeatureCollection",
    name: `situacao-geral-ct-${escala ? escala.name : scaleId}`,
    features: features
  };
}

// Filtros da busca do acervo, compartilhados pela LISTA e pela CAMADA DO MAPA.
//
// As duas rotas respondem a mesma pergunta e precisam do mesmo WHERE. Montá-lo
// em um lugar só é o que impede o mapa de mostrar um conjunto e a lista outro.
//
// Decisões que valem registro:
//
// 1. O `termo` procura em nome, mi e inom, e TAMBÉM nas palavras-chave da
//    versão. Quem cataloga escreve a etiqueta ali, então ignorá-la fazia a
//    busca parecer vazia para quem procurava pelo assunto, não pelo código.
// 2. O recorte espacial usa `&&` ANTES do ST_Intersects. O `&&` compara caixas
//    envolventes e é o que o índice GiST (produto_geom) atende; o ST_Intersects
//    refina o que sobrou. Só o ST_Intersects também funciona, mas paga
//    geometria exata em linha que a caixa já teria descartado.
// 3. O subtipo casa no PRODUTO ou em QUALQUER VERSÃO. `produto.subtipo_produto_id`
//    só é preenchido quando o subtipo DEFINE o produto; o subtipo do dia a dia
//    (T34-700, ET-RDG, EDGV) vive na versão, e é a maioria do acervo.
//
// `exceto` PULA um filtro. É o que faz as listas de opção serem facetadas: a
// lista de escalas aplica tipo, subtipo, termo e recorte, mas nunca a própria
// escala escolhida. Aplicando também a própria, cada lista voltaria com uma
// opção só (a que já está escolhida), e trocar de escala exigiria limpar antes.
// Mesma regra do mapa da mapoteca (mapoteca/dashboard_ctrl.js).
function montarFiltrosBusca(f, exceto = null) {
  const conditions = [];
  const params = {};
  // `temValor` e nao a verdade do JavaScript: os filtros de dominio chegam como
  // ARRAY, e array vazio e verdadeiro. Sem isto, desmarcar a ultima opcao
  // montaria `IN ()` e derrubaria a consulta.
  const usa = (chave) => chave !== exceto && temValor(f[chave]);

  if (f.termo) {
    conditions.push(`(
      p.nome ILIKE $<termo> OR p.mi ILIKE $<termo> OR p.inom ILIKE $<termo>
      OR EXISTS (
        SELECT 1 FROM acervo.versao vt
        WHERE vt.produto_id = p.id
          AND EXISTS (
            SELECT 1 FROM unnest(vt.palavras_chave) AS pk WHERE pk ILIKE $<termo>
          )
      )
    )`);
    params.termo = `%${f.termo}%`;
  }

  if (f.palavra_chave) {
    // Etiqueta EXATA (sem diferenciar maiúscula), que é como uma lista de
    // sugestão a devolve. Diferente do `termo`, aqui não há substring.
    conditions.push(`EXISTS (
      SELECT 1 FROM acervo.versao vp
      WHERE vp.produto_id = p.id
        AND EXISTS (
          SELECT 1 FROM unnest(vp.palavras_chave) AS pk
          WHERE lower(pk) = lower($<palavraChave>)
        )
    )`);
    params.palavraChave = f.palavra_chave;
  }

  // `IN` e nao `=` nos filtros de dominio: cada um aceita varios codigos, e
  // marcar dois tipos pergunta por um OU o outro. O cruzamento ENTRE filtros
  // continua sendo E, que e o que a faceta ja contava.
  if (usa('tipo_produto_id')) {
    conditions.push(`p.tipo_produto_id IN ($<tipoProdutoId:csv>)`);
    params.tipoProdutoId = f.tipo_produto_id;
  }

  if (usa('subtipo_produto_id')) {
    conditions.push(`(
      p.subtipo_produto_id IN ($<subtipoProdutoId:csv>)
      OR EXISTS (
        SELECT 1 FROM acervo.versao vs
        WHERE vs.produto_id = p.id AND vs.subtipo_produto_id IN ($<subtipoProdutoId:csv>)
      )
    )`);
    params.subtipoProdutoId = f.subtipo_produto_id;
  }

  if (usa('tipo_escala_id')) {
    conditions.push(`p.tipo_escala_id IN ($<tipoEscalaId:csv>)`);
    params.tipoEscalaId = f.tipo_escala_id;
  }

  if (f.bbox) {
    const [minLon, minLat, maxLon, maxLat] = f.bbox;
    conditions.push(`(
      p.geom && ST_MakeEnvelope($<minLon>, $<minLat>, $<maxLon>, $<maxLat>, 4674)
      AND ST_Intersects(p.geom, ST_MakeEnvelope($<minLon>, $<minLat>, $<maxLon>, $<maxLat>, 4674))
    )`);
    Object.assign(params, { minLon, minLat, maxLon, maxLat });
  }

  if (f.geometria) {
    // ST_GeomFromGeoJSON nasce sem SRID; sem o ST_SetSRID o PostGIS recusa
    // comparar com p.geom (4674). O ST_MakeValid é cinto de segurança: o
    // desenho do mapa já barra auto-interseção, mas geometria inválida vinda
    // por URL derrubaria a consulta inteira em vez de devolver zero.
    conditions.push(`(
      p.geom && ST_SetSRID(ST_GeomFromGeoJSON($<geometria>), 4674)
      AND ST_Intersects(p.geom, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($<geometria>), 4674)))
    )`);
    params.geometria = f.geometria;
  }

  // Lista explicita de produtos: e o "exportar so os selecionados". Os demais
  // filtros continuam valendo, entao o CSV nunca traz algo que a busca corrente
  // nao traria.
  if (f.ids) {
    const ids = String(f.ids).split(',').map(n => parseInt(n, 10)).filter(Number.isFinite);
    if (ids.length) {
      conditions.push(`p.id IN ($<ids:csv>)`);
      params.ids = ids;
    }
  }

  // Filtro por LUGAR. O recorte e espacial e nao um campo do produto: nenhum
  // produto guarda municipio, e guardar seria duplicar o que a geometria ja diz.
  // Com o indice GIST de `limites` a consulta custa milissegundos, entao NAO ha
  // tabela de associacao materializada.
  //
  // Produto que cruza a divisa aparece nos DOIS municipios, de proposito: a
  // pergunta e "o que existe em X", e a folha que cobre metade de X existe la.
  if (usa('municipio_id')) {
    conditions.push(`EXISTS (
      SELECT 1 FROM limites.municipio m
      WHERE m.id IN ($<municipioId:csv>) AND ST_Intersects(p.geom, m.geom)
    )`);
    params.municipioId = f.municipio_id;
  }

  if (usa('estado_id')) {
    conditions.push(`EXISTS (
      SELECT 1 FROM limites.estado e
      WHERE e.id IN ($<estadoId:csv>) AND ST_Intersects(p.geom, e.geom)
    )`);
    params.estadoId = f.estado_id;
  }

  // Projeto e lote NAO passam pelo `usa`: os dois montam um EXISTS so, porque
  // pedir os dois quer dizer "o lote X, dentro do projeto Y", e nao dois testes
  // independentes sobre versoes diferentes do mesmo produto.
  const temProjeto = exceto !== 'projeto_id' && temValor(f.projeto_id);
  const temLote = exceto !== 'lote_id' && temValor(f.lote_id);
  if (temProjeto || temLote) {
    conditions.push(`EXISTS (
      SELECT 1 FROM acervo.versao v2
      LEFT JOIN acervo.lote l2 ON v2.lote_id = l2.id
      WHERE v2.produto_id = p.id
      ${temProjeto ? 'AND l2.projeto_id IN ($<projetoId:csv>)' : ''}
      ${temLote ? 'AND v2.lote_id IN ($<loteId:csv>)' : ''}
    )`);
    if (temProjeto) params.projetoId = f.projeto_id;
    if (temLote) params.loteId = f.lote_id;
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  };
}

// Busca paginada de produtos.
//
// Recebe UM objeto, e não uma fila de argumentos posicionais: são mais de dez
// filtros, e com objeto acrescentar um não desloca os outros.
//
// O `extent` devolvido é a caixa de TODO o resultado, não a da página: é o que
// deixa o mapa enquadrar a busca inteira, mesmo listando 20 de 800.
controller.buscaProdutos = async (filtros = {}) => {
  const { page = 1, limit = 20, com_geometria: comGeometria = false } = filtros;

  return db.conn.task(async t => {
    const { whereClause, params } = montarFiltrosBusca(filtros);
    params.limit = limit;
    params.offset = (page - 1) * limit;

    // Total e extensão numa consulta só: as duas varrem o MESMO conjunto, e
    // separá-las dobraria o trabalho do filtro espacial.
    const resumo = await t.one(
      `SELECT
        COUNT(*) AS total,
        ST_XMin(ST_Extent(p.geom)) AS min_lon,
        ST_YMin(ST_Extent(p.geom)) AS min_lat,
        ST_XMax(ST_Extent(p.geom)) AS max_lon,
        ST_YMax(ST_Extent(p.geom)) AS max_lat
      FROM acervo.produto p ${whereClause}`,
      params
    );

    // A página sai primeiro, e só depois se busca a última versão de cada
    // produto. Ao contrário, o LATERAL rodaria para o conjunto inteiro (que
    // pode ser o acervo todo) para descartar tudo menos 20 linhas.
    const produtos = await t.any(
      `WITH pagina AS (
        SELECT p.id, p.nome, p.mi, p.inom,
               p.tipo_escala_id, p.tipo_produto_id, p.subtipo_produto_id,
               p.denominador_escala_especial, p.descricao,
               p.data_cadastramento, p.data_modificacao
               ${comGeometria ? ', ST_AsGeoJSON(p.geom) AS geom' : ''}
        FROM acervo.produto p
        ${whereClause}
        ORDER BY p.nome, p.mi
        LIMIT $<limit> OFFSET $<offset>
      )
      SELECT
        pg.*,
        te.nome AS escala,
        tp.nome AS tipo_produto,
        -- Subtipo QUE DEFINE O PRODUTO, e não o da versão. Ele é o que separa
        -- dois produtos que, sem ele, saem idênticos na lista: a mesma folha
        -- tem a carta padrão e a Carta Topográfica Militar como produtos
        -- distintos, e sao a quase totalidade dos pares que repetem
        -- MI+tipo+escala.
        -- Sem esta coluna, os dois cartões ficavam indistinguíveis, e a lista
        -- parecia estar mostrando versões do mesmo produto.
        sp.nome AS subtipo_produto,
        COALESCE(vc.num_versoes, 0) AS num_versoes,
        ultima.versao AS ultima_versao,
        ultima.data_edicao AS ultima_data_edicao,
        ultima.palavras_chave,
        ultima.orgao_produtor
      FROM pagina pg
      INNER JOIN dominio.tipo_escala te ON te.code = pg.tipo_escala_id
      INNER JOIN dominio.tipo_produto tp ON tp.code = pg.tipo_produto_id
      LEFT JOIN dominio.subtipo_produto sp ON sp.code = pg.subtipo_produto_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS num_versoes FROM acervo.versao v WHERE v.produto_id = pg.id
      ) vc ON TRUE
      LEFT JOIN LATERAL (
        SELECT v.versao, v.data_edicao, v.palavras_chave, v.orgao_produtor
        FROM acervo.versao v
        WHERE v.produto_id = pg.id
        ORDER BY v.data_edicao DESC
        LIMIT 1
      ) ultima ON TRUE
      ORDER BY pg.nome, pg.mi`,
      params
    );

    // Sem resultado não há extensão: ST_Extent de conjunto vazio é NULL, e
    // devolver [null,null,null,null] faria o mapa tentar enquadrar o nada.
    const extent = resumo.min_lon === null ? null : [
      Number(resumo.min_lon), Number(resumo.min_lat),
      Number(resumo.max_lon), Number(resumo.max_lat)
    ];

    return {
      total: parseInt(resumo.total),
      page,
      limit,
      extent,
      dados: produtos.map(p => (
        comGeometria && p.geom ? { ...p, geom: JSON.parse(p.geom) } : p
      ))
    };
  });
};

// Camada do mapa: a geometria de TODOS os produtos que casam com os filtros.
//
// Existe porque paginar o mapa é um erro de leitura. Com 20 polígonos na tela
// de 800 resultados, o mapa afirma visualmente que o acervo tem 20 cartas ali,
// e quem olha não tem como saber que está vendo uma fatia.
//
// Devolve o mínimo por produto (id, nome, mi, escala) e a geometria. Nada de
// versão, contagem ou palavra-chave: isso é assunto do cartão, e o cartão vem
// da rota paginada.
//
// `truncado` avisa quando o teto cortou o conjunto. Truncar em silêncio seria
// repetir, em escala maior, o mesmo defeito que esta rota veio corrigir.
controller.buscaGeometrias = async (filtros = {}) => {
  // O padrão é o MESMO de `acervo_schema.buscaGeometrias`. Ficaram divergentes
  // (5.000 aqui contra 20.000 lá), e a rota nunca chegava neste ramo porque o
  // Joi já preenche o `limit`: quem chamasse o controlador direto pegava um teto
  // que o acervo inteiro estoura, e a camada do mapa voltaria truncada.
  const limit = filtros.limit || 20000;

  return db.conn.task(async t => {
    const { whereClause, params } = montarFiltrosBusca(filtros);
    params.limit = limit;

    const total = await t.one(
      `SELECT COUNT(*) AS total FROM acervo.produto p ${whereClause}`,
      params
    );

    const linhas = await t.any(
      `SELECT p.id, p.nome, p.mi, te.nome AS escala,
              -- O (9, 0) corta o campo \`crs\` que o ST_AsGeoJSON emite por
              -- padrão. Ele é resquício de uma versão antiga do GeoJSON, a RFC
              -- 7946 o removeu e o MapLibre o ignora. Medido no PostGIS 3.4.1:
              -- 172 bytes por geometria contra 116, num corpo que traz o acervo
              -- INTEIRO.
              ST_AsGeoJSON(p.geom, 9, 0) AS geom,
              -- Ponto de rótulo, calculado aqui e não no navegador.
              --
              -- Rotular o POLÍGONO faz a mesma carta aparecer duas vezes: o
              -- MapLibre corta o GeoJSON em ladrilhos e ancora o texto por
              -- pedaço, então a folha que cruza a borda ganha um rótulo de cada
              -- lado. Um ponto cabe num ladrilho só. É a mesma solução do mapa
              -- da mapoteca (mapoteca/dashboard_ctrl.js), e pelo mesmo motivo.
              --
              -- PointOnSurface, e não Centroid: o centroide de uma folha em L
              -- cai fora dela, e o rótulo apareceria sobre a carta vizinha.
              ST_AsGeoJSON(ST_PointOnSurface(p.geom), 9, 0) AS ponto,
              -- Área só para ordenar o desenho. O mapeamento do SCN é ANINHADO
              -- por escala (a 2952-1-SO está contida na 2952 e na 535): sem
              -- ordenar, a folha grande cai por cima da pequena e a engole.
              ST_Area(p.geom)::float8 AS area
       FROM acervo.produto p
       INNER JOIN dominio.tipo_escala te ON te.code = p.tipo_escala_id
       ${whereClause}
       ORDER BY p.id
       LIMIT $<limit>`,
      params
    );

    return {
      total: parseInt(total.total),
      truncado: parseInt(total.total) > linhas.length,
      dados: linhas.map(l => ({
        id: l.id,
        nome: l.nome,
        mi: l.mi,
        escala: l.escala,
        geom: JSON.parse(l.geom),
        ponto: JSON.parse(l.ponto),
        area: l.area
      }))
    };
  });
};

// Opções dos três filtros da busca, com o quantitativo de PRODUTOS de cada uma.
//
// Duas propriedades que o desenho garante, e que são o ponto da rota:
//
// 1. O número ao lado de uma opção é, por construção, o total que a busca
//    devolveria ao escolhê-la. Ele sai do MESMO `montarFiltrosBusca` da lista e
//    da camada do mapa, então os três não têm como divergir.
// 2. Cada lista aplica os OUTROS filtros e nunca o próprio (ver `exceto`).
//    Escolher "Carta Topográfica" passa a mostrar quantas cartas topográficas
//    existem em cada escala, e trocar de escala continua possível sem limpar
//    nada antes.
//
// São três consultas, e não uma com GROUPING SETS: cada uma tem um WHERE
// diferente (justamente por causa do `exceto`), então não há conjunto comum para
// agrupar. Elas rodam na mesma task, sobre 5.741 produtos.
controller.buscaFacetas = async (filtros = {}) => {
  return db.conn.task(async t => {
    const porTipo = montarFiltrosBusca(filtros, 'tipo_produto_id');
    const porEscala = montarFiltrosBusca(filtros, 'tipo_escala_id');
    const porSubtipo = montarFiltrosBusca(filtros, 'subtipo_produto_id');

    const tipos = await t.any(
      `SELECT tp.code, tp.nome, COUNT(p.id)::int AS produtos
       FROM acervo.produto p
       INNER JOIN dominio.tipo_produto tp ON tp.code = p.tipo_produto_id
       ${porTipo.whereClause}
       GROUP BY tp.code, tp.nome
       ORDER BY tp.nome`,
      porTipo.params
    );

    const escalas = await t.any(
      `SELECT te.code, te.nome, COUNT(p.id)::int AS produtos
       FROM acervo.produto p
       INNER JOIN dominio.tipo_escala te ON te.code = p.tipo_escala_id
       ${porEscala.whereClause}
       GROUP BY te.code, te.nome
       ORDER BY te.code`,
      porEscala.params
    );

    // O subtipo mora em DOIS lugares, e o filtro casa nos dois (ver o
    // comentário de `montarFiltrosBusca`): `produto.subtipo_produto_id` quando o
    // subtipo define o produto, e `versao.subtipo_produto_id` no dia a dia. O
    // LATERAL junta as duas origens numa lista de subtipos por produto, e o
    // COUNT(DISTINCT) impede que o produto com três versões do mesmo subtipo
    // seja contado três vezes.
    const subtipos = await t.any(
      `SELECT sp.code, sp.nome, sp.tipo_id, COUNT(DISTINCT p.id)::int AS produtos
       FROM acervo.produto p
       JOIN LATERAL (
         SELECT p.subtipo_produto_id AS code WHERE p.subtipo_produto_id IS NOT NULL
         UNION
         SELECT v.subtipo_produto_id FROM acervo.versao v
         WHERE v.produto_id = p.id AND v.subtipo_produto_id IS NOT NULL
       ) origem ON TRUE
       INNER JOIN dominio.subtipo_produto sp ON sp.code = origem.code
       ${porSubtipo.whereClause}
       GROUP BY sp.code, sp.nome, sp.tipo_id
       ORDER BY sp.nome`,
      porSubtipo.params
    );

    // Lugar: SO o que tem produto, com o quantitativo, e cada lista aplicando os
    // OUTROS filtros e nunca o proprio. Um combo com os 5.572 municipios do
    // Brasil, dos quais 300 tem produto, faz procurar agulha.
    const porEstado = montarFiltrosBusca(filtros, 'estado_id');
    const porMunicipio = montarFiltrosBusca(filtros, 'municipio_id');

    const estados = await t.any(
      `SELECT e.id, e.sigla, e.nome, COUNT(DISTINCT p.id)::int AS produtos
       FROM acervo.produto p
       INNER JOIN limites.estado e ON ST_Intersects(p.geom, e.geom)
       ${porEstado.whereClause}
       GROUP BY e.id, e.sigla, e.nome
       ORDER BY e.nome`,
      porEstado.params
    );

    // O municipio so entra na lista quando ha ESTADO marcado. Sem isso a
    // resposta traria centenas de municipios de todo o Brasil, e a lista deixa
    // de ajudar a escolher. Com mais de um estado marcado, a lista e a UNIAO
    // dos municipios deles.
    const municipios = temValor(filtros.estado_id)
      ? await t.any(
        `SELECT m.id, m.nome, COUNT(DISTINCT p.id)::int AS produtos
         FROM acervo.produto p
         INNER JOIN limites.municipio m ON ST_Intersects(p.geom, m.geom)
         ${porMunicipio.whereClause}
           ${porMunicipio.whereClause ? 'AND' : 'WHERE'} m.estado_id IN ($<estadoDaLista:csv>)
         GROUP BY m.id, m.nome
         ORDER BY m.nome`,
        { ...porMunicipio.params, estadoDaLista: filtros.estado_id }
      )
      : [];

    return {
      tipos_produto: tipos,
      tipos_escala: escalas,
      subtipos_produto: subtipos,
      estados,
      municipios
    };
  });
};

// CSV do resultado da busca.
//
// Exporta o conjunto INTEIRO (ou só os selecionados, via `ids`), e não a página
// que está na tela: exportar 20 de 800 seria a mesma armadilha que o mapa
// paginado era.
//
// Uma linha por PRODUTO, com a última versão, que é a granularidade da busca. A
// planilha completa por versão já existe em /acervo/export-planilha-csv.
controller.buscaCsv = async (filtros = {}) => {
  const { whereClause, params } = montarFiltrosBusca(filtros);

  const linhas = await db.conn.any(
    `SELECT
      p.nome, p.mi, p.inom,
      tp.nome AS tipo_produto,
      te.nome AS escala,
      p.denominador_escala_especial,
      COALESCE(vc.num_versoes, 0) AS num_versoes,
      ultima.versao AS ultima_versao,
      ultima.data_edicao AS ultima_data_edicao,
      ultima.orgao_produtor,
      ultima.palavras_chave
    FROM acervo.produto p
    INNER JOIN dominio.tipo_escala te ON te.code = p.tipo_escala_id
    INNER JOIN dominio.tipo_produto tp ON tp.code = p.tipo_produto_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS num_versoes FROM acervo.versao v WHERE v.produto_id = p.id
    ) vc ON TRUE
    LEFT JOIN LATERAL (
      SELECT v.versao, v.data_edicao, v.orgao_produtor, v.palavras_chave
      FROM acervo.versao v
      WHERE v.produto_id = p.id
      ORDER BY v.data_edicao DESC
      LIMIT 1
    ) ultima ON TRUE
    ${whereClause}
    ORDER BY p.nome, p.mi`,
    params
  );

  const COLS = ['Nome', 'MI', 'INOM', 'Tipo_Produto', 'Escala', 'Versoes',
    'Ultima_Versao', 'Data_Edicao', 'Orgao_Produtor', 'Palavras_Chave'];

  // Mesmo escape do export de planilha: aspas dobradas, e o campo entre aspas
  // quando houver vírgula, aspas ou quebra de linha.
  const esc = (v) => {
    if (v == null) return '';
    const texto = String(v);
    return /[",\n\r]/.test(texto) ? '"' + texto.replace(/"/g, '""') + '"' : texto;
  };

  // A data sai em ISO (AAAA-MM-DD), cortando o timestamp por string: passar por
  // Date aqui reintroduziria o deslize de fuso que já mordeu a mapoteca.
  const soData = (d) => (d ? String(d.toISOString ? d.toISOString() : d).slice(0, 10) : '');

  const corpo = linhas.map(l => [
    l.nome,
    l.mi,
    l.inom,
    l.tipo_produto,
    l.denominador_escala_especial ? `1:${l.denominador_escala_especial}` : l.escala,
    l.num_versoes,
    l.ultima_versao,
    soData(l.ultima_data_edicao),
    l.orgao_produtor,
    (l.palavras_chave || []).join('; ')
  ].map(esc).join(','));

  // BOM para o Excel abrir com a acentuação certa, e CRLF pelo mesmo motivo.
  return '﻿' + [COLS.join(','), ...corpo].join('\r\n');
};

// Palavras-chave em uso no acervo, para a busca sugerir em vez de exigir que a
// pessoa adivinhe a etiqueta.
//
// `palavras_chave` e TEXT[] em acervo.versao, entao o unnest e inevitavel. O
// teto de 20 e o filtro por prefixo mantem a consulta barata mesmo com o acervo
// inteiro: e uma caixa de sugestao, nao um relatorio.
controller.palavrasChave = async (termo, limit) => {
  return db.conn.any(
    `SELECT pk AS palavra, COUNT(*) AS usos
     FROM acervo.versao v, unnest(v.palavras_chave) AS pk
     WHERE pk IS NOT NULL AND pk <> ''
       ${termo ? 'AND pk ILIKE $<termo>' : ''}
     GROUP BY pk
     ORDER BY COUNT(*) DESC, pk
     LIMIT $<limit>`,
    { termo: `%${termo || ''}%`, limit }
  );
};

// Roda os invariantes lógicos e devolve, por invariante, o TOTAL e uma amostra.
//
// Cada um roda numa consulta própria porque são independentes: um que estoure
// (tabela grande, geometria inválida) não pode derrubar o relatório inteiro, e
// por isso o erro vira campo do resultado em vez de exceção. Auditoria que
// morre no meio esconde justamente o que veio depois.
//
// Executa em transação READ ONLY: são todos SELECT por construção, e a trava
// no banco é o que garante isso mesmo se alguém escrever um invariante errado.
controller.getAuditoria = async ({ severidade, codigos, amostra = 10 } = {}) => {
  let alvos = invariantes.INVARIANTES
  if (severidade) alvos = alvos.filter(i => i.severidade === severidade)
  if (codigos && codigos.length) {
    const pedidos = new Set(codigos)
    alvos = alvos.filter(i => pedidos.has(i.codigo))
    const desconhecidos = codigos.filter(c => !invariantes.INVARIANTES.some(i => i.codigo === c))
    if (desconhecidos.length) {
      throw new AppError(
        `Invariante(s) desconhecido(s): ${desconhecidos.join(', ')}.`,
        httpCode.BadRequest
      )
    }
  }

  return db.conn.tx(async t => {
    await t.none('SET TRANSACTION READ ONLY')

    const resultados = []
    for (const inv of alvos) {
      const base = { codigo: inv.codigo, severidade: inv.severidade, titulo: inv.titulo }
      try {
        const linhas = await t.any(inv.sql)
        resultados.push({
          ...base,
          total: linhas.length,
          amostra: amostra > 0 ? linhas.slice(0, amostra) : [],
          truncada: linhas.length > amostra
        })
      } catch (err) {
        // Não relança: o invariante que quebrou é informação, e os outros 32
        // continuam valendo.
        resultados.push({ ...base, total: null, amostra: [], erro: err.message })
      }
    }
    return resultados
  })
}

module.exports = controller;

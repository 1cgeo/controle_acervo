// Path: produto\produto_ctrl.js
"use strict";

const { db } = require("../database");
const { AppError, httpCode, preserveOmitted, domainConstants: { STATUS_ARQUIVO, TIPO_VERSAO, TIPO_RELACIONAMENTO } } = require("../utils");
const { v4: uuidv4 } = require('uuid');

const controller = {};

controller.atualizaProduto = async (produto, usuarioUuid) => {
  return db.conn.tx(async t => {
    produto.data_modificacao = new Date()
    produto.usuario_modificacao_uuid = usuarioUuid

    // Chave ausente = "não mexe neste campo". Antes, omitir subtipo_produto_id
    // apagava a identidade do produto em silêncio (Joi .default(null) + def:null
    // no ColumnSet), e bastava reenviar o que o GET devolvia para uma Carta
    // Militar deixar de ser militar. Enviar null explícito ainda despina.
    await preserveOmitted(t, {
      table: 'produto',
      id: produto.id,
      fields: ['subtipo_produto_id'],
      body: produto
    })

    // O trigger acervo.validate_version recusa versão cujo subtipo divirja do subtipo do
    // produto. Fixar o produto num subtipo conflitante não falha aqui: falha na próxima
    // carga, longe da causa. Por isso valida-se contra as versões que já existem.
    // Passar null (despinar) é sempre permitido: é o estado da maioria dos produtos e é o
    // que permite guardar mais de uma geração no mesmo produto (ex.: EDGV 2.1.3 e 3.0).
    if (produto.subtipo_produto_id !== null && produto.subtipo_produto_id !== undefined) {
      const conflito = await t.oneOrNone(`
        SELECT string_agg(DISTINCT v.subtipo_produto_id::text, ', ') AS subtipos
        FROM acervo.versao v
        WHERE v.produto_id = $1 AND v.subtipo_produto_id <> $2
      `, [produto.id, produto.subtipo_produto_id])

      if (conflito && conflito.subtipos) {
        throw new AppError(
          `Produto tem versões de subtipo ${conflito.subtipos}; não pode ser fixado no subtipo ${produto.subtipo_produto_id}`,
          httpCode.BadRequest
        )
      }
    }

    if (produto.geom) {
      // Atualizar com geometria usando query parametrizada
      await t.none(`
        UPDATE acervo.produto SET
          nome = $2, mi = $3, inom = $4, tipo_escala_id = $5,
          denominador_escala_especial = $6, tipo_produto_id = $7, descricao = $8,
          geom = ST_GeomFromEWKT($9), data_modificacao = $10, usuario_modificacao_uuid = $11,
          subtipo_produto_id = $12
        WHERE id = $1
      `, [produto.id, produto.nome, produto.mi, produto.inom, produto.tipo_escala_id,
          produto.denominador_escala_especial, produto.tipo_produto_id, produto.descricao,
          produto.geom, produto.data_modificacao, produto.usuario_modificacao_uuid,
          produto.subtipo_produto_id === undefined ? null : produto.subtipo_produto_id])
    } else {
      // mi/inom são opcionais no Joi — def evita "Property doesn't exist" do pgp
      const colunasProduto = [
        'nome',
        { name: 'mi', def: null },
        { name: 'inom', def: null },
        'tipo_escala_id', 'denominador_escala_especial',
        'tipo_produto_id', 'descricao',
        { name: 'subtipo_produto_id', def: null },
        'data_modificacao', 'usuario_modificacao_uuid'
      ]

      const cs = new db.pgp.helpers.ColumnSet(colunasProduto, { table: { table: 'produto', schema: 'acervo' } })
      const query = db.pgp.helpers.update(produto, cs) + ' WHERE id = $1'

      await t.none(query, [produto.id])
    }

  })
}

controller.atualizaVersao = async (versao, usuarioUuid) => {
  return db.conn.tx(async t => {
    versao.data_modificacao = new Date();
    versao.usuario_modificacao_uuid = usuarioUuid;

    const versaoAtual = await t.oneOrNone(
      'SELECT uuid_versao FROM acervo.versao WHERE id = $1',
      [versao.id]
    );

    if (!versaoAtual) {
      throw new AppError('Versão não encontrada', httpCode.NotFound);
    }

    // uuid_versao é aceito pelo schema mas NÃO está no ColumnSet abaixo: é
    // imutável (o pedido da mapoteca referencia a versão por ele). Antes, mandar
    // um uuid_versao diferente devolvia 200 sem gravar nada, ou seja, o cliente
    // achava que tinha corrigido o identificador. Reenviar o mesmo valor que o
    // GET devolveu continua válido; divergir é erro explícito.
    if (versao.uuid_versao !== undefined && versao.uuid_versao !== versaoAtual.uuid_versao) {
      throw new AppError(
        'uuid_versao é imutável e não pode ser alterado por esta rota',
        httpCode.BadRequest
      );
    }

    // Chave ausente = "não mexe": omitir palavras_chave zerava as gravadas
    await preserveOmitted(t, {
      table: 'versao',
      id: versao.id,
      fields: ['palavras_chave'],
      body: versao
    });

    // Espelha a UNIQUE unique_version_per_product com erro amigável.
    //
    // O SUBTIPO faz parte da chave, e omiti-lo aqui tornava esta checagem mais
    // rígida que a constraint que ela diz espelhar: o produto que tem a Carta
    // Ortoimagem SCN e a Especial, ambas rotuladas "1ª Edição" (legítimo, e é o
    // que a UNIQUE permite), passava a REJEITAR qualquer edição de qualquer uma
    // das duas, com 409. Apareceu ao marcar palavra-chave nos mosaicos
    // RADAMBRASIL: 16 dos 42 produtos têm as duas versões, e os 16 falharam.
    const versaoExistente = await t.oneOrNone(
      `SELECT id FROM acervo.versao
       WHERE produto_id = (SELECT produto_id FROM acervo.versao WHERE id = $1)
       AND versao = $2 AND subtipo_produto_id = $3 AND id != $1`,
      [versao.id, versao.versao, versao.subtipo_produto_id]
    );
    if (versaoExistente) {
      throw new AppError(
        `Já existe a versão "${versao.versao}" para este produto neste subtipo`,
        httpCode.Conflict
      );
    }

    const colunasVersao = [
      'versao', 'nome', 'tipo_versao_id', 'subtipo_produto_id',
      'descricao', 'metadado', 'lote_id',
      'orgao_produtor', 'palavras_chave',
      'data_criacao', 'data_edicao',
      'data_modificacao', 'usuario_modificacao_uuid'
    ];

    const cs = new db.pgp.helpers.ColumnSet(colunasVersao, { table: { table: 'versao', schema: 'acervo' } });
    const query = db.pgp.helpers.update(versao, cs) + ' WHERE id = $1';

    await t.none(query, [versao.id]);

  });
};

/**
 * Corrige o `uuid_versao` de uma ou mais versões para o identificador que o
 * BDGEx já publicou.
 *
 * POR QUE existe uma rota só para isto. O `uuid_versao` identifica a versão nos
 * DOIS lados: no acervo e na publicação. Quando a carga no BDGEx vem antes da
 * catalogação (ou é refeita), quem já atribuiu o número é o BDGEx, e é o acervo
 * que se acerta. Sem esta rota a única saída seria apagar e recadastrar a
 * versão, o que perderia arquivo, relacionamento e histórico de pedido.
 *
 * O `atualizaVersao` continua RECUSANDO a troca, e continua certo: lá o
 * uuid_versao chega junto de vinte outros campos, e trocá-lo seria acidente.
 * Aqui a troca é o propósito declarado, com motivo obrigatório.
 *
 * O item de pedido que aponta a versão acompanha, pela cascata da chave
 * estrangeira (migração 2026-07-31_uuid_versao_corrigivel.sql). Sem ela, o
 * UPDATE falharia por integridade referencial.
 *
 * @param {Array<{versao_id: number, uuid_versao: string}>} correcoes
 * @param {string} motivo - de onde saiu o identificador novo
 * @param {string} usuarioUuid
 * @returns {Promise<Array<{versao_id: number, uuid_anterior: string, uuid_versao: string, itens_pedido: number}>>}
 */
controller.corrigeUuidVersao = async (correcoes, motivo, usuarioUuid) => {
  return db.conn.tx(async t => {
    const ids = correcoes.map(c => c.versao_id);
    const atuais = await t.any(
      'SELECT id, uuid_versao, metadado FROM acervo.versao WHERE id IN ($1:csv)',
      [ids]
    );

    if (atuais.length !== ids.length) {
      const achados = atuais.map(v => Number(v.id));
      const faltando = ids.filter(id => !achados.includes(id));
      throw new AppError(
        `As seguintes versões não foram encontradas: ${faltando.join(', ')}`,
        httpCode.NotFound
      );
    }

    const porId = new Map(atuais.map(v => [Number(v.id), v]));

    // O uuid novo não pode já pertencer a OUTRA versão. A UNIQUE do banco pegaria
    // isso, mas com mensagem de constraint; aqui o erro diz qual linha do lote
    // está errada, que é o que quem manda o lote precisa saber.
    const novos = correcoes.map(c => c.uuid_versao);
    const ocupados = await t.any(
      'SELECT id, uuid_versao FROM acervo.versao WHERE uuid_versao IN ($1:csv) AND id NOT IN ($2:csv)',
      [novos, ids]
    );
    if (ocupados.length > 0) {
      const lista = ocupados.map(o => `${o.uuid_versao} (versão ${o.id})`).join(', ');
      throw new AppError(
        `Estes identificadores já pertencem a outra versão: ${lista}`,
        httpCode.Conflict
      );
    }

    const resultado = [];
    for (const c of correcoes) {
      const atual = porId.get(c.versao_id);
      if (atual.uuid_versao === c.uuid_versao) {
        // Reenviar o mesmo valor não é erro: a rota é idempotente de propósito,
        // porque um lote de 42 folhas pode ser reexecutado depois de uma falha
        // parcial de rede.
        resultado.push({
          versao_id: c.versao_id,
          uuid_anterior: atual.uuid_versao,
          uuid_versao: c.uuid_versao,
          itens_pedido: 0,
          alterado: false
        });
        continue;
      }

      const itens = await t.one(
        'SELECT COUNT(*)::int AS total FROM mapoteca.produto_pedido WHERE uuid_versao = $1',
        [atual.uuid_versao]
      );

      // O identificador antigo fica registrado no metadado da própria versão: é
      // a trilha de quem procurar pelo número velho num RTM antigo.
      const metadado = Object.assign({}, atual.metadado || {}, {
        uuid_versao_anterior: atual.uuid_versao,
        uuid_versao_correcao_motivo: motivo,
        uuid_versao_corrigido_em: new Date().toISOString()
      });

      await t.none(
        `UPDATE acervo.versao
         SET uuid_versao = $1, metadado = $2, data_modificacao = $3, usuario_modificacao_uuid = $4
         WHERE id = $5`,
        [c.uuid_versao, metadado, new Date(), usuarioUuid, c.versao_id]
      );

      resultado.push({
        versao_id: c.versao_id,
        uuid_anterior: atual.uuid_versao,
        uuid_versao: c.uuid_versao,
        itens_pedido: itens.total,
        alterado: true
      });
    }

    return resultado;
  });
};

controller.deleteProdutos = async (produtoIds, motivo_exclusao, usuarioUuid) => {
  const data_delete = new Date();
  const usuario_delete_uuid = usuarioUuid;

  return db.conn.tx(async t => {
    // Verificar se todos os IDs de produto existem
    const existingProducts = await t.any(
      `SELECT id FROM acervo.produto WHERE id IN ($1:csv)`,
      [produtoIds]
    );

    if (existingProducts.length !== produtoIds.length) {
      // BIGSERIAL retorna como string no driver — normalizar para número
      const existingIds = existingProducts.map(p => Number(p.id));
      const missingIds = produtoIds.filter(id => !existingIds.includes(parseInt(id)));
      throw new AppError(`Os seguintes produtos não foram encontrados: ${missingIds.join(', ')}`, httpCode.NotFound);
    }

    // Versões referenciadas por pedidos da mapoteca bloqueiam a exclusão (FK).
    // Checar antes para devolver mensagem orientativa em vez de erro de FK.
    const pedidosVinculados = await t.any(
      `SELECT DISTINCT COALESCE(ped.localizador_pedido, ped.id::text) AS pedido
       FROM mapoteca.produto_pedido pp
       JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
       JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
       WHERE v.produto_id IN ($1:csv)`,
      [produtoIds]
    );

    if (pedidosVinculados.length > 0) {
      const pedidos = pedidosVinculados.map(p => p.pedido).join(', ');
      throw new AppError(
        `Não é possível excluir: há versões vinculadas a pedidos da mapoteca (${pedidos}). Remova antes os itens desses pedidos.`,
        httpCode.BadRequest
      );
    }

    for (let id of produtoIds) {
      const produto = await t.one('SELECT * FROM acervo.produto WHERE id = $1', [id]);

      // Find all versions related to the product
      const versoes = await t.any('SELECT * FROM acervo.versao WHERE produto_id = $1', [id]);
      for (let versao of versoes) {
        // Move associated files to arquivo_deletado table
        const arquivos = await t.any('SELECT * FROM acervo.arquivo WHERE versao_id = $1', [versao.id]);
        for (let arquivo of arquivos) {
          const { id: arquivoDeletadoId } = await t.one(
            `INSERT INTO acervo.arquivo_deletado (
              uuid_arquivo, nome, nome_arquivo, motivo_exclusao, versao_id, tipo_arquivo_id, 
              volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado, 
              tipo_status_id, situacao_carregamento_id, descricao, crs_original,
              data_cadastramento, usuario_cadastramento_uuid, data_modificacao, 
              usuario_modificacao_uuid, data_delete, usuario_delete_uuid
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 
                      $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
              RETURNING id`,
            [
              arquivo.uuid_arquivo,
              arquivo.nome,
              arquivo.nome_arquivo,
              motivo_exclusao,
              arquivo.versao_id,
              arquivo.tipo_arquivo_id,
              arquivo.volume_armazenamento_id,
              arquivo.extensao,
              arquivo.tamanho_mb,
              arquivo.checksum,
              arquivo.metadado,
              STATUS_ARQUIVO.EXCLUIDO,
              arquivo.situacao_carregamento_id,
              arquivo.descricao,
              arquivo.crs_original, // Adicionado crs_original
              arquivo.data_cadastramento,
              arquivo.usuario_cadastramento_uuid,
              arquivo.data_modificacao,
              arquivo.usuario_modificacao_uuid,
              data_delete,
              usuario_delete_uuid
            ]
          );

          // Move related downloads to download_deletado table for THIS file
          await t.none(
            `INSERT INTO acervo.download_deletado (arquivo_deletado_id, usuario_uuid, data_download)
             SELECT $1, d.usuario_uuid, d.data_download
             FROM acervo.download d
             WHERE d.arquivo_id = $2`,
            [arquivoDeletadoId, arquivo.id]
          );

          // Delete related downloads from the original download table
          await t.none('DELETE FROM acervo.download WHERE arquivo_id = $1', [arquivo.id]);
        }

        // Delete files from the original arquivo table
        await t.none('DELETE FROM acervo.arquivo WHERE versao_id = $1', [versao.id]);

        // Check for versao_relacionamento and delete
        await t.none(`
          DELETE FROM acervo.versao_relacionamento 
          WHERE versao_id_1 = $1 OR versao_id_2 = $1`,
          [versao.id]
        );
      }

      // Delete all versions
      await t.none('DELETE FROM acervo.versao WHERE produto_id = $1', [id]);

      // Finally, delete the product itself from the produto table
      await t.none('DELETE FROM acervo.produto WHERE id = $1', [id]);
    }

  });
};

controller.deleteVersoes = async (versaoIds, motivo_exclusao, usuarioUuid) => {
  const data_delete = new Date();
  const usuario_delete_uuid = usuarioUuid;

  return db.conn.tx(async t => {
    // Verificar se todos os IDs de versão existem
    const existingVersions = await t.any(
      `SELECT id FROM acervo.versao WHERE id IN ($1:csv)`,
      [versaoIds]
    );

    if (existingVersions.length !== versaoIds.length) {
      const existingIds = existingVersions.map(v => Number(v.id));
      const missingIds = versaoIds.filter(id => !existingIds.includes(parseInt(id)));
      throw new AppError(`As seguintes versões não foram encontradas: ${missingIds.join(', ')}`, httpCode.NotFound);
    }

    // Versões referenciadas por pedidos da mapoteca bloqueiam a exclusão (FK).
    // Checar antes para devolver mensagem orientativa em vez de erro de FK.
    const pedidosVinculados = await t.any(
      `SELECT DISTINCT COALESCE(ped.localizador_pedido, ped.id::text) AS pedido
       FROM mapoteca.produto_pedido pp
       JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
       JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
       WHERE v.id IN ($1:csv)`,
      [versaoIds]
    );

    if (pedidosVinculados.length > 0) {
      const pedidos = pedidosVinculados.map(p => p.pedido).join(', ');
      throw new AppError(
        `Não é possível excluir: as versões estão vinculadas a pedidos da mapoteca (${pedidos}). Remova antes os itens desses pedidos.`,
        httpCode.BadRequest
      );
    }

    // Verificar se alguma versão possui versões posteriores que dependem dela (formato X-SIGLA)
    for (let id of versaoIds) {
      const versao = await t.one('SELECT * FROM acervo.versao WHERE id = $1', [id]);

      // Verificar formato novo "X-SIGLA"
      const match = versao.versao.match(/^(\d+)-([A-Z]{1,5})$/);
      if (match) {
        const versionNumber = parseInt(match[1]);
        const acronym = match[2];
        const nextVersion = `${versionNumber + 1}-${acronym}`;

        // Verificar se existe versão posterior que depende desta
        const dependente = await t.oneOrNone(
          `SELECT id FROM acervo.versao
           WHERE produto_id = $1 AND versao = $2 AND id NOT IN ($3:csv)`,
          [versao.produto_id, nextVersion, versaoIds]
        );

        if (dependente) {
          throw new AppError(
            `Não é possível excluir a versão "${versao.versao}" pois a versão "${nextVersion}" depende dela. Exclua as versões posteriores primeiro.`,
            httpCode.BadRequest
          );
        }
      }
    }

    for (let id of versaoIds) {
      const versao = await t.one('SELECT * FROM acervo.versao WHERE id = $1', [id]);

      // Verificar se é a única versão do produto
      const countVersions = await t.one(
        `SELECT COUNT(*) as count FROM acervo.versao WHERE produto_id = $1`,
        [versao.produto_id]
      );

      if (parseInt(countVersions.count) === 1) {
        throw new AppError(
          `Não é possível excluir a versão ${versao.versao} pois é a única versão do produto. Delete o produto inteiro.`,
          httpCode.BadRequest
        );
      }

      // Move associated files to arquivo_deletado table
      const arquivos = await t.any('SELECT * FROM acervo.arquivo WHERE versao_id = $1', [versao.id]);
      for (let arquivo of arquivos) {
        const { id: arquivoDeletadoId } = await t.one(
          `INSERT INTO acervo.arquivo_deletado (
            uuid_arquivo, nome, nome_arquivo, motivo_exclusao, versao_id, tipo_arquivo_id, 
            volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado, 
            tipo_status_id, situacao_carregamento_id, descricao, crs_original,
            data_cadastramento, usuario_cadastramento_uuid, data_modificacao, 
            usuario_modificacao_uuid, data_delete, usuario_delete_uuid
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 
                    $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
          RETURNING id`,
          [
            arquivo.uuid_arquivo,
            arquivo.nome,
            arquivo.nome_arquivo,
            motivo_exclusao,
            arquivo.versao_id,
            arquivo.tipo_arquivo_id,
            arquivo.volume_armazenamento_id,
            arquivo.extensao,
            arquivo.tamanho_mb,
            arquivo.checksum,
            arquivo.metadado,
            STATUS_ARQUIVO.EXCLUIDO,
            arquivo.situacao_carregamento_id,
            arquivo.descricao,
            arquivo.crs_original, // Adicionado crs_original
            arquivo.data_cadastramento,
            arquivo.usuario_cadastramento_uuid,
            arquivo.data_modificacao,
            arquivo.usuario_modificacao_uuid,
            data_delete,
            usuario_delete_uuid
          ]
        );

        // Move related downloads to download_deletado table for THIS file
        await t.none(
          `INSERT INTO acervo.download_deletado (arquivo_deletado_id, usuario_uuid, data_download)
           SELECT $1, d.usuario_uuid, d.data_download
           FROM acervo.download d
           WHERE d.arquivo_id = $2`,
          [arquivoDeletadoId, arquivo.id]
        );

        // Delete related downloads from the original download table
        await t.none('DELETE FROM acervo.download WHERE arquivo_id = $1', [arquivo.id]);
      }

      // Delete files from the original arquivo table
      await t.none('DELETE FROM acervo.arquivo WHERE versao_id = $1', [versao.id]);

      // Delete related versao_relacionamento entries
      await t.none(`
        DELETE FROM acervo.versao_relacionamento 
        WHERE versao_id_1 = $1 OR versao_id_2 = $1`,
        [versao.id]
      );

      // Delete the version itself from the versao table
      await t.none('DELETE FROM acervo.versao WHERE id = $1', [versao.id]);
    }

  });
};

controller.moverArquivos = async (arquivoIds, versaoIdDestino, usuarioUuid, permitirEntreProdutos = false, permitirEsvaziarOrigem = false) => {
  return db.conn.tx(async t => {
    // Versao de destino existe?
    const destino = await t.oneOrNone(
      'SELECT id, produto_id FROM acervo.versao WHERE id = $1',
      [versaoIdDestino]
    );
    if (!destino) {
      throw new AppError(`Versão de destino ${versaoIdDestino} não encontrada`, httpCode.NotFound);
    }

    // Todos os arquivos existem?
    const arquivos = await t.any(
      'SELECT id, versao_id, checksum FROM acervo.arquivo WHERE id IN ($1:csv)',
      [arquivoIds]
    );
    if (arquivos.length !== arquivoIds.length) {
      const achados = arquivos.map(a => Number(a.id));
      const faltando = arquivoIds.filter(id => !achados.includes(parseInt(id)));
      throw new AppError(`Arquivos não encontrados: ${faltando.join(', ')}`, httpCode.NotFound);
    }

    // Algum ja esta no destino?
    const jaNoDestino = arquivos.filter(a => Number(a.versao_id) === Number(versaoIdDestino));
    if (jaNoDestino.length > 0) {
      throw new AppError(
        `Arquivo(s) já pertencem à versão de destino: ${jaNoDestino.map(a => a.id).join(', ')}`,
        httpCode.BadRequest
      );
    }

    // Por padrao, so entre versoes do MESMO produto. Cross-produto exige opt-in explicito
    // (correcao de arquivo carregado no produto/tipo errado, ex.: tematica carregada como topo).
    const origemVersaoIds = [...new Set(arquivos.map(a => Number(a.versao_id)))];
    const produtos = await t.any(
      'SELECT DISTINCT produto_id FROM acervo.versao WHERE id IN ($1:csv)',
      [origemVersaoIds]
    );
    const mesmoProduto = produtos.length === 1 && Number(produtos[0].produto_id) === Number(destino.produto_id);
    if (!mesmoProduto && !permitirEntreProdutos) {
      throw new AppError(
        'Só é possível mover arquivos entre versões do mesmo produto (envie permitir_entre_produtos=true para mover entre produtos diferentes)',
        httpCode.BadRequest
      );
    }

    // Nao deixar a versao de origem sem nenhum arquivo, salvo opt-in explicito
    // (uso: a origem vai ser deletada em seguida, ex.: produto carregado so com
    // conteudo do tipo errado, sem nenhum arquivo genuino a manter).
    if (!permitirEsvaziarOrigem) {
      for (const ov of origemVersaoIds) {
        const total = await t.one(
          'SELECT COUNT(*)::int AS n FROM acervo.arquivo WHERE versao_id = $1',
          [ov]
        );
        const movidosDessa = arquivos.filter(a => Number(a.versao_id) === ov).length;
        if (total.n - movidosDessa < 1) {
          throw new AppError(
            `A operação deixaria a versão ${ov} sem arquivos. Para remover a versão, use o delete de versão, ou envie permitir_esvaziar_origem=true se a versão/produto de origem será deletado a seguir.`,
            httpCode.BadRequest
          );
        }
      }
    }

    // Respeitar unique_file_per_version (checksum, versao_id) no destino
    for (const a of arquivos) {
      const colide = await t.oneOrNone(
        'SELECT id FROM acervo.arquivo WHERE versao_id = $1 AND checksum = $2',
        [versaoIdDestino, a.checksum]
      );
      if (colide) {
        throw new AppError(
          `A versão de destino já possui um arquivo com o mesmo checksum (arquivo ${colide.id})`,
          httpCode.Conflict
        );
      }
    }

    // Mover
    const data_modificacao = new Date();
    await t.none(
      `UPDATE acervo.arquivo
       SET versao_id = $1, data_modificacao = $2, usuario_modificacao_uuid = $3
       WHERE id IN ($4:csv)`,
      [versaoIdDestino, data_modificacao, usuarioUuid, arquivoIds]
    );
  });
};

// Regex e sufixo de rotulo para cada familia de numeracao de versao (espelha
// acervo.validate_version: "Nª Edição" legado, ou "N-SIGLA" produzido por orgao).
function familiaVersao(familia) {
  if (familia === 'EDICAO') {
    return { regex: /^([0-9]+)ª Edição$/, sufixo: 'ª Edição' };
  }
  return { regex: new RegExp(`^([0-9]+)-${familia}$`), sufixo: `-${familia}` };
}

controller.renumeraVersoes = async (produtoId, subtipoProdutoId, familia, novaDataEdicao, usuarioUuid) => {
  return db.conn.tx(async t => {
    const produto = await t.oneOrNone('SELECT id FROM acervo.produto WHERE id = $1', [produtoId]);
    if (!produto) {
      throw new AppError(`Produto ${produtoId} não encontrado`, httpCode.NotFound);
    }

    const versoes = await t.any(
      `SELECT id, versao, data_edicao FROM acervo.versao
       WHERE produto_id = $1 AND subtipo_produto_id = $2`,
      [produtoId, subtipoProdutoId]
    );

    const { regex, sufixo } = familiaVersao(familia);
    const daFamilia = versoes
      .map(v => {
        const m = regex.exec(v.versao);
        return m ? { id: v.id, numero: parseInt(m[1], 10), data_edicao: v.data_edicao } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.numero - b.numero);

    // Posicao de insercao pela DATA (nunca pelo numero atual, que pode ja estar
    // errado): conta quantas versoes da familia sao mais antigas que a nova.
    const novaData = new Date(novaDataEdicao);
    let numeroNovaEdicao = 1;
    for (const v of daFamilia) {
      if (new Date(v.data_edicao) < novaData) {
        numeroNovaEdicao++;
      } else {
        break;
      }
    }

    // Desloca as que ficam na frente (numero >= numeroNovaEdicao), da MAIOR
    // pra MENOR, pra nunca colidir com unique_version_per_product em transito.
    const aDeslocar = daFamilia
      .filter(v => v.numero >= numeroNovaEdicao)
      .sort((a, b) => b.numero - a.numero);

    const data_modificacao = new Date();
    const deslocadas = [];
    for (const v of aDeslocar) {
      const rotuloNovo = `${v.numero + 1}${sufixo}`;
      await t.none(
        `UPDATE acervo.versao SET versao = $1, data_modificacao = $2, usuario_modificacao_uuid = $3 WHERE id = $4`,
        [rotuloNovo, data_modificacao, usuarioUuid, v.id]
      );
      deslocadas.push({ id: v.id, rotulo_antigo: `${v.numero}${sufixo}`, rotulo_novo: rotuloNovo });
    }

    return {
      familia,
      rotulo_livre: `${numeroNovaEdicao}${sufixo}`,
      versoes_deslocadas: deslocadas
    };
  });
};

controller.getVersaoRelacionamento = async () => {
  return db.conn.any(
    `SELECT 
      vr.id, vr.versao_id_1, vr.versao_id_2, vr.tipo_relacionamento_id, 
      vr.data_relacionamento, vr.usuario_relacionamento_uuid,
      tr.nome AS tipo_relacionamento_nome,
      v1.versao AS versao_1_nome, v1.produto_id AS produto_id_1,
      p1.nome AS produto_nome_1, p1.mi AS mi_1, p1.inom AS inom_1,
      v2.versao AS versao_2_nome, v2.produto_id AS produto_id_2,
      p2.nome AS produto_nome_2, p2.mi AS mi_2, p2.inom AS inom_2
     FROM acervo.versao_relacionamento vr
     INNER JOIN dominio.tipo_relacionamento tr ON vr.tipo_relacionamento_id = tr.code
     INNER JOIN acervo.versao v1 ON vr.versao_id_1 = v1.id
     INNER JOIN acervo.versao v2 ON vr.versao_id_2 = v2.id
     INNER JOIN acervo.produto p1 ON v1.produto_id = p1.id
     INNER JOIN acervo.produto p2 ON v2.produto_id = p2.id`
  );
};

// Função auxiliar para verificar ciclos em relacionamentos
async function verificaCicloRelacionamento(t, versaoId1, versaoId2, tipoRelacionamentoId) {
  // Implementação de busca em profundidade (DFS) para detectar ciclos
  const visitados = new Set();
  const pilha = new Set();
  
  async function dfs(versaoAtual) {
    visitados.add(versaoAtual);
    pilha.add(versaoAtual);
    
    // Buscar todos os relacionamentos onde a versão atual é origem
    const relacionamentos = await t.any(
      `SELECT versao_id_2 FROM acervo.versao_relacionamento 
       WHERE versao_id_1 = $1 AND tipo_relacionamento_id = $2`,
      [versaoAtual, tipoRelacionamentoId]
    );
    
    for (const rel of relacionamentos) {
      // BIGINT chega como string do driver — normalizar para comparar
      const vizinho = Number(rel.versao_id_2);

      // Se encontramos a versão que queremos adicionar, há um ciclo
      if (vizinho === Number(versaoId1)) {
        return true;
      }
      
      // Se o vizinho está na pilha, há um ciclo
      if (pilha.has(vizinho)) {
        return true;
      }
      
      // Se ainda não visitamos, continuar DFS
      if (!visitados.has(vizinho)) {
        const temCiclo = await dfs(vizinho);
        if (temCiclo) return true;
      }
    }
    
    pilha.delete(versaoAtual);
    return false;
  }
  
  // Começar DFS da versaoId2 (normalizado: vizinhos do DFS são Number)
  return await dfs(Number(versaoId2));
}

controller.criaVersaoRelacionamento = async (versaoRelacionamentos, usuarioUuid) => {
  return db.conn.tx(async t => {
    for (const item of versaoRelacionamentos) {
      item.usuario_relacionamento_uuid = usuarioUuid;

      // Verificar se as versões existem
      const versao1 = await t.oneOrNone(
        'SELECT id, produto_id FROM acervo.versao WHERE id = $1',
        [item.versao_id_1]
      );

      const versao2 = await t.oneOrNone(
        'SELECT id, produto_id FROM acervo.versao WHERE id = $1',
        [item.versao_id_2]
      );

      if (!versao1 || !versao2) {
        throw new AppError('Uma ou ambas as versões não foram encontradas', httpCode.NotFound);
      }

      // Verificar se o relacionamento já existe
      const relacionamentoExistente = await t.oneOrNone(
        `SELECT id FROM acervo.versao_relacionamento
         WHERE ((versao_id_1 = $1 AND versao_id_2 = $2) OR (versao_id_1 = $2 AND versao_id_2 = $1))
         AND tipo_relacionamento_id = $3`,
        [item.versao_id_1, item.versao_id_2, item.tipo_relacionamento_id]
      );

      if (relacionamentoExistente) {
        throw new AppError(`Relacionamento já existe entre as versões ${item.versao_id_1} e ${item.versao_id_2}`, httpCode.Conflict);
      }

      // Verificar auto-relacionamento
      if (item.versao_id_1 === item.versao_id_2) {
        throw new AppError('Uma versão não pode ter relacionamento consigo mesma', httpCode.BadRequest);
      }

      // Verificar ciclos para relacionamentos do tipo "Insumo" (tipo 1)
      if (item.tipo_relacionamento_id === TIPO_RELACIONAMENTO.INSUMO) {
        const temCiclo = await verificaCicloRelacionamento(
          t, item.versao_id_1, item.versao_id_2, item.tipo_relacionamento_id
        );

        if (temCiclo) {
          throw new AppError('Este relacionamento criaria um ciclo de dependências', httpCode.BadRequest);
        }
      }

      const cs = new db.pgp.helpers.ColumnSet([
        'versao_id_1', 'versao_id_2', 'tipo_relacionamento_id', 'usuario_relacionamento_uuid'
      ]);

      const query = db.pgp.helpers.insert(item, cs, {
        table: 'versao_relacionamento',
        schema: 'acervo'
      });

      await t.none(query);
    }
  });
};

controller.atualizaVersaoRelacionamento = async (versaoRelacionamentos, usuarioUuid) => {
  return db.conn.tx(async t => {
    for (const item of versaoRelacionamentos) {
      item.usuario_relacionamento_uuid = usuarioUuid;

      // Verificar se o relacionamento existe
      const relacionamentoAtual = await t.oneOrNone(
        'SELECT * FROM acervo.versao_relacionamento WHERE id = $1',
        [item.id]
      );

      if (!relacionamentoAtual) {
        throw new AppError(`Relacionamento ${item.id} não encontrado`, httpCode.NotFound);
      }

      // Se estiver mudando as versões ou tipo, fazer as mesmas validações
      // (BIGINT retorna como string no driver — comparar como número)
      if (Number(relacionamentoAtual.versao_id_1) !== Number(item.versao_id_1) ||
          Number(relacionamentoAtual.versao_id_2) !== Number(item.versao_id_2) ||
          Number(relacionamentoAtual.tipo_relacionamento_id) !== Number(item.tipo_relacionamento_id)) {

        // Verificar se as versões existem
        const versao1 = await t.oneOrNone(
          'SELECT id FROM acervo.versao WHERE id = $1',
          [item.versao_id_1]
        );

        const versao2 = await t.oneOrNone(
          'SELECT id FROM acervo.versao WHERE id = $1',
          [item.versao_id_2]
        );

        if (!versao1 || !versao2) {
          throw new AppError('Uma ou ambas as versões não foram encontradas', httpCode.NotFound);
        }

        // Verificar se o novo relacionamento já existe
        const relacionamentoExistente = await t.oneOrNone(
          `SELECT id FROM acervo.versao_relacionamento
           WHERE ((versao_id_1 = $1 AND versao_id_2 = $2) OR (versao_id_1 = $2 AND versao_id_2 = $1))
           AND tipo_relacionamento_id = $3
           AND id != $4`,
          [item.versao_id_1, item.versao_id_2, item.tipo_relacionamento_id, item.id]
        );

        if (relacionamentoExistente) {
          throw new AppError(`Relacionamento já existe entre as versões ${item.versao_id_1} e ${item.versao_id_2}`, httpCode.Conflict);
        }

        // Verificar auto-relacionamento
        if (item.versao_id_1 === item.versao_id_2) {
          throw new AppError('Uma versão não pode ter relacionamento consigo mesma', httpCode.BadRequest);
        }

        // Verificar ciclos para relacionamentos do tipo "Insumo" (tipo 1)
        if (item.tipo_relacionamento_id === TIPO_RELACIONAMENTO.INSUMO) {
          // Temporariamente remover o relacionamento atual para verificar ciclos
          await t.none('DELETE FROM acervo.versao_relacionamento WHERE id = $1', [item.id]);

          const temCiclo = await verificaCicloRelacionamento(
            t, item.versao_id_1, item.versao_id_2, item.tipo_relacionamento_id
          );

          // Restaurar o relacionamento
          await t.none(
            `INSERT INTO acervo.versao_relacionamento
             (id, versao_id_1, versao_id_2, tipo_relacionamento_id, usuario_relacionamento_uuid, data_relacionamento)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [relacionamentoAtual.id, relacionamentoAtual.versao_id_1, relacionamentoAtual.versao_id_2,
             relacionamentoAtual.tipo_relacionamento_id, relacionamentoAtual.usuario_relacionamento_uuid,
             relacionamentoAtual.data_relacionamento]
          );

          if (temCiclo) {
            throw new AppError('Este relacionamento criaria um ciclo de dependências', httpCode.BadRequest);
          }
        }
      }

      // UPDATE parametrizado simples: helpers.update com objeto único ignora
      // os aliases e gerava SQL inválido (WHERE Y.id = X.id sem FROM)
      await t.none(
        `UPDATE acervo.versao_relacionamento
         SET versao_id_1 = $2,
             versao_id_2 = $3,
             tipo_relacionamento_id = $4,
             usuario_relacionamento_uuid = $5
         WHERE id = $1`,
        [item.id, item.versao_id_1, item.versao_id_2, item.tipo_relacionamento_id, usuarioUuid]
      );
    }
  });
};

controller.deleteVersaoRelacionamento = async (versaoRelacionamentoIds, usuarioUuid) => {
  return db.conn.tx(async t => {
    const exists = await t.any(
      `SELECT id FROM acervo.versao_relacionamento
      WHERE id in ($<versaoRelacionamentoIds:csv>)`,
      { versaoRelacionamentoIds }
    );

    if (exists && exists.length < versaoRelacionamentoIds.length) {
      throw new AppError(
        'O id informado não corresponde a uma entrada do Versão Relacionamento',
        httpCode.BadRequest
      );
    }

    return t.any(
      `DELETE FROM acervo.versao_relacionamento
      WHERE id in ($<versaoRelacionamentoIds:csv>)`,
      { versaoRelacionamentoIds }
    );
  });
};

controller.criaVersaoHistorica = async (versoes, usuarioUuid) => {
  const data_cadastramento = new Date();

  const versoesPreparadas = versoes.map(versao => {
    return {
      ...versao,
      uuid_versao: versao.uuid_versao || uuidv4(),
      data_cadastramento: data_cadastramento,
      usuario_cadastramento_uuid: usuarioUuid,
      tipo_versao_id: TIPO_VERSAO.REGISTRO_HISTORICO,
    };
  });

  return db.conn.tx(async t => {
    // Espelha a UNIQUE unique_version_per_product com erro amigável
    // (duplicatas dentro do payload e contra o banco)
    const chaves = versoesPreparadas.map(v => `${v.produto_id}|${v.versao}`);
    const duplicadas = chaves.filter((c, i) => chaves.indexOf(c) !== i);
    if (duplicadas.length > 0) {
      throw new AppError(
        `A requisição contém versões duplicadas para o mesmo produto: ${[...new Set(duplicadas)].join(', ')}`,
        httpCode.BadRequest
      );
    }

    for (const v of versoesPreparadas) {
      const versaoExistente = await t.oneOrNone(
        `SELECT id FROM acervo.versao WHERE produto_id = $1 AND versao = $2`,
        [v.produto_id, v.versao]
      );
      if (versaoExistente) {
        throw new AppError(
          `Já existe a versão "${v.versao}" para o produto ${v.produto_id}`,
          httpCode.Conflict
        );
      }
    }

    const cs = new db.pgp.helpers.ColumnSet([
      'uuid_versao', 'versao', 'nome', 'produto_id', 'lote_id', 'metadado', 'descricao',
      'orgao_produtor', 'palavras_chave',
      'data_criacao', 'data_edicao', 'tipo_versao_id', 'subtipo_produto_id',
      'data_cadastramento', 'usuario_cadastramento_uuid'
    ], { table: { table: 'versao', schema: 'acervo' } });

    const query = db.pgp.helpers.insert(versoesPreparadas, cs);

    await t.none(query);
  });
};

// Cria produto e versoes SEM arquivo, numa transacao. Serve aos dois casos em
// que isso e legitimo, e o tipoVersaoId e o que os separa:
//   REGISTRO_HISTORICO: a folha existe no mundo e o acervo a registra sem ter o
//     arquivo (carga do acervo legado).
//   PLANEJADA: a folha ainda NAO existe, e o acervo a registra para o item do
//     pedido poder apontar para ela. O arquivo entra nesta MESMA versao quando a
//     producao terminar, e ai o item vira imprimivel sozinho.
// Nao ha terceiro caso: versao Regular nasce do fluxo de carregamento, com
// arquivo, e nunca por aqui.
const criaProdutoComVersoes = async (produtos, usuarioUuid, tipoVersaoId) => {
  const data_cadastramento = new Date();

  return db.conn.tx(async t => {
    const produtosIds = []

    for (const produto of produtos) {
      // Inserir o produto
      const [novoProduto] = await t.any(`
        INSERT INTO acervo.produto(nome, mi, inom, tipo_escala_id, denominador_escala_especial, tipo_produto_id, subtipo_produto_id, descricao, geom, data_cadastramento, usuario_cadastramento_uuid)
        VALUES($1, $2, $3, $4, $5, $6, $7, $8, ST_GeomFromEWKT($9), $10, $11)
        RETURNING id
      `, [produto.nome, produto.mi, produto.inom, produto.tipo_escala_id, produto.denominador_escala_especial, produto.tipo_produto_id, produto.subtipo_produto_id ?? null, produto.descricao, produto.geom, data_cadastramento, usuarioUuid]);

      produtosIds.push(novoProduto.id)

      // Preparar e inserir as versões
      const versoesPreparadas = produto.versoes.map(versao => ({
        ...versao,
        uuid_versao: versao.uuid_versao || uuidv4(),
        produto_id: novoProduto.id,
        data_cadastramento: data_cadastramento,
        usuario_cadastramento_uuid: usuarioUuid,
        tipo_versao_id: tipoVersaoId
      }));

      const cs = new db.pgp.helpers.ColumnSet([
        'uuid_versao', 'versao', 'nome', 'produto_id', 'lote_id', 'metadado', 'descricao',
        'orgao_produtor', 'palavras_chave',
        'data_criacao', 'data_edicao', 'tipo_versao_id', 'subtipo_produto_id',
        'data_cadastramento', 'usuario_cadastramento_uuid'
      ], { table: { table: 'versao', schema: 'acervo' } });

      const query = db.pgp.helpers.insert(versoesPreparadas, cs);
      await t.none(query);
    }

  });
};

controller.criaProdutoVersoesHistoricas = async (produtos, usuarioUuid) =>
  criaProdutoComVersoes(produtos, usuarioUuid, TIPO_VERSAO.REGISTRO_HISTORICO);

controller.criaProdutoVersoesPlanejadas = async (produtos, usuarioUuid) =>
  criaProdutoComVersoes(produtos, usuarioUuid, TIPO_VERSAO.PLANEJADA);

controller.bulkCreateProducts = async (produtos, usuarioUuid) => {
  const data_cadastramento = new Date();

  return db.conn.tx(async t => {
    const produtosIds = [];

    for (const produto of produtos) {
      const [novoProduto] = await t.any(`
        INSERT INTO acervo.produto(nome, mi, inom, tipo_escala_id, denominador_escala_especial, tipo_produto_id, subtipo_produto_id, descricao, geom, data_cadastramento, usuario_cadastramento_uuid)
        VALUES($1, $2, $3, $4, $5, $6, $7, $8, ST_GeomFromEWKT($9), $10, $11)
        RETURNING id
      `, [produto.nome, produto.mi, produto.inom, produto.tipo_escala_id, produto.denominador_escala_especial, produto.tipo_produto_id, produto.subtipo_produto_id ?? null, produto.descricao, produto.geom, data_cadastramento, usuarioUuid]);

      produtosIds.push(novoProduto.id);
    }

  });
};

module.exports = controller;
// Path: volume\volume_ctrl.js
"use strict";

const { db } = require("../database");

const { AppError, httpCode } = require("../utils");

const controller = {};

controller.getVolumeArmazenamento = async () => {
  return db.conn.any(
    `SELECT id, volume, nome, capacidade_gb FROM acervo.volume_armazenamento`
  )
}

controller.criaVolumeArmazenamento = async volumeArmazenamento => {
  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'nome', 'volume', 'capacidade_gb'
    ])

    const query = db.pgp.helpers.insert(volumeArmazenamento, cs, {
      table: 'volume_armazenamento',
      schema: 'acervo'
    })

    await t.none(query)
  })
}

controller.atualizaVolumeArmazenamento = async volumeArmazenamento => {
  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'id', 'nome', 'volume', 'capacidade_gb'
    ])

    const query = 
      db.pgp.helpers.update(
        volumeArmazenamento,
        cs,
        { table: 'volume_armazenamento', schema: 'acervo' },
        {
          tableAlias: 'X',
          valueAlias: 'Y'
        }
      ) + 'WHERE Y.id = X.id'

    await t.none(query)
  })
}

controller.deleteVolumeArmazenamento = async volumeArmazenamentoIds => {
  return db.conn.tx(async t => {
    // Verificar se há arquivos usando este volume
    const arquivosAssociados = await t.any(
      `SELECT COUNT(*) as count FROM acervo.arquivo
      WHERE volume_armazenamento_id in ($<volumeArmazenamentoIds:csv>)`,
      { volumeArmazenamentoIds }
    );
    
    if (parseInt(arquivosAssociados[0].count) > 0) {
      throw new AppError(
        'Não é possível deletar pois há Arquivos associados ao volume',
        httpCode.BadRequest
      );
    }
    
    const arquivosDeletadosAssociados = await t.any(
      `SELECT COUNT(*) as count FROM acervo.arquivo_deletado
      WHERE volume_armazenamento_id in ($<volumeArmazenamentoIds:csv>)`,
      { volumeArmazenamentoIds }
    );
    
    if (parseInt(arquivosDeletadosAssociados[0].count) > 0) {
      throw new AppError(
        'Não é possível deletar pois há Arquivos Deletados associados ao volume',
        httpCode.BadRequest
      );
    }
    
    // Verificar volume_tipo_produto associados
    const associated = await t.any(
      `SELECT volume_armazenamento_id FROM acervo.volume_tipo_produto
      WHERE volume_armazenamento_id in ($<volumeArmazenamentoIds:csv>)`,
      { volumeArmazenamentoIds }
    );

    if (associated.length > 0) {
      throw new AppError(
        'Não é possível deletar pois há Volume Tipo Produto associados',
        httpCode.BadRequest
      );
    }

    const exists = await t.any(
      `SELECT id FROM acervo.volume_armazenamento
      WHERE id in ($<volumeArmazenamentoIds:csv>)`,
      { volumeArmazenamentoIds }
    );

    if (exists && exists.length < volumeArmazenamentoIds.length) {
      throw new AppError(
        'O id informado não corresponde a uma entrada do volume de armazenamento',
        httpCode.BadRequest
      );
    }

    return t.any(
      `DELETE FROM acervo.volume_armazenamento
      WHERE id in ($<volumeArmazenamentoIds:csv>)`,
      { volumeArmazenamentoIds }
    );
  });
};

controller.getVolumeTipoProduto = async () => {
  return db.conn.any(
    `SELECT vtp.id, vtp.tipo_produto_id, vtp.volume_armazenamento_id, vtp.primario,
    tp.nome AS tipo_produto, va.volume AS volume, va.nome AS nome_volume, va.capacidade_gb AS volume_capacidade_gb
    FROM acervo.volume_tipo_produto AS vtp
    INNER JOIN acervo.volume_armazenamento AS va ON va.id = vtp.volume_armazenamento_id
    INNER JOIN dominio.tipo_produto AS tp ON tp.code = vtp.tipo_produto_id
    `
  )
}

controller.criaVolumeTipoProduto = async volumeTipoProduto => {
  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'tipo_produto_id', 'volume_armazenamento_id', 'primario'
    ])

    const query = db.pgp.helpers.insert(volumeTipoProduto, cs, {
      table: 'volume_tipo_produto',
      schema: 'acervo'
    })

    await t.none(query)
  })
}

controller.atualizaVolumeTipoProduto = async volumeTipoProduto => {
  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'id', 'tipo_produto_id', 'volume_armazenamento_id', 'primario'
    ])

    const query = 
      db.pgp.helpers.update(
        volumeTipoProduto,
        cs,
        { table: 'volume_tipo_produto', schema: 'acervo' },
        {
          tableAlias: 'X',
          valueAlias: 'Y'
        }
      ) + 'WHERE Y.id = X.id'

    await t.none(query)
  })
}

controller.deleteVolumeTipoProduto = async volumeTipoProdutoIds => {
  return db.conn.tx(async t => {
    // Primeiro, buscar os registros para verificar dependências
    const volumeTipos = await t.any(
      `SELECT id, tipo_produto_id, volume_armazenamento_id, primario 
       FROM acervo.volume_tipo_produto
       WHERE id in ($<volumeTipoProdutoIds:csv>)`,
      { volumeTipoProdutoIds }
    );

    if (volumeTipos.length < volumeTipoProdutoIds.length) {
      throw new AppError(
        'Um ou mais IDs informados não correspondem a entradas do Volume Tipo Produto',
        httpCode.BadRequest
      );
    }
    
    // Verificar volumes primários que possuem produtos dependentes
    const volumesPrimarios = volumeTipos
      .filter(v => v.primario)
      .map(v => ({ id: v.id, tipo_produto_id: v.tipo_produto_id }));
      
    if (volumesPrimarios.length > 0) {
      // Para cada volume primário, verificar se há produtos associados
      for (const vp of volumesPrimarios) {
        // Verificar se existe outro volume primário para este tipo de produto
        const outrosPrimarios = await t.any(
          `SELECT COUNT(*) as count FROM acervo.volume_tipo_produto
           WHERE tipo_produto_id = $1 AND primario = TRUE AND id != $2`,
          [vp.tipo_produto_id, vp.id]
        );
        
        // Se não existir outro primário, verificar se existem produtos deste tipo
        if (parseInt(outrosPrimarios[0].count) === 0) {
          const produtosAssociados = await t.any(
            `SELECT COUNT(*) as count FROM acervo.produto
             WHERE tipo_produto_id = $1`,
            [vp.tipo_produto_id]
          );
          
          if (parseInt(produtosAssociados[0].count) > 0) {
            throw new AppError(
              `Não é possível deletar o volume primário para o tipo de produto ${vp.tipo_produto_id} pois há produtos associados`,
              httpCode.BadRequest
            );
          }
        }
      }
    }

    // Se chegou aqui, podemos excluir com segurança
    return t.any(
      `DELETE FROM acervo.volume_tipo_produto
      WHERE id in ($<volumeTipoProdutoIds:csv>)`,
      { volumeTipoProdutoIds }
    );
  });
};


module.exports = controller;

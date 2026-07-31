-- O uuid_versao passa a ser CORRIGIVEL, e o item do pedido acompanha.
--
-- POR QUE. O uuid_versao e o identificador da versao no acervo, e e tambem o
-- identificador com que o produto e publicado no BDGEx. Os dois TEM de ser o
-- mesmo numero: e assim que se sai de uma linha do RTM ("carreguei tal folha,
-- id tal") e se chega a versao catalogada, sem tabela de correspondencia no
-- meio.
--
-- Quando a carga no BDGEx acontece ANTES da catalogacao (ou quando ela e
-- refeita), quem manda no numero e o BDGEx: ele ja atribuiu um identificador,
-- ja o publicou, e o acervo e que precisa se acertar. Foi o caso dos 42
-- Mosaicos Semicontrolados de Radar RADAMBRASIL (MI 495 a 550), carregados
-- errado no BDGEx Op, removidos e recarregados: o BDGEx ficou com 42
-- identificadores novos, e o SCA com os 42 que ele mesmo sorteou na carga.
--
-- O QUE IMPEDIA. A `mapoteca.produto_pedido.uuid_versao` referencia a
-- `acervo.versao (uuid_versao)` sem ON UPDATE. Trocar o identificador da versao
-- quebraria a chave estrangeira do item de pedido que aponta para ela, e por
-- isso o `produto_ctrl.atualizaVersao` recusa a troca em 400.
--
-- O QUE MUDA. A chave estrangeira ganha ON UPDATE CASCADE. O item do pedido
-- passa a seguir o identificador da versao para onde ele for. Isso NAO abre a
-- porta para trocar uuid a esmo: a regra de negocio (quem pode trocar, e com
-- que prova) continua no servidor, na rota dedicada
-- POST /api/produtos/versao/uuid, que exige administrador e confirmacao. Esta
-- migracao so retira o impedimento FISICO, que hoje transforma uma correcao
-- legitima em erro de integridade.
--
-- O DELETE segue SEM cascata, de proposito: apagar a versao NAO pode apagar o
-- historico de quem a recebeu. Quem apaga versao usa o soft-delete do acervo.

BEGIN;

ALTER TABLE mapoteca.produto_pedido
  DROP CONSTRAINT IF EXISTS produto_pedido_uuid_versao_fkey;

ALTER TABLE mapoteca.produto_pedido
  ADD CONSTRAINT produto_pedido_uuid_versao_fkey
  FOREIGN KEY (uuid_versao) REFERENCES acervo.versao (uuid_versao)
  ON UPDATE CASCADE;

COMMIT;

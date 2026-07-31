BEGIN;

-- Plano Interno de Trabalho (PIT): o plano anual da Divisão.
--
-- Dado de REFERÊNCIA, e não orçamento. A tabela nasceu em `orcamento` porque o
-- primeiro consumidor foi o PDR, mas o PIT não é artefato orçamentário: é o que
-- a Divisão se comprometeu a entregar no ano, e todo módulo tem trabalho que
-- atende uma meta dele. O orçamento amarra a NC e o item do PDR à meta que
-- financiam; a mapoteca amarra o pedido de impressão à meta que ele cumpre.
-- Nenhum dos dois é dono. Mesmo critério do schema `limites` (2026-07-29).
--
-- Enquanto morava em `orcamento`, a mapoteca não podia usá-la: em 2026-07-30 o
-- pedido ganhou um `meta_pit VARCHAR(10)` de texto livre, com o código digitado
-- à mão. Duas verdades sobre a mesma coisa, e o banco não cobrava nenhuma.
-- Mudou de casa em 2026-07-31, por decisão do chefe.
--
-- PERMISSÃO. Ler é de qualquer pessoa logada, porque todo módulo precisa
-- oferecer a lista. Escrever é do administrador global: o PIT muda uma vez por
-- ano e errar nele contamina os três módulos.

CREATE SCHEMA pit;

COMMENT ON SCHEMA pit IS
    'Plano Interno de Trabalho: o plano anual da Divisão. Dado de referência que orçamento, mapoteca e acervo consomem, e do qual nenhum é dono.';

-- Meta do ano. `numero_meta` é a meta (1 a 7 em 2026) e `item` é o sub-item
-- quando ela se subdivide ('4.1'). A meta indivisa fica com `item` NULO. O '-'
-- que aparece na tela e no CLI é como eles IMPRIMEM o nulo, não o valor gravado.
--
-- A numeração NÃO é estável entre anos: o PIT é reescrito todo ano e a Meta 4 de
-- 2026 (impressão) pode ser outra coisa em 2027. Por isso `ano` entra na chave
-- única e todo consumidor guarda o `id`, nunca o código.
CREATE TABLE pit.meta(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  numero_meta SMALLINT NOT NULL,
  item VARCHAR(20),
  descricao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (ano, numero_meta, item)
);

COMMENT ON TABLE pit.meta IS
    'Meta do PIT do ano. `item` guarda o sub-item quando a meta se subdivide (ex.: 4.1), e é NULO quando a meta é indivisa.';

CREATE INDEX idx_meta_ano ON pit.meta (ano);

COMMIT;

-- Marca de conferencia por subsecao do RPCMTec: quem olhou, quando, e o que viu.
--
-- O PROBLEMA. O RPCMTec do mes tem 34 blocos, entre calculados, digitados e de
-- texto fixo. Quem confere o documento antes de assinar percorre os 34 e nao tem
-- onde registrar que ja passou por um: a tela distingue "preenchida" de "por
-- preencher", que e outra pergunta. Subsecao calculada nasce preenchida e
-- continua precisando de olho humano, porque o numero pode estar certo e o
-- CADASTRO errado.
--
-- TABELA PROPRIA, e nao colunas em `rpcmtec.subsecao`. A revisao vale para as
-- tres origens, e a `subsecao` so tem linha para a DIGITADA: enquanto a edicao
-- esta aberta, a calculada e a fixa nao existem como registro. Guardar a marca
-- la obrigaria a criar linha vazia so para poder marca-la, e ai "existe linha"
-- deixaria de significar "alguem preencheu", que e exatamente o que o
-- fechamento cobra.
--
-- A IMPRESSAO DIGITAL E O CORACAO DISTO, e nao um detalhe de implementacao.
-- Marca de revisao sem ela diz apenas que alguem clicou um dia. A subsecao
-- digitada muda quando alguem a edita; a calculada muda SOZINHA, quando se
-- cadastra uma versao, uma capacitacao ou um pedido de impressao. Nos dois casos
-- o numero que o revisor viu deixa de ser o numero que vai para o documento
-- assinado, e nada na tela avisa. Guardando o SHA-256 do bloco no instante da
-- revisao, a tela compara com o conteudo de agora e mostra "revisada, MAS mudou
-- depois". A marca que sobrevive a mudanca do conteudo e pior que marca nenhuma,
-- porque afirma conferencia que nao houve.
--
-- MARCAR E INSERIR, DESMARCAR E APAGAR. Sem coluna booleana: a linha ausente ja
-- diz "nao revisada", e uma linha com `revisado = false` mais o carimbo de quem
-- guardaria um "nao revisado por Fulano as 14h", que nao quer dizer nada.
--
-- O FECHAMENTO AVISA E DEIXA FECHAR, decisao do chefe em 2026-08-06. Ele ja
-- RECUSA a edicao com subsecao por preencher, que e buraco de conteudo. Faltar
-- revisao e outra coisa: e julgamento de quem assina, e nao defeito do
-- documento. Entao o fechamento lista o que falta e pede confirmacao explicita.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS mais o indice condicional.

BEGIN;

CREATE TABLE IF NOT EXISTS rpcmtec.subsecao_revisao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  edicao_id BIGINT NOT NULL REFERENCES rpcmtec.edicao (id) ON DELETE CASCADE,
  numero VARCHAR(10) NOT NULL,
  impressao CHAR(64) NOT NULL,
  data_revisao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  CONSTRAINT unique_revisao_por_subsecao UNIQUE (edicao_id, numero)
);

COMMENT ON TABLE rpcmtec.subsecao_revisao IS
    'Marca de conferência de um bloco do RPCMTec: quem olhou, quando, e a impressão digital do que ele viu.';

COMMENT ON COLUMN rpcmtec.subsecao_revisao.impressao IS
    'SHA-256 do bloco montado (cabeçalhos, linhas, texto e sem ocorrência). Diferente do atual = o conteúdo mudou depois da revisão.';

CREATE INDEX IF NOT EXISTS idx_subsecao_revisao_edicao
    ON rpcmtec.subsecao_revisao (edicao_id);

UPDATE public.versao SET nome = '1.36.0' WHERE code = 1;

COMMIT;

-- Para desfazer (nenhuma marca de revisao sobrevive, e nenhum dado do relatorio
-- se perde: a tabela so guarda conferencia, nunca conteudo):
--   DROP TABLE IF EXISTS rpcmtec.subsecao_revisao;
--   UPDATE public.versao SET nome = '1.35.0' WHERE code = 1;

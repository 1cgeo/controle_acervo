-- O NUMERO DE PATRIMONIO PASSA A PODER SE DECLARAR ERRADO.
--
-- O QUE HAVIA. `equipamento.equipamento.nr_patrimonio` e NOT NULL e UNIQUE, e o
-- sistema o trata como a identidade do bem no SIAFI. Nao havia terceiro estado:
-- ou o numero estava la e valia, ou o bem nao existia.
--
-- O QUE ISSO IMPEDIA, e foi medido na carga inicial de 2026-08-10. O Relatorio
-- DMT de 2026-08-03 traz 105 bens e SO 104 numeros distintos: a linha 53 (Spectra
-- SP 60, GNSS, entrada 17/10/2023) e a linha 57 (RUIDE RTK QUASAR R93I, GNSS com
-- RTK, entrada 04/09/2024) declaram o MESMO patrimonio. Sao dois bens diferentes,
-- de tipos diferentes e de anos diferentes, e um dos dois numeros esta digitado
-- errado na planilha. Ninguem sabe qual.
--
-- Com o UNIQUE e sem esta coluna sobravam duas saidas, e as duas mentem:
--
--   * deixar o segundo bem FORA do cadastro. O sistema passaria a dizer que a
--     Divisao tem 104 bens, quando ela tem 105, e o bem de fora e justamente o
--     mais novo e mais caro dos dois;
--   * inventar um numero. O cadastro ficaria completo e o patrimonio inventado
--     seria indistinguivel de um verdadeiro em toda tela e no proprio Relatorio
--     DMT que a Divisao manda para cima.
--
-- O QUE MUDA. Nasce `patrimonio_pendente`, um booleano que diz "este numero NAO
-- foi conferido, e provavelmente esta errado". O bem entra inteiro no cadastro,
-- com um numero provisorio, e o proprio sistema carrega o aviso: o painel do
-- modulo abre uma secao que os NOMEIA, a lista marca a celula e a ficha traz a
-- tarja. O aviso morre quando alguem editar o bem, escrever o numero certo e
-- desmarcar a caixa.
--
-- POR QUE COLUNA, E NAO OBSERVACAO. `observacao` e TEXT livre. Uma frase la nao
-- se filtra, nao se conta e nao aparece em tela nenhuma sem que alguem a leia.
-- A pergunta "quantos bens tem patrimonio por conferir" precisa de resposta em
-- SQL, porque ela e a fila de trabalho de quem vai a prateleira conferir a
-- etiqueta.
--
-- POR QUE NAO SE AFROUXA O UNIQUE. O UNIQUE continua, e de proposito: dois bens
-- com o mesmo numero e exatamente o defeito que esta coluna existe para
-- denunciar, e nao para acomodar. O numero provisorio e unico como qualquer
-- outro; o que a coluna diz e que ele nao vale como identidade no SIAFI.
--
-- DEFAULT FALSE porque o caso normal e o numero conferido, e NOT NULL porque a
-- pergunta ("este numero esta por conferir?") nao tem terceiro estado. Um NULL
-- aqui seria "nao sei se sei", que nao e informacao.
--
-- Esta migracao NAO marca bem nenhum. Ela cria a coluna; quem a preenche e a
-- carga inicial ou a tela de edicao.

BEGIN;

ALTER TABLE equipamento.equipamento
  ADD COLUMN IF NOT EXISTS patrimonio_pendente BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN equipamento.equipamento.patrimonio_pendente IS
    'VERDADEIRO quando o número de patrimônio ainda não foi conferido contra a etiqueta do bem e provavelmente está errado. O bem existe e conta no acervo; só a identidade dele no SIAFI é que está em aberto.';

-- O indice e PARCIAL: ele indexa so as linhas marcadas, que sao a excecao (uma
-- em 105 na carga inicial). Um indice cheio sobre uma coluna de 105 linhas com
-- 104 valores iguais nao seria usado pelo planejador e ainda custaria escrita a
-- cada cadastro.
CREATE INDEX IF NOT EXISTS idx_equipamento_patrimonio_pendente
  ON equipamento.equipamento (id)
  WHERE patrimonio_pendente;

UPDATE public.versao SET nome = '3.1.0' WHERE code = 1;

COMMIT;

-- Para desfazer:
--
--   BEGIN;
--   DROP INDEX IF EXISTS equipamento.idx_equipamento_patrimonio_pendente;
--   ALTER TABLE equipamento.equipamento DROP COLUMN IF EXISTS patrimonio_pendente;
--   UPDATE public.versao SET nome = '3.0.0' WHERE code = 1;
--   COMMIT;
--
-- O DESFAZER PERDE O AVISO, e nao o bem. As linhas continuam todas la, com o
-- numero provisorio que a carga escreveu, e nada mais distingue esse numero de
-- um verdadeiro: a tela para de marcar a celula, o painel para de listar e o
-- Relatorio DMT sai com o provisorio como se fosse patrimonio. Antes de desfazer,
-- anote quais bens estavam marcados:
--
--   SELECT id, nr_patrimonio, modelo FROM equipamento.equipamento
--    WHERE patrimonio_pendente;
--
-- O DESFAZER EXIGE VOLTAR O CODIGO JUNTO: `VERSION` e `MIN_DATABASE_VERSION` de
-- server/src/config.js, o INSERT de er/versao.sql e a coluna em er/equipamento.sql
-- voltam ao estado anterior. Sem isso, a proxima instalacao nova nasce com a
-- coluna que este desfazer acabou de tirar, e o serviço recusa subir contra o
-- banco desfeito.

BEGIN;

-- Rastreabilidade de TODA alteração feita por pessoa, nos três módulos.
--
-- O QUE ELA NÃO É. Não é `#/acervo/auditoria` (que mede os invariantes do
-- acervo HOJE e não diz quem produziu a incoerência), não é `dgeo.login` (que
-- registra quem ENTROU no sistema) e não é o log do winston (que guarda o corpo
-- da requisição por 14 dias, sem usuário e sem estado anterior).
--
-- POR QUE NÃO É GATILHO. O gatilho não conhece o usuário da sessão HTTP: o
-- Postgres vê a conexão do
-- pool, e a saída seria um SET LOCAL em toda transação do servidor. No backend o
-- usuarioUuid já chega em cada função de controller. O preço dessa escolha é a
-- rota nova que esquece de auditar, e quem cobra o preço é um teste de varredura
-- por módulo, que lê o router de verdade.
--
-- POR QUE UMA TABELA SÓ, E NÃO UMA POR MÓDULO. A pergunta que originou este
-- trabalho ("o que o usuário X fez", "o que mudou ontem") não é de módulo
-- nenhum. Com quatro tabelas ela vira UNION ALL de quatro consultas que
-- precisariam ficar em sincronia para sempre.
--
-- Substitui `mapoteca.pedido_auditoria`, cujo `pedido_id NOT NULL`
-- amarrava o histórico ao pedido: cliente, plotter, produto do acervo, nota de
-- empenho e usuário não têm pedido nenhum.
CREATE SCHEMA auditoria;

CREATE TABLE auditoria.evento(
    id BIGSERIAL NOT NULL PRIMARY KEY,

    -- ONDE PROCURAR --------------------------------------------------------
    -- `modulo` casa com dominio.modulo.nome_abrev ('acervo', 'mapoteca',
    -- 'orcamento') e admite 'plataforma' para o que não é de módulo nenhum
    -- (usuário, perfil, PIT, RPCMTec).
    --
    -- NÃO é chave estrangeira para dominio.modulo de propósito: 'plataforma'
    -- não é módulo de AUTORIZAÇÃO, e transformá-lo em linha daquela tabela
    -- criaria um módulo em que ninguém pode ter perfil, que é justamente o que
    -- o modelo de autorização não tem.
    modulo VARCHAR(20) NOT NULL,

    -- O agregado DONO do evento, que é o que torna o histórico legível: o item
    -- e a impressão pertencem ao pedido, o arquivo pertence ao produto, a
    -- liquidação pertence à nota de empenho. A regra para escolher: é a ficha
    -- que a pessoa abre na tela. Ninguém abre "arquivo n.º 4812"; abre a ficha
    -- do produto e olha os arquivos dele.
    entidade VARCHAR(50) NOT NULL,

    -- TEXTO porque o sistema identifica registro de três formas: o acervo usa
    -- `id` BIGINT para produto e `uuid` para versão, o orçamento usa BIGINT,
    -- `dominio.natureza_despesa` usa `code` VARCHAR e o usuário usa UUID. Uma
    -- coluna por tipo seriam três colunas com duas nulas em toda linha, e a
    -- consulta da tela teria de saber qual olhar.
    entidade_id VARCHAR(64) NOT NULL,

    -- O QUE MUDOU ----------------------------------------------------------
    -- `schema.tabela`, sempre qualificado e sem apelido: é a chave do mapa de
    -- entidades do servidor, e 'arquivo' sozinho é ambíguo entre acervo,
    -- orcamento e ponto_controle.
    tabela VARCHAR(80) NOT NULL,
    registro_id VARCHAR(64),
    operacao CHAR(1) NOT NULL CHECK (operacao IN ('I','U','D')),

    -- A linha ANTES e DEPOIS, as duas lidas do BANCO e nunca do corpo da
    -- requisição: o corpo traz o que o cliente PEDIU, e o que interessa é o que
    -- o banco GRAVOU. `dados_antes` é nulo na inserção e `dados_depois` é nulo
    -- na exclusão, por definição.
    --
    -- O que NUNCA entra aqui, e é o mapa de entidades que faz cumprir:
    -- `dgeo.usuario.senha` (o hash bcrypt; a troca de senha vira evento com os
    -- dois lados nulos), as colunas BYTEA de conteúdo de anexo, e geometria
    -- acima do teto por valor.
    dados_antes JSONB,
    dados_depois JSONB,

    -- CALCULADO pelo servidor, nunca uma lista digitada a mão: lista escrita a
    -- mão envelhece na primeira coluna nova e passa a mentir em silêncio. As
    -- colunas de escrituração (usuario_atualizacao_id, data_atualizacao,
    -- usuario_modificacao_uuid, data_modificacao) ficam FORA daqui, embora
    -- continuem nos dois JSONs: elas mudam em todo UPDATE, e se entrassem, toda
    -- linha do histórico traria as duas e o campo que a pessoa realmente mudou
    -- se perderia no meio.
    campos_alterados TEXT[],

    -- QUEM E QUANDO --------------------------------------------------------
    -- SEM chave estrangeira para dgeo.usuario, de propósito. Quem já trabalhou
    -- no sistema se DESATIVA em vez de se apagar, mas a rota de exclusão existe
    -- para o cadastro errado de cinco minutos atrás, e o rastro do que essa
    -- pessoa fez não pode cair junto com ela. É a mesma razão pela qual
    -- `entidade_id` não referencia nada: a exclusão é justamente o evento que
    -- esta tabela existe para guardar.
    --
    -- Nulo só para evento de migração e para o que o sistema faz sozinho (cron
    -- de limpeza, fila de miniatura). Toda mudança vinda de rota grava o
    -- usuário do token.
    usuario_uuid UUID,
    data_evento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- DE ONDE VEIO ---------------------------------------------------------
    -- O SCA tem quatro portas de escrita, e "quem mudou" muda de resposta
    -- conforme a porta. 'web' e 'qgis' saem do `cliente` do token (que passou a
    -- ser assinado no JWT justamente para isto); 'cli' vem dos
    -- CLIs; 'gatilho' é efeito de gatilho de banco capturado pelo backend (o
    -- estoque da mapoteca); 'sistema' é o que roda sem pessoa por trás;
    -- 'migracao' é carga histórica; 'desconhecido' é token emitido antes de o
    -- campo existir, e some sozinho quando o token expira.
    origem VARCHAR(20) NOT NULL DEFAULT 'web',
    rota VARCHAR(160),

    -- Agrupa a operação em MASSA. Uma passada de renome padrão toca até 5.000
    -- arquivos, e o evento é por ARQUIVO (é a informação de que se precisa para
    -- conferir ou desfazer), então sem isto a tela viraria 5.000 linhas iguais e
    -- empurraria o resto do dia para a página 200. Com ele, a tela mostra UMA
    -- linha que abre.
    lote_id UUID,

    -- POR QUE --------------------------------------------------------------
    -- Nulo na maioria das rotas, porque a maioria não pergunta. Onde a rota JÁ
    -- pergunta, o valor vem dela: DELETE /arquivo/arquivo, /produtos/produto e
    -- /produtos/versao cobram `motivo_exclusao`, e ele hoje só chega a
    -- `acervo.arquivo_deletado`. Sem esta coluna, o motivo continuaria existindo
    -- para o arquivo e desaparecendo para o produto e para a versão.
    motivo TEXT
);

-- O histórico de UMA ficha: é a consulta da seção de histórico de cada tela.
CREATE INDEX idx_evento_entidade
    ON auditoria.evento(modulo, entidade, entidade_id, data_evento DESC);

-- "O que a pessoa X fez", que é a pergunta que originou este trabalho.
CREATE INDEX idx_evento_usuario
    ON auditoria.evento(usuario_uuid, data_evento DESC);

-- O recorte por período, que é o filtro mais usado da tela de rastreabilidade e
-- o que segura o custo da consulta.
CREATE INDEX idx_evento_data ON auditoria.evento(data_evento DESC);

-- Parcial de propósito: a maioria esmagadora dos eventos não é de lote, e um
-- índice cheio de nulos custaria escrita em toda inserção sem servir a ninguém.
CREATE INDEX idx_evento_lote ON auditoria.evento(lote_id) WHERE lote_id IS NOT NULL;

-- SEM EXPURGO AUTOMÁTICO, e é deliberado.
--
-- A rotação do winston apaga sozinha porque o log perde valor com o tempo.
-- Aqui é o contrário. O rastro é procurado justamente quando alguém pergunta
-- sobre uma mudança antiga, e um expurgo automático falharia exatamente
-- quando é necessário.
--
-- A tabela também NÃO nasce particionada. Se o crescimento pedir, o
-- particionamento por ano de `data_evento` não muda o contrato de escrita nem o
-- de leitura, mas custa migração de dados. Estimativa com o uso atual: dezenas
-- de milhares de eventos por ano no movimento normal dos três módulos, fora as
-- cargas em lote do acervo legado.
--
-- PENDENTE DE CONFIRMAÇÃO DA CHEFIA: se um teto de retenção for decidido, ele
-- precisa ser um procedimento do dono do banco (o usuário da aplicação não tem
-- DELETE aqui, e isso é a garantia), e precisa ser decidido ANTES de a tabela
-- crescer: particionar por ano depois custa migração de dados.

COMMIT;

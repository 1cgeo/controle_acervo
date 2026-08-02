# Tabela MI x INOM do Sistema Cartográfico Nacional

**Estes dados NÃO estão sob a licença MIT do resto deste repositório.** Eles são
portados do DSGTools e permanecem sob a **GPL-2.0** de origem, cujo texto integral
está em [`LICENSE-DSGTOOLS`](./LICENSE-DSGTOOLS), ao lado.

## Origem exata

| Aqui | Arquivo original |
|---|---|
| `mi_100k.csv` | `MI100.csv` |
| `mi_250k.csv` | `MIR250.csv` |
| `sem_mi_25k.csv` | `exclusionList25k.csv` |
| `sem_mi_50k.csv` | `exclusionList50k.csv` |

- Repositório: <https://github.com/dsgoficial/DsgTools>
- Caminho: `DsgTools/core/Utils/FrameTools/`
- Baixados em 2026-08-01.

Autoria: **(C) 2014 Luiz Andrade, Cartographic Engineer @ Brazilian Army**.
Licença: **GNU General Public License, versão 2**.

O DSGTools e o SCA são as duas obras da mesma casa (DSG / Exército Brasileiro),
e é isso que torna o porte uma decisão INTERNA, e não uso de obra de terceiro.
A GPL-2.0 continua valendo para o conteúdo desta pasta: quem redistribuir estes
quatro arquivos redistribui obra GPL, e o `LICENSE-DSGTOOLS` tem de acompanhar.

> **Pendência, e ela é do chefe.** O porte foi decidido no desenvolvimento, em
> 2026-08-01. Este repositório é **público e MIT**, então quem o lê vê MIT e
> encontra aqui dentro uma pasta GPL-2.0. Isso é o padrão de dependência
> vendorizada e está declarado, mas a decisão de publicar assim é da chefia, e
> não foi tomada por ela até esta data. Confirme antes do próximo `push` público.

Os arquivos foram renomeados e **nada mais**. O conteúdo é byte a byte o do
repositório de origem, inclusive o BOM que abre as duas listas de exclusão e o
cabeçalho de cada CSV. Não há linha de atribuição dentro dos CSV de propósito:
acrescentá-la faria o `diff` contra a fonte acusar diferença, e é justamente esse
`diff` que prova que os dados não foram alterados. A atribuição mora aqui, neste
arquivo, que viaja junto.

## Por que uma TABELA, e não uma conta

O INOM é composicional: `SF-22-Y-D-II-4-NE` descreve a folha por construção, e
`server/src/utils/scn.js` tira dele o polígono por aritmética pura, sem consultar
coisa nenhuma.

O **MI não tem fórmula**. Ele é a numeração histórica do antigo Mapa Índice,
atribuída folha a folha, e a única regra que obedece é a de ter sido publicada.
Duas consequências, e as duas exigem dados:

1. **Folha fora do território brasileiro não tem MI.** O Mapa Índice cobre o
   Brasil; o SCN cobre o mundo. `SF-32-Y-D` é um INOM perfeitamente válido (fica
   na costa da África) e simplesmente não tem MI. Sem a tabela, qualquer conta
   inventaria um número para ela.
2. **Há folha DENTRO da cobertura que nunca recebeu MI.** São as duas listas de
   exclusão: 428 quadrantes de 1:50.000 e 856 folhas de 1:25.000, quase todas em
   faixa de fronteira, onde só parte do recorte foi numerada. Elas são
   **complementares**, e não aninhadas: a lista de 1:25.000 traz folha cujo
   quadrante de 1:50.000 TEM MI, e a interseção entre as duas é vazia. Quem
   consultasse só uma delas devolveria MI inventado para o resto.

De 1:100.000 para baixo o MI é composicional (`2757` → `2757-4` → `2757-4-NE`),
então só o número da folha de 1:100.000 precisa de tabela. De 1:250.000 para cima
não: `mi_250k.csv` é uma numeração independente (o MIR), e 1:500.000 e
1:1.000.000 não recebem MI nenhum.

## Formato

`mi_100k.csv` e `mi_250k.csv`: `inom;mi`, com cabeçalho.
`sem_mi_25k.csv` e `sem_mi_50k.csv`: uma coluna `inom`, com cabeçalho e BOM.

O MI vem preenchido com zero à esquerda (`0001`, `001`). O SCA grava o MI **sem**
o preenchimento (`acervo.produto.mi` = `2965`, cobrado pelo invariante `1i`), e
por isso `scn.js` normaliza tudo por `utils/mi.js` na carga. O efeito colateral
disso está documentado em `inomDoMi`: sem o zero à esquerda, 549 dos 563 MIs de
1:250.000 colidem com um MI de 1:100.000, e desempatar exige dizer a escala.

## Quem lê

Só `server/src/utils/scn.js`, uma vez por processo, de forma preguiçosa.

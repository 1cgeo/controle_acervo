import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { createTabs } from '@components/tabs/tabs.js';
import { chip } from '@components/status-chip.js';
import { criarHistorico } from '@components/historico/historico.js';
import { isAdmin } from '@store/auth-store.js';
import { getCampo } from '@services/campo-service.js';
import { criarGaleriaCampo } from './campo-midia.js';
import { criarTrajetosCampo } from './campo-trajetos.js';
import './campo.css';

const dia = (valor) => (valor
  ? String(valor).slice(0, 10).split('-').reverse().join('/')
  : '-');

/** campo.situacao, para a cor do chip. */
const VARIANTE = { 1: 'info', 2: 'warning', 3: 'success', 4: 'error' };

/**
 * A ficha de um campo: o cabeçalho, as fotos e vídeos, e os trajetos.
 *
 * SOMENTE LEITURA, por decisão do chefe em 2026-08-09. Abrir a ficha é VER, e
 * TUDO o que muda o campo -- inclusive acrescentar e remover foto, vídeo e
 * trajeto -- mora em "Editar o campo". Até essa data a ficha tinha botão de
 * enviar e de remover, e a pessoa mudava o cadastro sem nunca ter dito que ia
 * editar; a foto apagada por engano ali não tinha de onde voltar.
 *
 * O ÚNICO BOTÃO QUE LEVA A ESCREVER É "Editar", e ele FECHA a ficha e abre o
 * formulário: dois modais empilhados esconderiam qual dos dois está gravando.
 *
 * TUDO NUMA TELA SÓ, em abas. No SAP isto eram duas rotas (uma de mapa, outra de
 * gestão com quatro abas), e a decisão do chefe em 2026-08-08 foi UMA página.
 *
 * AS CARGAS SÃO INDEPENDENTES, cada uma com o próprio `catch`. Um `Promise.all`
 * aqui faria a ficha inteira morrer com a mensagem de quem falhasse: um campo
 * sem trajeto não pode derrubar as fotos, e a falha ao ler 186 MB de imagem não
 * pode esconder o cabeçalho.
 *
 * @param {Object} options
 * @param {number} options.id
 * @param {boolean} [options.podeEditar] - operador ou acima no PIT
 * @param {Function} [options.onEditar]
 * @param {(alvo:{campoId:number, track:Object})=>void}
 *        [options.onVerTrajetoNoMapa] - o botão "Ver no mapa" da aba Trajetos
 */
export function abrirDetalheCampo({
  id, podeEditar = false, onEditar = null, onVerTrajetoNoMapa = null,
} = {}) {
  // O que precisa ser desmontado ao fechar, e que só existe depois da carga.
  const aoFechar = [];

  const corpo = el('div', { className: 'campo-detalhe' }, [
    el('p', { className: 'campo-detalhe__carregando', textContent: 'Carregando a ficha...' }),
  ]);

  const modal = openModal({
    title: 'Atividade de campo',
    content: corpo,
    width: '860px',
    onClose: () => {
      for (const desmontar of aoFechar) desmontar();
    },
    actions: [
      { label: 'Fechar', variant: 'text', onClick: ({ close }) => close() },
    ],
  });

  const montarFicha = (campo) => {
    // O NÓ VAI COMO FILHO, e nunca no lugar dos atributos. O segundo argumento
    // de `el()` são os ATRIBUTOS, e uma lista ali vira `{'0': nó}`: o
    // `setAttribute('0', ...)` que sai disso lança InvalidCharacterError, no
    // navegador igual ao jsdom. Como a montagem da aba é uma promessa solta
    // dentro de `createTabs`, o erro caía como rejeição não tratada e a aba
    // Ficha nascia VAZIA, sem mensagem nenhuma -- quem a abria via um cabeçalho
    // e um painel em branco. A linha da Situação é a única que passa um nó (o
    // chip), e por isso era a única que quebrava. Pego em 2026-08-13, pelo
    // primeiro teste que montou esta tela.
    const linha = (rotulo, valor) => el('div', { className: 'campo-detalhe__linha' }, [
      el('dt', { textContent: rotulo }),
      valor instanceof Node
        ? el('dd', {}, [valor])
        : el('dd', { textContent: valor ?? '-' }),
    ]);

    // O EFETIVO SÃO AS DUAS LISTAS JUNTAS, como na subseção 2.5: o cadastro
    // (`campo_militar`) e o texto de quem não tem conta.
    const doCadastro = (campo.militares || [])
      .map(m => `${m.posto_abrev} ${m.nome_guerra}`.trim());
    const externos = (campo.militares_externos || '').trim();
    const efetivo = [doCadastro.join(', '), externos].filter(Boolean).join(', ') || '-';

    const versoes = (campo.versoes || []).length
      ? (campo.versoes || []).map(v => `${v.mi || v.inom || 's/ MI'} (v${v.versao})`).join(', ')
      // A AUSÊNCIA É O CASO COMUM, e a frase diz isso em vez de deixar um traço
      // que se leria como "faltou preencher": viagem internacional e exercício
      // não geram produto a apontar.
      : 'Nenhuma. Nem todo campo atende produto.';

    return el('dl', { className: 'campo-detalhe__ficha' }, [
      linha('Situação', chip(campo.situacao, VARIANTE[campo.situacao_id] || 'default')),
      linha('Ano do PIT', String(campo.ano)),
      linha('Período', `${dia(campo.data_inicio)} a ${dia(campo.data_fim)}`),
      linha('Finalidade', (campo.categorias || []).map(c => c.nome).join(', ') || '-'),
      linha('Efetivo', efetivo),
      linha('Placas de viatura', campo.placas_vtr),
      linha('Versões atendidas', versoes),
      linha('Descrição', campo.descricao),
    ]);
  };

  getCampo(id).then((campo) => {
    clearChildren(corpo);

    const cabecalho = el('div', { className: 'campo-detalhe__cabecalho' }, [
      el('h3', { textContent: campo.nome }),
      el('div', { className: 'campo-detalhe__botoes' }, [
        podeEditar && onEditar
          ? el('button', {
            className: 'btn btn--secondary btn--sm',
            type: 'button',
            onClick: () => { modal.close(); onEditar(campo); },
          }, [svgIcon(ICONS.edit, 16), 'Editar'])
          : null,
      ].filter(Boolean)),
    ]);

    // O HISTÓRICO É UMA ABA, e não um bloco no fim da ficha: ele carrega uma
    // segunda vez do servidor, e pendurá-lo na ficha faria toda abertura pagar
    // por ele.
    //
    // SÓ PARA ADMINISTRADOR: a rota do histórico de 'plataforma' é
    // `verifyAdmin`, e esta tela abre para quem tem consulta no PIT. Aba
    // que entrega 403 ao ser clicada é pior que aba nenhuma. É a mesma guarda
    // que a ficha da capacitação já usa.
    //
    // UMA ABA PARA AS SEIS TABELAS. As finalidades, os militares, as versões, as
    // fotos e os trajetos são auditados SOB O CAMPO, com o `entidade_id` dele.
    const abas = createTabs({
      tabs: [
        { id: 'ficha', label: 'Ficha', render: (c) => { c.appendChild(montarFicha(campo)); } },
        {
          id: 'imagens',
          label: `Fotos e vídeos (${campo.total_imagens ?? 0})`,
          render: (c) => {
            const galeria = criarGaleriaCampo({ campoId: campo.id, podeEditar: false });
            c.appendChild(galeria.element);
            galeria.recarregar();
            return { cleanup: () => galeria.cleanup() };
          },
        },
        {
          id: 'tracks',
          label: `Trajetos (${campo.total_tracks ?? 0})`,
          render: (c) => {
            const trajetos = criarTrajetosCampo({
              campoId: campo.id,
              podeEditar: false,
              // A FICHA FECHA ANTES DE O MAPA DESENHAR. O mapa é uma aba da
              // página que está ATRÁS deste modal: deixá-lo aberto esconderia
              // exatamente o que a pessoa acabou de pedir para ver.
              aoVerNoMapa: onVerTrajetoNoMapa
                ? (alvo) => { modal.close(); onVerTrajetoNoMapa(alvo); }
                : null,
            });
            c.appendChild(trajetos.element);
            trajetos.recarregar();
            return { cleanup: () => trajetos.cleanup() };
          },
        },
        ...(isAdmin() ? [{
          id: 'historico',
          label: 'Histórico',
          render: (c) => {
            const painel = criarHistorico({
              modulo: 'plataforma',
              entidade: 'campo',
              id: campo.id,
              titulo: 'Histórico do campo',
              subtitulo: 'O cadastro, o efetivo, as fotos e os trajetos',
            });
            c.appendChild(painel.element);
            // `cleanup`, e NÃO `_cleanup`: `criarHistorico` devolve o primeiro,
            // e `_cleanup` é o nome que o data-table e as abas usam. Chamar o
            // errado dava "$._cleanup is not a function" ao SAIR desta aba,
            // longe do clique que a abriu.
            return { cleanup: () => painel.cleanup() };
          },
        }] : []),
      ],
    });

    corpo.append(cabecalho, abas.element);
    // As abas montam conteúdo sob demanda e guardam o cleanup da ativa; sem
    // esta linha a galeria ficaria com os blobs vivos depois de o modal fechar.
    aoFechar.push(() => abas._cleanup());
  }).catch((err) => {
    clearChildren(corpo);
    corpo.appendChild(el('p', {
      className: 'campo-detalhe__erro',
      textContent: err.message || 'Não foi possível carregar a ficha do campo.',
    }));
  });

  return modal;
}

import { el, clearChildren } from '@utils/dom.js';
import {
  createTextField,
  createSelectField,
} from '@components/form-fields/form-fields.js';
import { criarHistorico } from '@components/historico/historico.js';
import { showSuccess, showError } from '@utils/toast.js';
import { estadoErro } from '@components/estado-erro.js';
import {
  getInstituicao,
  atualizarInstituicao,
  enviarSimboloInstituicao,
  removerSimboloInstituicao,
  urlSimboloInstituicao,
  getUnidadesGestoras,
} from '@services/plataforma-service.js';
import { sincronizarSessao } from '@services/api-client.js';
import './instituicao.css';

/**
 * A INSTITUIÇÃO QUE OPERA ESTA INSTALAÇÃO (#/instituicao), do administrador.
 *
 * É a tela que tira o "1º CGEO" de dentro do código. Até 2026-08-09 o nome do
 * Centro estava escrito em cabeçalho de relatório, em nome de arquivo e -- o
 * pior -- numa COLUNA (`limites.area_suprimento.e_1cgeo`), e nenhum outro CGEO
 * conseguiria instalar o SAP sem editar DDL. Agora os três valores moram em
 * `dgeo.instituicao`, e mudam por aqui.
 *
 * O QUE ELA MOVE, e por isso o aviso na tela: o cabeçalho e o rodapé do RPCMTec,
 * o nome do arquivo do Anuário Estatístico, o `orgao_produtor` que o formulário
 * de versão sugere, o REMETENTE da etiqueta de envio da Mapoteca, e o FILTRO da
 * área de suprimento na subseção 2.7. Esse último é o que merece cuidado, e está
 * explicado abaixo.
 *
 * OS TRÊS DO CLIENT SAEM DA SESSÃO, e não desta rota: `nome` e `sigla` viajam no
 * login e ficam em `@store/auth-store.js`, porque a tela que os DESENHA não pode
 * gastar uma chamada por desenho. Por isso o salvamento reconfere a sessão logo
 * abaixo.
 *
 * UMA LINHA SÓ, e o banco garante (`CHECK (id = 1)`). Por isso a tela é um
 * formulário, e não uma lista com "novo": não há uma segunda instituição a
 * cadastrar, e um botão de novo prometeria o que o CHECK recusa.
 *
 * O HISTÓRICO FICA NO RODAPÉ, recolhido, como na ficha do usuário: quem abre
 * esta tela quer conferir ou corrigir o nome, e não auditar. Ele existe porque a
 * escrita é auditada, e sem painel o evento sairia como texto morto na
 * varredura.
 */
export function renderInstituicao(container) {
  clearChildren(container);

  const corpo = el('div', { className: 'instituicao' }, [
    el('p', { className: 'instituicao__carregando', textContent: 'Carregando...' }),
  ]);
  container.appendChild(corpo);

  const montar = (dados, unidades) => {
    clearChildren(corpo);

    const nome = createTextField({
      label: 'Nome por extenso',
      value: dados.nome || '',
      required: true,
      helpText:
        'Como o Centro se chama no relatório e no metadado. É este texto, ' +
        'caractere por caractere, que identifica a área de suprimento.',
    });

    const sigla = createTextField({
      label: 'Sigla',
      value: dados.sigla || '',
      required: true,
      helpText: 'Como o Centro aparece em cabeçalho e em nome de arquivo.',
    });

    // A UG É OPCIONAL, e a opção vazia existe de propósito: nem toda instalação
    // usa o módulo orçamento, e exigir a Unidade Gestora de quem nunca vai
    // lançar nota de crédito obrigaria a inventar um número.
    const ug = createSelectField({
      label: 'Unidade Gestora',
      value: dados.ug_code || '',
      options: [
        { value: '', label: 'Sem Unidade Gestora' },
        ...(unidades || []).map(u => ({
          value: String(u.code),
          label: `${u.code} - ${u.nome}`,
        })),
      ],
      helpText: 'Usada pelo módulo orçamento. Deixe vazia se ele não for usado.',
    });

    // O AVISO SOBRE A ÁREA DE SUPRIMENTO, e ele não é decoração.
    //
    // A subseção 2.7 do RPCMTec mede a cobertura do acervo sobre a Área Sob
    // Coordenação, e acha "a nossa área" comparando `limites.area_suprimento.
    // cgeo` com o NOME daqui, por igualdade exata. Um acento trocado ou um `º`
    // virando `o` faz a comparação não casar.
    //
    // O servidor NÃO responde zero nesse caso: ele FALHA, dizendo o nome que
    // procurou. É deliberado, e a razão está em `docs/decisoes.md` -- área zero
    // num relatório assinado é pior que erro na tela. O aviso existe para quem
    // edita saber disso ANTES de salvar, e não pelo relatório quebrado.
    const aviso = el('div', { className: 'instituicao__aviso' }, [
      el('strong', { textContent: 'O nome tem de casar com a área de suprimento.' }),
      el('p', {
        textContent:
          'A subseção 2.7 do RPCMTec identifica a Área Sob Coordenação deste ' +
          'Centro comparando este nome, por igualdade exata, com o que está ' +
          'cadastrado em limites.area_suprimento. Se os dois textos diferirem ' +
          'em um acento que seja, o relatório não é gerado, e a mensagem diz ' +
          'qual nome foi procurado.',
      }),
    ]);

    // O SIMBOLO, e ele NAO faz parte do `submit` do formulario.
    //
    // Arquivo sobe por multipart e o resto do formulario vai por JSON: juntar
    // os dois obrigaria a mandar a imagem de novo a cada vez que alguem corrige
    // uma letra do nome. Aqui o envio e imediato, no proprio seletor, e o botao
    // Salvar continua respondendo so por nome, sigla e UG.
    const simboloPrevia = el('img', {
      className: 'instituicao__simbolo',
      alt: 'Símbolo da instituição',
    });
    const simboloVazio = el('p', {
      className: 'instituicao__simbolo-vazio',
      textContent: 'Nenhum símbolo enviado.',
    });

    const pintarSimbolo = (temSimbolo, versao) => {
      simboloPrevia.classList.toggle('hidden', !temSimbolo);
      simboloVazio.classList.toggle('hidden', !!temSimbolo);
      remover.classList.toggle('hidden', !temSimbolo);
      if (temSimbolo) simboloPrevia.src = urlSimboloInstituicao(versao);
    };

    const entrada = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp,image/gif',
      className: 'instituicao__simbolo-entrada',
    });

    const remover = el('button', {
      className: 'btn btn--secondary',
      type: 'button',
      textContent: 'Remover símbolo',
    });

    entrada.addEventListener('change', async () => {
      const arquivo = entrada.files && entrada.files[0];
      if (!arquivo) return;
      try {
        const r = await enviarSimboloInstituicao(arquivo);
        // A previa recarrega pela data de envio que o servidor devolveu: sem
        // trocar a URL o navegador serviria a imagem antiga do proprio cache,
        // e quem acabou de subir veria o brasao velho e acharia que falhou.
        pintarSimbolo(true, (r && r.dados && r.dados.simbolo_data_envio) || Date.now());
        showSuccess('Símbolo atualizado.');
      } catch (e) {
        showError(e.message || 'Não foi possível enviar a imagem.');
      } finally {
        entrada.value = '';
      }
    });

    remover.addEventListener('click', async () => {
      try {
        await removerSimboloInstituicao();
        pintarSimbolo(false);
        showSuccess('Símbolo removido.');
      } catch (e) {
        showError(e.message || 'Não foi possível remover a imagem.');
      }
    });

    const simbolo = el('div', { className: 'instituicao__simbolo-campo' }, [
      el('label', { className: 'form-field__label', textContent: 'Símbolo' }),
      el('p', {
        className: 'form-field__help',
        textContent: 'O brasão desta OM. APARECE NA TELA PÚBLICA de '
          + 'acompanhamento de pedido, junto do nome. PNG, JPEG, WEBP ou GIF, '
          + 'até 2 MB. Fundo transparente fica melhor.',
      }),
      el('div', { className: 'instituicao__simbolo-linha' }, [
        simboloPrevia, simboloVazio,
        el('div', { className: 'instituicao__simbolo-acoes' }, [entrada, remover]),
      ]),
    ]);
    pintarSimbolo(!!dados.tem_simbolo, dados.simbolo_data_envio);

    const salvar = el('button', {
      className: 'btn btn--primary',
      type: 'submit',
      textContent: 'Salvar',
    });

    const form = el('form', { className: 'instituicao__form' }, [
      nome.element,
      sigla.element,
      ug.element,
      simbolo,
      aviso,
      el('div', { className: 'instituicao__acoes' }, [salvar]),
    ]);

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!nome.getValue().trim() || !sigla.getValue().trim()) {
        showError('Nome e sigla são obrigatórios.');
        return;
      }
      salvar.disabled = true;
      try {
        await atualizarInstituicao({
          nome: nome.getValue().trim(),
          sigla: sigla.getValue().trim(),
          // VAZIO VIRA `null`, e não string vazia: o Joi da rota aceita os dois,
          // mas a coluna é anulável e `''` viraria uma UG que não existe em
          // `dominio.ug`, recusada pela chave estrangeira com uma mensagem que
          // não diz que o problema é o campo vazio.
          ug_code: ug.getValue() || null,
        });
        showSuccess('Instituição atualizada.');
        // A SESSÃO TAMBÉM GUARDA O NOME E A SIGLA, desde 2026-08-09: é deles
        // que saem o remetente da etiqueta de envio e o `orgao_produtor` que o
        // cadastro de versão sugere. Sem reconferir aqui, quem acabou de
        // corrigir o nome imprimiria o antigo até sair e entrar de novo, sem
        // nada na tela dizendo que a etiqueta ficou para trás.
        //
        // Ela SÓ recarrega a página quando algo do retrato mudou de fato: quem
        // mexeu apenas na Unidade Gestora (que não vai na sessão) fica onde
        // está. O próprio catch existe porque reconferir é melhoria, e nunca
        // pré-requisito: a gravação já aconteceu, e uma falha aqui não pode
        // pintar de vermelho o que deu certo.
        sincronizarSessao().catch(() => {});
        carregar();
      } catch (err) {
        showError(err.message || 'Não foi possível salvar.');
      } finally {
        salvar.disabled = false;
      }
    });

    corpo.append(
      el('header', { className: 'instituicao__cabecalho' }, [
        el('h2', { textContent: 'Instituição' }),
        el('p', {
          className: 'instituicao__subtitulo',
          textContent:
            'De quem é esta instalação. O nome e a sigla aparecem no RPCMTec, ' +
            'no Anuário e no cadastro de versão.',
        }),
      ]),
      form,
    );

    // O PAINEL CARREGA SOZINHO, com o próprio catch: ele é a única chamada desta
    // tela que cobra `verifyAdmin` em rota de auditoria, e uma falha nele não
    // pode levar junto o formulário, que é a razão de a tela existir.
    const painel = criarHistorico({
      modulo: 'plataforma',
      entidade: 'instituicao',
      id: dados.id,
      titulo: 'Histórico da instituição',
      subtitulo: 'Quem mudou o nome, a sigla ou a Unidade Gestora',
    });
    corpo.appendChild(painel.element);
    return () => painel.cleanup();
  };

  let desmontar = null;

  async function carregar() {
    if (desmontar) {
      desmontar();
      desmontar = null;
    }
    try {
      // AS DUAS CARREGAM JUNTAS, e aqui o `Promise.all` é legítimo: as duas são
      // do administrador e a tela não existe sem nenhuma das duas. A armadilha
      // do `Promise.all` vale para chamada OPCIONAL ou de outra guarda, e não é
      // o caso.
      const [dados, unidades] = await Promise.all([
        getInstituicao(),
        getUnidadesGestoras(),
      ]);
      desmontar = montar(dados, unidades);
    } catch (err) {
      clearChildren(corpo);
      corpo.appendChild(estadoErro(err, carregar));
    }
  }

  carregar();

  // UMA FUNCAO, e nao `{ cleanup }`: o router chama o retorno do handler
  // (`typeof === 'function'`, em router.js), e o objeto que estava aqui era
  // ignorado em silencio. O painel de historico nunca se desmontava ao sair da
  // tela, entao a resposta atrasada de `GET /auditoria/historico` continuava
  // pintando num DOM ja descartado. O formato `{ cleanup }` e o das ABAS
  // (`createTabs`), e nao o de uma pagina.
  return () => {
    if (desmontar) desmontar();
  };
}

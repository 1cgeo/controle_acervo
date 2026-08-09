import { el, svgIcon, ICONS } from '@utils/dom.js';
import { apiPost } from '@services/api-client.js';
import { saveAuth } from '@store/auth-store.js';
import { showError } from '@utils/toast.js';
import { randomBackground } from '@utils/backgrounds.js';
import { isValidLocalizador, normalizeLocalizador } from '@utils/localizador.js';
import { rotaRaiz } from '../router.js';

/**
 * Porta de entrada da plataforma, com DOIS caminhos lado a lado. Quem chega
 * aqui e uma de duas pessoas, e cada uma precisa
 * reconhecer o seu caminho sem ler instrucao:
 *
 *  - quem trabalha na DGEO entra com usuario e senha (POST /api/login com
 *    cliente 'sca_web') e cai no primeiro modulo a que tem acesso;
 *  - quem PEDIU uma carta so quer saber se ela ficou pronta. Essa pessoa NAO
 *    tem conta, e nunca vai ter: consulta pelo localizador do comprovante, que
 *    e a rota publica '#/consultar-pedido/:localizador' (RN04).
 *
 * Os dois aparecem AO MESMO TEMPO, sem aba nem clique para revelar. Esconder um
 * atras do outro obriga a pessoa a adivinhar em qual metade ela se encaixa, que
 * e justamente o que se quer evitar.
 *
 * ESTA TELA NAO NOMEIA O CENTRO, e a decisao e de 2026-08-09.
 *
 * Ela dizia 'Sistema de Apoio à Produção, 1º CGEO' e 'Para quem trabalha no 1º
 * CGEO', e desde que a instituicao virou dado (`dgeo.instituicao`) esses dois
 * textos seriam o unico lugar do client em que outro Centro continuaria vendo o
 * nome do nosso. Havia dois caminhos, e o que NAO se tomou foi abrir uma rota
 * anonima de instituicao:
 *
 *   - `GET /api/instituicao` e `verifyLogin` de proposito, e a razao esta em
 *     `docs/decisoes.md`. Abri-la publicaria QUAL OM opera esta instalacao para
 *     qualquer um que alcance a tela de entrada -- e esta tela e alcancavel sem
 *     conta, porque o caminho do localizador (RN04) e publico. Seria trocar
 *     superficie exposta por uma linha de subtitulo.
 *   - A tela nao tem sessao para ler: ela e desenhada ANTES de alguem entrar, e
 *     o `auth-store` esta vazio aqui. Ler dali resultaria em nome vazio na
 *     primeira visita e no nome de quem saiu por ultimo na segunda, que e pior
 *     do que nao mostrar nada.
 *
 * Entao o texto ficou VERDADEIRO SEM O NOME: a sigla aberta diz o que o sistema
 * faz, e 'Para quem trabalha no Centro' separa os dois caminhos tao bem quanto
 * a versao com o nome, porque quem chega aqui ja sabe em que Centro trabalha. O
 * nome aparece assim que a pessoa entra, no que ela imprime e no que ela lanca.
 * @param {HTMLElement} container
 */
export async function renderLogin(container) {
  let passwordVisible = false;
  let isSubmitting = false;

  const background = el('div', {
    className: 'login-page__background',
    style: { backgroundImage: `url(${randomBackground()})` },
  });

  // -------------------------------------------------------------------------
  // Caminho 1: quem trabalha na DGEO
  // -------------------------------------------------------------------------
  const usuarioInput = el('input', {
    className: 'form-field__input',
    type: 'text',
    id: 'usuario',
    placeholder: 'Digite seu usuário',
    autocomplete: 'username',
  });

  const senhaInput = el('input', {
    className: 'form-field__input',
    type: 'password',
    id: 'senha',
    placeholder: 'Digite sua senha',
    autocomplete: 'current-password',
  });

  const togglePasswordBtn = el('button', {
    className: 'form-field__toggle-password',
    type: 'button',
    title: 'Mostrar senha',
    'aria-label': 'Mostrar senha',
    onClick: () => {
      passwordVisible = !passwordVisible;
      senhaInput.type = passwordVisible ? 'text' : 'password';
      togglePasswordBtn.innerHTML = '';
      togglePasswordBtn.appendChild(svgIcon(passwordVisible ? ICONS.visibilityOff : ICONS.visibility, 20));
    },
  }, [svgIcon(ICONS.visibility, 20)]);

  const submitBtn = el('button', {
    className: 'login-form__submit',
    type: 'submit',
    textContent: 'Entrar',
  });

  const errorAlert = el('div', { className: 'login-form__error hidden' });

  const form = el('form', { className: 'login-form' }, [
    el('div', { className: 'form-field' }, [
      el('label', { className: 'form-field__label', for: 'usuario', textContent: 'Usuário' }),
      usuarioInput,
    ]),
    el('div', { className: 'form-field' }, [
      el('label', { className: 'form-field__label', for: 'senha', textContent: 'Senha' }),
      el('div', { className: 'form-field__password-wrapper' }, [
        senhaInput,
        togglePasswordBtn,
      ]),
    ]),
    errorAlert,
    submitBtn,
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const usuario = usuarioInput.value.trim();
    const senha = senhaInput.value;

    if (!usuario || !senha) {
      errorAlert.textContent = 'Preencha todos os campos';
      errorAlert.classList.remove('hidden');
      return;
    }

    isSubmitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Entrando...';
    errorAlert.classList.add('hidden');

    try {
      const data = await apiPost('/login', { usuario, senha, cliente: 'sca_web' });
      saveAuth(data, usuario);

      // Volta para a rota de origem, ou entra no primeiro modulo acessivel.
      const params = new URLSearchParams(location.hash.split('?')[1] || '');
      const from = params.get('from');
      location.hash = from && from !== '/' ? from : rotaRaiz();
    } catch (err) {
      errorAlert.textContent = err.message || 'Erro ao realizar login';
      errorAlert.classList.remove('hidden');
      showError(err.message || 'Erro ao realizar login');
    } finally {
      isSubmitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Entrar';
    }
  });

  // -------------------------------------------------------------------------
  // Caminho 2: quem pediu uma carta e quer acompanhar
  // -------------------------------------------------------------------------
  const localizadorInput = el('input', {
    className: 'form-field__input',
    type: 'text',
    id: 'localizador',
    placeholder: 'XXXX-XXXX-XXXX',
    maxLength: '14',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
  });

  const localizadorErro = el('div', { className: 'login-form__error hidden' });

  const localizadorForm = el('form', { className: 'login-form' }, [
    el('div', { className: 'form-field' }, [
      el('label', {
        className: 'form-field__label',
        for: 'localizador',
        textContent: 'Chave do pedido',
      }),
      localizadorInput,
    ]),
    localizadorErro,
    el('button', {
      className: 'login-form__submit login-form__submit--secundario',
      type: 'submit',
      textContent: 'Acompanhar pedido',
    }),
  ]);

  // Formata enquanto se digita (XXXX-XXXX-XXXX): quem copia do comprovante cola
  // com ou sem hifen, e as duas formas tem que funcionar.
  localizadorInput.addEventListener('input', () => {
    const cru = localizadorInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    const partes = cru.match(/.{1,4}/g) || [];
    localizadorInput.value = partes.join('-');
    localizadorErro.classList.add('hidden');
  });

  localizadorForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const valor = normalizeLocalizador(localizadorInput.value);
    if (!isValidLocalizador(valor)) {
      localizadorErro.textContent = 'Chave inválida. Use as 12 letras e números do comprovante.';
      localizadorErro.classList.remove('hidden');
      localizadorInput.focus();
      return;
    }
    location.hash = `/consultar-pedido/${valor}`;
  });

  // -------------------------------------------------------------------------
  // Montagem: dois caminhos, cada um dizendo PARA QUEM ele e
  // -------------------------------------------------------------------------
  function caminho({ icone, titulo, paraQuem, corpo, rodape }) {
    return el('section', { className: 'login-caminho' }, [
      el('div', { className: 'login-caminho__cabecalho' }, [
        el('div', { className: 'login-caminho__icone' }, [svgIcon(icone, 22)]),
        el('div', {}, [
          el('h2', { className: 'login-caminho__titulo', textContent: titulo }),
          el('p', { className: 'login-caminho__para-quem', textContent: paraQuem }),
        ]),
      ]),
      corpo,
      rodape ? el('p', { className: 'login-caminho__rodape', textContent: rodape }) : null,
    ]);
  }

  const card = el('div', { className: 'login-card login-card--duplo' }, [
    el('header', { className: 'login-card__topo' }, [
      el('h1', { className: 'login-card__title', textContent: 'SAP' }),
      // O SUBTITULO NAO LISTA MODULO, e a razao e que a lista apodrece. Ele dizia
      // 'Acervo, Mapoteca e Orçamento, 1º CGEO' de quando eram tres, e ja estava
      // errado com sete. Abrir a sigla diz o que o sistema faz para quem chega, e
      // continua verdadeiro no dia em que entrar o oitavo modulo.
      el('p', {
        className: 'login-card__subtitle',
        textContent: 'Sistema de Apoio à Produção',
      }),
    ]),
    el('div', { className: 'login-card__caminhos' }, [
      caminho({
        icone: ICONS.lock,
        titulo: 'Entrar no sistema',
        paraQuem: 'Para quem trabalha no Centro',
        corpo: form,
      }),
      caminho({
        icone: ICONS.search,
        titulo: 'Acompanhar um pedido',
        paraQuem: 'Para quem solicitou cartas à Mapoteca',
        corpo: localizadorForm,
        rodape: 'A chave de 12 caracteres está no comprovante do pedido. Não é preciso ter conta.',
      }),
    ]),
  ]);

  const page = el('div', { className: 'login-page' }, [background, card]);
  container.appendChild(page);

  usuarioInput.focus();
}

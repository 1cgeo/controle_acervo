import { el, svgIcon, ICONS } from '@utils/dom.js';
import { apiPost } from '@services/api-client.js';
import { saveAuth } from '@store/auth-store.js';
import { showError } from '@utils/toast.js';
import { randomBackground } from '@utils/backgrounds.js';
import { rotaRaiz } from '../router.js';

/**
 * Tela de login UNICA da plataforma, servindo os tres modulos (public, sem layout).
 * POST /api/login com { usuario, senha, cliente: 'sca_web' }; no sucesso grava a
 * sessao (token, perfis por modulo, catalogo de modulos) e vai para ?from= ou
 * para o primeiro modulo em que a pessoa tem acesso.
 * @param {HTMLElement} container
 */
export async function renderLogin(container) {
  let passwordVisible = false;
  let isSubmitting = false;

  const background = el('div', {
    className: 'login-page__background',
    style: { backgroundImage: `url(${randomBackground()})` },
  });

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

  const lockAvatar = el('div', { className: 'login-card__avatar' }, [
    svgIcon(ICONS.lock, 28),
  ]);

  const card = el('div', { className: 'login-card' }, [
    lockAvatar,
    el('h1', { className: 'login-card__title', textContent: 'SCA' }),
    el('p', {
      className: 'login-card__subtitle',
      textContent: 'Acervo, Mapoteca e Orçamento, 1º CGEO',
    }),
    form,
  ]);

  const page = el('div', { className: 'login-page' }, [background, card]);
  container.appendChild(page);

  usuarioInput.focus();
}

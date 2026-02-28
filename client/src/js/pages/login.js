import { el, svgIcon, ICONS } from '@utils/dom.js';
import { apiPost } from '@services/api-client.js';
import { saveAuth } from '@store/auth-store.js';
import { showError } from '@utils/toast.js';

const BACKGROUNDS = [
  '/backgrounds/img-1.jpg',
  '/backgrounds/img-2.jpg',
  '/backgrounds/img-3.jpg',
  '/backgrounds/img-4.jpg',
  '/backgrounds/img-5.jpg',
];

export async function renderLogin(container) {
  const randomBg = BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)];

  let passwordVisible = false;
  let isSubmitting = false;

  // Background
  const background = el('div', {
    className: 'login-page__background',
    style: { backgroundImage: `url(${randomBg})` },
  });

  // Form fields
  const usuarioInput = el('input', {
    className: 'form-field__input',
    type: 'text',
    id: 'usuario',
    placeholder: 'Digite seu usuario',
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

  // Form
  const form = el('form', { className: 'login-form' }, [
    el('div', { className: 'form-field' }, [
      el('label', { className: 'form-field__label', for: 'usuario', textContent: 'Usuario' }),
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

      // Redirect to original destination or dashboard
      const params = new URLSearchParams(location.hash.split('?')[1] || '');
      const from = params.get('from') || '/dashboard';
      location.hash = from;
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

  // Lock icon avatar
  const lockAvatar = el('div', { className: 'login-card__avatar' }, [
    svgIcon(ICONS.lock, 28),
  ]);

  // Card
  const card = el('div', { className: 'login-card' }, [
    lockAvatar,
    el('h1', { className: 'login-card__title', textContent: 'SCA' }),
    el('p', { className: 'login-card__subtitle', textContent: 'Sistema de Controle do Acervo' }),
    form,
  ]);

  const page = el('div', { className: 'login-page' }, [background, card]);
  container.appendChild(page);

  // Focus first input
  usuarioInput.focus();
}

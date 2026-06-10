# Path: core\api_client.py
import logging
import requests
from requests.exceptions import RequestException, ConnectionError, Timeout, HTTPError
from qgis.PyQt.QtWidgets import QMessageBox
from urllib.parse import urljoin

class APIClient:
    REQUEST_TIMEOUT = 30  # segundos para requisições normais
    DOWNLOAD_TIMEOUT = 300  # 5 minutos para downloads de arquivos

    def __init__(self, settings):
        self.settings = settings
        self.base_url = self.settings.get("saved_server", "")
        self.token = None
        self.user_uuid = None
        self.is_admin = False
        self._username = None
        self._password = None
        self.session = requests.Session()
        self._configure_proxy()

    def _configure_proxy(self):
        """Configura o proxy da sessão HTTP.

        Se a opção 'ignore_proxy' estiver ativa (padrão), ignora qualquer
        proxy do sistema e conecta diretamente ao servidor.
        """
        ignore = self.settings.get("ignore_proxy", "true")
        if ignore == "true" or ignore is True:
            self.session.trust_env = False
            self.session.proxies = {
                'http': None,
                'https': None,
            }
        else:
            self.session.trust_env = True
            self.session.proxies = {}

    def show_error(self, title, message):
        """Exibe uma mensagem de erro para o usuário."""
        QMessageBox.critical(None, title, message)

    def _try_relogin(self):
        """Tenta re-autenticar silenciosamente usando credenciais armazenadas."""
        if not self._username or not self._password or not self.base_url:
            return False
        try:
            url = urljoin(self.base_url.rstrip('/') + '/', "api/login")
            response = self.session.post(
                url,
                json={"usuario": self._username, "senha": self._password, "cliente": "sca_qgis"},
                timeout=self.REQUEST_TIMEOUT
            )
            response.raise_for_status()
            result = response.json()
            if result and "dados" in result:
                self.token = result["dados"]["token"]
                self.user_uuid = result["dados"]["uuid"]
                self.is_admin = result["dados"]["administrador"]
                return True
        except Exception as e:
            logging.warning(f"Falha na re-autenticação automática: {e}")
        return False

    def _make_request(self, method, endpoint, data=None, params=None, timeout=None, _retry=True):
        """Método interno para fazer requisições HTTP."""
        if not self.base_url:
            self.show_error("Erro de Configuração", "URL do servidor não configurada.")
            return None

        # Corrigir a concatenação de URLs
        url = urljoin(self.base_url.rstrip('/') + '/', f"api/{endpoint}")
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        timeout = timeout or self.REQUEST_TIMEOUT

        try:
            if method == 'GET':
                response = self.session.get(url, headers=headers, params=params, timeout=timeout)
            elif method == 'POST':
                response = self.session.post(url, headers=headers, json=data, timeout=timeout)
            elif method == 'PUT':
                response = self.session.put(url, headers=headers, json=data, timeout=timeout)
            elif method == 'DELETE':
                response = self.session.delete(url, headers=headers, json=data, params=params, timeout=timeout)
            else:
                raise ValueError(f"Método HTTP não suportado: {method}")

            response.raise_for_status()
            return response.json()

        except ConnectionError:
            self.show_error("Falha na Conexão", "Não foi possível conectar ao servidor. Verifique sua conexão de internet.")
        except Timeout:
            self.show_error("Tempo Esgotado", "O servidor demorou muito para responder. Tente novamente mais tarde.")
        except HTTPError as e:
            if e.response.status_code == 401 and _retry and self._try_relogin():
                return self._make_request(method, endpoint, data=data, params=params, timeout=timeout, _retry=False)
            self._handle_http_error(e, method)
        except ValueError as e:
            self.show_error("Resposta Inválida", f"O servidor retornou uma resposta inválida: {str(e)}")
        except Exception as e:
            self.show_error("Erro Inesperado", f"Ocorreu um erro inesperado: {str(e)}")

        return None

    def _extract_server_message(self, response):
        """Extrai a mensagem de erro padronizada ({success:false, message}) da resposta, se houver."""
        try:
            body = response.json()
            msg = body.get("message") if isinstance(body, dict) else None
            if isinstance(msg, str) and msg.strip():
                return msg
        except Exception:
            pass
        return None

    def _handle_http_error(self, e, method):
        """Método interno para lidar com erros HTTP."""
        server_msg = self._extract_server_message(e.response)
        if e.response.status_code == 401:
            self.show_error("Não Autorizado", "Sua sessão expirou e não foi possível reconectar. Feche o plugin e faça login novamente.")
        elif e.response.status_code == 403:
            self.show_error("Acesso Negado", "Você não tem permissão para realizar esta ação.")
        elif e.response.status_code == 404:
            if server_msg:
                self.show_error("Não Encontrado", server_msg)
            else:
                self.show_error("Não Encontrado", "O recurso solicitado não foi encontrado no servidor.")
        elif e.response.status_code == 400:
            error_msg = server_msg or "Os dados enviados são inválidos."
            self.show_error("Requisição Inválida", f"{error_msg} Verifique as informações e tente novamente.")
        elif e.response.status_code >= 500:
            self.show_error("Erro do Servidor", "O servidor encontrou um erro interno. Tente novamente mais tarde.")
        else:
            detail = f"{e.response.status_code} - {e.response.reason}"
            if server_msg:
                detail = f"{detail}: {server_msg}"
            self.show_error("Erro de HTTP", f"Ocorreu um erro durante a requisição {method}: {detail}")

    def login(self, username, password):
        """Realiza o login do usuário."""
        if not username or not password:
            self.show_error("Falha no Login", "Usuário e senha são obrigatórios.")
            return False

        if not self.base_url:
            self.show_error("Falha no Login", "URL do servidor não configurada.")
            return False

        try:
            response = self._make_request('POST', 'login', data={"usuario": username, "senha": password, "cliente": "sca_qgis"})
            if response and "dados" in response:
                self.token = response["dados"]["token"]
                self.user_uuid = response["dados"]["uuid"]
                self.is_admin = response["dados"]["administrador"]
                self._username = username
                self._password = password
                return True
        except Exception as e:
            self.show_error("Falha no Login", f"Não foi possível fazer login: {str(e)}")
        return False

    def get(self, endpoint, params=None, timeout=None):
        """Realiza uma requisição GET."""
        return self._make_request('GET', endpoint, params=params, timeout=timeout)

    def post(self, endpoint, data=None, timeout=None):
        """Realiza uma requisição POST."""
        return self._make_request('POST', endpoint, data=data, timeout=timeout)

    def put(self, endpoint, data=None, timeout=None):
        """Realiza uma requisição PUT."""
        return self._make_request('PUT', endpoint, data=data, timeout=timeout)

    def delete(self, endpoint, data=None, params=None, timeout=None):
        """Realiza uma requisição DELETE."""
        return self._make_request('DELETE', endpoint, data=data, params=params, timeout=timeout)

    def download_file(self, endpoint, dest_path, params=None, progress_callback=None):
        """Baixa um arquivo binário do servidor.

        Args:
            endpoint: Endpoint da API
            dest_path: Caminho de destino do arquivo
            params: Parâmetros da query string
            progress_callback: Função opcional callback(bytes_baixados, total_bytes)
        """
        if not self.base_url:
            self.show_error("Erro de Configuração", "URL do servidor não configurada.")
            return False

        url = urljoin(self.base_url.rstrip('/') + '/', f"api/{endpoint}")
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}

        try:
            response = self.session.get(url, headers=headers, params=params, stream=True, timeout=self.DOWNLOAD_TIMEOUT)

            if response.status_code == 401 and self._try_relogin():
                headers = {"Authorization": f"Bearer {self.token}"}
                response = self.session.get(url, headers=headers, params=params, stream=True, timeout=self.DOWNLOAD_TIMEOUT)

            response.raise_for_status()

            total_size = int(response.headers.get('content-length', 0))
            downloaded = 0

            with open(dest_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
                    downloaded += len(chunk)
                    if progress_callback and total_size > 0:
                        progress_callback(downloaded, total_size)
            return True

        except ConnectionError:
            self.show_error("Falha na Conexão", "Não foi possível conectar ao servidor.")
        except Timeout:
            self.show_error("Tempo Esgotado", "O servidor demorou muito para responder.")
        except HTTPError as e:
            self._handle_http_error(e, 'GET')
        except Exception as e:
            self.show_error("Erro Inesperado", f"Ocorreu um erro inesperado: {str(e)}")

        return False

# Path: core\api_client.py
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
        except Exception:
            pass
        return False

    def _make_request(self, method, endpoint, data=None, params=None, _retry=True):
        """Método interno para fazer requisições HTTP."""
        if not self.base_url:
            self.show_error("Erro de Configuração", "URL do servidor não configurada.")
            return None

        # Corrigir a concatenação de URLs
        url = urljoin(self.base_url.rstrip('/') + '/', f"api/{endpoint}")
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}

        try:
            if method == 'GET':
                response = self.session.get(url, headers=headers, params=params, timeout=self.REQUEST_TIMEOUT)
            elif method == 'POST':
                response = self.session.post(url, headers=headers, json=data, timeout=self.REQUEST_TIMEOUT)
            elif method == 'PUT':
                response = self.session.put(url, headers=headers, json=data, timeout=self.REQUEST_TIMEOUT)
            elif method == 'DELETE':
                # Corrigir o uso de params e data
                if data:
                    response = self.session.delete(url, headers=headers, json=data, timeout=self.REQUEST_TIMEOUT)
                else:
                    response = self.session.delete(url, headers=headers, params=params, timeout=self.REQUEST_TIMEOUT)
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
                return self._make_request(method, endpoint, data=data, params=params, _retry=False)
            self._handle_http_error(e, method)
        except ValueError as e:
            self.show_error("Resposta Inválida", f"O servidor retornou uma resposta inválida: {str(e)}")
        except Exception as e:
            self.show_error("Erro Inesperado", f"Ocorreu um erro inesperado: {str(e)}")

        return None

    def _handle_http_error(self, e, method):
        """Método interno para lidar com erros HTTP."""
        if e.response.status_code == 401:
            self.show_error("Não Autorizado", "Sua sessão expirou e não foi possível reconectar. Feche o plugin e faça login novamente.")
        elif e.response.status_code == 403:
            self.show_error("Acesso Negado", "Você não tem permissão para realizar esta ação.")
        elif e.response.status_code == 404:
            self.show_error("Não Encontrado", "O recurso solicitado não foi encontrado no servidor.")
        elif e.response.status_code == 400:
            error_msg = "Os dados enviados são inválidos."
            # Tentar extrair mensagem de erro do servidor se disponível
            try:
                response_json = e.response.json()
                if "message" in response_json:
                    error_msg = response_json["message"]
            except Exception:
                pass
            self.show_error("Requisição Inválida", f"{error_msg} Verifique as informações e tente novamente.")
        elif e.response.status_code >= 500:
            self.show_error("Erro do Servidor", "O servidor encontrou um erro interno. Tente novamente mais tarde.")
        else:
            self.show_error("Erro de HTTP", f"Ocorreu um erro durante a requisição {method}: {e.response.status_code} - {e.response.reason}")

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

    def get(self, endpoint, params=None):
        """Realiza uma requisição GET."""
        return self._make_request('GET', endpoint, params=params)

    def post(self, endpoint, data=None):
        """Realiza uma requisição POST."""
        return self._make_request('POST', endpoint, data=data)

    def put(self, endpoint, data=None):
        """Realiza uma requisição PUT."""
        return self._make_request('PUT', endpoint, data=data)

    def delete(self, endpoint, data=None, params=None):
        """Realiza uma requisição DELETE."""
        return self._make_request('DELETE', endpoint, data=data, params=params)

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

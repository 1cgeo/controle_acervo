# Path: gui\login_dialog.py
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QApplication
from qgis.PyQt.QtCore import Qt
from qgis.PyQt import uic
import os

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'ui', 'login.ui'))


class LoginDialog(QDialog, FORM_CLASS):
    def __init__(self, api_client, settings, version, parent=None):
        super().__init__(parent)
        self.setupUi(self)
        self.api_client = api_client
        self.settings = settings

        self.version_text.setText(f"v{version}")

        self.submitBtn.clicked.connect(self.attempt_login)
        self.cancelBtn.clicked.connect(self.reject)

        self.load_credentials()
        self.load_proxy_setting()

    def load_credentials(self):
        saved_server = self.settings.get("saved_server")
        saved_username = self.settings.get("saved_username")
        saved_password = self.settings.get("saved_password")
        remember_me = bool(self.settings.get("remember_me", False))
        
        if saved_server:
            self.server.setText(saved_server)

        if saved_username and remember_me:
            self.user.setText(saved_username)

        if remember_me:
            self.remember_me.setChecked(remember_me)
            
        if saved_password and remember_me:
            self.password.setText(saved_password)

    def save_credentials(self):
        self.settings.set("saved_server", self.server.text())

        if self.remember_me.isChecked():
            self.settings.set("saved_username", self.user.text())
            self.settings.set("saved_password", self.password.text())
            self.settings.set("remember_me", True)
        else:
            self.settings.remove("saved_username")
            self.settings.remove("saved_password")
            self.settings.remove("remember_me")

    def load_proxy_setting(self):
        ignore_proxy = self.settings.get("ignore_proxy", "true")
        self.ignore_proxy.setChecked(ignore_proxy == "true" or ignore_proxy is True)

    def save_proxy_setting(self):
        self.settings.set("ignore_proxy", "true" if self.ignore_proxy.isChecked() else "false")
        self.settings.sync()
        self.api_client._configure_proxy()

    def attempt_login(self):
        # O strip evita o espaço colado no fim do endereço, que quebra a URL
        # montada pelo cliente sem dizer por quê.
        server = self.server.text().strip()
        username = self.user.text().strip()
        password = self.password.text()

        if not server:
            QMessageBox.warning(
                self, "Servidor não informado",
                "Informe o endereço do servidor do SAP, no formato "
                "http://servidor:porta. Peça o endereço ao gerente da mapoteca."
            )
            self.server.setFocus()
            return

        # O ESQUEMA É OBRIGATÓRIO. Sem ele, `urljoin('servidor:3013/',
        # 'api/login')` devolve 'api/login': o Python lê `servidor:` como
        # esquema e o host DESAPARECE. O requests levanta MissingSchema, que cai
        # no `except Exception` genérico do api_client, e a pessoa lê uma
        # mensagem em inglês citando uma URL que ela nunca escreveu.
        if not server.lower().startswith(('http://', 'https://')):
            QMessageBox.warning(
                self, "Endereço incompleto",
                "O endereço do servidor precisa começar com http:// ou https://.\n\n"
                "Exemplo: http://servidor:porta"
            )
            self.server.setFocus()
            return

        self.server.setText(server)
        self.save_proxy_setting()
        self.api_client.base_url = server

        # O login é síncrono. Sem desabilitar o botão, o duplo clique dispara
        # duas autenticações e duas mensagens de erro.
        self.submitBtn.setEnabled(False)
        QApplication.setOverrideCursor(Qt.CursorShape.WaitCursor)
        try:
            autenticou = self.api_client.login(username, password)
        finally:
            QApplication.restoreOverrideCursor()
            self.submitBtn.setEnabled(True)

        # A mensagem de falha sai do api_client, que sabe a causa.
        if autenticou:
            self.save_credentials()
            self.accept()
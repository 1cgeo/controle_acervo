# Path: gui\login_dialog.py
from qgis.PyQt.QtWidgets import QDialog, QVBoxLayout, QLabel, QLineEdit, QPushButton, QCheckBox
from qgis.PyQt.QtCore import pyqtSignal
from qgis.PyQt import uic
import os

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'ui', 'login.ui'))

class LoginDialog(QDialog, FORM_CLASS):
    login_successful = pyqtSignal(dict)

    def __init__(self, api_client, settings, version, parent=None):
        super().__init__(parent)
        self.setupUi(self)
        self.api_client = api_client
        self.settings = settings

        # Set version in the UI
        self.version_text.setText(f"v{version}")

        # Connect the buttons
        self.submitBtn.clicked.connect(self.attempt_login)
        self.cancelBtn.clicked.connect(self.reject)

        # Load saved credentials and proxy setting
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
        server = self.server.text()
        username = self.user.text()
        password = self.password.text()

        # Aplicar configuração de proxy antes de tentar login
        self.save_proxy_setting()

        # Update server URL in api_client
        self.api_client.base_url = server

        if self.api_client.login(username, password):
            self.save_credentials()
            user_data = {
                "username": username,
                "server": server,
                "uuid": self.api_client.user_uuid,
                "is_admin": self.api_client.is_admin
            }
            self.login_successful.emit(user_data)
            self.accept()
        # Error handling is done in api_client.login()
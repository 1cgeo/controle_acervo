# Path: gui\configuracoes\configuracoes_dialog.py
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit, QPushButton, QGroupBox, QCheckBox
from qgis.PyQt.QtCore import Qt
from ...core.settings import Settings

class ConfiguracoesDialog(QDialog):
    def __init__(self, iface, api_client, parent=None):
        super(ConfiguracoesDialog, self).__init__(parent)
        self.iface = iface
        self.api_client = api_client
        self.settings = Settings()

        self.mainLayout = QVBoxLayout(self)
        self.setup_ui()
        self.load_settings()
        
    def setup_ui(self):
        """Configurar a interface de usuário."""
        self.setWindowTitle("Configurações do Controle do Acervo")
        
        # Grupo SMB
        self.smbGroupBox = QGroupBox("Configurações SMB")
        smbLayout = QVBoxLayout()
        
        # Domínio padrão
        smbLabel = QLabel("Domínio SMB padrão:")
        self.smbDomainLineEdit = QLineEdit()
        smbLayout.addWidget(smbLabel)
        smbLayout.addWidget(self.smbDomainLineEdit)
        
        self.smbGroupBox.setLayout(smbLayout)
        self.mainLayout.addWidget(self.smbGroupBox)

        # Grupo Rede
        self.networkGroupBox = QGroupBox("Configurações de Rede")
        networkLayout = QVBoxLayout()

        self.ignoreProxyCheckBox = QCheckBox("Ignorar proxy do sistema")
        self.ignoreProxyCheckBox.setToolTip(
            "Quando marcado, as requisições do plugin conectam diretamente ao servidor,\n"
            "ignorando qualquer proxy configurado no sistema ou no QGIS.\n"
            "Útil para evitar erros 407 (Proxy Authentication Required)."
        )
        networkLayout.addWidget(self.ignoreProxyCheckBox)

        self.networkGroupBox.setLayout(networkLayout)
        self.mainLayout.addWidget(self.networkGroupBox)

        # Botões
        self.saveButton = QPushButton("Salvar")
        self.saveButton.clicked.connect(self.save_settings)
        self.cancelButton = QPushButton("Cancelar")
        self.cancelButton.clicked.connect(self.reject)
        
        buttonLayout = QHBoxLayout()
        buttonLayout.addWidget(self.saveButton)
        buttonLayout.addWidget(self.cancelButton)
        
        self.mainLayout.addLayout(buttonLayout)
        
    def load_settings(self):
        """Carregar configurações salvas."""
        # Carregar configuração de domínio SMB
        smb_domain = self.settings.get("smb_default_domain", "1CGEO")
        self.smbDomainLineEdit.setText(smb_domain)

        # Carregar configuração de proxy (padrão: ignorar)
        ignore_proxy = self.settings.get("ignore_proxy", "true")
        self.ignoreProxyCheckBox.setChecked(ignore_proxy == "true" or ignore_proxy is True)
        
    def save_settings(self):
        """Salvar configurações."""
        # Salvar configuração de domínio SMB
        smb_domain = self.smbDomainLineEdit.text().strip()
        if not smb_domain:
            QMessageBox.warning(self, "Aviso", "O domínio SMB não pode ser vazio.")
            return
            
        self.settings.set("smb_default_domain", smb_domain)

        # Salvar configuração de proxy
        self.settings.set("ignore_proxy", "true" if self.ignoreProxyCheckBox.isChecked() else "false")

        self.settings.sync()

        # Reconfigurar proxy na sessão HTTP ativa
        if self.api_client:
            self.api_client._configure_proxy()

        QMessageBox.information(self, "Sucesso", "Configurações salvas com sucesso.")
        self.accept()
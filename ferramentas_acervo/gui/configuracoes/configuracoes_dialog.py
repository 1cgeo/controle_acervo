# Path: gui\configuracoes\configuracoes_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QVBoxLayout, QLabel, QLineEdit, QPushButton, QGroupBox
from qgis.PyQt.QtCore import Qt
from ...core.settings import Settings

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'configuracoes_dialog.ui'))

class ConfiguracoesDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(ConfiguracoesDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.settings = Settings()
        
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
        
    def save_settings(self):
        """Salvar configurações."""
        # Salvar configuração de domínio SMB
        smb_domain = self.smbDomainLineEdit.text().strip()
        if not smb_domain:
            QMessageBox.warning(self, "Aviso", "O domínio SMB não pode ser vazio.")
            return
            
        self.settings.set("smb_default_domain", smb_domain)
        self.settings.sync()
        
        QMessageBox.information(self, "Sucesso", "Configurações salvas com sucesso.")
        self.accept()
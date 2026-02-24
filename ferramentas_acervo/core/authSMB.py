# Path: core\authSMB.py
from qgis.PyQt import QtWidgets, uic
import os
# Importar no nível do módulo
from ..core.settings import Settings

class AuthSMB(QtWidgets.QDialog):

    def __init__(self, parent=None):
        super(AuthSMB, self).__init__(parent)
        self.user = ""
        self.passwd = ""
        
        # Usar configuração do plugin em vez de valor hardcoded
        settings = Settings()
        self.domain = settings.get("smb_default_domain", "1CGEO")
        
        # Inicializar a UI depois de configurar as variáveis
        self.setupUi()
        
        # Preencher o campo de domínio com o valor padrão
        if hasattr(self, 'domain_le'):
            self.domain_le.setText(self.domain)

    def setupUi(self):
        # Carrega o arquivo UI
        uic.loadUi(self.getUIPath(), self)
        
        # Verificar se os widgets necessários existem
        required_widgets = ['ok_bt', 'cancel_bt', 'name_le', 'passwd_le', 'domain_le']
        for widget in required_widgets:
            if not hasattr(self, widget):
                raise AttributeError(f"Widget '{widget}' não encontrado no arquivo UI")
        
        # Conecta os sinais aos slots
        self.ok_bt.clicked.connect(self.validate)
        self.cancel_bt.clicked.connect(self.reject)

    def getUIPath(self):
        return os.path.join(
            os.path.abspath(os.path.dirname(__file__)),
            'ui', 
            'authSMB.ui'
        )

    def validate(self):
        """Valida os campos de entrada."""
        self.user = self.name_le.text().strip()
        self.passwd = self.passwd_le.text()
        self.domain = self.domain_le.text().strip()
        
        # Validar campos
        error_msg = None
        if not self.user:
            error_msg = "O campo de usuário é obrigatório."
        elif not self.passwd:
            error_msg = "O campo de senha é obrigatório."
        elif not self.domain:
            error_msg = "O campo de domínio é obrigatório."
        
        if error_msg:
            QtWidgets.QMessageBox.warning(
                self,
                'Validação',
                error_msg
            )
            return
            
        # Todos os campos válidos
        self.accept()

    @staticmethod
    def getCredentials(parent=None):
        dialog = AuthSMB(parent)
        result = dialog.exec_()
        if result == QtWidgets.QDialog.Accepted:
            return dialog.user, dialog.passwd, dialog.domain
        return None, None, None
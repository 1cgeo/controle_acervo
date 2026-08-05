# Path: core\authSMB.py
from qgis.PyQt import QtWidgets, uic
import os
from ..core.settings import Settings


class AuthSMB(QtWidgets.QDialog):
    """Pede as credenciais de rede (SMB) usadas na cópia de arquivos no Linux.

    O domínio padrão vem da configuração `smb_default_domain` do plugin.
    """

    def __init__(self, parent=None):
        super(AuthSMB, self).__init__(parent)
        self.user = ""
        self.passwd = ""

        settings = Settings()
        self.domain = settings.get("smb_default_domain", "1CGEO")

        self.setupUi()

        if hasattr(self, 'domain_le'):
            self.domain_le.setText(self.domain)

    def setupUi(self):
        uic.loadUi(self.getUIPath(), self)

        required_widgets = ['ok_bt', 'cancel_bt', 'name_le', 'passwd_le', 'domain_le']
        for widget in required_widgets:
            if not hasattr(self, widget):
                raise AttributeError(f"Widget '{widget}' não encontrado no arquivo UI")

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
                'Credenciais de rede',
                f"{error_msg}\n\nPreencha os três campos ou cancele a cópia."
            )
            return

        self.accept()
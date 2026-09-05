# Path: main.py
import os
from qgis.PyQt.QtGui import QIcon, QAction
from qgis.PyQt.QtCore import QObject
from qgis.PyQt.QtWidgets import QMessageBox
from .core.settings import Settings
from .core.api_client import APIClient
from .gui.login_dialog import LoginDialog
from .gui.pedidos.pedidos_dialog import PedidosDialog
from .config import Config


class Main(QObject):
    def __init__(self, iface):
        super(Main, self).__init__()
        self.plugin_dir = os.path.dirname(__file__)
        self.iface = iface
        self.settings = Settings()
        self.api_client = APIClient(self.settings)
        self.pedidos_dialog = None

    def initGui(self):
        icon_path = self.getPluginIconPath()
        self.action = QAction(QIcon(icon_path), f"{Config.NAME} v{Config.VERSION}",
                              self.iface.mainWindow())
        self.action.triggered.connect(self.startPlugin)
        self.iface.addToolBarIcon(self.action)

    def unload(self):
        self.iface.removeToolBarIcon(self.action)
        self._descartarDialogo()
        del self.action

    def startPlugin(self):
        login_dialog = LoginDialog(self.api_client, self.settings, Config.VERSION)
        if not login_dialog.exec():
            return
        if not self.temPerfilParaOperar():
            return
        self.showPedidosDialog()

    def temPerfilParaOperar(self):
        """Este plugin inteiro exige OPERADOR no módulo mapoteca.

        As rotas de trabalho (fila, lista de impressão, preparo do download) são
        `verifyPerfil('operador', 'mapoteca')`. Quem decide é o servidor, que
        relê o banco a cada requisição; aqui só se explica o que falta.
        """
        if self.api_client.pode('operador'):
            return True

        QMessageBox.warning(
            self.iface.mainWindow(),
            "Perfil insuficiente",
            "Este plugin é a ferramenta de quem imprime, e exige o perfil "
            "OPERADOR no módulo Mapoteca.\n\n"
            "Seu usuário não tem esse perfil. Peça ao gerente da mapoteca para "
            "concedê-lo, ou consulte os pedidos pela interface web do SAP."
        )
        return False

    def showPedidosDialog(self):
        # Um diálogo NOVO a cada abertura: reaproveitar a instância traz o
        # estado da sessão anterior (fila carregada, pedido selecionado,
        # gerenciador de download encerrado) e a tela abre desatualizada.
        self._descartarDialogo()
        self.pedidos_dialog = PedidosDialog(self.iface, self.api_client, self.settings)
        self.pedidos_dialog.show()
        self.pedidos_dialog.raise_()
        self.pedidos_dialog.activateWindow()

    def _descartarDialogo(self):
        if self.pedidos_dialog is None:
            return
        self.pedidos_dialog.close()
        self.pedidos_dialog.deleteLater()
        self.pedidos_dialog = None

    def getPluginIconPath(self):
        return os.path.join(self.plugin_dir, 'icons', 'icon.png')

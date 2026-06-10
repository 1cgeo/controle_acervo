# Path: main.py
import os
from qgis.PyQt.QtGui import QIcon, QAction
from qgis.PyQt.QtCore import QObject
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
        self.action = QAction(QIcon(icon_path), f"{Config.NAME} v{Config.VERSION}", self.iface.mainWindow())
        self.action.triggered.connect(self.startPlugin)
        self.iface.addToolBarIcon(self.action)

    def unload(self):
        self.iface.removeToolBarIcon(self.action)
        if self.pedidos_dialog:
            self.pedidos_dialog.close()
            self.pedidos_dialog.deleteLater()
            self.pedidos_dialog = None
        del self.action

    def startPlugin(self):
        login_dialog = LoginDialog(self.api_client, self.settings, Config.VERSION)
        result = login_dialog.exec()
        if result:
            self.showPedidosDialog()

    def showPedidosDialog(self):
        if self.pedidos_dialog is None:
            self.pedidos_dialog = PedidosDialog(self.iface, self.api_client)
        else:
            self.pedidos_dialog.load_pedidos()

        self.pedidos_dialog.show()
        self.pedidos_dialog.raise_()
        self.pedidos_dialog.activateWindow()

    def getPluginIconPath(self):
        return os.path.join(
            self.plugin_dir,
            'icons',
            'icon.png'
        )

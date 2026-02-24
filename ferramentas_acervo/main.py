# Path: main.py
import os
from qgis.PyQt.QtWidgets import QAction
from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtCore import QObject, Qt
from .core.settings import Settings
from .core.api_client import APIClient
from .gui.login_dialog import LoginDialog
from .gui.dockable_panel import DockablePanel
from .config import Config

class Main(QObject):
    def __init__(self, iface):
        super(Main, self).__init__()
        self.plugin_dir = os.path.dirname(__file__)
        self.iface = iface
        self.settings = Settings()
        self.api_client = APIClient(self.settings)
        self.dockable_panel = None

    def initGui(self):
        icon_path = self.getPluginIconPath()
        self.action = QAction(QIcon(icon_path), f"{Config.NAME} v{Config.VERSION}", self.iface.mainWindow())
        self.action.triggered.connect(self.startPlugin)
        self.iface.addToolBarIcon(self.action)

    def unload(self):
        self.iface.removeToolBarIcon(self.action)
        if self.dockable_panel:
            self.iface.removeDockWidget(self.dockable_panel)
            self.dockable_panel.deleteLater()
            self.dockable_panel = None
        del self.action

    def startPlugin(self):
        login_dialog = LoginDialog(self.api_client, self.settings, Config.VERSION)
        result = login_dialog.exec_()
        if result:
            self.loadDockablePanel()

    def loadDockablePanel(self):
        if self.dockable_panel is None:
            self.dockable_panel = DockablePanel(self.iface, self.api_client)
            self.iface.addDockWidget(Qt.RightDockWidgetArea, self.dockable_panel)
        else:
            self.dockable_panel.update_content()
            if self.dockable_panel.isHidden():
                self.dockable_panel.show()
        
        self.dockable_panel.raise_()
        self.dockable_panel.activateWindow()

    def getPluginIconPath(self):
        return os.path.join(
            self.plugin_dir,
            'icons',
            'icon.png'
        )
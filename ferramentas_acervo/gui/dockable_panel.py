# Path: gui\dockable_panel.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDockWidget, QTreeWidgetItem, QLabel
from qgis.PyQt.QtCore import Qt
from qgis.core import Qgis
from ..config import Config
from .panel import PANEL_MAPPING

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'ui', 'dockable_panel.ui'))

class DockablePanel(QDockWidget, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(DockablePanel, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client

        self.setAllowedAreas(Qt.RightDockWidgetArea | Qt.LeftDockWidgetArea)
        self.setWindowTitle(Config.NAME)

        self.setup_ui()
        self.treeWidget.itemClicked.connect(self.on_item_clicked)

    def setup_ui(self):
        self.versionLabel.setText(f"v{Config.VERSION}")
        self.populate_tree()
        self.searchLineEdit.textChanged.connect(self.filter_tree)

    def populate_tree(self):
        self.treeWidget.clear()
        categories = {}

        for panel_name, panel_info in PANEL_MAPPING.items():
            if panel_info["admin_only"] and not self.api_client.is_admin:
                continue

            category = panel_info["category"]
            if category not in categories:
                categories[category] = QTreeWidgetItem(self.treeWidget, [category])

            QTreeWidgetItem(categories[category], [panel_name])

        self.treeWidget.expandAll()

    def on_item_clicked(self, item, column):
        if item.parent() is not None:  # Apenas itens filhos são clicáveis
            self.open_panel(item.text(0))

    def open_panel(self, panel_name):
        panel_info = PANEL_MAPPING.get(panel_name)
        if panel_info:
            dialog = panel_info["class"](self.iface, self.api_client)
            dialog.exec_()
        else:
            self.iface.messageBar().pushMessage("Erro", f"Painel '{panel_name}' não implementado", level=Qgis.Warning)

    def update_content(self):
        self.populate_tree()

    def filter_tree(self, text):
        for i in range(self.treeWidget.topLevelItemCount()):
            category_item = self.treeWidget.topLevelItem(i)
            category_visible = False
            for j in range(category_item.childCount()):
                child_item = category_item.child(j)
                if text.lower() in child_item.text(0).lower():
                    child_item.setHidden(False)
                    category_visible = True
                else:
                    child_item.setHidden(True)
            category_item.setHidden(not category_visible)

        if not text:
            self.treeWidget.expandAll()
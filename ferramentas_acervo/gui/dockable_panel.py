# Path: gui\dockable_panel.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDockWidget, QTreeWidgetItem, QLabel
from qgis.PyQt.QtCore import Qt, QTimer
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
        self.open_dialogs = {}

        self.setAllowedAreas(Qt.DockWidgetArea.RightDockWidgetArea | Qt.DockWidgetArea.LeftDockWidgetArea)
        self.setWindowTitle(Config.NAME)

        self.setup_ui()
        # A abertura de uma função exige duplo clique. O clique simples continua
        # apenas selecionando o item e expandindo/colapsando as categorias
        # (comportamento nativo do QTreeWidget).
        self.treeWidget.itemDoubleClicked.connect(self.on_item_double_clicked)

    def setup_ui(self):
        self.versionLabel.setText(f"v{Config.VERSION}")
        # Informa ao usuário que a abertura de uma função exige duplo clique
        self.treeWidget.setToolTip("Dê um duplo clique em uma função para abri-la")
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

    def on_item_double_clicked(self, item, column):
        # Apenas itens filhos (funções) abrem diálogos. O duplo clique em uma
        # categoria mantém o comportamento nativo de expandir/colapsar.
        if item.parent() is not None:
            self.open_panel(item.text(0))

    def open_panel(self, panel_name):
        panel_info = PANEL_MAPPING.get(panel_name)
        if panel_info:
            try:
                if panel_info.get("modal"):
                    # Diálogos marcados como modais (ex: Configurações) mantêm o fluxo bloqueante
                    dialog = panel_info["class"](self.iface, self.api_client, parent=self.iface.mainWindow())
                    dialog.exec()
                    return

                # Estratégia: fecha a instância antiga (se existir) e abre uma nova,
                # evitando janelas com dados desatualizados
                existing = self.open_dialogs.pop(panel_name, None)
                if existing is not None:
                    existing.close()

                dialog = panel_info["class"](self.iface, self.api_client, parent=self.iface.mainWindow())
                dialog.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose)
                dialog.destroyed.connect(
                    lambda _=None, name=panel_name, ref=dialog: self.remove_dialog_reference(name, ref)
                )
                self.open_dialogs[panel_name] = dialog
                dialog.show()
                # Trazer para frente e dar foco APÓS o event loop processar o
                # show() e o clique no painel — senão o foco volta ao QGIS e o
                # usuário precisa clicar na janela para ativá-la
                QTimer.singleShot(0, lambda d=dialog: (d.raise_(), d.activateWindow()))
            except Exception as e:
                self.iface.messageBar().pushMessage(
                    "Erro",
                    f"Não foi possível abrir '{panel_name}': {e}",
                    level=Qgis.MessageLevel.Critical
                )
        else:
            self.iface.messageBar().pushMessage("Erro", f"Painel '{panel_name}' não implementado", level=Qgis.MessageLevel.Warning)

    def remove_dialog_reference(self, panel_name, dialog):
        # Remove a referência apenas se ainda apontar para o diálogo destruído,
        # para não remover uma instância mais recente aberta com o mesmo nome
        if self.open_dialogs.get(panel_name) is dialog:
            del self.open_dialogs[panel_name]

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
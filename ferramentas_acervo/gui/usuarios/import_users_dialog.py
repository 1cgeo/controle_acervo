# Path: gui\usuarios\import_users_dialog.py
from qgis.PyQt.QtWidgets import QDialog, QVBoxLayout, QTableWidget, QPushButton, QTableWidgetItem, QCheckBox, QLineEdit
from qgis.PyQt.QtCore import Qt, QSize

class ImportUsersDialog(QDialog):
    def __init__(self, users, parent=None):
        super(ImportUsersDialog, self).__init__(parent)
        self.users = users
        self.setup_ui()

    def setup_ui(self):
        self.setWindowTitle("Importar Usuários")
        self.setMinimumSize(QSize(600, 400))
        self.resize(700, 500)

        layout = QVBoxLayout(self)

        # Adicionar campo de busca
        self.searchField = QLineEdit(self)
        self.searchField.setPlaceholderText("Buscar por nome...")
        self.searchField.textChanged.connect(self.filter_users)
        layout.addWidget(self.searchField)

        self.usersTable = QTableWidget(self)
        self.usersTable.setColumnCount(4)
        self.usersTable.setHorizontalHeaderLabels(['', 'Posto/Grad', 'Nome', 'Login'])
        self.usersTable.setSelectionBehavior(QTableWidget.SelectRows)

        # Ajusta o tamanho das colunas
        self.usersTable.setColumnWidth(0, 30)  # Coluna do checkbox
        self.usersTable.setColumnWidth(1, 150)  # Coluna Login
        self.usersTable.setColumnWidth(2, 100)  # Coluna Posto/Grad
        self.usersTable.setColumnWidth(3, 270)  # Coluna Nome

        self.populate_table(self.users)
        self.usersTable.resizeColumnsToContents()

        layout.addWidget(self.usersTable)

        self.importButton = QPushButton("Importar Selecionados", self)
        self.importButton.clicked.connect(self.accept)
        layout.addWidget(self.importButton)

        self.cancelButton = QPushButton("Cancelar", self)
        self.cancelButton.clicked.connect(self.reject)
        layout.addWidget(self.cancelButton)

    def populate_table(self, users):
        self.usersTable.setRowCount(len(users))
        for row, user in enumerate(users):
            checkbox = QCheckBox()
            self.usersTable.setCellWidget(row, 0, checkbox)
            self.usersTable.setItem(row, 1, QTableWidgetItem(user['tipo_posto_grad']))
            self.usersTable.setItem(row, 2, QTableWidgetItem(user['nome']))
            self.usersTable.setItem(row, 3, QTableWidgetItem(user['login']))

    def filter_users(self):
        search_text = self.searchField.text().lower()
        filtered_users = [user for user in self.users if search_text in user['nome'].lower()]
        self.populate_table(filtered_users)

    def get_selected_uuids(self):
        selected_uuids = []
        for row in range(self.usersTable.rowCount()):
            checkbox = self.usersTable.cellWidget(row, 0)
            if checkbox.isChecked():
                login = self.usersTable.item(row, 3).text()
                user = next((u for u in self.users if u['login'] == login), None)
                if user:
                    selected_uuids.append(user['uuid'])
        return selected_uuids
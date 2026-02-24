# Path: gui\usuarios\manage_users_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QVBoxLayout, QTableWidget, QPushButton, QMessageBox, QTableWidgetItem, QCheckBox, QLineEdit
from qgis.PyQt.QtCore import Qt
from .import_users_dialog import ImportUsersDialog

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'manage_users_dialog.ui'))

class ManageUsersDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(ManageUsersDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client

        self.setup_ui()
        self.load_users()

    def setup_ui(self):
        self.setWindowTitle("Gerenciar Usuários")
        
        # Adicionar campo de busca
        self.searchField = QLineEdit(self)
        self.searchField.setPlaceholderText("Buscar por nome...")
        self.searchField.textChanged.connect(self.filter_users)
        self.verticalLayout.insertWidget(0, self.searchField)
        
        # Configurar a tabela de usuários
        self.usersTable.setColumnCount(5)
        self.usersTable.setHorizontalHeaderLabels(['Posto/Grad', 'Nome', 'Login', 'Administrador', 'Ativo'])
        self.usersTable.setSelectionBehavior(QTableWidget.SelectRows)
        self.usersTable.setEditTriggers(QTableWidget.NoEditTriggers)

        # Conectar botões
        self.updateButton.clicked.connect(self.update_users)
        self.importButton.clicked.connect(self.import_users)
        self.syncButton.clicked.connect(self.sync_users)

    def load_users(self):
        response = self.api_client.get('usuarios')
        if response is None:
            QMessageBox.warning(self, "Erro", "Não foi possível carregar os usuários.")
            return

        self.users = response.get('dados', [])
        self.populate_table(self.users)
        self.usersTable.resizeColumnsToContents()

    def populate_table(self, users):
        self.usersTable.setRowCount(len(users))
        for row, user in enumerate(users):
            self.usersTable.setItem(row, 0, QTableWidgetItem(user['tipo_posto_grad']))
            self.usersTable.setItem(row, 1, QTableWidgetItem(user['nome']))
            self.usersTable.setItem(row, 2, QTableWidgetItem(user['login']))

            admin_checkbox = QCheckBox()
            admin_checkbox.setChecked(user['administrador'])
            self.usersTable.setCellWidget(row, 3, admin_checkbox)
            
            active_checkbox = QCheckBox()
            active_checkbox.setChecked(user['ativo'])
            self.usersTable.setCellWidget(row, 4, active_checkbox)

    def filter_users(self):
        search_text = self.searchField.text().lower()
        filtered_users = [user for user in self.users if search_text in user['nome'].lower()]
        self.populate_table(filtered_users)

    def update_users(self):
        updated_users = []
        for row in range(self.usersTable.rowCount()):
            login = self.usersTable.item(row, 2).text()
            user = next((u for u in self.users if u['login'] == login), None)
            if user:
                admin_checkbox = self.usersTable.cellWidget(row, 3)
                active_checkbox = self.usersTable.cellWidget(row, 4)
                
                updated_users.append({
                    'uuid': user['uuid'],
                    'administrador': admin_checkbox.isChecked(),
                    'ativo': active_checkbox.isChecked()
                })
        
        success = self.api_client.put('usuarios', {'usuarios': updated_users})
        if success:
            QMessageBox.information(self, "Sucesso", "Usuários atualizados com sucesso.")
            self.load_users()
        else:
            QMessageBox.warning(self, "Erro", "Não foi possível atualizar os usuários.")

    def import_users(self):
        response = self.api_client.get('usuarios/servico_autenticacao')
        if response is None:
            QMessageBox.warning(self, "Erro", "Não foi possível obter a lista de usuários do serviço de autenticação.")
            return

        auth_users = response.get('dados', [])
        existing_uuids = set(user['uuid'] for user in self.users)
        new_users = [user for user in auth_users if user['uuid'] not in existing_uuids]

        if not new_users:
            QMessageBox.information(self, "Informação", "Não há novos usuários para importar.")
            return

        import_dialog = ImportUsersDialog(new_users, self)
        if import_dialog.exec_():
            selected_uuids = import_dialog.get_selected_uuids()
            if selected_uuids:
                success = self.api_client.post('usuarios', {'usuarios': selected_uuids})
                if success:
                    QMessageBox.information(self, "Sucesso", "Usuários importados com sucesso.")
                    self.load_users()
                else:
                    QMessageBox.warning(self, "Erro", "Não foi possível importar os usuários.")
            else:
                QMessageBox.information(self, "Informação", "Nenhum usuário selecionado para importação.")

    def sync_users(self):
        reply = QMessageBox.question(self, 'Confirmar Sincronização',
                                     'Tem certeza que deseja sincronizar os usuários com o serviço de autenticação?',
                                     QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
        if reply == QMessageBox.Yes:
            success = self.api_client.put('usuarios/sincronizar')
            if success:
                QMessageBox.information(self, "Sucesso", "Usuários sincronizados com sucesso.")
                self.load_users()
            else:
                QMessageBox.warning(self, "Erro", "Não foi possível sincronizar os usuários.")
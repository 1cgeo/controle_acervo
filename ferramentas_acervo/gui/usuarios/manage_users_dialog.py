# Path: gui\usuarios\manage_users_dialog.py
"""Gerência de usuários: quem é administrador, quem está ativo e o PERFIL POR MÓDULO.

O `perfis` é OPCIONAL no schema do PUT, e omiti-lo passa com 200 sem mexer em
nada. Por isso o corpo daqui manda o mapa SEMPRE, com nível nulo para o módulo
sem acesso. Quem não tem linha em `dgeo.usuario_perfil` não acessa aquele
módulo, e a falta é invisível para quem olha só Administrador e Ativo.

As colunas de módulo são MONTADAS a partir de `dominio.modulo`, e não escritas
aqui: módulo novo no servidor aparece sozinho. É a razão de o servidor devolver
`perfis` como mapa, em vez de uma coluna por módulo.

Esta tela EDITA quem já existe: privilégio, estado e perfil por módulo. Ela não
CRIA ninguém. Criar usuário exige definir SENHA, e por isso mora na interface
web (#/usuarios) e no `efetivo_cli`. O QGIS não é lugar de digitar senha de
terceiro, e o plugin não tem tela de senha nenhuma.
"""
import os

from qgis.core import Qgis
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import (QCheckBox, QComboBox, QDialog, QHeaderView, QLineEdit,
                                 QMessageBox, QTableWidget, QTableWidgetItem)

from ...core.dominios import NOME_PERFIL, PERFIL_CONSULTA, PERFIL_GERENTE, PERFIL_OPERADOR

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'manage_users_dialog.ui'))

COLUNAS_FIXAS = ['Posto/Grad', 'Nome', 'Login', 'Administrador', 'Ativo']
SEM_ACESSO = "(sem acesso)"


class ManageUsersDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(ManageUsersDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.users = []
        self.modulos = []

        self.setup_ui()
        self.load_modulos()
        self.load_users()

    # --- montagem -----------------------------------------------------------

    def setup_ui(self):
        self.setWindowTitle("Gerenciar Usuários")

        self.searchField = QLineEdit(self)
        self.searchField.setPlaceholderText("Buscar por nome ou login...")
        self.searchField.textChanged.connect(self.filter_users)
        self.verticalLayout.insertWidget(0, self.searchField)

        self.usersTable.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.usersTable.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)

        self.updateButton.setText("Salvar Alterações")
        self.updateButton.setToolTip(
            "Salva as alterações de Administrador, Ativo e perfil por módulo feitas na tabela."
        )

        self.updateButton.clicked.connect(self.update_users)

    def load_modulos(self):
        """As colunas de módulo saem de dominio.modulo, não de uma lista aqui."""
        resposta = self.api_client.get('usuarios/dominio/modulo')
        self.modulos = (resposta or {}).get('dados', []) or []

        cabecalho = COLUNAS_FIXAS + [m['nome'] for m in self.modulos]
        self.usersTable.setColumnCount(len(cabecalho))
        self.usersTable.setHorizontalHeaderLabels(cabecalho)
        self.usersTable.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch
        )

    def load_users(self):
        resposta = self.api_client.get('usuarios')
        if resposta is None:
            QMessageBox.warning(self, "Erro", "Não foi possível carregar os usuários.")
            return

        self.users = resposta.get('dados', []) or []
        self.populate_table(self.users)
        self.usersTable.resizeColumnsToContents()
        self.avisar_sem_acesso()

    def populate_table(self, users):
        self.usersTable.setRowCount(len(users))
        for row, user in enumerate(users):
            self.usersTable.setItem(row, 0, QTableWidgetItem(user['tipo_posto_grad']))
            self.usersTable.setItem(row, 1, QTableWidgetItem(user['nome']))
            self.usersTable.setItem(row, 2, QTableWidgetItem(user['login']))

            admin = QCheckBox()
            admin.setChecked(bool(user['administrador']))
            admin.setToolTip(
                "O administrador é GLOBAL: passa em qualquer módulo, em qualquer nível.\n"
                "Não existe administrador de módulo."
            )
            self.usersTable.setCellWidget(row, 3, admin)

            ativo = QCheckBox()
            ativo.setChecked(bool(user['ativo']))
            self.usersTable.setCellWidget(row, 4, ativo)

            perfis = user.get('perfis') or {}
            for i, modulo in enumerate(self.modulos):
                combo = QComboBox()
                combo.addItem(SEM_ACESSO, None)
                for nivel in (PERFIL_CONSULTA, PERFIL_OPERADOR, PERFIL_GERENTE):
                    combo.addItem(NOME_PERFIL[nivel], nivel)

                atual = perfis.get(modulo['nome_abrev'])
                indice = combo.findData(atual)
                combo.setCurrentIndex(indice if indice >= 0 else 0)
                combo.setToolTip(
                    f"Perfil no módulo {modulo['nome']}.\n"
                    f"'{SEM_ACESSO}' remove o acesso da pessoa a este módulo."
                )
                self.usersTable.setCellWidget(row, len(COLUNAS_FIXAS) + i, combo)

    def avisar_sem_acesso(self):
        """Diz quantos usuários ativos não acessam módulo nenhum.

        O estado é INVISÍVEL para quem olha só Administrador e Ativo: a pessoa
        aparece cadastrada e ativa, e mesmo assim o login não a leva a lugar
        nenhum.
        """
        orfaos = [u for u in self.users
                  if u.get('ativo') and not u.get('administrador') and not (u.get('perfis') or {})]
        if not orfaos:
            return
        nomes = ", ".join(u['nome'] for u in orfaos[:5])
        if len(orfaos) > 5:
            nomes += f" e mais {len(orfaos) - 5}"
        self.iface.messageBar().pushMessage(
            "Usuários sem acesso",
            f"{len(orfaos)} usuário(s) ativo(s) não têm perfil em módulo nenhum e não "
            f"conseguem usar o sistema: {nomes}. Defina o perfil na tabela e salve.",
            level=Qgis.MessageLevel.Warning
        )

    def filter_users(self):
        procurado = self.searchField.text().lower()
        for row in range(self.usersTable.rowCount()):
            nome = self.usersTable.item(row, 1).text().lower()
            login = self.usersTable.item(row, 2).text().lower()
            self.usersTable.setRowHidden(row, procurado not in nome and procurado not in login)

    # --- gravação -----------------------------------------------------------

    def _linha_alterada(self, row, user):
        """Monta o corpo desta linha e diz se algo mudou. Devolve (corpo, mudou)."""
        novo_admin = self.usersTable.cellWidget(row, 3).isChecked()
        novo_ativo = self.usersTable.cellWidget(row, 4).isChecked()

        perfis_atuais = user.get('perfis') or {}
        perfis = {}
        perfil_mudou = False
        for i, modulo in enumerate(self.modulos):
            combo = self.usersTable.cellWidget(row, len(COLUNAS_FIXAS) + i)
            escolhido = combo.currentData()
            perfis[modulo['nome_abrev']] = escolhido
            if perfis_atuais.get(modulo['nome_abrev']) != escolhido:
                perfil_mudou = True

        mudou = (bool(user.get('administrador')) != novo_admin
                 or bool(user.get('ativo')) != novo_ativo
                 or perfil_mudou)

        # `perfis` viaja SEMPRE, e o nível nulo é o que REMOVE a linha de
        # dgeo.usuario_perfil. Mandar só os módulos alterados deixaria o servidor
        # sem como distinguir "não mexa" de "tire o acesso".
        return {
            'uuid': user['uuid'],
            'administrador': novo_admin,
            'ativo': novo_ativo,
            'perfis': perfis,
        }, mudou

    def update_users(self):
        corpo = []
        alteracoes = 0
        auto_bloqueio = False
        meu_uuid = getattr(self.api_client, 'user_uuid', None)

        for row in range(self.usersTable.rowCount()):
            login = self.usersTable.item(row, 2).text()
            user = next((u for u in self.users if u['login'] == login), None)
            if not user:
                continue

            linha, mudou = self._linha_alterada(row, user)
            if mudou:
                alteracoes += 1

            # Proteção contra auto-bloqueio: o admin logado não pode remover o
            # próprio privilégio nem desativar a própria conta.
            if meu_uuid and user.get('uuid') == meu_uuid and (
                    not linha['administrador'] or not linha['ativo']):
                auto_bloqueio = True

            corpo.append(linha)

        if auto_bloqueio:
            QMessageBox.warning(
                self, "Ação bloqueada",
                "Você não pode remover seu próprio privilégio de administrador nem "
                "desativar a sua própria conta: isso o impediria de acessar esta tela.\n\n"
                "Desfaça a alteração na sua conta antes de salvar."
            )
            return

        if alteracoes == 0:
            QMessageBox.information(self, "Informação", "Nenhuma alteração a salvar.")
            return

        resposta = QMessageBox.question(
            self, "Confirmar alterações",
            f"{alteracoes} usuário(s) terão privilégio, estado ou perfil alterados. Salvar?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )
        if resposta != QMessageBox.StandardButton.Yes:
            return

        if self.api_client.put('usuarios', {'usuarios': corpo}):
            QMessageBox.information(self, "Sucesso", "Usuários atualizados.")
            self.load_users()

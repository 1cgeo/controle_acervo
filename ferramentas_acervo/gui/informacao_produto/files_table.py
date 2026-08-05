"""A tabela de arquivos de uma versão, montada e preenchida num lugar só.

As abas "Visão Geral" e "Histórico de Versões" mostram a MESMA tabela: as
mesmas colunas, a mesma caixa de seleção por linha, o mesmo botão de detalhes e
as mesmas ações de administrador. Duas cópias divergem à primeira coluna nova.
"""
import logging

from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtWidgets import (QHBoxLayout, QHeaderView, QPushButton, QTableWidget,
                                 QTableWidgetItem, QWidget)

from ..ui_utils import sortable_item

COLUNAS = ['', 'Nome', 'Tipo', 'Tamanho (MB)', 'Extensão', 'Data', 'Detalhes']
COLUNA_SELECAO = 0
COLUNA_NOME = 1
COLUNA_DETALHES = 6
COLUNA_ACOES = 7


def montar_tabela_arquivos(is_admin):
    """Cria a QTableWidget de arquivos, com a coluna de ações só para operador."""
    tabela = QTableWidget()
    cabecalho = list(COLUNAS) + (['Ações'] if is_admin else [])
    tabela.setColumnCount(len(cabecalho))
    tabela.setHorizontalHeaderLabels(cabecalho)
    tabela.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
    tabela.horizontalHeader().setSectionResizeMode(
        COLUNA_NOME, QHeaderView.ResizeMode.Stretch)
    tabela.horizontalHeader().setSectionResizeMode(
        COLUNA_DETALHES, QHeaderView.ResizeMode.ResizeToContents)
    if is_admin:
        tabela.horizontalHeader().setSectionResizeMode(
            COLUNA_ACOES, QHeaderView.ResizeMode.ResizeToContents)
    return tabela


def preencher_tabela_arquivos(tabela, arquivos, is_admin, criar_acoes=None,
                              ao_pedir_detalhes=None, formatar_data=str):
    """Enche a tabela com os arquivos da versão.

    `criar_acoes(arquivo)` devolve o widget de Editar/Excluir e só é chamado
    para operador. `ao_pedir_detalhes(arquivo)` é ligado ao botão Detalhes de
    cada linha: ligá-lo AQUI é o que faz o botão funcionar, porque a tabela só
    tem linha depois deste método.
    """
    tabela.setSortingEnabled(False)
    tabela.setRowCount(0)

    for linha, arquivo in enumerate(arquivos):
        tabela.insertRow(linha)

        selecao = QTableWidgetItem()
        selecao.setFlags(Qt.ItemFlag.ItemIsUserCheckable | Qt.ItemFlag.ItemIsEnabled)
        selecao.setCheckState(Qt.CheckState.Unchecked)
        tabela.setItem(linha, COLUNA_SELECAO, selecao)

        item_nome = QTableWidgetItem(arquivo['nome'])
        # O id do arquivo viaja no UserRole: é por ele que o download e a tela
        # de detalhes reencontram o registro.
        item_nome.setData(Qt.ItemDataRole.UserRole, arquivo['id'])
        tabela.setItem(linha, COLUNA_NOME, item_nome)

        tabela.setItem(linha, 2, QTableWidgetItem(arquivo['tipo_arquivo']))

        tamanho = arquivo.get('tamanho_mb')
        # Ordena pelo número, e não pelo texto: por texto "9,50" fica depois de
        # "10,00".
        tabela.setItem(linha, 3, sortable_item(
            f"{float(tamanho):.2f}" if tamanho else "N/A", float(tamanho or 0)))

        tabela.setItem(linha, 4, QTableWidgetItem(arquivo.get('extensao') or "N/A"))
        data = arquivo.get('data_cadastramento') or ''
        tabela.setItem(linha, 5, sortable_item(formatar_data(data), data))

        botao = QPushButton("Detalhes")
        if ao_pedir_detalhes is not None:
            botao.clicked.connect(
                lambda _=False, a=arquivo: ao_pedir_detalhes(a)
            )
        tabela.setCellWidget(linha, COLUNA_DETALHES, botao)

        if is_admin and criar_acoes is not None:
            try:
                acoes = criar_acoes(arquivo)
            except Exception:
                logging.exception("Falha ao montar as ações do arquivo %s", arquivo.get('id'))
                acoes = _acoes_com_erro()
            if acoes is not None:
                tabela.setCellWidget(linha, COLUNA_ACOES, acoes)

    tabela.resizeColumnsToContents()
    tabela.horizontalHeader().setSectionResizeMode(
        COLUNA_NOME, QHeaderView.ResizeMode.Stretch)
    tabela.setSortingEnabled(True)


def ids_marcados(tabela):
    """Os ids dos arquivos com a caixa marcada, na ordem da tabela."""
    ids = []
    for linha in range(tabela.rowCount()):
        selecao = tabela.item(linha, COLUNA_SELECAO)
        nome = tabela.item(linha, COLUNA_NOME)
        if selecao is None or nome is None:
            continue
        if selecao.checkState() == Qt.CheckState.Checked:
            arquivo_id = nome.data(Qt.ItemDataRole.UserRole)
            if arquivo_id:
                ids.append(arquivo_id)
    return ids


def marcar_todos(tabela, marcar):
    for linha in range(tabela.rowCount()):
        item = tabela.item(linha, COLUNA_SELECAO)
        if item is not None:
            item.setCheckState(Qt.CheckState.Checked if marcar else Qt.CheckState.Unchecked)


def _acoes_com_erro():
    widget = QWidget()
    layout = QHBoxLayout(widget)
    layout.setContentsMargins(0, 0, 0, 0)
    botao = QPushButton("Erro")
    botao.setToolTip("Não foi possível montar as ações deste arquivo. Veja o log do QGIS.")
    botao.setEnabled(False)
    layout.addWidget(botao)
    return widget

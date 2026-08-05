# Path: gui\ui_utils.py
"""Helpers de UI compartilhados entre os diálogos do plugin.

Centraliza os idiomas que apareceriam copiados em vários diálogos: ordenação
correta de colunas (texto exibido mais chave de ordenação própria), habilitação
de botões por seleção e exportação da tabela para CSV.

A formatação de falha de transferência NÃO mora aqui: ela é da máquina de
upload (core/upload_flow.py).
"""
import csv

from qgis.PyQt.QtWidgets import QFileDialog, QMessageBox, QTableWidgetItem


class SortableTableItem(QTableWidgetItem):
    """Item de tabela que exibe um texto mas ordena por uma chave própria
    (numérica ou data ISO).

    Não usar ``setData(EditRole, chave)``: em ``QTableWidgetItem`` o EditRole e
    o DisplayRole compartilham o mesmo dado, então definir o EditRole
    sobrescreveria o texto exibido (a célula passaria a mostrar a chave crua).
    A ordenação é feita por ``__lt__``, que o ``QTableWidget`` invoca através do
    ``operator<`` virtual.
    """

    def __init__(self, display_text, sort_key):
        super().__init__(display_text)
        self._sort_key = sort_key

    def __lt__(self, other):
        try:
            return self._sort_key < other._sort_key
        except (AttributeError, TypeError):
            # Coluna mista (item sem chave) ou chaves de tipos incompatíveis:
            # cai na comparação padrão por texto exibido
            return super().__lt__(other)


def sortable_item(display_text, sort_key):
    """Item que exibe display_text e ordena por sort_key (numérico/data ISO),
    evitando ordenação lexicográfica de números e datas."""
    return SortableTableItem(display_text, sort_key)


def sortable_int_item(value):
    """Item para uma coluna inteira (ex.: ID): exibe o número e ordena
    numericamente, tratando None como célula vazia / chave 0."""
    return SortableTableItem(
        str(value) if value is not None else '',
        int(value) if value is not None else 0
    )


def wire_single_selection_buttons(table, *buttons):
    """Desabilita os botões e os habilita apenas quando há exatamente uma linha
    selecionada na tabela (affordance preventiva para Editar/Excluir)."""
    def _update():
        enabled = len(table.selectionModel().selectedRows()) == 1
        for button in buttons:
            button.setEnabled(enabled)

    for button in buttons:
        button.setEnabled(False)
    table.itemSelectionChanged.connect(_update)
    return _update


def exportar_tabela_csv(dialogo, tabela, nome_sugerido='exportacao.csv'):
    """Grava o CONTEÚDO VISÍVEL de um QTableWidget num CSV escolhido pelo usuário.

    Exporta o que está na tela, e nada além: numa tela paginada isso é a página
    atual. Quando o servidor oferece uma rota de CSV do conjunto inteiro, use a
    rota, porque exportar só a página engana quem lê o arquivo.
    """
    if tabela.rowCount() == 0:
        QMessageBox.warning(dialogo, "Aviso", "Não há dados para exportar.")
        return None

    caminho, _ = QFileDialog.getSaveFileName(
        dialogo, "Exportar para CSV", nome_sugerido, "Arquivos CSV (*.csv)"
    )
    if not caminho:
        return None

    try:
        with open(caminho, 'w', newline='', encoding='utf-8-sig') as arquivo:
            escritor = csv.writer(arquivo)
            escritor.writerow([
                tabela.horizontalHeaderItem(coluna).text() if tabela.horizontalHeaderItem(coluna)
                else ''
                for coluna in range(tabela.columnCount())
            ])
            for linha in range(tabela.rowCount()):
                if tabela.isRowHidden(linha):
                    continue
                escritor.writerow([
                    tabela.item(linha, coluna).text() if tabela.item(linha, coluna) else ''
                    for coluna in range(tabela.columnCount())
                ])
    except OSError as e:
        QMessageBox.critical(
            dialogo, "Erro",
            f"Não foi possível gravar o arquivo:\n{e}\n\n"
            "Escolha outra pasta ou feche o arquivo, se ele estiver aberto noutro programa."
        )
        return None

    QMessageBox.information(dialogo, "Sucesso", f"Dados exportados para:\n{caminho}")
    return caminho

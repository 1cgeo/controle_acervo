# Path: gui\ui_utils.py
"""Helpers de UI compartilhados entre os diálogos do plugin.

Centraliza pequenos idiomas que apareciam copiados em vários diálogos:
ordenação correta de colunas (texto exibido + chave de ordenação própria),
habilitação de botões por seleção e formatação de causas de falha de
transferência.
"""
from qgis.PyQt.QtWidgets import QTableWidgetItem


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


def format_failure_causes(failed_transfers):
    """Monta o trecho '\\n\\nCausa(s):...' a partir das causas distintas dos
    arquivos que falharam (ou '' quando nenhuma causa foi registrada)."""
    causas = sorted({f.get('error') for f in failed_transfers if f.get('error')})
    if not causas:
        return ""
    return "\n\nCausa(s):\n" + "\n".join(f"- {c}" for c in causas)


def transfer_error_text(filename, error_msg):
    """Texto de status para uma falha de transferência de um arquivo."""
    if error_msg:
        return f"Erro ao transferir {filename}: {error_msg}"
    return f"Erro na transferência de {filename}"

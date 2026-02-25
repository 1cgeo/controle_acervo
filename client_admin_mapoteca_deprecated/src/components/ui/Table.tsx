// Path: components\ui\Table.tsx
import React, { useState, useEffect } from 'react';
import {
  Paper,
  Table as MuiTable,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TableSortLabel,
  IconButton,
  Toolbar,
  Typography,
  Tooltip,
  TextField,
  InputAdornment,
  Box,
  Checkbox,
  LinearProgress,
  useTheme,
  alpha,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { CsvBuilder } from 'filefy';

// Define column structure
interface Column {
  id: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  priority?: number;
  format?: (value: any) => React.ReactNode;
}

// Define action structure
interface Action {
  icon: React.ReactNode;
  tooltip: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>, selectedRows: any[]) => void;
  isFreeAction?: boolean;
}

// Define table options
interface TableOptions {
  selection?: boolean;
  search?: boolean;
  exportButton?: boolean;
  paging?: boolean;
  sorting?: boolean;
  pageSize?: number;
  pageSizeOptions?: number[];
  headerStyle?: React.CSSProperties;
  padding?: 'normal' | 'none' | 'checkbox' | 'dense';
  actionsColumnIndex?: number;
}

// Define editable options
interface EditableOptions {
  isEditable?: (row: any) => boolean;
  isDeletable?: (row: any) => boolean;
  onRowAdd?: (newData: any) => Promise<any>;
  onRowUpdate?: (newData: any) => Promise<any>;
  onRowDelete?: (oldData: any) => Promise<any>;
  editTooltip?: string;
  deleteTooltip?: string;
  addTooltip?: string;
}

// Define component overrides
interface ComponentOverrides {
  EditField?: React.ComponentType<any>;
}

interface TableProps {
  title?: string;
  columns: Column[];
  rows: any[];
  isLoading?: boolean;
  rowKey?: string | ((row: any) => string | number);
  actions?: Action[];
  actionGetter?: (row: any) => Action[];
  emptyMessage?: string;
  searchPlaceholder?: string;
  options?: TableOptions;
  editable?: EditableOptions;
  onRowClick?: (row: any) => void;
  onSelectionChange?: (rows: any[]) => void;
  selectedRows?: any[];
  components?: ComponentOverrides;
  exportData?: (data: any[]) => void;
  stickyHeader?: boolean;
}

export const Table: React.FC<TableProps> = ({
  title,
  columns,
  rows,
  isLoading = false,
  rowKey = 'id',
  actions = [],
  actionGetter,
  emptyMessage = 'Nenhum dado encontrado',
  searchPlaceholder = 'Buscar...',
  options = {},
  editable,
  onRowClick,
  onSelectionChange,
  selectedRows = [],
  components,
  exportData,
  stickyHeader = false,
}) => {
  const theme = useTheme();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(options.pageSize || 10);
  const [search, setSearch] = useState('');
  const [orderBy, setOrderBy] = useState<string | null>(null);
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<any[]>(selectedRows || []);
  const [editingRow, setEditingRow] = useState<any | null>(null);
  const [newRow, setNewRow] = useState<any | null>(null);

  // Update selected state when selectedRows prop changes
  useEffect(() => {
    setSelected(selectedRows || []);
  }, [selectedRows]);

  // Default options
  const defaultOptions: TableOptions = {
    selection: false,
    search: true,
    exportButton: false,
    paging: true,
    sorting: true,
    ...options,
  };

  // Filter rows based on search text
  const filteredRows = rows.filter(row => {
    if (!search) return true;
    const searchText = search.toLowerCase();
    return columns.some(column => {
      const value = row[column.id];
      if (value === null || value === undefined) return false;
      return String(value).toLowerCase().includes(searchText);
    });
  });

  // Sort rows
  const sortedRows = React.useMemo(() => {
    if (!orderBy) return filteredRows;

    return [...filteredRows].sort((a, b) => {
      const aValue = a[orderBy];
      const bValue = b[orderBy];

      if (aValue === bValue) return 0;
      if (aValue === null || aValue === undefined) return order === 'asc' ? -1 : 1;
      if (bValue === null || bValue === undefined) return order === 'asc' ? 1 : -1;

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return order === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      return order === 'asc'
        ? aValue < bValue ? -1 : 1
        : aValue < bValue ? 1 : -1;
    });
  }, [filteredRows, orderBy, order]);

  // Get current page rows
  const currentPageRows = React.useMemo(() => {
    if (!defaultOptions.paging) return sortedRows;
    const start = page * rowsPerPage;
    const end = start + rowsPerPage;
    return sortedRows.slice(start, end);
  }, [sortedRows, page, rowsPerPage, defaultOptions.paging]);

  // Get row key
  const getRowKey = (row: any): string | number => {
    if (typeof rowKey === 'function') {
      return rowKey(row);
    }
    return row[rowKey];
  };

  // Check if row is selected
  const isSelected = (row: any): boolean => {
    return selected.some(s => getRowKey(s) === getRowKey(row));
  };

  // Handle row click
  const handleRowClick = (row: any) => {
    if (onRowClick) {
      onRowClick(row);
    }
  };

  // Handle selection
  const handleSelect = (row: any) => {
    const key = getRowKey(row);
    const newSelected = isSelected(row)
      ? selected.filter(s => getRowKey(s) !== key)
      : [...selected, row];
    
    setSelected(newSelected);
    
    if (onSelectionChange) {
      onSelectionChange(newSelected);
    }
  };

  // Handle select all
  const handleSelectAll = () => {
    if (selected.length === currentPageRows.length) {
      setSelected([]);
      if (onSelectionChange) {
        onSelectionChange([]);
      }
    } else {
      setSelected(currentPageRows);
      if (onSelectionChange) {
        onSelectionChange(currentPageRows);
      }
    }
  };

  // Handle sort request
  const handleSort = (property: string) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  // Handle page change
  const handleChangePage = (_: unknown, newPage: number) => {
    setPage(newPage);
  };

  // Handle rows per page change
  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  // Handle search change
  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
    setPage(0);
  };

  // Clear search
  const handleClearSearch = () => {
    setSearch('');
  };

  // Handle export to CSV
  const handleExport = () => {
    if (exportData) {
      exportData(filteredRows);
      return;
    }

    const headers = columns.map(column => column.label);
    const data = filteredRows.map(row =>
      columns.map(column => {
        const value = row[column.id];
        return value !== null && value !== undefined ? String(value) : '';
      })
    );

    new CsvBuilder(`export_${new Date().toISOString()}.csv`)
      .setDelimeter(',')
      .setColumns(headers)
      .addRows(data)
      .exportFile();
  };

  // Row actions
  const renderRowActions = (row: any) => {
    const rowActions = actionGetter ? actionGetter(row) : [];
    const allActions = [
      ...rowActions,
      ...(editable?.isEditable && editable.isEditable(row)
        ? [
            {
              icon: <EditIcon />,
              tooltip: editable.editTooltip || 'Editar',
              onClick: () => setEditingRow(row),
            },
          ]
        : []),
      ...(editable?.isDeletable && editable.isDeletable(row)
        ? [
            {
              icon: <DeleteIcon />,
              tooltip: editable.deleteTooltip || 'Remover',
              onClick: async () => {
                if (editable.onRowDelete) {
                  try {
                    await editable.onRowDelete(row);
                  } catch (error) {
                    console.error('Error deleting row:', error);
                  }
                }
              },
            },
          ]
        : []),
      ...actions.filter(action => !action.isFreeAction),
    ];

    if (allActions.length === 0) return null;

    return (
      <TableCell align="right" padding="none">
        {allActions.map((action, index) => (
          <Tooltip key={index} title={action.tooltip}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                if (typeof action.onClick === 'function') {
                  action.onClick(e, [row]);
                }
              }}
            >
              {action.icon}
            </IconButton>
          </Tooltip>
        ))}
      </TableCell>
    );
  };

  // Toolbar actions
  const renderToolbarActions = () => {
    const toolbarActions = [
      ...(defaultOptions.search
        ? [
            <Box key="search" sx={{ position: 'relative', marginRight: 1 }}>
              <TextField
                variant="outlined"
                size="small"
                placeholder={searchPlaceholder}
                value={search}
                onChange={handleSearchChange}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  ),
                  endAdornment: search ? (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={handleClearSearch}
                        edge="end"
                      >
                        <CloseIcon />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                }}
              />
            </Box>,
          ]
        : []),
      ...(defaultOptions.exportButton
        ? [
            <Tooltip key="export" title="Exportar">
              <IconButton onClick={handleExport}>
                <Box component="span" sx={{ fontSize: '1.25rem' }}>
                  📊
                </Box>
              </IconButton>
            </Tooltip>,
          ]
        : []),
      ...actions
        .filter(action => action.isFreeAction)
        .map((action, index) => (
          <Tooltip key={`free-action-${index}`} title={action.tooltip}>
            <IconButton
              onClick={(e) => action.onClick(e, selected)}
              color="primary"
            >
              {action.icon}
            </IconButton>
          </Tooltip>
        )),
      ...(editable?.onRowAdd
        ? [
            <Tooltip
              key="add"
              title={editable.addTooltip || 'Adicionar'}
            >
              <IconButton
                color="primary"
                onClick={() => setNewRow({})}
              >
                <AddIcon />
              </IconButton>
            </Tooltip>,
          ]
        : []),
    ];

    return <Box sx={{ display: 'flex', alignItems: 'center' }}>{toolbarActions}</Box>;
  };

  return (
    <Paper sx={{ width: '100%', mb: 2, overflow: 'hidden' }}>
      {/* Toolbar with title and actions */}
      <Toolbar
        sx={{
          pl: { sm: 2 },
          pr: { sm: 1 },
          ...(selected.length > 0 && {
            bgcolor: (theme) =>
              alpha(
                theme.palette.primary.main,
                theme.palette.action.activatedOpacity
              ),
          }),
        }}
      >
        {selected.length > 0 ? (
          <Typography
            sx={{ flex: '1 1 100%' }}
            color="inherit"
            variant="subtitle1"
            component="div"
          >
            {selected.length} selecionado(s)
          </Typography>
        ) : (
          <Typography
            sx={{ flex: '1 1 100%' }}
            variant="h6"
            id="tableTitle"
            component="div"
          >
            {title}
          </Typography>
        )}
        {renderToolbarActions()}
      </Toolbar>

      {/* Loading progress */}
      {isLoading && (
        <LinearProgress />
      )}

      {/* Table container */}
      <TableContainer sx={{ maxHeight: stickyHeader ? 600 : undefined }}>
        <MuiTable
          sx={{ minWidth: 750 }}
          size={options.padding || 'medium'}
          stickyHeader={stickyHeader}
        >
          <TableHead>
            <TableRow>
              {/* Selection checkbox column */}
              {defaultOptions.selection && (
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={
                      selected.length > 0 && selected.length < currentPageRows.length
                    }
                    checked={
                      currentPageRows.length > 0 && selected.length === currentPageRows.length
                    }
                    onChange={handleSelectAll}
                  />
                </TableCell>
              )}

              {/* Column headers */}
              {columns.map((column) => (
                <TableCell
                  key={column.id}
                  align={column.align || 'left'}
                  padding={options.padding || 'normal'}
                  sortDirection={orderBy === column.id ? order : false}
                  sx={{
                    ...(options.headerStyle || {}),
                  }}
                >
                  {column.sortable !== false && defaultOptions.sorting ? (
                    <TableSortLabel
                      active={orderBy === column.id}
                      direction={orderBy === column.id ? order : 'asc'}
                      onClick={() => handleSort(column.id)}
                    >
                      {column.label}
                    </TableSortLabel>
                  ) : (
                    column.label
                  )}
                </TableCell>
              ))}

              {/* Actions column */}
              {(actions.length > 0 || editable) && (
                <TableCell align="right" padding="none">
                  Ações
                </TableCell>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {/* Empty state */}
            {currentPageRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={
                    columns.length +
                    (defaultOptions.selection ? 1 : 0) +
                    ((actions.length > 0 || editable) ? 1 : 0)
                  }
                  align="center"
                  sx={{ py: 3 }}
                >
                  {isLoading ? 'Carregando...' : emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              // Table rows
              currentPageRows.map((row) => {
                const isItemSelected = isSelected(row);
                return (
                  <TableRow
                    hover
                    onClick={() => handleRowClick(row)}
                    role="checkbox"
                    aria-checked={isItemSelected}
                    tabIndex={-1}
                    key={getRowKey(row)}
                    selected={isItemSelected}
                    sx={{ cursor: 'pointer' }}
                  >
                    {/* Selection checkbox */}
                    {defaultOptions.selection && (
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={isItemSelected}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelect(row);
                          }}
                        />
                      </TableCell>
                    )}

                    {/* Row data */}
                    {columns.map((column) => {
                      const value = row[column.id];
                      return (
                        <TableCell
                          key={column.id}
                          align={column.align || 'left'}
                          padding={options.padding || 'normal'}
                        >
                          {column.format ? column.format(value) : value}
                        </TableCell>
                      );
                    })}

                    {/* Row actions */}
                    {(actions.length > 0 || editable) && renderRowActions(row)}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </MuiTable>
      </TableContainer>

      {/* Pagination */}
      {defaultOptions.paging && (
        <TablePagination
          rowsPerPageOptions={options.pageSizeOptions || [5, 10, 25, 50]}
          component="div"
          count={filteredRows.length}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          labelRowsPerPage="Linhas por página:"
          labelDisplayedRows={({ from, to, count }) => `${from}-${to} de ${count}`}
        />
      )}
    </Paper>
  );
};
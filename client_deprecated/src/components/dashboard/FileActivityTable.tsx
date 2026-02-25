import { useState, useEffect } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Skeleton,
  TablePagination,
  Chip,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  RecentFileResponse,
  DeletedFileResponse,
  DownloadResponse,
} from '@/services/dashboardService';

interface FileActivityTableProps {
  data: RecentFileResponse[] | DeletedFileResponse[] | DownloadResponse[];
  isLoading: boolean;
  title: string;
  emptyMessage: string;
  isDeleted?: boolean;
  isDownload?: boolean;
}

export const FileActivityTable = ({
  data,
  isLoading,
  title,
  emptyMessage,
  isDeleted = false,
  isDownload = false,
}: FileActivityTableProps) => {
  // Pagination state
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(5);

  // Reset page when data changes
  useEffect(() => {
    setPage(0);
  }, [data]);

  // Handle pagination
  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  // Format date for display
  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  if (isLoading) {
    return (
      <Box>
        <Skeleton variant="text" width="30%" height={40} />
        <Skeleton variant="rectangular" height={200} />
      </Box>
    );
  }

  if (data.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="body1" color="text.secondary">
          {emptyMessage}
        </Typography>
      </Box>
    );
  }

  // Display for download history
  if (isDownload) {
    const downloadData = data as DownloadResponse[];
    const displayData = downloadData.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

    return (
      <Box>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>ID do Arquivo</TableCell>
                <TableCell>Data de Download</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {displayData.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.id}</TableCell>
                  <TableCell>{item.arquivo_id}</TableCell>
                  <TableCell>{formatDate(item.data_download)}</TableCell>
                  <TableCell>
                    <Chip
                      label={item.apagado ? 'Arquivo Excluído' : 'Disponível'}
                      color={item.apagado ? 'error' : 'success'}
                      size="small"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          rowsPerPageOptions={[5, 10, 25]}
          component="div"
          count={data.length}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
        />
      </Box>
    );
  }

  // Display for regular files (uploads, modifications) or deleted files
  const fileData = data as (RecentFileResponse | DeletedFileResponse)[];
  const displayData = fileData.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Box>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Nome</TableCell>
              <TableCell>Tamanho</TableCell>
              <TableCell>Tipo</TableCell>
              <TableCell>Data</TableCell>
              {isDeleted && <TableCell>Motivo da Exclusão</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {displayData.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <Tooltip title={item.nome_arquivo} arrow>
                    <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                      {item.nome}
                    </Typography>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  {item.tamanho_mb ? `${item.tamanho_mb.toFixed(2)} MB` : 'N/A'}
                </TableCell>
                <TableCell>{item.extensao || 'N/A'}</TableCell>
                <TableCell>
                  {isDeleted
                    ? formatDate((item as DeletedFileResponse).data_delete)
                    : formatDate(item.data_cadastramento)}
                </TableCell>
                {isDeleted && (
                  <TableCell>
                    <Tooltip title={(item as DeletedFileResponse).motivo_exclusao || ''} arrow>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                        {(item as DeletedFileResponse).motivo_exclusao || 'N/A'}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        rowsPerPageOptions={[5, 10, 25]}
        component="div"
        count={data.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
      />
    </Box>
  );
};
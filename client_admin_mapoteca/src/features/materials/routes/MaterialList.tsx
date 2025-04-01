// Path: features\materials\routes\MaterialList.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Paper,
  Tooltip,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DeleteIcon from '@mui/icons-material/Delete';
import { useConfirm } from 'material-ui-confirm';
import { Table } from '@/components/ui/Table';
import Page from '@/components/Page/Page';
import Loading from '@/components/ui/Loading';
import { useMapotecaMaterials } from '@/hooks/useMapotecaMaterials';
import MaterialAddEditDialog from '../components/MaterialAddEditDialog';
import { MaterialType } from '@/types/material';

const MaterialList = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { materialTypes, isLoadingMaterialTypes, deleteMaterialTypes } = useMapotecaMaterials();
  const [selectedMaterials, setSelectedMaterials] = useState<MaterialType[]>([]);
  const [openDialog, setOpenDialog] = useState(false);

  const handleViewMaterial = (material: MaterialType) => {
    navigate(`/materiais/${material.id}`);
  };

  const handleAddMaterial = () => {
    setOpenDialog(true);
  };

  const handleDeleteMaterials = async (materialsToDelete: MaterialType[]) => {
    try {
      await confirm({
        title: 'Confirmar exclusão',
        description: `Você tem certeza que deseja excluir ${materialsToDelete.length > 1 ? 'estes tipos de material' : 'este tipo de material'}?`,
        confirmationText: 'Excluir',
        confirmationButtonProps: { color: 'error' },
      });

      await deleteMaterialTypes(materialsToDelete.map(material => material.id));
    } catch (error) {
      // User canceled the action or there was an error
      console.error('Error deleting material types:', error);
    }
  };

  const columns = [
    { id: 'id', label: 'ID', align: 'right' as const, sortable: true, priority: 5 },
    { id: 'nome', label: 'Nome', align: 'left' as const, sortable: true, priority: 5 },
    { 
      id: 'descricao', 
      label: 'Descrição', 
      align: 'left' as const, 
      sortable: true, 
      priority: 4,
      format: (value: string) => value || '-'
    },
    { 
      id: 'estoque_total', 
      label: 'Estoque Total', 
      align: 'right' as const, 
      sortable: true, 
      priority: 4,
      format: (value: number) => value?.toFixed(2) || '0.00'
    },
    { 
      id: 'localizacoes_armazenadas', 
      label: 'Localizações', 
      align: 'center' as const, 
      sortable: true, 
      priority: 3,
    },
  ];

  const actions = [
    {
      icon: <VisibilityIcon />,
      tooltip: 'Ver detalhes',
      onClick: (_: any, selectedRows: MaterialType[]) => handleViewMaterial(selectedRows[0])
    },
    {
      icon: <DeleteIcon />,
      tooltip: 'Excluir',
      onClick: (_: any, selectedRows: MaterialType[]) => handleDeleteMaterials(selectedRows)
    },
    {
      icon: <AddIcon />,
      tooltip: 'Adicionar Material',
      isFreeAction: true,
      onClick: handleAddMaterial
    }
  ];

  if (isLoadingMaterialTypes && materialTypes.length === 0) {
    return <Loading />;
  }

  return (
    <Page title="Materiais | Mapoteca Admin">
      <Container maxWidth="xl" sx={{ py: 3 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Typography variant="h4" component="h1">
            Tipos de Material
          </Typography>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={handleAddMaterial}
          >
            Novo Material
          </Button>
        </Box>

        <Paper sx={{ width: '100%', mb: 2 }}>
          <Table
            title="Materiais"
            columns={columns}
            rows={materialTypes}
            isLoading={isLoadingMaterialTypes}
            actions={actions}
            emptyMessage="Nenhum tipo de material encontrado"
            searchPlaceholder="Buscar material..."
            onSelectionChange={setSelectedMaterials}
            options={{
              selection: true,
              exportButton: true,
              actionsColumnIndex: -1,
            }}
          />
        </Paper>

        {/* Add/Edit Dialog */}
        <MaterialAddEditDialog
          open={openDialog}
          onClose={() => setOpenDialog(false)}
        />
      </Container>
    </Page>
  );
};

export default MaterialList;
// Path: features\materials\components\MaterialAddEditDialog.tsx
import { useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Grid,
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MaterialType, MaterialTypeCreateRequest, MaterialTypeUpdateRequest } from '@/types/material';
import { useMapotecaMaterials } from '@/hooks/useMapotecaMaterials';

interface MaterialAddEditDialogProps {
  open: boolean;
  material?: MaterialType;
  onClose: () => void;
}

// Form validation schema
const materialSchema = z.object({
  id: z.number().optional(),
  nome: z.string().min(1, 'Nome é obrigatório'),
  descricao: z.string().optional(),
});

type FormValues = z.infer<typeof materialSchema>;

const MaterialAddEditDialog = ({
  open,
  material,
  onClose,
}: MaterialAddEditDialogProps) => {
  const { createMaterialType, updateMaterialType, isCreatingMaterialType, isUpdatingMaterialType } = useMapotecaMaterials();

  const {
    control,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
  } = useForm<FormValues>({
    resolver: zodResolver(materialSchema),
    defaultValues: {
      nome: '',
      descricao: '',
    },
  });

  // Set form values when material data changes
  useEffect(() => {
    if (material) {
      setValue('id', material.id);
      setValue('nome', material.nome);
      setValue('descricao', material.descricao || '');
    } else {
      reset({
        nome: '',
        descricao: '',
      });
    }
  }, [material, setValue, reset]);

  const handleClose = () => {
    reset();
    onClose();
  };

  const onSubmit = async (data: FormValues) => {
    try {
      if (material) {
        // Update existing material
        const updateData: MaterialTypeUpdateRequest = {
          id: material.id,
          nome: data.nome,
          descricao: data.descricao,
        };
        await updateMaterialType(updateData);
      } else {
        // Create new material
        const createData: MaterialTypeCreateRequest = {
          nome: data.nome,
          descricao: data.descricao,
        };
        await createMaterialType(createData);
      }
      handleClose();
    } catch (error) {
      console.error('Error saving material:', error);
    }
  };

  const isProcessing = isCreatingMaterialType || isUpdatingMaterialType;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      aria-labelledby="material-dialog-title"
      maxWidth="md"
      fullWidth
    >
      <DialogTitle id="material-dialog-title">
        {material ? 'Editar Material' : 'Adicionar Material'}
      </DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Controller
                name="nome"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Nome"
                    fullWidth
                    margin="normal"
                    error={!!errors.nome}
                    helperText={errors.nome?.message}
                    disabled={isProcessing}
                  />
                )}
              />
            </Grid>

            <Grid item xs={12}>
              <Controller
                name="descricao"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Descrição"
                    fullWidth
                    margin="normal"
                    multiline
                    rows={3}
                    error={!!errors.descricao}
                    helperText={errors.descricao?.message}
                    disabled={isProcessing}
                  />
                )}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={isProcessing}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={isProcessing}
          >
            {isProcessing
              ? material
                ? 'Atualizando...'
                : 'Criando...'
              : material
              ? 'Atualizar'
              : 'Criar'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default MaterialAddEditDialog;
// Path: features\materials\components\StockAddDialog.tsx
import { useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  SelectChangeEvent,
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { StockItemCreateRequest, StockItemUpdateRequest } from '@/types/material';
import { useMapotecaMaterials } from '@/hooks/useMapotecaMaterials';

// Schema for stock creation/editing
const stockSchema = z.object({
  id: z.number().optional(),
  tipo_material_id: z.number().int().positive('Tipo de material é obrigatório'),
  localizacao_id: z.number().int().positive('Localização é obrigatória'),
  quantidade: z.number().positive('Quantidade deve ser positiva'),
});

type StockFormValues = z.infer<typeof stockSchema>;

interface StockAddDialogProps {
  open: boolean;
  onClose: () => void;
  stockItem?: {
    id: number;
    tipo_material_id: number;
    localizacao_id: number;
    quantidade: number;
  };
  materialId?: number; // Optional: pre-select material ID
}

const StockAddDialog = ({
  open,
  onClose,
  stockItem,
  materialId,
}: StockAddDialogProps) => {
  const {
    materialTypes,
    locationTypes,
    createStockItem,
    updateStockItem,
    isCreatingStockItem,
    isUpdatingStockItem,
  } = useMapotecaMaterials();

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<StockFormValues>({
    resolver: zodResolver(stockSchema),
    defaultValues: {
      tipo_material_id: materialId || 0,
      localizacao_id: 0,
      quantidade: 0,
    },
  });

  // Set form values when stock data changes
  useEffect(() => {
    if (stockItem) {
      setValue('id', stockItem.id);
      setValue('tipo_material_id', stockItem.tipo_material_id);
      setValue('localizacao_id', stockItem.localizacao_id);
      setValue('quantidade', stockItem.quantidade);
    } else if (materialId) {
      setValue('tipo_material_id', materialId);
      setValue('localizacao_id', 0);
      setValue('quantidade', 0);
    } else {
      reset({
        tipo_material_id: 0,
        localizacao_id: 0,
        quantidade: 0,
      });
    }
  }, [stockItem, materialId, setValue, reset, open]);

  const isProcessing = isCreatingStockItem || isUpdatingStockItem;

  const onSubmit = async (data: StockFormValues) => {
    try {
      if (stockItem) {
        // Update existing stock
        const updateData: StockItemUpdateRequest = {
          id: stockItem.id,
          tipo_material_id: data.tipo_material_id,
          localizacao_id: data.localizacao_id,
          quantidade: data.quantidade,
        };
        await updateStockItem(updateData);
      } else {
        // Create new stock
        const createData: StockItemCreateRequest = {
          tipo_material_id: data.tipo_material_id,
          localizacao_id: data.localizacao_id,
          quantidade: data.quantidade,
        };
        await createStockItem(createData);
      }
      handleClose();
    } catch (error) {
      console.error('Error saving stock item:', error);
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogTitle>
          {stockItem ? 'Editar Estoque' : 'Adicionar Estoque'}
        </DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Controller
                name="tipo_material_id"
                control={control}
                render={({ field }) => (
                  <FormControl
                    fullWidth
                    margin="normal"
                    error={!!errors.tipo_material_id}
                    disabled={!!materialId}
                  >
                    <InputLabel>Tipo de Material</InputLabel>
                    <Select
                      {...field}
                      value={field.value || 0}
                      onChange={(e: SelectChangeEvent<number>) => {
                        field.onChange(Number(e.target.value));
                      }}
                      label="Tipo de Material"
                    >
                      <MenuItem value={0} disabled>
                        Selecione o tipo de material
                      </MenuItem>
                      {materialTypes.map((type) => (
                        <MenuItem key={type.id} value={type.id}>
                          {type.nome}
                        </MenuItem>
                      ))}
                    </Select>
                    {errors.tipo_material_id && (
                      <FormHelperText>
                        {errors.tipo_material_id.message}
                      </FormHelperText>
                    )}
                  </FormControl>
                )}
              />
            </Grid>

            <Grid item xs={12}>
              <Controller
                name="localizacao_id"
                control={control}
                render={({ field }) => (
                  <FormControl
                    fullWidth
                    margin="normal"
                    error={!!errors.localizacao_id}
                  >
                    <InputLabel>Localização</InputLabel>
                    <Select
                      {...field}
                      value={field.value || 0}
                      onChange={(e: SelectChangeEvent<number>) => {
                        field.onChange(Number(e.target.value));
                      }}
                      label="Localização"
                    >
                      <MenuItem value={0} disabled>
                        Selecione a localização
                      </MenuItem>
                      {locationTypes.map((type) => (
                        <MenuItem key={type.code} value={type.code}>
                          {type.nome}
                        </MenuItem>
                      ))}
                    </Select>
                    {errors.localizacao_id && (
                      <FormHelperText>
                        {errors.localizacao_id.message}
                      </FormHelperText>
                    )}
                  </FormControl>
                )}
              />
            </Grid>

            <Grid item xs={12}>
              <Controller
                name="quantidade"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Quantidade"
                    fullWidth
                    margin="normal"
                    type="number"
                    inputProps={{ step: "0.01", min: "0.01" }}
                    onChange={(e) => field.onChange(parseFloat(e.target.value))}
                    error={!!errors.quantidade}
                    helperText={errors.quantidade?.message}
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
              ? stockItem
                ? 'Atualizando...'
                : 'Adicionando...'
              : stockItem
              ? 'Atualizar'
              : 'Adicionar'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default StockAddDialog;
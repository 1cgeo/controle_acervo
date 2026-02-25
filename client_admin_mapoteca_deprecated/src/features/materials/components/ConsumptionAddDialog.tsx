// Path: features\materials\components\ConsumptionAddDialog.tsx
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
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { ptBR } from 'date-fns/locale';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ConsumptionItemCreateRequest, ConsumptionItemUpdateRequest } from '@/types/material';
import { useMapotecaMaterials } from '@/hooks/useMapotecaMaterials';

// Schema for consumption creation/editing
const consumptionSchema = z.object({
  id: z.number().optional(),
  tipo_material_id: z.number().int().positive('Tipo de material é obrigatório'),
  quantidade: z.number().positive('Quantidade deve ser positiva'),
  data_consumo: z.date(),
});

type ConsumptionFormValues = z.infer<typeof consumptionSchema>;

interface ConsumptionAddDialogProps {
  open: boolean;
  onClose: () => void;
  consumptionItem?: {
    id: number;
    tipo_material_id: number;
    quantidade: number;
    data_consumo: string;
  };
  materialId?: number; // Optional: pre-select material ID
}

const ConsumptionAddDialog = ({
  open,
  onClose,
  consumptionItem,
  materialId,
}: ConsumptionAddDialogProps) => {
  const {
    materialTypes,
    createConsumptionItem,
    updateConsumptionItem,
    isCreatingConsumptionItem,
    isUpdatingConsumptionItem,
  } = useMapotecaMaterials();

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<ConsumptionFormValues>({
    resolver: zodResolver(consumptionSchema),
    defaultValues: {
      tipo_material_id: materialId || 0,
      quantidade: 0,
      data_consumo: new Date(),
    },
  });

  // Set form values when consumption data changes
  useEffect(() => {
    if (consumptionItem) {
      setValue('id', consumptionItem.id);
      setValue('tipo_material_id', consumptionItem.tipo_material_id);
      setValue('quantidade', consumptionItem.quantidade);
      setValue('data_consumo', new Date(consumptionItem.data_consumo));
    } else if (materialId) {
      setValue('tipo_material_id', materialId);
      setValue('quantidade', 0);
      setValue('data_consumo', new Date());
    } else {
      reset({
        tipo_material_id: 0,
        quantidade: 0,
        data_consumo: new Date(),
      });
    }
  }, [consumptionItem, materialId, setValue, reset, open]);

  const isProcessing = isCreatingConsumptionItem || isUpdatingConsumptionItem;

  const onSubmit = async (data: ConsumptionFormValues) => {
    try {
      if (consumptionItem) {
        // Update existing consumption record
        const updateData: ConsumptionItemUpdateRequest = {
          id: consumptionItem.id,
          tipo_material_id: data.tipo_material_id,
          quantidade: data.quantidade,
          data_consumo: data.data_consumo.toISOString(),
        };
        await updateConsumptionItem(updateData);
      } else {
        // Create new consumption record
        const createData: ConsumptionItemCreateRequest = {
          tipo_material_id: data.tipo_material_id,
          quantidade: data.quantidade,
          data_consumo: data.data_consumo.toISOString(),
        };
        await createConsumptionItem(createData);
      }
      handleClose();
    } catch (error) {
      console.error('Error saving consumption item:', error);
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ptBR}>
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>
            {consumptionItem ? 'Editar Consumo' : 'Registrar Consumo'}
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

              <Grid item xs={12}>
                <Controller
                  name="data_consumo"
                  control={control}
                  render={({ field }) => (
                    <DatePicker
                      label="Data de Consumo"
                      value={field.value}
                      onChange={(date) => field.onChange(date)}
                      slotProps={{
                        textField: {
                          fullWidth: true,
                          margin: 'normal',
                          error: !!errors.data_consumo,
                          helperText: errors.data_consumo?.message as string,
                        },
                      }}
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
                ? consumptionItem
                  ? 'Atualizando...'
                  : 'Registrando...'
                : consumptionItem
                ? 'Atualizar'
                : 'Registrar'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </LocalizationProvider>
  );
};

export default ConsumptionAddDialog;
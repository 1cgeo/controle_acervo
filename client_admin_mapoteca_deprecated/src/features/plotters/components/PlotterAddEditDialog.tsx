// Path: features\plotters\components\PlotterAddEditDialog.tsx
import { useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Grid,
  FormControlLabel,
  Switch,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { ptBR } from 'date-fns/locale';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plotter, PlotterCreateRequest, PlotterUpdateRequest } from '@/types/plotter';
import { useMapotecaPlotters } from '@/hooks/useMapotecaPlotters';

interface PlotterAddEditDialogProps {
  open: boolean;
  plotter?: Plotter;
  onClose: () => void;
}

// Form validation schema
const plotterSchema = z.object({
  id: z.number().optional(),
  ativo: z.boolean().default(true),
  nr_serie: z.string().min(1, 'Número de série é obrigatório'),
  modelo: z.string().min(1, 'Modelo é obrigatório'),
  data_aquisicao: z.date().nullable().optional(),
  vida_util: z.number().int().min(0).nullable().optional(),
});

type FormValues = z.infer<typeof plotterSchema>;

const PlotterAddEditDialog = ({
  open,
  plotter,
  onClose,
}: PlotterAddEditDialogProps) => {
  const { createPlotter, updatePlotter, isCreatingPlotter, isUpdatingPlotter } = useMapotecaPlotters();

  const {
    control,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
  } = useForm<FormValues>({
    resolver: zodResolver(plotterSchema),
    defaultValues: {
      ativo: true,
      nr_serie: '',
      modelo: '',
      data_aquisicao: null,
      vida_util: null,
    },
  });

  // Set form values when plotter data changes
  useEffect(() => {
    if (plotter) {
      setValue('id', plotter.id);
      setValue('ativo', plotter.ativo);
      setValue('nr_serie', plotter.nr_serie);
      setValue('modelo', plotter.modelo);
      setValue('data_aquisicao', plotter.data_aquisicao ? new Date(plotter.data_aquisicao) : null);
      setValue('vida_util', plotter.vida_util);
    } else {
      reset({
        ativo: true,
        nr_serie: '',
        modelo: '',
        data_aquisicao: null,
        vida_util: null,
      });
    }
  }, [plotter, setValue, reset]);

  const handleClose = () => {
    reset();
    onClose();
  };

  const onSubmit = async (data: FormValues) => {
    try {
      if (plotter) {
        // Update existing plotter
        const updateData: PlotterUpdateRequest = {
          id: plotter.id,
          ativo: data.ativo,
          nr_serie: data.nr_serie,
          modelo: data.modelo,
          data_aquisicao: data.data_aquisicao ? data.data_aquisicao.toISOString() : null,
          vida_util: data.vida_util,
        };
        await updatePlotter(updateData);
      } else {
        // Create new plotter
        const createData: PlotterCreateRequest = {
          ativo: data.ativo,
          nr_serie: data.nr_serie,
          modelo: data.modelo,
          data_aquisicao: data.data_aquisicao ? data.data_aquisicao.toISOString() : null,
          vida_util: data.vida_util,
        };
        await createPlotter(createData);
      }
      handleClose();
    } catch (error) {
      console.error('Error saving plotter:', error);
    }
  };

  const isProcessing = isCreatingPlotter || isUpdatingPlotter;

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ptBR}>
      <Dialog
        open={open}
        onClose={handleClose}
        aria-labelledby="plotter-dialog-title"
        maxWidth="md"
        fullWidth
      >
        <DialogTitle id="plotter-dialog-title">
          {plotter ? 'Editar Plotter' : 'Adicionar Plotter'}
        </DialogTitle>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogContent dividers>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Controller
                  name="nr_serie"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Número de Série"
                      fullWidth
                      margin="normal"
                      error={!!errors.nr_serie}
                      helperText={errors.nr_serie?.message}
                      disabled={isProcessing}
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <Controller
                  name="modelo"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Modelo"
                      fullWidth
                      margin="normal"
                      error={!!errors.modelo}
                      helperText={errors.modelo?.message}
                      disabled={isProcessing}
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <Controller
                  name="data_aquisicao"
                  control={control}
                  render={({ field }) => (
                    <DatePicker
                      label="Data de Aquisição"
                      value={field.value}
                      onChange={(date) => field.onChange(date)}
                      slotProps={{
                        textField: {
                          fullWidth: true,
                          margin: 'normal',
                          error: !!errors.data_aquisicao,
                          helperText: errors.data_aquisicao?.message,
                        },
                      }}
                      disabled={isProcessing}
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <Controller
                  name="vida_util"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Vida Útil (meses)"
                      type="number"
                      fullWidth
                      margin="normal"
                      error={!!errors.vida_util}
                      helperText={errors.vida_util?.message}
                      disabled={isProcessing}
                      value={field.value === null ? '' : field.value}
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                      inputProps={{ min: 0 }}
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12}>
                <Controller
                  name="ativo"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={
                        <Switch
                          checked={field.value}
                          onChange={(e) => field.onChange(e.target.checked)}
                          disabled={isProcessing}
                        />
                      }
                      label="Plotter Ativa"
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
                ? plotter
                  ? 'Atualizando...'
                  : 'Criando...'
                : plotter
                ? 'Atualizar'
                : 'Criar'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </LocalizationProvider>
  );
};

export default PlotterAddEditDialog;
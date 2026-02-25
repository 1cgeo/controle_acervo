import {
    Card,
    CardContent,
    Typography,
    Box,
    LinearProgress,
    SxProps,
    Theme,
  } from '@mui/material';
  import { ReactNode } from 'react';
  
  interface StatsCardProps {
    title: string;
    value: string | number;
    icon?: ReactNode;
    color?: string;
    loading?: boolean;
    progress?: number;
    suffix?: string;
    sx?: SxProps<Theme>;
  }
  
  export const StatsCard = ({
    title,
    value,
    icon,
    color,
    loading = false,
    progress,
    suffix,
    sx = {},
  }: StatsCardProps) => {
    return (
      <Card
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          ...sx,
        }}
      >
        <CardContent sx={{ flex: 1, p: 3 }}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              mb: 2,
            }}
          >
            <Typography variant="subtitle2" color="text.secondary">
              {title}
            </Typography>
            {icon && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  backgroundColor: color ? `${color}16` : 'primary.lighter',
                  color: color || 'primary.main',
                }}
              >
                {icon}
              </Box>
            )}
          </Box>
  
          {loading ? (
            <Box sx={{ width: '60%', mt: 2 }}>
              <LinearProgress />
            </Box>
          ) : (
            <Typography variant="h3" component="div" sx={{ mb: 1 }}>
              {value}
              {suffix && (
                <Typography
                  component="span"
                  variant="body2"
                  sx={{ ml: 0.5, fontSize: '1rem', color: 'text.secondary' }}
                >
                  {suffix}
                </Typography>
              )}
            </Typography>
          )}
  
          {progress !== undefined && (
            <Box sx={{ width: '100%', mt: 2 }}>
              <LinearProgress
                variant="determinate"
                value={progress}
                sx={{
                  height: 8,
                  borderRadius: 1,
                  backgroundColor: color ? `${color}16` : 'primary.lighter',
                  '& .MuiLinearProgress-bar': {
                    backgroundColor: color || 'primary.main',
                  },
                }}
              />
            </Box>
          )}
        </CardContent>
      </Card>
    );
  };
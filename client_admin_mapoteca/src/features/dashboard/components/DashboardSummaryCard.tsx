// Path: features\dashboard\components\DashboardSummaryCard.tsx
import { ReactNode } from 'react';
import { Card, CardContent, Typography, Box, useTheme } from '@mui/material';
import { styled } from '@mui/material/styles';

interface DashboardSummaryCardProps {
  title: string;
  value: number | string;
  icon?: ReactNode;
  iconColor?: string;
  footer?: ReactNode;
}

const IconBox = styled(Box)(({ theme }) => ({
  width: 64,
  height: 64,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: theme.spacing(2),
  color: theme.palette.common.white,
}));

export const DashboardSummaryCard = ({
  title,
  value,
  icon,
  iconColor,
  footer,
}: DashboardSummaryCardProps) => {
  const theme = useTheme();

  return (
    <Card
      elevation={2}
      sx={{
        height: '100%',
        borderRadius: 2,
        transition: 'transform 0.3s, box-shadow 0.3s',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: theme.shadows[8],
        },
      }}
    >
      <CardContent
        sx={{
          p: 3,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        {icon && (
          <IconBox sx={{ bgcolor: iconColor || theme.palette.primary.main }}>
            {icon}
          </IconBox>
        )}

        <Typography variant="h3" component="div" gutterBottom>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </Typography>

        <Typography
          variant="subtitle1"
          color="text.secondary"
          gutterBottom
          noWrap
        >
          {title}
        </Typography>

        {footer && <Box sx={{ mt: 2, width: '100%' }}>{footer}</Box>}
      </CardContent>
    </Card>
  );
};
import React, { ReactNode } from 'react';
import { Box } from '@mui/material';
import { Helmet } from 'react-helmet-async';

interface PageProps {
  children: ReactNode;
  title?: string;
  description?: string;
  meta?: React.DetailedHTMLProps<
    React.MetaHTMLAttributes<HTMLMetaElement>,
    HTMLMetaElement
  >[];
}

const Page = ({ children, title = '', description = '', meta }: PageProps) => {
  return (
    <>
      <Helmet>
        <title>
          {title ? `${title} | SCA` : 'SCA - Sistema de Controle do Acervo'}
        </title>
        {description && <meta name="description" content={description} />}
        {/* Additional meta tags */}
        {meta?.map((item, index) => (
          <meta key={index} {...item} />
        ))}
      </Helmet>
      <Box sx={{ height: '100%' }}>{children}</Box>
    </>
  );
};

export default Page;
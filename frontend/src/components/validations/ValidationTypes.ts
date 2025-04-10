export type ValidationError = {
  code: 'MISSING_GST' | 'INCOMPLETE_VENDOR';
  message: string;
  resolution: string;
  link?: string;
};

export const VALIDATION_CONFIG: Record<ValidationError['code'], ValidationError> = {
  MISSING_GST: {
    code: 'MISSING_GST',
    message: 'Project GST information not configured',
    resolution: 'Update payment terms with GST details',
    // link: '/payment-terms'
  },
  INCOMPLETE_VENDOR: {
    code: 'INCOMPLETE_VENDOR',
    message: 'Vendor contact details incomplete',
    resolution: 'Complete vendor profile information',
  }
};
export const ProjectQueryKeys = {
  project: (projectId: string) => ['projects', 'single', projectId],
  customer: (customerId: string) => ['customers', 'single', customerId],
  quotes: (parameters: any) => ['Approved Quotations', 'list', { ...parameters }],
  estimates: (parameters: any) => ['Project Estimates', 'list', { ...parameters }]
};

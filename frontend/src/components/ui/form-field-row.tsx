import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from '@/components/ui/form';

type FormFieldRowVariant = 'default' | 'sheet' | 'compact';

interface FormFieldRowProps {
  label: string;
  required?: boolean;
  description?: string;
  children: React.ReactNode;
  variant?: FormFieldRowVariant;
  className?: string;
  labelClassName?: string;
  inputClassName?: string;
  descriptionClassName?: string;
}

export const FormFieldRow: React.FC<FormFieldRowProps> = ({
  label,
  required = false,
  description,
  children,
  variant = 'default',
  className,
  labelClassName,
  inputClassName,
  descriptionClassName,
}) => {
  if (variant === 'sheet') {
    return (
      <FormItem className={cn('space-y-2', className)}>
        <FormLabel className={cn('text-sm font-medium', labelClassName)}>
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </FormLabel>
        <FormControl>
          <div className={cn('w-full', inputClassName)}>{children}</div>
        </FormControl>
        {description && (
          <FormDescription className={cn('text-xs', descriptionClassName)}>
            {description}
          </FormDescription>
        )}
        <FormMessage />
      </FormItem>
    );
  }

  if (variant === 'compact') {
    return (
      <FormItem
        className={cn(
          'flex flex-col gap-1.5 md:flex-row md:items-start md:gap-3',
          className
        )}
      >
        <FormLabel
          className={cn(
            'text-sm font-medium md:w-1/4 md:pt-2.5 md:text-right shrink-0',
            labelClassName
          )}
        >
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </FormLabel>
        <div className={cn('flex-1 space-y-1', inputClassName)}>
          <FormControl>{children}</FormControl>
          <FormMessage />
        </div>
        {description && (
          <FormDescription
            className={cn('text-xs md:w-1/4 md:pt-2.5 shrink-0', descriptionClassName)}
          >
            {description}
          </FormDescription>
        )}
      </FormItem>
    );
  }

  return (
    <FormItem
      className={cn(
        'flex flex-col gap-2 md:flex-row md:items-start md:gap-4',
        className
      )}
    >
      <FormLabel
        className={cn('text-sm font-medium md:w-1/4 md:pt-2.5 shrink-0', labelClassName)}
      >
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </FormLabel>
      <div className={cn('flex-1 md:w-1/2 space-y-1.5', inputClassName)}>
        <FormControl>{children}</FormControl>
        <FormMessage />
      </div>
      {description && (
        <FormDescription
          className={cn('text-xs text-muted-foreground md:w-1/4 md:pt-2.5 shrink-0', descriptionClassName)}
        >
          {description}
        </FormDescription>
      )}
    </FormItem>
  );
};

interface FormSectionHeaderProps {
  title: string;
  icon?: React.ReactNode;
  className?: string;
}

export const FormSectionHeader: React.FC<FormSectionHeaderProps> = ({
  title,
  icon,
  className,
}) => {
  return (
    <div className={cn('flex items-center gap-2 pb-2', className)}>
      {icon && (
        <div className="flex items-center justify-center h-8 w-8 rounded-md bg-primary/10 text-primary">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-primary">{title}</h3>
    </div>
  );
};

interface FormGridProps {
  children: React.ReactNode;
  columns?: 1 | 2 | 3;
  className?: string;
}

export const FormGrid: React.FC<FormGridProps> = ({
  children,
  columns = 2,
  className,
}) => {
  return (
    <div
      className={cn(
        'grid gap-4',
        columns === 1 && 'grid-cols-1',
        columns === 2 && 'grid-cols-1 md:grid-cols-2',
        columns === 3 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
        className
      )}
    >
      {children}
    </div>
  );
};

interface FormActionsProps {
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'between' | 'center';
}

export const FormActions: React.FC<FormActionsProps> = ({
  children,
  className,
  align = 'right',
}) => {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-3 pt-6 border-t border-border',
        'sm:flex-row sm:items-center',
        align === 'left' && 'sm:justify-start',
        align === 'right' && 'sm:justify-end',
        align === 'between' && 'sm:justify-between',
        align === 'center' && 'sm:justify-center',
        className
      )}
    >
      {children}
    </div>
  );
};

export default FormFieldRow;

import React, { ChangeEvent, useCallback, useState } from 'react';
import { Input } from '../ui/input';

interface QuantityQuoteInputProps {
  value: number | string;
  onChange: (newValue: number | string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const QuantityQuoteInput: React.FC<QuantityQuoteInputProps> = ({
  value,
  onChange,
  placeholder,
  className,
  disabled,
}) => {
  const [inputValue, setInputValue] = useState<string>(String(value));

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const newValue = event.target.value;
      setInputValue(newValue);

      if (newValue === '' || newValue === '-') {
        onChange(newValue);
        return;
      }

      const parsedValue = parseFloat(newValue);

      if (!isNaN(parsedValue)) {
        onChange(parsedValue);
      }
    },
    [onChange]
  );

  const handleBlur = useCallback(() => {
    if (inputValue === '') {
      onChange(0);
      setInputValue('0');
    }
  }, [inputValue, onChange]);

  return (
      <Input
        data-cy="vendor-quote-rate"
        type="text"
        value={inputValue}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
      />
  );
};

export default QuantityQuoteInput;
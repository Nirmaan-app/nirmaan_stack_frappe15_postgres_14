import ReactSelect from "react-select";

interface DepartmentSelectProps {
  value: string | null | undefined;
  onChange: (department: string | null) => void;
  /** The active departments (`useDepartmentOptions().departments`). */
  departments: string[];
  isLoading?: boolean;
  isDisabled?: boolean;
  inputId?: string;
  placeholder?: string;
}

interface Option {
  label: string;
  value: string;
}

/**
 * Pick a department from the list (Nirmaan Department). New departments are added by Admin and HR in
 * Assets -> Departments, not typed here, so every name is spelled one way.
 */
export function DepartmentSelect({
  value,
  onChange,
  departments,
  isLoading,
  isDisabled,
  inputId,
  placeholder = "Select a department...",
}: DepartmentSelectProps) {
  const options: Option[] = departments.map((department) => ({ label: department, value: department }));
  // A record may hold a department that has since been switched off; still show it.
  const current = value ? options.find((o) => o.value === value) ?? { label: value, value } : null;

  return (
    <ReactSelect<Option, false>
      inputId={inputId}
      options={options}
      value={current}
      onChange={(option) => onChange(option?.value ?? null)}
      placeholder={isLoading ? "Loading..." : placeholder}
      noOptionsMessage={() => "No departments yet. Admin or HR can add them in Assets → Departments."}
      isLoading={isLoading}
      isDisabled={isDisabled}
      isClearable
      classNames={{ control: () => "border-gray-200 hover:border-gray-300" }}
    />
  );
}

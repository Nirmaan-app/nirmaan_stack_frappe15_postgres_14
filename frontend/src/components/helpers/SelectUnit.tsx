import * as SelectPrimitive from "@radix-ui/react-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

interface SelectUnitProps extends SelectPrimitive.SelectProps {
    value: string;
    onChange: (value: string) => void;
    className?: string;
}

export const UnitOptions : {value: string, label: string}[] = [
    // { value: "PCS", label: "PCS" },
    // {value : "PKT", label : "PKT"},
    { value: "BOX", label: "BOX" },
    { value: "ROLL", label: "ROLL" },
    {value : "LTH", label : "LTH"},
    {value : "MTR", label : "MTR"},
    { value: "NOS", label: "NOS" },
    { value: "KGS", label: "KGS" },
    { value: "PAIRS", label: "PAIRS" },
    { value: "PACKS", label: "PACKS" },
    { value: "DRUM", label: "DRUM" },
    { value: "SQMTR", label: "SQMTR" },
    { value: "LTR", label: "LTR" },
    { value: "BUNDLE", label: "BUNDLE" },
    { value: "FEET", label: "FEET" },
    { value: "LOT", label: "LOT" },
    { value: "SQFT", label: "SQFT" },
    { value: "RFT", label: "RFT" },
  ]

export const SelectUnit : React.FC<SelectUnitProps> = ({ value, onChange, className, ...rest }) => {

    return (
        <Select
            value={value}
            onValueChange={(e) => onChange(e)}
            {...rest}
        >
          <SelectTrigger>
            <SelectValue className={className} placeholder="Select Unit" />
          </SelectTrigger>
          <SelectContent>
            {UnitOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                    {option.label}
                </SelectItem>
            ))}
          </SelectContent>
        </Select>
    );
};
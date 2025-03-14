import { Vendor } from '@/pages/ServiceRequests/service-request/select-service-vendor';
import ReactSelect from 'react-select';

interface VendorsReactSelectProps {
  selectedVendor: Vendor | null
  vendorOptions: Vendor[]
  setSelectedvendor: React.Dispatch<React.SetStateAction<Vendor | null>>
}

export const VendorsReactSelect = ({selectedVendor, vendorOptions, setSelectedvendor} : VendorsReactSelectProps) => {
  return (
    <ReactSelect
              className="w-full"
              value={selectedVendor}
              options={vendorOptions}
              onChange={(option) => setSelectedvendor(option)}
              components={{
                SingleValue: CustomSingleValue,
                Option: CustomOption,
              }}
              isClearable
              onMenuOpen={() => setSelectedvendor(null)}
            />
  )
}

interface VendorsReactMultiSelectProps {
  vendorOptions : Vendor[]
  setSelectedVendors : React.Dispatch<React.SetStateAction<Vendor[]>>
}

export const VendorsReactMultiSelect = ({vendorOptions, setSelectedVendors} : VendorsReactMultiSelectProps) => {
  return (
    <ReactSelect options={vendorOptions} 
      onChange={(options : Vendor[]) => setSelectedVendors(options)}
      isMulti
      components={{
        SingleValue: CustomSingleValue,
        Option: CustomOption,
      }}
    />
  )
}

const CustomSingleValue = ({ data } : { data : Vendor}) => (
  <div>
    <strong>{data.label}</strong>{" "}
    <i>
      ({data.city}, {data.state})
    </i>
  </div>
);

const CustomOption = (props : any) => {
  const { data, innerRef, innerProps } = props;
  return (
    <div
      ref={innerRef}
      {...innerProps}
      style={{ padding: "5px", cursor: "pointer" }}
    >
      <strong className="text-primary">{data.label}</strong>{" "}
      <i>
        ({data.city}, {data.state})
      </i>
    </div>
  );
};
import { TailSpin } from "react-loader-spinner";

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-[90vh] w-full">
    <TailSpin
      color="#D03B45" 
      aria-label="Loading payments" 
      radius={2}
    />
    <span className="sr-only">Loading data...</span>
  </div>
);

export default LoadingFallback;
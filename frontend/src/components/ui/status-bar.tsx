interface StatusBarProps {
    currentValue: number;
    totalValue: number;   
    barWidth?: number;  
  }
  
  const StatusBar: React.FC<StatusBarProps> = ({ currentValue, totalValue, barWidth = 240 }) => {
    const percentage = (currentValue / totalValue) * 100;
  
    return (
      <div className="flex gap-1 items-center">
        <p>{`${currentValue}/${totalValue}`}</p>
  
        <div className="relative w-full h-2 rounded-xl bg-gray-300" style={{ width: `${barWidth}px` }}>
          <div
            className="h-2 rounded-xl bg-[#17B26A]"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    );
  };

  export default StatusBar
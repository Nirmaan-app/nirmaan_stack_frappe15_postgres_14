import React, { useState, useRef, useEffect } from 'react';

interface DropdownMenuProps {
  items: string[];
  onSelect: (selectedItem: string) => void;
}

const DropdownMenu: React.FC<DropdownMenuProps> = ({ items, onSelect }) => {
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleItemClick = (item: string) => {
    setSelectedItem(item);
    onSelect(item);
    setIsOpen(false);
  };

  const dropdownClass = `origin-top-right absolute mt-2 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none`;

  return (
    <div ref={dropdownRef} className="relative inline-block text-left">
      <div>
        <button
          type="button"
          className="inline-flex min-w-40 md:min-w-[40rem] justify-center w-full rounded-lg border border-gray-300 shadow-sm px-4 py-2 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-100"
          onClick={() => setIsOpen(!isOpen)}
        >
          {selectedItem || 'Select'}
        </button>
      </div>

      {isOpen && (
        <div className={dropdownClass} style={{ minWidth: '18rem' }}>
          <div className="py-1" role="menu" aria-orientation="vertical" aria-labelledby="options-menu">
            {items.map((item) => (
              <button
                key={item}
                className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 w-full text-left"
                role="menuitem"
                onClick={() => handleItemClick(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DropdownMenu;

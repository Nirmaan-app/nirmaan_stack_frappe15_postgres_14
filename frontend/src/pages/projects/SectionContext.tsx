import React, { createContext, useContext } from "react";

interface SectionContextProps {
    setSection: (sectionKey: string) => void;
    sections: string[];
    setCurrentStep: (step: number) => void;
    sectionTitles: Record<string, string>;
  }
  
const SectionContext = createContext<SectionContextProps | null>(null);


export const SectionProvider = ({ value, children } : { value: SectionContextProps, children: React.ReactNode }) => {
  return <SectionContext.Provider value={value}>{children}</SectionContext.Provider>;
};

const useSectionContext = () => {
  return useContext(SectionContext);
};

export default useSectionContext;
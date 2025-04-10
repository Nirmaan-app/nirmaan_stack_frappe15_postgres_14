// src/components/validation/ValidationMessages.tsx
import { ValidationError } from "./ValidationTypes";

export const ValidationMessages = ({ title, errors }: {title:string, errors: ValidationError[] }) => (
  <div className="space-y-2 p-2">
    <h4 className="font-medium text-sm">{title}</h4>
    <ul className="list-disc list-inside space-y-1">
      {errors.map((error) => (
        <li key={error.code} className="text-sm">
          <span>{error.message}</span>
          {error.link ? (
            <a href={error.link} className="text-primary underline ml-1">
              ({error.resolution})
            </a>
          ) : (
            <span>({error.resolution})</span>
          )}
        </li>
      ))}
    </ul>
  </div>
);
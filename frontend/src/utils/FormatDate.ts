// Built once: `toLocaleString(…)` builds a new formatter on every call, three per date, in every table cell.
// `undefined` is the browser's language, as 'default' was.
const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { day: '2-digit' });
const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short' });
const YEAR_FORMAT = new Intl.DateTimeFormat(undefined, { year: 'numeric' });

/** "05-Nov-2026" in the browser's language. */
export const formatDate = (dateString: Date | string) => {
    const date = new Date(dateString);
    // `toLocaleString` printed "Invalid Date" for each part; `format` throws instead, so keep the old text.
    if (isNaN(date.getTime())) return 'Invalid Date-Invalid Date-Invalid Date';
    return DAY_FORMAT.format(date) + '-' + MONTH_FORMAT.format(date) + '-' + YEAR_FORMAT.format(date);
};

export const convertDate = (dateString: string) => {
    return new Date(dateString)
}

export const formatToLocalDateTimeString = (date: Date) => {
    if (!date) return
    date = new Date(date);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};


export const formatDateToDDMMYYYY = (date: Date, underscore = false) => {
    if (!date) return
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const day = String(date.getDate()).padStart(2, '0');

    const formattedDate = `${day}-${month}-${year}`;

    if (underscore) {
        return `${day}_${month}_${year}`
    }

    return formattedDate;
};

export function isCreatedToday(creationDate?: string): boolean {
  if (!creationDate) return false;
  const created = new Date(creationDate);
  const today = new Date();
  return (
    created.getFullYear() === today.getFullYear() &&
    created.getMonth() === today.getMonth() &&
    created.getDate() === today.getDate()
  );
}
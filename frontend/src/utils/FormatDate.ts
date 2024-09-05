export const formatDate = (dateString : Date) => {
    if (!dateString) return "";
    return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(new Date(dateString));
};

export const convertDate = (dateString : string) => {
    return new Date(dateString)
}

export const formatLocalDateTime = (date : Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${day}-${month}-${year}`;
  };
export const formatDate = (dateString: Date | string) => {
    // if (!dateString) return "";
    // return new Intl.DateTimeFormat('en-GB', {
    //     day: '2-digit',
    //     month: 'short',
    //     year: 'numeric',
    // }).format(new Date(dateString));
    let date = new Date(dateString);
    const day = date.toLocaleString('default', { day: '2-digit' });
    const month = date.toLocaleString('default', { month: 'short' });
    const year = date.toLocaleString('default', { year: 'numeric' });
    return day + '-' + month + '-' + year;
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
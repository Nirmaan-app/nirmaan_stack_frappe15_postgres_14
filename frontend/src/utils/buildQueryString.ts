export const buildQueryString = (params) => {
    return Object.keys(params)
        .map(key => {
            const value = params[key];
            if (Array.isArray(value)) {
                return value.map(val => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`).join('&');
            } else {
                return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
            }
        })
        .join('&');
};

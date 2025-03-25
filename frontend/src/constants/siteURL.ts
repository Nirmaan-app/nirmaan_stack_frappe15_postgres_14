const SITEURL = import.meta.env.MODE === "development" ? `http://localhost:8000` : `${window.location.protocol}//${window.location.host}`

export default SITEURL
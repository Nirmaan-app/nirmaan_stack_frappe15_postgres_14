// export const hasNirmaanUserRole = () => {
//     //@ts-expect-error
//     return (window?.frappe?.boot?.user?.roles ?? []).includes('Raven User');
// }

export const isProjectLead = () => {
    //@ts-ignore
    console.log(window?.frappe?.boot?.user?.roles)
    //@ts-expect-error
    return (window?.frappe?.boot?.user?.roles ?? []).includes('Project Lead');
}
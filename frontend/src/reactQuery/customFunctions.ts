import { buildQueryString } from "@/utils/buildQueryString";

export const fetchDocList = async (doctype : string, fields = [], filters = [], limit = 1000) => {

    const queryParams = buildQueryString({
        fields: JSON.stringify(fields.length > 0 ? fields : ["*"]),
        filters: JSON.stringify(filters),
        order_by: '',
        limit,
        as_dict: 'true'
    });

    const response = await fetch(`http://localhost:8000/api/resource/${doctype}?${queryParams}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });
  
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
  
    const data = await response.json();
    return data;
  };


export const fetchDocCount = async (doctype: string) => {
    const data = await fetchDocList(doctype);
    return data.data?.length || 0;
};



export const fetchDoc = async (doctype: string, name : string) => {
  const response = await fetch(`http://localhost:8000/api/resource/${doctype}/${name}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Network response was not ok');
  }

  const data = await response.json();
  return data; 
}







  

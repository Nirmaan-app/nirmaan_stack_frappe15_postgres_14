export interface InternalTransferRequest {
  name: string;
  creation: string;
  modified: string;
  owner: string;
  target_project: string;
  status: "Pending" | "Completed" | "Rejected";
  requested_by: string;
  memo_count: number;
}
